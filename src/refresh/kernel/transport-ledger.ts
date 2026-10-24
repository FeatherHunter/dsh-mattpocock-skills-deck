// src/refresh/kernel/transport-ledger.ts —— 传输层报上来的花费怎么累计（#1482 从 refresh-gate.ts 抽出）
//
// 为什么单独一份：闸里有两个报账口，口径故意不同——先报闸的那一口，条数缺了要按 1 条兜底
// （传输层不总是给条数）；事后补差的那一口必须能明确报 0 条（GraphQL 不占 REST 请求条数）。
// 两个口写在一起时，改一个容易顺手把另一个也改了，所以分开放；两口共同的动作（累加进统计、
// 记进当前这一步的计数器）也只写一遍。
//
// 调用方是刷新闸（src/refresh/rooms/host/refresh-gate.ts）；本文件不判限流、不读账本。
import { noteStepOutbound } from './step-pricing.js'

/** 闸上「传输层真发出去多少」的累计：条数与点数。 */
export interface TransportStats { requests: number; points: number }

/** 传输层报上来的一笔：两个数都可缺（缺了按各口的默认口径兜底）。 */
export interface OutboundReportLike { requests?: unknown; points?: unknown }

/** 不是有限数就当 0：调用方给 null、字符串、NaN 时都不让统计变成 NaN。 */
function num(value: unknown): number { return (typeof value === 'number' && isFinite(value)) ? value : 0 }

/**
 * 先报闸：这是「命令即将起进程」时的那一口。条数缺了或不是数按 defaultRequests 兜底，
 * 显式给的 0 就是 0（#1482：GraphQL 不占 REST 请求条数）；点数缺了按 0。
 */
export function addOutbound(stats: TransportStats, entry: OutboundReportLike | undefined, defaultRequests: number): TransportStats {
  const e = entry || {}
  const requests = (typeof e.requests === 'number' && isFinite(e.requests)) ? e.requests : defaultRequests
  return accumulate(stats, requests, num(e.points))
}

/**
 * 事后补差：GraphQL 的命令起进程前只够按 1 点估，真实点数在回包的 rateLimit.cost 里，
 * 拿到回包后由这里把差额补进统计。两个数都按字面收，缺省是 0 —— 这一口必须能明确报 0 条请求。
 */
export function addOutboundCorrection(stats: TransportStats, entry: OutboundReportLike | undefined): TransportStats {
  const e = entry || {}
  return accumulate(stats, num(e.requests), num(e.points))
}

/** 两口的共同动作：累加进闸的统计，并记进当前这一步的计数器（并发时各记各的）。 */
function accumulate(stats: TransportStats, requests: number, points: number): TransportStats {
  stats.requests += requests
  stats.points += points
  try { noteStepOutbound({ requests: requests, points: points }) } catch (e) {}
  return stats
}
