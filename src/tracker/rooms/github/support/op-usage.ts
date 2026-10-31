// src/tracker/rooms/github/support/op-usage.ts —— 把 GitHub 房这一次操作的真实用量附到成功信封上（#1446 A3；#1686 阶段 1 从房间根迁入 support/）
//
// 为什么单独一份：房间有二十六条操作，每条都在自己的文件里回信封；如果在每条操作里各写一遍
// 「取计数、拼 usage」，迟早有人漏掉一条，或者两处算法不一样。这里只做一件事 —— 在操作表
// 外层统一包一次，让每条操作成功时的信封都带上同一个形状的用量。
//
// 计数从哪来：gh 客户端真正发出命令时已经数过了（client.ts 的 reportOutbound 既报给闸，
// 也记进这里）。用异步上下文而不是让每条操作自己前后相减：同一工作区的两次操作可能并发，
// 前后相减会把别人的花费算进自己这一笔。

import type { OpResult } from '../../../contract/results.js'
// 本域 tsconfig 有意不加载任何类型包（types 为空），node:async_hooks 的类型声明随 @types/node
// 一起被挡在门外；运行时一定是 Node，这个模块必然存在。与 src/refresh/kernel/step-pricing.ts
// 同一写法：只忽略导入这一行的类型错误，不影响 esbuild 的运行时转译。
// @ts-expect-error 本域类型配置没有加载 @types/node
import { AsyncLocalStorage } from 'node:async_hooks'

/** 一次操作自己的计数器：真正发出去的请求条数与点数。 */
interface UsageBox { requests: number; points: number }

/** AsyncLocalStorage 的最小视图（本域没有 Node 类型，按用到的两格声明，避免 any 扩散）。 */
interface UsageStore {
  // 同步版 run：作用域在回调返回时就结束，但异步回调里的 await 续体会继承当时的上下文；
  // 包装器要在「调用函数的那一瞬」就进作用域，所以这里必须允许同步返回值。
  run<T>(box: UsageBox, fn: () => T): T
  getStore(): UsageBox | undefined
}

const usageStore = new AsyncLocalStorage() as UsageStore

/** 不是有限数就当 0：调用方给的任何数都从这里过，账本不接受 NaN。 */
function num(value: unknown): number { return (typeof value === 'number' && isFinite(value)) ? value : 0 }

/**
 * gh 每真正发出一笔时调一次（client.ts 的 reportOutbound 里调）。
 * 不在一次操作里（例如客户端装配时的探测）就只让客户端自己的计数收下，不落任何账。
 */
export function noteGithubUsage(entry?: { requests?: unknown; points?: unknown }): void {
  const box = usageStore.getStore()
  if (!box) return
  box.requests += num(entry && entry.requests)
  box.points += num(entry && entry.points)
}

/**
 * 把房间操作表整体包一层：返回同样键名的对象，函数成员在成功信封上补 usage。
 *
 * 为什么只补成功信封：失败信封没有 data 可放，用量会跟着失败一起丢掉；失败那一笔花没花
 * 由记账侧按口径定（契约的 AccountInput 收原结果，房间不在这里替它判断）。
 * 同步成员（describe / issueAddress）原样交回，不把同步函数改成异步。
 */
export function attachOpUsage<T extends object>(table: T): T {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(table)) {
    const value = (table as Record<string, unknown>)[key]
    if (typeof value !== 'function') { out[key] = value; continue }
    out[key] = function (this: unknown, ...args: unknown[]): unknown {
      // 必须在计数器的作用域里「调用」函数，不能先调用再包：操作可能是返回承诺的普通函数，
      // 其中真正发命令的那一段又可能在第一个 await 之前就开始跑；先调用再进作用域会漏掉它。
      const box: UsageBox = { requests: 0, points: 0 }
      const result = usageStore.run(box, function () { return (value as (...a: unknown[]) => unknown).apply(table, args) })
      // 同步成员（describe / issueAddress）原样交回，不把同步函数改成异步。
      if (!result || typeof (result as Promise<unknown>).then !== 'function') return result
      return (result as Promise<unknown>).then(function (envelope) {
        const reply = envelope as OpResult<unknown> | null
        if (reply && reply.ok === true) {
          // 零也照附：零是「量过了，这一笔没有出站」，与「没量」不是一回事，记账侧要能分清。
          return Object.assign({}, reply, { usage: { requests: box.requests, points: box.points } })
        }
        return reply
      })
    }
  }
  return out as T
}
