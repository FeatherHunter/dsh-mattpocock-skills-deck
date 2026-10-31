/**
 * views/mapDetailV2/model/tickets/ticketFeed.ts —— 三条取数来路合成一份「现在能画什么」。
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
import type { MapRowLike, MapTicketRow, MapTicketsBucket, TicketFeed } from '../contracts/mapDetailTypes'

/** 读成数组：给的东西不是数组时当空数组，不做类型猜测。 */
function rowsOf(value: MapTicketRow[] | null | undefined): MapTicketRow[] {
  return Array.isArray(value) ? value : []
}

/**
 * 从错误对象里取一句人能读的原因：只用 message；没有就是空串。
 *
 * 为什么不退回 kind：kind 是内部档位词（'parse' / 'env' / 'network'），画到页面上是「子票没取到：parse」，
 * 人看不懂，还以为是页面的毛病。老页同一处也只取 message（views/MapDetailHead.ts:63）。
 */
function messageOf(error: MapTicketsBucket['error']): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  return String(error.message || '')
}

/**
 * 「真的一张都没有」只在「已经取到了」的时候才算数。
 *
 * 正在取、取失败时不行：那段时刻画面里没有卡，是因为还没拿到，不是因为没有。
 * 已关闭的地图首屏快照里不带子票（宿主只给开着的容器装子票），但 stats 会说「本图共 N 张」——
 * 这时也不能说「没有子票」。所以判据是：ready + 一行都没有 + stats 也没说还有票。
 */
function emptyOf(state: string, rows: MapTicketRow[], stats: MapRowLike['stats']): boolean {
  if (state !== 'ready') return false
  if (rows.length > 0) return false
  const total = stats && typeof stats.total === 'number' ? stats.total : 0
  return !(total > 0)
}

/** 行的身份：优先编号，其次 key；都没有就是空串（不参与合并）。 */
function ticketKeyOf(row: MapTicketRow): string {
  if (!row) return ''
  const n = row.number != null ? row.number : row.key
  return n == null ? '' : String(n)
}

/**
 * 把按需取回的那份合并到快照那份上（#1695：不再整桶替换）。
 *
 * 为什么不是直接换掉：取回的回包可能被截断或只带一部分行（短回包），整桶替换会让
 * 快照里已知的子票凭空消失；快照是唯一业务数据来源，读结果只能按「明确新增/变化」合并。
 * 规则：快照行打底，取回的同编号行就地覆盖，新编号追加到尾部；两边都不动输入数组。
 */
function mergeTicketRows(snapshotRows: MapTicketRow[], fetchedRows: MapTicketRow[]): MapTicketRow[] {
  const out = snapshotRows.slice()
  const at = new Map<string, number>()
  for (let i = 0; i < out.length; i += 1) at.set(ticketKeyOf(out[i]), i)
  for (let j = 0; j < fetchedRows.length; j += 1) {
    const key = ticketKeyOf(fetchedRows[j])
    const hit = at.get(key)
    if (hit !== undefined) out[hit] = fetchedRows[j]
    else { at.set(key, out.length); out.push(fetchedRows[j]) }
  }
  return out
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
    // #1695：取回那份按编号增量合并到快照上，短回包不会把已知子票弄丢。
    const rows = mergeTicketRows(snapshotRows, bucket.items)
    return {
      rows,
      stats: bucket.stats || snapshotStats,
      state: 'ready',
      source: 'requested',
      total: typeof bucket.total === 'number' ? bucket.total : null,
      capped: bucket.capped === true,
      missing: typeof bucket.missing === 'number' ? bucket.missing : 0,
      failedMessage: '',
      empty: emptyOf('ready', rows, bucket.stats || snapshotStats),
    }
  }

  if (mode === 'real') {
    // 走到了这里说明桶自称成功、items 却不是数组。别静默把它当「还没有桶」按快照画 ready：
    // 那会让页面拿快照冒充完整数据，把 capped / missing 的提示也一起丢掉，排查时还看不到失败。
    return {
      rows: snapshotRows,
      stats: snapshotStats,
      state: 'failed',
      source: 'snapshot',
      total: null,
      capped: false,
      missing: 0,
      failedMessage: '',
      empty: false,
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
      empty: emptyOf('loading', snapshotRows, snapshotStats),
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
      empty: emptyOf(unsupported ? 'unsupported' : 'failed', snapshotRows, snapshotStats),
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
    empty: emptyOf('ready', snapshotRows, snapshotStats),
  }
}
