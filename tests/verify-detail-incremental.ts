/**
 * tests/verify-detail-incremental.ts —— 详情读结果并进快照的增量合并门禁（#1694）
 *
 * 守什么：详情页那条读通路取回的结果不再只是「一份内存详情缓存」，而是走 #1690 的合并服务
 * 并进面板快照：按字段组掩码合并、版本门丢过期、没有基线快照时不凭空造。
 *
 * 逐条对应票 #1694 验收：
 *   A 增量：完整详情只改这张票那一行（别的行对象引用不动），正文/评论/关系按字段组换新；
 *     快照信封版本 snapshot.version 一个字节不动，合并版本 snapshot.merge.version 单调 +1；
 *     合并后的快照同时写回内存与磁盘（面板刷新与跨重启都读得到这份详情）。
 *   B 降级不缩数据：完整查询后再来一份 REST 降级（关系组未表达），父边、依赖边、子票计数、
 *     已取评论与评审一条不减少，只更新这次真表达了的行组与正文。
 *   C 版本门：取数开始后快照又被别人推进过，这份更旧的详情结果整份丢弃（快照原引用不动、版本不跳号）。
 *   D 失败不清空：会话 get 失败时详情回包如实失败，快照一个字节不动（不清空上一次已知）。
 *   E 无基线：宿主还没有快照时不凭空造一份，只把详情按老形状交回客户端。
 *
 * 为什么用真模块跑：这一条守的是「详情到底有没有并进快照、降级会不会把已知抹掉」，
 * 换一种等价的合并实现而结论不变时不该误报；假会话只替掉网络，合并在真模块里发生。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-detail-incremental.ts
 */
// 门禁归属: src/refresh/rooms/host/detail-snapshot-merge.ts
// 门禁归属: src/refresh/rooms/host/comment-thread-fetch.ts
// 门禁归属: src/refresh/kernel/snapshot-merge.ts

import { printGateResult } from './lib/gate-result.ts'
import * as merger from '../src/refresh/kernel/snapshot-merge.ts'
import { createDetailSnapshotMerge } from '../src/refresh/rooms/host/detail-snapshot-merge.ts'
import { createCommentThreads } from '../src/refresh/rooms/host/comment-thread-fetch.ts'

const GATE = 'verify-detail-incremental'
const CWD = 'D:/ws/demo'
let total = 0
let failed = 0
function check(cond: any, message: string, detail?: any): void {
  total += 1
  if (cond) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

const CLOCK0 = 1761900000000
function row(n: number, extra?: any): any {
  return Object.assign({
    number: n,
    key: String(n),
    title: '票 ' + n,
    state: 'OPEN',
    labels: [],
    assignees: [],
    author: { login: 'me' },
    updatedAt: '2026-10-30T00:00:00Z',
    createdAt: '2026-10-01T00:00:00Z',
  }, extra || {})
}
function baseSnapshot(): any {
  return {
    version: 'v0',
    issues: [
      row(201, {
        title: '票 201',
        body: '旧正文',
        parentKey: '100',
        blockedBy: [{ key: '301', number: 301, title: '阻塞 301', state: 'OPEN' }],
        subIssueCounts: { total: 3, completed: 1, percentCompleted: 33 },
        comments: [{ body: '老评论' }],
        commentCount: 1,
        reviews: [{ state: 'APPROVED' }],
        mergedAt: null,
      }),
      row(205),
    ],
    maps: [{ number: 100, key: '100', title: '地图 100', state: 'OPEN', tickets: [row(201)] }],
    deck: { counts: { open: 2, closed: 0, total: 2 }, partial: false, levels: [] },
    merge: { version: 5, lastStartMs: 0, groups: {} },
  }
}
function provenance(source: string, fieldGroups: any, extra?: any): any {
  return Object.assign({
    operation: 'get',
    source: source,
    completeness: 'complete',
    fieldGroups: fieldGroups,
    missingFieldGroups: [],
    durationMs: 5,
    startVersion: 'read-v1-1-000001',
  }, extra || {})
}
function completeIssue(over?: any): any {
  return Object.assign({
    key: '201',
    title: '票 201 新',
    state: 'open',
    body: '新正文',
    url: 'https://github.com/o/r/issues/201',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-31T00:00:00Z',
    closedAt: null,
    author: { login: 'alice' },
    labels: [{ name: 'bug', color: 'd73a4a' }],
    assignees: [{ login: 'me' }],
    isPullRequest: false,
    comments: [{ body: '评论一' }],
    blockedBy: [{ key: '302', number: 302, title: '阻塞 302', state: 'OPEN' }],
    reviews: [{ state: 'APPROVED' }],
    mergedAt: null,
    fieldStates: {
      parents: { known: true, value: '100', reason: null },
      dependencies: { known: true, value: [{ key: '302', number: 302, title: '阻塞 302', state: 'OPEN' }], reason: null },
      subIssues: { known: true, value: { total: 4, completed: 2, percentCompleted: 50 }, reason: null },
      comments: { known: true, value: 1, reason: null },
      review: { known: true, value: [{ state: 'APPROVED' }], reason: null },
      mergeInfo: { known: true, value: null, reason: null },
    },
  }, over || {})
}
const COMPLETE_GROUPS = { row: 'complete', body: 'complete', labels: 'complete', parents: 'complete', dependencies: 'complete', subIssues: 'complete', comments: 'complete', review: 'complete', mergeInfo: 'complete' }

// ---------------------------------------------------------------------------
// 假宿主：一格内存快照 + 一个磁盘写盘口，合并在真模块里发生
// ---------------------------------------------------------------------------
let store: any = { ts: 0, snapshot: baseSnapshot(), error: null, cwd: CWD }
let diskWrites: any[] = []
let memWrites = 0
const getCache = function (cwd: any) { return cwd === CWD ? store : { ts: 0, snapshot: null, error: null, cwd: cwd } }
const setCache = function (v: any) { store = v; memWrites += 1 }
const writeDiskCache = async function (repo: any, snap: any) { diskWrites.push({ repo: repo, snapshot: snap }) }
const getRepoKey = async function () { return { owner: 'o', name: 'r' } }
const detailMerge = createDetailSnapshotMerge({ getCache: getCache, setCache: setCache, writeDiskCache: writeDiskCache, getRepoKey: getRepoKey, now: function () { return CLOCK0 } })

let getMode: 'ok' | 'fail' = 'ok'
let nextResult: any = { data: completeIssue(), provenance: provenance('graphql', COMPLETE_GROUPS) }
let getCalls = 0
async function openSession(): Promise<any> {
  return {
    ok: true,
    backendId: 'github',
    budget: {},
    repoRef: { backend: 'github', refId: 'o/r', name: 'o/r', url: 'https://github.com/o/r' },
    call: async function (fn: any) {
      const session = {
        get: async function () {
          getCalls += 1
          if (getMode === 'fail') return { ok: false, error: { kind: 'rateLimit', message: '配额用完了' } }
          return { ok: true, data: nextResult.data, provenance: nextResult.provenance }
        },
      }
      return fn(session, { cwd: CWD, caller: 'refresh' })
    },
  }
}
const deps: any = {
  openSession: openSession,
  normCwd: async function (x: any) { return x },
  selectEarly: async function () { throw new Error('读路径不应再调 selectEarly') },
  isComposerSelection: function () { throw new Error('读路径不应再调 isComposerSelection') },
  getTrackerRegistry: async function () { return {} },
  getPlatform: async function () { return { resolveExecutable: async function () { return 'gh' } } },
  ctx: { get: function () { return undefined } },
  timer: { timeout: function () { return function () {} } },
  DEFAULT_CWD: '',
  errText: function (e: any) { return String((e && e.message) || e) },
  isRateLimitError: function () { return false },
  getRepoKey: getRepoKey,
  execProc: async function () { throw new Error('详情读路径不应直调 exec') },
  fetchIssueDetail: async function () { throw new Error('详情不应回退旧详情路') },
  fetchIssueIndex: async function () { throw new Error('详情不应回退旧索引路') },
  issueIndexFromSnapshot: function () { return { ok: false } },
  setCache: setCache,
  getCache: getCache,
  writeDiskCache: writeDiskCache,
  logCtx: { fire: function () {} },
}
const handlers = createCommentThreads(deps)

// ---------------------------------------------------------------------------
// A 增量：完整详情只改这一行，别的行对象引用不动，信封版本不动、合并版本 +1
// ---------------------------------------------------------------------------
const before = store.snapshot
const row205Before = before.issues[1]
const r1 = await handlers.handleIssueDetail({ number: 201, cwd: CWD })
check(r1 && r1.ok === true, 'A1 详情取数成功')
check(r1 && r1.issue && r1.issue.title === '票 201 新' && r1.issue.body === '新正文', 'A2 详情按老形状交回（标题/正文是这次读到的）')
check(r1 && r1.snapshot && r1.snapshot.accepted === true, 'A3 回包记下这次已并进快照')
const snap1 = store.snapshot
check(snap1 !== before && before.issues[0].body === '旧正文', 'A4 快照换了新对象，旧快照一个字节不动')
check(snap1.issues.length === 2, 'A5 行数不变（详情只并这一张票）', snap1.issues.length)
check(snap1.issues[1] === row205Before, 'A6 无关行对象引用不动（下游不重渲染）')
const r201 = snap1.issues[0]
check(r201.title === '票 201 新' && r201.body === '新正文' && r201.updatedAt === '2026-10-31T00:00:00Z', 'A7 行组与正文换成本次取到的值')
check(r201.commentCount === 1 && Array.isArray(r201.comments) && r201.comments[0].body === '评论一', 'A8 评论与总数按完整来源换新')
check(Array.isArray(r201.blockedBy) && r201.blockedBy[0].key === '302', 'A9 依赖边换成本次取到的值')
check(snap1.version === 'v0', 'A10 信封契约版本 snapshot.version 一个字节不动', snap1.version)
check(merger.mergeVersionOf(snap1) === 6, 'A11 合并版本单调 +1', merger.mergeVersionOf(snap1))
const bodyStamp = snap1.merge && snap1.merge.groups && snap1.merge.groups.body
check(!!bodyStamp && typeof bodyStamp.atMs === 'number' && bodyStamp.atMs > 0 && bodyStamp.source === 'graphql' && bodyStamp.completeness === 'complete', 'A12 合并组戳记下来源与时刻（界面「上次数据」用它）', bodyStamp)
check(memWrites >= 1 && diskWrites.length === 1, 'A13 合并后的快照写回内存与磁盘', { mem: memWrites, disk: diskWrites.length })
check(!Object.prototype.hasOwnProperty.call(r201, 'provenance'), 'A14 一次读的簿记（provenance）不写进快照')

// ---------------------------------------------------------------------------
// B 降级不缩数据：REST 只表达行组与正文，关系组一条不减少
// ---------------------------------------------------------------------------
const degradedProvenance = provenance('rest', { row: 'complete', body: 'complete' }, { degradedFrom: 'graphql', completeness: 'partial' })
const degradedIssue = completeIssue({
  title: '票 201 降级标题',
  body: '降级正文',
  updatedAt: '2026-11-01T00:00:00Z',
  parentKey: null,
  comments: [],
  blockedBy: [],
  reviews: [],
  mergedAt: null,
  fieldStates: {
    parents: { known: false, value: null, reason: 'not-expressed' },
    dependencies: { known: false, value: null, reason: 'not-expressed' },
    subIssues: { known: false, value: null, reason: 'not-expressed' },
    comments: { known: false, value: null, reason: 'not-expressed' },
    review: { known: false, value: null, reason: 'not-expressed' },
    mergeInfo: { known: false, value: null, reason: 'not-expressed' },
  },
})
nextResult = { data: degradedIssue, provenance: degradedProvenance }
const r2 = await handlers.handleIssueDetail({ number: 201, cwd: CWD })
const snap2 = store.snapshot
const d201 = snap2.issues[0]
check(r2 && r2.ok === true && r2.snapshot.accepted === true, 'B1 降级详情也并进快照')
check(d201.parentKey === '100', 'B2 降级不删父边', d201.parentKey)
check(Array.isArray(d201.blockedBy) && d201.blockedBy.length === 1 && d201.blockedBy[0].key === '302', 'B3 降级不删依赖边', d201.blockedBy)
check(d201.subIssueCounts && d201.subIssueCounts.total === 4, 'B4 降级不缩子票计数', d201.subIssueCounts)
check(d201.commentCount === 1 && d201.comments.length === 1, 'B5 降级不缩评论与总数', { n: d201.commentCount, list: d201.comments })
check(Array.isArray(d201.reviews) && d201.reviews.length === 1, 'B6 降级不缩评审', d201.reviews)
check(d201.body === '降级正文' && d201.title === '票 201 降级标题', 'B7 这次真表达了的正文与行组照常换新')
check(merger.mergeVersionOf(snap2) === 7, 'B8 第二次合并版本 7')

// ---------------------------------------------------------------------------
// C 版本门：取数开始后快照被推进过，更旧的详情整份丢弃
// ---------------------------------------------------------------------------
const token = detailMerge.begin(CWD)
nextResult = { data: completeIssue({ title: '票 201 并发新' }), provenance: provenance('graphql', COMPLETE_GROUPS) }
await handlers.handleIssueDetail({ number: 201, cwd: CWD })
const snapAfterConcurrent = store.snapshot
const versionAfterConcurrent = merger.mergeVersionOf(snapAfterConcurrent)
const staleIssue = completeIssue({ title: '票 201 过期结果', updatedAt: '2026-10-01T00:00:00Z' })
const staleOut = await detailMerge.merge(CWD, token, { issue: staleIssue, provenance: provenance('graphql', COMPLETE_GROUPS) })
check(staleOut && staleOut.accepted === false && staleOut.stale === true, 'C1 过期详情整份丢弃', staleOut && staleOut.reason)
check(store.snapshot === snapAfterConcurrent, 'C2 过期结果不改快照（原引用返回）')
check(merger.mergeVersionOf(store.snapshot) === versionAfterConcurrent, 'C3 过期结果不让合并版本跳号')
check(store.snapshot.issues[0].title === '票 201 并发新', 'C4 快照里仍是更晚那次结果')

// ---------------------------------------------------------------------------
// D 失败不清空：get 失败时快照一个字节不动
// ---------------------------------------------------------------------------
const snapBeforeFail = store.snapshot
const writesBeforeFail = memWrites
getMode = 'fail'
const rFail = await handlers.handleIssueDetail({ number: 201, cwd: CWD })
check(rFail && rFail.ok === false, 'D1 详情取数失败如实交回失败')
check(store.snapshot === snapBeforeFail && memWrites === writesBeforeFail, 'D2 失败一次不清空也不能改快照')
getMode = 'ok'

// ---------------------------------------------------------------------------
// E 无基线：宿主还没有快照时不凭空造一份
// ---------------------------------------------------------------------------
store = { ts: 0, snapshot: null, error: null, cwd: CWD }
nextResult = { data: completeIssue(), provenance: provenance('graphql', COMPLETE_GROUPS) }
const rNoBase = await handlers.handleIssueDetail({ number: 201, cwd: CWD })
check(rNoBase && rNoBase.ok === true, 'E1 没有基线快照时详情仍按老形状交回')
check(rNoBase && rNoBase.snapshot === undefined, 'E2 没有基线快照时不交「已合并」')
check(store.snapshot === null, 'E3 没有基线快照时不凭空造一份')

console.log('详情增量合并门禁：' + (total - failed) + '/' + total + ' 通过')
printGateResult(GATE, total, failed)
process.exit(failed ? 1 : 0)
