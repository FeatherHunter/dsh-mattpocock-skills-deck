// contract/types.ts —— 对外写入与门面类型。
//
// 上层（refresh、界面、测试）只应该 import contract/ 里的东西。这里的形状是 #1862 定下的
// 门面骨架，后续实施票（1863+）直接按这个形状接，不要各自再造一套批次类型。
import type {
  GroupCompleteness,
  IssueRowValue,
  ListProjection,
  ListQuery,
  SnapshotActor,
  SnapshotBackend,
  SnapshotDiagnostic,
  SnapshotLabel,
  SnapshotMode,
} from '../model/types.js'

export type {
  GroupCompleteness,
  GroupState,
  IssueRowValue,
  ListIssue,
  ListProjection,
  ListQuery,
  SnapshotActor,
  SnapshotBackend,
  SnapshotDiagnostic,
  SnapshotDiagnosticCode,
  SnapshotLabel,
  SnapshotMode,
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

/** 一张票这一批要表达的三组。没有出现的组 = 这次没取到，不参与合并，也不参与版本门。 */
export interface IssueGroupsWrite {
  row?: GroupWrite<IssueRowValue | null>
  labels?: GroupWrite<SnapshotLabel[] | null>
  assignees?: GroupWrite<SnapshotActor[] | null>
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
 * 一批读结果。startMergeVersion 是调用方开始读这批数据时看到的版本（readList / getMergeVersion
 * 返回的那个）。事务里发现任一被表达组的 written_version 比它大，说明期间有别的写者先提交了，
 * 整批丢弃，避免用旧读结果覆盖新数据。
 */
export interface WriteBatch {
  startMergeVersion: number
  writes: IssueWrite[]
}

export interface IngestSuccess {
  committed: true
  mergeVersion: number
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
  readList(query?: ListQuery): ListProjection
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
