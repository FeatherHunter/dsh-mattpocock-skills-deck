/**
 * tests/verify-689-counts-ui.js — #689 面板侧（工单口径 · 数字读后端计数 · 被截断就说出来）门禁。
 *
 * 为什么要有这一条：契约那一段（tests/tracker-contract/sections/counts.js）守的是「后端数得对不对」，
 * 编排那一段（sections/snapshot.js）守的是「deck 里的数字与 partial 写没写对」；而验收判据里
 * 「面板顶部那个数字等于后端计数」「折叠行说的数与展开对得上」「主列表里没有拉取请求行」
 * 「KPI 与状态栏同口径」「拿不到计数就说出来」五条讲的是**界面**。这一条把界面那半边钉住。
 *
 * 两半：
 *   一、行为断言：直接 import store-derived.js（工单口径与计数读取是纯函数，无闭包依赖）跑真行为。
 *   二、接线断言：对 ListTab.js / checksums.js 的源码文本判「数字与口径走的是这几处」。
 *      文本判据容易被「改了个名字但行为没变」误伤 —— 所以判据写成「这几行必须出现」，并配 ✗ 反例：
 *      把写坏的样本喂给检查器，它必须报违规（否则这一段等于没写）。
 *
 * 用法：node tests/verify-689-counts-ui.js（在插件根目录）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('#689 面板侧门禁（工单口径 / 数字读 deck.counts / 折叠行两个数 / 被截断就说出来）')

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const LIST_TAB = 'src/client/views/ListTab.js'
const STORE_DERIVED = 'src/client/kernel/store-derived.js'
const CHECKSUMS = 'src/client/statusbar/checksums.js'
const LOCALE = 'src/client/kernel/locale-flow.js'

// ── 一、行为断言：工单口径与「拿不到计数就退回」是纯函数，直接跑 ──
const sd = await import('file://' + path.join(ROOT, STORE_DERIVED).replace(/\\/g, '/'))
{
  check(typeof sd.isTicketRow === 'function' && typeof sd.ticketRowsOf === 'function' && typeof sd.deckCountsOf === 'function',
    '三个共用小件都在（isTicketRow / ticketRowsOf / deckCountsOf）')

  check(sd.isTicketRow({ key: '1' }) === true
    && sd.isTicketRow({ key: '2', isPullRequest: false }) === true
    && sd.isTicketRow({ key: '3', isPullRequest: true }) === false
    && sd.isTicketRow(null) === true,
    '工单口径：拉取请求不算工单，其余（含缺字段的无能力后端）都算')

  const rows = sd.ticketRowsOf([{ key: '1' }, { key: '2', isPullRequest: true }, { key: '3', isPullRequest: false }])
  check(rows.length === 2 && rows.every((x) => x.isPullRequest !== true), 'ticketRowsOf 真的把拉取请求滤掉了')
  check(Array.isArray(sd.ticketRowsOf(null)) && sd.ticketRowsOf(null).length === 0, 'ticketRowsOf 对非数组给空数组（不崩）')

  const st = (deck) => ({ snapshot: { deck: deck, issues: [] } })
  const good = sd.deckCountsOf(st({ counts: { open: 30, closed: 650, total: 680 } }), false)
  check(good && good.open === 30 && good.closed === 650 && good.total === 680, 'deck 里有计数 → 原样读出三个数')
  check(sd.deckCountsOf(st({ counts: { open: 30, closed: 650, total: 680 } }), true) === null, '界面带着筛选（scoped）→ 返回 null（全仓数字与筛过的一屏不是一个口径）')
  check(sd.deckCountsOf(st({ partial: true }), false) === null, '没有 counts（旧快照 / 后端不支持）→ 返回 null，调用方退回按池子派生')
  check(sd.deckCountsOf(st({ counts: { open: -1, closed: 650, total: 649 } }), false) === null, '计数写成负数 → 返回 null（不采信坏数）')
  check(sd.deckCountsOf(st({ counts: { open: 1.5, closed: 1, total: 2.5 } }), false) === null, '计数写成小数 → 返回 null')
  check(sd.deckCountsOf(st({ counts: 'yes' }), false) === null && sd.deckCountsOf(null, false) === null, '奇形怪状（字符串 / 没有快照）→ 返回 null（不崩）')

  // 状态栏那几枚与 KPI 用的是同一句话：openIssuesOf 走 ticketRowsOf
  check(/export const openIssuesOf = \(st\) => ticketRowsOf\(/.test(read(STORE_DERIVED)),
    'openIssuesOf（可接/BUG/待分流的底座）本身就走工单口径 —— 主列表、KPI、状态栏因此同一处判断')
}

// ── 二、接线断言：检查器 + ✗ 反例 ──
/** KPI 那一行检查器：返回违规清单（空 = 合规）。样本是 ListTab.js 的源码文本。 */
export function kpiWiringCheck(src) {
  const bad = []
  if (!/deckCountsOf\(st, kpiFiltered\)/.test(src)) bad.push('KPI 没有从 deck 读后端计数（应调用 deckCountsOf(st, kpiFiltered)）')
  if (!/const kpiClosed = kpiCounts \? kpiCounts\.closed/.test(src)) bad.push('「已关闭」没有优先用后端计数（应写 kpiCounts ? kpiCounts.closed : 池子派生值）')
  if (!/const kpiFrontier = kpiCounts \? Math\.max\(0, kpiCounts\.open - kpiOcc\)/.test(src)) bad.push('「可接」没有用后端说的未关闭张数减去本地阻塞')
  if (!/const kpiFiltered = !!\(\(st\.effFilters \|\| \[\]\)\.length\)/.test(src)) bad.push('没有把「界面带着筛选」这一态算出来（带筛选时必须退回按池子派生）')
  if (!/deck\.partial === true/.test(src)) bad.push('没有读 deck.partial（被截断时界面要说出来）')
  if (!/tr\('list\.partial'\)/.test(src)) bad.push('「这份清单不全」没有走词条（界面文字中英各一份）')
  return bad
}
/** 折叠行检查器：N 来自后端计数、x 来自已加载的行数，两个都要写出来。 */
export function foldRowCheck(src) {
  const bad = []
  if (!/tr\('list\.closedN', \{ n: foldCounts \? foldCounts\.closed : closedRows\.length, x: closedRows\.length \}\)/.test(src)) {
    bad.push('折叠行没有同时写出「一共多少张」与「已加载多少张」')
  }
  if (!/deckCountsOf\(st, !!\(\(\(st\.effFilters \|\| \[\]\)\.length\) \|\| \(\(st\.lblFilters \|\| \[\]\)\.length\)\)\)/.test(src)) {
    bad.push('折叠行的总数没有按「带筛选就退回手上的行数」处理')
  }
  return bad
}
/** 主列表检查器：拉取请求不许进主列表（工单口径），且必须走共用判断。 */
export function listFilterCheck(src) {
  const bad = []
  if (!/const issues = ticketRowsOf\(/.test(src)) bad.push('主列表没有按工单口径过滤（应走 ticketRowsOf，不许自己写一份判断）')
  if (/const issues = \(st\.snapshot && Array\.isArray\(st\.snapshot\.issues\)\) \? st\.snapshot\.issues : \[\]/.test(src)) bad.push('主列表仍在使用未过滤的池子')
  return bad
}
/** 状态栏检查器：可接那一枚读后端计数（与 KPI 同源）。 */
export function statusbarCheck(src) {
  const bad = []
  if (!/const counts = deckCountsOf\(s, false\)/.test(src)) bad.push('状态栏「可接」没有读后端计数')
  if (!/const fr = counts \? Math\.max\(0, counts\.open - occ\) : frontierCount\(s\)/.test(src)) bad.push('状态栏「可接」没有用后端计数减本地阻塞（拿不到才退回派生）')
  return bad
}
/** 词条检查器：中英各一份，且 {n}/{x} 两个占位符都在。 */
export function localeCheck(src) {
  const bad = []
  const zh = src.slice(src.indexOf('zh: {'), src.indexOf('en: {'))
  const en = src.slice(src.indexOf('en: {'))
  for (const [label, part] of [['中文', zh], ['英文', en]]) {
    if (!/'list\.closedN': '.*\{n\}.*\{x\}.*'/.test(part)) bad.push(label + '的 list.closedN 少了 {n} 或 {x}')
    if (!/'list\.partial': '[^']+'/.test(part)) bad.push(label + '缺 list.partial（这份清单不全）')
    if (!/'list\.partialTitle': '[^']+'/.test(part)) bad.push(label + '缺 list.partialTitle（悬停时把两种情形说清）')
  }
  return bad
}

{
  const listTab = read(LIST_TAB)
  check(kpiWiringCheck(listTab).length === 0, 'ListTab：KPI 三个数字走 deck.counts（' + (kpiWiringCheck(listTab).join('；') || '全部命中') + '）')
  check(foldRowCheck(listTab).length === 0, 'ListTab：折叠行写全「一共 / 已加载」两个数（' + (foldRowCheck(listTab).join('；') || '全部命中') + '）')
  check(listFilterCheck(listTab).length === 0, 'ListTab：主列表按工单口径过滤（' + (listFilterCheck(listTab).join('；') || '全部命中') + '）')
  check(statusbarCheck(read(CHECKSUMS)).length === 0, '状态栏：可接那一枚与 KPI 同源（' + (statusbarCheck(read(CHECKSUMS)).join('；') || '全部命中') + '）')
  check(localeCheck(read(LOCALE)).length === 0, '词条：中英各一份、占位符齐全（' + (localeCheck(read(LOCALE)).join('；') || '全部命中') + '）')

  // ✗ 反例：把写坏的样本喂给检查器，必须报违规（否则这一段形同虚设）
  const badKpi = listTab
    .replace(/deckCountsOf\(st, kpiFiltered\)/, 'null')
    .replace(/const kpiClosed = kpiCounts \? kpiCounts\.closed : /, 'const kpiClosed = ')
  check(kpiWiringCheck(badKpi).length > 0, '✗ probe: 退回「自己数池子」的 KPI 被逮（不再读 deck.counts）')
  const badFold = listTab.replace(/x: closedRows\.length \}\)/, '})')
  check(foldRowCheck(badFold).length > 0, '✗ probe: 折叠行只写一个数的写法被逮')
  const badList = listTab.replace(/const issues = ticketRowsOf\(\(st\.snapshot && Array\.isArray\(st\.snapshot\.issues\)\) \? st\.snapshot\.issues : \[\]\)/, 'const issues = (st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []')
  check(listFilterCheck(badList).length > 0, '✗ probe: 把未过滤的池子当主列表被逮（拉取请求会混进来）')
  const badStatus = read(CHECKSUMS).replace(/const counts = deckCountsOf\(s, false\)/, 'const counts = null')
  check(statusbarCheck(badStatus).length > 0, '✗ probe: 状态栏退回只看池子被逮（口径与 KPI 不一致）')
  const badLocale = read(LOCALE).replace(/'list\.partial': '[^']+',[^\n]*\n/, '')
  check(localeCheck(badLocale).length > 0, '✗ probe: 少一条词条被逮')
}

console.log('\n共 ' + total + ' 条断言')
if (failed) { console.log('存在失败'); process.exit(1) }
console.log('全部通过')
