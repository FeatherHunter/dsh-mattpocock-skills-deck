/**
 * src/refresh/rooms/host/snapshot-library-first-screen.ts —— 首屏先读本地快照库（#1863 立起，#1867 给 GitLab 复用）
 *
 * 为什么单开一份：快照电话里有两条组装支路（GitHub 的统一支路与 GitLab / Markdown 的 composer 支路），
 * 两边要做的是同一件事——凡是库里已经有数据，就先从库铺首屏；没有才去后端取，取回来按批写库，
 * 回包上带「来自库」的注记。这件事写在这一层，两支路只差一行调用，不会各写一套、各错一种。
 * 本文件不碰数据库、不发请求：库句面由调用方注入，读写都经过它。
 *
 * #1893：库为空时用宿主工作副本兜底的那一段（#1870 的 createWorkingCopyFallback）已随工作副本一起删除。
 * 库里有数据就回放；库空就如实回 null，调用方去在线重建并把取回的行写库——这里不再有第二条交付来源。
 *
 * 三条不能改的约定：
 *  1. 库拿不到、打不开、读失败，一律当「这一趟没有回放」：首屏不许因为库不可用而空白，调用方照旧在线取数。
 *  2. `force` 为真时跳过回放（强制重建），但仍然把这一趟取回来的行写库：强制重建是新数据覆盖旧数据的正常时机。
 *  3. 取回来的行先收在内存里，等组装结束后由 commitRows 整批一个事务写库（#1869 的 1869-02）：
 *     不能边取边按页提交——进程在页与页之间被杀，库里就会半新半旧。
 */
import type { RepositoryRef } from '../../../tracker/contract/entities.js'
import type { SnapshotCounts, SnapshotDiagnostic } from '../../../workspace-snapshot/contract/types.js'
import { hasRebuildDiagnostic, SNAPSHOT_DEGRADE } from './snapshot-degradation.js'
import { readLibraryBehind } from './snapshot-library-behind.js'

/** 库门面里这一层真正用到的两件：读回放、按批写行。 */
export interface FirstScreenLibrary {
  readSnapshotReplay(input: {
    workspaceRoot: string
    backend: string
    repoIdentity: string
    repo: RepositoryRef
  }): Promise<{
    snapshot: any
    lastKnownAtMs: number
    /** 回放的库版本与行数；老假库可能不带，缺一个都当「不知道」而不是 0。 */
    mergeVersion?: number
    rows?: number
    /** 回放同一时刻的六个数字 + 完整度（#1887）；老假库可能不带。 */
    counts?: SnapshotCounts | null
    /** 这一趟库投影花了多少毫秒（#1899 日志的投影时长读数）。 */
    projectionMs?: number
  } | null>
  recordIssueRows(input: {
    workspaceRoot: string
    backend: string
    repoIdentity: string
    rows: unknown[]
    atomic?: boolean
  }): Promise<unknown>
  /** 开库诊断（损坏重建、只读等）；老门禁的假库没有这个口，缺席时当空数组。 */
  readSnapshotDiagnostics?(input: {
    workspaceRoot: string
    backend: string
    repoIdentity: string
  }): Promise<SnapshotDiagnostic[]> | SnapshotDiagnostic[]
  /**
   * 库这一趟开不开得出来（#1899）。没有回放时用它区分「库空」与「库坏了/打不开」：
   * 老门禁的假库没有这个口，缺席时按「开得出来」处理（空库那一档）。
   */
  readSnapshotLibraryHealth?(input: {
    workspaceRoot: string
    backend: string
    repoIdentity: string
  }): Promise<'open' | 'unavailable'> | 'open' | 'unavailable'
  /**
   * 库这一刻的六个数字 + 完整度（#1887）。在线重建写完库之后单读一次；
   * 老假库没有这一口时调用方按「读不到」处理。返回 null = 读不到。
   */
  readSnapshotCounts?(input: {
    workspaceRoot: string
    backend: string
    repoIdentity: string
  }): Promise<SnapshotCounts | null> | SnapshotCounts | null
  /**
   * #1885 评审修复：库当前版本。读回包（wf.snapshot / wf.refresh）的 304 判据与version 字段都靠它；
   * 老假库没有这一口时按「不知道」处理（不拿 0 冒充）。
   */
  readLibraryVersion?(input: {
    workspaceRoot: string
    backend: string
    repoIdentity: string
  }): Promise<number | null> | number | null
}

/** 造首屏要的输入：库门面（可能是异步取到的）、库身份三格、仓库引用、这一趟是不是强制重建。 */
export interface FirstScreenOptions {
  getSnapshotLibrary?: (() => Promise<FirstScreenLibrary | null> | FirstScreenLibrary | null) | null
  workspaceRoot: string
  backend: string
  repoIdentity: string
  /**
   * 仓库引用。这里按 any 收：调用方手里那份身份是本地收窄形状（backend 等字段可缺），
   * 快照库门面按 RepositoryRef 收；这一层只把它原样转手，不读它的字段。
   */
  repo: any
  force?: boolean
}

/** 首屏回放的结果：从库来的那份（或 null）、去后端取时用的写库回调、回包注记。 */
export interface FirstScreen {
  /** 库里已有数据时的回放主体（与在线组装同形）；null = 库里还没数据，得去后端取。 */
  replay: { snapshot: any; lastKnownAtMs: number; mergeVersion?: number; rows?: number; projectionMs?: number } | null
  /**
   * 这一趟没有回放时是哪种退化（#1899）：库里没有行 library-empty、库被重建/打不开 library-corrupt。
   * 有回放时是空串。库门面根本没接上时这一层回 null，由调用方记 library-not-wired。
   */
  degradeReason: string
  /** 这一趟要去后端取时，把取回的行先收在内存里；库不可用时是 undefined。 */
  writeRows: ((rows: unknown[]) => void) | undefined
  /** 组装结束后整批一个事务写库；没有收到行时回 null。 */
  commitRows: () => Promise<unknown>
  /**
   * 读一次库这一刻的六个数字 + 完整度（#1887）。在线重建的路在把这一趟取回的行写进库之后调它；
   * 库门面没接或读失败时回 null（界面按「不知道」处理，不补 0）。
   */
  readCounts: () => Promise<SnapshotCounts | null>
  /**
   * 库这一刻的版本（#1885 评审修复）。有回放时先用手上这份回放带的 mergeVersion（同一次取数的版本），
   * 没有回放或刚写完在线重建的行时读库；读不到回 null（不知道版本，不拿 0 冒充）。
   */
  readVersion: () => Promise<number | null>
  /** 开库诊断：损坏重建、退回只读等；不论有没有回放都要随回包交给界面。 */
  diagnostics: SnapshotDiagnostic[]
  /** 给回包盖上「来自库」的注记：fromCache 与 diskReplay（与在线重建区分开），并带上开库诊断。 */
  decorate(snap: any): void
}

/**
 * 取一次首屏的库门面与回放。回 null = 库门面没接或拿不到，调用方照旧走在线组装。
 *
 * 返回对象里 `replay` 与 `writeRows` 是两件事：有回放时不会用到写库；没回放时才把写库回调交给组装层。
 * `decorate` 只在真的有回放时改回包，避免把在线组装的数据也标成「来自库」。
 */
export async function firstScreenFromLibrary(options: FirstScreenOptions): Promise<FirstScreen | null> {
  const get = options && options.getSnapshotLibrary
  if (typeof get !== 'function') return null
  let lib: FirstScreenLibrary | null = null
  try {
    lib = await Promise.resolve(get())
  } catch (e) {
    lib = null
  }
  if (!lib || typeof lib.readSnapshotReplay !== 'function' || typeof lib.recordIssueRows !== 'function') return null
  const key = {
    workspaceRoot: String(options.workspaceRoot || ''),
    backend: String(options.backend || ''),
    repoIdentity: String(options.repoIdentity || ''),
  }
  let replay: {
    snapshot: any
    lastKnownAtMs: number
    mergeVersion?: number
    rows?: number
    projectionMs?: number
    counts?: SnapshotCounts | null
  } | null = null
  if (options.force !== true) {
    try {
      replay = await lib.readSnapshotReplay(Object.assign({ repo: options.repo }, key))
    } catch (e) {
      replay = null
    }
  }
  // #1887：回放里若另带了 counts（新门面会带），把它挂到 deck 上；老假库的 snapshot 里可能已经有，
  // 也可能两个都没有 —— 两个都没有就不挂，由在线重建那条路补。
  if (replay && replay.counts && replay.snapshot && typeof replay.snapshot === 'object') {
    const deck = (replay.snapshot.deck && typeof replay.snapshot.deck === 'object') ? replay.snapshot.deck : {}
    deck.counts = replay.counts
    replay.snapshot.deck = deck
  }
  // 诊断要在回放读之前或之后拿：handleOf 会把句柄缓存住，先读回放再读诊断也不会重复开库；
  // 但库为空、刚重建时回放是 null，诊断仍要拿到，所以这里不能绑在 replay 上。
  let diagnostics: SnapshotDiagnostic[] = []
  if (typeof lib.readSnapshotDiagnostics === 'function') {
    try {
      diagnostics = (await Promise.resolve(lib.readSnapshotDiagnostics(key))) || []
    } catch (e) {
      diagnostics = []
    }
  }
  // 没有回放时把「为什么没有」说清（#1899）：有重建诊断 = 库坏；门面说开不出来 = 库坏；
  // 其余 = 库空。三者都回不出数据，但该修的地方完全不同，日志按这三个值分辨。
  const degradeReason = replay ? '' : await degradeReasonOf(lib, key, diagnostics)
  const pendingRows: unknown[] = []
  const writeRows = function (rows: unknown[]): void {
    if (!Array.isArray(rows) || !rows.length) return
    for (let i = 0; i < rows.length; i += 1) pendingRows.push(rows[i])
  }
  const commitRows = async function (): Promise<unknown> {
    if (!pendingRows.length) return null
    const rows = pendingRows.splice(0, pendingRows.length)
    try {
      return await Promise.resolve(lib!.recordIssueRows(Object.assign({ rows: rows, atomic: true }, key)))
    } catch (e) {
      return null
    }
  }
  // #1885 评审修复：库版本。回放里带着读出那一刻的版本，先用它；没有回放（库空 / 刚重建）
  // 或调用方要求最新版本时读库。只认非负整数，别的形状都按「不知道」。
  const readVersion = async function (): Promise<number | null> {
    if (typeof lib!.readLibraryVersion !== 'function') return null
    try {
      const version = await Promise.resolve(lib!.readLibraryVersion(key))
      return (typeof version === 'number' && Number.isInteger(version) && version >= 0) ? version : null
    } catch (e) {
      return null
    }
  }
  // #1887：库这一侧单读一次六个数字；门面没接这一口就回 null（老假库与不接库的世界）。
  const readCounts = async function (): Promise<SnapshotCounts | null> {
    if (typeof lib!.readSnapshotCounts !== 'function') return null
    try {
      return await Promise.resolve(lib!.readSnapshotCounts(key))
    } catch (e) {
      return null
    }
  }
  return {
    replay: replay,
    degradeReason: degradeReason,
    writeRows: writeRows,
    commitRows: commitRows,
    readCounts: readCounts,
    readVersion: readVersion,
    diagnostics: diagnostics,
    decorate: function (snap: any): void {
      if (diagnostics.length) snap.snapshotDiagnostics = diagnostics
      // #1935：本机库落后时把标记挂到回包上。两种后端走的都是这一个 decorate，不再另开第二处；
      // 只在真落后时挂 true —— 缺省即「没落后」，界面按真假判断，不需要一个 false 字段撑形状。
      // reason 只给诊断与日志，界面那条用户级提示不读它（内部失败词不上界面）。
      const behind = readLibraryBehind(key)
      if (behind.behind) {
        snap.libraryBehind = true
        snap.libraryBehindReason = behind.reason
      }
      if (!replay) return
      snap.fromCache = true
      snap.diskReplay = { schema: 'snapshot-sqlite-v1', source: 'sqlite', lastKnownAtMs: replay.lastKnownAtMs }
    },
  }
}

/**
 * #1887：把库这一趟的六个数字挂到快照的 deck 上（读不到就原样返回）。
 *
 * 为什么放在这里：首屏、刷新、回退三条路用的是同一个库门面与同一种读取；每个电话各写一遍
 * 「有没有这一口 / 读失败怎么办 / 怎么挂 deck」迟早会漂。调用方只管在「这一趟的行写进库之后」调它。
 */
export async function withLibraryCounts(snap: any, screen: any): Promise<any> {
  if (!snap || typeof snap !== 'object' || !screen || typeof screen.readCounts !== 'function') return snap
  let counts: SnapshotCounts | null = null
  try { counts = await screen.readCounts() } catch (e) { counts = null }
  if (!counts) return snap
  const deck: any = (snap.deck && typeof snap.deck === 'object') ? snap.deck : {}
  deck.counts = counts
  snap.deck = deck
  return snap
}

/**
 * 没有回放时这一趟算哪种退化：重建诊断 → 库坏；门面回答开不出来 → 库坏；否则 → 库空。
 *
 * 为什么顺序不能反：刚被重建过的库也是空的，先判「有没有行」会把库坏报成库空，
 * 查的人就会去怀疑「是不是第一次用」，而不是去查那个把库写坏的文件。
 */
async function degradeReasonOf(lib: FirstScreenLibrary, key: {
  workspaceRoot: string
  backend: string
  repoIdentity: string
}, diagnostics: SnapshotDiagnostic[]): Promise<string> {
  if (hasRebuildDiagnostic(diagnostics)) return SNAPSHOT_DEGRADE.libraryCorrupt
  if (typeof lib.readSnapshotLibraryHealth === 'function') {
    try {
      const health = await Promise.resolve(lib.readSnapshotLibraryHealth(key))
      if (health === 'unavailable') return SNAPSHOT_DEGRADE.libraryCorrupt
    } catch (e) {
      // 健康检查自己出错不改变结论：库这一侧拿不到话，就按空库处理，日志里另有读失败的原因。
    }
  }
  return SNAPSHOT_DEGRADE.libraryEmpty
}
