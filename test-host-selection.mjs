import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [] })
const context = await browser.newContext()
const page = await context.newPage()
await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
const result = await page.evaluate(async () => {
  const tryHost = async (cwd) => {
    try {
      if (typeof host !== 'undefined' && host.call) {
        const r = await host.call('wf.selection', { cwd })
        return { ok: true, from: 'window.host', r }
      }
    } catch(e){ return { ok:false, err: String(e), from: 'window.host' } }
    try {
      // try to find host via DSH connection
      // look for any global that has host
      for (const k of Object.keys(window)){
        if (k.includes('host')) return { ok:false, err: 'found key '+k }
      }
      return { ok:false, err: 'host not found in window' }
    } catch(e){ return { ok:false, err: String(e)}}
  }
  const cwd = 'D:\\2Study\\StudyNotes'
  const r1 = await tryHost(cwd)
  // also try wf.registry
  let r2 = null
  try {
    if (typeof host !== 'undefined' && host.call) {
      const rr = await host.call('wf.registry', { cwd })
      r2 = { ok:true, rr }
    }
  } catch(e){ r2 = { ok:false, err: String(e)}}
  // also try to find iframe host
  const iframes = Array.from(document.querySelectorAll('iframe')).map(f=>f.src)
  return { r1, r2, iframes, body: document.body.innerText.slice(0,500) }
})
console.log(JSON.stringify(result,null,2))
await browser.close()
