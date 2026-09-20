#!/usr/bin/env node
/**
 * verify-670-panel-first-frame.js — #670 门禁：面板挂上来之前，那一格不许与它背后的宿主底色不一样
 *
 * 这一票的用户症状是「面板区先黑一下，内容随后才出现」。2026-09-20 的现场核实把根因定到了
 *   那一格**背后那一层**：宿主右栏面板容器自己的底取 --dsw-alias-bg-base（深色主题 #151517），
 *   而本插件的面板原先取 --dsw-alias-bg-layer-1（页面那一档，深色主题 #232324）—— 差一档。
 *   宿主画好那一格、本插件还没画出第一笔的那一瞬，露出来的是更黑的宿主底，用户看到的就是那一下黑。
 * 所以本条要钉死的是：**本插件画出来的第一帧，底色与它背后宿主那一层完全一样**（深浅两个主题都要）。
 *
 * 为什么要用真浏览器、而且夹具里要带真令牌：
 *   1. jsdom 的 getComputedStyle 不解析 CSS 里的 var()（写成 var(--x,#10131a) 一律回透明），
 *      而本插件所有底色都写成 var(...) —— 在 jsdom 里量这件事必然假绿。
 *   2. 更要紧的是**夹具必须带上宿主真实定义的那些令牌**。第一版夹具只写了 html/body/#pane 三条规则，
 *      没有任何 --dsw-alias-* 令牌，于是插件取到的是兜底值 #10131a —— 一个真机上根本不存在的颜色，
 *      它就量不出「插件取页面那一档、宿主取栏目那一档」这个差别，也就拦不住这次退化。
 *      现在夹具逐字带上宿主主题包里的那两条定义（深色/浅色各一套），并按宿主产物那道
 *      ._12sy_W_panel 的写法给出一层 bg-base 的底。
 *
 * 断三件事：
 *   A 源码层（真源 styles.js / Dock.js + 两份产物）：空壳与真内容共用 .dsws-hold，且两处底色都取
 *     --dsw-alias-bg-base（同一个令牌、同一个兜底值），不再取页面那一档 --dsw-alias-bg-layer-1。
 *   B 真渲染层（深浅两个主题各一遍）：把标签内容体挂起来逐帧量 —— 第一帧就要有底色，且与宿主那一层同值；
 *     面板根节点也与宿主那一层同值；整段挂载过程那一层只出现过一种底色。
 *   C 反证：把 .dsws-hold 那条规则删掉再跑一遍，第一帧必须量出「透明」——否则本门是假绿。
 *
 * 用法：node tests/verify-670-panel-first-frame.js
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

let passed = 0, failed = 0
function check(ok, msg) { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }

const FILES = ['src/client/kernel/router.js', 'src/client/kernel/styles.js', 'src/client/panel/Dock.js', 'client.js', 'package/lib/client.js']
const RENDER_FILES = ['src/client/kernel/router.js', 'client.js', 'package/lib/client.js']
const texts = {}
for (const rel of FILES) {
  const p = resolve(rel)
  texts[rel] = existsSync(p) ? readFileSync(p, 'utf8') : null
  if (texts[rel] === null) check(false, rel + ' 读不到（先跑 npm run build）')
}

console.log('== A 源码层：两处底色取宿主那一档（bg-base），且不再取页面那一档（bg-layer-1） ==')
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
    check(/background:\s*var\(--dsw-alias-bg-base,#10131a\)/.test(m[1]), '.dsws-hold 的底色取宿主那一档（--dsw-alias-bg-base，兜底 #10131a）')
    check(!/--dsw-alias-bg-layer-1/.test(m[1]), '.dsws-hold 不再取页面那一档（--dsw-alias-bg-layer-1）')
    check(/height:100%/.test(m[1]), '.dsws-hold 仍然占满高度（#603 的取舍不变）')
  }
  const dock = texts['src/client/panel/Dock.js'] || ''
  check(/background:\s*'var\(--dsw-alias-bg-base,#10131a\)'/.test(dock), '面板根节点（DetailsDock）的底色与空壳同档（--dsw-alias-bg-base，同一个兜底值）')
  check(!/background:\s*'var\(--dsw-alias-bg-layer-1,#10131a\)'/.test(dock), '面板根节点不再取页面那一档（--dsw-alias-bg-layer-1）')
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
  if (!body) return { error: 'no tab body registration', names: regs.map((r) => r.m && r.m.name) }
  const style = document.querySelector('style[data-plugin]')
  if (!style) return { error: 'no style tag' }
  const hostLayer = document.getElementById('hostpanel')
  // 反证用：把 .dsws-hold 那条规则从样式表里删掉（只影响这一次探针）
  let dropped = 0
  if (dropRule) {
    const before = style.textContent.length
    style.textContent = style.textContent.replace(/\\.dsws-hold\\{[^}]*\\}/g, '')
    dropped = before - style.textContent.length
  }
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
        hostBg: getComputedStyle(hostLayer).backgroundColor,
        regs: regs.map((r) => r.m && r.m.name),
        dropped: dropped,
      }
    }
  }
  requestAnimationFrame(tick)
  window.__RDOM__.createRoot(container).render(React.createElement(body.c, body.m.inject('sess-1')))
  return { ok: true }
}
window.__PROBE_READY__ = true
`

const { build } = await import('esbuild')
const bundled = await build({
  stdin: { contents: ENTRY, resolveDir: resolve('.'), sourcefile: 'verify-670-probe.js', loader: 'js' },
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', write: false, logLevel: 'error',
})
const probeJs = bundled.outputFiles[0].text

// 真主题令牌：逐字抄自宿主主题包 @deepseek-ai/dsh-client-ui-theme（深浅两套）。
// 宿主右栏面板容器按产物里那一条 ._12sy_W_panel 写：background: var(--dsw-alias-bg-base)。
const THEME_CSS = `:root{--dsw-static-neutral-bluish-00:#fff;--dsw-static-neutral-bluish-875:#232324;--dsw-static-neutral-bluish-950:#151517}
body{--dsw-alias-bg-base:var(--dsw-static-neutral-bluish-00);--dsw-alias-bg-layer-1:var(--dsw-static-neutral-bluish-00)}
body[data-ds-dark-theme]{--dsw-alias-bg-base:var(--dsw-static-neutral-bluish-950);--dsw-alias-bg-layer-1:var(--dsw-static-neutral-bluish-875)}`

const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}
${THEME_CSS}
#hostpanel{height:600px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}
#pane{height:600px;display:flex;flex-direction:column}
</style></head>
<body><div id="hostpanel"><div id="pane"></div></div>
<script>window.__CLIENT_SRC__ = ${JSON.stringify(texts[CLIENT])};</script>
<script>${probeJs}</script></body></html>`

// 两个主题下那一格背后到底应当是什么颜色（取自宿主主题包的真值）
const EXPECT = {
  dark: 'rgb(21, 21, 23)',
  light: 'rgb(255, 255, 255)',
}

async function runProbe(page, dropRule) {
  return await page.evaluate(async (drop) => {
    const r = window.__PROBE_START__(drop)
    if (!r || !r.ok) return { error: (r && r.error) || 'no result', names: r && r.names }
    await new Promise((res) => {
      const wait = () => (window.__RESULT__ ? res() : setTimeout(wait, 40))
      wait()
    })
    return window.__RESULT__
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

const browser = await chromium.launch({ headless: true })
try {
  for (const theme of ['dark', 'light']) {
    console.log('')
    console.log('== B 真渲染层（真 Chromium · ' + (theme === 'dark' ? '深色主题' : '浅色主题') + '）：第一帧的底色 ==')
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push('pageerror: ' + (e && e.message)))
    page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()) })
    await page.goto(origin, { waitUntil: 'load' })
    if (theme === 'dark') await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
    try {
      await page.waitForFunction(() => window.__PROBE_READY__ === true, null, { timeout: 15000 })
    } catch (e) {
      check(false, theme + ' 主题下探针没就绪：' + JSON.stringify(pageErrors.slice(0, 3)))
      await page.close()
      continue
    }
    const real = await runProbe(page, false)
    await page.close()
    if (real.error || !real.frames) { check(false, theme + ' 主题下 B 组跑不起来：' + JSON.stringify(real)); continue }

    check(real.hostBg === EXPECT[theme], '夹具里宿主那一层的底取自真令牌（读到 ' + real.hostBg + '，应为 ' + EXPECT[theme] + '）')
    check(real.regs.indexOf('sidebar.right.pane.tab') >= 0, '标签内容体已注册')
    const shellFrames = real.frames.filter((f) => f.shellChildren === 0 && f.shellBg)
    check(shellFrames.length > 0, '读到了「内容还没挂上」的帧（' + shellFrames.length + ' 帧）')
    const firstBg = shellFrames.length ? shellFrames[0].shellBg : null
    check(!!firstBg && firstBg !== 'rgba(0, 0, 0, 0)', '第一帧的空壳有底色（读到 ' + firstBg + '），不是透亮的空块')
    check(firstBg === real.hostBg, '**第一帧的底色与宿主右栏那一层一致**（第一帧 ' + firstBg + ' / 宿主 ' + real.hostBg + '）')
    check(!!real.dockBg && real.dockBg === real.hostBg, '面板根节点的底色与宿主右栏那一层一致（面板 ' + real.dockBg + ' / 宿主 ' + real.hostBg + '）')
    check(shellFrames.length ? shellFrames[0].shellH > 100 : false, '空壳仍然占满那一格（高 ' + (shellFrames[0] && shellFrames[0].shellH) + 'px）')
    const contentFrames = real.frames.filter((f) => f.shellChildren > 0)
    check(contentFrames.length > 0, '内容随后挂上（第 ' + (contentFrames[0] && contentFrames[0].t) + ' 毫秒的帧）')
    const bgs = new Set(real.frames.map((f) => f.shellBg).filter(Boolean))
    check(bgs.size === 1, '整段挂载过程里那一层只出现过一种底色（出现过的：' + JSON.stringify(Array.from(bgs)) + '）')
  }

  console.log('')
  console.log('== C 反证：删掉 .dsws-hold 那条规则后，第一帧必须量出透明（否则 B 组是假绿） ==')
  const page2 = await browser.newPage({ viewport: { width: 900, height: 700 } })
  await page2.goto(origin, { waitUntil: 'load' })
  await page2.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
  await page2.waitForFunction(() => window.__PROBE_READY__ === true, null, { timeout: 15000 })
  const anti = await runProbe(page2, true)
  await page2.close()
  if (anti.error || !anti.frames) {
    check(false, 'C 组跑不起来：' + JSON.stringify(anti))
  } else {
    check(anti.dropped > 0, '确实删掉了一段规则（' + anti.dropped + ' 个字符）')
    const firstShell = anti.frames.filter((f) => f.shellChildren === 0 && f.shellBg)[0]
    check(!!firstShell && firstShell.shellBg === 'rgba(0, 0, 0, 0)', '删掉规则后第一帧确实是透明的（' + (firstShell && firstShell.shellBg) + '）——说明 B 组量的就是这条规则')
    check(!!firstShell && firstShell.shellBg !== anti.hostBg, '透明那一下确实与宿主那一层不同色（' + (firstShell && firstShell.shellBg) + ' 对 ' + anti.hostBg + '）——这一帧就是本票要拦的')
  }
} finally {
  await browser.close()
  await new Promise((r) => server.close(r))
}

console.log('')
console.log(passed + ' 条通过，' + failed + ' 条失败')
process.exit(failed ? 1 : 0)
