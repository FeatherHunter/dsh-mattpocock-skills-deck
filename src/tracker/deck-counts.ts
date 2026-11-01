/**
 * src/tracker/deck-counts.ts —— 面板计数的诚实口径（#1698 起步，#1796 收口）。
 *
 * 为什么单独一层：计数有三个消费者（宿主拼快照、增量补行、客户端列表 KPI），三处必须用同一套
 * 「这个数字从哪来、能不能信、这份清单缺没缺」的判断，否则界面会出现假 0，或者列表与状态栏各说各的。
 * 本文件只放纯函数：不读写快照、不发请求、不碰缓存。
 *
 * #1796 起口径分成两件事：
 * 一、数字（deck.counts）：后端 counts 是整仓口径，可信时就用它，来源记「后端」；拿不到时保留上次已知的
 *   数字与时刻，标「待校准」，界面显示未知而不是 0；一点证据都没有时不写 counts（绝不写 0/0/0 冒充
 *   「真的没有票」）。#1796 之前还有一档「本地按行重算」——首屏改成只装开放工作集之后，已关闭历史本来
 *   就不进首屏，本地数不出 closed 与 total，这一档随之取消。
 * 二、全不全（deck.partial）：只报「异常缺失」。首屏按设计只装开放工作集与地图容器行，已关闭历史不装，
 *   所以「已关闭只装了一部分」不算缺。真正算缺的只有五种：
 *   1) 开放工作集的行数比后端计数的 open 少（旧开放票又被窗口挤掉了 —— 这就是 #1796 的现场）；
 *   2) 这一趟列表触到了后端上限（工单 500 / 拉取请求 1000）；
 *   3) 这一趟走了 REST 降级（行是兜回来的，可能与 GraphQL 的口径不同）；
 *   4) 后端计数与开放行数冲突（行比后端还多，留痕 conflictWith）或者压根拿不到计数；
 *   5) 开放容器的子票没拉全或拉不到（子票也是首屏的一部分：地图详情要数清「共 N 张」，规格要看出做完了几张）。
 *      后端本身不提供子票（listSubIssues 回 unsupported）不算缺 —— 那是能力边界，不是这一趟的故障。
 *   开放行数比后端多时同样 partial 置真，并把后端数字留在 conflictWith 里供排查。
 *
 * 反例（写代码时最常犯的两个错）：
 * - 拿不到任何证据时返回 0/0/0 —— 界面会当成「真的没有票」，必须返回 null 并标待校准；
 * - 把「已关闭历史只装首页」当成缺 —— 那是规格 677 §6.3 的设计，不是异常，置真会让橙点常亮。
 */

import { effortOf } from './kernel/identity-keys.js'

/** 计数来源的三个取值：后端给的、本地按行数出来的、上次已知保留的（本地枚举只留老快照与界面文案用）。 */
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

/** 一次计数决策的结果：数字（可能没有）+ 待校准标记 + partial（清单有没有异常缺失）。 */
export interface DeckCountsPlan {
  counts: DeckCounts | null
  pending: boolean
  partial: boolean
}

/** planDeckCounts 的输入：后端数字、开放工作集行数、列表全不全、上次已知与本次时刻。 */
export interface DeckCountsInput {
  backendCounts?: DeckCountsTriple | null
  /** 首屏开放工作集里数到的未关闭行数（含开放地图的容器行）；拿不到时给 null 或省略。 */
  openRows?: number | null
  /** 这一趟列表触到了后端上限（工单 500 / 拉取请求 1000）。 */
  listTruncated?: boolean
  /** 这一趟列表走了 REST 降级。 */
  listFallback?: boolean
  /** 这一趟有几张开放容器的子票拉取失败（网络、形状错这一类硬失败；后端不提供子票的不计）。 */
  subIssuesFailed?: number
  /** 这一趟有几张开放容器的子票没拉全（撞到上限，或与后端 totalCount 对不上）。 */
  subIssuesIncomplete?: number
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

/** 计数类输入收窄：非负整数且大于 0 才算「有」，缺省与坏形状一律当没有。 */
function isPositiveCount (v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

/**
 * 决定这一次重建该往 deck 里写什么数字、要不要标「待校准」、要不要把 partial 置真。
 *
 * 判定顺序：后端数字 → 上次已知 → 什么都没有。partial 的四种异常缺失见文件头第二条；
 * 它们与「来源是哪一档」分开算 —— 有后端数字也可能 partial 为真（列表截断、降级、行对不上）。
 */
export function planDeckCounts (input: DeckCountsInput): DeckCountsPlan {
  const src: DeckCountsInput = input || {}
  const nowMs: number = positiveMs(src.nowMs)
  const backend: DeckCountsTriple | null = tripleOf(src.backendCounts)
  const prev: DeckCountsTriple | null = tripleOf(src.previousCounts)
  const openRows: number | null = isCount(src.openRows) ? (src.openRows as number) : null
  if (backend) {
    const counts: DeckCounts = { open: backend.open, closed: backend.closed, total: backend.total, source: 'backend', atMs: nowMs }
    // 行比后端还多：两边对不上，以哪边为准都无法解释。数字仍用后端的（整仓口径），冲突留痕给排查。
    const conflict: boolean = openRows !== null && openRows > backend.open
    if (conflict) counts.conflictWith = { open: backend.open, closed: backend.closed, total: backend.total }
    const partial: boolean = src.listTruncated === true || src.listFallback === true || openRows === null || openRows !== backend.open || isPositiveCount(src.subIssuesFailed) || isPositiveCount(src.subIssuesIncomplete)
    return { counts: counts, pending: false, partial: partial }
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
 * 数首屏开放工作集里的未关闭行数（含开放地图的容器行，不含拉取请求），没有证据时回 null。
 *
 * 为什么单独数一遍而不是复用 rowCountsOf 那样的快照计数：后端 counts 的 open 含地图容器本身，
 * 快照里的行数在组装后会漏掉容器行；两边口径不一致会把「本来没缺」误报成缺。这里直接数组装前的
 * 并集行，口径与「已关闭之外的票 + 容器」对齐。
 * 为什么按身份去重：子票既可能在开放池里（开放子票），也可能由地图子票这条线补回来；重了会虚增。
 */
export function openRowsOf (rows: any[]): number | null {
  if (!Array.isArray(rows)) return null
  const seen: Record<string, true> = {}
  let open = 0
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    // 拉取请求不算工单（#689 口径）：后端 counts 的 open 也不含它们。
    if (r.isPullRequest === true) continue
    const key: string = String(r.key != null ? r.key : (r.number != null ? r.number : ''))
    if (!key) continue
    const id: string = effortOf(r) + '#' + key
    if (seen[id]) continue
    seen[id] = true
    if (String(r.state || '').toUpperCase() !== 'CLOSED') open += 1
  }
  return open
}

export default { DECK_COUNT_SOURCES, planDeckCounts, openRowsOf }
