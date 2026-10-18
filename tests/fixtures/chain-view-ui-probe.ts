// tests/fixtures/chain-view-ui-probe.ts
//
// 「每个会话在处理哪些票」那一块的浏览器探针（由 tests/verify-chain-view-ui.js 用 esbuild 打包之后，在真 Chromium 里跑）。
//
// 这份探针同时立起两面（判据见门禁文件头）：
//   一、真面板（右侧边栏内容体槽位注册出来的那个组件 withCx(DeckSidebarTab)，内部是真面板本体）；
//   二、能力本体（src/client/views/shared/sessionChainView.js 按 scripts/build.mjs 同一套做法求值出来）。
// 两面的扫描共用同一把尺子（scanOf），量的都是 DOM 里真实存在的东西；R8 / R9 两把尺子（版面上不许出现
// 8 位十六进制散列与内部行话、以及它们的反证件）共用下面 rulerHitsOf 这一段判据。
//
// 由 tests/fixtures/chain-view-ui-probe.js 转来（#1239）：运行时语义逐行不变，只补类型标注与模块写法。
// 转写时不可破坏的红线：
//   1. 零 Node API —— 页面里没有 node:vm 也不能 require，保持只用浏览器全局量与外部注入的 window.__X__；
//   2. window.__X__ 全是门禁事先注入的（__CLIENT_SRC__ / __LEAF_SRC__ / __SNAP__ / __DICT_ZH__ / __TEXTS__ /
//      __READ_AT__），探针自己不抄文案、不造数据，只从注入里读；
//   3. 快照形状、HEX8 正则、JARGON 黑名单、反证件塞回去的字面量（'307d37e6' / '宿主读数'）一个字不许变，
//      它们与门禁报告里的期望逐字互证；
//   4. 只写可剥离的 TypeScript（接口与类型标注，不做语法转换的写法一律不用）。
import React from 'react'
import * as ReactDOMClient from 'react-dom/client'

/** 门禁注入的页面全局量：探针运行前全部由门禁用脚本标签写好，缺一个就是门禁的错，不是探针的错。 */
interface InjectedGlobals {
  __CWD__: string
  __SNAP__: Snapshot
  __SNAP_CUR__?: Snapshot
  __TEXTS__?: { title?: string, unreadable?: string }
  __DICT_ZH__?: Record<string, string>
  __CLIENT_SRC__?: string
  __LEAF_SRC__?: string
  __READ_AT__?: number
}

/** 快照里探针真正会读到的部分：只读这几个字段，多了不认、少了按“没拿到”处理。 */
interface Snapshot {
  ok?: unknown
  issues?: Array<{ number?: unknown, title?: unknown, effortId?: unknown }>
  workRoute?: {
    ok?: unknown
    at?: unknown
    sessions?: Array<{
      shardId?: unknown
      backend?: unknown
      entries?: Array<{ ticketKey?: unknown, action?: unknown, at?: unknown }>
    }>
  }
}

/** 单条处理记录：会话标识的形状与真机同形，会话标识用十六进制散列。 */
interface TicketEntry {
  ticketKey: string
  action: string
  at: number
}

/** scanOf 交回去的扫描结果：量的全是容器里真实存在的字与属性。 */
interface PanelScan {
  ok: boolean
  missing?: boolean
  titleFound?: boolean
  unreadableFound?: boolean
  chainBlock?: number
  chainRows?: number
  sessionMarks?: number
  rowCapNotice?: number
  listChips?: number
  panelBodies?: number
  text?: string
}

/** rulerHitsOf 交回去的命中：散列与行话分开报，便于门禁定位是哪一类漏网。 */
interface RulerHits {
  hexLines: string[]
  jargonLines: string[]
  hits: string[]
}

/** 能力本体版面文字：顶层每个孩子算一行，空行原样保留，门禁数得到有几行有字。 */
interface StripTextLines {
  ok: boolean
  why?: string
  lines: string[]
  rows: number
  nonEmpty: number
}

/** R9 反证件的完整回执：塞了什么、塞在哪一行、文字层面与版面层面各命中几行，全留给门禁写进报告。 */
interface StripCounterCheck {
  ok: boolean
  why?: string
  fakeHex?: string
  fakeJargon?: string
  lineBefore?: string
  injectedInto?: string
  injectedText?: string
  injectedInNode?: string
  clonedLines?: string[]
  textHexHits?: number
  textJargonHits?: number
  nodeHexHits?: number
  nodeJargonHits?: number
}

/** 页面里用到的 DOM 最小形状：只列探针真正碰到的成员，类型只为读得明白，不参与运行。 */
interface DomNode {
  nodeType: number
  nodeValue: string | null
}
interface DomCollection {
  length: number
  [i: number]: DomElement
}
interface DomElement {
  innerHTML: string
  textContent: string | null
  children: DomCollection
  childNodes: ArrayLike<DomNode> & { [i: number]: DomNode }
  className: string
  nodeName: string
  style: { position: string, left: string, top: string }
  id: string
  querySelector(sel: string): DomElement | null
  querySelectorAll(sel: string): DomCollection
  appendChild(n: unknown): void
  cloneNode(deep?: boolean): DomNode
  remove(): void
}
interface DomDocument {
  getElementById(id: string): DomElement | null
  createElement(tag: string): DomElement
  querySelector(sel: string): DomElement | null
  body: DomElement
}
const DOC = document as unknown as DomDocument
const styleOf = getComputedStyle as unknown as (el: DomElement) => { display: string, visibility: string }
const nextFrame = requestAnimationFrame as unknown as (cb: () => void) => number

const W = window as unknown as InjectedGlobals & Record<string, unknown>

W.React = React
W.__RDOM__ = ReactDOMClient

const PANEL_HOST_ID = 'dsws-probe-panel'
const STRIP_HOST_ID = 'dsws-probe-strip'
const CWD: string = W.__CWD__
const SID = 'probe-session'
const SNAP: Snapshot = W.__SNAP__
// 尺子要量的两句原话（从真词条由门禁交进来，探针自己不抄一份文案）
const TEXTS: { title?: string, unreadable?: string } = (W.__TEXTS__ as { title?: string, unreadable?: string } | undefined) || {}

const dict: Record<string, string> = {}
W.__DICT_ZH__ = (W.__DICT_ZH__ as Record<string, string> | undefined) || {}
const trFn = (k: string, p?: Record<string, unknown>): string => {
  const bag = W.__DICT_ZH__ as Record<string, string>
  let s: string = (bag[k] !== undefined) ? bag[k] : (dict[k] !== undefined ? dict[k] : k)
  if (p) s = s.replace(/\{(\w+)\}/g, (m: string, n: string) => (n in p ? String(p[n]) : m))
  return s
}

// ---- 一、装真产物：宿主这一侧给最小假件（面板要什么答什么，都按真形状答）----
const reply = (method: string): unknown => {
  if (method === 'wf.cwd' || method === 'cwd') return { ok: true, cwd: CWD }
  if (method === 'wf.snapshot' || method === 'wf.refresh' || method === 'snapshot' || method === 'refresh') return (W.__SNAP_CUR__ as Snapshot | undefined) || SNAP
  if (method === 'wf.chain' || method === 'chain') return { ok: true, snapshot: { steps: [] }, chain: [], fullChain: null, resolved: [] }
  if (method === 'wf.registry' || method === 'registry') return { ok: true, modules: [{ id: 'github', label: 'GitHub' }, { id: 'markdown', label: 'Markdown' }] }
  return { ok: true }
}
// host 是产物里的自由变量（真宿主由壳注入）：探针先把 window.host 立起来，产物才能在装载时就用它。
;(W as Record<string, unknown>).host = { call: (method: string, _args: unknown) => Promise.resolve(reply(method)) }

interface ModuleSpec {
  factory(f: (m: string) => unknown): { apply(c: ProbeContext): void }
}
let loaded: ModuleSpec | null = null
;(W as Record<string, unknown>).__ModuleLoader__ = { load(spec: ModuleSpec) { loaded = spec; return spec } }
// 本文件由门禁用 esbuild 打包后在真 Chromium 的页面里跑，页面里没有 node:vm，也不能用 require 引共用入口；
//   所以按页面内执行代码的正规做法插一段经典脚本让它自己跑（与 tests/lib/eval-probe.js 里那份插脚本的手法一致）。
const runInPage = (code: string): void => {
  const s = DOC.createElement('script')
  s.textContent = String(code)
  DOC.body.appendChild(s)
}
runInPage(String(W.__CLIENT_SRC__))

interface SlotServices {
  register(m: unknown, c: unknown): () => void
  inject(n: string, f: () => void): void
}
const regs: Array<{ m: { name: string }, c: unknown }> = []
const services = {
  slots: {
    register: (m: { name: string }, c: unknown) => { regs.push({ m, c }); return () => {} },
    inject: (_n: string, f: () => void) => { try { f() } catch (e) {} },
  } as SlotServices,
  sidebarRightTabs: { register: () => () => {} },
  connection: { rpc: { call: async (_channel: string, _endpoint: string, body: { method: string }) => ({ ok: true, value: reply(body && body.method) }) } },
  locale: { register: (_ns: string, d: { zh?: Record<string, string> }) => { Object.assign(dict, (d && d.zh) || {}); return () => {} }, bind: () => trFn },
  workspaces: { list: async () => [] as unknown[] },
  sessions: { list: async () => [] as unknown[] },
  timer: { timeout: (f: () => void, ms: number) => setTimeout(f, ms) },
}
interface ProbeContext {
  get(k: string): unknown
  effect(f: () => void): () => void
  inject(deps: unknown, cb: (ctx: ProbeContext) => void): { dispose(): void }
}
const ctx: ProbeContext = {
  get: (k: string) => (services as Record<string, unknown>)[k],
  effect: (f: () => void) => { f(); return () => {} },
  inject: (_deps: unknown, cb: (c: ProbeContext) => void) => { cb(ctx); return { dispose: () => {} } },
}
;(loaded as unknown as ModuleSpec).factory((m: string) => (m === 'react' ? React : m === 'react-dom' ? ReactDOMClient : {})).apply(ctx)

// 右侧边栏内容体那格（真面板本体的落点）：它内部先出空壳、下一帧再挂 DetailsDock（#603）。
const paneReg = regs.filter((r) => r.m && r.m.name === 'sidebar.right.pane.tab')[0] || null
const PanelBody = paneReg ? paneReg.c : null

W.__TICK__ = async function (n?: number): Promise<void> {
  for (let i = 0; i < (n || 2); i++) await new Promise<void>(function (r) { nextFrame(function () { setTimeout(r, 16) }) })
}
W.__WAIT__ = (pred: () => boolean, ms: number) => new Promise<boolean>((res) => {
  const t0 = Date.now()
  const tick = (): void => { if (pred() || Date.now() - t0 > ms) res(!!pred()); else setTimeout(tick, 25) }
  tick()
})

const hostOf = function (id: string): DomElement {
  let el = DOC.getElementById(id)
  if (!el) { el = DOC.createElement('div'); el.id = id; (DOC.getElementById('pane') as DomElement).appendChild(el) }
  return el
}

// ---- 二、那块的**能力本体**：按 scripts/build.mjs 那套做法求值出来（剥行首 export 之后跑在一个作用域里）----
// 同一手法：叶子源码这一段同样在页面里执行，所以不造函数，改成插一段经典脚本 ——
//   那六个依赖先摆到 window 上，脚本里再取回来当自由变量；结果由脚本自己挂到 window 上，读回来就是原来的 Strip。
// DswsCtx 得是一个真的 React context（组件里 React.useContext(DswsCtx) 会读它的 $$typeof）；
//   给一个空值会在 render 里当场抛错。这里自己造一个：值取 null，组件就退回 React.createElement 画。
const DSW_CTX = (React as unknown as { createContext(v: null): unknown }).createContext(null)
const TipStub = function (props: { content?: unknown, children?: unknown }): unknown {
  // 真 Tip 把整句提示写成触发元素上的 aria-label（views/primitives/Tip.js 的 a11y 那一段）；
  //   这里照同一件事写给替身，并另挂一个 data-tip 便于人来查。悬停浮层要鼠标放上去才画，这里不模拟。
  const text = String((props && props.content) || '')
  return (React as unknown as { createElement(t: string, p: unknown, c: unknown): unknown }).createElement('span', { 'data-tip': text, 'aria-label': text }, props && props.children)
}
const IcStub = function Ic(_props: unknown): unknown {
  return (React as unknown as { createElement(t: string, p: unknown): unknown }).createElement('svg', { width: 12, height: 12 })
}
W.__STRIP_DEPS__ = { React: React, DswsCtx: DSW_CTX, tr: trFn, Ic: IcStub, Tip: TipStub, pushNav: undefined }
runInPage('window.__STRIP__ = (function () {\n' +
  'var d = window.__STRIP_DEPS__;\n' +
  'var React = d.React, DswsCtx = d.DswsCtx, tr = d.tr, Ic = d.Ic, Tip = d.Tip, pushNav = d.pushNav;\n' +
  String(W.__LEAF_SRC__).replace(/^[ \t]*export[ \t]+/gm, '') +
  '\nreturn SessionChainStrip;\n' +
  '})()')
const Strip = W.__STRIP__

// ---- 三、同一把尺子：两面共用（量的都是这个容器里真实存在的字与属性）----
const scanOf = function (host: DomElement | null): PanelScan {
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
W.__PANEL_SCAN__ = () => scanOf(DOC.getElementById(PANEL_HOST_ID))
W.__STRIP_SCAN__ = () => scanOf(DOC.getElementById(STRIP_HOST_ID))

// 真面板：挂右侧边栏内容体组件那一格（props 按宿主交给它的形状给：会话号 + 会话）。
W.__PANEL_MOUNT__ = async function (payload: Snapshot): Promise<{ ok: unknown, why?: string, arrived?: boolean, thrown?: string | null, panelBodies?: number }> {
  if (!PanelBody) return { ok: false, why: '右侧边栏内容体组件没有注册上来' }
  W.__SNAP_CUR__ = payload
  const host = hostOf(PANEL_HOST_ID)
  const bag = W as unknown as { __PANEL_ROOT__?: { render(n: unknown): void } }
  const RDOM = ReactDOMClient as unknown as { createRoot(el: unknown): { render(n: unknown): void } }
  if (!bag.__PANEL_ROOT__) bag.__PANEL_ROOT__ = RDOM.createRoot(host)
  const R = React as unknown as { createElement(t: unknown, p: unknown): unknown }
  let thrown: string | null = null
  try {
    bag.__PANEL_ROOT__.render(R.createElement(PanelBody, {
      sessionId: SID,
      session: { cwd: CWD },
      useSessions: function () { return null },
    }))
  } catch (e) { thrown = String((e as Error && (e as Error).message) || e) }
  const arrived = await (W.__WAIT__ as (pred: () => boolean, ms: number) => Promise<boolean>)(function () { return !!host.querySelector('.dsws-body') }, 8000)
  await (W.__TICK__ as (n?: number) => Promise<void>)(2)
  return { ok: arrived && !thrown, arrived: arrived, thrown: thrown, panelBodies: host.querySelectorAll('.dsws-body').length }
}

// 能力本体：挂在一个自己的容器里（与面板那棵树互不干扰）。
W.__STRIP_MOUNT__ = async function (payload: Snapshot): Promise<{ ok: boolean, thrown?: string | null }> {
  const host = hostOf(STRIP_HOST_ID)
  const bag = W as unknown as { __STRIP_ROOT__?: { render(n: unknown): void } }
  const RDOM = ReactDOMClient as unknown as { createRoot(el: unknown): { render(n: unknown): void } }
  if (!bag.__STRIP_ROOT__) bag.__STRIP_ROOT__ = RDOM.createRoot(host)
  const R = React as unknown as { createElement(t: unknown, p: unknown): unknown }
  let thrown: string | null = null
  try {
    bag.__STRIP_ROOT__.render(R.createElement(Strip, {
      st: { snapshot: payload, snapMode: 'real', cwd: CWD, narrow: false },
      narrow: false,
    }))
  } catch (e) { thrown = String((e as Error && (e as Error).message) || e) }
  await (W.__TICK__ as (n?: number) => Promise<void>)(2)
  await (W.__WAIT__ as (pred: () => boolean, ms: number) => Promise<boolean>)(function () { return host.childNodes.length > 0 }, 4000)
  await (W.__TICK__ as (n?: number) => Promise<void>)(1)
  return { ok: !thrown, thrown: thrown }
}

// 造一份「N 条记录」的快照（一个会话、N 条记录，与链那边一样按时间倒序）：量行数与封顶那一行用。
//   会话标识用十六进制散列 —— 与真机同形。
W.__STRIP_SNAP_WITH__ = function (n: number): Snapshot {
  const one: TicketEntry[] = []
  for (let i = 0; i < n; i++) one.push({ ticketKey: String(900 - i), action: (i % 2 ? 'comment' : 'edit'), at: (W.__READ_AT__ as number) - (i + 1) * 60000 })
  const base = W.__SNAP__
  return Object.assign({}, base, {
    version: 'tier-' + n,
    generatedMs: (W.__READ_AT__ as number) + n,
    issues: [{ number: 900, title: '甲票标题', effortId: '' }],
    workRoute: { ok: true, at: W.__READ_AT__, sessions: [{ shardId: '307d37e6a1b2c3d4', backend: 'github', entries: one }] },
  })
}

// ---- 四、两把尺子：版面上不许出现 8 位十六进制散列、也不许出现内部行话 ----
// 2026-09-24 那次提交（把这一块从面板摘下来，29dd75d）顺手删掉了门禁里量这两件事的两条断言
//   （当时叫 U2/U3，配套的反证叫 U5）。能力既然一行未删地留着，这两把尺子就得跟着留：
//   量的是**能力本体单独挂出来之后画在版面上**的字（面板里已经没有它了）。
// 尺子为什么放在探针这一侧：R8（量真版面）与 R9（往克隆出来的一行里塞回这两样、再用同一把尺子量）
//   必须是**同一段判据**；各写一份就成了两把尺子 —— 一把坏了另一把照旧绿，反证也就没有意义了。
const HEX8 = /(?:[^0-9a-f])([0-9a-f]{8})(?![0-9a-f])/i
const JARGON = ['宿主读数', '宿主', '读数', '分格', '散列']
/** 唯一的尺子：一行行的可见文字进去，命中的行出来（散列与行话分开报，便于定位）。 */
const rulerHitsOf = function (lines: unknown[]): RulerHits {
  const all = (Array.isArray(lines) ? lines : []).map(function (t) { return String(t) })
  const hexLines = all.filter(function (t) { return HEX8.test(t) })
  const jargonLines = all.filter(function (t) { return JARGON.some(function (w) { return t.indexOf(w) >= 0 }) })
  return { hexLines: hexLines, jargonLines: jargonLines, hits: hexLines.concat(jargonLines) }
}
/** 这一把尺子长什么样（门禁把它的原样打进报告：量的就是这一段判据，不是门禁里另抄的一份）。 */
W.__RULER_WHAT__ = function (): { hexSource: string, hexFlags: string, jargon: string[] } {
  return { hexSource: HEX8.source, hexFlags: HEX8.flags, jargon: JARGON.slice() }
}
W.__RULER_HITS__ = rulerHitsOf

// 「这一块**自己**看得见的文字」怎么取 —— 照 tests/verify-chain-view.js 里既有的那份取法抄：
//   那一边的 visibleTextOf 把 Tip（悬停提示）整棵子树排除在外（悬停里带着完整标识是这一版的要求）。
//   落到 DOM 上就是两件事：① 提示那一份落在**属性**上（真 Tip 与这里的替身都写 aria-label，替身
//   另写一个 data-tip 便于人来查），属性不是版面上的字，所以这里只走文字节点、一个属性都不读；
//   ② display:none / visibility:hidden 的节点在这一版面上看不见，取字时跳过整棵子树。
const visibleTextOfNode = function (el: DomNode | null): string {
  if (!el) return ''
  const out: string[] = []
  const walk = function (n: DomNode | null): void {
    if (!n) return
    if (n.nodeType === 3) { out.push(String(n.nodeValue || '')); return }
    if (n.nodeType !== 1) return
    const cs = styleOf(n as unknown as DomElement)
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return
    const kids = (n as unknown as DomElement).childNodes
    for (let i = 0; i < kids.length; i++) walk(kids[i] as unknown as DomNode)
  }
  walk(el)
  return out.join('').replace(/\s+/g, ' ').trim()
}

/** 这一块画出来的**版面**：顶层每个孩子算一行（与从前那一版门禁同一取法：一行 = 块的一个顶层孩子）。 */
const visibleTextLinesOf = function (block: DomElement | null): string[] {
  if (!block) return []
  const kids = block.children
  const lines: string[] = []
  for (let i = 0; i < kids.length; i++) lines.push(visibleTextOfNode(kids[i] as unknown as DomNode))
  return lines
}
const stripBlockOf = function (): DomElement | null {
  const host = DOC.getElementById(STRIP_HOST_ID)
  return host ? host.querySelector('.dsws-chainview') : null
}

/** R8 量的是这一份：能力本体（正常读数那一份）画出来的每一行可见文字。 */
W.__STRIP_TEXT_LINES__ = function (): StripTextLines {
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
W.__STRIP_TEXT_COUNTERCHECK__ = function (): StripCounterCheck {
  const block = stripBlockOf()
  if (!block) return { ok: false, why: '能力本体没有画出来，反证件无从下手' }
  const lines = visibleTextLinesOf(block)
  const fakeHex = '307d37e6'
  const fakeJargon = '宿主读数'
  // 克隆整块（真节点一个字不碰），从克隆件里挑**一行有字的**：优先一条记录行，块里没有记录行就退回头一行。
  const clone = block.cloneNode(true) as unknown as DomElement
  clone.style.position = 'absolute'
  clone.style.left = '-10000px'
  clone.style.top = '0'
  DOC.body.appendChild(clone)
  const row = (clone.querySelector('.dsws-chainview-row') || clone.children[0] || null) as DomElement | null
  // 克隆出来这一行**自己**的可见文字（塞之前长什么样，报告里要留一份原文）
  const lineBefore = row ? visibleTextOfNode(row as unknown as DomNode) : ''
  const injectedText = (lineBefore || lines.filter(Boolean)[0] || '') + ' · 会话 ' + fakeHex + ' · ' + fakeJargon + ' · 16:50'
  // ① 文字层面：把塞回去的这一行交给同一把尺子
  const textHit = rulerHitsOf([injectedText])
  // ② 版面层面：把这一行**写进节点**，再走一遍「取可见文字」那一步，仍旧交给同一把尺子
  if (row) row.textContent = injectedText
  const injectedInto = row ? (row.className ? 'div.' + row.className : row.nodeName) : 'none'
  const clonedLines = visibleTextLinesOf(clone)
  const nodeHit = rulerHitsOf(clonedLines)
  const injectedInNode = row ? visibleTextOfNode(row as unknown as DomNode) : ''
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

W.__PROBE_READY__ = true
