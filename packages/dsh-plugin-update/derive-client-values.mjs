#!/usr/bin/env node
/**
 * derive-client-values.mjs —— 从更新包生成「面板要用的取值」文件（集成文档第 3 节第 3 步的参考实现）。
 *
 * 为什么要有这个文件：面板里不该写死电话名（'notes.updateStatus' 这类字面量）与轮询间隔，
 * 否则换前缀、换间隔就得改多处、还容易改漏。取值只有更新包这一个来源，
 * 所以做法是：构建时把本包的客户端入口打包一次，把消费方自己的前缀代进去，
 * 在消费方仓库里生成一个小文件，里面是三个电话名与轮询间隔的常量，面板直接引用这些常量。
 *
 * 用法（在你自己的插件仓库里跑）：
 *   node node_modules/dsh-plugin-update/derive-client-values.mjs \
 *     --prefix notes \
 *     --out scripts/generated/updateClient.derived.js
 *
 * 参数：
 *   --prefix <前缀>   必填。你在宿主侧 createHostUpdate 里传的那个 prefix，两处必须一致。
 *   --out <文件路径>  必填。生成到哪里。故意不给默认值：默认值会覆盖别人的文件，写错更糟。
 *   --package <标识>  可选。写进生成文件的封面注释，方便以后认出来是谁生成的。默认取消费方 package.json 的 name。
 *   --dry-run         只打印要生成的内容，不写文件。
 *
 * 生成的形状（具体值随你的前缀）：
 *   export const UPD_STATUS  = 'notes.updateStatus'
 *   export const UPD_CHECK   = 'notes.updateCheck'
 *   export const UPD_INSTALL = 'notes.updateInstall'
 *   export const UPD_POLL    = 1000
 *   export const UPD_POLL_MIN = 250
 *
 * 依赖说明：本脚本用 esbuild 只做「打包一次」这件事，不引入任何运行期依赖。
 * esbuild 优先从本包自己的 node_modules 找；找不到再从你的仓库里找（你自己的 devDependencies 里有也行）。
 * 两个地方都没有时打印一句明确的安装提示，不静默失败。
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_DIR = dirname(fileURLToPath(import.meta.url))
const PKG_MANIFEST = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'))

function usage(message) {
  if (message) console.error('错误：' + message)
  console.error('用法：node ' + join(PKG_DIR.split(/[\\/]/).pop(), 'derive-client-values.mjs') + ' --prefix <前缀> --out <文件路径> [--package <标识>] [--dry-run]')
  process.exit(2)
}

// ---------- 参数 ----------
let prefix = ''
let outFile = ''
let consumerName = ''
let dryRun = false
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  if (arg === '--prefix') { prefix = argv[++i] || '' }
  else if (arg === '--out') { outFile = argv[++i] || '' }
  else if (arg === '--package') { consumerName = argv[++i] || '' }
  else if (arg === '--dry-run') { dryRun = true }
  else if (arg === '-h' || arg === '--help') { usage('') }
  else { usage('不认识的参数 ' + arg) }
}
if (!prefix) usage('必须给 --prefix（要与宿主侧 createHostUpdate 的 prefix 一致）')
if (!outFile) usage('必须给 --out（生成到哪里；故意不给默认值，免得覆盖别人的文件）')
if (!/^[A-Za-z0-9_.-]+$/.test(prefix)) usage('--prefix 只允许字母、数字、下划线、点与短横（电话名是「前缀.动作名」，前缀里不该有别的字符）')
if (prefix.includes('.')) usage('--prefix 不能含点：点留作前缀与动作名之间的分隔符')

// ---------- 找 esbuild ----------
function loadEsbuild() {
  const candidates = [join(PKG_DIR, 'package.json'), join(process.cwd(), 'package.json')]
  for (const from of candidates) {
    if (!existsSync(from)) continue
    try {
      const require = createRequire(from)
      return require('esbuild')
    } catch {
      // 换下一个候选位置
    }
  }
  console.error('错误：找不到 esbuild（本脚本用它把客户端入口打包一次，只做构建期使用，不引入运行期依赖）。')
  console.error('修法：在你自己的插件仓库里装一次开发依赖 ——  npm install --save-dev esbuild')
  process.exit(1)
}

// ---------- 打包客户端入口 ----------
const esbuild = loadEsbuild()
const entry = join(PKG_DIR, 'src', 'client.ts')
const sourceOfTruth = existsSync(entry) ? entry : join(PKG_DIR, 'dist', 'client.js')
if (!existsSync(sourceOfTruth)) {
  console.error('错误：包里既没有 src/client.ts 也没有 dist/client.js，包可能不完整（重装一次试试）。')
  process.exit(1)
}

let built
try {
  built = esbuild.buildSync({
    entryPoints: [sourceOfTruth],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2020',
    write: false,
  })
} catch (error) {
  console.error('错误：打包客户端入口失败：' + ((error && error.message) || error))
  process.exit(1)
}
if (!built.outputFiles || built.outputFiles.length !== 1) {
  console.error('错误：打包产物数量不对（期望恰好 1 个文件），包可能不完整。')
  process.exit(1)
}

let body = Buffer.from(built.outputFiles[0].contents).toString('utf8').replace(/\r\n/g, '\n')
// 注释里的路径归一：不同目录重跑时打包器会写出相对路径形态，统一成包名开头，保证消费方重跑零差异。
body = body.replace(/^\/\/ (\.\.\/)+packages\//gm, '// packages/')

// 打包器收尾会写一个模块级的 `export { ... };` 块。那个块拼进插件主文件闭包是语法错误
// （闭包里只能是声明），所以拆掉它；被改名导出的符号在下面补回本名。
const exportBlock = body.match(/export\s*\{([\s\S]*?)\}\s*;?\s*$/)
const aliases = []
if (exportBlock) {
  for (const item of exportBlock[1].split(',')) {
    const piece = item.trim()
    if (!piece) continue
    const alias = piece.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
    if (alias && alias[1] !== alias[2]) aliases.push(alias)
  }
  body = body.slice(0, exportBlock.index)
}
body = body.replace(/\s+$/, '') + '\n'

// ---------- 组装 ----------
const who = consumerName || (function () {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).name || '（未指明）'
  } catch {
    return '（未指明）'
  }
})()

const header =
  '// 由 ' + PKG_MANIFEST.name + '@' + PKG_MANIFEST.version + ' 的集成工具生成，人手不改。\n' +
  '// 生成命令：node ' + PKG_MANIFEST.name + '/derive-client-values.mjs --prefix ' + prefix + ' --out <本文件路径>\n' +
  '// 生成对象：' + who + '。改了前缀或想升级本包，重新跑一次这条命令即可。\n'

const aliasExports = aliases.map(([local, name]) => 'export const ' + name + ' = ' + local + '\n').join('')

const tail =
  '\n// ---- 取值：从更新包的客户端入口算出本插件要用的电话名与轮询间隔 ----\n' +
  '// 面板只该用下面这几个常量，不要再写死电话名字面量与轮询数字。\n' +
  'const UPD_PHONE_NAMES = buildClientPhoneNames(' + JSON.stringify(prefix) + ')\n' +
  'const UPD_POLL_MS = CLIENT_POLL.defaultMs\n' +
  'const UPD_POLL_MIN_MS = CLIENT_POLL.minMs\n' +
  'export const UPD_STATUS = UPD_PHONE_NAMES.updateStatus\n' +
  'export const UPD_CHECK = UPD_PHONE_NAMES.updateCheck\n' +
  'export const UPD_INSTALL = UPD_PHONE_NAMES.updateInstall\n' +
  'export const UPD_POLL = UPD_POLL_MS\n' +
  'export const UPD_POLL_MIN = UPD_POLL_MIN_MS\n'

const output = header + body + aliasExports + tail

if (dryRun) {
  process.stdout.write(output)
  process.exit(0)
}

const target = isAbsolute(outFile) ? outFile : resolve(process.cwd(), outFile)
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, output, 'utf8')
console.log('已生成：' + target)
console.log('  前缀 ' + prefix + ' → 电话名 ' + ['updateStatus', 'updateCheck', 'updateInstall'].map((a) => prefix + '.' + a).join('、') + '，轮询 ' + 1000 + ' 毫秒')
console.log('  面板里请引用 UPD_STATUS / UPD_CHECK / UPD_INSTALL / UPD_POLL，不要再写字面量。')
