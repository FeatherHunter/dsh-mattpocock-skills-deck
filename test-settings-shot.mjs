import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
mkdirSync('tmp/settings-shot', { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--start-maximized'] })
const context = await browser.newContext({ viewport: null })
const page = await context.newPage()
await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
await page.screenshot({ path: resolve('tmp/settings-shot/01-full.png'), fullPage: true })
const settingBtn = page.getByText('设置').first()
console.log('settingBtn count', await settingBtn.count())
if (await settingBtn.count()>0) {
  await settingBtn.click()
  await page.waitForTimeout(3000)
  await page.screenshot({ path: resolve('tmp/settings-shot/02-after-settings.png'), fullPage: true })
  console.log('clicked settings')
  const body = await page.evaluate(() => document.body.innerText.slice(0, 3000))
  console.log('body after settings', body.slice(0, 1000))
  // Try to find Waystation
  const found = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('*')).filter(e => e.textContent && e.textContent.includes('Waystation')).map(e => ({ text: e.textContent.trim().slice(0,100), tag: e.tagName, cls: e.className, visible: !!(e.offsetWidth&&e.offsetHeight)}))
  })
  console.log('Waystation found', JSON.stringify(found.slice(0,10),null,2))
}
await page.waitForTimeout(2000)
await browser.close()
