// src/host/tracker/backends/github/cycle-check.js —— 依赖图邻接关系的按需组装（#895 去放大）
//
// 为什么有这个文件：成环检查与反向聚合以前每次整仓拉取（仓库越大越慢，单次补几条边
// 就能打满执行限时）。现在名册优先：调用上下文带名册（ctx.memo，工具层调用上下文建的）
// 时只定向重读脏票；名册缺席、脏票读不回时退回整仓拉取（老行为，一字不差）。
// 同房间内引用（graph.js 用它）；跨房间不许引。签名里不加新参数——名册走既有的 ctx。
import { listIssues, getIssue } from './issues.js'
import { rosterUpsert } from './roster.js'
import type { RosterMemo } from './roster.js';
import type { OpContext } from '../../contract/contexts.js';
import type { Issue, RepositoryRef } from '../../contract/entities.js';

/** 名册容器的最小读形：只读 complete 与 byKey，缺谁都按无名册处理，与 roster.ts 同形。 */
interface RosterLike {
  complete?: unknown;
  byKey?: unknown;
}

/** 带名册的调用上下文：名册走既有 ctx.memo，不加新参数，缺席时退回整仓拉取。 */
type MemoCtx = OpContext & { memo?: (RosterMemo & { roster?: RosterLike | null; dirty?: Iterable<unknown> | null }) | null };

/** 名册 → 邻接表（key → 它阻塞的键集合）。名册缺席或不完整时返回 null（调用方走老路）。 */
function adjacencyOfRoster(roster: RosterLike | null | undefined): Map<string, Set<string>> | null {
  if (!roster || roster.complete !== true || !(roster.byKey instanceof Map)) return null
  const adj = new Map<string, Set<string>>()
  for (const entry of roster.byKey as Map<unknown, unknown>) {
    const facts = (entry[1] || {}) as { blockedBy?: unknown };
    // 为什么不断言数组：名册事实的 blockedBy 恒为数组（roster.ts 写入），保持与原来一致的直接取法，缺时给空。
    adj.set(String(entry[0]), new Set((((facts && facts.blockedBy) as unknown[] || []) as unknown[]).map(String)))
  }
  return adj
}

/**
 * 取当前邻接关系。名册路径：脏票逐张定向重读（读不回就整仓拉取兜底，不猜）；
 * 无名册路径：整仓拉取一次（老行为）。返回 Map 或 null（拉取失败）。
 */
export async function adjacencyFor(repo: RepositoryRef, ctx: MemoCtx): Promise<Map<string, Set<string>> | null> {
  const memo = ctx && ctx.memo
  const roster = memo && memo.roster
  if (roster && roster.complete === true) {
    const dirty = Array.from((memo && memo.dirty) || [])
    let stale = false
    for (const k of dirty) {
      let g = null as Awaited<ReturnType<typeof getIssue>> | null;
      try { g = await getIssue(repo, String(k), {}, ctx) } catch (e) { g = null }
      if (!g || g.ok !== true || !g.data) { stale = true; break }
      try { rosterUpsert(memo as unknown as import('./roster.js').RosterMemo, g.data) } catch (e) {}
    }
    if (!stale) {
      const adj = adjacencyOfRoster(roster)
      if (adj) return adj
    }
  }
  let allRes = null as Awaited<ReturnType<typeof listIssues>> | null;
  try { allRes = await listIssues(repo, {}, ctx) } catch (e) { return null }
  if (!allRes || allRes.ok !== true || !Array.isArray(allRes.data)) return null
  const adj = new Map<string, Set<string>>()
  for (const issue of allRes.data as Issue[]) {
    const deps = Array.isArray(issue.blockedBy)
      ? (issue.blockedBy as unknown[]).map((b: unknown) => String(((b && typeof b === 'object' ? (b as unknown as Record<string, unknown>).key : undefined) || (b as unknown) || ''))).filter(Boolean)
      : []
    adj.set(String(issue.key), new Set(deps))
  }
  return adj
}

/** 在邻接表上应用拟写入边（key -> blockers）后判环（DFS）。true = 成环。 */
export function hasCycle(adj: Map<string, Set<string>> | null | undefined, key: unknown, blockers: unknown): boolean {
  const g = (adj instanceof Map) ? new Map<string, Set<string>>(adj) : new Map<string, Set<string>>()
  g.set(String(key), new Set((Array.isArray(blockers) ? (blockers as unknown[]) : []).map((b) => String(b))))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  function dfs(u: string): boolean {
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
