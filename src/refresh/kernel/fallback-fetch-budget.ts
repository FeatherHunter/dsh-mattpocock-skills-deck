/**
 * src/refresh/kernel/fallback-fetch-budget.ts —— 降级取数的请求预算、8 路并发闸与刷新节流窗口（票 #1689）
 *
 * 为什么住内核：REST 降级一轮会多打很多请求（窗口索引、薄行补取、整仓枚举、按需细节），
 * 今天这些请求各发各的，没有统一口径。这里把「一轮最多几条、同时最多几条在飞、降级常驻时
 * 探测与校准多久才允许再来一次」做成纯函数与账本，宿主与门禁共用同一份口径。
 *
 * 三条纪律：
 *   ① 本文件只放算法，不放数字：请求上限、并发数、两个节流窗口都由调用方注入
 *      （宿主从 src/refresh/kernel/host-budget.ts 的 FALLBACK_FETCH_LIMITS 取，与额度账本同源）。
 *      这里写死一个数字，改一处漏一处的那天预算表就开始骗人了。
 *   ② 不读时钟、不联网、不读盘：now 一律由调用方传进来，门禁才能把时间窗口压到毫秒级断言。
 *   ③ 账实一致：每条请求先 reserve（发出前记账）、回来 correct（按实际条数校正）、失败也
 *      backfill（失败的那条真的发出去过，照样记账）。读与写分两个桶记，永不混记。
 *
 * 一轮的边界：一次探测 / 一次整仓枚举 / 一次详情补取各开一本新账（createFallbackRoundBudget）。
 * 预算按「轮」算，不按小时算 —— 小时额度是额度闸（budget-admission.ts）的事，这里只管
 * 「这一轮最多发几条」，超了就不发（reserve 返回 null），不排队硬冲。
 */

/** 一轮取数的三种形态：常规增量（探测 + 薄行）、完整枚举（整仓重建）、单次详情补取。 */
export type FallbackRoundKind = 'increment' | 'enumerate' | 'detail'

/** 三种形态的唯一清单：门禁拿它枚举，新增形态必须同时补上限口径与门禁断言。 */
export const FALLBACK_ROUND_KINDS: readonly FallbackRoundKind[] = ['increment', 'enumerate', 'detail']

/**
 * 预算与节流的上限口径。全部由调用方注入，本文件不写数字。
 *
 * incrementRequests / enumerateRequests / detailClasses 是三种轮次的上限：
 * 增量 ≤3 条请求、整仓枚举 ≤16 条请求、单次详情补取 ≤5 类请求（类，不是条）。
 * maxConcurrency 是一轮里同时在飞的请求上限；probeIntervalMs / calibrationIntervalMs
 * 是降级常驻时的两个节流窗口（探测放宽到 60 秒、自动校准至少隔 10 分钟）。
 */
export interface FallbackFetchLimits {
  incrementRequests: number
  enumerateRequests: number
  detailClasses: number
  maxConcurrency: number
  probeIntervalMs: number
  calibrationIntervalMs: number
}

/** 账本分桶：读请求与写请求各记各的。写事件走额度闸的写桶，这里只提供同一套账的形状。 */
export type FallbackLedgerBucket = 'read' | 'write'

/** reserve 的入参：分桶、预扣条数（默认 1 条）、详情轮次的请求类名。 */
export interface FallbackReserveOptions {
  bucket?: FallbackLedgerBucket
  cost?: number
  classLabel?: string
}

/** 预扣成功后拿到的小票：correct / backfill 都要拿着它，防止同一笔被记两次。 */
export interface FallbackReserveToken {
  id: number
  kind: FallbackRoundKind
  bucket: FallbackLedgerBucket
  cost: number
  classLabel: string
}

/** 一个分桶的账：预扣合计、已定账合计、校正笔数、失败回填笔数、被拒笔数。 */
export interface FallbackBucketView {
  preCharged: number
  settled: number
  corrected: number
  backfilled: number
  refused: number
}

/** 一本账的当前样子。remaining 对详情轮是「还剩几类」，其余是「还剩几条请求」。 */
export interface FallbackBudgetView {
  kind: FallbackRoundKind
  limit: number
  used: number
  remaining: number
  refused: number
  classes: string[]
  overBudget: boolean
  open: number
  buckets: { read: FallbackBucketView; write: FallbackBucketView }
}

/** 一本轮的账本接口。 */
export interface FallbackRoundBudget {
  reserve(options?: FallbackReserveOptions): FallbackReserveToken | null
  correct(token: FallbackReserveToken, actualRequests: number): void
  backfill(token: FallbackReserveToken, actualRequests?: number): void
  view(): FallbackBudgetView
}

/** 一轮最多发几条（详情轮返回的是「几类」）。 */
export function roundLimitOf(kind: FallbackRoundKind, limits: FallbackFetchLimits): number {
  if (kind === 'increment') return limits.incrementRequests
  if (kind === 'enumerate') return limits.enumerateRequests
  return limits.detailClasses
}

/** 一个数是不是可用的毫秒/条数：有限、非负。 */
function usableNumber(value: unknown): boolean {
  return typeof value === 'number' && isFinite(value) && value >= 0
}

/** 开一本新的轮账。same 轮里的所有请求都从这一本里扣，跨轮不复用。 */
export function createFallbackRoundBudget(options: { kind: FallbackRoundKind; limits: FallbackFetchLimits }): FallbackRoundBudget {
  const kind = options.kind
  const limits = options.limits
  const limit = roundLimitOf(kind, limits)
  if (!usableNumber(limit)) throw new Error('降级取数预算：' + kind + ' 轮的上限没配置或不是非负数')
  let nextId = 1
  let charged = 0
  let settled = 0
  let refused = 0
  const classes: Set<string> = new Set()
  const tokens: Map<number, { token: FallbackReserveToken; open: boolean }> = new Map()
  const buckets = { read: bucketOf(), write: bucketOf() }
  function bucketOf(): FallbackBucketView {
    return { preCharged: 0, settled: 0, corrected: 0, backfilled: 0, refused: 0 }
  }
  function used(): number { return charged + settled }
  function remainingOf(): number {
    if (kind === 'detail') return Math.max(0, limit - classes.size)
    return Math.max(0, limit - used())
  }
  function reserve(input?: FallbackReserveOptions): FallbackReserveToken | null {
    const opts: FallbackReserveOptions = input || {}
    const bucket: FallbackLedgerBucket = opts.bucket === 'write' ? 'write' : 'read'
    const cost = opts.cost == null ? 1 : opts.cost
    if (!usableNumber(cost) || cost < 1) throw new Error('降级取数预算：预扣条数必须是正整数，拿到的是 ' + String(cost))
    const classLabel = typeof opts.classLabel === 'string' ? opts.classLabel : ''
    if (kind === 'detail') {
      // 详情轮的上限按「类」算：同一类补几次都只占一格，第 6 类拒发。
      if (!classLabel) throw new Error('降级取数预算：详情轮必须带请求类名（classLabel），否则 5 类上限无从判定')
      if (!classes.has(classLabel) && classes.size >= limit) { refused += 1; buckets[bucket].refused += 1; return null }
    } else if (used() + cost > limit) {
      // 增量 / 枚举轮：预扣之后超上限就当场拒发，一个字节都不许出去。
      refused += 1
      buckets[bucket].refused += 1
      return null
    }
    if (kind === 'detail') classes.add(classLabel)
    charged += cost
    buckets[bucket].preCharged += cost
    const token: FallbackReserveToken = { id: nextId, kind: kind, bucket: bucket, cost: cost, classLabel: classLabel }
    nextId += 1
    tokens.set(token.id, { token: token, open: true })
    return token
  }
  function settle(token: FallbackReserveToken, actualRequests: number, outcome: 'corrected' | 'backfilled'): void {
    if (!token || !token.id || !tokens.has(token.id)) throw new Error('降级取数预算：小票不认识（可能来自另一本账），拒绝记账')
    const entry = tokens.get(token.id)!
    if (!entry.open) throw new Error('降级取数预算：同一笔已经定过账了，拒绝记第二次')
    if (token.kind !== kind) throw new Error('降级取数预算：小票属于 ' + token.kind + ' 轮，不能记进 ' + kind + ' 轮')
    if (!usableNumber(actualRequests)) throw new Error('降级取数预算：实际条数必须是非负数，拿到的是 ' + String(actualRequests))
    entry.open = false
    charged -= token.cost
    settled += actualRequests
    buckets[token.bucket].settled += actualRequests
    buckets[token.bucket][outcome] += 1
  }
  function correct(token: FallbackReserveToken, actualRequests: number): void {
    settle(token, actualRequests, 'corrected')
  }
  function backfill(token: FallbackReserveToken, actualRequests?: number): void {
    // 失败也回填：这条请求真的发出去过（可能只发出预扣的条数），照样记进账里。
    settle(token, actualRequests == null ? token.cost : actualRequests, 'backfilled')
  }
  function view(): FallbackBudgetView {
    const nowUsed = used()
    return {
      kind: kind,
      limit: limit,
      used: nowUsed,
      remaining: remainingOf(),
      refused: refused,
      classes: Array.from(classes),
      // 详情轮的 limit 是类数，used 是条数，两者不可比；overBudget 只对按条算的轮有意义。
      overBudget: kind === 'detail' ? false : nowUsed > limit,
      open: tokens.size - countSettled(),
      buckets: { read: buckets.read, write: buckets.write },
    }
  }
  function countSettled(): number {
    let n = 0
    tokens.forEach(function (entry) { if (!entry.open) n += 1 })
    return n
  }
  return { reserve: reserve, correct: correct, backfill: backfill, view: view }
}

/** 并发闸的统计：同时在飞峰值、排队过的、放行总数、完成总数。 */
export interface FallbackConcurrencyView {
  maxConcurrency: number
  running: number
  queued: number
  peak: number
  admitted: number
  completed: number
}

/** 并发闸接口：run 包住一次真实请求，超限自动排队（先进先出），不丢请求。 */
export interface FallbackConcurrencyGate {
  run<T>(job: () => Promise<T>): Promise<T>
  view(): FallbackConcurrencyView
}

/**
 * 8 路并发闸：同时在飞的请求数超过上限就排队，先进先出。
 *
 * 为什么排队而不是拒发：并发上限管的是「别把宿主/服务端打爆」，一次轮里该发的请求一条都不能丢；
 * 请求预算（上面那本账）才是拒发的那一道闸。两件事分开，故障时才分得清是「太多了」还是「排不上」。
 */
export function createFallbackConcurrencyGate(options: { maxConcurrency: number }): FallbackConcurrencyGate {
  const max = options.maxConcurrency
  if (!usableNumber(max) || max < 1) throw new Error('降级取数并发闸：并发上限必须是正整数，拿到的是 ' + String(max))
  let running = 0
  let peak = 0
  let admitted = 0
  let completed = 0
  const waiting: Array<() => void> = []
  function wakeOne(): void {
    const next = waiting.shift()
    if (next) next()
  }
  async function run<T>(job: () => Promise<T>): Promise<T> {
    while (running >= max) {
      await new Promise<void>(function (resolve) { waiting.push(resolve) })
    }
    running += 1
    admitted += 1
    if (running > peak) peak = running
    try {
      return await job()
    } finally {
      running -= 1
      completed += 1
      wakeOne()
    }
  }
  function view(): FallbackConcurrencyView {
    return { maxConcurrency: max, running: running, queued: waiting.length, peak: peak, admitted: admitted, completed: completed }
  }
  return { run: run, view: view }
}

/**
 * 这一拍允许不允许发探测。
 *
 * 主路正常（degraded=false）时恒真 —— 调用方仍按原来的 5 秒节拍走，这里不改变既有行为。
 * 降级常驻时按 60 秒窗口判：距上一次真发出去的探测不足窗口就这一拍不发（返回 false），
 * 由调用方回一个「空拍」，不新增任何定时器。
 */
export function probeDue(nowMs: number, lastProbeAtMs: unknown, degraded: boolean, limits: FallbackFetchLimits): boolean {
  if (!degraded) return true
  if (!usableNumber(lastProbeAtMs)) return true
  return nowMs - (lastProbeAtMs as number) >= limits.probeIntervalMs
}

/**
 * 这一拍要不要做自动校准（整仓重取一次）。
 *
 * 降级常驻时至少隔 10 分钟；从没校准过（lastCalibrationAtMs 不是可用的数）时第一次就算到期，
 * 让降级一发生就有一次完整的基线，之后才按窗口节流。
 */
export function calibrationDue(nowMs: number, lastCalibrationAtMs: unknown, limits: FallbackFetchLimits): boolean {
  if (!usableNumber(lastCalibrationAtMs)) return true
  return nowMs - (lastCalibrationAtMs as number) >= limits.calibrationIntervalMs
}

/**
 * 这份快照是不是「降级常驻」：backend 组装快照时写 fallback:'rest' 表示走了 REST 兜底通道。
 * 只认这一个显式事实，不从错误文案或空列表去猜。
 */
export function fallbackStandingOf(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false
  return (snapshot as { fallback?: unknown }).fallback === 'rest'
}
