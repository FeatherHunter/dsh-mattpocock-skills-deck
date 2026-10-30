/**
 * src/tracker/rooms/github/read/counts.ts — 后端计数（counts op；契约见 `src/tracker/contract/operations.ts` 的「计数契约」，#689 新加）。
 * #1686 阶段 1：从房间根迁入 read/，旧路径 src/tracker/rooms/github/counts.ts 保留纯转发，行为零变化。
 *
 * 文件头原写 `backends/github/counts.js`，契约也写作 `tracker/contract.js`——两份都是 #1019 目录归位前的旧路径；
 * #1052 按读路径这一片改成今天的真名。
 *
 * 这一条只回答「库里符合条件的工单有多少张」，一个行都不返回。面板顶部那几个数字原先由客户端数手上
 * 那份票池得到，而票池被本后端的 500 条安全上限截断过，于是数字跟着偏（缺陷票 #677）；数字改问后端要，
 * 截断就与数字无关了。
 *
 * 实现就是一次 GraphQL 往返：issues 连接的 totalCount（见 queries.ts 的 COUNTS_QUERY）。为什么是它：
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
 * 错误分类走本房间唯一的出口 ghVerdictOf（判档表在 src/tracker/kernel/error-rules.ts），不另造词。
 *
 * 日志（#1052）：命令本身成没成由房内常驻的 `gh.exec` 落盘（`via` 写 `counts.gql`）；而「命令成功了、
 * 这个数仍然拿不到」的四条路（回包不是合法 JSON、远端回 errors、回包里没有 repository、totalCount 形状不对）
 * 各自在返回前落一行 `read.degraded`，`reason` 写 `counts:json` / `counts:gql-err` / `counts:shape` / `counts:total`。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { OpContext } from '../../../contract/contexts.js';
import type { Counts, OpResult } from '../../../contract/results.js';
import type { ListFilter } from '../../../contract/inputs.js';
import type { RepositoryRef } from '../../../contract/entities.js';
import { fail } from '../../../kernel/preflight.js'
import { ghClient } from '../transport/client.js'
import { ghFailureMessage, ghVerdictOf } from '../support/errors.js'
import { parseRepo, repoId } from '../issues.js'
import { COUNTS_QUERY, COUNTS_QUERY_WITH_LABELS } from '../channels/graphql/queries.js'
import { emitReadDegraded } from '../support/read-log.js'

/** filter.state 归一：只有 'open' / 'closed' 两种收窄，其余（含缺失）都是「两种都要」。 */
function narrowStateOf(filter: ListFilter | null | undefined): string {
  const bag = (filter && typeof filter === 'object' ? (filter as Record<string, unknown>) : null) as Record<string, unknown> | null;
  const s = bag ? String(bag.state || '').toLowerCase() : ''
  return (s === 'open' || s === 'closed') ? s : ''
}

/** filter.labels 归一：去掉空白项与重复项，保持原顺序（原样交给后端筛，名字大小写不动）。 */
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

/** totalCount 只接受非负整数：形状不对就等于没拿到，绝不用别的数凑一个出来。 */
function countOf(node: unknown): number | null {
  const bag = (node && typeof node === 'object' ? (node as Record<string, unknown>) : null) as Record<string, unknown> | null;
  const n = bag ? bag.totalCount : undefined;
  return (typeof n === 'number' && Number.isFinite(n) && n >= 0 && Math.floor(n) === n) ? n : null
}

/**
 * counts(repo, filter, ctx) -> OpResult<{open, closed, total}>
 * 只数工单；filter 只认 state（收窄）与 labels（必须同时带上）；其余字段忽略（契约「计数契约」一节）。
 * @param {import('../../../contract/index.js').RepositoryRef} repo
 * @param {import('../../../contract/index.js').ListFilter} [filter]
 * @param {import('../../../contract/index.js').OpContext} ctx
 */
export async function countIssues(repo: RepositoryRef, filter: ListFilter | undefined, ctx: OpContext): Promise<OpResult<Counts>> {
  // 这一笔的起点：本函数每一行降级日志都带「从入口到这里花了多久」。
  const t0 = Date.now()
  try {
    const parsed = parseRepo(repo)
    // 形状不对的入参本身就是这一处的原文（这之前还没跑过任何外部命令）；它取出来可能是空串，那是如实交代。
    if (!parsed) {
      emitReadDegraded(ctx, 'counts', 'counts:repo-ref', Date.now() - t0)
      return fail(ERROR_KIND.NOTFOUND, `counts: repo.refId missing or malformed: ${repoId(repo)}`, repo)
    }
    const narrow = narrowStateOf(filter)
    const labels = labelsOf(filter)
    const c = ghClient(ctx)
    const args = [
      'api', 'graphql',
      '-f', `query=${labels.length ? COUNTS_QUERY_WITH_LABELS : COUNTS_QUERY}`,
      '-f', `owner=${parsed.owner}`,
      '-f', `name=${parsed.name}`,
    ]
    for (const name of labels) args.push('-F', `labels[]=${name}`)
    // 计数这条路只有这一笔：标签写 counts.gql，跟那一串长得一样的 gh.exec 分得开。
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd, via: 'counts.gql' })
    if (!r.ok) {
      // 命令没跑成也记一行：常驻 gh.exec 只写「退出码几」，这一行才说得清「这次要数的数没拿到」。
      emitReadDegraded(ctx, 'counts', 'counts:transport', Date.now() - t0)
      return { ok: false, error: r.error }
    }
    let j: { errors?: unknown; data?: { repository?: { openIssues?: unknown; closedIssues?: unknown } | null } | null }
    try { j = JSON.parse(r.data.stdout || '') } catch (e) {
      // 为什么转一下再读：catch 出来是 unknown，直接读 message 会报缺成员；转成最小形状后读法与原来一致，运行时不变。
      const eb = e as { message?: unknown } | null;
      // 没能解析成 JSON 的那份回包就是这里的原文（交的是这次 gh 的完整产出，不只 stdout 一截）。
      emitReadDegraded(ctx, 'counts', 'counts:json', Date.now() - t0)
      return fail(ERROR_KIND.PARSE, `counts: invalid json ${String((eb && eb.message) || e).slice(0, 200)}`, r.data)
    }
    if (j.errors) {
      const msg = `counts: ${JSON.stringify(j.errors).slice(0, 800)}`
      // 原文交的是 GitHub 回的那份 errors 负载本身（msg 只是给它加了个操作名前缀，不算原文）。
      // 判档与话术都走本房唯一的出口：档位由规则表判、message 按票面实现决定第 11 条挑。
      const verdict = ghVerdictOf({ message: msg, stderr: msg }, ctx)
      emitReadDegraded(ctx, 'counts', 'counts:gql-err', Date.now() - t0)
      return fail(verdict.kind, ghFailureMessage(verdict, msg), JSON.stringify(j.errors))
    }
    const repoData = j.data && j.data.repository
    // 说「回包里缺东西」时，原文就是这份回包本身 —— 人自己能看出它到底缺了什么。
    if (!repoData) {
      emitReadDegraded(ctx, 'counts', 'counts:shape', Date.now() - t0)
      return fail(ERROR_KIND.PARSE, 'counts: graphql: missing repository', r.data)
    }
    const openAll = countOf(repoData.openIssues)
    const closedAll = countOf(repoData.closedIssues)
    if (openAll === null || closedAll === null) {
      emitReadDegraded(ctx, 'counts', 'counts:total', Date.now() - t0)
      return fail(ERROR_KIND.PARSE, 'counts: totalCount missing or not a non-negative integer (refusing to guess a number)', r.data)
    }
    const open = narrow === 'closed' ? 0 : openAll
    const closed = narrow === 'open' ? 0 : closedAll
    return { ok: true, data: { open, closed, total: open + closed } }
  } catch (e) {
    const verdict = ghVerdictOf(e, ctx)
    // 为什么转一下再读：同上，catch 的 unknown 不能直接读 message，转后表达式与原来一致。
    const eb = e as { message?: unknown } | null;
    return fail(verdict.kind, ghFailureMessage(verdict, String((eb && eb.message) || e).slice(0, 800)), e)
  }
}

export default { countIssues }
