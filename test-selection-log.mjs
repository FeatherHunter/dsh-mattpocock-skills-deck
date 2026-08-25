import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [] })
const context = await browser.newContext()
const page = await context.newPage()
page.on('console', msg => {
  const text = msg.text()
  if (text.includes('[wsOverview]')) console.log('CONSOLE:', text)
})
await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
// Click settings
const settingBtn = page.getByText('设置').first()
if (await settingBtn.count() > 0) {
  await settingBtn.click()
  await page.waitForTimeout(2000)
  // Find Waystation tab - try to find settings tab with text Waystation
  const waystation = page.locator('text=Waystation').first()
  // Instead, look for the backend overview details
  await page.waitForTimeout(3000)
  // Try to expand details if exists
  const details = page.locator('details').first()
  if (await details.count() > 0) {
    const isOpen = await details.evaluate(e => e.open)
    console.log('details open?', isOpen)
    if (!isOpen) {
      await details.locator('summary').click()
      await page.waitForTimeout(2000)
    }
  }
  await page.waitForTimeout(2000)
  // Capture body
  const body = await page.evaluate(() => document.body.innerText.slice(0, 5000))
  console.log('BODY:', body.slice(0, 2000))
}
await page.waitForTimeout(2000)
await browser.close()
