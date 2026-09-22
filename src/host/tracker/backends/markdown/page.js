/**
 * backends/markdown/page.js — 本地 Markdown 后端的按页取票（listPage 那条操作；契约见 tracker/contract-page.js）。
 *
 * 这一条只干一件事：按「创建时间倒序」切一页票行出来，外加「同一口径下一共多少张」。
 * 本地这一侧本来就是「把目录里的票文件全读出来」（#688 实测过：列举没有截断，天然是全量），
 * 所以这一条**没有额外代价**，实现就是给排好序的那份列表切一刀 —— 补它是为了让界面只有一条路：
 * 界面按页取历史时不需要知道后端是谁。
 *
 * 三处与契约对齐的口径（都在 contract-page.js 里写着）：
 *  - **排序键固定「创建时间倒序」**：本后端的 createdAt 来自票文件的修改时间（parse.js 取的 mtime，ISO 字符串），
 *    这一条**只在按页取这条路**上生效；列举（list）那条路的顺序一个字节没动 —— 这是维护者 2026-09-22
 *    拍板的结果（#688 的实测结论里点出两边顺序不一致，要么改列举、要么只在分页里重排）。
 *    同一时刻的票（同一个文件时间戳）再用「工作单元 + 编号」兜底，保证顺序稳定、翻页不重不漏。
 *  - **游标 = 下标字符串**：切到第几个，原样回传；它是不透明字符串，后端不解析，只在越界或不是数字时
 *    判「这个游标跟现在这份数据对不上了」→ 明说「游标已失效，请重新加载」，界面据此重取第一页。
 *  - **limit 缺省 50、上限 200**，要多了按上限给（不是报错）；items 条数如实反映实际切到几张。
 *  - **行数据是薄片段**：正文与评论不随页数据走（画一行一个字都用不到；详情页另有自己那次取数）。
 *  - **票文件读不动 → 整体失败**（与 counts 同一条）：拿不全就整体失败，不许在历史里悄悄少几行 ——
 *    半页与一页在界面上长得一模一样，用户只会以为「历史就到这儿了」。
 *  - **不缓存判定**（G5 红线）：失败一律如实返回，缓存层在编排层。
 */

import { ERROR_KIND, ISSUE_TYPE, STATE } from '../../../../shared/tracker/constants.js'
import { classifyError } from '../../preflight.js'
import { enumerateIssueRows } from './issues-read.js'
// 这三件与 counts 共用同一份实现：分页与计数说的必须是**同一批票**，两处各写一份判定迟早走样。
import { labelsOf, hasAllLabels, narrowStateOf, readFailureMessage } from './counts.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** limit 归一（与 GitHub 那条同一口径）：不合法（缺、非整数、非正）按缺省 50；超过上限按上限 200。 */
function limitOf(opts) {
  const v = opts && typeof opts === 'object' ? opts.limit : undefined
  if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v <= 0) return DEFAULT_LIMIT
  return v > MAX_LIMIT ? MAX_LIMIT : v
}

/** 「创建时间倒序」比较器：先比 createdAt，再拿「工作单元 + 编号」兜底，保证同一时刻的票也有稳定次序。 */
function byCreatedAtDesc(a, b) {
  const x = String((a && a.createdAt) || '')
  const y = String((b && b.createdAt) || '')
  if (x !== y) return x < y ? 1 : -1
  const ea = String((a && a.effortId) || '')
  const eb = String((b && b.effortId) || '')
  if (ea !== eb) return ea < eb ? -1 : 1
  return String((a && a.key) || '').localeCompare(String((b && b.key) || ''))
}

/** 薄片段：正文与评论不随页数据走（契约「分页契约」那一节；界面画一行一个字都用不到它们）。 */
function thinRow(row) {
  const t = Object.assign({}, row)
  delete t.body
  delete t.comments
  return t
}

/** 游标 → 起始下标。不是数字、或指到了列表之外，都算「这个游标跟现在这份数据对不上」并说清怎么办。 */
function startIndexOf(cursor, total) {
  if (!cursor) return { ok: true, start: 0 }
  if (!/^\d+$/.test(cursor)) {
    return { ok: false, error: { kind: ERROR_KIND.PARSE, message: '游标已失效，请重新加载（这个后端的游标是排好序的票行列表里的下标，收到的不是数字：' + cursor.slice(0, 32) + '）' } }
  }
  const start = parseInt(cursor, 10)
  if (start >= total) {
    return { ok: false, error: { kind: ERROR_KIND.NOTFOUND, message: '游标已失效，请重新加载（下标 ' + start + ' 越过了现在这 ' + total + ' 行）' } }
  }
  return { ok: true, start: start }
}

/**
 * listPage(ctx, repo, filter, opts) → `{ok:true, data:{items, nextCursor, total}}` 或 `{ok:false, error:{kind,message}}`。
 * filter 只认 state 与 labels（契约同 counts）；effortId 走 repo（作用域与 list / counts 同口径）。
 */
export async function listIssuesPage(ctx, repo, filter = {}, opts = {}) {
  try {
    const scopeFilter = { effortId: filter && filter.effortId }
    const { rows, errors } = await enumerateIssueRows(ctx, repo, scopeFilter, { collectErrors: true })
    if (errors.length) {
      const kind = errors[0].kind || ERROR_KIND.ENV
      return { ok: false, error: { kind, message: readFailureMessage(errors) } }
    }
    const wanted = labelsOf(filter)
    const narrow = narrowStateOf(filter)
    let tickets = rows.filter(function (r) { return r && r.type !== ISSUE_TYPE.MAP })
    if (wanted.length) tickets = tickets.filter(function (r) { return hasAllLabels(r, wanted) })
    if (narrow) tickets = tickets.filter(function (r) { return narrow === STATE.CLOSED ? r.state === STATE.CLOSED : r.state !== STATE.CLOSED })
    const sorted = tickets.slice().sort(byCreatedAtDesc)
    const total = sorted.length
    const startRes = startIndexOf((opts && typeof opts.cursor === 'string') ? opts.cursor.trim() : '', total)
    if (!startRes.ok) return { ok: false, error: startRes.error }
    const start = startRes.start
    const lim = limitOf(opts)
    const items = sorted.slice(start, start + lim).map(thinRow)
    const nextCursor = (start + items.length) < total ? String(start + items.length) : null
    return { ok: true, data: { items: items, nextCursor: nextCursor, total: total } }
  } catch (e) {
    const kind = e && e.kind ? e.kind : classifyError(e)
    return { ok: false, error: { kind, message: e && e.message ? e.message : String(e) } }
  }
}

export default { listIssuesPage }
