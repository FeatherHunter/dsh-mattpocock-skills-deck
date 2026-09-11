// tests/diag-live-workspace-cost.js
//
// 用途（一次性诊断，不是门禁）：在真机上按「某个具体工作区」量面板数据这条通话的成本，
//   并判定宿主是「手上有货能直接给」还是「必须先去拿」。
//
// 为什么必须指定工作区：不指定时落在 DSH 的启动目录（可能是个空工作区，秒回），
//   量出来的数字没有意义。用户实际卡的是某个具体项目，必须按那个目录问。
//
// 需要 DSH 启动时打印的带令牌网址：
//   $env:DSH_AUTH_URL='http://127.0.0.1:3080/?token=...'
//   node tests/diag-live-workspace-cost.js "D:\path\to\workspace" [次数]
//
// 只读：只请求快照与探测，不写任何数据。

const { chromium } = require('playwright')

const AUTH_URL = process.env.DSH_AUTH_URL
if (!AUTH_URL) { console.error('缺少 DSH_AUTH_URL'); process.exit(1) }
const CWD = process.argv[2]
if (!CWD) { console.error('用法: node tests/diag-live-workspace-cost.js "<工作区绝对路径>" [次数]'); process.exit(1) }
const ROUNDS = Number(process.argv[3] || 4)
const GAP_MS = Number(process.env.GAP_MS || 2000)

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1000 } })
  const page = await ctx.newPage()
  await page.goto(AUTH_URL, { waitUntil: 'domcontentloaded', timeout: 40000 })
  for (let i = 0; i < 40; i++) { if (await page.evaluate(() => /MattSkills/.test(document.body?.innerText || ''))) break; await new Promise((r) => setTimeout(r, 1000)) }
  await new Promise((r) => setTimeout(r, 3000))

  const call = (endpoint, args) => page.evaluate(async ({ endpoint, args }) => {
    const t0 = performance.now()
    const res = await fetch('/api/dsws', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request', rpcId: 'diag-' + Date.now() + '-' + Math.random().toString(36).slice(2),
        method: 'dsws', payload: { method: endpoint, payload: args },
      }),
    })
    const text = await res.text()
    const ms = Math.round(performance.now() - t0)
    let v = null
    try { const p = JSON.parse(text); v = (p.result && p.result.value) || null } catch (e) {}
    return { ms, v, raw: text.slice(0, 200) }
  }, { endpoint, args })

  console.log('=== 按工作区量面板数据 ===')
  console.log('  工作区: ' + CWD + '\n')

  console.log('--- snapshot（面板核心数据）---')
  const runs = []
  for (let i = 1; i <= ROUNDS; i++) {
    const r = await call('snapshot', { cwd: CWD })
    const v = r.v || {}
    runs.push({ ms: r.ms, gen: v.generatedMs, maps: Array.isArray(v.maps) ? v.maps.length : null, issues: Array.isArray(v.issues) ? v.issues.length : null, ok: v.ok })
    console.log('  第 ' + i + ' 次: ' + String(r.ms).padStart(6) + ' ms   ok=' + v.ok
      + '   生成时刻=' + (v.generatedMs ? new Date(v.generatedMs).toISOString() : '(无)')
      + '   地图=' + (Array.isArray(v.maps) ? v.maps.length : '?')
      + '   issue=' + (Array.isArray(v.issues) ? v.issues.length : '?')
      + (v.fromCache !== undefined ? '   fromCache=' + v.fromCache : ''))
    if (i < ROUNDS) await new Promise((r2) => setTimeout(r2, GAP_MS))
  }

  console.log('\n--- probe（自动探测）---')
  for (let i = 1; i <= 3; i++) {
    const r = await call('probe', { cwd: CWD })
    const v = r.v || {}
    console.log('  第 ' + i + ' 次: ' + String(r.ms).padStart(6) + ' ms   changed=' + v.changed + '   count=' + v.count)
    if (i < 3) await new Promise((r2) => setTimeout(r2, GAP_MS))
  }

  const gens = runs.map((r) => r.gen).filter(Boolean)
  const sameGen = gens.length === runs.length && gens.every((g) => g === gens[0])
  const times = runs.map((r) => r.ms)
  console.log('\n=== 结论 ===')
  console.log('  snapshot 耗时: ' + times.join(' / ') + ' ms')
  console.log('  三次生成时刻相同: ' + sameGen + (sameGen ? '（同一份，宿主有货可给）' : '（每次都在重建）'))
  const nonEmpty = runs.find((r) => r.maps !== null && r.maps > 0)
  if (nonEmpty) console.log('  快照规模: 地图 ' + nonEmpty.maps + ' / issue ' + nonEmpty.issues)
  await browser.close()
})().catch((e) => { console.error('fatal: ' + e.message); process.exit(1) })
