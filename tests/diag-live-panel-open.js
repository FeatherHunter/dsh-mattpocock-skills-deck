// tests/diag-live-panel-open.js
//
// 用途（一次性诊断，不是门禁）：在你的真机上量「点击 MattSkills → 右侧面板内容出现」的时间线与主线程占用。
//
// 需要 DSH 启动时打印的带令牌网址（那个地址等于这个界面的钥匙，只在本机本次启动内有效）：
//   $env:DSH_AUTH_URL='http://127.0.0.1:3080/?token=...'
//   node tests/diag-live-panel-open.js
//
// 量四件事：
//   ① 点击之后主线程有没有被占住（浏览器自己的长任务记录，>50ms 的任务）
//   ② 点击到面板内容出现，实际隔了多久（按 DOM 增长曲线，逐帧采样）
//   ③ 面板内容出现之后，还在等什么（内容长齐用了多久）
//   ④ 这段时间前端调了宿主哪些接口、各自多久（宿主侧真身从插件自己的日志里读）

const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')

const AUTH_URL = process.env.DSH_AUTH_URL
if (!AUTH_URL) { console.error('缺少 DSH_AUTH_URL'); process.exit(1) }

const LOG_DIR = path.join(process.env.USERPROFILE || '', '.dsh-mattskillsdeck-cache', 'logs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function logSizes() {
  try { const o = {}; for (const f of fs.readdirSync(LOG_DIR)) o[f] = fs.statSync(path.join(LOG_DIR, f)).size; return o } catch (e) { return {} }
}
function readNewLog(before) {
  const out = []
  try {
    for (const f of fs.readdirSync(LOG_DIR)) {
      const p = path.join(LOG_DIR, f)
      const size = fs.statSync(p).size
      const from = before[f] || 0
      if (size <= from) continue
      const fd = fs.openSync(p, 'r')
      const buf = Buffer.alloc(size - from)
      fs.readSync(fd, buf, 0, buf.length, from)
      fs.closeSync(fd)
      for (const line of buf.toString('utf8').split('\n')) if (line.trim()) out.push(line)
    }
  } catch (e) {}
  return out
}

;(async () => {
  const before = logSizes()
  console.log('=== 真机测量：点击 MattSkills 打开右侧面板 ===\n')

  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1000 } })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    window.__LT = []
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__LT.push({ s: Math.round(e.startTime), d: Math.round(e.duration) }) }).observe({ entryTypes: ['longtask'] }) } catch (e) {}
  })

  await page.goto(AUTH_URL, { waitUntil: 'domcontentloaded', timeout: 40000 })
  for (let i = 0; i < 40; i++) { if (await page.evaluate(() => /MattSkills/.test(document.body?.innerText || ''))) break; await sleep(1000) }
  await sleep(5000)
  console.log('  插件已挂载\n')

  // 入口：状态栏胶囊里的 MattSkills 文字
  const entry = await page.evaluate(() => {
    const el = document.querySelector('.dsws-capsule-word')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width) }
  })
  console.log('  入口: ' + JSON.stringify(entry))
  if (!entry) { console.log('  找不到状态栏入口'); await browser.close(); process.exit(3) }

  const snapshotDsws = () => page.evaluate(() => document.querySelectorAll('[class*=dsws-]').length)

  // ---- 打开一次，逐帧采样 DOM 增长 ----
  await page.evaluate(() => { window.__LT = [] })
  const baseCount = await snapshotDsws()
  const tClick = Date.now()
  await page.mouse.click(entry.x, entry.y)

  const curve = []
  let firstPaintMs = null
  let prev = baseCount
  for (let k = 0; k < 600; k++) {
    const n = await snapshotDsws()
    const t = Date.now() - tClick
    if (n !== prev) { curve.push({ ms: t, nodes: n }); prev = n }
    if (firstPaintMs === null && n >= baseCount + 30) firstPaintMs = t
    if (t > 32000) break
    await sleep(50)
  }
  const lt = await page.evaluate(() => window.__LT || [])

  console.log('\n=== ① 点击后 DOM 增长曲线（只在数量变化时记一笔）===')
  console.log('  点击前 dsws 元素数: ' + baseCount)
  for (const c of curve.slice(0, 18)) console.log('    +' + String(c.ms).padStart(6) + ' ms   元素数 ' + c.nodes)
  const last = curve[curve.length - 1]
  console.log('  ' + (curve.length > 18 ? '（省略 ' + (curve.length - 18) + ' 笔）' : ''))
  console.log('  内容开始出现: ' + (firstPaintMs === null ? '未检出' : firstPaintMs + ' ms'))
  console.log('  内容长齐: ' + (last ? last.ms + ' ms（元素数 ' + last.nodes + '）' : '未检出'))

  console.log('\n=== ② 主线程占用（浏览器自己的长任务记录，>50ms 才算）===')
  const ltTotal = lt.reduce((a, b) => a + b.d, 0)
  console.log('  长任务 ' + lt.length + ' 个   合计 ' + ltTotal + ' ms')
  if (lt.length) console.log('  明细(耗时 ms @点击后第几秒): ' + lt.slice(0, 20).map((t) => t.d + '@' + ((t.s) / 1000).toFixed(1)).join('  '))

  await browser.close()

  console.log('\n=== ③ 这段时间前端调了宿主哪些接口（真身，读插件日志）===')
  const lines = readNewLog(before)
  const byMethod = {}
  for (const line of lines) {
    try {
      const o = JSON.parse(line)
      if (o.event !== 'host.call' && o.event !== 'host.call.fail') continue
      const m = (o.fields && o.fields.method) || '?'
      const ms = (o.fields && o.fields.latencyMs) || 0
      if (!byMethod[m]) byMethod[m] = { n: 0, sum: 0, max: 0 }
      byMethod[m].n++; byMethod[m].sum += ms; byMethod[m].max = Math.max(byMethod[m].max, ms)
    } catch (e) {}
  }
  for (const [m, v] of Object.entries(byMethod).sort((a, b) => b[1].sum - a[1].sum)) {
    console.log('  ' + m.padEnd(18) + ' 次数 ' + String(v.n).padStart(3) + '   合计 ' + String(v.sum).padStart(7) + ' ms   单次最长 ' + String(v.max).padStart(6) + ' ms')
  }

  console.log('\n=== ④ 真正的网络与进程成本（gh.exec 单次 >3 秒的）===')
  let ghN = 0, ghSum = 0, ghMax = 0
  const slow = []
  for (const line of lines) {
    try {
      const o = JSON.parse(line)
      if (o.event !== 'gh.exec') continue
      ghN++; const ms = o.fields.latencyMs || 0; ghSum += ms; ghMax = Math.max(ghMax, ms)
      if (ms >= 3000) slow.push(ms + 'ms(cwd=' + o.fields.cwdHash + ')')
    } catch (e) {}
  }
  console.log('  gh.exec 共 ' + ghN + ' 次   合计 ' + ghSum + ' ms   单次最长 ' + ghMax + ' ms')
  console.log('  超过 3 秒的: ' + (slow.length ? slow.join('  ') : '无'))
})().catch((e) => { console.error('fatal: ' + e.message); process.exit(1) })
