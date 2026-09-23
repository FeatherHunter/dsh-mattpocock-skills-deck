/**
 * refresh-core/src/policy.ts —— 裁决的纯函数：给一笔请求，答「放行 / 降级 / 推迟」
 *
 * 这个文件只回答一个问题：这一笔去 GitHub 的调用，现在放行、降级，还是推迟？输入是四样东西
 * （请求类别、这一桶的档位、这一桶的已用额度、这个工作区当前的状态），输出是结论加一句原因代号。
 * 里面没有一行读盘、联网、看时钟的代码，所以它能被整块测干净（tests/verify-budget-worstcase.js
 * 与 tests/verify-gate-accounting.js 都会真跑它）。
 *
 * 形状在 ports.ts（请求类别、档位、三种结论）；数字在 budget.ts（几秒探一次、每小时能花多少、
 * AI 工具那两组硬顶）。**本文件一样都不重复。**
 *
 * 为什么不直接 import budget.ts 的常量，而要调用方把数字装进 PolicyLimits 传进来：
 * 产物文件之间同层互引会被 tests/verify-no-same-layer-import.js 判红（src/shared/ 内部不许互相引用，
 * 该门禁只许减不许增），而 ports.ts 那种 `import type` 在转译时会被擦掉、不产生引用边。
 * 所以数字统一由调用方（src/host/refresh/gate.js）从 budget.ts 取好再注入，本文件一个额度数字都不写。
 *
 * 三档降级顺序（定稿第十章）在本文件里就是 DEGRADE_ORDER 这一条数组，顺序写死：先降「别处变化」
 * 的灵敏度，再降后台对账的频率，最后才动本地写入的即时性。数值取自 budget.ts（那是唯一真源）：
 * 黄档探测放慢到 budget.ts 的 PROBE_INTERVAL_YELLOW_MS，红档探测全停；后台对账到黄档就停
 * （第四章定的「黄档后台刷新全停」）；本地写入的即时性在任何档都不动（写保底额度不吃「读用剩多少」那一套）。
 * 第十章叙述里的 5 秒 → 30 秒 → 停、10 分钟 → 30 分钟 → 停 是「顺序」的说法，具体数值以 budget.ts 为准，
 * 这条不一致记在 docs/adr/20260923-refresh-budget-architecture.md 的「两处如实记录」一节里。
 */
import type { QuotaTier, RequestCategory, VerdictResult } from './ports.js'

/** 这份文件定义在哪个文件里。产物里留着它，用来证明「产物确实来自这份源码」。 */
export const POLICY_SOURCE = 'refresh-core/src/policy.ts'

// ---------- 一、请求的种类（闸按它决定「这笔能不能花」） ----------

/** 一笔请求的种类。种类决定它在降档时先被牺牲还是最后被牺牲。 */
export type RequestKind =
  | 'quota-read' // 读服务端剩余额度（不扣配额，永远放行）
  | 'probe' // 变化探测（活跃工作区 5 秒一次那一下）
  | 'patch' // 行级补行（只取变的那几条）
  | 'rebuild' // 整池重建（冷启动、票号增减）
  | 'reconcile' // 后台对账（10 分钟一次的整池）
  | 'preflight' // 环境预检（登录态、仓库可达）
  | 'chain' // 检查链那一次求值
  | 'naming' // 命名守护的兜底一跳
  | 'detail' // 单票 / 评论 / 翻页（人点开才取）
  | 'write' // 写操作（评论、认领、改标签、关闭、建票）
  | 'tool-batch' // AI 的批量工具调用（建地图、批量建票）

/** 全部种类，顺序与上面一致（门禁按它核对取值表有没有漏项）。 */
export const REQUEST_KINDS: readonly RequestKind[] = [
  'quota-read', 'probe', 'patch', 'rebuild', 'reconcile', 'preflight', 'chain', 'naming', 'detail', 'write', 'tool-batch',
]

// ---------- 二、裁决要用的那套数字（全部由调用方从 budget.ts 取来传入） ----------

/** 这一套数字全部来自 budget.ts，由调用方取好传进来；本文件不抄任何一个。 */
export interface PolicyLimits {
  /** 绿档变化探测间隔（budget.ts 的 PROBE_INTERVAL_MS）。 */
  probeIntervalMs: number
  /** 黄档变化探测间隔（budget.ts 的 PROBE_INTERVAL_YELLOW_MS）。 */
  probeIntervalYellowMs: number
  /** 后台对账间隔（budget.ts 的 RECONCILE_INTERVAL_MS）。 */
  reconcileIntervalMs: number
  /** 黄档两次整池重建之间的最短间隔（budget.ts 的 REBUILD_MIN_INTERVAL_YELLOW_MS）。 */
  rebuildMinIntervalYellowMs: number
  /** AI 工具单次点数硬顶（budget.ts 的 AI_TOOL_MAX_POINTS_PER_CALL）。 */
  aiToolMaxPointsPerCall: number
  /** AI 工具单次请求数硬顶（budget.ts 的 AI_TOOL_MAX_REQUESTS_PER_CALL）。 */
  aiToolMaxRequestsPerCall: number
  /** AI 工具每小时点数硬顶（budget.ts 的 AI_TOOL_MAX_POINTS_PER_HOUR）。 */
  aiToolMaxPointsPerHour: number
  /** AI 工具每小时请求数硬顶（budget.ts 的 AI_TOOL_MAX_REQUESTS_PER_HOUR）。 */
  aiToolMaxRequestsPerHour: number
  /** 失败退避序列（budget.ts 的 CHAIN_BACKOFF_MS；有进展就回到第一档）。 */
  failureBackoffMs: readonly number[]
}

/** 连续失败到这个次数就进退避：再试也要拉开间隔，不许连环重试（不变量 I5）。 */
export const FAILURE_DEFER_AT = 3

// ---------- 三、输入形状 ----------

/** 这一桶账现在的样子。额度与已用都由闸从账本里取保守下界读出来。 */
export interface QuotaView {
  /** 这一桶这一小时的可用额度。 */
  allowance: number
  /** 这一桶这一小时已经用掉多少。 */
  used: number
  /** 还能花多少（保守下界：本地已花与上一次服务端读数取小者）。 */
  remaining: number
  /** 这里留给「写」的保底额度：读用不掉它，读要花到它头上就得让路。 */
  reserve: number
}

/** 工作区当前的状态。三样都不是「程度」，而是三种不同的信号。 */
export interface WorkspaceState {
  /** 它在不在活跃集合里（正在看的那个，或刚离开 30 秒内的那个）。 */
  active: boolean
  /** 连续失败了几次（成功一次归零）。 */
  failuresSinceSuccess?: number
  /** 这一轮撞过限流，含二级限流的 Retry-After。 */
  rateLimited?: boolean
}

/** 一笔 AI 工具调用的花费预估（点数与真实出站请求数两样都要给）。 */
export interface AiToolCall {
  points: number
  requests: number
  /** 这一笔要建多少张子票（批量工具才带；分片建议由调用方按 budget.ts 的 shardPlan 算）。 */
  childTickets?: number
}

/** 这一小时 AI 工具已经花掉多少（调用方把「本小时已用 + 这一笔」之外的累计值传进来）。 */
export interface HourSpend {
  points: number
  requests: number
}

/** 一次裁决的全部输入：请求类别 + 档位 + 已用额度 + 工作区状态（外加 AI 工具那一档自己的两组数字）。 */
export interface PolicyInput {
  category: RequestCategory
  kind: RequestKind
  tier: QuotaTier
  quota: QuotaView
  workspace: WorkspaceState
  aiTool?: AiToolCall
}

// ---------- 四、原因代号表（账本里 refresh.decide 与 refresh.skipped 记的就是这里的一句话） ----------

/**
 * 原因代号表。左边是代号（会被写进日志与界面），右边是给第一次读的人看的一整句大白话。
 * 代号是稳定接口：改含义容易，改字符串等于把历史日志的口径也改了，所以只许加、不许改字面。
 */
export const REASONS: Readonly<Record<string, string>> = {
  'quota-read-free': '读服务端剩余额度：这个接口不扣配额，永远放行',
  'user-action-always': '人在界面上亲手做的动作：永不降档，红档也照做',
  'user-action-rate-limited': '撞上限流时人亲手做的动作：照样做，但界面要说清是额度被别人用掉了',
  'rate-limited': '撞上限流（含二级限流的 Retry-After）：这一轮停，等闸的档位恢复',
  'failure-backoff': '连续失败到了退避门槛：拉开间隔再试，成功一次立刻归零',
  'background-fits': '后台档：额度够，按节拍跑',
  'background-inactive': '不在活跃集合里：后台档一次都不发，切回来时按生命周期那一次取',
  'background-tier-yellow': '后台档进了黄档：后台刷新全停（先牺牲的从来不是人的动作）',
  'background-tier-red': '后台档进了红档：自动刷新全停，只留人的动作',
  'reserve-kept-for-writes': '读的额度已用完，只剩给写留的保底：读让路，写保住',
  'lifecycle-fits': '切进工作区那一次：额度够，照常取数（先从缓存铺满，再探测补齐）',
  'lifecycle-cache-only': '切进工作区那一次：额度不够，降级为只出缓存加只探测不重建',
  'ai-tool-within-caps': 'AI 工具调用：单次与每小时的硬顶都还够',
  'ai-tool-over-call-cap': 'AI 工具调用超了单次硬顶：拒绝，并说明用了多少、顶在哪',
  'ai-tool-over-hour-cap': 'AI 工具这一小时超了硬顶：拒绝，并说明用了多少、顶在哪',
  'ai-tool-below-remaining': '剩余额度已到保底线：先拒 AI 工具，绝不挤掉插件刷新与人的动作',
}

/** 原因代号：取值只能来自上面那张表。 */
export type ReasonCode = keyof typeof REASONS

function verdict(v: VerdictResult['verdict'], reason: ReasonCode): VerdictResult {
  return { verdict: v, reason: reason }
}

// ---------- 五、三档降级顺序（写死，不临场决定） ----------

/** 牺牲的顺序：先「别处变化」的灵敏度，再后台对账的频率，最后才是本地写入的即时性。 */
export type DegradeStage = 'probe-sensitivity' | 'reconcile-frequency' | 'local-write-latency'

/** 顺序本身。数组的次序就是遭遇战里牺牲的次序，门禁按它核对「先降谁」。 */
export const DEGRADE_ORDER: readonly DegradeStage[] = ['probe-sensitivity', 'reconcile-frequency', 'local-write-latency']

/** 某个档位下，四样东西各自的安排。null 表示「停」。 */
export interface DegradePlan {
  /** 活跃工作区的变化探测间隔；null = 探测全停。 */
  probeIntervalMs: number | null
  /** 后台对账间隔；null = 对账停。 */
  reconcileIntervalMs: number | null
  /** 两次整池重建之间至少要隔多久（黄档专用，绿档为 0 表示不额外设限）。 */
  rebuildMinGapMs: number
  /** 本地写入的即时性还在不在。任何档位都是 true —— 这是最后才动、事实上不动的那一样。 */
  localWriteImmediate: boolean
  /** 这一档里，被牺牲到的最后一步是哪一步（给日志与界面显示「现在少了什么」）。 */
  sacrificed: DegradeStage | 'none'
}

/** 档位 → 四样东西的安排。数值全部取自传进来的 limits（也就是 budget.ts）。 */
export function degradePlanFor(tier: QuotaTier, limits: PolicyLimits): DegradePlan {
  if (tier === 'green') {
    return {
      probeIntervalMs: limits.probeIntervalMs,
      reconcileIntervalMs: limits.reconcileIntervalMs,
      rebuildMinGapMs: 0,
      localWriteImmediate: true,
      sacrificed: 'none',
    }
  }
  if (tier === 'yellow') {
    return {
      probeIntervalMs: limits.probeIntervalYellowMs,
      reconcileIntervalMs: null,
      rebuildMinGapMs: limits.rebuildMinIntervalYellowMs,
      localWriteImmediate: true,
      sacrificed: 'probe-sensitivity',
    }
  }
  return {
    probeIntervalMs: null,
    reconcileIntervalMs: null,
    rebuildMinGapMs: 0,
    localWriteImmediate: true,
    sacrificed: 'probe-sensitivity',
  }
}

// ---------- 六、裁决本体 ----------

/** 「读」这一类的种类：它们吃读的份额，用不到读份额时要给写的保底让路。 */
const READ_KINDS: readonly RequestKind[] = ['probe', 'patch', 'rebuild', 'reconcile', 'preflight', 'chain', 'naming', 'detail']

function isReadKind(kind: RequestKind): boolean {
  return READ_KINDS.indexOf(kind) >= 0
}

/**
 * 一笔请求的裁决。
 *
 * 判定顺序是有讲究的，从上到下就是「谁最不该被牺牲」的顺序：
 *  ① 读剩余额度：免费，永远放行（它要是被拦住，闸就瞎了）。
 *  ② 人亲手做的动作：永不降档，红档也照做 —— 这是这个面板存在的意义。
 *  ③ 撞上限流、连续失败太多：除了人的动作，其余都停或退避。
 *  ④ 读的额度用完（只剩写保底）：读让路，写保住。
 *  ⑤ 红档：自动刷新全停，生命周期降级为只出缓存。
 *  ⑥ 后台档：黄档停，不在活跃集合里的停。
 *  ⑦ 剩下的都放行。
 */
export function decide(input: PolicyInput): VerdictResult {
  const { category, kind, tier, quota, workspace } = input

  // ① 读剩余额度是免费的，而且闸离了它就没法算档位。
  if (kind === 'quota-read') return verdict('allow', 'quota-read-free')

  // ② 人亲手做的动作：永不降档。
  if (category === 'user-action') {
    return verdict('allow', workspace.rateLimited ? 'user-action-rate-limited' : 'user-action-always')
  }

  // ③ 撞上限流与连续失败：停或退避；生命周期那一档仍然出数据（只是降级成只出缓存）。
  if (workspace.rateLimited) {
    return category === 'lifecycle' ? verdict('degrade', 'rate-limited') : verdict('defer', 'rate-limited')
  }
  const failures = workspace.failuresSinceSuccess || 0
  if (failures >= FAILURE_DEFER_AT) {
    return category === 'lifecycle' ? verdict('degrade', 'lifecycle-cache-only') : verdict('defer', 'failure-backoff')
  }

  // ④ 读的额度已经花到给写留的保底上：只有读让路，写照做。
  if (isReadKind(kind) && quota.remaining <= quota.reserve) {
    return category === 'lifecycle' ? verdict('degrade', 'lifecycle-cache-only') : verdict('defer', 'reserve-kept-for-writes')
  }

  // ⑤ 红档：自动刷新全停，只留人的动作；生命周期降级为「只出缓存 + 只探测不重建」。
  if (tier === 'red') {
    if (category === 'lifecycle') return verdict('degrade', 'lifecycle-cache-only')
    if (category === 'ai-tool') return verdict('defer', 'ai-tool-below-remaining')
    return verdict('defer', 'background-tier-red')
  }

  // ⑥ 后台档：黄档起后台刷新全停（先动的是「别处变化的灵敏度」那一档，见 degradePlanFor）；
  //    不在活跃集合里的后台活一次都不发 —— 切回来时按生命周期那一次取。
  if (category === 'background') {
    if (kind === 'rebuild' || kind === 'reconcile') {
      return tier === 'yellow' ? verdict('defer', 'background-tier-yellow') : verdict('allow', 'background-fits')
    }
    const watched = kind === 'probe' || kind === 'patch'
    if (watched && !workspace.active) return verdict('defer', 'background-inactive')
    return verdict('allow', 'background-fits')
  }

  // ⑦ 生命周期与 AI 工具：额度够就放行。生命周期在黄档起只探测不重建（黄档的探测节拍也放慢了）。
  if (category === 'lifecycle') {
    return tier === 'yellow' ? verdict('degrade', 'lifecycle-cache-only') : verdict('allow', 'lifecycle-fits')
  }
  return verdict('allow', 'ai-tool-within-caps')
}

// ---------- 七、AI 工具那一档的准入（超顶是「拒绝」，不是「推迟」） ----------

/** 一次 AI 工具调用的准入结论。 */
export interface AiToolAdmission {
  /** 放行了吗。false 的时候调用方必须当场拒绝，并把下面两句原样回给 AI。 */
  admitted: boolean
  /** 拒绝的原因代号（放行时是 'ai-tool-within-caps'）。 */
  reason: ReasonCode
  /** 这一笔要花多少点、多少条真实出站请求（拒绝时也要如实说）。 */
  points: number
  requests: number
}

/**
 * AI 工具那一档的准入：单次硬顶 + 每小时硬顶 + 剩余额度保底线，三样都过才放行。
 *
 * 为什么不把它并进 decide()：AI 工具超顶的结论是「拒绝」，而 ports.ts 里那三种结论
 * 都不是失败（放行 / 降级 / 推迟）。拒绝是第四种东西，所以它单独一条路：闸先问准入，
 * 过了再走 decide() 的资源那一侧。
 */
export function aiToolAdmission(call: AiToolCall, hour: HourSpend, quota: QuotaView, limits: PolicyLimits): AiToolAdmission {
  const points = call.points
  const requests = call.requests
  const base = { points: points, requests: requests }
  if (!(points <= limits.aiToolMaxPointsPerCall) || !(requests <= limits.aiToolMaxRequestsPerCall)) {
    return { admitted: false, reason: 'ai-tool-over-call-cap', ...base }
  }
  if (!(hour.points + points <= limits.aiToolMaxPointsPerHour) || !(hour.requests + requests <= limits.aiToolMaxRequestsPerHour)) {
    return { admitted: false, reason: 'ai-tool-over-hour-cap', ...base }
  }
  if (quota.remaining <= quota.reserve) {
    return { admitted: false, reason: 'ai-tool-below-remaining', ...base }
  }
  return { admitted: true, reason: 'ai-tool-within-caps', ...base }
}

// ---------- 八、退避与节拍（调用方按这两个函数安排下一次） ----------

/**
 * 连续失败第 n 次之后，下一次要等多久。
 * 序列取自 budget.ts 的 CHAIN_BACKOFF_MS（同一套「有进展就回到第一档」的纪律），本文件不另写一份数字。
 * 没有失败（n ≤ 0）时返回 0：立刻可以再试。
 */
export function nextAttemptDelayMs(failuresSinceSuccess: number, limits: PolicyLimits): number {
  const n = Math.max(0, Math.floor(failuresSinceSuccess || 0))
  if (n <= 0) return 0
  const seq = limits.failureBackoffMs
  if (!seq || seq.length === 0) return 0
  return seq[Math.min(n - 1, seq.length - 1)]
}
