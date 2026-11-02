#!/usr/bin/env node
/**
 * tests/verify-1802-settings-cross-window.ts —— 两窗共用一份设置文件时的门禁（#1802）。
 *
 * 这份门禁量四件事，每件都是 #1802 修复里不能退的一步：
 *
 * 一、宿主两条设置电话的新回包形状。设置文档是一份共享文件，旧窗口整份写回会把后写窗口刚写进去
 *     的格顶掉；要治它，写作那条路必须从「整份写」改成「按格补丁写」，于是宿主先得能回答「盘上
 *     现在是哪一版」（contentHash）——没有这个指纹，补丁写就无从校验基底。所以这里用真实的
 *     settingsPhones 与真实的 configStore、在临时目录里写真实文件，量：读成功回包带指纹、缺文件时
 *     仍按原样回 absent 并带空文档指纹、旧整份 value 入参继续兼容、patch 只改点名的格、null 删
 *     临时记录、过期 baseHash 回 conflict 且文件一个字节都不动、两个电话实例共用同一个 home 时
 *     补丁写不互相覆盖。
 *
 * 二、客户端写作路径的入参形状。光宿主会合并不够，客户端还必须只发改动格和基底指纹；这里把
 *     kernel 四片（外加新片 settings-view-reload）按现有门禁同一次序拼成闭包，用真实 phones 当
 *     宿主（检查用替身：它把每次电话的入参与回包记在 calls 里），量：发出去的是 {patch, baseHash}
 *     而不是整份 value、patch 只点本窗改的格、别的窗口新写的格不出现。
 *
 * 三、两窗交叉与重读。A 写 statusBar、B 用旧文档写 deckTools，最终两格都要在；B 没重读之前读不到
 *     A 的新值，调用 settingsViewReload() 之后能读到。冲突路径还要验证 B 不静默丢值：宿主回
 *     conflict 之后 B 重新读一份新指纹再写，最终盘上两格都在。
 *
 * 四、接线与产物。设置页真源里要在 React.useEffect 里调 settingsViewReload()（打开页面时重读）；
 *     构建之后 client.js 与 package/lib/client.js 里要真有这个新函数，证明它确实进了产物。
 *
 * 夹具哪些是真件、哪些是替身：
 * - 真件：settingsPhones 与 configStore（设置文件的读、写、归一、文件锁都在真跑），以及真临时 home
 *   下的真实 settings.yaml；客户端闭包来自 src/client/kernel 的真源（经仓内统一转译口径转译后拼起）。
 * - 替身：宿主电话外面包了一层 makeHost，只负责记录每次调用的入参与回包，并在需要时把另一条
 *   「外部写入」插到客户端这笔写之前；localStorage 是内存实现；存储里的会话表与名单（stores/shared）
 *   是手搭的最小对象；日志只收集、不参与断言。
 *
 * 实现没落地时这份门禁允许红（TDD 的红），但断言写全：源码就位后应当全绿。
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { spawnSync } = require('node:child_process')
const realFs = require('node:fs/promises')
const { compileFn } = require('./lib/eval-probe.js')
const { printGateResult } = require('./lib/gate-result.ts')
const { installTimeCompression, uninstallTimeCompression } = require('./lib/time-compress.js')

// 先把真实时钟的两个入口留一份：安装时间压缩之后全局的 setTimeout / Date.now 都换成虚拟时钟，
// 轮询真实文件是否落盘时要按真实时间计时，不能用虚拟时间判超时。
const nativeSetTimeout = setTimeout
const nativeNow = Date.now
installTimeCompression()

const ROOT = path.resolve(__dirname, '..')
let passed = 0
let failed = 0

function check(ok, msg, detail) {
  if (ok) {
    passed += 1
    console.log('  PASS ' + msg)
    return
  }
  failed += 1
  console.log('  FAIL ' + msg + ' —— ' + String(detail === undefined ? '' : detail).slice(0, 400))
}

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms) })
}

function realSleep(ms) {
  return new Promise(function (resolve) { nativeSetTimeout(resolve, ms) })
}

function makeHome(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-1802-' + tag + '-'))
}

function settingsPathIn(home) {
  return path.join(home, '.dsh', 'mattskillsdeck', 'settings.yaml')
}

// 真实的文件读写：configStore 的 readLocalSettings / writeLocalSettings 走这一份 io。
const realIo = {
  readText: function (p) { return realFs.readFile(String(p), 'utf8') },
  writeText: function (p, t) { return realFs.writeFile(String(p), String(t), 'utf8') },
  mkdir: function (p) { return realFs.mkdir(String(p), { recursive: true }) },
  rm: function (p) { return realFs.unlink(String(p)) },
}

// settingsPhones 的 fs 依赖：读、写、建目录、删文件都真做，同时把调用记下来（文件锁用得到
//   writeFile(flag:'wx')，必须原样透传，不然锁在门禁里就变成假的）。
function wrapSysFs(calls) {
  return {
    readFile: function (p, enc) {
      calls.push({ name: 'readFile', path: String(p) })
      return realFs.readFile(String(p), enc || 'utf8')
    },
    writeFile: function (p, t, o) {
      calls.push({ name: 'writeFile', path: String(p) })
      return realFs.writeFile(String(p), String(t), o || 'utf8')
    },
    mkdir: function (p) {
      calls.push({ name: 'mkdir', path: String(p) })
      return realFs.mkdir(String(p), { recursive: true })
    },
    unlink: function (p) {
      calls.push({ name: 'unlink', path: String(p) })
      return realFs.unlink(String(p))
    },
  }
}

// 宿主电话的替身：真正干活的是 settingsPhones；这一层只记录（方法、入参）与回包，并在交给宿主之前
//   给用例一个插「另一条外部写入」的机会。回包挂在 calls 条目的 .res 上，写不出事件顺序也能回看。
function makeHost(phones, calls, hooks) {
  return {
    call: function (method, args) {
      const entry = { method: method, args: args }
      calls.push(entry)
      if (hooks && typeof hooks.before === 'function') {
        try { hooks.before(method, args, calls) } catch (e) {}
      }
      let out
      if (method === 'wf.getSettings') out = phones.handleGetSettings(args || {})
      else if (method === 'wf.setSettings') out = phones.handleSetSettings(args || {})
      else out = Promise.resolve({ ok: false, error: { kind: 'environment', message: '这条电话不在本门禁的替身里。' } })
      Promise.resolve(out).then(function (res) { entry.res = res }, function (err) { entry.err = err })
      return out
    },
  }
}

function makeLocalStorage(initial) {
  const data = Object.assign({}, initial || {})
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null },
    setItem: function (k, v) { data[k] = String(v) },
    removeItem: function (k) { delete data[k] },
    dump: function () { return Object.assign({}, data) },
  }
}

// 一份设置文档的最小合法形状（与 src/shared/config-store/src/settings.ts 的归一结果对齐）。
function workspaceRecord(statusBar, deckTools) {
  return { statusBar: statusBar, deckTools: deckTools, bannerFolded: false, noRepoDismissed: false, subwsMarkAutoShown: false }
}

function docWithWorkspaces(workspaces, ui) {
  return {
    version: 1,
    ui: Object.assign({ stateFilter: '', sortKey: '', sortDir: '', labelClicks: {} }, ui || {}),
    workspaces: workspaces,
    debug: { enabled: false, sampleRate: 1 },
    templates: {},
  }
}

const { sourcePath, spliceableJs } = require('./lib/source-text.ts')
const centralTime = require('../src/shared/time-config/values.js')
globalThis.VIEW_FLAG_WRITE_DEBOUNCE_MS = centralTime.VIEW_FLAG_WRITE_DEBOUNCE_MS

const VIEW_STATE_REL = 'src/client/kernel/settings-view-state.js'
const VIEW_REL = 'src/client/kernel/settings-view.js'
const VIEW_WRITE_REL = 'src/client/kernel/settings-view-write.js'
const RELOAD_REL = 'src/client/kernel/settings-view-reload.js'
const UI_REL = 'src/client/kernel/settings-ui.js'
const RELOAD_TS = 'src/client/kernel/settings-view-reload.ts'

function noExport(s) {
  return s.replace(/^\s*export\s+/gm, '')
}

function listPrefsSlice() {
  const src = spliceableJs('src/client/kernel/store-prefs.js')
  const start = src.indexOf('const LIST_PREFS_KEY = ')
  const end = src.indexOf('const LABEL_CLICKS_KEY = ')
  if (start < 0 || end <= start) throw new Error('store-prefs 片段定位失败：LIST_PREFS_KEY 或 LABEL_CLICKS_KEY 没找到')
  return noExport(src.slice(start, end))
}

function reloadSlicePresent() {
  return fs.existsSync(path.join(ROOT, RELOAD_TS))
}

// 与 tests/verify-settings-view.ts 同一次序把 kernel 几片拼成闭包；新片存在时才拼进去，
//   这样实现还没落地时门禁仍然跑得动（只是相关断言红），不会整份炸掉。
function makeView(env) {
  const pieces = [
    listPrefsSlice(),
    spliceableJs(VIEW_STATE_REL),
    spliceableJs(VIEW_REL),
    spliceableJs(VIEW_WRITE_REL),
  ]
  if (reloadSlicePresent()) pieces.push(spliceableJs(RELOAD_REL))
  pieces.push(spliceableJs(UI_REL))
  const body = pieces.join('\n')
  const names = ['keyOf', 'wsKeyOf', 'shared', 'stores', 'emit', 'host', 'localStorage', 'log', 'dswsLogHash', 'timer', 'currentOs', 'workspaceRootByCwd']
  const tail = '\nreturn { viewFlagOf: viewFlagOf, viewFlagOfRoot: viewFlagOfRoot, setViewFlag: setViewFlag, setViewFlagRoot: setViewFlagRoot, setViewFlagValue: setViewFlagValue, viewFlagDocKeyOf: viewFlagDocKeyOf, viewFlagWriteKeyOf: viewFlagWriteKeyOf, settingsViewLoad: settingsViewLoad, settingsViewReload: (typeof settingsViewReload === "function" ? settingsViewReload : null), viewFlagDiffDocOf: (typeof viewFlagDiffDocOf === "function" ? viewFlagDiffDocOf : null), viewFlagApplyJournalToDoc: (typeof viewFlagApplyJournalToDoc === "function" ? viewFlagApplyJournalToDoc : null), viewFlagReadyNow: viewFlagReadyNow, viewFlagSubscribe: viewFlagSubscribe, setUiPref: setUiPref, saveUiPrefs: saveUiPrefs, listPrefs: listPrefs, saveListPrefs: saveListPrefs, saveListPrefsLegacy: saveListPrefsLegacy, LIST_PREFS_KEY: LIST_PREFS_KEY, VIEW_FLAG_WRITE_DEBOUNCE_MS: VIEW_FLAG_WRITE_DEBOUNCE_MS, viewFlagEmptyDoc: (typeof viewFlagEmptyDoc === "function" ? viewFlagEmptyDoc : null) }'
  const factory = compileFn(names, body + tail)
  return factory.apply(null, names.map(function (n) { return env[n] }))
}

// 下面这些模块在 main 里构建完产物之后再加载（.build/shared/workspaceKey.js 是构建产物）。
let leaf = null
let store = null
let settingsCore = null
let KEY_OF = null
let CURRENT_OS = null

function makePhones(home, fnCalls) {
  const fsCalls = fnCalls || []
  return leaf.createSettingsPhones({
    getPlatform: async function () { return { getHome: async function () { return home } } },
    readLocalSettings: store.readLocalSettings,
    writeLocalSettings: store.writeLocalSettings,
    fs: wrapSysFs(fsCalls),
    logCtx: null,
  })
}

function sharedKeyFn(name) {
  const src = readText('.build/shared/workspaceKey.js').replace(/^\s*export\s+/gm, '')
  return compileFn([], src + '\nreturn ' + name)()
}

// 一个「客户端窗口」：自己一份内存文档/待写队列/localStorage，可以共用同一个 phones（同一个宿主进程）
//   或同一个 home（两个宿主进程共用一份设置文件）。
function makeEnv(o) {
  const opts = o || {}
  const cwd = opts.cwd === undefined ? 'D:\\ilife\\packages\\skill-calorie' : opts.cwd
  const root = opts.root === undefined ? 'd:\\ilife' : opts.root
  const home = opts.home || makeHome(opts.tag || 'case')
  const ls = makeLocalStorage(opts.localStorage)
  const fnCalls = opts.fnCalls || []
  const phones = opts.phones || makePhones(home, fnCalls)
  const calls = []
  const host = opts.noHost ? undefined : makeHost(phones, calls, { before: opts.onCall })
  const st = { cwd: cwd, sessionWorkspaceRoot: root, subs: [], tick: 0 }
  const seedText = ls.getItem('dsws.listPrefs')
  let seedPrefs = { stateFilter: 'all', sortKey: 'number', sortDir: 'asc' }
  if (seedText) {
    try {
      const parsed = JSON.parse(seedText)
      if (parsed && typeof parsed === 'object') seedPrefs = parsed
    } catch (e) {}
  }
  const shared = {
    cwd: '',
    subs: [],
    tick: 0,
    stateFilter: seedPrefs.stateFilter || 'all',
    sortKey: seedPrefs.sortKey || 'number',
    sortDir: seedPrefs.sortDir || 'asc',
  }
  const stores = { 'sess-1': st }
  const logs = []
  const rootTable = {}
  if (opts.rootByKey) {
    Object.keys(opts.rootByKey).forEach(function (k) {
      rootTable[k] = opts.rootByKey[k]
      rootTable[opts.rootByKey[k]] = opts.rootByKey[k]
    })
  }
  const mod = makeView({
    keyOf: KEY_OF,
    wsKeyOf: function (c) {
      const k = KEY_OF(c)
      if (!k) return ''
      return rootTable[k] || k
    },
    workspaceRootByCwd: rootTable,
    shared: shared,
    stores: stores,
    emit: function (s) { s.tick += 1 },
    host: host,
    localStorage: ls,
    log: function (level, event, fields) { logs.push({ level: level, event: event, fields: fields }) },
    dswsLogHash: function (s) { return 'h' + String(s || '').length },
    timer: undefined,
    currentOs: CURRENT_OS,
  })
  return { mod: mod, ls: ls, calls: calls, logs: logs, home: home, cwd: cwd, root: root, st: st, shared: shared, stores: stores, fnCalls: fnCalls, phones: phones, host: host }
}

async function readDoc(home) {
  const file = settingsPathIn(home)
  if (!fs.existsSync(file)) return null
  const r = await store.readLocalSettings(home, realIo)
  return r && r.ok === true ? r.value : null
}

// 真实轮询：文件读写是真盘上的活，按原生时钟计上界，不拿虚拟时钟赌时间。
async function waitFor(fn, capMs) {
  const cap = capMs === undefined ? 12000 : capMs
  const started = nativeNow()
  for (;;) {
    let hit = false
    try { hit = !!(await fn()) } catch (e) { hit = false }
    if (hit) return true
    if (nativeNow() - started > cap) return false
    await realSleep(20)
  }
}

async function settle(mod) {
  await waitFor(function () { return mod.viewFlagReadyNow() === true })
  await sleep(0)
}

// 一组用例的中途异常不该让整份门禁变成 FATAL：记一条失败，继续往下量别的组。
async function section(title, fn) {
  try {
    await fn()
  } catch (e) {
    check(false, title + '：这一组用例本身不应该中途抛错。', (e && e.stack) || e)
  }
}

async function main() {
  console.log('两个窗口共用一份设置文件的门禁（#1802：按格补丁写、内容指纹、冲突重试、重读与接线）')
  console.log('')

  console.log('[构建] node scripts/build.mts')
  const built = spawnSync(process.execPath, [path.join('scripts', 'build.mts')], { cwd: ROOT, stdio: 'inherit' })
  check(built.status === 0, '先跑 node scripts/build.mts 构建通过，后面的产物断言才有意义。', built.status)
  if (built.status !== 0) {
    check(false, '构建没有通过，产物里不可能有新函数，后面的产物断言跳过。', built.status)
  }

  leaf = await import(pathToFileURL(path.join(ROOT, 'src/host/settingsPhones.js')).href)
  store = await import(pathToFileURL(path.join(ROOT, 'src/host/configStore.js')).href)
  settingsCore = await import(pathToFileURL(path.join(ROOT, 'src/shared/config-store/src/settings.js')).href)
  check(typeof leaf.createSettingsPhones === 'function', '真实 settingsPhones 模块加载成功，宿主电话用的是真件。', typeof leaf.createSettingsPhones)
  check(typeof store.readLocalSettings === 'function' && typeof store.writeLocalSettings === 'function', '真实 configStore 模块加载成功，设置文件读写用的是真件。', typeof store.readLocalSettings)
  check(typeof settingsCore.settingsContentHash === 'function' && typeof settingsCore.settingsEmptyDocument === 'function', '设置核心里有内容指纹与空文档这两个新工具，宿主回包断言可以直接算期望值。', typeof settingsCore.settingsContentHash)

  KEY_OF = sharedKeyFn('keyOf')
  CURRENT_OS = sharedKeyFn('currentOs')
  check(typeof KEY_OF === 'function' && typeof CURRENT_OS === 'function', '工作区键函数与当前系统名从构建产物里取到了，客户端闭包能按仓内同一口径算文档键。', typeof KEY_OF)

  // ---------------------------------------------------------------------------------------------
  // 一、宿主：真实 settingsPhones + 真实 configStore + 临时 home 里的真实文件
  // ---------------------------------------------------------------------------------------------

  await section('宿主：缺文件时的读', async function () {
    const home = makeHome('host-absent')
    const phones = makePhones(home, [])
    const got = await phones.handleGetSettings({})
    check(!!got && got.ok === false && got.error && got.error.kind === 'absent',
      '文件还没建时，wf.getSettings 仍然按原来的方式回「没有」，没有因为新增指纹改掉这个回包形状。', JSON.stringify(got))
    const emptyHash = settingsCore.settingsContentHash(settingsCore.settingsEmptyDocument())
    check(!!got && typeof got.contentHash === 'string' && got.contentHash === emptyHash,
      '文件还没建时，回包里也带着空文档的内容指纹（字符串），客户端第一次保存可以拿它当基底。', JSON.stringify(got && got.contentHash))
  })

  await section('宿主：旧整份写仍然兼容', async function () {
    const home = makeHome('host-legacy')
    const phones = makePhones(home, [])
    const preset = docWithWorkspaces({ 'D:\\ilife': workspaceRecord('hide', 'off'), 'D:\\other': workspaceRecord('show', 'on') })
    const set = await phones.handleSetSettings({ value: preset })
    check(!!set && set.ok === true, '旧的整份 {value} 入参仍然可用：老客户端继续按整份写，回包成功。', JSON.stringify(set))
    const doc = await readDoc(home)
    check(!!doc && !!doc.workspaces['D:\\ilife'] && doc.workspaces['D:\\ilife'].statusBar === 'hide' && doc.workspaces['D:\\ilife'].deckTools === 'off',
      '旧的整份写入照样把两格值写进了真实文件，兼容路径的行为没有变。', JSON.stringify(doc && doc.workspaces['D:\\ilife']))
    const got = await phones.handleGetSettings({})
    check(!!got && got.ok === true && typeof got.contentHash === 'string' && got.contentHash === settingsCore.settingsContentHash(got.value),
      '读成功时回包里的内容指纹，正是它回的那份文档算出来的指纹。', JSON.stringify(got && got.contentHash))
  })

  await section('宿主：补丁只改点名的格', async function () {
    const home = makeHome('host-patch')
    const phones = makePhones(home, [])
    const preset = docWithWorkspaces({ 'D:\\ilife': workspaceRecord('show', 'on'), 'D:\\other': workspaceRecord('show', 'on') }, { stateFilter: 'blocked' })
    await store.writeLocalSettings(preset, home, realIo)
    const before = await phones.handleGetSettings({})
    const patched = await phones.handleSetSettings({
      patch: { workspaces: { 'D:\\ilife': { statusBar: 'hide', deckTools: 'off' } } },
      baseHash: before && before.contentHash,
    })
    check(!!patched && patched.ok === true, '基底指纹对得上时，wf.setSettings 的补丁写入回 ok。', JSON.stringify(patched))
    check(!!patched && !!patched.value && !!patched.value.workspaces['D:\\ilife'] && patched.value.workspaces['D:\\ilife'].statusBar === 'hide' && patched.value.workspaces['D:\\ilife'].deckTools === 'off',
      '回包里的 value 是合并之后的完整文档，补丁点名的两格都是新值。', JSON.stringify(patched && patched.value && patched.value.workspaces['D:\\ilife']))
    const doc = await readDoc(home)
    check(!!doc && !!doc.workspaces['D:\\ilife'] && doc.workspaces['D:\\ilife'].statusBar === 'hide' && doc.workspaces['D:\\ilife'].deckTools === 'off',
      '文件里只改了补丁点名的那两格，值都落到了真盘上。', JSON.stringify(doc && doc.workspaces['D:\\ilife']))
    check(!!doc && !!doc.workspaces['D:\\other'] && doc.workspaces['D:\\other'].statusBar === 'show' && doc.workspaces['D:\\other'].deckTools === 'on',
      '补丁没有点名的工作区原样保留，没有被这份补丁碰到。', JSON.stringify(doc && doc.workspaces['D:\\other']))
    check(!!doc && !!doc.ui && doc.ui.stateFilter === 'blocked',
      '补丁没有点名的节（ui）也原样保留，没有按内存里的旧文档重写。', JSON.stringify(doc && doc.ui))
    check(!!patched && typeof patched.contentHash === 'string' && !!doc && patched.contentHash === settingsCore.settingsContentHash(doc),
      '写成功的回包带的是写完之后这份文档的指纹，下一笔写可以拿它当基底。', JSON.stringify(patched && patched.contentHash))
  })

  await section('宿主：patch 里的 null 删临时记录', async function () {
    const home = makeHome('host-delete')
    const phones = makePhones(home, [])
    const preset = docWithWorkspaces({
      'D:\\ilife': workspaceRecord('show', 'on'),
      'D:\\tmp-open': { unopened: true, deckTools: 'off' },
    })
    await store.writeLocalSettings(preset, home, realIo)
    const before = await phones.handleGetSettings({})
    const deleted = await phones.handleSetSettings({
      patch: { workspaces: { 'D:\\tmp-open': null } },
      baseHash: before && before.contentHash,
    })
    check(!!deleted && deleted.ok === true, 'patch 里给 null 表示删掉这个键，宿主回 ok。', JSON.stringify(deleted))
    const doc = await readDoc(home)
    check(!!doc && !Object.prototype.hasOwnProperty.call(doc.workspaces, 'D:\\tmp-open'),
      '临时记录被 null 从文件里删掉了（#1640 搬迁临时记录靠的是这条语义）。', JSON.stringify(doc && Object.keys(doc.workspaces)))
    check(!!doc && !!doc.workspaces['D:\\ilife'] && doc.workspaces['D:\\ilife'].statusBar === 'show',
      '删这一条记录不影响别的记录，工作区里的其它格还都在。', JSON.stringify(doc && doc.workspaces['D:\\ilife']))
  })

  await section('宿主：过期基底指纹回 conflict 且文件不动', async function () {
    const home = makeHome('host-conflict')
    const phones = makePhones(home, [])
    await store.writeLocalSettings(docWithWorkspaces({ 'D:\\ilife': workspaceRecord('show', 'on') }), home, realIo)
    const first = await phones.handleGetSettings({})
    check(!!first && first.ok === true && typeof first.contentHash === 'string' && first.contentHash.length > 0,
      '冲突用例先拿到一份非空的基底指纹。', JSON.stringify(first && first.contentHash))
    const other = await phones.handleSetSettings({ value: docWithWorkspaces({ 'D:\\ilife': workspaceRecord('hide', 'on') }, { stateFilter: 'blocked' }) })
    check(!!other && other.ok === true, '另一个窗口先用旧的整份写入了另一版，第一份指纹因此过期。', JSON.stringify(other))
    const bytesBefore = fs.readFileSync(settingsPathIn(home), 'utf8')
    const stale = await phones.handleSetSettings({
      patch: { workspaces: { 'D:\\ilife': { deckTools: 'off' } } },
      baseHash: first.contentHash,
    })
    check(!!stale && stale.ok === false && stale.error && stale.error.kind === 'conflict',
      '拿过期指纹发补丁写时回 conflict，而不是把别人的改动硬盖掉。', JSON.stringify(stale))
    const bytesAfter = fs.readFileSync(settingsPathIn(home), 'utf8')
    check(bytesAfter === bytesBefore, '回 conflict 时设置文件一个字节都没有动。', 'before=' + bytesBefore.length + ' after=' + bytesAfter.length)
    const latest = await readDoc(home)
    check(!!stale && typeof stale.contentHash === 'string' && !!latest && stale.contentHash === settingsCore.settingsContentHash(latest),
      'conflict 回包里带着盘上最新那份的指纹，客户端可以拿它重读重试。', JSON.stringify(stale && stale.contentHash))
  })

  await section('宿主：文件不在时拿空文档指纹发第一笔', async function () {
    const home = makeHome('host-first-save')
    const phones = makePhones(home, [])
    const got = await phones.handleGetSettings({})
    const saved = await phones.handleSetSettings({
      patch: { workspaces: { 'D:\\ilife': { statusBar: 'hide', deckTools: 'off' } } },
      baseHash: got && got.contentHash,
    })
    check(!!saved && saved.ok === true, '文件不在时，拿 absent 回包里的空文档指纹当基底，第一笔补丁写能成功建出文件。', JSON.stringify(saved))
    const doc = await readDoc(home)
    check(!!doc && !!doc.workspaces['D:\\ilife'] && doc.workspaces['D:\\ilife'].statusBar === 'hide' && doc.workspaces['D:\\ilife'].deckTools === 'off',
      '第一笔补丁写之后，文件里两格就是刚写的值。', JSON.stringify(doc && doc.workspaces['D:\\ilife']))
    const after = await phones.handleGetSettings({})
    check(!!after && after.ok === true && !!doc && after.contentHash === settingsCore.settingsContentHash(doc),
      '写完再读，回包里的指纹与盘上这份文档一致。', JSON.stringify(after && after.contentHash))
  })

  await section('宿主：同一实例并发两笔补丁写也不互相覆盖', async function () {
    const home = makeHome('host-concurrent')
    const phones = makePhones(home, [])
    await store.writeLocalSettings(docWithWorkspaces({ 'D:\\ilife': workspaceRecord('show', 'on') }), home, realIo)
    const seen = await phones.handleGetSettings({})
    const baseHash = seen && seen.contentHash
    check(typeof baseHash === 'string' && baseHash.length > 0, '并发组先拿到两笔写共同的基底指纹。', JSON.stringify(baseHash))
    const requests = [
      { cell: 'statusBar', value: 'hide', patch: { workspaces: { 'D:\\ilife': { statusBar: 'hide' } } } },
      { cell: 'deckTools', value: 'off', patch: { workspaces: { 'D:\\ilife': { deckTools: 'off' } } } },
    ]
    const results = await Promise.all(requests.map(function (r) {
      return phones.handleSetSettings({ patch: r.patch, baseHash: baseHash })
    }))
    const okCount = results.filter(function (r) { return !!r && r.ok === true }).length
    const conflictCount = results.filter(function (r) { return !!r && r.ok === false && r.error && r.error.kind === 'conflict' }).length
    check(okCount === 1 && conflictCount === 1,
      '同一个宿主实例把两笔写放进同一条串行队列：先到的一笔成功，后到的一笔拿到 conflict，而不是两笔都拿同一份旧基底各自覆盖。',
      JSON.stringify(results))
    let winner = -1
    let conflicted = -1
    for (let i = 0; i < results.length; i++) {
      if (results[i] && results[i].ok === true) winner = i
      if (results[i] && results[i].ok === false && results[i].error && results[i].error.kind === 'conflict') conflicted = i
    }
    const afterWinner = await readDoc(home)
    const winnerRec = afterWinner && afterWinner.workspaces['D:\\ilife']
    check(winner >= 0 && !!winnerRec && winnerRec[requests[winner].cell] === requests[winner].value,
      '成功那一笔点的格已经写进文件。', JSON.stringify({ winner: winner, rec: winnerRec }))
    const latest = winner >= 0 && conflicted >= 0 ? await phones.handleGetSettings({}) : null
    const retry = latest ? await phones.handleSetSettings({ patch: requests[conflicted].patch, baseHash: latest.contentHash }) : null
    check(!!retry && retry.ok === true, '拿到 conflict 的那一笔重新读一份新指纹再写，成功。', JSON.stringify(retry))
    const finalDoc = await readDoc(home)
    const finalRec = finalDoc && finalDoc.workspaces['D:\\ilife']
    check(!!finalRec && finalRec.statusBar === 'hide' && finalRec.deckTools === 'off',
      '两笔都成交之后，statusBar=hide 与 deckTools=off 两格都在文件里，没有谁把谁顶掉。', JSON.stringify(finalRec))
  })

  // ---------------------------------------------------------------------------------------------
  // 二、客户端闭包：两窗交叉、重读、冲突重试、入参形状
  // ---------------------------------------------------------------------------------------------

  await section('客户端：重读之后能看到别的窗口的新值', async function () {
    const home = makeHome('reload')
    const sharedPhones = makePhones(home, [])
    const envA = makeEnv({ tag: 'reload-a', home: home, phones: sharedPhones })
    const envB = makeEnv({ tag: 'reload-b', home: home, phones: sharedPhones })
    check(typeof envB.mod.settingsViewReload === 'function',
      '客户端闭包里拼进了新片导出的 settingsViewReload（没有它，设置页打开时就没法重读别的窗口刚写的值）。', typeof envB.mod.settingsViewReload)
    check(typeof envB.mod.viewFlagDiffDocOf === 'function',
      '客户端闭包里拼进了补丁生成函数 viewFlagDiffDocOf（客户端靠它把本窗改动压成按格补丁）。', typeof envB.mod.viewFlagDiffDocOf)
    const clientEmpty = envB.mod.viewFlagEmptyDoc ? envB.mod.viewFlagEmptyDoc() : null
    check(!!clientEmpty && JSON.stringify(clientEmpty) === JSON.stringify(settingsCore.settingsEmptyDocument()),
      '客户端片里的空文档与设置核里的空文档逐字一致（空文档只在核里定义一处，客户端片按 ADR 20261021 的门禁口径盯住这份拷贝）。',
      JSON.stringify({ client: clientEmpty, core: settingsCore.settingsEmptyDocument() }))
    envA.mod.settingsViewLoad()
    envB.mod.settingsViewLoad()
    await settle(envA.mod)
    await settle(envB.mod)
    check(envA.mod.viewFlagReadyNow() === true && envB.mod.viewFlagReadyNow() === true,
      '两个窗口都先把设置文档读进内存、进入就绪状态了。', JSON.stringify({ a: envA.mod.viewFlagReadyNow(), b: envB.mod.viewFlagReadyNow() }))
    const initialB = envB.mod.viewFlagOfRoot(envB.root, 'statusBar')
    check(initialB && initialB.known === false,
      'A 还没写之前，B 手上只有空文档，问 statusBar 回「不知道」。', JSON.stringify(initialB))
    const acceptedA = envA.mod.setViewFlagValue(envA.cwd, 'statusBar', 'hide', false)
    check(acceptedA === true, 'A 把 statusBar 改成 hide 时，客户端接下了这一笔（文档就绪、值合法）。', acceptedA)
    const aLanded = await waitFor(async function () {
      const d = await readDoc(home)
      return !!d && !!d.workspaces && !!d.workspaces['D:\\ilife'] && d.workspaces['D:\\ilife'].statusBar === 'hide'
    })
    check(aLanded, 'A 这一笔真的落到了盘上的设置文件里（statusBar 是 hide）。', JSON.stringify(await readDoc(home)))
    const staleB = envB.mod.viewFlagOfRoot(envB.root, 'statusBar')
    check(staleB && staleB.known === false,
      '没有调用重读之前，B 仍然只有自己加载时那份旧文档，读不到另一个窗口刚写进去的 hide。', JSON.stringify(staleB))
    let reloadError = null
    try { envB.mod.settingsViewReload() } catch (e) { reloadError = e }
    check(reloadError === null, 'B 调用 settingsViewReload() 时不抛错。', reloadError && reloadError.stack)
    const reloaded = await waitFor(function () {
      const one = envB.mod.viewFlagOfRoot(envB.root, 'statusBar')
      return !!one && one.known === true && one.value === 'hide'
    })
    check(reloaded, '重读之后，B 读到别的窗口刚写进去的 statusBar=hide（重开设置页能看到最新值）。', JSON.stringify(envB.mod.viewFlagOfRoot(envB.root, 'statusBar')))
    const envBGets = envB.calls.filter(function (c) { return c.method === 'wf.getSettings' }).length
    check(envBGets >= 2, '重读真的又向宿主读了一次设置文档（B 的 wf.getSettings 至少两次：初次加载一次、重读一次）。', envBGets)
  })

  await section('客户端：两窗各写一格最后两格都在', async function () {
    const home = makeHome('write')
    const sharedPhones = makePhones(home, [])
    const envA = makeEnv({ tag: 'write-a', home: home, phones: sharedPhones })
    const envB = makeEnv({ tag: 'write-b', home: home, phones: sharedPhones })
    envA.mod.settingsViewLoad()
    envB.mod.settingsViewLoad()
    await settle(envA.mod)
    await settle(envB.mod)
    const okA = envA.mod.setViewFlagValue(envA.cwd, 'statusBar', 'hide', false)
    check(okA === true, 'A 把 statusBar 改成 hide 时客户端接下了这一笔。', okA)
    const aLanded = await waitFor(async function () {
      const d = await readDoc(home)
      return !!d && !!d.workspaces && !!d.workspaces['D:\\ilife'] && d.workspaces['D:\\ilife'].statusBar === 'hide'
    })
    check(aLanded, 'A 这一笔先落盘：文件里 statusBar 是 hide。', JSON.stringify(await readDoc(home)))
    const okB = envB.mod.setViewFlagValue(envB.cwd, 'deckTools', 'off', false)
    check(okB === true, 'B 拿自己加载时那份旧文档，把 deckTools 改成 off 时客户端也接下了这一笔。', okB)
    const bothLanded = await waitFor(async function () {
      const d = await readDoc(home)
      return !!d && !!d.workspaces && !!d.workspaces['D:\\ilife'] && d.workspaces['D:\\ilife'].statusBar === 'hide' && d.workspaces['D:\\ilife'].deckTools === 'off'
    })
    check(bothLanded, '两窗各写一格之后，文件里 statusBar=hide 与 deckTools=off 都在：B 的写没有把 A 的 hide 整份顶掉。', JSON.stringify(await readDoc(home)))
    const aSets = envA.calls.filter(function (c) { return c.method === 'wf.setSettings' })
    const bSets = envB.calls.filter(function (c) { return c.method === 'wf.setSettings' })
    check(aSets.length >= 1 && bSets.length >= 1, '两个窗口各至少发出过一次 wf.setSettings。', JSON.stringify({ a: aSets.length, b: bSets.length }))
    const allSets = aSets.concat(bSets)
    const shapeOk = allSets.every(function (c) {
      return !!c.args && typeof c.args.patch === 'object' && c.args.patch !== null && typeof c.args.baseHash === 'string' && c.args.value === undefined
    })
    check(shapeOk, '客户端发给宿主的 wf.setSettings 入参都是 {patch, baseHash}，不再带整份 value。', JSON.stringify(allSets.map(function (c) { return c.args })))
    const bPatch = bSets.length ? bSets[0].args.patch : null
    const bEntry = bPatch && bPatch.workspaces ? bPatch.workspaces['D:\\ilife'] : null
    check(!!bEntry && bEntry.deckTools === 'off', 'B 的补丁点了本窗真正改过的那一格 deckTools=off。', JSON.stringify(bPatch))
    check(!!bEntry && !Object.prototype.hasOwnProperty.call(bEntry, 'statusBar'),
      'B 的补丁里没有 A 已经写进磁盘的 statusBar：别的窗口新写的格不会出现在本窗补丁里。', JSON.stringify(bEntry))
    check(!!bEntry && Object.keys(bEntry).length === 1,
      'B 的补丁只含它真正改动的那一格，没有把整份记录或整份文档塞进去。', JSON.stringify(bEntry))
    const finalDoc = await readDoc(home)
    const finalRead = await sharedPhones.handleGetSettings({})
    check(!!finalDoc && !!finalRead && finalRead.ok === true && typeof finalRead.contentHash === 'string' && finalRead.contentHash === settingsCore.settingsContentHash(finalDoc),
      '两窗写完之后，宿主读回来的内容指纹与盘上这份文档算出来的指纹一致。', JSON.stringify(finalRead && finalRead.contentHash))
  })

  await section('客户端：撞上 conflict 不静默丢值', async function () {
    const home = makeHome('conflict')
    const sharedPhones = makePhones(home, [])
    await store.writeLocalSettings(docWithWorkspaces({ 'D:\\ilife': workspaceRecord('show', 'on') }), home, realIo)
    let external = null
    let injected = false
    const envB = makeEnv({
      tag: 'conflict-b',
      home: home,
      phones: sharedPhones,
      onCall: function (method, args, list) {
        if (method !== 'wf.setSettings' || injected) return
        injected = true
        // 在客户端这一笔真正交给宿主之前，先让另一条外部写入用最新文档改一格；同一 serialWrite
        // 队列保证它先执行，于是客户端手里那份 baseHash 必然过期。
        external = sharedPhones.handleSetSettings({
          patch: { workspaces: { 'D:\\ilife': { subwsMarkAutoShown: true } } },
          baseHash: '',
        })
      },
    })
    envB.mod.settingsViewLoad()
    await settle(envB.mod)
    check(envB.mod.viewFlagReadyNow() === true, '冲突场景里，B 先把盘上那份文档读进内存（它手里的基底指纹就是这一刻的）。', envB.mod.viewFlagReadyNow())
    const accepted = envB.mod.setViewFlagValue(envB.cwd, 'deckTools', 'off', false)
    check(accepted === true, 'B 把 deckTools 改成 off 时客户端接下了这一笔。', accepted)
    const conflictSeen = await waitFor(function () {
      return envB.calls.some(function (c) {
        return c.method === 'wf.setSettings' && c.res && c.res.ok === false && c.res.error && c.res.error.kind === 'conflict'
      })
    })
    check(conflictSeen, '客户端这一笔正要交给宿主时另一条外部写入先动了文件，于是宿主回 conflict（没有静默丢值）。',
      JSON.stringify(envB.calls.filter(function (c) { return c.method === 'wf.setSettings' }).map(function (c) { return c.res })))
    async function bothOnDisk() {
      return await waitFor(async function () {
        const d = await readDoc(home)
        return !!d && !!d.workspaces && !!d.workspaces['D:\\ilife'] && d.workspaces['D:\\ilife'].deckTools === 'off' && d.workspaces['D:\\ilife'].subwsMarkAutoShown === true
      })
    }
    let bothLanded = await bothOnDisk()
    if (!bothLanded) {
      envB.mod.setViewFlagValue(envB.cwd, 'deckTools', 'off', false)
      bothLanded = await bothOnDisk()
    }
    check(bothLanded, '最终盘上两格都在：外部写入的 subwsMarkAutoShown=true，以及 B 要写的 deckTools=off（冲突没有让任何一边丢值）。', JSON.stringify(await readDoc(home)))
    const okSets = envB.calls.filter(function (c) { return c.method === 'wf.setSettings' && c.res && c.res.ok === true })
    check(okSets.length >= 1, '冲突之后客户端重新读了一份新指纹又写了一次（重试成交）。', JSON.stringify(okSets.map(function (c) { return c.res && c.res.ok })))
    const retriedClean = okSets.every(function (c) {
      const p = c.args && c.args.patch
      const e = p && p.workspaces ? p.workspaces['D:\\ilife'] : null
      return !e || !Object.prototype.hasOwnProperty.call(e, 'subwsMarkAutoShown')
    })
    check(retriedClean, '重试成功那一笔的补丁里没有外部刚写的 subwsMarkAutoShown（没有拿旧文档整份盖回去）。', JSON.stringify(okSets.map(function (c) { return c.args && c.args.patch })))
    if (external) { try { await external } catch (e) {} }
  })

  await section('客户端：设置页第一次打开（还没读过文档）也走重读那一趟', async function () {
    const home = makeHome('reload-idle')
    await store.writeLocalSettings(docWithWorkspaces({ 'D:\\ilife': workspaceRecord('hide', 'off') }), home, realIo)
    const env = makeEnv({ tag: 'reload-idle-a', home: home })
    check(env.mod.viewFlagReadyNow() === false,
      '新建的窗口还没问过设置文档，处于空闲状态。', env.mod.viewFlagReadyNow())
    let reloadError = null
    try { env.mod.settingsViewReload() } catch (e) { reloadError = e }
    check(reloadError === null, '空闲状态调用 settingsViewReload() 时不抛错。', reloadError && reloadError.stack)
    const ready = await waitFor(function () { return env.mod.viewFlagReadyNow() === true })
    check(ready, '空闲状态的重读交给既有的惰性加载，文档读进内存后进入就绪状态。', env.mod.viewFlagReadyNow())
    const gets = env.calls.filter(function (c) { return c.method === 'wf.getSettings' }).length
    check(gets >= 1, '这一趟真的向宿主读了设置文档（wf.getSettings 至少一次）。', gets)
    const seen = env.mod.viewFlagOfRoot(env.root, 'statusBar')
    check(!!seen && seen.known === true && seen.value === 'hide',
      '设置页第一次打开就读到盘上已有的值，不用先经过一次别的动作才把文档读进来。', JSON.stringify(seen))
  })

  await section('客户端：第一笔保存只发用户点过的格', async function () {
    const home = makeHome('first-save')
    const sharedPhones = makePhones(home, [])
    const env = makeEnv({ tag: 'first-save-a', home: home, phones: sharedPhones })
    env.mod.settingsViewLoad()
    await settle(env.mod)
    check(env.mod.viewFlagReadyNow() === true,
      '文件还没建时读回 absent，客户端按空文档起步进入就绪状态。', env.mod.viewFlagReadyNow())
    const accepted = env.mod.setViewFlagValue(env.cwd, 'statusBar', 'hide', false)
    check(accepted === true, '把 statusBar 改成 hide 时客户端接下了这一笔。', accepted)
    const sent = await waitFor(function () {
      return env.calls.some(function (c) { return c.method === 'wf.setSettings' && c.res && c.res.ok === true })
    })
    check(sent, '这一笔保存交给宿主之后写入成功。',
      JSON.stringify(env.calls.filter(function (c) { return c.method === 'wf.setSettings' }).map(function (c) { return c.res })))
    const setCall = env.calls.filter(function (c) { return c.method === 'wf.setSettings' })[0]
    const patch = setCall && setCall.args ? setCall.args.patch : null
    const wsKeys = patch && patch.workspaces ? Object.keys(patch.workspaces) : []
    const entry = wsKeys.length === 1 ? patch.workspaces[wsKeys[0]] : null
    check(!!entry && entry.statusBar === 'hide',
      '补丁里带着用户点过的那一格 statusBar=hide。', JSON.stringify(patch))
    check(!!entry && !Object.prototype.hasOwnProperty.call(entry, 'deckTools') && !Object.prototype.hasOwnProperty.call(entry, 'subwsMarkAutoShown') && !Object.prototype.hasOwnProperty.call(entry, 'unopened'),
      '补丁里没有用户没点过的格（deckTools、subwsMarkAutoShown，以及正式记录不该带的 unopened）：新建记录时种下的缺省不跟着发出去。', JSON.stringify(entry))
    const doc = await readDoc(home)
    check(!!doc && !!doc.workspaces['D:\\ilife'] && doc.workspaces['D:\\ilife'].statusBar === 'hide' && doc.workspaces['D:\\ilife'].deckTools === 'on',
      '文件里这条新记录是用户改的那一格，其余格按既有缺省补全（deckTools 缺省 on）。', JSON.stringify(doc && doc.workspaces['D:\\ilife']))
  })

  // ---------------------------------------------------------------------------------------------
  // 三、接线与构建产物
  // ---------------------------------------------------------------------------------------------

  await section('设置页接线', async function () {
    const pagePath = sourcePath('src/client/views/SettingsPage.js')
    const pageSrc = readText(pagePath)
    let idx = pageSrc.indexOf('settingsViewReload()')
    check(idx >= 0, '设置页真源里出现了对 settingsViewReload() 的调用。', pagePath)
    let wired = false
    let where = -1
    while (idx >= 0) {
      const effectAt = pageSrc.lastIndexOf('React.useEffect', idx)
      if (effectAt >= 0 && idx - effectAt < 600) { wired = true; where = idx; break }
      idx = pageSrc.indexOf('settingsViewReload()', idx + 1)
    }
    check(wired, '这次调用写在 React.useEffect 里：设置页挂载时重读文档，不是在模块加载时或渲染过程中顺手调。',
      where >= 0 ? pageSrc.slice(Math.max(0, where - 200), where + 80) : '没有找到位于 React.useEffect 之后 600 字符内的调用')
  })

  await section('构建产物', async function () {
    const clientText = readText('client.js')
    const libText = readText('package/lib/client.js')
    check(clientText.indexOf('const settingsViewReload = function') >= 0,
      '构建后的 client.js 里有 settingsViewReload 函数定义（新函数真进了客户端产物）。', 'client.js 长度 ' + clientText.length)
    check(libText.indexOf('const settingsViewReload = function') >= 0,
      '构建后的 package/lib/client.js 里也有 settingsViewReload 函数定义（包内产物同样跟上了）。', 'package/lib/client.js 长度 ' + libText.length)
  })

  console.log('')
  console.log(failed
    ? ('\n存在失败 — 有 ' + failed + ' 条断言没有通过，' + passed + ' 条通过。')
    : ('\n全部通过 — ' + passed + ' 条断言全部通过。'))
  printGateResult('verify-1802-settings-cross-window', passed + failed, failed)
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) {
  console.error('FATAL ' + String((e && e.stack) || e))
  process.exit(2)
}).finally(function () {
  uninstallTimeCompression()
})
