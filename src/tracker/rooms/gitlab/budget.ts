/**
 * src/tracker/rooms/gitlab/budget.ts —— GitLab 房间的额度读数（#1446）。
 *
 * 这一件回答一件事：这台机器上的 glab 还剩多少请求额度。GitLab 只按请求计数，
 * 没有点数与 35% 保底的概念，所以读数固定是「只计请求」一种形状（requests-only）。
 *
 * 为什么用 `glab api --include`：GitLab 把限额放在响应头 RateLimit-Limit /
 * RateLimit-Remaining 里，不放在响应体里；要完整读出这两个头，只能让 glab 把响应头一起打出来。
 *
 * 三条坏路（glab 没装、请求失败、响应里没有限额头）都回「读数未知」并带原因，不回 0、不抛：
 * 回 0 会让裁决把「没量到」当成「额度用完」而拒绝写操作；抛异常会让同步记一次本不该记的失败。
 * 未知再分两种：没量过（not-measured，本机没装 glab，不是额度用完）与量了但拿不到
 * （unavailable，请求报错或响应头里没有限额数）。
 *
 * 本文件只读一次额度，不做缓存、不看时钟；缓存与刷新节流由账本那一层负责。
 */
import type { BudgetReading } from '../../contract/budget-model.js'
import type { OpContext } from '../../contract/contexts.js'
import type { OpResult } from '../../contract/results.js'
import { glabClient } from './client.js'

/** 一条限额读数：上限与剩余，两格都必须是真的数字才作数。 */
export interface GitlabRateLimit {
  /** 这一档限额的上限（每小时允许多少条请求）。 */
  limit: number
  /** 当前还剩多少条请求。 */
  remaining: number
}

/** 有限数字才算数：缺格、空串、NaN 一律按缺格处理。 */
function numOf(value: string | undefined): number | null {
  if (value === undefined) return null
  const n = Number(value.trim())
  return isFinite(n) ? n : null
}

/**
 * 从 glab api --include 的输出里读一行响应头（大小写不敏感，兼容 CRLF 与 LF）。
 * 只认「名字: 数字」这种形状；同名头出现多次时取第一条。
 */
function readHeader(text: string, name: string): number | null {
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    if (line.slice(0, at).trim().toLowerCase() !== name) continue
    return numOf(line.slice(at + 1))
  }
  return null
}

/**
 * 从 glab api --include 的输出里取出限额两格，缺任何一格都算失败。
 * 先看标准输出，再看标准错误：glab 不同版本把响应头打在哪一处并不统一，
 * 两处都没有才是真的没量到。输入不是文本、缺头、数字不合法，一律回 null（调用方按未知处理）。
 */
export function parseGitlabRateLimit(text: unknown, errText?: unknown): GitlabRateLimit | null {
  const body = String(text === null || text === undefined ? '' : text)
  const err = String(errText === null || errText === undefined ? '' : errText)
  let limit = readHeader(body, 'ratelimit-limit')
  let remaining = readHeader(body, 'ratelimit-remaining')
  if (limit === null || remaining === null) {
    const fallbackLimit = readHeader(err, 'ratelimit-limit')
    const fallbackRemaining = readHeader(err, 'ratelimit-remaining')
    if (limit === null) limit = fallbackLimit
    if (remaining === null) remaining = fallbackRemaining
  }
  if (limit === null || remaining === null) return null
  return { limit: limit, remaining: remaining }
}

/**
 * 读一次剩余额度（只读一次 glab api，不花写额度、不改远端任何东西）。
 * 永远回成功信封：量出来了装请求桶，没量出来装未知原因 —— 同步与裁决只认读数，
 * 把「没量出来」装进失败信封会让调用方误记一次失败，违背同步失败不计数的约定。
 * 本函数永不抛：房内兜底把抛收成未知（unavailable）。
 */
export async function readGitlabBudget(ctx: OpContext): Promise<OpResult<BudgetReading>> {
  try {
    const c = glabClient(ctx)
    // --include 让 glab 把响应头一起打出来；路径用 GitLab 的版本接口，它一定存在且不依赖具体项目。
    // 路径写在前面、开关写在后面：端点识别（tests/verify-1179-gitlab-endpoint-coverage.ts）认的是紧跟 api 的那一段路径。
    const r = await c.run(['api', 'version', '--include'], { cwd: (ctx && ctx.cwd) || undefined })
    // 127 = 本机没有 glab（或平台缺执行器）：什么都没发出去，属于没量过，不是额度用完。
    if (r.code === 127) return { ok: true, data: { known: false, reason: 'not-measured' } }
    // 其余非零退出码：请求真的发出去了但失败了（未登录、网络、权限），属于量了但拿不到。
    if (r.code !== 0) return { ok: true, data: { known: false, reason: 'unavailable' } }
    const measured = parseGitlabRateLimit(r.stdout, r.stderr)
    // 请求通了但响应头里没有限额数：量了但拿不到，按未知处理，不编 0。
    if (!measured) return { ok: true, data: { known: false, reason: 'unavailable' } }
    return { ok: true, data: { known: true, kind: 'requests-only', requests: measured } }
  } catch { return { ok: true, data: { known: false, reason: 'unavailable' } } }
}
