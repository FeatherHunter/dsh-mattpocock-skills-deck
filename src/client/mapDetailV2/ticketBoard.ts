/**
 * src/client/mapDetailV2/ticketBoard.ts —— 未完成票的排法、已完成票的收法、看板计数。
 *
 * 页面要的效果（维护者原话）：不按层级分了，所有卡片都放在页面里，被完成的聚集在下方。
 * 于是这里要回答两个问题：
 *   ① 未完成的票按什么次序摆？——「可接的排在前面，被挡的排在挡它的那张之后」。
 *   ② 已完成的票怎么收？——单独一段，最近结案的排前面。
 *
 * 为什么排序单独写成算法而不是一句 sort：如果有两张票 A、B，B 被 A 挡住，可 B 又想排在很后面，
 * 「按状态分区 + 按编号排」会把这两张拆到屏幕两头，用户就得来回找「到底是谁挡着它」。
 * 所以这里用「附件段」：先给每张被挡票认一个主阻塞者，再从根（没有页面内阻塞者的票）出发，
 * 走到一张票就紧接着把「它挡住的票」一起输出。结果就是一段一段：「A → 被 A 挡住的 B、C」。
 *
 * 为什么这个算法是对的（三条性质，门禁逐条钉住）：
 *   ① 每张票恰好出现一次（有已输出集合，成环、撞号、编号与行 key 都缺的脏数据也不会画两遍或漏画）；
 *   ② 输入顺序不影响结果（根与附件段都按「状态优先级 → 编号」排定，是确定性的）；
 *   ③ 每个被挡票都排在挡它的那张之后。同一张挡路者挡住好几张时，这几张「同门兄弟」连续排在一起
 *      （逐层先序：先排完这一层的直接孩子，再往下走），所以被挡票紧挨着挡路者或紧挨着同门兄弟，
 *      不会被某个兄弟的长子树推到很远。
 *
 * 复杂度：排序 O(n log n)，走图 O(n + 边数)。走图用显式队列而不是递归：阻塞链有多长都不受
 * 调用栈深度限制，脏数据里一条很长甚至自指的链也不会把页面撑崩。
 */
import type { TicketBoard, TicketBoardCounts, TicketCardFacts, TicketCardStatus } from './mapDetailTypes'

/** 状态优先级：可接先看，在办其次，被挡最后；已关闭不进这一段，排在这里只为查表完整。 */
const STATUS_RANK: Record<TicketCardStatus, number> = { ready: 0, doing: 1, blocked: 2, closed: 3 }

/** 编号缺失的票排在最后（不猜它在哪）：编号是唯一可靠的排序键。 */
function numberOrLast(facts: TicketCardFacts): number {
  return facts.number === null ? Number.MAX_SAFE_INTEGER : facts.number
}

/**
 * 同一段里的排法：先看状态优先级，再看编号，再用行 key 与标题兜底。
 *
 * 行 key 与标题都一样的行是真正等价的两行（没有编号、没有 key、连标题都相同），
 * 这时不再有可靠的区别，只能随输入顺序——这一条写清楚，免得以后误以为排序不随机。
 */
function compareForPlacement(left: TicketCardFacts, right: TicketCardFacts): number {
  const byRank = STATUS_RANK[left.status] - STATUS_RANK[right.status]
  if (byRank !== 0) return byRank
  const byNumber = numberOrLast(left) - numberOrLast(right)
  if (byNumber !== 0) return byNumber
  if (left.rowKey !== right.rowKey) return left.rowKey < right.rowKey ? -1 : 1
  if (left.title !== right.title) return left.title < right.title ? -1 : 1
  return 0
}

/**
 * 一张票的底名：编号 + 行自己的 key。正常数据里它已经唯一；脏数据里两张票可能连这组内容都一样
 * （撞号、都没 key），所以走图时还会在底名后面接上「这是输入里的第几张」，
 * 保证「每张行恰好出现一次」——撞号的两张都还在页面上，谁也不被静默丢掉。
 */
function baseKeyOf(facts: TicketCardFacts): string {
  return facts.number === null ? 'k:' + facts.rowKey : 'n:' + String(facts.number) + '#' + facts.rowKey
}

/**
 * 未完成票的顺序（逐层先序：同门兄弟紧挨，见文件头性质③）。
 *
 * 分两步：先认关系（这张被谁挡、那张挡住谁），再走图输出。
 * 被挡票只在「挡它的那张也在这一段里」时才挂到它后面——挡路者已结案或不在本图时，
 * 这张票本来就该当可接票排（与宿主 frontier 同口径）。
 */
export function orderOpenTickets(facts: readonly TicketCardFacts[]): TicketCardFacts[] {
  const open = facts.filter(function (one) { return one.status !== 'closed' })

  // 每个节点带两样东西：原来的刻画，和「底名 + 输入序号」这个本次走图里的唯一名字。
  // 序号是最后一道保险：脏数据里两张行可能连编号带 key 都一样，只靠内容认不出是两张不同的行。
  const nodes: Array<{ facts: TicketCardFacts; key: string }> = open.map(function (one, index) {
    return { facts: one, key: baseKeyOf(one) + '#' + index }
  })

  // 编号 → 节点下标（同号只认先出现的那张）：附件挂靠与「谁挡谁」都只能按编号找。
  const indexByNumber: Record<string, number> = {}
  for (let i = 0; i < nodes.length; i += 1) {
    const number = nodes[i].facts.number
    if (number !== null && indexByNumber[String(number)] === undefined) indexByNumber[String(number)] = i
  }

  const attachedTo: Record<string, number[]> = {}
  const roots: number[] = []
  for (let i = 0; i < nodes.length; i += 1) {
    const one = nodes[i].facts
    const blockerNo = one.blockedBy ? one.blockedBy.no : ''
    const parent = blockerNo ? indexByNumber[blockerNo] : undefined
    // 自阻塞（一张票把自己写成阻塞者）当根处理；免得它从页面里消失。
    if (parent !== undefined && parent !== i) {
      // 附件表按「父节点的名字」记：children 是挂在挡路者下面的票，不是挂在被挡票自己下面。
      const parentKey = nodes[parent].key
      if (!attachedTo[parentKey]) attachedTo[parentKey] = []
      attachedTo[parentKey].push(i)
    } else {
      roots.push(i)
    }
  }
  for (const parentKey of Object.keys(attachedTo)) {
    attachedTo[parentKey].sort(function (left, right) {
      return compareForPlacement(nodes[left].facts, nodes[right].facts)
    })
  }

  // 先标记再入队：一张票只可能被挂在一段附件里或当一次根，标记放在出队时做会漏掉
  // 「同一张票被两处指向」的脏数据，放在入队时才真正保证「每张票画一次」。
  const order: TicketCardFacts[] = []
  const emitted: Record<string, boolean> = {}
  const queue: number[] = []
  let head = 0
  const push = function (index: number): void {
    const key = nodes[index].key
    if (emitted[key]) return
    emitted[key] = true
    queue.push(index)
  }

  // 逐层先序（BFS）：先自己，再把直接附件按排好的次序排完，然后才轮到它们的附件。
  // 换掉深搜是为了「同门兄弟连续」——深搜会把兄弟的长子树插进兄弟之间，被挡票离挡路者越来越远。
  const drain = function (): void {
    while (head < queue.length) {
      const index = queue[head]
      head += 1
      order.push(nodes[index].facts)
      const children = attachedTo[nodes[index].key] || []
      for (let i = 0; i < children.length; i += 1) push(children[i])
    }
  }

  const byPlacement = function (left: number, right: number): number {
    return compareForPlacement(nodes[left].facts, nodes[right].facts)
  }

  // 每棵树走完再走下一条根：所有根先入队的话，先入队的根挡住的那张会被排到最后一条根之后。
  roots.sort(byPlacement)
  for (let i = 0; i < roots.length; i += 1) {
    push(roots[i])
    drain()
  }

  // 脏数据兜底：互相挡住、谁也到不了根的那几张票，也要画出来（不能因为数据成环就整片空白）。
  // 必须等根那一片走完再算：先算的话，根下面的附件还没标记，会被误当成「到不了根」的孤儿。
  const leftovers: number[] = []
  for (let i = 0; i < nodes.length; i += 1) {
    if (!emitted[nodes[i].key]) leftovers.push(i)
  }
  leftovers.sort(byPlacement)
  for (let i = 0; i < leftovers.length; i += 1) {
    push(leftovers[i])
    drain()
  }
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
    const byNumber = numberOrLast(left) - numberOrLast(right)
    if (byNumber !== 0) return byNumber
    // 没有编号的票在这里会拿到同一个「最后」值；再用行 key 兜底，排序才不受输入顺序影响。
    return left.rowKey < right.rowKey ? -1 : left.rowKey > right.rowKey ? 1 : 0
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
