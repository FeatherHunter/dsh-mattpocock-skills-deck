#!/usr/bin/env node
/**
 * verify-cap-fold-browser.js — 状态栏胶囊「随宽度一格一格变短」的真浏览器门禁（#725 真机回归，2026-09-24）
 *
 * 为什么另开一份、而不是并进 tests/verify-cap-fold.js：那一份量的是「档与档之间每步只让掉一个单位」
 *   这条**相对**规矩，跑在一个裸 <div> 宿主里 —— 里面没有宿主的卡宽/侧距那套变量，胶囊能拿到多少
 *   可用宽跟真机不一样（实测裸宿主能拿到 662，真机常见窗口下也是 662，但宽窗口下真机能到 904）。
 *   而这一次的真机回归（维护者截图：整条只剩品牌图标与绿点、中间一片空白）恰恰出在「胶囊到底拿到
 *   多少可用宽」上，所以要有一份**照抄宿主几何**的门禁：列的宽 → 宿主输入区 dock 的算式 → 插件自己
 *   那层 wrapper → 胶囊，逐层照 src/client/statusbar/StatusBar.js 的 dswsStatusDockGeom 与宿主
 *   client.js 里那两条 CSS 变量（--dsh-composer-card-max-width / --dsh-composer-side-clearance）算。
 *
 * 本文件钉三条不变量（维护者 2026-09-24 那三条，逐条对应一组断言）：
 *   I1 载荷不撤、永不全折：品牌图标与四枚计数器的数字在任何宽度都在 DOM 里可见（矩形宽高 > 0、
 *      文本非空、没被 .dsws-folded 收掉）；宽的那两档还要求「放得下」且仍有字露在外面。
 *   I2 无效测量不推进档位：首帧还没布局（列宽 0 / 父容器 display:none）那一趟，机器不许拿
 *      「量到 0」当「放不下」一路推到最后一档 —— 除品牌那一段（契约里本来就默认折叠）外，
 *      不许有第二段字被收掉。
 *   I3 可回弹：宽度从窄变宽，版面上露出来的字只许变多不许变少（每一档的可见字集合是上一层宽度的子集）。
 *   I4 宽度变化就是重算信号：胶囊晚生（先收起功能区、再展开）之后，只改面板列宽（窗口尺寸一点没动）
 *      也必须重算 —— 这台机器靠 ResizeObserver 与「每次提交后重算一次」，不靠任何轮询。
 *
 * 依赖：playwright（含 chromium）与 esbuild，都在本仓 devDependencies。全程本机，不碰真仓库、不用登录令牌。
 * 运行：node tests/verify-cap-fold-browser.js（先 node scripts/build.mjs 生成产物）
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'

let passed = 0, failed = 0
function ok(msg) { passed++; console.log('  PASS ' + msg) }
function bad(msg) { failed++; console.log('  FAIL ' + msg) }
function check(cond, msg) { if (cond) ok(msg); else bad(msg) }
const read = (rel) => readFileSync(resolve(rel), 'utf8')

// 真机那套读数：可接/BUG/诊断 各 0（没有工单），环境 10/10（链上十步全 done），时间用快照生成时刻。
const CWD = 'D:\\ilife\\packages\\skill-calorie'
const CHAIN_STEPS = Array.from({ length: 10 }, (_, i) => ({ id: 'step-' + (i + 1), status: 'done', title: 'step ' + (i + 1) }))
const SNAP = {
  ok: true, version: 'verify-cap-fold-browser', generatedMs: Date.now() - 3 * 60 * 1000,
  workspaceRoot: 'd:/ilife', maps: [], checks: null, isLocal: false, tickets: [], groups: {},
  repository: { name: 'FeatherHunter/dsh-mattpocock-skills-deck', url: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck', backend: 'github' },
  selection: { backendId: 'github', source: 'explicit' },
}
const CLIENT = 'package/lib/client.js'
if (!existsSync(resolve(CLIENT))) {
  console.log('产物缺失（' + CLIENT + '）：先跑 node scripts/build.mjs')
  process.exit(1)
}

const ENTRY = `
import React from 'react'
import * as ReactDOMClient from 'react-dom/client'
window.React = React
window.__RDOM__ = ReactDOMClient
const CWD = window.__CWD__
const SNAP = window.__SNAP__
const CHAIN_STEPS = window.__CHAIN_STEPS__
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
const reply = (method) => {
  if (method === 'cwd') return { ok: true, cwd: CWD }
  if (method === 'snapshot' || method === 'refresh') return SNAP
  if (method === 'chain') return { ok: true, snapshot: { steps: CHAIN_STEPS }, chain: CHAIN_STEPS.map((s) => s.id), fullChain: null, resolved: [] }
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
const capsuleComp = regs.filter((r) => r.m && r.m.name === 'conversation.input.dock')[0]

window.__TICK__ = async function (n) {
  for (let i = 0; i < (n || 3); i++) await new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 16) }) })
}
window.__WAIT__ = (pred, ms) => new Promise((res) => {
  const t0 = Date.now()
  const tick = () => { if (pred() || Date.now() - t0 > ms) res(!!pred()); else setTimeout(tick, 25) }
  tick()
})
// 档位稳定 = 连续三次读到同一个值（机器按真实可用宽度算，没有写死的阈值）。
window.__SETTLE__ = async function () {
  const cap = document.querySelector('.dsws-capsule')
  if (!cap) return null
  let last = null, same = 0
  for (let i = 0; i < 90; i++) {
    await new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 16) }) })
    const cur = cap.getAttribute('data-fold-tier')
    if (cur === last) { same++; if (same >= 3) return cur } else { last = cur; same = 0 }
  }
  return last
}
// 照抄真机几何：列 → 宿主的 composer dock → 插件的挂载点。列宽同时写进 --dsh-conversation-column-width
//   （宿主那两条变量都在 :root 上按它算，所以这里必须写到 documentElement 上，写在列上算不到）。
window.__MOUNT__ = async function (o) {
  const opt = o || {}
  const old = document.getElementById('col')
  if (old) old.remove()
  const col = document.createElement('div')
  col.id = 'col'
  col.style.width = (opt.column === undefined ? 1200 : opt.column) + 'px'
  if (opt.display) col.style.display = opt.display
  const dock = document.createElement('div')
  dock.id = 'dock'
  dock.style.cssText = 'box-sizing:border-box;margin:0 auto;' +
    'width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));' +
    'max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))'
  const slot = document.createElement('div')
  slot.id = 'slot'
  dock.appendChild(slot)
  col.appendChild(dock)
  document.body.appendChild(col)
  window.__COL__ = col
  document.documentElement.style.setProperty('--dsh-conversation-column-width', (opt.column === undefined ? 1200 : opt.column) + 'px')
  if (!capsuleComp) return { error: 'no statusbar registration', names: regs.map((r) => r.m && r.m.name) }
  const props = Object.assign(
    capsuleComp.m.inject ? capsuleComp.m.inject('sess-1') : { sessionId: 'sess-1' },
    { session: { cwd: CWD }, useSessions: () => null, inputActions: null },
  )
  let thrown = null
  try { window.__RDOM__.createRoot(slot).render(React.createElement(capsuleComp.c, props)) } catch (e) { thrown = String((e && e.message) || e) }
  const arrived = await window.__WAIT__(() => !!slot.querySelector('.dsws-capsule'), 8000)
  if (opt.settle !== false) await window.__SETTLE__()
  return { ok: !!slot.querySelector('.dsws-capsule'), arrived: arrived, thrown: thrown }
}
// 只改面板列宽：窗口尺寸一点没动（真机上「打开/收起右侧面板」就是这一种）。
window.__SET_COLUMN__ = async function (w) {
  window.__COL__.style.width = w + 'px'
  document.documentElement.style.setProperty('--dsh-conversation-column-width', w + 'px')
  await window.__TICK__(2)
  return await window.__SETTLE__()
}
window.__FOLD_DECK__ = async function () {
  const t = document.querySelector('.dsws-fold-toggle')
  if (!t) return { error: 'no fold toggle' }
  t.click()
  await window.__TICK__(3)
  return { ok: !document.querySelector('.dsws-capsule') }
}
window.__EXPAND_DECK__ = async function () {
  const btn = Array.from(document.querySelectorAll('#col button')).filter(function (b) { return !document.querySelector('.dsws-capsule') })[0]
  if (!btn) return { error: 'no expand button' }
  btn.click()
  const arrived = await window.__WAIT__(() => !!document.querySelector('.dsws-capsule'), 5000)
  await window.__TICK__(3)
  return { ok: !!document.querySelector('.dsws-capsule'), arrived: arrived }
}
// 一帧实况：档号、折叠段数、胶囊与宿主的尺寸、四枚计数器的数字、品牌图标、每一段字的可见情况。
window.__MEASURE__ = function () {
  const cap = document.querySelector('.dsws-capsule')
  if (!cap) return { error: 'no capsule' }
  const vis = function (el) {
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), display: cs.display, visible: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' }
  }
  const capRect = cap.getBoundingClientRect()
  const labels = Array.from(cap.querySelectorAll('[data-fold-priority]')).map(function (el) {
    return { p: String(el.getAttribute('data-fold-priority') || ''), text: String(el.textContent || ''), folded: el.classList.contains('dsws-folded'), box: vis(el) }
  })
  const nums = Array.from(cap.querySelectorAll('.dsws-num')).map(function (el) {
    const r = el.getBoundingClientRect()
    return {
      text: String(el.textContent || ''),
      visible: r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none',
      insideCapsule: r.left >= capRect.left - 1 && r.right <= capRect.right + 1,
    }
  })
  const word = cap.querySelector('.dsws-capsule-word')
  const icon = word ? word.querySelector('svg') : null
  const words = labels.filter(function (l) { return l.text.trim() !== '' && !l.folded }).map(function (l) { return l.p })
  return {
    tier: cap.getAttribute('data-fold-tier'),
    folded: labels.filter(function (l) { return l.folded }).length,
    labelCount: labels.length,
    cap: { clientW: cap.clientWidth, scrollW: cap.scrollWidth, overflow: cap.scrollWidth - cap.clientWidth, w: Math.round(capRect.width) },
    colW: (document.getElementById('col') || {}).clientWidth,
    dockW: (document.getElementById('dock') || {}).clientWidth,
    nums: nums,
    brandIcon: vis(icon),
    labels: labels,
    words: words,
  }
}
// 载荷自身有多宽：把「九段字全收掉」这件事做在**克隆件**上量（绝不碰真节点 ——
//   机器那张「机器上一次写下的字」表认的是 DOM 里当前那串，探针若往真节点里写空串，
//   机器下一次就会把空串当成新事实记进「完整的那串」，那一整段字从此再也展不开）。
window.__PAYLOAD_W__ = function () {
  const cap = document.querySelector('.dsws-capsule')
  const clone = cap.cloneNode(true)
  clone.style.position = 'absolute'
  clone.style.visibility = 'hidden'
  clone.style.left = '-10000px'
  clone.style.width = 'max-content' // 让克隆件按内容自然宽排，量出来的就是载荷自己要占多宽
  clone.style.maxWidth = 'none'
  Array.from(clone.querySelectorAll('[data-fold-priority]')).forEach(function (el) { el.textContent = ''; el.classList.add('dsws-folded') })
  cap.parentElement.appendChild(clone)
  void clone.offsetWidth
  const w = Math.round(clone.getBoundingClientRect().width)
  clone.remove()
  return w
}
// 第 0 档（九段字全展开那一档）要多大：同样做在克隆件上量 —— 把九段字按给定的完整那串填回去、
//   去掉折叠类，读这一份的 clientWidth / scrollWidth。真节点一个字都不碰。
window.__TIER0__ = function (texts) {
  const cap = document.querySelector('.dsws-capsule')
  const clone = cap.cloneNode(true)
  clone.style.position = 'absolute'
  clone.style.visibility = 'hidden'
  clone.style.left = '-10000px'
  // 克隆件必须和真胶囊一样宽：绝对定位的盒子会另找包含块，宽度要明写（否则它按 max-width 封顶、
  //   量出来的 clientWidth 与真胶囊不是一回事）。
  clone.style.width = Math.round(cap.getBoundingClientRect().width) + 'px'
  Array.from(clone.querySelectorAll('[data-fold-priority]')).forEach(function (el) {
    const p = String(el.getAttribute('data-fold-priority') || '')
    el.classList.remove('dsws-folded')
    if (texts && Object.prototype.hasOwnProperty.call(texts, p)) el.textContent = texts[p]
  })
  cap.parentElement.appendChild(clone)
  void clone.offsetWidth
  const out = { clientW: clone.clientWidth, scrollW: clone.scrollWidth, overflow: clone.scrollWidth - clone.clientWidth }
  clone.remove()
  return out
}
// 九段字完整那串：第 0 档上（宽条）从真节点上抄下来，供上面那个克隆件用。
window.__FULL_TEXTS__ = function () {
  const cap = document.querySelector('.dsws-capsule')
  const out = {}
  Array.from(cap.querySelectorAll('[data-fold-priority]')).forEach(function (el) {
    const p = String(el.getAttribute('data-fold-priority') || '')
    if (!el.classList.contains('dsws-folded')) out[p] = String(el.textContent || '')
  })
  return out
}
window.__PROBE_READY__ = true
`

const { build } = await import('esbuild')
const bundled = await build({
  stdin: { contents: ENTRY, resolveDir: resolve('.'), sourcefile: 'verify-cap-fold-browser-probe.js', loader: 'js' },
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', write: false, logLevel: 'error',
})
const probeJs = bundled.outputFiles[0].text
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#10131a;color:#e6edf3;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
/* 宿主 client.js 第 14652 / 15757 行那两条规则的原文（值也是真机实测值） */
:root{--dsh-chat-content-width:clamp(680px,calc(var(--dsh-conversation-column-width,0px) * .64),920px);
      --dsh-composer-card-max-width:calc(var(--dsh-chat-content-width) + 32px);
      --dsh-composer-side-clearance:16px;--dsh-composer-dock-inset:8px}
</style></head>
<body>
<script>window.__CLIENT_SRC__ = ${JSON.stringify(read(CLIENT))};</script>
<script>window.__CWD__ = ${JSON.stringify(CWD)};window.__SNAP__ = ${JSON.stringify(SNAP)};window.__CHAIN_STEPS__ = ${JSON.stringify(CHAIN_STEPS)};</script>
<script>${probeJs}</script></body></html>`

const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html) })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = 'http://127.0.0.1:' + server.address().port + '/'
const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true })
// 四枚计数器的数字：可接 / BUG / 诊断 / 环境（顺序与状态栏那四段一致）。
const numLine = (m) => JSON.stringify(m.nums.map((n) => n.text))
const payLine = (m) => '档' + m.tier + ' 收' + m.folded + '/' + m.labelCount + ' 大写' + m.cap.clientW + '/滑' + m.cap.scrollW +
  ' 列' + m.colW + ' dock' + m.dockW + ' 数字' + numLine(m) + ' 露出的字' + JSON.stringify(m.words) + ' 品牌图标' + (m.brandIcon && m.brandIcon.visible ? '在' : '不在')
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 700 } })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + (e && e.message)))
  page.on('console', (m) => { if (m.type() === 'error' && m.text().indexOf('unique "key" prop') < 0) pageErrors.push('console: ' + m.text()) })
  await page.goto(origin, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__PROBE_READY__ === true, null, { timeout: 15000 })

  console.log('')
  console.log('I1) 载荷不撤、永不全折：320 / 380 / 900 / 1600 四种面板宽度上量四枚计数器的数字与品牌图标')
  const widths = [320, 380, 900, 1600]
  const seen = {}
  const payloadW = {}
  for (const w of widths) {
    const mounted = await page.evaluate((x) => window.__MOUNT__({ column: x }), w)
    if (!mounted || !mounted.ok) { bad('I1 列宽 ' + w + ' 挂不起来：' + JSON.stringify(mounted)); continue }
    payloadW[w] = await page.evaluate(() => window.__PAYLOAD_W__())
    await page.evaluate(() => window.__SETTLE__())
    const after = await page.evaluate(() => window.__MEASURE__())
    seen[w] = after
    console.log('     ' + w + ' → ' + payLine(after) + ' 载荷要 ' + payloadW[w] + ' 像素')
    // I1a：四枚数字 + 品牌图标都在、都看得见、文本非空、都没被 .dsws-folded 收掉
    const numsOk = after.nums.length >= 4 && after.nums.every((n) => n.text.trim() !== '' && n.visible)
    const brandOk = !!(after.brandIcon && after.brandIcon.visible)
    check(numsOk, 'I1a 列宽 ' + w + '：四枚计数器的数字都在、都看得见、文本非空（实测 ' + numLine(after) + '）')
    check(brandOk, 'I1a 列宽 ' + w + '：品牌图标在、看得见（实测 ' + JSON.stringify(after.brandIcon) + '）')
    const foldedNum = after.nums.filter((n, i) => !n.visible).length
    check(foldedNum === 0, 'I1a 列宽 ' + w + '：一枚数字都没有被撤掉（实测看不见的有 ' + foldedNum + ' 枚）')
  }
  // I1b：宽的那两档必须「放得下」且还露着字（这一条就是维护者截图的反面：那一版整条只剩两枚图标）
  for (const w of [900, 1600]) {
    const m = seen[w]
    if (!m) continue
    check(m.cap.overflow <= 1, 'I1b 列宽 ' + w + '：宽条上放得下（scrollWidth-clientWidth = ' + m.cap.overflow + '）')
    check(m.folded < m.labelCount, 'I1b 列宽 ' + w + '：没有全折（收掉 ' + m.folded + ' 段，共 ' + m.labelCount + ' 段）')
    check(m.words.length >= 6, 'I1b 列宽 ' + w + '：宽条上露出来的字至少六段（实测 ' + JSON.stringify(m.words) + '）')
  }
  // I1c：载荷装得下的时候，四枚数字必须都在胶囊框里；装不下时（胶囊比载荷还窄）这一条几何上做不到，
  //   按契约由外层的 overflow 处理 —— 门禁把观测值照原样打出来，但只在「装得下」时判红绿。
  for (const w of [320, 380]) {
    const m = seen[w]
    if (!m || !payloadW[w]) continue
    const outside = m.nums.filter((n) => !n.insideCapsule).length
    const fitsPayload = m.cap.clientW >= payloadW[w] + 1
    console.log('     （列宽 ' + w + '：胶囊 ' + m.cap.clientW + ' 像素 / 载荷要 ' + payloadW[w] + ' 像素' +
      (fitsPayload ? '，装得下' : '，装不下') + '；出框的数字 ' + outside + ' 枚）')
    check(!fitsPayload || outside === 0,
      'I1c 列宽 ' + w + '：载荷装得下时四枚数字必须都在胶囊框里（实测胶囊 ' + m.cap.clientW + '、载荷 ' + payloadW[w] + '，出框 ' + outside + ' 枚）')
  }

  console.log('')
  console.log('W) 第 0 档（九段字全展开）要多大：宽 1600 / 900 / 600 / 380 / 320 各量一次（照真机几何）')
  {
    const probeWidths = [1600, 900, 600, 380, 320]
    const mounted0 = await page.evaluate(() => window.__MOUNT__({ column: 1600 }))
    if (!mounted0 || !mounted0.ok) bad('W 量第 0 档前挂不起来：' + JSON.stringify(mounted0))
    const fullTexts = await page.evaluate(() => window.__FULL_TEXTS__())
    console.log('     九段字完整那串（取自第 0 档的真节点）：' + JSON.stringify(fullTexts))
    let zeroFits = null
    for (const w of probeWidths) {
      await page.evaluate((x) => window.__SET_COLUMN__(x), w)
      const m = await page.evaluate(() => window.__MEASURE__())
      const t0 = await page.evaluate((t) => window.__TIER0__(t), fullTexts)
      console.log('     列宽 ' + w + '：胶囊可用 ' + t0.clientW + '，第 0 档要 ' + t0.scrollW + '（溢 ' + t0.overflow + '）；机器定在 档' + m.tier + '（收 ' + m.folded + '/9）')
      if (w === 1600) zeroFits = t0.overflow
    }
    // 宽到 1600 时第 0 档放得下 —— 那机器就必须停在那一档（只收掉契约里默认折叠的品牌那一段）
    check(zeroFits !== null && zeroFits <= 1, 'W1 列宽 1600：第 0 档放得下（实测溢 ' + zeroFits + '）')
    await page.evaluate(() => window.__SET_COLUMN__(1600))
    const wideNow = await page.evaluate(() => window.__MEASURE__())
    check(Number(wideNow.tier) === 0 && wideNow.folded === 1,
      'W1 列宽 1600：第 0 档放得下时机器就停在第 0 档、只收掉品牌那一段（实测 档' + wideNow.tier + '、收 ' + wideNow.folded + '/9）')
  }

  console.log('')
  console.log('I2) 无效测量不推进档位：首帧还没布局的那一趟（列宽 0 与父容器 display:none 两式）')
  for (const flavor of ['zero', 'hidden']) {
    const o = flavor === 'zero' ? { column: 0 } : { column: 800, display: 'none' }
    const mounted = await page.evaluate((x) => window.__MOUNT__(Object.assign({ settle: false }, x)), o)
    if (!mounted || !mounted.ok) { bad('I2 ' + flavor + ' 挂不起来：' + JSON.stringify(mounted)); continue }
    const m = await page.evaluate(() => window.__MEASURE__())
    console.log('     ' + flavor + ' → ' + payLine(m))
    // 除品牌那一段（契约里默认折叠）以外，不许有第二段字被收掉
    const foldedOther = m.labels.filter((l) => l.folded && l.p !== '1').map((l) => l.p)
    check(foldedOther.length === 0, 'I2 ' + flavor + ' 那一趟没有把别的字收掉（实测被收的号码：' + JSON.stringify(foldedOther) + '，共 ' + m.folded + ' 段）')
    check(m.tier === null || Number(m.tier) < m.labelCount, 'I2 ' + flavor + ' 那一趟没有落到最后一档（实测档号 ' + m.tier + '）')
    const numsOk = m.nums.length >= 4 && m.nums.every((n) => n.text.trim() !== '')
    check(numsOk, 'I2 ' + flavor + ' 那一帧四枚数字的文本都还在（实测 ' + numLine(m) + '）')
    // 「不推进档位」的另一种说法：那九段字里除品牌那一段外，一段都不许被写成空串
    const lost = m.labels.filter((l) => l.p !== '1' && String(l.text).trim() === '').map((l) => l.p)
    check(lost.length === 0, 'I2 ' + flavor + ' 那一帧没有一段字被写成空串（实测空掉的号码：' + JSON.stringify(lost) + '）')
    if (flavor === 'zero') {
      // 宽度真的到齐之后必须回到正确档（这一条是绿的是因为在的那几条重算路还在：观察器 / 提交 / 字体）
      await page.evaluate(() => window.__SET_COLUMN__(700))
      const back = await page.evaluate(() => window.__MEASURE__())
      console.log('     zero 再补上列宽 700 → ' + payLine(back))
      check(back.cap.overflow <= 1 && back.folded < back.labelCount && back.words.length >= 3,
        'I2 补上有效宽度之后回到正确档（实测溢 ' + back.cap.overflow + '、收 ' + back.folded + '/' + back.labelCount + '、露出的字 ' + JSON.stringify(back.words) + '）')
    }
  }

  console.log('')
  console.log('I3) 可回弹：320 → 380 → 900 → 1600 再折回来，露出来的字只许多不许少')
  const seq = [320, 380, 900, 1600, 380, 320]
  const seqSeen = []
  const remounted = await page.evaluate((x) => window.__MOUNT__({ column: x[0] }), seq)
  if (!remounted || !remounted.ok) bad('I3 重新挂载失败：' + JSON.stringify(remounted))
  for (const w of seq) {
    await page.evaluate((x) => window.__SET_COLUMN__(x), w)
    const m = await page.evaluate(() => window.__MEASURE__())
    seqSeen.push({ w: w, m: m })
    console.log('     ' + w + ' → ' + payLine(m))
  }
  let monoBad = null
  for (let i = 1; i < seqSeen.length; i++) {
    const a = seqSeen[i - 1], b = seqSeen[i]
    // 变宽：露出的字只许多（b 必须包含 a 露出的那些）；变窄：只许少。
    if (b.w > a.w) {
      const missing = a.m.words.filter((p) => b.m.words.indexOf(p) < 0)
      if (missing.length) monoBad = a.w + '→' + b.w + ' 变宽反而收了 ' + JSON.stringify(missing)
    } else if (b.w < a.w) {
      const extra = b.m.words.filter((p) => a.m.words.indexOf(p) < 0)
      if (extra.length) monoBad = a.w + '→' + b.w + ' 变窄反而放出 ' + JSON.stringify(extra)
    } else {
      const same = JSON.stringify(a.m.words) === JSON.stringify(b.m.words)
      if (!same) monoBad = '同一宽度两次量出来不一样：' + JSON.stringify(a.m.words) + ' / ' + JSON.stringify(b.m.words)
    }
  }
  check(!monoBad, 'I3 露出来的字随宽度单调（宽了只许多、窄了只许少；实测偏差 ' + (monoBad || '一处都没有') + '）')
  const first1600 = seqSeen[3].m, back320 = seqSeen[5].m
  check(JSON.stringify(seen[320] ? seen[320].words : []) === JSON.stringify(back320.words) &&
    JSON.stringify(seen[1600] ? seen[1600].words : []) === JSON.stringify(first1600.words),
    'I3 同一个宽度来回走一趟，露出来的字没有漂移（320：' + JSON.stringify(back320.words) + '；1600：' + JSON.stringify(first1600.words) + '）')

  console.log('')
  console.log('I4) 宽度变化就是重算信号：胶囊晚生（先收起功能区再展开）之后，只改面板列宽也要重算')
  {
    const mounted = await page.evaluate(() => window.__MOUNT__({ column: 480 }))
    const folded = await page.evaluate(() => window.__FOLD_DECK__())
    const expanded = await page.evaluate(() => window.__EXPAND_DECK__())
    const atNarrow = await page.evaluate(() => window.__MEASURE__())
    await page.evaluate(() => window.__SETTLE__())
    const atNarrow2 = await page.evaluate(() => window.__MEASURE__())
    // 只改面板列宽：窗口尺寸一点没动（真机上就是「收起右侧面板」）
    await page.evaluate(() => window.__SET_COLUMN__(1600))
    const atWide = await page.evaluate(() => window.__MEASURE__())
    console.log('     折叠功能区 ' + JSON.stringify(folded) + ' / 展开 ' + JSON.stringify(expanded))
    console.log('     列宽 480 → ' + payLine(atNarrow2))
    console.log('     列宽 1600（窗口没动）→ ' + payLine(atWide))
    check(!!mounted && !!mounted.ok && !!folded && folded.ok === true && !!expanded && expanded.ok === true,
      'I4 前情：胶囊先收起来再展开（实测 ' + JSON.stringify(folded) + ' / ' + JSON.stringify(expanded) + '）')
    check(atWide.cap.overflow <= 1 || atWide.folded >= atWide.labelCount,
      'I4 列宽变宽之后这一条仍放得下或确实收到底（实测溢 ' + atWide.cap.overflow + '、收 ' + atWide.folded + '/' + atWide.labelCount + '）')
    check(atWide.words.length >= atNarrow2.words.length,
      'I4 只改列宽也重算：变宽之后露出来的字不变少（480 时 ' + JSON.stringify(atNarrow2.words) + ' → 1600 时 ' + JSON.stringify(atWide.words) + '）')
  }

  const thrown = pageErrors.filter((e) => e.indexOf('pageerror:') === 0)
  check(thrown.length === 0, '整段扫描期间页面没有未捕获的报错（实测 ' + thrown.length + ' 条' + (thrown.length ? '：' + JSON.stringify(thrown.slice(0, 3)) : '') + '）')
} finally {
  await browser.close()
  server.close()
}
console.log('')
console.log(passed + ' 条通过，' + failed + ' 条失败')
process.exit(failed ? 1 : 0)
