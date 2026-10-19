// 迁移说明（#1252）：本文件由 scripts/ts-hook.mjs 转写为 scripts/ts-hook.mts，只加类型注解，运行时行为零变化。
// scripts/ts-hook.mts —— 让源码里写的 "./x.js" 说明符优先解析到同名的 "./x.ts"（#1252 由同名 .mjs 转写而来）。
//
// 为什么要有它：旧测试与旧源码是「按单元分批」从 .js 转成 .ts 的。一个文件改名之后，
// 所有引用它的地方还写着 "./x.js"；这个钩子把这类说明符改指同名 .ts，引用点就一个字都不用改
// （这正是四个核搬家的前提：几十处 "../shared/<名>/x.js" 靠同名解析落到 .ts）。
//
// 为什么用同步的 registerHooks 而不是异步的 register：同步钩子同时管 ESM 的 import 与
// CommonJS 的 require，异步的 register() 管不到 require。同步的这个 API 从 Node 22.15 才有，
// 但 22.15 不等于能跑——测试加载 .ts 还要求 Node 默认开启类型剥离（22.18 起），再往上还有
// 依赖自己的版本范围。所以下限以根 package.json 的 engines.node 为准（那一处数字怎么来的，
// 见 AGENTS.md「测试怎么直接加载 .ts」一节）。
//
// 用法（把它挂在要跑的那个脚本前面）：
//   node --import ./scripts/ts-hook.mts tests/xxx.ts
//
// 约定一：只改写以 "./"、"../"、"file:" 开头或本身就是绝对路径（"D:\a\b.js"、"/a/b.js"）
// 且以 ".js" 结尾的说明符；裸包名（如 'dsh-log/host'）与其它后缀一律不碰。
// 绝对路径那一条不能省：测试里有 require(path.join(ROOT, 'src/.../x.js')) 这种写法，
// 等到那个文件转成 .ts 就会以「找不到模块」炸掉，而它绕不过同名解析。
//
// 约定二：目标落在 node_modules 里就不改写。同名优先是我们自己源码的约定，
// 不该拿去改写第三方包内部的解析——哪天某个包同时发了 .js 和 .ts，优先加载源码是它自己的事。
//
// 两条约定都不改变「没迁移的文件行为与今天完全一样」：同名 .ts 不存在时原样交给 Node。
// 约定三（2026-10-19 第三阶段）：域产物搬出源码树之后，源码树里只剩 `<域>/src/*.ts`，
// 而说明符仍写着 "src/shared/<域>/<名>.js"。同目录同名 .ts 找不到时，再试一次
// 「<目标所在目录>/src/<同名>.ts」——这正是域源码的形状，测试与 host 源码里的说明符一个都不用改。
import { existsSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerHooks } from 'node:module'

// 能力检测：旧 Node 上 registerHooks 根本不存在，直接调用会抛一句难懂的 TypeError。
// 这里换成能指路的一句话。这是错误信息，不是门禁——守卫靠「能力在不在」，不靠比版本号。
if (typeof registerHooks !== 'function') {
  throw new Error(
    '[ts-hook] 当前 Node 没有 module.registerHooks()，本仓开发链要求 Node 22.22.2 及以上（24 线要 24.15 及以上），见根 package.json 的 engines.node。'
  )
}

// "D:\a\b.js" 或 "/a/b.js" 这种不带协议头的绝对路径；带协议头的走 file: 那一支。
function isAbsolutePath(specifier: string): boolean {
  return specifier.startsWith('/') || /^[A-Za-z]:[\\/]/.test(specifier)
}

// 把 "./x.js"（或 file:、绝对路径形式的同一件事）换算成同目录下的 "./x.ts"，
// 找不到同目录同名 .ts 时再试 "<目标目录>/src/<同名>.ts"（约定三）。
// 都不存在、或目标落在 node_modules 里，就返回 null（交给 Node 原样解析）。
function tsSiblingURL(specifier: string, parentURL: string | undefined): string | null {
  if (!specifier.endsWith('.js')) return null
  if (!specifier.startsWith('./') && !specifier.startsWith('../') && !specifier.startsWith('file:') && !isAbsolutePath(specifier)) {
    return null
  }
  if (!parentURL) return null
  const parentDir = dirname(fileURLToPath(parentURL))
  let target: string
  try {
    if (specifier.startsWith('file:')) target = fileURLToPath(specifier)
    else if (isAbsolutePath(specifier)) target = resolve(specifier)
    else target = resolve(parentDir, specifier)
  } catch {
    return null
  }
  // 用「从引用文件所在目录到目标」的相对路径判断，而不是看整个绝对路径：
  // 这样本仓自己被放在某个 node_modules 目录下时，正常的同名解析不会被误伤。
  let rel: string = target
  try {
    rel = relative(parentDir, target)
  } catch {
    /* 跨盘符时 relative 会给回绝对路径，下面照样按段切开判断 */
  }
  if (rel.split(/[\\/]+/).includes('node_modules')) return null
  const candidate = target.slice(0, -'.js'.length) + '.ts'
  if (existsSync(candidate)) return pathToFileURL(candidate).href
  // 约定三的回落：<目标目录>/src/<同名>.ts。域名与文件名都可能带连字符，这里只换目录，不猜别的形状。
  const baseNoExt = target.slice(0, -'.js'.length)
  const underSrc = join(dirname(baseNoExt), 'src', basename(baseNoExt) + '.ts')
  if (existsSync(underSrc)) return pathToFileURL(underSrc).href
  return null
}

registerHooks({
  resolve(specifier: string, context: { parentURL: string | undefined }, nextResolve: (specifier: string, context: unknown) => unknown): unknown {
    const url: string | null = tsSiblingURL(specifier, context.parentURL)
    if (url) return { url, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
