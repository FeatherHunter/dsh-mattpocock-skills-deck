// verify-issue22-ui.js - issue #22 real Chrome regression
// Usage: node tests/verify-issue22-ui.js [url]
// Requires the running DSH web GUI and Chrome.
const { chromium } = require('playwright')
const fs = require('fs')

const DSH = process.argv[2] || 'http://127.0.0.1:59519'
const OUT = '.bug-investigate/issue22-ui'
fs.mkdirSync(OUT, { recursive: true })
const wait = (page, ms) => page.waitForTimeout(ms)
const waitFor = (page, expression) => page.waitForFunction(expression, undefined, { timeout: 5000 })

const readLayout = (page) => page.evaluate(() => {
  const rectOf = (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  }
  const cap = document.querySelector('.dsws-capsule')
  const wrap = cap && cap.parentElement
  const bug = document.querySelector('.dsws-bugmenu')
  const bridge = document.querySelector('.dsws-skillpop-bridge')
  const pop = document.querySelector('.dsws-skillpop')
  const target = bug || pop
  const hit = target
    ? document.elementFromPoint(target.getBoundingClientRect().left + target.getBoundingClientRect().width / 2, target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2)
    : null
  return {
    wrapper: wrap ? { rect: rectOf(wrap), overflow: getComputedStyle(wrap).overflow } : null,
    capsule: cap ? rectOf(cap) : null,
    bug: bug ? { rect: rectOf(bug), parentIsBody: bug.parentElement === document.body } : null,
    bridge: bridge ? { rect: rectOf(bridge), parentIsBody: bridge.parentElement === document.body } : null,
    pop: pop ? { rect: rectOf(pop), parentIsBody: pop.parentElement === document.body || pop.parentElement.parentElement === document.body } : null,
    hitInsideTarget: !!(hit && target && (hit === target || target.contains(hit))),
    hitTag: hit ? hit.tagName + '.' + String(hit.className || '').split(' ').join('.') : null,
  }
})

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--start-maximized'] })
  try {
    const context = await browser.newContext({ viewport: null })
    await context.addInitScript(() => {
      try { localStorage.setItem('dsws.cfg', JSON.stringify({ withWayfinder: true, openIn: 'sidebar' })) } catch (e) { /* ignore */ }
    })
    const page = await context.newPage()
    let healthy = false
    for (let attempt = 1; attempt <= 6; attempt++) {
      if (attempt === 1) await page.goto(DSH, { waitUntil: 'domcontentloaded', timeout: 40000 })
      else await page.reload({ waitUntil: 'domcontentloaded' })
      await wait(page, 4500)
      healthy = await page.evaluate(() => !((document.body && document.body.innerText) || '').includes('Failed to load plugins') && !!document.querySelector('.dsws-capsule'))
      if (healthy) break
    }
    assert(healthy, 'DSH page did not load the deck capsule')

    const wrapperBefore = await page.evaluate(() => {
      const rectOf = (el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
      }
      const cap = document.querySelector('.dsws-capsule')
      const wrap = cap && cap.parentElement
      return wrap ? { overflow: getComputedStyle(wrap).overflow, rect: rectOf(wrap) } : null
    })
    assert(wrapperBefore && wrapperBefore.overflow === 'hidden', 'layout wrapper lost overflow:hidden protection')

    const skillPoint = await page.evaluate(() => {
      const el = document.querySelector('.dsws-skillbtn')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    assert(skillPoint, 'skill trigger not found')
    await page.mouse.move(skillPoint.x, skillPoint.y, { steps: 8 })
    await waitFor(page, () => !!document.querySelector('.dsws-skillpop'))
    const skillState = await readLayout(page)
    assert(skillState.bridge && skillState.pop, 'skill popup did not render globally')
    assert(skillState.bridge.parentIsBody, 'skill popup bridge is still inside the clipped subtree')
    assert((await page.locator('.dsws-skillpop').innerText()).includes('ask-matt'), 'skill popup is missing ask-matt label')
    assert(skillState.pop.rect.y < skillState.wrapper.rect.y, 'skill popup did not expand above the wrapper')
    assert(skillState.hitInsideTarget, 'skill popup center is not hit-testable')

    // Move through the portal bridge to a row; the delayed close must preserve the menu.
    const firstRow = await page.evaluate(() => {
      const el = document.querySelector('.dsws-skillpop > div')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    assert(firstRow, 'skill popup has no first row')
    await page.mouse.move(firstRow.x, firstRow.y, { steps: 8 })
    await waitFor(page, () => !!document.querySelector('.dsws-skillpop'))
    const bridged = await readLayout(page)
    assert(bridged.pop, 'skill popup closed while crossing trigger-to-portal bridge')
    await page.locator('.dsws-skillpop > div').first().click()
    await waitFor(page, () => !document.querySelector('.dsws-skillpop'))
    const draft = await page.locator('textarea.uV2eYG_input').inputValue()
    assert(draft.includes('/ask-matt'), 'clicking ask-matt did not inject its command into the input')
    await page.locator('textarea.uV2eYG_input').fill('')

    // Move to the BUG segment and verify the second overlay follows the same contract.
    const bugPoint = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('.dsws-capsule [data-fold-priority]')).find((x) => (x.textContent || '').trim().startsWith('BUG'))
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    assert(bugPoint, 'BUG trigger not found')
    await page.mouse.move(bugPoint.x, bugPoint.y, { steps: 8 })
    await waitFor(page, () => !!document.querySelector('.dsws-bugmenu') && !document.querySelector('.dsws-skillpop'))
    const bugState = await readLayout(page)
    assert(!bugState.bridge && !bugState.pop, 'skill popup remained after moving to BUG trigger')
    assert(bugState.bug, 'BUG popup did not render globally')
    assert((await page.locator('.dsws-bugmenu').innerText()).includes('新增'), 'BUG popup is missing 新增 label')
    assert(bugState.bug.parentIsBody, 'BUG popup is still inside the clipped subtree')
    assert(bugState.bug.rect.y < bugState.wrapper.rect.y, 'BUG popup did not expand above the wrapper')
    assert(bugState.hitInsideTarget, 'BUG popup center is not hit-testable')

    await page.screenshot({ path: OUT + '/pass.png', fullPage: false })
    console.log('PASS issue #22 real Chrome')
    console.log(JSON.stringify({ wrapper: wrapperBefore, skill: skillState, bridged, bug: bugState }, null, 2))
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error('FAIL issue #22 real Chrome:', error.message)
  process.exitCode = 1
})
