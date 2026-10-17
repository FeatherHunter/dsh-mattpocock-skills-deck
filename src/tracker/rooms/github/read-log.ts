/**
 * src/tracker/rooms/github/read-log.ts —— 读路径「这一趟没读成」的结论线（#1052）。
 *
 * 为什么要有它：读路径此前只有一层 `gh.exec` 可以看，而那一层只说得清「命令跑了、退出码几」。
 * 有一整类故障它一个字也说不出来：**命令成功了（退出码 0），可这一趟读仍然不成立** ——
 * 回包不是合法 JSON、回包里缺东西、后端说有下一页却不给游标、只拿到前几页就返回、条数被上限
 * 截断、权限问不出来、连第一项门禁都没过（连进程都没起）。这些分支从前经 `fail(...)` 直接返回，
 * 而 `fail` 是纯函数、不记日志，于是事后拿导出包的人在这些路上看到的是「什么都没有」——
 * 分不清「没跑这条路」还是「跑了、折在中间」。
 *
 * 两个事件（都在 #489 附录里登记，字段白名单见 tests/verify-log-fields.ts）：
 *  - `read.degraded`（警告级，常驻）：一条读操作本来能成、这一趟没成，或者成得不完整。一趟一行。
 *    字段 `{op, reason, latencyMs}`；`op` 取 READ_DEGRADED_OPS 里的值，`reason` 取 READ_DEGRADED_REASONS 里的值。
 *    写成警告级的理由：warning 始终落盘，查「这张地图怎么空了」的人不会先打开调试开关。
 *  - `preflight.gate`（警告级，常驻）：探测那三项门禁每过一项各落一行，第三项过了也落一行。
 *    字段 `{gate, reason, latencyMs}`。为什么过了也记：不然「探测全过」在日志里只剩三行长得一样的 gh.exec，
 *    读的人看不出这三行就是探测那三关，也看不出「走到第三关、过了」。失败那一路不落这个，落上面的 read.degraded。
 *
 * 字段只有短枚举与毫秒数，三样东西一个字都不记：**票号、命令原文、上游报错原文**。
 * 改 `reason` 的取值含义就当改事件，照 #489 附录的规矩另立一条，不要就地改意思。
 *
 * 记日志那层壳与耗时归一化搬去了 `src/tracker/kernel/log-emit.ts`（#1182 第 3 件）：三座房的
 * `read-log.ts` 抄的是同一副骨架，留着三份就会有一天给一处补上处理、另两处忘了补。本文件对外
 * 导出的名字、签名与行为一个都没变。
 */

import type { OpContext } from '../../contract/contexts.js'
import { guardEmit, ms } from '../../kernel/log-emit.js'

/** 出问题的读操作。只列读路径这一片真会报降级的几条；写路径与关系边那两片不在本片范围。 */
export const READ_DEGRADED_OPS = Object.freeze([
  'preflight',
  'list',
  'get',
  'counts',
  'listPage',
  'subIssues',
  'permissions',
] as const)

/**
 * 这一趟为什么算「没读成」。格式是「操作名:这一步」，冒号后是短枚举，取值如下：
 *  - `gh`          : 起不了 gh 这一项门禁没过（探测第一关：解析不出可执行文件）
 *  - `auth`        : 登录状态这一项门禁没过（探测第二关）
 *  - `repo-view`   : 从当前目录认不出仓库这一项门禁没过（探测）
 *  - `api`         : 连不上接口这一项门禁没过（探测）
 *  - `repo-ref`    : 入参给的仓库标识缺了或形状不对，连进程都没起
 *  - `gql-err`     : 远端回的 errors 负载非空（判档仍走房间唯一的 ghVerdictOf）
 *  - `json`        : 回包不是合法 JSON
 *  - `shape`       : 回包能解析，但里面缺这一条读必须有的东西
 *  - `total`       : totalCount 缺失或不是非负整数（拒绝猜一个数）
 *  - `cursor`      : 游标已失效，界面据此丢游标重取第一页
 *  - `no-cursor`   : 后端说有下一页，却不给游标（拒绝假装已经翻到底）
 *  - `page-fail`   : 某一页取不回来，拿不全
 *  - `partial`     : 只拿到前几页就按成功返回（拿不全但没失败）
 *  - `truncated`   : 条数到了上限，被截断（拿不全但没失败）
 *  - `degraded`    : 主路不可用，走了降级路（这一趟本身可能仍然成功）
 *  - `transport`   : 命令没跑成（起不了进程、超时、非 0 退出），房间这一层没拿到任何回包
 *  - `empty`       : 回包是空串或字面 null，读不到东西
 *  - `no-fields`   : 回包里没有这一条读必须有的字段
 *  - `unknown`     : 上面都不像（不许拿它当偷懒的默认值，新增分支时回来加取值）
 */
export const READ_DEGRADED_REASONS = Object.freeze([
  'preflight:gh',
  'preflight:auth',
  'preflight:repo-view',
  'preflight:api',
  'list:repo-ref',
  'list:gql-err',
  'list:json',
  'list:shape',
  'list:page-fail',
  'list:partial',
  'list:degraded',
  'list:rest-ref',
  'list:rest-json',
  'list:rest-shape',
  'list:transport',
  'get:repo-ref',
  'get:gql-err',
  'get:json',
  'get:shape',
  'get:degraded',
  'get:rest-json',
  'get:transport',
  'counts:repo-ref',
  'counts:gql-err',
  'counts:json',
  'counts:transport',
  'counts:shape',
  'counts:total',
  'listPage:repo-ref',
  'listPage:gql-err',
  'listPage:json',
  'listPage:transport',
  'listPage:shape',
  'listPage:total',
  'listPage:cursor',
  'listPage:no-cursor',
  'subIssues:repo-ref',
  'subIssues:gql-err',
  'subIssues:json',
  'subIssues:transport',
  'subIssues:shape',
  'subIssues:page-fail',
  'subIssues:notfound',
  'subIssues:truncated',
  'permissions:repo-ref',
  'permissions:api',
  'permissions:empty',
  'permissions:no-fields',
  'permissions:unknown',
] as const)

/** 探测那三项门禁的编号：1 起 gh 可执行、2 登录状态、3 能连上接口（连不上就不知道怎么读）。 */
export const PREFLIGHT_GATES = Object.freeze([1, 2, 3] as const)

/** 三项门禁没过时的原因取值，与 READ_DEGRADED_REASONS 里那三条同一份。门禁编号与原因的对应：
 *  1 起不了 gh（解析不出可执行文件）；2 登录态过不去（`gh auth status` 非 0）；
 *  3 认不出仓库或连不上接口（`gh repo view` 与 `gh api repos/…` 两条都算这一关）。 */
export const PREFLIGHT_GATE_REASONS = Object.freeze({
  1: 'preflight:gh',
  2: 'preflight:auth',
  3: 'preflight:repo-view',
} as const)

/** 门禁编号必须是登记过的那三个之一；不认识的编号不许悄悄记出去。 */
export function isPreflightGate(gate: unknown): boolean {
  return PREFLIGHT_GATES.indexOf(gate as 1) >= 0
}

/** 只读开关的那点最小形状：契约上下文里就有 `isEnabled`，这里不另定义上下文。 */
type LoggerCtx = Pick<OpContext, 'isEnabled' | 'logEvent'>

/**
 * 记一行「这一趟读没读成」（`read.degraded`）。
 *
 * 什么时候调：一条读操作经 `fail(...)` 返回之前，或者「拿不全却按成功返回」那个分支里
 * （`list:partial`、`subIssues:truncated`、走了降级路这三条属于后者）。成功且完整的读不记。
 *
 * @param ctx 单次调用上下文（没有它、或者它没有 `logEvent` 就静默跳过：读路径不许因为日志而失败）
 * @param op 哪条读操作，取 READ_DEGRADED_OPS 里的值
 * @param reason 为什么，取 READ_DEGRADED_REASONS 里的值
 * @param latencyMs 这一笔从入口到这里的耗时（毫秒）
 */
export function emitReadDegraded(ctx: OpContext | null | undefined, op: string, reason: string, latencyMs: unknown): void {
  guardEmit(ctx, (c) => {
    c.logEvent('warn', 'read.degraded', { op: String(op || ''), reason: String(reason || ''), latencyMs: ms(latencyMs), opId: String(c.opId || '') })
  })
}

/**
 * 记一行「探测的那一项门禁过了」（`preflight.gate`）。
 *
 * 为什么过了也要记：三项门禁有三笔 gh 命令，它们各自落的 `gh.exec` 长得一模一样；没有这一行，
 * 「探测走到底了」与「探测连第一关都没过」在日志里都只是「几行 gh.exec」。失败那一路不调这个，
 * 由 `emitReadDegraded(ctx, 'preflight', PREFLIGHT_GATE_REASONS[gate], 耗时)` 记。
 *
 * @param gate 第几项门禁，只认 1、2、3
 * @param latencyMs 这一项从动手到过（或到判定）花了多久
 */
export function emitPreflightGatePass(ctx: OpContext | null | undefined, gate: number, latencyMs: unknown): void {
  guardEmit(ctx, (c) => {
    c.logEvent('warn', 'preflight.gate', { gate: gate, reason: 'ok', latencyMs: ms(latencyMs), opId: String(c.opId || '') })
  }, () => isPreflightGate(gate))
}

export default { emitReadDegraded, emitPreflightGatePass, READ_DEGRADED_OPS, READ_DEGRADED_REASONS, PREFLIGHT_GATE_REASONS }
