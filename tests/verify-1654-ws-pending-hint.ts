#!/usr/bin/env node
/**
 * verify-1654-ws-pending-hint.ts —— #1654「没点开过的工作区行显示「已存住，打开该工作区后生效」」的门禁。
 *
 * 这张票解决的是：#1638 把「还没点开过的工作区行那两个开关」定成什么都不显示，点完没反应用户只能干瞪眼。
 *   现在改成显示一句小字：名单上、还没点开过（内核认不出根）的行，胶囊状态栏与 deck 工具箱两个开关下面多一行
 *   「已存住，打开该工作区后生效」；点开过（认得出根）的行不显示；第一次打开并合并成功后这句话自动消失。
 *
 * 这一份门禁量六件事，每件都用完整一句话说清：
 * 第一件：中文与英文的提示文案落在 flow.yaml 与生成的 locale-data.ts 里，一字不差。
 * 第二件：deck-state 新读口 isWorkspaceUnopened 认得「认不出根就是没点开过」，空路径与缺实现时回 false 不炸。
 * 第三件：名单上、没点开过的行真的画出那句小字。
 * 第四件：点开过的行不画那句小字。
 * 第五件：名单外的兜底行（拿当前目录凑的那一行）即使认不出根也不画，不替用户猜。
 * 第六件：真内核走一遍「没点开时存临时记录、第一次打开认出根并合并」——合并后根认出来了、临时记录没了，
 *   对应到渲染层就是小字消失的那一下（渲染显隐只认「在名单上、认不出根」，与第三四件同一条件）。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-1654-ws-pending-hint.ts
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const realFs = require('node:fs/promises')
const { compileFn } = require('./lib/eval-probe.js')
const { printGateResult } = require('./lib/gate-result.ts')
const { spliceableJs } = require('./lib/source-text.ts')
const centralTime = require('../src/shared/time-config/values.js')
globalThis.VIEW_FLAG_WRITE_DEBOUNCE_MS = centralTime.VIEW_FLAG_WRITE_DEBOUNCE_MS

const ROOT = path.resolve(__dirname, '..')
let passed = 0
let failed = 0
const check = (ok, msg, detail) => {
  if (ok) { console.log('  PASS ' + msg); passed += 1 } else { console.log('  FAIL ' + msg + (detail ? ' —— ' + String(detail).slice(0, 300) : '')); failed += 1 }
}
const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const settingsPathIn = (home) => path.join(home, '.dsh', 'mattskillsdeck', 'settings.yaml')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, capMs) {
  const t0 = Date.now()
  const cap = capMs || 8000
  for (;;) {
    let hit = false
    try { hit = !!(await fn()) } catch (e) { hit = false }
    if (hit) return true
    if (Date.now() - t0 > cap) return false
    await sleep(50)
  }
}
const realIo = {
  readText: (p) => realFs.readFile(String(p), 'utf8'),
  writeText: (p, t) => realFs.writeFile(String(p), String(t), 'utf8'),
  mkdir: (p) => realFs.mkdir(String(p), { recursive: true }),
  rm: (p) => realFs.unlink(String(p)),
}
function makeHost(phones, calls, failMode) {
  return {
    call: function (method, args) {
      calls.push({ method: method, args: args })
      if (method === 'wf.getSettings') return phones.handleGetSettings(args || {})
      if (method === 'wf.setSettings') {
        if (failMode === 'refuse') return Promise.resolve({ ok: false, error: { kind: 'readonly', message: '这份本机设置文件是新版本插件写的，当前插件不许写回去。' } })
        return phones.handleSetSettings(args || {})
      }
      return Promise.resolve({ ok: false, error: { kind: 'environment', message: '这条电话不在' } })
    },
  }
}
function makeLocalStorage(initial) {
  const m = Object.assign({}, initial || {})
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(m, k) ? String(m[k]) : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    dump: () => Object.assign({}, m),
  }
}
function sharedKeyFn(name) {
  const src = readText('.build/shared/workspaceKey.js').replace(/^\s*export\s+/gm, '')
  return compileFn([], src + '\nreturn ' + name)()
}
const VIEW_STATE_REL = 'src/client/kernel/settings-view-state.js'
const VIEW_REL = 'src/client/kernel/settings-view.js'
const VIEW_WRITE_REL = 'src/client/kernel/settings-view-write.js'
function makeView(env) {
  const body = [spliceableJs(VIEW_STATE_REL), spliceableJs(VIEW_REL), spliceableJs(VIEW_WRITE_REL)].join('\n')
  const names = ['keyOf', 'wsKeyOf', 'shared', 'stores', 'emit', 'host', 'localStorage', 'log', 'dswsLogHash', 'timer', 'currentOs', 'workspaceRootByCwd']
  const factory = compileFn(names, body + '\nreturn { viewFlagOf: viewFlagOf, viewFlagOfRoot: viewFlagOfRoot, setViewFlagValue: setViewFlagValue, settingsViewLoad: settingsViewLoad, viewFlagReadyNow: viewFlagReadyNow, viewFlagDocKeyOf: viewFlagDocKeyOf, viewFlagWriteKeyOf: viewFlagWriteKeyOf, viewFlagMergeNow: viewFlagMergeNow }')
  return factory.apply(null, names.map((n) => env[n]))
}
function hStub(tag, props, children) {
  const kids = children === undefined ? [] : (Array.isArray(children) ? children : [children])
  return { tag: tag, props: props || {}, children: kids }
}
function walkTree(node, fn) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((n) => walkTree(n, fn)); return }
  fn(node)
  ;(node.children || []).forEach((n) => walkTree(n, fn))
}
function treeText(root) {
  const parts = []
  walkTree(root, (n) => {
    ;(n.children || []).forEach((c) => { if (typeof c === 'string') parts.push(c) })
  })
  return parts.join('\n')
}

async function main() {
  console.log('#1654 没点开过的工作区行显示「已存住，打开该工作区后生效」')
  const core = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'configStore.js')).href)
  const leaf = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'settingsPhones.js')).href)
  const store = core
  const KEY_OF = sharedKeyFn('keyOf')
  const CURRENT_OS = sharedKeyFn('currentOs')

  // ── 第一件事：中文与英文的提示文案落在 flow.yaml 与生成的 locale-data.ts 里 ──
  console.log('')
  console.log('== 第一件事：提示文案在 flow.yaml 中英文里各有一句，生成出来的 locale-data.ts 一字不差 ==')
  const flowSrc = readText('config/copy/flow.yaml')
  const localeSrc = readText('src/client/kernel/locale-data.ts')
  const zhText = '已存住，打开该工作区后生效'
  const enText = 'Saved \u2014 takes effect after opening this workspace.'
  check(flowSrc.indexOf('wsPendingHint') >= 0 && flowSrc.indexOf(zhText) >= 0, 'flow.yaml 中文区有 wsPendingHint，文案是「' + zhText + '」。')
  check(flowSrc.indexOf(enText) >= 0, 'flow.yaml 英文区有同一句的英文版。', flowSrc.slice(flowSrc.indexOf('wsPendingHint'), flowSrc.indexOf('wsPendingHint') + 200))
  check(localeSrc.indexOf('wsPendingHint') >= 0 && localeSrc.indexOf(zhText) >= 0, '生成的 locale-data.ts 中文里有同一句（一字不差，说明生成器跑过）。')
  check(localeSrc.indexOf(enText) >= 0, '生成的 locale-data.ts 英文里有同一句。')

  // ── 第二件事：deck-state 新读口 isWorkspaceUnopened ──
  console.log('')
  console.log('== 第二件事：isWorkspaceUnopened 认得「认不出根（写键是空串）就是没点开过」 ==')
  globalThis.viewFlagDocKeyOf = function (cwd) { return String(cwd) === 'D:\\ws\\other' ? '' : 'D:\\ws' }
  globalThis.viewFlagOf = function () { return { known: false, value: false } }
  globalThis.setViewFlagValue = function () { return false }
  globalThis.keyOf = function (p) { return String(p == null ? '' : p).replace(/\\/g, '/').toLowerCase() }
  globalThis.emit = function () {}
  globalThis.shared = { cwd: '', subs: [], tick: 0 }
  globalThis.stores = {}
  const deckState = await import(pathToFileURL(path.join(ROOT, 'src', 'client', 'kernel', 'deck-state.ts')).href + '?t=1654')
  check(typeof deckState.isWorkspaceUnopened === 'function', 'deck-state 导出了 isWorkspaceUnopened。')
  check(deckState.isWorkspaceUnopened('D:\\ws\\other') === true, '认不出根的那条路径回 true（就是还没点开过的行）。')
  check(deckState.isWorkspaceUnopened('D:\\ws\\demo') === false, '认得出根的那条路径回 false（点开过的行不显示）。')
  check(deckState.isWorkspaceUnopened('') === false, '空路径回 false（不炸）。')
  delete globalThis.viewFlagDocKeyOf
  check(deckState.isWorkspaceUnopened('D:\\ws\\other') === false, '内核实现缺席时回 false（构建口径漂了也不把整页炸掉）。')
  const deckSrc = readText('src/client/kernel/deck-state.ts')
  check(deckSrc.indexOf('viewFlagDocKeyOf') >= 0 && deckSrc.indexOf('isWorkspaceUnopened') >= 0, 'deck-state 源码里真连着 viewFlagDocKeyOf（不是渲染层自己猜）。')

  // ── 渲染层按三种行画小字：画得出，也收得住 ──
  const renderWith = function (unopenedOf) {
    const uiStubs = {
      h: hStub,
      Ic: function (props) { return hStub('i', props) },
      tr: function (key) { return String(key) },
      Tip: function (props, children) { return hStub('tip', props, children) },
      HoverTip: function (props, children) { return hStub('hovertip', props, children) },
      labelOf: function (id) { return String(id) },
      backendColorOf: function () { return '#58a6ff' },
      keyOf: KEY_OF,
      workspaceRootByCwd: {},
      getCachedSnapshot: function () { return null },
      deckStatusBarOf: function () { return 'hide' },
      deckToolsOf: function () { return 'on' },
      isWorkspaceUnopened: unopenedOf,
      setDeckStatusBar: function () {},
      setDeckTools: function () {},
      flash: function () {},
      copyText: function () {},
    }
    const uiNames = Object.keys(uiStubs)
    const uiFactory = compileFn(uiNames, spliceableJs('src/client/views/SettingsWorkspaces.js') + '\nreturn { renderWsOverview: renderWsOverview }')
    const ui = uiFactory.apply(null, uiNames.map((n) => uiStubs[n]))
    return ui.renderWsOverview(hStub, { cwd: '', subs: [], tick: 0 }, { loading: false, err: '', workspaces: [{ path: 'D:\\ws\\other' }], modules: [], selections: {} }, { current: null }, 0, function () {})
  }
  const renderFallback = function (unopenedOf) {
    const uiStubs = {
      h: hStub,
      Ic: function (props) { return hStub('i', props) },
      tr: function (key) { return String(key) },
      Tip: function (props, children) { return hStub('tip', props, children) },
      HoverTip: function (props, children) { return hStub('hovertip', props, children) },
      labelOf: function (id) { return String(id) },
      backendColorOf: function () { return '#58a6ff' },
      keyOf: KEY_OF,
      workspaceRootByCwd: {},
      getCachedSnapshot: function () { return null },
      deckStatusBarOf: function () { return 'hide' },
      deckToolsOf: function () { return 'on' },
      isWorkspaceUnopened: unopenedOf,
      setDeckStatusBar: function () {},
      setDeckTools: function () {},
      flash: function () {},
      copyText: function () {},
    }
    const uiNames = Object.keys(uiStubs)
    const uiFactory = compileFn(uiNames, spliceableJs('src/client/views/SettingsWorkspaces.js') + '\nreturn { renderWsOverview: renderWsOverview }')
    const ui = uiFactory.apply(null, uiNames.map((n) => uiStubs[n]))
    return ui.renderWsOverview(hStub, { cwd: 'D:\\ws\\current', subs: [], tick: 0 }, { loading: false, err: '', workspaces: [], modules: [], selections: {} }, { current: null }, 0, function () {})
  }

  console.log('')
  console.log('== 第三件事：名单上、没点开过的行画出那句小字 ==')
  const unopenedTree = renderWith(function () { return true })
  check(treeText(unopenedTree).indexOf('cfg.wsPendingHint') >= 0, '名单行且没点开过时，树里出现 cfg.wsPendingHint 那句小字。', treeText(unopenedTree).slice(0, 300))

  console.log('')
  console.log('== 第四件事：点开过的行不画那句小字 ==')
  const openedTree = renderWith(function () { return false })
  check(treeText(openedTree).indexOf('cfg.wsPendingHint') < 0, '同一行认出根以后，树里不再出现那句小字。')

  console.log('')
  console.log('== 第五件事：名单外的兜底行即使认不出根也不画 ==')
  const fallbackTree = renderFallback(function () { return true })
  check(treeText(fallbackTree).indexOf('cfg.wsPendingHint') < 0, '拿当前目录凑的那一行不是名单行，不画小字（不替用户猜）。')
  const wsSrc = readText('src/client/views/SettingsWorkspaces.ts')
  check(wsSrc.indexOf('isWorkspaceUnopened') >= 0 && wsSrc.indexOf('cfg.wsPendingHint') >= 0, '渲染层源码里真连着 isWorkspaceUnopened 与 cfg.wsPendingHint。')

  // ── 第六件事：真内核走一遍「存临时、认出根、合并」，对应小字消失的那一下 ──
  console.log('')
  console.log('== 第六件事：第一次打开认出根并合并成功后，临时记录没了、根认出来了（小字消失的那一下） ==')
  function makeEnv(opts) {
    const o = opts || {}
    const cwd = o.cwd || 'D:\\ws\\other'
    const root = o.root === undefined ? '' : o.root
    const home = o.home || fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-1654-'))
    const ls = makeLocalStorage(o.localStorage)
    const phones = leaf.createSettingsPhones({
      getPlatform: async () => ({ getHome: async () => home }),
      readLocalSettings: store.readLocalSettings,
      writeLocalSettings: store.writeLocalSettings,
      fs: realFs,
      logCtx: null,
    })
    const calls = []
    const host = makeHost(phones, calls, o.failMode)
    const st = { cwd: cwd, sessionWorkspaceRoot: root, subs: [], tick: 0 }
    const rootTable = {}
    const rk = KEY_OF(root)
    if (rk) rootTable[rk] = root
    const logs = []
    const mod = makeView({
      keyOf: KEY_OF,
      wsKeyOf: function (c) { const k = KEY_OF(c); if (!k) return ''; return rootTable[k] || k },
      workspaceRootByCwd: rootTable,
      shared: { cwd: '', subs: [], tick: 0 },
      stores: { 'sess-1': st },
      emit: function (s) { s.tick += 1 },
      host: host,
      localStorage: ls,
      log: function (level, event, fields) { logs.push({ level: level, event: event, fields: fields }) },
      dswsLogHash: function (s) { return 'h' + String(s || '').length },
      timer: undefined,
      currentOs: CURRENT_OS,
    })
    return { mod, ls, calls, logs, home, cwd, root, st, rootTable }
  }
  const readDoc = async (home) => {
    const p = settingsPathIn(home)
    if (!fs.existsSync(p)) return null
    const r = await store.readLocalSettings(home, realIo)
    return (r && r.ok === true) ? r.value : null
  }
  const entryOf = (doc, key) => (doc && doc.workspaces && doc.workspaces[key]) ? doc.workspaces[key] : null
  const settlement = async (mod) => { await waitFor(() => mod.viewFlagReadyNow() === true); await sleep(0) }
  const diskHas = (home, pred) => async () => { const doc = await readDoc(home); try { return !!pred(doc) } catch (e) { return false } }
  const env = makeEnv({ cwd: 'D:\\ws\\other', root: '' })
  await settlement(env.mod)
  check(env.mod.viewFlagDocKeyOf('D:\\ws\\other') === '', '夹具核对：还没打开过时确实认不出根（写键是空串，小字该出现的那一档）。')
  check(env.mod.setViewFlagValue('D:\\ws\\other', 'statusBar', 'show', true) === true, '名单行点开关被接下（先存住，#1641 那条路）。')
  const tempLanded = await waitFor(diskHas(env.home, (doc) => !!entryOf(doc, 'D:\\ws\\other') && entryOf(doc, 'D:\\ws\\other').unopened === true))
  check(tempLanded, '文件里按名单路径落了一条带 unopened 的临时记录。', JSON.stringify(await readDoc(env.home)))
  env.st.sessionWorkspaceRoot = 'd:\\ws'
  const merged = env.mod.viewFlagMergeNow('root')
  check(merged === 1, '第一次打开认出根那一下调合并，返回合并了 1 条。', String(merged))
  const gone = await waitFor(diskHas(env.home, (doc) => !!entryOf(doc, 'D:\\ws') && !entryOf(doc, 'D:\\ws\\other')))
  check(gone, '合并后落盘：根那一条在、临时那一条没了（小字消失对应的数据变化）。', JSON.stringify((await readDoc(env.home)) && (await readDoc(env.home)).workspaces))
  check(env.mod.viewFlagDocKeyOf('D:\\ws\\other') !== '', '认出根以后写键不再是空串（渲染层的 isWorkspaceUnopened 从此回 false，小字自动消失）。', String(env.mod.viewFlagDocKeyOf('D:\\ws\\other')))

  console.log('')
  console.log('通过 ' + passed + ' 条，失败 ' + failed + ' 条。')
  printGateResult('verify-1654-ws-pending-hint', passed + failed, failed)
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
