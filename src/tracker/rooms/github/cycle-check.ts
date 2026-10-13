// src/host/tracker/backends/github/cycle-check.js —— 依赖图邻接关系的按需组装（#895 去放大）
//
// 为什么有这个文件：成环检查与反向聚合以前每次整仓拉取（仓库越大越慢，单次补几条边
// 就能打满执行限时）。现在名册优先：调用上下文带名册（ctx.memo，工具层调用上下文建的）
// 时只定向重读脏票；名册缺席、脏票读不回时退回整仓拉取（老行为，一字不差）。
// 同房间内引用（graph.js 用它）；跨房间不许引。签名里不加新参数——名册走既有的 ctx。
import { listIssues, getIssue } from './issues.js'
import { rosterUpsert } from './roster.js'

/** 名册 → 邻接表（key → 它阻塞的键集合）。名册缺席或不完整时返回 null（调用方走老路）。 */
function adjacencyOfRoster(roster) {
  if (!roster || roster.complete !== true || !(roster.byKey instanceof Map)) return null
  const adj = new Map()
  for (const entry of roster.byKey) {
    const facts = entry[1] || {}
    adj.set(String(entry[0]), new Set(((facts && facts.blockedBy) || []).map(String)))
  }
  return adj
}

/**
 * 取当前邻接关系。名册路径：脏票逐张定向重读（读不回就整仓拉取兜底，不猜）；
 * 无名册路径：整仓拉取一次（老行为）。返回 Map 或 null（拉取失败）。
 */
export async function adjacencyFor(repo, ctx) {
  const memo = ctx && ctx.memo
  const roster = memo && memo.roster
  if (roster && roster.complete === true) {
    const dirty = Array.from((memo && memo.dirty) || [])
    let stale = false
    for (const k of dirty) {
      let g = null
      try { g = await getIssue(repo, k, {}, ctx) } catch (e) { g = null }
      if (!g || g.ok !== true || !g.data) { stale = true; break }
      try { rosterUpsert(memo, g.data) } catch (e) {}
    }
    if (!stale) {
      const adj = adjacencyOfRoster(roster)
      if (adj) return adj
    }
  }
  let allRes = null
  try { allRes = await listIssues(repo, {}, ctx) } catch (e) { return null }
  if (!allRes || allRes.ok !== true || !Array.isArray(allRes.data)) return null
  const adj = new Map()
  for (const issue of allRes.data) {
    const deps = Array.isArray(issue.blockedBy)
      ? issue.blockedBy.map((b) => String((b && b.key) || b || '')).filter(Boolean)
      : []
    adj.set(String(issue.key), new Set(deps))
  }
  return adj
}

/** 在邻接表上应用拟写入边（key -> blockers）后判环（DFS）。true = 成环。 */
export function hasCycle(adj, key, blockers) {
  const g = (adj instanceof Map) ? new Map(adj) : new Map()
  g.set(String(key), new Set((Array.isArray(blockers) ? blockers : []).map((b) => String(b))))
  const visiting = new Set()
  const visited = new Set()
  function dfs(u) {
    if (visiting.has(u)) return true
    if (visited.has(u)) return false
    visiting.add(u)
    const neigh = g.get(u) || new Set()
    for (const v of neigh) { if (dfs(v)) return true }
    visiting.delete(u)
    visited.add(u)
    return false
  }
  for (const u of g.keys()) { if (dfs(u)) return true }
  return false
}
