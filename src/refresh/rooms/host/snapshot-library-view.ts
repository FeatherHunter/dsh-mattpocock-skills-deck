/**
 * src/refresh/rooms/host/snapshot-library-view.ts —— 快照库读出来的东西怎么交给上面用（#1863、#1864、#1865）
 *
 * 为什么与 snapshot-library-adapter.ts 分成两份：那一份管写方向（tracker 读结果 → 库里的组写入），
 * 这一份管读方向（库里的投影 → tracker 的 Issue / 界面认的详情形状）。两边各自都不小，混在一个
 * 文件里会撞上「单文件 350 有效行」的门禁；而且读写互不依赖，分开之后谁改哪边一目了然。
 *
 * 三条不能改的约定：
 *  1. 这一层只做形状搬运，不碰数据库、不发请求、不记时间：库给什么就搬什么，缺的字段不补假值。
 *  2. 「不知道」不许画成「没有」：正文、评论、评审这几组在三态里是 unknown 或没有组记录时，
 *     交出去的形状里整个字段不写，而不是写空串、空数组、空连接。
 *  3. 评论的下一页只看组的完整度（truncated 才有下一页），游标用库里记的那个数；不要拿
 *     「这次取到几条」另算一遍，那样界面与库会各说一套。
 */
import type { Issue, RepositoryRef } from '../../../tracker/contract/entities.js'
import type {
  GroupState,
  IssueDetail,
  ListIssue,
  ListIssueRef,
  ListProjection,
  SnapshotComment,
} from '../../../workspace-snapshot/contract/types.js'
import { assembleSnapshot } from '../../../host/tracker/snapshotAssemble.js'

/** 毫秒转 ISO；null / 非有限数回 null。 */
export function isoOf(value: unknown): string | null {
  return (typeof value === 'number' && Number.isFinite(value)) ? new Date(value).toISOString() : null
}

function refOf(item: ListIssueRef): any {
  const ref: any = { key: String(item.key), title: String(item.title || '') }
  if (item.state === 'open' || item.state === 'closed') ref.state = item.state
  if (item.type) ref.type = item.type
  return ref
}

/**
 * 一行库记录 → tracker 契约里的 Issue 形状。
 *
 * body 这里一律给空串：正文属于详情（#1864），首屏容器树与胶囊不需要它；
 * 有了空 body，组装层解析地图/规格正文只会得到空区块，不会报错。
 * blockedBy 只在库里确实有这组记录时才出现：缺席表示「能力没有」，[] 表示「确认没有」。
 */
export function issueOfRow(item: ListIssue): Issue {
  const row = item.row
  const effortId = String(item.effortId || '')
  const issue: Issue = {
    key: String(item.key),
    effortId,
    type: (row.type === 'map' || row.type === 'spec') ? row.type : 'issue',
    title: String(row.title || ''),
    state: row.state === 'closed' ? 'closed' : 'open',
    body: '',
    url: String(row.url || ''),
    createdAt: isoOf(row.createdAtMs) || '',
    updatedAt: isoOf(row.updatedAtMs) || '',
    closedAt: isoOf(row.closedAtMs),
    parentKey: item.parents.length ? String(item.parents[0]) : null,
  }
  if (item.labels.length) issue.labels = item.labels.map((l) => ({ name: l.name, color: l.color || '', ...(l.description ? { description: l.description } : {}) }))
  if (item.assignees.length) issue.assignees = item.assignees.map((a) => ({ login: a.login, ...(a.name ? { name: a.name } : {}), ...(a.avatarUrl ? { avatarUrl: a.avatarUrl } : {}) }))
  if (item.groups.blockedBy !== null) issue.blockedBy = item.blockedBy.map((ref) => refOf(ref))
  if (typeof row.isPullRequest === 'boolean') issue.isPullRequest = row.isPullRequest
  if (typeof row.commentCount === 'number') issue.commentCount = row.commentCount
  if (row.stateReason) issue.reason = row.stateReason
  if (typeof item.mergedAtMs === 'number') issue.mergedAt = isoOf(item.mergedAtMs)
  if (row.status) issue.status = row.status
  if (row.statusVisible) issue.statusVisible = row.statusVisible
  if (row.statusSource === 'visible' || row.statusSource === 'hidden' || row.statusSource === 'default') issue.statusSource = row.statusSource
  return issue
}

/** 一次列表投影 → 与在线组装同形的快照主体（容器树、子票、瘦身行都在里面）。 */
export function snapshotOfProjection(repo: RepositoryRef, projection: ListProjection): any {
  return assembleSnapshot(repo, projection.issues.map(issueOfRow))
}

/** 库里的一组三态 → 界面读得懂的三态（只留完整度、原因与时刻）。 */
function groupInfoOf(state: GroupState | null): any {
  if (!state) return null
  return { completeness: state.completeness, reason: state.reason, lastQueriedMs: state.lastQueriedMs }
}

function nodesOf(refs: ListIssueRef[]): any[] {
  return refs.map((ref) => {
    const number = /^\d+$/.test(ref.key) ? Number(ref.key) : ref.key
    const node: any = { number, title: ref.title || '' }
    if (ref.state === 'closed') node.state = 'CLOSED'
    else if (ref.state === 'open') node.state = 'OPEN'
    return node
  })
}

/**
 * 库里的详情投影 → 界面认的详情形状（GraphQL 连接那套字段）。
 *
 * 四条约定：
 *  1. 正文不知道时整个字段不写（undefined）：写空串会让界面把「没取过」画成「无描述」。
 *  2. 评论按库里的三态交：知道（complete / truncated）就给连接，不知道就整个字段不写——
 *     写空连接会把「还没取过」说成「无评论」。
 *  3. 评审同理：只有评审组知道时才写 reviews，不知道时整个字段不写。
 *  4. 各组三态放进 snapshotGroups，上次已知时刻放进 lastKnownAtMs：界面靠这两样分开画
 *     「确认没有」与「不知道」。
 */
export function detailOfProjection(issue: IssueDetail): any {
  const out: any = {
    number: /^\d+$/.test(issue.key) ? Number(issue.key) : issue.key,
    key: issue.key,
    effortId: issue.effortId,
    title: issue.row.title || '',
    state: issue.row.state === 'closed' ? 'CLOSED' : 'OPEN',
    url: issue.row.url || '',
    updatedAt: isoOf(issue.row.updatedAtMs) || '',
    createdAt: isoOf(issue.row.createdAtMs) || '',
    closedAt: isoOf(issue.row.closedAtMs),
    labels: { nodes: issue.labels.map((l) => ({ name: l.name, color: l.color || '' })) },
    assignees: { nodes: issue.assignees.map((a) => ({ login: a.login })) },
    blockedBy: { nodes: nodesOf(issue.blockedBy) },
    blocking: { nodes: nodesOf(issue.blocking) },
    subIssues: { totalCount: issue.subIssues ? issue.subIssues.total : issue.children.length, nodes: nodesOf(issue.children) },
    isPullRequest: issue.row.isPullRequest === true,
    mergedAt: isoOf(issue.mergedAtMs),
    fromSnapshot: true,
    referenceSkeleton: issue.referenceSkeleton,
    lastKnownAtMs: issue.lastKnownAtMs,
    snapshotGroups: {
      row: groupInfoOf(issue.groups.row),
      body: groupInfoOf(issue.groups.body),
      labels: groupInfoOf(issue.groups.labels),
      assignees: groupInfoOf(issue.groups.assignees),
      parents: groupInfoOf(issue.groups.parents),
      blockedBy: groupInfoOf(issue.groups.blockedBy),
      subIssues: groupInfoOf(issue.groups.subIssues),
      mergeInfo: groupInfoOf(issue.groups.mergeInfo),
      comments: groupInfoOf(issue.groups.comments),
      review: groupInfoOf(issue.groups.review),
    },
  }
  if (issue.body !== null) out.body = issue.body
  const comments = commentsConnectionOf(issue)
  if (comments) out.comments = comments
  const reviews = reviewsOfDetail(issue)
  if (reviews) out.reviews = reviews
  if (typeof issue.row.commentCount === 'number') out.commentCount = issue.row.commentCount
  return out
}

/** 一条库里的评论 → 界面认的评论节点（作者给登录名，昵称头像有就给）。 */
function commentNodeOf(comment: SnapshotComment): any {
  const node: any = {
    author: { login: (comment.author && comment.author.login) || '' },
    authorAssociation: comment.authorAssociation || '',
    body: comment.body || '',
    createdAt: isoOf(comment.createdAtMs) || '',
    updatedAt: isoOf(comment.updatedAtMs) || '',
  }
  if (comment.author && comment.author.name) node.author.name = comment.author.name
  if (comment.author && comment.author.avatarUrl) node.author.avatarUrl = comment.author.avatarUrl
  if (comment.editedAtMs !== null && comment.editedAtMs !== undefined) node.editedAt = isoOf(comment.editedAtMs)
  return node
}

/**
 * 评论组的完整度：complete / truncated 算知道，unknown 与没有组记录算不知道。
 * 界面靠它决定「评论未知」还是「评论 (N)」，所以这一条判据只写在这里。
 */
function commentsKnownAt(issue: IssueDetail): GroupState | null {
  const group = issue.groups.comments
  if (!group) return null
  return group.completeness === 'unknown' ? null : group
}

/** 评论总数：行组里记着的票面总数；行组没写过的旧库里退回已取条数。 */
function commentTotalOf(issue: IssueDetail, taken: number): number {
  return typeof issue.row.commentCount === 'number' ? issue.row.commentCount : taken
}

/**
 * 库里的评论 → 界面认的 GraphQL 连接。不知道时回 null（调用方据此整个字段不写）。
 *
 * 下一页的判断只看组的完整度：truncated 就是「还有」，complete 就是「到底了」。
 * endCursor 用库里的游标（取到第几条），没有游标时退回已取条数——两者正常是同一个数。
 */
export function commentsConnectionOf(issue: IssueDetail): any | null {
  const group = commentsKnownAt(issue)
  if (!group) return null
  const nodes = issue.comments.map(commentNodeOf)
  return {
    nodes,
    pageInfo: {
      hasNextPage: group.completeness === 'truncated',
      endCursor: issue.commentsCursor !== null ? issue.commentsCursor : String(nodes.length),
    },
    totalCount: commentTotalOf(issue, nodes.length),
  }
}

/** 库里的评审 → 界面认的形状；评审组不知道时回 null。 */
export function reviewsOfDetail(issue: IssueDetail): any[] | null {
  const group = issue.groups.review
  if (!group || group.completeness === 'unknown') return null
  return issue.reviews.map((review) => {
    const out: any = { state: review.state, submittedAt: isoOf(review.submittedAtMs) }
    if (review.reviewer && review.reviewer.login) out.reviewer = { login: review.reviewer.login }
    return out
  })
}

/**
 * 「加载更多」要的那一页，库里已经取到过时直接用库里的（#1865）。
 *
 * 传进来的 loaded 是界面手上已有的条数（客户端传的 after）：它可能是上一次会话留下的，
 * 库里则可能已经取到更后面。只要库里还有第 loaded + 1 条，就先把库里的交回去，一次网络都不发。
 *
 * 返回 null 表示库里没有这一页，调用方照旧去后端取。判断「还有下一页」用两件事：
 * 库里还有更后面的条目，或者这一组本身就是 truncated（后端那边可能还有）。
 */
export function storedCommentPage(issue: IssueDetail, loaded: number, limit: number): any | null {
  const group = commentsKnownAt(issue)
  if (!group || issue.referenceSkeleton) return null
  if (!(issue.comments.length > loaded)) return null
  const nodes = issue.comments.slice(loaded, loaded + limit).map(commentNodeOf)
  const taken = loaded + nodes.length
  return {
    nodes,
    pageInfo: {
      hasNextPage: issue.comments.length > taken || group.completeness === 'truncated',
      endCursor: String(taken),
      totalCount: commentTotalOf(issue, issue.comments.length),
    },
  }
}
