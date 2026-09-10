import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const DSH='http://127.0.0.1:3080'
const OUT=resolve('tmp/ui-new-settings')
mkdirSync(OUT,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:false,args:['--start-maximized'],timeout:60000})
const context=await browser.newContext({viewport:null})
const page=await context.newPage()
await page.goto(DSH,{waitUntil:'domcontentloaded',timeout:40000})
await page.waitForTimeout(4000)
await page.screenshot({path: resolve(OUT,'01-full.png'), fullPage:true})
// click settings gear
const gear = page.locator('button').filter({hasText: '设置'}).first()
if(await gear.count()>0){ await gear.click({timeout:3000}); await page.waitForTimeout(2000); console.log('clicked 设置')}
else {
  // try clicking the settings icon at bottom left
  const settingBtn = page.getByText('设置').first()
  if(await settingBtn.count()>0){ await settingBtn.click(); await page.waitForTimeout(2000)}
}
await page.screenshot({path: resolve(OUT,'02-after-settings-click.png'), fullPage:true})
// Try to find Waystation tab
const waystation = page.getByText('Waystation').first()
if(await waystation.count()>0){
  await waystation.click({timeout:3000})
  await page.waitForTimeout(2000)
  console.log('clicked Waystation')
}
await page.screenshot({path: resolve(OUT,'03-waystation.png'), fullPage:true})
// Find the backend overview details
const details = page.locator('details').filter({hasText: '工作区后端总览'})
if(await details.count()>0){
  console.log('found details', await details.count())
  await details.first().screenshot({path: resolve(OUT,'04-details-collapsed.png')})
  // check if collapsed
  const isOpen = await details.first().evaluate(e=> e.open)
  console.log('isOpen', isOpen)
  if(!isOpen){
    await details.first().locator('summary').click({timeout:3000})
    await page.waitForTimeout(1000)
    await details.first().screenshot({path: resolve(OUT,'05-details-expanded.png')})
    console.log('expanded')
  }
  // Check for horizontal scrollbar
  const hasHScroll = await page.evaluate(()=>{
    const el=document.querySelector('#dsws-cfg-backend')
    if(!el) return null
    const detailsEl=el.querySelector('details')
    if(!detailsEl) return {hasDetails:false}
    const inner=detailsEl.querySelector('div')
    return { hasDetails:true, detailsScrollWidth: detailsEl.scrollWidth, detailsClientWidth: detailsEl.clientWidth, innerHTML: inner? inner.innerHTML.slice(0,2000):'' }
  })
  console.log('hasHScroll', hasHScroll)
  // Check for text wrapping: check whiteSpace
  const wrapCheck = await page.evaluate(()=>{
    const rows=document.querySelectorAll('#dsws-cfg-backend div[style*="display:flex"]')
    const results=[]
    for(const r of rows){
      const cs=getComputedStyle(r)
      results.push({text: r.innerText.slice(0,80), whiteSpace: cs.whiteSpace, overflow: cs.overflow})
      if(results.length>5) break
    }
    return results
  })
  console.log('wrapCheck', JSON.stringify(wrapCheck,null,2))
} else {
  console.log('details not found')
  await page.screenshot({path: resolve(OUT,'04-no-details.png'), fullPage:true})
}
await browser.close()
