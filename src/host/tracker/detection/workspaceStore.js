/**
 * tracker/detection/workspaceStore.js — per-workspace 状态隔离（~80 行）
 *
 * 第一性原理（#150 Q3 + #118 D1 + 契约 §2 + #113 可测性 + snapshot 双缓存正交）：
 *  - 键 = handleKey = cwd|refId（复用 registry handleKey 语义，Registry 268 行 handleKey 逻辑镜像）
 *  - 存储 = 内存 Map<handleKey → { selection, at }> 单例不落盘（不复用 snapshot owner__name.json）
 *  - 失效 = TTL 30s + cwd 切换新 key 重算 + registry unregister stale（emit bind stale:true）→ 自然过期；
 *    statusCache 与 snapshot 双缓存正交不合并（Q3/Q6）
 *  - 轻量化：本模块只管 Selection 缓存，不含 preflight/skill 聚合；pending 场景由 detectionService 决定不缓存
 */

const DEFAULT_TTL = 30000

function handleKey(handle) {
  if (!handle || typeof handle !== 'object') throw new Error('bad-handle: handle is required')
  const k = handle.cwd || handle.refId
  if (!k) throw new Error('bad-handle: handle needs cwd or refId')
  return String(k)
}

export function createWorkspaceStore(opts = {}) {
  const ttl = (opts && opts.ttl != null) ? opts.ttl : DEFAULT_TTL
  const map = new Map() // key -> { selection, at, raw, parsed }

  function isFresh(entry) {
    return entry && (Date.now() - entry.at) < ttl
  }

  return {
    ttl,
    handleKey,
    size() { return map.size },
    clear() { map.clear() },
    invalidate(handle) {
      try { map.delete(handleKey(handle)) } catch {}
    },
    invalidateByKey(key) { map.delete(String(key)) },
    get(handle) {
      let k
      try { k = handleKey(handle) } catch { return null }
      const e = map.get(k)
      if (!e) return null
      if (!isFresh(e)) { map.delete(k); return null }
      return e
    },
    set(handle, payload) {
      let k
      try { k = handleKey(handle) } catch { return }
      // pending 场景不缓存（Q6）：调用方应在 pending 时跳过 set；此处二次兜底
      if (payload && payload.selection && payload.selection.pending) return
      map.set(k, { ...payload, at: Date.now() })
    },
    has(handle) {
      let k
      try { k = handleKey(handle) } catch { return false }
      const e = map.get(k)
      return !!(e && isFresh(e))
    },
    // 供检测：列出 keys（隔离测试用）
    keys() { return Array.from(map.keys()) },
    // Stale 清理：registry unregister 时回调
    onRegistryBindStale(handle) {
      // bound stale → 清对应 key（由 detectionService 订阅 registry on('bind', stale) 驱动）
      try { map.delete(handleKey(handle)) } catch {}
    },
  }
}

export default createWorkspaceStore
