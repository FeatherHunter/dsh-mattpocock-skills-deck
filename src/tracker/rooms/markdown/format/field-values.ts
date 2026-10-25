// field-values.ts —— YAML 真源里与字段行有关的取值，唯一的手写读取层（#1500 S5）。
//
// 为什么有这一件：原来「实施票加粗字段叫什么名」（What to build / Blocked by / Status）、
// 「地图子票裸行叫什么名」（Type / Status / Blocked by）、「子票类型有哪几个词」
// （research / prototype / grilling / task）、「子票状态有哪两个词」（claimed / resolved），
// 在 original-fields.ts、create-render.ts、issues-status.ts 里各抄了一份。
// 上游只改 YAML 时，抄的那几份不会跟着变：新字段行会被判成旧布局，旧类型词会被当成不认识。
// 这一件只从生成物 MD_FORMAT 里读，代码里不再手写第二份 —— 模板改了，这里跟着改，各调用处自动跟上。
//
// 某一项在生成物里缺失时，回落到今天写死的那个字（与旧行为一字不差）：
// 生成物是构建时按 YAML 写出的，真源缺项属于异常，建票链路上不为此抛错，沿用旧字把票建出来。
import { MD_FORMAT } from './generated.js'

type LabelEntry = { label?: unknown; values?: unknown }
type ObjectEntry = { fields?: unknown; 'top-lines'?: unknown }

function objectsOf(): Record<string, ObjectEntry> {
  const root = MD_FORMAT as unknown as { objects?: unknown }
  if (root && typeof root.objects === 'object' && root.objects !== null) {
    return root.objects as Record<string, ObjectEntry>
  }
  return {}
}

function labelsOfList(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const one of list) {
    const entry = one as LabelEntry | null
    const label = entry && typeof entry.label === 'string' ? String(entry.label) : ''
    if (label && out.indexOf(label) < 0) out.push(label)
  }
  return out
}

function valuesOf(entry: unknown): string[] {
  const maybe = entry as LabelEntry | null
  const raw = maybe && Array.isArray(maybe.values) ? (maybe.values as unknown[]) : []
  return raw.filter((one) => typeof one === 'string').map((one) => String(one))
}

function topLineOf(kind: string, label: string): LabelEntry | null {
  const objs = objectsOf()
  const list = objs[kind] ? objs[kind]['top-lines'] : undefined
  if (!Array.isArray(list)) return null
  for (const one of list) {
    const entry = one as LabelEntry | null
    if (entry && entry.label === label) return entry
  }
  return null
}

/** 实施票的加粗字段行认哪几个名：原文模板 implementation-ticket 的 fields（今天是 What to build / Blocked by / Status）。 */
export const IMPL_TICKET_FIELD_LABELS: string[] = (() => {
  const objs = objectsOf()
  const got = labelsOfList(objs['implementation-ticket'] ? objs['implementation-ticket'].fields : undefined)
  return got.length ? got : ['What to build', 'Blocked by', 'Status']
})()

/** 地图子票标题下的裸行认哪几个名：原文模板 wayfinder-child 的 top-lines（今天是 Type / Status / Blocked by）。 */
export const WAYFINDER_TOP_LINE_LABELS: string[] = (() => {
  const objs = objectsOf()
  const got = labelsOfList(objs['wayfinder-child'] ? objs['wayfinder-child']['top-lines'] : undefined)
  return got.length ? got : ['Type', 'Status', 'Blocked by']
})()

/** 地图子票的类型词：原文模板 wayfinder-child 的 Type 行取值（今天是 research / prototype / grilling / task）。 */
export const MAP_TICKET_TYPES: string[] = (() => {
  const got = valuesOf(topLineOf('wayfinder-child', 'Type'))
  return got.length ? got : ['research', 'prototype', 'grilling', 'task']
})()

/** 地图子票的状态词：原文模板 wayfinder-child 的 Status 行取值（今天是 claimed / resolved）。
 *  只在本文件内部用（派生下面两个词），不导出：调用方只拿认好名字的词，不拿整张表。 */
const WAYFINDER_STATUS_VALUES: string[] = (() => {
  const got = valuesOf(topLineOf('wayfinder-child', 'Status'))
  return got.length ? got : ['claimed', 'resolved']
})()

/** 子票状态的两个词各取哪一个：按名字认，不按位置拿 —— YAML 只保证值，不保证顺序。
 *  找不到名字才按老位置回落（今天第一位 claimed、第二位 resolved），再没有沿用旧字。 */
function statusWord(want: string, at: number, fallback: string): string {
  for (const v of WAYFINDER_STATUS_VALUES) { if (v.toLowerCase() === want) return v }
  return WAYFINDER_STATUS_VALUES[at] || fallback
}
export const WAYFINDER_STATUS_CLAIMED: string = statusWord('claimed', 0, 'claimed')
export const WAYFINDER_STATUS_RESOLVED: string = statusWord('resolved', 1, 'resolved')

/** 把一组取值拼成正则里的「多选一」：特殊字符先转义，免得字段名里的符号被当成正则语法。 */
export function regexAlt(values: readonly string[]): string {
  return values.map((one) => String(one).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
}

/** wayfinder 类型标签认哪几个值：`wayfinder:<类型词>`，类型词与 Type 行同一份（只从 YAML 真源读）。
 *  收在这里是 S5 的一部分：拼法只写一处，create-render 与 map-render 共用，不再各拼一份。 */
export const WAYFINDER_LABEL_RE = new RegExp('^wayfinder:(' + regexAlt(MAP_TICKET_TYPES) + ')$')
