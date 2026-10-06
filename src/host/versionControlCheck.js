// src/host/versionControlCheck.js —— 写操作预检：判定、目标解析、票据与索引指纹（#841）
//
// 职责（只做预检，不起任何写命令）：读一次首屏 → 交给核心 rules.judge 判定 → 解析目标（推送目标 / 上游 /
// 提交信息与索引指纹 / i-t-a）→ 发一张票。写命令一条都不在这里发；所有只读命令都走注入的 safeGit（它就是
// #839 的安全执行层，最终落到 versionControl.js 那一个 runGit 出口：同一份固定前缀、同一个报闸、同一条日志）。
//
// 票据语义照仓库既有先例（src/host/updatePkg/service.js 的 receipt）：id + checkedAtMs + expiresAtMs，
// 重放保护靠 requestId 去重（同一个 requestId 回到同一份结果），不是「用一次就烧掉」。客户端只拿得到
// id/checkedAtMs/expiresAtMs/op 与 plan（目标要显示给人看），票里的 headOid/指纹/目标留在宿主内存。
import { createHash } from 'node:crypto'
import { fixedPrefix, lsFilesStageArgs, remoteListArgs, REMOTE_PATTERN } from '../shared/version-control/commands.js'
import { judge } from '../shared/version-control/rules.js'
import { makeTicket, indexRecordCount, fingerprintInputOf, hasIntentToAdd, TICKET_TTL_MS } from '../shared/version-control/write-ticket.js'
import { pushPlanOf } from '../shared/version-control/push-plan.js'
import { messageProblem, writeHintFor } from '../shared/version-control/write-reasons.js'

/** 预算（附录第 5 节）：预检调用 60 秒；两条只读命令各自的单次预算。 */
const CHECK_CALL_BUDGET_MS = 60000
const LSFILES_TIMEOUT_MS = 15000
const LSFILES_LIMIT = 8 * 1024 * 1024
const REMOTE_TIMEOUT_MS = 5000
const REMOTE_LIMIT = 4096

export function createWriteCheck(deps) {
  const { vc, safeGit, nowMs, randomId, failPhone } = deps
  /** id → 票据；requestId → 上一次的结果（幂等去重）。都只在进程内存里，不落盘、不进日志。 */
  const tickets = new Map()
  const results = new Map()
  const now = function () { try { return typeof nowMs === 'function' ? nowMs() : Date.now() } catch (e) { return Date.now() } }
  const mkId = function () { try { return typeof randomId === 'function' ? String(randomId()) : String(Math.random()).slice(2) + String(now()) } catch (e) { return String(now()) + '-' + String(Math.random()).slice(2) } }
  function fail(kind, reason, message, extra) {
    const base = { ok: false, error: { kind: kind, reason: reason, message: message || '', hint: writeHintFor(reason) } }
    return Object.assign(base, extra || {})
  }
  /** 跑一条只读命令（走安全执行层；票据与指纹都不许截断）。 */
  async function readOut(cwd, args, timeoutMs, stdoutLimit) {
    if (!safeGit || typeof safeGit.startCall !== 'function') return { ok: false, kind: 'env', message: '没有拿到安全执行层' }
    const call = safeGit.startCall({ totalBudgetMs: CHECK_CALL_BUDGET_MS })
    const r = await call.run({ args: fixedPrefix().concat(args), cwd: cwd, timeoutMs: timeoutMs, stdoutLimit: stdoutLimit })
    return r
  }
  async function handleGitWriteCheck(args) {
    const a = args || {}
    const op = String(a.op || '')
    if (op !== 'commit' && op !== 'pull' && op !== 'push' && op !== 'fetch') return fail('args', 'bad-target', '预检要知道是哪种写操作（op）')
    const cwd = String(a.cwd || '')
    // ① 首屏（只读）：判定、身份、分支与上游都从这一份读数来，不另起一套读法。
    const sr = await vc.readScreenOf(cwd)
    if (!sr || sr.ok !== true) return sr || fail('env', 'unknown-write-failure', '读不到这个仓库的首屏')
    const screen = sr.screen
    let decision = judge(screen, op)
    // D3 + 裁决 1：推送时「没有上游 / 上游被删」不是「不能推」，而是「走 set-upstream 档、显式 -u」——
    // 把这两条理由从 block 里摘掉，剩下的理由还成立才真挡（rules.ts 是只读版写的，这两档归写操作自己判）。
    if (op === 'push') {
      const left = decision.reasons.filter(function (x) { return x !== 'no-upstream' && x !== 'upstream-gone' })
      decision = (decision.verdict === 'block' && left.length === 0) ? { verdict: 'allow', reasons: [] } : { verdict: decision.verdict, reasons: left }
    }
    if (decision.verdict === 'block') {
      // 提交被 judge 挡在「没有暂存内容」时，再问一次是不是 git add -N（i-t-a）：那是更具体的理由（话术指终端）。
      if (op === 'commit' && decision.reasons.indexOf('nothing-staged') >= 0) {
        const st0 = await readOut(cwd, ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--find-renames'], LSFILES_TIMEOUT_MS, LSFILES_LIMIT)
        if (st0 && st0.ok === true && st0.truncated !== true && hasIntentToAdd(st0.stdout) === true) return fail('args', 'intent-to-add', writeHintFor('intent-to-add'))
      }
      return Object.assign(fail('blocked', 'blocked', '这次操作现在做不了', { reasons: decision.reasons }), { decision: decision })
    }
    const branch = screen.identity && screen.identity.branch ? String(screen.identity.branch) : ''
    let plan = null
    let indexFingerprint = null
    let indexEntries = null
    if (op === 'push') {
      // ② 远端清单（只读）：多远端时列出去让用户选，不替用户挑。
      const rr = await readOut(cwd, remoteListArgs(), REMOTE_TIMEOUT_MS, REMOTE_LIMIT)
      if (!rr || rr.ok !== true) return fail(rr && rr.kind ? rr.kind : 'other', 'unknown-write-failure', (rr && rr.message) || '读远端清单失败', { hint: (rr && rr.hint) || undefined })
      const remotes = String(rr.stdout || '').split('\n').map(function (x) { return x.replace(/\r/g, '').trim() }).filter(function (x) { return x !== '' })
      const cur = (screen.branches || []).filter(function (b) { return b.short === branch })[0] || null
      const pp = pushPlanOf({ branch: branch, upstream: cur ? cur.upstream : null, upstreamGone: !!(cur && cur.upstreamGone), remotes: remotes, requestedRemote: a.remote ? String(a.remote) : null })
      if (pp.ok !== true) {
        if (pp.reason === 'need-remote-choice') return fail('args', 'need-remote-choice', '这个仓库有多个远端，请选一个', { remotes: pp.candidates })
        return fail('args', pp.reason, writeHintFor(pp.reason))
      }
      plan = pp.plan
    }
    if (op === 'pull') {
      const cur = (screen.branches || []).filter(function (b) { return b.short === branch })[0] || null
      if (!cur || !cur.upstream) return Object.assign(fail('blocked', 'blocked', '这个分支没有上游', { reasons: ['no-upstream'] }), { decision: { verdict: 'block', reasons: ['no-upstream'] } })
      plan = { mode: 'existing', remote: '', branch: '', localBranch: branch, upstream: cur.upstream }
    }
    if (op === 'fetch') {
      // 更新远方记录只定远端，不定分支：远端名由上游解析或单远端默认，多远端请人选，不替人挑。
      const rr = await readOut(cwd, remoteListArgs(), REMOTE_TIMEOUT_MS, REMOTE_LIMIT)
      if (!rr || rr.ok !== true) return fail(rr && rr.kind ? rr.kind : 'other', 'unknown-write-failure', (rr && rr.message) || '读远端清单失败', { hint: (rr && rr.hint) || undefined })
      const remotes = String(rr.stdout || '').split('\n').map(function (x) { return x.replace(/\r/g, '').trim() }).filter(function (x) { return x !== '' })
      if (remotes.length === 0) return fail('args', 'no-remote', writeHintFor('no-remote'))
      const cur = (screen.branches || []).filter(function (b) { return b.short === branch })[0] || null
      const upstream = cur && cur.upstream ? String(cur.upstream) : ''
      const upstreamRemote = upstream.indexOf('/') >= 0 ? upstream.slice(0, upstream.indexOf('/')) : ''
      const requested = a.remote ? String(a.remote) : ''
      if (requested !== '') {
        if (!REMOTE_PATTERN.test(requested) || remotes.indexOf(requested) < 0) return fail('args', 'bad-target', writeHintFor('bad-target'))
        plan = { mode: 'fetch', remote: requested, branch: '', localBranch: branch, upstream: upstream || null }
      } else if (upstreamRemote !== '' && remotes.indexOf(upstreamRemote) >= 0) {
        plan = { mode: 'fetch', remote: upstreamRemote, branch: '', localBranch: branch, upstream: upstream || null }
      } else if (remotes.length === 1) {
        plan = { mode: 'fetch', remote: remotes[0], branch: '', localBranch: branch, upstream: upstream || null }
      } else {
        return fail('args', 'need-remote-choice', '这个仓库有多个远端，请选一个', { remotes: remotes })
      }
    }
    if (op === 'commit') {
      const bad = messageProblem(a.message)
      if (bad) return fail('args', bad, writeHintFor(bad))
      // ③ 索引指纹与 i-t-a：两条都只读，且与执行前那次逐字节同一口径（同一固定前缀、同一 -z、不截断）。
      const lf = await readOut(cwd, lsFilesStageArgs(), LSFILES_TIMEOUT_MS, LSFILES_LIMIT)
      if (!lf || lf.ok !== true) return fail(lf && lf.kind ? lf.kind : 'other', 'fingerprint-unavailable', (lf && lf.message) || '读不到暂存区清单', { hint: writeHintFor('fingerprint-unavailable') })
      if (lf.truncated === true) return fail('other', 'fingerprint-unavailable', '暂存区清单太大，被截断了')
      const text = fingerprintInputOf(lf.stdout)
      indexFingerprint = createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
      indexEntries = indexRecordCount(lf.stdout)
      // i-t-a（git add -N）：与「真暂存一个空文件」指纹相同但提交结局不同，直接拒绝（总工订正 3）。
      const st = await readOut(cwd, ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--find-renames'], LSFILES_TIMEOUT_MS, LSFILES_LIMIT)
      if (!st || st.ok !== true) return fail(st && st.kind ? st.kind : 'other', 'unknown-write-failure', (st && st.message) || '读不到工作区状态')
      if (st.truncated === true) return fail('other', 'fingerprint-unavailable', '工作区状态太大，被截断了')
      if (hasIntentToAdd(st.stdout) === true) return fail('args', 'intent-to-add', writeHintFor('intent-to-add'))
    }
    const ticket = makeTicket({ id: mkId(), op: op, nowMs: now(), headOid: String(screen.identity.oid || ''), indexFingerprint: indexFingerprint, indexEntries: indexEntries, target: plan, repoRoot: String((screen.identity && screen.identity.worktreePath) || '') })
    tickets.set(ticket.id, ticket)
    if (tickets.size > 200) { const oldest = tickets.keys().next().value; tickets.delete(oldest) } // 上限与清理：票据只在内存里，别无限长
    return {
      ok: true,
      decision: { verdict: decision.verdict, reasons: decision.reasons },
      plan: plan,
      ticket: { id: ticket.id, checkedAtMs: ticket.checkedAtMs, expiresAtMs: ticket.expiresAtMs, op: ticket.op },
      readAtMs: now(),
    }
  }
  return { handleGitWriteCheck: handleGitWriteCheck, tickets: tickets, results: results, ttlMs: TICKET_TTL_MS, now: now, mkId: mkId, fail: fail, readOut: readOut }
}
