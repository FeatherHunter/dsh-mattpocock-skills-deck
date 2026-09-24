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
 *
 * 另外还有**两把尺子**（门禁那一侧的 R8 / R9 用，2026-09-24 从门禁搬进这一份里）：
 *   能力本体画出来的**版面上**不许出现 8 位十六进制散列、也不许出现内部行话；把这两样塞回一行
 *   可见文字之后，同一段判据必须当场报红（抓不住就是尺子失灵）。两把尺子共用下面那一段 rulerHitsOf，
 *   「取可见文字」那一步也照 tests/verify-chain-view.js 里既有的那份取法抄（悬停提示不算版面上的字）。
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

// ---- 四、两把尺子：版面上不许出现 8 位十六进制散列、也不许出现内部行话 ----
// 2026-09-24 那次提交（把这一块从面板摘下来，29dd75d）顺手删掉了门禁里量这两件事的两条断言
//   （当时叫 U2/U3，配套的反证叫 U5）。能力既然一行未删地留着，这两把尺子就得跟着留：
//   量的是**能力本体单独挂出来之后画在版面上**的字（面板里已经没有它了）。
// 尺子为什么放在探针这一侧：R8（量真版面）与 R9（往克隆出来的一行里塞回这两样、再用同一把尺子量）
//   必须是**同一段判据**；各写一份就成了两把尺子 —— 一把坏了另一把照旧绿，反证也就没有意义了。
const HEX8 = /(?:^|[^0-9a-f])([0-9a-f]{8})(?![0-9a-f])/i
const JARGON = ['宿主读数', '宿主', '读数', '分格', '散列']
/** 唯一的尺子：一行行的可见文字进去，命中的行出来（散列与行话分开报，便于定位）。 */
const rulerHitsOf = function (lines) {
  const all = (Array.isArray(lines) ? lines : []).map(function (t) { return String(t) })
  const hexLines = all.filter(function (t) { return HEX8.test(t) })
  const jargonLines = all.filter(function (t) { return JARGON.some(function (w) { return t.indexOf(w) >= 0 }) })
  return { hexLines: hexLines, jargonLines: jargonLines, hits: hexLines.concat(jargonLines) }
}
/** 这一把尺子长什么样（门禁把它的原样打进报告：量的就是这一段判据，不是门禁里另抄的一份）。 */
window.__RULER_WHAT__ = function () { return { hexSource: HEX8.source, hexFlags: HEX8.flags, jargon: JARGON.slice() } }
window.__RULER_HITS__ = rulerHitsOf

// 「这一块**自己**看得见的文字」怎么取 —— 照 tests/verify-chain-view.js 里既有的那份取法抄：
//   那一边的 visibleTextOf 把 Tip（悬停提示）整棵子树排除在外（悬停里带着完整标识是这一版的要求）。
//   落到 DOM 上就是两件事：① 提示那一份落在**属性**上（真 Tip 与这里的替身都写 aria-label，替身
//   另写一个 data-tip 便于人来查），属性不是版面上的字，所以这里只走文字节点、一个属性都不读；
//   ② display:none / visibility:hidden 的节点在这一版面上看不见，取字时跳过整棵子树。
const visibleTextOfNode = function (el) {
  if (!el) return ''
  const out = []
  const walk = function (n) {
    if (!n) return
    if (n.nodeType === 3) { out.push(String(n.nodeValue || '')); return }
    if (n.nodeType !== 1) return
    const cs = window.getComputedStyle(n)
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return
    const kids = n.childNodes
    for (let i = 0; i < kids.length; i++) walk(kids[i])
  }
  walk(el)
  return out.join('').replace(/\s+/g, ' ').trim()
}

/** 这一块画出来的**版面**：顶层每个孩子算一行（与从前那一版门禁同一取法：一行 = 块的一个顶层孩子）。 */
const visibleTextLinesOf = function (block) {
  if (!block) return []
  const kids = block.children
  const lines = []
  for (let i = 0; i < kids.length; i++) lines.push(visibleTextOfNode(kids[i]))
  return lines
}
const stripBlockOf = function () {
  const host = document.getElementById(STRIP_HOST_ID)
  return host ? host.querySelector('.dsws-chainview') : null
}

/** R8 量的是这一份：能力本体（正常读数那一份）画出来的每一行可见文字。 */
window.__STRIP_TEXT_LINES__ = function () {
  const block = stripBlockOf()
  if (!block) return { ok: false, why: '能力本体没有画出来（容器里找不到 .dsws-chainview）', lines: [], rows: 0, nonEmpty: 0 }
  const lines = visibleTextLinesOf(block)
  return {
    ok: true, lines: lines,
    rows: block.querySelectorAll('.dsws-chainview-row').length,
    nonEmpty: lines.filter(Boolean).length,
  }
}

/**
 * R9 的反证件：克隆出来的一行可见文字，往这一行里塞回一个 8 位散列与「宿主读数」，
 *   再用上面**同一段**判据（rulerHitsOf）量一遍 —— 量不出命中就是尺子失灵，门禁必须判红。
 * 两件事都要做，缺一件就会给假绿留一道缝：
 *   ① 文字层面：把塞回去的那一行交给同一把尺子（证明这一段判据认得出散列与行话）；
 *   ② 版面层面：真克隆一个节点、把字写进节点里、再走一遍「取可见文字」那一步
 *      （证明取字那一步也看得见塞回去的字 —— 只做①的话，取字那一步写成「永远返回空」照样绿）。
 * 克隆件挪到版面外（left:-10000px）而不是用 display:none / visibility:hidden 藏它：
 *   取可见文字那一步会跳过看不见的节点，用那两种藏法反证件自己就取不到字了 —— 那就成了假红。
 * 真节点一个字不碰：动的全是克隆件，量完就 remove。
 * 挑哪一行：优先一条记录行（.dsws-chainview-row），块里没有记录行就退回头一行（说明行）——
 *   两种都是一行可见文字，报告里会把「塞的是哪一行、塞之前长什么样」原样写出来。
 */
window.__STRIP_TEXT_COUNTERCHECK__ = function () {
  const block = stripBlockOf()
  if (!block) return { ok: false, why: '能力本体没有画出来，反证件无从下手' }
  const lines = visibleTextLinesOf(block)
  const fakeHex = '307d37e6'
  const fakeJargon = '宿主读数'
  // 克隆整块（真节点一个字不碰），从克隆件里挑**一行有字的**：优先一条记录行，块里没有记录行就退回头一行。
  const clone = block.cloneNode(true)
  clone.style.position = 'absolute'
  clone.style.left = '-10000px'
  clone.style.top = '0'
  document.body.appendChild(clone)
  const row = clone.querySelector('.dsws-chainview-row') || clone.children[0] || null
  // 克隆出来这一行**自己的**可见文字（塞之前长什么样，报告里要留一份原文）
  const lineBefore = row ? visibleTextOfNode(row) : ''
  const injectedText = (lineBefore || lines.filter(Boolean)[0] || '') + ' · 会话 ' + fakeHex + ' · ' + fakeJargon + ' · 16:50'
  // ① 文字层面：把塞回去的这一行交给同一把尺子
  const textHit = rulerHitsOf([injectedText])
  // ② 版面层面：把这一行**写进节点**，再走一遍「取可见文字」那一步，仍旧交给同一把尺子
  if (row) row.textContent = injectedText
  const injectedInto = row ? (row.className ? 'div.' + row.className : row.nodeName) : 'none'
  const clonedLines = visibleTextLinesOf(clone)
  const nodeHit = rulerHitsOf(clonedLines)
  const injectedInNode = row ? visibleTextOfNode(row) : ''
  clone.remove()
  return {
    ok: true,
    fakeHex: fakeHex,
    fakeJargon: fakeJargon,
    lineBefore: lineBefore,
    injectedInto: injectedInto,
    injectedText: injectedText,
    injectedInNode: injectedInNode,
    clonedLines: clonedLines,
    textHexHits: textHit.hexLines.length,
    textJargonHits: textHit.jargonLines.length,
    nodeHexHits: nodeHit.hexLines.length,
    nodeJargonHits: nodeHit.jargonLines.length,
  }
}

window.__PROBE_READY__ = true
