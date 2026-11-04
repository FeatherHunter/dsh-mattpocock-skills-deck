// projection/list.ts —— 列表读投影：把库里的行拼成界面要的形状。
//
// 列表只返回「有 row 组记录」的票。原因：issue 行也可能是别的票的依赖边提到时建的引用骨架
// （只有身份，没有标题/状态），那种行不该出现在列表里。row 组即使是 truncated / unknown
// 也返回，并带上三态与来源——界面才能说「这行不全」而不是把它当完整数据。
//
// 排序按状态、更新时间倒序、票号升序：状态相同的票最近更新的在前，时间相同的用票号定序，
// 保证同一份库每次读出来的顺序稳定（分页与门禁都需要）。
//
// 正文不进列表：它是几十 KB 的大字段，列表查询永远不该读它（#1864 把它挪到 issue_body）。
// 子票计数与合并时间各自由自己的组读，行组不再带它们——一行只有一个主人。
import type { DatabaseSync } from 'node:sqlite'
import type {
  GroupState,
  IssueRowValue,
  ListIssue,
  ListProjection,
  ListQuery,
  SubIssueCountsValue,
} from '../model/types.js'
import { readMergeVersion } from '../persistence/schema.js'
import { readIssueEdges } from './edges.js'
import {
  normalizeCompleteness,
  readAssignees,
  readGroupStates,
  readLabels,
} from './members.js'

/** 列表要读的组三态：正文只读状态（不读内容），其余按组读。 */
const LIST_GROUPS = ['row', 'body', 'labels', 'assignees', 'parents', 'blockedBy', 'subIssues', 'mergeInfo'] as const

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
           i.status, i.status_visible, i.status_source, i.status_conflict_json
      FROM issue i
      JOIN issue_group g ON g.issue_id = i.issue_id AND g.group_name = 'row'
      ${where}
     ORDER BY i.state ASC, i.updated_at_ms DESC, i.key ASC
     ${limit === null ? '' : 'LIMIT ?'}`
  const params: Array<string | number> = state === 'all' ? [] : [state]
  if (limit !== null) params.push(limit)
  const rows = db.prepare(sql).all(...params) as ListRow[]

  const issueIds = rows.map((row) => Number(row.issue_id))
  const groupStates = readGroupStates(db, issueIds, LIST_GROUPS)
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
      subIssues: toSubIssueCounts(row, groupStates.get(`${issueId}:subIssues`) ?? null),
      mergedAtMs: nullableNumber(row.merged_at_ms),
      groups: {
        row: groupStates.get(`${issueId}:row`) ?? null,
        body: groupStates.get(`${issueId}:body`) ?? null,
        labels: groupStates.get(`${issueId}:labels`) ?? null,
        assignees: groupStates.get(`${issueId}:assignees`) ?? null,
        parents: groupStates.get(`${issueId}:parents`) ?? null,
        blockedBy: groupStates.get(`${issueId}:blockedBy`) ?? null,
        subIssues: groupStates.get(`${issueId}:subIssues`) ?? null,
        mergeInfo: groupStates.get(`${issueId}:mergeInfo`) ?? null,
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

/**
 * 子票计数：只有这一组确实取到（complete / truncated）时才给值；没有组记录或 unknown 回 null。
 * 为什么看组而不只看列：列上的 0 与「从来没取过」在库里长得一样，语义只能由三态表达。
 */
function toSubIssueCounts(row: ListRow, group: GroupState | null): SubIssueCountsValue | null {
  if (!group || group.completeness === 'unknown') return null
  return {
    total: Number(row.sub_total ?? 0),
    completed: Number(row.sub_completed ?? 0),
    percent: nullableNumber(row.sub_percent),
  }
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
    commentCount: nullableNumber(row.comment_count),
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
