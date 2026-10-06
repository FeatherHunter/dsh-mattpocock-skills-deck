/**
 * scripts/bundle-update-entry.mjs —— 入口件与面板的浏览器绑定包（地图 #873 落地票 #876）。
 *
 * 作用：把已安装更新包里的入口件（含它内部打开的更新面板 dialog 形态）打成一个自包含的立即执行包，
 * 落到 scripts/generated/updateEntryPanel.bundle.js，构建时拼进客户端闭包。
 * 面板里不再写电话名字面量与轮询间隔：入口件内部从前缀算电话名、用包默认轮询间隔；
 * 关闭走入口件的完整关闭（收 dialog 加还原按钮加重新读一次状态），轮询收尾只停轮询，
 * 安装在宿主侧继续跑，重开面板立刻重新读取状态，1 秒内恢复显示。
 *
 * 摆法按人已确认的定案（2026-10-06）：按钮用包的默认摆法，不传尺寸覆盖；
 * 弹窗用包的 dialog 原样，不传关闭与重启接线，不做语言接入与尺寸对齐等附加项；
 * 皮肤由下一张主题票（#877）切档案卷，本票不传皮肤参数，走包默认皮肤。
 *
 * 数据源与派生脚本同一处：已安装的更新包（node_modules 里那份 0.7.x），不读本地包目录。
 * 用法：node scripts/bundle-update-entry.mjs（插件根目录）；构建脚本会自动调它，平时不用手工跑。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const BUNDLE_OUT = resolve(ROOT, 'scripts', 'generated', 'updateEntryPanel.bundle.js')

/** 全局挂载名：拼进客户端闭包后的唯一顶层变量，叶子挂载组件读它。 */
export const BUNDLE_GLOBAL = '__DshUpdateEntry'

function installedUpdateDir() {
  try {
    const require = createRequire(resolve(ROOT, 'package.json'))
    const manifestPath = require.resolve('dsh-plugin-update/package.json')
    return dirname(manifestPath)
  } catch {
    const fallback = resolve(ROOT, 'node_modules', 'dsh-plugin-update')
    if (existsSync(join(fallback, 'package.json'))) return fallback
    throw new Error('[bundle-update-entry] 找不到已安装的更新包：请先运行 pnpm install（依赖 dsh-plugin-update@^0.7.0）')
  }
}

function installedUpdateVersion() {
  const dir = installedUpdateDir()
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version
}

export async function bundleEntryPanel() {
  const pkgDir = installedUpdateDir()
  const version = installedUpdateVersion()
  const entryFile = join(pkgDir, 'dist', 'entry.js')
  if (!existsSync(entryFile)) {
    throw new Error('[bundle-update-entry] 已安装的更新包里没有入口件产物（' + entryFile + '）：请确认装的是 0.7.x，重装一次试试')
  }
  const esbuild = await import('esbuild')
  if (typeof esbuild.build !== 'function') throw new Error('[bundle-update-entry] 读不到 esbuild 的打包入口')
  const result = await esbuild.build({
    entryPoints: [entryFile],
    bundle: true,
    format: 'iife',
    globalName: BUNDLE_GLOBAL,
    platform: 'browser',
    target: 'es2020',
    minify: false,
    write: false,
  })
  const out = result && result.outputFiles && result.outputFiles[0] ? result.outputFiles[0].text : null
  if (typeof out !== 'string' || !out.includes('mountUpdateEntry')) {
    throw new Error('[bundle-update-entry] 打包产物里找不到入口件挂载函数（mountUpdateEntry），包可能不完整')
  }
  const head = '// 由 dsh-plugin-update@' + version + ' 的入口件产物打成浏览器绑定包，人手不改。\n// 来源：已安装更新包的 dist/entry.js（含内部 dialog 面板）；摆法与关闭轮询约定全部走包默认。\n'
  mkdirSync(dirname(BUNDLE_OUT), { recursive: true })
  writeFileSync(BUNDLE_OUT, head + out.replace(/\s+$/, '') + '\n', 'utf8')
  console.log('[bundle-update-entry] 入口件绑定包：' + pkgDir + ' (' + version + ') -> scripts/generated/updateEntryPanel.bundle.js')
  return version
}

function main() {
  // esbuild 的 buildSync 存在时走同步，方便构建脚本直接调；没有则走异步。
  try {
    const esbuildRequire = createRequire(resolve(ROOT, 'package.json'))
    const esbuild = esbuildRequire('esbuild')
    if (esbuild && typeof esbuild.buildSync === 'function') {
      bundleEntryPanelSync(esbuild)
      return
    }
  } catch {}
  bundleEntryPanel().catch((e) => {
    console.error((e && e.message) || e)
    process.exit(1)
  })
}

function bundleEntryPanelSync(esbuild) {
  const pkgDir = installedUpdateDir()
  const version = installedUpdateVersion()
  const entryFile = join(pkgDir, 'dist', 'entry.js')
  const result = esbuild.buildSync({
    entryPoints: [entryFile],
    bundle: true,
    format: 'iife',
    globalName: BUNDLE_GLOBAL,
    platform: 'browser',
    target: 'es2020',
    minify: false,
    write: false,
  })
  const out = result && result.outputFiles && result.outputFiles[0] ? result.outputFiles[0].text : null
  if (typeof out !== 'string' || !out.includes('mountUpdateEntry')) {
    throw new Error('[bundle-update-entry] 打包产物里找不到入口件挂载函数（mountUpdateEntry），包可能不完整')
  }
  const head = '// 由 dsh-plugin-update@' + version + ' 的入口件产物打成浏览器绑定包，人手不改。\n// 来源：已安装更新包的 dist/entry.js（含内部 dialog 面板）；摆法与关闭轮询约定全部走包默认。\n'
  mkdirSync(dirname(BUNDLE_OUT), { recursive: true })
  writeFileSync(BUNDLE_OUT, head + out.replace(/\s+$/, '') + '\n', 'utf8')
  console.log('[bundle-update-entry] 入口件绑定包：' + pkgDir + ' (' + version + ') -> scripts/generated/updateEntryPanel.bundle.js')
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
