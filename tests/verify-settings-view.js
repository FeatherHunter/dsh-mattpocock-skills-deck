#!/usr/bin/env node
/**
 * verify-settings-view.js —— 客户端「按工作区的观看状态」搬到本机设置文件的门禁（#1012）。
 *
 * 这一份门禁只量七件事，每一件都用完整的一句话说清，第一次读的人能直接看懂。
 * 第一件事是缺席时回退旧表读：设置文件还没建出来的时候，读到的值要与改动前一样来自 localStorage 那两个旧键。
 * 第二件事是写成功后旧 localStorage 键一个字节都不写：新后端这条路成了，两处都写就是两份真相。
 * 第三件事是写失败才兜底写旧键：只有写不进文件（或文件是更高版本、不许写回去）时，才把这一次的值写回旧键做过渡。
 * 第四件事是合并着写不丢别人的东西：只换这一个工作区的这一格，别的节、别的字段、别的工作区的记录原样保留。
 * 第五件事是键的写法：用工作区根的可读路径（本会话自己的那一种写法），不是折叠散列，同一个工作区只留一条。
 * 第六件事是防抖：连着来的几下写合并成一次电话调用。
 * 第七件事是接线：store-prefs.js 与 SubworkspaceMark.js 真的改调了这一片，旧表兜底还留着，三份文件都不超三百五十行。
 *
 * 怎么保证量的是真件：客户端那一片（src/client/kernel/settings-view.js）的真源按构建同一种做法取出声明体
 *   （去掉每行行首 export），当场造出函数来跑；它打的宿主那两条电话（wf.getSettings / wf.setSettings）用的是
 *   src/host/settingsPhones.js 与 src/host/configStore.js 的真实现，读写落在系统临时目录里的真文件上 ——
 *   只有手机（假 host 的 call）与文件系统（可以按需制造写失败的那一层包装）是替身。
 * 本门禁自己先跑一次 node scripts/build.mjs：客户端那一片的运行时形状来自拼接，不跑构建就证明不了它真的进了双产物。
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

// ── 真件一：闭包里那把规整函数 keyOf（src/shared/workspaceKey.js 的真源码，不另写仿制品） ──
function keyOfFn() {
  const src = readText('src/shared/workspaceKey.js').replace(/^\s*export\s+/gm, '')
  return compileFn([], src + '\nreturn keyOf')()
}
// ── 真件二：被测那一片（按构建同一种做法取声明体，当场造出一个全新的实例） ──
const VIEW_REL = 'src/client/kernel/settings-view.js'
function makeView(env) {
  const body = readText(VIEW_REL).replace(/^\s*export\s+/gm, '')
  const names = ['keyOf', 'wsKeyOf', 'shared', 'stores', 'emit', 'host', 'localStorage', 'log', 'dswsLogHash', 'timer']
  const factory = compileFn(names, body + '\nreturn { viewFlagOf: viewFlagOf, setViewFlag: setViewFlag, viewFlagDocKeyOf: viewFlagDocKeyOf, settingsViewLoad: settingsViewLoad, VIEW_FLAG_WRITE_DEBOUNCE_MS: VIEW_FLAG_WRITE_DEBOUNCE_MS }')
  return factory.apply(null, names.map((n) => env[n]))
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
    }
    check(readText('src/client/index.js').indexOf('// ==== kernel:settingsView (spliced by build) ====') >= 0, '客户端入口留了 kernel:settingsView 拼接标记。')
    check(readText(path.join('scripts', 'build.mjs')).indexOf("name: 'settingsView'") >= 0, '构建清单里登记了这一片。')
  }

  // 真件：宿主的核与两条电话
  const leaf = await import(pathToFileURL(path.join(ROOT, 'src/host', 'settingsPhones.js')).href)
  const store = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'configStore.js')).href)
  const KEY_OF = keyOfFn()

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
    const host = o.noHost ? undefined : makeHost(phones, calls, o.failMode)
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
  console.log('== 第七件事之二：store-prefs 与 SubworkspaceMark 真的改调了这一片，旧表兜底还留着，三份文件都 ≤350 行 ==')
  {
    const prefs = readText('src/client/kernel/store-prefs.js')
    check(prefs.indexOf("viewFlagOf(cwd, 'bannerFolded')") >= 0, 'store-prefs 的 isBannerFolded 改调新模块读。')
    check(prefs.indexOf("setViewFlag(cwd, 'bannerFolded'") >= 0, 'store-prefs 的 setBannerFolded 改调新模块写。')
    check(prefs.indexOf('bannerFoldByCwd[k] = 1') >= 0 && prefs.indexOf('persistBannerFold()') >= 0, 'store-prefs 里旧表那段读写原地留着（新模块不在时照旧干活）。')
    const mark = readText('src/client/views/SubworkspaceMark.js')
    check(mark.indexOf("viewFlagOf(cwd, 'subwsMarkAutoShown')") >= 0, 'SubworkspaceMark 的「自动展开过没有」改调新模块读。')
    check(mark.indexOf("setViewFlag(cwd, 'subwsMarkAutoShown', true)") >= 0, 'SubworkspaceMark 的标记改调新模块写。')
    check(mark.indexOf('readAutoMap') >= 0 && mark.indexOf("localStorage.setItem(AUTO_KEY") >= 0, 'SubworkspaceMark 里旧键那段读写原地留着（兜底）。')
    const nView = countLines(VIEW_REL)
    check(nView <= 350, '新的一片不超过三百五十行，实得 ' + nView + ' 行。')
    const nPrefs = countLines('src/client/kernel/store-prefs.js')
    check(nPrefs <= 350, 'store-prefs.js 不超过三百五十行，实得 ' + nPrefs + ' 行。')
    const nMark = countLines('src/client/views/SubworkspaceMark.js')
    check(nMark <= 350, 'SubworkspaceMark.js 不超过三百五十行，实得 ' + nMark + ' 行。')
  }

  console.log(failed ? ('\n存在失败 — verify-settings-view 未通过（' + passed + ' 项通过、' + failed + ' 项失败）') : ('\n全部通过 — 客户端观看状态门禁生效（' + passed + ' 项断言）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('FATAL ' + String((e && e.stack) || e)); process.exit(2) })
