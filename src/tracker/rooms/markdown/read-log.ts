/**
 * src/tracker/rooms/markdown/read-log.ts —— 本地 Markdown 房读路径「这一趟没读成」的结论线（#1058）。
 *
 * 为什么要有它：本地这一房读的是工作区里的票文件，读路径此前**一条日志都没有**。票文件读不动时
 * list 静默少一行、计数与翻页整体失败、取单票找不到文件、探测找不到地图文件——这些分支要么直接
 * 返回一个 `fail`（`fail` 是纯函数、不记日志），要么干脆把错误吞掉。事后拿导出包排障的人是同一个
 * 处境：**分不清「没走这条路」还是「走了、折在中间」**——列表少了一行、地图画不出来时，
 * 日志里一句话都没有。
 *
 * 与另两房的关系：事件名沿用全仓已登记的那一条，本房**不新造** `markdown.*` 事件。
 *   - `read.degraded`（告警级，常驻）：一条读操作本来能成、这一趟没成，或者成得不完整。
 *     同一趟里同一个步骤只留一条线（读路径走到坏文件上会连试两处，同一件事不算两件）。
 *     字段 `{op, reason, latencyMs, opId}`；`op` 取 READ_DEGRADED_OPS 里的值，
 *     `reason` 取 READ_DEGRADED_REASONS 里的值（「操作名:这一步」）。
 *     写成告警级的理由：warning 始终落盘，查「这张地图怎么空了 / 票怎么少了」的人不必先开调试开关。
 *     同一形状的另两房实现：`rooms/github/read-log.ts`（#1052 立起）、`rooms/gitlab/read-log.ts`。
 *     三份文件里的 `READ_DEGRADED_OPS` / `READ_DEGRADED_REASONS` 同名同形，取值各房各样。
 *
 * 什么不记（#1058 复核定下）：
 *   - **夹具形态的工作区不记**。没有 `.scratch/`、把 `repo.path` 直接当仓库根，是本房支持的第三种
 *     布局，那里的读是完整的，不是降级；记了就成了每趟都响的心跳。
 *   - **每个文件的名字不记**。reason 只到「哪条操作的哪一步」这一层；要说清是哪几个文件读不动，
 *     那句话在失败结果的 `raw` 里（`counts` / `listPage` 的失败消息会把编号与文件列全）。
 *
 * 字段只有短枚举与毫秒数，三样东西一个字都不记：**票号、文件路径原文、上游报错原文**。
 * 票号会进 reason 吗？不会——reason 只到「哪条操作的哪一步」这一层。
 *
 * 改 `reason` 取值的含义就当改事件，照 #489 附录的规矩另立一条，不要就地改意思 ——
 * 事后拿导出包的人按取值查文档，就地改意思等于把旧日志的解释一并改掉。
 *
 * 调用点三条纪律（照 #1058 的实现约定）：
 *   1）只在**这一趟没成或成得不完整**的分支上记；一趟干净的读一行都不记（日志不许当心跳刷屏）。
 *   2）记日志这件事永远不许改变读的结果：本文件整段包 try/catch，没有上下文就静默跳过，
 *      调用点也不许拿它的返回值做判断。
 *   3）耗时从**这条操作的入口**算起（`Date.now() - t0`），不是从分支那一刻算起 ——
 *      事后看「这一趟花了多久」才对得上号。
 */

import type { OpContext } from '../../contract/contexts.js'

/**
 * 会报降级的读操作。只列本房读路径真会报降级的几条；写路径（#1059）与关系边（#1060）不在本片范围。
 * `preflight` 是模块入口那一关：这个工作区能不能用本地 Markdown 当票仓。
 */
export const READ_DEGRADED_OPS = Object.freeze([
  'preflight',
  'list',
  'get',
  'counts',
  'listPage',
] as const)

/**
 * 这一趟为什么算「没读成」。格式是「操作名:这一步」，冒号后是短枚举，取值如下：
 *  - `no-map`          : 三个候选位置都没找到 map.md（探测那一关没过）
 *  - `ticket-read-fail`: 某张票文件读不动（权限不足 / 读到时已被删 / 被锁住）
 *  - `map-read-fail`   : 地图文件读不动，这一趟没有地图容器行
 *  - `read-fail`       : 有文件读不动，整条操作如实失败（拒绝回一个偏小的数）：票文件与地图文件都在这一档
 *  - `fs-fail`         : 其余读写故障，整条操作如实失败：目录列不出来、定位这一路抛上来、探测中途出错，
 *                        以及取单票时「不是找不到、也不是编号撞车」的那些档位
 *  - `cursor`          : 翻页游标不是一个十进制下标，跟现在这份数据对不上
 *  - `cursor-stale`    : 翻页游标越过了现在这批票的行数
 *  - `no-key`          : 取单票时没给编号，连文件都没找过
 *  - `notfound`        : 这个编号找不到对应的票文件 / 找不到地图文件
 *
 * 只记「读不动却照旧回成功」那几种细步骤（票文件读不动被静默跳过、地图行读不动），
 * 以及每条操作整条失败时的一行粗结论。为什么不给失败再细分步骤：**整条失败时，失败结果本身
 * 已经把具体原因（哪个文件、哪一档错）写全了**，日志只需回答「这一趟走到哪一步停的」；
 * 反过来，「读不动却当成功回」的那些分支没有任何别的证据，日志是唯一一条线，才要写到具体步骤。
 *
 * 表里每一条都有落点、也有门禁用例（`tests/verify-1058-markdown-read-log.ts` 逐条走到），
 * 新增取值时回来补这两样：先加进这张表，再加一条会走到它的用例。
 */
export const READ_DEGRADED_REASONS = Object.freeze([
  'preflight:no-map',
  'preflight:fs-fail',
  'list:ticket-read-fail',
  'list:map-read-fail',
  'list:fs-fail',
  'counts:read-fail',
  'counts:map-read-fail',
  'counts:fs-fail',
  'listPage:read-fail',
  'listPage:map-read-fail',
  'listPage:cursor',
  'listPage:cursor-stale',
  'listPage:fs-fail',
  'get:no-key',
  'get:notfound',
  'get:read-fail',
  'get:fs-fail',
] as const)

/** 只读上下文里那点最小形状：契约上下文自带 `logEvent` 与 `opId`，这里不另定义上下文。 */
type LoggerCtx = Pick<OpContext, 'logEvent' | 'opId'>

/** 让「这一笔花了多久」永远是一个非负整数：负数、小数、非数字都收敛到 0。 */
function ms(latencyMs: unknown): number {
  const n = typeof latencyMs === 'number' ? latencyMs : Number(latencyMs)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

/**
 * 记一行「这一趟读没读成」（`read.degraded`）。
 *
 * 什么时候调：一条读操作经 `fail(...)` 返回之前，或者「读不动却照旧返回」那个分支里
 * （list 的静默跳过、地图行读不动这两条属于后者）。成功且完整的读不调。
 *
 * @param ctx 单次调用上下文（没有它、或者它没有 `logEvent` 就静默跳过：读路径不许因为日志而失败）
 * @param op 哪条读操作，取 READ_DEGRADED_OPS 里的值
 * @param reason 为什么，取 READ_DEGRADED_REASONS 里的值
 * @param latencyMs 这一笔从这条操作的入口到这里的耗时（毫秒）
 */
export function emitReadDegraded(ctx: LoggerCtx | null | undefined, op: string, reason: string, latencyMs: unknown): void {
  try {
    if (!ctx || typeof ctx.logEvent !== 'function') return
    ctx.logEvent('warn', 'read.degraded', { op: String(op || ''), reason: String(reason || ''), latencyMs: ms(latencyMs), opId: String(ctx.opId || '') })
  } catch {}
}

export default { emitReadDegraded, READ_DEGRADED_OPS, READ_DEGRADED_REASONS }
