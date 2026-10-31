/**
 * src/refresh/kernel/snapshot-merge.ts —— 面板快照写入的唯一合并入口（#1690）
 *
 * 为什么要有这一份：面板快照原来在刷新侧是「整行替换」——写回执或降级取数的结果一到，
 * 就把那一行的父票、依赖边、子票计数、正文、评论、评审全换成这次取到的样子；取数降级时
 * 这些组根本没取，于是已知关系被抹掉。这张票把写入收成一个纯函数：进去的是当前快照与
 * 一次读结果（或写回执），出来的是新快照与四类变更计数，字段按组各自按来源完整度合并。
 *
 * 三条不能改的约定：
 *   · 只有「完整」的来源能覆盖或清空一个字段组；「截断」的来源只补空缺（旧值非空就保留旧的），
 *     「未表达」的来源整组跳过。来源声明之外还有行内三态（IssueFieldStates）：行里说
 *     parents 不认识时，即使来源说完整也不许清旧父边。
 *   · 版本门另立字段 snapshot.merge.version，与信封契约版本 snapshot.version、内容散列
 *     version/etag（snapshotVersionOf，304 语义）彻底分开：本文件永远不改 snapshot.version，
 *     也不读 snapshot.merge 算内容散列。起读版本比当前合并版本旧的结果整份丢弃（对象都不换），
 *     并记日志由调用方做；接受时合并版本单调 +1。
 *   · 删除只认完整枚举：只有行组完整且调用方明确说「这次枚举了全部票据」时才删没出现的行；
 *     显式 removedKeys 也必须带着完整行组证据才执行。非完整来源一条都不删。
 *
 * 排序不在这一层：既有行位置一律不动（并到的行就地换内容、没并到的保留原对象引用），
 * 新行只追加到 issues 尾部；按更新时间重排是投影层的事（阶段 3）。
 *
 * 本文件不读盘、不联网、不看时钟（时间由调用方传进来）；产物随 src/refresh/** 由根构建脚本
 * 的 refresh-ts 那一段生成到 .build/refresh/kernel/。
 */

import * as delta from './snapshot-diff.js'
import type { FieldGroup } from '../../tracker/contract/operations-encyclopedia.js'
import type { FieldGroupCompleteness, ReadProvenance } from '../../tracker/contract/read-provenance.js'

/** 组名清单：合并按组走，组值只许加不许改字面（持久化在 snapshot.merge.groups 的键上）。 */
const MERGE_GROUPS: readonly FieldGroup[] = ['row', 'body', 'labels', 'parents', 'dependencies', 'subIssues', 'comments', 'review', 'mergeInfo']

/** 有行内三态（IssueFieldStates）的六个关系组：行里的三态比来源声明更具体，压过来源声明。 */
const TRI_STATE_GROUPS: readonly string[] = ['parents', 'dependencies', 'subIssues', 'comments', 'review', 'mergeInfo']

/**
 * 每个字段组管住行上的哪些字段。行组只覆盖行本身随查询变化的那几项；
 * url、reason 这类不随每次取数变化的字段不归任何组，合并时原样保留旧值（宁可留也不误删）。
 */
const GROUP_FIELDS: Record<string, readonly string[]> = {
  row: ['title', 'state', 'updatedAt', 'createdAt', 'assignees', 'author', 'isPullRequest'],
  body: ['body'],
  labels: ['labels'],
  parents: ['parentKey'],
  dependencies: ['blockedBy'],
  subIssues: ['subIssueCounts'],
  comments: ['comments', 'commentCount'],
  review: ['reviews'],
  mergeInfo: ['mergedAt'],
}

/** 身份字段：哪个组都没取到时也照抄新行带来的值，但清空时永不删（删了这行就认不出来了）。 */
const IDENTITY_FIELDS: readonly string[] = ['key', 'number']

/** 一次合并给一个字段组盖的章：哪个合并版本、几点几分、哪个来源/操作、完整度如何。 */
export interface MergeGroupStamp {
  version: number
  atMs: number
  source: string
  operation: string
  completeness: FieldGroupCompleteness
}

/** snapshot.merge 的形状：合并版本、最近一次起读时间、各组最后一次表达的盖章。 */
export interface MergeState {
  version: number
  lastStartMs: number
  groups: Partial<Record<FieldGroup, MergeGroupStamp>>
}

/** 调用方交给合并服务的一次读结果或写回执。 */
export interface MergeInput {
  kind: 'read' | 'write'
  /** 这次取数开始时的合并版本（版本门拿它比当前快照）。 */
  startVersion: number
  /** 这次取数的起点毫秒（盖章与 lastStartMs 用，不参与过期判断）。 */
  startedMs: number
  /** 取回来的行；行自带 provenance / fieldStates 时按行判完整度。 */
  rows?: readonly any[]
  /** 读路径不允许凭空加行；写回执（补票）允许时置真。 */
  allowNewRows?: boolean
  /** 这次是否枚举了全部票据（只有它为真、且行组完整时才可能删行）。 */
  enumeratesAll?: boolean
  /** 调用方显式点名要删的票号（仍须行组完整证据）。 */
  removedKeys?: readonly string[]
  /** 整批结果的完整度（没有逐行 provenance 时用）。 */
  completeness?: 'complete' | 'truncated' | 'partial'
  /** 整批结果共用的来源声明（有逐行 provenance 时优先逐行的）。 */
  provenance?: ReadProvenance
}

/** 四类合并结果：新增、修改、删除、保留，键都是字符串票号。 */
export interface MergeChanges {
  added: string[]
  updated: string[]
  removed: string[]
  kept: string[]
}

/** 四类结果的条数，方便调用方直接断言/打日志。 */
export interface MergeCounts {
  added: number
  updated: number
  removed: number
  kept: number
}

/** 合并服务的返回值。stale-dropped 时 snapshot 原样返回、四类结果全空。 */
export interface MergeOutput {
  verdict: 'merged' | 'stale-dropped'
  reason: string
  snapshot: any
  version: any
  changes: MergeChanges
  counts: MergeCounts
  /** 读路径见到但快照里没有的票号（调用方据此记待办，而不是整行塞进去）。 */
  missing: string[]
  merge: MergeState
  /** 本次真正表达过的组的盖章（merge.groups 里刚写进去的那几项）。 */
  groups: Partial<Record<FieldGroup, MergeGroupStamp>>
}

/** 从快照读出合并版本；老快照没有 merge 字段时按 0 起算（兼容 1692 落盘前的格式）。 */
export function mergeVersionOf(snapshot: any): number {
  const merge = snapshot && snapshot.merge
  const version = merge && merge.version
  if (typeof version !== 'number' || !Number.isFinite(version) || version < 0) return 0
  return version
}

/** 从快照读出完整的合并状态；坏值/缺失一律归到空状态，不抛错（读盘回放要能容忍旧格式）。 */
export function mergeStateOf(snapshot: any): MergeState {
  const merge = snapshot && snapshot.merge
  const version = mergeVersionOf(snapshot)
  const lastStartMs = merge && typeof merge.lastStartMs === 'number' && Number.isFinite(merge.lastStartMs) ? merge.lastStartMs : 0
  const groups = merge && merge.groups && typeof merge.groups === 'object' ? Object.assign({}, merge.groups) : {}
  return { version: version, lastStartMs: lastStartMs, groups: groups }
}

/** 行里带没带这个字段：带 undefined 视同没带（JSON 往返会把它丢掉，不能算表达）。 */
function fieldPresent(row: any, field: string): boolean {
  return !!row && Object.prototype.hasOwnProperty.call(row, field) && row[field] !== undefined
}

/** 「空缺」口径：没有、null、空串、空数组、数字 0 —— 截断来源只有这些位置可以补。 */
function isEmptyValue(value: any): boolean {
  if (value === undefined || value === null || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'number') return value === 0
  return false
}

/** 这个组的字段里，行上有没有带本组的值（判来源未声明时「行到底表达了没有」）。 */
function carriesGroupValue(row: any, group: string): boolean {
  const fields = GROUP_FIELDS[group]
  if (!fields) return false
  for (let i = 0; i < fields.length; i += 1) {
    if (fieldPresent(row, fields[i])) return true
  }
  return false
}

/**
 * 判一个行、一个组的来源完整度（合并掩码的核心）。
 *
 * 顺序不能反：行内三态说「不认识」时最先退回 unexpressed；其次来源声明的 complete/truncated
 * 直接生效；来源没声明（或声明 unexpressed）时，六个关系组若行上真带了本组值，按 complete 处理
 * （取数层只会把 known:true 的组附到行上），其余组一律 unexpressed（宁可不动，也不误删）。
 */
function groupCompleteness(row: any, input: MergeInput, group: FieldGroup): FieldGroupCompleteness {
  const states = row && row.fieldStates
  if (states && TRI_STATE_GROUPS.indexOf(group) >= 0) {
    const state = states[group]
    if (state && state.known === false) return 'unexpressed'
  }
  const prov: any = input.provenance || (row && row.provenance)
  if (prov) {
    const declared = prov.fieldGroups && prov.fieldGroups[group]
    if (declared === 'complete' || declared === 'truncated') return declared
    if (TRI_STATE_GROUPS.indexOf(group) >= 0 && carriesGroupValue(row, group)) return 'complete'
    return 'unexpressed'
  }
  if (group === 'row' || group === 'labels') return 'complete'
  return carriesGroupValue(row, group) ? 'complete' : 'unexpressed'
}

/** 去掉 provenance 的深拷贝（避免把一次读的簿记写进快照；新行只留快照该有的字段）。 */
function copyRow(row: any): any {
  const out: any = {}
  const keys = Object.keys(row || {})
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]
    if (key === 'provenance') continue
    out[key] = row[key]
  }
  return out
}

/** 规范 JSON：键递归排序、跳过 provenance —— 只比内容，不比对象里键的书写顺序。 */
function canonical(value: any): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') {
    const text = JSON.stringify(value)
    return text === undefined ? 'null' : text
  }
  if (Array.isArray(value)) {
    const parts: string[] = []
    for (let i = 0; i < value.length; i += 1) parts.push(canonical(value[i]))
    return '[' + parts.join(',') + ']'
  }
  const keys = Object.keys(value).filter(function (k) { return k !== 'provenance' }).sort()
  const parts: string[] = []
  for (let i = 0; i < keys.length; i += 1) parts.push(JSON.stringify(keys[i]) + ':' + canonical(value[keys[i]]))
  return '{' + parts.join(',') + '}'
}

/**
 * 把一行新结果并进一行旧行，返回合并后的行与「内容有没有变」。
 *
 * 内容没变时调用方保留旧对象引用（快照里大量行没变，换对象白白让下游重渲染）；
 * 变了的行返回新对象，原对象一个字节不动。
 */
function mergeRow(oldRow: any, incoming: any, input: MergeInput): { row: any; changed: boolean } {
  const next: any = {}
  const oldKeys = Object.keys(oldRow || {})
  for (let i = 0; i < oldKeys.length; i += 1) {
    const key = oldKeys[i]
    if (key === 'provenance') continue
    next[key] = oldRow[key]
  }
  for (let i = 0; i < MERGE_GROUPS.length; i += 1) {
    const group = MERGE_GROUPS[i]
    const completeness = groupCompleteness(incoming, input, group)
    if (completeness === 'unexpressed') continue
    const fields = GROUP_FIELDS[group]
    for (let j = 0; j < fields.length; j += 1) {
      const field = fields[j]
      if (completeness === 'complete') {
        if (fieldPresent(incoming, field)) next[field] = incoming[field]
        else if (IDENTITY_FIELDS.indexOf(field) < 0) delete next[field]
      } else if (fieldPresent(incoming, field) && isEmptyValue(next[field])) {
        next[field] = incoming[field]
      }
    }
  }
  for (let i = 0; i < IDENTITY_FIELDS.length; i += 1) {
    const field = IDENTITY_FIELDS[i]
    if (fieldPresent(incoming, field)) next[field] = incoming[field]
  }
  const changed = canonical(next) !== canonical(oldRow)
  return { row: next, changed: changed }
}

/** 这一批行真正表达过哪些组，以及每组最强的那一档完整度（给 merge.groups 盖章用）。 */
function expressedGroups(rows: readonly any[], input: MergeInput): Partial<Record<FieldGroup, FieldGroupCompleteness>> {
  const out: any = {}
  for (let i = 0; i < MERGE_GROUPS.length; i += 1) {
    const group = MERGE_GROUPS[i]
    for (let j = 0; j < rows.length; j += 1) {
      const completeness = groupCompleteness(rows[j], input, group)
      if (completeness === 'unexpressed') continue
      // 单项完整度比较：complete 胜过 truncated（这里只有两种值，内联成一句）。
      out[group] = !out[group] || out[group] === 'truncated' && completeness === 'complete' ? completeness : out[group]
      if (out[group] === 'complete') break
    }
  }
  return out
}

/** 这份合并有没有任何变化（四类全空就是没变）。 */
function hasChanges(changes: MergeChanges): boolean {
  return changes.added.length > 0 || changes.updated.length > 0 || changes.removed.length > 0
}

/**
 * 快照写入的唯一入口：把一次读结果或写回执并进当前快照。
 *
 * 过期结果（startVersion 比快照里的合并版本旧）整份丢弃——返回原快照引用、四类结果全空，
 * 调用方据此记 staleDropped 日志；接受的合并给 snapshot.merge.version 单调 +1，
 * 并按「哪些组这次表达了」更新各组盖章。snapshot.version（信封契约版本）永远不动。
 */
export function mergeSnapshot(snapshot: any, input: MergeInput): MergeOutput {
  const prev = mergeStateOf(snapshot)
  const emptyChanges: MergeChanges = { added: [], updated: [], removed: [], kept: [] }
  const emptyCounts: MergeCounts = { added: 0, updated: 0, removed: 0, kept: 0 }
  if (Number(input.startVersion) < prev.version) {
    return {
      verdict: 'stale-dropped', reason: 'stale-result', snapshot: snapshot,
      version: snapshot && snapshot.version, changes: emptyChanges, counts: emptyCounts,
      missing: [], merge: prev, groups: {},
    }
  }

  const rows: any[] = Array.isArray(input.rows) ? input.rows.filter(function (row: any) { return row && typeof row === 'object' }) : []
  const issues: any[] = Array.isArray(snapshot && snapshot.issues) ? snapshot.issues : []
  const maps: any[] = Array.isArray(snapshot && snapshot.maps) ? snapshot.maps : []
  const incomingByKey = new Map<string, any>()
  for (let i = 0; i < rows.length; i += 1) {
    const key = delta.rowKey(rows[i])
    if (key) incomingByKey.set(key, rows[i])
  }
  const oldKeys = new Set<string>()
  for (let i = 0; i < issues.length; i += 1) oldKeys.add(delta.rowKey(issues[i]))
  const collectTicketKeys = function (map: any): void {
    const tickets = map && Array.isArray(map.tickets) ? map.tickets : []
    for (let i = 0; i < tickets.length; i += 1) oldKeys.add(delta.rowKey(tickets[i]))
  }
  for (let i = 0; i < maps.length; i += 1) collectTicketKeys(maps[i])

  // ---------- 一、逐行合并：位置不动，变了就地换内容，没变保留原对象 ----------
  const changes: MergeChanges = { added: [], updated: [], removed: [], kept: [] }
  const missing: string[] = []
  const mergedByKey = new Map<string, any>()
  const nextIssues: any[] = []
  for (let i = 0; i < issues.length; i += 1) {
    const oldRow = issues[i]
    const key = delta.rowKey(oldRow)
    const incoming = key ? incomingByKey.get(key) : undefined
    if (!incoming) {
      if (key) changes.kept.push(key)
      nextIssues.push(oldRow)
      continue
    }
    const merged = mergeRow(oldRow, incoming, input)
    if (merged.changed) {
      changes.updated.push(key)
      mergedByKey.set(key, merged.row)
      nextIssues.push(merged.row)
    } else {
      changes.kept.push(key)
      mergedByKey.set(key, oldRow)
      nextIssues.push(oldRow)
    }
  }

  // ---------- 二、新增：读路径进 missing（记待办），写回执允许时追加到尾部 ----------
  const appended: any[] = []
  for (let i = 0; i < rows.length; i += 1) {
    const key = delta.rowKey(rows[i])
    if (!key || oldKeys.has(key) || mergedByKey.has(key)) continue
    if (input.allowNewRows) {
      const copy = copyRow(rows[i])
      nextIssues.push(copy)
      mergedByKey.set(key, copy)
      appended.push(copy)
      changes.added.push(key)
    } else {
      missing.push(key)
    }
  }

  // ---------- 三、删除：只有行组完整、且调用方声明枚举了全部时才是证据 ----------
  const rowComplete = (!!input.provenance && input.provenance.fieldGroups.row === 'complete') ||
    (!input.provenance && input.completeness === 'complete')
  const removed = new Set<string>()
  if (rowComplete) {
    const incomingKeys = new Set<string>()
    for (let i = 0; i < rows.length; i += 1) {
      const key = delta.rowKey(rows[i])
      if (key) incomingKeys.add(key)
    }
    if (input.enumeratesAll) {
      oldKeys.forEach(function (key) { if (key && !incomingKeys.has(key)) removed.add(key) })
    }
    if (Array.isArray(input.removedKeys)) {
      for (let i = 0; i < input.removedKeys.length; i += 1) {
        const key = String(input.removedKeys[i] || '')
        if (key && oldKeys.has(key) && !incomingKeys.has(key)) removed.add(key)
      }
    }
  }
  let finalIssues: any[] = nextIssues
  if (removed.size > 0) {
    finalIssues = nextIssues.filter(function (row: any) { return !removed.has(delta.rowKey(row)) })
    removed.forEach(function (key) { changes.removed.push(key) })
  }

  // ---------- 四、地图子票行跟着走同一套合并；容器只在子票数组变化时换对象 ----------
  const mapChangedKeys: string[] = []
  const finalMaps: any[] = []
  for (let i = 0; i < maps.length; i += 1) {
    const map = maps[i]
    const tickets: any[] = Array.isArray(map && map.tickets) ? map.tickets : []
    let ticketsChanged = false
    const nextTickets: any[] = []
    for (let j = 0; j < tickets.length; j += 1) {
      const ticket = tickets[j]
      const key = delta.rowKey(ticket)
      if (removed.has(key)) { ticketsChanged = true; continue }
      const merged = mergedByKey.get(key)
      if (merged) {
        if (merged !== ticket) ticketsChanged = true
        nextTickets.push(merged)
        continue
      }
      const incoming = incomingByKey.get(key)
      if (!incoming) { nextTickets.push(ticket); continue }
      const mergedTicket = mergeRow(ticket, incoming, input)
      if (mergedTicket.changed) {
        ticketsChanged = true
        mapChangedKeys.push(key)
        mergedByKey.set(key, mergedTicket.row)
        nextTickets.push(mergedTicket.row)
      } else {
        mergedByKey.set(key, ticket)
        nextTickets.push(ticket)
      }
    }
    finalMaps.push(ticketsChanged ? Object.assign({}, map, { tickets: nextTickets }) : map)
  }

  // ---------- 五、版本门：接受则合并版本单调 +1，按表达的组盖章；信封契约版本不动 ----------
  const nextMergeVersion = Math.max(prev.version + 1, Number(input.startVersion) + 1)
  const stamped: Partial<Record<FieldGroup, MergeGroupStamp>> = {}
  const expressed = expressedGroups(rows, input)
  const stampSource: any = input.provenance || (rows.length > 0 ? rows[0].provenance : null)
  const source = stampSource && typeof stampSource.source === 'string' ? stampSource.source : 'unknown'
  const operation = stampSource && typeof stampSource.operation === 'string' ? stampSource.operation : 'merge'
  for (let i = 0; i < MERGE_GROUPS.length; i += 1) {
    const group = MERGE_GROUPS[i]
    const completeness = expressed[group]
    if (!completeness) continue
    const stamp: MergeGroupStamp = {
      version: nextMergeVersion, atMs: input.startedMs, source: source, operation: operation, completeness: completeness,
    }
    stamped[group] = stamp
  }
  const nextGroups: any = Object.assign({}, prev.groups, stamped)
  const nextMerge: MergeState = { version: nextMergeVersion, lastStartMs: input.startedMs, groups: nextGroups }

  const finalByKey = new Map<string, any>()
  for (let i = 0; i < finalIssues.length; i += 1) finalByKey.set(delta.rowKey(finalIssues[i]), finalIssues[i])
  const seeds: string[] = []
  for (let i = 0; i < changes.updated.length; i += 1) {
    const row = finalByKey.get(changes.updated[i])
    seeds.push(changes.updated[i] + '=' + String(row && row.state || '') + '|' + String(row && row.updatedAt || ''))
  }
  for (let i = 0; i < changes.added.length; i += 1) {
    const row = finalByKey.get(changes.added[i])
    seeds.push(changes.added[i] + '=' + String(row && row.state || '') + '|' + String(row && row.updatedAt || ''))
  }
  for (let i = 0; i < changes.removed.length; i += 1) seeds.push(changes.removed[i] + '=removed')
  for (let i = 0; i < mapChangedKeys.length; i += 1) seeds.push(mapChangedKeys[i] + '=map')
  seeds.push('merge:' + String(nextMergeVersion))
  const version = delta.nextVersion(snapshot && snapshot.version, seeds)

  const nextSnapshot = Object.assign({}, snapshot, { issues: finalIssues, maps: finalMaps, merge: nextMerge })
  const counts: MergeCounts = {
    added: changes.added.length, updated: changes.updated.length,
    removed: changes.removed.length, kept: changes.kept.length,
  }
  return {
    verdict: 'merged', reason: hasChanges(changes) ? 'rows-changed' : 'nothing-changed',
    snapshot: nextSnapshot, version: version, changes: changes, counts: counts,
    missing: missing, merge: nextMerge, groups: stamped,
  }
}
