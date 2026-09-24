#!/usr/bin/env node
/**
 * verify-chain-view-ui.js — 「每个会话在处理哪些票」这一块的浏览器门禁
 * （2026-09-24 维护者改口径：展示面**暂时下线**，能力保留）
 *
 * 维护者的原话：「我的意思是 UI 上先不显示这个，但是能力层面还具备这个能力，未来会根据之前的
 * issuePath 找个地方进行显示。」所以这一条门禁量的是两件事，缺一不可：
 *
 *   一、**面板的列表页里没有这一块**（这次改动的正文）：在真 Chromium 里把真面板挂起来、落在列表页上，
 *       然后断言找不到那块标题、找不到任何会话行、也找不到「读不到处理记录」那句。
 *       为什么非要在真浏览器里量：断源码只能证明「某处不再挂着它」，证明不了「画出来的画面上真没有」——
 *       这一块从前就挂在面板正文最上面，它是不是真的下去了，只有把那一页画出来才看得见。
 *   二、**能力还在、尺子有牙齿**（反向自检）：同一份能力组件（判据与画法都在
 *       src/client/views/shared/sessionChainView.js）单独挂出来之后，同一把尺子必须找得到标题、
 *       找得到会话行、找得到那句「读不到处理记录」。抓不住就是假绿 —— 那说明上面那几条「找不到」
 *       是尺子失灵，而不是面板里真的没有。这一半同时是「能力保留」的证据：未来在别处挂回来时，
 *       它画的还是那一套。
 *
 * 一份快照只管一趟页面：面板装上一份快照之后，短时间内不会为同一处再取一次（新鲜度窗口），
 *   所以「两种读数各画一次」这件事要**各开一页**来做 —— 同一页里换一份数据再挂，画面上还是上一份
 *   （实测踩过这一脚：换过去的那一份根本没落地，X 那一节于是量的是旧画面）。
 *
 * 探针本身放在 tests/fixtures/chain-view-ui-probe.js（单独一份文件）：它要把真产物与那一份叶子都
 *   求值出来（与 scripts/build.mjs 同一套做法），写在模板字符串里层数太深、容易被转义绊住。
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

// 一行多高的容差（像素）：量「每多一条记录只多一行高」时用。
const STEP_TOL = 0.5

const CLIENT = 'package/lib/client.js'
const LEAF = 'src/client/views/shared/sessionChainView.js'
const PROBE = 'tests/fixtures/chain-view-ui-probe.js'
for (const rel of [CLIENT, LEAF, PROBE]) {
  if (!existsSync(resolve(rel))) {
    console.log((rel === CLIENT ? '产物缺失（' + CLIENT + '）：先跑 node scripts/build.mjs' : rel + ' 不存在'))
    process.exit(1)
  }
}

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

// 尺子要量的两句原话从真词条取（探针与门禁都不另抄一份文案）：块自己的标题、以及那句「读不到处理记录」。
const TEXT_TITLE = String(localeMod['chainView.title'] || '')
const TEXT_UNREADABLE = String(localeMod['chainView.unreadable'] || '')
if (!TEXT_TITLE || !TEXT_UNREADABLE) {
  console.log('词条缺失：chainView.title / chainView.unreadable 要从 src/client/kernel/locale-pages.js 的 zh 里读出来（实得 ' +
    JSON.stringify({ title: TEXT_TITLE, unreadable: TEXT_UNREADABLE }) + '）')
  process.exit(1)
}

const READ_AT = new Date(2026, 8, 24, 16, 50, 0).getTime()
// 与维护者截图同形的样本：两个会话，会话标识都用十六进制散列。
const SESSIONS = [
  { shardId: '307d37e6a1b2c3d4', backend: 'github', entries: [{ ticketKey: '951', action: 'edit', at: READ_AT - 600000 }, { ticketKey: '950', action: 'comment', at: READ_AT - 1200000 }] },
  { shardId: '1af66bb198765432', backend: 'github', entries: [{ ticketKey: '800', action: 'state', at: READ_AT - 300000 }, { ticketKey: '801', action: 'link', at: READ_AT - 400000 }, { ticketKey: '802', action: 'comment', at: READ_AT - 500000 }] },
]
// 一条会话记满 25 张：比版面上限（SESSION_CHAIN_ROW_CAP，20 条）多 5 条 —— 从前末尾会多画一行「还有几条没画」。
const MANY = []
for (let i = 0; i < 25; i++) MANY.push({ ticketKey: String(900 - i), action: (i % 2 ? 'comment' : 'edit'), at: READ_AT - (i + 1) * 60000 })
const CWD = 'D:\\ilife\\packages\\skill-calorie'
const BASE_SNAP = {
  ok: true, version: 'verify-chain-view-ui', generatedMs: READ_AT,
  workspaceRoot: 'd:/ilife', maps: [], checks: null, isLocal: false, tickets: [], groups: {},
  repository: { name: 'FeatherHunter/dsh-mattpocock-skills-deck', url: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck', backend: 'github' },
  selection: { backendId: 'github', source: 'explicit' },
  issues: [{ number: 951, title: '甲票标题', effortId: '' }, { number: 800, title: '乙票标题', effortId: '' }, { number: 900, title: '丙票标题', effortId: '' }],
}
// 三份输入各是「从前画得出来」的一份：正常读数、超过行数上限、宿主说这次读坏了。
const SNAP_WITH_DATA = Object.assign({}, BASE_SNAP, { sessionTickets: { ok: true, at: READ_AT, sessions: SESSIONS } })
const SNAP_OVER_CAP = Object.assign({}, BASE_SNAP, { version: 'verify-chain-view-ui-overcap', sessionTickets: { ok: true, at: READ_AT, sessions: [{ shardId: '307d37e6a1b2c3d4', backend: 'github', entries: MANY }] } })
const SNAP_BROKEN = Object.assign({}, BASE_SNAP, { version: 'verify-chain-view-ui-broken', sessionTickets: { ok: false, at: READ_AT, reason: 'host.chain.read-failed', sessions: [] } })

const { build } = await import('esbuild')
const bundled = await build({
  stdin: { contents: readFileSync(resolve(PROBE), 'utf8'), resolveDir: resolve('.'), sourcefile: 'chain-view-ui-probe.js', loader: 'js' },
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', write: false, logLevel: 'error',
})
const probeJs = bundled.outputFiles[0].text
const pageHtml = function (snap) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#10131a;color:#e6edf3;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
#pane{width:460px;height:900px;display:flex;flex-direction:column}
</style></head>
<body><div id="pane"></div>
<script>window.__CLIENT_SRC__ = ${JSON.stringify(readFileSync(resolve(CLIENT), 'utf8'))};</script>
<script>window.__CWD__ = ${JSON.stringify(CWD)};window.__SNAP__ = ${JSON.stringify(snap)};window.__READ_AT__ = ${JSON.stringify(READ_AT)};</script>
<script>window.__LEAF_SRC__ = ${JSON.stringify(readFileSync(resolve(LEAF), 'utf8'))};window.__DICT_ZH__ = ${JSON.stringify(localeMod)};window.__TEXTS__ = ${JSON.stringify({ title: TEXT_TITLE, unreadable: TEXT_UNREADABLE })};</script>
<script>${probeJs}</script></body></html>`
}
const ROUTE_SNAP = { '/': SNAP_WITH_DATA, '/overcap': SNAP_OVER_CAP, '/broken': SNAP_BROKEN }
const server = createServer((req, res) => {
  const path = String(req.url || '/').split('?')[0]
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(pageHtml(ROUTE_SNAP[path] || SNAP_WITH_DATA))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = 'http://127.0.0.1:' + server.address().port
const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true })

const pageErrors = []
/** 开一页（一份快照一页：见文件头那段「一份快照只管一趟页面」）。 */
async function openPage(route) {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
  page.on('pageerror', (e) => pageErrors.push(route + ' pageerror: ' + (e && e.message)))
  page.on('console', (m) => { if (m.type() === 'error' && m.text().indexOf('unique "key" prop') < 0) pageErrors.push(route + ' console: ' + m.text()) })
  await page.goto(origin + route, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__PROBE_READY__ === true, null, { timeout: 15000 })
  return page
}

console.log('=== 「每个会话在处理哪些票」（列表页里没有这一块 · 能力保留）===')
console.log('')
try {
  const wantRows = SESSIONS.reduce(function (a, s) { return a + s.entries.length }, 0)
  const page = await openPage('/')

  console.log('W) 面板的列表页里没有这一块（这份输入从前正是画得出来的那一份：' + wantRows + ' 条记录）')
  const mounted = await page.evaluate((p) => window.__PANEL_MOUNT__(p), SNAP_WITH_DATA)
  if (!mounted || !mounted.ok) bad('W0 真面板没挂起来：' + JSON.stringify(mounted) + ' / 页面错误 ' + JSON.stringify(pageErrors.slice(0, 3)))
  else {
    const w = await page.evaluate(() => window.__PANEL_SCAN__())
    console.log('     面板上看得见的字（前 240 字）：' + JSON.stringify(w.text))
    check(w.panelBodies > 0, 'W1 面板真的画到了列表页那一层（正文容器 .dsws-body 在，实测 ' + w.panelBodies + ' 个）')
    // 这一条是防假绿的：面板空着的时候「找不到那一块」也成立 —— 所以先证明列表页自己的东西画出来了。
    check(w.listChips > 0, 'W2 列表页自己的内容在（过滤那一排 .dsws-chip 实测 ' + w.listChips + ' 个），不是空壳')
    check(w.titleFound === false, 'W3 找不到那一块的标题（' + JSON.stringify(TEXT_TITLE) + '）')
    check(w.sessionMarks === 0, 'W4 找不到任何会话行（[data-session] 实测 ' + w.sessionMarks + ' 条）')
    check(w.chainRows === 0, 'W5 找不到记录行（.dsws-chainview-row 实测 ' + w.chainRows + ' 条）')
    check(w.chainBlock === 0, 'W6 找不到那一块的外壳（.dsws-chainview 实测 ' + w.chainBlock + ' 个）')
  }

  console.log('')
  console.log('W2) 条数超过版面上限那一份：末尾那句「还有几条没画」也不许再出现在面板里')
  const pageOverCap = await openPage('/overcap')
  const mountedCap = await pageOverCap.evaluate((p) => window.__PANEL_MOUNT__(p), SNAP_OVER_CAP)
  if (!mountedCap || !mountedCap.ok) bad('W9 超上限那一趟面板没挂起来：' + JSON.stringify(mountedCap))
  else {
    const wc = await pageOverCap.evaluate(() => window.__PANEL_SCAN__())
    check(wc.panelBodies > 0 && wc.listChips > 0, 'W9 超上限那一趟面板也画到了列表页那一层（.dsws-body ' + wc.panelBodies + ' 个、.dsws-chip ' + wc.listChips + ' 个）')
    check(wc.rowCapNotice === 0, 'W10 找不到行数封顶那一行（[data-chain-rest] 实测 ' + wc.rowCapNotice + ' 条）')
    check(wc.chainBlock === 0 && wc.sessionMarks === 0, 'W11 超上限那一趟同样没有那一块（.dsws-chainview ' + wc.chainBlock + ' 个、[data-session] ' + wc.sessionMarks + ' 条）')
  }

  console.log('')
  console.log('X) 宿主说这次读坏了时，那句也不许出现在面板里')
  const pageBroken = await openPage('/broken')
  const broken = await pageBroken.evaluate((p) => window.__PANEL_MOUNT__(p), SNAP_BROKEN)
  if (!broken || !broken.ok) bad('X0 坏读数那一趟面板没挂起来：' + JSON.stringify(broken))
  else {
    const x = await pageBroken.evaluate(() => window.__PANEL_SCAN__())
    check(x.panelBodies > 0, 'X1 坏读数那一趟面板也画到了列表页那一层（.dsws-body 实测 ' + x.panelBodies + ' 个）')
    check(x.unreadableFound === false, 'X2 面板里找不到「读不到处理记录」那句（' + JSON.stringify(TEXT_UNREADABLE) + '；随展示面一起下线，不再冒出来）')
    check(x.chainBlock === 0 && x.sessionMarks === 0, 'X3 坏读数下同样没有那一块（.dsws-chainview ' + x.chainBlock + ' 个、[data-session] ' + x.sessionMarks + ' 条）')
  }

  console.log('')
  console.log('R) 反向自检：能力本体单独挂出来时，同一把尺子必须抓得住（抓不住就是假绿）')
  const rMounted = await page.evaluate((p) => window.__STRIP_MOUNT__(p), SNAP_WITH_DATA)
  if (!rMounted || !rMounted.ok) bad('R0 能力本体没挂起来：' + JSON.stringify(rMounted))
  else {
    const r = await page.evaluate(() => window.__STRIP_SCAN__())
    check(r.chainBlock === 1, 'R1 能力本体把那一块真画出来了（.dsws-chainview 实测 ' + r.chainBlock + ' 个）')
    check(r.titleFound === true, 'R2 同一把尺子在这块上找得到标题（' + JSON.stringify(TEXT_TITLE) + '）')
    check(r.sessionMarks === wantRows && r.chainRows === wantRows, 'R3 同一把尺子找得到每条记录的会话行（' + wantRows + ' 条，实测 [data-session] ' + r.sessionMarks + ' 条 / 记录行 ' + r.chainRows + ' 行）')
  }
  const rBroken = await page.evaluate((p) => window.__STRIP_MOUNT__(p), SNAP_BROKEN)
  if (!rBroken || !rBroken.ok) bad('R4 能力本体的坏读数那一趟没挂起来：' + JSON.stringify(rBroken))
  else {
    const rb = await page.evaluate(() => window.__STRIP_SCAN__())
    check(rb.unreadableFound === true, 'R4 坏读数时同一把尺子找得到「读不到处理记录」（' + JSON.stringify(TEXT_UNREADABLE) + '）：这句话量得出来，上面那几条「找不到」才有意义')
    check(rb.chainRows === 0 && rb.sessionMarks === 0, 'R5 坏读数时能力本体也不画会话行（[data-session] 实测 ' + rb.sessionMarks + ' 条）')
  }
  // 一行一条、每多一条只多一行高：这条从前量的是面板，现在量能力本体（面板里已经没有它了）。
  const heights = []
  for (const n of [1, 2, 3]) {
    const payload = await page.evaluate((k) => window.__STRIP_SNAP_WITH__(k), n)
    const m = await page.evaluate((p) => window.__STRIP_MOUNT__(p), payload)
    if (!m || !m.ok) { bad('R6 ' + n + ' 条时能力本体没挂起来：' + JSON.stringify(m)); continue }
    const g = await page.evaluate(() => { const el = document.querySelector('#dsws-probe-strip .dsws-chainview'); return el ? { h: Math.round(el.getBoundingClientRect().height * 100) / 100, rows: el.querySelectorAll('.dsws-chainview-row').length } : null })
    heights.push({ n: n, h: g ? g.h : 0, rows: g ? g.rows : 0 })
    console.log('     ' + n + ' 条 → 块高 ' + (g ? g.h : 'n/a') + ' 像素、记录行 ' + (g ? g.rows : 'n/a') + ' 行')
  }
  const step = heights.length >= 2 ? Math.round((heights[1].h - heights[0].h) * 100) / 100 : 0
  check(heights.length === 3 && heights[0].rows === 1 && heights[2].rows === 3 && step > 0 &&
    Math.abs((heights[2].h - heights[0].h) - step * 2) <= STEP_TOL * 2,
    'R6 一行一条记录、每多一条只多一行高（实测块高 ' + JSON.stringify(heights.map(function (x) { return x.h })) + ' 像素、每跳一行高 ' + step + ' 像素）')
  const atCap = await page.evaluate((k) => window.__STRIP_SNAP_WITH__(k), 25)
  const capMounted = await page.evaluate((p) => window.__STRIP_MOUNT__(p), atCap)
  if (!capMounted || !capMounted.ok) bad('R7 超过行数上限那一趟没挂起来：' + JSON.stringify(capMounted))
  else {
    const rc = await page.evaluate(() => window.__STRIP_SCAN__())
    check(rc.rowCapNotice === 1, 'R7 条数超过上限时能力本体画得出末尾那句「还有几条没画」（[data-chain-rest] 实测 ' + rc.rowCapNotice + ' 条）')
  }

  const thrown = pageErrors.filter((e) => e.indexOf('pageerror:') >= 0)
  check(thrown.length === 0, '整段扫描期间三页都没有未捕获的报错（实测 ' + thrown.length + ' 条' + (thrown.length ? '：' + JSON.stringify(thrown.slice(0, 3)) : '') + '）')
} finally {
  await browser.close()
  server.close()
}
console.log('')
console.log(passed + ' 条通过，' + failed + ' 条失败')
console.log(failed ? '=== FAIL：展示面还在面板里，或者能力被拆掉了 ===' : '=== OK：面板的列表页里没有这一块，能力本体仍画得出来 ===')
process.exit(failed ? 1 : 0)
