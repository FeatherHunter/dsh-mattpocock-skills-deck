// src/deck/tools/map-plan-readback.ts —— 地图骨架建完之后的读回核对（#1413；从 map-plan-create.ts 拆出）
//
// 为什么单独拆：这段核对（地图五节齐不齐、有没有 ## 进度、子票的必备标签与类型标签对不对、父票指向谁、
// ## 进度在不在、Type 行写对没有）有六十多行，留在 map-plan-create.ts 里会把那份文件顶过
// tests/verify-file-granularity.ts 的 350 行有效行上限。拆出来一行行为都没动：发后端的次数、
// notes 与 items 的文案和先后顺序，与拆出来之前逐字一致。
//
// 不能改的约定（改任何一条，回执就不诚实了）：
//   1. 读不回来只说「这次没核对」，不判失败 —— 读不回来的原因可能是额度不够、网络不好或后端自己出错；
//      把「没读到」说成「没写好」，会让一次本来建成功的地图被报成 partial。
//   2. Type 行只在「读回来的正文像整份文件」时才核，判据是正文里有没有文件头注释（parentKey / created 那一行）。
//      为什么不按后端身份分支：工具层不许拿后端 id 做判断（tests/verify-deck-tools.ts 的静态扫描就查这个）；
//      而远端后端不把文件头注释落进正文，正文里本来就没有 Type 行可核，按形状判正好各走各的。
//   3. 这里只往外返回 notes 与 items 两摞文字，自己不发写请求、不写游标、不碰预算账本。
import { MAP_BLOCK_TITLES } from '../shell/minimal-spec.js'
import { labelsToEnsure, isTypeLabel } from '../rules/object-kind.js'
import type { CreateKindResolution } from '../rules/object-kind.js'
import { stripProgressSections } from '../../shared/issue-file/src/progress.js'
import type { DeckTrackerLike } from '../shell/call-budget.js'

/** 建后读回核对的入参：全是调用方手上已经有的东西，这里不再取一次会话、不再选一次后端。 */
export interface MapPlanReadbackArgs {
  /** 后端门面（已过预算与钳制）；这里只用它的读票。 */
  tracker: DeckTrackerLike
  /** 仓库身份。 */
  repo: unknown
  /** 这次调用的后端上下文。 */
  opCtx: unknown
  /** 地图票号；空串表示地图票还没建成，这一步不做。 */
  mapKey: string
  /** 剩余额度是不是已经不够：不够就只记一句「这次没核对」。 */
  outOfBudget: boolean
  /** 上面按父票列出来的那一批子票；null 表示没列出来（拿不到）。 */
  liveRows: unknown[] | null
  /** 按父票列示时那句说明（子票没列出来时原样写进 notes）。 */
  pickedNote: unknown
  /** AI 传来的原始子票清单：只看 key，顺序决定核对顺序。 */
  children: Array<Record<string, unknown>>
  /** 入口处收口过的位置与标签答案，按计划内短标识索引。 */
  childKinds: Map<string, CreateKindResolution>
  /** 游标里「计划内短标识 → 真票号」的那张表。 */
  keys: Record<string, string>
}

/** 这一趟要追加到回执里的两部分：notes 是给人看的话，items 是逐项结果。 */
export interface MapPlanReadbackResult {
  notes: string[]
  items: Array<Record<string, unknown>>
}

/**
 * 建后读回核对：读一次地图票、再用按父票列出来的那一批逐张核子票，把没对上的地方逐条写出来。
 * 返回的两摞文字由调用方按顺序追加到回执的 notes / items 后面（这里不直接改回执，便于单独测试）。
 */
export async function readbackMapPlan(args: MapPlanReadbackArgs): Promise<MapPlanReadbackResult> {
  const notes: string[] = []
  const items: Array<Record<string, unknown>> = []
  // 地图票还没有票号（没建成），或者额度已经不够：只记那句「没核对」，与拆出来之前的两支逐字相同。
  if (!args.mapKey || args.outOfBudget) {
    if (args.outOfBudget) notes.push('建后读回核对：剩余额度不够，这次没核对。')
    return { notes: notes, items: items }
  }
  const tracker = args.tracker
  const repo = args.repo
  const opCtx = args.opCtx
  const mapKey = args.mapKey
  const children = args.children
  const childKinds = args.childKinds
  const keys = args.keys
  const liveRows = args.liveRows
  const problems: string[] = []
  let mapRow: Record<string, unknown> | null = null
  try {
    const gotMap = await tracker.get(repo, mapKey, {}, opCtx)
    mapRow = (gotMap && (gotMap as { ok?: unknown }).ok === true) ? (((gotMap as { data?: unknown }).data as Record<string, unknown> | null) || null) : null
  } catch (eGetMap) { mapRow = null }
  const mapBody = mapRow ? String(mapRow.body || '') : ''
  if (!mapRow) {
    notes.push('建后读回核对：地图票 ' + mapKey + ' 没读回来，这次没核对（不判失败）。')
  } else {
    const heads = MAP_BLOCK_TITLES.map((h) => mapBody.indexOf('## ' + h))
    const missingHeads = MAP_BLOCK_TITLES.filter((h, i) => heads[i] < 0)
    if (missingHeads.length) problems.push('地图缺五节里的：' + missingHeads.join('、'))
    if (stripProgressSections(mapBody) === mapBody) problems.push('地图没有 ## 进度')
    const at = mapBody.search(/^##\s*进度\s*$/m)
    const knownHeads = heads.filter((i) => i >= 0)
    if (at >= 0 && knownHeads.length && at < Math.max.apply(null, knownHeads)) problems.push('地图的 ## 进度没有排在五节之后')
  }
  const rows = Array.isArray(liveRows) ? (liveRows as Record<string, unknown>[]) : []
  const rowByKey = new Map<string, Record<string, unknown>>()
  for (const row of rows) if (row && row.key !== undefined && row.key !== null) rowByKey.set(String(row.key), row)
  // 只有读回来的正文是「整份文件」时才核 Type 行：本地 Markdown 房把整个文件当正文回，文件头除了
  // 幂等锚还会多出 parentKey 与 created 两行注释、正文里有 Status/Labels/Type 字段行；远端房这两行
  // 文件头注释不会落进正文（父边走原生边），正文也就没有 Type 行可核。这里按读回数据的形状判断，
  // 不按后端身份分支 —— 工具层不许拿后端 id 做判断（verify-deck-tools 的静态扫描就查这个）。
  const looksLikeWholeFile = (text: string): boolean => /^\s*<!--\s*(?:parentKey|created)\s*:/m.test(text)
  let checkedTypeLine = false
  for (const ch of children) {
    const planKey = String(ch.key)
    const ticketKey = String(keys[planKey] || '')
    const resolved = childKinds.get(planKey)
    if (!ticketKey || !resolved || !resolved.ok) continue
    const row = rowByKey.get(ticketKey)
    if (!row) { problems.push('子票「' + planKey + '」（票号 ' + ticketKey + '）没按父票列出来'); continue }
    const childBody = String(row.body || '')
    const names = (Array.isArray(row.labels) ? row.labels : []).map((x) => {
      return (typeof x === 'string') ? x : String((x && (x as { name?: unknown }).name) || '')
    }).filter(Boolean)
    const lower = names.map((n) => String(n).toLowerCase())
    const expected = labelsToEnsure(resolved.kind, resolved.label)
    const missingLabels = expected.filter((n) => lower.indexOf(String(n).toLowerCase()) < 0)
    if (missingLabels.length) problems.push('子票「' + planKey + '」缺标签：' + missingLabels.join('、'))
    const wantType = expected.filter((n) => isTypeLabel(n)).length
    const gotType = names.filter((n) => isTypeLabel(n)).length
    if (gotType !== wantType) problems.push('子票「' + planKey + '」有 ' + gotType + ' 枚类型标签（应为 ' + wantType + ' 枚）')
    if (String(row.parentKey || '') !== String(mapKey)) problems.push('子票「' + planKey + '」的父票是「' + String(row.parentKey || '') + '」（应为地图 ' + mapKey + '）')
    if (stripProgressSections(childBody) === childBody) problems.push('子票「' + planKey + '」没有 ## 进度')
    if (looksLikeWholeFile(childBody)) {
      checkedTypeLine = true
      const typeRows = childBody.match(/^\s*Type\s*[：:].*$/gm) || []
      if (resolved.kind === 'map-ticket') {
        const bare = String(resolved.label || '').replace(/^wayfinder:/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const want = new RegExp('^\\s*Type\\s*[：:]\\s*' + bare + '\\s*$', 'im')
        if (!want.test(childBody)) problems.push('子票「' + planKey + '」的 Type 行不是 ' + bare + '（实得 ' + typeRows.join(' / ').slice(0, 60) + '）')
      } else if (typeRows.length) {
        problems.push('子票「' + planKey + '」不该有 Type 行（实得 ' + typeRows.join(' / ').slice(0, 60) + '）')
      }
    }
  }
  if (problems.length) {
    notes.push('建后读回核对有 ' + problems.length + ' 处没对上：' + problems.slice(0, 4).join('；') + (problems.length > 4 ? '；…' : '') + '。以盘上为准，别按计划数字往下走。')
    for (const one of problems.slice(0, 8)) items.push({ key: '', role: 'verify', status: 'failed', reason: one })
  } else if (mapRow && liveRows) {
    notes.push('建后读回核对通过：地图五节与 ## 进度齐；' + Object.keys(keys).length + ' 张子票的父票、类型标签、## 进度' + (checkedTypeLine ? '与 Type 行' : '') + '都对。')
  } else {
    notes.push('建后读回核对：地图读回来了，但子票没按父票列出来（' + String(args.pickedNote || '后端没给出原因') + '），这次没核对子票。')
  }
  return { notes: notes, items: items }
}
