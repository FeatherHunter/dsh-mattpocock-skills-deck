import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const DSH = 'http://127.0.0.1:3080'
const OUT = resolve('tmp/ui-repro-matt')
mkdirSync(OUT, { recursive: true })
console.log('[repro] DSH', DSH)

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--start-maximized'], timeout: 60000 })
const context = await browser.newContext({ viewport: null })
await context.addInitScript(() => {
  try { localStorage.setItem('dsws.cfg', JSON.stringify({ withWayfinder: true, openIn: 'dock' })) } catch {}
})
const page = await context.newPage()

// health
for (let a=1;a<=6;a++){
  if (a===1) await page.goto(DSH, { waitUntil: 'domcontentloaded', timeout: 40000 })
  else await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  const ok = await page.evaluate(()=> !document.body.innerText.includes('Failed to load plugins') && (document.querySelector('.dsws-seg')!==null || document.body.innerText.includes('可接')))
  console.log(`[repro] attempt ${a} ok=${ok}`)
  if (ok) break
}
await page.waitForTimeout(1500)
await page.screenshot({ path: resolve(OUT, '01-full.png'), fullPage: true })
console.log('[repro] 01-full')

// helper hit-test click by text
async function clickByText(text, exact=false){
  const loc = exact ? page.getByText(text, {exact:true}) : page.getByText(text)
  const c = await loc.count()
  console.log(`[repro] clickByText "${text}" count=${c}`)
  if (c===0) return false
  // try all candidates, find visible one
  for (let i=0;i<c;i++){
    const el = loc.nth(i)
    try {
      const box = await el.boundingBox()
      if (!box) continue
      // use hit-test center
      const center = await page.evaluate((t, idx)=>{
        const els = Array.from(document.querySelectorAll('*')).filter(e=> e.textContent && e.textContent.trim()===t)
        // fallback: use nth
        return null
      }, text)
      await el.click({ timeout: 3000 })
      await page.waitForTimeout(1500)
      console.log(`[repro] clicked "${text}" nth ${i}`)
      return true
    } catch(e){ console.log(`[repro] click ${i} err`, e.message) }
  }
  return false
}
async function clickByEvalText(text){
  const pt = await page.evaluate((t)=>{
    const els = Array.from(document.querySelectorAll('*'))
    for (const el of els){
      if (el.textContent && el.textContent.trim()===t){
        const r = el.getBoundingClientRect()
        if (r.width>0 && r.height>0){
          return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2), tag: el.tagName, cls: el.className }
        }
      }
    }
    return null
  }, text)
  console.log(`[repro] eval pt for "${text}"`, pt)
  if (pt){
    await page.mouse.click(pt.x, pt.y)
    await page.waitForTimeout(1500)
    return true
  }
  return false
}

// Step 1: select MATT-demo workspace in left
console.log('[repro] step1: select MATT-demo workspace')
let clickedWs = await clickByEvalText('matt-demo')
if (!clickedWs) clickedWs = await clickByText('matt-demo', true)
await page.waitForTimeout(1500)
await page.screenshot({ path: resolve(OUT, '02-after-click-matt-demo-ws.png'), fullPage: true })
console.log('[repro] 02 ws')

// After selecting workspace, the session list should show sessions for that workspace
// Look for sessions: maybe "新会话" under that workspace, or existing sessions
const wsSessions = await page.evaluate(()=>{
  const body = document.body.innerText
  const hasMattDemo = body.includes('matt-demo')
  const all = Array.from(document.querySelectorAll('*')).map(e=>e.textContent?.trim()).filter(t=>t && t.length<60)
  return { hasMattDemo, texts: all.slice(0,80).join(' | ').slice(0,2000) }
})
console.log('[repro] wsSessions', wsSessions.texts.slice(0,1000))

// Try to click a session inside MATT-demo: look for "新会话" button that creates session in that workspace
// The left sidebar shows workspaces, clicking workspace may not auto-create session, we need to click a session item
// Let's try to click the first session under MATT-demo: we can look for any element with class indicating session
// Alternative: click the workspace's "新会话" is not correct; we need to find session list for that workspace
// Let's dump DOM for left sidebar
const leftHtml = await page.evaluate(()=>{
  const left = document.querySelector('[class*="sidebar"]') || document.querySelector('aside') || document.body
  return document.body.innerHTML.slice(0, 15000)
})
// Write to file for debug
import { writeFileSync } from 'node:fs'
writeFileSync(resolve(OUT, 'left.html'), leftHtml.slice(0, 10000), 'utf8')

// Try clicking "matt-demo" again to ensure workspace selected, then look for any session with that cwd
// Use page.getByText for session that might be highlighted
await page.waitForTimeout(1000)
// Now click status bar button to open right panel: the status bar shows seg "可接 0", "BUG 0" etc
// Need to hit-test the status bar seg center
console.log('[repro] step2: click status bar seg to open right panel')
const segClicked = await page.evaluate(()=>{
  const segs = Array.from(document.querySelectorAll('.dsws-seg'))
  for (const s of segs){
    if (s.textContent && s.textContent.includes('可接')){
      const r=s.getBoundingClientRect()
      return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2), text: s.textContent.trim() }
    }
  }
  return null
})
console.log('[repro] seg pt', segClicked)
if (segClicked){
  await page.mouse.click(segClicked.x, segClicked.y)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: resolve(OUT, '03-after-click-seg.png'), fullPage: true })
  console.log('[repro] 03 after seg')
} else {
  console.log('[repro] seg not found via .dsws-seg, try getByText')
  await clickByText('可接')
  await page.screenshot({ path: resolve(OUT, '03-after-click-seg-fallback.png'), fullPage: true })
}

// Check dock
const dockInfo = await page.evaluate(()=>{
  const dock = document.querySelector('[data-dsws-host]') || document.querySelector('.dsws-body')
  if (!dock) return { hasDock:false }
  const r = dock.getBoundingClientRect()
  const body = document.querySelector('.dsws-body')
  const bodyText = body ? body.innerText.slice(0, 3000) : ''
  const hasUnbound = bodyText.includes('未绑定后端')
  const hasSelect = bodyText.includes('选择后端')
  const hasList = bodyText.includes('列表')
  const hasBackendSection = !!document.querySelector('#dsws-cfg-backend')
  return { hasDock:true, dockRect: {x:r.x,y:r.y,w:r.width,h:r.height}, bodyText, hasUnbound, hasSelect, hasList, hasBackendSection }
})
console.log('[repro] dockInfo', JSON.stringify(dockInfo, null, 2))
writeFileSync(resolve(OUT, 'dockInfo.json'), JSON.stringify(dockInfo, null, 2), 'utf8')

// Try to screenshot dock body
try {
  const bodyLoc = page.locator('.dsws-body')
  if (await bodyLoc.count()>0){
    await bodyLoc.first().screenshot({ path: resolve(OUT, '04-dock-body.png') })
    console.log('[repro] 04 dock body')
  }
} catch(e){ console.log('[repro] dock body shot err', e.message) }
try {
  const hostLoc = page.locator('[data-dsws-host]')
  if (await hostLoc.count()>0){
    await hostLoc.first().screenshot({ path: resolve(OUT, '05-dock-host.png') })
    console.log('[repro] 05 host')
  }
} catch(e){}

// If unbound card not visible, try to find any card with 选择后端
const btnInfo = await page.evaluate(()=>{
  const allBtns = Array.from(document.querySelectorAll('button'))
  const matches = allBtns.filter(b=> b.textContent && b.textContent.includes('选择后端')).map(b=> ({text:b.textContent.trim(), rect: b.getBoundingClientRect(), visible: !!(b.offsetWidth&&b.offsetHeight)}))
  const goSettings = allBtns.filter(b=> b.textContent && b.textContent.includes('去设置页')).map(b=> ({text:b.textContent.trim(), rect: b.getBoundingClientRect()}))
  return { matches, goSettings, totalBtns: allBtns.length }
})
console.log('[repro] btnInfo', JSON.stringify(btnInfo, null, 2))
writeFileSync(resolve(OUT, 'btnInfo.json'), JSON.stringify(btnInfo, null, 2), 'utf8')

// If found 选择后端, click it and check black panel
if (btnInfo.matches.length>0){
  const pt = btnInfo.matches[0].rect
  const cx = Math.round(pt.x+pt.width/2), cy=Math.round(pt.y+pt.height/2)
  console.log(`[repro] clicking 选择后端 at ${cx},${cy}`)
  await page.mouse.click(cx, cy)
  await page.waitForTimeout(2000)
  await page.screenshot({ path: resolve(OUT, '06-after-click-select-backend.png'), fullPage: true })
  console.log('[repro] 06 after select backend')
  // check dock body again
  const after = await page.evaluate(()=>{
    const body = document.querySelector('.dsws-body')
    return body ? { text: body.innerText.slice(0,4000), html: body.innerHTML.slice(0,5000), rect: body.getBoundingClientRect() } : null
  })
  console.log('[repro] after body', JSON.stringify(after, null, 2).slice(0,4000))
  writeFileSync(resolve(OUT, 'afterBody.json'), JSON.stringify(after, null, 2), 'utf8')
  try { await page.locator('.dsws-body').first().screenshot({ path: resolve(OUT, '07-body-after-black.png') }); console.log('[repro] 07 body after') } catch(e){}
  // also check for 列表 button to recover
  const listBtn = await page.evaluate(()=>{
    const btns = Array.from(document.querySelectorAll('button'))
    for (const b of btns) if (b.textContent && b.textContent.trim()==='列表') return b.getBoundingClientRect()
    return null
  })
  console.log('[repro] listBtn rect', listBtn)
  if (listBtn){
    const cx2 = Math.round(listBtn.x+listBtn.width/2), cy2=Math.round(listBtn.y+listBtn.height/2)
    await page.mouse.click(cx2, cy2)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: resolve(OUT, '08-after-click-list.png'), fullPage: true })
    console.log('[repro] 08 after list')
  }
} else {
  console.log('[repro] no 选择后端 button found, cannot test black panel')
}

await browser.close()
console.log('[repro] done')
