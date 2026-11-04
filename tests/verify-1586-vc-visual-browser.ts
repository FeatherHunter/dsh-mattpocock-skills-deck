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
 *   D. 排布不退化：页签四个排在同一行、四态与三种形态都在、关键句子（页标题、禁用原因、
 *      13.14 说明、命令面板标题）不被截断；#1860 起能力清单退场，页面体里不许再有 data-cap-primary，
 *      162 条主入口只在命令面板（本组末尾单独核对一次）；
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
  // 中央时间参数：真机闭包里由构建按 shared:timeConfig 拼进来（一次摘出闭包要用的常量）；
  // 这里读构建留下的同一份片段——维护页整仓重写页要用 VC_TASK_POLL_INTERVAL_MS 轮询长任务。
  '.tmp/time-config.client.js',
  '.build/shared/version-control/capability-ledger.js',
  // #1737 版本可用性判定（capabilityAvailability）：命令面板的版本说明与账本同源，闭包里少了它一渲染就 ReferenceError。
  '.build/shared/version-control/capabilities.js',
  // #1744：首屏七片契约的产物（历史页的列表直接来自首屏快照的 history 片，不另造一条读取）。
  '.build/shared/version-control/first-screen.js',
  // #1750：维护页整仓重写页依赖两份零依赖共享模块（rewrite-ops 的表单与计划、recovery-point 的备份点与还原步骤），
  // 真机闭包里由构建按 shared:vcRewriteOps / shared:vcRecoveryPoint 拼进来；这里按同两份源码拼，闭包才闭得上。
  '.build/shared/version-control/rewrite-ops.js',
  '.build/shared/version-control/recovery-point.js',
  // #1758 T22：维护页与诊断页的十条动作表在共享层 maintenance-ops.ts（真机闭包按 shared:vcMaintenanceOps 拼进来），
  // 闭包里少了它，维护页/诊断页一渲染就 ReferenceError；按构建次序排在三张页面叶子之前。
  '.build/shared/version-control/maintenance-ops.js',
  'src/client/views/versionControl/vcText.js',
  'src/client/views/versionControl/vcData.js',
  'src/client/views/versionControl/vcFirstScreen.js',
  'src/client/views/versionControl/vcWrite.js',
  'src/client/views/versionControl/vcCapabilityPages.js',
  'src/client/views/versionControl/vcShellPrimitives.js',
  'src/client/views/versionControl/vcPalette.js',
  'src/client/views/versionControl/vcHistory.js',
  // #1829 阶段 3：图形视图与提交详情从历史页拆成独立叶子；它们在 vcHistory 之后、页面壳之前拼接。
  'src/client/views/versionControl/vcHistoryGraph.js',
  'src/client/views/versionControl/vcHistoryDetail.js',
  // #1745：提交历史页六组 / 诊断页四组的历史高级查询面板（页面壳要调它，闭包里少一片就 ReferenceError）。
  'src/client/views/versionControl/vcQuery.js',
  'src/client/views/versionControl/vcQueryView.js',
  // #1762 T26：「本页负责的能力」列表从壳拆到独立叶子，构建次序在壳之前，闭包拼装要跟着放。
  'src/client/views/versionControl/vcCapabilityList.js',
  // #1846：全库搜索页的正文叶子（输入框在首屏、结果按页面分组）；构建里排在 vcCapabilityList 之后、页面壳之前。
  //   闭包里少了它，壳的挂载段 typeof vcSearchPageNode !== 'function'，搜索页退回旧版式，量不到输入框与结果行。
  'src/client/views/versionControl/vcSearchPage.js',
  // #1750：维护页会挂整仓重写面板（vcRewritePage），页面壳渲染 maintenance 页时要调它；按构建次序排在页面壳之前。
  'src/client/views/versionControl/vcRewriteOps.js',
  'src/client/views/versionControl/vcRewritePage.js',
  // #1758 T22：维护页与诊断页三叶（动作模型 → 维护页正文 → 诊断页正文）；壳渲染这两页时要调三个页面节点，按构建次序排在壳之前。
  'src/client/views/versionControl/vcMaintenanceData.js',
  'src/client/views/versionControl/vcMaintenancePage.js',
  'src/client/views/versionControl/vcMaintenanceDiag.js',
  'src/client/views/versionControl/vcShellIdentity.js',
  'src/client/views/versionControl/vcChangesView.js',
  'src/client/views/versionControl/vcBranches.js', // #1829：分支与标签的数据层（读数归一、票与结果落位；页面壳挂页面前要先有它）
  'src/client/views/versionControl/vcBranchPage.js', // #1829：分支与标签页的视图叶子（页头、筛选与搜索、卡片、页尾折叠）
  // #1829 阶段 4 三个共享件（与构建同序）：页头与页面原语、齿轮里的管理索引卡、分支浮层；壳的挂载段要看到它们。
  'src/client/views/versionControl/vcPageHead.js',
  // #1757 T21 子模块页（#1843 阶段 4 重做）：共享动作表 → 数据层 → 处理层 → 页面正文，按构建次序拼；
  // 壳渲染 submodules 页时要调 vcSubmodulesPageNode，闭包里少一片就 ReferenceError。
  '.build/shared/version-control/submodule-ops.js',
  'src/client/views/versionControl/vcSubmodulesData.js',
  'src/client/views/versionControl/vcSubmodulesOps.js',
  'src/client/views/versionControl/vcSubmodulesPage.js',
  // #1845 流程页共用小部件（状态芯片 / 动作条 / 进度条 / 行内提示）：变基、冲突、任务三页正文都要调它，
  //   闭包里少了这一叶，三页渲染会直接 ReferenceError。
  'src/client/views/versionControl/vcFlowParts.js',
  'src/client/views/versionControl/vcManageIndex.js',
  'src/client/views/versionControl/vcBranchPopover.js',
  // #1842 阶段 4：配置页与钩子页共用数据层 vcConfigOps，共享层 config-rules 提供哪些键可写、
  // 2.36 版本门与钩子名形状；两张页面叶子按构建次序排在壳之前。
  '.build/shared/version-control/config-rules.js',
  'src/client/views/versionControl/vcConfigOps.js',
  'src/client/views/versionControl/vcConfigPage.js',
  'src/client/views/versionControl/vcHooksPage.js',
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
    // #1860：能力清单退役以后，主入口只剩命令面板一处；页面体里必须一条都没有（正文读数单独取，避免与浮层混算）。
    "    bodyPrimaries: (function () { const b = root.querySelector('[data-vc-page-body]') || root; return b.querySelectorAll('[data-cap-primary]').length; })(),",
    "    gear: grab('[data-vc-gear-item]', 'data-vc-gear-item'),",
    "    states: grab('[data-vc-state]', 'data-vc-state'),",
    "    forms: grab('[data-vc-form]', 'data-vc-form'),",
    "    palettes: grab('[data-cap-secondary]', 'data-cap-secondary'),",
    "    searchRows: grab('[data-vc-search-row]', 'data-vc-search-row'),",
    "    clipped: clipped, rows: root.querySelectorAll('.vcs-cap').length,",
    "    skeleton: !!root.querySelector('[data-vc-skeleton]'), maintPage: !!root.querySelector('[data-vc-maint-page]'), rewritePage: !!root.querySelector('[data-vc-rewrite-page]'),",
    "    bg: window.getComputedStyle(root).backgroundColor,",
    "    hasIdentity: !!root.querySelector('[data-vc-identity]'),",
    "    hasSync: !!root.querySelector('[data-vc-sync]'),",
    "    hasSearch: !!root.querySelector('[data-vc-search-entry]'),",
    "    paletteInput: !!root.querySelector('[data-vc-palette-input]'),",
    "    searchInput: !!root.querySelector('[data-vc-search-input]'),",
    "    searchEmpty: (function () { const e = root.querySelector('[data-vc-search-empty]'); return e ? e.getAttribute('data-vc-search-empty') : null; })(),",
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
    // #1829 阶段 3 分支与标签页：首屏顺序、根读数、行与标签、筛选与搜索、折叠区、确认与结果的位置。
    "    branchPage: !!root.querySelector('[data-vc-branch2]'),",
    "    branchOrder: (function () { const s = root.querySelector('[data-vc-branch2]'); if (!s) return []; return Array.prototype.map.call(s.children, function (el) { return String(el.className || el.tagName) }); })(),",
    "    branchRows: grab('[data-vc-branch-row]', 'data-vc-branch-row'),",
    "    tagRows: grab('[data-vc-tag-row]', 'data-vc-tag-row'),",
    "    branchOps: (function () { const e = root.querySelector('[data-vc-branch2]'); return e ? e.getAttribute('data-vc-branch-ops') : null; })(),",
    "    branchWrites: (function () { const e = root.querySelector('[data-vc-branch2]'); return e ? e.getAttribute('data-vc-branch-writes') : null; })(),",
    "    branchChecks: (function () { const e = root.querySelector('[data-vc-branch2]'); return e ? e.getAttribute('data-vc-branch-checks') : null; })(),",
    "    branchForms: (function () { const e = root.querySelector('[data-vc-branch-forms]'); return e ? e.getAttribute('data-vc-branch-forms') : null; })(),",
    "    branchMerged: (function () { const e = root.querySelector('[data-vc-branch-merged]'); return e ? e.getAttribute('data-vc-branch-merged') : null; })(),",
    "    branchNotMerged: (function () { const e = root.querySelector('[data-vc-branch-notmerged]'); return e ? e.getAttribute('data-vc-branch-notmerged') : null; })(),",
    "    branchScope: (function () { const e = root.querySelector('[data-vc-branch-scope]'); return e ? e.getAttribute('data-vc-branch-scope') : null; })(),",
    "    branchFilters: grab('[data-vc-branch-filter]', 'data-vc-branch-filter'),",
    "    branchQuery: !!root.querySelector('[data-vc-branch-query]'),",
    "    branchConfirm: root.querySelectorAll('[data-vc-branch2] [data-vc-confirm]').length,",
    "    branchResult: root.querySelectorAll('[data-vc-branch2] [data-vc-result]').length,",
    "    branchRetry: root.querySelectorAll('[data-vc-branch2-retry]').length,",
    "    branchEmpty: root.querySelectorAll('[data-vc-branch2-empty]').length,",
    "    branchOidsShown: (function () { const out = []; root.querySelectorAll('[data-vc-branch-row] .vcs-branch2-oid').forEach(function (el) { if (window.getComputedStyle(el).display !== 'none') out.push(String(el.textContent)); }); return out; })(),",
    // #1842 阶段 4：配置页与钩子页的结构读数（属性顺序即页面上从上到下的顺序）。
    "    cfgPageRead: (function () { const e = root.querySelector('[data-vc-config-page]'); return e ? e.getAttribute('data-vc-config-read') : null; })(),",
    "    cfgSections: (function () { const s = root.querySelector('[data-vc-config-page]'); if (!s) return []; return Array.prototype.map.call(s.children, function (el) { return String(el.className || el.tagName) }); })(),",
    "    cfgGroups: grab('[data-vc-config-group]', 'data-vc-config-group'),",
    "    cfgEditable: grab('[data-vc-config-editable]', 'data-vc-config-editable'),",
    "    cfgReadonly: root.querySelectorAll('[data-vc-config-readonly]').length,",
    "    cfgIdentityRows: grab('[data-vc-config-identity]', 'data-vc-config-identity'),",
    "    cfgRows: grab('[data-vc-config-row]', 'data-vc-config-row'),",
    "    cfgGroupEmpty: root.querySelectorAll('[data-vc-config-group-empty]').length,",
    "    cfgReads: grab('[data-vc-config-read]', 'data-vc-config-read'),",
    "    cfgClipped: (function () { const out = []; const sel = ['.vcs-config-old', '.vcs-config-id-key', '.vcs-config-meta-value', '.vcs-config-read-label', '.vcs-config-query-result']; root.querySelectorAll(sel.join(',')).forEach(function (el) { if (el.scrollWidth > el.clientWidth + 1) out.push(String(el.className)) }); return out; })(),",
    "    hooksPageEl: !!root.querySelector('[data-vc-hooks-page]'),",
    "    hooksSections: (function () { const s = root.querySelector('[data-vc-hooks-page]'); if (!s) return []; return Array.prototype.map.call(s.children, function (el) { return String(el.className || el.tagName) }); })(),",
    "    hooksList: (function () { const e = root.querySelector('[data-vc-hooks-list]'); return e ? e.getAttribute('data-vc-hooks-list') : null; })(),",
    "    hooksListCount: (function () { const e = root.querySelector('[data-vc-hooks-list]'); return e ? e.getAttribute('data-vc-hooks-count') : null; })(),",
    "    hookRows: grab('[data-vc-hook]', 'data-vc-hook'),",
    "    hookSamples: grab('[data-vc-hook-sample]', 'data-vc-hook-sample'),",
    "    hookRuns: grab('[data-vc-hook-run]', 'data-vc-hook-run'),",
    "    hookCaps: grab('[data-vc-hooks-cap]', 'data-vc-hooks-cap'),",
    "    hooksGate: (function () { const e = root.querySelector('[data-vc-hooks-gate]'); return e ? e.getAttribute('data-vc-hooks-gate') : null; })(),",
    "    hooksInstall: root.querySelectorAll('[data-vc-hooks-install-note]').length,",
    "    hooksDirAttr: (function () { const e = root.querySelector('[data-vc-hooks-dir]'); return e ? e.getAttribute('data-vc-hooks-dir') : null; })(),",
    "    hooksClipped: (function () { const out = []; const sel = ['.vcs-hook-note', '.vcs-hook-name', '.vcs-hooks-install-note', '.vcs-hooks-run-note', '.vcs-hooks-gate']; root.querySelectorAll(sel.join(',')).forEach(function (el) { if (el.scrollWidth > el.clientWidth + 1) out.push(String(el.className)) }); return out; })(),",
    // #1843 阶段 4 子模块页：根读数、清单四态、行与差异、八条能力入口、四个批量按钮、添加表单。
    "    subPage: !!root.querySelector('[data-vc-sub-page]'),",
    "    subMode: (function () { const e = root.querySelector('[data-vc-sub-page]'); return e ? e.getAttribute('data-vc-sub-mode') : null })(),",
    "    subState: (function () { const e = root.querySelector('[data-vc-sub-page]'); return e ? e.getAttribute('data-vc-sub-state') : null })(),",
    "    subList: (function () { const e = root.querySelector('[data-vc-sub-list]'); return e ? e.getAttribute('data-vc-sub-list') : null })(),",
    "    subRows: grab('[data-vc-sub-row]', 'data-vc-sub-row'),",
    "    subInitialized: grab('[data-vc-sub-row]', 'data-vc-sub-initialized'),",
    "    subRowTexts: (function () { const out = []; root.querySelectorAll('[data-vc-sub-row]').forEach(function (el) { out.push(String(el.textContent)) }); return out })(),",
    "    subDiffs: grab('[data-vc-sub-diff]', 'data-vc-sub-diff'),",
    "    subDiffTexts: (function () { const out = []; root.querySelectorAll('[data-vc-sub-diff]').forEach(function (el) { out.push(String(el.textContent)) }); return out })(),",
    "    subEntries: grab('[data-vc-sub-entry]', 'data-vc-sub-entry'),",
    "    subBatch: grab('[data-vc-sub-batch]', 'data-vc-sub-batch'),",
    "    subForm: (function () { const e = root.querySelector('[data-vc-sub-form]'); return e ? e.getAttribute('data-vc-sub-form') : null })(),",
    "    subForms: root.querySelectorAll('[data-vc-sub-form]').length,",
    "    subFields: grab('[data-vc-sub-field]', 'data-vc-sub-field'),",
    "    subEmptyTitle: root.querySelectorAll('[data-vc-sub-list=empty] .empty-title').length,",
    "    subEmptyHint: root.querySelectorAll('[data-vc-sub-list=empty] .empty-hint').length,",
    "    subErrorTitle: root.querySelectorAll('[data-vc-sub-list=error] .empty-title').length,",
    "    subErrorHint: root.querySelectorAll('[data-vc-sub-list=error] .empty-hint').length,",
    "    subErrorRetry: root.querySelectorAll('[data-vc-sub-list=error] [data-vc-sub-action=read]').length,",
    "    subClipped: (function () { const out = []; const sel = ['.section-title', '.section-note', '.empty-title', '.empty-hint', '.page-card-title', '.page-card-sub', '.inline-label']; root.querySelectorAll(sel.join(',')).forEach(function (el) { if (el.scrollWidth > el.clientWidth + 1) out.push(String(el.className)) }); return out })(),",
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
  // 页面里的渲染异常默认不会回到 Node，只会让壳节点等不到；把两类错误打到 stderr，红的时候能一眼看到根因。
  page.on('pageerror', (e: any) => { console.error('[pageerror] ' + String(e && e.message || e)) })
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

// ---------- 分支与标签页（#1829 阶段 3）的种子读数 ----------
// 三条分支（当前 main、未并入的 feature/x 与 release/2026-10）与两个标签，形状照宿主回包：
// 契约名与版本、读时刻、branches/tags 数组、descriptions 对象都在，页面才会画成有读数的那一版。
// 提交短号取前 7 位由页面自己截，这里给整串 40 位，顺便验「300 宽收起短号」那条样式规则。
const BRANCH_NOW = Date.parse('2026-10-04T10:00:00+08:00')
function branchBoardOf() {
  return {
    contract: 'version-control.branch-board', version: 1, readAtMs: BRANCH_NOW,
    current: { name: 'main', oid: 'a'.repeat(40) },
    branches: [
      { name: 'main', oid: 'a'.repeat(40), current: true, upstream: 'origin/main', ahead: 2, behind: 1, commitDateMs: BRANCH_NOW - 6 * 60000 },
      { name: 'feature/x', oid: 'b'.repeat(40), current: false, upstream: null, ahead: 0, behind: 0, commitDateMs: BRANCH_NOW - 2 * 3600000 },
      { name: 'release/2026-10', oid: 'c'.repeat(40), current: false, upstream: 'origin/release/2026-10', ahead: 0, behind: 4, commitDateMs: BRANCH_NOW - 26 * 3600000 },
    ],
    tags: [
      { name: 'v1.0.0', oid: 'd'.repeat(40), objectType: 'commit', annotated: false, atMs: BRANCH_NOW, subject: '发布 1.0.0' },
      { name: 'v1.1.0', oid: 'e'.repeat(40), objectType: 'tag', annotated: true, atMs: BRANCH_NOW, subject: '发布 1.1.0' },
    ],
    descriptions: { main: '主干；发布从这里切' },
    merged: ['main'], notMerged: ['feature/x', 'release/2026-10'],
    capabilities: { gitVersion: 'git version 2.49.0', tier: 'full', actions: [] },
  }
}

// ---------- 配置页与钩子页（#1842 阶段 4）的种子读数 ----------
// 形状照读配置电话的回包（vcConfigApplyRead 摊进状态之后的同一份对象）：四组配置行、身份两键的
// 本仓库与这台机器旧值、钩子目录与三个文件（一个真钩子、一个示例、一个没有可执行位的真钩子）。
// 页面只读这些字段，不另外打电话；这样量到的是版式与信息层级，不是宿主回包。
const CFG_NOW = Date.parse('2026-10-04T10:00:00+08:00')
const CFG_HOOK_ENTRIES = [
  { name: 'pre-commit', sample: false, executable: true, size: 520 },
  { name: 'pre-commit.sample', sample: true, executable: true, size: 1200 },
  { name: 'post-merge', sample: false, executable: false, size: 10 },
]
function cfgRowOf(group: string, key: string, editable: boolean, local: string | null, global: string | null, scope: string) {
  return { group: group, key: key, editable: editable, values: { local: local, global: global, system: null, other: null }, scope: scope, value: scope === 'local' ? local : global }
}
function cfgStateOf(over?: any) {
  const base: any = {
    readState: 'ok', readAtMs: CFG_NOW, repoRoot: 'D:/w/repo', gitVersion: 'git version 2.49.0',
    hookRunVersion: { state: 'visible', needed: '2.36.0', alternativeKey: 'vc.hooks.gate.alternative' },
    configPath: 'D:/w/repo/.git/config',
    groups: [
      cfgRowOf('identity', 'user.name', true, '基线名字', null, 'local'),
      cfgRowOf('identity', 'user.email', true, 'base@example.com', 'machine@example.com', 'local'),
      cfgRowOf('eol', 'core.autocrlf', false, 'true', null, 'local'),
      cfgRowOf('hooksPath', 'core.hooksPath', false, null, '.githooks', 'global'),
    ],
    identity: { name: { local: '基线名字', global: null }, email: { local: 'base@example.com', global: 'machine@example.com' } },
    hooks: { dir: 'D:/w/repo/.git/hooks', configured: null, readable: true, known: [], entries: CFG_HOOK_ENTRIES },
    attr: { state: 'idle' }, mailmap: { state: 'idle' }, entries: [],
    edit: { key: '', scope: 'local', value: '', path: '', address: '' },
    check: null, pending: null, result: null,
  }
  return Object.assign(base, over || {})
}

// ---------- 子模块页（#1843 阶段 4）的种子读数 ----------
// 两行覆盖两种常见状态：第一行已检出且与父仓记录一致；第二行检出内容与记录不同，还带着
// 脱离分支的本地提交、可以吸收。形状照宿主回包（contract/version/rows），页面只读 rows 里的字段。
function subBoardOf() {
  return {
    ok: true, contract: 'version-control.submodule-board', version: 1,
    rows: [
      {
        name: 'native-kit', path: 'third_party/native-kit', oid: '1'.repeat(40), state: 'clean',
        initialized: true, describe: 'v2.4.0-3-gabc1234',
        url: 'https://example.com/native-kit.git', urlDisplay: 'https://example.com/native-kit.git',
        branch: '', headBranch: '', detached: false, localCommits: 0, absorbable: false,
        absorbFrom: '', absorbTo: '',
      },
      {
        name: 'legacy', path: 'vendor/legacy', oid: '2'.repeat(40), state: 'different',
        initialized: true, describe: 'v1.0.0-2-gdef5678',
        url: 'https://example.com/legacy.git', urlDisplay: 'https://example.com/legacy.git',
        branch: 'main', headBranch: 'main', detached: true, localCommits: 2, absorbable: true,
        absorbFrom: '3'.repeat(40), absorbTo: '4'.repeat(40),
      },
    ],
  }
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
        check(!!m && m.bodyPrimaries === 0 && m.primaries.length === 0, tag + '：正文里不再画能力行与 data-cap-primary（该页 ' + maintenanceCaps.length + ' 条能力，主入口只在命令面板）')
        // #1776 M2 起维护页会挂整仓重写与维护卡片两段真正文，骨架自检不再和正文并排出现；
        // 状态与表单的自检画法挪到一页仍然是骨架的页面上验（下面渲染 changes 页且不给读数）。
        check(!!m && m.maintPage === true && m.rewritePage === true && m.skeleton === false, tag + '：维护页换成真正文（整仓重写 + 维护卡片），不再画自检骨架')
        // 截图必须紧跟维护页这次渲染：下一行要换成 changes 页做骨架自检，跨过去再拍就会把改动页拍成维护页。
        if (m) bgOf[skin] = m.bg
        await page.screenshot({ path: path.join(shotDir, 'maintenance-' + skin + '-' + width + '.png') })
        const skel = await renderAt(page, { page: 'changes', width: width, skin: skin })
        check(!!skel && skel.skeleton === true && skel.states.join(',') === 'empty,loading,error,disabled', tag + '：骨架自检页四种状态按 empty/loading/error/disabled 各画一遍')
        check(!!skel && skel.forms.join(',') === 'inline,float,page', tag + '：骨架自检页三种表单形态按 inline/float/page 各画一遍')
        check(!!m && m.clipped.length === 0, tag + '：关键句子没有被截断（截断的：' + (m && m.clipped.join(',') || '无') + '）')
        check(!!m && m.hasIdentity && m.hasSync && m.hasSearch, tag + '：身份行、同步带、全库搜索入口都在')
      }
    }
    check(!!bgOf.dark && !!bgOf.light && bgOf.dark !== bgOf.light && bgOf.dark !== 'rgba(0, 0, 0, 0)', '两套皮肤各有自己的底色（深 ' + bgOf.dark + ' / 浅 ' + bgOf.light + '）')
    // ---- H 组：子模块页（#1843 阶段 4）—— 四档宽 × 两皮肤 ----
    // 判据只看结构与读数：三段正文都在、清单两行各带路径/提交/差异、八条能力入口与四个批量按钮
    // 一个不少、添加表单两栏都在，且各档都不横向溢出、关键句子不截断。
    const subBoard = subBoardOf()
    for (let s = 0; s < SKINS.length; s += 1) {
      const skin = SKINS[s]
      for (let w = 0; w < WIDTHS.length; w += 1) {
        const width = WIDTHS[w]
        const tag = '子模块页 ' + skin + ' / ' + width + ' 宽'
        await page.setViewportSize({ width: width, height: 1400 })
        const m = await renderAt(page, { page: 'submodules', width: width, skin: skin, open: { gear: true }, submodules: { state: 'ok', board: subBoard }, submoduleOps: {} })
        check(!!m && m.page === 'submodules' && m.width === String(width) && m.skin === skin && m.depth === '2', tag + '：根节点读数是子模块页 / 档宽 / 皮肤 / 层级 2')
        check(!!m && !overflowOf(m), tag + '：没有横向溢出（文档 ' + (m && m.docScrollWidth) + ' ≤ viewport ' + (m && m.innerWidth) + '）')
        check(!!m && m.subPage === true && m.subMode === 'idle' && m.subState === 'ok' && m.subList === 'rows', tag + '：清单按可用读数画成有行的一态（mode ' + (m && m.subMode) + ' / state ' + (m && m.subState) + '）')
        check(!!m && m.gear.join(',') === managePages.join(','), tag + '：齿轮九分区按 VC_MANAGE_PAGES 顺序排（' + (m && m.gear.join(',')) + '）')
        check(!!m && m.tabCount === 4 && m.tabTops.length === 4 && Math.max.apply(null, m.tabTops) - Math.min.apply(null, m.tabTops) <= 1, tag + '：四个页签排在同一行（行顶差 ≤1px）')
        check(!!m && m.subRows.join(',') === 'third_party/native-kit,vendor/legacy', tag + '：清单按读数顺序画两行（实得 ' + (m && m.subRows.join(',')) + '）')
        check(!!m && m.subInitialized.join(',') === '1,1' && m.subDiffs.join(',') === 'clean,different', tag + '：每行都带「是否已检出」与差异读数（' + (m && m.subDiffs.join(',')) + '）')
        check(!!m && m.subRowTexts.length === 2 && m.subRowTexts[0].indexOf('third_party/native-kit') >= 0 && m.subRowTexts[0].indexOf('1'.repeat(10)) >= 0 && m.subRowTexts[1].indexOf('vendor/legacy') >= 0 && m.subRowTexts[1].indexOf('2'.repeat(10)) >= 0, tag + '：每行的路径与当前提交都画在行里')
        check(!!m && m.subDiffTexts.length === 2 && m.subDiffTexts[0].length > 0 && m.subDiffTexts[1].length > 0, tag + '：每行的差异说明都有正文（不是空行）')
        check(!!m && m.subEntries.join(',') === '10.1,10.2,10.3,10.4,10.5,10.6,10.7,10.8', tag + '：八条能力入口按 10.1–10.8 排（实得 ' + (m && m.subEntries.join(',')) + '）')
        check(!!m && m.subBatch.join(',') === 'init,fetch,recorded,status', tag + '：四个批量按钮按固定菜单顺序排（实得 ' + (m && m.subBatch.join(',')) + '）')
        check(!!m && m.subForm === 'add' && m.subFields.join(',') === 'path,url', tag + '：添加表单收路径与地址两栏（实得 ' + (m && m.subFields.join(',')) + '）')
        check(!!m && m.subClipped.length === 0, tag + '：关键句子没有被截断（截断的：' + (m && m.subClipped.join(',') || '无') + '）')
        await page.screenshot({ path: path.join(shotDir, 'submodules-' + skin + '-' + width + '.png') })
      }
    }
    // 子模块页空态与错误态（只在 460 宽深色量一次）：空态照实画标题、说明与添加表单；
    // 错误态给原因与重试键，两种状态都不影响下面的能力入口与批量动作段。
    await page.setViewportSize({ width: 460, height: 1400 })
    const subEmpty = await renderAt(page, { page: 'submodules', width: 460, skin: 'dark', open: { gear: true }, submodules: { state: 'empty', board: null }, submoduleOps: {} })
    check(!!subEmpty && subEmpty.subState === 'empty' && subEmpty.subList === 'empty' && subEmpty.subRows.length === 0, '子模块页空态：没有子模块时画空态（data-vc-sub-list=empty）')
    check(!!subEmpty && subEmpty.subEmptyTitle === 1 && subEmpty.subEmptyHint === 1 && subEmpty.subForm === 'add', '子模块页空态：空态块里有标题、说明与添加表单')
    check(!!subEmpty && subEmpty.subEntries.length === 8 && subEmpty.subBatch.length === 4, '子模块页空态：八条能力入口与四个批量按钮仍在（空态只换清单段）')
    await page.screenshot({ path: path.join(shotDir, 'submodules-empty-dark-460.png') })
    const subErr = await renderAt(page, { page: 'submodules', width: 460, skin: 'dark', open: { gear: true }, submodules: { state: 'error', board: null, error: { kind: 'env', message: 'wf.gitSubmodules 失败' } }, submoduleOps: {} })
    check(!!subErr && subErr.subState === 'error' && subErr.subList === 'error', '子模块页错误态：读数失败时画错误态（data-vc-sub-list=error）')
    check(!!subErr && subErr.subErrorTitle === 1 && subErr.subErrorHint === 1 && subErr.subErrorRetry === 1, '子模块页错误态：错误块里有标题、原因与重试按钮')
    await page.screenshot({ path: path.join(shotDir, 'submodules-error-dark-460.png') })
    for (let s = 0; s < SKINS.length; s += 1) {
      const skin = SKINS[s]
      for (let w = 0; w < WIDTHS.length; w += 1) {
        const width = WIDTHS[w]
        const tag = '命令面板 ' + skin + ' / ' + width + ' 宽'
        await page.setViewportSize({ width: width, height: 1200 })
        const stashRows: string[] = await page.evaluate(() => window.__expectedPalette('stash'))
        let m = await renderAt(page, { page: 'search', width: width, skin: skin, seed: { query: 'stash' } })
        // #1846：全库搜索页改成独立版式，结果行是自己的 data-vc-search-row；命令面板只作别的页面上的浮层。
        check(!!m && m.searchInput && !m.paletteInput && m.searchRows.join(',') === stashRows.join(','), tag + '：搜 stash 的命中行与 vcPaletteRowsOf 一致（' + (m && m.searchRows.length) + ' 行）且搜索页只有一个自己的输入框')
        check(!!m && !overflowOf(m), tag + '：命令面板也不横向溢出（' + (m && m.docScrollWidth) + ' ≤ ' + (m && m.innerWidth) + '）')
        const m1314 = await renderAt(page, { page: 'search', width: width, skin: skin, seed: { query: '13.14' } })
        check(!!m1314 && m1314.searchRows.join(',') === '13.14', tag + '：按能力 id 搜 13.14 命中，结果显示所在页面')
        const byName = await page.evaluate(() => window.__VC.vcPaletteRowsOf(window.__VC.vcPageCapabilitiesOf('commits')[0].name).length)
        const mName = await renderAt(page, { page: 'search', width: width, skin: skin, seed: { query: '提交' } })
        check(byName > 0 && !!mName && mName.searchRows.length > 0, tag + '：按名称 / 命令原文也能搜到（提交 命中 ' + (mName && mName.searchRows.length) + ' 行）')
        const mNone = await renderAt(page, { page: 'search', width: width, skin: skin, seed: { query: 'zzz-没有这个能力' } })
        check(!!mNone && mNone.searchEmpty === 'hit' && mNone.searchRows.length === 0, tag + '：搜不到时画「没有命中」空态（data-vc-search-empty=hit）')
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
    // ---- G 组：分支与标签页（#1829 阶段 3）—— 四档宽 × 两皮肤 ----
    // 判据只看结构与读数：面板在、行按读数顺序、十三条能力仍各一个主入口、四条根读数不变、
    // 首屏顺序（页头 → 说明 → 只读边界 → 当前分支 → 筛选与列表 → 标签 → 页尾折叠）、无溢出、无截断。
    const branchCaps: string[] = await page.evaluate(() => window.__capsOf('branch-tags'))
    const branchBoard = branchBoardOf()
    for (let s = 0; s < SKINS.length; s += 1) {
      const skin = SKINS[s]
      for (let w = 0; w < WIDTHS.length; w += 1) {
        const width = WIDTHS[w]
        const tag = '分支与标签页 ' + skin + ' / ' + width + ' 宽'
        await page.setViewportSize({ width: width, height: 1400 })
        const m = await renderAt(page, { page: 'branch-tags', width: width, skin: skin, branchBoard: branchBoard, nowMs: BRANCH_NOW })
        check(!!m && m.page === 'branch-tags' && m.width === String(width) && m.skin === skin && m.depth === '2', tag + '：根节点读数是分支与标签页 / 档宽 / 皮肤 / 层级 2')
        check(!!m && !overflowOf(m), tag + '：没有横向溢出（文档 ' + (m && m.docScrollWidth) + ' ≤ viewport ' + (m && m.innerWidth) + '）')
        check(!!m && m.branchPage === true, tag + '：分支与标签面板画出来了')
        check(!!m && m.branchRows.join(',') === 'main,feature/x,release/2026-10' && m.tagRows.join(',') === 'v1.0.0,v1.1.0', tag + '：分支与标签都按读数顺序各画一行（分支 ' + (m && m.branchRows.length) + ' / 标签 ' + (m && m.tagRows.length) + '）')
        check(!!m && m.branchOps === '13' && m.branchWrites === '9' && m.branchChecks === '1' && m.branchForms === '10', tag + '：根上仍报 13 条能力 / 9 条写 / 1 条验签，页尾折叠区仍画十条写动作（实得 ' + (m && [m.branchOps, m.branchWrites, m.branchChecks, m.branchForms].join('/')) + '）')
        check(!!m && m.bodyPrimaries === 0 && m.primaries.length === 0, tag + '：正文里不再画能力行与 data-cap-primary（该页 ' + branchCaps.length + ' 条能力，主入口只在命令面板）')
        check(!!m && m.branchFilters.join(',') === 'all,current,unmerged' && m.branchQuery === true, tag + '：首屏有搜索框与三颗筛选胶囊（全部 / 当前分支 / 未并入当前分支）')
        check(!!m && m.branchScope === '3' && m.branchMerged === '1' && m.branchNotMerged === '2', tag + '：筛选计数与两张名单的条数对得上读数（显示 ' + (m && m.branchScope) + ' / 已并入 ' + (m && m.branchMerged) + ' / 没并入 ' + (m && m.branchNotMerged) + '）')
        const head = m && m.branchOrder ? m.branchOrder.slice(0, 4).join(',') : ''
        check(head === 'vcs-branch2-head,vcs-branch2-lede,vcs-branch2-boundary,vcs-branch2-cur', tag + '：首屏从上到下是页头 → 说明 → 只读边界 → 当前分支（实得 ' + head + '）')
        check(!!m && m.branchOrder.indexOf('vcs-branch2-list') > 0 && m.branchOrder.indexOf('vcs-branch2-forms') > m.branchOrder.indexOf('vcs-tag-list'), tag + '：分支列表在标签之前、十条写动作收在页尾折叠区')
        if (width === 300) check(!!m && m.branchOidsShown.length === 0, tag + '：300 宽把提交短号收起来，避免把行撑破')
        else check(!!m && m.branchOidsShown.length > 0, tag + '：' + width + ' 宽继续显示提交短号')
        check(!!m && m.clipped.length === 0, tag + '：关键句子没有被截断（截断的：' + (m && m.clipped.join(',') || '无') + '）')
        await page.screenshot({ path: path.join(shotDir, 'branch-tags-' + skin + '-' + width + '.png') })
        // 筛选与搜索是这块新做的交互：点一下、输入一次，看行数与计数真的跟着变（只在 460 宽深色做一次）。
        if (width === 460 && skin === 'dark') {
          await page.click('[data-vc-branch2] [data-vc-branch-filter="unmerged"]')
          await page.waitForTimeout(150)
          const mf: any = await page.evaluate(() => window.__measure())
          check(!!mf && mf.branchRows.join(',') === 'feature/x,release/2026-10' && mf.branchScope === '2', tag + '：点「未并入当前分支」后只留未并入的两行（筛选在组件里真的生效，实得 ' + (mf && mf.branchRows.join(',')) + '）')
          const qsel = '[data-vc-branch2] [data-vc-branch-query]'
          await page.fill(qsel, 'release')
          await page.waitForTimeout(150)
          const mq: any = await page.evaluate(() => window.__measure())
          check(!!mq && mq.branchRows.join(',') === 'release/2026-10' && !overflowOf(mq), tag + '：搜索框输入 release 后按分支名收窄到一行（搜索真的生效，实得 ' + (mq && mq.branchRows.join(',')) + '）')
          await page.screenshot({ path: path.join(shotDir, 'branch-tags-filtered-dark-460.png') })
          await page.fill(qsel, '')
          await page.click('[data-vc-branch2] [data-vc-branch-filter="all"]')
          await page.waitForTimeout(100)
        }
      }
    }
    // ---- H 组：配置页（#1842 阶段 4）—— 元信息 → 相关配置（四组折叠）→ 只读读取 ----
    // 判据只看版式与信息层级：页头由壳画（正文不许再画标题与导语）、四组折叠顺序、身份组可写
    // 与三组只读的视觉区分、两处读数与两个查询行、六条能力仍各一个主入口、无溢出无截断。
    const configCaps: string[] = await page.evaluate(() => window.__capsOf('config'))
    const hooksCaps: string[] = await page.evaluate(() => window.__capsOf('hooks'))
    const cfgOk = cfgStateOf(null)
    for (let s = 0; s < SKINS.length; s += 1) {
      const skin = SKINS[s]
      for (let w = 0; w < WIDTHS.length; w += 1) {
        const width = WIDTHS[w]
        const tag = '配置页 ' + skin + ' / ' + width + ' 宽'
        await page.setViewportSize({ width: width, height: 1400 })
        const m = await renderAt(page, { page: 'config', width: width, skin: skin, config: cfgOk })
        check(!!m && m.page === 'config' && m.width === String(width) && m.skin === skin && m.depth === '2', tag + '：根节点读数是配置页 / 档宽 / 皮肤 / 层级 2')
        check(!!m && !overflowOf(m), tag + '：没有横向溢出（文档 ' + (m && m.docScrollWidth) + ' ≤ viewport ' + (m && m.innerWidth) + '）')
        const struct = !!m && m.cfgSections.length === 3 && m.cfgSections[0] === 'vcs-config-meta' &&
          m.cfgSections[1] === 'page-section' && m.cfgSections[2] === 'page-section' &&
          m.cfgGroups.join(',') === 'identity,eol,hooksPath,credential' && m.cfgEditable.join(',') === 'true,false,false,false' &&
          m.cfgReadonly === 3 && m.cfgIdentityRows.join(',') === 'user.name,user.email' &&
          m.cfgRows.join(',') === 'core.autocrlf,core.hooksPath' && m.cfgGroupEmpty === 1 && m.cfgReads.join(',') === 'ok,ok'
        check(struct, tag + '：正文是元信息 → 相关配置 → 只读读取；四组折叠加身份两行、两行只读、一组空态与两处读数都在（实得 ' + (m && m.cfgGroups.join(',')) + '）')
        check(!!m && m.bodyPrimaries === 0 && m.primaries.length === 0 && m.hooksList === null && m.hookRows.length === 0, tag + '：正文里不再画能力行（该页 ' + configCaps.length + ' 条能力，主入口只在命令面板），没画第二套写入口、也没串到钩子页')
        check(!!m && m.cfgClipped.length === 0 && m.clipped.length === 0, tag + '：关键句子没有被截断（截断的：' + (m && m.cfgClipped.concat(m.clipped).join(',') || '无') + '）')
        await page.screenshot({ path: path.join(shotDir, 'config-' + skin + '-' + width + '.png') })
      }
    }
    // ---- I 组：钩子页（#1842 阶段 4）—— 钩子目录（事实格）→ 钩子清单（每文件一行）→ 手动运行 ----
    for (let s = 0; s < SKINS.length; s += 1) {
      const skin = SKINS[s]
      for (let w = 0; w < WIDTHS.length; w += 1) {
        const width = WIDTHS[w]
        const tag = '钩子页 ' + skin + ' / ' + width + ' 宽'
        await page.setViewportSize({ width: width, height: 1400 })
        const m = await renderAt(page, { page: 'hooks', width: width, skin: skin, hooks: cfgOk })
        check(!!m && m.page === 'hooks' && m.width === String(width) && m.skin === skin && m.depth === '2', tag + '：根节点读数是钩子页 / 档宽 / 皮肤 / 层级 2')
        check(!!m && !overflowOf(m), tag + '：没有横向溢出（文档 ' + (m && m.docScrollWidth) + ' ≤ viewport ' + (m && m.innerWidth) + '）')
        const struct = !!m && m.hooksSections.length === 3 &&
          m.hooksSections.every(function (x: string) { return x === 'page-section' }) &&
          m.hooksList === 'ok' && m.hooksListCount === '3' &&
          m.hookRows.join(',') === 'pre-commit,pre-commit.sample,post-merge' &&
          m.hookSamples.join(',') === '0,1,0' && m.hookRuns.join(',') === 'pre-commit,post-merge' &&
          m.hookCaps.join(',') === '12.6,12.6' && m.hooksGate === null && m.hooksInstall === 1 &&
          m.hooksDirAttr === '1' && m.cfgGroups.length === 0
        check(struct, tag + '：正文是钩子目录 → 钩子清单 → 手动运行；三个文件按名字排，示例与不可执行都标出来（实得 ' + (m && m.hookRows.join(',')) + '）')
        check(!!m && m.bodyPrimaries === 0 && m.primaries.length === 0 && m.cfgReads.length === 0, tag + '：正文里不再画能力行（该页 ' + hooksCaps.length + ' 条能力，主入口只在命令面板），没串到配置页')
        check(!!m && m.hooksClipped.length === 0 && m.clipped.length === 0, tag + '：关键句子没有被截断（截断的：' + (m && m.hooksClipped.concat(m.clipped).join(',') || '无') + '）')
        await page.screenshot({ path: path.join(shotDir, 'hooks-' + skin + '-' + width + '.png') })
      }
    }
    // ---- #1860：162 条能力的主入口从页面能力清单搬到命令面板 ----
    // 空查询一次列出全部能力，每条的 data-cap-primary 都落在面板行上；页面体里一条也没有。
    await page.setViewportSize({ width: 460, height: 1400 })
    const pal = await renderAt(page, { page: 'changes', width: 460, skin: 'dark', open: { palette: true } })
    const ledgerIds: string[] = await page.evaluate(() => window.__VC.vcPaletteRowsOf('').map((r: any) => r.id))
    check(!!pal && pal.paletteInput && pal.bodyPrimaries === 0 && pal.primaries.length === ledgerIds.length && pal.primaries.join(',') === ledgerIds.join(','), '命令面板空查询一次列出 ' + ledgerIds.length + ' 条能力，每条恰一个 data-cap-primary 且顺序与能力账本一致；页面体里没有主入口（实得 ' + (pal && pal.primaries.length) + ' 条）')
    // ---- J 组：两页的空态 / 失败态 / 版本门（460 宽深色各核对一次）----
    await page.setViewportSize({ width: 460, height: 1400 })
    const cfgErr = await renderAt(page, { page: 'config', width: 460, skin: 'dark', config: cfgStateOf({ readState: 'err', readError: 'not-repo' }) })
    check(!!cfgErr && cfgErr.cfgPageRead === 'err' && cfgErr.cfgReads.join(',') === 'err,err', '配置页：读失败时两处读数都标 err，页面照样画得出来')
    const hkHidden = await renderAt(page, { page: 'hooks', width: 460, skin: 'dark', hooks: cfgStateOf({ gitVersion: 'git version 2.34.1', hookRunVersion: { state: 'hidden', needed: '2.36.0', alternativeKey: 'vc.hooks.gate.alternative' } }) })
    check(!!hkHidden && hkHidden.hooksGate === 'hidden' && hkHidden.hookRuns.length === 0, '钩子页：2.36 以下版本不画运行按钮，改画版本门（实得 ' + (hkHidden && hkHidden.hookRuns.length) + ' 个按钮）')
    const hkEmpty = await renderAt(page, { page: 'hooks', width: 460, skin: 'dark', hooks: cfgStateOf({ hooks: { dir: 'D:/w/repo/.git/hooks', configured: null, readable: true, known: [], entries: [] } }) })
    check(!!hkEmpty && hkEmpty.hooksList === 'empty' && hkEmpty.hookRows.length === 0 && hkEmpty.hooksListCount === null, '钩子页：目录里一个文件都没有时画空态，不画「0 个文件」的清单')
    const hkErr = await renderAt(page, { page: 'hooks', width: 460, skin: 'dark', hooks: cfgStateOf({ readState: 'err', readError: 'not-repo' }) })
    check(!!hkErr && hkErr.hooksList === 'err' && hkErr.hooksListCount === null, '钩子页：读失败时清单标 err，不假装空目录')
    // 确认卡与结果：818 BR22/BR22b 的静态判据在真浏览器里的对照——都在面板里，且排在页尾折叠区之后。
    await page.setViewportSize({ width: 460, height: 1600 })
    const mb = await renderAt(page, {
      page: 'branch-tags', width: 460, skin: 'dark', branchBoard: branchBoard, nowMs: BRANCH_NOW,
      branchConfirm: { verb: '切换', target: 'feature/x', kind: 'switch' },
      branchResult: { state: 'fail', error: true, git: 'fatal: 分支 feature/x 未并入', step: 'branch-write', expected: '', actual: '', cause: '', reason: '' },
    })
    check(!!mb && mb.branchConfirm === 1 && mb.branchResult === 1, '分支与标签页：确认卡与结果都贴在面板里（确认 ' + (mb && mb.branchConfirm) + ' / 结果 ' + (mb && mb.branchResult) + '）')
    const order2 = mb && mb.branchOrder ? mb.branchOrder.join(',') : ''
    check(order2.indexOf('vcs-confirm') > order2.indexOf('vcs-branch2-forms') && order2.indexOf('vcs-result') > order2.indexOf('vcs-confirm'), '分支与标签页：确认卡与结果排在页尾折叠区之后（实得 ' + order2.slice(-90) + '）')
    await page.screenshot({ path: path.join(shotDir, 'branch-tags-confirm-dark-460.png') })
  } finally {
    await close()
  }
}

;(async () => {
  const locUrl = (f: string) => 'file://' + path.join(ROOT, sourcePath(f)).replace(/\\/g, '/')
  const shellLoc = await import(locUrl('src/client/kernel/locale-vcshell.js'))
  const vcw = await import(locUrl('src/client/kernel/locale-vcwrite.js'))
  // #1745：查询面板的文案在新词族 vcquery 里，缺了它 t() 取不到键。
  const vcq = await import(locUrl('src/client/kernel/locale-vcquery.js'))
  // #1842：配置页与钩子页的文案分别在 vcconfig / vchooks 两个词族里，缺了它们 t() 取不到键。
  const vccfg = await import(locUrl('src/client/kernel/locale-vcconfig.js'))
  const vchk = await import(locUrl('src/client/kernel/locale-vchooks.js'))
  // #1843 阶段 4：维护页与子模块页的词表也并进来，截图里显示真实中文而不是词条键；
  //   维护页里挂的整仓重写面板用的是 vcrewrite 一族，漏了它维护页截图仍会露出 vc.rewrite.* 词条键。
  const vcm = await import(locUrl('src/client/kernel/locale-vcmaintenance.js'))
  const vcs = await import(locUrl('src/client/kernel/locale-vcsubmodules.js'))
  const vcrw = await import(locUrl('src/client/kernel/locale-vcrewrite.js'))
  const dict = Object.assign({}, shellLoc.L_VCSHELL.zh, vcw.L_VCWRITE.zh, vcq.L_VCQUERY.zh, vccfg.L_VCCONFIG.zh, vchk.L_VCHOOKS.zh, vcm.L_VCMAINTENANCE.zh, vcs.L_VCSUBMODULES.zh, vcrw.L_VCREWRITE.zh)
  // vcText.js 单独拼进闭包时，相对时间窗口常量在真机闭包里由共享层提供；这里从 time-config 的
  // 生成物取同一份真值，挂到 window 上让闭包里的裸名读得到（与 verify-997 的手法一致）。
  const valuesMod = await import('file://' + path.join(ROOT, sourcePath('src/shared/time-config/values.js')).replace(/\\/g, '/'))
  const relMs = Number(valuesMod.VC_RELATIVE_WINDOW_MS)
  const stylesMod = await import('file://' + path.join(ROOT, 'src/client/views/versionControl/vcShellStyles.ts').replace(/\\/g, '/'))
  // #1829 阶段 4：新样式是独立叶子 vcPageStyles，运行时由 index.ts 接在 vcShellStyles 之后注入同一个样式表；
  //   这里量尺也要按同一顺序拼起来，否则页头、管理索引卡与遮罩拿不到新规则，窄档会量出假溢出。
  // 样式叶子里读 MOTION（闭包里由 build 先拼 kernel:motion 片）；这里单文件 import 渲染样式文本，
  // 没有闭包，得先把同一份真源补到 globalThis 上。
  globalThis.MOTION = (await import('file://' + path.join(ROOT, 'src/client/kernel/motion.js').replace(/\\/g, '/'))).MOTION
  const pageStylesMod = await import('file://' + path.join(ROOT, 'src/client/views/versionControl/vcPageStyles.ts').replace(/\\/g, '/'))
  // #1860：主屏原型样式是第二个新叶子，必须按 index.ts 的同一顺序接在 vcPageStyles 之后，
  //   否则身份行、四页签与改动页拿不到原型规则，这里量尺得到的宽高与真机不一致。
  // #1860 主屏原型样式按真源拆成八份叶子，这里按 index.ts 与 build.mts 的同序拼全。
  const protoStyleNames: string[] = ['vcProtoTokens', 'vcProtoChrome', 'vcProtoControls', 'vcProtoChanges', 'vcProtoComposer', 'vcProtoHistory', 'vcProtoWorktrees', 'vcProtoMenus']
  let protoCss: string = ''
  for (const name of protoStyleNames) {
    const mod: any = await import('file://' + path.join(ROOT, 'src/client/views/versionControl/' + name + '.ts').replace(/\\/g, '/'))
    protoCss += (mod['VC_PROTO_STYLE_' + name.slice('vcProto'.length).toUpperCase()] || []).join('\n') + '\n'
  }
  const css = 'html,body{margin:0;padding:0}#pane{width:100%}' + String(stylesMod.VC_SHELL_STYLE_TEXT || '') + String(pageStylesMod.VC_PAGE_STYLE_TEXT || '') + protoCss

  // 悬停薄预设 Tip 在真机构建里是 leaf:tip（排在全部视图叶子之前），本闭包不拼 kernel 叶子，这里按契约给同形函数组件桩：
  // 只把触发节点原样渲染出来（真 Tip 额外挂悬停气泡，不影响布局量尺）。维护页与诊断页的禁用原因经它挂，缺了就会渲染抛错。
  const tipStub = [
    '// 悬停薄预设 Tip 桩（真机构建里由 leaf:tip 提供，排在全部视图叶子之前）',
    'const Tip = function (props) { const p = props || {}; return p.children === undefined ? null : p.children }',
  ].join('\n')
  const closure = [tipStub].concat(VC_FILES.map((f: string) => (f.indexOf('src/client/') === 0 ? spliceableJs(f) : strip(read(f))))).join('\n')
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
