/**
 * views/mapDetailV2/view/flow/TicketCardFlow.ts —— 一条连续的卡片流（维护者答 Q3a=B / Q3b）。
 *
 * 维护者的原话是「不想单独做完成区，是否可以在被挡下面就是已完成的」——所以这里没有「未完成区 /
 * 已完成区」两个容器，只有一段按模型排好的顺序：在办 → 可接 → 被挡 → 已完成（结案的收在最后）。
 * 卡片之间的先后顺序与状态判断全在 model/tickets/ticketBoard.ts 里算，这一层不排序、不过滤。
 *
 * 卡片的画法是 views/cards 的 PixelIssueCard（八种动作 × 正常/结案两态，深浅两套皮肤已在它自己的
 * 样式里），这里只把模型给的 props 原样递过去，不重画卡片、也不给卡片套第二层皮肤。
 */
import type { IssueCardProps } from '../../../cards/cardProps'

declare function PixelIssueCard(props?: any): any

/** 一条空流的说明：用「本图 0 张子票」这句，避免再造新词条。 */
function emptyNode(h: any): any {
  return h('div', { className: 'm2v2-empty' }, tr('map.subCount', { n: 0, c: 0 }))
}

/**
 * 画卡片流。props: { cards: IssueCardProps[], empty: boolean }。
 * empty 只有在「取到了数、确实一张子票都没有」时才为 true（loading / 取不到 / 后端不支持时不算空，
 * 由档案区的「子票那句」说明情况），所以这里不必再判取数状态。
 */
export function TicketCardFlow(props: any): any {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const cards: IssueCardProps[] = (props && props.cards) || []
  if (props && props.empty) return emptyNode(h)
  if (!cards.length) return null

  return h('div', { className: 'm2v2-flow' }, cards.map(function (card: IssueCardProps, index: number) {
    // React 的 key 用卡片自己的 id（带地图前缀，两张同号票也不会撞），没有 id 时退回编号/序号。
    const id = (card as any).cardId || (card as any).noText || ('c' + index)
    return h(PixelIssueCard, Object.assign({ key: id }, card))
  }))
}
