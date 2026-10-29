/**
 * #1642 门禁：设置页两个文字开关（胶囊状态栏、deck 工具箱）点一下以后，每一步都留一行日志。
 *
 * 这张票要守住的三件事
 *   一、点一下这条路上每一步都留一行 settings.toggle：名字不认识、值不认识、认不出工作区根、文档还在路上
 *       （先进队列）、文档到手并进内存文档、真写进文件、写被拒、写的过程中抛错 —— 每一步一个 reason，
 *       同一趟按时间顺序读下去就知道用户那一下停在哪一步（「点了没反应」不用再到现场猜）。
 *   二、临时记录合并这一路写不进文件时补一行告警 settings.merge.fail：settings.merge 只在这趟写成功之后才发，
 *       写失败时盘上还留着一处分家，这件事也要能事后看见；每条临时记录只报一次，下一趟写成功仍按原约定发
 *       settings.merge。
 *   三、两行日志的字段都只落在白名单那几格里：工作区键只记短散列，不记原始路径。
 *
 * 怎么跑：node --import ./scripts/ts-hook.mts tests/verify-1642-toggle-logs.ts
 * 做法与 verify-1640 一致：把设置相关的三片内核按构建次序拼起来造全新实例，真文件读写落在临时目录里。
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
// 一份「文档在手、但写不进工作区那一节」的假文档：workspaces 的写口一碰就抛错，
//   用来模拟形状对不上（真核归一之后正常路径到不了这一档，本门禁要守住的是这一档仍留一行日志）。
function brokenDoc() {
  const workspaces = new Proxy({}, { set: function () { throw new Error('frozen') } })
  return { version: 1, ui: {}, workspaces: workspaces, debug: { enabled: false, sampleRate: 1 }, templates: {} }
}
// 宿主电话的几种故障档：refuse＝文件被拒（更高版本）、reject＝写的过程中抛错、
//   readonly-get＝读回来的是更高版本的文件、get-fail＝读电话失败、doc-broken＝读回来的文档写不进工作区节。
function makeHost(phones, calls, failMode) {
  return {
    call: function (method, args) {
      calls.push({ method: method, args: args })
      if (method === 'wf.getSettings') {
        if (failMode === 'readonly-get') return Promise.resolve({ ok: true, readonly: true, value: { version: 1 } })
        if (failMode === 'get-fail') return Promise.resolve({ ok: false, error: { kind: 'environment', message: '这台机器上没有设置后端' } })
        if (failMode === 'doc-broken') return Promise.resolve({ ok: true, value: brokenDoc() })
        return phones.handleGetSettings(args || {})
      }
      if (method === 'wf.setSettings') {
        if (failMode === 'refuse') return Promise.resolve({ ok: false, error: { kind: 'readonly', message: '这份本机设置文件是新版本插件写的，当前插件不许写回去。' } })
        if (failMode === 'reject') return Promise.reject(new Error('写的过程中抛错了'))
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
  console.log('#1642 设置页两个文字开关点按与临时记录合并两条路都留常驻日志')
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
    const cwd = o.cwd || 'D:/ws/demo'
    const root = o.root === undefined ? 'd:/ws' : o.root
    const home = o.home || fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-1642-'))
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
    return { mod, ls, calls, host, logs, home, cwd, root, st, rootTable }
  }
  const readDoc = async (home) => {
    const p = settingsPathIn(home)
    if (!fs.existsSync(p)) return null
    const r = await store.readLocalSettings(home, realIo)
    return (r && r.ok === true) ? r.value : null
  }
  const onlyEntry = (doc) => { const ks = (doc && doc.workspaces) ? Object.keys(doc.workspaces) : []; return ks.length === 1 ? doc.workspaces[ks[0]] : null }
  const wsKeysOf = (doc) => (doc && doc.workspaces ? Object.keys(doc.workspaces) : [])
  const settlement = async (mod) => { await waitFor(() => mod.viewFlagReadyNow() === true); await sleep(0) }
  const diskHas = (home, pred) => async () => { const doc = await readDoc(home); return !!doc && !!pred(doc) }
  const toggleLogs = (logs) => logs.filter((l) => l.event === 'settings.toggle')
  const mergeLogs = (logs) => logs.filter((l) => l.event === 'settings.merge')
  const failLogs = (logs) => logs.filter((l) => l.event === 'settings.merge.fail')

  // ── 第一件事：连队列都没进的三种拒绝也各记一行 ──
  console.log('')
  console.log('== 第一件事：名字不认识、值不认识、认不出根 —— 这几种「没接住」也各记一行，说清为什么 ==')
  const envA = makeEnv({ cwd: 'D:/ws/other', root: '' })
  const a1 = envA.mod.setViewFlagValue('D:/ws/other', 'notAFlag', 'show', true)
  check(a1 === false, '名字不是这两格之一时不接（返回 false）。', String(a1))
  const ta = toggleLogs(envA.logs)
  check(ta.length === 1 && ta[0].fields.reason === 'unknown-flag', '名字不认识也记一行，reason 写明 unknown-flag。', JSON.stringify(ta))
  check(ta.length === 1 && ta[0].fields.ok === false && ta[0].fields.flag === 'notAFlag' && ta[0].fields.value === 'show' && ta[0].fields.listed === true, '这一行记着点的哪一格、点成什么、是不是名单上的行、成没成。', JSON.stringify(ta[0]))
  const a2 = envA.mod.setViewFlagValue('D:/ws/other', 'statusBar', 'bogus', true)
  check(a2 === false, '值不在允许的几个字面量里时不接（返回 false）。', String(a2))
  const ta2 = toggleLogs(envA.logs)
  check(ta2.length === 2 && ta2[1].fields.reason === 'bad-value', '值不认识也记一行，reason 写明 bad-value。', JSON.stringify(ta2[1]))
  const a3 = envA.mod.setViewFlagValue('D:/ws/other', 'statusBar', 'show')
  check(a3 === false, '认不出工作区根又不在名单上时不接（返回 false）。', String(a3))
  const ta3 = toggleLogs(envA.logs)
  check(ta3.length === 3 && ta3[2].fields.reason === 'no-root', '认不出根也记一行，reason 写明 no-root。', JSON.stringify(ta3[2]))

  // ── 第二件事：文档还在路上 → 并进内存文档 → 真写进文件 ──
  console.log('')
  console.log('== 第二件事：文档还在路上就点，先记 deferred；文档到手并进内存文档记 queued；真写进文件记 written ==')
  const envB = makeEnv({ cwd: 'D:/ws/demo', root: 'd:/ws' })
  envB.mod.settingsViewLoad()
  const b1 = envB.mod.setViewFlagValue('D:/ws/demo', 'statusBar', 'show')
  check(b1 === true, '文档还在路上时也接住这一笔（返回 true，先进队列）。', String(b1))
  const tb1 = toggleLogs(envB.logs)
  check(tb1.length === 1 && tb1[0].fields.reason === 'deferred' && tb1[0].fields.ok === true, '先记一行 deferred，说明这一笔停在「等文档」这一步。', JSON.stringify(tb1))
  await settlement(envB.mod)
  const wroteB = await waitFor(() => toggleLogs(envB.logs).some((l) => l.fields.reason === 'written'))
  check(wroteB, '写进文件那一刻记一行 written。', JSON.stringify(toggleLogs(envB.logs).map((l) => l.fields.reason)))
  const rb = toggleLogs(envB.logs).map((l) => l.fields.reason)
  check(rb.join(',') === 'deferred,queued,written', '同一趟按时间顺序读下去就是 deferred → queued → written。', rb.join(','))
  const eB = onlyEntry(await readDoc(envB.home))
  check(!!eB && eB.statusBar === 'show', '用户点成的那一格真写进了文件。', JSON.stringify(eB))

  // ── 第三件事：名单行认不出根，按名单路径先记临时记录 ──
  console.log('')
  console.log('== 第三件事：设置页名单上还没打开过的行（认不出根）也留一行，记着它带临时标记 ==')
  const envC = makeEnv({ cwd: 'D:/ws/other', root: '' })
  envC.mod.settingsViewLoad()
  const c1 = envC.mod.setViewFlagValue('D:/ws/other', 'statusBar', 'show', true)
  check(c1 === true, '名单行认不出根时按名单路径先接住（返回 true）。', String(c1))
  const tc = toggleLogs(envC.logs)
  check(tc.length === 1 && tc[0].fields.reason === 'deferred' && tc[0].fields.listed === true, '这一行记着 listed: true，说明按名单路径先记临时记录。', JSON.stringify(tc))
  check(tc.length === 1 && String(tc[0].fields.cwdHash).indexOf('h') === 0, '工作区键只记短散列，不记路径原文。', JSON.stringify(tc[0].fields))
  await settlement(envC.mod)
  await waitFor(diskHas(envC.home, (doc) => !!onlyEntry(doc) && onlyEntry(doc).unopened === true))
  const eC = onlyEntry(await readDoc(envC.home))
  check(!!eC && eC.statusBar === 'show' && eC.unopened === true, '盘上这条临时记录记着点过的格与临时标记。', JSON.stringify(eC))
  check(toggleLogs(envC.logs).map((l) => l.fields.reason).join(',') === 'deferred,queued,written', '名单行这一趟也是 deferred → queued → written 三行。', toggleLogs(envC.logs).map((l) => l.fields.reason).join(','))

  // ── 第四件事：文件是更高版本写的（readonly） ──
  console.log('')
  console.log('== 第四件事：文件是更高版本插件写的（readonly）时，等在路上的与直接点的都记 readonly ==')
  const envD1 = makeEnv({ cwd: 'D:/ws/demo', root: 'd:/ws', failMode: 'readonly-get' })
  envD1.mod.settingsViewLoad()
  envD1.mod.setViewFlagValue('D:/ws/demo', 'statusBar', 'show')
  await settlement(envD1.mod)
  const rd1 = toggleLogs(envD1.logs).map((l) => l.fields.reason)
  check(rd1.join(',') === 'deferred,readonly', '等在路上的那一笔，文档到手后发现不许写：第二行 reason 是 readonly。', rd1.join(','))
  const envD2 = makeEnv({ cwd: 'D:/ws/demo', root: 'd:/ws', failMode: 'readonly-get' })
  envD2.mod.settingsViewLoad()
  await settlement(envD2.mod)
  const d2 = envD2.mod.setViewFlagValue('D:/ws/demo', 'statusBar', 'show')
  check(d2 === false, '已经知道不许写时，点一下直接回 false。', String(d2))
  const td2 = toggleLogs(envD2.logs)
  check(td2.length === 1 && td2[0].fields.reason === 'readonly', '直接记一行 readonly。', JSON.stringify(td2))

  // ── 第五件事：问不到文档（unavailable） ──
  console.log('')
  console.log('== 第五件事：这台机器上问不到设置文档时记 unavailable ==')
  const envE = makeEnv({ cwd: 'D:/ws/demo', root: 'd:/ws', failMode: 'get-fail' })
  envE.mod.settingsViewLoad()
  await settlement(envE.mod)
  const e1 = envE.mod.setViewFlagValue('D:/ws/demo', 'statusBar', 'show')
  check(e1 === false, '问不到文档时点一下回 false（界面会提示没接住）。', String(e1))
  const te = toggleLogs(envE.logs)
  check(te.length === 1 && te[0].fields.reason === 'unavailable', '记一行 unavailable，说明停在这台机器上问不到设置文档。', JSON.stringify(te))

  // ── 第六件事：合并结果写不进文件时补一行告警 ──
  console.log('')
  console.log('== 第六件事：合并结果写不进文件时补一行 settings.merge.fail；下一趟写成功仍按原约定发 settings.merge ==')
  const failHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-1642-fail-'))
  const seedF = settingsText(['  D:/ws/demo:', '    statusBar: show', '    unopened: true'])
  const envF = makeEnv({ cwd: 'D:/ws/demo', root: 'd:/ws', home: failHome, seedText: seedF, failMode: 'refuse' })
  envF.mod.settingsViewLoad()
  await settlement(envF.mod)
  await waitFor(() => failLogs(envF.logs).length > 0)
  check(mergeLogs(envF.logs).length === 0, '写被拒时一行 settings.merge 都不发（不留「合了」的假话）。', JSON.stringify(envF.logs.map((l) => l.event)))
  const f1 = failLogs(envF.logs)
  check(f1.length === 1 && f1[0].fields.reason === 'write-refused', '补一行 settings.merge.fail，reason 写明 write-refused。', JSON.stringify(f1))
  check(f1.length === 1 && f1[0].level === 'warn' && f1[0].fields.via === 'load' && f1[0].fields.fields === 1, '这一行是告警级，记着哪条路带起来的合并（load）与搬了几格（1）。', JSON.stringify(f1[0]))
  check(f1.length === 1 && String(f1[0].fields.keyHash).indexOf('h') === 0 && String(f1[0].fields.rootHash).indexOf('h') === 0, '两个工作区键都只记短散列。', JSON.stringify(f1[0].fields))
  const docF = await readDoc(failHome)
  check(!!onlyEntry(docF) && onlyEntry(docF).unopened === true, '写被拒时盘上的临时记录原样留着，等下一趟再合。', JSON.stringify(docF))
  const envF2 = makeEnv({ cwd: 'D:/ws/demo', root: 'd:/ws', home: failHome })
  envF2.mod.settingsViewLoad()
  await settlement(envF2.mod)
  await waitFor(diskHas(failHome, (doc) => !!onlyEntry(doc) && onlyEntry(doc).unopened === undefined))
  check(mergeLogs(envF2.logs).length === 1, '下一趟写成功后仍按原约定发一行 settings.merge。', JSON.stringify(envF2.logs.map((l) => l.event)))
  check(failLogs(envF2.logs).length === 0, '写成功时不发 settings.merge.fail。', JSON.stringify(failLogs(envF2.logs)))

  // ── 第七件事：写被拒时点按这一路也要留一行 ──
  console.log('')
  console.log('== 第七件事：点一下以后这一趟写被拒 / 写的过程中抛错 / 宿主不在，各留一行说明停在写这一步 ==')
  const envF3 = makeEnv({ cwd: 'D:/ws/demo', root: 'd:/ws', home: fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-1642-refused-')), failMode: 'refuse' })
  envF3.mod.settingsViewLoad()
  await settlement(envF3.mod)
  envF3.mod.setViewFlagValue('D:/ws/demo', 'statusBar', 'show')
  const rF3 = await waitFor(() => toggleLogs(envF3.logs).some((l) => l.fields.reason === 'write-refused'))
  check(rF3, '写被拒时补一行 toggle，reason 写明 write-refused。', JSON.stringify(toggleLogs(envF3.logs).map((l) => l.fields.reason)))

  const homeG = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-1642-err-'))
  const envG = makeEnv({ cwd: 'D:/ws/demo', root: 'd:/ws', home: homeG, seedText: seedF, failMode: 'reject' })
  envG.mod.settingsViewLoad()
  await settlement(envG.mod)
  await waitFor(() => failLogs(envG.logs).length > 0)
  const g1 = failLogs(envG.logs)
  check(g1.length === 1 && g1[0].fields.reason === 'write-error', '写的过程中抛错时补一行 merge.fail，reason 写明 write-error。', JSON.stringify(g1))
  check(mergeLogs(envG.logs).length === 0, '抛错时同样不发 settings.merge。', JSON.stringify(envG.logs.map((l) => l.event)))
  const envG2 = makeEnv({ cwd: 'D:/ws/demo', root: 'd:/ws', home: fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-1642-reject-')), failMode: 'reject' })
  envG2.mod.settingsViewLoad()
  await settlement(envG2.mod)
  envG2.mod.setViewFlagValue('D:/ws/demo', 'statusBar', 'show')
  const rG2 = await waitFor(() => toggleLogs(envG2.logs).some((l) => l.fields.reason === 'write-error'))
  check(rG2, '写的过程中抛错时补一行 toggle，reason 写明 write-error。', JSON.stringify(toggleLogs(envG2.logs).map((l) => l.fields.reason)))

  const homeH = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-1642-hostless-'))
  const envH = makeEnv({ cwd: 'D:/ws/demo', root: 'd:/ws', home: homeH, seedText: seedF })
  envH.mod.settingsViewLoad()
  await settlement(envH.mod)
  envH.host.call = undefined
  await waitFor(() => failLogs(envH.logs).length > 0)
  const h1 = failLogs(envH.logs)
  check(h1.length === 1 && h1[0].fields.reason === 'host-missing', '宿主不在这台机器上时补一行 merge.fail，reason 写明 host-missing。', JSON.stringify(h1))
  const envH2 = makeEnv({ cwd: 'D:/ws/demo', root: 'd:/ws', home: fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-1642-nohost-')) })
  envH2.mod.settingsViewLoad()
  await settlement(envH2.mod)
  envH2.mod.setViewFlagValue('D:/ws/demo', 'statusBar', 'show')
  envH2.host.call = undefined
  const rH2 = await waitFor(() => toggleLogs(envH2.logs).some((l) => l.fields.reason === 'host-missing'))
  check(rH2, '宿主不在这台机器上时补一行 toggle，reason 写明 host-missing。', JSON.stringify(toggleLogs(envH2.logs).map((l) => l.fields.reason)))

  // ── 第八件事：文档在手但写不进工作区节（doc-fail） ──
  console.log('')
  console.log('== 第八件事：文档形状对不上、写不进工作区节时记 doc-fail ==')
  const envI = makeEnv({ cwd: 'D:/ws/demo', root: 'd:/ws', failMode: 'doc-broken' })
  envI.mod.settingsViewLoad()
  await settlement(envI.mod)
  const i1 = envI.mod.setViewFlagValue('D:/ws/demo', 'statusBar', 'show')
  check(i1 === false, '文档在手但形状对不上写不进去时回 false。', String(i1))
  const ti = toggleLogs(envI.logs)
  check(ti.length === 1 && ti[0].fields.reason === 'doc-fail', '记一行 doc-fail。', JSON.stringify(ti))

  // ── 第九件事：两行日志的字段与结论只落白名单里那一套 ──
  console.log('')
  console.log('== 第九件事：所有 toggle 与 merge.fail 行的字段只落在白名单里，结论不出枚举 ==')
  const envs = [envA, envB, envC, envD1, envD2, envE, envF, envF2, envF3, envG, envG2, envH, envH2, envI]
  const allToggle = envs.reduce((acc, e) => acc.concat(toggleLogs(e.logs)), [])
  const allFail = envs.reduce((acc, e) => acc.concat(failLogs(e.logs)), [])
  const TOGGLE_KEYS = ['cwdHash', 'flag', 'listed', 'ok', 'reason', 'value'].join(',')
  const FAIL_KEYS = ['fields', 'keyHash', 'reason', 'rootHash', 'via'].join(',')
  const keysOf = (f) => Object.keys(f).sort().join(',')
  check(allToggle.length > 0 && allToggle.every((l) => keysOf(l.fields) === TOGGLE_KEYS), '所有 settings.toggle 行都只带白名单里那六格字段。', JSON.stringify(allToggle.map((l) => keysOf(l.fields)).slice(0, 5)))
  check(allToggle.every((l) => l.level === 'info' && l.event === 'settings.toggle'), '所有 toggle 行都是信息级、事件名一致。')
  check(allToggle.every((l) => String(l.fields.cwdHash).indexOf('h') === 0 && String(l.fields.cwdHash).indexOf('/') < 0 && String(l.fields.cwdHash).indexOf('\\') < 0), '所有 toggle 行的 cwdHash 都是短散列，不含路径分隔符。')
  const gotReasons = []
  allToggle.forEach((l) => { if (gotReasons.indexOf(l.fields.reason) < 0) gotReasons.push(l.fields.reason) })
  const wantReasons = ['unknown-flag', 'bad-value', 'no-root', 'deferred', 'queued', 'written', 'readonly', 'unavailable', 'doc-fail', 'host-missing', 'write-refused', 'write-error']
  check(wantReasons.every((r) => gotReasons.indexOf(r) >= 0) && gotReasons.every((r) => wantReasons.indexOf(r) >= 0), '十三种结论里除兜底 catch 的 error 之外的十二种都在本门禁里真跑出来过，且没有多出来的结论。', JSON.stringify(gotReasons))
  check(allFail.length > 0 && allFail.every((l) => keysOf(l.fields) === FAIL_KEYS), '所有 settings.merge.fail 行都只带白名单里那五格字段。', JSON.stringify(allFail.map((l) => keysOf(l.fields))))
  check(allFail.every((l) => l.level === 'warn'), '所有 merge.fail 行都是告警级。')
  check(allFail.every((l) => String(l.fields.keyHash).indexOf('h') === 0 && String(l.fields.rootHash).indexOf('h') === 0), '所有 merge.fail 行的两个工作区键都只记短散列。')

  // ── 第十件事：源码里的接线还在（事件登记、白名单、附录） ──
  console.log('')
  console.log('== 第十件事：两行日志的发出口、事件清单登记、字段白名单与日志附录都还在 ==')
  const viewSrc = readText('src/client/kernel/settings-view.ts')
  check(viewSrc.indexOf("'settings.toggle'") >= 0, '设置页读侧源码里发着 settings.toggle 事件。')
  check(viewSrc.indexOf('viewFlagLogToggle') >= 0, '设置页读侧的日志助手还在。')
  const writeSrc = readText('src/client/kernel/settings-view-write.ts')
  check(viewSrc.indexOf("'settings.merge.fail'") >= 0, '设置页读侧源码里发着 settings.merge.fail 事件。')
  check(writeSrc.indexOf('viewFlagLogMergeFail') >= 0, '写这一趟没成时仍调合并失败告警助手。')
  check(writeSrc.indexOf("'error', cwd") >= 0, '写一格这条路的兜底 catch 仍会记下 error 这个结论。')
  const listSrc = readText('src/shared/log-event-list.ts')
  check(listSrc.indexOf("'settings.toggle'") >= 0, '常驻事件清单登记了 settings.toggle。')
  check(listSrc.indexOf("'settings.merge'") >= 0, '常驻事件清单登记了 settings.merge。')
  const fieldsSrc = readText('tests/verify-log-fields.ts')
  check(fieldsSrc.indexOf("'settings.toggle'") >= 0 && fieldsSrc.indexOf("'settings.merge.fail'") >= 0, '字段白名单门禁登记了这两条事件的字段。')
  const countSrc = readText('tests/verify-log-count.ts')
  check(countSrc.indexOf("'settings.toggle'") >= 0 && countSrc.indexOf("'settings.merge.fail'") >= 0, '事件清单门禁登记了这两条常驻事件。')
  const appendixSrc = readText('research/489-appendix.md')
  check(appendixSrc.indexOf('settings.toggle') >= 0 && appendixSrc.indexOf('settings.merge.fail') >= 0, '日志附录里有这两条事件的对照行。')

  console.log('')
  console.log('通过 ' + passed + ' 条，失败 ' + failed + ' 条。')
  printGateResult('verify-1642-toggle-logs', passed + failed, failed)
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
