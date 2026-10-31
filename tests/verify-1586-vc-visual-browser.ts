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
 *   F. 提交历史页（#1744 T09）：四档宽 × 两皮肤都画出列表、详情与逐文件差异、第 13.14 条图形化视图，
 *      各档宽按规格第 9 节增删行内信息（300 只留标题、380 补短号与图形车道、460 起补作者与时间），
 *      图形化视图不调用 gitk（门禁只认面板内自绘节点），且各档都不横向溢出。
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
  // #1744：首屏七片契约的产物（历史页的列表直接来自首屏快照的 history 片，不另造一条读取）。
  '.build/shared/version-control/first-screen.js',
  'src/client/views/versionControl/vcText.js',
  'src/client/views/versionControl/vcData.js',
  'src/client/views/versionControl/vcFirstScreen.js',
  'src/client/views/versionControl/vcWrite.js',
  'src/client/views/versionControl/vcCapabilityPages.js',
  'src/client/views/versionControl/vcShellPrimitives.js',
  'src/client/views/versionControl/vcPalette.js',
  'src/client/views/versionControl/vcHistory.js',
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
    // vcText.js 单独拼进闭包时，时窗常量在真机闭包里由共享层提供；这里从 time-config 真值挂到 window，
    // 闭包里的裸名在 new Function 的宽松作用域里读得到。
    'window.VC_RELATIVE_WINDOW_MS = window.__VC_REL_MS__;',
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
    // #1744 提交历史页：列表 / 详情 / 逐文件差异 / 13.14 图形化视图的读数。
    "    histState: (function () { const e = root.querySelector('[data-vc-history]'); return e ? e.getAttribute('data-vc-history-state') : null; })(),",
    "    histRows: root.querySelectorAll('[data-vc-history-row]').length,",
    "    histShorts: grab('[data-vc-history-short]', 'data-vc-history-short'),",
    "    histAuthors: root.querySelectorAll('[data-vc-history-author]').length,",
    "    histWhens: root.querySelectorAll('[data-vc-history-when]').length,",
    "    loadMore: root.querySelectorAll('[data-vc-load-more]').length,",
    "    graph: !!root.querySelector('[data-vc-graph]'),",
    "    graphRows: root.querySelectorAll('[data-vc-graph-row]').length,",
    "    graphNarrow: !!root.querySelector('[data-vc-graph-narrow]'),",
    "    graphExternal: root.querySelectorAll('[data-vc-graph-external]').length,",
    "    detail: !!root.querySelector('[data-vc-history-detail]'),",
    "    detailState: (function () { const e = root.querySelector('[data-vc-history-detail]'); return e ? e.getAttribute('data-vc-history-detail-state') : null; })(),",
    "    fileButtons: grab('[data-vc-history-file]', 'data-vc-history-file'),",
    "    diffPath: (function () { const e = root.querySelector('[data-vc-file-diff]'); return e ? e.getAttribute('data-vc-file-diff') : null; })(),",
    "    diffLines: grab('[data-vc-diff-line]', 'data-vc-diff-line'),",
    "    histClipped: (function () { const out = []; const sel = ['.vcs-hist-title', '.vcs-hist-budget', '.vcs-hist-subject', '.vcs-hist-detail-title', '.vcs-hist-graph-title', '.vcs-hist-graph-note', '.vcs-hist-diff-title']; root.querySelectorAll(sel.join(',')).forEach(function (el) { if (el.scrollWidth > el.clientWidth + 1) out.push(String(el.className)); }); return out; })(),",
    '  };',
    '};',
    'window.__expectedPalette = function (q) { return window.__VC.vcPaletteRowsOf(q).map((r) => r.id); };',
    'window.__capsOf = function (p) { return window.__VC.vcPageCapabilitiesOf(p).map((c) => c.id); };',
    'window.__managePages = function () { return window.__VC.VC_MANAGE_PAGES.slice(); };',
    'window.__ready = true;',
  ].join('\n')
}

async function pageFor(browser: any, closureSrc: string, dict: any, css: string, relMs: number) {
  const esbuild = require('esbuild')
  const built = await esbuild.build({
    stdin: { contents: entryOf(closureSrc), resolveDir: ROOT, sourcefile: 'probe-1586.js', loader: 'js' },
    bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', write: false, logLevel: 'error',
  })
  const probeJs = String(built.outputFiles[0].text)
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head>' +
    '<body><div id="pane"></div>' +
    '<script>window.__VC_REL_MS__=' + JSON.stringify(Number(relMs) || 0) + ';window.__CLOSURE_SRC__=' + JSON.stringify(closureSrc) + ';window.__DICT__=' + JSON.stringify(dict) + ';</script>' +
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

// ---------- 提交历史页（#1744 T09）的种子读数 ----------
// 四条提交：第二条是合并提交（两个父），最后一条是根提交（没有父）；列表数据来自首屏快照的
// history 片（不另造一条读首屏的路），详情与逐文件差异按打开的面另给。全部是普通对象，
// 能从 Node 侧传进页面（page.evaluate 只收可序列化参数）。
const HIST_NOW = Date.parse('2026-10-04T10:00:00+08:00')
const histOid = (i: number): string => ('0000000' + String(i + 1).toString(16)).slice(-8).repeat(5)
const HIST_ROWS: any[] = (function () {
  const out: any[] = []
  for (let i = 0; i < 4; i += 1) {
    out.push({
      oid: histOid(i), short: 'c' + (i + 1), author: '林可', email: 'linke@example.com',
      authorDateMs: HIST_NOW - (i + 1) * 60000, commitDateMs: HIST_NOW - (i + 1) * 60000,
      subject: '第 ' + (i + 1) + ' 次提交：把改动记下来', parents: i + 1 < 4 ? [histOid(i + 1)] : [],
    })
  }
  out[1].parents = [out[2].oid, out[3].oid]
  return out
})()
const histSliceOk = (data: any) => ({ state: 'ok', data: data, error: null })
function histSnapshotOf(hasMore: boolean) {
  return {
    contract: 'version-control.first-screen', version: 2, readAtMs: HIST_NOW,
    slices: {
      workspace: histSliceOk({ identity: null, repo: null, branches: [] }),
      changes: histSliceOk({ staged: [], unstaged: [], stagedCount: 0, unstagedCount: 0, conflictCount: 0 }),
      history: histSliceOk({ commits: HIST_ROWS, hasMore: hasMore === true }),
      worktrees: histSliceOk({ others: [], bare: false }),
      stashes: histSliceOk({ entries: [] }),
      sync: histSliceOk({ sync: 'no-upstream', ahead: 0, behind: 0, basisMs: null, upstream: null, remote: null, branch: 'main' }),
      version: histSliceOk({ gitVersion: 'git version 2.49.0', tier: 'full', switches: [] }),
    },
  }
}
const HIST_FILES = [
  { path: 'src/a.ts', origPath: null, added: 2, deleted: 1 },
  { path: '旧名.txt', origPath: '新名.txt', added: 0, deleted: 0 },
]
const HIST_REV = HIST_ROWS[1]
const HIST_DIFF_KEY = String(HIST_REV.oid) + '\u0000' + 'src/a.ts'
const HIST_DIFF_LINES = [
  { kind: 'filehead', text: 'diff --git a/src/a.ts' },
  { kind: 'hunk', text: '@@ -1 +1 @@' },
  { kind: 'add', text: '+新的一行' },
  { kind: 'del', text: '-旧的一行' },
  { kind: 'context', text: ' 没变的一行' },
]
const HIST_COMMIT_OK = { rev: HIST_REV.oid, seq: 1, state: 'ok', files: HIST_FILES, truncated: false, reason: 'ok', error: null }
function histReadsOf(extra: any) {
  const o = extra || {}
  const reads: any = {
    screen: { state: 'idle', data: null, error: null }, diffs: {},
    log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null },
    firstScreen: { state: 'ok', data: histSnapshotOf(true), error: null },
    commit: { rev: '', seq: 0, state: 'idle', files: [], truncated: false, reason: '', error: null },
    commitDiffs: {},
  }
  if (o.commit) reads.commit = o.commit
  if (o.commitDiffs) reads.commitDiffs = o.commitDiffs
  return reads
}

async function run(browser: any, env: any) {
  const { closure, dict, css, relMs } = env
  const shotDir = path.join(ROOT, '.scratch', '1586-visual')
  fs.mkdirSync(shotDir, { recursive: true })
  const { page, close } = await pageFor(browser, closure, dict, css, relMs)
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
    // ---- F 组：提交历史页（#1744 T09）——列表 / 详情 / 逐文件差异 / 13.14 图形化视图 ----
    for (let s = 0; s < SKINS.length; s += 1) {
      const skin = SKINS[s]
      for (let w = 0; w < WIDTHS.length; w += 1) {
        const width = WIDTHS[w]
        const tag = '提交历史页 ' + skin + ' / ' + width + ' 宽'
        await page.setViewportSize({ width: width, height: 1400 })
        const m = await renderAt(page, { page: 'commits', width: width, skin: skin, reads: histReadsOf(null) })
        check(!!m && m.page === 'commits' && m.width === String(width) && m.skin === skin && m.depth === '1', tag + '：根节点读数是提交历史页 / 档宽 / 皮肤 / 层级 1')
        check(!!m && !overflowOf(m), tag + '：没有横向溢出（文档 ' + (m && m.docScrollWidth) + ' ≤ viewport ' + (m && m.innerWidth) + '）')
        check(!!m && m.histState === 'ok' && m.histRows === 4, tag + '：画出四条提交（列表来自首屏快照的 history 片，不另读一枪）')
        check(!!m && m.loadMore === 1, tag + '：首屏只画一页，还有更多时给「加载更多」')
        check(!!m && m.graph === true && m.graphExternal === 0, tag + '：第 13.14 条图形化视图画在本页，不调用 gitk（没有外部窗口节点）')
        if (width === 300) check(!!m && m.histShorts.length === 0 && m.histAuthors === 0 && m.graphRows === 0 && m.graphNarrow === true, tag + '：300 宽只留标题，短号 / 作者 / 图形车道都收进窄档说明')
        else if (width === 380) check(!!m && m.histShorts.length === 4 && m.histAuthors === 0 && m.graphRows === 4, tag + '：380 宽补短号与图形车道，作者仍不画')
        else check(!!m && m.histAuthors === 4 && m.histWhens === 4, tag + '：' + width + ' 宽补作者与时间')
        check(!!m && m.clipped.length === 0 && m.histClipped.length === 0, tag + '：历史页关键句子没被截断（截断的：' + (m && m.histClipped.concat(m.clipped).join(',') || '无') + '）')
        await page.screenshot({ path: path.join(shotDir, 'history-' + skin + '-' + width + '.png') })
        const d = await renderAt(page, { page: 'commits', width: width, skin: skin, reads: histReadsOf({ commit: HIST_COMMIT_OK }), ui: { openCommit: HIST_REV.oid } })
        check(!!d && d.detail === true && d.detailState === 'ok', tag + '：打开一条提交，详情按整页替换画出来')
        check(!!d && d.fileButtons.join(',') === 'src/a.ts,旧名.txt', tag + '：详情逐文件列出这次提交改到的文件（重命名带旧路径）')
        check(!!d && !overflowOf(d) && d.clipped.length === 0 && d.histClipped.length === 0, tag + '：详情也不横向溢出、关键句子不截断')
        if (width === 520) await page.screenshot({ path: path.join(shotDir, 'history-detail-' + skin + '-' + width + '.png') })
        if (width === 520) {
          const df = await renderAt(page, {
            page: 'commits', width: width, skin: skin,
            reads: histReadsOf({ commit: HIST_COMMIT_OK, commitDiffs: { [HIST_DIFF_KEY]: { state: 'ok', lines: HIST_DIFF_LINES, truncated: false, reason: 'ok', error: null } } }),
            ui: { openCommit: HIST_REV.oid, openFile: 'src/a.ts' },
          })
          check(!!df && df.diffPath === 'src/a.ts' && df.diffLines.join(',') === 'filehead,hunk,add,del,context', tag + '：逐文件差异按行类型画出来（filehead / hunk / add / del / context）')
          check(!!df && !overflowOf(df) && df.clipped.length === 0 && df.histClipped.length === 0, tag + '：逐文件差异在 520 宽也不横向溢出（长行折行）')
          await page.screenshot({ path: path.join(shotDir, 'history-diff-' + skin + '-' + width + '.png') })
        }
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
  // vcText.js 单独拼进闭包时，相对时间窗口常量在真机闭包里由共享层提供；这里从 time-config 的
  // 生成物取同一份真值，挂到 window 上让闭包里的裸名读得到（与 verify-997 的手法一致）。
  const valuesMod = await import('file://' + path.join(ROOT, sourcePath('src/shared/time-config/values.js')).replace(/\\/g, '/'))
  const relMs = Number(valuesMod.VC_RELATIVE_WINDOW_MS)
  const stylesMod = await import('file://' + path.join(ROOT, 'src/client/views/versionControl/vcShellStyles.ts').replace(/\\/g, '/'))
  const css = 'html,body{margin:0;padding:0}#pane{width:100%}' + String(stylesMod.VC_SHELL_STYLE_TEXT || '')

  const closure = VC_FILES.map((f: string) => (f.indexOf('src/client/') === 0 ? spliceableJs(f) : strip(read(f)))).join('\n')
    // vcText 的时窗常量真源在共享层，闭包闭不上 import：删掉那行 import，值由页面里的 window.VC_RELATIVE_WINDOW_MS 提供。
    .split('\n').filter((line: string) => !/^\s*import\s.*time-config\/values\.js/.test(line)).join('\n')
  const { getBrowser, closeBrowser } = require('./lib/browser-pool.js')
  const browser = await getBrowser({ headless: true })
  try {
    await run(browser, { closure, dict, css, relMs })
    // 反证：给根节点强加 640px 最小宽度，同样的量尺在 300 宽必须量出横向溢出。
    // spliceableJs 转译后属性名与字符串都是双引号，锚点按转译后的写法写（改法落不到源码上等于没证）。
    const anchor = '"data-vc-shell": "1",'
    check(closure.split(anchor).length === 2, '反证自证：闭包里根节点标记只出现一处，改法真的改得到')
    const broken = closure.replace(anchor, anchor + " style: { minWidth: '640px' },")
    check(broken !== closure && broken.indexOf("minWidth: '640px'") > 0, '反证自证：闭包被改坏之后文本确实变了')
    const brokenPage = await pageFor(browser, broken, dict, css, relMs)
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
