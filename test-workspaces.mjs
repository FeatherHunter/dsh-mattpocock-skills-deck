import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [] })
const context = await browser.newContext()
const page = await context.newPage()
await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
const result = await page.evaluate(async () => {
  const keys = Object.keys(window).filter(k => k.toLowerCase().includes('workspace') || k.toLowerCase().includes('dsw'))
  const hasHost = typeof window.host !== 'undefined'
  const hasDSW = typeof window.__DSW_CTX__ !== 'undefined'
  // Try to find workspaces via localStorage or via any global
  let ws = null
  try {
    const ls = localStorage.getItem('dsws.workspaces')
    ws = ls
  } catch {}
  return { keys, hasHost, hasDSW, ls: ws, body: document.body.innerText.slice(0,1000) }
})
console.log(JSON.stringify(result,null,2))
await browser.close()
