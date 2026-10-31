#!/usr/bin/env node
/**
 * verify-1586-vc-visual-browser.ts —— 版本管理页骨架的真浏览器门禁（规格 #1586 T03 / #1738）
 *
 * 为什么要真浏览器：四档宽（300 / 380 / 460 / 520）不出横向溢出、页签仍排一行四个、
 *   关键句子不被截断，这三件事全在布局上，renderToStaticMarkup 与 jsdom 都量不出来。
 *
 * 做法（照 verify-997-vc-sight-browser.ts 的同一套手法）：把共享层能力账本与页面壳依赖的
 *   客户端叶子按 scripts/build.mts 的顺序拼成闭包，用真 React + 真 Chromium 渲染，
 *   外面套一个按档宽设好的 viewport，量像素。
 *
 * 五组判据：
 *   A. 管理页九分区：维护页的齿轮索引恰好九个按钮、顺序等于 VC_MANAGE_PAGES；
 *   B. 四档宽 × 两皮肤：每档每皮肤都渲染得出来，根节点读数（页面 / 档宽 / 皮肤 / 层级）对；
 *   C. 不横向溢出：文档 scrollWidth 不超过 viewport，且所有可见后代的左右边界都在根节点之内；
 *   D. 排布不退化：页签四个排在同一行、每条能力恰有一个 data-cap-primary、四态与三种形态都在、
 *      关键句子（页标题、能力清单标题、禁用原因、13.14 说明、命令面板标题）不被截断；
 *   E. 命令面板：搜索页输入框在、命中行带 data-cap-secondary、按 id / 名称 / 命令原文都能搜到，
 *      搜不到时画空态；面板本身也不横向溢出。
 * 反证（仓库纪律：每道门禁带一条）：给根节点强加 minWidth 640px 之后，300 宽必须量出横向溢出 ——
 *   量尺子测不出「真的坏了」就说明它没有证据力。
 *
 * 截图写 .scratch/1586-visual/（只给人看，不做像素门禁）。依赖：playwright（本机已装 headless shell）+ esbuild。
 */
'use strict'
const fs = require('fs')
const path = require('path')
const { createServer } = require('http')

const ROOT = path.resolve(__dirname, '..')
// 取源走共用入口（tests/lib/source-text.ts）：src/client 下同名 .js 是构建产物，
// 客户端叶子用 spliceableJs 按构建口径转译；shared 账本读 .build 产物（本文件反证锚点在客户端那片）。
const { spliceableJs, sourcePath } = require('./lib/source-text.ts')
const { printGateResult } = require('./lib/gate-result.ts')
let failed = false
let total = 0
const check = (ok: unknown, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const strip = (s: string): string => s.replace(/^(\s*)export\s+/gm, '$1')

// 闭包按构建顺序：共享账本 → 页面注册表 / 壳零件 / 命令面板 / 页面壳。
// 页面壳只读能力账本（CAPABILITIES / PAGE_SURFACES / PAGE_COUNTS / PRIMARY_ENTRY_PAGE），不碰 host。
const VC_FILES = [
  '.build/shared/version-control/capability-ledger.js',
  'src/client/views/versionControl/vcWrite.js',
  'src/client/views/versionControl/vcCapabilityPages.js',
  'src/client/views/versionControl/vcShellPrimitives.js',
  'src/client/views/versionControl/vcPalette.js',
  'src/client/views/versionControl/vcShellPages.js',
]

const WIDTHS = [300, 380, 460, 520]
const SKINS = ['dark', 'light']

// 页面脚本：把闭包装进真 React，暴露两个渲染入口与一把量尺（量尺只在页面里量，量完把数字带回 Node）。
function entryOf(closureSrc: string): string {
  return [
    "import React from 'react';",
    "import * as ReactDOMClient from 'react-dom/client';",
    'window.React = React; window.__RDOM__ = ReactDOMClient;',
    'const CLOSURE = window.__CLOSURE_SRC__;',
    'const DICT = window.__DICT__;',
    'const tr = (k, p) => {',
    '  const s = DICT[k]; if (s === undefined) return String(k);',
    '  if (!p) return s;',
    "  return String(s).replace(/\\{(\\w+)\\}/g, (m, name) => (p[name] === undefined || p[name] === null ? m : String(p[name])));",
    '};',
    "const fn = new Function('React', 'tr', CLOSURE + '\\nreturn { vcRenderTabAt: vcRenderTabAt, vcRenderAllPages: vcRenderAllPages, vcPageCapabilitiesOf: vcPageCapabilitiesOf, vcPageRegistryOf: vcPageRegistryOf, vcPaletteRowsOf: vcPaletteRowsOf, VC_MANAGE_PAGES: VC_MANAGE_PAGES, VC_SHELL_WIDTHS: VC_SHELL_WIDTHS };');",
    'const VC = fn(React, tr);',
    'window.__VC = VC;',
    'window.__renderPage = function (opts) {',
    "  const pane = document.getElementById('pane');",
    '  if (window.__root) { window.__root.unmount(); window.__root = null; }',
    "  pane.innerHTML = '';",
    '  window.__root = ReactDOMClient.createRoot(pane);',
    '  window.__root.render(VC.vcRenderTabAt(React.createElement, tr, opts));',
    '};',
    'window.__measure = function () {',
    "  const root = document.querySelector('[data-vc-shell]');",
    '  if (!root) return null;',
    '  const rr = root.getBoundingClientRect();',
    '  let maxRight = -1e9, minLeft = 1e9;',
    "  const els = root.querySelectorAll('*');",
    '  for (let i = 0; i < els.length; i += 1) {',
    '    const el = els[i];',
    '    const cs = window.getComputedStyle(el);',
    "    if (cs.display === 'none' || cs.visibility === 'hidden') continue;",
    '    const r = el.getBoundingClientRect();',
    '    if (r.width <= 0 && r.height <= 0) continue;',
    '    if (r.right > maxRight) maxRight = r.right;',
    '    if (r.left < minLeft) minLeft = r.left;',
    '  }',
    "  const keySel = ['.vcs-page-title', '.vcs-caps-title', '.vcs-state-why', '.vcs-note p', '.vcs-pal-title', '.vcs-pal-hint'];",
    '  const clipped = [];',
    "  const keys = root.querySelectorAll(keySel.join(','));",
    '  for (let i = 0; i < keys.length; i += 1) {',
    '    const el = keys[i];',
    '    if (el.scrollWidth > el.clientWidth + 1) clipped.push(String(el.className));',
    '  }',
    '  const grab = (sel, attr) => { const out = []; root.querySelectorAll(sel).forEach((el) => out.push(el.getAttribute(attr))); return out; };',
    "  const tabs = root.querySelectorAll('[role=\"tab\"]');",
    '  const tabTops = [];',
    '  tabs.forEach((el) => tabTops.push(Math.round(el.getBoundingClientRect().top)));',
    '  return {',
    "    page: root.getAttribute('data-vc-page'), width: root.getAttribute('data-vc-width'),",
    "    skin: root.getAttribute('data-vc-skin'), depth: root.getAttribute('data-vc-depth'),",
    '    docScrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,',
    '    rootRight: rr.right, rootLeft: rr.left, maxRight: maxRight, minLeft: minLeft,',
    '    tabTops: tabTops, tabCount: tabs.length,',
    "    primaries: grab('[data-cap-primary]', 'data-cap-primary'),",
    "    gear: grab('[data-vc-gear-item]', 'data-vc-gear-item'),",
    "    states: grab('[data-vc-state]', 'data-vc-state'),",
    "    forms: grab('[data-vc-form]', 'data-vc-form'),",
    "    palettes: grab('[data-cap-secondary]', 'data-cap-secondary'),",
    "    clipped: clipped, rows: root.querySelectorAll('.vcs-cap').length,",
    "    bg: window.getComputedStyle(root).backgroundColor,",
    "    hasIdentity: !!root.querySelector('[data-vc-identity]'),",
    "    hasSync: !!root.querySelector('[data-vc-sync]'),",
    "    hasSearch: !!root.querySelector('[data-vc-search-entry]'),",
    "    paletteInput: !!root.querySelector('[data-vc-palette-input]'),",
    "    paletteEmpty: !!root.querySelector('[data-vc-palette-empty]'),",
    '  };',
    '};',
    'window.__expectedPalette = function (q) { return window.__VC.vcPaletteRowsOf(q).map((r) => r.id); };',
    'window.__capsOf = function (p) { return window.__VC.vcPageCapabilitiesOf(p).map((c) => c.id); };',
    'window.__managePages = function () { return window.__VC.VC_MANAGE_PAGES.slice(); };',
    'window.__ready = true;',
  ].join('\n')
}

async function pageFor(browser: any, closureSrc: string, dict: any, css: string) {
  const esbuild = require('esbuild')
  const built = await esbuild.build({
    stdin: { contents: entryOf(closureSrc), resolveDir: ROOT, sourcefile: 'probe-1586.js', loader: 'js' },
    bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', write: false, logLevel: 'error',
  })
  const probeJs = String(built.outputFiles[0].text)
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head>' +
    '<body><div id="pane"></div>' +
    '<script>window.__CLOSURE_SRC__=' + JSON.stringify(closureSrc) + ';window.__DICT__=' + JSON.stringify(dict) + ';</script>' +
    '<script>' + probeJs + '</script></body></html>'
  const server = createServer((req: any, res: any) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html) })
  await new Promise((resolve: any) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const context = await browser.newContext({ viewport: { width: 520, height: 1200 } })
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' })
  await page.waitForFunction('window.__ready === true', null, { timeout: 20000 })
  return {
    page,
    close: async () => { await context.close().catch(() => undefined); await new Promise((resolve: any) => server.close(resolve)) },
  }
}

async function renderAt(page: any, opts: any) {
  await page.evaluate((o: any) => { window.__renderPage(o) }, opts)
  await page.waitForSelector('[data-vc-shell]', { timeout: 5000 })
  await page.waitForTimeout(120)
  return page.evaluate(() => window.__measure())
}

function overflowOf(m: any): boolean {
  return m.docScrollWidth > m.innerWidth + 1 || m.maxRight > m.rootRight + 1 || m.minLeft < m.rootLeft - 1
}

async function run(browser: any, env: any) {
  const { closure, dict, css } = env
  const shotDir = path.join(ROOT, '.scratch', '1586-visual')
  fs.mkdirSync(shotDir, { recursive: true })
  const { page, close } = await pageFor(browser, closure, dict, css)
  try {
    const managePages: string[] = await page.evaluate(() => window.__managePages())
    check(managePages.length === 9, '管理页齿轮索引的九个分区来自 VC_MANAGE_PAGES（实得 ' + managePages.length + ' 个）')
    const maintenanceCaps: string[] = await page.evaluate(() => window.__capsOf('maintenance'))
    check(maintenanceCaps.length === 10, '维护页负责的能力条数等于账本 PAGE_COUNTS.maintenance（实得 ' + maintenanceCaps.length + ' 条）')
    const bgOf: any = {}
    for (let s = 0; s < SKINS.length; s += 1) {
      const skin = SKINS[s]
      for (let w = 0; w < WIDTHS.length; w += 1) {
        const width = WIDTHS[w]
        const tag = '维护页 ' + skin + ' / ' + width + ' 宽'
        await page.setViewportSize({ width: width, height: 1200 })
        const m = await renderAt(page, { page: 'maintenance', width: width, skin: skin, open: { gear: true }, seed: { branch: 'main', remote: 'origin', when: '12 分钟前' } })
        check(m && m.page === 'maintenance' && m.width === String(width) && m.skin === skin && m.depth === '2', tag + '：根节点读数是维护页 / 档宽 / 皮肤 / 层级 2')
        check(!!m && !overflowOf(m), tag + '：没有横向溢出（文档 ' + (m && m.docScrollWidth) + ' ≤ viewport ' + (m && m.innerWidth) + '，后代右边界 ' + (m && m.maxRight) + ' ≤ 根右边界 ' + (m && m.rootRight) + '）')
        check(!!m && m.gear.join(',') === managePages.join(','), tag + '：齿轮九分区按 VC_MANAGE_PAGES 顺序排（' + (m && m.gear.join(',')) + '）')
        check(!!m && m.tabCount === 4 && m.tabTops.length === 4 && Math.max.apply(null, m.tabTops) - Math.min.apply(null, m.tabTops) <= 1, tag + '：四个页签排在同一行（行顶差 ≤1px）')
        check(!!m && m.primaries.length === maintenanceCaps.length && m.primaries.length === new Set(m.primaries).size && m.primaries.join(',') === maintenanceCaps.join(','), tag + '：每条能力恰有一个 data-cap-primary（' + (m && m.primaries.length) + ' 条）')
        check(!!m && m.states.join(',') === 'empty,loading,error,disabled', tag + '：四种状态按 empty/loading/error/disabled 各画一遍')
        check(!!m && m.forms.join(',') === 'inline,float,page', tag + '：三种表单形态按 inline/float/page 各画一遍')
        check(!!m && m.clipped.length === 0, tag + '：关键句子没有被截断（截断的：' + (m && m.clipped.join(',') || '无') + '）')
        check(!!m && m.hasIdentity && m.hasSync && m.hasSearch, tag + '：身份行、同步带、全库搜索入口都在')
        if (m) bgOf[skin] = m.bg
        await page.screenshot({ path: path.join(shotDir, 'maintenance-' + skin + '-' + width + '.png') })
      }
    }
    check(!!bgOf.dark && !!bgOf.light && bgOf.dark !== bgOf.light && bgOf.dark !== 'rgba(0, 0, 0, 0)', '两套皮肤各有自己的底色（深 ' + bgOf.dark + ' / 浅 ' + bgOf.light + '）')
    for (let s = 0; s < SKINS.length; s += 1) {
      const skin = SKINS[s]
      for (let w = 0; w < WIDTHS.length; w += 1) {
        const width = WIDTHS[w]
        const tag = '命令面板 ' + skin + ' / ' + width + ' 宽'
        await page.setViewportSize({ width: width, height: 1200 })
        const stashRows: string[] = await page.evaluate(() => window.__expectedPalette('stash'))
        let m = await renderAt(page, { page: 'search', width: width, skin: skin, seed: { query: 'stash' } })
        check(!!m && m.paletteInput && m.palettes.join(',') === stashRows.join(','), tag + '：搜 stash 的命中行与 vcPaletteRowsOf 一致（' + (m && m.palettes.length) + ' 行）且每行带 data-cap-secondary')
        check(!!m && !overflowOf(m), tag + '：命令面板也不横向溢出（' + (m && m.docScrollWidth) + ' ≤ ' + (m && m.innerWidth) + '）')
        const m1314 = await renderAt(page, { page: 'search', width: width, skin: skin, seed: { query: '13.14' } })
        check(!!m1314 && m1314.palettes.join(',') === '13.14', tag + '：按能力 id 搜 13.14 命中，结果显示所在页面')
        const byName = await page.evaluate(() => window.__VC.vcPaletteRowsOf(window.__VC.vcPageCapabilitiesOf('commits')[0].name).length)
        const mName = await renderAt(page, { page: 'search', width: width, skin: skin, seed: { query: '提交' } })
        check(byName > 0 && !!mName && mName.palettes.length > 0, tag + '：按名称 / 命令原文也能搜到（提交 命中 ' + (mName && mName.palettes.length) + ' 行）')
        const mNone = await renderAt(page, { page: 'search', width: width, skin: skin, seed: { query: 'zzz-没有这个能力' } })
        check(!!mNone && mNone.paletteEmpty === true && mNone.palettes.length === 0, tag + '：搜不到时画空态（data-vc-palette-empty）')
        if (width === 300 || width === 520) await page.screenshot({ path: path.join(shotDir, 'palette-' + skin + '-' + width + '.png') })
      }
    }
  } finally {
    await close()
  }
}

;(async () => {
  const locUrl = (f: string) => 'file://' + path.join(ROOT, sourcePath(f)).replace(/\\/g, '/')
  const shellLoc = await import(locUrl('src/client/kernel/locale-vcshell.js'))
  const vcw = await import(locUrl('src/client/kernel/locale-vcwrite.js'))
  const dict = Object.assign({}, shellLoc.L_VCSHELL.zh, vcw.L_VCWRITE.zh)
  const stylesMod = await import('file://' + path.join(ROOT, 'src/client/views/versionControl/vcShellStyles.ts').replace(/\\/g, '/'))
  const css = 'html,body{margin:0;padding:0}#pane{width:100%}' + String(stylesMod.VC_SHELL_STYLE_TEXT || '')

  const closure = VC_FILES.map((f: string) => (f.indexOf('src/client/') === 0 ? spliceableJs(f) : strip(read(f)))).join('\n')
  const { getBrowser, closeBrowser } = require('./lib/browser-pool.js')
  const browser = await getBrowser({ headless: true })
  try {
    await run(browser, { closure, dict, css })
    // 反证：给根节点强加 640px 最小宽度，同样的量尺在 300 宽必须量出横向溢出。
    // spliceableJs 转译后属性名与字符串都是双引号，锚点按转译后的写法写（改法落不到源码上等于没证）。
    const anchor = '"data-vc-shell": "1",'
    check(closure.split(anchor).length === 2, '反证自证：闭包里根节点标记只出现一处，改法真的改得到')
    const broken = closure.replace(anchor, anchor + " style: { minWidth: '640px' },")
    check(broken !== closure && broken.indexOf("minWidth: '640px'") > 0, '反证自证：闭包被改坏之后文本确实变了')
    const brokenPage = await pageFor(browser, broken, dict, css)
    try {
      await brokenPage.page.setViewportSize({ width: 300, height: 1200 })
      const bm = await renderAt(brokenPage.page, { page: 'maintenance', width: 300, skin: 'dark', open: { gear: true } })
      check(!!bm && bm.docScrollWidth > bm.innerWidth + 1, '反证：根节点被强制加宽后，300 宽必须测出横向溢出（scrollWidth ' + (bm && bm.docScrollWidth) + ' > 300）')
    } finally { await brokenPage.close() }
  } finally {
    await closeBrowser()
  }
  printGateResult('verify-1586-vc-visual-browser', total, failed ? 1 : 0)
  console.log('')
  if (failed) { console.log('存在失败 — verify-1586-vc-visual-browser 未通过（' + total + ' 项断言）'); process.exit(1) }
  console.log('全部通过 — 版本管理页骨架的真浏览器门禁生效（' + total + ' 项断言）')
})().catch((e: any) => {
  console.log('  FAIL 门禁自身抛错：' + String((e && e.stack) || e))
  process.exit(1)
})
