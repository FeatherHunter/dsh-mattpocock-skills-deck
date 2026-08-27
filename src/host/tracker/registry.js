/**
 * tracker/registry.js — trackerRegistry（主缝的可插拔点）。
 *
 * 第一性原理（#125 定版）：
 *  - 能力 = 运行时调用结果：注册**只验模块形状**（id/label/create/matches 是函数），不因「缺某 op」拒绝；
 *    `create()` 产物按 Proxy 包桩——缺的方法自动补 `unsupported` 桩（准入墙消失，诚实桩不误导）。
 *  - 无能力表、无能力缓存、无能力分支、无运行期内省（G5 红线）。
 *  - `'other'` **弃用、不注册**；「无后端」只在 `Selection.backendId: null`（此时 ref 省略，不造假 RepositoryRef）。
 *  - 身份识别 = `matches`(boolean) + `select`(三级联仲裁) + `describe`(出 RepositoryRef)；没有 detect op。
 *  - `matches` 超时（默认 3000ms 可配）视作 **pending（unknown）**：排除出决策集；
 *    「无 explicit、无 match===true、无 pending」才 fallback→null；有 pending 必须 surface，不静默 Other。
 */

import { ERROR_KIND } from '../../shared/tracker/constants.js'
import { OPERATIONS } from './contract.js'

/**
 * 迁移键（migration 说明，非运行时分支）：旧 `'other'` 保留串 → `null`（无后端 = Selection.backendId:null）。
 * 旧缓存「双读迁移」属 B 档（客户端缓存侧）；此常量先行落地，供下游实现引用。
 */
export const MIGRATE_KEY = Object.freeze({ other: null })

/** registry 错误（code 供程序判断；message 供人读）。 */
export class TrackerRegistryError extends Error {
  constructor(code, message) {
    super(message || code)
    this.code = code
    this.name = 'TrackerRegistryError'
  }
}

/** handle 稳定键（cwd 或 refId）。 */
function handleKey(handle) {
  if (!handle || typeof handle !== 'object') throw new TrackerRegistryError('bad-handle', 'handle is required')
  const k = handle.cwd || handle.refId
  if (!k) throw new TrackerRegistryError('bad-handle', 'handle needs cwd or refId')
  return String(k)
}

/** 缺方法 → uniform unsupported 桩（能力=运行时调用结果；返回不抛）。 */
function unsupportedStub(opName, backendId) {
  const stub = async function unsupportedOp() {
    return { ok: false, error: { kind: ERROR_KIND.UNSUPPORTED, message: `backend ${backendId} does not implement op ${opName}` } }
  }
  Object.defineProperty(stub, 'name', { value: `${opName}:unsupported`, configurable: true })
  return stub
}

/**
 * 把 BackendModule.create 产物包成 Tracker：
 *  - id 固定为模块 id（自报不一致 = 说谎 → 拒绝）；
 *  - OP_NAMES 里缺的方法 → unsupported 桩；其余未知属性透传（容器可能有旁路如 snapshotFast，见 snapshot.js）。
 */
function wrapTracker(mod, impl) {
  if (!impl || typeof impl !== 'object') {
    throw new TrackerRegistryError('shape', `create(${mod.id}) must return an object (got ${typeof impl})`)
  }
  if (impl.id !== undefined && impl.id !== mod.id) {
    throw new TrackerRegistryError('shape', `create(${mod.id}) returned inconsistent id '${impl.id}'`)
  }
  const target = Object.assign({}, impl)
  return new Proxy(target, {
    get(t, prop, receiver) {
      const v = Reflect.get(t, prop, receiver)
      if (v !== undefined) return v
      if (typeof prop === 'string' && prop === 'id') return mod.id
      if (typeof prop === 'string' && OPERATIONS.includes(prop)) return unsupportedStub(prop, mod.id)
      return undefined
    },
  })
}

/** matches 超时包装：返回 {value} / {timedOut:true}；超时同时 abort（传给模块的 signal）。 */
function withTimeout(promise, ms, timers, controller) {
  const setT = (timers && typeof timers.setTimeout === 'function') ? timers.setTimeout.bind(timers) : setTimeout
  const clearT = (timers && typeof timers.clearTimeout === 'function') ? timers.clearTimeout.bind(timers) : clearTimeout
  return new Promise((resolve) => {
    let settled = false
    const t = setT(() => {
      if (settled) return
      settled = true
      try { if (controller) controller.abort() } catch (e) { /* noop */ }
      resolve({ timedOut: true })
    }, ms)
    Promise.resolve(promise).then(
      (v) => { if (!settled) { settled = true; clearT(t); resolve({ value: v }) } },
      () => { if (!settled) { settled = true; clearT(t); resolve({ value: false }) } }, // matches 抛错 → 假身位不可用（false + diagnostics 由调用方日志）
    )
  })
}

/**
 * 创建一个 trackerRegistry。
 * @param {import('./contract.js').BackendContext} [backendCtx] create 时注入（host 单例）
 * @param {{matchesTimeout?: number}} [opts]
 * @returns {{
 *   register: (mod: import('./contract.js').BackendModule, opts?: {replace?: boolean}) => {dispose: () => void},
 *   unregister: (id: string) => void,
 *   get: (id: string) => import('./contract.js').Tracker | undefined,
 *   has: (id: string) => boolean,
 *   modules: () => import('./contract.js').BackendModule[],
 *   select: (handle: import('./contract.js').RepoHandle, ctx: import('./contract.js').OpContext) => Promise<import('./contract.js').Selection>,
 *   bind: (handle: import('./contract.js').RepoHandle, backendId: string|null) => void,
 *   bound: (handle: import('./contract.js').RepoHandle) => string|null|undefined,
 *   describe: (handle: import('./contract.js').RepoHandle, backendId: string) => import('../../shared/tracker/shape.js').RepositoryRef,
 *   allBindings: () => Array<{handleKey: string, cwd: string, backendId: string|null, handle: import('./contract.js').RepoHandle}>,
 *   on: (event: 'register'|'unregister'|'bind', fn: Function) => () => void,
 * }}
 */
export function createRegistry(backendCtx = {}, opts = {}) {
  const matchesTimeout = (opts && opts.matchesTimeout != null) ? opts.matchesTimeout : 3000
  const byId = new Map() // id -> {mod, tracker}；Map 迭代序 = 注册序（replace 保持键位 → 平局=注册序）
  const byHandle = new Map() // handleKey -> {backendId: string|null, handle}（null = 显式无后端；handle 供 stale 通知携带真实句柄）
  const listeners = new Map([['register', new Set()], ['unregister', new Set()], ['bind', new Set()]])

  /** 监听抛错隔离：单个 listener 抛错不影响其他 listener。 */
  function emit(event, payload) {
    const set = listeners.get(event)
    if (!set) return
    for (const fn of Array.from(set)) {
      try { fn(payload) } catch (e) { /* 隔离；诊断日志留给调用方 */ }
    }
  }

  function validateMod(mod) {
    if (!mod || typeof mod !== 'object') throw new TrackerRegistryError('shape', 'BackendModule must be an object')
    if (typeof mod.id !== 'string' || !mod.id) throw new TrackerRegistryError('shape', 'id must be a non-empty string')
    if (typeof mod.label !== 'string') throw new TrackerRegistryError('shape', 'label must be a string')
    if (typeof mod.create !== 'function') throw new TrackerRegistryError('shape', 'create must be a function')
    if (typeof mod.matches !== 'function') throw new TrackerRegistryError('shape', 'matches must be a function')
    if (mod.id === 'other') {
      throw new TrackerRegistryError('other-not-registrable', "'other' 已弃用：无后端请用 Selection.backendId:null（不造后端，不造假身份）")
    }
  }

  /** 卸载（幂等）；被绑定的 handle 标 stale（清除绑定，触发 on('bind') 监听回退）。 */
  function unregister(id) {
    if (!byId.has(id)) return
    byId.delete(id)
    const keys = []
    const staleHandles = []
    for (const [k, v] of byHandle) {
      if (v.backendId === id) {
        byHandle.delete(k)
        keys.push(k)
        staleHandles.push(v.handle) // 携带真实 handle，不得只给字符串 key 丢 handle
      }
    }
    emit('unregister', { id, handles: keys })
    for (const handle of staleHandles) emit('bind', { handle, backendId: null, stale: true })
  }

  /** 出 RepositoryRef：转发 BackendModule.describe（可选），回退骨架（#220 · registry 只转发）。 */
  function describe(handle, backendId) {
    const entry = byId.get(backendId)
    if (entry && entry.mod && typeof entry.mod.describe === 'function') {
      try {
        const r = entry.mod.describe(handle, backendId)
        if (r && typeof r === 'object' && typeof r.refId === 'string') {
          return {
            backend: r.backend || backendId,
            refId: r.refId || '',
            name: r.name || r.refId || (handle.cwd || backendId),
            url: typeof r.url === 'string' ? r.url : '',
          }
        }
        if (r && typeof r === 'object') return r
      } catch (e) { /* 回退骨架 */ }
    }
    // 也尝试 tracker 实例上的 describe（若模块经 create 暴露）
    try {
      const tr = entry && entry.tracker
      if (tr && typeof tr.describe === 'function') {
        const r2 = tr.describe(handle, backendId)
        if (r2 && typeof r2 === 'object' && typeof r2.refId === 'string') {
          return {
            backend: r2.backend || backendId,
            refId: r2.refId || '',
            name: r2.name || r2.refId || (handle.cwd || backendId),
            url: typeof r2.url === 'string' ? r2.url : '',
          }
        }
      }
    } catch (e) {}
    // 骨架回退：markdown 用 cwd，其余空（等价旧行为）
    const refId = handle.refId || (backendId === 'markdown' ? handle.cwd : '')
    const name = refId || (handle.cwd || backendId)
    return { backend: backendId, refId, name, url: '' }
  }

  /** issueUrl 只读 view：转发 BackendModule.issueUrl / tracker.issueUrl，回退按 backendId 拼装（#220）。 */
  function issueUrl(backendId, ref, key) {
    const entry = byId.get(backendId)
    if (entry && entry.mod && typeof entry.mod.issueUrl === 'function') {
      try { const u = entry.mod.issueUrl(ref, String(key)); if (typeof u === 'string') return u } catch (e) {}
    }
    try {
      const tr = entry && entry.tracker
      if (tr && typeof tr.issueUrl === 'function') {
        const u2 = tr.issueUrl(ref, String(key)); if (typeof u2 === 'string') return u2
      }
    } catch (e) {}
    if (backendId === 'github' && ref && ref.refId) return 'https://github.com/' + ref.refId + '/issues/' + String(key)
    if (backendId === 'gitlab' && ref && ref.refId) return 'https://gitlab.com/' + ref.refId + '/-/issues/' + String(key)
    return ''
  }

  /** linkPattern 只读 view：转发 BackendModule.linkPattern。 */
  function linkPattern(backendId) {
    const entry = byId.get(backendId)
    if (entry && entry.mod && entry.mod.linkPattern) return entry.mod.linkPattern
    try { const tr = entry && entry.tracker; if (tr && tr.linkPattern) return tr.linkPattern } catch (e) {}
    if (backendId === 'github') return /github\.com\/[^\/\s]+\/[^\/\s]+\/issues\/(\d+)/g
    if (backendId === 'gitlab') return /gitlab\.com\/[^\/\s]+\/[^\/\s]+\/-\/issues\/(\d+)/g
    return null
  }

  /** searchUrl 只读 view：转发 BackendModule.searchUrl。 */
  function searchUrl(backendId, name) {
    const entry = byId.get(backendId)
    if (entry && entry.mod && typeof entry.mod.searchUrl === 'function') {
      try { const u = entry.mod.searchUrl(String(name)); if (typeof u === 'string') return u } catch (e) {}
    }
    try {
      const tr = entry && entry.tracker
      if (tr && typeof tr.searchUrl === 'function') { const u2 = tr.searchUrl(String(name)); if (typeof u2 === 'string') return u2 }
    } catch (e) {}
    if (backendId === 'github') return 'https://github.com/search?q=' + encodeURIComponent(String(name))
    return ''
  }

  return {
    /** 注册（同步、无副作用**之外的**副作用：只验形状 + Proxy 包桩；不因缺 op 拒绝）。返回 Disposable。 */
    register(mod, registerOpts) {
      validateMod(mod)
      const replacing = byId.has(mod.id)
      if (replacing && !(registerOpts && registerOpts.replace)) {
        throw new TrackerRegistryError('duplicate-id', `duplicate backend id '${mod.id}' (pass {replace:true} for HMR)`)
      }
      const tracker = wrapTracker(mod, mod.create(backendCtx))
      const entry = { mod, tracker } // 本次注册的 entry（Disposable 闭包按代捕获，见下）
      byId.set(mod.id, entry)
      emit('register', { id: mod.id, mod, replacing })
      let disposed = false
      return {
        /** 按代隔离：仅当 byId 里仍是「本次注册的 entry」才卸载——replace:true 覆盖后，旧代 dispose 不得误杀新代。 */
        dispose() {
          if (disposed) return
          disposed = true
          if (byId.get(mod.id) !== entry) return // 已被新代覆盖 → 旧代不强删（避免误杀新 tracker）
          unregister(mod.id)
        },
      }
    },

    /** 卸载（幂等）；被绑定的 handle 标 stale（清除绑定，触发 on('bind') 监听回退）。 */
    unregister,

    get(id) {
      const e = byId.get(id)
      return e ? e.tracker : undefined
    },

    has(id) {
      return byId.has(id)
    },

    allBindings() {
      return Array.from(byHandle.entries(), ([handleKey, v]) => ({ handleKey, cwd: (v.handle && v.handle.cwd) || '', backendId: v.backendId, handle: v.handle }))
    },

    /** 已注册模块（注册序；供 discover/UI 展示）。 */
    modules() {
      return Array.from(byId.values(), (e) => e.mod)
    },

    /** 同步、无副作用**之外**：仅布尔 matches 运行时调用 + 并行 allSettled + 超时 + AbortSignal。 */
    async select(handle, ctx = {}) {
      const k = handleKey(handle)
      // ① explicit（bind 记忆）
      if (byHandle.has(k)) {
        const id = byHandle.get(k).backendId
        if (id === null) return { backendId: null, source: 'explicit' } // ref 省略（无后端，不造假）
        if (byId.has(id)) return { backendId: id, source: 'explicit', ref: describe(handle, id) }
        // bound stale 兜底 → 落到 matches
      }
      // ② matches（并行；boolean；超时→pending 排除决策集；平局=注册序；AbortSignal 经 ctx.signal 传给模块）
      const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null
      const signal = (ctx && ctx.signal) ? ctx.signal : (controller ? controller.signal : undefined)
      const matchCtx = Object.assign({}, ctx, signal ? { signal } : {})
      const entries = Array.from(byId.entries())
      const results = await Promise.all(entries.map(async ([id, entry]) => {
        const out = await withTimeout(Promise.resolve(entry.mod.matches(handle, matchCtx)), matchesTimeout, matchCtx.timers, controller)
        if (out.timedOut) return { id, pending: true }
        return { id, ok: out.value === true }
      }))
      const hits = results.filter((r) => r.ok).map((r) => r.id)
      const pendingIds = results.filter((r) => r.pending).map((r) => r.id)
      if (hits.length >= 1) {
        const choice = hits[0] // 注册序（Map 迭代序）
        return {
          backendId: choice, source: 'matches',
          ref: describe(handle, choice),
          multiHit: hits.length > 1 ? hits : undefined,
          pending: pendingIds.length ? true : undefined,
        }
      }
      // ③ fallback：仅当无 explicit、无 match===true、无 pending；有 pending 必须 surface（不静默 OtherCard）。
      //    注：此时 source 仍为 'fallback'（source 三态枚举），但 pending 非空 = 仲裁未完成——
      //    调用方/UI 应表面化为「等待/建议显式 bind」，不得当作干净的「无后端」静默 Other。
      //    pending:true = 仲裁有超时未决，UI/调用方必须显示等待/建议 bind，不得静默 OtherCard；
      //    无 pending 且 backendId===null = 已决无后端（OtherCard 唯一身份分支）。
      return { backendId: null, source: 'fallback', pending: pendingIds.length ? true : undefined }
    },

    /** 显式绑定（backendId=null = 显式无后端，逃生舱）；'other' 等未注册 id 拒绝。 */
    bind(handle, backendId) {
      const k = handleKey(handle)
      if (backendId !== null && !byId.has(backendId)) {
        throw new TrackerRegistryError('unknown-backend', `backend '${backendId}' not registered`)
      }
      byHandle.set(k, { backendId, handle }) // 存真实 handle：unregister 的 stale 通知（on('bind') 回退）须携带句柄
      emit('bind', { handle, backendId })
    },

    /** undefined = 从未 bound；null = 显式无后端；string = 已绑定。 */
    bound(handle) {
      const k = handleKey(handle)
      return byHandle.has(k) ? byHandle.get(k).backendId : undefined
    },

    /** 出 RepositoryRef：转发 BackendModule.describe，见上方。 */
    describe,
    issueUrl,
    linkPattern,
    searchUrl,

    /** 事件订阅（register/unregister/bind）；返回取消订阅；监听抛错隔离。 */
    on(event, fn) {
      const set = listeners.get(event)
      if (!set || typeof fn !== 'function') throw new TrackerRegistryError('bad-event', `unknown event '${event}'`)
      set.add(fn)
      return () => set.delete(fn)
    },
  }
}

export const TRACKER_REGISTRY = Object.freeze({ version: 1 })