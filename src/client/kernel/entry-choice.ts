/**
 * kernel/entry-choice.ts —— 「新建需求」入口浮层：一个入口 → 一层浮层 → 两张卡（#1297：入口浮层）。
 *
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥掉行首 export，
 * 把声明体拼回 src/client/index.ts 的 `// ==== kernel:entryChoice (spliced by build) ====`
 * 标记处（源码树里只有这一份真源）。拼接次序要求 kernel:entryCard 在本片之前
 * （本片画卡要调 buildEntryCard），两者都排在 leaf:tabs / leaf:statusBar 之前。
 *
 * 为什么这一片要独立成内核件：这个入口出现在两处（面板页签行右端、状态栏胶囊的悬停菜单），
 * 两处必须弹同一层浮层、给出同一套开场白。所以两处只调用本文件里的同一组函数，
 * 宿主那一侧不再各自拼一份文案或各自写一套开新会话的调用。
 *
 * 排布与位置由入口决定，两处不一样是对的：状态栏在屏幕底部，浮层从按钮正上方弹出、
 * 两张卡横排（探索地图在左、实施地图在右）；面板页签行在面板顶部，浮层从按钮正下方弹出、
 * 两张卡竖排。左右都先与触发器左沿对齐，右边放不下时才把右沿顶到屏幕右侧。
 *
 * 状态住全局 store（src/refresh/rooms/client/snapshot-cache-store.ts 的 entryOpen / entryFrom / entryPos）：
 * 两处宿主都挂在面板与状态栏这两个可能先卸载的树里，浮层必须挂到 document.body（portalTop），
 * 由本组件自己读状态决定画不画，宿主只管「点触发器时把浮层打开」这一件事。
 *
 * 日志（dsh-log 纪律：只在用户动作边界留整趟轨迹）：
 *   - entry.open：浮层打开那一趟，记 from（哪个入口打开的）与 cards（这一次给了几张卡）。
 *   - entry.pick：选卡这一趟，记 from、card（选了哪张）、ok（开新会话的调用发出去没有）、
 *     textLen（注入的提示词有多长，用来一眼看出「选了卡却拿到空提示词」这类故障）。
 *   两件事都是低频用户动作，定常驻；字段只有枚举、布尔与长度，不记提示词原文、不记路径。
 */

declare const React: any
declare const h: any
declare const portalTop: any
declare const emit: any
declare const log: (...args: any[]) => void
declare const openTextInNewSession: any
declare const newWayfinderText: any
declare const newSpecText: any
declare const newSessionTitleNew: any
declare const tr: (...args: any[]) => any
declare const CONTAINER_ACCENT: any
declare const buildEntryCard: any
declare const MOTION: any; // #1236 动效时长统一在 kernel/motion.ts，本文件只引用不写真值

export const ENTRY_CHOOSER_WIDTH = 392
// 状态栏那一处是横排两张卡：两张卡各 368 宽、卡间隙 9、左右内边距各 12，合计 769。
export const ENTRY_CHOOSER_WIDE = 769
const ENTRY_CARD_GAP = 9
const ENTRY_CHOOSER_Z = 2147483000
// 两张卡的顺序是定稿：探索地图在前、实施地图在后（状态栏横排时就是探索在左、实施在右）；
// 插件不替人判断该走哪条，所以不做任何排序。
const ENTRY_CARDS = ['map', 'spec']
// 打开浮层时的那颗触发器元素：点它自己算「按了一下开关」，不算「点了外面」，否则会先关又开、看起来像点了没反应。
let entryTriggerEl: any = null

function viewportSize(): any {
  try {
    const w = (typeof window !== 'undefined' && window && window.innerWidth) ? window.innerWidth : 0
    const hgt = (typeof window !== 'undefined' && window && window.innerHeight) ? window.innerHeight : 0
    return { w: Math.max(320, w || 0), h: Math.max(320, hgt || 0) }
  } catch (e) { return { w: 1200, h: 800 } }
}

/** 浮层宽度由入口决定：状态栏横排两张卡要宽一些，面板竖排两张卡只要一张卡的宽度。 */
function chooserWidth(horizontal: any): number {
  return horizontal ? ENTRY_CHOOSER_WIDE : ENTRY_CHOOSER_WIDTH
}

/**
 * 浮层该从哪一列开始。规则是「先与触发器左沿对齐」：从按钮正下方（面板）或正上方（状态栏）展开；
 * 右边空间不够时把右沿顶到屏幕右侧（留 8px），否则浮层会跑到屏幕外；左边同理夹到 8px。
 */
function chooserLeft(rect: any, width: any, vp: any): number {
  const anchor = rect ? rect.left : 16
  let left = Math.round(anchor)
  const maxLeft = Math.round(vp.w - width - 8)
  if (left > maxLeft) left = maxLeft
  if (left < 8) left = 8
  return left
}

/**
 * 量出浮层该出现的位置、宽度与排布方向。
 * 状态栏在屏幕底部：往上弹，底边钉在锚点上沿上方 6px，两张卡横排；
 * 面板页签行在面板顶部：往下弹，顶边钉在锚点下沿下方 6px，两张卡竖排。
 */
function placeChooser(from: any, el: any): any {
  const vp = viewportSize()
  // 屏幕太窄放不下横排两张卡时退回竖排，免得浮层比屏幕还宽、两边都点不到。
  const horizontal = from === 'statusbar' && vp.w >= ENTRY_CHOOSER_WIDE + 16
  const width = chooserWidth(horizontal)
  const rect = (el && typeof el.getBoundingClientRect === 'function') ? el.getBoundingClientRect() : null
  const left = chooserLeft(rect, width, vp)
  const top = rect ? rect.top : 64
  const bottom = rect ? rect.bottom : 88
  if (horizontal) {
    return { width: width, left: left, bottom: Math.max(8, Math.round(vp.h - top + 6)), horizontal: true }
  }
  return { width: width, left: left, top: Math.round(bottom + 6), horizontal: false }
}

/** 打开浮层（再点同一个入口就是关掉；从另一个入口点则重新量位置、把浮层挪过去）。
 *  from 只有 'panel' / 'statusbar' 两个值。 */
export const entryChooserOpen = function (st: any, from: any, el: any) {
  if (!st || typeof st !== 'object') return
  const src = (from === 'statusbar') ? 'statusbar' : 'panel'
  // 同一个入口再点一次才是「关」：从另一处入口点过来要挪过去，否则人会以为点了没反应。
  if (st.entryOpen && st.entryFrom === src) { entryChooserClose(st); return }
  try {
    entryTriggerEl = el || null
    st.entryOpen = true
    st.entryFrom = src
    st.entryPos = placeChooser(src, el)
    try { log('info', 'entry.open', { from: src, cards: ENTRY_CARDS.length }) } catch (eLog) {}
    if (typeof emit === 'function') emit(st)
  } catch (e) {
    // 量位置或写状态抛了：把开关退回关，并记一条「这次没打开」的轨迹（cards 记 0 表示一张卡都没给出来）。
    try {
      st.entryOpen = false
      st.entryFrom = ''
      st.entryPos = null
      entryTriggerEl = null
      log('warn', 'entry.open', { from: src, cards: 0 })
    } catch (eLog) {}
  }
}

/** 关掉浮层并把位置清掉（下次打开重新量，免得窗口挪了还用旧坐标）。 */
export const entryChooserClose = function (st: any) {
  if (!st || typeof st !== 'object') return
  try {
    st.entryOpen = false
    st.entryFrom = ''
    st.entryPos = null
    entryTriggerEl = null
    if (typeof emit === 'function') emit(st)
  } catch (e) {}
}

/**
 * 选了一张卡：拼提示词 → 记一行 → 关浮层 → 让新会话带着这段开场白打开。
 * 两张卡分别走各自的拼装函数（探索地图 /wayfinder、实施地图 /grill-with-docs 讨论），
 * 这两个函数住在 kernel/router.ts，两处入口共用同一份，逐字一致靠的就是这一条。
 */
function pickEntry(st: any, kind: any) {
  const card = (kind === 'spec') ? 'spec' : 'map'
  const from = String((st && st.entryFrom) || '')
  let text = ''
  let title = ''
  try {
    text = (card === 'map') ? newWayfinderText(st) : newSpecText(st)
    title = newSessionTitleNew(card === 'map' ? 'requirement' : 'spec')
  } catch (eAssemble) {
    try { log('warn', 'entry.pick', { from: from, card: card, ok: false, textLen: 0 }) } catch (eLog) {}
    return
  }
  const textLen = String(text == null ? '' : text).length
  // 先关浮层再开新会话：浮层是挂 body 的独立层，留着它会盖在新会话的界面上。
  entryChooserClose(st)
  try {
    openTextInNewSession(st, text, title)
  } catch (eOpen) {
    // 同步就抛说明这趟连调用都没发出去；异步过程里的失败由 api-new-session 自己的日志与提示兜着。
    // 一次选卡只记一条：成功与失败二选一，不在同一趟里先记成功再记失败。
    try { log('warn', 'entry.pick', { from: from, card: card, ok: false, textLen: textLen }) } catch (eLog) {}
    return
  }
  try { log('info', 'entry.pick', { from: from, card: card, ok: true, textLen: textLen }) } catch (eLog) {}
}

function cardAccent(kind: any): string {
  try {
    const table = (typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT) ? CONTAINER_ACCENT : {}
    return String((kind === 'spec' ? table.spec : table.map) || '')
  } catch (e) { return '' }
}

/**
 * 入口浮层本体。两个宿主各挂一份（面板页签行、状态栏），但只有「当时打开它的那一处入口」
 * 会真的画出来：判断条件是 entryFrom 与宿主自报的 from 相同，所以同一个时刻最多只有一层浮层、
 * 一份键盘监听，按一次 Enter 也只会开一个会话。没打开时什么都不画；打开时用 portalTop
 * 挂到 body，面板再窄也不会被裁掉。
 */
export const EntryChooser = function (props: any) {
  const st = props && props.st
  const hostFrom = (props && props.from) ? String(props.from) : ''
  const open = !!(st && st.entryOpen && (!hostFrom || String(st.entryFrom) === hostFrom))
  // 键盘焦点落在第几张卡：↑↓ 换、Enter 选；鼠标悬停也同步它，鼠标和键盘看的是同一个「当前卡」。
  const [focusIdx, setFocusIdx] = React.useState(0)
  const rootRef = React.useRef(null)
  React.useEffect(function () {
    if (!open) return undefined
    const onDown = function (e: any) {
      const root = rootRef.current
      const target = e && e.target
      if (root && root.contains && root.contains(target)) return
      if (entryTriggerEl && entryTriggerEl.contains && entryTriggerEl.contains(target)) return
      entryChooserClose(st)
    }
    const onKey = function (e: any) {
      const key = e && e.key
      if (key === 'Escape') { e.preventDefault(); entryChooserClose(st); return }
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Tab') {
        e.preventDefault()
        setFocusIdx(function (i: any) { return (Number(i) + 1) % ENTRY_CARDS.length })
        return
      }
      if (key === 'Enter' || key === ' ') {
        e.preventDefault()
        const idx = Number(focusIdx) || 0
        pickEntry(st, ENTRY_CARDS[idx] || 'map')
      }
    }
    try { if (rootRef.current && rootRef.current.focus) rootRef.current.focus() } catch (eF) {}
    if (typeof document !== 'undefined' && document && document.addEventListener) {
      document.addEventListener('mousedown', onDown, true)
      document.addEventListener('keydown', onKey)
      return function () {
        document.removeEventListener('mousedown', onDown, true)
        document.removeEventListener('keydown', onKey)
      }
    }
    return undefined
  }, [open, focusIdx, st])
  if (!open) return null
  const pos = (st.entryPos && typeof st.entryPos === 'object') ? st.entryPos : { left: 8, top: 8 }
  // 排布方向与宽度是打开时量好的（状态栏横排、面板竖排）；万一拿到旧状态没带，退回面板那一套。
  const horizontal = !!pos.horizontal
  const width = Number(pos.width) || ENTRY_CHOOSER_WIDTH
  const boxStyle: any = {
    position: 'fixed',
    left: pos.left,
    width: width,
    boxSizing: 'border-box',
    padding: '12px',
    borderRadius: 10,
    background: 'var(--dsw-alias-bg-layer-2,#16181d)',
    border: '1px solid var(--dsw-alias-border-l2,#3a3f4a)',
    boxShadow: '0 16px 44px rgba(0,0,0,.6)',
    zIndex: ENTRY_CHOOSER_Z,
    outline: 'none',
  }
  if (pos.top != null) boxStyle.top = pos.top
  else boxStyle.bottom = pos.bottom
  const cardNodes: any[] = []
  for (let i = 0; i < ENTRY_CARDS.length; i += 1) {
    const kind = ENTRY_CARDS[i]
    const accent = cardAccent(kind)
    const focused = Number(focusIdx) === i
    cardNodes.push(h('div', {
      key: 'card-' + kind,
      role: 'button',
      tabIndex: -1,
      // 接线（#1335 界面反馈）：整张入口卡就是一颗按钮，按「整卡可点」接 row 形状；
      //   日志名用卡的种类拼出来（map / spec 两个固定枚举），不写卡上那段展示文字。
      // 这里不挂 dsws-hov，改挂专门的 .dsws-entrycard（2026-10-22 #1359）：这张卡自己按焦点画 2px outline，
      //   通用悬停环会再从卡框底下透出 1px 环，两条环叠在一起。卡自己的悬停提亮（下面的内联 filter）照旧；
      //   按下压暗改由样式侧一条只在入口卡上生效的规则负责——内联 filter 压得过通用按压规则，不单独写
      //   一条 !important 规则就看不见按下时的压暗（样式见 feedback-styles.ts）。
      className: 'dsws-entrycard',
      'data-press': 'row',
      'data-log': 'entry.card.' + kind,
      'aria-label': String(tr(kind === 'map' ? 'card.entry.explore.brow' : 'card.entry.impl.brow') || ''),
      onMouseEnter: function () { setFocusIdx(i) },
      onClick: function (e: any) { if (e && e.stopPropagation) e.stopPropagation(); pickEntry(st, kind) },
      style: {
        display: 'block',
        flex: 'none',
        borderRadius: 12,
        cursor: 'pointer',
        filter: focused ? 'brightness(1.14)' : 'none',
        transition: 'filter ' + MOTION.hoverFadeMs + 'ms',
        outline: focused ? '2px solid ' + accent : 'none',
        outlineOffset: 2,
      },
    }, buildEntryCard(kind)))
  }
  // 状态栏那一处横排（探索在左、实施在右），面板那一处竖排（探索在上、实施在下）；卡片间隙两种排布都是 9。
  const cards = h('div', {
    key: 'cards',
    style: { display: 'flex', flexDirection: horizontal ? 'row' : 'column', gap: ENTRY_CARD_GAP, marginTop: 9 },
  }, cardNodes)
  const children: any[] = [
    h('button', {
      key: 'close',
      className: 'dsws-btn ghost',
      // 接线（#1335 界面反馈）：叉号是纯图标按钮，只接按压形状（图标小，下沉一像素会看着歪）。
      'data-press': 'icon',
      'data-log': 'entry.close',
      'aria-label': String(tr('card.entry.close') || ''),
      onClick: function (e: any) { if (e && e.stopPropagation) e.stopPropagation(); entryChooserClose(st) },
      style: { position: 'absolute', right: 9, top: 8, fontSize: 14, lineHeight: 1, color: '#8b8b95', background: 'none', border: 'none', cursor: 'pointer', padding: 0 },
    }, '×'),
    h('div', { key: 'title', style: { margin: '0 0 3px', paddingRight: 20, fontSize: 12.5, fontWeight: 600, color: 'var(--dsw-alias-label-primary,#e6edf3)' } }, String(tr('card.entry.title') || '')),
  ]
  children.push(cards)
  return portalTop(h('div', {
    className: 'dsws-entrychooser',
    ref: rootRef,
    tabIndex: -1,
    role: 'dialog',
    'aria-label': String(tr('card.entry.title') || ''),
    onClick: function (e: any) { if (e && e.stopPropagation) e.stopPropagation() },
    style: boxStyle,
  }, children))
}
