#!/usr/bin/env node
/**
 * verify-1612-settings-switches.ts —— #1612 设置文件两个开关（胶囊状态栏、deck 工具箱）的门禁。
 *
 * 这一份门禁只量三件事，每一件都用完整的一句话说清，第一次读的人能直接看懂。
 * 第一件事是设置文件的读写契约：每个工作区新增 statusBar（show 显示、hide 收起，缺省 hide）与
 *   deckTools（on 打开、off 关闭，缺省 on）两格；旧文件里只有 bannerFolded 的记录照读并换算
 *   （收起 true → hide、展开 false → show），同一份文件里 statusBar 显式写着时以它为准；写回去的那一份
 *   只写新两格、不再写旧字段；未知键与认不出的开关值仍按坏形状拒绝。
 * 第二件事是客户端写这条路：kernel/settings-view-write.ts 的 setViewFlagValue 把 statusBar/deckTools
 *   原样交给「改内存文档 → 进队列 → 防抖 → 重读合并 → 写文件」这一条路（与 setViewFlag 同一条路，
 *   只是不做真假值转换），文件里真的出现这两格的新值；认不出的名字或值直接拒绝，一个字都不写。
 * 第三件事是客户端读这条路：kernel/settings-view.ts 的 viewFlagOf 对这两个名字读文件里的字符串，
 *   问不出时回 undefined 且不回退旧 localStorage 的布尔键（旧 bannerFolded 的迁移只由 deck-state 做一次）；
 *   旧布尔名字的回退读法一个字不变。另外量新建记录时的种子：文件还没建出来时第一次写，另一格按旧
 *   bannerFolded 的语义种上，升级后用户原来展开的胶囊仍是显示着的。
 *
 * 怎么保证量的是真件：设置文件的读写用 src/host/configStore.js 的真实现（它转给核里的 settings.ts）；
 *   客户端那三片（settings-view-state、settings-view、settings-view-write）的真源按构建同一种做法、
 *   同一次序拼起来当场造出函数来跑；它打的宿主电话用 src/host/settingsPhones.js 的真实现，读写落在
 *   系统临时目录里的真文件上 —— 只有手机（假 host 的 call）是替身，写失败的两档由替身直接回拒。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-1612-settings-switches.ts
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
// 假的一台手机：把两条设置电话接到真实现上；failMode='refuse' 用来演「写文件被拒」这一档。
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

async function main() {
  console.log('#1612 设置文件两个开关门禁（胶囊状态栏、deck 工具箱：读写契约、旧值迁移、写口与读口）')
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

  // ── 第一件事：设置文件的读写契约（旧值迁移、新两格、拒绝面） ──
  console.log('')
  console.log('== 第一件事：旧文件里的 bannerFolded 照读并换算，写回去只写新两格 ==')
  const legacyText = settingsText([
    '  D:\\ws\\folded:',
    '    bannerFolded: true',
    '  D:\\ws\\shown:',
    '    bannerFolded: false',
  ])
  const legacyOut = parseSettingsText(legacyText)
  const legacyWs = wsOf(legacyOut)
  check(!!legacyWs, '旧文件（只有 bannerFolded 两个工作区）能读。', legacyOut && legacyOut.message)
  check(!!legacyWs && legacyWs['D:\\ws\\folded'].statusBar === 'hide', '旧值收起（bannerFolded: true）换算成 statusBar: hide。', JSON.stringify(legacyWs && legacyWs['D:\\ws\\folded']))
  check(!!legacyWs && legacyWs['D:\\ws\\shown'].statusBar === 'show', '旧值展开（bannerFolded: false）换算成 statusBar: show。', JSON.stringify(legacyWs && legacyWs['D:\\ws\\shown']))
  check(!!legacyWs && legacyWs['D:\\ws\\folded'].deckTools === 'on' && legacyWs['D:\\ws\\shown'].deckTools === 'on', '旧文件里没有 deckTools 时按缺省 on（打开）补上。', JSON.stringify(legacyWs))
  check(!!legacyWs && legacyWs['D:\\ws\\folded'].bannerFolded === undefined, '归一结果里不再留旧字段 bannerFolded。', JSON.stringify(legacyWs && legacyWs['D:\\ws\\folded']))

  const bothText = settingsText([
    '  D:\\ws\\both:',
    '    bannerFolded: true',
    '    statusBar: show',
  ])
  const bothWs = wsOf(parseSettingsText(bothText))
  check(!!bothWs && bothWs['D:\\ws\\both'].statusBar === 'show', '同一份文件里 statusBar 显式写着时以它为准（不被旧字段覆盖）。', JSON.stringify(bothWs && bothWs['D:\\ws\\both']))

  // 写回去：走 stringifyConfig 的归一路径，旧文件在第一次写回时自然升级。
  const writeOut = stringifyConfig(legacyOut.value, 'settings')
  const written = writeOut.ok === true ? writeOut.text : ''
  check(writeOut.ok === true, '旧文件读出来的那一份能写回去。', writeOut.ok ? '' : writeOut.message)
  check(written.indexOf('bannerFolded') < 0, '写出去的一份里不再出现旧字段 bannerFolded。', written.slice(0, 400))
  check(written.indexOf('statusBar: hide') >= 0 && written.indexOf('statusBar: show') >= 0, '写出去的一份里出现换算后的 statusBar 两档值。', written.slice(0, 400))
  check(written.indexOf('deckTools: "on"') >= 0, '写出去的一份里出现 deckTools: "on"（缺省打开的开关照写）。', written.slice(0, 400))
  check(written.indexOf('# 胶囊状态栏') >= 0 && written.indexOf('# deck 工具箱') >= 0, '写出去的一份里两格各带一行看得懂的注释。', written.slice(0, 400))
  const backAgain = parseSettingsText(written)
  check(backAgain.ok === true && JSON.stringify(backAgain.value.workspaces) === JSON.stringify(legacyOut.value.workspaces), '写出去再读回来，工作区那几格的值不变（升级后是稳定的）。', JSON.stringify(backAgain.ok ? backAgain.value.workspaces : backAgain.message))

  console.log('')
  console.log('== 第二件事：未知键与认不出的开关值仍按坏形状拒绝 ==')
  const unknownOut = parseSettingsText(settingsText(['  D:\\ws\\x:', '    statusBar: show', '    nick: 随便']))
  check(unknownOut.ok === false && unknownOut.reason === 'unknown-keys' && String(unknownOut.message || '').indexOf('nick') >= 0, '工作区记录里多出来的名字仍按未知键拒，并点名是哪个。', JSON.stringify(unknownOut))
  const badBarOut = parseSettingsText(settingsText(['  D:\\ws\\x:', '    statusBar: yes']))
  check(badBarOut.ok === false && String(badBarOut.message || '').indexOf('statusBar') >= 0, 'statusBar 只认 show 与 hide，别的字面量按坏形状拒。', JSON.stringify(badBarOut))
  const badBarBoolOut = parseSettingsText(settingsText(['  D:\\ws\\x:', '    statusBar: true']))
  check(badBarBoolOut.ok === false, 'statusBar 写成真假值也按坏形状拒（它不是布尔开关）。', JSON.stringify(badBarBoolOut))
  const badToolsOut = parseSettingsText(settingsText(['  D:\\ws\\x:', '    deckTools: "true"']))
  check(badToolsOut.ok === false && String(badToolsOut.message || '').indexOf('deckTools') >= 0, 'deckTools 只认 on 与 off，别的字面量按坏形状拒。', JSON.stringify(badToolsOut))
  const badOldOut = parseSettingsText(settingsText(['  D:\\ws\\x:', '    bannerFolded: yes']))
  check(badOldOut.ok === false && String(badOldOut.message || '').indexOf('bannerFolded') >= 0, '旧字段 bannerFolded 仍必须是真假值（没加引号的 yes 按坏形状拒）。', JSON.stringify(badOldOut))
  const goodOut = parseSettingsText(settingsText(['  D:\\ws\\x:', '    statusBar: hide', '    deckTools: off']))
  check(goodOut.ok === true && wsOf(goodOut)['D:\\ws\\x'].statusBar === 'hide' && wsOf(goodOut)['D:\\ws\\x'].deckTools === 'off', '合法的两格值照读（show/hide、on/off 两档都认）。', JSON.stringify(goodOut))

  // ── 第三件事：客户端读写这条路（真内核片 + 真宿主电话 + 真文件） ──
  console.log('')
  console.log('== 第三件事：setViewFlagValue 原样写字符串，viewFlagOf 读字符串、不回退旧键 ==')
  // 一个场景的全套夹具：临时主目录（可续用同一个主目录演「重启」）、假手机、假 localStorage、一条会话状态。
  function makeEnv(opts) {
    const o = opts || {}
    const cwd = o.cwd || 'D:\\ws\\demo'
    const root = o.root === undefined ? 'd:\\ws' : o.root
    const home = o.home || fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-1612-'))
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
  const failLogged = (env) => env.logs.some((l) => l.event === 'host.call.fail' && l.fields && l.fields.method === 'wf.setSettings')

  {
    const env = makeEnv({ tag: 'born' })
    const accepted = env.mod.setViewFlagValue(env.cwd, 'statusBar', 'show')
    check(accepted === true, '文件还没建出来时也接下这一笔（后端通着，第一次写会把设置文件建出来）。')
    const landed = await waitFor(diskEntryIs(env.home, 'D:\\ws', 'statusBar', 'show'))
    check(landed, 'statusBar 写 show 后落盘是 show。', JSON.stringify(await readDoc(env.home)))
    const doc = await readDoc(env.home)
    const entry = entryOf(doc, 'D:\\ws')
    check(!!entry && entry.deckTools === 'on', '同一份记录里 deckTools 按缺省种成 on（新建记录就带齐两格）。', JSON.stringify(entry))
    check(!!entry && entry.bannerFolded === undefined, '落盘的记录里不再出现旧字段 bannerFolded。', JSON.stringify(entry))
    check(env.mod.viewFlagOf(env.cwd, 'statusBar') === 'show', '写成功之后读口立刻读得到 statusBar 的字符串值 show。')
    check(env.mod.viewFlagOf(env.cwd, 'deckTools') === 'on', '写成功之后读口立刻读得到 deckTools 的字符串值 on。')
  }

  {
    // 验收⑤的设置侧：只关胶囊状态栏时 deck 工具箱仍是开着的，两件事互不牵连。
    const env = makeEnv({ tag: 'capsule-only' })
    env.mod.setViewFlagValue(env.cwd, 'statusBar', 'show')
    await waitFor(diskEntryIs(env.home, 'D:\\ws', 'statusBar', 'show'))
    const accepted = env.mod.setViewFlagValue(env.cwd, 'statusBar', 'hide')
    check(accepted === true, '把胶囊状态栏改回收起时这一笔被接下。')
    const landed = await waitFor(diskEntryIs(env.home, 'D:\\ws', 'statusBar', 'hide'))
    check(landed, 'statusBar 改 hide 后落盘是 hide。', JSON.stringify(await readDoc(env.home)))
    const entry = entryOf(await readDoc(env.home), 'D:\\ws')
    check(!!entry && entry.deckTools === 'on', '只关胶囊状态栏不动 deck 工具箱（deckTools 仍是 on）。', JSON.stringify(entry))
  }

  {
    const env = makeEnv({ tag: 'tools' })
    env.mod.setViewFlagValue(env.cwd, 'deckTools', 'off')
    const landed = await waitFor(diskEntryIs(env.home, 'D:\\ws', 'deckTools', 'off'))
    check(landed, 'deckTools 写 off 后落盘是 off。', JSON.stringify(await readDoc(env.home)))
    const back = env.mod.setViewFlagValue(env.cwd, 'deckTools', 'on')
    check(back === true, '再把 deck 工具箱打开时这一笔被接下。')
    const landedBack = await waitFor(diskEntryIs(env.home, 'D:\\ws', 'deckTools', 'on'))
    check(landedBack && env.mod.viewFlagOf(env.cwd, 'deckTools') === 'on', 'deckTools 改回 on 后落盘与读口都是 on。', JSON.stringify(await readDoc(env.home)))
  }

  {
    // 验收①：刷新/重启之后值还在 —— 重新起一个客户端实例读同一个临时主目录里的同一份文件。
    const env = makeEnv({ tag: 'persist' })
    env.mod.setViewFlagValue(env.cwd, 'statusBar', 'show')
    env.mod.setViewFlagValue(env.cwd, 'deckTools', 'off')
    const landed = await waitFor(async () => {
      const doc = await readDoc(env.home)
      const entry = entryOf(doc, 'D:\\ws')
      return !!entry && entry.statusBar === 'show' && entry.deckTools === 'off'
    })
    check(landed, '两格一起改完都落盘了（statusBar: show、deckTools: off）。', JSON.stringify(await readDoc(env.home)))
    const env2 = makeEnv({ tag: 'persist-restart', home: env.home })
    env2.mod.settingsViewLoad()
    await settlement(env2.mod)
    check(env2.mod.viewFlagOf(env2.cwd, 'statusBar') === 'show' && env2.mod.viewFlagOf(env2.cwd, 'deckTools') === 'off', '重新起一个客户端实例（相当于刷新或重启）从文件读回两格的值。')
  }

  {
    // 认不出的名字或值直接拒绝：错值一步都进不了内存文档，也就不会有任何一格被猜着写到别处。
    const env = makeEnv({ tag: 'guard' })
    env.mod.settingsViewLoad()
    await settlement(env.mod)
    check(env.mod.setViewFlagValue(env.cwd, 'statusBar', 'yes') === false, 'statusBar 传认不出的字面量（yes）时写口回 false。')
    check(env.mod.setViewFlagValue(env.cwd, 'deckTools', true) === false, 'deckTools 传真假值（true）时写口回 false。')
    check(env.mod.setViewFlagValue(env.cwd, 'bannerFolded', true) === false, '旧布尔名字不走这条文字写口，写口回 false。')
    await sleep(200)
    check(env.calls.filter((c) => c.method === 'wf.setSettings').length === 0, '这些被拒的调用一个字都没有写文件。', JSON.stringify(env.calls.map((c) => c.method)))
  }

  {
    // 旧布尔名字的回退读法一个字不变；文字开关问不出时回 undefined，不回退旧 localStorage 的布尔键。
    const env = makeEnv({ tag: 'legacy-read', localStorage: { 'dsws.bannerFold': JSON.stringify({ [KEY_OF('D:\\ws\\demo')]: 1 }) } })
    check(env.mod.viewFlagOf('D:\\ws\\demo', 'bannerFolded') === true, '旧布尔名字 bannerFolded 照旧回退旧 localStorage 键（行为不变）。')
    check(env.mod.viewFlagOf('D:\\ws\\demo', 'statusBar') === undefined, 'statusBar 问不出时回 undefined，不回退旧 localStorage 的布尔值（迁移只由 deck-state 做一次）。')
    check(env.mod.viewFlagOf('D:\\ws\\demo', 'deckTools') === undefined, 'deckTools 同样不回退旧键。')
  }

  {
    // 文件里已经写着两格时，读口读到的是文件里的字符串（不是旧键、也不是缺省）。
    const seed = settingsText(['  D:\\ws:', '    statusBar: show', '    deckTools: "off"'])
    const env = makeEnv({ tag: 'read-file', seedText: seed })
    env.mod.settingsViewLoad()
    await settlement(env.mod)
    check(env.mod.viewFlagOf(env.cwd, 'statusBar') === 'show', '文件里写着 statusBar: show 时读口读到 show。', String(env.mod.viewFlagOf(env.cwd, 'statusBar')))
    check(env.mod.viewFlagOf(env.cwd, 'deckTools') === 'off', '文件里写着 deckTools: off 时读口读到 off。', String(env.mod.viewFlagOf(env.cwd, 'deckTools')))
    const ans = env.mod.viewFlagOfRoot('D:\\ws', 'statusBar')
    check(ans.known === true && ans.value === 'show', '按工作区根读也认这一格（known 为真、值是文件里的字符串）。', JSON.stringify(ans))
  }

  {
    // 写文件失败时 statusBar 按旧横幅语义兜底（收起 → bannerFold 记 1），老读口在本窗口里也看得懂。
    const env = makeEnv({ tag: 'fallback-bar', failMode: 'refuse' })
    check(env.mod.setViewFlagValue(env.cwd, 'statusBar', 'hide') === true, '写文件被拒的那一档，写口先把这一笔接下（失败在落盘那一趟才知道）。')
    const fellBack = await waitFor(() => {
      const raw = env.ls.dump()['dsws.bannerFold']
      if (!raw) return false
      try { return JSON.parse(raw)[KEY_OF(env.cwd)] === 1 } catch (e) { return false }
    })
    check(fellBack, 'statusBar 写 hide 失败时按旧横幅语义记成收起（bannerFold 记 1）。', env.ls.dump()['dsws.bannerFold'])
    check(env.mod.viewFlagOf(env.cwd, 'bannerFolded') === true, '兜底写进旧键之后，旧读口此刻读得到收起（迁移期的老读法仍能工作）。')
  }

  {
    // deckTools 没有可退的旧键：写失败时不往旧表写一个字，但日志里看得见这一笔没落地。
    const env = makeEnv({ tag: 'fallback-tools', failMode: 'refuse' })
    env.mod.setViewFlagValue(env.cwd, 'deckTools', 'off')
    const failedTwice = await waitFor(() => env.logs.filter((l) => l.event === 'host.call.fail' && l.fields && l.fields.method === 'wf.setSettings').length >= 2)
    check(failedTwice, '写文件被拒会记 host.call.fail（method=wf.setSettings），并自动再试一趟。', JSON.stringify(env.logs.slice(0, 6)))
    check(env.ls.dump()['dsws.bannerFold'] === undefined, 'deckTools 写失败时一个字都不往旧表写（它没有可退的旧键）。', JSON.stringify(env.ls.dump()))
    check(env.logs.some((l) => l.event === 'storage.fail' && l.fields && l.fields.key === 'settings.workspaces'), '这一笔没落地在日志里看得见（storage.fail，key=settings.workspaces）。', JSON.stringify(env.logs.map((l) => l.event)))
  }

  {
    // 新建记录时的种子：旧值展开（bannerFolded 旧键记 0）→ statusBar 种 show（升级后胶囊仍显示着）。
    const cwd = 'D:\\ws\\demo'
    const env = makeEnv({ tag: 'seed', localStorage: { 'dsws.bannerFold': JSON.stringify({ [KEY_OF(cwd)]: 0 }) } })
    env.mod.setViewFlagValue(cwd, 'deckTools', 'off')
    const landed = await waitFor(diskEntryIs(env.home, 'D:\\ws', 'deckTools', 'off'))
    check(landed, '文件还没建出来时写 deckTools: off 也能落盘。', JSON.stringify(await readDoc(env.home)))
    const entry = entryOf(await readDoc(env.home), 'D:\\ws')
    check(!!entry && entry.statusBar === 'show', '新建记录时 statusBar 按旧 bannerFolded 的展开语义种成 show（不顺手把用户原来展开的胶囊收起来）。', JSON.stringify(entry))
    check(!!entry && entry.bannerFolded === undefined, '种出来的新记录不带旧字段 bannerFolded。', JSON.stringify(entry))
  }

  console.log('')
  console.log('通过 ' + passed + ' 条，失败 ' + failed + ' 条。')
  printGateResult('verify-1612-settings-switches', passed + failed, failed)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
