/**
 * src/tracker/rooms/github/write/label-colors.ts — 标签配色契约里批量改色这条写在 GitHub 房间的实现（#620 落地）。
 * #1686 阶段 1：列标签的读侧（listLabels 及其帮手）搬进 read/labels.ts；
 * #1687 阶段 1：本文件从房间根迁入 write/，只剩批量改色（写侧），房间根的同名转发文件已在 #1687 末批删除，行为零变化。
 * 读侧的 listLabels 与 LABEL_LIST_LIMIT 由 read/labels.ts 提供；这里保留旧默认导出面（default 里仍带 listLabels），
 * 只为让还没搬走的调用方行为不变，导出面与拆前逐字一致。
 * 以后谁改它：改「GitHub 上改标签颜色怎么调 gh、失败了落哪一档」的人。
 *
 * 契约（#627 定版，正文见 src/host/tracker/contract.js 的「标签配色契约」一节）：
 *   listLabels(repo, ctx)                → {ok:true, data: LabelColor[]}，每条只有 name / color / 可选 description
 *   setLabelColors(repo, changes, ctx)   → {ok:true, data: {applied, failed}}，逐条记账
 * 两条的共同规矩：颜色统一是不带井号的六位十六进制小写；入参里每一条改动必须恰好出现在
 * applied 或 failed 之一；列标签取不全时必须整体失败，不许把残缺清单当全量发出去。
 *
 * 三个容易踩的点（都在 research/612-github-label-write.md 里有实测）：
 *   一、`gh label list` 默认只回 30 条，不传 `--limit` 时标签多的仓库会静默少一截 —— 所以要传，而且
 *       拿到「正好等于上限」的条数时当作「可能没拿全」，整条操作失败。
 *   二、`gh label edit` 的「标签不存在」「仓库不存在」「你没有写权限」返回的是同一句 HTTP 404，
 *       光看错误文本分不开，撞到 404 时得自己再问一次仓库权限（#992 起走单源 helper，
 *       用 `gh api repos/<仓库>` 回包里的 `.permissions` 判，不再用 viewerPermission）。
 *   三、「没登录」的退出码是 4（不是 1，见 `gh help exit-codes`），所以只认退出码、不靠文案巧合。
 *
 * 只改颜色：发出去的命令只有 `gh label edit <名字> --repo <仓库> --color <颜色>`，
 * 不带 `--name`、不带 `--description`，也不建标签、不删标签。
 *
 * 还有一个只有在真机上才看得见的坑（#620 整改 D1）：宿主递过来的仓库标识（repo.refId）**常常是空的**
 * （注册表出 RepositoryRef 时只认显式给的那一个）。这两条操作因此会自己再解析一次 owner/name
 * （见 resolveRepoTarget），否则在真实 GitHub 工作区上会一律报「仓库不存在」、一条 gh 命令都发不出去。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { OpContext } from '../../../contract/contexts.js';
import type { LabelColorChange, RepositoryRef } from '../../../contract/entities.js';
import type { ErrorKind } from '../../../contract/identity.js';
// #105 labelDefs.write：仓库标签定义改写的常驻结论线（轨迹形状与发射口在 ./write-log.js）。
import { beginWriteTrail, emitLabelDefsWrite } from '../support/write-log.js'
import type { WriteTrail } from '../support/write-log.js';
import type { OpResult, RepoPermissions, TrackerError, LabelColorBatchResult } from '../../../contract/results.js';
import { normalizeColor } from '../../../../shared/label-color/src/colors.js'
import { fail } from '../../../kernel/preflight.js'
import { ghClient } from '../transport/client.js'
import { ghFailureMessage, ghVerdictOf } from '../support/errors.js'
import { readRepoPermissions } from '../read/repo-permissions.js'
import { PAGINATION } from '../../../contract/pagination.js'
// #1686 阶段 1：读侧搬进 read/labels.ts 后，改色这条链里共用的几样帮手仍从那里取（同一份实现，行为不变）。
// 这里多取一个 listLabels 只为保留旧默认导出面（default 里的 {listLabels, setLabelColors}），
// 对外名字由旧路径的转发器继续转给调用方；内部帮手（errBag、resolveRepoTarget 等）不往外漏。
import { errBag, noRepoTarget, rawHint, resolveRepoTarget, listLabels } from '../read/labels.js'

/** gh 执行器的形状（client 房的 ghClient 回什么就是什么，这里只借它的类型）。 */
type GhClient = ReturnType<typeof ghClient>;

/** 同时最多发几个改色请求。官方文档建议串行、每条之间最好隔一秒；并行撞上限流时单条会如实失败、可重试，所以默认直接拉满到上限，调用方仍可用上下文调小。 */
export const WRITE_CONCURRENCY_MAX = PAGINATION.github.labelWriteConcurrencyMax
export const WRITE_CONCURRENCY_DEFAULT = PAGINATION.github.labelWriteConcurrencyDefault

function reason(kind: ErrorKind, message: string, raw: unknown): TrackerError {
  // 失败形状只有一处构造（#1111）：走跟踪器层的 fail()，原文的合并、遮蔽、头尾截断都归它；
  // 这里只把契约要的那三段取出来。这样以后改原文的取法不会漏掉逐条失败这一路。
  return fail(kind, message, raw).error
}

// ── 批量改色 ─────────────────────────────────────────────────────────────────

/** 入参形状把关：不是一批改动就整条失败（落解析档）。
 *  单条的颜色写错不算入参坏掉：那一条落解析档，其余照改。
 *  重名判定按**归一化后的名字**（转小写 + 去掉首尾空格，与「比色前两边都转小写」同口径）：
 *  契约里名字是要原样交给 GitHub 的，而 GitHub 认名字时大小写不敏感、首尾空格也不算数，
 *  只比字节串会让「bug」与「BUG」这种同一批里的同一个标签各发一次命令（#620 整改 D4）。 */
function changesProblem(changes: unknown): string {
  if (!Array.isArray(changes)) return '修改标签颜色需要一批「标签 → 新颜色」的改动，本次收到的内容不是这种格式'
  const seen = new Set<string>()
  for (const ch of changes) {
    if (!ch || typeof ch !== 'object' || Array.isArray(ch)) return '这一批改动中有一条不是「标签 → 新颜色」的格式'
    // 为什么断言：上面刚验过这一条是对象，名字颜色两格下面还要验；断言只为过编译，读的还是原来那几格，运行时不变。
    const bag = ch as { name?: unknown; color?: unknown };
    if (typeof bag.name !== 'string' || !bag.name.trim()) return '这一批改动中有一条未填写标签名'
    if (typeof bag.color !== 'string' || !bag.color.trim()) return '这一批改动中有一条未填写新颜色'
    const key = bag.name.trim().toLowerCase()
    if (seen.has(key)) return '同一批改动里「' + bag.name + '」出现了两次，一个标签在一批中只允许出现一次。标签名比较时不区分大小写、也不计首尾空格，这两类写法在 GitHub 上指向同一个标签。请只保留其中一条，然后重试。'
    seen.add(key)
  }
  return ''
}

/** 这次用几路并发。默认 4 路；调用方要保守可以调小，最多 4 路。 */
function writeConcurrency(ctx: OpContext): number {
  // 为什么断言：并发数是调用方塞在上下文里的调优旋钮，不在操作契约里；断言只为读到它，读法与原来一致，运行时不变。
  const bag = ctx as OpContext & { labelColorConcurrency?: unknown };
  const raw = ctx && typeof bag.labelColorConcurrency === 'number' ? bag.labelColorConcurrency : WRITE_CONCURRENCY_DEFAULT
  if (!Number.isFinite(raw) || raw < 1) return WRITE_CONCURRENCY_DEFAULT
  return Math.min(Math.floor(raw), WRITE_CONCURRENCY_MAX)
}

/** 按并发上限跑一批活，结果按入参顺序放回。
 *  逐条记账的前提是「每条的结果都拿回来」：跑失败的那条自己也返回一个结果，这里不因为某条失败就停。 */
async function runWithLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const lanes = Math.max(1, Math.min(limit, items.length))
  const runners: Promise<void>[] = []
  for (let i = 0; i < lanes; i++) {
    runners.push((async () => {
      for (;;) {
        const idx = next
        next += 1
        if (idx >= items.length) return
        results[idx] = await worker(items[idx], idx)
      }
    })())
  }
  await Promise.all(runners)
  return results
}

/** 改一个标签的颜色：成功给 {ok:true, entry:{name,color}}，失败给 {ok:false, entry:{name,reason}}。
 *  permCache 是本批共用的权限复用位（#992：10 个标签同时撞 404 也只真问一次仓库权限）。 */
async function applyOne(c: GhClient, spec: string, ch: LabelColorChange, ctx: OpContext, permCache: Map<string, Promise<RepoPermissions | null>>, trail: WriteTrail): Promise<{ ok: boolean; entry: { name: string; color?: string; reason?: TrackerError } }> {
  const want = normalizeColor(ch.color)
  if (!want) {
    // 这条是本插件自己先拦下来的：颜色还没送到 gh 就被判为不合格，所以没有任何后端原文可交，
    // 第三段如实给空串（不能把用户自己填的颜色当成「原始说明」回显，那是假的出处）。
    return { ok: false, entry: { name: ch.name, reason: reason(ERROR_KIND.PARSE, '「' + ch.name + '」的新颜色不正确：请改为不带井号的六位十六进制，例如 9d7cd8。', '') } }
  }
  // 真发出去了才算一条写命令（route 在这里改口，一条都没发时它保持 none）；成没成由这一条的结果说。
  trail.route = 'rest'
  trail.written += 1
  const r = await c.execGh(['label', 'edit', ch.name, '--repo', spec, '--color', want], { cwd: ctx && ctx.cwd })
  if (r.ok) return { ok: true, entry: { name: ch.name, color: want } }
  trail.failed += 1
  return { ok: false, entry: { name: ch.name, reason: await explainWriteFailure(c, spec, ch, r.error, ctx, permCache) } }
}

/** 批量改标签颜色（契约操作 setLabelColors）：对外入口。
 *  建一趟轨迹、交给内层干、出口按 #105 `labelDefs.write` 记一行结论 —— 事后能回答「这次要动几个、真改上几个」。
 *  逐条记账、中途失败不回滚（GitHub 没有一次改 N 个标签颜色的接口，改到一半失败必然留半成品）。 */
export async function setLabelColors(repo: RepositoryRef, changes: LabelColorChange[], ctx: OpContext): Promise<OpResult<LabelColorBatchResult>> {
  const t0 = Date.now()
  const trail = beginWriteTrail()
  // 打算动几个：入参里有几条就记几条（格式不合格也照记，结论那一格会说清是为什么一条都没动手）。
  trail.planned = Array.isArray(changes) ? changes.length : 0
  const r = await setLabelColorsInner(repo, changes, ctx, trail)
  emitLabelDefsWrite(ctx, trail, r, t0)
  return r
}

/** 批量改标签颜色的本体（对外名字与行为都在上面那个入口上）。 */
async function setLabelColorsInner(repo: RepositoryRef, changes: LabelColorChange[], ctx: OpContext, trail: WriteTrail): Promise<OpResult<LabelColorBatchResult>> {
  try {
    const bad = changesProblem(changes)
    // 入参不合格时手里还没有任何外部原文，原文就交那份不合格的改动清单本身。
    if (bad) return fail(ERROR_KIND.PARSE, bad, changes)
    const target = await resolveRepoTarget(repo, ctx)
    // （noRepoTarget 只收一个字：原来多传的 repo 本来就被忽略，去掉后行为不变。）
    if (!target) return fail(ERROR_KIND.NOTFOUND, noRepoTarget('修改标签颜色'), repo)
    if (changes.length === 0) return { ok: true, data: { applied: [], failed: [] } }
    const c = ghClient(ctx)
    // #992：本批共用的权限复用位 —— 撞到 404 才问仓库权限，且一批里只真问一次
    //   （改色链现状是 10 个标签撞 404 就问 10 次）。作用域只活这一批，跑完即弃。
    // 为什么按这个形状标：与权限 helper 那一边的复用位是同一个 Map（键是仓库标识、值是那一次权限查询），两边对上才复用得起来。
    const permCache = new Map<string, Promise<RepoPermissions | null>>()
    // 逐条兜底（#620 整改 D5）：某一条上冒出意外异常时，只把这一条记成失败，其余照跑。
    //   不这么写的话：异常会冒到外面那个整批 catch，**已经改好的标签一条都不记账**，
    //   违反契约的「入参里每一条改动必须恰好出现在 applied 或 failed 之一」。
    const results = await runWithLimit(changes, writeConcurrency(ctx), async (ch) => {
      try {
        return await applyOne(c, target.spec, ch, ctx, permCache, trail)
      } catch (e) {
        return {
          ok: false,
          entry: {
            name: ch.name,
            reason: reason(ERROR_KIND.ENV, '修改「' + ch.name + '」的颜色时插件运行出错。这是插件运行环境的问题，不是你的操作有误；同一批中的其它标签仍会继续修改。', e),
          },
        }
      }
    })
    // 为什么两边分开标：契约的记账结果就是「改成的」与「没改成的」两摞（applied 只留名与色、failed 留名与三段式原因），与 LabelColorBatchResult 一一对应。
    const applied: { name: string; color: string }[] = []
    const failed: { name: string; reason: TrackerError }[] = []
    for (const r of results) {
      if (!r) continue
      // 为什么不断言：成功项只带颜色、失败项只带原因（两边键本来就不一样），各推各的那一摞；推的还是原来那一项，运行时不变。
      if (r.ok) applied.push(r.entry as { name: string; color: string })
      else failed.push(r.entry as { name: string; reason: TrackerError })
    }
    return { ok: true, data: { applied: applied, failed: failed } }
  } catch (err) {
    // 判档只走本房唯一的出口（`ghVerdictOf`）：档位由规则表判、话术按票面实现决定第 11 条挑。
    const eb = errBag(err);
    const verdict = ghVerdictOf(err, ctx)
    return fail(verdict.kind, ghFailureMessage(verdict, String((eb && eb.message) || err)), err)
  }
}

/** 一条改动没改成时，它该落契约八档里的哪一档、对用户说什么。
 *  顺序按「能确定程度」排：先看退出码（没登录只靠退出码 4 认），再看 gh 的报错原文。 */
async function explainWriteFailure(c: GhClient, spec: string, ch: LabelColorChange, err: unknown, ctx: OpContext, permCache: Map<string, Promise<RepoPermissions | null>>): Promise<TrackerError> {
  const eb = errBag(err);
  const code = eb && typeof eb.code === 'number' ? eb.code : null
  const hint = rawHint(err)
  // 档位一律由本房唯一的判档出口给（上游已经归好的档，它会原样透传）；下面每一条只是把同一档
  // 换成一句能给用户看的说法，不再自己拿正则判第二遍 —— 判档只有一张表。
  const kind = ghVerdictOf(err, ctx).kind
  // ① 没登录：gh 自己的约定（gh help exit-codes：需要登录 = 退出码 4）。这条事实在本房扩展表里
  //    也写着、指向同一档 auth；这里再看一眼退出码，只是为了挑「未登录」那句更具体的说法。
  if (code === 4) {
    return reason(ERROR_KIND.AUTH, 'GitHub 未登录，因此无法修改「' + ch.name + '」的颜色：请先运行 gh auth login 登录账号，然后返回保存。本次「' + ch.name + '」的颜色未改动。', err)
  }
  // ② 限速：403 或 429 带 rate limit 文案（官方文档：次限速也走这两个状态码）
  if (kind === ERROR_KIND.RATELIMIT) {
    return reason(ERROR_KIND.RATELIMIT, 'GitHub 因请求过于频繁拒绝了这次请求。请稍后重新保存。本次「' + ch.name + '」的颜色未改动。', err)
  }
  // ③ 凭据被拒 / 权限不足
  if (kind === ERROR_KIND.AUTH) {
    return reason(ERROR_KIND.AUTH, 'GitHub 返回登录凭据无效（可能已过期或被撤销）：请重新运行 gh auth login 登录后再保存。本次「' + ch.name + '」的颜色未改动。' + hint, err)
  }
  // ④ 颜色被 API 拒（422）：实测原文是两行「HTTP 422: Validation Failed」加「Label.color is invalid」，
  //    本房扩展表把这种写法归解析档。
  if (kind === ERROR_KIND.PARSE) {
    return reason(ERROR_KIND.PARSE, 'GitHub 拒绝了「' + ch.name + '」的新颜色：颜色需为不带井号的六位十六进制（例如 9d7cd8）。请改为正确写法后重新保存。' + hint, err)
  }
  // ⑤ 404：三种情况（标签不存在 / 仓库不存在 / 没有写权限）长得一模一样，只能再问一次仓库权限。
  if (kind === ERROR_KIND.NOTFOUND) return await explain404(c, spec, ch, ctx, hint, permCache, err)
  // ⑥ 其余各档照实说。
  if (kind === ERROR_KIND.ENV) return reason(ERROR_KIND.ENV, '修改「' + ch.name + '」的颜色时，本机的 GitHub 助手（gh）没有给出答复，因此无法确认这一条的颜色是否已经改动。这是插件运行环境的问题，不是你的操作有误。请用 gh label list 核对后再重试。' + hint, err)
  if (kind === ERROR_KIND.NETWORK) return reason(ERROR_KIND.NETWORK, '修改「' + ch.name + '」的颜色时无法连接 GitHub（网络不可用或请求超时），插件没有拿到 GitHub 的答复，因此无法确认这一条的颜色是否已经改动。请确认网络可用，并用 gh label list 核对后再重试。' + hint, err)
  return reason(kind, '修改「' + ch.name + '」的颜色时发生插件未能识别的错误。插件无法确认这一条的颜色是否已经改动，请用 gh label list 核对后再重试；若仍然失败，请把这一句原文报告给插件维护者。' + ((eb && eb.message) ? '（gh 返回的说明：' + String(eb.message) + '）' : '（gh 没有返回说明）'), err)
}

/** 撞到 404 时多问一次仓库权限，把「标签或仓库不存在」与「你没有写权限」分开。
 *  按 #612 实测：有仓库写权限却 404 → 标签或仓库真的不存在；权限只有读 → 就是没有写权限。
 *  #992：判据从 viewerPermission 换成 .permissions（单源 helper，批内只真问一次）。
 *  改标签定义要的是 push，所以这里看 push，不看 triage。 */
async function explain404(c: GhClient, spec: string, ch: LabelColorChange, ctx: OpContext, hint: string, permCache: Map<string, Promise<RepoPermissions | null>>, err: unknown): Promise<TrackerError> {
  const perm = await readRepoPermissions(c, spec, ctx, permCache)
  if (perm && perm.push === false) {
    return reason(ERROR_KIND.AUTH, '当前账号在「' + spec + '」上没有写权限（只能读取），因此无法修改标签。本次「' + ch.name + '」的颜色未改动，请换用有写权限的账号，或请仓库管理员为该账号授予写权限，然后重试。', err)
  }
  if (perm && perm.push === true) {
    return reason(ERROR_KIND.NOTFOUND, '这个仓库中没有名为「' + ch.name + '」的标签。请先核对标签名，或先在这个仓库中创建这个标签，然后重新保存。注意：GitHub 上标签名不区分大小写，冒号与空格都算在标签名里。', err)
  }
  return reason(ERROR_KIND.NOTFOUND, '修改「' + ch.name + '」的颜色时 GitHub 报告找不到这个标签，插件也无法确认当前账号在「' + spec + '」上的权限，因此分不出是标签不存在、仓库名不正确，还是没有写权限。本次「' + ch.name + '」的颜色未改动，请先确认仓库名与标签名正确、账号已登录，然后重试。' + hint, err)
}

export default { listLabels, setLabelColors }
