/**
 * tracker/registryCore.js — 注册表主体：装配与选择仲裁（V1 #461 从 registry.js 拆出，纯结构、行为零变化）。
 * 以后谁改它：改注册装配（register/unregister/bind/on）或后端选择仲裁（select 三级联）的人。预估约 190 行，超 350 打回。
 * 接线：引用 registryShape.js（形状校验与包桩）与 registryViews.js（只读视图）；本文件不引用其他新文件；调用方经本文件装配。
 * 第一性原理（#125 定版，承接原 registry.js）：
 *  - 身份识别 = `matches`(boolean) + `select`(三级联仲裁) + `describe`(出 RepositoryRef)；没有 detect op。
 *  - `matches` 超时（默认 3000ms 可配）视作 **pending（unknown）**：排除出决策集；
 *    「无 explicit、无 match===true、无 pending」才 fallback→null；有 pending 必须 surface，不静默 Other。
 */

import { TrackerRegistryError, handleKey, wrapTracker, validateMod } from './registryShape.js'
import { describe, issueUrl, linkPattern, searchUrl } from './registryViews.js'

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
        if (byId.has(id)) return { backendId: id, source: 'explicit', ref: describe(byId, handle, id) }
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
          ref: describe(byId, handle, choice),
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

    /** 出 RepositoryRef：转发 BackendModule.describe，见 registryViews.js（byId 显式传引用）。 */
    describe: (handle, backendId) => describe(byId, handle, backendId),
    issueUrl: (backendId, ref, key) => issueUrl(byId, backendId, ref, key),
    linkPattern: (backendId) => linkPattern(byId, backendId),
    searchUrl: (backendId, name) => searchUrl(byId, backendId, name),

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
