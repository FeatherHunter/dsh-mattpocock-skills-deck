/**
 * list-read.ts — 票列表的两条读路（#1772）。
 *
 * 从 issues.ts 拆出来，是因为配上完整的「全量读 / 增量读」说明后，issues.ts 会超过
 * tests/verify-file-granularity.ts 的 350 有效行上限。这里只放「怎么把列表读回来」，
 * 归一、keys 过滤与截断日志仍在 issues.ts 的 listIssues 里。
 *
 * 两条读路的分工（为什么各是各的形状，见 listIssues 的注释）：
 * 一、全量读：没给 since 时按 updated_at 倒序有界翻页，最多 5 页 × 每页 100 = 500 张。
 * 二、增量读：给了合法 since 时只发一个 updated_after 请求，按 updated_at 正序、单页 100 张。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { ErrorKind } from '../../contract/identity.js'
import type { BackendContext, OpContext } from '../../contract/contexts.js'
import type { ListFilter } from '../../contract/inputs.js'
import type { IssueListResult } from '../../contract/results.js'
import { PAGINATION } from '../../contract/pagination.js'
import { fail } from '../../kernel/preflight.js'
import { glabClient } from './client.js'
import { failGlab } from './errors.js'
import { issuesPath } from './queries.js'
import { GITLAB_SLOW_READ_TIMEOUT_MS } from '../../../shared/time-config/src/values.js'

// 上下文两形都收：调用方有时把执行器放在 ctx、有时放在 opCtx，缺了就让 glabClient 按 127 回。
type CtxLike = Partial<OpContext> & Partial<BackendContext>
type RawBag = Record<string, unknown>

/** 两条读路取回来的行，以及「是不是还没读完」这个诚实交代。 */
export interface IssueRowsPage {
  rows: RawBag[]
  truncated: boolean
}

function parseJsonSafe(s: string): unknown {
  try {
    return JSON.parse(s) as unknown
  } catch {
    return null
  }
}

function errMsg(err: unknown): string {
  if (err !== null && typeof err === 'object' && 'message' in (err as Record<string, unknown>)) {
    const m = (err as Record<string, unknown>)['message']
    if (typeof m === 'string' && m) return m
  }
  return String(err)
}

/** 取一页票列表（原生回包行，未归一）；失败直接把 IssueListResult 交给调用方原样返回。 */
async function fetchIssueRows(
  effective: CtxLike | undefined,
  id: string,
  query: string,
): Promise<{ ok: true; rows: RawBag[] } | { ok: false; result: IssueListResult }> {
  try {
    const path = issuesPath(id, query)
    const c = glabClient(effective as Partial<OpContext> & Partial<BackendContext>)
    const res = await c.run(['api', path], { timeout: GITLAB_SLOW_READ_TIMEOUT_MS })
    if (res.code !== 0) {
      // 原文 = 列票那一次 glab 调用的进程结果。
      return { ok: false, result: failGlab(res, res.stderr || res.stdout || 'list failed', res, effective) }
    }
    const arr: unknown = parseJsonSafe(res.stdout)
    // 原文 = 远端回的那一段（人据此看出返回的到底是什么形状，而不是只被告知「不是数组」）。
    if (!Array.isArray(arr)) {
      return { ok: false, result: fail(ERROR_KIND.PARSE as ErrorKind, 'list returned non-array', res.stdout) }
    }
    return { ok: true, rows: arr as RawBag[] }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象（apiGet/apiPut 已经把 stderr/stdout/退出码挂在它身上）。
    return { ok: false, result: failGlab(err, errMsg(err), err, effective) }
  }
}

/** 把 ListFilter.since 翻成 GitLab 的 updated_after 值；非法或缺失回空串（按不设窗口处理，不报错）。 */
export function sinceParamOf(filter: ListFilter | null | undefined): string {
  if (!filter || typeof filter.since !== 'string') return ''
  const raw = filter.since.trim()
  if (!raw) return ''
  return Number.isNaN(Date.parse(raw)) ? '' : raw
}

/** 把 ListFilter.state 翻成 GitLab 的 state 参数；省略（而不是传 all）才是「全状态」。 */
export function stateParamOf(filter: ListFilter | null | undefined): string {
  if (!filter || !filter.state) return ''
  // GitLab 的 state 只有 opened/closed 两值；'all' 不要拿来表达「全部」。
  return filter.state === 'closed' ? 'closed' : 'opened'
}

/**
 * 按过滤器的形状选一条读路，把行读回来。
 *
 * 全量读（没给合法 since）：page=1,2,… 每页 per_page=100、按 updated_at 倒序；某一页不满就
 * 说明到底了立即停。最多翻 PAGINATION.gitlab.issueListMaxPages 页；只有「撞满页数上限且最后
 * 一页仍然是满的」才置 truncated —— 恰好 100 张、499 张或下一页为空都按读完处理。
 *
 * 增量读（给了合法 since）：只发一个请求（updated_after=<since>、按 updated_at 正序、单页
 * 100 张）。取满一页说明窗口里还有积压，置 truncated，下一拍从新游标继续；不在一拍里翻多页。
 *
 * 两条路都按 filter.state 每页带同一个 state（open→opened、closed→closed；省略就不带，即全状态）。
 * since 非法或缺失时按不设窗口处理，不报错。
 */
export async function readIssueRows(
  effective: CtxLike | undefined,
  id: string,
  filter: ListFilter | null | undefined,
): Promise<{ ok: true; data: IssueRowsPage } | { ok: false; result: IssueListResult }> {
  const perPage = PAGINATION.gitlab.maxPerPage
  const state = stateParamOf(filter)
  const since = sinceParamOf(filter)
  const rows: RawBag[] = []
  let truncated = false
  if (since) {
    const params = new URLSearchParams()
    params.set('per_page', String(perPage))
    params.set('with_labels_details', 'true')
    params.set('order_by', 'updated_at')
    params.set('sort', 'asc')
    params.set('updated_after', since)
    if (state) params.set('state', state)
    const got = await fetchIssueRows(effective, id, params.toString())
    if (!got.ok) return got
    rows.push(...got.rows)
    // 取满一页 = 窗口里还有积压，下一拍从新游标接着读。
    if (got.rows.length >= perPage) truncated = true
  } else {
    const maxPages = PAGINATION.gitlab.issueListMaxPages
    for (let page = 1; page <= maxPages; page += 1) {
      const params = new URLSearchParams()
      params.set('per_page', String(perPage))
      params.set('page', String(page))
      params.set('with_labels_details', 'true')
      params.set('order_by', 'updated_at')
      params.set('sort', 'desc')
      if (state) params.set('state', state)
      const got = await fetchIssueRows(effective, id, params.toString())
      if (!got.ok) return got
      rows.push(...got.rows)
      // 这一页没满：后面不会再有票了（远端按连续切片给页），按读完处理。
      if (got.rows.length < perPage) break
      // 最后一页仍然是满的：可能还有第 6 页，如实说没读完。
      if (page === maxPages) truncated = true
    }
  }
  return { ok: true, data: { rows, truncated } }
}
