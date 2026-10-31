/**
 * tests/verify-acceptance-four.ts —— 规格 #1681 四条验收的联合门禁（#1694）
 *
 * 守什么：四条要求在「真快照路径」上一起成立 —— 不是假状态渲染，也不是只看一个纯函数：
 *   要求 1 降级不缩数据：完整详情读进快照后，再来一次 REST 降级（关系组未表达），
 *     父边、依赖边、子票计数、已取正文、评论、评审一条不减少；只认这次真表达了的行组与正文。
 *   要求 2 地图里点开一张票先显示已知阻塞：详情页首帧从快照行读已知阻塞边（数组形状也认），
 *     没取到阻塞信息时不凭空说「没有阻塞」。
 *   要求 3 详情里关掉一张票，列表与地图在同一份快照里立即一致：写回执经行级补行管道并入快照后，
 *     issues 与 maps[].tickets 两处是同一个结论；取数失败时快照一个字节不动（不做乐观修改）。
 *   要求 4 详情永久增量合并：详情合并后的快照随盘写回；把它当重启后的快照再来一次部分读，
 *     上次已知的正文/关系仍在，合并版本继续单调递增，过期结果整份丢弃。
 * 每条要求一正例一负例，逐条断言；门禁用真模块（detail-snapshot-merge、row-patch、snapshot-merge、投影纯函数）。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-acceptance-four.ts
 */
// 门禁归属: src/refresh/rooms/host/detail-snapshot-merge.ts
// 门禁归属: src/refresh/rooms/host/row-patch.ts
// 门禁归属: src/client/views/shared/detailProjection.ts

import { printGateResult } from './lib/gate-result.ts'
import * as merger from '../src/refresh/kernel/snapshot-merge.ts'
import * as delta from '../src/refresh/kernel/snapshot-diff.ts'
import * as win from '../src/refresh/kernel/index-window-rules.ts'
import { createDetailSnapshotMerge } from '../src/refresh/rooms/host/detail-snapshot-merge.ts'
import { createPatch } from '../src/refresh/rooms/host/row-patch.ts'
import { knownBlockedNodes, detailViewFor } from '../src/client/views/shared/detailProjection.ts'

// 投影模块在真闭包里由构建提供 tr / idOfParts；独立 import 时按同样形状垫上（只为门禁能跑，不是第二份实现）。
;(globalThis as any).tr = function (key: any, params?: any) {
  let s: string = String(key)
  if (params) s = s.replace(/\{(\w+)\}/g, function (m: string, n: string) { return n in params ? String(params[n]) : m })
  return s
}
;(globalThis as any).idOfParts = function (a: any, b: any) { return String(a) + '\u0000' + String(b) }

const GATE = 'verify-acceptance-four'
const CWD = 'D:/ws/demo'
const WS = 'ws-demo'
const CLOCK0 = 1761900000000
let total = 0
let failed = 0
function check(cond: any, message: string, detail?: any): void {
  total += 1
  if (cond) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

function row(n: number, extra?: any): any {
  return Object.assign({ number: n, key: String(n), title: '票 ' + n, state: 'OPEN', updatedAt: '2026-10-30T00:00:00Z', labels: [], assignees: [], createdAt: '2026-10-01T00:00:00Z' }, extra || {})
}
function snapshot(): any {
  return {
    ok: true, repo: { owner: 'o', name: 'r' }, workspaceRoot: CWD, version: 'v0', generatedMs: CLOCK0 - 60000,
    issues: [row(201, {
      title: '票 201', body: '旧正文', parentKey: '100',
      blockedBy: [{ key: '301', number: 301, title: '阻塞 301', state: 'OPEN' }],
      subIssueCounts: { total: 3, completed: 1, percentCompleted: 33 },
      comments: [{ body: '老评论' }], commentCount: 1, reviews: [{ state: 'APPROVED' }], mergedAt: null,
    }), row(205)],
    maps: [{ number: 100, key: '100', title: '地图 100', state: 'OPEN', updatedAt: '2026-10-20T00:00:00Z', tickets: [row(201, { blockedBy: [{ key: '301', number: 301, title: '阻塞 301', state: 'OPEN' }] })] }],
    labels: [], deck: { counts: { open: 2, closed: 0, total: 2 }, partial: false, levels: [] },
    delta: { structureVersion: delta.DELTA_STRUCTURE_VERSION, watermarkMs: CLOCK0 - 3600000, generation: 3, pending: [], pendingAt: 0, pendingReason: '' },
    merge: { version: 5, lastStartMs: 0, groups: {} },
  }
}
function prov(source: string, groups: any, extra?: any): any {
  return Object.assign({ operation: 'get', source: source, completeness: 'complete', fieldGroups: groups, missingFieldGroups: [], durationMs: 4, startVersion: 'read-v1-1-000001' }, extra || {})
}
function issue(over?: any): any {
  return Object.assign({
    key: '201', title: '票 201 新', state: 'open', body: '新正文', url: 'https://github.com/o/r/issues/201',
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-31T00:00:00Z', closedAt: null, author: { login: 'alice' },
    labels: [{ name: 'bug' }], assignees: [{ login: 'me' }], isPullRequest: false,
    comments: [{ body: '评论一' }], blockedBy: [{ key: '302', number: 302, title: '阻塞 302', state: 'OPEN' }],
    reviews: [{ state: 'APPROVED' }], mergedAt: null,
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
const ALL = { row: 'complete', body: 'complete', labels: 'complete', parents: 'complete', dependencies: 'complete', subIssues: 'complete', comments: 'complete', review: 'complete', mergeInfo: 'complete' }

// 假宿主：一格内存快照 + 磁盘写盘口；合并在真模块里发生
let store: any = snapshot()
let memWrites = 0
let diskWrites: any[] = []
const getCache = function (cwd: any) { return cwd === CWD ? { ts: 0, snapshot: store, error: null, cwd: cwd } : { ts: 0, snapshot: null, error: null, cwd: cwd } }
const setCache = function (v: any) { store = v.snapshot; memWrites += 1 }
const writeDiskCache = async function (repo: any, snap: any) { diskWrites.push(snap) }
const getRepoKey = async function () { return { owner: 'o', name: 'r' } }
const detailMerge = createDetailSnapshotMerge({ getCache: getCache, setCache: setCache, writeDiskCache: writeDiskCache, getRepoKey: getRepoKey, now: function () { return CLOCK0 } })

// ---------------------------------------------------------------------------
// 要求 1：降级不缩数据（正例：完整→降级一条不减少；负例：未表达的关系组不许写成空）
// ---------------------------------------------------------------------------
const token1 = detailMerge.begin(CWD)
const complete = await detailMerge.merge(CWD, token1, { issue: issue(), provenance: prov('graphql', ALL) })
check(complete && complete.accepted === true, '要求1 正例前置：完整详情已并进快照')
const degradedIssue = issue({
  title: '票 201 降级标题', body: '降级正文', updatedAt: '2026-11-01T00:00:00Z', parentKey: null,
  comments: [], blockedBy: [], reviews: [], mergedAt: null,
  fieldStates: {
    parents: { known: false, value: null, reason: 'not-expressed' },
    dependencies: { known: false, value: null, reason: 'not-expressed' },
    subIssues: { known: false, value: null, reason: 'not-expressed' },
    comments: { known: false, value: null, reason: 'not-expressed' },
    review: { known: false, value: null, reason: 'not-expressed' },
    mergeInfo: { known: false, value: null, reason: 'not-expressed' },
  },
})
const token2 = detailMerge.begin(CWD)
const degraded = await detailMerge.merge(CWD, token2, { issue: degradedIssue, provenance: prov('rest', { row: 'complete', body: 'complete' }, { degradedFrom: 'graphql', completeness: 'partial' }) })
check(degraded && degraded.accepted === true, '要求1 正例：降级详情已并进快照')
const r201 = store.issues[0]
check(r201.parentKey === '100', '要求1 正例：降级不删父边', r201.parentKey)
check(Array.isArray(r201.blockedBy) && r201.blockedBy.length === 1 && r201.blockedBy[0].key === '302', '要求1 正例：降级不删依赖边', r201.blockedBy)
check(r201.subIssueCounts && r201.subIssueCounts.total === 4, '要求1 正例：降级不缩子票计数', r201.subIssueCounts)
check(r201.commentCount === 1 && r201.comments.length === 1 && r201.reviews.length === 1, '要求1 正例：降级不缩评论与评审', { c: r201.commentCount, r: r201.reviews.length })
check(r201.body === '降级正文' && r201.title === '票 201 降级标题', '要求1 正例：真表达了的正文与行组照常换新')
// 负例：来源把行组声明成未表达时，连行组都不许覆盖（未知 ≠ 空）
const token3 = detailMerge.begin(CWD)
await detailMerge.merge(CWD, token3, { issue: issue({ title: '票 201 未表达标题', updatedAt: '2026-12-01T00:00:00Z' }), provenance: prov('rest', { body: 'complete' }, { degradedFrom: 'graphql', completeness: 'partial' }) })
check(store.issues[0].title === '票 201 降级标题', '要求1 负例：行组未表达时不覆盖已知标题', store.issues[0].title)

// ---------------------------------------------------------------------------
// 要求 2：地图里点开一张票，首帧先显示已知阻塞（正例数组形状也认；负例未知不说「没有」）
// ---------------------------------------------------------------------------
const mapTicketRow = store.maps[0].tickets[0]
const known = knownBlockedNodes(mapTicketRow)
check(known.length === 1 && known[0] && (known[0].key === '301' || known[0].key === '302'), '要求2 正例：快照行里的数组形状阻塞边也能显示', known)
check(knownBlockedNodes({ blockedBy: { nodes: [{ key: '9' }] } }).length === 1, '要求2 正例：详情回包的连接形状照旧认')
check(knownBlockedNodes({}).length === 0 && knownBlockedNodes({ blockedBy: null }).length === 0, '要求2 负例：未知阻塞回空数组，不凭空造边')
const fallbackView = detailViewFor({ snapshot: store, issueDetail: null }, 201, '')
check(fallbackView && fallbackView.source === 'snapshot' && fallbackView.issue && fallbackView.issue.blockedBy.nodes.length === 1, '要求2 正例：没有这一趟详情时也能从快照投影出已知阻塞')
const noProjection = detailViewFor({ snapshot: { issues: [row(9, { blockedBy: [{ key: '1' }] })] }, issueDetail: null }, 9, '')
check(noProjection && noProjection.issue === null, '要求2 负例：行里没有正文/评论时不做投影（不把没取过画成空）')

// ---------------------------------------------------------------------------
// 要求 3：详情里关票 → 同一份快照里列表与地图立即一致（正例）；写取数失败不动快照（负例）
// ---------------------------------------------------------------------------
let clock = CLOCK0
const gets: any[] = []
const failKeys = new Set<string>()
const logLines: any[] = []
const logCtx = { isEnabled: function () { return false }, fire: function (level: any, name: any, fields: any) { logLines.push({ level: level, name: name, fields: fields }) } }
const session = {
  get: async function (ref: any, key: any) {
    gets.push(String(key))
    if (failKeys.has(String(key))) return { ok: false, error: { kind: 'network', message: '取数失败' } }
    // 会话回包是契约票（state 小写），行工厂要按契约形状喂，否则 rowOf 会把大写当成 OPEN。
    return { ok: true, data: row(Number(key), { title: '票 ' + key, state: 'closed', updatedAt: '2026-11-02T00:00:00Z' }) }
  },
  list: async function () { throw new Error('写回执不应整池重建') },
  listPage: async function () { throw new Error('写回执不应翻索引') },
}
const openSession = async function () { return { ok: true, backendId: 'github', budget: {}, call: function (fn: any) { return fn(session, { cwd: CWD, caller: 'refresh' }) } } }
let windowIndex: any = null
const writes: any[] = []
function makePatch(): any {
  return createPatch({
    now: function () { return clock }, logCtx: logCtx, workspaceKeyOf: function () { return WS },
    readSnapshot: async function () { return store },
    writeSnapshot: async function (cwd: any, snap: any) { writes.push(snap); store = snap },
    indexOfSnapshot: win.indexFromSnapshot, windowRules: win,
    getRepoKey: async function () { return { owner: 'o', name: 'r' } },
    probeIndex: async function () { return { ok: true, index: windowIndex } },
    openSession: openSession, decide: function () { return { verdict: 'send' } },
  })
}
const beforeList = store.issues.slice()
windowIndex = { '201': 'CLOSED|2026-11-02T00:00:00Z', '205': 'OPEN|2026-10-30T00:00:00Z' }
const patch = makePatch()
const wr = await patch.run(CWD)
check(wr && wr.mode === 'patch', '要求3 正例：写回执走行级补行', wr && (wr.mode + '/' + wr.reason))
check(store.issues[0].state === 'CLOSED' && store.maps[0].tickets[0].state === 'CLOSED', '要求3 正例：同一份快照里列表与地图同时变 CLOSED', { issue: store.issues[0].state, map: store.maps[0].tickets[0].state })
check(store.issues[1] === beforeList[1], '要求3 正例：没变的行对象引用不动')
check(merger.mergeVersionOf(store) > 5, '要求3 正例：写回执让合并版本继续递增', merger.mergeVersionOf(store))
// 负例：取数失败 → 快照一个字节不动（不做乐观修改）
const snapBeforeFail = store
failKeys.add('201')
windowIndex = { '201': 'OPEN|2026-11-03T00:00:00Z', '205': 'OPEN|2026-10-30T00:00:00Z' }
const patchFail = makePatch()
const wrFail = await patchFail.run(CWD)
check(wrFail && wrFail.mode !== 'patch', '要求3 负例：写回执取数失败如实回失败', wrFail && (wrFail.mode + '/' + wrFail.reason))
// 失败那一趟允许把「待办」写进快照（那是刷新簿记），但业务字段与合并版本一个字节都不许动。
check(snapBeforeFail && store && store.issues[0].state === snapBeforeFail.issues[0].state && store.issues[0].title === snapBeforeFail.issues[0].title && merger.mergeVersionOf(store) === merger.mergeVersionOf(snapBeforeFail), '要求3 负例：失败不做乐观修改（业务字段与合并版本不动）')
failKeys.delete('201')

// ---------------------------------------------------------------------------
// 要求 4：详情永久增量合并（正例：随盘写回、重启后仍在；负例：过期结果丢、不缩上次已知）
// ---------------------------------------------------------------------------
check(diskWrites.length >= 2, '要求4 正例：详情合并后的快照写回了磁盘', diskWrites.length)
const lastDisk = diskWrites[diskWrites.length - 1]
check(lastDisk && Array.isArray(lastDisk.issues) && lastDisk.issues[0].body === '新正文' && lastDisk.issues[0].title === '票 201 降级标题', '要求4 正例：磁盘上那份带着详情正文', lastDisk && lastDisk.issues && lastDisk.issues[0] && { body: lastDisk.issues[0].body, title: lastDisk.issues[0].title, n: diskWrites.length })
check(merger.mergeVersionOf(lastDisk) >= 8, '要求4 正例：磁盘那份的合并版本也单调递增', merger.mergeVersionOf(lastDisk))
// 模拟重启：把磁盘那份当新的内存快照，再来一次只表达正文的部分读
const restarted = JSON.parse(JSON.stringify(lastDisk))
store = restarted
const token4 = detailMerge.begin(CWD)
const partial = await detailMerge.merge(CWD, token4, { issue: issue({ title: '票 201 重启后标题', body: '重启后正文', updatedAt: '2026-12-02T00:00:00Z' }), provenance: prov('rest', { row: 'complete', body: 'complete' }, { degradedFrom: 'graphql', completeness: 'partial' }) })
check(partial && partial.accepted === true, '要求4 正例：重启后的部分读合并成功')
const afterRestart = store.issues[0]
check(afterRestart.body === '重启后正文' && afterRestart.title === '票 201 重启后标题', '要求4 正例：重启后的部分读只改表达过的字段')
check(afterRestart.parentKey === '100' && Array.isArray(afterRestart.blockedBy) && afterRestart.blockedBy.length === 1, '要求4 正例：重启后上次已知的关系仍在', { p: afterRestart.parentKey, b: afterRestart.blockedBy })
const versionBeforeStale = merger.mergeVersionOf(store)
const staleToken = detailMerge.begin(CWD)
await detailMerge.merge(CWD, staleToken, { issue: issue({ title: '票 201 更晚标题', updatedAt: '2026-12-03T00:00:00Z' }), provenance: prov('graphql', ALL) })
const staleOut = await detailMerge.merge(CWD, token4, { issue: issue({ title: '票 201 过期标题', updatedAt: '2026-12-04T00:00:00Z' }), provenance: prov('graphql', ALL) })
check(staleOut && staleOut.accepted === false, '要求4 负例：过期结果整份丢弃')
check(store.issues[0].title !== '票 201 过期标题' && merger.mergeVersionOf(store) === versionBeforeStale + 1, '要求4 负例：过期结果不改快照、不让版本跳号', { title: store.issues[0].title, v: merger.mergeVersionOf(store) })

console.log('四条验收联合门禁：' + (total - failed) + '/' + total + ' 通过')
printGateResult(GATE, total, failed)
process.exit(failed ? 1 : 0)
