/**
 * src/refresh/rooms/host/read-session.ts —— 刷新后台**只读会话**的唯一装配口（#1444 · 规格 1439 的 A2 第一批）
 *
 * 为什么要有它：A2 要把刷新后台的读路径（列表、详情、薄行、快照、评论线程、取数链）从
 * 「调用方自己直调 gh」改成「经 Tracker 会话调能力」。会话的装配在每一条调用路径上都会用到，
 * 如果每个取数文件各建一份，闸、账本、后端上下文就会各说各的——规格 1439 要的正是「一处绑定」。
 * 所以这里只造一个开会话的函数，六个取数文件都从宿主那里拿这同一个函数。
 *
 * 三条口径（改之前先读这一段）：
 *  1. 读路径今天从不因额度被推迟（旧路读操作根本不过闸）。迁会话之后如果照抄写路径的剩余量裁决，
 *     低额度时读会被拒——那是行为变化，不是迁移。所以这里的裁决口对读操作一律放行，理由写 'read-path'。
 *  2. 记账口暂时空实现（与 1442、1443 同一口径）：1446 才把账本换成后端预算模型记账。
 *     今天照抄旧账会凭空多出读的消耗（旧路读不进账本），账面对不上也是行为变化。
 *  3. 写权限恒 false：A2 第一批只迁读路径，写路径仍是旧路（1445 收）。
 *     会话本身是只读的，写操作不从这里走。
 *
 * 与 1443 的额度同步读数（refresh-runtime 的 readSessionBudget）的关系：那一处是「只读一条 readBudget、
 * 不开整套读路径」。本文件的开会话也复用它——读数仍然直达房间，不裁决不记账。
 */
import { openTracker } from '../../../tracker/session/open-tracker.js'
import type { TrackerSession } from '../../../tracker/session/open-tracker.js'
import type { SelectionResolver } from '../../../tracker/session/open-tracker.js'
import type { OpContext } from '../../../tracker/contract/contexts.js'
import type { AdmitPort, AccountPort } from '../../../tracker/contract/budget-model.js'
import { buildTrackerPorts } from '../../registry/deck-tool-bridge.js'

/** 开会话时要的那几样：注册表、账本、后端上下文（平台/文件/计时器/起进程/日志/出站控制面）。 */
export interface ReadSessionOpenerDeps {
  /** 后端注册表（宿主那一份，与九个 deck 工具同一份）。 */
  getTrackerRegistry: () => unknown
  /** 闸与账本共用同一本账（buildTrackerPorts 从这里取读数）。 */
  ledger: unknown
  /** 后端上下文：这一次调用的平台、文件、计时器、起进程、日志、出站控制面。 */
  backendCtx: () => Record<string, unknown>
  /** 日志口（只用于开会话失败时的诊断，不新增事件名）。 */
  logCtx?: { fire?: (level: unknown, event: unknown, fields: unknown) => void } | null
}

/** 一次读操作用会话跑：fn 拿到会话与这一次的上下文，自己决定调哪条能力。 */
export interface OpenedReadSession {
  ok: true
  /** 选中的后端编号（调用方要按后端说话时读它，例如写路径的未来分支）。 */
  backendId: string
  /** 后端的花钱口径（调用方不解释它，只是转手给将来的记账）。 */
  budget: unknown
  /** 跑一次：上下文由本文件补齐（cwd、平台、文件、计时器、起进程、日志、出站控制面）。 */
  call: <T>(fn: (session: TrackerSession, ctx: OpContext) => Promise<T>) => Promise<T>
}

/** 开不成会话时的结局（与 openTracker 的四种结局同名，另加两种装配期结局）。 */
export interface ReadSessionFailure {
  ok: false
  reason: string
  detail?: string
}

export type OpenReadSessionResult = OpenedReadSession | ReadSessionFailure

/** 开会话时可以带的两格：选后端的实现（快照复用 detect 结论时不二次探测）。 */
export interface OpenReadSessionOptions {
  resolveSelection?: SelectionResolver
}

/** 读操作的裁决口：一律放行（见文件头第 1 条）。 */
const readAdmit: AdmitPort = function (): { allowed: true; reason: string } {
  return { allowed: true, reason: 'read-path' }
}

/** 读操作的记账口：空实现（见文件头第 2 条，真实用量归 1446）。 */
const readAccount: AccountPort = function (): void {}

/**
 * 造开会话的函数。返回的函数永远回值、不抛：注册表没就绪、目录为空、会话开不成，
 * 都收成带结局名的失败形状，调用方照旧走降级（回旧缓存或如实失败）。
 */
export function createReadSessionOpener(deps: ReadSessionOpenerDeps): (cwd: unknown, opts?: OpenReadSessionOptions) => Promise<OpenReadSessionResult> {
  const ports = buildTrackerPorts({ ledger: deps.ledger })
  const logCtx = deps.logCtx || null
  function openFail(reason: string, detail?: string): ReadSessionFailure {
    try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('debug', 'read.session', { ok: false, reason: reason }) } catch (eL: any) {}
    return { ok: false, reason: reason, detail: detail }
  }
  return async function openReadSession(cwd: unknown, opts?: OpenReadSessionOptions): Promise<OpenReadSessionResult> {
    const cwdStr = (typeof cwd === 'string') ? cwd : String(cwd == null ? '' : cwd)
    if (!cwdStr.trim()) return openFail('workspace-not-ready', '调用方没给工作区目录，选后端无从选起')
    let registry: any = null
    try { registry = await deps.getTrackerRegistry() } catch (eR: any) { registry = null }
    if (!registry || typeof registry.select !== 'function' || typeof registry.get !== 'function' || typeof registry.modules !== 'function') {
      return openFail('no-registry', '后端注册表还没就绪：这一趟读不到会话（不直连 gh，等降级）')
    }
    try {
      const opened: any = await openTracker({ cwd: cwdStr }, {
        registry: registry,
        getCachedReading: ports.getCachedReading as any,
        admit: readAdmit as any,
        account: readAccount as any,
        canWrite: false,
        canWriteReason: 'A2 只迁读路径：写路径仍走旧路，由 #1445 收；读路径今天从不因额度推迟，所以会话一律放行',
        ...(opts && opts.resolveSelection ? { resolveSelection: opts.resolveSelection } : {}),
      })
      if (!opened || opened.ok !== true) {
        return openFail(String((opened && opened.reason) || 'open-failed'), String((opened && opened.detail) || ''))
      }
      const session: TrackerSession = opened.session
      return {
        ok: true,
        backendId: String(session.backendId),
        budget: session.budget,
        call: function <T>(fn: (s: TrackerSession, c: OpContext) => Promise<T>): Promise<T> {
          let base: Record<string, unknown> = {}
          try { base = deps.backendCtx() || {} } catch (eB: any) { base = {} }
          const ctx = Object.assign({}, base, { cwd: cwdStr, signal: undefined, caller: 'refresh' }) as unknown as OpContext
          return Promise.resolve(fn(session, ctx))
        },
      }
    } catch (eO: any) {
      return openFail('open-threw', String((eO && eO.message) || eO))
    }
  }
}
