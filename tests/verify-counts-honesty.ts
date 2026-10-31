#!/usr/bin/env node
/**
 * 门禁：计数诚实（#1698 计数部分）。
 *
 * 守的东西（票 #1698「计数诚实」与规格 #1681 第 23 条）：
 * ① 完整枚举（列表没降级、没截断）时本地按行重算计数，并把来源标成「本地枚举」，不再静默按池子派生冒充完整；
 * ② 完整枚举拿不到行数据、或列表不完整时，保留上次已知的数字与时刻，并标「待校准」，界面不出现假 0；
 * ③ 后端数字与行数据冲突时以行数据为准，同时把冲突的后端数字留痕（conflictWith），partial 置真；
 * ④ 后端数字可信时仍用后端数字（来源 backend），这是老口径；
 * ⑤ 客户端只读快照里的计数：缺数字且标了待校准就显示「未知」，绝不当 0 显示；老快照（没标待校准）保持老行为。
 *
 * 负例（每条都有一条能红的断言）：
 * - 拿不到计数时 planDeckCounts 不许回 0/0/0，必须回 null（B3 之后 composeSnapshot 不许写 deck.counts）；
 * - 冲突时不许直接用后端小数字冒充完整（必须本地重算并留痕）；
 * - 客户端缺数字且待校准时 kpiCountsOf 不许回 0（必须 null + unknown）。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-counts-honesty.ts
 */
// 门禁归属: src/tracker/deck-counts.ts
// 门禁归属: src/host/tracker/snapshot.ts
// 门禁归属: src/client/kernel/store-derived.ts
// 门禁归属: src/client/views/ListTab.ts

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { printGateResult } from './lib/gate-result.ts'
import * as deckCounts from '../src/tracker/deck-counts.ts'
import { createSnapshotComposer } from '../src/host/tracker/snapshot.ts'
import { createRegistry } from '../src/tracker/registry/core.ts'
import * as derived from '../src/client/kernel/store-derived.ts'

const GATE = 'verify-counts-honesty'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NOW = 1700000000000
const BACK = { open: 10, closed: 5, total: 15 }
const ROWS = { open: 9, closed: 5, total: 14 }

let total = 0
let failed = 0
function check (cond: any, msg: string, detail?: any): void {
  total += 1
  if (cond) console.log('PASS ' + msg)
  else { failed += 1; console.log('FAIL ' + msg + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）')) }
}

// ────────────────────────────── A 纯函数：planDeckCounts / rowCountsOf ──────────────────────────────
{
  // A1 后端数字可信：池子行数不超过后端总数 → 原样用后端数字，来源 backend。
  const p1 = deckCounts.planDeckCounts({ backendCounts: BACK, rows: BACK, rowsComplete: true, previousCounts: null, nowMs: NOW })
  check(p1.counts && p1.counts.open === 10 && p1.counts.closed === 5 && p1.counts.total === 15, 'A1 后端计数可信时三数原样采用', p1.counts)
  check(p1.counts && p1.counts.source === 'backend' && p1.counts.atMs === NOW && p1.pending === false, 'A2 来源标 backend、时刻记 nowMs、不标待校准', p1.counts)
  check(p1.partial === false, 'A3 池子行数等于后端总数 → 不置 partial', p1)

  // A4 后端总数大于池子行数 → 清单不全，partial 置真（老口径不变）。
  const p2 = deckCounts.planDeckCounts({ backendCounts: BACK, rows: ROWS, rowsComplete: true, previousCounts: null, nowMs: NOW })
  check(p2.counts && p2.counts.total === 15 && p2.partial === true, 'A4 池子比后端总数少 → 用后端数字且 partial 置真', p2)

  // A5 后端拿不到 + 列表完整 → 本地重算，来源本地枚举（新行为：不再静默派生冒充完整）。
  const p3 = deckCounts.planDeckCounts({ backendCounts: null, rows: ROWS, rowsComplete: true, previousCounts: null, nowMs: NOW })
  check(p3.counts && p3.counts.open === 9 && p3.counts.closed === 5 && p3.counts.total === 14, 'A5 后端拿不到但列表完整 → 本地按行重算三数', p3.counts)
  check(p3.counts && p3.counts.source === 'local-enumeration' && p3.pending === false && p3.partial === false, 'A6 来源标本地枚举、不标待校准、不置 partial', p3.counts)
  check(p3.counts && !('conflictWith' in p3.counts), 'A7 没有后端数字可冲突时不写 conflictWith', p3.counts)

  // A8 冲突：后端总数比行少 → 以行数据为准，后端数字留痕，partial 置真。
  const p4 = deckCounts.planDeckCounts({ backendCounts: { open: 1, closed: 0, total: 1 }, rows: ROWS, rowsComplete: true, previousCounts: null, nowMs: NOW })
  check(p4.counts && p4.counts.total === 14 && p4.counts.source === 'local-enumeration', 'A8 数字与行冲突 → 以行数据为准', p4.counts)
  check(p4.counts && p4.counts.conflictWith && p4.counts.conflictWith.total === 1, 'A9 冲突的后端数字留痕（conflictWith）', p4.counts && p4.counts.conflictWith)
  check(p4.partial === true, 'A10 冲突时 partial 置真', p4)

  // A11 列表不完整 + 有上次已知 → 保留旧值、旧时刻，标待校准。
  const prev = { open: 30, closed: 650, total: 680, source: 'backend', atMs: NOW - 60000 }
  const p5 = deckCounts.planDeckCounts({ backendCounts: null, rows: ROWS, rowsComplete: false, previousCounts: prev, nowMs: NOW })
  check(p5.counts && p5.counts.open === 30 && p5.counts.closed === 650 && p5.counts.total === 680, 'A11 列表不完整时保留上次已知的三数', p5.counts)
  check(p5.counts && p5.counts.source === 'previous-known' && p5.counts.atMs === NOW - 60000 && p5.pending === true, 'A12 来源标上次已知、时刻用旧时刻、标待校准', p5.counts)
  check(p5.partial === true, 'A13 保留旧值时 partial 置真', p5)

  // A14 上次已知是坏数字 → 不采用，回 null（负例：不许拿坏值当已知）。
  const p6 = deckCounts.planDeckCounts({ backendCounts: null, rows: null, rowsComplete: false, previousCounts: { open: '30', closed: -1, total: 680 }, nowMs: NOW })
  check(p6.counts === null && p6.pending === true && p6.partial === true, 'A14 上次已知是坏数字时不采用，回 null 并标待校准', p6)

  // A15 什么都没有 → counts 回 null（负例：拿不到计数不许写 0/0/0 冒充完整）。
  const p7 = deckCounts.planDeckCounts({ backendCounts: null, rows: null, rowsComplete: false, previousCounts: null, nowMs: NOW })
  check(p7.counts === null, 'A15 一点证据都没有时 counts 回 null（不写假 0）', p7)
  check(p7.pending === true && p7.partial === true, 'A16 无证据时标待校准并置 partial', p7)

  // A17 后端数字有、行数据没有（比较不了）→ 仍用后端数字，但不能声称完整。
  const p8 = deckCounts.planDeckCounts({ backendCounts: BACK, rows: null, rowsComplete: true, previousCounts: null, nowMs: NOW })
  check(p8.counts && p8.counts.source === 'backend' && p8.counts.total === 15 && p8.partial === true, 'A17 有后端数字但没有行数据可比 → 用后端数字、partial 置真', p8)

  // A18 完整枚举优先于上次已知：即便有旧值，列表完整就按行重算。
  const p9 = deckCounts.planDeckCounts({ backendCounts: null, rows: ROWS, rowsComplete: true, previousCounts: prev, nowMs: NOW })
  check(p9.counts && p9.counts.total === 14 && p9.counts.source === 'local-enumeration' && p9.pending === false, 'A18 完整枚举优先于上次已知', p9.counts)

  // A19 rowCountsOf：按身份去重（同一张票同时出现在 issues 与地图子票里只算一次）、PR 不算工单、closed 单独计。
  const snap = {
    issues: [
      { key: '1', effortId: '', title: 'A', state: 'OPEN', isPullRequest: false },
      { key: '2', effortId: '', title: 'B', state: 'CLOSED', isPullRequest: false },
      { key: '9', effortId: '', title: 'PR', state: 'CLOSED', isPullRequest: true },
    ],
    maps: [{ key: '100', effortId: '', type: 'map', tickets: [{ key: '1', effortId: '', title: 'A', state: 'OPEN' }, { key: '3', effortId: '', title: 'C', state: 'CLOSED' }] }],
  }
  const rc = deckCounts.rowCountsOf(snap)
  // 三张不同的工单：1 是 OPEN，2 与 3 是 CLOSED，所以 open=1、closed=2、total=3（PR 那张不算）。
  check(rc && rc.open === 1 && rc.closed === 2 && rc.total === 3, 'A19 rowCountsOf 去重、排除 PR、按状态计数（实得 ' + JSON.stringify(rc) + '）', rc)
  check(deckCounts.rowCountsOf(null) === null, 'A20 rowCountsOf 没有快照时回 null（不写 0）', deckCounts.rowCountsOf(null))
}

// ────────────────────────────── B 集成：composeSnapshot 走真快照路径 ──────────────────────────────
const EMPTY_CTX: any = {}
function base (o: any): any {
  return Object.assign({ type: 'issue', title: 'T', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: null, labels: [], assignees: [], blockedBy: [], comments: [], reason: '' }, o)
}
const POOL = [base({ key: '1', title: 'A' }), base({ key: '2', title: 'B', state: 'closed' })]
const REF = { backend: 'fake', refId: 'r1', name: 'R1', url: '' }

function makeComposer (id: string, counts: any, listTruncated: boolean): any {
  const registry = createRegistry(EMPTY_CTX, { matchesTimeout: 50 })
  const state = { counts: counts, listTruncated: listTruncated, countsCalls: 0, listCalls: 0 }
  registry.register({
    id: id, label: id,
    budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
    create: () => ({
      list: async () => { state.listCalls += 1; return state.listTruncated ? { ok: true, data: POOL, truncated: true } : { ok: true, data: POOL } },
      counts: async () => { state.countsCalls += 1; return state.counts },
    }),
    matches: async () => true,
  } as any)
  return { composer: createSnapshotComposer(registry, { snapshotTtl: 50, depsTtl: 50 }), state: state }
}

{
  // B1 后端计数可信：来源 backend、不标待校准、不置 partial。
  const c1 = makeComposer('c1', { ok: true, data: { open: 1, closed: 1, total: 2 } }, false)
  const r1: any = await c1.composer.composeSnapshot('c1', REF, { cwd: '/w' }, { force: true })
  const d1 = r1 && r1.ok ? r1.snapshot.deck : null
  check(!!d1 && d1.counts && d1.counts.open === 1 && d1.counts.closed === 1 && d1.counts.total === 2, 'B1 后端计数进 deck.counts 三数', d1 && d1.counts)
  check(!!d1 && d1.counts.source === 'backend' && d1.countsPending === false && d1.partial === false, 'B2 来源 backend、countsPending 假、partial 假', d1)
  const v1 = r1 && r1.ok ? r1.snapshot.version : ''
  const r1b: any = await c1.composer.composeSnapshot('c1', REF, { cwd: '/w' }, { force: true })
  check(!!v1 && r1b.ok && r1b.snapshot.version === v1, 'B3 同一份数据重建版号不变（时刻不进版号）', [v1, r1b.ok ? r1b.snapshot.version : ''])

  // B4 后端计数失败 + 列表完整 → 本地重算（新行为：不再没有 counts 也不冒充派生）。
  c1.state.counts = { ok: false, error: { kind: 'unsupported', message: 'counts 不可用', raw: '' } }
  const r2: any = await c1.composer.composeSnapshot('c1', REF, { cwd: '/w' }, { force: true })
  const d2 = r2 && r2.ok ? r2.snapshot.deck : null
  check(!!d2 && d2.counts && d2.counts.open === 1 && d2.counts.closed === 1 && d2.counts.total === 2, 'B4 后端计数失败但列表完整 → 本地重算三数', d2 && d2.counts)
  check(!!d2 && d2.counts.source === 'local-enumeration' && d2.countsPending === false && d2.partial === false, 'B5 来源标本地枚举、不标待校准', d2)
  check(c1.state.countsCalls === 3, 'B6 计数失败不被缓存：每次重建都重新问后端（实得 ' + c1.state.countsCalls + ' 次）')

  // B7 后端计数失败 + 列表截断 + 有上次已知 → 保留旧数字、旧时刻，标待校准。
  c1.state.listTruncated = true
  const r3: any = await c1.composer.composeSnapshot('c1', REF, { cwd: '/w' }, { force: true })
  const d3 = r3 && r3.ok ? r3.snapshot.deck : null
  check(!!d3 && d3.counts && d3.counts.open === 1 && d3.counts.closed === 1 && d3.counts.total === 2, 'B7 列表截断时保留上次已知的三数', d3 && d3.counts)
  check(!!d3 && d3.counts.source === 'previous-known' && d3.countsPending === true && d3.partial === true, 'B8 来源上次已知、标待校准、partial 置真', d3)
  check(!!d3 && typeof d3.counts.atMs === 'number' && d3.counts.atMs > 0, 'B9 上次已知带时刻（界面能说上次校准时间）', d3 && d3.counts)

  // B10 没有任何证据（新后端 id、列表截断、计数失败）→ deck.counts 不写（负例：不许假 0）。
  const c2 = makeComposer('c2', { ok: false, error: { kind: 'unsupported', message: 'counts 不可用', raw: '' } }, true)
  const r4: any = await c2.composer.composeSnapshot('c2', REF, { cwd: '/w' }, { force: true })
  const d4 = r4 && r4.ok ? r4.snapshot.deck : null
  check(!!d4 && !d4.counts, 'B10 毫无证据时 deck.counts 不存在（不写 0/0/0）', d4 && d4.counts)
  check(!!d4 && d4.countsPending === true && d4.partial === true, 'B11 毫无证据时标待校准并置 partial', d4)

  // B12 数字与行冲突：以行数据为准、后端数字留痕、partial 置真。
  const c3 = makeComposer('c3', { ok: true, data: { open: 1, closed: 0, total: 1 } }, false)
  const r5: any = await c3.composer.composeSnapshot('c3', REF, { cwd: '/w' }, { force: true })
  const d5 = r5 && r5.ok ? r5.snapshot.deck : null
  check(!!d5 && d5.counts && d5.counts.total === 2 && d5.counts.source === 'local-enumeration', 'B12 冲突时以行数据为准', d5 && d5.counts)
  check(!!d5 && d5.counts.conflictWith && d5.counts.conflictWith.total === 1 && d5.partial === true, 'B13 冲突留痕且 partial 置真', d5 && d5.counts && d5.counts.conflictWith)
}

// ────────────────────────────── C 客户端：只读快照投影，缺数字显示未知 ──────────────────────────────
{
  const stOf = (deck: any): any => ({ snapshot: { deck: deck } })
  // C1 deckCountsOf 带上来源、时刻与待校准标记。
  const c1 = derived.deckCountsOf(stOf({ counts: { open: 1, closed: 2, total: 3, source: 'backend', atMs: NOW }, countsPending: false }), false)
  check(c1 && c1.open === 1 && c1.closed === 2 && c1.total === 3, 'C1 deckCountsOf 三数照旧', c1)
  check(c1 && c1.source === 'backend' && c1.atMs === NOW && c1.pending === false, 'C2 deckCountsOf 带上来源、时刻与待校准标记', c1)
  const c2 = derived.deckCountsOf(stOf({ counts: { open: 1, closed: 2, total: 3 }, countsPending: true }), false)
  check(c2 && c2.source === '' && c2.atMs === 0 && c2.pending === true, 'C3 老快照没来源与时刻时回空值、待校准标记照读', c2)
  check(derived.deckCountsOf(stOf({ counts: { open: -1, closed: 2, total: 3 } }), false) === null, 'C4 坏数字仍回 null（老判据不变）', derived.deckCountsOf(stOf({ counts: { open: -1, closed: 2, total: 3 } }), false))
  check(derived.deckCountsOf(stOf({ counts: { open: 1, closed: 2, total: 3 } }), true) === null, 'C5 按 effort 筛选时不读整仓计数（老判据不变）')

  // C6 有计数：可接 = 后端 open - 本地占用的数；已关闭直接用后端数。
  const k1 = derived.kpiCountsOf(stOf({ counts: { open: 10, closed: 5, total: 15, source: 'backend', atMs: NOW } }), false, { open: 9, occupied: 4, closed: 5 })
  check(k1 && k1.takeable === 6 && k1.closed === 5 && k1.unknown === false, 'C6 有计数时 KPI 用后端数字算可接与已关闭', k1)
  check(k1 && k1.pending === false && k1.source === 'backend', 'C7 KPI 透传来源与待校准标记', k1)

  // C8 缺计数且标了待校准（未筛选）→ 未知，不许当 0。
  const k2 = derived.kpiCountsOf(stOf({ countsPending: true }), false, { open: 9, occupied: 4, closed: 5 })
  check(k2 && k2.unknown === true && k2.takeable === null && k2.closed === null, 'C8 缺计数且待校准时 KPI 显示未知、数字为 null（负例：不许回 0）', k2)
  check(k2 && k2.pending === true, 'C9 KPI 带上待校准标记（界面能说上次校准时间）', k2)

  // C10 缺计数但按 effort 筛选 → 本地数出来的数字（筛选口径本来就是本地算）。
  const k3 = derived.kpiCountsOf(stOf({ countsPending: true }), true, { open: 9, occupied: 4, closed: 5 })
  check(k3 && k3.unknown === false && k3.takeable === 5 && k3.closed === 5, 'C10 按 effort 筛选时用本地数（老口径不变）', k3)

  // C11 缺计数但没有待校准标记（老快照）→ 本地数（老行为不变）。
  const k4 = derived.kpiCountsOf(stOf({}), false, { open: 9, occupied: 4, closed: 5 })
  check(k4 && k4.unknown === false && k4.takeable === 5 && k4.closed === 5, 'C11 老快照缺计数时退回本地数（老行为不变）', k4)

  // C12 有计数但标了待校准 → 数字照旧、只多一个待校准提示。
  const k5 = derived.kpiCountsOf(stOf({ counts: { open: 10, closed: 5, total: 15, source: 'previous-known', atMs: NOW }, countsPending: true }), false, { open: 9, occupied: 4, closed: 5 })
  check(k5 && k5.takeable === 6 && k5.unknown === false && k5.pending === true, 'C12 有上次已知数字时照常显示、只标待校准', k5)
  check(typeof derived.deckCountsPendingOf === 'function' && derived.deckCountsPendingOf(null) === false, 'C13 deckCountsPendingOf 对空快照回 false', typeof derived.deckCountsPendingOf)
}

// ────────────────────────────── D 视图与词表接线 ──────────────────────────────
{
  const listTab = readFileSync(resolve(ROOT, 'src/client/views/ListTab.ts'), 'utf8')
  check(listTab.includes('declare function kpiCountsOf'), 'D1 ListTab 声明并使用 kpiCountsOf（数字只从快照投影算）', listTab.indexOf('kpiCountsOf') >= 0)
  check(listTab.includes("tr('list.countsUnknown')"), 'D2 缺数字时渲染「未知」文案（不写死中文、不当 0）', listTab.indexOf("list.countsUnknown") >= 0)
  check(listTab.includes("tr('list.countsPendingTitle'"), 'D3 待校准时把上次校准时间挂到计数区提示上', listTab.indexOf('list.countsPendingTitle') >= 0)
  const flow = readFileSync(resolve(ROOT, 'config/copy/flow.yaml'), 'utf8')
  const keys = ['list.countsUnknown', 'list.countsUnknownTitle', 'list.countsPendingTitle']
  for (const k of keys) {
    const hits = flow.split('\n').filter((line) => line.trim().indexOf(k + ':') === 0).length
    check(hits >= 2, 'D4 词表 ' + k + ' 中英各一份（实得 ' + hits + ' 处）', hits)
  }
}

console.log('')
printGateResult(GATE, total, failed ? 1 : 0)
process.exit(failed ? 1 : 0)
