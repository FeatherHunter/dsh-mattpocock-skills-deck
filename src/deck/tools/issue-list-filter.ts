// src/deck/tools/issue-list-filter.ts —— deck_issue_list 的内存二次筛（#1831 从 issue-list.ts 拆出）
//
// 为什么单独成一个文件：列表工具加上读时限与超时回执之后，主文件的有效行数越过了文件粒度门禁
// 的 350 行上限；这里收的是「后端已经回来之后」的纯内存工作 —— 把后端可能忽略的 type 再判一次、
// 按 label 与 assignee 再收窄、按 query 搜标题与正文，最后把后端行压成回执要的那一行形状。
// 它不碰后端、不判超时、也不决定失败文案，与主流程的预算和取消逻辑无关，拆出来两边都更好读。
import { isSpecHeaderMarked } from '../../shared/issue-file/src/marker.js'
import { parseOriginalWords } from '../../shared/issue-file/src/original-words.js'

/**
 * 从后端回来的清单里挑出名字：字符串直接用，对象按下标取一项（标签取 name、认领取 login），
 * 两种混着来也认。给的清单不是数组就当空，取不到名字记空串，最后去空。
 */
function namesOf(list: unknown, pick: (item: Record<string, unknown>) => unknown): string[] {
  if (!Array.isArray(list)) return []
  return list.map((l) => {
    if (typeof l === 'string') return l
    if (l && typeof l === 'object') {
      const v = pick(l)
      return v === undefined || v === null ? '' : String(v)
    }
    return ''
  }).map((s) => String(s).trim()).filter(Boolean)
}

/** 标签名字：对象形态取 name，字符串形态原样用。 */
function labelNames(list: unknown): string[] { return namesOf(list, (l) => l.name) }
/** 认领人名字：对象形态取 login，取不到记空串（namesOf 会把它滤掉）。 */
function assigneeNames(list: unknown): string[] { return namesOf(list, (a) => (a && a.login) || '') }

/**
 * 一行读面的状态两格（#1790 缺陷 A 的 P4）：本地 Markdown 房返回的 Issue 已经算好 status 与 statusConflict。
 * status 有才给；statusConflict 是布尔、总是给（没有冲突就是 false）——调用方不用再猜
 * 「字段缺席」是这张票没状态，还是这个后端不认这条约定。
 */
function statusRowFields(issue: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (typeof issue.status === 'string' && issue.status !== '') out.status = issue.status
  out.statusConflict = !!issue.statusConflict
  return out
}

/** 这一行是不是地图：后端回的 type 认地图、或带 isMap 标记、或戴着 wayfinder:map 标签都算。 */
function isMapRow(issue: Record<string, unknown> | null | undefined): boolean {
  try {
    if (!issue || typeof issue !== 'object') return false
    if (issue.type === 'map' || issue.isMap === true) return true
    const labs = labelNames(issue.labels).map((s) => s.toLowerCase())
    return labs.indexOf('wayfinder:map') >= 0
  } catch (e) { return false }
}

/** 把一行归成三种契约类型之一：地图 / 规格 / 普通票。
 *
 *  后端的 type 认 map/spec 时直接采用；没标对时按标签与票面文件头标记兜底 —— 标签先于标记，
 *  与客户端 containerKindOf、宿主快照组装层的判定次序一致（#1277 的视图兜底）。
 */
function rowKindOf(issue: Record<string, unknown> | null | undefined): string {
  try {
    if (!issue || typeof issue !== 'object') return 'issue'
    const declared = String(issue.type || '')
    if (declared === 'map' || declared === 'spec') return declared
    if (isMapRow(issue)) return 'map'
    if (isSpecHeaderMarked(issue.body)) return 'spec'
    return 'issue'
  } catch (e) { return 'issue' }
}

/** 内存二次筛的输入：type 是收口后的四档之一，labels 原样（本函数逐项 trim+小写），assignee/query 已由调用方 trim+小写。 */
export interface FilterRowsOptions {
  /** 已收口的 type（issue | map | spec | all）：调用方按这四档传，本文件不再接受任意字符串。 */
  type: 'issue' | 'map' | 'spec' | 'all'
  labels: unknown
  assignee: string
  query: string
}

/**
 * 把后端回来的清单按调用方条件再筛一遍，并压成回执行（#1831 从主文件搬来，逐字保留原口径）。
 *
 * 为什么后端筛过还要内存再筛：后端只保证把条件透传下去，不一定过滤包容（GitHub 的多标签是 OR 并集），
 * 所以 type 判一次、label 按 AND 再收窄一次；assignee 与 query 一直只在本层筛。顺序沿用后端原序，不重排。
 */
export function filterRows(rows: unknown, opts: FilterRowsOptions): Record<string, unknown>[] {
  const list = Array.isArray(rows) ? rows : []
  const type = String((opts && opts.type) || 'all')
  const wantLabelLow = (Array.isArray(opts && opts.labels) ? (opts.labels as unknown[]) : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean)
  const wantAssignee = String((opts && opts.assignee) || '').trim().toLowerCase()
  const wantQuery = String((opts && opts.query) || '').trim().toLowerCase()
  const matched: Record<string, unknown>[] = []
  for (const issue of list) {
    if (!issue || typeof issue !== 'object') continue
    // type 在内存里再判一次：后端可能忽略它（契约只保证它透传，不过滤包容）。
    if (type !== 'all') {
      if (rowKindOf(issue) !== type) continue
    }
    if (wantLabelLow.length) {
      const have = labelNames((issue as Record<string, unknown>).labels).map((x) => x.toLowerCase())
      let hit = true
      for (const w of wantLabelLow) if (have.indexOf(w) < 0) { hit = false; break }
      if (!hit) continue
    }
    if (wantAssignee) {
      const have = assigneeNames((issue as Record<string, unknown>).assignees).map((x) => x.toLowerCase())
      if (have.indexOf(wantAssignee) < 0) continue
    }
    if (wantQuery) {
      const rec = issue as Record<string, unknown>
      const hay = String(rec.title || '') + '\n' + String(rec.body || '')
      if (hay.toLowerCase().indexOf(wantQuery) < 0) continue
    }
    const rec = issue as Record<string, unknown>
    const row: Record<string, unknown> = {
      key: rec.key,
      title: rec.title,
      state: rec.state,
      type: rowKindOf(rec),
      labels: labelNames(rec.labels),
      assignees: assigneeNames(rec.assignees),
      updatedAt: rec.updatedAt || '',
      url: rec.url || '',
      effortId: rec.effortId !== undefined ? rec.effortId : '',
      parentKey: rec.parentKey !== undefined ? rec.parentKey : null,
      // #1790 缺陷 A 的 P4：状态两格追加在行末，原有字段的顺序与含义一个都不动。
      ...statusRowFields(rec),
    }
    // A3（用户 m00239 拍板）：行里带着正文、且正文里真有「## 维护者原话」区时，才给这一行留一个布尔标记；
    // 没有原话时整个键都不出现（薄行要紧凑，空值不写）。纯地图薄查那条路没有正文，不经过这里，照旧不带。
    if (typeof rec.body === 'string' && parseOriginalWords(rec.body).length > 0) row.hasOriginalWords = true
    matched.push(row)
  }
  return matched
}
