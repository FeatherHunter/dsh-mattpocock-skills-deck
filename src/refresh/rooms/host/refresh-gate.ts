// src/refresh/rooms/host/refresh-gate.js —— 刷新机制的唯一出口闸（#706 T2 第二批）
//
// 依据：定稿第三章「三层 + 一道闸」与第四章第 01 件。它只回答一句：这一笔去 GitHub 的调用，
// 现在放行、降级，还是推迟？放行之后再记一笔真实花费。裁决本身一行都不在这里 —— 它调 refresh-core
// 那份纯函数产物 policy.js（第一批的成果），数字全部从 budget.js 取好注入。所以本文件里没有一条裁决规则、
// 没有一个额度数字，这两个 import 就是「只许复用、不许再写一份」的落地方式。
//
// 守住五件事（票面点名的五条硬要求，逐条对应下面一段代码）：
//   1. **唯一出口**：分类（人的动作 / 生命周期 / 后台 / AI 工具）、记账、裁决、推迟队列四件事都在这里做。
//      静态扫描门禁（tests/verify-gh-gateway.js）扫整个 src，要求每一个能起 gh 进程的调用点都登记在册。
//   2. **记账单位是真实出站 HTTP 请求数**：调用方报几条、传输层真发几条，两个数各自记账并当场对账；
//      分页、重试、兜底链、扇出都要算进去，所以闸不认「逻辑上一次调用」这个说法。
//   3. **不排队、按步记账**：发送之间互不排队（不同工作区、同一工作区的并发都直接发，本地文件的写保护见各自房间的单写者队列）；每一步的真实花费按这一步的计数器归属（见 shared/refresh/step-cost.ts），并发算不进对方。
//   4. **推迟 ≠ 失败**：被推迟的进推迟队列，同一工作区只留最后一次，5 分钟（DEFER_EXPIRY_MS）过期即丢；
//      丢弃不算失败、不计连续失败次数。只有真失败才进 failuresSinceSuccess，由裁决那侧安排退避。
//   5. **运行期漏网计数**：传输层每真发一条就报一次（noteOutbound），与闸记下来的条数之差就是绕开闸
//      发出去的条数（escaped()）—— 这个数不为 0，就说明有人偷偷发了请求。
//
// 二级限流（Retry-After）也是降档信号：noteRetryAfter() 一次就把所在桶按红档处理（主桶没用完也降档），并把那个工作区标成撞限流。
// #998：连续失败到门槛之后由 failure-window.js 那台状态机放一笔探针进来试（细节见那个文件）。
import { decide, aiToolAdmission, degradePlanFor, REQUEST_KINDS, REASONS, FAILURE_DEFER_AT, nextAttemptDelayMs } from '../../kernel/admission-policy.js'
import type { PolicyInput } from '../../kernel/admission-policy.js'
// 说明符指向真源后，policy 的精确类型第一次被 tsc 看见（从前读转译产物，类型已被剥掉）。
// 本文件的本地接口刻意只记「形状」（类别、种类、档位都是 string）：查表与兜底那两条分支
// 靠运行时判，不靠类型判。归一化结果喂给裁决之前，在 inputFor / planOf 两处收窄一次，
// 运行时一个字节都不变。真要给这几格加取值校验，另立一票，别顺手放宽 policy 的签名。
import { FAILURE_HALF_OPEN_DELAY_MS, DEFER_EXPIRY_MS, PROBE_INTERVAL_MS, PROBE_INTERVAL_YELLOW_MS, RECONCILE_INTERVAL_MS, REBUILD_MIN_INTERVAL_YELLOW_MS, CHAIN_BACKOFF_MS } from '../../../shared/time-config/src/values.js'
import * as budget from '../../kernel/host-budget.js'
import * as failureWindow from '../../kernel/failure-window.js'
import { measureStep, noteStepOutbound } from '../../kernel/step-pricing.js'
import { refusalTextRef } from './refusal-messages.js'

// ---------------------------------------------------------------------------
// 类型（#1155 类型标注，只写类型不写实现）。
//
// 为什么这么标：
//   1. 下面四张对照表（类别、调用点 → 类别、请求种类 → 桶、类别 → 档位）都是「查表」：
//      键是调用点与请求种类的名字，运行时的口径是「查得到就用、查不到走兜底」。所以标成带索引签名的
//      Record<string, string> —— 查表这条读法成立，兜底那条分支一字未动（名字合不合法由运行时兜底，
//      类型不替调用方拒绝，也不假装它一定对）。
//   2. 从外面进来的东西（请求、报数、读数、调用方给的数字）一律按 unknown 收：收窄发生在
//      num()、readReport() 与那些 typeof 判断里；类型不假装它们已经是某个形状。
//   3. 闸与账本不互相 import（宿主接线时拼起来，闸只按形状用账本），所以账本那一侧
//      按「闸实际用到的五条」写成 LedgerShape，而不是去引账本的类型。
// ---------------------------------------------------------------------------

/** 调用方给的那一份请求：字段都可缺（函数体里的 `|| {}` 就是这道兜底）；kind 缺了按 probe 算。 */
interface GateRequest {
  source?: string
  category?: string
  kind?: string
  bucket?: string
  workspaceKey?: unknown
  plan?: unknown[]
  /** 调用方给的这一趟号码（写事件那条路会带；闸只把它写进日志，不参与裁决）。 */
  cycle?: string
}

/** 归一之后的请求：下面每一处都按这个形状读，所以类别、种类、桶、工作区键都已经是字符串。 */
interface NormalizedReq {
  source?: string
  category: string
  kind: string
  bucket: string
  workspaceKey: string
  plan: unknown[]
  cycle: string
}

/** 一个工作区被闸记住的状态（与账本无关，纯粹是本闸自己的记忆）。 */
interface WorkspaceState {
  active: boolean
  failuresSinceSuccess: number
  rateLimitedUntil: number
  backoffWindowStartedAt: number
  // #1008/#1218 复核补的三格：这个窗口里「最近一次失败是谁、什么种类、连续第几次」。
  // 为什么必须有：从前日志只记「推迟了」与推迟原因，回答不了票面那句「这 3 次是谁攒的」——
  // 同一个窗口里可能既有登录失败又有网络失败，归因丢了就分不清该修哪条路。
  // 只在失败时写入、成功时清空，纯记忆，不参与任何裁决（裁决只看 failuresSinceSuccess 与窗口起点）。
  lastFailure: { category: string; kind: string; streak: number } | null
}

/** 推迟队列里的一条：同一工作区只留最后一次（后来的覆盖先来的，覆盖次数计入 coalesced）。 */
interface DeferredEntry {
  req: NormalizedReq
  category: string
  kind: string
  bucket: string
  at: number
}

/** 条数与点数这一对（记账单位是真实出站 HTTP 请求数，这两个数在闸里到处对账）。 */
interface Counters { requests: number; points: number }

/** 传输层报上来的一笔花费：条数与点数缺了或不是数都按 0 算（条数缺了就当 1 条，见 noteOutbound）。 */
interface OutboundReport { requests?: unknown; points?: unknown }

/** 裁决的结论（形状来自 policy.js 的 decide）：放行、降档还是推迟，外加一句原因。 */
interface GateDecision { verdict: string; reason: string }

/** 真去做事的那一步：返回它自己报的花费（会被拿来实现对账）。 */
type StepPerform = (step: unknown, ctx: { category: string; kind: string; bucket: string }) => unknown

/** 走完一步的结论：这一步真发了几条、调用方报了几条、这一桶还剩多少、现在哪一档、这步做出的东西。 */
interface StepOutcome {
  requests: number
  points: number
  claimed: Counters
  remaining: number
  tier: string
  result: unknown
}

/** 撞限流时报上来的那一笔：桶由请求决定，秒数由调用方给（被测系统给的数，按 unknown 收）。 */
interface RetryAfterSignal extends GateRequest { seconds?: unknown }

/** AI 工具那一档的准入输入：这一笔要花多少、要拆几片；缺了或不是数都按 0 算。 */
interface AiToolCall { points?: unknown; requests?: unknown; childTickets?: unknown }

/** 账本现在长什么样（闸只按形状用它，不 import 账本：两个文件由宿主接线拼起来）。 */
interface LedgerView {
  bucket: string
  allowance: number
  used: number
  remaining: number
  reserve: number
  tier: string
}

/** 记一笔真实花费时交给账本的东西：桶必给，条数与点数是 num() 归一过的数字。 */
interface LedgerSpendEntry { account: string; bucket: string; kind?: string; requests?: number; points?: number }

/** 闸实际用到账本的五条：多一条也不用，少一条接线时就当场抛。 */
interface LedgerShape {
  view(bucketName: string): LedgerView
  spend(entry: LedgerSpendEntry): { remaining: number; tier: string }
  noteRateLimited(bucketName: string, seconds: unknown, at: number): { bucket: string; until: number }
  hourOf(accountName: string): Counters
  syncDue(at?: unknown): boolean
}

/** 宿主日志出口（与 src/host 其余文件同一形状）：先问开关，关着连字段对象都不组装。 */
interface LogCtx {
  isEnabled(level: string): boolean
  fire(level: string, event: string, fields: unknown): void
}

/** 建一道闸的依赖：只有账本必给（缺了下面那条判断当场抛），时钟缺了用系统时钟，日志缺了不记。 */
interface GateDeps {
  ledger?: LedgerShape
  logCtx?: LogCtx | null
  now?: () => number
  hash8?: (value: unknown) => string
  budget?: unknown
}

/** 工作区状态能从外面改的那一格（现在只有「在不在用」）。 */
interface WorkspacePatch { active?: unknown }

/** 四个类别（谁在做事）。与 policy.js 的 RequestCategory 同一套取值。 */
export const GATE_CATEGORIES: readonly string[] = ['user-action', 'lifecycle', 'background', 'ai-tool']

/** 类别 → 记哪一档账。插件自己的刷新（后台与生命周期）记一档，人的动作与 AI 工具各记一档。 */
export const ACCOUNT_OF_CATEGORY: Readonly<Record<string, string>> = { 'user-action': 'user-action', 'lifecycle': 'plugin', 'background': 'plugin', 'ai-tool': 'ai-tool' }

/**
 * 调用点 → 类别。分类是本闸的第一件事：以后新加一个取数功能，先在这里给它一个身份，
 * 拿不到身份的按「后台」算（最先被牺牲的那一档，是最保守的兜底），并计入 stats().unclassified 让人看见。
 */
export const CALL_SITE_CATEGORIES: Readonly<Record<string, string>> = {
  'panel.refresh': 'user-action',      // 面板上的刷新按钮
  'panel.detail': 'user-action',       // 点开一张票、翻一页评论
  'panel.write': 'user-action',        // 发评论、认领、改标签、关闭、建票
  'workspace.enter': 'lifecycle',      // 切进一个工作区那一次（缓存先铺满，再补探）
  'workspace.linger': 'background',    // 刚离开 30 秒内的收尾节拍
  'probe.tick': 'background',          // 变化探测（活跃工作区那一下）
  'patch.apply': 'background',         // 行级补行（只取变的那几条）
  'reconcile.tick': 'background',      // 每 10 分钟一次的整池对账
  'chain.eval': 'background',          // 检查链求值（已改成事件驱动）
  'naming.sweep': 'background',        // 命名守护的兜底一跳
  'quota.sync': 'background',          // 每分钟读一次服务端剩余（不扣配额，但仍是真实出站）
  'tool.call': 'ai-tool',              // AI 通过我们的工具发起的调用
  'event.write': 'background',         // #723（T19）写完一笔触发的那次取数（write-event-subscription.js 发）
}

/** 请求种类 → 记哪一个桶。REST 数请求条数、GraphQL 数点数，两桶各自一份额度与档位。 */
export const BUCKET_OF_KIND: Readonly<Record<string, string>> = {
  'quota-read': 'rest', probe: 'rest', detail: 'rest', preflight: 'rest', chain: 'rest',
  naming: 'rest', write: 'rest', patch: 'graphql', rebuild: 'graphql', reconcile: 'graphql', 'tool-batch': 'graphql',
}

/**
 * 取一套裁决要用的数字（形状与 tests/verify-policy.js 里那份一致，两处同源）。
 * 自有常量（点数、条数、档位形状）出自 budget.js，时间常量出自中央 time-config，缺省时两边拼起来；
 * src 给了一整份就用给的那份（测试就这么注入）。
 * src 给了一整份就用给的那份（测试就这么注入），没给就用 budget.js 自己。
 * 断言成 budget.js 的整套形状只为让下面这些读法成立：键一个没加、一个没减，值原样读出来。
 */
export function policyLimits(src: unknown) {
  // 缺省源：budget.js 只剩自有常量与函数，时间常量走中央——两边拼成裁决吃的那一份。
  // 测试注入整套时走 src 那一支，不受影响；生产接线没给 budget 时走这里，缺了哪一块限流窗就算错。
  const b = (src || Object.assign({}, budget, {
    PROBE_INTERVAL_MS, PROBE_INTERVAL_YELLOW_MS, RECONCILE_INTERVAL_MS, REBUILD_MIN_INTERVAL_YELLOW_MS, CHAIN_BACKOFF_MS,
  })) as typeof budget & {
    PROBE_INTERVAL_MS: number; PROBE_INTERVAL_YELLOW_MS: number; RECONCILE_INTERVAL_MS: number;
    REBUILD_MIN_INTERVAL_YELLOW_MS: number; CHAIN_BACKOFF_MS: ReadonlyArray<number>;
  }
  return {
    probeIntervalMs: b.PROBE_INTERVAL_MS,
    probeIntervalYellowMs: b.PROBE_INTERVAL_YELLOW_MS,
    reconcileIntervalMs: b.RECONCILE_INTERVAL_MS,
    rebuildMinIntervalYellowMs: b.REBUILD_MIN_INTERVAL_YELLOW_MS,
    aiToolMaxPointsPerCall: b.AI_TOOL_MAX_POINTS_PER_CALL,
    aiToolMaxRequestsPerCall: b.AI_TOOL_MAX_REQUESTS_PER_CALL,
    aiToolMaxPointsPerHour: b.AI_TOOL_MAX_POINTS_PER_HOUR,
    aiToolMaxRequestsPerHour: b.AI_TOOL_MAX_REQUESTS_PER_HOUR,
    failureBackoffMs: b.CHAIN_BACKOFF_MS,
  }
}

/** 调用点 → 类别；给了类别就直接用它（校验取值）。两者都没有的按「后台」算，并计入漏分类计数。 */
export function classify(source: unknown, explicitCategory?: string) {
  if (explicitCategory) {
    if (GATE_CATEGORIES.indexOf(explicitCategory) < 0) throw new Error('没有这个类别：' + String(explicitCategory))
    return { category: explicitCategory, known: true }
  }
  const hit = CALL_SITE_CATEGORIES[String(source)]
  if (hit) return { category: hit, known: true }
  return { category: 'background', known: false }
}

/** 调用方报的任何数（条数、点数、秒数、片数）都从这里过：不是有限数就当 0。 */
function num(v: unknown): number { return (typeof v === 'number' && isFinite(v)) ? v : 0 }

/** 报数归一：数字 = 请求条数；对象取 requests/points；两者都没有算「没报数」（只按实测记账，不计对不上）。 */
function readReport(report?: number | OutboundReport | null): Counters | null {
  if (typeof report === 'number') return { requests: report, points: 0 }
  const r = report || {}
  const hasReq = typeof r.requests === 'number' && isFinite(r.requests)
  const hasPts = typeof r.points === 'number' && isFinite(r.points)
  if (!hasReq && !hasPts) return null
  return { requests: num(r.requests), points: num(r.points) }
}

/** 8 位十六进制短散列：只在日志里代替原文（路径、错误正文），不参与判定。 */
function shortHash(s: unknown): string {
  try {
    const t = String(s || '')
    let h = 5381
    for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
    return ('0000000' + h.toString(16)).slice(-8)
  } catch (e) { return '00000000' }
}

/**
 * 建一道闸。deps: { ledger, logCtx?, now?, hash8? }。
 * ledger 是本目录的账本（quota-ledger.js）—— 两个文件不互相 import：宿主接线的时候把它们拼起来，
 * 闸只按形状用它（view / spend / noteRateLimited / hourOf / syncDue）。
 */
export function createGate(deps?: GateDeps) {
  const opts = deps || {}
  // 账本在这里断言成整本形状：紧接着那条判断仍原样在运行时把不合格的账本当掉（接线出错就当场抛），
  // 断言只为让下面那些内层函数里的读法成立 —— TS 不把这里 const 的收窄带进内层函数，运行时不多不少一行。
  const ledger = opts.ledger as LedgerShape
  if (!ledger || typeof ledger.view !== 'function' || typeof ledger.spend !== 'function') {
    throw new Error('闸要一本账：deps.ledger 缺 view / spend 这两条')
  }
  const now = typeof opts.now === 'function' ? opts.now : Date.now
  const logCtx = opts.logCtx || null
  const hash8 = typeof opts.hash8 === 'function' ? opts.hash8 : shortHash
  const limits = policyLimits(opts.budget)

  const workspaces = new Map<string, WorkspaceState>()   // 工作区键 → { active, failuresSinceSuccess, rateLimitedUntil, backoffWindowStartedAt }
  const deferred = new Map<string, DeferredEntry>()     // 工作区键 → { req, category, kind, bucket, at }
  const stats = {
    accounted: { requests: 0, points: 0 },   // 闸记下来的（= 传输层真发的）
    transport: { requests: 0, points: 0 },   // 传输层报上来的（真发出去几条）
    claimed: { requests: 0, points: 0 },     // 调用方自己报的数（用来对账）
    mismatch: 0,                             // 报数与真发数对不上的次数
    sent: 0, deferred: 0, coalesced: 0, droppedExpired: 0, retryAfter: 0, unclassified: 0,
  }
  const byCategory: Record<string, number> = {}
  for (const c of GATE_CATEGORIES) byCategory[c] = 0

  function wsState(key: string): WorkspaceState {
    let s = workspaces.get(key)
    if (!s) { s = { active: false, failuresSinceSuccess: 0, rateLimitedUntil: 0, backoffWindowStartedAt: 0, lastFailure: null }; workspaces.set(key, s) }
    return s
  }

  function workspaceView(key: string) {
    const s = wsState(key)
    return { active: !!s.active, failuresSinceSuccess: s.failuresSinceSuccess, rateLimited: s.rateLimitedUntil > now(), backoffWindowStartedAt: s.backoffWindowStartedAt }
  }

  // #1008/#1218 复核补的失败归因：窗口里最近一次失败是谁（类别、种类、连续第几次），
  // 只在失败窗口内写入、成功时清空，纯记忆不参与裁决；窗口外回 null，日志对象因此不多长字段，
  // 正常时段的 refresh.decide 与从前一字不差。三个值都来自本闸自己的记忆，不查账本、不联网。
  function failureAttribution(key: string) { const s = wsState(key); return (s.failuresSinceSuccess > 0 && s.lastFailure) ? { failuresSinceSuccess: s.failuresSinceSuccess, backoffWindowStartedAt: s.backoffWindowStartedAt, lastFailureCategory: s.lastFailure.category, lastFailureKind: s.lastFailure.kind, failureStreak: s.lastFailure.streak } : null }
  function rememberFailure(key: string, category: string, kind: string, streak: number) { wsState(key).lastFailure = { category: category, kind: kind, streak: streak } }
  function forgetFailure(key: string) { const s = wsState(key); s.failuresSinceSuccess = 0; s.lastFailure = null }

  /** 裁决的输入：类别 + 种类 + 桶的档位与账 + 工作区状态。 */
  function inputFor(req: NormalizedReq) {
    const bucket = req.bucket
    const q = ledger.view(bucket)
    const s = wsState(req.workspaceKey)
    // 连续失败那一轮的窗口（#998）：到门槛之后哪一笔可以当探针放进来试，判据只有 failure-window.js 一份。
    const win = failureWindow.failureWindowOf(s)
    const trialDue = win.failures >= FAILURE_DEFER_AT && failureWindow.halfOpenTrialIsDue(
      win, now(), nextAttemptDelayMs(win.failures, limits), FAILURE_HALF_OPEN_DELAY_MS,
    )
    // 收窄到 policy 的取值联合：q.tier 来自账本形状（string），取值本身由 budget.js 生成、运行时不变。
    return {
      category: req.category as PolicyInput['category'], kind: req.kind as PolicyInput['kind'], tier: q.tier as PolicyInput['tier'],
      quota: { allowance: q.allowance, used: q.used, remaining: q.remaining, reserve: q.reserve },
      workspace: { active: !!s.active, failuresSinceSuccess: s.failuresSinceSuccess, rateLimited: s.rateLimitedUntil > now(), halfOpenTrialDue: trialDue },
    }
  }

  // 账本三个事件之一（按需级 P1）：这一笔的结论与原因。外层先判调试开关，关着连字段对象都不组装。
  // #1008/#1218：失败窗口里再补五个归因键（窗口外自动不加，正常时段的这一行与从前一字不差）。
  function fireDecide(req: NormalizedReq, verdict: string, reason: string, tier: string) { try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'refresh.decide', Object.assign({ category: req.category, kind: req.kind, verdict: verdict, reason: reason, tier: tier, cycle: req.cycle, keyHash: hash8(req.workspaceKey) }, failureAttribution(req.workspaceKey) || {})) } catch (eL) {} }

  // 账本三个事件之一（按需级 P1）：被跳过的那些（后台档被推迟、额度不足、过期丢弃）。
  // #1008/#1218：同样只在失败窗口里补五个归因键。
  function fireSkipped(key: string, kind: string, reason: string, pending: number) { try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'refresh.skipped', Object.assign({ keyHash: hash8(key), kind: kind, reason: reason, pending: pending }, failureAttribution(key) || {})) } catch (eL) {} }

  /** 只看结论不发送（界面与门禁都要能用同一套裁决问一句）。 */
  function decideFor(req?: GateRequest) {
    const r = normalize(req)
    return decide(inputFor(r), limits)
  }

  function normalize(req?: GateRequest): NormalizedReq {
    const r = req || {}
    const cls = classify(r.source, r.category)
    if (!cls.known) stats.unclassified += 1
    // REQUEST_KINDS 那份清单只收字符串；kind 缺了（撞限流那一笔就没有）与空串同结论（−1），
    // 所以这里断言成字符串只为过签名，判断本身一字未改。
    const kind = (REQUEST_KINDS as readonly string[]).indexOf(r.kind as string) >= 0 ? (r.kind as string) : 'probe'
    const bucket = (r.bucket === 'graphql' || r.bucket === 'rest') ? r.bucket : (BUCKET_OF_KIND[kind] || 'rest')
    return { source: r.source, category: cls.category, kind: kind, bucket: bucket, workspaceKey: String(r.workspaceKey || 'unknown'), plan: Array.isArray(r.plan) && r.plan.length ? r.plan : [{}], cycle: String(r.cycle || '') }
  }

  /**
   * 真发一步：这一步实际发出去的条数由这一步的计数器归属（并发的另一步记在它自己的计数器上）。
   * 失败也照样记账 —— 发出去的那几条就是已经花掉的额度，账不许因为失败就不记（I6）。
   */
  async function runStep(req: NormalizedReq, step: unknown, perform: StepPerform): Promise<StepOutcome> {
    let actual = { requests: 0, points: 0 }
    let reported = null
    let failure = null
    const m = await measureStep(function () { return perform(step, { category: req.category, kind: req.kind, bucket: req.bucket }) })
    if (m.thrown) failure = m.thrown
    // perform 回来的是未知形状（StepPerform 本来就这么定的），readReport 只收数字或对象；
    // 这里断言只为过签名，运行时 readReport 本来就能收任何东西（`|| {}` 兜底），一字未改。
    else reported = readReport(m.result as number | OutboundReport | null)
    actual = { requests: m.actual.requests, points: m.actual.points }
    if (reported) {
      stats.claimed.requests += reported.requests
      stats.claimed.points += reported.points
      if (reported.requests !== actual.requests || reported.points !== actual.points) stats.mismatch += 1
    }
    // 账记的是真发出去的那几条（传输层说了算），不是调用方报的数；报到哪儿去由账本按档与桶分开记。
    stats.accounted.requests += actual.requests
    stats.accounted.points += actual.points
    const account = ACCOUNT_OF_CATEGORY[req.category] || 'plugin'
    const after = ledger.spend({ account: account, bucket: req.bucket, kind: req.kind, requests: actual.requests, points: actual.points })
    if (failure) {
      // 一次真失败：计数加一，窗口从此刻重开（窗口长短的判据在 src/refresh/kernel/failure-window.ts）。
      const next = failureWindow.recordFailure({ failures: wsState(req.workspaceKey).failuresSinceSuccess, windowStartedAt: 0 }, now())
      const failed = wsState(req.workspaceKey)
      failed.failuresSinceSuccess = next.failures
      failed.backoffWindowStartedAt = next.windowStartedAt
      // #1008/#1218：把「最近这一次失败是谁」记进本工作区，下一次裁决与跳过落日志时带出去。
      rememberFailure(req.workspaceKey, req.category, req.kind, next.failures)
      throw failure
    }
    // 真成功：连续失败归零，归因一起清空（窗口已经关了，留着只会误导下一次读日志的人）。
    forgetFailure(req.workspaceKey)
    return { requests: actual.requests, points: actual.points, claimed: reported || { requests: 0, points: 0 }, remaining: after.remaining, tier: after.tier, result: m.result }
  }

  /**
   * 闸的唯一出口。req: { source|category, kind, bucket?, workspaceKey?, plan? }；perform(step) 真去发请求
   * 并**每条真实出站都先报一次 noteOutbound**，返回值是它自己报的花费（会被拿来实现对账）。
   */
  async function send(req: GateRequest, perform?: StepPerform) {
    const r = normalize(req)
    const v: GateDecision = decide(inputFor(r), limits)
    // 放了探针进来试的那一笔：窗口起点改成此刻（见 src/refresh/kernel/failure-window.ts）。
    // ① 这一笔要是失败，下一次等待从此刻重新算，不会连环重试；② 这一笔要是成功，下面的归零当场开锁。
    if (v.verdict === 'allow' && v.reason === 'failure-half-open') {
      wsState(r.workspaceKey).backoffWindowStartedAt = failureWindow.consumeHalfOpenTrial(now())
    }
    fireDecide(r, v.verdict, v.reason, ledger.view(r.bucket).tier)
    byCategory[r.category] = (byCategory[r.category] || 0) + 1
    if (v.verdict === 'defer') {
      const prev = deferred.get(r.workspaceKey)
      if (prev) stats.coalesced += 1
      deferred.set(r.workspaceKey, { req: r, category: r.category, kind: r.kind, bucket: r.bucket, at: now() })
      stats.deferred += 1
      fireSkipped(r.workspaceKey, r.kind, v.reason, deferred.size)
      // REASONS 是 policy.js 里那张「原因 → 给人看的一句话」，键是那几个固定原因；v.reason 是裁决给回来的字符串，
      // 查不到就是空串（下面 `|| ''` 就是这道兜底）。断言成字符串键的表只为过签名，兜底一字未改。
      return { sent: false, verdict: 'defer', reason: v.reason, detail: (REASONS as Readonly<Record<string, string>>)[v.reason] || '', requests: 0, points: 0 }
    }
    if (typeof perform !== 'function') throw new Error('闸放行了却没有发送函数：' + r.kind)
    let requests = 0
    let points = 0
    let remaining = 0
    let tier = 'green'
    let result = null   // #927：把这一步真做出来的东西原样带回去（面板取数那两路要用它的返回值）
    for (const step of r.plan) {
      const out = await runStep(r, step, perform)
      requests += out.requests
      points += out.points
      remaining = out.remaining
      tier = out.tier
      result = out.result
    }
    stats.sent += 1
    return { sent: true, verdict: v.verdict, reason: v.reason, detail: (REASONS as Readonly<Record<string, string>>)[v.reason] || '', requests: requests, points: points, remaining: remaining, tier: tier, steps: r.plan.length, result: result }
  }

  /** 传输层每真发一条就报一次（生产里挂在起 gh 进程那一层）。绕开闸发的那几条就靠它露出来。 */
  function noteOutbound(entry?: OutboundReport) {
    const e = entry || {}
    stats.transport.requests += num(e.requests) || 1
    stats.transport.points += num(e.points)
    try { noteStepOutbound(e) } catch (e2) {}
    return { requests: stats.transport.requests, points: stats.transport.points }
  }

  /** 撞上限流（含二级限流的 Retry-After）：桶降档 + 工作区标记 + 计数。 */
  function noteRetryAfter(signal?: RetryAfterSignal) {
    const s = signal || {}
    const r = normalize(s)
    const at = ledger.noteRateLimited(r.bucket, s.seconds, now())
    if (s.workspaceKey) wsState(r.workspaceKey).rateLimitedUntil = Math.max(wsState(r.workspaceKey).rateLimitedUntil, at.until)
    stats.retryAfter += 1
    return { bucket: r.bucket, until: at.until, tier: ledger.view(r.bucket).tier }
  }

  /** 推迟队列：到期的交回调用方重发，过期（5 分钟）的直接丢 —— 丢不是失败，也不重试。 */
  function drain(at?: unknown) {
    const t = (typeof at === 'number') ? at : now()
    const ready = []
    let dropped = 0
    for (const [key, e] of Array.from(deferred.entries())) {
      deferred.delete(key)
      if ((t - e.at) >= DEFER_EXPIRY_MS) { dropped += 1; stats.droppedExpired += 1; fireSkipped(key, e.kind, 'defer-expired', deferred.size) }
      else ready.push({ workspaceKey: key, req: e.req, ageMs: t - e.at })
    }
    return { ready: ready, dropped: dropped, pending: deferred.size }
  }

  /** AI 工具那一档的准入：超顶是「拒绝」，不是推迟；两种拒绝的文案必须分得开。 */
  function admitAiTool(call: AiToolCall, req?: GateRequest) {
    const r = normalize(Object.assign({ source: 'tool.call' }, req, { category: 'ai-tool' }))
    const q = ledger.view(r.bucket)
    const hour = ledger.hourOf('ai-tool')
    const quota = { allowance: q.allowance, used: q.used, remaining: q.remaining, reserve: q.reserve }
    const a = aiToolAdmission({ points: num(call.points), requests: num(call.requests) }, hour, quota, limits)
    const children = num(call.childTickets)
    const plan = children > 0 ? budget.shardPlan(children) : { shards: 1, perShard: budget.AI_TOOL_SHARD_SIZE }
    fireDecide(r, a.admitted ? 'allow' : 'reject', a.reason, q.tier)
    if (!a.admitted) fireSkipped(r.workspaceKey, 'tool-batch', a.reason, deferred.size)
    return { admitted: a.admitted, reason: a.reason, points: a.points, requests: a.requests, remaining: q.remaining,
      shards: plan.shards, perShard: plan.perShard, text: a.admitted ? '' : refusalTextRef(a, q, hour, plan, limits) }
  }

  /** 某个桶现在的降档安排（探测节拍、对账节拍、最短重建间隔），数值全部来自 budget.js。 */
  function planOf(bucketName?: string) {
    return degradePlanFor(ledger.view(bucketName || 'rest').tier as PolicyInput['tier'], limits)
  }

  /** 运行期漏网计数：传输层真发的条数减去闸记下来的条数。不为 0 就说明有人绕开了闸。 */
  function escaped() {
    return {
      requests: stats.transport.requests - stats.accounted.requests,
      points: stats.transport.points - stats.accounted.points,
    }
  }

  return {
    send: send,
    decideFor: decideFor,
    planOf: planOf,
    admitAiTool: admitAiTool,
    noteOutbound: noteOutbound,
    noteRetryAfter: noteRetryAfter,
    drain: drain,
    escaped: escaped,
    stats: function () {
      return {
        accounted: { requests: stats.accounted.requests, points: stats.accounted.points },
        transport: { requests: stats.transport.requests, points: stats.transport.points },
        claimed: { requests: stats.claimed.requests, points: stats.claimed.points },
        escaped: escaped(), mismatch: stats.mismatch, sent: stats.sent, deferred: stats.deferred,
        coalesced: stats.coalesced, droppedExpired: stats.droppedExpired, retryAfter: stats.retryAfter,
        unclassified: stats.unclassified, byCategory: Object.assign({}, byCategory), pending: deferred.size,
      }
    },
    workspaceView: workspaceView,
    setWorkspace: function (key: string, patch?: WorkspacePatch) {
      const s = wsState(String(key))
      if (patch && typeof patch.active === 'boolean') s.active = patch.active
      return workspaceView(String(key))
    },
  }
}
