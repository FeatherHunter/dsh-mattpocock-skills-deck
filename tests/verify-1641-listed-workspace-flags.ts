#!/usr/bin/env node
/**
 * verify-1641-listed-workspace-flags.ts —— #1641「设置页名单上还没打开过的工作区，点开关也能存住」的门禁。
 *
 * 这张票解决的是：设置页总览的行来自工作区名单（#1612 的胶囊状态栏、deck 工具箱两个开关就画在这些行末尾），
 *   但那些工作区还没被打开过，客户端认不出它的工作区根 —— 按 #1612 的口径「认不出根一个字不写」，点了等于没反应。
 *   现在改成：渲染层明确说这一行在名单上（第三个参数 listed 传 true），写口按名单上的路径先记一条带
 *   unopened: true 的临时记录；等这个工作区被打开、认出根以后，由 #1640 合并到根那一条。
 *
 * 这一份门禁量六件事，每件都用完整一句话说清：
 * 第一件：设置文件认 unopened 临时标记（写得出来、读得回来、往返不变；false 与省略同义；写数字按坏形状拒并点名）。
 * 第二件：写口收到 listed=true 且认不出根时，按名单路径先记一条带 unopened 的临时记录，种的那两格照旧，读口立刻读得到。
 * 第三件：同样的场景不传 listed（别的调用方）时，仍是 #1612 的口径：返回 false、一个字都不写。
 * 第四件：换一个全新的客户端实例（相当于刷新或重启）读同一个主目录，还能从那条临时记录里读回开关值。
 * 第五件：认得出工作区根的行（真正的会话目录）行为不变：照旧记在根那把键上，记录不带 unopened。
 * 第六件：deck-state 与设置页渲染层真的把 listed 从「这一行在不在名单上」一路传到写口。
 *
 * 怎么保证量的是真件：设置文件读写用 src/host/configStore.js 的真实现；客户端三片（settings-view-state、
 *   settings-view、settings-view-write）按构建同一次序拼起来当场造函数；设置页那一片（SettingsWorkspaces.ts）
 *   也按同一份口径转译后真的渲染一遍，只有手机（假 host）与界面基础函数（h、Ic、tr 等）是替身。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-1641-listed-workspace-flags.ts
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const realFs = require('node:fs/promises')
const { compileFn } = require('./lib/eval-probe.js')
// 完成证据（#1158）：收尾交一行 GATE-RESULT，执行器据此判「跑完了没有」。
const { printGateResult } = require('./lib/gate-result.ts')
// 取源走共用入口（#1207）：按「同名 .ts 优先」解到真源，再按构建同一份口径转译成可 eval 的 JavaScript。
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
// 真的文件读写口（核要的那四个动作）：门禁里读写落在临时目录的真文件上。
const realIo = {
  readText: (p) => realFs.readFile(String(p), 'utf8'),
  writeText: (p, t) => realFs.writeFile(String(p), String(t), 'utf8'),
  mkdir: (p) => realFs.mkdir(String(p), { recursive: true }),
  rm: (p) => realFs.unlink(String(p)),
}
// 假的一台手机：把两条设置电话接到真实现上；只有「写文件被拒」这一档由替身直接回拒。
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
// 假的内存 localStorage：只有三个方法，够这一片用。
function makeLocalStorage(initial) {
  const m = Object.assign({}, initial || {})
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(m, k) ? String(m[k]) : null),
    setItem: (k, v) => { m[k] = String(v) },
    removeItem: (k) => { delete m[k] },
    dump: () => Object.assign({}, m),
  }
}
// 闭包里那把规整函数 keyOf 与它判平台用的 currentOs（真源码，读构建产物以便直接当 JavaScript 求值）。
function sharedKeyFn(name) {
  const src = readText('.build/shared/workspaceKey.js').replace(/^\s*export\s+/gm, '')
  return compileFn([], src + '\nreturn ' + name)()
}
const VIEW_STATE_REL = 'src/client/kernel/settings-view-state.js'
const VIEW_REL = 'src/client/kernel/settings-view.js'
const VIEW_WRITE_REL = 'src/client/kernel/settings-view-write.js'
// 被测那三片按构建同一次序拼起来，当场造出一个全新的实例。
function makeView(env) {
  const body = [spliceableJs(VIEW_STATE_REL), spliceableJs(VIEW_REL), spliceableJs(VIEW_WRITE_REL)].join('\n')
  const names = ['keyOf', 'wsKeyOf', 'shared', 'stores', 'emit', 'host', 'localStorage', 'log', 'dswsLogHash', 'timer', 'currentOs', 'workspaceRootByCwd']
  const factory = compileFn(names, body + '\nreturn { viewFlagOf: viewFlagOf, viewFlagOfRoot: viewFlagOfRoot, setViewFlagValue: setViewFlagValue, settingsViewLoad: settingsViewLoad, viewFlagReadyNow: viewFlagReadyNow, viewFlagDocKeyOf: viewFlagDocKeyOf, viewFlagWriteKeyOf: viewFlagWriteKeyOf }')
  return factory.apply(null, names.map((n) => env[n]))
}
// 界面替身用的元素树：h 只记下标签、属性与孩子，渲染结果靠遍历这棵树来查。
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
function findLogged(root, log) {
  const hits = []
  walkTree(root, (n) => { if (n.props && n.props['data-log'] === log && typeof n.props.onClick === 'function') hits.push(n) })
  return hits
}

async function main() {
  console.log('#1641 设置页名单上还没打开过的工作区：点开关也能存住（临时记录带 unopened、认出根以后合并归 #1640）')
  const core = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'configStore.js')).href)
  const leaf = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'settingsPhones.js')).href)
  const store = core
  const { parseConfig, stringifyConfig } = core
  const KEY_OF = sharedKeyFn('keyOf')
  const CURRENT_OS = sharedKeyFn('currentOs')

  // 一份最小的合法设置文件文本：只给工作区节那几行，其余两节写成空表，读的时候由核补默认值。
  const settingsText = (wsLines) => ['version: 1', 'ui: {}', 'workspaces:'].concat(wsLines || []).concat(['debug:', '  enabled: false', '  sampleRate: 1', 'templates: {}', '']).join('\n')
  const parseSettingsText = (text) => parseConfig(text, 'settings')
  const wsOf = (ok) => (ok && ok.ok === true ? ok.value.workspaces : null)

  // ── 第一件事：设置文件认 unopened 临时标记 ──
  console.log('')
  console.log('== 第一件事：unopened 临时标记写得出来、读得回来、往返不变（false 与省略同义，写数字按坏形状拒） ==')
  const markedText = settingsText([
    '  D:\\ws\\other:',
    '    statusBar: show',
    '    unopened: true',
    '  D:\\ws\\demo:',
    '    statusBar: hide',
  ])
  const markedOut = parseSettingsText(markedText)
  const markedWs = wsOf(markedOut)
  check(!!markedWs, '带 unopened 标记的设置文件能读。', markedOut && markedOut.message)
  check(!!markedWs && markedWs['D:\\ws\\other'] && markedWs['D:\\ws\\other'].unopened === true, 'unopened: true 读进归一后仍带这个标记（不是当未知键拒掉）。', JSON.stringify(markedWs && markedWs['D:\\ws\\other']))
  check(!!markedWs && markedWs['D:\\ws\\demo'] && markedWs['D:\\ws\\demo'].unopened === undefined, '另一条没写标记的记录归一后不带 unopened（缺省就是没有）。', JSON.stringify(markedWs && markedWs['D:\\ws\\demo']))
  const markedWrote = stringifyConfig(markedOut.value, 'settings')
  check(markedWrote.ok === true, '带标记的那一份能写回去。', markedWrote.ok ? '' : markedWrote.message)
  const wroteText = markedWrote.ok ? markedWrote.text : ''
  check(wroteText.indexOf('    unopened: true') >= 0, '写出去的一份里出现 unopened: true。', wroteText.slice(0, 400))
  check(wroteText.indexOf('# 这条记录暂时按设置页工作区名单上的路径记着') >= 0, '写出去的那一行上面有一句看得懂的注释。', wroteText.slice(0, 400))
  check(wroteText.split('unopened: true').length === 2, '只有带标记的那一条记录写 unopened: true（另一条不写）。', wroteText.slice(0, 400))
  check(wroteText.indexOf('unopened: false') < 0, 'false 不写出去（缺省不写，文件里少一行杂音）。', wroteText.slice(0, 400))
  const markedBack = parseSettingsText(wroteText)
  check(markedBack.ok === true && JSON.stringify(markedBack.value.workspaces) === JSON.stringify(markedWs), '写出去再读回来，工作区那几格的值与标记都不变。', JSON.stringify(markedBack.ok ? markedBack.value.workspaces : markedBack.message))
  const badUnopened = parseSettingsText(settingsText(['  D:\\ws\\x:', '    unopened: 1']))
  check(badUnopened.ok === false && badUnopened.reason === 'bad-shape' && String(badUnopened.message || '').indexOf('unopened') >= 0, 'unopened 写成数字 1 按坏形状拒，并点名是哪个字段。', JSON.stringify(badUnopened))
  const falseUnopened = parseSettingsText(settingsText(['  D:\\ws\\x:', '    unopened: false']))
  check(falseUnopened.ok === true && wsOf(falseUnopened)['D:\\ws\\x'].unopened === undefined, 'unopened: false 与省略同义（归一后不带标记）。', JSON.stringify(falseUnopened))

  // ── 一个场景的全套夹具：临时主目录（可续用同一个演「重启」）、假手机、假 localStorage、一条会话状态。 ──
  function makeEnv(opts) {
    const o = opts || {}
    const cwd = o.cwd || 'D:\\ws\\demo'
    const root = o.root === undefined ? 'd:\\ws' : o.root
    const home = o.home || fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-1641-'))
    if (o.seedText) { const p = settingsPathIn(home); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, o.seedText, 'utf8') }
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
    return { mod, ls, calls, logs, home, cwd, root }
  }
  const readDoc = async (home) => {
    const p = settingsPathIn(home)
    if (!fs.existsSync(p)) return null
    const r = await store.readLocalSettings(home, realIo)
    return (r && r.ok === true) ? r.value : null
  }
  const entryOf = (doc, key) => (doc && doc.workspaces && doc.workspaces[key]) ? doc.workspaces[key] : null
  const diskEntryIs = (home, key, field, val) => async () => {
    const doc = await readDoc(home)
    const entry = entryOf(doc, key)
    return !!entry && entry[field] === val
  }
  const settlement = async (mod) => { await waitFor(() => mod.viewFlagReadyNow() === true); await sleep(0) }

  // ── 第二件事：写口收到 listed=true、且认不出根时，按名单路径先存一条带标记的临时记录 ──
  console.log('')
  console.log('== 第二件事：名单行（listed=true）认不出根也先存住，记录带 unopened 标记 ==')
  const listedEnv = makeEnv({ tag: 'listed', cwd: 'D:\\ws\\other', root: '' })
  check(listedEnv.mod.viewFlagWriteKeyOf(listedEnv.cwd) === '', '夹具核对：这一档确实认不出工作区根（写键是空串，正是 #1612 会一个字不写的那种行）。')
  const listedAccepted = listedEnv.mod.setViewFlagValue(listedEnv.cwd, 'statusBar', 'show', true)
  check(listedAccepted === true, '名单行点开关被接下（返回 true，不再是点了没反应）。')
  const listedLanded = await waitFor(diskEntryIs(listedEnv.home, 'D:\\ws\\other', 'statusBar', 'show'))
  check(listedLanded, '文件里按名单上的那条路径出现记录，statusBar 落盘是 show。', JSON.stringify(await readDoc(listedEnv.home)))
  const listedDoc = await readDoc(listedEnv.home)
  const listedEntry = entryOf(listedDoc, 'D:\\ws\\other')
  check(!!listedEntry && listedEntry.unopened === true, '这条临时记录带 unopened: true（将来认出根时靠它知道该合并）。', JSON.stringify(listedEntry))
  check(!!listedEntry && listedEntry.deckTools === 'on', '新建记录时另一格 deckTools 照旧按缺省种 on（种的那两格没漏）。', JSON.stringify(listedEntry))
  check(!!listedEntry && listedEntry.subwsMarkAutoShown === false, '新建记录时第三格 subwsMarkAutoShown 照旧种 false。', JSON.stringify(listedEntry))
  check(!!listedDoc && Object.keys(listedDoc.workspaces).length === 1, '文件里只有这一条记录，没有再到别处猜一条。', JSON.stringify(listedDoc && listedDoc.workspaces))
  check(listedEnv.mod.viewFlagOf(listedEnv.cwd, 'statusBar') === 'show', '写成功之后读口立刻读得到 show（同一次会话里不用等重启）。')
  check(listedEnv.mod.viewFlagOf(listedEnv.cwd, 'deckTools') === 'on', '读口读另一格也是文件里的值 on。')

  // ── 第三件事：不传 listed 的调用方仍按 #1612 的口径：一个字都不写 ──
  console.log('')
  console.log('== 第三件事：别的调用方不传 listed，认不出根时仍是 #1612 的口径（返回 false、一个字不写） ==')
  const plainEnv = makeEnv({ tag: 'plain', cwd: 'D:\\ws\\other', root: '' })
  await settlement(plainEnv.mod)
  const plainAccepted = plainEnv.mod.setViewFlagValue(plainEnv.cwd, 'statusBar', 'show')
  check(plainAccepted === false, '不传 listed 时写口回 false（认不出根就是不写）。')
  await sleep(250)
  check(plainEnv.calls.filter((c) => c.method === 'wf.setSettings').length === 0, '不传 listed 的这一笔没有发写文件那条电话。', JSON.stringify(plainEnv.calls.map((c) => c.method)))
  check(await readDoc(plainEnv.home) === null, '磁盘上连设置文件都没被建出来。', JSON.stringify(await readDoc(plainEnv.home)))

  // ── 第四件事：重启/刷新之后还能读回那条临时记录 ──
  console.log('')
  console.log('== 第四件事：刷新或重启之后，同一条临时记录里的开关值还读得回来 ==')
  const restartEnv = makeEnv({ tag: 'restart', home: listedEnv.home, cwd: 'D:\\ws\\other', root: '' })
  restartEnv.mod.settingsViewLoad()
  await settlement(restartEnv.mod)
  check(restartEnv.mod.viewFlagOf('D:\\ws\\other', 'statusBar') === 'show', '新的客户端实例（相当于刷新/重启）读得回 statusBar: show。')
  check(restartEnv.mod.viewFlagOf('D:\\ws\\other', 'deckTools') === 'on', '另一格 deckTools 也读得回来。')
  const restartDoc = await readDoc(listedEnv.home)
  check(entryOf(restartDoc, 'D:\\ws\\other') && entryOf(restartDoc, 'D:\\ws\\other').unopened === true, '重启这一趟只读不写，记录上的 unopened 标记原样留着（清标记归 #1640）。', JSON.stringify(entryOf(restartDoc, 'D:\\ws\\other')))

  // ── 第五件事：认得出工作区根的行行为不变 ──
  console.log('')
  console.log('== 第五件事：认得出工作区根的行仍记在根那把键上，记录不带 unopened ==')
  const rootedEnv = makeEnv({ tag: 'rooted', cwd: 'D:\\ws\\demo', root: 'd:\\ws' })
  check(rootedEnv.mod.viewFlagWriteKeyOf(rootedEnv.cwd) === 'D:\\ws', '夹具核对：这一档写键是工作区根（不是会话目录）。', String(rootedEnv.mod.viewFlagWriteKeyOf(rootedEnv.cwd)))
  const rootedAccepted = rootedEnv.mod.setViewFlagValue(rootedEnv.cwd, 'statusBar', 'show', true)
  check(rootedAccepted === true, '认得出根的行照旧被接下。')
  const rootedLanded = await waitFor(diskEntryIs(rootedEnv.home, 'D:\\ws', 'statusBar', 'show'))
  check(rootedLanded, '值落在根那把键的记录上（statusBar: show）。', JSON.stringify(await readDoc(rootedEnv.home)))
  const rootedDoc = await readDoc(rootedEnv.home)
  const rootedEntry = entryOf(rootedDoc, 'D:\\ws')
  check(!!rootedEntry && rootedEntry.unopened === undefined, '认得出根的行写出来的记录不带 unopened（listed 只对认不出根的名单行生效）。', JSON.stringify(rootedEntry))
  check(!!rootedDoc && Object.keys(rootedDoc.workspaces).length === 1 && !rootedDoc.workspaces['D:\\ws\\demo'], '没有多出「会话目录」那条临时记录（同一个工作区只有根那一条）。', JSON.stringify(rootedDoc && rootedDoc.workspaces))

  // ── 第六件事之一：deck-state 把 listed 原样传给写口 ──
  console.log('')
  console.log('== 第六件事之一：deck-state 两个写口把 listed 原样传给设置文件写口 ==')
  const deckWrites = []
  globalThis.viewFlagOf = function () { return { known: false, value: false } }
  globalThis.setViewFlagValue = function (cwd, name, value, listed) {
    deckWrites.push({ cwd: String(cwd), name: String(name), value: value, listed: listed === true })
    return true
  }
  globalThis.keyOf = function (p) { return String(p == null ? '' : p).replace(/\\/g, '/').toLowerCase() }
  globalThis.emit = function () {}
  globalThis.shared = { cwd: '', subs: [], tick: 0 }
  globalThis.stores = {}
  const deckState = await import(pathToFileURL(path.join(ROOT, 'src', 'client', 'kernel', 'deck-state.ts')).href)
  check(typeof deckState.setDeckStatusBar === 'function' && typeof deckState.setDeckTools === 'function', 'deck-state 导出了这两个写口。')
  deckWrites.length = 0
  const okBar = deckState.setDeckStatusBar('D:/ws/plat', true, true)
  check(okBar === true && deckWrites.length === 1 && deckWrites[0].name === 'statusBar' && deckWrites[0].value === 'show' && deckWrites[0].listed === true, 'setDeckStatusBar(cwd, true, true) 交给写口的是 statusBar/show/listed=true。', JSON.stringify(deckWrites))
  deckWrites.length = 0
  const okTools = deckState.setDeckTools('D:/ws/plat', false)
  check(okTools === true && deckWrites.length === 1 && deckWrites[0].name === 'deckTools' && deckWrites[0].value === 'off' && deckWrites[0].listed === false, 'setDeckTools 不传 listed 时写口收到 false（口径与 #1612 一样）。', JSON.stringify(deckWrites))
  deckWrites.length = 0
  deckState.setDeckTools('D:/ws/plat', true, false)
  check(deckWrites.length === 1 && deckWrites[0].listed === false, '明确传 false 也原样传递。', JSON.stringify(deckWrites))

  // ── 第六件事之二：设置页渲染层按「这一行在不在名单上」传 listed ──
  console.log('')
  console.log('== 第六件事之二：设置页总览渲染时，名单行传 listed=true、拿当前目录凑的那一行传 false ==')
  const uiWrites = { statusbar: [], decktools: [] }
  const foldVerArgs = []
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
    setDeckStatusBar: function (cwd, next, listed) { uiWrites.statusbar.push({ cwd: cwd, next: next, listed: listed }) },
    setDeckTools: function (cwd, next, listed) { uiWrites.decktools.push({ cwd: cwd, next: next, listed: listed }) },
    flash: function () {},
    copyText: function () {},
  }
  const uiNames = Object.keys(uiStubs)
  const uiFactory = compileFn(uiNames, spliceableJs('src/client/views/SettingsWorkspaces.js') + '\nreturn { renderWsOverview: renderWsOverview, computeWsOverviewRows: computeWsOverviewRows }')
  const ui = uiFactory.apply(null, uiNames.map((n) => uiStubs[n]))
  const renderOverview = function (sharedCwd, paths) {
    return ui.renderWsOverview(hStub, { cwd: sharedCwd, subs: [], tick: 0 }, { loading: false, err: '', workspaces: (paths || []).map(function (p) { return { path: p } }), modules: [], selections: {} }, { current: null }, 0, function (v) { foldVerArgs.push(v) })
  }
  const listedTree = renderOverview('', ['D:\\ws\\other'])
  const barSwitch = findLogged(listedTree, 'settings.workspaces.statusbar')
  const toolSwitch = findLogged(listedTree, 'settings.workspaces.decktools')
  check(barSwitch.length === 1, '名单行画出了胶囊状态栏那颗开关（按 data-log 找得到，正是能点的那颗）。', String(barSwitch.length))
  check(toolSwitch.length === 1, '名单行画出了 deck 工具箱那颗开关。', String(toolSwitch.length))
  uiWrites.statusbar.length = 0; uiWrites.decktools.length = 0; foldVerArgs.length = 0
  barSwitch[0].props.onClick({ preventDefault: function () {}, stopPropagation: function () {} })
  check(uiWrites.statusbar.length === 1 && uiWrites.statusbar[0].cwd === 'D:\\ws\\other' && uiWrites.statusbar[0].listed === true, '点名单行的胶囊状态栏开关时，写口收到名单上的路径与 listed=true。', JSON.stringify(uiWrites.statusbar))
  check(foldVerArgs.length === 1 && foldVerArgs[0] === 1, '点完把 foldVer 加一让这一组重画（开关颜色立刻跟上）。', JSON.stringify(foldVerArgs))
  toolSwitch[0].props.onClick({ preventDefault: function () {}, stopPropagation: function () {} })
  check(uiWrites.decktools.length === 1 && uiWrites.decktools[0].listed === true && uiWrites.decktools[0].next === false, '点名单行的 deck 工具箱开关时同样传 listed=true（原值 on 点一下变成关）。', JSON.stringify(uiWrites.decktools))
  // 名单空的时候拿当前目录凑一行：那一条不是名单上的工作区，必须传 false，否则会替用户猜出一条临时记录。
  const fallbackTree = renderOverview('D:\\ws\\current', [])
  const fallbackSwitch = findLogged(fallbackTree, 'settings.workspaces.statusbar')
  check(fallbackSwitch.length === 1, '名单为空时，拿当前目录凑出来的那一行也画了开关。', String(fallbackSwitch.length))
  uiWrites.statusbar.length = 0
  fallbackSwitch[0].props.onClick({ preventDefault: function () {}, stopPropagation: function () {} })
  check(uiWrites.statusbar.length === 1 && uiWrites.statusbar[0].cwd === 'D:\\ws\\current' && uiWrites.statusbar[0].listed === false, '拿当前目录凑的那一行传 listed=false（不是名单行，不替用户猜临时记录）。', JSON.stringify(uiWrites.statusbar))

  console.log('')
  console.log('通过 ' + passed + ' 条，失败 ' + failed + ' 条。')
  printGateResult('verify-1641-listed-workspace-flags', passed + failed, failed)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
