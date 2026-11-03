// tests/verify-1586-coverage.ts —— 版本管理页覆盖验收门禁（规格 #1586 第 10 节第 8 段，票 #1763 T27）
// 门禁归属: src/shared/version-control/src/capability-ledger.ts
// 门禁归属: src/client/views/versionControl/vcCapabilityPages.ts
// 门禁归属: src/client/views/versionControl/vcPalette.ts
// 门禁归属: src/client/views/versionControl/vcShellPrimitives.ts
// 门禁归属: src/client/views/versionControl/vcShellPages.ts
// 门禁归属: config/copy/vcshell.yaml
// 门禁归属: config/copy/vcplatform.yaml
//
// 这一扇门禁只做验收，不新造能力。它守规格第 10 节第 8 段的三条硬判据，外加本票要求的收尾事实：
//   一 命令面板搜 162 条能力全部命中，并且每条都跳到账本声明的那一页（不执行写动作）；
//   二 能力表计数 119 / 36 / 7 与页面分布求和都等于 162，页面上每条能力恰有一个主入口；
//   三 能力行在没展开操作面时画的是入口提示，不是「入口由后续票实现」这类假话（占位清零）；
//   四 五个既有门禁（818 / 841 / 能力账本 / 任务通道 / 真浏览器）在测试图里都有完成记录，
//      也就是「门禁真绿」有可查的完成证据；
//   五 反证（test-the-test）：把上面四组的输入改坏，同一套判据必须当场判红。
//
// 做法与 tests/verify-818-version-control-view.ts 同一套：把页面壳与账本这几个叶子拼成一段闭包、
// 按构建的口径转译后求值，用 React 服务端渲染出真 DOM 再量属性。词条用 config/copy 下的真 YAML，
// 断言落在用户读得到的文字上，不看键名。不拼整个入口组件：覆盖验收要的只是「壳 + 账本 + 面板」这一段。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1586-coverage.ts
'use strict'

const fs = require('fs')
const path = require('path')
const { printGateResult } = require('./lib/gate-result.ts')
const { sourceText } = require('./lib/source-text.ts')
const { compileFn } = require('./lib/eval-probe.ts')
const { TRANSPILE_OPTIONS } = require('../scripts/lib/transpile-unit.mts')
const YAML = require('yaml')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-coverage'

let total = 0
let failedCount = 0
let failed = false
const check = function (ok, msg) {
  total += 1
  if (!ok) { failedCount += 1; failed = true }
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
}

// ---------- 闭包：页面壳 + 账本 + 命令面板 + 能力列表（与 scripts/build.mts 的拼接同序） ----------
const CLOSURE_FILES = [
  'src/shared/version-control/src/capability-ledger.ts',
  // #1737 版本可用性判定（capabilityAvailability）与账本同源：命令面板的版本说明读的就是它。
  'src/shared/version-control/src/capabilities.ts',
  'src/client/views/versionControl/vcCapabilityPages.ts',
  'src/client/views/versionControl/vcShellPrimitives.ts',
  'src/client/views/versionControl/vcPalette.ts',
  'src/client/views/versionControl/vcCapabilityList.ts',
  // #1846 全库搜索页自己的版式（输入框在首屏、结果按页面分组）；壳渲染搜索页时调它，覆盖验收要拼进来。
  'src/client/views/versionControl/vcSearchPage.ts',
  // #1829 身份行与同步带拆成独立叶子；壳只在渲染时调用它，覆盖验收拼进来才能渲染页面。
  'src/client/views/versionControl/vcShellIdentity.ts',
  'src/client/views/versionControl/vcChangesView.ts',
  // #1829 阶段 4 三个共享件（与构建同序）：页头与页面原语、齿轮里的管理索引卡、分支浮层；壳渲染时要调它们。
  'src/client/views/versionControl/vcPageHead.ts',
  'src/client/views/versionControl/vcManageIndex.ts',
  'src/client/views/versionControl/vcBranchPopover.ts',
  'src/client/views/versionControl/vcShellPages.ts',
]
// 页面壳里直接调用的几个叶子（克隆向导、维护页重写、历史查询）在覆盖验收里不参与判定；
// 它们只影响那几页正文的内容，不影响能力行与主入口，所以给最小替身，不把二十来个叶子都拼进来。
const CLOSURE_FILLERS = [
  "const vcBlockKeyOf = function (reason) { return 'vc.shell.state.error' }",
  'const vcClonePageNode = function () { return null }',
  // #1758 T22：维护页壳在 maintenance 页无条件挂维护页正文；覆盖验收只量能力行与主入口，正文给最小替身。
  'const vcMaintenancePageNode = function () { return null }',
  'const vcRewritePageNode = function () { return null }',
  'const vcQueryPageNode = function () { return null }',
  'const vcDiagnosticsMountNode = function () { return null }',
].join('\n')
const EXPORTS = [
  'CAPABILITIES', 'CAPABILITY_TOTAL', 'PAGE_SURFACES', 'PAGE_COUNTS', 'LEVEL_COUNTS', 'PLACEMENT_COUNTS', 'FINAL_FORM_COUNTS',
  'VC_TAB_PAGES', 'VC_MANAGE_PAGES', 'VC_SIDE_PAGES', 'VC_SEARCH_PAGE', 'VC_SHELL_WIDTHS', 'VC_SHELL_SKINS',
  'vcPageDepthOf', 'vcPageCapabilitiesOf', 'vcCapabilityOf', 'vcPageRegistryOf', 'vcPageSurfaceOf', 'vcDeepLinkOf',
  'vcCapabilityAliasOf', 'vcPaletteMatchOf', 'vcPaletteRowsOf', 'vcPaletteTargetOf', 'vcCapabilityNeedsObjectOf', 'vcCapabilitySummaryOf',
  'vcRenderTabAt', 'vcRenderAllPages', 'vcBranchOverlayNode', 'vcShellCapabilityRowNode', 'vcCapabilitySurfaceKindOf',
  'vcSearchPageNode', 'vcSearchGroupsOf',
]
const stripExports = function (text) { return text.replace(/^(\s*)export\s+/gm, '$1') }
const buildView = function (patch) {
  let src = CLOSURE_FILES.map(function (rel) { return stripExports(sourceText(rel)) }).join('\n')
  src = src + '\n' + CLOSURE_FILLERS + '\n'
  if (patch) src = patch(src)
  const js = require('esbuild').transformSync(src, TRANSPILE_OPTIONS).code
  return compileFn([], js + '\nreturn { ' + EXPORTS.join(', ') + ' }\n')()
}

// ---------- 真词条：config/copy 下的 YAML 是界面文字的唯一真源，这里按语言合并成查表函数 ----------
const COPY_DIR = path.join(ROOT, 'config', 'copy')
const COPY_FILES = fs.readdirSync(COPY_DIR).filter(function (f) { return /\.yaml$/.test(f) }).sort()
const COPY_TEXT = {}
const COPY_RAW = {}
const LANGS = ['zh', 'en']
COPY_FILES.forEach(function (file) {
  const raw = fs.readFileSync(path.join(COPY_DIR, file), 'utf8')
  COPY_RAW[file] = raw
  const doc = YAML.parse(raw) || {}
  LANGS.forEach(function (lang) {
    if (!COPY_TEXT[lang]) COPY_TEXT[lang] = {}
    Object.assign(COPY_TEXT[lang], doc[lang] || {})
  })
})
const fill = function (s, p) {
  return p ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return k in p ? String(p[k]) : m }) : String(s)
}
const tOf = function (lang) {
  return function (key, params) {
    const dict = COPY_TEXT[lang] || {}
    const value = dict[key] === undefined ? String(key) : String(dict[key])
    return fill(value, params)
  }
}
const tZh = tOf('zh')
const tEn = tOf('en')
const h = React.createElement

const renderPage = function (view, opts, lang) {
  return renderToStaticMarkup(view.vcRenderTabAt(h, lang ? tEn : tZh, opts || {}))
}
const attrValuesOf = function (html, attr) {
  const out = []
  const re = new RegExp(attr + '="([^"]*)"', 'g')
  let m = re.exec(html)
  while (m) { out.push(m[1]); m = re.exec(html) }
  return out
}
const countOf = function (html, attr) { return attrValuesOf(html, attr).length }
const rowSegmentOf = function (html, capId) {
  const at = html.indexOf('data-cap-primary="' + capId + '"')
  if (at < 0) return ''
  const start = html.lastIndexOf('<li', at)
  const end = html.indexOf('</li>', at)
  return html.slice(start < 0 ? 0 : start, end < 0 ? html.length : end)
}
// 命中判据单独收成函数：正用与反证跑同一份，反证才证明得了判据不是摆设。
const paletteProblemsOf = function (view, caps) {
  const problems = []
  caps.forEach(function (cap) {
    const queries = [String(cap.id), String(cap.name), String(cap.command)]
    const alias = String(view.vcCapabilityAliasOf(cap) || '')
    if (alias) queries.push(alias)
    queries.forEach(function (query) {
      const rows = view.vcPaletteMatchOf(query) || []
      const hit = rows.some(function (row) { return row && row.id === cap.id })
      if (!hit) problems.push(cap.id + ' 按「' + query + '」搜不到自己')
    })
  })
  return problems
}
const targetProblemsOf = function (view, caps) {
  const problems = []
  caps.forEach(function (cap) {
    const target = view.vcPaletteTargetOf(cap.id)
    if (!target) { problems.push(cap.id + ' 没有跳转目标'); return }
    if (target.page !== cap.page) problems.push(cap.id + ' 跳到 ' + target.page + '，账本说它属于 ' + cap.page)
    if (target.executes !== false) problems.push(cap.id + ' 在命令面板里直接执行了')
    if (Number(target.depth) > 2) problems.push(cap.id + ' 的落点深度超过两层')
  })
  return problems
}
const countProblemsOf = function (view) {
  const problems = []
  const caps = view.CAPABILITIES || []
  const totalCount = view.CAPABILITY_TOTAL
  const sumOf = function (obj) { return Object.keys(obj || {}).reduce(function (n, k) { return n + Number(obj[k]) }, 0) }
  if (caps.length !== totalCount) problems.push('能力条数 ' + caps.length + ' 与 CAPABILITY_TOTAL ' + totalCount + ' 不一致')
  if (sumOf(view.LEVEL_COUNTS) !== totalCount) problems.push('级别分布求和不是 ' + totalCount)
  if (sumOf(view.PLACEMENT_COUNTS) !== totalCount) problems.push('落点分布求和不是 ' + totalCount)
  if (sumOf(view.FINAL_FORM_COUNTS) !== totalCount) problems.push('终局形态分布求和不是 ' + totalCount)
  if (sumOf(view.PAGE_COUNTS) !== totalCount) problems.push('页面分布求和不是 ' + totalCount)
  const forms = view.FINAL_FORM_COUNTS || {}
  if (Number(forms['操作']) !== 119 || Number(forms['只读']) !== 36 || Number(forms['说明']) !== 7) problems.push('终局形态不是规格写的 119 / 36 / 7（实得 ' + JSON.stringify(forms) + '）')
  const seen = {}
  caps.forEach(function (cap) {
    if (seen[cap.id]) problems.push('能力号重复：' + cap.id)
    seen[cap.id] = true
    if (!cap.primaryEntry) problems.push(cap.id + ' 没有登记主入口')
  })
  const registry = view.vcPageRegistryOf() || []
  if (registry.length !== (view.PAGE_SURFACES || []).length) problems.push('页面注册表页数与 PAGE_SURFACES 不一致')
  registry.forEach(function (page) {
    const got = (view.vcPageCapabilitiesOf(page.id) || []).length
    if (got !== Number(view.PAGE_COUNTS[page.id])) problems.push(page.id + ' 页的能力条数 ' + got + ' 与 PAGE_COUNTS 不一致')
  })
  return problems
}
// #1860 起能力清单从页面体退役：162 条能力的唯一主入口落在命令面板里。
//   判据因此从「逐页主入口与账本一致」改成两句话：页面体里一条主入口都不许再有；
//   命令面板空查询一次渲染 162 行，每行恰带一个 data-cap-primary，顺序与账本一致、无重复。
const primaryProblemsOf = function (view) {
  const problems = []
  const pages = (view.PAGE_SURFACES || []).map(function (p) { return p.id })
  pages.forEach(function (page) {
    const html = renderPage(view, { page: page, width: 460, skin: 'dark' })
    const got = attrValuesOf(html, 'data-cap-primary')
    if (got.length > 0) problems.push(page + ' 页正文里还有 ' + got.length + ' 个主入口标记（应全部只在命令面板）')
    if (html.indexOf('data-vc-cap-list') >= 0) problems.push(page + ' 页正文里还有能力清单')
  })
  const paletteHtml = renderPage(view, { page: 'changes', width: 460, skin: 'dark', open: { palette: true } })
  const ids = attrValuesOf(paletteHtml, 'data-cap-primary')
  const want = (view.CAPABILITIES || []).map(function (c) { return String(c.id) })
  if (ids.join(',') !== want.join(',')) problems.push('命令面板空查询列出的主入口是 [' + ids.join(',') + ']，账本是 [' + want.join(',') + ']')
  const unique = {}
  ids.forEach(function (id) { unique[id] = true })
  if (Object.keys(unique).length !== ids.length) problems.push('命令面板里有重复主入口')
  return problems
}
const placeholderProblemsOf = function (entries) {
  const problems = []
  const bad = /后续票|later ticket/i
  entries.forEach(function (entry) {
    if (bad.test(String(entry.text))) problems.push(entry.name + ' 还留着「入口由后续票实现」这类假话')
  })
  return problems
}
const GATE_NAME_RE = /\.(test|spec)\.(js|mjs|cjs|ts|mts|cts)$|\.(js|mjs|cjs|ts|mts|cts)$/
const gateNameOf = function (file) { return path.basename(String(file || '')).replace(GATE_NAME_RE, '') }
const REQUIRED_COMPLETION_GATES = [
  'verify-818-version-control-view',
  'verify-841-write-phones',
  'verify-1586-capability-ledger',
  'verify-1586-task-channel',
  'verify-1586-vc-visual-browser',
]
const completionProblemsOf = function (map) {
  const problems = []
  const gates = Array.isArray(map && map.gates) ? map.gates : []
  REQUIRED_COMPLETION_GATES.forEach(function (name) {
    const rows = gates.filter(function (row) { return gateNameOf(row.file) === name })
    if (rows.length !== 1) { problems.push(name + ' 在测试图里出现 ' + rows.length + ' 次（应恰好一次）'); return }
    const row = rows[0]
    if (row.completionRecord !== true) problems.push(name + ' 没有完成记录（门禁真绿拿不出证据）')
    if (!(Number(row.expectedAssertions) > 0)) problems.push(name + ' 的期望断言数不是正数')
  })
  return problems
}

// 版本说明：账本里登记了最低版本的 19 条能力，在「比最低版本低一档」的 git 上必须在命令面板行里
// 读得到「需要 X」与账本登记的替代做法；版本够（2.49）或版本未知（还没读到首屏）时不许画说明。
// 判据与反证跑同一份 versionProblemsOf，反证才证明得了这条判据不是摆设。
const htmlTextOf = function (seg) {
  return String(seg)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}
const lowVersionOf = function (minVersion) {
  const m = /^(\d+)\.(\d+)/.exec(String(minVersion || ''))
  return m ? 'git version ' + m[1] + '.' + String(Math.max(0, Number(m[2]) - 1)) + '.0' : ''
}
// #1846：版本说明只画在命令面板里（搜索页不画版本说明），所以这里按「别的页面上打开命令面板」来量。
const paletteVersionHtmlOf = function (view, capId, version) {
  const reads = version === null ? null : { screen: { state: 'ok', data: { gitVersion: version } } }
  return renderPage(view, { page: 'maintenance', width: 460, skin: 'dark', open: { palette: true }, seed: { query: capId }, reads: reads })
}
// #1776 M1：真实页签的首屏读数在 reads.firstScreen 的七片里，version 片才是新的版本来源。
// 这里按同一口径另造一份「只有首屏快照」的读数：命令面板的版本说明要能在这一份上同样成立。
const firstScreenReadsOf = function (version: any, state: any) {
  const slice = state === 'err'
    ? { state: 'err', data: null, error: { kind: 'env', message: '首屏读失败' } }
    : { state: 'ok', data: version === null ? null : { gitVersion: version }, error: null }
  return { firstScreen: { state: 'ok', data: { contract: 'version-control.first-screen', version: 2, readAtMs: 1, slices: { version: slice } } } }
}
const paletteVersionHtmlFirstOf = function (view: any, capId: any, version: any) {
  return renderPage(view, { page: 'maintenance', width: 460, skin: 'dark', open: { palette: true }, seed: { query: capId }, reads: firstScreenReadsOf(version, 'ok') })
}
const paletteVersionHtmlFirstErrOf = function (view: any, capId: any) {
  return renderPage(view, { page: 'maintenance', width: 460, skin: 'dark', open: { palette: true }, seed: { query: capId }, reads: firstScreenReadsOf(null, 'err') })
}
const versionSegmentOf = function (html, capId) {
  const at = html.indexOf('data-vc-palette-version="' + capId + '"')
  if (at < 0) return ''
  const start = html.lastIndexOf('<span', at)
  const end = html.indexOf('</li>', at)
  return htmlTextOf(html.slice(start < 0 ? 0 : start, end < 0 ? html.length : end))
}
const versionProblemsWithOf = function (view, caps, htmlOf) {
  const problems = []
  caps.forEach(function (cap) {
    if (!cap.versionPolicy) { problems.push(cap.id + ' 没有登记版本策略，不该按版本限制验收'); return }
    if (!cap.versionAlternative) { problems.push(cap.id + ' 没有登记替代做法'); return }
    const segment = versionSegmentOf(htmlOf(view, cap.id, lowVersionOf(cap.minVersion)), cap.id)
    if (!segment) { problems.push(cap.id + ' 在 ' + lowVersionOf(cap.minVersion) + ' 上看不到版本说明'); return }
    const want = cap.versionPolicy === 'degrade' ? 'degraded' : 'hidden'
    if (segment.indexOf('data-vc-palette-version-state="' + want + '"') < 0) problems.push(cap.id + ' 的说明状态不是 ' + want)
    if (segment.indexOf('data-vc-palette-version-need="' + cap.minVersion + '"') < 0) problems.push(cap.id + ' 的说明没带最低版本 ' + cap.minVersion)
    if (segment.indexOf('需要 ' + cap.minVersion) < 0) problems.push(cap.id + ' 的说明里读不到「需要 ' + cap.minVersion + '」')
    if (segment.indexOf(String(cap.versionAlternative)) < 0) problems.push(cap.id + ' 的说明里读不到替代做法：' + cap.versionAlternative)
  })
  return problems
}
const versionProblemsOf = function (view, caps) { return versionProblemsWithOf(view, caps, paletteVersionHtmlOf) }

async function main() {
  let view = null
  try { view = buildView(null) } catch (e) { console.error('闭包装配失败：' + ((e && e.stack) || e)); process.exit(1) }

  // ---- 一 命令面板：162 条能力各自用 id / 名称 / 命令原文（有别名时加别名）都搜得到自己 ----
  console.log('\n一 命令面板逐条命中（' + view.CAPABILITY_TOTAL + ' 条）')
  view.CAPABILITIES.forEach(function (cap) {
    check(paletteProblemsOf(view, [cap]).length === 0, '一 ' + cap.id + ' 按 id / 名称 / 命令原文' + (view.vcCapabilityAliasOf(cap) ? ' / 别名' : '') + ' 都搜得到它自己')
  })
  const emptyRows = view.vcPaletteMatchOf('')
  check(emptyRows.length === view.CAPABILITY_TOTAL, '一 查询为空时列出全部 ' + view.CAPABILITY_TOTAL + ' 条（空查询不是零结果）')
  check(view.vcPaletteMatchOf('zzz-not-a-capability-zzz').length === 0, '一 乱串零命中（不混进无关条目）')

  // ---- 二 命令面板的跳转落点：每条都跳到账本声明的页面，只打开位置不执行 ----
  console.log('\n二 命令面板跳转落点（' + view.CAPABILITY_TOTAL + ' 条）')
  view.CAPABILITIES.forEach(function (cap) {
    check(targetProblemsOf(view, [cap]).length === 0, '二 ' + cap.id + ' 跳到 ' + cap.page + ' 页、不直接执行、深度不超过两层')
  })

  // ---- 三 计数与分布 ----
  console.log('\n三 计数与分布')
  const countProblems = countProblemsOf(view)
  check(countProblems.length === 0, '三 162 条、三组分布求和、119 / 36 / 7 与页面分布逐项对齐' + (countProblems.length ? '：' + countProblems.join('；') : ''))

  // ---- 四 主入口只在命令面板：页面体没有清单与标记，面板一次列全 162 条且顺序与账本一致 ----
  console.log('\n四 主入口只在命令面板')
  const pages = view.PAGE_SURFACES.map(function (p) { return p.id })
  pages.forEach(function (page) {
    const html = renderPage(view, { page: page, width: 460, skin: 'dark' })
    check(attrValuesOf(html, 'data-cap-primary').length === 0 && html.indexOf('data-vc-cap-list') < 0, '四 ' + page + ' 页正文里没有能力清单、也没有主入口标记')
  })
  const primaryProblems = primaryProblemsOf(view)
  check(primaryProblems.length === 0, '四 命令面板空查询列出 162 条主入口、顺序与账本一致、无重复' + (primaryProblems.length ? '：' + primaryProblems.join('；') : ''))
  const t1314 = view.vcPaletteTargetOf('13.14')
  check(!!t1314 && t1314.page === 'commits', '四 13.14 的主入口落在命令面板、跳转落点是提交历史页（实得 ' + (t1314 && t1314.page) + '）')
  // #1846：搜索页改成独立版式——首屏就是它自己的输入框，命令面板不再嵌进能力行，也不该在这一页出现。
  const searchHtml = renderPage(view, { page: 'search', width: 460, skin: 'dark' })
  check(searchHtml.indexOf('data-vc-search-input') >= 0 && searchHtml.indexOf('data-vc-palette-input') < 0, '四 全库搜索页画自己的搜索输入框（命令面板不再嵌进这一页）')

  // ---- 五 占位清零：能力行画入口提示不画假话，分支悬浮层改成标签 + 指路说明 ----
  console.log('\n五 占位清零')
  const allPagesHtml = renderToStaticMarkup(view.vcRenderAllPages(h, tZh, {}))
  // #1860：能力行退役后，旧的能力提示与「未实现」标记一个都不该再出现在页面里；
  //   能力说明与命令原文现在只在命令面板的行里（一 章已逐条验过搜得到）。
  check(countOf(allPagesHtml, 'data-cap-hint') === 0 && countOf(allPagesHtml, 'data-cap-pending') === 0, '五 全部页面里不再有旧能力提示（data-cap-hint）与「未实现」标记（data-cap-pending）')
  const paletteHtml = renderPage(view, { page: 'changes', width: 460, skin: 'dark', open: { palette: true } })
  check(paletteHtml.indexOf('data-cap-primary') >= 0 && paletteHtml.indexOf(tZh('vc.shell.cap.hint')) < 0, '五 命令面板行承担能力入口，不再画「这一行只列能力与命令原文」的旧提示')
  const branchHtml = renderPage(view, { page: 'changes', width: 460, skin: 'dark', open: { branch: true } })
  const branchActions = attrValuesOf(branchHtml, 'data-vc-branch-action')
  check(branchHtml.indexOf('data-vc-branch-overlay="1"') >= 0 && branchActions.join(',') === 'list,create,delete,merge,rebase', '五 分支悬浮层仍列出五个动作名（顺序不变）')
  check(/<span[^>]*data-vc-branch-action="list"/.test(branchHtml) && !/<button[^>]*data-vc-branch-action=/.test(branchHtml), '五 分支悬浮层的五个动作是标签不是按钮（没有假按钮）')
  check(branchHtml.indexOf(tZh('vc.shell.branch.pointer')) >= 0, '五 分支悬浮层给出指路说明（这五个动作在「管理 › 分支与标签」页做）')
  const copyEntries = COPY_FILES.map(function (file) { return { name: 'config/copy/' + file, text: COPY_RAW[file] } })
  const copyProblems = placeholderProblemsOf(copyEntries)
  check(copyProblems.length === 0, '五 config/copy 全部词表不再出现「后续票 / later ticket」' + (copyProblems.length ? '：' + copyProblems.join('；') : ''))
  const zhPlaceholders = placeholderProblemsOf([{ name: '中文页面', text: allPagesHtml }])
  const enPlaceholders = placeholderProblemsOf([{ name: '英文页面', text: renderToStaticMarkup(view.vcRenderAllPages(h, tEn, {})) }])
  check(zhPlaceholders.length === 0 && enPlaceholders.length === 0, '五 中英两种语言渲染出的全部页面都不出现「后续票 / later ticket」')
  const platformCopy = YAML.parse(COPY_RAW['vcplatform.yaml'])
  const migrateCopy = platformCopy && platformCopy.zh ? platformCopy.zh : {}
  const migrateTruth = String(migrateCopy['vc.migrate.lede'] || '') + String(migrateCopy['vc.migrate.note.8.16'] || '') + String(migrateCopy['vc.migrate.note.11.12'] || '') + String(migrateCopy['vc.migrate.note.11.13'] || '')
  check(migrateTruth.length > 0 && /克隆|归档|离线包/.test(migrateTruth) && migrateTruth.indexOf('后续') < 0, '五 迁移与备份页四条说明改成现状真话（克隆向导、归档导出、离线包都在本页正文里）')
  const commentFiles = [
    'src/client/views/versionControl/vcShellPrimitives.ts',
    'src/client/views/versionControl/vcShellPages.ts',
  ]
  const commentProblems = placeholderProblemsOf(commentFiles.map(function (rel) { return { name: rel, text: sourceText(rel) } }))
  check(commentProblems.length === 0, '五 壳的两处注释不再写「业务入口由后续票逐条接」' + (commentProblems.length ? '：' + commentProblems.join('；') : ''))

  // ---- 六 五个既有门禁的完成记录：数字从测试图里读，不在这里硬编码 ----
  console.log('\n六 五个既有门禁的完成记录')
  const gateMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'gate-map.json'), 'utf8'))
  const completionProblems = completionProblemsOf(gateMap)
  check(completionProblems.length === 0, '六 五个门禁在测试图里各有完成记录与正数期望断言' + (completionProblems.length ? '：' + completionProblems.join('；') : ''))
  REQUIRED_COMPLETION_GATES.forEach(function (name) {
    const row = (gateMap.gates || []).filter(function (g) { return gateNameOf(g.file) === name })[0]
    check(!!row && row.completionRecord === true && Number(row.expectedAssertions) > 0, '六 ' + name + ' 的完成记录可查（期望 ' + (row ? row.expectedAssertions : '?') + ' 条断言）')
  })

  // ---- 七 反证：把上面几组的输入改坏，同一套判据必须当场判红 ----
  console.log('\n七 反证')
  const brokenPaletteCaps = view.CAPABILITIES.map(function (cap) {
    return cap.id === '2.1' ? Object.assign({}, cap, { command: 'git commit --nonsense-zzz', name: '一条改名后的能力' }) : cap
  })
  check(paletteProblemsOf(view, brokenPaletteCaps).length > 0, '七 反证：把 2.1 的命令原文与名称改掉 → 命令面板命中判据当场判红')
  const brokenTargetCaps = view.CAPABILITIES.map(function (cap) {
    return cap.id === '2.1' ? Object.assign({}, cap, { page: 'search' }) : cap
  })
  check(targetProblemsOf(view, brokenTargetCaps).length > 0, '七 反证：把 2.1 的页面改成 search → 跳转落点判据当场判红')
  const brokenCounts = Object.assign({}, view, { CAPABILITY_TOTAL: view.CAPABILITY_TOTAL - 1 })
  check(countProblemsOf(brokenCounts).length > 0, '七 反证：把 CAPABILITY_TOTAL 改少一条 → 计数判据当场判红')
  check(placeholderProblemsOf([{ name: '假词表', text: '入口由后续票实现' }]).length === 1, '七 反证：往词表塞回「入口由后续票实现」→ 占位清零判据当场判红')
  const brokenMap = JSON.parse(JSON.stringify(gateMap))
  const victim = (brokenMap.gates || []).filter(function (g) { return gateNameOf(g.file) === 'verify-818-version-control-view' })[0]
  if (victim) victim.completionRecord = false
  check(completionProblemsOf(brokenMap).length > 0, '七 反证：把 818 的完成记录抹掉 → 完成记录判据当场判红')
  const missingMap = JSON.parse(JSON.stringify(gateMap))
  missingMap.gates = (missingMap.gates || []).filter(function (g) { return gateNameOf(g.file) !== 'verify-841-write-phones' })
  check(completionProblemsOf(missingMap).length > 0, '七 反证：把 841 从测试图里删掉 → 完成记录判据当场判红')


  // ---- 八 版本说明：19 条版本限制逐条构造低版本，面板行必须读出最低版本与替代做法 ----
  console.log('\n八 版本说明（19 条版本限制逐条构造低版本）')
  const limited = view.CAPABILITIES.filter(function (cap) { return !!cap.versionPolicy })
  check(limited.length === 19, '八 账本里登记了最低版本的能力恰好 19 条（实得 ' + limited.length + '）')
  limited.forEach(function (cap) {
    check(versionProblemsOf(view, [cap]).length === 0, '八 ' + cap.id + ' 在 ' + lowVersionOf(cap.minVersion) + ' 上读得到「需要 ' + cap.minVersion + '」与替代做法（' + cap.versionPolicy + '）')
  })
  const tooNew = limited.filter(function (cap) {
    return versionSegmentOf(paletteVersionHtmlOf(view, cap.id, 'git version 2.49.0'), cap.id) !== ''
  }).map(function (cap) { return cap.id })
  check(tooNew.length === 0, '八 版本够（2.49）时 19 条都不画版本说明' + (tooNew.length ? '：' + tooNew.join('、') : ''))
  const unknownVersion = limited.filter(function (cap) {
    return versionSegmentOf(paletteVersionHtmlOf(view, cap.id, null), cap.id) !== ''
      || versionSegmentOf(paletteVersionHtmlOf(view, cap.id, ''), cap.id) !== ''
  }).map(function (cap) { return cap.id })
  check(unknownVersion.length === 0, '八 版本未知（没有读数或读数为空）时不写「版本不支持」' + (unknownVersion.length ? '：' + unknownVersion.join('、') : ''))
  const plainCap = view.CAPABILITIES.filter(function (cap) { return !cap.versionPolicy })[0]
  check(versionSegmentOf(paletteVersionHtmlOf(view, plainCap.id, 'git version 2.10.0'), plainCap.id) === '', '八 没有登记版本限制的能力（' + plainCap.id + '）在任何版本上都不画版本说明')
  const versionVictim = limited[0]
  const keptAlternative = versionVictim.versionAlternative
  versionVictim.versionAlternative = ''
  const brokenVersion = versionProblemsOf(view, [versionVictim])
  versionVictim.versionAlternative = keptAlternative
  check(brokenVersion.length > 0, '八 反证：把 ' + versionVictim.id + ' 的替代做法清空 → 版本说明判据当场判红')

  // ---- 九 真实页签入口（#1776 M1）：入口只做委托、四个固定页签与 16 页仍由同一页面壳画出、
  //      版本说明在首屏七片的 version 片上同样成立 ----
  console.log('\n九 真实页签入口与首屏七片（#1776 M1）')
  const entrySrc = sourceText('src/client/views/versionControl/VersionControlTab.ts')
  check(entrySrc.indexOf('React.createElement(VcRealTab, props)') >= 0, '九 入口组件只把入参原样交给真实页签容器 VcRealTab（入口不再自己渲染）')
  check(entrySrc.indexOf('vcBlocksOf') < 0 && entrySrc.indexOf('data-vc-root') < 0, '九 入口组件里没有旧块渲染路径（没有 vcBlocksOf、没有 data-vc-root）')
  check(entrySrc.indexOf('--vc-warn,#f59e0b') >= 0, '九 入口组件仍保留本页配色表（容器身份色门禁按这一行找警告色令牌）')
  const fixedTabsHtml = renderPage(view, { page: 'changes', width: 460, skin: 'dark' })
  check(attrValuesOf(fixedTabsHtml, 'data-vc-tab').join(',') === view.VC_TAB_PAGES.join(','), '九 四个固定页签按账本顺序画在同一行（改动、提交历史、工作树、贮藏）')
  const allPagesHtml2 = renderToStaticMarkup(view.vcRenderAllPages(h, tZh, {}))
  const allPageIds = attrValuesOf(allPagesHtml2, 'data-vc-page')
  check(allPageIds.join(',') === view.PAGE_SURFACES.map(function (p) { return p.id }).join(','), '九 一次渲染把 16 页都画出来：四个主页签、九个管理分区、两个侧页、搜索页')
  const firstScreenLimited = view.CAPABILITIES.filter(function (cap) { return !!cap.versionPolicy })
  firstScreenLimited.forEach(function (cap) {
    check(versionProblemsWithOf(view, [cap], paletteVersionHtmlFirstOf).length === 0, '九 ' + cap.id + ' 的版本说明在首屏七片的 version 片上同样读得到（需要 ' + cap.minVersion + ' 与替代做法）')
  })
  const firstNotNew = firstScreenLimited.filter(function (cap) {
    return versionSegmentOf(paletteVersionHtmlFirstOf(view, cap.id, 'git version 2.49.0'), cap.id) !== ''
  }).map(function (cap) { return cap.id })
  check(firstNotNew.length === 0, '九 首屏七片读到 2.49 时 19 条都不画版本说明' + (firstNotNew.length ? '：' + firstNotNew.join('、') : ''))
  const firstFailedCaps = firstScreenLimited.filter(function (cap) {
    return versionSegmentOf(paletteVersionHtmlFirstOf(view, cap.id, null), cap.id) !== '' ||
      versionSegmentOf(paletteVersionHtmlFirstErrOf(view, cap.id), cap.id) !== ''
  }).map(function (cap) { return cap.id })
  check(firstFailedCaps.length === 0, '九 首屏七片读不到版本（片失败或读数为空）时不写「版本不支持」' + (firstFailedCaps.length ? '：' + firstFailedCaps.join('、') : ''))
  const liveKeys = [
    'vc.shell.live.refresh', 'vc.shell.live.loading', 'vc.shell.live.readAt', 'vc.shell.live.back',
    'vc.shell.live.link.palette', 'vc.shell.live.link.rebase', 'vc.shell.live.link.conflicts',
    'vc.shell.live.fail.whole', 'vc.shell.live.fail.slice', 'vc.shell.live.retry', 'vc.shell.live.retryAll',
    'vc.shell.live.emptyCwd',
    'vc.shell.slice.workspace', 'vc.shell.slice.changes', 'vc.shell.slice.history', 'vc.shell.slice.worktrees',
    'vc.shell.slice.stashes', 'vc.shell.slice.sync', 'vc.shell.slice.version',
  ]
  const missingLiveKeys = liveKeys.filter(function (key) {
    return !COPY_TEXT.zh[key] || !COPY_TEXT.en[key] || !String(COPY_TEXT.zh[key]).trim() || !String(COPY_TEXT.en[key]).trim()
  })
  check(missingLiveKeys.length === 0, '九 真实页签新增的 ' + liveKeys.length + ' 个词条中英成对齐全' + (missingLiveKeys.length ? '：缺 ' + missingLiveKeys.join('、') : ''))

  // ---- 十 管理分区与侧页接上真实读数与动作（#1776 M2）：每一页要成立，源码里必须同时看见三样东西 ——
  //      进入这一页时发哪条读数电话、页上动作走「预检电话 → 确认卡 → 凭票执行电话」里的哪两扇门、
  //      以及容器把这页的数据与回调递进了页面壳（不再落骨架）。这一组只守接线没被哪次重构剪断；
  //      真点一遍页面是 verify-1776-vc-live-tab 那扇真挂载门禁的事，这里不重复起浏览器。
  console.log('\n十 管理分区与侧页的真实读数与动作（#1776 M2）')
  const m2Sources: any = {
    model: sourceText('src/client/views/versionControl/vcRealManage.ts'),
    reads: sourceText('src/client/views/versionControl/vcRealManageReads.ts'),
    act1: sourceText('src/client/views/versionControl/vcRealManageActions.ts'),
    act2: sourceText('src/client/views/versionControl/vcRealManageActions2.ts'),
    act3: sourceText('src/client/views/versionControl/vcRealManageActions3.ts'),
    side: sourceText('src/client/views/versionControl/vcRealManageSide.ts'),
    shell: sourceText('src/client/views/versionControl/vcRealShell.ts'),
    tab: sourceText('src/client/views/versionControl/vcRealTab.ts'),
    pages: sourceText('src/client/views/versionControl/vcShellPages.ts'),
    delegate: sourceText('src/client/views/versionControl/vcRealDelegate.ts'),
    branches: sourceText('src/client/views/versionControl/vcBranches.ts'),
    remote: sourceText('src/client/views/versionControl/vcRemoteData.ts'),
    sync: sourceText('src/client/views/versionControl/vcSyncData.ts'),
    config: sourceText('src/client/views/versionControl/vcConfigOps.ts'),
    diag: sourceText('src/client/views/versionControl/vcDiagnostics.ts'),
    platform: sourceText('src/client/views/versionControl/vcPlatformData.ts'),
    migrate: sourceText('src/client/views/versionControl/vcMigrateData.ts'),
    submodules: sourceText('src/client/views/versionControl/vcSubmodulesData.ts'),
    conflicts: sourceText('src/client/views/versionControl/vcConflictsOps.ts'),
    rebase: sourceText('src/client/views/versionControl/vcRebaseOps.ts'),
  }
  const missingNeedlesOf = function (sources: any, need: any[]): string[] {
    return need.filter(function (pair: any) {
      return String(sources[pair[0]] || '').indexOf(pair[1]) < 0
    }).map(function (pair: any) { return pair[0] + ' 里找不到「' + pair[1] + '」' })
  }
  const pageWiring: any[] = [
    {
      label: '分支与标签页（wf.gitBranches 读数、wf.gitBranchCheck / wf.gitBranchWrite 两扇门、分支板与确认卡递进壳）',
      need: [
        ['reads', "'branch-tags': readBranch"],
        ['branches', 'wf.gitBranchCheck'],
        ['branches', 'wf.gitBranchWrite'],
        ['act1', 'vcBranchCheck'],
        ['act1', 'vcBranchWrite'],
        ['model', 'branchBoard: vcBranchBoardOf(branches)'],
        ['model', 'branchConfirm: mm.branchConfirm'],
        ['tab', 'onBranchRetry'],
      ],
    },
    {
      label: '远端页（wf.gitRemoteList 读数、四条远端写电话、同步预检 wf.gitSyncCheck 与执行 wf.gitSyncWrite）',
      need: [
        ['reads', 'remote: readRemote'],
        ['remote', 'wf.gitRemoteList'],
        ['remote', 'wf.gitRemoteAdd'],
        ['act1', 'VC_REMOTE_WRITE_PHONES'],
        ['sync', 'wf.gitSyncCheck'],
        ['sync', 'wf.gitSyncWrite'],
        ['act1', 'vcReadSyncCheck'],
        ['act1', 'vcRunSyncWrite'],
        ['model', 'vcRealManageShellReadsOf'],
      ],
    },
    {
      label: '子模块页（wf.gitSubmodules 读数、createSubmodulesOpsOf 的预检与执行、板与交互态递进壳）',
      need: [
        ['reads', 'submodules: readSubmodules'],
        ['submodules', 'wf.gitSubmodules'],
        ['act2', 'createSubmodulesOpsOf'],
        ['tab', 'submodules: manage.submodules ? manage.submodules.board : null'],
      ],
    },
    {
      label: '维护页（重写与维护两块面板仍在页面壳里挂出来，页面只读不写）',
      need: [
        ['pages', "page === 'maintenance'"],
        ['pages', 'vcRewritePageNode'],
        ['pages', 'vcMaintenancePageNode'],
      ],
    },
    {
      label: '迁移页（进入发 wf.gitMigrateCheck、执行发 wf.gitMigrateWrite、导出向导的补丁清单电话与五个回调）',
      need: [
        ['migrate', 'wf.gitMigrateCheck'],
        ['migrate', 'wf.gitMigrateWrite'],
        ['act3', 'vcReadMigrateCheck'],
        ['act3', 'vcRunMigrateWrite'],
        ['act3', 'vcReadPatchFiles'],
        ['tab', "migrateRef.current.check('init')"],
        ['tab', 'migrate: manage.migrateExport'],
        ['tab', 'migrateReads: manage.migratePatches'],
      ],
    },
    {
      label: '配置页（wf.gitConfigRead 读数、wf.gitConfigCheck / wf.gitConfigWrite 两扇门、配置状态与两个回调递进壳）',
      need: [
        ['reads', 'config: readConfig'],
        ['config', 'wf.gitConfigCheck'],
        ['config', 'wf.gitConfigWrite'],
        ['act2', 'vcConfigCheckCallOf'],
        ['act2', 'vcConfigWriteCallOf'],
        ['tab', 'config: manage.config'],
        ['tab', 'onConfig: function'],
      ],
    },
    {
      label: '钩子页（与配置页共用同一份读数与状态，执行结果按钩子口径回写）',
      need: [
        ['reads', 'config: readConfig'],
        ['act2', 'vcHooksApplyReply'],
        ['tab', 'hooks: manage.config'],
        ['tab', 'onHooks: function'],
      ],
    },
    {
      label: '诊断页（wf.gitDiagnosticsRead 读数、诊断动作状态与确认/取消五个回调递进壳）',
      need: [
        ['reads', 'diagnostics: readDiagnostics'],
        ['diag', 'wf.gitDiagnosticsRead'],
        ['tab', 'diagnostics: diag.state()'],
        ['tab', 'onDiagnosticsConfirm'],
      ],
    },
    {
      label: '平台页（wf.gitPlatformRead 读数、wf.gitPlatformCheck / wf.gitRequestPull 两处动作、平台数据与两个回调递进壳）',
      need: [
        ['reads', 'platform: readPlatform'],
        ['platform', 'wf.gitPlatformRead'],
        ['act2', 'vcReadPlatform'],
        ['act2', 'vcRunRequestPull'],
        ['tab', 'platform: manage.platform'],
        ['tab', 'onPlatformRequestPull: function'],
      ],
    },
    {
      label: '冲突页（wf.gitConflicts 读数、共享常量 VC_CONFLICTS_PHONES 的预检与执行两扇门、冲突模型递进壳）',
      need: [
        ['side', 'VC_CONFLICTS_PHONES.check'],
        ['side', 'VC_CONFLICTS_PHONES.write'],
        ['side', 'conflict-list'],
        ['conflicts', 'wf.gitConflictCheck'],
        ['conflicts', 'wf.gitConflictWrite'],
        ['model', 'conflicts: vcRealConflictsModelOf(mm.conflicts)'],
        ['tab', 'conflicts: conflictsModel'],
      ],
    },
    {
      label: '变基页（wf.gitRebaseRead 读数、共享常量 VC_REBASE_PHONES 的预检与执行两扇门、撤销面板换挂自带状态组件）',
      need: [
        ['side', 'VC_REBASE_PHONES.check'],
        ['side', 'VC_REBASE_PHONES.write'],
        ['rebase', 'wf.gitRebaseRead'],
        ['model', 'rebase: vcRealRebaseModelOf(mm.rebase)'],
        ['model', 'undo: mm.undo || vcUndoStateNew()'],
        ['tab', 'rebase: rebaseModel'],
        ['pages', 'VC_UNDO_PANEL'],
      ],
    },
  ]
  pageWiring.forEach(function (page: any) {
    const problems = missingNeedlesOf(m2Sources, page.need)
    check(problems.length === 0, '十 ' + page.label + (problems.length ? ' —— 缺 ' + problems.join('；') : ''))
  })
  // 四组横向接线：它们不属于某一页，但管理页与侧页能被操作全靠这四处。
  const crossWiring: any[] = [
    {
      label: '三时机刷新（进入、任务完成后、手动）与片级重试都还在容器这一层',
      need: [
        ['tab', "refresh('enter')"],
        ['tab', "refresh('task-done')"],
        ['shell', "'manual'"],
        ['shell', 'data-vc-slice-retry'],
        ['shell', 'data-vc-refresh'],
      ],
    },
    {
      label: '命令面板的开合、搜索与落点高亮由根节点事件委托接',
      need: [
        ['delegate', 'palette-input'],
        ['delegate', 'palette-row'],
        ['shell', 'vcRealSelectCapOf'],
        ['shell', 'vcPaletteTargetOf'],
      ],
    },
    {
      label: '分支浮层五个动作项与能力行都能点：点了跳到对应页面并高亮，不自动执行',
      need: [
        ['delegate', 'data-vc-branch-action'],
        ['delegate', 'capRow'],
        ['shell', 'branchOverlay'],
        ['act1', 'branchOverlay'],
      ],
    },
    {
      label: '任务区轮询、取消与任务完成后的重读接线还在',
      need: [
        ['tab', 'onCancel: function (taskId'],
        ['act3', 'vcTaskQuery'],
        ['act3', 'vcTaskCancel'],
        ['pages', 'vcTaskPanelNode'],
      ],
    },
  ]
  crossWiring.forEach(function (cross: any) {
    const problems = missingNeedlesOf(m2Sources, cross.need)
    check(problems.length === 0, '十 ' + cross.label + (problems.length ? ' —— 缺 ' + problems.join('；') : ''))
  })
  // 反证（test-the-test）：把接线的两头各剪断一处，上面同一套判据必须当场判红。
  const brokenReadsSrc = Object.assign({}, m2Sources, {
    reads: String(m2Sources.reads).replace("'branch-tags': readBranch", "'branch-tags': readRemote"),
  })
  check(missingNeedlesOf(brokenReadsSrc, pageWiring[0].need).length > 0, '十 反证：把分支与标签页的进入读数换成远端列表 → 该页接线判据当场判红')
  const brokenTabSrc = Object.assign({}, m2Sources, {
    tab: String(m2Sources.tab).replace('conflicts: conflictsModel', 'conflicts: null'),
  })
  check(missingNeedlesOf(brokenTabSrc, pageWiring[9].need).length > 0, '十 反证：把冲突页的模型改成 null → 该页接线判据当场判红')

  // ---- 十一 宽度档位只认四档（#1840）：真实面板量到的是任意像素宽，根节点自己的纵向滚动条
  //      还会让同一档宽差出 4 个像素（300 宽的页量到 304）。data-vc-width 必须归到最近的一档，
  //      否则按档位写的 CSS 规则会漏，460 / 520 档还会因卡片列数来回切而自激回流。
  console.log('\n十一 宽度档位归最近档（#1840）')
  const widthOfTab = function (w) { return attrValuesOf(renderPage(view, { page: 'changes', width: w, skin: 'dark' }), 'data-vc-width')[0] }
  check(view.VC_SHELL_WIDTHS.map(widthOfTab).join(',') === view.VC_SHELL_WIDTHS.join(','), '十一 四档原值照旧落在本档：300 / 380 / 460 / 520')
  check([296, 304, 376, 384, 456, 464, 516, 524].map(widthOfTab).join(',') === '300,300,380,380,460,460,520,520', '十一 滚动条带来的 ±4 像素偏差都归回本档（300 宽的页不会报成 304）')
  check(widthOfTab(350) === '380' && widthOfTab(470) === '460' && widthOfTab(640) === '520', '十一 四档之外的像素宽归最近的一档（350→380、470→460、大面板 640→520）')
  check(widthOfTab(0) === '460' && widthOfTab(undefined) === '460', '十一 没量到宽度时仍回落 460（与旧口径一致）')

  console.log('\n' + (failed ? '存在失败' : '全部通过') + ' — 版本管理页覆盖验收门禁（' + total + ' 项断言）')
  printGateResult(GATE, total, failedCount)
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
