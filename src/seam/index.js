/**
 * seam/index.js · seam 绑定层聚合
 *
 * 规范方言 = 动态版方言（host/styles/React/timer 为自由变量）；pkg entry 提供 shim。
 * 六个绑定（B1-B6）+ 构建门禁（G）在此聚合成一个可被构建脚本/测试引用的入口。
 */
export * as runtime from './runtime.js'
export * as rpc from './rpc.js'
export * as style from './style.js'
export * as timer from './timer.js'
export * as editor from './editor.js'
export * as sidebar from './sidebar.js'
export * as gate from './gate.js'

/** 全部绑定清单（供审计/测试断言 R1 六绑定齐全）。 */
export const bindings = [
  { b: 'B1', name: 'runtime', mod: 'runtime' },
  { b: 'B2', name: 'style', mod: 'style' },
  { b: 'B3', name: 'rpc', mod: 'rpc' },
  { b: 'B4', name: 'timer', mod: 'timer' },
  { b: 'B5', name: 'editor', mod: 'editor' },
  { b: 'B6', name: 'sidebar', mod: 'sidebar' },
  { b: 'G', name: 'gate', mod: 'gate' },
]
