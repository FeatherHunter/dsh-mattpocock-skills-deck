// packages/dsh-log/src/config.ts —— 日志包的公共配置面（#558 冻结清单的字面落实，本票不定形状，只实现）。
//
// 以后谁改它：改导入路径、配置默认值、电话名拼法、文件名策略、失败语义、清单注入点位、版本策略的人。
// 改动前先看 #558 拍板结论：破坏性变更有 5 类（电话改名、增删改入参回参形状、改配置写法、
// 改事件清单字段形状、改文件名策略的默认形状），碰了任何一类就要升大版本号。
// 全程用“日志系统”指日志功能本身，用“日志包”指装着日志系统的这个 npm 包。

// 防抖窗口 1000 毫秒（设计 2.2 字面：窗口内多次调用合并为一次读改写）。
export const LOG_DEBOUNCE_MS = 1000

// 宿主内存队列默认 1000 条封顶（#558 队列口径：满时按级别丢弃，只计数不抛错）。
export const DEFAULT_MAX_QUEUE = 1000

// 客户端批量转发口径（#558 队列口径，宿主包内只存字面供客户端引擎票 #560 引用）：
// 每批最多 50 条，每 1000 毫秒发一次，单包约 128KB 或队列 100 条先到先截，裁掉的记入丢弃数。
export const CLIENT_BATCH_MAX = 50
export const CLIENT_BATCH_INTERVAL_MS = 1000
export const CLIENT_PACKET_BYTES = 128 * 1024
export const CLIENT_QUEUE_MAX = 100

// 兼容旧字面：插件标识为 wf 时，目录名与开关文件名与现状一字不差。
export const LEGACY_LOG_DIR_NAME = 'logs'
export const LEGACY_SWITCH_FILE_NAME = 'log-switch.json'

// 宿主电话的 5 个动作名（#558 冻结：动作名不变，只许前缀参数化）。
export const PHONE_ACTIONS = ['logBatch', 'logExport', 'logClear', 'logGetSwitch', 'logSetSwitch'] as const
export type PhoneAction = (typeof PHONE_ACTIONS)[number]

// 文件名策略：daily 为默认（按天，年月日点 log，迁移首版不改落盘形状）；
// four-segment 只作为可选项（四段为日期点插件标识点进程号点启动时间）。
export type FileNamePolicy = 'daily' | 'four-segment'

// 建日志库时调用方传入的配置（#558 Q3：必填只有插件标识，其余全可选且有默认值）。
export interface HostLogConfigInput {
  // 插件标识：必填，无默认。只能用小写英文字母、数字、中横线，长度 1 到 32。
  pluginId: string
  // 电话名前缀：不传时回退到插件标识（即前缀默认等于插件标识，当前插件两者都是 wf，主路径仍为 wf.*）。
  // 约束与插件标识相同。
  prefix?: string
  // 日志子目录名：默认派生，标识为 wf 时为 logs，其他标识时为 logs 加中横线加标识。允许显式覆盖。
  logDirName?: string
  // 开关文件名：默认派生，标识为 wf 时为 log-switch.json，
  // 其他标识时为 log-switch 加中横线加标识再加 .json。允许显式覆盖。
  switchFileName?: string
  // 文件名策略：默认 daily。四段式只作可选项。
  fileNamePolicy?: FileNamePolicy
  // 宿主内存队列上限：默认 1000 条。
  maxQueue?: number
  // 事件清单注入点位（#558 冻结的是点位本身：文件路径或对象两种方式二选一，本票 #561 定为对象形式；
  // 清单内部一条事件有哪些字段见本文件下方的事件清单一节）。
  // 传对象当场验形状，错了直接报错；传字符串（路径）只存不解析，由调用方自己读成对象再传入，
  // 日志包不读盘；不传为 null（当前插件主路径），行为零变化。
  eventList?: string | Record<string, unknown>
}

// 生效后的完整配置（无可选，调用处不再分支）。
export interface ResolvedHostLogConfig {
  pluginId: string
  prefix: string
  logDirName: string
  switchFileName: string
  fileNamePolicy: FileNamePolicy
  maxQueue: number
  eventList: string | Record<string, unknown> | null
}

// 插件标识与前缀的字符约束（#558 冻结）：只能用小写英文字母、数字、中横线，长度 1 到 32；
// 不许含点（点留作前缀与动作名之间的分隔符）；收到大写直接报错，不做静默转小写；
// 不许含文件不安全字符（斜杠、反斜杠、冒号、星号、问号、引号、尖括号、竖线、空格），
// 拼进目录名与文件名后必须仍是合法名字。
const ID_PATTERN = /^[a-z0-9-]{1,32}$/

export function assertPluginId(value: unknown, role: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error(
      '[dsh-log] ' + role + ' 非法：只能用小写英文字母、数字、中横线，长度 1 到 32（收到 ' + JSON.stringify(value) + '）'
    )
  }
  return value
}

// 把调用方传入的配置补齐为完整配置（缺省全走 #558 默认派生，不抛错；非法才抛错）。
export function resolveHostLogConfig(input: HostLogConfigInput): ResolvedHostLogConfig {
  if (!input || typeof input !== 'object') throw new Error('[dsh-log] 建日志库缺少配置：插件标识 pluginId 必填')
  const pluginId = assertPluginId(input.pluginId, '插件标识 pluginId')
  const prefix = input.prefix === undefined ? pluginId : assertPluginId(input.prefix, '电话名前缀 prefix')
  const logDirName =
    input.logDirName !== undefined
      ? input.logDirName
      : pluginId === 'wf'
        ? LEGACY_LOG_DIR_NAME
        : LEGACY_LOG_DIR_NAME + '-' + pluginId
  const switchFileName =
    input.switchFileName !== undefined
      ? input.switchFileName
      : pluginId === 'wf'
        ? LEGACY_SWITCH_FILE_NAME
        : 'log-switch-' + pluginId + '.json'
  const fileNamePolicy = input.fileNamePolicy === undefined ? 'daily' : input.fileNamePolicy
  if (fileNamePolicy !== 'daily' && fileNamePolicy !== 'four-segment') {
    throw new Error('[dsh-log] 文件名策略 fileNamePolicy 非法：只许 daily 或 four-segment')
  }
  const maxQueue = input.maxQueue === undefined ? DEFAULT_MAX_QUEUE : input.maxQueue
  if (typeof maxQueue !== 'number' || !isFinite(maxQueue) || maxQueue < 1) {
    throw new Error('[dsh-log] 内存队列上限 maxQueue 非法：必须是不小于 1 的数字')
  }
  const eventList = input.eventList === undefined ? null : input.eventList
  if (eventList !== null && typeof eventList === 'object') {
    // 对象形式的清单当场验形状，错了直接报错（与插件标识非法的处理一致）；
    // 数组形式同样走验形口径被拦下（只收对象，数组多半是把事件表直接当成了清单）；
    // 字符串（路径）形式仍只存不解析，由调用方自己读成对象再传入，日志包不读盘；
    // 默认 null（当前插件主路径）原样透过，行为零变化。
    parseEventListManifest(eventList)
  }
  return {
    pluginId: pluginId,
    prefix: prefix,
    logDirName: logDirName,
    switchFileName: switchFileName,
    fileNamePolicy: fileNamePolicy,
    maxQueue: Math.floor(maxQueue),
    eventList: eventList
  }
}

// 新电话名 = 前缀 + 点 + 动作名（#558 Q1：默认前缀 wf 下 5 个字面与现状一字不差）。
export function buildPhoneName(prefix: string, action: PhoneAction): string {
  return assertPluginId(prefix, '电话名前缀 prefix') + '.' + action
}

export type PhoneNameMap = Record<PhoneAction, string>

// 一次拼出 5 个电话名（前缀只隔离电话名，磁盘隔离靠目录与开关文件名的默认派生）。
export function buildPhoneNames(prefix: string): PhoneNameMap {
  const checked = assertPluginId(prefix, '电话名前缀 prefix')
  const names = {} as PhoneNameMap
  for (const action of PHONE_ACTIONS) names[action] = checked + '.' + action
  return names
}

// 按天文件名：每个自然天一个文件，命名 YYYY-MM-DD.log（如 2026-09-06.log）。只分桶，不自动清理。
export function formatDailyFileName(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.log'
}

// 四段式文件名（#558 Q2b 定死）：日期点插件标识点进程号点启动时间。
// 插件名取配置里的插件标识，进程号取不到时回退 0，
// 启动时间取宿主建日志库那一刻（以启动头写入的 startedAt 为准）。
// 启动时间里的冒号与斜杠在文件名里不合法，转写为中横线后才拼入。
export function formatFourSegmentFileName(
  date: Date | string | number,
  pluginId: string,
  pid: number,
  startedAt: string
): string {
  const d = date instanceof Date ? date : new Date(date)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const day = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  const safeId = assertPluginId(pluginId, '插件标识 pluginId')
  const safePid = typeof pid === 'number' && isFinite(pid) && pid > 0 ? Math.floor(pid) : 0
  const safeStartedAt = String(startedAt || '').replace(/[:/\\]/g, '-')
  return day + '.' + safeId + '.' + safePid + '.' + safeStartedAt + '.log'
}

// 按策略算出当天文件名（默认 daily，与现状同形）。
export function resolveLogFileName(
  config: ResolvedHostLogConfig,
  date: Date | string | number,
  pid: number,
  startedAt: string
): string {
  if (config.fileNamePolicy === 'four-segment') {
    return formatFourSegmentFileName(date, config.pluginId, pid, startedAt)
  }
  return formatDailyFileName(date)
}

// 清空与导出里按文件名匹配的正则随策略分支（#558 Q2b）：
// daily 走现有按天正则，四段式走对应的四段正则。
export function logFileNamePattern(config: ResolvedHostLogConfig): RegExp {
  if (config.fileNamePolicy === 'four-segment') {
    return /^\d{4}-\d{2}-\d{2}\.[a-z0-9-]{1,32}\.\d+\..+\.log$/
  }
  return /^\d{4}-\d{2}-\d{2}\.log$/
}

// 日期入参（YYYY-MM-DD）按策略选出要导出的文件名：daily 直接加 .log（沿现状）；
// 四段式下指定日期匹配该日期开头的所有四段文件，取排序后第一个，找不到回退到当天文件名。
export function matchExportFileName(
  config: ResolvedHostLogConfig,
  candidates: string[],
  wantDate: string,
  fallbackFileName: string
): string {
  if (config.fileNamePolicy !== 'four-segment') {
    return /^\d{4}-\d{2}-\d{2}$/.test(wantDate) ? wantDate + '.log' : fallbackFileName
  }
  const pattern = logFileNamePattern(config)
  const hits = (Array.isArray(candidates) ? candidates : [])
    .filter((name) => typeof name === 'string' && pattern.test(name) && name.indexOf(wantDate + '.') === 0)
    .sort()
  return hits.length > 0 ? hits[0] : fallbackFileName
}

// ---- 事件清单（#561）：各插件自己的事件清单格式与通用检查器 ----
//
// 一句话背景：#558 只冻了清单的注入点位（配置键 eventList），清单内部一条事件有哪些字段由本票定。
// 本票选对象形式：调用方把清单拼成对象传进来，日志包不读盘，包内永不出现仓库路径的字面量。
// 全程用“日志系统”指日志功能本身，用“日志包”指装着日志系统的这个 npm 包。
//
// 清单长这样（空模板见包内的 event-list.template.json）：
//
//   {
//     "version": 1,
//     "pluginId": "wf",
//     "counts": { "resident": 30, "ondemand": 20, "selfmon": 5 },
//     "events": {
//       "gh.exec": {
//         "level": "info",
//         "kind": "resident",
//         "fields": ["argv0", "cwdHash", "latencyMs", "kind", "exitCode"],
//         "codes": ["H_CWD", "B_TOKEN"],
//         "rules": ["R_TOKEN_BEARER", "R_GH_TOKEN"]
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

// 事件级别（沿用附录定版：错误与告警始终落盘，信息中常驻落盘，其余只在调试开关打开时落盘）。
export const EVENT_LEVELS = ['error', 'warn', 'info', 'debug'] as const
export type LogEventLevel = (typeof EVENT_LEVELS)[number]

// 事件归类（只为计数检查服务，与级别是两回事：级别管落不落盘，归类管数对不对）。
export const EVENT_KINDS = ['resident', 'ondemand', 'selfmon'] as const
export type LogEventKind = (typeof EVENT_KINDS)[number]

export interface LogEventEntry {
  // 级别：error、warn、info、debug 四选一。
  level: LogEventLevel
  // 归类：resident、ondemand、selfmon 三选一。
  kind: LogEventKind
  // 允许字段：该事件能记的全部字段键，之外的键一律不记。
  fields: string[]
  // 脱敏引用：截断或散列代号（如 H_CWD、T120），无则不写或空数组。
  codes?: string[]
  // 脱敏引用：具名正则名（如 R_WIN_ABS），该事件无自由文本则不写或空数组。
  rules?: string[]
  // 守卫说明：一句话写清采样或节流，无特殊守卫不写。
  guard?: string
}

export interface LogEventCounts {
  resident: number
  ondemand: number
  selfmon: number
}

export interface LogEventList {
  // 清单格式版本：现在只有 1，收到别的数字直接报错。
  version: 1
  // 清单属于哪个插件：与建日志库的插件标识同一约束。
  pluginId: string
  // 自报计数：三类各自条数，检查器会拿实际条数逐项核对。
  counts: LogEventCounts
  // 事件表：键是事件名，值是该事件的级别、归类、允许字段与脱敏引用。
  events: Record<string, LogEventEntry>
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function assertStringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value)) throw new Error('[dsh-log] 事件清单 eventList 非法：' + what + ' 必须是字符串数组')
  const seen: string[] = []
  for (const item of value) {
    if (!isNonEmptyString(item)) throw new Error('[dsh-log] 事件清单 eventList 非法：' + what + ' 里有空字段名')
    if (seen.indexOf(item) >= 0) throw new Error('[dsh-log] 事件清单 eventList 非法：' + what + ' 里字段名重复：' + item)
    seen.push(item)
  }
  return seen
}

// 把调用方传进来的值验成可用的事件清单：错了直接报错，不静默修补。
// 字符串（路径）形式在这里就被拦下：调用方先把清单文件读成对象再传入，日志包不读盘。
export function parseEventListManifest(value: unknown): LogEventList {
  if (typeof value === 'string') {
    throw new Error('[dsh-log] 事件清单 eventList 非法：路径形式请调用方自己读成对象再传入，日志包不读盘')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('[dsh-log] 事件清单 eventList 非法：只收对象形式（空模板见包内的 event-list.template.json）')
  }
  const input = value as Record<string, unknown>
  if (input['version'] !== 1) {
    throw new Error('[dsh-log] 事件清单 eventList 非法：version 现在只认 1（收到 ' + JSON.stringify(input['version']) + '）')
  }
  const pluginId = assertPluginId(input['pluginId'], '事件清单 pluginId')
  const countsRaw = input['counts']
  if (!countsRaw || typeof countsRaw !== 'object' || Array.isArray(countsRaw)) {
    throw new Error('[dsh-log] 事件清单 eventList 非法：counts 必须是含三类计数的对象')
  }
  const countsRecord = countsRaw as Record<string, unknown>
  const counts: LogEventCounts = { resident: 0, ondemand: 0, selfmon: 0 }
  for (const kind of EVENT_KINDS) {
    const n = countsRecord[kind]
    if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n || n < 0) {
      throw new Error('[dsh-log] 事件清单 eventList 非法：counts.' + kind + ' 必须是非负整数')
    }
    counts[kind] = n
  }
  const eventsRaw = input['events']
  if (!eventsRaw || typeof eventsRaw !== 'object' || Array.isArray(eventsRaw)) {
    throw new Error('[dsh-log] 事件清单 eventList 非法：events 必须是事件名到条目的对象')
  }
  const events: Record<string, LogEventEntry> = {}
  for (const name of Object.keys(eventsRaw as Record<string, unknown>)) {
    events[name] = parseEventEntry(name, (eventsRaw as Record<string, unknown>)[name])
  }
  return { version: 1, pluginId: pluginId, counts: counts, events: events }
}

// 验清单里的一条事件：级别与归类必须是枚举值，条目里不认多余的键（多半是拼写错误）。
function parseEventEntry(name: string, value: unknown): LogEventEntry {
  if (!isNonEmptyString(name)) throw new Error('[dsh-log] 事件清单 eventList 非法：事件名不能为空')
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('[dsh-log] 事件清单 eventList 非法：事件 ' + name + ' 必须是对象')
  }
  const input = value as Record<string, unknown>
  if (EVENT_LEVELS.indexOf(input['level'] as LogEventLevel) < 0) {
    throw new Error('[dsh-log] 事件清单 eventList 非法：事件 ' + name + ' 的 level 只许 error、warn、info、debug')
  }
  if (EVENT_KINDS.indexOf(input['kind'] as LogEventKind) < 0) {
    throw new Error('[dsh-log] 事件清单 eventList 非法：事件 ' + name + ' 的 kind 只许 resident、ondemand、selfmon')
  }
  for (const key of Object.keys(input)) {
    if (['level', 'kind', 'fields', 'codes', 'rules', 'guard'].indexOf(key) < 0) {
      throw new Error('[dsh-log] 事件清单 eventList 非法：事件 ' + name + ' 有不认识的键 ' + key)
    }
  }
  const entry: LogEventEntry = {
    level: input['level'] as LogEventLevel,
    kind: input['kind'] as LogEventKind,
    fields: assertStringArray(input['fields'], '事件 ' + name + ' 的 fields')
  }
  if (input['codes'] !== undefined) entry.codes = assertStringArray(input['codes'], '事件 ' + name + ' 的 codes')
  if (input['rules'] !== undefined) entry.rules = assertStringArray(input['rules'], '事件 ' + name + ' 的 rules')
  if (input['guard'] !== undefined) {
    if (typeof input['guard'] !== 'string') {
      throw new Error('[dsh-log] 事件清单 eventList 非法：事件 ' + name + ' 的 guard 必须是字符串')
    }
    entry.guard = input['guard'] as string
  }
  return entry
}

export interface EventFieldCheck {
  ok: boolean
  // 事件名根本不在清单里（调用方拼错名或清单漏登记）。
  unknownEvent: boolean
  // 在清单里但不在该事件允许字段里的键。
  unknownFields: string[]
}

// 字段白名单检查：拿插件自己的清单当尺子，量一批实际字段键。
// 未知事件名、未知字段键都算不通过，并把名单带回给调用方。
export function checkEventFields(
  manifest: LogEventList,
  eventName: string,
  fieldNames: string[]
): EventFieldCheck {
  const entry = manifest.events[eventName]
  if (!entry) return { ok: false, unknownEvent: true, unknownFields: [] }
  const allowed = new Set(entry.fields)
  const unknownFields = (Array.isArray(fieldNames) ? fieldNames : []).filter(
    (field) => !allowed.has(field)
  )
  return { ok: unknownFields.length === 0, unknownEvent: false, unknownFields: unknownFields }
}

export interface EventCountCheck {
  ok: boolean
  // 每条问题都是完整的一句话，调用方直接打印即可。
  problems: string[]
}

// 计数检查：按归类数实际条数，与清单自报的 counts 逐项核对；总数是三项之和，自然带住。
// 增删事件必须同步改清单的 counts，否则这里变红。
export function checkEventCounts(manifest: LogEventList): EventCountCheck {
  const actual: LogEventCounts = { resident: 0, ondemand: 0, selfmon: 0 }
  for (const name of Object.keys(manifest.events)) {
    actual[manifest.events[name].kind] += 1
  }
  const problems: string[] = []
  for (const kind of EVENT_KINDS) {
    if (actual[kind] !== manifest.counts[kind]) {
      problems.push(
        '[dsh-log] 事件清单计数对不上：' + kind + ' 类实际 ' + actual[kind] + ' 条，清单自报 ' + manifest.counts[kind] + ' 条'
      )
    }
  }
  return { ok: problems.length === 0, problems: problems }
}
