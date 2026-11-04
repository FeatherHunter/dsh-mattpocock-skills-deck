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
import type { Issue, RepositoryRef } from '../../../tracker/contract/entities.js'
import type {
  IssueDetailProjection,
  IssueWrite,
  ListProjection,
  OpenWorkspaceSnapshotOptions,
  SnapshotBackend,
  WorkspaceSnapshotHandle,
} from '../../../workspace-snapshot/contract/types.js'
import { commentPageWriteOf, detailIssueWriteOf, issueWritesOf } from './snapshot-library-adapter.js'
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
  const writes: IssueWrite[] = issueWritesOf(input.rows || [])
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
  const writes: IssueWrite[] = [detailIssueWriteOf(input.issue)]
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

/** 测试与进程收尾用：关掉所有缓存句柄；之后再用会重新开库。 */
export function closeSnapshotLibraries(): void {
  for (const entry of handles.values()) {
    try { entry.handle.close() } catch (e) { /* 幂等关闭 */ }
  }
  handles.clear()
}

/** 当前缓存的句柄数（测试断言句柄上限用）。 */
export function snapshotLibraryHandleCount(): number {
  return handles.size
}
