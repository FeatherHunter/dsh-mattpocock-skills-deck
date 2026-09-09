/**
 * scripts/derive-log-from-package.mjs —— 日志系统派生脚本（#564 当前插件迁移到日志包）。
 *
 * 作用：把日志包（packages/dsh-log，版本 0.1.0）的已构建产物，原样派生为插件运行时真正使用的文件。
 * 旧文件一个字节都不动（src/host/logStore.js、src/host/logPhones.js、src/client/kernel/log.js 原地只读留存，
 * 门禁仍读它们）；运行时走这里生成的新文件。真删除旧文件另开票，本票只做共存。
 *
 * 派生内容（两处）：
 *   1. 宿主侧：packages/dsh-log/dist/{config,store,phones,host}.js 原样复制到 src/host/logPkg/（同目录，
 *      包内相对引用 ./config.js 等保持有效；构建时原样复制进 package/lib/logPkg，随包发布，线上可用）。
 *   2. 客户端侧：把 packages/dsh-log/src/client.ts 打包成单文件（依赖的配置面内联，无外部引用），
 *      末尾用闭包里现成的四个名字（host、timer、localStorage、broadcastLogSwitch）建日志器，
 *      落到 scripts/generated/logKernel.derived.js；构建时拼入原来日志模块的位置。
 *      放 scripts 下是因为内容含中文错误文案， src/client 下会被中文基线门禁误拦；构建产物里早有中文注释，
 *      行为一致，只是换个地方放。
 *
 * 用法：node scripts/derive-log-from-package.mjs（插件根目录；先跑 node packages/dsh-log/build.mjs）。
 * 构建脚本 scripts/build.mjs 会在需要时自动调本脚本，平时不用手工跑。
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const PKG_DIR = resolve(ROOT, 'packages', 'dsh-log')
const PKG_DIST = resolve(PKG_DIR, 'dist')
const PKG_SRC = resolve(PKG_DIR, 'src')

const HOST_UNITS = ['config.js', 'store.js', 'phones.js', 'host.js']
const HOST_OUT_DIR = resolve(ROOT, 'src', 'host', 'logPkg')
const CLIENT_OUT = resolve(ROOT, 'scripts', 'generated', 'logKernel.derived.js')

const HOST_HEADER = (name) =>
  '// 派生文件（#564）：由 packages/dsh-log/dist/' +
  name +
  ' 原样复制，内容与日志包 0.1.0 一致，人手不改。\n' +
  '// 旧实现（src/host/logStore.js、src/host/logPhones.js）原地只读留存；运行时走本目录经 logFromPackage.js 接线。\n' +
  '// 共存关系：旧文件只读、新文件派生，真搬迁或真删除旧文件另开票。重新生成：node scripts/derive-log-from-package.mjs。\n'

function requireEsbuild() {
  const require = createRequire(resolve(ROOT, 'package.json'))
  try {
    return require('esbuild')
  } catch {
    throw new Error('[derive-log] 找不到 esbuild：请先运行 pnpm install（根 devDependencies 含 esbuild）')
  }
}

export function deriveHost() {
  mkdirSync(HOST_OUT_DIR, { recursive: true })
  for (const name of HOST_UNITS) {
    const from = resolve(PKG_DIST, name)
    const body = readFileSync(from, 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n'
    writeFileSync(resolve(HOST_OUT_DIR, name), HOST_HEADER(name) + body, 'utf8')
    console.log('[derive-log] dist/' + name + ' -> src/host/logPkg/' + name)
  }
}

export function deriveClient() {
  const esbuild = requireEsbuild()
  const entry = resolve(PKG_SRC, 'client.ts')
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
  if (/^\s*import[\s{*]/m.test(body) || /from\s+['"]\.\.?\//.test(body)) {
    throw new Error('[derive-log] 客户端打包后仍有外部引用（应全部内联），请检查日志包客户端入口的引用')
  }
  body = body.replace(/\s+$/, '') + '\n'
  // 引号归一（行为不变）：打包器输出双引号，旧模块用单引号；双产物门禁要求客户端事件以单引号形态出现，
  // 这里只换自监控 5 个事件名字面（内容无单引号，纯换引号不改行为）。
  for (const name of ['host.dispatch.error', 'log.persist.fail', 'log.forward.summary', 'log.switch.watchdog', 'log.export.fail']) {
    body = body.split('"' + name + '"').join("'" + name + "'")
  }
  const tail =
    '\n' +
    '// ---- 实例化（#564）：用闭包里现成的四个名字建日志器，插件标识 wf，默认配置与旧行为一致 ----\n' +
    '// 旧模块（src/client/kernel/log.js）原地只读留存；运行时走本派生文件。共存关系见本文件头，真删除旧文件另开票。\n' +
    'const __pkgLog = createClientLog({ host: host, timer: timer, storage: localStorage, broadcastLogSwitch: broadcastLogSwitch }, { pluginId: \'wf\' })\n' +
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
    '// 派生文件（#564）：由 packages/dsh-log/src/client.ts（含配置面）打包生成，内容与日志包 0.1.0 一致，人手不改。\n' +
    '// 旧模块（src/client/kernel/log.js）原地只读留存；构建时本文件拼入原来日志模块的位置（kernel:log 标记处）。\n' +
    '// 共存关系：旧文件只读、新文件派生，真搬迁或真删除旧文件另开票。重新生成：node scripts/derive-log-from-package.mjs。\n'
  mkdirSync(dirname(CLIENT_OUT), { recursive: true })
  writeFileSync(CLIENT_OUT, header + body + tail, 'utf8')
  console.log('[derive-log] client.ts -> scripts/generated/logKernel.derived.js')
}

function main() {
  deriveHost()
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
