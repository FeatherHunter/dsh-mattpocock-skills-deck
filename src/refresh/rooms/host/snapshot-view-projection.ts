/**
 * src/refresh/rooms/host/snapshot-view-projection.ts —— 库里的行 → 界面形状的纯投影（#1892）
 *
 * 为什么单成一份：这条组装原来混在 snapshot-library-view.ts 里，与详情、评论的换算住在一起；
 * 它和它们的输入不同（整页列表行，不是一张票的详情），变化原因也不同（树、父子、排序变了才动它）。
 * 单列之后，「库里的行 → 界面形状」只有一个入口，列表回放与增量索引都从这里取，两份形状不会各漂各的。
 *
 * 四条不能改的约定：
 *  1. 纯函数：不读时钟、不写缓存、不问后端、不改入参。同样输入连续两次调用必须逐字相同。
 *  2. 排序显式给定，不依赖行的插入顺序：先按状态升序（与库列表读的 ORDER BY state ASC 同口径），
 *     再按更新时间倒序（没有时间的排最后），再按 (effortId, key) 升序。这条顺序就是库列表读的
 *     ORDER BY i.state ASC, i.updated_at_ms DESC, i.key ASC；投影自己再排一遍，是为了不把
 *     「读出来碰巧是什么顺序」当成投影的输入。改这里之前先确认：库列表读与这份比较器是同一口径。
 *  3. 行 → 票的换算是直通：库列表行没有正文（正文属于详情），所以这里给的 body 一律是空串，
 *     地图/规格的区块会解析成空——不要用「看着不像空」去补一份正文，那会让列表看起来取过详情。
 *     三态照实写（#1893 按规格 I6 收紧， #1885 评审修复起与客户端共用一份换算）：组记录缺席、
 *     或组是 unknown，整个字段都不写——不补空数组冒充「确认没有」；complete + 空才是确认没有
 *     （写空数组或 null）；truncated + 空表示一条都没取到，同样不写。行的状态与类型也不再兜底成
 *     open / issue：不知道时整个字段不写，下游按「没看到 = 不知道」处理。
 *     三态与行的换算只剩一份：src/shared/snapshot-row-fields.ts（客户端变化集合同一份文本拼进闭包），
 *     本文件只决定「宿主侧的 Issue 形状把哪些已知字段装出来」。
 *     行里的边数组（blockedBy）也不在这里重排：库列表投影已经按边表的目标票次序给出，
 *     它是「这一行带着的数据」而不是「行的先后」；本票要消掉的是后者，不是把每一格内容也洗一遍。
 *  4. 版本只进信封，不进内容：投影结果与版本无关（版本是新鲜度信号，不是排序或筛选依据）。
 *     调用方拿 {version, snapshot} 这一对去做读回包；只拿 snapshot 时也要能重建出同一份形状。
 *
 * 与在线组装的区别（本票不动在线组装）：在线那一趟的输入是后端工作集（开放池 + 容器子票 +
 * 已关闭容器行，按后端的更新时间倒序拼出来，行里带正文），它的顺序就是回包今天的顺序；
 * 本文件只接库列表行这一条路，所以在线组装继续直接用 snapshotAssemble.ts 的 assembleSnapshot，
 * 回包一个字节都不变。等 #1893 把 wf.snapshot 改成纯投影时，在线那条路才会收进来。
 */

import type { RepositoryRef } from '../../../tracker/contract/entities.js'
import type { ListIssue } from '../../../workspace-snapshot/contract/types.js'
import { assembleSnapshot } from '../../../host/tracker/snapshotAssemble.js'
// #1885 评审修复：行的三态与字段换算只有这一份，客户端变化集合同一份文本（构建时拼进闭包）。
import { snapshotRowFieldsOf } from '../../../shared/snapshot-row-fields.js'

/** 一次投影的输入：仓库身份、库列表投影里的行、这批行对应的库版本。 */
export interface SnapshotViewInput {
  repo: RepositoryRef
  /** 库列表投影（readList）里的行；顺序可以是任意的，投影自己会排。 */
  issues: readonly ListIssue[]
  /** 这批行读出来时的库版本；只随结果交回，不参与形状计算。 */
  version: number
}

/** 一次投影的结果：与在线组装同形的快照主体，加上产生它的库版本。 */
export interface SnapshotViewProjection {
  /** 输入里的库版本，原样交回。 */
  version: number
  /** 与在线组装同形：{repository, maps, issues, thinTickets, deck}。 */
  snapshot: any
}

/** 毫秒转 ISO；null / 非有限数回 null（不拿 1970 年冒充「时间不知道」）。 */
export function isoOf(value: unknown): string | null {
  return (typeof value === 'number' && Number.isFinite(value)) ? new Date(value).toISOString() : null
}

/**
 * 一行库记录 → tracker 契约里的 Issue 形状。
 *
 * 换算里「知道哪些字段」全部来自 src/shared/snapshot-row-fields.ts（与客户端变化集合共用同一份），
 * 本函数只负责宿主侧的输出形状：列表行没有正文，body 一律空串；标题/地址/时间这些 required 格子
 * 在不知道时仍写空串/0（这是列表行既有契约，界面按空串显示），但组字段与状态、类型不兜底——
 * 组不知道就不写；状态/类型不知道也不写（#1885 评审 D：不替后端下结论）。
 * #1870：数字编号一并补上（键是纯数字时），增量索引只认 number。
 */
export function issueOfRow(item: ListIssue): any {
  const f = snapshotRowFieldsOf(item)
  const issue: any = {
    key: f.key,
    ...(f.number !== null ? { number: f.number } : null),
    effortId: f.effortId,
    ...(f.type.known ? { type: f.type.value } : null),
    title: f.title.known ? f.title.value : '',
    ...(f.state.known ? { state: f.state.value } : null),
    body: '',
    url: f.url.known ? f.url.value : '',
    createdAt: f.createdAtMs.known ? isoOf(f.createdAtMs.value) : '',
    updatedAt: f.updatedAtMs.known ? isoOf(f.updatedAtMs.value) : '',
    closedAt: f.closedAtMs.known ? isoOf(f.closedAtMs.value) : null,
  }
  // --- 组字段按三态写：known 才写，known + 空 = 确认没有（见共享换算的文件头）---
  if (f.parentKey.known) issue.parentKey = f.parentKey.value
  if (f.labels.known) issue.labels = f.labels.value
  if (f.assignees.known) issue.assignees = f.assignees.value
  if (f.blockedBy.known) issue.blockedBy = f.blockedBy.value
  if (f.isPullRequest.known) issue.isPullRequest = f.isPullRequest.value
  if (f.commentCount.known) issue.commentCount = f.commentCount.value
  if (f.reason.known) issue.reason = f.reason.value
  if (f.mergedAtMs.known) issue.mergedAt = isoOf(f.mergedAtMs.value)
  if (f.status.known) issue.status = f.status.value
  if (f.statusVisible.known) issue.statusVisible = f.statusVisible.value
  if (f.statusSource.known) issue.statusSource = f.statusSource.value
  return issue
}

/** 文本字段的比较：先把 null / 非字符串收成空串，再按二进制序比（与 SQLite 的 TEXT 比较同口径）。 */
function comparedText(a: unknown, b: unknown): number {
  const x = a === null || a === undefined ? '' : String(a)
  const y = b === null || b === undefined ? '' : String(b)
  return x < y ? -1 : x > y ? 1 : 0
}

/**
 * 两条库行的显式顺序。逐级比较，前一级相同才看下一级：
 *
 *  1. 状态升序，NULL 在前 —— 与库列表读的 ORDER BY state ASC 同口径。今天库里只有 open / closed
 *     两态（都小写），所以 closed 在 open 前；这是「已关闭的行排在前面」的历史顺序，界面另有自己的
 *     排序档（ListTab），这里只负责「同一份库永远读出同一个顺序」。
 *  2. 更新时间倒序，没有时间的排在最后 —— 对应 ORDER BY updated_at_ms DESC（SQLite 的 DESC 把 NULL 放最后）。
 *  3. effortId 升序、4. key 升序 —— 多工作单元（本地 Markdown）里编号会重复，只有 (effortId, key)
 *     这一对唯一；库列表读的 ORDER BY 没写 effort_id，排序落到这一级时由这里补上，避免退回插入顺序。
 *  5–7. 类型、是不是拉取请求、标题 —— 只在同一份身份出现两次（不该发生）时才会用到，纯粹为了让
 *     比较器是一个全序，不把「数组里谁先谁后」留给引擎。
 */
function compareRows(a: ListIssue, b: ListIssue): number {
  const sa = a.row.state
  const sb = b.row.state
  if (sa !== sb) {
    if (sa === null || sa === undefined) return -1
    if (sb === null || sb === undefined) return 1
    const byState = comparedText(sa, sb)
    if (byState !== 0) return byState
  }
  const ua = (typeof a.row.updatedAtMs === 'number' && Number.isFinite(a.row.updatedAtMs)) ? a.row.updatedAtMs : null
  const ub = (typeof b.row.updatedAtMs === 'number' && Number.isFinite(b.row.updatedAtMs)) ? b.row.updatedAtMs : null
  if (ua !== ub) {
    if (ua === null) return 1
    if (ub === null) return -1
    return ub - ua
  }
  const byEffort = comparedText(a.effortId, b.effortId)
  if (byEffort !== 0) return byEffort
  const byKey = comparedText(a.key, b.key)
  if (byKey !== 0) return byKey
  const byType = comparedText(a.row.type, b.row.type)
  if (byType !== 0) return byType
  const byPull = (a.row.isPullRequest === true ? 0 : a.row.isPullRequest === false ? 1 : 2)
    - (b.row.isPullRequest === true ? 0 : b.row.isPullRequest === false ? 1 : 2)
  if (byPull !== 0) return byPull
  return comparedText(a.row.title, b.row.title)
}

/** 按 compareRows 排好的一份拷贝：不改调用方交进来的数组（纯函数不改入参）。 */
function orderedRowsOf(issues: readonly ListIssue[]): ListIssue[] {
  return issues.slice().sort(compareRows)
}

/**
 * 库里的行 → 界面形状。纯投影的唯一入口。
 *
 * 为什么排完序再组装：assembleSnapshot 会把输入行的先后原样带进 maps / tickets / issues / thinTickets。
 * 不先排，投影结果就取决于库读出来是第几行——那正是规格 I5 不允许的「依赖插入顺序」。
 * 排好之后，同一批行（哪怕插入库的顺序不同、读出来顺序不同）一定得到同一份形状。
 */
export function projectSnapshotView(input: SnapshotViewInput): SnapshotViewProjection {
  const rows = orderedRowsOf(Array.isArray(input && input.issues) ? input.issues : [])
  const snapshot = assembleSnapshot(input.repo, rows.map(issueOfRow))
  return { version: input.version, snapshot }
}
