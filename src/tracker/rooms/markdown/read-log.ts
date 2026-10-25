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
 * 记日志那层壳与耗时归一化搬去了 `src/tracker/kernel/log-emit.ts`（#1182 第 3 件）：三座房的
 * `read-log.ts` 抄的是同一副骨架，留着三份就会有一天给一处补上处理、另两处忘了补。本文件对外
 * 导出的名字、签名与行为一个都没变。
 *
 * 调用点三条纪律（照 #1058 的实现约定）：
 *   1）只在**这一趟没成或成得不完整**的分支上记；一趟干净的读一行都不记（日志不许当心跳刷屏）。
 *   2）记日志这件事永远不许改变读的结果：本文件整段包 try/catch，没有上下文就静默跳过，
 *      调用点也不许拿它的返回值做判断。
 *   3）耗时从**这条操作的入口**算起（`Date.now() - t0`），不是从分支那一刻算起 ——
 *      事后看「这一趟花了多久」才对得上号。
 */

import type { OpContext } from '../../contract/contexts.js'
import { guardEmit, ms } from '../../kernel/log-emit.js'

/**
 * 会报降级的读操作。只列本房读路径真会报降级的几条；写路径（#1059）与关系边（#1060）不在本片范围。
 * `preflight` 是模块入口那一关：这个工作区能不能用本地 Markdown 当票仓。
 *
 * `matches`（#1182 第 4 件补）与 GitLab 房的同一条同名同义：它不是契约操作，是本房「这个工作区
 * 是不是本地 Markdown」那一次识别（`index.ts` 的 `matches`）—— 读 `.scratch/map.md`、
 * 读 `docs/agents/issue-tracker.md`、看 `.scratch` 底下有没有地图文件，全是读。
 * 从前这条路的失败被一个裸 catch 吞掉，外面只剩注册表那句「没认出来」，所以这一趟的失败原因
 * 必须从房里报出来（GitLab 房在 #1130 已经这么做并关票）。
 */
export const READ_DEGRADED_OPS = Object.freeze([
  'matches',
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
 *  - `map-read-fail`   : 容器文件（map.md，或 #1488 起的 spec.md）读不动，这一趟没有那个容器行
 *  - `read-fail`       : 有文件读不动，整条操作如实失败（拒绝回一个偏小的数）：票文件与地图文件都在这一档
 *  - `fs-fail`         : 其余读写故障，整条操作如实失败：目录列不出来、定位这一路抛上来、探测中途出错，
 *                        以及取单票时「不是找不到、也不是编号撞车」的那些档位
 *  - `cursor`          : 翻页游标不是一个十进制下标，跟现在这份数据对不上
 *  - `cursor-stale`    : 翻页游标越过了现在这批票的行数
 *  - `no-key`          : 取单票时没给编号，连文件都没找过
 *  - `notfound`        : 这个编号找不到对应的票文件 / 找不到地图文件
 *
 * 识别那一条（`op: 'matches'`，取值见下面三条 `matches:*`）与别的操作**判据不一样**：
 * 别的操作是「读不动才记」，而这一条是「哪一层没能给出答案才记」—— 一层读成功了不记
 * （读到了内容、只是内容里没写 Local Markdown，那是正常的否定结论：GitHub 工作区、GitLab
 * 工作区走这一趟都是一个字都不该多）。与 GitLab 房同名取值同一套口径。
 *  - `matches:fs-unavailable`: 分不出平台对象（`ctx.platform.path` 与 `ctx.path` 都不是个能用的东西，
 *                          也不是 win32），连候选路径都拼不出来 —— 识别这一趟根本没跑起来。这是故障，
 *                          不是「这个工作区不是本地 Markdown」
 *  - `matches:tracker-doc`: 声明文件 `docs/agents/issue-tracker.md` 在，可两路读法都读不动（或者
 *                          连它在不在都问不出来）：这一层没能给出答案
 *  - `matches:unknown`     : 上面两处之外整段抛了（平台对象形状怪、路径拼接抛错这类）；不许拿它当
 *                          偷懒的默认值，新增分支时回来加取值
 *
 * 为什么没有 `matches:no-map`（候选位置都没找到地图文件）：那恰恰是**每一个不是本地 Markdown 的
 * 工作区都会出现的正常答案** —— 记它等于给每一次 GitHub、GitLab 工作区探测都加一行噪音；
 * 而且它与「读了声明文件、里面没写 Local Markdown」那条不记的判据直接打架。所以「没找到地图」
 * 本身不记，只有后面那一层（声明文件）也读不动时才留下痕迹。GitLab 房同理不记 `.git/config`
 * 里没写 gitlab 这一条。
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
  'matches:fs-unavailable',
  'matches:tracker-doc',
  'matches:unknown',
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
  // #1488 兼容与退化（都是「读成功、路径不常规」，不是故障；结果照常返回）：
  //  - `legacy-root` : 这张票来自旧版工作区根 `<cwd>/issues/`（#1486 之前的落点）。读到它的目的是排查
  //                    「为什么这张票不在 .scratch 下」以及「新版发现口是不是漏了这个目录」。
  //  - `dup-number`  : 目录里编号重复（两个 01-*.md）或文件名没有编号，这张票用的是退化身份
  //                    （`目录/编号-文件名`）。读到它的目的是把「界面上这个怪名字是从哪来的」对上盘面。
  //  两件事都只在 list 与 get 两条读路径上记；counts / listPage 只是同一份枚举的消费者，记了反而重复。
  'list:legacy-root',
  'get:legacy-root',
  'list:dup-number',
  'get:dup-number',
  // #1499 版本号不认得（都是「读成功、但按旧口径解析」，不是故障；结果照常返回）：
  //  - `bad-format` : 文件头写了 DSH-FORMAT，但版本号不在 SUPPORTED_DSH_FORMATS 里
  //                    （例如手写的 `md-v2`）。读路径今天只能按 `md-v1` 解析，
  //                    不记这一行，事后就分不清「按新格式读对了」还是「按旧格式误读了」。
  //  两件事都只在 list 与 get 两条读路径上记；counts / listPage 只是同一份枚举的消费者，记了反而重复。
  'list:bad-format',
  'get:bad-format',
] as const)

/** 只读上下文里那点最小形状：契约上下文自带 `logEvent` 与 `opId`，这里不另定义上下文。 */
type LoggerCtx = Pick<OpContext, 'logEvent' | 'opId'>

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
  guardEmit(ctx, (c) => {
    c.logEvent('warn', 'read.degraded', {
      op: String(op || ''),
      reason: String(reason || ''),
      latencyMs: ms(latencyMs),
      opId: String(c.opId || ''),
    })
  })
}

export default { emitReadDegraded, READ_DEGRADED_OPS, READ_DEGRADED_REASONS }
