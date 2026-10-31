/**
 * tests/verify-retire-client-caches.ts —— 旧详情缓存与地图桶退役为投影（#1695）
 *
 * 守什么：规格 #1681 阶段 3 的单一读源。
 *   A 详情读投影：快照行里有上次内容时，详情页画快照投影，不再先认这一趟取回的详情；
 *     行里没有内容才回退到这一趟的详情（没取过 ≠ 无描述）。
 *   B 详情取数退役旧缓存：snapshot 模式下 fetchIssueDetail 不读也不写 st.issueCache，
 *     TTL 改记在 st.detailSeenAt（只决定何时后台重取，不决定能否显示），
 *     成功后触发一次静默快照刷新，让宿主合并结果回到投影。
 *   C 失败不清空：取数失败保留上一次详情、只标 err。
 *   D 地图子票整桶替换退役：wf.mapTickets 的成功结果按编号增量合并进快照行，
 *     快照里已有、这次短回包没带的行不许消失（旧行为整桶顶掉，是这一条的负例）。
 *   E 快照字段白名单：信封只许装白名单字段；会话呈现态（打开中的票、筛选、草稿、布局选择）
 *     不许写进共享快照。
 *   F 排序在投影层：orderOpenTickets 只排序不改输入数组，ticketFeedOf 也不重排快照存储顺序。
 *   G 降级标记只由后端写：客户端取数成功或失败都不改 snapshot.fallback/fallbackAt。
 *   H 旧路径仍可跑：dsws.readProjection=legacy 时详情仍写 issueCache、TTL 仍按 issueCache 命中。
 *
 * 为什么用真模块跑：这一条守的是「视图到底读谁、TTL 到点还画不画」，换一种等价投影而结论不变时不该误报。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-retire-client-caches.ts
 */
// 门禁归属: src/client/views/shared/detailProjection.ts
// 门禁归属: src/client/kernel/api-io.ts
// 门禁归属: src/client/views/mapDetailV2/model/tickets/ticketFeed.ts
// 门禁归属: src/host/snapshotEnvelope.ts

import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import { detailViewFor, readProjectionMode, setReadProjectionMode, READ_PROJECTION_KEY } from '../src/client/views/shared/detailProjection.ts'
import { ticketFeedOf } from '../src/client/views/mapDetailV2/model/tickets/ticketFeed.ts'
import { orderOpenTickets } from '../src/client/views/mapDetailV2/model/tickets/ticketBoard.ts'
import { createSnapshotEnvelope, SNAPSHOT_TOP_FIELDS, snapshotFieldViolations } from '../src/host/snapshotEnvelope.ts'

const GATE = 'verify-retire-client-caches'
const ROOT = process.cwd()
let total = 0
let failed = 0
function check(cond: any, message: string, detail?: any): void {
  total += 1
  if (cond) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

// 真闭包里由构建提供、独立 import 时按同形状垫上（只垫环境名字，不是第二份实现）。
const store: Record<string, string> = {}
;(globalThis as any).localStorage = {
  getItem: function (k: string) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null },
  setItem: function (k: string, v: string) { store[k] = String(v) },
  removeItem: function (k: string) { delete store[k] },
}
;(globalThis as any).tr = function (key: any, params?: any) {
  let s: string = String(key)
  if (params) s = s.replace(/\{(\w+)\}/g, function (m: string, n: string) { return n in params ? String(params[n]) : m })
  return s
}
;(globalThis as any).idOfParts = function (a: any, b: any) { return String(a) + '\u0000' + String(b) }
;(globalThis as any).log = function () {}
;(globalThis as any).emit = function () {}
;(globalThis as any).isEnabled = function () { return false }
;(globalThis as any).dswsLogHash = function (s: any) { return String(s) }
;(globalThis as any).dswsLogTrunc = function (s: any) { return String(s) }
;(globalThis as any).ISSUE_CACHE_TTL = 60000
let snapshotRefreshes = 0
;(globalThis as any).loadSnapshot = function () { snapshotRefreshes += 1 }

const CLOCK0 = 1761900000000
const CWD = 'D:/ws/demo'
function row(n: number, extra?: any): any {
  return Object.assign({ number: n, key: String(n), title: '票 ' + n, state: 'OPEN', updatedAt: '2026-10-30T00:00:00Z', labels: [], assignees: [], createdAt: '2026-10-01T00:00:00Z' }, extra || {})
}
function snap(issues: any[], extra?: any): any {
  return Object.assign({ version: 'v0', issues: issues, maps: [], deck: {}, merge: { version: 7, lastStartMs: 0, groups: { body: { version: 7, atMs: CLOCK0, source: 'graphql', operation: 'get', completeness: 'complete' } } } }, extra || {})
}

// ---------------------------------------------------------------------------
// A 详情读投影：快照有内容时投影优先；快照没有内容才回退到这一趟详情
// ---------------------------------------------------------------------------
const liveNew = { number: 201, effortId: '', title: '票 201', body: '这一趟取回的正文', comments: { nodes: [] } }
const stA: any = { snapshot: snap([row(201, { body: '快照里的正文', comments: [{ body: '快照里的评论' }] })]), issueDetail: liveNew, issueMode: 'real', detailSeenAt: {}, issueCache: {} }
const viewA = detailViewFor(stA, 201, '')
check(viewA && viewA.source === 'snapshot', 'A1 快照行有上次内容时详情读快照投影', viewA && viewA.source)
check(viewA && viewA.issue && viewA.issue.body === '快照里的正文', 'A2 画的是快照里的正文（不是这一趟取回的）', viewA && viewA.issue && viewA.issue.body)
check(viewA && viewA.lastKnownAtMs === CLOCK0, 'A3 上次数据时刻取合并组戳记', viewA && viewA.lastKnownAtMs)
const stA2: any = { snapshot: snap([row(202)]), issueDetail: Object.assign({}, liveNew, { number: 202, body: '这一趟取回的正文' }), issueMode: 'real', detailSeenAt: {}, issueCache: {} }
const viewA2 = detailViewFor(stA2, 202, '')
check(viewA2 && viewA2.source === 'live' && viewA2.issue.body === '这一趟取回的正文', 'A4 快照行没内容时回退到这一趟详情', viewA2 && viewA2.source)
check(detailViewFor(stA2, 999, '').source === 'none', 'A5 快照里没有这张票时投影为空，不编内容')
check(setReadProjectionMode('legacy') === 'legacy' && readProjectionMode() === 'legacy', 'A6 读投影开关能切到 legacy 并持久化')
check(detailViewFor(stA, 201, '').source === 'live', 'A7 legacy 路径不读快照投影（旧路仍可跑）')
setReadProjectionMode('snapshot')

// ---------------------------------------------------------------------------
// B 详情取数退役 issueCache：snapshot 模式不读写它，TTL 记在 detailSeenAt
// ---------------------------------------------------------------------------
;(globalThis as any).projectionUsesSnapshot = function () { return true }
const api = await import('../src/client/kernel/api-io.ts')
let hostCalls = 0
let hostReply: any = { ok: true, issue: { number: 7, effortId: '', title: '新详情', body: '新正文', comments: { nodes: [] } } }
;(globalThis as any).host = { call: async function () { hostCalls += 1; return hostReply } }
const stB: any = { cwd: CWD, snapshot: snap([row(7, { body: '旧快照正文' })]), issueDetail: null, issueMode: 'idle', issueError: null, detailSeenAt: {}, issueCache: {} }
const beforeRefresh = snapshotRefreshes
const okRes = await api.fetchIssueDetail(stB, 7, { force: true })
check(okRes && okRes.ok === true && hostCalls === 1, 'B1 快照模式取数仍走宿主 wf.issueDetail', { hostCalls })
check(Object.keys(stB.issueCache).length === 0, 'B2 快照模式成功取回不写 issueCache（旧缓存退役）', stB.issueCache)
check(stB.detailSeenAt && stB.detailSeenAt['\u0000' + 7] > 0, 'B3 快照模式把取回时刻记进 detailSeenAt（TTL 用）', stB.detailSeenAt)
check(snapshotRefreshes === beforeRefresh + 1, 'B4 成功后触发一次静默快照刷新（宿主合并结果回到投影）', snapshotRefreshes - beforeRefresh)
const callsBeforeTtl = hostCalls
const ttlRes = await api.fetchIssueDetail(stB, 7, {})
check(ttlRes && ttlRes.ok === true && ttlRes.fromSnapshot === true && hostCalls === callsBeforeTtl, 'B5 TTL 内命中不再发请求、直接画投影（TTL 只决定何时重取）', { hostCalls, ttlRes })
check(Object.keys(stB.issueCache).length === 0, 'B6 TTL 命中也不写 issueCache', stB.issueCache)
const forceRes = await api.fetchIssueDetail(stB, 7, { force: true })
check(forceRes && forceRes.ok === true && hostCalls === callsBeforeTtl + 1, 'B7 force 会击穿 TTL 重取', hostCalls)

// ---------------------------------------------------------------------------
// C 失败不清空：保留上一次详情、只标 err；snapshot 模式不写 issueCache
// ---------------------------------------------------------------------------
hostReply = { ok: false, error: { kind: 'network', message: '断了' } }
const keptDetail = { number: 7, effortId: '', title: '上次详情', body: '上次正文', comments: { nodes: [] } }
const stC: any = { cwd: CWD, snapshot: snap([row(7, { body: '上次正文' })]), issueDetail: keptDetail, issueMode: 'real', issueError: null, detailSeenAt: { ['\u0000' + 7]: CLOCK0 }, issueCache: {} }
const failRes = await api.fetchIssueDetail(stC, 7, { force: true })
check(failRes && failRes.ok === false && stC.issueDetail === keptDetail && stC.issueMode === 'err', 'C1 失败保留上一次详情、只标 err（不清空）')
check(Object.keys(stC.issueCache).length === 0, 'C2 失败也不写 issueCache', stC.issueCache)
const failView = detailViewFor(stC, 7, '')
check(failView && failView.source === 'snapshot' && failView.issue.body === '上次正文', 'C3 失败后仍画快照上次内容', failView && failView.source)

// ---------------------------------------------------------------------------
// D 地图子票整桶替换退役：按编号增量合并，快照已有行不许被短回包顶掉
// ---------------------------------------------------------------------------
const mapRow: any = { number: 100, key: '100', title: '地图 100', state: 'OPEN', tickets: [row(1, { title: '快照一' }), row(2, { title: '快照二' })], stats: { total: 2 } }
const bucket: any = { mode: 'real', items: [row(1, { title: '新一' }), row(3, { title: '新三' })], stats: { total: 2, closed: 0 }, total: 2, capped: false, missing: 0, ts: CLOCK0 }
const feedD = ticketFeedOf(bucket, mapRow)
const numsD = feedD.rows.map(function (r: any) { return Number(r.number) })
check(feedD.state === 'ready' && feedD.source === 'requested', 'D1 取回成功仍标记为请求来源', { state: feedD.state, source: feedD.source })
check(numsD.join(',') === '1,2,3', 'D2 成功回包按编号合并：快照独有的 2 不被顶掉、新的 3 追加在后', numsD)
check(feedD.rows[0].title === '新一' && feedD.rows[1].title === '快照二', 'D3 同编号用新行覆盖、其余保留原行', feedD.rows.map(function (r: any) { return r.title }))
check(feedD.stats && feedD.stats.total === 2, 'D4 取回成功用取回那份的 stats', feedD.stats)
const mapNoBucket = ticketFeedOf(null, mapRow)
check(mapNoBucket.rows.map(function (r: any) { return Number(r.number) }).join(',') === '1,2', 'D5 没有桶时照旧画快照行')
const feedShort = ticketFeedOf({ mode: 'real', items: [] }, mapRow)
check(feedShort.rows.length === 2, 'D6 短回包（items 为空）不把快照已知行清空（负例：旧整桶替换会画 0 行）', feedShort.rows.length)
const realNoMap = ticketFeedOf({ mode: 'real', items: [row(1), row(2)] }, null)
check(realNoMap.rows.length === 2 && realNoMap.rows[0].number === 1, 'D7 没有快照行时输出就是回包本身（老用例形状不变）', realNoMap.rows)

// ---------------------------------------------------------------------------
// E 快照字段白名单与会话呈现态
// ---------------------------------------------------------------------------
check(Array.isArray(SNAPSHOT_TOP_FIELDS) && SNAPSHOT_TOP_FIELDS.length > 10, 'E1 信封导出顶层字段白名单', SNAPSHOT_TOP_FIELDS && SNAPSHOT_TOP_FIELDS.length)
const env = createSnapshotEnvelope({ getGhPath: function () { return null }, getGhLastError: function () { return null }, adoptSnapshot: function (s: any) { return s } })
const built: any = env.buildSnap({ maps: [], issues: [], thinTickets: [], labels: [], deck: { counts: { open: 0, closed: 0, total: 0 }, partial: false } })
check(snapshotFieldViolations(built).length === 0, 'E2 宿主组装的快照全部字段都在白名单内', snapshotFieldViolations(built))
check(Object.keys(built).every(function (k: string) { return SNAPSHOT_TOP_FIELDS.indexOf(k) >= 0 }), 'E3 白名单覆盖信封每一个顶层字段')
const dirty = Object.assign({}, built, { issueCache: {}, mapTickets: {}, navStack: [], activeIssue: 7, cmtDraft: '草稿', lblFilters: ['bug'], stateFilter: 'open', sortKey: 'number', sortDir: 'asc' })
const bad = snapshotFieldViolations(dirty)
check(['issueCache', 'mapTickets', 'navStack', 'activeIssue', 'cmtDraft', 'lblFilters', 'stateFilter', 'sortKey', 'sortDir'].every(function (k: string) { return bad.indexOf(k) >= 0 }), 'E4 会话呈现态写进共享快照会被白名单判违规', bad)
check(['issueCache', 'mapTickets', 'navStack', 'activeIssue', 'cmtDraft', 'lblFilters', 'stateFilter'].every(function (k: string) { return !(k in built) }), 'E5 宿主组装的快照里没有会话呈现态字段')

// ---------------------------------------------------------------------------
// F 排序在投影层：只排序不改输入数组，ticketFeedOf 也不重排存储顺序
// ---------------------------------------------------------------------------
const facts: any[] = [
  { status: 'blocked', number: 3, rowKey: '3', title: 'c', closedAt: '' },
  { status: 'ready', number: 2, rowKey: '2', title: 'b', closedAt: '' },
  { status: 'doing', number: 1, rowKey: '1', title: 'a', closedAt: '' },
]
const ordered = orderOpenTickets(facts)
check(facts.map(function (f: any) { return f.number }).join(',') === '3,2,1', 'F1 排序不改输入数组（存储层位置不动）', facts.map(function (f: any) { return f.number }))
check(ordered.map(function (f: any) { return f.number }).join(',') === '1,2,3', 'F2 投影层按状态段重排', ordered.map(function (f: any) { return f.number }))
const beforeOrder = mapRow.tickets.map(function (r: any) { return Number(r.number) }).join(',')
ticketFeedOf(bucket, mapRow)
check(mapRow.tickets.map(function (r: any) { return Number(r.number) }).join(',') === beforeOrder, 'F3 投影合并不改快照存储顺序（排序只在投影层）', mapRow.tickets)

// ---------------------------------------------------------------------------
// G 降级标记只由后端写：客户端取数成功/失败都不改 snapshot.fallback
// ---------------------------------------------------------------------------
const stG: any = { cwd: CWD, snapshot: snap([], { fallback: 'rest', fallbackAt: CLOCK0, fallbackReason: 'quota' }), issueDetail: null, issueMode: 'idle', detailSeenAt: {}, issueCache: {} }
hostReply = { ok: true, issue: { number: 8, effortId: '', title: 't', body: 'b', comments: { nodes: [] } } }
await api.fetchIssueDetail(stG, 8, { force: true })
check(stG.snapshot.fallback === 'rest' && stG.snapshot.fallbackAt === CLOCK0 && stG.snapshot.fallbackReason === 'quota', 'G1 取数成功不改降级标记（只由后端写）', { f: stG.snapshot.fallback })
hostReply = { ok: false, error: { kind: 'network', message: '断了' } }
await api.fetchIssueDetail(stG, 8, { force: true })
check(stG.snapshot.fallback === 'rest', 'G2 取数失败也不改降级标记（界面不自己猜）', stG.snapshot.fallback)
const projSrc = readFileSync(path.join(ROOT, 'src/client/views/shared/detailProjection.ts'), 'utf8')
const apiSrc = readFileSync(path.join(ROOT, 'src/client/kernel/api-io.ts'), 'utf8')
check(!/snapshot\.fallback\s*=/.test(projSrc) && !/snapshot\.fallback\s*=/.test(apiSrc), 'G3 客户端源码里没有写 snapshot.fallback 的地方')

// ---------------------------------------------------------------------------
// H 旧路径仍可跑：legacy 模式仍写 issueCache、TTL 仍按 issueCache 命中
// ---------------------------------------------------------------------------
;(globalThis as any).projectionUsesSnapshot = function () { return false }
hostReply = { ok: true, issue: { number: 9, effortId: '', title: '旧路详情', body: '旧路正文', comments: { nodes: [] } } }
const stH: any = { cwd: CWD, snapshot: snap([]), issueDetail: null, issueMode: 'idle', detailSeenAt: {}, issueCache: {} }
const legacyRes = await api.fetchIssueDetail(stH, 9, { force: true })
check(legacyRes && legacyRes.ok === true && stH.issueCache['\u0000' + 9] && stH.issueCache['\u0000' + 9].data.title === '旧路详情', 'H1 legacy 路径仍写 issueCache（旧路不删代码）', stH.issueCache)
const legacyCalls = hostCalls
const legacyHit = await api.fetchIssueDetail(stH, 9, {})
check(legacyHit && legacyHit.ok === true && hostCalls === legacyCalls, 'H2 legacy 路径 TTL 仍按 issueCache 命中、不再发请求', hostCalls)
;(globalThis as any).projectionUsesSnapshot = function () { return true }

// ---------------------------------------------------------------------------
// I 评论分页在 snapshot 模式也不写 issueCache
// ---------------------------------------------------------------------------
hostReply = { ok: true, issue: { number: 7, effortId: '', title: 't', body: 'b', comments: [] } }
const stI: any = { cwd: CWD, snapshot: snap([]), issueDetail: { number: 7, effortId: '', title: 't', body: 'b', comments: { nodes: [{ body: '一' }], pageInfo: { hasNextPage: true, endCursor: '1' } } }, issueMode: 'real', detailSeenAt: {}, issueCache: {} }
;(globalThis as any).host.call = async function (method: string) {
  if (method === 'wf.issueComments') return { ok: true, nodes: [{ body: '二' }], pageInfo: { hasNextPage: false, endCursor: '2' } }
  return hostReply
}
const cmtRes = await api.fetchIssueComments(stI, 7, '1', {})
check(cmtRes && cmtRes.ok === true, 'I1 评论加载更多成功', cmtRes)
check(Object.keys(stI.issueCache).length === 0, 'I2 snapshot 模式评论分页不写 issueCache（旧缓存退役）', stI.issueCache)

console.log('')
printGateResult(GATE, total, failed ? 1 : 0)
process.exit(failed ? 1 : 0)
