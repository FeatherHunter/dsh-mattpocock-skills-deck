import { chromium } from 'playwright'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DSH = process.env.DSH_URL || 'http://127.0.0.1:3080'
const OUT = resolve('tmp/ui-verify-registry')
mkdirSync(OUT, { recursive: true })

console.log('[ui] DSH', DSH)

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--start-maximized'], timeout: 60000 })
const context = await browser.newContext({ viewport: null })
await context.addInitScript(() => {
  try { localStorage.setItem('dsws.cfg', JSON.stringify({ withWayfinder: true, openIn: 'dock' })) } catch {}
})
const page = await context.newPage()

let healthy = false
for (let attempt = 1; attempt <= 6; attempt++) {
  if (attempt === 1) await page.goto(DSH, { waitUntil: 'domcontentloaded', timeout: 40000 })
  else await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  healthy = await page.evaluate(() => {
    if (document.body && document.body.innerText.indexOf('Failed to load plugins') >= 0) return false
    // check for any dsws element or settings marker
    return document.querySelector('.dsws-seg') !== null || document.querySelector('#dsws-cfg-backend') !== null || document.body.innerText.includes('后端')
  })
  console.log(`[ui] attempt ${attempt} healthy=${healthy}`)
  if (healthy) break
}
if (!healthy) {
  console.log('[ui] NOT healthy after retries, taking screenshot')
  await page.screenshot({ path: resolve(OUT, 'not-healthy.png'), fullPage: true })
  await browser.close()
  process.exit(1)
}

await page.waitForTimeout(2000)

// Dump page text for debugging
const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 8000))
console.log('[ui] bodyText snippet', bodyText.slice(0, 2000).replace(/\n/g, ' | '))
writeFileSync(resolve(OUT, 'body.txt'), bodyText, 'utf8')

// Try to locate settings entry
// Look for Waystation tab, settings button, etc.
const found = await page.evaluate(() => {
  const texts = Array.from(document.querySelectorAll('*')).map(e => e.textContent?.trim()).filter(t => t && t.length < 80)
  const hasWaystation = texts.some(t => /Waystation/i.test(t))
  const hasBackend = document.body.innerText.includes('后端')
  const hasRegistryError = document.body.innerText.includes('unknown endpoint: registry')
  const cfgEl = document.querySelector('#dsws-cfg-backend')
  const cfgHtml = cfgEl ? cfgEl.outerHTML.slice(0, 3000) : null
  const allCfgGroups = Array.from(document.querySelectorAll('.dsws-cfg-group')).map(g => g.innerText.slice(0, 500))
  return { hasWaystation, hasBackend, hasRegistryError, cfgHtml, allCfgGroups, url: location.href }
})
console.log('[ui] found', JSON.stringify(found, null, 2))
writeFileSync(resolve(OUT, 'found.json'), JSON.stringify(found, null, 2), 'utf8')

// If #dsws-cfg-backend not found, try to navigate to settings
if (!found.cfgHtml) {
  console.log('[ui] #dsws-cfg-backend not found, trying to open settings...')
  // try to find settings button
  const clicked = await page.evaluate(() => {
    // look for settings gear or Waystation text
    const all = Array.from(document.querySelectorAll('button, a, [role="button"]'))
    for (const el of all) {
      const t = el.textContent?.trim()
      if (t && /设置|Settings|Waystation|Matt/i.test(t)) {
        el.scrollIntoView({ block: 'center' })
        return { text: t, tag: el.tagName, cls: el.className }
      }
    }
    return null
  })
  console.log('[ui] settings candidate', clicked)
  // Try clicking Waystation if visible
  try {
    const el = await page.getByText(/Waystation/i).first()
    if (await el.count() > 0) {
      await el.click({ timeout: 3000 })
      await page.waitForTimeout(2000)
      console.log('[ui] clicked Waystation')
    }
  } catch {}
  // Also try clicking settings gear icon
  try {
    // look for any element with title settings
    const settingBtn = page.locator('[title*="设置"], [title*="Settings"]')
    if (await settingBtn.count() > 0) {
      await settingBtn.first().click({ timeout: 3000 })
      await page.waitForTimeout(2000)
      console.log('[ui] clicked settings gear')
    }
  } catch {}
  // After clicks, re-check
  const found2 = await page.evaluate(() => {
    const cfgEl = document.querySelector('#dsws-cfg-backend')
    return { cfgHtml: cfgEl ? cfgEl.outerHTML.slice(0, 5000) : null, bodyHasBackend: document.body.innerText.includes('后端'), hasError: document.body.innerText.includes('unknown endpoint: registry'), allGroups: Array.from(document.querySelectorAll('.dsws-cfg-group')).map(g => g.outerHTML.slice(0, 1000)) }
  })
  console.log('[ui] after click found2', JSON.stringify(found2, null, 2).slice(0, 5000))
  writeFileSync(resolve(OUT, 'found2.json'), JSON.stringify(found2, null, 2), 'utf8')
  // screenshot after attempt
  await page.screenshot({ path: resolve(OUT, 'after-click.png'), fullPage: true })
  console.log('[ui] screenshot after-click.png')
}

// Final checks: evaluate host.call directly
try {
  const hostRes = await page.evaluate(async () => {
    if (typeof host === 'undefined' || typeof host.call !== 'function') return { err: 'host unavailable' }
    try {
      const r = await host.call('wf.registry', { cwd: '' })
      return { ok: true, res: r }
    } catch (e) {
      return { ok: false, err: String(e.message || e) }
    }
  })
  console.log('[ui] host.call wf.registry', JSON.stringify(hostRes, null, 2))
  writeFileSync(resolve(OUT, 'host-registry.json'), JSON.stringify(hostRes, null, 2), 'utf8')
} catch (e) {
  console.log('[ui] host.call evaluate error', e.message)
}

// Take final screenshots
await page.screenshot({ path: resolve(OUT, 'final-full.png'), fullPage: true })
console.log('[ui] final-full.png')

// Try to screenshot #dsws-cfg-backend if exists
try {
  const loc = page.locator('#dsws-cfg-backend')
  if (await loc.count() > 0) {
    await loc.first().screenshot({ path: resolve(OUT, 'cfg-backend.png') })
    console.log('[ui] cfg-backend.png')
    // also get bounding box and innerText
    const info = await page.evaluate(() => {
      const el = document.querySelector('#dsws-cfg-backend')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height, text: el.innerText.slice(0, 2000) }
    })
    console.log('[ui] cfg-backend info', JSON.stringify(info, null, 2))
    writeFileSync(resolve(OUT, 'cfg-backend-info.json'), JSON.stringify(info, null, 2), 'utf8')
    // check for error vs list
    const hasError = info && info.text.includes('unknown endpoint: registry')
    const hasList = info && (info.text.includes('GitHub') || info.text.includes('Markdown'))
    console.log('[ui] cfg-backend hasError', hasError, 'hasList', hasList)
    if (hasError) {
      console.log('[ui] FAIL: still shows registry error')
    } else if (hasList) {
      console.log('[ui] PASS: backend list renders')
    } else {
      console.log('[ui] UNKNOWN: no error but also no list')
    }
  } else {
    console.log('[ui] #dsws-cfg-backend not found for final screenshot')
  }
} catch (e) {
  console.log('[ui] locator error', e.message)
}

await browser.close()
console.log('[ui] done')
