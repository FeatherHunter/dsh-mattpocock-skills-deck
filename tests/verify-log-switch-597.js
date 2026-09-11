// verify-log-switch-597.js —— #597 门禁：配置页的调试日志开关点得开，失败时说清是哪一类。
//
// 为什么要有这条：这条开关走的是「配置页 → 客户端 setLogSwitch → 宿主 wf.logSetSwitch」的链路。
//   曾经整条链路静默断掉（两个派生分块里的同名助手函数互相顶掉，电话名算成 undefined），
//   界面只弹一句「开关保存失败，已保持原状态，请重试」——点多少次都打不开，用户只能反复重试。
//   静态层面的撞名由 tests/verify-generated-no-shadow.js 盯；本门禁盯的是用户真正看得见的那一步：
//   在真产物（package/lib/client.js）上把开关点一次，看宿主到底有没有收到电话、提示说的是哪一类。
//
// 五段断言，都走公开界面（渲染配置页 + 点开关 + 读页面上的提示），不看内部实现：
//   一、点开开关 → 宿主收到 logSetSwitch，入参 enabled=true，开关停在打开，提示不是失败；
//   二、宿主拒收 → 提示用「宿主拒收」那一类文案；
//   三、宿主迟迟不回（超过看门狗 5 秒）→ 提示用「宿主没回应」那一类文案；
//   四、宿主回「不认识这条电话」→ 提示用「宿主不认识这条电话」那一类文案；
//   五、电话通道抛「连接不可用」→ 提示用「没接上宿主」那一类文案。
//   二到五还各自要求：这一类文案与通用兜底文案、与另外几类文案都不一样
//   （语言不限——文案从 locale 表读，中英哪一种生效都能判定）。
//
// 用法：node tests/verify-log-switch-597.js（在插件根目录；先跑 node scripts/build.mjs 出产物）
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import React from 'react'
import * as ReactDOMClient from 'react-dom/client'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = join(ROOT, 'package', 'lib', 'client.js')

let failed = 0
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed += 1 }

console.log('配置页调试开关门禁（#597：点得开 + 失败说清是哪一类）')

if (!existsSync(BUNDLE)) {
  check(false, '打包产物 package/lib/client.js 不存在（先跑 node scripts/build.mjs）')
  console.log(`\n配置页调试开关门禁失败（共 ${total} 项）`)
  process.exit(1)
}
const bundleCode = readFileSync(BUNDLE, 'utf8')

// ---- 每段断言都新建一张干净的页面，互不串状态 ----
// setSwitchReply(args)：这一段的宿主在收到 logSetSwitch 时怎么回（返回应答，或抛出/返回拒绝）。
// 返回：endpoints 是本段里宿主收到的电话，toast 是页面上那条提示的原文。
async function clickDebugSwitch(setSwitchReply) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://127.0.0.1:59519/',
    runScripts: 'dangerously',
  })
  const { window } = dom
  for (const [k, v] of Object.entries({
    window, document: window.document, navigator: window.navigator, Node: window.Node,
    HTMLElement: window.HTMLElement, getComputedStyle: window.getComputedStyle,
    requestAnimationFrame: window.requestAnimationFrame || ((cb) => setTimeout(cb, 0)),
    cancelAnimationFrame: window.cancelAnimationFrame || clearTimeout,
  })) { try { global[k] = v } catch (e) {} }
  if (typeof window.ResizeObserver === 'undefined') window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  global.ResizeObserver = window.ResizeObserver
  if (!window.document.fonts) window.document.fonts = { ready: Promise.resolve() }
  window.React = React
  window.ReactDOM = ReactDOMClient
  global.React = React
  global.ReactDOM = ReactDOMClient

  const endpoints = []
  const dict = {}
  const trFn = (key, params) => {
    let s = dict[key] !== undefined ? dict[key] : key
    if (params) s = s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
    return s
  }
  // 宿主应答：读开关固定回「关」（这样点一次就是从关往开点），写开关走本段给定的回答。
  const hostReply = (endpoint, args) => {
    if (endpoint === 'logGetSwitch') return { ok: true, value: { ok: true, enabled: false, sampleRate: 1 } }
    if (endpoint === 'logSetSwitch') return setSwitchReply(args)
    return { ok: true, value: { ok: true } }
  }
  let settingsComp = null
  const services = {
    slots: { register: (meta, comp) => { if (meta && meta.name === 'settings.plugins.tab') settingsComp = comp; return () => {} }, inject: (n, fn) => { try { fn() } catch (e) {} } },
    locale: { register: (ns, d) => { Object.assign(dict, d.zh || {}, d.en || {}); return () => {} }, bind: () => trFn },
    workspaces: { list: async () => [] },
    sessions: { list: async () => [] },
    // 计时器：只把看门狗那 5 秒压到 5 毫秒（否则本门禁要真等 5 秒），其余延时照常。
    timer: { timeout: (fn, ms) => setTimeout(fn, ms >= 5000 ? 5 : ms) },
  }
  // 面板这一侧看宿主，看的全是这条电话通道。客户端形状（#596）：
  // host.call('wf.logSetSwitch', args) 落到 rpc.call('/api', 'dsws', { method: 'wf.logSetSwitch', payload: args })。
  // 端点名与入参装在第三个参数里，不走 URL；桩按同一形状拆开，录下来给断言用。
  services.connection = {
    rpc: {
      call: async (channel, carrier, call) => {
        const method = call && call.method
        const endpoint = String(method || '').replace(/^wf\./, '')
        const args = call ? call.payload : undefined
        endpoints.push({ route: channel, carrier, endpoint, args })
        return hostReply(endpoint, args)
      },
    },
  }
  const ctx = { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} } }

  let loaded = null
  window.__ModuleLoader__ = { load(spec) { loaded = spec; return spec } }
  // 渲染真产物时 React 会为演示用的桩服务报一批告警，与本票无关，静音掉免得淹掉断言输出。
  const realError = console.error
  const realWarn = console.warn
  console.error = () => {}
  console.warn = () => {}
  try {
    window.eval(bundleCode)
    const mod = loaded.factory((m) => {
      if (m === 'react') return React
      if (m === 'react-dom') return ReactDOMClient
      throw new Error('unexpected require: ' + m)
    })
    try { mod.apply(ctx) } catch (e) { /* 深层依赖没 stub 全，不影响本场景 */ }
    if (!settingsComp) return { error: '没抓到 settings.plugins.tab 注册', dict }

    const container = window.document.createElement('div')
    window.document.body.appendChild(container)
    const root = ReactDOMClient.createRoot(container)
    await React.act(async () => {
      root.render(React.createElement(settingsComp, { sessionId: 'sid-597' }))
      await new Promise((r) => setTimeout(r, 50))
    })

    let box = null
    for (const lab of Array.from(container.querySelectorAll('label'))) {
      if (/调试日志|Debug log/i.test(lab.textContent || '')) { const b = lab.querySelector('input[type=checkbox]'); if (b) { box = b; break } }
    }
    if (!box) return { error: '页面上找不到「调试日志」开关', dict }
    if (box.checked) return { error: '开关初始不是「关」，本段前提不成立', dict }

    const before = endpoints.length
    await React.act(async () => {
      box.click()
      await new Promise((r) => setTimeout(r, 300))
    })

    const notice = container.innerHTML.match(/dsws-note[^>]*>(.*?)<\/div>/i)
    const toast = notice ? notice[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : ''
    const endedChecked = box.checked
    try { root.unmount() } catch (e) {}
    return { endpoints: endpoints.slice(before), toast, endedChecked, dict }
  } finally {
    console.error = realError
    console.warn = realWarn
  }
}

// 五类专用文案必须先在 locale 表里各有一条，且与通用兜底、与其余各类互不相同——否则「说清是哪一类」无从谈起。
// 判据落在**页面上真正显示的原文**上：显示的必须正好是这一类的那一句。
const CLASS_KEYS = ['cfg.dbgSwitchFailNoHost', 'cfg.dbgSwitchFailTimeout', 'cfg.dbgSwitchFailRejected', 'cfg.dbgSwitchFailStale', 'cfg.dbgSwitchFailUnknownEndpoint']
const showedClassMessage = (r, key) => {
  const mine = r.dict[key]
  if (typeof mine !== 'string' || mine.length === 0) return false
  if (mine === r.dict['cfg.dbgSwitchFail']) return false
  if (CLASS_KEYS.filter((k) => k !== key).map((k) => r.dict[k]).includes(mine)) return false
  return r.toast === mine
}

// —— 一、点开开关：宿主必须收到 logSetSwitch(true)，且提示不是失败 ——
{
  const r = await clickDebugSwitch(() => ({ ok: true, value: { ok: true, enabled: true } }))
  if (r.error) { check(false, '点开关这一段跑通（' + r.error + '）') } else {
    const setCall = r.endpoints.find((e) => e.endpoint === 'logSetSwitch')
    check(!!setCall, `点开后宿主收到 logSetSwitch（实收 ${JSON.stringify(r.endpoints.map((e) => e.endpoint))}）`)
    check(!!setCall && setCall.route === '/api' && setCall.carrier === 'dsws', `电话走在 /api 载体的 dsws 通道上（实际 ${setCall ? setCall.route + ' / ' + setCall.carrier : '—'}）`)
    check(!!setCall && setCall.args && setCall.args.enabled === true, `入参是「打开」（实际 ${JSON.stringify(setCall ? setCall.args : null)}）`)
    check(r.endedChecked === true, `点完后开关停在打开（实际 checked=${r.endedChecked}）`)
    check(r.toast !== '' && r.toast !== r.dict['cfg.dbgSwitchFail'], `点开后提示不是失败文案（实际「${r.toast}」）`)
  }
}

// —— 二、宿主拒收：提示要用「宿主拒收」这一类 ——
{
  const r = await clickDebugSwitch(() => ({ ok: true, value: { ok: false } }))
  if (r.error) { check(false, '宿主拒收这一段跑通（' + r.error + '）') } else {
    check(showedClassMessage(r, 'cfg.dbgSwitchFailRejected'), `拒收提示是「拒收」那一类（实际「${r.toast}」）`)
    check(r.toast !== '' && r.toast !== r.dict['cfg.dbgSwitchFail'], '拒收提示不再是笼统的通用文案')
    check(r.endedChecked !== true, '拒收后开关没有停在打开')
  }
}

// —— 三、宿主迟迟不回：提示要用「宿主没回应」这一类 ——
{
  const r = await clickDebugSwitch(() => new Promise(() => {}))
  if (r.error) { check(false, '宿主不回这一段跑通（' + r.error + '）') } else {
    check(showedClassMessage(r, 'cfg.dbgSwitchFailTimeout'), `超时提示是「没回应」那一类（实际「${r.toast}」）`)
    check(r.toast !== '' && r.toast !== r.dict['cfg.dbgSwitchFail'], '超时提示不再是笼统的通用文案')
  }
}

// —— 四、宿主不认识这条电话（回 unknown endpoint）：提示要用「宿主不认识这条电话」这一类 ——
{
  const r = await clickDebugSwitch(() => ({ ok: false, error: { message: 'unknown endpoint: logSetSwitch' } }))
  if (r.error) { check(false, '未知端点这一段跑通（' + r.error + '）') } else {
    check(showedClassMessage(r, 'cfg.dbgSwitchFailUnknownEndpoint'), `未知端点提示是那一类（实际「${r.toast}」）`)
    check(r.toast !== '' && r.toast !== r.dict['cfg.dbgSwitchFail'], '未知端点不再是笼统的通用文案')
  }
}

// —— 五、面板没接上宿主通道（电话通道抛「连接不可用」）：提示要用「没接上宿主」这一类 ——
{
  const r = await clickDebugSwitch(() => { throw new Error('connection 服务不可用') })
  if (r.error) { check(false, '没接上宿主这一段跑通（' + r.error + '）') } else {
    check(showedClassMessage(r, 'cfg.dbgSwitchFailNoHost'), `没接上宿主时提示是那一类（实际「${r.toast}」）`)
    check(r.toast !== '' && r.toast !== r.dict['cfg.dbgSwitchFail'], '没接上宿主时不再是笼统的通用文案')
  }
}

if (failed === 0) {
  const seen = await clickDebugSwitch(() => ({ ok: true, value: { ok: true, enabled: true } }))
  check(!seen.error && CLASS_KEYS.every((k) => typeof seen.dict[k] === 'string' && seen.dict[k].length > 0), '五类专用文案在 locale 表里都有一条')
}

console.log(failed ? `\n配置页调试开关门禁失败 ${failed} 项（共 ${total} 项）` : `\n配置页调试开关门禁全部通过（${total} 项）`)
process.exit(failed ? 1 : 0)
