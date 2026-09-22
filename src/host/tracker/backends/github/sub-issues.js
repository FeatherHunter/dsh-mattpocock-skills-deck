/**
 * backends/github/sub-issues.js —— 取一张地图的**全部**子票（#691 阶段 3：「地图子票拉全」）。
 *
 * 为什么要单独一条路，而不是从列表里捞：
 *   列表（issues.js 的 list）取的是整个仓库的票，带 500 条安全上限 —— 一张子票超过 100 张的地图
 *   会被这条上限截断，「打开地图看不到全部子票」就是这么来的。这条查询从「父票 → 子票」的原生关系
 *   往下取，按页翻到底，不受那个上限影响；连接上的 totalCount 用来核对「拉到的张数 == 总数」。
 *
 * 代价与时机：每 100 张一页。只有用户真的打开一张地图时才跑 —— 唯一调用者是宿主电话
 *   wf.mapTickets（src/host/mapTickets.js），它不参与快照首屏的组装。
 *
 * 名字为什么不进契约的 OPERATIONS：它是读路径的实现细节，与 `snapshotFast` 同一条豁免
 *   （见 tracker/contract.js 的「非 op 旁路豁免」）。没实现它的后端由电话按 unsupported 退化，
 *   界面退回快照里那份行数据，不做能力表（G5 红线）。
 *
 * 失败与「不许静默少几条」：
 *  - 任何一页请求失败都回 {ok:false}，绝不返回半份数据装作拉全了；
 *  - 拉到 1000 张硬上限还没到底 → 仍回成功，但 capped=true，让界面把「只加载了前 1000 张」说出来；
 *  - 拉到的张数与 totalCount 对不上（且不是被上限卡住）→ 仍回成功，但 missing 记下差额，
 *    界面必须把差额说出来 —— 这一条是本票验收里「拉到的张数等于 totalCount」的守门人。
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { fail } from '../../preflight.js'
import { ghClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { classifyGhError } from './errors.js'
import { SUB_ISSUES_QUERY } from './queries.js'
import { parseRepo, repoId } from './issues.js'

// 每页 100 张（GraphQL 连接的单页上限），硬上限 1000 张（规格第 6.4 节：超过就明说只加载了前 1000 张）。
const PAGE_SIZE = 100
const MAX_SUB_ISSUES = 1000

/**
 * listSubIssues(repo, mapKey, opts, ctx) -> OpResult<{items, total, fetched, capped, missing, dropped}>
 *  - items：归一后的子票行（含 key/state/labels/blockedBy 等契约字段），顺序按 GitHub 给的默认顺序；
 *  - total：后端说的总数（连接上的 totalCount）；拿不到时退化成拉到的张数（不假装知道）；
 *  - fetched：这一次真的拉回来并归一成功的张数；
 *  - capped：是否被 1000 张硬上限截断；
 *  - missing：没被上限卡住、却与 totalCount 对不上的差额（0 = 对上了）；
 *  - dropped：归一失败的条数（归一失败会丢行，丢了几条如实记下来，不混进 fetched）。
 */
export async function listSubIssues(repo, mapKey, opts, ctx) {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `子票取数：repo.refId 缺失或形状不对：${repoId(repo)}`)
    const num = Number(String(mapKey == null ? '' : mapKey).trim())
    if (!Number.isFinite(num)) return fail(ERROR_KIND.PARSE, `子票取数：GitHub 的地图编号必须是数字：${mapKey}`)
    const c = ghClient(ctx)
    const items = []
    let total = null
    let dropped = 0
    let after = null
    let capped = false
    // 逐页取到底：每页都问一次 hasNextPage，不用「上一页满不满」去猜（满页也可能是最后一页）。
    for (;;) {
      const args = ['api', 'graphql', '-f', `query=${SUB_ISSUES_QUERY}`, '-F', `owner=${parsed.owner}`, '-F', `name=${parsed.name}`, '-F', `number=${num}`, '-F', `first=${PAGE_SIZE}`]
      if (after) args.push('-F', `after=${after}`)
      else args.push('-F', 'after=')
      // 这一台机器上 api.github.com/graphql 的 POST 偶发 `unexpected EOF`（仓库里早有记载，见 issues.js 的 REST 降级注释）。
      // 列表那条路为它准备了一整套 REST 降级；这条路只在用户点开一张地图时跑、最多十页，抖一下就整张地图空白不值得，
      // 所以对**同一页**多试一次：第一次失败先按原样重试，第二次还失败才如实报错（界面那里有「重试」）。
      let r = await c.execGh(args, { cwd: ctx && ctx.cwd })
      if (!r.ok) r = await c.execGh(args, { cwd: ctx && ctx.cwd })
      if (!r.ok) return { ok: false, error: (r && r.error) || { kind: ERROR_KIND.NETWORK, message: '子票取数：这一页没取回来' } }
      let j
      try { j = JSON.parse(r.data.stdout || '') } catch (e) {
        return fail(ERROR_KIND.PARSE, `子票取数：回包不是合法 JSON：${String((e && e.message) || e).slice(0, 200)}`)
      }
      if (j.errors) {
        const msg = `子票取数：${JSON.stringify(j.errors).slice(0, 800)}`
        return fail(classifyGhError({ message: msg, stderr: msg }, ctx), msg)
      }
      const issue = j.data && j.data.repository && j.data.repository.issue
      if (!issue) return fail(ERROR_KIND.NOTFOUND, `子票取数：地图 #${num} 没找到（或没有权限看它）`)
      const conn = issue.subIssues
      if (!conn || !Array.isArray(conn.nodes)) return fail(ERROR_KIND.PARSE, '子票取数：回包里没有 subIssues.nodes（形状不对，不猜）')
      if (total === null) {
        const tc = Number(conn.totalCount)
        total = Number.isFinite(tc) && tc >= 0 ? tc : null
      }
      for (const n of conn.nodes) {
        try { items.push(normalizeIssue(n)) } catch (e) { dropped += 1 }
      }
      // 硬上限：到顶就停，并把「被截断过」这个事实带回去（界面据此明说只加载了前 1000 张）。
      if (items.length >= MAX_SUB_ISSUES) { capped = true; break }
      const pageInfo = conn.pageInfo
      if (!pageInfo || !pageInfo.hasNextPage) break
      after = pageInfo.endCursor
      if (!after) break // 后端说要翻下一页却没给游标：拿不到游标就停，别死循环
    }
    const fetched = items.length
    // 对不上就算差额；被上限卡住时不算「少了」—— 那件事由 capped 单独说（两件事别混成一句）。
    const missing = (total !== null && !capped && fetched + dropped < total) ? (total - fetched - dropped) : 0
    return { ok: true, data: { items, total: total === null ? fetched : total, fetched, capped, missing, dropped } }
  } catch (e) {
    return fail(classifyGhError(e, ctx), String((e && e.message) || e).slice(0, 800))
  }
}

export default { listSubIssues }
