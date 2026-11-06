/**
 * src/refresh/rooms/host/snapshot-library-behind.ts —— 「本机库落后」状态（#1935）
 *
 * 要解决的事：写回执落库失败时，界面上的这一笔已经成了，本机快照库却还是旧的。用户看不到任何提示，
 * 直到下一次整份刷新才把那一行补回来（真机日志里是分钟级）。本模块只记一件事：这个工作区的本机库
 * 现在比后端落后，并把「尽快重同步一次」交给宿主去安排。它不取数、不写库，也不排队。
 *
 * 三条不能改的约定：
 *  1. 键与句柄缓存是同一把（workspaceRoot + backend + repoIdentity，见 snapshot-library-handles.ts
 *     的 cacheKeyOf）。用别的键会出现「这个窗口说落后、另一个窗口说没事」，因为句柄缓存已经按
 *     这把键认库了，状态必须跟着同一把钥匙走。
 *  2. 同一段「落后」里只安排一次重同步：重试本身已经等了两档（5 秒、10 秒），再一失败就立刻
 *     排一次短延迟探测即可；连续失败的回执不该排出十几次探测。重同步跑过之后会调
 *     noteResyncStarted 放开这一格，下一次失败还能再排——「排过就永远不排」会让一次网络抖动
 *     把工作区永久钉在落后态。
 *  3. 不做本地持久队列：状态只在进程内存里，重启就没了。为什么不做：重同步走的是常规探测/刷新，
 *     进程重启后的第一拍本来就会重新取数；把队列落盘会让「哪些写还没落库」多出一份真相，
 *     而它的真相已经在后端。反例：不要为了「重启后还记得」往这里加文件或表。
 */
import { cacheKeyOf, type SnapshotLibraryKey } from './snapshot-library-handles.js'

/** 读到的一份落后状态；没有落后时 behind 为假、reason 为空串、sinceMs 为 0。 */
export interface LibraryBehindState {
  behind: boolean
  /** 最近一次把状态置起来的失败原因（今天只有 write-failed）。只给诊断与日志，不上界面文案。 */
  reason: string
  /** 这一段落后是从哪一刻开始的（毫秒）；重复置位不刷新它，用来回答「落后了多久」。 */
  sinceMs: number
}

/** 宿主接进来的重同步入口：拿到库身份三格，自己去安排一次探测（延迟由接线处决定）。 */
export type LibraryResyncScheduler = (input: SnapshotLibraryKey) => void

interface BehindEntry {
  reason: string
  sinceMs: number
  /** 这一段落后是否已经排过一次重同步；noteResyncStarted 之后放开。 */
  resyncScheduled: boolean
}

const behind = new Map<string, BehindEntry>()
let resyncScheduler: LibraryResyncScheduler | null = null

/**
 * 接上宿主的重同步入口。传 null 关掉（门禁与脱离宿主的纯逻辑场景用）。
 *
 * 为什么不在这里直接调 setTimeout：延迟长短属于宿主时间口径（中央时间参数），而「重同步具体
 * 走哪条管线」属于宿主装配（见 snapshot-resync.ts）。两边都在宿主里接，本模块只表达「该排一次了」。
 */
export function setResyncScheduler(scheduler: LibraryResyncScheduler | null): void {
  resyncScheduler = (typeof scheduler === 'function') ? scheduler : null
}

/** 库身份三格不完整时不记账：没有工作区的失败重试没有意义，也找不到该给哪个库清状态。 */
function keyOf(input: SnapshotLibraryKey): string {
  if (!input || typeof input.workspaceRoot !== 'string' || !input.workspaceRoot) return ''
  return cacheKeyOf(input)
}

/**
 * 置上「本机库落后」。同一段落后里只排一次重同步（见文件头第 2 条）。
 *
 * 只该在写真的失败之后调用，而且只有 write-failed 这种「重试也没成的事务失败」值得置位：
 * readonly 是磁盘本来就不可写、legacy-writer 是旧版本窗口还占着写权，两者都不会因为再探测一次
 * 而变好；把它们也标成「正在重新同步」会让用户等一件永远不会发生的事。
 */
export function markLibraryBehind(input: SnapshotLibraryKey, reason: string): LibraryBehindState {
  const key = keyOf(input)
  if (!key) return { behind: false, reason: '', sinceMs: 0 }
  const nowMs = Date.now()
  const existing = behind.get(key)
  const entry: BehindEntry = existing
    ? { reason: String(reason || existing.reason), sinceMs: existing.sinceMs, resyncScheduled: existing.resyncScheduled }
    : { reason: String(reason || ''), sinceMs: nowMs, resyncScheduled: false }
  behind.set(key, entry)
  if (!entry.resyncScheduled && resyncScheduler) {
    // 先记「排过了」再调：调度函数自己若抛错，也不该在同一次失败里被反复调用。
    entry.resyncScheduled = true
    try {
      resyncScheduler({ workspaceRoot: input.workspaceRoot, backend: input.backend, repoIdentity: input.repoIdentity })
    } catch (e) {
      // 调度失败不改变落后状态：下一次写成功或常规刷新仍会把它带回去。
    }
  }
  return { behind: true, reason: entry.reason, sinceMs: entry.sinceMs }
}

/**
 * 重同步已经跑过一轮：放开「本段落后只排一次」这一格，让下一次失败还能再排一次。
 * 宿主在探测那一趟结束时调用（成功与否都调，成功时状态已由写成功清掉）。
 */
export function noteResyncStarted(input: SnapshotLibraryKey): void {
  const key = keyOf(input)
  if (!key) return
  const entry = behind.get(key)
  if (entry) entry.resyncScheduled = false
}

/** 清掉落后状态：任何一次真正写进库的写成功之后都该调（回执、详情、评论、行）。 */
export function clearLibraryBehind(input: SnapshotLibraryKey): void {
  const key = keyOf(input)
  if (!key) return
  behind.delete(key)
}

/** 读这一刻的落后状态。没有记录时回一个明确的「没落后」，不返回 null，调用方少写一个分支。 */
export function readLibraryBehind(input: SnapshotLibraryKey): LibraryBehindState {
  const key = keyOf(input)
  const entry = key ? behind.get(key) : undefined
  if (!entry) return { behind: false, reason: '', sinceMs: 0 }
  return { behind: true, reason: entry.reason, sinceMs: entry.sinceMs }
}

/** 门禁专用：清空所有状态与调度器，避免一个用例的落后态串到下一个用例。生产代码不调用。 */
export function __resetLibraryBehindForTests(): void {
  behind.clear()
  resyncScheduler = null
}
