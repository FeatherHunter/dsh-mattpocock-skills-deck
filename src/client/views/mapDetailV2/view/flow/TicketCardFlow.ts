/**
 * views/mapDetailV2/view/flow/TicketCardFlow.ts —— 一条连续的卡片流（维护者答 Q3a=B / Q3b）。
 *
 * 维护者的原话是「不想单独做完成区，是否可以在被挡下面就是已完成的」——所以这里没有「未完成区 /
 * 已完成区」两个容器，只有一段按模型排好的顺序：在办 → 可接 → 被挡 → 已完成（结案的收在最后）。
 * 卡片之间的先后顺序与状态判断全在 model/tickets/ticketBoard.ts 里算，这一层不排序、不过滤。
 *
 * 卡片的画法是 views/cards 的 PixelIssueCard（九种动作 × 正常/结案两态，深浅两套皮肤已在它自己的
 * 样式里），这里只把模型给的 props 原样递过去，不重画卡片、也不给卡片套第二层皮肤。
 *
 * 2026-10-23 维护者补了一条要求：卡片要能随宽度收窄，宽的时候一行多放几张。排法在皮肤里
 * （skin/MapDetailV2Styles.ts 的 .m2v2-flow：按最小宽度 208px 先尽量多塞，再把余宽平均分给这一行）；
 * 这一层只补样式做不到的一件事——按钮文字按「整字」消失：卡片窄到 300px 以下时，「执行 / 新会话」
 * 两颗按钮会一直缩，缩到一定程度文字开始一个字一个字地消失，最后只剩图标；再窄就是卡片最小宽度。
 * 为什么必须在这里量：CSS 只能把文字裁在像素边界上，会出现半个字；这里量出按钮里实际能放几个字，
 * 再把文字包成 .cd-lbl 的宽度设成整数个字宽，看起来才是一整字一整字地收掉。
 */
import type { IssueCardProps } from '../../../cards/cardProps'

declare function PixelIssueCard(props?: any): any

/** 一条空流的说明：用「本图 0 张子票」这句，避免再造新词条。 */
function emptyNode(h: any): any {
  return h('div', { className: 'm2v2-empty' }, tr('map.subCount', { n: 0, c: 0 }))
}

/** 把 getComputedStyle 里的长度读成数字；读不到就是 0（不拿 NaN 去参与计算）。 */
function pxOf(value: any): number {
  const n = parseFloat(String(value || ''))
  return isFinite(n) ? n : 0
}


/** 量字用的画布只建一次：每次量都新建会拖慢一排卡片的收窄。 */
let charMeasureCtx: any = null

/**
 * 一个全角汉字在当前字体下有多宽。用画布量而不是拿字号当宽度：字体回退时字宽不一定正好等于字号。
 * 量不到（没有 document、画布被禁用）就退回字号，宁可保守一点也不要算出 0。
 */
function charWidthOf(font: string): number {
  try {
    if (!charMeasureCtx && typeof document !== 'undefined' && document.createElement) {
      const canvas = document.createElement('canvas')
      charMeasureCtx = canvas && canvas.getContext ? canvas.getContext('2d') : null
    }
    if (charMeasureCtx) {
      charMeasureCtx.font = font
      const w = charMeasureCtx.measureText('字').width
      if (w > 0) return w
    }
  } catch (e) { charMeasureCtx = null }
  const size = /([0-9]+(?:\.[0-9]+)?)px/.exec(String(font || ''))
  return size ? parseFloat(size[1]) : 12
}

/**
 * 按整字收窄一排卡片里所有带文字的按钮。
 *
 * 每颗按钮里能放几个字 = 按钮内容宽度 − 图标宽 − 图标与文字的缝，再除以一个字宽，向下取整。
 * 然后把 .cd-lbl 的宽度设成「几个字 × 一个字宽」，超出的部分被它自己的 overflow:hidden 裁掉；
 * 放得下全部文字时把宽度清空（恢复自然宽度），卡片变宽时文字会一个一个回来。
 * 这个函数只读布局、只写 .cd-lbl 的宽度，不碰卡片结构与状态。
 */
function fitFlowLabels(root: any): void {
  if (!root || typeof root.querySelectorAll !== 'function' || typeof window === 'undefined') return
  const buttons = root.querySelectorAll('.cd-abtn.label')
  for (let i = 0; i < buttons.length; i += 1) {
    const btn = buttons[i]
    const lbl = btn.querySelector('.cd-lbl')
    if (!lbl) continue
    const text = String(lbl.textContent || '')
    if (!text) continue
    const btnStyle = window.getComputedStyle(btn)
    const lblStyle = window.getComputedStyle(lbl)
    // clientWidth 是「内容 + 内边距」，不含边框；所以这里只减内边距，再减图标与缝。
    const padding = pxOf(btnStyle.paddingLeft) + pxOf(btnStyle.paddingRight)
    const icon = btn.querySelector('svg')
    const iconWidth = icon && icon.getBoundingClientRect ? icon.getBoundingClientRect().width : 0
    const gap = pxOf(btnStyle.columnGap) || pxOf(btnStyle.gap)
    const avail = Math.max(0, btn.clientWidth - padding - iconWidth - gap)
    const charWidth = charWidthOf(lblStyle.font || btnStyle.font)
    const fit = Math.max(0, Math.min(text.length, Math.floor(avail / charWidth + 0.0001)))
    lbl.style.width = fit >= text.length ? '' : (fit * charWidth) + 'px'
  }
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
  const flowRef = React.useRef(null)

  // 一排卡片的可用宽度随时会变：面板拖动、宿主窗口缩放、侧栏开合。挂 ResizeObserver 盯住这一行；
  // 卡片张数变了（换了一张图、取数回来）也要重算一次——这时容器宽度不变，观察器不会响。
  // hooks 必须先于任何提前 return 调用，所以这段写在判空之前；卡片为空时 ref 是空，effect 里直接返回。
  React.useEffect(function () {
    const el = flowRef.current
    if (!el) return
    let timer: any = 0
    const run = function () { fitFlowLabels(el) }
    const schedule = function () {
      if (timer) return
      timer = setTimeout(function () { timer = 0; run() }, 0)
    }
    run()
    let observer: any = null
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(schedule)
      observer.observe(el)
    }
    window.addEventListener('resize', schedule)
    return function () {
      if (observer) observer.disconnect()
      window.removeEventListener('resize', schedule)
      if (timer) clearTimeout(timer)
    }
  }, [cards.length])

  if (props && props.empty) return emptyNode(h)
  if (!cards.length) return null

  return h('div', { className: 'm2v2-flow', ref: flowRef }, cards.map(function (card: IssueCardProps, index: number) {
    // React 的 key 用卡片自己的 id（带地图前缀，两张同号票也不会撞），没有 id 时退回编号/序号。
    const id = (card as any).cardId || (card as any).noText || ('c' + index)
    return h(PixelIssueCard, Object.assign({ key: id }, card))
  }))
}