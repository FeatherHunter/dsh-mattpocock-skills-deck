/**
 * src/tracker/rooms/github/read/labels.ts —— 标签颜色的读侧：列出仓库的全部标签（契约操作 listLabels）。
 *
 * #1686 阶段 1 从房间根的 label-colors-ops.ts 拆出：那个文件混着两条契约操作——读侧的 listLabels（本文件）
 * 与写侧的 setLabelColors（还留在旧文件里，等 #1687 搬进 write/）。拆出只是换位置：命令形状、失败档位、
 * 话术与上限判定一字未改；旧路径仍可导入（label-colors-ops.ts 继续转发本文件）。
 *
 * 三个容易踩的点（都在 research/612-github-label-write.md 里有实测）：
 *   一、gh label list 默认只回 30 条，不传 --limit 时标签多的仓库会静默少一截 —— 所以要传，而且
 *       拿到「正好等于上限」的条数时当作「可能没拿全」，整条操作失败。
 *   二、「没登录」的退出码是 4（不是 1，见 gh help exit-codes），所以只认退出码、不靠文案巧合。
 *   三、宿主递过来的仓库标识（repo.refId）常常是空的，所以拿不到时自己再解析一次（见 resolveRepoTarget）。
 *
 * 契约（#627 定版，正文见 src/host/tracker/contract.js 的「标签配色契约」一节）：
 *   listLabels(repo, ctx) → {ok:true, data: LabelColor[]}，每条只有 name / color / 可选 description。
 * 列标签取不全时必须整体失败，不许把残缺清单当全量发出去。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { OpContext } from '../../../contract/contexts.js';
import type { LabelColor, RepositoryRef } from '../../../contract/entities.js';
import { PAGINATION } from '../../../contract/pagination.js'
import type { OpResult, TrackerError } from '../../../contract/results.js';
import { normalizeColor } from '../../../../shared/label-color/src/colors.js'
import { fail } from '../../../kernel/preflight.js'
import { ghClient } from '../transport/client.js'
import { ghFailureMessage, ghVerdictOf } from '../support/errors.js'
import { parseRepo } from '../labels.js'
import { getRepoKey } from '../model/repo.js'

/** gh 执行器的形状（client 房的 ghClient 回什么就是什么，这里只借它的类型）。 */
type GhClient = ReturnType<typeof ghClient>;
// 为什么不断言判空：catch 出来是 unknown，直接读 message/stderr/raw/code 会报缺成员；
// 转成袋后读法与原来一致，运行时不变。
export function errBag(err: unknown): Record<string, unknown> {
  return (err && typeof err === 'object' ? err : {}) as Record<string, unknown>;
}

/** 一次最多向 gh 要多少条标签。标签数达到这个数就当作「可能没拿全」，整条操作失败。 */
export const LABEL_LIST_LIMIT = PAGINATION.github.labelListLimit

function repoSpec(repo: RepositoryRef): string | null {
  const parsed = parseRepo(repo)
  if (!parsed) return null
  return parsed.owner + '/' + parsed.name
}

/** 这次要动的仓库是哪个（`owner/name`）。
 *
 *  为什么不能只看宿主递过来的 repo.refId：#620 整改实测（D1）——**真实工作区里它常常是空的**。
 *  注册表出 RepositoryRef 时只认显式给的 refId（views.ts 的骨架回退对非本地后端回空串），
 *  「用户选定后端」那一步也没人给过 owner/name；于是这里一路空下去，两条操作在真仓库上
 *  **一律报「仓库不存在」、一条 gh 命令都发不出去**（fail-closed，不会改错仓库，但功能等于没接上）。
 *  所以拿不到时照本房间既有的三层兜底自己解析一次：git remote → .git/config → gh repo view
 *  （repo.js 的 getRepoKey，快照侧用的是同一个方法，口径一致）。 */
export async function resolveRepoTarget(repo: RepositoryRef, ctx: OpContext): Promise<{ spec: string } | null> {
  const spec = repoSpec(repo)
  if (spec) return { spec: spec }
  const cwd = ctx && typeof ctx.cwd === 'string' ? ctx.cwd : ''
  if (!cwd) return null
  // 为什么显式标：两条分支（解析到 / 没解析到）都往里装，编译器判成隐式 any；装的本来就是仓库钥匙或空，运行时还是原来那个值。
  let key: { owner: string; name: string } | null = null
  try { key = await getRepoKey(cwd, ctx) } catch (e) { key = null }
  if (key && key.owner && key.name) return { spec: key.owner + '/' + key.name }
  return null
}

/** 认不出仓库时对用户说的话（这是用户在界面上会看到的那一句）。 */
export function noRepoTarget(opCn: string): string {
  return opCn + '时未能确定这个工作区属于哪个 GitHub 仓库。'
    + '请先为本机配置一个指向 GitHub 的远端仓库，并在面板中选定该仓库，然后重试。'
    + '若 Git 远端与插件登录状态都已就绪仍出现这一句，请把这一句原文报告给插件维护者。'
}

/** 一条进给用户的错误：契约里 applied/failed 的 reason 就是失败形状 TrackerError —— kind + message + raw。
 *  raw 是原文段，界面能展开看（#1111）；取法走跟踪器层唯一那套（多路合并、遮蔽凭据、头尾截断），
 *  与 fail() 完全一致 —— 逐条失败这里**不能**只写 kind 与 message，否则界面上的「原始说明」永远是空的。

/** gh 报错原文只当证据用：截一段附在中文说明后面，太长就标已截断。 */
export function rawHint(err: unknown): string {
  const eb = errBag(err);
  const t = String((eb && (eb.message || eb.stderr)) || '').trim().replace(/\s+/g, ' ')
  if (!t) return ''
  return '（gh 返回的说明：' + (t.length > 160 ? t.slice(0, 160) + '…（已截断）' : t) + '）'
}

// ── 列标签 ───────────────────────────────────────────────────────────────────

/** 列出这个仓库的全部标签与颜色（契约操作 listLabels）。
 *  「全部」＝仓库标签全量（含还没被任何票用到的）；取不全就整体失败，不返回残缺清单。 */
export async function listLabels(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<LabelColor[]>> {
  try {
    const c = ghClient(ctx)
    const target = await resolveRepoTarget(repo, ctx)
    // 原文段交的是调用方给进来的那个仓库标识：这是当场能证明「没有可用目标」的那个值。
    // （原来这里多传了一个 repo 给 noRepoTarget，它只收一个字，多传的本来就被忽略，去掉后行为不变。）
    if (!target) return fail(ERROR_KIND.NOTFOUND, noRepoTarget('列标签'), String((repo && repo.refId) || repo || ''))
    const r = await c.execGh(
      ['label', 'list', '--repo', target.spec, '--json', 'name,color,description', '--limit', String(LABEL_LIST_LIMIT)],
      { cwd: ctx && ctx.cwd }
    )
    if (!r.ok) return listFailure(r.error, ctx)
    const text = (r.data && r.data.stdout) || ''
    // 为什么标成未知：回包是 gh 回的任意形状，数组检查通过前不敢当数组用；检查通过后 Array.isArray 会收窄，读法与原来一致。
    let arr: unknown = null
    try { arr = JSON.parse(text) } catch (e) {
      // 原文交的是这次 gh 的完整产出（不是解析失败那句话）：人自己就能看出回包里到底是什么。
      return fail(ERROR_KIND.ENV, '未能获取全部标签：插件没有读懂 GitHub 助手（gh）返回的内容。这是插件运行环境的问题，不是你的操作有误。请稍后重试。', r.data)
    }
    if (!Array.isArray(arr)) {
      return fail(ERROR_KIND.ENV, '未能获取全部标签：插件没有读懂 GitHub 助手（gh）返回的内容。这是插件运行环境的问题，不是你的操作有误。请稍后重试。', r.data)
    }
    if (arr.length >= LABEL_LIST_LIMIT) {
      // 说「超过了上限」时的原文就是这份回包：人可以直接数出到底有多少条、都是些什么名字。
      return fail(ERROR_KIND.ENV, '未能获取全部标签：这个仓库的标签总数超过了插件一次能读取的上限（' + LABEL_LIST_LIMIT + ' 条），无法确认是否读全。请先在 GitHub 的仓库页面里改名或删除不再需要的标签，然后重试。', r.data)
    }
    // 为什么用带断言的过滤：归一函数只回「合格项或空」，Boolean 滤掉的本来就只有空；断言只为过编译，交出去的还是原来那几项，运行时不变。
    return { ok: true, data: arr.map(toLabelColor).filter((x): x is LabelColor => Boolean(x)) }
  } catch (err) {
    const eb = errBag(err);
    const verdict = ghVerdictOf(err, ctx)
    return fail(verdict.kind, ghFailureMessage(verdict, String((eb && eb.message) || err)), err)
  }
}

/** 一条 gh 回的标签 → 契约的列表项。只保留三个键，描述给不了就整个键省掉（给空串也一样算「给不了」）。 */
function toLabelColor(raw: unknown): LabelColor | null {
  const bag = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!bag || typeof bag.name !== 'string' || !bag.name) return null
  // 为什么先定死契约再补可选键：字面量起手类型里没有 description，后面再补会报缺成员；先标成列表项，可选键自然有位置。
  const item: LabelColor = { name: bag.name, color: normalizeColor(bag.color) || '' }
  if (typeof bag.description === 'string' && bag.description.trim() !== '') item.description = bag.description
  return item
}

/** 列标签失败时的说法：环境类与连不通这两档要带上「未能获取全部标签」这句话（契约要求），其余照实说。
 *  这里每一档的说法都是契约要求逐档写清的整句，所以它自己就是「挑给人看的那句话」，
 *  不再套 `ghFailureMessage`（套上会把同一句「未能识别」的提示说两遍）。 */
function listFailure(err: unknown, ctx: OpContext): { ok: false; error: TrackerError } {
  // 档位一律走本房唯一的判档出口：`err` 已经是 `gh exec` 归一过的失败，`ghVerdictOf` 会原样透传它那一档。
  const kind = ghVerdictOf(err, ctx).kind
  const hint = rawHint(err)
  // 原文段优先交上游已经带着的原文（`err.raw`）；它没带时退回手里那个值。
  const eb = errBag(err);
  const raw = eb && typeof eb.raw === 'string' && eb.raw ? eb.raw : String((eb && eb.message) || err || '')
  if (kind === ERROR_KIND.ENV) return fail(kind, '未能获取全部标签：本机的 GitHub 助手（gh）未能运行。这是插件运行环境的问题，不是你的操作有误。' + hint, raw)
  if (kind === ERROR_KIND.NETWORK) return fail(kind, '未能获取全部标签：无法连接 GitHub（网络不可用或请求超时）。仓库未被修改，请确认网络可用后重试。' + hint, raw)
  if (kind === ERROR_KIND.AUTH) return fail(kind, '未能获取全部标签：GitHub 未通过登录校验（没有登录，或登录已失效）。请先运行 gh auth login 完成登录，然后重试。' + hint, raw)
  if (kind === ERROR_KIND.RATELIMIT) return fail(kind, '未能获取全部标签：GitHub 因请求过于频繁拒绝了这次请求。请稍后重试。' + hint, raw)
  return fail(kind, '未能获取全部标签：读取标签时发生插件未能识别的错误。这是插件运行环境的问题，不是你的操作有误。仓库未被修改，请稍后重试。' + ((eb && eb.message) ? '（gh 返回的说明：' + String(eb.message) + '）' : '（gh 没有返回说明）'), raw)
}
