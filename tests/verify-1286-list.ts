// tests/verify-1286-list.ts —— #1286 门禁：列表页第二种容器「规格（实施地图）」
// https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1286
// 门禁归属: src/client/views/ListTabRow.ts, src/client/views/ListTab.ts
// 判据（五条，都是用户在列表页一眼能看出来的差别）：
// 1. 列表顺序是三段：探索地图 → 规格 → 普通票。容器是正在推进的东西，排在前面；
//    探索地图与规格各成一组，不混在一起。
// 2. 容器组内跟随面板排序档（与普通票同一套比较：同样四个排序键 更新时间、创建时间、编号、标题；同方向；#1356 起改，
//    旧口径「按最近更新降序」作废，旧行为只在 1286 设计文档里留档）。
// 3. 规格行的身份：角标写「规格」、左侧色条是贵族蓝 #1D4ED8、编号徽章在「有未关」态是蓝。
// 4. 规格三态按钮：0 张实施票=拆票（橙 #f59e0b）、有未关=执行（蓝 #1D4ED8）、全关=完成（绿 #3fb950）。
// 5. 新会话按钮与主按钮永远同色实心（两枚按钮不是两个颜色）。
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1286-list.ts
// 做法：真组件静态渲染（react-dom/server），只把渲染之外的外部依赖换成假实现；
//   容器的判定与取色走真实现 src/client/kernel/container-view.ts（唯一真源），不另造一份——
//   门禁自己另写一份判定，就等于允许两边各判各的，那正是这张票要消灭的问题。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { sourceText } from './lib/source-text.ts'

let failures = 0
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

// ---- 词表：只把断言要看的几个键译成中文，其余键原样返回 ----
//   这样「拆票/执行/完成」这三个词只可能出现在按钮标签上，不会被提示文案里的话带偏。
const trDict: Record<string, string> = {
  'list.specChip': '规格',
  'list.mapChip': '地图',
  'act.split': '拆票',
  'act.execute': '执行',
  'act.done': '完成',
  'act.inspect': '检查',
  'list.newSessionLabel': '新会话',
  'list.mapTitle': '查看地图详情',
  'list.specTitle': '查看规格详情',
  'list.issueDetailTitle': '查看票详情',
  'spec.splitTitle': '把规格拆成实施票',
  'spec.executeTitle': '把规格推进到下一步',
  'spec.doneTitle': '这张规格已收尾',
  'map.inspectTitle': '看看这张地图还缺什么',
  'map.executeTitle': '推进这张地图',
  'map.doneTitle': '这张地图已收尾',
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

// ---- 行渲染需要的其余自由量 ----
G.actionColorOf = () => '#c084fc'
G.isLightHex = (c: any) => ['#3fb950', '#f59e0b'].indexOf(String(c)) >= 0
G.mkRowAction = () => React.createElement('button', { className: 'dsws-btn primary', style: { background: '#c084fc', borderColor: 'transparent', color: '#ffffff' } }, '行动作')
G.authorColor = () => '#7aa2f7'
G.darken = () => 'rgba(188,140,255,.6)'
G.hexA = () => 'rgba(188,140,255,.16)'
G.effortNamesOf = () => ['default']
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
G.getCachedSnapshot = () => null
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
const listMod: any = await import('../src/client/views/ListTab.js')
// 本次界面反馈需求：筛选药丸那一行搬成了独立叶子（要接三块液态墨块，ListTab 放不下）。
// 这里直接加载真叶子；墨块钩子用空实现——这几道门禁只看行与按钮的形状，不测墨块对位。
const filterRowMod: any = await import('../src/client/views/listFilterRow.js')
G.listFilterRowNode = filterRowMod.listFilterRowNode
G.useLiquidInk = () => null
G.liquidInkRemember = () => {}
G.listIssueRow = rowMod.listIssueRow

// ---- 造数据 ----
function issueOf(o: any) {
  return Object.assign({ number: 1, key: '1', effortId: 'default', title: '票', state: 'OPEN', labels: [], type: 'task', updatedAt: '2026-10-01T00:00:00Z' }, o)
}
function containerOf(o: any) {
  return Object.assign({ number: 1, key: '1', effortId: 'default', title: '容器', state: 'OPEN', labels: [], type: 'map', stats: { total: 2, closed: 0 } }, o)
}
function makeSt(issues: any[], maps: any[], overrides?: { sortKey?: 'updatedAt' | 'createdAt' | 'number' | 'title', sortDir?: 'asc' | 'desc' }) {
  return Object.assign({
    snapshot: { issues: issues, maps: maps, generatedMs: '2026-10-20T00:00:00Z' },
    tab: 'list', stateFilter: 'open', lblFilters: [], effFilters: [],
    sortKey: 'updatedAt', sortDir: 'desc', rowFlash: {}, writeAt: {}, cwd: 'D:\\ws',
  }, overrides || {}) as any
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

function renderRow(st: any, x: any) {
  return withQuietReact(() => renderToStaticMarkup(rowMod.listIssueRow(React.createElement, st, x, true, false, {}, {}, false)))
}
function primaryButtons(html: string) {
  const out: Array<{ style: string, text: string }> = []
  // 本次界面反馈需求给按钮加了 data-press / data-log 两个属性，属性顺序会插在 class 与 style 之间；
  //   HTML 属性顺序不影响语义，这里放开中间的属性，仍只认 class 与行内 style 两段真值。
  const re = /<button class="dsws-btn primary[^"]*"[^>]* style="([^"]*)">([\s\S]*?)<\/button>/g
  let m: any
  while ((m = re.exec(html))) {
    const text = m[2].replace(/<[^>]+>/g, '').replace(/^\[icon:[^\]]*\]/, '').trim()
    out.push({ style: m[1], text: text })
  }
  return out
}
function bgOf(style: string) {
  const m = /background:([^;"]+)/.exec(style)
  return m ? m[1] : ''
}

// ============ A 组：规格行的身份（角标 / 色条 / 编号徽章） ============
{
  const specIssue = issueOf({ number: 1300, key: '1300', title: '规格行', type: 'spec', updatedAt: '2026-10-10T00:00:00Z' })
  const specContainer = containerOf({ number: 1300, key: '1300', title: '规格行', type: 'spec', stats: { total: 3, closed: 1 } })
  const st = makeSt([specIssue], [specContainer])
  const html = renderRow(st, specIssue)
  check(html.indexOf('dsws-chip-s') >= 0, 'A1 规格行角标用规格自己的 chip 样式类 dsws-chip-s')
  check(html.indexOf('dsws-chip-container') >= 0, 'A2 规格行角标带容器标记类 dsws-chip-container（列表页靠它认出容器行）')
  check(html.indexOf('规格') >= 0, 'A3 规格行角标文字是「规格」')
  check(/border-left:3px solid #1D4ED8/.test(html), 'A4 规格行左侧色条是贵族蓝 #1D4ED8')
  check(/class="dsws-idnum" style="color:#1D4ED8;border-color:#1D4ED8[^"]*"/.test(html), 'A5 规格行编号徽章在「有未关」态是蓝 #1D4ED8')
  check(html.indexOf('rgba(29,78,216,.10)') >= 0, 'A6 规格行底色是贵族蓝那层薄底')
}
// 回归：探索地图那一行一个字都不许变（角标「地图」、紫色色条）
{
  const mapIssue = issueOf({ number: 1200, key: '1200', title: '地图行', type: 'map', updatedAt: '2026-10-10T00:00:00Z' })
  const mapContainer = containerOf({ number: 1200, key: '1200', title: '地图行', type: 'map', stats: { total: 2, closed: 0 } })
  const st = makeSt([mapIssue], [mapContainer])
  const html = renderRow(st, mapIssue)
  check(html.indexOf('dsws-chip-m') >= 0 && html.indexOf('地图') >= 0, 'A7 探索地图行角标仍是「地图」（回归不动）')
  check(/border-left:3px solid #c084fc/.test(html), 'A8 探索地图行左侧色条仍是紫 #c084fc（回归不动）')
}

// ============ B 组：规格三态按钮 ============
function specRowHtml(stats: any) {
  const specIssue = issueOf({ number: 1301, key: '1301', title: '三态规格', type: 'spec', updatedAt: '2026-10-10T00:00:00Z' })
  const specContainer = containerOf({ number: 1301, key: '1301', title: '三态规格', type: 'spec', stats: stats })
  return renderRow(makeSt([specIssue], [specContainer]), specIssue)
}
{
  const empty = specRowHtml({ total: 0, closed: 0 })
  const open = specRowHtml({ total: 3, closed: 1 })
  const done = specRowHtml({ total: 3, closed: 3 })
  const bEmpty = primaryButtons(empty)[0]
  const bOpen = primaryButtons(open)[0]
  const bDone = primaryButtons(done)[0]
  check(!!bEmpty && bEmpty.text === '拆票' && bgOf(bEmpty.style) === '#f59e0b', 'B1 规格还没有实施票时按钮是「拆票」、底色橙 #f59e0b（实际：' + (bEmpty ? bEmpty.text + '/' + bgOf(bEmpty.style) : '无按钮') + '）')
  check(!!bOpen && bOpen.text === '执行' && bgOf(bOpen.style) === '#1D4ED8', 'B2 规格有未关实施票时按钮是「执行」、底色蓝 #1D4ED8（实际：' + (bOpen ? bOpen.text + '/' + bgOf(bOpen.style) : '无按钮') + '）')
  check(!!bDone && bDone.text === '完成' && bgOf(bDone.style) === '#3fb950', 'B3 规格实施票全关时按钮是「完成」、底色绿 #3fb950（实际：' + (bDone ? bDone.text + '/' + bgOf(bDone.style) : '无按钮') + '）')
  check(!!bEmpty && !!bOpen && !!bDone && bEmpty.text !== bOpen.text && bOpen.text !== bDone.text && bEmpty.text !== bDone.text, 'B4 三态按钮文字互不相同')
  check(!!bEmpty && !!bOpen && !!bDone && bgOf(bEmpty.style) !== bgOf(bOpen.style) && bgOf(bOpen.style) !== bgOf(bDone.style) && bgOf(bEmpty.style) !== bgOf(bDone.style), 'B5 三态按钮底色互不相同')
}

// ============ C 组：新会话按钮与主按钮永远同色实心 ============
{
  const specIssue = issueOf({ number: 1302, key: '1302', title: '同色规格', type: 'spec', updatedAt: '2026-10-10T00:00:00Z' })
  const specContainer = containerOf({ number: 1302, key: '1302', title: '同色规格', type: 'spec', stats: { total: 3, closed: 1 } })
  const html = renderRow(makeSt([specIssue], [specContainer]), specIssue)
  const btns = primaryButtons(html)
  check(btns.length === 2, 'C1 打开的行有两枚实心主按钮（主动作 + 新会话），实际 ' + btns.length)
  const main = btns[0], fresh = btns[1]
  check(!!main && !!fresh && bgOf(main.style) === bgOf(fresh.style) && bgOf(main.style) === '#1D4ED8', 'C2 规格行新会话按钮与主按钮同色（都 #1D4ED8）')
  check(!!fresh && bgOf(fresh.style) !== '' && bgOf(fresh.style) !== 'transparent', 'C3 新会话按钮是实心（底色不是 transparent）')
}
{
  // 探索地图行也照同一条规矩（回归）
  const mapIssue = issueOf({ number: 1201, key: '1201', title: '同色地图', type: 'map', updatedAt: '2026-10-10T00:00:00Z' })
  const mapContainer = containerOf({ number: 1201, key: '1201', title: '同色地图', type: 'map', stats: { total: 2, closed: 0 } })
  const html = renderRow(makeSt([mapIssue], [mapContainer]), mapIssue)
  const btns = primaryButtons(html)
  check(btns.length === 2 && bgOf(btns[0].style) === bgOf(btns[1].style) && bgOf(btns[0].style) !== '', 'C4 探索地图行新会话按钮与主按钮同色（回归不动）')
}

// ============ D 组：列表顺序（探索地图 → 规格 → 普通票）与容器组内跟随排序档 ============
// 两个容器的 updatedAt 与 createdAt 故意取相反的先后：这样「更新」与「创建」两列各自的
// 升序与降序都能分辨出用的是哪一列；编号升序与更新时间降序的方向也正好相反。
function renderList(issues: any[], maps: any[], overrides?: { sortKey?: 'updatedAt' | 'createdAt' | 'number' | 'title', sortDir?: 'asc' | 'desc' }) {
  const st = makeSt(issues, maps, overrides)
  return withQuietReact(() => renderToStaticMarkup(React.createElement(listMod.ListTab, { st: st, narrow: false })))
}
{
  const mapOld = issueOf({ number: 201, key: '201', title: 'MAP-OLD', type: 'map', updatedAt: '2026-10-01T00:00:00Z', createdAt: '2026-09-20T00:00:00Z' })
  const mapNew = issueOf({ number: 202, key: '202', title: 'MAP-NEW', type: 'map', updatedAt: '2026-10-05T00:00:00Z', createdAt: '2026-09-10T00:00:00Z' })
  const specOld = issueOf({ number: 203, key: '203', title: 'SPEC-OLD', type: 'spec', updatedAt: '2026-10-02T00:00:00Z', createdAt: '2026-09-25T00:00:00Z' })
  const specNew = issueOf({ number: 204, key: '204', title: 'SPEC-NEW', type: 'spec', updatedAt: '2026-10-06T00:00:00Z', createdAt: '2026-09-05T00:00:00Z' })
  const ticketA = issueOf({ number: 205, key: '205', title: 'TICKET-A', type: 'task', updatedAt: '2026-10-09T00:00:00Z' })
  const ticketB = issueOf({ number: 206, key: '206', title: 'TICKET-B', type: 'task', updatedAt: '2026-10-03T00:00:00Z' })
  const maps = [
    containerOf({ number: 201, key: '201', title: 'MAP-OLD', type: 'map', stats: { total: 1, closed: 0 } }),
    containerOf({ number: 202, key: '202', title: 'MAP-NEW', type: 'map', stats: { total: 1, closed: 0 } }),
    containerOf({ number: 203, key: '203', title: 'SPEC-OLD', type: 'spec', stats: { total: 1, closed: 0 } }),
    containerOf({ number: 204, key: '204', title: 'SPEC-NEW', type: 'spec', stats: { total: 1, closed: 0 } }),
  ]
  // 故意乱序放进池子：排序不能依赖宿主给的顺序
  const pool = [ticketB, specNew, mapOld, ticketA, specOld, mapNew]
  const html = renderList(pool, maps)
  const at = (t: string) => html.indexOf(t)
  check(at('MAP-NEW') >= 0 && at('MAP-OLD') >= 0 && at('SPEC-NEW') >= 0 && at('SPEC-OLD') >= 0 && at('TICKET-A') >= 0 && at('TICKET-B') >= 0, 'D0 六行都画出来了')
  check(at('MAP-NEW') < at('SPEC-NEW') && at('SPEC-NEW') < at('TICKET-A'), 'D1 列表顺序是「探索地图 → 规格 → 普通票」三段')
  check(at('MAP-NEW') < at('MAP-OLD'), 'D2 面板档位是更新时间降序时，探索地图组内新的在前（跟面板排序档）')
  check(at('SPEC-NEW') < at('SPEC-OLD'), 'D3 面板档位是更新时间降序时，规格组内新的在前（跟面板排序档）')
  check(at('TICKET-A') < at('TICKET-B'), 'D4 普通票仍按面板排序档排（最近更新降序，回归不动）')

  // 换档：四个排序键（更新时间、创建时间、编号、标题）各按升/降，容器组都要跟着变。旧实现把容器写死按更新时间降序，下面这些会画反。
  const before = (h: string, a: string, b: string) => h.indexOf(a) >= 0 && h.indexOf(b) >= 0 && h.indexOf(a) < h.indexOf(b)
  const byNumberAsc = renderList(pool, maps, { sortKey: 'number', sortDir: 'asc' })
  check(before(byNumberAsc, 'MAP-OLD', 'MAP-NEW') && before(byNumberAsc, 'SPEC-OLD', 'SPEC-NEW'), 'D5 编号升序下探索地图组与规格组都按编号从小到大')
  check(before(byNumberAsc, 'MAP-OLD', 'SPEC-OLD') && before(byNumberAsc, 'SPEC-OLD', 'TICKET-A'), 'D6 换档后三段顺序不变（探索地图 → 规格 → 普通票）')
  const byNumberDesc = renderList(pool, maps, { sortKey: 'number', sortDir: 'desc' })
  check(before(byNumberDesc, 'MAP-NEW', 'MAP-OLD') && before(byNumberDesc, 'SPEC-NEW', 'SPEC-OLD'), 'D7 编号降序下探索地图组与规格组都按编号从大到小')
  const byTitleAsc = renderList(pool, maps, { sortKey: 'title', sortDir: 'asc' })
  check(before(byTitleAsc, 'MAP-NEW', 'MAP-OLD') && before(byTitleAsc, 'SPEC-NEW', 'SPEC-OLD'), 'D8 标题升序下容器组按标题（小写比较）排：MAP-NEW 在 MAP-OLD 前')
  const byTitleDesc = renderList(pool, maps, { sortKey: 'title', sortDir: 'desc' })
  check(before(byTitleDesc, 'MAP-OLD', 'MAP-NEW') && before(byTitleDesc, 'SPEC-OLD', 'SPEC-NEW'), 'D9 标题降序下容器组按标题反排：MAP-OLD 在 MAP-NEW 前')
  const byCreatedAsc = renderList(pool, maps, { sortKey: 'createdAt', sortDir: 'asc' })
  check(before(byCreatedAsc, 'MAP-NEW', 'MAP-OLD') && before(byCreatedAsc, 'SPEC-NEW', 'SPEC-OLD'), 'D10 创建时间升序下容器组按创建时间排：9 月 10 日在 9 月 20 日之前（与更新时间降序给出相反先后，能分辨出读的是哪一列）')
  const byCreatedDesc = renderList(pool, maps, { sortKey: 'createdAt', sortDir: 'desc' })
  check(before(byCreatedDesc, 'MAP-OLD', 'MAP-NEW') && before(byCreatedDesc, 'SPEC-OLD', 'SPEC-NEW'), 'D11 创建时间降序下容器组按创建时间反排：9 月 20 日在 9 月 10 日之前')
  const byUpdatedAsc = renderList(pool, maps, { sortKey: 'updatedAt', sortDir: 'asc' })
  check(before(byUpdatedAsc, 'MAP-OLD', 'MAP-NEW') && before(byUpdatedAsc, 'SPEC-OLD', 'SPEC-NEW'), 'D12 更新时间升序下容器组按更新时间正排（与面板档位更新时间降序方向相反）')

  // 缺创建时间的容器：与普通票同口径——按空字符串参与比较（升序浮到组内最前、降序沉到最后），
  //   而不是「退化成同编号兜底」。这一步把票面判据里那句「缺失按空串」钉住。
  const mapNoCreated = issueOf({ number: 211, key: '211', title: 'MAP-NO-CREATED', type: 'map', updatedAt: '2026-10-01T00:00:00Z' })
  const mapHasCreated = issueOf({ number: 212, key: '212', title: 'MAP-HAS-CREATED', type: 'map', updatedAt: '2026-10-01T00:00:00Z', createdAt: '2026-09-01T00:00:00Z' })
  const mapsNoCreated = [
    containerOf({ number: 211, key: '211', title: 'MAP-NO-CREATED', type: 'map', stats: { total: 0, closed: 0 } }),
    containerOf({ number: 212, key: '212', title: 'MAP-HAS-CREATED', type: 'map', stats: { total: 0, closed: 0 } }),
  ]
  const createdAsc = renderList([mapHasCreated, mapNoCreated], mapsNoCreated, { sortKey: 'createdAt', sortDir: 'asc' })
  check(before(createdAsc, 'MAP-NO-CREATED', 'MAP-HAS-CREATED'), 'D13 缺创建时间的容器按空字符串参与比较：升序时排在组内有创建时间的前面')
  const createdDesc = renderList([mapHasCreated, mapNoCreated], mapsNoCreated, { sortKey: 'createdAt', sortDir: 'desc' })
  check(before(createdDesc, 'MAP-HAS-CREATED', 'MAP-NO-CREATED'), 'D14 缺创建时间的容器按空字符串参与比较：降序时排在组内有创建时间的后面')

  // 标题列按小写比较：两张容器标题只差大小写，算同一个主键，先后由编号升序兜底决定。
  //   编号大的那张故意写小写——若实现漏了转小写，按标题升序会把小写那张画到前面。
  const titleUpper = issueOf({ number: 210, key: '210', title: 'ALPHA', type: 'map', updatedAt: '2026-10-01T00:00:00Z' })
  const titleLower = issueOf({ number: 211, key: '211', title: 'alpha', type: 'map', updatedAt: '2026-10-01T00:00:00Z' })
  const mapsTitleCase = [
    containerOf({ number: 210, key: '210', title: 'ALPHA', type: 'map', stats: { total: 0, closed: 0 } }),
    containerOf({ number: 211, key: '211', title: 'alpha', type: 'map', stats: { total: 0, closed: 0 } }),
  ]
  const titleAsc = renderList([titleLower, titleUpper], mapsTitleCase, { sortKey: 'title', sortDir: 'asc' })
  check(before(titleAsc, 'ALPHA', 'alpha'), 'D15 标题升序按小写比较：只差大小写的标题算同一个键，再按编号升序兜底（210 在 211 前）')
  const titleDesc = renderList([titleLower, titleUpper], mapsTitleCase, { sortKey: 'title', sortDir: 'desc' })
  check(before(titleDesc, 'ALPHA', 'alpha'), 'D16 标题降序同样先按小写比较、同键落到编号升序兜底（210 仍在前）')
}

// ============ E 组：口径只留一份（不许各写各的） ============
{
  check(cv.CONTAINER_CHIP_LABEL_KEY && cv.CONTAINER_CHIP_LABEL_KEY.spec === 'list.specChip', 'E1 规格角标的词表键取自 container-view.ts 唯一真源')
  check(cv.CONTAINER_ACCENT && cv.CONTAINER_ACCENT.spec === '#1D4ED8', 'E2 规格的身份色取自 container-view.ts 唯一真源')
  const rowSrc = sourceText('src/client/views/ListTabRow.ts')
  const listSrc = sourceText('src/client/views/ListTab.ts')
  check(rowSrc.indexOf('containerTriState') >= 0 && rowSrc.indexOf('CONTAINER_ACCENT') >= 0, 'E3 行渲染用的是内核那套三态与身份色，不自己写一份')
  check(listSrc.indexOf('sortedMaps.concat(sortedSpecs).concat(sortedOpen)') >= 0, 'E4 列表页按「探索地图 → 规格 → 普通票」拼接')
  check(listSrc.indexOf('dsws-chip-m') < 0 || listSrc.indexOf('CONTAINER_CHIP_MARKER_CLASS') >= 0, 'E5 列表页认容器行靠内核给的标记类，不靠颜色猜')
}

console.log('')
console.log(failures === 0 ? ('全部通过：' + total + ' 条断言') : ('失败 ' + failures + ' / 共 ' + total + ' 条断言'))
if (failures > 0) process.exit(1)
