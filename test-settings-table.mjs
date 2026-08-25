import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [] })
const context = await browser.newContext()
const page = await context.newPage()
page.on('console', msg => {
  const t = msg.text()
  if (t.includes('[wsOverview]') || t.includes('StudyNotes') || t.includes('backendId')) console.log('CONSOLE:', t)
})
await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
// Click settings
const settingBtn = page.getByText('设置').first()
if (await settingBtn.count()>0) {
  await settingBtn.click()
  await page.waitForTimeout(2000)
  console.log('clicked settings')
}
await page.waitForTimeout(2000)
// Try to find Waystation tab via evaluate click
await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('*'))
  for (const el of els) {
    if (el.textContent && el.textContent.trim() === 'Waystation' && el.offsetWidth>0) {
      el.click()
      break
    }
  }
})
await page.waitForTimeout(3000)
const hasBackend = await page.evaluate(() => !!document.querySelector('#dsws-cfg-backend'))
console.log('hasBackend', hasBackend)
if (hasBackend) {
  // Expand details via evaluate
  await page.evaluate(() => {
    const d = document.querySelector('#dsws-cfg-backend details')
    if (d && !d.open) {
      const s = d.querySelector('summary')
      if (s) s.click()
    }
  })
  await page.waitForTimeout(2000)
  const info = await page.evaluate(() => {
    const el = document.querySelector('#dsws-cfg-backend')
    return el ? el.innerText.slice(0, 5000) : 'no el'
  })
  console.log('backend innerText', info.slice(0, 2000))
  // Check for StudyNotes row
  const studyRow = await page.evaluate(() => {
    const el = document.querySelector('#dsws-cfg-backend')
    if (!el) return null
    const rows = Array.from(el.querySelectorAll('div[style*="display:flex"]')).filter(d => d.innerText.includes('StudyNotes'))
    return rows.map(r => r.innerText.slice(0,200))
  })
  console.log('studyRow', studyRow)
}
await browser.close()
