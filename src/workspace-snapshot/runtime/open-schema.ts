// runtime/open-schema.ts —— 开库时的结构/身份校验与整库重建。
//
// 从 open.ts 拆出来只有一个原因：那一份要把「开库 → 抢租约 → 装配句柄」讲清楚，
// 再塞进几段重建分支就超过单文件 350 有效行的门禁。这里只做「库结构与身份是否可用」，
// 不碰租约、不装配句柄；open.ts 仍然是唯一入口。
//
// 重建一律「先备份（仅损坏时）、再删三件套、再建空库」：损坏的库连 sqlite_master 都可能读不出来，
// 删文件是唯一能保证回到可用状态的做法；没有备份证据时绝不删库。
//
// #1934 起重建是库外互斥的（runtime/rebuild-lock.ts）：
//   1. 先按不动手的方式检查一遍库（quick_check、结构版本、身份）；不需要重建就直接返回，
//      连锁都不拿——普通开库不会因为重建协议多付一次文件锁。
//   2. 需要重建才拿锁。拿不到（另一个进程正在重建）就抛 RebuildBusyError，什么都不删。
//   3. 拿到锁之后必须重新检查一遍库：等锁的这段时间里，另一个进程可能已经重建好了。
//      不看就按等之前那份判断再删一次，等于把别人刚建好的新库删掉——锁只串行化了两次删库，
//      没有实现「只有一个重建」，那正是本票要防的。
//   4. 删库前、建库前、建库后各复核一次 fencing token：锁在重建期间被别人接手（过期清理、
//      旧重建者恢复）时立即抛 RebuildLockLostError，绝不删库。
//   5. 完成或失败都立刻释放锁（finally）。持锁期间由锁自己按 TTL/3 续期。
import type { DatabaseSync } from 'node:sqlite'
import type { SnapshotLogEvent } from '../contract/types.js'
import type { SnapshotDiagnostic } from '../model/types.js'
import {
  applyWriterPragmas,
  backupDatabaseFiles,
  closeDatabase,
  openDatabase,
  quickCheckDatabase,
  removeDatabaseFiles,
} from '../persistence/database.js'
import {
  initializeSchema,
  readMetaIdentity,
  readSchemaVersion,
  SNAPSHOT_SCHEMA_VERSION,
  type SnapshotIdentity,
  type SnapshotMetaIdentity,
} from '../persistence/schema.js'
import { migrateSchema } from '../persistence/migrate.js'
import { logSnapshot, shortHash } from './log.js'
import {
  acquireRebuildLock,
  RebuildBusyError,
  retryWhileFileBusy,
  type RebuildLockHandle,
} from './rebuild-lock.js'

export interface OpenedWritable {
  db: DatabaseSync
  journalMode: string
  /** 这一次开库把结构从哪一版迁上来的（没迁过就是 undefined）。开库那条日志用它说清「这次没重建」。 */
  migratedFrom?: number
}

/** 哪一类原因让这份库不能直接用。诊断码、日志 stage 与处置方式都由它决定。 */
type RebuildReason = 'corrupt' | 'initialize-conflict' | 'schema-reset' | 'identity-mismatch'

/** 检查发现「必须重建」时带回来的事实；不在这里删任何文件。 */
interface RebuildNeed {
  reason: RebuildReason
  /** 给人看的那一句原因（错误原文、或旧身份的两三格）。 */
  detail: string
  stage: 'quick-check' | 'initialize' | 'schema' | 'identity'
  oldBackend?: string
  oldRepoHash?: string
}

type Inspection =
  | { ok: true, opened: OpenedWritable }
  | { ok: false, need: RebuildNeed }

/**
 * 打开写连接并把库结构准备到「可用且身份匹配」的状态。任何不匹配都走整库重建，
 * 因为本票没有迁移路径，重建是唯一能保证 schema 与身份一致的做法。
 */
export function openWritableDatabase(
  dbPath: string,
  identity: SnapshotIdentity,
  nowMs: number,
  diagnostics: SnapshotDiagnostic[],
  logEvent: SnapshotLogEvent | undefined,
): OpenedWritable {
  const first = inspectWritableDatabase(dbPath, identity, nowMs)
  if (first.ok) return first.opened
  return rebuildUnderLock(dbPath, identity, nowMs, diagnostics, logEvent, first.need)
}

/**
 * 强制整库重建（用户在设置页点「重建」）。走与自动重建同一把库外锁：
 * 拿不到就抛 RebuildBusyError，调用方照常能用自己的句柄（连接还没关）。
 *
 * 为什么释放连接的活交给回调：必须「先拿到锁、再关连接」。反过来的话，一次「稍后重试」
 * 会把调用方手里的句柄变成连着一个已关闭连接的废句柄。
 */
export function rebuildWritableDatabase(
  dbPath: string,
  identity: SnapshotIdentity,
  nowMs: number,
  logEvent: SnapshotLogEvent | undefined,
  releaseLocalConnection?: () => void,
): OpenedWritable {
  const lock = requireRebuildLock(dbPath, logEvent)
  try {
    if (releaseLocalConnection) releaseLocalConnection()
    return replaceDatabaseFiles(dbPath, identity, nowMs, lock)
  } finally {
    lock.release()
  }
}

/** 拿锁；拿不到抛可识别的 RebuildBusyError（宿主会回落在在线路径）。 */
function requireRebuildLock(dbPath: string, logEvent: SnapshotLogEvent | undefined): RebuildLockHandle {
  const lock = acquireRebuildLock(dbPath, { logEvent })
  // acquire 已经在超时那一行记过日志，这里不再重复记一遍同样的结论。
  if (!lock) throw new RebuildBusyError()
  return lock
}

/** 自动重建：拿锁 → 复检 → 删/建 → 释放。 */
function rebuildUnderLock(
  dbPath: string,
  identity: SnapshotIdentity,
  nowMs: number,
  diagnostics: SnapshotDiagnostic[],
  logEvent: SnapshotLogEvent | undefined,
  first: RebuildNeed,
): OpenedWritable {
  const lock = requireRebuildLock(dbPath, logEvent)
  try {
    const again = inspectWritableDatabase(dbPath, identity, nowMs)
    if (again.ok) {
      // 等锁期间别人已经重建好了：直接用新库，一个文件都不删。
      logSnapshot(logEvent, 'info', 'workspaceSnapshot.corrupt', {
        stage: first.stage,
        action: 'skipped',
        detail: '等到重建锁时库已被另一个进程重建好，直接用新库、不删任何文件',
      })
      return again.opened
    }
    return performRebuild(dbPath, identity, nowMs, diagnostics, logEvent, again.need, lock)
  } finally {
    lock.release()
  }
}

/** 真正动手的那一段：备份（仅损坏）→ 删三件套 → 建空库，前后各复核一次锁。 */
function performRebuild(
  dbPath: string,
  identity: SnapshotIdentity,
  nowMs: number,
  diagnostics: SnapshotDiagnostic[],
  logEvent: SnapshotLogEvent | undefined,
  need: RebuildNeed,
  lock: RebuildLockHandle,
): OpenedWritable {
  let backupSuffix: string | undefined
  if (need.reason === 'corrupt') {
    // 损坏是唯一需要保留证据的一支：别的重建原因（身份不符、结构版本不符）没有可救的数据。
    lock.assertHeld('备份坏库之前')
    backupSuffix = retryWhileFileBusy(() => backupDatabaseFiles(dbPath, nowMs))
  }
  const fresh = replaceDatabaseFiles(dbPath, identity, nowMs, lock)
  pushRebuildDiagnostic(diagnostics, need, backupSuffix)
  logRebuild(logEvent, need, backupSuffix)
  return fresh
}

/** 删三件套、建空库；删之前、建之前、建之后各复核一次锁。 */
function replaceDatabaseFiles(
  dbPath: string,
  identity: SnapshotIdentity,
  nowMs: number,
  lock: RebuildLockHandle,
): OpenedWritable {
  lock.assertHeld('删库之前')
  retryWhileFileBusy(() => removeDatabaseFiles(dbPath))
  lock.assertHeld('建库之前')
  const fresh = createEmptyDatabase(dbPath, identity, nowMs)
  // 建完之后再复核：锁若在重建途中易主，这份刚建的文件可能正被新持有者当成它的目标，
  // 交出去会让调用方拿着一个随时会被别人改写的库。抛错让本次开库失败，不删任何东西。
  lock.assertHeld('建库之后')
  return fresh
}

/** 把这一支重建的原因写进诊断；码与文案保持与 #1862 起的老口径一致。 */
function pushRebuildDiagnostic(
  diagnostics: SnapshotDiagnostic[],
  need: RebuildNeed,
  backupSuffix: string | undefined,
): void {
  if (need.reason === 'corrupt') {
    diagnostics.push({
      code: 'corrupt-rebuilt',
      message: '快照库完整性检查未通过，已备份坏库并整库重建',
      detail: backupSuffix ? need.detail + '；备份后缀 ' + backupSuffix : need.detail,
    })
    return
  }
  if (need.reason === 'identity-mismatch') {
    diagnostics.push({
      code: 'identity-mismatch-rebuilt',
      message: '快照库身份与本次工作区不符，已整库重建，避免串数据',
      detail: need.detail,
    })
    return
  }
  diagnostics.push({
    code: 'schema-reset',
    message: need.reason === 'initialize-conflict'
      ? '目标文件不是本工具的库结构，已整库重建'
      : '快照库结构版本或元信息不符，已整库重建',
    detail: need.detail,
  })
}

/** 重建那一趟的日志轨迹。事件名与 stage 的含义不变，新增的只有重建锁那几行（action 不同）。 */
function logRebuild(
  logEvent: SnapshotLogEvent | undefined,
  need: RebuildNeed,
  backupSuffix: string | undefined,
): void {
  if (need.reason === 'corrupt') {
    logSnapshot(logEvent, 'error', 'workspaceSnapshot.corrupt', {
      stage: 'quick-check',
      action: 'rebuilt',
      ...(backupSuffix ? { backupSuffix } : null),
      detail: need.detail,
    })
    return
  }
  if (need.reason === 'identity-mismatch') {
    logSnapshot(logEvent, 'warn', 'workspaceSnapshot.corrupt', {
      stage: 'identity',
      action: 'rebuilt',
      ...(need.oldBackend ? { oldBackend: need.oldBackend } : null),
      ...(need.oldRepoHash ? { oldRepoHash: need.oldRepoHash } : null),
    })
    return
  }
  logSnapshot(logEvent, 'warn', 'workspaceSnapshot.corrupt', {
    stage: need.stage,
    action: 'rebuilt',
    detail: need.detail,
  })
}

/**
 * 检查一遍库，决定「能不能直接用」。需要重建时先关掉自己的连接再返回：
 * Windows 上还开着的文件删不掉，重建的人不该被自己的连接挡住。
 */
function inspectWritableDatabase(
  dbPath: string,
  identity: SnapshotIdentity,
  nowMs: number,
): Inspection {
  const db = openDatabase(dbPath, false)
  let journalMode = 'unknown'
  try {
    quickCheckDatabase(db)
  } catch (error) {
    closeDatabase(db)
    return { ok: false, need: { reason: 'corrupt', detail: describeError(error) || '', stage: 'quick-check' } }
  }

  journalMode = applyWriterPragmas(db)
  const version = readSchemaVersion(db)
  if (version === 0) {
    try {
      initializeSchema(db, identity, nowMs)
      return { ok: true, opened: { db, journalMode } }
    } catch (error) {
      // 预先存在的非快照库（有别的表、user_version=0）：建表撞名。删掉重建。
      closeDatabase(db)
      return { ok: false, need: { reason: 'initialize-conflict', detail: describeError(error) || '', stage: 'initialize' } }
    }
  }

  // 版本落后：先走显式迁移（加列/建表，数据留着）；迁移失败才退到整库重建。
  // 版本比本代码新：说明有人拿新版本的插件写过这个库，只能重建，不能按旧结构读。
  if (version < SNAPSHOT_SCHEMA_VERSION) {
    try {
      migrateSchema(db, version, SNAPSHOT_SCHEMA_VERSION)
    } catch (error) {
      closeDatabase(db)
      return {
        ok: false,
        need: { reason: 'schema-reset', detail: '迁移失败（从版本 ' + version + '）：' + describeError(error), stage: 'schema' },
      }
    }
    const meta = readMetaIdentity(db)
    if (!meta) {
      closeDatabase(db)
      return { ok: false, need: { reason: 'schema-reset', detail: '迁移后 meta 行缺失（从版本 ' + version + '）', stage: 'schema' } }
    }
    if (!identityMatches(meta, identity)) {
      closeDatabase(db)
      return { ok: false, need: identityNeed(meta, false) }
    }
    return { ok: true, opened: { db, journalMode, migratedFrom: version } }
  }
  if (version > SNAPSHOT_SCHEMA_VERSION) {
    closeDatabase(db)
    return { ok: false, need: { reason: 'schema-reset', detail: '库结构版本 ' + version + ' 比本代码新', stage: 'schema' } }
  }

  const meta = readMetaIdentity(db)
  if (!meta) {
    closeDatabase(db)
    return { ok: false, need: { reason: 'schema-reset', detail: 'meta 行缺失', stage: 'schema' } }
  }
  if (!identityMatches(meta, identity)) {
    closeDatabase(db)
    return { ok: false, need: identityNeed(meta, true) }
  }
  return { ok: true, opened: { db, journalMode } }
}

/** 身份三格（后端、仓库、工作区根）必须全部相同，否则串数据。 */
function identityMatches(meta: SnapshotMetaIdentity, identity: SnapshotIdentity): boolean {
  return meta.backend === identity.backend
    && meta.repoIdentity === identity.repoIdentity
    && meta.workspaceRoot === identity.workspaceRoot
}

/**
 * 身份不符的重建原因。迁移之后那一支只给出两格旧身份，普通那一支多给一个工作区根散列——
 * 这是 #1862 起的诊断口径，门禁按文案核对，不要合并。
 */
function identityNeed(meta: SnapshotMetaIdentity, withRootHash: boolean): RebuildNeed {
  return {
    reason: 'identity-mismatch',
    detail: withRootHash
      ? '旧身份：backend=' + meta.backend + ', repo=' + meta.repoIdentity + ', rootHash=' + shortHash(meta.workspaceRoot)
      : '旧身份：backend=' + meta.backend + ', repo=' + meta.repoIdentity,
    stage: 'identity',
    oldBackend: meta.backend,
    oldRepoHash: shortHash(meta.repoIdentity),
  }
}

/**
 * 建一个全新的空库（调用方已确保旧文件删干净，并且正拿着重建锁）。
 *
 * 建表失败时先别急着报错：删旧库与建新库之间有一个极短的窗口，另一个进程如果正好在
 * 这一刻打开同一个路径，SQLite 会顺手建出一个空文件并抢先建表（它看到的是「文件不存在」，
 * 既不重建、也不拿锁）。这时库已经完整、身份也对得上，直接用；否则把原错误抛出去，
 * 由上层回落在在线路径，绝不在这里再删一次。
 */
function createEmptyDatabase(
  dbPath: string,
  identity: SnapshotIdentity,
  nowMs: number,
): OpenedWritable {
  const db = openDatabase(dbPath, false)
  const journalMode = applyWriterPragmas(db)
  try {
    initializeSchema(db, identity, nowMs)
    return { db, journalMode }
  } catch (error) {
    closeDatabase(db)
    const again = inspectWritableDatabase(dbPath, identity, nowMs)
    if (again.ok) return again.opened
    throw error
  }
}

/** 错误转一行人能读的说明；不要把整个异常对象塞进诊断。 */
export function describeError(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined
  if (error instanceof Error) return error.message
  return String(error)
}
