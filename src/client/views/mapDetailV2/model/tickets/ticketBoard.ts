/**
 * views/mapDetailV2/model/tickets/ticketBoard.ts —— 未完成票的排法、已完成票的收法、看板计数。
 *
 * 页面要的效果（维护者 2026-10-22 定的口径）：不按层级分组，所有卡片平铺在同一页里；
 * 未完成的分三段摆——先「在办」，再「可接」，最后「被挡」；已完成的卡片不另起区块，
 * 直接接在被挡的卡片下面，仍然按最近结案的排前面。
 *
 * 为什么这样排（而不是按编号一路排下去）：这三段对应「我现在最该看什么」的次序。
 * 在办的票是有人正在推的，看一眼进度；可接的票是下一个能拿的；被挡的票要等别人，
 * 排在最后才不会占住视线。已完成属于「做完的账」，接在最后，不打断未完的那三段。
 *
 * 被挡这一段内部再按「挡它的那张票」的编号聚一次：同一张票挡住的好几张排在一起，
 * 一眼能看出是同一处卡住。被挡的关系本身不靠相邻表达——卡上有红色封条「被 #N 阻塞」，
 * 挡路的那张卡上也有「阻塞的就是这张」。所以排序只负责「同类靠在一起」，关系由卡片自己说清。
 *
 * 两条性质（门禁逐条钉住）：
 *   ① 每张票恰好出现一次：排序是 filter + sort，不做走图，成环、自阻塞、撞号、编号都缺的脏行
 *      都不会被丢掉或画两遍；
 *   ② 输入顺序不影响结果：排序键依次是状态段、挡路者编号、本票编号、行 key、标题，
 *      每一项都是行自己的数据，不读输入下标（只有在所有这些都相同的两行上，才轮到输入顺序）。
 *
 * 复杂度 O(n log n)，n 是子票张数；不递归、不走图，十万张票也不会撑爆调用栈。
 */
import type { TicketBoard, TicketBoardCounts, TicketCardFacts, TicketCardStatus } from '../contracts/mapDetailTypes'

/**
 * 状态段的次序：在办 → 可接 → 被挡。已关闭不进这一段（单独一段，排在最后画），
 * 这里给它一个值只是为了查表完整，不参与未完成段的比较。
 */
const STATUS_RANK: Record<TicketCardStatus, number> = { doing: 0, ready: 1, blocked: 2, closed: 3 }

/** 编号缺失的票排在最后（不猜它在哪）：编号是唯一可靠的排序键。 */
function numberOrLast(facts: TicketCardFacts): number {
  return facts.number === null ? Number.MAX_SAFE_INTEGER : facts.number
}

/**
 * 挡路者的编号：被挡这一段按它排，让同一张票挡住的好几张连在一起。
 * 没有 blockedBy 的票（不该出现在被挡段）当作「挡路者未知」，排在该段最后。
 */
function blockerNumberOrLast(facts: TicketCardFacts): number {
  if (!facts.blockedBy) return Number.MAX_SAFE_INTEGER
  const parsed = Number(String(facts.blockedBy.no).replace(/^#/, ''))
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

/**
 * 同一段里的兜底比较：先看本票编号，再看行 key，再看标题。
 *
 * 行 key 与标题都一样的行是真正等价的两行（没有编号、没有 key、连标题都相同），
 * 这时不再有可靠的区别，只能随输入顺序——这一条写清楚，免得以后误以为排序不稳定。
 */
function compareWithinSection(left: TicketCardFacts, right: TicketCardFacts): number {
  const byNumber = numberOrLast(left) - numberOrLast(right)
  if (byNumber !== 0) return byNumber
  if (left.rowKey !== right.rowKey) return left.rowKey < right.rowKey ? -1 : 1
  if (left.title !== right.title) return left.title < right.title ? -1 : 1
  return 0
}

/** 未完成段的比较：状态段 → （被挡时）挡路者编号 → 本票编号 → 行 key → 标题。 */
function compareForOpenPlacement(left: TicketCardFacts, right: TicketCardFacts): number {
  const byRank = STATUS_RANK[left.status] - STATUS_RANK[right.status]
  if (byRank !== 0) return byRank
  if (left.status === 'blocked' && right.status === 'blocked') {
    const byBlocker = blockerNumberOrLast(left) - blockerNumberOrLast(right)
    if (byBlocker !== 0) return byBlocker
  }
  return compareWithinSection(left, right)
}

/**
 * 未完成票的顺序：在办 → 可接 → 被挡（被挡段内按挡路者编号聚拢）。
 * 只排序，不丢任何一张；传进来的已关闭票由调用方自己先滤掉（orderTicketBoard 会分两段）。
 */
export function orderOpenTickets(facts: readonly TicketCardFacts[]): TicketCardFacts[] {
  const open = facts.filter(function (one) { return one.status !== 'closed' })
  return open.sort(compareForOpenPlacement)
}

/** 结案时间解析成毫秒；解析不出当 0（那些票排在最后，但不丢）。 */
function closedStampOf(facts: TicketCardFacts): number {
  const parsed = Date.parse(facts.closedAt || '')
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 已完成票的顺序：最近结案的排前面，同一时刻按编号升序。
 * 已完成的这一段是「做完的账」——最新的放最前面，一眼能看到刚收掉的活。
 */
export function orderClosedTickets(facts: readonly TicketCardFacts[]): TicketCardFacts[] {
  const closed = facts.filter(function (one) { return one.status === 'closed' })
  return closed.sort(function (left, right) {
    const byStamp = closedStampOf(right) - closedStampOf(left)
    if (byStamp !== 0) return byStamp
    return compareWithinSection(left, right)
  })
}

/**
 * 看板的两段：未完成一段、已完成一段。页面把两段接起来画成一条连续序列，
 * 不在中间另起标题或分隔（维护者口径：已完成接在被挡下面，不单独做区块）。
 */
export function orderTicketBoard(facts: readonly TicketCardFacts[]): TicketBoard {
  return { open: orderOpenTickets(facts), closed: orderClosedTickets(facts) }
}

/** 看板计数：与宿主 groupTickets 的五个桶同口径（total/open/closed/frontier/claimed/blocked）。 */
export function boardCountsOf(facts: readonly TicketCardFacts[]): TicketBoardCounts {
  const counts: TicketBoardCounts = { total: 0, closed: 0, ready: 0, doing: 0, blocked: 0 }
  for (const one of facts) {
    counts.total += 1
    if (one.status === 'closed') counts.closed += 1
    else if (one.status === 'ready') counts.ready += 1
    else if (one.status === 'doing') counts.doing += 1
    else counts.blocked += 1
  }
  return counts
}
