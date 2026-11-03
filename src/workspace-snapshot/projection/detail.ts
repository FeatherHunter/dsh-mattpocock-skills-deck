// projection/detail.ts —— 详情读投影：一张票的行、正文、标签、指派、四个方向的关系与各组三态。
//
// 为什么单列一份而不是塞进 list.ts：详情要读正文（独立表）与四个方向的关系边，列表永远不读
// 正文、只读两个正向边；两者的查询与形状都不同。共用的是 members.ts 里那几段只读查询。
//
// 三态怎么读：每一组都带着 issue_group 的完整度与时刻。界面靠它区分两件事——
//   complete 且值为空 = 完整查过、确认没有；
//   没有组记录或 unknown = 不知道，此时旧值仍然照读（unknown 不删上次已知），并给出时刻。
//
// 引用骨架：别的票的边提到、自己还没被完整取过的票，没有 row 组记录。这种行照读（关系要画得
// 出来），但 referenceSkeleton 为真，列表投影不会把它当完整票。
import type { DatabaseSync } from 'node:sqlite'
import type {
  DetailGroupStates,
  GroupState,
  IssueDetail,
  IssueDetailProjection,
  IssueDetailQuery,
  IssueRowValue,
  SubIssueCountsValue,
} from '../model/types.js'
import { readMergeVersion } from '../persistence/schema.js'
import { readIssueDetailEdges } from './edges.js'
import { readAssignees, readGroupStates, readLabels } from './members.js'

/** 详情要读的八组。顺序固定：门禁与排查都按这一份看。 */
const DETAIL_GROUPS = [
  'row',
  'body',
  'labels',
  'assignees',
  'parents',
  'blockedBy',
  'subIssues',
  'mergeInfo',
] as const

interface DetailRow {
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
 * 读一张票的详情。库里没有这张票（连骨架都没有）时 issue 为 null。
 *
 * key 是必填的：没有票号的查询没有意义，直接抛错比返回一个空壳更容易发现接线写错。
 */
export function readIssueDetailProjection(
  db: DatabaseSync,
  query: IssueDetailQuery | undefined,
  nowMs: number,
): IssueDetailProjection {
  const key = String(query?.key ?? '')
  if (!key) throw new Error('readIssueDetail 缺少 key')
  const effortId = query?.effortId === undefined || query?.effortId === null ? '' : String(query.effortId)
  const mergeVersion = readMergeVersion(db)
  const row = db.prepare(
    `SELECT issue_id, effort_id, key, type, title, state, url,
            created_at_ms, updated_at_ms, closed_at_ms, reason,
            is_pull_request, merged_at_ms, comment_count,
            sub_total, sub_completed, sub_percent,
            milestone_json, custom_fields_json,
            status, status_visible, status_source, status_conflict_json
       FROM issue
      WHERE effort_id = ? AND key = ?`,
  ).get(effortId, key) as DetailRow | undefined
  if (!row) return { mergeVersion, generatedAtMs: nowMs, issue: null }

  const issueId = Number(row.issue_id)
  const states = readGroupStates(db, [issueId], DETAIL_GROUPS)
  const stateOf = (name: string): GroupState | null => states.get(`${issueId}:${name}`) ?? null
  const bodyRow = db.prepare('SELECT body FROM issue_body WHERE issue_id = ?').get(issueId) as
    | { body?: string }
    | undefined
  const edges = readIssueDetailEdges(db, issueId)
  const groups: DetailGroupStates = {
    row: stateOf('row'),
    body: stateOf('body'),
    labels: stateOf('labels'),
    assignees: stateOf('assignees'),
    parents: stateOf('parents'),
    blockedBy: stateOf('blockedBy'),
    subIssues: stateOf('subIssues'),
    mergeInfo: stateOf('mergeInfo'),
  }
  const issue: IssueDetail = {
    effortId: row.effort_id,
    key: row.key,
    row: toRowValue(row),
    body: bodyTextOf(groups.body, bodyRow),
    labels: readLabels(db, [issueId]).get(issueId) ?? [],
    assignees: readAssignees(db, [issueId]).get(issueId) ?? [],
    parents: edges.parents,
    blockedBy: edges.blockedBy,
    blocking: edges.blocking,
    children: edges.children,
    subIssues: subIssuesOf(row, groups.subIssues),
    mergedAtMs: nullableNumber(row.merged_at_ms),
    groups,
    lastKnownAtMs: lastQueriedOf(groups),
    referenceSkeleton: groups.row === null,
  }
  return { mergeVersion, generatedAtMs: nowMs, issue }
}

/**
 * 正文怎么读：complete 且没有正文行 = 确认没有正文（空串）；其余情况有正文行就给正文，
 * 没有正文行就回 null（不知道）。unknown 不删上次已知，所以它照样能读到旧正文。
 */
function bodyTextOf(state: GroupState | null, row: { body?: string } | undefined): string | null {
  const text = row && typeof row.body === 'string' ? row.body : null
  if (state && state.completeness === 'complete') return text ?? ''
  return text
}

/** 子票计数：三列全空才是「没有值」；有一列就照读，是否确认由组三态表达。 */
function subIssuesOf(row: DetailRow, state: GroupState | null): SubIssueCountsValue | null {
  if (row.sub_total === null && row.sub_completed === null && row.sub_percent === null) return null
  if (state && state.completeness === 'unknown' && row.sub_total === null) return null
  return {
    total: Number(row.sub_total ?? 0),
    completed: Number(row.sub_completed ?? 0),
    percent: nullableNumber(row.sub_percent),
  }
}

/** 各组里最后一次被查询的时刻。一组都没有时给 0（界面据此不标时间）。 */
function lastQueriedOf(groups: DetailGroupStates): number {
  let latest = 0
  for (const name of DETAIL_GROUPS) {
    const state = groups[name]
    if (state && state.lastQueriedMs > latest) latest = state.lastQueriedMs
  }
  return latest
}

function toRowValue(row: DetailRow): IssueRowValue {
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
