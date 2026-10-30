// tests/verify-1302-panel-list-skeleton.ts —— #1302 门禁：列表加载时的骨架要照真实行的形状画
// https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1302
// 门禁归属: src/client/views/ListTabRow.ts, src/client/views/ListTab.ts
// 判据（用户在加载态一眼能看出来的事）：
// 1. 首开无数据时，遮罩里画的是一行一行的票样：左边编号列、中间标题条、右边圆环位；第二行标签块 + 行尾按钮块。
//    不再是「五根写死宽度的灰条」。
// 2. 占位从列表区顶部往下排（不居中堆在中间），一次画 8 行；列表排序把容器（探索地图、规格）排在普通票前面，
//    所以前两行编号列多一枚角标块，其余行只有编号块。
// 3. 遮罩里除了占位块只剩「加载中…」那句字；骨架本身一个字都不写。
// 4. 占位与真实行共用同一份行形状来源 LIST_ROW_SHAPE：行1 间距、行2 上边距与间距、圆环大小都从它取；
//    外层框、编号列、标签行、圆环组复用真实行的 CSS 类名。以后改真实行，骨架跟着变；对不上就红。
// 5. 已有快照或缓存时仍然不出现遮罩（#58 缓存优先不回归）；微光时长仍是 1.1 秒（#953 定下的节奏，不顺手改）。
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1302-panel-list-skeleton.ts
// 做法：真组件静态渲染（react-dom/server），只把渲染之外的外部依赖换成假实现；行形状常量从真源码取，
//   门禁不另抄一份数字（另抄一份就等于允许两边各说各话，那正是这张票要消灭的问题）。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { sourceText } from './lib/source-text.ts'
import { MOTION } from '../src/client/kernel/motion.ts' // #1236：骨架微光的时长取动效令牌

let failures = 0
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

// ---- 词表：只把断言要看的几个键译成中文，其余键原样返回 ----
const trDict: Record<string, string> = {
  'list.loading': '加载中…',
  'list.none': '暂无',
  'list.state.open': '未关闭',
  'list.state.all': '全部',
  'list.kpi.takeable': '可接',
  'list.kpi.occupied': '占用',
  'list.kpi.closed': '已关闭',
  'list.specChip': '规格',
  'list.mapChip': '地图',
}
const trFn = (key: any, params?: any): string => {
  let s = trDict[String(key)] !== undefined ? trDict[String(key)] : String(key)
  if (params) s = s.replace(/\{(\w+)\}/g, (m: string, name: string) => (name in params ? String(params[name]) : m))
  return s
}

const G: any = globalThis
G.React = React
G.tr = trFn
G.emit = () => {}
G.Ic = (props: any) => '[icon:' + ((props && props.n) || '?') + ']'
G.Tip = (props: any) => React.createElement('span', { 'data-tip': String(props.content) }, props.children)
G.chipProps = (props: any) => props
G.COPY_FLASH_MS = 1300

// ---- 身份与链接：走真实现（手写的假实现一旦与真实现不一致，门禁就测了个假环境）----
const identityMod = await import('../src/tracker/kernel/identity-keys.js')
const linkMod = await import('../src/client/kernel/link.js')
const { DswsCtx } = await import('../src/client/kernel/ctx.js')
G.DswsCtx = DswsCtx
G.idOf = identityMod.idOf
G.effortOf = identityMod.effortOf
G.issueUrlFor = linkMod.issueUrlFor
G.openModeFor = linkMod.openModeFor
G.openTrackerTarget = linkMod.openTrackerTarget

// ---- 容器口径：走真实现（唯一真源），行渲染与列表页都从它拿种类、颜色与三态 ----
const cv: any = await import('../src/client/kernel/container-view.js')
G.containerKindOf = cv.containerKindOf
G.containerStateOf = cv.containerStateOf
G.containerTriState = cv.containerTriState
G.containerNumberColor = cv.containerNumberColor
G.containerTitleKey = cv.containerTitleKey
G.containerPromptText = cv.containerPromptText
G.CONTAINER_ACCENT = cv.CONTAINER_ACCENT
G.CONTAINER_TINT = cv.CONTAINER_TINT
// #1343：容器三态的两枚固定色也从中央色表取；视图单独求值时这两个全局量缺不得。
G.CONTAINER_EMPTY_COLOR = cv.CONTAINER_EMPTY_COLOR
G.CONTAINER_DONE_COLOR = cv.CONTAINER_DONE_COLOR
G.CONTAINER_CHIP_CLASS = cv.CONTAINER_CHIP_CLASS
G.CONTAINER_CHIP_LABEL_KEY = cv.CONTAINER_CHIP_LABEL_KEY
G.CONTAINER_CHIP_MARKER_CLASS = cv.CONTAINER_CHIP_MARKER_CLASS
// 容器真源要用到这几个宿主侧自由量：给最小可用的假实现（提示词内容不在本门禁的判据里）
G.findMapByIdentity = (maps: any, num: any, effortId: any) => {
  const arr = Array.isArray(maps) ? maps : []
  for (const m of arr) if (m && String(m.number) === String(num)) return m
  return null
}
G.inspectPrompt = () => '/wayfinder inspect'
G.completePrompt = () => '/wayfinder done'
G.startText = () => '/wayfinder start'
G.renderTemplate = (name: string, vars: any) => '/' + name + ' ' + (vars && vars.url ? vars.url : '')

// ---- 行渲染与列表页需要的其余自由量 ----
G.actionColorOf = () => '#c084fc'
G.isLightHex = () => true
G.mkRowAction = () => React.createElement('button', { className: 'dsws-btn primary' }, '行动作')
G.authorColor = () => '#7aa2f7'
G.darken = () => 'rgba(188,140,255,.6)'
G.hexA = () => 'rgba(188,140,255,.16)'
G.effortNamesOf = () => ['default']
// #1664：第一排 md目录签的选项另算（只留还有打开的票的工作单元），ListTab 里单独调它。
G.effortOptionNamesOf = () => ['default']
G.ticketRowsOf = (arr: any) => arr
G.issuePageRowsOf = () => []
G.chipKeyDown = () => {}
G.copyText = async () => true
G.inject = () => {}
G.openInNewSession = () => {}
G.openHealthCheck = () => {}
G.promptTextFor = () => '/wayfinder'
G.setActiveIssue = () => {}
G.setActiveMap = () => {}
G.showPop = () => {}
G.truthWriteWindowOpen = () => false
G.fitAllTags = () => {}
G._tagsFpOf = new Map()
G.isEnabled = () => false
G.panelNow = () => 0
G.panelClock = {}
G.chainSteps = () => []
G.compute = () => ([{ blocked: [], claimed: [] }])
G.deckCountsOf = () => null
G.openIssuesOf = (st: any) => ((st && st.snapshot && st.snapshot.issues) || [])
G.isOccupied = () => false
G.mapBlockOf = () => ({})
G.applyStandaloneBlocks = () => {}
G.healthCheckVisible = () => false
G.healthCheckCountOf = () => 0
G.closedPagesNode = () => null
G.truthNoticeLines = () => []
// 缓存优先的判据：默认没有缓存快照；C 组会临时塞一份进来验证「有缓存就不出遮罩」。
let cachedSnapshot: any = null
G.getCachedSnapshot = () => cachedSnapshot
G.loadIssuePage = () => {}
G.RestFallbackBanner = () => null
G.useClosedPageScroll = () => {}
G.labelClicks = {}
G.listPrefs = {}
G.saveLabelClicks = () => {}
G.saveListPrefs = () => {}

const rowMod: any = await import('../src/client/views/ListTabRow.js')
// #1511：编号写成「#目录/编号」的规则住在 kernel/ticket-label.ts；叶子单独加载时闭包里没有这个名字，
// 这里接真实现（同构接线，不抄一份假规则，否则门禁会跟着实现一起漂）。
const { ticketLabelOf, ticketLabelNodesOf, TICKET_LABEL_MAX_WIDTH } = await import('../src/client/kernel/ticket-label.js')
G.ticketLabelOf = ticketLabelOf
G.ticketLabelNodesOf = ticketLabelNodesOf
G.TICKET_LABEL_MAX_WIDTH = TICKET_LABEL_MAX_WIDTH
G.ticketBadgeOf = (await import('../src/client/views/shared/ticketBadge.js')).ticketBadgeOf
const listMod: any = await import('../src/client/views/ListTab.js')
// 本次界面反馈需求：筛选药丸那一行搬成了独立叶子（要接三块液态墨块，ListTab 放不下）。
// 这里直接加载真叶子；墨块钩子用空实现——这几道门禁只看行与按钮的形状，不测墨块对位。
const filterRowMod: any = await import('../src/client/views/listFilterRow.js')
G.listFilterRowNode = filterRowMod.listFilterRowNode
G.useLiquidInk = () => null
G.liquidInkRemember = () => {}
G.listIssueRow = rowMod.listIssueRow
G.listSkeletonNode = rowMod.listSkeletonNode

// ---- 造数据 ----
function issueOf(o: any) {
  return Object.assign({ number: 1, key: '1', effortId: 'default', title: '票', state: 'OPEN', labels: [], type: 'task', updatedAt: '2026-10-01T00:00:00Z' }, o)
}
function containerOf(o: any) {
  return Object.assign({ number: 1, key: '1', effortId: 'default', title: '容器', state: 'OPEN', labels: [], type: 'map', stats: { total: 2, closed: 0 } }, o)
}
function makeSt(issues: any[], maps: any[]) {
  return {
    snapshot: { issues: issues, maps: maps, generatedMs: '2026-10-20T00:00:00Z' },
    tab: 'list', stateFilter: 'open', lblFilters: [], effFilters: [],
    sortKey: 'updatedAt', sortDir: 'desc', rowFlash: {}, writeAt: {}, cwd: 'D:\\ws',
  } as any
}
// 加载态：首开、没有快照（真机这时遮罩才出现，判据同 ListTab.ts 里那行条件）
function makeLoadingSt() {
  const st = makeSt([], [])
  st.snapshot = null
  st.snapMode = 'loading'
  st.cwd = 'D:\\ws'
  return st
}

// React 静态渲染时会为「子元素数组缺 key」与「服务端跑 useLayoutEffect」打警告。
// 这两类是现有行标记的既有噪音（真机浏览器里也一样），不是本门禁的判据；这里只静音这两类，其余警告照常打印。
const realConsoleError = console.error
function withQuietReact<T>(fn: () => T): T {
  console.error = (...args: any[]) => {
    const msg = String((args && args[0]) || '')
    if (msg.indexOf('unique "key" prop') >= 0) return
    if (msg.indexOf('useLayoutEffect does nothing on the server') >= 0) return
    realConsoleError.apply(console, args)
  }
  try { return fn() } finally { console.error = realConsoleError }
}
function renderList(st: any) {
  return withQuietReact(() => renderToStaticMarkup(React.createElement(listMod.ListTab, { st: st, narrow: false })))
}
function renderRow(st: any, x: any) {
  return withQuietReact(() => renderToStaticMarkup(rowMod.listIssueRow(React.createElement, st, x, true, false, {}, {}, false)))
}

// ---- 看 HTML 的小工具 ----
function stripTags(html: string): string { return html.replace(/<[^>]*>/g, '').trim() }
// 从 marker（含）往前找到它所在的那个 div 开头，再按 div 配对切出整棵子树（不依赖 jsdom）。
function divSubtreeAt(html: string, at: number): string {
  const start = html.lastIndexOf('<div', at)
  if (start < 0) return ''
  const re = /<\/?div\b[^>]*>/g
  re.lastIndex = start
  let depth = 0
  let m: any
  while ((m = re.exec(html))) {
    if (m[0].charAt(1) === '/') { depth -= 1; if (depth === 0) return html.slice(start, re.lastIndex) }
    else depth += 1
  }
  return ''
}
function shadeOf(html: string): string {
  const i = html.indexOf('class="dsws-loading-shade"')
  if (i < 0) return ''
  return divSubtreeAt(html, i)
}
function skeletonRows(shade: string): string[] {
  const out: string[] = []
  const re = /data-dsws-row-skeleton="1"/g
  let m: any
  while ((m = re.exec(shade))) out.push(divSubtreeAt(shade, m.index))
  return out
}
function partsOf(html: string): string[] {
  const out: string[] = []
  const re = /data-dsws-row-part="([a-z0-9-]+)"/g
  let m: any
  while ((m = re.exec(html))) out.push(m[1])
  return out
}
function blocksOf(html: string): string[] {
  const out: string[] = []
  const re = /data-dsws-skel-block="([a-z0-9-]+)"/g
  let m: any
  while ((m = re.exec(html))) out.push(m[1])
  return out
}

const SHAPE: any = rowMod.LIST_ROW_SHAPE
check(!!SHAPE && !!SHAPE.line1 && !!SHAPE.line2 && !!SHAPE.ring && !!SHAPE.list, 'SHAPE 行形状常量从 ListTabRow.ts 导出（门禁按它核对，不另抄数字）')

// ============ A 组：加载态的占位长什么样 ============
{
  const html = renderList(makeLoadingSt())
  const shade = shadeOf(html)
  check(shade !== '', 'A1 首开无快照时画出了加载遮罩')
  check(shade.indexOf('data-dsws-list-skeleton="1"') >= 0, 'A2 遮罩里有「列表骨架」这一层（data-dsws-list-skeleton）')
  check(shade.indexOf('aria-hidden="true"') >= 0, 'A3 骨架对读屏器隐藏（aria-hidden）')

  const rows = skeletonRows(shade)
  check(rows.length === SHAPE.list.count, 'A4 一次画 ' + SHAPE.list.count + ' 行占位（实际 ' + rows.length + ' 行）')
  check(rows.length > 0 && rows.every((r) => partsOf(r).join(',') === 'idcol,title,ring,tags,buttons'), 'A5 每一行都是真实行的五个部件：编号列、标题、圆环、标签行、按钮组（次序一致）')

  // 前两行按容器行画（列表排序把探索地图、规格排在普通票前面），所以编号列多一枚角标块。
  const expectContainerBlocks = ['badge', 'idnum', 'title', 'ring', 'ring-text', 'tag', 'tag', 'tag', 'button', 'button']
  const expectPlainBlocks = ['idnum', 'title', 'ring', 'ring-text', 'tag', 'tag', 'tag', 'button', 'button']
  check(rows.length > SHAPE.list.containerRows && blocksOf(rows[0]).join(',') === expectContainerBlocks.join(','), 'A6 第一行是容器行：角标块 + 编号块 + 标题 + 圆环 + 标签块 + 按钮块')
  check(rows.length > SHAPE.list.containerRows && blocksOf(rows[SHAPE.list.containerRows]).join(',') === expectPlainBlocks.join(','), 'A7 容器行之后是普通票行：没有角标块，其余部件一致')
  check(rows.filter((r) => blocksOf(r).indexOf('badge') >= 0).length === SHAPE.list.containerRows, 'A8 只有前 ' + SHAPE.list.containerRows + ' 行多角标块')

  // 占位块的数量与形状也按同一份常量核对，改常量时这里自动跟着变
  const blocksPerContainer = 1 + 1 + 1 + 2 + SHAPE.tag.count + SHAPE.button.count
  const blocksPerPlain = 1 + 1 + 2 + SHAPE.tag.count + SHAPE.button.count
  const expectBlocks = SHAPE.list.containerRows * blocksPerContainer + (SHAPE.list.count - SHAPE.list.containerRows) * blocksPerPlain
  const allBlocks = blocksOf(shade)
  check(allBlocks.length === expectBlocks, 'A9 占位块总数 ' + expectBlocks + ' 与常量推出的数目一致（实际 ' + allBlocks.length + '）')
  check((shade.match(/dsws-fb-skel/g) || []).length === expectBlocks, 'A10 每个占位块都是微光条（dsws-fb-skel）')
  check(shade.indexOf('width:' + SHAPE.idcol.idnum.width + 'px;height:' + SHAPE.idcol.idnum.height + 'px') >= 0, 'A11 编号块尺寸取自常量（' + SHAPE.idcol.idnum.width + '×' + SHAPE.idcol.idnum.height + '）')
  check(shade.indexOf('height:' + SHAPE.title.height + 'px') >= 0, 'A12 标题条高度取自常量（' + SHAPE.title.height + '）')

  // 位置：从列表区顶部往下排，不居中堆叠；多出来的行被遮罩裁掉
  check(shade.indexOf('justify-content:flex-start') >= 0, 'A13 占位从列表区顶部往下排（justify-content:flex-start）')
  check(shade.indexOf('justify-content:center') < 0, 'A14 不再居中堆在遮罩中间（没有 justify-content:center）')
  check(shade.indexOf('overflow:hidden') >= 0, 'A15 超出一屏的占位行被裁掉（overflow:hidden）')
  check(shade.indexOf('pointer-events:none') >= 0, 'A16 占位行不接鼠标（pointer-events:none），点击落到遮罩上')
  check(shade.indexOf('role="button"') < 0, 'A17 占位行不是可点控件')

  // 文字：只剩「加载中…」，骨架里一个字都不写
  check(stripTags(shade) === trDict['list.loading'], 'A18 遮罩里除了「' + trDict['list.loading'] + '」没有别的字（实际：「' + stripTags(shade) + '」）')
  check(rows.every((r) => stripTags(r) === ''), 'A19 每条占位行里一个字都没有')

  // 旧写法（五根写死宽度的灰条）已经不在渲染结果与源码里
  check(shade.indexOf('width:96%') < 0 && shade.indexOf('width:80%') < 0, 'A20 旧的大宽度灰条不再出现')
  const listSrc = sourceText('src/client/views/ListTab.ts')
  check(listSrc.indexOf("'96%'") < 0 && listSrc.indexOf("'82%'") < 0, 'A21 源码里那组写死宽度（96%、82%…）已经删掉')
  check(listSrc.indexOf('listSkeletonNode') >= 0, 'A22 遮罩里的占位改由 listSkeletonNode 画')
}

// ============ B 组：占位与真实行共用同一份形状 ============
{
  const containerIssue = issueOf({ number: 1302, key: '1302', title: '一张规格票', type: 'spec' })
  const container = containerOf({ number: 1302, key: '1302', title: '一张规格票', type: 'spec', stats: { total: 1, closed: 0 } })
  const rowHtml = renderRow(makeSt([containerIssue], [container]), containerIssue)
  const shade = shadeOf(renderList(makeLoadingSt()))

  check(partsOf(rowHtml).join(',') === 'idcol,title,ring,tags,buttons', 'B1 真实行也是同样五个部件、同样次序（骨架结构就是照它画的）')
  check(rowHtml.indexOf('gap:' + SHAPE.line1.gap + 'px;width:100%') >= 0, 'B2 真实行行1 的横排间距等于常量 line1.gap = ' + SHAPE.line1.gap)
  check(rowHtml.indexOf('margin-top:' + SHAPE.line2.marginTop + 'px;display:flex;align-items:center;gap:' + SHAPE.line2.gap + 'px') >= 0, 'B3 真实行行2 的上边距与间距等于常量 line2（' + SHAPE.line2.marginTop + ' / ' + SHAPE.line2.gap + '）')
  check(rowHtml.indexOf('<svg width="' + SHAPE.ring.size + '" height="' + SHAPE.ring.size + '"') >= 0, 'B4 真实行圆环大小等于常量 ring.size = ' + SHAPE.ring.size)
  check(shade.indexOf('gap:' + SHAPE.line1.gap + 'px;width:100%') >= 0, 'B5 骨架行行1 的间距与真实行取同一个值')
  check(shade.indexOf('margin-top:' + SHAPE.line2.marginTop + 'px;display:flex;align-items:center;gap:' + SHAPE.line2.gap + 'px') >= 0, 'B6 骨架行行2 的上边距与间距与真实行取同一个值')
  check(shade.indexOf('width:' + SHAPE.ring.size + 'px;height:' + SHAPE.ring.size + 'px;border-radius:50%') >= 0, 'B7 骨架的圆环位大小与真实行圆环一致')

  // 同一套 CSS 类名：内边距、行距、圆角、悬停底色由样式表统一给，不在占位里另写一份
  const shared = ['dsws-aggrow', 'dsws-idcol', 'dsws-tags', 'dsws-ring']
  check(shared.every((c) => rowHtml.indexOf('class="' + c) >= 0 || rowHtml.indexOf(c) >= 0), 'B8 真实行带 ' + shared.join(' / '))
  check(shared.every((c) => shade.indexOf(c) >= 0), 'B9 骨架行复用真实行同一套 CSS 类名，不另写一套样式')
  const skelRows = skeletonRows(shade)
  check(skelRows.length > 0 && skelRows[0].indexOf('class="dsws-aggrow dsws-row-skel"') >= 0, 'B10 骨架行就是 .dsws-aggrow 那条行框（只多一个 dsws-row-skel 标记类）')

  // 源码层面：真实行从常量取值、遮罩调同一个函数画骨架
  const rowSrc = sourceText('src/client/views/ListTabRow.ts')
  check(rowSrc.indexOf('LIST_ROW_SHAPE.line1.gap') >= 0 && rowSrc.indexOf('LIST_ROW_SHAPE.line2.marginTop') >= 0, 'B11 真实行的行1/行2 间距来自 LIST_ROW_SHAPE，不是另写的数字')
  check(rowSrc.indexOf('LIST_ROW_SHAPE.ring.size') >= 0, 'B12 真实行圆环大小来自 LIST_ROW_SHAPE')
  check(rowSrc.indexOf('data-dsws-row-part') >= 0 && rowSrc.indexOf('data-dsws-row-skeleton') >= 0, 'B13 部件标记写在真实行与骨架共用的地方（门禁据此比对结构）')
}

// ============ C 组：缓存优先不回归（#58）============
{
  // 有快照（后台静默刷新）时不出遮罩
  const stWithSnap = makeSt([issueOf({ number: 7, key: '7' })], [])
  stWithSnap.snapMode = 'loading'
  const htmlWithSnap = renderList(stWithSnap)
  check(shadeOf(htmlWithSnap) === '', 'C1 已有快照时不画遮罩（缓存优先：秒开旧列表 + 后台静默刷新）')

  // 没有本 store 快照、但 per-cwd 缓存有旧列表时也不出遮罩
  cachedSnapshot = { issues: [], maps: [], generatedMs: '2026-10-19T00:00:00Z' }
  const htmlCached = renderList(makeLoadingSt())
  cachedSnapshot = null
  check(shadeOf(htmlCached) === '', 'C2 有 per-cwd 缓存快照时也不画遮罩')
}

// ============ D 组：微光节奏与既有口径不动 ============
{
  const feedSrc = sourceText('src/client/views/feedback/feedback-styles.ts')
  // #1236：字面时长搬进了动效令牌，这里改为核对「取的是骨架微光令牌」。
  check(feedSrc.indexOf('animation:dsws-fb-skel \' + MOTION.skeletonShimmerMs + \'ms linear infinite') >= 0 &&
    MOTION.skeletonShimmerMs === 1100, 'D1 骨架微光仍是 1.1 秒循环（#953 定下的节奏；#1236 起时长取动效令牌）')
  check(feedSrc.indexOf('prefers-reduced-motion') >= 0 || feedSrc.indexOf('animation:none') >= 0, 'D2 减少动态时降级为静态底色的既有做法还在')
}

console.log('')
console.log(failures === 0 ? ('全部通过：' + total + ' 条断言') : ('失败 ' + failures + ' / 共 ' + total + ' 条断言'))
if (failures > 0) process.exit(1)
