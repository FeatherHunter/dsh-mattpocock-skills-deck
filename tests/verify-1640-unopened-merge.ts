/**
 * #1640 门禁：设置页名单上还没打开过的工作区，临时记录在认出工作区根以后合并到根那一条。
 *
 * 这张票要守住的三件事
 *   一、临时记录是稀疏的：只写用户点过的那一格，不替用户种上缺省（#1640 起；#1641 的旧格式还认，见第五件事）。
 *   二、认出工作区根以后，临时记录合并到根那一条：用户点过的格覆盖根记录里更早的值，没点过的格一个都不碰，
 *       合并后设置文件里只剩一条，不留两处分家。
 *   三、合并这一行日志等这一趟写成功才发：写失败时不留一行「合了」的假话，下一趟写成功再补。
 *
 * 怎么跑：node --import ./scripts/ts-hook.mts tests/verify-1640-unopened-merge.ts
 * 做法与 verify-1641 一致：把设置相关的三片内核按构建次序拼起来造全新实例，真文件读写落在临时目录里。
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
    setItem: (k, v) => { m[k] = String(v) },
    removeItem: (k) => { delete m[k] },
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

async function main() {
  console.log('#1640 临时记录在认出工作区根以后合并到根那一条（稀疏记录、合并日志等写成功才发）')
  const core = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'configStore.js')).href)
  const leaf = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'settingsPhones.js')).href)
  const store = core
  const { parseConfig, stringifyConfig } = core
  const KEY_OF = sharedKeyFn('keyOf')
  const CURRENT_OS = sharedKeyFn('currentOs')
  const settingsText = (wsLines) => ['version: 1', 'ui: {}', 'workspaces:'].concat(wsLines || []).concat(['debug:', '  enabled: false', '  sampleRate: 1', 'templates: {}', '']).join('\n')
  const parseSettingsText = (text) => parseConfig(text, 'settings')
  const wsOf = (ok) => (ok && ok.ok === true ? ok.value.workspaces : null)

  function makeEnv(opts) {
    const o = opts || {}
    const cwd = o.cwd || 'D:\\ws\\demo'
    const root = o.root === undefined ? 'd:\\ws' : o.root
    const home = o.home || fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-1640-'))
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
    return { mod, ls, calls, logs, home, cwd, root, st, rootTable }
  }
  const readDoc = async (home) => {
    const p = settingsPathIn(home)
    if (!fs.existsSync(p)) return null
    const r = await store.readLocalSettings(home, realIo)
    return (r && r.ok === true) ? r.value : null
  }
  const entryOf = (doc, key) => (doc && doc.workspaces && doc.workspaces[key]) ? doc.workspaces[key] : null
  const wsKeysOf = (doc) => (doc && doc.workspaces ? Object.keys(doc.workspaces) : [])
  const settlement = async (mod) => { await waitFor(() => mod.viewFlagReadyNow() === true); await sleep(0) }
  const diskHas = (home, pred) => async () => { const doc = await readDoc(home); return !!doc && !!pred(doc) }
  const mergeLogs = (logs) => logs.filter((l) => l.event === 'settings.merge')

  // ── 第一件事：临时记录只写用户点过的那一格 ──
  console.log('')
  console.log('== 第一件事：认不出根的名单行点一下开关，文件里只多出那一格（不种缺省、不补另外三个开关） ==')
  const env1 = makeEnv({ cwd: 'D:\\ws\\other', root: '' })
  check(env1.mod.viewFlagWriteKeyOf('D:\\ws\\other') === '', '认不出根时写口没有根键（这条按名单路径记临时记录）。', env1.mod.viewFlagWriteKeyOf('D:\\ws\\other'))
  const wrote1 = env1.mod.setViewFlagValue('D:\\ws\\other', 'statusBar', 'show', true)
  check(wrote1 === true, '名单上的行点开关返回 true（存住了，不是静默失败）。')
  await waitFor(diskHas(env1.home, (doc) => !!entryOf(doc, 'D:\\ws\\other')))
  const temp1 = entryOf(await readDoc(env1.home), 'D:\\ws\\other')
  check(!!temp1 && temp1.statusBar === 'show', '磁盘上这条临时记录记着点过的那一格 statusBar: show。', JSON.stringify(temp1))
  check(!!temp1 && temp1.unopened === true, '这条临时记录带着 unopened 标记（说明还没归到根）。', JSON.stringify(temp1))
  check(!!temp1 && temp1.deckTools === undefined && temp1.noRepoDismissed === undefined && temp1.subwsMarkAutoShown === undefined, '没点过的三格不写（临时记录是稀疏的，不替用户种缺省）。', JSON.stringify(temp1))
  check(wsKeysOf(await readDoc(env1.home)).length === 1, '文件里只有这一条记录。', JSON.stringify(wsKeysOf(await readDoc(env1.home))))
  check(env1.mod.viewFlagOf('D:\\ws\\other', 'deckTools') === undefined, '读口不把「没点过」编成缺省值（没点过就是问不出）。', env1.mod.viewFlagOf('D:\\ws\\other', 'deckTools'))
  const raw1 = fs.readFileSync(settingsPathIn(env1.home), 'utf8')
  check(raw1.indexOf('deckTools:') < 0 && raw1.indexOf('noRepoDismissed:') < 0, '写出去的文件里没有那两行缺省。', raw1.slice(0, 400))
  const round1 = wsOf(parseSettingsText(raw1))
  check(!!round1 && !!round1['D:\\ws\\other'] && Object.keys(round1['D:\\ws\\other']).sort().join(',') === 'statusBar,unopened', '写出去再读回来还是只有点过的那一格加标记。', JSON.stringify(round1))

  // ── 第二件事：认出根以后，临时记录搬成根那一条 ──
  console.log('')
  console.log('== 第二件事：同一个主目录换个能认出根的新实例，临时记录合并成根那一条、文件里只剩一条 ==')
  const env2a = makeEnv({ cwd: 'D:\\ws\\demo', root: '' })
  env2a.mod.setViewFlagValue('D:\\ws\\demo', 'statusBar', 'show', true)
  await waitFor(diskHas(env2a.home, (doc) => !!entryOf(doc, 'D:\\ws\\demo')))
  const env2 = makeEnv({ cwd: 'D:\\ws\\demo', root: 'd:\\ws', home: env2a.home })
  env2.mod.settingsViewLoad()
  await settlement(env2.mod)
  const merged2 = await waitFor(diskHas(env2.home, (doc) => !!entryOf(doc, 'D:\\ws') && !entryOf(doc, 'D:\\ws\\demo')))
  check(merged2, '认出根以后磁盘上出现根那一条、临时那一条不见了。', JSON.stringify(wsKeysOf(await readDoc(env2.home))))
  const doc2 = await readDoc(env2.home)
  const root2 = entryOf(doc2, 'D:\\ws')
  check(wsKeysOf(doc2).length === 1, '合并后文件里只剩一条记录（不留两处分家）。', JSON.stringify(wsKeysOf(doc2)))
  check(!!root2 && root2.statusBar === 'show', '用户点过的格搬上去了（根记录里的 statusBar 是 show）。', JSON.stringify(root2))
  check(!!root2 && root2.deckTools === 'on' && root2.noRepoDismissed === false && root2.subwsMarkAutoShown === false, '普通记录该有的另外几格补齐成缺省。', JSON.stringify(root2))
  check(!!root2 && root2.unopened === undefined, '合并后的记录不再带临时标记。', JSON.stringify(root2))
  const logs2 = mergeLogs(env2.logs)
  check(logs2.length === 1, '合并记了一行日志（settings.merge）。', JSON.stringify(env2.logs.map((l) => l.event)))
  check(logs2.length === 1 && logs2[0].level === 'info' && logs2[0].fields.via === 'load', '日志说明是「设置文档到手」这条路带起来的合并。', JSON.stringify(logs2[0]))
  check(logs2.length === 1 && typeof logs2[0].fields.fields === 'number' && logs2[0].fields.fields === 1, '日志记着这次搬了几格（这里是一格）。', JSON.stringify(logs2[0]))
  check(logs2.length === 1 && String(logs2[0].fields.keyHash).indexOf('h') === 0 && String(logs2[0].fields.rootHash).indexOf('h') === 0, '日志里的两个键都是短散列，不是工作区原始路径。', JSON.stringify(logs2[0]))
  check(env2.mod.viewFlagOf('D:\\ws\\demo', 'statusBar') === 'show' && env2.mod.viewFlagOf('D:\\ws\\demo', 'deckTools') === 'on', '合并后按会话路径读得到根记录的值。', String(env2.mod.viewFlagOf('D:\\ws\\demo', 'deckTools')))

  // ── 第三件事：根记录本来就在时，点过的格覆盖、没点过的格保留 ──
  console.log('')
  console.log('== 第三件事：根记录已经有时，只把点过的格搬上去，根记录里别的选择原样留着 ==')
  const env3 = makeEnv({
    cwd: 'D:\\ws\\demo',
    root: 'd:\\ws',
    seedText: settingsText([
      '  D:\\ws:',
      '    statusBar: hide',
      '    deckTools: off',
      '  D:\\ws\\demo:',
      '    statusBar: show',
      '    unopened: true',
    ]),
  })
  env3.mod.settingsViewLoad()
  await settlement(env3.mod)
  const merged3 = await waitFor(diskHas(env3.home, (doc) => !!entryOf(doc, 'D:\\ws') && !entryOf(doc, 'D:\\ws\\demo')))
  check(merged3, '根记录与临时记录合并成一条。', JSON.stringify(wsKeysOf(await readDoc(env3.home))))
  const doc3 = await readDoc(env3.home)
  const root3 = entryOf(doc3, 'D:\\ws')
  check(wsKeysOf(doc3).length === 1 && !!root3 && root3.statusBar === 'show', '点过的格（statusBar: show）覆盖了根记录里更早的 hide。', JSON.stringify(root3))
  check(!!root3 && root3.deckTools === 'off', '没点过的格不碰：根记录里的 deckTools: off 原样留着（不被缺省盖掉）。', JSON.stringify(root3))
  check(!!root3 && root3.unopened === undefined, '合并后不留临时标记。', JSON.stringify(root3))

  // ── 第四件事：名单路径就是根本身（写法不同）时原地毕业 ──
  console.log('')
  console.log('== 第四件事：临时记录的键与根只是写法不同时原地毕业：键不搬、清标记、补齐普通记录该有的格 ==')
  const env4 = makeEnv({
    cwd: 'D:\\ws',
    root: 'd:\\ws',
    seedText: settingsText([
      '  D:\\ws:',
      '    statusBar: show',
      '    unopened: true',
    ]),
  })
  env4.mod.settingsViewLoad()
  await settlement(env4.mod)
  const graduated4 = await waitFor(diskHas(env4.home, (doc) => !!entryOf(doc, 'D:\\ws') && entryOf(doc, 'D:\\ws').unopened === undefined))
  check(graduated4, '原地毕业：那条记录留在原键上，临时标记清掉了。', JSON.stringify(await readDoc(env4.home)))
  const doc4 = await readDoc(env4.home)
  const root4 = entryOf(doc4, 'D:\\ws')
  check(wsKeysOf(doc4).length === 1, '文件里仍只有一条记录（没有因为写法不同多出一条）。', JSON.stringify(wsKeysOf(doc4)))
  check(!!root4 && root4.statusBar === 'show' && root4.deckTools === 'on' && root4.noRepoDismissed === false && root4.subwsMarkAutoShown === false, '点过的格保留、另外几格补成缺省。', JSON.stringify(root4))

  // ── 第五件事：#1641 旧格式的兜底（值等于种子缺省的不算点过） ──
  console.log('')
  console.log('== 第五件事：#1641 版临时记录把缺省也写了进去，合并时值等于种子缺省的不算用户点过 ==')
  const env5 = makeEnv({
    cwd: 'D:\\ws\\demo',
    root: 'd:\\ws',
    seedText: settingsText([
      '  D:\\ws:',
      '    statusBar: hide',
      '    deckTools: off',
      '  D:\\ws\\demo:',
      '    statusBar: show',
      '    deckTools: on',
      '    noRepoDismissed: false',
      '    subwsMarkAutoShown: false',
      '    unopened: true',
    ]),
  })
  env5.mod.settingsViewLoad()
  await settlement(env5.mod)
  await waitFor(diskHas(env5.home, (doc) => !!entryOf(doc, 'D:\\ws') && !entryOf(doc, 'D:\\ws\\demo')))
  const root5 = entryOf(await readDoc(env5.home), 'D:\\ws')
  check(!!root5 && root5.statusBar === 'show', '旧格式里真点过的那一格（show 与种子 hide 不同）搬上去了。', JSON.stringify(root5))
  check(!!root5 && root5.deckTools === 'off', '旧格式里等于种子缺省的 deckTools: on 不搬，根记录里的 off 不被盖掉。', JSON.stringify(root5))

  // ── 第六件事：写失败不发合并日志，下一趟写成功才发 ──
  console.log('')
  console.log('== 第六件事：合并这一行日志等写成功才发；写被拒时磁盘与日志都不留假话 ==')
  const failHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-1640-fail-'))
  const seedFail = settingsText(['  D:\\ws\\demo:', '    statusBar: show', '    unopened: true'])
  const env6a = makeEnv({ cwd: 'D:\\ws\\demo', root: 'd:\\ws', home: failHome, seedText: seedFail, failMode: 'refuse' })
  env6a.mod.settingsViewLoad()
  await settlement(env6a.mod)
  await sleep(1500)
  check(mergeLogs(env6a.logs).length === 0, '写被拒时一行合并日志都不发（不留「合了」的假话）。', JSON.stringify(env6a.logs.map((l) => l.event)))
  const doc6a = await readDoc(failHome)
  check(!!entryOf(doc6a, 'D:\\ws\\demo') && entryOf(doc6a, 'D:\\ws\\demo').unopened === true, '写被拒时磁盘上的临时记录原样留着（等下一趟再合）。', JSON.stringify(doc6a))
  const env6b = makeEnv({ cwd: 'D:\\ws\\demo', root: 'd:\\ws', home: failHome })
  env6b.mod.settingsViewLoad()
  await settlement(env6b.mod)
  await waitFor(diskHas(failHome, (doc) => !!entryOf(doc, 'D:\\ws') && !entryOf(doc, 'D:\\ws\\demo')))
  const logs6b = mergeLogs(env6b.logs)
  check(logs6b.length === 1, '换一趟能写的实例后写成功，合并日志这时才发出来。', JSON.stringify(env6b.logs.map((l) => l.event)))

  // ── 第七件事：认出根那一下（root 路）也能合，接线还在源码里 ──
  console.log('')
  console.log('== 第七件事：刚认出工作区根那一下调合并（root 路），以及两处接线在源码里没被删掉 ==')
  const env7 = makeEnv({ cwd: 'D:\\ws\\demo', root: '' })
  env7.mod.setViewFlagValue('D:\\ws\\demo', 'statusBar', 'show', true)
  await waitFor(diskHas(env7.home, (doc) => !!entryOf(doc, 'D:\\ws\\demo')))
  await env7.mod.settingsViewLoad()
  await settlement(env7.mod)
  env7.st.sessionWorkspaceRoot = 'd:\\ws'
  const merged7 = env7.mod.viewFlagMergeNow('root')
  check(merged7 === 1, '认出根那一下调合并，返回合并了 1 条。', String(merged7))
  const disk7 = await waitFor(diskHas(env7.home, (doc) => !!entryOf(doc, 'D:\\ws') && !entryOf(doc, 'D:\\ws\\demo')))
  check(disk7, 'root 路合并后落盘：根那一条在、临时那一条没了。', JSON.stringify(wsKeysOf(await readDoc(env7.home))))
  const logs7 = mergeLogs(env7.logs)
  check(logs7.length === 1 && logs7[0].fields.via === 'root', 'root 路带起来的合并日志写明 via: root。', JSON.stringify(logs7[0]))
  const storeSrc = readText('src/refresh/rooms/client/snapshot-cache-store.ts')
  check(storeSrc.indexOf("viewFlagMergeNow('root')") >= 0, 'snapshot-cache-store 里「刚认出根」那一下仍调着合并。')
  const viewSrc = readText('src/client/kernel/settings-view.ts')
  check(viewSrc.indexOf("viewFlagMergeDoc(viewFlagState.doc, 'load')") >= 0, '设置文档到手那一下仍调着合并。')

  console.log('')
  console.log('通过 ' + passed + ' 条，失败 ' + failed + ' 条。')
  printGateResult('verify-1640-unopened-merge', passed + failed, failed)
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
