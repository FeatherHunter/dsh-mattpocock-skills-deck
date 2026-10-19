/**
 * src/host/versionControlWrite.ts —— 五条写电话的执行体（#841）：暂存 / 撤回暂存 / 提交 / 拉取 / 推送。
 *
 * 来源与零变化：本文件由同目录 versionControlWrite.js 逐行转写而来，只加类型标注与注释，
 * 没有改任何运行时语义。原来的 .js 文件保留不动，引用方继续写 `./versionControlWrite.js`，
 * 由 scripts/ts-hook.mjs 在加载时改指到同名 .ts。
 *
 * 只做四件事：核对票据（状态在确认之后变过就拒绝，一条写命令都不起）→ 走注入的 safeGit（#839 的安全执行层，
 * 最终落到 versionControl.js 那一个 runGit 出口）→ 把结局如实包成扁平信封 → 回包带「做成了没有」的判定依据。
 *
 * 硬口径：推送永远显式 <remote> <local>:<remote>（总工最终口径），固定前缀带 push.followTags=false 与
 * push.default=nothing；set-upstream 档在执行前再核一次「这个分支确实还没有上游」（已存在上游还带 -u 会
 * 静默覆盖用户的设置）；提交不幂等，失败后只能靠仓库状态说话，绝不自动重试、绝不声称成功。
 *
 * 为什么这样标注：
 * 1. 相对导入说明符保留 `.js` 后缀，不改成 `.ts`，改了会绕过钩子的同名解析约定，所以不能动。
 * 2. `node:crypto` 那一行按 src/host/choiceStore.ts:16-24 同款写法加类型忽略注释：
 *    本域 tsconfig 有意不加载任何类型包，运行时一定是 Node，所以只忽略类型层面的找不到模块错误。
 * 3. 票据、推送计划与失败分类的形状由共享核心拥有，本文件只负责按约定调用，所以全部按 `any` 收，
 *    类型不替代运行时的判空与判形逻辑。
 * 4. 没有新增任何 import 边：只给已有引用加类型，不引入新模块依赖。
 */
// @ts-expect-error
import { createHash } from 'node:crypto'
import { fixedPrefix, stageArgs, unstageArgs, commitArgs, pullArgs, pushArgs, fetchArgs, lsFilesStageArgs, remoteListArgs, checkRefArgs, REMOTE_PATTERN } from '../shared/version-control/src/commands.js'
import { ticketVerdict, ticketPureVerdict, requestIdProblem, indexRecordCount, fingerprintInputOf } from '../shared/version-control/src/write-ticket.js'
import { pushPlanOf } from '../shared/version-control/src/push-plan.js'
import { classifyWriteFailure, writeHintFor, pathsProblem, messageProblem, idShapeProblem } from '../shared/version-control/src/write-reasons.js'
// 这个文件里的时间分两组，都是可调的，全部住中央 YAML（config/timeouts.yaml），调时间改 YAML：
//   · 五个写命令的超时（vcAddTimeoutMs / vcCommitTimeoutMs / vcPullTimeoutMs / vcPushTimeoutMs / vcFetchTimeoutMs）：
//     每条都是「这一条写命令最多跑多久」，下面直接引用中央常量；
//   · runOne 那些裸数字改成的是另一组键：单条只读命令的超时（vcReadCmdTimeoutMs / vcLsFilesTimeoutMs）与
//     「整趟预算」（vcHeadCallBudgetMs / vcReadCallBudgetMs / vcLsFilesCallBudgetMs / vcRemoteListCallBudgetMs）。
// 单条超时与整趟预算是两件事：前者管某一条命令最多跑多久，后者管挂在这一步上的所有命令合起来的上限。
// 路径走域构建产物写法（与 src/host/refresh/chain-ride.ts 引 values.js 同例），值由 tests/verify-time-config.ts 看守一致。
import {
  VC_ADD_TIMEOUT_MS as ADD_TIMEOUT_MS,
  VC_COMMIT_TIMEOUT_MS as COMMIT_TIMEOUT_MS,
  VC_PULL_TIMEOUT_MS as PULL_TIMEOUT_MS,
  VC_PUSH_TIMEOUT_MS as PUSH_TIMEOUT_MS,
  VC_FETCH_TIMEOUT_MS as FETCH_TIMEOUT_MS,
  VC_READ_CMD_TIMEOUT_MS,
  VC_HEAD_CALL_BUDGET_MS,
  VC_READ_CALL_BUDGET_MS,
  VC_LSFILES_TIMEOUT_MS,
  VC_LSFILES_CALL_BUDGET_MS,
  VC_REMOTE_LIST_CALL_BUDGET_MS,
  VC_PRE_PUSH_CHECK_CALL_BUDGET_MS,
  VC_WRITE_CALL_MARGIN_MS,
} from '../shared/time-config/src/values.js'

// 五个写命令各自的超时（中央 YAML 的 vcAddTimeoutMs / vcCommitTimeoutMs / vcPullTimeoutMs / vcPushTimeoutMs /
// vcFetchTimeoutMs）：暂存与撤回暂存还把 ADD_TIMEOUT_MS 兼作那一次调用的总预算。
// 那条总预算不是裸字面量，而是「该条命令的超时 + VC_WRITE_CALL_MARGIN_MS（中央 YAML 的 vcWriteCallMarginMs，
// 留 10 秒余量）」——超时管一条命令跑多久，整趟预算管这一步所有命令合起来的上限，两个数各管一件事。
const SMALL_LIMIT: number = 256 * 1024, LSFILES_LIMIT: number = 8 * 1024 * 1024, REMOTE_LIMIT: number = 4096

/** 父文件注入的依赖：首屏读数、安全执行层、票据表与时钟都在这里，本文件不自取任何环境。 */
export interface WritePhonesDeps {
  vc: any
  safeGit: any
  tickets: any
  results: any
  nowMs: any
}

export function createWritePhones(deps: any): any {
  const { vc, safeGit, tickets, results, nowMs }: any = deps
  const now = function (): number { try { return typeof nowMs === 'function' ? nowMs() : Date.now() } catch (e) { return Date.now() } }
  const fingerprintOf = function (text: any): string | null { try { return createHash('sha256').update(fingerprintInputOf(text), 'utf8').digest('hex').slice(0, 16) } catch (e) { return null } }
  /** 写失败信封：kind 是 #839 的传输档、reason 是写层稳定标识符、hint 取对应那一句。 */
  function wfail(kind: any, reason: any, message: any, extra?: any): any {
    const hint: any = (reason === 'unknown-write-failure' && extra && extra.transportHint) ? extra.transportHint : writeHintFor(reason)
    return Object.assign({ ok: false, error: { kind: kind, reason: reason, message: message || '', hint: hint } }, extra && extra.extra ? extra.extra : {})
  }
  /** 请求按白名单显式拼：只给执行层这四个字段，**绝不把客户端 args 整包透传**。
   *  尤其不许透传 stallMs —— 看门狗在真机网络命令上会误杀健康传输（#841 第三批结论），
   *  所以「客户端乱传 stallMs」这条路必须堵死在这里（配套门禁：请求里带 stallMs 时仍不得开看门狗）。 */
  async function runOne(cwd: any, args: any, timeoutMs: any, stdoutLimit: any, callBudgetMs: any): Promise<any> {
    const call: any = safeGit.startCall({ totalBudgetMs: callBudgetMs })
    return await call.run({ args: fixedPrefix().concat(args), cwd: cwd, timeoutMs: timeoutMs, stdoutLimit: stdoutLimit })
  }
  async function readHead(cwd: any): Promise<string | null> {
    // 读 HEAD 这一条：单条超时 10 秒（VC_READ_CMD_TIMEOUT_MS，这一条命令最多跑多久），
    // 整趟预算 20 秒（VC_HEAD_CALL_BUDGET_MS，挂在读 HEAD 这一步上的所有命令合起来的上限）——两个数各管一件事。
    const r: any = await runOne(cwd, ['rev-parse', 'HEAD'], VC_READ_CMD_TIMEOUT_MS, 4096, VC_HEAD_CALL_BUDGET_MS)
    return (r && r.ok === true) ? String(r.stdout || '').trim() : null
  }
  /** 票据核对用的「此刻状态」：HEAD 一定量；提交多量一次索引指纹；推送重量一次目标（含「还没有上游」再核）。 */
  async function currentOf(cwd: any, op: any, ticket: any): Promise<any> {
    const headOid: string | null = await readHead(cwd)
    const cur: any = { op: op, headOid: headOid || '', indexFingerprint: null, indexAvailable: false, target: null, repoRoot: '' }
    if (!ticket) return cur
    // 仓库根（票绑仓库）：两个不同目录的仓库可以有完全相同的 HEAD 与指纹，所以执行前必须重量一次。
    // 仓库根这一条：单条超时走只读命令那一档（VC_READ_CMD_TIMEOUT_MS），整趟预算走一次只读调用的那一档（VC_READ_CALL_BUDGET_MS）。
    const top: any = await runOne(cwd, ['rev-parse', '--show-toplevel'], VC_READ_CMD_TIMEOUT_MS, 4096, VC_READ_CALL_BUDGET_MS)
    cur.repoRoot = (top && top.ok === true) ? String(top.stdout || '').trim() : ''
    if (op === 'pull') {
      // pull 也要绑目标：预检之后改上游或切分支都不许绕过。
      // 当前分支名这一条：单条超时 VC_READ_CMD_TIMEOUT_MS，整趟预算 VC_READ_CALL_BUDGET_MS（与上一条同一档）。
      const br: any = await runOne(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], VC_READ_CMD_TIMEOUT_MS, 4096, VC_READ_CALL_BUDGET_MS)
      const branch: string = (br && br.ok === true) ? String(br.stdout || '').trim() : ''
      // 上游引用名这一条：同样单条超时 VC_READ_CMD_TIMEOUT_MS、整趟预算 VC_READ_CALL_BUDGET_MS。
      const up: any = await runOne(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', branch + '@{u}'], VC_READ_CMD_TIMEOUT_MS, 4096, VC_READ_CALL_BUDGET_MS)
      const upstream: any = (up && up.ok === true) ? String(up.stdout || '').trim() : null
      cur.target = { mode: 'existing', remote: '', branch: '', localBranch: branch, upstream: upstream }
    }
    if (op === 'commit') {
      // 读暂存区清单这一步：单条超时 VC_LSFILES_TIMEOUT_MS（清单可能很大，单独给 15 秒），
      // 整趟预算 VC_LSFILES_CALL_BUDGET_MS（这一步所有命令合起来的上限）——两者不是一回事。
      const lf: any = await runOne(cwd, lsFilesStageArgs(), VC_LSFILES_TIMEOUT_MS, LSFILES_LIMIT, VC_LSFILES_CALL_BUDGET_MS)
      if (lf && lf.ok === true && lf.truncated !== true && ticket.indexFingerprint !== null) {
        cur.indexFingerprint = fingerprintOf(lf.stdout)
        cur.indexAvailable = true
      }
    }
    if (op === 'push' && ticket.target) {
      // 列远端这一步：单条超时走只读命令那一档（VC_READ_CMD_TIMEOUT_MS，纯本地读很快），
      // 整趟预算 VC_REMOTE_LIST_CALL_BUDGET_MS（列远端这一步所有命令合起来的上限）。
      const rr: any = await runOne(cwd, remoteListArgs(), VC_READ_CMD_TIMEOUT_MS, REMOTE_LIMIT, VC_REMOTE_LIST_CALL_BUDGET_MS)
      const remotes: string[] = (rr && rr.ok === true) ? String(rr.stdout || '').split('\n').map(function (x: any) { return x.replace(/\r/g, '').trim() }).filter(function (x: any) { return x !== '' }) : []
      const branch: any = ticket.target.localBranch
      // 「还没有上游」在动手前再核一次：已经存在上游时再带 -u 会静默覆盖掉用户原来设的上游。
      // 上游要从**配置**解析（branch.<名>.remote + .merge），不能用 `<分支>@{u}`：上游被删时 git 对 @{u} 直接
      // 失败（exit 128），于是配置还在的那一档会解析成「没有上游」→ 重算成 set-upstream，与票里的 recreate 对不上
      // （真机证据抓到：recreate 永远回 target-changed）。配置给的是 remote 名 + refs/heads/<分支>，拼成 <remote>/<分支>。
      // 读 branch.<名>.remote 配置这一条：单条超时 VC_READ_CMD_TIMEOUT_MS，整趟预算 VC_READ_CALL_BUDGET_MS。
      const brCfg: any = await runOne(cwd, ['config', '--get', 'branch.' + branch + '.remote'], VC_READ_CMD_TIMEOUT_MS, 4096, VC_READ_CALL_BUDGET_MS)
      // 读 branch.<名>.merge 配置这一条：与上一条同一档（VC_READ_CMD_TIMEOUT_MS 管单条、VC_READ_CALL_BUDGET_MS 管整趟）。
      const mgCfg: any = await runOne(cwd, ['config', '--get', 'branch.' + branch + '.merge'], VC_READ_CMD_TIMEOUT_MS, 4096, VC_READ_CALL_BUDGET_MS)
      const remoteName: string = (brCfg && brCfg.ok === true) ? String(brCfg.stdout || '').trim() : ''
      const mergeRef: string = (mgCfg && mgCfg.ok === true) ? String(mgCfg.stdout || '').trim() : ''
      const upstream: any = (remoteName !== '' && mergeRef.indexOf('refs/heads/') === 0) ? remoteName + '/' + mergeRef.slice('refs/heads/'.length) : null
      // 「上游被删」要按**远端跟踪引用还在不在**判（#848）：upstream 有配置但 refs/remotes/<upstream> 没了就是 [gone]。
      // 之前这里写成 `upstreamGone: upstream === null`，于是配置还在、远端分支被删的那一档在重算时变成 existing，
      // 与票里的 recreate 对不上 → 永远回 target-changed，第三档根本执行不了（真机证据当场抓到）。
      let gone: boolean = false
      if (upstream !== null) {
        // 核远端跟踪引用在不在这一条：单条超时 VC_READ_CMD_TIMEOUT_MS，整趟预算 VC_READ_CALL_BUDGET_MS。
        const tr: any = await runOne(cwd, ['rev-parse', '--verify', '--quiet', 'refs/remotes/' + upstream], VC_READ_CMD_TIMEOUT_MS, 4096, VC_READ_CALL_BUDGET_MS)
        gone = !(tr && tr.ok === true)
      }
      const pp: any = pushPlanOf({ branch: branch, upstream: upstream, upstreamGone: gone, remotes: remotes, requestedRemote: ticket.target.remote })
      cur.target = pp.ok === true ? pp.plan : null
    }
    return cur
  }
  /** 统一的票据门：回 ok 或回一个「拒绝」信封（并把这个结果按 requestId 记下，重复调用回到同一份）。 */
  async function gateTicket(args: any, op: any): Promise<any> {
    const a: any = args || {}
    const cwd: string = String(a.cwd || '')
    const ticketId: string = String(a.ticketId || '')
    const requestId: string = String(a.requestId || '')
    if (requestId && results.has(requestId)) return { replay: results.get(requestId) }
    // 票据 id 是外部输入：形状先过一道，不合形状当场拒（不去查表、不起任何进程）。
    const idBad: any = idShapeProblem(ticketId)
    if (idBad) return { denied: wfail('args', idBad, writeHintFor(idBad)) }
    const ridBad: any = requestIdProblem(requestId)
    if (ridBad) return { denied: wfail('args', ridBad, writeHintFor(ridBad)) }
    const ticket: any = tickets.get(ticketId) || null
    // 纯判定先行（票在不在 / 动作对不对 / 过期没有）：这一关**不起任何进程**；
    // 口径是「任何写命令之前必须先过票据门」，所以先判完再去做需要起进程的状态比对。
    const pure: any = ticketPureVerdict(ticket, op, now())
    if (pure.ok !== true) return { denied: wfail('args', pure.reason, writeHintFor(pure.reason)) }
    const cur: any = await currentOf(cwd, op, ticket)
    const v: any = ticketVerdict(ticket, now(), cur)
    if (v.ok !== true) {
      const out: any = wfail('other', v.reason, writeHintFor(v.reason))
      remember(requestId, out)
      return { denied: out }
    }
    // 推送是唯一把「名字」拼进 refspec 的一档：动手前让 git 自己再核一次这两个分支名（只读命令，零副作用）。
    if (op === 'push' && ticket.target) {
      for (const name of [ticket.target.localBranch, ticket.target.branch]) {
        const cr: any = await runOne(cwd, checkRefArgs(String(name)), VC_READ_CMD_TIMEOUT_MS, 4096, VC_PRE_PUSH_CHECK_CALL_BUDGET_MS)
        if (!cr || cr.ok !== true) {
          const out: any = wfail('args', 'bad-target', writeHintFor('bad-target'))
          remember(requestId, out)
          return { denied: out }
        }
      }
    }
    return { ticket: ticket, cwd: cwd, requestId: requestId }
  }
  function remember(requestId: any, out: any): any { if (requestId) results.set(requestId, out); if (results.size > 200) { const oldest: any = results.keys().next().value; results.delete(oldest) } return out }
  /** 失败文本：优先读执行层补的 stderr 尾巴（#847 那一族信封新加的字段，名字未定就按 detail 兼容），
   *  退回 stderr、再退回 message —— 分类正则吃的是 git 的原话，读不到就会全落兜底（真缺陷 F1）。 */
  function failText(r: any): string { return String((r && (r.detail || r.stderr || r.message)) || '') }

  /** 暂存（无票）：整文件、可逆、天然幂等。 */
  async function handleGitStage(args: any): Promise<any> {
    const a: any = args || {}
    const cwd: string = String(a.cwd || '')
    const bad: any = pathsProblem(a.paths)
    if (bad) return wfail('args', bad, writeHintFor(bad))
    const paths: string[] = a.paths.map(function (p: any) { return String(p) })
    const r: any = await runOne(cwd, stageArgs(paths), ADD_TIMEOUT_MS, SMALL_LIMIT, ADD_TIMEOUT_MS + VC_WRITE_CALL_MARGIN_MS)
    if (r && r.ok === true) return { ok: true, staged: paths, atMs: now() }
    const text: string = failText(r)
    const reason: any = classifyWriteFailure('commit', r ? r.exitCode : -1, text)
    return wfail((r && r.kind && r.kind !== 'ok') ? r.kind : 'other', reason === 'unknown-write-failure' ? 'unknown-write-failure' : reason, (r && r.message) || '', { transportHint: r && r.hint })
  }
  /** 撤回暂存（无票）：与暂存同一品格 —— 整文件、可逆（点 add 即回来）、重复点同一批没有副作用。
   *  失败分类沿用 'commit' 那一支（与暂存同一套：认得出 nothing-staged，其余如实回兜底带 git 原话）。 */
  async function handleGitUnstage(args: any): Promise<any> {
    const a: any = args || {}
    const cwd: string = String(a.cwd || '')
    const bad: any = pathsProblem(a.paths)
    if (bad) return wfail('args', bad, writeHintFor(bad))
    const paths: string[] = a.paths.map(function (p: any) { return String(p) })
    const r: any = await runOne(cwd, unstageArgs(paths), ADD_TIMEOUT_MS, SMALL_LIMIT, ADD_TIMEOUT_MS + VC_WRITE_CALL_MARGIN_MS)
    if (r && r.ok === true) return { ok: true, unstaged: paths, atMs: now() }
    const text: string = failText(r)
    const reason: any = classifyWriteFailure('commit', r ? r.exitCode : -1, text)
    return wfail((r && r.kind && r.kind !== 'ok') ? r.kind : 'other', reason === 'unknown-write-failure' ? 'unknown-write-failure' : reason, (r && r.message) || '', { transportHint: r && r.hint })
  }
  /** 提交：票据绑 HEAD + 索引指纹；失败后按 HEAD 有没有变说话，绝不自动重试。 */
  async function handleGitCommit(args: any): Promise<any> {
    const a: any = args || {}
    const bad: any = messageProblem(a.message)
    if (bad) return wfail('args', bad, writeHintFor(bad))
    const g: any = await gateTicket(a, 'commit')
    if (g.replay) return g.replay
    if (g.denied) return g.denied
    const headBefore: string = String(g.ticket.headOid || '')
    const r: any = await runOne(g.cwd, commitArgs(String(a.message)), COMMIT_TIMEOUT_MS, SMALL_LIMIT, COMMIT_TIMEOUT_MS + VC_WRITE_CALL_MARGIN_MS)
    const headAfter: string | null = await readHead(g.cwd)
    // 读不到 HEAD 就如实说「结果未知」——绝不在不知道结果时说成功（#841 第三批 ⑤）。
    if (headAfter === null) return remember(g.requestId, wfail('other', 'head-unreadable', writeHintFor('head-unreadable'), { extra: { headBefore: headBefore, headAfter: '' } }))
    if (r && r.ok === true) return remember(g.requestId, { ok: true, committed: true, headBefore: headBefore, headAfter: headAfter || '', atMs: now() })
    // 不幂等：HEAD 变了就如实说「HEAD 已经变了」，既不声称成功也不自动重试。
    if (headAfter && headBefore && headAfter !== headBefore) return remember(g.requestId, wfail('other', 'head-moved', writeHintFor('head-moved'), { extra: { headBefore: headBefore, headAfter: headAfter } }))
    const text: string = failText(r)
    const reason: any = classifyWriteFailure('commit', r ? r.exitCode : -1, text)
    return remember(g.requestId, wfail((r && r.kind && r.kind !== 'ok') ? r.kind : 'other', reason, (r && r.message) || '', { transportHint: r && r.hint, extra: { headBefore: headBefore, headAfter: headAfter || '' } }))
  }
  /** 拉取：只认快进；被拒时那一半 fetch 已经成功，话术说清「远端新提交已经取回来了」。 */
  async function handleGitPull(args: any): Promise<any> {
    const g: any = await gateTicket(args, 'pull')
    if (g.replay) return g.replay
    if (g.denied) return g.denied
    const headBefore: string = String(g.ticket.headOid || '')
    const r: any = await runOne(g.cwd, pullArgs(), PULL_TIMEOUT_MS, SMALL_LIMIT, PULL_TIMEOUT_MS + VC_WRITE_CALL_MARGIN_MS)
    const headAfter: string | null = await readHead(g.cwd)
    if (r && r.ok === true) {
      // 读不到 HEAD 时回 mode:'unknown'，不许回 up-to-date（那是在猜）。
      const mode: string = (headAfter === null) ? 'unknown' : ((headBefore && headAfter !== headBefore) ? 'fast-forward' : 'up-to-date')
      return remember(g.requestId, { ok: true, mode: mode, headBefore: headBefore, headAfter: headAfter || '', upstream: (g.ticket.target && g.ticket.target.upstream) || '', atMs: now() })
    }
    const text: string = failText(r)
    const reason: any = classifyWriteFailure('pull', r ? r.exitCode : -1, text)
    return remember(g.requestId, wfail((r && r.kind && r.kind !== 'ok') ? r.kind : 'other', reason, (r && r.message) || '', { transportHint: r && r.hint, extra: { headBefore: headBefore, headAfter: headAfter || '' } }))
  }
  /** 更新远方记录：只取回远端跟踪引用，不合并、不碰工作树；成功后界面重读首屏拿真数。 */
  async function handleGitFetch(args: any): Promise<any> {
    const g: any = await gateTicket(args, 'fetch')
    if (g.replay) return g.replay
    if (g.denied) return g.denied
    const remote: string = String((g.ticket.target && g.ticket.target.remote) || '')
    if (remote === '' || !REMOTE_PATTERN.test(remote)) return remember(g.requestId, wfail('args', 'bad-target', writeHintFor('bad-target')))
    const r: any = await runOne(g.cwd, fetchArgs(remote), FETCH_TIMEOUT_MS, SMALL_LIMIT, FETCH_TIMEOUT_MS + VC_WRITE_CALL_MARGIN_MS)
    if (r && r.ok === true) return remember(g.requestId, { ok: true, mode: 'fetched', remote: remote, atMs: now() })
    const text: string = failText(r)
    const reason: any = classifyWriteFailure('fetch', r ? r.exitCode : -1, text)
    return remember(g.requestId, wfail((r && r.kind && r.kind !== 'ok') ? r.kind : 'other', reason, (r && r.message) || '', { transportHint: r && r.hint }))
  }
  /** 推送：目标只认票据里那份（执行前重新解析并比对，不一致就拒绝）。 */
  async function handleGitPush(args: any): Promise<any> {
    const g: any = await gateTicket(args, 'push')
    if (g.replay) return g.replay
    if (g.denied) return g.denied
    const plan: any = g.ticket.target
    const r: any = await runOne(g.cwd, pushArgs(plan), PUSH_TIMEOUT_MS, SMALL_LIMIT, PUSH_TIMEOUT_MS + VC_WRITE_CALL_MARGIN_MS)
    if (r && r.ok === true) {
      const text: string = String(r.stdout || '')
      return remember(g.requestId, { ok: true, mode: plan.mode === 'set-upstream' ? 'set-upstream' : 'existing-upstream', remote: plan.remote, branch: plan.branch, upToDate: /up-to-date/i.test(text), atMs: now() })
    }
    const text: string = failText(r)
    const reason: any = classifyWriteFailure('push', r ? r.exitCode : -1, text)
    return remember(g.requestId, wfail((r && r.kind && r.kind !== 'ok') ? r.kind : 'other', reason, (r && r.message) || '', { transportHint: r && r.hint }))
  }
  return { handleGitStage: handleGitStage, handleGitUnstage: handleGitUnstage, handleGitCommit: handleGitCommit, handleGitPull: handleGitPull, handleGitFetch: handleGitFetch, handleGitPush: handleGitPush, indexRecordCount: indexRecordCount }
}
