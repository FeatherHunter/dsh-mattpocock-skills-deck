// scripts/ts-hook.mjs —— 让源码里写的 "./x.js" 说明符优先解析到同名的 "./x.ts"。
//
// 为什么要有它：旧测试与旧源码是「按单元分批」从 .js 转成 .ts 的。一个文件改名之后，
// 所有引用它的地方还写着 "./x.js"；这个钩子把这类说明符改指同名 .ts，引用点就一个字都不用改
// （这正是四个核搬家的前提：几十处 "../shared/<名>/x.js" 靠同名解析落到 .ts）。
//
// 为什么用同步的 registerHooks 而不是异步的 register：同步钩子同时管 ESM 的 import 与
// CommonJS 的 require，异步的 register() 管不到 require。同步的这个 API 从 Node 22.15 才有，
// 所以根 package.json 的 engines.node 写的是 ">=22.15"。
//
// 用法（把它挂在要跑的那个脚本前面）：
//   node --import ./scripts/ts-hook.mjs tests/xxx.js
//
// 约定：只改写以 "./"、"../"、"file:" 开头且以 ".js" 结尾的说明符；裸包名（如 'dsh-log/host'）
// 与其它后缀一律不碰。同名 .ts 不存在时原样交给 Node，所以没迁移的文件行为与今天完全一样。
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerHooks } from 'node:module'

// 能力检测：旧 Node 上 registerHooks 根本不存在，直接调用会抛一句难懂的 TypeError。
// 这里换成能指路的一句话。这是错误信息，不是门禁——守卫靠「能力在不在」，不靠比版本号。
if (typeof registerHooks !== 'function') {
  throw new Error(
    '[ts-hook] 当前 Node 没有 module.registerHooks()，本仓开发链要求 Node 22.15 及以上（见根 package.json 的 engines.node）。'
  )
}

// 把 "./x.js"（或 file: 形式的同一件事）换算成同目录下的 "./x.ts"；不存在就返回 null。
function tsSiblingURL(specifier, parentURL) {
  if (!specifier.endsWith('.js')) return null
  if (!specifier.startsWith('./') && !specifier.startsWith('../') && !specifier.startsWith('file:')) return null
  if (!parentURL) return null
  let target
  try {
    target = specifier.startsWith('file:')
      ? fileURLToPath(specifier)
      : resolve(dirname(fileURLToPath(parentURL)), specifier)
  } catch {
    return null
  }
  const candidate = target.slice(0, -'.js'.length) + '.ts'
  return existsSync(candidate) ? pathToFileURL(candidate).href : null
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const url = tsSiblingURL(specifier, context.parentURL)
    if (url) return { url, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
