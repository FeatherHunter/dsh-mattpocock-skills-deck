/**
 * tracker/constants.js — 契约层枚举常量（host 与 client 共用）。
 *
 * 这里只放「跨端稳定」的枚举。取值一律小写短横线/snake，避免与后端原始值混淆。
 * 后端在 normalize 阶段必须把这些值归一化成下面的形态（capability-by-fill，
 * 见 contract.js + capability.js）。GitHub 原值大写（OPEN/CLOSED）→ normalize 归一小写。
 *
 * ⚠️ 定版注意：`RepositoryRef.backend` 是开放 string（`BackendId`），**不再是枚举**。
 * 本文件的 `BACKEND_KIND` 因此只作「registry 内置 id 常量」与文档化的保留值，
 * 不充当字段类型（禁止再用它标注 `RepositoryRef.backend` / `BackendStatus.backend`）。
 */

/** 后端内置 id（registry 注册的一等后端；非字段类型）。 */
/**
 * @typedef {string} BackendId 后端 id（开放 string；仓库内唯一）。
 * 一等内置 `'github' | 'markdown' | 'gitlab'`（由 registry 注册）；
 * `'other'` 保留串**已弃用**——不再作为一等后端 id，也不在 registry 注册；
 * 表达「无后端」只走 `Selection.backendId: null`（此时不产出 RepositoryRef）。
 */
export const BACKEND_KIND = Object.freeze({
  GITHUB: 'github',
  MARKDOWN: 'markdown',
  GITLAB: 'gitlab',
})

/** 归一化后的票状态（只两态：open / closed）。本地 markdown 的 Status 在此映射（归 #115）。 */
export const STATE = Object.freeze({
  OPEN: 'open',
  CLOSED: 'closed',
})

/** 票的类型（wayfinder 语义）：普通票 或 地图。注意：与本地 markdown 的 `Type:`（research/…）正交。 */
export const ISSUE_TYPE = Object.freeze({
  ISSUE: 'issue',
  MAP: 'map',
})

/** 面板快照模式（沿用现有面板 snapMode 口径；与 tracker 数据形状解耦，仅客户端面板用）。 */
export const SNAP_MODE = Object.freeze({
  OK: 'ok',
  LOADING: 'loading',
  ERR: 'err',
})

/**
 * 关闭原因保留值（开放 string；未知→原样展示，不分支）。
 * ⚠️ `reason` 是能力字段：closed 时给原因；open 依后端支持情况给 `''`(EMPTY) 或省略(MISSING)。
 */
export const CLOSED_REASON = Object.freeze({
  COMPLETED: 'completed',
  NOT_PLANNED: 'not_planned',
  REOPENED: 'reopened',
  DUPLICATE: 'duplicate',
})

/** 参与人种类保留值（开放 string；识别机器人代理/组织）。 */
export const ACTOR_KIND = Object.freeze({
  USER: 'user',
  BOT: 'bot',
  ORGANIZATION: 'organization',
})

/** 自定义字段类型保留值（开放 string；说明性元数据，绝不驱动 deck 逻辑）。 */
export const FIELD_TYPE = Object.freeze({
  TEXT: 'text',
  NUMBER: 'number',
  DATE: 'date',
  SINGLE: 'single',
  MULTI: 'multi',
})

/** 操作错误 kind（后端/契约层统一分类；登录引导、限流、权限等据此分流）。 */
export const ERROR_KIND = Object.freeze({
  ENV: 'env', // 环境缺工具/缺变量（category: 工具不可用、路径不存在）
  AUTH: 'auth', // 未登录 / 凭据失效 / 权限不足
  RATELIMIT: 'rate-limit', // 限流（对齐库内「小写短横线」规范；旧值 'rateLimit' 已弃）
  CONFLICT: 'conflict', // 写前置失败 / 图不变量违反（如 If-Match 不匹配、setBlockedBy 自环/成环）
  UNSUPPORTED: 'unsupported', // 该后端不实现某操作/字段（= 能力缺失）
  NOTFOUND: 'not-found', // 资源不存在（对应 GitHub 404；不区分具体 HTTP 码；旧值 'notfound' 已弃）
  NETWORK: 'network',
  PARSE: 'parse',
})

/** 契约层归一化规则版本（供 logging/审计引用）。 */
export const CONTRACT_VERSION = 1
