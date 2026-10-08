// src/host/tracker/backends/github/roster.js —— 调用内票关系名册（#895 去放大）
//
// 为什么有这个文件：成环检查与反向聚合以前每次整仓拉取。调用上下文带名册
// （ctx.memo，工具层调用上下文建的）时只定向重读脏票，大幅减少出站。
// 名册形状与工具层调用上下文那份同形（字段 complete/byKey/dirty/seq/store），
// 两边各一份实现：房间不许引用 agent 工具层（跨层门禁），形状对不上时以读回为准，
// 绝不猜——拿不准就退回整仓拉取（老行为）。本文件零导入。
function isArr(v) { return Array.isArray(v) }
function blockedKeysOf(issue) {
  const bb = issue && issue.blockedBy
  if (!isArr(bb)) return []
  const out = []
  for (const b of bb) {
    const k = String((b && b.key) || b || '')
    if (k) out.push(k)
  }
  return out
}
function parentOf(issue) {
  const p = issue && issue.parentKey
  return (p === undefined || p === null) ? '' : String(p)
}
/** 列表过滤器是否等价于整仓（只有整仓结果才能重建名册；带筛的只做合并）。 */
export function isFullListFilter(filter) {
  const f = filter || {}
  if (f.parentKey !== undefined && f.parentKey !== null && f.parentKey !== '') return false
  if (Array.isArray(f.keys) && f.keys.length) return false
  if (typeof f.type === 'string' && f.type && f.type !== 'all') return false
  if (typeof f.state === 'string' && f.state && f.state !== 'all') return false
  return true
}
/** 整仓重建，带筛合并；返回成员键（调用方裁剪缓存用）。 */
export function rosterAdoptList(memo, rows, filter) {
  if (!memo) return []
  const list = isArr(rows) ? rows : []
  if (isFullListFilter(filter)) {
    const byKey = new Map()
    for (const r of list) {
      if (!r) continue
      byKey.set(String(r.key), { blockedBy: blockedKeysOf(r), parentKey: parentOf(r) })
    }
    memo.roster = { complete: true, byKey: byKey }
    memo.dirty = new Set()
  } else {
    for (const r of list) { if (r) rosterUpsert(memo, r) }
  }
  const out = []
  for (const r of list) { if (r) out.push(String(r.key)) }
  return out
}
/** 单票读成功 → 合并进名册并洗掉它的脏标记。 */
export function rosterUpsert(memo, issue) {
  if (!memo || !issue) return
  const k = String(issue.key)
  try {
    if (memo.roster && memo.roster.byKey instanceof Map) {
      memo.roster.byKey.set(k, { blockedBy: blockedKeysOf(issue), parentKey: parentOf(issue) })
    }
  } catch (e) {}
  try { if (memo.dirty instanceof Set) memo.dirty.delete(k) } catch (e) {}
}
/** 写操作波及某票 → 删名册条目并记脏（操作缓存的裁剪由外层 facade 做）。 */
export function markDirty(memo, key) {
  if (!memo) return
  const k = String(key || '')
  if (!k) return
  try { if (memo.roster && memo.roster.byKey instanceof Map) memo.roster.byKey.delete(k) } catch (e) {}
  try { if (memo.dirty instanceof Set) memo.dirty.add(k) } catch (e) {}
}
