#!/usr/bin/env node
/**
 * verify-646-native-tab.js — 验收：面板只有一个落点、一条路，就是 DSH 原生右侧边栏。
 *
 * 这份门禁的来历（读的人先看这里，别被文件名误导）：
 *   #646 当年定的是「两个入口」——本插件自己注册的类型 + 把类型交给 dsh-better-sidebar，两条并存。
 *   2026-09-21 维护者拍板改成只有一条路：那个插件把面板画进的是同一列，于是原生右栏的引导页里
 *   出现两枚同名入口（用户看到「两个 MattSkills」）。所以本文件保留文件名、内容整体改写成
 *   「只有一条路」的断言：凡是一条路不该有的东西，出现即红。
 *
 * 现在要守住的东西：
 *   1) 打开面板只有 openInNativeRight 一条路，没有第二个入口，也没有「这个不行改走另一个」的分派；
 *   2) 面板类型注册进 DSH 原生登记表（builtin 档），内容体与标题两个槽位按我们自己的类型 id 分格；
 *   3) 全仓不再有 dsh-better-sidebar 的服务调用（ctx.get('betterSidebar') / registerTab / openTab）；
 *   4) 设置页不再有「打开位置」那一项，cfg 里也不再留 openIn；
 *   5) 页内浮窗仍然不注册（shell.overlay 挂载点不给面板用）；
 *   6) 拿桩上下文真跑一遍 apply：注册了什么、没注册什么、缺服务时崩不崩。
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
const CONFIG = 'src/client/kernel/config.js'
const SETTINGS = 'src/client/views/SettingsPage.js'
const LOCALE_FLOW = 'src/client/kernel/locale-flow.js'
const FILES = [ROUTER, ASSEMBLY, CONFIG, SETTINGS, LOCALE_FLOW, 'client.js', 'package/lib/client.js']
const texts = {}
for (const rel of FILES) {
  const p = resolve(rel)
  texts[rel] = existsSync(p) ? readFileSync(p, 'utf8') : null
  if (texts[rel] === null) check(false, rel + ' 读不到（先跑 npm run build）')
}
// 规则归谁管：打开路径在 router，注册形状在 panelAssembly；两份产物里两者都有。
const SET_ROUTER = [ROUTER, 'client.js', 'package/lib/client.js']
const SET_ASSEMBLY = [ASSEMBLY, 'client.js', 'package/lib/client.js']
const SET_ALL = [ROUTER, ASSEMBLY, CONFIG, SETTINGS, LOCALE_FLOW, 'client.js', 'package/lib/client.js']

/** 去掉注释后的源码：断言「代码里没有某样东西」时必须用它，否则会被解说说辞误伤。 */
function stripComments(t) {
  return String(t).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')
}

console.log('== R1 只留一条路：本插件自己注册的类型 ==')
for (const rel of SET_ROUTER) {
  const t = texts[rel]
  if (!t) continue
  check(t.includes("DECK_NATIVE_TAB_KIND = 'dsh-mattpocock-skills-deck:deck-map'"), rel + ' 面板类型名仍是本插件自己那条')
  check(t.includes('DECK_NATIVE_TYPE_ID'), rel + ' 类型 id 有自己的常量')
  const code = stripComments(t)
  check(!code.includes("ctx.get('betterSidebar')"), rel + ' 代码里不再取 better-sidebar 的服务')
  check(!/\bensureSidebarTab\b/.test(code), rel + ' 不再有 ensureSidebarTab（那条注册已整段删除）')
  check(!/\bopenInSidebar\b/.test(code), rel + ' 不再有 openInSidebar（第二个入口已整段删除）')
  check(!/\bsidebarTabDisposer\b/.test(code) && !/\bsidebarTabRetry\b/.test(code), rel + ' 不再有那条注册的 disposer 与重试定时器')
  check(!/DECK_TAB_KIND\b/.test(code), rel + ' 不再有交给第三方插件用的那个类型名常量')
  check(!/registerTab\s*\(/.test(code), rel + ' 不再往第三方插件登记表注册面板类型')
}
for (const rel of SET_ASSEMBLY) {
  const t = texts[rel]
  if (!t) continue
  const start = t.indexOf('registerNativeTabType')
  const block = start >= 0 ? t.slice(start, start + 900) : ''
  check(/priority:\s*'builtin'/.test(block), rel + ' 原生登记用 builtin 档')
  check(/kind:\s*DECK_NATIVE_TAB_KIND/.test(block), rel + ' 原生登记的 kind 取自常量（避免两处漂移）')
  check(/id:\s*DECK_NATIVE_TYPE_ID/.test(block), rel + ' 原生登记的 id 取自常量')
  check(/guide:\s*\[\{\s*order:\s*60/.test(block), rel + ' 带一条引导页入口（order 60）')
  check(t.includes("name: 'sidebar.right.pane.tab'") && t.includes("name: 'sidebar.right.pane.tab.title'"), rel + ' 注册了标签内容体与标题栏两个槽位')
  check(/key:\s*DECK_NATIVE_TYPE_ID/.test(t), rel + ' 两个槽位按我们自己的类型 id 分格（keyed）')
  check(/inject:\s*function \(sessionId\)/.test(t), rel + ' 内容体从原生右栏的 inject(sessionId) 拿会话号')
  check(!stripComments(t).includes("__injectOnce('shell.overlay'"), rel + ' 不注册页内浮窗挂载点（shell.overlay 只留给横幅/弹窗/提示三个席位）')
}

console.log('')
console.log('== R2 打开面板只剩一条路，且不再有第二个入口与分派 ==')
for (const rel of SET_ROUTER) {
  const t = texts[rel]
  if (!t) continue
  const from = t.indexOf('const openPanel')
  const body = from >= 0 ? t.slice(from, from + 1800) : ''
  check(body.length > 0 && body.includes('openInNativeRight(st)'), rel + ' openPanel 走原生右侧边栏那条')
  check(body.length > 0 && !body.includes('openInSidebar'), rel + ' openPanel 里不再有第二个入口')
  check(!t.includes("cfg.openIn === 'sidebar'"), rel + ' 不再按配置二选一')
  check(!/entry-fallback/.test(t), rel + ' 不再有「这个入口不行改走另一个」那条日志')
  check(t.includes("ctx.get('sidebarRight')") && t.includes('openTabIn') && t.includes('api.openTab('), rel + ' 走原生控制器（含跨会话 openTabIn 与退路 openTab）')
  check(!t.includes('openPagePanel'), rel + ' 页内浮窗那条路已删（不再有 openPagePanel）')
  check(!t.includes('openDockPanel'), rel + ' details 列那条老路已删（不再有 openDockPanel）')
  check(!t.includes('openDetails'), rel + ' 不再调用 layout.openDetails（那个方法在当前 DSH 里不存在）')
}

console.log('')
console.log('== R3 设置页与配置：不再有「打开位置」这一项 ==')
for (const rel of SET_ALL) {
  const t = texts[rel]
  if (!t) continue
  const code = stripComments(t)
  check(!code.includes('pickOpenIn'), rel + ' 不再有 pickOpenIn')
  check(!/\bcfg\.openIn\b/.test(code), rel + ' 代码里不再读写字面量 cfg.openIn')
  check(!code.includes('openIn:'), rel + ' 不再写 openIn 这个配置键')
}
for (const rel of [SETTINGS, 'client.js', 'package/lib/client.js']) {
  const t = texts[rel]
  if (!t) continue
  check(!stripComments(t).includes("'settings.save'"), rel + ' 不再记 settings.save（那一项即时保存随「打开位置」一起没了）')
}
for (const rel of [LOCALE_FLOW, 'client.js', 'package/lib/client.js']) {
  const t = texts[rel]
  if (!t) continue
  check(!t.includes("'cfg.openIn'") && !t.includes("'cfg.openInDesc'") && !t.includes("'cfg.openInNative'") && !t.includes("'cfg.openInSidebar'"), rel + ' 七个「打开位置」文案键已撤掉')
}

console.log('')
console.log('== R4 等待方式：等服务，不等槽位声明 ==')
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
    // 注意这里**没有** betterSidebar：这一整套桩就是「那个插件不在」的世界，apply 必须照常跑通。
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
  check(def.priority === 'builtin', '类型的档位 = builtin（实际 ' + JSON.stringify(def.priority) + '）')
  check(def.id === 'dsh-mattpocock-skills-deck/deck:map', '类型 id = 包名 + 面板名（实际 ' + JSON.stringify(def.id) + '）')
  check(typeof def.title === 'function', '类型带标题函数')
  check(Array.isArray(def.guide) && def.guide.length === 1 && def.guide[0].order === 60, '带一条引导页入口（order 60）—— 引导页里因此只有一枚')
  check(Array.isArray(def.guide) && typeof def.guide[0].title === 'function' && typeof def.guide[0].icon === 'function', '引导页入口自带标题与图标函数')

  const names = registrations.map((r) => r.meta.name)
  check(names.includes('sidebar.right.pane.tab'), '注册了标签内容体槽位')
  check(names.includes('sidebar.right.pane.tab.title'), '注册了标签标题栏槽位')
  check(!names.includes('shell.overlay'), '没有把面板挂到 shell.overlay（页内浮窗仍是退役状态）')
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
