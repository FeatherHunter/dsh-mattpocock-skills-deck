/**
 * src/refresh/kernel/backend-accounting.ts —— 把一次房间调用实际花掉的量换算成账本要记的那几笔（#1446 A3）
 *
 * 为什么换算放在这个纯函数文件里：规格 1439 第 8 节要求「账本以『后端 id 加桶名』为键，
 * countsRequests / countsPoints / independentBuckets 决定记账口径，算式只读模型、不读 backend id」。
 * 算式只读模型这件事要能被门禁盯住，就不能散在装配层；这里没有读盘、联网、看时钟的代码，
 * 输入一份口径声明加一份房间回包，输出「记哪几个桶、各记多少」，可以整块测干净。
 *
 * 用量从哪来：房间成功信封上的 usage（见 src/tracker/contract/results.ts 的 OpUsage）。
 * 房间自己数着每一笔出站，别的层都没有第一手数据 —— 估算（tool-call-budget）是调用前猜的，
 * 不能拿来记账；这里只认结果里自报的那一份。
 *
 * 四种口径各记各的（与规格的实现决定第 8 节一一对应）：
 *  - 两桶（independentBuckets 真）：请求记 rest 桶、点数记 graphql 桶，一笔调用可能两笔都记（极少见，如实记）。
 *  - 只计请求：只记 requests 桶，点数一律不记（该口径没有点数这一说）。
 *  - 未知模型：只记请求数，落在 requests 桶（「还不知道按什么口径花，但发出去的请求是实数」）。
 *  - 离网：一笔都不记（本来就没有额度这回事，账上留零）。
 */
import type { AccountInput } from '../../tracker/contract/budget-model.js'
import type { OpUsage } from '../../tracker/contract/results.js'

/** 记账落在账本的哪个桶上（与 src/refresh/rooms/host/quota-ledger.ts 的桶名同义，账本那一份是唯一真源）。 */
export type AccountBucket = 'rest' | 'graphql' | 'requests'

/** 一次调用要记的一笔（账本按桶逐笔记，same 桶可能有两笔，所以是数组）。 */
export interface AccountSpend {
  bucket: AccountBucket
  requests: number
  points: number
}

/** 本文件在仓库里的位置（产物里留着它，用来证明产物确实来自这份源码）。 */
export const ACCOUNTING_SOURCE = 'src/refresh/kernel/backend-accounting.ts'

/** 取一个非负整数；NaN、负数、小数一律按 0 或截断处理，绝不让脏数进账本。 */
function nonNegInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

/**
 * 从房间回包里读出实际用量（没有就回 null，调用方据此打一行「这次没数」的诊断，不写假数）。
 * 只认成功信封上的 usage：失败信封没有用量可言，失败那次花没花由调用方按口径决定记零。
 */
export function usageOfResult(result: unknown): OpUsage | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  if (r.ok !== true) return null
  const usage = r.usage
  if (!usage || typeof usage !== 'object') return null
  const u = usage as Record<string, unknown>
  return { requests: nonNegInt(u.requests), points: nonNegInt(u.points) }
}

/**
 * 把一次调用换算成账本要记的几笔（纯函数：只读口径声明与回包，不碰任何外部状态）。
 * 回空数组表示「这次不记」（离网后端、或者确实零花）；夹着口径与用量的关系写在这里，
 * 账本只管按桶累加，不再自己解释模型。
 */
export function spendsOfAccount(input: AccountInput): AccountSpend[] {
  const budget = input.budget
  if (!budget) return []
  // 离网后端：本来就没有额度，记零（连桶都不必建）。这一条必须先于「读用量」，慢了就会在
  // 一个没有桶的后端上尝试记账，账本会按「桶不存在」当场炸——那是装配错误，不是离网该有的样子。
  if (budget.kind === 'off-network') return []
  const usage = usageOfResult(input.result)
  if (!usage) return []
  const requests = budget.countsRequests === true ? usage.requests : 0
  const points = budget.countsPoints === true ? usage.points : 0
  if (budget.kind === 'requests-only') {
    // 只计请求：这条口径只有一桶，点数声明恒为否，即便房间误报了点数也不记。
    return requests > 0 ? [{ bucket: 'requests', requests: requests, points: 0 }] : []
  }
  if (budget.independentBuckets === true) {
    const out: AccountSpend[] = []
    if (requests > 0) out.push({ bucket: 'rest', requests: requests, points: 0 })
    if (points > 0) out.push({ bucket: 'graphql', requests: 0, points: points })
    return out
  }
  // 未知模型（kind === 'unknown'，或者两种桶互不相通的声明缺席）：只记请求数，落在 requests 桶。
  // 「不知道按什么口径花」不等于「没花」，请求数是实数，记下来比记零更接近真相。
  return requests > 0 ? [{ bucket: 'requests', requests: requests, points: 0 }] : []
}
