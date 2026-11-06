/**
 * tests/verify-1935-receipt-resync.ts —— 写回执失败的重试、重同步与「本机库落后」状态（#1935）
 *
 * 守什么（票面验收逐条落在这里）：
 *   A 有界重试：write-failed 按两档中央时间参数（5 秒、10 秒）重试，第三次仍失败才放弃；
 *     readonly / stale / legacy-writer 一次都不重试（重试对它们没有意义）。
 *   B 最终失败：写回执最终 write-failed 时置「本机库落后」，并通过注入的调度器安排一次重同步；
 *     同一段落后里只排一次；重同步跑过之后（noteResyncStarted）下一次失败还能再排。
 *   C 恢复：任何一次真的写进库（行 / 详情 / 回执）都清掉落后状态；后端改过的行会被下一次同步补进库。
 *   D 读口：readLibraryBehind 的形状（behind / reason / sinceMs），以及状态跟句柄缓存同一把键
 *     —— 换一个仓库身份就是另一份库，不共享落后状态。
 *   E 界面：truthNoticeLines 只在 snap.libraryBehind === true 时给一行 truth.libraryBehind；
 *     false / 缺省 / 只有内部 reason 都不出现（恢复后自动消失）。
 *   F 源码约定：重试延迟来自中央时间参数、重同步走既有写事件取数路并且先 remember、
 *     没有本地持久写队列、文案进 config/copy/pages.yaml。
 *
 * 为什么用假句柄造失败：真库上制造一次事务失败要么靠改权限、要么靠并发，既慢又不稳定；
 * 这一票要证的恰恰是「失败之后怎么办」，所以把失败按剧本交给句柄。恢复那一节（C）仍用真库，
 * 证明行真的落进了 SQLite，而不是只在替身里过了一遍。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1935-receipt-resync.ts
 */
// 门禁归属: src/refresh/rooms/host/write-retry.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library-behind.ts
// 门禁归属: src/refresh/rooms/host/snapshot-resync.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library-receipts.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library-sync.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library-first-screen.ts
// 门禁归属: src/refresh/rooms/host/write-event-fetch.ts
// 门禁归属: src/client/views/shared/truthLines.ts

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { printGateResult } from './lib/gate-result.ts'
import type { Issue, IssueFieldStates } from '../src/tracker/contract/entities.ts'
import {
  closeSnapshotLibraries,
  commitChangeRows,
  readIssueDetail,
  readLibraryBehind,
  recordCommentReceipt,
  recordIssueDetail,
  recordIssueRows,
  recordWriteReceipt,
} from '../src/refresh/rooms/host/snapshot-library.ts'
import { setSnapshotLibraryOpenerForTest } from '../src/refresh/rooms/host/snapshot-library-handles.ts'
import {
  __resetLibraryBehindForTests,
  clearLibraryBehind,
  markLibraryBehind,
  noteResyncStarted,
  setResyncScheduler,
} from '../src/refresh/rooms/host/snapshot-library-behind.ts'
import { firstScreenFromLibrary } from '../src/refresh/rooms/host/snapshot-library-first-screen.ts'
import {
  ingestWithRetry,
  setWriteRetrySleepForTest,
  SNAPSHOT_WRITE_RETRY_DELAYS_MS,
} from '../src/refresh/rooms/host/write-retry.ts'
import {
  SNAPSHOT_RESYNC_DELAY_MS,
  SNAPSHOT_WRITE_RETRY_FIRST_MS,
  SNAPSHOT_WRITE_RETRY_SECOND_MS,
} from '../src/shared/time-config/src/values.ts'
import { truthNoticeLines } from '../src/client/views/shared/truthLines.ts'

const GATE = 'verify-1935-receipt-resync'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const REPO = 'acme/repo-1935'
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

/** 造一张够适配层换算的票：字段与 verify-1866 的夹具同形，避免两个门禁各说一种最小票。 */
function issueOf(key: string, state = 'open'): Issue {
  const states: IssueFieldStates = {
    parents: { known: true, value: null, reason: null },
    dependencies: { known: true, value: [], reason: null },
    subIssues: { known: false, value: null, reason: 'not-applicable' },
    comments: { known: true, value: 0, reason: null },
    review: { known: false, value: null, reason: 'not-applicable' },
    mergeInfo: { known: true, value: null, reason: null },
  }
  return {
    key,
    effortId: '',
    type: 'issue',
    title: '票 ' + key,
    state,
    body: '正文 ' + key,
    url: 'https://github.com/' + REPO + '/issues/' + key,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    closedAt: state === 'closed' ? '2026-11-02T00:00:00Z' : null,
    parentKey: null,
    comments: [],
    commentCount: 0,
    fieldStates: states,
  }
}

function libKeyOf(workspaceRoot: string): any {
  return { workspaceRoot, backend: 'github', repoIdentity: REPO }
}

/** 造一个带 workspace.yaml 的临时工作区根：真库按这个根落盘（与 verify-1866 同一套夹具）。 */
function workspaceOf(name: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'verify-1935-' + name + '-'))
  mkdirSync(path.join(root, 'docs', 'agents'), { recursive: true })
  writeFileSync(path.join(root, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1935-' + name + '\n', 'utf8')
  return root
}

// ── 假句柄：按剧本回 write-failed / readonly / legacy-writer / committed ──────────────
type Verdict = 'committed' | 'write-failed' | 'stale' | 'readonly' | 'legacy-writer'

interface FakeHandle {
  handle: any
  /** 每一次 ingest 收到的那一批写入，用来数试了几次。 */
  attempts: any[]
  /** 提交成功时按行组记下的「票号 → 状态」，用来看同步有没有把行带进来。 */
  stored: Map<string, string>
}

function fakeHandleOf(verdictAt: (attemptIndex: number) => Verdict): FakeHandle {
  const attempts: any[] = []
  const stored = new Map<string, string>()
  const handle: any = {
    getMergeVersion: function (): number { return 1 },
    ingest: function (batch: any): any {
      const attemptIndex = attempts.length
      attempts.push(batch)
      const verdict = verdictAt(attemptIndex)
      if (verdict !== 'committed') return { committed: false, reason: verdict }
      for (const write of (batch && Array.isArray(batch.writes)) ? batch.writes : []) {
        const row = write && write.groups ? write.groups.row : null
        if (row && row.value) stored.set(String(write.key), String(row.value.state == null ? '' : row.value.state))
      }
      return { committed: true, mergeVersion: 2 + attemptIndex, commentPositions: [] }
    },
    // 评论回执会先读一次库里那张票；这里的假库永远没有它，planOf 会落到「只补评论组」。
    readIssueDetail: function (): any { return null },
    close: function (): void {},
  }
  return { handle, attempts, stored }
}

let slept: number[] = []
let scheduled: any[] = []

/** 每节开头的清场：落后状态、调度器、等待替身、句柄缓存全部归零，用例之间不许串。 */
function resetAll(): void {
  __resetLibraryBehindForTests()
  setSnapshotLibraryOpenerForTest(null)
  closeSnapshotLibraries()
  slept = []
  scheduled = []
  setWriteRetrySleepForTest(function (ms: number): Promise<void> { slept.push(ms); return Promise.resolve() })
}

function armScheduler(): void {
  setResyncScheduler(function (input: any): void { scheduled.push(input) })
}

async function main(): Promise<void> {
  const roots: string[] = []
  try {
    // ── A. 有界重试：只对 write-failed，两档延迟来自中央时间参数 ───────────────
    resetAll()
    check(
      SNAPSHOT_WRITE_RETRY_DELAYS_MS.join('|') === [SNAPSHOT_WRITE_RETRY_FIRST_MS, SNAPSHOT_WRITE_RETRY_SECOND_MS].join('|'),
      'A1 两档退避就是中央时间参数里的 5 秒 / 10 秒',
      SNAPSHOT_WRITE_RETRY_DELAYS_MS,
    )

    let calls = 0
    const recovered = await ingestWithRetry(function () {
      calls += 1
      return calls < 3 ? { committed: false, reason: 'write-failed' } : { committed: true, mergeVersion: 9 }
    })
    check(calls === 3, 'A2 前两次 write-failed、第三次成功：一共试了三次', calls)
    check(slept.join('|') === [SNAPSHOT_WRITE_RETRY_FIRST_MS, SNAPSHOT_WRITE_RETRY_SECOND_MS].join('|'),
      'A3 两次等待依次是第一档与第二档（来自中央时间参数）', slept)
    check(recovered.committed === true && recovered.mergeVersion === 9, 'A4 最终交回第三次的成功结果', recovered)

    calls = 0; slept = []
    const readonly = await ingestWithRetry(function () {
      calls += 1
      return { committed: false, reason: 'readonly' }
    })
    check(calls === 1 && slept.length === 0 && readonly.committed === false && readonly.reason === 'readonly',
      'A5 readonly 一次都不重试（磁盘本来不可写，重试只是白等）', { calls, slept, readonly })

    calls = 0; slept = []
    const stale = await ingestWithRetry(function () {
      calls += 1
      return { committed: false, reason: 'stale' }
    })
    check(calls === 1 && slept.length === 0 && stale.committed === false,
      'A6 stale 一次都不重试（期间有更新的结果落地，重试带回来的还是旧数据）', { calls, slept })

    calls = 0; slept = []
    const legacy = await ingestWithRetry(function () {
      calls += 1
      return { committed: false, reason: 'legacy-writer' }
    })
    check(calls === 1 && slept.length === 0 && legacy.committed === false,
      'A7 legacy-writer 一次都不重试（旧窗口还占着写权，重启之前写不进去）', { calls, slept })

    calls = 0; slept = []
    const exhausted = await ingestWithRetry(function () {
      calls += 1
      return { committed: false, reason: 'write-failed' }
    })
    check(calls === 3 && slept.length === 2 && exhausted.committed === false && exhausted.reason === 'write-failed',
      'A8 一直 write-failed：试满三次就放弃，不再等第四档', { calls, slept, exhausted })

    // ── B. 写回执最终失败 → 置落后状态 + 排一次重同步 ───────────────────────────
    resetAll()
    const rootB1 = path.join(os.tmpdir(), 'verify-1935-b1')
    const keyB1 = libKeyOf(rootB1)
    // 先在没有调度器的状态下置一次落后（模拟上一笔失败已经标过），成功回执要把它清掉。
    markLibraryBehind(keyB1, 'write-failed')
    armScheduler()
    const fakeB1 = fakeHandleOf(function (index: number): Verdict { return index < 2 ? 'write-failed' : 'committed' })
    setSnapshotLibraryOpenerForTest(async function () { return { handle: fakeB1.handle } })
    const wroteB1: any = await recordWriteReceipt(Object.assign({ issues: [issueOf('11', 'closed')], operation: 'close' }, keyB1))
    check(fakeB1.attempts.length === 3, 'B1 回执写失败两次后成功：假库一共收到三次 ingest', fakeB1.attempts.length)
    check(wroteB1.ok === true, 'B2 写回执最终提交成功', wroteB1)
    check(readLibraryBehind(keyB1).behind === false, 'B3 写成功之后落后状态被清掉', readLibraryBehind(keyB1))
    check(fakeB1.stored.get('11') === 'closed', 'B4 回执真的按行组写进了（提交那次）', fakeB1.stored.get('11'))

    resetAll()
    const rootB2 = path.join(os.tmpdir(), 'verify-1935-b2')
    const keyB2 = libKeyOf(rootB2)
    armScheduler()
    const fakeB2 = fakeHandleOf(function (): Verdict { return 'write-failed' })
    setSnapshotLibraryOpenerForTest(async function () { return { handle: fakeB2.handle } })
    const failedB2: any = await recordWriteReceipt(Object.assign({ issues: [issueOf('12')], operation: 'update' }, keyB2))
    check(fakeB2.attempts.length === 3 && slept.join('|') === [SNAPSHOT_WRITE_RETRY_FIRST_MS, SNAPSHOT_WRITE_RETRY_SECOND_MS].join('|'),
      'B5 一直 write-failed：回执试满三次，两档等待各一次', { attempts: fakeB2.attempts.length, slept })
    check(failedB2.ok === false && failedB2.reason === 'write-failed', 'B6 回执如实回失败与原因', failedB2)
    const behindB2 = readLibraryBehind(keyB2)
    check(behindB2.behind === true && behindB2.reason === 'write-failed' && behindB2.sinceMs > 0,
      'B7 最终失败置「本机库落后」，reason 保留 write-failed', behindB2)
    check(scheduled.length === 1, 'B8 同一段落后只安排一次重同步', scheduled)
    check(scheduled.length === 1 && scheduled[0].workspaceRoot === rootB2 && scheduled[0].backend === 'github' && scheduled[0].repoIdentity === REPO,
      'B9 排重同步时带的就是库身份三格（工作区、后端、仓库身份）', scheduled[0])

    await recordWriteReceipt(Object.assign({ issues: [issueOf('12')], operation: 'update' }, keyB2))
    check(scheduled.length === 1, 'B10 连续两次失败仍只排一次（重同步还没跑完）', scheduled.length)

    noteResyncStarted(keyB2)
    await recordWriteReceipt(Object.assign({ issues: [issueOf('12')], operation: 'update' }, keyB2))
    check(scheduled.length === 2, 'B11 重同步跑过之后下一次失败还能再排一次（一次抖动不把工作区永久钉住）', scheduled.length)

    resetAll()
    const rootB3 = path.join(os.tmpdir(), 'verify-1935-b3')
    const keyB3 = libKeyOf(rootB3)
    armScheduler()
    const fakeB3 = fakeHandleOf(function (): Verdict { return 'readonly' })
    setSnapshotLibraryOpenerForTest(async function () { return { handle: fakeB3.handle } })
    const readonlyB3: any = await recordWriteReceipt(Object.assign({ issues: [issueOf('13')], operation: 'update' }, keyB3))
    check(readonlyB3.ok === false && readonlyB3.reason === 'readonly' && fakeB3.attempts.length === 1,
      'B12 readonly 不重试就交回失败', { result: readonlyB3, attempts: fakeB3.attempts.length })
    check(readLibraryBehind(keyB3).behind === false && scheduled.length === 0,
      'B13 readonly 不置落后、也不排重同步（重同步写不进去，只会让用户空等）', { behind: readLibraryBehind(keyB3), scheduled })

    resetAll()
    const rootB4 = path.join(os.tmpdir(), 'verify-1935-b4')
    const keyB4 = libKeyOf(rootB4)
    armScheduler()
    const fakeB4 = fakeHandleOf(function (): Verdict { return 'write-failed' })
    setSnapshotLibraryOpenerForTest(async function () { return { handle: fakeB4.handle } })
    const failedB4: any = await recordCommentReceipt(Object.assign({
      keys: ['14'],
      effortId: '',
      comment: {
        id: 'c1',
        body: '刚发的评论',
        author: { login: 'alice' },
        authorAssociation: 'MEMBER',
        createdAt: '2026-11-03T00:00:00Z',
        updatedAt: '2026-11-03T00:00:00Z',
      },
    }, keyB4))
    check(failedB4.ok === false && fakeB4.attempts.length === 3, 'B14 评论回执同样走有界重试（三次）', { result: failedB4, attempts: fakeB4.attempts.length })
    check(readLibraryBehind(keyB4).behind === true && scheduled.length === 1,
      'B15 评论回执最终失败也置落后并排一次重同步', { behind: readLibraryBehind(keyB4), scheduled: scheduled.length })

    // ── C. 恢复：任何一次真的写进库都清落后；下一次同步把行补进来 ───────────────
    resetAll()
    const rootC = workspaceOf('c')
    roots.push(rootC)
    const keyC = libKeyOf(rootC)
    armScheduler()
    const fakeC = fakeHandleOf(function (): Verdict { return 'write-failed' })
    setSnapshotLibraryOpenerForTest(async function () { return { handle: fakeC.handle } })
    const failedC: any = await recordWriteReceipt(Object.assign({ issues: [issueOf('41', 'closed')], operation: 'close' }, keyC))
    check(failedC.ok === false && readLibraryBehind(keyC).behind === true,
      'C1 真库这一侧的回执失败（假句柄模拟）：落后状态置起来', failedC)
    // 切回真库：假句柄没有往任何库里写过一个字节。
    setSnapshotLibraryOpenerForTest(null)
    closeSnapshotLibraries()
    const missingC: any = await readIssueDetail(Object.assign({ key: '41', effortId: '' }, keyC))
    check(missingC === null || missingC.issue == null, 'C2 回执失败的那一笔没有落进本机库（库里还没有这张票）', missingC)

    const syncedC: any = await recordIssueRows(Object.assign({ rows: [issueOf('41', 'closed')] }, keyC))
    check(syncedC.ok === true && syncedC.rows === 1, 'C3 下一次同步把后端改过的行写进库', syncedC)
    check(readLibraryBehind(keyC).behind === false, 'C4 行写成功之后落后状态清除', readLibraryBehind(keyC))
    const landedC: any = await readIssueDetail(Object.assign({ key: '41', effortId: '' }, keyC))
    check(!!landedC && !!landedC.issue && landedC.issue.row.state === 'closed',
      'C5 补进来的行就是后端改过的状态（closed）', landedC && landedC.issue && landedC.issue.row)

    resetAll()
    const rootD = workspaceOf('d')
    roots.push(rootD)
    const keyD = libKeyOf(rootD)
    markLibraryBehind(keyD, 'write-failed')
    const detailD: any = await recordIssueDetail(Object.assign({ issue: issueOf('42') }, keyD))
    check(detailD.ok === true && readLibraryBehind(keyD).behind === false,
      'C6 详情写成功也清掉落后状态（任何一次写进库的成功都算追上）', { result: detailD, behind: readLibraryBehind(keyD) })

    // C7/C8：重同步真正走的「变化行提交」这一口也要清状态，只写簿记的那一趟不能清。
    resetAll()
    const rootC2 = path.join(os.tmpdir(), 'verify-1935-c2')
    const keyC2 = libKeyOf(rootC2)
    const fakeC2 = fakeHandleOf(function (): Verdict { return 'committed' })
    setSnapshotLibraryOpenerForTest(async function () { return { handle: fakeC2.handle } })
    markLibraryBehind(keyC2, 'write-failed')
    const changedC2: any = await commitChangeRows(Object.assign({ rows: [issueOf('43', 'closed')], startMergeVersion: 1 }, keyC2))
    check(changedC2.ok === true && readLibraryBehind(keyC2).behind === false,
      'C7 变化行提交成功也清落后状态（重同步补进来的就是这条路）', { result: changedC2, behind: readLibraryBehind(keyC2) })
    markLibraryBehind(keyC2, 'write-failed')
    const emptyC2: any = await commitChangeRows(Object.assign({ rows: [], startMergeVersion: 1 }, keyC2))
    check(emptyC2.ok === true && readLibraryBehind(keyC2).behind === true,
      'C8 一行都没补的探测不清状态（没有数据追上，不能替「落后」作保）', { result: emptyC2, behind: readLibraryBehind(keyC2) })

    // ── D. 读口形状与键隔离 ───────────────────────────────────────────────────
    resetAll()
    const keyE = libKeyOf(path.join(os.tmpdir(), 'verify-1935-e'))
    const none = readLibraryBehind(keyE)
    check(none.behind === false && none.reason === '' && none.sinceMs === 0,
      'D1 没落后时回形状完整的「没落后」，不返回 null', none)
    const marked = markLibraryBehind(keyE, 'write-failed')
    check(marked.behind === true && marked.reason === 'write-failed' && marked.sinceMs > 0,
      'D2 置位后回 behind / reason / sinceMs 三格', marked)
    const again = markLibraryBehind(keyE, 'write-failed')
    check(again.sinceMs === marked.sinceMs, 'D3 重复置位不刷新 sinceMs（它回答的是「落后了多久」）', { first: marked.sinceMs, again: again.sinceMs })
    check(readLibraryBehind(Object.assign({}, keyE, { repoIdentity: 'other/repo' })).behind === false,
      'D4 换一个仓库身份就是另一份库，不共享落后状态', readLibraryBehind(Object.assign({}, keyE, { repoIdentity: 'other/repo' })))
    markLibraryBehind(Object.assign({}, keyE, { workspaceRoot: '' }), 'write-failed')
    check(readLibraryBehind(Object.assign({}, keyE, { workspaceRoot: '' })).behind === false,
      'D5 没有工作区的键不记账（找不到该给哪个库清状态）')

    // ── E. 界面那一行只在真落后时出现 ─────────────────────────────────────────
    const shown = truthNoticeLines({ snapshot: { libraryBehind: true } }, 1)
    const behindLines = shown.filter(function (line: any) { return line && line.key === 'truth.libraryBehind' })
    check(behindLines.length === 1, 'E1 snap.libraryBehind === true 时列表状态行有 truth.libraryBehind 一行', shown)
    check(behindLines.length === 1 && behindLines[0].kind === 'behind' && behindLines[0].tone === 'yellow',
      'E2 这一行是黄档、kind 为 behind（与失败、暂停那些行区分得开）', behindLines[0])
    const absent = truthNoticeLines({ snapshot: {} }, 1)
    check(absent.every(function (line: any) { return line && line.key !== 'truth.libraryBehind' }),
      'E3 缺省（没落后）不出现这一行：恢复后自动消失', absent)
    const falseFlag = truthNoticeLines({ snapshot: { libraryBehind: false } }, 1)
    check(falseFlag.every(function (line: any) { return line && line.key !== 'truth.libraryBehind' }),
      'E4 libraryBehind === false 也不出现', falseFlag)
    const reasonOnly = truthNoticeLines({ snapshot: { libraryBehindReason: 'write-failed' } }, 1)
    check(reasonOnly.every(function (line: any) { return line && line.key !== 'truth.libraryBehind' }),
      'E5 只带内部 reason、没有布尔标记时不出现（界面只认布尔真）', reasonOnly)
    const pendingLate = truthNoticeLines({ snapMode: 'err', snapError: 'x', snapPending: true, snapshot: { libraryBehind: true } }, 1)
    check(pendingLate.length === 1 && pendingLate[0].key === 'truth.pendingLate',
      'E6 还在等首屏时沿用那一行，不抢着说落后（没有快照可谈落后）', pendingLate)

    // E7/E8：首屏回包（两种后端共用的 decorate）把标记挂给界面，没落后时不挂。
    resetAll()
    const keyE2 = libKeyOf(path.join(os.tmpdir(), 'verify-1935-e2'))
    const fakeLib: any = {
      readSnapshotReplay: async function (): Promise<any> {
        return { snapshot: { maps: [], issues: [], deck: {} }, lastKnownAtMs: 1, mergeVersion: 1, rows: 1, projectionMs: 0 }
      },
      recordIssueRows: async function (): Promise<any> { return { ok: true } },
      readSnapshotDiagnostics: async function (): Promise<any[]> { return [] },
    }
    const screen: any = await firstScreenFromLibrary({
      getSnapshotLibrary: function (): any { return fakeLib },
      workspaceRoot: keyE2.workspaceRoot,
      backend: keyE2.backend,
      repoIdentity: keyE2.repoIdentity,
      repo: { backend: 'github', refId: REPO, name: 'repo', url: '' },
    })
    const snapBehind: any = {}
    markLibraryBehind(keyE2, 'write-failed')
    screen.decorate(snapBehind)
    check(snapBehind.libraryBehind === true && snapBehind.libraryBehindReason === 'write-failed',
      'E7 首屏 decorate 把 libraryBehind / reason 挂到回包上（两种后端同一条路）', snapBehind)
    clearLibraryBehind(keyE2)
    const snapHealthy: any = {}
    screen.decorate(snapHealthy)
    check(snapHealthy.libraryBehind === undefined && snapHealthy.libraryBehindReason === undefined,
      'E8 没落后时回包上没有这两个字段（恢复后自动消失）', snapHealthy)

    // ── F. 源码约定 ──────────────────────────────────────────────────────────
    function sourceOf(rel: string): string {
      return readFileSync(path.join(ROOT, rel), 'utf8')
    }
    function codeOnly(text: string): string {
      return text.split('\n').filter(function (line: string): boolean {
        const trimmed = line.trim()
        return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'))
      }).join('\n')
    }
    const retrySrc = sourceOf('src/refresh/rooms/host/write-retry.ts')
    check(retrySrc.indexOf('SNAPSHOT_WRITE_RETRY_FIRST_MS') >= 0 && retrySrc.indexOf('SNAPSHOT_WRITE_RETRY_SECOND_MS') >= 0,
      'F1 重试延迟从中央时间参数导入（不在这里另定一份）')
    check(!/(^|[^0-9])(5000|10000)([^0-9]|$)/.test(codeOnly(retrySrc)),
      'F2 代码里没有写死 5000 / 10000 这两个数字')

    const behindSrc = sourceOf('src/refresh/rooms/host/snapshot-library-behind.ts')
    check(behindSrc.indexOf('cacheKeyOf') >= 0 && behindSrc.indexOf('snapshot-library-handles.js') >= 0,
      'F3 落后状态的键与句柄缓存同一把（cacheKeyOf）')
    check(!/node:fs|node:sqlite|CREATE TABLE|localStorage|sessionStorage/.test(behindSrc),
      'F4 落后状态只在内存里：没有文件、数据库表或浏览器存储')
    check(!/\bqueue\b/i.test(codeOnly(behindSrc)),
      'F5 落后状态没有写队列实现（票面明确不做持久队列；文件级检查见 F14）')

    const resyncSrc = sourceOf('src/refresh/rooms/host/snapshot-resync.ts')
    check(resyncSrc.indexOf('SNAPSHOT_RESYNC_DELAY_MS') >= 0, 'F6 重同步延迟从中央时间参数导入')
    check(!/(^|[^0-9])2000([^0-9]|$)/.test(codeOnly(resyncSrc)), 'F7 代码里没有写死 2000 毫秒')
    check(resyncSrc.indexOf('remember') >= 0 && resyncSrc.indexOf('resync') >= 0,
      'F8 重同步先让写事件取数记住工作区根，再复用它的取数（不新造取数路）')
    check(sourceOf('src/refresh/rooms/host/write-event-fetch.ts').indexOf('resync') >= 0,
      'F9 写事件取数那一格有 resync 入口（重同步走的就是它）')
    check(sourceOf('src/refresh/rooms/host/refresh-runtime.ts').indexOf('installResyncWiring') >= 0,
      'F10 宿主接线把重同步入口接上了')
    check(sourceOf('src/refresh/rooms/host/snapshot-library-first-screen.ts').indexOf('snap.libraryBehind = true') >= 0,
      'F11 首屏 decorate 把 libraryBehind 挂到回包上（两种后端同一条路）')
    const receiptsSrc = sourceOf('src/refresh/rooms/host/snapshot-library-receipts.ts')
    check(receiptsSrc.indexOf('markLibraryBehind') >= 0 && receiptsSrc.indexOf('ingestWithRetry') >= 0,
      'F12 两个回执写口在最终失败时置落后状态，重试与置位在同一处')
    check(sourceOf('src/refresh/rooms/host/snapshot-library.ts').indexOf('snapshot-library-receipts.js') >= 0,
      'F13 库门面把两个回执写口原样转出（调用方不用改）')

    const pages = sourceOf('config/copy/pages.yaml')
    check(pages.indexOf('truth.libraryBehind: 本机数据落后，正在重新同步') >= 0 && pages.indexOf('truth.libraryBehind: Local data is behind; resyncing') >= 0,
      'F14 文案进了 config/copy/pages.yaml 的中英两段')

    const queueFiles: string[] = []
    const walk = function (dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (/(write|receipt|resync)[-_]?queue/i.test(entry.name)) queueFiles.push(full)
      }
    }
    // 只扫本票涉及的两处（快照库门面目录与快照库实现）；清单里没有新增写队列文件。
    // 不扫整棵 src：src/tracker/rooms/markdown/write-queue.ts 是本地 Markdown 后端早就有的文件写队列，
    // 与这里的「写回执重试」无关，按文件名扫整棵树会把它误判成这一票新增的东西。
    walk(path.join(ROOT, 'src', 'refresh', 'rooms', 'host'))
    walk(path.join(ROOT, 'src', 'workspace-snapshot'))
    check(queueFiles.length === 0, 'F15 快照库相关目录里没有新增写队列文件', queueFiles)

    printGateResult(GATE, total, failed)
  } finally {
    setWriteRetrySleepForTest(null)
    setSnapshotLibraryOpenerForTest(null)
    closeSnapshotLibraries()
    __resetLibraryBehindForTests()
    for (const root of roots) {
      try { rmSync(root, { recursive: true, force: true }) } catch (e) { /* 临时目录删不掉不影响结论 */ }
    }
  }
}

main().catch(function (error: any): void {
  console.log('FAIL 门禁自己抛错：' + String((error && error.stack) || error))
  printGateResult(GATE, total, failed + 1)
})
