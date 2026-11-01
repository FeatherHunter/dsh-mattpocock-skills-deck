#!/usr/bin/env node
/**
 * verify-1776-vc-tab-browser.ts —— 真实版本管理页签的真浏览器门禁（#1776 M3）
 *
 * 为什么要真浏览器：M1/M2 把版本管理页签换成了真实页面壳，但那些门禁都跑在 jsdom 或
 *   react-dom/server 里，量不出「300 宽会不会横向溢出」「按钮挤成一团还能不能点」这类布局结论。
 *   这一扇把真实入口 VersionControlTab 挂进真 Chromium，外面套假宿主（每次 host.call 都记录），
 *   按档宽与皮肤量像素、按点击路径走完十六个页面。
 *
 * 四组判据：
 *   A. 四档宽（300/380/460/520）× 深/浅两皮肤：可见 data-vc-live，其中含 data-vc-shell；
 *      根宽与 data-vc-width 档位一致；文档与全部可见后代都不横向溢出；进入时恰好一次首屏聚合读。
 *   B. 导航：四个固定页签点击切换（aria-selected 跟着变）、齿轮九个管理分区逐项进入再返回、
 *      搜索/变基/冲突三个顶栏入口可达；命令面板总命中 162 条、输入过滤行数与 vcPaletteRowsOf 一致、
 *      选中一条落到目标页并高亮。
 *   C. 300 宽下从根 ≤2 次点击到达每个固定页签/管理分区/侧页/搜索页；每页能力主入口滚进视口后可点、不报错。
 *   D. 反证：给根强加 min-width:640px 之后，同一把量尺在 300 宽必须量出横向溢出 ——
 *      量尺测不出「真的坏了」就说明它没有证据力。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1776-vc-tab-browser.ts
 * 依赖：playwright（本机已装 headless shell）+ esbuild；截图写 .scratch/1776-tab-browser/（只给人看）。
 */
'use strict'
const fs = require('fs')
const path = require('path')
const { createServer } = require('http')
const { pathToFileURL } = require('url')
const ROOT = path.resolve(__dirname, '..')
const { sourcePath } = require('./lib/source-text.ts')
const { printGateResult } = require('./lib/gate-result.ts')
const { TRANSPILE_OPTIONS } = require('../scripts/lib/transpile-unit.mts')
const SHOT_DIR = path.join(ROOT, '.scratch', '1776-tab-browser')
let total = 0
let failed = 0
const check = (ok: any, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed += 1 }
const NOW = Date.parse('2026-11-01T10:00:00+08:00')
const CWD = 'D:/w/repo'
const WIDTHS = [300, 380, 460, 520]
const SKINS = ['dark', 'light']
const TAB_PAGES = ['changes', 'commits', 'worktrees', 'stash']

// ---------------- 闭包：与 scripts/build.mts / verify-818 同一份清单 ----------------
const stripExports = (s: string): string => s.replace(/^(\s*)export\s+/gm, '$1')
const stripTimeImport = (s: string): string => s.split('\n').filter((l: string) => !/^\s*import\s.*time-config\/values\.js/.test(l)).join('\n')
const sourceOf = (rel: string): string => { const js = path.join(ROOT, rel); const ts = js.replace(/\.js$/, '.ts'); return fs.readFileSync(fs.existsSync(ts) ? ts : js, 'utf8') }
const CLOSURE_FILES = (function (): string[] {
  const text = fs.readFileSync(path.join(ROOT, 'tests/verify-818-version-control-view.ts'), 'utf8')
  const block = /const VC_FILES = \[([\s\S]*?)\n\]/.exec(text)
  if (!block) throw new Error('从 verify-818 里找不到 VC_FILES 清单，闭包拼不起来')
  const list = Array.from(block[1].matchAll(/'([^']+)'/g)).map((m: any) => m[1] as string)
  ;['vcRealModel.js', 'vcRealManage.js', 'vcRealManageReads.js', 'vcRealManageActions.js', 'vcRealManageActions2.js', 'vcRealManageActions3.js', 'vcRealManageSide.js', 'vcRealShell.js', 'vcRealDelegate.js', 'vcRealActions.js', 'vcRealTab.js', 'VersionControlTab.js'].forEach((name: string) => {
    if (!list.some((p: string) => p.endsWith('/' + name))) throw new Error('verify-818 的闭包清单里缺 ' + name + '，本门禁挂不到真实入口')
  })
  return list
})()
const CLOSURE_JS = require('esbuild').transformSync(CLOSURE_FILES.map((rel: string) => stripExports(stripTimeImport(sourceOf(rel)))).join('\n'), TRANSPILE_OPTIONS).code

// ---------------- 首屏快照与假宿主回包 ----------------
const okSlice = (data: any): any => ({ state: 'ok', data: data, error: null })
const SNAPSHOT = {
  contract: 'version-control.first-screen', version: 2, readAtMs: NOW,
  slices: {
    workspace: okSlice({ identity: { worktreeDisplay: 'dsh-plugin', worktreePath: CWD, branch: 'main', detached: false, oid: 'abcdef1234567890', sync: '', ahead: 0, behind: 0, basisMs: NOW }, repo: { merging: false, rebasing: false, cherryPicking: false, reverting: false, hasCommits: true, bare: false, tier: 'full', autocrlf: 'false' }, branches: [{ name: 'main', current: true, remote: 'origin' }] }),
    changes: okSlice({ staged: [], unstaged: [{ path: 'a.txt', status: ' M', staged: false, untracked: false }], stagedCount: 0, unstagedCount: 1, conflictCount: 0, lineCountsKnown: true }),
    history: okSlice({ commits: [{ oid: 'aaaa1111222233334444', short: 'aaaa111', author: '某甲', email: 'a@b.c', authorDateMs: NOW - 3600000, commitDateMs: NOW - 3600000, subject: '首条提交', parents: [] }], hasMore: false }),
    worktrees: okSlice({ others: [{ path: 'D:/w/wt2', branch: 'feat/x', head: 'abc1234', locked: false, prunable: true, prunableReason: '目录已不存在' }], bare: false, nul: false }),
    stashes: okSlice({ entries: [] }),
    sync: okSlice({ sync: '', ahead: 0, behind: 0, basisMs: NOW, upstream: '', remote: 'origin', branch: 'main' }),
    version: okSlice({ gitVersion: '2.45.0', tier: 'full', floor: '2.20', fullCount: 162, hiddenCount: 0, degradedCount: 0, switches: [] }),
  },
}
const FIXTURES = {
  cwd: CWD,
  snapshot: SNAPSHOT,
  rebaseState: { ok: true, state: null, branch: 'main', headOid: 'abcdef1', updateRefs: false, readAtMs: NOW },
  rebaseWindow: { ok: true, base: 'main', commits: [], commitCount: 0, readAtMs: NOW },
  byPhone: {
    'wf.gitCommitForm': { ok: true, form: { branch: 'main', stagedCount: 0, hooks: [], amend: { available: true, message: '上一条提交的说明' } } },
    'wf.gitStash': { ok: true, entries: [], recent: [], stderr: '', stdout: '' },
    'wf.gitChangesCheck': { ok: true, decision: { verdict: 'allow', reasons: ['ok'] }, plan: {}, confirmRequired: false, ticket: { id: 'ch-ticket', checkedAtMs: NOW, expiresAtMs: NOW }, readAtMs: NOW },
    'wf.gitWorktreeCheck': { ok: true, decision: { verdict: 'allow', reasons: ['ok'] }, plan: { cmd: 'git worktree prune' }, ticket: { id: 'wt-ticket', checkedAtMs: NOW, expiresAtMs: NOW } },
    'wf.gitBranches': { ok: true, contract: 'version-control.branch-board', version: 1, readAtMs: NOW, current: { name: 'main', oid: 'abcdef1' }, branches: [{ name: 'main', current: true, remote: 'origin', upstream: 'origin/main', oid: 'abcdef1', subject: '首条提交' }, { name: 'feat/x', current: false, oid: 'abc1234' }], tags: [{ name: 'v1.0', oid: 'aaaa111', subject: '首版' }], descriptions: {} },
    'wf.gitRemoteList': { ok: true, source: 'local', readAtMs: NOW, remotes: [{ name: 'origin', fetchUrl: 'git@example.com:repo.git', pushUrl: 'git@example.com:repo.git' }] },
    'wf.gitSubmodules': { ok: true, contract: 'version-control.submodule-board', version: 1, readAtMs: NOW, rows: [{ path: 'vendor/lib', state: 'clean', initialized: true, urlDisplay: 'https://example.com/lib.git', headBranch: 'main', oid: 'abc1234' }] },
    'wf.gitConfigRead': { ok: true, readAtMs: NOW, repoRoot: CWD, gitVersion: '2.45.0', hookRunVersion: null, configPath: CWD + '/.git/config', groups: [], identity: { name: { local: '某甲', global: null }, email: { local: 'a@b.c', global: null } }, hooks: { dir: CWD + '/.git/hooks', configured: null, readable: true, entries: [], known: [] }, attr: { state: 'ok', entries: [] }, mailmap: { state: 'ok', entries: [] }, entries: [] },
    'wf.gitDiagnosticsRead': { ok: true, readAtMs: NOW, kind: 'ls-files', rows: [], files: [], text: '', truncated: false },
    'wf.gitPlatformRead': { ok: true, readAtMs: NOW, credential: { state: 'ok', helpers: [], store: '', risk: 'ok', advice: 'ok' }, updateRefs: { state: 'ok', value: 'false', enabled: false } },
    'wf.gitConflicts': { ok: true, state: 'merge', headOid: 'abcdef1', gitVersion: '2.45.0', conflicts: [], conflictCount: 0, clean: true, readAtMs: NOW },
    'wf.gitMigrateCheck': { ok: true, action: 'init', decision: { verdict: 'allow', reasons: [] }, confirmRequired: false, readAtMs: NOW },
    'wf.gitSyncCheck': { ok: true, readAtMs: NOW, capabilityId: '8.5', action: 'fetch', decision: { verdict: 'warn', reasons: [] }, confirmRequired: true, confirm: { verb: '抓取', target: 'origin' }, ticket: { id: 'sy-ticket', op: 'fetch', checkedAtMs: NOW, expiresAtMs: NOW + 120000 } },
    'wf.gitTaskQuery': { ok: true, tasks: [], running: 0 },
    'wf.gitLog': { ok: true, commits: [], hasMore: false },
    'wf.gitDiff': { ok: true, files: [], lines: [], text: '', truncated: false },
  },
}

// ---------------- 页面脚本：真 React + 真入口 + 假宿主 ----------------
function entryOf(): string {
  return [
    "import React from 'react';",
    "import * as ReactDOMClient from 'react-dom/client';",
    'window.React = React;',
    'const CLOSURE = window.__CLOSURE_JS__;',
    'const F = window.__FIXTURES__;',
    'for (const k in window.__TIME__) window[k] = window.__TIME__[k];',
    'const DICT = window.__DICT__;',
    'const tr = (k, p) => { const s = DICT[k] === undefined ? String(k) : DICT[k]; if (!p) return s; return String(s).replace(/\\{(\\w+)\\}/g, (m, name) => (p[name] === undefined || p[name] === null ? m : String(p[name]))); };',
    'const C = React.createContext(null);',
    'const Tip = (p) => (p && p.children !== undefined ? p.children : null);',
    'const Ic = () => null;',
    'const CALLS = [];',
    'const replyOf = (phone, args) => { if (phone === "wf.gitFirstScreen") return { ok: true, firstScreen: F.snapshot, readAtMs: F.snapshot.readAtMs }; if (phone === "wf.gitRebaseRead") return String((args || {}).op || "") === "rebase-window" ? F.rebaseWindow : F.rebaseState; return F.byPhone[phone] === undefined ? { ok: true } : F.byPhone[phone]; };',
    'const host = { call: (phone, args) => { CALLS.push(phone); return Promise.resolve(replyOf(phone, args)); } };',
    'const fn = new Function("React", "log", "dswsLogHash", "dswsLogTrunc", "tr", "host", "DswsCtx", "Tip", "Ic", "seedReads", CLOSURE + "\\nreturn { VersionControlTab: VersionControlTab, vcPaletteMatchOf: vcPaletteMatchOf, vcPaletteRowsOf: vcPaletteRowsOf, vcPaletteTargetOf: vcPaletteTargetOf, VC_TAB_PAGES: VC_TAB_PAGES, VC_MANAGE_PAGES: VC_MANAGE_PAGES };");',
    'const VC = fn(React, () => {}, () => "h8", (s) => String(s), tr, host, C, Tip, Ic, null);',
    'window.__VC = VC;',
    'window.__countPhone = (phone) => CALLS.filter((p) => p === phone).length;',
    'window.__errors = [];',
    'window.addEventListener("error", (e) => window.__errors.push(String(e.message)));',
    'window.__mount = function (opts) {',
    '  const pane = document.getElementById("pane");',
    '  if (window.__root) { window.__root.unmount(); window.__root = null; }',
    '  pane.innerHTML = ""; CALLS.length = 0; window.__errors.length = 0;',
    '  window.__root = ReactDOMClient.createRoot(pane);',
    '  window.__root.render(React.createElement(VC.VersionControlTab, { st: { cwd: opts.cwd === undefined ? F.cwd : opts.cwd }, narrow: false }));',
    '};',
    'window.__measureLive = function () {',
    '  const live = document.querySelector("[data-vc-live]");',
    '  if (!live) return null;',
    '  const shell = live.querySelector("[data-vc-shell]");',
    '  const rr = live.getBoundingClientRect();',
    '  let maxRight = -1e9, minLeft = 1e9;',
    '  live.querySelectorAll("*").forEach((el) => { const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") return; const r = el.getBoundingClientRect(); if (r.width <= 0 && r.height <= 0) return; if (r.right > maxRight) maxRight = r.right; if (r.left < minLeft) minLeft = r.left; });',
    '  const attrAll = (sel, attr) => Array.from(live.querySelectorAll(sel)).map((el) => el.getAttribute(attr));',
    '  const tabs = Array.from(live.querySelectorAll("[data-vc-tab]"));',
    '  return {',
    '    live: true, liveDisplay: getComputedStyle(live).display, emptyCwd: !!live.querySelector("[data-vc-live-empty]") || live.hasAttribute("data-vc-live-empty"), emptyId: live.id || "", emptyRootAttr: live.getAttribute("data-vc-live-empty"),',
    '    shell: !!shell, page: shell ? shell.getAttribute("data-vc-page") : null, width: shell ? shell.getAttribute("data-vc-width") : null,',
    '    skin: shell ? shell.getAttribute("data-vc-skin") : null, depth: shell ? shell.getAttribute("data-vc-depth") : null,',
    '    rootWidth: rr.width, rootLeft: rr.left, rootRight: rr.right, maxRight: maxRight, minLeft: minLeft,',
    '    docScrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,',
    '    tabs: tabs.map((el) => el.getAttribute("data-vc-tab")), selected: tabs.filter((el) => el.getAttribute("aria-selected") === "true").map((el) => el.getAttribute("data-vc-tab")),',
    '    gear: attrAll("[data-vc-gear-item]", "data-vc-gear-item"), gearOpen: !!live.querySelector("[data-vc-gear-index]"),',
    '    palette: attrAll("[data-vc-palette-row]", "data-vc-palette-row"), paletteText: (live.querySelector("[data-vc-palette]") || { textContent: "" }).textContent,',
    '    capHit: !!live.querySelector("[data-cap-hit]"), back: !!live.querySelector("[data-vc-back]"), primaries: live.querySelectorAll("[data-cap-primary]").length,',
    '    firstScreenCalls: window.__countPhone("wf.gitFirstScreen"),',
    '  };',
    '};',
    'window.__ready = true;',
  ].join('\n')
}

// ---------------- 起页面：HTML 里注入闭包、词典、假宿主回包 ----------------
async function pageFor(browser: any, dict: any, closureJs: string, fixtures: any, timeVals: any, css: string) {
  const built = await require('esbuild').build({ stdin: { contents: entryOf(), resolveDir: ROOT, sourcefile: 'probe-1776.js', loader: 'js' }, bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', write: false, logLevel: 'error' })
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body><div id="pane"></div>' +
    '<script>window.__CLOSURE_JS__=' + JSON.stringify(closureJs) + ';window.__DICT__=' + JSON.stringify(dict) + ';window.__FIXTURES__=' + JSON.stringify(fixtures) + ';window.__TIME__=' + JSON.stringify(timeVals) + ';</script>' +
    '<script>' + String(built.outputFiles[0].text) + '</script></body></html>'
  const server = createServer((req: any, res: any) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html) })
  await new Promise((resolve: any) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const context = await browser.newContext({ viewport: { width: 520, height: 1400 } })
  const page = await context.newPage()
  const pageErrors: string[] = []
  page.on('pageerror', (e: any) => { pageErrors.push(String((e && e.message) || e)); console.error('[pageerror] ' + String((e && e.message) || e)) })
  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' })
  await page.waitForFunction('window.__ready === true', null, { timeout: 20000 })
  return { page, pageErrors, close: async () => { await context.close().catch(() => undefined); await new Promise((resolve: any) => server.close(resolve)) } }
}

// ---------------- 挂载与量尺的小工具 ----------------
async function mount(page: any, opts?: any) {
  await page.evaluate((o: any) => window.__mount(o || {}), opts || {})
  await page.waitForFunction("!!document.querySelector('[data-vc-live]')")
  await page.waitForTimeout(280)
}
async function click(page: any, sel: string) { await page.click(sel, { timeout: 6000 }); await page.waitForTimeout(170) }
async function setSkin(page: any, skin: string) { await page.evaluate((s: string) => { if (s === 'dark') document.body.setAttribute('data-ds-dark-theme', ''); else document.body.removeAttribute('data-ds-dark-theme') }, skin) }
const measure = (page: any) => page.evaluate(() => window.__measureLive())
const overflowOf = (m: any) => m.docScrollWidth > m.innerWidth + 1 || m.maxRight > m.rootRight + 1 || m.minLeft < m.rootLeft - 1
async function shoot(page: any, name: string) { fs.mkdirSync(SHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(SHOT_DIR, name + '.png') }) }

// ---------------- A 组：四档宽 × 两皮肤 ----------------
async function groupLayout(page: any) {
  for (const skin of SKINS) for (const width of WIDTHS) {
    await page.setViewportSize({ width: width, height: 1400 }); await setSkin(page, skin); await mount(page)
    const m = await measure(page); const tag = '页签 ' + skin + ' / ' + width + ' 宽'
    check(!!m && m.live && m.liveDisplay !== 'none', tag + '：data-vc-live 真画出来且可见')
    check(!!m && m.shell === true, tag + '：页面壳 data-vc-shell 长在 data-vc-live 里面')
    check(!!m && m.page === 'changes' && m.depth === '1', tag + '：默认落在改动页、层级 1（实得 ' + (m && m.page) + '）')
    check(!!m && Math.abs(Number(m.width) - m.rootWidth) <= 2, tag + '：根宽 ' + (m && m.rootWidth.toFixed(1)) + ' 与 data-vc-width=' + (m && m.width) + ' 一致')
    check(!!m && m.rootWidth <= m.innerWidth + 1, tag + '：根宽不超过视口（' + (m && m.rootWidth.toFixed(1)) + ' ≤ ' + (m && m.innerWidth) + '）')
    check(!!m && !overflowOf(m), tag + '：没有横向溢出（文档 ' + (m && m.docScrollWidth) + ' ≤ 视口 ' + (m && m.innerWidth) + '，后代右边界 ' + (m && m.maxRight.toFixed(1)) + ' ≤ 根右边界 ' + (m && m.rootRight.toFixed(1)) + '）')
    check(!!m && m.skin === skin, tag + '：皮肤读数是 ' + skin + '（实得 ' + (m && m.skin) + '）')
    check(!!m && m.tabs.length === 4 && m.selected.join(',') === 'changes', tag + '：四个页签都在、改动页签是选中态')
    check(!!m && m.firstScreenCalls === 1, tag + '：进入时恰好发一次首屏聚合读（实得 ' + (m && m.firstScreenCalls) + ' 次）')
    if (width === 300 || width === 520) await shoot(page, 'tab-' + skin + '-' + width)
  }
}

// ---------------- B 组：页签、齿轮、顶栏入口、命令面板 ----------------
async function groupNav(page: any) {
  await page.setViewportSize({ width: 520, height: 1400 }); await setSkin(page, 'dark'); await mount(page)
  for (const tab of TAB_PAGES) {
    if (tab !== 'changes') await click(page, '[data-vc-tab="' + tab + '"]')
    const m = await measure(page)
    check(!!m && m.page === tab && m.selected.join(',') === tab, 'B 页签：点「' + tab + '」切到该页，且只有它是 aria-selected（实得 ' + (m && m.page) + '）')
    check(!!m && m.back === false, 'B 页签：' + tab + ' 与改动页同一层，不该出现返回入口')
  }
  // 齿轮与顶栏入口都从改动页出发，返回后必须回到改动页（退回来源页是导航契约的一部分）。
  await click(page, '[data-vc-tab="changes"]')
  const manage = await page.evaluate(() => window.__VC.VC_MANAGE_PAGES.slice())
  check(manage.length === 9, 'B 齿轮：管理分区是九个（实得 ' + manage.length + '）')
  for (const id of manage) {
    if (!(await page.evaluate(() => !!document.querySelector('[data-vc-gear-index]')))) await click(page, '[data-vc-gear-btn]')
    const opened = await measure(page)
    check(!!opened && opened.gearOpen && opened.gear.length === 9, 'B 齿轮：打开齿轮索引看到九项（' + id + ' 这一轮实测 ' + (opened && opened.gear.length) + ' 项）')
    await click(page, '[data-vc-gear-item="' + id + '"]')
    const m = await measure(page)
    check(!!m && m.page === id && m.depth === '2', 'B 齿轮：点「' + id + '」进入该分区页、层级 2（实得 ' + (m && m.page) + '）')
    check(!!m && m.back === true && m.primaries > 0, 'B 齿轮：' + id + ' 页有返回入口、有真实正文与能力主入口')
    await click(page, '[data-vc-back]')
    const back = await measure(page)
    check(!!back && back.page === 'changes', 'B 齿轮：从 ' + id + ' 返回改动页（实得 ' + (back && back.page) + '，返回按钮 ' + (back && back.back) + '）')
  }
  for (const key of ['search', 'rebase', 'conflicts']) {
    await click(page, '[data-vc-extra-link="' + key + '"]')
    const m = await measure(page)
    check(!!m && m.page === key, 'B 顶栏入口：点「' + key + '」到该页（实得 ' + (m && m.page) + '）')
    await click(page, '[data-vc-back]')
    const back = await measure(page)
    check(!!back && back.page === 'changes', 'B 顶栏入口：从 ' + key + ' 返回改动页（实得 ' + (back && back.page) + '，返回按钮 ' + (back && back.back) + '）')
  }
  await mount(page)
  await click(page, '[data-vc-search-entry]')
  let m = await measure(page)
  const allHits = await page.evaluate(() => window.__VC.vcPaletteMatchOf('').length)
  const rowsAll = await page.evaluate(() => window.__VC.vcPaletteRowsOf('').map((r: any) => r.id))
  check(allHits === 162, 'B 命令面板：空词命中能力账本 162 条（实得 ' + allHits + ' 条）')
  check(!!m && m.palette.join(',') === rowsAll.join(','), 'B 命令面板：浮层行与 vcPaletteRowsOf 一致（' + (m && m.palette.length) + ' 行）')
  check(!!m && m.paletteText.indexOf('162') >= 0, 'B 命令面板：提示行写出总命中 162')
  await page.fill('[data-vc-palette-input]', '暂存')
  await page.waitForTimeout(220)
  m = await measure(page)
  const rowsFiltered = await page.evaluate(() => window.__VC.vcPaletteRowsOf('暂存').map((r: any) => r.id))
  check(!!m && m.palette.join(',') === rowsFiltered.join(','), 'B 命令面板：输入「暂存」后行数与 vcPaletteRowsOf 一致（' + (m && m.palette.length) + ' 行）')
  check(!!m && m.palette.length > 0 && m.palette.length <= rowsAll.length, 'B 命令面板：过滤之后仍有命中，且不多于不过滤时（' + (m && m.palette.length) + ' ≤ ' + rowsAll.length + '）')
  const pickId = m.palette[0]
  const target = await page.evaluate((id: string) => window.__VC.vcPaletteTargetOf(id), pickId)
  await click(page, '[data-vc-palette-row="' + pickId + '"]')
  m = await measure(page)
  check(!!m && m.page === target.page, 'B 命令面板：选中「' + pickId + '」落到目标页 ' + target.page + '（实得 ' + (m && m.page) + '）')
  check(!!m && m.capHit === true, 'B 命令面板：落点那一条能力行高亮（data-cap-hit）')
  check(!!m && m.palette.length === 0, 'B 命令面板：选中之后浮层面板关掉')
}

// ---------------- C 组：300 宽下逐页可达且主入口可点 ----------------
async function primaryCheck(page: any, pageErrors: string[], tag: string) {
  const info = await page.evaluate(() => { const el = document.querySelector('[data-cap-primary]'); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { id: el.getAttribute('data-cap-primary'), left: r.left, right: r.right, top: r.top, bottom: r.bottom, iw: window.innerWidth, ih: window.innerHeight } })
  check(!!info, tag + '：该页有可点的能力主入口（data-cap-primary）')
  check(!!info && info.left >= -1 && info.right <= info.iw + 1 && info.top >= -1 && info.bottom <= info.ih + 1, tag + '：主入口滚进视口后完整可点（' + (info && info.id) + '）')
  const before = pageErrors.length
  await page.evaluate(() => { const el = document.querySelector('[data-cap-primary]'); if (el) el.click() })
  await page.waitForTimeout(220)
  check(pageErrors.length === before, tag + '：点主入口不报错（新增页面错误 ' + (pageErrors.length - before) + ' 条）')
}
async function groupReach(page: any, pageErrors: string[]) {
  await page.setViewportSize({ width: 300, height: 1400 }); await setSkin(page, 'dark')
  for (const tab of TAB_PAGES) {
    await mount(page)
    if (tab !== 'changes') await click(page, '[data-vc-tab="' + tab + '"]')
    const m = await measure(page)
    check(!!m && m.page === tab, 'C 300 宽：1 次点击到页签 ' + tab + '（实得 ' + (m && m.page) + '）')
    await primaryCheck(page, pageErrors, 'C 页签 ' + tab)
  }
  const manage = await page.evaluate(() => window.__VC.VC_MANAGE_PAGES.slice())
  for (const id of manage) {
    await mount(page)
    await click(page, '[data-vc-gear-btn]')
    await click(page, '[data-vc-gear-item="' + id + '"]')
    const m = await measure(page)
    check(!!m && m.page === id && m.depth === '2', 'C 300 宽：2 次点击到管理分区 ' + id)
    await primaryCheck(page, pageErrors, 'C 分区 ' + id)
  }
  for (const key of ['search', 'rebase', 'conflicts']) {
    await mount(page)
    await click(page, '[data-vc-extra-link="' + key + '"]')
    const m = await measure(page)
    check(!!m && m.page === key, 'C 300 宽：1 次点击到顶栏入口 ' + key)
    await primaryCheck(page, pageErrors, 'C 入口 ' + key)
  }
}

// ---------------- D 组：反证 ----------------
async function groupReverse(page: any) {
  await page.setViewportSize({ width: 300, height: 1400 }); await setSkin(page, 'dark'); await mount(page)
  const before = await measure(page)
  check(!!before && !overflowOf(before), 'D 反证前置：没动手脚时同一把量尺在 300 宽量不出溢出')
  await page.evaluate(() => { (document.querySelector('[data-vc-live]') as any).style.minWidth = '640px' })
  await page.waitForTimeout(220)
  const m = await measure(page)
  const minWidth = await page.evaluate(() => getComputedStyle(document.querySelector('[data-vc-live]') as any).minWidth)
  check(minWidth === '640px', 'D 反证自证：改法真的落到根节点上（computed min-width=' + minWidth + '）')
  check(!!m && m.docScrollWidth > m.innerWidth + 1, 'D 反证：根被强制加宽后 300 宽必须量出横向溢出（scrollWidth ' + (m && m.docScrollWidth) + ' > ' + (m && m.innerWidth) + '）')
}

// ---------------- E 组：空工作区不挂壳、不发电话 ----------------
async function groupEmpty(page: any) {
  await page.setViewportSize({ width: 460, height: 1000 }); await setSkin(page, 'dark'); await mount(page, { cwd: '' })
  const m = await measure(page)
  check(!!m && m.live === true && m.emptyCwd === true, 'E 空工作区：画 data-vc-live-empty 空态（id=' + (m && (m as any).emptyId) + '，根属性=' + (m && (m as any).emptyRootAttr) + '）')
  check(!!m && m.shell === false, 'E 空工作区：不挂页面壳')
  check(!!m && m.firstScreenCalls === 0, 'E 空工作区：一条宿主电话都不发（实得 ' + (m && m.firstScreenCalls) + ' 条）')
}

// ---------------- main ----------------
;(async () => {
  const locMod = await import(pathToFileURL(path.join(ROOT, 'src/client/kernel/locale-data.ts')).href)
  const dict = locMod.LOCALE_COPY.zh
  const valuesMod = await import(pathToFileURL(path.join(ROOT, sourcePath('src/shared/time-config/values.js'))).href)
  const timeVals: any = {}
  for (const k of Object.keys(valuesMod)) if (typeof valuesMod[k] === 'number') timeVals[k] = valuesMod[k]
  const stylesMod = await import(pathToFileURL(path.join(ROOT, 'src/client/views/versionControl/vcShellStyles.ts')).href)
  const css = 'html,body{margin:0;padding:0}#pane{width:100%}' + String(stylesMod.VC_SHELL_STYLE_TEXT || '')
  const { getBrowser, closeBrowser } = require('./lib/browser-pool.js')
  const browser = await getBrowser({ headless: true })
  try {
    const env = await pageFor(browser, dict, CLOSURE_JS, FIXTURES, timeVals, css)
    try {
      await groupLayout(env.page)
      await groupNav(env.page)
      await groupReach(env.page, env.pageErrors)
      await groupReverse(env.page)
      await groupEmpty(env.page)
    } finally { await env.close() }
  } finally { await closeBrowser() }
  printGateResult('verify-1776-vc-tab-browser', total, failed)
  console.log('')
  if (failed) { console.log('存在失败 — 真实版本管理页签的真浏览器门禁未通过（' + total + ' 项断言）'); process.exit(1) }
  console.log('全部通过 — 真实页签在真浏览器里的布局、导航与可达性都成立（' + total + ' 项断言）')
})().catch((e: any) => {
  console.log('  FAIL 门禁自身抛错：' + String((e && e.stack) || e))
  process.exit(1)
})
