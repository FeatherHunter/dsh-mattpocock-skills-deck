#!/usr/bin/env node
/**
 * verify-settings-view.js —— 客户端「按工作区的观看状态」搬到本机设置文件的门禁（#1012）。
 *
 * 这一份门禁只量十二件事，每一件都用完整的一句话说清，第一次读的人能直接看懂。
 * 第一件事是缺席时回退旧表读：设置文件还没建出来的时候，读到的值要与改动前一样来自 localStorage 那两个旧键。
 * 第二件事是写成功后旧 localStorage 键一个字节都不写：新后端这条路成了，两处都写就是两份真相。
 * 第三件事是写失败才过渡写旧键：只有写不进文件（或文件是更高版本、不许写回去）时，才把这一次的值写回旧键。
 * 第四件事是合并着写不丢别人的东西：只换这一个工作区的这一格，别的节、别的字段、别的工作区的记录原样保留。
 * 第五件事是键的写法：用工作区根的可读路径（本会话自己的那一种写法），不是折叠散列，同一个工作区只留一条。
 * 第六件事是防抖：连着来的几下写合并成一次电话调用。
 * 第七件事是接线：store-prefs.js 与 SubworkspaceMark.js 真的改调了这一片，旧表过渡还留着，四份文件都不超三百五十行。
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
 * 怎么保证量的是真件：客户端那三片（src/client/kernel/settings-view-state.js、settings-view.js 与
 *   settings-view-write.js）的真源按构建同一种做法、同一次序拼起来当场造出函数来跑
 *   （第一片是后两片的前置、第二片又是第三片的前置，构建时也照这个次序拼）；
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
const noExport = (s) => s.replace(/^\s*export\s+/gm, '')
function makeView(env) {
  const body = noExport(readText(VIEW_STATE_REL)) + '\n' + noExport(readText(VIEW_REL)) + '\n' + noExport(readText(VIEW_WRITE_REL))
  const names = ['keyOf', 'wsKeyOf', 'shared', 'stores', 'emit', 'host', 'localStorage', 'log', 'dswsLogHash', 'timer', 'currentOs']
  const factory = compileFn(names, body + '\nreturn { viewFlagOf: viewFlagOf, setViewFlag: setViewFlag, viewFlagDocKeyOf: viewFlagDocKeyOf, viewFlagWriteKeyOf: viewFlagWriteKeyOf, settingsViewLoad: settingsViewLoad, viewFlagReadyNow: viewFlagReadyNow, viewFlagSubscribe: viewFlagSubscribe, VIEW_FLAG_WRITE_DEBOUNCE_MS: VIEW_FLAG_WRITE_DEBOUNCE_MS }')
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
    }
    check(readText('src/client/index.js').indexOf('// ==== kernel:settingsView (spliced by build) ====') >= 0, '客户端入口留了 kernel:settingsView 拼接标记。')
    const idxSrc = readText('src/client/index.js')
    const atState = idxSrc.indexOf('// ==== kernel:settingsViewState (spliced by build) ====')
    const atView = idxSrc.indexOf('// ==== kernel:settingsView (spliced by build) ====')
    const atWrite = idxSrc.indexOf('// ==== kernel:settingsViewWrite (spliced by build) ====')
    check(atState >= 0, '客户端入口留了 kernel:settingsViewState 拼接标记（新的一片也照一源两物接上）。')
    check(atState >= 0 && atState < atView,
      '入口里新标记排在它的使用方（settingsView）之前（不然状态对象与两个口子还没有定义）。')
    check(atWrite >= 0, '客户端入口留了 kernel:settingsViewWrite 拼接标记（写这一趟也照一源两物接上）。')
    check(atWrite > atView, '入口里写这一趟的标记排在它用到的读那一片之后（不然那些键与文档工具还没有定义）。')
    check(readText(path.join('scripts', 'build.mjs')).indexOf("name: 'settingsView'") >= 0, '构建清单里登记了这一片。')
    check(readText(path.join('scripts', 'build.mjs')).indexOf("name: 'settingsViewState'") >= 0, '构建清单里登记了加载状态与订阅这一片。')
    check(readText(path.join('scripts', 'build.mjs')).indexOf("name: 'settingsViewWrite'") >= 0, '构建清单里登记了写这一趟这一片。')
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
    const mod = makeView({
      keyOf: KEY_OF,
      wsKeyOf: function (c) { const k = KEY_OF(c); if (!k) return ''; return (o.rootByKey && o.rootByKey[k]) || k },
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
    check(!!doc && JSON.stringify(doc.ui) === JSON.stringify(preset.ui), 'ui 节原样保留（状态过滤、排序、标签点击次数一个不动）。', JSON.stringify(doc && doc.ui))
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
    // 只认出会话目录（会话状态上没有根、内核那把键也没认出根）时，就用会话目录本身，绝不猜一个根。
    const env3 = makeEnv({ tag: 'key3', cwd: 'D:\\scratch\\no-repo\\sub', root: '' })
    check(env3.mod.viewFlagDocKeyOf('D:\\scratch\\no-repo\\sub') === 'D:\\scratch\\no-repo\\sub',
      '认不出工作区根时，键就是会话目录本身（只认出会话目录就用会话目录）。', JSON.stringify(env3.mod.viewFlagDocKeyOf('D:\\scratch\\no-repo\\sub')))
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
  console.log('== 第七件事之二：store-prefs 与 SubworkspaceMark 真的改调了这一片，旧表过渡还留着，五份文件都 ≤350 行 ==')
  {
    const prefs = readText('src/client/kernel/store-prefs.js')
    check(prefs.indexOf("viewFlagOf(cwd, 'bannerFolded')") >= 0, 'store-prefs 的 isBannerFolded 改调新模块读。')
    check(prefs.indexOf("setViewFlag(cwd, 'bannerFolded'") >= 0, 'store-prefs 的 setBannerFolded 改调新模块写。')
    check(prefs.indexOf('bannerFoldByCwd[k] = 1') >= 0 && prefs.indexOf('persistBannerFold()') >= 0, 'store-prefs 里旧表那段读写原地留着（新模块不在时照旧干活）。')
    const mark = readText('src/client/views/SubworkspaceMark.js')
    check(mark.indexOf("viewFlagOf(cwd, 'subwsMarkAutoShown')") >= 0, 'SubworkspaceMark 的「自动展开过没有」改调新模块读。')
    check(mark.indexOf("setViewFlag(cwd, 'subwsMarkAutoShown', true)") >= 0, 'SubworkspaceMark 的标记改调新模块写。')
    check(mark.indexOf('readAutoMap') >= 0 && mark.indexOf("localStorage.setItem(AUTO_KEY") >= 0, 'SubworkspaceMark 里旧键那段读写原地留着（过渡）。')
    // 拼回可读写法时的分隔符按平台判，不按「这一条路径里有没有反斜杠」判：那一手在 POSIX 上会判错平台。
    check(mark.indexOf('subwsMarkSepOf') >= 0 && mark.indexOf('.join(sep)') >= 0,
      'SubworkspaceMark 拼回写法时按平台取分隔符（subwsMarkSepOf），不再把反斜杠写死在拼装那一行。')
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
    // ⑧ 写法面：组件里那两处接线能钉住的只有「写法长这样」，钉不住「真渲染里效果真的重跑了」。
    //   挡的回退分别是：判决被换回另一份实现、依赖里少了那个计数（文档到手不重跑）、未就绪就当场弹。
    const mark = readText('src/client/views/SubworkspaceMark.js')
    check(mark.indexOf('subwsMarkAutoDecide(ready, shownBefore)') >= 0,
      '组件用的是本门禁量过的那个判据（不是另写一份判决）—— 挡的是「门禁量 A、界面跑 B」这种回退。')
    check(mark.indexOf('}, [isSub, root, flagTick])') >= 0,
      '自动展开那一次的判据挂在「文档问完了没有」这个计数上（依赖里含 flagTick）—— 挡的是「文档到手后效果不重跑」。')
    check(mark.indexOf("if (verdict === 'wait') return") >= 0 && mark.indexOf('viewFlagReadyNow') >= 0,
      '未就绪时直接返回、不当场把浮层弹出来（先判就绪，再按判决弹）—— 挡的是「还没问过真源就按旧表弹一次」。')
    console.log('    （说明）上面三条是文本断言，只证明组件是这么写的；「真渲染里文档迟到那一刻真的重跑了」由下面 ⑨ 真画一遍兜住。')
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
        try { const raw = window.localStorage.getItem('dsws.subwsAutoShown'); const m = raw ? JSON.parse(raw) : null; return !!(m && m[KEY_OF(ROOT_DIR)]) } catch (e) { return false }
      }
      const tipCalls = []
      const Tip = function (props) { tipCalls.push(props || {}); return React.createElement('span', null, (props || {}).children) }
      const factory = compileFn(
        ['keyOf', 'tr', 'Tip', 'host', 'React', 'h', 'localStorage', 'chainStep', 'viewFlagOf', 'viewFlagReadyNow', 'viewFlagSubscribe', 'setViewFlag'],
        MARK_SRC + '\nreturn SubworkspaceMark'
      )
      const Comp = factory(KEY_OF,
        function (key) { return (key === 'panel.wsMarkTip') ? tips[0] : key },
        Tip,
        { call: function () { return Promise.resolve({ ok: true }) } },
        React, React.createElement, window.localStorage, function () { return null },
        readFlag, readyNow, subscribe, function () { return true })
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
      return { before: before, after: after }
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
    await sleep(700)
    const oldMap = JSON.parse(env.ls.getItem('dsws.bannerFold') || '{}')
    check(oldMap[KEY_OF(cwd)] === 1, '第一趟写失败时照旧把这一格写回旧键做过渡（与改动前一致）。', JSON.stringify(oldMap))
    await sleep(1200)
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
    await sleep(1300)
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
    await sleep(1600)
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

  console.log(failed ? ('\n存在失败 — verify-settings-view 未通过（' + passed + ' 项通过、' + failed + ' 项失败）') : ('\n全部通过 — 客户端观看状态门禁生效（' + passed + ' 项断言）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('FATAL ' + String((e && e.stack) || e)); process.exit(2) })
