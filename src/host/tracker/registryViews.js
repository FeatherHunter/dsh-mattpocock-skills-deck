/**
 * tracker/registryViews.js — 身份识别与链接只读视图（V1 #461 从 registry.js 拆出，纯结构、行为零变化）。
 * 以后谁改它：改出 RepositoryRef（describe）或链接拼装（issueUrl/linkPattern/searchUrl）的人。预估约 110 行，超 350 打回。
 * 接线：只被 registryCore.js 引用；本文件不引用其他新文件。
 * 机制：原闭包直读的注册表 byId 改为首参显式传引用（H1 #445 显式传参先例），只读不写。
 */

/** 出 RepositoryRef：转发 BackendModule.describe（可选），回退骨架（#220 · registry 只转发）。 */
export function describe(byId, handle, backendId) {
  const entry = byId.get(backendId)
  if (entry && entry.mod && typeof entry.mod.describe === 'function') {
    try {
      const r = entry.mod.describe(handle, backendId)
      if (r && typeof r === 'object' && typeof r.refId === 'string') {
        return {
          backend: r.backend || backendId,
          refId: r.refId || '',
          name: r.name || r.refId || (handle.cwd || backendId),
          url: typeof r.url === 'string' ? r.url : '',
        }
      }
      if (r && typeof r === 'object') return r
    } catch (e) { /* 回退骨架 */ }
  }
  // 也尝试 tracker 实例上的 describe（若模块经 create 暴露）
  try {
    const tr = entry && entry.tracker
    if (tr && typeof tr.describe === 'function') {
      const r2 = tr.describe(handle, backendId)
      if (r2 && typeof r2 === 'object' && typeof r2.refId === 'string') {
        return {
          backend: r2.backend || backendId,
          refId: r2.refId || '',
          name: r2.name || r2.refId || (handle.cwd || backendId),
          url: typeof r2.url === 'string' ? r2.url : '',
        }
      }
    }
  } catch (e) {}
  // 骨架回退：markdown 用 cwd，其余空（等价旧行为）
  const refId = handle.refId || (backendId === 'markdown' ? handle.cwd : '')
  const name = refId || (handle.cwd || backendId)
  return { backend: backendId, refId, name, url: '' }
}

/** issueUrl 只读 view：转发 BackendModule.issueUrl / tracker.issueUrl，回退按 backendId 拼装（#220）。 */
export function issueUrl(byId, backendId, ref, key) {
  const entry = byId.get(backendId)
  if (entry && entry.mod && typeof entry.mod.issueUrl === 'function') {
    try { const u = entry.mod.issueUrl(ref, String(key)); if (typeof u === 'string') return u } catch (e) {}
  }
  try {
    const tr = entry && entry.tracker
    if (tr && typeof tr.issueUrl === 'function') {
      const u2 = tr.issueUrl(ref, String(key)); if (typeof u2 === 'string') return u2
    }
  } catch (e) {}
  if (backendId === 'github' && ref && ref.refId) return 'https://github.com/' + ref.refId + '/issues/' + String(key)
  if (backendId === 'gitlab' && ref && ref.refId) return 'https://gitlab.com/' + ref.refId + '/-/issues/' + String(key)
  return ''
}

/** linkPattern 只读 view：转发 BackendModule.linkPattern。 */
export function linkPattern(byId, backendId) {
  const entry = byId.get(backendId)
  if (entry && entry.mod && entry.mod.linkPattern) return entry.mod.linkPattern
  try { const tr = entry && entry.tracker; if (tr && tr.linkPattern) return tr.linkPattern } catch (e) {}
  if (backendId === 'github') return /github\.com\/[^\/\s]+\/[^\/\s]+\/issues\/(\d+)/g
  if (backendId === 'gitlab') return /gitlab\.com\/[^\/\s]+\/[^\/\s]+\/-\/issues\/(\d+)/g
  return null
}

/** searchUrl 只读 view：转发 BackendModule.searchUrl。 */
export function searchUrl(byId, backendId, name) {
  const entry = byId.get(backendId)
  if (entry && entry.mod && typeof entry.mod.searchUrl === 'function') {
    try { const u = entry.mod.searchUrl(String(name)); if (typeof u === 'string') return u } catch (e) {}
  }
  try {
    const tr = entry && entry.tracker
    if (tr && typeof tr.searchUrl === 'function') { const u2 = tr.searchUrl(String(name)); if (typeof u2 === 'string') return u2 }
  } catch (e) {}
  if (backendId === 'github') return 'https://github.com/search?q=' + encodeURIComponent(String(name))
  return ''
}
