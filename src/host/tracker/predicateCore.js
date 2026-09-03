/**
 * tracker/predicateCore.js — 谓词注册表机制：注册、分发与超时（V1 #461 从 predicateRegistry.js 拆出，纯结构、行为零变化）。
 * 以后谁改它：改谓词注册、分发 key 规则或单谓词超时语义的人。预估约 130 行，超 350 打回。
 * 接线：引用 predicatePrimitives.js（原语执行器与结果构造）；本文件不引用其他新文件；调用方经本文件装配。
 *
 * 生效日期：2026-08-28
 * 效力规则：本文件以 #226 规约为基线；与更早方案冲突以本规约为准；未来任何定版方案若改动本规约，以未来版本为准（见 CONTEXT.md「版本与效力」）。
 *
 * 第一性原理（#217 定版，2026-08-28 修订 #219/#245/#226 删 na，通用谓词原语）：
 *  - 契约层 evaluateChain 为纯函数（喂状态 → 出步骤快照），无 IO；宿主负责把真实世界 resolve 成 Record<id, 'pass'|'fail'|null>（2026-08-27 起无 na）。
 *  - 谓词执行只在宿主（Node）侧，经平台抽象层（platform）访问 OS，不在契约层/ UI 层执行；全部只读探测，失败返回而非抛（#226 验收）。
 *  - 三层 check kind 分发：primitive（通用原语 fs/exec/gh/技能探测）/ backend（后端专属）/ preflight（复用既有门禁）。
 */

import { execPrimitive, makeResult } from './predicatePrimitives.js'

/**
 * 创建谓词注册表。
 * @param {Object} [opts]
 * @param {number} [opts.timeout] 单个谓词超时（ms，默认 3000）
 * @returns {{register: (key:string, fn:import('./predicatePrimitives.js').PredicateFn)=>void, has:(key:string)=>boolean, resolveAll:(chain:import('../../shared/tracker/chain-types.js').Chain, ctx:import('./predicatePrimitives.js').PredicateContext)=>Promise<Record<string, import('./predicatePrimitives.js').PredicateResult>>}}
 */
export function createPredicateRegistry(opts = {}) {
  const timeout = typeof opts.timeout === 'number' ? opts.timeout : 3000
  /** @type {Map<string, import('./predicatePrimitives.js').PredicateFn>} */
  const map = new Map()

  function register(key, fn) {
    if (typeof key !== 'string' || !key) throw new Error('predicate key must be non-empty string')
    if (typeof fn !== 'function') throw new Error('predicate fn must be function')
    if (map.has(key)) throw new Error('predicate duplicate: ' + key)
    map.set(key, fn)
  }

  function has(key) { return map.has(key) }

  function withTimeout(promise, ms) {
    let t
    const timer = new Promise((resolve) => { t = setTimeout(() => resolve({ __timeout: true }), ms) })
    return Promise.race([promise, timer]).finally(() => clearTimeout(t))
  }

  /**
   * 解析整条链的所有谓词（并行 + 超时按 pending）。
   * - primitive：直接 execPrimitive
   * - backend/preflight：查注册表；未注册 → 'pending'（2026-08-27 起删 na，行不存在而非标 na，诚实不猜）
   * - 超时 → pending（不抛，不阻塞其他）
   */
  async function resolveAll(chain, ctx) {
    const out = {}
    if (!Array.isArray(chain) || chain.length === 0) return out
    const tasks = chain.map(async (item) => {
      const id = item && item.id
      let check = item && item.check
      // B2 fix: 兼容 chain 校验通过的 string 简写（G5 诚实，此处归一为 backend）
      if (typeof check === 'string') check = { kind: 'backend', id: check }
      if (!id || !check) { out[id || '__bad__'] = makeResult('pending', 'bad item'); return }
      try {
        let r
        if (check.kind === 'primitive') {
          const raced = await withTimeout(execPrimitive(check, ctx), timeout)
          if (raced && raced.__timeout) r = makeResult('pending', 'timeout after ' + timeout + 'ms (probe hung or network slow; re-check later)')
          else r = raced
        } else if (check.kind === 'backend' || check.kind === 'preflight') {
          // key 规则：backend: 'backend:<backendId>:<id>' 或 'preflight:<id>'；兼容直接 id
          const backendId = check.backendId || (ctx && ctx.backendId) || ''
          const keysToTry = []
          if (check.kind === 'backend') {
            if (check.id) keysToTry.push('backend:' + (backendId || '*') + ':' + check.id)
            if (check.id) keysToTry.push('backend:*:' + check.id)
            if (check.id) keysToTry.push(check.id)
          } else {
            if (check.id) keysToTry.push('preflight:' + check.id)
            if (check.id) keysToTry.push(check.id)
          }
          let fn = null
          for (const k of keysToTry) if (map.has(k)) { fn = map.get(k); break }
          if (!fn) {
            // 未注册 = 对当前宿主/后端不适用 → pending（2026-08-27 起删 na，行不存在而非标 na，不误判 fail）
            r = makeResult('pending', 'predicate not registered: ' + (check.id || ''))
          } else {
            const raced = await withTimeout(fn(check, ctx), timeout)
            if (raced && raced.__timeout) r = makeResult('pending', 'timeout after ' + timeout + 'ms (probe hung or network slow; re-check later)')
            else r = raced
          }
        } else {
          r = makeResult('pending', 'unknown check.kind: ' + check.kind)
        }
        // 归一化 status
        const s = r && r.status
        if (s !== 'pass' && s !== 'fail' && s !== 'pending') r.status = 'pending' // 2026-08-27 起无 na
        out[id] = r
      } catch (e) {
        out[id] = makeResult('pending', String((e && e.message) || e))
      }
    })
    await Promise.all(tasks)
    return out
  }

  return { register, has, resolveAll, get _map(){ return new Map(map) } } // D-3 fix: _map 只读拷贝，不暴露内部可变 Map
}

/**
 * 将 resolveAll 的结果转为 evaluateChain 的输入（Record<id, 'pass'|'fail'|null>，2026-08-27 起无 na）。
 * @param {Record<string, import('./predicatePrimitives.js').PredicateResult>} resolved
 * @returns {Record<string, 'pass'|'fail'|null>}
 */
export function toPredicateResults(resolved) {
  const out = {}
  for (const [k, v] of Object.entries(resolved || {})) {
    const s = v && v.status
    if (s === 'pass') out[k] = 'pass'
    else if (s === 'fail') out[k] = 'fail'
    else out[k] = null // pending/unknown → null（evaluateChain 视为 pending）
  }
  return out
}

export const PREDICATE_REGISTRY_VERSION = 1
