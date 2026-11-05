/**
 * src/tracker/rooms/gitlab/issues/read.ts —— 票的读路径：列票、读单票，以及单票详情里的评论与链接富化。
 *
 * 为什么搬进 issues/ 子树（#1912）：票是一个概念，读与写的落点都应该在这个概念目录里。根目录
 * issues.ts 只剩纯转发（#1913 把写路径也搬进来之后），房外按旧路径 import 的名字因此不用改；
 * 入口 index.ts 已直接从本文件取 listIssues / getIssue，从 issues/write.ts 取四个写操作。
 *
 * 请求的形状不在这里：每条请求都调根目录 requests.ts 的具名函数，那里才是 method 与路径的唯一出处；
 * 每次给多长的超时由本文件按操作选好，再作为领域值传进去。本文件只做拿到原始进程结果之后的事：
 * 非零退出码归错误档、解析 JSON、归一成契约形状、
 * 按调用点的容错吞掉富化失败。行为与搬迁前逐字一致，包括失败话术、日志、评论要几条的夹取与翻页判据。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { BackendContext, OpContext } from '../../../contract/contexts.js'
import type { Issue, RepositoryRef } from '../../../contract/entities.js'
import type { GetOpts, ListFilter } from '../../../contract/inputs.js'
import type { OpResult, IssueListResult } from '../../../contract/results.js'
import { LIST_TRUNCATED_REASON, TRACKER_ERROR_STAGE } from '../../../contract/results.js'
import { PAGINATION } from '../../../contract/pagination.js'
import { fail } from '../../../kernel/preflight.js'
import type { GlabRunResult } from '../client.js'
import { normalizeIssue } from '../model/normalize.js'
import { failGlab } from '../errors.js'
import { emitReadDegraded } from '../support/read-log.js'
// 票读与票写共用的回包收尾助手只在同目录的 shared.ts 一处（#1907 评审修复）。
import { apiJson, errMsg, parseJsonSafe, toApiError } from './shared.js'
import { issuePath, notesPath, linksPath } from '../queries.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml；请求函数收领域值 timeoutMs，档位由这里按操作选。
import { GITLAB_READ_TIMEOUT_MS, GITLAB_SLOW_READ_TIMEOUT_MS } from '../../../../shared/time-config/src/values.js'
// 仓库标识的取法与优先级只在 model/repo-identity.ts 一处（#1910）。
import { repoRefId } from '../model/repo-identity.js'
// 请求的形状住在房间根目录的 requests.ts（#1912）：本文件只收原始进程结果，再按旧口径归位。
import {
  requestIssueList,
  requestIssueGet,
  requestIssueNotes,
  requestIssueNotesPage,
  requestIssueLinks,
} from '../requests.js'

// 仓库身份只取 refId/name，是因为票读写只认这两样，拿全量会把 effortId 搅进来。
type RepoLike = Partial<RepositoryRef> | null | undefined
// 上下文两形都收，是因为调用方有时把执行器放在 ctx、有时放在 opCtx，缺了就让请求函数里的 glabClient 按 127 回。
type CtxLike = Partial<OpContext> & Partial<BackendContext>
type RawBag = Record<string, unknown>

/**
 * 按 iid 拉一张票的原始形状：成功回票面，失败抛带原文的错以便上层归一。
 *
 * 这是「多处共用的原始票读取」的唯一出处（#1914）：关系读写的三个文件（graph/read.ts、
 * graph/write.ts 与 graph/membership.ts）都从这里取，不再在各自文件里再养一份。请求本身仍走根目录
 * requests.ts 的 requestIssueGet，method、路径与 with_labels_details 只在那一处；本函数只决定超时，以及失败时
 * 把原始回包挂在错上，让上层 `fail()` 能取到 glab 的原话。
 *
 * @param opCtx 本次调用的上下文（执行器从这里取；缺了请求边界按 127 如实回）
 * @param refId 目标仓库（形如 group/project）
 * @param key 票号（iid 字符串）
 */
export async function fetchRawIssue(
  opCtx: CtxLike | null | undefined,
  refId: string,
  key: string,
): Promise<RawBag | null> {
  const res = await requestIssueGet(opCtx, refId, key, GITLAB_READ_TIMEOUT_MS)
  if (res.code !== 0) {
    // 带上这一趟的原始回包（stderr/stdout/退出码）：上层只 catch 到一个 Error 时，
    // 原始回包仍然躺在这个错上，`fail()` 取原文时才拿得到「glab 到底说了什么」。
    throw toApiError(res.stderr || res.stdout, res.stderr, res.stdout, res.code)
  }
  let raw: unknown = null
  try {
    raw = JSON.parse(res.stdout) as unknown
  } catch {
    raw = null
  }
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) return raw as RawBag
  return raw as RawBag | null
}

// 一次详情最多取多少条评论（与宿主 comment-thread-fetch.ts 的 COMMENTS_MAX 同一个上限）。
// 调用方按契约最多会要 200 条；房间按同一数字夹住，免得一次翻太多页把一次读拖成十几趟。
const COMMENTS_MAX = 200

/**
 * 这次读单票要不要评论、要几条：没带 comments 选项返回 null（调用方要的是旧行为：一页 20 条、请求不带分页参数）。
 * 带了就夹在 0..200 之间；first=0 表示一条正文都不要，只要票面上的总数。
 */
function commentsWantOf(opts: GetOpts | null | undefined): number | null {
  const c = opts && opts.comments
  if (!c || typeof c.first !== 'number' || !isFinite(c.first)) return null
  return Math.max(0, Math.min(COMMENTS_MAX, Math.floor(c.first)))
}

/**
 * 按 per_page/page 翻 notes 取够 want 条。
 *
 * 为什么要翻页：GitLab 的 notes 默认一页只有 20 条，调用方要 50/100/200 条时只发一次请求，
 * 拿到的永远只是第一页 —— 详情页于是只能看到 20 条，「加载更多」也永远取不到后面的（#1784）。
 * 取不满一页就说明远端没有更多，立刻停；任何一页失败都按「评论没取到」返回 null（沿用旧行为的 best-effort），
 * 不拦主流程：正文与总数比评论列表更重要，评论列表可以等下一次再试。
 */
async function fetchNotes(
  opCtx: CtxLike | null | undefined,
  refId: string,
  iid: string | number,
  want: number,
): Promise<unknown[] | null> {
  const limit = Math.max(0, Math.min(COMMENTS_MAX, Math.floor(want)))
  const out: unknown[] = []
  if (limit === 0) return out
  let page = 1
  while (out.length < limit) {
    const perPage = Math.min(PAGINATION.gitlab.maxPerPage, limit - out.length)
    let notes: unknown
    try {
      notes = await apiJson(
        requestIssueNotesPage(opCtx, refId, iid, perPage, page, GITLAB_READ_TIMEOUT_MS),
        `${notesPath(refId, iid)}?per_page=${perPage}&page=${page}`,
      )
    } catch {
      return null
    }
    if (!Array.isArray(notes)) return null
    const arr = notes as unknown[]
    for (const n of arr) out.push(n)
    if (arr.length < perPage) break
    page += 1
  }
  return out.slice(0, limit)
}

/**
 * 把单票回包里缺的评论与链接补上（best-effort：任何一路失败都按「没有这一类」继续，不拦主流程）。
 *
 * commentsWant 为 undefined / null 时走旧的单次聚合（远端默认一页）；给了数字就按页取够那么多条。
 * 建票与改票也调用本函数，所以这里只改传进来的 raw，不另建对象。
 */
export async function fetchAugment(
  opCtx: CtxLike | null | undefined,
  refId: string,
  raw: RawBag,
  notesWant?: number | null,
): Promise<RawBag> {
  const iid = raw['iid']
  if (iid == null) return raw
  // 聚合 notes + links（best-effort，失败忽略）
  if (notesWant === undefined || notesWant === null) {
    try {
      const notes = await apiJson(
        requestIssueNotes(opCtx, refId, iid as string | number, GITLAB_READ_TIMEOUT_MS),
        notesPath(refId, iid as string | number),
      )
      if (Array.isArray(notes)) raw['notes'] = notes
    } catch {
      // 聚合失败就按无聚合归一，不拦主流程。
    }
  } else {
    const notes = await fetchNotes(opCtx, refId, iid as string | number, notesWant)
    if (notes !== null) raw['notes'] = notes
  }
  try {
    const links = await apiJson(
      requestIssueLinks(opCtx, refId, iid as string | number, GITLAB_READ_TIMEOUT_MS),
      linksPath(refId, iid as string | number),
    )
    if (Array.isArray(links)) raw['links'] = links
  } catch {
    // 聚合失败就按无聚合归一，不拦主流程。
  }
  return raw
}

/**
 * 列票：按 state 筛后归一，keys 在内存里滤（远端无批量接口，如实全量再滤）。
 *
 * #1770：GitLab REST 的 `per_page` 上限是 100（见契约里的共享分页表），本函数只取第一页。
 * 取满一页时置 `truncated: true` 并落一行 `read.degraded`（`list:truncated`），把「可能还有
 * 第 101 张、且它可能在第一页之外」如实交上去；不在这里翻页 —— 9 千票的仓库要翻 96 页，
 * 5 秒一拍的刷新探针付不起这笔成本，读全与增量是另一张票（#1772）的取数设计。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId/name）
 * @param filter 过滤器（state/keys 两项，其余由宿主二次过滤）
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function listIssues(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  filter: ListFilter | null | undefined,
  opCtx: CtxLike | null | undefined,
): Promise<IssueListResult> {
  const startedAt = Date.now()
  const effective = (opCtx || ctx) as CtxLike | undefined
  const id = repoRefId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'list: repo.refId missing', '')
  // filter → query（state；分页固定单页 100 条，见函数头）
  const perPage = PAGINATION.gitlab.maxPerPage
  const params = new URLSearchParams()
  params.set('per_page', String(perPage))
  params.set('with_labels_details', 'true')
  if (filter && filter.state) {
    // GitLab state: opened/closed
    params.set('state', filter.state === 'closed' ? 'closed' : 'opened')
  }
  if (filter && Array.isArray(filter.keys) && filter.keys.length) {
    // GitLab无批量keys过滤，返回全量后前端过滤（诚实）
  }
  try {
    const res = await requestIssueList(effective, id, params.toString(), GITLAB_SLOW_READ_TIMEOUT_MS)
    if (res.code !== 0) {
      // 原文 = 列票那一次 glab 调用的进程结果。
      return failGlab(res, res.stderr || res.stdout || 'list failed', res, effective)
    }
    let arr: unknown = parseJsonSafe(res.stdout)
    // 原文 = 远端回的那一段（人据此看出返回的到底是什么形状，而不是只被告知「不是数组」）。
    if (!Array.isArray(arr)) return fail(ERROR_KIND.PARSE as ErrorKind, 'list returned non-array', res.stdout)
    // 先记「这一页是不是取满的」：下面的 keys 过滤会把行数变小，但「远端给没给满一页」要在那之前判。
    // 取满 = 第 101 张可能存在，且它可能落在第一页之外（默认按创建时间倒序，老票永远不在第一页）。
    const pageFull = arr.length >= perPage
    // 若filter有keys，内存过滤
    if (filter && Array.isArray(filter.keys) && filter.keys.length) {
      const set = new Set(filter.keys.map(String))
      arr = (arr as RawBag[]).filter((x) => set.has(String(x['iid'])))
    }
    if (filter && filter.parentKey !== undefined) {
      // parentKey过滤需links聚合（heavy），此处先返回全量由宿主侧二次过滤（诚实但不阻塞）
    }
    // 归一（不逐条聚合links以免爆量；get会聚合）
    const issues = (arr as unknown[]).map((raw) => normalizeIssue(raw))
    // 拿不全却按成功返回：返回前落一行，查「这张地图怎么空了/这张票怎么没出现」时日志里能看见这一趟。
    const out: IssueListResult = { ok: true, data: issues }
    if (pageFull) {
      emitReadDegraded(effective as OpContext | null | undefined, 'list', LIST_TRUNCATED_REASON, Date.now() - startedAt)
      out.truncated = true
    }
    return out
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象（请求失败时它带着 stderr/stdout/退出码）。
    return failGlab(err, errMsg(err), err, effective)
  }
}

/**
 * 读单票：主票面加聚合 notes/links 后归一，回包不是票形就按没找到回。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId/name）
 * @param key 票号（iid 字符串）
 * @param opts 读选项：comments.first 要几条评论正文（0 表示只要总数）。不带时沿用旧行为（notes 只取第一页 20 条、请求不带分页参数）。
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function getIssue(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  key: string,
  opts: GetOpts | null | undefined,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Issue>> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const id = repoRefId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'get: repo.refId missing', '')
  const k = String(key)
  if (!k) return fail(ERROR_KIND.PARSE as ErrorKind, 'get: key required', '', TRACKER_ERROR_STAGE.INPUT_REFUSED)
  try {
    const raw = (await apiJson(
      requestIssueGet(effective, id, k, GITLAB_READ_TIMEOUT_MS),
      `${issuePath(id, k)}?with_labels_details=true`,
    )) as RawBag | null
    // 原文 = 这次接口回给我们的那个值（它不是一张票的形状，所以按「没找到」如实失败）。
    if (!raw || typeof raw !== 'object') {
      return fail(ERROR_KIND.NOTFOUND as ErrorKind, `issue ${k} not found`, raw === undefined || raw === null ? '' : raw)
    }
    // 要没要评论、要几条：没带选项时 want 是 null，fetchAugment 走旧的单次聚合（一页 20 条）。
    // 带了就按 per_page/page 翻够 want 条（#1784：不翻页时「加载更多」永远只能拿到同一页）。
    const want = commentsWantOf(opts)
    await fetchAugment(effective, id, raw, want)
    const issue = normalizeIssue(raw)
    return { ok: true, data: issue }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象（请求失败时它带着 stderr/stdout/退出码）。
    return failGlab(err, errMsg(err), err, effective)
  }
}
