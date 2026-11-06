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
// #1899：两条读口的回包读数（行数、字节数、耗时、版本）与退化原因落在这里记，口径只此一份。
import { noteChangesReply, noteContainerReply, noteLibraryFailure } from './snapshot-read-log.js'
import { SNAPSHOT_DEGRADE } from './snapshot-degradation.js'

/** 这一层真正用到的库门面形状；调用方注入的实现可以更宽。 */
interface SnapshotReadLibrary {
  readLibraryVersion(input: SnapshotLibraryKeyLike): Promise<number | null> | number | null
  readLibraryChangeSet(input: SnapshotLibraryKeyLike & {
    sinceVersion: number
    sinceMs?: number
    maxRows: number
    maxAgeMs: number
  }): Promise<any> | any
  /**
   * 库这一刻的六个数字 + 完整度（#1887）。变化集只带变化的行，界面拿它把行换掉；
   * 计数是由全库算的，必须在同一个回包里一起带上，改一行之后数字才能立刻跟着变。
   * 老门面没有这一口时回包不带 counts（客户端保留手上那份）。
   */
  readSnapshotCounts?(input: SnapshotLibraryKeyLike): Promise<any> | any
  /** 按容器读一次（#1923）：已关闭容器的子票、层级与统计只在打开它时取，不进首屏投影。 */
  readContainerProjection?(input: SnapshotLibraryKeyLike & { key: string, effortId?: string }): Promise<any> | any
  /**
   * 库的占用读数（#1922）：库文件字节数与票行数。只在环境检查页的诊断读数里用；
   * 老门面没有这一口时这条电话如实失败（不清理、不猜数）。
   */
  readLibraryStorageStats?(input: SnapshotLibraryKeyLike): Promise<any> | any
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
  /** 宿主日志出口（#1899）：没接就完全不记，与快照库那几族事件同一个可选注入口径。 */
  logEvent?: ((level: string, event: string, fields?: unknown) => void) | null
}

interface ResolvedContext {
  cwd: string
  backend: string
  repoIdentity: string
  workspaceKey: string
  lib: SnapshotReadLibrary
}

/**
 * 两条电话共用的失败回包：ok:false 只在出错时出现，成功回包不带它。
 *
 * #1899 起库这一侧的失败多带一格 reason（library-not-wired / library-corrupt）：客户端据此决定
 * 「退回整份」并把原因原样写进日志。环境类失败（还没选后端、认不出仓库）不带 reason——
 * 那不是库退化，退回整份也取不到数据。
 */
type ReadFailure = { ok: false, error: string, errorKind: 'env' | 'library', reason?: string }

function failureOf(error: string, errorKind: 'env' | 'library', reason?: string): ReadFailure {
  return reason ? { ok: false, error, errorKind, reason } : { ok: false, error, errorKind }
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 造出两条读口的处理体。两条共用同一套身份解析：同一份工作区在同一个后端上必须指向同一个库文件，
 * 少一格或换一种兜底就会读成另一个库（版本看起来对不上，变化集永远是整份）。
 */
export function createSnapshotReadChannels(deps: SnapshotReadChannelsDeps): {
  handleSnapshotVersion: (args: any) => Promise<any>
  handleSnapshotChanges: (args: any) => Promise<any>
  handleContainerProjection: (args: any) => Promise<any>
  handleSnapshotStoreStats: (args: any) => Promise<any>
} {
  const canonicalKey = deps.canonicalKey
  const selectEarly = deps.selectEarly
  const getTrackerRegistry = deps.getTrackerRegistry
  const getSnapshotLibrary = deps.getSnapshotLibrary || null
  const getRepoKey = deps.getRepoKey || null
  const openSession = deps.openSession || null
  const logEvent = deps.logEvent || null

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
    // 身份补齐只有一份实现（#1885 评审修复）：describe → 宿主本地 git 远程 → 本地 Markdown 目录 →
    // 会话。版本查询是五秒一拍的轮询，所以本地证据都排在开会话之前。
    let repoRef: RepositoryRef | null = null
    try {
      repoRef = await resolveRepoRefForCwd({
        cwd,
        backendId: backend,
        describe: reg.describe,
        getRepoKey: getRepoKey || null,
        openSession,
      })
    } catch (e) {
      repoRef = null
    }
    if (!repoRef || !repoRef.refId) return failureOf('认不出这个工作区的仓库身份，读不到本地快照库。', 'env')
    if (typeof getSnapshotLibrary !== 'function') {
      return failureOf('本地快照库没有接上，读不到版本与变化集。', 'library', SNAPSHOT_DEGRADE.libraryNotWired)
    }
    let lib: SnapshotReadLibrary | null = null
    try { lib = await Promise.resolve(getSnapshotLibrary()) } catch (e) { lib = null }
    if (!lib || typeof lib.readLibraryVersion !== 'function' || typeof lib.readLibraryChangeSet !== 'function') {
      return failureOf('本地快照库没有接上，读不到版本与变化集。', 'library', SNAPSHOT_DEGRADE.libraryNotWired)
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
      // 这一拍是五秒一次的轮询：这里不记日志（记了就是心跳），只把原因交给客户端；
      // 客户端在真正退回整份那一拍记一行 snapshot.degrade，只记一次。
      return failureOf('本地快照库开不出来，读不到当前版本。', 'library', SNAPSHOT_DEGRADE.libraryCorrupt)
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
    const startedAt = Date.now()
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
    // 投影时长只量库这一次查询：取数、解析与组装另算，混在一起就分不清「库慢」还是「回包大」。
    const projectionMs = Date.now() - startedAt
    if (!result || typeof result.mergeVersion !== 'number') {
      // 变化集只有版本推进时才问一次，低频，所以库这一侧读失败照实记一行退化（不节流也不刷）。
      noteLibraryFailure(logEvent, 'changes', resolved.workspaceKey)
      return failureOf('本地快照库开不出来，读不到变化集。', 'library', SNAPSHOT_DEGRADE.libraryCorrupt)
    }
    const head = {
      version: Math.floor(result.mergeVersion),
      workspaceKey: resolved.workspaceKey,
      backend: resolved.backend,
    }
    let reply: any
    if (result.full === true) {
      reply = Object.assign(head, { full: true, reason: textOf(result.reason) || 'no-baseline' })
    } else {
      // #1887：变化行与六个数字同一个回包。只带变化行的话，界面把行换成新值之后数字还是旧的，
      // 要等下一次整份快照才对得上 —— 那正是本票要消灭的「数字与列表两种口径」。
      let counts: unknown = null
      if (typeof resolved.lib.readSnapshotCounts === 'function') {
        try { counts = await Promise.resolve(resolved.lib.readSnapshotCounts(keyOf(resolved))) } catch (e) { counts = null }
      }
      reply = Object.assign(head, {
        full: false,
        changed: Array.isArray(result.changes) ? result.changes : [],
        missing: Array.isArray(result.missing) ? result.missing : [],
      })
      if (counts && typeof counts === 'object') reply.counts = counts
    }
    // 读数与退化原因都在这一处记：回包已经拼好，字节数就是客户端真正收到的那一份。
    noteChangesReply(logEvent, reply, resolved.workspaceKey, Date.now() - startedAt, projectionMs)
    return reply
  }

  /**
   * 容器级投影（#1923）：一次交出「容器行 + 子票 + 层级 + 统计」。
   *
   * 为什么单开一条电话而不是把子票并进首屏：规格 §6 规定首屏投影只画开放工作集与开放容器的子票，
   * 已关闭容器的子票属于「打开它才需要」的历史；这条电话只在用户选中一张已关闭容器时由视图模型的
   * 命令发一次，首屏体积因此一个字节都不变。
   *
   * 库里没有这张容器时如实回失败（reason=container-not-in-library），不拿空数组冒充「确认一张都没有」
   * ——那会把「本机还没取过」说成「它确实没有子票」（规格 I6）。
   */
  async function handleContainerProjection(args: any): Promise<any> {
    const ctx = await resolveContext(args)
    if ((ctx as ReadFailure).ok === false) return ctx
    const resolved = ctx as ResolvedContext
    const key = (args && typeof args.key === 'string') ? args.key.trim() : ''
    if (!key) return failureOf('没有给容器编号，取不到它的子票。', 'env')
    const effortId = (args && args.effortId !== undefined && args.effortId !== null) ? String(args.effortId) : ''
    if (typeof resolved.lib.readContainerProjection !== 'function') {
      return failureOf('本地快照库没有接上，读不到这张容器的子票。', 'library', SNAPSHOT_DEGRADE.libraryNotWired)
    }
    let result: any = null
    const startedAt = Date.now()
    try {
      result = await Promise.resolve(resolved.lib.readContainerProjection(Object.assign({}, keyOf(resolved), { key, effortId })))
    } catch (e) {
      result = null
    }
    const projectionMs = Date.now() - startedAt
    if (!result || typeof result.mergeVersion !== 'number') {
      noteLibraryFailure(logEvent, 'containerProjection', resolved.workspaceKey)
      return failureOf('本地快照库开不出来，读不到这张容器的子票。', 'library', SNAPSHOT_DEGRADE.libraryCorrupt)
    }
    if (!result.container) {
      return failureOf('本地快照库里还没有这张容器的行，等下一次刷新后再看。', 'library', 'container-not-in-library')
    }
    const reply = {
      ok: true,
      version: Math.floor(result.mergeVersion),
      workspaceKey: resolved.workspaceKey,
      backend: resolved.backend,
      container: result.container,
      tickets: Array.isArray(result.tickets) ? result.tickets : [],
      stats: result.stats && typeof result.stats === 'object' ? result.stats : null,
    }
    noteContainerReply(logEvent, reply, resolved.workspaceKey, Date.now() - startedAt, projectionMs)
    return reply
  }

  /**
   * 库占用读数（#1922）：诊断用。回包多带版本（规格 I2：读回包都带版本），
   * 字节数与票行数与库里同一次读数一致；读不到就如实失败，不编 0。
   *
   * 这条电话不清理任何东西：2026-11-05 起按需细节不设上限、不淘汰，
   * 报数只是为了「不淘汰也要看得见增长」。
   */
  async function handleSnapshotStoreStats(args: any): Promise<any> {
    const ctx = await resolveContext(args)
    if ((ctx as ReadFailure).ok === false) return ctx
    const resolved = ctx as ResolvedContext
    if (typeof resolved.lib.readLibraryStorageStats !== 'function') {
      return failureOf('本地快照库没有接上，读不到库文件大小与行数。', 'library', SNAPSHOT_DEGRADE.libraryNotWired)
    }
    let stats: any = null
    try { stats = await Promise.resolve(resolved.lib.readLibraryStorageStats(keyOf(resolved))) } catch (e) { stats = null }
    const bytes = stats && typeof stats.bytes === 'number' ? stats.bytes : NaN
    const rows = stats && typeof stats.rows === 'number' ? stats.rows : NaN
    const version = stats && typeof stats.version === 'number' ? stats.version : NaN
    if (!Number.isFinite(bytes) || bytes < 0 || !Number.isFinite(rows) || rows < 0
      || !Number.isFinite(version) || version < 0) {
      return failureOf('本地快照库开不出来，读不到库文件大小与行数。', 'library', SNAPSHOT_DEGRADE.libraryCorrupt)
    }
    // 写模型三格（#1932）：本地多写者还是网络盘单写者回退、这个窗口现在能不能写、有没有旧租约挡着。
    // 它们是诊断读数的一部分，与字节数、行数一起回，界面上「写模型」那一行与它们同源。
    // 取不到时如实给 unknown，不猜一个能写——猜错会让用户以为写进去了。
    const storageKind = stats && (stats.storageKind === 'local' || stats.storageKind === 'network')
      ? stats.storageKind
      : 'unknown'
    const mode = stats && (stats.mode === 'writable' || stats.mode === 'readonly')
      ? stats.mode
      : 'unknown'
    // 旧租约挡住本地写（#1932）：这一格要跟着回，否则设置页会把一个「写不进去」的窗口
    // 显示成正常的本地多写者。取不到时按 false（没有证据说有旧租约，就不声称有）。
    const legacyWriterBlocked = !!(stats && stats.legacyWriterBlocked === true)
    return {
      version: Math.floor(version),
      bytes: Math.floor(bytes),
      rows: Math.floor(rows),
      storageKind,
      mode,
      legacyWriterBlocked,
      workspaceKey: resolved.workspaceKey,
      backend: resolved.backend,
    }
  }

  return { handleSnapshotVersion, handleSnapshotChanges, handleContainerProjection, handleSnapshotStoreStats }
}
