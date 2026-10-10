#!/usr/bin/env node
/**
 * verify-958-label-name-visible.js — 真浏览器门禁：标签配色弹窗里的字必须真的看得见（#958）
 *
 * 为什么另开一份：这个弹窗长在面板头部那颗调色盘入口图标里面，而入口外面那层 span 写着
 *   lineHeight: 0（写它的用意只是把图标自己的行盒压没，见 src/client/panel/Dock.js 那颗图标）。
 *   行高是会继承的属性，于是弹窗里所有不自己写行高的字都继承了 0：行盒高度 0，字只能靠溢出画出来；
 *   标签名那一格自己带 overflow:hidden（为了超长省略号），字就被整段裁掉 —— 行数、颜色、顺序全对，
 *   名字格一片空白（#958 的现场）。纯源码断言看不出这件事：字在 DOM 里、数据也对，只有真浏览器
 *   量出来的行盒高度能看出来。所以这道门用真 Chromium 挂面板、点开弹窗、逐行量名字格。
 *
 * 本文件钉三条：
 *   I1 名字进了界面状态：22 行行数对上、每行名字非空（数据侧那一半，沿用既有口径）。
 *   I2 名字看得见：每一行名字格的渲染高度 > 0、计算行高不是 0px（这就是 #958 掉的那一环）。
 *   I3 门禁自己是活的（反证）：把弹窗的行高按回 0，同一把尺子必须量出「行盒塌了」，否则这道门在装绿。
 *
 * 依赖：playwright（含 chromium），本仓 devDependencies。跑之前先 node scripts/build.mjs 出产物。
 * 运行：node tests/verify-958-label-name-visible.js
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'

let passed = 0, failed = 0
const check = (cond, msg) => { if (cond) { passed++; console.log('  PASS ' + msg) } else { failed++; console.log('  FAIL ' + msg) } }
console.log('标签配色弹窗可见性门禁（#958：名字格的行盒不许是 0 高）')

// 被测产物：默认是本仓构建出来的那份；给 DSWS_958_BUNDLE 一个路径可以量别人手里那份（排查用）。
const CLIENT = process.env.DSWS_958_BUNDLE && existsSync(process.env.DSWS_958_BUNDLE) ? process.env.DSWS_958_BUNDLE : 'package/lib/client.js'
if (!existsSync(resolve(CLIENT))) { console.log('产物缺失（' + CLIENT + '）：先跑 node scripts/build.mjs'); process.exit(1) }

const CWD = process.cwd()
const LABELS = [
  { name: 'bug', color: 'd73a4a' }, { name: 'needs-triage', color: 'fbca04' },
  { name: 'ready-for-agent', color: '0e8a16' }, { name: 'ready-for-human', color: 'b60205' },
  { name: 'needs-info', color: '5319e7' }, { name: 'wontfix', color: 'ffffff' },
  { name: 'wayfinder:map', color: '8b5cf6' }, { name: 'wayfinder:task', color: '10b981' },
  { name: 'wayfinder:research', color: '0ea5e9' }, { name: 'wayfinder:prototype', color: 'f59e0b' },
  { name: 'wayfinder:grilling', color: '9d7cd8' }, { name: 'enhancement', color: 'a2eeef' },
  { name: 'documentation', color: '0075ca' }, { name: 'accessibility', color: 'f143ab' },
  { name: 'duplicate', color: 'cfd3d7' }, { name: 'invalid', color: 'e4e669' },
  { name: 'question', color: 'd876e3' }, { name: 'good first issue', color: '7057ff' },
  { name: 'help wanted', color: '008672' }, { name: 'dependencies', color: '0366d6' },
  { name: 'javascript', color: '168700' }, { name: 'github_actions', color: '000000' },
]
const SNAP = {
  ok: true, version: 'verify-958', generatedMs: Date.now() - 1000,
  workspaceRoot: CWD.replace(/\\\\/g, '/'), maps: [], checks: null, isLocal: false, tickets: [], groups: {},
  repository: { name: 'FeatherHunter/dsh-mattpocock-skills-deck', url: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck', backend: 'github', refId: 'FeatherHunter/dsh-mattpocock-skills-deck' },
  selection: { backendId: 'github', source: 'explicit' },
}

const ENTRY = `
import React from 'react'
import * as ReactDOMClient from 'react-dom/client'
window.React = React
window.__RDOM__ = ReactDOMClient
const CWD = window.__CWD__
const SNAP = window.__SNAP__
const LABELS = window.__LABELS__
let loaded = null
window.__ModuleLoader__ = { load(spec) { loaded = spec; return spec } }
const runInPage = (code) => { const s = document.createElement('script'); s.textContent = code; document.body.appendChild(s) }
runInPage(window.__CLIENT_SRC__)
const dict = {}
const trFn = (k, p) => { let s = dict[k] !== undefined ? dict[k] : k; if (p) s = s.replace(/\\{(\\w+)\\}/g, (m, n) => (n in p ? String(p[n]) : m)); return s }
const regs = []
const reply = (method) => {
  const m = String(method || '')
  if (m === 'cwd' || m === 'wf.cwd') return { ok: true, cwd: CWD }
  if (m === 'snapshot' || m === 'wf.snapshot' || m === 'refresh' || m === 'wf.refresh') return SNAP
  if (m === 'registry' || m === 'wf.registry') return { ok: true, modules: [{ id: 'github', label: 'GitHub', presentation: {}, openRepository: 'url' }, { id: 'markdown', label: 'Markdown', presentation: {}, openRepository: 'folder' }] }
  if (m === 'listLabels' || m === 'wf.listLabels') return { ok: true, backendId: 'github', labels: LABELS }
  if (m === 'selection' || m === 'wf.selection') return { ok: true, selection: { backendId: 'github', pending: false } }
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
window.__TICK__ = async (n) => { for (let i = 0; i < (n || 3); i++) await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 16))) }
window.__WAIT__ = (pred, ms) => new Promise((res) => { const t0 = Date.now(); const tick = () => { if (pred() || Date.now() - t0 > ms) res(!!pred()); else setTimeout(tick, 25) }; tick() })
window.__MOUNT__ = async function () {
  const slot = document.getElementById('panel-slot')
  const order = ['sidebar.right.pane.tab', 'details', 'dock-seat']
  let reg = null
  for (const n of order) { const hit = regs.filter((r) => r.m && r.m.name === n)[0]; if (hit) { reg = hit; break } }
  if (!reg) return { error: '找不到面板注册件', names: regs.map((r) => r.m && r.m.name) }
  const props = Object.assign(reg.m.inject ? reg.m.inject('sess-1') : { sessionId: 'sess-1' }, { session: { cwd: CWD }, sessionId: 'sess-1', useSessions: () => null, inputActions: null, cwd: CWD })
  try { window.__RDOM__.createRoot(slot).render(React.createElement(reg.c, props)) } catch (e) { return { error: 'mount threw: ' + String((e && e.message) || e) } }
  await window.__TICK__(6)
  return { ok: true }
}
window.__OPEN__ = async function () {
  const entry = document.querySelector('[data-label-colors]')
  if (!entry) return { error: '面板头部没有调色盘入口' }
  entry.click()
  const arrived = await window.__WAIT__(() => !!document.querySelector('[data-role="label-colors-dialog"]'), 8000)
  await window.__TICK__(4)
  return { ok: true, arrived }
}
// 同一把尺子：量每一行名字格的渲染高度与计算行高。不带任何依赖数据的假设。
window.__MEASURE__ = function () {
  const dlg = document.querySelector('[data-role="label-colors-dialog"]')
  if (!dlg) return { error: '弹窗没打开' }
  const box = dlg.querySelector('[data-role="label-colors-box"]')
  const titleSpan = dlg.querySelector('[data-role="label-colors-box"] span')
  const rows = Array.from(dlg.querySelectorAll('[data-lc-row]')).map(function (el) {
    const nameEl = el.children[1]
    const r = nameEl ? nameEl.getBoundingClientRect() : null
    const cs = nameEl ? getComputedStyle(nameEl) : null
    return { name: nameEl ? String(nameEl.textContent || '') : '', h: r ? Math.round(r.height) : -1, lh: cs ? cs.lineHeight : '' }
  })
  return {
    rows: rows.length,
    named: rows.filter((x) => x.name.trim() !== '').length,
    visible: rows.filter((x) => x.h > 0).length,
    zeroHeight: rows.filter((x) => x.h <= 0).length,
    sample: rows.slice(0, 3),
    titleH: titleSpan ? Math.round(titleSpan.getBoundingClientRect().height) : -1,
    boxLh: box ? getComputedStyle(box).lineHeight : '',
  }
}
window.__FORCE_COLLAPSE__ = function () {
  const box = document.querySelector('[data-role="label-colors-box"]')
  if (!box) return { error: '弹窗没打开' }
  box.style.lineHeight = '0'
  return { ok: true }
}
window.__PROBE_READY__ = true
`

const { build } = await import('esbuild')
const bundled = await build({
  stdin: { contents: ENTRY, resolveDir: resolve('.'), sourcefile: 'verify-958-probe.js', loader: 'js' },
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', write: false, logLevel: 'error',
})
const probeJs = bundled.outputFiles[0].text
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#151517;color:#e6edf3;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
#wrap{display:flex;justify-content:flex-end}#panel-slot{width:380px;min-height:700px;background:#151517}
</style></head><body>
<div id="wrap"><div id="panel-slot"></div></div>
<script>window.__CLIENT_SRC__ = ${JSON.stringify(readFileSync(CLIENT, 'utf8'))};</script>
<script>window.__CWD__ = ${JSON.stringify(CWD)};window.__SNAP__ = ${JSON.stringify(SNAP)};window.__LABELS__ = ${JSON.stringify(LABELS)};</script>
<script>${probeJs}</script></body></html>`

const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html) })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = 'http://127.0.0.1:' + server.address().port
const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  await page.goto(origin)
  await page.waitForFunction('window.__PROBE_READY__ === true', null, { timeout: 20000 })
  const mount = await page.evaluate(() => window.__MOUNT__())
  check(!mount.error, '面板挂起来了' + (mount.error ? ' —— ' + mount.error + '（注册件：' + JSON.stringify(mount.names) + '）' : ''))
  const opened = await page.evaluate(() => window.__OPEN__())
  check(!opened.error && opened.arrived, '点头部那颗调色盘入口，弹窗打开' + (opened.error ? ' —— ' + opened.error : (opened.arrived ? '' : ' —— 弹窗没出现')))
  const m = await page.evaluate(() => window.__MEASURE__())
  check(m.rows === 22, '弹窗列出全部 22 行（实得 ' + m.rows + ' 行）')
  check(m.named === 22, '22 行的名字都进了界面状态（实得 ' + m.named + ' 行有名字）')
  check(m.visible === 22, '22 行的名字都看得见（渲染高度 > 0，实得 ' + m.visible + ' 行）' + (m.zeroHeight ? ' —— 行盒塌了 ' + m.zeroHeight + ' 行，行高：' + JSON.stringify(m.sample.map((x) => x.lh)) : ''))
  check(m.titleH > 0, '弹窗标题的字也看得见（渲染高度 ' + m.titleH + '）')
  // I3 反证：把弹窗行高按回 0，同一把尺子必须量出塌掉的行盒；量不出就是这道门在装绿。
  const forced = await page.evaluate(() => window.__FORCE_COLLAPSE__())
  check(!forced.error, '反证：把弹窗行高按回 0 这一步做得成' + (forced.error ? ' —— ' + forced.error : ''))
  const m2 = await page.evaluate(() => window.__MEASURE__())
  check(m2.zeroHeight === 22, '反证：行高按回 0 之后，同一把尺子量出 22 行行盒塌掉（实得 ' + m2.zeroHeight + ' 行）—— 量不出说明这道门量不到东西')
} finally {
  await browser.close()
  server.close()
}
console.log(failed ? '\n存在失败 — verify-958 未通过' : '\n全部通过 — 标签配色弹窗可见性门禁生效（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
