// src/refresh/rooms/host/quota-ledger.ts —— 刷新机制的账本（#706 T2 第二批 · #1446 起按后端分键）
//
// 这个文件只干一件事：把「哪个后端、哪个桶、花了多少、还剩多少」记准，好让闸能说「这一笔能不能花」。
// 依据是定稿第三章（闸持有额度桶的账，每分钟从免费接口同步一次服务端剩余）与第四章
// （额度 35% / 1,750；读 70% / 1,225；写保底 30% / 525），以及第六章 I6：每一笔花费都记在账上，
// 谁发起、属于哪一档、哪个后端、哪个桶、花了多少、当时剩多少，真机上任何时候都能对出账。
//
// 五条口径，先说清，后面每一行都照它写：
//   1. **账本的键是「后端 id + 桶名」**（规格 1439 第 8 节）：GitHub 的两个桶不能和 GitLab 的那一个桶
//      混在一格里，否则「我还剩多少」会被另一个后端的读数污染。桶由 ensureBackend 按后端口径建出来：
//      双桶建 rest + graphql、只计请求建 requests、离网与未知不建桶（没有额度这回事，就不摆一本空账）。
//   2. **三个档位分开记**：插件后台（plugin）、人在界面的动作（user-action）、AI 工具（ai-tool）。
//      分档不是装饰：插件那一份是 1,750 的自限，AI 工具那一档从「留给 agent 的 65%」里出，
//      两边的顶不一样，混在一起记就再也分不出「是我花超了」还是「额度被别人用掉了」。
//   3. **REST 与 GraphQL 两个桶各自独立**：REST 数请求条数、GraphQL 数点数，两桶各自一份额度与档位，
//      互不折算。GitLab 那种只计请求的后端只有 requests 一桶，条数照记。
//   4. **记账单位是真实出站 HTTP 请求数**：分页、重试、兜底链、扇出都要算进去，调用方报几条就记几条
//      （闸那一侧负责核对调用方报的数与传输层真发的数是否一致）。读剩余额度那一路（quota-read）
//      服务端不扣配额，所以只记进 free 那一格、不算进 used——把它算进 used 等于凭空压掉一截可用量。
//   5. **读数取保守下界**：服务端读数最多落后一分钟，乐观取值会让插件以为自己还有钱、其实已经花过头。
//      所以剩余额度取两样里的小者：① 上一次读数减去同步之后本地已花；② 这一份额度自己还剩多少。
//      两次同步之间不加额度（时间过去不等于额度回来），并且限额是 0 或还没读到过读数时按「用满」处理
//      ——读不到就少花，不是多花（host-budget.ts 的 usedRatio 就是这么定的）。
//      没有读数时 view 回 remaining:null，不编一个 0：0 会被当成「真的一滴都没有」，null 才是「还没量」。
//
// 两桶的额度换算沿用 host-budget.ts 的 35% 规则（这个文件不抄任何额度数字）；
// requests 桶的 allowance 直接用读数的 limit、不打折——请求额度是服务端给的硬值，
// 再打一次折等于凭空压掉可用量，那不是保守，是记错账。
//
// 这个文件不联网、不起定时器：同步服务端剩余读数的节拍由调用方按 QUOTA_SYNC_INTERVAL_MS
// 问 `syncDue(backendId)`，真去打那次不扣配额的读接口的是闸那一路（它也走闸、也记账）。
import { HOUR_MS, hourlyAllowance, writeReserve, usedRatio, tierFor } from '../../kernel/host-budget.js'
import { QUOTA_SYNC_INTERVAL_MS } from '../../../shared/time-config/src/values.js'
import { createPageBook } from './repo-page-accounting.js'
import type { BackendBudgetKind } from '../../kernel/backend-quota-model.js'
import type { QuotaTier } from '../../contract/refresh-ports.js'

// 页数实测账的类型与取值仍从本文件出（调用方原来怎么写还怎么写）：实现已搬至 ./repo-page-accounting.js。
export type { ObservedPages, RepoPageRecord } from './repo-page-accounting.js'
export { PAGE_PRICES, PAGE_UPPER_BOUND } from './repo-page-accounting.js'

// ---------------------------------------------------------------------------
// 类型：下面这些是账本自己的形状。
//
// 一句话说清「为什么标」：这个文件里的账按「后端 + 桶」与档位分开放，键是动态的，
// 不标类型时编译器只能把它们看成空对象，于是每一次按键取值都会被当成「用字符串索引一个没有
// 索引签名的对象」而报错；标上「键是字符串、值是这个形状」之后，每个键查出来的东西就有确定类型。
//
// 两条不能改的约定：
//   1. 桶的合法取值就是 LedgerBucketName 那三个，**不给别的名字开门**：
//      给错名字时运行时的行为是「当场抛错」（见 ensureBackend / spend / syncServer / hour），
//      类型只是把「合法名字」写下来，绝不把非法名字放行成安静的空账。
//   2. 从外面（服务端读数、调用方报的花费）进来的数字一律先经 num() 归一，
//      所以这些入参按 unknown 收：收窄发生在 num() 里，不在这里替调用方假设。
// ---------------------------------------------------------------------------

/** 三个记账档位：插件自己（plugin）、人在界面上的动作（user-action）、AI 工具（ai-tool）。 */
type LedgerAccountName = 'plugin' | 'user-action' | 'ai-tool'

/**
 * 账本里一个桶的名字（#1446）：rest 记请求条数、graphql 记点数、requests 记只计请求的后端的条数。
 * 同一个名字在哪个后端下有意义，由后端的额度模型决定，不由名字自己决定。
 */
export type LedgerBucketName = 'rest' | 'graphql' | 'requests'

/** 一份计数：条数与点数都记着，好让「REST 按条、GraphQL 按点」和总览对账各有各的数。 */
interface Counters { requests: number; points: number }

/** 服务端读数里一个桶的原始三个数：任一字段都可能缺或不是数，取用时一律经 num() 归一。 */
interface BucketReading { limit?: unknown; remaining?: unknown; reset?: unknown }

/** 每分钟一次的服务端读数：按桶名给，缺哪个桶就跳过哪个桶（skip 不是报错）。 */
type ServerReadings = Partial<Record<LedgerBucketName, BucketReading>>

/**
 * 一个桶的账。#1446 起桶属于某个后端，所以 backendId 与 bucket 都是只读的：
 * 建桶时定下来，之后不许改（改了就说明有人把某个后端的账搬到了另一个后端名下）。
 */
interface BucketState {
  readonly backendId: string
  readonly bucket: LedgerBucketName
  allowance: number          // 这一份额度：上一次读数换算出来的这一小时上限
  used: number               // 本小时这一桶已经花掉多少（按桶自己的单位）
  spentSinceSync: number     // 上一次同步读数之后，本地又花掉多少
  reading: { limit: number; remaining: number } | null   // 上一次服务端读数
  syncedAt: number
  resetAt: number
  rateLimitedUntil: number   // 撞过二级限流（Retry-After）之后的降档截止时刻
}

/** 一个档位的账：按桶键分开的计数（桶键 = 后端 + '/' + 桶名），外加「这是不是插件自己那一档」的标记。 */
interface AccountState {
  pluginShare: boolean
  byKey: Record<string, Counters>
}

/**
 * 记一笔花费的入参：档位、后端、桶必给（给错当场抛，见 accountOf / 桶缺席那条判断），
 * 条数与点数缺了算 0。backendId 是 #1446 加的键的一半：没有它就无法知道这笔账该记在哪个后端。
 */
export interface LedgerSpendEntry {
  account: string
  backendId: string
  bucket: string
  kind?: string
  requests?: unknown
  points?: unknown
}

/** 闸要的那份账：额度、已用、剩余（保守下界，没读数时是 null）、写保底、档位。 */
export interface LedgerBucketView {
  allowance: number
  used: number
  remaining: number | null
  reserve: number
  tier: QuotaTier | null
  rateLimited: boolean
  syncedAt: number
  synced: boolean
}

/**
 * ensureBackend 要的那一格：口径（kind），以及可选的 backendId 用于核对。
 * 只收这两格，是因为口径有两份形状真源（refresh/kernel 那份带 backendId 与 summary、
 * tracker/contract 那份不带），账本不该逼着装配方把两份捏成一份；账本只读 kind，其余不解释。
 */
export interface LedgerBackendModel {
  kind: string
  backendId?: string
}

/** ensureBackend 的结局：这次建了哪些桶、是不是因为口径变了而重建（方便调用方与门禁核对）。 */
export interface EnsureBackendResult {
  backendId: string
  kind: BackendBudgetKind
  buckets: LedgerBucketName[]
  created: LedgerBucketName[]
  rebuilt: boolean
}

/** 一个后端在账本里的登记：口径与它应有的桶（口径变了就按新的重建）。 */
interface BackendRecord {
  kind: BackendBudgetKind
  buckets: LedgerBucketName[]
}

/** 总览里每一档的账：本小时合计 + 每个桶键各一份；桶键是动态的，所以这里要索引签名。 */
interface AccountView {
  hour: Counters
  [key: string]: Counters
}

/** 宿主日志出口（与 src/host 其余文件同一形状）：先判开关、再组装字段对象。 */
interface LogCtx {
  isEnabled(level: string): boolean
  fire(level: string, event: string, fields: unknown): void
}

/** 建一本账的依赖：两个都可缺——缺了用系统时钟、一条日志都不记（原来就是这个行为）。 */
interface LedgerDeps {
  now?: () => number
  logCtx?: LogCtx | null
}

/** 三个档位（分开记账的名字）。标成只读数组：循环变量因此就是上面那个联合类型，不再是宽泛的 string。 */
export const LEDGER_ACCOUNTS: readonly LedgerAccountName[] = ['plugin', 'user-action', 'ai-tool']

/** 同步服务端剩余读数的节拍（毫秒），值来自 time-config —— 这里不另写一个数字。 */
export const SYNC_INTERVAL_MS = QUOTA_SYNC_INTERVAL_MS

/** 四种口径的合法名字（与额度模型那一份是同一个联合类型；这里只给运行时校验用）。 */
const BUDGET_KINDS: readonly BackendBudgetKind[] = ['two-buckets', 'requests-only', 'off-network', 'unknown']

/** 三种桶的名字（同样是运行时校验用）。 */
const BUCKET_NAMES: readonly LedgerBucketName[] = ['rest', 'graphql', 'requests']

/**
 * 每种口径建哪些桶（#1446 的形状真源）：
 *   - 双桶：rest 数请求、graphql 数点数，两桶各自一份额度；
 *   - 只计请求：一个 requests 桶；
 *   - 离网：不建桶——没有额度这回事，也不该摆一本「花了多少」的空账；真有人拿它记账，
 *     spend 会因为桶缺席当场抛，那正是我们要的「装配错当场炸」，不是静默丢账；
 *   - 未知：只建一个 requests 桶，作用是记「发出去几条请求」这件实测事实（规格第 8 节：
 *     未知模型只记请求数）。这个桶不接读数，所以剩余量与档位恒空，
 *     既不会凭空造出一份额度，也不会把真花掉的请求数丢掉。
 */
const BUCKETS_BY_KIND: Record<BackendBudgetKind, readonly LedgerBucketName[]> = {
  'two-buckets': ['rest', 'graphql'],
  'requests-only': ['requests'],
  'off-network': [],
  unknown: ['requests'],
}

/** 按口径取它应有的桶（返回只读数组，调用方不许改这份表）。 */
export function bucketsForKind(kind: BackendBudgetKind): readonly LedgerBucketName[] {
  return BUCKETS_BY_KIND[kind] || []
}

/** 后端标识归一：不分大小写、不吃首尾空白（把 'GitHub' 当成第二个后端，账就会分成两本、每本都缺一半）。 */
function normBackendId(v: unknown): string {
  return String(v == null ? '' : v).trim().toLowerCase()
}

/**
 * 桶键（#1446）：后端 + '/' + 桶名。账本的存储、闸的读法、总览的键都用这一个函数算，
 * 所以「键长什么样」只有这一处定义；别的文件想拼键，请调它，不要自己拼字符串。
 */
export function bucketKey(backendId: string, bucket: string): string {
  return normBackendId(backendId) + '/' + String(bucket == null ? '' : bucket)
}

/** 收未知输入、归一成数：非数字与 NaN 都算 0（账上不记「没报数」这种状态）。 */
function num(v: unknown): number {
  return (typeof v === 'number' && isFinite(v)) ? v : 0
}

/** 一份全零的计数（每次给新对象：账本里的计数格不许共用一个会被别人改掉的对象）。 */
function emptyCounters(): Counters {
  return { requests: 0, points: 0 }
}

/** 一个桶名是不是合法的三种桶之一。 */
function isBucketName(v: string): v is LedgerBucketName {
  return BUCKET_NAMES.indexOf(v as LedgerBucketName) >= 0
}

/** 从额度模型里读出口径；模型缺了或口径不认识就当场抛（装配错不许被当成「未知后端」糊过去）。 */
function kindOf(model?: LedgerBackendModel): BackendBudgetKind {
  const raw = model && typeof model.kind === 'string' ? model.kind : ''
  if (BUDGET_KINDS.indexOf(raw as BackendBudgetKind) >= 0) return raw as BackendBudgetKind
  throw new Error('ensureBackend 要一份后端额度模型（kind 只认 two-buckets / requests-only / off-network / unknown），实得 ' + JSON.stringify(raw))
}

/**
 * 建一本账。deps: { now?, logCtx? }。
 * logCtx 是宿主那套日志出口（有 isEnabled 与 fire 两个方法）；没给就一条都不记。
 */
export function createLedger(deps?: LedgerDeps) {
  const opts = deps || {}
  const now = typeof opts.now === 'function' ? opts.now : Date.now
  const logCtx = opts.logCtx || null

  // 桶按「后端 + 桶名」存。Map 而不是普通对象：键里带 '/'，用 Map 就不会与对象的原型链、
  // 特殊键名（__proto__ 之类）纠缠，而且删桶（口径变了重建）是一条 delete 的事。
  const buckets = new Map<string, BucketState>()
  // 每个后端登记一次口径与它应有的桶：ensureBackend 靠它做到幂等与「口径变了清旧桶重建」。
  const backends = new Map<string, BackendRecord>()
  const accounts: Record<string, AccountState> = {}
  for (const name of LEDGER_ACCOUNTS) accounts[name] = { pluginShare: name === 'plugin', byKey: {} }
  const free = emptyCounters()   // 读剩余额度那些请求（不扣配额，但仍是真实出站，单独记一笔）
  const total = { requests: 0, points: 0 }
  let hourKey = Math.floor(now() / HOUR_MS)

  /** 跨过整点就把「本小时」的计数清零；同步留下的读数与「同步之后已花」不动（它们锚在读数上）。 */
  function rollHour() {
    const k = Math.floor(now() / HOUR_MS)
    if (k === hourKey) return
    hourKey = k
    // 所有后端的桶都要清：漏掉一个，下一次账就会把上一小时的花费又算一遍。
    for (const b of buckets.values()) b.used = 0
    // 各档的每个桶键计数也清零。这里是把已有的计数格归零，不是把格删掉：
    // 删掉之后 hour('plugin', 'github/rest') 会在小时交界处突然抛「没有这一桶」，那是噪音不是信号。
    for (const name of LEDGER_ACCOUNTS) {
      const a = accounts[name]
      for (const key of Object.keys(a.byKey)) {
        a.byKey[key].requests = 0
        a.byKey[key].points = 0
      }
    }
    free.requests = 0
    free.points = 0
  }

  /** 按档位名取一份账；名字不认识就当场抛，理由同上。 */
  function accountOf(name: string) {
    const a = accounts[name]
    if (!a) throw new Error('账本没有这一档：' + String(name) + '（只认插件后台、人的动作、AI 工具三档）')
    return a
  }

  /** 这个后端现在有哪些桶（没有登记过就是空数组，不编一份默认桶出来）。 */
  function bucketsOf(backendId: string): LedgerBucketName[] {
    const rec = backends.get(normBackendId(backendId))
    return rec ? rec.buckets.slice() : []
  }

  /** 建一个桶，并给三个档位各开一格计数；已经存在就不动它（幂等靠这一点）。 */
  function addBucket(backendId: string, bucket: LedgerBucketName): boolean {
    const key = bucketKey(backendId, bucket)
    if (buckets.has(key)) return false
    buckets.set(key, {
      backendId: normBackendId(backendId),
      bucket: bucket,
      allowance: 0,
      used: 0,
      spentSinceSync: 0,
      reading: null,
      syncedAt: 0,
      resetAt: 0,
      rateLimitedUntil: 0,
    })
    for (const name of LEDGER_ACCOUNTS) {
      const a = accounts[name]
      if (!a.byKey[key]) a.byKey[key] = emptyCounters()
    }
    return true
  }

  /** 丢掉一个桶连同各档记在它上面的计数（唯一会删桶的地方是 ensureBackend 的口径变更）。 */
  function dropBucket(backendId: string, bucket: LedgerBucketName): void {
    const key = bucketKey(backendId, bucket)
    buckets.delete(key)
    for (const name of LEDGER_ACCOUNTS) delete accounts[name].byKey[key]
  }

  /**
   * 按后端口径建桶（#1446）。幂等：同一后端、同一口径再调一次，桶与读数原样留着，只回 created:[]。
   * 口径变了就先把旧桶（连同旧读数）清掉再按新口径重建——旧口径的读数放在新桶里是错的账，
   * 留着比清掉更危险。返回里带着这次建了什么，方便装配方与门禁核对。
   */
  function ensureBackend(backendId: string, model?: LedgerBackendModel): EnsureBackendResult {
    const id = normBackendId(backendId)
    if (!id) throw new Error('ensureBackend 要后端标识：账本按「后端 + 桶」记账，没有后端就分不出这是谁的账')
    const kind = kindOf(model)
    // 模型自报的后端与这次要建的后端不一致，说明装配时把某个后端的花钱口径装到了另一个后端名下，
    // 建出来的桶会记错账。当场抛，不要等第一笔花费再发现。
    const declared = model && typeof model.backendId === 'string' ? normBackendId(model.backendId) : ''
    if (declared && declared !== id) {
      throw new Error('ensureBackend 收到的是「' + declared + '」的花钱口径，却要建在「' + id + '」名下（装配错，账本不替它猜）')
    }
    const prev = backends.get(id)
    if (prev && prev.kind === kind) {
      return { backendId: id, kind: kind, buckets: prev.buckets.slice(), created: [], rebuilt: false }
    }
    if (prev) for (const name of prev.buckets) dropBucket(id, name)
    const next = bucketsForKind(kind).slice()
    backends.set(id, { kind: kind, buckets: next })
    const created: LedgerBucketName[] = []
    for (const name of next) if (addBucket(id, name)) created.push(name)
    return { backendId: id, kind: kind, buckets: next.slice(), created: created, rebuilt: !!prev }
  }

  /** 保守下界：服务端读数减去同步之后的本地已花，与「这一份额度自己还剩多少」取小者。 */
  function lowerBound(b: BucketState) {
    const share = Math.max(0, b.allowance - b.used)
    if (!b.reading) return 0
    const serverSide = Math.max(0, num(b.reading.remaining) - b.spentSinceSync)
    return Math.min(share, serverSide)
  }

  /** 一份「还没量到」的账：#1446 定稿形状，remaining/tier 用 null 表示「不知道」，不拿 0 冒充。 */
  function emptyView(): LedgerBucketView {
    return { allowance: 0, used: 0, remaining: null, reserve: 0, tier: null, rateLimited: false, syncedAt: 0, synced: false }
  }

  // 页数实测账已搬至 ./repo-page-accounting.js（#1255）：键的维度不一样（按仓库，不按后端 × 桶），
  // 调用方也不同（只在估算与总览里读）。这里只持有实例，方向是 quota-ledger → repo-page-accounting，反向不依赖。
  const pageBook = createPageBook({ now: now })

  /**
   * 闸要的那份账：额度、已用、剩余（保守下界）、写保底、档位。
   * 没建这个桶、或建了但还没读到读数时，回一份全空的账（synced:false、remaining:null）——
   * 不抛错是刻意的：闸在首次同步之前就要能做裁决，那时「不知道」是正常状态。
   */
  function view(backendId: string, bucket: string): LedgerBucketView {
    rollHour()
    const b = buckets.get(bucketKey(backendId, bucket))
    if (!b || !b.reading) return emptyView()
    const rateLimited = b.rateLimitedUntil > now()
    const remainder = lowerBound(b)
    return {
      allowance: b.allowance,
      used: b.used,
      remaining: remainder,
      // requests 桶没有「留给写操作」这回事（请求额度不分读写），写保底恒 0。
      reserve: b.bucket === 'requests' ? 0 : writeReserve(b.allowance),
      // 撞过二级限流就按红档处理：允许「主桶没用完也降档」（票面硬要求之一）。
      // 额度还没量出来（allowance 为 0）时不算档位：算出来的档位只会是「用满」，那是瞎猜。
      tier: b.allowance > 0 ? (rateLimited ? 'red' : tierFor(usedRatio(b.used, b.allowance))) : null,
      rateLimited: rateLimited,
      syncedAt: b.syncedAt,
      synced: true,
    }
  }

  /**
   * 记一笔真实出站。entry: { account, backendId, bucket, kind, requests, points }。
   * 桶必须已经由 ensureBackend 建出来：桶缺席说明装配漏了建桶，或这笔花费被记到了一个
   * 根本不该有桶的后端上——两种情况都当场抛，不许静默丢账（丢掉的账再也对不回来）。
   */
  function spend(entry: LedgerSpendEntry) {
    rollHour()
    const e = entry || ({} as LedgerSpendEntry)
    const a = accountOf(e.account)
    const id = normBackendId(e.backendId)
    const b = buckets.get(bucketKey(id, e.bucket))
    if (!b) throw new Error('账本没有这个桶：' + bucketKey(id, e.bucket) + '（先 ensureBackend 建桶；装配错不许静默丢账）')
    const requests = num(e.requests)
    const points = num(e.points)
    // 计量单位由桶决定：graphql 记点数，rest 与 requests 记请求条数。两桶互不折算。
    const unit = b.bucket === 'graphql' ? points : requests
    if (e.kind === 'quota-read') {
      // 读剩余额度那一路服务端不扣配额：只进 free 那一格，不算进 used 与 spentSinceSync，
      // 否则每同步一次读数就凭空压掉一截可用量（与账本「记实际花费」的口径相反）。
      free.requests += requests
      free.points += points
    } else {
      b.used += unit
      b.spentSinceSync += unit
    }
    // 分档计数与总量照记：quota-read 也是真实出站，I6 要求能对出「这一小时一共发出去多少条」。
    const c = a.byKey[bucketKey(id, b.bucket)]
    c.requests += requests
    c.points += points
    total.requests += requests
    total.points += points
    // 账本三个事件之一（按需级 P1）：谁发起、哪个后端、哪一档、花了多少、当时剩多少。外层先判调试开关。
    try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'quota.spend', { account: String(e.account), backendId: id, bucket: b.bucket, requests: requests, points: points, remaining: lowerBound(b) }) } catch (eL) { /* 日志不许影响记账 */ }
    return { remaining: lowerBound(b), tier: view(id, b.bucket).tier }
  }

  /**
   * 服务端读数落账（每分钟一次）：只认这个后端自己的桶。
   * 传进别的后端的桶（例如把 GitHub 的 rest/graphql 读数交给 GitLab 那本账）直接抛：
   * 那种错会写出一本看着正常、其实全是别人额度的假账。
   */
  function syncServer(backendId: string, readings?: ServerReadings, at?: unknown) {
    rollHour()
    const id = normBackendId(backendId)
    const t = (typeof at === 'number') ? at : now()
    const src = readings || {}
    const owned = bucketsOf(id)
    const applied: LedgerBucketName[] = []
    for (const key of Object.keys(src)) {
      if (!isBucketName(key)) throw new Error('账本不认识这个桶：' + key + '（只认 rest / graphql / requests）')
      if (owned.indexOf(key) < 0) throw new Error('这个桶不属于后端 ' + id + '：' + key + '（先 ensureBackend 建桶；读数不许跨后端落账）')
      const r = src[key]
      if (!r) continue
      const b = buckets.get(bucketKey(id, key))
      if (!b) continue
      b.reading = { limit: num(r.limit), remaining: num(r.remaining) }
      // 两桶按 35% 规则换算（算式在 host-budget.ts）；requests 桶直接用服务端给的 limit，
      // 不打折：请求额度是硬值，再打一次折等于凭空压掉可用量，不是保守而是记错。
      b.allowance = key === 'requests' ? b.reading.limit : hourlyAllowance(b.reading.remaining)
      b.syncedAt = t
      b.resetAt = num(r.reset) * (num(r.reset) > 1e12 ? 1 : 1000)
      b.spentSinceSync = 0
      applied.push(key)
    }
    return { applied: applied, syncedAt: t }
  }

  /** 这个后端该不该去同步了（节拍归调用方，节拍值归 time-config）。还没有读过读数时返回真。 */
  function syncDue(backendId: string, at?: unknown) {
    rollHour()
    const t = (typeof at === 'number') ? at : now()
    for (const name of bucketsOf(backendId)) {
      const b = buckets.get(bucketKey(backendId, name))
      if (!b) continue
      if (!b.reading || (t - b.syncedAt) >= SYNC_INTERVAL_MS) return true
    }
    return false
  }

  /**
   * 撞上限流的降档信号。二级限流的 Retry-After 也算：拿到的秒数是多少就降多久，
   * 拿不到秒数就别调它——不许自己编一个时长（票面：允许「主桶没用完也降档」）。
   * 桶缺席照样抛：降档信号记到不存在的桶上，下一次读那一桶时它早就没了，等于静默丢弃。
   */
  function noteRateLimited(backendId: string, bucket: string, seconds: unknown, at?: unknown) {
    const s = num(seconds)
    if (!(s > 0)) throw new Error('降档信号要带服务端给的秒数（Retry-After），账本不替它编一个时长')
    const id = normBackendId(backendId)
    const b = buckets.get(bucketKey(id, bucket))
    if (!b) throw new Error('账本没有这个桶：' + bucketKey(id, bucket) + '（降档信号不能记到不存在的桶上）')
    const t = (typeof at === 'number') ? at : now()
    b.rateLimitedUntil = Math.max(b.rateLimitedUntil, t + s * 1000)
    return { bucket: b.bucket, until: b.rateLimitedUntil }
  }

  /** 这一档这一桶本小时已花。键给错照样当场抛（账本键就是 bucketKey 的产物，例如 github/rest）。 */
  function hour(accountName: string, key: string) {
    rollHour()
    const a = accountOf(accountName)
    const c = a.byKey[key]
    if (!c) throw new Error('账本没有这一桶：' + String(key) + '（键是「后端/桶名」，例如 github/rest）')
    return { requests: c.requests, points: c.points }
  }

  /** 这一档在这个后端的所有桶加起来花了多少（AI 工具那两组硬顶不分桶，要的就是这个数）。 */
  function hourOf(accountName: string, backendId: string) {
    rollHour()
    const a = accountOf(accountName)
    const id = normBackendId(backendId)
    let requests = 0
    let points = 0
    for (const name of bucketsOf(id)) {
      const c = a.byKey[bucketKey(id, name)]
      if (!c) continue
      requests += c.requests
      points += c.points
    }
    return { requests: requests, points: points }
  }

  /** 给界面与对账用的一份总览（都是保守下界，不含任何乐观推算）。键是桶键（后端/桶名）。 */
  function snapshot() {
    rollHour()
    const views: Record<string, LedgerBucketView> = {}
    for (const key of buckets.keys()) {
      const b = buckets.get(key)
      if (b) views[key] = view(b.backendId, b.bucket)
    }
    const byAccount: Record<string, AccountView> = {}
    for (const name of LEDGER_ACCOUNTS) {
      const a = accounts[name]
      const hourTotal = emptyCounters()
      const row: AccountView = { hour: hourTotal }
      for (const key of Object.keys(a.byKey)) {
        const c = a.byKey[key]
        row[key] = { requests: c.requests, points: c.points }
        hourTotal.requests += c.requests
        hourTotal.points += c.points
      }
      byAccount[name] = row
    }
    // 页数实测也进总览：拼法在 repo-page-accounting.ts 的 snapshotPages() 里，与拆分前一字相同。
    const pages = pageBook.snapshotPages()
    return { buckets: views, byAccount: byAccount, free: { requests: free.requests, points: free.points }, total: { requests: total.requests, points: total.points }, pages: pages, hourKey: hourKey }
  }

  return {
    ensureBackend: ensureBackend,
    bucketsOf: bucketsOf,
    view: view,
    spend: spend,
    syncServer: syncServer,
    syncDue: syncDue,
    noteRateLimited: noteRateLimited,
    hour: hour,
    hourOf: hourOf,
    snapshot: snapshot,
    notePages: pageBook.notePages,
    pagesFor: pageBook.pagesFor,
    estimateRebuild: pageBook.estimateRebuild,
    worstRebuild: pageBook.worstRebuild,
    pageReport: pageBook.pageReport,
  }
}
