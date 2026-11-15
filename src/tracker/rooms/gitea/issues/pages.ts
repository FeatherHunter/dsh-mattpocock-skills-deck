/**
 * src/tracker/rooms/gitea/issues/pages.ts —— gitea 房的分页读（契约 listPage）。
 *
 * 游标就是 tea 的页码（字符串形式交出去、数回来）：没有比它更稳的页间标记——tea 的
 * issues ls 没有键集游标，硬造一个反而要记录每次的行边界。非法游标按第 1 页从头来
 * （宽容口径：调用方拿到 null 就是尽头，拿到旧游标只会重读，不会漏读）。
 *
 * 每页行数三重夹：调用方的 limit 缺省 50（共享表 limitDefault）、至多 200（limitMax）、
 * 且不超过 tea 一页的上限 100（maxPerPage）——上限永远走共享分页表，不裸写数字。
 *
 * total 与 counts 同一份扫描（scanIssueCounts），仓库票数就在同一条口径下数出来；
 * 扫不满就整条失败——分页的 total 与 counts 的三个数不许一个真一个猜。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { BackendContext, OpContext } from '../../../contract/contexts.js'
import type { RepositoryRef } from '../../../contract/entities.js'
import type { ListFilter, PageOpts } from '../../../contract/inputs.js'
import type { OpResult, PageResult, ReadPageResult } from '../../../contract/results.js'
import { PAGINATION } from '../../../contract/pagination.js'
import { fail } from '../../../kernel/preflight.js'
import { failGitea } from '../errors.js'
import { normalizeIssue } from '../model/normalize.js'
import { scanIssueCounts } from './counts.js'
import { type CtxLike, argsIssueListPage, errMsg, labelsOf, narrowStateOf, parseReadRows, refIdOf, runRead } from '../support/tea-run.js'

/** 游标（页码）解析：非正整数或认不出时回 0（当第 1 页），不报错。 */
function pageOf(cursor: string | null | undefined): number {
  if (typeof cursor !== 'string' || !cursor.trim()) return 0
  const n = Number(cursor)
  if (!Number.isInteger(n) || n < 1) return 0
  return n
}

/** 每页行数：缺省 50，夹在 1..min(limitMax, maxPerPage)。 */
function limitOf(opts: PageOpts | null | undefined): number {
  const requested = opts && typeof opts.limit === 'number' && Number.isFinite(opts.limit) ? Math.floor(opts.limit) : PAGINATION.gitea.limitDefault
  const cap = Math.min(PAGINATION.gitea.limitMax, PAGINATION.gitea.maxPerPage)
  return Math.max(1, Math.min(requested, cap))
}

// filter.state 归一收在 ../support/tea-run.ts 一处（票 #14 评审收编，与 counts.ts 同一份）。

/**
 * 翻页读一页票（契约 listPage）：创建时间倒序是 tea --output json 列表的次序（远端口径），
 * 本地不再重排；nextCursor 只有「这一页取满了」才给下一页码，否则 null。
 *
 * @param repo 目标仓库（只取 refId）
 * @param filter 过滤（state 交远端 + 本地收窄、labels 交远端；其余由宿主二次过滤）
 * @param opts 分页选项（cursor 页码、limit 每页行数）
 * @param ctx 调用上下文（opCtx 缺时顶上）
 */
export async function listPage(
  repo: Partial<RepositoryRef> | null | undefined,
  filter: ListFilter | null | undefined,
  opts: PageOpts | null | undefined,
  ctx: OpContext | null | undefined,
  opCtx?: BackendContext,
): Promise<ReadPageResult> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const refId = refIdOf(repo)
  if (!refId) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'listPage: repo.refId 缺失，无法向 Gitea 翻页读票', '')
  const limitRows = limitOf(opts)
  // 游标就是页码本身（1 起）；缺了或认不出按第 1 页。
  const page = pageOf(opts && typeof opts.cursor === 'string' ? opts.cursor : undefined) || 1
  // state 交给远端：显式要 all 防止 tea 默认只回 open（与 list 同一条防线）。
  const state = narrowStateOf(filter) || 'all'
  const labels = labelsOf(filter)
  try {
    const res = await runRead(effective, argsIssueListPage(refId, state, labels, limitRows, page))
    if (res.code !== 0) {
      return failGitea(new Error(res.stderr || res.stdout || 'listPage: tea issues ls 失败'), '翻页读票失败：tea issues ls 没有跑成。请稍后重试。', res, effective)
    }
    const text = typeof res.stdout === 'string' ? res.stdout : ''
    const rows = parseReadRows(text)
    // 原文 = 远端回的那一段。
    if (!rows) return fail(ERROR_KIND.PARSE as ErrorKind, 'listPage: tea 回包不是插件预期的数组形状', text)
    const items = rows.map((raw) => normalizeIssue(raw))
    const data: PageResult = {
      items,
      // 只有满页才可能有下一页；空页/短页都是尽头。
      nextCursor: rows.length >= limitRows ? String(page + 1) : null,
      // total 只在第一页（游标为空）时数一遍——后面每页都数一遍是白花出站请求。
      total: page === 1 ? await totalOf(effective, refId, filter, labels) : pageTotalOf(page, limitRows),
    }
    return { ok: true, data }
  } catch (err: unknown) {
    return failGitea(err, errMsg(err), err, effective)
  }
}

/**
 * 第一页要交全仓 total：走 counts 的同一份扫描，按 filter.state 同口径收窄。
 * 扫不到就整条失败——不许拿「这一页的行数」冒充总数。
 */
async function totalOf(effective: CtxLike | null | undefined, refId: string, filter: ListFilter | null | undefined, labels: string[]): Promise<number> {
  const narrow = narrowStateOf(filter)
  const scan = await scanIssueCounts(effective, refId, labels)
  if (!scan.ok) throw new Error(scan.kind === 'transport' ? errMsg(scan.err) : scan.text)
  if (narrow === 'closed') return scan.closed
  if (narrow === 'open') return scan.open
  return scan.open + scan.closed
}

/** 第 2 页起不再数全仓：total 只交「到本页为止的行数下界」，契约以第一页的值为准。 */
function pageTotalOf(page: number, limitRows: number): number {
  return page * limitRows
}
