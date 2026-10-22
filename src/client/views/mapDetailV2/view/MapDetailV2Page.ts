/**
 * views/mapDetailV2/view/MapDetailV2Page.ts —— V2 地图详情页的组合根（页面容器）。
 *
 * 这一页做什么（维护者原话「把所有的卡片都放在页面内，被完成的聚集在下方」+ 七条答复）：
 *   顶栏（原样沿用老页那一行：返回列表 / 面包屑 / 身份三态 / 执行 / 新会话 / 复制 / 打开）
 *   → 地图档案（MAP 自身内容：标题、目的地、四枚计数、完成度、子票那句、四或七个抽屉）
 *   → 一条连续卡片流（在办 → 可接 → 被挡 → 已完成，结案的收在最后；维护者答 Q3a=B / Q3b）
 * 没有「层级」：老页按层分组、层与层之间画闸门，V2 不展示层级（层级仍由宿主算，只是不画）。
 *
 * 它只做四件事，其余全在别处：
 *   1) 取数：调 wiring/useMapTicketsFeed（进页面就拉这张图的全部子票，含已关闭的）。老页的取数与
 *      「已关闭地图首屏没有子票」问题都收在那一个 hook 里；
 *   2) 算整页模型：mapDetailPageModelOf 一次算出档案 + 一条流（纯函数，不碰界面）；
 *   3) 造四个按钮的回调：wiring/pageActionHandlersOf（注入提示词 / 新会话 / 复制链接 / 打开）；
 *   4) 按模型渲染三块 + 图片放大浮层。
 *
 * 叶子约定（scripts/build.mts 的 LEAF_MODULES）：本文件会被拼进客户端闭包，运行时不能 import，
 * 需要的内核函数一律按名字 declare；import 只能是 type。这一页今天「已入库、未接入」：
 * 页面入口仍是 Dock 里的老 MapDetail，切换入口另开票（#1402），等维护者认可 V2 观感再做。
 */
declare function idOf(...args: any[]): any
declare function effortOf(...args: any[]): any
declare function buildColorOf(...args: any[]): any
declare function rowActionKind(...args: any[]): any
declare function containerKindOf(...args: any[]): any
declare function containerStateOf(...args: any[]): any
declare function containerTriState(...args: any[]): any
declare function popNav(...args: any[]): any
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
  if (!m) return h('div', { className: 'm2v2-page' })

  const mId = idOf(m)
  // 一进页面就拉全部子票（含已关闭）：V2 要把已完成的票也画出来，不能只靠快照里那点数据。
  const bucket = useMapTicketsFeed(st, m)
  const colorOf = buildColorOf(st)
  const cardIdPrefix = cardIdPrefixOf(mId)

  // 整页只算一次：档案 + 一条连续流 + 每张卡的 props。计算与画法分开，门禁可以直接对着它断言。
  const model = mapDetailPageModelOf({
    map: m,
    bucket: bucket,
    cardIdPrefix: cardIdPrefix,
    colorOf: colorOf,
    // 主按钮的动作由内核按原始行判定（九种动作名），卡片层再映射成八种样张（model/tickets/ticketCardFacts.ts）。
    actionOf: function (row: any) { return rowActionKind(row) },
    textOf: tr,
    // 四个按钮具体干什么要问宿主，交给 wiring；行由模型交回来，保证回调认的行就是画出来的那批行。
    handlers: function (rows: any[]) { return pageActionHandlersOf(st, rows) },
  })

  // 顶栏三态与老页同源（kernel/container-view.ts）：取数成功后用真实统计，取不到时退回快照里的 stats。
  const effStats = (bucket && bucket.mode === 'real' && bucket.stats) ? bucket.stats : (m.stats || null)
  const cKind = containerKindOf(m) || 'map'
  const cState = containerStateOf({ stats: effStats })
  const tri = containerTriState(cKind, cState)

  return h('div', { className: 'm2v2-page' }, [
    // 顶栏：维护者要求这一行不变，所以原样复用老页的 MapDetailTop（内含逐字折叠机与 data-detail-* 标记）。
    h(MapDetailTop, {
      key: 'top', st: st, m: m, navCrumb: navCrumbOf(st, m), effStats: effStats,
      goBack: function () { popNav(st) }, kind: cKind, tri: tri,
    }),
    // 地图档案：MAP 自己的内容（替代老页的 MapDetailHead + Destination + Notes + 三段折叠）。
    h(MapProfileHeader, { key: 'profile', st: st, profile: model.profile, feed: model.feed }),
    // 卡片流：一条连续的流，顺序由模型排好（在办 → 可接 → 被挡 → 已完成）。
    h(TicketCardFlow, { key: 'flow', cards: model.cards.sequence, empty: model.feed.empty }),
    // 图片放大浮层：与议题详情共用同一渲染函数与同一共享状态（markdown 里的图能点开）。
    (typeof mdImgOverlay === 'function' ? mdImgOverlay(st) : null),
  ])
}
