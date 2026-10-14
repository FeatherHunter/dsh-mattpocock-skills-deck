/**
 * tracker/detection/workspaceStore.js — per-workspace 状态隔离（~80 行）
 *
 * 第一性原理（#150 Q3 + #118 D1 + 契约 §2 + #113 可测性 + snapshot 双缓存正交）：
 *  - 键 = handleKey = cwd|refId（复用 registry handleKey 语义，Registry 268 行 handleKey 逻辑镜像）
 *  - 存储 = 内存 Map<handleKey → { selection, at }> 单例不落盘（不复用 snapshot owner__name.json）
 *  - 失效 = TTL 30s + cwd 切换新 key 重算 + 后端被卸载（registry 发 unregister，按「缓存里答的是不是它」清）
 *    → 自然过期；statusCache 与 snapshot 双缓存正交不合并（Q3/Q6）
 *  - 轻量化：本模块只管 Selection 缓存，不含 preflight/skill 聚合；pending 场景由 detectionService 决定不缓存
 */

const DEFAULT_TTL = 30000

// #491 房外埋点：hash8 只记键散列不记原文。
function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
function handleKey(handle) {
  if (!handle || typeof handle !== 'object') throw new Error('bad-handle: handle is required')
  const k = handle.cwd || handle.refId
  if (!k) throw new Error('bad-handle: handle needs cwd or refId')
  return String(k)
}

export function createWorkspaceStore(opts = {}) {
  const ttl = (opts && opts.ttl != null) ? opts.ttl : DEFAULT_TTL
  const logCtx = (opts && opts.logCtx) || null
  let wsHitN = 0
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
      if (!e) { try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'workspaceStore.miss', { keyHash: hash8(k), reason: 'empty' }) } catch (eL) {}; return null }
      if (!isFresh(e)) { try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'workspaceStore.miss', { keyHash: hash8(k), reason: 'expired' }) } catch (eL) {}; map.delete(k); return null }
      try { if (logCtx && logCtx.isEnabled('debug') && ((++wsHitN % 100) === 0)) logCtx.fire('debug', 'workspaceStore.hit', function () { return { keyHash: hash8(k), fresh: true, ttlMs: ttl } }) } catch (eL) {}
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
    // 某个后端被卸载时清缓存：只清「这一格的答案正是那个后端」的格子。
    // #1138 之前这里叫 onRegistryBindStale(handle)，由「绑定表把工作区标 stale」驱动；绑定表删掉以后
    // 注册表不知道哪些工作区用过它，改成按缓存内容认——判定结果没有别的记法，按它认就是最准的认法。
    invalidateByBackend(backendId) {
      const want = String(backendId || '')
      if (!want) return 0
      let n = 0
      for (const [k, e] of Array.from(map.entries())) {
        const got = e && e.selection && e.selection.backendId
        if (got && String(got) === want) { map.delete(k); n++ }
      }
      return n
    },
  }
}

export default createWorkspaceStore
