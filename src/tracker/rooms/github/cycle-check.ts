// src/tracker/rooms/github/cycle-check.ts —— 依赖图邻接关系的按需组装（#895 去放大）
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
 * 名册这一趟的调试线（附录 1.5 节 #102 `edge.roster`）：一趟一行，回答「这次走的是哪条路、名册全不全、有几张脏票」。
 * 只在调试开关打开时记（查一次成环、或一次反向聚合就会落一行，属高频路径），字段全是枚举、布尔与计数：
 * source 这份邻接关系是从哪儿来的（roster 名册 / full-scan 整仓拉取 / none 一条都没走通）、
 * complete 进这一趟时名册是不是「已经拿全」（没有名册时记 false）、dirty 名册外待定向重读的票数、
 * latencyMs 这一趟花了多久。票号、目录路径一个字都不记。
 * 为什么这个键叫 source 而不叫 path：字段白名单门禁把 path 列为「原文类键名」一律不许作键
 * （见 tests/verify-log-fields.js 第四段），这里要表达的本来就是「来源」而不是路径。
 */
function emitEdgeRoster(ctx: OpContext, source: string, complete: boolean, dirty: number, t0: number): void {
  try {
    if (!ctx || typeof ctx.isEnabled !== 'function' || ctx.isEnabled('debug') !== true || typeof ctx.logEvent !== 'function') return
    ctx.logEvent('debug', 'edge.roster', { source: source, complete: complete, dirty: dirty, latencyMs: Date.now() - t0 })
  } catch {}
}

/**
 * 取当前邻接关系。名册路径：脏票逐张定向重读（读不回就整仓拉取兜底，不猜）；
 * 无名册路径：整仓拉取一次（老行为）。返回 Map 或 null（拉取失败）。
 * 每一条出口都发一行 `edge.roster`（附录 1.5 节 #102），说清这一趟走的是哪条路。
 */
export async function adjacencyFor(repo: RepositoryRef, ctx: MemoCtx): Promise<Map<string, Set<string>> | null> {
  const t0 = Date.now()
  const memo = ctx && ctx.memo
  const roster = memo && memo.roster
  const hasRoster = !!(roster && roster.complete === true)
  const dirtyCount = hasRoster ? Array.from((memo && memo.dirty) || []).length : 0
  if (hasRoster) {
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
      if (adj) {
        emitEdgeRoster(ctx, 'roster', true, dirtyCount, t0)
        return adj
      }
    }
  }
  let allRes = null as Awaited<ReturnType<typeof listIssues>> | null;
  try { allRes = await listIssues(repo, {}, ctx) } catch (e) { emitEdgeRoster(ctx, 'none', hasRoster, dirtyCount, t0); return null }
  if (!allRes || allRes.ok !== true || !Array.isArray(allRes.data)) { emitEdgeRoster(ctx, 'none', hasRoster, dirtyCount, t0); return null }
  const adj = new Map<string, Set<string>>()
  for (const issue of allRes.data as Issue[]) {
    const deps = Array.isArray(issue.blockedBy)
      ? (issue.blockedBy as unknown[]).map((b: unknown) => String(((b && typeof b === 'object' ? (b as unknown as Record<string, unknown>).key : undefined) || (b as unknown) || ''))).filter(Boolean)
      : []
    adj.set(String(issue.key), new Set(deps))
  }
  emitEdgeRoster(ctx, 'full-scan', hasRoster, dirtyCount, t0)
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
