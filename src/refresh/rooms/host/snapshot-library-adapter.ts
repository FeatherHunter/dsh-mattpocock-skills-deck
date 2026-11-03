/**
 * src/refresh/rooms/host/snapshot-library-adapter.ts —— 列表读结果与快照库之间的纯换算（#1863）
 *
 * 为什么单列：快照层不许 import 宿主或刷新，refresh 也不该把 tracker 的 Issue 直接塞进库；
 * 这一层只做「tracker 契约 ↔ 快照契约」的搬运，不碰数据库、不发请求、不记时间，方便单测。
 *
 * 一条约定必须记住：库里一个字段组的「没写过」与「写空了」是两回事。所以换算时只在该组
 * 确实取到时才写：labels/assignees 字段缺席 = 这个后端给不了（不写组）；blockedBy 没有
 * fieldStates.dependencies 且字段也缺席 = 能力没有（不写组）。parents 是核心字段，永远写：
 * 有 fieldStates 就按三态，没有就按旧口径把 parentKey 当完整值。
 */
import type { Issue, IssueFieldStates, RepositoryRef } from '../../../tracker/contract/entities.js'
import type {
  GroupWrite,
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

/** 写入来源标签，落进 issue_group.source；排查时能分清这批数据是列表电话还是编排器给的。 */
const SOURCE = 'refresh-list'
const OPERATION = 'list'

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

function complete<T>(value: T): GroupWrite<T> {
  return { completeness: 'complete', value, source: SOURCE, operation: OPERATION }
}

function unknownGroup(reason: string | null | undefined): GroupWrite<never[] | null> {
  return { completeness: 'unknown', reason: reason || 'not-expressed', source: SOURCE, operation: OPERATION }
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
 * 把一张 tracker 票换成一行的组写入。
 *
 * 时间一律换算成毫秒（库的地基单位）；state 写小写原文，读回时上层再按需要转大写。
 * isPullRequest 只在后端明确给出布尔值时落值：null 表示不知道，组装层靠「属性在不在」
 * 区分拉取请求与普通票，写成 null 会让两类票混在一起。
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
  row.mergedAtMs = msOf(issue.mergedAt)
  const states: IssueFieldStates | undefined = issue.fieldStates
  if (states) {
    if (states.subIssues && states.subIssues.known) {
      row.subTotal = states.subIssues.value.total
      row.subCompleted = states.subIssues.value.completed
      row.subPercent = states.subIssues.value.percentCompleted
    }
    if (states.comments && states.comments.known) row.commentCount = states.comments.value
  } else if (typeof issue.commentCount === 'number') {
    row.commentCount = issue.commentCount
  }
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

/** 一张票的组写入（五组里只写这次真取到的那几组，规则见文件头）。 */
export function issueWriteOf(issue: Issue): IssueWrite {
  const groups: IssueGroupsWrite = { row: complete(issueRowValueOf(issue)) }
  if (Array.isArray(issue.labels)) groups.labels = complete(labelsOf(issue))
  if (Array.isArray(issue.assignees)) groups.assignees = complete(actorsOf(issue))

  const states = issue.fieldStates
  if (states && states.parents) {
    groups.parents = states.parents.known
      ? complete(states.parents.value ? [String(states.parents.value)] : [])
      : unknownGroup(states.parents.reason)
  } else {
    groups.parents = complete(issue.parentKey != null ? [String(issue.parentKey)] : [])
  }

  if (states && states.dependencies) {
    groups.blockedBy = states.dependencies.known
      ? complete(states.dependencies.value.map((ref) => String(ref.key)))
      : unknownGroup(states.dependencies.reason)
  } else if (Array.isArray(issue.blockedBy)) {
    groups.blockedBy = complete(refKeysOf(issue))
  }
  return { effortId: String(issue.effortId || ''), key: String(issue.key), groups }
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
  if (typeof row.mergedAtMs === 'number') issue.mergedAt = isoOf(row.mergedAtMs)
  if (row.status) issue.status = row.status
  if (row.statusVisible) issue.statusVisible = row.statusVisible
  if (row.statusSource === 'visible' || row.statusSource === 'hidden' || row.statusSource === 'default') issue.statusSource = row.statusSource
  return issue
}

/** 一次列表投影 → 与在线组装同形的快照主体（容器树、子票、瘦身行都在里面）。 */
export function snapshotOfProjection(repo: RepositoryRef, projection: ListProjection): any {
  return assembleSnapshot(repo, projection.issues.map(issueOfRow))
}
