/**
 * tracker/registryViews.js — 身份识别与链接只读视图（V1 #461 从 registry.js 拆出，纯结构、行为零变化）。
 * 以后谁改它：改出 RepositoryRef（describe）或链接查询转发（issueUrl/linkPattern/searchUrl）的人。预估约 110 行，超 350 打回。
 * 接线：只被 registryCore.js 引用；本文件不引用其他新文件。
 * 机制：原闭包直读的注册表 byId 改为首参显式传引用（H1 #445 显式传参先例），只读不写。
 * 边界（#1112 定版）：链接这三件事的语义由各家后端自己给，注册表只转发、不替它拼地址或造正则——
 *   后端没实现、抛错或回的不是字符串时，诚实回空（issueUrl/searchUrl 回 ''，linkPattern 回 null）。
 *   准确说法是「注册表这一层不再持有网址形状」，不是全仓只有一个真源：各家后端自己怎么表示
 *   （拼字符串还是写模板）仍可能有第二份，那是各家自己的事。这样新增后端也不会被注册表安上
 *   一个它没承诺过的网址形状。
 *   已知取舍：上面三种成因都回同一个空值，调用方分不出「这家后端没有票地址这个概念」和
 *   「这家后端坏了」。今天这三个方法在 src/ 里没有生产调用方（客户端走各后端 links 模板那条路），
 *   所以先不为它加区分；将来真要有调用方需要分辨，再单独立票改接口。
 */

/** 出 RepositoryRef：转发 BackendModule.describe（可选），回退骨架（#220 · registry 只转发）。 */
export function describe(byId, handle, backendId) {
  const entry = byId.get(backendId)
  // effort 维度：effortId 是 ref 的寻址范围，白名单里必须如实转发（丢掉就再也拿不回来）
  const withEffort = (o) => {
    if (handle && handle.effortId !== undefined && handle.effortId !== null) o.effortId = String(handle.effortId)
    return o
  }
  if (entry && entry.mod && typeof entry.mod.describe === 'function') {
    try {
      const r = entry.mod.describe(handle, backendId)
      if (r && typeof r === 'object' && typeof r.refId === 'string') {
        return withEffort({
          backend: r.backend || backendId,
          refId: r.refId || '',
          name: r.name || r.refId || (handle.cwd || backendId),
          url: typeof r.url === 'string' ? r.url : '',
          ...(r.effortId !== undefined && r.effortId !== null ? { effortId: String(r.effortId) } : {}),
        })
      }
      if (r && typeof r === 'object') return withEffort(r)
    } catch (e) { /* 回退骨架 */ }
  }
  // 也尝试 tracker 实例上的 describe（若模块经 create 暴露）
  try {
    const tr = entry && entry.tracker
    if (tr && typeof tr.describe === 'function') {
      const r2 = tr.describe(handle, backendId)
      if (r2 && typeof r2 === 'object' && typeof r2.refId === 'string') {
        return withEffort({
          backend: r2.backend || backendId,
          refId: r2.refId || '',
          name: r2.name || r2.refId || (handle.cwd || backendId),
          url: typeof r2.url === 'string' ? r2.url : '',
          ...(r2.effortId !== undefined && r2.effortId !== null ? { effortId: String(r2.effortId) } : {}),
        })
      }
    }
  } catch (e) {}
  // 骨架回退：markdown 用 cwd，其余空（等价旧行为）
  const refId = handle.refId || (backendId === 'markdown' ? handle.cwd : '')
  const name = refId || (handle.cwd || backendId)
  return withEffort({ backend: backendId, refId, name, url: '' })
}

/**
 * issueUrl 只读 view：转发 BackendModule.issueUrl / tracker.issueUrl。
 * 都没有就回空串，不按 backendId 拼地址（#1112：后端没承诺过的地址，注册表不许替它造）。
 * 空串有三种成因且不区分：后端没实现、调用抛错、回的不是字符串。
 */
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
  return ''
}

/**
 * linkPattern 只读 view：转发 BackendModule.linkPattern / tracker.linkPattern。
 * 都没有就回 null，不按 backendId 造正则（#1112）。
 */
export function linkPattern(byId, backendId) {
  const entry = byId.get(backendId)
  if (entry && entry.mod && entry.mod.linkPattern) return entry.mod.linkPattern
  try { const tr = entry && entry.tracker; if (tr && tr.linkPattern) return tr.linkPattern } catch (e) {}
  return null
}

/**
 * searchUrl 只读 view：转发 BackendModule.searchUrl / tracker.searchUrl。
 * 都没有就回空串，不按 backendId 拼搜索页（#1112）。
 */
export function searchUrl(byId, backendId, name) {
  const entry = byId.get(backendId)
  if (entry && entry.mod && typeof entry.mod.searchUrl === 'function') {
    try { const u = entry.mod.searchUrl(String(name)); if (typeof u === 'string') return u } catch (e) {}
  }
  try {
    const tr = entry && entry.tracker
    if (tr && typeof tr.searchUrl === 'function') { const u2 = tr.searchUrl(String(name)); if (typeof u2 === 'string') return u2 }
  } catch (e) {}
  return ''
}
