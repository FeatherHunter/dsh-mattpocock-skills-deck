/**
 * seam/runtime.ts · B1 runtime 绑定（模块形状）
 *
 * R1 接口：createClient({id, inject, apply}) —— 内部二选：
 *   dev：return { apply }（cordis_define 函数体形态，runner 注入 host/styles/React/timer 自由变量）
 *   pkg：__ModuleLoader__.load({id, factory}) + exports.inject + exports.apply（静态 bundle 形态）
 *
 * 这是「一源出两物」的第一层：同一份源码，两个运行时外壳。
 */

/** dev 实现：直接返回插件对象（cordis_define 求值后即 plugin）。 */
export function devClient(plugin: unknown): unknown {
  return plugin
}

export interface PkgClientSpecInput {
  id: string
  inject?: string[]
}

export interface PkgClientSpec {
  id: string
  factoryBody: string[]
}

/** pkg 实现：生成 ModuleLoader.load 的 spec（不执行注册，由构建组合成产物文本）。 */
export function pkgClientSpec({ id, inject }: PkgClientSpecInput): PkgClientSpec {
  return {
    id,
    factoryBody: [
      `var module = { exports: {} }`,
      `var exports = module.exports`,
      `Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })`,
      ...(inject && inject.length ? [`exports.inject = ${JSON.stringify(inject)}`] : []),
    ],
  }
}

/** 本绑定说明的形状：只在本文件内用，不导出 —— 跨文件引用会多出层内边（同层禁引），6 份各自写一份。 */
interface SeamDescribe {
  b: string
  name: string
  covers: string[]
  dev: string
  pkg: string
}

/** 返回本绑定说明（供审计/测试）。 */
export const describe = (): SeamDescribe => ({
  b: 'B1',
  name: 'runtime',
  covers: ['D1 模块系统/导出形状', 'D2 exports.inject 服务声明'],
  dev: 'return { apply }（动态 runner 注入自由变量）',
  pkg: '__ModuleLoader__.load({id, factory}) + exports.inject',
})
