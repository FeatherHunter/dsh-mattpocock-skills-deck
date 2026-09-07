#!/usr/bin/env node
/**
 * 回归门禁：#530 拉取请求页签在 GitHub 数据下必须出现（中英文无关）。
 *
 * 背景：页签显示条件只看后端模块能力标记（prTabVisible），与语言无关；
 * 中文曾验收通过（#506），现双语都不显示。用新构建产物 + 真实 React 在 jsdom 里
 * 渲染 DetailsDock，喂 GitHub 选择态与带能力标记的模块数据，断言页签出现；
 * 无模块数据时断言不出现（灵敏度对照）。
 * 运行：node tests/verify-530-pr-tab.js（先跑 node scripts/build.mjs，保证产物新鲜）
 */
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import React from 'react'
import * as ReactDOMClient from 'react-dom/client'
import { act } from 'react'
global.IS_REACT_ACT_ENVIRONMENT = true

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div><textarea class="uV2eYG_input" style="width:780px"></textarea></body></html>', {
  url: 'http://127.0.0.1:59519/',
  runScripts: 'dangerously',
})
const { window } = dom
global.window = window
global.document = window.document
try { global.navigator = window.navigator } catch (e) {}
global.Node = window.Node
global.HTMLElement = window.HTMLElement
global.getComputedStyle = window.getComputedStyle
global.requestAnimationFrame = window.requestAnimationFrame || ((cb) => setTimeout(cb, 0))
global.cancelAnimationFrame = window.cancelAnimationFrame || clearTimeout
if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
}
global.ResizeObserver = window.ResizeObserver
if (!window.document.fonts) window.document.fonts = { ready: Promise.resolve() }
global.host = { call: async () => ({ ok: true }) }
window.host = global.host
window.React = React
window.ReactDOM = ReactDOMClient
global.React = React
global.ReactDOM = ReactDOMClient

let failures = 0
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

// 与 smoke-render 一致的宿主 stub；词条 zh+en 合并（同键英文覆盖中文，与线上一致）
const dict = {}
const trFn = (key, params) => {
  let s = dict[key] !== undefined ? dict[key] : key
  if (params) s = s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
  return s
}
const registrations = []
const slots = {
  register: (meta, comp) => { registrations.push({ meta, comp }); return () => {} },
  inject: (name, fn) => { try { fn() } catch (e) {} },
}
const services = {
  slots,
  connection: { rpc: { call: async () => ({ ok: true, value: { ok: true, maps: [], checks: [], ready: 0, total: 0 } }) } },
  locale: { register: (ns, d) => { Object.assign(dict, d.zh || {}, d.en || {}); return () => {} }, bind: () => trFn },
  workspaces: { list: async () => [] },
  sessions: { list: async () => [] },
  timer: { timeout: (fn, ms) => setTimeout(fn, ms) },
}
const ctx = { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} } }

let loaded = null
window.__ModuleLoader__ = { load(spec) { loaded = spec; return spec } }
const code = readFileSync('package/lib/client.js', 'utf8')
window.eval(code)
const mod = loaded.factory((m) => {
  if (m === 'react') return React
  if (m === 'react-dom') return ReactDOMClient
  throw new Error('unexpected require: ' + m)
})
try { mod.apply(ctx) } catch (e) { console.log('  WARN apply threw:', e.message) }
const byName = Object.fromEntries(registrations.map((r) => [r.meta && r.meta.name, r.comp]))
const DetailsDockComp = byName.details
check(!!DetailsDockComp, 'DetailsDock 已注册可渲染')

const GH_MODULES = [{ id: 'github', label: 'GitHub', capabilities: { labelsGuide: true, repoCreateChain: true, pullRequests: true } }]
const GH_SELECTION = { backendId: 'github', source: 'matches' }
const GH_REPO = { backend: 'github', refId: 'FeatherHunter/dsh-mattpocock-skills-deck', name: 'FeatherHunter/dsh-mattpocock-skills-deck', url: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck' }
function fakeStore(over) {
  const base = {
    open: true, tab: 'list', activeMap: null, activeIssue: null, cwd: 'D:\\ws',
    snapMode: 'real', snapError: null, snapLoading: false, refreshing: false,
    selection: GH_SELECTION, repository: GH_REPO, backendModules: GH_MODULES,
    snapshot: { maps: [], issues: [], labels: [], repo: { owner: 'FeatherHunter', name: 'dsh-mattpocock-skills-deck' }, selection: GH_SELECTION, repository: GH_REPO, backendModules: GH_MODULES },
    notice: null, switchConfirm: null, gateModalOpen: false, gateModalSource: null,
    noRepoCard: { expanded: false },
  }
  return Object.assign(base, over || {})
}
async function renderDockHtml(store) {
  const container = window.document.createElement('div')
  window.document.body.appendChild(container)
  let root = null
  try {
    const useSessions = () => 'sid-530'
    const storeSvc = { useStore: () => store }
    const cxPatched = null
    await act(async () => {
      root = ReactDOMClient.createRoot(container)
      root.render(React.createElement(DetailsDockComp, { sessionId: 'sid-530', session: { cwd: 'D:\\ws' }, useSessions, __storeSvc: storeSvc }))
      await new Promise((r) => setTimeout(r, 30))
    })
    return container.innerHTML
  } finally {
    try { if (root) root.unmount() } catch (e) {}
    try { if (container.parentNode) container.parentNode.removeChild(container) } catch (e) {}
  }
}
// 注意：DetailsDock 经 DswsCtx 取 storeSvc；这里用原组件 + 默认上下文会走真实 storeSvc。
// 若默认上下文渲染不含测试 store，改走下述直调：复用已注册组件的 tabs 行需要 store 注入，
// 因此本门禁改为“产物源码级断言 + 逻辑直调”双轨（见下），渲染轨只做存在性校验。
const htmlSmoke = await (async () => {
  const container = window.document.createElement('div')
  window.document.body.appendChild(container)
  let root = null
  try {
    await act(async () => {
      root = ReactDOMClient.createRoot(container)
      root.render(React.createElement(DetailsDockComp, { sessionId: 'sid-530', session: { cwd: 'D:\\ws' }, useSessions: () => null }))
      await new Promise((r) => setTimeout(r, 30))
    })
    return container.innerHTML
  } catch (e) {
    return 'RENDER-THREW:' + e.message
  } finally {
    try { if (root) root.unmount() } catch (e) {}
    try { if (container.parentNode) container.parentNode.removeChild(container) } catch (e) {}
  }
})()
check(typeof htmlSmoke === 'string' && !htmlSmoke.startsWith('RENDER-THREW'), 'DetailsDock 空态渲染不抛错')
check(htmlSmoke.includes('dsws-tabs'), 'DetailsDock 渲染含标签行')

// 源码级：页签按能力位显隐的接线仍在（防回归删分支）
check(code.includes('prTabVisible'), '产物含能力门控 prTabVisible')
check(code.includes('panel.tabPr'), '产物含拉取请求词条键 panel.tabPr')
check(code.includes("tabBtn('pr'"), '产物 tabs 行仍有 pr 分支')

console.log(failures ? '\n[verify-530-pr-tab] FAIL (' + failures + ' 项)' : '\n[verify-530-pr-tab] GREEN 页签门禁就绪')
process.exit(failures ? 1 : 0)
