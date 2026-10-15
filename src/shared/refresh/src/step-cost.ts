// src/shared/refresh/src/step-cost.ts —— 这一步的真实花费归属（#1069 从 src/shared/step-cost.js 搬来）
//
// 为什么搬到这里：这份逻辑是宿主闸独用的按步记账（gate.ts 贴着单文件行数上限，
// 放不进去；宿主层的文件之间又不许互相引用，只能落在共享层）。它原来在 src/shared/ 根下，
// 根那一层没有 TypeScript 域、构建也不投放那里的产物，原地改名会断了运行时的引用。
// 搬进 refresh 域后，由同一条域构建链转译，产物落在 step-cost.js，引用不断。
// 本文件零 refresh 域内引用，只用 Node 内置的异步上下文（门禁放行内置模块）。
//
// 做法：每一步执行时建一个只属于这一步的计数器放进异步上下文，
// 传输层上报时同时记进这一步的计数器。不同工作区、同一工作区的并发步骤
// 各有各的计数器，互相算不进对方。调用方拿计数器当这一步的真实花费，
// 不再做容易被并发搅混的前后相减。
//
// 本域 tsconfig 有意不加载任何类型包（types 为空），node:async_hooks 的类型声明
// 随 @types/node 一起被挡在门外；运行时一定是 Node，这个模块必然存在。
// 所以只忽略导入这一行的类型错误（纯类型层面，不影响 esbuild 的运行时转译）——
// 与 src/host/platform/index.ts 同一写法。
// @ts-expect-error
import { AsyncLocalStorage } from 'node:async_hooks'

const als = new AsyncLocalStorage()

/** 这一步的计数器：真实发出去的条数与点数。 */
export interface StepCounters { requests: number; points: number }

/** 传输层上报的一条发送：两个数字都可缺（缺了按下面两条兜底）。 */
interface StepOutboundEntry { requests?: unknown; points?: unknown }

/** measureStep 的返回：结果与抛错二选一，actual 永远是这一步的真实花费。 */
export interface StepMeasure<T> { result: T | null; thrown: unknown; actual: StepCounters }

/** 调用方给的任何数都从这里过：不是有限数就当 0（与 gate.ts 里那个同名函数同一口径，各自文件里各写一遍，不跨文件复用）。 */
function num(v: unknown): number { return (typeof v === 'number' && isFinite(v)) ? v : 0 }

/** 包住一步真正的发送，回来时带上这一步实际发出去的条数与点数（抛错也带）。 */
export async function measureStep<T>(fn: () => T | Promise<T>): Promise<StepMeasure<T>> {
  const collector: StepCounters = { requests: 0, points: 0 }
  let result: T | null = null
  let thrown: unknown = null
  try { result = await als.run({ collector: collector }, fn) } catch (e) { thrown = e }
  return { result: result, thrown: thrown, actual: { requests: collector.requests, points: collector.points } }
}

/** 传输层每真发一条调一次（全局总数仍由调用方自己记，这里只记这一步那一份）。 */
export function noteStepOutbound(entry?: unknown): StepCounters {
  // 入口按未知收：调用方传什么形状都先兜住，真正的归一由下面三行做（运行时与原来一字不差）。
  const e = (entry || {}) as StepOutboundEntry
  const store = als.getStore()
  const c = store && store.collector
  const r = num(e.requests) || 1
  const p = num(e.points)
  if (c) { c.requests += r; c.points += p }
  return { requests: r, points: p }
}
