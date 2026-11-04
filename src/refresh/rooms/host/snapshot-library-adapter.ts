/**
 * src/refresh/rooms/host/snapshot-library-adapter.ts —— tracker 读结果与快照库之间的纯换算（#1863、#1864）
 *
 * 为什么单列：快照层不许 import 宿主或刷新，refresh 也不该把 tracker 的 Issue 直接塞进库；
 * 这一层只做「tracker 契约 ↔ 快照契约」的搬运，不碰数据库、不发请求、不记时间，方便单测。
 *
 * 一条约定必须记住：库里一个字段组的「没写过」与「写空了」是两回事。所以换算时只在该组
 * 确实取到时才写：labels/assignees 字段缺席 = 这个后端给不了（不写组）；blockedBy 没有
 * fieldStates.dependencies 且字段也缺席 = 能力没有（不写组）。parents 是核心字段，永远写：
 * 有 fieldStates 就按三态，没有就按旧口径把 parentKey 当完整值。
 *
 * #1864 起详情也走同一套换算：正文、子票计数、合并信息各自成组，不塞进行组——行组是
 * 「整行我都知道」的语义，详情读结果未必知道这几项，混进去会把列表学到的值一起抹掉。
 *
 * #1865 起评论与评审也成组：评论按页写、按页读（游标在库里），评审整组替换。评论组的完整度
 * 由「取到的条数够不够票面总数」决定：够就是 complete，不够才是 truncated；票面总数不知道时
 * 只敢说 truncated——宁可下次再取一趟，也不能把「只取到前几条」说成「一共就这几条」。
 *
 * 读方向（库里的投影 → tracker 的 Issue / 界面认的详情形状）在同一目录的 snapshot-library-view.ts。
 */
import type { Comment, Issue, IssueFieldStates, Review } from '../../../tracker/contract/entities.js'
import type {
  IssueGroupsWrite,
  IssueRowValue,
  IssueWrite,
  SnapshotActor,
  SnapshotComment,
  SnapshotLabel,
  SnapshotReview,
} from '../../../workspace-snapshot/contract/types.js'

/** 写入来源标签，落进 issue_group.source；排查时能分清这批数据是列表电话还是详情电话给的。 */
const SOURCE_LIST = 'refresh-list'
const OPERATION_LIST = 'list'
const SOURCE_DETAIL = 'refresh-detail'
const OPERATION_DETAIL = 'get'
// #1865：评论分页是另一条电话（wf.issueComments），来源与操作名单独记，排查时一眼看得出来。
const SOURCE_COMMENTS = 'refresh-comments'
const OPERATION_COMMENTS = 'listComments'

/** ISO 时间转毫秒；空串、null、解析不了都回 null（不写 0，0 会被当成 1970 年的真实时间）。 */
export function msOf(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function nonEmptyString(value: unknown): string | null {
  return (typeof value === 'string' && value) ? value : null
}

function complete<T>(value: T, source = SOURCE_LIST, operation = OPERATION_LIST): { completeness: 'complete', value: T, source: string, operation: string } {
  return { completeness: 'complete', value, source, operation }
}

function unknownGroup<T>(reason: string | null | undefined, source = SOURCE_LIST, operation = OPERATION_LIST) {
  return { completeness: 'unknown' as const, reason: reason || 'not-expressed', source, operation }
}

/**
 * 后端能力差异：这两个后端原生都没有「评审」与「合并信息」，GitLab 另外还没有「子票计数」。
 *
 * 为什么必须在库里写成 unknown + not-applicable，而不是不写或写空值：
 *  - 不写 = 从没取过，界面只能说「不知道」；
 *  - 写 complete + 空值 = 「确认没有」，那是谎话（GitLab 不是「确认没有评审」，而是根本没有评审这回事）；
 *  - unknown + not-applicable 才是准确的说法：这一组对这个后端不适用。
 *
 * 本地 Markdown 的子票计数不在这段里写死「不适用」：它**有**子票（#1826 落了真实现），只是现在的读
 * 结果不带这组计数——那是「这次没表达」而不是「这个后端没有」，两件事不能混成一句。
 *
 * 只补还没有表达过的组：将来真给出了合并时间或评审明细，真实的组会先生成，这里一个字节都不动。
 */
function applyBackendCapabilityGaps(groups: IssueGroupsWrite, backend: string, source: string, operation: string, withReview: boolean): void {
  if (backend !== 'gitlab' && backend !== 'markdown') return
  if (backend === 'gitlab' && groups.subIssues === undefined) groups.subIssues = unknownGroup('not-applicable', source, operation)
  if (groups.mergeInfo === undefined) groups.mergeInfo = unknownGroup('not-applicable', source, operation)
  if (withReview && groups.review === undefined) groups.review = unknownGroup('not-applicable', source, operation) as IssueGroupsWrite['review']
}

function labelsOf(issue: Issue): SnapshotLabel[] {
  return (Array.isArray(issue.labels) ? issue.labels : [])
    .filter((item) => item && typeof item.name === 'string' && item.name)
    .map((item) => {
      const label: SnapshotLabel = { name: item.name }
      if (item.color) label.color = item.color
      if (item.description) label.description = item.description
      return label
    })
}

function actorsOf(issue: Issue): SnapshotActor[] {
  return (Array.isArray(issue.assignees) ? issue.assignees : [])
    .filter((item) => item && typeof item.login === 'string' && item.login)
    .map((item) => {
      const actor: SnapshotActor = { login: item.login }
      if (item.kind) actor.kind = item.kind
      if (item.name) actor.name = item.name
      if (item.avatarUrl) actor.avatarUrl = item.avatarUrl
      return actor
    })
}

function refKeysOf(issue: Issue): string[] {
  return (Array.isArray(issue.blockedBy) ? issue.blockedBy : [])
    .map((ref) => (ref && ref.key != null ? String(ref.key) : ''))
    .filter((key) => key !== '')
}

/**
 * 把一张 tracker 票换成一行的组写入（行组部分）。
 *
 * 时间一律换算成毫秒（库的地基单位）；state 写小写原文，读回时上层再按需要转大写。
 * isPullRequest 只在后端明确给出布尔值时落值：null 表示不知道，组装层靠「属性在不在」
 * 区分拉取请求与普通票，写成 null 会让两类票混在一起。
 *
 * 子票计数与合并时间不在这里：它们各自成组（见 subIssuesGroupOf / mergeInfoGroupOf）。
 */
export function issueRowValueOf(issue: Issue): IssueRowValue {
  const row: IssueRowValue = {
    type: nonEmptyString(issue.type) || 'issue',
    title: typeof issue.title === 'string' ? issue.title : '',
    state: nonEmptyString(issue.state),
    url: nonEmptyString(issue.url),
    createdAtMs: msOf(issue.createdAt),
    updatedAtMs: msOf(issue.updatedAt),
    closedAtMs: msOf(issue.closedAt),
    stateReason: nonEmptyString(issue.reason),
  }
  if (typeof issue.isPullRequest === 'boolean') row.isPullRequest = issue.isPullRequest
  const states: IssueFieldStates | undefined = issue.fieldStates
  if (states && states.comments && states.comments.known) row.commentCount = states.comments.value
  else if (typeof issue.commentCount === 'number') row.commentCount = issue.commentCount
  if (issue.milestone) row.milestoneJson = JSON.stringify(issue.milestone)
  if (issue.customFields) row.customFieldsJson = JSON.stringify(issue.customFields)
  if (issue.status) {
    row.status = issue.status
    row.statusVisible = issue.statusVisible || null
    row.statusSource = issue.statusSource || null
  } else if (issue.statusVisible) {
    row.statusVisible = issue.statusVisible
    row.statusSource = issue.statusSource || null
  }
  if (issue.statusConflict) row.statusConflictJson = JSON.stringify(issue.statusConflict)
  return row
}

/** 子票计数组：有 fieldStates 就按三态，没有就不表达（不拿 0 冒充「确认没有」）。 */
function subIssuesGroupOf(issue: Issue): IssueGroupsWrite['subIssues'] {
  const states = issue.fieldStates
  if (!states || !states.subIssues) return undefined
  if (!states.subIssues.known) return unknownGroup(states.subIssues.reason, SOURCE_DETAIL, OPERATION_DETAIL)
  const value = states.subIssues.value
  return complete({ total: value.total, completed: value.completed, percent: value.percentCompleted }, SOURCE_DETAIL, OPERATION_DETAIL)
}

/** 合并信息组：有 fieldStates 就按三态，没有就按 mergedAt 字段（有值才算表达过）。 */
function mergeInfoGroupOf(issue: Issue): IssueGroupsWrite['mergeInfo'] {
  const states = issue.fieldStates
  if (states && states.mergeInfo) {
    if (!states.mergeInfo.known) return unknownGroup(states.mergeInfo.reason, SOURCE_DETAIL, OPERATION_DETAIL)
    return complete(msOf(states.mergeInfo.value), SOURCE_DETAIL, OPERATION_DETAIL)
  }
  if (issue.mergedAt === undefined) return undefined
  return complete(msOf(issue.mergedAt), SOURCE_DETAIL, OPERATION_DETAIL)
}

/** 父票组：核心字段永远写；有 fieldStates 就按三态，没有就把 parentKey 当完整值。 */
function parentsGroupOf(issue: Issue, source: string, operation: string): IssueGroupsWrite['parents'] {
  const states = issue.fieldStates
  if (states && states.parents) {
    return states.parents.known
      ? complete(states.parents.value ? [String(states.parents.value)] : [], source, operation)
      : unknownGroup(states.parents.reason, source, operation)
  }
  return complete(issue.parentKey != null ? [String(issue.parentKey)] : [], source, operation)
}

/** 阻塞边组：有 fieldStates 就按三态，没有就看字段在不在。 */
function blockedByGroupOf(issue: Issue, source: string, operation: string): IssueGroupsWrite['blockedBy'] {
  const states = issue.fieldStates
  if (states && states.dependencies) {
    return states.dependencies.known
      ? complete(states.dependencies.value.map((ref) => String(ref.key)), source, operation)
      : unknownGroup(states.dependencies.reason, source, operation)
  }
  if (Array.isArray(issue.blockedBy)) return complete(refKeysOf(issue), source, operation)
  return undefined
}

/** 一张票的组写入（列表电话）：只写这次真取到的那几组；`backend` 用来标出后端能力差异。 */
export function issueWriteOf(issue: Issue, backend = ''): IssueWrite {
  const groups: IssueGroupsWrite = { row: complete(issueRowValueOf(issue)) }
  if (Array.isArray(issue.labels)) groups.labels = complete(labelsOf(issue))
  if (Array.isArray(issue.assignees)) groups.assignees = complete(actorsOf(issue))
  groups.parents = parentsGroupOf(issue, SOURCE_LIST, OPERATION_LIST)
  groups.blockedBy = blockedByGroupOf(issue, SOURCE_LIST, OPERATION_LIST)
  // 子票计数与合并信息：列表读结果里也常常带着（fieldStates 表态），照样按组写。
  const subIssues = subIssuesGroupOf(issue)
  if (subIssues !== undefined) groups.subIssues = subIssues
  const mergeInfo = mergeInfoGroupOf(issue)
  if (mergeInfo !== undefined) groups.mergeInfo = mergeInfo
  applyBackendCapabilityGaps(groups, backend, SOURCE_LIST, OPERATION_LIST, false)
  return { effortId: String(issue.effortId || ''), key: String(issue.key), groups }
}

/**
 * 一张票的组写入（详情电话）：比列表多表达正文、评论与评审。
 *
 * 正文按组写：complete + 空串 = 确认没有正文，完整取到的正文整组换掉。
 * 详情是完整行来源，所以行组、标签、指派都按 complete 写（缺的字段就是确认没有）。
 *
 * `backend` 只用于标记后端能力差异（今天只有 GitLab 的三组）；不给时行为与接线前一致。
 */
export function detailIssueWriteOf(issue: Issue, backend = ''): IssueWrite {
  const write = issueWriteOf(issue)
  write.groups.body = complete(typeof issue.body === 'string' ? issue.body : '', SOURCE_DETAIL, OPERATION_DETAIL)
  // 详情读结果里标签/指派是完整来源（有就给，没有就是确认没有）。
  if (!Array.isArray(issue.labels)) write.groups.labels = complete([], SOURCE_DETAIL, OPERATION_DETAIL)
  if (!Array.isArray(issue.assignees)) write.groups.assignees = complete([], SOURCE_DETAIL, OPERATION_DETAIL)
  const comments = commentsGroupOf(issue, SOURCE_DETAIL, OPERATION_DETAIL)
  if (comments !== undefined) write.groups.comments = comments
  const review = reviewsGroupOf(issue, SOURCE_DETAIL, OPERATION_DETAIL)
  if (review !== undefined) write.groups.review = review
  write.groups.row = complete(issueRowValueOf(issue), SOURCE_DETAIL, OPERATION_DETAIL)
  applyBackendCapabilityGaps(write.groups, backend, SOURCE_DETAIL, OPERATION_DETAIL, true)
  return write
}

/**
 * 一张票的组写入（评论分页电话）：只表达评论这一组。
 *
 * 为什么只写评论：这条电话要回来的是一整张票，但它是为了「加载更多」发的；把行、正文、标签
 * 一起重写一遍既没必要，也会把详情那边刚写好的组时刻推新，让详情看起来比实际新。
 */
export function commentPageWriteOf(issue: Issue): IssueWrite {
  const groups: IssueGroupsWrite = {}
  const comments = commentsGroupOf(issue, SOURCE_COMMENTS, OPERATION_COMMENTS)
  if (comments !== undefined) groups.comments = comments
  return { effortId: String(issue.effortId || ''), key: String(issue.key), groups }
}

/** 票面评论总数：后端给了总数才算知道；不知道时回 null（不许拿已取条数冒充总数）。 */
function commentTotalOf(issue: Issue): number | null {
  const states = issue.fieldStates
  if (states && states.comments) {
    if (!states.comments.known) return null
    const value = states.comments.value
    return typeof value === 'number' && isFinite(value) && value >= 0 ? Math.floor(value) : null
  }
  const raw = issue.commentCount
  return typeof raw === 'number' && isFinite(raw) && raw >= 0 ? Math.floor(raw) : null
}

/** 契约的评论数组 → 库里的评论值。时间换算成毫秒；后端没给作者就整个字段不写。 */
function commentsOf(issue: Issue): SnapshotComment[] {
  return (Array.isArray(issue.comments) ? issue.comments : [])
    .filter((item) => item && typeof item.body === 'string')
    .map((item: Comment) => {
      const out: SnapshotComment = { body: item.body }
      if (typeof item.id === 'string' && item.id) out.backendId = item.id
      if (item.author && typeof item.author.login === 'string' && item.author.login) {
        out.author = {
          login: item.author.login,
          kind: item.author.kind ?? null,
          name: item.author.name ?? null,
          avatarUrl: item.author.avatarUrl ?? null,
        }
      }
      if (typeof item.authorAssociation === 'string') out.authorAssociation = item.authorAssociation
      out.createdAtMs = msOf(item.createdAt)
      out.updatedAtMs = msOf(item.updatedAt)
      out.editedAtMs = msOf(item.editedAt)
      return out
    })
}

/** 契约的评审数组 → 库里的评审值。评审没有 id，顺序就是唯一稳定的东西。 */
function reviewsOf(reviews: readonly Review[]): SnapshotReview[] {
  return reviews.map((item) => {
    const out: SnapshotReview = { state: String(item.state || '') }
    if (item.reviewer && typeof item.reviewer.login === 'string' && item.reviewer.login) {
      out.reviewer = {
        login: item.reviewer.login,
        kind: item.reviewer.kind ?? null,
        name: item.reviewer.name ?? null,
        avatarUrl: item.reviewer.avatarUrl ?? null,
      }
    }
    out.submittedAtMs = msOf(item.submittedAt)
    return out
  })
}

/**
 * 评论组。三态优先：后端明确说评论总数不知道（fieldStates.comments 未知）就只盖章。
 * 有评论数组才表达这一组（列表读结果根本不带评论，不能拿它清空详情取回来的评论）。
 * 完整度按「取到的条数够不够票面总数」：够才是 complete；总数不知道时只敢说 truncated。
 */
function commentsGroupOf(
  issue: Issue,
  source: string,
  operation: string,
): IssueGroupsWrite['comments'] {
  const states = issue.fieldStates
  if (states && states.comments && !states.comments.known) {
    return unknownGroup(states.comments.reason, source, operation) as IssueGroupsWrite['comments']
  }
  if (!Array.isArray(issue.comments)) return undefined
  const items = commentsOf(issue)
  const total = commentTotalOf(issue)
  const completeness = total !== null && items.length >= total ? 'complete' : 'truncated'
  return { completeness, value: items, source, operation }
}

/**
 * 评审组。契约说「没有评审给 []」，三态里有 review 就按它；两者都没有就不表达这一组
 * （没有拉取请求能力的后端根本没有评审这回事，写成「确认没有」会是假的）。
 */
function reviewsGroupOf(
  issue: Issue,
  source: string,
  operation: string,
): IssueGroupsWrite['review'] {
  const states = issue.fieldStates
  if (states && states.review) {
    if (!states.review.known) return unknownGroup(states.review.reason, source, operation) as IssueGroupsWrite['review']
    return complete(reviewsOf(states.review.value || []), source, operation)
  }
  if (Array.isArray(issue.reviews)) return complete(reviewsOf(issue.reviews), source, operation)
  return undefined
}

/**
 * 一批列表读结果 → 一批组写入；空数组回空数组，调用方据此跳过开库。
 *
 * 拉取请求不进首屏，也不写库：面板快照从不展示 PR，写进去只会在回放时多出一批
 * 永远不该出现的行（组装层按 isPullRequest 区分但不过滤）。
 *
 * `backend` 用来告诉换算层这个后端的原生能力边界（今天只有 GitLab 的三组「不适用」）。
 */
export function issueWritesOf(rows: Issue[], backend = ''): IssueWrite[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.key != null && row.isPullRequest !== true)
    .map((row) => issueWriteOf(row, backend))
}

// #1866：写回执的来源与操作名单独一档，排查时一眼分得清「这条数据是写完读回来的」还是「列表取回来的」。
export const RECEIPT_SOURCE = 'refresh-write'

/**
 * 一张票的写回执 → 组写入（#1866）。
 *
 * 回执是「写完之后 tracker 交回来的那张票」：改状态、改标签、改标题这几类写之后，
 * 后端会把改完的整票读回来。它表达的组与列表读结果同一套换算（行、标签、指派、父票、阻塞），
 * 只是来源与操作名换成写回执那一档。
 *
 * 什么不做：写回执不碰正文、评论、评审、子票计数、合并信息这几组 —— 那几样回执没表达，
 * 拿它去清空会把上一次详情取到的内容误删（「没表达」不等于「确认没有」，这是三态的总规矩）。
 */
export function receiptIssueWriteOf(issue: Issue, operation: string, backend = ''): IssueWrite {
  const write = issueWriteOf(issue)
  const groups: Record<string, { source?: string | null, operation?: string | null } | undefined> = write.groups as any
  for (const name of Object.keys(groups)) {
    const group = groups[name]
    if (!group) continue
    group.source = RECEIPT_SOURCE
    group.operation = operation
  }
  applyBackendCapabilityGaps(write.groups, backend, RECEIPT_SOURCE, operation, false)
  return write
}

/**
 * 一条评论的写回执 → 库里的评论值（#1866）。
 *
 * 与「一页评论」的换算同口径：时间换毫秒，后端没给作者就不写作者字段（空登录名不建成一行 actor，
 * 否则库里会多出一个叫空串的参与人）。
 */
export function commentReceiptValueOf(comment: Comment): SnapshotComment {
  const out: SnapshotComment = { body: typeof comment.body === 'string' ? comment.body : '' }
  if (typeof comment.id === 'string' && comment.id) out.backendId = comment.id
  if (comment.author && typeof comment.author.login === 'string' && comment.author.login) {
    out.author = {
      login: comment.author.login,
      kind: comment.author.kind ?? null,
      name: comment.author.name ?? null,
      avatarUrl: comment.author.avatarUrl ?? null,
    }
  }
  if (typeof comment.authorAssociation === 'string') out.authorAssociation = comment.authorAssociation
  out.createdAtMs = msOf(comment.createdAt)
  out.updatedAtMs = msOf(comment.updatedAt)
  out.editedAtMs = msOf(comment.editedAt)
  return out
}
