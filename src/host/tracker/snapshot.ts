// src/host/tracker/snapshot.ts —— 从同目录 snapshot.js 逐行转写而来，只加类型标注与注释，运行时逻辑一个字未动。
//
// 为什么要转写这一份：宿主编排 composeSnapshot 是快照组装的持有者，转成 TypeScript 后
//   调用方能按类型取用编排器，缓存键、版号与降级标记的口径仍与原来逐行一致。
// 什么约定不能改：
//   1. snapshot 不进 OpName：它是宿主编排便利函数，不是后端操作；children 用 list 组合，deck 由 host 计算。
//   2. 缓存只缓存数据，绝不缓存能力判定；首屏一律经 list({state:'open'}) 取开放工作集，再并上开放地图子票与已关闭地图容器行；后端快路径整条不走（它只回完整数组，表达不了「只要未关闭」）。
//   3. 同池不分片：拉取请求与普通工单同池，身份靠池内标识区分，不互相吞；组装只做直通，不补默认值。
//   4. 数字与全不全分开：六个数字由快照库一次查询算（电话层挂上），这一层只写「这份行数据全不全」。
//   5. 相对导入一律保留 .js 后缀，运行时由 scripts/ts-hook.mts 改指同名 .ts，本文件不改说明符。
//   6. 只写可剥离类型：类型一律经 import type 引入，不新增任何运行时边。

import { ERROR_KIND } from '../../tracker/contract/vocabulary.js'
import { deriveDeck } from '../../tracker/deck-derive.js'
// 快照与依赖边两份缓存的缺省存活时间住中央 YAML（config/ttl.yaml 的 snapshotTtlMs 键，注释写着
// 「快照组合器的缓存有效期：5 秒」）：这里直接读中央常量，不再造新本地名，调时间改 YAML。
// 路径走域构建产物写法，值由 tests/verify-time-config.ts 看守一致。
import { SNAPSHOT_TTL_MS } from '../../shared/time-config/src/values.js'
import { assembleSnapshot, carryOverMapTickets, failKindOfListError } from './snapshotAssemble.js'
// #1796 首屏工作集：开放池 + 开放地图子票 + 已关闭地图容器行（只读后端、只回事实，编排仍在本文件）。
import { assembleWorkingSet } from './snapshotWorkingSet.js'
import { snapshotVersionOf } from './snapshotVersion.js'

// 类型只做编译期约束，不产生运行时引用：对外形状以共享层为准，内部动态行一律按 any 收。
import type { Issue, RepositoryRef, Snapshot } from '../../shared/tracker/shape.js'

// 本域 types 为空，CommonJS 的 require 声明随 @types/node 一起缺席；运行时在 ESM 下取不到 require
// 会直接抛错并走进下面的 catch 回退分支。按存在声明只为过编译器，不产生运行时代码，行为与原来一致。
declare const require: (id: string) => any


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
// 后台同步失败（#1006）是同一个 backend 里的可选一格 sync：读数未知时界面靠它把「为什么还没同步」说出来；
// 它坏掉时只丢 sync，绝不动读数本身的格子（不因为解释不清就把整格读数一起扔掉）。
export type RefreshBudgetKind = 'two-buckets' | 'requests' | 'none' | 'unknown'
export type RefreshBudgetReason = 'not-measured' | 'unavailable' | 'unsupported'
export interface RefreshBudgetBucket {
  remaining: number
  limit: number
}
// 后台同步最近一次失败的结论（#1006 期望⑤）：读数为「还没同步上来」时，界面靠它说清是哪一种失败。
// 只在 backendBudgetOf 里收敛形状；形状不全就整块丢掉 —— 编一个类别（或编一个时刻）比不说更坏。
// 为什么不直接复用 refresh 房间里那份同名形状：这里是宿主给客户端回包的传输边界（跨层、会被序列化），
// 宿主层不许引用 refresh 房间的模块；两端各自校验一次，宁可多一份声明，也不让一个类型把两层绑在一起。
export interface RefreshBackendSync {
  lastFailAt: number
  lastFailKind: 'hard' | 'soft'
}
export interface RefreshBackendBudget {
  id: string
  budgetKind: RefreshBudgetKind
  readKnown: boolean
  offNetwork: boolean
  buckets?: { rest?: RefreshBudgetBucket; graphql?: RefreshBudgetBucket }
  requests?: RefreshBudgetBucket
  reason?: RefreshBudgetReason
  sync?: RefreshBackendSync
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
  // #1439 A2：生产路径经 Tracker 会话取数（操作过闸、记账，房间实例不外泄给面板）。
  // 不接这一格的调用方（门禁单测、老调用点）仍按注册表取实例，形状与今天一致。
  openSession?: (cwd: string, o?: { write?: boolean }) => Promise<any>
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
// 后台同步失败结论只认两种类别、且时刻必须是有限正数：界面拿它决定说「环境没准备好」还是「刚才没连上」，
// 编一个类别比不说更坏 —— 形状不对就整块丢掉，界面退回中性的「还没同步上来」（#1006）。
function backendSyncFailureOf(v: any): RefreshBackendSync | null {
  if (!v || typeof v !== 'object') return null
  if (typeof v.lastFailAt !== 'number' || !isFinite(v.lastFailAt) || v.lastFailAt <= 0) return null
  if (v.lastFailKind !== 'hard' && v.lastFailKind !== 'soft') return null
  return { lastFailAt: v.lastFailAt, lastFailKind: v.lastFailKind }
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
  const sync = backendSyncFailureOf(r.sync)
  if (sync) out.sync = sync
  return out
}

/**
 * #1774：调用方递来的「上一份快照」只有确实属于当前后端、当前仓库时才许用来补回。
 *
 * 为什么必须核对：房间缓存只按工作区分桶（见 src/refresh/rooms/host/session-snapshot-cache.ts 与
 * session-refresh-schedule.ts），用户切到另一台后端或另一个仓库后，缓存里那份仍是上一目标的快照。
 * 不核对就补，会把别的后端的容器、子票乃至计数并进新快照。编排器自己的缓存以「后端 + 仓库」为键
 * （见下面的 snapKeyOf），本来没有这个口子；这个校验把新开的调用方入口收紧到同一口径。
 *
 * 核对口径：快照里带了某一项身份，就必须与这一趟的同名身份一致；某一项双方都没带才跳过该项
 * （那是比这些字段更早的老快照）。快照带了 repository.refId、这一趟却拿不到 refId 时，无法证明是同一
 * 仓库，按拒绝处理，不放宽。不额外问后端，纯本地判断。
 */
export function previousSnapshotFor(previousSnapshot: unknown, backendId: string, ref: RepositoryRef): Record<string, any> | null {
  if (!previousSnapshot || typeof previousSnapshot !== 'object') return null
  const snap: any = previousSnapshot
  const sel = snap.selection
  const snapBackend = (sel && typeof sel === 'object' && typeof sel.backendId === 'string') ? sel.backendId : ''
  if (snapBackend && snapBackend !== String(backendId)) return null
  const repo = snap.repository
  const snapRefId = (repo && typeof repo === 'object' && repo.refId != null) ? String(repo.refId) : ''
  const wantRefId = (ref && ref.refId != null) ? String(ref.refId) : ''
  if (snapRefId && snapRefId !== wantRefId) return null
  return snap as Record<string, any>
}

interface ComposeOpts {
  force?: boolean
  /**
   * @deprecated #1885 评审修复：304 的判据已经改成库版本（电话层用 wf.snapshotVersion 的版本比对），
   * 本编排器不再看内容散列。这一格只为老调用方的签名兼容保留，传什么都不影响 304。
   */
  ifNoneMatch?: string
  /**
   * #1774：调用方手上那份「上一趟构建出来的快照」，来源不完整时用它补回上次已知的容器与子票。
   *
   * 为什么不能只靠本编排器自己的快照缓存：两条生产电话路（wf.snapshot / wf.refresh）每次请求
   * 都新建一个编排器实例，那份进程内缓存永远是空的 —— 补回逻辑在生产上从来没拿到过上次快照。
   * 所以上一份快照由调用方（房间里的内存缓存）显式传进来；不传时仍回落到本实例缓存，老调用方行为不变。
   */
  previousSnapshot?: unknown
  /**
   * #1863：这一趟列表工作集（开放池 + 开放容器的子票，含已关闭子票）刚取齐时回调一次，
   * 宿主用它把整池写进快照库。回调同步返回、自己吞错，不许挡快照回包。
   */
  onRows?: (rows: Issue[]) => void
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

  // 房内日志（#505）：只用三个事件名 —— 前两个是原来就有的 snapshot.cache.miss / snapshot.cache.hit；
  //   #1796 新增常驻 #149 snapshot.workingSet（首屏工作集这一趟拉到哪些东西、坏在哪几张，附录第 1 章有登记）。
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

  // #1439 A2：取数的门面。生产接了 openSession 就经 Tracker 会话调操作（过闸、记账、房间实例不外泄）；
  // 没接（门禁单测、老调用点）或会话这一层开不起来（宿主装配还没就绪）时回落到注册表取实例，形状与今天一致：
  // 面板取数不能因为会话没接好就整份快照失败（#927 可用性优先）。门面故意不提供 snapshotFast：
  // 快路径只回「完整数组」，表达不了首屏要的「只要未关闭」（#1796），所以首屏一律走普通 list 加状态筛选。
  // listPage 与 listSubIssues 是 #1796 新增的两件只读能力（补已关闭地图容器行、拉开放地图的子票）：
  // 老会话或门禁里的假会话没有这两个方法，回 unsupported 让调用方跳过，绝不在这里抛（快照可用性优先）。
  const instanceOf = (backendId: string): any => {
    try { return registry.get(backendId) } catch (e) { return null }
  }
  const missingOp = (op: string): any => ({ ok: false, error: { kind: (ERROR_KIND as any).UNSUPPORTED, message: op + ' unavailable on this session' } })
  const trackerFor = async (backendId: string, ctx: any): Promise<any> => {
    const open = opts && opts.openSession
    if (typeof open !== 'function') return instanceOf(backendId)
    const cwd = (ctx && typeof ctx.cwd === 'string') ? ctx.cwd : ''
    let opened: any = null
    try { opened = await open(cwd, { write: false }) } catch (e) { opened = null }
    if (!opened || opened.ok !== true || typeof opened.call !== 'function' || String(opened.backendId) !== String(backendId)) return instanceOf(backendId)
    return {
      // #1796：filter 真的下推给后端（首屏传 {state:'open'}）；老调用方不传时仍是 {}（全部状态）。
      list: (ref: any, filter: any) => opened.call((s: any, c: any) => s.list(ref, filter || {}, c)),
      getDependencies: (ref: any, key: any, o: any) => opened.call((s: any, c: any) => s.getDependencies(ref, key, o || {}, c)),
      // 缺席时回 unsupported 而不是抛：会话实现缺这两个方法只说明这一类行补不出来，不能让整份快照失败。
      listPage: (ref: any, filter: any, pageOpts: any) => opened.call((s: any, c: any) => typeof s.listPage === 'function' ? s.listPage(ref, filter || {}, pageOpts || {}, c) : missingOp('listPage')),
      listSubIssues: (ref: any, key: any, o: any) => opened.call((s: any, c: any) => typeof s.listSubIssues === 'function' ? s.listSubIssues(ref, key, o || {}, c) : missingOp('listSubIssues')),
    }
  }

  return {
    // 宿主编排 composeSnapshot（非 op）：list 全量 → 组装 maps/tickets/未挂图票 → deck 派生 → 缓存。
    // o.force=true 绕过缓存。失败返回 {ok:false,error}（不抛）。
    async composeSnapshot(backendId: string, ref: RepositoryRef, ctx: any = {}, o: ComposeOpts = {}): Promise<any> {
      const tracker = await trackerFor(backendId, ctx)
      if (!tracker) {
        return { ok: false, error: { kind: (ERROR_KIND as any).UNSUPPORTED, message: `backend '${backendId}' not reachable (composition aborted)` } }
      }
      const sk = snapKeyOf(backendId, ref)
      const cachedEntry = snapCache.get(sk);
      // #1774：上一份快照有两个来源——调用方显式传入的（生产电话路的房间缓存）优先，
      //   没有再用本编排器进程内的缓存（单实例连跑两趟的老调用方）。调用方那份先过 previousSnapshotFor
      //   的归属核对：缓存只按工作区分桶，切后端或换仓库后它可能还是上一目标的快照，不能直接拿来补。
      //   它同时供补回与计数沿用两处使用，只在这两处生效：缓存命中 / 304 / TTL 的语义一个字不动（仍然只看 snapCache）。
      const passedPrev: any = previousSnapshotFor(o && o.previousSnapshot, backendId, ref)
      const prevSnapshot: any = passedPrev || (cachedEntry && cachedEntry.snapshot) || null
      if (!o.force && fresh(cachedEntry, snapshotTtl)) {
        try { if (fire && snapLogCtx.isEnabled('debug') && ((++snapHitSampleN % 100) === 0)) fire('debug', 'snapshot.cache.hit', { kind: 'snapshot-lru', ageMs: Date.now() - cachedEntry.at }) } catch (eL) {}
        touchSnapLRU(sk, cachedEntry) // 命中刷新 LRU 顺序（同上；否则退化成先进先出）
        // #1885 评审修复（规格 §9）：304 的判据改成库版本，在电话层比对；这里只回整份与内容版号。
        return { ok: true, snapshot: cachedEntry.snapshot, version:cachedEntry.version, cached: true }
      }
      // 走到这里一定重建：原因只记枚举（版本号对不上记版本不一致，不记版本号原文）。
      // #1885 评审修复：内容散列不再参与新鲜度判断，miss 原因只剩「强制 / 没缓存 / 缓存过期」三档。
      const missReason = o.force ? 'force' : (!cachedEntry ? 'empty' : 'expired')
      try { if (fire) fire('info', 'snapshot.cache.miss', { reason: missReason }) } catch (eL) {}

      // #715：这一趟 list 到底走的 GraphQL 还是掉到了 REST —— 后端真的降级时才往上报（见 github/issues.js 的 REST 通道）。
      let listFallback: string | null = null
      // #1696：这一趟列表是不是被后端截断了。截断 / 降级都算「不完整来源」——地图容器的子票与计数
      //   只能补、不能删（见 snapshotAssemble.ts 的 carryOverMapTickets）；完整来源才允许以本次为准删减。
      let listTruncated = false
      // #734：降级原因随 fallback 一起上报（quota / other / 未知=null 三档；未知 = 老快照本来就没有这个字段）。
      //   界面只有 quota 才说配额耗尽，other 与未知一律说中性那句。
      let listFallbackReason: string | null = null
      // #1796 首屏只取开放工作集：状态筛选由后端先做（list 契约支持 filter.state），未关闭票不再和
      //   已关闭历史挤同一个 500 条窗口 —— 这正是「编号靠后的旧开放票被挤掉」的根因所在。
      //   后端可选快路径不再调用：它只回完整数组，表达不了「只要未关闭」。
      const res = await tracker.list(ref, { state: 'open' }, ctx)
      if (!res.ok) return { ok: false, error: res.error, fail: { kind: failKindOfListError(res.error), at: Date.now() } }
      if ((res as any).truncated === true) listTruncated = true
      if ((res as any).fallback === 'rest') { listFallback = 'rest'; listFallbackReason = (res as any).fallbackReason || null }
      const pool: any[] = res.data
      if (!Array.isArray(pool)) {
        return { ok: false, error: { kind: (ERROR_KIND as any).PARSE, message: 'list returned non-array data; cannot compose snapshot' } }
      }

      // #1796 首屏工作集：开放池只装得下开放票，还要并上两样东西才是一份完整首屏：
      //   ① 开放容器的子票（探索地图与规格都算；含已关闭的子票 —— 地图详情要数得清「共 N 张」，
      //      规格也要看得出做完了几张）；
      //   ② 已关闭地图的容器行（开放池里没有它们，列表上的容器行不能凭空消失）。
      //   子票拉取失败只跳过不抛；失败或不完整的次数决定这一份来源全不全（sourceComplete），
      //   来源不全时下面的 carryOverMapTickets 只能补不能删。
      const prelim: any = assembleSnapshot(ref, pool)
      const workingSetStartedMs: number = Date.now()
      const workingSet: any = await assembleWorkingSet({
        tracker,
        ref,
        ctx,
        pool,
        openContainers: prelim.maps,
        // #1774：上一份快照优先用调用方传入的那份（生产电话路的房间缓存），没有才用本编排器缓存。
        previousMaps: (prevSnapshot && Array.isArray(prevSnapshot.maps)) ? prevSnapshot.maps : [],
      })
      // #1796：工作集这一趟的事实进常驻日志（附录 #149）。为什么单记一条：子票拉取是按容器逐张发的，
      //   失败只跳过不抛，若不记，事后分不清「这张地图下面怎么少了几张」是没拉、拉到一半还是后端不提供。
      //   失败清单只写「票号:错误档」，不写远端原文。
      try {
        if (fire) {
          fire('info', 'snapshot.workingSet', {
            openContainers: workingSet.openContainers,
            subIssues: workingSet.subIssues,
            subIssuesFailed: workingSet.subIssuesFailed,
            subIssuesIncomplete: workingSet.subIssuesIncomplete,
            closedMapRows: workingSet.closedMapRows,
            closedMapSource: workingSet.closedMapSource,
            failed: workingSet.failed,
            latencyMs: Date.now() - workingSetStartedMs,
          })
        }
      } catch (eL) {}
      // #1863：整池（含已关闭子票）在这里交给宿主写库；放工作集之后、组装之前，拿到的是未装饰的原始行。
      try { if (typeof o.onRows === 'function') o.onRows(workingSet.rows) } catch (eRows) {}
      const sourceComplete: boolean = !listFallback && !listTruncated && workingSet.subIssuesFailed === 0 && workingSet.subIssuesIncomplete === 0

      // #1696：组装出来的 map.tickets 是后端原始行，客户端首帧画不出关系与计数；这里统一归一化，
      //   并在列表被截断或降级时把上次快照已知的子票与计数按编号补回来（只补不删）。已关闭容器口径不动。
      // #1774 与 #1796 合并后的口径：上一份快照用 prevSnapshot（调用方传入的那份优先，供补回使用），
      //   来源全不全用 sourceComplete（已把工作集子票拉取失败/不完整算进去）。
      const assembled: any = assembleSnapshot(ref, workingSet.rows)
      const snapshot: any = carryOverMapTickets(prevSnapshot, assembled, {
        sourceComplete,
        nowMs: Date.now(),
      })
      const deck: any = deriveDeck(snapshot)
      // #1887：数字不再向后端要，也不再有「待校准」——六个数字由快照库一次查询算出，
      //   由电话层在库写到最新之后挂到 deck.counts 上（本编排器只负责取数、写库与组装）。
      //   partial 仍只报「这份行数据有没有异常缺失」：列表触上限、REST 降级、开放容器的子票
      //   没拉全或拉不到。计数不再参与 partial —— 数字已经从库来，不再需要拿后端 open 对账。
      deck.partial = listTruncated || listFallback === 'rest'
        || Number(workingSet.subIssuesFailed || 0) > 0 || Number(workingSet.subIssuesIncomplete || 0) > 0
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
      // #1885 评审修复（规格 §9）：304 不在本层判（改由电话层按库版本比），本层只回整份与内容版号。
      return { ok: true, snapshot, version:ent.version }
    },

    // getDependencies（LRU 封装，TTL 默认 5000ms）：只缓存边数据（ok:true 的 data）；
    // ok:false（含 unsupported）一律不缓存、每次透传调用（G5 红线）。
    async getDependencies(backendId: string, ref: RepositoryRef, key: string, ctx: any = {}): Promise<any> {
      const dk = depKeyOf(backendId, ref, key)
      if (fresh(depsCache.get(dk), depsTtl)) {
        return { ok: true, data: depsCache.get(dk).data, cached: true }
      }
      const tracker = await trackerFor(backendId, ctx)
      if (!tracker) {
        return { ok: false, error: { kind: (ERROR_KIND as any).UNSUPPORTED, message: `backend '${backendId}' not reachable` } }
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
