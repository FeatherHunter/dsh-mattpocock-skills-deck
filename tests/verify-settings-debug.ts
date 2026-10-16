#!/usr/bin/env node
/**
 * verify-settings-debug.ts —— 调试开关真源搬进本机设置文件 debug 节的门禁（#1012 第 8 条）。
 * 写法保持 require 风格：验证链经装载钩子载入本文件，require 与 __dirname 照 CommonJS 形态工作
 * （与 tests/verify-1207-splice-ts.ts 同形）；改成 import 形态没有收益，只添风险，所以不改。
 * 用法: node --import ./scripts/ts-hook.mjs tests/verify-settings-debug.ts（在插件根目录；先运行 node scripts/build.mjs 生成产物）
 *
 * 这一份门禁量十九件事，每一件都用完整的一句话说清，第一次读的人能直接看懂。
 * 第一件事是构建与登记：这一片的运行时形状来自拼接，不跑构建就证明不了它进了双产物；它必须排在写这一趟
 *   之后（要用待写队列与排期）与运行时那份日志内核之后（要用 logSwitch / persistLocalDebugSwitch 等名字）。
 * 第二件事是开机秒显仍读本地快照：同步、不等文件（这是包里的行为，本次不回归；0.3.x 起快照键是 dsws.debug.wf，裸键只当升级证据）。
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
 *   带限定语的文案（拨成开、拨成关各一句，不许只弹「已开启」），并且下一次打开设置页会自动再推一次，让一次
 *   失败自愈（2026-10-12 复核的必修 B：真触发路径在设置页挂载那一趟，不在内部函数上）。
 * 第十九件事是在真产物上真跑一遍设置页（jsdom + 真 React，手法照 tests/verify-log-switch-597.js）：量三件
 *   只有用户视角才量得到的事 —— ① 老路慢、文档先到手那一趟不许把用户刚拨的值顶回去（复核的必修 A，用
 *   D:\Temp\rev-probe\q3-race-both.js 复现过的确定性丢拨动）；② 副本没跟上之后，下一次打开设置页那一趟
 *   （真挂载）自己把副本重推一次（必修 B 的真触发路径）；③ 副本没跟上时拨成开、拨成关各弹各的限定语，
 *   拨成关那一趟绝不许出现「已打开」那种把话说反的字样（必修 C）。这一节后来又补了三档（2026-10-12 复核
 *   第三、四轮）：同一趟挂载里（不卸载不重挂）页面重画一遍也要能自愈；慢宿主下同时在途的重推不超过一趟
 *   （在途去重），而且窗口里排队那一趟要自己发出去、拿到的 hostPushed 是它自己那趟的结果（复核者删掉
 *   settings-debug.js 的 next 格赋值就整档溜过）；拨动那趟回调里真抛错时 .catch 收场也要把界面放开，
 *   让人还能再拨、自愈照跑（复核者短路那行 setDbgPending(false) 同样整档溜过）。
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
const { compileFn, evalInWindow } = require('./lib/eval-probe.js')
// 第十九件事要真跑一遍设置页：在开了 runScripts 的 jsdom 窗口里跑打包产物、用真 React 挂载真组件，
//   与 tests/verify-log-switch-597.js 同一套手法（那一份是现成的样板，本门禁照抄它的桩形状）。
const { JSDOM } = require('jsdom')
const React = require('react')
const ReactDOMClient = require('react-dom/client')
// 防抖窗口是五百毫秒，这一份门禁里有十几处等它落地；接上虚拟时钟把等待压成几毫秒，断言一条没动
//   （为什么这么压是安全的见 tests/lib/time-compress.js 文件头）。
const { installTimeCompression } = require('./lib/time-compress.js')
const { countEffectiveLines } = require('../scripts/lib/effective-lines.mts')
installTimeCompression()

const ROOT = path.resolve(__dirname, '..')
let passed = 0
let failed = 0
const check = (ok: unknown, msg: string, detail?: unknown): void => {
  if (ok) { console.log('  PASS ' + msg); passed += 1 } else { console.log('  FAIL ' + msg + (detail ? ' —— ' + String(detail).slice(0, 300) : '')); failed += 1 }
}
const readText = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')
// 行数口径与 tests/verify-file-granularity.js 的 LIMIT=350 共用同一份实现（scripts/lib/effective-lines.mts）：
//   #1017 起两条门禁都按**有效行**算（注释与空行不计）。此前这里数的是总行数，同一条尺子两处两种算法，
//   一份文件多写几行注释就会两边给出不同的数；现在统一成有效行，注释随便写，只有真内容增长才算增长。
const countLines = (rel: string): number => countEffectiveLines(readText(rel))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const makeHome = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-dbg-' + tag + '-'))
const settingsPathIn = (home) => path.join(home, '.dsh', 'mattskillsdeck', 'settings.yaml')
const noExport = (s) => s.replace(/^\s*export\s+/gm, '')
// 中央时间真值：写那一片的防抖窗从中央引用，门禁求值时走全局预埋（值就是中央导出的同一份）。
const centralTime = require('../src/shared/time-config/values.js')
globalThis.VIEW_FLAG_WRITE_DEBOUNCE_MS = centralTime.VIEW_FLAG_WRITE_DEBOUNCE_MS
// 中央 import 在 compileFn 函数体里非法，求值前整行剥掉（闭包里它由时间片段提供）。
const stripTimeConfigImport = (s) => s.split('\n').filter((l) => !/^\s*import\s.*time-config\/values\.js/.test(l)).join('\n')

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
// 行数口径量真源（转成 TS 后产物经转译排版会胀行，胀的是机器排版不是手写；零增长守的是手写，量真源）。
const DEBUG_TRUTH_REL = 'src/client/kernel/settings-debug.ts'
const LOG_REL = 'src/client/kernel/log.js'
const INDEX_REL = 'src/client/index.js'
const TAIL = '\nreturn { LOG_DEBUG_KEY: LOG_DEBUG_KEY, logSwitch: logSwitch, logQueue: logQueue, readLocalDebugSwitch: readLocalDebugSwitch, persistLocalDebugSwitch: persistLocalDebugSwitch, setLogSwitch: setLogSwitch, reconcileLogSwitch: reconcileLogSwitch, settingsDebugLegacy: settingsDebugLegacy, settingsViewLoad: settingsViewLoad, viewFlagReadyNow: viewFlagReadyNow, viewFlagState: viewFlagState, VIEW_FLAG_WRITE_DEBOUNCE_MS: VIEW_FLAG_WRITE_DEBOUNCE_MS, settingsDebugSet: settingsDebugSet, settingsDebugToggle: settingsDebugToggle, settingsDebugAdoptFromDoc: settingsDebugAdoptFromDoc, settingsDebugDrainDeferred: settingsDebugDrainDeferred, settingsDebugSetInDoc: settingsDebugSetInDoc, settingsDebugLegacyWrite: settingsDebugLegacyWrite, settingsDebugHasPending: settingsDebugHasPending, setViewFlagRoot: setViewFlagRoot }'
function makeClient(env) {
  const body = [noExport(readText(DERIVED_REL)), noExport(readText(STATE_REL)), noExport(readText(VIEW_REL)), noExport(stripTimeConfigImport(readText(WRITE_REL))), noExport(readText(DEBUG_REL))].join('\n')
  const names = ['host', 'timer', 'localStorage', 'broadcastLogSwitch', 'keyOf', 'wsKeyOf', 'shared', 'stores', 'emit', 'currentOs', 'workspaceRootByCwd', 'dswsLogHash', 'SETTINGS_DEBUG_PUSH_WAIT_MS']
  return compileFn(names, body + TAIL).apply(null, names.map((n) => env[n]))
}
// 一份空文档（形状与核归一之后那一份逐字一致），debug 节按用例预置。
const dbgDoc = (debug) => ({ version: 1, ui: { stateFilter: '', sortKey: '', sortDir: '', labelClicks: {} }, workspaces: {}, debug: debug || { enabled: false, sampleRate: 1 }, templates: {} })

async function main(): Promise<void> {
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
    // #1125 起本门禁按目录约定自动进链，不再读 package.json 长串。
    check(require('../scripts/lib/discover-gates.ts').isGatePlanned(ROOT, 'tests/verify-settings-debug.ts'),
      'verify 规划名单里登记了这一份门禁（不登记会静默不跑）。')
    check(countLines(DEBUG_TRUTH_REL) <= 350 && countLines(LOG_REL) <= 350 && countLines(INDEX_REL) <= 350 && countLines(VIEW_REL) <= 350 && countLines(WRITE_REL) <= 350,
      '五份文件都在 350 行以内（本片量真源 ' + countLines(DEBUG_TRUTH_REL) + '、旧真源 log.js ' + countLines(LOG_REL) + '、index.js ' + countLines(INDEX_REL) + '、settings-view.js ' + countLines(VIEW_REL) + '、settings-view-write.js ' + countLines(WRITE_REL) + '）。')
  }

  // 真件：宿主的核与两条设置电话
  const leaf = await import(pathToFileURL(path.join(ROOT, 'src/host', 'settingsPhones.js')).href)
  const store = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'configStore.js')).href)
  // #1215：等宿主回话的时长住中央 YAML（settingsDebugPushWaitMs）。真源 settings-debug.ts 里它已是 declare
  //（运行时由构建拼进界面闭包），门禁单测那半（makeClient 当场拼片段 eval）没有闭包，只能在这里把中央生效值
  // 喂给它；第八段按毫秒数认定时器的地方也用这个名字，不再写死 5000，调 YAML 不用改门禁。
  const timeMod = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'time-config', 'values.js')).href)
  const CENTRAL_PUSH_WAIT_MS = timeMod.TIME_YAML['settingsDebugPushWaitMs']
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
      SETTINGS_DEBUG_PUSH_WAIT_MS: CENTRAL_PUSH_WAIT_MS,
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
  // 本地快照键（日志包 0.3.x 起开关落在这里；裸键 dsws.debug 只剩升级证据，见 settingsDebugLegacy）。
  const SNAPSHOT_KEY = 'dsws.debug.wf'
  const legacyOf = (env) => { const raw = env.ls.getItem(SNAPSHOT_KEY); try { return raw ? JSON.parse(raw) : null } catch (e) { return null } }
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
  // 光数「没发写电话」还不够：这一趟还可能在队列里留着一笔、或排期还挂着（排期一到就又发一趟）。所以再钉一句
  //   「定时器已停、三处待写都空」——三处是 journal、deferred 与 idle 档那本「还没定论」的簿子，
  //   判据用核自己导出的 settingsDebugHasPending()（2026-10-12 复核的顺带建议 ①；加上簿子是因为它也算待写）。
  // 诚实说明它量得到什么：它只证明「这一刻没留下待写」。要证明「造过一笔又撤干净了」，得由那一节自己先
  //   断言痕迹真的记下过（例如第十一 / 十二件事先查两笔 deferred 在不在），再回来查它空了 —— 单看这一行
  //   区分不了「撤掉了」与「压根没造过」（2026-10-12 复核第二轮指出的分辨力问题）。
  const checkNoPending = (env, msg) => {
    const st = env.mod.viewFlagState
    const left = Object.keys(st.journal).length + Object.keys(st.deferred).length
    check(st.timer === 0 && left === 0 && env.mod.settingsDebugHasPending() === false, msg,
      JSON.stringify({ timer: st.timer, journal: Object.keys(st.journal), deferred: Object.keys(st.deferred), hasPending: env.mod.settingsDebugHasPending() }))
  }

  // ── 第二件事：开机秒显读本地快照（同步、不等文件；裸旧键只当升级证据，进来那一刻搬进新键）──
  console.log('')
  console.log('== 第二件事：开机秒显读本地快照（同步、不等文件，本次不回归） ==')
  {
    const env = makeEnv({ tag: 'boot', localStorage: { 'dsws.debug': JSON.stringify({ enabled: true, sampleRate: 0.5, rev: 3 }) } })
    check(env.mod.logSwitch.enabled === true,
      '模块一加载就从本地读出了开（开机秒显不等设置文件）。', JSON.stringify(env.mod.logSwitch))
    check(env.mod.settingsDebugLegacy.seen === true && env.mod.settingsDebugLegacy.enabled === true && env.mod.settingsDebugLegacy.sampleRate === 0.5,
      '裸旧键里的选择被认成升级证据（开 + 采样率 0.5），给设置文件采纳用。', JSON.stringify(env.mod.settingsDebugLegacy))
    check(legacyOf(env) && legacyOf(env).enabled === true,
      '旧选择同时搬进了新键 dsws.debug.wf（包的新形状里没有采样率，快照只保开关）。', JSON.stringify(legacyOf(env)))
    check(env.mod.viewFlagState.status === 'idle', '此时设置文档还没开始问（秒显与文件无关）。', env.mod.viewFlagState.status)
    check(env.mod.LOG_DEBUG_KEY === 'dsws.debug', '旧键名仍是字面 dsws.debug（门禁钉着的硬约束）。', env.mod.LOG_DEBUG_KEY)
  }

  // ── 第三件事：文件说开 → 以文件为准（内存、旧键快照、广播、宿主副本、采样率都跟文件走）──
  console.log('')
  console.log('== 第三件事：文件里 debug.enabled 说开 → 以文件为准（快照那一份不顶它） ==')
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
    check(!!push && push.args.enabled === true && !('sampleRate' in (push.args || {})),
      '真源被推给宿主那份副本（enabled true；采样率的真源是文件，电话里不带死字段）。', JSON.stringify(push && push.args))
    check(legacyOf(env) && legacyOf(env).enabled === true, '快照键被写成开，当这一趟的秒显。', JSON.stringify(legacyOf(env)))
    await quietAfter(env)
    check(callsOf(env, 'wf.setSettings').length === 0, '文件里已经是这个值 → 不往文件里写多余的东西（一次 wf.setSettings 都没有）。', String(callsOf(env, 'wf.setSettings').length))
    checkNoPending(env, '这一趟也没留下待写与排期（定时器已停、队列为空）。')
  }

  // ── 第四件事：文件说关、升级证据说开 → 认开，并把开排队写回文件 ──
  console.log('')
  console.log('== 第四件事：文件说关、升级证据说开 → 认开，并把开排队写回文件（先立后破） ==')
  {
    const env = makeEnv({ tag: 'migrate', localStorage: { 'dsws.debug': JSON.stringify({ enabled: true, sampleRate: 0.5, rev: 4 }) } })
    await store.writeLocalSettings(dbgDoc({ enabled: false, sampleRate: 1 }), env.home, realIo)
    env.mod.settingsViewLoad()
    check(await ready(env), '读口就绪（文档到手，文件里说关）。')
    check(env.mod.logSwitch.enabled === true, '文件说关、升级证据说开 → 认开（升级前用户开着）。', String(env.mod.logSwitch.enabled))
    check(env.mod.logSwitch.sampleRate === 0.5, '采样率跟证据那一份走（升级证据里的 0.5，不是文件里归一后的默认 1）。', String(env.mod.logSwitch.sampleRate))
    const push = lastCall(env, 'wf.logSetSwitch')
    check(!!push && push.args.enabled === true, '宿主副本被推成开（副本要跟上真源）。', JSON.stringify(push && push.args))
    const landed = await waitFor(async () => { const d = await readDoc(env.home); return !!d && d.debug && d.debug.enabled === true })
    check(landed, '认下来的开排队写进了文件（读回来是 true）。', JSON.stringify((await readDoc(env.home)) || {}))
    const d2 = await readDoc(env.home)
    check(!!d2 && d2.debug.sampleRate === 0.5, '写回文件时采样率也是证据那一份的 0.5。', JSON.stringify(d2 && d2.debug))
  }

  // ── 第五件事：文件说关、旧键没见过、内存也是关 → 默认关，不写多余的东西 ──
  console.log('')
  console.log('== 第五件事：文件说关、升级证据没有、内存也是关 → 默认关，不往文件里写多余的东西 ==')
  {
    const env = makeEnv({ tag: 'noevidence' })
    await store.writeLocalSettings(dbgDoc({ enabled: false, sampleRate: 1 }), env.home, realIo)
    env.mod.settingsViewLoad()
    check(await ready(env), '读口就绪（文档到手，文件说关、旧键没有）。')
    check(env.mod.logSwitch.enabled === false, '没有任何证据说开 → 默认关。', String(env.mod.logSwitch.enabled))
    await quietAfter(env)
    check(callsOf(env, 'wf.setSettings').length === 0, '不往用户从没碰过的文件里添一笔默认值（没有 wf.setSettings）。', String(callsOf(env, 'wf.setSettings').length))
    checkNoPending(env, '默认关这一档也没留下待写与排期。')
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
    const legacyBefore = lsWrites(env, SNAPSHOT_KEY).length
    const res = await env.mod.settingsDebugToggle(true, 1)
    check(!!res && res.ok === true && res.enabled === true && res.sampleRate === 1,
      '宿主拒绝写副本，但真源已经落地 → 回 ok: true（不把用户这一下判成失败）。', JSON.stringify(res))
    check(env.mod.logSwitch.enabled === true, '内存当场改成开（不等落盘）。', String(env.mod.logSwitch.enabled))
    check(env.broadcasts.n > nBefore, '广播了一次（界面跟着重画）。', String(env.broadcasts.n))
    check(legacyOf(env) && legacyOf(env).enabled === true, '快照键写成开当秒显。', JSON.stringify(legacyOf(env)))
    const wrote = await waitWrite(env)
    check(wrote, '这一笔落进了设置文件（发生了 wf.setSettings）。', String(callsOf(env, 'wf.setSettings').length))
    const d = await readDoc(env.home)
    check(!!d && d.debug.enabled === true && d.debug.sampleRate === 1, '文件里的 debug 节是 {enabled: true, sampleRate: 1}。', JSON.stringify(d && d.debug))
    const push = lastCall(env, 'wf.logSetSwitch')
    check(!!push && push.args.enabled === true && !('sampleRate' in (push.args || {})), '宿主副本被推成同一个值（副本只是副本；采样率不走这趟电话）。', JSON.stringify(push && push.args))
    const fails = env.logged.filter((q) => q.event === 'host.call.fail' && q.fields && q.fields.method === 'wf.logSetSwitch')
    check(fails.length >= 1 && fails[fails.length - 1].fields.kind === 'set-switch-host-rejected',
      '宿主那一步失败记了一行 host.call.fail（method 与 kind 沿用包里的分档，不新增事件名）。', JSON.stringify(fails.length ? fails[fails.length - 1].fields : env.logged.map((q) => q.event)))
    check(lsWrites(env, SNAPSHOT_KEY).length === legacyBefore + 1, '快照键这一趟只多写一次（写文件成功，快照只当秒显用）。', String(lsWrites(env, SNAPSHOT_KEY).length - legacyBefore))
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
    await quietAfter(env)
    check(callsOf(env, 'wf.setSettings').length === 0, '接不下时一个字节都不往设置文件写。', String(callsOf(env, 'wf.setSettings').length))
    checkNoPending(env, '接不下这一档也没留下待写与排期（老路失败，什么都不许排）。')
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
    check(!!push && push.args.enabled === true && !('sampleRate' in (push.args || {})),
      '推给宿主副本的是文件里那一份开关（enabled true；采样率不走这趟电话）。', JSON.stringify(push && push.args))
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
    check(legacyOf(env) && legacyOf(env).enabled === false, '快照键也写成了关（开机秒显那一路跟着走）。', JSON.stringify(legacyOf(env)))
    // 这一档是「先造一笔、再撤干净」的那一种：上面刚查过两笔待写真的记下了，这里再查它们被「文档到手 → 落进
    //   文件」那一趟吃干净了。两句连起来才量得完整 —— 单看下面这一句区分不了「撤掉了」与「压根没造过」。
    await quietAfter(env)
    checkNoPending(env, '两笔待写被文档到手那一趟吃干净了（定时器已停、三处待写都空）。')

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
    // 与第十一件事同一口径：这一档也先查过两笔待写真的记下了，这里再查它们被吃干净了。
    await quietAfter(env)
    checkNoPending(env, '这两笔待写也被文档到手那一趟吃干净了（定时器已停、三处待写都空）。')
  }

  // ── 第十三件事：idle 档 + 文档始终问不到 → 这一下不许悄悄丢 ──
  console.log('')
  console.log('== 第十三件事：idle 档 + 文档始终问不到（getSettings 回失败）→ 老路接手、旧键留痕、文件不凭空建 ==')
  {
    const env = makeEnv({ tag: 'idle-nodoc', getFail: true })
    const res = await env.mod.settingsDebugToggle(true, 0.5)
    check(!!res && res.ok === true && res.enabled === true, '文档问不到，老路照样把这一下接下来了（回的是开）。', JSON.stringify(res))
    check(legacyOf(env) && legacyOf(env).enabled === true,
      '快照键里就是用户刚拨的那个值（这一下没有静默消失；快照只保开关，采样率以文件为准）。', JSON.stringify(legacyOf(env)))
    check(callsOf(env, 'wf.logSetSwitch').length >= 1, '宿主副本那条老电话收到了这一下。', String(callsOf(env, 'wf.logSetSwitch').length))
    check(env.logged.some((e) => e && e.event === 'host.call.fail' && e.fields && e.fields.method === 'wf.getSettings'),
      '文档问不到这件事有日志留痕（不静默），名字用的是既有的 host.call.fail。', JSON.stringify(env.logged.map((e) => e && e.event)))
    check(await waitFor(async () => env.mod.viewFlagState.status === 'unavailable'), '文档这条口子收在「问不到」那一档（不是一直挂着）。', env.mod.viewFlagState.status)
    const dNone = await readDoc(env.home)
    check(dNone === null, '没有凭空造出一份设置文件（问不到文档就不写文件）。', JSON.stringify(dNone))
    check(lsWrites(env, SNAPSHOT_KEY).length >= 1, '快照键被写过（老路成功那一趟的快照，加上这一手兜底口子）。', String(lsWrites(env, SNAPSHOT_KEY).length))
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
    checkNoPending(env, '空壳这一档也没留下待写与排期。')
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
    // 「只发一趟」也要等防抖窗口走完再数（2026-10-12 复核的顺带建议 ②）：窗口没过时「补的那一趟」还没排上，
    //   数出来永远是 1，那条断言就成了结构上不可能失败的断言。判据仍是上面「第一趟发出去的那份文档」。
    await quietAfter(env3)
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
    checkNoPending(env4, '半份文档这一档也没留下待写与排期。')
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
    checkNoPending(env, '只读这一档也没留下待写与排期（老路成功时只补旧键快照）。')
    check(fs.readFileSync(settingsPathIn(home), 'utf8') === rawBefore, '文件逐字节没变（只读这一档不许动它）。')
  }

  // ── 第十六件事：快照键只在文件这条路接不下时才兜底写 ──
  console.log('')
  console.log('== 第十六件事：快照键只在文件这条路接不下时才兜底写（接得下时不乱写） ==')
  {
    const env = makeEnv({ tag: 'legacy-nofile', getFail: true, logSetRefuse: true })
    env.mod.settingsViewLoad()
    await ready(env)
    const legacyBefore = lsWrites(env, SNAPSHOT_KEY).length
    await env.mod.settingsDebugToggle(true, 1)
    check(callsOf(env, 'wf.logSetSwitch').length >= 1 && lsWrites(env, SNAPSHOT_KEY).length === legacyBefore,
      '老路失败这一档这一次拨动没有再写快照键（包里的老路只在成功时才写快照）。', String(lsWrites(env, SNAPSHOT_KEY).length - legacyBefore))
    const env2 = makeEnv({ tag: 'legacy-docgone', getFail: true, logSetRefuse: true })
    await store.writeLocalSettings(dbgDoc({ enabled: false, sampleRate: 1 }), env2.home, realIo)
    env2.mod.settingsViewLoad()
    await ready(env2)
    env2.mod.settingsViewLoad()
    const took = env2.mod.settingsDebugLegacyWrite()
    check(took === true && legacyOf(env2) && legacyOf(env2).enabled === false,
      '这一手兜底口子写得进快照键，写的是内存那一份（此处内存是关）。', JSON.stringify(legacyOf(env2)))
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
    // 真源转成 TypeScript 后这一片经 esbuild 转译进产物，转译把字符串统一成双引号（手写时是单引）：
    // 字面量正则两种引号都认 —— 认的是「写死」不是「单引」，走变量照样在这里露出来。
    const re = /(?:^|[^A-Za-z0-9_$.])log\s*\(\s*(['"])([^'"]+)\1\s*,\s*(['"])([^'"]+)\3/g
    const calls: Array<string> = []
    let m: RegExpExecArray | null
    while ((m = re.exec(slice)) !== null) calls.push(m[4])
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
  console.log('== 第十八件事：宿主副本没跟上 → 回包带 hostPushed、界面按方向换限定语文案、下一次打开设置页自动重推 ==')
  {
    // 一、副本拒绝：文件这条路接得下，真源照样算成功，但回包要把副本状态带出来；下一次文档到手要自己重推一次。
    const env = makeEnv({ tag: 'hostpushed-no', logSetRefuse: true })
    await store.writeLocalSettings(dbgDoc({ enabled: false, sampleRate: 1 }), env.home, realIo)
    env.mod.settingsViewLoad()
    check(await ready(env), '文档到手。')
    const res = await env.mod.settingsDebugToggle(true, 1)
    check(!!res && res.ok === true && res.hostPushed === false,
      '副本被拒 → 真源照样算成功，但回包把副本状态带出来（hostPushed: false）。', JSON.stringify(res))
    // 自愈那一步的真触发路径在第十九件事里真跑一遍设置页来量（2026-10-12 复核的必修 B：直接调内部函数
    //   只能证明那个函数还在，证明不了产品里那一趟真的会走到它 —— adopt 一个会话只跑一次，这条路上的
    //   重推在产品里到不了）。这里先钉一句静态的：设置页挂载那一趟确实留了口子。
    //   重推口子搬家（调试分组收进 views/diagnosticLog/DiagnosticLogSection.ts）：口子还在设置页的渲染树里
    //   （设置页挂载分组，分组挂载那一趟跑口子），静态检查跟到新家，意图不变。
    const pageStillMountsSection = readText('src/client/views/SettingsPage.js')
    check(pageStillMountsSection.indexOf('DiagnosticLogSection') >= 0,
      '设置页还挂着调试分组（分组搬走后页面只剩一行挂载，挂载丢了口子就到不了）。', String(pageStillMountsSection.indexOf('DiagnosticLogSection')))
    const pageRetry = readText('src/client/views/diagnosticLog/DiagnosticLogSection.ts')
    check(pageRetry.indexOf('settingsDebugRetryHost') >= 0 && pageRetry.indexOf('React.useEffect') >= 0,
      '调试分组在挂载那一趟留了重推口子（settingsDebugRetryHost 在 useEffect 里被调用）。', String(pageRetry.indexOf('settingsDebugRetryHost')))
    // 二、副本接受：回包 hostPushed: true（界面照旧弹那句不带限定语的）。
    const env2 = makeEnv({ tag: 'hostpushed-yes' })
    await store.writeLocalSettings(dbgDoc({ enabled: false, sampleRate: 1 }), env2.home, realIo)
    env2.mod.settingsViewLoad()
    check(await ready(env2), '文档到手。')
    const res2 = await env2.mod.settingsDebugToggle(true, 1)
    check(!!res2 && res2.ok === true && res2.hostPushed === true, '副本接上了 → 回包 hostPushed: true。', JSON.stringify(res2))
    // 三、界面：副本没跟上时不弹没限定语的「已开启」，而且两个方向各有一句（拨成开说「文件已写、副本没接上」，
    //   拨成关说「文件已写、副本还开着，调试行还在记」）—— 拿同一句套两个方向，总有一边把话说反。这句话中文
    //   与英文两份词表里都得有（界面文案一律走词表，不许写字面量）。
    //   选句搬家（原来设置页里那条嵌套三元收进 views/diagnosticLog/diagnosticLogModel.ts 的 switchToastKey）：
    //   静态检查跟到新家，三个要素一个不少（看 hostPushed、开方向一句、关方向一句）。
    const page = readText('src/client/views/diagnosticLog/diagnosticLogModel.ts')
    check(page.indexOf('hostPushed') >= 0 && page.indexOf("'cfg.dbgSwitchOnNoHost'") >= 0 && page.indexOf("'cfg.dbgSwitchOffNoHost'") >= 0,
      '诊断日志模型按 hostPushed 与方向换文案：副本没跟上时拨成开、拨成关各一句，都不弹没限定语的那句。',
      JSON.stringify({ hostPushed: page.indexOf('hostPushed'), on: page.indexOf('cfg.dbgSwitchOnNoHost'), off: page.indexOf('cfg.dbgSwitchOffNoHost') }))
    const localeSrc = readText('src/client/kernel/locale-flow.js')
    const localeOf = (key) => localeSrc.split(/\r?\n/).filter((l) => l.indexOf("'" + key + "'") >= 0)
    const zhOn = localeOf('cfg.dbgSwitchOnNoHost').find((l) => l.indexOf('调试日志已打开') >= 0) || ''
    const enOn = localeOf('cfg.dbgSwitchOnNoHost').find((l) => l.indexOf('Debug log on') >= 0) || ''
    const zhOff = localeOf('cfg.dbgSwitchOffNoHost').find((l) => l.indexOf('调试日志已关') >= 0) || ''
    const enOff = localeOf('cfg.dbgSwitchOffNoHost').find((l) => l.indexOf('Debug log off') >= 0) || ''
    check(zhOn.length > 0 && enOn.length > 0 && zhOn !== enOn,
      '拨成开那句限定语在中文与英文两份词表里都有，而且各自写成本国语言（不是同一句抄两遍）。', JSON.stringify([zhOn.length, enOn.length]))
    check(zhOff.length > 0 && enOff.length > 0 && zhOff !== enOff,
      '拨成关那句限定语同样中英各一份。', JSON.stringify([zhOff.length, enOff.length]))
  }

  // ── 第十九件事：真产物里真跑一遍设置页（jsdom + 真 React）──
  //   为什么要真跑（2026-10-12 复核的必修 A / B / C）：前面那些分节量的是内核函数，量不到「用户点一下之后
  //   界面到底走了哪条路、弹的是哪句话」。这一节用 tests/verify-log-switch-597.js 那套手法把打包产物在
  //   jsdom 里跑起来、用真 React 挂载设置页，按用户的样子点复选框，只读页面上真正显示出来的东西。
  //   三件事都在这里量：① 老路慢、文档先到手那一趟不许把用户的关顶回开（必修 A）；② 副本没跟上之后，
  //   下一次打开设置页那一趟（真挂载）要自己把副本重推一次（必修 B）；③ 两个方向的文案各说各话（必修 C）。
  //   第四段是 2026-10-12 复核第二轮加的：同一趟挂载里（不卸载、不重挂）页面自己重画一遍也要能自愈 ——
  //   宿主那侧「打开一次是不是一直挂着」不在本仓、核不了，口子不能只赌重新挂载那一趟。
  console.log('')
  console.log('== 第十九件事：真产物里真跑设置页（jsdom）——老路与文档赛跑、下一次打开自己重推、同挂载也能自愈、两个方向各说各话、排队那趟的语义、失败后还能再用 ==')
  {
    const bundleCode = readText('package/lib/client.js')
    // 五节齐全的一份真文档（核归一之后就是这个形状）；enabled 是这一张页面文件里的那个值。
    const fullDocOf = (enabled) => ({ version: 1, ui: { stateFilter: '', sortKey: '', sortDir: '', labelClicks: {} }, workspaces: {}, debug: { enabled: enabled, sampleRate: 1 }, templates: {} })
    // 一张干净的页面：真产物 + 真 React + 假宿主。桩的信封与产品一致（scripts/build.mjs:297-307 的 __rpcCall
    //   会替 host.call 拆一层），所以这里回的是「载体那一层」：getSettings 回 {ok,value:{ok,value:文档}}。
    //   logSetSwitch 按 setReply 走：第一拨（走包里的老路）要它收下，第二拨（走文件这条路）要它拒收。
    const openPage = async (opts) => {
      const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://127.0.0.1:59519/', runScripts: 'dangerously' })
      const { window } = dom
      for (const [k, v] of Object.entries({
        window, document: window.document, navigator: window.navigator, Node: window.Node,
        HTMLElement: window.HTMLElement, getComputedStyle: window.getComputedStyle,
        requestAnimationFrame: window.requestAnimationFrame || ((cb) => setTimeout(cb, 0)),
        cancelAnimationFrame: window.cancelAnimationFrame || clearTimeout,
      })) { try { global[k] = v } catch (e) {} }
      if (typeof window.ResizeObserver === 'undefined') window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
      global.ResizeObserver = window.ResizeObserver
      if (!window.document.fonts) window.document.fonts = { ready: Promise.resolve() }
      window.React = React; window.ReactDOM = ReactDOMClient; global.React = React; global.ReactDOM = ReactDOMClient
      if (opts.legacyOn) { try { window.localStorage.setItem('dsws.debug', JSON.stringify({ enabled: true, sampleRate: 1 })) } catch (e) {} }
      const dict = {}
      // 让「取词表」这一步抛一次错（2026-10-12 复核第四轮 M5 那一档要用）：设置页收场那条链里唯一能真抛错的地方，
      //   就是成功回调里取那颗文案那一步 —— 这一抛才是「拨动那一趟真的出了岔子」，界面只能走 .catch 那条分支收场。
      //   命中一次就自动撤掉：.catch 里还要再取一次词表（失败那句），再抛就成没人接的 Promise，会把门禁自己带崩。
      let trThrowKeys = null
      let trThrew = 0
      const trFn = (key, params) => {
        if (trThrowKeys && trThrowKeys.indexOf(key) >= 0) { trThrowKeys = null; trThrew += 1; throw new Error('locale-throw:' + key) }
        let s = dict[key] !== undefined ? dict[key] : key
        if (params) s = s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
        return s
      }
      const logSet = []
      const setCalls = []
      const endpoints = []
      const logSends = []
      let setReply = opts.setReply
      let setDelayMs = opts.setDelayMs || 0
      const hostReply = (endpoint, args) => {
        endpoints.push(endpoint)
        if (endpoint === 'logBatch') { try { logSends.push(JSON.stringify(args).slice(0, 400)) } catch (e) {} return { ok: true, value: { ok: true, accepted: 1 } } }
        if (endpoint === 'getSettings') return { ok: true, value: { ok: true, value: fullDocOf(opts.docEnabled) } }
        // 只留一份能安全打印的摘要（真文档里带 getter 之类时 JSON.stringify 整份会抛，门禁不该踩这个坑）。
        if (endpoint === 'setSettings') { setCalls.push({ keys: Object.keys(args || {}), valueKeys: (args && args.value) ? Object.keys(args.value) : null, dbg: (args && args.value && args.value.debug) ? JSON.parse(JSON.stringify(args.value.debug)) : null }); return { ok: true, value: { ok: true } } }
        if (endpoint === 'logGetSwitch') return { ok: true, value: { ok: true, enabled: opts.docEnabled === true, sampleRate: 1 } }
        if (endpoint === 'logSetSwitch') { logSet.push(args); return setReply(args) }
        return { ok: true, value: { ok: true } }
      }
      // 宿主回话慢的那一档：先把电话记下来（＝宿主收到了），再等一段时间才回（虚拟时钟里这一步是确定的，
      //   与 tests/lib/time-compress.js 的虚拟时钟一起用，「文档在这中间到手」这件事可复现）。
      // 同时在途几趟要数出来（在途去重那条断言用）：inFlight 在回话之前一直挂着，maxInFlight 记峰值。
      let inFlight = 0
      let maxInFlight = 0
      let sampleAtHostCall = null
      const callHost = async (endpoint, args) => {
        if (endpoint !== 'logSetSwitch') return hostReply(endpoint, args)
        logSet.push(args)
        // 电话到宿主手里的那一刻给测试一个采样点：第六段用它分辨「这一趟是在这一拨收场之前发出去的、还是收场之后
        //   由自愈补推的」—— 两者带着同样的值，只有发出时刻不同。
        if (sampleAtHostCall) { try { sampleAtHostCall(args) } catch (eS) {} }
        const reply = setReply(args)
        inFlight += 1
        if (inFlight > maxInFlight) maxInFlight = inFlight
        if (setDelayMs > 0) await sleep(setDelayMs)
        inFlight -= 1
        return reply
      }
      let settingsComp = null
      const services = {
        slots: { register: (meta, comp) => { if (meta && meta.name === 'settings.plugins.tab') settingsComp = comp; return () => {} }, inject: (n, fn) => { try { fn() } catch (e) {} } },
        locale: { register: (ns, d) => { Object.assign(dict, d.zh || {}, d.en || {}); return () => {} }, bind: () => trFn },
        workspaces: { list: async () => [] },
        sessions: { list: async () => [] },
        // 计时器：只压两处 —— 看门狗那 5 秒压成 600 毫秒（虚拟时钟里仍比 300 毫秒慢的宿主晚，顺序不变）、
        //   防抖那 500 毫秒压成 20 毫秒。其余延时照常：提示条自己那条 2800 毫秒的退场计时器必须留着原值，
        //   压了它提示条会在读到之前就没了（本门禁第一版就踩过这一脚）。
        timer: { timeout: (fn, ms) => setTimeout(fn, ms >= 5000 ? 600 : (ms === 500 ? 20 : ms)) },
      }
      services.connection = {
        rpc: {
          call: async (channel, carrier, call) => callHost(String((call && call.method) || '').replace(/^wf\./, ''), call ? call.payload : undefined),
        },
      }
      const ctx = { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} } }
      let loaded = null
      window.__ModuleLoader__ = { load(spec) { loaded = spec; return spec } }
      const realError = console.error
      const realWarn = console.warn
      console.error = () => {}
      console.warn = () => {}
      try {
        evalInWindow(dom, bundleCode)
        const mod = loaded.factory((m) => {
          if (m === 'react') return React
          if (m === 'react-dom') return ReactDOMClient
          throw new Error('unexpected require: ' + m)
        })
        try { mod.apply(ctx) } catch (e) { /* 深层依赖没 stub 全，不影响本场景 */ }
      } finally {
        console.error = realError
        console.warn = realWarn
      }
      // 挂载一趟（＝用户打开一次设置页）。宿主每次打开都重新挂载这一页，所以这一趟就是「下一次机会」。
      const mount = async () => {
        const container = window.document.createElement('div')
        window.document.body.appendChild(container)
        const root = ReactDOMClient.createRoot(container)
        const realE = console.error
        const realW = console.warn
        console.error = () => {}
        console.warn = () => {}
        try {
          await React.act(async () => {
            root.render(React.createElement(settingsComp, { sessionId: 'sid-19' }))
            await new Promise((r) => setTimeout(r, 60))
          })
        } finally {
          console.error = realE
          console.warn = realW
        }
        return { container, root }
      }
      const boxOf = (container) => {
        for (const lab of Array.from(container.querySelectorAll('label'))) {
          if (/调试日志|Debug log/i.test(lab.textContent || '')) { const b = lab.querySelector('input[type=checkbox]'); if (b) return b }
        }
        return null
      }
      const toastOf = (container) => {
        const m = container.innerHTML.match(/dsws-note[^>]*>(.*?)<\/div>/i)
        return m ? m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : ''
      }
      const click = async (container) => {
        const box = boxOf(container)
        // 2026-10-12 复核第四轮建议 3：禁用中的复选框照样能 click()，所以「还在就 return true」会让「这一拨点得动」
        //   这一族断言在页面卡死时照样变绿（实测：把失败分支那句 setDbgPending(false) 短路之后页面永远禁用，
        //   以旧写法写的断言仍然全绿）。按 disabled 判，这一族才算真的量到东西。
        if (!box || box.disabled) return false
        const realE = console.error
        const realW = console.warn
        console.error = () => {}
        console.warn = () => {}
        try {
          await React.act(async () => {
            box.click()
            await new Promise((r) => setTimeout(r, 120))
          })
        } finally {
          console.error = realE
          console.warn = realW
        }
        return true
      }
      // 本页自己那一格反馈（点完 600 毫秒后自己清掉，所以要紧接着读）：它出现就说明点开关那一趟的 .then 跑到了，
      //   与共享提示（dsws-note）是同一个回调里设的 —— 用来区分「提示早被清掉」与「回调压根没跑」。
      const flashOf = (container) => {
        const html = container.innerHTML
        if (html.indexOf('dsws-fb-warnflash') >= 0) return 'warn'
        if (html.indexOf('dsws-fb-okflash') >= 0) return 'ok'
        return ''
      }
      // 提示在页面上只留 600 毫秒（SettingsPage 里那个 setTimeout），所以点完要紧接着轮询着读，别等太久。
      const waitToast = async (container, capMs) => {
        const cap = capMs || 400
        let t = ''
        for (let i = 0; i < Math.ceil(cap / 20) && !t; i++) { await sleep(20); t = toastOf(container) }
        return t
      }
      return {
        window, dict, logSet, setCalls, endpoints, logSends, mount, click, toastOf, waitToast, flashOf, boxOf,
        setReply: (f) => { setReply = f },
        setDelay: (ms) => { setDelayMs = ms },
        throwTrOn: (keys) => { trThrowKeys = keys },
        trThrew: () => trThrew,
        setHostCallSample: (fn) => { sampleAtHostCall = fn },
        resetInFlight: () => { inFlight = 0; maxInFlight = 0 },
        maxInFlight: () => maxInFlight,
      }
    }
    // 一、老路慢、文档先到手那一趟（必修 A 的决定性用例）：页面打开时文档还没问过（status 是 idle），
    //   这一拨先走包里的老路（宿主 300 毫秒才回），文档在这中间到手 —— 采纳那一趟必须因为「簿子上有痕迹」
    //   而让开，不许照文件里的 true 把用户刚拨的关顶回去。老毛病实测（D:\Temp\rev-probe\q3-race-both.js）：
    //   宿主依次收到 enabled=[false,true]，最终副本是 true（用户想要 false），文件里也还是 true。
    {
      const p = await openPage({
        docEnabled: true, legacyOn: true, setDelayMs: 300,
        setReply: (args) => ({ ok: true, value: { ok: true, enabled: args.enabled === true, sampleRate: 1 } }),
      })
      const a = await p.mount()
      const box0 = p.boxOf(a.container)
      check(!!box0 && box0.checked === true, '这一张页面开局是开（文件与旧键都说开）。', String(!!box0 && box0.checked))
      check(await p.click(a.container), '拨成关（走包里的老路，宿主 300 毫秒后才回）点得动。')
      await sleep(700)
      check(p.setCalls.length >= 1, '这一拨还是排进了设置文件（簿子上的痕迹让采纳那一趟让开，用户这一下没丢）。', String(p.setCalls.length))
      const dbgSends = p.setCalls.map((c) => c.dbg).filter(Boolean)
      check(dbgSends.length >= 1 && dbgSends[dbgSends.length - 1].enabled === false, '写进文件的是用户拨的关（不是文件里原来的 true）。', JSON.stringify(dbgSends))
      const lastPush = p.logSet[p.logSet.length - 1]
      check(!!lastPush && lastPush.enabled === false, '宿主副本最后收到的值跟用户这一下一致（没有把用户的关顶回开）。', JSON.stringify(p.logSet))
      try { a.root.unmount() } catch (e) {}
    }
    // 二、副本没跟上（必修 B + C 的拨成关方向）：第一拨拨成开（走老路，宿主收下，文档被问起来），
    //   文档到手后再拨成关 —— 这一趟走文件这条路、副本拒收：界面必须说「已关、副本还开着」，不许出现
    //   「已打开」；卸掉页面重新挂一次（＝下一次打开设置页），自愈口子要把内存这一份重推给副本。
    {
      const p = await openPage({
        docEnabled: false,
        setReply: (args) => ({ ok: true, value: { ok: true, enabled: args.enabled === true, sampleRate: 1 } }),
      })
      const a = await p.mount()
      const boxA = p.boxOf(a.container)
      check(!!boxA && boxA.checked === false, '这一张页面开局是关。', String(!!boxA && boxA.checked))
      check(await p.click(a.container), '第一拨（拨成开，走老路）点得动。')
      check(p.logSet.length >= 1 && p.logSet[0].enabled === true, '第一拨走了老路，宿主收到开。', JSON.stringify(p.logSet[0]))
      await sleep(200)
      p.setReply(() => ({ ok: true, value: { ok: false } }))
      check(await p.click(a.container), '第二拨（拨成关，走文件这条路）点得动。')
      check(p.setCalls.length >= 1, '第二拨把整份文档交给宿主（wf.setSettings 收到了）。', String(p.setCalls.length))
      const offToast = await p.waitToast(a.container)
      check(offToast === p.dict['cfg.dbgSwitchOffNoHost'],
        '副本拒收时弹的是「已关…副本还开着」那一句（拨成关这一方向）。',
        JSON.stringify({ toast: offToast, flash: p.flashOf(a.container), want: p.dict['cfg.dbgSwitchOffNoHost'], setCalls: p.setCalls.length, endpoints: p.endpoints.length, logs: p.logSends.slice(-2) }))
      check(offToast.indexOf('已打开') < 0 && !/Debug log on/i.test(offToast),
        '拨成关这一趟不许出现「已打开」那种把话说反的字样。', offToast)
      const pushesBefore = p.logSet.length
      try { a.root.unmount() } catch (e) {}
      p.setReply((args) => ({ ok: true, value: { ok: true, enabled: args.enabled === true, sampleRate: 1 } }))
      const b = await p.mount()
      // 同一口径：等「重挂那一趟自己重推」这件事发生，不睡固定小段（忙的时候固定小睡会假红）。
      const capRe = Date.now() + 3000
      while (p.logSet.length <= pushesBefore && Date.now() < capRe) await sleep(25)
      check(p.logSet.length > pushesBefore,
        '重新打开设置页那一趟（真挂载）自己把副本重推了一次（自愈不靠内部函数）。', String(p.logSet.length - pushesBefore))
      const repush = p.logSet[p.logSet.length - 1]
      check(!!repush && repush.enabled === false, '重推的是内存里这一份真值（用户刚拨成的关）。', JSON.stringify(repush))
      const boxB = p.boxOf(b.container)
      check(!!boxB && boxB.checked === false, '重新打开这一趟开关停在关（这一份真值在界面上没被翻回去）。', String(!!boxB && boxB.checked))
      try { b.root.unmount() } catch (e) {}
    }
    // 三、副本没跟上、拨成开这一方向（必修 C 的另一半）：文档说关、第一拨拨成开走老路，文档到手后再拨一次
    //   （走文件这条路、副本拒收）→ 界面必须说「已打开、文件已写、副本没接上」那一句。
    {
      const p = await openPage({
        docEnabled: false,
        setReply: (args) => ({ ok: true, value: { ok: true, enabled: args.enabled === true, sampleRate: 1 } }),
      })
      const a = await p.mount()
      check(await p.click(a.container), '第一拨（拨成开，走老路）点得动。')
      await sleep(200)
      // 拨成开之后要再拨一次开没有意义，所以先拨回关（这一趟走文件这条路，副本收下），再拒收后拨成开。
      p.setReply((args) => ({ ok: true, value: { ok: true, enabled: args.enabled === true, sampleRate: 1 } }))
      check(await p.click(a.container), '中间那一拨（拨回关，走文件这条路）点得动。')
      await sleep(150)
      p.setReply(() => ({ ok: true, value: { ok: false } }))
      check(await p.click(a.container), '最后一拨（拨成开，走文件这条路、副本拒收）点得动。')
      const onToast = await p.waitToast(a.container)
      check(onToast === p.dict['cfg.dbgSwitchOnNoHost'],
        '副本拒收时弹的是「已打开…副本没接上」那一句（拨成开这一方向）。',
        JSON.stringify({ toast: onToast, flash: p.flashOf(a.container), want: p.dict['cfg.dbgSwitchOnNoHost'], setCalls: p.setCalls.length, endpoints: p.endpoints.length, logs: p.logSends.slice(-2) }))
      try { a.root.unmount() } catch (e) {}
    }
    // 四、同一趟挂载里也要能自愈（2026-10-12 复核第二轮）：宿主那侧「设置分组打开一次之后是不是一直挂着」不在
    //   本仓、核不了，所以自愈口子不能只赌「重新挂载」那一趟 —— 口子挂在每次渲染上，页面自己重画一遍就够。
    //   这一档既不卸载也不重挂：拨动失败之后，提示条更新会把这一页重新画一遍，口子就在那一趟把副本重推一次。
    {
      const p = await openPage({
        docEnabled: false,
        setReply: (args) => ({ ok: true, value: { ok: true, enabled: args.enabled === true, sampleRate: 1 } }),
      })
      const a = await p.mount()
      check(await p.click(a.container), '第一拨（拨成开，走老路）点得动。')
      await sleep(200)
      p.setReply(() => ({ ok: true, value: { ok: false } }))
      check(await p.click(a.container), '第二拨（拨成关，走文件这条路、副本拒收）点得动。')
      const offToast2 = await p.waitToast(a.container)
      check(offToast2 === p.dict['cfg.dbgSwitchOffNoHost'], '副本拒收时照旧弹「已关…副本还开着」那一句。', JSON.stringify({ toast: offToast2 }))
      const pushesAtToast = p.logSet.length
      // 这里必须轮询而不是睡固定一小段：重推要等「提示条更新 → 页面重画 → 口子跑」这条链，机器忙的时候
      //   固定小睡会假红（2026-10-12 实测到过一次 170 通过 1 失败的不可复现红，之后把这一档改成轮询）。
      //   轮询不放松判据：等的是「不卸载、不重挂也自己重推一次」这件事真的发生，最多等 3 秒。
      const capPush = Date.now() + 3000
      while (p.logSet.length <= pushesAtToast && Date.now() < capPush) await sleep(25)
      check(p.logSet.length > pushesAtToast,
        '同一趟挂载里（不卸载、不重挂）页面自己重画一遍就把副本重推了一次。', String(p.logSet.length - pushesAtToast))
      const sameMountPush = p.logSet[p.logSet.length - 1]
      check(!!sameMountPush && sameMountPush.enabled === false,
        '同挂载里重推的还是用户拨的那个值（内存里那一份真值）。', JSON.stringify(p.logSet.slice(-2)))
      // 「不会自续」这条要静置一个固定窗口再数（2026-10-12 复核第三轮建议 2）：轮询到第一趟就退出紧接着数，
      //   会把「慢速自续」整档放过 —— 复核者的 M2b（每 150 毫秒多画一帧、十来趟）当时跑完仍是 171 条全绿。
      //   所以这里先记下第一趟那一刻的数量，再等满 1 秒，看这 1 秒里又冒了几趟。
      const pushesAtFirst = p.logSet.length
      await sleep(1000)
      const extraPushes = p.logSet.length - pushesAtFirst
      check(extraPushes <= 2,
        '静置一秒也不自续：这一秒里最多再推两趟（慢速自续那种十来趟会在这里露出来）。', String(extraPushes))
      const boxC = p.boxOf(a.container)
      check(!!boxC && boxC.checked === false, '同一趟挂载里开关也停在用户拨的那个值上。', String(!!boxC && boxC.checked))
      try { a.root.unmount() } catch (e) {}
    }
    // 五、慢宿主下同时在途的重推不超过一趟（2026-10-12 复核第三轮建议 1 的收口）：宿主回话 400 毫秒，这一页
    //   每次重画都会让自愈口子再推一次 —— 没有在途去重时，复核实测同时在途堆到 7 趟、还带着新旧不同的值，
    //   谁先到全看回话顺序。这一档只量「同时在途的趟数」：先让页面进入文件这条路，再连拨几下把渲染逼起来。
    {
      const p = await openPage({
        docEnabled: false,
        setReply: (args) => ({ ok: true, value: { ok: true, enabled: args.enabled === true, sampleRate: 1 } }),
      })
      const a = await p.mount()
      check(await p.click(a.container), '第一拨（拨成开，走老路）点得动。')
      await sleep(200)
      // 从这里开始量：副本拒收 + 回话放慢到 400 毫秒，之后的每一趟推都是文件这条路或自愈口子发出来的。
      p.setReply(() => ({ ok: true, value: { ok: false } }))
      p.setDelay(400)
      p.resetInFlight()
      check(await p.click(a.container), '第二拨（拨成关，走文件这条路、副本拒收）点得动。')
      await sleep(700)
      check(await p.click(a.container), '第三拨点得动（这一下与上一趟的余波叠在一起）。')
      await sleep(700)
      check(await p.click(a.container), '第四拨点得动。')
      await sleep(1600)
      check(p.maxInFlight() === 1,
        '慢宿主下同时在途的重推始终只有一趟（在途去重：留最后一趟）。', JSON.stringify({ max: p.maxInFlight(), pushes: p.logSet.length }))
      check(p.logSet.length >= 3,
        '这一段确实推了不止一趟（不然上一条是空过的）。', String(p.logSet.length))
      const lastInFlight = p.logSet[p.logSet.length - 1]
      check(!!lastInFlight && lastInFlight.enabled === false,
        '最后推上去的是用户最后拨的那个值（留的是最后一趟）。', JSON.stringify(p.logSet.slice(-3)))
      try { a.root.unmount() } catch (e) {}
    }
    // 六、排队那一趟的语义要量死（2026-10-12 复核第四轮 M1）：在途去重把「窗口里那第二下」记进 next 格，那一趟要
    //   自己发出去，而且拨动那条路拿到的 hostPushed 必须是它自己那一趟的结果。复核者只把 settings-debug.js:146
    //   那句 `settingsDebugPushNext = want` 删掉，178 条全绿就放过了 —— 那一格的语义此前没有一条断言看着。
    //   一张设置页里做不出「窗口里再拨一下」：拨动一开始复选框就被 dbgPending 禁用了，第二下点不动（本轮实测，
    //   第一版就是这么写的、当场红了三条）。能复现的是「两扇窗口同时开着这一页」：A 页那一趟在飞，B 页自己的
    //   pending 还是空的，于是 B 这一拨只能排队 —— 用户在两个窗口里连着拨就是这件事。
    //   两页读的是同一份共享提示，所以第一拨故意让它失败：留在提示里的是失败那句话，不会跟 B 页要读的那句撞车
    //   （第一版让第一拨成功，提示里留着同一句「已打开」，B 页那条断言就成了空过的）。
    {
      // 宿主一律拒收「开」、收下「关」：A 页那两拨（第一拨走老路、第二拨走文件这条路）都轮不到收下，B 页排队的
      //   那一拨（关）会被收下 —— 「排队那趟拿的是自己那趟的结果」才有对照。
      const p = await openPage({
        docEnabled: false,
        setReply: (args) => (args.enabled === true
          ? { ok: true, value: { ok: false } }
          : { ok: true, value: { ok: true, enabled: false, sampleRate: 1 } }),
      })
      const a = await p.mount()
      check(await p.click(a.container), 'A 页第一拨（拨成开，走老路、副本拒收）点得动（这一拨只为把文档问起来）。')
      await sleep(300)
      const beforeQueued = p.logSet.length
      // 宿主回话拖到 800 毫秒：A 页那一趟（开、要被拒）在飞，B 页这一拨才排得进窗口。
      p.setDelay(800)
      check(await p.click(a.container), 'A 页第二拨（拨成开，走文件这条路）点得动（这一趟要在飞 800 毫秒）。')
      // B 页在窗口中间打开：它开局读到的是内存里刚落的开，所以它这一拨是拨成关。
      const b = await p.mount()
      const boxB0 = p.boxOf(b.container)
      check(!!boxB0 && boxB0.checked === true, 'B 页在窗口中间打开，开局是开（读到内存里刚落的开）。', String(!!boxB0 && boxB0.checked))
      // 电话到的那一刻采一笔「B 页复选框现在禁用不禁用」：收场之前它禁用着；收场之后（自愈补推那一趟）已经放开。
      //   同值不同时刻，就靠这一笔分开。
      p.setHostCallSample((rec) => { const bb = p.boxOf(b.container); rec.duringPending = !!(bb && bb.disabled) })
      check(await p.click(b.container), 'B 页紧跟着拨成关（这一拨只能排队）。')
      // 虚拟时钟靠这些 sleep 往前走：等 A 页那趟落地、排队那趟发出去，一共两趟。
      for (let i = 0; i < 90 && p.logSet.length < beforeQueued + 2; i++) await sleep(50)
      const queuedAdded = p.logSet.slice(beforeQueued)
      check(queuedAdded.length >= 2 && queuedAdded[0].enabled === true,
        '窗口里那一趟之前先发了「开」（这一档的起点是对的，不然后面两条是空的）。', JSON.stringify(queuedAdded))
      const queuedOff = queuedAdded.filter((x) => x.enabled === false)
      check(queuedOff.length >= 1 && queuedOff[0].duringPending === true,
        '排队那一趟自己到了宿主，而且是在 B 页这一拨还没收场（复选框还禁用着）的时候发出去的。'
        + '注意这一条只量「什么时候发出去的」：实测把 settings-debug.js 里排队格那句赋值删掉，它照样绿，'
        + '真正把「排队那趟拿到的是自己那趟的结果」钉住的是下面那条提示文案断言。', JSON.stringify(queuedOff))
      const wantOff = p.dict['cfg.dbgSwitchOffToast']
      let bToast = ''
      let bSeen = ''
      for (let i = 0; i < 100 && bToast !== wantOff; i++) { await sleep(40); bToast = p.toastOf(b.container); if (bToast) bSeen = bToast }
      // 提示条自己会退场（页面里那颗定时器），所以拿「最后见到的那句非空话」兜底，免得报出来的只是空串。
      const bShown = bToast || bSeen
      check(bShown === wantOff,
        '排队那一趟拿到的 hostPushed 是它自己那趟的结果（副本收下 → B 页弹没有限定语的「已关」；'
        + '若它拿的是 A 页那趟被拒的结果，这里弹的是「已关…副本还开着」）。',
        JSON.stringify({ toast: bToast, lastSeen: bSeen, want: wantOff, added: queuedAdded }))
      const boxB1 = p.boxOf(b.container)
      check(!!boxB1 && boxB1.checked === false, 'B 页拨成的关停在界面上。', String(!!boxB1 && boxB1.checked))
      try { a.root.unmount() } catch (e) {}
      try { b.root.unmount() } catch (e) {}
    }
    // 七、拨动那一趟的回调里真抛了错（2026-10-12 复核第四轮 M5 的一半）：失败 catch 分支把 dbgPending 放掉这件事此前
    //   一条断言都量不到 —— 复核者短路它就 178 条全绿，真出问题时复选框会永远停在 disabled、这一页再也拨不动。
    //   这一档在成功回调取文案那一步逼真抛一次错（副本刚拒收、界面正要弹「……副本没接上」那一句），收场只能走 .catch。
    //   要说清它的边界：这抛错发生在成功分支里那句 setDbgPending(false) 之后，所以它量的是「收场之后这一页还能不能
    //   接着用」（再拨、自愈），量不到「.catch 里那句 setDbgPending(false)」这一行本身 —— 本轮实测，把那一行短路，
    //   这一档照样全绿。那一行的覆盖在第八条：只有这一趟的 Promise 本身被拒，成功分支才一个字都不跑。
    {
      const p = await openPage({
        docEnabled: false,
        setReply: (args) => (args.enabled === true
          ? { ok: true, value: { ok: true, enabled: true, sampleRate: 1 } }
          : { ok: true, value: { ok: false } }),
      })
      const a = await p.mount()
      check(await p.click(a.container), '第一拨（拨成开，走老路）点得动。')
      await sleep(200)
      const beforeFail = p.logSet.length
      // 副本拒收之后界面要取「已关…副本还开着」那颗文案，就让取词表这一步抛一次。
      p.throwTrOn(['cfg.dbgSwitchOffNoHost', 'cfg.dbgSwitchOffToast'])
      check(await p.click(a.container), '第二拨（拨成关，走文件这条路、副本拒收、回调里抛错）点得动。')
      const failToast = await p.waitToast(a.container, 2000)
      check(failToast === p.dict['cfg.dbgSwitchFail'],
        '这一拨的回调里抛了错：界面走失败那一句（既不静默，也不留一句把话说反的成功文案）。',
        JSON.stringify({ toast: failToast, want: p.dict['cfg.dbgSwitchFail'] }))
      check(p.trThrew() === 1, '这一档确实是靠「取文案那一步抛了一次错」把收场逼进 catch 的（不是空过）。', String(p.trThrew()))
      const boxFail = p.boxOf(a.container)
      check(!!boxFail && boxFail.disabled === false,
        '失败之后复选框不许卡在禁用上（成功分支里那句 setDbgPending(false) 已经跑过，界面必须放开）。', String(!!boxFail && boxFail.disabled))
      // 自愈那一趟照跑：副本刚被拒收，页面这次重画就该自己再推一次（与 dbgPending 无关的那条链）。
      const capHeal = Date.now() + 3000
      while (p.logSet.length < beforeFail + 2 && Date.now() < capHeal) await sleep(25)
      check(p.logSet.length >= beforeFail + 2,
        '失败之后自愈口子照跑（页面重画那一趟把副本又推了一次）。', String(p.logSet.length - beforeFail))
      // 还能再拨，而且这一下要真的生效：宿主收到新的一趟，开关停在用户拨的那一格。
      p.setReply((args) => ({ ok: true, value: { ok: true, enabled: args.enabled === true, sampleRate: 1 } }))
      const beforeThird = p.logSet.length
      check(await p.click(a.container), '失败之后第三拨点得动（复选框已经放开）。')
      const capThird = Date.now() + 3000
      while (p.logSet.length <= beforeThird && Date.now() < capThird) await sleep(25)
      check(p.logSet.length > beforeThird,
        '第三拨真的发出了新的一趟（没有被卡住的 pending 挡在门外）。', String(p.logSet.length - beforeThird))
      const boxThird = p.boxOf(a.container)
      check(!!boxThird && boxThird.checked === true, '第三拨（拨成开）落到界面上，开关停在开。', String(!!boxThird && boxThird.checked))
      try { a.root.unmount() } catch (e) {}
    }
    // 八、拨动那一趟的 Promise 真的被拒（2026-10-12 复核第四轮 M5 的决定性一档）：上一条那抛错发生在成功分支内部，
    //   而成功分支开头那句 setDbgPending(false) 已经跑过了，所以短路 .catch 里那句也能全绿（本轮实测：短路后仍
    //   194 条全绿）。要走到 .catch 那一行，只能是这一趟的 Promise 自己带着拒绝回来。
    //   造法：拨动那条路在打电话给宿主之后，会用一颗「一直不回话就算没接上」的定时器收口（时长是中央 YAML 的
    //   settingsDebugPushWaitMs，门禁里叫 CENTRAL_PUSH_WAIT_MS），页面里取的是 window.setTimeout —— 门禁只把这一个定时器
    //   换成抛错，Promise.race 整体被拒，拨动交回一个被拒的 Promise，成功分支一个字都没跑，收场只能走 .catch。
    //   代价要说清：这一拒之后 settingsDebugPushBusy 停在真上（产品里这条拒够不到，只有门禁这么逼），所以这一档
    //   不再量宿主电话的趟数（那件事在第七条里量，用的是不伤链子的抛错）。也正因为这一页的链子坏了，**别在本段
    //   后面再接新段复用这一页** —— 新段会默认「推得动」，量出来的都不是真的。
    {
      const p = await openPage({ docEnabled: false })
      const a = await p.mount()
      const realWinTimeout = p.window.setTimeout
      check(await p.click(a.container), '第一拨（拨成开，走老路）点得动（这一拨只为把文档问起来）。')
      await sleep(300)
      // 只换「等宿主回话」那一颗（时长是中央 YAML 的 settingsDebugPushWaitMs，见本文件头的 CENTRAL_PUSH_WAIT_MS）：页面别处那几颗（600 毫秒闪光退场之类）照旧。
      p.window.setTimeout = function (fn, ms) {
        if (ms === CENTRAL_PUSH_WAIT_MS) throw new Error('门禁：把「等宿主回话」那颗定时器换成抛错')
        return realWinTimeout.apply(p.window, arguments)
      }
      check(await p.click(a.container), '第二拨（拨成关，走文件这条路）点得动（这一趟的 Promise 会被拒）。')
      p.window.setTimeout = realWinTimeout
      const rejectToast = await p.waitToast(a.container, 2000)
      check(rejectToast === p.dict['cfg.dbgSwitchFail'],
        '这一趟被拒之后界面走失败那一句（成功分支一个字都没跑，只有 .catch 能收场）。',
        JSON.stringify({ toast: rejectToast, want: p.dict['cfg.dbgSwitchFail'] }))
      const boxReject = p.boxOf(a.container)
      check(!!boxReject && boxReject.disabled === false,
        '被拒之后复选框不许卡在禁用上（短路 .catch 里那句 setDbgPending(false) 就红在这条）。', String(!!boxReject && boxReject.disabled))
      // 还能再拨：这一下要真被接住（本机设置文件那趟又排一次盘），不是被卡住的 pending 挡在门外。
      //   基线要等第二拨那趟排盘落地之后再记，不然量的还是前面那一趟（第一版就是这么写的，短路变异体照样绿）。
      const afterSecond = p.setCalls.length
      const capBase = Date.now() + 2000
      while (p.setCalls.length <= afterSecond && Date.now() < capBase) await sleep(25)
      const writesBefore = p.setCalls.length
      check(await p.click(a.container), '被拒之后第三拨点得动。')
      const capW = Date.now() + 3000
      while (p.setCalls.length <= writesBefore && Date.now() < capW) await sleep(25)
      check(p.setCalls.length > writesBefore,
        '被拒之后那一拨真的被接住（本机设置文件这条路又排了一次盘）。', String(p.setCalls.length - writesBefore))
      try { a.root.unmount() } catch (e) {}
    }
  }

  console.log('')
  console.log('== 汇总：' + passed + ' 条通过，' + failed + ' 条失败 ==')
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('门禁自己抛错：' + ((e && e.stack) || e))
  process.exit(1)
})
