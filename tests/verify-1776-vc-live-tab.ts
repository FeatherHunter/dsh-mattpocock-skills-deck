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
// 十一个新叶子按构建次序插在页面壳之后、VersionControlTab 之前（M1 四叶 + M2 七叶）；
// 818 已经登记过时直接用它登记过的次序，这里只作为「必须都在」的清单。
const NEW_FILES = [
  'src/client/views/versionControl/vcRealModel.js',
  'src/client/views/versionControl/vcRealManage.js',
  'src/client/views/versionControl/vcRealManageReads.js',
  'src/client/views/versionControl/vcRealManageActions.js',
  'src/client/views/versionControl/vcRealManageActions2.js',
  'src/client/views/versionControl/vcRealManageActions3.js',
  'src/client/views/versionControl/vcRealManageSide.js',
  'src/client/views/versionControl/vcRealShell.js',
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
  // #1776 M4a：本机 Windows 上 esbuild 0.28.2 对超过 1MB 的输入改走 os.tmpdir() 临时文件，子进程删除它时
  //   报 "remove …: Access is denied."，整段转译直接抛错。这里本来就按文件改坏、逐文件拼装，所以顺手
  //   逐文件转译再拼回去：每段都是完整源文件，与整段转译等价，也绕开了上面那条 1MB 的坎。
  const src = CLOSURE.map(function (rel) {
    let code = stripExports(stripTimeConfigImport(readSource(rel)))
    if (typeof patchMap[rel] === 'function') code = patchMap[rel](code)
    return toEvalJs(code)
  }).join('\n')
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
    if (phone === 'wf.gitStashCheck') return { ok: true, ticket: { id: 'st-ticket', checkedAtMs: NOW, expiresAtMs: NOW + 120000 }, plan: { subject: '第1条贮藏' } }
    if (phone === 'wf.gitStash') return { ok: true, entries: [], recent: [], stderr: '', stdout: '' }
    if (phone === 'wf.gitCommitForm') return { ok: true, form: { branch: 'main', stagedCount: 0, hooks: [], amend: { available: true, message: '上一条提交的说明' } } }
    if (phone === 'wf.gitWriteCheck') return { ok: true, decision: { verdict: 'allow', reasons: ['ok'] }, plan: { mode: 'amend' }, confirmRequired: true, ticket: { id: 'cm-ticket', checkedAtMs: NOW, expiresAtMs: NOW } }
    if (phone === 'wf.gitCommit') return { ok: true, cmd: 'git commit --amend', ms: 5, n: 1 }
    if (phone === 'wf.gitChangesCheck') return { ok: true, decision: { verdict: 'allow', reasons: ['ok'] }, plan: {}, confirmRequired: false, ticket: { id: 'ch-ticket', checkedAtMs: NOW, expiresAtMs: NOW }, readAtMs: NOW }
    if (phone === 'wf.gitChangesWrite') return { ok: true, cmd: 'git add -A', ms: 3, n: 1 }
    if (phone === 'wf.gitWorktreeCheck') return { ok: true, decision: { verdict: 'allow', reasons: ['ok'] }, plan: { cmd: 'git worktree prune' }, ticket: { id: 'wt-ticket', checkedAtMs: NOW, expiresAtMs: NOW } }
    if (phone === 'wf.gitWorktreeRun') return { ok: true, plan: {}, result: { cmd: 'git worktree prune', ms: 2, n: 1 } }
    // ———— M2 管理页与侧页的读数与动作电话 ————
    if (phone === 'wf.gitBranches') return { ok: true, contract: 'version-control.branch-board', version: 1, readAtMs: NOW, current: { name: 'main', oid: 'abcdef1' }, branches: [{ name: 'main', current: true, remote: 'origin', upstream: 'origin/main', oid: 'abcdef1', subject: '首条提交' }, { name: 'feat/x', current: false, oid: 'abc1234' }], tags: [{ name: 'v1.0', oid: 'aaaa111', subject: '首版' }], descriptions: {} }
    if (phone === 'wf.gitBranchCheck') return { ok: true, contract: 'version-control.branch-check', version: 1, readAtMs: NOW, op: String((args || {}).op || 'switch'), decision: { verdict: 'warn', reasons: ['会切换当前分支'] }, confirmRequired: true, confirm: { verb: '切换到分支', target: 'main' }, ticket: { id: 'br-ticket', op: String((args || {}).op || 'switch'), checkedAtMs: NOW, expiresAtMs: NOW + 120000 } }
    if (phone === 'wf.gitBranchWrite') return { ok: true, command: 'git switch main', ms: 3, n: 1 }
    if (phone === 'wf.gitRemoteList') return { ok: true, source: 'local', readAtMs: NOW, remotes: [{ name: 'origin', fetchUrl: 'git@example.com:repo.git', pushUrl: 'git@example.com:repo.git' }, { name: 'mirror', fetchUrl: 'https://mirror.example.com/repo.git', pushUrl: '' }] }
    if (phone === 'wf.gitRemoteCheck') return { ok: true, action: String((args || {}).action || ''), command: 'git remote ' + String((args || {}).action || ''), ticket: { id: 'rm-ticket', op: String((args || {}).action || ''), checkedAtMs: NOW, expiresAtMs: NOW + 120000 }, plan: { action: String((args || {}).action || ''), name: String((args || {}).name || ''), url: String((args || {}).url || ''), from: String((args || {}).from || ''), to: String((args || {}).to || '') }, remotes: [{ name: 'origin', fetchUrl: 'git@example.com:repo.git', pushUrl: 'git@example.com:repo.git' }], readAtMs: NOW }
    if (phone === 'wf.gitRemoteAdd') return { ok: true, action: 'add', command: 'git remote add ' + String((args || {}).name || ''), name: String((args || {}).name || ''), ms: 2, n: 1 }
    if (phone === 'wf.gitRemoteRename') return { ok: true, action: 'rename', command: 'git remote rename', ms: 2, n: 1 }
    if (phone === 'wf.gitRemoteRemove') return { ok: true, action: 'remove', command: 'git remote remove', ms: 2, n: 1 }
    if (phone === 'wf.gitRemoteSetUrl') return { ok: true, action: 'set-url', command: 'git remote set-url', ms: 2, n: 1 }
    if (phone === 'wf.gitSubmodules') return { ok: true, contract: 'version-control.submodule-board', version: 1, readAtMs: NOW, rows: [{ path: 'vendor/lib', state: 'clean', initialized: true, urlDisplay: 'https://example.com/lib.git', headBranch: 'main', oid: 'abc1234' }] }
    if (phone === 'wf.gitConfigRead') return { ok: true, readAtMs: NOW, repoRoot: 'D:/w/repo', gitVersion: '2.45.0', hookRunVersion: null, configPath: 'D:/w/repo/.git/config', groups: [], identity: { name: { local: '某甲', global: null }, email: { local: 'a@b.c', global: null } }, hooks: { dir: 'D:/w/repo/.git/hooks', configured: null, readable: true, entries: [], known: [] }, attr: { state: 'ok', entries: [] }, mailmap: { state: 'ok', entries: [] }, entries: [] }
    if (phone === 'wf.gitDiagnosticsRead') return { ok: true, readAtMs: NOW, kind: 'ls-files', rows: [], files: [], text: '', truncated: false }
    if (phone === 'wf.gitPlatformRead') return { ok: true, readAtMs: NOW, credential: { state: 'ok', helpers: [], store: '', risk: 'ok', advice: 'ok' }, updateRefs: { state: 'ok', value: 'false', enabled: false } }
    if (phone === 'wf.gitConflicts') return { ok: true, state: 'merge', headOid: 'abcdef1', gitVersion: '2.45.0', conflicts: [], conflictCount: 0, clean: true, readAtMs: NOW }
    if (phone === 'wf.gitRebaseRead') return String((args || {}).op || '') === 'rebase-window' ? { ok: true, base: 'main', commits: [], commitCount: 0, readAtMs: NOW } : { ok: true, state: null, branch: 'main', headOid: 'abcdef1', updateRefs: false, readAtMs: NOW }
    if (phone === 'wf.gitMigrateCheck') return { ok: true, action: String((args || {}).action || ''), decision: { verdict: 'allow', reasons: [] }, confirmRequired: false, readAtMs: NOW }
    if (phone === 'wf.gitSyncCheck') return { ok: true, readAtMs: NOW, capabilityId: '8.5', action: 'fetch', decision: { verdict: 'warn', reasons: [] }, confirmRequired: true, confirm: { verb: '抓取', target: 'origin' }, ticket: { id: 'sy-ticket', op: 'fetch', checkedAtMs: NOW, expiresAtMs: NOW + 120000 } }
    if (phone === 'wf.gitSyncWrite') return { ok: true, task: { taskId: 't1', kind: 'fetch', state: 'queued' } }
    if (phone === 'wf.gitTaskQuery') return { ok: true, tasks: [{ taskId: 't0', kind: 'fetch', state: 'done' }], running: 0 }
    if (phone === 'wf.gitTaskCancel') return { ok: true }
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
// 等一件异步的事发生（落点聚焦是自己 setTimeout 轮询的，不在一轮渲染里完成）：每 50ms 看一次，最多 tries 次。
async function waitFor(probe, tries) {
  const max = tries || 40
  for (let i = 0; i < max; i += 1) {
    if (probe()) return true
    await React.act(async function () { await new Promise(function (r) { setTimeout(r, 50) }) })
  }
  return !!probe()
}
// 焦点在不在某个元素上（用 m（挂载句柄）限定在测试容器里找，不用全局 activeElement 猜）。
const focusOn = function (m, sel) {
  const el = m.q(sel)
  return !!el && document.activeElement === el
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
  // #1860：能力清单退役，身份行不再画「共 N 条能力」这样的计数；能力总账改由命令面板底栏承担（T10b 验）。
  check(!m.q('.vcs-identity-count') && String((m.q('[data-vc-identity]') || {}).textContent || '').indexOf('条能力') < 0, 'T3c 身份行不再画能力计数（能力总账改由命令面板承担）')
  check(countKin(host, 'wf.gitFirstScreen') === 1, 'T4 进入页面恰好发一次 wf.gitFirstScreen 聚合读')
  const fsCall = firstCallOf(host, 'wf.gitFirstScreen')
  check(!!fsCall && String((fsCall.args || {}).cwd || '') === CWD, 'T4b 聚合读带上当前工作区 cwd=' + CWD)
  // #1860：原型把「读取于」与时刻拆成两个 span（标签与值），data-vc-read-at 只挂在值上，所以整行找标签。
  check(!!m.q('[data-vc-read-at]') && m.text('[data-vc-sync-facts]').indexOf('读取于') >= 0, 'T4c 身份行的同步事实行显示读取时刻文案（data-vc-read-at）')
  check(!!m.q('[data-vc-commit-panel]'), 'T5 改动页挂上了提交面板（vcCommitPageNode）')
  check(m.qa('[data-vc-changes-op]').length === 0 && !m.q('[data-vc-more-actions]'), 'T5b 改动页不再挂 13 条动作清单（#1860 能力清单退役，动作由命令面板到达）')
  // #1829 首屏顺序：统计卡与文件行 → 折叠的 13 条动作 → 提交面板 → 能力清单；能力清单不再占首屏。
  const comesBefore = function (a: any, b: any) { return !!(a && b && (a.compareDocumentPosition(b) & 4)) }
  const viewNode = m.q('[data-vc-changes-view]'); const commitNode = m.q('[data-vc-commit-panel]')
  check(!!viewNode && !!m.q('[data-vc-changes-stats]') && m.qa('[data-vc-stat]').length === 3, 'T5c 改动页首屏先画统计卡（三张，数据源是改动读数）')
  check(comesBefore(viewNode, commitNode), 'T5d 首屏顺序：改动正文（统计卡与文件列表）在提交面板之前')
  check(!m.q('[data-vc-cap-list]') && !m.q('[data-vc-more-actions]'), 'T5e 改动页上没有能力清单、也没有折叠的动作面板（都退役了）')
  check(comesBefore(m.q('[data-vc-identity]'), viewNode), 'T5f 身份行排在改动正文之前')
  check(!!m.q('[data-vc-identity-handoff]'), 'T5g 身份行右侧有「交给 AI」入口（原型四颗入口之一）')

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

  // ---- 管理索引独立一屏 + 九个分区：逐项进入、逐层返回 ----
  // #1840 起齿轮与身份行「管理」都进导航上的一屏（page=manage），不再是叠在页面上的浮层；
  //   从分区页返回先退到索引、再退到进来之前的页签，退两层才回改动页。
  await m.click('[data-vc-tab="changes"]')
  await m.click('[data-vc-gear-btn]')
  const gearItems = m.qa('[data-vc-gear-item]').map(function (el) { return el.getAttribute('data-vc-gear-item') })
  check(!!m.q('[data-vc-gear-index]') && gearItems.length === view.VC_MANAGE_PAGES.length && view.VC_MANAGE_PAGES.length === 9, 'T8 点齿轮打开九分区索引（' + gearItems.length + ' 项）')
  check(m.page() === 'manage' && m.depth() === '2' && !!m.q('[data-vc-page-body="manage"]'), 'T8b 管理索引是独立一屏（page=manage、二级页、正文挂在 data-vc-page-body=manage 里）')
  check(!!m.q('[data-vc-gear-index] [data-vc-gear-item]') && m.q('[data-vc-gear-index]').getAttribute('aria-label') !== null, 'T8c 索引屏里的九张卡仍是可点的真按钮（带 aria-label 的导航地标）')
  check(view.VC_MANAGE_PAGES.every(function (id) { return gearItems.indexOf(id) >= 0 }), 'T8d 九分区 id 与 VC_MANAGE_PAGES 一致')
  for (const pageId of view.VC_MANAGE_PAGES) {
    // 每一轮都从改动页重新进索引；索引不在时点齿轮把它打开。
    if (!m.q('[data-vc-gear-index]')) await m.click('[data-vc-gear-btn]')
    await m.click('[data-vc-gear-item="' + pageId + '"]')
    const entered = m.page() === pageId && m.depth() === '2' && !!m.q('[data-vc-page-body="' + pageId + '"]')
    const backBtn = !!m.q('[data-vc-back]')
    const firstBack = await m.click('[data-vc-back]')
    const backToIndex = m.page() === 'manage' && !!m.q('[data-vc-page-body="manage"]') && !!m.q('[data-vc-gear-item="' + pageId + '"]')
    await m.click('[data-vc-back]')
    check(entered && backBtn && firstBack && backToIndex && m.page() === 'changes', 'T9 齿轮进入管理分区 ' + pageId + '（二级页、有返回入口）后，返回先回索引、再回改动页')
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
  // #1860：能力清单退役后页面体没有可高亮的能力行；选中命令面板里的能力只负责跳到它所在的页。
  check(pickOk && m.page() === pickTarget.page && !m.q('[data-vc-palette]'), 'T10e 选中 2.1 落到 ' + pickTarget.page + ' 页并关面板')
  check(!m.q('[data-vc-palette]') && !m.q('[data-cap-hit]') && !m.q('[data-vc-cap-list]'), 'T10f 面板已关，页面体也没有能力行可高亮（清单已退役）')
  // 跨页落点：2.1 的落点就在改动页，返回入口要另挑一条落在别的页的能力来验。
  await m.click('[data-vc-search-entry]')
  await m.type('[data-vc-palette-input]', '提交列表')
  const crossRows = view.vcPaletteMatchOf('提交列表', '').map(function (cap) { return { cap: cap, target: view.vcPaletteTargetOf(cap.id) } })
  const cross = crossRows.filter(function (row) { return row.target.page !== 'changes' })[0]
  check(!!cross && !!m.q('[data-vc-palette-row="' + (cross ? cross.cap.id : '') + '"]'), 'T10g 搜索「提交列表」能找到落在别的页的能力（' + (cross ? cross.cap.id : '无') + '）')
  const crossOk = cross ? await m.click('[data-vc-palette-row="' + cross.cap.id + '"]') : false
  check(crossOk && !!cross && m.page() === cross.target.page && !m.q('[data-vc-palette]'), 'T10h 选中跨页能力后落到 ' + (cross ? cross.target.page : '') + ' 页并关面板')
  // #1860：落到一级页签时不进二级版式——清掉来源页，不画返回键，四个页签仍在（按页签切回）。
  check(!m.q('[data-vc-back]') && m.qa('[data-vc-tab]').length === 4, 'T10i 落到一级页签时不画返回键、页签条仍在（' + m.page() + '）')
  await m.click('[data-vc-tab="changes"]')
  check(m.page() === 'changes', 'T10j 从一级页签落点点页签回改动页')
  // 二级页落点（4.1 在分支与标签页）：保留返回来源页的键，返回一步回改动页。
  await m.click('[data-vc-search-entry]')
  await m.type('[data-vc-palette-input]', '4.1')
  const secTarget = view.vcPaletteTargetOf('4.1')
  const secOk = await m.click('[data-vc-palette-row="4.1"]')
  const secBack = m.page() === secTarget.page && !!m.q('[data-vc-back]')
  const secBackOk = secBack ? await m.click('[data-vc-back]') : false
  check(secOk && secBack && secBackOk && m.page() === 'changes', 'T10j2 落到二级页时保留返回来源页的键（4.1 → ' + secTarget.page + ' → 改动页）')
  // #1846：命令面板按遮罩呈现 —— 点面板内部不关，点遮罩本身就关，关了焦点回搜索入口。
  await m.click('[data-vc-search-entry]')
  check(!!m.q('[data-vc-palette-backdrop]') && !!m.q('[data-vc-palette]'), 'T10k 命令面板外面套了一层可点的遮罩（data-vc-palette-backdrop）')
  const insideClick = await m.click('[data-vc-palette-input]')
  check(insideClick && !!m.q('[data-vc-palette]'), 'T10l 点面板内部不会把面板关掉（只有点遮罩本身才关）')
  const backdropClick = await m.click('[data-vc-palette-backdrop]')
  check(backdropClick && !m.q('[data-vc-palette]'), 'T10m 点遮罩本身关闭命令面板（Esc 之外的第二条关闭路径）')
  check(focusOn(m, '[data-vc-search-entry]'), 'T10n 点遮罩关闭后焦点回到打开它的搜索入口')

  // ---- 分支浮层、同步带、搜索页与两个侧页 ----
  await m.click('[data-vc-branch-btn]')
  check(!!m.q('[data-vc-branch-overlay]'), 'T11 点分支按钮打开分支浮层')
  await m.click('[data-vc-branch-close]')
  check(!m.q('[data-vc-branch-overlay]'), 'T11b 关闭分支浮层')
  await m.click('[data-vc-sync]')
  check(m.page() === 'remote', 'T12 点同步带进入远端与同步页')
  await m.click('[data-vc-back]')
  check(m.page() === 'changes', 'T12b 从远端页返回改动页')
  // ---- #1860：顶部条上的侧入口（data-vc-extra-link）随原型外壳一起退役；变基、冲突、搜索三个侧页
  //   改由命令面板到达——每条能力本来就登记着「落在哪一页」，这里按落点页反查一条能力再点进去，
  //   验的是「能力仍可从唯一主入口到达」，不是再造一个侧入口按钮。
  const capIdOfPage = function (pageId) {
    const rows = view.vcPaletteRowsOf('', view.VC_PALETTE_RENDER_MAX, '')
    const hit = rows.filter(function (row) { return view.vcPaletteTargetOf(row.id).page === pageId })[0]
    return hit ? String(hit.id) : ''
  }
  const enterViaPalette = async function (pageId) {
    const capId = capIdOfPage(pageId)
    if (!capId) return false
    if (!m.q('[data-vc-palette]')) await m.click('[data-vc-search-entry]')
    await m.type('[data-vc-palette-input]', capId)
    const row = m.q('[data-vc-palette-row="' + capId + '"]')
    if (!row) return false
    await m.click(row)
    return m.page() === pageId && !m.q('[data-vc-palette]')
  }
  for (const pageId of ['search', 'rebase', 'conflicts']) {
    const entered = await enterViaPalette(pageId)
    const bodyOk = !!m.q('[data-vc-page-body="' + pageId + '"]')
    const backOk = entered ? await m.click('[data-vc-back]') : false
    check(entered && bodyOk && backOk && m.page() === 'changes', 'T13 侧页「' + pageId + '」能从命令面板进去、再回改动页（' + (capIdOfPage(pageId) || '无') + ' 的主入口是命令面板）')
  }
  const searchEntered = await enterViaPalette('search')
  // #1846：搜索页改成独立版式，首屏就是这一页自己的搜索输入框（整页唯一一个），命令面板不再嵌进这一页。
  const searchPageOk = searchEntered && m.qa('[data-vc-search-input]').length === 1 && m.qa('[data-vc-palette-input]').length === 0
  if (searchEntered) await m.click('[data-vc-back]')
  check(searchPageOk, 'T13b 搜索页画自己的搜索输入框（整页唯一一个输入框，命令面板不嵌这一页）')

  // ---- 三时机刷新：手动刷新 ----
  const before = countKin(host, 'wf.gitFirstScreen')
  await m.click('[data-vc-refresh]')
  check(countKin(host, 'wf.gitFirstScreen') === before + 1, 'T14 手动刷新再发一次 wf.gitFirstScreen（第 ' + (before + 1) + ' 次）')

  // ---- 改动页首批动作：预检 + 执行 ----
  const changeCallsBefore = host.calls.length
  await m.click('[data-vc-file-group-all="stage"]')
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

  // ---- 贮藏页首批动作：写动作走三段式（预检签票 → 页面确认卡 → 凭票执行），不再一步直发 ----
  await m.click('[data-vc-tab="stash"]')
  const stashCheckBefore = countKin(host, 'wf.gitStashCheck')
  const stashBefore = countKin(host, 'wf.gitStash')
  await m.click('[data-vc-stash-op="push"]')
  const stashCheckCall = host.calls.filter(function (one) { return one.phone === 'wf.gitStashCheck' })[stashCheckBefore]
  check(countKin(host, 'wf.gitStashCheck') === stashCheckBefore + 1 && !!stashCheckCall && String((stashCheckCall.args || {}).op || '') === 'push' && stashCheckCall.args.confirm === undefined && countKin(host, 'wf.gitStash') === stashBefore, 'T17 贮藏页点 push 先发预检电话 wf.gitStashCheck（op=push、不带 confirm），预检阶段不执行写')
  check(!!m.q('[data-vc-stash-confirm]'), 'T17b 预检签出票后贴触发点出确认卡，等人过目')
  await m.click('[data-vc-stash-confirm-go="1"]')
  const stashCall = host.calls.filter(function (one) { return one.phone === 'wf.gitStash' })[stashBefore]
  check(countKin(host, 'wf.gitStash') === stashBefore + 1 && !!stashCall && String((stashCall.args || {}).op || '') === 'push' && String((stashCall.args || {}).ticketId || '') === 'st-ticket' && stashCall.args.confirmed === true, 'T17c 确认后才凭票发执行电话 wf.gitStash（带预检拿到的 ticketId、confirmed=true）')

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
  check(!!m.q('[data-vc-commit-panel]') && !!m.q('[data-vc-changes-view]') && m.qa('[data-vc-changes-op]').length === 0, 'T19c 其它片仍然可用（改动正文与提交面板都在，动作清单已退役）')
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
  const newTs = ['vcRealModel', 'vcRealManage', 'vcRealManageReads', 'vcRealManageActions', 'vcRealManageActions2', 'vcRealManageActions3', 'vcRealManageSide', 'vcRealShell', 'vcRealDelegate', 'vcRealActions', 'vcRealTab']
  check(newTs.every(function (id) { return buildSrc.indexOf('id: \'' + id + '\'') >= 0 }), 'T22 scripts/build.mts 叶子清单登记了十一个新叶子')
  check(newTs.every(function (id) { return indexSrc.indexOf('leaf:' + id) >= 0 }), 'T22b src/client/index.ts 有十一个新叶子的拼接标记')
  check(NEW_FILES.every(function (f) { return g818.indexOf(f) >= 0 }), 'T22c verify-818 的闭包文件清单登记了十一个新叶子（否则 818 渲染会缺函数）')
  const tabSrc = read('src/client/views/versionControl/VersionControlTab.ts')
  check(tabSrc.indexOf('VcRealTab') >= 0 && tabSrc.indexOf('vcBlocksOf') < 0, 'T22d 入口组件只做委托（出现 VcRealTab、不再有旧块渲染入口）')
  const files = fs.readdirSync(path.join(ROOT, 'src/client/views/versionControl')).filter(function (name) { return /\.ts$/.test(name) })
  const bad = files.filter(function (name) { return /\bon(click|input|change)\s*:/.test(read('src/client/views/versionControl/' + name)) })
  check(bad.length === 0, 'T22e 版本管理客户端源码里没有小写事件属性（' + (bad.length === 0 ? '全部驼峰' : '仍剩 ' + bad.join(',')) + '）')
  // 顶部条与失败条 M2 已从容器搬到 vcRealShell 一叶（容器行数要留在每文件 350 有效行以内）。
  const shellSrc = read('src/client/views/versionControl/vcRealShell.ts')
  const logKeys = ['vc.reload', 'vc.row.open.', 'vc.commit.back', 'vc.changes.back']
  check(logKeys.every(function (key) { return shellSrc.indexOf(key) >= 0 }), 'T22f 新容器保留 ui-feedback 门禁要求的四个 data-log 词条')
  check(shellSrc.indexOf('data-vc-refresh') >= 0, 'T22g 手动刷新入口写在容器里（data-vc-refresh）')
  check(shellSrc.indexOf('data-vc-slice-fail') >= 0, 'T22h 片级失败条写在容器里（data-vc-slice-fail）')
}

// ---------------- 场景六：九个管理分区与两个侧页的读数、三段式动作、浮层与能力行 ----------------
// 这一段的假宿主记录每一次电话：断言的是「点了之后真的打了哪个电话、带了什么参数」，
//   不是源码里有没有某个字符串。三段式的三段分别是：预检电话、页面上的确认卡、凭票执行电话。
async function scenarioManage() {
  console.log('\n== 场景六：管理分区与侧页的真实读数与三段式动作 ==')
  const host = makeHost({})
  const view = buildView(host, null)
  const m = mountOf(view, { st: { cwd: CWD } })
  await React.act(async function () { m.root.render(React.createElement(view.VersionControlTab, { st: { cwd: CWD } })) })
  await settle()

  // ---- 九个管理分区：进入即读数、正文不是骨架、能从来源页返回 ----
  // hooks 与 config 共用一份配置读数（wf.gitConfigRead），所以进 hooks 那一轮按去重不打第二通电话。
  const pages: any[] = [
    { page: 'branch-tags', root: '[data-vc-branch2]', phone: 'wf.gitBranches' },
    { page: 'remote', root: '[data-vc-remote-page]', phone: 'wf.gitRemoteList' },
    { page: 'submodules', root: '[data-vc-sub-page]', phone: 'wf.gitSubmodules' },
    { page: 'maintenance', root: '[data-vc-page-body="maintenance"]', phone: '' },
    { page: 'migrate', root: '[data-vc-migrate-page]', phone: 'wf.gitMigrateCheck' },
    { page: 'config', root: '[data-vc-config-page]', phone: 'wf.gitConfigRead' },
    { page: 'hooks', root: '[data-vc-hooks-page]', phone: 'wf.gitConfigRead', dedupe: true },
    { page: 'diagnostics', root: '[data-vc-diag-panel]', phone: 'wf.gitDiagnosticsRead' },
    { page: 'platform', root: '[data-vc-platform]', phone: 'wf.gitPlatformRead' },
  ]
  for (const one of pages) {
    if (!m.q('[data-vc-gear-index]')) await m.click('[data-vc-gear-btn]')
    const before = one.phone ? countKin(host, one.phone) : 0
    const opened = await m.click('[data-vc-gear-item="' + one.page + '"]')
    const entered = opened && m.page() === one.page && m.depth() === '2' && !!m.q(one.root)
    const noSkeleton = !m.q('[data-vc-page-body="' + one.page + '"] [data-vc-skeleton]')
    const after = one.phone ? countKin(host, one.phone) : 0
    const readOk = one.phone ? (one.dedupe === true ? after === before : after === before + 1) : true
    const readNote = one.phone ? (one.dedupe === true ? '共用读数不重复发 ' + one.phone : '进入读数电话 ' + one.phone + ' 真发一次') : '这一页不需要进入读数'
    check(entered && noSkeleton && readOk, 'T23 进入管理分区 ' + one.page + '：正文已接上（' + one.root + '）、不画骨架、' + readNote)
    const firstBack = await m.click('[data-vc-back]')
    const backToIndex = m.page() === 'manage' && !!m.q('[data-vc-gear-index]')
    await m.click('[data-vc-back]')
    check(firstBack && backToIndex && m.page() === 'changes', 'T23b 从 ' + one.page + ' 先回索引、再回来源页（改动页）')
  }
  // 两个侧页的入口与改动页一致：命令面板（#1860 顶部条退役后不再有 data-vc-extra-link）。
  //   变基要读状态与窗口两条电话，冲突读冲突清单一条。
  const enterSideViaPalette = async function (pageId) {
    const rows = view.vcPaletteRowsOf('', view.VC_PALETTE_RENDER_MAX, '')
    const hit = rows.filter(function (row) { return view.vcPaletteTargetOf(row.id).page === pageId })[0]
    if (!hit) return false
    if (!m.q('[data-vc-palette]')) await m.click('[data-vc-search-entry]')
    await m.type('[data-vc-palette-input]', String(hit.id))
    const row = m.q('[data-vc-palette-row="' + hit.id + '"]')
    if (!row) return false
    await m.click(row)
    return m.page() === pageId
  }
  const rebaseBefore = countKin(host, 'wf.gitRebaseRead')
  const rebaseEntered = await enterSideViaPalette('rebase')
  check(rebaseEntered && !!m.q('[data-vc-rebase-page]') && countKin(host, 'wf.gitRebaseRead') === rebaseBefore + 2, 'T23c 从命令面板进入变基页，发两条读数电话（rebase-state 与 rebase-window）')
  await m.click('[data-vc-back]')
  const conflictBefore = countKin(host, 'wf.gitConflicts')
  const conflictEntered = await enterSideViaPalette('conflicts')
  check(conflictEntered && !!m.q('[data-vc-conflicts-page]') && countKin(host, 'wf.gitConflicts') === conflictBefore + 1, 'T23d 从命令面板进入冲突页，发一条冲突清单读数电话（wf.gitConflicts）')
  await m.click('[data-vc-back]')

  // ---- 分支板三段式：点动作 → 预检电话 → 确认卡 → 凭票执行 → 结果贴回触发点、写后重读 ----
  if (!m.q('[data-vc-gear-index]')) await m.click('[data-vc-gear-btn]')
  await m.click('[data-vc-gear-item="branch-tags"]')
  const branchesBefore = countKin(host, 'wf.gitBranches')
  const switchBtn = m.q('[data-vc-branch-row="feat/x"] [data-vc-branch-action="switch"]')
  check(!!switchBtn, 'T24 分支板画出「切换分支」入口（feat/x 行）')
  if (switchBtn) await m.click(switchBtn)
  const checkLog = host.calls.filter(function (one: any) { return one.phone === 'wf.gitBranchCheck' })
  const checkArgs = (checkLog[checkLog.length - 1] || {}).args || {}
  check(checkLog.length > 0 && String(checkArgs.op || '') === 'switch' && String(checkArgs.name || '') === 'feat/x', 'T24b 点「切换分支」先发预检电话 wf.gitBranchCheck（op=switch、name=feat/x），不直接执行')
  check(!!m.q('[data-vc-branch2] [data-vc-confirm]'), 'T24c 预检要确认时停在页面确认卡上（不自动执行）')
  const branchWritesBefore = countKin(host, 'wf.gitBranchWrite')
  await m.click('[data-vc-branch2] .vcs-confirm-go')
  const writeLog = host.calls.filter(function (one: any) { return one.phone === 'wf.gitBranchWrite' })
  const writeArgs = (writeLog[writeLog.length - 1] || {}).args || {}
  check(countKin(host, 'wf.gitBranchWrite') === branchWritesBefore + 1 && String(writeArgs.ticketId || '') === 'br-ticket' && writeArgs.confirmed === true, 'T24d 确认后才凭票发执行电话 wf.gitBranchWrite（带预检拿到的 ticketId、confirmed=true）')
  check(countKin(host, 'wf.gitBranches') > branchesBefore, 'T24e 写成功后重读分支板（wf.gitBranches 再发一次）')
  check(!!m.q('[data-vc-branch2] [data-vc-result="ok"]'), 'T24f 分支动作的结果回到触发点（结果块 data-vc-result=ok）')

  // ---- 远端写三段式（#1776 M4b）：提交表单先发预检电话签票 → 确认卡 → 凭票发执行电话，成功后重读列表 ----
  await m.click('[data-vc-back]')
  if (!m.q('[data-vc-gear-index]')) await m.click('[data-vc-gear-btn]')
  await m.click('[data-vc-gear-item="remote"]')
  const triggerOk = await m.click('[data-vc-remote-trigger="add"]')
  check(triggerOk && !!m.q('[data-vc-remote-form="add"]') && m.qa('[data-vc-remote-form="add"] [data-vc-remote-field]').length === 2, 'T25 点「新增远端」展开表单（名字与地址两格）')
  await m.type('[data-vc-remote-form="add"] [data-vc-remote-field="name"]', 'backup')
  await m.type('[data-vc-remote-form="add"] [data-vc-remote-field="url"]', 'git@example.com:backup.git')
  const remoteCheckBefore = countKin(host, 'wf.gitRemoteCheck')
  const listBefore = countKin(host, 'wf.gitRemoteList')
  const addBefore = countKin(host, 'wf.gitRemoteAdd')
  await m.click('[data-vc-remote-submit="add"]')
  const remoteCheckLog = host.calls.filter(function (one: any) { return one.phone === 'wf.gitRemoteCheck' })
  const remoteCheckArgs = (remoteCheckLog[remoteCheckLog.length - 1] || {}).args || {}
  check(countKin(host, 'wf.gitRemoteCheck') === remoteCheckBefore + 1 && String(remoteCheckArgs.action || '') === 'add' && String(remoteCheckArgs.name || '') === 'backup' && String(remoteCheckArgs.url || '').indexOf('backup.git') >= 0, 'T25b 提交表单先发预检电话 wf.gitRemoteCheck（动作与目标都取自表单），不直接写')
  check(countKin(host, 'wf.gitRemoteAdd') === addBefore && !!m.q('[data-vc-remote-confirm][data-vc-remote-confirm-action="add"] [data-vc-confirm="1"]'), 'T25c 预检成功后停在确认卡上（写电话还没发，卡上写明动作）')
  await m.click('[data-vc-remote-confirm] .vcs-confirm-go')
  const addLog = host.calls.filter(function (one: any) { return one.phone === 'wf.gitRemoteAdd' })
  const addArgs = (addLog[addLog.length - 1] || {}).args || {}
  check(countKin(host, 'wf.gitRemoteAdd') === addBefore + 1 && String(addArgs.ticketId || '') === 'rm-ticket' && addArgs.confirmed === true && String(addArgs.name || '') === 'backup' && String(addArgs.url || '').indexOf('backup.git') >= 0, 'T25d 确认后才凭票发 wf.gitRemoteAdd（带预检拿到的票号与确认标记）')
  check(countKin(host, 'wf.gitRemoteList') > listBefore, 'T25e 写成功后重读远端列表')
  check(!!m.q('.vcs-remote-add [data-vc-result="ok"]'), 'T25f 登记结果贴回登记入口那一段（data-vc-result=ok）')

  // ---- 同步带三段式：展开 → 预检电话 → 确认卡 → 凭票执行 ----
  const syncCheckBefore = countKin(host, 'wf.gitSyncCheck')
  await m.click('[data-vc-sync-act="8.5"]')
  const syncCheckBtn = m.q('[data-vc-sync-check="8.5"]')
  check(!!syncCheckBtn, 'T26 远端页的同步带里能展开 8.5 并看到预检按钮')
  if (syncCheckBtn) await m.click(syncCheckBtn)
  const syncCheckLog = host.calls.filter(function (one: any) { return one.phone === 'wf.gitSyncCheck' })
  const syncCheckArgs = (syncCheckLog[syncCheckLog.length - 1] || {}).args || {}
  check(countKin(host, 'wf.gitSyncCheck') === syncCheckBefore + 1 && String(syncCheckArgs.action || '') === 'fetch', 'T26b 点同步预检发 wf.gitSyncCheck（action=fetch）')
  check(!!m.q('[data-vc-sync-confirm]'), 'T26c 同步预检要确认时停同步确认卡')
  const syncWriteBefore = countKin(host, 'wf.gitSyncWrite')
  await m.click('[data-vc-sync-confirm] .vcs-confirm-go')
  const syncWriteLog = host.calls.filter(function (one: any) { return one.phone === 'wf.gitSyncWrite' })
  const syncWriteArgs = (syncWriteLog[syncWriteLog.length - 1] || {}).args || {}
  check(countKin(host, 'wf.gitSyncWrite') === syncWriteBefore + 1 && String(syncWriteArgs.ticketId || '') === 'sy-ticket' && String(syncWriteArgs.action || '') === 'fetch', 'T26d 确认后凭票发 wf.gitSyncWrite（票号与动作取自预检回包）')

  // ---- 分支浮层五项动作：点了跳分支板并保留返回入口（壳里那五个只有文字，靠委托） ----
  await m.click('[data-vc-back]')
  await m.click('[data-vc-branch-btn]')
  const overlayItem = m.q('[data-vc-branch-overlay] [data-vc-branch-action="create"]')
  check(!!overlayItem, 'T27 分支浮层画出五个动作项（「新建」这一项在）')
  if (overlayItem) await m.click(overlayItem)
  check(m.page() === 'branch-tags' && !m.q('[data-vc-branch-overlay]') && !!m.q('[data-vc-back]'), 'T27b 点浮层里的「新建」跳到分支板、浮层关闭、保留返回来源页的入口')

  // ---- 能力行：点了跳该能力所在页并高亮，不自动执行 ----
  // #1860：分支页不再挂能力清单。原先「点能力行跳落点」的动作改由命令面板承担，这里验分支页干净、面板能到 4.1。
  check(!m.q('[data-cap-row]') && !m.q('[data-vc-cap-list]'), 'T28 分支页不再挂能力清单（能力行只在命令面板）')
  await m.click('[data-vc-search-entry]')
  await m.type('[data-vc-palette-input]', '4.1')
  const branchCapRow = m.q('[data-vc-palette-row="4.1"]')
  check(!!branchCapRow, 'T28b 命令面板搜得到 4.1（分支与标签页的主入口）')
  if (branchCapRow) await m.click(branchCapRow)
  check(m.page() === 'branch-tags' && !m.q('[data-vc-palette]'), 'T28c 点面板行落到分支与标签页并关面板')
  await m.click('[data-vc-back]')
  // ---- #1846：分支浮层五个动作各自落到真正做这件事的入口，不是只到页顶 ----
  // 分支页只拥有 4.1–4.13；合并属域 6（落冲突页 6.1）、变基属域 6（落变基页 5.7 换基座），
  // 所以「新建/删除/列表」去分支页、「合并」去冲突页、「变基」去变基页——都是那条能力的真入口，不造假按钮。
  const landingCases = [
    { action: 'list', page: 'branch-tags', sel: '[data-vc-branch-query]' },
    { action: 'create', page: 'branch-tags', sel: '[data-vc-branch-forms] [data-vc-branch-action="create"]' },
    { action: 'delete', page: 'branch-tags', sel: '[data-vc-branch-forms] [data-vc-branch-action="delete"]' },
    { action: 'merge', page: 'conflicts', sel: '[data-vc-conflicts-op="merge"]' },
    { action: 'rebase', page: 'rebase', sel: '[data-vc-rebase-op="rebase-onto"]' },
  ]
  for (const one of landingCases) {
    await m.click('[data-vc-branch-btn]')
    const item = m.q('[data-vc-branch-overlay] [data-vc-branch-action="' + one.action + '"]')
    check(!!item, 'T27c 分支浮层里有「' + one.action + '」这一项（纯文字条目，不是假按钮）')
    if (!item) continue
    await m.click(item)
    const landed = await waitFor(function () { return m.page() === one.page && !!m.q(one.sel) }, 60)
    check(landed, 'T27d 浮层动作「' + one.action + '」落到 ' + one.page + ' 页的对应入口（' + one.sel + '）')
    if (landed) {
      const focused = await waitFor(function () { return focusOn(m, one.sel) }, 60)
      check(focused, 'T27e 浮层动作「' + one.action + '」把焦点送到那个入口（键盘能接着操作）')
      check(!m.q('[data-vc-branch-overlay]'), 'T27f 浮层动作「' + one.action + '」落地后浮层已关掉')
    }
    if (m.depth() === '2') await m.click('[data-vc-back]')
  }
  check(countKin(host, 'wf.gitTaskQuery') >= 1, 'T29 容器轮询任务通道（wf.gitTaskQuery 至少一次）')
  await m.unmount()

  // ---- 任务面板：运行中的任务能点取消，取消要发 wf.gitTaskCancel ----
  const host2 = makeHost({ reply: { 'wf.gitTaskQuery': function () { return { ok: true, tasks: [{ taskId: 't9', kind: 'fetch', state: 'running' }], running: 1 } } } })
  const view2 = buildView(host2, null)
  const m2 = mountOf(view2, { st: { cwd: CWD } })
  await React.act(async function () { m2.root.render(React.createElement(view2.VersionControlTab, { st: { cwd: CWD } })) })
  await settle()
  // #1860：四个页签按原型铺满整屏，宿主的长任务区不再压在页签上（原型首屏没有它）；
  //   它仍挂在二级页（这里是远端与同步页），运行中的任务照样能看到并取消。判据跟着真实挂载点走。
  check(!m2.q('[data-vc-task-cancel]'), 'T29a 四个页签首屏不再压宿主的长任务区（原型首屏没有这一块）')
  if (!m2.q('[data-vc-gear-index]')) await m2.click('[data-vc-gear-btn]')
  await m2.click('[data-vc-gear-item="remote"]')
  const cancelBtn = m2.q('[data-vc-task-cancel]')
  check(!!cancelBtn, 'T29b 二级页上画出运行中任务的取消按钮（wf.gitTaskQuery 回 running=1 时）')
  if (cancelBtn) await m2.click(cancelBtn)
  const cancelLog = host2.calls.filter(function (one: any) { return one.phone === 'wf.gitTaskCancel' })
  check(cancelLog.length === 1 && String(((cancelLog[0] || {}).args || {}).taskId || '') === 't9', 'T29c 点取消发出 wf.gitTaskCancel（带任务号）')
  await m2.unmount()

  // ---- 反证：把分支动作的预检电话换成执行电话，T24b 必须判红 ----
  const actionFile = 'src/client/views/versionControl/vcRealManageActions.js'
  const original = readSource(actionFile)
  const needle = 'Promise.resolve(vcBranchCheck({ branch: m.branch }, callHost, cwd, op, f))'
  check(original.indexOf(needle) >= 0, 'T30 自证：分支动作源码里确有预检调用（改法能命中；失效时这条先红）')
  const host3 = makeHost({})
  const patched = buildView(host3, {
    [actionFile]: function (code: any) { return code.replace(needle, 'Promise.resolve(vcBranchWrite({ branch: m.branch }, callHost, cwd, op, f))') },
  })
  const m3 = mountOf(patched, { st: { cwd: CWD } })
  await React.act(async function () { m3.root.render(React.createElement(patched.VersionControlTab, { st: { cwd: CWD } })) })
  await settle()
  if (!m3.q('[data-vc-gear-index]')) await m3.click('[data-vc-gear-btn]')
  await m3.click('[data-vc-gear-item="branch-tags"]')
  const sw3 = m3.q('[data-vc-branch-row="feat/x"] [data-vc-branch-action="switch"]')
  if (sw3) await m3.click(sw3)
  check(countKin(host3, 'wf.gitBranchCheck') === 0 && countKin(host3, 'wf.gitBranchWrite') >= 1, 'T30b 反证成立：去掉预检直接执行时 wf.gitBranchCheck 为 0、wf.gitBranchWrite 有记录（T24b 的断言抓得住这类退化）')
  await m3.unmount()
}

// ---------------- 场景七：AI 入口（#854）—— 只在面板解决不了时出现，点开的 prompt 只带已读事实 ----------------
// 818 那扇门禁用静态渲染验「四个落点各在什么条件下出现」；这里真挂载、真点一次，验点开之后交给新会话的正文：
// 仓库/分支/冲突这些面板已经读到的事实由面板填，目标与补充两行留给人补，且不发任何写电话（预填不发送）。
async function scenarioAiHandoff() {
  console.log('\n== 场景七：AI 入口真挂载与 prompt 内容 ==')
  const snap = snapshotOf()
  snap.slices.changes.data.conflictCount = 1
  snap.slices.changes.data.unstaged.push({ path: 'a.txt', status: 'UU', staged: false, untracked: false, conflict: true })
  snap.slices.workspace.data.repo = Object.assign({}, snap.slices.workspace.data.repo, { rebasing: true })
  const host = makeHost({ reply: { 'wf.gitFirstScreen': function () { return { ok: true, firstScreen: snap, readAtMs: NOW } } } })
  const view = buildView(host, null)
  const opened = []
  const prevOpener = global.openTextInNewSession
  global.openTextInNewSession = function (st, body, title, opts) { opened.push({ st: st, body: body, title: title, opts: opts }) }
  const m = mountOf(view, { st: { cwd: CWD } })
  await React.act(async function () { m.root.render(React.createElement(view.VersionControlTab, { st: { cwd: CWD } })) })
  await settle()
  const kinds = m.qa('[data-vc-ai]').map(function (el) { return el.getAttribute('data-vc-ai') })
  check(kinds.indexOf('conflict') >= 0 && kinds.indexOf('midop') >= 0, 'T31 有冲突且正在变基时页面上出现两个 AI 入口（' + kinds.join(',') + '）')
  const beforeCalls = host.calls.length
  const clicked = await m.click('[data-vc-ai="conflict"]')
  check(clicked && opened.length === 1, 'T31b 点冲突入口交给新会话一次（opener 被调一次，预填不发送）')
  const handoff = opened[0] || {}
  const body = String(handoff.body || '')
  const lines = body.split('\n')
  check(handoff.title === tZh('vc.ai.title', { branch: 'main' }) && handoff.opts && handoff.opts.kind === 'fix' && handoff.st && handoff.st.cwd === CWD, 'T31c 交出去的标题、fix 档与工作区都对（新会话落在同一个 cwd）')
  check(lines[lines.length - 1] === tZh('vc.ai.extra') && lines[lines.length - 2] === tZh('vc.ai.goal'), 'T31d 目标与补充两行原样留白（只有词条本身，不替人编内容）')
  check(body.indexOf('看到：') >= 0 && body.indexOf('想做：') >= 0 && body.indexOf('dsh-plugin') >= 0 && body.indexOf('- a.txt') >= 0 && body.indexOf('vc.') < 0, 'T31e prompt 带上已读事实（仓库、卡住的文件 a.txt、看到的难处），没有词条键名')
  check(host.calls.length === beforeCalls, 'T31f 点 AI 入口只开会话、不发任何宿主电话（也没顺手执行修复）')
  global.openTextInNewSession = prevOpener
  await m.unmount()
}

// ---------------- 场景九：M4d 四处规格缺口（页签真实计数 / 在途闸 / Esc 返回与滚动还原 / 浮层焦点） ----------------
// 这四条都是代码评审按规格点名的缺口：页签计数要来自首屏真实读数并带单位；同对象同动作的第二下
//   要在在途时被拦住（不能等下一帧的 ui.state）；Esc 先关浮层，没有浮层时回来源页并还原滚动位置、
//   保住筛选词；浮层与确认卡打开时焦点进第一个可操作控件，关掉回触发它的按钮。
async function scenarioM4d() {
  console.log('\n== 场景九：M4d 页签真实计数、在途闸、Esc 返回与滚动还原、浮层焦点 ==')
  const mountTab = async function (host) {
    const view = buildView(host, null)
    const m = mountOf(view, { st: { cwd: CWD }, narrow: false })
    await React.act(async function () { m.root.render(React.createElement(view.VersionControlTab, { st: { cwd: CWD }, narrow: false })) })
    await settle()
    return { view: view, m: m }
  }
  const activeIs = function (m, sel) {
    const want = typeof sel === 'string' ? m.q(sel) : sel
    return !!want && document.activeElement === want
  }
  // #1860：页签按原画成 .tab-count > .count + .unit（数字与单位分开），读数是两者拼起来的文本。
  const tabCountText = function (m, id) {
    const el = m.q('[data-vc-tab="' + id + '"] .tab-count')
    return el ? String(el.textContent || '') : ''
  }
  const tabCountState = function (m, id) {
    const el = m.q('[data-vc-tab="' + id + '"] .tab-count')
    return el ? String(el.getAttribute('data-vc-tab-count-state') || '') : ''
  }
  const tabCountWant = function (n, id) { return String(n) + tZh('vc.shell.tab.unit.' + id) }

  // —— 1) 页签计数：来自首屏四片真实读数（改动=工作区文件数、提交=已读条数、工作树=棵数、贮藏=条数），带单位 ——
  const first = await mountTab(makeHost({}))
  check(tabCountText(first.m, 'changes') === tabCountWant(1, 'changes') && tabCountState(first.m, 'changes') === 'ok',
    'T32 改动页签计数来自首屏改动片（1 个工作区文件），不再是能力账本条数：' + tabCountText(first.m, 'changes'))
  check(tabCountText(first.m, 'commits') === tabCountWant(1, 'commits') && tabCountText(first.m, 'worktrees') === tabCountWant(1, 'worktrees') && tabCountText(first.m, 'stash') === tabCountWant(0, 'stash'),
    'T32b 提交历史/工作树/贮藏三个计数各来自自己的首屏片（1 条提交、1 棵工作树、0 条贮藏）：' + [tabCountText(first.m, 'commits'), tabCountText(first.m, 'worktrees'), tabCountText(first.m, 'stash')].join(' / '))
  check(tabCountState(first.m, 'stash') === 'ok' && tabCountText(first.m, 'stash').indexOf('0') >= 0, 'T32c 已知为零照实显示 0，不拿未知的破折号糊弄')
  await first.m.unmount()
  const failed = await mountTab(makeHost({ failSlice: 'changes' }))
  check(tabCountText(failed.m, 'changes') === '—' && tabCountState(failed.m, 'changes') === 'unknown', 'T32d 改动片读失败时该页签不拿 0 冒充，标成未知（—）：' + tabCountText(failed.m, 'changes'))
  check(tabCountText(failed.m, 'commits') === tabCountWant(1, 'commits') && tabCountText(failed.m, 'worktrees') === tabCountWant(1, 'worktrees'), 'T32e 一片读失败不拖累其它页签的计数')
  await failed.m.unmount()

  // —— 2) 在途闸：同一帧连点两下同对象同动作只发一份电话，第二下复用同一份结果；不同对象照常并行 ——
  const gateHost = makeHost({})
  const g = await mountTab(gateHost)
  // #1860：13 条动作面板退役后，同一动作改在文件行上（1.3 暂存 = 行里的「暂存」）。
  const btn13 = g.m.q('[data-vc-file-row="a.txt"] [data-vc-file-op="stage-file"]')
  await React.act(async function () {
    btn13.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
    btn13.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await settle()
  check(countKin(gateHost, 'wf.gitChangesCheck') === 1 && countKin(gateHost, 'wf.gitChangesWrite') === 1,
    'T33 同一动作同一帧点两下只发一份预检与一份执行（预检 ' + countKin(gateHost, 'wf.gitChangesCheck') + ' 次、执行 ' + countKin(gateHost, 'wf.gitChangesWrite') + ' 次），第二下复用同一份结果')
  await g.m.unmount()
  const parHost = makeHost({})
  const par = await mountTab(parHost)
  const par13 = par.m.q('[data-vc-file-row="a.txt"] [data-vc-file-op="stage-file"]')
  // 第二个对象换成分组级「全部暂存」：它与逐文件暂存是两条不同的状态行（键不同），同时点应各发各的。
  const par15 = par.m.q('[data-vc-file-group-all="stage"]')
  await React.act(async function () {
    par13.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
    par15.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await settle()
  check(countKin(parHost, 'wf.gitChangesCheck') === 2 && countKin(parHost, 'wf.gitChangesWrite') === 2,
    'T33b 不同状态行（暂存 a.txt 与全部暂存）同一帧各点一下，两份都真发出去（不是一把全局布尔闸）')
  await par.m.unmount()
  const gateNeedle = 'actions.gate'
  check(readSource('src/client/views/versionControl/vcRealTab.js').indexOf(gateNeedle) >= 0, 'T33c 自证：容器把在途闸交给改动页处理器（源码里有 actions.gate，改法能命中）')
  const noGateHost = makeHost({})
  const noGate = buildView(noGateHost, { 'src/client/views/versionControl/vcRealTab.js': function (code) { return code.replace(', actions.gate)', ')') } })
  const ng = mountOf(noGate, { st: { cwd: CWD } })
  await React.act(async function () { ng.root.render(React.createElement(noGate.VersionControlTab, { st: { cwd: CWD } })) })
  await settle()
  const ngBtn = ng.q('[data-vc-file-row="a.txt"] [data-vc-file-op="stage-file"]')
  await React.act(async function () {
    ngBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
    ngBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await settle()
  check(countKin(noGateHost, 'wf.gitChangesCheck') === 2 && countKin(noGateHost, 'wf.gitChangesWrite') === 2,
    'T33d 反证：把在途闸拿掉后同样两下真的发出两份（说明 T33 的 1/1 抓得住退化）')
  await ng.unmount()

  // —— 3) Esc：浮层开着先关浮层；没有浮层时回来源页，并还原滚动位置、保住筛选词 ——
  const esc = await mountTab(makeHost({}))
  const rootEl = esc.m.q('[data-vc-live]')
  let scrollY = 0
  Object.defineProperty(rootEl, 'scrollTop', { configurable: true, get: function () { return scrollY }, set: function (v) { scrollY = Number(v) || 0 } })
  scrollY = 240
  await React.act(async function () { rootEl.dispatchEvent(new dom.window.Event('scroll')) })
  await settle()
  await esc.m.click('[data-vc-search-entry]')
  await esc.m.type('[data-vc-palette-input]', '暂存')
  await esc.m.key('[data-vc-palette-input]', 'Escape')
  check(!esc.m.q('[data-vc-palette]') && esc.m.page() === 'changes', 'T34 Esc 只关当前浮层，不把页面一起带走')
  await esc.m.click('[data-vc-gear-btn]')
  await esc.m.click('[data-vc-gear-item="' + esc.view.VC_MANAGE_PAGES[0] + '"]')
  const subPage = esc.view.VC_MANAGE_PAGES[0]
  await esc.m.key('[data-vc-live]', 'Escape')
  const escToIndex = esc.m.page() === 'manage' && !!esc.m.q('[data-vc-gear-index]')
  await esc.m.key('[data-vc-live]', 'Escape')
  check(escToIndex && esc.m.page() === 'changes' && esc.m.depth() === '1', 'T34b 二级管理页按 Esc 先回索引、再回来源页（' + subPage + ' → manage → changes）')
  check(scrollY === 240, 'T34c 回来源页后滚动位置还原到离开时的 240（实得 ' + scrollY + '）')
  await esc.m.click('[data-vc-search-entry]')
  const kept = esc.m.q('[data-vc-palette-input]')
  check(!!kept && kept.value === '暂存', 'T34d 回来源页后筛选词保留（命令面板输入框仍是「暂存」）')
  await esc.m.key('[data-vc-palette-input]', 'Escape')
  await esc.m.unmount()
  const escapeNeedle = 'setNav(vcRealNavBack(cur))'
  check(readSource('src/client/views/versionControl/vcRealShell.js').indexOf(escapeNeedle) >= 0, 'T34e 自证：Esc 回来源页那一句写在容器里（改法能命中）')
  const backHost = makeHost({})
  const backView = buildView(backHost, { 'src/client/views/versionControl/vcRealShell.js': function (code) { return code.replace(escapeNeedle, 'void 0') } })
  const bm = mountOf(backView, { st: { cwd: CWD } })
  await React.act(async function () { bm.root.render(React.createElement(backView.VersionControlTab, { st: { cwd: CWD } })) })
  await settle()
  await bm.click('[data-vc-gear-btn]')
  await bm.click('[data-vc-gear-item="' + backView.VC_MANAGE_PAGES[0] + '"]')
  await bm.key('[data-vc-live]', 'Escape')
  check(bm.page() === backView.VC_MANAGE_PAGES[0], 'T34f 反证：把 Esc 回来源页那句拿掉后停在二级页（说明 T34b 抓得住）')
  await bm.unmount()

  // —— 4) 焦点：浮层与确认卡打开时进第一个可操作控件，关掉回触发按钮 ——
  const foc = await mountTab(makeHost({}))
  await foc.m.click('[data-vc-gear-btn]')
  check(activeIs(foc.m, '[data-vc-gear-index] [data-vc-gear-item]'), 'T35 齿轮打开后焦点进索引的第一项')
  await foc.m.key('[data-vc-gear-index] [data-vc-gear-item]', 'Escape')
  check(activeIs(foc.m, '[data-vc-gear-btn]'), 'T35b Esc 关齿轮后焦点回齿轮按钮')
  await foc.m.click('[data-vc-search-entry]')
  check(activeIs(foc.m, '[data-vc-palette-input]'), 'T35c 命令面板打开后焦点进搜索框')
  await foc.m.key('[data-vc-palette-input]', 'Escape')
  check(activeIs(foc.m, '[data-vc-search-entry]'), 'T35d Esc 关面板后焦点回放大镜')
  await foc.m.click('[data-vc-branch-btn]')
  check(activeIs(foc.m, '[data-vc-branch-overlay] [data-vc-branch-close]'), 'T35e 分支浮层打开后焦点进浮层第一个可操作控件（关闭键）')
  await foc.m.key('[data-vc-branch-overlay] [data-vc-branch-close]', 'Escape')
  check(activeIs(foc.m, '[data-vc-branch-btn]'), 'T35f Esc 关分支浮层后焦点回分支按钮')
  // #1860：13 条动作面板退役后，危险动作的确认卡改由文件行菜单或分支板触发；这里用分支板的
  //   「切换分支」当触发点——它在卡打开后仍然留在屏上，能验「取消后焦点回到触发它的那颗按钮」。
  await foc.m.click('[data-vc-gear-btn]')
  await foc.m.click('[data-vc-gear-item="branch-tags"]')
  const switchBtn2 = foc.m.q('[data-vc-branch-row="feat/x"] [data-vc-branch-action="switch"]')
  check(!!switchBtn2, 'T35g 分支板画出「切换分支」入口（确认卡焦点用例的触发点）')
  if (switchBtn2) switchBtn2.focus()
  if (switchBtn2) await foc.m.click(switchBtn2)
  check(!!foc.m.q('[data-vc-branch2] [data-vc-confirm]') && activeIs(foc.m, '[data-vc-branch2] [data-vc-confirm] [data-focus-default="cancel"]'), 'T35h 确认卡打开后焦点进卡里的取消键（危险动作默认停在安全那一颗）')
  await foc.m.click('[data-vc-branch2] [data-vc-confirm] [data-focus-default="cancel"]')
  check(activeIs(foc.m, '[data-vc-branch-row="feat/x"] [data-vc-branch-action="switch"]'), 'T35i 取消确认卡后焦点回触发它的那颗按钮')
  await foc.m.unmount()
}

// ---------------- 场景十：提交历史页按定稿原型 68 重排（搜索、只看合并、行菜单、详情） ----------------
// 定稿依据 docs/prototype/vc-redesign/screenshots/68-commit-menu-460.png（列表与行菜单）与 03-commit-detail-460.png（详情）。
//   这一段断言的是「点了之后界面怎么变、跳到哪里」：筛选只筛已读回来的提交、行菜单里的三条历史改写动作只跳主入口
//   并高亮（不在历史页执行 git），详情按原型画出四行元信息与文件行。
async function scenarioHistoryRedesign() {
  console.log('\n== 场景十：提交历史页的筛选、行菜单与详情 ==')
  const snap = snapshotOf()
  const dayMs = 86400000
  snap.slices.history.data = {
    commits: [
      { oid: 'aaaa1111222233334444', short: 'aaaa111', author: '某甲', email: 'a@b.c', authorDateMs: NOW - 3600000, commitDateMs: NOW - 3600000, subject: '合并分支 daily', parents: ['p1', 'p2'] },
      { oid: 'bbbb2222333344445555', short: 'bbbb222', author: '某乙', email: 'b@b.c', authorDateMs: NOW - 7200000, commitDateMs: NOW - 7200000, subject: '补一条说明', parents: ['p1'] },
      { oid: 'cccc3333444455556666', short: 'cccc333', author: '某丙', email: 'c@b.c', authorDateMs: NOW - dayMs, commitDateMs: NOW - dayMs, subject: '昨天那条', parents: [] },
    ], hasMore: false, readAtMs: NOW,
  }
  const host = makeHost({
    reply: {
      'wf.gitFirstScreen': function () { return { ok: true, firstScreen: snap, readAtMs: NOW } },
      'wf.gitDiff': function (args: any) {
        if (String((args || {}).rev || '') !== '') {
          return { ok: true, files: [{ path: 'src/a.ts', added: 3, deleted: 1 }, { path: 'docs/b.md', added: 2, deleted: 0 }], truncated: false, reason: 'ok' }
        }
        return { ok: true, lines: [], reason: 'ok' }
      },
    },
  })
  const view = buildView(host, null)
  const m = mountOf(view, { st: { cwd: CWD } })
  await React.act(async function () { m.root.render(React.createElement(view.VersionControlTab, { st: { cwd: CWD } })) })
  await settle()
  await m.click('[data-vc-tab="commits"]')
  const comesBefore = function (a: any, b: any) { return !!(a && b && (a.compareDocumentPosition(b) & 4)) }
  const query = m.q('[data-vc-history-query]')
  const mergeBtn = m.q('[data-vc-history-merge-only]')
  const list = m.q('#vc-history-list')
  check(!!query && !!mergeBtn && comesBefore(m.q('.vcs-hist-tools'), list) && comesBefore(m.q('[data-vc-history-scope]'), list),
    'T36 提交历史页先画工具行（搜索框 + 只看合并）与范围行，再画列表')
  check(!!query && String(query.getAttribute('placeholder') || '').indexOf('3') >= 0,
    'T36b 搜索框占位写明「在已加载的 3 条提交里筛选」：' + String((query || {}).placeholder || ''))
  check(m.qa('.vcs-hist-day').length === 2,
    'T36c 列表按作者时间分组，三天跨两天画出「今天」「昨天」两个日期分组（实得 ' + m.qa('.vcs-hist-day').length + ' 段）')
  check(m.qa('[data-vc-history-more]').length === 3 && m.qa('[data-vc-history-row]').length === 3,
    'T36d 三条提交各有一行，行尾都有「更多」菜单按钮（' + m.qa('[data-vc-history-more]').length + ' 个）')
  await m.click('[data-vc-history-merge-only]')
  check(m.qa('[data-vc-history-row]').length === 1 && m.text('[data-vc-history-scope]').indexOf('1') >= 0 && String((m.q('[data-vc-history-merge-only]') || {}).getAttribute('aria-pressed')) === 'true',
    'T36e 点「只看合并」后只剩那一条合并提交，按钮 aria-pressed=true，范围行跟着变')
  await m.click('[data-vc-history-merge-only]')
  check(m.qa('[data-vc-history-row]').length === 3, 'T36f 再点一次恢复三条（开关是切换，不是钉死）')
  await m.type('[data-vc-history-query]', '补一条')
  check(m.qa('[data-vc-history-row]').length === 1 && !!m.q('[data-vc-history-scope]') && m.qa('[data-vc-history-row]')[0].getAttribute('data-vc-history-row') === 'bbbb2222333344445555',
    'T36g 搜索只筛已读回来的三条提交，命中「补一条说明」那一条，不另发电话')
  const screenReads = host.calls.filter(function (one: any) { return one.phone === 'wf.gitFirstScreen' }).length
  check(screenReads === 1, 'T36h 筛选与只看合并都不重读首屏（wf.gitFirstScreen 仍只有进入页面那一次）')
  await m.type('[data-vc-history-query]', '')
  const rowMore = m.q('[data-vc-history-more="aaaa1111222233334444"]')
  check(!!rowMore && (!m.q('[data-vc-history-menu]')), 'T36i 行菜单默认收起（只画行尾按钮）')
  if (rowMore) await m.click(rowMore)
  const menu = m.q('[data-vc-history-menu="aaaa1111222233334444"]')
  check(!!menu && m.qa('[data-vc-history-menu-cap]').length === 3 && !!m.q('[data-vc-history-menu-copy]') && !!m.q('[data-vc-history-menu-close]'),
    'T36j 点行尾「⋯」贴行展开菜单：三条历史改写动作 + 复制提交 ID + 收起菜单')
  const revertTarget = view.vcPaletteTargetOf('5.4')
  const revertBtn = m.q('[data-vc-history-menu-cap="5.4"]')
  if (revertBtn) await m.click(revertBtn)
  check(m.page() === revertTarget.page && !m.q('[data-vc-history-menu]') && !!m.q('[data-vc-history-menu-close="1"]') === false,
    'T36k 点菜单里的「还原这次提交」不在这里执行 git：跳到 5.4 主入口所在的 ' + revertTarget.page + ' 页并收起菜单')
  check(!m.q('[data-cap-hit]') && !m.q('[data-vc-cap-list]'), 'T36l 跳过去后落在 5.4 的页面；能力清单已退役，页面体不再画落点高亮')
  await m.click('[data-vc-back]')
  check(m.page() === 'commits', 'T36m 从主入口返回提交历史页（来源页入口保留）')
  const openRow = m.q('[data-vc-history-open="bbbb2222333344445555"]')
  if (openRow) await m.click(openRow)
  const detail = m.q('[data-vc-history-detail="1"]')
  check(!!detail && String((detail || {}).getAttribute('data-vc-history-detail-state')) === 'ok' && m.qa('.vcs-hist-meta-row').length === 4,
    'T36n 点开一条提交后进入详情：按原型画出「提交 / 作者 / 提交时间 / 父提交」四行元信息')
  const title = m.q('#vc-history-detail-title')
  check(!!title && String(title.textContent || '').indexOf('补一条说明') >= 0 && m.qa('[data-vc-history-file]').length === 2,
    'T36o 详情标题是提交说明全文，文件清单来自 wf.gitDiff 的 rev 读数（2 个文件）')
  const fileRow = m.q('[data-vc-history-file="src/a.ts"]')
  if (fileRow) await m.click(fileRow)
  check(!!m.q('[data-vc-file-diff="src/a.ts"]') && String((m.q('[data-vc-history-file="src/a.ts"]') || {}).getAttribute('aria-expanded')) === 'true',
    'T36p 点文件行展开该文件的差异块（贴在这一行下面，不跳页）')
  await m.click('[data-vc-history-back]')
  check(!m.q('[data-vc-history-detail="1"]') && m.qa('[data-vc-history-row]').length === 3, 'T36q 「返回提交历史」回到列表，不再画详情')
  await m.unmount()
}
// ---------------- main ----------------
async function main() {
  const locUrl = (f) => pathToFileURL(path.join(ROOT, sourcePath(f))).href
  // M2 起管理分区与侧页的正文全部接上，它们各自的词条也要装进来，否则页面上的文字会退回键名。
  const fams = ['panel', 'flow', 'vcworktrees', 'vcsubmodules', 'vcwrite', 'vcshell', 'vcquery', 'vcstash', 'vcconfig', 'vchooks', 'vcdiagnostics', 'vcundo', 'vcplatform', 'vcchanges', 'vcconflicts', 'vcmaintenance', 'vcrebase', 'vcrewrite', 'vctask']
  const names = { panel: 'L_PANEL', flow: 'L_FLOW', vcworktrees: 'L_VCWORKTREES', vcsubmodules: 'L_VCSUBMODULES', vcwrite: 'L_VCWRITE', vcshell: 'L_VCSHELL', vcquery: 'L_VCQUERY', vcstash: 'L_VCSTASH', vcconfig: 'L_VCCONFIG', vchooks: 'L_VCHOOKS', vcdiagnostics: 'L_VCDIAGNOSTICS', vcundo: 'L_VCUNDO', vcplatform: 'L_VCPLATFORM', vcchanges: 'L_VCCHANGES', vcconflicts: 'L_VCCONFLICTS', vcmaintenance: 'L_VCMAINTENANCE', vcrebase: 'L_VCREBASE', vcrewrite: 'L_VCREWRITE', vctask: 'L_VCTASK' }
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
  await scenarioManage()
  await scenarioAiHandoff()
  await scenarioM4d()
  await scenarioHistoryRedesign()

  console.log('\n断言 ' + total + ' 条，失败 ' + failed + ' 条')
  printGateResult('verify-1776-vc-live-tab', total, failed ? 1 : 0)
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) {
  console.log('  FAIL 门禁自身抛出异常：' + String((e && e.stack) || e))
  printGateResult('verify-1776-vc-live-tab', total + 1, 1)
  process.exit(1)
})
