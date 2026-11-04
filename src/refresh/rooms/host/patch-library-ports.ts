// src/refresh/rooms/host/patch-library-ports.ts —— 行级增量与快照库之间的那一道口（#1888）
//
// 为什么单列：row-patch.ts 是宿主侧的跑腿件，它不认识「库门面长什么样」，也不该认识 ——
// 依赖方向是 refresh 房间 → 快照契约，门面实现由宿主装配时注入。这一层把三件事拼起来：
//   ① 从宿主注入的 getSnapshotLibrary 里拿到库门面；
//   ② 用「工作区目录 + 当前后端 + owner/name」组成库身份（与首屏读库、索引起点那条路同一份身份）；
//   ③ 把门面的四个口转成 row-patch 认的四格：读簿记、写簿记、读差分基线、提交变化行。
//
// 三条不能改的约定：
//   1. 身份解析不出来（没有工作区根、当前后端还没读过、owner/name 拿不到）回 null：这不是「库坏了」，
//      而是这一趟没法按库走，调用方据此决定是回失败还是走改造前的老路。
//   2. 库门面没注入时整条口是 null（老调用方与旧门禁的假世界照旧只写内存）。
//   3. 这一层不判断版本、不做重试、不看结果内容：版本门与「要不要丢」在库与 row-patch 两侧，
//      这里只搬运。
import type { SyncBookkeeping, SyncBookkeepingWrite } from '../../../workspace-snapshot/contract/types.js'

/** 差分基线：票号 → '状态|更新时间'（与 kernel/index-window-rules 的索引同一口径）。 */
export type PatchBaselineIndex = Record<string, string>

/** 读簿记的回包；mergeVersion 是这一趟发起时要交给版本门的起读版本。 */
export interface PatchLibraryState {
  state: SyncBookkeeping
  mergeVersion: number
}

/** 写簿记的回包；committed 为假表示被世代门挡下或写失败。 */
export interface PatchLibraryWriteResult {
  committed: boolean
  state?: SyncBookkeeping
  reason?: string
}

/** 提交变化行的回包；ok 为真才该更新界面。 */
export interface PatchLibraryCommitResult {
  ok: boolean
  rows?: number
  mergeVersion?: number | null
  sync?: SyncBookkeeping | null
  reason?: string
}

/**
 * row-patch 认的四格。方法回 null 一律表示「这一趟按不了库」；
 * 回对象但 ok/committed 为假表示「库在、这一笔没写进去」（调用方按失败处理）。
 */
export interface PatchLibraryPorts {
  /**
   * 这一趟能不能按库走：门面在、四个新口齐、库身份解析得出来。
   * 回 false 时 row-patch 照旧只写宿主内存副本 —— 老装配（假门面、别的宿主版本）不该因为
   * 缺一个新口就整条增量路停摆；门面齐但读写失败才按「库写入失败」处理。
   */
  ready(cwd: string): Promise<boolean>
  readState(cwd: string): Promise<PatchLibraryState | null>
  writeState(cwd: string, write: SyncBookkeepingWrite): Promise<PatchLibraryWriteResult | null>
  readBaseline(cwd: string): Promise<PatchBaselineIndex | null>
  commitRows(
    cwd: string,
    rows: readonly unknown[],
    sync: SyncBookkeepingWrite | undefined,
    startMergeVersion: number,
  ): Promise<PatchLibraryCommitResult | null>
}

/** 装配这一道口要的三样：库门面、仓库键、当前后端编号。全部由宿主接线时注入。 */
export interface PatchLibraryPortsDeps {
  getSnapshotLibrary?: (() => Promise<any> | any) | null
  getRepoKey?: ((cwd: string) => Promise<any> | any) | null
  backendIdOf?: (() => string) | null
}

/** 库身份三格；与门面里 SnapshotLibraryKey 同形。 */
interface LibraryKey {
  workspaceRoot: string
  backend: string
  repoIdentity: string
}

/** 造那一道口。库门面或仓库键没接时，四个方法全部回 null（row-patch 走改造前的老路）。 */
export function createPatchLibraryPorts(deps: PatchLibraryPortsDeps | null | undefined): PatchLibraryPorts {
  const d = deps || {}
  const getSnapshotLibrary = d.getSnapshotLibrary
  const getRepoKey = d.getRepoKey
  const backendIdOf = d.backendIdOf
  // 同一趟里四个口都要身份：按目录记住解析成功的那一份，别把 getRepoKey 问四遍。
  const keyByCwd = new Map<string, LibraryKey>()

  async function libraryOf(): Promise<any | null> {
    if (typeof getSnapshotLibrary !== 'function') return null
    try {
      const lib = await Promise.resolve(getSnapshotLibrary())
      return (lib && typeof lib === 'object') ? lib : null
    } catch (e) {
      return null
    }
  }

  async function keyOf(cwd: string): Promise<LibraryKey | null> {
    const cacheKey = String(cwd || '')
    const hit = keyByCwd.get(cacheKey)
    if (hit) return hit
    const workspaceRoot = cacheKey
    if (!workspaceRoot) return null
    const backend = (typeof backendIdOf === 'function') ? String(backendIdOf() || '') : ''
    if (!backend) return null
    if (typeof getRepoKey !== 'function') return null
    let repo: any = null
    try { repo = await Promise.resolve(getRepoKey(workspaceRoot)) } catch (e) { repo = null }
    const owner = repo && String(repo.owner || '')
    const name = repo && String(repo.name || '')
    if (!owner || !name) return null
    const key: LibraryKey = { workspaceRoot: workspaceRoot, backend: backend, repoIdentity: owner + '/' + name }
    keyByCwd.set(cacheKey, key)
    return key
  }

  const REQUIRED_METHODS = ['readSyncState', 'writeSyncState', 'readIssueIndex', 'commitChangeRows']

  return {
    async ready(cwd: string): Promise<boolean> {
      const lib = await libraryOf()
      const key = await keyOf(cwd)
      if (!lib || !key) return false
      for (const name of REQUIRED_METHODS) {
        if (typeof lib[name] !== 'function') return false
      }
      return true
    },
    async readState(cwd: string): Promise<PatchLibraryState | null> {
      const lib = await libraryOf()
      const key = await keyOf(cwd)
      if (!lib || !key || typeof lib.readSyncState !== 'function') return null
      let got: any = null
      try { got = await Promise.resolve(lib.readSyncState(key)) } catch (e) { got = null }
      if (!got || !got.state) return null
      return { state: got.state, mergeVersion: Number(got.mergeVersion) || 0 }
    },
    async writeState(cwd: string, write: SyncBookkeepingWrite): Promise<PatchLibraryWriteResult | null> {
      const lib = await libraryOf()
      const key = await keyOf(cwd)
      if (!lib || !key || typeof lib.writeSyncState !== 'function') return null
      let got: any = null
      try { got = await Promise.resolve(lib.writeSyncState(key, write)) } catch (e) { got = null }
      if (!got) return null
      return { committed: got.committed === true, state: got.state, reason: got.reason }
    },
    async readBaseline(cwd: string): Promise<PatchBaselineIndex | null> {
      const lib = await libraryOf()
      const key = await keyOf(cwd)
      if (!lib || !key || typeof lib.readIssueIndex !== 'function') return null
      try {
        const index = await Promise.resolve(lib.readIssueIndex(key))
        return (index && typeof index === 'object') ? index as PatchBaselineIndex : null
      } catch (e) {
        return null
      }
    },
    async commitRows(
      cwd: string,
      rows: readonly unknown[],
      sync: SyncBookkeepingWrite | undefined,
      startMergeVersion: number,
    ): Promise<PatchLibraryCommitResult | null> {
      const lib = await libraryOf()
      const key = await keyOf(cwd)
      if (!lib || !key || typeof lib.commitChangeRows !== 'function') return null
      let got: any = null
      try {
        got = await Promise.resolve(lib.commitChangeRows(Object.assign({}, key, {
          rows: Array.isArray(rows) ? rows : [],
          startMergeVersion: Number(startMergeVersion) || 0,
          ...(sync ? { sync } : null),
          operation: 'probe',
        })))
      } catch (e) {
        got = null
      }
      if (!got) return null
      return {
        ok: got.ok === true,
        rows: Number(got.rows) || 0,
        mergeVersion: got.mergeVersion === undefined ? null : got.mergeVersion,
        sync: got.sync || null,
        reason: got.reason,
      }
    },
  }
}
