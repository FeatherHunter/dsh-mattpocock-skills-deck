/**
 * src/refresh/rooms/host/quota-log-wiring.ts —— 把宿主各处的原始钩子翻译成观察器的输入（#1627）。
 *
 * 为什么单独成文件：refresh-runtime.ts 贴着 350 有效行上限（接线文件 #1472 立下的规矩：新接线不进主文件），
 * 而这段翻译要 import 记账换算、限流分类、账本视图与车道快照，塞进主文件既超限又会把宿主入口读成一锅粥。
 * 主文件只负责「在造账本/闸/会话开的口/工具桥的那一刻，把这里的回调传进去」，翻译细节全在这里。
 *
 * 三个约定不能改：
 *   - 观察器（quota-observer.ts）不 import 任何业务层：points / requests / bucket 由这里从 result 与 budget 现算；
 *   - 所有依赖都从 deps 注入（时钟、后端编号、账本、车道），回放测试可以只塞一个假账本；
 *   - 观察代码出错绝不影响业务：每个钩子整段包 try/catch，与管线里 onEvent 的纪律一致。
 *
 * 装配开关：deps.enabled === false 时整包不建观察器（所有钩子为 undefined，宿主工厂看不到任何回调），
 * 这是票面要求的「单独一处装配开关能整包关掉」；缺省（不传）视为开。
 *
 * 不排常驻计时器：宿主没有统一的接线销毁口，长活的递归计时器一旦排上就没处撤（verify-1115 盯的就是
 * 「答完还剩悬着的计时器」）。因此上一分钟的行由「下一笔事件」收尾，需要主动收尾的地方由调用方调 tick()。
 */

import { usageOfResult, spendsOfAccount } from '../../kernel/backend-accounting.js'
import { rateLimitClassOf } from '../../../tracker/kernel/error-rules.js'
import { getLaneState } from './outbound-admission.js'
import { createQuotaObserver } from './quota-observer.js'
import type {
  QuotaLaneState, QuotaObserver, QuotaObserverLog, QuotaObserverSnapshot, QuotaOpReport,
  QuotaOpStart, QuotaReadings, QuotaSyncReport, QuotaToolReceiptReport,
} from './quota-observer.js'
import type { LedgerBucketView } from './quota-ledger.js'
import type { QuotaOpEnd } from '../../../tracker/session/pipeline.js'

/** 账本里这里只读两格：某后端有哪些桶、某个桶现在的水位（不写账，唯一写入口仍是 createAccountPort）。 */
export interface QuotaLedgerLike {
  bucketsOf(backendId: string): readonly string[]
  view(backendId: string, bucket: string): LedgerBucketView
}

/** 一次花费（账本 onSpend 的形状）；字段与观察器 QuotaSpendReport 逐格对应，装配方原样递进来。 */
export interface QuotaSpendInfo {
  at: number
  account: string
  backendId: string
  bucket: string
  requests: number
  points: number
  kind: string
}

/** 一次服务端读数（账本 onSync 的形状，按桶回调）；观察器按「后端 + 时刻」合成一行。 */
export interface QuotaSyncInfo {
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

/** 闸的一条裁决（refresh-gate 的 onDecision）。 */
export interface QuotaDecisionInfo {
  at: number
  category: string
  verdict: string
  reason: string
}

/** 装配入参：全部可选，主文件按宿主里现成的东西传；测试可以只给 logCtx 与 ledgerOf。 */
export interface QuotaLogWiringDeps {
  logCtx?: QuotaObserverLog | null
  enabled?: boolean
  now?: () => number
  backendIdOf?: () => string
  ledgerOf?: () => QuotaLedgerLike | null
  laneOf?: () => QuotaLaneState | null
}

/** 返回给主文件的入口：钩子字段可选——关掉装配开关时全是 undefined。 */
export interface QuotaLogWiring {
  readonly enabled: boolean
  readonly observer: QuotaObserver | null
  onSpend?: (info: QuotaSpendInfo) => void
  onSync?: (info: QuotaSyncInfo) => void
  onDecision?: (info: QuotaDecisionInfo) => void
  onOpStart?: (info: QuotaOpStart) => void
  onOpEnd?: (info: QuotaOpEnd) => void
  onToolReceipt?: (info: QuotaToolReceiptReport) => void
  bindLedger(ledger: QuotaLedgerLike | null): void
  tick(at?: number): void
  snapshot(): QuotaObserverSnapshot | null
}

/** 数字兜底：宿主钩子给的字段可能是任何东西，日志里只写有限数字。 */
function num(value: unknown, fallback: number): number {
  return (typeof value === 'number' && Number.isFinite(value)) ? value : fallback
}

/** 字符串兜底：类型不对写空串，保证日志字段类型稳定。 */
function str(value: unknown): string {
  return (typeof value === 'string') ? value : ''
}

/** 账本视图里的桶按这个优先级挑一个：有 graphql 先用它（点数都在那），否则 rest，再否则第一个。 */
function pickBucket(buckets: readonly string[]): string {
  if (buckets.indexOf('graphql') >= 0) return 'graphql'
  if (buckets.indexOf('rest') >= 0) return 'rest'
  return buckets.length > 0 ? String(buckets[0]) : ''
}

/**
 * 造一份接线。它本身不写日志、不碰业务：只把宿主钩子的原始形状翻成观察器认识的形状，
 * 再按需从账本现取服务端读数、从出站车道现取在飞快照。
 */
export function createQuotaLogWiring(deps: QuotaLogWiringDeps = {}): QuotaLogWiring {
  const enabled = deps.enabled !== false
  if (!enabled) {
    return {
      enabled: false, observer: null,
      bindLedger(): void { /* 开关关掉：不建观察器，也不记任何一笔 */ },
      tick(): void { /* 开关关掉：没有可收尾的东西 */ },
      snapshot(): null { return null },
    }
  }
  const nowFn = (typeof deps.now === 'function') ? deps.now : () => Date.now()
  let ledgerRef: QuotaLedgerLike | null = null
  try { ledgerRef = deps.ledgerOf ? deps.ledgerOf() : null } catch { ledgerRef = null }

  /** 取该后端的水位：优先 graphql，没有就 rest / requests；没同步过读数就回 null（观察器填 -1）。 */
  function readingsNow(): QuotaReadings | null {
    const backendId = deps.backendIdOf ? str(deps.backendIdOf()) : ''
    if (!backendId || !ledgerRef) return null
    let buckets: readonly string[] = []
    try { buckets = ledgerRef.bucketsOf(backendId) || [] } catch { return null }
    const bucket = pickBucket(buckets)
    if (!bucket) return null
    let view: LedgerBucketView | null = null
    try { view = ledgerRef.view(backendId, bucket) || null } catch { view = null }
    if (!view || view.synced !== true) return null
    const t = nowFn()
    return {
      gqlRemain: (view.remaining === null || view.remaining === undefined) ? -1 : view.remaining,
      resetSec: view.resetAt > 0 ? Math.max(0, Math.round((view.resetAt - t) / 1000)) : -1,
      syncAgeMs: view.syncedAt > 0 ? Math.max(0, t - view.syncedAt) : -1,
      tier: str(view.tier),
      allowance: num(view.allowance, -1),
    }
  }

  const observer = createQuotaObserver({
    now: nowFn,
    log: deps.logCtx || null,
    lane: (typeof deps.laneOf === 'function') ? deps.laneOf : function (): QuotaLaneState | null { return getLaneState() },
    readings: readingsNow,
  })

  function spendHook(info: QuotaSpendInfo): void {
    try {
      observer.noteSpend({
        at: num(info && info.at, nowFn()), account: str(info && info.account), backendId: str(info && info.backendId),
        bucket: str(info && info.bucket), requests: num(info && info.requests, 0), points: num(info && info.points, 0), kind: str(info && info.kind),
      })
    } catch { /* 观测出错绝不影响业务 */ }
  }

  function syncHook(info: QuotaSyncInfo): void {
    try {
      observer.noteSync({
        at: num(info && info.at, nowFn()), trigger: str(info && info.trigger) || 'sync', backendId: str(info && info.backendId),
        bucket: str(info && info.bucket) || 'graphql', serverLimit: num(info && info.serverLimit, -1),
        serverRemaining: num(info && info.serverRemaining, -1), resetSec: num(info && info.resetSec, -1),
        allowance: num(info && info.allowance, -1), spentPoints: num(info && info.spentPoints, 0),
      })
    } catch { /* 观测出错绝不影响业务 */ }
  }

  function decisionHook(info: QuotaDecisionInfo): void {
    try {
      observer.noteDecision({
        at: num(info && info.at, nowFn()), category: str(info && info.category),
        verdict: str(info && info.verdict), reason: str(info && info.reason),
      })
    } catch { /* 观测出错绝不影响业务 */ }
  }

  function opStartHook(info: QuotaOpStart): void {
    try {
      observer.noteOpStart({
        at: num(info && info.at, nowFn()), op: str(info && info.op), opId: str(info && info.opId),
        caller: str(info && info.caller), account: str(info && info.account),
        backendId: str(info && info.backendId), purpose: str(info && info.purpose),
      })
    } catch { /* 观测出错绝不影响业务 */ }
  }

  /** 把一次操作的收尾（原始 result + budget）翻成观察器要的报告：用量在这里按账本同一份换算口径现算。 */
  function reportOf(info: QuotaOpEnd): QuotaOpReport {
    const budget: unknown = (info as { budget?: unknown }).budget
    const result: unknown = (info as { result?: unknown }).result
    let usage: { requests: number; points: number } | null = null
    try { usage = usageOfResult(result) } catch { usage = null }
    let spends: { bucket: string; requests: number; points: number }[] = []
    try {
      spends = spendsOfAccount({ op: str(info.op), budget: budget as never, result: result, backendId: str(info.backendId) }) as never
    } catch { spends = [] }
    let requests = 0
    let points = 0
    let bucket = ''
    for (const spend of spends) {
      requests += num(spend.requests, 0)
      points += num(spend.points, 0)
      if (str(spend.bucket) === 'graphql') bucket = 'graphql'
      else if (!bucket && str(spend.bucket)) bucket = str(spend.bucket)
    }
    const backendId = str(info.backendId) || (deps.backendIdOf ? str(deps.backendIdOf()) : '')
    let remaining: number | null = null
    let tier: string | null = null
    try {
      if (ledgerRef && backendId) {
        const view = ledgerRef.view(backendId, bucket || pickBucket(ledgerRef.bucketsOf(backendId) || []))
        if (view) { remaining = (view.remaining === null || view.remaining === undefined) ? null : view.remaining; tier = str(view.tier) || null }
      }
    } catch { remaining = null; tier = null }
    const error: Record<string, unknown> | null = (result && typeof result === 'object' && (result as { ok?: unknown }).ok === false)
      ? ((result as { error?: Record<string, unknown> }).error || null) : null
    const errorKind = error ? str(error.kind) : ''
    const text = error ? (str(error.message) + ' ' + str(error.raw)).trim() : ''
    let rateClass = ''
    try { rateClass = error ? rateLimitClassOf({ kind: errorKind, message: text }) : '' } catch { rateClass = '' }
    return {
      at: num(info.at, nowFn()), op: str(info.op), opId: str(info.opId), caller: str(info.caller), account: str(info.account),
      backendId: backendId, purpose: str(info.purpose), ok: (info as { ok?: unknown }).ok === true, latencyMs: num(info.latencyMs, 0),
      requests: requests, points: points, pointSource: usage ? 'actual' : '', bucket: bucket,
      remaining: remaining, tier: tier, errorKind: errorKind, rateClass: rateClass, httpStatus: 0, top: text.slice(0, 200),
    }
  }

  function opEndHook(info: QuotaOpEnd): void {
    try { observer.noteOp(reportOf(info)) } catch { /* 观测出错绝不影响业务 */ }
  }

  function toolReceiptHook(info: QuotaToolReceiptReport): void {
    try {
      observer.noteToolReceipt({
        at: num(info && info.at, nowFn()), tool: str(info && info.tool), opId: str(info && info.opId), status: str(info && info.status),
        estRequests: num(info && info.estRequests, 0), estPoints: num(info && info.estPoints, 0),
        requests: num(info && info.requests, 0), points: num(info && info.points, 0), latencyMs: num(info && info.latencyMs, 0),
        remaining: (info && info.remaining !== null && info.remaining !== undefined) ? num(info.remaining, -1) : null,
        tier: (info && typeof info.tier === 'string') ? info.tier : null,
        backendId: str(info && info.backendId), note: str(info && info.note),
      })
    } catch { /* 观测出错绝不影响业务 */ }
  }

  return {
    enabled: true,
    observer: observer,
    onSpend: spendHook,
    onSync: syncHook,
    onDecision: decisionHook,
    onOpStart: opStartHook,
    onOpEnd: opEndHook,
    onToolReceipt: toolReceiptHook,
    bindLedger(next: QuotaLedgerLike | null): void { ledgerRef = next },
    tick(at?: number): void { try { observer.tick(at) } catch { /* 观测出错绝不影响业务 */ } },
    snapshot(): QuotaObserverSnapshot | null { try { return observer.snapshot() } catch { return null } },
  }
}
