/**
 * tests/verify-1864-snapshot-detail-replay.ts —— 单票详情与关系从快照库出（#1864 宿主侧）
 *
 * 守什么：宿主那条单票详情电话（wf.issueDetail）把取回的详情按组写进本地快照库；下一次
 * 打开同一张票时，只要库里的数据还新鲜就不再发取数请求（会话的 get 一次都不调），
 * 直接从库交回详情。票面验收里「详情页从库出」「重启后无需重取」由这一条证明。
 *
 * 另外守三件容易写错的事：
 *   - 网络失败时库里有上次已知就照旧交回去，页面不会空白；
 *   - 三态与上次已知时刻随详情一起交出去，界面才分得清「确认没有」与「不知道」；
 *   - 详情写入只表达这一张票的组，别的票的内容与时刻不动。
 *
 * 为什么用真库：写入要穿过真正的快照树（按组合并、边表、三态）。临时目录用 os.tmpdir()，
 * 跑完删干净。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1864-snapshot-detail-replay.ts
 */
// 门禁归属: src/refresh/rooms/host/snapshot-library.ts
// 门禁归属: src/refresh/rooms/host/comment-thread-fetch.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import type { Issue, IssueFieldStates, RepositoryRef } from '../src/tracker/contract/entities.ts'
import { createCommentThreads } from '../src/refresh/rooms/host/comment-thread-fetch.ts'
import {
  closeSnapshotLibraries,
  recordIssueDetail,
  recordIssueRows,
  readIssueDetail,
} from '../src/refresh/rooms/host/snapshot-library.ts'

const GATE = 'verify-1864-snapshot-detail-replay'
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

function fieldStates(input: {
  parentKey: string | null
  blockedBy: Array<{ key: string; title: string; state?: 'open' | 'closed' }>
  subIssues: { total: number; completed: number; percentCompleted: number } | null
  mergedAt: string | null
}): IssueFieldStates {
  return {
    parents: { known: true, value: input.parentKey, reason: null },
    dependencies: { known: true, value: input.blockedBy, reason: null },
    subIssues: input.subIssues
      ? { known: true, value: input.subIssues, reason: null }
      : { known: false, value: null, reason: 'not-applicable' },
    comments: { known: true, value: 2, reason: null },
    review: { known: false, value: null, reason: 'not-expressed' },
    mergeInfo: { known: true, value: input.mergedAt, reason: null },
  }
}

function issue(input: Partial<Issue> & { key: string; title: string }): Issue {
  const base: Issue = {
    key: input.key,
    effortId: input.effortId || '',
    type: input.type || 'issue',
    title: input.title,
    state: input.state || 'open',
    body: input.body || '',
    url: 'https://github.com/acme/repo-a/issues/' + input.key,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: input.updatedAt || '2026-11-01T00:00:00Z',
    closedAt: input.closedAt || null,
    parentKey: input.parentKey === undefined ? null : input.parentKey,
  }
  return Object.assign(base, input)
}

/** 详情读结果：一张有正文、标签、指派、父票、阻塞、子票计数、合并信息的票。 */
function detailIssue(): Issue {
  const blocked = { key: '90', title: '阻塞者', state: 'closed' as const }
  return issue({
    key: '5',
    title: '子票五',
    body: '这是正文内容。',
    parentKey: '100',
    labels: [{ name: 'ready-for-agent', color: '00ff00' }],
    assignees: [{ login: 'alice' }],
    blockedBy: [blocked],
    comments: [
      { author: { login: 'bob' }, body: '一条评论', createdAt: '2026-10-02T00:00:00Z' },
      { author: { login: 'carol' }, body: '又一条评论', createdAt: '2026-10-03T00:00:00Z' },
    ],
    commentCount: 2,
    fieldStates: fieldStates({ parentKey: '100', blockedBy: [blocked], subIssues: { total: 3, completed: 1, percentCompleted: 33 }, mergedAt: null }),
  })
}

/** 造一套「宿主接线」：会话取数、仓库坐标、快照库门面都按真实形状注入。 */
function hostOf(options: { workspaceRoot: string; detail: Issue; failDetail?: boolean }) {
  const calls = { openSession: 0, get: 0 }
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
      calls.openSession += 1
      const session = {
        get: async () => {
          calls.get += 1
          if (options.failDetail) return { ok: false, error: { kind: 'network', message: '断网了' } }
          return { ok: true, data: options.detail, provenance: { source: 'graphql', groups: {} } }
        },
      }
      return {
        ok: true,
        backendId: 'github',
        repoRef: REPO,
        call: async (fn: (s: unknown, c: unknown) => unknown) => fn(session, {}),
      }
    },
    getSnapshotLibrary: async () => ({ recordIssueDetail, readIssueDetail }),
    logCtx: null,
  })
  return { threads, calls }
}

function groupsOf(issue: any): any {
  return (issue && issue.snapshotGroups) || {}
}

async function main(): Promise<void> {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'verify-1864-replay-'))
  try {
    mkdirSync(path.join(tempRoot, 'docs', 'agents'), { recursive: true })
    writeFileSync(path.join(tempRoot, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1864\n', 'utf8')

    // 先让库里有一张「别的票」，用来证明详情写入不碰它
    const other = issue({ key: '90', title: '阻塞者', state: 'closed' })
    await recordIssueRows({ workspaceRoot: tempRoot, backend: 'github', repoIdentity: REPO.refId, rows: [other] })
    const beforeOther = await readIssueDetail({ workspaceRoot: tempRoot, backend: 'github', repoIdentity: REPO.refId, key: '90' })

    // ── A. 第一次打开详情：发一次取数、按组写库、按老形状交回 ────────────────────
    const hostA = hostOf({ workspaceRoot: tempRoot, detail: detailIssue() })
    const first: any = await hostA.threads.handleIssueDetail({ number: 5, cwd: tempRoot })
    check(first && first.ok === true, 'A1 第一次详情取数成功', first)
    check(hostA.calls.get === 1, 'A2 第一次真的发了一次取数', hostA.calls)
    check(first && first.issue && first.issue.body === '这是正文内容。', 'A3 交回的详情带正文', first && first.issue && first.issue.body)
    check(!first || first.fromSnapshot !== true, 'A4 第一次不是从库回放（库里还没有详情）', first && first.fromSnapshot)

    const stored = await readIssueDetail({ workspaceRoot: tempRoot, backend: 'github', repoIdentity: REPO.refId, key: '5' })
    check(!!stored && stored.issue?.body === '这是正文内容。', 'A5 详情写进了库（正文按组落库）', stored && stored.issue && stored.issue.body)
    check(!!stored && stored.issue?.labels[0]?.name === 'ready-for-agent', 'A6 标签写进了库', stored && stored.issue?.labels)
    check(!!stored && stored.issue?.subIssues?.total === 3, 'A7 子票计数写进了库', stored && stored.issue?.subIssues)
    check(!!stored && stored.issue?.groups.body?.completeness === 'complete', 'A8 正文组的完整度是 complete', stored && stored.issue?.groups.body)
    check(!!stored && stored.issue?.groups.mergeInfo?.completeness === 'complete' && stored.issue?.mergedAtMs === null,
      'A9 合并信息「确认还没合并」也写进了库', stored && stored.issue?.groups.mergeInfo)
    check(!!stored && stored.issue?.parents[0]?.key === '100', 'A10 父票写进了库（边表）', stored && stored.issue?.parents)
    check(!!stored && stored.issue?.blockedBy[0]?.key === '90', 'A11 阻塞边写进了库', stored && stored.issue?.blockedBy)

    const afterOther = await readIssueDetail({ workspaceRoot: tempRoot, backend: 'github', repoIdentity: REPO.refId, key: '90' })
    check(!!afterOther && afterOther.issue?.row.title === beforeOther?.issue?.row.title, 'A12 别的票的内容不变', afterOther && afterOther.issue?.row)
    check(!!afterOther && afterOther.issue?.lastKnownAtMs === beforeOther?.issue?.lastKnownAtMs, 'A13 别的票的组记录时刻不变', [
      beforeOther?.issue?.lastKnownAtMs,
      afterOther?.issue?.lastKnownAtMs,
    ])
    check(!!afterOther && afterOther.issue?.groups.body === null, 'A14 别的票没有被顺手写上正文组', afterOther && afterOther.issue?.groups.body)

    // ── B. 第二次打开同一张票：不再发取数，从库交回 ──────────────────────────────
    const hostB = hostOf({ workspaceRoot: tempRoot, detail: detailIssue() })
    const second: any = await hostB.threads.handleIssueDetail({ number: 5, cwd: tempRoot })
    check(second && second.ok === true, 'B1 第二次详情读成功', second)
    check(hostB.calls.get === 0, 'B2 第二次没有发取数（详情从库出）', hostB.calls)
    check(second && second.fromSnapshot === true, 'B3 回包标了 fromSnapshot', second && second.fromSnapshot)
    check(second && second.issue && second.issue.body === '这是正文内容。', 'B4 回放交回的正文与库里一致', second && second.issue && second.issue.body)
    check(second && second.issue && second.issue.labels && second.issue.labels.nodes[0].name === 'ready-for-agent', 'B5 回放交回标签', second && second.issue && second.issue.labels)
    check(second && second.issue && second.issue.blockedBy && second.issue.blockedBy.nodes[0].number === 90, 'B6 回放交回阻塞边（状态胶囊以库为准）', second && second.issue && second.issue.blockedBy)
    check(second && second.issue && second.issue.blockedBy.nodes[0].state === 'CLOSED', 'B7 阻塞边的目标状态从库出', second && second.issue && second.issue.blockedBy)
    check(second && second.issue && second.issue.subIssues && second.issue.subIssues.totalCount === 3, 'B8 回放交回子票计数', second && second.issue && second.issue.subIssues)
    check(second && second.issue && groupsOf(second.issue).body && groupsOf(second.issue).body.completeness === 'complete',
      'B9 回包带各组三态（界面分得清确认没有与不知道）', second && second.issue && groupsOf(second.issue).body)
    check(second && second.issue && typeof second.issue.lastKnownAtMs === 'number' && second.issue.lastKnownAtMs > 0,
      'B10 回包带上次已知时刻', second && second.issue && second.issue.lastKnownAtMs)
    check(second && second.issue && second.issue.comments === undefined, 'B11 评论还没进库时不假装有（#1865 才落评论）', second && second.issue && second.issue.comments)

    // ── C. 重启（关掉进程内的库句柄）后仍然不用重取 ──────────────────────────────
    closeSnapshotLibraries()
    const hostC = hostOf({ workspaceRoot: tempRoot, detail: detailIssue() })
    const afterRestart: any = await hostC.threads.handleIssueDetail({ number: 5, cwd: tempRoot })
    check(afterRestart && afterRestart.ok === true && afterRestart.fromSnapshot === true, 'C1 重启后详情仍从库出', afterRestart && afterRestart.fromSnapshot)
    check(hostC.calls.get === 0, 'C2 重启后没有重取详情', hostC.calls)
    check(afterRestart && afterRestart.issue && afterRestart.issue.body === '这是正文内容。', 'C3 重启后正文还在', afterRestart && afterRestart.issue && afterRestart.issue.body)
    check(afterRestart && afterRestart.issue && afterRestart.issue.blockedBy && afterRestart.issue.blockedBy.nodes[0].number === 90, 'C4 重启后关系还在', afterRestart && afterRestart.issue && afterRestart.issue.blockedBy)

    // ── D. 网络失败：库里有上次已知就照旧交回去，页面不会空白 ────────────────────
    const hostD = hostOf({ workspaceRoot: tempRoot, detail: detailIssue(), failDetail: true })
    const failedRead: any = await hostD.threads.handleIssueDetail({ number: 5, cwd: tempRoot })
    check(failedRead && failedRead.ok === true && failedRead.fromSnapshot === true, 'D1 断网时交回库里的详情', failedRead && failedRead.ok)
    check(hostD.calls.get === 0, 'D2 新鲜数据根本不发取数，断网也不影响', hostD.calls)

    // 库里没有的票：断网就如实失败，不拿空壳冒充
    const hostE = hostOf({ workspaceRoot: tempRoot, detail: detailIssue(), failDetail: true })
    const missing: any = await hostE.threads.handleIssueDetail({ number: 404, cwd: tempRoot })
    check(missing && missing.ok === false, 'D3 库里没有的票断网时如实失败', missing && missing.ok)
    check(hostE.calls.get === 1, 'D4 库里没有的票真的发了一次取数', hostE.calls)

    // ── E. 引用骨架：只有身份、没有正文的票，不当成完整详情交回 ──────────────────
    await recordIssueRows({
      workspaceRoot: tempRoot, backend: 'github', repoIdentity: REPO.refId,
      rows: [issue({ key: '5', title: '子票五', parentKey: '100' })],
    })
    const hostF = hostOf({ workspaceRoot: tempRoot, detail: detailIssue() })
    const skeleton: any = await hostF.threads.handleIssueDetail({ number: 404, cwd: tempRoot })
    check(skeleton && skeleton.ok === true && skeleton.fromSnapshot !== true, 'E1 库里没有的票仍走取数', skeleton && skeleton.fromSnapshot)
    const rowsOnly = await readIssueDetail({ workspaceRoot: tempRoot, backend: 'github', repoIdentity: REPO.refId, key: '5' })
    check(!!rowsOnly && rowsOnly.issue?.referenceSkeleton === false, 'E2 列表写过的票不是引用骨架', rowsOnly && rowsOnly.issue?.referenceSkeleton)
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
