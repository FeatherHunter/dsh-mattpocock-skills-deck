#!/usr/bin/env node
/**
 * 门禁：计数诚实（#1698 起步，#1796 收口「全不全」的口径）。
 *
 * 守的东西（规格 #1681 第 23 条、#1796 票面第五条）：
 * ① 数字优先后端 counts（整仓口径），来源标「后端」；拿不到时保留上次已知的数字与时刻并标「待校准」，
 *    界面不出现假 0；一点证据都没有时不写 deck.counts。
 * ② 「全不全」（deck.partial）只报异常缺失四种情形：开放工作集行数对不上后端 open、列表触到上限、
 *    REST 降级、计数冲突或缺失。#1796 之前那档「本地按行重算」已随首屏改成只装开放工作集而取消
 *    （已关闭历史不进首屏，本地数不出 closed 与 total）。
 * ③ 后端数字与开放行数冲突（行比后端还多）时数字仍用后端，冲突留痕（conflictWith），partial 置真。
 * ④ 客户端只读快照里的计数：缺数字且标了待校准就显示「未知」，绝不当 0 显示；老快照保持老行为。
 *
 * 负例（每条都有一条能红的断言）：
 * - 拿不到计数时 planDeckCounts 不许回 0/0/0，必须回 null（composeSnapshot 就不许写 deck.counts）；
 * - 把「已关闭历史只装首页」当成缺 → 禁止（那是规格 677 §6.3 的设计，会让橙点常亮）；
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

let total = 0
let failed = 0
function check (cond: any, msg: string, detail?: any): void {
  total += 1
  if (cond) console.log('PASS ' + msg)
  else { failed += 1; console.log('FAIL ' + msg + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）')) }
}

// ────────────────────────────── A 纯函数：planDeckCounts / openRowsOf ──────────────────────────────
{
  // #1796 起「数字」与「全不全」分开算：数字优先后端 counts，partial 只报异常缺失四种情形
  // （开放行数对不上后端 open、列表触上限、REST 降级、计数冲突或缺失）；
  // 另加一种：开放容器的子票没拉全或拉不到（code review 指出，规格 677 §6.2 已写明）。

  // A1 后端数字可信、开放行数与后端 open 一致 → 原样采用，不置 partial。
  const p1 = deckCounts.planDeckCounts({ backendCounts: BACK, openRows: 10, nowMs: NOW })
  check(p1.counts && p1.counts.open === 10 && p1.counts.closed === 5 && p1.counts.total === 15, 'A1 后端计数可信时三数原样采用', p1.counts)
  check(p1.counts && p1.counts.source === 'backend' && p1.counts.atMs === NOW && p1.pending === false, 'A2 来源标 backend、时刻记 nowMs、不标待校准', p1.counts)
  check(p1.partial === false, 'A3 开放行数等于后端 open → 不置 partial', p1)

  // A4 开放行数比后端 open 少 = 首屏真的缺未关闭票（#1796 的现场）→ partial 置真。
  const p2 = deckCounts.planDeckCounts({ backendCounts: BACK, openRows: 9, nowMs: NOW })
  check(p2.counts && p2.counts.open === 10 && p2.partial === true, 'A4 开放行数少于后端 open → 用后端数字且 partial 置真', p2)

  // A5 行比后端还多 → 两边对不上：数字仍用后端（整仓口径），冲突留痕，partial 置真。
  const p3 = deckCounts.planDeckCounts({ backendCounts: { open: 1, closed: 0, total: 1 }, openRows: 2, nowMs: NOW })
  check(p3.counts && p3.counts.open === 1 && p3.counts.total === 1, 'A5 行比后端多时数字仍用后端（整仓口径）', p3.counts)
  check(p3.counts && p3.counts.conflictWith && p3.counts.conflictWith.total === 1, 'A6 冲突的后端数字留痕（conflictWith）', p3.counts && p3.counts.conflictWith)
  check(p3.partial === true, 'A7 冲突时 partial 置真', p3)

  // A8 数不到开放行数（没有行数据）→ 有后端数字也不能声称齐全。
  const p4 = deckCounts.planDeckCounts({ backendCounts: BACK, openRows: null, nowMs: NOW })
  check(p4.counts && p4.counts.source === 'backend' && p4.partial === true, 'A8 没有开放行数可比 → 用后端数字、partial 置真', p4)

  // A9/A10 列表触上限、走了 REST 降级 → 行是兜回来的，partial 置真。
  const p5 = deckCounts.planDeckCounts({ backendCounts: BACK, openRows: 10, listTruncated: true, nowMs: NOW })
  check(p5.partial === true, 'A9 列表触到后端上限 → partial 置真', p5)
  const p6 = deckCounts.planDeckCounts({ backendCounts: BACK, openRows: 10, listFallback: true, nowMs: NOW })
  check(p6.partial === true, 'A10 走了 REST 降级 → partial 置真', p6)

  // A11 后端数字是坏形状（负数）→ 当没有，回落上次已知（负例：坏数字不许当证据）。
  const prev = { open: 30, closed: 650, total: 680, source: 'backend', atMs: NOW - 60000 }
  const p7 = deckCounts.planDeckCounts({ backendCounts: { open: -1, closed: 650, total: 680 }, openRows: 9, previousCounts: prev, nowMs: NOW })
  check(p7.counts && p7.counts.source === 'previous-known' && p7.counts.open === 30, 'A11 后端数字坏掉时当没有，回落上次已知', p7.counts)

  // A12/A13 拿不到后端计数 + 有上次已知 → 保留旧值、旧时刻，标待校准；partial 一律置真。
  const p8 = deckCounts.planDeckCounts({ backendCounts: null, openRows: 9, previousCounts: prev, nowMs: NOW })
  check(p8.counts && p8.counts.source === 'previous-known' && p8.counts.atMs === NOW - 60000 && p8.pending === true && p8.partial === true, 'A12 拿不到计数时保留上次已知、旧时刻、标待校准并置 partial', p8)
  check(p8.counts && p8.counts.total === 680, 'A13 上次已知的三数照原样', p8.counts)

  // A14 上次已知没带时刻 → 用调用方给的上一份快照时刻（界面说「上次校准：时间」要有出处）。
  const p9 = deckCounts.planDeckCounts({ backendCounts: null, openRows: null, previousCounts: { open: 30, closed: 650, total: 680 }, previousAtMs: NOW - 5000, nowMs: NOW })
  check(p9.counts && p9.counts.source === 'previous-known' && p9.counts.atMs === NOW - 5000, 'A14 上次已知无时刻时用上一份快照的时刻', p9.counts)

  // A15 上次已知是坏数字 → 不采用（负例：不许拿坏值当已知）。
  const p10 = deckCounts.planDeckCounts({ backendCounts: null, openRows: null, previousCounts: { open: '30', closed: -1, total: 680 }, nowMs: NOW })
  check(p10.counts === null && p10.pending === true && p10.partial === true, 'A15 上次已知是坏数字时不采用，回 null 并标待校准', p10)

  // A16 一点证据都没有 → counts 回 null（负例：拿不到计数不许写 0/0/0 冒充完整）。
  const p11 = deckCounts.planDeckCounts({ backendCounts: null, openRows: null, previousCounts: null, nowMs: NOW })
  check(p11.counts === null, 'A16 一点证据都没有时 counts 回 null（不写假 0）', p11)
  check(p11.pending === true && p11.partial === true, 'A17 无证据时标待校准并置 partial', p11)

  // A21–A24 开放容器的子票没拉全（撞上限）或拉不到，也算异常缺失：从前只影响回补、橙点不亮。
  const p12 = deckCounts.planDeckCounts({ backendCounts: BACK, openRows: 10, subIssuesIncomplete: 1, nowMs: NOW })
  check(p12.partial === true, 'A21 开放容器子票撞上限 → partial 置真', p12)
  check(p12.counts && p12.counts.open === 10, 'A22 子票装不全不改后端数字本身（只报缺）', p12.counts)
  const p13 = deckCounts.planDeckCounts({ backendCounts: BACK, openRows: 10, subIssuesFailed: 1, nowMs: NOW })
  check(p13.partial === true, 'A23 开放容器子票拉不到 → partial 置真', p13)
  const p14 = deckCounts.planDeckCounts({ backendCounts: BACK, openRows: 10, subIssuesIncomplete: 0, subIssuesFailed: 0, nowMs: NOW })
  check(p14.partial === false, 'A24 子票都补齐（计数为 0）→ partial 仍为假（对照）', p14)

  // A18 openRowsOf：只数未关闭、按 (effortId, key) 去重、PR 不算工单、没编号的行数不到。
  const rows = [
    { key: '1', effortId: '', title: 'A', state: 'OPEN', isPullRequest: false },
    { key: '1', effortId: '', title: 'A 的重复行', state: 'OPEN', isPullRequest: false },
    { key: '2', effortId: '', title: 'B', state: 'CLOSED', isPullRequest: false },
    { key: '9', effortId: '', title: 'PR', state: 'OPEN', isPullRequest: true },
    { key: '100', effortId: '', title: '地图容器', state: 'open' },
    { title: '没编号的行', effortId: '', state: 'OPEN' },
  ]
  const openRowCount = deckCounts.openRowsOf(rows)
  check(openRowCount === 2, 'A18 openRowsOf 只数未关闭、去重、跳过 PR 与没编号的行（实得 ' + JSON.stringify(openRowCount) + '）', openRowCount)
  check(deckCounts.openRowsOf([]) === 0, 'A19 openRowsOf 空数组回 0（真的没有行）', deckCounts.openRowsOf([]))
  check(deckCounts.openRowsOf(null) === null, 'A20 openRowsOf 没有行数据时回 null（不写 0）', deckCounts.openRowsOf(null))
}

// ────────────────────────────── B 集成：composeSnapshot 走真快照路径 ──────────────────────────────
const EMPTY_CTX: any = {}
function base (o: any): any {
  return Object.assign({ type: 'issue', title: 'T', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: null, labels: [], assignees: [], blockedBy: [], comments: [], reason: '' }, o)
}
const REF = { backend: 'fake', refId: 'r1', name: 'R1', url: '' }

/**
 * 造一个只有 list / counts 的假后端：首屏 list 会收到 {state:'open'}（#1796），
 * 假后端本身不看筛选、原样回 pool —— 这里验的是编排层的判定，后端筛状态另由契约门禁盯着。
 */
function makeComposer (id: string, pool: any[], counts: any, listTruncated: boolean): any {
  const registry = createRegistry(EMPTY_CTX, { matchesTimeout: 50 })
  const state = { counts: counts, listTruncated: listTruncated, countsCalls: 0, listCalls: 0, lastFilter: null }
  registry.register({
    id: id, label: id,
    budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
    create: () => ({
      list: async (_ref: any, filter: any) => { state.listCalls += 1; state.lastFilter = filter; return state.listTruncated ? { ok: true, data: pool, truncated: true } : { ok: true, data: pool } },
      counts: async () => { state.countsCalls += 1; return state.counts },
    }),
    matches: async () => true,
  } as any)
  return { composer: createSnapshotComposer(registry, { snapshotTtl: 50, depsTtl: 50 }), state: state }
}
const POOL = [base({ key: '1', title: 'A' }), base({ key: '2', title: 'B', state: 'closed' })]

{
  // B1 后端计数可信：来源 backend、不标待校准、不置 partial。
  const c1 = makeComposer('c1', POOL, { ok: true, data: { open: 1, closed: 1, total: 2 } }, false)
  const r1: any = await c1.composer.composeSnapshot('c1', REF, { cwd: '/w' }, { force: true })
  const d1 = r1 && r1.ok ? r1.snapshot.deck : null
  check(!!d1 && d1.counts && d1.counts.open === 1 && d1.counts.closed === 1 && d1.counts.total === 2, 'B1 后端计数进 deck.counts 三数', d1 && d1.counts)
  check(!!d1 && d1.counts.source === 'backend' && d1.countsPending === false && d1.partial === false, 'B2 来源 backend、countsPending 假、partial 假', d1)
  check(!!d1 && d1.missingOpen === 0, 'B3 开放行数与后端 open 相等 → deck.missingOpen 为 0（一张都不缺）', d1 && d1.missingOpen)
  check(!!c1.state.lastFilter && c1.state.lastFilter.state === 'open', 'B4 首屏列表真的下推了状态筛选（list 收到 {state:open}）', c1.state.lastFilter)
  const v1 = r1 && r1.ok ? r1.snapshot.version : ''
  const r1b: any = await c1.composer.composeSnapshot('c1', REF, { cwd: '/w' }, { force: true })
  check(!!v1 && r1b.ok && r1b.snapshot.version === v1, 'B5 同一份数据重建版号不变（时刻不进版号）', [v1, r1b.ok ? r1b.snapshot.version : ''])

  // B6 后端计数失败 → 保留上次已知（同一份快照里已有）并标待校准；#1796 起拿不到计数也算异常缺失，partial 置真。
  c1.state.counts = { ok: false, error: { kind: 'unsupported', message: 'counts 不可用', raw: '' } }
  const r2: any = await c1.composer.composeSnapshot('c1', REF, { cwd: '/w' }, { force: true })
  const d2 = r2 && r2.ok ? r2.snapshot.deck : null
  check(!!d2 && d2.counts && d2.counts.open === 1 && d2.counts.total === 2, 'B6 计数拿不到时保留上次已知的三数（不写假 0）', d2 && d2.counts)
  check(!!d2 && d2.counts.source === 'previous-known' && d2.countsPending === true && d2.partial === true, 'B7 来源上次已知、标待校准、partial 置真', d2)
  check(c1.state.countsCalls === 3, 'B8 计数失败不被缓存：每次重建都重新问后端（实得 ' + c1.state.countsCalls + ' 次）')

  // B9 列表截断 + 计数失败 + 有上次已知 → 数字照旧保留，partial 一定置真。
  c1.state.listTruncated = true
  const r3: any = await c1.composer.composeSnapshot('c1', REF, { cwd: '/w' }, { force: true })
  const d3 = r3 && r3.ok ? r3.snapshot.deck : null
  check(!!d3 && d3.counts && d3.counts.open === 1 && d3.partial === true, 'B9 列表截断时数字与 partial 都如实', d3)
  check(!!d3 && typeof d3.counts.atMs === 'number' && d3.counts.atMs > 0, 'B10 上次已知带时刻（界面能说上次校准时间）', d3 && d3.counts)

  // B11 毫无证据（新后端 id、计数失败、列表截断）→ deck.counts 不写（负例：不许假 0）。
  const c2 = makeComposer('c2', POOL, { ok: false, error: { kind: 'unsupported', message: 'counts 不可用', raw: '' } }, true)
  const r4: any = await c2.composer.composeSnapshot('c2', REF, { cwd: '/w' }, { force: true })
  const d4 = r4 && r4.ok ? r4.snapshot.deck : null
  check(!!d4 && !d4.counts, 'B11 毫无证据时 deck.counts 不存在（不写 0/0/0）', d4 && d4.counts)
  check(!!d4 && d4.countsPending === true && d4.partial === true, 'B12 毫无证据时标待校准并置 partial', d4)
  check(!!d4 && d4.missingOpen === undefined, 'B13 算不出开放行数时不写 missingOpen（不拿 0 冒充一张不缺）', d4 && d4.missingOpen)

  // B14 行数比后端 open 多 → 数字仍用后端、留痕冲突、partial 置真。
  const c3 = makeComposer('c3', [base({ key: '1', title: 'A' }), base({ key: '3', title: 'C' })], { ok: true, data: { open: 1, closed: 0, total: 1 } }, false)
  const r5: any = await c3.composer.composeSnapshot('c3', REF, { cwd: '/w' }, { force: true })
  const d5 = r5 && r5.ok ? r5.snapshot.deck : null
  check(!!d5 && d5.counts && d5.counts.total === 1 && d5.counts.source === 'backend', 'B14 冲突时数字仍用后端', d5 && d5.counts)
  check(!!d5 && d5.counts.conflictWith && d5.counts.conflictWith.total === 1 && d5.partial === true, 'B15 冲突留痕且 partial 置真', d5 && d5.counts && d5.counts.conflictWith)

  // B16 开放行数比后端 open 少 → 说出缺几张（界面橙点用 deck.missingOpen 说「缺 N 张未关闭票」）。
  const c4 = makeComposer('c4', [base({ key: '1', title: 'A' })], { ok: true, data: { open: 3, closed: 5, total: 8 } }, false)
  const r6: any = await c4.composer.composeSnapshot('c4', REF, { cwd: '/w' }, { force: true })
  const d6 = r6 && r6.ok ? r6.snapshot.deck : null
  check(!!d6 && d6.partial === true && d6.missingOpen === 2, 'B16 开放行数少于后端 open → partial 置真并说出缺 2 张', d6)
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
