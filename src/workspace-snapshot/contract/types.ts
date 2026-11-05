// contract/types.ts —— 对外写入与门面类型。
//
// 上层（refresh、界面、测试）只应该 import contract/ 里的东西。这里的形状是 #1862 定下的
// 门面骨架，后续实施票（1863+）直接按这个形状接，不要各自再造一套批次类型。
import type {
  ChangeSetProjection,
  ChangeSetQuery,
  GroupCompleteness,
  IssueDetailProjection,
  IssueDetailQuery,
  IssueRowValue,
  ListProjection,
  ListQuery,
  SnapshotActor,
  SnapshotBackend,
  SnapshotComment,
  SnapshotCounts,
  SnapshotDiagnostic,
  SnapshotLabel,
  SnapshotMode,
  SnapshotReview,
  SubIssueCountsValue,
} from '../model/types.js'

export type {
  ChangeSetFullReason,
  ChangeSetProjection,
  ChangeSetQuery,
  ChangeSetTombstone,
  DetailGroupStates,
  GroupCompleteness,
  GroupState,
  IssueDetail,
  IssueDetailProjection,
  IssueDetailQuery,
  IssueRowValue,
  ListIssue,
  ListIssueRef,
  ListProjection,
  ListQuery,
  SnapshotActor,
  SnapshotBackend,
  SnapshotComment,
  SnapshotCounts,
  SnapshotDiagnostic,
  SnapshotDiagnosticCode,
  SnapshotLabel,
  SnapshotMode,
  SnapshotReview,
  SubIssueCountsValue,
} from '../model/types.js'

/**
 * 一个字段组的一次表达。
 *
 * - completeness 决定合并方式：complete 整组替换（value 为 null / 空数组就是确认没有），
 *   truncated 只补空缺，unknown 只盖章不动值。
 * - reason 只在 unknown 时有意义；source / operation 说明这批数据实际从哪来，方便排查。
 * - value 缺省（undefined）与 null 在 complete 下同义：确认这组没有内容。
 */
export interface GroupWrite<T> {
  completeness: GroupCompleteness
  reason?: string | null
  source?: string | null
  operation?: string | null
  value?: T
}

/**
 * 一条评论的写回执（#1866）：写完一条评论之后，把「多了这一条」并进库里那一组。
 *
 * 为什么它与「按页取回来的评论组」不是同一条路：一页永远是整组从头上数的一段前缀，
 * 而写回执只知道「多了一条，它在最后」。把一条新评论当成前缀写，会让游标跟着往前走，
 * 下一次「加载更多」就会跳过中间还没取到的那几条；位置算错还会把已知评论覆盖掉。
 *
 * 两条约定：
 *  - position 是这一条在整组里的位置（从 0 数）。知道票面总数时就用它，前面的空隙留给还没取到的那些；
 *    不知道总数时给 null，落到已取条数后面。库里发现那个位置已经有别人取回来的评论，就往后挪，
 *    宁可位置不精确也不删掉已知的那一条。
 *  - completeness 是写完这一条之后这一组的处境：原来完整就仍然完整（加一条之后我们仍知道全部），
 *    原来只有一部分就仍然只有一部分（中间那几条我们没取过）。游标只在完整时跟着条数走。
 */
export interface CommentReceiptWrite {
  comment: SnapshotComment
  position: number | null
  completeness: GroupCompleteness
  source?: string | null
  operation?: string | null
}

/**
 * 一张票这一批要表达的字段组。没有出现的组 = 这次没取到，不参与合并，也不参与版本门。
 *
 * 两组边写的是「目标票的 key」，不是数据库 id：上层拿到的列表行里只有 key，写库时由快照库
 * 自己解析成 issue_id，并在目标票还不存在时先建一行引用骨架（只有身份，不出现在列表里）。
 * parents 是这张票的父票（容器树），blockedBy 是阻塞这张票的票（状态胶囊要它）。
 *
 * 正文、子票计数、合并信息各自独立成组，不塞进 row：row 是「整行我都知道」的语义，
 * 详情读结果未必知道这几项，混进 row 会把上一次从列表学到的计数一起抹掉。
 * mergeInfo 的值直接是合并时间的毫秒数；complete + null 表示确认还没合并。
 *
 * 评论与评审各有自己的组（#1865）。评论是按页取回来的「从头开始的前几条」，所以 truncated
 * 只覆盖前几条、不删已知的后面几条；complete 才是「整组换掉」。评审整组替换，contract 里
 * 没有评审 id，顺序就是唯一稳定的东西。
 */
export interface IssueGroupsWrite {
  row?: GroupWrite<IssueRowValue | null>
  /** 正文（Markdown 原文）；complete + null / 空串 = 确认没有正文。 */
  body?: GroupWrite<string | null>
  labels?: GroupWrite<SnapshotLabel[] | null>
  assignees?: GroupWrite<SnapshotActor[] | null>
  parents?: GroupWrite<string[] | null>
  blockedBy?: GroupWrite<string[] | null>
  /** 子票计数；complete + null 按「确认没有子票」写 0/0/0。 */
  subIssues?: GroupWrite<SubIssueCountsValue | null>
  /** 合并信息（合并时间的毫秒数）；complete + null = 确认还没合并。 */
  mergeInfo?: GroupWrite<number | null>
  /**
   * 评论（按取回顺序的前几条）；complete + 空数组 = 确认没有评论。
   * 每次写这一组都要同时告诉库里「取到第几条了」，所以这一组的值只能是数组，不能是 null。
   */
  comments?: GroupWrite<SnapshotComment[]>
  /** 评审（按顺序）；complete + 空数组 = 确认没有评审。 */
  review?: GroupWrite<SnapshotReview[]>
  /**
   * 写回执追加的一条评论（#1866）。与 comments 互斥：一次写入只走其中一条路。
   * 它落在同一张表、同一个组名（comments）下，所以版本门与三态章都按评论组算。
   */
  commentReceipt?: CommentReceiptWrite
}

/**
 * 一张票的一批写入。身份是 (effortId, key)：GitHub/GitLab 的 effortId 写空串，
 * 本地 Markdown 写工作单元目录名。两者一起才是唯一身份，单靠票号会串工作单元。
 */
export interface IssueWrite {
  effortId: string
  key: string
  groups: IssueGroupsWrite
}

/**
 * 一条「某张票不在了」。身份是 (effortId, key)，与普通写入同一套坐标。
 * 写在契约层而不是 runtime 里：句柄签名要用它，而 runtime 依赖契约、不能反向。
 */
export interface MissingTicket {
  effortId: string
  key: string
}

/** markMissing 的回执。committed 为真表示墓碑真的写进去了（或本来就没有要写的）。 */
export interface MarkMissingResult {
  committed: boolean
  /** 提交后的库版本；没提交时是当前版本。 */
  mergeVersion: number
  /** 真的写进墓碑的条数（库里不认识的票号会被跳过）。 */
  marked: number
  reason?: 'stale' | 'write-failed' | 'readonly'
  detail?: string
}

/**
 * 同步簿记（#1888，规格 #1885 §5）：水印、世代号、待办三样，住进库级元信息，与数据同生共死。
 *
 * 为什么放在库里而不是宿主内存：行级增量判「远端有没有变」就靠这三样。放在进程内存里时，
 * 切会话或重启宿主之后水印与待办一起清空，第一拍要整仓重扫；而变化只补进内存时，库与界面
 * 还会说出两个值。三样都写进 meta 之后，关库重开读回来的就是上一次的现场。
 *
 * 约定：簿记不是数据。只写簿记不动 merge_version、不盖行上的变化版本 —— 版本号只由数据提交
 * 推进，否则每一次探测都会让别人手里的 startMergeVersion 提前过期。
 */
export interface SyncBookkeeping {
  /** 上一次次探测的起点毫秒；0 = 还没有可用水印。 */
  watermarkMs: number
  /** 本工作区的世代号：每收下一份结果加一，迟到的结果拿旧值来比就会被挡住。 */
  generation: number
  /** 没并进去的变化票号（去重、按字符串排序）。 */
  pending: string[]
  /** 最近一次记待办的时刻毫秒；没有待办时是 0。 */
  pendingAtMs: number
  /** 最近一次记待办的原因代号；没有待办时是空串。 */
  pendingReason: string
  /** 整仓最近一次完整枚举完成的时刻毫秒；0 = 从没完整取过。 */
  fullEnumerationMs: number
}

/**
 * 一次簿记写入。只给要改的那几格，没给的保持库里的值。
 *
 * expectedGeneration 是「迟到的结果不许覆盖更新的结果」在库这一侧的落点：给了它、而库里当前
 * 的世代号与它不等，整笔写入（含同一事务里的行）一个字都不动，回 stale。
 */
export interface SyncBookkeepingWrite {
  watermarkMs?: number
  generation?: number
  pending?: readonly string[]
  pendingAtMs?: number
  pendingReason?: string
  fullEnumerationMs?: number
  expectedGeneration?: number
}

/** 单独写簿记的回执；committed 为假表示被门挡下或写失败，state 仍是读到的当前值。 */
export interface SyncBookkeepingResult {
  committed: boolean
  state: SyncBookkeeping
  reason?: 'stale' | 'readonly' | 'write-failed'
  detail?: string
}

/**
 * 一批读结果。startMergeVersion 是调用方开始读这批数据时看到的版本（readList / getMergeVersion
 * 返回的那个）。事务里发现任一被表达组的 written_version 比它大，说明期间有别的写者先提交了，
 * 整批丢弃，避免用旧读结果覆盖新数据。
 */
export interface WriteBatch {
  startMergeVersion: number
  writes: IssueWrite[]
  /**
   * 与这一批行同一个事务提交的同步簿记（#1888）。行级增量把「变化的那几行」与「水印/世代号/待办」
   * 一起写：行写进去而簿记没写进去，下一拍就得重扫；簿记先进而行没进去，界面又会拿到不满意的结果。
   * 给了 expectedGeneration 时，库里世代号对不上就整批丢弃（回 stale），行与簿记都不动。
   */
  sync?: SyncBookkeepingWrite
}

export interface IngestSuccess {
  committed: true
  mergeVersion: number
  /** 这一批顺带写下的同步簿记（只有 batch.sync 给了才有）。 */
  sync?: SyncBookkeeping
  /**
   * 这一批里写回执那条评论最后落在第几位（#1866）。只有表达过评论写回执时才有值；
   * 上层拿它说「这一条存在第几位」，与库里实际写下的位置一致（被占用时可能往后挪过）。
   */
  commentPositions?: number[]
}

export interface IngestFailure {
  committed: false
  /** stale = 版本门丢弃；readonly = 没租约 / 只读句柄；write-failed = 事务失败已回滚。 */
  reason: 'stale' | 'readonly' | 'write-failed'
  detail?: string
}

export type IngestResult = IngestSuccess | IngestFailure

/** 日志回调。事件名与字段稳定；不注入就完全不记（与仓库其他可选日志埋点一致）。 */
export type SnapshotLogLevel = 'info' | 'warn' | 'error'
export type SnapshotLogEvent = (
  level: SnapshotLogLevel,
  event: string,
  fields: Record<string, unknown>,
) => void

export interface OpenWorkspaceSnapshotOptions {
  /** 工作区里的任意目录；按 workspace.yaml 规则向上归一到工作区根。 */
  workspaceRoot: string
  backend: SnapshotBackend
  /** 后端给的身份：GitHub owner/name、GitLab path、markdown 工作区根。 */
  repoIdentity: string
  /** 测试注入用；缺省按规格落到 <根>/.dsh-mattskillsdeck-cache/snapshot/<backend>.sqlite。 */
  dbPath?: string
  /** 可注入时钟，单位毫秒；租约与时间戳都用它。缺省 Date.now。 */
  now?: () => number
  /** 写者标识；缺省由进程号 + 随机串生成。同一进程开两个句柄时必须区分。 */
  leaseOwner?: string
  logEvent?: SnapshotLogEvent
}

/**
 * 快照句柄。mode 是动态的：写者心跳丢了会降级成 readonly，readList 仍可用。
 *
 * ingest 是同步的：SQLite 在本机是同步 IO，包成 Promise 只会让调用方误以为可以并发压进来。
 */
export interface WorkspaceSnapshotHandle {
  readonly mode: SnapshotMode
  /** 当前库里的合并版本；只读句柄也能读。 */
  getMergeVersion(): number
  ingest(batch: WriteBatch): IngestResult
  /**
   * 把一批「这张票不在了」写进墓碑（#1886）。库只增不删：行留着，墓碑让回放不再画它。
   * 票重新出现时由普通写入清掉墓碑，所以这不是永久判决。只读句柄拒绝。
   */
  markMissing(entries: readonly MissingTicket[], startMergeVersion: number): MarkMissingResult
  /**
   * 读同步簿记（水印、世代号、待办）。只读句柄也能读：库是唯一真相，读不写。
   */
  readSyncBookkeeping(): SyncBookkeeping
  /**
   * 只写同步簿记，不动数据、不动合并版本。只读句柄拒绝。
   * 给了 expectedGeneration 而库里世代号对不上时回 committed:false / stale，一个字节不改。
   */
  writeSyncBookkeeping(write: SyncBookkeepingWrite): SyncBookkeepingResult
  /**
   * 面板顶上的六个数字（#1887）：只读、一次查询，按库里的行与边算。
   *
   * 为什么放在句柄上而不是让上层自己拼 SQL：完整度要看库级同步簿记，而簿记与数据同生共死；
   * 上层拿到的必须是一个自洽的答案（六个数字 + 这份答案够不够全），不能自己拿一个数字去猜另一个。
   * 只读句柄也能读：它不改任何库内容。
   */
  readCounts(): SnapshotCounts
  readList(query?: ListQuery): ListProjection
  /**
   * 读一张票的详情：行、正文、标签、指派、父子、阻塞、被阻塞、子票、合并信息与各组三态。
   * 库里没有这张票（连骨架都没有）时 issue 为 null；只有骨架时 referenceSkeleton 为真。
   */
  readIssueDetail(query: IssueDetailQuery): IssueDetailProjection
  /**
   * 读一次变化集（#1890）：从 query.sinceVersion 到当前版本，哪些行变了、哪些行被判不存在。
   * 超过行数上限或落后超过时间上限、客户端版本比库里大、或没有基线时 full 为真 ——
   * 这四种情况都不给变化行，调用方必须整份重取。只读句柄也能读。
   */
  readChangeSet(query: ChangeSetQuery): ChangeSetProjection
  /** 整库重建（清空后按当前身份建空库）。只读句柄拒绝。 */
  rebuild(): void
  close(): void
  /** 开库至今累计的诊断（含退回只读）。返回副本，调用方改不动内部数组。 */
  getDiagnostics(): SnapshotDiagnostic[]
}

export interface OpenWorkspaceSnapshotResult {
  handle: WorkspaceSnapshotHandle
  mode: SnapshotMode
  diagnostics: SnapshotDiagnostic[]
}
