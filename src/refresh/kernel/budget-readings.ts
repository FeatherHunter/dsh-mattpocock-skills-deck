/**
 * src/refresh/kernel/budget-readings.ts —— 把一条预算读数换算成账本要同步的那几格（#1446 A3）
 *
 * 读数（src/tracker/contract/budget-model.ts 的 BudgetReading）与账本的桶（quota-ledger.ts 的
 * BucketState.reading）是两份形状：前者是房间对外的三态交代（两桶 / 只计请求 / 离网 / 没量出来），
 * 后者是账本自己记水位用的 {limit, remaining}。换算是纯数据搬运，放这里是为了让「哪种读数进哪个桶」
 * 只有一处说法；账本与同步桥都不再各写一遍映射。
 */
import type { BudgetReading } from '../../tracker/contract/budget-model.js'

/** 账本一格的水位（与 quota-ledger.ts 的 reading 同形）。 */
export interface LedgerBucketReading {
  remaining: number
  limit: number
}

/** 一次同步要写进账本的格（哪种口径有哪几格，与账本的桶名一一对应）。 */
export interface LedgerReadings {
  rest?: LedgerBucketReading
  graphql?: LedgerBucketReading
  requests?: LedgerBucketReading
}

/** 本文件在仓库里的位置（产物里留着它，用来证明产物确实来自这份源码）。 */
export const READINGS_SOURCE = 'src/refresh/kernel/budget-readings.ts'

/**
 * 把一条读数换成账本要写的格；量不出来的读数回 null（调用方不写账本，
 * 绝不用 0 冒充「量出来是 0」——那正是 1439 要治的病）。
 */
export function ledgerReadingsOf(reading: BudgetReading | null | undefined): LedgerReadings | null {
  if (!reading || reading.known !== true) return null
  if (reading.kind === 'off-network') return null
  if (reading.kind === 'requests-only') {
    return { requests: { remaining: reading.requests.remaining, limit: reading.requests.limit } }
  }
  if (reading.kind === 'two-buckets') {
    return {
      rest: { remaining: reading.buckets.rest.remaining, limit: reading.buckets.rest.limit },
      graphql: { remaining: reading.buckets.graphql.remaining, limit: reading.buckets.graphql.limit },
    }
  }
  return null
}
