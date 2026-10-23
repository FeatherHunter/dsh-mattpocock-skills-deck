/**
 * src/host/versionControlCheck.ts —— 写操作预检：判定、目标解析、票据与索引指纹（#841）。
 *
 * 来源与零变化：本文件由同目录 versionControlCheck.js 逐行转写而来，只加类型标注与注释，
 * 没有改任何运行时语义。原来的 .js 文件保留不动，引用方继续写 `./versionControlCheck.js`，
 * 由 scripts/ts-hook.mts 在加载时改指到同名 .ts。
 *
 * 职责（只做预检，不起任何写命令）：读一次首屏 → 交给核心 rules.judge 判定 → 解析目标（推送目标 / 上游 /
 * 提交信息与索引指纹 / i-t-a）→ 发一张票。写命令一条都不在这里发；所有只读命令都走注入的 safeGit（它就是
 * #839 的安全执行层，最终落到 versionControl.js 那一个 runGit 出口：同一份固定前缀、同一个报闸、同一条日志）。
 *
 * 票据语义照仓库既有先例（src/host/updatePkg/service.js 的 receipt）：id + checkedAtMs + expiresAtMs，
 * 重放保护靠 requestId 去重（同一个 requestId 回到同一份结果），不是「用一次就烧掉」。客户端只拿得到
 * id/checkedAtMs/expiresAtMs/op 与 plan（目标要显示给人看），票里的 headOid/指纹/目标留在宿主内存。
 *
 * 为什么这样标注：
 * 1. 相对导入说明符保留 `.js` 后缀，不改成 `.ts`，改了会绕过钩子的同名解析约定，所以不能动。
 * 2. `node:crypto` 那一行按 src/host/choiceStore.ts:16-24 同款写法加类型忽略注释：
 *    本域 tsconfig 有意不加载任何类型包，运行时一定是 Node，所以只忽略类型层面的找不到模块错误。
 * 3. 判定、票据与推送计划的形状由共享核心拥有，本文件只负责按约定调用，所以全部按 `any` 收，
 *    类型不替代运行时的判空与判形逻辑。
 * 4. 没有新增任何 import 边：只给已有引用加类型，不引入新模块依赖。
 */
// @ts-expect-error
import { createHash } from 'node:crypto'
import { fixedPrefix, lsFilesStageArgs, remoteListArgs, REMOTE_PATTERN } from '../shared/version-control/src/commands.js'
import { judge } from '../shared/version-control/src/rules.js'
import { makeTicket, indexRecordCount, fingerprintInputOf, hasIntentToAdd } from '../shared/version-control/src/write-ticket.js'
import { pushPlanOf } from '../shared/version-control/src/push-plan.js'
import { messageProblem, writeHintFor } from '../shared/version-control/src/write-reasons.js'
// 下面三个时间都住中央 YAML（config/timeouts.yaml 的 vcCheckCallBudgetMs / vcLsFilesTimeoutMs /
// vcRemoteTimeoutMs 键）：这里直接引用中央常量，调时间改 YAML。
// 它们说的是两件事，别混：
//   · CHECK_CALL_BUDGET_MS 是「整趟预检」的总预算（交给 safeGit.startCall 的 totalBudgetMs），
//     一次预检里所有只读步骤合起来不许超过它；
//   · LSFILES_TIMEOUT_MS 与 REMOTE_TIMEOUT_MS 是「单条只读命令」各自的超时（交给 readOut 的 timeoutMs），
//     管某一条命令最多跑多久——单条超时相加可以比总预算大，但总预算用完就先停。
// 路径走域构建产物写法（与 src/refresh/rooms/host/chain-coalescing.ts 引 values.js 同例），值由 tests/verify-time-config.ts 看守一致。
import { VC_CHECK_CALL_BUDGET_MS as CHECK_CALL_BUDGET_MS, VC_LSFILES_TIMEOUT_MS as LSFILES_TIMEOUT_MS, VC_REMOTE_TIMEOUT_MS as REMOTE_TIMEOUT_MS, TICKET_TTL_MS } from '../shared/time-config/src/values.js'

/** 预算（附录第 5 节）：预检调用 60 秒；两条只读命令各自的单次预算。 */
const LSFILES_LIMIT: number = 8 * 1024 * 1024
const REMOTE_LIMIT: number = 4096

/** 父文件注入的依赖：首屏读数、安全执行层与时钟票据口都在这里，本文件不自取任何环境。 */
export interface WriteCheckDeps {
  vc: any
  safeGit: any
  nowMs: any
  randomId: any
  failPhone: any
}

export function createWriteCheck(deps: any): any {
  const { vc, safeGit, nowMs, randomId, failPhone }: any = deps
  /** id → 票据；requestId → 上一次的结果（幂等去重）。都只在进程内存里，不落盘、不进日志。 */
  const tickets = new Map<string, any>()
  const results = new Map<string, any>()
  const now = function (): number { try { return typeof nowMs === 'function' ? nowMs() : Date.now() } catch (e) { return Date.now() } }
  const mkId = function (): string { try { return typeof randomId === 'function' ? String(randomId()) : String(Math.random()).slice(2) + String(now()) } catch (e) { return String(now()) + '-' + String(Math.random()).slice(2) } }
  function fail(kind: any, reason: any, message: any, extra?: any): any {
    const base: any = { ok: false, error: { kind: kind, reason: reason, message: message || '', hint: writeHintFor(reason) } }
    return Object.assign(base, extra || {})
  }
  /** 跑一条只读命令（走安全执行层；票据与指纹都不许截断）。 */
  async function readOut(cwd: any, args: any, timeoutMs: any, stdoutLimit: any): Promise<any> {
    if (!safeGit || typeof safeGit.startCall !== 'function') return { ok: false, kind: 'env', message: '没有拿到安全执行层' }
    const call: any = safeGit.startCall({ totalBudgetMs: CHECK_CALL_BUDGET_MS })
    const r: any = await call.run({ args: fixedPrefix().concat(args), cwd: cwd, timeoutMs: timeoutMs, stdoutLimit: stdoutLimit })
    return r
  }
  async function handleGitWriteCheck(args: any): Promise<any> {
    const a: any = args || {}
    const op: string = String(a.op || '')
    if (op !== 'commit' && op !== 'pull' && op !== 'push' && op !== 'fetch') return fail('args', 'bad-target', '预检要知道是哪种写操作（op）')
    const cwd: string = String(a.cwd || '')
    // ① 首屏（只读）：判定、身份、分支与上游都从这一份读数来，不另起一套读法。
    const sr: any = await vc.readScreenOf(cwd)
    if (!sr || sr.ok !== true) return sr || fail('env', 'unknown-write-failure', '读不到这个仓库的首屏')
    const screen: any = sr.screen
    let decision: any = judge(screen, op)
    // D3 + 裁决 1：推送时「没有上游 / 上游被删」不是「不能推」，而是「走 set-upstream 档、显式 -u」——
    // 把这两条理由从 block 里摘掉，剩下的理由还成立才真挡（rules.ts 是只读版写的，这两档归写操作自己判）。
    if (op === 'push') {
      const left: any[] = decision.reasons.filter(function (x: any) { return x !== 'no-upstream' && x !== 'upstream-gone' })
      decision = (decision.verdict === 'block' && left.length === 0) ? { verdict: 'allow', reasons: [] } : { verdict: decision.verdict, reasons: left }
    }
    if (decision.verdict === 'block') {
      // 提交被 judge 挡在「没有暂存内容」时，再问一次是不是 git add -N（i-t-a）：那是更具体的理由（话术指终端）。
      if (op === 'commit' && decision.reasons.indexOf('nothing-staged') >= 0) {
        const st0: any = await readOut(cwd, ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--find-renames'], LSFILES_TIMEOUT_MS, LSFILES_LIMIT)
        if (st0 && st0.ok === true && st0.truncated !== true && hasIntentToAdd(st0.stdout) === true) return fail('args', 'intent-to-add', writeHintFor('intent-to-add'))
      }
      return Object.assign(fail('blocked', 'blocked', '这次操作现在做不了', { reasons: decision.reasons }), { decision: decision })
    }
    const branch: string = screen.identity && screen.identity.branch ? String(screen.identity.branch) : ''
    let plan: any = null
    let indexFingerprint: any = null
    let indexEntries: any = null
    if (op === 'push') {
      // ② 远端清单（只读）：多远端时列出去让用户选，不替用户挑。
      const rr: any = await readOut(cwd, remoteListArgs(), REMOTE_TIMEOUT_MS, REMOTE_LIMIT)
      if (!rr || rr.ok !== true) return fail(rr && rr.kind ? rr.kind : 'other', 'unknown-write-failure', (rr && rr.message) || '读远端清单失败', { hint: (rr && rr.hint) || undefined })
      const remotes: string[] = String(rr.stdout || '').split('\n').map(function (x: any) { return x.replace(/\r/g, '').trim() }).filter(function (x: any) { return x !== '' })
      const cur: any = (screen.branches || []).filter(function (b: any) { return b.short === branch })[0] || null
      const pp: any = pushPlanOf({ branch: branch, upstream: cur ? cur.upstream : null, upstreamGone: !!(cur && cur.upstreamGone), remotes: remotes, requestedRemote: a.remote ? String(a.remote) : null })
      if (pp.ok !== true) {
        if (pp.reason === 'need-remote-choice') return fail('args', 'need-remote-choice', '这个仓库有多个远端，请选一个', { remotes: pp.candidates })
        return fail('args', pp.reason, writeHintFor(pp.reason))
      }
      plan = pp.plan
    }
    if (op === 'pull') {
      const cur: any = (screen.branches || []).filter(function (b: any) { return b.short === branch })[0] || null
      if (!cur || !cur.upstream) return Object.assign(fail('blocked', 'blocked', '这个分支没有上游', { reasons: ['no-upstream'] }), { decision: { verdict: 'block', reasons: ['no-upstream'] } })
      plan = { mode: 'existing', remote: '', branch: '', localBranch: branch, upstream: cur.upstream }
    }
    if (op === 'fetch') {
      // 更新远方记录只定远端，不定分支：远端名由上游解析或单远端默认，多远端请人选，不替人挑。
      const rr: any = await readOut(cwd, remoteListArgs(), REMOTE_TIMEOUT_MS, REMOTE_LIMIT)
      if (!rr || rr.ok !== true) return fail(rr && rr.kind ? rr.kind : 'other', 'unknown-write-failure', (rr && rr.message) || '读远端清单失败', { hint: (rr && rr.hint) || undefined })
      const remotes: string[] = String(rr.stdout || '').split('\n').map(function (x: any) { return x.replace(/\r/g, '').trim() }).filter(function (x: any) { return x !== '' })
      if (remotes.length === 0) return fail('args', 'no-remote', writeHintFor('no-remote'))
      const cur: any = (screen.branches || []).filter(function (b: any) { return b.short === branch })[0] || null
      const upstream: string = cur && cur.upstream ? String(cur.upstream) : ''
      const upstreamRemote: string = upstream.indexOf('/') >= 0 ? upstream.slice(0, upstream.indexOf('/')) : ''
      const requested: string = a.remote ? String(a.remote) : ''
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
      const bad: any = messageProblem(a.message)
      if (bad) return fail('args', bad, writeHintFor(bad))
      // ③ 索引指纹与 i-t-a：两条都只读，且与执行前那次逐字节同一口径（同一固定前缀、同一 -z、不截断）。
      const lf: any = await readOut(cwd, lsFilesStageArgs(), LSFILES_TIMEOUT_MS, LSFILES_LIMIT)
      if (!lf || lf.ok !== true) return fail(lf && lf.kind ? lf.kind : 'other', 'fingerprint-unavailable', (lf && lf.message) || '读不到暂存区清单', { hint: writeHintFor('fingerprint-unavailable') })
      if (lf.truncated === true) return fail('other', 'fingerprint-unavailable', '暂存区清单太大，被截断了')
      const text: any = fingerprintInputOf(lf.stdout)
      indexFingerprint = createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
      indexEntries = indexRecordCount(lf.stdout)
      // i-t-a（git add -N）：与「真暂存一个空文件」指纹相同但提交结局不同，直接拒绝（总工订正 3）。
      const st: any = await readOut(cwd, ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--find-renames'], LSFILES_TIMEOUT_MS, LSFILES_LIMIT)
      if (!st || st.ok !== true) return fail(st && st.kind ? st.kind : 'other', 'unknown-write-failure', (st && st.message) || '读不到工作区状态')
      if (st.truncated === true) return fail('other', 'fingerprint-unavailable', '工作区状态太大，被截断了')
      if (hasIntentToAdd(st.stdout) === true) return fail('args', 'intent-to-add', writeHintFor('intent-to-add'))
    }
    const ticket: any = makeTicket({ id: mkId(), op: op, nowMs: now(), headOid: String(screen.identity.oid || ''), indexFingerprint: indexFingerprint, indexEntries: indexEntries, target: plan, repoRoot: String((screen.identity && screen.identity.worktreePath) || '') })
    tickets.set(ticket.id, ticket)
    if (tickets.size > 200) { const oldest: any = tickets.keys().next().value; tickets.delete(oldest) } // 上限与清理：票据只在内存里，别无限长
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
