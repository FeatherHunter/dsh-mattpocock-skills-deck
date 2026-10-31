/**
 * tests/verify-single-read-source.ts —— 详情只读一个来源（快照投影）门禁（#1694）
 *
 * 守什么：规格 #1681 的「一个快照」在详情页这一侧要成立 ——
 *   A 投影只读面板状态：detailViewFor 只从 st（快照与详情状态）推，不打电话、不写缓存；
 *     行里有正文就投影、没有就不投影（不把「没取过」画成「无描述」）。
 *   B 读投影开关两条路都能跑且默认新路径：snapshot 读快照投影，legacy 只认这一趟取回的详情；
 *     切换要能持久化（一次切换，出问题可回滚，旧缓存退役是 #1695 的事）。
 *   C 失败不清空：详情取数失败时 st.issueDetail 保留上一份，模式记 err，投影标出「上次数据」的时刻。
 *   D 成功取回会替换；#1695 起不再写既有详情缓存，只记取回时刻并静默刷新快照（旧缓存退役为回滚路径）。
 *   E 单一真源：构建产物里 detailViewFor 只有一份；详情合并模块只经 mergeSnapshot 写快照。
 *
 * 为什么用真模块跑：这一条守的是「视图到底读谁」与「失败后还画不画」，换一种等价投影而结论不变时不该误报。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-single-read-source.ts
 */
// 门禁归属: src/client/views/shared/detailProjection.ts
// 门禁归属: src/client/kernel/api-io.ts
// 门禁归属: src/refresh/rooms/host/detail-snapshot-merge.ts

import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import { detailViewFor, knownBlockedNodes, readProjectionMode, setReadProjectionMode, READ_PROJECTION_KEY } from '../src/client/views/shared/detailProjection.ts'

const GATE = 'verify-single-read-source'
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

const CLOCK0 = 1761900000000
const CWD = 'D:/ws/demo'
function row(n: number, extra?: any): any {
  return Object.assign({ number: n, key: String(n), title: '票 ' + n, state: 'OPEN', updatedAt: '2026-10-30T00:00:00Z', labels: [], assignees: [], createdAt: '2026-10-01T00:00:00Z' }, extra || {})
}
function snap(issues: any[]): any {
  return { version: 'v0', issues: issues, maps: [], deck: {}, merge: { version: 7, lastStartMs: 0, groups: { body: { version: 7, atMs: CLOCK0, source: 'graphql', operation: 'get', completeness: 'complete' } } } }
}

// ---------------------------------------------------------------------------
// A 投影只读面板状态：不打电话、不写缓存；有正文才投影
// ---------------------------------------------------------------------------
let hostCalls = 0
;(globalThis as any).host = { call: async function () { hostCalls += 1; return { ok: false } } }
const stA: any = { snapshot: snap([row(201, { body: '快照里的正文', blockedBy: [{ key: '301', number: 301 }] })]), issueDetail: null, issueCache: {} }
const viewA = detailViewFor(stA, 201, '')
check(viewA && viewA.source === 'snapshot', 'A1 没有这一趟详情时读快照投影', viewA && viewA.source)
check(viewA && viewA.issue && viewA.issue.body === '快照里的正文', 'A2 投影出来的正文来自快照行')
check(viewA && viewA.lastKnownAtMs === CLOCK0, 'A3 「上次数据」时刻取快照合并组戳记', viewA && viewA.lastKnownAtMs)
check(typeof (viewA && viewA.notice) === 'string' && viewA.notice.indexOf('detail.lastKnownData') >= 0, 'A4 投影带上「上次数据」文案键（时间由词条填）')
check(hostCalls === 0, 'A5 投影一次宿主调用都没发', hostCalls)
check(knownBlockedNodes(stA.snapshot.issues[0]).length === 1, 'A6 快照行里的已知阻塞边能被详情页读到（要求 2）')
const viewNone = detailViewFor({ snapshot: snap([row(9)]), issueDetail: null, issueCache: {} }, 9, '')
check(viewNone && viewNone.issue === null, 'A7 行里没有正文/评论时不做投影（没取过 ≠ 无描述）')
const viewWrong = detailViewFor(stA, 999, '')
check(viewWrong && viewWrong.issue === null, 'A8 快照里没有这张票时投影为空，不编内容')

// ---------------------------------------------------------------------------
// B 读投影开关：两条路都能跑，默认新路径，切换持久化
// ---------------------------------------------------------------------------
check(readProjectionMode() === 'snapshot', 'B1 读投影默认新路径（snapshot）')
check(setReadProjectionMode('legacy') === 'legacy' && store[READ_PROJECTION_KEY] === 'legacy', 'B2 切到回滚路径并持久化')
const viewLegacy = detailViewFor(stA, 201, '')
check(viewLegacy && viewLegacy.issue === null, 'B3 legacy 路径不读快照投影（只认这一趟取回的详情）')
check(setReadProjectionMode('snapshot') === 'snapshot' && readProjectionMode() === 'snapshot', 'B4 还能切回新路径（两条路都跑得起来）')

// ---------------------------------------------------------------------------
// C/D 失败不清空、成功替换：直接调客户端真取数函数
// ---------------------------------------------------------------------------
;(globalThis as any).host = undefined
;(globalThis as any).projectionUsesSnapshot = function () { return true }
let snapReloads = 0
;(globalThis as any).loadSnapshot = function () { snapReloads += 1 }
const api = await import('../src/client/kernel/api-io.ts')
const oldDetail = { number: 7, effortId: '', title: '旧详情', body: '上次的正文', comments: { nodes: [{ body: '旧评论' }] } }
const stC: any = { cwd: CWD, snapshot: snap([]), issueDetail: oldDetail, issueMode: 'real', issueError: null, issueCache: { ['\u0000' + 7]: { ts: CLOCK0, data: oldDetail } } }
const failRes = await api.fetchIssueDetail(stC, 7, { force: true })
check(failRes && failRes.ok === false, 'C1 宿主不可用时如实交回失败')
check(stC.issueDetail === oldDetail, 'C2 失败不清空：上一次详情对象原样还在')
check(stC.issueMode === 'err', 'C3 失败记成 err 态，界面照旧显示失败原因')
const kept = detailViewFor(stC, 7, '')
check(kept && kept.source === 'live' && kept.issue === oldDetail, 'C4 投影仍把保留的详情当这一张票的内容')
check(kept && kept.lastKnownAtMs === CLOCK0 && kept.notice.indexOf('detail.lastKnownData') >= 0, 'C5 失败保留时标注「上次数据」的时刻（来自详情缓存 ts）', kept && { at: kept.lastKnownAtMs, notice: kept.notice })

let hostCallArgs: any = null
;(globalThis as any).host = { call: async function (method: string, args: any) { hostCallArgs = { method: method, args: args }; return { ok: true, issue: { number: 7, effortId: '', title: '新详情', body: '新正文', comments: { nodes: [] } } } } }
const okRes = await api.fetchIssueDetail(stC, 7, { force: true })
check(okRes && okRes.ok === true && stC.issueDetail.title === '新详情', 'D1 成功取回后详情换成新的一份')
check(hostCallArgs && hostCallArgs.method === 'wf.issueDetail' && hostCallArgs.args.number === 7, 'D2 详情取数仍走宿主 wf.issueDetail 一条通路')
check(stC.issueCache && stC.issueCache['\u0000' + 7] && stC.issueCache['\u0000' + 7].data.title === '旧详情', 'D3 成功取回不再写旧详情缓存（旧缓存退役为回滚路径）', stC.issueCache && stC.issueCache['\u0000' + 7])
check(stC.detailSeenAt && stC.detailSeenAt['\u0000' + 7] > 0, 'D4 成功取回把取回时刻记进 detailSeenAt（TTL 只决定何时重取）', stC.detailSeenAt)
check(snapReloads === 1, 'D5 成功后触发一次静默快照刷新（宿主合并结果回到投影）', snapReloads)

// ---------------------------------------------------------------------------
// E 单一真源：产物里只有一份投影实现；详情合并只经 mergeSnapshot 写快照
// ---------------------------------------------------------------------------
const bundle = readFileSync(path.join(ROOT, 'package/lib/client.js'), 'utf8')
const viewDefs = (bundle.match(/function detailViewFor\(/g) || []).length
check(viewDefs === 1, 'E1 构建产物里 detailViewFor 只有一份（界面读的是同一份投影）', viewDefs)
const mergeSrc = readFileSync(path.join(ROOT, 'src/refresh/rooms/host/detail-snapshot-merge.ts'), 'utf8')
check(mergeSrc.indexOf('merger.mergeSnapshot(') >= 0, 'E2 详情合并只经 kernel 的 mergeSnapshot 写快照')
check((mergeSrc.match(/mergeSnapshot\(/g) || []).length === 1, 'E3 详情合并模块里只有一处合并入口（没有第二条写快照的路）')

console.log('详情单一读来源门禁：' + (total - failed) + '/' + total + ' 通过')
printGateResult(GATE, total, failed)
process.exit(failed ? 1 : 0)
