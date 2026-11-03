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
 *
 * 子票计数与合并时间不在这里：它们各自是独立的字段组（subIssues / mergeInfo），
 * 一行只有一个主人，免得「行组写空」把它们从别的来源学到的值一起抹掉。
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
  commentCount?: number | null
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

/**
 * 子票计数组的值。total / completed 是计数，percent 是后端算好的完成百分比。
 *
 * 「确认没有子票」写成 total=0，不写 null：null 在这层只表示「没有值」，
 * 语义由 issue_group 的三态承担（见 GroupState）。
 */
export interface SubIssueCountsValue {
  total: number
  completed: number
  percent?: number | null
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
  /** 子票计数组的值；null = 不知道（没有组记录或组是 unknown）。 */
  subIssues: SubIssueCountsValue | null
  /** 合并时间；null 在「合并信息组是 complete」时表示确认还没合并。 */
  mergedAtMs: number | null
  groups: {
    row: GroupState | null
    body: GroupState | null
    labels: GroupState | null
    assignees: GroupState | null
    parents: GroupState | null
    blockedBy: GroupState | null
    subIssues: GroupState | null
    mergeInfo: GroupState | null
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

/**
 * 详情读的八组三态。没有出现的组在库里没有记录（从没取过），值给 null。
 *
 * 界面靠它区分「确认没有」与「不知道」：completeness 是 complete 且值为空 = 确认没有；
 * 这里是 null（从没取过）或 unknown（带 reason）= 不知道。
 */
export interface DetailGroupStates {
  row: GroupState | null
  body: GroupState | null
  labels: GroupState | null
  assignees: GroupState | null
  parents: GroupState | null
  blockedBy: GroupState | null
  subIssues: GroupState | null
  mergeInfo: GroupState | null
}

/**
 * 一张票的详情投影。
 *
 * 关系三个方向都从同一张边表读出，不各存一份：
 *  - parents：这张票的父票（最多一张）；
 *  - blockedBy：谁阻塞这张票；
 *  - blocking：这张票阻塞了谁（反向查同一条边）；
 *  - children：这张票的子票（反向查父子边）。
 * 后两个方向是派生读数，没有自己的三态记录：边表里没有就是没有，不能声称「确认没有」，
 * 因为可能还有别的票的 blockedBy / parents 组从没取过。
 *
 * referenceSkeleton 为真时，这张票只是别的票的边提到时建的骨架（没有 row 组记录），
 * 只够把关系画成人能读的样子；列表与详情都必须把它当「引用」而不是完整票。
 */
export interface IssueDetail {
  effortId: string
  key: string
  row: IssueRowValue
  /** 正文；null = 不知道。合并信息组是 complete 且没有正文行时给空串（确认没有正文）。 */
  body: string | null
  labels: SnapshotLabel[]
  assignees: SnapshotActor[]
  parents: ListIssueRef[]
  blockedBy: ListIssueRef[]
  blocking: ListIssueRef[]
  children: ListIssueRef[]
  subIssues: SubIssueCountsValue | null
  mergedAtMs: number | null
  groups: DetailGroupStates
  /** 这些组里最后一次被查询的时刻；界面用它说「上次已知是什么时候」。0 = 从来没有过。 */
  lastKnownAtMs: number
  /** true = 引用骨架：只有身份，自己没被完整取过。 */
  referenceSkeleton: boolean
}

/** 详情查询参数。effortId 缺省空串（GitHub/GitLab）；本地 Markdown 必须给工作单元目录名。 */
export interface IssueDetailQuery {
  key: string
  effortId?: string
}

/** 一次详情读的结果。issue 为 null = 库里根本没有这张票（连骨架都没有）。 */
export interface IssueDetailProjection {
  mergeVersion: number
  generatedAtMs: number
  issue: IssueDetail | null
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
