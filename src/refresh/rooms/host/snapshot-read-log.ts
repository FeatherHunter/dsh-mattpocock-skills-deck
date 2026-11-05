// src/refresh/rooms/host/snapshot-read-log.ts —— 快照与变化集回包的读数记账（#1899，规格 #1885「可诊断性」）
//
// 为什么单开一份：两条回包（wf.snapshot 与 wf.snapshotChanges）都要记行数、字节数与耗时，
// 字段口径、字节数的算法与两条事件的发射形状只该有一处。首屏电话那个文件贴着有效行上限，
// 也不适合再塞一段序列化。
//
// 四条约定（改这里之前先读）：
//   1. 只在成功回包时记：失败回包的种类由既有的失败日志回答，读数（行数/字节数）对失败没有意义。
//   2. 字节数就是这一趟真正交回去的对象序列化之后的 UTF-8 字节数；序列化本身失败按 0 记，
//      不让一次日志把回包弄坏。
//   3. 工作区只记 8 位短散列（与同一房里的 snapshot.request 同一个 djb2 算法），不记路径原文。
//   4. 退化那一行（snapshot.degrade）只在真有原因时发；原因值来自 snapshot-degradation.ts，
//      两种原因（库这一侧的三种 + 变化集的两档上限）之外不许在这里新编。
import { SNAPSHOT_DEGRADE } from './snapshot-degradation.js'

/**
 * 宿主日志出口的形状：两种接法都认——宿主装配时给的是 { fire } 的日志上下文，
 * 两条读口从宿主入口拿的是一个 (level, event, fields) 回调。没接就完全不记，与快照树的 logEvent 同一口径。
 */
export type SnapshotReadLogCtx =
  | ((level: string, event: string, fields?: unknown) => void)
  | { fire(level: string, event: string, fields?: unknown): void }

/** 这一趟首屏的读数：数据从哪来、库版本多少、投影花了多久、没有回放时是哪种退化。 */
export interface SnapshotReplyReadout {
  /** library = 从库回放；online-rebuild = 这一趟去后端取了数并写库。 */
  source: 'library' | 'online-rebuild'
  /** 库版本；-1 表示这一趟没有库版本（在线重建或库没接）。 */
  version: number
  /** 库投影耗时（毫秒）；-1 表示这一趟没有库投影。 */
  projectionMs: number
  /** 没有回放时是哪种退化原因（五个值之一）；有回放或强制刷新时是空串。 */
  reason: string
}

declare const Buffer: { byteLength(text: string, encoding?: string): number } | undefined

/** 32 位 djb2 摘要取 8 位十六进制：与 snapshot.request 的 cwdHash 同一个算法，日志里能按工作区串起来。 */
export function workspaceHash8(value: unknown): string {
  try {
    const text = String(value || '')
    let hash = 5381
    for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0
    return ('0000000' + hash.toString(16)).slice(-8)
  } catch (e) {
    return '00000000'
  }
}

/** UTF-8 字节数；没有 Buffer 的运行环境按码点逐字算（两种算法对普通 ASCII 与中文给出同一个数）。 */
function utf8Bytes(text: string): number {
  if (typeof Buffer !== 'undefined' && Buffer && typeof Buffer.byteLength === 'function') {
    return Buffer.byteLength(text, 'utf8')
  }
  let bytes = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) || 0
    bytes += code < 0x80 ? 1 : (code < 0x800 ? 2 : (code < 0x10000 ? 3 : 4))
  }
  return bytes
}

/** 一个回包序列化之后的 UTF-8 字节数；序列化失败按 0（记日志不许把回包弄坏）。 */
export function replyBytesOf(reply: unknown): number {
  try {
    const text = JSON.stringify(reply)
    return typeof text === 'string' ? utf8Bytes(text) : 0
  } catch (e) {
    return 0
  }
}

/** 造一份首屏读数；两个分支各改各的，同一个对象最后交给 noteSnapshotReply。 */
export function createSnapshotReadout(): SnapshotReplyReadout {
  return { source: 'online-rebuild', version: -1, projectionMs: -1, reason: '' }
}

/**
 * 按「这一趟要不要交付库回放」把首屏读数填好。
 *
 * 强制刷新时即使库里有回放也不算数（那一趟真的去后端取了数），所以它按在线重建记；
 * 没有回放时按门的回答分三种：库门面没接 = 库没接；有重建诊断 = 库坏；其余 = 库空。
 */
export function applySnapshotReadout(readout: SnapshotReplyReadout, first: any, isForce: boolean): void {
  const replay = (!isForce && first && first.replay) ? first.replay : null
  readout.source = replay ? 'library' : 'online-rebuild'
  readout.version = replay && typeof replay.mergeVersion === 'number' ? replay.mergeVersion : -1
  readout.projectionMs = replay && typeof replay.projectionMs === 'number' ? replay.projectionMs : -1
  if (replay) { readout.reason = ''; return }
  readout.reason = !first
    ? SNAPSHOT_DEGRADE.libraryNotWired
    : String(first.degradeReason || SNAPSHOT_DEGRADE.libraryEmpty)
}

function fire(logCtx: SnapshotReadLogCtx | null | undefined, level: string, event: string, fields: any): void {
  if (!logCtx) return
  try {
    if (typeof logCtx === 'function') { logCtx(level, event, fields); return }
    if (typeof logCtx.fire === 'function') logCtx.fire(level, event, fields)
  } catch (e) {
    // 日志出口的问题不该影响回包：这里故意不转发。
  }
}

/**
 * 记一次首屏回包的读数，并在没有回放时记一行退化原因。
 *
 * 行数取回包里的列表行（容器与子票都收在 issues 里）：它就是界面这一趟拿到几行。
 */
export function noteSnapshotReply(
  logCtx: SnapshotReadLogCtx | null | undefined,
  reply: any,
  cwd: unknown,
  readout: SnapshotReplyReadout,
  elapsedMs: number,
): void {
  // 没接日志出口时连序列化都不做：字节数要 stringify 整个回包，不该让不记日志的运行环境付这笔钱。
  // 304（内容没变）不记：那一趟没有交数据，行数与字节数都是 0，记下来只会让人以为「交了一份空的」。
  if (!logCtx || !reply || reply.ok !== true || reply.notModified === true || reply.status === 304) return
  const cwdHash = workspaceHash8(cwd)
  const rows = Array.isArray(reply.issues) ? reply.issues.length : 0
  fire(logCtx, 'info', 'snapshot.read', {
    phone: 'snapshot',
    source: readout.source,
    cwdHash: cwdHash,
    version: readout.version,
    rows: rows,
    bytes: replyBytesOf(reply),
    elapsedMs: elapsedMs,
    projectionMs: readout.projectionMs,
  })
  if (readout.reason) {
    fire(logCtx, 'info', 'snapshot.degrade', {
      side: 'host',
      phone: 'snapshot',
      reason: readout.reason,
      cwdHash: cwdHash,
      version: readout.version,
    })
  }
}

/** 记一次变化集回包的读数；整份时再记一行退化原因（reason 由变化集投影给出）。 */
export function noteChangesReply(
  logCtx: SnapshotReadLogCtx | null | undefined,
  reply: any,
  cwd: unknown,
  elapsedMs: number,
  projectionMs: number,
): void {
  if (!logCtx || !reply || reply.ok === false) return
  const cwdHash = workspaceHash8(cwd)
  const changed = Array.isArray(reply.changed) ? reply.changed.length : 0
  const missing = Array.isArray(reply.missing) ? reply.missing.length : 0
  fire(logCtx, 'info', 'snapshot.read', {
    phone: 'changes',
    source: 'library',
    cwdHash: cwdHash,
    version: typeof reply.version === 'number' ? reply.version : -1,
    rows: changed + missing,
    bytes: replyBytesOf(reply),
    elapsedMs: elapsedMs,
    projectionMs: projectionMs,
    full: reply.full === true,
  })
  const reason = String(reply.reason || '')
  if (reply.full === true && reason) {
    fire(logCtx, 'info', 'snapshot.degrade', {
      side: 'host',
      phone: 'changes',
      reason: reason,
      cwdHash: cwdHash,
      version: typeof reply.version === 'number' ? reply.version : -1,
    })
  }
}

/**
 * 记一次容器级投影回包的读数（#1923）：打开一张已关闭容器时取了多少张子票、多少字节、花了多久。
 *
 * 为什么与首屏共用 snapshot.read 事件：它回答的是同一件事「这一趟从库里交回去多少东西」，
 * 只是 phone 换成了 containerProjection。用户自己点开容器才发一次，低频，不需要新事件名。
 */
export function noteContainerReply(
  logCtx: SnapshotReadLogCtx | null | undefined,
  reply: any,
  cwd: unknown,
  elapsedMs: number,
  projectionMs: number,
): void {
  if (!logCtx || !reply || reply.ok !== true) return
  fire(logCtx, 'info', 'snapshot.read', {
    phone: 'containerProjection',
    source: 'library',
    cwdHash: workspaceHash8(cwd),
    version: typeof reply.version === 'number' ? reply.version : -1,
    rows: Array.isArray(reply.tickets) ? reply.tickets.length : 0,
    bytes: replyBytesOf(reply),
    elapsedMs: elapsedMs,
    projectionMs: projectionMs,
  })
}

/** 库这一侧读失败（开不出来/读不出来）时记一行退化：这一趟的整份不是用户要的，是库坏了。 */
export function noteLibraryFailure(
  logCtx: SnapshotReadLogCtx | null | undefined,
  phone: string,
  cwd: unknown,
): void {
  fire(logCtx, 'info', 'snapshot.degrade', {
    side: 'host',
    phone: phone,
    reason: SNAPSHOT_DEGRADE.libraryCorrupt,
    cwdHash: workspaceHash8(cwd),
    version: -1,
  })
}
