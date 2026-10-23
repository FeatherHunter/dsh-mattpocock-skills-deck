/**
 * src/tracker/rooms/github/budget.ts —— GitHub 房间的额度读数（#1443）。
 *
 * 这一件只回答一件事：这台机器上的 gh 还剩多少可用额度（REST 与 GraphQL 两桶）。
 * 调用方是额度同步（经 Tracker 会话调 readBudget），不是人 —— 所以三条坏路（gh 缺失、
 * 未登录、网络失败）都回「读数未知」并带原因，不回 0、不抛异常：回 0 会让裁决以为额度用完，
 * 抛异常会让同步记一次本不该记的失败。未知分两种：没量过（not-measured，机器没装 gh，
 * 不是额度用完）与量了但拿不到（unavailable，未登录、网络失败、读数解析不出）。
 * 成功时原样交回两桶水位（剩多少与上限分开，不编数）。
 *
 * 两桶解析是桥里旧 parseRateLimit 的唯一后继：旧解析随 #1443 改道删掉，以后只认这一份。
 */
import type { BucketLevel, BudgetReading } from '../../contract/budget-model.js'
import type { OpContext } from '../../contract/contexts.js'
import type { OpResult } from '../../contract/results.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
import { ghClient } from './client.js'

/** 两桶水位：REST 与 GraphQL 各剩多少、上限多少（不带重置时刻，房间读数只量水位）。 */
export interface RateLimitBuckets { rest: BucketLevel; graphql: BucketLevel }

/** 有限数字才算数：服务端给的不是数字（缺格、字符串、NaN）一律按缺格处理。 */
function num(v: unknown): number | null { return (typeof v === 'number' && isFinite(v)) ? v : null }

/**
 * 从 `gh api rate_limit` 的 stdout 里取出两桶读数，缺任何一格都算失败。
 * 输入不是 JSON、缺一桶、格子不全，一律回 null（调用方认读数未知，不抛）。
 */
export function parseRateLimit(text: unknown): RateLimitBuckets | null {
  try {
    const body = JSON.parse(String(text || '')) as { resources?: unknown } | null;
    const resources = (body && body.resources) as Record<string, unknown> | null | undefined;
    if (!resources || typeof resources !== 'object') return null
    const core = resources.core as Record<string, unknown> | null | undefined;
    const graphql = resources.graphql as Record<string, unknown> | null | undefined;
    if (!core || typeof core !== 'object' || !graphql || typeof graphql !== 'object') return null
    const limit1 = num(core.limit)
    const remaining1 = num(core.remaining)
    const limit2 = num(graphql.limit)
    const remaining2 = num(graphql.remaining)
    if (limit1 === null || remaining1 === null || limit2 === null || remaining2 === null) return null
    return { rest: { remaining: remaining1, limit: limit1 }, graphql: { remaining: remaining2, limit: limit2 } }
  } catch { return null }
}

/**
 * 读一次剩余额度（只读 gh api rate_limit，不花额度，不管别的）。
 * 永远回成功信封：量出来了装两桶，没量出来装未知原因 —— 同步与裁决只认读数，
 * 把「没量出来」装进失败信封会让调用方误记一次失败，违背同步失败不计数的约定。
 * 本函数永不抛：房内兜底把抛收成未知（unavailable）。
 */
export async function readGithubBudget(ctx: OpContext): Promise<OpResult<BudgetReading>> {
  try {
    const c = ghClient(ctx)
    const r = await c.execGh(['api', 'rate_limit'], { cwd: (ctx && ctx.cwd) || undefined, via: 'readBudget.rate-limit' })
    if (!r.ok) {
      const kind = (r.error && r.error.kind) || ERROR_KIND.NETWORK;
      // 环境档是没有量过（gh 缺失、出站没接上），不是额度用完；其余（未登录、网络失败、超时取消）都是量了但拿不到。
      if (kind === ERROR_KIND.ENV) return { ok: true, data: { known: false, reason: 'not-measured' } }
      return { ok: true, data: { known: false, reason: 'unavailable' } }
    }
    const buckets = parseRateLimit(r.data.stdout)
    // gh 通了但形状不对（服务端改了字段）：量了但拿不到数，按未知处理，不编数。
    if (!buckets) return { ok: true, data: { known: false, reason: 'unavailable' } }
    return { ok: true, data: { known: true, kind: 'two-buckets', buckets: buckets } }
  } catch { return { ok: true, data: { known: false, reason: 'unavailable' } } }
}
