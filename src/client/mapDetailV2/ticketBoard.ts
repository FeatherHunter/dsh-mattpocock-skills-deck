/**
 * src/client/mapDetailV2/ticketBoard.ts —— 未完成票的排法、已完成票的收法、看板计数。
 *
 * 页面要的效果（维护者原话）：不按层级分了，所有卡片都放在页面里，被完成的聚集在下方。
 * 于是这里要回答两个问题：
 *   ① 未完成的票按什么次序摆？——「可接的排在前面，被挡的紧挨挡它的那张」。
 *   ② 已完成的票怎么收？——单独一段，最近结案的排前面。
 *
 * 为什么排序单独写成算法而不是一句 sort：如果有两张票 A、B，B 被 A 挡住，可 B 又想排在很后面，
 * 「按状态分区 + 按编号排」会把这两张拆到屏幕两头，用户就得来回找「到底是谁挡着它」。
 * 所以这里用「附件段」：先给每张被挡票认一个主阻塞者，再从根（没有页面内阻塞者的票）出发，
 * 走到一张票就紧接着把「它挡住的票」一起输出。结果就是一段一段：「A → 被 A 挡住的 B、C」。
 *
 * 为什么这个算法是对的（三条性质，门禁逐条钉住）：
 *   ① 每张票恰好出现一次（有已输出集合，成环的脏数据也不会画两遍或漏画）；
 *   ② 输入顺序不影响结果（根与附件段都按「状态优先级 → 编号」排定，是确定性的）；
 *   ③ 每个被挡票都排在挡它的那张之后，且中间只隔着同一张票挡住的其它票（紧挨着）。
 *
 * 复杂度：排序 O(n log n)，走图 O(n + 边数)。没有递归深度风险：票数与阻塞链深度都在百级以内，
 * 而递归只沿「挡住谁」这条边往下走。
 */
import type { TicketBoard, TicketBoardCounts, TicketCardFacts, TicketCardStatus } from './mapDetailTypes'

/** 状态优先级：可接先看，在办其次，被挡最后；已关闭不进这一段，排在这里只为查表完整。 */
const STATUS_RANK: Record<TicketCardStatus, number> = { ready: 0, doing: 1, blocked: 2, closed: 3 }

/** 编号缺失的票排在最后（不猜它在哪）：编号是唯一可靠的排序键。 */
function numberOrLast(facts: TicketCardFacts): number {
  return facts.number === null ? Number.MAX_SAFE_INTEGER : facts.number
}

/** 同一段里的排法：先看状态优先级，再看编号，最后用行 key 兜底保证完全确定。 */
function compareForPlacement(left: TicketCardFacts, right: TicketCardFacts): number {
  const byRank = STATUS_RANK[left.status] - STATUS_RANK[right.status]
  if (byRank !== 0) return byRank
  const byNumber = numberOrLast(left) - numberOrLast(right)
  if (byNumber !== 0) return byNumber
  return left.rowKey < right.rowKey ? -1 : left.rowKey > right.rowKey ? 1 : 0
}

/** 一张票的唯一名字：排序去重、走图防环都用它，不依赖对象身份。 */
function keyOf(facts: TicketCardFacts): string {
  return facts.number === null ? 'k:' + facts.rowKey : 'n:' + String(facts.number)
}

/**
 * 未完成票的顺序。
 *
 * 分两步：先认关系（这张被谁挡、那张挡住谁），再走图输出。
 * 被挡票只在「挡它的那张也在这一段里」时才挂到它后面——挡路者已结案或不在本图时，
 * 这张票本来就该当可接票排（与宿主 frontier 同口径）。
 */
export function orderOpenTickets(facts: readonly TicketCardFacts[]): TicketCardFacts[] {
  const open = facts.filter(function (one) { return one.status !== 'closed' })
  const openByNumber: Record<string, boolean> = {}
  for (const one of open) {
    if (one.number !== null) openByNumber[String(one.number)] = true
  }

  const attachedTo: Record<string, TicketCardFacts[]> = {}
  const roots: TicketCardFacts[] = []
  for (const one of open) {
    const blockerNo = one.blockedBy ? one.blockedBy.no : ''
    // 自阻塞（一张票把自己写成阻塞者）是脏数据：不挂附件，当根处理，免得它从页面里消失。
    if (blockerNo && openByNumber[blockerNo] && blockerNo !== String(one.number)) {
      if (!attachedTo[blockerNo]) attachedTo[blockerNo] = []
      attachedTo[blockerNo].push(one)
    } else {
      roots.push(one)
    }
  }
  for (const blockerNo of Object.keys(attachedTo)) attachedTo[blockerNo].sort(compareForPlacement)

  const order: TicketCardFacts[] = []
  const emitted: Record<string, boolean> = {}
  const visit = function (one: TicketCardFacts): void {
    const key = keyOf(one)
    if (emitted[key]) return
    emitted[key] = true
    order.push(one)
    const children = attachedTo[String(one.number)] || []
    for (const child of children) visit(child)
  }

  roots.sort(compareForPlacement)
  for (const root of roots) visit(root)

  // 脏数据兜底：互相挡住、谁也到不了根的那几张票，也要画出来（不能因为数据成环就整片空白）。
  const leftovers = open.filter(function (one) { return !emitted[keyOf(one)] }).sort(compareForPlacement)
  for (const one of leftovers) visit(one)
  return order
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
    return numberOrLast(left) - numberOrLast(right)
  })
}

/** 看板的两段：未完成一段、已完成一段。调用方拿到就直接画，不再自己分组。 */
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
