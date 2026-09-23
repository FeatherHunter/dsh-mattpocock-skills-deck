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
 * 这份形状定义在哪个文件里。
 * 类型在转译时会被擦掉，产物里只剩这一行模块标识，用来证明「产物确实来自这份源码」。
 */
export const PORTS_SOURCE = 'refresh-core/src/ports.ts'
