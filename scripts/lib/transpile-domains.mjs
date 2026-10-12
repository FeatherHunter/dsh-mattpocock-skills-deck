/**
 * 域构建：把 src/shared/<功能名>/ 里的 TypeScript 源码逐份转译成同目录同名的 .js。
 *
 * 一个域长这样，四样东西都在同一个目录里，目的就是「看一个目录就知道这块功能的全貌」：
 *
 *   src/shared/<功能名>/
 *     README.md        这个域是干什么的、内部怎么切、谁不许 import 谁
 *     tsconfig.json    这个域的类型检查配置
 *     src/*.ts         手写源码（唯一真源）
 *     *.js             构建产出（同名同目录并排，看目录就知道哪份有产物）
 *
 * 谁能写这些 .js：**只有构建**。这一条是本文件所有判断的前提——只要没有第二个写者，
 * 产物就不可能落后于源码；反过来，万一有人手工在域目录里留下一份追溯不到源码的 .js，
 * checkDomainConsistency 会把它当陈旧产物报出来（判据本身在 scripts/lib/transpile-unit.mjs）。
 *
 * 这个文件负责读盘写盘，算路径与判据的纯函数都在 scripts/lib/transpile-unit.mjs 里。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

import { TRANSPILE_OPTIONS, checkDomainConsistency, deriveOutputPath, domainDir, generatedHeader, inlineExportDeclarations } from './transpile-unit.mjs'

/** 仓库根：本文件在 scripts/lib/ 下，往上两层就是根。 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * 扫出 src/shared 下所有的域：**带 tsconfig.json 的子目录就算一个域**。
 *
 * 为什么这样认定：域目录里那四样东西中，只有 tsconfig.json 是「这个目录是一个域」的声明，
 * 它不会因为构建跑没跑而出现或消失。发布包里这四样只剩编译好的 .js，所以这条扫描在
 * 发布包的子树里自然得到空数组，不需要另外写一个「是不是发布包」的判断。
 */
export function findDomains() {
  const sharedDir = resolve(REPO_ROOT, 'src', 'shared')
  if (!existsSync(sharedDir)) return []
  const out = []
  for (const ent of readdirSync(sharedDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    if (existsSync(resolve(sharedDir, ent.name, 'tsconfig.json'))) out.push(ent.name)
  }
  return out.sort()
}

/**
 * 一个域的四个位置：源码目录、产物目录（同一个）、类型配置、日志里用的名字。
 *
 * 域名只在一个地方换算成路径：transpile-unit.mjs 的 domainDir()。这里调用它，
 * 不自己拼一遍，免得两处慢慢走岔。
 */
export function domainPaths(domain) {
  const rel = domainDir(domain)
  return {
    domain,
    relFromRoot: rel,
    absDir: resolve(REPO_ROOT, rel),
    absSources: resolve(REPO_ROOT, rel, 'src'),
    absTsconfig: resolve(REPO_ROOT, rel, 'tsconfig.json'),
  }
}

/**
 * 列出域里的源码文件名（不含 .d.ts，那是纯类型声明，没有可执行的产物）。
 *
 * 排序是为了让每次构建的日志次序固定：扫描出来的目录次序在有些文件系统上是不保证的，
 * 不排序的话同一棵树两次构建可能打出两种顺序的日志，排查时会被误导。
 */
export function listSources(absSources) {
  if (!existsSync(absSources)) return []
  return readdirSync(absSources, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts'))
    .map((e) => e.name)
    .sort()
}

/**
 * 列出域目录里的产物文件名。域目录里除了产物还住着手写源码、README 与 tsconfig，
 * 所以只认「本层的 .js」。
 */
function listOutputs(absDir) {
  return readdirSync(absDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => e.name)
    .sort()
}

/**
 * 跑一次这个域的 `tsc --noEmit`。
 *
 * 为什么构建里必须带这一步：类型检查不过就说明这份源码自己都没说圆，产物不该生成。
 * typescript 没装（没跑过 pnpm install）时明确报错，不静默跳过——静默跳过的后果是
 * 「本机构建绿、CI 红」这类最难查的故障。
 */
export function runTypeCheck(domain) {
  const p = domainPaths(domain)
  const require = createRequire(resolve(REPO_ROOT, 'package.json'))
  let tscBin
  try {
    tscBin = resolve(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
  } catch {
    throw new Error(`[${p.relFromRoot}] 找不到 typescript：请先运行 pnpm install（devDependencies 含 typescript）`)
  }
  const r = spawnSync(process.execPath, [tscBin, '-p', p.absTsconfig], { encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(`[${p.relFromRoot}] tsc --noEmit 未通过：\n${r.stdout || ''}${r.stderr || ''}`)
  }
  console.log(`[${p.relFromRoot}] tsc --noEmit 通过`)
}

/**
 * 从「src/shared/<域名>/src/x.ts」里取出域名。取不出来就抛错，不猜。
 */
export function domainFromSourcePath(sourcePath) {
  const m = /^src\/shared\/([^/]+)\/src\/[^/]+\.ts$/.exec(sourcePath.replace(/\\/g, '/'))
  if (!m) {
    throw new Error(`[transpile] 认不出这份源码属于哪个域：「${sourcePath}」（域目录的形状是 src/shared/<功能名>/src/，文件名以 .ts 结尾）`)
  }
  return m[1]
}

/**
 * 把一份源码转译成产物文本。参数是**仓库相对**的源码路径（如 `src/shared/refresh/src/budget.ts`），
 * 因为产物头部那句「真源在哪」必须带域路径，只给文件名写不出来。
 */
export function transpileUnit(sourcePath) {
  const domain = domainFromSourcePath(sourcePath)
  const require = createRequire(resolve(REPO_ROOT, 'package.json'))
  let esbuild
  try {
    esbuild = require('esbuild')
  } catch (e) {
    throw new Error(`[transpile] 没装 esbuild（先跑 pnpm install 再构建）：${(e && e.message) || e}`)
  }
  const source = readFileSync(resolve(REPO_ROOT, sourcePath), 'utf8')
  // 参数取自 scripts/lib/transpile-unit.mjs 的 TRANSPILE_OPTIONS：仓里所有逐文件转译共用同一份，
  // 客户端像素那一段也用这一份，两处不会各自漂移。
  const out = esbuild.transformSync(source, TRANSPILE_OPTIONS)
  const prefix = `[${domainDir(domain)}]`
  const normalized = out.code.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n'
  return generatedHeader(sourcePath) + inlineExportDeclarations(normalized, prefix)
}

/**
 * 构建一个域：先类型检查，再逐份转译写盘，最后按双向判据核对这棵域目录。
 *
 * 返回值里 why 说明这次这个域算不算数：
 *   - 'built'     正常构建完，written 是这次写下的产物（仓库相对路径）
 *   - 'no-source' 这个域没有源码目录。只在发布包与 package/ 子树里出现（那两处只有编译好的
 *                 .js，没有源码树），是预期情况，所以返回而不是抛错。
 *
 * 另外三种情况一律抛错，让构建当场红，而不是产出一棵「看起来没问题」的产物树：
 * 域里一份源码都没有、类型检查不过、双向判据发现问题。
 *
 * `handWritten` 是这个域里**手写**的产物文件名（没有同名源码、也不该被当成陈旧产物）。
 * 它由调用方按域给出，不由这里猜——猜会把「构建漏写了生成标记」这种真故障放过去。
 */
export function buildDomain(domain, { handWritten = [] } = {}) {
  const p = domainPaths(domain)
  if (!existsSync(p.absTsconfig)) {
    throw new Error(`[${p.relFromRoot}] 没有 tsconfig.json：这个目录不是一个域（域的认定见 findDomains）`)
  }
  if (!existsSync(p.absSources)) {
    console.log(`[${p.relFromRoot}] 没有源码目录（${p.relFromRoot}/src），跳过这个域的转译与类型检查。发布包与 package/ 子树里只有编译好的产物，这是预期情况；要重新生成产物请在仓库根目录跑 node scripts/build.mjs。`)
    return { domain, why: 'no-source', written: [] }
  }
  const sources = listSources(p.absSources)
  if (sources.length === 0) {
    throw new Error(`[${p.relFromRoot}] 源码目录 ${p.relFromRoot}/src 里一份 .ts 都没有：域里没源码说明源码被搬空或域目录指错了，构建停在这里。`)
  }

  runTypeCheck(domain)
  mkdirSync(p.absDir, { recursive: true })

  const written = []
  for (const tsName of sources) {
    const sourceRel = `${p.relFromRoot}/src/${tsName}`
    let text
    try {
      text = transpileUnit(sourceRel)
    } catch (e) {
      throw new Error(`[${p.relFromRoot}] 转译 ${tsName} 失败：${(e && e.message) || e}`)
    }
    // 产物写到哪，由那一份纯函数推（scripts/lib/transpile-unit.mjs 的 deriveOutputPath）：
    // 源码在 <域>/src/ 下，产物落在 <域>/ 表层、与手写产物并排。这里不自己拼一遍路径，
    // 免得两处慢慢走岔——规则只有一份实现，改也只改一处。
    const outRel = deriveOutputPath(sourceRel)
    writeFileSync(resolve(REPO_ROOT, outRel), text, 'utf8')
    console.log(`[${p.relFromRoot}] ${tsName} -> ${outRel}（${text.split('\n').length} 行）`)
    written.push(outRel)
  }

  const problems = checkDomainConsistency({ sources, outputs: listOutputs(p.absDir), handWritten })
  if (problems.length > 0) {
    throw new Error(
      `[${p.relFromRoot}] 域目录与源码对不上：\n` + problems.map((x) => '  - ' + x.detail).join('\n'),
    )
  }

  return { domain, why: 'built', written }
}
