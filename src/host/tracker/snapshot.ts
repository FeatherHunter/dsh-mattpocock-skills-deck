// src/host/tracker/snapshot.ts —— 从同目录 snapshot.js 逐行转写而来，只加类型标注与注释，运行时逻辑一个字未动。
//
// 为什么要转写这一份：宿主编排 composeSnapshot 是快照组装的持有者，转成 TypeScript 后
//   调用方能按类型取用编排器，缓存键、版号与降级标记的口径仍与原来逐行一致。
// 什么约定不能改：
//   1. snapshot 不进 OpName：它是宿主编排便利函数，不是后端操作；children 用 list 组合，deck 由 host 计算。
//   2. 缓存只缓存数据，绝不缓存能力判定；可选后端快路径只接受完整数组，否则回落 list。
//   3. 同池不分片：拉取请求与普通工单同池，身份靠池内标识区分，不互相吞；组装只做直通，不补默认值。
//   4. 数字与全不全由这一层写进 deck：counts 问后端要，拿不到一律按拿不到处理，不猜数。
//   5. 相对导入一律保留 .js 后缀，运行时由 scripts/ts-hook.mts 改指同名 .ts，本文件不改说明符。
//   6. 只写可剥离类型：类型一律经 import type 引入，不新增任何运行时边。

import { ERROR_KIND } from '../../tracker/contract/vocabulary.js'
import { deriveDeck } from '../../tracker/deck-derive.js'
// 快照与依赖边两份缓存的缺省存活时间住中央 YAML（config/ttl.yaml 的 snapshotTtlMs 键，注释写着
// 「快照组合器的缓存有效期：5 秒」）：这里直接读中央常量，不再造新本地名，调时间改 YAML。
// 路径走域构建产物写法，值由 tests/verify-time-config.ts 看守一致。
import { SNAPSHOT_TTL_MS } from '../../shared/time-config/src/values.js'
import { assembleSnapshot, failKindOfListError } from './snapshotAssemble.js'
import { snapshotVersionOf } from './snapshotVersion.js'

// 类型只做编译期约束，不产生运行时引用：对外形状以共享层为准，内部动态行一律按 any 收。
import type { Issue, RepositoryRef, Snapshot } from '../../shared/tracker/shape.js'

// 本域 types 为空，CommonJS 的 require 声明随 @types/node 一起缺席；运行时在 ESM 下取不到 require
// 会直接抛错并走进下面的 catch 回退分支。按存在声明只为过编译器，不产生运行时代码，行为与原来一致。
declare const require: (id: string) => any


// 池子里「工单」有多少行（拉取请求不算工单）—— #689 判定「这份行数据全不全」用的第一个数。
// 池子 = 各地图的子票并集 + 未挂图的票（map 节点本身是容器，不算一行票）。
function poolTicketCountOf(snapshot: any): number {
  let n = 0
  const put = (rows: any): void => { for (const t of (Array.isArray(rows) ? rows : [])) if (t && t.isPullRequest !== true) n++ }
  for (const m of (snapshot && Array.isArray(snapshot.maps) ? snapshot.maps : [])) put(m && m.tickets)
  put(snapshot && snapshot.issues)
  return n
}

// 向后端要计数（契约的 counts op）。拿不到一律返回 null（没实现的后端由注册表补桩、回 unsupported；
// 配额/网络/形状不对同样算拿不到）—— 调用方据此退回派生值并把 deck.partial 置真，绝不猜一个数出来。
// 契约里写明了「unsupported 不进缓存」（G5）：这里也不缓存，每次重建照问（编排层本来就会重建）。
async function countsFromBackend(tracker: any, ref: RepositoryRef, ctx: any): Promise<{ open: number; closed: number; total: number } | null> {
  if (!tracker || typeof tracker.counts !== 'function') return null
  try {
    const r = await tracker.counts(ref, {}, ctx)
    if (!r || r.ok !== true) return null
    const d = r.data || {}
    const isCount = (v: unknown): boolean => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && Math.floor(v) === v)
    if (!isCount(d.open) || !isCount(d.closed) || !isCount(d.total)) return null
    return { open: d.open, closed: d.closed, total: d.total }
  } catch (e) {
    return null
  }
}

// 编排器依赖：tracker 注册表实例（或等价 get），缓存时长与日志上下文均可选。
interface SnapshotComposerRegistry {
  get: (id: string) => any
}

// —— 额度读数（#1446）——
// 快照 refresh 里的 tier / deferred / paused / notRefreshing 四格说的是刷新闸自己的账；
// 「这个后端还剩多少额度」是另一件事，由宿主的刷数预算按后端报上来（生产者在 refresh-runtime 的
// budgetState，接线归 Lead）。这一层只做搬运与形状校验：拿到就写进 refresh.backend，拿不到就不写这一格。
// 为什么不写一个空壳：界面看到「没有 backend」会说「读数还没同步上来」；若塞 remaining: 0，
// 界面就会报假耗尽 —— 不知道和耗尽必须分得开。
// 但「模型未知」（后端声明 unknown，或声明了本版不认识的口径）不是「没有读数」：#1455 起它是合法的
// 一档，必须原样送到界面 —— 旧的白名单少了这个词，未知模型会被整格丢掉，面板静默得像「没有额度这回事」。
// 字段只增不改：四个旧格子的语义、取值与次序一字不动，老客户端读不到 backend 也不会受影响。
export type RefreshBudgetKind = 'two-buckets' | 'requests' | 'none' | 'unknown'
export type RefreshBudgetReason = 'not-measured' | 'unavailable' | 'unsupported'
export interface RefreshBudgetBucket {
  remaining: number
  limit: number
}
export interface RefreshBackendBudget {
  id: string
  budgetKind: RefreshBudgetKind
  readKnown: boolean
  offNetwork: boolean
  buckets?: { rest?: RefreshBudgetBucket; graphql?: RefreshBudgetBucket }
  requests?: RefreshBudgetBucket
  reason?: RefreshBudgetReason
}
// 生产者可以只回读数本身，也可以回 {ok, readout} 这层包装（与 workRouteTableReadout 同一种口子）；
// 只回 null 表示「这一趟拿不到」，编排器保持旧形状。
export type BudgetReadout = Omit<RefreshBackendBudget, 'id'>
type BudgetReadoutEnvelope = { ok?: boolean; readout?: BudgetReadout }

interface SnapshotComposerOpts {
  snapshotTtl?: number
  depsTtl?: number
  logCtx?: { fire: (...args: any[]) => unknown; isEnabled: (...args: any[]) => boolean }
  // 读某个后端当前的额度读数；拿不到就回 null（或干脆不接这个口子）。抛错按拿不到处理，不许打断快照重建。
  budgetReadout?: (backendId: string) => BudgetReadout | BudgetReadoutEnvelope | null | undefined | Promise<BudgetReadout | BudgetReadoutEnvelope | null | undefined>
}

// 读数里的数字只认「非负整数」：额度是条数，出现小数、负数或 NaN 说明上游给的东西不是读数，
// 当成拿不到比当成 0 安全（界面只会说「还没同步上来」，不会报假耗尽）。
// 'unknown' 在这一份白名单里是「模型这一层就不知道」，与「读数这次没拿到」是两件事（#1455）：
// 前者要送到界面说「未知」，后者不写 backend 让界面说「还没同步」。
const BUDGET_KINDS: string[] = ['two-buckets', 'requests', 'none', 'unknown']
function isBudgetCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && Math.floor(v) === v
}
function budgetBucketOf(v: any): RefreshBudgetBucket | null {
  if (!v || typeof v !== 'object') return null
  if (!isBudgetCount(v.remaining) || !isBudgetCount(v.limit)) return null
  return { remaining: v.remaining, limit: v.limit }
}
// 把生产者给的东西收敛成客户端认识的那一格；认不出来就回 null（编排器据此不写 backend）。
function backendBudgetOf(backendId: string, raw: any): RefreshBackendBudget | null {
  const r = (raw && typeof raw === 'object' && raw.ok === true && raw.readout && typeof raw.readout === 'object') ? raw.readout : raw
  if (!r || typeof r !== 'object') return null
  if (typeof r.budgetKind !== 'string' || BUDGET_KINDS.indexOf(r.budgetKind) < 0) return null
  const out: RefreshBackendBudget = {
    id: backendId,
    budgetKind: r.budgetKind as RefreshBudgetKind,
    readKnown: r.readKnown === true,
    offNetwork: r.offNetwork === true,
  }
  const graphql = budgetBucketOf(r.buckets && r.buckets.graphql)
  const rest = budgetBucketOf(r.buckets && r.buckets.rest)
  if (graphql || rest) {
    out.buckets = {}
    if (graphql) out.buckets.graphql = graphql
    if (rest) out.buckets.rest = rest
  }
  const requests = budgetBucketOf(r.requests)
  if (requests) out.requests = requests
  if (r.reason === 'not-measured' || r.reason === 'unavailable' || r.reason === 'unsupported') out.reason = r.reason
  return out
}

interface ComposeOpts {
  force?: boolean
  ifNoneMatch?: string
}

// 创建宿主编排器。
// registry trackerRegistry 实例（或等价 get）；opts 缓存 TTL（毫秒；缺省取 config/ttl.yaml 的 snapshotTtlMs，即 5000）；logCtx 可选，不传则静默（老调用方行为不变）
export function createSnapshotComposer(registry: SnapshotComposerRegistry, opts: SnapshotComposerOpts = {}): {
  composeSnapshot: (backendId: string, ref: RepositoryRef, ctx?: any, o?: ComposeOpts) => Promise<any>
  getDependencies: (backendId: string, ref: RepositoryRef, key: string, ctx?: any) => Promise<any>
  invalidateSnapshot: (backendId: string, ref: RepositoryRef) => void
  invalidateDependencies: (backendId: string, ref: RepositoryRef, key?: string) => void
  clear: () => void
} {
  // 两份缓存的存活时间都取中央常量，值住 config/ttl.yaml 的 snapshotTtlMs（5 秒）：
  // 短窗内重复重建不再向后端重问，窗口一过就重问。调用方仍可用 opts.snapshotTtl / opts.depsTtl 覆盖。
  const snapshotTtl = (opts && opts.snapshotTtl != null) ? opts.snapshotTtl : SNAPSHOT_TTL_MS
  const depsTtl = (opts && opts.depsTtl != null) ? opts.depsTtl : SNAPSHOT_TTL_MS
  const SNAP_LRU_MAX = 20
  const snapCache = new Map<string, any>() // `${backendId}:${refId}` -> {snapshot, version, at} LRU20
  function touchSnapLRU(k: string,v: any): void{ if(snapCache.has(k)) snapCache.delete(k); snapCache.set(k,v); if(snapCache.size>SNAP_LRU_MAX){ const f=snapCache.keys().next().value as string; snapCache.delete(f);} }
  function issueIndexVersion(idx: Record<string, any> | null | undefined): string{ try{ const keys=Object.keys(idx||{}).sort(); const str=keys.map(function(k){return k+':'+(idx as Record<string, any>)[k]}).join('|'); try{ const cr=require('crypto'); if(cr&&cr.createHash) return cr.createHash('sha1').update(str).digest('hex').slice(0,12); }catch(e){} let h=0; for(let i=0;i<str.length;i++) h=((h<<5)-h+str.charCodeAt(i))|0; return (h>>>0).toString(16).padStart(8,'0'); }catch(e){ return '0'; }}
  // 拉取请求三字段进版号（与 #508 口径一致：字段省略=MISSING 记一类，有值/空值按值记；只改拉取请求字段也换版号，不 served 陈旧 304）。
  const depsCache = new Map<string, any>() // `${backendId}:${refId}#${key}` -> {data, at}

  const snapKeyOf = (backendId: string, ref: RepositoryRef | any): string => `${backendId}:${(ref && ref.refId) || ''}${(ref && (ref as any).effortId !== undefined && (ref as any).effortId !== null) ? '#' + String((ref as any).effortId) : ''}`
  const depKeyOf = (backendId: string, ref: RepositoryRef | any, key: string): string => `${snapKeyOf(backendId, ref)}#${key}`

  const fresh = (e: any, ttl: number): any => e && (Date.now() - e.at) < ttl

  // 房内日志（#505）：只用现有的两个事件名（不新增事件，不改附录对照表）。
  // 未命中记常驻（每次重建都记，原因只记枚举）；命中记按需（调试开关开着才记，还百分之一采样）。
  // 请求与组装完成事件由外层电话层（wf.snapshot / wf.refresh，经 sessionSnapshot / sessionRefresh）负责，
  // 本层不重复记，避免一次调用记两行；前端水合与扇出是客户端的事，本层不碰。
  const snapLogCtx = (opts && (opts as any).logCtx) || null
  const fire: any = (snapLogCtx && typeof snapLogCtx.fire === 'function') ? snapLogCtx.fire.bind(snapLogCtx) : null
  let snapHitSampleN = 0

  // 标记未使用的内部 helper：issueIndexVersion 是历史遗留的索引版号算法，当前组装走 snapshotVersionOf；
  // 留在这里只为如实保留原文件的完整面貌，不删除、不改动，调用方仍按原来路径取数。
  void issueIndexVersion

  // 读一次额度读数：没接、抛错、形状不对都算「这一趟拿不到」，一律回 null。
  // 为什么吞异常：额度读数只是快照上的一个附加事实，读它失败不能连累快照本身（老行为必须保持可用）。
  const readBackendBudget = async (backendId: string): Promise<RefreshBackendBudget | null> => {
    const read = opts && opts.budgetReadout
    if (typeof read !== 'function') return null
    try {
      return backendBudgetOf(backendId, await read(backendId))
    } catch (e) {
      return null
    }
  }

  return {
    // 宿主编排 composeSnapshot（非 op）：list 全量 → 组装 maps/tickets/未挂图票 → deck 派生 → 缓存。
    // o.force=true 绕过缓存。失败返回 {ok:false,error}（不抛）。
    async composeSnapshot(backendId: string, ref: RepositoryRef, ctx: any = {}, o: ComposeOpts = {}): Promise<any> {
      const tracker = registry.get(backendId)
      if (!tracker) {
        return { ok: false, error: { kind: (ERROR_KIND as any).UNSUPPORTED, message: `backend '${backendId}' not registered (composition aborted)` } }
      }
      const sk = snapKeyOf(backendId, ref)
      const cachedEntry = snapCache.get(sk);
      if (!o.force && (o as any).ifNoneMatch && cachedEntry && cachedEntry.version && cachedEntry.version===(o as any).ifNoneMatch) {
        try { if (fire && snapLogCtx.isEnabled('debug') && ((++snapHitSampleN % 100) === 0)) fire('debug', 'snapshot.cache.hit', { kind: 'snapshot-lru', ageMs: Date.now() - cachedEntry.at }) } catch (eL) {}
        touchSnapLRU(sk, cachedEntry) // 命中刷新 LRU 顺序（只动顺序，不改 at；TTL 照原创建时间过期）
        return { ok: true, notModified:true, status:304, version:cachedEntry.version, snapshot:cachedEntry.snapshot, cached:true };
      }
      if (!o.force && fresh(cachedEntry, snapshotTtl)) {
        try { if (fire && snapLogCtx.isEnabled('debug') && ((++snapHitSampleN % 100) === 0)) fire('debug', 'snapshot.cache.hit', { kind: 'snapshot-lru', ageMs: Date.now() - cachedEntry.at }) } catch (eL) {}
        touchSnapLRU(sk, cachedEntry) // 命中刷新 LRU 顺序（同上；否则退化成先进先出）
        if(o && (o as any).ifNoneMatch && cachedEntry.version===(o as any).ifNoneMatch) return { ok:true, notModified:true, status:304, version:cachedEntry.version, cached:true };
        return { ok: true, snapshot: cachedEntry.snapshot, version:cachedEntry.version, cached: true }
      }
      // 走到这里一定重建：原因只记枚举（版本号对不上记版本不一致，不记版本号原文）。
      const missReason = o.force ? 'force' : (!cachedEntry ? 'empty' : (((o as any).ifNoneMatch && cachedEntry.version && cachedEntry.version !== (o as any).ifNoneMatch) ? 'version-mismatch' : 'expired'))
      try { if (fire) fire('info', 'snapshot.cache.miss', { reason: missReason }) } catch (eL) {}

      // 可选后端快路径（非 op；只接受完整 Issue[]，否则回落 list——桩不误导）
      let all: any[] | null = null
      // #715：这一趟 list 到底走的 GraphQL 还是掉到了 REST —— 后端真的降级时才往上报（见 github/issues.js 的 REST 通道）。
      let listFallback: string | null = null
      // #734：降级原因随 fallback 一起上报（quota / other / 未知=null 三档；未知 = 老快路径没给、
      //   老快照本来就没有这个字段）。界面只有 quota 才说配额耗尽，other 与未知一律说中性那句。
      let listFallbackReason: string | null = null
      if (typeof tracker.snapshotFast === 'function') {
        const fast = await tracker.snapshotFast(ref, ctx)
        if (fast && fast.ok === true && Array.isArray(fast.data)) { all = fast.data; if (fast.fallback === 'rest') { listFallback = 'rest'; listFallbackReason = fast.fallbackReason || null } }
      }
      if (!all) {
        const res = await tracker.list(ref, {}, ctx)
        if (!res.ok) return { ok: false, error: res.error, fail: { kind: failKindOfListError(res.error), at: Date.now() } }
        if ((res as any).fallback === 'rest') { listFallback = 'rest'; listFallbackReason = (res as any).fallbackReason || null }
        all = res.data
      }
      if (!Array.isArray(all)) {
        return { ok: false, error: { kind: (ERROR_KIND as any).PARSE, message: 'list returned non-array data; cannot compose snapshot' } }
      }

      const snapshot: any = assembleSnapshot(ref, all)
      const deck: any = deriveDeck(snapshot)
      // #689：数字改问后端要（契约的 counts），并把「这份行数据全不全」写成 deck.partial。
      //   没有 counts 之前，deck 里的数字是数「手上这份票池」数出来的，而票池会被后端悄悄截断
      //   （GitHub 最多 500 条、GitLab 只取一页），数字于是跟着偏少（缺陷票 #677）。现在两件事分开：
      //     · 数字：counts 给的真值（拿不到就留着派生值，绝不显示一个漂亮的大数字骗人）；
      //     · 行数据全不全：拿池子里的工单行数与 counts.total 比，对不上就说明这份清单不全 → partial。
      //   两种「对不上」都不采信那个数字：手上的行比总数还多（这不可能，说明计数本身错了、或只数了一页），
      //   一样退回派生值。拿不到 counts 时 partial 一律置真（规格第 6.5 节）：这时候连「全不全」都无从判断。
      //   与行数据同一趟重建里取（快照缓存 TTL 5 秒 + 版号），所以数字与列表看到的是同一时刻的仓库。
      const counts = await countsFromBackend(tracker, ref, ctx)
      const poolTickets = poolTicketCountOf(snapshot)
      const countsTrusted = !!counts && poolTickets <= (counts as { total: number }).total
      if (countsTrusted) deck.counts = counts
      deck.partial = !countsTrusted || poolTickets < ((counts as { total: number } | null)?.total as number)
      snapshot.deck = deck
      // #715（诚实显示）：降级标记与「推迟 / 暂停 / 这个窗口没在刷新」这四项读数，只在这里写。
      //   降级标记（'rest'）是上面那一趟 list 真实掉到 REST 通道才带回来的事实 —— 界面层永远不许写它
      //   （tests/verify-visible-truth.js 有一条静态断言盯着这件事：谁也別想在客户端补一句赋值让横幅亮起来）。
      snapshot.fallback = listFallback === 'rest' ? 'rest' : null
      // #734：原因与标记同生同灭 —— 无降级时原因必须为空（恢复不清就红）；有降级但原因缺失时按未知
      //   （null），界面按未知说中性那句。原因住在宿主侧，界面只读（verify-visible-truth 静态断言保持）。
      snapshot.fallbackReason = listFallback === 'rest' ? (listFallbackReason || null) : null
      // 2026-09-24（维护者反馈降级横幅「出现过后就常驻」）：降级这件事也带上它发生的时刻。
      //   为什么必须有这个时刻：`fallback` 是那一次构建留下的历史事实，它会随快照被缓存、被反复取用；
      //   界面只凭它说不出一句“现在已经切到 REST”的话（那句话说的是当下）。带上时刻之后，界面才能
      //   在超过一小时后改口成「上次取数走的 REST（N 分钟前）」，不再冒充现在。
      snapshot.fallbackAt = listFallback === 'rest' ? Date.now() : null
      // tier 是额度档位：今天宿主这一侧还没有闸的账本读数（闸与账本接进宿主是后面的事），所以如实留 null。
      //   留 null 的直接后果是界面不说「数据可能落后 X 分钟」——这是对的：不知道就不说，不许编一个。
      //   deferred / paused / notRefreshing 同理：没有那个事实就是 false，界面一个字都不显示。
      // #1446：额度读数与这一趟重建同窗取（快照缓存 TTL 5 秒，版号把它一起带走）；拿不到就不写 backend，
      //   保持今天这份 refresh 的形状 —— 少一格字段是「不知道」，写成 0 才是谎报耗尽。
      const backendBudget = await readBackendBudget(backendId)
      const refresh: any = { tier: null, deferred: false, paused: false, notRefreshing: false }
      if (backendBudget) refresh.backend = backendBudget
      snapshot.refresh = refresh
      try{ const ver=snapshotVersionOf(snapshot); snapshot.version=ver; snapshot.etag=ver; }catch(e){}
      const ent={snapshot, version:snapshot.version||'', at:Date.now()};
      touchSnapLRU(sk, ent);
      if(!o.force && (o as any).ifNoneMatch && ent.version===(o as any).ifNoneMatch) return {ok:true, notModified:true, status:304, version:ent.version, snapshot};
      return { ok: true, snapshot, version:ent.version }
    },

    // getDependencies（LRU 封装，TTL 默认 5000ms）：只缓存边数据（ok:true 的 data）；
    // ok:false（含 unsupported）一律不缓存、每次透传调用（G5 红线）。
    async getDependencies(backendId: string, ref: RepositoryRef, key: string, ctx: any = {}): Promise<any> {
      const dk = depKeyOf(backendId, ref, key)
      if (fresh(depsCache.get(dk), depsTtl)) {
        return { ok: true, data: depsCache.get(dk).data, cached: true }
      }
      const tracker = registry.get(backendId)
      if (!tracker) {
        return { ok: false, error: { kind: (ERROR_KIND as any).UNSUPPORTED, message: `backend '${backendId}' not registered` } }
      }
      const res = await tracker.getDependencies(ref, key, {}, ctx)
      if (res && res.ok === true) depsCache.set(dk, { data: res.data, at: Date.now() })
      return res
    },

    // 快照缓存逐出（写操作后由编排层调用；API-only，不感知写）。
    invalidateSnapshot(backendId: string, ref: RepositoryRef): void {
      snapCache.delete(snapKeyOf(backendId, ref))
    },

    // 依赖边缓存逐出：key 省略 = 该 repo 全部（闭包按前缀匹配）；单 key = 精确。
    invalidateDependencies(backendId: string, ref: RepositoryRef, key?: string): void {
      const prefix = `${snapKeyOf(backendId, ref)}#`
      if (key != null) depsCache.delete(prefix + key)
      else for (const k of Array.from(depsCache.keys())) if (k.startsWith(prefix)) depsCache.delete(k)
    },

    // 全清（快照 + 依赖边）。
    clear(): void {
      snapCache.clear()
      depsCache.clear()
    },
  }
}

// Issue 类型在上面的签名里只出现在公开入参位置，运行时取用的是同一批 .js，类型边不新增引用。
void (null as unknown as Issue | null)
void (null as unknown as Snapshot | null)

export const SNAPSHOT = Object.freeze({ version: 1 })
