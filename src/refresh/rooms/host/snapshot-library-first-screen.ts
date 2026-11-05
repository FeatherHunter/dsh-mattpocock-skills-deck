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
import type { SnapshotDiagnostic } from '../../../workspace-snapshot/contract/types.js'

/** 库门面里这一层真正用到的两件：读回放、按批写行。 */
export interface FirstScreenLibrary {
  readSnapshotReplay(input: {
    workspaceRoot: string
    backend: string
    repoIdentity: string
    repo: RepositoryRef
  }): Promise<{ snapshot: any; lastKnownAtMs: number } | null>
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
  replay: { snapshot: any; lastKnownAtMs: number } | null
  /** 这一趟要去后端取时，把取回的行先收在内存里；库不可用时是 undefined。 */
  writeRows: ((rows: unknown[]) => void) | undefined
  /** 组装结束后整批一个事务写库；没有收到行时回 null。 */
  commitRows: () => Promise<unknown>
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
  let replay: { snapshot: any; lastKnownAtMs: number } | null = null
  if (options.force !== true) {
    try {
      replay = await lib.readSnapshotReplay(Object.assign({ repo: options.repo }, key))
    } catch (e) {
      replay = null
    }
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
  return {
    replay: replay,
    writeRows: writeRows,
    commitRows: commitRows,
    diagnostics: diagnostics,
    decorate: function (snap: any): void {
      if (diagnostics.length) snap.snapshotDiagnostics = diagnostics
      if (!replay) return
      snap.fromCache = true
      snap.diskReplay = { schema: 'snapshot-sqlite-v1', source: 'sqlite', lastKnownAtMs: replay.lastKnownAtMs }
    },
  }
}
