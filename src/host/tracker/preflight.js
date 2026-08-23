/**
 * tracker/preflight.js — preflight 环境门禁共享辅助 + 错误 kind 分类。
 *
 * 这里是「前置检查」的通用骨架：约定错误分类与统一错误形状，供各后端 preflight 复用。
 * 第一性原理（#124 定版）：错误分类必须把「环境问题（缺工具/缺文件）」与「资源不存在（404）」
 * 分开 —— 缺工具是环境问题（ENV），不是资源不存在（NOTFOUND），二者不可混。
 *
 * ⚠️ detect 已删（#124/#125 定版）：身份识别 = `matches`(boolean) + `select`(仲裁) +
 * `describe`(出 ref)，不再有 detect op；本文件只保留 preflight 门禁的共享分类与结果构造。
 * `kind:'conflict'` 由后端显式产生（If-Match 不匹配 / setBlockedBy 自环成环），经下方透传分支放行，不做 regex 派生。
 */

import { ERROR_KIND } from '../../shared/tracker/constants.js'

/** ERROR_KIND 的取值集合（注意：常量键是枚举名 ENV/AUTH/…，值才是 'env'/'auth'/…，必须按值判断）。 */
const KIND_VALUES = new Set(Object.values(ERROR_KIND))

/**
 * 统一错误形状（所有操作失败都归一化成这个，**返回**不 throw）。
 * @typedef {Object} TrackerError
 * @property {import('../../shared/tracker/constants.js').ERROR_KIND} kind
 * @property {string} message
 */

/**
 * 把原始错误分类成 ERROR_KIND。
 * @param {Error|Object|string|undefined} err
 * @returns {import('../../shared/tracker/constants.js').ERROR_KIND}
 */
export function classifyError(err) {
  // 已是规范的 TrackerError（含顶层 kind 或 error.kind）→ 直接透传，不重复分类
  // —— 覆盖 kind:'conflict' / 'unsupported'（后端显式产生，非 regex 派生）
  if (err && KIND_VALUES.has(err.kind)) return err.kind
  if (err && err.error && KIND_VALUES.has(err.error.kind)) return err.error.kind

  const msg = (err && typeof err === 'object')
    ? (err.message || err.stderr || err.stdout || (err.error && err.error.message) || '')
    : err
  const s = String(msg || '').toLowerCase()
  if (!s) return ERROR_KIND.NETWORK

  // 认证/权限
  if (/\bnot (logged )?in\b|\bauth\b|\b401\b|\b403\b|credential|unauthorized|permission denied/i.test(s)) return ERROR_KIND.AUTH
  // 限流
  if (/\brate ?limit\b|\b429\b/i.test(s)) return ERROR_KIND.RATELIMIT
  // 环境问题（缺工具/缺文件/无法识别命令）——必须在 NOTFOUND 之前判，否则被「not found」误吞
  if (/is not recognized|\bcommand not found\b|\bno such file\b|cannot find|not found in path|which:|ENOENT/i.test(s)) return ERROR_KIND.ENV
  // 资源不存在
  if (/not ?found|\b404\b/.test(s)) return ERROR_KIND.NOTFOUND
  // 不支持
  if (/unsupported|not supported|not implemented/i.test(s)) return ERROR_KIND.UNSUPPORTED
  // 解析
  if (/parse|invalid json|syntax/i.test(s)) return ERROR_KIND.PARSE
  // 网络
  if (/network|timed ?out|econn|eai_again|offline|timeout|fetch failed|enotfound/i.test(s)) return ERROR_KIND.NETWORK
  // 兜底：未知错误归 NETWORK（#124 定版「④ 兜底 network」——不与 env/资源问题混）
  return ERROR_KIND.NETWORK
}

/**
 * 构造一次统一失败结果（**返回**，不 throw）。
 * @param {import('../../shared/tracker/constants.js').ERROR_KIND} kind
 * @param {string} message
 * @returns {{ok: false, error: TrackerError}}
 */
export function fail(kind, message) {
  return { ok: false, error: { kind, message } }
}

export const PREFLIGHT = Object.freeze({ version: 1 })
