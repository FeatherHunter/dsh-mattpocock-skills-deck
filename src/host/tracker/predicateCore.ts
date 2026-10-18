// src/host/tracker/predicateCore.ts —— 从同目录 predicateCore.js 逐行转写而来，只加类型标注与注释，运行时逻辑一个字未动。
//
// 为什么要转写这一份：谓词注册表是通用链与后端链共用的装配入口，转成 TypeScript 后调用方
//   （src/host/detectChain.ts 经动态导入取 createPredicateRegistry 与 toPredicateResults）能按类型取用，
//   注册、分发与超时的行为仍与原来逐行一致。
// 什么约定不能改：
//   1. 未注册的后端或预检谓词一律按待定返回，不猜测、不标不可用，调用方按诚实未知处理。
//   2. 单个谓词超时按待定返回，不抛错，不阻塞同一链上其他谓词的并行求值。
//   3. 字符串简写的检查项统一归一为后端谓词，状态只认通过、失败与待定三档。
//   4. 相对导入一律保留 .js 后缀，运行时由 scripts/ts-hook.mjs 改指同名 .ts，本文件不改说明符。
//   5. 只写可剥离类型：类型一律经 import type 引入，运行时导入与原来完全相同，不新增任何运行时边。

import { execPrimitive, makeResult } from './predicatePrimitives.js'
import { PREDICATE_FALLBACK_TIMEOUT_MS } from '../../shared/time-config/values.js'

// 类型只做编译期约束，不产生运行时引用：链与检查的形状以共享层为准，谓词形状以同层真源为准。
import type { Chain, Check } from '../../shared/tracker/chain-types.js'
import type { PredicateContext, PredicateFn, PredicateResult } from './predicatePrimitives.js'

// 注册表选项：只认单个谓词超时一格，不传按中央时间配置的回退值走。
interface PredicateRegistryOptions {
  timeout?: number
}

// 超时标记：竞速输掉的那一路带这一格，正常谓词结果里没有这一格，运行时按有无区分。
interface TimeoutMarker {
  __timeout: true
}

// 竞速结果：正常谓词结果与超时标记二选一，运行时按有无超时格区分。
type RacedResult = PredicateResult | TimeoutMarker

// 注册表对外形状：注册、判重与整链求值三件，另带只读拷贝的调试口。
export interface PredicateRegistry {
  register: (key: string, fn: PredicateFn) => void
  has: (key: string) => boolean
  resolveAll: (chain: Chain, ctx: PredicateContext) => Promise<Record<string, PredicateResult>>
  readonly _map: Map<string, PredicateFn>
}

// 创建谓词注册表。
// 单个谓词超时（毫秒，缺省取中央 YAML 的 predicateFallbackTimeoutMs）。
export function createPredicateRegistry(opts: PredicateRegistryOptions = {}): PredicateRegistry {
  const timeout: number = typeof opts.timeout === 'number' ? opts.timeout : PREDICATE_FALLBACK_TIMEOUT_MS
  const map = new Map<string, PredicateFn>()

  function register(key: string, fn: PredicateFn): void {
    if (typeof key !== 'string' || !key) throw new Error('predicate key must be non-empty string')
    if (typeof fn !== 'function') throw new Error('predicate fn must be function')
    if (map.has(key)) throw new Error('predicate duplicate: ' + key)
    map.set(key, fn)
  }

  function has(key: string): boolean { return map.has(key) }

  function withTimeout(promise: Promise<PredicateResult>, ms: number): Promise<RacedResult> {
    let t: ReturnType<typeof setTimeout> | undefined
    const timer = new Promise<TimeoutMarker>((resolve) => { t = setTimeout(() => resolve({ __timeout: true }), ms) })
    // 非空断言只过编译器：定时器句柄在竞速开始前已同步赋值，运行时原样清掉该句柄。
    return Promise.race([promise, timer]).finally(() => clearTimeout(t as ReturnType<typeof setTimeout>))
  }

  // 解析整条链的所有谓词（并行 + 超时按 pending）。
  // - primitive：直接 execPrimitive
  // - backend/preflight：查注册表；未注册 → 'pending'（2026-08-27 起删 na，行不存在而非标 na，诚实不猜）
  // - 超时 → pending（不抛，不阻塞其他）
  async function resolveAll(chain: Chain, ctx: PredicateContext): Promise<Record<string, PredicateResult>> {
    const out: Record<string, PredicateResult> = {}
    if (!Array.isArray(chain) || chain.length === 0) return out
    const tasks = chain.map(async (item): Promise<void> => {
      const id = item && item.id
      // 检查项可能是字符串简写，归一后统一按对象走，运行时形状与原来完全一致。
      let check: string | Check | undefined = item && item.check
      // B2 fix: 兼容 chain 校验通过的 string 简写（G5 诚实，此处归一为 backend）
      if (typeof check === 'string') check = { kind: 'backend', id: check }
      if (!id || !check) { out[id || '__bad__'] = makeResult('pending', 'bad item'); return }
      try {
        let r: PredicateResult
        const checkObj = check as Check
        if (checkObj.kind === 'primitive') {
          const raced = await withTimeout(execPrimitive(checkObj, ctx), timeout)
          if (raced && (raced as TimeoutMarker).__timeout) r = makeResult('pending', 'timeout after ' + timeout + 'ms (probe hung or network slow; re-check later)')
          else r = raced as PredicateResult
        } else if (checkObj.kind === 'backend' || checkObj.kind === 'preflight') {
          // key 规则：backend: 'backend:<backendId>:<id>' 或 'preflight:<id>'；兼容直接 id
          // 索引签名读到的是未知值，转成字符串才拼键，运行时拼接结果与原来完全一致。
          const checkId = checkObj.id as string | undefined
          const checkBackendId = checkObj.backendId as string | undefined
          const backendId: string = checkBackendId || (ctx && ctx.backendId) || ''
          const keysToTry: string[] = []
          if (checkObj.kind === 'backend') {
            if (checkId) keysToTry.push('backend:' + (backendId || '*') + ':' + checkId)
            if (checkId) keysToTry.push('backend:*:' + checkId)
            if (checkId) keysToTry.push(checkId)
          } else {
            if (checkId) keysToTry.push('preflight:' + checkId)
            if (checkId) keysToTry.push(checkId)
          }
          let fn: PredicateFn | null = null
          for (const k of keysToTry) if (map.has(k)) { fn = map.get(k) as PredicateFn; break }
          if (!fn) {
            // 未注册 = 对当前宿主/后端不适用 → pending（2026-08-27 起删 na，行不存在而非标 na，不误判 fail）
            r = makeResult('pending', 'predicate not registered: ' + (checkId || ''))
          } else {
            const raced = await withTimeout(fn(checkObj, ctx), timeout)
            if (raced && (raced as TimeoutMarker).__timeout) r = makeResult('pending', 'timeout after ' + timeout + 'ms (probe hung or network slow; re-check later)')
            else r = raced as PredicateResult
          }
        } else {
          r = makeResult('pending', 'unknown check.kind: ' + String(checkObj.kind))
        }
        // 归一化 status
        const s = r && r.status
        if (s !== 'pass' && s !== 'fail' && s !== 'pending') r.status = 'pending' // 2026-08-27 起无 na
        out[id] = r
      } catch (e) {
        const caught = e as { message?: unknown } | null | undefined
        out[id] = makeResult('pending', String((caught && caught.message) || e))
      }
    })
    await Promise.all(tasks)
    return out
  }

  return { register, has, resolveAll, get _map(){ return new Map(map) } } // D-3 fix: _map 只读拷贝，不暴露内部可变 Map
}

// 将 resolveAll 的结果转为 evaluateChain 的输入（Record<id, 'pass'|'fail'|null>，2026-08-27 起无 na）。
export function toPredicateResults(resolved: Record<string, PredicateResult>): Record<string, 'pass' | 'fail' | null> {
  const out: Record<string, 'pass' | 'fail' | null> = {}
  for (const [k, v] of Object.entries(resolved || {})) {
    const s = v && v.status
    if (s === 'pass') out[k] = 'pass'
    else if (s === 'fail') out[k] = 'fail'
    else out[k] = null // pending/unknown → null（evaluateChain 视为 pending）
  }
  return out
}

export const PREDICATE_REGISTRY_VERSION = 1
