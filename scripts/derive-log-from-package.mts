// 迁移说明（#1252）：本文件由 scripts/derive-log-from-package.mjs 转写而来，只加类型注解，行为零变化。
/**
 * scripts/derive-log-from-package.mts —— 日志系统派生脚本（#564 当前插件迁移到日志包）。
 *
 * 作用：把已安装的日志包（node_modules/dsh-log，#892 起不再读本地 packages/dsh-log）的已构建产物，原样派生为插件运行时真正使用的文件。
 * 宿主两份旧文件（src/host/logStore.js、src/host/logPhones.js）已被 #1247 删除，本脚本从不读它们；
 * 客户端 src/client/kernel/log.js 仍是 .js/.ts 双存（产物侧，另行处理）。运行时走这里生成的新文件。
 *
 * 早失败哨兵（日志包 0.3.x 已落地，核对项随新版产物更新）：写文件之前，本脚本会把「自己与客户端 tail 依赖包的那些名字」
 * 逐个核一遍（工厂名、返回对象上要用到的名字、五个电话字段名、包顶层名字、注释归一的两个字面、客户端那三条自监控事件名），
 * 缺谁就把谁列出来当场失败。为什么必须这样：包改名不会让打包失败——工厂名换了要等运行时报错，
 * 返回对象少一个名字会静默变成 undefined，归一字面没了则 replace 不生效、派生文件悄悄变样。
 * 边界说清楚：这是文本级的存在性检查，不是类型检查（名字在产物里出现过≠运行时一定有值）；
 * 行为上的最终证明仍在双产物门禁与冒烟里，这里只求把「升级后静默错位」提前到构建时暴露。
 *
 * 派生内容（只剩客户端那一处；宿主那半按 #1016 退场，理由见下）：
 *   客户端侧：把已安装包 dist/client.js 打包成单文件（依赖的配置面与客户端分面全部内联，无外部引用；
 *      打包器给每个内联模块写的来源注释统一归一成 packages/dsh-log/dist/… 形态），
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
 *   「两半版本一致」的断言（scripts/build.mts）：它比对 package/package.json 里 pin 死的版本与已安装的
 *   那份，不一致就当场拦住构建，不把这个错配留到运行时才发现。
 *
 * 用法：node scripts/derive-log-from-package.mts（插件根目录；要求已安装的 dsh-log 与当前依赖一致）。
 * 构建脚本 scripts/build.mts 会在需要时自动调本脚本，平时不用手工跑。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
function resolveInstalledPkgDir(): string {
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
function installedVersion(): string {
  return JSON.parse(readFileSync(resolve(resolveInstalledPkgDir(), 'package.json'), 'utf8')).version
}

/** 本脚本用到的 esbuild Node API 最小形状（只调 buildSync；完整类型不在这里重造）。 */
interface EsbuildSyncApi {
  buildSync: (options: Record<string, unknown>) => { outputFiles?: Array<{ contents: Uint8Array }> };
}

function requireEsbuild(): EsbuildSyncApi {
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
const REQUIRED_FACTORY: string = 'createClientLog'
const REQUIRED_MEMBERS: string[] = [
  'readLocalDebugSwitch', 'persistLocalDebugSwitch', 'logSwitch', 'logQueue', 'logDroppedState',
  'logForwardState', 'logFlushTimer', 'isEnabled', 'log', 'scheduleLogFlush', 'estimateBatchBytes',
  'maybeForwardSummary', 'hash8', 'logExportFail', 'watchSwitchOp', 'sendLogBatch', 'flush',
  'getDroppedCount', 'reconcileLogSwitch', 'setLogSwitch', 'phoneNames',
]
const REQUIRED_PHONE_FIELDS: string[] = ['logBatch', 'logExport', 'logClear', 'logGetSwitch', 'logSetSwitch']
const REQUIRED_TOPLEVEL: string[] = ['debugStorageKey', 'LOG_DEBUG_KEY']
// 0.3.x 起客户端入口拆成 client.js（含配置面 config/ 与客户端分面 client/）：打包后每个内联模块各留一条来源注释，
// 0.2.x 的两条归一字面（src/config.ts、src/client.ts）随拆分消失。这里核打包入口与电话名来源这两条最要紧的：
// client.js（工厂所在）与 config/phones.js（五个电话名所在），少任一条都说明归一规则没对上新版产物布局。
const REQUIRED_SOURCE_COMMENTS: string[] = ['// packages/dsh-log/dist/client.js', '// packages/dsh-log/dist/config/phones.js']
// 引号归一的名单照旧是自监控那一族五条，但只有三条出现在客户端产物里（实测 2026-10-14，dsh-log 0.2.2）：
//   log.forward.summary / log.switch.watchdog / log.export.fail 在 dist/client.js；
//   host.dispatch.error 由本仓宿主侧发射（src/host/rpcChannel.js:96、:119，src/host/index.ts:345），
//   log.persist.fail 在包的宿主那一半（node_modules/dsh-log/store.js）。
// 所以只对客户端这三条设断言；另外两条仍走同一次归一循环（它们各归各自的那一半，这里只是照旧带上）。
const SELF_MONITOR_EVENTS: string[] = [
  'host.dispatch.error', 'log.persist.fail', 'log.forward.summary', 'log.switch.watchdog', 'log.export.fail',
]
const REQUIRED_CLIENT_EVENTS: string[] = ['log.forward.summary', 'log.switch.watchdog', 'log.export.fail']

function assertPackageSurface(body: string): void {
  const missing: string[] = []
  if (!body.includes(REQUIRED_FACTORY)) missing.push('工厂名 ' + REQUIRED_FACTORY + '（客户端 tail 要用它建日志器）')
  for (const name of REQUIRED_MEMBERS) {
    if (!body.includes(name)) missing.push('返回对象上的名字 ' + name + '（tail 的 export 行要读它）')
  }
  for (const name of REQUIRED_PHONE_FIELDS) {
    if (!body.includes(name)) missing.push('电话字段名 ' + name + '（tail 末尾那行零变化断言要读它）')
  }
  for (const name of REQUIRED_TOPLEVEL) {
    if (!body.includes(name)) missing.push('包顶层名字 ' + name + '（客户端 settings-debug.js 的升级迁移要调它算新键）')
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

export function deriveClient(): void {
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
  let body: string = Buffer.from(built.outputFiles[0].contents).toString('utf8').replace(/\r\n/g, '\n')
  // 注释路径归一（只动注释行，不改行为）。0.3.x 的模块注释是已安装包的真实相对路径，
  // pnpm 下形如 node_modules/.pnpm/dsh-log@0.3.4/node_modules/dsh-log/dist/client/forward.js，
  // npm 下形如 node_modules/dsh-log/dist/client/forward.js——装包方式与版本号不同写法就不同。
  // 这里统一归一成 packages/dsh-log/dist/ 开头：版本号与装包布局被抹掉，任意机器重跑零 diff；
  // 字面指向的是已安装包里的构建产物相对路径，不是本仓文件（dsh-log 已搬独立仓库，本仓无 packages/dsh-log）。
  body = body.replace(/^\/\/ (\.\.\/)+packages\//gm, '// packages/')
  body = body.replace(/^\/\/ \S*node_modules\/dsh-log\/dist\/(\S+)$/gm, '// packages/dsh-log/dist/$1')
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
  // 打包器尾部的 export 列表剥掉（只去这一个列表，不动声明本身）。
  // 0.3.x 的包是多文件打包，esbuild 会在末尾吐一个多行的 export { A as B, … } 块；
  // 构建拼 client 时是「去掉行首 export 后拼声明体」，块首行能去掉、续行（`X as Y,`）去不掉，
  // 续行里的 as 会让语法门禁报 Unexpected identifier 'as'（client-dev precheckCode 实测）。
  // 0.2.x 是单文件打包没有这个块，所以以前没事。
  body = body.replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '')
  if (/^\s*export\s+/m.test(body)) {
    throw new Error('[derive-log] 包体还有残留 export 行（多块 export 或行内 export function 这类新形态），请先看产物再改这处处理')
  }
  // 作用域隔离（0.3.x 多文件打包才有的问题）：包体顶层有 60 多个声明，20 个 tail 名在里面全有同名
  // （function 与 const 混着，实测 20/20 全撞），直接拼进客户端闭包会报 Identifier X has already been declared。
  // 0.2.x 是单文件，助手全收在工厂闭包里，顶层只有工厂自己，所以以前没事。
  // 修法：包体包进 IIFE 藏起来，只把外面真正用到的三个 surfacing 到闭包顶层——
  //   createClientLog（下面 tail 建日志器用）、debugStorageKey 与 LOG_DEBUG_KEY
  //   （src/client/kernel/settings-debug.js 开关迁移用，裸名调用）。
  // 外面其余名字一律走 tail 从日志器实例上取的那一份（正是各调用方要的，其中 log 是包好的那一版）。
  for (const n of ['createClientLog', 'debugStorageKey', 'LOG_DEBUG_KEY']) {
    if (!new RegExp('(?:function|var|let|const)\\s+' + n + '\\b').test(body)) {
      throw new Error('[derive-log] 包体顶层找不到要 surfacing 的名字 ' + n + '（包改名或改形态时请连 tail 与 settings-debug.js 一起改）')
    }
  }
  if (body.includes('`')) {
    throw new Error('[derive-log] 包体出现反引号（多行模板字符串缩进会改字符串内容），请改手工处理再缩进')
  }
  const SURFACED = ['createClientLog', 'debugStorageKey', 'LOG_DEBUG_KEY']
  body =
    '// ---- 作用域隔离（0.3.x）：包体多文件打包的顶层声明与下面 tail 同名，包进 IIFE 藏起来，只留三个外面要用的 ----\n' +
    'const __pkgLogScope = (() => {\n' +
    body.split('\n').map((l: string): string => (l.length ? '  ' + l : l)).join('\n') +
    '  return { ' + SURFACED.map((n: string): string => n + ': ' + n).join(', ') + ' };\n' +
    '})();\n' +
    SURFACED.map((n: string): string => 'const ' + n + ' = __pkgLogScope.' + n + ';\n').join('')
  const tail =
    '\n' +
    '// ---- 实例化（#564）：用闭包里现成的四个名字建日志器，插件标识 wf，默认配置与旧行为一致 ----\n' +
    '// 旧模块（src/client/kernel/log.js）原地只读留存；运行时走本派生文件。共存关系见本文件头，真删除旧文件另开票。\n' +
    '// 注意：broadcastLogSwitch 的声明在 probeSnapshot 分块里，拼入位置在本分块之后；这里若直接写名字，\n' +
    '// 加载时就会因先用后声明而抛错（渲染冒烟实测）。所以包一层转发函数，调用时（模块早已加载完）再解析，行为与直传一致。\n' +
    'const __broadcastLogSwitchLate = function () { try { if (typeof broadcastLogSwitch === \'function\') return broadcastLogSwitch.apply(null, arguments) } catch (e) {} }\n' +
    'const __pkgLog = createClientLog({ host: host, timer: timer, storage: localStorage, broadcastLogSwitch: __broadcastLogSwitchLate }, { pluginId: \'wf\', prefix: \'wf\' })\n' +
    '// ---- 开机秒显的升级兜底（0.2.x→0.3.x）：包只读新键 dsws.debug.wf，裸旧键 dsws.debug 不认了；\n' +
    '// 老用户开着时会先闪一下关。持久化那份迁移归 settings-debug.js（settingsDebugLegacy，新键没有、旧键是对象\n' +
    '// 才搬，采样率证据也由它收），这里只把内存这份原地改成开，让导出的快照即刻为开——不能在这里 persist：\n' +
    '// 一写新键，settings-debug 那边的“新键没有才读旧键”就进不去了，升级证据里的采样率就丢了（门禁实测）。\n' +
    '// 必须原地改、不换对象：\n' +
    '// 包的对账（reconcile）拿的是同一个对象引用，原地改两边才都认；换对象会让导出的快照与对账各说各话。\n' +
    'try {\n' +
    '  if (__pkgLog && __pkgLog.logSwitch && __pkgLog.logSwitch.enabled !== true && typeof localStorage !== \'undefined\' && localStorage && !localStorage.getItem(debugStorageKey(\'wf\'))) {\n' +
    '    const __legacySaved = JSON.parse(localStorage.getItem(LOG_DEBUG_KEY) || \'null\')\n' +
    '    if (__legacySaved && typeof __legacySaved === \'object\' && !Array.isArray(__legacySaved) && __legacySaved.enabled === true) {\n' +
    '      __pkgLog.logSwitch.enabled = true\n' +
    '    }\n' +
    '  }\n' +
    '} catch (eM) { void eM }\n' +
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
    '// 派生文件（#564）：由已安装日志包的 dist/client.js（含配置面与客户端分面）打包生成，内容与日志包 ' + installedVersion() + ' 一致，人手不改。\n' +
    '// 旧模块（src/client/kernel/log.js）原地只读留存；构建时本文件拼入原来日志模块的位置（kernel:log 标记处）。\n' +
    '// 共存关系：旧文件只读、新文件派生，真搬迁或真删除旧文件另开票。重新生成：node scripts/derive-log-from-package.mts。\n'
  mkdirSync(dirname(CLIENT_OUT), { recursive: true })
  writeFileSync(CLIENT_OUT, header + body + tail, 'utf8')
  console.log('[derive-log] dist/client.js -> scripts/generated/logKernel.derived.js')
}

function main(): void {
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
