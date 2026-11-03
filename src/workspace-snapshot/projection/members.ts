// projection/members.ts —— 列表与详情共用的几段只读查询：组三态、标签、指派。
//
// 为什么单列一份：列表投影与详情投影都要「一次 IN 查询把一页票的标签/指派/组状态读回来」，
// 各写一份迟早会分叉（一处按 position 排序、另一处忘了）。两个投影都从这里取，SQL 只有一份。
//
// 这些函数只读数据库，不写、不缓存、不记时间。
import type { DatabaseSync } from 'node:sqlite'
import type { GroupState, SnapshotActor, SnapshotLabel } from '../model/types.js'

/** 数据库里的字符串归一成三态；未知值按 unknown 处理，宁可说不知道也不冒充完整。 */
export function normalizeCompleteness(raw: string): 'complete' | 'truncated' | 'unknown' {
  if (raw === 'complete' || raw === 'truncated') return raw
  return 'unknown'
}

/** 只认两态；其它写法（大写、未知值）一律当「不知道」，不冒充 open。 */
export function normalizeState(raw: string | null): 'open' | 'closed' | null {
  const value = String(raw ?? '').toLowerCase()
  if (value === 'open' || value === 'closed') return value
  return null
}

interface GroupStateRow {
  issue_id: number
  group_name: string
  completeness: string
  reason: string | null
  source: string | null
  operation: string | null
  last_queried_ms: number
}

/** 一次读回这批票的若干组三态，避免每票一条查询。Map 的键是「代理键:组名」。 */
export function readGroupStates(
  db: DatabaseSync,
  issueIds: readonly number[],
  groupNames: readonly string[],
): Map<string, GroupState> {
  const out = new Map<string, GroupState>()
  if (issueIds.length === 0 || groupNames.length === 0) return out
  const placeholders = issueIds.map(() => '?').join(', ')
  const groupPlaceholders = groupNames.map(() => '?').join(', ')
  const rows = db.prepare(
    `SELECT issue_id, group_name, completeness, reason, source, operation, last_queried_ms
       FROM issue_group
      WHERE issue_id IN (${placeholders}) AND group_name IN (${groupPlaceholders})`,
  ).all(...issueIds, ...groupNames) as GroupStateRow[]
  for (const row of rows) {
    out.set(`${Number(row.issue_id)}:${row.group_name}`, {
      completeness: normalizeCompleteness(row.completeness),
      reason: row.reason,
      source: row.source,
      operation: row.operation,
      lastQueriedMs: Number(row.last_queried_ms),
    })
  }
  return out
}

/** 这批票的标签，按 position 排序。没有标签的票不出现在 Map 里。 */
export function readLabels(
  db: DatabaseSync,
  issueIds: readonly number[],
): Map<number, SnapshotLabel[]> {
  const out = new Map<number, SnapshotLabel[]>()
  if (issueIds.length === 0) return out
  const placeholders = issueIds.map(() => '?').join(', ')
  const rows = db.prepare(
    `SELECT il.issue_id, l.name, l.color, l.description
       FROM issue_label il
       JOIN label l ON l.name = il.label_name
      WHERE il.issue_id IN (${placeholders})
      ORDER BY il.issue_id, il.position`,
  ).all(...issueIds) as Array<{
    issue_id: number
    name: string
    color: string | null
    description: string | null
  }>
  for (const row of rows) {
    const issueId = Number(row.issue_id)
    const list = out.get(issueId) ?? []
    list.push({ name: row.name, color: row.color, description: row.description })
    out.set(issueId, list)
  }
  return out
}

/** 这批票的指派人，按 position 排序。没有指派人的票不出现在 Map 里。 */
export function readAssignees(
  db: DatabaseSync,
  issueIds: readonly number[],
): Map<number, SnapshotActor[]> {
  const out = new Map<number, SnapshotActor[]>()
  if (issueIds.length === 0) return out
  const placeholders = issueIds.map(() => '?').join(', ')
  const rows = db.prepare(
    `SELECT ia.issue_id, a.login, a.kind, a.name, a.avatar_url
       FROM issue_assignee ia
       JOIN actor a ON a.actor_id = ia.actor_id
      WHERE ia.issue_id IN (${placeholders})
      ORDER BY ia.issue_id, ia.position`,
  ).all(...issueIds) as Array<{
    issue_id: number
    login: string
    kind: string | null
    name: string | null
    avatar_url: string | null
  }>
  for (const row of rows) {
    const issueId = Number(row.issue_id)
    const list = out.get(issueId) ?? []
    list.push({
      login: row.login,
      kind: row.kind,
      name: row.name,
      avatarUrl: row.avatar_url,
    })
    out.set(issueId, list)
  }
  return out
}
