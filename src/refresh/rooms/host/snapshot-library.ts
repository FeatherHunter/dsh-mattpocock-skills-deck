/**
 * src/refresh/rooms/host/snapshot-library.ts —— 宿主侧的快照库门面（#1863）
 *
 * 职责（别把它做成第二个编排器）：
 *  1. recordIssueRows：把列表电话拿到的 tracker 票按组、分批写进库。失败只回结果，不抛。
 *  2. readSnapshotReplay：把库里的列表投影装回界面要的快照主体（容器树 + 子票 + 瘦身行）。
 *  3. 详情与评论页的读/写口。写回执与评论回执搬到了 snapshot-library-receipts.ts（#1935），
 *     本文件原样转出，调用方不用改。
 *
 * #1888 起句柄缓存与同步簿记读写各自搬到同目录的 snapshot-library-handles.ts 与
 * snapshot-library-sync.ts（本文件贴着 350 有效行上限）；四个新口在这里原样转出，
 * 调用方仍然只认这一个门面。
 *
 * 为什么写入要分批：孩子可能一次回来几千张票，单条事务里既吃内存又让版本门太粗；
 * 200 条一批是经验值——一轮列表最多几十批，每批都在毫秒级。
 */
/// <reference path="../../../workspace-snapshot/node-ambient.d.ts" />
import type { Issue, RepositoryRef } from '../../../tracker/contract/entities.js'
import type {
  ContainerProjection,
  IssueDetailProjection,
  IssueWrite,
  ListProjection,
  SnapshotCounts,
  SnapshotDiagnostic,
} from '../../../workspace-snapshot/contract/types.js'
import {
  commentPageWriteOf,
  detailIssueWriteOf,
  issueWritesOf,
} from './snapshot-library-adapter.js'
import {
  closeSnapshotLibraries,
  handleOf,
  setSnapshotLogSink,
  snapshotLibraryHandleCount,
  type SnapshotLibraryKey,
  type SnapshotLogSink,
} from './snapshot-library-handles.js'
import { containerProjectionOf, snapshotOfProjection } from './snapshot-library-view.js'
import {
  clearLibraryBehind,
  readLibraryBehind as readLibraryBehindState,
  type LibraryBehindState,
} from './snapshot-library-behind.js'

// 句柄缓存与开关：调用方（宿主入口与门禁）从这里拿的仍是同一组名字。
export { closeSnapshotLibraries, setSnapshotLogSink, snapshotLibraryHandleCount }
export type { SnapshotLibraryKey, SnapshotLogSink }
// 同步簿记、差分基线与变化行提交（#1888）：行级增量要用的四个口，实现住在同目录的 sync 模块。
export {
  commitChangeRows,
  readIssueIndex,
  readSyncState,
  writeSyncState,
} from './snapshot-library-sync.js'
export type { ChangeRowsInput, ChangeRowsResult, LibrarySyncState } from './snapshot-library-sync.js'
// 版本查询与变化集两条新读口（#1890）：实现住在同目录的 read 模块，调用方仍只认这一个门面。
export { readLibraryVersion, readLibraryChangeSet, readLibraryStorageStats } from './snapshot-library-read.js'
export type { LibraryChangeSetInput, LibraryStorageStats } from './snapshot-library-read.js'
// #1935：两个回执写口搬到同目录的 snapshot-library-receipts.ts（本文件贴着 350 有效行上限）。
// 有界重试与「本机库落后」的约定住那个文件；调用方仍然只认这一个门面。
export { recordCommentReceipt, recordWriteReceipt } from './snapshot-library-receipts.js'
export type { CommentReceiptInput, CommentReceiptResult, WriteReceiptInput, WriteReceiptResult } from './snapshot-library-receipts.js'

/** 一批写多少张票；见文件头。 */
export const SNAPSHOT_WRITE_CHUNK = 200

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
 * 把一批列表读结果写进库。
 *
 * 缺省按 200 条分批（写回执等增量用）；传 atomic:true 时整批只开一个事务（刷新与首屏整轮写入用），
 * 进程在事务中间被杀则整批回滚，库里要么是上一轮完整数据、要么是这一轮完整数据（#1869 的 1869-02）。
 *
 * 版本门 stale 只重试一次：说明期间有别的写者提交了，重读版本再写通常就过；
 * 连续两次 stale 说明并发写太密，这一趟放弃，下一轮列表会再写。只读句柄直接停，
 * 不再徒劳重试：只读只有两种来路——网络盘上另一个进程拿着写权、或文件系统本身不可写，
 * 两种都不会因为本进程再试一次而变好。
 *
 * #1932 起本地磁盘上多了一句要处理的失败：legacy-writer（库里有未过期的旧租约）。
 * 它也不重试——租约要么过期自然恢复（下一次写会重新判），要么用户重启所有窗口。
 */
export async function recordIssueRows(input: RecordIssueRowsInput): Promise<RecordIssueRowsResult> {
  const writes: IssueWrite[] = issueWritesOf(input.rows || [], input.backend)
  if (!writes.length) return { ok: true, rows: 0, mergeVersion: null }
  const handle = await handleOf(input)
  if (!handle) return { ok: false, rows: 0, mergeVersion: null, reason: 'unavailable' }
  // 整批一个事务：读者在提交前只看得到旧库（WAL），进程被杀则整批回滚；stale 时整批重试一次。
  if (input.atomic === true) {
    let atomicResult = handle.ingest({ startMergeVersion: handle.getMergeVersion(), writes })
    if (!atomicResult.committed && atomicResult.reason === 'stale') {
      atomicResult = handle.ingest({ startMergeVersion: handle.getMergeVersion(), writes })
    }
    if (!atomicResult.committed) {
      return { ok: false, rows: 0, mergeVersion: null, reason: atomicResult.reason }
    }
    // 一整批行真的写进库了：本机库已经追上后端，落后的状态到此结束（#1935）。
    clearLibraryBehind(input)
    return { ok: true, rows: writes.length, mergeVersion: atomicResult.mergeVersion }
  }
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
  // 分批全部提交成功：与整批一个事务同一口径，清掉「本机库落后」。
  clearLibraryBehind(input)
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
 * 行组最老的那一次取数时刻。只读 `row` 这一组：增量索引比的是状态与更新时间，那两样都归行组管；
 * 把正文、评论、评审那些组的时刻算进来，一条很久没重取过的评论就能把起点拉到几千小时之前。
 * 没有行组记录的行（引用骨架）不在列表里，也不进索引，跳过即可。
 */
function oldestRowAtMsOf(projection: ListProjection): number {
  let oldest = 0
  for (const item of projection.issues) {
    const group = item.groups.row
    if (!group || !(group.lastQueriedMs > 0)) continue
    if (oldest === 0 || group.lastQueriedMs < oldest) oldest = group.lastQueriedMs
  }
  return oldest || projection.generatedAtMs
}

export interface RecordIssueRowsInput extends SnapshotLibraryKey {
  rows: Issue[]
  /**
   * true = 整批只开一个事务（刷新/首屏整轮写入用）；缺省按 200 条分批（写回执等增量用）。
   * 为什么要有这个开关：整轮刷新被杀时，库里要么是上一轮完整数据、要么是这一轮完整数据；
   * 分批评只能保证「每一批原子」，保证不了整轮原子。见 #1869 的 1869-02。
   */
  atomic?: boolean
}

export interface RecordIssueRowsResult {
  ok: boolean
  /** 这一趟真正提交进库的票数（分批失败时是失败前已提交的数量）。 */
  rows: number
  /** 最后一批提交后的合并版本；没写成功时是 null。 */
  mergeVersion: number | null
  /**
   * 没写成功时的简短原因（readonly / unavailable / legacy-writer / 具体异常一句）。
   * legacy-writer（#1932）= 本地库里还有未过期的旧租约；刷新流程把它当已知降级处理，
   * 界面照常显示这一轮的新数据，只是这一趟不落库。
   */
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
  /**
   * 行组**最老**的那一次取数时刻（毫秒）。给「从库里的数据立扫描起点」用，界面不用它。
   *
   * 为什么不能拿 lastKnownAtMs 顶替：那是所有票、所有字段组里最新的那一个。库里的行并不齐——
   * 列表有单页上限，详情与写回执又只更新一张，老票的时刻停在很久以前。拿最新的那一刻当
   * 「整份数据是什么时候的」，等于替所有旧行宣称「它们在那一刻也是新的」：起点之后的窗口
   * 从此接不住那些行更早发生的改动，属于静默漏报（正是 kernel/index-window-rules.ts 要防的那一类）。
   * 取最小值才是真话：每一行都至少是那一刻取到的。
   */
  oldestRowAtMs: number
  /** 回放的行数，便于日志与门禁断言。 */
  rows: number
  /**
   * 面板六个数字 + 完整度（#1887）。库里的行与边算出来的一次查询结果，和这一份回放同一时刻。
   * null = 这一趟读不到（库坏、查询失败）；调用方按「不知道」处理，不补 0。
   */
  counts: SnapshotCounts | null
  /**
   * 这一趟库投影花了多少毫秒（从 readList 进到出）。日志里的投影时长取它，不拿整趟回包的耗时冒充：
   * 序列化与组装装饰各占一块，混在一起就分不清「库慢」还是「回包大」。
   */
  projectionMs: number
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

/**
 * 库这一趟开得出来吗：只回答「句柄能不能拿到」，不读数据、不改任何状态。
 *
 * 为什么单开一口：首屏没有回放时，「库空」与「库坏了/打不开」给出的界面动作完全不同（前者等一次
 * 取数就好，后者本机数据被清过、要重新取一遍），而两者都回不出数据。只靠回放为 null 分不开，
 * 所以让门面自己回答一次；老门禁的假库没有这一口时由调用方按「开得出来」处理。
 */
export async function readSnapshotLibraryHealth(input: SnapshotLibraryKey): Promise<'open' | 'unavailable'> {
  const handle = await handleOf(input)
  return handle ? 'open' : 'unavailable'
}

/**
 * 「本机库落后」读口（#1935）：写回执最终失败后置位，任何一次写进库的成功会清掉它。
 *
 * 为什么门面要转一手而不是让调用方直接 import 状态模块：首屏与诊断只认这一个库门面，
 * 状态模块是它的实现细节；门禁要替换库门面时也只需要换这一个口。
 */
export function readLibraryBehind(input: SnapshotLibraryKey): LibraryBehindState {
  return readLibraryBehindState(input)
}

export type { LibraryBehindState }

/**
 * 库这一刻的六个数字 + 完整度（#1887）。库开不出来或读失败回 null —— 调用方按「不知道」处理。
 *
 * 与 readSnapshotReplay 里的 counts 是同一个查询：回放那条路把它随快照一起交回去，
 * 在线重建那条路在把这一趟取回的行写进库之后再单读一次（写之前读到的会是上一轮的数字）。
 */
export async function readSnapshotCounts(input: SnapshotLibraryKey): Promise<SnapshotCounts | null> {
  const handle = await handleOf(input)
  if (!handle) return null
  try {
    return handle.readCounts()
  } catch (e) {
    return null
  }
}

/** 库为空（或者开不出来）回 null；有行就回放成与在线组装同形的快照主体。 */
export async function readSnapshotReplay(input: SnapshotReplayInput): Promise<SnapshotReplay | null> {
  const handle = await handleOf(input)
  if (!handle) return null
  let projection: ListProjection
  const projectionStartedAt = Date.now()
  try {
    projection = handle.readList({ state: 'all' })
  } catch (e) {
    return null
  }
  const projectionMs = Date.now() - projectionStartedAt
  if (!projection || !projection.issues.length) return null
  const snapshot = snapshotOfProjection(input.repo, projection)
  // #1887：六个数字与回放同一时刻算出，随回包一起交给界面；读不出来就不挂 counts（不知道，不补 0）。
  let counts: SnapshotCounts | null = null
  try { counts = handle.readCounts() } catch (e) { counts = null }
  if (counts) snapshot.deck = { counts }
  return {
    snapshot: snapshot,
    mergeVersion: projection.mergeVersion,
    lastKnownAtMs: lastKnownAtMsOf(projection),
    oldestRowAtMs: oldestRowAtMsOf(projection),
    rows: projection.issues.length,
    projectionMs: projectionMs,
    counts: counts,
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
  // 详情也是「这一张票当前的真状态」：写成功说明库是通的，落后状态该清掉（#1935）。
  clearLibraryBehind(input)
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

/** 按容器读的输入：库身份三格 + 容器身份两段（工作单元是本地 Markdown 的同号容器区分键）。 */
export interface ReadContainerProjectionInput extends SnapshotLibraryKey {
  key: string
  effortId?: string
}

/**
 * 按容器读一次（#1923）：容器行 + 子票 + 层级 + 统计。
 *
 * 库开不出来 / 读失败回 null（调用方按「库坏」处理）；库开了但没有这张容器的行时回
 * { container: null }——两者是两件事，前者不知道库里的情况，后者是本机数据里确实还没有它。
 * 层级与统计的换算只在 containerProjectionOf 一处（normalizeMapTickets），不在这里另算一遍。
 */
export async function readContainerProjection(input: ReadContainerProjectionInput): Promise<any | null> {
  const handle = await handleOf(input)
  if (!handle) return null
  let projection: ContainerProjection
  try {
    projection = handle.readContainerProjection({
      key: String(input.key || ''),
      effortId: input.effortId === undefined || input.effortId === null ? '' : String(input.effortId),
    })
  } catch (e) {
    return null
  }
  if (!projection) return null
  const shaped = containerProjectionOf(projection)
  if (!shaped) return { mergeVersion: projection.mergeVersion, container: null, tickets: [], stats: null }
  return {
    mergeVersion: projection.mergeVersion,
    container: shaped.container,
    tickets: shaped.tickets,
    stats: shaped.stats,
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
