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
  // 电话名前缀：默认 wf。约束与插件标识相同。默认与插件标识相同，当前插件两者都是 wf。
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
  // 事件清单注入点位（#558 冻结的是点位本身：文件路径或对象两种方式二选一；
  // 清单内部一条事件有哪些字段由门禁票 #561 定，本票按不透明处理，只存不解析）。
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
  const prefix = input.prefix === undefined ? 'wf' : assertPluginId(input.prefix, '电话名前缀 prefix')
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
  return {
    pluginId: pluginId,
    prefix: prefix,
    logDirName: logDirName,
    switchFileName: switchFileName,
    fileNamePolicy: fileNamePolicy,
    maxQueue: Math.floor(maxQueue),
    eventList: input.eventList === undefined ? null : input.eventList
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
