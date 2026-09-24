#!/usr/bin/env node
/**
 * verify-chain-view-ui.js — 「每个会话在处理哪些票」这一块的真浏览器门禁（2026-09-24 晚重做，维护者反馈）
 *
 * 维护者原话：「不应该这样呈现，这样UI非常丑陋」。他截的图逐字长这样：
 *
 *     每个会话在处理哪些票 · 宿主读数 16:50
 *     会话 307d37e6
 *     #951 · 改内容 · 16:40
 *     会话 1af66bb1
 *     #950 · 评论 · 16:32
 *
 * 按那四条重做之后，这一份在真 Chromium 里量这四条（判据与画法在 views/shared/sessionChainView.js；
 *   纯判据那一半由 tests/verify-chain-view.js 逐格钉住，两份合起来才算把这一段钉牢）：
 *
 *   U1 **块高随条数线性、且有上限**：记录从 1 条加到 6 条，每一跳都只多一行高；
 *      超过上限（SESSION_CHAIN_ROW_CAP，上限值从真源里读）之后块高不再长，末尾如实说明还有几条没画。
 *   U2 **版面上不出现 8 位十六进制散列**：那一串对人不可行动（认不出是哪个会话），它只能进悬停提示。
 *   U3 **版面上不出现内部行话**（「宿主读数」这一类）：换成一句人话，时间含义不变。
 *   U4 **一行一条记录**：记录行数等于记录条数，且每行高度一样（不整块、不换行）。
 *   U5 反向自检：往克隆件的一行文字里塞回一个 8 位散列 → U2 那把尺子必须当场报红；
 *      塞回「宿主读数」→ U3 必须报红（抓不住就是假绿；克隆件上做，真节点一个字不碰）。
 *
 * 为什么这一份要真起浏览器：块高、一行多高、版面上到底画了哪些字，都是**画出来之后**的事实；
 *   断源码只证明「某处写着一个数字」，证明不了它真的落在版面上。
 * 探针本身放在 tests/fixtures/chain-view-ui-probe.js（单独一份文件）：它要把叶子模块求值出来
 *   （与 scripts/build.mjs 同一套做法），写在模板字符串里层数太深、容易被转义绊住。
 *
 * 依赖：playwright（含 chromium）与 esbuild，都在本仓 devDependencies。全程本机，不碰真仓库、不用登录令牌。
 * 运行：node tests/verify-chain-view-ui.js（先 node scripts/build.mjs 生成产物）
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'

let passed = 0, failed = 0
function ok(msg) { passed++; console.log('  PASS ' + msg) }
function bad(msg) { failed++; console.log('  FAIL ' + msg) }
function check(cond, msg) { if (cond) ok(msg); else bad(msg) }

// 人工定的阈值（写进断言、也写进报告）：块高与「若干行 × 一行高」的偏差容差 0.5 像素（取整）。
const STEP_TOL = 0.5
const HEX8 = /(?:^|[^0-9a-f])([0-9a-f]{8})(?![0-9a-f])/i
const JARGON = ['宿主读数', '宿主', '读数', '分格', '散列']

const CLIENT = 'package/lib/client.js'
const LEAF = 'src/client/views/shared/sessionChainView.js'
const PROBE = 'tests/fixtures/chain-view-ui-probe.js'
for (const rel of [CLIENT, LEAF, PROBE]) {
  if (!existsSync(resolve(rel))) {
    console.log((rel === CLIENT ? '产物缺失（' + CLIENT + '）：先跑 node scripts/build.mjs' : rel + ' 不存在'))
    process.exit(1)
  }
}
// 行数上限从真源里读（不在这里另抄一份数字）：门禁量到的就是界面画的那一份。
//   读不到时不提前退出：这一条本身就判红（说明那个常量没了），后面的每一条照旧量到底 ——
//   修前跑这一份时要能看到「平台面/封顶」这些断言各自的实况，而不是一行「读不到」就收工。
const VIEW_SRC = readFileSync(resolve(LEAF), 'utf8')
const CAP_FROM_SRC = Number((/SESSION_CHAIN_ROW_CAP\s*=\s*(\d+)/.exec(VIEW_SRC) || [])[1] || 0)
const ROW_CAP = CAP_FROM_SRC || 20

// 这一页只装中文那一半词条：界面画的每一个字都来自词条，门禁量的是真词条（不是词条键）。
//   取法：在这些片段里找第二层那个「zh」块（第一层是给中英各一份的容器），按大括号配对取出整块再求值。
const localeMod = (function () {
  const files = ['src/client/kernel/locale-pages.js', 'src/client/kernel/locale-word.js', 'src/client/kernel/locale-flow.js']
  const dict = {}
  const grabZhBlock = function (src) {
    const at = src.indexOf('zh: {')
    if (at < 0) return null
    let depth = 0
    for (let i = at + 'zh: '.length; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at + 'zh: '.length, i + 1) }
    }
    return null
  }
  for (const rel of files) {
    const block = grabZhBlock(readFileSync(resolve(rel), 'utf8'))
    if (!block) continue
    try { Object.assign(dict, new Function('return (' + block + ')')()) } catch (e) { /* 读不出来就跳过：缺的词条会在版面上显示成键名，门禁会红 */ }
  }
  return dict
})()

const READ_AT = new Date(2026, 8, 24, 16, 50, 0).getTime()
// 与维护者截图同形的样本：两个会话，会话标识都用十六进制散列。
const SESSIONS = [
  { shardId: '307d37e6a1b2c3d4', backend: 'github', entries: [{ ticketKey: '951', action: 'edit', at: READ_AT - 600000 }, { ticketKey: '950', action: 'comment', at: READ_AT - 1200000 }] },
  { shardId: '1af66bb198765432', backend: 'github', entries: [{ ticketKey: '800', action: 'state', at: READ_AT - 300000 }, { ticketKey: '801', action: 'link', at: READ_AT - 400000 }, { ticketKey: '802', action: 'comment', at: READ_AT - 500000 }] },
]
const CWD = 'D:\\ilife\\packages\\skill-calorie'
const SNAP = {
  ok: true, version: 'verify-chain-view-ui', generatedMs: READ_AT,
  workspaceRoot: 'd:/ilife', maps: [], checks: null, isLocal: false, tickets: [], groups: {},
  repository: { name: 'FeatherHunter/dsh-mattpocock-skills-deck', url: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck', backend: 'github' },
  selection: { backendId: 'github', source: 'explicit' },
  issues: [{ number: 951, title: '甲票标题', effortId: '' }, { number: 800, title: '乙票标题', effortId: '' }],
  sessionTickets: { ok: true, at: READ_AT, sessions: SESSIONS },
}

const { build } = await import('esbuild')
const bundled = await build({
  stdin: { contents: readFileSync(resolve(PROBE), 'utf8'), resolveDir: resolve('.'), sourcefile: 'chain-view-ui-probe.js', loader: 'js' },
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', write: false, logLevel: 'error',
})
const probeJs = bundled.outputFiles[0].text
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#10131a;color:#e6edf3;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
#pane{width:460px;height:900px;display:flex;flex-direction:column}
</style></head>
<body><div id="pane"></div>
<script>window.__CLIENT_SRC__ = ${JSON.stringify(readFileSync(resolve(CLIENT), 'utf8'))};</script>
<script>window.__CWD__ = ${JSON.stringify(CWD)};window.__SNAP__ = ${JSON.stringify(SNAP)};window.__READ_AT__ = ${JSON.stringify(READ_AT)};window.__LEAF_SRC__ = ${JSON.stringify(VIEW_SRC)};window.__DICT_ZH__ = ${JSON.stringify(localeMod)};</script>
<script>${probeJs}</script></body></html>`

const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html) })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = 'http://127.0.0.1:' + server.address().port + '/'
const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true })

console.log('=== 「每个会话在处理哪些票」这一块的呈现（真 Chromium 量）===')
console.log('')
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + (e && e.message)))
  page.on('console', (m) => { if (m.type() === 'error' && m.text().indexOf('unique "key" prop') < 0) pageErrors.push('console: ' + m.text()) })
  await page.goto(origin, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__PROBE_READY__ === true, null, { timeout: 15000 })

  console.log('U1) 块高随条数线性、且有上限（上限 ' + ROW_CAP + ' 条，取自真源）')
  check(CAP_FROM_SRC > 0, 'U1 真源里带着行数上限那个常量（SESSION_CHAIN_ROW_CAP；实测 ' + CAP_FROM_SRC + '）')
  const heights = []
  // 先挂一次（这一次让 React 把挂载点建起来），再逐档换数据重画 —— 所以第一档要挂在循环里量。
  await page.evaluate((p) => window.__MOUNT__(p), SNAP)
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const payload = await page.evaluate((k) => window.__SNAP_WITH__(k), n)
    const m = await page.evaluate((p) => window.__MOUNT__(p), payload)
    if (!m || !m.ok) { bad('U1 ' + n + ' 条时没挂起来：' + JSON.stringify(m)); continue }
    const g = await page.evaluate(() => window.__GEOM__())
    heights.push({ n: n, h: g.blockH, rows: g.rowCount })
    console.log('     ' + n + ' 条 → 块高 ' + g.blockH + ' 像素、记录行 ' + g.rowCount + ' 行')
  }
  const diffs = []
  for (let i = 1; i < heights.length; i++) diffs.push(Math.round((heights[i].h - heights[i - 1].h) * 100) / 100)
  const step = heights.length >= 2 ? Math.round((heights[1].h - heights[0].h) * 100) / 100 : 0
  check(heights.length === 6 && heights[0].rows === 1 && heights[5].rows === 6 && step > 0 &&
    diffs.every(function (d) { return Math.abs(d - step) <= STEP_TOL }),
    'U1 每多一条记录就只多一行高（线性）：实测每一跳 ' + JSON.stringify(diffs) + '（一行高 ' + step + ' 像素），块高 ' + JSON.stringify(heights.map(function (x) { return x.h })) + '）')
  // 上限：条数超过上限之后，记录行数、块高都不再长，末尾如实说明还有几条没画
  const bigPayload = await page.evaluate((k) => window.__SNAP_WITH__(k), ROW_CAP + 5)
  const bigMounted = await page.evaluate((p) => window.__MOUNT__(p), bigPayload)
  if (!bigMounted || !bigMounted.ok) bad('U1 超上限那一趟没挂起来：' + JSON.stringify(bigMounted))
  else {
    const bigG = await page.evaluate(() => window.__GEOM__())
    const bigRest = await page.evaluate(() => { const el = document.querySelector('[data-chain-rest]'); return el ? String(el.textContent || '').trim() : null })
    const atCapPayload = await page.evaluate((k) => window.__SNAP_WITH__(k), ROW_CAP)
    await page.evaluate((p) => window.__MOUNT__(p), atCapPayload)
    const capG = await page.evaluate(() => window.__GEOM__())
    console.log('     超上限（' + (ROW_CAP + 5) + ' 条）→ 块高 ' + bigG.blockH + ' 像素、记录行 ' + bigG.rowCount + ' 行、末尾说明 ' + JSON.stringify(bigRest))
    check(bigG.rowCount === ROW_CAP, 'U1 记录行数封顶在上限 ' + ROW_CAP + '（实测 ' + bigG.rowCount + ' 行）')
    // 超过上限之后块高**不再随条数涨**：相对「正好到上限那一档」只多出末尾那一行的说明
    //   （那一行是「还有 N 条没有列出」，它本身是一条信息、不是第 21 条记录）。
    check(bigG.blockH - capG.blockH === 18,
      'U1 超过上限之后块高不再随条数长（实测 ' + bigG.blockH + ' 像素 = 上限那一档 ' + capG.blockH + ' + 末尾说明那一行 18）')
    check(!!bigRest && bigRest.indexOf(String(5)) >= 0, 'U1 末尾如实说明还有几条没画（实测 ' + JSON.stringify(bigRest) + '）')
  }

  console.log('')
  console.log('U2/U3/U4) 版面上画了什么：散列与内部行话都不许出现、一行一条')
  const wantRows = SESSIONS.reduce(function (a, s) { return a + s.entries.length }, 0)
  const mounted = await page.evaluate((p) => window.__MOUNT__(p), SNAP)
  if (!mounted || !mounted.ok) bad('主样本没挂起来：' + JSON.stringify(mounted) + ' / 页面错误 ' + JSON.stringify(pageErrors.slice(0, 3)))
  else {
    const vis = await page.evaluate(() => window.__VISIBLE__())
    console.log('     版面上看得见的字：' + JSON.stringify(vis.text).slice(0, 240))
    const hexHits = vis.lines.filter(function (t) { return HEX8.test(t) })
    check(hexHits.length === 0, 'U2 版面上没有 8 位十六进制散列（实测命中 ' + JSON.stringify(hexHits) + '；版面上那几行：' + JSON.stringify(vis.lines.slice(0, 3)) + '）')
    const jargonHits = JARGON.filter(function (w) { return vis.text.indexOf(w) >= 0 })
    check(jargonHits.length === 0, 'U3 版面上没有内部行话（实测命中 ' + JSON.stringify(jargonHits) + '；说明那一行 ' + JSON.stringify(vis.lines[0]) + '）')
    check(vis.rowCount === wantRows && vis.rowCount === vis.rowTexts.length,
      'U4 一行一条记录（样本 ' + wantRows + ' 条记录，实测记录行 ' + vis.rowCount + ' 行、有字的行 ' + vis.rowTexts.length + ' 行）')
    const hs = vis.rowHeights
    check(hs.length > 1 && Math.max.apply(null, hs) - Math.min.apply(null, hs) <= STEP_TOL, 'U4 每一行高度一样（实测各行高 ' + JSON.stringify(hs) + '）')
    const tipHits = vis.tips.filter(function (t) { return HEX8.test(t) })
    check(tipHits.length === wantRows, 'U2 完整标识在悬停提示里（' + wantRows + ' 条记录各一份；实测 ' + tipHits.length + ' 条提示带着散列）')
    console.log('     （悬停提示首条：' + JSON.stringify(vis.tips[0] || '').slice(0, 110) + '）')
  }

  console.log('')
  console.log('U5) 反向自检：把散列与内部行话塞回版面，U2/U3 必须当场报红')
  const rev = await page.evaluate(() => window.__REVERSE__())
  check(!!rev && rev.ok === true, 'U5 反证件造出来了：' + JSON.stringify(rev && { hex: rev.hex, jargon: rev.jargon }))
  if (rev && rev.ok) {
    check(HEX8.test(rev.afterHex), 'U5 塞回一个 8 位十六进制散列之后，U2 那把尺子当场报红（实测那一行：' + JSON.stringify(String(rev.afterHex).slice(0, 60)) + '）')
    check(JARGON.some(function (w) { return String(rev.afterJargon).indexOf(w) >= 0 }), 'U5 塞回「宿主读数」之后，U3 那把尺子当场报红（实测那一行：' + JSON.stringify(String(rev.afterJargon).slice(0, 60)) + '）')
  }
  const thrown = pageErrors.filter((e) => e.indexOf('pageerror:') === 0)
  check(thrown.length === 0, '整段扫描期间页面没有未捕获的报错（实测 ' + thrown.length + ' 条' + (thrown.length ? '：' + JSON.stringify(thrown.slice(0, 3)) : '') + '）')
} finally {
  await browser.close()
  server.close()
}
console.log('')
console.log(passed + ' 条通过，' + failed + ' 条失败')
console.log(failed ? '=== FAIL：这一块的呈现还不符合那四条 ===' : '=== OK：「每个会话在处理哪些票」的呈现（线性块高 · 无散列 · 无内部行话 · 一行一条）===')
process.exit(failed ? 1 : 0)
