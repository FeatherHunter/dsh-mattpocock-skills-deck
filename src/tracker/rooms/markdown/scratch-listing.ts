// src/tracker/rooms/markdown/scratch-listing.ts —— 一趟环境检查里只列一次 `.scratch` 根目录（#1528）。
//
// 为什么单独成一份：md:workspace 与 md:containersReadable 要的是同一份 `.scratch` 名字表——前者拿它找
//   工作单元，后者拿它找根级与目录里的 map.md / spec.md。两种跑法都会先后调这两项判据：宿主链把三项
//   并行求值，房间 preflight 把三项顺序求值；不共用的话，一趟检查就要把同一个目录列两次盘。把「列一次」
//   收在本文件里，两项判据仍各自按自己的口径单独求结论（pass / fail / pending 与证据都不合并），这里只
//   共享列目录的结果，不共享结论。
//
// 两种共用方式，各管一种跑法：
//   1. 房间 preflight（顺序求值）：`runWorkspaceChecks` 每跑一趟就新建一个「趟标记」对象，原样交给三项
//      判据。同一个标记下，后一项直接拿前一项列好的结果——这一趟就是这一趟，与墙钟快慢无关。
//   2. 宿主链（并行求值）：三项各经一次独立调用、没有共同的上游对象可传，所以按「文件服务对象 + 根目录」
//      记一条短时（1 秒）结果，让几乎同时开口的两项共用同一份；一秒之后一律重列。
//      这份短时结果的范围要说清：宿主的平台与文件服务是全进程共享的（src/host/platformChannel.ts 的
//      getPlatform 懒初始化之后复用同一个），所以键区分的是「哪个文件服务对象」而不是「哪个会话」；同一个
//      工作区路径本来对应同一层面，两个会话在一秒内共用这份名字表是它该有的行为。
//
// 失败的列举也按同样规则共用：同一趟检查里两项必须面对同一份盘面，否则一项说「读不出来」、另一项说
//   「没有容器文件」，人会不知道该信谁。
// 反例：缓存到整个进程生命周期（用户修好权限后点「重查」永远看旧账），或只按路径字符串全局共享（两个
//   不同文件服务对象的盘面会互相冒充）。
import { SCRATCH_ROOT_LISTING_TTL_MS } from '../../../shared/time-config/src/values.js'
import { listDir } from './read.js'
import type { OpContext } from '../../contract/contexts.js'
import type { DirListing } from './read.js'

/** 一份列举结果连同它的根目录：交给 listWorkUnits 时，它要能核对「这是不是我要的那一份」。 */
export interface ScratchRootListing {
  root: string
  listing: DirListing
}

/** 房间 preflight 的「趟」：由 runWorkspaceChecks 每趟新建一个对象身份，不装任何数据。 */
export type ScratchListingRound = object

/** 一条列举记录：落定时刻（短时窗口用）、在途的那次列举、以及落定后的结果。 */
type ListingMemo = { at: number; pending: Promise<DirListing>; settled: DirListing | null }

/** 按「趟」记：同一趟检查里先问到的结果直接交给后问的，与墙钟无关。 */
const roundMemos = new WeakMap<object, Map<string, ListingMemo>>()
/** 兜底按文件服务对象记：宿主链并行求值时让几乎同时开口的两项共用在途或刚落定的那份结果。 */
const sharedMemos = new WeakMap<object, Map<string, ListingMemo>>()

/** 取某个对象名下的「根目录 → 列举记录」小表，没有就回 null。 */
function existingTable(store: WeakMap<object, Map<string, ListingMemo>>, owner: object): Map<string, ListingMemo> | null {
  return store.get(owner) || null
}
/** 取某个对象名下的「根目录 → 列举记录」小表，没有就建一张。 */
function ensureTable(store: WeakMap<object, Map<string, ListingMemo>>, owner: object): Map<string, ListingMemo> {
  let table = store.get(owner)
  if (!table) {
    table = new Map<string, ListingMemo>()
    store.set(owner, table)
  }
  return table
}

/** 在一张小表里对同一根目录只真正列一次盘：在途时交回同一个 promise，落定后交回同一份结果。 */
function listedOnce(table: Map<string, ListingMemo>, root: string, run: () => Promise<DirListing>): Promise<DirListing> {
  const hit = table.get(root)
  if (hit) return hit.settled ? Promise.resolve(hit.settled) : hit.pending
  const pending = run()
  const memo: ListingMemo = { at: Date.now(), pending: pending, settled: null }
  table.set(root, memo)
  pending.then(
    (listing) => { memo.settled = listing },
    () => { if (table.get(root) === memo) table.delete(root) },
  )
  return pending
}

/**
 * 列一次 `.scratch` 根目录，并把这份结果交给同一趟检查里的下一项判据。
 *
 * round 是房间 preflight 的趟标记（同一趟必传同一个对象）；宿主链没有这个上游对象，传 null 走短时兜底。
 * fsObj 是文件服务对象，兜底键的一部分；它也是 null 时干脆不记，照 listDir 的原样结论交回。
 */
export async function scratchRootListingOf(
  fsObj: object | null,
  ctx: OpContext,
  root: string,
  round: ScratchListingRound | null = null,
): Promise<ScratchRootListing> {
  if (round) {
    return { root: root, listing: await listedOnce(ensureTable(roundMemos, round), root, () => listDir(ctx, root)) }
  }
  if (!fsObj) return { root: root, listing: await listDir(ctx, root) }
  const shared = ensureTable(sharedMemos, fsObj)
  const hit = shared.get(root)
  if (hit) {
    const settledOrPending = hit.settled || hit.pending
    if (Date.now() - hit.at < SCRATCH_ROOT_LISTING_TTL_MS) return { root: root, listing: await settledOrPending }
    shared.delete(root)
  }
  return { root: root, listing: await listedOnce(shared, root, () => listDir(ctx, root)) }
}
