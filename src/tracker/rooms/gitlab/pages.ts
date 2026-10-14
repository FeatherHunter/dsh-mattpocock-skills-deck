/**
 * src/tracker/rooms/gitlab/pages.ts — GitLab 房的按页取票（契约的 `listPage`，成员表见
 * `src/tracker/contract/operations.ts`，「分页契约」见 `src/tracker/contract/results.ts`，#690 新加）。
 *
 * 契约那一格说的是：一页票面、**按创建时间倒序**、带一个**游标**、并带上**这个筛选口径下的总数**；
 * 游标是给调用方原样回传的不透明字符串，没有下一页就回 null。今天唯一的调用方是客户端的历史页
 * （`src/host/issuePage.js`）：它拿 nextCursor 挂「加载更多」，拿 total 说「共 N 张」。
 *
 * ── 游标就是页码（本文件里唯一一条约定，动它之前先把这三段读完）──────────────────────
 * GitLab REST 走 `page` + `per_page` 这套原生分页，下一页就是 page+1，所以游标直接编成页码字符串
 * （`"1"`、`"2"`…），翻页一次请求到位，不用为分页另建一套数据结构。
 *  · 缺、空串、纯空白 = 第一页（页码 1）；其余必须是十进制正整数，别的写法按「游标已失效」如实失败
 *    （`listPage:cursor`），让界面丢掉游标重取第一页。为什么不宽容地当成第一页：用户明明在翻第 5 页
 *    却回到了第 1 页，比报错难查得多。
 *  · **同一个页码只在同一个每页行数下才有意义**：页码的边界是「第 (页码-1)×每页行数 行」。今天唯一的
 *    调用方整条链用同一个常量页大小，所以现网安全；将来若有调用方翻同一条链时改 opts.limit，
 *    页与页之间就会漏行或少行，而远端不会报错。要根治得把每页行数也编进游标（那是改游标格式），
 *    先如实写在这里。
 *
 * ── 总数怎么来：调同房的 counts，不另拼一份数法 ──────────────────────────────────
 * 总数 = 同口径下 `counts` 那一条读回来的 total（同一个筛选、同一处归一、同一个字段映射）。
 * 为什么不自己数：这一页最多 100 行，数出来的是「这一页有几行」，不是总数；响应头在本房的 glab
 * 缝上也拿不到（见 `./counts.ts` 文件头）。代价照实说：**每条读多一次 issues_statistics 请求**
 * （翻十页就多问十次；本房不缓存，缓存层在编排层，G5）。counts 失败时整条读失败，失败类别原样透传
 * （真实原因可能是认证/网络/远端报错，改成 parse 会把真诊断盖掉），不返回一份「有行、没总数」的
 * 半成品 —— 契约那一格要求每页都带总数，缺了就是没读到。
 *
 * ── 排序与筛选 ────────────────────────────────────────────────────────────────
 * `order_by=created_at` 与 `sort=desc` 每次都显式写上：文档给的默认值就是这两个，但默认值是文档的
 * 承诺、不是我方的约定，而「创建时间倒序」正是这一条读的全部意义，写死它就不给远端改默认值的机会。
 * `scope=all` 也显式写（理由同 `./counts.ts`）。`state` / `labels` 与 `./issues.ts` 的列票同一口径
 * （labels 逗号分隔、远端按 AND 筛），行形状也来自同一个 `./normalize.ts`，所以历史页里的一行与
 * 面板列票里的一行是同一套字段。
 *
 * 判档与选话走本房唯一的出口 `./errors.ts` 的 `failGlab`；「命令成功了、这一页仍然取不成」的几条路
 * 各自在返回前落一行 `read.degraded`，reason 只取本房已登记的值（`./read-log.ts`）：
 * `listPage:repo-ref` / `listPage:cursor` / `listPage:transport` / `listPage:json` / `listPage:shape` /
 * `listPage:total`。日志只从 `./read-log.ts` 那个出口走，本文件不直接 `ctx.logEvent`。
 * 某一行归一不成一张票时**整页失败**（理由 `listPage:shape`，原文给那一行）：本房的口径是
 * 「取不全就整体失败，不返回残缺清单」（`./labels-ops.ts` 的 listLabels 同一条）；丢掉那一行接着回，
 * 人看到的是「历史少了中间几张」，既不报错也无处查。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { OpContext } from '../../contract/contexts.js'
import type { Issue, RepositoryRef } from '../../contract/entities.js'
import type { ListFilter, PageOpts } from '../../contract/inputs.js'
import type { OpResult, PageResult } from '../../contract/results.js'
import { fail } from '../../preflight.js'
// 总数不自己拼：直接调同房 counts 那一条读（同一份口径、同一处归一）。
import { counts } from './counts.js'
import { glabClient } from './client.js'
import { failGlab } from './errors.js'
import { normalizeIssue } from './normalize.js'
import { issuesPath } from './queries.js'
import { emitReadDegraded } from './read-log.js'

// 契约的分页口径：缺省一页 50 张、要多了按 200 封顶（`contract/results.ts` 的「分页契约」，与 GitHub 房同一套）。
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
// GitLab REST 的 per_page 上限（官方文档：默认 20、上限 100；本房 `labels-ops.ts` 顶上同一个常数、同一个出处）。
// 为什么不能照 200 去问：远端会把 200 自己截到 100，而我们还以为这一页的大小是 200 —— 一页 100 行就成了
// 「比 per_page 少」，于是把「还有下一页」误判成到底，历史从这儿少一段，而且没有任何报错。
// 代价照实说：调用方要 200 行时这一趟只回 100 行 + 一个游标，接着翻就是（要多了按上限给，不是报错）。
const MAX_PER_PAGE = 100
// 一趟读等远端的时限：与房内 list 那条同一档（10 秒）。
const TIMEOUT_MS = 10000

// 入参只取识别要用的那几格：调用方可能拿半份仓库标识、半份筛选或半份分页选项进来。
type RepoLike = Partial<RepositoryRef> | null | undefined
type FilterLike = Partial<ListFilter> | null | undefined
type PageOptsLike = Partial<PageOpts> | null | undefined
type Bag = Record<string, unknown>

function asBag(v: unknown): Bag | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return v as Bag
}

/**
 * 从 `repo.refId` 取 GitLab 的项目全路径，拿不到回 null（判法与理由与 `./counts.ts` 同名函数一字不差）。
 *
 * 两条读各留一份判法，是为了让「这条读的入参口径」在它自己的文件里读得完：改一条的口径不会悄悄
 * 改到另一条（GitHub 房的两条读也是这么分的）。
 */
function fullPathOf(repo: RepoLike): string | null {
  const refId = typeof repo?.refId === 'string' ? repo.refId.trim() : ''
  if (!refId) return null
  if (/\s/.test(refId)) return null
  if (refId.startsWith('/') || refId.endsWith('/') || refId.includes('//')) return null
  if (/^[0-9]+$/.test(refId)) return refId
  return refId.includes('/') ? refId : null
}

/** filter.state 归一：契约说的 'open' 送到远端要写成 'opened'（GitLab 的写法），'closed' 同名。 */
function stateOf(filter: FilterLike): string {
  const state = filter && typeof filter.state === 'string' ? filter.state.trim().toLowerCase() : ''
  if (state === 'open') return 'opened'
  if (state === 'closed') return 'closed'
  return ''
}

/** filter.labels 归一：去掉空白项与重复项，保持原顺序（名字大小写不动，交给远端筛；分隔与 AND 语义见文件头）。 */
function labelsOf(filter: FilterLike): string[] {
  const labels = filter && Array.isArray(filter.labels) ? filter.labels : []
  const out: string[] = []
  for (const label of labels) {
    const name = typeof label === 'string' ? label.trim() : ''
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/**
 * 这一页实际问远端要几行：契约缺省 50、上限 200，再按 GitLab 的 per_page 上限收到 100（见 MAX_PER_PAGE）。
 * 非数字、0、负数、小数这些不入流的写法一律按缺省 50 处理（契约口径：要多了按上限给，不是报错）。
 */
function limitOf(opts: PageOptsLike): number {
  const limit = asBag(opts)?.['limit']
  if (typeof limit !== 'number' || !Number.isFinite(limit) || Math.floor(limit) !== limit || limit <= 0) {
    return DEFAULT_LIMIT
  }
  return Math.min(limit, MAX_LIMIT, MAX_PER_PAGE)
}

/** 游标原文：只认字符串（trim 过），其余形同没给（缺省就是第一页）。 */
function cursorOf(opts: PageOptsLike): string {
  const cursor = asBag(opts)?.['cursor']
  return typeof cursor === 'string' ? cursor.trim() : ''
}

/** 页码：游标是十进制正整数才认；别的写法回 null（上层按「游标已失效」如实失败）。 */
function pageNumberOf(cursor: string): number | null {
  if (!/^[0-9]+$/.test(cursor)) return null
  const page = Number(cursor)
  return Number.isSafeInteger(page) && page >= 1 ? page : null
}

/** 异常对象上的 message；不是 Error 的东西就 String() 一下，消息里要有原话。 */
function msgOf(e: unknown): string {
  const m = (e as { message?: unknown } | null | undefined)?.message
  return typeof m === 'string' && m ? m : String(e)
}

/**
 * 取一页票：创建时间倒序，附这一页的下一页游标与同口径总数。
 *
 * @param repo 目标仓库（只取 refId；数字项目 ID 也认）
 * @param filter 筛选（只认 state 与 labels 两项，其余由宿主侧二次过滤）
 * @param opts 分页选项（cursor 给上一页回的 nextCursor；limit 给每页行数，缺省 50、上限 200）
 * @param ctx 调用上下文（缺 logEvent 就不落日志；缺执行器由 glabClient 按 127 如实回）
 */
export async function listPage(
  repo: RepositoryRef,
  filter: ListFilter | undefined,
  opts: PageOpts | undefined,
  ctx: OpContext,
): Promise<OpResult<PageResult>> {
  const t0 = Date.now()
  const fullPath = fullPathOf(repo)
  if (!fullPath) {
    // 原文 = 这次收到的入参本身：它缺了或形状不对，人自己能看出差在哪。
    emitReadDegraded(ctx, 'listPage', 'listPage:repo-ref', Date.now() - t0)
    return fail(ERROR_KIND.NOTFOUND, 'listPage: 仓库标识缺了或形状不对（项目全路径形如 group/sub/project，也可以是数字项目 ID）', repo)
  }
  const perPage = limitOf(opts)
  const cursor = cursorOf(opts)
  const page = cursor ? pageNumberOf(cursor) : 1
  if (page === null) {
    // 游标认不出来（用户手改过、或换了后端留下别的形状）：原文给这个游标本身，让人看出是它不对。
    emitReadDegraded(ctx, 'listPage', 'listPage:cursor', Date.now() - t0)
    return fail(ERROR_KIND.NOTFOUND, `listPage: 游标已失效，请重新加载（${cursor.slice(0, 200)}）`, cursor)
  }
  const state = stateOf(filter)
  const labels = labelsOf(filter)
  const params = new URLSearchParams()
  // 三个口径参数都显式写死（理由见文件头）：全仓、按创建时间、倒序。
  params.set('scope', 'all')
  params.set('order_by', 'created_at')
  params.set('sort', 'desc')
  if (state) params.set('state', state)
  if (labels.length) params.set('labels', labels.join(','))
  params.set('page', String(page))
  params.set('per_page', String(perPage))
  // 与 ./issues.ts 的列票同一个参数：要让标签带颜色回来（归一之后历史页的标签与面板列票长得一样）。
  params.set('with_labels_details', 'true')
  try {
    const c = glabClient(ctx)
    const r = await c.api(issuesPath(fullPath, params.toString()), {}, { timeout: TIMEOUT_MS })
    if (r.code !== 0) {
      // 原文 = 这一次 glab 调用的进程结果（stderr 里那几句是 glab 或远端的原话）。
      emitReadDegraded(ctx, 'listPage', 'listPage:transport', Date.now() - t0)
      return failGlab(r, r.stderr || r.stdout || 'listPage: glab api issues 失败', r, ctx)
    }
    let rows: unknown
    try {
      rows = JSON.parse(r.stdout || '')
    } catch (e) {
      emitReadDegraded(ctx, 'listPage', 'listPage:json', Date.now() - t0)
      return fail(ERROR_KIND.PARSE, `listPage: 回包不是合法 JSON ${msgOf(e).slice(0, 200)}`, r)
    }
    if (!Array.isArray(rows)) {
      // 原文 = 远端回的那一段（人据此看出返回的到底是什么形状，而不是只被告知「不是数组」）。
      emitReadDegraded(ctx, 'listPage', 'listPage:shape', Date.now() - t0)
      return fail(ERROR_KIND.PARSE, 'listPage: 回包不是一个数组（远端回的不是这个端点的形状）', r.stdout)
    }
    // 总数：调同房 counts 那条读（同一份口径），而不是从这一页或响应头里凑。
    const counted = await counts(repo, filter, ctx)
    if (!counted.ok) {
      // 这一趟的数是另一个子读（counts）拿的，它没拿成就没有总数；失败类别原样透传（可能是认证/网络/
      // 远端报错，改成 parse 会把真诊断盖掉）。行虽然已经取回来了也不返回：契约那一格要求每页都带总数。
      emitReadDegraded(ctx, 'listPage', 'listPage:total', Date.now() - t0)
      return { ok: false, error: counted.error }
    }
    const items: Issue[] = []
    for (const raw of rows) {
      try {
        items.push(normalizeIssue(raw))
      } catch (e) {
        // 一行归一不成票 = 这一页没读全，整页失败（理由 listPage:shape，原文给那一行本身）。
        // 为什么不丢掉那一行接着回：本房的口径是「取不全就整体失败，不返回残缺清单」
        // （见 ./labels-ops.ts 的 listLabels）；丢一行接着回，人看到的是历史少了中间几张，既不报错也无处查。
        emitReadDegraded(ctx, 'listPage', 'listPage:shape', Date.now() - t0)
        return fail(ERROR_KIND.PARSE, `listPage: 有一行归一不成一张票 ${msgOf(e).slice(0, 200)}`, raw)
      }
    }
    // 还有下一页的判据：**远端这一页给了几行**（rows.length）比要的 per_page 少，就是到底了。
    // 这个判据成立的前提是 per_page 不超过远端的硬上限 —— 所以上面先把它收到 100（见 MAX_PER_PAGE）。
    const nextCursor = rows.length >= perPage ? String(page + 1) : null
    return { ok: true, data: { items, nextCursor, total: counted.data.total } }
  } catch (e) {
    // 抛上来的东西交给本房统一的判档出口；这一支没有已登记的降级 reason，所以不落 read.degraded。
    return failGlab(e, msgOf(e), e, ctx)
  }
}

export default { listPage }
