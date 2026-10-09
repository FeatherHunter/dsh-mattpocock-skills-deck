/**
 * shared/gh-timeout-tiers.js —— 去 GitHub 的分档超时（#969 暂定值）。
 *
 * 为什么分三档：读操作等得久会拖住界面，写操作杀得早会让用户不敢重试，
 * 查登录态与版本号的探活本该最快回来。从前全仓只有一档 30000，谁都要等满才放弃。
 * 慢网下超时一律归网络档（未知、稍后再试），不能说成没登录让用户去重登。
 *
 * 暂定值（终值等 #967 测出耗时分布后回填，由 #966 收口执行）：
 *   读 12000 毫秒、写 30000 毫秒、探活 3000 毫秒。
 * 上限参考（4 下限、64 上限）管的是同时在飞几个，不管等多久，这里不混用。
 *
 * 这个文件是纯函数：不读盘、不联网、不起定时器。调用方显式传了超时就按调用方的来。
 */

export const READ_TIMEOUT_MS = 12000
export const WRITE_TIMEOUT_MS = 30000
export const PROBE_TIMEOUT_MS = 3000

/** 拿不到档位时的旧默认：沿用历史 30000，不静默变快。 */
export const DEFAULT_TIMEOUT_MS = 30000

function partsOf(args) {
  return (Array.isArray(args) ? args : []).map(function (a) { return String(a == null ? '' : a) })
}

/** 写操作动词：命中即走写档（等得最久，且调用方不许自动重试，见 #969）。 */
const WRITE_VERBS = new Set(['create', 'edit', 'close', 'reopen', 'comment', 'delete', 'lock', 'unlock', 'pin', 'unpin'])

function isApiWrite(parts) {
  // 经接口写票一定带写方法：-X POST 之类或 --method 覆盖时才是写，默认读。
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
 * 这条去 GitHub 的调用是不是写操作（写档 + 不自动重试，调用方人工核对）。
 */
export function isWriteGhArgs(args) {
  const parts = partsOf(args)
  if (parts.length < 2) return false
  if (parts[0] === 'issue' || parts[0] === 'pr') return WRITE_VERBS.has(parts[1])
  if (parts[0] === 'api') return isApiWrite(parts)
  if (parts[0] === 'label' || parts[0] === 'release') return true
  return false
}

/** 探活动词：查登录态与版本号，走最短档。 */
export function isProbeGhArgs(args) {
  const parts = partsOf(args)
  if (parts.length === 0) return false
  if (parts[0] === '--version') return true
  if (parts[0] === 'auth' && parts[1] === 'status') return true
  if (parts[0] === 'api' && String(parts[1] || '').indexOf('user') === 0 && parts.length <= 3) return true
  return false
}

/** 这条调用走哪一档：写最久、探活最短，其余读。 */
export function tierForGhArgs(args) {
  if (isWriteGhArgs(args)) return 'write'
  if (isProbeGhArgs(args)) return 'probe'
  return 'read'
}

/** 这一档等多久（毫秒）。 */
export function timeoutForTier(tier) {
  if (tier === 'write') return WRITE_TIMEOUT_MS
  if (tier === 'probe') return PROBE_TIMEOUT_MS
  return READ_TIMEOUT_MS
}

/** 这条调用等多久：调用方显式传的优先，否则按档位来。 */
export function timeoutForGhArgs(args, explicitTimeout) {
  if (typeof explicitTimeout === 'number' && isFinite(explicitTimeout) && explicitTimeout > 0) return explicitTimeout
  return timeoutForTier(tierForGhArgs(args))
}
