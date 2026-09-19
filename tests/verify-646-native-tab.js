#!/usr/bin/env node
/**
 * verify-646-native-tab.js — #646 验收：面板有两个入口，都落在 DSH 右侧边栏里；页内浮窗退役。
 *
 * 背景（这次要守住的东西）：
 *   面板的「打开位置」有两条路，用户选哪条就走哪条 ——
 *     「DSH 右侧边栏」= 本插件自己注册一个 tab 类型，右栏里那一格由我们自己渲染；
 *     「BetterSidebar」= 把面板类型交给 dsh-better-sidebar，它开、它管。
 *   两条路必须用**不同的类型名**：原生侧边栏的类型登记器规定，同一个类型名下 extension 档盖住 builtin 档，
 *   只要 better-sidebar 装着，它转发 deck:map 的那份就永远生效 —— 想让「本插件自己那条」真由我们渲染，
 *   就得另起一个类型名。这一条是本次改造的要点，也是上一版实现（两条路都用 deck:map）看不出差别的原因。
 *   交给 better-sidebar 的那个类型名（deck:map）不能改：改了旧标签会变成打不开的占位页（#598）。
 *
 * 落点：面板只落在右侧边栏里。原先的「details 列」在当前 DSH 里已经不存在，页内浮窗这个形态也已退役，
 *   两条老路（openDockPanel / openPagePanel）连同它们的槽位注册都不再保留。
 *
 * 覆盖：src 真源两份文件 + 两份构建产物（产物由 scripts/build.mjs 从 src 重生成，行首 export 会被剥掉）。
 * 运行：node tests/verify-646-native-tab.js
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import React from 'react'
import * as ReactDOMClient from 'react-dom/client'

let passed = 0, failed = 0
function check(ok, msg) { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }

const ROUTER = 'src/client/kernel/router.js'
const ASSEMBLY = 'src/client/panelAssembly.js'
const FILES = [ROUTER, ASSEMBLY, 'client.js', 'package/lib/client.js']
const texts = {}
for (const rel of FILES) {
  const p = resolve(rel)
  texts[rel] = existsSync(p) ? readFileSync(p, 'utf8') : null
  if (texts[rel] === null) check(false, rel + ' 读不到（先跑 npm run build）')
}
// 规则归谁管：打开路径在 router，注册形状在 panelAssembly；两份产物里两者都有。
const SET_ROUTER = [ROUTER, 'client.js', 'package/lib/client.js']
const SET_ASSEMBLY = [ASSEMBLY, 'client.js', 'package/lib/client.js']

console.log('== R1 两个入口用两个类型名（本插件自己那条不能与交给 better-sidebar 的撞名）==')
for (const rel of SET_ROUTER) {
  const t = texts[rel]
  if (!t) continue
  check(t.includes("DECK_TAB_KIND = 'deck:map'"), rel + ' 交给 better-sidebar 的类型名仍是 deck:map（历史沿用，改了旧标签会变成占位页）')
  check(t.includes("DECK_NATIVE_TAB_KIND = 'dsh-mattpocock-skills-deck:deck-map'"), rel + ' 本插件自己那条另起一个类型名')
  check(t.includes('DECK_NATIVE_TYPE_ID'), rel + ' 类型 id 有自己的常量')
}
for (const rel of SET_ASSEMBLY) {
  const t = texts[rel]
  if (!t) continue
  const start = t.indexOf('registerNativeTabType')
  const block = start >= 0 ? t.slice(start, start + 900) : ''
  check(/priority:\s*'builtin'/.test(block), rel + ' 原生登记用 builtin 档')
  check(block.length > 0 && !/priority:\s*'extension'/.test(block), rel + ' 原生登记没有用 extension 档（不撞 better-sidebar 转发的那份）')
  check(/kind:\s*DECK_NATIVE_TAB_KIND/.test(block), rel + ' 原生登记的 kind 取自常量（避免两处漂移）')
  check(/id:\s*DECK_NATIVE_TYPE_ID/.test(block), rel + ' 原生登记的 id 取自常量')
  check(/guide:\s*\[\{\s*order:\s*60/.test(block), rel + ' 带一条引导页入口（order 60）')
  check(t.includes("name: 'sidebar.right.pane.tab'") && t.includes("name: 'sidebar.right.pane.tab.title'"), rel + ' 注册了标签内容体与标题栏两个槽位')
  check(/key:\s*DECK_NATIVE_TYPE_ID/.test(t), rel + ' 两个槽位按我们自己的类型 id 分格（keyed）')
  check(/inject:\s*function \(sessionId\)/.test(t), rel + ' 内容体从原生右栏的 inject(sessionId) 拿会话号')
}

console.log('')
console.log('== R2 两个入口的分派，以及浮窗与老路的退役 ==')
for (const rel of SET_ROUTER) {
  const t = texts[rel]
  if (!t) continue
  const from = t.indexOf('const openPanel')
  const body = from >= 0 ? t.slice(from, from + 1800) : ''
  check(body.length > 0 && body.includes("openInSidebar(st)") && body.includes('openInNativeRight(st)'), rel + ' openPanel 里两个入口都在（选哪个走哪个，另一个当退路）')
  check(t.includes("cfg.openIn === 'sidebar'"), rel + ' 选侧边栏时走 better-sidebar 那条')
  check(t.includes("ctx.get('sidebarRight')") && t.includes('openTabIn') && t.includes('api.openTab('), rel + ' 本插件自己那条走原生控制器（含跨会话 openTabIn 与退路 openTab）')
  check(/registerTab\(\{[\s\S]{0,260}?id:\s*'deck:map'/.test(t), rel + ' better-sidebar 注册仍在（deck:map 原样）')
  check(/openTab\(\{\s*type:\s*DECK_TAB_KIND\s*\}/.test(t), rel + ' better-sidebar 打开仍在（只给类型，不给路径 —— #594 的规矩）')
  check(!t.includes('openPagePanel'), rel + ' 页内浮窗那条路已删（不再有 openPagePanel）')
  check(!t.includes('openDockPanel'), rel + ' details 列那条老路已删（不再有 openDockPanel）')
  check(!t.includes('openDetails'), rel + ' 不再调用 layout.openDetails（那个方法在当前 DSH 里不存在）')
}
for (const rel of SET_ASSEMBLY) {
  const t = texts[rel]
  if (!t) continue
  check(!t.includes("__injectOnce('shell.overlay'"), rel + ' 不再注册页内浮窗挂载点（shell.overlay）')
  check(!t.includes("__injectOnce('details'"), rel + ' 不再注册 details 槽位（当前 DSH 里不存在这个槽）')
}

console.log('')
console.log('== R3 等待方式：等服务，不等槽位声明 ==')
for (const rel of SET_ASSEMBLY) {
  const t = texts[rel]
  if (!t) continue
  check(t.includes("ctx.inject(['sidebarRightTabs']"), rel + ' 用 ctx.inject 等 sidebarRightTabs 服务')
  check(/typeof ctx\.inject === 'function'/.test(t), rel + ' 对没有 ctx.inject 的宿主留了退路（退回每秒重试）')
}

console.log('')
console.log('== 运行时断言：拿桩上下文跑一遍 apply，看真的注册了什么 ==')
{
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:59521/', runScripts: 'dangerously' })
  const { window } = dom
  global.window = window
  global.document = window.document
  try { global.navigator = window.navigator } catch (e) {}
  global.Node = window.Node
  global.HTMLElement = window.HTMLElement
  global.getComputedStyle = window.getComputedStyle
  global.requestAnimationFrame = window.requestAnimationFrame || ((cb) => setTimeout(cb, 0))
  global.cancelAnimationFrame = window.cancelAnimationFrame || clearTimeout
  if (typeof window.ResizeObserver === 'undefined') window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  global.ResizeObserver = window.ResizeObserver
  if (!window.document.fonts) window.document.fonts = { ready: Promise.resolve() }
  global.host = { call: async () => ({ ok: true }) }
  window.host = global.host
  window.React = React
  window.ReactDOM = ReactDOMClient
  global.React = React
  global.ReactDOM = ReactDOMClient

  const registrations = []
  const slots = {
    register: (meta, comp) => { registrations.push({ meta, comp }); return () => {} },
    inject: (name, fn) => { try { fn() } catch (e) {} },
  }
  const dict = {}
  const trFn = (key) => (dict[key] !== undefined ? dict[key] : key)
  const services = {
    slots,
    locale: { register: (ns, d) => { Object.assign(dict, d.zh || {}, d.en || {}); return () => {} }, bind: () => trFn },
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
    workspaces: { list: async () => [] },
    sessions: { list: async () => [] },
    timer: { timeout: (fn, ms) => setTimeout(fn, ms) },
  }
  // 桩：原生 tab 类型登记表（只记注册），原生控制器（只记调用）
  const registeredTypes = []
  services.sidebarRightTabs = { register: (def) => { registeredTypes.push(def); return () => {} } }
  const sidebarRightCalls = []
  services.sidebarRight = {
    openTab: (kind, options) => { sidebarRightCalls.push({ via: 'openTab', kind, options }) },
    openTabIn: (sid, kind, options) => { sidebarRightCalls.push({ via: 'openTabIn', sid, kind, options }) },
  }
  let injectSeat = null
  const ctx = {
    get: (k) => services[k],
    effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} },
    inject: (deps, cb) => { injectSeat = { deps, cb, dispose: () => {} }; cb(ctx); return injectSeat },
  }

  let loaded = null
  window.__ModuleLoader__ = { load(spec) { loaded = spec; return spec } }
  const code = readFileSync(resolve('package/lib/client.js'), 'utf8')
  window.eval(code)
  check(!!loaded, '产物加载成功')
  if (!loaded) { console.log('\ntotal=' + (passed + failed) + ' passed=' + passed + ' failed=' + failed); process.exit(1) }

  const mod = loaded.factory((m) => {
    if (m === 'react') return React
    if (m === 'react-dom') return ReactDOMClient
    throw new Error('unexpected require: ' + m)
  })
  let applyErr = null
  try { mod.apply(ctx) } catch (e) { applyErr = e }
  check(applyErr === null, 'apply 跑通（无异常）' + (applyErr ? '：' + applyErr.message : ''))

  check(injectSeat !== null && injectSeat.deps.includes('sidebarRightTabs'), 'apply 里用 ctx.inject 等了 sidebarRightTabs')
  check(registeredTypes.length === 1, '只注册了 1 个原生 tab 类型（实际 ' + registeredTypes.length + '）')
  const def = registeredTypes[0] || {}
  check(def.kind === 'dsh-mattpocock-skills-deck:deck-map', '类型的 kind 是本插件自己那条（实际 ' + JSON.stringify(def.kind) + '）')
  check(def.kind !== 'deck:map', '类型名与交给 better-sidebar 的那个不同（两条路才互不打架）')
  check(def.priority === 'builtin', '类型的档位 = builtin（实际 ' + JSON.stringify(def.priority) + '）')
  check(def.id === 'dsh-mattpocock-skills-deck/deck:map', '类型 id = 包名 + 面板名（实际 ' + JSON.stringify(def.id) + '）')
  check(typeof def.title === 'function', '类型带标题函数')
  check(Array.isArray(def.guide) && def.guide.length === 1 && def.guide[0].order === 60, '带一条引导页入口（order 60）')
  check(Array.isArray(def.guide) && typeof def.guide[0].title === 'function' && typeof def.guide[0].icon === 'function', '引导页入口自带标题与图标函数')

  const names = registrations.map((r) => r.meta.name)
  check(names.includes('sidebar.right.pane.tab'), '注册了标签内容体槽位')
  check(names.includes('sidebar.right.pane.tab.title'), '注册了标签标题栏槽位')
  const body = registrations.find((r) => r.meta.name === 'sidebar.right.pane.tab')
  check(!!body && body.meta.key === 'dsh-mattpocock-skills-deck/deck:map', '内容体按我们自己的类型 id 分格')
  check(!!body && typeof body.meta.inject === 'function' && body.meta.inject('sid-1').sessionId === 'sid-1', '内容体从槽位拿到 sessionId')
  check(sidebarRightCalls.length === 0, 'apply 阶段不打开面板（打开只由用户操作触发）')

  // 退路：宿主没有 sidebarRightTabs 时不许崩、也不许注册半个（类型注册失败就不注册槽位）
  const registrations2 = []
  const services2 = Object.assign({}, services, {
    slots: { register: (meta) => { registrations2.push(meta); return () => {} }, inject: (n, fn) => { try { fn() } catch (e) {} } },
    sidebarRightTabs: undefined,
  })
  const ctx2 = { get: (k) => services2[k], effect: (fn) => { const r = fn(); return () => {} }, inject: (deps, cb) => { cb(ctx2); return { dispose: () => {} } } }
  let loaded2 = null
  const dom2 = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://127.0.0.1:59522/', runScripts: 'dangerously' })
  global.window = dom2.window
  global.document = dom2.window.document
  dom2.window.React = React
  dom2.window.ReactDOM = ReactDOMClient
  global.React = React
  global.ReactDOM = ReactDOMClient
  dom2.window.__ModuleLoader__ = { load(spec) { loaded2 = spec; return spec } }
  dom2.window.host = global.host
  dom2.window.eval(code)
  const mod2 = loaded2.factory((m) => (m === 'react' ? React : m === 'react-dom' ? ReactDOMClient : null))
  let err2 = null
  try { mod2.apply(ctx2) } catch (e) { err2 = e }
  check(err2 === null, '没有原生登记表时 apply 不崩')
  check(registrations2.filter((m) => m.name === 'sidebar.right.pane.tab').length === 0, '没有原生登记表时不注册标签内容体（不留半截注册）')

  // 老宿主：没有 ctx.inject 也不许崩（退回每秒重试那条路）
  const services3 = Object.assign({}, services)
  const ctx3 = { get: (k) => services3[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} } }
  let loaded3 = null
  const dom3 = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://127.0.0.1:59523/', runScripts: 'dangerously' })
  global.window = dom3.window
  global.document = dom3.window.document
  dom3.window.React = React
  dom3.window.ReactDOM = ReactDOMClient
  global.React = React
  global.ReactDOM = ReactDOMClient
  dom3.window.__ModuleLoader__ = { load(spec) { loaded3 = spec; return spec } }
  dom3.window.host = global.host
  dom3.window.eval(code)
  const mod3 = loaded3.factory((m) => (m === 'react' ? React : m === 'react-dom' ? ReactDOMClient : null))
  let err3 = null
  try { mod3.apply(ctx3) } catch (e) { err3 = e }
  check(err3 === null, '没有 ctx.inject 的老宿主上 apply 不崩（退回每秒重试）')
}

console.log('')
console.log('total=' + (passed + failed) + ' passed=' + passed + ' failed=' + failed)
// apply() 会起常驻的轮询与重试定时器，不清干净进程不会自己退 —— 这里显式收尾。
process.exit(failed ? 1 : 0)
