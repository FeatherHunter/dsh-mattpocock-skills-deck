/**
 * src/tracker/rooms/gitlab/read-log.ts —— GitLab 房读路径「这一趟没读成」的结论线。
 *
 * ── 为什么这一房今天才有它 ──────────────────────────────────────────────────────
 * GitHub 房在 #1052 就立起了这条线（`src/tracker/rooms/github/read-log.ts`），GitLab 房当时
 * 只有 13 条操作、读路径能出问题的分支也少，一直没跟。地图 10（#1062）把这一房补到 25 条能力，
 * 一次多出五条读操作（计数、分页、标签清单、子票、仓库权限）与三条单点读（当前登录人、
 * 仓库坐标、探测），若是继续不记，事后拿导出包的人是同一个处境：**命令成功了（退出码 0），
 * 可这一趟读仍然不成立** —— 回包不是合法 JSON、回包里缺这一条读必须有的东西、数拿不到、
 * 分页游标对不上、某一页没取回来。这些分支经 `fail(...)` 直接返回，而 `fail` 是纯函数、不记日志，
 * 于是故障现场在日志里是「什么都没有」，分不清「没跑这条路」还是「跑了、折在中间」。
 *
 * ── 事件名沿用全仓已登记的那两个，不新开 ────────────────────────────────────────
 * 本文件落的是**已有事件**：常驻 #108 `read.degraded` 与常驻 #109 `preflight.gate`
 * （登记见 `research/489-appendix.md` 第 1 章，字段白名单见 `tests/verify-log-fields.js`）。
 * 刻意不新开一条 `glab.*`：新事件要动附录对照表与三份门禁的字面，那是跨房的账（#1063 定的边界
 * 是只动本房）。本条只做「新增落点」，字段形状与 GitHub 房逐格相同，门禁照旧放行。
 *
 * 字段只有短枚举与毫秒数，**票号、命令原文、上游报错原文、仓库地址原文一个字都不记**：
 *  - `read.degraded`（警告级，常驻）：`{op, reason, latencyMs, opId}`。一趟一行。
 *    `op` 取 READ_DEGRADED_OPS 里的值，`reason` 取 READ_DEGRADED_REASONS 里的值。
 *    写成警告级，是因为 warning 始终落盘：查「这张地图怎么空了」的人不会先打开调试开关。
 *  - `preflight.gate`（警告级，常驻）：`{gate, reason, latencyMs, opId}`。探测那几项门禁
 *    每过一项落一行，过了也落 —— 不然「探测走到底了」与「第一关就没过」在日志里都只是
 *    几行长得一样的 glab 调用。
 *
 * 改 `reason` 取值的含义就当改事件，照 #489 附录的规矩另立一条，不要就地改意思。
 */

import type { OpContext } from '../../contract/contexts.js'

/**
 * 会报降级的读操作。只列本房读路径真会报降级的几条；写路径不在本片范围。
 *
 * `matches` 不是契约里的操作，是本房「这个工作区是不是 GitLab」那一次识别（`index.ts` 的
 * `matches`）：它同样是读——读 `.git/config`、读 `docs/agents/issue-tracker.md`、问一次 git remote。
 * 识别失败今天在外面只剩注册表那一行「没认出来」，所以这一趟的失败原因必须从房里报出来
 * （#1130）。`preflight` 也是同类：不是契约操作，是模块自己的探测钩子。
 */
export const READ_DEGRADED_OPS = Object.freeze([
  'matches',
  'preflight',
  'list',
  'get',
  'counts',
  'listPage',
  'labels',
  'subIssues',
  'permissions',
  'currentUser',
  'repoKey',
] as const)

/**
 * 这一趟为什么算「没读成」。格式是「操作名:这一步」，冒号后是短枚举：
 *  - `glab`       : 起不了 glab 这一项门禁没过（解析不出可执行文件）
 *  - `auth`       : 登录状态这一项门禁没过
 *  - `repo-view`  : 从当前目录认不出仓库这一项门禁没过
 *  - `api`        : 连不上接口这一项门禁没过
 *  - `repo-ref`   : 入参给的仓库标识缺了或形状不对，连进程都没起
 *  - `transport`  : 命令没跑成（起不了进程、超时、非 0 退出），房间这层没拿到任何回包
 *  - `json`       : 回包不是合法 JSON
 *  - `shape`      : 回包能解析，但里面缺这一条读必须有的东西
 *  - `empty`      : 回包是空串或字面 null，读不到东西
 *  - `no-fields`  : 回包里没有这一条读必须有的字段
 *  - `stat`       : 计数那一笔的三个数缺了或不是非负整数（拒绝猜一个数）
 *  - `total`      : 分页要的总数缺失或不是非负整数
 *  - `cursor`     : 游标已失效，界面据此丢游标重取第一页
 *  - `page-fail`  : 某一页取不回来，拿不全
 *  - `partial`    : 只拿到一部分就按成功返回（拿不全但没失败）
 *  - `truncated`  : 条数到了上限，被截断（拿不全但没失败）
 *  - `notfound`   : 远端明确说这张票 / 这个仓库不在
 *  - `fs-unavailable` : 连文件服务都拿不到（没有 fs、没有 platform，或它没长 resolve+readText 这两件），
 *                       识别这一趟根本没跑起来 —— 这是故障，不是「这个仓库不是 GitLab」
 *  - `git-config` : 读工作区里的 `.git/config` 这一步没给出答案（文件不在，或者读这一下出了问题）
 *  - `tracker-doc`: 读工作区里的 `docs/agents/issue-tracker.md` 这一步没给出答案（同上）
 *  - `unknown`    : 上面都不像（不许拿它当偷懒的默认值，新增分支时回来加取值）
 */
export const READ_DEGRADED_REASONS = Object.freeze([
  'matches:fs-unavailable',
  'matches:git-config',
  'matches:tracker-doc',
  'matches:unknown',
  'preflight:glab',
  'preflight:auth',
  'preflight:repo-view',
  'preflight:api',
  'list:repo-ref',
  'list:transport',
  'list:json',
  'list:shape',
  'get:repo-ref',
  'get:transport',
  'get:json',
  'get:shape',
  'counts:repo-ref',
  'counts:transport',
  'counts:json',
  'counts:shape',
  'counts:stat',
  'listPage:repo-ref',
  'listPage:transport',
  'listPage:json',
  'listPage:shape',
  'listPage:total',
  'listPage:cursor',
  'labels:repo-ref',
  'labels:transport',
  'labels:json',
  'labels:shape',
  'labels:partial',
  'subIssues:repo-ref',
  'subIssues:transport',
  'subIssues:json',
  'subIssues:shape',
  'subIssues:notfound',
  'subIssues:page-fail',
  'subIssues:truncated',
  'permissions:repo-ref',
  'permissions:transport',
  'permissions:json',
  'permissions:empty',
  'permissions:no-fields',
  'currentUser:repo-ref',
  'currentUser:transport',
  'currentUser:json',
  'currentUser:shape',
  'repoKey:notfound',
  'repoKey:unknown',
] as const)

/** 探测那几项门禁的编号：1 起 glab 可执行、2 登录状态、3 认得出仓库且连得上接口。 */
export const PREFLIGHT_GATES = Object.freeze([1, 2, 3] as const)

/** 三项门禁没过时的原因取值，与 READ_DEGRADED_REASONS 里那三条同一份。 */
export const PREFLIGHT_GATE_REASONS = Object.freeze({
  1: 'preflight:glab',
  2: 'preflight:auth',
  3: 'preflight:repo-view',
} as const)

/** 门禁编号必须是登记过的那三个之一；不认识的编号不许悄悄记出去。 */
export function isPreflightGate(gate: unknown): boolean {
  return PREFLIGHT_GATES.indexOf(gate as 1) >= 0
}

/** 只读开关的那点最小形状：契约上下文里就有 `isEnabled` 与 `logEvent`，这里不另定义上下文。 */
type LoggerCtx = Pick<OpContext, 'isEnabled' | 'logEvent'>

/** 让「这一笔花了多久」永远是一个非负整数：负数、小数、非数字都收敛到 0。 */
function ms(latencyMs: unknown): number {
  const n = typeof latencyMs === 'number' ? latencyMs : Number(latencyMs)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

/**
 * 记一行「这一趟读没读成」（`read.degraded`）。
 *
 * 什么时候调：一条读操作经 `fail(...)` 返回之前，或者「拿不全却按成功返回」那个分支里。
 * 成功且完整的读不记。
 *
 * 识别那一条（`op: 'matches'`）另有一套判据：**一层读成功了不记**（读到了内容、只是内容里没有
 * `gitlab` 这个词，那是正常的否定结论）；**这一层没能给出答案才记**（文件不在、读不出来、
 * 或者干脆没有文件服务）。所以一个规规矩矩的仓库（有 `.git/config`、有 `docs/agents/issue-tracker.md`）
 * 走这一趟一行都不会多出来。
 *
 * @param ctx 单次调用上下文（没有它、或者它没有 `logEvent` 就静默跳过：读路径不许因为日志而失败）
 * @param op 哪条读操作，取 READ_DEGRADED_OPS 里的值
 * @param reason 为什么，取 READ_DEGRADED_REASONS 里的值
 * @param latencyMs 这一笔从入口到这里的耗时（毫秒）
 */
export function emitReadDegraded(
  ctx: OpContext | null | undefined,
  op: string,
  reason: string,
  latencyMs: unknown,
): void {
  try {
    if (!ctx || typeof ctx.logEvent !== 'function') return
    ctx.logEvent('warn', 'read.degraded', {
      op: String(op || ''),
      reason: String(reason || ''),
      latencyMs: ms(latencyMs),
      opId: String(ctx.opId || ''),
    })
  } catch {
    // 读路径不许因为日志写不出去而失败。
  }
}

/**
 * 记一行「探测的那一项门禁过了」（`preflight.gate`）。
 *
 * 为什么过了也要记：三项门禁会落几行长得一样的 glab 调用；没有这一行，
 * 「探测走到底了」与「探测连第一关都没过」在日志里都只是「几行命令」。
 *
 * @param ctx 单次调用上下文（缺席静默跳过）
 * @param gate 第几项门禁，只认 1、2、3
 * @param latencyMs 这一项从动手到过（或到判定）花了多久
 */
export function emitPreflightGatePass(
  ctx: OpContext | null | undefined,
  gate: number,
  latencyMs: unknown,
): void {
  try {
    if (!ctx || typeof ctx.logEvent !== 'function') return
    if (!isPreflightGate(gate)) return
    ctx.logEvent('warn', 'preflight.gate', {
      gate: gate,
      reason: 'ok',
      latencyMs: ms(latencyMs),
      opId: String(ctx.opId || ''),
    })
  } catch {
    // 同上：日志写不出去不影响探测结论。
  }
}

/**
 * 记一行「仓库坐标这一趟从第几层认出来的」（`repo.resolve.tier`）。
 *
 * 这是常驻 #4，GitHub 房的 `getRepoKey` 用它，本房的同一条能力也照同一套落点记，
 * 于是「三层兜底到底走到第几层成功」在两个远端后端上是同一个问法、同一个答案位置。
 * 只记层号、成没成、耗时；仓库地址原文一个字都不记。
 *
 * @param ctx 单次调用上下文（缺席静默跳过）
 * @param tier 第几层（1 问 git remote、2 直读 .git/config、3 问 glab）
 * @param ok 这一层认出来了没有
 * @param startedAt 这一笔的起点（`Date.now()`）
 */
export function emitRepoTier(
  ctx: OpContext | null | undefined,
  tier: number,
  ok: boolean,
  startedAt: number,
): void {
  try {
    if (!ctx || typeof ctx.logEvent !== 'function') return
    ctx.logEvent('info', 'repo.resolve.tier', {
      tier: tier,
      ok: ok === true,
      latencyMs: ms(Date.now() - startedAt),
    })
  } catch {
    // 同上。
  }
}

export default {
  emitReadDegraded,
  emitPreflightGatePass,
  emitRepoTier,
  READ_DEGRADED_OPS,
  READ_DEGRADED_REASONS,
  PREFLIGHT_GATES,
  PREFLIGHT_GATE_REASONS,
}
