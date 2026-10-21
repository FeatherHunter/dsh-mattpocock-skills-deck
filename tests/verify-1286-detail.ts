// tests/verify-1286-detail.ts —— #1286 门禁：详情页第二种容器「规格（实施地图）」
// https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1286
// 门禁归属: src/client/views/MapDetail.ts, src/client/views/MapDetailTop.ts, src/client/views/MapDetailHead.ts, src/client/views/DetailActionBar.ts, src/client/views/MapDetailSpecBody.ts
// 判据（都是用户在详情页一眼能看出来的差别）：
// 1. 两类容器共用同一套详情页骨架：分段进度条、漏斗分层、仪式环、票列表，两类都在。
// 2. 身份：探索地图角标写「地图」、编号徽章紫 #c084fc；规格角标写「规格」、编号徽章贵族蓝 #1D4ED8。
// 3. 计数句：探索地图「本图 N 张子票（已关闭 M 张）」；规格「本规格 N 张实施票（已关闭 M 张）」。
// 4. 三态按钮：探索地图 检查/执行/完成（橙 #f59e0b / 紫 #c084fc / 绿 #3fb950）；
//    规格 拆票/执行/完成（橙 #f59e0b / 蓝 #1D4ED8 / 绿 #3fb950）。
// 5. 新会话按钮与主按钮永远同色实心（两枚按钮不是一个颜色）。
// 6. 点主按钮注入什么：地图是 检查/推进/收尾三段；规格空态注入 specSplit、开态注入 specExecute、
//    收尾注入 specComplete（#1281 起三条各自独立，不再复用地图的 completePrompt）。
//    注入文本的具体措辞归 #1281，本门禁只断「选了哪一条」。
// 7. 规格页不画探索地图那五节正文（Destination / Notes / Decisions / Fog / Out of scope），
//    画自己的七节（问题陈述 / 解决方案 / 用户故事 / 实现决策 / 测试决策 / 不在范围内 / 补充说明）。
// 8. 被阻塞统一红 #f87171（详情页源码里不再有橙色 #f0883e）。
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1286-detail.ts
// 做法：真组件静态渲染（react-dom/server），只把渲染之外的外部依赖换成假实现；
//   容器身份、取色与三态走真实现 src/client/kernel/container-view.ts（唯一真源），不另造一份——
//   门禁自己另写一份判定，就等于允许两边各判各的，那正是这张票要消灭的问题。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { sourceText } from './lib/source-text.ts'

let failures = 0
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

// ---- 词表：只把断言要看的几个键译成中文，其余键原样返回 ----
//   「拆票/执行/完成/检查」只可能出现在按钮标签上，不会被提示文案里的字带偏。
//   探索地图那五节的键（map.notesCap 之类）故意不译：译了就没法用「这段在不在页面上」断它。
const trDict: Record<string, string> = {
  'list.specChip': '规格',
  'list.mapChip': '地图',
  'act.split': '拆票',
  'act.execute': '执行',
  'act.done': '完成',
  'act.inspect': '检查',
  'list.newSessionLabel': '新会话',
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
  // #1294：规格正文那七节的段名从写死数据搬进了 config/copy/spec.yaml（spec.section.*），
  //   MapDetailSpecBody 只问 tr/uiText；这里的词表替身要按真源把七条补上，否则 A10 会
  //   因为「取不到词条」把七节标题画成键名。键名以 config/copy/spec.yaml 为准。
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

const G: any = globalThis
G.React = React
G.tr = trFn
G.emit = () => {}
G.Ic = (props: any) => '[icon:' + ((props && props.n) || '?') + ']'
G.Tip = (props: any) => React.createElement('span', { 'data-tip': String(props.content) }, props.children)
G.COPY_FLASH_MS = 1300
G.mdToHtml = (s: any) => React.createElement('div', null, String(s == null ? '' : s))
G.copyText = async () => true
G.mkRowAction = () => React.createElement('button', { className: 'dsws-btn primary' }, '主动作')
G.actionColorOf = () => '#7aa2f7'
G.buildColorOf = () => () => '#7aa2f7'
G.TypeChip = () => null
G.useIssueDetailFold = () => null
G.tProgressBar = () => null
G.tStatusBadge = () => null
G.blockerNames = () => '阻塞者'
G.host = { call: () => Promise.resolve({ ok: true }) }

// 注入的提示词：记下来，门禁要断「点主按钮注入的是哪一条」。
const injected: string[] = []
G.inject = (st: any, text: any) => { injected.push(String(text)) }

// 提示词生成器：这里给的是带标记的假实现，门禁只断「选了哪一条模板/命令」，
// 措辞归 #1281/#1282。标记各不相同，是为了能认出「代码走的是兜底老路」而不是真源。
G.renderTemplate = (id: any, values: any) => 'TPL:' + String(id) + ':' + String(values && values.number)
G.completePrompt = (st: any, num: any, title: any, total: any, closed: any) => 'COMPLETE:' + String(num) + ':' + String(total) + '/' + String(closed)
G.inspectPrompt = (st: any, num: any, title: any) => 'INSPECT:' + String(num)
G.startText = (st: any, t: any) => 'START:' + String(t && t.number)
G.promptTextFor = (st: any, id: any, values: any) => 'FOR:' + String(id)

// 身份与链接走真实现（手写的假实现一旦与真实现不一致，门禁就测了个假环境）
const identityMod = await import('../src/tracker/kernel/identity-keys.js')
const linkMod = await import('../src/client/kernel/link.js')
const { DswsCtx, createCx } = await import('../src/client/kernel/ctx.js')
// 容器身份、取色、三态走唯一真源
const cv: any = await import('../src/client/kernel/container-view.js')

G.issueUrlFor = linkMod.issueUrlFor
G.effortOf = identityMod.effortOf
G.idOf = identityMod.idOf
G.idOfParts = identityMod.idOfParts
G.effortNamesOf = () => ['default']
G.findMapByIdentity = () => null
G.pushNav = () => {}
G.popNav = () => {}
G.openInNewSession = () => {}
// 字色深浅：走真实现（src/client/kernel/store-derived.ts）；万一它导入失败，退回同口径的假实现。
let isLightHexImpl: any = (c: any) => ['#3fb950', '#f59e0b', '#c084fc'].indexOf(String(c)) >= 0
try {
  const sd: any = await import('../src/client/kernel/store-derived.js')
  if (sd && typeof sd.isLightHex === 'function') isLightHexImpl = sd.isLightHex
} catch (e) { /* 用上面的假实现 */ }
G.isLightHex = isLightHexImpl

// 容器真源挂到全局量上（视图里那些跨叶子调用的名字运行时都从 globalThis 找）
G.containerKindOf = cv.containerKindOf
G.containerStateOf = cv.containerStateOf
G.containerTriState = cv.containerTriState
G.containerPromptText = cv.containerPromptText
G.containerCountKey = cv.containerCountKey
G.CONTAINER_ACCENT = cv.CONTAINER_ACCENT
// #1343：容器三态的两枚固定色也从中央色表取；视图单独求值时这两个全局量缺不得。
G.CONTAINER_EMPTY_COLOR = cv.CONTAINER_EMPTY_COLOR
G.CONTAINER_DONE_COLOR = cv.CONTAINER_DONE_COLOR
G.CONTAINER_CHIP_CLASS = cv.CONTAINER_CHIP_CLASS
G.CONTAINER_CHIP_LABEL_KEY = cv.CONTAINER_CHIP_LABEL_KEY

// 动态导入必须在全局量齐备之后
const { MapDetail } = await import('../src/client/views/MapDetail.js')
const headMod = await import('../src/client/views/MapDetailHead.js')
const topMod = await import('../src/client/views/MapDetailTop.js')
const barMod = await import('../src/client/views/DetailActionBar.js')
const specMod = await import('../src/client/views/MapDetailSpecBody.js')
G.DswsCtx = DswsCtx
G.MapDetailHead = headMod.MapDetailHead
G.MapDetailTop = topMod.MapDetailTop
G.DetailActionBar = barMod.DetailActionBar
G.MapDetailSpecBody = specMod.MapDetailSpecBody

const services: any = {
  slots: { register: () => () => {}, inject: (name: string, fn: any) => { try { fn() } catch (e) {} } },
  locale: { register: () => () => {}, bind: () => trFn },
  timer: { timeout: (fn: any, ms: number) => setTimeout(fn, ms) },
}
const fakeStore: any = { snapshot: null, sessionId: 'test', tab: 'list', cwd: 'D:\\ws', issuePath: { current: null, nodes: [] }, noRepoCard: { expanded: false } }
function makeCx(h: any) {
  return createCx({
    ctx: { get: (k: string) => services[k], effect: (fn: any) => { const r = fn(); return typeof r === 'function' ? r : () => {} }, inject: (deps: any, cb: any) => { cb({ get: (k: string) => services[k] }); return { dispose: () => {} } } },
    h,
    rdom: {},
    storeSvc: { shared: fakeStore, stores: {}, makeStore: () => fakeStore, storeOf: () => fakeStore, emit: () => {}, sub: () => () => {}, useStore: () => fakeStore },
    localeSvc: services.locale,
    timer: services.timer,
    api: { call: async () => ({ ok: true }), inject: () => {}, copyText: async () => {} },
    router: { open: () => {}, toggle: () => {} },
  })
}

// 记下渲染过程中建出来的元素：点按钮那一下要拿到真的 onClick（静态渲染不挂事件）。
const created: any[] = []
function recH(type: any, props: any, ...children: any[]) {
  const el = React.createElement(type, props, ...children)
  created.push(el)
  return el
}

function ticketOf(n: number, over?: any) {
  return Object.assign({ number: n, key: String(n), effortId: 'default', title: '子票' + n, state: 'OPEN', blockedBy: [], labels: [], type: 'task', level: 0 }, over || {})
}
function statsOf(total: number, closed: number) {
  return { levels: [{ open: total - closed, closed: closed, total: total }], total: total, closed: closed }
}
function mapContainer(tickets: any[], stats: any) {
  return { number: 1228, key: '1228', effortId: 'default', title: '探索地图', state: 'OPEN', labels: [{ name: 'wayfinder:map' }], type: 'map', tickets, stats, decisions: [], fog: [], outOfScope: [], destination: '地图目的地', notes: '地图备注' }
}
function specContainer(tickets: any[], stats: any) {
  const sections = [
    { body: '问题正文' }, { body: '方案正文' }, { body: '故事正文' },
    { body: '实现决策正文' }, { body: '测试决策正文' }, { body: '范围外正文' }, { body: '补充正文' },
  ]
  return { number: 1290, key: '1290', effortId: 'default', title: '实施规格', state: 'OPEN', labels: [], type: 'spec', tickets, stats, sections, destination: 'SPEC-DEST', notes: 'SPEC-NOTES' }
}
function renderContainer(m: any): string {
  created.length = 0
  const st: any = { snapshot: { issues: [], maps: [] }, mapTickets: null, reveal: {}, copyFlash: null, cwd: 'D:\\ws' }
  const g: any = { m }
  return renderToStaticMarkup(React.createElement(DswsCtx.Provider, { value: makeCx(recH) },
    React.createElement(MapDetail, { st, g, drill: false })))
}
// 顶栏主按钮（第一枚）与新会话按钮各自那一段 html
function buttonHtml(html: string, marker: string): string {
  const i = html.indexOf(marker)
  if (i < 0) return ''
  const s = html.lastIndexOf('<button', i)
  const e = html.indexOf('</button>', i)
  if (s < 0 || e < 0) return ''
  return html.slice(s, e)
}
function bgOf(btn: string): string {
  const m = btn.match(/background:\s*([^;"]+)/)
  return m ? m[1] : ''
}
function badgeHtml(html: string): string {
  const i = html.indexOf('dsws-idnum')
  if (i < 0) return ''
  return html.slice(i, html.indexOf('</span>', i))
}
// 点顶栏主按钮（静态渲染不挂事件，这里直接调它的 onClick），返回注入的提示词
function clickPrimary(): string {
  injected.length = 0
  // 顶栏主按钮是「带 data-detail-primary-text 标记的那枚 primary 按钮」。
  //   不能只按 className 挑第一枚：子票行里也有 primary 按钮（行内「新会话」），
  //   而 MapDetail 在拼 children 时就把行按钮建出来了（先于顶栏渲染），
  //   按 className 取第一枚会点到子票行的按钮上去。
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

const OPEN2 = [ticketOf(1), ticketOf(2)]
const DONE2 = [ticketOf(1), ticketOf(2)]

// ---- A 组：规格（实施地图）详情页 ----
{
  const html = renderContainer(specContainer([], statsOf(0, 0)))
  check(html.includes('dsws-chip dsws-chip-s') && html.includes('data-full="规格"'), 'A1 规格页顶栏角标写「规格」（探索地图写「地图」）')
  check(/color:\s*#1D4ED8/i.test(badgeHtml(html)), 'A2 规格页编号徽章是贵族蓝 #1D4ED8')
  const htmlOpen = renderContainer(specContainer(OPEN2, statsOf(2, 1)))
  check(htmlOpen.includes('本规格 2 张实施票（已关闭 1 张）'), 'A3 规格页计数句是「本规格 N 张实施票（已关闭 M 张）」')
  const btnEmpty = buttonHtml(html, 'data-detail-primary-text')
  check(btnEmpty.includes('拆票') && bgOf(btnEmpty) === '#f59e0b', 'A4 规格空态主按钮是「拆票」橙底 #f59e0b')
  const btnOpen = buttonHtml(htmlOpen, 'data-detail-primary-text')
  check(btnOpen.includes('执行') && bgOf(btnOpen) === '#1D4ED8', 'A5 规格有未关时主按钮是「执行」蓝底 #1D4ED8')
  const htmlDone = renderContainer(specContainer(DONE2, statsOf(2, 2)))
  const btnDone = buttonHtml(htmlDone, 'data-detail-primary-text')
  check(btnDone.includes('完成') && bgOf(btnDone) === '#3fb950', 'A6 规格全关时主按钮是「完成」绿底 #3fb950')
  const newBtn = buttonHtml(htmlOpen, 'data-detail-new-text')
  check(!!newBtn && bgOf(newBtn) === bgOf(btnOpen) && bgOf(newBtn) !== '', 'A7 规格页新会话按钮与主按钮同色实心（都是 ' + bgOf(newBtn) + '）')
  check(htmlOpen.includes('dsws-layerbox') && htmlOpen.includes('dsws-dest'), 'A8 规格页保留漏斗分层与仪式环（骨架共用）')
  check(!htmlOpen.includes('map.notesCap') && !htmlOpen.includes('map.decisions') && !htmlOpen.includes('map.fog') && !htmlOpen.includes('map.outOfScope') && !htmlOpen.includes('SPEC-DEST'),
    'A9 规格页不画探索地图那五节正文（Destination / Notes / Decisions / Fog / Out of scope）')
  const seven = ['问题陈述', '解决方案', '用户故事', '实现决策', '测试决策', '不在范围内', '补充说明']
  check(seven.every((t) => htmlOpen.includes(t)), 'A10 规格页画自己的七节（' + seven.join(' / ') + '）')
  // 点主按钮注入什么
  renderContainer(specContainer([], statsOf(0, 0)))
  check(clickPrimary() === 'FOR:specSplit', 'A11 规格空态点主按钮注入 specSplit 模板')
  renderContainer(specContainer(OPEN2, statsOf(2, 1)))
  // 规格的「执行」注入 specExecute 模板（正文首行是 /implement-spec），不走通用执行模板——
  // 那个模板正文首行是 /wayfinder（探索地图的路子），用在规格上不对。
  check(clickPrimary() === 'FOR:specExecute', 'A12 规格有未关时点主按钮注入 specExecute 模板（不走通用执行模板）')
  renderContainer(specContainer(DONE2, statsOf(2, 2)))
  check(clickPrimary() === 'FOR:specComplete', 'A13 规格全关时点主按钮注入 specComplete 收口模板')
}

// ---- B 组：探索地图详情页（回归：颜色与文案一字不动） ----
{
  const html = renderContainer(mapContainer([], statsOf(0, 0)))
  check(html.includes('dsws-chip dsws-chip-m') && html.includes('data-full="地图"'), 'B1 地图页顶栏角标写「地图」')
  check(/color:\s*#c084fc/i.test(badgeHtml(html)), 'B2 地图页编号徽章是探索紫 #c084fc')
  const htmlOpen = renderContainer(mapContainer(OPEN2, statsOf(2, 1)))
  check(htmlOpen.includes('本图 2 张子票（已关闭 1 张）'), 'B3 地图页计数句是「本图 N 张子票（已关闭 M 张）」')
  const btnEmpty = buttonHtml(html, 'data-detail-primary-text')
  check(btnEmpty.includes('检查') && bgOf(btnEmpty) === '#f59e0b', 'B4 地图空态主按钮是「检查」橙底 #f59e0b')
  const btnOpen = buttonHtml(htmlOpen, 'data-detail-primary-text')
  check(btnOpen.includes('执行') && bgOf(btnOpen) === '#c084fc', 'B5 地图有未关时主按钮是「执行」紫底 #c084fc')
  const htmlDone = renderContainer(mapContainer(DONE2, statsOf(2, 2)))
  const btnDone = buttonHtml(htmlDone, 'data-detail-primary-text')
  check(btnDone.includes('完成') && bgOf(btnDone) === '#3fb950', 'B6 地图全关时主按钮是「完成」绿底 #3fb950')
  const newBtn = buttonHtml(htmlOpen, 'data-detail-new-text')
  check(!!newBtn && bgOf(newBtn) === bgOf(btnOpen) && bgOf(newBtn) !== '', 'B7 地图页新会话按钮与主按钮同色实心（都是 ' + bgOf(newBtn) + '）')
  check(htmlOpen.includes('地图目的地') && htmlOpen.includes('map.notesCap') && htmlOpen.includes('map.decisions') && htmlOpen.includes('map.fog') && htmlOpen.includes('map.outOfScope'),
    'B8 地图页那五节正文照旧画着')
  renderContainer(mapContainer([], statsOf(0, 0)))
  check(clickPrimary() === 'INSPECT:1228', 'B9 地图空态点主按钮注入检查提示词')
  renderContainer(mapContainer(OPEN2, statsOf(2, 1)))
  check(clickPrimary() === 'START:1228', 'B10 地图有未关时点主按钮注入推进提示词')
  renderContainer(mapContainer(DONE2, statsOf(2, 2)))
  check(clickPrimary() === 'COMPLETE:1228:2/2', 'B11 地图全关时点主按钮注入收尾提示词')
}

// ---- C 组：被阻塞统一红 #f87171 ----
{
  const blocker = ticketOf(1, { title: '阻塞者' })
  const blocked = ticketOf(2, { blockedBy: [1], title: '被阻塞的票' })
  const html = renderContainer(mapContainer([blocker, blocked], statsOf(2, 0)))
  check(html.includes('#f87171'), 'C1 被阻塞的子票在详情页是红 #f87171')
  check(!html.includes('#f0883e'), 'C2 详情页里不再出现橙色 #f0883e')
  const detailSrc = sourceText('src/client/views/MapDetail.ts')
  const rowSrc = sourceText('src/client/views/TicketRow.js')
  check(!detailSrc.includes('#f0883e') && !rowSrc.includes('#f0883e'), 'C3 详情页与子票行源码里都没有橙色被阻塞 #f0883e')
}

// ---- D 组：骨架共用（不因容器种类分叉） ----
{
  const specHtml = renderContainer(specContainer(OPEN2, statsOf(2, 1)))
  const mapHtml = renderContainer(mapContainer(OPEN2, statsOf(2, 1)))
  for (const cls of ['dsws-layers', 'dsws-layerbox', 'dsws-dest', 'dsws-node']) {
    check(specHtml.includes(cls) && mapHtml.includes(cls), 'D1 两类容器详情页都有 ' + cls + '（骨架共用）')
  }
}

console.log(failures ? `\n#1286 详情页门禁失败 ${failures} 项（共 ${total} 条）` : `\n#1286 详情页门禁全部通过（共 ${total} 条）`)
process.exit(failures ? 1 : 0)
