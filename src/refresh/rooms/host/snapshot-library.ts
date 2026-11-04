/**
 * src/refresh/rooms/host/snapshot-library.ts —— 宿主侧的快照库门面（#1863）
 *
 * 职责只有三件，别把它做成第二个编排器：
 *  1. 按 (工作区, 后端, 仓库身份) 懒开一个库句柄，最多同时留 4 个；淘汰时关掉最旧的。
 *  2. recordIssueRows：把列表电话拿到的 tracker 票按组、分批写进库。失败只回结果，不抛。
 *  3. readSnapshotReplay：把库里的列表投影装回界面要的快照主体（容器树 + 子票 + 瘦身行）。
 *
 * 为什么句柄要缓存：租约心跳每 5 秒续一次，每次请求都开/关库会让心跳与连接反复重建，
 * 还会让两个并发请求互相抢租约。缓存之后同一进程里同一身份只有一个写者。
 *
 * 为什么写入要分批：孩子可能一次回来几千张票，单条事务里既吃内存又让版本门太粗；
 * 200 条一批是经验值——一轮列表最多几十批，每批都在毫秒级。
 */
/// <reference path="../../../workspace-snapshot/node-ambient.d.ts" />
import type { Comment, Issue, RepositoryRef } from '../../../tracker/contract/entities.js'
import type {
  GroupCompleteness,
  IssueDetailProjection,
  IssueWrite,
  ListProjection,
  OpenWorkspaceSnapshotOptions,
  SnapshotBackend,
  SnapshotDiagnostic,
  WorkspaceSnapshotHandle,
} from '../../../workspace-snapshot/contract/types.js'
import {
  RECEIPT_SOURCE,
  commentPageWriteOf,
  commentReceiptValueOf,
  detailIssueWriteOf,
  issueWritesOf,
  receiptIssueWriteOf,
} from './snapshot-library-adapter.js'
import { snapshotOfProjection } from './snapshot-library-view.js'

// 开库走契约入口；上面那行环境声明把快照树用到的最小 Node 能力借给本文件（与宿主其余
// 「不挂整包 Node 类型」的写法同一口径）。说明符写成字面量，依赖图才看得见「刷新 → 契约」这条边。
// 租约标识要进程号；宿主侧其余文件也都是「可能不存在」的局部声明，不引整包 Node 类型。
declare const process: { pid: number } | undefined
async function openSnapshot(options: OpenWorkspaceSnapshotOptions): Promise<{ handle: WorkspaceSnapshotHandle }> {
  const mod = await import('../../../workspace-snapshot/contract/index.js')
  return mod.openWorkspaceSnapshot(options)
}

/** 同一工作区最多同时留几个库句柄；工作区一般只有一个，留 4 是给多仓库/多后端切换。 */
const MAX_HANDLES = 4

/** 一批写多少张票；见文件头。 */
export const SNAPSHOT_WRITE_CHUNK = 200

/** 开库身份：三个格一起决定库文件与句柄，缺一个都会串工作区。 */
export interface SnapshotLibraryKey {
  workspaceRoot: string
  backend: string
  repoIdentity: string
}

export interface RecordIssueRowsInput extends SnapshotLibraryKey {
  rows: Issue[]
}

export interface RecordIssueRowsResult {
  ok: boolean
  /** 这一趟真正提交进库的票数（分批失败时是失败前已提交的数量）。 */
  rows: number
  /** 最后一批提交后的合并版本；没写成功时是 null。 */
  mergeVersion: number | null
  /** 没写成功时的简短原因（readonly / unavailable / 具体异常一句）。 */
  reason?: string
}

export interface SnapshotReplayInput extends SnapshotLibraryKey {
  repo: RepositoryRef
}

export interface SnapshotReplay {
  /** 与在线组装同形：{repository,maps,issues,thinTickets,deck}。 */
  snapshot: any
  mergeVersion: number
  /** 库里这批数据最后一次被查询的时间（毫秒）；界面用它说「这是上次的数据」。 */
  lastKnownAtMs: number
  /** 回放的行数，便于日志与门禁断言。 */
  rows: number
}

interface HandleEntry {
  handle: WorkspaceSnapshotHandle
  key: string
}

const handles = new Map<string, HandleEntry>()
let leaseSeq = 0

/**
 * #1869：快照库四族事件（开库、租约、写入、损坏重建）的出口。宿主装配时塞进来，缺席就完全不记——
 * 与仓库「可选注入 logEvent」的既有约定同一口径（快照树自己的 runtime/log.ts 就是这么写的）。
 *
 * 为什么由宿主注入而不是这里直接找日志库：刷新房在依赖方向上低于宿主，往上引会把装配关系反过来。
 */
export type SnapshotLogSink = (level: string, event: string, fields: Record<string, unknown>) => void
let logSink: SnapshotLogSink | null = null

/** 接上日志出口。传 null 关掉（门禁与测试用）。 */
export function setSnapshotLogSink(sink: SnapshotLogSink | null): void {
  logSink = sink
}

function cacheKeyOf(input: SnapshotLibraryKey): string {
  return [input.workspaceRoot, input.backend, input.repoIdentity].join('\u0000')
}

function supportedBackend(backend: string): backend is SnapshotBackend {
  return backend === 'github' || backend === 'gitlab' || backend === 'markdown'
}

/** 拿一个可用的句柄；开不出来回 null（首屏不许因为库不可用而空，调用方会回落在线路径）。 */
async function handleOf(input: SnapshotLibraryKey): Promise<WorkspaceSnapshotHandle | null> {
  if (!input.workspaceRoot || !supportedBackend(input.backend)) return null
  const key = cacheKeyOf(input)
  const hit = handles.get(key)
  if (hit) {
    // Map 的插入顺序当 LRU：每次命中挪到队尾。
    handles.delete(key)
    handles.set(key, hit)
    return hit.handle
  }
  let opened: { handle: WorkspaceSnapshotHandle }
  try {
    leaseSeq += 1
    const pid = (typeof process !== 'undefined' && process) ? process.pid : 0
    opened = await openSnapshot({
      workspaceRoot: input.workspaceRoot,
      backend: input.backend,
      repoIdentity: input.repoIdentity,
      leaseOwner: 'refresh-' + pid + '-' + leaseSeq,
      now: () => Date.now(),
      // #1869：开库与后续写入的轨迹都走这一个口；没接时快照树自己就不记，一个字节都不会多写。
      ...(logSink ? { logEvent: logSink as any } : null),
    })
  } catch (e) {
    return null
  }
  while (handles.size >= MAX_HANDLES) {
    const oldestKey = handles.keys().next().value as string | undefined
    if (oldestKey === undefined) break
    const oldest = handles.get(oldestKey)
    handles.delete(oldestKey)
    try { if (oldest) oldest.handle.close() } catch (e) { /* 关不掉也不影响新句柄 */ }
  }
  handles.set(key, { handle: opened.handle, key })
  return opened.handle
}

/** 错误收成一句人话；不把异常对象原样抛给上层。 */
function textOf(e: unknown): string {
  try {
    const message = (e as { message?: unknown } | null | undefined)?.message
    return (typeof message === 'string' && message) ? message : String(e)
  } catch {
    return '未知错误'
  }
}

/**
 * 把一批列表读结果写进库（按 200 条分批，每批各自取当前合并版本）。
 *
 * 版本门 stale 只重试一次：说明期间有别的写者提交了，重读版本再写通常就过；
 * 连续两次 stale 说明并发写太密，这一趟放弃，下一轮列表会再写。只读句柄直接停，
 * 不再徒劳重试（租约丢了要等重启或另一个写者退出）。
 */
export async function recordIssueRows(input: RecordIssueRowsInput): Promise<RecordIssueRowsResult> {
  const writes: IssueWrite[] = issueWritesOf(input.rows || [], input.backend)
  if (!writes.length) return { ok: true, rows: 0, mergeVersion: null }
  const handle = await handleOf(input)
  if (!handle) return { ok: false, rows: 0, mergeVersion: null, reason: 'unavailable' }
  let written = 0
  let mergeVersion: number | null = null
  for (let offset = 0; offset < writes.length; offset += SNAPSHOT_WRITE_CHUNK) {
    const chunk = writes.slice(offset, offset + SNAPSHOT_WRITE_CHUNK)
    let result = handle.ingest({ startMergeVersion: handle.getMergeVersion(), writes: chunk })
    if (!result.committed && result.reason === 'stale') {
      result = handle.ingest({ startMergeVersion: handle.getMergeVersion(), writes: chunk })
    }
    if (!result.committed) {
      return { ok: false, rows: written, mergeVersion, reason: result.reason }
    }
    written += chunk.length
    mergeVersion = result.mergeVersion
  }
  return { ok: true, rows: written, mergeVersion }
}

function lastKnownAtMsOf(projection: ListProjection): number {
  let latest = 0
  for (const item of projection.issues) {
    for (const group of [item.groups.row, item.groups.body, item.groups.labels, item.groups.assignees, item.groups.parents, item.groups.blockedBy, item.groups.subIssues, item.groups.mergeInfo]) {
      if (group && group.lastQueriedMs > latest) latest = group.lastQueriedMs
    }
  }
  return latest || projection.generatedAtMs
}

/**
 * 开库诊断：损坏后整库重建、身份或结构不符重建、退回只读。库开不出来就回空数组。
 *
 * 为什么单开一个读口而不是塞进 readSnapshotReplay：库为空（尤其刚重建完）时回放是 null，
 * 但这正是最需要把人话提示交给界面的时刻；把诊断绑在「有回放」上会让损坏重建静默。
 */
export async function readSnapshotDiagnostics(input: SnapshotLibraryKey): Promise<SnapshotDiagnostic[]> {
  const handle = await handleOf(input)
  if (!handle) return []
  try {
    return handle.getDiagnostics()
  } catch (e) {
    return []
  }
}

/** 库为空（或者开不出来）回 null；有行就回放成与在线组装同形的快照主体。 */
export async function readSnapshotReplay(input: SnapshotReplayInput): Promise<SnapshotReplay | null> {
  const handle = await handleOf(input)
  if (!handle) return null
  let projection: ListProjection
  try {
    projection = handle.readList({ state: 'all' })
  } catch (e) {
    return null
  }
  if (!projection || !projection.issues.length) return null
  return {
    snapshot: snapshotOfProjection(input.repo, projection),
    mergeVersion: projection.mergeVersion,
    lastKnownAtMs: lastKnownAtMsOf(projection),
    rows: projection.issues.length,
  }
}

export interface RecordIssueDetailInput extends SnapshotLibraryKey {
  issue: Issue
}

export interface RecordIssueDetailResult {
  ok: boolean
  /** 这一趟提交进库后的合并版本；没写成功时是 null。 */
  mergeVersion: number | null
  /** 没写成功时的简短原因（readonly / unavailable / 具体异常一句）。 */
  reason?: string
}

export interface ReadIssueDetailInput extends SnapshotLibraryKey {
  key: string
  effortId?: string
}

/**
 * 把一次详情读结果写进库（#1864）。一张票一次 ingest：正文、标签、父票、阻塞、子票计数、
 * 合并信息各按组写，不碰别的票。
 *
 * 版本门 stale 只重试一次（与列表写入同一口径）：说明期间有别的写者提交了，重读版本再写
 * 通常就过；连续两次 stale 说明并发写太密，这一趟放弃，下一次打开详情还会再写。
 */
export async function recordIssueDetail(input: RecordIssueDetailInput): Promise<RecordIssueDetailResult> {
  if (!input.issue || input.issue.key == null) return { ok: true, mergeVersion: null }
  const handle = await handleOf(input)
  if (!handle) return { ok: false, mergeVersion: null, reason: 'unavailable' }
  const writes: IssueWrite[] = [detailIssueWriteOf(input.issue, input.backend)]
  let result = handle.ingest({ startMergeVersion: handle.getMergeVersion(), writes })
  if (!result.committed && result.reason === 'stale') {
    result = handle.ingest({ startMergeVersion: handle.getMergeVersion(), writes })
  }
  if (!result.committed) return { ok: false, mergeVersion: null, reason: result.reason }
  return { ok: true, mergeVersion: result.mergeVersion }
}

/**
 * 从库里读一张票的详情（#1864）。库开不出来或没有这张票都回 null——调用方据此决定
 * 「回落到取数」还是「如实说没有」，不要拿空壳冒充。
 */
export async function readIssueDetail(input: ReadIssueDetailInput): Promise<IssueDetailProjection | null> {
  const handle = await handleOf(input)
  if (!handle) return null
  try {
    return handle.readIssueDetail({ key: input.key, effortId: input.effortId })
  } catch (e) {
    return null
  }
}

/**
 * 把一页评论写进库（#1865）。每取一页调一次：评论按页覆盖（truncated 只覆盖从头数的前几条，
 * complete 整组替换），同时推进「取到第几条」的游标，下一次加载更多从这里接着走。
 *
 * 只表达评论这一组：这条电话要回来的是一整张票，但它是为了加载更多发的，重写行与正文只会
 * 把详情那边刚写好的组时刻推新。写库失败不影响这次回包（调用方照旧把新增段交回界面）。
 */
export async function recordIssueComments(input: RecordIssueDetailInput): Promise<RecordIssueDetailResult> {
  if (!input.issue || input.issue.key == null) return { ok: true, mergeVersion: null }
  const writes: IssueWrite[] = [commentPageWriteOf(input.issue)]
  if (!writes[0] || Object.keys(writes[0].groups).length === 0) return { ok: true, mergeVersion: null }
  const handle = await handleOf(input)
  if (!handle) return { ok: false, mergeVersion: null, reason: 'unavailable' }
  let result = handle.ingest({ startMergeVersion: handle.getMergeVersion(), writes })
  if (!result.committed && result.reason === 'stale') {
    result = handle.ingest({ startMergeVersion: handle.getMergeVersion(), writes })
  }
  if (!result.committed) return { ok: false, mergeVersion: null, reason: result.reason }
  return { ok: true, mergeVersion: result.mergeVersion }
}

export interface WriteReceiptInput extends SnapshotLibraryKey {
  /** 写完之后 tracker 交回来的那张票（可能不止一张：一次调用可以改到几张）。 */
  issues: Issue[]
  /** 是哪条写操作交回来的：close / reopen / update / setLabels … 只进日志与组记录，不参与判断。 */
  operation: string
}

export interface WriteReceiptResult {
  ok: boolean
  /** true = 库这会儿开不出来，这次没写进库；调用方按老路继续（这是明示的降级，不是写成功）。 */
  degraded?: boolean
  /** 真正提交进库的票数。 */
  rows: number
  mergeVersion: number | null
  reason?: string
}

export interface CommentReceiptInput extends SnapshotLibraryKey {
  /** 这张票在库里可能用的键（本地 Markdown 补零、GitHub 不补零，两种都试）。 */
  keys: string[]
  effortId?: string
  /** 写完之后 tracker 交回来的那一条评论。 */
  comment: Comment
}

export interface CommentReceiptResult {
  ok: boolean
  degraded?: boolean
  mergeVersion: number | null
  /** 这一条最后落在评论组的第几位（0 起）；库没写成时是 null。 */
  position: number | null
  reason?: string
}

/** 库的身份没给对：这不是「库不可用」，是调用方传错了，如实回失败。 */
function keyProblemOf(input: SnapshotLibraryKey): string | null {
  if (!input || typeof input.workspaceRoot !== 'string' || !input.workspaceRoot) return 'no-workspace'
  if (!supportedBackend(String(input.backend || ''))) return 'unsupported-backend'
  return null
}

/**
 * 把一批写回执写进库（#1866）：改状态、改标签、改标题之后，tracker 交回来的那张票按组并进库。
 *
 * 为什么与列表写入同一套换算：回执表达的组就是「行 + 标签 + 指派 + 父子 + 阻塞」这几样，
 * 换算规则只该有一份（见 snapshot-library-adapter.ts 的 receiptIssueWriteOf）。
 * 一批一个事务：其中一张票写不进去，整批都不提交，不会留下半批。
 *
 * 三种结局：
 *   { ok:true }                 提交成功，界面这时候才该更新；
 *   { ok:true, degraded:true }  库开不出来（没有工作区根、打不开文件），这次没写，按老路继续；
 *   { ok:false, reason }        调用方给的参数不对，或者事务被版本门挡下 / 写失败，库一个字节没改。
 */
export async function recordWriteReceipt(input: WriteReceiptInput): Promise<WriteReceiptResult> {
  const problem = keyProblemOf(input)
  if (problem) return { ok: false, rows: 0, mergeVersion: null, reason: problem }
  const operation = String(input.operation || 'write')
  const writes: IssueWrite[] = (Array.isArray(input.issues) ? input.issues : [])
    .filter((issue) => !!issue && issue.key != null)
    .map((issue) => receiptIssueWriteOf(issue, operation, input.backend))
  if (!writes.length) return { ok: true, rows: 0, mergeVersion: null }
  const handle = await handleOf(input)
  if (!handle) return { ok: true, degraded: true, rows: 0, mergeVersion: null, reason: 'library-unavailable' }
  let result = handle.ingest({ startMergeVersion: handle.getMergeVersion(), writes })
  // 与读结果写入同一口径：stale 说明期间有别的写者先提交了，重读版本再写一次；两次都不成才放弃。
  if (!result.committed && result.reason === 'stale') {
    result = handle.ingest({ startMergeVersion: handle.getMergeVersion(), writes })
  }
  if (!result.committed) return { ok: false, rows: 0, mergeVersion: null, reason: result.reason }
  return { ok: true, rows: writes.length, mergeVersion: result.mergeVersion }
}

/**
 * 把一条评论写回执写进库（#1866）：发评论成功后，把这一条追加进评论组，一个事务。
 *
 * 位置与完整度怎么定：
 *  - 库里这张票的行组记着票面总数时，新评论的位置就是那个数（它是这条新评论的下标）；
 *    不知道总数时交给库里落到已有条数后面。
 *  - 原来评论组是 complete（我们确实知道这张票的全部评论），加一条之后仍然 complete；
 *    只有一部分或从没取过时写成 truncated —— 中间那几条我们没取过，不许说成知道。
 *
 * 票号两种写法都试：本地 Markdown 存的是补零的键（01），GitHub 是不补零的（1）。写错键会让库里
 * 多出一张只有身份的骨架票，评论挂在那张骨架下面，详情页永远看不到。
 */
export async function recordCommentReceipt(input: CommentReceiptInput): Promise<CommentReceiptResult> {
  const problem = keyProblemOf(input)
  if (problem) return { ok: false, mergeVersion: null, position: null, reason: problem }
  const keys: string[] = (Array.isArray(input.keys) ? input.keys : [])
    .map((key) => String(key || ''))
    .filter((key) => key !== '')
  if (!keys.length) return { ok: false, mergeVersion: null, position: null, reason: 'no-keys' }
  const comment = input.comment
  if (!comment || typeof comment.body !== 'string') {
    return { ok: false, mergeVersion: null, position: null, reason: 'no-comment' }
  }
  const handle = await handleOf(input)
  if (!handle) return { ok: true, degraded: true, mergeVersion: null, position: null, reason: 'library-unavailable' }
  // 闭包里再读一次句柄时编译器收窄不过去（它可能在中途被换掉），这里先固定成一份可用的句柄。
  const db: WorkspaceSnapshotHandle = handle
  const effortId = String(input.effortId || '')

  /** 读一次库里那张票，据此算这条评论该落在第几位、写完还算不算完整。 */
  function planOf(): { key: string, write: IssueWrite, fallbackPosition: number | null } {
    let found: IssueDetailProjection | null = null
    let key = keys[0]
    for (const candidate of keys) {
      const projection = db.readIssueDetail({ key: candidate, effortId })
      if (projection && projection.issue) { found = projection; key = candidate; break }
    }
    const issue = found ? found.issue : null
    const group = issue ? issue.groups.comments : null
    const completeness: GroupCompleteness = (group && group.completeness === 'complete') ? 'complete' : 'truncated'
    const count = issue && typeof issue.row.commentCount === 'number' && Number.isFinite(issue.row.commentCount)
      ? Math.floor(issue.row.commentCount)
      : null
    const write: IssueWrite = {
      effortId,
      key,
      groups: {
        commentReceipt: {
          comment: commentReceiptValueOf(comment),
          position: count,
          completeness,
          source: RECEIPT_SOURCE,
          operation: 'comment',
        },
      },
    }
    return { key, write, fallbackPosition: count }
  }

  let planned = planOf()
  let result = handle.ingest({ startMergeVersion: handle.getMergeVersion(), writes: [planned.write] })
  if (!result.committed && result.reason === 'stale') {
    planned = planOf()
    result = handle.ingest({ startMergeVersion: handle.getMergeVersion(), writes: [planned.write] })
  }
  if (!result.committed) return { ok: false, mergeVersion: null, position: null, reason: result.reason }
  const applied = Array.isArray(result.commentPositions) && result.commentPositions.length ? result.commentPositions[0] : planned.fallbackPosition
  return { ok: true, mergeVersion: result.mergeVersion, position: applied }
}

/** 测试与进程收尾用：关掉所有缓存句柄；之后再用会重新开库。 */export function closeSnapshotLibraries(): void {
  for (const entry of handles.values()) {
    try { entry.handle.close() } catch (e) { /* 幂等关闭 */ }
  }
  handles.clear()
}

/** 当前缓存的句柄数（测试断言句柄上限用）。 */
export function snapshotLibraryHandleCount(): number {
  return handles.size
}
