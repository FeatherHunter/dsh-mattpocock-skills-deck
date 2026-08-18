// playwright-e2e-probe.js — #2 自动刷新 · 稳健 E2E（R2-fix-5 验证）
// 针对 v3 的页面加载不稳定（panel 没挂载就超时）做了加固：
//   - goto 用 domcontentloaded，不赌 networkidle（websocket 重应用 networkidle 会挂）
//   - 等「面板真的活着」：出现 dsws 容器 && 出现 #18 行文本（确认列表渲染）
//   - 从 UI 读编辑前的 #18 标题（preTitle），确认 T1 不在 → 防假绿
//   - 会话内 gh 改 #18 → 唯一 T1，等 probe（≤110s）自动刷新（不 reload）
const { chromium } = require('playwright')
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const DSH_URL = 'http://127.0.0.1:59519'
const ISSUE = 18
const REPO = 'FeatherHunter/dsh-mattpocock-skills-deck'
const SHOTS = path.resolve(__dirname, '../.scratch/pw-shots')
fs.mkdirSync(SHOTS, { recursive: true })
const now = new Date()
const STAMP = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 16)
// 清理之前一轮残留 marker，UI 才能回到干净基线
const PRE = `[E2E-PRE-${STAMP}] pre-clean`
const T1 = `[E2E-T1-${STAMP} ⏱️] auto-refresh-v4`

const pad = (d) => d.toTimeString().slice(0, 8)
const cli = (cmd) => { try { execSync(cmd, { stdio: 'inherit' }) } catch (e) { throw new Error('cli failed: ' + cmd + ' :: ' + e.message) } }
const bodyText = (page) => page.evaluate(() => document.body?.innerText || '').catch(() => '')

async function waitForPanelAlive(page, timeoutMs = 70000) {
  const t0 = Date.now()
  for (;;) {
    const t = await bodyText(page)
    const alive = /FeatherHunter\/dsh-mattpocock-skills-deck/.test(t) && /#18|编号|可接|刷新/.test(t)
    if (alive) return { ok: true, ms: Date.now() - t0, text: t }
    if (Date.now() - t0 > timeoutMs) return { ok: false, ms: Date.now() - t0, text: t }
    await page.waitForTimeout(2000)
  }
}

;(async () => {
  console.log(`[e2e ${pad(new Date())}] ===== #2 auto-refresh E2E v4 =====`)
  console.log(`[e2e] stamp=${STAMP}\n  PRE='${PRE}'\n  T1='${T1}'`)

  // 先把 #18 清到一个干净基线（页面加载前），保证编辑前状态确定
  console.log(`[e2e ${pad(new Date())}] [PRE] set #18 -> PRE (clean baseline)`)
  cli(`gh issue edit ${ISSUE} --repo "${REPO}" --title "${PRE}" --body "E2E v4 pre body ${STAMP}"`)

  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1000 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 240)))

  console.log(`[e2e ${pad(new Date())}] goto (domcontentloaded)`)
  await page.goto(DSH_URL, { waitUntil: 'domcontentloaded', timeout: 40000 })
  // 等 capsule 出现
  let capOk = false
  for (let i = 0; i < 20; i++) {
    capOk = await page.locator('.dsws-capsule, .dsws-capsule-word').first().isVisible().catch(() => false)
    if (capOk) break
    await page.waitForTimeout(1500)
  }
  console.log(`[e2e ${pad(new Date())}] capsule visible: ${capOk}`)
  // 若面板未挂载，点 capsule 展开
  const panelMounted = await page.evaluate(() => !!document.querySelector('.dsws-panel, #dsws-root, .dsws-details'))
  if (!panelMounted) {
    const box = await page.locator('.dsws-capsule, .dsws-capsule-word').first().boundingBox().catch(() => null)
    if (box) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); console.log('[e2e] clicked capsule') }
  }
  await page.waitForTimeout(2000)

  // 等面板活着（含 #18 行）
  const alive = await waitForPanelAlive(page, 70000)
  console.log(`[e2e ${pad(new Date())}] panel alive: ${alive.ok} after ${(alive.ms / 1000).toFixed(0)}s`)
  if (!alive.ok) { await page.screenshot({ path: path.join(SHOTS, `v4-dead-${STAMP}.png`) }); console.log('[e2e] panel dead, bodyLen', alive.text.length) }

  // 读编辑前 #18 标题（从 UI 文本里抓「PRE」那段或 #18 附近行）
  const preTxt = await bodyText(page)
  const preTitleKnown = preTxt.includes(PRE)
  const t1Pre = preTxt.includes(T1)
  console.log(`[e2e ${pad(new Date())}] pre-edit: PRE shown in UI=${preTitleKnown}, T1 already present=${t1Pre}`)
  await page.screenshot({ path: path.join(SHOTS, `v4-01-pre-${STAMP}.png`) })

  // 会话内改 #18 → T1（不 reload）
  const editTime = new Date()
  console.log(`[e2e ${pad(editTime)}] [IN-SESSION] set #18 -> T1`)
  cli(`gh issue edit ${ISSUE} --repo "${REPO}" --title "${T1}" --body "E2E v4 marker body ${STAMP}"`)

  // 等 probe 自动刷新
  console.log(`[e2e ${pad(new Date())}] waiting probe -> T1 (no reload, ≤110s)...`)
  const t10 = Date.now()
  let seenT1 = false
  for (;;) {
    const t = await bodyText(page)
    if (t.includes(T1)) { seenT1 = true; break }
    if (Date.now() - t10 > 110000) break
    await page.waitForTimeout(2500)
  }
  const dT1 = ((Date.now() - t10) / 1000).toFixed(0)
  console.log(`[e2e ${pad(new Date())}] T1 in UI: ${seenT1} after ${dT1}s (no reload)`)
  await page.screenshot({ path: path.join(SHOTS, `v4-02-t1-${STAMP}.png`) })

  try { cli(`gh issue edit ${ISSUE} --repo "${REPO}" --title "${T1} (verified ${STAMP})"`) } catch (e) { /* ignore */ }

  console.log('\n========================================')
  if (seenT1 && !t1Pre) console.log(`✅ PASS: UI auto-refreshed to unique T1 (${dT1}s after edit, NO reload, wasAbsent-before=true)`)
  else console.log(`❌ FAIL: seenT1=${seenT1} t1Pre=${t1Pre} panelAlive=${alive.ok}`)
  console.log('========================================')
  await browser.close()
  process.exit(seenT1 && !t1Pre ? 0 : 1)
})().catch((e) => { console.error('[e2e] fatal:', e.message); process.exit(99) })
