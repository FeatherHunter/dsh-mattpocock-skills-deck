/**
 * src/client/mapDetailV2/ticketFeed.ts —— 三条取数来路合成一份「现在能画什么」。
 *
 * 为什么要收成一处：地图的子票有三条来路——
 *   ① 首屏快照里那份（老地图的详情页就是靠它；已关闭的地图快照里不带子票）；
 *   ② wf.mapTickets 按需取回的全量（含已关闭，最全）；
 *   ③ 取失败（后端不支持、网络、解析）。
 * 页面要同时说清「画的是哪一份」和「这一份有多全」。这四五种情形如果散在页面里，
 * 迟早会出现「正在取的时候显示 0 张」这种把两件事说成一件的错。
 *
 * 这一份只做判断，不发请求：请求由页面自己的 effect 发（fetchMapTickets），
 * 门禁因此可以在不连后端的情况下把每一种来路都走一遍。
 *
 * 与老页 views/MapDetailHead.ts 的取数口径逐条对齐（:37-43）：取数成功用取回那份的 stats，
 * 否则退回快照的 stats；后端明确回 unsupported 时按快照画、不报错。
 */
import type { MapRowLike, MapTicketRow, MapTicketsBucket, TicketFeed } from './mapDetailTypes'

/** 读成数组：给的东西不是数组时当空数组，不做类型猜测。 */
function rowsOf(value: MapTicketRow[] | null | undefined): MapTicketRow[] {
  return Array.isArray(value) ? value : []
}

/**
 * 从错误对象里取一句人能读的原因：
 * 有 message 用 message，没有再退回 kind；取不到就是空串（不编一句话出来）。
 */
function messageOf(error: MapTicketsBucket['error']): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  return String(error.message || error.kind || '')
}

/**
 * 合成取数结果。mt 是按需取数的桶（可能还没有），m 是快照里的地图行。
 *
 * 五种情形与画法：
 *  - mode==='real'：用取回那份的行与计数，total / capped / missing 原样带出（这几项只有这一份有）；
 *  - mode==='loading'：先画快照那份，同时把「正在取」说出来；
 *  - mode==='err' 且 kind==='unsupported'：后端说这条路它做不到，按快照画，不报错（与老页一致）；
 *  - mode==='err' 其它：画快照，并把原因截到 120 字给人看（老页同一处也截 120 字）；
 *  - 还没有桶：首屏先按快照画，页面 effect 随后才去取——不把这一刻说成「正在取」。
 */
export function ticketFeedOf(mt: MapTicketsBucket | null | undefined, m: MapRowLike | null | undefined): TicketFeed {
  const bucket: MapTicketsBucket = mt || {}
  const map: MapRowLike = m || {}
  const mode = String(bucket.mode || '')
  const snapshotRows = rowsOf(map.tickets)
  const snapshotStats = map.stats || null

  if (mode === 'real' && Array.isArray(bucket.items)) {
    const rows = bucket.items
    return {
      rows,
      stats: bucket.stats || snapshotStats,
      state: 'ready',
      source: 'requested',
      total: typeof bucket.total === 'number' ? bucket.total : null,
      capped: bucket.capped === true,
      missing: typeof bucket.missing === 'number' ? bucket.missing : 0,
      failedMessage: '',
      empty: rows.length === 0,
    }
  }

  if (mode === 'loading') {
    return {
      rows: snapshotRows,
      stats: snapshotStats,
      state: 'loading',
      source: 'snapshot',
      total: null,
      capped: false,
      missing: 0,
      failedMessage: '',
      empty: snapshotRows.length === 0,
    }
  }

  if (mode === 'err') {
    const kind = bucket.error && typeof bucket.error === 'object' ? String(bucket.error.kind || '') : ''
    const unsupported = kind === 'unsupported'
    return {
      rows: snapshotRows,
      stats: snapshotStats,
      state: unsupported ? 'unsupported' : 'failed',
      source: 'snapshot',
      total: null,
      capped: false,
      missing: 0,
      failedMessage: unsupported ? '' : messageOf(bucket.error).slice(0, 120),
      empty: snapshotRows.length === 0,
    }
  }

  return {
    rows: snapshotRows,
    stats: snapshotStats,
    state: 'ready',
    source: 'snapshot',
    total: null,
    capped: false,
    missing: 0,
    failedMessage: '',
    empty: snapshotRows.length === 0,
  }
}
