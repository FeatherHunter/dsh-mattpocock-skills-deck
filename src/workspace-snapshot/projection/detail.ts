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
  SnapshotComment,
  SnapshotReview,
  SubIssueCountsValue,
} from '../model/types.js'
import { readFetchCursor } from '../persistence/fetch-cursor.js'
import { COMMENTS_GROUP } from '../persistence/comment-write.js'
import { readMergeVersion } from '../persistence/schema.js'
import { withReadTransaction } from '../persistence/read-transaction.js'
import { readIssueDetailEdges } from './edges.js'
import { readAssignees, readGroupStates, readLabels } from './members.js'
import { reportReadStep, type ReadStepHook } from './read-step.js'

/** 详情要读的十组。顺序固定：门禁与排查都按这一份看。 */
const DETAIL_GROUPS = [
  'row',
  'body',
  'labels',
  'assignees',
  'parents',
  'blockedBy',
  'subIssues',
  'mergeInfo',
  'comments',
  'review',
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
  onReadStep?: ReadStepHook | null,
): IssueDetailProjection {
  const key = String(query?.key ?? '')
  if (!key) throw new Error('readIssueDetail 缺少 key')
  const effortId = query?.effortId === undefined || query?.effortId === null ? '' : String(query.effortId)
  // 版本、行、正文、边、评论、评审必须在同一个读事务里：中间提交的一笔写会让详情页的
  // 「版本」与「值」来自两个时刻（理由与事务的长度约束见 persistence/read-transaction.ts）。
  return withReadTransaction(db, () => readIssueDetailRows(db, effortId, key, nowMs, onReadStep))
}

/** 详情投影在事务里的那一段；拆出来只为让事务边界一眼看得见，行为与拆分前逐字相同。 */
function readIssueDetailRows(
  db: DatabaseSync,
  effortId: string,
  key: string,
  nowMs: number,
  onReadStep: ReadStepHook | null | undefined,
): IssueDetailProjection {
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

  reportReadStep(onReadStep, 'detail-after-row')
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
    comments: stateOf('comments'),
    review: stateOf('review'),
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
    comments: readComments(db, issueId),
    commentsCursor: cursorTextOf(db, issueId),
    reviews: readReviews(db, issueId),
    groups,
    lastKnownAtMs: lastQueriedOf(groups),
    referenceSkeleton: groups.row === null,
  }
  return { mergeVersion, generatedAtMs: nowMs, issue }
}

/**
 * 评论按 position 读回（#1865）。位置就是顺序，也是这一组的身份：后端每次从第 0 条开始给，
 * 所以库里第几行就是「从头数第几条」。作者从 actor 表 join 回来，作者信息只在库里存一份。
 */
function readComments(db: DatabaseSync, issueId: number): SnapshotComment[] {
  const rows = db.prepare(
    `SELECT c.backend_id AS backend_id, c.author_association AS author_association,
            c.body AS body, c.created_at_ms AS created_at_ms,
            c.updated_at_ms AS updated_at_ms, c.edited_at_ms AS edited_at_ms,
            a.login AS login, a.kind AS kind, a.name AS name, a.avatar_url AS avatar_url
       FROM comment c LEFT JOIN actor a ON a.actor_id = c.author_id
      WHERE c.issue_id = ? ORDER BY c.position`,
  ).all(issueId) as Array<{
    backend_id: string | null
    author_association: string | null
    body: string
    created_at_ms: number | null
    updated_at_ms: number | null
    edited_at_ms: number | null
    login: string | null
    kind: string | null
    name: string | null
    avatar_url: string | null
  }>
  return rows.map((row) => {
    const comment: SnapshotComment = {
      authorAssociation: row.author_association,
      body: row.body,
      createdAtMs: nullableNumber(row.created_at_ms),
      updatedAtMs: nullableNumber(row.updated_at_ms),
      editedAtMs: nullableNumber(row.edited_at_ms),
    }
    if (row.backend_id !== null) comment.backendId = row.backend_id
    if (row.login !== null) {
      comment.author = { login: row.login, kind: row.kind, name: row.name, avatarUrl: row.avatar_url }
    }
    return comment
  })
}

/** 评审按 position 读回。 */
function readReviews(db: DatabaseSync, issueId: number): SnapshotReview[] {
  const rows = db.prepare(
    `SELECT r.state AS state, r.submitted_at_ms AS submitted_at_ms,
            a.login AS login, a.kind AS kind, a.name AS name, a.avatar_url AS avatar_url
       FROM review r LEFT JOIN actor a ON a.actor_id = r.reviewer_id
      WHERE r.issue_id = ? ORDER BY r.position`,
  ).all(issueId) as Array<{
    state: string
    submitted_at_ms: number | null
    login: string | null
    kind: string | null
    name: string | null
    avatar_url: string | null
  }>
  return rows.map((row) => {
    const review: SnapshotReview = { state: row.state, submittedAtMs: nullableNumber(row.submitted_at_ms) }
    if (row.login !== null) {
      review.reviewer = { login: row.login, kind: row.kind, name: row.name, avatarUrl: row.avatar_url }
    }
    return review
  })
}

/** 评论游标（取到第几条）；没有游标行时给 null，界面据此知道「评论从没取过」。 */
function cursorTextOf(db: DatabaseSync, issueId: number): string | null {
  const current = readFetchCursor(db, issueId, COMMENTS_GROUP)
  return current === null ? null : String(current)
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
