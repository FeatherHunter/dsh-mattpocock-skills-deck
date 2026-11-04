/**
 * tests/verify-1865-snapshot-comments.ts —— 评论与评审落进快照库（#1865）
 *
 * 守什么：评论按页写进 comment 表、取到第几条记进 fetch_cursor；评审整组替换；
 * 三态与版本门对这两组一视同仁。票面五条验收里「评论分页落库并推进游标」「评审整组替换、
 * 不残留旧评审」「评论正文与作者信息落库」由这一扇证明；「重启后详情评论直接可用」的宿主那一半
 * 在 verify-1865-snapshot-comments-replay.ts。逐节对应：
 *   A 评论按页写入：第一页 truncated、第二页接在后面、游标推进；重复写不重复、complete 可回退游标；
 *   B 评论正文与作者信息留在库里：正文一字不差、作者登录名/昵称/头像、作者关系、三个时间、后端 id；
 *   C 评审整组替换：complete 换掉旧的一组、truncated 只换前几位、unknown 不动值；
 *   D 版本门：用旧的起读版本写评论或评审，整批丢弃，库里一个字节不改；
 *   E 关库重开：评论、评审、游标与三态都还在，不靠进程内状态。
 *
 * 为什么要真库：评论在独立表、作者要跨到 actor 表、游标在 fetch_cursor、三态在 issue_group，
 * 替身盖不住这些跨表行为。临时目录用 os.tmpdir()，跑完删干净。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1865-snapshot-comments.ts
 */
// 门禁归属: src/workspace-snapshot

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import { openWorkspaceSnapshot } from '../src/workspace-snapshot/contract/index.ts'
import type {
  GroupWrite,
  IssueGroupsWrite,
  IssueWrite,
  OpenWorkspaceSnapshotResult,
  WorkspaceSnapshotHandle,
} from '../src/workspace-snapshot/contract/types.ts'
import type {
  IssueDetail,
  IssueRowValue,
  SnapshotComment,
  SnapshotReview,
} from '../src/workspace-snapshot/model/types.ts'

const GATE = 'verify-1865-snapshot-comments'
const CLOCK = 1762310000000
const CLOCK_LATER = CLOCK + 60000
let total = 0
let failed = 0

function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) {
    console.log('PASS ' + message)
    return
  }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

/** 详情里读到的评论；读不到（还没有这一格或库里没有这张票）一律当空数组，门禁不因形状不对崩掉。 */
function commentsOf(detail: IssueDetail | null | undefined): SnapshotComment[] {
  return detail && Array.isArray(detail.comments) ? detail.comments : []
}

function reviewsOf(detail: IssueDetail | null | undefined): SnapshotReview[] {
  return detail && Array.isArray(detail.reviews) ? detail.reviews : []
}

/** 评论游标：没取过时的写法与「没有这一格」都归成 null，方便逐字断言。 */
function cursorOf(detail: IssueDetail | null | undefined): string | null {
  return detail && typeof detail.commentsCursor === 'string' ? detail.commentsCursor : null
}

function rowGroup(key: string): IssueGroupsWrite['row'] {
  const value: IssueRowValue = { type: 'issue', title: '票 ' + key, state: 'open', updatedAtMs: CLOCK }
  return { completeness: 'complete', value, source: 'gate', operation: 'get' }
}

function complete<T>(value: T, operation = 'get'): GroupWrite<T> {
  return { completeness: 'complete', value, source: 'gate', operation }
}

/** 只拿到一页：这条读操作只表达了前几条，后面还有没有它不知道。 */
function page<T>(value: T[], operation = 'listComments'): GroupWrite<T[]> {
  return { completeness: 'truncated', value, source: 'gate', operation }
}

function unknown<T>(reason: string): GroupWrite<T> {
  return { completeness: 'unknown', reason, source: 'gate', operation: 'get' }
}

function write(key: string, groups: IssueGroupsWrite, effortId = ''): IssueWrite {
  return { effortId, key, groups }
}

function commentOf(backendId: string, login: string, body: string, extra?: Partial<SnapshotComment>): SnapshotComment {
  return Object.assign(
    {
      backendId,
      author: { login, name: login.toUpperCase(), avatarUrl: 'https://avatars.test/' + login },
      authorAssociation: 'MEMBER',
      body,
      createdAtMs: CLOCK,
      updatedAtMs: CLOCK,
    },
    extra || {},
  )
}

function reviewOf(state: string, login: string, submittedAtMs: number): SnapshotReview {
  return { state, reviewer: { login }, submittedAtMs }
}

function detailOf(handle: WorkspaceSnapshotHandle, key: string, effortId = ''): IssueDetail | null {
  return handle.readIssueDetail({ effortId, key }).issue
}

function authorLogins(comments: SnapshotComment[]): string[] {
  return comments.map((item) => String((item.author && item.author.login) || ''))
}

function texts(comments: SnapshotComment[]): string[] {
  return comments.map((item) => String(item.body))
}

function states(reviews: SnapshotReview[]): string[] {
  return reviews.map((item) => String(item.state))
}

function main(): void {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'verify-1865-comments-'))
  const openedHandles: WorkspaceSnapshotHandle[] = []
  try {
    const dbPath = path.join(tempRoot, 'db', 'snapshot.sqlite')
    mkdirSync(path.dirname(dbPath), { recursive: true })
    let clock = CLOCK
    const opened: OpenWorkspaceSnapshotResult = openWorkspaceSnapshot({
      workspaceRoot: tempRoot,
      backend: 'github',
      repoIdentity: 'acme/repo-a',
      dbPath,
      now: () => clock,
      leaseOwner: 'gate-1865',
    })
    check(opened.mode === 'writable', 'A0 临时库以可写模式打开', opened.mode)
    const handle = opened.handle
    openedHandles.push(handle)

    // ── A. 评论按页写入并推进游标 ──────────────────────────────────────────────
    const firstPage = [commentOf('c1', 'alice', '第一条评论'), commentOf('c2', 'bob', '第二条评论')]
    const firstWrite = handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [write('5', { row: rowGroup('5'), comments: page(firstPage) })],
    })
    check(firstWrite.committed === true, 'A1 第一页评论提交成功', firstWrite)

    const afterFirst = detailOf(handle, '5')
    check(commentsOf(afterFirst).length === 2, 'A2 第一页两条评论落库', commentsOf(afterFirst))
    check(texts(commentsOf(afterFirst)).join('|') === '第一条评论|第二条评论',
      'A3 评论按取回顺序读回', texts(commentsOf(afterFirst)))
    check(afterFirst?.groups.comments?.completeness === 'truncated', 'A4 只拿到一页 = truncated', afterFirst?.groups.comments)
    check(afterFirst?.groups.comments?.operation === 'listComments', 'A5 记住这是哪条读操作给的', afterFirst?.groups.comments)
    check(cursorOf(afterFirst) === '2', 'A6 游标记下取到第几条（2）', cursorOf(afterFirst))

    // ── B. 评论正文与作者信息留在库里 ──────────────────────────────────────────
    const rich = commentOf('c3', 'carol', '带 **Markdown** 的正文\n第二行', { editedAtMs: CLOCK_LATER, authorAssociation: 'OWNER' })
    clock = CLOCK_LATER
    handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [write('5', { comments: page([...firstPage, rich]) })],
    })
    const afterSecond = detailOf(handle, '5')
    check(commentsOf(afterSecond).length === 3, 'A7 第二页接着第一页取（三条）', commentsOf(afterSecond).length)
    check(cursorOf(afterSecond) === '3', 'A8 第二页把游标推到 3', cursorOf(afterSecond))
    check(commentsOf(afterSecond)[2]?.body === '带 **Markdown** 的正文\n第二行',
      'B1 评论正文一字不差留在库里', commentsOf(afterSecond)[2]?.body)
    check(authorLogins(commentsOf(afterSecond)).join('|') === 'alice|bob|carol',
      'B2 每条评论的作者登录名都留在库里', authorLogins(commentsOf(afterSecond)))
    check(commentsOf(afterSecond)[0]?.author?.name === 'ALICE'
      && commentsOf(afterSecond)[0]?.author?.avatarUrl === 'https://avatars.test/alice',
      'B3 作者昵称与头像跟着评论一起读回', commentsOf(afterSecond)[0]?.author)
    check(commentsOf(afterSecond)[2]?.authorAssociation === 'OWNER', 'B4 作者与仓库的关系读回',
      commentsOf(afterSecond)[2]?.authorAssociation)
    check(commentsOf(afterSecond)[0]?.createdAtMs === CLOCK && commentsOf(afterSecond)[2]?.editedAtMs === CLOCK_LATER,
      'B5 创建与编辑时间换算成毫秒留在库里',
      commentsOf(afterSecond).map((item) => [item.createdAtMs, item.editedAtMs]))
    check(commentsOf(afterSecond)[2]?.backendId === 'c3', 'B6 后端评论 id 留在库里（串接与追踪编辑要用）',
      commentsOf(afterSecond)[2]?.backendId)

    // 同一页再写一次：不重复、游标不因重复而前移
    const again = handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [write('5', { comments: page([...firstPage, rich]) })],
    })
    const afterRepeat = detailOf(handle, '5')
    check(again.committed === true, 'A9 同一页重复写提交成功', again)
    check(commentsOf(afterRepeat).length === 3 && cursorOf(afterRepeat) === '3',
      'A10 重复写同一页不重复入库、游标不前移',
      { count: commentsOf(afterRepeat).length, cursor: cursorOf(afterRepeat) })
    check(commentsOf(afterRepeat)[0]?.body === '第一条评论', 'A11 重复写不会把顺序打乱',
      commentsOf(afterRepeat)[0]?.body)

    // 完整取回：整组替换，游标停在总数
    handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [write('5', { comments: complete([firstPage[0], firstPage[1], rich]) })],
    })
    const afterComplete = detailOf(handle, '5')
    check(afterComplete?.groups.comments?.completeness === 'complete', 'A12 取满整组 = complete',
      afterComplete?.groups.comments)
    check(cursorOf(afterComplete) === '3', 'A13 complete 时游标就是总数', cursorOf(afterComplete))

    // 上游删了两条：complete 是权威，库里跟着变少，游标跟着回退
    handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [write('5', { comments: complete([firstPage[0], rich]) })],
    })
    const afterShrink = detailOf(handle, '5')
    check(commentsOf(afterShrink).length === 2 && cursorOf(afterShrink) === '2',
      'A14 complete 写少了就跟着少，游标可以回退',
      { count: commentsOf(afterShrink).length, cursor: cursorOf(afterShrink) })

    // 只拿到一条的页不能删掉后面已知的那条，也不能让游标倒退
    handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [write('5', { comments: page([firstPage[0]]) })],
    })
    const afterShortPage = detailOf(handle, '5')
    check(commentsOf(afterShortPage).length === 2, 'A15 truncated 写少了不删已知的评论',
      commentsOf(afterShortPage).length)
    check(cursorOf(afterShortPage) === '2', 'A16 truncated 不让游标倒退', cursorOf(afterShortPage))

    // 确认没有评论：complete + 空数组
    handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [write('5', { comments: complete([] as SnapshotComment[]) })],
    })
    const afterEmpty = detailOf(handle, '5')
    check(commentsOf(afterEmpty).length === 0 && afterEmpty?.groups.comments?.completeness === 'complete',
      'A17 complete 空 = 确认没有评论', commentsOf(afterEmpty))
    check(cursorOf(afterEmpty) === '0', 'A18 确认没有评论时游标归零', cursorOf(afterEmpty))

    // ── C. 评审整组替换 ────────────────────────────────────────────────────────
    handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [write('6', {
        row: rowGroup('6'),
        review: complete([reviewOf('APPROVED', 'alice', CLOCK), reviewOf('CHANGES_REQUESTED', 'bob', CLOCK_LATER)]),
      })],
    })
    const reviewTwo = detailOf(handle, '6')
    check(reviewsOf(reviewTwo).length === 2, 'C1 评审两条落库', reviewsOf(reviewTwo))
    check(states(reviewsOf(reviewTwo)).join('|') === 'APPROVED|CHANGES_REQUESTED',
      'C2 评审按顺序读回', states(reviewsOf(reviewTwo)))
    check(reviewsOf(reviewTwo)[0]?.reviewer?.login === 'alice' && reviewsOf(reviewTwo)[0]?.submittedAtMs === CLOCK,
      'C3 评审人与提交时间读回', reviewsOf(reviewTwo)[0])
    check(reviewTwo?.groups.review?.completeness === 'complete', 'C4 评审组盖了完整度', reviewTwo?.groups.review)

    // 整组替换：只剩一条时旧的两条一条都不许残留
    handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [write('6', { review: complete([reviewOf('APPROVED', 'carol', CLOCK_LATER)]) })],
    })
    const reviewOne = detailOf(handle, '6')
    check(reviewsOf(reviewOne).length === 1 && reviewsOf(reviewOne)[0]?.reviewer?.login === 'carol',
      'C5 评审整组替换，旧评审不残留', reviewsOf(reviewOne))

    // truncated 只换前几位：第一条被换掉，第二条保留
    handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [write('6', {
        review: complete([reviewOf('APPROVED', 'carol', CLOCK_LATER), reviewOf('COMMENTED', 'dave', CLOCK)]),
      })],
    })
    handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [write('6', { review: page([reviewOf('DISMISSED', 'erin', CLOCK)]) })],
    })
    const reviewPrefix = detailOf(handle, '6')
    check(reviewsOf(reviewPrefix)[0]?.state === 'DISMISSED' && reviewsOf(reviewPrefix).length === 2,
      'C6 truncated 只换前几位，后面的旧评审留着', states(reviewsOf(reviewPrefix)))

    // unknown：只盖完整度，不动值
    handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [write('6', { review: unknown<SnapshotReview[]>('not-applicable') })],
    })
    const reviewUnknown = detailOf(handle, '6')
    check(reviewsOf(reviewUnknown).length === 2 && reviewUnknown?.groups.review?.completeness === 'unknown',
      'C7 unknown 不删上次已知的评审，只改完整度', reviewsOf(reviewUnknown))

    // 确认没有评审：complete + 空数组
    handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [write('6', { review: complete([] as SnapshotReview[]) })],
    })
    const reviewEmpty = detailOf(handle, '6')
    check(reviewsOf(reviewEmpty).length === 0 && reviewEmpty?.groups.review?.completeness === 'complete',
      'C8 complete 空 = 确认没有评审', reviewsOf(reviewEmpty))

    // ── D. 版本门：评论与评审与本票其它组同一条判据 ─────────────────────────────
    const versionBeforeComments = handle.getMergeVersion()
    handle.ingest({
      startMergeVersion: versionBeforeComments,
      writes: [write('7', { row: rowGroup('7'), comments: page([commentOf('c7', 'alice', '先前取到的一条')]) })],
    })
    const staleComments = handle.ingest({
      startMergeVersion: versionBeforeComments,
      writes: [write('7', {
        comments: page([commentOf('c7', 'alice', '迟到的旧结果'), commentOf('c8', 'bob', '迟到的旧结果二')]),
      })],
    })
    check(staleComments.committed === false && staleComments.reason === 'stale', 'D1 用旧起读版本写评论被整批丢弃',
      staleComments)
    const afterStale = detailOf(handle, '7')
    check(commentsOf(afterStale).length === 1 && commentsOf(afterStale)[0]?.body === '先前取到的一条',
      'D2 被丢弃的那批评论一个字节没写进库', commentsOf(afterStale))
    check(cursorOf(afterStale) === '1', 'D3 被丢弃时游标也不动', cursorOf(afterStale))

    const versionBeforeReviews = handle.getMergeVersion()
    handle.ingest({
      startMergeVersion: versionBeforeReviews,
      writes: [write('8', { row: rowGroup('8'), review: complete([reviewOf('APPROVED', 'alice', CLOCK)]) })],
    })
    const staleReviews = handle.ingest({
      startMergeVersion: versionBeforeReviews,
      writes: [write('8', { review: complete([] as SnapshotReview[]) })],
    })
    check(staleReviews.committed === false && staleReviews.reason === 'stale', 'D4 用旧起读版本写评审同样被丢弃',
      staleReviews)
    check(reviewsOf(detailOf(handle, '8')).length === 1, 'D5 被丢弃的评审没有清掉旧值',
      reviewsOf(detailOf(handle, '8')))

    // ── E. 关库重开：评论、评审、游标与三态都还在 ───────────────────────────────
    handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [write('9', {
        row: rowGroup('9'),
        comments: page([commentOf('c9', 'frank', '重开之后要还在')]),
        review: complete([reviewOf('APPROVED', 'frank', CLOCK)]),
      })],
    })
    const beforeClose = detailOf(handle, '9')
    handle.close()
    const reopened = openWorkspaceSnapshot({
      workspaceRoot: tempRoot,
      backend: 'github',
      repoIdentity: 'acme/repo-a',
      dbPath,
      now: () => clock,
      leaseOwner: 'gate-1865-reopen',
    })
    check(reopened.mode === 'writable', 'E0 重开仍是可写模式', reopened.mode)
    openedHandles.push(reopened.handle)
    const afterReopen = detailOf(reopened.handle, '9')
    check(commentsOf(afterReopen).length === 1 && commentsOf(afterReopen)[0]?.body === '重开之后要还在',
      'E1 重开后评论正文还在', commentsOf(afterReopen))
    check(commentsOf(afterReopen)[0]?.author?.login === 'frank' && commentsOf(afterReopen)[0]?.author?.name === 'FRANK',
      'E2 重开后评论作者还在', commentsOf(afterReopen)[0]?.author)
    check(cursorOf(afterReopen) === cursorOf(beforeClose) && cursorOf(afterReopen) === '1',
      'E3 重开后游标还在', cursorOf(afterReopen))
    check(afterReopen?.groups.comments?.completeness === 'truncated'
      && afterReopen?.groups.comments?.operation === 'listComments',
      'E4 重开后评论组的三态与读操作还在', afterReopen?.groups.comments)
    check(reviewsOf(afterReopen).length === 1 && reviewsOf(afterReopen)[0]?.reviewer?.login === 'frank',
      'E5 重开后评审还在', reviewsOf(afterReopen))
    check(afterReopen?.groups.review?.completeness === 'complete', 'E6 重开后评审组的三态还在', afterReopen?.groups.review)
    check(reviewsOf(detailOf(reopened.handle, '8')).length === 1, 'E7 重开后别的票的评审不受影响',
      reviewsOf(detailOf(reopened.handle, '8')))
    reopened.handle.close()
  } finally {
    for (const opened of openedHandles) {
      try { opened.close() } catch { /* 已经关过或已关库 */ }
    }
    rmSync(tempRoot, { recursive: true, force: true })
  }
  printGateResult(GATE, total, failed)
}

main()
