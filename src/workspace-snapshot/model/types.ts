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

/**
 * 这个句柄现在能不能写。
 *
 * 口径（#1932 起）：readonly 只表达「真的写不了」的两种环境，不再表达「另一个窗口拿着写权」——
 * 本地磁盘上所有窗口都能写，写靠 SQLite 写锁排队。
 *   - writable：能写。本地路径永远是这一档（除非文件系统本身不可写）；
 *   - readonly：网络盘 / UNC 上另一个进程拿着写者租约（单写者回退），
 *     或者文件系统不可写、只能以只读连接打开（诊断码 readonly-filesystem）。
 * 反例：不要再让本地路径因为「meta 里有别人的租约」退回 readonly —— 那是旧版本窗口留下的现场，
 * 正确的做法是让写回 legacy-writer 并提示重启，而不是把窗口变成只读（#1932 验收 5）。
 */
export type SnapshotMode = 'writable' | 'readonly'

/**
 * 库文件所在存储的类别（#1932，规格 #1930 §2.2）。
 *
 * 为什么需要这一格：本地磁盘可以多进程同时写（SQLite 写锁排队），网络盘 / UNC 上多进程写同一份
 * SQLite 不保证安全，必须保留「单写者 + 抢不到就只读」的回退。两条路的写模型的差别要在设置页诊断
 * 与日志里说得清，所以它成了库这一层的领域值，而不是界面临时算出来的东西。
 *
 * 判定失败时一律按 local 处理（宁可多窗口可写，也不把一个人的本地库锁成只读）；这条取舍写在
 * src/workspace-snapshot/README.md 的「写模型」一节。门禁可以按 storageKind 选项直接指定，
 * 生产代码不传、由 detectStorageKind 现算。
 */
export type SnapshotStorageKind = 'local' | 'network'

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

/**
 * 一条评论。
 *
 * 后端 id 是可选的：GitHub 与 GitLab 给得出来，本地 Markdown 的评论区只有手写标题，
 * 没有稳定标识（见 src/tracker/rooms/markdown/issues-read.ts 的游标说明）。所以库里的身份
 * 不是它，而是「这张票的第几个」——评论按 position 存，翻页从头上重取时按位置覆盖。
 *
 * 时间全部是 UTC 毫秒整数；没有的时间给 null，不拿 0 冒充 1970 年。
 */
export interface SnapshotComment {
  /** 后端给的评论 id；给不了就省略（不能拿它当身份，理由见上）。 */
  backendId?: string | null
  /** 谁写的；后端没给作者信息时省略。 */
  author?: SnapshotActor | null
  /** 作者与仓库的关系（GitHub 的 OWNER/MEMBER/CONTRIBUTOR/NONE；本地是空串）。 */
  authorAssociation?: string | null
  /** 正文（Markdown 原文）。这一格必填：后端给不出正文时写空串，不写 null。 */
  body: string
  createdAtMs?: number | null
  updatedAtMs?: number | null
  editedAtMs?: number | null
}

/**
 * 一条评审记录。
 *
 * 契约里没有评审 id（见 src/tracker/contract/entities.ts 的 Review），所以这一组只能整组替换、
 * 按顺序存：两次取回之间唯一稳定的东西就是「第几条」。没有评审能力或从没取过时，库里没有组记录。
 */
export interface SnapshotReview {
  /** 评审结论（开放文字），保留写法 approved / changes_requested / commented / dismissed。 */
  state: string
  /** 给出这条评审的人；没有就不写。 */
  reviewer?: SnapshotActor | null
  /** 给出评审的时间（UTC 毫秒）；没有就不写。 */
  submittedAtMs?: number | null
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

/**
 * 面板顶上的六个数字，从库里一次查询算出（#1887，规格 #1885 §7）。
 *
 * 口径（与 projection/counts.ts 的 SQL 一一对应，改一处必须改另一处）：
 *  - 只数「有 row 组记录、没被墓碑标记、不是拉取请求」的票；PR 身份未知的票按工单算，
 *    与界面 ticketRowsOf 的工单口径一致；
 *  - total 是全部；open / closed 按状态严格比（状态未知的票进 total，不进 open / closed）；
 *  - 可接 / 阻塞 / 已认领只数还开着的票：已关闭的票不再可接、不再算阻塞，也不算在办认领；
 *  - 可接 = 开放、指派组完整且为空、没有未关闭（或状态未知 / 不存在）的阻塞者；
 *  - 阻塞 = 开放、至少一个阻塞者不是已关闭（目标不存在也算阻塞，与派生统计的 NOT-FOUND 口径一致）；
 *  - 已认领 = 开放、至少一个指派人；
 *  - completeness 来自库级同步簿记的「整仓完整枚举时刻」：写过 = complete，没写过 = known。
 *    「已知」是诚实的下界，不是 0，也不是「真的只有这么多」。
 */
export interface SnapshotCounts {
  total: number
  open: number
  closed: number
  takeable: number
  blocked: number
  claimed: number
  completeness: 'complete' | 'known'
}

/** 列表查询参数。state 缺省为 open；all 表示不筛状态。limit 缺省不限制。 */
export interface ListQuery {
  state?: 'open' | 'closed' | 'all'
  limit?: number
}

/**
 * 按容器读一次查询（#1923）：容器身份是 (工作单元, 编号) 两段。
 *
 * 为什么单列而不是复用 IssueDetailQuery：详情要读正文、评论与四向边，这一条只要
 * 「容器行 + 它的全部子票行」——两者读的列、读的表与体积都不一样，混成一个查询会让
 * 「打开一张已关闭容器」多拉一份正文与评论。
 */
export interface ContainerProjectionQuery {
  key: string
  effortId?: string
}

/**
 * 一次按容器读的结果。container 为 null = 库里没有这张容器的行（连引用骨架都没有）；
 * issues 是挂在它下面的子票行（含已关闭，不含墓碑），形状与列表读完全一致。
 *
 * 为什么不在这里算层级与统计：那是领域规则（groupTickets / normalizeMapTickets），
 * 住在宿主组装层；库这一层只负责把行读齐、读准（规格 D1：领域规则一处实现）。
 */
export interface ContainerProjection {
  mergeVersion: number
  generatedAtMs: number
  container: ListIssue | null
  issues: ListIssue[]
}

/**
 * 变化集里一行的落点（#1885 评审修复）。由宿主变化集投影按库里的容器树一次算好，
 * 客户端只照单落位，不再自己按 parentKey 判容器归属（规格 D1：领域规则一处实现）。
 *
 *  - map：这一行自己是容器（地图或规格），更新 maps 里那一项；
 *  - child：挂到 containerEffortId + containerKey 那个容器的子票里；
 *  - thin：容器已关闭、子票也关闭，只留一条查标题用的瘦身行；
 *  - issue：未挂图票（根票、破链票、非容器行）。
 */
export interface ChangeRowPlacement {
  place: 'map' | 'child' | 'thin' | 'issue'
  /** child / thin 才给：所属容器的身份（与票身份同一套坐标）。 */
  containerEffortId?: string
  containerKey?: string
}

/** 变化集里的一次行变更：列表投影的行 + 它该落在哪里。 */
export type ChangeSetChangedRow = ListIssue & { placement: ChangeRowPlacement }

/**
 * 变化集里的墓碑行：某张票在第几个版本被确认不存在。
 *
 * 只带身份与删除时刻：界面拿它把对应的行拿掉，不需要墓碑自己的行字段（行还在库里，
 * 但按定义它不在集合里）。deleted_at_ms 进回包只为排查，不参与界面判断。
 */
export interface ChangeSetTombstone {
  effortId: string
  key: string
  deletedAtMs: number
}

/**
 * 变化集查询（#1890）。从 sinceVersion 到当前版本，最多回 maxRows 行、最多允许落后 maxAgeMs。
 *
 * sinceMs 是客户端看到 sinceVersion 的时刻，由调用方如实交来：时间只用于「落后太久就整份重取」
 * 这一档降级，不参与显示与新旧判断（规格 I3）。没带（0）时时间档不参与判断，行数上限照旧生效。
 *
 * maxRows / maxAgeMs 由调用方从中央时间参数传进来：快照库这一层不读配置，也不写死数字。
 */
export interface ChangeSetQuery {
  sinceVersion: number
  sinceMs?: number
  maxRows: number
  maxAgeMs: number
}

/** 回整份的原因代号。写进宿主回包，取值只许加、不许改字面。 */
export type ChangeSetFullReason =
  | 'no-baseline' // 客户端没给版本（或给的不是非负整数）：没有可比对的起点
  | 'version-regressed' // 客户端的版本比库里当前版本大：文件被旧拷贝覆盖或库重建过
  | 'rows-over-limit' // 变化的行与墓碑合计超过行数上限
  | 'age-over-limit' // 客户端手上的版本比时间上限更旧

/**
 * 一次变化集读的结果。
 *
 * full 为真时只有版本与原因：changes / missing 一律是空数组，表示「这一趟不给变化集」，
 * 调用方必须整份重取。不要把它当成「没有变化」——那是 full:false + 两个空数组。
 * 本层不拼事故意不截断：超过上限时不会交回前 maxRows 行，交回半份增量比整份更糟。
 */
export interface ChangeSetProjection {
  mergeVersion: number
  generatedAtMs: number
  full: boolean
  reason: ChangeSetFullReason | null
  changes: ChangeSetChangedRow[]
  missing: ChangeSetTombstone[]
}

/**
 * 详情读的十组三态。没有出现的组在库里没有记录（从没取过），值给 null。
 *
 * 界面靠它区分「确认没有」与「不知道」：completeness 是 complete 且值为空 = 确认没有；
 * 这里是 null（从没取过）或 unknown（带 reason）= 不知道。
 *
 * 评论与评审各有自己的组（#1865）：评论按页取，truncated 表示「只拿到前几条」；
 * 评审整组替换，complete 时的空数组才是「确认没有评审」。
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
  comments: GroupState | null
  review: GroupState | null
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
  /**
   * 评论，按取回顺序（#1865）。空数组有两种意思，看 groups.comments：complete 是「确认没有」，
   * truncated 是「一条都没拿到」，unknown 或没有组记录是「不知道」。
   */
  comments: SnapshotComment[]
  /**
   * 评论取到第几条（fetch_cursor 里那个游标，十进制文本）；null = 从没取过。
   * 界面拿它当「加载更多」的起点：已显示的条数比它少时，先补库里的，不必重取。
   */
  commentsCursor: string | null
  /** 评审，按取回顺序；是否「确认没有」同样看 groups.review。 */
  reviews: SnapshotReview[]
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

/**
 * 诊断：开库时的损坏重建、身份不符重建、退回只读等，都要让上层看得见。
 *
 * 每个码的含义（#1932 起收紧口径）：
 *   - corrupt-rebuilt / identity-mismatch-rebuilt / schema-reset：库本身不可用，整库重建过；
 *   - lease-held-readonly：网络盘 / UNC 上另一个进程拿着写者租约，本窗口退回只读。本地路径不再产生它；
 *   - lease-lost-readonly：网络盘上心跳丢了、写权被别人接手，本窗口降级只读。本地路径不再产生它；
 *   - readonly-filesystem：文件系统不可写（真的只能读），以只读连接打开。它说的是环境，不是写权；
 *   - legacy-writer-restart：本地开库时发现 meta 里还有一条未过期的旧租约——说明另一个进程可能还是
 *     旧版本、或者旧版本窗口还没关。本地写会被拒绝直到它过期，文案要求重启所有窗口（#1932 验收 5）。
 */
export type SnapshotDiagnosticCode =
  | 'corrupt-rebuilt'
  | 'identity-mismatch-rebuilt'
  | 'schema-reset'
  | 'lease-held-readonly'
  | 'lease-lost-readonly'
  | 'readonly-filesystem'
  | 'legacy-writer-restart'

export interface SnapshotDiagnostic {
  code: SnapshotDiagnosticCode
  /** 人话说明，直接可以展示给用户或写进日志。 */
  message: string
  /** 补充事实：旧身份、备份路径、抢租约失败的持有者等。 */
  detail?: string
}

/**
 * 快照库的占用读数（#1922）：库文件字节数与库里的票行数。
 *
 * 为什么要有它：2026-11-05 起按需细节不设上限、不按容量丢内容，库只会变大；增长要看得见，
 * 出问题时才能回答「库现在多大、里面几行」。字节数只数数据真正落在的那两份文件
 * （主文件加 WAL）：-shm 是进程间共享内存在盘上的映射，不是数据，数进来会随进程开合跳动。
 */
export interface SnapshotStorageStats {
  /** 主文件与 WAL 的字节数之和。 */
  bytes: number
  /** 库里的票行数（issue 表一行 = 一张票）。 */
  rows: number
  /**
   * 这份库落在哪种存储上（#1932）：本地磁盘或网络盘。设置页的「写模型」一行与日志靠它说清
   * 「这个窗口为什么按多写者工作、那个窗口为什么退回单写者」。
   */
  storageKind: SnapshotStorageKind
}
