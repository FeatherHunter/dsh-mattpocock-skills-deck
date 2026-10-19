/**
 * shared/gh-timeout-tiers.js —— 去 GitHub 的分档超时（#969 暂定值）。
 *
 * 为什么分三档：读操作等得久会拖住界面，写操作杀得早会让用户不敢重试，
 * 查登录态与版本号的探活本该最快回来。从前全仓只有一档 30000，谁都要等满才放弃。
 * 慢网下超时一律归网络档（未知、稍后再试），不能说成没登录让用户去重登。
 *
 * 暂定值（终值等 #967 测出耗时分布后回填，由 #966 收口执行）：
 *   读 12000 毫秒、写 30000 毫秒、探活 15000 毫秒。
 * 探活从 3000 提到 15000（#1160）：gh auth status 在插件里是冷启动，
 * keyring 读取加 TLS 握手在代理环境下经常超 3 秒，从前那条 3 秒的上限会把登录态误判成网络异常。
 * 上限参考（4 下限、64 上限）管的是同时在飞几个，不管等多久，这里不混用。
 *
 * 这个文件是纯函数：不读盘、不联网、不起定时器。调用方显式传了超时就按调用方的来。
 */

// 四档时长住中央 YAML（config/timeouts.yaml 的 outbound* 四键）：这里只留同名别名，
// 调时间改 YAML，不改这里。值由 tests/verify-time-config.ts 看守一致。
import { OUTBOUND_READ_TIMEOUT_MS, OUTBOUND_WRITE_TIMEOUT_MS, OUTBOUND_PROBE_TIMEOUT_MS, OUTBOUND_DEFAULT_TIMEOUT_MS } from '../../shared/time-config/src/values.js'

export const READ_TIMEOUT_MS = OUTBOUND_READ_TIMEOUT_MS
export const WRITE_TIMEOUT_MS = OUTBOUND_WRITE_TIMEOUT_MS
export const PROBE_TIMEOUT_MS = OUTBOUND_PROBE_TIMEOUT_MS

/** 拿不到档位时的旧默认：沿用历史 30000，不静默变快。 */
export const DEFAULT_TIMEOUT_MS = OUTBOUND_DEFAULT_TIMEOUT_MS

/**
 * 参数归一成字符串数组：非数组按空数组处理，空位按空串处理。
 * 类型说明：host 域文件，只做类型标注；收未知输入，运行时仍是原判断。
 */
function partsOf(args: unknown): string[] {
  return (Array.isArray(args) ? args : []).map(function (a: unknown) { return String(a == null ? '' : a) })
}

/** 写操作动词：命中即走写档（等得最久，且调用方不许自动重试，见 #969）。 */
const WRITE_VERBS = new Set(['create', 'edit', 'close', 'reopen', 'comment', 'delete', 'lock', 'unlock', 'pin', 'unpin'])

function isApiWrite(parts: string[]): boolean {
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
 * 类型说明：调用方传的是进程参数数组，收未知以兼容旧调用，运行时仍按数组判断。
 */
export function isWriteGhArgs(args: unknown): boolean {
  const parts = partsOf(args)
  if (parts.length < 2) return false
  if (parts[0] === 'issue' || parts[0] === 'pr') return WRITE_VERBS.has(parts[1])
  if (parts[0] === 'api') return isApiWrite(parts)
  if (parts[0] === 'label' || parts[0] === 'release') return true
  return false
}

/** 探活动词：查登录态与版本号，走探活档。类型说明：同写操作判断，收未知参数数组。 */
export function isProbeGhArgs(args: unknown): boolean {
  const parts = partsOf(args)
  if (parts.length === 0) return false
  if (parts[0] === '--version') return true
  if (parts[0] === 'auth' && parts[1] === 'status') return true
  if (parts[0] === 'api' && String(parts[1] || '').indexOf('user') === 0 && parts.length <= 3) return true
  return false
}

/** 这条调用走哪一档：写最久，其余读，探活走自己的档（#1160 起探活 15 秒，比读档久）。类型说明：返回值收窄为三档字面量。 */
export function tierForGhArgs(args: unknown): 'write' | 'probe' | 'read' {
  if (isWriteGhArgs(args)) return 'write'
  if (isProbeGhArgs(args)) return 'probe'
  return 'read'
}

/** 这一档等多久（毫秒）。类型说明：档位收字符串，未知档按读档处理，与原来一致。 */
export function timeoutForTier(tier: string): number {
  if (tier === 'write') return WRITE_TIMEOUT_MS
  if (tier === 'probe') return PROBE_TIMEOUT_MS
  return READ_TIMEOUT_MS
}

/** 这条调用等多久：调用方显式传的优先，否则按档位来。类型说明：显式超时收未知，数字且为正才采用。 */
export function timeoutForGhArgs(args: unknown, explicitTimeout?: unknown): number {
  if (typeof explicitTimeout === 'number' && isFinite(explicitTimeout) && explicitTimeout > 0) return explicitTimeout
  return timeoutForTier(tierForGhArgs(args))
}
