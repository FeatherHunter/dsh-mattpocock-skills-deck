/**
 * refresh-core/src/budget.ts —— 全部节拍与额度的唯一真源
 *
 * 这份文件只有两样东西：常量（多久跑一次、每小时能花多少、上限是多少）与由这些常量算出来的算式。
 * 后面每一张落地票（闸、视野模型、行级增量、写事件、工具花费预估）都 import 这里的名字，
 * 不许再写一遍字面量：同一个数字写在两处，改一处漏一处的那天，预算表就开始骗人了。
 *
 * 数字的来源是 docs/architecture/refresh-budget-architecture.html（第四章的额度与三档降级、
 * 第九章的旋钮、第十章的降档顺序、第十一章的合并窗口、第十四章的两处更正）与维护者 2026-09-23
 * 定下的 AI 工具那一档口径。这里只写结果，不写推演过程——为什么是 5 秒、为什么是 35%，
 * 去那份文档与地图票 #704 看。
 *
 * AI 工具那一档在优先级顺序里的位置（单独说明，因为它最容易被误解成「AI 也永不降档」）：
 * 越靠近「人亲手做的动作」，越不能牺牲。四层从最不能牺牲到最先牺牲是：
 *   ① 人在界面上点的动作：永不降档，红档也照做——这是这个面板存在的意义；
 *   ② AI 的工具调用：单列一档。它不享受「永不降档」（AI 一分钟能建几十张票），
 *      也不按「后台超出即推迟」处理，而是拿下面那两组硬顶（单次 ≤600 点且 ≤400 次出站请求；
 *      每小时 ≤2000 点且 ≤1500 次请求），超顶直接拒绝并明说用了多少、顶在哪；
 *   ③ 生命周期（切进工作区那一次）：额度不足时降级为「只出缓存 + 只探测不重建」；
 *   ④ 后台（定时探测、检查链、命名守护）：超出即推迟。
 * 额度不够时的牺牲顺序也只有一条：先慢「别处变化的灵敏度」，再慢后台对账的频率，
 * 最后才动「本地写入的即时性」。
 *
 * 单位约定：以 MS 结尾的是毫秒；points 是 GraphQL 点数；requests 是真实发出的 HTTP 请求条数
 * （不是「逻辑上一次调用」——分页、重试、兜底链都要算进去）。
 */
import type { QuotaTier } from './ports.js'

// ---------- 一、节拍（多久跑一次） ----------

/** 变化探测的间隔：正在看的那个活跃工作区每 5 秒探一次（每次约 1 条 REST）。 */
export const PROBE_INTERVAL_MS = 5_000

/** 黄档时探测放慢到这个间隔（120 秒）；红档不下探，直接全停。 */
export const PROBE_INTERVAL_YELLOW_MS = 120_000

/** 黄档时两次整池重建之间至少隔 300 秒，防止降档之后还按原节奏重建。 */
export const REBUILD_MIN_INTERVAL_YELLOW_MS = 300_000

/** 后台对账（整池重建）的间隔：10 分钟一次；黄档时才是 30 分钟一次，由档位那一节决定用不用。 */
export const RECONCILE_INTERVAL_MS = 10 * 60_000

/** 环境预检（登录态、仓库可达）成功后的寿命：10 分钟之内复用同一份结果，不再重复花请求。 */
export const PREFLIGHT_TTL_MS = 10 * 60_000

/** 环境预检失败后立刻重试的次数：一次。再失败就等下一轮，不连环重试。 */
export const PREFLIGHT_RETRY_AFTER_FAILURE = 1

/** 检查链的退避序列（毫秒）：8 秒 → 30 秒 → 2 分钟 → 5 分钟；任何一步有进展立刻回到第一档。 */
export const CHAIN_BACKOFF_MS = [8_000, 30_000, 2 * 60_000, 5 * 60_000] as const

/** 检查链全绿后的缓存寿命：30 分钟（全绿这个状态本身变化很慢，不必反复重算）。 */
export const CHAIN_ALL_GREEN_TTL_MS = 30 * 60_000

/** 行级补行的合并窗口：同一个工作区 10 秒内的多次补行合并成一次；切换工作区的补探也用这个窗口。 */
export const PATCH_MERGE_WINDOW_MS = 10_000

/** 被推迟的请求在队列里的过期时间：5 分钟。过期直接丢，不排队、不堆积、不重试。 */
export const DEFER_EXPIRY_MS = 5 * 60_000

/** 刚离开的那个工作区还算「活跃」多久：30 秒（照顾在两个工作区之间快速来回切的手感）。 */
export const ACTIVE_LINGER_MS = 30_000

/** 面板可见时本地心跳的间隔：20 秒。零配额、不出网，只用来证明「界面还看着这个工作区」。 */
export const ATTENTION_HEARTBEAT_MS = 20_000

/** 视野信号失效的判据：90 秒内没有任何「我在看谁」的上报，全部工作区降为后台档。 */
export const ATTENTION_EXPIRY_MS = 90_000

// ---------- 二、额度（每小时能花多少） ----------

/** 插件每小时最多用掉剩余额度的这个比例：35%。 */
export const PLUGIN_SHARE_OF_REMAINING = 0.35

/** 插件每小时用掉的绝对上限（点）：1750，也就是 5000 的 35%。 */
export const PLUGIN_HOURLY_CAP = 1_750

/** 这一份额度里，读最多占这个比例：70%。 */
export const READ_SHARE_OF_ALLOWANCE = 0.7

/** 读的绝对上限（点）：1225。 */
export const READ_HOURLY_CAP = 1_225

/**
 * 这一份额度里给写留的保底比例：30%。
 * 写操作是人手动触发的，任何时候都必须有额度可用，所以它不吃「读用剩多少」的那一套。
 */
export const WRITE_RESERVED_SHARE = 0.3

/** 写的保底绝对上限（点）：525。 */
export const WRITE_HOURLY_CAP = 525

// ---------- 三、档位阈值（闸自己算档位，不靠人干预） ----------

/** 用掉不足这个比例是绿档。 */
export const TIER_GREEN_BELOW = 0.6

/** 用掉到这个比例（含）以上是红档；中间的区间是黄档。 */
export const TIER_RED_AT = 0.85

// ---------- 四、视野与分页 ----------

/** 活跃工作区的硬上限：2 个（正在看的 + 刚离开的）。多个窗口同时上报时取最近上报过的两个。 */
export const MAX_ACTIVE_WORKSPACES = 2

/** 一个仓库最坏要翻多少页。最坏用量按这个上界算，不是按「这次看到几页」算。 */
export const MAX_PAGES = 10

// ---------- 五、AI 工具那一档的硬顶 ----------

/** 一次 AI 工具调用最多花多少点：600。 */
export const AI_TOOL_MAX_POINTS_PER_CALL = 600

/** 一次 AI 工具调用最多发出多少条出站请求：400。 */
export const AI_TOOL_MAX_REQUESTS_PER_CALL = 400

/** AI 工具每小时最多花多少点：2000。 */
export const AI_TOOL_MAX_POINTS_PER_HOUR = 2_000

/** AI 工具每小时最多发出多少条出站请求：1500。 */
export const AI_TOOL_MAX_REQUESTS_PER_HOUR = 1_500

/** 一次工具调用最多建多少张子票：60。要建更多就先分片，不许一笔下去建几百张。 */
export const AI_TOOL_MAX_CHILD_TICKETS_PER_CALL = 60

/** 分片之后每一片最多建多少张：一片就是一次调用，所以它等于上面那个上限。 */
export const AI_TOOL_SHARD_SIZE = AI_TOOL_MAX_CHILD_TICKETS_PER_CALL

// ---------- 六、算式 ----------

/**
 * 这个小时插件总共能花多少点：剩余额度的 35%，但不超过 1750，也不小于 0。
 *
 * 传进来的剩余额度要用保守下界（本地已花与上一次读数取小的那个，两次同步之间不再加额度），
 * 因为服务端读数最多落后一分钟，乐观取值会让插件以为自己还有钱、其实已经花过头了。
 * 取整方向是往下取：宁可少花一点，也不要算出一个实际不存在的额度。
 */
export function hourlyAllowance(remainingPoints: number): number {
  const capped = Math.min(remainingPoints * PLUGIN_SHARE_OF_REMAINING, PLUGIN_HOURLY_CAP)
  return Math.max(0, Math.floor(capped))
}

/** 这一份额度里最多能花在「读」上的点数：70%。 */
export function readAllowance(allowancePoints: number): number {
  return Math.max(0, Math.floor(allowancePoints * READ_SHARE_OF_ALLOWANCE))
}

/** 这一份额度里给「写」留的保底点数：30%，读用不掉它。 */
export function writeReserve(allowancePoints: number): number {
  return Math.max(0, Math.floor(allowancePoints * WRITE_RESERVED_SHARE))
}

/**
 * 用掉了多少：已用 ÷ 可用额度。
 * 额度是 0（或读不到额度）时返回 1，也就是「按用满处理」——那种情况下档位必然是红，
 * 这正是想要的兜底方向：读不到就少花，不是多花。
 */
export function usedRatio(usedPoints: number, allowancePoints: number): number {
  if (!(allowancePoints > 0)) return 1
  return usedPoints / allowancePoints
}

/** 档位：用掉不足六成是绿、六成到八成五之间是黄、八成五以上（含）是红。 */
export function tierFor(ratio: number): QuotaTier {
  if (ratio < TIER_GREEN_BELOW) return 'green'
  if (ratio < TIER_RED_AT) return 'yellow'
  return 'red'
}

/**
 * 一次要建一批子票时，该分几次调用、每片最多几张。
 *
 * 规则只有一条：一次调用最多建 60 张，超过就分片，每片都不超过这个上限。
 * 返回的 shards 是建议的片数（不用分片时是 1）；perShard 是均分之后每片的上界，
 * 它永远不会大于 60，所以调用方不必再自己算一遍上限。
 */
export function shardPlan(totalChildTickets: number): { shards: number; perShard: number } {
  const total = Math.max(0, Math.floor(totalChildTickets))
  const shards = Math.max(1, Math.ceil(total / AI_TOOL_SHARD_SIZE))
  return { shards, perShard: Math.max(1, Math.ceil(total / shards)) }
}

/** 这一笔工具调用的点数与请求数，是不是都在单次硬顶之内。 */
export function aiToolCallWithinCaps(points: number, requests: number): boolean {
  return points <= AI_TOOL_MAX_POINTS_PER_CALL && requests <= AI_TOOL_MAX_REQUESTS_PER_CALL
}

/**
 * 加上这一笔之后，这一小时是不是还在 AI 工具的每小时硬顶之内。
 * 调用方传的是「本小时已用 + 这一笔」的累计值，不是这一笔本身。
 */
export function aiToolHourWithinCaps(points: number, requests: number): boolean {
  return points <= AI_TOOL_MAX_POINTS_PER_HOUR && requests <= AI_TOOL_MAX_REQUESTS_PER_HOUR
}
