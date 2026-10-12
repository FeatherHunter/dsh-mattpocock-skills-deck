#!/usr/bin/env node
/**
 * verify-settings-view.js —— 客户端「按工作区的观看状态」搬到本机设置文件的门禁（#1012）。
 *
 * 这一份门禁只量十五件事，每一件都用完整的一句话说清，第一次读的人能直接看懂。
 * 第一件事是缺席时回退旧表读：设置文件还没建出来的时候，读到的值要与改动前一样来自 localStorage 那两个旧键。
 * 第二件事是写成功后旧 localStorage 键一个字节都不写：新后端这条路成了，两处都写就是两份真相。
 * 第三件事是写失败才过渡写旧键：只有写不进文件（或文件是更高版本、不许写回去）时，才把这一次的值写回旧键。
 * 第四件事是合并着写不丢别人的东西：只换这一个工作区的这一格，别的节、别的字段、别的工作区的记录原样保留。
 * 第五件事是键的写法：用工作区根的可读路径（本会话自己的那一种写法），不是折叠散列，同一个工作区只留一条。
 * 第六件事是防抖：连着来的几下写合并成一次电话调用。
 * 第七件事是行数：这一片拆出来的几份文件与 src/client/index.js 都不超三百五十行。
 *   （2026-10-12 修订：原来这一件事还读 store-prefs.js 与 SubworkspaceMark.js 的源码文本，断言它们「改调了
 *   这一片」的写法，等价重构就会变红，已删；剩下的只是行数配额。）
 *
 * 第八件事是「文档还在路上时不许下结论」：这份设置文档是异步读来的，谁要按它下判断都得先问
 *   viewFlagReadyNow()「现在手上这个判断问过真源了没有」，问不到就等 viewFlagSubscribe() 那一声重判；
 *   文档到手、或判定问不到（手机不通、读失败、文件是更高版本）都算就绪。这一条治的是 #1012 落下的行为回退：
 *   红文件夹标志的浮层自动展开原先挂在挂载效果上，文档还没到手就按旧键判成「没展开过」当场弹一次，
 *   于是 #650 承诺的「同一个工作区只自动展开一次」退化成「每进一次子目录会话都白弹一次」。
 *   这一件事最后真画一遍：真 jsdom + 真 React 把「文档迟到」那一刻渲染出来，看浮层到底弹没弹
 *   （修复前那一版组件在这几条上会变红：文档里记过也照弹、文档没到就先弹）。
 *
 * 第九件事到第十二件事是 #1012 后续修复补的四条真行为：写失败的那一笔不许丢（失败后留在待写队列里，
 *   下一趟写把它落进文件；写旧表这一步自己失败时补一行 storage.fail），同一格在这一趟飞在天上时被改过
 *   不许被回包一起划掉（划掉就再也不会补写，盘上与内存从此不一致），认不出工作区根时一个字都不写文件
 *   （写下去会留下永远合并不到一起的孤儿记录），以及真正要写之前先重读一次文件、把本窗改过的那几格
 *   合并进最新那一份再写出去（不然后写的窗会把先写那扇窗刚写进去的别的格整节顶掉）。
 *
 * 第十三件事与第十四件事是复核抓出的两条必修（第一轮修复自己带出来的回退）：
 *   第十三件事是读与写必须对「这个所选目录认不认得工作区根」给同一个答案 —— 客户端已经从内核那张
 *   「所选目录的键 → 工作区根」的表里认出根、而本会话对象上还是空的时候，从前读这一侧答得出一条记录、
 *   写这一侧答认不出，用户点一下写这一笔直接不接，界面上横幅又弹回来；
 *   第十四件事是回包划队列要按「真正交给宿主的那份快照里的值」判 —— 从前比的是发出前记下的值，
 *   重读窗口里改过、回包前又改回原值的交错会被误判成「没改过」而划掉，盘上留中间值、内存是最后那一下。
 *
 * 第十五件事是 #1012 第 3 步：界面偏好那三格（列表面板的状态筛选、排序键、排序方向）从 localStorage 的
 *   dsws.listPrefs 搬进本机设置文件的 ui 节。量的是四条：文件里写过的那一格到手后换成文件里那一份
 *   （本次会话没动过的面板跟着换、已经动过的不顶回去），文件里没写过的格（空串）保留旧表那一份，
 *   点一下筛选或排序写进文件成功就不写旧键，写失败（含文档还在路上、文件是更高版本）才照老办法整份写回旧键。
 *
 * 怎么保证量的是真件：客户端那几片（src/client/kernel/settings-view-state.js、settings-view.js、
 *   settings-view-write.js 与 settings-ui.js）的真源按构建同一种做法、同一次序拼起来当场造出函数来跑
 *   （第一片是后两片的前置、第二片又是第三片的前置，第四片与第三片共用同一个待写队列，构建时也照这个
 *   次序拼；界面偏好那三格的内存那一份与旧键写法取自 store-prefs.js 里「主列表偏好」那一段真源码）；
 *   它打的宿主那两条电话（wf.getSettings / wf.setSettings）用的是
 *   src/host/settingsPhones.js 与 src/host/configStore.js 的真实现，读写落在系统临时目录里的真文件上 ——
 *   只有手机（假 host 的 call）与文件系统（可以按需制造写失败的那一层包装）是替身。
 *   自动展开那三档判决走的是 SubworkspaceMark.js 里那个纯函数 subwsMarkAutoDecide 的真源码，不另写一份仿制品。
 * 本门禁自己先跑一次 node scripts/build.mjs：客户端那几片的运行时形状来自拼接，不跑构建就证明不了它真的进了双产物。
 *
 * 用法：node tests/verify-settings-view.js（在插件根目录；本脚本自己会先构建）
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const { spawnSync } = require('child_process')
const realFs = require('node:fs/promises')
const { compileFn } = require('./lib/eval-probe.js')
// 这一门里有几十处 sleep(防抖窗口 + 几百毫秒) 的等待，真实跑要五十秒；接上虚拟时钟把等待压成几毫秒，
// 断言一条没动（为什么这么压是安全的、两条不能破的语义，见 tests/lib/time-compress.js 文件头）。
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
const makeHome = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-view-' + tag + '-'))
const settingsPathIn = (home) => path.join(home, '.dsh', 'mattskillsdeck', 'settings.yaml')

// 真的文件读写口（核要的那四个动作），门禁里读写落在临时目录的真文件上。
const realIo = {
  readText: (p) => realFs.readFile(String(p), 'utf8'),
  writeText: (p, t) => realFs.writeFile(String(p), String(t), 'utf8'),
  mkdir: (p) => realFs.mkdir(String(p), { recursive: true }),
  rm: (p) => realFs.unlink(String(p)),
}
// 记录型系统文件：包一层真文件，既落真盘又能看调用序列，overrides 用来制造写失败（与 verify-settings-phones.js 同一手法）。
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
//   hooks.before 在每一次电话真正交给真实现之前调一次，参数是（电话名、这一趟的参数、到目前为止的调用清单）——
//   门禁用它来演「这一趟还在天上飞的时候，用户或另一扇窗又动了一下」。
function makeHost(phones, calls, failMode, hooks) {
  return {
    call: function (method, args) {
      calls.push({ method: method, args: args })
      if (hooks && typeof hooks.before === 'function') { try { hooks.before(method, args, calls) } catch (eH) {} }
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

// ── 真件一：闭包里那把规整函数 keyOf 与它判平台用的 currentOs（src/shared/workspaceKey.js 的真源码，不另写仿制品） ──
function sharedKeyFn(name) {
  const src = readText('src/shared/workspaceKey.js').replace(/^\s*export\s+/gm, '')
  return compileFn([], src + '\nreturn ' + name)()
}
function keyOfFn() { return sharedKeyFn('keyOf') }
// ── 真件二：被测那三片（按构建同一种做法取声明体、按同一次序拼起来，当场造出一个全新的实例） ──
//   第一片（加载状态与订阅）是后两片的前置，第二片（键与文档、读、把文档交给界面）又是第三片（写这一趟）
//   的前置：构建时三个标记就是这个次序，这里也照同一次序拼。
const VIEW_REL = 'src/client/kernel/settings-view.js'
const VIEW_STATE_REL = 'src/client/kernel/settings-view-state.js'
const VIEW_WRITE_REL = 'src/client/kernel/settings-view-write.js'
const UI_REL = 'src/client/kernel/settings-ui.js'
const noExport = (s) => s.replace(/^\s*export\s+/gm, '')
// store-prefs.js 里「主列表偏好」那一段的真源码（LIST_PREFS_KEY / listPrefs / saveListPrefsLegacy / saveListPrefs）：
//   界面偏好那一族要用的就是这一段。整份 store-prefs.js 还牵着面板高度、无仓库红卡、选中与仓库等别的东西，
//   所以只切这一段 —— 仍然是真源码，不另写仿制品。
function listPrefsSlice() {
  const src = readText('src/client/kernel/store-prefs.js')
  const start = src.indexOf('// #374：主列表偏好')
  const end = src.indexOf('// #375：label 点击记忆')
  if (start < 0 || end <= start) throw new Error('store-prefs.js 里找不到主列表偏好那一段（#374 到 #375 之间）')
  return noExport(src.slice(start, end))
}
function makeView(env) {
  const body = listPrefsSlice() + '\n' + noExport(readText(VIEW_STATE_REL)) + '\n' + noExport(readText(VIEW_REL)) + '\n' + noExport(readText(VIEW_WRITE_REL)) + '\n' + noExport(readText(UI_REL))
  const names = ['keyOf', 'wsKeyOf', 'shared', 'stores', 'emit', 'host', 'localStorage', 'log', 'dswsLogHash', 'timer', 'currentOs', 'workspaceRootByCwd']
  const factory = compileFn(names, body + '\nreturn { viewFlagOf: viewFlagOf, viewFlagOfRoot: viewFlagOfRoot, setViewFlag: setViewFlag, setViewFlagRoot: setViewFlagRoot, viewFlagDocKeyOf: viewFlagDocKeyOf, viewFlagWriteKeyOf: viewFlagWriteKeyOf, settingsViewLoad: settingsViewLoad, viewFlagReadyNow: viewFlagReadyNow, viewFlagSubscribe: viewFlagSubscribe, setUiPref: setUiPref, saveUiPrefs: saveUiPrefs, listPrefs: listPrefs, saveListPrefs: saveListPrefs, saveListPrefsLegacy: saveListPrefsLegacy, LIST_PREFS_KEY: LIST_PREFS_KEY, VIEW_FLAG_WRITE_DEBOUNCE_MS: VIEW_FLAG_WRITE_DEBOUNCE_MS }')
  return factory.apply(null, names.map((n) => env[n]))
}
// ── 真件三：自动展开那三档判决（从 SubworkspaceMark.js 的真源里切出那个纯函数，不另写仿制品） ──
//   切法与 tests/verify-666-subws-mark-root.js 同一段（subwsMarkRootOf 到 SubworkspaceMark 之间那组纯函数）。
function autoDecideFn() {
  const src = readText('src/client/views/SubworkspaceMark.js')
  const start = src.indexOf('export const subwsMarkRootOf')
  const end = src.indexOf('export const SubworkspaceMark')
  if (start < 0 || end <= start) throw new Error('SubworkspaceMark.js 里找不到那组纯函数（subwsMarkRootOf … SubworkspaceMark 之间）')
  return compileFn(['keyOf', 'tr'], noExport(src.slice(start, end)) + '\nreturn subwsMarkAutoDecide')(keyOfFn(), (k) => k)
}

// ── 真件三之二：自动展开「以前展开过没有」那道判断（同样从真源里切出纯函数，不另写仿制品） ──
function shownBeforeFn() {
  const src = readText('src/client/views/SubworkspaceMark.js')
  const start = src.indexOf('export const subwsMarkRootOf')
  const end = src.indexOf('export const SubworkspaceMark')
  if (start < 0 || end <= start) throw new Error('SubworkspaceMark.js 里找不到那组纯函数（subwsMarkRootOf … SubworkspaceMark 之间）')
  return compileFn(['keyOf', 'tr'], noExport(src.slice(start, end)) + '\nreturn subwsMarkShownBefore')(keyOfFn(), (k) => k)
}

async function main() {
  console.log('客户端观看状态搬进本机设置文件门禁（#1012：回退读、不双写、写失败兜底、合并写、键的写法、防抖、接线）')

  // ── 第零件事：先构建（这一片的运行时形状来自拼接，不构建就证明不了它真的进了产物） ──
  console.log('')
  console.log('== 第零件事：先跑构建（一源两物，产物是这一片真正的运行时形状） ==')
  {
    const r = spawnSync(process.execPath, [path.join('scripts', 'build.mjs')], { cwd: ROOT, stdio: 'inherit' })
    check(r.status === 0, 'node scripts/build.mjs 构建通过。',
      '退出码 ' + String(r.status) + '（构建没通过时下面那几条产物断言不可信：可能仓库里有人正在同时构建或正在改文件，请稍后重跑本门禁）')
    for (const rel of ['client.js', 'package/lib/client.js']) {
      const t = fs.existsSync(path.join(ROOT, rel)) ? readText(rel) : ''
      check(t.indexOf('const viewFlagOf = function') >= 0 && t.indexOf('const setViewFlag = function') >= 0,
        rel + ' 里拼进了这一片的读写两个入口（读与写都在，才算真接上）。')
      check(t.indexOf('const viewFlagReadyNow = function') >= 0 && t.indexOf('const viewFlagSubscribe = function') >= 0,
        rel + ' 里拼进了「问完真源了没有」那两个公开口子（加载状态与订阅这一片真的进了产物）。')
      check(t.indexOf('const viewFlagWriteNow = function') >= 0 && t.indexOf('const viewFlagFreshDocFor = function') >= 0,
        rel + ' 里拼进了写这一趟（待写队列、防抖、写前重读合并都在，写这条路才算真接上）。')
      check(t.indexOf('const viewFlagState = {') >= 0 && t.indexOf('const viewFlagState = {') < t.indexOf('const viewFlagOf = function'),
        rel + ' 里状态对象排在它的使用方之前（拼接次序对，先有定义再有用它的那一片）。')
      check(t.indexOf('const setViewFlag = function') > t.indexOf('const viewFlagWriteKeyOf = function'),
        rel + ' 里写这一趟排在它用到的读那一片之后（键与文档工具都先有定义）。')
      check(t.indexOf('const setUiPref = function') >= 0 && t.indexOf('const saveUiPrefs = function') >= 0,
        rel + ' 里拼进了界面偏好那一族的两个口子（#1012 第 3 步：列表筛选、排序键、排序方向搬进 ui 节）。')
      check(t.indexOf('const settingsUiAdoptFromDoc = function') > t.indexOf('const viewFlagWriteNow = function'),
        rel + ' 里界面偏好那一片排在写这一趟之后（它要用那一片的待写队列与排期）。')
    }
  }

  // 真件：宿主的核与两条电话
  const leaf = await import(pathToFileURL(path.join(ROOT, 'src/host', 'settingsPhones.js')).href)
  const store = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'configStore.js')).href)
  const KEY_OF = keyOfFn()
  const CURRENT_OS = sharedKeyFn('currentOs')

  // 一个场景的全套夹具：临时主目录、假手机、假 localStorage、一条会话状态。
  function makeEnv(opts) {
    const o = opts || {}
    const cwd = o.cwd || 'D:\\ilife\\packages\\skill-calorie'
    const root = o.root === undefined ? 'd:\\ilife' : o.root // 宿主给的是折算过的键（Windows 上小写）
    const home = makeHome(o.tag || 'case')
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
    const host = o.noHost ? undefined : makeHost(phones, calls, o.failMode, { before: o.onCall })
    const st = { cwd: cwd, sessionWorkspaceRoot: root, subs: [], tick: 0 }
    const shared = { cwd: '', subs: [], tick: 0 }
    const stores = { 'sess-1': st }
    const logs = []
    // 内核那张「所选目录的键 → 工作区根」的表（store-snapshot.js 第 57–63 行的真口径：同一个工作区的
    //   每条所选目录都记一份，根自己也记一份 root → root）。这一片要靠它回答「这个所选目录认不认得根」，
    //   所以这里按同一种记法造一张真表，wsKeyOf 也从它里面取（与 store-snapshot.js 第 69–78 行同例）。
    const rootTable = {}
    if (o.rootByKey) {
      Object.keys(o.rootByKey).forEach(function (k) {
        rootTable[k] = o.rootByKey[k]
        if (o.rootByKey[k]) rootTable[o.rootByKey[k]] = o.rootByKey[k]
      })
    }
    const mod = makeView({
      keyOf: KEY_OF,
      wsKeyOf: function (c) { const k = KEY_OF(c); if (!k) return ''; return rootTable[k] || k },
      workspaceRootByCwd: rootTable,
      shared: shared,
      stores: stores,
      emit: function (s) { s.tick += 1 },
      host: host,
      localStorage: ls,
      log: function (level, event, fields) { logs.push({ level: level, event: event, fields: fields }) },
      dswsLogHash: function (s) { return 'h' + String(s || '').length },
      timer: undefined,
      // 拼回可读写法时用哪个分隔符由这一片按平台判，所以这里喂的是真 currentOs（与 keyOf 同源那份真源码）。
      currentOs: CURRENT_OS,
    })
    return { mod, ls, calls, logs, home, cwd, root, st, shared, stores, fnCalls }
  }
  // 读回设置文件（走真核，拿到归一后的那一份），文件不在时回 null。
  async function readDoc(home) {
    const p = settingsPathIn(home)
    if (!fs.existsSync(p)) return null
    const r = await store.readLocalSettings(home, realIo)
    return (r && r.ok === true) ? r.value : null
  }
  const wait = (env) => sleep(env.mod.VIEW_FLAG_WRITE_DEBOUNCE_MS + 260)
  // 轮询等一个条件成立（复核建议 3：门禁里几处固定 sleep 的余量偏薄 —— 700 毫秒要装下 500 毫秒防抖加一次
  //   真文件写，机器忙时会假红；改成等到条件成立再断言，最多等 8 秒，等不到按失败走）。
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

  // ── 第一件事：文件缺席时回退旧表读 ──
  console.log('')
  console.log('== 第一件事：设置文件还没建时，读回退到旧 localStorage 键（行为与改动前一致） ==')
  {
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'absent', cwd: cwd, localStorage: { 'dsws.bannerFold': JSON.stringify({ [KEY_OF(cwd)]: 1 }) } })
    check(env.mod.viewFlagOf(cwd, 'bannerFolded') === true, '文件缺席时，旧键里记着收起过就回 true（不因为新后端没文件就说没收起）。')
    check(env.mod.viewFlagOf(cwd, 'subwsMarkAutoShown') === false, '另一个名字在旧键里没有记录时回 false（不是 undefined、也不抛错）。', String(env.mod.viewFlagOf(cwd, 'subwsMarkAutoShown')))
    check(env.calls.filter((c) => c.method === 'wf.getSettings').length === 1, '文件缺席只读一次文档（第一次用到时惰性读一次）。', JSON.stringify(env.calls.map((c) => c.method)))
    // 缺席不代表这条路不可用：后端通着，第一次写入会把它建出来，所以写要接得下来。
    const accepted = env.mod.setViewFlag(cwd, 'bannerFolded', true)
    check(accepted === true, '文件缺席时这一片照样接下写入（后端通着，第一次写入会把这份文件建出来）。')
    await wait(env)
    const doc = await readDoc(env.home)
    check(!!doc && !!doc.workspaces && !!doc.workspaces['D:\\ilife'] && doc.workspaces['D:\\ilife'].bannerFolded === true,
      '缺席起步的那一份空文档，写下去之后文件真的建出来了，而且这一格是 true。', JSON.stringify(doc && doc.workspaces))
    // A4：新建这一条记录时，无仓库红卡那一格不由本窗口替用户答 false（那张卡要退役，答了会在以后把用户
    //   已经收起的红卡重新弹出来）。这里量的是发出去的那一份文档：它不该带这一格。
    const sentFirst = env.calls.filter((c) => c.method === 'wf.setSettings')[0]
    const sentEntry = sentFirst && sentFirst.args && sentFirst.args.value && sentFirst.args.value.workspaces['D:\\ilife']
    check(!!sentEntry && sentEntry.noRepoDismissed === undefined,
      '新建记录时本窗口不替无仓库红卡那一格答 false（发出去的文档里没有这一格）。', JSON.stringify(sentEntry))
    check(!!sentEntry && typeof sentEntry.bannerFolded === 'boolean' && typeof sentEntry.subwsMarkAutoShown === 'boolean',
      '另外两格照旧种上（值取旧表里还知道的那一份，新建的那一刻不把用户收起过的横幅重新展开）。', JSON.stringify(sentEntry))
  }

  // ── 第二件事：写成功之后旧 localStorage 键一个字节都不写 ──
  console.log('')
  console.log('== 第二件事：写进了设置文件，就绝不再写旧 localStorage 键（两处都写就是两份真相） ==')
  {
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'nowrite', cwd: cwd })
    check(env.mod.setViewFlag(cwd, 'subwsMarkAutoShown', true) === true, '写这一笔时这一片接下了（返回值 true 表示调用方不要再写旧表）。')
    await wait(env)
    const doc = await readDoc(env.home)
    check(!!doc && doc.workspaces['D:\\ilife'].subwsMarkAutoShown === true, '设置文件里这一格写成了 true。', JSON.stringify(doc && doc.workspaces))
    check(env.ls.getItem('dsws.subwsAutoShown') === null, '写成功之后旧键 dsws.subwsAutoShown 一个字都没写（读它是 null）。', JSON.stringify(env.ls.dump()))
    check(env.ls.getItem('dsws.bannerFold') === null, '没有被碰过的另一个旧键同样一个字都没写。', JSON.stringify(env.ls.dump()))
    // 反向再来一次：写 false 也不许回到旧表。
    check(env.mod.setViewFlag(cwd, 'subwsMarkAutoShown', false) === true, '取消这一格时这一片同样接下。')
    await wait(env)
    const doc2 = await readDoc(env.home)
    check(!!doc2 && doc2.workspaces['D:\\ilife'].subwsMarkAutoShown === false, '取消之后文件里这一格是 false。', JSON.stringify(doc2 && doc2.workspaces))
    check(env.ls.getItem('dsws.subwsAutoShown') === null, '取消这一笔之后旧键仍然一个字都没写。', JSON.stringify(env.ls.dump()))
  }

  // ── 第三件事：写失败才兜底写旧键 ──
  console.log('')
  console.log('== 第三件事：只有写不进文件（或文件不许写回去）时，才把这一次的值写回旧键做过渡 ==')
  {
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'failwrite', cwd: cwd, fsOverrides: { writeFile: async () => { throw failCode('EPERM', 'operation not permitted') } } })
    check(env.mod.setViewFlag(cwd, 'bannerFolded', true) === true, '写这一笔时这一片先接下了（它先按能写处理，落盘失败再兜底）。')
    await wait(env)
    const old = env.ls.getItem('dsws.bannerFold')
    const oldMap = old ? JSON.parse(old) : null
    check(!!oldMap && oldMap[KEY_OF(cwd)] === 1, '写文件失败之后，这一次的值写回了旧键 dsws.bannerFold（兜底）。', JSON.stringify(old))
    check(fs.existsSync(settingsPathIn(env.home)) === false, '写失败时设置文件没有被建出来（兜底不是「换一份假的写成功」）。')
    check(env.logs.some((l) => l.event === 'host.call.fail' && l.fields && l.fields.method === 'wf.setSettings'), '写失败在日志里留下一行（沿用既有的 host.call.fail，电话名写在 method 字段）。', JSON.stringify(env.logs))
  }
  {
    // 文件是高版本插件写的：读得回但字段含义未知，所以不照着它答（宁可回旧表），也绝不写回去。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'readonly', cwd: cwd, localStorage: { 'dsws.bannerFold': JSON.stringify({ [KEY_OF(cwd)]: 1 }) } })
    fs.mkdirSync(path.dirname(settingsPathIn(env.home)), { recursive: true })
    fs.writeFileSync(settingsPathIn(env.home), 'version: 9\nworkspaces:\n  "D:\\ilife":\n    bannerFolded: false\n', 'utf8')
    check(env.mod.viewFlagOf(cwd, 'bannerFolded') === true, '文件是高版本时读回旧表里的值（读不懂的字段不猜）。')
    await sleep(120) // 让那一次读的答复落地（这一片据此把状态标成只读）
    check(env.mod.setViewFlag(cwd, 'bannerFolded', false) === false, '文件是高版本时写这一笔不接（返回 false，调用方按老办法写旧表）。')
    check(env.mod.viewFlagOf(cwd, 'bannerFolded') === true, '不接之后读仍旧回旧表里的值（不拿高版本文件里那格当答案）。')
    await wait(env)
    check(fs.readFileSync(settingsPathIn(env.home), 'utf8').indexOf('version: 9') === 0, '高版本文件一个字节都没被改（还是原来那份）。')
  }
  {
    // 读的答复还没回来时进来的那一笔：先记下不写旧键，等答复落地知道文件是高版本，再照旧表兜底写。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'readonly2', cwd: cwd })
    fs.mkdirSync(path.dirname(settingsPathIn(env.home)), { recursive: true })
    fs.writeFileSync(settingsPathIn(env.home), 'version: 9\n', 'utf8')
    check(env.mod.setViewFlag(cwd, 'bannerFolded', true) === true, '读还没回来时这一笔先接下（不当场写旧键，免得文档一到手就把它顶掉）。')
    await sleep(150)
    const oldMap = JSON.parse(env.ls.getItem('dsws.bannerFold') || '{}')
    check(oldMap[KEY_OF(cwd)] === 1, '答复落地后知道文件是高版本，于是把这一笔记回旧键兜底。', JSON.stringify(oldMap))
    check(fs.readFileSync(settingsPathIn(env.home), 'utf8').indexOf('version: 9') === 0, '这一趟同样没有碰高版本文件一个字节。')
  }

  // ── 第四件事：合并着写，不丢别的节与别的字段 ──
  console.log('')
  console.log('== 第四件事：只换这一个工作区的这一格，别的节、别的字段、别的工作区原样保留 ==')
  {
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'merge', cwd: cwd })
    const preset = {
      version: 1,
      ui: { stateFilter: 'closed', sortKey: 'updated', sortDir: 'desc', labelClicks: { bug: 3 } },
      workspaces: { 'D:\\other': { bannerFolded: true, noRepoDismissed: true, subwsMarkAutoShown: true } },
      debug: { enabled: true, sampleRate: 0.25 },
      templates: { greeting: '你好，世界' },
    }
    const w0 = await store.writeLocalSettings(preset, env.home, realIo)
    check(w0.ok === true, '预置一份别人写过的设置文件（里面有别的节、别的字段、别的工作区）。', JSON.stringify(w0))
    check(env.mod.setViewFlag(cwd, 'bannerFolded', true) === true, '在预置文件的基础上写本工作区这一格。')
    await wait(env)
    const doc = await readDoc(env.home)
    // 标签点击次数不落盘（维护者 2026-10-12 拍板），所以「一个不动」的只有状态过滤与排序两项，
    //   ui 节里那一项写出去时被丢掉，读回来是空的。
    const uiExpected = { stateFilter: preset.ui.stateFilter, sortKey: preset.ui.sortKey, sortDir: preset.ui.sortDir, labelClicks: {} }
    check(!!doc && JSON.stringify(doc.ui) === JSON.stringify(uiExpected), 'ui 节原样保留（状态过滤、排序一个不动；标签点击次数不落盘，写出去的一份里没有它）。', JSON.stringify(doc && doc.ui))
    check(!!doc && JSON.stringify(doc.debug) === JSON.stringify(preset.debug), 'debug 节原样保留（开关与采样率一个不动）。', JSON.stringify(doc && doc.debug))
    check(!!doc && JSON.stringify(doc.templates) === JSON.stringify(preset.templates), 'templates 节原样保留（用户自己写的模板文本一个不动）。', JSON.stringify(doc && doc.templates))
    check(!!doc && !!doc.workspaces['D:\\other'] && doc.workspaces['D:\\other'].bannerFolded === true && doc.workspaces['D:\\other'].noRepoDismissed === true,
      '别的工作区那一条原样保留。', JSON.stringify(doc && doc.workspaces))
    check(!!doc && !!doc.workspaces['D:\\ilife'] && doc.workspaces['D:\\ilife'].bannerFolded === true, '本工作区这一格写成了 true。', JSON.stringify(doc && doc.workspaces))
    check(!!doc && ['bannerFolded', 'noRepoDismissed', 'subwsMarkAutoShown'].every((k) => typeof doc.workspaces['D:\\ilife'][k] === 'boolean'),
      '新写下的这一条是核认得的完整形状（三个开关都在，核不会按缺项或多项拒绝）。', JSON.stringify(doc && doc.workspaces['D:\\ilife']))
  }

  // ── 第五件事：键用工作区根的可读路径，不是折叠散列，同一个工作区只留一条 ──
  console.log('')
  console.log('== 第五件事：键是工作区根的可读路径（本会话自己的写法），不是折叠散列 ==')
  {
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'key', cwd: cwd })
    check(env.mod.viewFlagDocKeyOf(cwd) === 'D:\\ilife', '键还原成本会话自己的写法 D:\\ilife（宿主给的那份是小写折算过的键）。', JSON.stringify(env.mod.viewFlagDocKeyOf(cwd)))
    check(/^[A-Za-z]:[\\/]/.test(env.mod.viewFlagDocKeyOf(cwd)) && !/^[0-9a-f]{6,}$/i.test(env.mod.viewFlagDocKeyOf(cwd)),
      '键是一条人认得出的路径（有盘符与分隔符），不是一串算出来的散列。', JSON.stringify(env.mod.viewFlagDocKeyOf(cwd)))
    check(env.mod.setViewFlag(cwd, 'bannerFolded', true) === true, '写一笔好让文件里长出这一条。')
    await wait(env)
    const doc = await readDoc(env.home)
    check(!!doc && Object.keys(doc.workspaces).length === 1 && doc.workspaces['D:\\ilife'] !== undefined,
      '文件里只有一条，键就是那条可读路径。', JSON.stringify(doc && Object.keys(doc.workspaces)))
    // 谁都没认出工作区根（会话状态上没有根、内核那张表里也没有这一条）时，读与写给同一个答案：空串。
    //   从前读这一侧会退到会话目录、写这一侧不退，于是同一现场下读答一条记录、写答认不出（M5）。
    const env3 = makeEnv({ tag: 'key3', cwd: 'D:\\scratch\\no-repo\\sub', root: '' })
    check(env3.mod.viewFlagDocKeyOf('D:\\scratch\\no-repo\\sub') === '' && env3.mod.viewFlagWriteKeyOf('D:\\scratch\\no-repo\\sub') === '',
      '谁都没认出工作区根时，读与写给出同一个答案：空串（这一笔只走旧表，绝不猜一把会话目录键）。',
      JSON.stringify([env3.mod.viewFlagDocKeyOf('D:\\scratch\\no-repo\\sub'), env3.mod.viewFlagWriteKeyOf('D:\\scratch\\no-repo\\sub')]))
    // 根是内核那张表认出来的（本会话对象上还空着）时，两边同样给同一把键，而且键就是那条根。
    const env4 = makeEnv({ tag: 'key4', cwd: 'D:\\ilife\\packages\\skill-calorie', root: '', rootByKey: { [KEY_OF('D:\\ilife\\packages\\skill-calorie')]: KEY_OF('D:\\ilife') } })
    check(env4.mod.viewFlagDocKeyOf('D:\\ilife\\packages\\skill-calorie') === 'D:\\ilife' && env4.mod.viewFlagWriteKeyOf('D:\\ilife\\packages\\skill-calorie') === 'D:\\ilife',
      '表里认出根时，读与写都按那条根给键（客户端已经知道根，就不许写口再说认不出）。',
      JSON.stringify([env4.mod.viewFlagDocKeyOf('D:\\ilife\\packages\\skill-calorie'), env4.mod.viewFlagWriteKeyOf('D:\\ilife\\packages\\skill-calorie')]))
    // 所选目录本身就是工作区根（表里记着 root → root 那一份）时，它折回来还是自己，也算真认得根，不是空串。
    const env5 = makeEnv({ tag: 'key5', cwd: 'D:\\ilife', root: '', rootByKey: { [KEY_OF('D:\\ilife')]: KEY_OF('D:\\ilife') } })
    check(env5.mod.viewFlagDocKeyOf('D:\\ilife') === 'D:\\ilife' && env5.mod.viewFlagWriteKeyOf('D:\\ilife') === 'D:\\ilife',
      '所选目录本身就是工作区根时（表里 root → root 那一份），读与写都认这把键，不回空串。',
      JSON.stringify([env5.mod.viewFlagDocKeyOf('D:\\ilife'), env5.mod.viewFlagWriteKeyOf('D:\\ilife')]))
  }
  {
    // 同一个工作区两条不同写法的会话：文件里只留一条，后到的会话沿用它。
    const cwdA = 'D:\\ilife'
    const env = makeEnv({ tag: 'oneentry', cwd: cwdA })
    check(env.mod.setViewFlag(cwdA, 'bannerFolded', true) === true, '甲会话（D:\\ilife）先写下一条。')
    await wait(env)
    const st2 = { cwd: 'd:\\ilife\\packages\\x', sessionWorkspaceRoot: 'd:\\ilife', subs: [], tick: 0 }
    env.stores['sess-2'] = st2
    check(env.mod.viewFlagOf('d:\\ilife\\packages\\x', 'bannerFolded') === true, '乙会话（小写写法的子目录）读到的是同一条记录里的值。')
    check(env.mod.setViewFlag('d:\\ilife\\packages\\x', 'subwsMarkAutoShown', true) === true, '乙会话再写另一格。')
    await wait(env)
    const doc = await readDoc(env.home)
    check(!!doc && Object.keys(doc.workspaces).length === 1, '写完两条会话之后，文件里仍然只有一条记录（不同写法折算到同一条）。', JSON.stringify(doc && Object.keys(doc.workspaces)))
    check(!!doc && doc.workspaces['D:\\ilife'] && doc.workspaces['D:\\ilife'].bannerFolded === true && doc.workspaces['D:\\ilife'].subwsMarkAutoShown === true,
      '两格都落在原来那一条记录上（bannerFolded 与 subwsMarkAutoShown 都是 true）。', JSON.stringify(doc && doc.workspaces))
  }

  // ── 第六件事：防抖把连着来的几下合并成一次电话调用 ──
  console.log('')
  console.log('== 第六件事：连着来的几下写合并成一次电话调用（防抖窗口内只落一次盘） ==')
  {
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'debounce', cwd: cwd })
    const rets = []
    rets.push(env.mod.setViewFlag(cwd, 'bannerFolded', true))
    rets.push(env.mod.setViewFlag(cwd, 'bannerFolded', false))
    rets.push(env.mod.setViewFlag(cwd, 'bannerFolded', true))
    rets.push(env.mod.setViewFlag(cwd, 'subwsMarkAutoShown', true))
    rets.push(env.mod.setViewFlag(cwd, 'bannerFolded', false))
    check(rets.every((v) => v === true), '连着来的五下每一首都接下了（都交给写文件这条路）。', JSON.stringify(rets))
    await wait(env)
    const writes = env.calls.filter((c) => c.method === 'wf.setSettings')
    check(writes.length === 1, '五次改动只发了一次写电话（防抖把窗口内的几下并成一次）。', '实得 ' + writes.length + ' 次')
    check(writes.length === 1 && Object.keys(writes[0].args.value.workspaces).length >= 1, '那一次写电话带的是整份文档（value 里有 workspaces 这一节）。')
    const doc = await readDoc(env.home)
    check(!!doc && doc.workspaces['D:\\ilife'].bannerFolded === false && doc.workspaces['D:\\ilife'].subwsMarkAutoShown === true,
      '文件里留下的是最后那一下的值（横幅没收起、标志已展开）。', JSON.stringify(doc && doc.workspaces))
    await sleep(600)
    check(env.calls.filter((c) => c.method === 'wf.setSettings').length === 1, '等过第二个窗口之后也没有补发第二次（不是自续的定时器）。')
  }

  // ── 第七件事（之一）：手机不通时不许抛错，全程走旧表 ──
  console.log('')
  console.log('== 第七件事之一：手机不通（没有宿主、或读电话失败）时不抛错，全程走旧表且不反复重试 ==')
  {
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'nohost', cwd: cwd, noHost: true, localStorage: { 'dsws.bannerFold': JSON.stringify({ [KEY_OF(cwd)]: 1 }) } })
    let threw = false
    let read = null
    let write = null
    try { read = env.mod.viewFlagOf(cwd, 'bannerFolded'); write = env.mod.setViewFlag(cwd, 'bannerFolded', false) } catch (e) { threw = true }
    check(threw === false, '没有宿主可问时，读与写都不抛错。')
    check(read === true, '没有宿主时读回旧表里的值（兜底读）。', JSON.stringify(read))
    check(write === false, '没有宿主时写这一笔不接（返回 false，调用方按老办法写旧表）。', JSON.stringify(write))
    check(env.calls.length === 0, '没有宿主时一次电话都没发出去。', JSON.stringify(env.calls))
  }
  {
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'readfail', cwd: cwd, failMode: 'throw', localStorage: { 'dsws.bannerFold': JSON.stringify({ [KEY_OF(cwd)]: 1 }) } })
    let threw = false
    const vals = []
    try {
      for (let i = 0; i < 4; i++) { vals.push(env.mod.viewFlagOf(cwd, 'bannerFolded')); env.mod.setViewFlag(cwd, 'bannerFolded', false) }
    } catch (e) { threw = true }
    check(threw === false, '读电话失败（手机自己坏了）时读与写都不抛错。')
    check(vals.every((v) => v === true), '读电话失败之后全程走旧表（四次读都是旧表里的 true）。', JSON.stringify(vals))
    await sleep(60)
    check(env.calls.filter((c) => c.method === 'wf.getSettings').length === 1, '读电话只问过一次，失败之后不反复重试。', JSON.stringify(env.calls.map((c) => c.method)))
    check(env.logs.some((l) => l.event === 'host.call.fail' && l.fields && l.fields.method === 'wf.getSettings'), '读失败也留下一行日志（沿用既有的 host.call.fail）。', JSON.stringify(env.logs))
  }
  {
    // 写电话回了 ok:false（宿主明确说这次写不成）时，同样按兜底处理：把值写回旧键，不让这一笔凭空消失。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'refuse', cwd: cwd, failMode: 'refuse', localStorage: { 'dsws.bannerFold': JSON.stringify({ [KEY_OF(cwd)]: 1 }) } })
    check(env.mod.setViewFlag(cwd, 'bannerFolded', false) === true, '手机答 ok:false 之前，这一笔先按能写接下来。')
    await wait(env)
    const oldMap = JSON.parse(env.ls.getItem('dsws.bannerFold') || '{}')
    check(oldMap[KEY_OF(cwd)] === undefined, '宿主说写不成之后，取消这一笔写了回旧键（旧键那把折叠记录被删掉，与改动前取消收起的做法一致）。', JSON.stringify(oldMap))
    check(env.mod.viewFlagOf(cwd, 'bannerFolded') === false, '内存里这一格是刚点的那一下（false）——不假装写成功了，也不把用户刚做的动作弹回去。')
    check(env.logs.some((l) => l.event === 'host.call.fail' && l.fields && l.fields.method === 'wf.setSettings'), '被宿主拒绝的那一次留下一行日志。', JSON.stringify(env.logs))
  }

  // ── 第七件事（之二）：接线与行数 ──
  console.log('')
  console.log('== 第七件事之二：五份文件都 ≤350 行 ==')
  {
    const nView = countLines(VIEW_REL)
    check(nView <= 350, '「键与文档、读、把文档交给界面」那一片不超过三百五十行，实得 ' + nView + ' 行。')
    const nViewState = countLines(VIEW_STATE_REL)
    check(nViewState <= 350, '拆出来的「加载状态与订阅」那一片不超过三百五十行，实得 ' + nViewState + ' 行。')
    const nViewWrite = countLines(VIEW_WRITE_REL)
    check(nViewWrite <= 350, '拆出来的「写这一趟」那一片不超过三百五十行，实得 ' + nViewWrite + ' 行。')
    const nPrefs = countLines('src/client/kernel/store-prefs.js')
    check(nPrefs <= 350, 'store-prefs.js 不超过三百五十行，实得 ' + nPrefs + ' 行。')
    const nMark = countLines('src/client/views/SubworkspaceMark.js')
    check(nMark <= 350, 'SubworkspaceMark.js 不超过三百五十行，实得 ' + nMark + ' 行。')
    const nIdx = countLines('src/client/index.js')
    check(nIdx <= 350, 'src/client/index.js 不超过三百五十行（新标记是在原地换掉一行注释腾出来的位子），实得 ' + nIdx + ' 行。')
  }

  // ── 第八件事：文档还在路上时不许下结论（就绪查询、问完通知、自动展开的三档判决）──
  console.log('')
  console.log('== 第八件事：设置文档还在路上时先不判，等它到手（或判定问不到）再判一次 ==')
  {
    // ① 就绪的确切意思：还没人问过、正问着都算没就绪；问到了、问不到都算就绪。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'ready', cwd: cwd })
    check(env.mod.viewFlagReadyNow() === false, '还没有人开始问宿主时不算就绪（此刻给出的判断没有问过真源）。')
    env.mod.viewFlagOf(cwd, 'subwsMarkAutoShown')
    check(env.mod.viewFlagReadyNow() === false, '读文档这条电话还在路上时也不算就绪（答复没到手就不许拿它下结论）。')
    await sleep(80)
    check(env.mod.viewFlagReadyNow() === true, '文档到手之后算就绪（这时给出的判断才问过真源）。')
  }
  {
    // ② 手机不通：没有宿主可问，这一趟当场就结束了，所以当场算就绪 —— 这时读口按旧 localStorage 键答。
    //   老用户「同一个工作区只自动展开一次」的记录正是记在旧表里的，不能因为问不到就永远不判。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'ready-nohost', cwd: cwd, noHost: true })
    env.mod.viewFlagOf(cwd, 'subwsMarkAutoShown')
    check(env.mod.viewFlagReadyNow() === true, '没有宿主可问时也算就绪（问不到也是这一趟的结论，判断按旧表走）。')
  }
  {
    // ③ 读电话失败（手机自己坏了）：答复一到就算这一趟结束，同样算就绪。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'ready-fail', cwd: cwd, failMode: 'throw' })
    env.mod.viewFlagOf(cwd, 'subwsMarkAutoShown')
    check(env.mod.viewFlagReadyNow() === false, '读电话还没失败回来时仍不算就绪（和还在路上是同一种状态）。')
    await sleep(80)
    check(env.mod.viewFlagReadyNow() === true, '读电话失败（手机自己坏了）之后也算就绪（读口这时回退旧表）。')
  }
  {
    // ④ 订阅：加载结束时叫一次；已经结束时登记就立刻叫一次；返回的取消函数挡得住后续回调。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'subscribe', cwd: cwd })
    let hits = 0
    const off = env.mod.viewFlagSubscribe(function () { hits += 1 })
    check(typeof off === 'function', '登记返回一个取消登记的函数（调用方在卸载时用它）。', typeof off)
    check(hits === 0, '登记时还没问完，回调不当场调（问完那一声才叫它）。')
    env.mod.viewFlagOf(cwd, 'subwsMarkAutoShown') // 起这一次问话
    check(hits === 0, '问话还在路上时回调仍然不调（没到终点就不叫）。')
    await sleep(80)
    check(hits === 1, '加载结束时回调被调一次（成功或失败都算结束）。', '实得 ' + hits + ' 次')
    let late = 0
    const offLate = env.mod.viewFlagSubscribe(function () { late += 1 })
    check(late === 1, '已经结束之后才登记的回调立刻被调一次（晚来的调用方不会永远等不到那一声）。', '实得 ' + late + ' 次')
    let threw = false
    try { offLate() } catch (e) { threw = true }
    check(threw === false, '已经结束时拿到的那张取消登记单子照常能调（是空动作，不抛错）。')

    const env2 = makeEnv({ tag: 'unsubscribe', cwd: cwd })
    let cancelled = 0
    const off2 = env2.mod.viewFlagSubscribe(function () { cancelled += 1 })
    off2()
    env2.mod.viewFlagOf(cwd, 'subwsMarkAutoShown')
    await sleep(80)
    check(env2.mod.viewFlagReadyNow() === true, '这一趟照样问完了（取消登记只影响那一个回调，不影响加载本身）。')
    check(cancelled === 0, '取消登记之后加载结束不再叫它（返回的那个函数真的挡得住）。', '实得 ' + cancelled + ' 次')
  }
  {
    // ⑤ 判决面：挂载那一刻文档还在路上、标记还没记过时不许判成「要展开」；文档到手之后按真源判。
    //   这里用的是真内核那两个读口（viewFlagReadyNow / viewFlagOf）加真组件里那个纯判据 subwsMarkAutoDecide；
    //   「文档到手后效果重跑一次」这件事由真订阅推动 —— 登记的回调被叫到时再判一遍，正是组件里那个计数干的事。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const decideFn = autoDecideFn()
    const env = makeEnv({ tag: 'decide-open', cwd: cwd })
    const decide = function () { return decideFn(env.mod.viewFlagReadyNow(), env.mod.viewFlagOf(cwd, 'subwsMarkAutoShown')) }
    const seen = [decide()] // 挂载那一刻：文档还在路上
    env.mod.viewFlagSubscribe(function () { seen.push(decide()) })
    await sleep(80)
    check(seen[0] === 'wait', '文档还没到时第一判是 wait（先不弹，等问过真源再判）—— 这就是 #650「只弹一次」退化的那一处。', JSON.stringify(seen))
    check(seen[1] === 'open', '文档到手、里面没记过这个工作区时，重跑那一判是 open（该弹这一次）。', JSON.stringify(seen))
    check(decideFn(false, false) === 'wait' && decideFn(false, true) === 'wait',
      '就绪为假时，不管旧表那一版答案是什么都是 wait（没问过真源就不下结论，这一档与「不弹」是两件事）。')
    check(decideFn(true, false) === 'open' && decideFn(true, true) === 'skip' && decideFn(true, undefined) === 'open',
      '就绪为真时按真源答案分两档：没记过就 open、记过就 skip（答案缺失当成没记过）。')
  }
  {
    // ⑥ 文档到手、里面没有这一条，但旧键记过：重跑那一判仍是 skip —— 过渡期的老用户照样只弹一次。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const decideFn = autoDecideFn()
    const env = makeEnv({ tag: 'decide-legacy', cwd: cwd, localStorage: { 'dsws.subwsAutoShown': JSON.stringify({ [KEY_OF('D:\\ilife')]: 1 }) } })
    const decide = function () { return decideFn(env.mod.viewFlagReadyNow(), env.mod.viewFlagOf(cwd, 'subwsMarkAutoShown')) }
    const seen = [decide()]
    env.mod.viewFlagSubscribe(function () { seen.push(decide()) })
    await sleep(80)
    check(seen[0] === 'wait' && seen[1] === 'skip',
      '文档到手但里面没有这一条时，回退读旧键，重跑那一判是 skip（老用户「只弹一次」的记录不因为搬家而丢）。', JSON.stringify(seen))
  }
  {
    // ⑦ 设置文件里已经记过：重跑那一判是 skip（文件里的记录说了算，不再打扰）。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const decideFn = autoDecideFn()
    const env = makeEnv({ tag: 'decide-doc', cwd: cwd })
    const preset = {
      version: 1,
      ui: { stateFilter: '', sortKey: '', sortDir: '', labelClicks: {} },
      workspaces: { 'D:\\ilife': { bannerFolded: false, noRepoDismissed: false, subwsMarkAutoShown: true } },
      debug: { enabled: false, sampleRate: 1 },
      templates: {},
    }
    const w = await store.writeLocalSettings(preset, env.home, realIo)
    check(w.ok === true, '预置一份设置文件，里面记着这个工作区已经自动展开过。', JSON.stringify(w))
    const decide = function () { return decideFn(env.mod.viewFlagReadyNow(), env.mod.viewFlagOf(cwd, 'subwsMarkAutoShown')) }
    const seen = [decide()]
    env.mod.viewFlagSubscribe(function () { seen.push(decide()) })
    await sleep(80)
    check(seen[0] === 'wait' && seen[1] === 'skip',
      '设置文件里记过时，重跑那一判是 skip（真源说了算，同一个工作区不再自动展开第二次）。', JSON.stringify(seen))
  }
  {
    // ⑧ 设置视图认不出这个工作区的根、组件却认得（st.snapshot.workspaceRoot 那一路）时，旧表那份记录照样算数。
    //   这一条是复核 d9d0e50a 时量出来的窄残留：此前读口只在 viewFlagOf 整个不在时才回旧表，于是这种组合下
    //   答 false，判决从迁移前的 skip 变成每次挂载都 open —— 同一个工作区白弹一次浮层（#650 要的是只弹一次）。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const shownFn = shownBeforeFn()
    const decideFn = autoDecideFn()
    check(shownFn(false, true, true) === false, '设置视图答得出这一格时以它为准（文件里说没展开过，旧表里那条不作数）。')
    check(shownFn(true, true, false) === true, '设置视图答得出这一格、文件里说展开过时算展开过（旧表空着也照它）。')
    check(shownFn(false, false, true) === true && shownFn(false, false, false) === false,
      '认不出根时回退旧表那一份：旧表记过算展开过，没记过才算没展开过。')
    // 真内核那一侧：一个谁都没报过根的目录（折算表空、会话对象上没有根）—— 写键为空就是「答不出这一格」。
    //   root: '' 就是「这条会话没有工作区根」那一档（makeEnv 的默认值会把根教给这一片，这里必须按缺席造）。
    const env = makeEnv({ tag: 'decide-unknown-root', cwd: cwd, root: '', localStorage: { 'dsws.subwsAutoShown': JSON.stringify({ [KEY_OF('D:\\ilife')]: 1 }) } })
    const canAnswer = (env.mod.viewFlagWriteKeyOf(cwd) !== '')
    const docAnswer = env.mod.viewFlagOf(cwd, 'subwsMarkAutoShown') === true
    await sleep(80)
    check(canAnswer === false && docAnswer === false, '认不出根时设置视图这一侧答不出这一格（写键为空、读口回 false）。', JSON.stringify({ canAnswer: canAnswer, docAnswer: docAnswer }))
    // 组件自己认得根（浮层出现的前提就是它认得），旧表里那条记录正记在这个根那把折算键上。
    const shownBefore = shownFn(docAnswer, canAnswer, true)
    check(decideFn(env.mod.viewFlagReadyNow(), shownBefore) === 'skip',
      '但组件认得根、旧表里记过，判决仍是 skip（不因为设置视图这一刻认不出根就白弹一次）。')
  }
  {
    // ⑨ 真渲染一遍（真 jsdom + 真 React）：把「设置文档迟到」那一刻真的画出来看浮层弹没弹。
    //   为什么非画不可：前面几条断的都是「就绪口、订阅口、判决函数各自对不对」，而这次回退的病因恰恰在
    //   「三者都对、组件却把它们用错了地方」—— 挂载时没等文档就弹（#666 那次也是「纯函数全对、组件却每次返回 null」）。
    //   为什么不走 tests/lib/render-subws-mark.js 那把现成的渲染工具：它的闭包名字表是固定的
    //   （keyOf/tr/Tip/host/React/h/localStorage/chainStep），这一片的名字（viewFlagOf / viewFlagReadyNow /
    //   viewFlagSubscribe / setViewFlag）一个都不在里面，喂不进新的那条路；改那把工具不在本次改动范围内。
    //   所以这里照同一套做法自己装一次，参数表把这一片的名字一并列上；浮层文案仍从真 locale 取（不另抄一份）。
    //   内核那一片在这里是替身（就绪、订阅、读三个口子，语义与①～⑦量过的真件一致）：真件的行为上面已经逐条量过，
    //   这一条量的是组件拿这三个口子用对没有。
    const { JSDOM } = require('jsdom')
    const React = require('react')
    const ReactDOMClient = require('react-dom/client')
    const { act } = React
    const { tipsFromLocale } = require('./lib/render-subws-mark.js')
    const tips = tipsFromLocale()
    const MARK_SRC = noExport(readText('src/client/views/SubworkspaceMark.js'))
    const ROOT_DIR = 'D:\\ilife'
    const SUB_DIR = 'D:\\ilife\\packages\\skill-calorie'
    // 画一次：opts.doc 是文档到手后里面记的那一格，opts.legacyShown 是旧键里记过没有，
    //   opts.readyAtOnce 模拟「手机不通」那一档（问话当场结束、当场就绪）。
    const drawMark = async function (opts) {
      const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:59519/' })
      const { window } = dom
      global.window = window
      global.document = window.document
      global.Node = window.Node
      global.HTMLElement = window.HTMLElement
      global.IS_REACT_ACT_ENVIRONMENT = true
      window.IS_REACT_ACT_ENVIRONMENT = true
      if (opts.legacyShown) window.localStorage.setItem('dsws.subwsAutoShown', JSON.stringify({ [KEY_OF(ROOT_DIR)]: 1 }))
      const k = { ready: opts.readyAtOnce === true, doc: null, waiters: [] }
      const readyNow = function () { return k.ready }
      const subscribe = function (fn) {
        if (k.ready) { fn(); return function () {} }
        k.waiters.push(fn)
        return function () { const i = k.waiters.indexOf(fn); if (i >= 0) k.waiters.splice(i, 1) }
      }
      const readFlag = function (cwd, name) {
        if (k.doc && Object.prototype.hasOwnProperty.call(k.doc, name)) return k.doc[name] === true
        // 认不出根那一档（E/F）、以及认得的是另一个根那一档（G/H）都照真内核的样子答：它查的是自己认得
        //   那个根那一格，本组件手上这个根的那条它读不到，于是答 false（G/H 里旧键明明记过也读不回来）。
        if (opts.kernelCantResolve === true || opts.kernelOtherRoot) return false
        try { const raw = window.localStorage.getItem('dsws.subwsAutoShown'); const m = raw ? JSON.parse(raw) : null; return !!(m && m[KEY_OF(ROOT_DIR)]) } catch (e) { return false }
      }
      const tipCalls = []
      // 按根读写那一对（2026-10-12 复核 Q2 之后组件走的主路）的调用记录：这一组要量的是「组件把哪把根递下来」。
      const rootCalls = []
      const Tip = function (props) { tipCalls.push(props || {}); return React.createElement('span', null, (props || {}).children) }
      const factory = compileFn(
        ['keyOf', 'tr', 'Tip', 'host', 'React', 'h', 'localStorage', 'chainStep', 'viewFlagOf', 'viewFlagReadyNow', 'viewFlagSubscribe', 'setViewFlag', 'viewFlagWriteKeyOf', 'viewFlagOfRoot', 'setViewFlagRoot'],
        MARK_SRC + '\nreturn SubworkspaceMark'
      )
      const Comp = factory(KEY_OF,
        function (key) { return (key === 'panel.wsMarkTip') ? tips[0] : key },
        Tip,
        { call: function () { return Promise.resolve({ ok: true }) } },
        React, React.createElement, window.localStorage, function () { return null },
        readFlag, readyNow, subscribe, function () { return true },
        // 这一片认不认得出本工作区的根：E/F 两档造的是「认不出」（写键为空），G/H 两档造的是「认得出，
        //   但认得的是另一个工作区根」（写键非空却指向别的根），其余档照常认得出本工作区这个根。
        (opts.kernelCantResolve === true) ? function () { return '' }
          : (opts.kernelOtherRoot ? function () { return KEY_OF(opts.kernelOtherRoot) } : function () { return KEY_OF(ROOT_DIR) }),
        // 按根读：照真内核的语义答 —— 文件里这个根这一格有真假值才算答得出（known:true），否则 known:false。
        //   替身里 k.doc 代表「文件里本工作区（ROOT_DIR）这条记录」，所以只有问的是这个根时才答得出。
        function (root, name) {
          rootCalls.push({ kind: 'read', root: root, name: name })
          if (KEY_OF(root) === KEY_OF(ROOT_DIR) && k.doc && typeof k.doc[name] === 'boolean') return { known: true, value: k.doc[name] }
          return { known: false, value: false }
        },
        // 按根写：记下组件递下来的那把根（这一组量的是键，不量落盘；落盘那一趟在第十七件事里用真件量）。
        function (root, name, value, cwd) {
          rootCalls.push({ kind: 'write', root: root, name: name, value: value, cwd: cwd })
          return opts.rootWriteRefused === true ? false : true
        })
      const container = window.document.createElement('div')
      window.document.body.appendChild(container)
      let root = null
      const settle = async function (ms) { await act(async function () { await new Promise(function (r) { setTimeout(r, ms) }) }) }
      const opens = function () { return tipCalls.filter(function (c) { return c.visible === true }).length }
      await act(async function () { root = ReactDOMClient.createRoot(container) })
      await act(async function () { root.render(React.createElement(Comp, { st: { cwd: SUB_DIR, snapshot: { workspaceRoot: ROOT_DIR } } })) })
      await settle(15)
      const before = opens()
      // 文档到达：真内核收口时就是叫订阅过的那几位（viewFlagNotifySettled），这里照同一种做法叫一声。
      k.doc = opts.doc || null
      k.ready = true
      await act(async function () { const ws = k.waiters.splice(0, k.waiters.length); for (let i = 0; i < ws.length; i++) ws[i]() })
      await settle(25)
      const after = opens()
      try { await act(async function () { root.unmount() }) } catch (e) {}
      return { before: before, after: after, rootCalls: rootCalls, tipCalls: tipCalls, legacyRaw: window.localStorage.getItem('dsws.subwsAutoShown') }
    }
    // A：回退现场 —— 设置文件里记着这个工作区已经自动展开过，而文档还没到手、旧键里没记过。
    //   修复前：挂载当场就按旧键弹一次（before 会是 1），文档到手也不收回，于是每进一次子目录会话白弹一次。
    const a = await drawMark({ doc: { subwsMarkAutoShown: true } })
    check(a.before === 0 && a.after === 0,
      'A 文档里记过、旧键没记过时，浮层一次都不自动展开（文档没到先不弹，到手后按真源判成不弹）。', JSON.stringify(a))
    // B：第一次进这个工作区 —— 文档没到先不弹，到手后按真源判、弹这一次（该弹的还是要弹）。
    const b = await drawMark({ doc: { bannerFolded: false } })
    check(b.before === 0 && b.after === 1,
      'B 文档里没记过时，文档到手后弹一次（不是「干脆不弹了」：该弹的那一次照弹）。', JSON.stringify(b))
    // C：老用户 —— 旧键记过、文档里没有这一条，兜底读旧键，照样一次都不弹（老行为不丢）。
    const c = await drawMark({ legacyShown: true, doc: { bannerFolded: false } })
    check(c.before === 0 && c.after === 0,
      'C 旧键记过、文档里没有这一条时一次都不弹（过渡期的老用户照样只弹一次）。', JSON.stringify(c))
    // D：手机不通 —— 这一趟当场就结束（就绪为真），判断按旧键走：没记过就当场弹一次（老行为不丢）。
    const d = await drawMark({ readyAtOnce: true })
    check(d.before === 1 && d.after === 1,
      'D 手机不通时按旧键当场弹一次（问不到真源不等于永远不弹，老行为照旧）。', JSON.stringify(d))
    // E：设置视图认不出这个工作区的根、组件自己认得（st.snapshot.workspaceRoot 那一路）、旧键里记过。
    //   复核 d9d0e50a 时量出来的窄残留就在这里：从前只在「读口整个不在」时才回旧键，这种组合下答 false，
    //   于是每挂载一次白弹一次（#650 要的是同一个工作区只弹一次）。
    const e = await drawMark({ legacyShown: true, kernelCantResolve: true })
    check(e.before === 0 && e.after === 0,
      'E 设置视图认不出根时，组件按自己认得的根读旧键：记过就不弹（不因为这一刻认不出根就白弹一次）。', JSON.stringify(e))
    // F：同一档，但旧键里没记过 —— 该弹的那一次照弹（读不到不等于已经弹过，别把两者混成一件事）。
    const f = await drawMark({ kernelCantResolve: true })
    check(f.before === 0 && f.after === 1,
      'F 认不出根、旧键里也没记过时，文档到手后照弹一次（读不到不等于已经弹过）。', JSON.stringify(f))
    // G：设置视图认得的是**另一个**工作区根（内核那张折算表里还留着旧条目），组件自己认得手上这个根、
    //   旧键里也记过。只问「认不认得出根」不够：那时读口答的是别的根那一格（读不回来，答 false），
    //   判决会从「不弹」翻成「弹」，这个工作区又白弹一次 —— 与 E 档同一个症状，触发条件换了一个。
    const g = await drawMark({ legacyShown: true, kernelOtherRoot: 'D:\\other-ws' })
    check(g.before === 0 && g.after === 0,
      'G 设置视图认得的根与组件手上这个不是同一条目录时，按旧键读：记过就不弹（认得别的根不算答得出这一格）。', JSON.stringify(g))
    // H：同一档，旧键里没记过 —— 该弹的那一次照弹（退回旧表不等于干脆不弹了）。
    const h = await drawMark({ kernelOtherRoot: 'D:\\other-ws' })
    check(h.before === 0 && h.after === 1,
      'H 认得的是别的根、旧键里也没记过时，文档到手后照弹一次（与 F 档同一口径）。', JSON.stringify(h))
    // I：内核那把折算表指向别的根，而文件里明明记着本工作区这一格（2026-10-12 复核 Q2 的现场）。
    //   主路（按根读）在这一档要赢：文件是唯一真源，问得出就不该退回旧表 —— 退回就等于每开一次窗白弹一次。
    const i = await drawMark({ doc: { subwsMarkAutoShown: true }, kernelOtherRoot: 'D:\\other-ws' })
    check(i.before === 0 && i.after === 0,
      'I 文件里记过、内核认得的是别的根时，按组件手上那把根读得到这一格，一次都不弹（主路赢过内核那张缓存表）。', JSON.stringify(i))
    check(i.rootCalls.some(function (c) { return c.kind === 'read' && c.root === ROOT_DIR }),
      'I 组件问的是自己手上那把工作区根（不是会话目录，也不是内核那张表认得的别的根）。', JSON.stringify(i.rootCalls))
    // J：同一档但文件里没这一格 —— 主路答「问不出」，退回旧表那一条路照旧兜住（旧键记过就不弹）。
    const j = await drawMark({ legacyShown: true, kernelOtherRoot: 'D:\\other-ws' })
    check(j.before === 0 && j.after === 0,
      'J 文件里问不出这一格时退回旧表那一份：旧键记过就不弹（退回不等于干脆不弹了）。', JSON.stringify(j))
    // K：写这一笔也按组件手上那把根（读写的键必须是同一把，不然同一份状态读在一把键、写在另一把键）。
    const kk = await drawMark({ readyAtOnce: true })
    check(kk.before === 1 && kk.after === 1, 'K 先照常自动展开一次（这一档要的是「收起」那一笔写在哪把键上）。', JSON.stringify({ before: kk.before, after: kk.after }))
    const lastTip = kk.tipCalls.filter(function (c) { return typeof c.onVisibleChange === 'function' }).pop()
    check(!!lastTip, 'K 浮层把「收起」这件事报出来（组件靠它记下这个工作区已经自动展开过）。')
    if (lastTip) await act(async function () { lastTip.onVisibleChange(false) })
    const w = kk.rootCalls.filter(function (c) { return c.kind === 'write' })[0]
    check(!!w && w.root === ROOT_DIR && w.name === 'subwsMarkAutoShown' && w.value === true && w.cwd === SUB_DIR,
      'K 收起那一笔记在组件手上这把工作区根上（与读口同一把键，不按会话目录另算一把）。', JSON.stringify(kk.rootCalls))
    check(kk.legacyRaw === null, 'K 这一笔被新路接下之后，旧键一个字都没写（两处都写就是两份真相）。', String(kk.legacyRaw))
    console.log('    （说明）这一组用的是真 jsdom + 真 React，但内核那一片是符合契约的替身、宿主是替身；')
    console.log('    （说明）真机上那一趟（真宿主、真设置文件）仍由人工验证兜底，画法本身由 verify-666 的 E 组兜住。')
  }

  // ── 第九件事：写失败的那一笔不许丢 ──
  console.log('')
  console.log('== 第九件事：写失败时那一笔留在待写队列里，下一趟写把它落进文件（瞬时故障自愈） ==')
  {
    // 第一次落盘失败、之后恢复正常：这一笔必须自己活过来，不能因为「用户没再点」就永远留在半路上。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    let failNext = 1
    const env = makeEnv({
      tag: 'keepqueue', cwd: cwd,
      fsOverrides: { writeFile: async (p, text, enc) => { if (failNext > 0) { failNext -= 1; throw failCode('EPERM', 'operation not permitted') } return realFs.writeFile(p, text, enc) } },
    })
    check(env.mod.setViewFlag(cwd, 'bannerFolded', true) === true, '写这一笔时先按能写接下来（落盘失败再走过渡）。')
    // 等到旧键真的落地再断言（复核建议：固定 700 毫秒要装下 500 毫秒防抖加一次真写，机器忙时会假红）。
    await waitFor(() => { try { return JSON.parse(env.ls.getItem('dsws.bannerFold') || '{}')[KEY_OF(cwd)] === 1 } catch (e) { return false } })
    const oldMap = JSON.parse(env.ls.getItem('dsws.bannerFold') || '{}')
    check(oldMap[KEY_OF(cwd)] === 1, '第一趟写失败时照旧把这一格写回旧键做过渡（与改动前一致）。', JSON.stringify(oldMap))
    await waitFor(async () => { const d = await readDoc(env.home); return !!d && !!d.workspaces['D:\\ilife'] && d.workspaces['D:\\ilife'].bannerFolded === true })
    const doc = await readDoc(env.home)
    check(!!doc && !!doc.workspaces['D:\\ilife'] && doc.workspaces['D:\\ilife'].bannerFolded === true,
      '这一笔没有被丢掉：失败后留在待写队列里，后面那一趟把它落进了文件（盘上这一格是 true）。', JSON.stringify(doc && doc.workspaces))
    const writes = env.calls.filter((c) => c.method === 'wf.setSettings').length
    check(writes >= 2, '失败之后又试了一趟（不是失败一次就再也不管），实得 ' + writes + ' 次写电话。')
  }
  {
    // 旧表这一步自己写不进去（浏览器存储满、被策略挡住）时，补一行 storage.fail，不再一口吞掉。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'lsfail', cwd: cwd, fsOverrides: { writeFile: async () => { throw failCode('EPERM', 'operation not permitted') } } })
    env.ls.setItem = function () { throw new Error('这份浏览器存储写不进去了') }
    env.mod.setViewFlag(cwd, 'bannerFolded', true)
    await waitFor(() => env.logs.some((l) => l.event === 'storage.fail' && l.fields && l.fields.op === 'write' && l.fields.key === 'dsws.bannerFold'))
    const hit = env.logs.filter((l) => l.event === 'storage.fail' && l.fields && l.fields.op === 'write' && l.fields.key === 'dsws.bannerFold')
    check(hit.length >= 1, '写旧表这一步自己失败时补了一行 storage.fail（沿用既有事件名，键与操作写在字段里）。', JSON.stringify(env.logs))
    check(fs.existsSync(settingsPathIn(env.home)) === false, '这一趟文件始终没写进去（写失败不是「换一份假的写成功」）。')
  }

  // ── 第十件事：同一格在这一趟飞在天上时被改过，不许被回包一起划掉 ──
  console.log('')
  console.log('== 第十件事：一趟写飞在天上时用户又改了同一格，回包只划「值没被改过」的那几笔 ==')
  {
    // 实测到的现场：收起之后 500 毫秒内又点开。第一趟发出去的是 true，飞在天上时用户点了 false；
    //   回包若按名字盲删，队列就空了、第二趟再也不会来 —— 盘上留 true、内存是 false，两边从此不一致。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const box = {}
    const env = makeEnv({
      tag: 'inflight', cwd: cwd,
      onCall: function (method) {
        if (method === 'wf.setSettings' && !box.done) { box.done = true; box.mod.setViewFlag(cwd, 'bannerFolded', false) }
      },
    })
    box.mod = env.mod
    check(env.mod.setViewFlag(cwd, 'bannerFolded', true) === true, '先点一下收起（这一笔排进待写队列）。')
    await waitFor(() => env.calls.filter((c) => c.method === 'wf.setSettings').length >= 2)
    const sent = env.calls.filter((c) => c.method === 'wf.setSettings')
    check(sent.length >= 2, '第一趟飞在天上时改的那一下没有被划掉：真的又排了第二趟写，实得 ' + sent.length + ' 次。')
    const firstEntry = sent[0] && sent[0].args && sent[0].args.value && sent[0].args.value.workspaces['D:\\ilife']
    check(!!firstEntry && firstEntry.bannerFolded === true, '第一趟发出去的确实是当时那个值 true（这一条才有东西可丢）。', JSON.stringify(firstEntry))
    const doc = await readDoc(env.home)
    check(!!doc && !!doc.workspaces['D:\\ilife'] && doc.workspaces['D:\\ilife'].bannerFolded === false,
      '盘上留下的是后改的那个值 false（不是第一趟那个 true）。', JSON.stringify(doc && doc.workspaces))
    check(env.mod.viewFlagOf(cwd, 'bannerFolded') === false, '内存里也是后改的那个值 false —— 盘上与内存一致。')
  }

  // ── 第十一件事：认不出工作区根时一个字都不写文件 ──
  console.log('')
  console.log('== 第十一件事：认不出工作区根时不写文件（写下去会留下永远合并不到一起的孤儿记录） ==')
  {
    const cwd = 'D:\\scratch\\no-repo\\sub'
    const env = makeEnv({ tag: 'noroot', cwd: cwd, root: '' })
    check(env.mod.viewFlagWriteKeyOf(cwd) === '', '认不出工作区根时，写这一侧要用的键是空串（不退到会话目录）。', JSON.stringify(env.mod.viewFlagWriteKeyOf(cwd)))
    check(env.mod.setViewFlag(cwd, 'bannerFolded', true) === false, '认不出工作区根时写这一笔不接（返回 false，调用方照改动前的老办法写旧表）。')
    await wait(env)
    check(env.calls.filter((c) => c.method === 'wf.setSettings').length === 0, '认不出工作区根时一次写电话都没发出去。', JSON.stringify(env.calls.map((c) => c.method)))
    check(fs.existsSync(settingsPathIn(env.home)) === false, '设置文件一个字节都没写（不会留下一条读不回来、也永远不会被合并的孤儿记录）。')
    check(env.ls.getItem('dsws.bannerFold') === null, '这一片自己也不写旧键（旧键由调用方按老办法写，这一片不替它写）。')
    check(env.mod.viewFlagOf(cwd, 'bannerFolded') === false, '读这一侧照旧答得出来（文档里没有这一条，回旧表里的 false）。')
    // 根认出来之后（同一台机器上 wf.cwd 回过话），键就是根的可读路径，记录落在根上而不是会话目录上。
    env.st.sessionWorkspaceRoot = 'd:\\scratch\\no-repo'
    check(env.mod.viewFlagWriteKeyOf(cwd) === 'D:\\scratch\\no-repo', '根认出来之后，写这一侧的键就是根的可读路径。', JSON.stringify(env.mod.viewFlagWriteKeyOf(cwd)))
  }

  // ── 第十二件事：真正要写之前先重读一次文件，把本窗改过的那几格合并进最新那一份 ──
  console.log('')
  console.log('== 第十二件事：写之前重读一次，另一扇窗刚写进去的别的格不许被本窗整份顶掉 ==')
  {
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'twowin', cwd: cwd })
    const preset = {
      version: 1,
      ui: { stateFilter: '', sortKey: '', sortDir: '', labelClicks: {} },
      workspaces: { 'D:\\ilife': { bannerFolded: false, noRepoDismissed: false, subwsMarkAutoShown: false } },
      debug: { enabled: false, sampleRate: 1 },
      templates: {},
    }
    const w0 = await store.writeLocalSettings(preset, env.home, realIo)
    check(w0.ok === true, '预置一份别人写过的设置文件（这个工作区已经有一条记录）。', JSON.stringify(w0))
    check(env.mod.setViewFlag(cwd, 'bannerFolded', true) === true, '本窗在预置文件的基础上写自己那一格（此刻还在防抖窗口里）。')
    await sleep(80) // 让本窗那一次懒读落地：内存里那一份是别人写的那一版
    // 另一扇窗此刻把**别的**那一格写进同一个文件 —— 这一笔本窗没有读到过（客户端只在第一页懒读一次）。
    const other = Object.assign({}, preset, { workspaces: { 'D:\\ilife': { bannerFolded: false, noRepoDismissed: false, subwsMarkAutoShown: true } } })
    const w1 = await store.writeLocalSettings(other, env.home, realIo)
    check(w1.ok === true, '另一扇窗把 subwsMarkAutoShown 写成了 true。', JSON.stringify(w1))
    await wait(env)
    const doc = await readDoc(env.home)
    check(!!doc && !!doc.workspaces['D:\\ilife'] && doc.workspaces['D:\\ilife'].subwsMarkAutoShown === true,
      '另一扇窗刚写进去的**别的**那一格没有被本窗整份顶掉（写之前重读了一遍文件）。', JSON.stringify(doc && doc.workspaces))
    check(!!doc && !!doc.workspaces['D:\\ilife'] && doc.workspaces['D:\\ilife'].bannerFolded === true,
      '本窗改的那一格照样写进去了（重读没有把本窗的改动丢掉）。', JSON.stringify(doc && doc.workspaces))
    const gets = env.calls.filter((c) => c.method === 'wf.getSettings').length
    check(gets >= 2, '真正要写之前又读了一次文件（不是只有第一页那一次懒读），实得 ' + gets + ' 次读电话。')
    check(env.mod.viewFlagOf(cwd, 'bannerFolded') === true && env.mod.viewFlagOf(cwd, 'subwsMarkAutoShown') === true,
      '写完这一趟之后内存里那份文档与盘上一致（两格都是 true）。')
  }

  // ── 第十三件事：读与写对「认不认得工作区根」必须给同一个答案（M5 回归） ──
  console.log('')
  console.log('== 第十三件事：客户端已经从别的路认出工作区根时，用户点一下要真的落盘（不许读得到、写说认不出） ==')
  {
    // 实测到的现场：本会话对象上还没有根，但内核那张「所选目录的键 → 工作区根」的表里已经有一条，
    //   文件里也有这个工作区的一条记录（横幅是收起的）。此时用户点开横幅：
    //   从前读这一侧从表里认出根、答得出一条记录，写这一侧只认会话对象上的根、答认不出 —— 写这一笔直接不接，
    //   旧键写了也没人读，界面上一看横幅又弹回来（同一条路也让浮层「自动展开过」退化成每进一次子目录白弹一次）。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'm5', cwd: cwd, root: '', rootByKey: { [KEY_OF(cwd)]: KEY_OF('D:\\ilife') } })
    const preset = {
      version: 1,
      ui: { stateFilter: '', sortKey: '', sortDir: '', labelClicks: {} },
      workspaces: { 'D:\\ilife': { bannerFolded: true, noRepoDismissed: false, subwsMarkAutoShown: false } },
      debug: { enabled: false, sampleRate: 1 },
      templates: {},
    }
    const w0 = await store.writeLocalSettings(preset, env.home, realIo)
    check(w0.ok === true, '预置一份设置文件：这个工作区已经有一条记录、横幅是收起的。', JSON.stringify(w0))
    check(env.mod.viewFlagDocKeyOf(cwd) === 'D:\\ilife' && env.mod.viewFlagWriteKeyOf(cwd) === 'D:\\ilife',
      '读与写对这把键给同一个答案：都是那条工作区根（表里认得出来，就不许写口再说认不出）。',
      JSON.stringify([env.mod.viewFlagDocKeyOf(cwd), env.mod.viewFlagWriteKeyOf(cwd)]))
    // 先问一次读：这一次会把懒读起起来（文档到手之前，读这一侧先答旧表里的 false，这是过渡期的老行为）。
    check(env.mod.viewFlagOf(cwd, 'bannerFolded') === false, '文档还没到手时读这一侧先答旧表里的 false（过渡期的老行为）。')
    const ready = await waitFor(() => env.mod.viewFlagReadyNow() === true)
    check(ready, '这份设置文档读到手了（读这一侧要按真源判，不能还没问到就下结论）。')
    check(env.mod.viewFlagOf(cwd, 'bannerFolded') === true, '文档到手后读这一侧答文件里那条记录：横幅是收起的。')
    check(env.mod.setViewFlag(cwd, 'bannerFolded', false) === true, '用户点开横幅这一笔要接下来（从前这里返回 false，点了等于没反应）。')
    const landed = await waitFor(async () => { const d = await readDoc(env.home); return !!d && !!d.workspaces['D:\\ilife'] && d.workspaces['D:\\ilife'].bannerFolded === false })
    check(landed, '这一笔真的落进了文件（盘上这一格变成 false）。')
    check(env.calls.filter((c) => c.method === 'wf.setSettings').length === 1, '只发了一趟写电话（认得出根就走文件这一条路，不是又去写旧键）。', JSON.stringify(env.calls.map((c) => c.method)))
    check(env.ls.getItem('dsws.bannerFold') === null, '写文件这一条路走通了，就绝不再写旧键（两处都写就是两份真相）。')
    check(env.mod.viewFlagOf(cwd, 'bannerFolded') === false, '内存里也是 false —— 盘上与内存一致。')
  }

  // ── 第十四件事：回包划队列要按「真正写出去的那份快照」判，不是按发出前记下的值 ──
  console.log('')
  console.log('== 第十四件事：重读窗口里改过、回包前又改回原值的交错，不许把这一笔划掉 ==')
  {
    // 实测到的现场：发出 true 之后、重读回来之前用户改成 false，重读回来之后、回包之前又改回 true。
    //   从前划队列比的是「发出前记下的 true」，一看现在的值还是 true 就当成没改过、把这一笔划掉，
    //   盘上留的是中途那个 false、内存是最后的 true —— 两边从此不一致，而且用户没再点就不会自愈。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const box = { reads: 0, back: false }
    const env = makeEnv({
      tag: 'm1back', cwd: cwd,
      onCall: function (method) {
        if (method === 'wf.getSettings') { box.reads += 1; if (box.reads === 2) box.mod.setViewFlag(cwd, 'bannerFolded', false) }
        if (method === 'wf.setSettings' && !box.back) { box.back = true; box.mod.setViewFlag(cwd, 'bannerFolded', true) }
      },
    })
    box.mod = env.mod
    check(env.mod.setViewFlag(cwd, 'bannerFolded', true) === true, '先点一下收起（这一笔排进待写队列）。')
    // 等到最后一趟写真的落地（盘上回到 true），再判盘上与内存是否一致。
    const settled = await waitFor(async () => { const d = await readDoc(env.home); return !!d && !!d.workspaces['D:\\ilife'] && d.workspaces['D:\\ilife'].bannerFolded === true })
    const doc = await readDoc(env.home)
    const sent = env.calls.filter((c) => c.method === 'wf.setSettings')
    check(sent.length >= 2, '这一笔没有被误划掉：回包之后又排了一趟写，实得 ' + sent.length + ' 次写电话。')
    check(settled, '盘上最后是用户最后那一下的值 true（不是中途那个 false）。', JSON.stringify(doc && doc.workspaces))
    check(env.mod.viewFlagOf(cwd, 'bannerFolded') === true, '内存里也是 true —— 盘上与内存一致。')
  }

  // ── 第十五件事：界面偏好那三格搬进本机设置文件的 ui 节（#1012 第 3 步） ──
  console.log('')
  console.log('== 第十五件事：界面偏好（列表筛选/排序键/排序方向）搬进 ui 节，旧表 dsws.listPrefs 留着当过渡 ==')
  {
    // 文件里那一份与旧表那一份故意不同：文件里筛选是 blocked，旧表里是 all。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const oldPrefs = { sortKey: 'number', sortDir: 'asc', stateFilter: 'all' }
    const env = makeEnv({ tag: 'uipref-adopt', cwd: cwd, localStorage: { 'dsws.listPrefs': JSON.stringify(oldPrefs) } })
    const pre = await store.writeLocalSettings({ version: 1, ui: { stateFilter: 'blocked', sortKey: '', sortDir: '', labelClicks: {} }, workspaces: {}, debug: { enabled: false, sampleRate: 1 }, templates: {} }, env.home, realIo)
    check(pre && pre.ok === true, '先把一份设置文件放进临时主目录（文件里筛选是 blocked，旧表里是 all）。', JSON.stringify(pre))
    // 摆两个面板：一个本会话已经动过（用户刚点了筛选），一个没动过（建会话时照旧表画的是 all）。
    env.st.stateFilter = 'frontier'
    env.stores['sess-2'] = { cwd: cwd, sessionWorkspaceRoot: env.root, stateFilter: 'all', sortKey: 'number', sortDir: 'asc', tick: 0 }
    env.mod.settingsViewLoad()
    await waitFor(async () => env.mod.viewFlagReadyNow() === true)
    check(env.mod.listPrefs.stateFilter === 'blocked', '文档到手后，内存这一份换成文件里那一格（文件写过就以文件为准）。', env.mod.listPrefs.stateFilter)
    check(env.stores['sess-2'].stateFilter === 'blocked', '本会话还没动过的面板也跟着换成文件里那一份（建会话时它照旧表画的是 all）。', String(env.stores['sess-2'].stateFilter))
    check(env.st.stateFilter === 'frontier', '本会话已经动过的面板不被文件里的旧值顶回去（用户刚点的那一下优先）。', String(env.st.stateFilter))
    check(env.mod.listPrefs.sortKey === 'number' && env.mod.listPrefs.sortDir === 'asc', '文件里没写过的格（空串）保留旧表那一份 —— 空串的意思是「这台机器还没写过」，不是「用户选了空」。', JSON.stringify({ sortKey: env.mod.listPrefs.sortKey, sortDir: env.mod.listPrefs.sortDir }))
  }
  {
    // 点一下筛选或排序（列表面板调的就是 saveListPrefs）：写进文件这条路成了，旧键一个字节都不许动。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const oldPrefs = { sortKey: 'number', sortDir: 'asc', stateFilter: 'all' }
    const env = makeEnv({ tag: 'uipref-write', cwd: cwd, localStorage: { 'dsws.listPrefs': JSON.stringify(oldPrefs) } })
    env.mod.settingsViewLoad()
    await waitFor(async () => env.mod.viewFlagReadyNow() === true)
    env.mod.listPrefs.stateFilter = 'closed'
    env.mod.listPrefs.sortKey = 'updated'
    env.mod.saveListPrefs()
    const landed = await waitFor(async () => { const d = await readDoc(env.home); return !!d && !!d.ui && d.ui.stateFilter === 'closed' && d.ui.sortKey === 'updated' })
    check(landed, '点一下筛选或排序：这两格真的落进了文件的 ui 节。', JSON.stringify((await readDoc(env.home)) || null))
    check(env.ls.getItem('dsws.listPrefs') === JSON.stringify(oldPrefs), '写进文件这条路走通了，就绝不再写旧键（旧键一个字节都没动）。', env.ls.getItem('dsws.listPrefs'))
    check(env.mod.setUiPref('sortDir', 'desc') === true, '单独写一格也接得下来（返回 true 表示交给文件这条路了）。')
    const landed2 = await waitFor(async () => { const d = await readDoc(env.home); return !!d && !!d.ui && d.ui.sortDir === 'desc' })
    check(landed2, '这一格也落进了文件，而且别的格没有被带丢（合并着写，不是整份推平）。', JSON.stringify((await readDoc(env.home)) || null))
    check(env.mod.setUiPref('labelClicks', '3') === false, '不在这三格里的名字一律不写文件（标签点击计数那一项按维护者拍板不落盘）。')
  }
  {
    // 写失败（手机自己坏了）：照改动前的老办法整份写回旧键，而且设置文件不许被建出来。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const oldPrefs = { sortKey: 'number', sortDir: 'asc', stateFilter: 'all' }
    const env = makeEnv({ tag: 'uipref-fail', cwd: cwd, localStorage: { 'dsws.listPrefs': JSON.stringify(oldPrefs) }, failMode: 'throw' })
    env.mod.settingsViewLoad()
    await waitFor(async () => env.mod.viewFlagReadyNow() === true)
    env.mod.listPrefs.sortDir = 'desc'
    check(env.mod.saveUiPrefs() === true, '写这一趟先按能写接下来（落盘失败再兜底）。')
    await wait(env)
    check(env.ls.getItem('dsws.listPrefs') === JSON.stringify({ sortKey: 'number', sortDir: 'desc', stateFilter: 'all' }), '写失败之后这一次的值整份写回了旧键（过渡兜底，与改动前一致）。', env.ls.getItem('dsws.listPrefs'))
    check(fs.existsSync(settingsPathIn(env.home)) === false, '写失败时设置文件没有被建出来（兜底不是「换一份假的写成功」）。')
  }
  {
    // 文档还在路上时点一下：先记着不写旧键（此刻写旧键，文档一到手就会拿文件里的旧值把刚点的那一下顶掉），
    //   等文档到手再并进文件。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const oldPrefs = { sortKey: 'number', sortDir: 'asc', stateFilter: 'all' }
    const box = {}
    const env = makeEnv({
      tag: 'uipref-loading', cwd: cwd, localStorage: { 'dsws.listPrefs': JSON.stringify(oldPrefs) },
      onCall: function (method) {
        if (method === 'wf.getSettings' && !box.done) { box.done = true; env.mod.listPrefs.stateFilter = 'closed'; box.accepted = env.mod.saveUiPrefs() }
      },
    })
    env.mod.settingsViewLoad()
    const landed = await waitFor(async () => { const d = await readDoc(env.home); return !!d && !!d.ui && d.ui.stateFilter === 'closed' })
    check(box.accepted === true, '文档还在路上时点一下也接得下来（这一笔先记着，等文档到手再并进去）。')
    check(landed, '文档到手之后这一笔真的落进了文件（不是被丢掉，也不是只留在内存里）。')
    check(env.ls.getItem('dsws.listPrefs') === JSON.stringify(oldPrefs), '文档在路上时不写旧键（写了就会在文档到手那一刻被文件里的旧值顶掉）。', env.ls.getItem('dsws.listPrefs'))
  }
  {
    // 文件是更高版本插件写的（读不懂、也不许写回去）：这一族不接，交回调用方照老办法写旧键。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const oldPrefs = { sortKey: 'number', sortDir: 'asc', stateFilter: 'all' }
    const env = makeEnv({ tag: 'uipref-readonly', cwd: cwd, localStorage: { 'dsws.listPrefs': JSON.stringify(oldPrefs) } })
    fs.mkdirSync(path.dirname(settingsPathIn(env.home)), { recursive: true })
    fs.writeFileSync(settingsPathIn(env.home), 'version: 9\n', 'utf8')
    env.mod.settingsViewLoad()
    await waitFor(async () => env.mod.viewFlagReadyNow() === true)
    check(env.mod.setUiPref('stateFilter', 'closed') === false, '文件是高版本时这一格不接（返回 false，调用方按老办法写旧键）。')
    env.mod.listPrefs.stateFilter = 'closed'
    env.mod.saveListPrefs()
    check(env.ls.getItem('dsws.listPrefs') === JSON.stringify({ sortKey: 'number', sortDir: 'asc', stateFilter: 'closed' }), '不接之后照改动前的老办法整份写回旧键（这一次的改动没有丢）。', env.ls.getItem('dsws.listPrefs'))
    await wait(env)
    check(fs.readFileSync(settingsPathIn(env.home), 'utf8').indexOf('version: 9') === 0, '高版本文件一个字节都没被改（不许拿读不懂的内容去覆盖）。')
  }

  // ── 第十六件事：界面偏好只交用户真动过的那几格（2026-10-12 复核 Q4 的必修） ──
  //   老写法是「点一下就把内存里那三格整份交出去」。文档还在路上时，没被动过的那两格带的是旧表那一份
  //   （这一刻内存还没被文件里那一份换过），文档一到手就把文件里另外两格较新的值顶掉并落盘 ——
  //   用户在另一个窗口刚选好的排序会被静默改回默认。这里量三档：两窗口、点名提交、以及「文件里那一格
  //   与旧表那一份恰好相等」不算动过（这一档原来是假绿：去掉实现里那一行守卫，门禁照样全绿）。
  console.log('')
  console.log('== 第十六件事：只把用户动过的那几格交给文件（没动过的格不许把文件里较新的值顶掉） ==')
  {
    // 两个窗口：窗口 A 早把排序选成 name/desc 并落进了文件；窗口 B 开窗那一刻（文档还在路上）点了一下筛选。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const oldPrefs = { sortKey: 'number', sortDir: 'asc', stateFilter: 'all' }
    const box = {}
    const env = makeEnv({
      tag: 'uipref-two-window', cwd: cwd, localStorage: { 'dsws.listPrefs': JSON.stringify(oldPrefs) },
      onCall: function (method) {
        if (method === 'wf.getSettings' && !box.done) {
          box.done = true
          env.mod.listPrefs.stateFilter = 'mine'
          // 列表面板点一下调的就是这个（saveListPrefs 是只管交出去、不回值的写口，见 store-prefs.js）。
          env.mod.saveListPrefs('stateFilter')
        }
      },
    })
    const pre = await store.writeLocalSettings({ version: 1, ui: { stateFilter: '', sortKey: 'name', sortDir: 'desc', labelClicks: {} }, workspaces: {}, debug: { enabled: false, sampleRate: 1 }, templates: {} }, env.home, realIo)
    check(pre && pre.ok === true, '先摆好窗口 A 写下的那一份（文件里排序是 name/desc）。', JSON.stringify(pre))
    env.mod.settingsViewLoad()
    await waitFor(async () => env.mod.viewFlagReadyNow() === true)
    const landed = await waitFor(async () => { const d = await readDoc(env.home); return !!d && !!d.ui && d.ui.stateFilter === 'mine' })
    const doc = await readDoc(env.home)
    check(box.done === true, '窗口 B 是在文档还在路上的那一刻点的（这一档才量得到交错）。')
    check(landed, '窗口 B 点的那一格真的落进了文件。', JSON.stringify(doc && doc.ui))
    check(!!doc && doc.ui.sortKey === 'name' && doc.ui.sortDir === 'desc',
      '文件里窗口 A 选的另外两格没被顶掉（没动过的格不许跟着一起提交）。', JSON.stringify(doc && doc.ui))
    check(env.ls.getItem('dsws.listPrefs') === JSON.stringify(oldPrefs), '这一趟同样不写旧键。', env.ls.getItem('dsws.listPrefs'))
  }
  {
    // 点名提交：传哪几格就只交哪几格（列表面板点一下排序一次改两格，见 views/ListTab.js）。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const oldPrefs = { sortKey: 'number', sortDir: 'asc', stateFilter: 'all' }
    const env = makeEnv({ tag: 'uipref-named', cwd: cwd, localStorage: { 'dsws.listPrefs': JSON.stringify(oldPrefs) } })
    const pre = await store.writeLocalSettings({ version: 1, ui: { stateFilter: 'blocked', sortKey: 'name', sortDir: 'desc', labelClicks: {} }, workspaces: {}, debug: { enabled: false, sampleRate: 1 }, templates: {} }, env.home, realIo)
    check(pre && pre.ok === true, '先摆一份文件（筛选 blocked、排序 name/desc）。')
    env.mod.settingsViewLoad()
    await waitFor(async () => env.mod.viewFlagReadyNow() === true)
    env.mod.listPrefs.sortKey = 'title'
    env.mod.listPrefs.sortDir = 'asc'
    // saveListPrefs 不回值（只管把这一趟交出去，与改动前一致），所以这里量的是后果：两格都落进了文件。
    env.mod.saveListPrefs(['sortKey', 'sortDir'])
    const landed = await waitFor(async () => { const d = await readDoc(env.home); return !!d && !!d.ui && d.ui.sortKey === 'title' && d.ui.sortDir === 'asc' })
    const doc = await readDoc(env.home)
    check(landed, '这两格落进了文件。', JSON.stringify(doc && doc.ui))
    check(!!doc && doc.ui.stateFilter === 'blocked', '没点名的那一格保持文件里那一份（点名提交不牵连别的格）。', JSON.stringify(doc && doc.ui))
  }
  {
    // 文档还在路上时点了「当前就选着的那一格」（值恰好与旧表那一份相同）：也要交出去 —— 用户点过就以
    //   用户那一下为准。这一档同时把「格名真的传到了」钉住：若 saveListPrefs 把格名丢掉（退回按记账推），
    //   这一格会因为「与上次确认过的值相同」不被提交，文件里另一个窗口写的 blocked 就把用户点的那一下顶掉。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const oldPrefs = { sortKey: 'number', sortDir: 'asc', stateFilter: 'all' }
    const box = {}
    const env = makeEnv({
      tag: 'uipref-named-same', cwd: cwd, localStorage: { 'dsws.listPrefs': JSON.stringify(oldPrefs) },
      onCall: function (method) {
        if (method === 'wf.getSettings' && !box.done) { box.done = true; env.mod.saveListPrefs('stateFilter') }
      },
    })
    const pre = await store.writeLocalSettings({ version: 1, ui: { stateFilter: 'blocked', sortKey: '', sortDir: '', labelClicks: {} }, workspaces: {}, debug: { enabled: false, sampleRate: 1 }, templates: {} }, env.home, realIo)
    check(pre && pre.ok === true, '先摆一份文件：文件里筛选是 blocked，旧表（界面此刻显示的）是 all。')
    env.mod.settingsViewLoad()
    await waitFor(async () => env.mod.viewFlagReadyNow() === true)
    check(box.done === true, '这一档真的是在文档还在路上的那一刻点的（不然量不到「格名传没传到」这件事）。')
    const landed = await waitFor(async () => { const d = await readDoc(env.home); return !!d && !!d.ui && d.ui.stateFilter === 'all' })
    const doc = await readDoc(env.home)
    check(landed, '用户点的那一格赢了：文件里那一格改成用户点的值（点过就算数，不因为与旧表相同被当成没动过）。', JSON.stringify(doc && doc.ui))
  }
  {
    // 文件里那一格与旧表那一份恰好相等：不算「用户动过」，不重画。这一档原来在门禁下没有任何断言把守
    //   （去掉实现里那一行守卫门禁照样全绿，复核点名的假绿），所以这里钉住「只重画一次」这个可观测后果。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const oldPrefs = { sortKey: 'number', sortDir: 'asc', stateFilter: 'all' }
    const env = makeEnv({ tag: 'uipref-equal', cwd: cwd, localStorage: { 'dsws.listPrefs': JSON.stringify(oldPrefs) } })
    const pre = await store.writeLocalSettings({ version: 1, ui: { stateFilter: 'all', sortKey: 'number', sortDir: 'asc', labelClicks: {} }, workspaces: {}, debug: { enabled: false, sampleRate: 1 }, templates: {} }, env.home, realIo)
    check(pre && pre.ok === true, '先摆一份文件：三格与旧表那一份逐格相同。')
    env.mod.settingsViewLoad()
    await waitFor(async () => env.mod.viewFlagReadyNow() === true)
    check(env.shared.tick === 1 && env.st.tick === 1, '文件里那一份与旧表逐格相同时不重画（只算「问话收口」那一次，搬那一趟不出第二次）。', JSON.stringify({ shared: env.shared.tick, st: env.st.tick }))
  }

  // ── 第十七件事：按工作区根读一格、按工作区根写一格（2026-10-12 复核 Q2 的必修） ──
  //   组件自己认得出根时（SubworkspaceMark.js 的 subwsMarkRootOf 那一路），读写都按它手上这把根走。为什么
  //   必须这样：内核那把「所选目录 → 工作区根」的表是快照缓存，同一条目录的根变过时它可能还留着旧条目 ——
  //   按会话目录算键会落到另一条记录上，于是同一份状态读在一把键、写在另一把键：文件里明明记过却判成问不出
  //   （每开一次窗白弹一次浮层），或者写出一条谁也读不回来的记录。
  console.log('')
  console.log('== 第十七件事：按根读一格、按根写一格（读写同一把键） ==')
  {
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'root-read', cwd: cwd })
    const pre = await store.writeLocalSettings({ version: 1, ui: { stateFilter: '', sortKey: '', sortDir: '', labelClicks: {} }, workspaces: { 'D:\\ilife': { bannerFolded: false, subwsMarkAutoShown: true } }, debug: { enabled: false, sampleRate: 1 }, templates: {} }, env.home, realIo)
    check(pre && pre.ok === true, '先摆一份文件：本工作区这条记录里「自动展开过」是 true。', JSON.stringify(pre))
    env.mod.settingsViewLoad()
    await waitFor(async () => env.mod.viewFlagReadyNow() === true)
    const hit = env.mod.viewFlagOfRoot('D:\\ilife', 'subwsMarkAutoShown')
    check(!!hit && hit.known === true && hit.value === true,
      '按根读得到这一格：known 说文件里查得到、value 是文件里那一份（文件是唯一真源）。', JSON.stringify(hit))
    const spelled = env.mod.viewFlagOfRoot('d:/ILIFE/', 'subwsMarkAutoShown')
    check(!!spelled && spelled.known === true && spelled.value === true,
      '文件里那条记录的写法与手上这把根不同也算同一条记录（折算之后再比）。', JSON.stringify(spelled))
    const other = env.mod.viewFlagOfRoot('D:\\elsewhere', 'subwsMarkAutoShown')
    check(!!other && other.known === false,
      '文件里没有这条记录时 known 是 false（调用方据此退回旧表那一份，不猜）。', JSON.stringify(other))
    const missing = env.mod.viewFlagOfRoot('D:\\ilife', 'subwsMarkAutoShown2')
    check(!!missing && missing.known === false,
      '这条记录里没有这一格时也算问不出（不是拿别的格凑一个答案）。', JSON.stringify(missing))
    check(env.mod.viewFlagOf('D:\\ilife\\packages\\skill-calorie', 'subwsMarkAutoShown') === true,
      '按所选目录那条老口子照旧回布尔（它内部先按认出来的根问，问不出才回退旧键）。', String(env.mod.viewFlagOf('D:\\ilife\\packages\\skill-calorie', 'subwsMarkAutoShown')))
  }
  {
    // 形状对不上：文件里这一格不是真假值（更高版本插件写的、或人手工改坏了）时算「问不出」，交回调用方退旧表。
    const crafted = { version: 1, ui: { stateFilter: '', sortKey: '', sortDir: '', labelClicks: {} }, workspaces: { 'D:\\ilife': { subwsMarkAutoShown: 'yes' } }, debug: { enabled: false, sampleRate: 1 }, templates: {} }
    const mod = makeView({
      keyOf: KEY_OF, wsKeyOf: function (c) { return KEY_OF(c) }, workspaceRootByCwd: {},
      shared: { cwd: '', subs: [], tick: 0 }, stores: {}, emit: function () {},
      host: { call: function () { return Promise.resolve({ ok: true, value: crafted }) } },
      localStorage: makeLocalStorage({}), log: function () {}, dswsLogHash: function () { return 'h' },
      timer: undefined, currentOs: CURRENT_OS,
    })
    mod.settingsViewLoad()
    await waitFor(async () => mod.viewFlagReadyNow() === true)
    const shaped = mod.viewFlagOfRoot('D:\\ilife', 'subwsMarkAutoShown')
    check(!!shaped && shaped.known === false,
      '这一格在文件里不是真假值时算问不出（形状对不上不猜，交回调用方退旧表）。', JSON.stringify(shaped))
  }
  {
    // 写这一侧：文档还在路上时按根写一笔 —— 队列里连键一起带着，文档到手后落在同一把键上，不按会话目录另算。
    const cwd = 'D:\\ilife\\packages\\skill-calorie'
    const env = makeEnv({ tag: 'root-write', cwd: cwd })
    check(env.mod.setViewFlagRoot('D:\\other-ws', 'subwsMarkAutoShown', true, cwd) === true,
      '文档还在路上时按根写一笔：先接下来（这一笔记着，等文档到手再并进去）。')
    const landed = await waitFor(async () => { const d = await readDoc(env.home); return !!d && !!d.workspaces['D:\\other-ws'] && d.workspaces['D:\\other-ws'].subwsMarkAutoShown === true })
    const doc = await readDoc(env.home)
    check(landed, '这一笔落在调用方点名的那把根上（不按会话目录另算一把）。', JSON.stringify(doc && doc.workspaces))
    check(!doc || !doc.workspaces['D:\\ilife'] || doc.workspaces['D:\\ilife'].subwsMarkAutoShown !== true,
      '没有顺手在会话目录那条记录上再写一笔（同一份状态只落一把键）。', JSON.stringify(doc && doc.workspaces))
    const readBack = env.mod.viewFlagOfRoot('D:\\other-ws', 'subwsMarkAutoShown')
    check(!!readBack && readBack.known === true && readBack.value === true,
      '写进去的那一条按根读得回来（读写同一把键，这是这一档真正要钉住的东西）。', JSON.stringify(readBack))
    check(env.ls.getItem('dsws.subwsAutoShown') === null, '写成功之后旧键一个字都没写。', JSON.stringify(env.ls.dump()))
  }
  {
    // 根是空串（组件这一刻认不出工作区根）：一个字都不许写文件，交回调用方写旧表（与 setViewFlag 同一口径）。
    const env = makeEnv({ tag: 'root-empty', cwd: 'D:\\ilife\\packages\\skill-calorie' })
    check(env.mod.setViewFlagRoot('', 'subwsMarkAutoShown', true, 'D:\\ilife\\packages\\skill-calorie') === false,
      '根是空串时不接这一笔（返回 false，调用方按老办法写旧表）。')
    await wait(env)
    check(await readDoc(env.home) === null, '这一档一个字都没写文件（会话目录当键写下去会留下读不回来的孤儿记录）。')
  }

  // ── 标签点击次数不落盘（#1012 · 维护者 2026-10-12 拍板）──────────────────────────
  //   这一项只是标签 chip 排序用的热度，丢了不影响功能：客户端既不读旧本地键，也不写本地存储；
  //   核那一侧写本机设置文件时也不再写它（那一半在 tests/verify-config-store-core.js 的 C1 里验）。
  {
    const seeded = { 'dsws.labelClicks': JSON.stringify({ bug: 9, task: 4 }) }
    const writes = []
    globalThis.localStorage = {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(seeded, k) ? seeded[k] : null),
      setItem: (k, v) => { writes.push(k); seeded[k] = String(v) },
      removeItem: (k) => { delete seeded[k] },
    }
    const prefs = await import(pathToFileURL(path.join(ROOT, 'src/client/kernel/store-prefs.js')).href)
    check(JSON.stringify(prefs.labelClicks) === '{}', '标签点击次数不读旧本地键（窗口一开就是空的）', JSON.stringify(prefs.labelClicks))
    prefs.labelClicks.bug = 1
    prefs.saveLabelClicks()
    check(writes.length === 0, '标签点击次数不写本地存储（这一项不落盘）', JSON.stringify(writes))
    check(seeded['dsws.labelClicks'] === JSON.stringify({ bug: 9, task: 4 }), '旧本地键里的历史数据也没被改写', seeded['dsws.labelClicks'])
  }

  console.log(failed ? ('\n存在失败 — verify-settings-view 未通过（' + passed + ' 项通过、' + failed + ' 项失败）') : ('\n全部通过 — 客户端观看状态门禁生效（' + passed + ' 项断言）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('FATAL ' + String((e && e.stack) || e)); process.exit(2) }).finally(() => { uninstallTimeCompression() })
