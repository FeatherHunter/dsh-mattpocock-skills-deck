#!/usr/bin/env node
/**
 * verify-settings-templates.js —— 11 条动作模板搬进本机设置文件 templates 节的门禁（#1012 第 4 步）。
 *
 * 这一份门禁只量八件事，每一件都用完整的一句话说清，第一次读的人能直接看懂。
 * 第一件事是文件里那一格有非空文字时以文件为准：文档到手之后读口给出的就是文件里那一份。
 * 第二件事是文件里没这一格时回退旧键那份快照：老用户存在 localStorage 里的模板照旧对动作按钮生效。
 * 第三件事是文件里写成空串时保留旧键那一份：空串在核的语义里是「这一格用默认文本」，不是一份值，
 *   拿它去顶掉旧存档里改过的模板等于把用户改过的白改。
 * 第四件事是写进文件成功之后旧 localStorage 键一个字节都不写：两处都写就是两份真相。
 * 第五件事是文档还在路上时先记着不写：这一笔排进待写队列，文档一到手就落进文件的 templates 节。
 * 第六件事是写不进文件（手机自己坏了、或文件是更高版本不许写回去）时照老办法整份写回旧键兜底，
 *   而且用户当场看到的值不变（内存这一份不回退成文件里的旧值）。
 * 第七件事是两个旧存档键（dsws.cfg 与 dsws.startCfg）都不再被读、不再被写：按 #1012 定案第 10、11 条，
 *   它们连同各自的迁移逻辑一起删除，本地存档里残留的旧值对读口没有任何影响。
 * 第八件事是默认文本兜底不回归：两处都没有这一格时读口给的还是 config.js 里那份默认文本。
 *
 * 怎么保证量的是真件：客户端那几片（src/client/kernel/config.js、settings-view-state.js、
 *   settings-view.js、settings-view-write.js、settings-ui.js 与 settings-templates.js）的真源按构建同一种
 *   做法、同一次序拼起来当场造出函数来跑（次序与 scripts/build.mjs 的清单一致：config.js 在设置文件那一族
 *   之前，模板那一片排在写这一片之后 —— 这一片的加载时机正是这次要验的东西之一）。
 *   它打的宿主那两条电话（wf.getSettings / wf.setSettings）用的是 src/host/settingsPhones.js 与
 *   src/host/configStore.js 的真实现，读写落在系统临时目录里的真文件上 —— 只有手机（假 host 的 call）、
 *   内存里的 localStorage 与「可以按需制造写失败」的那层文件包装是替身。
 * 本门禁自己先跑一次 node scripts/build.mjs：这一片的运行时形状来自拼接，不跑构建就证明不了它真的进了双产物。
 *
 * 用法：node tests/verify-settings-templates.js（在插件根目录；本脚本自己会先构建）
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const { spawnSync } = require('child_process')
const realFs = require('node:fs/promises')
const { compileFn } = require('./lib/eval-probe.js')
// 完成证据（#1158）：收尾交一行 GATE-RESULT，执行器据此判「跑完了没有」。
const { printGateResult } = require('./lib/gate-result.ts')
// 防抖窗口是五百毫秒，这一份门禁里有十几处等它落地；接上虚拟时钟把等待压成几毫秒，
//   断言一条没动（为什么这么压是安全的见 tests/lib/time-compress.js 文件头）。
const { installTimeCompression, uninstallTimeCompression } = require('./lib/time-compress.js')
installTimeCompression()

const ROOT = path.resolve(__dirname, '..')
let passed = 0
let failed = 0
const check = (ok, msg, detail) => {
  if (ok) { console.log('  PASS ' + msg); passed += 1 } else { console.log('  FAIL ' + msg + (detail ? ' —— ' + String(detail).slice(0, 300) : '')); failed += 1 }
}
const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const countLines = (rel) => readText(rel).split(/\r?\n/).length
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const makeHome = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tpl-' + tag + '-'))
const settingsPathIn = (home) => path.join(home, '.dsh', 'mattskillsdeck', 'settings.yaml')
const noExport = (s) => s.replace(/^\s*export\s+/gm, '')

// 真的文件读写口（核要的那四个动作），门禁里读写落在临时目录的真文件上。
const realIo = {
  readText: (p) => realFs.readFile(String(p), 'utf8'),
  writeText: (p, t) => realFs.writeFile(String(p), String(t), 'utf8'),
  mkdir: (p) => realFs.mkdir(String(p), { recursive: true }),
  rm: (p) => realFs.unlink(String(p)),
}
// 记录型系统文件：包一层真文件，既落真盘又能制造写失败（与 verify-settings-view.js 同一手法）。
function wrapSysFs(calls, overrides) {
  return {
    async readFile(p, enc) { calls.push({ name: 'readFile', path: String(p) }); if (overrides && overrides.readFile) return overrides.readFile(p, enc); return realFs.readFile(p, enc) },
    async writeFile(p, text, enc) { calls.push({ name: 'writeFile', path: String(p) }); if (overrides && overrides.writeFile) return overrides.writeFile(p, text, enc); return realFs.writeFile(p, text, enc) },
    async mkdir(p, opts) { calls.push({ name: 'mkdir', path: String(p) }); if (overrides && overrides.mkdir) return overrides.mkdir(p, opts); return realFs.mkdir(p, opts) },
    async unlink(p) { calls.push({ name: 'unlink', path: String(p) }); if (overrides && overrides.unlink) return overrides.unlink(p); return realFs.unlink(p) },
  }
}
function failCode(code, msg) { const e = new Error(msg || String(code)); e.code = code; return e }

// 假的一台手机：把两条设置电话接到真实现上；failMode 用来制造「手机说不行」与「手机自己坏了」两种失败。
function makeHost(phones, calls, failMode) {
  return {
    call: function (method, args) {
      calls.push({ method: method, args: args })
      if (method === 'wf.getSettings') return phones.handleGetSettings(args || {})
      if (method === 'wf.setSettings') {
        if (failMode === 'throw') return Promise.reject(new Error('这台手机自己坏了'))
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
// store-prefs.js 里「主列表偏好」那一段的真源码（LIST_PREFS_KEY / listPrefs / saveListPrefsLegacy）：
//   与界面偏好那一族同住一片，拼这一个闭包时按构建次序要带上它（settings-ui.js 要用那两个名字）。
function listPrefsSlice() {
  const src = readText('src/client/kernel/store-prefs.js')
  const start = src.indexOf('// #374：主列表偏好')
  const end = src.indexOf('// #375：label 点击记忆')
  if (start < 0 || end <= start) throw new Error('store-prefs.js 里找不到主列表偏好那一段（#374 到 #375 之间）')
  return noExport(src.slice(start, end))
}
// 被测那几片：按 scripts/build.mjs 那一次序拼（config.js 在设置文件那一族之前，模板那一片在写那一片之后）。
const CONFIG_REL = 'src/client/kernel/config.js'
const TPL_REL = 'src/client/kernel/settings-templates.js'
const VIEW_REL = 'src/client/kernel/settings-view.js'
const VIEW_STATE_REL = 'src/client/kernel/settings-view-state.js'
const VIEW_WRITE_REL = 'src/client/kernel/settings-view-write.js'
const UI_REL = 'src/client/kernel/settings-ui.js'
function makeClient(env) {
  const body = [noExport(readText(CONFIG_REL)), listPrefsSlice(), noExport(readText(VIEW_STATE_REL)), noExport(readText(VIEW_REL)), noExport(readText(VIEW_WRITE_REL)), noExport(readText(UI_REL)), noExport(readText(TPL_REL))].join('\n')
  const names = ['keyOf', 'wsKeyOf', 'shared', 'stores', 'emit', 'host', 'localStorage', 'log', 'dswsLogHash', 'timer', 'currentOs', 'workspaceRootByCwd', 'promptText', 'promptTextFor']
  const tail = '\nreturn { TPL_KEY: TPL_KEY, templates: templates, saveTemplates: saveTemplates, tplText: tplText, TPL_DEFAULT: TPL_DEFAULT, settingsViewLoad: settingsViewLoad, viewFlagReadyNow: viewFlagReadyNow, settingsTemplatesSaveAll: settingsTemplatesSaveAll, settingsTemplatesSetInDoc: settingsTemplatesSetInDoc, VIEW_FLAG_WRITE_DEBOUNCE_MS: VIEW_FLAG_WRITE_DEBOUNCE_MS }'
  return compileFn(names, body + tail).apply(null, names.map((n) => env[n]))
}
// 一份空文档（形状与核归一之后那一份逐字一致），templates 节按用例预置。
const docWith = (templates) => ({ version: 1, ui: { stateFilter: '', sortKey: '', sortDir: '', labelClicks: {} }, workspaces: {}, debug: { enabled: false, sampleRate: 1 }, templates: templates || {} })

async function main() {
  console.log('11 条动作模板搬进本机设置文件 templates 节门禁（#1012 第 4 步：读以文件为准、写进文件、旧键兜底）')

  // ── 第零件事：先构建，并确认这一片真的进了双产物 ──
  console.log('')
  console.log('== 第零件事：先跑构建（这一片的运行时形状来自拼接，不构建就证明不了它进了产物） ==')
  {
    const r = spawnSync(process.execPath, [path.join('scripts', 'build.mjs')], { cwd: ROOT, stdio: 'inherit' })
    check(r.status === 0, 'node scripts/build.mjs 构建通过。', '退出码 ' + String(r.status))
    for (const rel of ['client.js', 'package/lib/client.js']) {
      const t = fs.existsSync(path.join(ROOT, rel)) ? readText(rel) : ''
      check(t.indexOf('const TPL_SETTING_NAMES =') >= 0 && t.indexOf('const settingsTemplatesSaveAll = function') >= 0,
        rel + ' 里拼进了模板这一片（清单与整份保存两个东西都在，才算真接上）。')
      check(t.indexOf('const settingsTemplatesAdoptFromDoc = function') > t.indexOf('const viewFlagWriteNow = function'),
        rel + ' 里模板这一片排在写这一趟之后（它要用那一片的待写队列与排期）。')
      check(t.indexOf('settingsTemplates (spliced') < 0, rel + ' 里没有留下模板这一片的拼接标记（拼进去了）。')
    }
  }

  // 真件：宿主的核与两条电话
  const leaf = await import(pathToFileURL(path.join(ROOT, 'src/host', 'settingsPhones.js')).href)
  const store = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'configStore.js')).href)
  const KEY_OF = compileFn([], readText('src/shared/workspaceKey.js').replace(/^\s*export\s+/gm, '') + '\nreturn keyOf')()
  const CURRENT_OS = compileFn([], readText('src/shared/workspaceKey.js').replace(/^\s*export\s+/gm, '') + '\nreturn currentOs')()
  // 一个场景的全套夹具：临时主目录（可以指定复用同一份盘上文件）、假手机、假 localStorage。
  function makeEnv(opts) {
    const o = opts || {}
    const home = o.home || makeHome(o.tag || 'case')
    const ls = makeLocalStorage(o.localStorage)
    const fnCalls = []
    const phones = leaf.createSettingsPhones({
      getPlatform: async () => ({ getHome: async () => home }),
      readLocalSettings: store.readLocalSettings,
      writeLocalSettings: store.writeLocalSettings,
      fs: wrapSysFs(fnCalls, o.fsOverrides || null),
      logCtx: null,
    })
    const calls = []
    const host = o.noHost ? undefined : makeHost(phones, calls, o.failMode)
    const logs = []
    const mod = makeClient({
      keyOf: KEY_OF,
      wsKeyOf: function (c) { return KEY_OF(c) || '' },
      workspaceRootByCwd: {},
      shared: null,
      stores: {},
      emit: function () {},
      host: host,
      localStorage: ls,
      log: function (level, event, fields) { logs.push({ level: level, event: event, fields: fields }) },
      dswsLogHash: function (s) { return 'h' + String(s || '').length },
      timer: undefined,
      currentOs: CURRENT_OS,
      // config.js 里那份默认文本（TPL_DEFAULT）走的就是这两个口子；这里给一份一眼认得出的替身，
      //   为的是把「两处都没有这一格时用的就是默认文本」这条量成「回的是这一份」，而不是量成非空。
      promptText: function (id) { return 'DEF:' + id },
      promptTextFor: function (st, id) { return 'DEF:' + id },
    })
    return { mod, ls, calls, logs, home, fnCalls }
  }
  async function readDoc(home) {
    const p = settingsPathIn(home)
    if (!fs.existsSync(p)) return null
    const r = await store.readLocalSettings(home, realIo)
    return (r && r.ok === true) ? r.value : null
  }
  async function waitWrite(env, capMs) {
    return waitFor(async () => {
      const n = env.calls.filter((c) => c.method === 'wf.setSettings').length
      if (n === 0) return false
      await sleep(env.mod.VIEW_FLAG_WRITE_DEBOUNCE_MS + 120)
      return env.calls.filter((c) => c.method === 'wf.setSettings').length === n
    }, capMs)
  }
  // 轮询等一个条件成立，最多等 8 秒（机器忙时固定 sleep 会假红）。
  async function waitFor(fn, capMs) {
    const t0 = Date.now()
    const cap = capMs || 8000
    for (;;) {
      let hit = false
      try { hit = !!(await fn()) } catch (e) { hit = false }
      if (hit) return true
      if (Date.now() - t0 > cap) return false
      await sleep(25)
    }
  }
  const ready = (env) => waitFor(async () => env.mod.viewFlagReadyNow() === true)

  // ── 第一件事：文件里有这一格的非空文字，就以文件为准 ──
  console.log('')
  console.log('== 第一件事：文件里这一格有非空文字 → 读回文件那一份（旧键那一份不顶它） ==')
  {
    const env = makeEnv({ tag: 'docwins', localStorage: { 'dsws.templates': JSON.stringify({ fix: 'OLD_FIX' }) } })
    const w = await store.writeLocalSettings(docWith({ fix: 'FILE_FIX' }), env.home, realIo)
    check(w.ok === true, '预置一份设置文件，templates 节里 fix 是 FILE_FIX。', JSON.stringify(w))
    env.mod.settingsViewLoad()
    check(await ready(env), '读口就绪（文档到手）。')
    check(env.mod.tplText('fix', {}) === 'FILE_FIX', '文件里这一格有值 → 读回文件那一份。', env.mod.tplText('fix', {}))
    check(env.mod.templates.fix === 'FILE_FIX', '文件那一份也搬进了内存（后续以内存这一份为准）。', env.mod.templates.fix)
  }

  // ── 第二件事：文件里没这一格，就回退旧键那份快照 ──
  console.log('')
  console.log('== 第二件事：文件里没写这一格 → 用旧键 dsws.templates 里那一份（今天的行为不变） ==')
  {
    const env = makeEnv({ tag: 'fallback', localStorage: { 'dsws.templates': JSON.stringify({ fix: 'OLD_FIX' }) } })
    await store.writeLocalSettings(docWith({}), env.home, realIo)
    env.mod.settingsViewLoad()
    check(await ready(env), '读口就绪（文档到手，templates 节是空的）。')
    check(env.mod.tplText('fix', {}) === 'OLD_FIX', '文件里没这一格 → 用旧键那一份。', env.mod.tplText('fix', {}))
    check(env.mod.tplText('research', {}) === 'DEF:tpl.research', '两处都没有这一格 → 用默认文本（另一格不受影响）。', env.mod.tplText('research', {}))
  }

  // ── 第三件事：文件里写成空串，保留旧键那一份（空串 = 用默认文本，不是一份值） ──
  console.log('')
  console.log('== 第三件事：文件里写成空串 → 保留旧键那一份（空串不许顶掉用户改过的模板） ==')
  {
    const env = makeEnv({ tag: 'emptycell', localStorage: { 'dsws.templates': JSON.stringify({ fix: 'OLD_FIX' }) } })
    const w = await store.writeLocalSettings(docWith({ fix: '' }), env.home, realIo)
    check(w.ok === true, '预置一份设置文件，templates 节里 fix 写成空串（核认这一种，空 = 用默认文本）。', JSON.stringify(w))
    env.mod.settingsViewLoad()
    check(await ready(env), '读口就绪（文档到手）。')
    check(env.mod.tplText('fix', {}) === 'OLD_FIX', '文件里是空串 → 保留旧键那一份（没被空串顶掉）。', JSON.stringify([env.mod.tplText('fix', {}), env.mod.templates.fix]))
  }

  // ── 第四件事：写进文件成功之后，旧键一个字节都不写 ──
  console.log('')
  console.log('== 第四件事：写进设置文件成功 → 旧键 dsws.templates 一个字都不写 ==')
  {
    const seeded = JSON.stringify({ fix: 'OLD_FIX' })
    const env = makeEnv({ tag: 'nowrite', localStorage: { 'dsws.templates': seeded } })
    env.mod.settingsViewLoad()
    check(await ready(env), '读口就绪（这次没有设置文件，走的是空文档）。')
    env.mod.templates.fix = 'NEW_FIX'
    const ret = env.mod.saveTemplates()
    check(ret === true, 'saveTemplates 走的是设置文件这条路（返回 true，调用方不必再写旧键）。', JSON.stringify(ret))
    const landed = await waitFor(async () => { const d = await readDoc(env.home); return !!d && d.templates.fix === 'NEW_FIX' })
    check(landed, '这一格落进了设置文件的 templates 节。', JSON.stringify(await readDoc(env.home)))
    check(env.ls.getItem('dsws.templates') === seeded, '写成功之后旧键一个字都没动（还是原来那一份）。', env.ls.getItem('dsws.templates'))
    check(env.mod.tplText('fix', {}) === 'NEW_FIX', '读口读到的就是刚写下去那一份。', env.mod.tplText('fix', {}))
  }

  // ── 第四件事之二：文件里已经有非空值的格不再写（与「文件赢」同一条规矩） ──
  console.log('')
  console.log('== 第四件事之二：文件里已经有非空值的格不再写（旧存档不顶掉文件已经写着的那一份） ==')
  {
    const env = makeEnv({ tag: 'gapfill', localStorage: { 'dsws.templates': JSON.stringify({ fix: 'OLD_FIX' }) } })
    await store.writeLocalSettings(docWith({ fix: 'FILE_FIX' }), env.home, realIo)
    env.mod.settingsViewLoad()
    check(await ready(env), '读口就绪（文件里 fix 是 FILE_FIX）。')
    env.mod.templates.fix = 'LOCAL_WIN'
    check(env.mod.saveTemplates() === true, '整份保存照样接下（接得下，只是这一格没有要写的东西）。')
    await sleep(env.mod.VIEW_FLAG_WRITE_DEBOUNCE_MS + 300)
    const doc = await readDoc(env.home)
    check(!!doc && doc.templates.fix === 'FILE_FIX', '文件里那一格原样不动（文件那一份赢，旧存档不许顶掉它）。', JSON.stringify(doc && doc.templates))
    check(env.calls.filter((c) => c.method === 'wf.setSettings').length === 0, '没有任何一格要写时不发写电话（不写一份一模一样的内容回去）。',
      JSON.stringify(env.calls.map((c) => c.method)))
  }

  // ── 第五件事：文档还在路上就写 → 排队，文档到手后落进文件 ──
  console.log('')
  console.log('== 第五件事：文档还在路上先记着（不写旧键），到手后落进文件 ==')
  {
    const env = makeEnv({ tag: 'loading' })
    env.mod.templates.fix = 'QUEUED_FIX'
    const queuedTook = env.mod.saveTemplates()
    check(queuedTook === true, '文档一次都还没问过时这一笔就接下了（先记着，等文档）。', '整份保存回的是 ' + String(queuedTook))
    check(env.calls.some((c) => c.method === 'wf.getSettings'), '这一笔顺带把文档问了出去（惰性读一次）。')
    check(env.ls.getItem('dsws.templates') === null, '文档还在路上时不写旧键（此刻写了，文档一到手就会被文件里的旧值顶掉）。', env.ls.getItem('dsws.templates'))
    const landed = await waitFor(async () => { const d = await readDoc(env.home); return !!d && d.templates.fix === 'QUEUED_FIX' })
    check(landed, '文档到手之后这一笔真的落进了文件的 templates 节。', JSON.stringify(await readDoc(env.home)))
    check(env.ls.getItem('dsws.templates') === null, '落进文件之后旧键仍然一个字都没写。', env.ls.getItem('dsws.templates'))
  }

  // ── 第六件事：写不进文件时整份写回旧键兜底，用户看到的值不变 ──
  console.log('')
  console.log('== 第六件事：写不进文件（手机坏了 / 回包说不行 / 文件是更高版本）→ 整份写回旧键兜底，值不变 ==')
  {
    const env = makeEnv({ tag: 'failthrow', failMode: 'throw', localStorage: { 'dsws.templates': JSON.stringify({ fix: 'OLD_FIX' }) } })
    env.mod.settingsViewLoad()
    check(await ready(env), '读口就绪（读这一趟是通的，坏的只是写这一趟）。')
    env.mod.templates.fix = 'KEPT_FIX'
    check(env.mod.saveTemplates() === true, '写这一笔先按能写接下（落盘失败再兜底）。')
    const fell = await waitFor(() => { const v = env.ls.getItem('dsws.templates'); return !!v && JSON.parse(v).fix === 'KEPT_FIX' })
    check(fell, '写文件失败之后整份写回旧键兜底，这一次改的值在里面。', env.ls.getItem('dsws.templates'))
    check(env.mod.tplText('fix', {}) === 'KEPT_FIX', '用户看到的值不变（内存这一份没有回退成旧值）。', env.mod.tplText('fix', {}))
    check(fs.existsSync(settingsPathIn(env.home)) === false, '写失败时设置文件没有被建出来（兜底不是「换一份假的写成功」）。')
    // 这一档「整条电话被拒」（传输层就坏了）客户端只兜底、不记日志 —— 写那一片既有形状里就没写这一行，
    //   属于 #1012 后续修复的范围，第 4 步不动它，所以这里也不假装它记了。日志那一行在下面「回包说不行」那一档验。
  }
  {
    // 手机接通了、回包说「这份文件不许写」（最像真事的一档）：兜底写旧键，而且日志里留下一行。
    const env = makeEnv({
      tag: 'refusewrite',
      localStorage: { 'dsws.templates': JSON.stringify({ fix: 'OLD_FIX' }) },
      fsOverrides: { writeFile: async () => { throw failCode('EPERM', 'operation not permitted') } },
    })
    env.mod.settingsViewLoad()
    check(await ready(env), '读口就绪（读这一趟是通的，坏的只是写这一趟）。')
    env.mod.templates.fix = 'REFUSED_FIX'
    check(env.mod.saveTemplates() === true, '写这一笔先按能写接下（落盘失败再兜底）。')
    const fell2 = await waitFor(() => { const v = env.ls.getItem('dsws.templates'); return !!v && JSON.parse(v).fix === 'REFUSED_FIX' })
    check(fell2, '手机回包说不行之后整份写回旧键兜底，这一次改的值在里面。', env.ls.getItem('dsws.templates'))
    check(env.mod.tplText('fix', {}) === 'REFUSED_FIX', '用户看到的值不变（内存这一份没有回退成旧值）。', env.mod.tplText('fix', {}))
    check(fs.existsSync(settingsPathIn(env.home)) === false, '写不进文件时设置文件没有被建出来。')
    check(env.logs.some((l) => l.event === 'host.call.fail' && l.fields && l.fields.method === 'wf.setSettings'),
      '写失败在日志里留下一行（沿用既有的 host.call.fail，电话名写在 method 字段）。', JSON.stringify(env.logs))
  }
  {
    // 文件是更高版本插件写的：读得回但字段含义未知，所以这一族不接，当场交回调用方照老办法写旧键。
    const env = makeEnv({ tag: 'readonly', localStorage: { 'dsws.templates': JSON.stringify({ fix: 'OLD_FIX' }) } })
    fs.mkdirSync(path.dirname(settingsPathIn(env.home)), { recursive: true })
    fs.writeFileSync(settingsPathIn(env.home), 'version: 9\n', 'utf8')
    env.mod.settingsViewLoad()
    check(await ready(env), '读口就绪（文件是高版本，这一趟的结论是只读）。')
    env.mod.templates.fix = 'RO_FIX'
    check(env.mod.saveTemplates() === false, '文件是高版本时整份保存不接（返回 false，调用方照老办法写旧键）。')
    const oldParsed = JSON.parse(env.ls.getItem('dsws.templates') || '{}')
    check(oldParsed.fix === 'RO_FIX', '不接之后当场整份写回旧键兜底（这一次的改动没有丢）。', env.ls.getItem('dsws.templates'))
    check(env.mod.tplText('fix', {}) === 'RO_FIX', '用户看到的值不变。', env.mod.tplText('fix', {}))
    check(fs.readFileSync(settingsPathIn(env.home), 'utf8').indexOf('version: 9') === 0, '高版本文件一个字节都没被改。')
  }

  // ── 第七件事：两个旧存档键都不再被读、不再被写（#1012 定案第 10、11 条）──
  console.log('')
  console.log('== 第七件事：旧配置存档 dsws.cfg 与更旧的 dsws.startCfg 都不再被读、不再被写 ==')
  {
    const startCfgRaw = JSON.stringify({ withWayfinder: true, custom: 'CUSTOM_EXEC' })
    const cfgRaw = JSON.stringify({ withWayfinder: false, panelHeight: 'quarter' })
    const env = makeEnv({ tag: 'legacy-cfg', localStorage: { 'dsws.startCfg': startCfgRaw, 'dsws.cfg': cfgRaw } })
    check(env.mod.templates.execute === '', '旧存档 dsws.startCfg 里那一笔 custom 不再落到内存 execute 上。', JSON.stringify(env.mod.templates.execute))
    check(env.mod.tplText('execute', {}) !== 'CUSTOM_EXEC', '读口给的也不是旧存档里那份自定义文本。', env.mod.tplText('execute', {}))
    check(env.mod.migrateStartCfg === undefined && env.mod.cfg === undefined && env.mod.CFG_KEY === undefined, '编译出来的这一片里已经没有 cfg / CFG_KEY / migrateStartCfg 这三个名字。', Object.keys(env.mod).filter((k) => /^(cfg|CFG_KEY|migrateStartCfg)$/.test(k)).join(','))
    check(env.ls.getItem('dsws.startCfg') === startCfgRaw, '旧键 dsws.startCfg 原样留在本地存档里（没人再动它：不删也不改）。', env.ls.getItem('dsws.startCfg'))
    check(env.ls.getItem('dsws.cfg') === cfgRaw, '旧键 dsws.cfg 同样原样留着。', env.ls.getItem('dsws.cfg'))
    const env2 = makeEnv({ tag: 'legacy-cfg-reread', localStorage: { 'dsws.startCfg': startCfgRaw } })
    env2.mod.settingsViewLoad()
    check(await ready(env2), '第二个会话读口就绪（旧存档在不在都不影响读口起不来）。')
    check(env2.mod.tplText('execute', {}) === env.mod.tplText('execute', {}), '两个会话给出的文本一致（旧存档对读口没有任何影响）。', env2.mod.tplText('execute', {}))
  }

  // ── 第八件事：默认文本兜底不回归 ──
  console.log('')
  console.log('== 第八件事：两处都没有这一格时，读口给的还是 config.js 里那份默认文本 ==')
  {
    const env = makeEnv({ tag: 'default' })
    env.mod.settingsViewLoad()
    check(await ready(env), '读口就绪（设置文件还没有，旧键也没有）。')
    check(env.mod.tplText('fix', {}) === 'DEF:tpl.fix', '0 格都没有时回默认文本（fix）。', env.mod.tplText('fix', {}))
    check(env.mod.tplText('handoff2', {}) === 'DEF:tpl.handoff2', '同样回默认文本（handoff2 走的是另一个默认文本口子）。', env.mod.tplText('handoff2', {}))
    check(env.mod.tplText('不存在的名字', {}) === '', '名字不在 11 条清单里时回空串（不抛错）。', JSON.stringify(env.mod.tplText('不存在的名字', {})))
    check(fs.existsSync(settingsPathIn(env.home)) === false, '只是读、没有任何写入时，设置文件不会被建出来。')
  }

  // ── 第九件事：接线与行数 ──
  console.log('')
  console.log('== 第九件事：接入列表与行数（构建清单登记了、文件都没超三百五十行） ==')
  {
    check(readText('scripts/build.mjs').indexOf("{ name: 'settingsTemplates', file: 'src/client/kernel/settings-templates.js' }") >= 0,
      'scripts/build.mjs 的清单里登记了这一片（不登记就静默不编译）。')
    const nTpl = countLines(TPL_REL)
    check(nTpl <= 350, 'settings-templates.js 不超过三百五十行，实得 ' + nTpl + ' 行。')
    const nCfg = countLines(CONFIG_REL)
    check(nCfg <= 350, 'config.js 不超过三百五十行，实得 ' + nCfg + ' 行。')
    const nView = countLines(VIEW_REL)
    check(nView <= 350, 'settings-view.js 不超过三百五十行，实得 ' + nView + ' 行。')
    const nWrite = countLines(VIEW_WRITE_REL)
    check(nWrite <= 350, 'settings-view-write.js 不超过三百五十行，实得 ' + nWrite + ' 行。')
    const nIdx = countLines('src/client/index.js')
    check(nIdx <= 350, 'src/client/index.js 不超过三百五十行（新标记是并在原来那一行注释末尾的），实得 ' + nIdx + ' 行。')
  }

  console.log('')
  console.log(failed ? ('存在失败 — verify-settings-templates 未通过（' + passed + ' 项通过、' + failed + ' 项失败）') : ('全部通过 — 动作模板搬进设置文件门禁生效（' + passed + ' 项断言）'))
  // 完成记录：断言数 = 通过 + 失败（#1158）。
  printGateResult('verify-settings-templates', passed + failed, failed)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('FATAL ' + String((e && e.stack) || e)); process.exit(2) }).finally(() => { uninstallTimeCompression() })
