import React from 'react'
import * as ReactDOMClient from 'react-dom/client'
window.React = React
window.__RDOM__ = ReactDOMClient
const CWD = window.__CWD__
const SNAP = window.__SNAP__
let loaded = null
window.__ModuleLoader__ = { load(spec) { loaded = spec; return spec } }
window.eval(window.__CLIENT_SRC__)

const dict = {}
// 这一页只装中文那一半词条（界面画的每一个字都来自词条）：门禁量的是真词条，不是词条键。
window.__DICT_ZH__ = window.__DICT_ZH__ || {}
const trFn = (k, p) => {
  let s = (window.__DICT_ZH__[k] !== undefined) ? window.__DICT_ZH__[k] : (dict[k] !== undefined ? dict[k] : k)
  if (p) s = s.replace(/\{(\w+)\}/g, (m, n) => (n in p ? String(p[n]) : m))
  return s
}
const regs = []
const reply = (method) => {
  if (method === 'cwd') return { ok: true, cwd: CWD }
  if (method === 'snapshot' || method === 'refresh') return window.__SNAP_CUR__ || SNAP
  if (method === 'chain') return { ok: true, snapshot: { steps: [] }, chain: [], fullChain: null, resolved: [] }
  if (method === 'registry') return { ok: true, modules: [{ id: 'github', label: 'GitHub' }, { id: 'markdown', label: 'Markdown' }] }
  return { ok: true }
}
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

window.__TICK__ = async function (n) {
  for (let i = 0; i < (n || 2); i++) await new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 16) }) })
}
window.__WAIT__ = (pred, ms) => new Promise((res) => {
  const t0 = Date.now()
  const tick = () => { if (pred() || Date.now() - t0 > ms) res(!!pred()); else setTimeout(tick, 25) }
  tick()
})

// 这一块的本体（判据与画法）按 scripts/build.mjs 那套做法求值出来：叶子模块剥掉行首 export 之后跑在
//   一个作用域里，它依赖的那些自由变量（React / DswsCtx / tr / Ic / Tip / pushNav）在这个闭包里一并喂进去。
const stripFn = new Function('React', 'DswsCtx', 'tr', 'Ic', 'Tip', 'pushNav',
  'return (function(){' + window.__LEAF_SRC__.replace(/^[ \t]*export[ \t]+/gm, '') + '\nreturn SessionChainStrip })()')
// DswsCtx 得是一个真的 React context（组件里 React.useContext(DswsCtx) 会读它的 $$typeof）；
//   给一个空值会在 render 里当场抛错。这里自己造一个：值取 null，组件就退回 React.createElement 画。
const DSW_CTX = React.createContext(null)
const Strip = stripFn(React, DSW_CTX, trFn,
  function Ic(props) { return React.createElement('svg', { width: 12, height: 12 }) },
  function Tip(props) {
    // Tip 在真实现里把内容画进一个 hover 浮层（要鼠标放上去才画，且是 fixed 的另一层）。
    //   这里把同一句话挂成 data-tip（外层那个 span 的属性），版面上一个字都不多。
    return React.createElement('span', { 'data-tip': String(props.content || '') }, props.children)
  },
  undefined)

// 造一份「N 条记录」的快照：一个会话、N 条记录（与链那边一样按时间倒序）。
//   会话标识用十六进制散列 —— 与真机同形，这正是「不许上版面」的那一串。
//   注意整份快照的形状：这一块读的是快照上的 sessionTickets 字段（不是那一份读数本身）。
window.__SNAP_WITH__ = function (n) {
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
window.__SNAP_OF__ = function () { return window.__SNAP_CUR__ || SNAP }

window.__MOUNT__ = async function (payload) {
  // 挂载点与 root 只建一次；每一档换的是 root 外面那份数据，再让同一个 root 重画一遍。
  //   （同一个节点上反复 createRoot、或反复 unmount/remount，实测都会让后画的那一棵空着 —— 别走那条路。）
  window.__PAYLOAD__ = payload
  if (!window.__ROOT__) {
    const host = document.createElement('div')
    host.id = 'mount'
    host.style.cssText = 'width:460px;height:700px;background:#10131a;color:#e6edf3'
    document.getElementById('pane').appendChild(host)
    window.__HOST__ = host
    window.__ROOT__ = window.__RDOM__.createRoot(host)
  }
  window.__ST__ = { snapshot: window.__PAYLOAD__, snapMode: 'real', cwd: CWD, narrow: false }
  let thrown = null
  const el = React.createElement(Strip, { st: window.__ST__, narrow: false })
  try { window.__ROOT__.render(el) } catch (e) { thrown = String((e && e.message) || e) }
  const host = window.__HOST__
  await window.__TICK__(2)
  // 等它画出来：React 那次提交是异步的，所以等「这一块的内容真的出现了」，不是等某一次同步返回。
  const arrived = await window.__WAIT__(() => String(host.textContent || '').indexOf('#') >= 0, 8000)
  return { ok: !!host.querySelector('.dsws-chainview'), arrived: arrived, thrown: thrown, hostText: String(host.textContent || '').slice(0, 120), hostNodes: Array.from(host.children).map(function (c) { return c.nodeName + '.' + (c.className || '') }) }
}

// 一帧的实况：块高（它自己写死的那条 height）、记录行数与每行高度、版面上看得见的字、悬停提示里的字。
window.__GEOM__ = function () {
  const strip = document.querySelector('.dsws-chainview')
  if (!strip) return { error: 'no strip' }
  const rows = Array.from(strip.querySelectorAll('.dsws-chainview-row'))
  return {
    ok: true,
    blockH: Math.round(strip.getBoundingClientRect().height * 100) / 100,
    rowCount: rows.length,
    rowHeights: rows.map(function (x) { return Math.round(x.getBoundingClientRect().height * 100) / 100 }),
  }
}
window.__VISIBLE__ = function () {
  const strip = document.querySelector('.dsws-chainview')
  if (!strip) return { error: 'no strip' }
  const rows = Array.from(strip.querySelectorAll('.dsws-chainview-row'))
  // 「版面上看得见的字」= 这一块的顶层孩子各自的文字。提示那份文字挂在 data-tip 上（不是文字节点），
  //   所以 textContent 天然不带它 —— 不用再挑一层出来。
  const visibleOf = function (el) { return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '' }
  const lines = Array.from(strip.children).map(visibleOf)
  const rowTexts = rows.map(visibleOf)
  const tips = rows.map(function (x) { const tip = x.closest('[data-tip]'); return String((tip && tip.getAttribute('data-tip')) || '') })
  return {
    ok: true,
    blockH: Math.round(strip.getBoundingClientRect().height * 100) / 100,
    rowCount: rows.length,
    rowTexts: rowTexts,
    rowHeights: rows.map(function (x) { return Math.round(x.getBoundingClientRect().height * 100) / 100 }),
    lines: lines,
    text: lines.join(' | '),
    tips: tips,
  }
}
// 反证：克隆这一块，往某一行的文字里塞回一个 8 位十六进制散列、往说明那一行塞回「宿主读数」，
//   看两把尺子认不认（克隆件上做，真节点一个字不碰）。
window.__REVERSE__ = function () {
  const strip = document.querySelector('.dsws-chainview')
  if (!strip) return { error: 'no strip' }
  const clone = strip.cloneNode(true)
  clone.style.position = 'absolute'
  clone.style.visibility = 'hidden'
  clone.style.left = '-10000px'
  strip.parentElement.appendChild(clone)
  const row = clone.querySelector('.dsws-chainview-row')
  const head = clone.children[0]
  const hex = '307d37e6'
  if (row) row.textContent = String(row.textContent || '') + ' ' + hex
  if (head) head.textContent = String(head.textContent || '') + ' · 宿主读数 16:50'
  const afterHex = row ? String(row.textContent || '') : ''
  const afterJargon = head ? String(head.textContent || '') : ''
  clone.remove()
  return { ok: true, hex: hex, jargon: '宿主读数', afterHex: afterHex, afterJargon: afterJargon }
}
window.__PROBE_READY__ = true
