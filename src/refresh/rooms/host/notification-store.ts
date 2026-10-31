/**
 * src/refresh/rooms/host/notification-store.ts —— 通知事件库的宿主落盘与接线口（票 #1693）
 *
 * 事件库落在缓存目录里（与快照信封同目录），一个仓库一份文件：
 *   <进程 cwd>/.dsh-mattskillsdeck-cache/notification-events__<owner>__<name>.json
 * 为什么按仓库而不是按工作区根：面板同一个 GitHub 仓库可能从不同工作区根被打开，历史应当共享
 * （ADR「按工作区共享」）。拿不到仓库坐标（markdown / gitlab 这类没有 GitHub 仓库的后端）就不产事件，
 * 不猜一个目录代替。
 *
 * 四条不能改的约定：
 * 1. 本模块只记历史，不回答「现在降不降级」——那是快照的职责（currentDegradedOf 只负责把两者对不上的
 *    情况标出来）。
 * 2. 所有读改写串成一条 promise 链：同一个进程里并发的几次记录不会互相覆盖事件文件；跨进程并发靠
 *    整份覆写 + 版本校验兜底，读到坏文件就重写。
 *    （事件的界面文案不在本模块拼：本模块只写 code 与 params，文案在客户端按词条渲染。）
 * 3. 一个定时器都不排（票面：清理挂写入、读取与刷新节拍上）。刷新节拍本来就会调 noteSnapshot，
 *    所以「刷新时清理」由这条写入路径承担，不另起后台节拍。
 * 4. 只有真正因新事件而落盘的那一趟才记一行 notification.event 日志。读盘时顺手做的清理、纯清理落盘
 *    与落盘失败都不记——否则日志里出现一行会让排查的人以为盘上多了一段新历史（本票 #1681 复审修复）。
 *
 * 事件正文只存结构化内容（类型 + 机器码 + 短参数，上限在纯逻辑模块的 NOTIFICATION_EVENT_MAX_TEXT），
 * 不存界面文案；日志只记类型、仓库散列与条数，不记原文。
 */
import { NOTIFICATION_EVENT_DEDUPE_MS } from '../../../shared/time-config/src/values.js'
import { NOTIFICATION_EVENT_RETENTION_MS } from '../../../shared/time-config/src/values.js'
import {
  NOTIFICATION_EVENT_MAX_EVENTS,
  appendDegradedRecovery,
  appendDegradedStart,
  appendInstant,
  buildNotificationEventFile,
  clipNotificationText,
  currentDegradedOf,
  normalizeRepoKey,
  parseNotificationEventFile,
  pruneNotificationEvents,
} from '../../kernel/notification-events.js'
import type { NotificationEvent } from '../../kernel/notification-events.js'

/** 事件文件名前缀：与快照的 owner__name.json 同目录、不同名，一眼能认出是事件库。 */
const FILE_PREFIX = 'notification-events__'
const FILE_SUFFIX = '.json'

/** 一个数字选项：给了就用，没给用中央常量（保留期、去重窗都来自 config/ 下的生成值）。 */
function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : fallback
}

/** 宿主注入的依赖：文件名、目录、仓库坐标与 fs 门面全由入口显式传入（D7 不静态 import 宿主）。 */
interface NotificationStoreDeps {
  fs?: { resolve?: unknown; readText?: unknown; writeText?: unknown } | null
  getPlatform?: (() => unknown) | null
  getCacheDir?: (() => unknown) | null
  getRepoKey?: ((cwd: unknown) => unknown) | null
  logCtx?: { fire?: unknown; isEnabled?: unknown } | null
  now?: (() => number) | null
  retentionMs?: number
  dedupeMs?: number
  maxEvents?: number
}

/** 日志只需要仓库散列：仓库名原文不落日志（与宿主其它埋点同一口径）。 */
function hash8(text: unknown): string {
  let h = 5381
  const t = String(text || '')
  for (let i = 0; i < t.length; i += 1) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
  return ('0000000' + h.toString(16)).slice(-8)
}

/**
 * 造宿主事件库。返回的四个口都由接线处调用：noteSnapshot 挂采纳快照的漏斗（降级开始/恢复），
 * noteRefreshFailure 挂刷新失败分支，noteWriteFailure 挂 deck 写工具失败分支，read 给面板历史用。
 * 所有方法都不抛异常：事件库坏了也只能少一段历史，不能影响取数与写票。
 */
export function createNotificationStore(deps: unknown) {
  const d = (deps || {}) as NotificationStoreDeps
  const nowMs = typeof d.now === 'function' ? d.now : function (): number { return Date.now() }
  const retentionMs = numberOr(d.retentionMs, NOTIFICATION_EVENT_RETENTION_MS)
  const dedupeMs = numberOr(d.dedupeMs, NOTIFICATION_EVENT_DEDUPE_MS)
  const maxEvents = numberOr(d.maxEvents, NOTIFICATION_EVENT_MAX_EVENTS)
  let chain: Promise<unknown> = Promise.resolve()
  let writes = 0
  let reads = 0

  /** 把一次读改写排到链尾：并发调用按提交顺序逐个跑，前一次失败不挡后一次。 */
  function enqueue<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    const run: Promise<T> = chain.then(fn, fn).catch(function (): T { return fallback })
    chain = run.then(function (): unknown { return null }, function (): unknown { return null })
    return run
  }

  /** 仓库坐标可能是异步口（宿主 getRepoKey 就是 async）：先解开再归一；拿不到就空串。 */
  async function repoOf(cwd: unknown): Promise<string> {
    try { return normalizeRepoKey(await Promise.resolve(typeof d.getRepoKey === 'function' ? d.getRepoKey(cwd) : null)) } catch (e) { return '' }
  }

  /** 仓库 → 事件文件路径。fs 门面或目录拿不到就回 null（这次不记，不影响主流程）。 */
  async function pathOf(repo: string): Promise<string | null> {
    try {
      const face = d.fs
      if (!face || typeof face.readText !== 'function' || typeof face.writeText !== 'function' || typeof face.resolve !== 'function') return null
      const dir = await Promise.resolve(typeof d.getCacheDir === 'function' ? d.getCacheDir() : null)
      if (!dir) return null
      const platform = (await Promise.resolve(typeof d.getPlatform === 'function' ? d.getPlatform() : null)) as any
      if (!platform || !platform.path || typeof platform.path.join !== 'function' || !platform.fs || typeof platform.fs.resolve !== 'function') return null
      // 与快照的 owner__name.json 同一种命名：斜杠换成双下划线（单下划线留给名字里本来就有的字符）。
      const name = FILE_PREFIX + repo.split('/').map(function (part: string) { return part.replace(/[^A-Za-z0-9._-]/g, '_') }).join('__') + FILE_SUFFIX
      return await platform.fs.resolve(platform.path.join(String(dir), name))
    } catch (e) { return null }
  }

  async function loadText(file: string): Promise<string> {
    try { const txt = await (d.fs as any).readText(file); return typeof txt === 'string' ? txt : '' } catch (e) { return '' }
  }

  /** 读历史并顺手清理；pruned 说清理掉了东西，调用方要把清理结果落盘（清理挂在读取节拍上）。 */
  async function loadHistory(repo: string): Promise<{ events: NotificationEvent[]; pruned: boolean }> {
    const file = await pathOf(repo)
    if (!file) return { events: [], pruned: false }
    const txt = await loadText(file)
    let raw: unknown = null
    try { raw = txt ? JSON.parse(txt) : null } catch (e) { raw = null }
    const events = parseNotificationEventFile(raw, repo)
    const kept = pruneNotificationEvents(events, { now: nowMs(), retentionMs: retentionMs, maxEvents: maxEvents })
    return { events: kept, pruned: kept.length !== events.length }
  }

  /**
   * 整份覆写落盘，回 this time 有没有落上（写失败静默：下一次有事件时会再写一遍）。
   * quiet 为真时只落盘不记日志：读盘清理与纯 prune 落盘不算「新历史」，不能伪造一行 notification.event。
   */
  async function persist(repo: string, events: NotificationEvent[], quiet?: boolean): Promise<boolean> {
    try {
      const file = await pathOf(repo)
      if (!file) return false
      await (d.fs as any).writeText(file, JSON.stringify(buildNotificationEventFile(repo, events, nowMs())))
      writes += 1
      if (!quiet) {
        try {
          const logCtx = d.logCtx as any
          if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('info', 'notification.event', { repoHash: hash8(repo), events: events.length, type: events.length ? events[events.length - 1].type : '' })
        } catch (eL) { /* 日志失败不影响落盘 */ }
      }
      return true
    } catch (e) { return false }
  }

  /** 读事件历史（供面板历史用）。读盘失败或没有仓库时回空数组。 */
  function read(cwd: unknown): Promise<NotificationEvent[]> {
    return enqueue(async function (): Promise<NotificationEvent[]> {
      const repo = await repoOf(cwd)
      if (!repo) return []
      const loaded = await loadHistory(repo)
      reads += 1
      // 读盘清理是维护动作，不是新历史：落盘可以，日志不打（quiet）。
      if (loaded.pruned) await persist(repo, loaded.events, true)
      return loaded.events
    }, [])
  }

  /**
   * 采纳一份快照之后记「降级开始 / 恢复」。判据只认快照（currentDegradedOf），与快照路、刷新路同一口径；
   * 事件库只负责把这次状态迁移如实记下来。
   */
  function noteSnapshot(snap: unknown, cwd: unknown): Promise<number | null> {
    return enqueue(async function (): Promise<number | null> {
      const repo = await repoOf(cwd)
      if (!repo) return null
      const loaded = await loadHistory(repo)
      let events = loaded.events
      let changed = false
      const view = currentDegradedOf(snap, events)
      if (view.degraded && view.openStartedAt === null) {
        // 只记「哪种原因」这一枚机器码（quota 才允许界面提配额），具体说法由客户端按词条渲染。
        const rawReason = (snap && typeof snap === 'object') ? (snap as any).fallbackReason : ''
        events = appendDegradedStart(events, { repo: repo, now: nowMs(), code: 'degraded-start', params: { reason: String(rawReason) === 'quota' ? 'quota' : 'other' } })
        changed = true
      } else if (!view.degraded && view.openStartedAt !== null) {
        events = appendDegradedRecovery(events, { repo: repo, now: nowMs(), code: 'degraded-recovery', params: {} })
        changed = true
      }
      if (!changed && !loaded.pruned) return null
      // 有病历（changed）落盘才记一行日志；这次只是顺手清理（!changed && pruned）就安静落盘。
      const written = await persist(repo, events, !changed)
      return changed && written ? events.length : null
    }, null)
  }

  /** 刷新失败：记一条瞬时事件（去重窗内并入上一条）。 */
  function noteRefreshFailure(cwd: unknown, error: unknown): Promise<number | null> {
    return enqueue(async function (): Promise<number | null> {
      const repo = await repoOf(cwd)
      if (!repo) return null
      const loaded = await loadHistory(repo)
      const reason = clipNotificationText(error, 80)
      const params: Record<string, string> = {}
      if (reason) params.reason = reason
      const events = appendInstant(loaded.events, { repo: repo, now: nowMs(), type: 'refresh-failed', code: 'refresh-failed', params: params, dedupeMs: dedupeMs })
      const written = await persist(repo, events)
      return written ? events.length : null
    }, null)
  }

  /** 写失败：只由 deck 写工具失败分支调用（读工具不经过这里）。 */
  function noteWriteFailure(info: unknown): Promise<number | null> {
    return enqueue(async function (): Promise<number | null> {
      const bag = (info && typeof info === 'object' ? info : {}) as any
      const repo = await repoOf(bag.cwd)
      if (!repo) return null
      const tool = clipNotificationText(bag.tool) || 'deck-write'
      const reason = clipNotificationText(bag.reason, 80)
      const params: Record<string, string> = { tool: tool }
      if (reason) params.reason = reason
      const loaded = await loadHistory(repo)
      const events = appendInstant(loaded.events, { repo: repo, now: nowMs(), type: 'write-failed', code: 'write-failed', params: params, dedupeMs: dedupeMs })
      const written = await persist(repo, events)
      return written ? events.length : null
    }, null)
  }

  /** 排查用读数：落盘次数与读取次数（不放事件正文）。 */
  function debugState(): { writes: number; reads: number; retentionMs: number; dedupeMs: number; maxEvents: number } {
    return { writes: writes, reads: reads, retentionMs: retentionMs, dedupeMs: dedupeMs, maxEvents: maxEvents }
  }

  return { noteSnapshot: noteSnapshot, noteRefreshFailure: noteRefreshFailure, noteWriteFailure: noteWriteFailure, read: read, debugState: debugState }
}
