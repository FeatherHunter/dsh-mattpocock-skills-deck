// tests/verify-rest-fallback-banner.ts —— 降级提示门禁（#1699 改造：从占行横幅改成头部小标识 + 通知断言）
// 门禁归属: src/client/views/shared/fallbackMark.ts, src/client/views/ListTab.ts, src/client/views/shared/notificationCenter.ts
// 用法: node --import ./scripts/ts-hook.mts tests/verify-rest-fallback-banner.ts
//
// 这张票之前，本文件是一道「降级横幅」门禁：它把 truthLines.ts 拆出来求值、再扫源码与产物里的字符串。
// #1699 把占一行的横幅退役之后，那套断言盯的是一段已经不存在的东西，所以按票面要求整体改成通知断言：
//   一、列表页（真渲染 ListTab）：当前取数降级时，列表头部 KPI 那一行里出现一枚小标识；
//       它是一颗 span、在 data-list-head="kpi" 那一行里面（不新占一行），整页不再有旧横幅的痕迹；
//       说哪一句仍由 truthLines 的 restFallbackView 给（一小时以内说当下、超过一小时改口「上次…」、
//       只有配额原因才提配额），这里断言渲染出来的悬停提示与读屏标签就是那一句。
//   二、通知中心（真渲染 NotificationHistoryPanel）：当前状态只从快照画；历史与当前对不上时按快照说、
//       并补一句「对不上」的说明 —— 负例包括「历史说有未闭合降级、快照说正常」与「快照说降级、历史全闭合」。
//   三、文案与登记：新标签 list.fallbackMark 中英各一份、四句降级句子仍在、旧关闭钮词条已删；
//       旧横幅叶子已删除，构建登记与拼接标记都改成新叶子；新叶子不写会话态、不加定时器。
//
// 为什么改成真渲染：这条需求要保的是「画成什么样、什么时候不画」（先例 tests/verify-1295-dual-panel.ts），
// 扫源码字符串只能钉写法，等价重构就假红；票面也明确要求「不再断源码文本」。
const fs = require('node:fs')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { JSDOM } = require('jsdom')
const { printGateResult } = require('./lib/gate-result.ts')

const ROOT = path.join(__dirname, '..')
const GATE = 'verify-rest-fallback-banner'
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
const yamlValue = function (rel: string, key: string) {
  const re = new RegExp('^  ' + key.replace(/[.]/g, '\\.') + ': ?(.*)$', 'm')
  const m = re.exec(read(rel))
  return m ? String(m[1]).replace(/^"|"$/g, '').trim() : ''
}

const NOW = Date.now()
const MIN = 60000
const HOUR = 3600000
// 界面文案一律从词表取真值（config/copy 是数据，不是源码文本）：渲染用中文那份，断言英文那份也在。
const ZH = {
  'list.fallbackMark': yamlValue('config/copy/pages.yaml', 'list.fallbackMark'),
  'list.restFallbackNonQuota': yamlValue('config/copy/pages.yaml', 'list.restFallbackNonQuota'),
  'list.restFallbackStaleNonQuota': yamlValue('config/copy/pages.yaml', 'list.restFallbackStaleNonQuota'),
  'list.restFallback': yamlValue('config/copy/flow.yaml', 'list.restFallback'),
  'list.restFallbackStale': yamlValue('config/copy/word.yaml', 'list.restFallbackStale'),
}
const trDict: any = {
  'list.fallbackMark': ZH['list.fallbackMark'],
  'list.restFallback': ZH['list.restFallback'],
  'list.restFallbackStale': ZH['list.restFallbackStale'],
  'list.restFallbackNonQuota': ZH['list.restFallbackNonQuota'],
  'list.restFallbackStaleNonQuota': ZH['list.restFallbackStaleNonQuota'],
  'notice.title': '通知中心',
  'notice.current': '当前状态',
  'notice.currentNormal': '正常',
  'notice.currentDegraded': '数据源降级（走 REST 通道）',
  'notice.historyMismatch': '历史与当前对不上：当前状态按快照，历史只读不改写。',
  'notice.filter.all': '全部',
  'notice.type.degradedStart': '数据源降级',
  'notice.type.degradedRecovery': '数据源恢复',
  'notice.type.refreshFailed': '刷新失败',
  'notice.type.writeFailed': '写票失败',
  'notice.type.unknown': '其他通知',
  'notice.event.degradedStart': '数据源降级为 REST 通道',
  'notice.event.degradedRecovery': '数据源已恢复',
  'notice.event.refreshFailed': '刷新失败',
  'notice.event.writeFailed': '写票失败',
  'notice.event.unknown': '通知',
  'notice.times': '发生 {n} 次',
  'notice.time.justNow': '刚刚',
  'notice.time.minutesAgo': '{n} 分钟前',
  'notice.time.hoursAgo': '{n} 小时前',
  'notice.time.daysAgo': '{n} 天前',
  'notice.markAllRead': '全部已读',
  'notice.clearRead': '清除已读标记',
  'notice.close': '关闭',
  'notice.empty': '还没有通知',
  'notice.unreadCount': '未读 {n} 条',
  'notice.read': '已读',
}
const tr = function (key: any, params?: any) {
  let text = Object.prototype.hasOwnProperty.call(trDict, key) ? trDict[key] : String(key)
  if (params && typeof params === 'object') Object.keys(params).forEach(function (k) { text = text.split('{' + k + '}').join(String(params[k])) })
  return text
}

// 会话态探针：旧横幅会在 sessionStorage 里写「本会话不再提示」；新标识不许再写一份会话态。
let storageWrites = 0
const fakeStorage = { getItem: function () { return null }, setItem: function () { storageWrites += 1 }, removeItem: function () {} }

// ---- 假世界：真实现能接的都接真实现（先例 tests/verify-1286-list.ts 的注入清单）----
const G: any = globalThis
G.React = React
G.tr = tr
G.emit = () => {}
G.Ic = (props: any) => '[icon:' + ((props && props.n) || '?') + ']'
G.Tip = (props: any) => React.createElement('span', { 'data-tip': String(props && props.content) }, props && props.children)
G.chipProps = (props: any) => props
G.COPY_FLASH_MS = 1300
G.sessionStorage = fakeStorage

const withQuietReact = function (fn: any) {
  const realConsoleError = console.error
  console.error = function () {
    const msg = String((arguments && arguments[0]) || '')
    if (msg.indexOf('unique "key" prop') >= 0) return
    if (msg.indexOf('useLayoutEffect does nothing on the server') >= 0) return
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
  // 判据与取色的真源：restFallbackView（降级该说哪一句）与 freshnessToneColor（警告档取色）。
  const truth: any = await import('../src/client/views/shared/truthLines.js')
  G.restFallbackView = truth.restFallbackView
  G.freshnessToneColor = truth.freshnessToneColor
  G.truthNoticeLines = () => []
  // 通知中心：判据与两个组件都走真实现。
  const model: any = await import('../src/client/views/shared/notificationCenterModel.js')
  G.NOTICE_TYPES = model.NOTICE_TYPES
  G.noticeRowsOf = model.noticeRowsOf
  G.noticeCurrentDegradedOf = model.noticeCurrentDegradedOf
  G.noticeHistoryMismatchOf = model.noticeHistoryMismatchOf
  G.noticeUnreadTextOf = model.noticeUnreadTextOf
  G.noticeTypeKeyOf = model.noticeTypeKeyOf
  G.noticeToneColorOf = model.noticeToneColorOf
  const center: any = await import('../src/client/views/shared/notificationCenter.js')
  // 列表页渲染需要的其余名字：本门禁不测行与筛选条，给空实现即可（判据不在这里）。
  const mark: any = await import('../src/client/views/shared/fallbackMark.js')
  G.FallbackMark = mark.FallbackMark
  G.listIssueRow = () => null
  G.listFilterRowNode = () => null
  G.mdEffortRowNode = () => null
  G.closedPagesNode = () => null
  G.getCachedSnapshot = () => null
  G.loadIssuePage = () => {}
  G.useClosedPageScroll = () => {}
  G.labelClicks = {}
  G.listPrefs = {}
  G.saveLabelClicks = () => {}
  G.saveListPrefs = () => {}
  G.healthCheckVisible = () => false
  G.healthCheckCountOf = () => 0
  G.deckCountsOf = () => null
  G.kpiCountsOf = () => null
  G.openIssuesOf = (st: any) => ((st && st.snapshot && st.snapshot.issues) || [])
  G.isOccupied = () => false
  G.mapBlockOf = () => ({})
  G.applyStandaloneBlocks = () => {}
  G.effortNamesOf = () => ['default']
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
  G.actionColorOf = () => '#c084fc'
  G.isLightHex = () => false
  G.mkRowAction = () => null
  G.authorColor = () => '#7aa2f7'
  G.darken = () => 'rgba(0,0,0,.6)'
  G.hexA = () => 'rgba(0,0,0,.16)'
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
  const listMod: any = await import('../src/client/views/ListTab.js')

  // ---- 造快照与状态：健忘的 snapshot 只放判据要看的字段 ----
  const snapOf = function (o: any) { return Object.assign({ repo: 'acme/demo', issues: [], maps: [], generatedMs: '2026-10-20T00:00:00Z' }, o || {}) }
  const stOf = function (snapExtra: any) {
    return {
      snapshot: snapOf(snapExtra), tab: 'list', stateFilter: 'open', lblFilters: [], effFilters: [],
      sortKey: 'updatedAt', sortDir: 'desc', rowFlash: {}, writeAt: {}, cwd: 'D:\\ws',
    }
  }
  const renderList = function (st: any) { return withQuietReact(() => renderToStaticMarkup(React.createElement(listMod.ListTab, { st: st, narrow: false }))) }
  const degradedSnap = function (ageMs: number, reason: any) { return { fallback: 'rest', fallbackAt: NOW - ageMs, fallbackReason: reason } }
  const renderPanel = function (st: any, view: any) { return withQuietReact(() => renderToStaticMarkup(React.createElement(center.NotificationHistoryPanel, { st: st, view: view }))) }
  const viewOf = function (events: any[]) {
    return { readable: true, loading: false, events: events, unread: model.noticeUnreadOf(events, {}), latest: model.noticeLatestOf(events), readIds: {}, key: 'k', markAllRead: function () {}, clearRead: function () {}, refresh: function () {} }
  }
  const ev = function (id: string, type: string, startedAt: number, extra: any) {
    return Object.assign({ id: id, type: type, repo: 'acme/demo', startedAt: startedAt, endedAt: null, count: 1, summary: type, detail: '', updatedAt: startedAt }, extra || {})
  }
  const openStart = ev('ev-open', 'degraded-start', NOW - 2 * HOUR)
  const closedAll = [ev('ev-a', 'degraded-start', NOW - 3 * HOUR, { endedAt: NOW - 2 * HOUR }), ev('ev-b', 'degraded-recovery', NOW - 2 * HOUR)]

  // ================= 一、列表页：头部小标识 =================
  {
    const html = renderList(stOf(degradedSnap(5 * MIN, 'other')))
    const doc = q(html)
    const markEl: any = doc.querySelector('[data-fallback-mark]')
    check(!!markEl, 'A1 取数降级时，列表页出现当前状态小标识（data-fallback-mark）')
    check(!!markEl && markEl.tagName === 'SPAN', 'A2 小标识是一颗行内 span（不是整块容器）')
    check(!!markEl && !!markEl.closest('[data-list-head="kpi"]'), 'A3 小标识画在列表头部 KPI 那一行里面（不新占一行）')
    const expected = tr('list.restFallbackNonQuota')
    check(!!markEl && markEl.getAttribute('aria-label') === expected, 'A4 读屏标签就是「这次取数走了 REST 通道」那一句（实际：' + (markEl ? markEl.getAttribute('aria-label') : '无') + '）')
    const tip: any = doc.querySelector('[data-tip]')
    check(!!tip && tip.getAttribute('data-tip') === expected, 'A5 悬停提示与读屏标签同一句（说哪一句由 restFallbackView 决定，标识不另造一句）')
    check(doc.querySelectorAll('[data-rest-fallback], [data-rest-fallback-dismiss]').length === 0, 'A6 整页不再有旧横幅的痕迹（data-rest-fallback / 关闭钮都不画）')
    check(storageWrites === 0, 'A7 小标识不写会话态（旧横幅的「本会话不再提示」已随横幅退役）')
  }
  {
    const html = renderList(stOf({ fallback: 'graphql' }))
    const doc = q(html)
    check(doc.querySelectorAll('[data-fallback-mark]').length === 0, 'A8 快照没降级标记时，小标识不画（不拿历史冒充现在）')
  }
  {
    const doc = q(renderList(stOf(degradedSnap(2 * HOUR, 'quota'))))
    const markEl: any = doc.querySelector('[data-fallback-mark]')
    const expected = tr('list.restFallbackStale', { n: 120 })
    check(!!markEl && markEl.getAttribute('data-fallback-mark') === 'stale', 'A9 超过一小时改口成「上次…」（stale 档）')
    check(!!markEl && markEl.getAttribute('aria-label') === expected, 'A10 stale 那句说的是「上次取数走了 REST 通道（120 分钟前）」（实际：' + (markEl ? markEl.getAttribute('aria-label') : '无') + '）')
    check(expected.indexOf('配额') >= 0, 'A11 准时那条降级句里提配额（诚实约束：只有配额原因才提配额）')
  }
  {
    const doc = q(renderList(stOf(degradedSnap(2 * HOUR, 'other'))))
    const markEl: any = doc.querySelector('[data-fallback-mark]')
    const expected = tr('list.restFallbackStaleNonQuota', { n: 120 })
    check(!!markEl && markEl.getAttribute('aria-label') === expected, 'A12 非配额原因改说中性那句（不拿配额当借口）')
    check(expected.indexOf('配额') < 0, 'A13 中性那句里不提配额（负例：拿配额解释非配额降级就是编事实）')
  }

  // ================= 二、通知中心：当前状态只从快照画 =================
  {
    const st = stOf(degradedSnap(2 * HOUR, 'quota'))
    const before = JSON.stringify(st)
    const html = renderPanel(st, viewOf([openStart]))
    const doc = q(html)
    check(doc.querySelector('[data-notice-current]') !== null && doc.querySelector('[data-notice-current]')!.getAttribute('data-notice-current') === 'degraded', 'B1 快照降级：通知中心说当前降级')
    check(doc.querySelectorAll('[data-notice-row][data-notice-type="degraded-start"]').length >= 1, 'B2 历史里有降级开始那一行（历史来自事件库）')
    check(doc.querySelectorAll('[data-notice-mismatch]').length === 0, 'B3 历史未闭合与快照一致时不标「对不上」')
    check(JSON.stringify(st) === before, 'B4 打开历史不写快照（渲染前后快照一字未变）')
  }
  {
    const doc = q(renderPanel(stOf({ fallback: 'graphql' }), viewOf([openStart])))
    const cur: any = doc.querySelector('[data-notice-current]')
    check(!!cur && cur.getAttribute('data-notice-current') === 'normal', 'B5 负例：历史说还有未闭合降级、快照说正常 → 当前状态仍按快照说正常')
    check(doc.querySelectorAll('[data-notice-mismatch]').length === 1, 'B6 负例：上面那种不一致要标出「历史与当前对不上」')
  }
  {
    const doc = q(renderPanel(stOf(degradedSnap(2 * HOUR, 'quota')), viewOf(closedAll)))
    const cur: any = doc.querySelector('[data-notice-current]')
    check(!!cur && cur.getAttribute('data-notice-current') === 'degraded', 'B7 负例：历史全闭合（看着已恢复）、快照仍降级 → 当前状态按快照说降级')
    check(doc.querySelectorAll('[data-notice-mismatch]').length === 1, 'B8 负例：上面那种不一致也要标出「对不上」')
  }
  {
    const doc = q(renderPanel(stOf(degradedSnap(2 * HOUR, 'quota')), viewOf([])))
    check(doc.querySelectorAll('[data-notice-empty]').length === 1, 'B9 空历史画空态')
    check(doc.querySelector('[data-notice-current]')!.getAttribute('data-notice-current') === 'degraded', 'B10 空历史时当前状态仍从快照画（不因为没历史就说正常）')
  }
  {
    const st = stOf(degradedSnap(5 * MIN, 'other'))
    const docList = q(renderList(st))
    const docPanel = q(renderPanel(st, viewOf(closedAll)))
    const markShown = docList.querySelectorAll('[data-fallback-mark]').length === 1
    const panelDegraded = docPanel.querySelector('[data-notice-current]')!.getAttribute('data-notice-current') === 'degraded'
    check(markShown && panelDegraded, 'B11 同一份快照下，头部小标识出现与通知中心说降级两边一致')
  }

  // ================= 三、文案与登记 =================
  {
    const pages = read('config/copy/pages.yaml')
    check(countOf(pages, '  list.fallbackMark:') === 2, 'C1 新标签 list.fallbackMark 中英各一份')
    check(tr('list.fallbackMark') !== '' && tr('list.fallbackMark') !== 'list.fallbackMark', 'C2 新标签取得到真词条（实际：' + tr('list.fallbackMark') + '）')
    check(countOf(read('config/copy/flow.yaml'), '  list.restFallback:') === 2, 'C3 降级句子「已切 REST 通道」中英各一份仍在')
    check(countOf(read('config/copy/word.yaml'), '  list.restFallbackStale:') === 2, 'C4 降级句子「上次…（N 分钟前）」中英各一份仍在')
    check(countOf(pages, '  list.restFallbackNonQuota:') === 2 && countOf(pages, '  list.restFallbackStaleNonQuota:') === 2, 'C5 两句非配额降级句子中英各一份仍在')
    let dismissLeft = 0
    fs.readdirSync(path.join(ROOT, 'config/copy')).forEach(function (f: string) { dismissLeft += countOf(read('config/copy/' + f), 'list.restFallbackDismiss') })
    check(dismissLeft === 0, 'C6 随横幅退役的关闭钮词条 list.restFallbackDismiss 已从词表删干净')
    check(!fs.existsSync(path.join(ROOT, 'src/client/views/shared/RestFallbackBanner.ts')), 'C7 旧横幅叶子文件已删除')
    const buildTxt = read('scripts/build.mts')
    check(!/id: 'restFallbackBanner'/.test(buildTxt) && /id: 'fallbackMark', file: 'src\/client\/views\/shared\/fallbackMark\.ts'/.test(buildTxt), 'C8 构建登记换成新叶子（旧横幅不再登记）')
    const indexTxt = read('src/client/index.ts')
    check(indexTxt.indexOf('leaf:fallbackMark') >= 0 && indexTxt.indexOf('leaf:restFallbackBanner') < 0, 'C9 拼接标记换成 leaf:fallbackMark（旧标记已删）')
    check(read('src/client/views/ListTab.ts').indexOf('RestFallbackBanner') < 0, 'C10 列表页不再引用旧横幅组件')
    const leafTxt = read('src/client/views/shared/fallbackMark.ts')
    // 只扫代码行：文件头注释里写着「不写 sessionStorage / 不是新控件」这些约定，不能把它们当成证据。
    const leafCode = leafTxt.split('\n').filter(function (ln: string) { return !/^\s*(\*|\/\/|\/\*)/.test(ln) }).join('\n')
    check(!/setInterval|setTimeout/.test(leafCode), 'C11 小标识不新增后台定时器')
    check(leafCode.indexOf('sessionStorage') < 0 && leafCode.indexOf('data-log') < 0, 'C12 小标识不写会话态、不是新控件（不带点击日志）')
    check(leafCode.indexOf('#f59e0b') < 0 && leafCode.indexOf('rgba(245') < 0, 'C13 小标识不自己写琥珀色值（警告档取 freshnessToneColor）')
  }

  console.log('verify-rest-fallback-banner：共 ' + total + ' 条断言，失败 ' + failed + ' 条')
  printGateResult(GATE, total, failed ? 1 : 0)
  process.exit(failed ? 1 : 0)
})().catch(function (e: any) {
  console.log('FAIL 门禁自身抛错：' + String(e && e.stack ? e.stack : e))
  printGateResult(GATE, total, 1)
  process.exit(1)
})