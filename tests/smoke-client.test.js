// smoke-client.test.js — T0 阶段 0 验收·jsdom 冒烟（R3 模板）
// 加载 package/lib/client.js（__ModuleLoader__ stub），断言：
//   1) ModuleLoader 注册成功（id 正确）
//   2) inject 含 5 个服务声明
//   3) apply 后 style[data-plugin] 注入（样式生命周期 seam）
//   4) STYLE_TEXT 含 .dsws-panel / .dsws-capsule / .dsws-tabs 特征
// 用法: node tests/smoke-client.test.js
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://127.0.0.1:59519/',
  runScripts: 'dangerously',
})
const { window } = dom
const { document } = window

// ---- __ModuleLoader__ stub：捕获 load 注册 ----
let loaded = null
window.__ModuleLoader__ = {
  load(spec) { loaded = spec; return spec },
}

// ---- 宿主 stub（R3 清单 7 项：slots / connection.rpc / locale / workspaces / sessions / timer / React+ReactDOM）----
const dict = {}
const trFn = (key, params) => {
  let s = dict[key] !== undefined ? dict[key] : key
  if (params) s = s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
  return s
}
const slots = { register: () => {}, inject: () => {} }
const services = {
  slots,
  connection: { rpc: { call: async () => ({ ok: true, value: { ok: true, maps: [], checks: [], ready: 0, total: 0 } }) } },
  locale: { register: (ns, d) => { Object.assign(dict, d.zh || {}, d.en || {}); return () => {} }, bind: () => trFn },
  workspaces: { list: async () => [] },
  sessions: { list: async () => [] },
  timer: { timeout: (fn, ms) => setTimeout(fn, ms) },
}
const ctx = {
  get: (k) => services[k],
  effect: (fn) => { fn(); return () => {} },
}
window.React = { createElement: () => ({}), useState: () => [null, () => {}], useEffect: () => {}, useRef: () => ({ current: null }) }
window.ReactDOM = null
window.__DSW_SMOKE_CTX__ = ctx

// ---- 执行 bundle（在 window 上下文中，document/React 等解析到 jsdom 全局）----
const code = readFileSync('package/lib/client.js', 'utf8')
window.eval(code)

let failures = 0
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

check(!!loaded, 'ModuleLoader.load 被调用')
check(loaded && loaded.id === 'dsh-mattpocock-skills-deck', `id = ${loaded && loaded.id}`)

const mod = loaded.factory((m) => {
  if (m === 'react') return window.React
  if (m === 'react-dom') return null
  throw new Error('unexpected require: ' + m)
})
check(Array.isArray(mod.inject), 'inject 为数组')
check(Array.isArray(mod.inject) && mod.inject.length === 5, `inject 含 5 服务（${JSON.stringify(mod.inject)}）`)
check(typeof mod.apply === 'function', 'apply 为函数')

// ---- apply 后样式注入（seam style binding）----
try {
  mod.apply(ctx)
} catch (e) {
  console.log('  WARN apply threw（面板深层依赖可能未 stub 全）:', e.message)
}
const styles = document.head.querySelectorAll('style[data-plugin]')
check(styles.length > 0, `apply 后 style[data-plugin] 注入（${styles.length} 个）`)
const styleText = Array.from(styles).map((s) => s.textContent).join('')
check(styleText.includes('.dsws-panel'), '样式含 .dsws-panel')
check(styleText.includes('.dsws-capsule'), '样式含 .dsws-capsule')
check(styleText.includes('.dsws-tabs'), '样式含 .dsws-tabs')

console.log(failures ? `\n冒烟失败 ${failures} 项` : '\n冒烟全部通过')
process.exit(failures ? 1 : 0)
