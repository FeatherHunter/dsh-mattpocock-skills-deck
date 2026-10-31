/*
 * verify-notification-center.ts — 面板内通知中心的门禁（票 #1697）
 * 用法: node --import ./scripts/ts-hook.mts tests/verify-notification-center.ts
 *
 * 归属：#1697 面板内通知中心（规格 #1681 阶段 5）。本门禁守四件事：
 *   一、判据（views/shared/notificationCenterModel.ts）：当前状态只从快照派生、历史与当前对不上要能标出来、
 *       未读数与已读标记、按类型筛选、时间说法、轻提示只回声最新一条；
 *   二、折叠阶梯（panel/headFold.ts 的 #1697 徽标步）：让位顺序是刷新 → 徽标 → 时间 → 仓库名；
 *       另外给一条反例 —— 徽标若排在仓库名之后，收走它那一档仓库名已被截短，窄面板会先丢仓库名；
 *   三、真投影渲染（views/shared/notificationCenter.ts）：历史浮层与头部入口用 React 真渲染，
 *       断言当前状态、排序、已读、次数、筛选按钮、空历史、未读数字、折叠类与「读不到不冒充没有通知」；
 *   四、词表与宿主接线：界面用到的 notice.* 词条中英各一份、占位符一致；宿主只注册读电话；
 *       通知中心不新增后台定时器、未读只写会话呈现态。
 *
 * 为什么走真投影渲染而不是扫源码字符串：这条需求是「画成什么样、什么时候不画」，扫源码只能钉写法，
 * 等价重构就假红；真正要保的是渲染出来的那几颗元素与它们的属性（先例 tests/verify-1295-dual-panel.ts）。
 *
 * 运行不带 --import 钩子时，加载 .ts 源码会失败——这是有意的档位：链上会自动挂钩子。
 */
const fs = require('node:fs')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { printGateResult } = require('./lib/gate-result.ts')

const ROOT = path.join(__dirname, '..')
const GATE = 'verify-notification-center'
let total = 0
let failed = 0
const check = function (cond, msg) {
  total += 1
  if (cond) console.log('PASS ' + msg)
  else { failed += 1; console.log('FAIL ' + msg) }
  return !!cond
}
const read = function (rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8') }
const lineCount = function (text) { return text.split('\n').length - (/\n$/.test(text) ? 1 : 0) }
const countOf = function (text, needle) { return String(text).split(needle).length - 1 }
const attr = function (markup, name) {
  const out = []
  const re = new RegExp(name + '="([^"]*)"', 'g')
  let m = re.exec(markup)
  while (m) { out.push(m[1]); m = re.exec(markup) }
  return out
}
const lineOf = function (text, key) {
  const re = new RegExp('^  ' + key.replace(/[.]/g, '[.]') + ':.*$', 'm')
  const m = re.exec(text)
  return m ? m[0] : ''
}

const NOW = 1760000000000
const HOUR = 3600000
const MIN = 60000
const trDict = {
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
  'notice.detail.degradedQuota': '这次取数因配额耗尽改走 REST 通道',
  'notice.detail.degradedOther': '这次取数的主路不可用，改走 REST 通道',
  'notice.detail.refreshFailed': '这次刷新没有成功，界面仍是上一次的结果',
  'notice.detail.writeFailed': '写操作没有成功（工具：{tool}）',
  'notice.detail.legacyDegradedStart': '旧版记录：降级开始（没有记录原因）',
  'notice.detail.legacyFailure': '旧版记录：没有记录失败细节',
  'truth.updatedJustNow': '刚刚',
  'truth.updatedMinAgo': '{n} 分钟前',
  'truth.updatedHourAgo': '{n} 小时前',
  'truth.updatedDayAgo': '{n} 天前',
  'notice.markAllRead': '全部已读',
  'notice.clearRead': '清除已读标记',
  'notice.close': '关闭',
  'notice.empty': '还没有通知',
  'notice.unreadCount': '未读 {n} 条',
  'notice.read': '已读',
  'notice.entryLabel': '通知中心',
  'notice.entryTip': '通知中心：降级与失败的历史',
}
const tr = function (key, params) {
  let text = Object.prototype.hasOwnProperty.call(trDict, key) ? trDict[key] : key
  if (params && typeof params === 'object') {
    Object.keys(params).forEach(function (k) { text = text.split('{' + k + '}').join(String(params[k])) })
  }
  return text
}
globalThis.tr = tr
globalThis.React = React
globalThis.Ic = function (props) { return '[icon:' + String(props && props.n) + ']' }
globalThis.Tip = function (props) { return React.createElement('span', { 'data-tip': String(props && props.content) }, props && props.children) }
globalThis.portalTop = function (el) { return el }
globalThis.DswsCtx = React.createContext({ h: React.createElement })

;(async function () {
  const model = await import('../src/client/views/shared/notificationCenterModel.js')
  // 语气颜色复用 views/shared/truthLines.ts 的新鲜度三档映射（真实现，不在这里另写一份琥珀）。
  const truth = await import('../src/client/views/shared/truthLines.js')
  globalThis.freshnessToneColor = truth.freshnessToneColor
  // 「多久以前」的阶梯也从真源注入（同下文的 tr）：模型不自己算阈值，以免两份说法又分开。
  globalThis.truthAgoViewOf = truth.truthAgoViewOf
  globalThis.noticeToneColorOf = model.noticeToneColorOf
  globalThis.NOTICE_TYPES = model.NOTICE_TYPES
  globalThis.noticeRowsOf = model.noticeRowsOf
  globalThis.noticeCurrentDegradedOf = model.noticeCurrentDegradedOf
  globalThis.noticeHistoryMismatchOf = model.noticeHistoryMismatchOf
  globalThis.noticeUnreadTextOf = model.noticeUnreadTextOf
  globalThis.noticeTypeKeyOf = model.noticeTypeKeyOf
  globalThis.noticeHeadBadgeOf = model.noticeHeadBadgeOf

  const kernel = await import('../src/refresh/kernel/notification-events.js')
  const fold = await import('../src/client/panel/headFold.js')
  const center = await import('../src/client/views/shared/notificationCenter.js')

  const ev = function (id, type, startedAt, extra) {
    const e = { id: id, type: type, repo: 'acme/demo', startedAt: startedAt, endedAt: null, count: 1, summary: type, detail: '', updatedAt: startedAt }
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k] })
    return e
  }
  const EVENTS = [
    ev('ev-1', 'degraded-start', NOW - 4 * HOUR, { endedAt: NOW - 3 * HOUR }),
    ev('ev-2', 'degraded-recovery', NOW - 3 * HOUR),
    ev('ev-3', 'refresh-failed', NOW - 2 * HOUR),
    ev('ev-4', 'write-failed', NOW - 30 * MIN, { count: 3 }),
  ]
  const openStart = ev('ev-open', 'degraded-start', NOW - 2 * HOUR)
  const stNormal = function () { return { cwd: '/w/acme', snapshot: { repo: 'acme/demo', fallback: 'graphql', generatedMs: NOW } } }
  const stDegraded = function () { return { cwd: '/w/acme', snapshot: { repo: 'acme/demo', fallback: 'rest', fallbackAt: NOW - 2 * HOUR, generatedMs: NOW } } }
  const viewOf = function (events, readIds) {
    const ids = readIds || {}
    return { readable: true, loading: false, events: events, unread: model.noticeUnreadOf(events, ids), latest: model.noticeLatestOf(events), readIds: ids, key: 'k', markAllRead: function () {}, clearRead: function () {}, refresh: function () {} }
  }
  const renderPanel = function (st, view) { return renderToStaticMarkup(React.createElement(center.NotificationHistoryPanel, { st: st, view: view })) }
  const renderEntry = function (view, folded) { return renderToStaticMarkup(React.createElement(center.NotificationCenter, { st: stNormal(), view: view, folded: !!folded })) }

  // ── 一、判据：事件类型、当前状态、对不上、未读、排序、时间、回声 ──
  check(JSON.stringify(model.NOTICE_TYPES) === JSON.stringify(['degraded-start', 'degraded-recovery', 'refresh-failed', 'write-failed']), '四类事件：降级开始、降级恢复、刷新失败、写失败')
  check(JSON.stringify(kernel.NOTIFICATION_EVENT_TYPES) === JSON.stringify(model.NOTICE_TYPES), '面板认得的事件类型与内核事件库的类型清单逐项一致')
  check(model.noticeCurrentDegradedOf(stDegraded()) === true, '当前状态：快照带降级标记 → 说降级')
  check(model.noticeCurrentDegradedOf(stNormal()) === false, '当前状态：快照没降级标记 → 说正常')
  check(model.noticeCurrentDegradedOf({ snapshot: null }) === false, '没有快照 → 当前状态说正常（不拿历史冒充现在）')
  check(model.noticeHistoryMismatchOf(stNormal(), [openStart]) === true, '历史有一段未闭合降级、快照却说正常 → 标出「对不上」')
  check(model.noticeHistoryMismatchOf(stDegraded(), [openStart]) === false, '未闭合降级与快照降级一致 → 不标「对不上」')
  check(model.noticeHistoryMismatchOf(stDegraded(), EVENTS) === true, '快照说降级、历史里没有未闭合的开始 → 也标「对不上」')
  check(model.noticeHistoryMismatchOf(stNormal(), EVENTS) === false, '历史都闭合、快照正常 → 不标「对不上」')
  check(model.noticeUnreadOf(EVENTS, {}) === 4, '一条都没读过 → 4 条未读')
  check(model.noticeUnreadOf(EVENTS, { 'ev-4': 1, 'ev-2': 1 }) === 2, '读过两条 → 剩 2 条未读')
  check(model.noticeUnreadOf([{ type: 'refresh-failed' }], {}) === 0, '没有 id 的坏数据不算未读')
  check(model.noticeIsReadOf({ 'ev-1': 1 }, 'ev-1') === true, '已读标记按事件 id 认')
  check(model.noticeIsReadOf({}, 'toString') === false, '已读标记只认自己记下的键（不认原型链上的名字）')
  const rowsAll = model.noticeRowsOf(EVENTS, 'all', { 'ev-4': 1 }, NOW)
  check(rowsAll.length === 4, '历史四行都画')
  check(rowsAll[0].id === 'ev-4' && rowsAll[3].id === 'ev-1', '新的在上：最近发生的一行排第一，最旧的在最后')
  check(rowsAll[0].read === true && rowsAll[1].read === false, '读过的行记已读，没读过的不冒充已读')
  const rowsWrite = model.noticeRowsOf(EVENTS, 'write-failed', {}, NOW)
  check(rowsWrite.length === 1 && rowsWrite[0].type === 'write-failed', '按类型筛选只留写失败那一行')
  check(model.noticeRowsOf([], 'all', {}, NOW).length === 0, '空历史 → 一行都没有')
  check(model.noticeTimeTextOf(NOW, NOW - 30 * 1000) === '刚刚', '半分钟前 → 刚刚')
  check(model.noticeTimeTextOf(NOW, NOW - 5 * MIN) === '5 分钟前', '五分钟前 → 5 分钟前')
  check(model.noticeTimeTextOf(NOW, NOW - 2 * HOUR) === '2 小时前', '两小时前 → 2 小时前')
  check(model.noticeTimeTextOf(NOW, NOW - 3 * 24 * HOUR) === '3 天前', '三天前 → 3 天前')
  const modelSrcEarly = read('src/client/views/shared/notificationCenterModel.ts')
  const truthSrcEarly = read('src/client/views/shared/truthLines.ts')
  check(!/60000|3600000|86400000/.test(modelSrcEarly), '时间阶梯不再在通知中心里各写一份（60000/3600000/86400000 已删）')
  check(modelSrcEarly.indexOf('notice.time.') < 0, '通知中心不再自带一套「多久以前」词条（统一取 truth.updated*）')
  check(truthSrcEarly.indexOf('truthAgoViewOf') >= 0 && truthSrcEarly.indexOf('agoKey: ago.key') >= 0, '「多久以前」的阶梯收在 truthLines 一处（头部时间控件与通知历史共用）')
  check(countOf(read('config/copy/panel.yaml'), 'notice.time.') === 0, '重复的 notice.time.* 词条已从词表删干净（说法只剩 truth.updated*）')
  // 事件正文：按机器码与参数走词条，历史里的中文旧文案不贴到界面上
  check(model.noticeDetailOf({ type: 'degraded-start', code: 'degraded-start', params: { reason: 'quota' } }).indexOf('配额') >= 0, '降级开始（配额原因）按机器码说「配额耗尽」')
  check(model.noticeDetailOf({ type: 'degraded-start', code: 'degraded-start', params: { reason: 'other' } }).indexOf('配额') < 0, '负例：非配额降级不提配额（按参数分岔，不猜原因）')
  check(model.noticeDetailOf({ type: 'write-failed', code: 'write-failed', params: { tool: 'deck_issue_patch' } }) === '写操作没有成功（工具：deck_issue_patch）', '写失败按机器码与工具名渲染说明')
  check(model.noticeDetailOf({ type: 'refresh-failed', code: 'refresh-failed', params: { reason: 'unexpected EOF' } }).indexOf('unexpected EOF') < 0, '诊断原因不直接贴成界面文案（刷新失败只说一句概括）')
  check(model.noticeDetailOf({ type: 'refresh-failed', detail: '写死的中文旧文案' }) === '旧版记录：没有记录失败细节', '旧事件没有 code：按类型给通用说明，不把旧中文当界面文案')
  check(JSON.stringify(model.noticeRowsOf([{ id: 'old', type: 'refresh-failed', startedAt: NOW, updatedAt: NOW, detail: '写死的中文旧文案' }], 'all', {}, NOW)).indexOf('写死的中文旧文案') < 0, '负例：旧文件的中文旧文案不会进到历史行里')
  const firstRead = model.noticeEchoOf(undefined, EVENTS)
  check(firstRead.next === 'ev-4' && firstRead.echo === null, '第一次读到历史：只记基线、不补响（历史永不靠轻提示补）')
  check(model.noticeEchoOf('ev-4', EVENTS).echo === null, '最新一条没换 → 不响')
  const newer = EVENTS.concat([ev('ev-5', 'refresh-failed', NOW - 1 * MIN)])
  const changed = model.noticeEchoOf('ev-4', newer)
  check(!!changed.echo && changed.echo.id === 'ev-5', '最新一条换了 → 只回声这一条')
  const cleared = model.noticeEchoOf('ev-4', [])
  check(cleared.next === '' && cleared.echo === null, '历史清空 → 不拿空历史响一条')
  check(model.noticeToastTextOf(ev('x', 'write-failed', NOW, { count: 3 })) === '写票失败 发生 3 次', '同一原因合并过 → 轻提示带上发生次数')
  check(model.noticeUnreadTextOf({ readable: true, unread: 5 }) === '5', '未读数字照实说 5')
  check(model.noticeUnreadTextOf({ readable: true, unread: 0 }) === '', '没有未读 → 不画数字')
  check(model.noticeUnreadTextOf({ readable: true, unread: 120 }) === '99+', '超过 99 条 → 说 99+')
  check(model.noticeUnreadTextOf({ readable: false, unread: 5 }) === '', '读不到历史 → 不画数字（不冒充 0）')
  check(model.noticeHeadBadgeOf({ readable: true, unread: 2, events: EVENTS }) === 'badge', '有未读 → 头部让一格给徽标')
  check(model.noticeHeadBadgeOf({ readable: true, unread: 0, events: EVENTS }) === 'badge', '没有未读但有历史 → 仍让一格（读过的通知也要能点开）')
  check(model.noticeHeadBadgeOf({ readable: true, unread: 0, events: [] }) === '', '历史为空 → 不让位，不占窄面板的地方')
  check(model.noticeHeadBadgeOf({ readable: false, unread: 2, events: EVENTS }) === '', '读不到历史 → 不画入口')
  check(model.noticeReadIdsOf(['a', 'b']).a === 1, '数组形态的已读标记也认')
  check(model.noticeReadIdsOf({ a: NOW }).a === NOW, '对象形态保留标记时刻')
  check(model.noticeReadKeyOf({ cwd: '/w/acme' }) === 'dsws.noticeRead:/w/acme', '已读标记的存储键带工作区')
  check(model.noticeReadKeyOf({ cwd: '/w/acme' }) !== model.noticeReadKeyOf({ cwd: '/w/other' }), '不同工作区的已读标记各记各的')
  const savedSession = globalThis.sessionStorage
  globalThis.sessionStorage = undefined
  let saveThrew = false
  let saveReturned = null
  try { saveReturned = model.noticeSaveReadIdsOf('k', { a: 1 }) } catch (eS) { saveThrew = true }
  check(!saveThrew && saveReturned === false, '没有会话存储时写已读标记不抛、回 false（会话态可丢）')
  if (savedSession !== undefined) globalThis.sessionStorage = savedSession

  // ── 二、折叠阶梯：徽标让位步的位置与负例 ──
  const FULL = { name: 'FeatherHunter/dsh-mattpocock-skills-deck', refresh: '刷新', time: '3 分钟前', icons: ['palette', 'switch', 'mark'] }
  const withBadge = fold.headFoldLadderOf({ name: FULL.name, refresh: FULL.refresh, time: FULL.time, icons: FULL.icons, badge: 'badge' })
  const noBadge = fold.headFoldLadderOf({ name: FULL.name, refresh: FULL.refresh, time: FULL.time, icons: FULL.icons })
  const stepIndex = function (ladder, el) { for (let i = 0; i < ladder.steps.length; i++) if (ladder.steps[i].el === el) return i; return -1 }
  const refreshIdx = stepIndex(withBadge, 'refresh')
  const badgeIdx = stepIndex(withBadge, 'badge')
  const timeIdx = stepIndex(withBadge, 'time')
  const nameIdx = stepIndex(withBadge, 'name')
  check(badgeIdx >= 0, '行上有徽标时阶梯里多出一步让位')
  check(refreshIdx < badgeIdx && badgeIdx < timeIdx && timeIdx < nameIdx, '让位顺序：刷新 → 徽标 → 时间 → 仓库名（窄面板先保仓库名与时间）')
  check(stepIndex(noBadge, 'badge') < 0 && noBadge.steps.length === FULL.refresh.length + FULL.time.length + FULL.name.length + FULL.icons.length, '没有徽标时阶梯与旧版逐档一致（不多出一步）')
  const atBadgeOn = fold.headFoldStateAt(withBadge, badgeIdx)
  const atBadgeOff = fold.headFoldStateAt(withBadge, badgeIdx + 1)
  check(atBadgeOn.badge === true && atBadgeOff.badge === false, '徽标：走到它那一步才收走，一步收完')
  check(atBadgeOff.name === FULL.name && atBadgeOff.time === FULL.time, '收走徽标那一档，仓库名与时间都还完整（300 至 520 像素窄面板要保住它们）')
  check(atBadgeOn.refresh === '' && atBadgeOff.refresh === '', '收徽标之前刷新按钮上的字已经收完（徽标排在它后面）')
  const wrongSteps = noBadge.steps.slice(0, refreshIdx + FULL.refresh.length)
  for (let i = 1; i <= FULL.time.length; i++) wrongSteps.push({ el: 'time', n: i })
  for (let i = 1; i <= FULL.name.length; i++) wrongSteps.push({ el: 'name', n: i })
  wrongSteps.push({ el: 'badge' })
  const wrong = { name: FULL.name, refresh: FULL.refresh, time: FULL.time, steps: wrongSteps }
  check(fold.headFoldStateAt(wrong, wrongSteps.length).name !== FULL.name, '负例：徽标若排在仓库名之后，收走它那一档仓库名已经被截短（所以不能那样排）')
  let badgeMono = true
  let badgeSeenOff = false
  for (let t = 0; t <= withBadge.steps.length; t++) {
    const s = fold.headFoldStateAt(withBadge, t)
    if (badgeSeenOff && s.badge !== false) badgeMono = false
    if (s.badge === false) badgeSeenOff = true
  }
  check(badgeMono && badgeSeenOff, '徽标只收走一次，收走之后每一档都不再出现')
  check(fold.headFoldStateAt(noBadge, noBadge.steps.length).badge === true, '没有徽标步的阶梯在任何一档都说「徽标还在画」（旧调用方行为不变）')

  // ── 三、真投影渲染：历史浮层与头部入口 ──
  const normalMarkup = renderPanel(stNormal(), viewOf(EVENTS, {}))
  check(normalMarkup.indexOf('data-notice-current="normal"') >= 0, '历史浮层：快照正常 → 当前状态说正常')
  check(normalMarkup.indexOf('data-notice-mismatch') < 0, '历史都闭合、快照正常 → 不画「对不上」的说明')
  const degradedMarkup = renderPanel(stDegraded(), viewOf([openStart], {}))
  check(degradedMarkup.indexOf('data-notice-current="degraded"') >= 0, '历史浮层：快照降级 → 当前状态说降级')
  check(degradedMarkup.indexOf('data-notice-mismatch') < 0, '未闭合降级与快照一致 → 不画「对不上」')
  const staleMarkup = renderPanel(stNormal(), viewOf([openStart], {}))
  check(staleMarkup.indexOf('data-notice-current="normal"') >= 0, '快照说正常、历史有未闭合降级 → 当前状态仍按快照说正常')
  check(staleMarkup.indexOf('data-notice-mismatch="1"') >= 0, '…同时补一句历史与当前对不上（负例：不许拿历史冒充现在）')
  const reverseMarkup = renderPanel(stDegraded(), viewOf(EVENTS, {}))
  check(reverseMarkup.indexOf('data-notice-current="degraded"') >= 0 && reverseMarkup.indexOf('data-notice-mismatch="1"') >= 0, '反过来（快照降级、历史全闭合）也标出对不上，当前状态仍按快照')
  const stKeep = stDegraded()
  const beforeOpen = JSON.stringify(stKeep)
  renderPanel(stKeep, viewOf(EVENTS, {}))
  check(JSON.stringify(stKeep) === beforeOpen, '打开并渲染历史不改快照（通知中心只读历史）')
  const listMarkup = renderPanel(stNormal(), viewOf(EVENTS, { 'ev-3': 1 }))
  const rowIds = attr(listMarkup, 'data-notice-id')
  check(rowIds.length === 4 && rowIds[0] === 'ev-4' && rowIds[3] === 'ev-1', '历史列表按时间从新到旧排列（实测 ' + JSON.stringify(rowIds) + '）')
  const rowReads = attr(listMarkup, 'data-notice-read')
  check(rowReads[0] === '0' && rowReads[1] === '1', '渲染出来的行：读过的标已读、没读过的不标（实测 ' + JSON.stringify(rowReads) + '）')
  check(listMarkup.indexOf('data-notice-times') >= 0 && listMarkup.indexOf('发生 3 次') >= 0, '合并过的同一原因显示发生次数')
  // 历史文件里旧版留下的中文说明不再贴到界面上：有机器码按词条渲染，没有机器码用通用说明占位。
  const oldDetailMarkup = renderPanel(stNormal(), viewOf([ev('ev-old', 'refresh-failed', NOW - HOUR, { detail: '写死的中文旧文案' })], {}))
  check(oldDetailMarkup.indexOf('写死的中文旧文案') < 0, '负例：旧文件里的中文旧说明不贴到界面上（渲染出来就会红）')
  check(oldDetailMarkup.indexOf('旧版记录：没有记录失败细节') >= 0, '旧事件没有机器码 → 用通用说明占位，不冒充具体原因')
  const codedMarkup = renderPanel(stNormal(), viewOf([ev('ev-code', 'write-failed', NOW - HOUR, { code: 'write-failed', params: { tool: 'deck_issue_patch' } })], {}))
  check(codedMarkup.indexOf('写操作没有成功（工具：deck_issue_patch）') >= 0, '带机器码与参数的事件按词条渲染说明')
  const filterValues = attr(listMarkup, 'data-notice-filter')
  check(filterValues.join(',') === 'all,degraded-start,degraded-recovery,refresh-failed,write-failed', '筛选按钮：全部加四类事件（实测 ' + filterValues.join(',') + '）')
  check(listMarkup.indexOf('data-notice-filter-on="1"') >= 0, '默认选中「全部」')
  const emptyMarkup = renderPanel(stNormal(), viewOf([], {}))
  check(emptyMarkup.indexOf('data-notice-empty') >= 0 && emptyMarkup.indexOf('data-notice-list') < 0, '空历史画「还没有通知」，不画空列表')
  const entryMarkup = renderEntry(viewOf(EVENTS, {}), false)
  check(entryMarkup.indexOf('data-notice-entry') >= 0, '有未读 → 头部画通知入口')
  check(entryMarkup.indexOf('data-notice-unread="1"') >= 0 && entryMarkup.indexOf('>4<') >= 0, '入口带未读数字 4')
  check(entryMarkup.indexOf('data-head-fold="badge"') >= 0, '入口整格带 data-head-fold="badge"（折叠阶梯找得着它）')
  check(entryMarkup.indexOf('data-press="icon"') >= 0 && entryMarkup.indexOf('data-log="notice.entry"') >= 0, '入口有按压反馈与点击日志')
  check(entryMarkup.indexOf('dsws-folded') < 0, '没折叠到这一档时不带折叠类')
  check(renderEntry(viewOf(EVENTS, {}), true).indexOf('dsws-folded') >= 0, '折叠到这一档 → 整格带 dsws-folded，窄面板里让出位置')
  const readAllView = viewOf(EVENTS, { 'ev-1': 1, 'ev-2': 1, 'ev-3': 1, 'ev-4': 1 })
  check(model.noticeHeadBadgeOf(readAllView) === 'badge', '没有未读但有历史 → 仍让出一格（入口要能点开看历史）')
  check(model.noticeHeadBadgeOf(viewOf([], {})) === '', '负例：历史为空 → 不让格（空历史没东西可看，不占窄面板的地方）')
  check(model.noticeHeadBadgeOf({ readable: false, unread: 5, events: EVENTS }) === '', '负例：读不到历史 → 不让格（不拿未读数冒充能看的历史）')
  const readAllMarkup = renderEntry(readAllView, false)
  check(readAllMarkup.indexOf('data-notice-entry') >= 0, '全部已读但历史非空 → 入口仍在（还能点开看历史）')
  check(readAllMarkup.indexOf('data-notice-unread') < 0, '…但没有未读就不带数字')
  check(readAllMarkup.indexOf('aria-label="通知中心"') >= 0, '…说明用「通知中心」，不冒充未读')
  const emptyEntryView = viewOf([], {})
  check(renderEntry(emptyEntryView, false) === '', '负例：历史为空 → 不画入口，不占窄面板的地方')
  const unreadableView = viewOf(EVENTS, {})
  unreadableView.readable = false
  check(renderEntry(unreadableView, false) === '', '负例：读不到历史 → 不画入口（不拿「没有通知」冒充读不到）')

  // ── 四、词表与宿主接线 ──
  const panelYaml = read('config/copy/panel.yaml')
  const enIdx = panelYaml.indexOf('\nen:')
  const zhPart = enIdx >= 0 ? panelYaml.slice(0, enIdx) : ''
  const enPart = enIdx >= 0 ? panelYaml.slice(enIdx + 1) : ''
  const sources = [read('src/client/views/shared/notificationCenterModel.ts'), read('src/client/views/shared/notificationCenter.ts')].join('\n')
  const usedKeys = []
  const keyRe = /tr\('(notice\.[A-Za-z0-9_.]+)'/g
  let km = keyRe.exec(sources)
  while (km) { if (usedKeys.indexOf(km[1]) < 0) usedKeys.push(km[1]); km = keyRe.exec(sources) }
  // 说明词条（notice.detail.*）按机器码动态拼键，这里数不到；数量门槛按静态键的现状定。
  check(usedKeys.length >= 19, '界面用到的 notice.* 词条不少于 19 条（实测 ' + usedKeys.length + '）')
  const zhMissing = []
  const enMissing = []
  const phBad = []
  for (let i = 0; i < usedKeys.length; i++) {
    const key = usedKeys[i]
    const zhLine = lineOf(zhPart, key)
    const enLine = lineOf(enPart, key)
    if (!zhLine) zhMissing.push(key)
    if (!enLine) enMissing.push(key)
    if ((countOf(zhLine, '{n}') > 0) !== (countOf(enLine, '{n}') > 0)) phBad.push(key)
  }
  check(zhMissing.length === 0, '界面用到的每条词条中文都有（缺：' + zhMissing.join(',') + '）')
  check(enMissing.length === 0, '界面用到的每条词条英文都有（缺：' + enMissing.join(',') + '）')
  check(phBad.length === 0, '中英词条的占位符一致（不一致：' + phBad.join(',') + '）')
  const hostSrc = read('src/host/index.ts')
  const notifHostSrc = read('src/host/notifications.ts')
  check(hostSrc.indexOf("harness.handle('wf.notifications'") >= 0 && hostSrc.indexOf("import('./notifications.js')") >= 0, '宿主注册了 wf.notifications 读历史电话（加载器搬进 ./notifications.ts）')
  check(hostSrc.indexOf("import('../refresh/rooms/host/notification-store.js')") >= 0 && !/import\s*\([^)]*refresh\/rooms/.test(notifHostSrc) && !/from\s+['"][^'"]*refresh\/rooms/.test(notifHostSrc), '宿主入口是房间的唯一装配点：事件库加载钩子由入口传入 ./notifications.ts，接线叶子自己不深引刷新房（只查 import 形式，注释里可以解释这条规则）')
  check(notifHostSrc.indexOf('await st.read(') >= 0 && notifHostSrc.indexOf('st.write') < 0 && notifHostSrc.indexOf('persist') < 0, '电话只读事件库（read），不写历史')
  check(lineCount(hostSrc) <= 400, '宿主入口不超过四百行（实测 ' + lineCount(hostSrc) + ' 行）')
  const modelSrc = read('src/client/views/shared/notificationCenterModel.ts')
  const centerSrc = read('src/client/views/shared/notificationCenter.ts')
  check(modelSrc.indexOf('wf.notifications') >= 0, '取数只走 wf.notifications 这一条宿主电话')
  check(centerSrc.indexOf('host.call') < 0 && centerSrc.indexOf('wf.') < 0, '画历史的地方不直接调宿主（取数只在 model 一处）')
  check(modelSrc.indexOf('setInterval') < 0 && modelSrc.indexOf('setTimeout') < 0 && centerSrc.indexOf('setInterval') < 0 && centerSrc.indexOf('setTimeout') < 0, '通知中心不新增任何后台定时器')
  check(modelSrc.indexOf('localStorage') < 0 && modelSrc.indexOf('sessionStorage') >= 0, '未读标记只写会话呈现态（sessionStorage），不落盘')
  const dockSrc = read('src/client/panel/Dock.ts')
  check(dockSrc.indexOf('NotificationCenter') >= 0 && dockSrc.indexOf('useNotifications(s)') >= 0, '面板头部那一排接上了通知中心入口')

  console.log('verify-notification-center：共 ' + total + ' 条断言，失败 ' + failed + ' 条')
  printGateResult(GATE, total, failed ? 1 : 0)
  process.exitCode = failed ? 1 : 0
})().catch(function (e) {
  console.log('FAIL 门禁自身抛错：' + String(e && e.stack ? e.stack : e))
  total += 1
  failed += 1
  printGateResult(GATE, total, 1)
  process.exitCode = 1
})
