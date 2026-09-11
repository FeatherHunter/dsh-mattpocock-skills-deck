// tests/diag-live-return-vs-wait.js
//
// 用途（一次性诊断，不是门禁）：判定「面板数据」这条通话，宿主是「手上有货能直接给」还是「每次都得重建」。
//
// 为什么要判这个：点开面板要等 7~8 秒。若宿主手上本来就有磁盘那份快照、只是被网络校验挡住返回，
//   那把它改成「先返回、校验放后台」就能立刻见效；若手上是空的、必须去拿，那几秒是硬成本，
//   只能靠别的手段缓解。两种情况的改法与收益上限不同，必须先量清楚。
//
// 判据：连打三次，看回来的快照是不是同一份（生成时刻有没有变）。
//   同一份 → 宿主有货可给（改动有效）
//   每次都在变 → 每次都在重建（改动收益有限）
//
// 需要 DSH 启动时打印的带令牌网址（只在本机本次启动内有效）：
//   $env:DSH_AUTH_URL='http://127.0.0.1:3080/?token=...'
//   node tests/diag-live-return-vs-wait.js

const { chromium } = require('playwright')

const AUTH_URL = process.env.DSH_AUTH_URL
if (!AUTH_URL) { console.error('缺少 DSH_AUTH_URL'); process.exit(1) }
const GAP_MS = Number(process.env.GAP_MS || 3000)

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1000 } })
  const page = await ctx.newPage()
  await page.goto(AUTH_URL, { waitUntil: 'domcontentloaded', timeout: 40000 })
  for (let i = 0; i < 40; i++) { if (await page.evaluate(() => /MattSkills/.test(document.body?.innerText || ''))) break; await new Promise((r) => setTimeout(r, 1000)) }
  await new Promise((r) => setTimeout(r, 4000))

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
    return { ms, status: res.status, v, raw: text.slice(0, 300) }
  }, { endpoint, args })

  console.log('=== 判定：宿主是「有货可给」还是「每次重建」===\n')

  const runs = []
  for (let i = 1; i <= 3; i++) {
    const r = await call('snapshot', {})
    const v = r.v || {}
    const g = v.generatedMs
    runs.push({ i, ms: r.ms, gen: g, fromCache: v.fromCache, maps: Array.isArray(v.maps) ? v.maps.length : null, issues: Array.isArray(v.issues) ? v.issues.length : null, ok: v.ok })
    console.log('  第 ' + i + ' 次: ' + String(r.ms).padStart(6) + ' ms   ok=' + v.ok
      + '   生成时刻=' + (g ? new Date(g).toISOString() : '(无)')
      + '   fromCache=' + String(v.fromCache)
      + '   地图=' + (Array.isArray(v.maps) ? v.maps.length : '?')
      + '   issue=' + (Array.isArray(v.issues) ? v.issues.length : '?'))
    if (r.status !== 200) console.log('     原始回包: ' + r.raw)
    if (i < 3) await new Promise((r2) => setTimeout(r2, GAP_MS))
  }

  const gens = runs.map((r) => r.gen).filter(Boolean)
  const sameGen = gens.length === runs.length && gens.every((g) => g === gens[0])
  const times = runs.map((r) => r.ms)
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length)

  console.log('\n=== 结论 ===')
  console.log('  三次耗时: ' + times.join(' / ') + ' ms   平均 ' + avg + ' ms')
  console.log('  三次生成时刻相同: ' + sameGen)
  if (!gens.length) {
    console.log('  → 三次都没拿到快照内容（可能房间没有任何仓库上下文）。未能判定。')
  } else if (sameGen) {
    console.log('  → 宿主手上是同一份东西、能直接给：属于「被校验挡住返回」那种，')
    console.log('    改成「先返回、校验放后台」可直接见效。')
  } else {
    console.log('  → 每次都生成新的一份：说明每次调用都在重建，改动收益有限，')
    console.log('    慢的原因更偏向「每次都在重新拿数据」。')
  }
  if (runs.some((r) => r.fromCache === true)) console.log('  旁证：有返回标记为「来自缓存」的那一次，说明磁盘/内存那条路是通的。')

  await browser.close()
})().catch((e) => { console.error('fatal: ' + e.message); process.exit(1) })
