/**
 * seam/index.js · seam 绑定层聚合
 *
 * 规范方言 = 动态版方言（host/styles/React/timer 为自由变量）；pkg entry 提供 shim。
 * 五个绑定（B1-B5）+ 构建门禁（G）在此聚合成一个可被构建脚本/测试引用的入口。
 *   2026-09-21：原来的 B6（sidebar，为 dsh-better-sidebar 写的幂等注册）随那条路一起删除 ——
 *   面板现在只有 DSH 原生右侧边栏一条路，不再需要给第三方插件做单例化包装。
 */
export * as runtime from './runtime.js'
export * as rpc from './rpc.js'
export * as style from './style.js'
export * as timer from './timer.js'
export * as editor from './editor.js'
export * as gate from './gate.js'

/** 全部绑定清单（供审计/测试断言绑定齐全）。 */
export const bindings = [
  { b: 'B1', name: 'runtime', mod: 'runtime' },
  { b: 'B2', name: 'style', mod: 'style' },
  { b: 'B3', name: 'rpc', mod: 'rpc' },
  { b: 'B4', name: 'timer', mod: 'timer' },
  { b: 'B5', name: 'editor', mod: 'editor' },
  { b: 'G', name: 'gate', mod: 'gate' },
]
