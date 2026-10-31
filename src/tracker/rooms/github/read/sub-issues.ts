/**
 * src/tracker/rooms/github/read/sub-issues.ts —— 取一张地图的**全部**子票（#691 阶段 3：「地图子票拉全」）。
 * #1686 阶段 1：从房间根迁入 read/，房间根的同名转发文件已在 #1687 末批删除，行为零变化。
 *
 * 文件头原写 `backends/github/sub-issues.js`，是 #1019 目录归位前的旧路径；#1052 按读路径这一片改成今天的真名。
 *
 * 为什么要单独一条路，而不是从列表里捞：
 *   列表（`issues.ts` 的 list）取的是整个仓库的票，带 500 条安全上限 —— 一张子票超过 100 张的地图
 *   会被这条上限截断，「打开地图看不到全部子票」就是这么来的。这条查询从「父票 → 子票」的原生关系
 *   往下取，按页翻到底，不受那个上限影响；连接上的 totalCount 用来核对「拉到的张数 == 总数」。
 *
 * 代价与时机：每 100 张一页。只有用户真的打开一张地图时才跑 —— 唯一调用者是宿主电话
 *   wf.mapTickets（`src/host/mapTickets.js`），它不参与快照首屏的组装。
 *
 * 名字为什么进契约的 OPERATIONS（#1052 改：这句原先写的是反话，今天已经不成立）：
 *   它**已经**是契约操作 `Tracker.listSubIssues`（名录第 21 条，见
 *   `src/tracker/contract/operations-catalog.ts`）。收进来的理由是同一条：它的调用者
 *   wf.mapTickets 在房外 —— 房外有读者，它就不是某一家后端的实现细节。
 *   没实现它的后端由注册表按名录自动补一句「不支持」（`src/tracker/registry/shape.ts` 的
 *   unsupportedStub），界面退回快照里那份行数据，不做能力表（G5 红线）。
 *
 * 失败与「不许静默少几条」：
 *  - 任何一页请求失败都回 {ok:false}，绝不返回半份数据装作拉全了；
 *  - 拉到 1000 张硬上限还没到底 → 仍回成功，但 capped=true，让界面把「只加载了前 1000 张」说出来；
 *  - 拉到的张数与 totalCount 对不上（且不是被上限卡住）→ 仍回成功，但 missing 记下差额，
 *    界面必须把差额说出来 —— 这一条是本票验收里「拉到的张数等于 totalCount」的守门人。
 *
 * 日志（#1052）：每一页那一笔由房内常驻的 `gh.exec` 落盘（`via` 写 `subIssues.gql`，第二次试写
 * `subIssues.retry`，于是「重试过」在日志里看得见两行标签不同的记录）；而「拿不全 / 拿不回来」的几条路
 * 各自在返回前落一行 `read.degraded`（`subIssues:page-fail`、`subIssues:notfound`、`subIssues:json`、
 * `subIssues:shape`、`subIssues:gql-err`、`subIssues:truncated`）。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { OpContext } from '../../../contract/contexts.js';
import type { Issue, RepositoryRef } from '../../../contract/entities.js';
import type { SubIssueListResult } from '../../../contract/results.js';
import { fail } from '../../../kernel/preflight.js'
import { ghClient } from '../transport/client.js'
import { normalizeIssue } from '../model/normalize.js'
import { ghFailureMessage, ghVerdictOf } from '../support/errors.js'
import { SUB_ISSUES_QUERY } from '../channels/graphql/queries.js'
import { parseRepo, repoId } from '../model/issue-key.js'
import { emitReadDegraded } from '../support/read-log.js'
import { beginRead } from '../routing/read-result.js'
// #1698：企业版主机上的运行时能力回答（探测服务端版本后回答支持/部分支持/不支持）。
import { attachRuntimeAnswer, runtimeCapabilityFor } from '../routing/runtime-capability.js'
import { subIssuesProvenanceFromGraphql } from '../routing/read-assembly.js'
import { PAGINATION } from '../../../contract/pagination.js'

// 每页 100 张（GraphQL 连接的单页上限），硬上限 1000 张（规格第 6.4 节：超过就明说只加载了前 1000 张）。
const PAGE_SIZE = PAGINATION.github.subIssuesPageSize
const MAX_SUB_ISSUES = PAGINATION.github.subIssuesMax

/**
 * listSubIssues(repo, mapKey, opts, ctx) -> OpResult<{items, total, fetched, capped, missing, dropped}>
 *  - items：归一后的子票行（含 key/state/labels/blockedBy 等契约字段），顺序按 GitHub 给的默认顺序；
 *  - total：后端说的总数（连接上的 totalCount）；拿不到时退化成拉到的张数（不假装知道）；
 *  - fetched：这一次真的拉回来并归一成功的张数；
 *  - capped：是否被 1000 张硬上限截断；
 *  - missing：没被上限卡住、却与 totalCount 对不上的差额（0 = 对上了）；
 *  - dropped：归一失败的条数（归一失败会丢行，丢了几条如实记下来，不混进 fetched）。
 */
async function listSubIssuesInner(repo: RepositoryRef, mapKey: unknown, opts: unknown, ctx: OpContext): Promise<SubIssueListResult> {
  // 这一笔的起点：本函数每一行降级日志都带「从入口到这里花了多久」。
  const t0 = Date.now()
  // 读来源记录也从这里起算（#1686）：成功时挂来源与「子票」「行」两个字段组的完整度。
  const clock = beginRead()
  try {
    const parsed = parseRepo(repo)
    // 形状不对的入参本身就是这一处的原文（这之前还没跑过任何外部命令）；它取出来可能是空串，那是如实交代。
    if (!parsed) {
      emitReadDegraded(ctx, 'subIssues', 'subIssues:repo-ref', Date.now() - t0)
      return fail(ERROR_KIND.NOTFOUND, `子票取数：repo.refId 缺失或形状不对：${repoId(repo)}`, repo)
    }
    const num = Number(String(mapKey == null ? '' : mapKey).trim())
    if (!Number.isFinite(num)) return fail(ERROR_KIND.PARSE, `子票取数：GitHub 的地图编号必须是数字：${mapKey}`, mapKey)
    const c = ghClient(ctx)
    const items: Issue[] = []
    // 为什么显式标：空值起手再在分支里赋值，编译器会判成隐式 any；标成契约的形状才过得了严格模式，运行时还是原来那几个值。
    let total: number | null = null
    let dropped = 0
    let after: unknown = null
    let capped = false
    // 最后一页读到的 pageInfo.hasNextPage（#1686）：翻页事实要交回组装函数，交上去才知道是「拉到底」还是「到上限停下」。
    let hasNextPage = false
    // 逐页取到底：每页都问一次 hasNextPage，不用「上一页满不满」去猜（满页也可能是最后一页）。
    for (;;) {
      const args = ['api', 'graphql', '-f', `query=${SUB_ISSUES_QUERY}`, '-f', `owner=${parsed.owner}`, '-f', `name=${parsed.name}`, '-F', `number=${num}`, '-F', `first=${PAGE_SIZE}`]
      if (after) args.push('-F', `after=${after}`)
      else args.push('-F', 'after=')
      // 这一台机器上 api.github.com/graphql 的 POST 偶发 `unexpected EOF`（仓库里早有记载，见 issues.js 的 REST 降级注释）。
      // 列表那条路为它准备了一整套 REST 降级；这条路只在用户点开一张地图时跑、最多十页，抖一下就整张地图空白不值得，
      // 所以对**同一页**多试一次：第一次失败先按原样重试，第二次还失败才如实报错（界面那里有「重试」）。
      let r = await c.execGh(args, { cwd: ctx && ctx.cwd, via: 'subIssues.gql' })
      if (!r.ok) r = await c.execGh(args, { cwd: ctx && ctx.cwd, via: 'subIssues.retry' })
      // 这一支是「执行器连失败形状都没交回」的兜底，没有原文可交（空串是如实交代，不是漏填）。
      if (!r.ok) {
        emitReadDegraded(ctx, 'subIssues', 'subIssues:page-fail', Date.now() - t0)
        return { ok: false, error: (r && r.error) || { kind: ERROR_KIND.NETWORK, message: '子票取数：这一页没取回来', raw: '' } }
      }
      // 为什么把回包定成这个形状：只读到本函数实际用的四层（errors/data.repository.issue.subIssues），
      // 更深的节点按 unknown 读；定宽了以后加字段要改两处，定窄了读不到，当前四层正好够用。
      let j: { errors?: unknown; data?: { repository?: { issue?: { subIssues?: { nodes?: unknown[]; totalCount?: unknown; pageInfo?: unknown } | null } | null } | null } | null }
      try { j = JSON.parse(r.data.stdout || '') } catch (e) {
        // 为什么转一下再读：catch 出来是 unknown，直接读 message 会报缺成员；转成最小形状后读法与原来一致，运行时不变。
        const eb = e as { message?: unknown } | null;
        // 没能解析成 JSON 的那份回包就是这里的原文（交的是这次 gh 的完整产出，不只 stdout 一截）。
        emitReadDegraded(ctx, 'subIssues', 'subIssues:json', Date.now() - t0)
        return fail(ERROR_KIND.PARSE, `子票取数：回包不是合法 JSON：${String((eb && eb.message) || e).slice(0, 200)}`, r.data)
      }
      if (j.errors) {
        const msg = `子票取数：${JSON.stringify(j.errors).slice(0, 800)}`
        // 原文交的是 GitHub 回的那份 errors 负载本身（msg 只是给它加了个操作名前缀，不算原文）。
        // 判档与话术都走本房唯一的出口：档位由规则表判、message 按票面实现决定第 11 条挑。
        const verdict = ghVerdictOf({ message: msg, stderr: msg }, ctx)
        emitReadDegraded(ctx, 'subIssues', 'subIssues:gql-err', Date.now() - t0)
        return fail(verdict.kind, ghFailureMessage(verdict, msg), JSON.stringify(j.errors))
      }
      const issue = j.data && j.data.repository && j.data.repository.issue
      if (!issue) {
        emitReadDegraded(ctx, 'subIssues', 'subIssues:notfound', Date.now() - t0)
        return fail(ERROR_KIND.NOTFOUND, `子票取数：地图 #${num} 没找到（或没有权限看它）`, r.data)
      }
      const conn = issue.subIssues
      if (!conn || !Array.isArray(conn.nodes)) {
        emitReadDegraded(ctx, 'subIssues', 'subIssues:shape', Date.now() - t0)
        return fail(ERROR_KIND.PARSE, '子票取数：回包里没有 subIssues.nodes（形状不对，不猜）', r.data)
      }
      if (total === null) {
        const tc = Number(conn.totalCount)
        total = Number.isFinite(tc) && tc >= 0 ? tc : null
      }
      for (const n of conn.nodes) {
        try { items.push(normalizeIssue(n)) } catch (e) { dropped += 1 }
      }
      // 硬上限：到顶就停，并把「被截断过」这个事实带回去（界面据此明说只加载了前 1000 张）。
      if (items.length >= MAX_SUB_ISSUES) { capped = true; break }
      // 为什么断言一下：游标段只读 hasNextPage/endCursor 两格，断言只为过编译，表达式与原来一字不差，运行时不变。
      const pageInfo = conn.pageInfo as { hasNextPage?: unknown; endCursor?: unknown } | null | undefined;
      if (!pageInfo || !pageInfo.hasNextPage) break
      hasNextPage = true
      after = pageInfo.endCursor
      if (!after) break // 后端说要翻下一页却没给游标：拿不到游标就停，别死循环
    }
    const fetched = items.length
    // 对不上就算差额；被上限卡住时不算「少了」—— 那件事由 capped 单独说（两件事别混成一句）。
    const missing = (total !== null && !capped && fetched + dropped < total) ? (total - fetched - dropped) : 0
    // 「拉全了」这一趟不记；被上限截断的那一趟必须记：回的是成功，可这次只装了一部分子票。
    if (capped) emitReadDegraded(ctx, 'subIssues', 'subIssues:truncated', Date.now() - t0)
    return { ok: true, data: { items, total: total === null ? fetched : total, fetched, capped, missing, dropped }, provenance: subIssuesProvenanceFromGraphql(clock, { fetched, capped, hasNextPage, dropped }) }
  } catch (e) {
    const verdict = ghVerdictOf(e, ctx)
    // 为什么转一下再读：同上，catch 的 unknown 不能直接读 message，转后表达式与原来一致。
    const eb = e as { message?: unknown } | null;
    emitReadDegraded(ctx, 'subIssues', 'subIssues:transport', Date.now() - t0)
    return fail(verdict.kind, ghFailureMessage(verdict, String((eb && eb.message) || e).slice(0, 800)), e)
  }
}

/**
 * 子票读操作对外的入口（#1698）：先按原样取数，再在企业版主机上补一句运行时能力回答。
 * 为什么包在入口而不是改内部每个失败分支：回答只关心「这次调用在这台服务端上行不行」，
 * 与具体失败在哪一页无关；包在入口能保证每条出口都带上同一句回答，也不会漏掉成功路径。
 */
export async function listSubIssues(repo: RepositoryRef, mapKey: unknown, opts: unknown, ctx: OpContext): Promise<SubIssueListResult> {
  const out: any = await listSubIssuesInner(repo, mapKey, opts, ctx)
  try {
    const failureText = out && out.ok === false && out.error ? String(out.error.raw || out.error.message || '') : ''
    return attachRuntimeAnswer(out, await runtimeCapabilityFor('listSubIssues', ctx, failureText))
  } catch (e) { return out }
}

export default { listSubIssues }
