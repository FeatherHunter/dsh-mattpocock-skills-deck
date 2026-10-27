// tests/verify-1145-open-local.ts —— #1145 门禁：详情页「在跟踪器打开」本地票必须走宿主打开
// https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1145
// 判据（第一性原理）：本地票的 url 是文件路径不是网址，`<a href="D:\…">` 点了没反应；
// 唯一诚实动作是调宿主 openPath（https 票走 `<a target=_blank>` 不动）。四处都要守：
// 详情顶栏、报错横幅、评论加载失败横幅、评论鉴权横幅。
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1145-open-local.ts
// 说明：评论区是纯函数，直接调 handler 全行为断言（含点击调宿主）；详情页组件走
// react-dom/server 静态渲染断分支（button vs 裸 a、href 值）。本机 jsdom 已坏
// （@asamuzakjp/css-color 丢了，smoke-render 同样起不来），所以不用 jsdom。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const hostCalls = []
const opened = []
globalThis.host = { call: (m, a) => { hostCalls.push([m, a]); return Promise.resolve({ ok: true }) } }
const trFn = (key, params) => {
  let s = String(key)
  if (params) s = s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
  return s
}
globalThis.tr = trFn
globalThis.emit = () => {}
// Ic 透出图标名（真实现渲染 svg；桩返回标记串，让门禁能分清跟踪器按钮与复制按钮）
globalThis.Ic = (props) => ('[' + ((props && props.n) || '?') + ']')
// window 只在点击那一刻接桩（renderToStaticMarkup 探 window 定服务端行为，常驻会污染渲染）
function withWindowStub(fn) {
  globalThis.window = { open: (...a) => { opened.push(a); return null } }
  try { fn() } finally { delete globalThis.window }
}
// 身份算法走真实现（link.js 读的是同闭包全局量；手写桩一旦与真源分叉，门禁就测了个假环境）
const identityMod = await import('../src/tracker/kernel/identity-keys.js')
globalThis.effortOf = identityMod.effortOf
globalThis.idOfParts = identityMod.idOfParts
globalThis.idOf = identityMod.idOf
globalThis.prStateKind = () => 'open'
globalThis.effortNamesOf = () => []
globalThis.peekNav = () => null
globalThis.repoStr = () => ''
globalThis.useIssueDetailFold = () => null
globalThis.findMapByIdentity = () => null
globalThis.pushNav = () => {}
globalThis.popNav = () => {}
globalThis.copyText = async () => true
globalThis.openInNewSession = () => {}
globalThis.inject = () => {}
// Tip 只透出悬停原文供定位，不参与断言逻辑
const TipStub = (props) => React.createElement('span', { 'data-tip': String(props.content) }, props.children)
globalThis.Tip = TipStub
globalThis.React = React

// 动态导入必须在全局量齐备之后（ctx.js 顶层就读 React，静态 import 会先于赋值执行）
const linkMod = await import('../src/client/kernel/link.js')
globalThis.issueUrlFor = linkMod.issueUrlFor
globalThis.openIssueUrl = linkMod.openIssueUrl
// #1573：失败横幅三块（主行一句话 / kind 小标签 / 原始说明折叠区）搬进了 issueDetailErrorView 叶子；
//   叶子单独加载时闭包里没有这个名字，这里接真实现（同构接线，不抄一份假判据）。
const { issueErrorViewOf } = await import('../src/client/views/issueDetailErrorView.js')
globalThis.issueErrorViewOf = issueErrorViewOf
const { DswsCtx, createCx } = await import('../src/client/kernel/ctx.js')
const { renderIssueDetailComments } = await import('../src/client/views/IssueDetailComments.js')
const { IssueDetail } = await import('../src/client/views/IssueDetail.js')
globalThis.DswsCtx = DswsCtx
// 同叶调用走真实现（构建把两叶拼进同一闭包，这里同构接线；桩它就测不到真行为）
globalThis.renderIssueDetailComments = renderIssueDetailComments
// #1511：编号写成「#目录/编号」的规则住在 kernel/ticket-label.ts；叶子单独加载时闭包里没有这个名字，
// 这里接真实现（同构接线，不抄一份假规则，否则门禁会跟着实现一起漂）。
const { ticketLabelOf, ticketLabelNodesOf, TICKET_LABEL_MAX_WIDTH } = await import('../src/client/kernel/ticket-label.js')
globalThis.ticketLabelOf = ticketLabelOf
globalThis.ticketLabelNodesOf = ticketLabelNodesOf
globalThis.TICKET_LABEL_MAX_WIDTH = TICKET_LABEL_MAX_WIDTH

let failures = 0
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

// ---- A 部分：评论区是纯函数，直接调、直接断（含点击） ----
const fakeH = (tag, props, ...rest) => ({ tag, props: props || {}, kids: rest })
function* walk(n) {
  if (n === null || n === undefined || typeof n !== 'object') return
  if (Array.isArray(n)) { for (const x of n) yield* walk(x); return }
  yield n
  const kids = (n.kids !== undefined) ? n.kids : (n.props && n.props.children)
  if (kids !== undefined) yield* walk(kids)
}
function textOf(n) {
  const out = []
  const rec = (x) => {
    if (typeof x === 'string') { out.push(x); return }
    if (x === null || x === undefined || typeof x !== 'object') return
    if (Array.isArray(x)) { x.forEach(rec); return }
    rec(x.kids !== undefined ? x.kids : (x.props && x.props.children))
  }
  rec(n)
  return out.join('')
}
function findLinkNode(tree, textKey) {
  for (const n of walk(tree)) {
    if (!n.props) continue
    if (n.props.href === undefined && typeof n.props.onClick !== 'function') continue
    if (textOf(n).includes(textKey)) return n
  }
  return null
}
const MD7 = 'D:\\ws\\issues\\07-x.md'
function commentsSt(extra) {
  return Object.assign({
    cmtSending: false, cmtDraft: '', cmtResult: null, cmtConfirm: null, cmtError: null,
    issueCommentsFailCount: 0, issueCommentsMoreLoading: false,
    snapshot: { issues: [{ number: 7, key: '7', title: '本地票', state: 'OPEN', labels: [], url: MD7 }], maps: [] },
  }, extra || {})
}
const fakeDetail = { comments: { nodes: [{ body: '好', author: { login: 'a' }, createdAt: '2026-10-01' }], pageInfo: { hasNextPage: false } } }

// A1：加载失败横幅（fail>=3）本地票 → button，点击走宿主
{
  hostCalls.length = 0; opened.length = 0
  const st = commentsSt({ issueCommentsFailCount: 3 })
  const tree = renderIssueDetailComments(fakeH, st, 7, fakeDetail, 'real', fakeDetail.comments.nodes, true, '')
  const link = findLinkNode(tree, 'detail.viewOnTrackerHint')
  check(!!link, '评论加载失败横幅：找到了打开链接节点')
  check(!!link && link.tag === 'button', '本地票渲染的是 button 不是 a（裸 href 点了没反应）')
  if (link && typeof link.props.onClick === 'function') withWindowStub(() => link.props.onClick({ stopPropagation() {} }))
  check(hostCalls.length === 1 && hostCalls[0][0] === 'wf.openPath' && hostCalls[0][1] && hostCalls[0][1].path === MD7,
    '点击调宿主 wf.openPath 且 path 为票文件路径')
  check(opened.length === 0, '没走 window.open（文件路径不是网址）')
}
// A2：鉴权横幅本地票 → button，点击走宿主
{
  hostCalls.length = 0; opened.length = 0
  const st = commentsSt({ cmtError: { kind: 'auth', message: '要登录' } })
  const tree = renderIssueDetailComments(fakeH, st, 7, fakeDetail, 'real', fakeDetail.comments.nodes, true, '')
  const link = findLinkNode(tree, 'detail.authFailCta')
  check(!!link, '鉴权横幅：找到了打开链接节点')
  check(!!link && link.tag === 'button', '本地票渲染的是 button 不是 a')
  if (link && typeof link.props.onClick === 'function') withWindowStub(() => link.props.onClick({ stopPropagation() {} }))
  check(hostCalls.length === 1 && hostCalls[0][0] === 'wf.openPath' && hostCalls[0][1] && hostCalls[0][1].path === MD7,
    '点击调宿主 wf.openPath 且 path 为票文件路径')
  check(opened.length === 0, '没走 window.open')
}
// A3：https 票不动 → 仍是 a[href]
{
  hostCalls.length = 0
  const st = commentsSt({ issueCommentsFailCount: 3 })
  st.snapshot.issues[0].url = 'https://github.com/o/r/issues/7'
  const tree = renderIssueDetailComments(fakeH, st, 7, fakeDetail, 'real', fakeDetail.comments.nodes, true, '')
  const link = findLinkNode(tree, 'detail.viewOnTrackerHint')
  check(!!link && link.tag === 'a' && link.props.href === 'https://github.com/o/r/issues/7', 'https 票仍是 a 且 href 为网址（回归不动）')
}

// ---- B 部分：详情页组件静态渲染断分支（button vs 裸 a、href 值） ----
const services = {
  slots: { register: () => () => {}, inject: (name, fn) => { try { fn() } catch (e) {} } },
  locale: { register: () => () => {}, bind: () => trFn },
  timer: { timeout: (fn, ms) => setTimeout(fn, ms) },
}
const fakeStore = { snapshot: null, sessionId: 'test', tab: 'list', cwd: 'D:\\ws', issuePath: { current: null, nodes: [] }, noRepoCard: { expanded: false } }
const fakeCx = createCx({
  ctx: { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} }, inject: (deps, cb) => { cb({ get: (k) => services[k] }); return { dispose: () => {} } } },
  h: React.createElement,
  rdom: {},
  storeSvc: { shared: fakeStore, stores: {}, makeStore: () => fakeStore, storeOf: () => fakeStore, emit: () => {}, sub: () => () => {}, useStore: () => fakeStore },
  localeSvc: services.locale,
  timer: services.timer,
  api: { call: async () => ({ ok: true }), inject: () => {}, copyText: async () => {} },
  router: { open: () => {}, toggle: () => {} },
})
function renderDetail(st) {
  return renderToStaticMarkup(React.createElement(DswsCtx.Provider, { value: fakeCx }, React.createElement(IssueDetail, { st })))
}
// B1：顶栏本地票 → button、无裸 href
{
  const st = {
    cwd: 'D:\\ws', activeIssue: 7, activeEffortId: '',
    snapshot: { issues: [{ number: 7, key: '7', title: '本地票', state: 'OPEN', labels: [], url: MD7 }], maps: [] },
    issueMode: 'idle',
  }
  const html = renderDetail(st)
  check(html.includes('data-tip="tip.openInTracker"'), '顶栏找到了打开提示位')
  check(!html.includes('href="D:'), '顶栏本地票没有裸 href 链接')
  // 只认装着 link 图标的跟踪器按钮（复制按钮同形但装的是 clipboard 图标，旧断言会被它满足）。
  //   类名写成「dsws-btn ghost 打头、后面还允许别的类」：#1335 界面反馈给这颗按钮挂了悬停类 dsws-hov，
  //   按钮还是同一颗 ghost 按钮（仍是 type=button、仍装 link 图标），类名表多一个词不算形状变了。
  check(/<button(?=[^>]*class="dsws-btn ghost[^"]*")(?=[^>]*type="button")[^>]*>\[link\]<\/button>/.test(html),
    '顶栏本地票渲染的是跟踪器 ghost 按钮（点调宿主）')
}
// B2：顶栏 https 票 → a[href] 不动
{
  const st = {
    cwd: 'D:\\ws', activeIssue: 9, activeEffortId: '',
    snapshot: { issues: [{ number: 9, key: '9', title: '远端票', state: 'OPEN', labels: [], url: 'https://github.com/o/r/issues/9' }], maps: [] },
    issueMode: 'idle',
  }
  const html = renderDetail(st)
  check(html.includes('href="https://github.com/o/r/issues/9"'), '顶栏 https 票仍是 a 且 href 为网址（回归不动）')
}
// B3：报错横幅本地票（无 src 早返分支）→ button、无裸 href
{
  const st = {
    cwd: 'D:\\ws', activeIssue: 8, activeEffortId: '',
    snapshot: { issues: [], maps: [{ tickets: [{ number: 8, key: '8', url: 'D:\\ws\\issues\\08-y.md' }] }] },
    issueMode: 'err', issueError: { message: '炸了', kind: 'network' },
  }
  const html = renderDetail(st)
  check(!html.includes('href="D:'), '报错横幅本地票没有裸 href 链接')
  //   同上：类名表里多挂一个悬停类不算形状变了，判据仍要求它是 ghost 按钮且装的是 link 图标。
  check(/<button(?=[^>]*class="dsws-btn ghost[^"]*")(?=[^>]*type="button")[^>]*>\[link\]/.test(html),
    '报错横幅本地票渲染的是跟踪器 ghost 按钮')
}

// C 部分：md 容器行 number=0（key 00）经 issueUrlFor 必须拿得到本地路径（交接 bug：0 被 || 当空）
const MAP_ALPHA = 'D:\\ws\\.scratch\\alpha\\map.md'
const T1_ALPHA = 'D:\\ws\\.scratch\\alpha\\issues\\01-ticket.md'
function containerSt() {
  return {
    snapshot: {
      issues: [
        { number: 0, key: '00', title: 'Alpha Map', state: 'OPEN', labels: [], url: MAP_ALPHA, effortId: 'alpha' },
        { number: 1, key: '01', title: 'Alpha first', state: 'OPEN', labels: [], url: T1_ALPHA, effortId: 'alpha' },
      ],
      maps: [],
    },
  }
}
// C1：容器行传 number=0（列表行实际传 x.number）必须返回 map.md 路径
{
  const st = containerSt()
  const got = globalThis.issueUrlFor(st, 0, 'alpha')
  check(got === MAP_ALPHA, 'md 容器行 number=0 能拿回 map.md 路径（不是空串）')
}
// C2：容器行传 key=00 同样返回 map.md（双写法一致）
{
  const st = containerSt()
  const got = globalThis.issueUrlFor(st, '00', 'alpha')
  check(got === MAP_ALPHA, 'md 容器行 key=00 能拿回 map.md 路径')
}
// C3：容器行 openIssueUrl 调宿主 wf.openPath（跳转不断在取址就停）
{
  hostCalls.length = 0; opened.length = 0
  const st = containerSt()
  const fakeHost = { call: (m, a) => { hostCalls.push([m, a]); return Promise.resolve({ ok: true }) } }
  const ok = globalThis.openIssueUrl(st, 0, fakeHost, 'alpha')
  check(ok === true, 'md 容器行 openIssueUrl 返回 true（取到地址并尝试打开）')
  check(hostCalls.length === 1 && hostCalls[0][0] === 'wf.openPath' && hostCalls[0][1] && hostCalls[0][1].path === MAP_ALPHA,
    'md 容器行点击调宿主 wf.openPath 且 path 为 map.md')
  check(opened.length === 0, 'md 容器行没走 window.open（文件路径不是网址）')
}
// C4：普通子票 number=1 不回归
{
  const st = containerSt()
  const got = globalThis.issueUrlFor(st, 1, 'alpha')
  check(got === T1_ALPHA, '普通子票 number=1 仍返回自己文件路径（回归不动）')
}

console.log(failures ? `\n#1145 门禁失败 ${failures} 项（共 ${total} 条）` : `\n#1145 门禁全部通过（共 ${total} 条）`)
process.exit(failures ? 1 : 0)
