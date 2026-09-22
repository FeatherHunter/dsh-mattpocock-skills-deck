/**
 * backends/github/page.js — 按页取票（listPage 那条操作；契约见 tracker/contract-page.js 的「分页契约」，#690 新加）。
 *
 * 这一条只干一件事：按「创建时间倒序」取一页票的行数据，外加「同一口径下一共多少张」。谁要它 ——
 * 界面上的三个触发点（展开「已关闭 N」那条折叠行、状态筛选切到「已关闭」、已加载区滚到底）都要翻历史；
 * 在那之前，历史是把整个池子一次拉全拿到的，本仓的池子被 500 条上限截断过（缺陷票 #677）。
 *
 * 为什么排序键写死创建时间：翻页是按游标一页页往后走的，中途若有别的票被更新，按更新时间排序会让
 *   它挪到后面去、早先看过的那页与下一页之间就漏掉一张；创建时间是写下来就不动的（契约同一条）。
 * 为什么行数据用薄片段（PAGE_ISSUE_FRAGMENT）：画一行只需要编号、标题、状态、时间、标签、指派人、
 *   作者、链接这几样；正文与评论占真机快照 11.8 MB 里的 4.7 MB，画一行一个字都用不到（规格第 14 节）。
 *
 * 不做的三件（都是故意的）：
 *  - **不做 REST 兜底**。分页要靠后端自己的游标才有意义（按创建时间倒序、页与页之间不重不漏），
 *    REST 那条路今天按更新时间翻页、且没有同样的总数口径；兜过去只会给出一份看着像历史、其实会漏票的
 *    清单。GraphQL 不可用时如实报失败，界面按「拿不到」退化（提示稍后再试，已加载的页不受影响）。
 *  - **不在这一层补 number 与大写 state**。契约的行数据是小写两态、以 key 为身份（各后端一致）；
 *    界面那一份要的 number / 大写 state 由宿主电话层补（见 src/host/issuePage.js），与快照那条链同一处口径。
 *  - **不缓存判定**（G5 红线）：失败（含「做不到」的桩）不进任何缓存，缓存层在编排层。
 *
 * 错误分类复用本房间既有的 classifyGhError（与 list / get / counts 同一套档位），不另造词。
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { fail } from '../../preflight.js'
import { ghClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { classifyGhError } from './errors.js'
import { parseRepo, repoId } from './issues.js'
import { LIST_PAGE_QUERY, LIST_PAGE_QUERY_WITH_LABELS } from './queries.js'

// 一页的默认张数与上限（契约「分页契约」定的：缺省 50、上限 200，要多了按上限给，不是报错）。
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** limit 归一：不合法（缺、非整数、非正、无穷大）按缺省 50；超过上限按上限 200。 */
function limitOf(opts) {
  const v = opts && typeof opts === 'object' ? opts.limit : undefined
  if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v <= 0) return DEFAULT_LIMIT
  return v > MAX_LIMIT ? MAX_LIMIT : v
}

/** cursor 归一：省略、空串、纯空白都算「第一页」；其余原样回传（它是不透明字符串，调用方与后端都不解析它）。 */
function cursorOf(opts) {
  const v = opts && typeof opts === 'object' ? opts.cursor : undefined
  if (typeof v !== 'string') return ''
  return v.trim()
}

/** filter.state 归一：'open' / 'closed' 两种收窄；其余（含缺失）= 两种都要。 */
function statesOf(filter) {
  const s = filter && typeof filter === 'object' ? String(filter.state || '').toLowerCase() : ''
  if (s === 'open') return ['OPEN']
  if (s === 'closed') return ['CLOSED']
  return ['OPEN', 'CLOSED']
}

/** filter.labels 归一：去掉空白项与重复项，保持原顺序（名字大小写不动，交给后端筛）。 */
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

/** totalCount 只接受非负整数：形状不对就等于没拿到，绝不用别的数凑一个出来（与 counts 同一条）。 */
function countOf(v) {
  return (typeof v === 'number' && isFinite(v) && v >= 0 && Math.floor(v) === v) ? v : null
}

/** 逐票归一失败会丢票，聚合后复用 error.normalize 调试事件记一行（与 issues.js 的 emitBadNodes 同一处置）。 */
function emitBadNodes(ctx, dropped, total) {
  try {
    if (!dropped) return
    if (ctx && typeof ctx.isEnabled === 'function' && ctx.isEnabled('debug') && typeof ctx.logEvent === 'function') ctx.logEvent('debug', 'error.normalize', { rawKind: 'bad-node:page:' + dropped + '/' + total, mappedKind: 'parse' })
  } catch {}
}

/**
 * listPage(repo, filter, opts, ctx) -> OpResult<{items, nextCursor, total}>
 *
 * filter 只认 state（收窄到「未关闭」「已关闭」之一）与 labels（必须同时带上这些标签），其余字段忽略 ——
 * 与 counts 那条同一口径。requested 之外的多余字段不许影响结果：分页与计数说的必须是同一批票。
 * 失败语义与 counts 一致；游标失效单独认得出（回 not-found，消息里明说「游标已失效，请重新加载」），
 * 界面据此丢掉游标、重取第一页。
 *
 * @param {import('../../contract.js').RepositoryRef} repo
 * @param {import('../../contract.js').ListFilter} [filter]
 * @param {import('../../contract-page.js').PageOpts} [opts]
 * @param {import('../../contract.js').OpContext} ctx
 */
export async function listIssuesPage(repo, filter, opts, ctx) {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `listPage: repo.refId missing or malformed: ${repoId(repo)}`)
    const lim = limitOf(opts)
    const cursor = cursorOf(opts)
    const states = statesOf(filter)
    const labels = labelsOf(filter)
    const c = ghClient(ctx)
    const args = [
      'api', 'graphql',
      '-f', `query=${labels.length ? LIST_PAGE_QUERY_WITH_LABELS : LIST_PAGE_QUERY}`,
      '-F', `owner=${parsed.owner}`,
      '-F', `name=${parsed.name}`,
      '-F', `first=${lim}`,
      '-F', `after=${cursor}`,
    ]
    for (const s of states) args.push('-F', `states[]=${s}`)
    for (const name of labels) args.push('-F', `labels[]=${name}`)
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
    if (!r.ok) return { ok: false, error: r.error }
    let j
    try { j = JSON.parse(r.data.stdout || '') } catch (e) {
      return fail(ERROR_KIND.PARSE, `listPage: invalid json ${String(e.message).slice(0, 200)}`)
    }
    if (j.errors) {
      const msg = `listPage: ${JSON.stringify(j.errors).slice(0, 800)}`
      // 游标失效是单独一类，要认得出：界面据此丢游标重取第一页，而不是把这一页当成历史翻到了头。
      if (cursor && /cursor/i.test(msg)) {
        return fail(ERROR_KIND.NOTFOUND, `listPage: 游标已失效，请重新加载（${msg.slice(0, 400)}）`)
      }
      return { ok: false, error: { kind: classifyGhError({ message: msg, stderr: msg }, ctx), message: msg } }
    }
    const repoData = j.data && j.data.repository
    if (!repoData) return fail(ERROR_KIND.PARSE, 'listPage: graphql: missing repository')
    const conn = repoData.issues
    if (!conn || !Array.isArray(conn.nodes)) return fail(ERROR_KIND.PARSE, 'listPage: graphql: missing issues.nodes')
    const total = countOf(conn.totalCount)
    if (total === null) return fail(ERROR_KIND.PARSE, 'listPage: totalCount missing or not a non-negative integer (refusing to guess a number)')
    const items = []
    let dropped = 0
    for (const n of conn.nodes) {
      try { items.push(normalizeIssue(n)) } catch { dropped += 1 }
    }
    if (dropped) emitBadNodes(ctx, dropped, conn.nodes.length)
    const pageInfo = conn.pageInfo || {}
    let nextCursor = null
    if (pageInfo.hasNextPage === true) {
      // 说「还有下一页」却给不出游标 = 拿不全。宁可如实失败，也不假装历史就到这里了。
      if (typeof pageInfo.endCursor !== 'string' || !pageInfo.endCursor) {
        return fail(ERROR_KIND.PARSE, 'listPage: hasNextPage 为真但 endCursor 缺失（拒绝假装已经翻到底）')
      }
      nextCursor = pageInfo.endCursor
    }
    return { ok: true, data: { items, nextCursor, total } }
  } catch (e) {
    return fail(classifyGhError(e, ctx), String((e && e.message) || e).slice(0, 800))
  }
}

export default { listIssuesPage }
