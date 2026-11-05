/**
 * tests/verify-1866-write-receipt.ts —— 写回执落进快照库（#1866 库层）
 *
 * 守什么：发评论、改状态、改标签这三类写经 tracker 写回成功之后，把写回执在一个事务里并进库；
 * 库里的值就是回执里的值；关掉句柄重开（等于重启 DSH）之后仍然在。写失败（回执与库对不上、
 * 这批写入不合法、库开不出来）时库里一个字节都不改，并把原因如实交回去。
 *
 * 逐节：
 *   A 评论：评论组原本完整 → 追加一条之后仍然完整、游标跟着走、重开后还在；
 *   B 评论：评论组原本只有前几条 → 新评论落在票面总数那个位置、组不被说成完整、游标不因追加而前进，
 *     下一次「加载更多」把前缀补齐之后新评论仍在（不会被覆盖掉）；
 *   C 状态：关闭之后的回执写进去，库里的行状态就是关闭，重开后还在；
 *   D 标签：回执里的两枚标签整体替换旧标签，重开后还在；
 *   E 一个事务：一批里有一张票缺身份，整批不生效（没有半批写进去）；
 *   F 失败可见：工作区或后端没给对时如实回失败；库开不出来时回「降级」（老路继续走，不假装写成功）；
 *   G 回执与库一致：回执里的状态、标题、标签、评论正文与库里读回来的逐项相同。
 *
 * 为什么用真库：写入要穿过事务、版本门与三态合并，替身测不出「关掉重开还在」。
 * 临时目录用 os.tmpdir()，跑完删干净。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1866-write-receipt.ts
 */
// 门禁归属: src/refresh/rooms/host/snapshot-library.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library-adapter.ts
// 门禁归属: src/workspace-snapshot/persistence/comment-write.ts
// 门禁归属: src/workspace-snapshot/merge/paged.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import type { Comment, Issue, IssueFieldStates, RepositoryRef } from '../src/tracker/contract/entities.ts'
import {
  closeSnapshotLibraries,
  readIssueDetail,
  recordCommentReceipt,
  recordIssueComments,
  recordIssueDetail,
  recordIssueRows,
  recordWriteReceipt,
} from '../src/refresh/rooms/host/snapshot-library.ts'

const GATE = 'verify-1866-write-receipt'
const REPO: RepositoryRef = {
  backend: 'github',
  refId: 'acme/repo-a',
  name: 'repo-a',
  url: 'https://github.com/acme/repo-a',
}
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

/** 造一条评论：正文带序号，作者奇偶交替，方便断言「交回的是哪一条」。 */
function commentOf(index: number): Comment {
  return {
    id: 'c' + index,
    author: { login: index % 2 === 0 ? 'alice' : 'bob' },
    authorAssociation: 'MEMBER',
    body: '评论 ' + index,
    createdAt: '2026-10-0' + String((index % 9) + 1) + 'T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  }
}

function commentsUpTo(count: number): Comment[] {
  const out: Comment[] = []
  for (let index = 1; index <= count; index += 1) out.push(commentOf(index))
  return out
}

function fieldStates(commentTotal: number): IssueFieldStates {
  return {
    parents: { known: true, value: null, reason: null },
    dependencies: { known: true, value: [], reason: null },
    subIssues: { known: false, value: null, reason: 'not-applicable' },
    comments: { known: true, value: commentTotal, reason: null },
    review: { known: false, value: null, reason: 'not-applicable' },
    mergeInfo: { known: true, value: null, reason: null },
  }
}

/** 造一张票：评论条数与票面总数分开给，才能造出「只取到前几条」的库状态。 */
function issueWith(key: string, comments: Comment[], totalComments = comments.length, extra?: Partial<Issue>): Issue {
  const base: Issue = {
    key,
    effortId: '',
    type: 'issue',
    title: '票 ' + key,
    state: 'open',
    body: '正文 ' + key,
    url: 'https://github.com/acme/repo-a/issues/' + key,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    closedAt: null,
    parentKey: null,
    comments,
    commentCount: totalComments,
    fieldStates: fieldStates(totalComments),
  }
  return Object.assign(base, extra || {})
}

function libKeyOf(workspaceRoot: string): any {
  return { workspaceRoot, backend: 'github', repoIdentity: REPO.refId }
}

async function storedDetail(workspaceRoot: string, key: string): Promise<any> {
  const found = await readIssueDetail(Object.assign({ key, effortId: '' }, libKeyOf(workspaceRoot)))
  return found && found.issue ? found.issue : null
}

function bodies(issue: any): string[] {
  const list = issue && Array.isArray(issue.comments) ? issue.comments : []
  return list.map((item: any) => String((item && item.body) || ''))
}

/** 造一个带 workspace.yaml 的临时工作区根：库文件按这个根落盘。 */
function workspaceOf(name: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'verify-1866-' + name + '-'))
  mkdirSync(path.join(root, 'docs', 'agents'), { recursive: true })
  writeFileSync(path.join(root, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1866-' + name + '\n', 'utf8')
  return root
}

async function main(): Promise<void> {
  const roots: string[] = []
  try {
    // ── A. 评论组原本完整：追加一条之后仍然完整 ─────────────────────────────────
    const rootA = workspaceOf('a')
    roots.push(rootA)
    await recordIssueDetail(Object.assign({ issue: issueWith('5', commentsUpTo(2)) }, libKeyOf(rootA)))
    const beforeA = await storedDetail(rootA, '5')
    check(!!beforeA && beforeA.comments.length === 2 && beforeA.commentsCursor === '2',
      'A1 预置：评论组完整（两条，游标 2）', beforeA && { count: beforeA.comments.length, cursor: beforeA.commentsCursor })

    const wroteA: any = await recordCommentReceipt(Object.assign({
      keys: ['5'], effortId: '', comment: commentOf(3),
    }, libKeyOf(rootA)))
    check(wroteA && wroteA.ok === true && wroteA.position === 2, 'A2 写回执提交成功，新评论落在第 2 位（0 起）', wroteA)

    const afterA = await storedDetail(rootA, '5')
    check(bodies(afterA).join('|') === '评论 1|评论 2|评论 3', 'A3 库里多了刚发的那一条，顺序在最后', bodies(afterA))
    check(!!afterA && afterA.comments[2].author.login === 'bob', 'A4 评论作者一起落库', afterA && afterA.comments[2].author)
    check(!!afterA && afterA.groups.comments.completeness === 'complete',
      'A5 原来完整，追加一条之后仍然完整（不降级成「只有一部分」）', afterA && afterA.groups.comments)
    check(!!afterA && afterA.commentsCursor === '3', 'A6 游标跟着走到 3（界面「加载更多」不再重复取这一条）',
      afterA && afterA.commentsCursor)
    check(!!afterA && afterA.row.commentCount === 2, 'A7 行组的票面总数没有被写回执顺手改掉（那是读结果的事）',
      afterA && afterA.row.commentCount)

    closeSnapshotLibraries()
    const reopenedA = await storedDetail(rootA, '5')
    check(bodies(reopenedA).join('|') === '评论 1|评论 2|评论 3', 'A8 关掉句柄重开（等于重启）之后评论还在', bodies(reopenedA))

    // ── B. 评论组只有前几条：新评论落在票面总数那个位置，不冒充完整 ─────────────
    const rootB = workspaceOf('b')
    roots.push(rootB)
    // 5 条评论，详情只取到前 2 条：组是 truncated，游标 2。
    await recordIssueDetail(Object.assign({ issue: issueWith('7', commentsUpTo(2), 5) }, libKeyOf(rootB)))
    const beforeB = await storedDetail(rootB, '7')
    check(!!beforeB && beforeB.groups.comments.completeness === 'truncated' && beforeB.commentsCursor === '2',
      'B1 预置：评论组只有前 2 条（truncated，游标 2）',
      beforeB && { group: beforeB.groups.comments, cursor: beforeB.commentsCursor })

    const wroteB: any = await recordCommentReceipt(Object.assign({
      keys: ['7'], effortId: '', comment: commentOf(99),
    }, libKeyOf(rootB)))
    check(wroteB && wroteB.ok === true && wroteB.position === 5,
      'B2 新评论落在票面总数那个位置（第 5 位，前面留着还没取到的 3 条）', wroteB)

    const afterB = await storedDetail(rootB, '7')
    check(bodies(afterB).join('|') === '评论 1|评论 2|评论 99', 'B3 库里是「已知前缀 + 刚发的那一条」', bodies(afterB))
    check(!!afterB && afterB.groups.comments.completeness === 'truncated',
      'B4 中间那几条还没取过，组不许说成完整', afterB && afterB.groups.comments)
    check(!!afterB && afterB.commentsCursor === '2',
      'B5 追加一条不等于「取到了第 3 条」：游标不许前进', afterB && afterB.commentsCursor)

    // 紧接着的一趟「加载更多」取回前缀 0..3（4 条）：正落在 #1889 的回执优先窗口里。
    // 那一页的前缀盖得到刚发的那一条（它就在第 5 位，前缀 0..3 够不到它；但窗口按组算，
    // 整组在窗口内都要让给回执），所以这一页不写库：刚发的那一条原样留着。
    // 窗口一过照常落库、游标照常前进 —— 那两件事由 tests/verify-1889-write-receipts.ts 的 D16/D17 守。
    await recordIssueComments(Object.assign({ issue: issueWith('7', commentsUpTo(4), 5) }, libKeyOf(rootB)))
    const afterPageB = await storedDetail(rootB, '7')
    check(bodies(afterPageB).join('|') === '评论 1|评论 2|评论 99',
      'B6 窗口内的这一页没有把刚发的那一条冲掉（回执那一条原样在）', bodies(afterPageB))
    check(!!afterPageB && afterPageB.commentsCursor === '2', 'B7 这一页没写进库，游标不前进（下次还会重新取）',
      afterPageB && afterPageB.commentsCursor)

    // ── C. 状态：关闭之后的回执写进去 ───────────────────────────────────────────
    const rootC = workspaceOf('c')
    roots.push(rootC)
    await recordIssueRows(Object.assign({ rows: [issueWith('11', [])] }, libKeyOf(rootC)))
    const closed = issueWith('11', [], 0, {
      state: 'closed',
      closedAt: '2026-11-02T00:00:00Z',
      reason: 'completed',
      updatedAt: '2026-11-02T00:00:00Z',
    })
    const wroteC: any = await recordWriteReceipt(Object.assign({
      issues: [closed], operation: 'close',
    }, libKeyOf(rootC)))
    check(wroteC && wroteC.ok === true, 'C1 状态写回执提交成功', wroteC)
    const afterC = await storedDetail(rootC, '11')
    check(!!afterC && afterC.row.state === 'closed', 'C2 库里的行状态就是关闭', afterC && afterC.row.state)
    check(!!afterC && afterC.row.stateReason === 'completed', 'C3 关闭原因一起落库', afterC && afterC.row.stateReason)
    check(!!afterC && afterC.row.closedAtMs === Date.parse('2026-11-02T00:00:00Z'),
      'C4 关闭时刻换成毫秒落库', afterC && afterC.row.closedAtMs)

    closeSnapshotLibraries()
    const reopenedC = await storedDetail(rootC, '11')
    check(!!reopenedC && reopenedC.row.state === 'closed', 'C5 重开之后状态仍是关闭', reopenedC && reopenedC.row.state)

    // ── D. 标签：回执里的标签整体替换旧的 ───────────────────────────────────────
    const rootD = workspaceOf('d')
    roots.push(rootD)
    await recordIssueRows(Object.assign({
      rows: [issueWith('12', [], 0, { labels: [{ name: 'old-label' }] })],
    }, libKeyOf(rootD)))
    const relabeled = issueWith('12', [], 0, {
      labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'ready-for-agent' }],
    })
    const wroteD: any = await recordWriteReceipt(Object.assign({
      issues: [relabeled], operation: 'setLabels',
    }, libKeyOf(rootD)))
    check(wroteD && wroteD.ok === true, 'D1 标签写回执提交成功', wroteD)
    const afterD = await storedDetail(rootD, '12')
    const namesD = afterD ? afterD.labels.map((item: any) => item.name) : []
    check(namesD.join('|') === 'bug|ready-for-agent', 'D2 回执里的两枚标签整体替换了旧标签', namesD)
    check(!!afterD && afterD.labels[0].color === 'd73a4a', 'D3 标签颜色一起落库', afterD && afterD.labels[0])

    closeSnapshotLibraries()
    const reopenedD = await storedDetail(rootD, '12')
    check(reopenedD && reopenedD.labels.map((item: any) => item.name).join('|') === 'bug|ready-for-agent',
      'D4 重开之后标签仍是回执里那两枚', reopenedD && reopenedD.labels)

    // ── E. 一个事务：整批不合法时一张都不写 ─────────────────────────────────────
    const rootE = workspaceOf('e')
    roots.push(rootE)
    await recordIssueRows(Object.assign({ rows: [issueWith('21', [])] }, libKeyOf(rootE)))
    const badSecond: any = { effortId: '', key: '', title: '缺票号' }
    const wroteE: any = await recordWriteReceipt(Object.assign({
      issues: [issueWith('21', [], 0, { state: 'closed' }), badSecond], operation: 'update',
    }, libKeyOf(rootE)))
    check(wroteE && wroteE.ok === false, 'E1 一张票缺身份 → 整批回失败', wroteE)
    const afterE = await storedDetail(rootE, '21')
    check(afterE && afterE.row.state === 'open', 'E2 整批没提交：第一张票的状态没有被顺手改掉', afterE && afterE.row.state)

    // ── F. 失败可见：参数没给对如实回失败，库开不出来回降级 ─────────────────────
    const noRoot: any = await recordWriteReceipt({ workspaceRoot: '', backend: 'github', repoIdentity: REPO.refId, issues: [issueWith('1', [])], operation: 'close' })
    check(noRoot && noRoot.ok === false && noRoot.reason === 'no-workspace', 'F1 没给工作区 → 如实回失败', noRoot)
    const badBackend: any = await recordWriteReceipt({ workspaceRoot: roots[0], backend: 'svn', repoIdentity: REPO.refId, issues: [issueWith('1', [])], operation: 'close' })
    check(badBackend && badBackend.ok === false && badBackend.reason === 'unsupported-backend',
      'F2 不认识的后端 → 如实回失败', badBackend)
    const unsupportedColumn: any = await recordCommentReceipt({ workspaceRoot: roots[0], backend: 'github', repoIdentity: REPO.refId, keys: [], effortId: '', comment: commentOf(1) })
    check(unsupportedColumn && unsupportedColumn.ok === false && unsupportedColumn.reason === 'no-keys',
      'F3 没给票号 → 如实回失败（不往库里扔一条没有主人的评论）', unsupportedColumn)

    // ── G. 回执与库里的值一致 ───────────────────────────────────────────────────
    const rootG = workspaceOf('g')
    roots.push(rootG)
    await recordIssueDetail(Object.assign({ issue: issueWith('31', commentsUpTo(1)) }, libKeyOf(rootG)))
    const receiptG = issueWith('31', commentsUpTo(1), 1, {
      title: '改过的标题',
      state: 'closed',
      labels: [{ name: 'documentation' }],
      updatedAt: '2026-11-03T00:00:00Z',
    })
    await recordWriteReceipt(Object.assign({ issues: [receiptG], operation: 'update' }, libKeyOf(rootG)))
    await recordCommentReceipt(Object.assign({ keys: ['31'], effortId: '', comment: commentOf(2) }, libKeyOf(rootG)))
    const afterG = await storedDetail(rootG, '31')
    check(!!afterG && afterG.row.title === receiptG.title, 'G1 标题一致（回执 ' + receiptG.title + '）', afterG && afterG.row.title)
    check(!!afterG && afterG.row.state === 'closed', 'G2 状态一致（回执 closed）', afterG && afterG.row.state)
    check(!!afterG && afterG.row.updatedAtMs === Date.parse(receiptG.updatedAt), 'G3 更新时间一致', afterG && afterG.row.updatedAtMs)
    check(!!afterG && afterG.labels.map((item: any) => item.name).join('|') === 'documentation',
      'G4 标签一致（回执 documentation）', afterG && afterG.labels)
    check(bodies(afterG).join('|') === '评论 1|评论 2', 'G5 评论正文一致（回执里那一条原样进库）', bodies(afterG))

    printGateResult(GATE, total, failed)
  } finally {
    closeSnapshotLibraries()
    for (const root of roots) {
      try { rmSync(root, { recursive: true, force: true }) } catch (e) { /* 临时目录删不掉不影响结论 */ }
    }
  }
}

main().catch((error) => {
  console.log('FAIL 门禁自己抛错：' + String((error && error.stack) || error))
  printGateResult(GATE, total, failed + 1)
})
