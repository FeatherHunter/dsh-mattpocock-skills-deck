/**
 * src/shared/snapshot-row-fields.ts —— 库列表投影的一行 → 界面行字段（#1885 评审修复）
 *
 * 为什么只能有这一份：库列表投影（ListIssue）要同时喂给两条路——宿主快照投影
 * （snapshot-view-projection.ts 的 issueOfRow）与客户端变化集合并（snapshot-change-merge.ts 的
 * changeRowPatch）。两份各写一套时已经漂过：客户端漏了 blockedBy，还把 unknown / 组缺席 /
 * truncated 的空组写成空数组或 null，把「不知道」说成「确认没有」（规格 I6）。
 *
 * 这一份只回答「这一行到底知道哪些字段、知道的值是什么」，不决定输出形状：
 *  - 宿主与客户端各自把自己认识的字段取走（宿主要的是 tracker 的 Issue 形状，客户端要的是
 *    并进已有行的补丁），两边都不再自己判三态。
 *  - known 为假 = 这一格没取过 / 不知道。消费方不许补 0、补空数组、补默认值。
 *  - 组的三态只在 groupHasValues / groupKnown 两处判：complete + 空才是「确认没有」，
 *    truncated + 空与 unknown 都是「不知道」。
 *
 * 这一份零依赖、零时钟、零 IO：客户端闭包按 scripts/build.mts 的 SHARED_SPLICE 把同一份文本
 * 拼进去，宿主走普通 import；两半读的是同一份实现，不是两份“对齐过”的拷贝。
 */

/** 组记录的最小形状：只认完整度这一格（别的字段不参与判断）。 */
export interface SnapshotRowGroupState {
  completeness?: string | null
}

/** 一行里本文件真正读到的那些格子；形状按库列表投影放宽，缺格按「不知道」处理。 */
export interface SnapshotRowInput {
  effortId?: unknown
  key?: unknown
  row?: any
  labels?: readonly any[]
  assignees?: readonly any[]
  parents?: readonly unknown[]
  blockedBy?: readonly any[]
  mergedAtMs?: unknown
  groups?: {
    labels?: SnapshotRowGroupState | null
    assignees?: SnapshotRowGroupState | null
    parents?: SnapshotRowGroupState | null
    blockedBy?: SnapshotRowGroupState | null
    mergeInfo?: SnapshotRowGroupState | null
  } | null
}

/** 一格「知道 / 不知道」+ 知道时的值。不知道时消费方不许写这一格。 */
export interface SnapshotRowField<T> {
  known: boolean
  value: T
}

/** 整行字段的一次换算结果；字段名与库列表投影的语义一一对应。 */
export interface SnapshotRowFields {
  key: string
  number: number | null
  effortId: string
  type: SnapshotRowField<'map' | 'spec' | 'issue'>
  title: SnapshotRowField<string>
  state: SnapshotRowField<'open' | 'closed'>
  url: SnapshotRowField<string>
  createdAtMs: SnapshotRowField<number>
  updatedAtMs: SnapshotRowField<number>
  closedAtMs: SnapshotRowField<number | null>
  isPullRequest: SnapshotRowField<boolean>
  commentCount: SnapshotRowField<number>
  reason: SnapshotRowField<string>
  status: SnapshotRowField<string>
  statusVisible: SnapshotRowField<string>
  statusSource: SnapshotRowField<'visible' | 'hidden' | 'default'>
  labels: SnapshotRowField<Array<{ name: string, color: string, description?: string }>>
  assignees: SnapshotRowField<Array<{ login: string, name?: string, avatarUrl?: string }>>
  parentKey: SnapshotRowField<string | null>
  blockedBy: SnapshotRowField<Array<{ key: string, title: string, state?: 'open' | 'closed', type?: string }>>
  mergedAtMs: SnapshotRowField<number | null>
}

function known<T>(value: T): SnapshotRowField<T> {
  return { known: true, value }
}

function unknown<T>(value: T): SnapshotRowField<T> {
  return { known: false, value }
}

/** 组记录存在、且完整度不是 unknown：unknown 与组缺席一样是「不知道」。 */
function groupKnown(group: SnapshotRowGroupState | null | undefined): boolean {
  return !!group && group.completeness !== 'unknown'
}

/**
 * 这一组「知道且确实有值」；complete + 空是「确认没有」，由消费方按 known 写空值；
 * truncated + 空表示一条都没取到，仍然不写。
 */
function groupHasValues(group: SnapshotRowGroupState | null | undefined, count: number): boolean {
  if (!groupKnown(group)) return false
  if (count > 0) return true
  return !!group && group.completeness === 'complete'
}

/** 有限毫秒数才算时间；其余（null、Date、字符串）一律当不知道。 */
function msKnown(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 状态只认 open / closed 两态（大小写不敏感）；认不出就是不知道，不兜成 open。 */
function stateOf(value: unknown): SnapshotRowField<'open' | 'closed'> {
  const text = String(value === null || value === undefined ? '' : value).toLowerCase()
  if (text === 'open') return known('open')
  if (text === 'closed') return known('closed')
  return unknown('open')
}

/** 类型只认 map / spec / issue 三态；缺格或认不出就是不知道，不兜成 issue。 */
function typeOf(value: unknown): SnapshotRowField<'map' | 'spec' | 'issue'> {
  const text = String(value === null || value === undefined ? '' : value)
  if (text === 'map' || text === 'spec' || text === 'issue') return known(text)
  return unknown('issue')
}

/** 非空字符串才算有值（空串与「没有」在界面上是两件事，空串按不知道处理）。 */
function textKnown(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * 把库列表投影的一行换算成「知道哪些字段」的清单。纯函数：不读时钟、不改入参。
 *
 * 消费方约定（宿主与客户端都按这一条写）：
 *  - known 为假：这一格不写。宿主给 required 形状填空串/0 是它的输出契约，但「不知道」的语义
 *    仍在 known 里，不许把填空串当成确认没有。
 *  - 组字段（labels / assignees / parentKey / blockedBy / mergeInfo）只有 known 为真才写；
 *    known 且值为空 = 确认没有。
 *  - 状态与类型不兜底：不知道时宿主与客户端都不写，下游按「没看到 = 不知道」处理。
 */
export function snapshotRowFieldsOf(item: SnapshotRowInput | null | undefined): SnapshotRowFields {
  const input = item || {}
  const row = (input.row || {}) as Record<string, unknown>
  const groups = input.groups || {}
  const key = input.key === null || input.key === undefined ? '' : String(input.key)
  const labels = Array.isArray(input.labels) ? input.labels : []
  const assignees = Array.isArray(input.assignees) ? input.assignees : []
  const parents = Array.isArray(input.parents) ? input.parents : []
  const blockedBy = Array.isArray(input.blockedBy) ? input.blockedBy : []

  const type = typeOf(row.type)
  const title = row.title === null || row.title === undefined ? unknown('') : known(String(row.title))
  const state = stateOf(row.state)
  const url = textKnown(row.url) ? known(row.url) : unknown('')
  const createdAtMs = msKnown(row.createdAtMs) ? known(row.createdAtMs) : unknown(0)
  const updatedAtMs = msKnown(row.updatedAtMs) ? known(row.updatedAtMs) : unknown(0)
  // closedAt 的「知道」以列存在为准：null 是「确认还没关闭」，undefined 是这一趟没读到。
  const closedAtMs: SnapshotRowField<number | null> = row.closedAtMs === undefined
    ? unknown(null)
    : known(msKnown(row.closedAtMs) ? row.closedAtMs : null)
  const isPullRequest = typeof row.isPullRequest === 'boolean' ? known(row.isPullRequest) : unknown(false)
  const commentCount = typeof row.commentCount === 'number' && Number.isFinite(row.commentCount)
    ? known(row.commentCount)
    : unknown(0)
  const reason = textKnown(row.stateReason) ? known(row.stateReason) : unknown('')
  const status = textKnown(row.status) ? known(row.status) : unknown('')
  const statusVisible = textKnown(row.statusVisible) ? known(row.statusVisible) : unknown('')
  const statusSource: SnapshotRowField<'visible' | 'hidden' | 'default'> =
    (row.statusSource === 'visible' || row.statusSource === 'hidden' || row.statusSource === 'default')
      ? known(row.statusSource as 'visible' | 'hidden' | 'default')
      : unknown<'visible' | 'hidden' | 'default'>('visible')

  const labelField: SnapshotRowField<Array<{ name: string, color: string, description?: string }>> =
    groupHasValues(groups.labels, labels.length)
      ? known(labels.map(function (label: any): any {
        const out: any = { name: String((label && label.name) || ''), color: (label && typeof label.color === 'string') ? label.color : '' }
        if (label && typeof label.description === 'string' && label.description) out.description = label.description
        return out
      }))
      : unknown([])
  const assigneeField: SnapshotRowField<Array<{ login: string, name?: string, avatarUrl?: string }>> =
    groupHasValues(groups.assignees, assignees.length)
      ? known(assignees.map(function (actor: any): any {
        const out: any = { login: String((actor && actor.login) || '') }
        if (actor && actor.name) out.name = actor.name
        if (actor && actor.avatarUrl) out.avatarUrl = actor.avatarUrl
        return out
      }))
      : unknown([])
  const parentField: SnapshotRowField<string | null> =
    groupHasValues(groups.parents, parents.length)
      ? known(parents.length ? String(parents[0]) : null)
      : unknown(null)
  const blockedField: SnapshotRowField<Array<{ key: string, title: string, state?: 'open' | 'closed', type?: string }>> =
    groupHasValues(groups.blockedBy, blockedBy.length)
      ? known(blockedBy.map(function (ref: any): any {
        const out: any = { key: String((ref && ref.key) === null || (ref && ref.key) === undefined ? '' : ref.key), title: String((ref && ref.title) || '') }
        if (ref && (ref.state === 'open' || ref.state === 'closed')) out.state = ref.state
        if (ref && ref.type) out.type = ref.type
        return out
      }))
      : unknown([])
  const mergeField: SnapshotRowField<number | null> =
    groupKnown(groups.mergeInfo)
      ? known(msKnown(input.mergedAtMs) ? input.mergedAtMs : null)
      : unknown(null)

  return {
    key: key,
    number: /^[0-9]+$/.test(key) ? Number(key) : null,
    effortId: String(input.effortId || ''),
    type: type,
    title: title,
    state: state,
    url: url,
    createdAtMs: createdAtMs,
    updatedAtMs: updatedAtMs,
    closedAtMs: closedAtMs,
    isPullRequest: isPullRequest,
    commentCount: commentCount,
    reason: reason,
    status: status,
    statusVisible: statusVisible,
    statusSource: statusSource,
    labels: labelField,
    assignees: assigneeField,
    parentKey: parentField,
    blockedBy: blockedField,
    mergedAtMs: mergeField,
  }
}
