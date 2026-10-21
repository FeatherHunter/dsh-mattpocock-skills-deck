// tests/verify-1295-dual-panel.ts —— #1295 门禁：双轨面板（列表页与详情页按容器类型分流）
// https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1295
// 门禁归属: src/client/kernel/container-view.ts
// 门禁归属: src/client/views/ListTab.ts
// 门禁归属: src/client/views/ListTabRow.ts
// 门禁归属: src/client/views/MapDetail.ts
// 门禁归属: src/client/views/MapDetailTop.ts
// 门禁归属: src/client/views/MapDetailHead.ts
// 门禁归属: src/client/views/MapDetailSpecBody.ts
// 门禁归属: src/client/views/DetailActionBar.ts
// 跑法（从仓库根目录）: node --import ./scripts/ts-hook.mts tests/verify-1295-dual-panel.ts
//
// 这份门禁替票面八条验收标准守门（AC1–AC8）：
//   AC1 列表顺序：探索地图 → 实施地图（规格）→ 普通票；容器组内按最近更新降序、同一时刻按编号升序。
//       顺序基线（票池、放入顺序、期望顺序与分组）全部来自 tests/fixtures/1295-dual-panel/list-snapshot.json，
//       本文件里不写第二份顺序数组——否则「基线」就成了测试代码自说自话。
//   AC2 探索地图行：左侧色条紫 #c084fc、编号徽章紫、角标「地图」+ 地图图标，底色是紫的薄底。
//   AC3 实施地图（规格）行：左侧色条贵族蓝 #1D4ED8、编号徽章按三态（空橙 / 进行中蓝 / 收尾绿）、
//       角标「规格」+ 地图图标。
//   AC4 详情页：两类容器用同一套骨架（顶栏 / 身份角标 / 计数一句 / 按钮 / 分段进度 / 票列表），
//       但计数文案是两套（本图 N 张子票 / 本规格 N 张实施票）、正文是两套、点主按钮注入的提示词是两套。
//   AC5 每个状态下主按钮与「新会话」按钮同色实心；被阻塞徽章统一红 #f87171。
//   AC6 详情页不再出现旧的「执行中」橙 #f0883e（源码与渲染两面都断）。
//   AC7 识别不出的票（第三方提交、无章节标记、甚至无标签无 type）画成普通票、走今天的 triage 动作；
//       另外带【字符串式】'wayfinder:map' 标签的票必须排进探索地图组（这是这次修掉的老矛盾：
//       以前只认对象式标签，行画成地图却排在普通票堆里）。
//   AC8 容器种类与取色只剩一处真源 src/client/kernel/container-view.ts：ListTab.ts 分桶确实调它，
//       同时那行 sortedMaps.concat(sortedSpecs).concat(sortedOpen) 仍在（另一条老门禁按字面断言它）。
//
// 做法照抄 tests/verify-1286-list.ts / tests/verify-1286-detail.ts：真组件 + react-dom/server 静态渲染，
//   渲染之外的外部依赖（宿主自由量、词表、提示词生成器）注入到 globalThis；容器种类/三态/取色/文案键
//   一律用真实现 container-view.ts，不另写一份。断言文案用中文写清「期望什么、实际什么」，红了能直接定位。
//
// 数据与期望值出处：tests/fixtures/1295-dual-panel/ 下三份 json（列表页、地图详情页、规格详情页）。
// 测试文件只能写可被 Node 直接剥离的 TypeScript：不用 enum、不用构造函数参数属性、不用装饰器。

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { sourceText } from './lib/source-text.ts'

let failures = 0
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }
const failText = (msg: string, expected: any, actual: any) => msg + '（期望：' + String(expected) + '；实际：' + String(actual) + '）'

// ---- fixture：本门禁所有数据与期望值的唯一出处 ----
const FIXTURE_DIR = 'tests/fixtures/1295-dual-panel'
const readFixture = (name: string): any => JSON.parse(readFileSync(FIXTURE_DIR + '/' + name, 'utf8'))
const listFx: any = readFixture('list-snapshot.json')
const mapFx: any = readFixture('map-detail.json')
const specFx: any = readFixture('spec-detail.json')

// ---- 词表：只把断言要看的几个键译成中文，其余键原样返回 ----
//   这样「拆票/执行/完成/检查/诊断/被阻塞」这些词只可能出现在真按钮与徽章上，不会被提示文案带偏。
//   探索地图正文那几节的键（map.notesCap 之类）故意不译：要能用「这段在不在页面上」断它。
const trDict: Record<string, string> = {
  'list.specChip': '规格',
  'list.mapChip': '地图',
  'act.split': '拆票',
  'act.execute': '执行',
  'act.done': '完成',
  'act.inspect': '检查',
  'act.diagnose': '诊断',
  'act.fix': '修复',
  'act.implement': '实施',
  'list.newSessionLabel': '新会话',
  'list.blocked': '被阻塞',
  'map.subBlocked': '被阻塞',
  'map.subCount': '本图 {n} 张子票（已关闭 {c} 张）',
  'map.specSubCount': '本规格 {n} 张实施票（已关闭 {c} 张）',
  'map.archive': '档案',
  'map.newSessionTitle': '开一个新会话',
  'map.inspectTitle': '看看这张地图还缺什么',
  'map.executeTitle': '推进这张地图',
  'map.doneTitle': '这张地图已收尾',
  'spec.splitTitle': '把规格拆成实施票',
  'spec.executeTitle': '把规格推进到下一步',
  'spec.doneTitle': '这张规格已收尾',
  'spec.section.problem': '问题陈述',
  'spec.section.solution': '解决方案',
  'spec.section.userStories': '用户故事',
  'spec.section.implDecisions': '实现决策',
  'spec.section.testDecisions': '测试决策',
  'spec.section.outOfScope': '不在范围内',
  'spec.section.notes': '补充说明',
}
const trFn = (key: any, params?: any): string => {
  let s = trDict[String(key)] !== undefined ? trDict[String(key)] : String(key)
  if (params) s = s.replace(/\{(\w+)\}/g, (m: string, name: string) => (name in params ? String(params[name]) : m))
  return s
}

// ---- 全局注入：视图里那些跨叶子调用的名字，运行时都从 globalThis 找 ----
const G: any = globalThis
G.React = React
G.tr = trFn
G.uiText = (key: any) => trFn(key)
G.emit = () => {}
G.Ic = (props: any) => '[icon:' + ((props && props.n) || '?') + ']'
G.Tip = (props: any) => React.createElement('span', { 'data-tip': String(props.content) }, props.children)
G.chipProps = (props: any) => props
G.COPY_FLASH_MS = 1300

// 记下渲染过程中建出来的元素：静态渲染不挂事件，点按钮那一下要拿到真的 onClick。
const created: any[] = []
function recH(type: any, props: any, ...children: any[]) {
  const el = React.createElement(type, props, ...children)
  created.push(el)
  return el
}
G.h = recH

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

// ---- 身份与链接：走真实现（手写的假实现一旦与真实现不一致，门禁就测了个假环境）----
const identityMod: any = await import('../src/tracker/kernel/identity-keys.js')
const linkMod: any = await import('../src/client/kernel/link.js')
const { DswsCtx, createCx } = await import('../src/client/kernel/ctx.js')
G.DswsCtx = DswsCtx
G.idOf = identityMod.idOf
G.idOfParts = identityMod.idOfParts
G.effortOf = identityMod.effortOf
G.refKeyOf = identityMod.refKeyOf
G.issueUrlFor = linkMod.issueUrlFor

// ---- 容器口径：走真实现（唯一真源），行渲染、列表分桶与详情页都从它拿种类、颜色、三态与提示语 ----
const cv: any = await import('../src/client/kernel/container-view.js')
G.containerKindOf = cv.containerKindOf
G.containerStateOf = cv.containerStateOf
G.containerTriState = cv.containerTriState
G.containerNumberColor = cv.containerNumberColor
G.containerTitleKey = cv.containerTitleKey
G.containerPromptText = cv.containerPromptText
G.containerCountKey = cv.containerCountKey
G.CONTAINER_ACCENT = cv.CONTAINER_ACCENT
G.CONTAINER_TINT = cv.CONTAINER_TINT
G.CONTAINER_CHIP_CLASS = cv.CONTAINER_CHIP_CLASS
G.CONTAINER_CHIP_LABEL_KEY = cv.CONTAINER_CHIP_LABEL_KEY
G.CONTAINER_CHIP_MARKER_CLASS = cv.CONTAINER_CHIP_MARKER_CLASS
G.CONTAINER_EMPTY_COLOR = cv.CONTAINER_EMPTY_COLOR
G.CONTAINER_DONE_COLOR = cv.CONTAINER_DONE_COLOR

// ---- 行级动作与取色：也走真实现（AC7 要断「走今天的 triage 动作」，不能拿假动作糊弄）----
// 行级动作全家已从 store-derived.ts 抽到 row-actions.ts；基色与身份查找仍留在 store-derived。
const sd: any = await import('../src/client/kernel/store-derived.js')
const ra: any = await import('../src/client/kernel/row-actions.js')
G.mkRowAction = ra.mkRowAction
G.actionColorOf = ra.actionColorOf
G.isLightHex = sd.isLightHex
G.rowActionKind = ra.rowActionKind
G.rowActionText = ra.rowActionText
G.findMapByIdentity = sd.findMapByIdentity
G.effortNamesOf = sd.effortNamesOf

// ---- 提示词生成器：给带标记的假实现，门禁只断「选了哪一条」，措辞归 #1281/#1282 ----
G.renderTemplate = (id: any, values: any) => 'TPL:' + String(id) + ':' + String(values && values.url)
G.promptText = (id: any) => 'TPL:' + String(id)
G.promptTextFor = (st: any, id: any, values: any) => 'FOR:' + String(id)
G.completePrompt = (st: any, num: any, title: any, total: any, closed: any) => 'COMPLETE:' + String(num) + ':' + String(total) + '/' + String(closed)
G.inspectPrompt = (st: any, num: any, title: any) => 'INSPECT:' + String(num)
G.startText = (st: any, t: any) => 'START:' + String(t && t.number)

// 注入的提示词：记下来，门禁要断「点这个按钮注入的是哪一条」。
const injected: string[] = []
G.inject = (st: any, text: any) => { injected.push(String(text)) }

// ---- 列表页行与面板需要的其余自由量（与 verify-1286-list.ts 同一份口径）----
G.authorColor = () => '#7aa2f7'
G.darken = () => 'rgba(188,140,255,.6)'
G.hexA = () => 'rgba(188,140,255,.16)'
G.ticketRowsOf = (arr: any) => arr
G.issuePageRowsOf = () => []
G.chipKeyDown = () => {}
G.copyText = async () => true
G.openInNewSession = () => {}
G.openHealthCheck = () => {}
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

// ---- 详情页需要的其余自由量（与 verify-1286-detail.ts 同一份口径）----
G.mdToHtml = (s: any) => React.createElement('div', null, String(s == null ? '' : s))
G.buildColorOf = () => ({})
G.TypeChip = () => null
G.useIssueDetailFold = () => null
G.tProgressBar = () => null
G.tStatusBadge = () => null
G.blockerNames = () => '阻塞者'
G.host = { call: () => Promise.resolve({ ok: true }) }
G.pushNav = () => {}
G.popNav = () => {}
G.fetchMapTickets = () => {}

// ---- 动态导入必须在全局量齐备之后 ----
const rowMod: any = await import('../src/client/views/ListTabRow.js')
const listMod: any = await import('../src/client/views/ListTab.js')
// 本次界面反馈需求：筛选药丸那一行搬成了独立叶子（要接三块液态墨块，ListTab 放不下）。
// 这里直接加载真叶子；墨块钩子用空实现——这几道门禁只看行与按钮的形状，不测墨块对位。
const filterRowMod: any = await import('../src/client/views/listFilterRow.js')
G.listFilterRowNode = filterRowMod.listFilterRowNode
G.useLiquidInk = () => null
G.liquidInkRemember = () => {}
const { MapDetail } = await import('../src/client/views/MapDetail.js')
const headMod: any = await import('../src/client/views/MapDetailHead.js')
const topMod: any = await import('../src/client/views/MapDetailTop.js')
const barMod: any = await import('../src/client/views/DetailActionBar.js')
const specMod: any = await import('../src/client/views/MapDetailSpecBody.js')
G.listIssueRow = rowMod.listIssueRow
G.MapDetailHead = headMod.MapDetailHead
G.MapDetailTop = topMod.MapDetailTop
G.DetailActionBar = barMod.DetailActionBar
G.MapDetailSpecBody = specMod.MapDetailSpecBody

// ---- 数据构造函数：fixture 里只写差异字段，公共默认值在这里补齐 ----
function issueOf(o: any) {
  return Object.assign({ number: 1, key: '1', effortId: 'default', title: '票', state: 'OPEN', labels: [], type: 'task', updatedAt: '2026-10-01T00:00:00.000Z', author: null, blockedBy: [] }, o || {})
}
function containerOf(o: any) {
  return Object.assign({ number: 1, key: '1', effortId: 'default', title: '容器', state: 'OPEN', labels: [], type: 'map', stats: { total: 0, closed: 0 }, tickets: [] }, o || {})
}
function ticketOf(over: any) {
  const n = over && over.number != null ? over.number : 1
  return Object.assign({ number: n, key: String(n), effortId: 'default', title: '子票' + n, state: 'OPEN', blockedBy: [], labels: [], type: 'task', level: 0 }, over || {})
}
function statsOf(total: number, closed: number) {
  return { levels: [{ open: total - closed, closed: closed, total: total }], total: total, closed: closed }
}
function makeListSt(issues: any[], maps: any[]) {
  return {
    snapshot: { issues: issues, maps: maps, generatedMs: '2026-10-20T00:00:00.000Z' },
    tab: 'list',
    stateFilter: listFx.st.stateFilter,
    lblFilters: [],
    effFilters: [],
    sortKey: listFx.st.sortKey,
    sortDir: listFx.st.sortDir,
    rowFlash: {},
    writeAt: {},
    cwd: listFx.st.cwd,
  } as any
}
function fillTemplate(tpl: any, stats: any) {
  return String(tpl).replace(/\{n\}/g, String(stats.total)).replace(/\{c\}/g, String(stats.closed))
}
function bgOf(style: string) {
  const m = /background:([^;"]+)/.exec(style)
  return m ? m[1] : ''
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
function elText(children: any): string {
  if (children == null) return ''
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(elText).join('')
  if (children && children.props) return elText(children.props.children)
  return ''
}
// 点「行内主按钮」：只认文字里带 label 的那一枚（行里还有「新会话」，都叫 primary）。
function clickRecordedPrimary(label: string): string {
  injected.length = 0
  for (const el of created) {
    if (!el || !el.props || typeof el.props.onClick !== 'function') continue
    if (String(el.props.className || '').indexOf('dsws-btn primary') < 0) continue
    if (elText(el.props.children).indexOf(label) < 0) continue
    el.props.onClick({ stopPropagation: () => {}, preventDefault: () => {} })
    return injected[0] || ''
  }
  return ''
}

// fixture 里的票池与容器表：按编号取，顺序不依赖宿主。
const issueByNumber: any = {}
for (const x of listFx.issues) issueByNumber[String(x.number)] = issueOf(x)
const mapByNumber: any = {}
for (const m of listFx.maps) mapByNumber[String(m.number)] = containerOf(m)
const rowCase = (name: string): any => listFx.rows.find((r: any) => r.case === name)

function renderRow(st: any, issue: any, blockOf: any) {
  return withQuietReact(() => renderToStaticMarkup(rowMod.listIssueRow(React.createElement, st, issue, true, false, blockOf || {}, {}, false)))
}
// 这一份用 recH 当 h：行内按钮（含 store-derived 的 mkRowAction）会被记进 created，供点击断言。
function renderRowRecording(st: any, issue: any, blockOf: any) {
  created.length = 0
  return withQuietReact(() => renderToStaticMarkup(rowMod.listIssueRow(recH, st, issue, true, false, blockOf || {}, {}, false)))
}
function rowOrder(html: string) {
  const out: string[] = []
  const re = /aria-label="#([^"\s]*) ([^"]*)"/g
  let m: any
  while ((m = re.exec(html))) out.push(String(m[1]))
  return out
}

// ============ AC1：列表顺序（基线来自 fixture） ============
let actualOrder: string[] = []
{
  const pool: any[] = []
  const seen: any = {}
  for (const num of listFx.inputOrder) {
    const x = issueByNumber[String(num)]
    if (!x || seen[String(num)]) continue // fixture 里混进来的占位编号直接跳过
    seen[String(num)] = true
    pool.push(x)
  }
  const st = makeListSt(pool, listFx.maps.map((m: any) => containerOf(m)))
  const html = withQuietReact(() => renderToStaticMarkup(React.createElement(listMod.ListTab, { st: st, narrow: false })))
  actualOrder = rowOrder(html)
  const expected = listFx.expected

  check(actualOrder.length === expected.order.length,
    failText('AC1a 列表画出的行数与基线一致（探索地图 2 + 规格 3 + 普通票 3）', expected.order.length + ' 行：' + expected.order.join('、'), actualOrder.length + ' 行：' + actualOrder.join('、')))
  check(actualOrder.join(',') === expected.order.join(','),
    failText('AC1b 列表顺序与 fixture 基线一致（探索地图 → 实施地图 → 普通票）', expected.order.join('、'), actualOrder.join('、')))

  let cursor = 0
  let groupsOk = true
  const groupDetails: string[] = []
  for (const g of expected.groups) {
    const slice = actualOrder.slice(cursor, cursor + g.keys.length)
    cursor += g.keys.length
    if (slice.join(',') !== g.keys.join(',')) groupsOk = false
    groupDetails.push(g.label + '[' + slice.join('、') + ']')
  }
  check(groupsOk,
    failText('AC1c 三段分组与 fixture 一致（同一组内的先后也一致）', expected.groups.map((g: any) => g.label + '[' + g.keys.join('、') + ']').join(' / '), groupDetails.join(' / ')))

  const closed = expected.closedKeysAbsent || []
  const leaked = closed.filter((k: string) => actualOrder.indexOf(String(k)) >= 0)
  check(leaked.length === 0, failText('AC1d 已关闭的票不出现在 open 列表里', '不出现 ' + closed.join('、'), leaked.length ? '出现了 ' + leaked.join('、') : '没出现'))

  // 顺序规则的证据（都从 fixture 里取，不内联）：
  const specGroup = expected.groups.find((g: any) => g.group === 'spec')
  const tieA = String(specGroup.keys[0])
  const tieB = String(specGroup.keys[1])
  check(actualOrder.indexOf(tieA) >= 0 && actualOrder.indexOf(tieB) >= 0 && actualOrder.indexOf(tieA) < actualOrder.indexOf(tieB),
    failText('AC1e 规格组内 updatedAt 相同的两张按编号升序（' + tieA + ' 在 ' + tieB + ' 前，' + expected.orderRule + '）', tieA + ' 在 ' + tieB + ' 前', '实际顺序：' + actualOrder.join('、')))
  const mapGroup = expected.groups.find((g: any) => g.group === 'map')
  check(actualOrder.indexOf(String(mapGroup.keys[0])) < actualOrder.indexOf(String(specGroup.keys[0])),
    failText('AC1f 组顺序压过时间：探索地图组整体排在规格组之前', mapGroup.label + ' 在 ' + specGroup.label + ' 之前', '实际顺序：' + actualOrder.join('、')))
}

// ============ AC2 / AC3：容器行的身份（角标 / 色条 / 编号徽章 / 底色）============
for (const rc of listFx.rows) {
  const e = rc.expect
  if (!e || e.kind === 'open') continue
  const issue = issueByNumber[String(rc.issueKey)]
  const container = rc.containerKey != null ? mapByNumber[String(rc.containerKey)] : null
  const st = makeListSt([issue], container ? [container] : [])
  const html = renderRow(st, issue, null)
  const ac = e.kind === 'map' ? 'AC2' : 'AC3'
  const what = ac + '·' + rc.case + '（' + rc.what + '）'
  check(html.indexOf('dsws-chip ' + e.chipClass + ' ' + e.chipMarkerClass) >= 0,
    failText(what + ' 角标类名是「' + e.chipClass + ' + 容器标记类 ' + e.chipMarkerClass + '」', 'class="dsws-chip ' + e.chipClass + ' ' + e.chipMarkerClass + '"', (html.match(/class="dsws-chip dsws-chip-[ms][^"]*"/) || ['（没有容器角标）'])[0]))
  check(html.indexOf(e.chipText) >= 0 && html.indexOf('[icon:' + e.chipIcon + ']') >= 0,
    failText(what + ' 角标文字是「' + e.chipText + '」且带地图图标', e.chipText + ' + [icon:' + e.chipIcon + ']', '角标一段：' + (html.match(/dsws-chip [^"]*dsws-chip-[ms][^"]*"[^>]*>[\s\S]*?<\/span>/) || [''])[0]))
  check(html.indexOf('border-left:3px solid ' + e.bar) >= 0,
    failText(what + ' 左侧色条颜色', 'border-left:3px solid ' + e.bar, (html.match(/border-left:[^;"]+/) || [''])[0]))
  check(html.indexOf(e.tint) >= 0,
    failText(what + ' 行底色是身份色的薄底', e.tint, (html.match(/background:rgba\([^)]*\)/) || [''])[0]))
  const badgeNeedle = 'class="dsws-idnum" style="color:' + e.badgeColor + ';border-color:' + e.badgeColor + '"'
  check(html.indexOf(badgeNeedle) >= 0,
    failText(what + ' 编号徽章颜色', badgeNeedle, (html.match(/class="dsws-idnum"[^>]*/) || [''])[0]))
  if (e.primaryText) {
    const btns = primaryButtons(html)
    const main = btns[0]
    check(!!main && main.text === e.primaryText && bgOf(main.style) === e.primaryColor,
      failText(what + ' 主按钮文字与底色（状态色按三态走）', e.primaryText + ' / ' + e.primaryColor, main ? main.text + ' / ' + bgOf(main.style) : '没有主按钮'))
  }
}

// ============ AC7（前半）：识别不出的票画成普通票，走今天的 triage 动作 ============
for (const rc of listFx.rows) {
  const e = rc.expect
  if (!e || e.kind !== 'open') continue
  const issue = issueByNumber[String(rc.issueKey)]
  const st = makeListSt([issue], [])
  const html = renderRow(st, issue, null)
  const what = 'AC7·' + rc.case + '（' + rc.what + '）'
  const noChip = html.indexOf('dsws-chip-container') < 0 && html.indexOf('dsws-chip dsws-chip-m') < 0 && html.indexOf('dsws-chip dsws-chip-s') < 0
  check(noChip,
    what + ' 没有容器角标、没有容器类名（实际：' + (noChip ? '没有' : '出现了容器类名') + '）')
  check(html.indexOf('border-left:3px solid') < 0,
    what + ' 没有容器行的左侧色条', '不含 border-left:3px solid', (html.match(/border-left:[^;"]+/) || ['没有色条'])[0])
  const badgeNeedle = 'class="dsws-idnum" style="color:' + e.badgeColor + ';border-color:' + e.badgeColor + '"'
  check(html.indexOf(badgeNeedle) >= 0,
    failText(what + ' 编号徽章仍是普通票的按标签取色', badgeNeedle, (html.match(/class="dsws-idnum"[^>]*/) || [''])[0]))
  const btns = primaryButtons(html)
  const main = btns[0]
  check(!!main && main.text === e.primaryText && bgOf(main.style) === e.primaryColor,
    failText(what + ' 主按钮是今天的 triage 动作（' + e.primaryText + '）', e.primaryText + ' / ' + e.primaryColor, main ? main.text + ' / ' + bgOf(main.style) : '没有主按钮'))
  renderRowRecording(st, issue, null)
  const clicked = clickRecordedPrimary(e.primaryText)
  check(clicked === e.inject,
    failText(what + ' 点主按钮注入的仍是今天 triage 那一条提示词（流程没变）', e.inject, clicked || '（没有可点的按钮）'))
}

// 无标签无 type 的极端样本 + 被阻塞的普通票
for (const rc of listFx.standaloneRows) {
  const issue = issueOf(rc.issue)
  const blockOf: any = {}
  if (rc.blockOf) blockOf[String(identityMod.idOf(issue))] = rc.blockOf
  const st = makeListSt([issue], [])
  const html = renderRow(st, issue, blockOf)
  const what = 'AC7/AC5·' + rc.case + '（' + rc.what + '）'
  if (rc.case === 'blockedPlain') {
    const e = rc.expect
    check(html.indexOf(e.blockedClass) >= 0 && html.indexOf('color:' + e.blockedColor) >= 0 && html.indexOf(e.blockedText) >= 0,
      failText(what + ' 被阻塞徽章统一红', e.blockedClass + ' / ' + e.blockedColor + ' / 「' + e.blockedText + '」', (html.match(/dsws-blocked[^>]*>[\s\S]*?<\/span>/) || [''])[0]))
    check(primaryButtons(html).length === 0, what + ' 被阻塞的行不画动作按钮（实际 ' + primaryButtons(html).length + ' 枚）')
  } else {
    const e = rc.expect
    const noContainerMark = html.indexOf('dsws-chip-container') < 0 && html.indexOf('border-left:3px solid') < 0
    check(noContainerMark,
      what + ' 没有容器角标、没有左侧色条（实际：' + (noContainerMark ? '两个都没有' : '出现了容器标记') + '）')
    const btns = primaryButtons(html)
    const main = btns[0]
    check(!!main && main.text === e.primaryText && bgOf(main.style) === e.primaryColor,
      failText(what + ' 主按钮是今天的 triage 动作', e.primaryText + ' / ' + e.primaryColor, main ? main.text + ' / ' + bgOf(main.style) : '没有主按钮'))
    renderRowRecording(st, issue, blockOf)
    const clicked = clickRecordedPrimary(e.primaryText)
    check(clicked === e.inject,
      failText(what + ' 点主按钮注入 triage 那一条提示词', e.inject, clicked || '（没有可点的按钮）'))
  }
}

// ============ AC4 / AC5 / AC6：详情页（两类容器同一骨架、两套文案、两套提示词、被阻塞红）============
function makeCx(h: any) {
  const services: any = {
    slots: { register: () => () => {}, inject: (name: string, fn: any) => { try { fn() } catch (e) {} } },
    locale: { register: () => () => {}, bind: () => trFn },
    timer: { timeout: (fn: any, ms: number) => setTimeout(fn, ms) },
  }
  const fakeStore: any = { snapshot: null, sessionId: 'test', tab: 'list', cwd: 'D:\\ws', issuePath: { current: null, nodes: [] }, noRepoCard: { expanded: false } }
  return createCx({
    ctx: { get: (k: string) => services[k], effect: (fn: any) => { const r = fn(); return typeof r === 'function' ? r : () => {} }, inject: (deps: any, cb: any) => { cb({ get: (k: string) => services[k] }); return { dispose: () => {} } } },
    h: h,
    rdom: {},
    storeSvc: { shared: fakeStore, stores: {}, makeStore: () => fakeStore, storeOf: () => fakeStore, emit: () => {}, sub: () => () => {}, useStore: () => fakeStore },
    localeSvc: services.locale,
    timer: services.timer,
    api: { call: async () => ({ ok: true }), inject: () => {}, copyText: async () => {} },
    router: { open: () => {}, toggle: () => {} },
  })
}
function buildDetailContainer(fx: any, stats: any, tickets: any) {
  return Object.assign({}, fx.container, {
    stats: statsOf(stats.total, stats.closed),
    tickets: (tickets || []).map((t: any) => ticketOf(t)),
  })
}
function renderContainer(m: any): string {
  created.length = 0
  injected.length = 0
  const st: any = { snapshot: { issues: [], maps: [] }, mapTickets: null, reveal: {}, copyFlash: null, cwd: 'D:\\ws' }
  const g: any = { m: m }
  return withQuietReact(() => renderToStaticMarkup(React.createElement(DswsCtx.Provider, { value: makeCx(recH) },
    React.createElement(MapDetail, { st: st, g: g, drill: false }))))
}
function buttonHtml(html: string, marker: string): string {
  const i = html.indexOf(marker)
  if (i < 0) return ''
  const s = html.lastIndexOf('<button', i)
  const e = html.indexOf('</button>', i)
  if (s < 0 || e < 0) return ''
  return html.slice(s, e)
}
function badgeHtml(html: string): string {
  const i = html.indexOf('dsws-idnum')
  if (i < 0) return ''
  return html.slice(i, html.indexOf('</span>', i))
}
// 顶栏容器角标那一段（带 data-detail-snapshot 标记的 span）：退格按钮与面包屑也各带一个 data-full，
// 所以不能抓页面上第一个 data-full，必须从容器角标的标记往后取。
function containerChipFull(html: string): string {
  const i = html.indexOf('data-detail-snapshot')
  if (i < 0) return ''
  const m = /data-full="([^"]*)"/.exec(html.slice(i, i + 240))
  return m ? m[1] : ''
}
// 点顶栏主按钮（静态渲染不挂事件，这里直接调它的 onClick），返回注入的提示词。
// 顶栏主按钮是「带 data-detail-primary-text 标记的那枚 primary 按钮」；子票行里也有 primary（行内新会话），
// 而 MapDetail 在拼 children 时就把行按钮建出来了（先于顶栏渲染），不能按 className 取第一枚。
function clickTopPrimary(): string {
  injected.length = 0
  for (const el of created) {
    if (!el || !el.props || el.props.className !== 'dsws-btn primary') continue
    if (typeof el.props.onClick !== 'function') continue
    const kids = Array.isArray(el.props.children) ? el.props.children : [el.props.children]
    if (!kids.some((k: any) => k && k.props && k.props['data-detail-primary-text'])) continue
    el.props.onClick({ stopPropagation: () => {}, preventDefault: () => {} })
    break
  }
  return injected.length ? injected[0] : ''
}
function renderDetailState(fx: any, state: any) {
  return renderContainer(buildDetailContainer(fx, state.stats, state.tickets))
}

const detailPairs = [{ fx: mapFx, label: '探索地图' }, { fx: specFx, label: '实施地图（规格）' }]
for (const pair of detailPairs) {
  const fx = pair.fx
  const label = pair.label
  const openState = fx.states.find((s: any) => s.name === 'open')
  const htmlOpen = renderDetailState(fx, openState)

  // 身份：角标文字 + chip 样式类 + 编号徽章色（AC2/AC3 的详情页同款）
  check(htmlOpen.indexOf('dsws-chip ' + fx.expect.chipClass) >= 0,
    failText('AC4·' + label + ' 详情页顶栏角标用容器自己的 chip 样式类', 'class="dsws-chip ' + fx.expect.chipClass + '"', (htmlOpen.match(/dsws-chip dsws-chip-[ms][^"]*"[^>]*/) || [''])[0]))
  check(htmlOpen.indexOf('data-full="' + fx.expect.chipText + '"') >= 0,
    failText('AC4·' + label + ' 详情页顶栏角标文字', 'data-full="' + fx.expect.chipText + '"', 'data-full="' + containerChipFull(htmlOpen) + '"'))
  check(new RegExp('color:\\s*' + fx.expect.badgeColor, 'i').test(badgeHtml(htmlOpen)),
    failText('AC4·' + label + ' 详情页编号徽章颜色', fx.expect.badgeColor, badgeHtml(htmlOpen)))

  // 骨架共用：两类容器都该有分段进度条、层容器、仪式环区、票节点
  const missingSkeleton = fx.expect.skeletonClasses.filter((c: string) => htmlOpen.indexOf(c) < 0)
  check(missingSkeleton.length === 0,
    failText('AC4·' + label + ' 详情页沿用同一套骨架类名（' + fx.expect.skeletonClasses.join(' / ') + '）', '都出现', missingSkeleton.length ? '缺：' + missingSkeleton.join('、') : '一个都不缺'))

  // 正文分开：地图页画探索地图那几节；规格页画自己的七节，且不画地图那几节
  if (fx.kind === 'map') {
    const missing = fx.expect.bodyMarkers.filter((m: string) => htmlOpen.indexOf(m) < 0)
    check(missing.length === 0,
      failText('AC4·' + label + ' 详情页画探索地图的正文（目的地 / 备注 / 决策 / 迷雾 / 不再范围内）', '都出现', missing.length ? '缺：' + missing.join('、') : '一个都不缺'))
    const specTitles = specFx.expect.sectionTitles
    const leaked = specTitles.filter((t: string) => htmlOpen.indexOf(t) >= 0)
    check(leaked.length === 0,
      failText('AC4·' + label + ' 详情页不画规格那七节正文', '不出现任何一节', leaked.length ? '出现了：' + leaked.join('、') : '一节都没出现'))
  } else {
    const missing = fx.expect.sectionTitles.filter((t: string) => htmlOpen.indexOf(t) < 0)
    check(missing.length === 0,
      failText('AC4·' + label + ' 详情页画自己的七节正文（' + fx.expect.sectionTitles.join(' / ') + '）', '都出现', missing.length ? '缺：' + missing.join('、') : '一个都不缺'))
    const leaked = fx.expect.forbiddenBodyMarkers.filter((m: string) => htmlOpen.indexOf(m) >= 0)
    check(leaked.length === 0,
      failText('AC4·' + label + ' 详情页不画探索地图那几节正文', '都不出现', leaked.length ? '出现了：' + leaked.join('、') : '都没出现'))
  }

  // 每个状态：计数句（两套文案不能串）、主按钮文字/颜色、新会话同色、注入哪一条提示词
  const stateHtmls: string[] = []
  for (const state of fx.states) {
    const html = renderDetailState(fx, state)
    stateHtmls.push(html)
    const what = 'AC4/AC5·' + label + '·' + state.name + '（' + state.what + '）'
    const countWant = fillTemplate(state.expect.countText, state.stats)
    check(html.indexOf(countWant) >= 0,
      failText(what + ' 计数句', countWant, (html.match(/本(图|规格) \d+ 张[^<]*?）/g) || ['（没读到计数句）']).join(' / ')))
    const foreignWant = fillTemplate(fx.expect.countForeign, state.stats)
    check(html.indexOf(foreignWant) < 0,
      failText(what + ' 不串用另一类容器的计数句', '不出现「' + foreignWant + '」', html.indexOf(foreignWant) < 0 ? '没有串用' : '出现了「' + foreignWant + '」'))

    const btn = buttonHtml(html, 'data-detail-primary-text')
    check(!!btn && btn.indexOf(state.expect.primaryText) >= 0 && bgOf(btn) === state.expect.primaryColor,
      failText(what + ' 主按钮文字与底色', state.expect.primaryText + ' / ' + state.expect.primaryColor, btn ? (btn.match(/background:\s*([^;"]+)/) ? state.expect.primaryText + ' / ' + bgOf(btn) : btn.slice(0, 120)) : '找不到顶栏主按钮'))
    const newBtn = buttonHtml(html, 'data-detail-new-text')
    check(!!newBtn && newBtn.indexOf(fx.expect.newSessionText) >= 0 && bgOf(newBtn) === bgOf(btn),
      failText(what + ' 新会话按钮与主按钮同色实心', '同色 ' + bgOf(btn), newBtn ? (bgOf(newBtn) || '透明（没有实心底色）') : '找不到新会话按钮'))

    const got = clickTopPrimary()
    check(got === state.expect.inject,
      failText(what + ' 点主按钮注入的提示词按容器类型/状态各走各的', state.expect.inject, got || '（没点上）'))
  }

  // AC6：详情页不再出现旧的「执行中」橙
  const withLegacyOrange = stateHtmls.filter((h: string) => h.indexOf('#f0883e') >= 0)
  check(withLegacyOrange.length === 0,
    'AC6·' + label + ' 详情页渲染里不再出现旧的「执行中」橙 #f0883e（实际出现 ' + withLegacyOrange.length + ' 处）')
}

// AC5/AC6：被阻塞的统一红（详情页与被阻塞徽章来自同一个红）
{
  const bc = mapFx.blockedCase
  const html = renderContainer(buildDetailContainer(mapFx, bc.stats, bc.tickets))
  check(html.indexOf(bc.expectColor) >= 0,
    failText('AC5·详情页被阻塞的子票是红 ' + bc.expectColor, bc.expectColor, (html.match(/color:\s*#f87171/g) || ['（没出现红色）']).length + ' 处 #f87171'))
  check(html.indexOf(bc.expectText) >= 0,
    failText('AC5·详情页被阻塞的说明文字是「' + bc.expectText + '」', bc.expectText, (html.match(/被阻塞/g) || ['（没出现）']).length + ' 处「被阻塞」'))
}
// AC6：源码层面也不再有旧橙；被阻塞的红在列表行与详情页两处是同一个字面量。
{
  const detailSources = [
    'src/client/views/MapDetail.ts',
    'src/client/views/MapDetailTop.ts',
    'src/client/views/MapDetailHead.ts',
    'src/client/views/DetailActionBar.ts',
    'src/client/views/MapDetailSpecBody.ts',
    'src/client/views/TicketRow.js',
  ]
  const withOrange = detailSources.filter((f: string) => sourceText(f).indexOf('#f0883e') >= 0)
  check(withOrange.length === 0,
    'AC6·详情页一族源码里都不再有旧的「执行中」橙 #f0883e（实际出现在：' + (withOrange.length ? withOrange.join('、') : '无') + '）')
  const rowSrcForRed = sourceText('src/client/views/ListTabRow.ts')
  const detailSrcForRed = sourceText('src/client/views/MapDetail.ts')
  check(rowSrcForRed.indexOf('#f87171') >= 0 && detailSrcForRed.indexOf('#f87171') >= 0,
    'AC6·「被阻塞」的红在列表行与详情页两处是同一个 #f87171（实际：列表行 ' + (rowSrcForRed.indexOf('#f87171') >= 0 ? '有' : '缺') + '，详情页 ' + (detailSrcForRed.indexOf('#f87171') >= 0 ? '有' : '缺') + '）')
}

// ============ AC7（后半）：字符串式 'wayfinder:map' 标签的票必须排进探索地图组 ============
{
  const stringLabelIssue = listFx.issues.find((x: any) => (x.labels || []).some((l: any) => typeof l === 'string' && l === 'wayfinder:map'))
  const stringKey = stringLabelIssue ? String(stringLabelIssue.number) : ''
  const mapGroup = listFx.expected.groups.find((g: any) => g.group === 'map')
  const specFirst = String(listFx.expected.groups.find((g: any) => g.group === 'spec').keys[0])
  check(!!stringKey && actualOrder.indexOf(stringKey) >= 0 && actualOrder.indexOf(stringKey) < actualOrder.indexOf(specFirst),
    failText('AC7·带字符串式 wayfinder:map 标签的票（#' + stringKey + '）排进探索地图组（修掉「行画成地图却排在普通票堆里」的老矛盾）',
      '排进 ' + mapGroup.label + ' 组（在规格组 #' + specFirst + ' 之前）',
      '实际顺序：' + actualOrder.join('、')))
  const rc = rowCase('stringLabelMap')
  const issue = issueByNumber[String(rc.issueKey)]
  const html = renderRow(makeListSt([issue], [mapByNumber[String(rc.containerKey)]]), issue, null)
  check(html.indexOf('dsws-chip-container') >= 0 && html.indexOf('border-left:3px solid #c084fc') >= 0,
    'AC7·同一张字符串式标签的票在列表里画的就是探索地图行（容器角标 + 紫色色条）')
}

// ============ AC8：容器判据只剩一处真源，且老门禁断言的那行拼接仍在 ============
{
  const listSrc = sourceText('src/client/views/ListTab.ts')
  const rowSrc = sourceText('src/client/views/ListTabRow.ts')
  const detailSrc = sourceText('src/client/views/MapDetail.ts')
  const topSrc = sourceText('src/client/views/MapDetailTop.ts')
  const headSrc = sourceText('src/client/views/MapDetailHead.ts')
  const barSrc = sourceText('src/client/views/DetailActionBar.ts')

  check(typeof cv.containerKindOf === 'function',
    'AC8a 容器种类的唯一真源 container-view.ts 导出 containerKindOf（实际：' + typeof cv.containerKindOf + '）')
  const bucketCall = /const\s+containerKindOfSafe[^=]*=\s*\(typeof containerKindOf === 'function'\)\s*\?\s*containerKindOf/.test(listSrc)
  check(bucketCall,
    'AC8b ListTab.ts 分桶用的是内核 containerKindOf（先问在不在，不在才退回同口径兜底）；判据本身只有内核一处，本文件不维护第二份（实际：' + (bucketCall ? '是' : '没找到这种写法') + '）')
  const bucketLoops = listSrc.indexOf('containerKindOfSafe(x)') >= 0
  check(bucketLoops,
    'AC8c ListTab.ts 每张票都过 containerKindOfSafe 分桶（实际：' + (bucketLoops ? '找得到 containerKindOfSafe(x)' : '没找到 containerKindOfSafe(x)') + '）')
  check(rowSrc.indexOf('typeof containerKindOf') >= 0 && rowSrc.indexOf('typeof CONTAINER_ACCENT') >= 0,
    'AC8d 行渲染 ListTabRow.ts 的种类与身份色也取自内核 container-view.ts（不是自己写一份颜色表）')
  check(detailSrc.indexOf('containerKindOf(m)') >= 0 && detailSrc.indexOf('containerTriState(cKind') >= 0,
    'AC8e 详情页 MapDetail.ts 的种类与三态取自内核 container-view.ts')
  check(topSrc.indexOf('CONTAINER_CHIP_CLASS[cKind]') >= 0 && topSrc.indexOf('containerPromptText(st,') >= 0,
    'AC8f 顶栏 MapDetailTop.ts 的角标样式与提示词取自内核 container-view.ts')
  check(headSrc.indexOf('containerCountKey(cKind)') >= 0 && headSrc.indexOf('CONTAINER_ACCENT[cKind]') >= 0,
    'AC8g 详情页头部 MapDetailHead.ts 的计数键与身份色取自内核 container-view.ts')
  check(barSrc.indexOf('containerTriState(cKind') >= 0 && barSrc.indexOf('containerPromptText(st,') >= 0,
    'AC8h 底部动作条 DetailActionBar.ts 的按钮三态与提示词取自内核 container-view.ts')
  // 另一条老门禁 tests/verify-1286-list.ts 按字面断言这一行，本次改动不能把它挤掉。
  check(listSrc.indexOf('sortedMaps.concat(sortedSpecs).concat(sortedOpen)') >= 0,
    'AC8i ListTab.ts 仍保留 sortedMaps.concat(sortedSpecs).concat(sortedOpen) 这行拼接（老门禁按字面断言它）')

  // 行为级反证：把全局的 containerKindOf 换成一个只会把 #1999 判成地图的桩，
  // 分桶必须跟着变（如果 ListTab.ts 自己另判一份，1999 会留在普通票堆里，这条就红）。
  const realKindOf = G.containerKindOf
  try {
    G.containerKindOf = (x: any) => (x && x.number === 1999) ? 'map' : null
    const stubMapIssue = issueOf({ number: 1999, key: '1999', title: 'STUB-MAP', type: 'task', labels: [], updatedAt: '2026-10-20T00:00:00.000Z' })
    const stubPlainIssue = issueOf({ number: 1998, key: '1998', title: 'STUB-PLAIN', type: 'task', labels: [], updatedAt: '2026-10-20T01:00:00.000Z' })
    const stubContainer = containerOf({ number: 1999, key: '1999', title: 'STUB-MAP', type: 'map', stats: { total: 1, closed: 0 } })
    const st = makeListSt([stubPlainIssue, stubMapIssue], [stubContainer])
    const html = withQuietReact(() => renderToStaticMarkup(React.createElement(listMod.ListTab, { st: st, narrow: false })))
    const order = rowOrder(html)
    check(order.indexOf('1999') >= 0 && order.indexOf('1999') < order.indexOf('1998'),
      failText('AC8j 分桶真的在问内核 containerKindOf（把真源换成桩，#1999 立刻被分进探索地图组，排在更新的普通票 #1998 之前）', '#1999 在 #1998 之前', '实际顺序：' + order.join('、')))
  } finally {
    G.containerKindOf = realKindOf
  }

  // AC8k：兜底路径与内核同口径。把 containerKindOf 从作用域里拿掉（单文件求值时的真实处境，
  //   例如 ts-hook 只加载这一个文件），同一份 fixture 画出来的行顺序必须与走内核时一模一样；
  //   两条路各判一份、将来漂移，这条就红。
  const kindForFallback = G.containerKindOf
  let fallbackOrder: string[] = []
  try {
    G.containerKindOf = undefined
    const poolFb: any[] = []
    const seenFb: any = {}
    for (const num of listFx.inputOrder) {
      const x = issueByNumber[String(num)]
      if (!x || seenFb[String(num)]) continue
      seenFb[String(num)] = true
      poolFb.push(x)
    }
    const stFb = makeListSt(poolFb, listFx.maps.map((m: any) => containerOf(m)))
    const htmlFb = withQuietReact(() => renderToStaticMarkup(React.createElement(listMod.ListTab, { st: stFb, narrow: false })))
    fallbackOrder = rowOrder(htmlFb)
  } finally {
    G.containerKindOf = kindForFallback
  }
  check(fallbackOrder.join(',') === actualOrder.join(','),
    failText('AC8k 内核判定不在作用域时退回文件内同口径兜底，同一份 fixture 的行顺序与走内核时完全一致（兜底只是降级路径，不许漂移成第二份判据）',
      '与走内核时一致：' + actualOrder.join('、'), '兜底路顺序：' + fallbackOrder.join('、')))
}

// ============ 回归：规格与探索地图的「行级动作 / 新会话」取容器三态提示词（#1286 收口） ============
{
  const specEmpty = containerOf({ number: 9001, key: '9001', title: '规格-空', type: 'spec', labels: [{ name: 'ready-for-agent' }], state: 'OPEN', stats: statsOf(0, 0), tickets: [] })
  const specOpen = containerOf({ number: 9002, key: '9002', title: '规格-进行中', type: 'spec', labels: [{ name: 'ready-for-agent' }], state: 'OPEN', stats: statsOf(2, 0), tickets: [] })
  const specDone = containerOf({ number: 9003, key: '9003', title: '规格-收尾', type: 'spec', labels: [{ name: 'ready-for-agent' }], state: 'OPEN', stats: statsOf(2, 2), tickets: [] })
  const mapOpen = containerOf({ number: 9004, key: '9004', title: '地图-进行中', type: 'map', labels: ['wayfinder:map'], state: 'OPEN', stats: statsOf(1, 0), tickets: [] })
  const stC: any = { snapshot: { issues: [], maps: [specEmpty, specOpen, specDone, mapOpen], generatedMs: '2026-10-20T00:00:00.000Z' }, tab: 'list' }
  check(ra.rowActionText(stC, specEmpty) === 'FOR:specSplit',
    failText('回归 A：规格还没拆实施票时，行级动作（含新会话）取拆票提示词 /to-tickets', 'FOR:specSplit', ra.rowActionText(stC, specEmpty)))
  check(ra.rowActionText(stC, specOpen) === 'FOR:specExecute',
    failText('回归 B：规格有未关实施票时，行级动作（含新会话）取规格执行提示词 /implement-spec，不再落成实施票的 /implement', 'FOR:specExecute', ra.rowActionText(stC, specOpen)))
  check(ra.rowActionText(stC, specDone) === 'FOR:specComplete',
    failText('回归 C：规格全关时取规格完成提示词', 'FOR:specComplete', ra.rowActionText(stC, specDone)))
  check(ra.rowActionText(stC, specOpen).indexOf('TPL:implement') < 0,
    failText('回归 D：规格行级动作不会取实施票模板 tpl.implement', '不含 TPL:implement', ra.rowActionText(stC, specOpen)))
  check(ra.rowActionText(stC, mapOpen) === 'START:9004',
    failText('回归 E：探索地图行级动作仍走推进式提示词（startText），没有被容器分流改坏', 'START:9004', ra.rowActionText(stC, mapOpen)))
  // 行内按钮：文字、底色与注入文本都按三态；点下去注入的必须是那一条容器提示词。
  created.length = 0
  injected.length = 0
  ra.mkRowAction(stC, specOpen, false, {})
  const specBtn = created.find((el: any) => !!el && !!el.props && typeof el.props.onClick === 'function' && String(el.props.className || '').indexOf('dsws-btn primary') >= 0)
  check(!!specBtn && elText(specBtn.props.children).indexOf(trFn('act.execute')) >= 0,
    failText('回归 F：规格行内主按钮的文字是「执行」三态文案，不是「实施」', trFn('act.execute'), specBtn ? elText(specBtn.props.children) : '（没建出按钮）'))
  if (specBtn) specBtn.props.onClick({ stopPropagation: () => {} })
  check(injected[0] === 'FOR:specExecute',
    failText('回归 G：规格行内主按钮注入规格执行提示词', 'FOR:specExecute', injected[0]))
}

console.log('')
console.log(failures === 0 ? ('#1295 双轨面板门禁全部通过（共 ' + total + ' 条断言）') : ('#1295 双轨面板门禁失败 ' + failures + ' / 共 ' + total + ' 条断言'))
process.exit(failures > 0 ? 1 : 0)
