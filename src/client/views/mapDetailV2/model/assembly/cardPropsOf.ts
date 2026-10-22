/**
 * views/mapDetailV2/model/assembly/cardPropsOf.ts —— 一张票的刻画 → 卡片组件认的 props。
 *
 * 为什么单独一层：views/cards 的卡片组件只认 IssueCardProps（视图契约），V2 的逻辑层
 * 只产出 TicketCardFacts（业务刻画）。两者之间有四处形状对不上——这一层专职把它们对齐：
 *   - bug（业务：有 bug 标签）→ bugCorner（视图：左上角红三角）；
 *   - footText（业务：可接 / 在办 / 被挡 / 已结案）→ footActionText（视图：页脚右侧那串字）；
 *   - blocks（业务：本票挡住的那张）→ blocksChip（视图：挡路条「阻塞的就是这张 #N 标题」）；
 *   - closed（视图：整张卡进结案态）由 status === 'closed' 得到一个布尔值。
 * 少了这层、把 facts 直接摊给组件，卡上会悄悄丢 BUG 三角、挡路条与页脚词——所以这一层不是包装癖，
 * 是把「业务词汇」和「视图词汇」分开的唯一地方。
 *
 * 这一份是纯函数：不读 React、不碰 DOM、不连后端。四个按钮点下去之后做什么也不在这里决定，
 * 由页面传 handlers 进来；这里只负责把「是哪张票」一并交给回调，页面不必自己记住它是从哪张卡来的。
 */
import type { IssueCardProps } from '../../../cards/cardProps'
import type { TicketCardFacts, TicketCardHandlers } from '../contracts/mapDetailTypes'

/** 把回调包成「点哪张卡就把哪张票交回去」：页面只认票，不认 DOM 事件。 */
function bind(facts: TicketCardFacts, handler: ((facts: TicketCardFacts) => void) | undefined) {
  return typeof handler === 'function' ? function () { handler(facts) } : null
}

/**
 * 一张票 → 卡片 props。
 *
 * @param facts 逻辑层刻画好的一张票。
 * @param handlers 四个按钮的页面回调；不传时对应按钮点下去什么都不做（与卡片组件「可空回调」的约定一致）。
 * @param colorOf 标签名 → 十六进制色（页面传 buildColorOf(st)）；不传时卡片按自己的兜底色画。
 *
 * 返回值里的 note 永远不给：快照行不带正文、按需取数也剥掉 body，页面上没有既准确又通用的
 * 「接下来做什么」摘要。硬塞一句假话比不画更糟。以后接了真实摘要再从这个参数传进来。
 */
export function cardPropsOf(
  facts: TicketCardFacts,
  handlers?: TicketCardHandlers | null,
  colorOf?: Record<string, string> | null,
): IssueCardProps {
  const h = handlers || {}
  return {
    action: facts.action,
    noText: facts.noText,
    title: facts.title,
    tags: facts.tags,
    updatedText: facts.updatedText,
    footActionText: facts.footText,
    closed: facts.status === 'closed',
    claimedBy: facts.claimedBy || null,
    bugCorner: facts.bug,
    pickCorner: facts.pickCorner,
    blockedBy: facts.blockedBy ? { no: facts.blockedBy.no, title: facts.blockedBy.title, cardId: facts.blockedBy.cardId } : null,
    blocksChip: facts.blocks ? { no: facts.blocks.no, title: facts.blocks.title } : null,
    cardId: facts.cardId,
    colorOf: colorOf || null,
    onMain: bind(facts, h.onMain),
    onNew: bind(facts, h.onNew),
    onCopy: bind(facts, h.onCopy),
    onOpen: bind(facts, h.onOpen),
  }
}

/** 整段卡片：按给定顺序逐张摊成 props（顺序由看板决定，这里不改）。 */
export function cardPropsListOf(
  factsList: TicketCardFacts[],
  handlers?: TicketCardHandlers | null,
  colorOf?: Record<string, string> | null,
): IssueCardProps[] {
  return factsList.map(function (facts) { return cardPropsOf(facts, handlers, colorOf) })
}
