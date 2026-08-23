/**
 * tracker/index.js — 契约层（主缝）模块入口。
 *
 * 聚合契约、registry、capability、preflight，并提供一个「装配后端的宿主」入口，
 * 供 host/index.js（将来的薄装配器）与测试 import。
 */

export { TRACKER_CONTRACT, OPERATIONS, NORMALIZE_RULES } from './contract.js'
export { createRegistry, TRACKER_REGISTRY } from './registry.js'
export { deriveCapabilities, diagnoseCapabilities, hasField, CAPABILITY } from './capability.js'
export { classifyError, fail, PREFLIGHT } from './preflight.js'

import { createRegistry } from './registry.js'

/**
 * 创建一个 tracker host：注册后端 + 按 workspace 记忆当前后端。
 * @returns {ReturnType<typeof createRegistry> & { use: (key: string, backend: Object) => Object }}
 */
export function createTrackerHost() {
  const registry = createRegistry()
  return {
    ...registry,
    use(key, backend) {
      if (!registry.has(backend.id)) registry.register(backend)
      return registry.setWorkspace(key, backend)
    },
  }
}
