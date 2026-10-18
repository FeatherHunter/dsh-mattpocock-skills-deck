// tests/verify-1199-row-closed-link.ts —— #1199 门禁：列表行已关闭票的查看链接 + 打开 helper 无窗口误报
// https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1199
// 判据（第一性原理）：
// 1. 已关闭行与打开行是同一控件（查看链接），本地票的 url 是文件路径不是网址，
//    `<a href="D:\…">` 点了没反应；唯一诚实动作是调宿主 openPath（https 票走 `<a target=_blank>` 不动）。
// 2. openIssueUrl 在没有 window 的环境调 https 分支，必须回假——回真就是谎报打开成功。
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1199-row-closed-link.ts
// 说明：行分支走 react-dom/server 静态渲染断（button vs 裸 a）；点击行为走 helper
// 的纯行为断言（已关闭行的点击闭包与同一文件打开分支的闭包是同一形状，行为由 helper
// 门禁覆盖；直接调组件函数拿 onClick 需要 React 调度器，不值得为它引入整套 DOM 环境）。
// 全程不用 DOM：静态字符串断言加纯函数调用就够了。
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
globalThis.Ic = (props) => ('[' + ((props && props.n) || '?') + ']')
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
// 列表行渲染用到的其余全局量：CLOSED 行走不到 opener 分支，桩成空即可
globalThis.tStatusBadge = () => null
globalThis.TypeChip = () => null
globalThis.blockerNames = () => ''
globalThis.tProgressBar = () => null
globalThis.mkRowAction = () => null
globalThis.hexA = () => '#000'
globalThis.isLightHex = () => false
globalThis.actionColorOf = () => '#fff'
const TipStub = (props) => React.createElement('span', { 'data-tip': String(props.content) }, props.children)
globalThis.Tip = TipStub
globalThis.React = React

// 动态导入必须在全局量齐备之后
const linkMod = await import('../src/client/kernel/link.js')
globalThis.issueUrlFor = linkMod.issueUrlFor
globalThis.openIssueUrl = linkMod.openIssueUrl
const { DswsCtx, createCx } = await import('../src/client/kernel/ctx.js')
const { TicketRow } = await import('../src/client/views/TicketRow.js')
globalThis.DswsCtx = DswsCtx

let failures = 0
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

const services = {
  slots: { register: () => () => {}, inject: (name, fn) => { try { fn() } catch (e) {} } },
  locale: { register: () => () => {}, bind: () => trFn },
  timer: { timeout: (fn, ms) => setTimeout(fn, ms) },
}
const fakeStore = { snapshot: null, sessionId: 'test', tab: 'list', cwd: 'D:\\ws', issuePath: { current: null, nodes: [] }, noRepoCard: { expanded: false } }
function makeCx(h) {
  return createCx({
    ctx: { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} }, inject: (deps, cb) => { cb({ get: (k) => services[k] }); return { dispose: () => {} } } },
    h,
    rdom: {},
    storeSvc: { shared: fakeStore, stores: {}, makeStore: () => fakeStore, storeOf: () => fakeStore, emit: () => {}, sub: () => () => {}, useStore: () => fakeStore },
    localeSvc: services.locale,
    timer: services.timer,
    api: { call: async () => ({ ok: true }), inject: () => {}, copyText: async () => {} },
    router: { open: () => {}, toggle: () => {} },
  })
}
const MD8 = 'D:\\ws\\issues\\08-x.md'
function rowProps(url) {
  const t = { number: 8, key: '8', title: '行票', state: 'CLOSED', labels: [], blockedBy: [], url }
  const g = { m: { tickets: [] } }
  const st = { snapshot: { issues: [{ number: 8, key: '8', url }], maps: [] } }
  return { st, g, t }
}
// 第一遍：真 h 静态渲染，断分支
function renderStatic(url) {
  const { st, g, t } = rowProps(url)
  return renderToStaticMarkup(React.createElement(DswsCtx.Provider, { value: makeCx(React.createElement) },
    React.createElement(TicketRow, { st, g, t, indent: 0, colorOf: () => '#fff' })))
}
// ---- 静态渲染用的行 props 与渲染函数 ----
// C1：已关闭行本地票 → 没有裸 href，是 ghost button
{
  const html = renderStatic(MD8)
  check(!html.includes('href="D:'), '已关闭行本地票没有裸 href 链接')
  check(/<button(?=[^>]*class="dsws-btn ghost")(?=[^>]*type="button")[^>]*>act\.view<\/button>/.test(html),
    '已关闭行本地票渲染的是查看 ghost 按钮（文案与原来一致，点调宿主）')
}
// C2：已关闭行 https 票 → 仍是 a[href]，不动
{
  const html = renderStatic('https://github.com/o/r/issues/8')
  check(html.includes('href="https://github.com/o/r/issues/8"'), '已关闭行 https 票仍是 a 且 href 为网址（回归不动）')
}
// C3：helper 本地分支 → 走宿主（守 link.js 本地分支不动）
{
  hostCalls.length = 0; opened.length = 0
  const st = { snapshot: { issues: [{ number: 8, key: '8', url: MD8 }], maps: [] } }
  const r = linkMod.openIssueUrl(st, 8, globalThis.host)
  check(r === true && hostCalls.length === 1 && hostCalls[0][0] === 'wf.openPath' && hostCalls[0][1] && hostCalls[0][1].path === MD8,
    '本地票走宿主 wf.openPath 且 path 为票文件路径')
}
// C4：无窗口环境调 https 分支 → 回假（回真就是谎报打开成功）
{
  delete globalThis.window
  opened.length = 0
  const st = { snapshot: { issues: [{ number: 8, key: '8', url: 'https://github.com/o/r/issues/8' }], maps: [] } }
  const r = linkMod.openIssueUrl(st, 8, globalThis.host)
  check(r === false, '无窗口环境 https 分支回假（不谎报打开成功）')
  check(opened.length === 0, '无窗口环境没调 window.open')
}
// C5：有窗口环境调 https 分支 → 仍回真（面板真机行为不动）
{
  opened.length = 0
  const st = { snapshot: { issues: [{ number: 8, key: '8', url: 'https://github.com/o/r/issues/8' }], maps: [] } }
  let r = null
  withWindowStub(() => { r = linkMod.openIssueUrl(st, 8, globalThis.host) })
  check(r === true && opened.length === 1, '有窗口环境 https 分支回真且调 window.open（回归不动）')
}

console.log(failures ? `\n#1199 门禁失败 ${failures} 项（共 ${total} 条）` : `\n#1199 门禁全部通过（共 ${total} 条）`)
process.exit(failures ? 1 : 0)
