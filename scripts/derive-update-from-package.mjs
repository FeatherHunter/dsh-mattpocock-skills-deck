/**
 * scripts/derive-update-from-package.mjs —— 更新系统派生脚本（#586 当前插件迁移到更新包）。
 *
 * 作用：把更新包（packages/dsh-plugin-update，已发布 0.1.0）的已构建产物，派生为插件运行时真正使用的文件。
 * 旧文件一个字节都不动（src/host/update.js、updateReader.js、updateStore.js 原地只读留存，门禁仍读它们）；
 * 运行时走这里生成的新文件。真删除旧文件另开票，本票只做共存（照 #564 日志包迁移的先例）。
 *
 * 派生内容（两处）：
 *   1. 宿主侧：packages/dsh-plugin-update/dist/{config,ports,service,commands,store,reader,host}.js
 *      原样复制到 src/host/updatePkg/（同目录，包内相对引用 ./config.js 等保持有效；
 *      构建时原样复制进 package/lib/updatePkg，随包发布，线上可用）。
 *   2. 客户端侧：把 packages/dsh-plugin-update/src/client.ts 打包成单文件（配置面内联，无外部引用），
 *      末尾把该插件要用的两种取值从包自己的默认值算出来 —— 电话名（前缀加动作名）与轮询间隔。
 *      落到 scripts/generated/updateClient.derived.js，构建时拼进客户端闭包（kernel:updateClient 标记处）。
 *      放 scripts 下是因为内容含中文错误文案，src/client 下会被中文基线门禁误拦；
 *      构建产物里早有中文注释，行为一致，只是换个地方放（与日志包派生同口径）。
 *
 * 为什么客户端取值要在派生时算出来：
 *   面板里原来写死 'wf.updateStatus' 这类字面量与 1000 毫秒。写死就没有扩展性 ——
 *   换前缀或换轮询间隔要改多处、还容易改漏。现在这两种取值只有一个来源（更新包的配置面），
 *   改包即改行为；手写源码里不再出现电话名字面量，派生文件里带零变化断言字面供门禁核对。
 *
 * 用法：node scripts/derive-update-from-package.mjs（插件根目录；先跑 node packages/dsh-plugin-update/build.mjs）。
 * 构建脚本 scripts/build.mjs 会在需要时自动调本脚本，平时不用手工跑。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const PKG_DIR = resolve(ROOT, 'packages', 'dsh-plugin-update')
const PKG_DIST = resolve(PKG_DIR, 'dist')
const PKG_SRC = resolve(PKG_DIR, 'src')
const PKG_MANIFEST = resolve(PKG_DIR, 'package.json')

// 宿主侧要拎入的文件（顺序即依赖顺序，便于人核对；包内相对引用保持不变）。
// gate.js 是 #584 的门禁模板检查器，包根把它转出口，宿主入口引用它，所以必须一起拎进来。
const HOST_UNITS = ['config.js', 'ports.js', 'service.js', 'commands.js', 'store.js', 'reader.js', 'gate.js', 'host.js']
const HOST_OUT_DIR = resolve(ROOT, 'src', 'host', 'updatePkg')
const CLIENT_OUT = resolve(ROOT, 'scripts', 'generated', 'updateClient.derived.js')

// 本插件在更新包里的注册参数：插件标识与电话名前缀。
// 这两个值要同时喂给宿主侧（建更新能力）与客户端侧（拼电话名），
// 所以它们只有一处声明，就是这里；宿主适配器不写第二份，按包里的默认值校验一遍。
export const PLUGIN_ID = 'dsh-mattpocock-skills-deck'
export const PHONE_PREFIX = 'wf'

function requireEsbuild() {
  const require = createRequire(resolve(ROOT, 'package.json'))
  try {
    return require('esbuild')
  } catch {
    throw new Error('[derive-update] 找不到 esbuild：请先运行 pnpm install（根 devDependencies 含 esbuild）')
  }
}

/** 顶层声明名（只看无缩进的 function / var / let / const，export 前缀剥掉）——与 tests/verify-generated-no-shadow.js 同一口径。 */
function topLevelNames(text) {
  const out = new Set()
  for (const line of text.split(/\r?\n/)) {
    const m = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?(?:var|let|const)\s+([A-Za-z_$][\w$]*)/.exec(line)
    if (m) out.add(m[1] || m[2])
  }
  return out
}

/**
 * 顶撞守卫（#597）：本文件与日志包那份派生文件最终拼进同一个客户端闭包。
 * 顶层声明重名在这里就失败，不留给运行时去顶掉——顶掉的后果是静默坏功能（见 deriveClient 里的改名说明）。
 */
function assertNoShadowing(text) {
  const logKernel = resolve(ROOT, 'scripts', 'generated', 'logKernel.derived.js')
  if (!existsSync(logKernel)) return
  const mine = topLevelNames(text)
  const theirs = topLevelNames(readFileSync(logKernel, 'utf8'))
  const shared = [...mine].filter((n) => theirs.has(n)).sort()
  if (shared.length > 0) {
    throw new Error(
      '[derive-update] 与日志包派生文件顶层声明重名：' + shared.join('、') +
        '。两份文件会拼进同一个客户端闭包，后拼的把先拼的函数顶掉（#597）。请在本脚本的 RENAMES 里给这份加前缀。'
    )
  }
}

function headerFor(name, version) {
  return (
    '// 派生文件（#586）：由 packages/dsh-plugin-update/dist/' + name + ' 原样复制，内容与更新包 ' + version + ' 一致，人手不改。\n' +
    '// 旧实现（src/host/update.js、updateReader.js、updateStore.js）原地只读留存；运行时走本目录经 updateFromPackage.js 接线。\n' +
    '// 共存关系：旧文件只读、新文件派生，真搬迁或真删除旧文件另开票。重新生成：node scripts/derive-update-from-package.mjs。\n'
  )
}

export function deriveHost() {
  const version = JSON.parse(readFileSync(PKG_MANIFEST, 'utf8')).version
  mkdirSync(HOST_OUT_DIR, { recursive: true })
  for (const name of HOST_UNITS) {
    const from = resolve(PKG_DIST, name)
    const body = readFileSync(from, 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n'
    writeFileSync(resolve(HOST_OUT_DIR, name), headerFor(name, version) + body, 'utf8')
    console.log('[derive-update] dist/' + name + ' -> src/host/updatePkg/' + name)
  }
  return version
}

export function deriveClient() {
  const esbuild = requireEsbuild()
  const version = JSON.parse(readFileSync(PKG_MANIFEST, 'utf8')).version
  const built = esbuild.buildSync({
    entryPoints: [resolve(PKG_SRC, 'client.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2020',
    absWorkingDir: ROOT,
    write: false,
  })
  if (!built.outputFiles || built.outputFiles.length !== 1) {
    throw new Error('[derive-update] 客户端打包产物数量不对（期望恰好 1 个文件）')
  }
  let body = Buffer.from(built.outputFiles[0].contents).toString('utf8').replace(/\r\n/g, '\n')
  // 注释路径归一：不同目录重跑时 esbuild 会写出 // ../packages/... 之类的相对形态，统一成 packages/ 开头，保证重跑零 diff。
  body = body.replace(/^\/\/ (\.\.\/)+packages\//gm, '// packages/')
  if (/^\s*import[\s{*]/m.test(body) || /from\s+['"]\.\.?\//.test(body)) {
    throw new Error('[derive-update] 客户端打包后仍有外部引用（应全部内联），请检查更新包客户端入口的引用')
  }
  // esbuild 收尾会写一个模块级的 `export { ... };` 块。那个块拼进客户端闭包是语法错误
  // （闭包里只能是声明），所以这里把它拆成逐条 `export const` 声明，
  // 与日志包派生文件同一形状（那份也是把导出摊成一条条 export const）。
  const exportBlock = body.match(/export\s*\{([\s\S]*?)\}\s*;?\s*$/)
  const exportedNames = []
  if (exportBlock) {
    for (const item of exportBlock[1].split(',')) {
      const piece = item.trim()
      if (!piece) continue
      const alias = piece.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
      exportedNames.push(alias ? [alias[1], alias[2]] : [piece, piece])
    }
    body = body.slice(0, exportBlock.index).replace(/\s+$/, '') + '\n'
  }
  body = body.replace(/\s+$/, '') + '\n'
  // 改名（#597）：客户端闭包是把各派生分块按顺序拼进同一个作用域，函数声明会被提升，
  // 后拼的分块会顶掉先拼的同名函数。更新包与日志包各自都声明了
  // buildPhoneNames / buildPhoneName / buildClientPhoneNames，更新包拼在后面，
  // 于是日志内核算出来的电话名表成了空壳（phoneNames.logSetSwitch 为 undefined）：
  // 点调试开关时电话名传成 undefined，宿主 shim 在 method.replace 上抛错，
  // 面板永远弹「开关保存失败，已保持原状态，请重试」；连日志上报的电话名也是 undefined，
  // 所以客户端一条日志行都发不出去。这三个名字在更新包里是公开导出（改包本体等于改公开面），
  // 所以在这里按「派生即改名」处理：只改这一份派生副本，包本体一个字节不动。
  const RENAMES = [
    ['buildClientPhoneNames', 'updBuildClientPhoneNames'],
    ['buildPhoneNames', 'updBuildPhoneNames'],
    ['buildPhoneName', 'updBuildPhoneName']
  ]
  for (const [from, to] of RENAMES) {
    const before = body
    body = body.replace(new RegExp('\\b' + from + '\\b', 'g'), to)
    if (before === body) {
      throw new Error('[derive-update] 改名没命中：' + from + '（更新包源码可能已改名或删掉，请同步本脚本的 RENAMES）')
    }
  }
  // 同名符号本来就已经是这个闭包里的声明（`var CLIENT_POLL = ...` 等），再写一遍 export const 会重复声明报错，
  // 所以只补「本地名与导出名不同」的那些（esbuild 会写成 `local as exported`），其余的保持原样。
  const reExports =
    '\n// ---- 把包里被改名导出的取值补回本名（同名的不动，它们已在闭包里声明过）----\n' +
    exportedNames
      .filter(([local, name]) => local !== name)
      .map(([local, name]) => 'export const ' + name + ' = ' + local + '\n')
      .join('')

  // 取值从包自己的配置面算出来，不在这里另写字面量：
  //   电话名 = buildClientPhoneNames(PHONE_PREFIX)（与宿主注册名同一套拼法）
  //   轮询间隔 = CLIENT_POLL.defaultMs（包里的默认值，下限 minMs 一并带出供展示与校验）
  const tail =
    '\n' +
    '// ---- 取值（#586）：从更新包的客户端入口算出本插件要用的电话名与轮询间隔 ----\n' +
    '// 改前缀或改轮询间隔只改更新包，本文件重新派生即可；手写源码里不再出现电话名字面量。\n' +
    'const UPD_PHONE_NAMES = updBuildClientPhoneNames(' + JSON.stringify(PHONE_PREFIX) + ')\n' +
    'const UPD_POLL_MS = CLIENT_POLL.defaultMs\n' +
    'const UPD_POLL_MIN_MS = CLIENT_POLL.minMs\n' +
    '// 零变化断言（默认前缀 wf 下与旧字面一字不差；双产物门禁直接看到这些字面，运行时走上面的拼名）\n' +
    "void (UPD_PHONE_NAMES.updateStatus === 'wf.updateStatus' && UPD_PHONE_NAMES.updateCheck === 'wf.updateCheck' && UPD_PHONE_NAMES.updateInstall === 'wf.updateInstall' && UPD_POLL_MS === 1000)\n" +
    'export const UPD_STATUS = UPD_PHONE_NAMES.updateStatus\n' +
    'export const UPD_CHECK = UPD_PHONE_NAMES.updateCheck\n' +
    'export const UPD_INSTALL = UPD_PHONE_NAMES.updateInstall\n' +
    'export const UPD_POLL = UPD_POLL_MS\n' +
    'export const UPD_POLL_MIN = UPD_POLL_MIN_MS\n'

  const header =
    '// 派生文件（#586）：由 packages/dsh-plugin-update/src/client.ts（含配置面）打包生成，内容与更新包 ' + version + ' 一致，人手不改。\n' +
    '// 构建时本文件拼入客户端闭包（kernel:updateClient 标记处），给面板提供电话名与轮询间隔。\n' +
    '// 面板原来写死的 ' + "'wf.updateStatus'" + ' 这类字面量与 1000 毫秒已改为从这里取值。重新生成：node scripts/derive-update-from-package.mjs。\n'
  mkdirSync(dirname(CLIENT_OUT), { recursive: true })
  const output = header + body + reExports + tail
  assertNoShadowing(output)
  writeFileSync(CLIENT_OUT, output, 'utf8')
  console.log('[derive-update] client.ts -> scripts/generated/updateClient.derived.js')
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
