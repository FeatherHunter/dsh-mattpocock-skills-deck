// packages/dsh-plugin-update/src/gate.ts —— 更新包的门禁模板检查器（#584 落地门禁模板）。
//
// 给第二个接入更新包的插件自查用：字段白名单检查与三类计数检查，配包内的空模板
// event-list.template.json 一起用。形状与日志包的事件清单完全一致（版本号、插件标识、
// 三类自报计数、事件表），已经用过日志包的插件可以直接照抄写法。
//
// 全程用“更新系统”指更新功能本身，用“更新包”指装着更新系统的这个 npm 包。
// 电话指宿主对外提供的方法；落盘指宿主统一写本地文件的动作。
//
// 清单长这样（空模板见包内的 event-list.template.json）：
//
//   {
//     "version": 1,
//     "pluginId": "my-plugin",
//     "counts": { "resident": 3, "ondemand": 0, "selfmon": 0 },
//     "events": {
//       "host.call": {
//         "level": "info",
//         "kind": "resident",
//         "fields": ["method", "latencyMs", "ok", "kind", "pluginId"],
//         "codes": ["H_CWD"],
//         "rules": []
//       }
//     }
//   }
//
// 每条事件四样东西：事件名（events 的键）、级别（level）、允许字段（fields，之外不记）、
// 脱敏引用（codes 是截断或散列代号、rules 是具名正则名，都是引用名，命中只记规则名不记原文）。
// kind 说明这条归哪类计数：resident 常驻（始终落盘的轻量轨迹）、ondemand 按需（只在调试开关
// 打开时记）、selfmon 自监控（日志管道自己的故障行，错误与告警级、始终落盘）。
// guard 可选，一句话写清守卫（如百分之一采样、节流），无特殊守卫不写。
//
// 通用检查器只收对象，不读文件：checkEventFields 做字段白名单检查，checkEventCounts 做计数检查。
// 检查器是纯函数（不跨进程、不碰磁盘、无定时器、无新电话），不触发日志埋点纪律里的五种变动，
// 所以不新增日志点；也未新增日志事件，附录第 1 章对照表不用动。
// 本仓现有 55 事件对照仍以 research/489-appendix.md 与 tests/verify-log-*.js 为准，
// 本包只给格式与检查器，不复刻那张表，免得两处对照要双写同步。
//
// 冻结说明：清单格式版本现在只有 1；三个旧事件加完标识后的键集合为基线
// （成功事件 5 键、失败事件 4 键、执行事件 5 键，见规格 #591 第 8、13 条），
// 本文件不定基线，只给检查形状的尺子。

import { assertPluginId } from './config.js'

// 事件级别（沿用附录定版：错误与告警始终落盘，信息中常驻落盘，其余只在调试开关打开时落盘）。
export const EVENT_LEVELS = ['error', 'warn', 'info', 'debug'] as const
export type GateEventLevel = (typeof EVENT_LEVELS)[number]

// 事件归类（只为计数检查服务，与级别是两回事：级别管落不落盘，归类管数对不对）。
export const EVENT_KINDS = ['resident', 'ondemand', 'selfmon'] as const
export type GateEventKind = (typeof EVENT_KINDS)[number]

export interface GateEventEntry {
  // 级别：error、warn、info、debug 四选一。
  level: GateEventLevel
  // 归类：resident、ondemand、selfmon 三选一。
  kind: GateEventKind
  // 允许字段：该事件能记的全部字段键，之外的键一律不记。
  fields: string[]
  // 脱敏引用：截断或散列代号（如 H_CWD、T120），无则不写或空数组。
  codes?: string[]
  // 脱敏引用：具名正则名（如 R_WIN_ABS），该事件无自由文本则不写或空数组。
  rules?: string[]
  // 守卫说明：一句话写清采样或节流，无特殊守卫不写。
  guard?: string
}

export interface GateEventCounts {
  resident: number
  ondemand: number
  selfmon: number
}

export interface GateEventList {
  // 清单格式版本：现在只有 1，收到别的数字直接报错。
  version: 1
  // 清单属于哪个插件：与建更新能力的插件标识同一约束（非空且不含路径分隔符）。
  pluginId: string
  // 自报计数：三类各自条数，检查器会拿实际条数逐项核对。
  counts: GateEventCounts
  // 事件表：键是事件名，值是该事件的级别、归类、允许字段与脱敏引用。
  events: Record<string, GateEventEntry>
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function assertStringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value)) throw new Error('[dsh-plugin-update] 事件清单 eventList 非法：' + what + ' 必须是字符串数组')
  const seen: string[] = []
  for (const item of value) {
    if (!isNonEmptyString(item)) throw new Error('[dsh-plugin-update] 事件清单 eventList 非法：' + what + ' 里有空字段名')
    if (seen.indexOf(item) >= 0) throw new Error('[dsh-plugin-update] 事件清单 eventList 非法：' + what + ' 里字段名重复：' + item)
    seen.push(item)
  }
  return seen
}

// 把调用方传进来的值验成可用的事件清单：错了直接报错，不静默修补。
// 字符串（路径）形式在这里就被拦下：调用方先把清单文件读成对象再传入，更新包不读盘。
export function parseEventListManifest(value: unknown): GateEventList {
  if (typeof value === 'string') {
    throw new Error('[dsh-plugin-update] 事件清单 eventList 非法：路径形式请调用方自己读成对象再传入，更新包不读盘')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('[dsh-plugin-update] 事件清单 eventList 非法：只收对象形式（空模板见包内的 event-list.template.json）')
  }
  const input = value as Record<string, unknown>
  if (input['version'] !== 1) {
    throw new Error('[dsh-plugin-update] 事件清单 eventList 非法：version 现在只认 1（收到 ' + JSON.stringify(input['version']) + '）')
  }
  const pluginId = assertPluginId(input['pluginId'])
  const countsRaw = input['counts']
  if (!countsRaw || typeof countsRaw !== 'object' || Array.isArray(countsRaw)) {
    throw new Error('[dsh-plugin-update] 事件清单 eventList 非法：counts 必须是含三类计数的对象')
  }
  const countsRecord = countsRaw as Record<string, unknown>
  const counts: GateEventCounts = { resident: 0, ondemand: 0, selfmon: 0 }
  for (const kind of EVENT_KINDS) {
    const n = countsRecord[kind]
    if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n || n < 0) {
      throw new Error('[dsh-plugin-update] 事件清单 eventList 非法：counts.' + kind + ' 必须是非负整数')
    }
    counts[kind] = n
  }
  const eventsRaw = input['events']
  if (!eventsRaw || typeof eventsRaw !== 'object' || Array.isArray(eventsRaw)) {
    throw new Error('[dsh-plugin-update] 事件清单 eventList 非法：events 必须是事件名到条目的对象')
  }
  const events: Record<string, GateEventEntry> = {}
  for (const name of Object.keys(eventsRaw as Record<string, unknown>)) {
    events[name] = parseEventEntry(name, (eventsRaw as Record<string, unknown>)[name])
  }
  return { version: 1, pluginId: pluginId, counts: counts, events: events }
}

// 验清单里的一条事件：级别与归类必须是枚举值，条目里不认多余的键（多半是拼写错误）。
function parseEventEntry(name: string, value: unknown): GateEventEntry {
  if (!isNonEmptyString(name)) throw new Error('[dsh-plugin-update] 事件清单 eventList 非法：事件名不能为空')
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('[dsh-plugin-update] 事件清单 eventList 非法：事件 ' + name + ' 必须是对象')
  }
  const input = value as Record<string, unknown>
  if ((EVENT_LEVELS as readonly string[]).indexOf(input['level'] as string) < 0) {
    throw new Error('[dsh-plugin-update] 事件清单 eventList 非法：事件 ' + name + ' 的 level 只许 error、warn、info、debug')
  }
  if ((EVENT_KINDS as readonly string[]).indexOf(input['kind'] as string) < 0) {
    throw new Error('[dsh-plugin-update] 事件清单 eventList 非法：事件 ' + name + ' 的 kind 只许 resident、ondemand、selfmon')
  }
  for (const key of Object.keys(input)) {
    if (['level', 'kind', 'fields', 'codes', 'rules', 'guard'].indexOf(key) < 0) {
      throw new Error('[dsh-plugin-update] 事件清单 eventList 非法：事件 ' + name + ' 有不认识的键 ' + key)
    }
  }
  const entry: GateEventEntry = {
    level: input['level'] as GateEventLevel,
    kind: input['kind'] as GateEventKind,
    fields: assertStringArray(input['fields'], '事件 ' + name + ' 的 fields')
  }
  if (input['codes'] !== undefined) entry.codes = assertStringArray(input['codes'], '事件 ' + name + ' 的 codes')
  if (input['rules'] !== undefined) entry.rules = assertStringArray(input['rules'], '事件 ' + name + ' 的 rules')
  if (input['guard'] !== undefined) {
    if (typeof input['guard'] !== 'string') {
      throw new Error('[dsh-plugin-update] 事件清单 eventList 非法：事件 ' + name + ' 的 guard 必须是字符串')
    }
    entry.guard = input['guard'] as string
  }
  return entry
}

export interface GateFieldCheck {
  ok: boolean
  // 事件名根本不在清单里（调用方拼错名或清单漏登记）。
  unknownEvent: boolean
  // 在清单里但不在该事件允许字段里的键。
  unknownFields: string[]
}

// 字段白名单检查：拿插件自己的清单当尺子，量一批实际字段键。
// 未知事件名、未知字段键都算不通过，并把名单带回给调用方。
export function checkEventFields(
  manifest: GateEventList,
  eventName: string,
  fieldNames: string[]
): GateFieldCheck {
  const entry = manifest.events[eventName]
  if (!entry) return { ok: false, unknownEvent: true, unknownFields: [] }
  const allowed = new Set(entry.fields)
  const unknownFields = (Array.isArray(fieldNames) ? fieldNames : []).filter(
    (field) => !allowed.has(field)
  )
  return { ok: unknownFields.length === 0, unknownEvent: false, unknownFields: unknownFields }
}

export interface GateCountCheck {
  ok: boolean
  // 每条问题都是完整的一句话，调用方直接打印即可。
  problems: string[]
}

// 计数检查：按归类数实际条数，与清单自报的 counts 逐项核对；总数是三项之和，自然带住。
// 增删事件必须同步改清单的 counts，否则这里变红。
export function checkEventCounts(manifest: GateEventList): GateCountCheck {
  const actual: GateEventCounts = { resident: 0, ondemand: 0, selfmon: 0 }
  for (const name of Object.keys(manifest.events)) {
    actual[manifest.events[name].kind] += 1
  }
  const problems: string[] = []
  for (const kind of EVENT_KINDS) {
    if (actual[kind] !== manifest.counts[kind]) {
      problems.push(
        '[dsh-plugin-update] 事件清单计数对不上：' + kind + ' 类实际 ' + actual[kind] + ' 条，清单自报 ' + manifest.counts[kind] + ' 条'
      )
    }
  }
  return { ok: problems.length === 0, problems: problems }
}
