// verify-1776-vc-live-tab.ts — #1776 M1 门禁：把版本管理页签接进真实页面壳之后，真挂载一遍、真点一遍。
// 覆盖：壳根与四页签、齿轮九个管理分区与返回、命令面板 162 条搜索与落点高亮、首屏七片的三时机刷新与片级重试、
//   改动/提交/贮藏/工作树首批动作必须发出真实宿主电话、空目录与单片失败两类边界、以及「事件属性改回小写就判红」的反证。
// 对比 verify-818：那一扇用 react-dom/server 静态渲染看 DOM 形状；这一扇用 jsdom + react-dom/client 真挂载，
//   假宿主记录每一次 host.call，所以断言的是「点了之后真的打了哪个电话」，不是「源码里有某个字符串」。
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1776-vc-live-tab.ts
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const ROOT = path.resolve(__dirname, '..')
const { compileFn } = require('./lib/eval-probe.js')
const { printGateResult } = require('./lib/gate-result.ts')
const { sourceText, sourcePath } = require('./lib/source-text.ts')
const { TRANSPILE_OPTIONS } = require('../scripts/lib/transpile-unit.mts')
// 中央时间真值：相对时间窗口只住 config/*.yaml；这里读同一份导出整批挂到 globalThis，闭包里的裸标识符回落到它。
const centralTime = require('../src/shared/time-config/values.js')
for (const [k, v] of Object.entries(centralTime)) {
  if (typeof v === 'number' && globalThis[k] === undefined) globalThis[k] = v
}
const stripTimeConfigImport = (s) => s.split('\n').filter((l) => !/^\s*import\s.*time-config\/values\.js/.test(l)).join('\n')

let total = 0
let failed = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed += 1 }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const NOW = Date.parse('2026-11-01T10:00:00+08:00')
const CWD = 'D:/w/repo'

// ---------------- 源码闭包：与 scripts/build.mts 的拼接次序同源 ----------------
// 四个新叶子按入口次序插在页面壳之后、VersionControlTab 之前；818 已经登记过时直接用它登记过的次序。
const NEW_FILES = [
  'src/client/views/versionControl/vcRealModel.js',
  'src/client/views/versionControl/vcRealDelegate.js',
  'src/client/views/versionControl/vcRealActions.js',
  'src/client/views/versionControl/vcRealTab.js',
]
const EXPORTS = [
  'VersionControlTab', 'VcRealTab', 'CAPABILITIES', 'PAGE_COUNTS', 'VC_TAB_PAGES', 'VC_MANAGE_PAGES',
  'VC_PALETTE_RENDER_MAX', 'vcPaletteMatchOf', 'vcPaletteRowsOf', 'vcPaletteTargetOf',
]
const readSource = (rel) => (fs.existsSync(path.join(ROOT, rel.replace(/\.js$/, '.ts'))) ? sourceText(rel) : read(rel))
const stripExports = (t) => t.replace(/^(\s*)export\s+/gm, '$1')
const toEvalJs = (code) => require('esbuild').transformSync(code, TRANSPILE_OPTIONS).code

function closureList() {
  const source = read('tests/verify-818-version-control-view.ts')
  const block = /const VC_FILES = \[([\s\S]*?)\n\]/.exec(source)
  if (!block) throw new Error('从 verify-818 里找不到 VC_FILES 清单，闭包拼不起来')
  const list = Array.from(block[1].matchAll(/'([^']+)'/g)).map((m) => m[1])
  for (let i = 0; i < NEW_FILES.length; i += 1) {
    if (list.indexOf(NEW_FILES[i]) < 0) list.splice(list.length - 1, 0, NEW_FILES[i])
  }
  return list
}
const CLOSURE = closureList()

// patch 按相对路径改单个源文件的文本，用来做反证（把驼峰事件属性改回小写）。
function buildView(hostStub, patch) {
  const patchMap = patch || {}
  let src = CLOSURE.map(function (rel) {
    let code = stripExports(stripTimeConfigImport(readSource(rel)))
    if (typeof patchMap[rel] === 'function') code = patchMap[rel](code)
    return code
  }).join('\n')
  src = toEvalJs(src)
  const body = src + '\nreturn { ' + EXPORTS.join(', ') + ' }\n'
  const fn = compileFn(['React', 'log', 'dswsLogHash', 'dswsLogTrunc', 'tr', 'host', 'DswsCtx', 'Tip', 'Ic', 'seedReads'], body)
  return fn(React, function () {}, function () { return 'h8' }, function (s) { return String(s) }, tZh, hostStub || {}, DswsCtx, TipStub, IcStub, null)
}

// ---------------- 首屏快照与假宿主 ----------------
// 七片齐全的基线快照；failSlice 给某一片做成 err，验证「单片失败不拖垮其它片」。
function snapshotOf(opts) {
  const o = opts || {}
  const ok = function (data) { return { state: 'ok', data: data, error: null } }
  const slices = {
    workspace: ok({
      identity: { worktreeDisplay: 'dsh-plugin', worktreePath: 'D:/w/repo', branch: 'main', detached: false, oid: 'abcdef1234567890', sync: '', ahead: 0, behind: 0, basisMs: NOW },
      repo: { merging: false, rebasing: false, cherryPicking: false, reverting: false, hasCommits: true, bare: false, tier: 'full', autocrlf: 'false' },
      branches: [{ name: 'main', current: true, remote: 'origin' }],
    }),
    changes: ok({ staged: [], unstaged: [{ path: 'a.txt', status: ' M', staged: false, untracked: false }], stagedCount: 0, unstagedCount: 1, conflictCount: 0, lineCountsKnown: true }),
    history: ok({ commits: [{ oid: 'aaaa1111222233334444', short: 'aaaa111', author: '某甲', email: 'a@b.c', authorDateMs: NOW - 3600000, commitDateMs: NOW - 3600000, subject: '首条提交', parents: [] }], hasMore: false }),
    worktrees: ok({ others: [{ path: 'D:/w/wt2', branch: 'feat/x', head: 'abc1234', locked: false, prunable: true, prunableReason: '目录已不存在' }], bare: false, nul: false }),
    stashes: ok({ entries: [] }),
    sync: ok({ sync: '', ahead: 0, behind: 0, basisMs: NOW, upstream: '', remote: 'origin', branch: 'main' }),
    version: ok({ gitVersion: '2.45.0', tier: 'full', floor: '2.20', fullCount: 162, hiddenCount: 0, degradedCount: 0, switches: [] }),
  }
  if (o.failSlice) slices[String(o.failSlice)] = { state: 'err', data: null, error: { kind: 'env', message: String(o.failMessage || '这一片读不到') } }
  return { contract: 'version-control.first-screen', version: 2, readAtMs: NOW, slices: slices }
}

// 假宿主：每次电话都记进 calls；回包按电话名给，够 M1 这一批动作走完预检→确认→执行。
function makeHost(opts) {
  const o = opts || {}
  const calls = []
  const replyOf = function (phone, args) {
    if (o.reply && typeof o.reply[phone] === 'function') return o.reply[phone](args)
    if (phone === 'wf.gitFirstScreen') return { ok: true, firstScreen: snapshotOf({ failSlice: o.failSlice, failMessage: o.failMessage }), readAtMs: NOW }
    if (phone === 'wf.gitStash') return { ok: true, entries: [], recent: [], stderr: '', stdout: '' }
    if (phone === 'wf.gitCommitForm') return { ok: true, form: { branch: 'main', stagedCount: 0, hooks: [], amend: { available: true, message: '上一条提交的说明' } } }
    if (phone === 'wf.gitWriteCheck') return { ok: true, decision: { verdict: 'allow', reasons: ['ok'] }, plan: { mode: 'amend' }, confirmRequired: true, ticket: { id: 'cm-ticket', checkedAtMs: NOW, expiresAtMs: NOW } }
    if (phone === 'wf.gitCommit') return { ok: true, cmd: 'git commit --amend', ms: 5, n: 1 }
    if (phone === 'wf.gitChangesCheck') return { ok: true, decision: { verdict: 'allow', reasons: ['ok'] }, plan: {}, confirmRequired: false, ticket: { id: 'ch-ticket', checkedAtMs: NOW, expiresAtMs: NOW }, readAtMs: NOW }
    if (phone === 'wf.gitChangesWrite') return { ok: true, cmd: 'git add -A', ms: 3, n: 1 }
    if (phone === 'wf.gitWorktreeCheck') return { ok: true, decision: { verdict: 'allow', reasons: ['ok'] }, plan: { cmd: 'git worktree prune' }, ticket: { id: 'wt-ticket', checkedAtMs: NOW, expiresAtMs: NOW } }
    if (phone === 'wf.gitWorktreeRun') return { ok: true, plan: {}, result: { cmd: 'git worktree prune', ms: 2, n: 1 } }
    if (phone === 'wf.gitLog') return { ok: true, commits: [], hasMore: false }
    if (phone === 'wf.gitDiff') return { ok: true, files: [], lines: [], text: '', truncated: false }
    return { ok: true }
  }
  return {
    calls: calls,
    call: function (phone, args) { calls.push({ phone: phone, args: args }); return Promise.resolve(replyOf(phone, args)) },
  }
}
const phonesOf = (host) => host.calls.map(function (one) { return one.phone })
const countKin = (host, phone) => phonesOf(host).filter(function (p) { return p === phone }).length
const firstCallOf = (host, phone) => host.calls.filter(function (one) { return one.phone === phone })[0] || null

// ---------------- jsdom + React 挂载装置 ----------------
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><html><body data-ds-dark-theme></body></html>', { url: 'http://127.0.0.1/' })
global.window = dom.window
global.document = dom.window.document
global.navigator = dom.window.navigator
global.HTMLElement = dom.window.HTMLElement
global.Element = dom.window.Element
global.Node = dom.window.Node
global.MouseEvent = dom.window.MouseEvent
global.KeyboardEvent = dom.window.KeyboardEvent
global.IS_REACT_ACT_ENVIRONMENT = true
const React = require('react')
const ReactDOMClient = require('react-dom/client')
const DswsCtx = React.createContext(null)
const TipStub = function (props) { return props && props.children ? props.children : null }
const IcStub = function () { return null }
let LOC = { zh: {}, en: {} }
const fill = (s, p) => (p ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return k in p ? String(p[k]) : m }) : String(s))
const tZh = (k, p) => fill(LOC.zh[k] !== undefined ? LOC.zh[k] : k, p)

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await React.act(async function () { await new Promise(function (r) { setTimeout(r, 0) }) })
  }
}

function mountOf(view, props) {
  const app = document.createElement('div')
  app.className = 'vc-live-test-root'
  document.body.appendChild(app)
  const root = ReactDOMClient.createRoot(app)
  const handle = {
    app: app,
    root: root,
    q: function (sel) { return app.querySelector(sel) },
    qa: function (sel) { return Array.from(app.querySelectorAll(sel)) },
    page: function () { const el = app.querySelector('[data-vc-shell]'); return el ? String(el.getAttribute('data-vc-page') || '') : '' },
    depth: function () { const el = app.querySelector('[data-vc-shell]'); return el ? String(el.getAttribute('data-vc-depth') || '') : '' },
    text: function (sel) { const el = app.querySelector(sel); return el ? String(el.textContent || '') : '' },
    click: async function (sel) {
      const el = typeof sel === 'string' ? app.querySelector(sel) : sel
      if (!el) return false
      await React.act(async function () { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })) })
      await settle()
      return true
    },
    type: async function (sel, value) {
      const el = app.querySelector(sel)
      if (!el) return false
      const proto = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
      await React.act(async function () { el.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
      await settle()
      return true
    },
    key: async function (sel, key) {
      const el = app.querySelector(sel)
      if (!el) return false
      await React.act(async function () { el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true })) })
      await settle()
      return true
    },
    unmount: async function () {
      await React.act(async function () { root.unmount() })
      if (app.parentNode) app.parentNode.removeChild(app)
    },
  }
  return handle
}

// ---------------- 场景一：主链（真挂载、真点、真电话） ----------------
async function scenarioMain() {
  console.log('\n== 场景一：挂载、导航、命令面板、三时机刷新与首批动作 ==')
  const host = makeHost({})
  const view = buildView(host, null)
  const m = mountOf(view, { st: { cwd: CWD }, narrow: false })
  await React.act(async function () { m.root.render(React.createElement(view.VersionControlTab, { st: { cwd: CWD }, narrow: false })) })
  await settle()

  check(!!m.q('[data-vc-shell]') && m.page() === 'changes', 'T1 挂载即出现真实页面壳，默认落在改动页（data-vc-shell、data-vc-page=changes）')
  check(!!m.q('[data-vc-live]'), 'T1b 容器根有 data-vc-live 标记，说明走的是新入口而不是旧块渲染')
  check(m.qa('[data-vc-tab]').length === view.VC_TAB_PAGES.length && view.VC_TAB_PAGES.length === 4, 'T2 四个固定页签都画出来（' + m.qa('[data-vc-tab]').length + ' 个）')
  const tabIds = m.qa('[data-vc-tab]').map(function (el) { return el.getAttribute('data-vc-tab') })
  check(view.VC_TAB_PAGES.every(function (id) { return tabIds.indexOf(id) >= 0 }), 'T2b 页签 id 与 VC_TAB_PAGES 一致：' + tabIds.join(','))
  const activeTab = m.q('[data-vc-tab="changes"]')
  check(activeTab && activeTab.getAttribute('aria-selected') === 'true' && activeTab.getAttribute('tabindex') === '0', 'T2c 当前页签 aria-selected=true 且 tabIndex=0')
  check(!!m.q('[data-vc-branch-btn]') && !!m.q('[data-vc-search-entry]') && !!m.q('[data-vc-gear-btn]'), 'T3 身份行三个入口都在（分支、搜索、齿轮）')
  check(!!m.q('[data-vc-refresh]') && !m.q('[data-vc-refresh]').disabled, 'T3b 手动刷新入口在页面上真实存在且可点（data-vc-refresh）')
  check(String((m.q('.vcs-identity-count') || {}).textContent || '').indexOf(String(view.CAPABILITIES.length)) >= 0, 'T3c 身份行能力计数与账本一致（' + view.CAPABILITIES.length + '）')
  check(countKin(host, 'wf.gitFirstScreen') === 1, 'T4 进入页面恰好发一次 wf.gitFirstScreen 聚合读')
  const fsCall = firstCallOf(host, 'wf.gitFirstScreen')
  check(!!fsCall && String((fsCall.args || {}).cwd || '') === CWD, 'T4b 聚合读带上当前工作区 cwd=' + CWD)
  check(m.text('[data-vc-live-at]').indexOf('读取于') >= 0, 'T4c 身份行附近显示读取时刻文案')
  check(!!m.q('[data-vc-commit-panel]'), 'T5 改动页挂上了提交面板（vcCommitPageNode）')
  check(m.qa('[data-vc-changes-op]').length === 13, 'T5b 改动页 13 条动作按钮都在（' + m.qa('[data-vc-changes-op]').length + ' 条）')

  const leaves = { changes: '[data-vc-commit-panel]', commits: '[data-vc-history]', worktrees: '[data-vc-wt-page]', stash: '[data-vc-stash-page]' }
  for (const pageId of view.VC_TAB_PAGES) {
    const okClick = await m.click('[data-vc-tab="' + pageId + '"]')
    check(okClick && m.page() === pageId && !!m.q(leaves[pageId]), 'T6 点页签 ' + pageId + ' 后页壳与页面正文都切过去（' + leaves[pageId] + '）')
  }

  await m.click('[data-vc-tab="changes"]')
  await m.key('[data-vc-tab="changes"]', 'ArrowLeft')
  check(m.page() === 'stash', 'T7 键盘左方向键从第一个页签循环到最后一个页签（贮藏）')
  check(document.activeElement && document.activeElement.getAttribute('data-vc-tab') === 'stash', 'T7b 键盘切换后焦点跟到新页签')
  await m.key('[data-vc-tab="stash"]', 'ArrowRight')
  check(m.page() === 'changes', 'T7c 键盘右方向键从最后一个页签循环回第一个页签（改动）')
  await m.key('[data-vc-tab="changes"]', 'End')
  check(m.page() === 'stash', 'T7d End 键跳到最后一个页签（贮藏）')
  await m.key('[data-vc-tab="stash"]', 'Home')
  check(m.page() === 'changes', 'T7e Home 键跳到第一个页签（改动）')

  // ---- 齿轮九个管理分区：逐项进入、逐项返回 ----
  await m.click('[data-vc-tab="changes"]')
  await m.click('[data-vc-gear-btn]')
  const gearItems = m.qa('[data-vc-gear-item]').map(function (el) { return el.getAttribute('data-vc-gear-item') })
  check(!!m.q('[data-vc-gear-index]') && gearItems.length === view.VC_MANAGE_PAGES.length && view.VC_MANAGE_PAGES.length === 9, 'T8 点齿轮打开九分区索引（' + gearItems.length + ' 项）')
  check(view.VC_MANAGE_PAGES.every(function (id) { return gearItems.indexOf(id) >= 0 }), 'T8b 九分区 id 与 VC_MANAGE_PAGES 一致')
  for (const pageId of view.VC_MANAGE_PAGES) {
    // 齿轮只在没展开时点开：二级页上齿轮是常显的，再点按钮会把展开状态收回去。
    if (!m.q('[data-vc-gear-index]')) await m.click('[data-vc-gear-btn]')
    await m.click('[data-vc-gear-item="' + pageId + '"]')
    const entered = m.page() === pageId && m.depth() === '2' && !!m.q('[data-vc-page-body="' + pageId + '"]')
    const backBtn = !!m.q('[data-vc-back]')
    await m.click('[data-vc-back]')
    check(entered && backBtn && m.page() === 'changes', 'T9 齿轮进入管理分区 ' + pageId + '（二级页、有返回入口）再返回改动页')
  }

  // ---- 命令面板：162 条、搜索、落点高亮 ----
  await m.click('[data-vc-search-entry]')
  check(!!m.q('[data-vc-palette]') && !!m.q('[data-vc-palette-input]'), 'T10 点搜索入口打开命令面板浮层（data-vc-palette）')
  const hintEmpty = m.text('[data-vc-palette] .vcs-pal-hint')
  check(hintEmpty.indexOf(String(view.CAPABILITIES.length)) >= 0, 'T10b 空搜索词时命中数等于能力账本条数（' + view.CAPABILITIES.length + '）')
  const emptyRows = m.qa('[data-vc-palette-row]')
  const allRows = view.vcPaletteRowsOf('', view.VC_PALETTE_RENDER_MAX, '')
  check(emptyRows.length === allRows.length && emptyRows.length > 0, 'T10c 面板按渲染上限画出前 ' + emptyRows.length + ' 条')
  await m.type('[data-vc-palette-input]', '暂存')
  const hit = view.vcPaletteMatchOf('暂存', '')
  const rowsAfter = m.qa('[data-vc-palette-row]').length
  const hintAfter = m.text('[data-vc-palette] .vcs-pal-hint')
  check(hintAfter.indexOf(String(hit.length)) >= 0 && rowsAfter === Math.min(hit.length, view.VC_PALETTE_RENDER_MAX), 'T10d 输入「暂存」后命中 ' + hit.length + ' 条，面板画出 ' + rowsAfter + ' 条')
  const pickTarget = view.vcPaletteTargetOf('2.1')
  const pickOk = await m.click('[data-vc-palette-row="2.1"]')
  const hitRow = m.q('[data-cap-hit]')
  check(pickOk && m.page() === pickTarget.page && !!hitRow && hitRow.getAttribute('data-cap-primary') === '2.1', 'T10e 选中 2.1 落到 ' + pickTarget.page + ' 页并高亮那一条（data-cap-hit）')
  check(!m.q('[data-vc-palette]'), 'T10f 选中后命令面板关闭')
  // 跨页落点：2.1 的落点就在改动页，返回入口要另挑一条落在别的页的能力来验。
  await m.click('[data-vc-search-entry]')
  await m.type('[data-vc-palette-input]', '提交列表')
  const crossRows = view.vcPaletteMatchOf('提交列表', '').map(function (cap) { return { cap: cap, target: view.vcPaletteTargetOf(cap.id) } })
  const cross = crossRows.filter(function (row) { return row.target.page !== 'changes' })[0]
  check(!!cross && !!m.q('[data-vc-palette-row="' + (cross ? cross.cap.id : '') + '"]'), 'T10g 搜索「提交列表」能找到落在别的页的能力（' + (cross ? cross.cap.id : '无') + '）')
  const crossOk = cross ? await m.click('[data-vc-palette-row="' + cross.cap.id + '"]') : false
  check(crossOk && !!cross && m.page() === cross.target.page && !m.q('[data-vc-palette]'), 'T10h 选中跨页能力后落到 ' + (cross ? cross.target.page : '') + ' 页并关面板')
  check(!!m.q('[data-vc-back]'), 'T10i 跨页落点保留返回来源页的入口')
  await m.click('[data-vc-back]')
  check(m.page() === 'changes', 'T10j 从落点返回来源页（改动页）')

  // ---- 分支浮层、同步带、搜索页与两个侧页 ----
  await m.click('[data-vc-branch-btn]')
  check(!!m.q('[data-vc-branch-overlay]'), 'T11 点分支按钮打开分支浮层')
  await m.click('[data-vc-branch-close]')
  check(!m.q('[data-vc-branch-overlay]'), 'T11b 关闭分支浮层')
  await m.click('[data-vc-sync]')
  check(m.page() === 'remote', 'T12 点同步带进入远端与同步页')
  await m.click('[data-vc-back]')
  check(m.page() === 'changes', 'T12b 从远端页返回改动页')
  const extra = { palette: 'search', rebase: 'rebase', conflicts: 'conflicts' }
  for (const key of Object.keys(extra)) {
    const pageId = extra[key]
    const okClick = await m.click('[data-vc-extra-link="' + pageId + '"]')
    const bodyOk = !!m.q('[data-vc-page-body="' + pageId + '"]')
    await m.click('[data-vc-back]')
    check(okClick && bodyOk && m.page() === 'changes', 'T13 侧入口「' + pageId + '」能进能回（入口 data-vc-extra-link=' + pageId + '）')
  }
  const searchPageOk = await (async function () {
    await m.click('[data-vc-extra-link="search"]')
    const ok = m.page() === 'search' && !!m.q('[data-vc-palette-input]')
    await m.click('[data-vc-back]')
    return ok
  })()
  check(searchPageOk, 'T13b 搜索页自带命令面板输入框（唯一一个输入框）')

  // ---- 三时机刷新：手动刷新 ----
  const before = countKin(host, 'wf.gitFirstScreen')
  await m.click('[data-vc-refresh]')
  check(countKin(host, 'wf.gitFirstScreen') === before + 1, 'T14 手动刷新再发一次 wf.gitFirstScreen（第 ' + (before + 1) + ' 次）')

  // ---- 改动页首批动作：预检 + 执行 ----
  const changeCallsBefore = host.calls.length
  await m.click('[data-vc-changes-op="stage-all"]')
  const changeCalls = host.calls.slice(changeCallsBefore).map(function (one) { return one.phone })
  const checkCall = firstCallOf(host, 'wf.gitChangesCheck')
  const writeCall = firstCallOf(host, 'wf.gitChangesWrite')
  check(changeCalls.indexOf('wf.gitChangesCheck') >= 0 && !!checkCall && String((checkCall.args || {}).op || '') === 'stage-all', 'T15 改动页点「全部暂存」先发预检电话 wf.gitChangesCheck（op=stage-all）')
  check(changeCalls.indexOf('wf.gitChangesWrite') >= 0 && !!writeCall && String((writeCall.args || {}).ticketId || '') === 'ch-ticket', 'T15b 预检放行后凭票发执行电话 wf.gitChangesWrite（带 ticketId）')
  check(countKin(host, 'wf.gitFirstScreen') === before + 2, 'T15c 写动作完成后按「任务完成」时机再读一次首屏')

  // ---- 提交页首批动作：修订（危险动作）走确认卡 ----
  await m.click('[data-vc-tab="changes"]')
  await m.click('[data-vc-commit-mode="amend"]')
  await m.type('[data-vc-commit-msg]', '门禁用的提交说明')
  const submit = m.q('[data-vc-commit-submit]')
  check(!!submit && !submit.disabled, 'T16 提交面板写进说明后提交按钮可用')
  if (submit) await m.click(submit)
  const writeCheck = firstCallOf(host, 'wf.gitWriteCheck')
  check(!!writeCheck && String((writeCheck.args || {}).op || '') === 'commit', 'T16b 点提交先发预检电话 wf.gitWriteCheck（op=commit）')
  check(!!m.q('[data-vc-commit-confirm]'), 'T16c 修订属危险动作，停在确认卡上等确认')
  const commitBefore = countKin(host, 'wf.gitCommit')
  await m.click('[data-vc-commit-confirm] [data-vc-confirm-go]')
  check(countKin(host, 'wf.gitCommit') === commitBefore + 1, 'T16d 在确认卡上确认后才发执行电话 wf.gitCommit')
  check(!!m.q('[data-vc-commit-result]'), 'T16e 提交结果回到页面')

  // ---- 贮藏页首批动作 ----
  await m.click('[data-vc-tab="stash"]')
  const stashBefore = countKin(host, 'wf.gitStash')
  await m.click('[data-vc-stash-op="push"]')
  const stashCall = host.calls.filter(function (one) { return one.phone === 'wf.gitStash' })[stashBefore]
  check(countKin(host, 'wf.gitStash') === stashBefore + 1 && !!stashCall && String((stashCall.args || {}).op || '') === 'push', 'T17 贮藏页点 push 发出真电话 wf.gitStash（op=push）')

  // ---- 工作树页首批动作 ----
  await m.click('[data-vc-tab="worktrees"]')
  const prune = m.q('[data-wt-action="prune"]')
  check(!!prune && !prune.disabled, 'T18 工作树页「清理失效登记」按钮可点（判定不再把 allow 误判成 block）')
  const wtBefore = countKin(host, 'wf.gitWorktreeCheck')
  if (prune) await m.click(prune)
  check(countKin(host, 'wf.gitWorktreeCheck') === wtBefore + 1, 'T18b 点工作树动作发出预检电话 wf.gitWorktreeCheck')

  await m.unmount()
  return view
}

// ---------------- 场景二：单片失败与片级重试 ----------------
async function scenarioSliceFail() {
  console.log('\n== 场景二：历史片失败，页面报原因并给片级重试 ==')
  const host = makeHost({ failSlice: 'history', failMessage: '模拟：git log 读不到' })
  const view = buildView(host, null)
  const m = mountOf(view, { st: { cwd: CWD } })
  await React.act(async function () { m.root.render(React.createElement(view.VersionControlTab, { st: { cwd: CWD } })) })
  await settle()
  const failText = m.text('[data-vc-slice-fail="history"]')
  check(!!m.q('[data-vc-slice-fail="history"]') && failText.indexOf('提交历史首页') >= 0 && failText.indexOf('模拟：git log 读不到') >= 0, 'T19 失败片画出片名与宿主原话（不吞原因）')
  check(!!m.q('[data-vc-slice-retry="history"]'), 'T19b 失败片给出片级重试入口')
  check(!!m.q('[data-vc-commit-panel]') && m.qa('[data-vc-changes-op]').length === 13, 'T19c 其它片仍然可用（改动页动作与提交面板都在）')
  check(countKin(host, 'wf.gitFirstScreen') === 1, 'T19d 失败时进入仍只读一次（不自动连环重试）')
  await m.click('[data-vc-slice-retry="history"]')
  check(countKin(host, 'wf.gitFirstScreen') === 2, 'T19e 点片级重试再发一次聚合读')
  const retryCall = host.calls.filter(function (one) { return one.phone === 'wf.gitFirstScreen' })[1]
  check(!!retryCall && String((retryCall.args || {}).cwd || '') === CWD, 'T19f 片级重试仍带同一个 cwd')
  await m.unmount()
}

// ---------------- 场景三：空工作区 ----------------
async function scenarioEmptyCwd() {
  console.log('\n== 场景三：空工作区画空态、零电话 ==')
  const host = makeHost({})
  const view = buildView(host, null)
  const m = mountOf(view, { st: {} })
  await React.act(async function () { m.root.render(React.createElement(view.VersionControlTab, { st: {} })) })
  await settle()
  check(!!m.q('[data-vc-live-empty]') && !m.q('[data-vc-shell]'), 'T20 空目录只画空态、不画页面壳')
  check(String((m.q('[data-vc-live-empty]') || {}).textContent || '').indexOf('当前会话尚未关联工作区') >= 0, 'T20b 空态文案说明原因')
  check(host.calls.length === 0, 'T20c 空目录一个宿主电话都不发（' + host.calls.length + ' 次）')
  await m.unmount()
}

// ---------------- 场景四：反证（事件属性改回小写，门禁必须判红） ----------------
async function scenarioReverseProof() {
  console.log('\n== 场景四：反证 —— 把事件属性改回小写，页签点不动 ==')
  const delegateFile = 'src/client/views/versionControl/vcRealDelegate.js'
  const original = readSource(delegateFile)
  const replacedCount = (original.match(/\bonClick:/g) || []).length
  check(replacedCount > 0, 'T21 自证：容器事件委托源码里确有 ' + replacedCount + ' 处驼峰 onClick（改法能命中）')
  const host = makeHost({})
  const patched = buildView(host, {
    [delegateFile]: function (code) { return code.replace(/\bonClick:/g, 'onclick:') },
  })
  const m = mountOf(patched, { st: { cwd: CWD } })
  await React.act(async function () { m.root.render(React.createElement(patched.VersionControlTab, { st: { cwd: CWD } })) })
  await settle()
  check(m.page() === 'changes', 'T21b 反证挂载成功，仍从改动页开始')
  await m.click('[data-vc-tab="commits"]')
  check(m.page() === 'changes' && !m.q('[data-vc-history]'), 'T21c 事件属性改回小写后点页签无反应（说明 T6 的断言抓得住死按钮）')
  await m.unmount()
}

// ---------------- 场景五：登记与源码级的守卫 ----------------
function scenarioRegistration() {
  console.log('\n== 场景五：构建登记、入口委托与事件属性守卫 ==')
  const buildSrc = read('scripts/build.mts')
  const indexSrc = read('src/client/index.ts')
  const g818 = read('tests/verify-818-version-control-view.ts')
  const newTs = ['vcRealModel', 'vcRealDelegate', 'vcRealActions', 'vcRealTab']
  check(newTs.every(function (id) { return buildSrc.indexOf('id: \'' + id + '\'') >= 0 }), 'T22 scripts/build.mts 叶子清单登记了四个新叶子')
  check(newTs.every(function (id) { return indexSrc.indexOf('leaf:' + id) >= 0 }), 'T22b src/client/index.ts 有四个新叶子的拼接标记')
  check(NEW_FILES.every(function (f) { return g818.indexOf(f) >= 0 }), 'T22c verify-818 的闭包文件清单登记了四个新叶子（否则 818 渲染会缺函数）')
  const tabSrc = read('src/client/views/versionControl/VersionControlTab.ts')
  check(tabSrc.indexOf('VcRealTab') >= 0 && tabSrc.indexOf('vcBlocksOf') < 0, 'T22d 入口组件只做委托（出现 VcRealTab、不再有旧块渲染入口）')
  const files = fs.readdirSync(path.join(ROOT, 'src/client/views/versionControl')).filter(function (name) { return /\.ts$/.test(name) })
  const bad = files.filter(function (name) { return /\bon(click|input|change)\s*:/.test(read('src/client/views/versionControl/' + name)) })
  check(bad.length === 0, 'T22e 版本管理客户端源码里没有小写事件属性（' + (bad.length === 0 ? '全部驼峰' : '仍剩 ' + bad.join(',')) + '）')
  const tabSrcAll = read('src/client/views/versionControl/vcRealTab.ts')
  const logKeys = ['vc.reload', 'vc.row.open.', 'vc.commit.back', 'vc.changes.back']
  check(logKeys.every(function (key) { return tabSrcAll.indexOf(key) >= 0 }), 'T22f 新容器保留 ui-feedback 门禁要求的四个 data-log 词条')
  check(read('src/client/views/versionControl/vcRealTab.ts').indexOf('data-vc-refresh') >= 0, 'T22g 手动刷新入口写在容器里（data-vc-refresh）')
  check(read('src/client/views/versionControl/vcRealTab.ts').indexOf('data-vc-slice-fail') >= 0, 'T22h 片级失败条写在容器里（data-vc-slice-fail）')
}

// ---------------- main ----------------
async function main() {
  const locUrl = (f) => pathToFileURL(path.join(ROOT, sourcePath(f))).href
  const fams = ['panel', 'flow', 'vcworktrees', 'vcsubmodules', 'vcwrite', 'vcshell', 'vcquery', 'vcstash', 'vcconfig', 'vchooks', 'vcdiagnostics', 'vcundo', 'vcplatform']
  const names = { panel: 'L_PANEL', flow: 'L_FLOW', vcworktrees: 'L_VCWORKTREES', vcsubmodules: 'L_VCSUBMODULES', vcwrite: 'L_VCWRITE', vcshell: 'L_VCSHELL', vcquery: 'L_VCQUERY', vcstash: 'L_VCSTASH', vcconfig: 'L_VCCONFIG', vchooks: 'L_VCHOOKS', vcdiagnostics: 'L_VCDIAGNOSTICS', vcundo: 'L_VCUNDO', vcplatform: 'L_VCPLATFORM' }
  const zh = {}
  for (const f of fams) {
    const mod = await import(locUrl('src/client/kernel/locale-' + f + '.js'))
    Object.assign(zh, mod[names[f]].zh)
  }
  LOC = { zh: zh, en: {} }

  scenarioRegistration()
  await scenarioMain()
  await scenarioSliceFail()
  await scenarioEmptyCwd()
  await scenarioReverseProof()

  console.log('\n断言 ' + total + ' 条，失败 ' + failed + ' 条')
  printGateResult('verify-1776-vc-live-tab', total, failed ? 1 : 0)
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) {
  console.log('  FAIL 门禁自身抛出异常：' + String((e && e.stack) || e))
  printGateResult('verify-1776-vc-live-tab', total + 1, 1)
  process.exit(1)
})
