// verify-generated-no-shadow.js —— #597 门禁：拼进同一个客户端闭包的各个分块，顶层声明不得重名。
// 用法：在插件根目录执行 node tests/verify-generated-no-shadow.js，可独立运行。
// 为什么要有这条：客户端闭包是把「日志包派生的 logKernel.derived.js」与「更新包派生的 updateClient.derived.js」、
//   内置 TypeScript 核定下的共享拼接文件（#629 起加了 src/shared/label-color/colors.js 与 prompt.js），
//   还有手写叶子，按顺序拼成一份源码。函数声明被提升到闭包顶部，后拼的分块会顶掉先拼的同名函数。
//   两个包各自都叫 buildPhoneNames / buildPhoneName / buildClientPhoneNames，更新包在后，
//   于是日志内核拿到的电话名表变成空壳（phoneNames.logSetSwitch === undefined），
//   写开关的电话名传成 undefined、宿主 shim 在 method.replace 上抛错，
//   面板永远弹「开关保存失败」，而且客户端一条日志行都发不出去（连日志上报的电话名也是 undefined）。
//   配色核心那两个产物是机器生成的，人不会顺手检查它们的名字，所以一并纳入比对（#616 裁决：这条要扩）。
// 断言三件事：
//   一、静态：拼接清单里每个文件的顶层声明名集合两两不得有交集（新增撞名当场变红）。
//   二、运行时：按真实拼接顺序把这些文件拼起来、建一次客户端日志器，
//       五个日志电话名与四个更新电话名必须都拼对（顶掉即红）。
//   三、写到产物里：打包产物必须已经带上修好的这份。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = 0
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed += 1 }

console.log('客户端闭包重名门禁（#597：同闭包内顶层声明不得互相顶掉）')

const LOG_KERNEL = path.join(ROOT, 'scripts', 'generated', 'logKernel.derived.js')
const UPDATE_CLIENT = path.join(ROOT, 'scripts', 'generated', 'updateClient.derived.js')
// #629：配色核心的两个产物按 scripts/build.mjs 的 SHARED_SPLICE 清单拼进同一个闭包，
// 排在两份派生文件之后（位置对齐 src/client/index.js 里的拼接标记）。
const LABEL_COLORS = path.join(ROOT, 'src', 'shared', 'label-color', 'colors.js')
const LABEL_PROMPT = path.join(ROOT, 'src', 'shared', 'label-color', 'prompt.js')
const SPLICED_FILES = [
  { label: '日志包派生文件', file: LOG_KERNEL },
  { label: '更新包派生文件', file: UPDATE_CLIENT },
  { label: '配色核心产物 colors.js', file: LABEL_COLORS },
  { label: '配色核心产物 prompt.js', file: LABEL_PROMPT },
]

// —— 一、静态：顶层声明名集合两两不得有交集 ——
// 口径：只看顶层（行首或 export 开头、无缩进）的 function / var / let / const 声明名。
function topLevelNames(text) {
  const out = new Set()
  for (const line of text.split(/\r?\n/)) {
    const m = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?(?:var|let|const)\s+([A-Za-z_$][\w$]*)/.exec(line)
    if (m) out.add(m[1] || m[2])
  }
  return out
}

const parsed = SPLICED_FILES.map((f) => {
  const text = fs.readFileSync(f.file, 'utf8')
  const names = topLevelNames(text)
  check(names.size > 0, `${f.label}解析出顶层声明 ${names.size} 个`)
  return { ...f, names }
})
const collisions = []
for (let i = 0; i < parsed.length; i += 1) {
  for (let j = i + 1; j < parsed.length; j += 1) {
    const shared = [...parsed[i].names].filter((n) => parsed[j].names.has(n)).sort()
    if (shared.length) collisions.push(`${parsed[i].label} ↔ ${parsed[j].label}：${shared.join('、')}`)
  }
}
check(
  collisions.length === 0,
  `拼进闭包的 ${parsed.length} 个文件顶层声明两两无重名（撞名的：${collisions.length === 0 ? '无' : collisions.join('；')}）`
)

// —— 二、运行时：按真实拼接顺序拼成一份，建日志器与取更新电话名 ——
// 拼接顺序与 src/client/index.js 里的分块顺序一致：日志包与更新包在前、配色核心两个产物在后。
function stripExports(text) {
  return text.replace(/^export\s+/gm, '')
}
const logText = fs.readFileSync(LOG_KERNEL, 'utf8')
const updText = fs.readFileSync(UPDATE_CLIENT, 'utf8')
const closureSource =
  stripExports(logText) +
  '\n' + stripExports(updText) +
  '\n' + stripExports(fs.readFileSync(LABEL_COLORS, 'utf8')) +
  '\n' + stripExports(fs.readFileSync(LABEL_PROMPT, 'utf8')) +
  '\nreturn { __pkgLog, UPD_STATUS, UPD_CHECK, UPD_INSTALL, UPD_POLL, normalizeColor, colorsDiffer, buildPalettePrompt }\n'

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
  // #629：配色核心两个产物拼进闭包之后，它们导出的名字必须真的能在闭包里用（没被顶掉、也没写坏）。
  check(built.mod.normalizeColor('#8B5CF6') === '8b5cf6', `配色核心的 normalizeColor 在闭包里可用（实得 ${String(built.mod.normalizeColor('#8B5CF6'))}）`)
  check(built.mod.colorsDiffer('', '') === false, `配色核心的 colorsDiffer 在闭包里可用（colorsDiffer('', '') 实得 ${String(built.mod.colorsDiffer('', ''))}）`)
  check(typeof built.mod.buildPalettePrompt === 'function', '配色核心的 buildPalettePrompt 在闭包里可见')
}

// —— 三、写到产物里：打包产物必须已经带上修好的这份 ——
const bundlePath = path.join(ROOT, 'package', 'lib', 'client.js')
if (fs.existsSync(bundlePath)) {
  const bundle = fs.readFileSync(bundlePath, 'utf8')
  check(bundle.includes('updBuildPhoneNames'), '打包产物里更新包那份助手函数已改名（updBuildPhoneNames）')
} else {
  check(false, '打包产物 package/lib/client.js 不存在（先跑 node scripts/build.mjs）')
}

console.log(failed ? `\n客户端闭包重名门禁失败 ${failed} 项（共 ${total} 项）` : `\n客户端闭包重名门禁全部通过（${total} 项）`)
process.exit(failed ? 1 : 0)
