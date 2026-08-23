/**
 * tracker/registry.js — trackerRegistry（主缝的可插拔点，G3）。
 *
 * 职责：按 backend id 注册/查找后端适配器；留存插件注册钩子（第三方可写 Tracker 实现，
 * UI 零改动）；按 workspace（repoKey/cwd）缓存选中的后端。
 */

/**
 * 创建一个 trackerRegistry。
 * @returns {{
 *   register: (backend: Object, probe?: Function) => Object,
 *   get: (id: string) => Object | undefined,
 *   list: () => Array<{id: string, backend: Object}>,
 *   workspace: (key: string) => Object | undefined,
 *   setWorkspace: (key: string, backend: Object) => void,
 *   has: (id: string) => boolean,
 * }}
 */
export function createRegistry() {
  const byId = new Map() // id -> backend
  const byWorkspace = new Map() // workspace key -> backend
  return {
    register(backend, probe) {
      if (!backend || !backend.id) throw new Error('registry.register: backend needs an `id`')
      byId.set(backend.id, backend)
      return backend
    },
    get(id) {
      return byId.get(id)
    },
    has(id) {
      return byId.has(id)
    },
    list() {
      return Array.from(byId.entries()).map(([id, backend]) => ({ id, backend }))
    },
    workspace(key) {
      return byWorkspace.get(key)
    },
    setWorkspace(key, backend) {
      byWorkspace.set(key, backend)
      return backend
    },
  }
}

export const TRACKER_REGISTRY = Object.freeze({ version: 1 })
