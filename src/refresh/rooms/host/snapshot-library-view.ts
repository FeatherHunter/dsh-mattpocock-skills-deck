/**
 * src/refresh/rooms/host/snapshot-library-view.ts —— 快照库读出来的东西怎么交给上面用（#1863、#1864、#1865）
 *
 * 为什么与 snapshot-library-adapter.ts 分成两份：那一份管写方向（tracker 读结果 → 库里的组写入），
 * 这一份管读方向（库里的投影 → tracker 的 Issue / 界面认的详情形状）。两边各自都不小，混在一个
 * 文件里会撞上「单文件 350 有效行」的门禁；而且读写互不依赖，分开之后谁改哪边一目了然。
 *
 * #1892 起列表那一半（库里的行 → 容器树、子票、瘦身行的快照主体）搬进同目录的
 * snapshot-view-projection.ts：它是纯投影，有独立的一套输入与排序约定，跟详情/评论的换算是两件事。
 * 本文件把 snapshotOfProjection 留成薄转手，调用方的 import 路径不变。
 *
 * 三条不能改的约定：
 *  1. 这一层只做形状搬运，不碰数据库、不发请求、不记时间：库给什么就搬什么，缺的字段不补假值。
 *  2. 「不知道」不许画成「没有」：正文、评论、评审这几组在三态里是 unknown 或没有组记录时，
 *     交出去的形状里整个字段不写，而不是写空串、空数组、空连接。
 *  3. 评论的下一页只看组的完整度（truncated 才有下一页），游标用库里记的那个数；不要拿
 *     「这次取到几条」另算一遍，那样界面与库会各说一套。
 */
import type { RepositoryRef } from '../../../tracker/contract/entities.js'
import type {
  ContainerProjection,
  GroupState,
  IssueDetail,
  ListIssueRef,
  ListProjection,
  SnapshotComment,
} from '../../../workspace-snapshot/contract/types.js'
import { normalizeMapTickets } from '../../../host/tracker/snapshotAssemble.js'
import { isoOf, projectSnapshotView, issueOfRow } from './snapshot-view-projection.js'

export { isoOf, issueOfRow } from './snapshot-view-projection.js'

/** 一次列表投影 → 与在线组装同形的快照主体（容器树、子票、瘦身行都在里面）。 */
export function snapshotOfProjection(repo: RepositoryRef, projection: ListProjection): any {
  return projectSnapshotView({ repo, issues: projection.issues, version: projection.mergeVersion }).snapshot
}

/**
 * 库里的「一个容器」投影 → 界面详情页要的形状（#1923）：容器行 + 子票 + 层级 + 统计。
 *
 * 为什么层级与统计在这一层算：它们是领域规则（normalizeMapTickets → groupTickets），
 * 宿主与客户端都只该有一份实现；客户端拿到的是算好的票（带 level）与 stats.levels，
 * 不自己再按编号推一遍层级（规格 D1）。
 *
 * 三态：容器行缺席时回 null（调用方如实回「库里还没有这张容器」），不拿空数组冒充确认没有；
 * 子票按库里真实有的行给，库里没取过的子票这里不会凭空出现。
 */
export function containerProjectionOf(projection: ContainerProjection): any | null {
  if (!projection || !projection.container) return null
  // 库里的状态按 schema 存小写；界面认的是大写的 OPEN / CLOSED（与首屏快照的 upcaseSnapStates 同一口径）。
  // groupTickets 的开放 / 关闭 / 层级计数只认大写，所以换算必须在算统计之前做，且只此一处。
  const upcase = function (row: any): any { if (row && typeof row.state === 'string') row.state = row.state.toUpperCase(); return row }
  const normalized = normalizeMapTickets(projection.issues.map(function (item: any): any { return upcase(issueOfRow(item)) }))
  return {
    container: upcase(issueOfRow(projection.container)),
    tickets: normalized.tickets,
    stats: normalized.stats,
  }
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
  // 拉取请求那两格按三态写：库里没记 `is_pull_request` 就是「不知道这是不是 PR」，
  // 合并信息组没取过就是「不知道合并没合并」。写成 false / null 等于替后端断言「它不是 PR」「没合并过」，
  // 而同一个方法另一条来源（当场取数那一趟）在同样情况下是省掉这两格的——两条来源必须同形，见 #1870。
  if (typeof issue.row.isPullRequest === 'boolean') out.isPullRequest = issue.row.isPullRequest
  const mergeGroup = issue.groups.mergeInfo
  if (mergeGroup && mergeGroup.completeness !== 'unknown') out.mergedAt = isoOf(issue.mergedAtMs)
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

/**
 * 一条评审 → 界面认的那三样（结论、评审人登录名、时间）。
 *
 * 为什么单独一个函数：详情有两条来源（当场取数与库里回放），两条都要交同一种形状，
 * 各写一份迟早会漂成「一条有 submittedAt、一条没有」。没有的值就整个省掉，不写空串与 null。
 */
export function reviewNodeOf(state: unknown, reviewerLogin?: unknown, submittedAt?: unknown): any {
  const out: any = { state: String(state || '') }
  if (typeof reviewerLogin === 'string' && reviewerLogin) out.reviewer = { login: reviewerLogin }
  if (typeof submittedAt === 'string' && submittedAt) out.submittedAt = submittedAt
  return out
}

/** 库里的评审 → 界面认的形状；评审组不知道时回 null。 */
export function reviewsOfDetail(issue: IssueDetail): any[] | null {
  const group = issue.groups.review
  if (!group || group.completeness === 'unknown') return null
  return issue.reviews.map((review) => reviewNodeOf(
    review.state,
    review.reviewer && review.reviewer.login,
    isoOf(review.submittedAtMs) || '',
  ))
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
