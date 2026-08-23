/**
 * tracker/constants.js — 契约层枚举常量（host 与 client 共用）。
 *
 * 这里只放「跨端稳定」的枚举。取值一律小写 snake/短横线，避免与后端原始值混淆。
 * 后端在 normalize 阶段必须把这些值归一化成下面的形态（capability-by-fill，
 * 见 contract.js + capability.js）。GitHub 原值大写（OPEN/CLOSED）→ normalize 归一小写。
 */

/** 后端种类（registry 按此 id 注册/查找）。 */
export const BACKEND_KIND = Object.freeze({
  GITHUB: 'github',
  MARKDOWN: 'markdown',
  GITLAB: 'gitlab',
  OTHER: 'other', // 逃生舱（自由散文，非一等后端）
})

/** 归一化后的票状态（只两态：open / closed）。本地 markdown 的 Status 在此映射。 */
export const STATE = Object.freeze({
  OPEN: 'open',
  CLOSED: 'closed',
})

/** 票的类型（wayfinder 语义）：普通票 或 地图。注意：与本地 markdown 的 `Type:`（research/…）正交。 */
export const ISSUE_TYPE = Object.freeze({
  ISSUE: 'issue',
  MAP: 'map',
})

/** 面板快照模式（沿用现有面板 snapMode 口径）。 */
export const SNAP_MODE = Object.freeze({
  OK: 'ok',
  LOADING: 'loading',
  ERR: 'err',
})

/** 操作错误 kind（后端/契约层统一分类；登录引导、限流、权限等据此分流）。 */
export const ERROR_KIND = Object.freeze({
  ENV: 'env', // 环境缺工具/缺变量（category: 工具不可用、路径不存在）
  AUTH: 'auth', // 未登录 / 凭据失效 / 权限不足
  RATELIMIT: 'rateLimit',
  UNSUPPORTED: 'unsupported', // 该后端不实现某操作/字段（= 能力缺失）
  NOTFOUND: 'notfound', // 资源不存在（对应 GitHub 404；不区分具体 HTTP 码）
  NETWORK: 'network',
  PARSE: 'parse',
})

/** 契约层归一化规则版本（供 logging/审计引用）。 */
export const CONTRACT_VERSION = 1
