// model/types.ts —— 快照库的领域值类型。
//
// 这些形状与 persistence/schema.ts 的列一一对应，但只表达「业务上有什么」：时间全部是
// UTC 毫秒整数，布尔用 boolean，开放形状用 JSON 字符串。数据库里的 NULL 只表示「没有值」，
// 不承担「不知道」的语义——是否知道要看 issue_group 的三态（见 GroupState）。
//
// 这里不 import 任何运行时模块：model 是所有其他层的地基，反向依赖会让合并规则被 SQLite 绑住。

/** 后端身份。GitHub/GitLab 的一批票 effort_id 写空串；本地 Markdown 用工作单元目录名。 */
export type SnapshotBackend = 'github' | 'gitlab' | 'markdown'

/** 一组字段的知识状态。没有 issue_group 行才是「从没取过」，用 null 表示。 */
export type GroupCompleteness = 'complete' | 'truncated' | 'unknown'

/** 写者（可写）或只读者（租约抢不到 / 心跳丢失 / 用户只读打开）。 */
export type SnapshotMode = 'writable' | 'readonly'

/**
 * 票行组的完整值。
 *
 * 字段都是可选的：`complete` 时未给的字段写 NULL（确认不知道这一列），`truncated` 时
 * 未给或为 null 的字段不参与补缺。缺省与 null 在这里同义，因为投影侧不区分「没这个键」
 * 与「这个键是 NULL」——两者都只表示没有值。
 *
 * 作者（author_id）本票不落值：它要跨到 actor 表解析登录名，属于 sources 层的活儿；
 * schema 里的列先留 NULL，等归一票接上。
 */
export interface IssueRowValue {
  /** issue / map / spec 等；NULL = 不知道。 */
  type?: string | null
  title?: string | null
  /** open / closed 等后端状态；NULL = 不知道。 */
  state?: string | null
  url?: string | null
  createdAtMs?: number | null
  updatedAtMs?: number | null
  closedAtMs?: number | null
  /** 关闭原因（仅 closed 时有意义）。 */
  stateReason?: string | null
  isPullRequest?: boolean | null
  mergedAtMs?: number | null
  commentCount?: number | null
  subTotal?: number | null
  subCompleted?: number | null
  subPercent?: number | null
  /** 里程碑的开放形状；列表查询不解析它。 */
  milestoneJson?: string | null
  /** 自定义字段的开放形状；列表查询不解析它。 */
  customFieldsJson?: string | null
  /** 本地 Markdown 的 triage 状态。 */
  status?: string | null
  statusVisible?: string | null
  statusSource?: string | null
  statusConflictJson?: string | null
}

/** 标签定义。name 是唯一键，颜色与说明是可展示的补充信息。 */
export interface SnapshotLabel {
  name: string
  color?: string | null
  description?: string | null
}

/** 参与人：作者、指派人、评论作者、评审人共用一种形状，按登录名唯一。 */
export interface SnapshotActor {
  login: string
  kind?: string | null
  name?: string | null
  avatarUrl?: string | null
}

/** 一组的元信息：完整度、来源渠道、读操作名、上次查询时间。 */
export interface GroupState {
  completeness: GroupCompleteness
  /** unknown 时说明为什么不知道（not-expressed / not-applicable / unreadable…）。 */
  reason: string | null
  source: string | null
  operation: string | null
  lastQueriedMs: number
}

/**
 * 边上的一张目标票。与 tracker 契约里的 IssueRef 同形，但本层不 import tracker：
 * 快照库只承诺「引用能落到一张票上」，不知道上层怎么用它。
 *
 * state 缺省表示状态未知——不是 open；消费方不得把未知当成「还开着」去拦动作。
 */
export interface ListIssueRef {
  key: string
  title: string
  state?: 'open' | 'closed'
  type?: string
}

/**
 * 列表里的一行。
 *
 * 只包含「有 row 组记录」的票：没有 row 记录的引用骨架（只在边表里被提到）不出现。
 * row 组即使是 truncated / unknown 也会出现，并带着三态——上层能说清「这行不全」。
 *
 * parents / blockedBy 是边，不是行字段：目标票可能只有身份（引用骨架），所以给的是轻量引用。
 */
export interface ListIssue {
  effortId: string
  key: string
  row: IssueRowValue
  labels: SnapshotLabel[]
  assignees: SnapshotActor[]
  parents: string[]
  blockedBy: ListIssueRef[]
  groups: {
    row: GroupState | null
    labels: GroupState | null
    assignees: GroupState | null
    parents: GroupState | null
    blockedBy: GroupState | null
  }
}

/** 一次列表读的结果。mergeVersion 是读出时库里的版本，便于调用方决定下一批写入带什么起点。 */
export interface ListProjection {
  mergeVersion: number
  generatedAtMs: number
  issues: ListIssue[]
}

/** 列表查询参数。state 缺省为 open；all 表示不筛状态。limit 缺省不限制。 */
export interface ListQuery {
  state?: 'open' | 'closed' | 'all'
  limit?: number
}

/** 诊断：开库时的损坏重建、身份不符重建、退回只读等，都要让上层看得见。 */
export type SnapshotDiagnosticCode =
  | 'corrupt-rebuilt'
  | 'identity-mismatch-rebuilt'
  | 'schema-reset'
  | 'lease-held-readonly'
  | 'lease-lost-readonly'

export interface SnapshotDiagnostic {
  code: SnapshotDiagnosticCode
  /** 人话说明，直接可以展示给用户或写进日志。 */
  message: string
  /** 补充事实：旧身份、备份路径、抢租约失败的持有者等。 */
  detail?: string
}
