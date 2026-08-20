/**
 * seam/gate.js · G 构建门禁（D10 拦截手写破损）
 *
 * R1 定义：构建 + node -c + 单组件只允许 1 次声明，CI 拦截手写破损。
 * 本模块提供可复用的门禁函数，供 scripts/build.mjs 在每次构建后执行：
 *   1. gateSyntax(code, label)   —— vm 编译（等价 node -c / precheckCode 的语法层）
 *   2. gatePrecheck(code, label) —— 模拟 cordis_define precheckCode：以 (async () => { code })() 包装编译
 *   3. gateSingleDeclaration(code, label, componentNames) —— 单组件只允许 1 次声明
 *   4. gateModuleLoader(code, label) —— pkg 产物必须含 __ModuleLoader__ 特征（防动态版误入 lib/）
 */

import vm from 'node:vm'

export function gateSyntax(code, label = 'artifact') {
  try {
    new vm.Script(code, { filename: `gate-${label}.js` })
  } catch (e) {
    throw new Error(`[G门禁] ${label} 语法编译失败: ${e.message}`)
  }
  return true
}

export function gatePrecheck(code, label = 'dev-client') {
  try {
    new vm.Script(`(async () => {\n${code}\n})()`, { filename: `cordis-dyn-${label}.js` })
  } catch (e) {
    throw new Error(`[G门禁] ${label} precheckCode 失败（须为 cordis_define 函数体形态）: ${e.message}`)
  }
  return true
}

export function gateSingleDeclaration(code, label, componentNames) {
  const problems = []
  for (const name of componentNames) {
    const re = new RegExp(`(?:const|function|var)\\s+${name}\\s*[=(]`, 'g')
    const hits = code.match(re)
    if (hits && hits.length > 1) problems.push(`${name} 声明 ${hits.length} 次（应恰好 1 次）`)
  }
  if (problems.length) throw new Error(`[G门禁] ${label} 单组件声明违规: ${problems.join('; ')}`)
  return true
}

export function gateModuleLoader(code, label = 'pkg-client') {
  if (!code.includes('window.__ModuleLoader__.load')) {
    throw new Error(`[G门禁] ${label} 缺 __ModuleLoader__ 特征（疑似动态版形态误入 lib/）`)
  }
  return true
}

export const describe = () => ({
  b: 'G',
  name: 'gate',
  covers: ['D10 构建破损：构建 + node -c + 单组件单声明 + precheckCode'],
  checks: ['gateSyntax', 'gatePrecheck', 'gateSingleDeclaration', 'gateModuleLoader'],
})
