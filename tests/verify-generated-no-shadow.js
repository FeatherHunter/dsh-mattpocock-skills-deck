// verify-generated-no-shadow.js —— #597 门禁：两个派生客户端分块拼进同一个闭包时，顶层声明不得重名。
// 用法：在插件根目录执行 node tests/verify-generated-no-shadow.js，可独立运行。
// 为什么要有这条：客户端闭包是把「日志包派生的 logKernel.derived.js」与「更新包派生的 updateClient.derived.js」
//   还有手写叶子，按顺序拼成一份源码。函数声明被提升到闭包顶部，后拼的分块会顶掉先拼的同名函数。
//   两个包各自都叫 buildPhoneNames / buildPhoneName / buildClientPhoneNames，更新包在后，
//   于是日志内核拿到的电话名表变成空壳（phoneNames.logSetSwitch === undefined），
//   写开关的电话名传成 undefined、宿主 shim 在 method.replace 上抛错，
//   面板永远弹「开关保存失败」，而且客户端一条日志行都发不出去（连日志上报的电话名也是 undefined）。
// 断言两件事：
//   一、静态：两份派生文件的顶层声明名集合不得有交集（新增撞名当场变红）。
//   二、运行时：按真实拼接顺序把两份文件拼起来、建一次客户端日志器，
//       五个日志电话名与三个更新电话名必须都拼对（顶掉即红）。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = 0
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed += 1 }

console.log('派生客户端分块重名门禁（#597：同闭包内顶层声明不得互相顶掉）')

const LOG_KERNEL = path.join(ROOT, 'scripts', 'generated', 'logKernel.derived.js')
const UPDATE_CLIENT = path.join(ROOT, 'scripts', 'generated', 'updateClient.derived.js')

// —— 一、静态：顶层声明名集合不得有交集 ——
// 口径：只看顶层（行首或 export 开头、无缩进）的 function / var / let / const 声明名。
function topLevelNames(text) {
  const out = new Set()
  for (const line of text.split(/\r?\n/)) {
    const m = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?(?:var|let|const)\s+([A-Za-z_$][\w$]*)/.exec(line)
    if (m) out.add(m[1] || m[2])
  }
  return out
}

const logText = fs.readFileSync(LOG_KERNEL, 'utf8')
const updText = fs.readFileSync(UPDATE_CLIENT, 'utf8')
const logNames = topLevelNames(logText)
const updNames = topLevelNames(updText)
const shared = [...logNames].filter((n) => updNames.has(n)).sort()
check(logNames.size > 0, `日志包派生文件解析出顶层声明 ${logNames.size} 个`)
check(updNames.size > 0, `更新包派生文件解析出顶层声明 ${updNames.size} 个`)
check(
  shared.length === 0,
  `两份派生文件顶层声明无重名（撞名的：${shared.length === 0 ? '无' : shared.join('、')}）`
)

// —— 二、运行时：按真实拼接顺序拼成一份，建日志器与取更新电话名 ——
// 拼接顺序与 src/client/index.js 里的分块顺序一致：日志包在前、更新包在后。
function stripExports(text) {
  return text.replace(/^export\s+/gm, '')
}
const closureSource =
  stripExports(logText) +
  '\n' + stripExports(updText) +
  '\nreturn { __pkgLog, UPD_STATUS, UPD_CHECK, UPD_INSTALL, UPD_POLL }\n'

function buildOnce() {
  const calls = []
  const host = { call: (method, args) => { calls.push(method); return Promise.resolve({ ok: true, enabled: true }) } }
  const timer = { timeout: (fn, ms) => setTimeout(fn, ms) }
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  const fn = new Function('host', 'timer', 'localStorage', 'broadcastLogSwitch', closureSource)
  return { mod: fn(host, timer, storage, () => {}), calls }
}

let built = null
try {
  built = buildOnce()
} catch (e) {
  check(false, `拼接后能建出日志器（抛错：${(e && e.message) || e}）`)
}

if (built) {
  const names = (built.mod.__pkgLog && built.mod.__pkgLog.phoneNames) || {}
  check(names.logSetSwitch === 'wf.logSetSwitch', `日志内核的电话名 logSetSwitch = ${String(names.logSetSwitch)}（期望 wf.logSetSwitch）`)
  check(names.logBatch === 'wf.logBatch', `日志内核的电话名 logBatch = ${String(names.logBatch)}（期望 wf.logBatch，日志上行靠它）`)
  check(names.logExport === 'wf.logExport', `日志内核的电话名 logExport = ${String(names.logExport)}（期望 wf.logExport）`)
  check(names.logClear === 'wf.logClear', `日志内核的电话名 logClear = ${String(names.logClear)}（期望 wf.logClear）`)
  check(names.logGetSwitch === 'wf.logGetSwitch', `日志内核的电话名 logGetSwitch = ${String(names.logGetSwitch)}（期望 wf.logGetSwitch）`)
  check(built.mod.UPD_STATUS === 'wf.updateStatus', `更新电话名 updateStatus = ${String(built.mod.UPD_STATUS)}（期望 wf.updateStatus）`)
  check(built.mod.UPD_CHECK === 'wf.updateCheck', `更新电话名 updateCheck = ${String(built.mod.UPD_CHECK)}（期望 wf.updateCheck）`)
  check(built.mod.UPD_INSTALL === 'wf.updateInstall', `更新电话名 updateInstall = ${String(built.mod.UPD_INSTALL)}（期望 wf.updateInstall）`)
  check(built.mod.UPD_POLL === 1000, `更新轮询间隔 = ${String(built.mod.UPD_POLL)}（期望 1000）`)
}

// —— 三、写到产物里：打包产物必须已经带上修好的这份 ——
const bundlePath = path.join(ROOT, 'package', 'lib', 'client.js')
if (fs.existsSync(bundlePath)) {
  const bundle = fs.readFileSync(bundlePath, 'utf8')
  check(bundle.includes('updBuildPhoneNames'), '打包产物里更新包那份助手函数已改名（updBuildPhoneNames）')
} else {
  check(false, '打包产物 package/lib/client.js 不存在（先跑 node scripts/build.mjs）')
}

console.log(failed ? `\n派生分块重名门禁失败 ${failed} 项（共 ${total} 项）` : `\n派生分块重名门禁全部通过（${total} 项）`)
process.exit(failed ? 1 : 0)
