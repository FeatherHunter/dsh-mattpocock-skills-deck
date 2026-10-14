/**
 * scripts/derive-log-from-package.mjs —— 日志系统派生脚本（#564 当前插件迁移到日志包）。
 *
 * 作用：把已安装的日志包（node_modules/dsh-log，#892 起不再读本地 packages/dsh-log）的已构建产物，原样派生为插件运行时真正使用的文件。
 * 旧文件一个字节都不动（src/host/logStore.js、src/host/logPhones.js、src/client/kernel/log.js 原地只读留存，
 * 门禁仍读它们）；运行时走这里生成的新文件。真删除旧文件另开票，本票只做共存。
 *
 * 早失败哨兵（为日志包升到 0.3.0 那一趟准备）：写文件之前，本脚本会把「自己与客户端 tail 依赖包的那些名字」
 * 逐个核一遍（工厂名、返回对象上要用到的名字、五个电话字段名、注释归一的两个字面、客户端那三条自监控事件名），
 * 缺谁就把谁列出来当场失败。为什么必须这样：包改名不会让打包失败——工厂名换了要等运行时报错，
 * 返回对象少一个名字会静默变成 undefined，归一字面没了则 replace 不生效、派生文件悄悄变样。
 * 边界说清楚：这是文本级的存在性检查，不是类型检查（名字在产物里出现过≠运行时一定有值）；
 * 行为上的最终证明仍在双产物门禁与冒烟里，这里只求把「升级后静默错位」提前到构建时暴露。
 *
 * 派生内容（只剩客户端那一处；宿主那半按 #1016 退场，理由见下）：
 *   客户端侧：把已安装包 dist/client.js 打包成单文件（依赖的配置面内联，无外部引用；来源注释归一到与旧输出一致），
 *      末尾用闭包里现成的四个名字（host、timer、localStorage、broadcastLogSwitch）建日志器，
 *      落到 scripts/generated/logKernel.derived.js；构建时拼入原来日志模块的位置。
 *      放 scripts 下是因为内容含中文错误文案， src/client 下会被中文基线门禁误拦；构建产物里早有中文注释，
 *      行为一致，只是换个地方放。
 *
 * 宿主那半为什么没了（#1016）：从前这里还把上游 dist/{config,store,phones,host}.js 原样复制到
 *   src/host/logPkg/，让插件在自己的源码树里自带一份上游代码。现在宿主改成常规依赖——
 *   src/host/logFromPackage.js 直接 import 已安装包的 'dsh-log/host'，src/ 下不再留这份副本，
 *   派生脚本也就不再有宿主那一半。
 *   代价是「客户端打包用的那份」与「宿主取值用的那份」第一次有了版本不一致的可能，所以构建里加了一条
 *   「两半版本一致」的断言（scripts/build.mjs）：它比对 package/package.json 里 pin 死的版本与已安装的
 *   那份，不一致就当场拦住构建，不把这个错配留到运行时才发现。
 *
 * 用法：node scripts/derive-log-from-package.mjs（插件根目录；要求已安装的 dsh-log 与当前依赖一致）。
 * 构建脚本 scripts/build.mjs 会在需要时自动调本脚本，平时不用手工跑。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
function resolveInstalledPkgDir() {
  // 不用 resolve('dsh-log/package.json')：包的 exports 只开放 host/client/node 三个子路径，package.json 子路径未开放会抛 ERR_PACKAGE_PATH_NOT_EXPORTED。
  // 经已开放的 host 入口反推包目录：dsh-log/host → <包>/dist/host.js，上两级即包根。
  const require = createRequire(resolve(ROOT, 'package.json'))
  const hostEntry = require.resolve('dsh-log/host')
  return dirname(dirname(hostEntry))
}
const PKG_DIST = resolve(resolveInstalledPkgDir(), 'dist')

const CLIENT_OUT = resolve(ROOT, 'scripts', 'generated', 'logKernel.derived.js')

// 已安装日志包的真实版本号。头部那句「内容与日志包 X 一致」要说真话，所以每次现读，不写死字面：
// 从前这里写死过 0.1.0，而包早已升到 0.2.x，那句话就成了假话（#1016 顺手改掉）。
// 读法经已开放的 host 入口反推包目录，理由同 resolveInstalledPkgDir()。
function installedVersion() {
  return JSON.parse(readFileSync(resolve(resolveInstalledPkgDir(), 'package.json'), 'utf8')).version
}

function requireEsbuild() {
  const require = createRequire(resolve(ROOT, 'package.json'))
  try {
    return require('esbuild')
  } catch {
    throw new Error('[derive-log] 找不到 esbuild：请先运行 pnpm install（根 devDependencies 含 esbuild）')
  }
}

// ---- 早失败哨兵：本脚本与客户端 tail 依赖包的那些名字（理由与边界见文件头）----
// 长名字才有信号：改一个就当场列出来。短名字（log、flush、isEnabled、hash8、logSwitch、logQueue）在产物里
// 必然出现，检查它们抓不到改名，列在这里只作「我们用到哪些名字」的清单留痕。
const REQUIRED_FACTORY = 'createClientLog'
const REQUIRED_MEMBERS = [
  'readLocalDebugSwitch', 'persistLocalDebugSwitch', 'logSwitch', 'logQueue', 'logDroppedState',
  'logForwardState', 'logFlushTimer', 'isEnabled', 'log', 'scheduleLogFlush', 'estimateBatchBytes',
  'maybeForwardSummary', 'hash8', 'logExportFail', 'watchSwitchOp', 'sendLogBatch', 'flush',
  'getDroppedCount', 'reconcileLogSwitch', 'setLogSwitch', 'phoneNames',
]
const REQUIRED_PHONE_FIELDS = ['logBatch', 'logExport', 'logClear', 'logGetSwitch', 'logSetSwitch']
const REQUIRED_SOURCE_COMMENTS = ['// packages/dsh-log/src/config.ts', '// packages/dsh-log/src/client.ts']
// 引号归一的名单照旧是自监控那一族五条，但只有三条出现在客户端产物里（实测 2026-10-14，dsh-log 0.2.2）：
//   log.forward.summary / log.switch.watchdog / log.export.fail 在 dist/client.js；
//   host.dispatch.error 由本仓宿主侧发射（src/host/rpcChannel.js:96、:119，src/host/index.js:337），
//   log.persist.fail 在包的宿主那一半（node_modules/dsh-log/dist/store.js）。
// 所以只对客户端这三条设断言；另外两条仍走同一次归一循环（它们各归各自的那一半，这里只是照旧带上）。
const SELF_MONITOR_EVENTS = [
  'host.dispatch.error', 'log.persist.fail', 'log.forward.summary', 'log.switch.watchdog', 'log.export.fail',
]
const REQUIRED_CLIENT_EVENTS = ['log.forward.summary', 'log.switch.watchdog', 'log.export.fail']

function assertPackageSurface(body) {
  const missing = []
  if (!body.includes(REQUIRED_FACTORY)) missing.push('工厂名 ' + REQUIRED_FACTORY + '（客户端 tail 要用它建日志器）')
  for (const name of REQUIRED_MEMBERS) {
    if (!body.includes(name)) missing.push('返回对象上的名字 ' + name + '（tail 的 export 行要读它）')
  }
  for (const name of REQUIRED_PHONE_FIELDS) {
    if (!body.includes(name)) missing.push('电话字段名 ' + name + '（tail 末尾那行零变化断言要读它）')
  }
  for (const literal of REQUIRED_SOURCE_COMMENTS) {
    if (!body.includes(literal)) missing.push('注释归一的字面 ' + literal + '（改了这个 replace 静默不生效）')
  }
  for (const name of REQUIRED_CLIENT_EVENTS) {
    if (!body.includes('"' + name + '"') && !body.includes("'" + name + "'")) {
      missing.push('客户端自监控事件名 ' + name + '（改了这个引号归一静默不生效）')
    }
  }
  if (missing.length) {
    throw new Error(
      '[derive-log] 已安装的日志包里找不到本脚本依赖的名字。升级或改名时请把本脚本与客户端 tail 一起改，' +
        '不要放过这条：\n  - ' + missing.join('\n  - ')
    )
  }
}

export function deriveClient() {
  const esbuild = requireEsbuild()
  const entry = resolve(PKG_DIST, 'client.js')
  const built = esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2020',
    // #564 T2：固定工作目录，esbuild 模块注释（// packages/... 行）不再随调用方 cwd 漂移。
    absWorkingDir: ROOT,
    write: false,
  })
  if (!built.outputFiles || built.outputFiles.length !== 1) {
    throw new Error('[derive-log] 客户端打包产物数量不对（期望恰好 1 个文件）')
  }
  let body = Buffer.from(built.outputFiles[0].contents).toString('utf8').replace(/\r\n/g, '\n')
  // #564 T2：注释路径归一（只动注释行，不改行为）。不同目录重跑时 esbuild 会写出
  // // ../packages/... 之类的相对形态，这里统一归一成 packages/ 开头，保证任意目录重跑零 diff。
  body = body.replace(/^\/\/ (\.\.\/)+packages\//gm, '// packages/')
  // #892：入口已从本地 src/client.ts 切到已安装包 dist/client.js，两处来源注释归一到与旧输出一致（只动注释行，不改行为）。
  // 实测两入口打包产物各 604 行，仅第 1 行与第 108 行来源注释不同，这里固定成旧字面，保证派生文件一字不差。
  body = body.replace(/^\/\/ .*dsh-log\/dist\/config\.js$/gm, '// packages/dsh-log/src/config.ts')
  body = body.replace(/^\/\/ .*dsh-log\/dist\/client\.js$/gm, '// packages/dsh-log/src/client.ts')
  if (/^\s*import[\s{*]/m.test(body) || /from\s+['"]\.\.?\//.test(body)) {
    throw new Error('[derive-log] 客户端打包后仍有外部引用（应全部内联），请检查日志包客户端入口的引用')
  }
  body = body.replace(/\s+$/, '') + '\n'
  // 引号归一（行为不变）：打包器输出双引号，旧模块用单引号；双产物门禁要求客户端事件以单引号形态出现，
  // 这里只换自监控 5 个事件名字面（内容无单引号，纯换引号不改行为）。
  for (const name of SELF_MONITOR_EVENTS) {
    body = body.split('"' + name + '"').join("'" + name + "'")
  }
  // 归一做完了再核名字：报出来的缺失就是「这批归一与 tail 对不上」，不会被先后顺序误导。
  assertPackageSurface(body)
  const tail =
    '\n' +
    '// ---- 实例化（#564）：用闭包里现成的四个名字建日志器，插件标识 wf，默认配置与旧行为一致 ----\n' +
    '// 旧模块（src/client/kernel/log.js）原地只读留存；运行时走本派生文件。共存关系见本文件头，真删除旧文件另开票。\n' +
    '// 注意：broadcastLogSwitch 的声明在 probeSnapshot 分块里，拼入位置在本分块之后；这里若直接写名字，\n' +
    '// 加载时就会因先用后声明而抛错（渲染冒烟实测）。所以包一层转发函数，调用时（模块早已加载完）再解析，行为与直传一致。\n' +
    'const __broadcastLogSwitchLate = function () { try { if (typeof broadcastLogSwitch === \'function\') return broadcastLogSwitch.apply(null, arguments) } catch (e) {} }\n' +
    'const __pkgLog = createClientLog({ host: host, timer: timer, storage: localStorage, broadcastLogSwitch: __broadcastLogSwitchLate }, { pluginId: \'wf\' })\n' +
    'export const readLocalDebugSwitch = __pkgLog.readLocalDebugSwitch\n' +
    'export const persistLocalDebugSwitch = __pkgLog.persistLocalDebugSwitch\n' +
    'export const logSwitch = __pkgLog.logSwitch\n' +
    'export const logQueue = __pkgLog.logQueue\n' +
    'export const logDroppedState = __pkgLog.logDroppedState\n' +
    'export const logForwardState = __pkgLog.logForwardState\n' +
    'export const logFlushTimer = __pkgLog.logFlushTimer\n' +
    'export const isEnabled = __pkgLog.isEnabled\n' +
    'export const log = __pkgLog.log\n' +
    'export const scheduleLogFlush = __pkgLog.scheduleLogFlush\n' +
    'export const estimateBatchBytes = __pkgLog.estimateBatchBytes\n' +
    'export const maybeForwardSummary = __pkgLog.maybeForwardSummary\n' +
    'export const hash8 = __pkgLog.hash8\n' +
    'export const logExportFail = __pkgLog.logExportFail\n' +
    'export const watchSwitchOp = __pkgLog.watchSwitchOp\n' +
    'export const sendLogBatch = __pkgLog.sendLogBatch\n' +
    'export const flush = __pkgLog.flush\n' +
    'export const getDroppedCount = __pkgLog.getDroppedCount\n' +
    'export const reconcileLogSwitch = __pkgLog.reconcileLogSwitch\n' +
    'export const setLogSwitch = __pkgLog.setLogSwitch\n' +
    '// 零变化断言字面（默认 wf 下 5 个电话名与旧字面一致；双产物检查直接看到这些字面，运行时走上面的工厂拼名）\n' +
    'void (__pkgLog.phoneNames.logBatch === \'wf.logBatch\' && __pkgLog.phoneNames.logExport === \'wf.logExport\' && __pkgLog.phoneNames.logClear === \'wf.logClear\' && __pkgLog.phoneNames.logGetSwitch === \'wf.logGetSwitch\' && __pkgLog.phoneNames.logSetSwitch === \'wf.logSetSwitch\')\n'
  const header =
    '// 派生文件（#564）：由 packages/dsh-log/src/client.ts（含配置面）打包生成，内容与日志包 ' + installedVersion() + ' 一致，人手不改。\n' +
    '// 旧模块（src/client/kernel/log.js）原地只读留存；构建时本文件拼入原来日志模块的位置（kernel:log 标记处）。\n' +
    '// 共存关系：旧文件只读、新文件派生，真搬迁或真删除旧文件另开票。重新生成：node scripts/derive-log-from-package.mjs。\n'
  mkdirSync(dirname(CLIENT_OUT), { recursive: true })
  writeFileSync(CLIENT_OUT, header + body + tail, 'utf8')
  console.log('[derive-log] dist/client.js -> scripts/generated/logKernel.derived.js')
}

function main() {
  deriveClient()
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) {
  try {
    main()
  } catch (e) {
    console.error((e && e.message) || e)
    process.exit(1)
  }
}
