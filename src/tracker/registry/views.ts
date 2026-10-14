/**
 * src/tracker/registry/views.ts — 身份识别与链接只读视图（V1 #461 从 registry.js 拆出，纯结构、行为零变化）。
 * 以后谁改它：改出 RepositoryRef（describe）或链接查询转发（issueAddress / issueRefPattern / repoSearchAddress）的人。预估约 110 行，超 350 打回。
 * 接线：只被 core.ts 引用；本文件不引用其他新文件。
 * 机制：原闭包直读的注册表 byId 改为首参显式传引用（H1 #445 显式传参先例），只读不写。
 * 边界（#1112 定版）：链接这三件事的语义由各家后端自己给，注册表只转发、不替它拼地址或造正则——
 *   后端没实现、抛错或回的不是字符串时，诚实回空（issueAddress/repoSearchAddress 回 ''，issueRefPattern 回 null）。
 *   准确说法是「注册表这一层不再持有网址形状」，不是全仓只有一个真源：各家后端自己怎么表示
 *   （拼字符串还是写模板）仍可能有第二份，那是各家自己的事。这样新增后端也不会被注册表安上
 *   一个它没承诺过的网址形状。
 *   已知取舍：上面三种成因都回同一个空值，调用方分不出「这家后端没有票地址这个概念」和
 *   「这家后端坏了」。今天这三个方法在 src/ 里没有生产调用方（客户端走各后端 links 模板那条路），
 *   所以先不为它加区分；将来真要有调用方需要分辨，再单独立票改接口。
 * 改名与旧名退役（#1110 实现决定第 14 条 → #1133 改名 → #1141 删旧名）：这三个能力讲的是「地址」
 *   不是「网址」，因为本地 Markdown 后端给的是票文件路径。改名时网址口吻的老名字作为同义别名留过
 *   一轮，取值也是新名优先、老名兜底；客户端与宿主都不再读它们之后，兜底与别名一并删净，
 *   所以本文件今天只剩这三个新名字这一套，末尾也没有老名字的常量导出。
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
 * 取一个函数口：没有可调用的实现就回 null。
 * #1141 之后只有新名字一种写法——老名字的兜底随别名窗口一起删了，这里不再需要第二个名字参数。
 */
function pickFn(holder, name) {
  if (!holder) return null
  return typeof holder[name] === 'function' ? holder[name] : null
}

/** 取一个真值口（正则或源码串）：没有就回 null。同 pickFn，只认新名字。 */
function pickValue(holder, name) {
  if (!holder) return null
  return holder[name] || null
}

/**
 * issueAddress 只读 view：转发 BackendModule.issueAddress / tracker.issueAddress。
 * 都没有就回空串，不按 backendId 拼地址（#1112：后端没承诺过的地址，注册表不许替它造）。
 * 空串有三种成因且不区分：后端没实现、调用抛错、回的不是字符串。
 */
export function issueAddress(byId, backendId, ref, key) {
  const entry = byId.get(backendId)
  const f = pickFn(entry && entry.mod, 'issueAddress')
  if (f) {
    try { const u = f(ref, String(key)); if (typeof u === 'string') return u } catch (e) {}
  }
  const f2 = pickFn(entry && entry.tracker, 'issueAddress')
  if (f2) {
    try { const u2 = f2(ref, String(key)); if (typeof u2 === 'string') return u2 } catch (e) {}
  }
  return ''
}

/**
 * issueRefPattern 只读 view：转发 BackendModule.issueRefPattern / tracker.issueRefPattern。
 * 都没有就回 null，不按 backendId 造正则（#1112）。
 */
export function issueRefPattern(byId, backendId) {
  const entry = byId.get(backendId)
  const p = pickValue(entry && entry.mod, 'issueRefPattern')
  if (p) return p
  try { const p2 = pickValue(entry && entry.tracker, 'issueRefPattern'); if (p2) return p2 } catch (e) {}
  return null
}

/**
 * repoSearchAddress 只读 view：转发 BackendModule.repoSearchAddress / tracker.repoSearchAddress。
 * 都没有就回空串，不按 backendId 拼搜索页（#1112）。
 */
export function repoSearchAddress(byId, backendId, name) {
  const entry = byId.get(backendId)
  const f = pickFn(entry && entry.mod, 'repoSearchAddress')
  if (f) {
    try { const u = f(String(name)); if (typeof u === 'string') return u } catch (e) {}
  }
  const f2 = pickFn(entry && entry.tracker, 'repoSearchAddress')
  if (f2) {
    try { const u2 = f2(String(name)); if (typeof u2 === 'string') return u2 } catch (e) {}
  }
  return ''
}
