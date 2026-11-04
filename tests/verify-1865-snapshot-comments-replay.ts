/**
 * tests/verify-1865-snapshot-comments-replay.ts —— 评论与评审从库出（#1865 宿主侧）
 *
 * 守什么：宿主那两条电话（wf.issueDetail 与 wf.issueComments）把取回的评论按页写进本地快照库，
 * 下一次打开同一张票、或同一张票的「加载更多」，只要库里已经取到过就直接从库交回，不再发取数请求。
 * 票面验收里「评论分页每取一页就落库并推进游标」「重启后详情评论直接可用，不重复请求」由这一扇证明。
 *
 * 逐节：
 *   A 第一次打开详情：评论与评审落库，票面总数说取满了就是 complete，游标等于取到的条数；
 *   B 60 秒内再开同一张票：一次取数都不发，评论、作者、分页与总数全部从库出；
 *   C 加载更多：一次一页，库里条数与游标跟着涨，交回的是新增段（不重复前面的）；
 *   D 重启（关掉进程内的库句柄）：详情与「加载更多」都还从库出，游标接着上次走；
 *   E 断网：库里有上次已知就照旧交回，库里没有就如实失败；
 *   F 票面总数是 0：交回空连接（确认没有评论），而不是省略评论这一格（那是「不知道」）。
 *
 * 为什么用真库：写入要穿过真正的快照树（按页覆盖、游标、三态）。临时目录用 os.tmpdir()，跑完删干净。
 * 「评审整组替换、旧评审不残留」的库层证据在 verify-1865-snapshot-comments.ts 的 C 节。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1865-snapshot-comments-replay.ts
 */
// 门禁归属: src/refresh/rooms/host/snapshot-library.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library-view.ts
// 门禁归属: src/refresh/rooms/host/comment-thread-fetch.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import type { Comment, Issue, IssueFieldStates, RepositoryRef, Review } from '../src/tracker/contract/entities.ts'
import { createCommentThreads } from '../src/refresh/rooms/host/comment-thread-fetch.ts'
import {
  closeSnapshotLibraries,
  readIssueDetail,
  recordIssueComments,
  recordIssueDetail,
  recordIssueRows,
} from '../src/refresh/rooms/host/snapshot-library.ts'

const GATE = 'verify-1865-snapshot-comments-replay'
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

/** 造一条评论：id 与顺序一一对应，正文里带序号，方便断言「交回的是第几条」。 */
function commentOf(index: number): Comment {
  return {
    id: 'c' + index,
    author: { login: index % 2 === 0 ? 'alice' : 'bob' },
    authorAssociation: index === 1 ? 'OWNER' : 'MEMBER',
    body: '评论 ' + index,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  }
}

function commentsUpTo(count: number): Comment[] {
  const out: Comment[] = []
  for (let index = 1; index <= count; index += 1) out.push(commentOf(index))
  return out
}

function reviewOf(state: string, login: string): Review {
  return { state, reviewer: { login }, submittedAt: '2026-10-02T00:00:00Z' }
}

/** 一套字段三态：评论总数与评审都由传进来的值决定，其余组给稳定的已知值。 */
function fieldStates(commentTotal: number, reviews: Review[]): IssueFieldStates {
  return {
    parents: { known: true, value: null, reason: null },
    dependencies: { known: true, value: [], reason: null },
    subIssues: { known: false, value: null, reason: 'not-applicable' },
    comments: { known: true, value: commentTotal, reason: null },
    review: { known: true, value: reviews, reason: null },
    mergeInfo: { known: true, value: null, reason: null },
  }
}

function issueWith(key: string, comments: Comment[], reviews: Review[], totalComments = comments.length): Issue {
  return {
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
    reviews,
    fieldStates: fieldStates(totalComments, reviews),
  }
}

/**
 * 造一套「宿主接线」：会话取数按契约的 comments.first 截取（三个后端房间都是这个口径），
 * 并记下发了几次、每次要多少条。
 */
function hostOf(options: { comments: Comment[]; reviews: Review[]; fail?: boolean }) {
  const calls = { get: 0, wants: [] as number[] }
  const threads = createCommentThreads({
    normCwd: async (c: unknown) => String(c),
    selectEarly: async () => ({ backendId: 'github', rev: 1 }),
    isComposerSelection: () => false,
    getTrackerRegistry: async () => ({ describe: () => REPO, modules: () => [] }),
    getPlatform: async () => ({}),
    ctx: { get: () => null },
    timer: null,
    DEFAULT_CWD: '',
    errText: (e: unknown) => String((e as { message?: string } | null)?.message || e),
    isRateLimitError: () => false,
    getRepoKey: async () => ({ owner: 'acme', name: 'repo-a' }),
    execProc: async () => ({ ok: true, text: '', code: 0 }),
    fetchIssueDetail: async () => ({ ok: false }),
    fetchIssueIndex: async () => ({ ok: false }),
    issueIndexFromSnapshot: () => ({}),
    setCache: () => {},
    getCache: () => ({ ts: 0, snapshot: null }),
    writeDiskCache: async () => {},
    openSession: async () => {
      const session = {
        get: async (_repo: unknown, key: unknown, opts: any) => {
          calls.get += 1
          const want = opts && opts.comments && typeof opts.comments.first === 'number'
            ? Math.max(0, Math.min(200, Math.floor(opts.comments.first)))
            : options.comments.length
          calls.wants.push(want)
          if (options.fail) return { ok: false, error: { kind: 'network', message: '断网了' } }
          const data = issueWith(String(key).replace(/^0+(?=\d)/, ''), options.comments.slice(0, want), options.reviews, options.comments.length)
          return { ok: true, data, provenance: { source: 'graphql', groups: {} } }
        },
      }
      return {
        ok: true,
        backendId: 'github',
        repoRef: REPO,
        call: async (fn: (s: unknown, c: unknown) => unknown) => fn(session, {}),
      }
    },
    getSnapshotLibrary: async () => ({ recordIssueDetail, recordIssueComments, readIssueDetail }),
    logCtx: null,
  })
  return { threads, calls }
}

function libraryOf(workspaceRoot: string) {
  return { workspaceRoot, backend: 'github', repoIdentity: REPO.refId }
}

async function storedDetail(workspaceRoot: string, key: string): Promise<any> {
  const found = await readIssueDetail(Object.assign({ key, effortId: '' }, libraryOf(workspaceRoot)))
  return found && found.issue ? found.issue : null
}

function nodesOfDetail(issue: any): any[] {
  return issue && issue.comments && Array.isArray(issue.comments.nodes) ? issue.comments.nodes : []
}

function bodies(nodes: any[]): string[] {
  return nodes.map((node) => String((node && node.body) || ''))
}

async function main(): Promise<void> {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'verify-1865-comments-replay-'))
  try {
    mkdirSync(path.join(tempRoot, 'docs', 'agents'), { recursive: true })
    writeFileSync(path.join(tempRoot, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1865\n', 'utf8')

    // 先让库里有一张「别的票」，用来证明评论写入不碰它
    await recordIssueRows({
      workspaceRoot: tempRoot, backend: 'github', repoIdentity: REPO.refId,
      rows: [issueWith('90', [], [])],
    })
    const otherBefore = await storedDetail(tempRoot, '90')

    // ── A. 第一次打开详情：评论与评审落库 ──────────────────────────────────────
    const smallComments = commentsUpTo(2)
    const smallReviews = [reviewOf('APPROVED', 'carol')]
    const hostA = hostOf({ comments: smallComments, reviews: smallReviews })
    const first: any = await hostA.threads.handleIssueDetail({ number: 5, cwd: tempRoot })
    check(first && first.ok === true, 'A1 第一次详情取数成功', first)
    check(hostA.calls.get === 1, 'A2 第一次真的发了一次取数', hostA.calls)
    check(nodesOfDetail(first && first.issue).length === 2, 'A3 回包带这一趟取到的两条评论',
      nodesOfDetail(first && first.issue).length)

    const storedSmall = await storedDetail(tempRoot, '5')
    check(!!storedSmall && storedSmall.comments.length === 2, 'A4 评论落库（两条）', storedSmall && storedSmall.comments)
    check(!!storedSmall && storedSmall.comments[0].body === '评论 1' && storedSmall.comments[0].author.login === 'bob',
      'A5 评论正文与作者都留在库里', storedSmall && storedSmall.comments[0])
    check(!!storedSmall && storedSmall.commentsCursor === '2', 'A6 游标记下取到 2 条', storedSmall && storedSmall.commentsCursor)
    check(!!storedSmall && storedSmall.groups.comments.completeness === 'complete',
      'A7 票面总数说取满了，评论组就是 complete', storedSmall && storedSmall.groups.comments)
    check(!!storedSmall && storedSmall.reviews.length === 1 && storedSmall.reviews[0].state === 'APPROVED',
      'A8 评审也落库了（含评审人）', storedSmall && storedSmall.reviews)
    check(!!storedSmall && storedSmall.groups.review.completeness === 'complete',
      'A9 评审组盖了完整度', storedSmall && storedSmall.groups.review)
    const otherAfter = await storedDetail(tempRoot, '90')
    check(!!otherAfter && otherAfter.groups.comments === null && otherAfter.comments.length === 0,
      'A10 别的票没有被顺手写上评论组', otherAfter && otherAfter.groups.comments)

    // ── B. 60 秒内再开同一张票：一次取数都不发，全从库出 ────────────────────────
    const hostB = hostOf({ comments: smallComments, reviews: smallReviews })
    const second: any = await hostB.threads.handleIssueDetail({ number: 5, cwd: tempRoot })
    check(second && second.ok === true && second.fromSnapshot === true, 'B1 第二次从库交回详情',
      second && second.fromSnapshot)
    check(hostB.calls.get === 0, 'B2 第二次没有发取数（评论与评审都在库里）', hostB.calls)
    check(bodies(nodesOfDetail(second && second.issue)).join('|') === '评论 1|评论 2',
      'B3 评论正文从库读出', bodies(nodesOfDetail(second && second.issue)))
    check(nodesOfDetail(second && second.issue)[0].author.login === 'bob',
      'B4 评论作者从库读出', nodesOfDetail(second && second.issue)[0].author)
    check(second && second.issue && second.issue.comments.pageInfo.endCursor === '2',
      'B5 分页游标从库读出（加载更多接着这里走）', second && second.issue && second.issue.comments.pageInfo)
    check(second && second.issue && second.issue.comments.pageInfo.hasNextPage === false,
      'B6 取满了就不说还有下一页', second && second.issue && second.issue.comments.pageInfo)
    check(second && second.issue && second.issue.comments.totalCount === 2,
      'B7 评论总数从库读出', second && second.issue && second.issue.comments.totalCount)
    check(second && second.issue && second.issue.reviews[0].state === 'APPROVED'
      && second.issue.reviews[0].reviewer.login === 'carol',
      'B8 评审从库读出（评审人与结论）', second && second.issue && second.issue.reviews)

    // ── C. 加载更多：一次一页，落库并推进游标 ──────────────────────────────────
    const manyComments = commentsUpTo(120)
    const hostC = hostOf({ comments: manyComments, reviews: [] })
    const bigFirst: any = await hostC.threads.handleIssueDetail({ number: 9, cwd: tempRoot })
    check(bigFirst && bigFirst.ok === true, 'C1 120 条评论的票第一次打开成功', bigFirst && bigFirst.ok)
    const storedBig = await storedDetail(tempRoot, '9')
    check(!!storedBig && storedBig.comments.length === 50 && storedBig.commentsCursor === '50',
      'C2 详情这一趟取到的第一页落库（50 条，游标 50）',
      { count: storedBig && storedBig.comments.length, cursor: storedBig && storedBig.commentsCursor })
    check(!!storedBig && storedBig.groups.comments.completeness === 'truncated',
      'C3 票面总数说还有，评论组就是 truncated', storedBig && storedBig.groups.comments)
    check(bigFirst && bigFirst.issue.comments.pageInfo.hasNextPage === true
      && bigFirst.issue.comments.pageInfo.endCursor === '50',
      'C4 回包说还有下一页，游标是 50', bigFirst && bigFirst.issue.comments.pageInfo)

    const moreOne: any = await hostC.threads.handleIssueComments({ number: 9, after: '50', cwd: tempRoot })
    check(moreOne && moreOne.ok === true && Array.isArray(moreOne.nodes), 'C5 加载更多成功', moreOne && moreOne.ok)
    check(moreOne.nodes.length === 50 && bodies(moreOne.nodes)[0] === '评论 51',
      'C6 只交回新增的那 50 条（从第 51 条起）',
      { count: moreOne.nodes.length, first: bodies(moreOne.nodes)[0] })
    const storedMore = await storedDetail(tempRoot, '9')
    check(!!storedMore && storedMore.comments.length === 100 && storedMore.commentsCursor === '100',
      'C7 第二页也落库，游标推到 100',
      { count: storedMore && storedMore.comments.length, cursor: storedMore && storedMore.commentsCursor })
    check(moreOne.pageInfo.hasNextPage === true && moreOne.pageInfo.endCursor === '100',
      'C8 回包说还有下一页，游标是 100', moreOne.pageInfo)

    const moreTwo: any = await hostC.threads.handleIssueComments({ number: 9, after: '100', cwd: tempRoot })
    check(moreTwo && moreTwo.ok === true && moreTwo.nodes.length === 20 && bodies(moreTwo.nodes)[0] === '评论 101',
      'C9 最后一页交回剩下的 20 条',
      { count: moreTwo && moreTwo.nodes.length, first: bodies((moreTwo && moreTwo.nodes) || [])[0] })
    const storedAll = await storedDetail(tempRoot, '9')
    check(!!storedAll && storedAll.comments.length === 120 && storedAll.commentsCursor === '120',
      'C10 全部取完后库里 120 条、游标 120',
      { count: storedAll && storedAll.comments.length, cursor: storedAll && storedAll.commentsCursor })
    check(!!storedAll && storedAll.groups.comments.completeness === 'complete',
      'C11 取满整组后评论组变成 complete', storedAll && storedAll.groups.comments)
    check(moreTwo.pageInfo.hasNextPage === false, 'C12 最后一页不说还有下一页', moreTwo.pageInfo)

    // ── D. 重启：详情与加载更多都还从库出 ──────────────────────────────────────
    closeSnapshotLibraries()
    const hostD = hostOf({ comments: manyComments, reviews: [] })
    const afterRestart: any = await hostD.threads.handleIssueDetail({ number: 9, cwd: tempRoot })
    check(afterRestart && afterRestart.ok === true && afterRestart.fromSnapshot === true,
      'D1 重启后详情仍从库出', afterRestart && afterRestart.fromSnapshot)
    check(hostD.calls.get === 0, 'D2 重启后没有重取详情', hostD.calls)
    check(nodesOfDetail(afterRestart && afterRestart.issue).length === 120,
      'D3 重启后 120 条评论全在', nodesOfDetail(afterRestart && afterRestart.issue).length)
    check(afterRestart && afterRestart.issue.comments.pageInfo.endCursor === '120'
      && afterRestart.issue.comments.pageInfo.hasNextPage === false,
      'D4 重启后游标与「还有没有下一页」都还准', afterRestart && afterRestart.issue.comments.pageInfo)

    const restartMore: any = await hostD.threads.handleIssueComments({ number: 9, after: '50', cwd: tempRoot })
    check(restartMore && restartMore.ok === true && restartMore.nodes.length === 50,
      'D5 重启后加载更多，库里已有的那一页直接从库交回', restartMore && restartMore.nodes && restartMore.nodes.length)
    check(hostD.calls.get === 0, 'D6 这一页一条取数都没发', hostD.calls)
    check(bodies((restartMore && restartMore.nodes) || [])[0] === '评论 51',
      'D7 从库交回的也是第 51 条起', bodies((restartMore && restartMore.nodes) || [])[0])
    check(restartMore.pageInfo.hasNextPage === true && restartMore.pageInfo.endCursor === '100',
      'D8 从库交回时也说清后面还有', restartMore.pageInfo)

    const tail: any = await hostD.threads.handleIssueComments({ number: 9, after: '110', cwd: tempRoot })
    check(tail && tail.ok === true && tail.nodes.length === 10
      && tail.pageInfo.hasNextPage === false && tail.pageInfo.endCursor === '120',
      'D9 库里剩下的尾巴也从库交回（10 条，到底了）', { count: tail && tail.nodes && tail.nodes.length, pageInfo: tail && tail.pageInfo })
    check(hostD.calls.get === 0, 'D10 取尾巴也没有发取数', hostD.calls)

    const beyond: any = await hostD.threads.handleIssueComments({ number: 9, after: '120', cwd: tempRoot })
    check(beyond && beyond.ok === true && beyond.nodes.length === 0 && hostD.calls.get === 1,
      'D11 库里没取过的位置才去后端取（这一次取回来也确实没有更多）',
      { nodes: beyond && beyond.nodes.length, calls: hostD.calls.get })
    check(beyond.pageInfo.hasNextPage === false, 'D12 后端也说没有更多了', beyond.pageInfo)

    // ── E. 断网：库里有上次已知就照旧交回，没有就如实失败 ──────────────────────
    closeSnapshotLibraries()
    const hostE = hostOf({ comments: smallComments, reviews: smallReviews, fail: true })
    const offlineDetail: any = await hostE.threads.handleIssueDetail({ number: 5, cwd: tempRoot })
    check(offlineDetail && offlineDetail.ok === true && offlineDetail.fromSnapshot === true,
      'E1 断网时交回库里的详情', offlineDetail && offlineDetail.ok)
    check(nodesOfDetail(offlineDetail && offlineDetail.issue).length === 2, 'E2 断网时评论也从库交回', nodesOfDetail(offlineDetail && offlineDetail.issue).length)
    check(hostE.calls.get === 0, 'E3 库里新鲜时断网根本不发取数', hostE.calls)
    const offlineMissing: any = await hostE.threads.handleIssueDetail({ number: 404, cwd: tempRoot })
    check(offlineMissing && offlineMissing.ok === false, 'E4 库里没有的票断网时如实失败', offlineMissing && offlineMissing.ok)
    const offlineMore: any = await hostE.threads.handleIssueComments({ number: 404, after: '0', cwd: tempRoot })
    check(offlineMore && offlineMore.ok === false, 'E5 库里没有的票「加载更多」断网时也如实失败',
      offlineMore && offlineMore.ok)

    // ── F. 票面总数是 0：交回空连接（确认没有评论），不是省略这一格 ──────────────
    const hostF = hostOf({ comments: [], reviews: [] })
    const noneFirst: any = await hostF.threads.handleIssueDetail({ number: 31, cwd: tempRoot })
    check(noneFirst && noneFirst.ok === true, 'F1 没有评论的票第一次打开成功', noneFirst && noneFirst.ok)
    const storedNone = await storedDetail(tempRoot, '31')
    check(!!storedNone && storedNone.commentsCursor === '0'
      && storedNone.groups.comments.completeness === 'complete',
      'F2 确认没有评论：组 complete、游标 0',
      { cursor: storedNone && storedNone.commentsCursor, group: storedNone && storedNone.groups.comments })
    const noneAgain: any = await hostF.threads.handleIssueDetail({ number: 31, cwd: tempRoot })
    check(hostF.calls.get === 1, 'F3 第二次不再取数（只有第一次那一趟）', hostF.calls)
    check(noneAgain && noneAgain.issue && Array.isArray(noneAgain.issue.comments.nodes)
      && noneAgain.issue.comments.nodes.length === 0,
      'F4 交回空连接（界面据此说「无评论」而不是「加载中」）', noneAgain && noneAgain.issue && noneAgain.issue.comments)
    check(noneAgain && noneAgain.issue.comments.pageInfo.hasNextPage === false
      && noneAgain.issue.comments.totalCount === 0,
      'F5 空连接也带着「没有下一页、总数 0」', noneAgain && noneAgain.issue && noneAgain.issue.comments.pageInfo)
    check(otherBefore && otherBefore.groups.comments === null, 'F6 别的票的「评论未知」没有被顺手写上')
  } finally {
    closeSnapshotLibraries()
    rmSync(tempRoot, { recursive: true, force: true })
  }
  printGateResult(GATE, total, failed)
}

main().catch((e) => {
  console.log('FAIL 门禁异常退出：' + ((e && e.stack) || e))
  printGateResult(GATE, total, failed + 1)
  process.exitCode = 1
})
