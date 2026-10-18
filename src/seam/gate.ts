/**
 * seam/gate.ts · G 构建门禁（D10 拦截手写破损）
 *
 * R1 定义：构建 + node -c + 单组件只允许 1 次声明，CI 拦截手写破损。
 * 本模块提供可复用的门禁函数，供 scripts/build.mjs 在每次构建后执行：
 *   1. gateSyntax(code, label)   —— vm 编译（等价 node -c / precheckCode 的语法层）
 *   2. gatePrecheck(code, label) —— 模拟 cordis_define precheckCode：以 (async () => { code })() 包装编译
 *   3. gateSingleDeclaration(code, label, componentNames) —— 单组件只允许 1 次声明
 *   4. gateModuleLoader(code, label) —— pkg 产物必须含 __ModuleLoader__ 特征（防动态版误入 lib/）
 */

// 本域 tsconfig 有意不加载任何类型包（types 为空），node:vm 的类型声明随 @types/node
// 一起被挡在门外；运行时一定是 Node，这个模块必然存在。所以只忽略导入这一行的类型错误
// （纯类型层面，不影响 esbuild 的运行时转译）—— 与 src/host/choiceStore.ts 同一写法。
// @ts-expect-error
import vm from 'node:vm'

export function gateSyntax(code: string, label = 'artifact'): boolean {
  try {
    new vm.Script(code, { filename: `gate-${label}.js` })
  } catch (e) {
    throw new Error(`[G门禁] ${label} 语法编译失败: ${(e as Error).message}`)
  }
  return true
}

export function gatePrecheck(code: string, label = 'dev-client'): boolean {
  try {
    new vm.Script(`(async () => {\n${code}\n})()`, { filename: `cordis-dyn-${label}.js` })
  } catch (e) {
    throw new Error(`[G门禁] ${label} precheckCode 失败（须为 cordis_define 函数体形态）: ${(e as Error).message}`)
  }
  return true
}

export function gateSingleDeclaration(code: string, label: string, componentNames: string[]): boolean {
  const problems: string[] = []
  for (const name of componentNames) {
    const re = new RegExp(`(?:const|function|var)\\s+${name}\\s*[=(]`, 'g')
    const hits = code.match(re)
    if (hits && hits.length > 1) problems.push(`${name} 声明 ${hits.length} 次（应恰好 1 次）`)
  }
  if (problems.length) throw new Error(`[G门禁] ${label} 单组件声明违规: ${problems.join('; ')}`)
  return true
}

export function gateModuleLoader(code: string, label = 'pkg-client'): boolean {
  if (!code.includes('window.__ModuleLoader__.load')) {
    throw new Error(`[G门禁] ${label} 缺 __ModuleLoader__ 特征（疑似动态版形态误入 lib/）`)
  }
  return true
}

/** 本绑定说明的形状：只在本文件内用，不导出 —— G 门禁这份没有 dev/pkg 两栏，
 * 只有 checks 名单（原文如此，照搬）；跨文件引用会多出层内边（同层禁引），6 份各自写一份。 */
interface SeamDescribe {
  b: string
  name: string
  covers: string[]
  checks: string[]
}

export const describe = (): SeamDescribe => ({
  b: 'G',
  name: 'gate',
  covers: ['D10 构建破损：构建 + node -c + 单组件单声明 + precheckCode'],
  checks: ['gateSyntax', 'gatePrecheck', 'gateSingleDeclaration', 'gateModuleLoader'],
})
