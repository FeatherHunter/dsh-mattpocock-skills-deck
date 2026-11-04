// runtime/open-schema.ts —— 开库时的结构/身份校验与整库重建。
//
// 从 open.ts 拆出来只有一个原因：那一份要把「开库 → 抢租约 → 装配句柄」讲清楚，
// 再塞进四段重建分支就超过单文件 350 有效行的门禁。这里只做「库结构与身份是否可用」，
// 不碰租约、不装配句柄；open.ts 仍然是唯一入口。
//
// 重建一律「先备份（仅损坏时）、再删三件套、再建空库」：损坏的库连 sqlite_master 都可能读不出来，
// 删文件是唯一能保证回到可用状态的做法；没有备份证据时绝不删库。
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
} from '../persistence/schema.js'
import { migrateSchema } from '../persistence/migrate.js'
import { logSnapshot, shortHash } from './log.js'

export interface OpenedWritable {
  db: DatabaseSync
  journalMode: string
  /** 这一次开库把结构从哪一版迁上来的（没迁过就是 undefined）。开库那条日志用它说清「这次没重建」。 */
  migratedFrom?: number
}

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
  let db = openDatabase(dbPath, false)
  let journalMode = 'unknown'
  try {
    quickCheckDatabase(db)
  } catch (error) {
    closeDatabase(db)
    const backupSuffix = backupDatabaseFiles(dbPath, nowMs)
    removeDatabaseFiles(dbPath)
    const fresh = createEmptyDatabase(dbPath, identity, nowMs)
    diagnostics.push({
      code: 'corrupt-rebuilt',
      message: '快照库完整性检查未通过，已备份坏库并整库重建',
      detail: `${describeError(error)}；备份后缀 ${backupSuffix}`,
    })
    logSnapshot(logEvent, 'error', 'workspaceSnapshot.corrupt', {
      stage: 'quick-check',
      action: 'rebuilt',
      backupSuffix,
      detail: describeError(error),
    })
    return fresh
  }

  journalMode = applyWriterPragmas(db)
  const version = readSchemaVersion(db)
  if (version === 0) {
    try {
      initializeSchema(db, identity, nowMs)
      return { db, journalMode }
    } catch (error) {
      // 预先存在的非快照库（有别的表、user_version=0）：建表撞名。删掉重建。
      closeDatabase(db)
      removeDatabaseFiles(dbPath)
      const fresh = createEmptyDatabase(dbPath, identity, nowMs)
      diagnostics.push({
        code: 'schema-reset',
        message: '目标文件不是本工具的库结构，已整库重建',
        detail: describeError(error),
      })
      logSnapshot(logEvent, 'warn', 'workspaceSnapshot.corrupt', {
        stage: 'initialize',
        action: 'rebuilt',
        detail: describeError(error),
      })
      return fresh
    }
  }

  // 版本落后：先走显式迁移（加列/建表，数据留着）；迁移失败才退到整库重建。
  // 版本比本代码新：说明有人拿新版本的插件写过这个库，只能重建，不能按旧结构读。
  if (version < SNAPSHOT_SCHEMA_VERSION) {
    let migratedFrom = version
    try {
      migrateSchema(db, version, SNAPSHOT_SCHEMA_VERSION)
    } catch (error) {
      return resetForSchema(db, dbPath, identity, nowMs, diagnostics, logEvent, `迁移失败（从版本 ${version}）：${describeError(error)}`)
    }
    const meta = readMetaIdentity(db)
    if (!meta) {
      return resetForSchema(db, dbPath, identity, nowMs, diagnostics, logEvent, `迁移后 meta 行缺失（从版本 ${version}）`)
    }
    if (meta.backend !== identity.backend || meta.repoIdentity !== identity.repoIdentity || meta.workspaceRoot !== identity.workspaceRoot) {
      closeDatabase(db)
      removeDatabaseFiles(dbPath)
      const fresh = createEmptyDatabase(dbPath, identity, nowMs)
      diagnostics.push({
        code: 'identity-mismatch-rebuilt',
        message: '快照库身份与本次工作区不符，已整库重建，避免串数据',
        detail: `旧身份：backend=${meta.backend}, repo=${meta.repoIdentity}`,
      })
      logSnapshot(logEvent, 'warn', 'workspaceSnapshot.corrupt', {
        stage: 'identity',
        action: 'rebuilt',
        oldBackend: meta.backend,
        oldRepoHash: shortHash(meta.repoIdentity),
      })
      return fresh
    }
    return { db, journalMode, migratedFrom }
  }
  if (version > SNAPSHOT_SCHEMA_VERSION) {
    return resetForSchema(db, dbPath, identity, nowMs, diagnostics, logEvent, `库结构版本 ${version} 比本代码新`)
  }

  const meta = readMetaIdentity(db)
  if (!meta) {
    return resetForSchema(db, dbPath, identity, nowMs, diagnostics, logEvent, 'meta 行缺失')
  }
  if (
    meta.backend !== identity.backend
    || meta.repoIdentity !== identity.repoIdentity
    || meta.workspaceRoot !== identity.workspaceRoot
  ) {
    closeDatabase(db)
    removeDatabaseFiles(dbPath)
    const fresh = createEmptyDatabase(dbPath, identity, nowMs)
    diagnostics.push({
      code: 'identity-mismatch-rebuilt',
      message: '快照库身份与本次工作区不符，已整库重建，避免串数据',
      detail: `旧身份：backend=${meta.backend}, repo=${meta.repoIdentity}, rootHash=${shortHash(meta.workspaceRoot)}`,
    })
    logSnapshot(logEvent, 'warn', 'workspaceSnapshot.corrupt', {
      stage: 'identity',
      action: 'rebuilt',
      oldBackend: meta.backend,
      oldRepoHash: shortHash(meta.repoIdentity),
    })
    return fresh
  }
  return { db, journalMode }
}

/** 结构版本或元信息不符：不迁移，直接重建。 */
function resetForSchema(
  db: DatabaseSync,
  dbPath: string,
  identity: SnapshotIdentity,
  nowMs: number,
  diagnostics: SnapshotDiagnostic[],
  logEvent: SnapshotLogEvent | undefined,
  detail: string,
): OpenedWritable {
  closeDatabase(db)
  removeDatabaseFiles(dbPath)
  const fresh = createEmptyDatabase(dbPath, identity, nowMs)
  diagnostics.push({
    code: 'schema-reset',
    message: '快照库结构版本或元信息不符，已整库重建',
    detail,
  })
  logSnapshot(logEvent, 'warn', 'workspaceSnapshot.corrupt', {
    stage: 'schema',
    action: 'rebuilt',
    detail,
  })
  return fresh
}

/** 建一个全新的空库（调用方已确保旧文件删干净）。 */
function createEmptyDatabase(
  dbPath: string,
  identity: SnapshotIdentity,
  nowMs: number,
): OpenedWritable {
  const db = openDatabase(dbPath, false)
  const journalMode = applyWriterPragmas(db)
  initializeSchema(db, identity, nowMs)
  return { db, journalMode }
}

/** 错误转一行人能读的说明；不要把整个异常对象塞进诊断。 */
export function describeError(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined
  if (error instanceof Error) return error.message
  return String(error)
}
