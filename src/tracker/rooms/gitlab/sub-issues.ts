/**
 * src/tracker/rooms/gitlab/sub-issues.ts —— 取一张地图上挂着的票（契约第 21 条 `Tracker.listSubIssues` 的 GitLab 实现）。
 *
 * ── 这条能力在 GitLab 上读回来的到底是什么（先读这一段，再读代码）──────────────────
 * 子票的定义只有一条：正文里写着 `Part of #<这张地图>` 声明行的票
 * （模板 `issue-tracker-gitlab.md` Wayfinding operations 第 42 行：子票 = 正文顶部
 * `Part of #<map>` + `wayfinder:<类型>` 标签）。读法是声明优先：票面上有这一行就是子票，
 * 没有就不是 —— 不猜、不按链接方向推断。
 *
 * 为什么不走 links 表：`relates_to` 是对称的平级关联，列表行里分不出哪一头是父；
 * 按 source/target 方向判读得准，但那是「本房以前自己立的约定」，人手工加的关联链接
 * 与程序写下的在远端长得一模一样，方向判法解释手工链接时会指错。声明行没有这个问题：
 * 写没写这一行是票面原文，读回来是什么就是什么。
 *
 * 代价说清楚：这一条读是翻页扫仓（per_page=100，一页一页往后翻，最多装 1000 张子票）。
 * 列表接口一次不给全仓，页数随仓里票数涨；地图自己的子票通常只有几张到几十张，
 * 扫的是全仓票数，不是子票数。哪天仓大到扫不动，把这一段换成服务端 search
 * （`issues?search=Part of #<map>`）再逐张验原文 —— 换之前先核实 search 搜不搜正文，
 * 没核实就换等于把枚举权交给了没验过的服务。
 *
 * ── 拿不全的几条路（与 GitHub 房同一条纪律：绝不返回半份数据装作拉全了）──────────
 *  · 某一页没取回来（同一页重试一次）→ 整体失败；
 *  · 某一页回包不是数组 → 整体失败；
 *  · 子票超过 1000 张 → 仍回成功，但 `capped=true`，如实说「还有更多，这次没全取回」；
 *  · `total`：翻页扫全了仓才停，所以总数就是装进来的张数（`fetched`），不假装知道更多；
 *  · `missing`：恒为 0（能与总数对不上的只剩「被 1000 上限截断」，那件事由 `capped` 单独说）；
 *  · `dropped`：拿到了行却没能算进去的张数（缺编号、形状不是对象、归一抛错）；
 *  · 有候选行、却一张都画不出来 → 整体失败，不返回一张空地图：
 *    「读不出来」与「这张地图真的没有子票」必须长得不一样，不然界面会把前者画成后者。
 *
 * ── 日志 ────────────────────────────────────────────────────────────────────
 * 只落本房已登记的那几条 `read.degraded` 理由（`read-log.ts` 的 READ_DEGRADED_REASONS）：
 * `subIssues:repo-ref`、`subIssues:transport`、`subIssues:json`、`subIssues:shape`、
 * `subIssues:notfound`、`subIssues:page-fail`、`subIssues:truncated`。刻意不新开取值：
 * 要加就回来找 Lead。房内不许直接调 `ctx.logEvent`，所以这里一律走 `emitReadDegraded`。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { BackendContext, OpContext } from '../../contract/contexts.js'
import type { Issue, RepositoryRef } from '../../contract/entities.js'
import type { OpResult, SubIssueList } from '../../contract/results.js'
import { fail } from '../../kernel/preflight.js'
import { glabClient } from './client.js'
import { classifyGlabError, failGlab } from './errors.js'
import { normalizeIssue } from './normalize.js'
import { issuesPath } from './queries.js'
import { repoId } from './graph-blocking.js'
import { emitReadDegraded } from './read-log.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { GITLAB_READ_TIMEOUT_MS } from '../../../shared/time-config/src/values.js'

// 一张地图最多装多少张子票：与 GitHub 房同一个硬上限（契约 operations.ts:244「1000 张硬上限」）。
const MAX_SUB_ISSUES = 1000
// 翻页扫仓时一页取多少张：与房内列表路径一致（issues.ts 的 listIssues 也是 100）。
const PAGE_SIZE = 100
// 列表页与重试共用这个超时；与房内其它读路径保持一致（issues.ts / graph-blocking.ts 都是 8000）。

// 本房既有形状：仓库标识只取 partial，缺了按 404 那一档如实回而不是抛（与 issues.ts / labels.ts 同一份写法）。
type RepoLike = Partial<RepositoryRef> | null | undefined
// 第四格两形都收：房间 create 时给的是 BackendContext，单次调用给的是 OpContext。
// 这样装配那一行就能照本房既有十几条那样原样写 `opCtx || ctx`，不必在调用处再加断言。
type CtxLike = Partial<OpContext> & Partial<BackendContext>
// 远端回包先收成袋再读：列表行里每一格都可缺可空，直接按定型读会把缺字段当成错。
type RawBag = Record<string, unknown>

/** 只认「对象」这一种形状：数组、null、字符串都不是袋，读不了就当形状不认识。 */
function asBag(v: unknown): RawBag | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return v as RawBag
}

/** 任意值转成能比较的字符串：null / undefined 一律给空串（不给 'null' 这种假值）。 */
function text(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

/**
 * listSubIssues(repo, mapKey, opts, ctx) -> OpResult<{items, total, fetched, capped, missing, dropped}>
 *
 * 六个字段的含义与读者（契约 `results.ts:161-185` 是唯一真源，这里只写这一房的取法）：
 *  · items  ：归一后的行（契约 `Issue` 形状，交给 `normalizeIssue`）。只装正文里写着
 *             `Part of #<这张地图>` 的那些行；分不出形状的行不装；
 *  · total  ：翻页扫全了仓才停，总数就是装进来的张数，取 fetched；
 *  · fetched：真正装进 items 的张数；
 *  · capped ：是否撞到 1000 张硬上限（撞到就停，界面据此说「还有更多，没全取回」）；
 *  · missing：恒为 0（见文件头）；
 *  · dropped：拿到了行却没能算进去的张数（缺编号、形状不是对象、归一抛错）。
 *
 * 入参这一格收得比契约宽（`mapKey: unknown`）而运行时按编号校验：宿主电话那一层是 JavaScript，
 * 可能把编号给成数字；GitHub 房的同一条操作也是这么收的。第 4 格收两种上下文形状，理由见 `CtxLike`。
 */
export async function listSubIssues(
  repo: RepoLike,
  mapKey: unknown,
  opts: Record<string, never> | undefined,
  ctx: CtxLike | null | undefined,
): Promise<OpResult<SubIssueList>> {
  // 今天没有可选项；这一格留着是为了与契约的签名逐格对上（将来加选项不改签名）。
  void opts
  // 这一笔的起点：本条读的每一行降级日志都带「从入口到这里花了多久」。
  const t0 = Date.now()
  // 本房 read-log 出口的入参按契约收 OpContext，而第四格是「两形都收」的半份上下文，
  // 所以这里转一次、只用于落日志；运行时 read-log 只读 ctx.logEvent 与 ctx.opId 两格，转与不转一样。
  const logCtx = ctx as OpContext | null | undefined
  // 判档那一格只读 logEvent / isEnabled 两样，null 与 undefined 在这里同义（都是「没有上下文」）。
  const classifyCtx = ctx || undefined
  // 入参两格都没问题才起进程：这之前一个请求都没发，所以原文给空串（本房既有做法，见 graph-membership.ts:60）。
  const id = repoId(repo)
  const key = text(mapKey).trim()
  if (!id || !key) {
    emitReadDegraded(logCtx, 'subIssues', 'subIssues:repo-ref', Date.now() - t0)
    return fail(
      ERROR_KIND.NOTFOUND,
      `子票取数：repo.refId 或地图编号缺失、形状不对（repo=${id || '空'}，地图=${key || '空'}）`,
      '',
    )
  }
  try {
    const c = glabClient(ctx as Partial<OpContext> & Partial<BackendContext>)

    // ── 翻页扫仓：列表接口一次只给一页，没有「给我全仓」这一格，只能一页一页往后翻。
    const items: Issue[] = []
    let dropped = 0
    let capped = false
    let lastRes: { code: number; stdout: string; stderr: string } | null = null
    let page = 1
    for (;;) {
      const listArgs = ['api', issuesPath(id, `per_page=${PAGE_SIZE}&page=${page}&with_labels_details=true`)]
      let listRes = await c.run(listArgs, { timeout: GITLAB_READ_TIMEOUT_MS })
      if (listRes.code !== 0) listRes = await c.run(listArgs, { timeout: GITLAB_READ_TIMEOUT_MS })
      lastRes = listRes
      if (listRes.code !== 0) {
        // 「这张票不在」与「这一页没跑成」是两件事：日志里用两个不同的理由记，人一眼分得开。
        const verdict = classifyGlabError(listRes, classifyCtx)
        const notfound = verdict.kind === ERROR_KIND.NOTFOUND
        emitReadDegraded(logCtx, 'subIssues', notfound ? 'subIssues:notfound' : 'subIssues:page-fail', Date.now() - t0)
        return failGlab(
          listRes,
          notfound ? `子票取数：地图 #${key} 没找到（或没有权限看它）` : '子票取数：列表第 ' + page + ' 页没取回来',
          listRes,
          classifyCtx,
        )
      }
      let rows: unknown = null
      try {
        rows = JSON.parse(listRes.stdout || '')
      } catch {
        rows = null
      }
      if (!Array.isArray(rows)) {
        emitReadDegraded(logCtx, 'subIssues', 'subIssues:json', Date.now() - t0)
        return fail(ERROR_KIND.PARSE, `子票取数：列表第 ${page} 页回包不是合法数组`, listRes.stdout)
      }
      if (rows.length === 0) break
      for (const row of rows as unknown[]) {
        // 硬上限：到顶就停，并把这个事实带回去（界面据此明说只装了前 1000 张）。
        if (items.length >= MAX_SUB_ISSUES) {
          capped = true
          break
        }
        const bag = asBag(row)
        if (!bag || !text(bag['iid']).trim()) {
          dropped += 1
          continue
        }
        try {
          const issue = normalizeIssue(row)
          // 子票的唯一判据：正文里的 `Part of #<这张地图>` 声明行（归一里已经认好，这里只比）。
          if (issue.parentKey === key) items.push(issue)
        } catch {
          dropped += 1
        }
      }
      if (capped) break
      // 这一页没装满，说明后面没有页了；装满了就往后翻一页。
      if (rows.length < PAGE_SIZE) break
      page += 1
    }

    // 「一行都没能算进去」与「这张地图真的没有子票」不能画成同一个样子：有候选行、却一张都画不出来，
    // 按形状不认识整体失败（理由用已登记的 subIssues:shape），让宿主退回快照那份行，
    // 而不是把「读不出来」画成「一张都没有」。
    if (dropped > 0 && items.length === 0) {
      emitReadDegraded(logCtx, 'subIssues', 'subIssues:shape', Date.now() - t0)
      return fail(
        ERROR_KIND.PARSE,
        `子票取数：地图 #${key} 的候选行一行都没能算进去（${dropped} 行缺编号或形状不对）`,
        lastRes ? lastRes.stdout : '',
      )
    }

    const fetched = items.length
    // 总数：翻页扫全了仓才停，总数就是装进来的张数；界面要说的「还有更多」由 capped 单独说。
    const total = fetched
    // missing：本后端结构上恒为 0（唯一能对不上的是被上限截断，那件事归 capped），如实写 0。
    const missing = 0
    // 「拉全了」这一趟不记；被上限截断的那一趟必须记：回的是成功，可这次只装了一部分。
    if (capped) emitReadDegraded(logCtx, 'subIssues', 'subIssues:truncated', Date.now() - t0)
    return { ok: true, data: { items: items, total: total, fetched: fetched, capped: capped, missing: missing, dropped: dropped } }
  } catch (e) {
    // 兜底：判档与话术都走本房唯一的出口（failGlab 内部按规则表判、按兜底规则挑话），原文交抛上来的那个错。
    emitReadDegraded(logCtx, 'subIssues', 'subIssues:transport', Date.now() - t0)
    return failGlab(e, `子票取数：${String((e as { message?: unknown } | null)?.message || e).slice(0, 200)}`, e, classifyCtx)
  }
}

export default { listSubIssues }
