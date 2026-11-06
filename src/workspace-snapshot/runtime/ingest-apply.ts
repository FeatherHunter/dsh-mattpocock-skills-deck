// runtime/ingest-apply.ts —— 把一张票表达的组真正写进库（#1931 从 ingest.ts 拆出）
//
// 为什么单列：ingest.ts 要讲清「一批写入在一个事务里怎么判过期、怎么合并」，再把逐组的
// applyIssueWrite 塞进去就超过单文件 350 有效行的门禁（tests/verify-file-granularity.ts）。
// 拆开之后 ingest.ts 只留事务、版本门、回执窗口与行组时间；本文件只做「给定这一张票、这一版、
// 这份 blocked 集合，把该写的组写下去」。
//
// 三条约定不能改：
//   1. 被挡下的组整组跳过：不写值、也不盖章。盖章会把「这次取过」的时刻推新，界面会以为这一组
//      刚被重新确认过（#1889、#1931）。
//   2. row 组 complete + null 是「确认不存在」：写墓碑、行留着，不再处理同批的其它组（规格 I7）。
//      清内容组时按物理删行时的级联口径清掉，票重新出现时不会捡到上一辈子的成员关系。
//   3. 每个组写完都盖三态章：三态存在 issue_group 而不是 issue 行上，没盖章的组下次会被当成
//      「从没取过」，界面就会把刚拿到的 truncated 当成不知道。
import type { DatabaseSync } from 'node:sqlite'
import type { IssueWrite } from '../contract/types.js'
import { decideRowMerge } from '../merge/row.js'
import { applyIssueEdges } from '../persistence/issue-edge-write.js'
import { applyIssueBody } from '../persistence/issue-body-write.js'
import { applyIssueAssignees, applyIssueLabels } from '../persistence/issue-groups-write.js'
import { ensureIssueId, findIssueId } from '../persistence/issue-identity-write.js'
import { fillIssueRow, replaceIssueRow } from '../persistence/issue-row-write.js'
import { applyIssueMergeInfo, applyIssueSubIssues } from '../persistence/issue-scalar-write.js'
import { applyIssueComments, applyCommentReceipt } from '../persistence/comment-write.js'
import { applyIssueReviews } from '../persistence/review-write.js'

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

/** 一张票上的字段组名（与 issue_group 的 group_name 一致）。ingest.ts 的版本门与窗口也用这一份。 */
export type IngestGroupName =
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

export interface ApplyIssueWriteOptions {
  /** 这一批是写回执：每组盖 receipt_ms（窗口从这次提交重新算）。 */
  isReceipt: boolean
  /** 被版本门 / 回执优先窗口 / 行组时间挡下的组；没有就用 null。 */
  blocked: Set<IngestGroupName> | null
}

export interface AppliedIssueWrite {
  /** 评论写回执落在第几位；没表达这一组时是 null。 */
  receiptPosition: number | null
  /** 这一张票这次真的写进去了几组（0 = 全被挡下，或只表达了 row=null 而票不存在）。 */
  appliedGroups: number
}

/**
 * 落一张票表达的所有组。row 组 complete+null 是「确认不存在」：写墓碑、行留着，不再处理同批的其它组
 * （规格 I7：删除只走墓碑，不物理删行；票重新出现时由普通写入清墓碑）。
 *
 * 被版本门、回执优先窗口或行组时间挡下的组整组跳过（不写值、也不盖章）：盖章会把「这次取过」的
 * 时刻推新，让界面以为这一组刚被重新确认过。
 *
 * 回值只有评论写回执与「这张票到底写进去几组」用得上。
 */
export function applyIssueWrite(
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
  const open = (group: IngestGroupName): boolean => !blocked || !blocked.has(group)
  let appliedGroups = 0
  const applied = (): void => { appliedGroups += 1 }

  const { row, body, labels, assignees, parents, blockedBy, subIssues, mergeInfo, comments, review, commentReceipt } = write.groups
  let receiptPosition: number | null = null
  if (row !== undefined && open('row')) {
    const decision = decideRowMerge(null, row)
    if (decision.kind === 'remove') {
      const existingId = findIssueId(db, write.effortId, write.key)
      if (existingId !== null) {
        // #1885 评审修复（规格 I7）：确认不存在的 row=complete+null 原先会物理删行，墓碑从来没写过，
        // 变化集的 missing 因此恒为空。现在行原样留在库里（审计与复活都靠它），只写一条墓碑：
        // 列表/计数投影按墓碑排除，变化集把它当作删除交出去。
        // 内容组按物理删行时的级联口径清掉（组章、正文、标签、指派、边、评论、评审、游标）：
        // 行只留身份，票重新出现时不会捡到上一辈子的成员关系与关系边（与改造前的级联语义一致）。
        clearIssueContent(db, existingId)
        db.prepare('INSERT OR REPLACE INTO issue_tombstone (issue_id, version, deleted_at_ms) VALUES (?, ?, ?)')
          .run(existingId, version, nowMs)
        applied()
      }
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

/**
 * 确认不存在的票：清掉它的内容组与关系边，但保留 issue 行本身与墓碑（#1885 评审修复）。
 * 表清单与 schema 里 ON DELETE CASCADE 的那几张一一对应；等价于原先物理删行时的级联，
 * 差别只在 issue 行不再消失。
 */
function clearIssueContent(db: DatabaseSync, issueId: number): void {
  db.prepare('DELETE FROM issue_group WHERE issue_id = ?').run(issueId)
  db.prepare('DELETE FROM issue_body WHERE issue_id = ?').run(issueId)
  db.prepare('DELETE FROM issue_label WHERE issue_id = ?').run(issueId)
  db.prepare('DELETE FROM issue_assignee WHERE issue_id = ?').run(issueId)
  db.prepare('DELETE FROM issue_edge WHERE subject_id = ? OR object_id = ?').run(issueId, issueId)
  db.prepare('DELETE FROM comment WHERE issue_id = ?').run(issueId)
  db.prepare('DELETE FROM review WHERE issue_id = ?').run(issueId)
  db.prepare('DELETE FROM fetch_cursor WHERE issue_id = ?').run(issueId)
}
