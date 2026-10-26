/**
 * src/deck/shell/backend-transport.ts —— deck 写工具共用的「执行层失败」收口（#1091 从两个写工具抽出）
 *
 * 为什么单独一份：issue-patch.ts 与 issue-create.ts 里这段按原样各写了一份（numOpt、withCap、
 * TRANSPORT_KINDS、transportMessage、must、timeoutMessage）。#1091 给两个工具加维护者原话参数时，
 * issue-patch.ts 的有效行已经贴到 350 的上限（tests/verify-file-granularity.ts 判红），
 * 这段逐字相同的代码正好搬出来：两份文件同时腾出行数，以后改一处也不会漏改另一处。
 *
 * 口径来自两个工具原来的注释，一个字没改：
 *   · 执行层失败（抛错 / 中止 / 预算耗尽）是「可重试」；后端诚实地说做不到是「能力缺失」。
 *     把前者错判成后者，AI 会放弃重试。
 *   · 超时单列一支（kind 'timeout'）：它也是执行层失败，但机器可读的原因码走独立的
 *     backend-timeout（#1195），不与真正的抛错共用 backend-threw。
 *
 * 纯函数、无状态：不碰 ctx、不读写盘、不引 Node 内置模块。
 */

/** 数字型参数的统一收口：正的有限数才要（取整），其余一律当「没给」，由调用方退自己的默认。 */
export function numOpt(v: unknown): number | undefined {
  return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : undefined
}

/** 钳制等待的结果：等到了给值；超时或对方自己失败都算「没等到」，调用方一律退老路。 */
export type CapResult<T> = { ok: true; value: T } | { ok: false; timedOut?: true }

/**
 * 沙箱许可等待上限：对手是挂住的会话服务。超时按缺席走老路（不限权），与既有 catch null 同形。
 * 两个工具原来各写一份；判据一字不差，只是上限的毫秒数由调用方传（住中央 YAML 的那份值）。
 */
export function withCap<T>(promise: Promise<T> | T, ms: number): Promise<CapResult<T>> {
  return Promise.race([
    Promise.resolve(promise).then(function (v): CapResult<T> { return { ok: true, value: v } }, function (): CapResult<T> { return { ok: false } }),
    new Promise<CapResult<T>>(function (resolve) { setTimeout(function () { resolve({ ok: false, timedOut: true }) }, ms) }),
  ])
}

/** 执行层失败与后端诚实失败的分界：只有这几种 kind 算「执行层没回来」。 */
const TRANSPORT_KINDS: readonly string[] = ['backend-threw', 'aborted', 'over-budget']

/** 后端回包在契约层还没建模：这里只按两个写工具真正会读的那几个字段收口（kind / message / stage）。 */
export type TransportResult = { error?: { kind?: string; message?: unknown; stage?: string } } | null | undefined

/** 后端回包里「执行层失败」的原话；不是执行层失败（后端诚实地说做不到）就回 null，一个字不改判。 */
export function transportMessage(result: TransportResult): string | null {
  const e = result && result.error
  if (e && TRANSPORT_KINDS.indexOf(e.kind as string) >= 0) return String(e.message || '执行层没回来')
  return null
}

/** 执行层失败原样抛给壳（走 backend-threw，可重试）；不是执行层失败就把结果原样交回调用方。 */
export function must<T>(result: T): T {
  const m = transportMessage(result as unknown as TransportResult)
  if (m) throw new Error(m)
  return result
}

/** 超时那一支的原话（kind 'timeout'）：调用处直接回独立原因码，不抛给壳。 */
export function timeoutMessage(result: TransportResult): string | null {
  const e = result && result.error
  if (e && e.kind === 'timeout') return String(e.message || '执行层没回来')
  return null
}
