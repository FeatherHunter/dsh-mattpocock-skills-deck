/**
 * tracker/predicateRegistry.js — 宿主谓词注册表（异步 resolve → 纯函数输入）。
 *
 * 第一性原理（#217 定版）：
 *  - 契约层 evaluateChain 为纯函数（喂状态 → 出步骤快照），无 IO；宿主负责把真实世界 resolve 成 Record<id, 'pass'|'fail'|'na'|null>。
 *  - 谓词执行只在宿主（Node）侧，经平台抽象层（platform）访问 OS，不在契约层/ UI 层执行。
 *  - 三层 check kind 分发：primitive（通用原语）/ backend（后端专属）/ preflight（复用既有门禁）。
 *  - 超时按 pending 处理（不抛、不阻塞整链），诚实透传 detail。
 *
 * 版本：2026-08-26 与 src/shared/tracker/chain.js 同步。
 */

import { PRIMITIVE_KIND } from '../../shared/tracker/chain.js'

/**
 * @typedef {Object} PredicateResult
 * @property {'pass'|'fail'|'na'|'pending'} status
 * @property {string} [detail] 人读细节（日志用）
 * @property {string} [hint] 引导文案透传（与 Show.hint 同源，供链快照复用）
 */

/**
 * @typedef {Object} PredicateContext
 * @property {import('../platform/index.js').Platform} platform 平台抽象实例
 * @property {import('../../shared/tracker/shape.js').BackendId|null} backendId 当前后端（通用探测时 null）
 * @property {string} cwd 工作区路径
 * @property {AbortSignal} [signal]
 * @property {Record<string,unknown>} [extras] 额外上下文（如 repoRef）
 */

/**
 * @typedef {(check: import('../../shared/tracker/chain.js').Check, ctx: PredicateContext) => Promise<PredicateResult>} PredicateFn
 */

function makeResult(status, detail, hint) {
  const r = { status }
  if (detail) r.detail = String(detail).slice(0, 600)
  if (hint) r.hint = String(hint).slice(0, 2000)
  return r
}

/** 通用原语执行器（primitive）。 */
async function execPrimitive(check, ctx) {
  const p = ctx && ctx.platform ? ctx.platform : null
  const kind = check && check.primitive
  try {
    if (kind === PRIMITIVE_KIND.COMMAND_EXISTS) {
      const cmd = check.command
      if (!p || typeof p.resolveExecutable !== 'function') return makeResult('pending', 'platform.resolveExecutable unavailable')
      const hit = await p.resolveExecutable(cmd)
      return hit ? makeResult('pass', cmd + ' found: ' + hit) : makeResult('fail', cmd + ' not found in PATH')
    }
    if (kind === PRIMITIVE_KIND.FILE_EXISTS) {
      const rel = check.path
      if (!p || !p.fs || typeof p.fs.resolve !== 'function') return makeResult('pending', 'platform.fs unavailable')
      // 优先用 platform.fs.resolve + readText 探测；不存在即 fail
      try {
        const abs = await p.fs.resolve(rel, { cwd: ctx.cwd })
        // 尝试 stat 式探测（若平台提供 exists/readText）
        if (typeof p.fs.exists === 'function') {
          const ok = await p.fs.exists(abs)
          return ok ? makeResult('pass', rel + ' exists') : makeResult('fail', rel + ' not found')
        }
        if (typeof p.fs.readText === 'function') {
          try { await p.fs.readText(abs); return makeResult('pass', rel + ' exists') } catch { return makeResult('fail', rel + ' not found') }
        }
        // 无探测能力 → pending（诚实，不猜）
        return makeResult('pending', 'fs probe unavailable')
      } catch (e) {
        return makeResult('fail', String((e && e.message) || e))
      }
    }
    if (kind === PRIMITIVE_KIND.ENV) {
      const key = check.key
      const env = p && p.env ? p.env : null
      const val = env && typeof env.get === 'function' ? env.get(key) : (typeof process !== 'undefined' ? process.env[key] : undefined)
      return val ? makeResult('pass', key + '=set') : makeResult('fail', key + ' not set')
    }
    if (kind === PRIMITIVE_KIND.SKILL_PROBE) {
      const skill = check.skill
      // 技能探测经平台 fs 直接探测 ~/.agents/skills/<skill> 或 cwd 相对路径；多平台路径由 platform.getHome 提供
      if (!p || typeof p.getHome !== 'function' || !p.fs) return makeResult('pending', 'platform unavailable for skillProbe')
      try {
        const home = await p.getHome()
        const candidates = [
          home ? (p.path.join(home, '.agents', 'skills', skill)) : null,
          home ? (p.path.join(home, '.claude', 'skills', skill)) : null, // 兼容旧路径
          // cwd 相对 .agents/skills
          ctx.cwd ? (p.path.join(ctx.cwd, '.agents', 'skills', skill)) : null,
        ].filter(Boolean)
        for (const cand of candidates) {
          try {
            if (typeof p.fs.exists === 'function') {
              if (await p.fs.exists(cand)) return makeResult('pass', skill + ' found at ' + cand)
            } else if (typeof p.fs.readText === 'function') {
              try { await p.fs.readText(p.path.join(cand, 'SKILL.md')); return makeResult('pass', skill + ' found') } catch {}
            }
          } catch {}
        }
        return makeResult('fail', skill + ' not found')
      } catch (e) {
        return makeResult('pending', String((e && e.message) || e))
      }
    }
    return makeResult('pending', 'unknown primitive: ' + kind)
  } catch (e) {
    return makeResult('pending', String((e && e.message) || e))
  }
}

/**
 * 创建谓词注册表。
 * @param {Object} [opts]
 * @param {number} [opts.timeout] 单个谓词超时（ms，默认 3000）
 * @returns {{register: (key:string, fn:PredicateFn)=>void, has:(key:string)=>boolean, resolveAll:(chain:import('../../shared/tracker/chain.js').Chain, ctx:PredicateContext)=>Promise<Record<string, PredicateResult>>}}
 */
export function createPredicateRegistry(opts = {}) {
  const timeout = typeof opts.timeout === 'number' ? opts.timeout : 3000
  /** @type {Map<string, PredicateFn>} */
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
   * - backend/preflight：查注册表；未注册 → 'na'（对当前宿主不适用，诚实不猜）
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
          if (raced && raced.__timeout) r = makeResult('pending', 'timeout after ' + timeout + 'ms')
          else r = raced
        } else if (check.kind === 'backend' || check.kind === 'preflight') {
          // key 规则：backend: 'backend:<backendId>:<id>' 或 'preflight:<id>'；兼容直接 id
          const backendId = check.backendId || (ctx && ctx.backendId) || ''
          const keysToTry = []
          if (check.kind === 'backend') {
            if (check.id) keysToTry.push('backend:' + (backendId || '*') + ':' + check.id)
            if (check.id) keysToTry.push(check.id)
          } else {
            if (check.id) keysToTry.push('preflight:' + check.id)
            if (check.id) keysToTry.push(check.id)
          }
          let fn = null
          for (const k of keysToTry) if (map.has(k)) { fn = map.get(k); break }
          if (!fn) {
            // 未注册 = 对当前宿主/后端不适用 → na（高质量：不误判 fail）
            r = makeResult('na', 'predicate not registered: ' + (check.id || ''))
          } else {
            const raced = await withTimeout(fn(check, ctx), timeout)
            if (raced && raced.__timeout) r = makeResult('pending', 'timeout after ' + timeout + 'ms')
            else r = raced
          }
        } else {
          r = makeResult('pending', 'unknown check.kind: ' + check.kind)
        }
        // 归一化 status
        const s = r && r.status
        if (s !== 'pass' && s !== 'fail' && s !== 'na' && s !== 'pending') r.status = 'pending'
        out[id] = r
      } catch (e) {
        out[id] = makeResult('pending', String((e && e.message) || e))
      }
    })
    await Promise.all(tasks)
    return out
  }

  return { register, has, resolveAll, _map: map }
}

/**
 * 将 resolveAll 的结果转为 evaluateChain 的输入（Record<id, 'pass'|'fail'|'na'|null>）。
 * @param {Record<string, PredicateResult>} resolved
 * @returns {Record<string, 'pass'|'fail'|'na'|null>}
 */
export function toPredicateResults(resolved) {
  const out = {}
  for (const [k, v] of Object.entries(resolved || {})) {
    const s = v && v.status
    if (s === 'pass') out[k] = 'pass'
    else if (s === 'fail') out[k] = 'fail'
    else if (s === 'na') out[k] = 'na'
    else out[k] = null // pending/unknown → null（evaluateChain 视为 pending）
  }
  return out
}

export const PREDICATE_REGISTRY_VERSION = 1