// src/host/refresh/ledger.js —— 刷新机制的账本（#706 T2 第二批）
//
// 这个文件只干一件事：把「花了多少、还剩多少」记准，好让闸能说「这一笔能不能花」。
// 依据是定稿第三章（闸持有两个桶的账，每分钟从免费接口同步一次服务端剩余）与第四章
// （额度 35% / 1,750；读 70% / 1,225；写保底 30% / 525），以及第六章 I6：每一笔花费都记在账上，
// 谁发起、属于哪一档、花了多少、当时剩多少，真机上任何时候都能对出账。
//
// 四条口径，先说清，后面每一行都照它写：
//   1. **三个档位分开记**：插件后台（background）、人在界面的动作（user-action）、AI 工具（ai-tool）。
//      分档不是装饰：插件那一份是 1,750 的自限，AI 工具那一档从「留给 agent 的 65%」里出，
//      两边的顶不一样，混在一起记就再也分不出「是我花超了」还是「额度被别人用掉了」。
//   2. **REST 与 GraphQL 两个桶各自独立**：REST 数请求条数、GraphQL 数点数，两桶各自一份额度与档位，
//      互不折算。所以下面凡是「一桶」的东西都是按桶存的，绝没有「一共省了多少」这种数。
//   3. **记账单位是真实出站 HTTP 请求数**：分页、重试、兜底链、扇出都要算进去，调用方报几条就记几条
//      （闸那一侧负责核对调用方报的数与传输层真发的数是否一致）。
//   4. **读数取保守下界**：服务端读数最多落后一分钟，乐观取值会让插件以为自己还有钱、其实已经花过头。
//      所以剩余额度取两样里的小者：① 上一次读数减去同步之后本地已花；② 这一份额度自己还剩多少。
//      两次同步之间不加额度（时间过去不等于额度回来），并且限额是 0 或还没读到过读数时按「用满」处理
//      ——读不到就少花，不是多花（budget.ts 的 usedRatio 就是这么定的）。
//
// 这个文件不联网、不起定时器：同步服务端剩余读数的节拍由调用方按 budget.js 的 QUOTA_SYNC_INTERVAL_MS
// 问 `syncDue()`，真去打那次不扣配额的 `gh api rate_limit` 的是闸那一路（它也走闸、也记账）。
import { HOUR_MS, QUOTA_SYNC_INTERVAL_MS, hourlyAllowance, writeReserve, usedRatio, tierFor } from '../../shared/refresh/budget.js'

/** 三个档位（分开记账的名字）。 */
export const LEDGER_ACCOUNTS = ['plugin', 'user-action', 'ai-tool']

/** 两个桶（各自独立的计量单位：rest 记请求条数、graphql 记点数）。 */
export const LEDGER_BUCKETS = ['rest', 'graphql']

/** 同步服务端剩余读数的节拍（毫秒），值来自 budget.js —— 这里不另写一个数字。 */
export const SYNC_INTERVAL_MS = QUOTA_SYNC_INTERVAL_MS

function num(v) {
  return (typeof v === 'number' && isFinite(v)) ? v : 0
}

function emptyCounters() {
  return { requests: 0, points: 0 }
}

/**
 * 建一本账。deps: { now?, logCtx? }。
 * logCtx 是宿主那套日志出口（有 isEnabled 与 fire 两个方法）；没给就一条都不记。
 */
export function createLedger(deps) {
  const opts = deps || {}
  const now = typeof opts.now === 'function' ? opts.now : Date.now
  const logCtx = opts.logCtx || null

  const buckets = {}
  for (const name of LEDGER_BUCKETS) {
    buckets[name] = {
      name: name,
      allowance: 0,          // 这一份额度：上一次读数换算出来的这一小时上限
      used: 0,               // 本小时这一桶已经花掉多少（按桶自己的单位）
      spentSinceSync: 0,     // 上一次同步读数之后，本地又花掉多少
      reading: null,         // 上一次服务端读数 { limit, remaining }
      syncedAt: 0,
      resetAt: 0,
      rateLimitedUntil: 0,   // 撞过二级限流（Retry-After）之后的降档截止时刻
    }
  }
  const accounts = {}
  for (const name of LEDGER_ACCOUNTS) {
    accounts[name] = { pluginShare: name === 'plugin' }
    for (const b of LEDGER_BUCKETS) accounts[name][b] = emptyCounters()
  }
  const free = emptyCounters()   // 读剩余额度那些请求（不扣配额，但仍是真实出站，单独记一笔）
  const total = { requests: 0, points: 0 }
  let hourKey = Math.floor(now() / HOUR_MS)

  /** 跨过整点就把「本小时」的计数清零；同步留下的读数与「同步之后已花」不动（它们锚在读数上）。 */
  function rollHour() {
    const k = Math.floor(now() / HOUR_MS)
    if (k === hourKey) return
    hourKey = k
    for (const name of LEDGER_BUCKETS) buckets[name].used = 0
    for (const name of LEDGER_ACCOUNTS) for (const b of LEDGER_BUCKETS) accounts[name][b] = emptyCounters()
    free.requests = 0
    free.points = 0
  }

  function bucketOf(name) {
    const b = buckets[name]
    if (!b) throw new Error('账本没有这个桶：' + String(name) + '（只认 REST 与 GraphQL 两个桶）')
    return b
  }

  function accountOf(name) {
    const a = accounts[name]
    if (!a) throw new Error('账本没有这一档：' + String(name) + '（只认插件后台、人的动作、AI 工具三档）')
    return a
  }

  /** 保守下界：服务端读数减去同步之后的本地已花，与「这一份额度自己还剩多少」取小者。 */
  function lowerBound(b) {
    const share = Math.max(0, b.allowance - b.used)
    if (!b.reading) return 0
    const serverSide = Math.max(0, num(b.reading.remaining) - b.spentSinceSync)
    return Math.min(share, serverSide)
  }

  /** 闸要的那份账：额度、已用、剩余（保守下界）、写保底、档位。桶名给错直接抛，不静默返回一份假的。 */
  function view(bucketName) {
    rollHour()
    const b = bucketOf(bucketName)
    const rateLimited = b.rateLimitedUntil > now()
    const remainder = lowerBound(b)
    return {
      bucket: b.name,
      allowance: b.allowance,
      used: b.used,
      remaining: remainder,
      reserve: writeReserve(b.allowance),
      // 撞过二级限流就按红档处理：允许「主桶没用完也降档」（票面硬要求之一）。
      tier: rateLimited ? 'red' : tierFor(usedRatio(b.used, b.allowance)),
      rateLimited: rateLimited,
      syncedAt: b.syncedAt,
      synced: !!b.reading,
    }
  }

  /** 记一笔真实出站。entry: { account, bucket, kind, requests, points, via? }。 */
  function spend(entry) {
    rollHour()
    const e = entry || {}
    const a = accountOf(e.account)
    const b = bucketOf(e.bucket)
    const requests = num(e.requests)
    const points = num(e.points)
    const unit = (b.name === 'graphql') ? points : requests
    b.used += unit
    b.spentSinceSync += unit
    a[b.name].requests += requests
    a[b.name].points += points
    total.requests += requests
    total.points += points
    // 读剩余额度那一路不扣配额，但也算「插件花掉的一条真实请求」，单独记一笔（I6）。
    if (e.kind === 'quota-read') {
      free.requests += requests
      free.points += points
    }
    // 账本三个事件之一（按需级 P1）：谁发起、哪一档、花了多少、当时剩多少。外层先判调试开关。
    try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'quota.spend', { account: String(e.account), bucket: b.name, requests: requests, points: points, remaining: lowerBound(b) }) } catch (eL) {}
    return { remaining: lowerBound(b), tier: view(b.name).tier }
  }

  /** 服务端读数落账（每分钟一次）。readings: { rest: {limit, remaining, reset}, graphql: {...} }。 */
  function syncServer(readings, at) {
    rollHour()
    const t = (typeof at === 'number') ? at : now()
    const applied = []
    const src = readings || {}
    for (const name of LEDGER_BUCKETS) {
      const r = src[name]
      if (!r) continue
      const b = buckets[name]
      b.reading = { limit: num(r.limit), remaining: num(r.remaining) }
      b.allowance = hourlyAllowance(b.reading.remaining)
      b.syncedAt = t
      b.resetAt = num(r.reset) * (num(r.reset) > 1e12 ? 1 : 1000)
      b.spentSinceSync = 0
      applied.push(name)
    }
    return { applied: applied, syncedAt: t }
  }

  /** 该不该去同步了（节拍归调用方，节拍值归 budget.js）。还没有读过读数时返回真。 */
  function syncDue(at) {
    const t = (typeof at === 'number') ? at : now()
    for (const name of LEDGER_BUCKETS) {
      const b = buckets[name]
      if (!b.reading || (t - b.syncedAt) >= SYNC_INTERVAL_MS) return true
    }
    return false
  }

  /**
   * 撞上限流的降档信号。二级限流的 Retry-After 也算：拿到的秒数是多少就降多久，
   * 拿不到秒数就别调它——不许自己编一个时长（票面：允许「主桶没用完也降档」）。
   */
  function noteRateLimited(bucketName, seconds, at) {
    const s = num(seconds)
    if (!(s > 0)) throw new Error('降档信号要带服务端给的秒数（Retry-After），账本不替它编一个时长')
    const b = bucketOf(bucketName)
    const t = (typeof at === 'number') ? at : now()
    b.rateLimitedUntil = Math.max(b.rateLimitedUntil, t + s * 1000)
    return { bucket: b.name, until: b.rateLimitedUntil }
  }

  /** 这一档这一桶本小时已花。 */
  function hour(accountName, bucketName) {
    rollHour()
    const a = accountOf(accountName)
    const c = a[bucketName]
    if (!c) throw new Error('账本没有这一桶：' + String(bucketName))
    return { requests: c.requests, points: c.points }
  }

  /** 这一档本小时两个桶加起来花了多少（AI 工具那两组硬顶不分桶，要的就是这个数）。 */
  function hourOf(accountName) {
    rollHour()
    const a = accountOf(accountName)
    let requests = 0
    let points = 0
    for (const b of LEDGER_BUCKETS) { requests += a[b].requests; points += a[b].points }
    return { requests: requests, points: points }
  }

  /** 给界面与对账用的一份总览（都是保守下界，不含任何乐观推算）。 */
  function snapshot() {
    rollHour()
    const views = {}
    for (const name of LEDGER_BUCKETS) views[name] = view(name)
    const byAccount = {}
    for (const name of LEDGER_ACCOUNTS) {
      byAccount[name] = { hour: hourOf(name) }
      for (const b of LEDGER_BUCKETS) byAccount[name][b] = { requests: accounts[name][b].requests, points: accounts[name][b].points }
    }
    return { buckets: views, byAccount: byAccount, free: { requests: free.requests, points: free.points }, total: { requests: total.requests, points: total.points }, hourKey: hourKey }
  }

  return {
    spend: spend,
    syncServer: syncServer,
    syncDue: syncDue,
    noteRateLimited: noteRateLimited,
    view: view,
    hour: hour,
    hourOf: hourOf,
    snapshot: snapshot,
  }
}
