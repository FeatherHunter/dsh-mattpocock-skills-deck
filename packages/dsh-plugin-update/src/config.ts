// packages/dsh-plugin-update/src/config.ts —— 更新包的公共配置面（规格 #591 的字面落实）。
//
// 全程用“更新系统”指更新功能本身，用“更新包”指装着更新系统的这个 npm 包。电话指宿主对外提供的方法。
//
// 两个名字不要搞混：新包自己的名字是 dsh-plugin-update（包自己叫什么，见包内的 package.json）；
// 目标包名参数是要检查更新的那个包是谁（默认是当前插件的旧包名）。新包查谁，由调用方传入目标包名决定。
//
// 冻结语（规格 #591 第 9 到 14 条）：默认电话名、入参回参形状、配置写法、配方形状、事件字段基线、默认旧路径，
// 动其中任何一条即走破冰（另起讨论票），加可选键只需同步改文档与白名单。本文件只实现形状，不重议形状。

// 默认电话名前缀：不传即 wf，默认下三个电话名与现状一字不差（冻结）。
export const DEFAULT_PREFIX = 'wf'
// 三个电话的动作名（冻结：改任一名字即破冰）。
export const PHONE_ACTIONS = ['updateStatus', 'updateCheck', 'updateInstall'] as const
export type PhoneAction = (typeof PHONE_ACTIONS)[number]

// 默认目标包名：要检查更新的那个包是谁（当前插件的旧包名，冻结默认值）。
export const DEFAULT_TARGET_PACKAGE = 'dsh-mattpocock-skills-deck'
// 默认官方源（冻结默认值）。
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org/'
// 默认旧标识：落盘目录按插件标识派生时，取该值即回到旧路径（永久冻结特例）。
export const LEGACY_PLUGIN_ID = 'dsh-mattpocock-skills-deck'
// 默认旧路径原文：家目录下 updates 加旧标识加使用范围短指纹（永久冻结，一字不差）。
// 该字符串作为注释永不删除的特例保留在 store.ts 的实现里，这里只存字面常量。
export const LEGACY_DIR_SEGMENT = 'updates'
// 三个落盘文件名（冻结：保持三名不变）。
export const STATE_FILE = 'state.json'
export const LOCK_FILE = 'install.lock'
export const BACKUP_FILE = 'before.json'

// 时间默认值（冻结默认值，规格 #591 第 5 条）：联网超时 10 秒、凭证有效期 10 分钟、
// 安装时限 15 分钟、面板轮询 1 秒；2 秒复用窗口保持不变（不开放调节）。
export const DEFAULT_CHECK_TIMEOUT_MS = 10_000
export const DEFAULT_CONFIRMATION_TTL_MS = 10 * 60_000
export const DEFAULT_INSTALL_TIMEOUT_MS = 15 * 60_000
export const DEFAULT_PANEL_POLL_MS = 1_000
export const RECHECK_WINDOW_MS = 2_000
// 面板轮询下限 250 毫秒：防止忙循环（规格 #591 第 5 条）。
export const MIN_PANEL_POLL_MS = 250

// 建更新能力时调用方传入的配置（规格 #591 第 2 条：插件标识必填，其余全可选并带默认值）。
export interface UpdateConfigInput {
  // 插件标识：必填，非空字符串且不含路径分隔符。老调用补一个参数即可。
  pluginId: string
  // 电话名前缀：不传即 wf。默认下三个电话名与现状一字不差，新插件传自己的前缀即隔离。
  prefix?: string
  // 目标包名：要检查更新的那个包是谁，默认等于现状（旧包名）。
  targetPackageName?: string
  // 官方源：默认等于现状地址。
  registryUrl?: string
  // 目录根：默认走现推导（环境变量 DSH_HOME 优先，否则家目录下 .dsh）。
  homeDir?: string
  // 联网超时毫秒：默认 10 秒，须为有限大于 0 的数。
  checkTimeoutMs?: number
  // 凭证有效期毫秒：默认 10 分钟，须为有限大于 0 的数。
  confirmationTtlMs?: number
  // 安装时限毫秒：默认 15 分钟，须为有限大于 0 的数。
  installTimeoutMs?: number
  // 面板轮询毫秒：默认 1 秒，不得小于 250 毫秒。
  panelPollMs?: number
}

// 生效后的完整配置（无可选，调用处不再分支）。
export interface ResolvedUpdateConfig {
  pluginId: string
  prefix: string
  targetPackageName: string
  registryUrl: string
  homeDir: string | null
  checkTimeoutMs: number
  confirmationTtlMs: number
  installTimeoutMs: number
  panelPollMs: number
}

// 插件标识形状（规格 #591 第 2 条）：必填的非空字符串且不含路径分隔符。
export function assertPluginId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('[dsh-plugin-update] 插件标识 pluginId 必填：须为非空字符串（收到 ' + JSON.stringify(value) + '）')
  }
  if (value.includes('/') || value.includes('\\') || value.includes('\0')) {
    throw new Error('[dsh-plugin-update] 插件标识 pluginId 非法：不得含有路径分隔符（收到 ' + JSON.stringify(value) + '）')
  }
  return value
}

// 电话名前缀形状：非空，不含点与空白（点留作前缀与动作名之间的分隔符）。
export function assertPrefix(value: unknown, role: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('[dsh-plugin-update] ' + role + ' 非法：须为非空字符串（收到 ' + JSON.stringify(value) + '）')
  }
  if (value.includes('.') || value.includes('/') || value.includes('\\') || /\s/.test(value)) {
    throw new Error('[dsh-plugin-update] ' + role + ' 非法：不得含有点、路径分隔符或空白（收到 ' + JSON.stringify(value) + '）')
  }
  return value
}

function assertPositiveFinite(value: unknown, role: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('[dsh-plugin-update] ' + role + ' 非法：须为有限大于 0 的数（收到 ' + JSON.stringify(value) + '）')
  }
  return value
}

// 把调用方传入的配置补齐为完整配置（缺省全走规格默认值，不抛错；越界直接抛错）。
export function resolveUpdateConfig(input: UpdateConfigInput): ResolvedUpdateConfig {
  if (!input || typeof input !== 'object') {
    throw new Error('[dsh-plugin-update] 建更新能力缺少配置：插件标识 pluginId 必填')
  }
  const pluginId = assertPluginId(input.pluginId)
  const prefix = input.prefix === undefined ? DEFAULT_PREFIX : assertPrefix(input.prefix, '电话名前缀 prefix')
  const targetPackageName =
    input.targetPackageName === undefined ? DEFAULT_TARGET_PACKAGE : String(input.targetPackageName)
  if (!targetPackageName) {
    throw new Error('[dsh-plugin-update] 目标包名 targetPackageName 非法：须为非空字符串')
  }
  const registryUrl = input.registryUrl === undefined ? DEFAULT_REGISTRY : String(input.registryUrl)
  if (!registryUrl) {
    throw new Error('[dsh-plugin-update] 官方源 registryUrl 非法：须为非空字符串')
  }
  const homeDir = input.homeDir === undefined ? null : String(input.homeDir)
  const checkTimeoutMs =
    input.checkTimeoutMs === undefined ? DEFAULT_CHECK_TIMEOUT_MS : assertPositiveFinite(input.checkTimeoutMs, '联网超时 checkTimeoutMs')
  const confirmationTtlMs =
    input.confirmationTtlMs === undefined
      ? DEFAULT_CONFIRMATION_TTL_MS
      : assertPositiveFinite(input.confirmationTtlMs, '凭证有效期 confirmationTtlMs')
  const installTimeoutMs =
    input.installTimeoutMs === undefined ? DEFAULT_INSTALL_TIMEOUT_MS : assertPositiveFinite(input.installTimeoutMs, '安装时限 installTimeoutMs')
  const panelPollMs = input.panelPollMs === undefined ? DEFAULT_PANEL_POLL_MS : assertPositiveFinite(input.panelPollMs, '面板轮询 panelPollMs')
  if (panelPollMs < MIN_PANEL_POLL_MS) {
    throw new Error('[dsh-plugin-update] 面板轮询 panelPollMs 非法：不得小于 250 毫秒（收到 ' + JSON.stringify(input.panelPollMs) + '）')
  }
  return { pluginId, prefix, targetPackageName, registryUrl, homeDir, checkTimeoutMs, confirmationTtlMs, installTimeoutMs, panelPollMs }
}

// 三个电话名拼法（冻结：默认 wf 下与现状一字不差）。
export function buildPhoneNames(prefix: string): Record<PhoneAction, string> {
  const checked = assertPrefix(prefix, '电话名前缀 prefix')
  return {
    updateStatus: checked + '.updateStatus',
    updateCheck: checked + '.updateCheck',
    updateInstall: checked + '.updateInstall',
  }
}

// 单个电话名拼法（供门禁与面板复用）。
export function buildPhoneName(prefix: string, action: PhoneAction): string {
  return buildPhoneNames(prefix)[action]
}
