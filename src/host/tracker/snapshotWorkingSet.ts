// src/host/tracker/snapshotWorkingSet.ts —— 首屏工作集：开放池 + 开放地图子票 + 已关闭地图容器行（#1796）
//
// 为什么单开这一个文件：composeSnapshot 原来只拿一趟「开放票与已关闭票混排、按更新时间倒序、500 条封顶」
// 的列表当首屏，编号靠后的未关闭票会被大量已关闭票挤出窗口（#1796 的现场：30 张未关闭票里有 8 张
// 排在第 776～1282 名，根本进不来）。修法是把首屏改成三份来源的并集：
//   1) 开放工作集：list({state:'open'}) 由后端先筛状态，未关闭票不再和已关闭历史挤同一个窗口；
//   2) 开放容器的子票：开放工作集只装得下开放票，已关闭的子票要靠 listSubIssues 逐张开放容器拉全，
//      地图详情才数得清「共 N 张」（#1796 code review 补：规格容器同理 —— 它的实施票做完了就关，
//      不补回来会让做完了的规格看着一张子票都没有）；
//   3) 已关闭地图的容器行：开放工作集里没有它们，热启动沿用上一份快照里的容器行，冷启动补一页薄行，
//      列表页签上的容器行才不会凭空消失。
// 这三件事都只读后端、只回事实；组装、计数与 partial 判定仍留在 composeSnapshot（本文件不写 deck，
// 也不碰缓存与版号），所以它没有第二个读者，边界清楚。
//
// 什么约定不能改：
//   1. 失败只跳过不抛：某张地图的子票拉不到，其余来源照常返回；失败与不完整的次数如实交给调用方记日志、
//      判「这一份来源全不全」。
//   2. 不猜数：listSubIssues 回 unsupported（确实不提供子票的后端）既不算失败也不造假行；没有 listPage 的
//      后端只是补不出已关闭容器行，不做任何替代。
//   3. 行身份用 (effortId, key) 这一对（tracker/kernel 的 idOfParts）：同一张票只出现一次；同一张票在
//      开放池里已有、子票里也回来时以池里那份为准，只补它缺的 parentKey。
//   3之1. 向 listSubIssues 点名容器所属的工作单元：本地 Markdown 后端的容器编号在每个工作单元里都是
//      00，只传编号分不清是哪一张地图/规格（#1826）。范围放进仓库引用的 effortId 里，且克隆一份
//      引用再传，不改调用方手里那份；其它后端忽略这个字段。
//   4. 已关闭地图容器行是薄行：显式给 body:''，让组装层的正文解析不依赖「这一行有没有正文」。
//   5. 相对导入保留 .js 后缀（构建后由 scripts/ts-hook.mts 改指同名 .ts，本文件不改说明符）。

import { effortOf, idOfParts } from '../../tracker/kernel/identity-keys.js'
import { ERROR_KIND } from '../../tracker/contract/vocabulary.js'

// 类型只做编译期约束，不产生运行时引用。
import type { RepositoryRef } from '../../shared/tracker/shape.js'

/** 冷启动补已关闭地图容器行时一页要多少张：与规格 §6.3「最近 100 条」同一个数，不多取。 */
const CLOSED_MAP_PAGE_LIMIT = 100
/** 探索地图的标签（小写真源；listPage 的标签筛选按契约原样下推）。 */
const MAP_LABEL = 'wayfinder:map'

/** 组装首屏工作集的入参：门面、仓库、上下文、开放池，以及两份「上一次/这一次已有」的容器行。 */
export interface WorkingSetInput {
  /** 取数门面（composeSnapshot 给的 trackerFor；可能缺 listPage / listSubIssues，本文件按缺席处理）。 */
  tracker: any
  ref: RepositoryRef
  ctx?: any
  /** 这一趟 list({state:'open'}) 拿回来的开放工作集（原样，不在这里改）。 */
  pool: any[]
  /** 用 pool 先组装一遍得到的容器行（composeSnapshot 把 assembleSnapshot(ref, pool).maps 交进来）。 */
  openContainers?: any[]
  /** 上一份快照的 maps：热启动时从这里取已关闭地图容器行。 */
  previousMaps?: any[]
}

/** 组装结果：并集行 + 这一趟向远端多要了几次、失败了几个、已关闭容器行从哪来。 */
export interface WorkingSetResult {
  /** 组装层要吃的行：开放池 + 开放容器子票 + 已关闭地图容器薄行（已按身份去重）。 */
  rows: any[]
  /** 这一趟拉过子票的开放容器张数（探索地图与规格都算：两类容器的子票都是实施票）。 */
  openContainers: number
  /** 子票行一共拉回多少张（失败的地图不计）。 */
  subIssues: number
  /** 子票拉取硬失败的地图张数（unsupported 不计；>0 表示这一份来源不全）。 */
  subIssuesFailed: number
  /** 子票撞到上限或与后端总数对不上的地图张数（>0 表示子票不全，但开放工作集本身没缺）。 */
  subIssuesIncomplete: number
  /**
   * 子票拉取硬失败的容器清单，形如 `641:transport;1588:unknown`（票号 + 错误档，缺档记 unknown）；
   * 空串表示没有失败。只记编号与错误档：日志纪律要求这类行状态只记编号与计数，不记正文与远端原文。
   */
  failed: string
  /** 补回来的已关闭地图容器行张数。 */
  closedMapRows: number
  /** 已关闭地图容器行从哪来：上一份快照 / 冷启动补的一页 / 没有。 */
  closedMapSource: 'previous' | 'page' | 'none'
}

/** 这一行的票号：key 优先，number 兜底；两个都没有时回空串（组装层会把它当没有编号的行丢掉）。 */
function keyOfRow(row: any): string {
  try {
    if (!row) return ''
    const k: any = row.key !== undefined && row.key !== null && row.key !== '' ? row.key : row.number
    return k === undefined || k === null ? '' : String(k)
  } catch (e) {
    return ''
  }
}

/** 行身份：与组装层同一把尺子 (effortId, key)。 */
function rowIdOf(row: any): string {
  return idOfParts(effortOf(row), keyOfRow(row))
}

/** 是不是已关闭（大小写无关，缺状态按未关闭处理——与组装层 isClosedRow 同口径）。 */
function isClosedRow(row: any): boolean {
  try {
    return String((row && row.state) || '').toUpperCase() === 'CLOSED'
  } catch (e) {
    return false
  }
}

/** 编号归一：已有 number 原样用；没有时按数字 key 折成数字，折不动就省略（薄行只需要 key 可读）。 */
function numberOfRow(row: any): number | null {
  try {
    if (row && typeof row.number === 'number' && isFinite(row.number)) return row.number
    const k: string = keyOfRow(row)
    if (/^[0-9]+$/.test(k)) {
      const n = parseInt(k, 10)
      if (!isNaN(n)) return n
    }
  } catch (e) {
    /* 拿不到就当没有 */
  }
  return null
}

/**
 * 把一条子票并进并集：缺 parentKey 的补上所属地图、缺 effortId 的补上容器的工作单元标识，
 * 然后按身份去重；池里已有同一张票时只补它缺的 parentKey，不拿子票行覆盖池里的完整行。
 */
function mergeTicketRow(rows: any[], seen: Record<string, number>, item: any, map: any): void {
  if (!item || typeof item !== 'object') return
  const key: string = keyOfRow(item)
  if (!key) return
  const row: any = Object.assign({}, item)
  row.key = key
  const mapKey: string = keyOfRow(map)
  if ((row.parentKey === undefined || row.parentKey === null || row.parentKey === '') && mapKey) row.parentKey = mapKey
  const mapEffort: string = effortOf(map)
  if ((row.effortId === undefined || row.effortId === null || row.effortId === '') && mapEffort) row.effortId = mapEffort
  const id: string = rowIdOf(row)
  const at: number = seen[id] || 0
  if (at > 0) {
    const existing: any = rows[at - 1]
    if (existing && (existing.parentKey === undefined || existing.parentKey === null || existing.parentKey === '') && row.parentKey) {
      existing.parentKey = row.parentKey
    }
    return
  }
  seen[id] = rows.length + 1
  rows.push(row)
}

/** 已关闭地图容器行：只带列表画一行所需的事实，正文显式给空串（薄行，不冒充详情）。 */
function thinClosedMapRow(row: any): any {
  const out: any = {}
  out.key = keyOfRow(row)
  const n = numberOfRow(row)
  if (n !== null) out.number = n
  out.effortId = effortOf(row)
  out.type = 'map'
  out.state = 'CLOSED'
  out.title = String(row && row.title !== undefined && row.title !== null ? row.title : '')
  out.body = ''
  out.isPullRequest = false
  return out
}

/** 把已关闭容器行并进并集：同一身份只收一次，返回真的并进去几张。 */
function appendClosedRows(rows: any[], seen: Record<string, number>, list: any[]): number {
  let added = 0
  for (const m of list) {
    if (!m || typeof m !== 'object') continue
    if (m.type !== 'map' || !isClosedRow(m)) continue
    const row: any = thinClosedMapRow(m)
    if (!row.key) continue
    const id: string = rowIdOf(row)
    if (seen[id]) continue
    seen[id] = rows.length + 1
    rows.push(row)
    added++
  }
  return added
}

/**
 * 组装首屏工作集（纯装配 + 只读远端）。
 *
 * 进：开放池（list({state:'open'}) 的原样行）、用开放池先组装出来的容器行、上一份快照的容器行。
 * 出：组装层要吃的并集行，以及「这一趟子票拉了几张、坏在哪几张、已关闭容器行从哪来」的事实；
 *   这些事实由 composeSnapshot 记进常驻日志 snapshot.workingSet（附录 #149），所以本文件的返回字段都有读者。
 * 异常策略：远端失败只跳过不抛（快照这条路可用性优先）；调不通的失败数交给调用方决定 partial 与日志。
 */
export async function assembleWorkingSet(input: WorkingSetInput): Promise<WorkingSetResult> {
  const args: any = input || {}
  const tracker: any = args.tracker || null
  const ref: RepositoryRef = args.ref
  const ctx: any = args.ctx || {}
  const pool: any[] = Array.isArray(args.pool) ? args.pool : []
  const containers: any[] = Array.isArray(args.openContainers) ? args.openContainers : []
  const previousMaps: any[] = Array.isArray(args.previousMaps) ? args.previousMaps : []

  // 池里的行先拷一份：本文件只往并集上加行，不改调用方手里的列表。
  const rows: any[] = pool.map(function (r: any) { return r && typeof r === 'object' ? Object.assign({}, r) : r })
  const seen: Record<string, number> = {}
  for (let i = 0; i < rows.length; i++) {
    const id: string = rowIdOf(rows[i])
    if (id && !seen[id]) seen[id] = i + 1
  }

  let openContainers = 0
  let subIssues = 0
  let subIssuesFailed = 0
  let subIssuesIncomplete = 0
  // 失败清单要能说出「哪张容器、什么错误档」：只记编号与错误档，不记远端原文（日志纪律）。
  const failedContainers: string[] = []

  // 拉探索地图与规格两类容器的子票：两类容器的子票都是「做完了就关」的实施票，已关闭的那部分不再进首屏
  //   （#1796 首屏只装开放票），只能靠这一趟补回来 —— 不补的话，做完了的规格会显示成一张子票都没有。
  //   只补开放容器：已关闭容器的子票按 #691 的边界不抓。
  const openContainerRows: any[] = containers.filter(function (m: any) { return m && (m.type === 'map' || m.type === 'spec') && !isClosedRow(m) })
  const canFetch = !!(tracker && typeof tracker.listSubIssues === 'function')
  if (canFetch) {
    for (const container of openContainerRows) {
      const containerKey: string = keyOfRow(container)
      if (!containerKey) continue
      openContainers++
      let res: any = null
      try {
        // #1826：容器编号在本地 Markdown 后端里每个工作单元都是 00，把这一行容器的工作单元一起放进
        //   仓库引用，后端才分得清是哪一个 00 号容器（克隆引用，不改调用方手里那一份）。
        const mapEffort: string = effortOf(container)
        const scopedRef: any = mapEffort ? Object.assign({}, ref, { effortId: mapEffort }) : ref
        res = await tracker.listSubIssues(scopedRef, containerKey, {}, ctx)
      } catch (e) {
        res = null
      }
      if (!res || res.ok !== true) {
        const kind: any = res && res.error ? res.error.kind : null
        // unsupported 是「这个后端不提供子票」，不是故障：不算失败、不报警，只是这一类行补不出来。
        if (kind !== ERROR_KIND.UNSUPPORTED) {
          subIssuesFailed++
          failedContainers.push(containerKey + ':' + (typeof kind === 'string' && kind ? kind : 'unknown'))
        }
        continue
      }
      const data: any = res.data || {}
      const items: any[] = Array.isArray(data.items) ? data.items : []
      subIssues += items.length
      if (data.capped === true || (typeof data.missing === 'number' && data.missing > 0)) subIssuesIncomplete++
      for (const item of items) mergeTicketRow(rows, seen, item, container)
    }
  }

  // 已关闭地图容器行：热启动先看上一份快照（不用再问远端），没有才冷启动补一页薄行。
  let closedMapRows = appendClosedRows(rows, seen, previousMaps)
  let closedMapSource: 'previous' | 'page' | 'none' = closedMapRows > 0 ? 'previous' : 'none'
  if (closedMapRows === 0 && tracker && typeof tracker.listPage === 'function') {
    let page: any = null
    try {
      page = await tracker.listPage(ref, { state: 'closed', labels: [MAP_LABEL] }, { limit: CLOSED_MAP_PAGE_LIMIT }, ctx)
    } catch (e) {
      page = null
    }
    if (page && page.ok === true) {
      const items: any[] = page.data && Array.isArray(page.data.items) ? page.data.items : []
      closedMapRows = appendClosedRows(rows, seen, items)
      if (closedMapRows > 0) closedMapSource = 'page'
    }
  }

  return {
    rows,
    openContainers,
    subIssues,
    subIssuesFailed,
    subIssuesIncomplete,
    failed: failedContainers.join(';'),
    closedMapRows,
    closedMapSource,
  }
}
