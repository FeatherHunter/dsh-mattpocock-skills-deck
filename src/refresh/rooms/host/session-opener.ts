/**
 * src/refresh/rooms/host/session-opener.ts —— 刷新后台开会话的唯一装配口（#1444 读路径 · #1445 写路径，规格 1439 的 A2）
 *
 * 为什么要有它：A2 要把刷新后台的读写路径从「调用方自己直调 gh」改成「经 Tracker 会话调能力」。
 * 会话的装配在每一条调用路径上都会用到，如果每个取数/写入文件各建一份，闸、账本、后端上下文
 * 就会各说各的——规格 1439 要的正是「一处绑定」。所以这里只造一个开会话的函数，调用方从宿主那里拿这同一个函数。
 *
 * 三条口径（改之前先读这一段）：
 *  1. 读会话的裁决口一律放行（理由 'read-path'）：旧路读操作根本不过闸，照抄写路径的剩余量裁决会在
 *     低额度时把读拒掉，那是行为变化，不是迁移。写会话的裁决仍走装配层那一份（与 deck 工具同一份口径），
 *     写权限由判定出口的 canWrite 决定，取不到就当没就绪。
 *  2. 记账口自 #1446 起是真记账：房间在成功信封上自报用量（OpUsage），换算成「后端 + 桶」的
 *     几笔交给账本（见 src/refresh/kernel/backend-accounting.ts）。读路径也一样记账——「不被额度拦」
 *     与「花了多少要记下来」是两件事，前者是裁决，后者是量账；1439 之前读路径不记账才让账本越走越偏。
 *     开会话时顺手调一次 ensureBackend：账本按后端建模，桶要先建出来，写第一笔时才不会因为桶缺席当场炸。
 *  3. 仓库身份随会话一起交出去（openTracker 回包里的 repoRef）：写操作要一个 RepositoryRef，
 *     判定出口没带时在这里用 describe 补一次；GitHub 仍缺 refId 时按旧的评论写路径同一条三级解析
 *     退到 getRepoKey（git remote → .git/config → gh repo view）。调用方不再自己问注册表。
 *
 * 与 1443 的额度同步读数（refresh-runtime 的 readSessionBudget）的关系：那一处只读一条 readBudget、
 * 不开整套读写路径。本文件的开会话也复用它——读数仍然直达房间，不裁决不记账。
 */
import { openTracker } from '../../../tracker/session/open-tracker.js'
import { createAccountPort } from '../../kernel/backend-accounting.js'
import type { TrackerSession } from '../../../tracker/session/open-tracker.js'
import type { SelectionResolver } from '../../../tracker/session/open-tracker.js'
import type { RepositoryRef } from '../../../tracker/contract/entities.js'
import type { OpContext } from '../../../tracker/contract/contexts.js'
import type { AdmitPort } from '../../../tracker/contract/budget-model.js'
import { buildTrackerPorts } from '../../registry/deck-tool-bridge.js'

/** 起一个进程的出口（发布时用宿主那套 execProc，超时按写操作那一档算，不用探测档）。 */
export type SessionExec = (cmd: string, args: string[], opts?: { cwd?: string; timeout?: number; signal?: AbortSignal }) => Promise<unknown>

/** 开会话时要的那几样：注册表、账本、后端上下文（平台/文件/计时器/起进程/日志/出站控制面）。 */
export interface SessionOpenerDeps {
  /** 后端注册表（宿主那一份，与九个 deck 工具同一份）。 */
  getTrackerRegistry: () => unknown
  /** 闸与账本共用同一本账（buildTrackerPorts 从这里取读数）。 */
  ledger: unknown
  /** 后端上下文：这一次调用的平台、文件、计时器、起进程、日志、出站控制面。 */
  backendCtx: () => Record<string, unknown>
  /** 仓库身份的最后一道解析（判定出口与 describe 都补不出 refId 时才问它；没有就如实交 null）。 */
  getRepoKey?: (cwd: string) => Promise<{ owner?: string; name?: string } | null>
  /** 日志口（只用于开会话失败时的诊断，事件名 read.session）。 */
  logCtx?: { fire?: (level: unknown, event: unknown, fields: unknown) => void } | null
  /**
   * 把「这个后端按什么口径花钱」交给账本（账本据此建桶；#1446 加）。
   * 为什么由装配方注入而不是本文件去拿账本：本文件不持有账本，只持有桥给的三个端口；
   * 装配方（refresh-runtime）手里才有账本实例。缺省不调：门禁与单测里不注入就保持旧行为。
   */
  ensureBackend?: (backendId: string, budget: unknown) => void
}

/** 一层会话：会话本身、这一次的仓库身份、以及「这个会话能不能写」的结论。 */
export interface OpenedSession {
  ok: true
  /** 选中的后端编号（调用方要按后端说话时读它）。 */
  backendId: string
  /** 后端的花钱口径（调用方不解释它，只是转手给将来的记账）。 */
  budget: unknown
  /** 这一次的仓库身份（写操作直接用；读操作通常不看）。 */
  repoRef: RepositoryRef | null
  /** 这个会话能不能写（读会话恒 false；写会话由判定出口的 canWrite 决定）。 */
  canWrite: boolean
  /** 跑一次：上下文由本文件补齐（cwd、平台、文件、计时器、起进程、日志、出站控制面、调用方身份）。 */
  call: <T>(fn: (session: TrackerSession, ctx: OpContext) => Promise<T>) => Promise<T>
}

/** 开不成会话时的结局（与 openTracker 的四种结局同名，另加两种装配期结局）。 */
export interface SessionFailure {
  ok: false
  reason: string
  detail?: string
}

export type OpenSessionResult = OpenedSession | SessionFailure

/** 开会话时可以带的几格（写模式、写权限口径、选后端的实现、起进程的出口）。 */
export interface OpenSessionOptions {
  /** 写会话：写权限按判定出口回答，调用方可另给 exec（发布时 git 要跑宿主那一套）。 */
  write?: boolean
  /**
   * 这条写路径迁移前不看判定出口的写权限（人在面板上点了评论/发布/认领，意图本身就是授权），
   * 出问题时由房间把「不可写」的失败如实报回来。这类调用点显式传 true，保持迁移前的行为；
   * 不传就按判定出口回答（当前只有标签颜色那条旧路本来就要求人先在工作区里选过后端）。
   */
  canWrite?: boolean
  /** 选后端的实现（快照复用 detect 结论时不二次探测）。 */
  resolveSelection?: SelectionResolver
  /** 这一次的起进程出口（写会话可覆盖；不覆盖就用后端上下文里那一份）。 */
  exec?: SessionExec
}

/** 读操作的裁决口：一律放行（见文件头第 1 条）。 */
const readAdmit: AdmitPort = function (): { allowed: true; reason: string } {
  return { allowed: true, reason: 'read-path' }
}

/**
 * 造开会话的函数。返回的函数永远回值、不抛：注册表没就绪、目录为空、会话开不成，
 * 都收成带结局名的失败形状，调用方照旧走降级（回旧缓存或如实失败）。
 */
export function createSessionOpener(deps: SessionOpenerDeps): (cwd: unknown, opts?: OpenSessionOptions) => Promise<OpenSessionResult> {
  const ports = buildTrackerPorts({ ledger: deps.ledger })
  // #1454：刷新这条路径记 'plugin' 档；换算与写账都收在 createAccountPort 里，全仓只有那一处
  // ledger.spend。桥里那份账号记 'ai-tool'，与本文件这份档位不同（两条路的 caller 不同，账要分开记）。
  const accountPort = createAccountPort({ ledger: deps.ledger, account: 'plugin' })
  const logCtx = deps.logCtx || null
  function openFail(reason: string, detail?: string): SessionFailure {
    try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('debug', 'read.session', { ok: false, reason: reason }) } catch (eL: any) {}
    return { ok: false, reason: reason, detail: detail }
  }
  /** 补出仓库身份：判定出口带的先用；缺 refId 时问 describe；GitHub 再退到 getRepoKey 的三级解析。 */
  async function resolveRepoRef(cwdStr: string, backendId: string, session: TrackerSession, fromSelection: RepositoryRef | null): Promise<RepositoryRef | null> {
    let ref: RepositoryRef | null = (fromSelection && fromSelection.refId) ? fromSelection : null
    if (!ref) {
      try {
        const described: any = (session as any).describe({ cwd: cwdStr }, backendId)
        if (described) ref = Object.assign({}, described) as RepositoryRef
      } catch (eD: any) { ref = null }
    }
    const needRefId: boolean = !ref || !(ref as any).refId
    if (needRefId && backendId === 'github' && typeof deps.getRepoKey === 'function') {
      // 与旧评论写路径同一条三级解析：GitHub 的判定出口不一定带 refId，缺它时后端无法定位仓库。
      try {
        const key: any = await deps.getRepoKey(cwdStr)
        if (key && key.owner && key.name) {
          const merged: any = Object.assign({}, ref || {})
          merged.refId = key.owner + '/' + key.name
          merged.name = merged.refId
          merged.url = 'https://github.com/' + merged.refId
          return merged as RepositoryRef
        }
      } catch (eK: any) {}
    }
    return ref
  }
  return async function openSession(cwd: unknown, opts?: OpenSessionOptions): Promise<OpenSessionResult> {
    const cwdStr = (typeof cwd === 'string') ? cwd : String(cwd == null ? '' : cwd)
    if (!cwdStr.trim()) return openFail('workspace-not-ready', '调用方没给工作区目录，选后端无从选起')
    let registry: any = null
    try { registry = await deps.getTrackerRegistry() } catch (eR: any) { registry = null }
    if (!registry || typeof registry.select !== 'function' || typeof registry.get !== 'function' || typeof registry.modules !== 'function') {
      return openFail('no-registry', '后端注册表还没就绪：这一趟拿不到会话（不直连 gh，等降级）')
    }
    const write: boolean = !!(opts && opts.write === true)
    try {
      const opened: any = await openTracker({ cwd: cwdStr }, {
        registry: registry,
        getCachedReading: ports.getCachedReading as any,
        admit: (write ? ports.admit : readAdmit) as any,
        // #1446：读写两条路都记账（读路径的裁决仍恒放行，见文件头第 1 条；记账不是裁决）。
        account: accountPort as any,
        canWrite: !!(opts && opts.canWrite === true),
        ...(write
          ? { canWriteFromSelection: true, canWriteReason: '写会话的写权限由判定出口回答（取不到就是没就绪，不默认放开）' }
          : { canWriteReason: '读会话只读：读路径今天从不因额度推迟，所以裁决一律放行' }),
        ...(opts && opts.resolveSelection ? { resolveSelection: opts.resolveSelection } : {}),
      })
      if (!opened || opened.ok !== true) {
        return openFail(String((opened && opened.reason) || 'open-failed'), String((opened && opened.detail) || ''))
      }
      const session: TrackerSession = opened.session
      // #1446：账本按后端建模，桶要先建出来（同一后端模型不变时这一步幂等，不会每次重建）。
      try { if (typeof deps.ensureBackend === 'function') deps.ensureBackend(String(session.backendId), session.budget) } catch (eE: any) {}
      const repoRef: RepositoryRef | null = await resolveRepoRef(cwdStr, String(session.backendId), session, (opened.repoRef || null) as RepositoryRef | null)
      return {
        ok: true,
        backendId: String(session.backendId),
        budget: session.budget,
        repoRef: repoRef,
        canWrite: session.canWrite === true,
        call: function <T>(fn: (s: TrackerSession, c: OpContext) => Promise<T>): Promise<T> {
          let base: Record<string, unknown> = {}
          try { base = deps.backendCtx() || {} } catch (eB: any) { base = {} }
          const over: Record<string, unknown> = { cwd: cwdStr, signal: undefined, caller: 'refresh' }
          if (opts && typeof opts.exec === 'function') over.exec = opts.exec
          const ctx = Object.assign({}, base, over) as unknown as OpContext
          return Promise.resolve(fn(session, ctx))
        },
      }
    } catch (eO: any) {
      return openFail('open-threw', String((eO && eO.message) || eO))
    }
  }
}
