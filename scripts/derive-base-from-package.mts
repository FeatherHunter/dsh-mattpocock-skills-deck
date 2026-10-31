/**
 * scripts/derive-base-from-package.mts —— base 包客户端内联派生（base 包接入）。
 *
 * 作用：把已安装的 dsh-featherhunter-plugin-base@<版本> 的客户端产物
 *   （node_modules/dsh-featherhunter-plugin-base/dist/client/index.js，包自己就是自包含单文件：
 *   顶层无 import/require，React 由宿主传入）原样内联成 scripts/generated/baseClient.derived.js，
 *   构建时拼进客户端闭包（src/client/index.ts 的 kernel:baseClient 标记处）。
 *   不引打包器：包已经构建好，这里直接读文件、剥 export 块、包一层 IIFE 即可；重跑必须零 diff。
 *
 * 为什么包 IIFE：base 产物顶层有 createBaseUI / ensureBaseStyles 与一堆内部常量，
 *   拼进插件闭包后与其它分块同处一个函数作用域，直接摊开会撞名（tests/verify-generated-no-shadow.ts
 *   守这条）。包进 IIFE 后只对外 surfacing 两个名字：__baseCreateUI / __baseEnsureStyles。
 *
 * 保留产物首行的 legal comment 横幅（dsh-featherhunter-plugin-base vX.Y.Z）：
 *   doctor 的 inline-bundle-version 检查靠它核对「内联的版本 == 安装的版本」，别删。
 *
 * 用法：node scripts/derive-base-from-package.mts（仓库根目录；要求 pnpm install 已装好 base 包）。
 *   scripts/build.mts 每次构建都会调本脚本；重跑零 diff，平时不用手工跑。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const PKG_NAME = 'dsh-featherhunter-plugin-base'
const CLIENT_OUT = resolve(ROOT, 'scripts', 'generated', 'baseClient.derived.js')

// 已安装包目录：优先经开放的 ./package.json 子路径定位；万一将来不再开放，退回经 ./client 入口
// （dist/client/index.js）上两级反推，与 derive-log-from-package.mts 的做法一致。
function resolveInstalledPkgDir(): string {
  const require = createRequire(resolve(ROOT, 'package.json'))
  try {
    return dirname(require.resolve(PKG_NAME + '/package.json'))
  } catch {
    const entry = require.resolve(PKG_NAME + '/client')
    return dirname(dirname(entry))
  }
}

function installedVersion(): string {
  const pkgJson = JSON.parse(readFileSync(resolve(resolveInstalledPkgDir(), 'package.json'), 'utf8'))
  if (!pkgJson || typeof pkgJson.version !== 'string' || !pkgJson.version) {
    throw new Error('[derive-base] 读不出已安装的 ' + PKG_NAME + ' 版本号（package.json 缺 version）')
  }
  return pkgJson.version
}

/** 逐行数反引号：有奇数个反引号的行说明存在跨行模板字符串，整段缩进会改字符串内容。 */
function assertNoMultilineTemplate(body: string): void {
  const lines: string[] = body.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const count: number = (lines[i].match(/`/g) || []).length
    if (count % 2 === 1) {
      throw new Error(
        '[derive-base] base 客户端产物第 ' + (i + 1) + ' 行出现奇数个反引号（跨行模板字符串）；' +
          '整段缩进会改字符串内容，请先看产物再改本脚本的包装方式'
      )
    }
  }
}

export function deriveBaseClient(): void {
  const pkgDir: string = resolveInstalledPkgDir()
  const version: string = installedVersion()
  const entry: string = resolve(pkgDir, 'dist', 'client', 'index.js')
  if (!existsSync(entry)) {
    throw new Error('[derive-base] 找不到 ' + PKG_NAME + ' 的客户端产物：' + entry + '（先确认包装完整）')
  }
  let body: string = readFileSync(entry, 'utf8').replace(/\r\n/g, '\n')

  // ---- 早失败哨兵：内联依赖的产物形态（缺谁当场列出来，别把错位留到运行时） ----
  const firstLine: string = body.split('\n')[0]
  const banner: string = '/*! ' + PKG_NAME + ' v' + version + ' */'
  if (!firstLine.includes(banner)) {
    throw new Error('[derive-base] 产物首行缺少版本横幅 ' + banner + '（实际首行：' + firstLine.slice(0, 120) + '）')
  }
  for (const name of ['createBaseUI', 'ensureBaseStyles']) {
    if (!new RegExp('(?:function|var|let|const)\\s+' + name + '\\b').test(body)) {
      throw new Error('[derive-base] 包体里找不到要 surfacing 的名字 ' + name + '（包改名或改形态时请连本脚本与 SettingsPage 一起改）')
    }
  }
  if (/^\s*import[\s{*]/m.test(body) || /from\s+['"]\.\.?\//.test(body)) {
    throw new Error('[derive-base] 客户端产物里还有外部引用（应自包含单文件），请先看包的构建产物')
  }
  const exportBlocks: RegExpMatchArray | null = body.match(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm)
  if (!exportBlocks || exportBlocks.length !== 1) {
    throw new Error('[derive-base] 客户端产物的 export 块数量不是恰好 1 个（实际 ' + (exportBlocks ? exportBlocks.length : 0) + ' 个），请先看产物再改这处处理')
  }
  assertNoMultilineTemplate(body)

  // 剥掉唯一的 export 块（只去这个列表，不动声明本身）：拼进客户端闭包后不能有行首 export。
  body = body.replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '')
  if (/^\s*export\s+/m.test(body)) {
    throw new Error('[derive-base] 剥完 export 块后仍有残留 export 行（多块或行内 export 的新形态），请先看产物')
  }

  // 缩进 2 格后包进 IIFE：顶层只留 __basePkgScope / __baseCreateUI / __baseEnsureStyles 三个名字，
  // 内部声明全部藏进闭包；两个 surfacing 名字是 SettingsPage 要用的组件工厂与样式注入。
  const SURFACED: string[] = ['createBaseUI', 'ensureBaseStyles']
  body =
    '// ---- 作用域隔离：包体顶层声明包进 IIFE 藏起来，只留两个外面要用的 ----\n' +
    'const __basePkgScope = (() => {\n' +
    body.split('\n').map((l: string): string => (l.length ? '  ' + l : l)).join('\n') +
    '  return { ' + SURFACED.map((n: string): string => n + ': ' + n).join(', ') + ' };\n' +
    '})();\n' +
    'const __baseCreateUI = __basePkgScope.createBaseUI;\n' +
    'const __baseEnsureStyles = __basePkgScope.ensureBaseStyles;\n'

  const header =
    '// 派生文件（base 包接入）：由已安装的 ' + PKG_NAME + '@' + version + ' 的 dist/client/index.js 内联生成，内容与安装版本一致，人手不改。\n' +
    '// 构建时拼入客户端闭包（src/client/index.ts 的 kernel:baseClient 标记处）；首行保留包的版本横幅供 doctor 的 inline-bundle-version 核对。\n' +
    '// 重新生成：node scripts/derive-base-from-package.mts（重跑零 diff）。\n'

  const out: string = header + body
  if (!out.includes(banner)) {
    throw new Error('[derive-base] 生成结果里丢了版本横幅 ' + banner + '（doctor 的 inline-bundle-version 会红）')
  }
  mkdirSync(dirname(CLIENT_OUT), { recursive: true })
  writeFileSync(CLIENT_OUT, out, 'utf8')
  console.log('[derive-base] ' + PKG_NAME + '@' + version + ' dist/client/index.js -> scripts/generated/baseClient.derived.js')
}

function main(): void {
  deriveBaseClient()
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) {
  try {
    main()
  } catch (e) {
    console.error((e && (e as Error).message) || e)
    process.exit(1)
  }
}
