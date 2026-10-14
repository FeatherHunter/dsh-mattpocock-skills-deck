/**
 * src/tracker/rooms/github/page.ts — 按页取票（listPage 那条操作；契约见 `src/tracker/contract/contract-page.ts` 的「分页契约」，#690 新加）。
 *
 * 文件头原写 `backends/github/page.js`、契约也写作 `tracker/contract-page.js`——两份都是 #1019 目录归位前的旧路径；
 * #1052 按读路径这一片改成今天的真名。文件内另有几处旧路径注释，随本票一并改到真名。
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
 * 错误分类走本房间唯一的出口 ghVerdictOf（判档表在 src/tracker/kernel/error-rules.ts），不另造词。
 *
 * 日志（#1052）：命令本身成没成由房内常驻的 `gh.exec` 落盘（`via` 写 `listPage.gql`）；而「命令成功了、
 * 这一页仍然拿不回来」的几条路（回包不是合法 JSON、游标已失效、远端回 errors、回包里缺 repository/issues.nodes、
 * totalCount 形状不对、后端说有下一页却不给游标）各自在返回前落一行 `read.degraded`，`reason` 依次写
 * `listPage:json` / `listPage:cursor` / `listPage:gql-err` / `listPage:shape` / `listPage:total` / `listPage:no-cursor`。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { OpContext } from '../../contract/contexts.js';
import type { Issue, RepositoryRef } from '../../contract/entities.js';
import type { ListFilter, PageOpts } from '../../contract/inputs.js';
import type { OpResult, PageResult } from '../../contract/results.js';
import { fail } from '../../kernel/preflight.js'
import { ghClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { ghFailureMessage, ghVerdictOf } from './errors.js'
import { parseRepo, repoId } from './issues.js'
import { LIST_PAGE_QUERY, LIST_PAGE_QUERY_WITH_LABELS } from './queries.js'
import { emitReadDegraded } from './read-log.js'
// 记日志那层壳与「调试开关开着吗」那一问都在内核一份（#1182 第 3 件）。
import { debugOn, guardEmit } from '../../kernel/log-emit.js'

// 一页的默认张数与上限（契约「分页契约」定的：缺省 50、上限 200，要多了按上限给，不是报错）。
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** limit 归一：不合法（缺、非整数、非正、无穷大）按缺省 50；超过上限按上限 200。 */
function limitOf(opts: PageOpts | null | undefined): number {
  const bag = (opts && typeof opts === 'object' ? (opts as Record<string, unknown>) : null) as Record<string, unknown> | null;
  const v = bag ? bag.limit : undefined
  if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v <= 0) return DEFAULT_LIMIT
  return v > MAX_LIMIT ? MAX_LIMIT : v
}

/** cursor 归一：省略、空串、纯空白都算「第一页」；其余原样回传（它是不透明字符串，调用方与后端都不解析它）。 */
function cursorOf(opts: PageOpts | null | undefined): string {
  const bag = (opts && typeof opts === 'object' ? (opts as Record<string, unknown>) : null) as Record<string, unknown> | null;
  const v = bag ? bag.cursor : undefined
  if (typeof v !== 'string') return ''
  return v.trim()
}

/** filter.state 归一：'open' / 'closed' 两种收窄；其余（含缺失）= 两种都要。 */
function statesOf(filter: ListFilter | null | undefined): string[] {
  const bag = (filter && typeof filter === 'object' ? (filter as Record<string, unknown>) : null) as Record<string, unknown> | null;
  const s = bag ? String(bag.state || '').toLowerCase() : ''
  if (s === 'open') return ['OPEN']
  if (s === 'closed') return ['CLOSED']
  return ['OPEN', 'CLOSED']
}

/** filter.labels 归一：去掉空白项与重复项，保持原顺序（名字大小写不动，交给后端筛）。 */
function labelsOf(filter: ListFilter | null | undefined): string[] {
  const bag = (filter && typeof filter === 'object' ? (filter as Record<string, unknown>) : null) as Record<string, unknown> | null;
  const raw = bag ? bag.labels : null
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  // 为什么显式标成记录：空对象起手再按名索引，编译器会判成隐式索引，标成字符串记录才过得了严格模式。
  const seen: Record<string, boolean> = {}
  for (const v of raw) {
    const name = typeof v === 'string' ? v.trim() : ''
    if (!name || seen[name]) continue
    seen[name] = true
    out.push(name)
  }
  return out
}

/** totalCount 只接受非负整数：形状不对就等于没拿到，绝不用别的数凑一个出来（与 counts 同一条）。 */
function countOf(v: unknown): number | null {
  return (typeof v === 'number' && isFinite(v) && v >= 0 && Math.floor(v) === v) ? v : null
}

/** 逐票归一失败会丢票，聚合后复用 error.normalize 调试事件记一行（与 issues.js 的 emitBadNodes 同一处置）。 */
function emitBadNodes(ctx: OpContext, dropped: number, total: number): void {
  if (!dropped) return
  guardEmit(ctx, (c) => {
    c.logEvent('debug', 'error.normalize', { rawKind: 'bad-node:page:' + dropped + '/' + total, mappedKind: ERROR_KIND.PARSE })
  }, () => debugOn(ctx))
}

/**
 * listPage(repo, filter, opts, ctx) -> OpResult<{items, nextCursor, total}>
 *
 * filter 只认 state（收窄到「未关闭」「已关闭」之一）与 labels（必须同时带上这些标签），其余字段忽略 ——
 * 与 counts 那条同一口径。requested 之外的多余字段不许影响结果：分页与计数说的必须是同一批票。
 * 失败语义与 counts 一致；游标失效单独认得出（回 not-found，消息里明说「游标已失效，请重新加载」），
 * 界面据此丢掉游标、重取第一页。
 *
 * @param {import('../../contract/index.js').RepositoryRef} repo
 * @param {import('../../contract/index.js').ListFilter} [filter]
 * @param {import('../../contract/contract-page.js').PageOpts} [opts]
 * @param {import('../../contract/index.js').OpContext} ctx
 */
export async function listIssuesPage(repo: RepositoryRef, filter: ListFilter | undefined, opts: PageOpts | undefined, ctx: OpContext): Promise<OpResult<PageResult>> {
  // 这一笔的起点：本函数每一行降级日志都带「从入口到这里花了多久」。
  const t0 = Date.now()
  try {
    const parsed = parseRepo(repo)
    // 形状不对的入参本身就是这一处的原文（这之前还没跑过任何外部命令）；它取出来可能是空串，那是如实交代。
    if (!parsed) {
      emitReadDegraded(ctx, 'listPage', 'listPage:repo-ref', Date.now() - t0)
      return fail(ERROR_KIND.NOTFOUND, `listPage: repo.refId missing or malformed: ${repoId(repo)}`, repo)
    }
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
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd, via: 'listPage.gql' })
    if (!r.ok) {
      emitReadDegraded(ctx, 'listPage', 'listPage:transport', Date.now() - t0)
      return { ok: false, error: r.error }
    }
    // 为什么把回包定成这个形状：只读到本函数实际用的三层（errors/data.repository.issues），更深的节点按 unknown 读；
    // 定宽了以后加字段要改两处，定窄了读不到，当前三层正好够用。
    let j: { errors?: unknown; data?: { repository?: { issues?: { nodes?: unknown[]; totalCount?: unknown; pageInfo?: unknown } | null } | null } | null }
    try { j = JSON.parse(r.data.stdout || '') } catch (e) {
      // 为什么转一下再读：catch 出来是 unknown，直接读 message 会报缺成员；转成最小形状后读法与原来一致，运行时不变。
      const eb = e as { message?: unknown } | null;
      // 没能解析成 JSON 的那份回包就是这里的原文（交的是这次 gh 的完整产出，不只 stdout 一截）。
      emitReadDegraded(ctx, 'listPage', 'listPage:json', Date.now() - t0)
      return fail(ERROR_KIND.PARSE, `listPage: invalid json ${String((eb && eb.message) || e).slice(0, 200)}`, r.data)
    }
    if (j.errors) {
      const msg = `listPage: ${JSON.stringify(j.errors).slice(0, 800)}`
      // 游标失效是单独一类，要认得出：界面据此丢游标重取第一页，而不是把这一页当成历史翻到了头。
      if (cursor && /cursor/i.test(msg)) {
        // raw 交的是 GitHub 回的那份 errors 负载本身（上面那句提示只是给它加了前缀）。
        emitReadDegraded(ctx, 'listPage', 'listPage:cursor', Date.now() - t0)
        return fail(ERROR_KIND.NOTFOUND, `listPage: 游标已失效，请重新加载（${msg.slice(0, 400)}）`, JSON.stringify(j.errors))
      }
      // 原文交的是 GitHub 回的那份 errors 负载本身（msg 只是给它加了个操作名前缀，不算原文）。
      // 判档与话术都走本房唯一的出口：档位由规则表判、message 按票面实现决定第 11 条挑。
      const verdict = ghVerdictOf({ message: msg, stderr: msg }, ctx)
      emitReadDegraded(ctx, 'listPage', 'listPage:gql-err', Date.now() - t0)
      return fail(verdict.kind, ghFailureMessage(verdict, msg), JSON.stringify(j.errors))
    }
    const repoData = j.data && j.data.repository
    // 说「回包里缺东西」时，原文就是这份回包本身 —— 人自己能看出它到底缺了什么。
    if (!repoData) {
      emitReadDegraded(ctx, 'listPage', 'listPage:shape', Date.now() - t0)
      return fail(ERROR_KIND.PARSE, 'listPage: graphql: missing repository', r.data)
    }
    const conn = repoData.issues
    if (!conn || !Array.isArray(conn.nodes)) {
      emitReadDegraded(ctx, 'listPage', 'listPage:shape', Date.now() - t0)
      return fail(ERROR_KIND.PARSE, 'listPage: graphql: missing issues.nodes', r.data)
    }
    const total = countOf(conn.totalCount)
    if (total === null) {
      emitReadDegraded(ctx, 'listPage', 'listPage:total', Date.now() - t0)
      return fail(ERROR_KIND.PARSE, 'listPage: totalCount missing or not a non-negative integer (refusing to guess a number)', r.data)
    }
    const items: Issue[] = []
    let dropped = 0
    for (const n of conn.nodes) {
      try { items.push(normalizeIssue(n)) } catch { dropped += 1 }
    }
    if (dropped) emitBadNodes(ctx, dropped, conn.nodes.length)
    // 为什么断言一下：游标段只读 hasNextPage/endCursor 两格，断言只为过编译，表达式与原来一字不差，运行时不变。
    const pageInfo = (conn.pageInfo || {}) as { hasNextPage?: unknown; endCursor?: unknown }
    // 为什么显式标成可空串：游标缺席是合法态（没有下一页），标成联合才接得住契约的 null，运行时还是原来那个值。
    let nextCursor: string | null = null
    if (pageInfo.hasNextPage === true) {
      // 说「还有下一页」却给不出游标 = 拿不全。宁可如实失败，也不假装历史就到这里了。
      if (typeof pageInfo.endCursor !== 'string' || !pageInfo.endCursor) {
        // 说出「没有 endCursor」这句话的证据就是这段 pageInfo 本身，原文交它（比整份回包短得多、也看得准）。
        emitReadDegraded(ctx, 'listPage', 'listPage:no-cursor', Date.now() - t0)
        return fail(ERROR_KIND.PARSE, 'listPage: hasNextPage 为真但 endCursor 缺失（拒绝假装已经翻到底）', JSON.stringify(pageInfo))
      }
      nextCursor = pageInfo.endCursor
    }
    return { ok: true, data: { items, nextCursor, total } }
  } catch (e) {
    const verdict = ghVerdictOf(e, ctx)
    // 为什么转一下再读：同上，catch 的 unknown 不能直接读 message，转后表达式与原来一致。
    const eb = e as { message?: unknown } | null;
    return fail(verdict.kind, ghFailureMessage(verdict, String((eb && eb.message) || e).slice(0, 800)), e)
  }
}

export default { listIssuesPage }
