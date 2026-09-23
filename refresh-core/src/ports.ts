/**
 * refresh-core/src/ports.ts —— 新刷新机制的插口形状（只放形状，不放运行时代码）
 *
 * 这份文件回答的是「核心与外面之间传的是什么东西」，所以只写形状：一笔出站调用属于哪一类、
 * 闸当前在哪个档位、一次裁决的结论长什么样、工具调用前的花费预估长什么样。
 * 形态照 label-color-core/src/ports.ts 与 update-core/src/ports.ts：先写这份形状，再写实现；
 * 插口由核心定，跑腿的活全在外面。
 *
 * 这里明确不写的两样东西（免得后来人到处找）：
 * 1. 数字。探测几秒、每小时能花多少点、AI 工具那一档的两组硬顶——唯一真源是 budget.ts，
 *    本文件一个数字都不抄，避免同一个额度写在两处。
 * 2. 裁决规则与原因代号表。什么情况下放行、什么时候降级、什么时候推迟，归 policy.ts（后面的票）；
 *    这里只留 reason 这个字段，不抄一张取值表。
 *
 * 产物 src/shared/refresh/ports.js 是一个只剩模块标识的空壳：类型在转译时被擦掉，
 * 现在没有任何运行时代码 import 它。它保留着有三条理由（与两份先例一致）：形态一致比省一个文件重要；
 * 核心长大后要有落点；门禁靠它确认「插口确实由核心定」这条纪律。
 */

/**
 * 一笔出站调用的来源类别。闸按类别决定「能不能花、花多少」。
 *
 * 四类的差别不是程度差别，而是「谁在做事」的差别：
 * - 'user-action'：人在界面上亲手做的（点刷新、点开票、翻页、发评论、改标签、建票）。
 *   永远是放行——人的动作不该被算法拦住，红档也照做。
 * - 'ai-tool'：AI 通过我们提供的那批工具发起的调用。单列一档：不享受「永不降档」，
 *   也不按「后台超出即推迟」处理，而是有自己的单次与每小时硬顶（数字见 budget.ts），
 *   超顶直接拒绝并明说用了多少、顶在哪。
 * - 'lifecycle'：生命周期动作，典型是「切进一个工作区」的那一次。额度够就放行；
 *   不够时降级为「只出缓存 + 只探测不重建」，界面照样毫秒级铺满。
 * - 'background'：后台的定时活（变化探测、检查链、命名守护）。额度不够就推迟，不该失败——
 *   推迟与失败的差别见下面 Verdict。
 */
export type RequestCategory = 'user-action' | 'ai-tool' | 'lifecycle' | 'background'

/**
 * 闸当前在哪个档位。档位由闸按「用掉的额度占可用户额度的比例」自己算出来，
 * 不需要人干预，也不需要重启；阈值与算式在 budget.ts（tierFor）。
 *
 * - 'green'：用掉不足六成，按正常节拍跑。
 * - 'yellow'：六成到八成五，活跃探测放慢、重建要等一段最短间隔、后台刷新全停。
 * - 'red'：八成五以上，或这一小时里已经撞过一次限流：自动刷新全停，只留用户动作。
 */
export type QuotaTier = 'green' | 'yellow' | 'red'

/**
 * 裁决：这一笔请求是被放行、被降级，还是被推迟。
 *
 * 三种都不是「失败」——降级与推迟是预算不够时的正常出路，失败才是失败
 * （失败与原因分档归 tracker 契约层的错误档，不在核心这里）。
 * - 'allow'：按原样执行。
 * - 'degrade'：执行，但只做降级后的那一部分（例如只出缓存、只探测不重建）。
 * - 'defer'：这次先不做。推迟不等于排队堆积：同一个工作区在推迟队列里只保留最后一次请求
 *   （多次合并成一次），并且带过期时间（数字见 budget.ts 的 DEFER_EXPIRY_MS），
 *   过期直接丢，不排队、不堆积、不重试。
 */
export type Verdict = 'allow' | 'degrade' | 'defer'

/**
 * 一次裁决的完整结果：结论加一句「为什么」。
 *
 * reason 是给人看的原因代号（例如「后台档，额度不足」），取值表由 policy.ts 定；
 * 账本里 refresh.decide 那条事件记的就是这里的结论与原因，所以两边的词要对得上，
 * 但词表不在这份形状文件里。
 */
export interface VerdictResult {
  verdict: Verdict
  reason: string
}

/**
 * 工具调用前的花费预估，同时也是「这一笔要不要分片」的建议。
 *
 * 批量工具（建地图、批量建票、批量建边）在真正动手之前先算一次，把这份结果写进返回：
 * 超顶就当场拒绝并说清用了多少，绝不先花后说。字段本身是数字与判断，怎么算归 tool-cost.ts，
 * 允许的上限与分片大小归 budget.ts。
 */
export interface ToolCostEstimate {
  /** 预计花掉的 GraphQL 点数。 */
  points: number
  /** 预计发出的出站 HTTP 请求条数；分页、重试、兜底链都要算进来，不能只算「逻辑上一次调用」。 */
  requests: number
  /** 点数与请求数都在单次硬顶之内（上限见 budget.ts 的 AI_TOOL_MAX_POINTS_PER_CALL 与 AI_TOOL_MAX_REQUESTS_PER_CALL）。 */
  callWithinCaps: boolean
  /** 把这一笔算进本小时的累计之后，仍在每小时硬顶之内（上限见 budget.ts 的 AI_TOOL_MAX_POINTS_PER_HOUR 与 AI_TOOL_MAX_REQUESTS_PER_HOUR）。 */
  hourWithinCaps: boolean
  /** 建议分成几次调用；不用分片时是 1（算法见 budget.ts 的 shardPlan）。 */
  shards: number
  /** 每一片最多处理几张；永远不会超过每片的上限（budget.ts 的 AI_TOOL_SHARD_SIZE）。 */
  perShard: number
}

/**
 * 一次工具调用事件的形态（写事件订阅要认的那些，依据 research/dsh-platform-facts-2026-09-23.md 第一节）。
 *
 * 分两类：一类是「调用已经收尾」的结果形态，只有它们能回答「成功了吗」；另一类是「调用刚开始」，
 * 没有任何成功与否的信息。运行时事件 `tools/result` 与前三条会话事件走的是同一条收尾路径：
 * - 'tools/result'：Cordis 运行时事件（不是会话事件），原生调用与 ptc 内层派发都会到它；
 * - 'tool/result'：会话事件里的工具结果；
 * - 'tool/ptc-dispatch' / 'tool/ptc-dispatch-start'：ptc 预设下内层派发的收尾与开始；
 * - 'tool/code-dispatch' / 'tool/code-dispatch-start'：同一件事在磁盘格式 v2→v3 迁移里的旧名字；
 * - 'tool/call'：会话事件里的工具调用刚开始。
 */
export type EventShape =
  | 'tools/result'
  | 'tool/result'
  | 'tool/call'
  | 'tool/ptc-dispatch'
  | 'tool/ptc-dispatch-start'
  | 'tool/code-dispatch'
  | 'tool/code-dispatch-start'

/**
 * 写事件的三档判定。
 * - 'write-confirmed'：确定是写，且票号说得出来 → 立刻补那一行；
 * - 'probe-now'：可疑（脚本、联网抓取、认不出的远端工具）或票号说不出来 → 立刻探一次，变了才补；
 * - 'default-tick'：其余（已知只读、调用没成功）→ 不额外做任何事，等兜底节拍。
 */
export type DetectTier = 'write-confirmed' | 'probe-now' | 'default-tick'

/**
 * 一次工具调用的判定输入。
 *
 * `command` 是**已经解析好的命令行原文**，只在这一层做瞬时匹配，绝不进日志、不落盘、不回界面；
 * `args` 是结构化参数（`tools/result` 的 `exec.arguments` 已经是对象，不必再解析）；
 * `succeeded` 说这次调用成功了没有，只认成功（结构化退出码说了算）。
 */
export interface DetectInput {
  /** 事件形态（见 EventShape）。 */
  shape: EventShape | string
  /** 工具名（Windows 上执行命令的那个叫 `pwsh`）。 */
  tool: string
  /** 解析后的命令行；没有就给 null。 */
  command?: string | null
  /** 结构化参数对象；没有就给 null。 */
  args?: Record<string, unknown> | null
  /** 这次调用成功了没有：只有 true 才算成功。 */
  succeeded?: boolean | null
}

/**
 * 一次工具调用的判定结果。**里面没有命令原文**——只有档位、票号与原因代号。
 * `ticket` 为 null 表示「未知」：认不出就说认不出，绝不猜。
 */
export interface DetectResult {
  tier: DetectTier
  /** 认出来的票号（数字串，如 '12'）；认不出就是 null。 */
  ticket: string | null
  /** 原因代号，取值表在 write-detect.ts 的 DETECT_REASONS。 */
  reason: string
}

/**
 * 判定之后要做的动作。
 * - 'patch-now'：只补票号指的那一行；
 * - 'probe-now'：立刻发一次变化探测（票号未知时也走这一档）；
 * - 'wait-tick'：什么都不额外做，等兜底探测节拍。
 * `waitMs` 是「同一工作区里合并窗口还剩多久」：事件触发的取数与写入触发的取数共用一个窗口。
 */
export interface EventAction {
  action: 'patch-now' | 'probe-now' | 'wait-tick'
  ticket: string | null
  waitMs: number
  mergeWindowMs: number
}

/** 判定要用到的两个数字，由调用方从 budget.ts 取好注入（本文件与 write-detect.ts 都不写数字）。 */
export interface WriteDetectLimits {
  /** 同一工作区里写事件触发的取数合并窗口（budget.ts 的 PATCH_MERGE_WINDOW_MS）。 */
  mergeWindowMs: number
  /** 认不出写没写时退回的兜底探测节拍（budget.ts 的 PROBE_INTERVAL_MS）。 */
  probeIntervalMs: number
}

// ---------- 检查链的退避与缓存（#709「检查链与命名守护改事件驱动」加的第三组形状） ----------
//
// backoff.ts 只算「这一刻该等多久」，数字一律由调用方从 budget.ts 取好、装进 BackoffLimits 传进来。
// 这样做有两个原因：数字的唯一真源是 budget.ts（同一份额度不许写在两处）；产物文件之间同层互引
// 会被 tests/verify-no-same-layer-import.js 判红，所以 backoff.ts 连预算产物的常量也不能 import。

/**
 * 退避与缓存寿命这一组数字的容器，由调用方从 budget.ts 取好再传进来。
 * 四个字段分别对应 budget.ts 的 CHAIN_BACKOFF_MS、CHAIN_ALL_GREEN_TTL_MS、PREFLIGHT_TTL_MS、
 * PREFLIGHT_RETRY_AFTER_FAILURE。
 */
export interface BackoffLimits {
  /** 退避序列，毫秒，从快到慢排（8 秒 → 30 秒 → 2 分钟 → 5 分钟）。 */
  backoffMs: readonly number[]
  /** 检查链全绿之后，这份结论还能用多久（毫秒）。 */
  allGreenTtlMs: number
  /** 环境预检（登录态、仓库可达）成功之后，这份结论还能用多久（毫秒）。 */
  preflightTtlMs: number
  /** 环境预检失败之后，一次求值里还允许立刻再试几次。 */
  preflightRetryAfterFailure: number
}

/**
 * 检查链的退避态：现在退到第几档、上一次求值是什么时候、那一次是不是全绿。
 *
 * 只有这三个字段，而且只存在内存里：这份状态丢了最多多查一次，不值得为它写盘。
 * 它故意不记「下次什么时候再来」——下一次只可能由四种事件带起来（切进工作区、点「重新检查」、
 * 做完可能改变它的动作、写入成功之后），没有任何自续定时器。
 */
export interface ChainBackoffState {
  /** 当前在第几档，0 是第一档（最快的 8 秒）。 */
  step: number
  /** 上一次求值的时刻（毫秒时间戳）；从没求过值是 0。 */
  evaluatedAtMs: number
  /** 上一次求值是不是全绿。 */
  allGreen: boolean
}

/**
 * 「这一刻该不该重算检查链」的结论。
 *
 * 注意 waitMs 的含义是「按退避还差多久」，不是「请挂一个等这么久的定时器」：调用方拿到它只做两件事——
 * 要么当场放行，要么把这一步记成待办、等四种事件里的某一个到来时再问一次。
 */
export interface ChainFreshness {
  /** 这一刻要不要真的重算一次。 */
  needed: boolean
  /** 为什么是这个结论的原因代号（例如「全绿缓存还能用」），取值表由 backoff.ts 给。 */
  reason: string
  /** needed 为假时，按退避还要再等多少毫秒；needed 为真时是 0。 */
  waitMs: number
}

/**
 * 这份形状定义在哪个文件里。
 * 类型在转译时会被擦掉，产物里只剩这一行模块标识，用来证明「产物确实来自这份源码」。
 */
export const PORTS_SOURCE = 'refresh-core/src/ports.ts'
