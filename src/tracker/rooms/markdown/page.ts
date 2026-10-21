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

import { ERROR_KIND, ISSUE_TYPE, STATE } from '../../contract/vocabulary.js'
import type { OpContext } from '../../contract/contexts.js'
import type { RepositoryRef, Issue } from '../../contract/entities.js'
import type { ListFilter, PageOpts } from '../../contract/inputs.js'
import { failAs, failFromError } from './error-fail.js'
import { emitReadDegraded } from './read-log.js'
import { enumerateIssueRows } from './issues-read.js'
// 这三件与 counts 共用同一份实现：分页与计数说的必须是**同一批票**，两处各写一份判定迟早走样。
import { labelsOf, hasAllLabels, narrowStateOf, readFailureMessage } from './counts.js'
import { PAGINATION } from '../../contract/pagination.js'

// 仓库引用：path 是本地后端的自有约定（契约不保证），有就多认那个目录（path.ts 的同款，房间里各备一份）。
type RepoWithPath = RepositoryRef & { path?: string }

const DEFAULT_LIMIT = PAGINATION.markdown.limitDefault
const MAX_LIMIT = PAGINATION.markdown.limitMax

/** limit 归一（与 GitHub 那条同一口径）：不合法（缺、非整数、非正）按缺省 50；超过上限按上限 200。 */
function limitOf(opts: PageOpts | undefined): number {
  const v = opts && typeof opts === 'object' ? opts.limit : undefined
  if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v <= 0) return DEFAULT_LIMIT
  return v > MAX_LIMIT ? MAX_LIMIT : v
}

/** 「创建时间倒序」比较器：先比 createdAt，再拿「工作单元 + 编号」兜底，保证同一时刻的票也有稳定次序。 */
function byCreatedAtDesc(a: Issue, b: Issue): number {
  const x = String((a && a.createdAt) || '')
  const y = String((b && b.createdAt) || '')
  if (x !== y) return x < y ? 1 : -1
  const ea = String((a && a.effortId) || '')
  const eb = String((b && b.effortId) || '')
  if (ea !== eb) return ea < eb ? -1 : 1
  return String((a && a.key) || '').localeCompare(String((b && b.key) || ''))
}

/** 薄片段：正文与评论不随页数据走（契约「分页契约」那一节；界面画一行一个字都用不到它们）。 */
function thinRow(row: Issue): Issue {
  // delete 要求键可选（Issue 的 body/comments 必填）：摊成匿名对象再经 Record 视图删
  // （interface 没有隐式索引签名，断回 Issue 要经 unknown 中转）；删的是展开项，
  // 行其余键原样保留，求值与原来逐字相同。
  const t: Record<string, unknown> = { ...row }
  delete t.body
  delete t.comments
  return t as unknown as Issue
}

/** 游标 → 起始下标。不是数字、或指到了列表之外，都算「这个游标跟现在这份数据对不上」并说清怎么办。
 *  不成立时连**该记哪一档日志**（`listPage:cursor` 还是 `listPage:cursor-stale`）一起交出来：
 *  这两档在界面上长得一样（都要重新加载），事后只能靠日志分。 */
function startIndexOf(cursor: string, total: number): { ok: true; start: number } | { ok: false; reason: string; error: { kind: string; message: string; raw: string } } {
  if (!cursor) return { ok: true, start: 0 }
  if (!/^\d+$/.test(cursor)) {
    // 原文 = 收到的那段游标本身（本地就能定论：它不是一个下标数字）。
    return { ok: false, reason: 'listPage:cursor', error: failAs(ERROR_KIND.PARSE, '游标已失效，请重新加载（这个后端的游标是排好序的票行列表里的下标，收到的不是数字：' + cursor.slice(0, 32) + '）', cursor.slice(0, 120)).error }
  }
  const start = parseInt(cursor, 10)
  if (start >= total) {
    // 原文给这次的下标与总行数（本地就能定论：游标越过了现有数据）。
    return { ok: false, reason: 'listPage:cursor-stale', error: failAs(ERROR_KIND.NOTFOUND, '游标已失效，请重新加载（下标 ' + start + ' 越过了现在这 ' + total + ' 行）', JSON.stringify({ start: start, total: total })).error }
  }
  return { ok: true, start: start }
}

/**
 * listPage(ctx, repo, filter, opts) → `{ok:true, data:{items, nextCursor, total}}` 或 `{ok:false, error:{kind,message}}`。
 * filter 只认 state 与 labels（契约同 counts）；effortId 走 repo（作用域与 list / counts 同口径）。
 */
export async function listIssuesPage(ctx: OpContext, repo: RepoWithPath, filter: ListFilter | undefined = {}, opts: PageOpts | undefined = {}) {
  const t0 = Date.now()
  try {
    // effortId 不在契约 ListFilter 里（本房的寻址扩展，见 issues-read.js 的 RowFilter）：经视图读，不拓签名。
    const scopeFilter = { effortId: filter && (filter as { effortId?: string | null }).effortId }
    const { rows, errors } = await enumerateIssueRows(ctx, repo, scopeFilter, { collectErrors: true, op: 'listPage' })
    if (errors.length) {
      const kind = errors[0].kind || ERROR_KIND.ENV
      // 整条失败之前记一行（#1058）：翻页失败在界面上只是「这一页加载不出来」，日志这边留一句
      // 「走到枚举这一步、有票文件读不动」；是哪个文件、哪一档错，失败结果的原文里已经列全。
      emitReadDegraded(ctx, 'listPage', 'listPage:read-fail', Date.now() - t0)
      // 原文与 counts 同一口径：每张读不动的票「编号 + 文件 + 档位 + 那句错误」，一行一张。
      return failAs(kind, readFailureMessage(errors), errors.map(function (e) {
        return String(e.key) + ' ' + String(e.path) + ' [' + String(e.kind || '') + '] ' + String(e.message || '')
      }).join('\n'))
    }
    const wanted = labelsOf(filter)
    const narrow = narrowStateOf(filter)
    let tickets = rows.filter(function (r) { return r && r.type !== ISSUE_TYPE.MAP })
    if (wanted.length) tickets = tickets.filter(function (r) { return hasAllLabels(r, wanted) })
    if (narrow) tickets = tickets.filter(function (r) { return narrow === STATE.CLOSED ? r.state === STATE.CLOSED : r.state !== STATE.CLOSED })
    const sorted = tickets.slice().sort(byCreatedAtDesc)
    const total = sorted.length
    const startRes = startIndexOf((opts && typeof opts.cursor === 'string') ? opts.cursor.trim() : '', total)
    if (!startRes.ok) {
      // 游标不成立的两档在这里分开记（#1058）：界面上都是「请重新加载」，日志里要分得出是哪一档。
      emitReadDegraded(ctx, 'listPage', startRes.reason, Date.now() - t0)
      return { ok: false, error: startRes.error }
    }
    const start = startRes.start
    const lim = limitOf(opts)
    const items = sorted.slice(start, start + lim).map(thinRow)
    const nextCursor = (start + items.length) < total ? String(start + items.length) : null
    return { ok: true, data: { items: items, nextCursor: nextCursor, total: total } }
  } catch (e) {
    // 枚举这一层之外冒上来的故障：整条失败，日志留一行「停在哪条操作」。
    emitReadDegraded(ctx, 'listPage', 'listPage:fs-fail', Date.now() - t0)
    return failFromError(e, ctx, '给这个工作区的票分页时出错')
  }
}

export default { listIssuesPage }
