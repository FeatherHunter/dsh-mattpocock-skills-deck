/**
 * tracker/predicateRegistry.js — 宿主谓词注册表（异步 resolve → 纯函数输入）。
 *
 * 生效日期：2026-08-28
 * 效力规则：本文件以 #226 规约为基线；与更早方案冲突以本规约为准；未来任何定版方案若改动本规约，以未来版本为准（见 CONTEXT.md「版本与效力」）。
 *
 * 第一性原理（#217 定版，2026-08-28 修订 #219/#245/#226 删 na，通用谓词原语）：
 *  - 契约层 evaluateChain 为纯函数（喂状态 → 出步骤快照），无 IO；宿主负责把真实世界 resolve 成 Record<id, 'pass'|'fail'|null>（2026-08-27 起无 na）。
 *  - 谓词执行只在宿主（Node）侧，经平台抽象层（platform）访问 OS，不在契约层/ UI 层执行；全部只读探测，失败返回而非抛（#226 验收）。
 *  - 三层 check kind 分发：primitive（通用原语 fs/exec/gh/技能探测）/ backend（后端专属）/ preflight（复用既有门禁）。
 *  - 宿主可知的原语（fs/exec/gh/技能探测）供检查项 check 引用，全部只读探测；注册表验形状不验内容（与 tracker registry 哲学一致，#226）。
 *  - 超时按 pending 处理（不抛、不阻塞整链），诚实透传 detail；谓词只读，永不写文件/环境。
 *
 * 版本：2026-08-28 与 src/shared/tracker/chain.js + check-catalog.js 同步，删 na，通用原语注册表。
 */

import { PRIMITIVE_KIND } from '../../shared/tracker/chain.js'

/**
 * @typedef {Object} PredicateResult
 * @property {'pass'|'fail'|'pending'} status
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
        const abs0 = await p.fs.resolve(rel, { cwd: ctx.cwd })
        // #284：resolve 可能返回 target-shaped 对象（真实 DSH fs 契约）——取 path 再交给探测分支
        const abs = (abs0 && typeof abs0 === 'object' && abs0 !== null && typeof abs0.path === 'string') ? abs0.path : abs0
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
      // #284：优先走 host 注入的判装原语（ctx.skillProbe = DSH 注册表查询 + 红牌分拣 + 等待契约）；
      //   仅未注入时回退标准根 fs 探测（#280 单一尺度：仅标准根 .agents/skills；#281 轻探永不绿的纪律由 host probeSkill 承载）
      if (ctx && typeof ctx.skillProbe === 'function') {
        try {
          const r = await ctx.skillProbe(skill)
          if (r && typeof r === 'object') {
            if (r.level === 'ok') return makeResult('pass', r.detail || (skill + ' ok'), r.hint)
            if (r.level === 'pending') return makeResult('pending', r.detail || ('waiting'), r.hint)
            return makeResult('fail', r.detail || (skill + ' not ok'), r.hint)
          }
          if (r && r.status) return r
        } catch (e) { return makeResult('pending', 'skillProbe error: ' + String((e && e.message) || e)) }
      }
      if (!p || typeof p.getHome !== 'function' || !p.fs) return makeResult('pending', 'platform unavailable for skillProbe')
      try {
        const home = await p.getHome()
        const candidates = [
          home ? (p.path.join(home, '.agents', 'skills', skill)) : null,
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
          if (raced && raced.__timeout) r = makeResult('pending', 'timeout after ' + timeout + 'ms')
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
            if (raced && raced.__timeout) r = makeResult('pending', 'timeout after ' + timeout + 'ms')
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
 * @param {Record<string, PredicateResult>} resolved
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