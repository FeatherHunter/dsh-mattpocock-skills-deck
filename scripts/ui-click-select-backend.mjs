import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const DSH='http://127.0.0.1:3080'
const OUT=resolve('tmp/ui-black-repro')
mkdirSync(OUT,{recursive:true})
console.log('[click] DSH',DSH)
const browser=await chromium.launch({channel:'chrome',headless:false,args:['--start-maximized'],timeout:60000})
const context=await browser.newContext({viewport:null})
await context.addInitScript(()=>{try{localStorage.setItem('dsws.cfg',JSON.stringify({withWayfinder:true,openIn:'dock'}))}catch{}})
const page=await context.newPage()
for(let a=1;a<=6;a++){ if(a===1) await page.goto(DSH,{waitUntil:'domcontentloaded',timeout:40000}); else await page.reload({waitUntil:'domcontentloaded'}); await page.waitForTimeout(3500); const ok=await page.evaluate(()=>!document.body.innerText.includes('Failed to load plugins') && document.body.innerText.includes('MattSkills')); console.log(`[click] attempt ${a} ok=${ok}`); if(ok) break; }
await page.waitForTimeout(1500)
// Ensure matt-demo Hello is active: click matt-demo workspace then Hello session
console.log('[click] selecting MATT-demo workspace')
let pt = await page.evaluate(()=>{
  for(const el of document.querySelectorAll('*')){
    if(el.textContent.trim()==='matt-demo'){
      const r=el.getBoundingClientRect()
      if(r.width>0) return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}
    }
  }
  return null
})
if(pt){ await page.mouse.click(pt.x,pt.y); await page.waitForTimeout(1500); console.log('[click] clicked matt-demo',pt) }
await page.screenshot({path: resolve(OUT,'01-after-matt-demo.png'), fullPage:true})
// click Hello session
let helloPt = await page.evaluate(()=>{
  for(const el of document.querySelectorAll('*')){
    if(el.textContent.trim()==='Hello'){
      const r=el.getBoundingClientRect()
      if(r.width>0) return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}
    }
  }
  return null
})
console.log('[click] Hello pt',helloPt)
if(helloPt){ await page.mouse.click(helloPt.x, helloPt.y); await page.waitForTimeout(2000); console.log('[click] clicked Hello')}
await page.screenshot({path: resolve(OUT,'02-after-hello.png'), fullPage:true})
// Ensure right panel is open: if not, click a seg to open
let segPt = await page.evaluate(()=>{
  const segs=document.querySelectorAll('.dsws-seg')
  for(const s of segs) if(s.textContent.includes('可接')){ const r=s.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}}
  return null
})
if(segPt){ console.log('[click] seg pt',segPt); await page.mouse.click(segPt.x,segPt.y); await page.waitForTimeout(2000) }
await page.screenshot({path: resolve(OUT,'03-before-select-backend.png'), fullPage:true})
// Find and click 选择后端 button
let btnPt = await page.evaluate(()=>{
  const btns=Array.from(document.querySelectorAll('button'))
  for(const b of btns) if(b.textContent.trim()==='选择后端'){
    const r=b.getBoundingClientRect()
    if(r.width>0) return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2), text:b.textContent.trim()}
  }
  return null
})
console.log('[click] 选择后端 pt',btnPt)
if(btnPt){
  await page.mouse.click(btnPt.x, btnPt.y)
  await page.waitForTimeout(2000)
  await page.screenshot({path: resolve(OUT,'04-after-click-select-backend.png'), fullPage:true})
  console.log('[click] clicked 选择后端')
  // Check dock body
  const info = await page.evaluate(()=>{
    const body=document.querySelector('.dsws-body')
    const dock=document.querySelector('[data-dsws-host]')
    return {
      bodyText: body? body.innerText.slice(0,4000):'no body',
      bodyHtml: body? body.innerHTML.slice(0,5000):'',
      dockHtml: dock? dock.innerHTML.slice(0,6000):'no dock',
      tab: (()=>{ try{ const s=document.querySelector('[data-dsws-host]'); return s? s.innerText.slice(0,500):''}catch{return''}})()
    }
  })
  console.log('[click] after bodyText', info.bodyText.slice(0,1000))
  // try to get tab state via evaluate st.tab? Use store
  const tabInfo = await page.evaluate(()=>{
    // try to read s.tab via React context? fallback: check URL or DOM
    const body=document.querySelector('.dsws-body')
    return body? body.innerText.slice(0,500):'no body text'
  })
  console.log('[click] tabInfo', tabInfo)
  // screenshot dock body closeup
  try { await page.locator('.dsws-body').first().screenshot({path: resolve(OUT,'05-dock-body-after.png')}); console.log('[click] 05 dock body after') } catch(e){ console.log('[click] dock body shot err',e.message)}
  // click 列表 to recover
  let listPt = await page.evaluate(()=>{
    for(const b of document.querySelectorAll('button')) if(b.textContent.trim()==='列表'){ const r=b.getBoundingClientRect(); if(r.width>0) return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}}
    return null
  })
  console.log('[click] 列表 pt',listPt)
  if(listPt){ await page.mouse.click(listPt.x,listPt.y); await page.waitForTimeout(1500); await page.screenshot({path: resolve(OUT,'06-after-click-list.png'), fullPage:true}); console.log('[click] 06 after list') }
} else {
  console.log('[click] 选择后端 button not found')
}
await browser.close()
console.log('[click] done')
