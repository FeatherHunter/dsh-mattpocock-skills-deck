// runtime/ingest.ts —— 一批读结果在一个事务里落库。
//
// 写路径照规格第 5 节：
//   1. 事务外拿到调用方给的 startMergeVersion（它读数据时的版本）；
//   2. BEGIN IMMEDIATE 拿写锁，先做版本门：本批表达的组里任一 written_version 大于起点，
//      说明期间有别人先提交过，整批丢弃，库一个字节不改；
//   3. 回执优先窗口（#1889）：这批是「读结果」时，回执表达过、且还在窗口内的组一律不写 ——
//      版本门挡不住「写之后才开始、却带着写之前远端状态」的那一趟读，这一道挡它（见 merge/receipt-priority.ts）；
//   4. 按组合并（complete 覆盖/清空、truncated 只补缺、unknown 不动值），每组盖三态章；
//   5. merge_version + 1、last_write_ms 更新，COMMIT。失败整段 ROLLBACK。
//
// 为什么先版本门再合并：合并会改 written_version，先合并会让「自己写进去的版本」骗过门。
// 为什么每一组都盖章：三态存在 issue_group 而不是 issue 行上，没盖章的组下次会被当成
// 「从没取过」，界面就会把刚拿到的 truncated 当成不知道。
// 为什么「全部组都被窗口挡下」时不推进版本：什么都没写却加版本，会让界面以为有变化。
//
// 具体列的写法在 persistence/issue-row-write.ts 与 persistence/issue-groups-write.ts；
// 这里只负责事务、版本门、回执优先窗口、身份与盖章，方便一眼看清「一批要么全进、要么全不进」。
import type { DatabaseSync } from 'node:sqlite'
import type { GroupWrite, IssueWrite, SyncBookkeeping, SyncBookkeepingWrite } from '../contract/types.js'
import { SNAPSHOT_RECEIPT_PRIORITY_MS } from '../../shared/time-config/src/values.js'
import { normalizeReceiptWindowMs, shouldDeferReadGroup } from '../merge/receipt-priority.js'
import type { ReceiptCompleteness, ReceiptGroupName } from '../merge/receipt-priority.js'
import { decideRowMerge } from '../merge/row.js'
import { normalizeStartMergeVersion, shouldDiscardBatch } from '../merge/version-gate.js'
import { applyIssueEdges } from '../persistence/issue-edge-write.js'
import { applyIssueBody } from '../persistence/issue-body-write.js'
import { applyIssueAssignees, applyIssueLabels } from '../persistence/issue-groups-write.js'
import { ensureIssueId, findIssueId } from '../persistence/issue-identity-write.js'
import { fillIssueRow, replaceIssueRow } from '../persistence/issue-row-write.js'
import { applyIssueMergeInfo, applyIssueSubIssues } from '../persistence/issue-scalar-write.js'
import { applyIssueComments, applyCommentReceipt } from '../persistence/comment-write.js'
import { applyIssueReviews } from '../persistence/review-write.js'
import { readMergeVersion } from '../persistence/schema.js'
import { applySyncBookkeepingRow, readSyncBookkeepingRow } from '../persistence/sync-bookkeeping.js'

/** 各组在 issue_group 里的物理名字。组名是对外契约的一部分，不要在这里改成别的写法。 */
const GROUP_ROW = 'row'
const GROUP_BODY = 'body'
const GROUP_LABELS = 'labels'
const GROUP_ASSIGNEES = 'assignees'
const GROUP_PARENTS = 'parents'
const GROUP_BLOCKED_BY = 'blockedBy'
const GROUP_SUB_ISSUES = 'subIssues'
const GROUP_MERGE_INFO = 'mergeInfo'
const GROUP_COMMENTS = 'comments'
const GROUP_REVIEW = 'review'

/** 写入批次的来路：读结果（默认，要过回执优先窗口）或写回执（自己就是回执，不受窗口约束）。 */
export type IngestBatchKind = 'read' | 'receipt'

/** 本批实际表达的组。没出现的组不参与版本门，也不盖章。 */
interface ExpressedGroup {
  write: IssueWrite
  group:
    | 'row'
    | 'body'
    | 'labels'
    | 'assignees'
    | 'parents'
    | 'blockedBy'
    | 'subIssues'
    | 'mergeInfo'
    | 'comments'
    | 'review'
}

/** 一组在库里的两格状态：上次写入版本（版本门用）与上次回执写入时刻（回执优先窗口用）。 */
interface GroupState {
  writtenVersion: number | null
  receiptMs: number | null
}

export interface IngestWritesResult {
  committed: boolean
  mergeVersion?: number
  reason?: 'stale' | 'write-failed'
  detail?: string
  /** 这一批里评论写回执落在第几位（#1866）；没表达过这一组时是空数组。 */
  commentPositions?: number[]
  /**
   * 这一批顺带写下的同步簿记（#1888）。只有调用方给了 batch.sync 才有 —— 给了就说明这一趟
   * 行与簿记在同一个事务里，行写进去了，水印/世代号/待办也一定跟着写了。
   */
  sync?: SyncBookkeeping
  /** 这一批里被回执优先窗口挡下的组数（#1889）；0 或没有这一格表示一组都没被挡。 */
  deferredGroups?: number
}

/**
 * 把一批写入落库。调用方负责判断句柄是否可写；这里只管事务。
 *
 * kind 缺省是 'read'：读结果要过回执优先窗口。写回执传 'receipt'，它自己就是回执，
 * 不受窗口约束，提交时给每一组盖 receipt_ms（窗口从这个时刻重新算）。
 *
 * 空批（没有任何组表达）直接返回当前版本，不开事务：没有东西可写，bump 版本只会让
 * 别人的 startMergeVersion 提前过期。
 */
export function ingestWrites(
  db: DatabaseSync,
  writes: readonly IssueWrite[],
  rawStartMergeVersion: number,
  nowMs: number,
  syncWrite?: SyncBookkeepingWrite | null,
  kind: IngestBatchKind = 'read',
): IngestWritesResult {
  const startMergeVersion = normalizeStartMergeVersion(rawStartMergeVersion)
  const expressed = collectExpressedGroups(writes)
  // 空批：没有行要写、也没有簿记要写，直接回当前版本。什么都不开事务 —— 白占一次写锁不说，
  // 还会让别人的 startMergeVersion 误以为「有人提交过」。
  if (expressed.length === 0 && !syncWrite) {
    return { committed: true, mergeVersion: readMergeVersion(db) }
  }

  const isReceipt = kind === 'receipt'
  const windowMs = normalizeReceiptWindowMs(SNAPSHOT_RECEIPT_PRIORITY_MS)

  db.exec('BEGIN IMMEDIATE')
  try {
    // 一次查询就把两组状态读回来：written_version 给版本门，receipt_ms 给回执优先窗口。
    const states = expressed.map((item) => ({ item, state: readGroupState(db, item) }))
    const writtenVersions = states
      .map((entry) => entry.state.writtenVersion)
      .filter((value): value is number => value !== null)
    if (shouldDiscardBatch(startMergeVersion, writtenVersions)) {
      db.exec('ROLLBACK')
      return { committed: false, reason: 'stale' }
    }

    // 世代门（#1888）：调用方发起这一趟时读到的世代号，与库里此刻的不一样，说明期间有更新的结果
    // 先落了地。这一批（行与簿记）整批丢弃 —— 迟到的结果不许覆盖更新的结果。
    const currentSync = readSyncBookkeepingRow(db)
    if (syncWrite && syncWrite.expectedGeneration !== undefined && Number(syncWrite.expectedGeneration) !== currentSync.generation) {
      db.exec('ROLLBACK')
      return { committed: false, reason: 'stale', detail: 'generation' }
    }

    // 回执优先窗口：读结果里那些「回执表达过、且还在窗口内」的组跳过不写（按组判，不整条挡）。
    const blocked = new Map<IssueWrite, Set<ExpressedGroup['group']>>()
    let deferredGroups = 0
    if (!isReceipt) {
      for (const entry of states) {
        const { item, state } = entry
        const defer = shouldDeferReadGroup({
          receiptMs: state.receiptMs,
          nowMs,
          windowMs,
          group: item.group as ReceiptGroupName,
          completeness: completenessOf(item.write, item.group),
        })
        if (!defer) continue
        deferredGroups += 1
        const set = blocked.get(item.write)
        if (set) set.add(item.group)
        else blocked.set(item.write, new Set([item.group]))
      }
    }

    // 版本号只由「真的写了行」推进：只写簿记的那一趟不动 merge_version，否则每一拍探测都会让
    // 别人手里的 startMergeVersion 提前过期。全部组都被窗口挡下时也不动版本：什么都没写。
    const anyApplicable = expressed.some((item) => !isBlocked(blocked, item))
    let nextVersion = readMergeVersion(db)
    const commentPositions: number[] = []
    if (expressed.length > 0 && anyApplicable) {
      nextVersion += 1
      const bumpChangeVersion = db.prepare('UPDATE issue SET last_change_version = ? WHERE effort_id = ? AND key = ?')
      const clearTombstone = db.prepare('DELETE FROM issue_tombstone WHERE issue_id = (SELECT issue_id FROM issue WHERE effort_id = ? AND key = ?)')
      for (const write of writes) {
        const applied = applyIssueWrite(db, write, nowMs, nextVersion, {
          isReceipt,
          blocked: blocked.get(write) || null,
        })
        if (applied.receiptPosition !== null) commentPositions.push(applied.receiptPosition)
        // 一组都没写进去的票不算「变过」：别推它的变化版本，也别清它的墓碑。
        if (applied.appliedGroups === 0) continue
        // 这一批写过哪张票，就把它的「最后变化版本」推到这个版本：变化集靠它回答「v12 之后变了哪几行」。
        bumpChangeVersion.run(nextVersion, write.effortId, write.key)
        // 重新出现的票把墓碑清掉——墓碑只表达「这一版里它不在」，不是永久判决。
        clearTombstone.run(write.effortId, write.key)
      }
      db.prepare('UPDATE meta SET merge_version = ?, last_write_ms = ? WHERE id = 1')
        .run(nextVersion, nowMs)
    }
    // 簿记与行在同一个事务里提交：先写行、后写簿记，COMMIT 一落两者一起可见。
    const appliedSync = applySyncBookkeepingRow(db, syncWrite, currentSync)
    if (!appliedSync.committed) {
      db.exec('ROLLBACK')
      return { committed: false, reason: 'stale', detail: 'generation' }
    }
    db.exec('COMMIT')
    return {
      committed: true,
      mergeVersion: nextVersion,
      commentPositions,
      ...(syncWrite ? { sync: appliedSync.state } : null),
      ...(deferredGroups > 0 ? { deferredGroups } : null),
    }
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 事务可能已因约束错误自动回滚 */ }
    return {
      committed: false,
      reason: 'write-failed',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

/** 这一批「实际表达了」的组：只有 groups 里出现且不为 undefined 的才算。 */
function collectExpressedGroups(writes: readonly IssueWrite[]): ExpressedGroup[] {
  const out: ExpressedGroup[] = []
  for (const write of writes) {
    if (write.groups.row !== undefined) out.push({ write, group: 'row' })
    if (write.groups.body !== undefined) out.push({ write, group: 'body' })
    if (write.groups.labels !== undefined) out.push({ write, group: 'labels' })
    if (write.groups.assignees !== undefined) out.push({ write, group: 'assignees' })
    if (write.groups.parents !== undefined) out.push({ write, group: 'parents' })
    if (write.groups.blockedBy !== undefined) out.push({ write, group: 'blockedBy' })
    if (write.groups.subIssues !== undefined) out.push({ write, group: 'subIssues' })
    if (write.groups.mergeInfo !== undefined) out.push({ write, group: 'mergeInfo' })
    if (write.groups.comments !== undefined) out.push({ write, group: 'comments' })
    // 写回执那一条评论与评论组是同一张表、同一个组名（#1866）：版本门与三态章都按评论组算。
    if (write.groups.commentReceipt !== undefined) out.push({ write, group: 'comments' })
    if (write.groups.review !== undefined) out.push({ write, group: 'review' })
  }
  return out
}

/** 读某张票某一组在库里的两格状态；票或组不存在都回空（从没写过，版本门与窗口都不管）。 */
function readGroupState(db: DatabaseSync, item: ExpressedGroup): GroupState {
  const row = db.prepare(
    `SELECT g.written_version AS written_version, g.receipt_ms AS receipt_ms
       FROM issue i
       JOIN issue_group g ON g.issue_id = i.issue_id
      WHERE i.effort_id = ? AND i.key = ? AND g.group_name = ?`,
  ).get(item.write.effortId, item.write.key, item.group) as
    | { written_version?: number, receipt_ms?: number | null }
    | null
  if (!row) return { writtenVersion: null, receiptMs: null }
  const version = row.written_version === null || row.written_version === undefined ? null : Number(row.written_version)
  const receipt = row.receipt_ms === null || row.receipt_ms === undefined ? null : Number(row.receipt_ms)
  return { writtenVersion: version, receiptMs: receipt }
}

/** 这一组这一批是不是被回执优先窗口挡下了。 */
function isBlocked(
  blocked: Map<IssueWrite, Set<ExpressedGroup['group']>>,
  item: ExpressedGroup,
): boolean {
  const set = blocked.get(item.write)
  return !!set && set.has(item.group)
}

/**
 * 这一批对这一组的完整度。写回执那一条（commentReceipt）自己带着完整度，
 * 其余组读 groups 里那一份；缺省按 complete（不会出现在这个位置，兜底只为不抛错）。
 */
function completenessOf(write: IssueWrite, group: ExpressedGroup['group']): ReceiptCompleteness {
  if (group === 'comments' && write.groups.comments === undefined && write.groups.commentReceipt !== undefined) {
    return write.groups.commentReceipt.completeness
  }
  const value = (write.groups as Record<string, { completeness?: ReceiptCompleteness } | undefined>)[group]
  return value && value.completeness ? value.completeness : 'complete'
}

interface ApplyIssueWriteOptions {
  /** 这一批是写回执：每组盖 receipt_ms（窗口从这次提交重新算）。 */
  isReceipt: boolean
  /** 被回执优先窗口挡下的组；没有就用 null。 */
  blocked: Set<ExpressedGroup['group']> | null
}

interface AppliedIssueWrite {
  /** 评论写回执落在第几位；没表达这一组时是 null。 */
  receiptPosition: number | null
  /** 这一张票这次真的写进去了几组（0 = 全被挡下，或只表达了 row=null 而票不存在）。 */
  appliedGroups: number
}

/**
 * 落一张票表达的所有组。row 组 complete+null 是「确认不存在」，删掉后不再处理同批的其它组。
 *
 * 被回执优先窗口挡下的组整组跳过（不写值、也不盖章）：盖章会把「这次取过」的时刻推新，
 * 让界面以为这一组刚被重新确认过。
 *
 * 回值只有评论写回执与「这张票到底写进去几组」用得上。
 */
function applyIssueWrite(
  db: DatabaseSync,
  write: IssueWrite,
  nowMs: number,
  version: number,
  options: ApplyIssueWriteOptions,
): AppliedIssueWrite {
  if (typeof write.effortId !== 'string') throw new Error('写入缺少 effortId')
  if (typeof write.key !== 'string' || write.key.length === 0) throw new Error('写入缺少 key')

  const blocked = options.blocked
  const receiptMs = options.isReceipt ? nowMs : null
  const open = (group: ExpressedGroup['group']): boolean => !blocked || !blocked.has(group)
  let appliedGroups = 0
  const applied = (): void => { appliedGroups += 1 }

  const { row, body, labels, assignees, parents, blockedBy, subIssues, mergeInfo, comments, review, commentReceipt } = write.groups
  let receiptPosition: number | null = null
  if (row !== undefined && open('row')) {
    const decision = decideRowMerge(null, row)
    if (decision.kind === 'remove') {
      const existingId = findIssueId(db, write.effortId, write.key)
      if (existingId !== null) { db.prepare('DELETE FROM issue WHERE issue_id = ?').run(existingId); applied() }
      return { receiptPosition, appliedGroups }
    }
    const issueId = ensureIssueId(db, write.effortId, write.key, nowMs)
    if (decision.kind === 'replace') {
      replaceIssueRow(db, issueId, decision.value, nowMs)
    } else if (decision.kind === 'fill') {
      fillIssueRow(db, issueId, decision.value, nowMs)
    }
    stampGroup(db, issueId, GROUP_ROW, row, nowMs, version, receiptMs)
    applied()
  }

  if (body !== undefined && open('body')) {
    const issueId = ensureIssueId(db, write.effortId, write.key, nowMs)
    applyIssueBody(db, issueId, body)
    stampGroup(db, issueId, GROUP_BODY, body, nowMs, version, receiptMs)
    applied()
  }

  if (labels !== undefined && open('labels')) {
    const issueId = ensureIssueId(db, write.effortId, write.key, nowMs)
    applyIssueLabels(db, issueId, labels)
    stampGroup(db, issueId, GROUP_LABELS, labels, nowMs, version, receiptMs)
    applied()
  }

  if (assignees !== undefined && open('assignees')) {
    const issueId = ensureIssueId(db, write.effortId, write.key, nowMs)
    applyIssueAssignees(db, issueId, assignees)
    stampGroup(db, issueId, GROUP_ASSIGNEES, assignees, nowMs, version, receiptMs)
    applied()
  }

  // 两组边：先保证 subject 自己有代理键，再把目标票解析成 id。骨架行也算「见过」。
  if (parents !== undefined && open('parents')) {
    const issueId = ensureIssueId(db, write.effortId, write.key, nowMs)
    applyIssueEdges(db, issueId, write.effortId, 'parent', parents, nowMs)
    stampGroup(db, issueId, GROUP_PARENTS, parents, nowMs, version, receiptMs)
    applied()
  }

  if (blockedBy !== undefined && open('blockedBy')) {
    const issueId = ensureIssueId(db, write.effortId, write.key, nowMs)
    applyIssueEdges(db, issueId, write.effortId, 'blocks', blockedBy, nowMs)
    stampGroup(db, issueId, GROUP_BLOCKED_BY, blockedBy, nowMs, version, receiptMs)
    applied()
  }

  if (subIssues !== undefined && open('subIssues')) {
    const issueId = ensureIssueId(db, write.effortId, write.key, nowMs)
    applyIssueSubIssues(db, issueId, subIssues)
    stampGroup(db, issueId, GROUP_SUB_ISSUES, subIssues, nowMs, version, receiptMs)
    applied()
  }

  if (mergeInfo !== undefined && open('mergeInfo')) {
    const issueId = ensureIssueId(db, write.effortId, write.key, nowMs)
    applyIssueMergeInfo(db, issueId, mergeInfo)
    stampGroup(db, issueId, GROUP_MERGE_INFO, mergeInfo, nowMs, version, receiptMs)
    applied()
  }

  // 评论要同时推进「取到第几条」的游标，所以把写入时刻一起交下去（游标行的 updated_ms 用它）。
  if (comments !== undefined && open('comments')) {
    const issueId = ensureIssueId(db, write.effortId, write.key, nowMs)
    applyIssueComments(db, issueId, comments, nowMs)
    stampGroup(db, issueId, GROUP_COMMENTS, comments, nowMs, version, receiptMs)
    applied()
  }

  if (review !== undefined && open('review')) {
    const issueId = ensureIssueId(db, write.effortId, write.key, nowMs)
    applyIssueReviews(db, issueId, review)
    stampGroup(db, issueId, GROUP_REVIEW, review, nowMs, version, receiptMs)
    applied()
  }

  // 评论写回执（#1866）：只追加刚发的那一条，不当作一页，也不推进游标（除非这一组本来就完整）。
  if (commentReceipt !== undefined && open('comments')) {
    const issueId = ensureIssueId(db, write.effortId, write.key, nowMs)
    receiptPosition = applyCommentReceipt(db, issueId, commentReceipt, nowMs)
    stampGroup(db, issueId, GROUP_COMMENTS, commentReceipt, nowMs, version, receiptMs)
    applied()
  }

  return { receiptPosition, appliedGroups }
}

/**
 * 盖三态章。written_version 写本批的新版本：下一批只要起点比它小就会被版本门挡住。
 * last_queried_ms 用注入时钟，测试可以精确断言。
 *
 * receipt_ms 只在写回执那一趟更新（传 nowMs）；读结果传 null 时保留旧值 ——
 * 已经开始的窗口不会被一次「没被挡住」的覆盖提前结束，也不会被其它组的写入清掉。
 */
function stampGroup(
  db: DatabaseSync,
  issueId: number,
  groupName: string,
  write: { completeness: string, reason?: string | null, source?: string | null, operation?: string | null },
  nowMs: number,
  version: number,
  receiptMs: number | null,
): void {
  db.prepare(
    `INSERT INTO issue_group (
       issue_id, group_name, completeness, reason, source, operation,
       last_queried_ms, written_version, receipt_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(issue_id, group_name) DO UPDATE SET
       completeness = excluded.completeness,
       reason = excluded.reason,
       source = excluded.source,
       operation = excluded.operation,
       last_queried_ms = excluded.last_queried_ms,
       written_version = excluded.written_version,
       receipt_ms = CASE WHEN excluded.receipt_ms IS NULL THEN issue_group.receipt_ms ELSE excluded.receipt_ms END`,
  ).run(
    issueId,
    groupName,
    write.completeness,
    write.reason ?? null,
    write.source ?? null,
    write.operation ?? null,
    nowMs,
    version,
    receiptMs,
  )
}

/** 给上层与门禁用：一张票一组都没表达时算空批。 */
export function batchHasExpressedGroups(writes: readonly IssueWrite[]): boolean {
  return collectExpressedGroups(writes).length > 0
}
