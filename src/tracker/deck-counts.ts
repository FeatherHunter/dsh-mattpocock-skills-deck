/**
 * src/tracker/deck-counts.ts —— 面板计数的诚实口径（#1698）。
 *
 * 为什么单独一层：计数有三个消费者（宿主拼快照、增量补行、客户端列表 KPI），三处必须用同一套
 * 「这个数字从哪来、能不能信」的判断，否则界面会出现假 0，或者列表与状态栏各说各的。
 * 本文件只放纯函数：不读写快照、不发请求、不碰缓存。
 *
 * 口径（票 #1698 与规格 #1681 第 23 条）：
 * 1. 完整枚举（列表没降级、没截断）时本地按行重算，来源记「本地枚举」——不静默按池子派生冒充完整；
 * 2. 完整枚举拿不到、或列表不完整时，保留上次已知的数字与时刻，标「待校准」，界面显示未知而不是 0；
 * 3. 后端数字与行数据冲突（后端总数比行还少）时以行数据为准，并把冲突的后端数字留痕（conflictWith）；
 * 4. 后端数字可信（行数不超过后端总数）时用后端数字，来源记「后端」——这是老口径，保持不变。
 *
 * 反例（写代码时最常犯的两个错）：
 * - 拿不到任何证据时返回 0/0/0 —— 界面会当成「真的没有票」，必须返回 null 并标待校准；
 * - 有上次已知就直接沿用它而不重算 —— 列表完整时必须按行重算，旧值只在来源不完整时保留。
 */

import { effortOf } from './kernel/identity-keys.js'

/** 计数来源的三个取值：后端给的、本地按行数出来的、上次已知保留的。 */
export const DECK_COUNT_SOURCES = Object.freeze(['backend', 'local-enumeration', 'previous-known'] as const)
/** 计数来源：见 DECK_COUNT_SOURCES 的三档。 */
export type DeckCountSource = (typeof DECK_COUNT_SOURCES)[number]

/** 一组计数的三数（open/closed/total 都要求非负整数）。 */
export interface DeckCountsTriple {
  open: number
  closed: number
  total: number
}

/** 写进 deck.counts 的计数：三数 + 来源 + 时刻；冲突时带 conflictWith 留痕。 */
export interface DeckCounts extends DeckCountsTriple {
  /** 这份数字从哪来（界面据此说「本地枚举」还是「上次已知」）。 */
  source: DeckCountSource
  /** 这份数字是什么时候拿到的（毫秒时间戳；界面显示「上次校准：时间」）。 */
  atMs: number
  /** 与行数据冲突时，后端当时给的数字（留痕用，不参与显示）。 */
  conflictWith?: DeckCountsTriple
}

/** 一次计数决策的结果：数字（可能没有）+ 待校准标记 + partial（清单全不全）。 */
export interface DeckCountsPlan {
  counts: DeckCounts | null
  pending: boolean
  partial: boolean
}

/** planDeckCounts 的输入：后端数字、行数据、列表全不全、上次已知与本次时刻。 */
export interface DeckCountsInput {
  backendCounts?: DeckCountsTriple | null
  rows?: DeckCountsTriple | null
  rowsComplete?: boolean
  previousCounts?: any
  previousAtMs?: number
  nowMs?: number
}

function isCount (v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && Math.floor(v) === v
}

/** 把任意形状收成三数；任一不是非负整数就回 null（坏数字当没有，不猜）。 */
function tripleOf (v: any): DeckCountsTriple | null {
  if (!v || typeof v !== 'object') return null
  if (!isCount(v.open) || !isCount(v.closed) || !isCount(v.total)) return null
  return { open: v.open, closed: v.closed, total: v.total }
}

function positiveMs (v: unknown): number {
  return (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : 0
}

/**
 * 决定这一次重建该往 deck 里写什么计数。
 *
 * 判定顺序就是文件头的四条口径：后端可信 → 完整枚举重算 → 只有后端数字 → 上次已知 → 什么都没有。
 * 顺序不能换：完整枚举优先于上次已知（列表完整时旧值必须被重算覆盖），后端可信优先于本地重算
 * （后端数字是整仓口径，行数据可能被截断）。
 */
export function planDeckCounts (input: DeckCountsInput): DeckCountsPlan {
  const src: DeckCountsInput = input || {}
  const nowMs: number = positiveMs(src.nowMs)
  const backend: DeckCountsTriple | null = tripleOf(src.backendCounts)
  const rows: DeckCountsTriple | null = tripleOf(src.rows)
  const prev: DeckCountsTriple | null = tripleOf(src.previousCounts)
  if (backend && rows && rows.total <= backend.total) {
    return {
      counts: { open: backend.open, closed: backend.closed, total: backend.total, source: 'backend', atMs: nowMs },
      pending: false,
      partial: rows.total < backend.total,
    }
  }
  if (src.rowsComplete === true && rows) {
    const conflict: DeckCountsTriple | null = (backend && rows.total > backend.total) ? backend : null
    const counts: DeckCounts = { open: rows.open, closed: rows.closed, total: rows.total, source: 'local-enumeration', atMs: nowMs }
    if (conflict) counts.conflictWith = { open: conflict.open, closed: conflict.closed, total: conflict.total }
    return { counts: counts, pending: false, partial: !!conflict }
  }
  if (backend) {
    return {
      counts: { open: backend.open, closed: backend.closed, total: backend.total, source: 'backend', atMs: nowMs },
      pending: false,
      partial: true,
    }
  }
  if (prev) {
    const prevRaw: any = src.previousCounts || {}
    const prevAt: number = positiveMs(prevRaw.atMs) || positiveMs(src.previousAtMs) || nowMs
    return {
      counts: { open: prev.open, closed: prev.closed, total: prev.total, source: 'previous-known', atMs: prevAt },
      pending: true,
      partial: true,
    }
  }
  return { counts: null, pending: true, partial: true }
}

/**
 * 数一份快照里的工单行：地图子票并集 + 未挂图的票，按身份去重（同一张票两处出现只算一次），
 * 拉取请求不算工单（与 #689 的工单口径一致）。
 *
 * 为什么按身份去重而不是直接数行：assembleSnapshot 理论上不会重复，但增量补行与地图补回两条路
 * 都可能把同一张票带进来；计数一旦重了，界面会多出一张不存在的票。
 * 没有快照、或快照里既没有 issues 也没有 maps 时回 null —— 让调用方按「拿不到」处理，不许当 0。
 */
export function rowCountsOf (snapshot: any): DeckCountsTriple | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const maps: any[] = Array.isArray(snapshot.maps) ? snapshot.maps : []
  if (!Array.isArray(snapshot.issues) && maps.length === 0) return null
  const seen: Record<string, true> = {}
  const out: DeckCountsTriple = { open: 0, closed: 0, total: 0 }
  const put = (rows: any): void => {
    for (const r of (Array.isArray(rows) ? rows : [])) {
      if (!r || r.isPullRequest === true) continue
      const key: string = String(r.key != null ? r.key : (r.number != null ? r.number : ''))
      const id: string = effortOf(r) + '#' + key
      if (seen[id]) continue
      seen[id] = true
      out.total += 1
      if (String(r.state || '').toUpperCase() === 'CLOSED') out.closed += 1
      else out.open += 1
    }
  }
  for (const m of maps) put(m && m.tickets)
  put(snapshot.issues)
  return out
}

export default { DECK_COUNT_SOURCES, planDeckCounts, rowCountsOf }
