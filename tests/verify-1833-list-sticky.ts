// tests/verify-1833-list-sticky.ts —— 列表头部吸顶门禁（#1833 第二步）
// 门禁归属: src/client/views/ListTab.ts
// 门禁归属: src/client/views/listFilterRow.ts
// 门禁归属: src/client/views/mdEffortRow.ts
// 门禁归属: src/client/kernel/styles.ts
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1833-list-sticky.ts
//
// 这张票第二步要保的是「列表滚动时哪几行停在顶部、哪几行跟着滚」：
//   一、真渲染列表页（ListTab）：已选标签过滤条、统计行、多目录签、筛选行整块挂在
//       div.dsws-stickybar[data-list-sticky="1"] 下面，是列表树的头一个孩子；统计行仍在筛选行之前。
//   二、不该吸顶的仍留在滚动区：历史票翻页行、重试/暂停等状态句、列表行、加载遮罩都不在吸顶块内。
//   三、吸顶块四种形态都画得出来：健康态、有已选标签、多目录、暂停态（状态句仍在滚动区）。
//   四、样式真源：类名仍指向 styles.ts 里那条 position:sticky 规则，不是另起一套。
//
// 为什么用真渲染：这张票改的是「画在哪个容器里」，扫源码只能钉写法、等价重构就假红
// （先例 tests/verify-1295-dual-panel.ts、tests/verify-rest-fallback-banner.ts）。
const path = require('node:path')
const fs = require('node:fs')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { JSDOM } = require('jsdom')
const { printGateResult } = require('./lib/gate-result.ts')

const ROOT = path.join(__dirname, '..')
const GATE = 'verify-1833-list-sticky'
let total = 0
let failed = 0
const check = function (cond: any, msg: string) {
  total += 1
  if (cond) console.log('PASS ' + msg)
  else { failed += 1; console.log('FAIL ' + msg) }
  return !!cond
}
const read = function (rel: string) { return fs.readFileSync(path.join(ROOT, rel), 'utf8') }
const countOf = function (text: any, needle: string) { return String(text).split(needle).length - 1 }

// 文案取真词表（渲染用中文那份即可；本门禁断言的是结构，不是句子）。
const trDict: any = {
  'list.filterActive': '已选标签',
  'list.filterClear': '清除',
  'list.filterRemoveAria': '去掉 {name} 过滤',
  'list.kpi.takeable': '可接',
  'list.kpi.occupied': '占用',
  'list.kpi.closed': '已关闭',
  'list.healthCheck': '体检',
  'list.healthCheckTitle': '体检说明',
  'truth.paused': '自动刷新已暂停',
  'list.loading': '加载中',
  'list.errFull': '刷新失败：{err}',
  'list.none': '没有票',
  'list.closedN': '已关闭 {n}（已加载 {x}）',
  'list.state.all': '全部', 'list.state.open': '未关闭', 'list.state.closed': '已关闭',
  'list.state.blocked': '阻塞', 'list.state.frontier': '可接',
  'list.sort.updatedAt': '更新', 'list.sort.createdAt': '创建', 'list.sort.number': '编号', 'list.sort.title': '标题',
  'list.all': '全部标签', 'list.effortsTitle': '全部工作单元：{names}', 'list.reduceTags': '收起标签',
  'notice.budget': '额度',
}
const tr = function (key: any, params?: any) {
  let text = Object.prototype.hasOwnProperty.call(trDict, key) ? trDict[key] : String(key)
  if (params && typeof params === 'object') Object.keys(params).forEach(function (k) { text = text.split('{' + k + '}').join(String(params[k])) })
  return text
}

// ---- 假世界：ListTab 与两个绘制模块的真实实现靠这些全局名拿到依赖 ----
const G: any = globalThis
G.React = React
G.tr = tr
G.emit = () => {}
G.Ic = (props: any) => '[icon:' + ((props && props.n) || '?') + ']'
G.Tip = (props: any) => React.createElement('span', { 'data-tip': String(props && props.content) }, props && props.children)
G.chipProps = (props: any) => props
G.darken = () => 'rgba(0,0,0,.6)'
G.hexA = () => 'rgba(0,0,0,.16)'
G.labelClicks = {}
G.listPrefs = {}
G.COPY_FLASH_MS = 1300
G.saveLabelClicks = () => {}
G.saveListPrefs = () => {}
G.liquidInkRemember = () => {}
G.useLiquidInk = () => null
G.FallbackMark = () => null
G.RefreshFailMark = () => null
G.listIssueRow = (h: any) => h('div', { 'data-gate-issue-row': '1' }, 'row')
G.closedPagesNode = (h: any) => h('div', { 'data-gate-closed-pages': '1' }, 'pager')
G.listSkeletonNode = () => null
G.getCachedSnapshot = () => null
G.loadIssuePage = () => {}
G.useClosedPageScroll = () => {}
G.healthCheckVisible = () => false
G.healthCheckCountOf = () => 0
G.deckCountsOf = () => null
G.kpiCountsOf = () => null
G.openIssuesOf = (st: any) => ((st && st.snapshot && st.snapshot.issues) || [])
G.isOccupied = () => false
G.mapBlockOf = () => ({})
G.applyStandaloneBlocks = () => {}
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
G.actionColorOf = () => '#c084fc'
G.isLightHex = () => false
G.mkRowAction = () => null
G.authorColor = () => '#7aa2f7'
G.containerKindOf = () => 'issue'
G.containerStateOf = () => null
G.containerTriState = () => null
G.containerNumberColor = () => ''
G.containerTitleKey = () => ''
G.containerPromptText = () => ''
G.CONTAINER_ACCENT = ''
G.CONTAINER_TINT = ''
G.CONTAINER_EMPTY_COLOR = ''
G.CONTAINER_DONE_COLOR = ''
G.CONTAINER_CHIP_CLASS = 'dsws-chip-container'
G.CONTAINER_CHIP_LABEL_KEY = 'list.mapChip'
G.CONTAINER_CHIP_MARKER_CLASS = 'dsws-chip-container'
// 暂停判据要的宿主额度档位接口：这一趟不测额度，给恒不暂停的兜底。
G.lagPromiseFor = () => ({ paused: false })
G.tierFor = () => null

const withQuietReact = function (fn: any) {
  const realConsoleError = console.error
  console.error = function () {
    const msg = String((arguments && arguments[0]) || '')
    if (msg.indexOf('unique "key" prop') >= 0) return
    realConsoleError.apply(console, arguments as any)
  }
  try { return fn() } finally { console.error = realConsoleError }
}
const q = function (html: string) { return new JSDOM('<!doctype html><html><body>' + html + '</body></html>').window.document }

;(async function () {
  const identityMod: any = await import('../src/tracker/kernel/identity-keys.js')
  const linkMod: any = await import('../src/client/kernel/link.js')
  const { DswsCtx } = await import('../src/client/kernel/ctx.js')
  G.DswsCtx = DswsCtx
  G.idOf = identityMod.idOf
  G.effortOf = identityMod.effortOf
  G.issueUrlFor = linkMod.issueUrlFor
  G.openModeFor = linkMod.openModeFor
  G.openTrackerTarget = linkMod.openTrackerTarget
  const truth: any = await import('../src/client/views/shared/truthLines.js')
  G.truthNoticeLines = truth.truthNoticeLines
  const filterRow: any = await import('../src/client/views/listFilterRow.js')
  G.listFilterRowNode = filterRow.listFilterRowNode
  const effortRow: any = await import('../src/client/views/mdEffortRow.js')
  G.mdEffortRowNode = effortRow.mdEffortRowNode
  const effortNamesOf = function () { return ['default', 'ui'] }
  G.effortNamesOf = effortNamesOf
  G.effortOptionNamesOf = effortNamesOf
  const listMod: any = await import('../src/client/views/ListTab.js')

  const snapOf = function (o: any) {
    return Object.assign({ repo: 'acme/demo', issues: [], maps: [], labels: [], generatedMs: '2026-11-02T00:00:00Z' }, o || {})
  }
  const stOf = function (snapExtra: any, stExtra: any) {
    return Object.assign({
      snapshot: snapOf(snapExtra), tab: 'list', stateFilter: 'open', lblFilters: [], effFilters: [],
      sortKey: 'updatedAt', sortDir: 'desc', rowFlash: {}, writeAt: {}, cwd: 'D:\\ws',
      expEfforts: false, expLabels: false, closedFoldOpen: false,
    }, stExtra || {})
  }
  const render = function (st: any) { return withQuietReact(() => renderToStaticMarkup(React.createElement(listMod.ListTab, { st: st, narrow: false }))) }
  const oneIssue = { id: 'I_1', number: 1, title: '一张票', state: 'OPEN', labels: [], updatedAt: '2026-11-01T00:00:00Z', effort: 'default' }
  const stickyOf = function (doc: any) { return doc.querySelector('[data-list-sticky]') }
  const outside = function (doc: any, sticky: any, sel: string) {
    const el: any = doc.querySelector(sel)
    return !!el && !sticky.contains(el)
  }

  // ================= 一、健康态：吸顶块包住四行，位置与顺序对 =================
  {
    const doc = q(render(stOf({ issues: [oneIssue], labels: [{ name: 'needs-triage', color: '#ff0000' }] }, { lblFilters: ['needs-triage'] })))
    const root: any = doc.body.firstElementChild
    const sticky: any = stickyOf(doc)
    check(!!sticky && sticky.tagName === 'DIV', 'A1 列表页出现吸顶容器 div[data-list-sticky]（实际：' + (sticky ? sticky.tagName : '无') + '）')
    check(!!sticky && String(sticky.getAttribute('class') || '').indexOf('dsws-stickybar') >= 0, 'A2 吸顶容器用的就是样式真源那条类名 dsws-stickybar（不另造类名）')
    check(!!sticky && sticky.getAttribute('data-list-sticky') === '1', 'A3 吸顶容器的 data-list-sticky 是 1（门禁与后续调整的挂钩）')
    check(!!root && !!sticky && root.children[0] === sticky, 'A4 吸顶容器是列表树的头一个孩子（在加载/错误/状态句与列表行之前）')
    const kpi: any = doc.querySelector('[data-list-head="kpi"]')
    check(!!kpi && !!sticky && sticky.contains(kpi), 'A5 统计行（data-list-head=kpi）在吸顶容器里面')
    const labelBar: any = doc.querySelector('[data-log^="list.filter.remove."]')
    check(!!labelBar && !!sticky && sticky.contains(labelBar), 'A6 已选标签过滤条在吸顶容器里面（有已选标签时才画）')
    const effort: any = doc.querySelector('[data-dsh-md-effort-row="1"]')
    check(!!effort && !!sticky && sticky.contains(effort), 'A7 多目录签在吸顶容器里面（多工作单元仓库才画）')
    const inkHost: any = doc.querySelector('.dsws-ink-host')
    check(!!inkHost && !!sticky && sticky.contains(inkHost), 'A8 筛选行（三组药丸的 .dsws-ink-host）在吸顶容器里面')
    check(!!kpi && !!inkHost && !!(kpi.compareDocumentPosition(inkHost) & 4), 'A9 吸顶块内部顺序仍是「统计行在筛选行之前」')
    check(outside(doc, sticky, '[data-gate-closed-pages]'), 'A10 历史票翻页行留在滚动区（不在吸顶容器内）')
    check(outside(doc, sticky, '[data-gate-issue-row]'), 'A11 列表行留在滚动区（不在吸顶容器内）')
    check(!doc.querySelector('.dsws-truth'), 'A12 健康态没有状态句可画（这一行不是常驻内容）')
  }
  // ================= 二、暂停态：状态句仍画，但留在滚动区 =================
  {
    const doc = q(render(stOf({ snapshot: undefined, refresh: { paused: true } } as any, {})))
    const sticky: any = stickyOf(doc)
    const truthRow: any = doc.querySelector('.dsws-truth')
    check(!!truthRow, 'B1 宿主报自动刷新暂停时，列表仍画状态句（.dsws-truth）')
    check(!!truthRow && !!sticky && !sticky.contains(truthRow), 'B2 状态句不在吸顶容器内（它说的是当前状态，不是列表头部筛选）')
    check(!!truthRow && String(truthRow.textContent || '').indexOf(tr('truth.paused')) >= 0, 'B3 状态句内容仍是暂停那句（真值来自 truthLines，不在本门禁另造）')
    check(!!sticky && !!doc.querySelector('[data-list-head="kpi"]') && sticky.contains(doc.querySelector('[data-list-head="kpi"]')), 'B4 暂停态下统计行照旧吸顶')
  }
  // ================= 三、加载态：遮罩留在滚动区 =================
  {
    const doc = q(render({ snapshot: null, tab: 'list', stateFilter: 'open', lblFilters: [], effFilters: [], sortKey: 'updatedAt', sortDir: 'desc', rowFlash: {}, writeAt: {}, cwd: 'D:\\ws', expEfforts: false, expLabels: false, closedFoldOpen: false, snapMode: 'loading' }))
    const sticky: any = stickyOf(doc)
    const shade: any = doc.querySelector('.dsws-loading-shade')
    check(!!shade, 'C1 首开无数据时仍画加载遮罩（.dsws-loading-shade）')
    check(!!shade && !!sticky && !sticky.contains(shade), 'C2 加载遮罩不在吸顶容器内（遮罩盖的是滚动区整片）')
    check(!!sticky, 'C3 加载态下吸顶容器仍存在（骨架/列表换了，列表头不跟着消失）')
  }
  // ================= 四、样式真源：类名仍指向 position:sticky =================
  {
    const styles = read('src/client/kernel/styles.ts')
    const rule = /\.dsws-stickybar\{[^}]*position:sticky[^}]*\}/.exec(styles)
    check(!!rule, 'D1 styles.ts 里 .dsws-stickybar 仍是 position:sticky（吸顶样式没有第二份真源）')
    const listTxt = read('src/client/views/ListTab.ts')
    check(countOf(listTxt, "className: 'dsws-stickybar'") === 1 && countOf(listTxt, "'data-list-sticky': '1'") === 1, 'D2 ListTab.ts 只有一处吸顶容器，类名与标记各写一次')
  }

  console.log('verify-1833-list-sticky：共 ' + total + ' 条断言，失败 ' + failed + ' 条')
  printGateResult(GATE, total, failed ? 1 : 0)
  process.exit(failed ? 1 : 0)
})().catch(function (e: any) {
  console.log('FAIL 门禁自身抛错：' + String(e && e.stack ? e.stack : e))
  printGateResult(GATE, total, 1)
  process.exit(1)
})
