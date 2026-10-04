// src/host/versionControlWrite.js —— 四条写电话的执行体（#841）：暂存 / 提交 / 拉取 / 推送
//
// 只做四件事：核对票据（状态在确认之后变过就拒绝，一条写命令都不起）→ 走注入的 safeGit（#839 的安全执行层，
// 最终落到 versionControl.js 那一个 runGit 出口）→ 把结局如实包成扁平信封 → 回包带「做成了没有」的判定依据。
//
// 硬口径：推送永远显式 <remote> <local>:<remote>（总工最终口径），固定前缀带 push.followTags=false 与
// push.default=nothing；set-upstream 档在执行前再核一次「这个分支确实还没有上游」（已存在上游还带 -u 会
// 静默覆盖用户的设置）；提交不幂等，失败后只能靠仓库状态说话，绝不自动重试、绝不声称成功。
import { createHash } from 'node:crypto'
import { fixedPrefix, stageArgs, commitArgs, pullArgs, pushArgs, lsFilesStageArgs, remoteListArgs } from '../shared/version-control/commands.js'
import { ticketVerdict, indexRecordCount, fingerprintInputOf } from '../shared/version-control/write-ticket.js'
import { pushPlanOf } from '../shared/version-control/push-plan.js'
import { classifyWriteFailure, writeHintFor, pathsProblem, messageProblem } from '../shared/version-control/write-reasons.js'

const ADD_TIMEOUT_MS = 15000, COMMIT_TIMEOUT_MS = 60000, PULL_TIMEOUT_MS = 180000, PUSH_TIMEOUT_MS = 120000
const SMALL_LIMIT = 256 * 1024, LSFILES_LIMIT = 8 * 1024 * 1024, REMOTE_LIMIT = 4096

export function createWritePhones(deps) {
  const { vc, safeGit, tickets, results, nowMs } = deps
  const now = function () { try { return typeof nowMs === 'function' ? nowMs() : Date.now() } catch (e) { return Date.now() } }
  const fingerprintOf = function (text) { try { return createHash('sha256').update(fingerprintInputOf(text), 'utf8').digest('hex').slice(0, 16) } catch (e) { return null } }
  /** 写失败信封：kind 是 #839 的传输档、reason 是写层稳定标识符、hint 取对应那一句。 */
  function wfail(kind, reason, message, extra) {
    const hint = (reason === 'unknown-write-failure' && extra && extra.transportHint) ? extra.transportHint : writeHintFor(reason)
    return Object.assign({ ok: false, error: { kind: kind, reason: reason, message: message || '', hint: hint } }, extra && extra.extra ? extra.extra : {})
  }
  async function runOne(cwd, args, timeoutMs, stdoutLimit, callBudgetMs) {
    const call = safeGit.startCall({ totalBudgetMs: callBudgetMs })
    return await call.run({ args: fixedPrefix().concat(args), cwd: cwd, timeoutMs: timeoutMs, stdoutLimit: stdoutLimit })
  }
  async function readHead(cwd) {
    const r = await runOne(cwd, ['rev-parse', 'HEAD'], 5000, 4096, 20000)
    return (r && r.ok === true) ? String(r.stdout || '').trim() : null
  }
  /** 票据核对用的「此刻状态」：HEAD 一定量；提交多量一次索引指纹；推送重量一次目标（含「还没有上游」再核）。 */
  async function currentOf(cwd, op, ticket) {
    const headOid = await readHead(cwd)
    const cur = { op: op, headOid: headOid || '', indexFingerprint: null, indexAvailable: false, target: null }
    if (op === 'commit') {
      const lf = await runOne(cwd, lsFilesStageArgs(), 15000, LSFILES_LIMIT, 30000)
      if (lf && lf.ok === true && lf.truncated !== true && ticket.indexFingerprint !== null) {
        cur.indexFingerprint = fingerprintOf(lf.stdout)
        cur.indexAvailable = true
      }
    }
    if (op === 'push' && ticket.target) {
      const rr = await runOne(cwd, remoteListArgs(), 5000, REMOTE_LIMIT, 15000)
      const remotes = (rr && rr.ok === true) ? String(rr.stdout || '').split('\n').map(function (x) { return x.replace(/\r/g, '').trim() }).filter(function (x) { return x !== '' }) : []
      const branch = ticket.target.localBranch
      // 「还没有上游」在动手前再核一次：已经存在上游时再带 -u 会静默覆盖掉用户原来设的上游。
      const up = await runOne(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', branch + '@{u}'], 5000, 4096, 15000)
      const upstream = (up && up.ok === true) ? String(up.stdout || '').trim() : null
      const pp = pushPlanOf({ branch: branch, upstream: upstream, upstreamGone: upstream === null, remotes: remotes, requestedRemote: ticket.target.remote })
      cur.target = pp.ok === true ? pp.plan : null
    }
    return cur
  }
  /** 统一的票据门：回 ok 或回一个「拒绝」信封（并把这个结果按 requestId 记下，重复调用回到同一份）。 */
  async function gateTicket(args, op) {
    const a = args || {}
    const cwd = String(a.cwd || '')
    const ticketId = String(a.ticketId || '')
    const requestId = String(a.requestId || '')
    if (requestId && results.has(requestId)) return { replay: results.get(requestId) }
    const ticket = tickets.get(ticketId) || null
    const cur = await currentOf(cwd, op, ticket)
    const v = ticketVerdict(ticket, now(), cur)
    if (v.ok !== true) {
      const out = wfail('other', v.reason, writeHintFor(v.reason))
      if (requestId) results.set(requestId, out)
      return { denied: out }
    }
    return { ticket: ticket, cwd: cwd, requestId: requestId }
  }
  function remember(requestId, out) { if (requestId) results.set(requestId, out); return out }

  /** 暂存（无票）：整文件、可逆、天然幂等。 */
  async function handleGitStage(args) {
    const a = args || {}
    const cwd = String(a.cwd || '')
    const bad = pathsProblem(a.paths)
    if (bad) return wfail('args', bad, writeHintFor(bad))
    const paths = a.paths.map(function (p) { return String(p) })
    const r = await runOne(cwd, stageArgs(paths), ADD_TIMEOUT_MS, SMALL_LIMIT, ADD_TIMEOUT_MS + 10000)
    if (r && r.ok === true) return { ok: true, staged: paths, atMs: now() }
    const text = (r && r.stderr) || (r && r.message) || ''
    const reason = classifyWriteFailure('commit', r ? r.exitCode : -1, text)
    return wfail((r && r.kind && r.kind !== 'ok') ? r.kind : 'other', reason === 'unknown-write-failure' ? 'unknown-write-failure' : reason, (r && r.message) || '', { transportHint: r && r.hint })
  }
  /** 提交：票据绑 HEAD + 索引指纹；失败后按 HEAD 有没有变说话，绝不自动重试。 */
  async function handleGitCommit(args) {
    const a = args || {}
    const bad = messageProblem(a.message)
    if (bad) return wfail('args', bad, writeHintFor(bad))
    const g = await gateTicket(a, 'commit')
    if (g.replay) return g.replay
    if (g.denied) return g.denied
    const headBefore = String(g.ticket.headOid || '')
    const r = await runOne(g.cwd, commitArgs(String(a.message)), COMMIT_TIMEOUT_MS, SMALL_LIMIT, COMMIT_TIMEOUT_MS + 10000)
    const headAfter = await readHead(g.cwd)
    if (r && r.ok === true) return remember(g.requestId, { ok: true, committed: true, headBefore: headBefore, headAfter: headAfter || '', atMs: now() })
    // 不幂等：HEAD 变了就如实说「HEAD 已经变了」，既不声称成功也不自动重试。
    if (headAfter && headBefore && headAfter !== headBefore) return remember(g.requestId, wfail('other', 'head-moved', writeHintFor('head-moved'), { extra: { headBefore: headBefore, headAfter: headAfter } }))
    const text = (r && r.stderr) || (r && r.message) || ''
    const reason = classifyWriteFailure('commit', r ? r.exitCode : -1, text)
    return remember(g.requestId, wfail((r && r.kind && r.kind !== 'ok') ? r.kind : 'other', reason, (r && r.message) || '', { transportHint: r && r.hint, extra: { headBefore: headBefore, headAfter: headAfter || '' } }))
  }
  /** 拉取：只认快进；被拒时那一半 fetch 已经成功，话术说清「远端新提交已经取回来了」。 */
  async function handleGitPull(args) {
    const g = await gateTicket(args, 'pull')
    if (g.replay) return g.replay
    if (g.denied) return g.denied
    const headBefore = String(g.ticket.headOid || '')
    const r = await runOne(g.cwd, pullArgs(), PULL_TIMEOUT_MS, SMALL_LIMIT, PULL_TIMEOUT_MS + 10000)
    const headAfter = await readHead(g.cwd)
    if (r && r.ok === true) {
      const mode = (headAfter && headBefore && headAfter !== headBefore) ? 'fast-forward' : 'up-to-date'
      return remember(g.requestId, { ok: true, mode: mode, headBefore: headBefore, headAfter: headAfter || '', upstream: (g.ticket.target && g.ticket.target.upstream) || '', atMs: now() })
    }
    const text = (r && r.stderr) || (r && r.message) || ''
    const reason = classifyWriteFailure('pull', r ? r.exitCode : -1, text)
    return remember(g.requestId, wfail((r && r.kind && r.kind !== 'ok') ? r.kind : 'other', reason, (r && r.message) || '', { transportHint: r && r.hint, extra: { headBefore: headBefore, headAfter: headAfter || '' } }))
  }
  /** 推送：目标只认票据里那份（执行前重新解析并比对，不一致就拒绝）。 */
  async function handleGitPush(args) {
    const g = await gateTicket(args, 'push')
    if (g.replay) return g.replay
    if (g.denied) return g.denied
    const plan = g.ticket.target
    const r = await runOne(g.cwd, pushArgs(plan), PUSH_TIMEOUT_MS, SMALL_LIMIT, PUSH_TIMEOUT_MS + 10000)
    if (r && r.ok === true) {
      const text = String(r.stdout || '')
      return remember(g.requestId, { ok: true, mode: plan.mode === 'set-upstream' ? 'set-upstream' : 'existing-upstream', remote: plan.remote, branch: plan.branch, upToDate: /up-to-date/i.test(text), atMs: now() })
    }
    const text = (r && r.stderr) || (r && r.message) || ''
    const reason = classifyWriteFailure('push', r ? r.exitCode : -1, text)
    return remember(g.requestId, wfail((r && r.kind && r.kind !== 'ok') ? r.kind : 'other', reason, (r && r.message) || '', { transportHint: r && r.hint }))
  }
  return { handleGitStage: handleGitStage, handleGitCommit: handleGitCommit, handleGitPull: handleGitPull, handleGitPush: handleGitPush, indexRecordCount: indexRecordCount }
}
