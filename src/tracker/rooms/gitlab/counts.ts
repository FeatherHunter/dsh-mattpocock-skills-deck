/**
 * src/tracker/rooms/gitlab/counts.ts — GitLab 房的计数读（契约的 `counts`，成员表见
 * `src/tracker/contract/operations.ts`，「计数契约」见 `src/tracker/contract/results.ts`，#689 新加）。
 *
 * ── 这一条只回答「库里符合条件的工单有多少张」，一行票面都不返回 ────────────────────
 * 面板顶上那几个数字原先由客户端数手上那份票池得到，而票池被上限截断过，数字跟着偏（缺陷票 #677）：
 * 数字改成问后端要，截断就与数字无关了。
 *
 * ── 为什么走 `GET /projects/:id/issues_statistics`（讨论票 #1063 的结论路径）──────────
 * 本房取数一律走 glab（`./client.ts`），而它只把 `{stdout, stderr, code}` 三样交回来，
 * **HTTP 响应头在这条缝上根本拿不到**：要拿头得给 `glab api` 加 `-i`，那会把响应头掺进 stdout、
 * 让 JSON.parse 直接崩，本房不加这个参数。所以「顺手用 REST 列表的响应头拿总数」这条路走不通。
 * 改成一次 `issues_statistics` 调用：
 *  · 一次往返就把打开、关闭、全部三个数一起给出来，回包形状是
 *    `{"statistics":{"counts":{"all":20,"closed":5,"opened":15}}}`（GitLab 官方文档
 *    issues_statistics 的「Retrieve issues statistics for a project」一节，2026-10-14 核对）；
 *  · 三个数取自同一份回包，天然是同一时刻的数，不会拼出两个时刻的数字；
 *  · 字段名与契约名**不一样**，映射收在 `counts` 的返回处一处：`open ← opened`、
 *    `closed ← closed`、`total ← all`。照契约名（open / total）去读回包只会读到 undefined，
 *    再被「缺一个就整体失败」那条挡住 —— 结果是读不出数，而不是读出一个错的数。
 *
 * 四件故意不做的事：
 *  · 不数合并请求：这个端点叫 issues statistics，官方文档通篇只说 issue（工单）；GitLab 的
 *    合并请求是另一套资源（merge_requests），不走这个口。**这一条只在文档上对过，没有在真仓库上
 *    量过**（写这一条时不许执行 glab），如实写在这里。
 *  · 不把 state 交给远端收窄：项目级 issues_statistics 的属性表里没有 state 这一格
 *    （它只在文档的 URL 示例里出现过），所以收窄在本地做，算法见 `counts` 返回处那段注释。
 *  · 不缓存（G5 红线）：成功与失败都不进缓存，缓存层在编排层。
 *  · 不拿别的数顶上：三个数里任何一个缺失或不是非负整数，就整体失败（理由 `counts:stat`），
 *    绝不用 0 或「另一个数」凑一个看着像数的东西出来。
 *
 * 判档与选话走本房唯一的出口 `./errors.ts` 的 `failGlab`（判档表在 `src/tracker/error-rules.ts`）；
 * 「命令成功了、这个数仍然拿不到」的几条路各自在返回前落一行 `read.degraded`，reason 只取本房
 * 已登记的取值（`./read-log.ts` 的 READ_DEGRADED_REASONS）：`counts:repo-ref` / `counts:transport` /
 * `counts:json` / `counts:shape` / `counts:stat`。catch 支路没有已登记的 reason，所以那一支不落降级行
 * —— 宁可少记一行，也不新造一个没登记的含义。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { OpContext } from '../../contract/contexts.js'
import type { RepositoryRef } from '../../contract/entities.js'
import type { ListFilter } from '../../contract/inputs.js'
import type { Counts, OpResult } from '../../contract/results.js'
import { fail } from '../../preflight.js'
import { glabClient } from './client.js'
import { failGlab } from './errors.js'
import { projectPath } from './queries.js'
import { emitReadDegraded } from './read-log.js'

// 一趟读等远端的时限：与房内 list 那条同一档（10 秒）。计数是轻请求，但等待仍按整趟算进降级行的耗时。
const TIMEOUT_MS = 10000

// 入参只取识别要用的那几格：调用方可能拿半份仓库标识或半份筛选进来，缺了按「入参不合格」如实回。
type RepoLike = Partial<RepositoryRef> | null | undefined
type FilterLike = Partial<ListFilter> | null | undefined
type Bag = Record<string, unknown>

function asBag(v: unknown): Bag | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return v as Bag
}

/** 失败消息里带上这次收到的仓库标识原文：人一眼能看出差在哪一格（拿不到标识时给空串）。 */
function refIdOf(repo: RepoLike): string {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

/**
 * 从 `repo.refId` 取 GitLab 的项目全路径（形如 `group/sub/project`），拿不到就回 null。
 *
 * 只认 refId、不拿 name 当标识（name 是给界面看的显示名，refId 缺时它就是目录名，拿显示名当
 * 远端路径会打到一个不存在的仓库上）—— name 在上面那个函数里只用于失败消息。
 *
 * 「形状对不对」按远端真能认的两种写法判（`projects/:id` 既收完整路径也收数字项目 ID）：
 *  · 完整路径：至少带一段命名空间（含 `/`），且不以 `/` 开头结尾、不出现 `//`、不含空白；
 *  · 纯数字的项目 ID（例如 `42`）也放行。
 * 单段的名字（例如 `myproject`）不是 GitLab 能定位的标识，在这里就按不合格回：早点说清
 * 「入参不合格」比让它跑成一次 404 之后说「仓库不在」更接近实情。
 */
function fullPathOf(repo: RepoLike): string | null {
  const refId = typeof repo?.refId === 'string' ? repo.refId.trim() : ''
  if (!refId) return null
  if (/\s/.test(refId)) return null
  if (refId.startsWith('/') || refId.endsWith('/') || refId.includes('//')) return null
  if (/^[0-9]+$/.test(refId)) return refId
  return refId.includes('/') ? refId : null
}

/** filter.state 归一：只有 'open' / 'closed' 两种收窄，其余（含缺失）都是「两种都要」。 */
function narrowStateOf(filter: FilterLike): string {
  const state = filter && typeof filter.state === 'string' ? filter.state.trim().toLowerCase() : ''
  return state === 'open' || state === 'closed' ? state : ''
}

/** filter.labels 归一：去掉空白项与重复项，保持原顺序（名字大小写不动，交给远端筛）。 */
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
 * 三个数各自只认「非负整数」这一种形状，别的形状一律当成没拿到（回 null）。
 *
 * 为什么不 Number() 转一下：`"15"` 这种字符串能转出一个看着对的数，但它不是这次接口给的数；
 * `null` / `""` 更会被转成 0。契约「不许猜一个数」在这条路上同样适用 —— 形状不对就整条失败
 * （理由 `counts:stat`），而不是拿一个转出来的数顶上。
 */
function countOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && Math.floor(v) === v ? v : null
}

/** 异常对象上的 message；不是 Error 的东西就 String() 一下，消息里要有原话。 */
function msgOf(e: unknown): string {
  const m = (e as { message?: unknown } | null | undefined)?.message
  return typeof m === 'string' && m ? m : String(e)
}

/**
 * 数一数这个仓库里符合条件的工单有多少张（一行票面都不返回）。
 *
 * 返回的三个数始终是**同一个筛选口径**下的一批票：给了 `filter.state` 就在本地收窄
 * （把不相干的那个数归零，total 取收窄后的那个数），没给就是「打开 + 关闭 = 全部」。
 * 这条口径与 GitHub 房、Markdown 房一致，界面拿到的三个数不会因为后端不同而含义不同。
 *
 * @param repo 目标仓库（只取 refId；数字项目 ID 也认）
 * @param filter 筛选（只认 state 与 labels 两项，其余由宿主侧二次过滤）
 * @param ctx 调用上下文（缺 logEvent 就不落日志；缺执行器由 glabClient 按 127 如实回）
 */
export async function counts(
  repo: RepositoryRef,
  filter: ListFilter | undefined,
  ctx: OpContext,
): Promise<OpResult<Counts>> {
  const t0 = Date.now()
  const fullPath = fullPathOf(repo)
  if (!fullPath) {
    // 原文 = 这次收到的入参本身：它缺了或形状不对，人自己能看出差在哪。
    emitReadDegraded(ctx, 'counts', 'counts:repo-ref', Date.now() - t0)
    return fail(
      ERROR_KIND.NOTFOUND,
      `counts: 仓库标识缺了或形状不对（项目全路径形如 group/sub/project，也可以是数字项目 ID）：${refIdOf(repo)}`,
      repo,
    )
  }
  const narrow = narrowStateOf(filter)
  const labels = labelsOf(filter)
  const params = new URLSearchParams()
  // scope 显式说成 all：项目级 issues_statistics 的属性表没写这个参数的默认值（用户级那条写的是
  // created_by_me），而本后端的数字要的是「全仓的工单」—— 赌一个没写的默认值，就可能把数字悄悄
  // 变成「只算我自己建的票」，人看着还挺合理，查起来极难。
  params.set('scope', 'all')
  // labels 是 AND：逗号分隔的几个标签要同时命中（官方文档 issues 一节对 labels 参数的说明）。
  if (labels.length) params.set('labels', labels.join(','))
  // projectPath 已经对 refId 做过一次 encodeURIComponent，这里不要再编一遍（编两遍会把 %2F 变成 %252F）。
  const path = `${projectPath(fullPath)}/issues_statistics?${params.toString()}`
  try {
    const c = glabClient(ctx)
    const r = await c.api(path, {}, { timeout: TIMEOUT_MS })
    if (r.code !== 0) {
      // 原文 = 这一次 glab 调用的进程结果（stderr 里那几句是 glab 或远端的原话）。
      emitReadDegraded(ctx, 'counts', 'counts:transport', Date.now() - t0)
      return failGlab(r, r.stderr || r.stdout || 'counts: glab api issues_statistics 失败', r, ctx)
    }
    let body: unknown
    try {
      body = JSON.parse(r.stdout || '')
    } catch (e) {
      emitReadDegraded(ctx, 'counts', 'counts:json', Date.now() - t0)
      return fail(ERROR_KIND.PARSE, `counts: 回包不是合法 JSON ${msgOf(e).slice(0, 200)}`, r)
    }
    const statistics = asBag(asBag(body)?.['statistics'])
    const countsBag = statistics ? asBag(statistics['counts']) : null
    if (!countsBag) {
      // 「回包里缺东西」时原文就是这份回包本身（人自己能看出它到底缺了什么）。
      emitReadDegraded(ctx, 'counts', 'counts:shape', Date.now() - t0)
      return fail(ERROR_KIND.PARSE, 'counts: 回包里没有 statistics.counts（远端回的不是这个端点的形状）', r)
    }
    const opened = countOf(countsBag['opened'])
    const closed = countOf(countsBag['closed'])
    const all = countOf(countsBag['all'])
    if (opened === null || closed === null || all === null) {
      emitReadDegraded(ctx, 'counts', 'counts:stat', Date.now() - t0)
      return fail(
        ERROR_KIND.PARSE,
        'counts: 三个数里有缺失或不是非负整数的（拒绝拿别的数或 0 顶上）',
        r,
      )
    }
    // 字段名映射（远端 → 契约）：opened → open、closed → closed、all → total。
    // 收窄在本地做（与 GitHub 房、Markdown 房同一条口径，理由见文件头）：把不相干的那个数归零，
    // total 取收窄后这一批的总数 —— 这样「全部」始终说的是同一个口径下的一批票，
    // 「打开 3 + 关闭 0 = 全部 3」在人眼里也自洽。
    const data: Counts =
      narrow === 'closed'
        ? { open: 0, closed, total: closed }
        : narrow === 'open'
          ? { open: opened, closed: 0, total: opened }
          : { open: opened, closed, total: all }
    return { ok: true, data }
  } catch (e) {
    // 抛上来的东西交给本房统一的判档出口；这一支没有已登记的降级 reason，所以不落 read.degraded。
    return failGlab(e, msgOf(e), e, ctx)
  }
}

export default { counts }
