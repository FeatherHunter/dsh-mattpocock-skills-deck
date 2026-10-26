/**
 * views/mapDetailV2/view/MapDetailV2Page.ts —— V2 地图详情页的组合根（页面容器）。
 *
 * 这一页做什么（维护者原话「把所有的卡片都放在页面内，被完成的聚集在下方」+ 七条答复）：
 *   顶栏（原样沿用老页那一行：返回列表 / 面包屑 / 身份三态 / 执行 / 新会话 / 复制 / 打开）
 *   → 地图档案（MAP 自身内容：标题、目的地、四枚计数、完成度、子票那句；点标题进 issue 详情页看全文）
 *   → 一条连续卡片流（在办 → 可接 → 被挡 → 已完成，结案的收在最后；维护者答 Q3a=B / Q3b）
 * 没有「层级」：老页按层分组、层与层之间画闸门，V2 不展示层级（层级仍由宿主算，只是不画）。
 *
 * 2026-10-23 维护者定：页内不再展示正文详情 / 已定决策 / 战雾 / 范围外，也不重复「地图 + 编号」那一行；
 * 想看这张图自己的完整信息，点标题进 issue 详情页（把 issue 详情页打磨好一处，地图跟着受益）。
 *
 * 它只做四件事，其余全在别处：
 *   1) 取数：调 wiring/useMapTicketsFeed（进页面就拉这张图的全部子票，含已关闭的）。老页的取数与
 *      「已关闭地图首屏没有子票」问题都收在那一个 hook 里；
 *   2) 算整页模型：mapDetailPageModelOf 一次算出档案 + 一条流（纯函数，不碰界面）；
 *   3) 造四个按钮的回调：wiring/pageActionHandlersOf（注入提示词 / 新会话 / 复制链接 / 打开）；
 *   4) 按模型渲染三块 + 图片放大浮层。
 *
 * 叶子约定（scripts/build.mts 的 LEAF_MODULES）：本文件会被拼进客户端闭包，运行时不能 import，
 * 需要的内核函数一律按名字 declare；import 只能是 type。这一页从 #1402 起是地图详情页的真实入口
 * （panel/Dock.ts 里列表页签的 active 分支），老页 MapDetail 的源码与门禁都留着，出问题可以一行切回。
 */
declare function idOf(...args: any[]): any
declare function effortOf(...args: any[]): any
declare function buildColorOf(...args: any[]): any
declare function rowActionKind(...args: any[]): any
declare function containerKindOf(...args: any[]): any
declare function containerStateOf(...args: any[]): any
declare function containerTriState(...args: any[]): any
// 两种容器的身份色中央色表（kernel/container-view.ts）。页面只借它给实施样张上色，见下面 colorOf。
declare const CONTAINER_ACCENT: any
declare function popNav(...args: any[]): any
declare function pushNav(...args: any[]): any
declare function MapDetailTop(props?: any): any
declare function mapDetailPageModelOf(...args: any[]): any
declare function useMapTicketsFeed(...args: any[]): any
declare function pageActionHandlersOf(...args: any[]): any
declare function MapProfileHeader(props?: any): any
declare function TicketCardFlow(props?: any): any
declare function mdImgOverlay(...args: any[]): any

/**
 * 面包屑与老页同口径（MapDetail.ts:306-315）：栈里有上一级就显示「上一级编号 / 当前地图编号」，
 * 栈深超过两级时更早的层折成「… / 」；只有一级（从列表进来）时显示「列表 / 当前地图编号」。
 * 为什么照抄：顶栏那一行维护者明确要求不变，面包屑的字属于那一行。
 */
function navCrumbOf(st: any, m: any): string {
  let arr: any[] | null = null
  try { arr = (st && Array.isArray(st.navStack)) ? st.navStack : null } catch (e) { arr = null }
  if (arr && arr.length >= 2) {
    const parent = arr[arr.length - 2]
    const head = arr.length > 2 ? '… / ' : ''
    return head + '#' + parent.n + ' / #' + m.number
  }
  return tr('panel.tabList') + ' / #' + m.number
}

/** 卡片 DOM id 的前缀：一张页面里可能同时有两张同编号的票（跨 effort 的脏数据），加地图前缀避开。
 *  只留字母数字下划线连字符，免得 id 里有选择器需要转义的字符。 */
function cardIdPrefixOf(mapId: any): string {
  return 'm2-' + String(mapId).replace(/[^A-Za-z0-9_-]+/g, '-')
}

/**
 * 页面容器。props 与老页同一个签名：{ st, g, drill }（Dock.ts:404 传的就是这三个）。
 * g 是列表页那套分组对象，g.m 才是这张地图/规格的行；drill 老页在生产里不传，这里也不使用。
 */
export function MapDetailV2Page(props: any): any {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const st = props && props.st
  const g = props && props.g
  const m = g && g.m

  // hooks 必须先于任何提前 return 调用（React 的规矩：同一次挂载里 hook 数量不能变）。
  // 这里先取数、再判这张图在不在；useMapTicketsFeed 自己会处理 m 为空的情况（effect 里直接 return），
  // 所以 m 从无到有时不会因为 hook 数量变化让整页崩掉。
  // 空 m 这个分支今天走不到：唯一挂载点只在 g.m 存在时才画这一页（panel/Dock.ts:117、:404），
  // 真走到时也只是一个空容器，返回列表仍由 DSH 的标签与侧栏兜底，不会把用户困在页里。
  const bucket = useMapTicketsFeed(st, m)
  if (!m) return h('div', { className: 'm2v2-page' })

  const mId = idOf(m)
  // 卡片认「颜色键 → 十六进制」这一张表：标签动作的色从仓库标签取（buildColorOf），
  // 实施动作没有对应的 GitHub 标签，色是实施地图的身份色（CONTAINER_ACCENT.spec）——
  // 卡片层不写第二份身份色，所以在这里补上这一项再交给卡片。
  const colorOf = Object.assign({}, buildColorOf(st), { implement: CONTAINER_ACCENT.spec })
  const cardIdPrefix = cardIdPrefixOf(mId)

  // 整页只算一次：档案 + 一条连续流 + 每张卡的 props。计算与画法分开，门禁可以直接对着它断言。
  const model = mapDetailPageModelOf({
    map: m,
    bucket: bucket,
    cardIdPrefix: cardIdPrefix,
    colorOf: colorOf,
    // 主按钮的动作由内核按原始行判定（九种动作名），卡片层再映射成九种样张（model/tickets/ticketCardFacts.ts）。
    actionOf: function (row: any) { return rowActionKind(row) },
    textOf: tr,
    // 四个按钮具体干什么要问宿主，交给 wiring；行由模型交回来，保证回调认的行就是画出来的那批行。
    handlers: function (rows: any[]) { return pageActionHandlersOf(st, rows) },
  })

  // 顶栏三态与老页同源（kernel/container-view.ts）：取数成功后用真实统计，取不到时退回快照里的 stats。
  // 注意档案区的四枚计数按「画出来的行」数（mapDetailPageModel.ts:13-15 写明是有意），取数被 1000 张
  // 上限截断时两处分母可能不同；档案里的「子票那句」会把截断与差额补出来，不让数字悄悄对不上。
  // 取数中给档案区一个稳定的占位（维护者 2026-10-23：进入页时「正在取子票」独占一行又消失，高度抖一下）。
  // bucket 还没有（第一帧、effect 刚要发请求）或正在取，都算 busy；档案区据此显示占位而不增删行。
  const busy = !bucket || String(bucket.mode || '') === 'loading'
  const effStats = (bucket && bucket.mode === 'real' && bucket.stats) ? bucket.stats : (m.stats || null)
  const cKind = containerKindOf(m) || 'map'
  const cState = containerStateOf({ stats: effStats })
  const tri = containerTriState(cKind, cState)

  // 点标题看地图自己的档案：压入这张地图的 issue 详情页（地图在 GitHub 上就是一条 issue，
  // 全文、已定决策、评论都在那一页）。与子票卡的 enterSubDetail 走同一个导航栈，返回逐级弹回。
  // 编号取不到时不动作：宁可不跳，也不要压一个打不开的页面。
  // 本地容器的编号是 0（key 00），是合法坐标：只拦缺席、空串、非数字与负数，不拦 0。
  const openArchive = function () {
    const raw = m && (m.number !== undefined && m.number !== null ? m.number : m.key)
    if (raw === undefined || raw === null || String(raw).trim() === '') return
    const n = Number(raw)
    if (!isFinite(n) || n < 0) return
    if (typeof pushNav === 'function') pushNav(st, 'issue', n, effortOf(m))
  }

  return h('div', { className: 'm2v2-page' }, [
    // 顶栏：维护者要求这一行不变，所以原样复用老页的 MapDetailTop（内含逐字折叠机与 data-detail-* 标记）。
    h(MapDetailTop, {
      key: 'top', st: st, m: m, navCrumb: navCrumbOf(st, m), effStats: effStats,
      goBack: function () { popNav(st) }, kind: cKind, tri: tri,
    }),
    // 地图档案：MAP 自己的内容（替代老页的 MapDetailHead + Destination + Notes + 三段折叠）。
    // 长正文不在这里画，点标题进这张地图的 issue 详情页看（openArchive）。
    h(MapProfileHeader, {
      key: 'profile', st: st, profile: model.profile, feed: model.feed, busy: busy,
      onOpenArchive: openArchive,
    }),
    // 卡片流：一条连续的流，顺序由模型排好（在办 → 可接 → 被挡 → 已完成）。
    h(TicketCardFlow, { key: 'flow', cards: model.cards.sequence, empty: model.feed.empty }),
    // 图片放大浮层：与议题详情共用同一渲染函数与同一共享状态（markdown 里的图能点开）。
    // 外面套一个 display:contents 的容器只是为了给数组子元素一个 key（浮层没打开时返回 null）。
    h('div', { key: 'overlay', style: { display: 'contents' } },
      (typeof mdImgOverlay === 'function' ? mdImgOverlay(st) : null)),
  ])
}
