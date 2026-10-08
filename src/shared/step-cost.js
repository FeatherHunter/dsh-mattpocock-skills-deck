// src/shared/step-cost.js —— 这一步的真实花费归属
//
// 为什么单开一个文件：宿主闸（src/host/refresh/gate.js）贴着 350 行单文件上限，
// 这份逻辑放不进去；宿主层的文件之间又不许互相引用，
// 所以落在这里，闸从这里取（宿主引用共享层是允许的方向）。
// 本文件零相对引用，只用 Node 内置的异步上下文（门禁放行内置模块）。
//
// 做法：每一步执行时建一个只属于这一步的计数器放进异步上下文，
// 传输层上报时同时记进这一步的计数器。不同工作区、同一工作区的并发步骤
// 各有各的计数器，互相算不进对方。调用方拿计数器当这一步的真实花费，
// 不再做容易被并发搅混的前后相减。
import { AsyncLocalStorage } from 'node:async_hooks'

const als = new AsyncLocalStorage()

function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0 }

/** 包住一步真正的发送，回来时带上这一步实际发出去的条数与点数（抛错也带）。 */
export async function measureStep(fn) {
  const collector = { requests: 0, points: 0 }
  let result = null
  let thrown = null
  try { result = await als.run({ collector: collector }, fn) } catch (e) { thrown = e }
  return { result: result, thrown: thrown, actual: { requests: collector.requests, points: collector.points } }
}

/** 传输层每真发一条调一次（全局总数仍由调用方自己记，这里只记这一步那一份）。 */
export function noteStepOutbound(entry) {
  const e = entry || {}
  const store = als.getStore()
  const c = store && store.collector
  const r = num(e.requests) || 1
  const p = num(e.points)
  if (c) { c.requests += r; c.points += p }
  return { requests: r, points: p }
}
