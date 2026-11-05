/**
 * src/tracker/rooms/gitlab/labels/list.ts —— 仓库标签清单（契约操作 listLabels）。
 *
 * 为什么住在 labels/ 子树（#1916）：标签是一个概念，赋值、清单、配色三条操作都落在这个目录里。
 * 搬进子树之前这条路在房间根目录的 labels-ops.ts；搬完根目录不再留标签实现。
 *
 * 契约（正文见 `src/tracker/contract/operations.ts`，返回形状见 `contract/results.ts`）：
 *   listLabels(repo, ctx) → {ok:true, data: LabelColor[]}，每条只有 name / color / 可选 description。
 * 本文件只负责列清单这一半；改色在 colors.ts。两条的共同约定是：颜色统一是不带井号的六位小写
 * 十六进制；列标签取不全时必须整体失败，不许把残缺清单当全量发出去。
 *
 * 请求形状不在这里：每一页都走房间根目录 requests.ts 的 requestLabelList，method、路径与查询串
 * 在那里只有一个出处；本文件只做拿到原始进程结果之后的事：翻页、解析、归一、按失败分支记
 * `read.degraded`、挑失败档位与话术。行为与搬迁之前逐字一致，包括分页判据与超时档位。
 *
 * ── 为什么列表必须显式关掉上层分组标签（不能删这一条）──────────────────────────
 * 官方文档「List all project labels」的属性表原文是
 *   「| `include_ancestor_groups` | boolean | no  | Include ancestor groups. Defaults to `true`. |」
 * （https://docs.gitlab.com/api/labels/，2026-10-15 照官方文档核实），即**不写它就默认带上上层分组的标签**。
 * 而改色走 `PUT /projects/:id/labels/:label_id`，那个接口只认项目自己的标签——分组标签改不了色（远端回 404）。
 * 契约对 listLabels 的定义是「这个后端**能改色**的全部标签」(`contract/contract-label-colors.ts`），
 * 带上分组标签就是一份超集：界面会把这些标签当成可编辑的，用户一按保存就失败，而本房给出的提示是
 * 「请核对标签名与项目全路径」——名字与路径其实都是对的，人照着这句话核对只会白费劲。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { OpContext } from '../../../contract/contexts.js'
import type { LabelColor, RepositoryRef } from '../../../contract/entities.js'
import { type OpResult } from '../../../contract/results.js'
import { normalizeColor } from '../../../../shared/label-color/src/colors.js'
import { fail } from '../../../kernel/preflight.js'
import { failGlab } from '../errors.js'
import { emitReadDegraded } from '../read-log.js'
// 仓库标识的取法与优先级只在 model/repo-identity.ts 一处（#1910）。
import { repoRefOf } from '../model/repo-identity.js'
// 请求的形状住在房间根目录的 requests.ts（#1916）：列一页标签的端点在那里收口。
import { requestLabelList } from '../requests.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml；请求函数收领域值 timeoutMs，档位由这里按操作选。
import { GITLAB_READ_TIMEOUT_MS } from '../../../../shared/time-config/src/values.js'
import { PAGINATION } from '../../../contract/pagination.js'
import { errText, withRawHint } from './shared.js'

/** 一次向 GitLab 要多少条标签。官方文档：`per_page` 默认 20、**上限 100**。 */
export const LABEL_LIST_PER_PAGE = PAGINATION.gitlab.labelListPerPage

/**
 * 列标签最多翻多少页。
 *
 * 为什么要有这道闸：翻页循环靠回包判下一跳，回包异常（远端一直回满页、或链接头一直说有下一页）
 * 时循环会停不下来，把一趟只读的界面请求变成对远端的持续轰击。到顶就如实失败，
 * 而不是把手上这一批当全量交出去——后者正是契约点名不许做的「静默返回残缺列表」。
 * 100 页 × 每页 100 条 = 10000 条，比真实仓库的标签数高三个数量级，正常仓库碰不到它。
 */
export const LABEL_LIST_MAX_PAGES = PAGINATION.gitlab.labelListMaxPages

/**
 * 一条 GitLab 回的标签 → 契约的列表项。只保留三个键，描述给不了就整个键省掉（给空串也一样算「给不了」）。
 *
 * 颜色这一格必须过 `normalizeColor`：GitLab 回包里是带井号的（文档示例 `"color" : "#d9534f"`），
 * 而契约要求不带井号的六位小写十六进制。归一化正好做「去井号、转小写」两件事，
 * 所以写不出「用户看到大写色值」这种不一致。给不出颜色（空、缺字段、不是合法六位）时写空串——
 * 契约说空串是「这个标签还没配颜色」，那是**空值**，不是失败：整条操作仍然成功。
 */
function toLabelColor(raw: unknown): LabelColor | null {
  const bag = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null
  if (!bag || typeof bag.name !== 'string' || !bag.name) return null
  // 为什么先定死契约再补可选键：字面量起手类型里没有 description，后面再补会报缺成员。
  const item: LabelColor = { name: bag.name, color: normalizeColor(bag.color) || '' }
  if (typeof bag.description === 'string' && bag.description.trim() !== '') item.description = bag.description
  return item
}

/**
 * 列出这个仓库的全部标签与颜色（契约操作 listLabels）。
 * 「全部」＝仓库标签全量（含还没被任何票用到的）；取不全就整体失败，不返回残缺清单。
 */
export async function listLabels(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<LabelColor[]>> {
  const t0 = Date.now()
  const refId = repoRefOf(repo)
  if (!refId) {
    // 原文段交的是调用方给进来的那个仓库标识：这是当场能证明「没有可用目标」的那个值。
    // 连进程都没起，这一步就是这一趟读没读成的原因。
    const raw = String((repo && repo.refId) || '')
    emitReadDegraded(ctx, 'labels', 'labels:repo-ref', Date.now() - t0)
    return fail(ERROR_KIND.NOTFOUND, '未能获取全部标签：这个工作区没有可用的 GitLab 项目标识（形如 group/sub/project），因此无法向 GitLab 查询标签。请先在面板中选定这个工作区对应的 GitLab 仓库，然后重试。', raw)
  }
  const all: LabelColor[] = []
  let page = 1
  // 合同要求「翻页拉到底，中途任何一页失败就整体失败」，所以循环体里任何一条失败分支都是直接 return，
  // 手上已经拿到的那些页在失败时全部丢掉——它们就是「残缺清单」，交出去就是契约点名的那个错误。
  for (;;) {
    // 页码从 1 起（官方文档：`page` 默认 1）；per_page 顶到官方上限 100，少翻几趟。
    // include_ancestor_groups=false 为什么不能删：见本文件顶上的那一段（分组标签改不了色）。
    const res = await requestLabelList(ctx, refId, LABEL_LIST_PER_PAGE, page, GITLAB_READ_TIMEOUT_MS)
    if (res.code !== 0) {
      // 这一档是「房间这层没拿到任何回包」，原文是这一次 glab 调用的完整进程结果。
      emitReadDegraded(ctx, 'labels', 'labels:transport', Date.now() - t0)
      return failGlab(res, '未能获取全部标签：' + withRawHint('向 GitLab 查询标签时命令没有跑成。这是插件运行环境的问题，不是你的操作有误。这次没有拿到任何标签，请稍后重试。', res.stderr || res.stdout || errText(res)), res, ctx)
    }
    const text = typeof res.stdout === 'string' ? res.stdout : ''
    // 为什么标成 unknown：回包是 glab 回的任意形状，数组检查通过前不敢当数组用；检查通过后 Array.isArray 会收窄。
    let arr: unknown = null
    try { arr = JSON.parse(text) } catch {
      // 原文交的是这一趟 glab 的完整产出（不是解析失败那句话）：人自己就能看出回包里到底是什么。
      emitReadDegraded(ctx, 'labels', 'labels:json', Date.now() - t0)
      return fail(ERROR_KIND.ENV, '未能获取全部标签：插件没有读懂 GitLab 助手（glab）返回的内容。这是插件运行环境的问题，不是你的操作有误。请稍后重试。', text)
    }
    if (!Array.isArray(arr)) {
      emitReadDegraded(ctx, 'labels', 'labels:shape', Date.now() - t0)
      return fail(ERROR_KIND.ENV, '未能获取全部标签：GitLab 返回的标签清单不是插件预期的形状。这是插件运行环境的问题，不是你的操作有误。请稍后重试。', text)
    }
    // 为什么断言：上面刚验过它是数组；断言只为让 TS 认这件事实，交出去还是原来那个数组，运行时不变。
    const rows = arr as unknown[]
    for (const row of rows) {
      // 单条形状不合格就当这一趟没读成：列表项只有 name/color/description 三个键，
      // 没有位置能表示「这一条被丢掉了」，静默跳过就会变成用户眼里的「标签凭空少了一个」。
      const item = toLabelColor(row)
      if (!item) {
        emitReadDegraded(ctx, 'labels', 'labels:shape', Date.now() - t0)
        return fail(ERROR_KIND.ENV, '未能获取全部标签：GitLab 返回的标签清单里有一条缺少标签名，插件无法确认这份清单是否完整。这是插件运行环境的问题，不是你的操作有误。请稍后重试。', text)
      }
      all.push(item)
    }
    // 下一页的判据：**这一页的条数 < per_page 就是最后一页**（官方文档按请求的 per_page 截断当前页，
    // 所以只有最后一页会短）。这是任务单点名的口径，也是这家的常规读法。
    //   为什么不用「某页回空表」当唯一哨兵：那样标签总数正好是 per_page 的整数倍时会白翻一页
    //   （多一次出站请求）。两个判据在真实数据上等价，取少花一次请求的那个。
    //   为什么不判响应头里的 rel="next"：官方「Pagination response headers」一节写明，结果超过
    //   10000 条时远端不再返回 x-total、x-total-pages 与 rel="last" 这几个格子；那份清单里并没有
    //   rel="next"，本机也没有真机可核它在那种情况下的行为，所以不拿它当依据。真正决定性的理由是
    //   契约的 `ExecResult`（`contract/contexts.ts`）里根本没有 headers 这一格，
    //   本房读不到它，也就无从判起。
    if (rows.length < LABEL_LIST_PER_PAGE) break
    // 每多翻一页都要有上限兜底，见 LABEL_LIST_MAX_PAGES 的说明。
    if (page >= LABEL_LIST_MAX_PAGES) {
      emitReadDegraded(ctx, 'labels', 'labels:partial', Date.now() - t0)
      return fail(ERROR_KIND.ENV, '未能获取全部标签：这个仓库的标签数量超过了插件一次能读取的上限（' + String(LABEL_LIST_MAX_PAGES * LABEL_LIST_PER_PAGE) + ' 条），无法确认是否读全。请先在 GitLab 的仓库页面里整理不再需要的标签，然后重试。', text)
    }
    page += 1
  }
  return { ok: true, data: all }
}

export default { listLabels }
