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
import { logSnapshot, shortHash } from './log.js'

export interface OpenedWritable {
  db: DatabaseSync
  journalMode: string
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

  if (version !== SNAPSHOT_SCHEMA_VERSION) {
    return resetForSchema(db, dbPath, identity, nowMs, diagnostics, logEvent, `库结构版本 ${version}`)
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
