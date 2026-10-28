/**
 * src/refresh/rooms/host/quota-observer-types.ts —— 观察器收什么信号、每个字段什么含义（#1627）。
 *
 * 为什么单独成文件：src/ 下单个文件上限 350 有效行，观察器的类型声明加常量本身就有两百来行，
 * 和计数逻辑挤在一起会超限；拆开之后这份文件只写「收什么信号、字段什么含义」，
 * quota-observer.ts 只写「怎么累加、什么时候写事件」，两边都能一眼读完。
 *
 * 约定不能改：
 *   - 本文件只有类型、常量与两个纯函数，不放运行期状态，回放测试可以直接引用；
 *   - 类型与常量是 quota-observer.ts 与 tests/verify-log-1627.ts 的共同尺子，改字段先改票面字段表。
 */

/** 一分钟后落一行汇总、以及滚动一小时的窗口，都以毫秒为单位，不引任何时间配置。 */
export const MINUTE_MS = 60_000
/** 同一个限流类别 60 秒内只写一次 incident，避免一次风暴刷出几十行同样的告警。 */
export const INCIDENT_DEDUPE_MS = 60_000
/** 最近一次限流失败之后安静 30 秒、第一个成功操作算恢复：比这更短的「成功」说明还在半开试探。 */
export const RECOVER_QUIET_MS = 30_000
/** 每次事故最多旁证 40 个在飞调用（票面硬上限）。 */
export const DETAIL_MAX = 40
/** top 字段最多 200 字符（票面硬上限），超长只截断、不丢整行。 */
export const TOP_MAX = 200
/** 单分钟点数与滚动一小时点数这两条压力线，都是票面写死的判据。 */
export const PRESSURE_MINUTE_POINTS = 1000
export const PRESSURE_HOUR_POINTS = 4000
/** 每类事件每分钟最多写几行。注意：级别不够（debug 关时的 quota.op）不占这里的名额。 */
export const CAPS = { op: 40, receipt: 40, incident: 1, pressure: 1 } as const

/** 一分钟后写进 quota.window 的滚动状态：所有计数都在这一分钟里累加，跨分钟清零。 */
export interface MinuteState {
  start: number
  touched: boolean
  requests: number
  points: number
  restRequests: number
  aiPoints: number
  pluginPoints: number
  userPoints: number
  failCount: number
  limitCount: number
  inflightPeak: number
  inflightMax: number
  queuedPeak: number
  oldestWaitMs: number
  allowUser: number
  allowAi: number
  allowBg: number
  softOver: number
  deferCount: number
  namingPages: number
  namingPoints: number
  suppressed: number
  caps: { op: number; receipt: number; incident: number; pressure: number }
}

/** 一次事故（从第一次限流失败到恢复）的累计账，恢复行写完后清零等下一次。 */
export interface IncidentState {
  active: boolean
  start: number
  incidents: number
  suppressed: number
  failsInWindow: number
  opsFailed: number
  maxInflight: number
  detailWritten: number
  lastRateLimitAt: number
  lastWriteAt: number
  lastRateClass: string
  resetPast: boolean
}

/** 排队车道在某一刻的只读快照（outbound-admission.ts 的 getLaneState 回的就是它）。 */
export interface QuotaLaneState {
  inflight: number
  inflightMax: number
  queued: number
  queuedPeak: number
  oldestWaitMs: number
}

/** 观察器需要的服务端读数（装配方从账本与同步状态里现取一份，缺值用 -1 表示不知道）。 */
export interface QuotaReadings {
  gqlRemain: number
  resetSec: number
  syncAgeMs: number
  tier: string
  allowance: number
}

/** 一次出站操作的开始：用来还原「事故那一刻谁还在飞」。 */
export interface QuotaOpStart {
  at: number
  op: string
  opId: string
  caller: string
  account: string
  backendId: string
  purpose: string
}

/** 一次出站操作的收尾：用量、耗时、成败由装配方算好后交进来，观察器不 import 业务层。 */
export interface QuotaOpReport extends QuotaOpStart {
  ok: boolean
  latencyMs: number
  requests: number
  points: number
  pointSource: string
  bucket: string
  remaining: number | null
  tier: string | null
  errorKind: string
  rateClass: string
  httpStatus: number
  top: string
}

/** 账本落的一笔真实花费（quota-ledger 的 onSpend；窗口里的点数与请求数都从这里来）。 */
export interface QuotaSpendReport {
  at: number
  account: string
  backendId: string
  bucket: string
  requests: number
  points: number
  kind: string
}

/** 闸的一条裁决（refresh-gate 的 onDecision；debug 关着也必须计数，所以不走 debug 行）。 */
export interface QuotaDecisionReport {
  at: number
  category: string
  verdict: string
  reason: string
}

/** 一次服务端读数（quota-ledger 的 onSync，按桶回调；观察器按「后端 + 时刻」合成一行）。 */
export interface QuotaSyncReport {
  at: number
  trigger: string
  backendId: string
  bucket: string
  serverLimit: number
  serverRemaining: number
  resetSec: number
  allowance: number
  spentPoints: number
}

/** 一次 deck 工具调用的回执（tracker-session 的 onToolReceipt；坏、慢、贵时观察器提升到 info）。 */
export interface QuotaToolReceiptReport {
  at: number
  tool: string
  opId: string
  status: string
  estRequests: number
  estPoints: number
  requests: number
  points: number
  latencyMs: number
  remaining: number | null
  tier: string | null
  backendId: string
  note: string
}

/** 日志出口的形状与宿主 LogCtx 一致；演练与测试可以塞一个只收数组的假出口。 */
export interface QuotaObserverLog {
  fire(level: string, event: string, fields?: unknown): void
  isEnabled(level: string): boolean
}

/** 装配方注入的四个出口；全部可选，缺省时观察器照常计数、只是不写事件或不读外部状态。 */
export interface QuotaObserverDeps {
  now?: () => number
  log?: QuotaObserverLog | null
  lane?: () => QuotaLaneState | null
  readings?: () => QuotaReadings | null
}

/** 排查用的只读快照：它不参与任何判据，只给门禁与人工核对当前计数是否走在预期上。 */
export interface QuotaObserverSnapshot {
  minuteStart: number
  window: Record<string, unknown>
  incidentActive: boolean
  incidents: number
  pendingSyncs: number
  hourPoints: number
}

/** 观察器对外就这几个入口；接线在 quota-wiring.ts，业务层只当普通回调传。 */
export interface QuotaObserver {
  noteSpend(report: QuotaSpendReport): void
  noteOpStart(info: QuotaOpStart): void
  noteOp(report: QuotaOpReport): void
  noteToolReceipt(report: QuotaToolReceiptReport): void
  noteDecision(report: QuotaDecisionReport): void
  noteSync(report: QuotaSyncReport): void
  tick(at?: number): void
  snapshot(): QuotaObserverSnapshot
}

/** 还没落盘的同步读数：syncServer 对每个桶回调一次，观察器按后端与时刻合成一行 quota.sync。 */
export interface PendingSync {
  at: number
  trigger: string
  backendId: string
  buckets: Map<string, QuotaSyncReport>
}

/** 造一分钟后要写的空白分钟状态；所有计数从这里归零，避免某个字段漏在对象外面。 */
export function newMinute(start: number): MinuteState {
  return {
    start: start, touched: false,
    requests: 0, points: 0, restRequests: 0, aiPoints: 0, pluginPoints: 0, userPoints: 0,
    failCount: 0, limitCount: 0,
    inflightPeak: 0, inflightMax: 0, queuedPeak: 0, oldestWaitMs: 0,
    allowUser: 0, allowAi: 0, allowBg: 0, softOver: 0, deferCount: 0,
    namingPages: 0, namingPoints: 0, suppressed: 0,
    caps: { op: 0, receipt: 0, incident: 0, pressure: 0 },
  }
}

/** 外部读数可能是任何东西（宿主服务没起来、测试只塞了半个对象），只认有限数字，其余回缺省值。 */
export function numOf(value: unknown, fallback: number): number {
  return (typeof value === 'number' && Number.isFinite(value)) ? value : fallback
}

/** 字符串字段同理：类型不对就回空串，写进日志的永远是字符串。 */
export function strOf(value: unknown): string {
  return (typeof value === 'string') ? value : ''
}
