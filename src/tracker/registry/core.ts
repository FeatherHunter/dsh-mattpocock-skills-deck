/**
 * src/tracker/registry/core.ts — 注册表主体：装配与选择仲裁（V1 #461 从 registry.js 拆出，纯结构、行为零变化）。
 * 以后谁改它：改注册装配（register/unregister/on）或后端选择仲裁（select 两级联）的人。预估约 170 行，超 350 打回。
 * 接线：引用 shape.ts（形状校验与包桩）与 views.ts（只读视图）；本文件不引用其他新文件；调用方经本文件装配。
 * 第一性原理（#125 定版，承接原 registry.js）：
 *  - 身份识别 = `matches`(boolean) + `select`(两级联仲裁) + `describe`(出 RepositoryRef)；没有 detect op。
 *  - `matches` 超时（缺省 30 秒，见下面的 MATCHES_TIMEOUT_MS，可配）视作 **pending（unknown）**：排除出决策集；
 *    「无 match===true、无 pending」才 fallback→null；有 pending 必须 surface，不静默 Other。
 *
 * #1138（2026-10-14 落地）：本文件原来还存着一份「这个工作区绑了谁」的进程内副本 —— 一张 byHandle 表，
 *   加 bind/bound/allBindings 三个口子，`select` 的第一级联「先看显式绑定」读的也是它。那份副本与工作区文件
 *   `docs/agents/workspace.yaml` 记的是同一件事，却是两份记录（宿主重启即消失），用户的选择因此有两个家。
 *   整段删掉了：人选的唯一真源是工作区文件，判定统一走 `src/tracker/detection/backendDecision.ts`。
 *   注册表从此只答两件事 —— 我这儿有哪些后端（`modules`/`has`/`get`），以及这个仓库是谁（`select` 仲裁）。
 *   连带的一处口径变化：以前「后端被卸载」会把这些绑定标 stale 再通知订阅方清缓存；绑定表没了以后，
 *   改由 `unregister` 事件通知，订阅方按「缓存里答的是不是这个被卸掉的后端」来清（见 platformChannel.js）。
 */

import { TrackerRegistryError, wrapTracker, validateMod } from './shape.js'
import { describe, issueAddress, issueRefPattern, repoSearchAddress } from './views.js'
import type { BackendId } from '../contract/identity.js'
import type { BackendContext, OpContext, RepoHandle } from '../contract/contexts.js'
import type { RepositoryRef } from '../contract/entities.js'
import type { Selection } from '../contract/results.js'
import type { BackendModule } from '../contract/backend-module.js'
import type { Tracker } from '../contract/operations.js'

// 注册表内存表的形状：id 到模块与实例的映射，迭代序即注册序（平局按注册序取首个）。
type RegistryStore = Map<string, { mod: BackendModule; tracker: Tracker }>
// 事件订阅表的形状：事件名到订阅函数集合，监听抛错互相隔离。
type ListenerStore = Map<string, Set<(payload: unknown) => void>>

/**
 * 选后端时，每一路「你是不是这个仓库的后端」（matches）的兜底等待（毫秒）。
 *
 * 为什么是 30 秒（讨论见 #1043，落地见 #1109）：这个数是「等不到」的上限，不是给慢查询留的预算 ——
 * 正常情况下各家应该很快就答得上来，而 3 秒在冷启动、刚装完依赖、要过一次网络的时候太极限，
 * 会把本来答得完的那一路误判成「等不到」。折中到 30 秒：够各家答完，又不至于让一家卡住的后端
 * 把整次选择拖死 —— 超时只把它排除出决策集，并不静默当作「没有后端」（那是 pending 而非 Other）。
 *
 * 改这个数只改这里：生产装配路径（src/host/platformChannel.js）不许自带等待值，两边各写各的
 * 会变成「改了一处、另一处照旧」。这条有门禁盯着：tests/verify-1109-matches-timeout.ts。
 */
export const MATCHES_TIMEOUT_MS = 30000

/** matches 超时包装：返回 {value} / {timedOut:true}；超时同时 abort（传给模块的 signal）。类型说明：未知异步值收 unknown，定时器与控制器都允许缺省。 */
function withTimeout(
  promise: unknown,
  ms: number,
  timers: BackendContext['timers'] | null | undefined,
  controller: AbortController | null | undefined,
): Promise<{ value?: unknown; timedOut?: boolean }> {
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
 * @param {import('../contract/index.js').BackendContext} [backendCtx] create 时注入（host 单例）
 * @param {{matchesTimeout?: number}} [opts]
 * @returns {{
 *   register: (mod: import('../contract/index.js').BackendModule, opts?: {replace?: boolean}) => {dispose: () => void},
 *   unregister: (id: string) => void,
 *   get: (id: string) => import('../contract/index.js').Tracker | undefined,
 *   has: (id: string) => boolean,
 *   modules: () => import('../contract/index.js').BackendModule[],
 *   select: (handle: import('../contract/index.js').RepoHandle, ctx: import('../contract/index.js').OpContext) => Promise<import('../contract/index.js').Selection>,
 *   describe: (handle: import('../contract/index.js').RepoHandle, backendId: string) => import('../../shared/tracker/shape.js').RepositoryRef,
 *   on: (event: 'register'|'unregister', fn: Function) => () => void,
 * }}
 *
 * 没有 bind / bound / allBindings 是 #1138 的有意结果，不是漏了：人选不归注册表管，它住在工作区文件里。
 * 需要「这个工作区用哪个后端」请问 tracker/detection/backendDecision.ts 的统一判定出口。
 * 类型说明：进程级能力缺省空对象（运行时防御式读取），超时选项只认 matchesTimeout。
 */
export function createRegistry(backendCtx: BackendContext = {} as BackendContext, opts: { matchesTimeout?: number } = {}) {
  const matchesTimeout: number = (opts && opts.matchesTimeout != null) ? opts.matchesTimeout : MATCHES_TIMEOUT_MS
  // 注册表：id 到模块与实例的映射，迭代序即注册序，替换时保持键位。
  const byId: RegistryStore = new Map<string, { mod: BackendModule; tracker: Tracker }>()
  const listeners: ListenerStore = new Map<string, Set<(payload: unknown) => void>>([['register', new Set<(payload: unknown) => void>()], ['unregister', new Set<(payload: unknown) => void>()]])

  /** 监听抛错隔离：单个 listener 抛错不影响其他 listener。 */
  function emit(event: string, payload: unknown): void {
    const set = listeners.get(event)
    if (!set) return
    for (const fn of Array.from(set)) {
      try { fn(payload) } catch (e) { /* 隔离；诊断日志留给调用方 */ }
    }
  }

  /**
   * 卸载（幂等）：只从名单里拿掉这个后端，并通知订阅方。
   *
   * #1138：这里原来还会把「绑到这个后端的工作区」标 stale、再发一次 bind 事件，让订阅方清掉按工作区缓存的判定结果。
   *   绑定表删掉以后注册表不知道哪些工作区用过它，改成只发一条 unregister（带上被卸掉的 id），
   *   由订阅方按「缓存里答的是不是这个后端」判断要不要清 —— 与旧口径同样准，且不依赖任何绑定记录。
   */
  function unregister(id: BackendId): void {
    if (!byId.has(id)) return
    byId.delete(id)
    emit('unregister', { id })
  }

  return {
    /** 注册（同步、无副作用**之外的**副作用：只验形状 + Proxy 包桩；不因缺 op 拒绝）。返回 Disposable。类型说明：模块形状复用契约 BackendModule。 */
    register(mod: BackendModule, registerOpts?: { replace?: boolean }) {
      validateMod(mod)
      const replacing = byId.has(mod.id)
      if (replacing && !(registerOpts && registerOpts.replace)) {
        throw new TrackerRegistryError('duplicate-id', `duplicate backend id '${mod.id}' (pass {replace:true} for HMR)`)
      }
      const tracker = wrapTracker(mod, mod.create(backendCtx), backendCtx)
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

    /** 卸载（幂等）：从名单里拿掉，并给订阅方发一条 unregister（见上面那个函数的注释）。 */
    unregister,

    get(id: BackendId) {
      const e = byId.get(id)
      return e ? e.tracker : undefined
    },

    has(id: BackendId) {
      return byId.has(id)
    },

    /** 已注册模块（注册序；供 discover/UI 展示）。 */
    modules() {
      return Array.from(byId.values(), (e) => e.mod)
    },

    /** 同步、无副作用**之外**：仅布尔 matches 运行时调用 + 并行 allSettled + 超时 + AbortSignal。类型说明：调用上下文允许部分缺省，调用方标识经 caller 透传。 */
    async select(handle: RepoHandle, ctx: Partial<OpContext> & { caller?: string } = {}): Promise<Selection> {
      // #1003 空目录语义：拿不到目录时按未知处理，不起任何外部命令，不产出选择。
      //   调用方据此显示“工作区还没就绪”。集中在此一处，所有经注册表的探测共用同一道闸。
      const _cwdEmpty = !(handle && typeof handle.cwd === 'string' && handle.cwd.trim() !== '');
      if (_cwdEmpty) {
        return { backendId: null, source: 'unknown', origin: 'unknown-workspace', pending: undefined };
      }
      const selT0 = Date.now()
      // 日志只是旁证，绝不参与选择：rlog 由调用方注入，可能没有、也可能自己抛错，
      // 所以下面三处都写成一行 try{…}catch(eL){}——记不上就记不上，绝不改变返回值，也不让选择因此失败。
      const rlog = (backendCtx && typeof backendCtx.logEvent === 'function') ? backendCtx.logEvent : null
      // 摘要哈希：只为日志脱敏，不参与选择，输入未知按空串处理。
      function hash8(s: unknown): string { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
      // ① matches（并行；boolean；超时→pending 排除决策集；平局=注册序；AbortSignal 经 ctx.signal 传给模块）
      //   #1138 之前这里先有一段「显式绑定」级联，读的是注册表里那份进程内副本，现已删；
      //   人选那一层由调用方在问注册表之前自己处理（唯一判定出口读工作区文件），本函数只答「谁认得这个仓库」。
      const controller: AbortController | null = (typeof AbortController !== 'undefined') ? new AbortController() : null
      const signal: AbortSignal | undefined = (ctx && ctx.signal) ? ctx.signal : (controller ? controller.signal : undefined)
      const matchCtx = Object.assign({}, ctx, signal ? { signal } : {})
      const entries = Array.from(byId.entries())
      // 关键分支：并行问每一家 matches，超时那家记 pending 并排除出决策集，不静默当无后端。
      const results = await Promise.all(entries.map(async ([id, entry]): Promise<{ id: string; ok?: boolean; pending?: boolean }> => {
        const out = await withTimeout(Promise.resolve(entry.mod.matches(handle, matchCtx as OpContext)), matchesTimeout, (matchCtx as Partial<OpContext>).timers, controller)
        if (out.timedOut) return { id, pending: true }
        return { id, ok: out.value === true }
      }))
      const hits = results.filter((r) => r.ok).map((r) => r.id)
      const pendingIds = results.filter((r) => r.pending).map((r) => r.id)
      if (hits.length >= 1) {
        const choice = hits[0] // 注册序（Map 迭代序）
        try { if (rlog) rlog('info', 'registry.select', { cwdHash: hash8(handle.cwd), backendId: String(choice || ''), source: 'matches', latencyMs: Date.now() - selT0, caller: String((ctx && ctx.caller) || '') }) } catch (eL) {}
        return {
          backendId: choice, source: 'matches',
          ref: describe(byId, handle, choice),
          multiHit: hits.length > 1 ? hits : undefined,
          pending: pendingIds.length ? true : undefined,
        }
      }
      // ② fallback：仅当无 match===true、无 pending；有 pending 必须 surface（不静默 OtherCard）。
      //    注：此时 source 仍为 'fallback'（source 三态枚举），但 pending 非空 = 仲裁未完成——
      //    调用方/UI 应表面化为「等待/建议人自己选一个」，不得当作干净的「无后端」静默 Other。
      //    pending:true = 仲裁有超时未决，UI/调用方必须显示等待/建议人自己选一个，不得静默 OtherCard；
      //    无 pending 且 backendId===null = 已决无后端（OtherCard 唯一身份分支）。
      try { if (rlog) rlog('info', 'registry.select', { cwdHash: hash8(handle.cwd), backendId: '', source: 'fallback', latencyMs: Date.now() - selT0, caller: String((ctx && ctx.caller) || '') }) } catch (eL) {}
      return { backendId: null, source: 'fallback', pending: pendingIds.length ? true : undefined }
    },

    /** 出 RepositoryRef：转发 BackendModule.describe，见 views.ts（byId 显式传引用）。 */
    describe: (handle: RepoHandle, backendId: BackendId): RepositoryRef => describe(byId, handle, backendId),
    // 链接三件（#1110 实现决定第 14 条 → #1133 改名 → #1141 删旧名）：名字用与后端无关的「地址」
    // 说法——远端两家给网址，本地这家算不出票地址时诚实回空串（#1144），票的地址随票走；
    // 「地址」三家都装得下，不像「网址」把本地那家说成例外。
    // 老名字的别名随窗口到期一起删了，这里只剩新名字这一套，房外的读者也只认这一套。
    issueAddress: (backendId: BackendId, ref: RepositoryRef, key: string): string => issueAddress(byId, backendId, ref, key),
    repoSearchAddress: (backendId: BackendId, name: string): string => repoSearchAddress(byId, backendId, name),
    issueRefPattern: (backendId: BackendId): RegExp | string | null => issueRefPattern(byId, backendId),

    /** 事件订阅（register/unregister）；返回取消订阅；监听抛错隔离。 */
    on(event: 'register' | 'unregister', fn: (payload: unknown) => void) {
      const set = listeners.get(event)
      if (!set || typeof fn !== 'function') throw new TrackerRegistryError('bad-event', `unknown event '${event}'`)
      set.add(fn)
      return () => set.delete(fn)
    },
  }
}

export const TRACKER_REGISTRY = Object.freeze({ version: 1 })
