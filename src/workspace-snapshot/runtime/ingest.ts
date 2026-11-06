// runtime/ingest.ts —— 一批读结果在一个事务里落库。
//
// 写路径照规格第 5 节（#1931 起冲突规则按组判）：
//   1. 事务外拿到调用方给的 startMergeVersion（它读数据时的版本）；
//   2. BEGIN IMMEDIATE 拿写锁，再做同步世代门：期望世代号与库里不符时整批丢弃，库一个字节不改；
//   3. 版本门按组跳过：某组的 written_version 大于起点时只跳过那一组，同批其余组照写（#1931）；
//   4. 回执优先窗口（#1889）：这批是「读结果」时，回执表达过、且还在窗口内的组一律不写 ——
//      版本门挡不住「写之后才开始、却带着写之前远端状态」的那一趟读，这一道挡它（见 merge/receipt-priority.ts）；
//   5. 行组严格时间（#1931）：读结果的 row 组只在更新时间严格更新时才覆盖；写回执更旧时整票都不写；
//   6. 按组合并（complete 覆盖/清空、truncated 只补缺、unknown 不动值），每组盖三态章；
//   7. merge_version + 1、last_write_ms 更新，COMMIT。失败整段 ROLLBACK。
//
// 为什么先版本门再合并：合并会改 written_version，先合并会让「自己写进去的版本」骗过门。
// 为什么每一组都盖章：三态存在 issue_group 而不是 issue 行上，没盖章的组下次会被当成
// 「从没取过」，界面就会把刚拿到的 truncated 当成不知道。
// 为什么「全部组都被挡下」时不推进版本：什么都没写却加版本，会让界面以为有变化，也会让别人手里的
// startMergeVersion 提前过期；被挡下的原因有版本门、回执窗口、行组时间三种，行为一致。
//
// 具体列的写法在 persistence/issue-row-write.ts 与 persistence/issue-groups-write.ts；逐组的写入
// 搬到了 runtime/ingest-apply.ts（单文件 350 有效行的门禁，行为不变）。本文件只负责事务、世代门、
// 版本门（按组）、回执优先窗口、行组时间与身份，方便一眼看清「一批要么全进、要么全不进」以及
// 「哪些组会因为过期被单独跳过」。
import type { DatabaseSync } from 'node:sqlite'
import type { IssueWrite, SyncBookkeeping, SyncBookkeepingWrite } from '../contract/types.js'
import { SNAPSHOT_RECEIPT_PRIORITY_MS } from '../../shared/time-config/src/values.js'
import { normalizeReceiptWindowMs, shouldDeferReadGroup } from '../merge/receipt-priority.js'
import type { ReceiptCompleteness, ReceiptGroupName } from '../merge/receipt-priority.js'
import { decideRowMerge, normalizeRowTimeMs, shouldApplyRowTime } from '../merge/row.js'
import { isGroupStale, normalizeStartMergeVersion } from '../merge/version-gate.js'
import { readMergeVersion } from '../persistence/schema.js'
import { applySyncBookkeepingRow, readSyncBookkeepingRow } from '../persistence/sync-bookkeeping.js'
import { applyIssueWrite, type IngestGroupName } from './ingest-apply.js'

/** 写入批次的来路：读结果（默认，要过回执优先窗口）或写回执（自己就是回执，不受窗口约束）。 */
export type IngestBatchKind = 'read' | 'receipt'

/** 本批实际表达的组。没出现的组不参与版本门，也不盖章。 */
interface ExpressedGroup {
  write: IssueWrite
  group: IngestGroupName
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
  /** 这一批里被版本门按组跳过的组数（#1931）；0 或没有这一格表示一组都没被跳过。 */
  skippedGroups?: number
  /**
   * 真的写下去的写回执里，有哪一张票的更新时间与库里持平（#1931）。只在「按到达序写了」时出现，
   * 供排查解释一次「看起来没变的更新」：后端的更新时间精度有限，同一毫秒里两次写只能按到达顺序判。
   */
  sameSecondTie?: boolean
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
    // 世代门（#1888）：调用方发起这一趟时读到的世代号，与库里此刻的不一样，说明期间有更新的结果
    // 先落了地。这一批（行与簿记）整批丢弃 —— 迟到的结果不许覆盖更新的结果。
    // #1931 起这是唯一还会整批回 stale 的门：数据组过不过期按组判（见下面的 isGroupStale），
    // 而「这一趟结果整体比库里的旧」是另一件事，不能拆成按组。
    const currentSync = readSyncBookkeepingRow(db)
    if (syncWrite && syncWrite.expectedGeneration !== undefined && Number(syncWrite.expectedGeneration) !== currentSync.generation) {
      db.exec('ROLLBACK')
      return { committed: false, reason: 'stale', detail: 'generation' }
    }

    // 一次查询就把每组状态读回来：written_version 给版本门，receipt_ms 给回执优先窗口。
    const states = expressed.map((item) => ({ item, state: readGroupState(db, item) }))

    // 这一批里「跳过不写」的组。三种来源都放进同一张表：版本门挡下的、回执优先窗口挡下的、
    // 行组时间挡下的。一张表的好处是「这一组到底写不写」只有一个答案，
    // 版本号推进的判断（anyApplicable）与真正的写入用的是同一份结论。
    let skippedGroups = 0
    const blocked = new Map<IssueWrite, Set<IngestGroupName>>()
    const blockGroup = (item: ExpressedGroup): void => {
      const set = blocked.get(item.write)
      if (set) set.add(item.group)
      else blocked.set(item.write, new Set([item.group]))
    }
    /** 这一张票这一批一个组都不写。写回执被时间挡下时用它：旧回执不许擦掉更新的回执写下的任何一组。 */
    const blockWrite = (write: IssueWrite): void => {
      for (const entry of expressed) {
        if (entry.write === write) blockGroup(entry)
      }
    }
    /** 回执与库里更新时间持平：写下去，但记下「同秒已知局限」，排查时能解释一次看起来没变的更新。 */
    let sameSecondTie = false
    let deferredGroups = 0
    // 版本门按组跳过（#1931）：只跳过真正过期的那几组，同批其余组照写。
    // 全部组都被跳过时这一批仍然 committed:true、版本不前进 —— 因为什么都没写，没有「变化」可言；
    // 回 reason:'stale' 会让调用方重试，而重试带回来的还是同一份旧数据。
    for (const entry of states) {
      if (!isGroupStale(startMergeVersion, entry.state.writtenVersion)) continue
      skippedGroups += 1
      blockGroup(entry.item)
    }
    if (!isReceipt) {
      // 回执优先窗口：读结果里那些「回执表达过、且还在窗口内」的组跳过不写（按组判，不整条挡）。
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
        blockGroup(item)
      }
      // 行组严格时间（#1931）：读结果的 row 组只在「来者的 updatedAt 严格新于库里已存」时才写。
      // 为什么只挡 row 这一组：正文、标签、指派、边各自是别的组，它们没有可比的后端时间；
      // 这一趟读结果带回来的标签仍然可能是当前的真状态（反例见 merge/row.ts 的 shouldApplyRowTime）。
      // 被时间挡下的组不写值、也不盖章 —— 盖章会把「这次取过」的时刻推新，界面会以为刚重新确认过。
      for (const entry of states) {
        const { item } = entry
        if (item.group !== 'row' || isBlocked(blocked, item)) continue
        const rowWrite = item.write.groups.row
        if (!rowWrite) continue
        // 只有真的会写行的两种决定（replace / fill）才查时间。另外两种不算「覆盖」：
        //   remove（complete + null）写的是墓碑，不是行，归版本门与回执窗口管；
        //   keep（unknown、或 truncated 什么都没拿到）只盖章不动值 —— 挡它等于丢掉「这次问过、但不知道」
        //   这条信息，而它恰恰是界面区分「不知道」与「确认没有」的依据。
        const rowDecision = decideRowMerge(null, rowWrite)
        if (rowDecision.kind === 'remove' || rowDecision.kind === 'keep') continue
        const incomingMs = rowWrite.value ? rowWrite.value.updatedAtMs : null
        if (shouldApplyRowTime(incomingMs, readStoredUpdatedAtMs(db, item.write), 'read')) continue
        blockGroup(item)
      }
    } else {
      // 写回执的行组时间（#1931）：回执比库里更旧时，这一张票这一笔回执一个组都不写 ——
      // 旧回执（重放、延迟的重试）不许撤销更新的回执；只跳过 row 组会把它的标签、边一起写旧。
      // 回执持平要写：回执是「我刚把它改成了这样」的结论，同一毫秒里两次回执只能按到达顺序落。
      for (const write of writes) {
        const writeRow = write.groups.row
        if (!writeRow) continue
        if (isBlocked(blocked, { write, group: 'row' })) continue
        // 与读结果同一口径：只有真会写行的决定才查时间；remove 写墓碑，keep 只盖章。
        const writeDecision = decideRowMerge(null, writeRow)
        if (writeDecision.kind === 'remove' || writeDecision.kind === 'keep') continue
        const incomingMs = normalizeRowTimeMs(writeRow.value ? writeRow.value.updatedAtMs : null)
        const existingMs = readStoredUpdatedAtMs(db, write)
        if (!shouldApplyRowTime(incomingMs, existingMs, 'receipt')) {
          blockWrite(write)
          continue
        }
        if (incomingMs !== null && existingMs !== null && incomingMs === existingMs) sameSecondTie = true
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
        // #1885 评审修复：这一笔本身就是「确认不存在」时不能清（刚写进去的墓碑会被自己抹掉）。
        const expressesRemoval = write.groups.row !== undefined
          && write.groups.row.completeness === 'complete'
          && (write.groups.row.value === null || write.groups.row.value === undefined)
        if (!expressesRemoval) clearTombstone.run(write.effortId, write.key)
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
      ...(skippedGroups > 0 ? { skippedGroups } : null),
      ...(sameSecondTie ? { sameSecondTie: true } : null),
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

/** 库里这张票现在的行更新时间；票不存在、列是 NULL 或坏值都回 null（= 这一趟不知道）。 */
function readStoredUpdatedAtMs(db: DatabaseSync, write: IssueWrite): number | null {
  const row = db.prepare('SELECT updated_at_ms AS updated_at_ms FROM issue WHERE effort_id = ? AND key = ?')
    .get(write.effortId, write.key) as { updated_at_ms?: number | null } | null
  if (!row) return null
  return normalizeRowTimeMs(row.updated_at_ms)
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
function completenessOf(write: IssueWrite, group: IngestGroupName): ReceiptCompleteness {
  if (group === 'comments' && write.groups.comments === undefined && write.groups.commentReceipt !== undefined) {
    return write.groups.commentReceipt.completeness
  }
  const value = (write.groups as Record<string, { completeness?: ReceiptCompleteness } | undefined>)[group]
  return value && value.completeness ? value.completeness : 'complete'
}

/** 给上层与门禁用：一张票一组都没表达时算空批。 */
export function batchHasExpressedGroups(writes: readonly IssueWrite[]): boolean {
  return collectExpressedGroups(writes).length > 0
}

