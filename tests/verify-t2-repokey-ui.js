// verify-t2-repokey-ui.js — #42 T2 真机验证（增强版）
// 完整 dsh-plugin-ui-debug 流程：健康重试 → workspace 切换 → 会激活 → capsule 点击 → 断言
// 依赖：DSH GUI 已在 http://127.0.0.1:59519 运行；本机 git/playwright/chrome 已安装。
// 用法：node tests/verify-t2-repokey-ui.js [outDir]

const { chromium } = require('playwright')
const fsx = require('fs')
const fsp = fsx.promises
const path = require('path')

const DSH = process.env.DSH_URL || 'http://127.0.0.1:59519/'
const TARGET_WS_NAME = 'dsh-im'
const OUT = process.argv[2] || path.join(process.cwd(), '.dsh-mattskillsdeck-cache', 'shots-t2')

const sleep = ms => new Promise(res => setTimeout(res, ms))

async function main() {
  await fsp.mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--start-maximized'],
    timeout: 60000,
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()

  // === 健康检查（含 6 次重试）===
  let healthy = false
  for (let attempt = 1; attempt <= 6; attempt++) {
    if (attempt === 1) await page.goto(DSH, { waitUntil: 'domcontentloaded', timeout: 40000 })
    else await page.reload({ waitUntil: 'domcontentloaded' })
    await sleep(5000)
    healthy = await page.evaluate(() => {
      const body = document.body && document.body.innerText || ''
      if (body.indexOf('Failed to load plugins') >= 0) return false
      return true
    })
    if (healthy) break
    console.log('  健康重试 #' + attempt)
  }
  if (!healthy) { console.error('  ✗ 6 次重试后仍未健康'); await browser.close(); process.exit(1) }
  console.log('  ✓ 健康检查通过')
  await page.screenshot({ path: path.join(OUT, '01-main.png'), fullPage: false })

  // === Step 1: 切换 workspace 到 dsh-im ===
  console.log('\\n--- Step 1: 切换 workspace 到 dsh-im ---')
  const wsList = await page.evaluate((name) => {
    const cands = Array.from(document.querySelectorAll('button, a, li, [role=button], div[role=treeitem], div[role=option]'))
    return cands.map(function (e) {
      const r = e.getBoundingClientRect()
      return {
        tag: e.tagName,
        text: (e.textContent || '').trim().slice(0, 60),
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
        w: Math.round(r.width),
        h: Math.round(r.height),
        visible: r.width > 0 && r.height > 0,
      }
    }).filter(e => e.visible && (e.text === name || e.text.startsWith(name + '\n') || e.text.startsWith(name + ' ')))
  }, TARGET_WS_NAME)
  console.log('  dsh-im 候选 (' + wsList.length + ')：')
  wsList.forEach(function (e, i) { console.log('    #' + i + ' tag=' + e.tag + ' text="' + e.text.replace(/\n/g, '\\n') + '" @(' + e.x + ',' + e.y + ') ' + e.w + 'x' + e.h) })
  if (wsList.length === 0) {
    console.error('  ✗ 未找到 dsh-im workspace 入口')
    await page.screenshot({ path: path.join(OUT, 'debug-no-dshim.png'), fullPage: false })
    await browser.close()
    process.exit(1)
  }
  const wsTarget = wsList[0]
  console.log('  切换：点击 dsh-im @(' + wsTarget.x + ',' + wsTarget.y + ')')
  await page.mouse.click(wsTarget.x, wsTarget.y)
  await sleep(4000)
  await page.screenshot({ path: path.join(OUT, '02-after-ws-click.png'), fullPage: false })

  // === Step 2: 激活会话（点击激活的子 session）===
  // workspace 展开后，找到该 workspace 下的最新会话并点击
  console.log('\\n--- Step 2: 激活子会话 ---')
  // 找 workspace 下第一条「进行中」或最新创建的会话
  const subSession = await page.evaluate((wsName) => {
    // 找 workspace 标题（包含 wsName 的元素）
    const all = Array.from(document.querySelectorAll('div, li, a, button, span'))
      .filter(e => e.offsetWidth > 0 && e.offsetHeight > 0)
    // 找包含 wsName 的 div / li（workspace 根容器）
    let wsContainer = null
    for (const e of all) {
      if ((e.textContent || '').trim().startsWith(wsName) && e.children.length > 0) {
        // 选层级最浅（最近）
        wsContainer = e
        break
      }
    }
    if (!wsContainer) return null
    // 在 wsContainer 树下找所有可点击子项
    const items = Array.from(wsContainer.querySelectorAll('div, li, a, button'))
      .filter(e => {
        const r = e.getBoundingClientRect()
        return r.width > 10 && r.height > 10
      })
      .filter(e => {
        const t = (e.textContent || '').trim()
        return t.length > 0 && t.length < 100
      })
    // 找第一个看似会话的（不是 workspace 本身）
    const sessionItems = items.filter(e => !/^dsh-im$/.test((e.textContent || '').trim()))
    return sessionItems.slice(0, 5).map(e => {
      const r = e.getBoundingClientRect()
      return { text: (e.textContent || '').trim().slice(0, 40), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })
  }, TARGET_WS_NAME)
  if (subSession && subSession.length > 0) {
    console.log('  子会话候选：')
    subSession.forEach(function (s, i) { console.log('    #' + i + ' "' + s.text + '" @(' + s.x + ',' + s.y + ')') })
    const subTarget = subSession[0]
    console.log('  激活：点击子会话 "' + subTarget.text + '" @(' + subTarget.x + ',' + subTarget.y + ')')
    await page.mouse.click(subTarget.x, subTarget.y)
    await sleep(4000)
  } else {
    console.log('  ⚠ 未找到子会话，尝试点 workspace header 直接展开')
    await page.mouse.click(wsTarget.x, wsTarget.y)
    await sleep(3000)
  }
  await page.screenshot({ path: path.join(OUT, '03-sub-session-activated.png'), fullPage: false })

  // === Step 3: 激活 session input ===
  console.log('\\n--- Step 3: 激活 session input ---')
  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('textarea, [contenteditable=true]'))
      .filter(e => {
        const r = e.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      })
      .map(e => {
        const r = e.getBoundingClientRect()
        return { tag: e.tagName, ce: e.getAttribute('contenteditable'), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }
      })
  })
  console.log('  可见输入框 (' + inputs.length + ')：')
  inputs.forEach(function (i, idx) { console.log('    #' + idx + ' tag=' + i.tag + ' ce=' + i.ce + ' @(' + i.x + ',' + i.y + ') ' + i.w + 'x' + i.h) })
  const inp = inputs[inputs.length - 1]  // 选最下方（消息输入框）
  if (inp) {
    console.log('  点击输入框 @(' + inp.x + ',' + inp.y + ')')
    await page.mouse.click(inp.x, inp.y)
    await sleep(2500)
  }
  await page.screenshot({ path: path.join(OUT, '04-input-active.png'), fullPage: false })

  // === Step 4: 打开 MattSkills 面板（点击 capsule 容器）===
  console.log('\\n--- Step 4: 打开 MattSkills 面板 ---')
  let panelReady = false
  for (let clickAttempt = 1; clickAttempt <= 3; clickAttempt++) {
    const targetInfo = await page.evaluate(() => {
      const cap = document.querySelector('.dsws-capsule')
      if (cap) {
        const r = cap.getBoundingClientRect()
        const cx = Math.round(r.x + r.width / 2)
        const cy = Math.round(r.y + r.height / 2)
        const topEl = document.elementFromPoint(cx, cy)
        const topElPath = topEl ? (topEl.tagName + '.' + (topEl.className || '').toString().split(' ').slice(0, 3).join('.')) : 'null'
        // 广查 panel 候选：dsws-panel / dsws-host / better-sidebar 内部 / 等
        const panelCount = document.querySelectorAll('.dsws-panel').length
        const aggrowCount = document.querySelectorAll('.dsws-aggrow').length
        const chipCount = document.querySelectorAll('[data-repo-chip]').length
        return {
          kind: 'capsule',
          x: cx,
          y: cy,
          w: Math.round(r.width),
          h: Math.round(r.height),
          topEl: topElPath,
          isCapsuleInPath: !!(topEl && (topEl === cap || cap.contains(topEl))),
          segCount: document.querySelectorAll('.dsws-seg').length,
          panelCount: panelCount,
          aggrowCount: aggrowCount,
          chipCount: chipCount,
        }
      }
      return { kind: 'none' }
    })
    console.log('  attempt=' + clickAttempt + ' ' + JSON.stringify(targetInfo))
    if (targetInfo.kind === 'capsule') {
      // 优先用 .click() 直接调用 React 元素的 onClick
      const dispatchResult = await page.evaluate(() => {
        const cap = document.querySelector('.dsws-capsule')
        if (!cap) return 'no-capsule'
        try {
          cap.click()
          return 'native-click'
        } catch (e) { return 'err:' + e.message }
      })
      console.log('  dispatched: ' + dispatchResult)
      if (targetInfo.isCapsuleInPath) {
        await page.mouse.click(targetInfo.x, targetInfo.y)
      }
      await sleep(3000)
    }
    // 多重 panel 检测
    panelReady = await page.evaluate(() => {
      return document.querySelectorAll('.dsws-panel').length > 0 ||
        document.querySelectorAll('.dsws-aggrow').length > 0 ||
        document.querySelectorAll('[data-repo-chip]').length > 0
    })
    if (panelReady) { console.log('  ✓ 面板/内容已渲染（多重检测通过）'); break }
  }
  if (!panelReady) {
    console.error('  ✗ 3 次重试后仍未能打开面板')
    await page.screenshot({ path: path.join(OUT, 'debug-no-panel.png'), fullPage: false })
    await browser.close()
    process.exit(1)
  }
  await page.screenshot({ path: path.join(OUT, '05-panel-open.png'), fullPage: false })

  // === Step 5: 读 DOM 断言 ===
  const readings = await page.evaluate(() => {
    const chip = document.querySelector('[data-repo-chip]')
    const chipText = chip && chip.querySelector('[data-repo-text]')
    const repoHref = chip && chip.getAttribute('href')
    const rows = Array.from(document.querySelectorAll('.dsws-aggrow')).slice(0, 15).map(function (r) {
      const idnum = r.querySelector('.dsws-idnum')
      const link = r.querySelector('a[href*="github.com/"][href*="/issues/"]')
      const titleEl = r.querySelector('span:not(.dsws-idnum)')
      return {
        numberText: idnum ? idnum.textContent.trim() : '',
        href: link ? link.getAttribute('href') : '',
        title: titleEl ? titleEl.textContent.trim().slice(0, 60) : '',
      }
    })
    return { chipText: chipText ? chipText.textContent.trim() : null, repoHref: repoHref, rows: rows }
  })

  console.log('\\n=== DOM 读数 ===')
  console.log('  repo chip text :', readings.chipText)
  console.log('  repo chip href :', readings.repoHref)
  console.log('  issue rows (前 15):')
  readings.rows.forEach(function (r, i) {
    console.log('    #' + (i + 1) + ' ' + r.numberText + '  ' + r.title.slice(0, 30) + '  href=' + r.href)
  })
  await page.screenshot({ path: path.join(OUT, '06-final.png'), fullPage: false })

  // === Step 6: 断言 ===
  const checks = []
  const expect = (name, cond, extra) => {
    checks.push({ name, pass: !!cond, extra: extra || '' })
    if (cond) console.log('  ✓ ' + name)
    else console.error('  ✗ ' + name + (extra ? ' :: ' + extra : ''))
  }
  // repo chip 验收
  expect('repo chip 文本包含 dsh-im (FeatherHunter/dsh-im)', readings.chipText && readings.chipText.indexOf('dsh-im') >= 0, 'got=' + readings.chipText)
  expect('repo chip href = Fork URL', readings.repoHref && /FeatherHunter\/dsh-im$/.test(readings.repoHref), 'got=' + readings.repoHref)
  // 列表归属：用 href 前缀判断（panel 渲染时的归属 = repoStr(st)，即 snapshot.repo）
  const forkHrefPrefix = 'https://github.com/FeatherHunter/dsh-im/issues/'
  const upstreamHrefPrefix = 'https://github.com/xmanrui/dsh-im/issues/'
  const forkRows = readings.rows.filter(r => r.href && r.href.indexOf(forkHrefPrefix) === 0)
  const upstreamRows = readings.rows.filter(r => r.href && r.href.indexOf(upstreamHrefPrefix) === 0)
  console.log('\\n  列表归属（按 href）：Fork=' + forkRows.length + '  upstream=' + upstreamRows.length)
  expect('issue 列表所有 href 都指向 Fork（panel 渲染正确）', upstreamRows.length === 0, 'upstream=' + upstreamRows.length + ' rows=' + readings.rows.filter(r => r.href).length)
  expect('issue 列表至少 1 行 href 归属 Fork', forkRows.length >= 1, 'fork=' + forkRows.length)
  // 显示行数
  expect('列表至少渲染 5 行 issue', readings.rows.length >= 5, 'rows=' + readings.rows.length)

  await browser.close()
  const failed = checks.filter(c => !c.pass)
  console.log('\\nTOTAL ' + checks.length + ' PASS ' + (checks.length - failed.length) + ' FAIL ' + failed.length)
  console.log('截图：' + OUT)
  process.exit(failed.length === 0 ? 0 : 1)
}
main().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2) })