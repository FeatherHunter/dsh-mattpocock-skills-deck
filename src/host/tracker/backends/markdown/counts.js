/**
 * backends/markdown/counts.js — 本地 Markdown 后端的计数（counts 操作，#691 里补的这一条）。
 *
 * 这条操作的语义住在 tracker/contract.js 的「计数契约」：只数工单、只回数字不回行、
 * 拿不全就整体失败、绝不猜一个数出来。本地这一侧「该数什么」由 #688 的第一手实测结论定下，
 * 一个字不用再测（下文口径照抄那一条评论的第二、三节）：
 *  - 数「列举会返回的那些票行」：每个工作单元目录 `issues/` 下文件名匹配 `^\d+-.*\.md$` 的文件；
 *    地图容器行（map.md 自己那一行）分开算、不计入票数；notes.md 这类不以编号开头的文件不是票；
 *  - open / closed 按每行归一后的 state 分（票面 `Status:` 行落进 resolved / completed / closed / done
 *    四个词算已关闭，其余算开放；这一步 parse.js 已经做完，这里直接用行数据，不重写一份判定）；
 *  - 作用域按 repo.effortId（与 list 同口径）：给了就只数那一个工作单元，没给就全仓库一起数；
 *  - 票文件读不动（权限不足 / 读到时已被删 / 被别的程序锁住）→ 整体失败，消息里说清是哪个编号的文件。
 *    这一条与 list 故意不同：list 今天读不动就静默少一行（那是既有行为，本票一个字没改），
 *    counts 走「有错就失败」—— 界面把偏小的数当真值显示出来，正是缺陷票 #677 要根治的那类毛病。
 *
 * filter 只认两项，其余字段（type / parentKey / keys / isPullRequest）忽略（契约「计数契约」一节）：
 *  - state  —— 收窄到这一种状态（等价于「先按状态筛，再数」，于是另一种状态计 0）；
 *  - labels —— 必须同时带上这些标签的票（本地票面只写标签名，按名字精确比对）。
 *    ⚠️ 这里有一处与 list 的不一致，写下来免得以后有人以为两边天然对得上：本后端的 list 今天
 *    不认标签筛（既有缺口，不在本票范围内），所以带标签筛问 counts 时，数是筛完的、行是没筛的，
 *    数字会比 list 画出来的行少。真正要「数字与行同源」的是不带标签筛这个日常口径，那条两边一致。
 *
 * 不做也不该做的两件：
 *  - 不吃颜色：数字与标签颜色无关，这里不读配色文件（list 那条路上色是因为要画行）。
 *  - 不缓存任何判定（G5 红线，与 getDependencies 同例）：失败一律如实返回，缓存层在编排层。
 */

import { ERROR_KIND, ISSUE_TYPE, STATE } from '../../../../shared/tracker/constants.js'
import { classifyError } from '../../preflight.js'
import { enumerateIssueRows } from './issues-read.js'

/** filter.state 归一：只有 'open' 与 'closed' 两种收窄，其余（含没给）都是「两种状态一起数」。
 *  导出给 page.js 共用：分页与计数说的必须是同一批票，判定只留这一份。 */
export function narrowStateOf(filter) {
  const s = filter && typeof filter === 'object' ? String(filter.state || '').toLowerCase() : ''
  return (s === STATE.OPEN || s === STATE.CLOSED) ? s : ''
}

/** filter.labels 归一（导出给 page.js 共用）：去掉空白项与重复项，保持原顺序（与 GitHub 那条同一口径）。 */
export function labelsOf(filter) {
  const raw = filter && typeof filter === 'object' ? filter.labels : null
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = {}
  for (const v of raw) {
    const name = typeof v === 'string' ? v.trim() : ''
    if (!name || seen[name]) continue
    seen[name] = true
    out.push(name)
  }
  return out
}

/** 一张票是不是同时带上了要求的全部标签（导出给 page.js 共用；本地票面只写标签名，按名字精确比对）。 */
export function hasAllLabels(row, wanted) {
  if (!wanted.length) return true
  const names = []
  const list = row && Array.isArray(row.labels) ? row.labels : []
  for (const lab of list) if (lab && lab.name) names.push(String(lab.name))
  for (const name of wanted) if (!names.includes(name)) return false
  return true
}

/** 把「读不动的票文件」清单拼成一句人看得懂的话（导出给 page.js 共用）：说清是哪几个编号、哪个文件、哪一档错。 */
export function readFailureMessage(errors) {
  const parts = errors.map(function (e) { return String(e.key) + '（' + String(e.path) + '）' })
  const first = errors[0] || {}
  return '本地 Markdown 有票文件读不动，数字不完整，拒绝回一个偏小的数：' + parts.join('、') +
    '（' + String(first.kind || '') + '：' + String(first.message || '') + '）'
}

/**
 * counts(ctx, repo, filter) → `{ok:true, data:{open,closed,total}}` 或 `{ok:false, error:{kind,message}}`。
 * 枚举那一段与 list 共用同一份实现（见 issues-read.js 的 enumerateIssueRows），
 * 这里只做三件事：有票文件读不动就整体失败、按状态数票行、按 filter 的两项收窄。
 */
export async function countIssues(ctx, repo, filter = {}) {
  try {
    // 契约说 counts 只认 state 与 labels，keys 这类字段一律忽略 —— 所以枚举时不带 keys 过去，
    // 免得多出来的行提前被跳过、数字比实际票数小；effortId 照旧透传，作用域与 list 同口径。
    const scopeFilter = { effortId: filter && filter.effortId }
    const { rows, errors } = await enumerateIssueRows(ctx, repo, scopeFilter, { collectErrors: true })
    if (errors.length) {
      const kind = errors[0].kind || ERROR_KIND.ENV
      return { ok: false, error: { kind, message: readFailureMessage(errors) } }
    }
    const wanted = labelsOf(filter)
    let open = 0
    let closed = 0
    for (const row of rows) {
      if (!row || row.type === ISSUE_TYPE.MAP) continue // 地图容器行分开算，不计入票数
      if (!hasAllLabels(row, wanted)) continue
      if (row.state === STATE.CLOSED) closed++
      else open++
    }
    const narrow = narrowStateOf(filter)
    const openOut = narrow === STATE.CLOSED ? 0 : open
    const closedOut = narrow === STATE.OPEN ? 0 : closed
    return { ok: true, data: { open: openOut, closed: closedOut, total: openOut + closedOut } }
  } catch (e) {
    const kind = e && e.kind ? e.kind : classifyError(e)
    return { ok: false, error: { kind, message: e && e.message ? e.message : String(e) } }
  }
}

export default { countIssues }
