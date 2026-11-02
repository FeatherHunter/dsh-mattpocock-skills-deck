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
// #1832：五枚 triage 状态的跨后端名单住在契约层，与 deck 的单状态判据引同一份；这里只拿它当回退值。
import { TRIAGE_STATE_LABELS } from '../../../contract/triage-states.js'

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
 *  导出给 status.ts 判定「地图子票的可见 Status 是不是合法值」；其余调用方仍应拿下面认好名字的两个词。 */
export const WAYFINDER_STATUS_VALUES: string[] = (() => {
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

type StatusEntry = {
  'triage-roles'?: unknown
  completed?: unknown
  'legacy-default'?: unknown
  wayfinder?: unknown
}

function statusOf(): StatusEntry {
  const root = MD_FORMAT as unknown as { status?: unknown }
  if (root && typeof root.status === 'object' && root.status !== null) return root.status as StatusEntry
  return {}
}

function stringsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((one) => typeof one === 'string').map((one) => String(one))
}

/** 五种 triage 角色（needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix）。
 *  这是「状态」的正式词表：可见 Status 行只认这五个加上完成词。
 *  配置（status.triage-roles）是数据真源；读不到时回退到契约层的同一份名单（#1832，两边由门禁比对）。 */
export const TRIAGE_STATUS_ROLES: string[] = (() => {
  const got = stringsOf(statusOf()['triage-roles'])
  return got.length ? got : TRIAGE_STATE_LABELS.slice()
})()

/** 完成词（resolved / completed / closed / done）：可见 Status 行写它表示这张票已关闭。
 *  原文没给这组词，它是插件为「关票落一个结果」补的；与 triage 词表不混用。 */
export const COMPLETED_STATUS_VALUES: string[] = (() => {
  const got = stringsOf(statusOf().completed)
  return got.length ? got : ['resolved', 'completed', 'closed', 'done']
})()

/** 旧渲染器给 issue 文件默认写下的状态（ready-for-agent）。读旧文件时它只作兜底线索，
 *  不是新票的全局默认；新票默认按票型在 create 时决定。 */
export const STATUS_LEGACY_DEFAULT: string = (() => {
  const got = statusOf()['legacy-default']
  return typeof got === 'string' && got.trim() ? got : 'ready-for-agent'
})()

/** 把一组取值拼成正则里的「多选一」：特殊字符先转义，免得字段名里的符号被当成正则语法。 */
export function regexAlt(values: readonly string[]): string {
  return values.map((one) => String(one).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
}

/** wayfinder 类型标签认哪几个值：`wayfinder:<类型词>`，类型词与 Type 行同一份（只从 YAML 真源读）。
 *  收在这里是 S5 的一部分：拼法只写一处，create-render 与 map-render 共用，不再各拼一份。 */
export const WAYFINDER_LABEL_RE = new RegExp('^wayfinder:(' + regexAlt(MAP_TICKET_TYPES) + ')$')
