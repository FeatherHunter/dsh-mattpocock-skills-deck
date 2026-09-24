/**
 * tests/fixtures/chain-view-ui-probe.js —— 「每个会话在处理哪些票」那一块的浏览器探针
 * （由 tests/verify-chain-view-ui.js 用 esbuild 打包之后，在真 Chromium 里跑）
 *
 * 2026-09-24 维护者定：这一块**展示面暂时下线**（能力保留，见
 * src/client/views/shared/sessionChainView.js 文件头那段指针）。于是这一份探针要同时立起两面：
 *
 *   一、**真面板**（右侧边栏那一格的内容体，走真产物 package/lib/client.js）：把它挂起来、
 *       让它落在列表页上，用来量「面板里到底有没有那一块」。
 *       「真」的边界：组件、判据、词条全是仓库里那几份真文件；只有宿主（host.call 与那几条服务）
 *       用最小的假件代替，因为这一份门禁不验宿主、只验界面画了什么。
 *       挂载点选的是真路径：右侧边栏内容体槽位注册出来的那个组件（withCx(DeckSidebarTab)）——
 *       它内部就是真面板本体，不是另外搭一个像样的壳。
 *
 *   二、**能力本体**（views/shared/sessionChainView.js 按 scripts/build.mjs 同一套做法求值出来）：
 *       单独挂在一个自己的容器里。这一面有两个作用：证明能力没被拆掉；当反向自检 ——
 *       真把那一块画出来之后，同一把尺子必须找得到标题、找得到会话行、找得到「读不到处理记录」。
 *       抓不住就是假绿（那说明「面板里没有」是尺子失灵，不是面板里真的没有）。
 *
 * 两面的扫描用同一把尺子（window.__PANEL_SCAN__ / window.__STRIP_SCAN__ 共用 scanOf），
 *   量的都是 DOM 里真实存在的东西：看得见的字，以及属性（悬停提示那句话落在 aria-label 上，
 *   真 Tip 与这里的替身都写它，所以「那句还在不在」量得出来）。
 */
import React from 'react'
import * as ReactDOMClient from 'react-dom/client'

window.React = React
window.__RDOM__ = ReactDOMClient

const PANEL_HOST_ID = 'dsws-probe-panel'
const STRIP_HOST_ID = 'dsws-probe-strip'
const CWD = window.__CWD__
const SID = 'probe-session'
const SNAP = window.__SNAP__
// 尺子要量的两句原话（从真词条由门禁交进来，探针自己不抄一份文案）
const TEXTS = window.__TEXTS__ || {}

const dict = {}
window.__DICT_ZH__ = window.__DICT_ZH__ || {}
const trFn = (k, p) => {
  let s = (window.__DICT_ZH__[k] !== undefined) ? window.__DICT_ZH__[k] : (dict[k] !== undefined ? dict[k] : k)
  if (p) s = s.replace(/\{(\w+)\}/g, (m, n) => (n in p ? String(p[n]) : m))
  return s
}

// ---- 一、装真产物：宿主这一侧给最小假件（面板要什么答什么，都按真形状答）----
const reply = (method) => {
  if (method === 'wf.cwd' || method === 'cwd') return { ok: true, cwd: CWD }
  if (method === 'wf.snapshot' || method === 'wf.refresh' || method === 'snapshot' || method === 'refresh') return window.__SNAP_CUR__ || SNAP
  if (method === 'wf.chain' || method === 'chain') return { ok: true, snapshot: { steps: [] }, chain: [], fullChain: null, resolved: [] }
  if (method === 'wf.registry' || method === 'registry') return { ok: true, modules: [{ id: 'github', label: 'GitHub' }, { id: 'markdown', label: 'Markdown' }] }
  return { ok: true }
}
// host 是产物里的自由变量（真宿主由壳注入）：探针先把 window.host 立起来，产物才能在装载时就用它。
window.host = { call: (method, args) => Promise.resolve(reply(method)) }

let loaded = null
window.__ModuleLoader__ = { load(spec) { loaded = spec; return spec } }
window.eval(window.__CLIENT_SRC__)

const regs = []
const services = {
  slots: { register: (m, c) => { regs.push({ m, c }); return () => {} }, inject: (n, f) => { try { f() } catch (e) {} } },
  sidebarRightTabs: { register: () => () => {} },
  connection: { rpc: { call: async (channel, endpoint, body) => ({ ok: true, value: reply(body && body.method) }) } },
  locale: { register: (ns, d) => { Object.assign(dict, (d && d.zh) || {}); return () => {} }, bind: () => trFn },
  workspaces: { list: async () => [] },
  sessions: { list: async () => [] },
  timer: { timeout: (f, ms) => setTimeout(f, ms) },
}
const ctx = { get: (k) => services[k], effect: (f) => { f(); return () => {} }, inject: (deps, cb) => { cb(ctx); return { dispose: () => {} } } }
loaded.factory((m) => (m === 'react' ? React : m === 'react-dom' ? ReactDOMClient : {})).apply(ctx)

// 右侧边栏内容体那格（真面板本体的落点）：它内部先出空壳、下一帧再挂 DetailsDock（#603）。
const paneReg = regs.filter((r) => r.m && r.m.name === 'sidebar.right.pane.tab')[0] || null
const PanelBody = paneReg ? paneReg.c : null

window.__TICK__ = async function (n) {
  for (let i = 0; i < (n || 2); i++) await new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 16) }) })
}
window.__WAIT__ = (pred, ms) => new Promise((res) => {
  const t0 = Date.now()
  const tick = () => { if (pred() || Date.now() - t0 > ms) res(!!pred()); else setTimeout(tick, 25) }
  tick()
})

const hostOf = function (id) {
  let el = document.getElementById(id)
  if (!el) { el = document.createElement('div'); el.id = id; document.getElementById('pane').appendChild(el) }
  return el
}

// ---- 二、那块的**能力本体**：按 scripts/build.mjs 那套做法求值出来（剥行首 export 之后跑在一个作用域里）----
const stripFn = new Function('React', 'DswsCtx', 'tr', 'Ic', 'Tip', 'pushNav',
  'return (function(){' + window.__LEAF_SRC__.replace(/^[ \t]*export[ \t]+/gm, '') + '\nreturn SessionChainStrip })()')
// DswsCtx 得是一个真的 React context（组件里 React.useContext(DswsCtx) 会读它的 $$typeof）；
//   给一个空值会在 render 里当场抛错。这里自己造一个：值取 null，组件就退回 React.createElement 画。
const DSW_CTX = React.createContext(null)
const TipStub = function (props) {
  // 真 Tip 把整句提示写成触发元素上的 aria-label（views/primitives/Tip.js 的 a11y 那一段）；
  //   这里照同一件事写给替身，并另挂一个 data-tip 便于人来查。悬停浮层要鼠标放上去才画，这里不模拟。
  const text = String((props && props.content) || '')
  return React.createElement('span', { 'data-tip': text, 'aria-label': text }, props && props.children)
}
const Strip = stripFn(React, DSW_CTX, trFn,
  function Ic(props) { return React.createElement('svg', { width: 12, height: 12 }) },
  TipStub,
  undefined)

// ---- 三、同一把尺子：两面共用（量的都是这个容器里真实存在的字与属性）----
const scanOf = function (host) {
  if (!host) return { ok: false, missing: true }
  const html = String(host.innerHTML || '')
  return {
    ok: true,
    titleFound: !!TEXTS.title && html.indexOf(TEXTS.title) >= 0,
    unreadableFound: !!TEXTS.unreadable && html.indexOf(TEXTS.unreadable) >= 0,
    chainBlock: host.querySelectorAll('.dsws-chainview').length,
    chainRows: host.querySelectorAll('.dsws-chainview-row').length,
    sessionMarks: host.querySelectorAll('[data-session]').length,
    rowCapNotice: host.querySelectorAll('[data-chain-rest]').length,
    listChips: host.querySelectorAll('.dsws-chip').length,
    panelBodies: host.querySelectorAll('.dsws-body').length,
    text: String(host.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240),
  }
}
window.__PANEL_SCAN__ = () => scanOf(document.getElementById(PANEL_HOST_ID))
window.__STRIP_SCAN__ = () => scanOf(document.getElementById(STRIP_HOST_ID))

// 真面板：挂右侧边栏内容体组件那一格（props 按宿主交给它的形状给：会话号 + 会话）。
window.__PANEL_MOUNT__ = async function (payload) {
  if (!PanelBody) return { ok: false, why: '右侧边栏内容体组件没有注册上来' }
  window.__SNAP_CUR__ = payload
  const host = hostOf(PANEL_HOST_ID)
  if (!window.__PANEL_ROOT__) window.__PANEL_ROOT__ = ReactDOMClient.createRoot(host)
  let thrown = null
  try {
    window.__PANEL_ROOT__.render(React.createElement(PanelBody, {
      sessionId: SID,
      session: { cwd: CWD },
      useSessions: function () { return null },
    }))
  } catch (e) { thrown = String((e && e.message) || e) }
  const arrived = await window.__WAIT__(function () { return !!host.querySelector('.dsws-body') }, 8000)
  await window.__TICK__(2)
  return { ok: arrived && !thrown, arrived: arrived, thrown: thrown, panelBodies: host.querySelectorAll('.dsws-body').length }
}

// 能力本体：挂在一个自己的容器里（与面板那棵树互不干扰）。
window.__STRIP_MOUNT__ = async function (payload) {
  const host = hostOf(STRIP_HOST_ID)
  if (!window.__STRIP_ROOT__) window.__STRIP_ROOT__ = ReactDOMClient.createRoot(host)
  let thrown = null
  try {
    window.__STRIP_ROOT__.render(React.createElement(Strip, {
      st: { snapshot: payload, snapMode: 'real', cwd: CWD, narrow: false },
      narrow: false,
    }))
  } catch (e) { thrown = String((e && e.message) || e) }
  await window.__TICK__(2)
  await window.__WAIT__(function () { return host.childNodes.length > 0 }, 4000)
  await window.__TICK__(1)
  return { ok: !thrown, thrown: thrown }
}

// 造一份「N 条记录」的快照（一个会话、N 条记录，与链那边一样按时间倒序）：量行数与封顶那一行用。
//   会话标识用十六进制散列 —— 与真机同形。
window.__STRIP_SNAP_WITH__ = function (n) {
  const one = []
  for (let i = 0; i < n; i++) one.push({ ticketKey: String(900 - i), action: (i % 2 ? 'comment' : 'edit'), at: window.__READ_AT__ - (i + 1) * 60000 })
  const base = window.__SNAP__
  return Object.assign({}, base, {
    version: 'tier-' + n,
    generatedMs: window.__READ_AT__ + n,
    issues: [{ number: 900, title: '甲票标题', effortId: '' }],
    sessionTickets: { ok: true, at: window.__READ_AT__, sessions: [{ shardId: '307d37e6a1b2c3d4', backend: 'github', entries: one }] },
  })
}

window.__PROBE_READY__ = true
