// runtime/read-ports.ts —— 句柄的读口（#1932 从 open.ts 拆出）
//
// 为什么单列：open.ts 要讲清「开库、判存储类别、决定写模型、装配句柄」这条主干，再把六条读口
// 塞进去就超过单文件 350 有效行的门禁（tests/verify-file-granularity.ts）。读口本身不碰写权、
// 不碰租约：库是唯一真相，只读句柄也能读，所以它们可以整体搬出来，行为一个字不变。
//
// 一条约定：db 用取数函数传入而不是直接传连接。整库重建会换掉连接，任何闭包在重建之后都必须
// 读得到新的那一条 —— 传死连接会让重建后的第一次读打到已经关掉的库上。
import type { DatabaseSync } from 'node:sqlite'
import type {
  ChangeSetProjection,
  ChangeSetQuery,
  ContainerProjection,
  ContainerProjectionQuery,
  IssueDetailProjection,
  IssueDetailQuery,
  ListProjection,
  ListQuery,
  SnapshotCounts,
  SnapshotStorageKind,
  SnapshotStorageStats,
} from '../contract/types.js'
import type { ReadStepHook } from '../projection/read-step.js'
import { readMergeVersion } from '../persistence/schema.js'
import { readContainerProjection, readListProjection } from '../projection/list.js'
import { readIssueDetailProjection } from '../projection/detail.js'
import { readChangeSetProjection } from '../projection/changes.js'
import { readCountsProjection } from '../projection/counts.js'
import { readStorageStats } from './storage-stats.js'

export interface ReadPortsInput {
  /** 当前连接；重建会换连接，所以每次读都现取。 */
  db: () => DatabaseSync
  dbPath: string
  storageKind: SnapshotStorageKind
  now: () => number
  onReadStep?: ReadStepHook
  /** 关库之后不许再读（与写口共用同一道闸）。 */
  assertOpen: () => void
}

export interface ReadPorts {
  getMergeVersion(): number
  readCounts(): SnapshotCounts
  readStorageStats(): SnapshotStorageStats
  readList(query?: ListQuery): ListProjection
  readIssueDetail(query: IssueDetailQuery): IssueDetailProjection
  readContainerProjection(query: ContainerProjectionQuery): ContainerProjection
  readChangeSet(query: ChangeSetQuery): ChangeSetProjection
}

/** 装配六条读口。全部只读、不改库，只读句柄也照常可用。 */
export function createReadPorts(input: ReadPortsInput): ReadPorts {
  return {
    getMergeVersion(): number {
      input.assertOpen()
      return readMergeVersion(input.db())
    },
    readCounts(): SnapshotCounts {
      input.assertOpen()
      return readCountsProjection(input.db(), input.onReadStep)
    },
    readStorageStats(): SnapshotStorageStats {
      input.assertOpen()
      return readStorageStats(input.db(), input.dbPath, input.storageKind)
    },
    readList(query?: ListQuery): ListProjection {
      input.assertOpen()
      return readListProjection(input.db(), query, input.now(), input.onReadStep)
    },
    readIssueDetail(query: IssueDetailQuery): IssueDetailProjection {
      input.assertOpen()
      return readIssueDetailProjection(input.db(), query, input.now(), input.onReadStep)
    },
    readContainerProjection(query: ContainerProjectionQuery): ContainerProjection {
      input.assertOpen()
      return readContainerProjection(input.db(), query, input.now(), input.onReadStep)
    },
    readChangeSet(query: ChangeSetQuery): ChangeSetProjection {
      input.assertOpen()
      return readChangeSetProjection(input.db(), query, input.now(), input.onReadStep)
    },
  }
}
