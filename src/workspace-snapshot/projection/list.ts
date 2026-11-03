// projection/list.ts —— 列表读投影：把库里的行拼成界面要的形状。
//
// 列表只返回「有 row 组记录」的票。原因：issue 行也可能是别的票的依赖边提到时建的引用骨架
// （只有身份，没有标题/状态），那种行不该出现在列表里。row 组即使是 truncated / unknown
// 也返回，并带上三态与来源——界面才能说「这行不全」而不是把它当完整数据。
//
// 排序按状态、更新时间倒序、票号升序：状态相同的票最近更新的在前，时间相同的用票号定序，
// 保证同一份库每次读出来的顺序稳定（分页与门禁都需要）。
import type { DatabaseSync } from 'node:sqlite'
import type {
  GroupState,
  IssueRowValue,
  ListIssue,
  ListProjection,
  ListQuery,
  SnapshotActor,
  SnapshotLabel,
} from '../model/types.js'
import { readMergeVersion } from '../persistence/schema.js'
import { readIssueEdges } from './edges.js'

interface ListRow {
  issue_id: number
  effort_id: string
  key: string
  type: string | null
  title: string | null
  state: string | null
  url: string | null
  created_at_ms: number | null
  updated_at_ms: number | null
  closed_at_ms: number | null
  reason: string | null
  is_pull_request: number | null
  merged_at_ms: number | null
  comment_count: number | null
  sub_total: number | null
  sub_completed: number | null
  sub_percent: number | null
  milestone_json: string | null
  custom_fields_json: string | null
  status: string | null
  status_visible: string | null
  status_source: string | null
  status_conflict_json: string | null
  row_completeness: string
  row_reason: string | null
  row_source: string | null
  row_operation: string | null
  row_last_queried_ms: number
}

/**
 * 读一页列表。query.state 缺省 open；all 不筛状态。query.limit 缺省不限制
 * （本票没有分页游标，limit 只是给调用方一个上限，避免一次拉全库）。
 */
export function readListProjection(
  db: DatabaseSync,
  query: ListQuery | undefined,
  nowMs: number,
): ListProjection {
  const state = query?.state ?? 'open'
  if (state !== 'open' && state !== 'closed' && state !== 'all') {
    throw new Error(`readList 不认识的状态：${String(state)}`)
  }
  const limit = normalizeLimit(query?.limit)

  const where = state === 'all' ? '' : 'WHERE i.state = ?'
  const sql = `
    SELECT i.issue_id, i.effort_id, i.key, i.type, i.title, i.state, i.url,
           i.created_at_ms, i.updated_at_ms, i.closed_at_ms, i.reason,
           i.is_pull_request, i.merged_at_ms, i.comment_count,
           i.sub_total, i.sub_completed, i.sub_percent,
           i.milestone_json, i.custom_fields_json,
           i.status, i.status_visible, i.status_source, i.status_conflict_json,
           g.completeness AS row_completeness,
           g.reason AS row_reason,
           g.source AS row_source,
           g.operation AS row_operation,
           g.last_queried_ms AS row_last_queried_ms
      FROM issue i
      JOIN issue_group g ON g.issue_id = i.issue_id AND g.group_name = 'row'
      ${where}
     ORDER BY i.state ASC, i.updated_at_ms DESC, i.key ASC
     ${limit === null ? '' : 'LIMIT ?'}`
  const params: Array<string | number> = state === 'all' ? [] : [state]
  if (limit !== null) params.push(limit)
  const rows = db.prepare(sql).all(...params) as ListRow[]

  const issueIds = rows.map((row) => Number(row.issue_id))
  const groupStates = readGroupStates(db, issueIds, ['labels', 'assignees', 'parents', 'blockedBy'])
  const labelsByIssue = readLabels(db, issueIds)
  const assigneesByIssue = readAssignees(db, issueIds)
  const edgesByIssue = readIssueEdges(db, issueIds)

  const issues: ListIssue[] = rows.map((row) => {
    const issueId = Number(row.issue_id)
    return {
      effortId: row.effort_id,
      key: row.key,
      row: toRowValue(row),
      labels: labelsByIssue.get(issueId) ?? [],
      assignees: assigneesByIssue.get(issueId) ?? [],
      parents: edgesByIssue.get(issueId)?.parents ?? [],
      blockedBy: edgesByIssue.get(issueId)?.blockedBy ?? [],
      groups: {
        row: {
          completeness: normalizeCompleteness(row.row_completeness),
          reason: row.row_reason,
          source: row.row_source,
          operation: row.row_operation,
          lastQueriedMs: Number(row.row_last_queried_ms),
        },
        labels: groupStates.get(`${issueId}:labels`) ?? null,
        assignees: groupStates.get(`${issueId}:assignees`) ?? null,
        parents: groupStates.get(`${issueId}:parents`) ?? null,
        blockedBy: groupStates.get(`${issueId}:blockedBy`) ?? null,
      },
    }
  })

  return {
    mergeVersion: readMergeVersion(db),
    generatedAtMs: nowMs,
    issues,
  }
}

function normalizeLimit(raw: number | undefined): number | null {
  if (raw === undefined) return null
  if (!Number.isInteger(raw) || raw <= 0) {
    throw new Error(`readList 的 limit 必须是正整数，收到：${String(raw)}`)
  }
  return raw
}

/** 数据库里的字符串归一成三态；未知值按 unknown 处理，宁可说不知道也不冒充完整。 */
function normalizeCompleteness(raw: string): 'complete' | 'truncated' | 'unknown' {
  if (raw === 'complete' || raw === 'truncated') return raw
  return 'unknown'
}

function toRowValue(row: ListRow): IssueRowValue {
  return {
    type: row.type,
    title: row.title,
    state: row.state,
    url: row.url,
    createdAtMs: nullableNumber(row.created_at_ms),
    updatedAtMs: nullableNumber(row.updated_at_ms),
    closedAtMs: nullableNumber(row.closed_at_ms),
    stateReason: row.reason,
    isPullRequest: row.is_pull_request === null ? null : Number(row.is_pull_request) !== 0,
    mergedAtMs: nullableNumber(row.merged_at_ms),
    commentCount: nullableNumber(row.comment_count),
    subTotal: nullableNumber(row.sub_total),
    subCompleted: nullableNumber(row.sub_completed),
    subPercent: nullableNumber(row.sub_percent),
    milestoneJson: row.milestone_json,
    customFieldsJson: row.custom_fields_json,
    status: row.status,
    statusVisible: row.status_visible,
    statusSource: row.status_source,
    statusConflictJson: row.status_conflict_json,
  }
}

function nullableNumber(value: number | null): number | null {
  return value === null ? null : Number(value)
}

/** 一次读回这页所有票的标签/指派组三态，避免每票一条查询。 */
function readGroupStates(
  db: DatabaseSync,
  issueIds: readonly number[],
  groupNames: readonly string[],
): Map<string, GroupState> {
  const out = new Map<string, GroupState>()
  if (issueIds.length === 0) return out
  const placeholders = issueIds.map(() => '?').join(', ')
  const groupPlaceholders = groupNames.map(() => '?').join(', ')
  const rows = db.prepare(
    `SELECT issue_id, group_name, completeness, reason, source, operation, last_queried_ms
       FROM issue_group
      WHERE issue_id IN (${placeholders}) AND group_name IN (${groupPlaceholders})`,
  ).all(...issueIds, ...groupNames) as Array<{
    issue_id: number
    group_name: string
    completeness: string
    reason: string | null
    source: string | null
    operation: string | null
    last_queried_ms: number
  }>
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

function readLabels(
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

function readAssignees(
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
