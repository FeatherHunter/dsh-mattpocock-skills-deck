import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const DSH = 'http://127.0.0.1:3080'
const OUT = resolve('tmp/ui-align-black')
mkdirSync(OUT, { recursive: true })
console.log('[align] DSH', DSH, 'OUT', OUT)

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--start-maximized'], timeout: 60000 })
const context = await browser.newContext({ viewport: null })
await context.addInitScript(() => {
  try { localStorage.setItem('dsws.cfg', JSON.stringify({ withWayfinder: true, openIn: 'dock' })) } catch {}
})
const page = await context.newPage()

// health retry
let healthy = false
for (let a=1;a<=6;a++){
  if (a===1) await page.goto(DSH, { waitUntil: 'domcontentloaded', timeout: 40000 })
  else await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  healthy = await page.evaluate(()=>{
    if (document.body.innerText.includes('Failed to load plugins')) return false
    return document.querySelector('.dsws-seg')!==null || document.body.innerText.includes('可接') || document.body.innerText.includes('MattSkills')
  })
  console.log(`[align] attempt ${a} healthy=${healthy}`)
  if (healthy) break
}
await page.waitForTimeout(1500)
await page.screenshot({ path: resolve(OUT, '01-full.png'), fullPage: true })
console.log('[align] 01-full.png')

// helper to screenshot element by text
async function shotByText(text, name, exact=false){
  const loc = exact ? page.getByText(text, {exact:true}) : page.getByText(text)
  const count = await loc.count()
  console.log(`[align] "${text}" count=${count}`)
  if (count>0){
    try { await loc.first().screenshot({ path: resolve(OUT, name) }); console.log(`[align] ${name}`); return true } catch(e){ console.log(`[align] shot ${name} err`, e.message)}
  }
  return false
}
async function shotSelector(sel, name){
  const loc = page.locator(sel)
  const c = await loc.count()
  console.log(`[align] sel ${sel} count=${c}`)
  if (c>0){ try{ await loc.first().screenshot({ path: resolve(OUT, name)}); console.log(`[align] ${name}`); return true }catch(e){console.log(e.message)}}
  return false
}

// Align: list elements user mentioned
await shotByText('工作区', '02-workspace-label.png')
await shotByText('dsh-mattpocock-skills-deck', '03-workspace-dsh-deck.png')
await shotByText('新会话', '04-new-session.png')
await shotSelector('.dsws-seg', '05-statusbar-seg.png')
await shotByText('可接', '06-seg-ke-jie.png')
await shotByText('列表', '07-tab-list.png')
await shotByText('技能', '07b-tab-skills.png')
await shotByText('环境检查', '07c-tab-checks.png')

// Try to activate session for dsh-mattpocock-skills-deck
// left sidebar sessions: look for the workspace folder then session
console.log('[align] trying to activate session for dsh-mattpocock-skills-deck...')
try {
  // click workspace folder dsh-mattpocock-skills-deck in left
  const ws = page.getByText('dsh-mattpocock-skills-deck').first()
  if (await ws.count()>0){
    const box = await ws.evaluate(el=>{ const r=el.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}})
    // just log, not clicking workspace? Instead click a session under it
  }
  // find a session item: the list shows "178 4分钟" etc, we can click the first session that is not "新会话"
  // try to click the session that shows current: look for the dock's repo chip or the active session highlight
  // simpler: click the status bar "可接" to open dock (A形态)
  const seg = page.getByText('可接').first()
  if (await seg.count()>0){
    await seg.click({ timeout: 4000 })
    await page.waitForTimeout(2000)
    console.log('[align] clicked 可接 seg')
    await page.screenshot({ path: resolve(OUT, '08-after-click-ke-jie.png'), fullPage: true })
    // dock should appear on right
    await shotSelector('[data-dsws-host]', '09-dock-host.png')
    await shotSelector('.dsws-body', '10-dock-body.png')
    await shotByText('未绑定后端', '11-unbound-title.png')
    await shotByText('当前工作区未选择 Tracker 后端', '12-unbound-desc.png')
    await shotByText('选择后端', '13-btn-select-backend.png')
    // also check for other buttons
    await shotByText('去设置页选择', '14-btn-go-settings.png')
    await shotByText('重试探测', '15-btn-retry.png')
  }
} catch(e){ console.log('[align] activate err', e.message) }

// Also check repo chip
await shotByText('MattSkills', '16-mattskills-title.png')
await shotSelector('[data-repo-chip]', '17-repo-chip.png')
await shotSelector('[data-repo-text]', '18-repo-text.png')

// Final full after dock open
await page.screenshot({ path: resolve(OUT, '19-final.png'), fullPage: true })
console.log('[align] done')

await browser.close()
