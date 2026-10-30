// tests/verify-1668-detail-top-gate-wire.ts —— #1668/#1669 门禁：详情页顶栏把可用性判据接到两颗动作按钮上
// https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1668
// https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1669
// 门禁归属: src/client/views/IssueDetail.ts
// 门禁归属: src/client/kernel/detail-top-gate.ts
// 门禁归属: src/client/kernel/styles.ts
// 判据（第一性原理）：
// 1. 票关闭/合并后，顶栏「主动作」与「新会话」同进退：带 aria-disabled="true"、tabindex="-1"，
//    点击只 stopPropagation、不注入也不开新会话；悬停原文说「这张票已关闭，只能查看。」。
// 2. 打开的票保持今天的行为：点击照常注入 / 开新会话，不带灰态属性。
// 3. #1669：票打开时，详情回包 blockedBy.nodes 里有明确没关闭的票 → 两颗按钮同样压灰，
//    悬停点名票号（升序、顿号分隔）；阻塞票全关闭、没有 blockedBy、或只剩列表快照时保持可点。
//    列表快照自己的 blockedBy 不参与（判据只认详情回包那一份）。
// 4. 详情回包优先于列表快照（src = detail || snapIssue）；只剩快照或加载失败降级时，同一判据照样生效。
// 5. 复制链接与「在跟踪器打开」是只读动作，不经过判据，两态都能用。
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1668-detail-top-gate-wire.ts
// 说明：本机 jsdom 已坏（@asamuzakjp/css-color 丢失），所以用 react-dom/server 静态渲染真组件，
//   并在 fakeCx 的 h 里记下 React 元素，事件处理器直接调（renderToStaticMarkup 不保留处理器）。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let failures = 0
let total = 0
const check = (ok: any, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

// ---- 同闭包全局量接桩：详情页单独加载时，这些名字在真机里由构建拼进同一个闭包 ----
// #1669 新加的两条词条在桩里给了真源模板：其余键照旧原样返回键名（#1668 的断言按键名比对），
// 只有这两条必须展开成整句才能断言「占位符替换后的形状」。桩里的句子是否与 flow.yaml 一字不差，
// 由 verify-locale-completeness 判；这里判的是视图选对了词条、票号拼法与分隔符来自词表。
const TR_TEMPLATE: Record<string, string> = {
  'tip.detailBlockedBy': '被 {n} 阻塞，等它们关闭后才能执行。',
  'tip.detailBlockedByJoin': '、',
}
const trFn = (key: any, params?: any): string => {
  let s = Object.prototype.hasOwnProperty.call(TR_TEMPLATE, String(key)) ? TR_TEMPLATE[String(key)] : String(key)
  if (params) s = s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
  return s
}
globalThis.React = React
globalThis.tr = trFn
globalThis.emit = () => {}
globalThis.Ic = (props: any) => '[' + ((props && props.n) || '?') + ']'
const stateKindMod = await import('../src/client/views/shared/stateKind.js')
globalThis.prStateKind = stateKindMod.prStateKind
const gateMod = await import('../src/client/kernel/detail-top-gate.js')
globalThis.detailTopGate = gateMod.detailTopGate
const identityMod = await import('../src/tracker/kernel/identity-keys.js')
globalThis.effortOf = identityMod.effortOf
globalThis.idOfParts = identityMod.idOfParts
globalThis.idOf = identityMod.idOf
globalThis.effortNamesOf = () => []
globalThis.peekNav = () => null
globalThis.repoStr = () => ''
globalThis.useIssueDetailFold = () => null
globalThis.findMapByIdentity = () => null
globalThis.pushNav = () => {}
globalThis.popNav = () => {}
globalThis.fetchIssueDetail = () => {}
const clicks = { inject: [], newSession: [] }
globalThis.inject = (st: any, text: any) => { clicks.inject.push(text) }
globalThis.openInNewSession = (st: any, payload: any) => { clicks.newSession.push(payload) }
globalThis.copyText = async () => true
const linkMod = await import('../src/client/kernel/link.js')
globalThis.issueUrlFor = linkMod.issueUrlFor
globalThis.openIssueUrl = linkMod.openIssueUrl
globalThis.openTrackerTarget = linkMod.openTrackerTarget
globalThis.openModeFor = linkMod.openModeFor
const TipStub = (props: any) => React.createElement('span', { 'data-tip': String(props.content) }, props.children)
globalThis.Tip = TipStub
// #1573：失败横幅的显示口径住在 issueDetailErrorView.ts；叶子单独加载时闭包里没有这个名字，接真实现。
globalThis.issueErrorViewOf = (await import('../src/client/views/issueDetailErrorView.js')).issueErrorViewOf
const { DswsCtx, createCx } = await import('../src/client/kernel/ctx.js')
const { renderIssueDetailComments } = await import('../src/client/views/IssueDetailComments.js')
globalThis.renderIssueDetailComments = renderIssueDetailComments
globalThis.MOTION = (await import('../src/client/kernel/motion.js')).MOTION
// #1511：编号写成「#目录/编号」的规则住在 kernel/ticket-label.ts，ticketBadgeOf 读同闭包里的它。
const labelMod = await import('../src/client/kernel/ticket-label.js')
globalThis.ticketLabelOf = labelMod.ticketLabelOf
globalThis.ticketLabelNodesOf = labelMod.ticketLabelNodesOf
globalThis.TICKET_LABEL_MAX_WIDTH = labelMod.TICKET_LABEL_MAX_WIDTH
globalThis.ticketBadgeOf = (await import('../src/client/views/shared/ticketBadge.js')).ticketBadgeOf
const { IssueDetail } = await import('../src/client/views/IssueDetail.js')
globalThis.DswsCtx = DswsCtx

// 记录 h 造出的每个 React 元素：静态渲染后从这里取按钮，直接调它的 onClick。
const created: any[] = []
const hRec = (type: any, props: any, ...kids: any[]) => { const el: any = React.createElement(type, props, ...kids); created.push(el); return el }
const services = {
  slots: { register: () => () => {}, inject: (name: any, fn: any) => { try { fn() } catch (e) {} } },
  locale: { register: () => () => {}, bind: () => trFn },
  timer: { timeout: (fn: any, ms: any) => setTimeout(fn, ms) },
}
const fakeStore = { snapshot: null, sessionId: 'test', tab: 'list', cwd: 'D:\\ws', issuePath: { current: null, nodes: [] }, noRepoCard: { expanded: false } }
const fakeCx = createCx({
  ctx: { get: (k: any) => (services as any)[k], effect: (fn: any) => { const r = fn(); return typeof r === 'function' ? r : () => {} }, inject: (deps: any, cb: any) => { cb({ get: (k: any) => (services as any)[k] }); return { dispose: () => {} } } },
  h: hRec,
  rdom: {},
  storeSvc: { shared: fakeStore, stores: {}, makeStore: () => fakeStore, storeOf: () => fakeStore, emit: () => {}, sub: () => () => {}, useStore: () => fakeStore },
  localeSvc: services.locale,
  timer: services.timer,
  api: { call: async () => ({ ok: true }), inject: () => {}, copyText: async () => {} },
  router: { open: () => {}, toggle: () => {} },
} as any)
function renderDetail(st: any): string {
  created.length = 0
  clicks.inject.length = 0
  clicks.newSession.length = 0
  return renderToStaticMarkup(React.createElement(DswsCtx.Provider, { value: fakeCx }, React.createElement(IssueDetail, { st })))
}
function byLog(log: string) { return created.find((el) => el && el.props && el.props['data-log'] === log) }
function click(log: string) {
  const el = byLog(log)
  if (!el || typeof el.props.onClick !== 'function') return null
  const ev = { stopped: 0, stopPropagation() { this.stopped += 1 } }
  el.props.onClick(ev)
  return ev
}
const MD7 = 'D:\\ws\\issues\\07-x.md'
const OPEN_ROW = { number: 7, key: '07', title: '打开的票', state: 'OPEN', labels: [], url: MD7 }
const CLOSED_ROW = { number: 7, key: '07', title: '关闭的票', state: 'CLOSED', labels: [], url: MD7 }
function stWith(rows: any[], extra?: any) {
  return Object.assign({ cwd: 'D:\\ws', activeIssue: 7, activeEffortId: '', snapshot: { issues: rows, maps: [] }, issueMode: 'idle' }, extra || {})
}
function tipCount(text: string) { return created.filter((el) => el && el.type === TipStub && String(el.props.content) === text).length }
function closedTipCount() { return tipCount('tip.detailClosedReadonly') }
// #1669 期望的悬停整句：模板取自上面 TR_TEMPLATE，视图只负责把票号拼成 "#3、#9"；
// 分隔符必须由 tr('tip.detailBlockedByJoin') 取，不许在视图里写死。
const blockSentence = (ids: string) => TR_TEMPLATE['tip.detailBlockedBy'].replace('{n}', ids)

// W1：详情缺失、只剩关闭的列表快照 → 两颗动作按钮同进退地压灰
{
  const html = renderDetail(stWith([CLOSED_ROW]))
  const exec = byLog('issue.top.exec')
  const news = byLog('issue.top.newsession')
  check(html.includes('data-detail-topbar="1"'), '顶栏容器带稳定标记 data-detail-topbar（灰态样式只挂这里）')
  check((html.match(/aria-disabled="true"/g) || []).length === 2, '两颗动作按钮都写了 aria-disabled="true"')
  check(!!exec && exec.props['aria-disabled'] === 'true' && exec.props.tabIndex === -1, '主动作：aria-disabled 为真、tabIndex 为 -1')
  check(!!news && news.props['aria-disabled'] === 'true' && news.props.tabIndex === -1, '新会话：aria-disabled 为真、tabIndex 为 -1')
  check(html.includes('tabindex="-1"'), '静态 HTML 里 tabindex 确实是 -1（Tab 落不上）')
  check(closedTipCount() === 2, '两颗按钮的悬停原文都是「这张票已关闭，只能查看。」对应的词条')
  const e1 = click('issue.top.exec')
  const e2 = click('issue.top.newsession')
  check(!!e1 && e1.stopped === 1 && !!e2 && e2.stopped === 1, '点击仍先 stopPropagation（行为与可点态一致）')
  check(clicks.inject.length === 0, '点灰的主动作：没有调用 inject')
  check(clicks.newSession.length === 0, '点灰的新会话：没有调用 openInNewSession')
  check(!!byLog('issue.top.copy') && byLog('issue.top.copy').props['aria-disabled'] === undefined, '复制链接不受判据影响（无 aria-disabled）')
  check(!!byLog('issue.top.link') && byLog('issue.top.link').props['aria-disabled'] === undefined, '在跟踪器打开不受判据影响（无 aria-disabled）')
  check(html.includes('data-log="issue.top.copy"') && html.includes('data-log="issue.top.link"'), '两态都仍渲染复制与打开两颗只读按钮')
}
// W2：打开的票照旧：可点、可开新会话、不带灰态
{
  const html = renderDetail(stWith([OPEN_ROW]))
  const exec = byLog('issue.top.exec')
  const news = byLog('issue.top.newsession')
  check(!!exec && exec.props['aria-disabled'] === undefined && exec.props.tabIndex === undefined, '打开的票：主动作不带 aria-disabled / 负 tabIndex')
  check(!!news && news.props['aria-disabled'] === undefined && news.props.tabIndex === undefined, '打开的票：新会话不带灰态属性')
  check(!html.includes('aria-disabled'), '打开的票：整页没有灰态按钮')
  check(closedTipCount() === 0, '打开的票：悬停仍是原来的动作说明，不是「只能查看」')
  click('issue.top.exec')
  click('issue.top.newsession')
  check(clicks.inject.length === 1, '打开的票：点主动作仍调用 inject 一次')
  check(clicks.newSession.length === 1 && clicks.newSession[0] && clicks.newSession[0].number === 7, '打开的票：点新会话仍调用 openInNewSession，带上票号')
}
// W3：详情回包说关闭、快照还说打开 → 以详情为准（src = detail || snapIssue）
{
  renderDetail(stWith([OPEN_ROW], { issueDetail: { number: 7, effortId: '', state: 'CLOSED', title: '关闭的票' } }))
  check(byLog('issue.top.exec').props['aria-disabled'] === 'true', '详情回包关闭、快照打开：主动作压灰（详情优先）')
  check(byLog('issue.top.newsession').props['aria-disabled'] === 'true', '详情回包关闭、快照打开：新会话压灰（详情优先）')
}
// W4：详情回包说打开、快照还说关闭 → 仍以详情为准，保持可点
{
  renderDetail(stWith([Object.assign({}, CLOSED_ROW)], { issueDetail: { number: 7, effortId: '', state: 'OPEN', title: '打开的票' } }))
  check(byLog('issue.top.exec').props['aria-disabled'] === undefined, '详情回包打开、快照关闭：主动作仍可点（详情优先）')
  check(byLog('issue.top.newsession').props['aria-disabled'] === undefined, '详情回包打开、快照关闭：新会话仍可点')
}
// W5：合并票（有合并时间、state 可能还是 OPEN）→ 也算关闭
{
  renderDetail(stWith([{ number: 7, key: '07', title: '已合并', state: 'OPEN', mergedAt: '2026-10-01T00:00:00Z', labels: [], url: MD7 }]))
  check(byLog('issue.top.exec').props['aria-disabled'] === 'true', '带合并时间的票：主动作压灰')
  check(byLog('issue.top.newsession').props['aria-disabled'] === 'true', '带合并时间的票：新会话压灰')
}
// W6：加载中（详情没有、快照也没有）→ 早返分支不画动作按钮，不能凭空出现灰按钮
{
  const html = renderDetail({ cwd: 'D:\\ws', activeIssue: 7, activeEffortId: '', snapshot: { issues: [], maps: [] }, issueMode: 'loading' })
  check(!html.includes('aria-disabled'), '加载中：没有灰态按钮（动作按钮这一支还没画）')
  check(!byLog('issue.top.exec') && !byLog('issue.top.newsession'), '加载中：没有动作按钮节点')
  check(html.includes('list.loading'), '加载中：仍走原来的加载占位')
}
// W7：加载失败、只剩关闭的列表快照 → 同一判据照样生效（兜底快照也算数）
{
  renderDetail(stWith([CLOSED_ROW], { issueMode: 'err', issueError: { message: '炸了', kind: 'network' } }))
  check(byLog('issue.top.exec').props['aria-disabled'] === 'true', '加载失败只剩快照：主动作仍压灰')
  check(byLog('issue.top.newsession').props['aria-disabled'] === 'true', '加载失败只剩快照：新会话仍压灰')
}

// W8：详情还在加载、只剩打开的列表快照 → 保持可点（规格「做完」第 3 条：加载中不凭空压灰）
{
  const html = renderDetail(stWith([OPEN_ROW], { issueMode: 'loading' }))
  check(!html.includes('aria-disabled'), '加载中只剩打开的快照：整页没有灰态按钮')
  check(!!byLog('issue.top.exec') && byLog('issue.top.exec').props['aria-disabled'] === undefined, '加载中只剩打开的快照：主动作可点')
  check(!!byLog('issue.top.newsession') && byLog('issue.top.newsession').props['aria-disabled'] === undefined, '加载中只剩打开的快照：新会话可点')
  click('issue.top.exec')
  click('issue.top.newsession')
  check(clicks.inject.length === 1, '加载中只剩打开的快照：点主动作照常 inject')
  check(clicks.newSession.length === 1 && clicks.newSession[0].number === 7, '加载中只剩打开的快照：点新会话照常开新会话')
}
// X1：#1669 打开的票、详情回包说被一张未完成的票阻塞 → 两颗动作按钮压灰、悬停点名那张票
{
  const html = renderDetail(stWith([OPEN_ROW], {
    issueDetail: { number: 7, effortId: '', state: 'OPEN', title: '打开的票', blockedBy: { nodes: [{ number: 11, state: 'OPEN' }] } },
  }))
  const exec = byLog('issue.top.exec')
  const news = byLog('issue.top.newsession')
  check((html.match(/aria-disabled="true"/g) || []).length === 2, '被阻塞：两颗动作按钮都写了 aria-disabled="true"')
  check(!!exec && exec.props['aria-disabled'] === 'true' && exec.props.tabIndex === -1, '被阻塞：主动作 aria-disabled 为真、tabIndex 为 -1')
  check(!!news && news.props['aria-disabled'] === 'true' && news.props.tabIndex === -1, '被阻塞：新会话 aria-disabled 为真、tabIndex 为 -1')
  check(closedTipCount() === 0, '被阻塞：悬停不是「这张票已关闭」，两种原因不能混用一句话')
  check(tipCount(blockSentence('#11')) === 2, '被阻塞：两颗按钮的悬停都是点名票号的「被阻塞」整句')
  const e1 = click('issue.top.exec')
  const e2 = click('issue.top.newsession')
  check(!!e1 && e1.stopped === 1 && !!e2 && e2.stopped === 1, '被阻塞：点击仍先 stopPropagation')
  check(clicks.inject.length === 0, '被阻塞：点主动作没有调用 inject')
  check(clicks.newSession.length === 0, '被阻塞：点新会话没有调用 openInNewSession')
  check(!!byLog('issue.top.copy') && byLog('issue.top.copy').props['aria-disabled'] === undefined, '被阻塞：复制链接不受影响（无 aria-disabled）')
  check(!!byLog('issue.top.link') && byLog('issue.top.link').props['aria-disabled'] === undefined, '被阻塞：在跟踪器打开不受影响（无 aria-disabled）')
}
// X2：阻塞票都已关闭 → 保持可点，点击照常
{
  const html = renderDetail(stWith([OPEN_ROW], {
    issueDetail: { number: 7, effortId: '', state: 'OPEN', title: '打开的票', blockedBy: { nodes: [{ number: 3, state: 'CLOSED' }, { number: 5, state: 'MERGED' }] } },
  }))
  check(!html.includes('aria-disabled'), '阻塞票全关闭：整页没有灰态按钮')
  check(tipCount(blockSentence('#3、#5')) === 0, '阻塞票全关闭：悬停不点名任何票号')
  click('issue.top.exec')
  click('issue.top.newsession')
  check(clicks.inject.length === 1, '阻塞票全关闭：点主动作照常 inject')
  check(clicks.newSession.length === 1 && clicks.newSession[0].number === 7, '阻塞票全关闭：点新会话照常开新会话')
}
// X3：详情回包没有 blockedBy、或清单是空的 → 保持可点（没取到不等于被阻塞）
{
  const noField = renderDetail(stWith([OPEN_ROW], {
    issueDetail: { number: 7, effortId: '', state: 'OPEN', title: '打开的票' },
  }))
  check(!noField.includes('aria-disabled'), '详情没有 blockedBy：不压灰')
  const emptyList = renderDetail(stWith([OPEN_ROW], {
    issueDetail: { number: 7, effortId: '', state: 'OPEN', title: '打开的票', blockedBy: { nodes: [] } },
  }))
  check(!emptyList.includes('aria-disabled'), 'blockedBy.nodes 为空数组：不压灰')
}
// X4：列表快照写着被阻塞、详情回包没有 blockedBy → 只认详情那一份，保持可点
{
  const snapRow = Object.assign({}, OPEN_ROW, { blockedBy: { nodes: [{ number: 3, state: 'OPEN' }] } })
  renderDetail(stWith([snapRow], { issueDetail: { number: 7, effortId: '', state: 'OPEN', title: '打开的票' } }))
  check(byLog('issue.top.exec').props['aria-disabled'] === undefined, '只有快照说被阻塞：主动作仍可点（判据只认详情回包）')
  check(byLog('issue.top.newsession').props['aria-disabled'] === undefined, '只有快照说被阻塞：新会话仍可点')
}
// X5：票本身已关闭、详情又列着未完成的阻塞票 → 仍说「已关闭」，两条原因不同时喊
{
  renderDetail(stWith([OPEN_ROW], {
    issueDetail: { number: 7, effortId: '', state: 'CLOSED', title: '关闭的票', blockedBy: { nodes: [{ number: 3, state: 'OPEN' }] } },
  }))
  check(byLog('issue.top.exec').props['aria-disabled'] === 'true', '关闭+被阻塞：主动作仍压灰')
  check(closedTipCount() === 2 && tipCount(blockSentence('#3')) === 0, '关闭+被阻塞：悬停只说「已关闭」，不再点名阻塞票')
}
// X6：多张阻塞票乱序 → 悬停里票号升序、顿号分隔
{
  renderDetail(stWith([OPEN_ROW], {
    issueDetail: {
      number: 7, effortId: '', state: 'OPEN', title: '打开的票',
      blockedBy: { nodes: [{ number: 12, state: 'OPEN' }, { number: 3, state: ' open ' }, { number: 9, state: 'Open' }] },
    },
  }))
  check(tipCount(blockSentence('#3、#9、#12')) === 2, '多张阻塞票：悬停票号升序、以顿号分隔（分隔符来自词表）')
}
// X7：四位票号连排 → 整句完整进得去，视图不做截断
{
  const ids = '#1234、#5678、#9012'
  renderDetail(stWith([OPEN_ROW], {
    issueDetail: {
      number: 7, effortId: '', state: 'OPEN', title: '打开的票',
      blockedBy: { nodes: [{ number: 1234, state: 'OPEN' }, { number: 5678, state: 'OPEN' }, { number: 9012, state: 'OPEN' }] },
    },
  }))
  check(tipCount(blockSentence(ids)) === 2, '长票号串：三张四位票号的整句完整出现在悬停里')
}

// H：灰态样式只挂详情顶栏里带 aria-disabled 的按钮（断规则存在与关键声明；不做像素断言）
{
  globalThis.MOTION = (await import('../src/client/kernel/motion.js')).MOTION
  const { STYLE_TEXT } = await import('../src/client/kernel/styles.js')
  const rule = (STYLE_TEXT.match(/\[data-detail-topbar\] \.dsws-btn\[aria-disabled="true"\]\{([^}]*)\}/) || [])[1] || ''
  check(rule !== '', '样式里有「详情顶栏 + aria-disabled」这一条选择器（灰态只挂这两颗按钮）')
  check(rule.includes('opacity:.4') && rule.includes('cursor:not-allowed'), '灰态：opacity .4、cursor not-allowed（沿用版本管理页的可点性口径）')
  check(rule.includes('background:var(--dsw-alias-bg-layer-1'), '灰态压掉主按钮的容器色，改用普通按钮底色（不再显示容器渐变）')
}

console.log(failures ? `\n#1668/#1669 接线门禁失败 ${failures} 项（共 ${total} 条）` : `\n#1668/#1669 接线门禁全部通过（共 ${total} 条）`)
// 失败才 process.exit(1)。通过时让进程自然退出：Node 24.19 在 Windows 上
// import 完本模块立刻 process.exit(0) 会撞 libuv 断言，断言虽全过但进程被判红。
if (failures) process.exit(1)
