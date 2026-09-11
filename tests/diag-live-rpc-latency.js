// tests/diag-live-rpc-latency.js
//
// 用途（一次性诊断，不是门禁）：直接在真机的已登录页面上打那条通话，量「一次请求要等多久」。
//
// 为什么这样做：宿主侧的等待只能从插件日志里事后看，改完也没法立刻验证。
//   这里借浏览器里那份已登录会话，直接向插件自己的通话入口发一次请求并计时，
//   于是「改之前 / 改之后」可以用同一条命令量出可比的数字，不用只靠手感。
//
// 需要 DSH 启动时打印的带令牌网址（只在本机本次启动内有效）：
//   $env:DSH_AUTH_URL='http://127.0.0.1:3080/?token=...'
//   node tests/diag-live-rpc-latency.js [重复次数]
//
// 只读：只请求快照与探测，不写任何数据。

const { chromium } = require('playwright')

const AUTH_URL = process.env.DSH_AUTH_URL
if (!AUTH_URL) { console.error('缺少 DSH_AUTH_URL'); process.exit(1) }
const ROUNDS = Number(process.argv[2] || 3)

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1000 } })
  const page = await ctx.newPage()
  await page.goto(AUTH_URL, { waitUntil: 'domcontentloaded', timeout: 40000 })
  for (let i = 0; i < 40; i++) { if (await page.evaluate(() => /MattSkills/.test(document.body?.innerText || ''))) break; await new Promise((r) => setTimeout(r, 1000)) }
  await new Promise((r) => setTimeout(r, 4000))
  console.log('=== 真机通话耗时（直接向插件通话入口发请求）===\n')

  // 在页面里发请求 → 带上浏览器已登录的会话，穿过后端那道鉴权闸
  const callFromPage = (endpoint, args) => page.evaluate(async ({ endpoint, args }) => {
    const t0 = performance.now()
    const res = await fetch('/api/dsws', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'diag-' + Date.now() + '-' + Math.random().toString(36).slice(2),
        method: 'dsws',
        payload: { method: endpoint, payload: args },
      }),
    })
    const text = await res.text()
    const ms = Math.round(performance.now() - t0)
    let parsed = null
    try { parsed = JSON.parse(text) } catch (e) {}
    return { ms, status: res.status, ok: !!(parsed && parsed.result && parsed.result.ok), value: (parsed && parsed.result && parsed.result.value) || null, raw: text.slice(0, 200) }
  }, { endpoint, args })

  // 先探一次，确认通道可用
  const probe = await callFromPage('logGetSwitch', {})
  console.log('  通道自检 logGetSwitch: status=' + probe.status + ' ok=' + probe.ok + ' ' + probe.ms + ' ms')
  if (probe.status !== 200) { console.log('  通道不可用，停止。原始回包: ' + probe.raw); await browser.close(); process.exit(2) }

  const cases = [
    { name: 'snapshot（面板核心数据，含「有没有变」校验）', ep: 'snapshot', args: {} },
    { name: 'probe（自动探测，含「有没有变」校验）', ep: 'probe', args: {} },
  ]

  for (const c of cases) {
    const times = []
    for (let i = 1; i <= ROUNDS; i++) {
      const r = await callFromPage(c.ep, c.args)
      times.push(r.ms)
      const extra = r.value && r.value.changed !== undefined ? (' changed=' + r.value.changed) : ''
      console.log('  ' + c.name + '  第 ' + i + ' 次: ' + String(r.ms).padStart(6) + ' ms  ok=' + r.ok + extra)
    }
    const sorted = times.slice().sort((a, b) => a - b)
    console.log('    → 最小 ' + sorted[0] + ' ms   中位 ' + sorted[Math.floor(sorted.length / 2)] + ' ms   最大 ' + sorted[sorted.length - 1] + ' ms\n')
  }

  await browser.close()
  console.log('  读法：这条数字就是「点开面板要等多久」的真身——面板本身毫秒级就画出来了，')
  console.log('        等的是这条通话返回。数字降下来，面板才能真的「点开即见新数据」。')
})().catch((e) => { console.error('fatal: ' + e.message); process.exit(1) })
