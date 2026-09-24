#!/usr/bin/env node
/**
 * verify-capsule-layout.js — 状态栏胶囊「图标与文字成整体、各项间隔均匀」的真机门禁（2026-09-24 维护者反馈）
 *
 * 维护者那一轮的两句原话（截图：降级横幅左边两个三角那次一起提的）：
 *   「胶囊中的几个按钮过于集中在右侧，应该均匀分布在状态胶囊栏中。」
 *   「品牌图标与 MattSkills 文字之间的间隙太大。」
 *
 * 为什么这一份要真起 Chromium 量、而不是断 CSS 文本：这两件事都是**画出来之后的几何**，
 *   断源码只证明「某条规则写着某个值」，证明不了它作用在哪一层、也证明不了两条规则叠起来的结果。
 *   这一轮的实际教训就是这个：`column-gap:clamp(6px,2.2vw,28px)` 写在 `.dsws-capsule-word` 上时，
 *   它不只撑开「各项之间」，也把**图标与它自己那串字**一起撑开了（实测宽条 28px）——
 *   看源码看不出这一层，量出来一眼就是它。
 *
 * 本文件先把**真实机制**量清楚再判（报告里那两条机制是量出来的，不是猜的）：
 *   · 机制一：`.dsws-capsule-word` 上那条随视口放大的 column-gap 同时作用于「图标↔自己的文字」；
 *   · 机制二：`.dsws-capsule-word` 带 `flex: 1 1 auto`，在 `justify-content:space-between` 之下
 *     **它一个元素吃掉了全部余量**：宽条实测那一段宽 230.6 像素（内容只要 95），
 *     而其余各项被顶成一簇、相邻空隙只剩胶囊自己那 6px 的 gap；最右那一枚与它之间留出一个大洞。
 *
 * 三组断言（都用真浏览器量）：
 *   G1 图标↔自己的文字：间隙是一个固定的小值（3–8px），且在**每一档都相等**（容差 ±1px）——
 *      它不许随视口放大。
 *   G2 各项之间：相邻两项的空隙**处处相等**（同一档里最大值 ÷ 最小值 ≤ 1.5，人工定的阈值），
 *      也就是余量由各项一起分、不是被某一个元素吃掉；边缘那一条（最右一项到胶囊右内边）另算，
 *      它天然是小内边距，不参与这项比较。
 *   G3 单调：各项中心的横坐标随次序严格递增（版面顺序与写的一致）。
 *   G4 放得下：每一档都不溢出（可让的字让完为止；极窄那种由外层的 overflow 兜）。
 *   G5 反向自检（自带反证）：把「某一个孩子独占余量」这件事在**克隆件**上重演一遍，
 *      G2 那把尺子必须当场报红 —— 抓不住就是假绿（克隆件上量，绝不碰真节点）。
 *
 * 依赖：playwright（含 chromium）与 esbuild，都在本仓 devDependencies。全程本机，不碰真仓库、不用登录令牌。
 * 运行：node tests/verify-capsule-layout.js（先 node scripts/build.mjs 生成产物）
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'

let passed = 0, failed = 0
function ok(msg) { passed++; console.log('  PASS ' + msg) }
function bad(msg) { failed++; console.log('  FAIL ' + msg) }
function check(cond, msg) { if (cond) ok(msg); else bad(msg) }

// 人工定的两个阈值（写进断言、也写进报告）：
//   · 图标与它自己那串字之间的间隙，允许 3–8 像素（今天写的是 5）；
//   · 相邻两项空隙的「最大值 ÷ 最小值」不许超过 1.5（真机上实测约 1.0–1.14）。
const ICON_TEXT_MIN = 3
const ICON_TEXT_MAX = 8
const EVEN_RATIO_MAX = 1.5

const CLIENT = 'package/lib/client.js'
if (!existsSync(resolve(CLIENT))) {
  console.log('产物缺失（' + CLIENT + '）：先跑 node scripts/build.mjs')
  process.exit(1)
}
const CWD = 'D:\\ilife\\packages\\skill-calorie'
const CHAIN_STEPS = Array.from({ length: 10 }, (_, i) => ({ id: 'step-' + (i + 1), status: 'done', title: 'step ' + (i + 1) }))
const SNAP = {
  ok: true, version: 'verify-capsule-layout', generatedMs: Date.now() - 3 * 60 * 1000,
  workspaceRoot: 'd:/ilife', maps: [], checks: null, isLocal: false, tickets: [], groups: {},
  repository: { name: 'FeatherHunter/dsh-mattpocock-skills-deck', url: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck', backend: 'github' },
  selection: { backendId: 'github', source: 'explicit' },
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
// 照抄真机几何：列 → 宿主的 composer dock → 插件的挂载点（与 verify-cap-fold-browser 同一套算式）
window.__MOUNT__ = async function (o) {
  const opt = o || {}
  const old = document.getElementById('col')
  if (old) old.remove()
  const col = document.createElement('div')
  col.id = 'col'
  col.style.width = (opt.column === undefined ? 1200 : opt.column) + 'px'
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
  await window.__SETTLE__()
  return { ok: !!slot.querySelector('.dsws-capsule'), arrived: arrived, thrown: thrown }
}
window.__SET_COLUMN__ = async function (w) {
  window.__COL__.style.width = w + 'px'
  document.documentElement.style.setProperty('--dsh-conversation-column-width', w + 'px')
  await window.__TICK__(2)
  return await window.__SETTLE__()
}
// 一帧的几何：胶囊里每一个孩子的框（相对胶囊左内边）、相邻空隙、图标与它自己那串字之间的间隙。
window.__GEOM__ = function () {
  const cap = document.querySelector('.dsws-capsule')
  if (!cap) return { error: 'no capsule' }
  const cr = cap.getBoundingClientRect()
  const padL = parseFloat(getComputedStyle(cap).paddingLeft) || 0
  const padR = parseFloat(getComputedStyle(cap).paddingRight) || 0
  const kids = Array.from(cap.children).map(function (el, i) {
    const r = el.getBoundingClientRect()
    return {
      i: i, tag: el.tagName.toLowerCase(), cls: String(el.className || ''),
      left: Math.round((r.left - cr.left) * 100) / 100,
      right: Math.round((r.right - cr.left) * 100) / 100,
      w: Math.round(r.width * 100) / 100,
      c: Math.round(((r.left + r.right) / 2 - cr.left) * 100) / 100,
      text: String(el.textContent || '').replace(/\\s+/g, ' ').trim(),
    }
  })
  const gaps = []
  for (let i = 1; i < kids.length; i++) {
    gaps.push({ i: i, gap: Math.round((kids[i].left - kids[i - 1].right) * 100) / 100, from: kids[i - 1].cls.slice(0, 20), to: kids[i].cls.slice(0, 20) })
  }
  const word = cap.querySelector('.dsws-capsule-word')
  const icon = word ? word.querySelector('svg') : null
  const brand = cap.querySelector('[data-fold-priority="1"]')
  let iconToBrand = null
  if (icon && brand) {
    const brandText = String(brand.textContent || '').trim()
    if (brandText !== '') iconToBrand = Math.round((brand.getBoundingClientRect().left - icon.getBoundingClientRect().right) * 100) / 100
  }
  // 「有没有哪一个孩子把余量一个人吃掉」这件事，量的是**它自己那一格比它里面真正装的东西宽出多少**。
  //   取那一段的内部内容宽（内部孩子加起来的宽 + 它们之间的间隙），与它自己被分配到的宽相比：
  //   没有人吃余量时这两个数几乎相等（差在像素取整），有一个孩子把余量吃掉时它俩差出一大截。
  //   为什么不用「相邻空隙是否相等」来量这件事：被吃掉的那一格与它旁边那格的空隙照样是基础间隙，
  //   相邻空隙可能看上去很整齐 —— 2026-09-24 实测过这一脚（克隆件上把 flex:1 加回去，空隙仍是
  //   均匀的 [6,6,…]，判据抓不住）。
  const slackOf = function (el) {
    if (!el) return null
    const kids = Array.from(el.children)
    if (!kids.length) return null
    const rs = kids.map(function (k) { return k.getBoundingClientRect().width })
    const inner = rs.reduce(function (a, b) { return a + b }, 0)
    let gaps = 0
    for (let i = 1; i < kids.length; i++) {
      gaps += kids[i].getBoundingClientRect().left - kids[i - 1].getBoundingClientRect().right
    }
    const allocated = el.getBoundingClientRect().width - (parseFloat(getComputedStyle(el).paddingLeft) || 0) - (parseFloat(getComputedStyle(el).paddingRight) || 0)
    return { allocated: Math.round(allocated * 100) / 100, inner: Math.round((inner + gaps) * 100) / 100, slack: Math.round((allocated - inner - gaps) * 100) / 100 }
  }
  return {
    ok: true,
    capW: Math.round(cr.width * 100) / 100,
    padL: padL, padR: padR,
    tier: cap.getAttribute('data-fold-tier'),
    overflow: cap.scrollWidth - cap.clientWidth,
    kids: kids,
    gaps: gaps,
    iconToBrand: iconToBrand,
    word: word ? { slack: slackOf(word), flex: getComputedStyle(word).flex } : null,
    edgeRight: kids.length ? Math.round((cr.width - kids[kids.length - 1].right) * 100) / 100 : null,
    wordFlex: word ? getComputedStyle(word).flex : null,
  }
}
// G5 反证用：克隆一份胶囊，把「某一个孩子独占余量」这件事在克隆件上重演（真节点一个字不碰）。
window.__CLONE_MONOPOLY__ = function () {
  const cap = document.querySelector('.dsws-capsule')
  if (!cap) return { error: 'no capsule' }
  const clone = cap.cloneNode(true)
  clone.style.position = 'absolute'
  clone.style.visibility = 'hidden'
  clone.style.left = '-10000px'
  clone.style.width = Math.round(cap.getBoundingClientRect().width) + 'px'
  cap.parentElement.appendChild(clone)
  // 让第一个孩子吃掉全部余量（这正是上一版那条 flex:1 1 auto 在宽条上的效果）
  clone.children[0].style.flex = '1 1 auto'
  clone.children[0].style.maxWidth = 'none'
  void clone.offsetWidth
  const cr = clone.getBoundingClientRect()
  const kids = Array.from(clone.children)
  const gaps = []
  for (let i = 1; i < kids.length; i++) {
    gaps.push(Math.round((kids[i].getBoundingClientRect().left - kids[i - 1].getBoundingClientRect().right) * 100) / 100)
  }
  const w = Math.round(cr.width)
  const first = clone.children[0]
  const fr = first.getBoundingClientRect()
  const firstSlack = (function () {
    const kids = Array.from(first.children)
    const inner = kids.reduce(function (a, k) { return a + k.getBoundingClientRect().width }, 0)
    let gaps = 0
    for (let i = 1; i < kids.length; i++) gaps += kids[i].getBoundingClientRect().left - kids[i - 1].getBoundingClientRect().right
    const cs = getComputedStyle(first)
    const allocated = fr.width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
    return { allocated: Math.round(allocated * 100) / 100, inner: Math.round((inner + gaps) * 100) / 100, slack: Math.round((allocated - inner - gaps) * 100) / 100 }
  })()
  clone.remove()
  return { ok: true, capW: w, gaps: gaps, firstSlack: firstSlack }
}
window.__PROBE_READY__ = true
`

const { build } = await import('esbuild')
const bundled = await build({
  stdin: { contents: ENTRY, resolveDir: resolve('.'), sourcefile: 'verify-capsule-layout-probe.js', loader: 'js' },
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', write: false, logLevel: 'error',
})
const probeJs = bundled.outputFiles[0].text
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#10131a;color:#e6edf3;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
:root{--dsh-chat-content-width:clamp(680px,calc(var(--dsh-conversation-column-width,0px) * .64),920px);
      --dsh-composer-card-max-width:calc(var(--dsh-chat-content-width) + 32px);
      --dsh-composer-side-clearance:16px;--dsh-composer-dock-inset:8px}
</style></head>
<body>
<script>window.__CLIENT_SRC__ = ${JSON.stringify(readFileSync(resolve(CLIENT), 'utf8'))};</script>
<script>window.__CWD__ = ${JSON.stringify(CWD)};window.__SNAP__ = ${JSON.stringify(SNAP)};window.__CHAIN_STEPS__ = ${JSON.stringify(CHAIN_STEPS)};</script>
<script>${probeJs}</script></body></html>`

const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html) })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = 'http://127.0.0.1:' + server.address().port + '/'
const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true })

const ratioOf = function (gaps) {
  const vals = gaps.map((g) => g.gap).filter((v) => v >= 0)
  if (vals.length < 2) return null
  const mx = Math.max.apply(null, vals), mn = Math.min.apply(null, vals)
  return { max: mx, min: mn, ratio: mn > 0 ? Math.round((mx / mn) * 1000) / 1000 : null }
}

try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 700 } })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + (e && e.message)))
  page.on('console', (m) => { if (m.type() === 'error' && m.text().indexOf('unique "key" prop') < 0) pageErrors.push('console: ' + m.text()) })
  await page.goto(origin, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__PROBE_READY__ === true, null, { timeout: 15000 })

  console.log('=== 状态栏胶囊布局：图标与文字成整体 · 各项间隔均匀（真 Chromium 量）===')
  console.log('')
  console.log('A) 真机几何下的四档：1600 / 900 / 600 / 380（相邻两项空隙、图标与文字间隙）')
  const WIDTHS = [1600, 900, 600, 380]
  const mounted = await page.evaluate((x) => window.__MOUNT__({ column: x }), WIDTHS[0])
  if (!mounted || !mounted.ok) bad('胶囊挂不起来：' + JSON.stringify(mounted) + ' / 页面错误 ' + JSON.stringify(pageErrors.slice(0, 3)))
  else {
    const seen = {}
    for (const w of WIDTHS) {
      await page.evaluate((x) => window.__SET_COLUMN__(x), w)
      const g = await page.evaluate(() => window.__GEOM__())
      seen[w] = g
      const r = ratioOf(g.gaps)
      console.log('     列宽 ' + w + ' → 胶囊 ' + g.capW + ' 像素，档 ' + g.tier + '，段数 ' + g.kids.length +
        '，图标↔文字 ' + JSON.stringify(g.iconToBrand) + '，相邻空隙 ' + JSON.stringify(g.gaps.map((x) => x.gap)) +
        '（最大/最小 = ' + (r && r.ratio !== null ? r.ratio : 'n/a') + '），最右到右内边 ' + g.edgeRight +
        '，word flex=' + JSON.stringify(g.wordFlex))
      if (g.error) { bad('列宽 ' + w + ' 没量到：' + JSON.stringify(g)); continue }

      // G1 图标↔自己的文字：固定小值，不随宽度变（只在品牌那串字看得见的那几档上判 ——
      //    它被收起来时（text 为空）这一段根本没有字，间隙无从谈起，那不是「被放大」）
      if (g.iconToBrand !== null) {
        check(g.iconToBrand >= ICON_TEXT_MIN && g.iconToBrand <= ICON_TEXT_MAX,
          'G1 列宽 ' + w + '：图标与「' + 'MattSkills' + '」之间的间隙落在 ' + ICON_TEXT_MIN + '–' + ICON_TEXT_MAX + ' 像素（实测 ' + g.iconToBrand + '）')
      } else {
        console.log('     （列宽 ' + w + '：品牌那串字此刻是收起的，图标↔文字这条这一档不判）')
      }

      // G2 各项之间：相邻空隙处处相等（余量由各项一起分，不是被某一个元素吃掉）
      check(!!r && r.ratio !== null && r.ratio <= EVEN_RATIO_MAX,
        'G2 列宽 ' + w + '：相邻两项的空隙处处相等（最大值÷最小值 ≤ ' + EVEN_RATIO_MAX + '；实测 ' + JSON.stringify(r) + '、空隙 ' + JSON.stringify(g.gaps.map((x) => x.gap)) + '）')

      // G3 单调：中心横坐标随次序严格递增
      let mono = true, at = null
      for (let i = 1; i < g.kids.length; i++) if (!(g.kids[i].c > g.kids[i - 1].c)) { mono = false; at = i }
      check(mono, 'G3 列宽 ' + w + '：各项中心随次序严格递增' + (mono ? '（实测 ' + JSON.stringify(g.kids.map((k) => k.c)) + '）' : '（第 ' + at + ' 项不递增）'))

      // G4 放得下：这一条横条不许因为「余量被谁吃掉」而溢出。窄到极限（可让的字都让完了、
  //    剩下的是图标与数字那点载荷）时，由外层 overflow 兜（verify-cap-fold-browser 那条「载荷装不下时
  //    按契约由外层 overflow 处理」）。这里把两档分开说清楚：让得完却不溢出，才算这条规矩没被破坏。
      const atBottom = g.kids.filter((k) => k.text === '').length >= 4
      check(g.overflow <= 1 || atBottom,
        'G4 列宽 ' + w + '：要么放得下、要么已经窄到只剩图标与数字（实测 scrollWidth-clientWidth = ' + g.overflow + '，空掉的段 ' + g.kids.filter((k) => k.text === '').length + '/' + g.kids.length + '）')

      // G2b 余量不许被某一个元素独占：那一段自己被分配到的宽，与它里面真正装着的东西的宽，
      //     几乎相等（差在像素取整）。上一版那枚 flex:1 1 auto 在宽条上把这一格撑到 230 像素、
      //     里面只装 79 像素的东西 —— 那 150 像素就是「按钮全挤到右边、中间一个大洞」的来源。
      //     只在品牌那串字看得见的那几档上判：它被收起来时里面根本没有字，那个差值没有意义
      //     （实测它会变成一个负数 —— 品牌那一段的孩子是行内元素，收起来时矩形是零）。
      if (g.iconToBrand !== null && g.word && g.word.slack) {
        check(g.word.slack.slack <= 2,
          'G2b 列宽 ' + w + '：品牌那一段不吃余量（分到的宽 ' + g.word.slack.allocated + ' - 里面真正宽 ' + g.word.slack.inner + ' = ' + g.word.slack.slack + '，容差 2 像素；flex=' + g.word.flex + '）')
      } else {
        console.log('     （列宽 ' + w + '：品牌那串字此刻是收起的，G2b 这一档不判）')
      }
    }

    // G1 的第二半：同一个值在每一档都不许变（容差 ±1px）——「不随视口放大」这句话的可执行版
    const brandVisible = WIDTHS.filter((w) => seen[w] && seen[w].iconToBrand !== null).map((w) => seen[w].iconToBrand)
    check(brandVisible.length >= 1 && (Math.max.apply(null, brandVisible) - Math.min.apply(null, brandVisible)) <= 1,
      'G1 图标与文字之间的间隙不随宽度变化（品牌看得见的那几档实测 ' + JSON.stringify(brandVisible) + '，极差 ' + (brandVisible.length ? Math.round((Math.max.apply(null, brandVisible) - Math.min.apply(null, brandVisible)) * 100) / 100 : 'n/a') + ' 像素，容差 1）')

    // G5 反向自检：把「某一个孩子独占余量」在克隆件上重演 —— G2b 那把尺子必须当场报红。
    //   为什么要重演这一件事、而不是重演「相邻空隙不相等」：真机实测过，某一个孩子吃掉余量时
    //   相邻空隙**照样是均匀的基础间隙**（克隆件上量出来仍是 [6,6,…]），拿空隙判它抓不住；
    //   抓得住的是「这一格比它里面装的东西宽出多少」。
    await page.evaluate((x) => window.__SET_COLUMN__(x), 1600)
    const clone = await page.evaluate(() => window.__CLONE_MONOPOLY__())
    check(!!clone && clone.ok && !!clone.firstSlack && clone.firstSlack.slack > 2,
      'G5 反证：让某一个元素独占余量（上一版 flex:1 1 auto 在宽条上的效果）时，G2b 那把尺子当场报红（实测 ' + JSON.stringify(clone && clone.firstSlack) + '）')

    const thrown = pageErrors.filter((e) => e.indexOf('pageerror:') === 0)
    check(thrown.length === 0, '整段扫描期间页面没有未捕获的报错（实测 ' + thrown.length + ' 条' + (thrown.length ? '：' + JSON.stringify(thrown.slice(0, 3)) : '') + '）')
  }
} finally {
  await browser.close()
  server.close()
}
console.log('')
console.log(passed + ' 条通过，' + failed + ' 条失败')
console.log(failed ? '=== FAIL：胶囊里图标与文字还不是一个整体、或各项间隔还不均匀 ===' : '=== OK：胶囊布局（图标与文字成整体 · 各项间隔均匀）===')
process.exit(failed ? 1 : 0)
