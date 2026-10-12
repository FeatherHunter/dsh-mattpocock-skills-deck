#!/usr/bin/env node
/**
 * verify-settings-debug.js —— 调试开关真源搬进本机设置文件 debug 节的门禁（#1012 第 8 条）。
 *
 * 这一份门禁量十八件事，每一件都用完整的一句话说清，第一次读的人能直接看懂。
 * 第一件事是构建与登记：这一片的运行时形状来自拼接，不跑构建就证明不了它进了双产物；它必须排在写这一趟
 *   之后（要用待写队列与排期）与运行时那份日志内核之后（要用 logSwitch / persistLocalDebugSwitch 等名字）。
 * 第二件事是开机秒显仍读旧键 dsws.debug：同步、不等文件（这是包里的行为，本次不回归）。
 * 第三件事是文件里 debug.enabled 说开时以文件为准：内存、旧键快照、界面广播、宿主副本四处都跟着文件走，
 *   采样率也用文件里那个数。
 * 第四件事是文件说关、旧键说开（升级前用户开着）时认开，并把开排队写回文件 —— 先立后破，老用户的选择不许丢。
 * 第五件事是文件说关、旧键也没见过、内存也是关时：默认关，且不往文件里写多余的东西。
 * 第六件事是拨开关时文件这条路接得下：只写文件（内存 + 旧键快照 + 广播 + 宿主副本各就各位），宿主那一步
 *   失败也仍回 ok: true —— 真源已经落地，副本跟不上不算用户这一下失败。
 * 第七件事是文件这条路接不下时退回包里的老路 setLogSwitch：宿主收到老电话，错误码、超时、代际、失败分类
 *   原样交给界面（这里量的是 host-rejected / throw / host-unavailable 三档）。
 * 第八件事是文档还在路上时拨开关：先排进待写队列，文档到手后落进文件，而且采纳那一趟不许把用户刚拨的
 *   这一下用文件里的旧值顶回去。
 * 第九件事是开机对账那一趟（包里的 reconcileLogSwitch 拿宿主副本覆盖内存）之后，采纳仍以文件为准，并把
 *   真源推给宿主副本（宿主收到 wf.logSetSwitch，带的是文件里的值）。
 * 第十件事是采样率越界不许写进文件：核会整份拒绝 0 到 1 之外的数，这一层要自己挡掉，回退成内存里那个合法值。
 * 第十一件事是文档从没问过那一档（新会话第一次打开设置页，status 是 idle）拨开关：这一下先走包里的老路，等老路
 *   真的成功了才把两笔记进待写队列（2026-10-12 复核的必修 3：还不知道结果就留必写痕迹，会出现「界面说失败、文件
 *   里却写着那个值」）；老路被拒时一滴痕迹都不许留。记下来的两笔保证同一趟采纳不会照文件里的旧值把用户刚拨的
 *   那一下顶回去，这次的关/开也就真进了文件（2026-10-12 复核实测出来的确定性丢失）。
 * 第十二件事是文件里根本没有 debug 这一节（只有一份手写的旧文件）而在 idle 下拨开：文件里要长出
 *   enabled: true，且别的节不许被写坏。
 * 第十三件事是文档始终问不到时拨开关：老路接手、旧键快照里留着用户拨的那个值、有日志留痕，且不凭空造文件。
 * 第十四件事是半份文档（占位电话答上来的空壳）当不了真源：拨动退回老路、文件不被写；写之前那次重读答半份
 *   文档时也不许拿它当基底整份写回 —— 别的节（ui / workspaces / templates）要被保住。
 * 第十五件事是更高版本插件写的文档（只读那一档）拨开关：走老路，文件逐字节不变。
 * 第十六件事是旧键只在文件这条路接不下时才由本片兜底写（接得下时它只当秒显快照，一次不多写）。
 * 第十七件事是不新增日志事件名：这一片只用既有的 host.call.fail 与 storage.fail，两个名字都在 #489 附录里，
 *   而且是对着构建产物里这一片的实际字符串查（源码里事件名走变量就漏，2026-10-12 复核指出）。
 * 第十八件事是宿主那份副本没跟上（推送失败）时怎么收场：回包带上 hostPushed 把副本状态交给界面，界面换一句
 *   带限定语的文案（不许只弹「已开启」），并且下一次文档到手（下一次打开设置页）会自动再推一次，让一次失败自愈。
 *
 * 怎么保证量的是真件：运行时那几个名字不是替身，而是构建真正拼进去的那一份
 *   （scripts/generated/logKernel.derived.js，即 npm 包 dsh-log 的客户端产物，scripts/build.mjs 第 500 行）
 *   加上 src/client/kernel 里 settings-view-state.js / settings-view.js / settings-view-write.js /
 *   settings-debug.js 四片的真源，按构建同一种做法、同一次序拼起来当场造出函数来跑。
 *   宿主那两条设置电话（wf.getSettings / wf.setSettings）用的是 src/host/settingsPhones.js 与
 *   src/host/configStore.js 的真实现，读写落在系统临时目录里的真文件上；只有手机（假 host 的 call）、
 *   内存里的 localStorage 与「可以按需制造读/写失败」的那层文件包装是替身。
 *   宿主那两条开关电话（wf.logGetSwitch / wf.logSetSwitch）也是替身，但它们记下每一次调用，
 *   「老路走没走、推给宿主的副本是什么值、失败时回什么错误码」全靠这份记录量。
 * 本门禁自己先跑一次 node scripts/build.mjs：这一片的运行时形状来自拼接，不跑构建就证明不了它真的进了产物。
 *
 * 用法：node tests/verify-settings-debug.js（在插件根目录；本脚本自己会先构建）
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const { spawnSync } = require('child_process')
const realFs = require('node:fs/promises')
const { compileFn } = require('./lib/eval-probe.js')
// 防抖窗口是五百毫秒，这一份门禁里有十几处等它落地；接上虚拟时钟把等待压成几毫秒，断言一条没动
//   （为什么这么压是安全的见 tests/lib/time-compress.js 文件头）。
const { installTimeCompression } = require('./lib/time-compress.js')
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
const makeHome = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-dbg-' + tag + '-'))
const settingsPathIn = (home) => path.join(home, '.dsh', 'mattskillsdeck', 'settings.yaml')
const noExport = (s) => s.replace(/^\s*export\s+/gm, '')

// 真的文件读写口（核要的那四个动作），门禁里读写落在临时目录的真文件上。
const realIo = {
  readText: (p) => realFs.readFile(String(p), 'utf8'),
  writeText: (p, t) => realFs.writeFile(String(p), String(t), 'utf8'),
  mkdir: (p) => realFs.mkdir(String(p), { recursive: true }),
  rm: (p) => realFs.unlink(String(p)),
}
// 记录型系统文件：包一层真文件，既落真盘又能制造写失败（与 verify-settings-templates.js 同一手法）。
function wrapSysFs(calls, overrides) {
  return {
    async readFile(p, enc) { calls.push({ name: 'readFile', path: String(p) }); if (overrides && overrides.readFile) return overrides.readFile(p, enc); return realFs.readFile(p, enc) },
    async writeFile(p, text, enc) { calls.push({ name: 'writeFile', path: String(p) }); if (overrides && overrides.writeFile) return overrides.writeFile(p, text, enc); return realFs.writeFile(p, text, enc) },
    async mkdir(p, opts) { calls.push({ name: 'mkdir', path: String(p) }); if (overrides && overrides.mkdir) return overrides.mkdir(p, opts); return realFs.mkdir(p, opts) },
    async unlink(p) { calls.push({ name: 'unlink', path: String(p) }); if (overrides && overrides.unlink) return overrides.unlink(p); return realFs.unlink(p) },
  }
}
// 假的一台手机：设置那两条电话接到真实现上，开关那两条电话按开关项作答，并且每一次调用都记下来。
//   getFail / getSlowMs 用来制造「文档问不到」与「文档还在路上」；logSetRefuse / logSetThrow 用来制造
//   老路失败的两档；logGetReply 用来造开机对账时宿主副本上那个值。
function makeHost(phones, calls, o) {
  const opts = o || {}
  // getSeq：按次序作答的一次性回包队列（null ＝ 这一趟照真实现走）。用来看「第一次问文档拿到真那一份、
  //   写之前那次重读答半份文档」这种按次序变化的场景，也与 getFail / getSlowMs 并存（队列用完就落回它们）。
  const getSeq = Array.isArray(opts.getSeq) ? opts.getSeq.slice() : null
  return {
    call: function (method, args) {
      calls.push({ method: method, args: args })
      if (method === 'wf.getSettings') {
        if (getSeq && getSeq.length) {
          const one = getSeq.shift()
          if (one) return Promise.resolve(one)
        }
        if (opts.getFail) return Promise.resolve({ ok: false, error: { kind: 'environment', message: '这条电话不在' } })
        if (opts.getSlowMs) return new Promise(function (r) { setTimeout(function () { r(phones.handleGetSettings(args || {})) }, opts.getSlowMs) })
        return phones.handleGetSettings(args || {})
      }
      if (method === 'wf.setSettings') {
        if (opts.setThrow) return Promise.reject(new Error('这台手机自己坏了'))
        if (opts.setRefuse) return Promise.resolve({ ok: false, error: { kind: 'readonly', message: '这份本机设置文件是新版本插件写的，当前插件不许写回去。' } })
        return phones.handleSetSettings(args || {})
      }
      if (method === 'wf.logGetSwitch') {
        if (opts.logGetThrow) return Promise.reject(new Error('这台手机自己坏了'))
        return Promise.resolve(opts.logGetReply || { ok: true, enabled: false, sampleRate: 1 })
      }
      if (method === 'wf.logSetSwitch') {
        if (opts.logSetThrow) return Promise.reject(new Error('这台手机自己坏了'))
        if (opts.logSetRefuse) return Promise.resolve({ ok: false, error: { kind: 'readonly', message: '不许写' } })
        return Promise.resolve({ ok: true, enabled: (args || {}).enabled === true, sampleRate: (args || {}).sampleRate })
      }
      return Promise.resolve({ ok: false, error: { kind: 'environment', message: '这条电话不在' } })
    },
  }
}
// 假的内存 localStorage：记下每一次写，够量「旧键什么时候被写、写的是什么」。
function makeLocalStorage(initial) {
  const m = Object.assign({}, initial || {})
  const calls = []
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(m, k) ? String(m[k]) : null),
    setItem: (k, v) => { calls.push({ key: k, value: String(v) }); m[k] = String(v) },
    removeItem: (k) => { delete m[k] },
    dump: () => Object.assign({}, m),
    calls: calls,
  }
}
// 被测那几片：按 scripts/build.mjs 那一次序拼（log 在最先，设置文档三片，最后是这一片）。
const DERIVED_REL = 'scripts/generated/logKernel.derived.js'
const STATE_REL = 'src/client/kernel/settings-view-state.js'
const VIEW_REL = 'src/client/kernel/settings-view.js'
const WRITE_REL = 'src/client/kernel/settings-view-write.js'
const DEBUG_REL = 'src/client/kernel/settings-debug.js'
const LOG_REL = 'src/client/kernel/log.js'
const INDEX_REL = 'src/client/index.js'
const TAIL = '\nreturn { LOG_DEBUG_KEY: LOG_DEBUG_KEY, logSwitch: logSwitch, logQueue: logQueue, readLocalDebugSwitch: readLocalDebugSwitch, persistLocalDebugSwitch: persistLocalDebugSwitch, setLogSwitch: setLogSwitch, reconcileLogSwitch: reconcileLogSwitch, settingsViewLoad: settingsViewLoad, viewFlagReadyNow: viewFlagReadyNow, viewFlagState: viewFlagState, VIEW_FLAG_WRITE_DEBOUNCE_MS: VIEW_FLAG_WRITE_DEBOUNCE_MS, settingsDebugSet: settingsDebugSet, settingsDebugToggle: settingsDebugToggle, settingsDebugAdoptFromDoc: settingsDebugAdoptFromDoc, settingsDebugDrainDeferred: settingsDebugDrainDeferred, settingsDebugSetInDoc: settingsDebugSetInDoc, settingsDebugLegacyWrite: settingsDebugLegacyWrite, setViewFlagRoot: setViewFlagRoot }'
function makeClient(env) {
  const body = [noExport(readText(DERIVED_REL)), noExport(readText(STATE_REL)), noExport(readText(VIEW_REL)), noExport(readText(WRITE_REL)), noExport(readText(DEBUG_REL))].join('\n')
  const names = ['host', 'timer', 'localStorage', 'broadcastLogSwitch', 'keyOf', 'wsKeyOf', 'shared', 'stores', 'emit', 'currentOs', 'workspaceRootByCwd', 'dswsLogHash']
  return compileFn(names, body + TAIL).apply(null, names.map((n) => env[n]))
}
// 一份空文档（形状与核归一之后那一份逐字一致），debug 节按用例预置。
const dbgDoc = (debug) => ({ version: 1, ui: { stateFilter: '', sortKey: '', sortDir: '', labelClicks: {} }, workspaces: {}, debug: debug || { enabled: false, sampleRate: 1 }, templates: {} })

async function main() {
  console.log('调试开关真源搬进本机设置文件 debug 节门禁（#1012 第 8 条：读以文件为准、拨开关先写文件、宿主只当副本）')

  // ── 第一件事：先构建，并确认这一片真的进了双产物、排在正确的次序上 ──
  console.log('')
  console.log('== 第一件事：先跑构建（这一片的运行时形状来自拼接，不构建就证明不了它进了产物） ==')
  {
    const r = spawnSync(process.execPath, [path.join('scripts', 'build.mjs')], { cwd: ROOT, stdio: 'inherit' })
    check(r.status === 0, 'node scripts/build.mjs 构建通过。', '退出码 ' + String(r.status))
    for (const rel of ['client.js', 'package/lib/client.js']) {
      const t = fs.existsSync(path.join(ROOT, rel)) ? readText(rel) : ''
      check(t.indexOf('const settingsDebugSet = function') >= 0 && t.indexOf('const settingsDebugToggle = function') >= 0 && t.indexOf('const settingsDebugAdoptFromDoc = function') >= 0,
        rel + ' 里拼进了调试开关这一片（排队写、拨开关、采纳三样都在，才算真接上）。')
      // 次序断言的两个锚点先证明存在：锚点一旦改名，indexOf 是 -1，`A > -1` 恒真，次序就没人管了（2026-10-12 复核指出）。
      const seqAnchors = ['const settingsDebugToggle = function', 'const viewFlagWriteNow = function', 'const logSwitch = readLocalDebugSwitch()']
      check(seqAnchors.every((a) => t.indexOf(a) >= 0), rel + ' 里三个次序锚点都找得到（找不到时 indexOf 是 -1，次序断言会恒真）。', JSON.stringify(seqAnchors.map((a) => t.indexOf(a))))
      check(t.indexOf('const settingsDebugToggle = function') > t.indexOf('const viewFlagWriteNow = function'),
        rel + ' 里这一片排在写这一趟之后（它要用待写队列与防抖排期）。')
      check(t.indexOf('const settingsDebugToggle = function') > t.indexOf('const logSwitch = readLocalDebugSwitch()'),
        rel + ' 里这一片排在运行时那份日志内核之后（logSwitch 等名字来自那一份）。')
      check(t.indexOf('kernel:settingsDebug (spliced') < 0, rel + ' 里没有留下这一片的拼接标记（拼进去了）。')
    }
    check(readText('scripts/build.mjs').indexOf("name: 'settingsDebug', file: 'src/client/kernel/settings-debug.js'") >= 0,
      'scripts/build.mjs 的模块清单里登记了 settingsDebug（不登记会静默不编译）。')
    check(readText('package.json').indexOf('node tests/verify-settings-debug.js') >= 0,
      'package.json 的验证链里登记了这一份门禁。')
    check(countLines(DEBUG_REL) <= 350 && countLines(LOG_REL) <= 350 && countLines(INDEX_REL) <= 350 && countLines(VIEW_REL) <= 350 && countLines(WRITE_REL) <= 350,
      '五份文件都在 350 行以内（本片 ' + countLines(DEBUG_REL) + '、旧真源 log.js ' + countLines(LOG_REL) + '、index.js ' + countLines(INDEX_REL) + '、settings-view.js ' + countLines(VIEW_REL) + '、settings-view-write.js ' + countLines(WRITE_REL) + '）。')
  }

  // 真件：宿主的核与两条设置电话
  const leaf = await import(pathToFileURL(path.join(ROOT, 'src/host', 'settingsPhones.js')).href)
  const store = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'configStore.js')).href)
  const sharedKey = readText('src/shared/workspaceKey.js').replace(/^\s*export\s+/gm, '')
  const KEY_OF = compileFn([], sharedKey + '\nreturn keyOf')()
  const CURRENT_OS = compileFn([], sharedKey + '\nreturn currentOs')()
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
    const host = o.noHost ? undefined : makeHost(phones, calls, o)
    const broadcasts = { n: 0 }
    const mod = makeClient({
      keyOf: KEY_OF,
      wsKeyOf: function (c) { return KEY_OF(c) || '' },
      workspaceRootByCwd: {},
      shared: null,
      stores: {},
      emit: function () {},
      host: host,
      localStorage: ls,
      broadcastLogSwitch: function () { broadcasts.n += 1 },
      dswsLogHash: function (s) { return 'h' + String(s || '').length },
      timer: undefined,
      currentOs: CURRENT_OS,
    })
    // 日志队列会被冲刷定时器清空，所以在这里给真队列的 push 挂一层记录：断言要查的那一行只要进过队列
    //   就一定留在这份副本里（这一层只观察，不改包里那一份的行为）。
    const logged = []
    try {
      const origPush = mod.logQueue.push.bind(mod.logQueue)
      mod.logQueue.push = function (entry) { logged.push(entry); return origPush(entry) }
    } catch (eL) {}
    return { mod, ls, calls, broadcasts, home, fnCalls, logged }
  }
  async function readDoc(home) {
    const p = settingsPathIn(home)
    if (!fs.existsSync(p)) return null
    const r = await store.readLocalSettings(home, realIo)
    return (r && r.ok === true) ? r.value : null
  }
  const callsOf = (env, method) => env.calls.filter((c) => c.method === method)
  const lastCall = (env, method) => { const l = callsOf(env, method); return l.length ? l[l.length - 1] : null }
  const lsWrites = (env, key) => env.ls.calls.filter((c) => c.key === key)
  const legacyOf = (env) => { const raw = env.ls.getItem('dsws.debug'); try { return raw ? JSON.parse(raw) : null } catch (e) { return null } }
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
  const waitWrite = (env, capMs) => waitFor(async () => {
    const n = callsOf(env, 'wf.setSettings').length
    if (n === 0) return false
    await sleep(env.mod.VIEW_FLAG_WRITE_DEBOUNCE_MS + 120)
    return callsOf(env, 'wf.setSettings').length === n
  }, capMs)
  // 「一次都没写」这类断言要先等防抖窗口走完再数：窗口没过就数 0 是结构上不可能失败的断言（2026-10-12 复核指出）。
  const quietAfter = async (env) => { await sleep(env.mod.VIEW_FLAG_WRITE_DEBOUNCE_MS + 200) }

  // ── 第二件事：开机秒显仍读旧键（同步、不等文件）──
  console.log('')
  console.log('== 第二件事：开机秒显读旧键 dsws.debug（同步、不等文件，本次不回归） ==')
  {
    const env = makeEnv({ tag: 'boot', localStorage: { 'dsws.debug': JSON.stringify({ enabled: true, sampleRate: 0.5, rev: 3 }) } })
    check(env.mod.logSwitch.enabled === true && env.mod.logSwitch.sampleRate === 0.5,
      '模块一加载就从旧键读出了开关与采样率（开机秒显不等设置文件）。', JSON.stringify(env.mod.logSwitch))
    check(env.mod.viewFlagState.status === 'idle', '此时设置文档还没开始问（秒显与文件无关）。', env.mod.viewFlagState.status)
    check(env.mod.LOG_DEBUG_KEY === 'dsws.debug', '旧键名仍是字面 dsws.debug（门禁钉着的硬约束）。', env.mod.LOG_DEBUG_KEY)
  }

  // ── 第三件事：文件说开 → 以文件为准（内存、旧键快照、广播、宿主副本、采样率都跟文件走）──
  console.log('')
  console.log('== 第三件事：文件里 debug.enabled 说开 → 以文件为准（旧键那一份不顶它） ==')
  {
    const env = makeEnv({ tag: 'docwins', localStorage: { 'dsws.debug': JSON.stringify({ enabled: false, sampleRate: 1, rev: 2 }) } })
    const w = await store.writeLocalSettings(dbgDoc({ enabled: true, sampleRate: 0.25 }), env.home, realIo)
    check(w.ok === true, '预置一份设置文件，debug 节是 {enabled: true, sampleRate: 0.25}。', JSON.stringify(w))
    env.mod.settingsViewLoad()
    check(await ready(env), '读口就绪（文档到手）。')
    check(env.mod.logSwitch.enabled === true, '文件说开 → 内存开关被采纳成开。', String(env.mod.logSwitch.enabled))
    check(env.mod.logSwitch.sampleRate === 0.25, '采样率也用文件里那个数（0.25，不是旧键里的 1）。', String(env.mod.logSwitch.sampleRate))
    check(env.broadcasts.n >= 1, '采纳后广播了一次（界面跟着重画）。', String(env.broadcasts.n))
    const push = lastCall(env, 'wf.logSetSwitch')
    check(!!push && push.args.enabled === true && push.args.sampleRate === 0.25,
      '真源被推给宿主那份副本，带的就是文件里的值（enabled true、sampleRate 0.25）。', JSON.stringify(push && push.args))
    check(legacyOf(env) && legacyOf(env).enabled === true, '旧键被写成开，当这一趟的秒显快照。', JSON.stringify(legacyOf(env)))
    await quietAfter(env)
    check(callsOf(env, 'wf.setSettings').length === 0, '文件里已经是这个值 → 不往文件里写多余的东西（一次 wf.setSettings 都没有）。', String(callsOf(env, 'wf.setSettings').length))
  }

  // ── 第四件事：文件说关、旧键说开 → 认旧键（升级前用户的选择），并排队写回文件 ──
  console.log('')
  console.log('== 第四件事：文件说关、旧键说开 → 认开，并把开排队写回文件（先立后破） ==')
  {
    const env = makeEnv({ tag: 'migrate', localStorage: { 'dsws.debug': JSON.stringify({ enabled: true, sampleRate: 0.5, rev: 4 }) } })
    await store.writeLocalSettings(dbgDoc({ enabled: false, sampleRate: 1 }), env.home, realIo)
    env.mod.settingsViewLoad()
    check(await ready(env), '读口就绪（文档到手，文件里说关）。')
    check(env.mod.logSwitch.enabled === true, '文件说关、旧键说开 → 认开（升级前用户开着）。', String(env.mod.logSwitch.enabled))
    check(env.mod.logSwitch.sampleRate === 0.5, '采样率跟证据那一份走（旧键里的 0.5，不是文件里归一后的默认 1）。', String(env.mod.logSwitch.sampleRate))
    const push = lastCall(env, 'wf.logSetSwitch')
    check(!!push && push.args.enabled === true, '宿主副本被推成开（副本要跟上真源）。', JSON.stringify(push && push.args))
    const landed = await waitFor(async () => { const d = await readDoc(env.home); return !!d && d.debug && d.debug.enabled === true })
    check(landed, '认下来的开排队写进了文件（读回来是 true）。', JSON.stringify((await readDoc(env.home)) || {}))
    const d2 = await readDoc(env.home)
    check(!!d2 && d2.debug.sampleRate === 0.5, '写回文件时采样率也是证据那一份的 0.5。', JSON.stringify(d2 && d2.debug))
  }

  // ── 第五件事：文件说关、旧键没见过、内存也是关 → 默认关，不写多余的东西 ──
  console.log('')
  console.log('== 第五件事：文件说关、旧键没见过、内存也是关 → 默认关，不往文件里写多余的东西 ==')
  {
    const env = makeEnv({ tag: 'noevidence' })
    await store.writeLocalSettings(dbgDoc({ enabled: false, sampleRate: 1 }), env.home, realIo)
    env.mod.settingsViewLoad()
    check(await ready(env), '读口就绪（文档到手，文件说关、旧键没有）。')
    check(env.mod.logSwitch.enabled === false, '没有任何证据说开 → 默认关。', String(env.mod.logSwitch.enabled))
    await quietAfter(env)
    check(callsOf(env, 'wf.setSettings').length === 0, '不往用户从没碰过的文件里添一笔默认值（没有 wf.setSettings）。', String(callsOf(env, 'wf.setSettings').length))
    const push = lastCall(env, 'wf.logSetSwitch')
    check(!!push && push.args.enabled === false, '宿主副本照旧对齐成关（推一次措辞相同的一份）。', JSON.stringify(push && push.args))
  }

  // ── 第六件事：拨开关，文件这条路接得下 → 只写文件；宿主失败仍算成功 ──
  console.log('')
  console.log('== 第六件事：拨开关文件这条路接得下 → 写文件为准，宿主那一步失败也回 ok: true ==')
  {
    const env = makeEnv({ tag: 'togglefile', logSetRefuse: true })
    await store.writeLocalSettings(dbgDoc({ enabled: false, sampleRate: 1 }), env.home, realIo)
    env.mod.settingsViewLoad()
    check(await ready(env), '读口就绪（文档到手）。')
    const nBefore = env.broadcasts.n
    const legacyBefore = lsWrites(env, 'dsws.debug').length
    const res = await env.mod.settingsDebugToggle(true, 1)
    check(!!res && res.ok === true && res.enabled === true && res.sampleRate === 1,
      '宿主拒绝写副本，但真源已经落地 → 回 ok: true（不把用户这一下判成失败）。', JSON.stringify(res))
    check(env.mod.logSwitch.enabled === true, '内存当场改成开（不等落盘）。', String(env.mod.logSwitch.enabled))
    check(env.broadcasts.n > nBefore, '广播了一次（界面跟着重画）。', String(env.broadcasts.n))
    check(legacyOf(env) && legacyOf(env).enabled === true, '旧键写成开当秒显快照。', JSON.stringify(legacyOf(env)))
    const wrote = await waitWrite(env)
    check(wrote, '这一笔落进了设置文件（发生了 wf.setSettings）。', String(callsOf(env, 'wf.setSettings').length))
    const d = await readDoc(env.home)
    check(!!d && d.debug.enabled === true && d.debug.sampleRate === 1, '文件里的 debug 节是 {enabled: true, sampleRate: 1}。', JSON.stringify(d && d.debug))
    const push = lastCall(env, 'wf.logSetSwitch')
    check(!!push && push.args.enabled === true && push.args.sampleRate === 1, '宿主副本被推成同一个值（副本只是副本）。', JSON.stringify(push && push.args))
    const fails = env.logged.filter((q) => q.event === 'host.call.fail' && q.fields && q.fields.method === 'wf.logSetSwitch')
    check(fails.length >= 1 && fails[fails.length - 1].fields.kind === 'set-switch-host-rejected',
      '宿主那一步失败记了一行 host.call.fail（method 与 kind 沿用包里的分档，不新增事件名）。', JSON.stringify(fails.length ? fails[fails.length - 1].fields : env.logged.map((q) => q.event)))
    check(lsWrites(env, 'dsws.debug').length === legacyBefore + 1, '旧键这一趟只多写一次（写文件成功，旧键只当秒显快照）。', String(lsWrites(env, 'dsws.debug').length - legacyBefore))
  }

  // ── 第七件事：文件这条路接不下 → 退回包里的老路（错误码原样）──
  console.log('')
  console.log('== 第七件事：文件这条路接不下 → 原样走包里的 setLogSwitch（错误码一字不改） ==')
  {
    const env = makeEnv({ tag: 'fallback', getFail: true, logSetRefuse: true })
    env.mod.settingsViewLoad()
    check(await ready(env), '文档问不到也算就绪（这一档就是「这条路接不下」）。')
    const res = await env.mod.settingsDebugToggle(true, 1)
    check(!!res && res.ok === false && res.error === 'host-rejected', '宿主拒绝 → 回包原样是 host-rejected。', JSON.stringify(res))
    check(callsOf(env, 'wf.logSetSwitch').length >= 1, '走的是老路那条宿主电话（宿主收到了 wf.logSetSwitch）。', String(callsOf(env, 'wf.logSetSwitch').length))
    check(callsOf(env, 'wf.setSettings').length === 0, '接不下时一个字节都不往设置文件写。', String(callsOf(env, 'wf.setSettings').length))
    check(env.mod.logSwitch.enabled === false, '老路失败 → 本地值保持原样（不假装成功）。', String(env.mod.logSwitch.enabled))

    const env2 = makeEnv({ tag: 'fallback-throw', getFail: true, logSetThrow: true })
    env2.mod.settingsViewLoad()
    await ready(env2)
    const res2 = await env2.mod.settingsDebugToggle(true, 1)
    check(!!res2 && res2.ok === false && res2.error === 'throw', '宿主自己坏了 → 回包原样是 throw。', JSON.stringify(res2))

    const env3 = makeEnv({ tag: 'fallback-nohost', getFail: true, noHost: true })
    env3.mod.settingsViewLoad()
    await ready(env3)
    const res3 = await env3.mod.settingsDebugToggle(true, 1)
    check(!!res3 && res3.ok === false && res3.error === 'host-unavailable', '连宿主都没有 → 回包原样是 host-unavailable。', JSON.stringify(res3))
  }

  // ── 第八件事：文档还在路上时拨开关 → 先进待写队列，文档到手落进文件，采纳不顶回用户这一下 ──
  console.log('')
  console.log('== 第八件事：文档还在路上时拨开关 → 排进待写队列，到手后落进文件（采纳不许拿旧值顶回去） ==')
  {
    const env = makeEnv({ tag: 'deferred', getSlowMs: 200 })
    await store.writeLocalSettings(dbgDoc({ enabled: false, sampleRate: 1 }), env.home, realIo)
    env.mod.settingsViewLoad()
    check(env.mod.viewFlagState.status === 'loading', '文档还在路上（status 是 loading）。', env.mod.viewFlagState.status)
    const res = await env.mod.settingsDebugToggle(true, 1)
    check(!!res && res.ok === true, '还在路上就拨 → 这一笔被接下了（回 ok: true，等文档落地再并进去）。', JSON.stringify(res))
    check(env.mod.logSwitch.enabled === true, '内存当场就是开（用户看见的那一下不迟钝）。', String(env.mod.logSwitch.enabled))
    check(await ready(env), '文档到手（收口）。')
    check(env.mod.logSwitch.enabled === true, '采纳那一趟没有拿文件里的旧值把用户刚拨的这一下顶回去。', String(env.mod.logSwitch.enabled))
    const landed = await waitFor(async () => { const d = await readDoc(env.home); return !!d && d.debug && d.debug.enabled === true })
    check(landed, '文档到手后这两笔落进了文件的 debug 节。', JSON.stringify((await readDoc(env.home)) || {}))
  }

  // ── 第九件事：开机对账之后，采纳仍以文件为准并把真源推给宿主副本 ──
  console.log('')
  console.log('== 第九件事：开机对账（宿主副本覆盖内存）之后，采纳仍以文件为准并把真源推给宿主 ==')
  {
    const env = makeEnv({ tag: 'reconcile', logGetReply: { ok: true, enabled: false, sampleRate: 1 } })
    await store.writeLocalSettings(dbgDoc({ enabled: true, sampleRate: 0.25 }), env.home, realIo)
    const rec = await env.mod.reconcileLogSwitch()
    check(!!rec && rec.ok === true && env.mod.logSwitch.enabled === false,
      '开机对账照包里的老样子拿宿主副本覆盖了内存（这一档本身没改）。', JSON.stringify(rec))
    env.mod.settingsViewLoad()
    check(await ready(env), '文档到手。')
    check(env.mod.logSwitch.enabled === true, '采纳以文件为准，把对账覆盖回来的「关」纠正成「开」。', String(env.mod.logSwitch.enabled))
    const push = lastCall(env, 'wf.logSetSwitch')
    check(!!push && push.args.enabled === true && push.args.sampleRate === 0.25,
      '推给宿主副本的是文件里那一份（enabled true、sampleRate 0.25）。', JSON.stringify(push && push.args))
  }

  // ── 第十件事：采样率越界不许写进文件（核会整份拒绝）──
  console.log('')
  console.log('== 第十件事：采样率越界（2）不许写进文件 → 回退成内存里那个合法值 ==')
  {
    const env = makeEnv({ tag: 'rate' })
    await store.writeLocalSettings(dbgDoc({ enabled: false, sampleRate: 0.5 }), env.home, realIo)
    env.mod.settingsViewLoad()
    await ready(env)
    env.mod.logSwitch.sampleRate = 0.5
    const res = await env.mod.settingsDebugToggle(true, 2)
    check(!!res && res.ok === true && res.sampleRate === 0.5, '越界的 2 被挡下，回的是内存里那个合法值 0.5。', JSON.stringify(res))
    const wrote = await waitWrite(env)
    check(wrote, '这一笔照样落盘（挡住坏值，不是整笔丢掉）。', String(callsOf(env, 'wf.setSettings').length))
    const d = await readDoc(env.home)
    check(!!d && d.debug.enabled === true && d.debug.sampleRate === 0.5, '文件里写的是合法值 {enabled: true, sampleRate: 0.5}。', JSON.stringify(d && d.debug))
  }

  // ── 第十一件事：文档从没问过（idle）时拨开关：这一下先走老路，但要记账，采纳不许拿文件里的旧值顶回来 ──
  console.log('')
  console.log('== 第十一件事：idle 档拨开关（新会话第一次打开设置页）：先走老路，同时记账；采纳不许把这一下顶回去 ==')
  {
    // 文件里本来写着开，用户在 idle 下把它拨成关。2026-10-12 复核实测：这一档若不记账，同一个拨动引出的
    //   那趟采纳会照文件里的开把用户刚拨的关覆盖回去，而这次的关此后没有任何机会写进文件 —— 文件恒为 true，
    //   是确定性丢失而不是竞态。记的时点在老路成功之后（失败那一档见本节末尾），第一句话查的就是这两笔在不在。
    const env = makeEnv({ tag: 'idle-off', localStorage: { 'dsws.debug': JSON.stringify({ enabled: true, sampleRate: 0.25, rev: 5 }) } })
    await store.writeLocalSettings(dbgDoc({ enabled: true, sampleRate: 0.25 }), env.home, realIo)
    check(env.mod.viewFlagState.status === 'idle', '拨之前这份文档从没问过（status 是 idle）。', env.mod.viewFlagState.status)
    const res = await env.mod.settingsDebugToggle(false, 1)
    check(!!res && res.ok === true && res.enabled === false, '这一下先交给包里的老路，回的是关（老路的形状一字不改）。', JSON.stringify(res))
    check(Object.keys(env.mod.viewFlagState.deferred).length === 2,
      '老路成功之后补记了两笔待写（enabled 与 sampleRate），文档到手那趟采纳才看得见。', JSON.stringify(Object.keys(env.mod.viewFlagState.deferred)))
    check(await ready(env), '文档到手（这一下自己把文档问起来了）。', env.mod.viewFlagState.status)
    const offInFile = await waitFor(async () => { const d = await readDoc(env.home); return !!d && d.debug.enabled === false })
    check(offInFile, '文件里 debug.enabled 变成关 —— 用户在 idle 下拨的关既没被采纳用文件里的开顶回去，也真进了文件。', JSON.stringify(((await readDoc(env.home)) || {}).debug))
    const dOff = await readDoc(env.home)
    check(!!dOff && dOff.debug.sampleRate === 1, '同一节的采样率也跟着这一下写成了 1（两格一起写，不留半份）。', JSON.stringify(dOff && dOff.debug))
    check(env.mod.logSwitch.enabled === false, '内存还是用户拨的关。', String(env.mod.logSwitch.enabled))
    check(legacyOf(env) && legacyOf(env).enabled === false, '旧键快照也写成了关（开机秒显那一路跟着走）。', JSON.stringify(legacyOf(env)))

    // 老路被拒这一档（2026-10-12 复核的必修 3）：还不知道老路结果之前不许留下必写痕迹。旧写法在这里就记了两笔
    //   待写，文档一到手就把「界面刚说失败」的那个值写进文件 —— 界面说没成、文件说成了。
    const envR = makeEnv({ tag: 'idle-rejected', logSetRefuse: true })
    await store.writeLocalSettings(dbgDoc({ enabled: false, sampleRate: 1 }), envR.home, realIo)
    check(envR.mod.viewFlagState.status === 'idle', '拒绝这一档拨之前也没问过文档（status 是 idle）。', envR.mod.viewFlagState.status)
    const resR = await envR.mod.settingsDebugToggle(true, 1)
    check(!!resR && resR.ok === false, 'idle 档老路被拒 → 回包是失败（界面会照实说失败）。', JSON.stringify(resR))
    check(Object.keys(envR.mod.viewFlagState.deferred).length === 0,
      '失败之后队列里一笔痕迹都不留（不许「界面说失败、文件里却写着这一笔」）。', JSON.stringify(Object.keys(envR.mod.viewFlagState.deferred)))
    check(await ready(envR), '文档照样到手（这一下自己把它问起来了）。', envR.mod.viewFlagState.status)
    await quietAfter(envR)
    const dR = await readDoc(envR.home)
    check(!!dR && dR.debug.enabled === false && callsOf(envR, 'wf.setSettings').length === 0,
      '文件里的 debug 节没被写（还是原来那个关，一次 wf.setSettings 都没有）。', JSON.stringify({ debug: dR && dR.debug, writes: callsOf(envR, 'wf.setSettings').length }))
  }

  // ── 第十二件事：idle 档 + 文件里没有 debug 这一节 + 拨开 → 文件里要长出 enabled: true ──
  console.log('')
  console.log('== 第十二件事：idle 档 + 文件里根本没有 debug 这一节（那边只有一条手写的旧文件）+ 拨开 ==')
  {
    // 盘上放一份手写的、没有 debug 节的设置文件（核读进来会归一成默认关）。这一下若不记账，采纳会按
    //   「文件里没人开过」的默认关把用户刚拨的开丢掉，文件也永远不会长出这一节。
    const home = makeHome('idle-nosec')
    fs.mkdirSync(path.dirname(settingsPathIn(home)), { recursive: true })
    fs.writeFileSync(settingsPathIn(home), 'version: 1\nui:\n  stateFilter: open\n  sortKey: ""\n  sortDir: ""\n  labelClicks: {}\nworkspaces: {}\ntemplates: {}\n', 'utf8')
    const env = makeEnv({ tag: 'idle-nosec', home: home })
    const before = await store.readLocalSettings(home, realIo)
    check(before.ok === true && before.value.debug && before.value.debug.enabled === false,
      '盘上这份文件本来没有开着的调试开关（缺的这一节被核归一成默认关）。', JSON.stringify(before.value && before.value.debug))
    const res = await env.mod.settingsDebugToggle(true, 1)
    check(!!res && res.ok === true && res.enabled === true, '这一下先走老路，回的是开。', JSON.stringify(res))
    // 这一档的结局也靠老路那条线索（旧键快照，以及老路留在内存里的那个开）兜得住；所以要单独钉住「当场记了
    //   两笔待写」——「文件里这一节是缺的」与「文件里写着关」两种情形都得走同一条记账，不能只靠线索侥幸接住。
    check(Object.keys(env.mod.viewFlagState.deferred).length === 2,
      '老路成功之后补记了两笔待写（缺这一节时也要记账）。', JSON.stringify(Object.keys(env.mod.viewFlagState.deferred)))
    check(await ready(env), '文档到手。', env.mod.viewFlagState.status)
    const onInFile = await waitFor(async () => { const d = await readDoc(env.home); return !!d && d.debug.enabled === true })
    check(onInFile, '文件里长出了 debug.enabled: true（这一下没丢）。', JSON.stringify(((await readDoc(env.home)) || {}).debug))
    const dOn = await readDoc(env.home)
    check(!!dOn && dOn.ui && dOn.ui.stateFilter === 'open', '文件里别的节没被写坏（ui.stateFilter 还是 open）。', JSON.stringify(dOn && dOn.ui))
  }

  // ── 第十三件事：idle 档 + 文档始终问不到 → 这一下不许悄悄丢 ──
  console.log('')
  console.log('== 第十三件事：idle 档 + 文档始终问不到（getSettings 回失败）→ 老路接手、旧键留痕、文件不凭空建 ==')
  {
    const env = makeEnv({ tag: 'idle-nodoc', getFail: true })
    const res = await env.mod.settingsDebugToggle(true, 0.5)
    check(!!res && res.ok === true && res.enabled === true, '文档问不到，老路照样把这一下接下来了（回的是开）。', JSON.stringify(res))
    check(legacyOf(env) && legacyOf(env).enabled === true && legacyOf(env).sampleRate === 0.5,
      '旧键快照里就是用户刚拨的那个值（这一下没有静默消失）。', JSON.stringify(legacyOf(env)))
    check(callsOf(env, 'wf.logSetSwitch').length >= 1, '宿主副本那条老电话收到了这一下。', String(callsOf(env, 'wf.logSetSwitch').length))
    check(env.logged.some((e) => e && e.event === 'host.call.fail' && e.fields && e.fields.method === 'wf.getSettings'),
      '文档问不到这件事有日志留痕（不静默），名字用的是既有的 host.call.fail。', JSON.stringify(env.logged.map((e) => e && e.event)))
    check(await waitFor(async () => env.mod.viewFlagState.status === 'unavailable'), '文档这条口子收在「问不到」那一档（不是一直挂着）。', env.mod.viewFlagState.status)
    const dNone = await readDoc(env.home)
    check(dNone === null, '没有凭空造出一份设置文件（问不到文档就不写文件）。', JSON.stringify(dNone))
    check(lsWrites(env, 'dsws.debug').length >= 1, '旧键被写过（老路成功那一趟的快照，加上这一手兜底口子）。', String(lsWrites(env, 'dsws.debug').length))
  }

  // ── 第十四件事：半份文档当不了真源（拨动退回老路；写之前那次重读也不许拿它当基底）──
  console.log('')
  console.log('== 第十四件事：半份文档（占位电话答上来的空壳）当不了真源：拨动退回老路，重读到了也不当基底 ==')
  {
    // 一、拨动那一档：getSettings 答 {ok:true, value:{}}（老宿主或占位电话的假回复）。
    const env = makeEnv({ tag: 'shell-toggle', getSeq: [{ ok: true, value: {} }] })
    env.mod.settingsViewLoad()
    check(await waitFor(async () => env.mod.viewFlagState.status === 'unavailable'), '空壳这一档收口在「问不到」（不够格当文档，不当真源）。', env.mod.viewFlagState.status)
    check(env.mod.viewFlagState.doc === null, '空壳没被收进内存（拿它当基底会把别的节写成空值）。', JSON.stringify(env.mod.viewFlagState.doc))
    const res = await env.mod.settingsDebugToggle(true, 1)
    check(!!res && res.ok === true, '拨动照样成立（走老路兜底）。', JSON.stringify(res))
    check(callsOf(env, 'wf.logSetSwitch').length >= 1, '这一下走的是包里的老路（宿主开关电话收到了）。', String(callsOf(env, 'wf.logSetSwitch').length))
    await quietAfter(env)
    check(callsOf(env, 'wf.setSettings').length === 0, '没有拿空壳当文档往文件里写（写这条电话一次都没调）。', String(callsOf(env, 'wf.setSettings').length))
    check((await readDoc(env.home)) === null, '文件没有被凭空造出来。', JSON.stringify(await readDoc(env.home)))
    check(env.mod.logSwitch.enabled === true, '内存里这一下是开（老路写的）。', String(env.mod.logSwitch.enabled))
    // 二、写之前那次重读答半份文档：不许拿它当基底整份写回，别的几节要被保住。
    const home2 = makeHome('shell-base')
    const full = dbgDoc({ enabled: false, sampleRate: 1 })
    full.ui.stateFilter = 'open'
    full.workspaces = { 'D:\\proj': { bannerFolded: true } }
    full.templates = { comment: 'hello' }
    await store.writeLocalSettings(full, home2, realIo)
    const env2 = makeEnv({ tag: 'shell-base', home: home2, getSeq: [null, { ok: true, value: { version: 1 } }] })
    env2.mod.settingsViewLoad()
    check(await ready(env2), '第一次问文档拿到的是真那一份（后面那次重读才答半份）。', env2.mod.viewFlagState.status)
    const tookSet = env2.mod.setViewFlagRoot('D:\\proj', 'bannerFolded', false, 'D:\\proj')
    check(tookSet === true, '另一族（工作区那格）那一笔记进了待写队列。', String(tookSet))
    check(await waitWrite(env2), '这一笔落了一次盘。', String(callsOf(env2, 'wf.setSettings').length))
    const landed = await waitFor(async () => {
      const d = await readDoc(home2)
      return !!d && !!d.workspaces && !!d.workspaces['D:\\proj'] && d.workspaces['D:\\proj'].bannerFolded === false
    })
    check(landed, '这一笔自己落了盘（bannerFolded 变成 false）。', JSON.stringify(((await readDoc(home2)) || {}).workspaces))
    const dShell = await readDoc(home2)
    check(!!dShell && dShell.ui.stateFilter === 'open' && dShell.templates.comment === 'hello',
      '半份文档没被当成基底：别的节（ui.stateFilter、templates.comment）原样还在，没被写成空值。',
      JSON.stringify({ ui: dShell && dShell.ui, templates: dShell && dShell.templates }))
    // 三、第一趟问到真文档（debug 节是 {enabled: true, sampleRate: 0.25}），写之前那次重读答半份 {version:1}：这一笔
    //   要退回内存那一份当基底，所以内存文档里刚写进去的采样率必须跟着走 —— 只写开关那一格时，文件里会留着 0.25
    //   （2026-10-12 复核的必修 4：变异体下这一档原来 105 条全绿）。
    const home3 = makeHome('rate-base')
    await store.writeLocalSettings(dbgDoc({ enabled: true, sampleRate: 0.25 }), home3, realIo)
    const env3 = makeEnv({ tag: 'rate-base', home: home3, getSeq: [null, { ok: true, value: { version: 1 } }] })
    env3.mod.settingsViewLoad()
    check(await ready(env3), '第一趟问到真那一份（后面那次重读才答半份）。', env3.mod.viewFlagState.status)
    check(env3.mod.logSwitch.sampleRate === 0.25, '采纳把文件里的采样率 0.25 搬进了内存。', String(env3.mod.logSwitch.sampleRate))
    const res3 = await env3.mod.settingsDebugToggle(true, 1)
    check(!!res3 && res3.ok === true && res3.sampleRate === 1, 'ready 档拨开，递进去的采样率是 1。', JSON.stringify(res3))
    check(await waitWrite(env3), '这一笔落了盘。', String(callsOf(env3, 'wf.setSettings').length))
    const dRate = await waitFor(async () => { const d = await readDoc(home3); return !!d && d.debug.enabled === true && d.debug.sampleRate === 1 })
    check(dRate, '落盘后 debug 节是 {enabled: true, sampleRate: 1}（重读答半份时以内存那一份当基底，两格都是新写的值）。', JSON.stringify(((await readDoc(home3)) || {}).debug))
    // 光看盘上最后那一份还不够：这一趟若只把开关那一格写进内存文档，盘上那份带着旧的 0.25，回包按值划队列时这条
    //   对不上，于是自己又重排一趟、把队列里的值补写进去，最后盘上看起来也是对的（复核指出：变异体下 105 条全绿）。
    //   所以要直接查「第一趟发出去的那份文档」与「一共发了几趟」，这两条才是这一格的判据。
    const firstWrite = callsOf(env3, 'wf.setSettings')[0]
    const sentDbg = firstWrite && firstWrite.args && firstWrite.args.value && firstWrite.args.value.debug
    check(!!sentDbg && sentDbg.enabled === true && sentDbg.sampleRate === 1,
      '第一趟发出去的 debug 节就是 {enabled: true, sampleRate: 1}（只写开关那一格时这里会是旧的 0.25）。', JSON.stringify(sentDbg))
    check(callsOf(env3, 'wf.setSettings').length === 1, '写这一趟只发一次（第一趟就带对了值，不必自己再补一趟）。', String(callsOf(env3, 'wf.setSettings').length))
    // 四、第一趟就答半份 {version:1}（2026-10-12 复核的必修 1）：收文档那一步只判「是不是对象」时，这份半成品会被收进
    //   内存，写这一趟重读又答同一份半成品，于是拿它当基底整份写回 —— 核归一之后用户的 ui / workspaces / templates
    //   就成了空值。修法是把判据收在收文档那一步，这一份连内存都不许进。
    const home4 = makeHome('half-first')
    const full4 = dbgDoc({ enabled: false, sampleRate: 1 })
    full4.ui.stateFilter = 'open'
    full4.workspaces = { 'D:\\proj': { bannerFolded: true } }
    full4.templates = { comment: 'hello' }
    await store.writeLocalSettings(full4, home4, realIo)
    const env4 = makeEnv({ tag: 'half-first', home: home4, getSeq: [{ ok: true, value: { version: 1 } }, { ok: true, value: { version: 1 } }] })
    env4.mod.settingsViewLoad()
    check(await waitFor(async () => env4.mod.viewFlagState.status === 'unavailable'), '第一趟答半份 → 这一趟不收它（落在「问不到」那一档）。', env4.mod.viewFlagState.status)
    check(env4.mod.viewFlagState.doc === null, '半份文档没被收进内存（内存里一份文档都没有）。', JSON.stringify(env4.mod.viewFlagState.doc))
    const res4 = await env4.mod.settingsDebugToggle(true, 1)
    check(!!res4 && res4.ok === true, '拨动照样成立（走老路兜底）。', JSON.stringify(res4))
    check(callsOf(env4, 'wf.logSetSwitch').length >= 1, '这一下走的是包里的老路。', String(callsOf(env4, 'wf.logSetSwitch').length))
    await quietAfter(env4)
    check(callsOf(env4, 'wf.setSettings').length === 0, '半份文档没被当基底写回文件（写电话一次都没调）。', String(callsOf(env4, 'wf.setSettings').length))
    const d4 = await readDoc(home4)
    check(!!d4 && d4.ui.stateFilter === 'open' && !!d4.workspaces['D:\\proj'] && d4.templates.comment === 'hello',
      '盘上文件原样还在：ui / workspaces / templates 三节都没被写成空值。', JSON.stringify({ ui: d4 && d4.ui, ws: d4 && d4.workspaces, tpl: d4 && d4.templates }))
    check(!!d4 && d4.debug.enabled === false, '文件里的 debug 节也没被这一下改动。', JSON.stringify(d4 && d4.debug))
  }

  // ── 第十五件事：更高版本的文档（只读）不许被写，文件逐字节不动 ──
  console.log('')
  console.log('== 第十五件事：更高版本写出来的文档（只读那一档）拨开关 → 走老路，文件逐字节不变 ==')
  {
    const home = makeHome('readonly')
    await store.writeLocalSettings(dbgDoc({ enabled: false, sampleRate: 1 }), home, realIo)
    const rawBefore = fs.readFileSync(settingsPathIn(home), 'utf8')
    const env = makeEnv({
      tag: 'readonly', home: home,
      getSeq: [{ ok: true, value: { version: 99, ui: {}, workspaces: {}, debug: { enabled: false, sampleRate: 1 }, templates: {} }, readonly: true, from: 'yaml' }],
    })
    env.mod.settingsViewLoad()
    check(await waitFor(async () => env.mod.viewFlagState.status === 'readonly'), '更高版本的文档落在只读那一档。', env.mod.viewFlagState.status)
    const res = await env.mod.settingsDebugToggle(true, 1)
    check(!!res && res.ok === true, '这一下照样成立（走老路兜底）。', JSON.stringify(res))
    check(callsOf(env, 'wf.logSetSwitch').length >= 1, '走的是包里的老路。', String(callsOf(env, 'wf.logSetSwitch').length))
    await quietAfter(env)
    check(callsOf(env, 'wf.setSettings').length === 0, '只读文档一次都没被写回去。', String(callsOf(env, 'wf.setSettings').length))
    check(fs.readFileSync(settingsPathIn(home), 'utf8') === rawBefore, '文件逐字节没变（只读这一档不许动它）。')
  }

  // ── 第十六件事：旧键只在文件这条路接不下时才由本片兜底写 ──
  console.log('')
  console.log('== 第十六件事：旧键只在文件这条路接不下时才兜底写（接得下时不乱写） ==')
  {
    const env = makeEnv({ tag: 'legacy-nofile', getFail: true, logSetRefuse: true })
    env.mod.settingsViewLoad()
    await ready(env)
    const legacyBefore = lsWrites(env, 'dsws.debug').length
    await env.mod.settingsDebugToggle(true, 1)
    check(callsOf(env, 'wf.logSetSwitch').length >= 1 && lsWrites(env, 'dsws.debug').length === legacyBefore,
      '老路失败这一档这一次拨动没有再写旧键（包里的老路只在成功时才写快照）。', String(lsWrites(env, 'dsws.debug').length - legacyBefore))
    const env2 = makeEnv({ tag: 'legacy-docgone', getFail: true, logSetRefuse: true })
    await store.writeLocalSettings(dbgDoc({ enabled: false, sampleRate: 1 }), env2.home, realIo)
    env2.mod.settingsViewLoad()
    await ready(env2)
    env2.mod.settingsViewLoad()
    const took = env2.mod.settingsDebugLegacyWrite()
    check(took === true && legacyOf(env2) && legacyOf(env2).enabled === false,
      '这一手兜底口子写得进旧键，写的是内存那一份（此处内存是关）。', JSON.stringify(legacyOf(env2)))
  }

  // ── 第十七件事：不新增日志事件名（对着 #489 附录里的现行清单查，不改那个文件）──
  console.log('')
  console.log('== 第十七件事：不新增日志事件名（只用既有的两档，名字都在 #489 附录里） ==')
  {
    // 扫构建产物里这一片的实际字符串（源码里事件名走变量就漏，2026-10-12 复核指出）：先把这一片从产物里切出来。
    const built = readText('client.js')
    const head = built.indexOf('const SETTINGS_DEBUG_NAMES')
    const tail = built.indexOf('viewFlagSubscribe(settingsDebugAdoptFromDoc)', head)
    const slice = (head >= 0 && tail > head) ? built.slice(head, tail) : ''
    check(slice.length > 0, '从构建产物里切出了这一片的正文（产物里找得到起止两个锚点）。', String(slice.length))
    const allowed = ['host.call.fail', 'storage.fail']
    const re = /(?:^|[^A-Za-z0-9_$.])log\s*\(\s*'([^']+)'\s*,\s*'([^']+)'/g
    const calls = []
    let m
    while ((m = re.exec(slice)) !== null) calls.push(m[2])
    check(calls.length >= 2, '这一片在产物里确实留下了日志点（数到 ' + calls.length + ' 处）。', JSON.stringify(calls))
    // 产物里每一处 log 调用的事件名都要是写死的字面量：走变量（log('warn', name, …)）会在这里露出来。
    const allLogCalls = slice.match(/(?:^|[^A-Za-z0-9_$.])log\s*\(/g) || []
    check(allLogCalls.length === calls.length, '产物里每一处 log 调用的事件名都是写死的字面量（数到 ' + allLogCalls.length + ' 处调用）。', JSON.stringify({ calls: allLogCalls.length, literal: calls.length }))
    check(calls.every((n) => allowed.indexOf(n) >= 0), '用的都是既有事件名（host.call.fail / storage.fail），没有新造的。', JSON.stringify(calls))
    const appendix = readText('research/489-appendix.md')
    check(allowed.every((n) => appendix.indexOf(n) >= 0), '两个名字都在 #489 附录的现行清单里（那个文件本次没改）。', JSON.stringify(allowed))
  }

  // ── 第十八件事：宿主那份副本没跟上时怎么收场（回包带上副本状态、界面换限定语、下一次机会自动重推）──
  console.log('')
  console.log('== 第十八件事：宿主副本没跟上 → 回包带 hostPushed、界面换限定语文案、下一次文档到手自动重推 ==')
  {
    // 一、副本拒绝：文件这条路接得下，真源照样算成功，但回包要把副本状态带出来；下一次文档到手要自己重推一次。
    const env = makeEnv({ tag: 'hostpushed-no', logSetRefuse: true })
    await store.writeLocalSettings(dbgDoc({ enabled: false, sampleRate: 1 }), env.home, realIo)
    env.mod.settingsViewLoad()
    check(await ready(env), '文档到手。')
    const res = await env.mod.settingsDebugToggle(true, 1)
    check(!!res && res.ok === true && res.hostPushed === false,
      '副本被拒 → 真源照样算成功，但回包把副本状态带出来（hostPushed: false）。', JSON.stringify(res))
    const pushesBefore = callsOf(env, 'wf.logSetSwitch').length
    env.mod.settingsDebugAdoptFromDoc()
    check(callsOf(env, 'wf.logSetSwitch').length > pushesBefore,
      '下一次文档到手时自己重推了一次（一次失败能自愈，不用用户再拨一遍）。', String(callsOf(env, 'wf.logSetSwitch').length - pushesBefore))
    // 二、副本接受：回包 hostPushed: true（界面照旧弹那句不带限定语的）。
    const env2 = makeEnv({ tag: 'hostpushed-yes' })
    await store.writeLocalSettings(dbgDoc({ enabled: false, sampleRate: 1 }), env2.home, realIo)
    env2.mod.settingsViewLoad()
    check(await ready(env2), '文档到手。')
    const res2 = await env2.mod.settingsDebugToggle(true, 1)
    check(!!res2 && res2.ok === true && res2.hostPushed === true, '副本接上了 → 回包 hostPushed: true。', JSON.stringify(res2))
    // 三、界面：副本没跟上时不弹没限定语的「已开启」，换的是那一句说清「文件已写、本机日志暂时记不下」的文案；
    //   这句话中文与英文两份词表里都得有（界面文案一律走词表，不许写字面量）。
    const page = readText('src/client/views/SettingsPage.js')
    check(page.indexOf('res.hostPushed === false') >= 0 && page.indexOf("'cfg.dbgSwitchOnNoHost'") >= 0,
      '设置页按 hostPushed 换文案：副本没跟上时不弹没限定语的「已开启」。', String(page.indexOf('cfg.dbgSwitchOnNoHost')))
    const localeLines = readText('src/client/kernel/locale-flow.js').split(/\r?\n/).filter((l) => l.indexOf("'cfg.dbgSwitchOnNoHost'") >= 0)
    const zhLine = localeLines.find((l) => l.indexOf('调试日志已打开') >= 0) || ''
    const enLine = localeLines.find((l) => l.indexOf('Debug log on') >= 0) || ''
    check(zhLine.length > 0 && enLine.length > 0 && zhLine !== enLine,
      '这句限定语在中文与英文两份词表里都有，而且各自写成本国语言（不是同一句抄两遍）。', JSON.stringify(localeLines.map((l) => l.length)))
  }

  console.log('')
  console.log('== 汇总：' + passed + ' 条通过，' + failed + ' 条失败 ==')
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('门禁自己抛错：' + ((e && e.stack) || e))
  process.exit(1)
})
