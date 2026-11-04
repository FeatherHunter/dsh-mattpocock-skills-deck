// snapshot-read-channels.ts —— 宿主的版本查询与变化集两条读口（#1890，规格 #1885 S4）
//
// 为什么要有这两条：变化信号今天用五秒轮询版本实现，客户端只该拿一个几十字节的信号；
// 版本变了才取变化集，只重画变动的那几行。这两条读口都不产生变化（产生变化的唯一入口仍是
// wf.probe 与后台补行），也不改任何库内容。
//
// 三条不能改的约定：
//   1. 版本查询回包只有版本、工作区键、后端三格（规格 I4「信号不带真相」）：键集由门禁断言，
//      以后要加东西先想清楚它是不是真相；真相走 wf.snapshot / wf.snapshotChanges。
//   2. 变化集超过行数或时间上限、客户端版本比库里大、或没有基线时回「整份」（full 为真，
//      不带截断的变化行）；调用方必须整份重取，不能把 full 当成「没有变化」。
//   3. 库开不出来时如实回失败，不编一个版本号：0 是一个合法版本，冒充 0 会让客户端做错整份判断。
//
// 两条电话的库身份解析与 wf.snapshot 同一口径：canonicalKey 归一到工作区根，
// selectEarly 选后端，describe / 会话 / 宿主本地远程依次补齐 refId；没有身份就不猜。
// 回包里的工作区键是归一到工作区根之后的路径（客户端按 wsKeyOf 分桶的那把钥匙），不是短散列：
// 散列在客户端算不出同一份（客户端手里是所选目录，宿主这边锚过根），换后端或换子目录时会认错桶。
import type { RepositoryRef } from '../../../tracker/contract/entities.js'
import { resolveRepoRefForCwd } from '../../../tracker/session/repo-ref.js'
import {
  SNAPSHOT_CHANGES_MAX_AGE_MS,
  SNAPSHOT_CHANGES_MAX_ROWS,
} from '../../../shared/time-config/src/values.js'

/** 这一层真正用到的库门面形状；调用方注入的实现可以更宽。 */
interface SnapshotReadLibrary {
  readLibraryVersion(input: SnapshotLibraryKeyLike): Promise<number | null> | number | null
  readLibraryChangeSet(input: SnapshotLibraryKeyLike & {
    sinceVersion: number
    sinceMs?: number
    maxRows: number
    maxAgeMs: number
  }): Promise<any> | any
}

interface SnapshotLibraryKeyLike {
  workspaceRoot: string
  backend: string
  repoIdentity: string
}

/** 宿主接线处注入的依赖：解析身份要用的几口，以及快照库门面。 */
export interface SnapshotReadChannelsDeps {
  canonicalKey(cwd: unknown): Promise<string> | string
  selectEarly(input: { cwd: string, backendId?: unknown }): Promise<any> | any
  getTrackerRegistry(): Promise<any> | any
  getSnapshotLibrary?: (() => Promise<SnapshotReadLibrary | null> | SnapshotReadLibrary | null) | null
  getRepoKey?: ((cwd: string) => Promise<{ owner?: unknown, name?: unknown } | null> | { owner?: unknown, name?: unknown } | null) | null
  openSession?: ((cwd: string, options?: { write?: boolean }) => Promise<any>) | null
}

interface ResolvedContext {
  cwd: string
  backend: string
  repoIdentity: string
  workspaceKey: string
  lib: SnapshotReadLibrary
}

/** 两条电话共用的失败回包：ok:false 只在出错时出现，成功回包不带它。 */
type ReadFailure = { ok: false, error: string, errorKind: 'env' | 'library' }

function failureOf(error: string, errorKind: 'env' | 'library'): ReadFailure {
  return { ok: false, error, errorKind }
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 从描述符里取非空 refId；空串、只带显示名的壳都算「没答上来」。 */
function refOf(value: unknown): RepositoryRef | null {
  try {
    const ref = value as { refId?: unknown } | null | undefined
    return ref && typeof ref.refId === 'string' && ref.refId ? (ref as RepositoryRef) : null
  } catch (e) {
    return null
  }
}

/**
 * 造出两条读口的处理体。两条共用同一套身份解析：同一份工作区在同一个后端上必须指向同一个库文件，
 * 少一格或换一种兜底就会读成另一个库（版本看起来对不上，变化集永远是整份）。
 */
export function createSnapshotReadChannels(deps: SnapshotReadChannelsDeps): {
  handleSnapshotVersion: (args: any) => Promise<any>
  handleSnapshotChanges: (args: any) => Promise<any>
} {
  const canonicalKey = deps.canonicalKey
  const selectEarly = deps.selectEarly
  const getTrackerRegistry = deps.getTrackerRegistry
  const getSnapshotLibrary = deps.getSnapshotLibrary || null
  const getRepoKey = deps.getRepoKey || null
  const openSession = deps.openSession || null

  async function resolveContext(args: any): Promise<ResolvedContext | ReadFailure> {
    const raw = (args && typeof args.cwd === 'string') ? args.cwd : ''
    if (!raw.trim()) return failureOf('这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。', 'env')
    let cwd = ''
    try {
      cwd = String(await canonicalKey(raw))
    } catch (e) {
      return failureOf('这个工作区还没就绪（目录归一失败），等面板认出工作区后再试。', 'env')
    }
    let selection: any = null
    try {
      selection = await selectEarly({ cwd, backendId: (args && args.backendId) || undefined })
    } catch (e) {
      selection = null
    }
    const backend = textOf(selection && selection.backendId)
    if (!backend) return failureOf('这个工作区还没选后端，读不到本地快照库的版本。', 'env')
    let reg: any = null
    try {
      reg = await getTrackerRegistry()
    } catch (e) {
      reg = null
    }
    if (!reg || typeof reg.describe !== 'function') return failureOf('认不出这个工作区的仓库身份，读不到本地快照库。', 'env')
    let repoRef: RepositoryRef | null = null
    try { repoRef = refOf(reg.describe({ cwd }, backend)) } catch (e) { repoRef = null }
    // 先走本地证据：版本查询是五秒一拍的轮询，不能每拍都去开会话问身份。
    // 宿主本地 git 远程只读本地，不联网（与 wf.snapshot 的 GitHub 支路同一口径）。
    if (!repoRef && typeof getRepoKey === 'function') {
      try {
        const rk: any = await getRepoKey(cwd)
        if (rk && typeof rk.owner === 'string' && rk.owner && typeof rk.name === 'string' && rk.name) {
          repoRef = { backend, refId: rk.owner + '/' + rk.name, name: rk.owner + '/' + rk.name, url: '' } as RepositoryRef
        }
      } catch (e) {
        repoRef = null
      }
    }
    // 本地 Markdown 的仓库身份就是工作区目录本身（与 #1868 的判定同一口径）：只有它允许拿 cwd 当 refId。
    if (!repoRef && backend === 'markdown') {
      repoRef = { backend, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || backend, url: '' } as RepositoryRef
    }
    // 本地证据都答不上来时才问会话（可能起进程、花钱）；它也答不上才如实失败。
    if (!repoRef) {
      try {
        repoRef = await resolveRepoRefForCwd({ cwd, backendId: backend, describe: reg.describe, openSession })
      } catch (e) {
        repoRef = null
      }
    }
    if (!repoRef) return failureOf('认不出这个工作区的仓库身份，读不到本地快照库。', 'env')
    if (typeof getSnapshotLibrary !== 'function') return failureOf('本地快照库没有接上，读不到版本与变化集。', 'library')
    let lib: SnapshotReadLibrary | null = null
    try { lib = await Promise.resolve(getSnapshotLibrary()) } catch (e) { lib = null }
    if (!lib || typeof lib.readLibraryVersion !== 'function' || typeof lib.readLibraryChangeSet !== 'function') {
      return failureOf('本地快照库没有接上，读不到版本与变化集。', 'library')
    }
    return {
      cwd,
      backend,
      repoIdentity: String(repoRef.refId || ''),
      // 工作区键就是归一到工作区根之后的路径：客户端按同一把钥匙（wsKeyOf）分桶，比短散列好对——
      // 散列在客户端算不出同一份（客户端手里是所选目录，宿主这边锚过根），换后端/换子目录时会认错桶。
      workspaceKey: cwd,
      lib,
    }
  }

  function keyOf(ctx: ResolvedContext): SnapshotLibraryKeyLike {
    return { workspaceRoot: ctx.cwd, backend: ctx.backend, repoIdentity: ctx.repoIdentity }
  }

  /** 版本查询：只回版本、工作区键、后端三格（回包键集由门禁守着）。 */
  async function handleSnapshotVersion(args: any): Promise<any> {
    const ctx = await resolveContext(args)
    if ((ctx as ReadFailure).ok === false) return ctx
    const resolved = ctx as ResolvedContext
    let version: unknown = null
    try { version = await Promise.resolve(resolved.lib.readLibraryVersion(keyOf(resolved))) } catch (e) { version = null }
    if (typeof version !== 'number' || !Number.isFinite(version) || version < 0) {
      return failureOf('本地快照库开不出来，读不到当前版本。', 'library')
    }
    return {
      version: Math.floor(version),
      workspaceKey: resolved.workspaceKey,
      backend: resolved.backend,
    }
  }

  /**
   * 变化集：从客户端手上的版本读到当前版本。两条上限取中央时间参数；超过任一条就回整份。
   *
   * sinceVersion 不是非负整数时按「没有基线」交给库这一侧判（回整份）；这里不替它猜 0。
   * sinceMs 只用于「落后太久就整份」这一档降级：客户端没交时这一档不参与，行数上限照旧。
   */
  async function handleSnapshotChanges(args: any): Promise<any> {
    const ctx = await resolveContext(args)
    if ((ctx as ReadFailure).ok === false) return ctx
    const resolved = ctx as ResolvedContext
    const rawSince = args ? args.sinceVersion : undefined
    const sinceVersion = (typeof rawSince === 'number' && Number.isInteger(rawSince) && rawSince >= 0) ? rawSince : -1
    const rawSinceMs = args ? args.sinceMs : undefined
    const sinceMs = (typeof rawSinceMs === 'number' && Number.isFinite(rawSinceMs) && rawSinceMs > 0) ? Math.floor(rawSinceMs) : 0
    let result: any = null
    try {
      result = await Promise.resolve(resolved.lib.readLibraryChangeSet(Object.assign({}, keyOf(resolved), {
        sinceVersion,
        sinceMs,
        maxRows: SNAPSHOT_CHANGES_MAX_ROWS,
        maxAgeMs: SNAPSHOT_CHANGES_MAX_AGE_MS,
      })))
    } catch (e) {
      result = null
    }
    if (!result || typeof result.mergeVersion !== 'number') {
      return failureOf('本地快照库开不出来，读不到变化集。', 'library')
    }
    const head = {
      version: Math.floor(result.mergeVersion),
      workspaceKey: resolved.workspaceKey,
      backend: resolved.backend,
    }
    if (result.full === true) {
      return Object.assign(head, { full: true, reason: textOf(result.reason) || 'no-baseline' })
    }
    return Object.assign(head, {
      full: false,
      changed: Array.isArray(result.changes) ? result.changes : [],
      missing: Array.isArray(result.missing) ? result.missing : [],
    })
  }

  return { handleSnapshotVersion, handleSnapshotChanges }
}
