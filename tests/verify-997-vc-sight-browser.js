#!/usr/bin/env node
/**
 * verify-997-vc-sight-browser.js —— 「滑到那句提示就接着显示」的真浏览器门禁（#997 落地）
 *
 * 为什么要真浏览器：这件事的行为全在「节点有没有进入视野」与「插入新行之后用户的画面会不会跳」上，
 *   而仓库既有的渲染门禁走的是 renderToStaticMarkup —— effect 根本不执行（这也是原来那段自动续读
 *   一直没有门禁覆盖的原因）。jsdom 既没有布局也没有 IntersectionObserver，量不出这件事。
 *
 * 做法（照 .tmp-842-visual/shot.mjs 那套预览手法，改成常驻门禁）：把界面侧那些叶子按 scripts/build.mjs
 *   同一顺序拼成闭包，用真 React + 真 Chromium 渲染，外面套一个高度固定的滚动容器（模拟面板那一层），
 *   假 host 只负责把状态回包递进来（不连真 git）。
 *
 * 三条判据：
 *   A. 短面板（那句提示在首屏以下）：滚到底看见那句话 → 行数自己从 10 涨到 20；再滚又看见 → 涨到 30；
 *      全程一次都不点。画到没有更多时那句话本身消失。
 *   B. 画完一批之后用户的画面不跳：新行插在这句话之前，用户原先看的那几行必须原地不动。
 *   C. 长面板（这句话首屏就看得见）：不滚也会接着显示，而且会停（画到它被挤出视野或没有更多为止）。
 * 反证（仓库纪律：每道门禁必须带一条）：把三处 ref 接线摘掉，同样的滚动步骤必须一行都不涨 —— 门禁当场变红。
 *
 * 依赖：playwright（含 chromium，本机已装 headless shell）+ esbuild（开发依赖）。
 */
'use strict'
const fs = require('fs')
const path = require('path')
const { createServer } = require('http')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const strip = (s) => s.replace(/^(\s*)export\s+/gm, '$1')

const VC_FILES = [
  'src/shared/version-control/rules.js',
  'src/client/views/versionControl/vcText.js', 'src/client/views/versionControl/vcFold.js',
  'src/client/views/versionControl/vcDiff.js', 'src/client/views/versionControl/vcCommit.js',
  'src/client/views/versionControl/vcRows.js', 'src/client/views/versionControl/vcWrite.js',
  'src/client/views/versionControl/vcWriteRun.js', 'src/client/views/versionControl/vcWriteUi.js',
  'src/client/views/versionControl/vcWriteOps.js', 'src/client/views/versionControl/vcWriteView.js',
  'src/client/views/versionControl/vcDiffOps.js',
  'src/client/views/versionControl/vcBlocks.js', 'src/client/views/versionControl/vcViews.js',
  'src/client/views/versionControl/vcAiHandoff.js', 'src/client/views/versionControl/vcTabVisible.js',
  'src/client/views/versionControl/vcData.js', 'src/client/views/versionControl/vcCache.js',
  'src/client/views/versionControl/vcInView.js',
  'src/client/views/versionControl/VersionControlTab.js',
]

// 夹具：40 个未暂存文件 —— 首屏画 10 行，那句提示说「另有 30 个文件」。
const FILE_COUNT = 40
const files = []
for (let i = 0; i < FILE_COUNT; i++) {
  const n = String(i + 2).padStart(2, '0')
  files.push({ path: 'issues/' + n + '-untitled.md', origPath: null, staged: false, unstaged: true, conflict: false, change: 'added', addedLines: i + 1, deletedLines: 0 })
}
const SCREEN = {
  identity: { worktreeDisplay: 'repo', worktreePath: 'D:/w/repo', branch: 'main', detached: false, oid: 'a'.repeat(40), sync: 'tracked-known', ahead: 0, behind: 0, basisMs: null },
  staged: [], unstaged: files, stagedCount: 0, unstagedCount: FILE_COUNT, conflictCount: 0,
  otherWorktrees: [], branches: [{ short: 'main', upstream: 'origin/main', upstreamGone: false }],
  commits: [], repo: { merging: false, rebasing: false, cherryPicking: false, reverting: false, hasCommits: true, bare: false, tier: 'full', autocrlf: null },
}

function entryOf(closureSrc, dict) {
  return `
import React from 'react'
import * as ReactDOMClient from 'react-dom/client'
window.React = React
window.__RDOM__ = ReactDOMClient
const CLOSURE = window.__CLOSURE_SRC__
const DICT = window.__DICT__
const NOW = window.__NOW__
const tr = (k, p) => { const s = DICT[k] !== undefined ? DICT[k] : k; return p ? String(s).replace(/\\{(\\w+)\\}/g, (m, x) => (x in p ? String(p[x]) : m)) : String(s) }
const fn = new Function('React', 'tr', 'host', 'log', 'dswsLogHash', 'dswsLogTrunc', 'DswsCtx', 'Tip', CLOSURE + '\\nreturn { VersionControlTab }')
const DswsCtx = React.createContext(null)
const Tip = (props) => React.createElement('span', { title: props && props.content ? String(props.content) : '', style: { display: 'contents' } }, props && props.children)
let state = { screen: null, calls: [] }
window.host = { call: async (method, args) => {
  state.calls.push(method)
  if (method === 'wf.gitStatus') return { ok: true, screen: state.screen, tier: 'full', gitVersion: 'git version 2.49.0', readAtMs: NOW }
  if (method === 'wf.gitLog') return { ok: true, commits: [], hasMore: false }
  if (method === 'wf.gitDiff') return { ok: true, lines: [], reason: 'ok', truncated: false }
  return { ok: false, error: { kind: 'shape', message: '未预置的回包：' + method } }
} }
const VC = fn(React, tr, window.host, () => {}, (s) => 'h8', (s) => String(s), DswsCtx, Tip)
window.__render = function (opts) {
  document.body.setAttribute('data-ds-dark-theme', '')
  state.screen = window.__SCREEN__
  state.calls = []
  const pane = document.getElementById('pane')
  pane.style.width = '520px'
  pane.style.height = opts.height + 'px'
  pane.scrollTop = 0
  pane.innerHTML = ''
  const box = document.createElement('div')
  pane.appendChild(box)
  window.__RDOM__.createRoot(box).render(React.createElement(VC.VersionControlTab, { st: { cwd: 'D:/w/repo' }, narrow: false }))
  return true
}
// 量尺（都在页面里量，不猜）：画了多少行、那句提示写的什么、用户画面最上面那一行是谁、滚动位置多少。
window.__probe__ = function () {
  const pane = document.getElementById('pane')
  const rows = Array.prototype.slice.call(pane.querySelectorAll('[data-vc-file]'))
  const links = Array.prototype.slice.call(pane.querySelectorAll('.dsws-vc-link'))
  const paneTop = pane.getBoundingClientRect().top
  let topRow = ''
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect()
    if (r.bottom > paneTop + 1) { topRow = String(rows[i].textContent || '').slice(0, 24); break }
  }
  return { rows: rows.length, links: links.map((l) => String(l.textContent || '')), topRow: topRow, scrollTop: pane.scrollTop, scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight, calls: state.calls.slice() }
}
window.__scrollBottom__ = function () { const pane = document.getElementById('pane'); pane.scrollTop = pane.scrollHeight; return pane.scrollTop }
// 量「画下一批」这一刻，量的是**浏览器有没有替我们挪画面**：
//   用户滚到底（这是用户动作）→ 等新行插进来 → 在新行刚进 DOM、浏览器还没做任何补偿的那一微任务里读一次
//   滚动位置与最上面那一行，等这一批落定（120 毫秒）再读一次。两次一样 = 用户画面原地不动。
window.__scrollAndWatch__ = function () {
  const pane = document.getElementById('pane')
  const rowsOf = function () { return pane.querySelectorAll('[data-vc-file]').length }
  const topRowOf = function () {
    const rows = Array.prototype.slice.call(pane.querySelectorAll('[data-vc-file]'))
    const paneTop = pane.getBoundingClientRect().top
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect()
      if (r.bottom > paneTop + 1) return String(rows[i].textContent || '').slice(0, 24)
    }
    return ''
  }
  return new Promise(function (resolve) {
    const rowsBefore = rowsOf()
    pane.scrollTop = pane.scrollHeight
    const afterScroll = pane.scrollTop
    const done = function (atInsert, atInsertRows) {
      setTimeout(function () {
        try { mo.disconnect() } catch (e) {}
        resolve({
          rowsBefore: rowsBefore, afterScroll: afterScroll,
          atInsert: atInsert, atInsertTop: atInsertRows,
          settled: pane.scrollTop, settledTop: topRowOf(), rowsAfter: rowsOf(),
        })
      }, 120)
    }
    const mo = new MutationObserver(function () {
      if (rowsOf() <= rowsBefore) return
      try { mo.disconnect() } catch (e) {}
      done(pane.scrollTop, topRowOf())
    })
    mo.observe(pane, { childList: true, subtree: true })
    setTimeout(function () {
      if (rowsOf() > rowsBefore) return
      try { mo.disconnect() } catch (e) {}
      resolve({ rowsBefore: rowsBefore, afterScroll: afterScroll, atInsert: afterScroll, atInsertTop: '', settled: pane.scrollTop, settledTop: topRowOf(), rowsAfter: rowsOf(), timeout: true })
    }, 4000)
  })
}
window.__ready = true
`
}

async function pageFor(browser, closureSrc, dict, css) {
  const esbuild = require('esbuild')
  const bundled = await esbuild.build({ stdin: { contents: entryOf(closureSrc, dict), resolveDir: ROOT, sourcefile: 'probe-997.js', loader: 'js' }, bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', write: false, logLevel: 'error' })
  const probeJs = bundled.outputFiles[0].text
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>' + css +
    'html,body{margin:0}#pane{display:flex;flex-direction:column;overflow-y:auto;background:var(--dsw-alias-bg-base,#151517);padding:0 12px}' +
    '</style></head><body data-ds-dark-theme><div id="pane"></div>' +
    '<script>window.__SCREEN__=' + JSON.stringify(SCREEN) + ';window.__CLOSURE_SRC__=' + JSON.stringify(closureSrc) + ';window.__DICT__=' + JSON.stringify(dict) + ';window.__NOW__=' + Date.now() + ';</script>' +
    '<script>' + probeJs + '</script></body></html>'
  const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html) })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const context = await browser.newContext({ viewport: { width: 1200, height: 1400 } })
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'load' })
  await page.waitForFunction('window.__ready === true', null, { timeout: 10000 })
  return { page, close: async () => { await context.close(); await new Promise((r) => server.close(r)) } }
}

const settle = async (page, ms) => { await page.waitForTimeout(ms || 260) }
const probe = (page) => page.evaluate(() => window.__probe__())

async function run(browser, build) {
  const { page, close } = await pageFor(browser, build.closure, build.dict, build.css)
  try {
    // ---------- A. 短面板：滚到那句提示就自己接着显示 ----------
    await page.evaluate(() => window.__render({ height: 240 }))
    await page.waitForSelector('[data-vc-file]', { timeout: 5000 })
    await settle(page, 320)
    let p = await probe(page)
    check(p.rows === 10 && p.links.some((t) => t.indexOf('另有 30 个文件') >= 0), 'A1 短面板首屏画 10 行，那句提示说「另有 30 个文件」（实得 ' + p.rows + ' 行 / ' + JSON.stringify(p.links) + '）')
    check(p.scrollTop === 0 && p.scrollHeight > p.clientHeight + 40, 'A2 这句话确实在首屏以下（内容比容器高 ' + (p.scrollHeight - p.clientHeight) + ' 像素）')
    const callsBefore = p.calls.length

    await page.evaluate(() => window.__scrollBottom__())
    await settle(page, 420)
    const before = await probe(page)
    check(before.rows === 20, 'A3 滚到能看见那句话 → 不用点就画到 20 行（实得 ' + before.rows + '）')
    check(before.links.some((t) => t.indexOf('另有 20 个文件') >= 0), 'A4 那句话的数字跟着改（另有 20 个文件）：' + JSON.stringify(before.links))
    check(before.calls.length === callsBefore, 'A5 画下一批不发任何取数（宿主调用次数没变：' + before.calls.length + ' 次，' + JSON.stringify(before.calls) + '）')

    await page.evaluate(() => window.__scrollBottom__())
    await settle(page, 420)
    const third = await probe(page)
    check(third.rows === 30, 'A6 再往下滑又看见那句话 → 再画一批，到 30 行（实得 ' + third.rows + '）')

    await page.evaluate(() => window.__scrollBottom__())
    await settle(page, 420)
    const last = await probe(page)
    check(last.rows === 40, 'A7 画到最后：40 行全在了（实得 ' + last.rows + '）')
    check(!last.links.some((t) => t.indexOf('另有') >= 0), 'A8 没有更多时那句话本身消失（实得 ' + JSON.stringify(last.links) + '）')

    // ---------- B. 画完一批之后用户的画面不跳 ----------
    await page.evaluate(() => window.__render({ height: 240 }))
    await page.waitForSelector('[data-vc-file]', { timeout: 5000 })
    await settle(page, 320)
    await page.evaluate(() => window.__scrollBottom__())
    await settle(page, 420)
    const watch = await page.evaluate(() => window.__scrollAndWatch__())
    check(!watch.timeout && watch.rowsAfter > watch.rowsBefore, 'B1 再滚到那句话时确实又画了一批（' + watch.rowsBefore + ' → ' + watch.rowsAfter + '）')
    check(Math.abs(watch.settled - watch.atInsert) <= 2, 'B2 新行插进来之后浏览器没有替我们挪画面：滚动位置从插入那一刻到落定不变（插入 ' + watch.atInsert + ' / 落定 ' + watch.settled + '）')
    check(watch.atInsertTop !== '' && watch.settledTop === watch.atInsertTop, 'B3 用户原先看的那一行还在原地（插入时「' + watch.atInsertTop + '」/ 落定后「' + watch.settledTop + '」）')
    check(Math.abs(watch.atInsert - watch.afterScroll) <= 2, 'B4 插入之后滚动位置就是用户滚到底那一下的位置（滚到底 ' + watch.afterScroll + ' / 插入时 ' + watch.atInsert + '）')

    // ---------- C. 长面板：这句话首屏就看得见 ----------
    await page.evaluate(() => window.__render({ height: 1000 }))
    await page.waitForSelector('[data-vc-file]', { timeout: 5000 })
    await settle(page, 700)
    const c1 = await probe(page)
    check(c1.rows > 10, 'C1 长面板下这句话首屏就在视野里 → 不滚也会接着显示（实得 ' + c1.rows + ' 行）')
    await settle(page, 600)
    const c2 = await probe(page)
    await settle(page, 600)
    const c3 = await probe(page)
    check(c2.rows === c3.rows, 'C2 会停：没有更多或这句话被挤出视野之后就不再画（两次读数一致：' + c2.rows + ' / ' + c3.rows + '）')
    check(c3.rows <= FILE_COUNT, 'C3 不会画超过总行数（' + c3.rows + ' ≤ ' + FILE_COUNT + '）')
  } finally {
    await close()
  }
}

;(async () => {
  const panel = await import('file://' + path.join(ROOT, 'src/client/kernel/locale-panel.js').replace(/\\/g, '/'))
  const flow = await import('file://' + path.join(ROOT, 'src/client/kernel/locale-flow.js').replace(/\\/g, '/'))
  const vcw = await import('file://' + path.join(ROOT, 'src/client/kernel/locale-vcwrite.js').replace(/\\/g, '/'))
  const dict = Object.assign({}, panel.L_PANEL.zh, flow.L_FLOW.zh, vcw.L_VCWRITE.zh)
  const stylesMod = await import('file://' + path.join(ROOT, 'src/client/kernel/styles.js').replace(/\\/g, '/'))
  const stylesVcMod = await import('file://' + path.join(ROOT, 'src/client/views/versionControl/vcStyles.js').replace(/\\/g, '/'))
  const css = String(stylesMod.STYLE_TEXT || '') + String(stylesVcMod.VC_STYLE_TEXT || '')

  const closure = VC_FILES.map((f) => strip(read(f))).join('\n')
  const { chromium } = require('playwright')
  const browser = await chromium.launch({ headless: true })
  try {
    await run(browser, { closure, dict, css })
    // 反证：把三处 ref 接线摘掉，同样的滚动步骤必须一行都不涨。
    const broken = closure.replace(/ref: moreSight\.refOf\([^)]*\), /g, '')
    check(broken !== closure && broken.indexOf('moreSight.refOf') < 0, '反证自证：三处 ref 接线确实被摘掉了')
    const { page, close } = await pageFor(browser, broken, dict, css)
    try {
      await page.evaluate(() => window.__render({ height: 240 }))
      await page.waitForSelector('[data-vc-file]', { timeout: 5000 })
      await settle(page, 320)
      await page.evaluate(() => window.__scrollBottom__())
      await settle(page, 500)
      const r1 = await probe(page)
      await page.evaluate(() => window.__scrollBottom__())
      await settle(page, 500)
      const r2 = await probe(page)
      check(r1.rows === 10 && r2.rows === 10, '反证：接线摘掉之后，滚到那句话也不再接着显示（行数停在 ' + r1.rows + ' / ' + r2.rows + '）')
    } finally { await close() }
  } finally {
    await browser.close()
  }

  console.log('')
  if (failed) { console.log('存在失败 — verify-997-vc-sight-browser 未通过（' + total + ' 项断言）'); process.exit(1) }
  console.log('全部通过 — 「滑到那句提示就接着显示」真浏览器门禁生效（' + total + ' 项断言）')
})().catch((e) => {
  console.log('  FAIL 门禁自身抛错：' + String((e && e.message) || e))
  process.exit(1)
})
