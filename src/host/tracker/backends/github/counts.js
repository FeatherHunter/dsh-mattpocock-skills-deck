/**
 * backends/github/counts.js — 后端计数（counts op；契约见 tracker/contract.js 的「计数契约」，#689 新加）。
 *
 * 这一条只回答「库里符合条件的工单有多少张」，一个行都不返回。面板顶部那几个数字原先由客户端数手上
 * 那份票池得到，而票池被本后端的 500 条安全上限截断过，于是数字跟着偏（缺陷票 #677）；数字改问后端要，
 * 截断就与数字无关了。
 *
 * 实现就是一次 GraphQL 往返：issues 连接的 totalCount（见 queries.js 的 COUNTS_QUERY）。为什么是它：
 *  - 不翻页、不带行，2026-09-22 实测一次 1 点额度；
 *  - issues 连接天然不含拉取请求，正合契约的「只数工单」（REST 的 open_issues_count 把拉取请求也算在内）；
 *  - 两个数在同一份查询里取，天然同时刻，相加出来的 total 不会是两个时刻拼的。
 *
 * 不做的两件（都是故意的）：
 *  - **不做 REST 兜底**。GraphQL 不可用时如实报失败，由编排层退回按池子派生并把「数字可能不全」说出来
 *    （规格第 6.5 节）；REST 没有一条同样准的计数口（search 有 1000 条上限、open_issues_count 混算了
 *    拉取请求），兜过去只会拿一个看着像数、其实不对的数字骗人。
 *  - **不缓存判定**（G5 红线）：失败（含 unsupported 桩）不进任何缓存，缓存层在编排层，这里只如实返回。
 *
 * 错误分类复用本房间既有的 classifyGhError（与 list / get 同一套档位），不另造词。
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { fail } from '../../preflight.js'
import { ghClient } from './client.js'
import { classifyGhError } from './errors.js'
import { parseRepo, repoId } from './issues.js'
import { COUNTS_QUERY, COUNTS_QUERY_WITH_LABELS } from './queries.js'

/** filter.state 归一：只有 'open' / 'closed' 两种收窄，其余（含缺失）都是「两种都要」。 */
function narrowStateOf(filter) {
  const s = filter && typeof filter === 'object' ? String(filter.state || '').toLowerCase() : ''
  return (s === 'open' || s === 'closed') ? s : ''
}

/** filter.labels 归一：去掉空白项与重复项，保持原顺序（原样交给后端筛，名字大小写不动）。 */
function labelsOf(filter) {
  const raw = filter && typeof filter === 'object' ? filter.labels : null
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = {}
  for (const v of raw) {
    const name = typeof v === 'string' ? v.trim() : ''
    if (!name || seen[name]) continue
    seen[name] = true
    out.push(name)
  }
  return out
}

/** totalCount 只接受非负整数：形状不对就等于没拿到，绝不用别的数凑一个出来。 */
function countOf(node) {
  const n = node && node.totalCount
  return (typeof n === 'number' && Number.isFinite(n) && n >= 0 && Math.floor(n) === n) ? n : null
}

/**
 * counts(repo, filter, ctx) -> OpResult<{open, closed, total}>
 * 只数工单；filter 只认 state（收窄）与 labels（必须同时带上）；其余字段忽略（契约「计数契约」一节）。
 * @param {import('../../contract.js').RepositoryRef} repo
 * @param {import('../../contract.js').ListFilter} [filter]
 * @param {import('../../contract.js').OpContext} ctx
 */
export async function countIssues(repo, filter, ctx) {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `counts: repo.refId missing or malformed: ${repoId(repo)}`)
    const narrow = narrowStateOf(filter)
    const labels = labelsOf(filter)
    const c = ghClient(ctx)
    const args = [
      'api', 'graphql',
      '-f', `query=${labels.length ? COUNTS_QUERY_WITH_LABELS : COUNTS_QUERY}`,
      '-F', `owner=${parsed.owner}`,
      '-F', `name=${parsed.name}`,
    ]
    for (const name of labels) args.push('-F', `labels[]=${name}`)
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
    if (!r.ok) return { ok: false, error: r.error }
    let j
    try { j = JSON.parse(r.data.stdout || '') } catch (e) {
      return fail(ERROR_KIND.PARSE, `counts: invalid json ${String(e.message).slice(0, 200)}`)
    }
    if (j.errors) {
      const msg = `counts: ${JSON.stringify(j.errors).slice(0, 800)}`
      return { ok: false, error: { kind: classifyGhError({ message: msg, stderr: msg }, ctx), message: msg } }
    }
    const repoData = j.data && j.data.repository
    if (!repoData) return fail(ERROR_KIND.PARSE, 'counts: graphql: missing repository')
    const openAll = countOf(repoData.openIssues)
    const closedAll = countOf(repoData.closedIssues)
    if (openAll === null || closedAll === null) {
      return fail(ERROR_KIND.PARSE, 'counts: totalCount missing or not a non-negative integer (refusing to guess a number)')
    }
    const open = narrow === 'closed' ? 0 : openAll
    const closed = narrow === 'open' ? 0 : closedAll
    return { ok: true, data: { open, closed, total: open + closed } }
  } catch (e) {
    return fail(classifyGhError(e, ctx), String((e && e.message) || e).slice(0, 800))
  }
}

export default { countIssues }
