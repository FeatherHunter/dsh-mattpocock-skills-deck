#!/usr/bin/env node
/**
 * verify-667-dock-header-no-brand.js — 面板头部不再有品牌图标与文字（#667 门禁）
 *
 * 这一票要的东西（维护者 2026-09-19 原话）：「希望 MattSkills 这个文字在右侧面板中消失，包括那个 LOGO。
 *   此外状态胶囊栏的不要消失」。落到代码上就是：面板头部那一行里、**仓库名左侧**的品牌那一段去掉
 *   （罗盘图标 + 「MattSkills」字样），其余元素一个不动；同时两条边界不许碰 ——
 *   DSH 右栏那个标签页上的名字不改（那是注册标签类型时给的名字），状态胶囊栏照旧。
 *
 * 为什么这道门要真起浏览器量，而不是只断源码文本：
 *   本票的判据有一半是**几何的** ——「左边不再有那一段」等于「这一行的第一个元素就是仓库芯片、且紧贴左内边距」；
 *   「别让去掉之后留下空位或撑破」等于「一行不溢出、窄面板下也一样」。断源码只能证明「源码里没有那两段字」，
 *   证明不了画出来的是什么、位置对不对 —— #666 那次的缺陷恰恰长在「源码全在、纯函数全对，
 *   组件每次却返回 null」这一层，只断文本拦不住它。所以这里把**真产物**（package/lib/client.js）挂进
 *   真 Chromium，走真 rpc 载体（connection.rpc.call）喂一份带仓库的快照，再量那一行。
 *
 * 四组：
 *   A 源码层：头部那一段不再有品牌图标的画法与文字、它的第一个孩子就是仓库芯片那一段；两处「不碰」的还带着品牌；
 *     两份产物里也带着这次改动（改完 src 忘了重建产物，红在这里）。
 *   B 真渲染层（真 Chromium + 真产物 + 真数据）：头部第一个孩子是仓库芯片、贴着左内边距（左侧没有空位）、
 *     整行没有品牌字样也没有罗盘图形、一行不溢出；360 像素窄面板下这四条照旧（#28 那条收缩链还在跑）。
 *   C 反向两处照旧：DSH 右栏标签页的名字仍是「MattSkills」；状态胶囊栏里那枚品牌图标与字样仍在，
 *     而且仍是折叠优先级 1（最先收）。
 *   D 反证：把一段旧的品牌标记插回头部最前面，B 的那几条必须当场变红 —— 否则这道门量的是死数据，是假绿。
 *
 * 依赖：playwright（含 chromium）与 esbuild，都在本仓 devDependencies。全程本机，不碰真仓库、不用登录令牌。
 * 运行：node tests/verify-667-dock-header-no-brand.js
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'

let passed = 0, failed = 0
function ok(msg) { passed++; console.log('  PASS ' + msg) }
function bad(msg) { failed++; console.log('  FAIL ' + msg) }
function check(cond, msg) { if (cond) ok(msg); else bad(msg) }

const DOCK = 'src/client/panel/Dock.js'
const STATUS = 'src/client/statusbar/StatusBar.js'
const ROUTER = 'src/client/kernel/router.js'
const ASSEMBLY = 'src/client/panelAssembly.js'
const SETTINGS = 'src/client/views/SettingsPage.js'
const ICONS = 'src/client/kernel/icons.js'
const ARTIFACTS = ['client.js', 'package/lib/client.js']

const read = (rel) => readFileSync(resolve(rel), 'utf8')
const missing = [DOCK, STATUS, ROUTER, ASSEMBLY, SETTINGS, ICONS, ...ARTIFACTS].filter((rel) => !existsSync(resolve(rel)))
for (const rel of missing) bad(rel + ' 读不到' + (ARTIFACTS.indexOf(rel) >= 0 ? '（先跑 node scripts/build.mjs 重建产物）' : ''))

console.log('=== #667 面板头部不再有品牌图标与文字（状态胶囊栏与标签页名字照旧）===')
console.log('')
console.log('A) 源码层：头部那一段里不再有品牌那两样，且从仓库芯片开始')

const dockSrc = existsSync(resolve(DOCK)) ? read(DOCK) : ''
// 头部那一行整段：从它的 ref 起，到下一段（Pending / MultiHit 黄条）之前。
//   不按行号取，行号会漂；也不按「第一个孩子」取，那样反证那一步就没法插东西。
const headStart = dockSrc.indexOf('ref: headRef')
const headEnd = dockSrc.indexOf('// #155 Q5：Pending / MultiHit 黄条')
const headBlock = (headStart >= 0 && headEnd > headStart) ? dockSrc.slice(headStart, headEnd) : ''
if (!headBlock) {
  bad('A 没取到头部那一段（Dock.js 里 ref: headRef 到「Pending / MultiHit 黄条」之间）')
} else {
  // 判「没有品牌」时先把注释剥掉：注释里提到「MattSkills」是在讲这件事的来历，不是画在界面上的东西。
  const headCode = headBlock.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  if (!/data-head-title/.test(headCode)) ok('A1 标题字那个元素的钩子（data-head-title）不在这段里了')
  else bad('A1 头部还写着 data-head-title —— 标题字元素又回来了')

  if (!/tr\(\s*'panel\.title'\s*\)/.test(headCode)) ok('A2 这段代码里不再出现 tr(\'panel.title\')（品牌字样不画在这一行）')
  else bad("A2 头部这一段里还有 tr('panel.title') —— 品牌字样会画在仓库名左侧")

  if (!/scheme:\s*'compass'/.test(headCode) && !/n:\s*'compass'/.test(headCode)) ok('A3 罗盘图标（compass）不在这段里了（两种写法都查过）')
  else bad('A3 头部这一段里还画着罗盘图标')

  // 第一个孩子必须就是仓库芯片那一段：`}, [` 之后第一个代码 token 是那段 (function(){ ... })()
  const firstTok = (/},\s*\[\s*([\s\S]{0,60})/.exec(headCode) || [])[1] || ''
  check(/^\(function\s*\(\s*\)\s*\{/.test(firstTok.trim()),
    'A4 头部这一行的第一个孩子就是仓库芯片那一段（实测开头：' + JSON.stringify(firstTok.trim().slice(0, 30)) + '）')

  for (const [needle, label] of [
    ['data-repo-chip', '仓库芯片'],
    ['h(SubworkspaceMark', '归属标志'],
    ['data-repo-switch', '切换后端按钮'],
    ['h(LabelColorEntry', '标签配色入口'],
    ['panel.closeTitle', '关闭按钮'],
  ]) {
    check(headCode.indexOf(needle) >= 0, 'A5 其余元素还在：' + label)
  }

  // #28 那条自适应收缩链：去掉标题字之后只剩仓库名一条，且三段（全长 → 短名 → 交给芯片自己省略）都在。
  const fitStart = dockSrc.indexOf('const applyHead = function')
  const fitBlock = fitStart >= 0 ? dockSrc.slice(fitStart, fitStart + 1600) : ''
  check(!!fitBlock && fitBlock.indexOf('titleEl') < 0, 'A6 头部自适应里不再找那个标题字元素（原先那段「先隐藏标题」已随元素一起去掉）')
  check(!!fitBlock && /txt\.textContent = full/.test(fitBlock) && /txt\.textContent = short/.test(fitBlock) && /chip\.style\.flex = '0 1 auto'/.test(fitBlock),
    'A7 仓库名三段收缩链还在（全长 → 短名 → 弹性省略）')
}

console.log('')
console.log('B-pre) 两处「这次不碰」的源码：品牌还长在原来的地方')
const statusSrc = existsSync(resolve(STATUS)) ? read(STATUS) : ''
const assemblySrc = existsSync(resolve(ASSEMBLY)) ? read(ASSEMBLY) : ''
const routerSrc = existsSync(resolve(ROUTER)) ? read(ROUTER) : ''
const settingsSrc = existsSync(resolve(SETTINGS)) ? read(SETTINGS) : ''
check(/data-fold-priority':\s*1[\s\S]{0,40}tr\('panel\.title'\)/.test(statusSrc),
  "A8 状态胶囊栏里那枚品牌字样还在（data-fold-priority 1 + tr('panel.title')）")
check(/Icon\(\{\s*scheme:\s*s\.ui\.icon/.test(statusSrc), 'A9 状态胶囊栏里那枚品牌图标还在')
check(/title:\s*function\s*\(\)\s*\{\s*return tr\('panel\.title'\)\s*\}/.test(assemblySrc) || /title:\s*function\s*\(\)\s*\{\s*return tr\('panel\.title'\)\s*\}/.test(routerSrc),
  'A10 注册标签类型时给的名字仍是 tr(\'panel.title\')（DSH 标签页上那行字不变）')
check(/DeckNativeTabTitle\s*=\s*function\s*\(\)\s*\{\s*return h\('span',\s*null,\s*tr\('panel\.title'\)\)\s*\}/.test(routerSrc),
  'A11 右栏标题栏那格仍画品牌字样（DeckNativeTabTitle 没动）')
check(/Icon\(\{\s*scheme:\s*'compass'[\s\S]{0,200}?tr\('panel\.title'\)/.test(settingsSrc),
  'A12 设置页开头那处品牌（罗盘 + 字样）仍在')

console.log('')
console.log('C-pre) 两份产物里也带着这次改动（改完 src 忘了重建产物就红在这里）')
const artifacts = {}
for (const rel of ARTIFACTS) artifacts[rel] = existsSync(resolve(rel)) ? read(rel) : ''
for (const rel of ARTIFACTS) {
  const t = artifacts[rel]
  if (!t) continue
  check(t.indexOf('data-head-title') < 0, rel + ' 里没有标题字那个钩子')
  check(t.indexOf('data-repo-chip') >= 0, rel + ' 里仓库芯片那一段在')
  check(t.indexOf('这一行的第一个元素就是仓库芯片') >= 0, rel + ' 是从当前 src 重新构建出来的（带着这一版头部注释）')
}

// ---------- 真渲染层：真 Chromium + 真产物 + 真 rpc 载体 ----------
const CLIENT = 'package/lib/client.js'
if (!existsSync(resolve(CLIENT))) {
  console.log('')
  console.log('产物缺失，B/C/D 三组跳过')
  console.log('')
  console.log(passed + ' 条通过，' + failed + ' 条失败')
  process.exit(1)
}

// 喂给面板的那份数据，照宿主真会给的样子写：工作区根是折算过的键（小写 + 正斜杠），
//   会话所选目录是用户自己的写法（子目录）。归属标志因此会出现在头部 —— 这一行是「真的一整行」。
const CWD = 'D:\\ilife\\packages\\skill-calorie'
const SNAP = {
  ok: true,
  version: 'verify-667',
  generatedMs: 1,
  workspaceRoot: 'd:/ilife',
  maps: [],
  checks: null,
  isLocal: false,
  tickets: [],
  groups: {},
  repository: { name: 'FeatherHunter/dsh-mattpocock-skills-deck', url: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck', backend: 'github' },
  selection: { backendId: 'github', source: 'explicit' },
}
// 罗盘图形那几笔从真源里读出来（不在这里另抄一份字面量）：头部不该再出现这段图形。
const compassPoints = (/case 'compass':[\s\S]{0,220}?points:\s*'([^']+)'/.exec(existsSync(resolve(ICONS)) ? read(ICONS) : '') || [])[1] || ''
check(!!compassPoints, '罗盘图形那几笔从 icons.js 真源里取到了（' + JSON.stringify(compassPoints) + '）')

// 探针入口：浏览器里没有模块解析器，所以入口连同 React 一起打包成一段经典脚本。
const ENTRY = `
import React from 'react'
import * as ReactDOMClient from 'react-dom/client'
window.React = React
window.__RDOM__ = ReactDOMClient
const CWD = window.__CWD__
const SNAP = window.__SNAP__
const COMPASS = window.__COMPASS__
let loaded = null
window.__ModuleLoader__ = { load(spec) { loaded = spec; return spec } }
window.eval(window.__CLIENT_SRC__)
const dict = {}
const trFn = (k, p) => {
  let s = dict[k] !== undefined ? dict[k] : k
  if (p) s = s.replace(/\\{(\\w+)\\}/g, (m, n) => (n in p ? String(p[n]) : m))
  return s
}
const regs = []
const nativeTypes = []
const rpcMethods = []
const reply = (method) => {
  if (method === 'cwd') return { ok: true, cwd: CWD }
  if (method === 'snapshot' || method === 'refresh') return SNAP
  if (method === 'chain') return { ok: true, snapshot: { steps: [] }, chain: [], fullChain: null, resolved: [] }
  if (method === 'registry') return { ok: true, modules: [{ id: 'github', label: 'GitHub' }, { id: 'markdown', label: 'Markdown' }] }
  return { ok: true }
}
const services = {
  slots: { register: (m, c) => { regs.push({ m, c }); return () => {} }, inject: (n, f) => { try { f() } catch (e) {} } },
  sidebarRightTabs: { register: (d) => { nativeTypes.push(d); return () => {} } },
  connection: { rpc: { call: async (channel, endpoint, body) => { rpcMethods.push(body && body.method); return { ok: true, value: reply(body && body.method) } } } },
  locale: { register: (ns, d) => { Object.assign(dict, (d && d.zh) || {}, (d && d.en) || {}); return () => {} }, bind: () => trFn },
  workspaces: { list: async () => [] },
  sessions: { list: async () => [] },
  timer: { timeout: (f, ms) => setTimeout(f, ms) },
}
const ctx = { get: (k) => services[k], effect: (f) => { f(); return () => {} }, inject: (deps, cb) => { cb(ctx); return { dispose: () => {} } } }
loaded.factory((m) => (m === 'react' ? React : m === 'react-dom' ? ReactDOMClient : {})).apply(ctx)
const find = (name) => regs.filter((r) => r.m && r.m.name === name)[0]
const body = find('sidebar.right.pane.tab')
const titleComp = find('sidebar.right.pane.tab.title')
const capsuleComp = find('conversation.input.dock')

window.__WAIT__ = (pred, ms) => new Promise((res) => {
  const t0 = Date.now()
  const tick = () => { if (pred() || Date.now() - t0 > ms) res(!!pred()); else setTimeout(tick, 25) }
  tick()
})

window.__MOUNT__ = async function () {
  if (!body) return { error: 'no tab body registration', names: regs.map((r) => r.m && r.m.name) }
  const host = document.createElement('div')
  host.id = 'mount'
  host.style.cssText = 'height:600px'
  document.getElementById('pane').appendChild(host)
  window.__RDOM__.createRoot(host).render(React.createElement(body.c, body.m.inject ? body.m.inject('sess-1') : { sessionId: 'sess-1' }))
  // 标签内容体是「先出空壳、两跳之后再挂真面板」的（#603），所以要等那枚仓库芯片真的画出来。
  const arrived = await window.__WAIT__(() => !!document.querySelector('[data-repo-chip]'), 8000)
  return { ok: !!document.querySelector('[data-dsws-host]'), chipArrived: arrived, rpcMethods: rpcMethods.slice(0, 12), mounted: !!host }
}

window.__ROW__ = function () {
  const dock = document.querySelector('[data-dsws-host]')
  if (!dock) return null
  // 头部那一行 = 面板根节点里、装着仓库芯片的那个直接子节点。
  //   不写死「第一个孩子」：反证那一步要往它前面插东西，写死了就量不到。
  let row = dock.querySelector('[data-repo-chip]')
  while (row && row.parentElement !== dock) row = row.parentElement
  return row || dock.firstElementChild
}

window.__MEASURE__ = function () {
  const dock = document.querySelector('[data-dsws-host]')
  const row = window.__ROW__()
  if (!dock || !row) return { error: 'no row' }
  const rr = row.getBoundingClientRect()
  const padL = parseFloat(getComputedStyle(row).paddingLeft) || 0
  const kids = Array.from(row.children)
  const idxOf = (sel) => kids.findIndex((el) => el.matches(sel) || !!el.querySelector(sel))
  const first = row.firstElementChild
  const fr = first ? first.getBoundingClientRect() : null
  const chipEl = row.querySelector('[data-repo-chip]')
  const cr = chipEl ? chipEl.getBoundingClientRect() : null
  return {
    ok: true,
    rowText: (row.textContent || '').replace(/\\s+/g, ' ').trim(),
    rowWidth: Math.round(rr.width * 100) / 100,
    rowOverflow: row.scrollWidth - row.clientWidth,
    paddingLeft: padL,
    firstTag: first ? first.tagName.toLowerCase() : null,
    firstIsChip: !!first && (first.matches('[data-repo-chip]') || !!first.querySelector('[data-repo-chip]')),
    firstText: first ? (first.textContent || '').replace(/\\s+/g, ' ').trim() : '',
    // 左边有没有「空位」这件事，量的是**仓库芯片自己**离左内边距多远：
    //   它左边什么都没有时是 0；那一段品牌回来（或将来插进别的什么东西）时，它就被推开了。
    chipLeftGap: cr ? Math.round((cr.left - rr.left - padL) * 100) / 100 : null,
    hasCompass: !!row.querySelector('polygon[points="' + COMPASS + '"]'),
    chipIdx: idxOf('[data-repo-chip]'),
    markIdx: idxOf('[data-subws-mark]'),
    switchIdx: idxOf('[data-repo-switch]'),
    paletteIdx: idxOf('[data-label-colors]'),
    closeIdx: idxOf('.dsws-btn.ghost'),
    childCount: kids.length,
    childTags: kids.map((el) => el.tagName.toLowerCase()).join(','),
  }
}

window.__RESIZE__ = function (w) {
  document.getElementById('pane').style.width = w + 'px'
  return w
}

// 反证用：把改动前那一段（罗盘图标 + 品牌字样）照原样插回头部最前面。
window.__INSERT_OLD_BRAND__ = function () {
  const row = window.__ROW__()
  if (!row) return { error: 'no row' }
  const NS = 'http://www.w3.org/2000/svg'
  const icon = document.createElementNS(NS, 'svg')
  icon.setAttribute('viewBox', '0 0 24 24')
  icon.setAttribute('width', '15')
  icon.setAttribute('height', '15')
  icon.setAttribute('fill', 'none')
  icon.setAttribute('stroke', 'currentColor')
  const circle = document.createElementNS(NS, 'circle')
  circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '9')
  const poly = document.createElementNS(NS, 'polygon')
  poly.setAttribute('points', COMPASS)
  icon.appendChild(circle); icon.appendChild(poly)
  const word = document.createElement('span')
  word.setAttribute('data-head-title', '1')
  word.textContent = dict['panel.title'] || 'MattSkills'
  word.style.cssText = 'font-weight:600;font-size:13px;flex:none;white-space:nowrap'
  row.insertBefore(word, row.firstElementChild)
  row.insertBefore(icon, row.firstElementChild)
  return { ok: true, brandWord: word.textContent }
}

window.__TAB_TITLE__ = async function () {
  if (!titleComp) return { error: 'no tab title registration' }
  const host = document.createElement('div')
  document.body.appendChild(host)
  window.__RDOM__.createRoot(host).render(React.createElement(titleComp.c, {}))
  await window.__WAIT__(() => (host.textContent || '').trim().length > 0, 3000)
  return {
    text: (host.textContent || '').trim(),
    typeTitle: (nativeTypes[0] && typeof nativeTypes[0].title === 'function') ? String(nativeTypes[0].title()) : null,
    kind: nativeTypes[0] && nativeTypes[0].kind,
  }
}

window.__CAPSULE__ = async function () {
  if (!capsuleComp) return { error: 'no statusbar registration' }
  const host = document.createElement('div')
  host.style.cssText = 'width:780px'
  document.body.appendChild(host)
  const props = Object.assign(
    capsuleComp.m.inject ? capsuleComp.m.inject('sess-1') : { sessionId: 'sess-1' },
    { session: { cwd: CWD }, useSessions: () => null, inputActions: null },
  )
  let thrown = null
  try {
    window.__RDOM__.createRoot(host).render(React.createElement(capsuleComp.c, props))
  } catch (e) { thrown = String((e && e.message) || e) }
  const arrived = await window.__WAIT__(() => !!host.querySelector('.dsws-capsule'), 5000)
  const cap = host.querySelector('.dsws-capsule')
  const word = cap && cap.querySelector('.dsws-capsule-word')
  const fold = cap && cap.querySelector('[data-fold-priority]')
  return {
    ok: !!cap,
    thrown: thrown,
    arrived: arrived,
    wordText: word ? (word.textContent || '').trim() : '',
    wordHasIcon: !!(word && word.querySelector('svg')),
    foldPriority: fold ? fold.getAttribute('data-fold-priority') : null,
    foldText: fold ? (fold.textContent || '').trim() : '',
  }
}
window.__PROBE_READY__ = true
`

const { build } = await import('esbuild')
const bundled = await build({
  stdin: { contents: ENTRY, resolveDir: resolve('.'), sourcefile: 'verify-667-probe.js', loader: 'js' },
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', write: false, logLevel: 'error',
})
const probeJs = bundled.outputFiles[0].text

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#10131a}
#pane{width:460px;height:600px;display:flex;flex-direction:column}
</style></head>
<body><div id="pane"></div>
<script>window.__CLIENT_SRC__ = ${JSON.stringify(artifacts[CLIENT] || read(CLIENT))};</script>
<script>window.__CWD__ = ${JSON.stringify(CWD)};window.__SNAP__ = ${JSON.stringify(SNAP)};window.__COMPASS__ = ${JSON.stringify(compassPoints)};</script>
<script>${probeJs}</script></body></html>`

// 页面要落在一个真 origin 上：插件启动时要读 localStorage（调试开关那些），
//   about:blank / file:// 上读它会直接抛，探针根本跑不起来。所以起一个本机临时小服务器。
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = 'http://127.0.0.1:' + server.address().port + '/'

const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + (e && e.message)))
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()) })
  await page.goto(origin, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__PROBE_READY__ === true, null, { timeout: 15000 })

  console.log('')
  console.log('B) 真渲染：460 像素宽（面板的常态宽度）下的头部那一行')
  const mounted = await page.evaluate(() => window.__MOUNT__())
  if (!mounted.ok || !mounted.chipArrived) {
    bad('B 面板没挂起来：' + JSON.stringify(mounted) + ' / 页面错误 ' + JSON.stringify(pageErrors.slice(0, 3)))
  } else {
    ok('B0 面板挂起来了，头部那枚仓库芯片也画出来了（rpc 载体上走过：' + JSON.stringify(mounted.rpcMethods.slice(0, 6)) + '）')
    const m = await page.evaluate(() => window.__MEASURE__())
    if (m.error) {
      bad('B 没量到头部那一行：' + JSON.stringify(m))
    } else {
      check(m.firstIsChip, 'B1 头部这一行的第一个元素就是仓库芯片（实测第一个：<' + m.firstTag + '> ' + JSON.stringify(m.firstText.slice(0, 40)) + '）')
      check(m.chipLeftGap !== null && Math.abs(m.chipLeftGap) <= 1.5,
        'B2 仓库芯片自己贴着左内边距：它左边什么都没有、也没有留下空位（实测芯片左偏 ' + m.chipLeftGap + ' 像素，这一行的内边距 ' + m.paddingLeft + '）')
      check(m.rowText.indexOf('MattSkills') < 0, 'B3 整行看不到品牌字样（实测这一行的字：' + JSON.stringify(m.rowText.slice(0, 80)) + '）')
      check(!m.hasCompass, 'B4 整行没有罗盘那几笔图形（' + JSON.stringify(m.hasCompass) + '）')
      check(m.rowOverflow <= 1, 'B5 一行不溢出（scrollWidth-clientWidth = ' + m.rowOverflow + '）')
      check(m.chipIdx === 0, 'B6 仓库芯片是第 0 个孩子（实测下标 ' + m.chipIdx + '）')
      check(m.markIdx > 0 && m.switchIdx > m.markIdx && m.paletteIdx > m.switchIdx && m.closeIdx > m.paletteIdx,
        'B7 其余元素的相对次序不变：芯片 → 归属标志 → 切换后端 → 标签配色 → 关闭（实测下标 ' + JSON.stringify([m.chipIdx, m.markIdx, m.switchIdx, m.paletteIdx, m.closeIdx]) + '）')
      console.log('     （这一行实测有 ' + m.childCount + ' 个孩子：' + m.childTags + '）')
    }

    console.log('')
    console.log('B-narrow) 360 像素窄面板（低于 380，会走窄档样式）下这四条照旧')
    await page.evaluate(() => window.__RESIZE__(360))
    await page.waitForTimeout(400)
    const n = await page.evaluate(() => window.__MEASURE__())
    if (n.error) {
      bad('B-narrow 没量到头部那一行：' + JSON.stringify(n))
    } else {
      check(n.rowWidth <= 361, 'Bn0 面板确实变窄了（实测宽 ' + n.rowWidth + '）')
      check(n.firstIsChip, 'Bn1 窄面板下第一个元素仍是仓库芯片（实测 ' + JSON.stringify(n.firstText.slice(0, 40)) + '）')
      check(n.chipLeftGap !== null && Math.abs(n.chipLeftGap) <= 1.5, 'Bn2 窄面板下仓库芯片仍贴着左内边距、左边没有空位（实测芯片左偏 ' + n.chipLeftGap + ' 像素）')
      check(n.rowText.indexOf('MattSkills') < 0 && !n.hasCompass, 'Bn3 窄面板下没有品牌字样也没有罗盘图形')
      check(n.rowOverflow <= 1, 'Bn4 窄面板下一行不溢出（scrollWidth-clientWidth = ' + n.rowOverflow + '）—— 去掉那一段没有把这一行撑破')
      check(n.switchIdx > 0 && n.paletteIdx > 0 && n.closeIdx > 0, 'Bn5 三颗按钮窄面板下都还在（切换后端 / 标签配色 / 关闭）')
    }

    console.log('')
    console.log('C) 反向：这次不许碰的两处照旧')
    const t = await page.evaluate(() => window.__TAB_TITLE__())
    check(t.text === 'MattSkills', 'C1 DSH 右栏那格标签标题画的仍是「MattSkills」（实测 ' + JSON.stringify(t.text) + '）')
    check(t.typeTitle === 'MattSkills', 'C2 注册标签类型时给的名字仍是「MattSkills」（实测 ' + JSON.stringify(t.typeTitle) + '，kind ' + JSON.stringify(t.kind) + '）')
    const cap = await page.evaluate(() => window.__CAPSULE__())
    if (!cap.ok) {
      bad('C3 状态胶囊栏没挂起来：' + JSON.stringify(cap))
    } else {
      check(cap.wordText.indexOf('MattSkills') >= 0, 'C3 状态胶囊栏里那枚品牌字样仍在（实测 ' + JSON.stringify(cap.wordText) + '）')
      check(cap.wordHasIcon, 'C4 状态胶囊栏里那枚品牌图标仍在')
      check(cap.foldPriority === '1' && cap.foldText === cap.wordText,
        'C5 品牌那一段仍是折叠优先级 1（最先收）（实测 priority ' + JSON.stringify(cap.foldPriority) + '）')
    }

    console.log('')
    console.log('D) 反证：把改动前那一段插回头部最前面，B 的那几条必须当场变红')
    const ins = await page.evaluate(() => window.__INSERT_OLD_BRAND__())
    if (ins.error) {
      bad('D 反证没插进去：' + JSON.stringify(ins))
    } else {
      const a = await page.evaluate(() => window.__MEASURE__())
      check(a.ok && a.firstIsChip === false, 'D1 插回品牌之后，第一个元素不再是仓库芯片了（这道门量的确实是当场那一行）')
      check(a.ok && a.chipLeftGap > 1, 'D2 插回品牌之后，仓库芯片被那段字挤到了右边（实测芯片左偏 ' + a.chipLeftGap + ' 像素 —— 旧写法下 B2 那条会红）')
      check(a.ok && a.rowText.indexOf(ins.brandWord) >= 0, 'D3 插回品牌之后整行读到了品牌字样（' + JSON.stringify(ins.brandWord) + ' —— B3 那条在旧写法下会红）')
      check(a.ok && a.hasCompass === true, 'D4 插回品牌之后整行读到了罗盘图形（B4 那条在旧写法下会红）')
    }
  }
  await page.close()
} finally {
  await browser.close()
  await new Promise((r) => server.close(r))
}

console.log('')
console.log(passed + ' 条通过，' + failed + ' 条失败')
console.log(failed ? '=== FAIL：面板头部还不是「从仓库芯片开始」的样子 ===' : '=== OK：#667 面板头部无品牌、两处照旧 ===')
process.exit(failed ? 1 : 0)
