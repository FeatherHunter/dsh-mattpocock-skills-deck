/**
 * shared/gh-timeout-tiers.js — gh 出站分档超时（#969 · T3 · 暂定值）。
 *
 * 为什么分档：读操作等得久会拖住界面，写操作杀得早会害用户不敢重试，
 * 探活（登录态、 zt 版本自检）本该最快——此前全仓只有一档 30000，谁都等满才放弃。
 * 慢网下超时必须归网络档（未知、稍后），不能误报没登录（见 callers 对 classify 的用法）。
 *
 * 暂定值（终值等 #967 测量回填，#966 收口执行）：
 *   读 12000 / 写 30000 / 探活 3000。
 * 报告人补丁与本票同值；上限参考（4 下限 / 64 上限）管的是并发数，不管超时，这里不混用。
 *
 * 纯函数：不读盘、不联网、不起定时器。调用方仍可用 opts.timeout 显式覆盖。
 */

export const READ_TIMEOUT_MS = 12000
export const WRITE_TIMEOUT_MS = 30000
export const PROBE_TIMEOUT_MS = 3000

/** 兼容旧默认：拿不到 argv 时沿用历史 30000，不静默变快。 */
export const DEFAULT_TIMEOUT_MS = 30000

function partsOf(args) {
  return (Array.isArray(args) ? args : []).map(function (a) { return String(a == null ? '' : a) })
}

/** 写操作动词：命中即走写档（超时最长，且调用方不许自动重试，见 #969）。 */
const WRITE_VERBS = new Set(['create', 'edit', 'close', 'reopen', 'comment', 'delete', 'lock', 'unlock', 'pin', 'unpin'])

function isApiWrite(parts) {
  // gh api 默认读；带 -X POST/PUT/PATCH/DELETE 或 --method 覆盖时才是写。
  if (parts[0] !== 'api') return false
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p === '-X' || p === '--method') {
      const m = String(parts[i + 1] || '').toUpperCase()
      if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') return true
    }
    if (/^--method=(post|put|patch|delete)$/i.test(p)) return true
  }
  return false
}

/**
 * 这条 gh 调用是不是写操作（ lighthouse：写档 + 不自动重试 + 记写世代，见 gh-write-generation）。
 */
export function isWriteGhArgs(args) {
  const parts = partsOf(args)
  if (parts.length < 2) return false
  if (parts[0] === 'issue' || parts[0] === 'pr') return WRITE_VERBS.has(parts[1])
  if (parts[0] === 'api') return isApiWrite(parts)
  if (parts[0] === 'label' || parts[0] === 'release') return true
  return false
}

/** 探活动词：登录态与版本自检，走最短档。 */
export function isProbeGhArgs(args) {
  const parts = partsOf(args)
  if (parts.length === 0) return false
  if (parts[0] === '--version') return true
  if (parts[0] === 'auth' && parts[1] === 'status') return true
  if (parts[0] === 'api' && String(parts[1] || '').indexOf('user') === 0 && parts.length <= 3) return true
  return false
}

/** 这条 gh 调用走哪一档：'write' | 'probe' | 'read'。 */
export function tierForGhArgs(args) {
  if (isWriteGhArgs(args)) return 'write'
  if (isProbeGhArgs(args)) return 'probe'
  return 'read'
}

/** 这一档的暂定超时毫秒数。 */
export function timeoutForTier(tier) {
  if (tier === 'write') return WRITE_TIMEOUT_MS
  if (tier === 'probe') return PROBE_TIMEOUT_MS
  return READ_TIMEOUT_MS
}

/** 这条 gh 调用的暂定超时毫秒数（调用方显式 timeout 优先）。 */
export function timeoutForGhArgs(args, explicitTimeout) {
  if (typeof explicitTimeout === 'number' && isFinite(explicitTimeout) && explicitTimeout > 0) return explicitTimeout
  return timeoutForTier(tierForGhArgs(args))
}
