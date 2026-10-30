/**
 * src/tracker/rooms/github/read/issues-rest-list.ts —— list 的 REST 降级翻页（#1685 从 issues.ts 分出）。
 * #1686 阶段 1：从房间根迁入 read/，旧路径 src/tracker/rooms/github/issues-rest-list.ts 保留纯转发，行为零变化。
 *
 * 为什么单列一份：一是文件粒度纪律（issues.ts 加上读结果来源后过不了每文件 350 有效行的上限），
 * 二是这一段本来就只有一件事——把 REST 分页翻完、把「翻到哪停、有没有翻到空页、触没触上限」记下来。
 * 它不解读形状（行交给 normalizeIssue），也不组装来源与完整度（那些住在 routing/read-assembly.ts）；
 * 房内唯一的 gh 出口仍是 client.ts，这里只是它的一个使用者。
 *
 * 失败语义沿用 #415：首页失败 = 双路皆挂，诚实返回错误；尾页失败 = 按已得数据截断上报。
 * 完整度（#1685）：翻到空页、或尾页不满一页才算到底；触 10 页上限、尾页失败、恰好每页都满却没空页探测，都算截断。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { OpContext } from '../../../contract/contexts.js'
import type { OpResult } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import { ghClient } from '../transport/client.js'
import { emitReadDegraded } from '../support/read-log.js'
import { PAGINATION } from '../../../contract/pagination.js'
import { GITHUB_REST_READ_TIMEOUT_MS } from '../../../../shared/time-config/src/values.js'
import type { RestListPagingFacts } from '../channels/rest/read-shapes.js'

/** 仓库坐标：拥有者与仓库名。本文件只读这两格，形状与 issues.ts 的解析结果一致即可。 */
interface ParsedRepo {
  owner: string;
  name: string;
}

/** 为什么 catch 里的错误要先转这层再读：catch 出来是 unknown，直接读 message 编译不过，转后读法与别处一致。 */
function caughtMessage(e: unknown, len: number): string {
  const eb = e as { message?: unknown } | null;
  return String((eb && eb.message) || e).slice(0, len)
}

/**
 * REST 降级通道（2026-09-02：#415 承接 #414 刷新现场修复）。
 * 背景：api.github.com/graphql 的 POST 在本机偶发 `unexpected EOF`（网络层），
 *   而 REST 单页（gh api repos/{o}/{n}/issues?page=k）稳定可用。
 * 方案与 GraphQL 同构：逐页 REST → normalizeIssue（normalize 兼容 REST 形状）→
 *   用 `/issues/{map}/sub_issues` 端点修复树边（parentKey），保证 compose 的 maps/tickets 不受损。
 * 失败语义：首页失败 = 双路皆挂，诚实返回错误；尾页失败 = 按已得数据截断上报。
 */
interface RestListFetch {
  /** 翻回来的原始行（读路径自己归一化）。 */
  rows: unknown[]
  /** 翻页停下时的事实（完整度判定要用）。 */
  paging: RestListPagingFacts
}

export async function fetchAllIssuesREST(parsed: ParsedRepo, ctx: OpContext): Promise<OpResult<RestListFetch>> {
  const c = ghClient(ctx)
  // 为什么标成未知数组：回包是 GitHub 的原始行，本函数只负责翻页搬运、不解读形状，解读是调用方的事。
  const out: unknown[] = []
  const MAX_PAGES = PAGINATION.github.restMaxPages
  const PAGE = PAGINATION.github.restPageSize
  // 翻页事实（#1685）：完整度判定要「翻到空页没有、尾页满没满、触没触 10 页上限」，
  // 这些只有发起翻页的这一段知道，随产出一起交给路由层组装来源信息。
  let pagesFetched = 0
  let lastPageRows = 0
  let sawEmptyPage = false
  let pageFailure = false
  // 本函数的起点：下面每一行降级日志带的是「这一笔从本函数入口到这里花掉的毫秒数」。
  const startsAt = Date.now()
  for (let p = 1; p <= MAX_PAGES; p++) {
    // 这是 GraphQL 主路失败之后的 REST 降级翻页：标签与主路分开，事后一眼看出走的是哪条路。
    const r = await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/issues?state=all&per_page=${PAGE}&page=${p}`], { cwd: ctx && ctx.cwd, via: 'list.rest', timeout: GITHUB_REST_READ_TIMEOUT_MS })
    if (!r.ok) {
      pageFailure = true
      if (!out.length) return { ok: false, error: r.error }
      // 尾页失败按已得数据截断上报（本函数一贯的口径）：回的是成功，可翻到第 p 页就断了。
      emitReadDegraded(ctx, 'list', 'list:page-fail', Date.now() - startsAt)
      break
    }
    let j: unknown
    try { j = JSON.parse(r.data.stdout || '') } catch (e) {
      pageFailure = true
      // 原文交这次 gh 的完整产出：人自己就能看出回包里到底是什么。
      if (!out.length) {
        emitReadDegraded(ctx, 'list', 'list:rest-json', Date.now() - startsAt)
        return fail(ERROR_KIND.PARSE, `rest fallback: invalid json ${caughtMessage(e, 200)}`, r.data)
      }
      emitReadDegraded(ctx, 'list', 'list:page-fail', Date.now() - startsAt)
      break
    }
    if (!Array.isArray(j)) {
      pageFailure = true
      if (!out.length) {
        emitReadDegraded(ctx, 'list', 'list:rest-shape', Date.now() - startsAt)
        return fail(ERROR_KIND.PARSE, 'rest fallback: non-array response', r.data)
      }
      emitReadDegraded(ctx, 'list', 'list:page-fail', Date.now() - startsAt)
      break
    }
    pagesFetched += 1
    lastPageRows = j.length
    // 空页是 REST 侧「到底了」的唯一协议证据（#1685）：翻到空页就不再往后翻，完整度按它判。
    if (j.length === 0) { sawEmptyPage = true; break }
    for (const n of j) out.push(n)
    if (j.length < PAGE) break
  }
  // 翻满十页还没到底这一支不记日志：REST 这条接口不报总数，看不出「库里真有这么多」还是「被十页截住了」，
  // 本函数一贯按「翻到十页为止」的上报口径处理（不是故障）；完整度上按截断记（#1685）。
  // 恰好每页都满、又没做空页探测时也不能算完整——只有真翻到空页或尾页不满才算到底。
  const hitPageCap = !sawEmptyPage && !pageFailure && pagesFetched >= MAX_PAGES && lastPageRows >= PAGE
  return {
    ok: true,
    data: {
      rows: out,
      paging: { pagesFetched, pageSize: PAGE, lastPageRows, sawEmptyPage, hitPageCap, pageFailure },
    },
  }
}
