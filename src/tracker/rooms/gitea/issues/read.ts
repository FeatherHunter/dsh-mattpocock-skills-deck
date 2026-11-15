/**
 * src/tracker/rooms/gitea/issues/read.ts —— gitea 房票的读路径：列票（list）与读单票（get）。
 *
 * 命令词汇表在 ../support/tea-run.ts 一处（票 #11 的口径）：本文件只做拿到原始进程结果之后的
 * 事——判档、解析 JSON、归一成契约形状、按调用点的容错吞掉评论富化失败。
 *
 * list 为什么只取一页：tea 的 --limit 一次最多要 100 条（共享分页表 gitea 组的 maxPerPage），
 * 与 GitLab 房 list 的口径一致——满页时置 truncated 如实交上去，读全与增量是另一件事；
 * 界面刷新探针付不起一次读翻几十页的成本。
 *
 * get 的评论走 best-effort：票面（正文、总数、状态）是主流程，评论列表取不到就按「没有这一类」
 * 继续，不拦主流程——与 GitLab 房 fetchAugment 同一个取舍。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { BackendContext, OpContext } from '../../../contract/contexts.js'
import type { Issue, RepositoryRef } from '../../../contract/entities.js'
import type { GetOpts, ListFilter } from '../../../contract/inputs.js'
import type { IssueListResult, OpResult } from '../../../contract/results.js'
import { LIST_TRUNCATED_REASON, TRACKER_ERROR_STAGE } from '../../../contract/results.js'
import { PAGINATION } from '../../../contract/pagination.js'
import { fail } from '../../../kernel/preflight.js'
import { failGitea } from '../errors.js'
import { normalizeIssue } from '../model/normalize.js'
import {
  type CtxLike,
  type RawBag,
  argsCommentsPage,
  argsIssueGet,
  argsIssueListPage,
  errMsg,
  labelsOf,
  parseReadBag,
  parseReadRows,
  refIdOf,
  runRead,
} from '../support/tea-run.js'
// 读降级的登记出口在 support/read-log.ts 一处（op / reason 只取登记清单里的值，票 #14）。
import { emitReadDegraded } from '../support/read-log.js'

// 一次详情最多取多少条评论正文（与 GitLab 房 COMMENTS_MAX 同一个上限，宿主按契约最多要 200 条）。
const COMMENTS_MAX = 200

/** 这次读单票要不要评论正文：没带 comments 选项回 null（不取正文，总数仍从票面上拿）；带了就夹在 0..200。 */
function commentsWantOf(opts: GetOpts | null | undefined): number | null {
  const c = opts && opts.comments
  if (!c || typeof c.first !== 'number' || !Number.isFinite(c.first)) return null
  return Math.max(0, Math.min(COMMENTS_MAX, Math.floor(c.first)))
}

/**
 * 按 ticket 编号拉一张票的原始形状：成功回票面，失败抛带原文的错以便上层归一。
 * 关系读（graph/read.ts）也从这里取，原始票读取只此一处出处。
 */
export async function fetchRawIssue(effective: CtxLike | null | undefined, refId: string, key: string | number): Promise<RawBag> {
  const res = await runRead(effective, argsIssueGet(refId, key))
  if (res.code !== 0) {
    // 原文带 stderr/stdout/退出码：上层 failGitea 取原文时才拿得到「tea 到底说了什么」。
    throw new Error(res.stderr || res.stdout || 'tea issues 命令失败（退出码 ' + String(res.code) + '）')
  }
  const raw = parseReadBag(typeof res.stdout === 'string' ? res.stdout : '')
  if (!raw) throw new Error('tea issues 的回包不是一张票的形状')
  return raw
}

/**
 * 按页取评论取够 want 条：短页停（tea 只在最后一页回短页）；任何一页失败回 null——
 * 评论是 best-effort，正文与总数比评论列表重要。
 */
async function fetchComments(effective: CtxLike | null | undefined, refId: string, key: string | number, want: number): Promise<unknown[] | null> {
  const limit = Math.max(0, Math.min(COMMENTS_MAX, Math.floor(want)))
  const out: unknown[] = []
  if (limit === 0) return out
  const perPage = PAGINATION.gitea.maxPerPage
  let page = 1
  while (out.length < limit) {
    const res = await runRead(effective, argsCommentsPage(refId, key, perPage, page))
    if (res.code !== 0) return null
    const rows = parseReadRows(typeof res.stdout === 'string' ? res.stdout : '')
    if (!rows) return null
    for (const row of rows) out.push(row)
    if (rows.length < perPage) break
    page += 1
  }
  return out.slice(0, limit)
}

/**
 * 列票（契约 list）：state 交给远端筛（缺省显式给 all——tea 的 ls 不带 --state 时默认只回
 * 打开的票，那会静默少一半，必须显式说全），labels 交给远端 AND 筛，keys 在内存里滤。
 * 满页置 truncated（契约 list:truncated 口径）。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId）
 * @param filter 过滤器（state / labels / keys 三项，其余由宿主二次过滤）
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function listIssues(
  ctx: CtxLike | null | undefined,
  repo: Partial<RepositoryRef> | null | undefined,
  filter: ListFilter | null | undefined,
  opCtx: CtxLike | null | undefined,
): Promise<IssueListResult> {
  const startedAt = Date.now()
  const effective = (opCtx || ctx) as CtxLike | undefined
  const refId = refIdOf(repo)
  if (!refId) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'list: repo.refId 缺失，无法向 Gitea 查询票', '')
  const perPage = PAGINATION.gitea.maxPerPage
  // state 三个值都在词汇表里：没给（或给了契约里不认识的值）就显式要 all，防止 tea 默认只回 open。
  const state = filter && filter.state === 'closed' ? 'closed' : filter && filter.state === 'open' ? 'open' : 'all'
  const labels = labelsOf(filter)
  try {
    const res = await runRead(effective, argsIssueListPage(refId, state, labels, perPage, 1))
    if (res.code !== 0) {
      // 原文 = 这一次 tea 调用的进程结果（stderr 里是 tea 或远端的原话）。
      return failGitea(new Error(res.stderr || res.stdout || 'list: tea issues ls 失败'), '列票失败：tea issues ls 没有跑成。请稍后重试。', res, effective)
    }
    const text = typeof res.stdout === 'string' ? res.stdout : ''
    let rows: unknown[] | null = parseReadRows(text)
    // 原文 = 远端回的那一段：人据此看出返回的到底是什么形状，而不是只被告知「不是数组」。
    if (!rows) return fail(ERROR_KIND.PARSE as ErrorKind, 'list: tea 回包不是插件预期的数组形状', text)
    // 先记「这一页是不是取满的」：下面的 keys 过滤会把行数变小，「远端给没给满一页」要在那之前判。
    const pageFull = rows.length >= perPage
    if (filter && Array.isArray(filter.keys) && filter.keys.length) {
      // tea 没有按编号批量取的命令，全量回一页后在内存里滤（诚实：滤不掉的留在 truncated 里交代）。
      const set = new Set(filter.keys.map(String))
      rows = rows.filter((x) => {
        const bag = (x && typeof x === 'object' ? x : null) as RawBag | null
        return !!bag && set.has(String(bag['index']))
      })
    }
    const issues = rows.map((raw) => normalizeIssue(raw))
    const out: IssueListResult = { ok: true, data: issues }
    if (pageFull) {
      // 满页意味着可能还有下一页：置 truncated 如实交代，落一行读降级（查「这张票怎么没出现」时日志里能看见）。
      emitReadDegraded(effective, 'list', LIST_TRUNCATED_REASON, Date.now() - startedAt)
      out.truncated = true
    }
    return out
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象本身。
    return failGitea(err, errMsg(err), err, effective)
  }
}

/**
 * 读单票（契约 get）：主票面加评论富化后归一。要几条评论正文由 opts.comments.first 决定
 * （0 表示一条正文都不要，只要票面上的总数；不带选项就不取正文）。
 */
export async function getIssue(
  ctx: CtxLike | null | undefined,
  repo: Partial<RepositoryRef> | null | undefined,
  key: string,
  opts: GetOpts | null | undefined,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Issue>> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const refId = refIdOf(repo)
  if (!refId) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'get: repo.refId 缺失，无法向 Gitea 查询这张票', '')
  const k = String(key).trim()
  if (!k) return fail(ERROR_KIND.PARSE as ErrorKind, 'get: 票号缺失', '', TRACKER_ERROR_STAGE.INPUT_REFUSED)
  try {
    const raw = await fetchRawIssue(effective, refId, k)
    // 评论是 best-effort：取不到不写 notes，归一层按「没有评论正文」处理，总数仍从票面的 comments 数字段拿。
    const want = commentsWantOf(opts)
    if (want !== null) {
      const notes = await fetchComments(effective, refId, k, want)
      if (notes !== null) raw['notes'] = notes
    }
    return { ok: true, data: normalizeIssue(raw) }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象（它带着 tea 的 stderr/stdout）。
    return failGitea(err, errMsg(err), err, effective)
  }
}
