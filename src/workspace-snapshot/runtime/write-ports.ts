// runtime/write-ports.ts —— 句柄的写口（#1932 从 open.ts 拆出）
//
// 为什么单列：open.ts 要讲清「开库、判存储类别、决定写模型、装配句柄」这条主干，再把三条写口
// 塞进去就超过单文件 350 有效行的门禁（tests/verify-file-granularity.ts）。写口与开库的耦合只有
// 三格：现在能不能写（mode）、是不是本地路径（storageKind）、写之前要不要重查旧租约。
//
// 三条约定不能改：
//   1. 写之前先判 mode，再判旧租约，最后才开事务。只读句柄与旧租约挡住时都**不开事务**——
//      开了再回滚等于白占一次写锁，还会让别人的 busy_timeout 多等一轮。
//   2. 旧租约的重查每次写都做（legacyWriteBlocked 是取数函数）：租约过期之后下一次写就该恢复，
//      不能要求用户重启本窗口（#1932 验收 5）。
//   3. 事务中途出错整段 ROLLBACK，回写失败原因；绝不留半写。
import type { DatabaseSync } from 'node:sqlite'
import type {
  IngestResult,
  MarkMissingResult,
  MissingTicket,
  SnapshotLogEvent,
  SnapshotMode,
  SnapshotStorageKind,
  SyncBookkeepingResult,
  SyncBookkeepingWrite,
  WriteBatch,
} from '../contract/types.js'
import { applySyncBookkeepingRow, readSyncBookkeepingRow } from '../persistence/sync-bookkeeping.js'
import { readMergeVersion } from '../persistence/schema.js'
import { ingestWrites } from './ingest.js'
import { describeError } from './open-schema.js'
import { markMissingTickets } from './tombstone-write.js'

/** 旧租约挡住本地写时给用户看的那一句话。措辞只此一处，诊断、写口与重建抛错都用它。 */
export const LEGACY_WRITER_MESSAGE = '还有窗口在用旧版本写这个工作区，请重启所有窗口'

export interface WritePortsInput {
  /** 当前连接；重建会换连接，所以每次写都现取。 */
  db: () => DatabaseSync
  now: () => number
  logEvent?: SnapshotLogEvent
  /** 现在能不能写（打开时定下的 mode，网络盘心跳丢了会被 runtime 改成 readonly）。 */
  mode: () => SnapshotMode
  storageKind: SnapshotStorageKind
  /**
   * 写之前的旧租约重查：返回 true = 现在不能写（本地库上还有一个未过期的旧租约）。
   * 网络盘与只读句柄上恒为 false —— 那里的写权由 mode 表达。
   */
  legacyWriteBlocked: () => boolean
  assertOpen: () => void
}

export interface WritePorts {
  ingest(batch: WriteBatch): IngestResult
  writeSyncBookkeeping(write: SyncBookkeepingWrite): SyncBookkeepingResult
  markMissing(entries: readonly MissingTicket[], startMergeVersion: number): MarkMissingResult
}

/** 装配三条写口。 */
export function createWritePorts(input: WritePortsInput): WritePorts {
  return {
    ingest(batch: WriteBatch): IngestResult {
      input.assertOpen()
      if (!batch || !Array.isArray(batch.writes)) {
        throw new Error('ingest 需要 { startMergeVersion, writes }')
      }
      const db = input.db()
      if (input.mode() !== 'writable') {
        input.logEvent?.('warn', 'workspaceSnapshot.ingest', {
          committed: false,
          reason: 'readonly',
          mergeVersion: readMergeVersion(db),
        })
        return { committed: false, reason: 'readonly' }
      }
      if (input.legacyWriteBlocked()) {
        input.logEvent?.('warn', 'workspaceSnapshot.ingest', {
          committed: false,
          reason: 'legacy-writer',
          writes: batch.writes.length,
          startMergeVersion: batch.startMergeVersion,
        })
        return { committed: false, reason: 'legacy-writer', detail: LEGACY_WRITER_MESSAGE }
      }
      const startedAt = input.now()
      const result = ingestWrites(
        db, batch.writes, batch.startMergeVersion, startedAt, batch.sync,
        batch.kind === 'receipt' ? 'receipt' : 'read',
      )
      const elapsedMs = input.now() - startedAt
      if (result.committed) {
        // #1931：这一批「提交了、但没全写」的两种情形都用既有的 detail 键说清楚（不新增日志字段）：
        //   same-second-tie —— 回执的更新时间与库里持平，按到达序写了，排查时能解释「为什么这条没变」；
        //   skipped-groups   —— 有组被版本门按组跳过，库里那几组比这一趟读的更新。
        // 两者同时出现时记 same-second-tie：它更少见，也更能解释一次看起来没变化的提交。
        const ingestDetail = result.sameSecondTie ? 'same-second-tie' : (result.skippedGroups ? 'skipped-groups' : undefined)
        input.logEvent?.('info', 'workspaceSnapshot.ingest', {
          committed: true,
          writes: batch.writes.length,
          startMergeVersion: batch.startMergeVersion,
          mergeVersion: result.mergeVersion,
          elapsedMs,
          ...(ingestDetail ? { detail: ingestDetail } : null),
        })
        return {
          committed: true,
          mergeVersion: result.mergeVersion as number,
          commentPositions: result.commentPositions,
          ...(result.sync ? { sync: result.sync } : null),
          // 两格「这一批其实没全写」的坦白（#1931）：上层与排查都要知道到底发生了什么，
          // 而不是拿一个 committed:true 去猜「是不是全都写进去了」。
          ...(result.skippedGroups !== undefined ? { skippedGroups: result.skippedGroups } : null),
          ...(result.sameSecondTie ? { sameSecondTie: true } : null),
        }
      }
      const reason = result.reason ?? 'write-failed'
      input.logEvent?.(reason === 'stale' ? 'warn' : 'error', 'workspaceSnapshot.ingest', {
        committed: false,
        reason,
        writes: batch.writes.length,
        startMergeVersion: batch.startMergeVersion,
        detail: result.detail,
        elapsedMs,
      })
      return { committed: false, reason, detail: result.detail }
    },
    writeSyncBookkeeping(write: SyncBookkeepingWrite): SyncBookkeepingResult {
      input.assertOpen()
      const db = input.db()
      if (input.mode() !== 'writable') {
        return { committed: false, state: readSyncBookkeepingRow(db), reason: 'readonly' }
      }
      if (input.legacyWriteBlocked()) {
        return { committed: false, state: readSyncBookkeepingRow(db), reason: 'legacy-writer' }
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
      input.assertOpen()
      const db = input.db()
      if (input.mode() !== 'writable') {
        input.logEvent?.('warn', 'workspaceSnapshot.ingest', {
          committed: false,
          reason: 'readonly',
          mergeVersion: readMergeVersion(db),
        })
        return { committed: false, reason: 'readonly', mergeVersion: readMergeVersion(db), marked: 0 }
      }
      if (input.legacyWriteBlocked()) {
        return { committed: false, reason: 'legacy-writer', mergeVersion: readMergeVersion(db), marked: 0 }
      }
      return markMissingTickets(db, entries, startMergeVersion, input.now())
    },
  }
}
