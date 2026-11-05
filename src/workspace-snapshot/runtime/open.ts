// runtime/open.ts —— 对外入口：开库、校验身份、抢租约、装配句柄。
//
// 开库顺序是有讲究的：
//   1. 先做 quick_check。损坏的文件连 PRAGMA 都可能报错，必须在设 WAL 之前发现；
//   2. 损坏 → 关连接、三件套改名备份、重建空库，并落一条诊断（损坏原因 + 备份后缀）；
//   3. 结构版本不符 / 没有 meta / 身份（后端、仓库、工作区根）不符 → 整库重建并落诊断，
//      绝不静默把一个仓库的快照当成另一个仓库的；
//   4. 抢单写者租约。抢不到就关掉写连接、以只读连接重开，句柄 mode 变 readonly，
//      上层从 mode 与 diagnostics 都能感知。
//
// 为什么重建用「删文件」而不是 DROP TABLE：损坏的库可能连 sqlite_master 都读不出来，
// 删文件是唯一能保证回到可用状态的做法；备份改名先做，失败就抛，绝不在没有证据的情况下删库。
import { dirname, existsSync, mkdirSync, resolve } from './node-builtins.js'
import type {
  IngestResult,
  MarkMissingResult,
  MissingTicket,
  OpenWorkspaceSnapshotOptions,
  OpenWorkspaceSnapshotResult,
  SnapshotMode,
  SnapshotStorageStats,
  SyncBookkeeping,
  SyncBookkeepingResult,
  SyncBookkeepingWrite,
  WorkspaceSnapshotHandle,
  WriteBatch,
} from '../contract/types.js'
import type {
  ChangeSetProjection,
  ChangeSetQuery,
  IssueDetailProjection,
  IssueDetailQuery,
  ListProjection,
  ListQuery,
  SnapshotCounts,
  SnapshotDiagnostic,
} from '../model/types.js'
import {
  applyReaderPragmas,
  applyWriterPragmas,
  closeDatabase,
  openDatabase,
  removeDatabaseFiles,
} from '../persistence/database.js'
import {
  initializeSchema,
  readMergeVersion,
  type SnapshotIdentity,
} from '../persistence/schema.js'
import { applySyncBookkeepingRow, readSyncBookkeepingRow } from '../persistence/sync-bookkeeping.js'
import { openWritableDatabase, describeError } from './open-schema.js'
import { readListProjection } from '../projection/list.js'
import { readIssueDetailProjection } from '../projection/detail.js'
import { readChangeSetProjection } from '../projection/changes.js'
import { readCountsProjection } from '../projection/counts.js'
import { readStorageStats } from './storage-stats.js'
import { ingestWrites } from './ingest.js'
import { markMissingTickets } from './tombstone-write.js'
import {
  releaseLease,
  startLeaseHeartbeat,
  tryAcquireLease,
  type LeaseHeartbeat,
} from './lease.js'
import { logSnapshot, shortHash } from './log.js'
import { defaultSnapshotDbPath, resolveSnapshotWorkspaceRoot } from './paths.js'

/** 允许的后端；运行时再挡一道，防止 JS 调用方传进不认识的字符串。 */
const SNAPSHOT_BACKENDS = new Set(['github', 'gitlab', 'markdown'])

/**
 * 打开工作区快照库。返回的 handle 是同步 API（理由见 contract/types.ts 的注释）。
 *
 * options.dbPath 存在时按调用方给的路径（测试注入）；否则按规格落到工作区根下的缓存目录。
 * 传入的 workspaceRoot 会先按 workspace.yaml 规则归一到根，身份校验与默认路径都用归一后的根。
 */
export function openWorkspaceSnapshot(
  options: OpenWorkspaceSnapshotOptions,
): OpenWorkspaceSnapshotResult {
  if (!options || typeof options !== 'object') throw new Error('openWorkspaceSnapshot 需要 options')
  if (typeof options.workspaceRoot !== 'string' || options.workspaceRoot.length === 0) {
    throw new Error('openWorkspaceSnapshot 缺少 workspaceRoot')
  }
  if (!SNAPSHOT_BACKENDS.has(options.backend)) {
    throw new Error(`openWorkspaceSnapshot 不认识的后端：${String(options.backend)}`)
  }
  if (typeof options.repoIdentity !== 'string') {
    throw new Error('openWorkspaceSnapshot 缺少 repoIdentity')
  }

  const now = options.now ?? (() => Date.now())
  const root = resolveSnapshotWorkspaceRoot(options.workspaceRoot)
  const dbPath = options.dbPath
    ? resolve(options.dbPath)
    : defaultSnapshotDbPath(root, options.backend)
  const identity: SnapshotIdentity = {
    backend: options.backend,
    repoIdentity: options.repoIdentity,
    workspaceRoot: root,
  }
  const owner = options.leaseOwner ?? `snapshot:${process.pid}:${Math.random().toString(36).slice(2, 10)}`
  const diagnostics: SnapshotDiagnostic[] = []
  const logEvent = options.logEvent

  mkdirSync(dirname(dbPath), { recursive: true })
  const existsBefore = existsSync(dbPath)
  let opened = openWritableDatabase(dbPath, identity, now(), diagnostics, logEvent)
  let db = opened.db
  let journalMode = opened.journalMode

  logSnapshot(logEvent, 'info', 'workspaceSnapshot.open', {
    backend: identity.backend,
    rootHash: shortHash(root),
    repoHash: shortHash(identity.repoIdentity),
    dbExisted: existsBefore,
    journalMode,
    mergeVersion: readMergeVersion(db),
    // 迁移过就说清「这一次没重建」；字段沿用已登记的 reason，不新增事件也不新增键。
    ...(opened.migratedFrom !== undefined ? { reason: 'migrated-from-' + opened.migratedFrom } : null),
  })

  let mode: SnapshotMode = 'writable'
  let heartbeat: LeaseHeartbeat | null = null
  let leaseDetail: string | undefined
  let acquired = false
  try {
    const lease = tryAcquireLease(db, owner, now())
    acquired = lease.acquired
    leaseDetail = lease.holder ? `持有者：${lease.holder}` : undefined
  } catch (error) {
    // BEGIN IMMEDIATE 在 busy_timeout 之后仍然拿不到锁：按抢不到处理，退回只读。
    leaseDetail = describeError(error)
  }

  if (!acquired) {
    closeDatabase(db)
    db = openDatabase(dbPath, true)
    applyReaderPragmas(db)
    mode = 'readonly'
    diagnostics.push({
      code: 'lease-held-readonly',
      message: '快照库的写者租约被占用，已退回只读',
      detail: leaseDetail,
    })
    // reason 是稳定的枚举（held = 别人拿着写权），持有者那一句人话放 detail；
    // 把两者混在 reason 里会让按 reason 过滤的排查看不到「抢不到」这一类。
    logSnapshot(logEvent, 'warn', 'workspaceSnapshot.lease', {
      acquired: false,
      ownerHash: shortHash(owner),
      reason: 'held',
      ...(leaseDetail ? { detail: leaseDetail } : null),
    })
    logSnapshot(logEvent, 'warn', 'workspaceSnapshot.open', {
      mode,
      reason: 'lease-held',
    })
  } else {
    heartbeat = startLeaseHeartbeat(db, owner, now, (error) => {
      if (mode !== 'writable') return
      mode = 'readonly'
      diagnostics.push({
        code: 'lease-lost-readonly',
        message: '快照库写者租约已丢失，句柄降级为只读',
        detail: describeError(error),
      })
      logSnapshot(logEvent, 'warn', 'workspaceSnapshot.lease', {
        acquired: false,
        ownerHash: shortHash(owner),
        reason: 'heartbeat-lost',
      })
    })
    logSnapshot(logEvent, 'info', 'workspaceSnapshot.lease', {
      acquired: true,
      ownerHash: shortHash(owner),
      nowMs: now(),
    })
  }

  let closed = false
  const ensureOpen = (): void => {
    if (closed) throw new Error('快照句柄已关闭')
  }

  const handle: WorkspaceSnapshotHandle = {
    get mode(): SnapshotMode {
      return mode
    },
    getMergeVersion(): number {
      ensureOpen()
      return readMergeVersion(db)
    },
    ingest(batch: WriteBatch): IngestResult {
      ensureOpen()
      if (!batch || !Array.isArray(batch.writes)) {
        throw new Error('ingest 需要 { startMergeVersion, writes }')
      }
      if (mode !== 'writable') {
        logSnapshot(logEvent, 'warn', 'workspaceSnapshot.ingest', {
          committed: false,
          reason: 'readonly',
          mergeVersion: readMergeVersion(db),
        })
        return { committed: false, reason: 'readonly' }
      }
      const startedAt = now()
      const result = ingestWrites(
        db, batch.writes, batch.startMergeVersion, startedAt, batch.sync,
        batch.kind === 'receipt' ? 'receipt' : 'read',
      )
      const elapsedMs = now() - startedAt
      if (result.committed) {
        logSnapshot(logEvent, 'info', 'workspaceSnapshot.ingest', {
          committed: true,
          writes: batch.writes.length,
          startMergeVersion: batch.startMergeVersion,
          mergeVersion: result.mergeVersion,
          elapsedMs,
        })
        return {
          committed: true,
          mergeVersion: result.mergeVersion as number,
          commentPositions: result.commentPositions,
          ...(result.sync ? { sync: result.sync } : null),
        }
      }
      const reason = result.reason ?? 'write-failed'
      logSnapshot(logEvent, reason === 'stale' ? 'warn' : 'error', 'workspaceSnapshot.ingest', {
        committed: false,
        reason,
        writes: batch.writes.length,
        startMergeVersion: batch.startMergeVersion,
        detail: result.detail,
        elapsedMs,
      })
      return { committed: false, reason, detail: result.detail }
    },
    readSyncBookkeeping(): SyncBookkeeping {
      ensureOpen()
      return readSyncBookkeepingRow(db)
    },
    writeSyncBookkeeping(write: SyncBookkeepingWrite): SyncBookkeepingResult {
      ensureOpen()
      if (mode !== 'writable') {
        return { committed: false, state: readSyncBookkeepingRow(db), reason: 'readonly' }
      }
      db.exec('BEGIN IMMEDIATE')
      try {
        const current = readSyncBookkeepingRow(db)
        const applied = applySyncBookkeepingRow(db, write, current)
        if (!applied.committed) {
          db.exec('ROLLBACK')
          return { committed: false, state: applied.state, reason: 'stale' }
        }
        db.exec('COMMIT')
        return { committed: true, state: applied.state }
      } catch (error) {
        try { db.exec('ROLLBACK') } catch { /* 事务可能已因约束错误自动回滚 */ }
        return { committed: false, state: readSyncBookkeepingRow(db), reason: 'write-failed', detail: describeError(error) }
      }
    },
    markMissing(entries: readonly MissingTicket[], startMergeVersion: number): MarkMissingResult {
      ensureOpen()
      if (mode !== 'writable') {
        logSnapshot(logEvent, 'warn', 'workspaceSnapshot.ingest', {
          committed: false,
          reason: 'readonly',
          mergeVersion: readMergeVersion(db),
        })
        return { committed: false, reason: 'readonly', mergeVersion: readMergeVersion(db), marked: 0 }
      }
      return markMissingTickets(db, entries, startMergeVersion, now())
    },
    readCounts(): SnapshotCounts {
      ensureOpen()
      return readCountsProjection(db)
    },
    readStorageStats(): SnapshotStorageStats {
      ensureOpen()
      return readStorageStats(db, dbPath)
    },
    readList(query?: ListQuery): ListProjection {
      ensureOpen()
      return readListProjection(db, query, now())
    },
    readIssueDetail(query: IssueDetailQuery): IssueDetailProjection {
      ensureOpen()
      return readIssueDetailProjection(db, query, now())
    },
    readChangeSet(query: ChangeSetQuery): ChangeSetProjection {
      ensureOpen()
      return readChangeSetProjection(db, query, now())
    },
    rebuild(): void {
      ensureOpen()
      if (mode !== 'writable') throw new Error('只读快照句柄不能整库重建')
      heartbeat?.stop()
      heartbeat = null
      closeDatabase(db)
      removeDatabaseFiles(dbPath)
      db = openDatabase(dbPath, false)
      journalMode = applyWriterPragmas(db)
      initializeSchema(db, identity, now())
      const lease = tryAcquireLease(db, owner, now())
      if (!lease.acquired) {
        // 极窄的竞态：删库与重新抢租约之间别人先建了库并抢走租约。既不删别人的库，也不假装能写。
        closeDatabase(db)
        db = openDatabase(dbPath, true)
        applyReaderPragmas(db)
        mode = 'readonly'
        diagnostics.push({
          code: 'lease-held-readonly',
          message: '整库重建后写者租约被占用，已退回只读',
          detail: lease.holder ? `持有者：${lease.holder}` : undefined,
        })
        return
      }
      mode = 'writable'
      heartbeat = startLeaseHeartbeat(db, owner, now, (error) => {
        if (mode !== 'writable') return
        mode = 'readonly'
        diagnostics.push({
          code: 'lease-lost-readonly',
          message: '快照库写者租约已丢失，句柄降级为只读',
          detail: describeError(error),
        })
      })
      logSnapshot(logEvent, 'info', 'workspaceSnapshot.open', {
        mode: 'writable',
        reason: 'rebuilt',
        journalMode,
        mergeVersion: readMergeVersion(db),
      })
    },
    close(): void {
      if (closed) return
      closed = true
      heartbeat?.stop()
      heartbeat = null
      if (mode === 'writable') releaseLease(db, owner)
      closeDatabase(db)
      logSnapshot(logEvent, 'info', 'workspaceSnapshot.open', { mode: 'closed' })
    },
    getDiagnostics(): SnapshotDiagnostic[] {
      return diagnostics.slice()
    },
  }

  return { handle, mode, diagnostics: diagnostics.slice() }
}
