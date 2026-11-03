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
 */
import type { Issue, IssueFieldStates, RepositoryRef } from '../../../tracker/contract/entities.js'
import type {
  GroupState,
  IssueDetail,
  IssueGroupsWrite,
  IssueRowValue,
  IssueWrite,
  ListIssue,
  ListIssueRef,
  ListProjection,
  SnapshotActor,
  SnapshotLabel,
} from '../../../workspace-snapshot/contract/types.js'
import { assembleSnapshot } from '../../../host/tracker/snapshotAssemble.js'

/** 写入来源标签，落进 issue_group.source；排查时能分清这批数据是列表电话还是详情电话给的。 */
const SOURCE_LIST = 'refresh-list'
const OPERATION_LIST = 'list'
const SOURCE_DETAIL = 'refresh-detail'
const OPERATION_DETAIL = 'get'

/** ISO 时间转毫秒；空串、null、解析不了都回 null（不写 0，0 会被当成 1970 年的真实时间）。 */
export function msOf(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** 毫秒转 ISO；null / 非有限数回 null。 */
export function isoOf(value: unknown): string | null {
  return (typeof value === 'number' && Number.isFinite(value)) ? new Date(value).toISOString() : null
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

/** 一张票的组写入（列表电话）：只写这次真取到的那几组。 */
export function issueWriteOf(issue: Issue): IssueWrite {
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
  return { effortId: String(issue.effortId || ''), key: String(issue.key), groups }
}

/**
 * 一张票的组写入（详情电话）：比列表多表达正文。
 *
 * 正文按组写：complete + 空串 = 确认没有正文，完整取到的正文整组换掉。
 * 详情是完整行来源，所以行组、标签、指派都按 complete 写（缺的字段就是确认没有）。
 */
export function detailIssueWriteOf(issue: Issue): IssueWrite {
  const write = issueWriteOf(issue)
  write.groups.body = complete(typeof issue.body === 'string' ? issue.body : '', SOURCE_DETAIL, OPERATION_DETAIL)
  // 详情读结果里标签/指派是完整来源（有就给，没有就是确认没有）。
  if (!Array.isArray(issue.labels)) write.groups.labels = complete([], SOURCE_DETAIL, OPERATION_DETAIL)
  if (!Array.isArray(issue.assignees)) write.groups.assignees = complete([], SOURCE_DETAIL, OPERATION_DETAIL)
  write.groups.row = complete(issueRowValueOf(issue), SOURCE_DETAIL, OPERATION_DETAIL)
  return write
}

/**
 * 一批列表读结果 → 一批组写入；空数组回空数组，调用方据此跳过开库。
 *
 * 拉取请求不进首屏，也不写库：面板快照从不展示 PR，写进去只会在回放时多出一批
 * 永远不该出现的行（组装层按 isPullRequest 区分但不过滤）。
 */
export function issueWritesOf(rows: Issue[]): IssueWrite[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.key != null && row.isPullRequest !== true)
    .map(issueWriteOf)
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
 * 三条约定：
 *  1. 正文不知道时整个字段不写（undefined）：写空串会让界面把「没取过」画成「无描述」。
 *  2. 评论这一组 #1864 还没落库，所以 comments 一律不写；界面按「评论未知」处理，
 *     不把它说成「只读」或「评论 (0)」（评论分页是 #1865）。
 *  3. 各组三态放进 snapshotGroups，上次已知时刻放进 lastKnownAtMs：界面靠这两样分开画
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
    },
  }
  if (issue.body !== null) out.body = issue.body
  return out
}
