/**
 * src/tracker/rooms/github/read/list-state.ts —— 把契约的 state 筛换成 GitHub 查询能用的状态档（#1796）。
 *
 * 为什么单独一个文件：三个函数（工单 / 拉取请求 / REST）是一件事的三种说法——「调用方要哪一档状态」，
 * 与取数与过滤无关；放在 issues.ts 里会把那条读路径顶过 350 有效行的单文件纪律（issues.ts 本来就长），
 * 所以拆出来。真源只有这一份：GraphQL 两条查询的 states 变量与 REST 降级路径都从这里取。
 *
 * 为什么必须下推到查询：列表只翻到 500 条（拉取请求 1000 条）就停，而 GitHub 按更新时间倒序返回；
 * 若把「打开」与「已关闭」挤在同一个窗口里，高编号的已关闭票会把低编号的未关闭票挤出窗口，
 * 面板上表现为「这些票不见了」（#1796 的现场）。收窄到调用方要的那一档，窗口里才全是同类票。
 * 省略 state 时与改造前完全一致（全都要）；内存里的 applyIssueFilter 仍保留作兜底。
 */

import type { ListFilter } from '../../../contract/inputs.js'

/**
 * filter.state 归一到小写；没给或给了别的值都回空串，表示「不按状态收窄」。
 *
 * 对外导出是因为计数那条读路径（counts.ts）也要同一份归一（#1796 code review）：此前那里自己抄了一份，
 * 两份写法稍有差异就会让「列表按状态收窄、计数没收到」变成两套口径。
 */
export function narrowStateOf(filter: ListFilter | null | undefined): string {
  const bag = (filter && typeof filter === 'object' ? (filter as Record<string, unknown>) : null) as Record<string, unknown> | null
  return bag && bag.state ? String(bag.state).toLowerCase() : ''
}

/**
 * 工单的 GraphQL 状态档：open → 只查 OPEN；closed → 只查 CLOSED；省略 → 两种都要。
 * 内存里的 applyIssueFilter 仍按规范化后的状态严格过滤，这里只负责让查回来的窗口不混状态。
 */
export function issueStatesOf(filter: ListFilter | undefined): string[] {
  const state: string = narrowStateOf(filter)
  if (state === 'open') return ['OPEN']
  if (state === 'closed') return ['CLOSED']
  return ['OPEN', 'CLOSED']
}

/**
 * 拉取请求的 GraphQL 状态档：open → 只查 OPEN；closed → CLOSED 与 MERGED 都要；省略 → 三态齐全。
 *
 * 为什么 closed 还要带 MERGED：normalize 里的 pullStateOf 把「已关闭」与「已合并」都收成 closed，
 * 内存过滤按规范化后的值严格等值比较；只查 CLOSED 会让已合并的拉取请求从列表消失，
 * 「已合并」那一条显示判据（views/shared/stateKind.js）也就永远没机会用上（#599 门禁守的就是这条）。
 */
export function pullStatesOf(filter: ListFilter | undefined): string[] {
  const state: string = narrowStateOf(filter)
  if (state === 'open') return ['OPEN']
  if (state === 'closed') return ['CLOSED', 'MERGED']
  return ['OPEN', 'CLOSED', 'MERGED']
}

/**
 * REST 降级路径的状态档：GitHub 的 REST 列表接口只认 open / closed / all 三档。
 * 与 GraphQL 的状态一一对应（closed 对拉取请求天然含已合并的）；省略 state 时仍是 all，
 * 与改造前完全一致。固定 sort=updated&direction=desc 是 #1796 的另一半（见 issues-rest-list.ts 与 pulls.ts）：
 * 10 页窗口按更新时间倒序才和 GraphQL 主路同一口径。
 */
export function restStateOf(filter: ListFilter | undefined): string {
  const state: string = narrowStateOf(filter)
  if (state === 'open') return 'open'
  if (state === 'closed') return 'closed'
  return 'all'
}
