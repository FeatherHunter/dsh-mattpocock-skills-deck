/**
 * src/tracker/rooms/gitea/issues/counts.ts —— gitea 房的计数读（契约 counts）。
 *
 * tea 没有统计端点：打开/关闭两个数靠翻页扫仓数出来。这条口径的取舍写在这里：
 *   · 每页按共享分页表的 subIssuesPageSize 取，最多扫 countScanMaxPages 页——扫到顶还有满页
 *     就说明数不清，如实失败，**不许拿手上这一批当全量猜一个数**（契约点名的红线）；
 *   · 「这一页的条数 < 每页上限就是最后一页」是 tea 翻页的统一判据，与标签页同一口径；
 *   · filter.state 在本地收窄（把不相干的那个数归零、total 取收窄后的总数），与 GitHub / GitLab
 *     房同一口径，界面拿到的三个数不因后端不同而含义不同；
 *   · filter.labels 交给远端 AND 筛（--labels），扫的就是同一筛选口径下的那批票。
 *
 * scanIssueCounts 单独导出：listPage 的 total 用同一份扫描（pages.ts），不另养第二份翻页循环。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { RepositoryRef } from '../../../contract/entities.js'
import type { ListFilter } from '../../../contract/inputs.js'
import type { Counts, OpResult } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import { failGitea } from '../errors.js'
import { PAGINATION } from '../../../contract/pagination.js'
import { errMsg, labelsOf, narrowStateOf, parseReadRows, refIdOf, runRead, argsIssueListPage, type CtxLike } from '../support/tea-run.js'

type FilterLike = Partial<ListFilter> | null | undefined

// filter.state 归一收在 ../support/tea-run.ts 一处（票 #14 评审收编，与 pages.ts 同一份）。

/** 翻页扫仓数票：成功回打开/关闭两个数；扫不满（撞页数上限还是满页）或任何一页读不成，如实失败。 */
export async function scanIssueCounts(
  effective: CtxLike | null | undefined,
  refId: string,
  labels: string[],
): Promise<{ ok: true; open: number; closed: number } | { ok: false; kind: 'transport'; err: unknown } | { ok: false; kind: 'uncountable'; text: string }> {
  const perPage = PAGINATION.gitea.subIssuesPageSize
  const maxPages = PAGINATION.gitea.countScanMaxPages
  let open = 0
  let closed = 0
  for (let page = 1; page <= maxPages; page += 1) {
    // 扫描显式要 all：数的是全仓（state 收窄在调用方本地做），少要一态就会数错。
    const res = await runRead(effective, argsIssueListPage(refId, 'all', labels, perPage, page))
    if (res.code !== 0) return { ok: false, kind: 'transport', err: new Error(res.stderr || res.stdout || 'counts: tea issues ls 失败') }
    const text = typeof res.stdout === 'string' ? res.stdout : ''
    const rows = parseReadRows(text)
    if (!rows) return { ok: false, kind: 'uncountable', text }
    for (const row of rows) {
      // state 只认字面 closed，其余（含缺字段）按打开数——与归一层「两态之外的都归 open」同一方向。
      const bag = (row && typeof row === 'object' ? row : null) as Record<string, unknown> | null
      if (bag && bag['state'] === 'closed') closed += 1
      else open += 1
    }
    // 短页即最后一页：不用「回空表」当唯一哨兵，少花一次出站请求（与 GitLab 房同一判据）。
    if (rows.length < perPage) return { ok: true, open, closed }
  }
  // 到顶还是满页：数不清就是数不清，整条失败——契约不许猜。
  return { ok: false, kind: 'uncountable', text: 'counts: 票数超出一次能扫的上限（' + String(maxPages * perPage) + ' 张），无法确认数得全' }
}

/**
 * 数一数这个仓库里符合条件的票有多少张（一行票面都不返回）。
 *
 * @param repo 目标仓库（只取 refId）
 * @param filter 筛选（只认 state 与 labels 两项，其余由宿主二次过滤）
 * @param ctx 调用上下文（opCtx 缺时顶上）
 */
export async function counts(
  repo: Partial<RepositoryRef> | null | undefined,
  filter: ListFilter | null | undefined,
  ctx: CtxLike | null | undefined,
): Promise<OpResult<Counts>> {
  const effective = ctx
  const refId = refIdOf(repo)
  if (!refId) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'counts: repo.refId 缺失，无法向 Gitea 数票', '')
  const narrow = narrowStateOf(filter)
  const labels = labelsOf(filter)
  const scan = await scanIssueCounts(effective, refId, labels)
  if (!scan.ok) {
    if (scan.kind === 'transport') {
      return failGitea(scan.err, errMsg(scan.err), scan.err, effective || undefined)
    }
    return fail(ERROR_KIND.ENV as ErrorKind, scan.text, '')
  }
  const data: Counts =
    narrow === 'closed'
      ? { open: 0, closed: scan.closed, total: scan.closed }
      : narrow === 'open'
        ? { open: scan.open, closed: 0, total: scan.open }
        : { open: scan.open, closed: scan.closed, total: scan.open + scan.closed }
  return { ok: true, data }
}
