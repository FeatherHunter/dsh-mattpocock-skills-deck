#!/usr/bin/env node
/**
 * verify-670-panel-first-frame.js — #670 门禁：面板挂上来的第一帧不能是一块透亮的空块
 *
 * 为什么要用真浏览器：这一票的缺陷长在「第一帧画出来是什么颜色」上。
 *   jsdom 的 getComputedStyle 根本不解析 CSS 里的 var()（实测：写成 var(--x,#10131a) 一律回透明），
 *   而本插件所有底色都写成 var(...) —— 在 jsdom 里量这件事会量出一个假的「透明」，拦不住也证明不了。
 *   所以本门照 #640 的先例走真 Chromium（tests/verify-640-dock-width-browser.js 同一套做法）。
 *
 * 断三件事：
 *   A 源码层（真源 router.js + 两份产物）：空壳与真内容共用 .dsws-hold，且不再有「只有高度没有背景」的内联空壳。
 *   B 真渲染层：把标签内容体挂起来，逐帧记那一层的计算背景 —— 第一帧就必须有底色，
 *     并且与内容挂上之后面板根节点的底色是同一个值（同一屏之内不许出现底色跳变）。
 *   C 反证：把 .dsws-hold 那条规则从样式表里删掉再跑一遍，第一帧必须量出「透明」——否则本门是假绿。
 *
 * 用法：node tests/verify-670-panel-first-frame.js
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

let passed = 0, failed = 0
function check(ok, msg) { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }

const FILES = ['src/client/kernel/router.js', 'src/client/kernel/styles.js', 'client.js', 'package/lib/client.js']
const RENDER_FILES = ['src/client/kernel/router.js', 'client.js', 'package/lib/client.js']
const texts = {}
for (const rel of FILES) {
  const p = resolve(rel)
  texts[rel] = existsSync(p) ? readFileSync(p, 'utf8') : null
  if (texts[rel] === null) check(false, rel + ' 读不到（先跑 npm run build）')
}

console.log('== A 源码层：空壳有类名，且不再是无背景的内联空壳 ==')
for (const rel of FILES) {
  const t = texts[rel]
  if (!t) continue
  if (RENDER_FILES.indexOf(rel) >= 0) check(t.includes("className: 'dsws-hold'"), rel + ' 空壳与真内容用同一个类名 dsws-hold')
  check(!/height:\s*'100%',\s*overflow:\s*'hidden'\s*\}/.test(t), rel + ' 不再用「只有高度与 overflow、没有背景」的内联空壳')
}
{
  const st = texts['src/client/kernel/styles.js']
  const m = st ? st.match(/\.dsws-hold\{([^}]*)\}/) : null
  check(!!m, '样式表里有 .dsws-hold 规则')
  if (m) {
    check(/background:\s*var\(--dsw-alias-bg-layer-1,#10131a\)/.test(m[1]), '.dsws-hold 的底色与面板根节点同源（--dsws-alias-bg-layer-1，兜底 #10131a）')
    check(/height:100%/.test(m[1]), '.dsws-hold 仍然占满高度（#603 的取舍不变）')
  }
  const dock = existsSync(resolve('src/client/panel/Dock.js')) ? readFileSync(resolve('src/client/panel/Dock.js'), 'utf8') : ''
  check(/background:\s*'var\(--dsw-alias-bg-layer-1,#10131a\)'/.test(dock), '面板根节点（DetailsDock）的底色仍是同一档令牌与兜底值')
}

// ---------- B / C 真渲染层 ----------
const CLIENT = 'package/lib/client.js'
if (!texts[CLIENT]) { console.log('\n产物缺失，B/C 组跳过'); console.log(passed + ' 条通过，' + failed + ' 条失败'); process.exit(1) }

// 探针入口：把 React 与本仓库的产物装进一个经典脚本里跑（浏览器里没有模块解析器，所以要打包）
const ENTRY = `
import React from 'react'
import * as ReactDOMClient from 'react-dom/client'
window.React = React
window.__RDOM__ = ReactDOMClient
const src = window.__CLIENT_SRC__
let loaded = null
window.__ModuleLoader__ = { load(spec) { loaded = spec; return spec } }
window.eval(src)
const dict = {}
const trFn = (k) => (dict[k] !== undefined ? dict[k] : k)
const regs = []
const slots = { register: (m, c) => { regs.push({ m, c }); return () => {} }, inject: (n, f) => { try { f() } catch (e) {} } }
const services = {
  slots,
  sidebarRightTabs: { register: () => () => {} },
  connection: { rpc: { call: async () => ({ ok: true }) } },
  locale: { register: (ns, d) => { Object.assign(dict, (d && d.zh) || {}, (d && d.en) || {}); return () => {} }, bind: () => trFn },
  workspaces: { list: async () => [] }, sessions: { list: async () => [] }, timer: { timeout: (f, ms) => setTimeout(f, ms) },
}
const ctx = { get: (k) => services[k], effect: (f) => { f(); return () => {} }, inject: (d, cb) => { cb(ctx); return { dispose: () => {} } } }
window.host = { call: async () => ({ ok: true, maps: [] }) }
loaded.factory((m) => (m === 'react' ? React : m === 'react-dom' ? ReactDOMClient : m === 'react-dom/client' ? ReactDOMClient : {})).apply(ctx)
const body = regs.filter((r) => r.m && r.m.name === 'sidebar.right.pane.tab')[0]
window.__PROBE_START__ = function (dropRule) {
  const style = document.querySelector('style[data-plugin]')
  if (!style) return { error: 'no style tag' }
  const container = document.createElement('div')
  container.id = 'mount'
  container.style.cssText = 'height:100%'
  document.getElementById('pane').appendChild(container)
  const out = []
  const t0 = performance.now()
  const tick = () => {
    const shell = container.firstElementChild
    const cs = shell ? getComputedStyle(shell) : null
    const dock = container.querySelector('[data-dsws-host]')
    out.push({
      t: Math.round(performance.now() - t0),
      shellBg: cs ? cs.backgroundColor : null,
      shellChildren: shell ? shell.children.length : -1,
      shellH: shell ? Math.round(shell.getBoundingClientRect().height) : -1,
      dockBg: dock ? getComputedStyle(dock).backgroundColor : null,
    })
    if (performance.now() - t0 < 700) requestAnimationFrame(tick)
    else {
      const d = container.querySelector('[data-dsws-host]')
      window.__RESULT__ = {
        frames: out,
        dockBg: d ? getComputedStyle(d).backgroundColor : null,
        regs: regs.map((r) => r.m && r.m.name),
        dropped: window.__dropped__ || 0,
      }
    }
  }
  if (!body) return { error: 'no tab body registration', names: regs.map((r) => r.m && r.m.name) }
  // 反证用：把 .dsws-hold 那条规则从样式表里删掉（只影响这一次探针）
  let probeBg = null
  if (dropRule) {
    const before = style.textContent.length
    style.textContent = style.textContent.replace(/\\.dsws-hold\\{[^}]*\\}/g, '')
    window.__dropped__ = before - style.textContent.length
  }
  const probe = document.createElement('div')
  probe.className = 'dsws-hold'
  document.body.appendChild(probe)
  probeBg = getComputedStyle(probe).backgroundColor
  requestAnimationFrame(tick)
  window.__RDOM__.createRoot(container).render(React.createElement(body.c, body.m.inject('sess-1')))
  return { ok: true, probeBg }
}
window.__PROBE_READY__ = true
`

const { build } = await import('esbuild')
const bundled = await build({
  stdin: { contents: ENTRY, resolveDir: resolve('.'), sourcefile: 'verify-670-probe.js', loader: 'js' },
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', write: false, logLevel: 'error',
})
const probeJs = bundled.outputFiles[0].text

const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}#pane{height:600px;display:flex;flex-direction:column}</style></head>
<body><div id="pane"></div>
<script>window.__CLIENT_SRC__ = ${JSON.stringify(texts[CLIENT])};</script>
<script>${probeJs}</script></body></html>`

async function runProbe(page, dropRule) {
  return await page.evaluate(async (drop) => {
    const r = window.__PROBE_START__(drop)
    if (!r || !r.ok) return { error: (r && r.error) || 'no result', names: r && r.names }
    await new Promise((res) => {
      const wait = () => (window.__RESULT__ ? res() : setTimeout(wait, 40))
      wait()
    })
    return Object.assign({}, window.__RESULT__, { probeBg: r.probeBg })
  }, dropRule)
}

// 页面要放在一个真 origin 上（不能用 setContent 的 about:blank：那份文档读 localStorage 会被拒，
//   插件启动时会读调试开关，一读就抛，探针根本跑不起来）。所以起一个本机临时小服务器。
const { createServer } = await import('node:http')
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = 'http://127.0.0.1:' + server.address().port + '/'

console.log('')
console.log('== B 真渲染层（真 Chromium）：第一帧的底色 ==')
const browser = await chromium.launch({ headless: true })
const pageErrors = []
try {
  const page1 = await browser.newPage({ viewport: { width: 900, height: 700 } })
  page1.on('pageerror', (e) => pageErrors.push('pageerror: ' + (e && e.message)))
  page1.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()) })
  await page1.goto(origin, { waitUntil: 'load' })
  try {
    await page1.waitForFunction(() => window.__PROBE_READY__ === true, null, { timeout: 15000 })
  } catch (e) {
    const diag = await page1.evaluate(() => ({
      hasClientSrc: typeof window.__CLIENT_SRC__ === 'string',
      clientSrcLen: typeof window.__CLIENT_SRC__ === 'string' ? window.__CLIENT_SRC__.length : -1,
      hasStart: typeof window.__PROBE_START__,
      hasReact: typeof window.React,
    }))
    check(false, 'B 组探针没就绪：' + JSON.stringify(diag) + ' / ' + JSON.stringify(pageErrors.slice(0, 3)))
    throw e
  }
  const real = await runProbe(page1, false)
  await page1.close()
  if (real.error || !real.frames) {
    check(false, 'B 组跑不起来：' + JSON.stringify(real))
  } else {
    check(real.regs.indexOf('sidebar.right.pane.tab') >= 0, '标签内容体已注册')
    const shellFrames = real.frames.filter((f) => f.shellChildren === 0 && f.shellBg)
    check(shellFrames.length > 0, '读到了「内容还没挂上」的帧（' + shellFrames.length + ' 帧）')
    const firstBg = shellFrames.length ? shellFrames[0].shellBg : null
    check(!!firstBg && firstBg !== 'rgba(0, 0, 0, 0)', '第一帧的空壳有底色（读到 ' + firstBg + '），不是透亮的空块')
    check(!!real.dockBg && real.dockBg === firstBg, '空壳底色与面板根节点底色一致（空壳 ' + firstBg + ' / 面板 ' + real.dockBg + '）')
    check(shellFrames.length ? shellFrames[0].shellH > 100 : false, '空壳仍然占满那一格（高 ' + (shellFrames[0] && shellFrames[0].shellH) + 'px）')
    const contentFrames = real.frames.filter((f) => f.shellChildren > 0)
    check(contentFrames.length > 0, '内容随后挂上（第 ' + (contentFrames[0] && contentFrames[0].t) + ' 毫秒的帧）')
    const bgs = new Set(real.frames.map((f) => f.shellBg).filter(Boolean))
    check(bgs.size === 1, '整段挂载过程里那一层只出现过一种底色（出现过的：' + JSON.stringify(Array.from(bgs)) + '）')
  }

  console.log('')
  console.log('== C 反证：删掉 .dsws-hold 那条规则后，必须量出透明 ==')
  const page2 = await browser.newPage({ viewport: { width: 900, height: 700 } })
  await page2.goto(origin, { waitUntil: 'load' })
  await page2.waitForFunction(() => window.__PROBE_READY__ === true, null, { timeout: 15000 })
  const anti = await runProbe(page2, true)
  await page2.close()
  if (anti.error || !anti.frames) {
    check(false, 'C 组跑不起来：' + JSON.stringify(anti))
  } else {
    check(anti.dropped > 0, '确实删掉了一段规则（' + anti.dropped + ' 个字符）')
    check(anti.probeBg === 'rgba(0, 0, 0, 0)', '同元素在规则被删后量出透明（' + anti.probeBg + '）——说明 B 组量的就是这条规则')
    const firstShell = anti.frames.filter((f) => f.shellChildren === 0 && f.shellBg)[0]
    check(!!firstShell && firstShell.shellBg === 'rgba(0, 0, 0, 0)', '删掉规则后第一帧确实是透明的（' + (firstShell && firstShell.shellBg) + '）——这就是本票要拦的那一帧')
  }
} finally {
  await browser.close()
  await new Promise((r) => server.close(r))
}

console.log('')
console.log(passed + ' 条通过，' + failed + ' 条失败')
process.exit(failed ? 1 : 0)
