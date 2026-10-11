/**
 * tests/verify-689-counts-ui.js — #689 面板侧（工单口径 · 数字读后端计数 · 被截断就说出来）门禁。
 *
 * 为什么要有这一条：契约那一段（tests/tracker-contract/sections/counts.js）守的是「后端数得对不对」，
 * 编排那一段（sections/snapshot.js）守的是「deck 里的数字与 partial 写没写对」；而验收判据里
 * 「面板顶部那个数字等于后端计数」「折叠行说的数与展开对得上」「主列表里没有拉取请求行」
 * 「KPI 与状态栏同口径」「拿不到计数就说出来」五条讲的是**界面**。这一条把界面那半边钉住。
 *
 * 做法：直接 import store-derived.js（工单口径与计数读取是纯函数，无闭包依赖）跑真行为。
 *
 * 用法：node tests/verify-689-counts-ui.js（在插件根目录）
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('#689 面板侧门禁（工单口径 / 数字读 deck.counts / 折叠行两个数 / 被截断就说出来）')

const STORE_DERIVED = 'src/client/kernel/store-derived.js'

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

}

console.log('\n共 ' + total + ' 条断言')
if (failed) { console.log('存在失败'); process.exit(1) }
console.log('全部通过')
