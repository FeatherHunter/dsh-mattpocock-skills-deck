/**
 * tests/verify-1866-write-receipt-replay.ts —— 写操作经宿主那两条路落进快照库（#1866 宿主层）
 *
 * 守什么：面板上发一条评论、以及 AI 用 deck 工具改状态改标签之后，写回执先提交进本地快照库，
 * 提交成功界面才看得到新值；提交失败时界面保持旧值，并把原因如实交回去（不做乐观更新）。
 *
 * 逐节：
 *   A 面板发评论成功：评论落库、回包说「已存」，再打开详情时从库里读出这一条（一次取数都不发）；
 *   B 发评论失败：库里没有那一条，旧评论原样不动，回包是失败；
 *   C 评论已经发出去、库没写进去：库里不变，回包说「发出去了但没存上」（不是假成功，也不是假失败）；
 *   D 行级增量那条路的取数口：把「写完之后重新读回来的那几张票」交给落库回调；回调失败时整批算失败
 *     （调用方据此不并进快照，界面保持旧值）；
 *   E 写回执那一路真的接上了：补行件在并进快照之前先落库；落库失败时快照一个字段都不改；
 *   F 接线：宿主把快照库门面交给补行件、补行件在写回执那条路上把它交下去。
 *
 * 为什么用真库：A/B 要证明「重启后仍从库出」，替身测不出来。临时目录用 os.tmpdir()，跑完删干净。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1866-write-receipt-replay.ts
 */
// 门禁归属: src/refresh/rooms/host/comment-thread-fetch.ts
// 门禁归属: src/refresh/rooms/host/thin-row-fetch.ts
// 门禁归属: src/refresh/rooms/host/row-patch.ts
// 门禁归属: src/refresh/rooms/host/patch-wiring.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import type { Comment, Issue, IssueFieldStates, RepositoryRef } from '../src/tracker/contract/entities.ts'
import { createCommentThreads } from '../src/refresh/rooms/host/comment-thread-fetch.ts'
import { fetchThinRows } from '../src/refresh/rooms/host/thin-row-fetch.ts'
import { createPatch } from '../src/refresh/rooms/host/row-patch.ts'
import * as delta from '../src/refresh/kernel/snapshot-diff.ts'
import {
  closeSnapshotLibraries,
  readIssueDetail,
  recordCommentReceipt,
  recordIssueDetail,
  recordWriteReceipt,
} from '../src/refresh/rooms/host/snapshot-library.ts'

const GATE = 'verify-1866-write-receipt-replay'
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

function commentOf(index: number): Comment {
  return {
    id: 'c' + index,
    author: { login: 'alice' },
    authorAssociation: 'MEMBER',
    body: '评论 ' + index,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  }
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

function issueWith(key: string, comments: Comment[], totalComments = comments.length): Issue {
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
    fieldStates: fieldStates(totalComments),
  }
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

function workspaceOf(name: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'verify-1866-replay-' + name + '-'))
  mkdirSync(path.join(root, 'docs', 'agents'), { recursive: true })
  writeFileSync(path.join(root, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1866-replay-' + name + '\n', 'utf8')
  return root
}

/**
 * 造一套宿主接线：评论写走 session.comment，详情读走 session.get。
 * 库里已经预置了这张票（含老评论），所以「界面上看到什么」只由库决定。
 */
function hostOf(options: { comment: Comment; writeResult?: any; library?: any }): any {
  const calls = { get: 0, comment: 0 }
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
        get: async () => { calls.get += 1; return { ok: false, error: { kind: 'network', message: '门禁不预置取数' } } },
        comment: async () => {
          calls.comment += 1
          const preset = options.writeResult
          return preset || { ok: true, data: options.comment }
        },
      }
      return {
        ok: true,
        backendId: 'github',
        repoRef: REPO,
        call: async (fn: (s: unknown, c: unknown) => unknown) => fn(session, {}),
      }
    },
    getSnapshotLibrary: async () => options.library || { recordCommentReceipt, recordIssueDetail, recordWriteReceipt, readIssueDetail },
    logCtx: null,
  })
  return { threads, calls }
}

async function main(): Promise<void> {
  const roots: string[] = []
  try {
    // ── A. 面板发评论成功：评论落库，界面从库里看到新值 ─────────────────────────
    const rootA = workspaceOf('a')
    roots.push(rootA)
    await recordIssueDetail(Object.assign({ issue: issueWith('5', [commentOf(1)]) }, libKeyOf(rootA)))
    const hostA = hostOf({ comment: commentOf(2) })
    const wroteA: any = await hostA.threads.handleCommentIssue({ number: 5, body: '评论 2', cwd: rootA })
    check(wroteA && wroteA.ok === true, 'A1 发评论成功', wroteA)
    check(wroteA && wroteA.stored === true, 'A2 回包说这一条已经存进本地库了', wroteA && wroteA.stored)
    const storedA = await storedDetail(rootA, '5')
    check(bodies(storedA).join('|') === '评论 1|评论 2', 'A3 库里多了刚发的那一条', bodies(storedA))
    const reopenedA: any = await hostOf({ comment: commentOf(3) }).threads.handleIssueDetail({ number: 5, cwd: rootA })
    check(reopenedA && reopenedA.ok === true && reopenedA.fromSnapshot === true, 'A4 再开详情从库里交回', reopenedA && reopenedA.fromSnapshot)
    const nodesA: any[] = (reopenedA && reopenedA.issue && reopenedA.issue.comments && reopenedA.issue.comments.nodes) || []
    check(nodesA.map((n: any) => n.body).join('|') === '评论 1|评论 2',
      'A5 界面看到的就是库里那两条（含刚发的那条）', nodesA.map((n: any) => n.body))

    closeSnapshotLibraries()
    const hostAfter = hostOf({ comment: commentOf(4) })
    const afterRestart: any = await hostAfter.threads.handleIssueDetail({ number: 5, cwd: rootA })
    check(afterRestart && afterRestart.ok === true, 'A6 重启（关句柄重开）之后详情仍从库里交回', afterRestart && afterRestart.ok)
    check(hostAfter.calls.get === 0, 'A7 重启后一次取数都没发（评论在库里）', hostAfter.calls)

    // ── B. 发评论失败：库里什么都不改 ───────────────────────────────────────────
    const rootB = workspaceOf('b')
    roots.push(rootB)
    await recordIssueDetail(Object.assign({ issue: issueWith('6', [commentOf(1)]) }, libKeyOf(rootB)))
    const hostB = hostOf({ comment: commentOf(2), writeResult: { ok: false, error: { kind: 'auth', message: '没登录' } } })
    const wroteB: any = await hostB.threads.handleCommentIssue({ number: 6, body: '评论 2', cwd: rootB })
    check(wroteB && wroteB.ok === false, 'B1 后端拒绝时回包是失败', wroteB)
    check(!wroteB || wroteB.stored !== true, 'B2 失败回包不许说「已存」', wroteB && wroteB.stored)
    const storedB = await storedDetail(rootB, '6')
    check(bodies(storedB).join('|') === '评论 1', 'B3 库里没有那一条（旧值原样保留）', bodies(storedB))

    // ── C. 评论发出去了、库没写进去：两件事都要说清 ─────────────────────────────
    const rootC = workspaceOf('c')
    roots.push(rootC)
    await recordIssueDetail(Object.assign({ issue: issueWith('7', [commentOf(1)]) }, libKeyOf(rootC)))
    const failingLibrary = {
      recordCommentReceipt: async () => ({ ok: false, mergeVersion: null, position: null, reason: 'write-failed' }),
      recordIssueDetail,
      recordWriteReceipt,
      readIssueDetail,
    }
    const hostC = hostOf({ comment: commentOf(2), library: failingLibrary })
    const wroteC: any = await hostC.threads.handleCommentIssue({ number: 7, body: '评论 2', cwd: rootC })
    check(wroteC && wroteC.ok === true, 'C1 后端写成功就算写成功（不因为本地库失败就报假失败）', wroteC)
    check(wroteC && wroteC.stored === false, 'C2 回包明说「没存进本地库」', wroteC && wroteC.stored)
    const storedC = await storedDetail(rootC, '7')
    check(bodies(storedC).join('|') === '评论 1', 'C3 库里保持旧值（不写半条）', bodies(storedC))

    // ── D. 行级增量取数口：落库失败时整批算失败 ─────────────────────────────────
    const thinSession = {
      get: async () => ({ ok: true, data: issueWith('201', []), provenance: { source: 'graphql', groups: {} } }),
    }
    const thinOpener = async (): Promise<any> => ({
      ok: true,
      backendId: 'github',
      repoRef: REPO,
      call: (fn: (s: unknown, c: unknown) => unknown) => fn(thinSession, {}),
    })
    const seen: any[] = []
    const thinOk: any = await fetchThinRows({
      openSession: thinOpener,
      stats: { thinQueries: 0 },
      receipt: async (input: any) => { seen.push(input); return { ok: true } },
    } as any, 'C:/ws/demo', { owner: 'acme', name: 'repo-a' }, ['201'])
    check(thinOk && thinOk.ok === true, 'D1 落库成功时取数照常回成功', thinOk && thinOk.ok)
    check(seen.length === 1 && seen[0].issues.length === 1 && seen[0].issues[0].key === '201',
      'D2 落库回调收到写完之后重新读回来的那张票', seen)
    check(seen.length === 1 && seen[0].repoIdentity === REPO.refId && seen[0].backend === 'github',
      'D3 落库回调拿到的是同一个库身份（工作区 + 后端 + 仓库）', seen[0] && { b: seen[0].backend, r: seen[0].repoIdentity })
    const thinBad: any = await fetchThinRows({
      openSession: thinOpener,
      stats: { thinQueries: 0 },
      receipt: async () => ({ ok: false, reason: 'write-failed' }),
    } as any, 'C:/ws/demo', { owner: 'acme', name: 'repo-a' }, ['201'])
    check(thinBad && thinBad.ok === false && String(thinBad.reason).indexOf('receipt') >= 0,
      'D4 落库失败 → 这一批算没取到（调用方据此不并进快照）', thinBad)
    const thinOld: any = await fetchThinRows({ openSession: thinOpener, stats: { thinQueries: 0 } } as any, 'C:/ws/demo', { owner: 'acme', name: 'repo-a' }, ['201'])
    check(thinOld && thinOld.ok === true && thinOld.rows.length === 1, 'D5 没接落库回调时老行为不变（只取数）', thinOld && thinOld.ok)

    // ── E. 写回执那一路：先落库，再并进快照；落库失败快照一个字不改 ───────────────
    const rootE = workspaceOf('e')
    roots.push(rootE)
    await recordIssueDetail(Object.assign({ issue: issueWith('201', []) }, libKeyOf(rootE)))
    let store: any = null
    let receiptCalls = 0
    let receiptOk = true
    function snapshotOf(rows: any[]): any {
      return {
        version: 'v0',
        generatedMs: Date.now(),
        updatedAt: new Date().toISOString(),
        maps: [],
        issues: rows,
        deck: { counts: { open: rows.length, closed: 0, total: rows.length }, partial: false, levels: [] },
        merge: { version: 5, lastStartMs: Date.now() - 5000, groups: {} },
        delta: { structureVersion: delta.DELTA_STRUCTURE_VERSION, watermarkMs: Date.now(), generation: 0, pending: [], pendingAt: 0, pendingReason: '' },
      }
    }
    const rowOf = (title: string): any => ({
      number: 201, key: '201', title, state: 'OPEN', assignees: [], labels: [], updatedAt: '2026-11-01T00:00:00Z',
      body: '', commentCount: 0, comments: [], reviews: [],
    })
    store = snapshotOf([rowOf('旧标题')])
    const closedIssue = issueWith('201', [])
    ;(closedIssue as any).state = 'closed'
    ;(closedIssue as any).title = '新标题'
    const session = {
      get: async () => ({
        ok: true,
        data: closedIssue,
        // 读来源：行与标签两组声明为完整，合并服务才敢用这一行覆盖旧行（口径同 #1690 的字段组掩码）。
        provenance: {
          operation: 'get', source: 'graphql', completeness: 'complete',
          fieldGroups: { row: 'complete', labels: 'complete', parents: 'complete', dependencies: 'complete', body: 'unexpressed', comments: 'unexpressed', subIssues: 'unexpressed', review: 'unexpressed', mergeInfo: 'unexpressed' },
          missingFieldGroups: [], durationMs: 4, startVersion: 'read-v1-1-000001',
        },
      }),
    }
    const patch = createPatch({
      now: () => Date.now(),
      logCtx: { isEnabled: () => false, fire: () => undefined },
      workspaceKeyOf: () => 'ws-1866',
      readSnapshot: async () => store,
      writeSnapshot: async (_cwd: any, snap: any) => { store = snap },
      indexOfSnapshot: () => ({}),
      getRepoKey: async () => ({ owner: 'acme', name: 'repo-a' }),
      openSession: async () => ({
        ok: true,
        backendId: 'github',
        repoRef: REPO,
        call: (fn: (s: unknown, c: unknown) => unknown) => fn(session, {}),
      }),
      decide: () => ({ verdict: 'send' }),
      recordWriteReceipt: async (input: any) => { receiptCalls += 1; return receiptOk ? { ok: true, rows: 1, mergeVersion: 6 } : { ok: false, rows: 0, mergeVersion: null, reason: 'write-failed' } },
    })
    const patchedOk: any = await patch.patchTickets('C:/ws/demo', ['201'])
    check(receiptCalls === 1, 'E1 补行件在并进快照之前先把写回执交给落库', receiptCalls)
    check(patchedOk && patchedOk.mode === 'patch', 'E2 落库成功 → 补行成功并进快照', patchedOk && patchedOk.mode)
    check(store.issues[0].title === '新标题' && store.issues[0].state === 'CLOSED', 'E3 界面看到的是新值（标题与状态都换了）',
      store.issues[0] && { t: store.issues[0].title, s: store.issues[0].state })

    receiptOk = false
    const beforeFail = store.issues[0]
    const patchedFail: any = await patch.patchTickets('C:/ws/demo', ['201'])
    check(patchedFail && patchedFail.mode === 'failed', 'E4 落库失败 → 这一趟算失败，不并进快照', patchedFail && patchedFail.mode)
    check(store.issues[0] === beforeFail && store.issues[0].title === '新标题' && store.issues[0].state === 'CLOSED',
      'E5 落库失败时界面保持旧值（行没有被改，也没有变成关闭）',
      store.issues[0] && { t: store.issues[0].title, s: store.issues[0].state })
    check(String(patchedFail && patchedFail.reason).indexOf('receipt') >= 0, 'E6 失败原因说的是写回执没落库', patchedFail && patchedFail.reason)

    // ── F. 接线：宿主 → 补行件 → 取数口 ────────────────────────────────────────
    const wiring = readFileSync(path.join(process.cwd(), 'src', 'refresh', 'rooms', 'host', 'patch-wiring.ts'), 'utf8')
    check(wiring.indexOf('recordWriteReceipt') >= 0, 'F1 补行件的装配处把写回执落库接进去（patch-wiring.ts）')
    const rowPatch = readFileSync(path.join(process.cwd(), 'src', 'refresh', 'rooms', 'host', 'row-patch.ts'), 'utf8')
    check(rowPatch.indexOf('receipt: d.recordWriteReceipt') >= 0, 'F2 写回执那条取数路把落库交下去（row-patch.ts）')
    const hostIndex = readFileSync(path.join(process.cwd(), 'src', 'host', 'index.ts'), 'utf8')
    check(hostIndex.indexOf('getSnapshotLibrary') >= 0, 'F3 宿主把快照库门面注入刷新装配（src/host/index.ts）')

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
