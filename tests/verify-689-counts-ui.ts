#!/usr/bin/env node
/**
 * verify-689-counts-ui.js —— #689 面板侧门禁（工单口径 / 数字读 deck.counts / 折叠行两个数 / 被截断就说出来）
 *
 * 逐条行为断言：工单口径（普通算、显式非 PR 算、PR 不算、null 算）、ticketRowsOf 真过滤与非数组给空、
 * deckCountsOf（有计数原样读三数、scoped 返 null、无 counts 返 null、负数/小数/畸形返 null）。
 *
 * 依赖：直接 import 真源 src/client/kernel/store-derived.js 的纯函数。
 * 用法：node tests/verify-689-counts-ui.js
 */
import path from 'node:path'

const ROOT = process.cwd()

let failed = false
let total = 0
const check = (ok: unknown, msg: string): void => { total++; if (ok) { console.log('  PASS ' + msg) } else { console.log('  FAIL ' + msg); failed = true } }

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

  const st = (deck: any) => ({ snapshot: { deck: deck, issues: [] } })
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
