// tests/verify-counts-honesty.ts —— 计数诚实（#1698 起步；#1887 改成「数字从库来」的新口径）
//
// 守什么（#1887 之后）：
//   ① 六个数字只有一份形状：库的 readCounts 交上来的六个数 + 完整度；缺一格、负数、小数、
//      认不出的完整度都整份不采信 —— 不拿剩下的拼一个数，也不补 0。
//   ② 挂 deck 时不保留上一次的旧数字：这一趟读数坏了就把 deck.counts 清掉，界面说「未知」，
//      而不是拿旧数字冒充新数字。
//   ③ 客户端只认这一份：deckCountsOf 读六个数与完整度；老的三数形状、坏形状一律回 null；
//      带筛选时回 null（全仓数字不冒充筛过的数字）。
//   ④ KPI 三枚数字直接取库的可接/阻塞/已关闭；拿不到时退回手上这份池子的派生值，并如实标
//      complete=false —— 那是「已知」的下界，不是全仓数字。
//   ⑤ 旧口径退场：宿主不再向后端要 counts，源码里不再有 countsPending / planDeckCounts /
//      openRowsOf，「待校准」文案中英两份都删掉；库没取全时列表页说「已知 N 张（未取全）」。
//
// 反例（写代码时最常犯的两个错）：
//   - 拿不到库读数时返回 0/0/0 —— 界面会当成「真的没有票」；
//   - 只认三个数、把可接/阻塞/已认领当可选 —— 同一屏上几个数字来源不同，正是本票要消灭的。
//
// 运行：node --import ./scripts/ts-hook.mts tests/verify-counts-honesty.ts
// 门禁归属: src/tracker/deck-counts.ts
// 门禁归属: src/client/kernel/store-derived.ts
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import * as deckCounts from '../src/tracker/deck-counts.ts'
import * as derived from '../src/client/kernel/store-derived.ts'

const GATE = 'verify-counts-honesty'
const ROOT = process.cwd()
let total = 0
let failed = 0
function check(ok: unknown, message: string, detail?: unknown): void {
  total += 1
  if (ok) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

const NOW = 1761900000000
const GOOD = { total: 680, open: 30, closed: 650, takeable: 12, blocked: 7, claimed: 3, completeness: 'complete' }
function stOf(counts: any): any { return { snapshot: { deck: counts ? { counts: counts } : null, issues: [] } } }
function sourceOf(rel: string): string { return readFileSync(path.join(ROOT, rel), 'utf8') }
function codeOnly(source: string): string {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
}

// ────────────────────────────── A 形状：六个数 + 完整度，缺一格整份不采信 ──────────────────────────────
{
  const a = deckCounts.normalizeDeckCounts(GOOD)
  check(!!a && a.total === 680 && a.open === 30 && a.closed === 650 && a.takeable === 12 && a.blocked === 7 && a.claimed === 3,
    'A1 六个数字原样收下', a)
  check(!!a && a.completeness === 'complete', 'A2 完整度原样收下（complete）', a && a.completeness)
  check(!!deckCounts.normalizeDeckCounts(Object.assign({}, GOOD, { completeness: 'known' })), 'A3 known 也是合法完整度')
  check(deckCounts.normalizeDeckCounts({ total: 1, open: 1, closed: 0, takeable: 1, blocked: 0 }) === null,
    'A4 缺一个数字（claimed）→ 整份不采信（不拿剩下的拼一个数）')
  check(deckCounts.normalizeDeckCounts(Object.assign({}, GOOD, { open: -1 })) === null, 'A5 负数 → 整份不采信')
  check(deckCounts.normalizeDeckCounts(Object.assign({}, GOOD, { open: 1.5 })) === null, 'A6 小数 → 整份不采信')
  check(deckCounts.normalizeDeckCounts(Object.assign({}, GOOD, { completeness: 'maybe' })) === null, 'A7 认不出的完整度 → 整份不采信')
  check(deckCounts.normalizeDeckCounts(null) === null && deckCounts.normalizeDeckCounts('yes') === null, 'A8 奇形怪状 → null（不崩）')
}

// ────────────────────────────── B 挂 deck：坏读数清掉旧数字，不拿旧值冒充 ──────────────────────────────
{
  const deck: any = { counts: { stale: true } }
  const applied = deckCounts.applyDeckCounts(deck, GOOD)
  check(!!applied && deck.counts === applied && deck.counts.total === 680, 'B1 好读数挂上去（同一个对象）', deck.counts)
  const cleared = deckCounts.applyDeckCounts(deck, { total: 1 })
  check(cleared === null && !('counts' in deck), 'B2 读数不合格 → 把旧数字清掉（不保留上一次冒充这一次）', deck)
  check(deckCounts.applyDeckCounts(null, GOOD) !== null, 'B3 没有 deck 时也能收下这份读数（不崩）')
}

// ────────────────────────────── C 客户端读口：只认六个数 + 完整度 ──────────────────────────────
{
  const c = derived.deckCountsOf(stOf(GOOD), false)
  check(!!c && c.total === 680 && c.open === 30 && c.closed === 650 && c.takeable === 12 && c.blocked === 7 && c.claimed === 3,
    'C1 客户端读出六个数字', c)
  check(!!c && c.complete === true && c.completeness === 'complete', 'C2 完整枚举过 → complete', c && c.complete)
  const known = derived.deckCountsOf(stOf(Object.assign({}, GOOD, { completeness: 'known' })), false)
  check(!!known && known.complete === false && known.completeness === 'known', 'C3 没取全 → known / complete=false', known)
  check(derived.deckCountsOf(stOf({ partial: true }), false) === null, 'C4 没有 counts（旧快照）→ null')
  check(derived.deckCountsOf(stOf(GOOD), true) === null, 'C5 带筛选 → null（全仓数字不冒充筛过的数字）')
  check(derived.deckCountsOf(stOf({ total: 680, open: 30, closed: 650 }), false) === null, 'C6 老的三数形状 → null（不拿旧形状充数）')
  check(derived.deckCountsOf(stOf(Object.assign({}, GOOD, { blocked: 'x' })), false) === null, 'C7 坏数字 → null（不采信）')
  check(derived.deckCountsOf(null, false) === null, 'C8 没有快照 → null（不崩）')
}

// ────────────────────────────── D KPI 投影：库数优先，退回派生时标「已知」 ──────────────────────────────
{
  const local = { open: 9, occupied: 4, closed: 5 }
  const k1 = derived.kpiCountsOf(stOf(GOOD), false, local)
  check(!!k1 && k1.takeable === 12 && k1.blocked === 7 && k1.claimed === 3 && k1.closed === 650 && k1.total === 680,
    'D1 KPI 三枚数字直接取库的可接/阻塞/已关闭', k1)
  check(!!k1 && k1.complete === true, 'D2 库完整时 KPI 标 complete', k1 && k1.complete)
  const k2 = derived.kpiCountsOf(stOf(null), false, local)
  check(!!k2 && k2.takeable === 5 && k2.blocked === 4 && k2.closed === 5 && k2.total === 14,
    'D3 没有库读数 → 退回手上这份池子派生（9 开 5 关）', k2)
  check(!!k2 && k2.complete === false, 'D4 派生值标 complete=false（这是「已知」的下界，不是全仓）', k2 && k2.complete)
  const k3 = derived.kpiCountsOf(stOf(GOOD), true, local)
  check(!!k3 && k3.complete === false && k3.takeable === 5, 'D5 带筛选时也不拿全仓数字冒充（退回派生并标「已知」）', k3)
}

// ────────────────────────────── E 旧口径退场 ──────────────────────────────
{
  const snapSrc = codeOnly(sourceOf('src/host/tracker/snapshot.ts'))
  check(snapSrc.indexOf('countsFromBackend') < 0 && snapSrc.indexOf('planDeckCounts') < 0,
    'E1 宿主编排层不再向后端要计数（countsFromBackend / planDeckCounts 已删）')
  check(snapSrc.indexOf('.counts(') < 0, 'E2 编排层不再调用后端的 counts 操作')
  check(!('planDeckCounts' in deckCounts) && !('openRowsOf' in deckCounts),
    'E3 deck-counts 里旧的两来源口径（planDeckCounts / openRowsOf）已删除')
  const files = ['src/host/tracker/snapshot.ts', 'src/tracker/deck-counts.ts', 'src/client/kernel/store-derived.ts', 'src/refresh/rooms/host/row-patch.ts']
  check(files.every((rel) => codeOnly(sourceOf(rel)).indexOf('countsPending') < 0), 'E4 源码里不再有 countsPending 标记（待校准退场）', files.filter((rel) => codeOnly(sourceOf(rel)).indexOf('countsPending') >= 0))
  const listTab = sourceOf('src/client/views/ListTab.ts')
  check(listTab.indexOf("tr('list.countsKnownPartial'") >= 0 && listTab.indexOf('countsPendingTitle') < 0,
    'E5 列表页用「已知 N 张（未取全）」、不再引用「待校准」')
  const flow = sourceOf('config/copy/flow.yaml')
  check(flow.indexOf("list.countsKnownPartial: 已知 {n} 张（未取全）") >= 0
    && flow.indexOf('list.countsKnownPartial: Known {n} (not fully fetched)') >= 0
    && flow.indexOf('list.countsPendingTitle') < 0,
    'E6 「已知 N 张（未取全）」中英两份都在词表里，「待校准」两条都删掉')
}

console.log('')
console.log(failed ? 'FAIL：' + total + ' 条断言里有失败' : 'OK：' + total + ' 条断言全部通过')
printGateResult(GATE, total, failed)
process.exit(failed ? 1 : 0)
