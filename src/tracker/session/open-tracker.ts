/**
 * src/tracker/session/open-tracker.ts —— 公开入口：上层拿会话只许走这里（规格 1439 第一条）。
 *
 * 为什么入口只做三件事（选后端、装会话、交出去）：选后端看的是本地证据（注册表认领，
 * 不出站），装会话只是把管线要的东西配齐，真正的额度分流在管线里。入口自己不判额度、
 * 不起网络、不抛异常——拿不到会话就回一个说清结局的值，调用方按结局说话。
 */
import { CAPABILITIES } from '../contract/operations-catalog.js'
import type { BackendId } from '../contract/identity.js'
import type { OpContext, RepoHandle } from '../contract/contexts.js'
import type { Tracker } from '../contract/operations.js'
import type { Selection } from '../contract/results.js'
import type { RepositoryRef } from '../contract/entities.js'
import type { BackendModule } from '../contract/backend-module.js'
import type { AccountPort, AdmitPort, BackendBudgetModel, BudgetReading } from '../contract/budget-model.js'
import { runPipelineOp } from './pipeline.js'

/** 会话：完整的 Tracker 能力，加上「这是谁的、按什么口径花钱、能不能写」这三格装配信息。 */
export interface TrackerSession extends Tracker {
  /** 后端编号（与注册时那个编号一致，会话不再另起名字）。 */
  readonly backendId: BackendId
  /** 后端的花钱口径（注册时那一份，管线照它解释读数）。 */
  readonly budget: BackendBudgetModel
  /** 写权限就绪没有（沿用现有判定，入口只透传，不自己重判）。 */
  readonly canWrite: boolean
  /** 写权限这一格的来历（就绪是谁说的、没就绪卡在哪，排查时看这一句）。 */
  readonly canWriteReason: string
}

/** 开会话的四种没开成的结局（各有各的名字，调用方按名字分流，不猜字符串）。 */
export type OpenTrackerReason = 'no-backend' | 'multi-match' | 'pending' | 'workspace-not-ready'

/** 开会话的结果：开成就交会话，开不成就交结局（两种都长一个样，调用方不用 try 接）。 */
export type OpenTrackerResult =
  | {
      ok: true
      session: TrackerSession
      /**
       * 选中的仓库身份（判定出口带的那一份；没带就是 null）。
       * 写操作要一个 RepositoryRef，随会话一起交出去，调用方不必为它再问一次注册表。
       */
      repoRef: RepositoryRef | null
    }
  | { ok: false; reason: OpenTrackerReason; detail?: string }

/** 选后端的输入输出形状（默认实现就是注册表的 select，测多命中与未决时才换桩）。 */
export type SelectionResolver = (handle: RepoHandle, ctx: OpContext) => Selection | Promise<Selection>

/** 注册表在入口眼里的样子（只要选与取两件，入口不碰注册表的其余东西）。 */
export interface SessionRegistry {
  select: (handle: RepoHandle, ctx: Partial<OpContext>) => Promise<Selection>
  get: (id: BackendId) => Tracker | undefined
  modules: () => BackendModule[]
}

/** 开会话要齐的东西（读缓存、裁决、记账三件由装配方注入，会话不自己去找）。 */
export interface OpenTrackerOptions {
  /** 注册表（选后端与取实例走它，默认的判定就是它的本地认领）。 */
  registry: SessionRegistry
  /** 读缓存里的那份读数（管线每次调用前读一次，入口打开时不预读）。 */
  getCachedReading: () => BudgetReading | Promise<BudgetReading>
  /** 裁决口（放行还是推迟，它说了算）。 */
  admit: AdmitPort
  /** 记账口（只记账，不改变结果）。 */
  account: AccountPort
  /** 写权限就绪没有（缺省按没就绪：没人说能写，就当不能写，硬顶默认收紧）。 */
  canWrite?: boolean
  /**
   * 写权限这一格改由判定出口回答（缺省 false：老调用方显式给的 canWrite 说了算）。
   * 为什么需要这一格：判定出口（backendDecision）的结论里带着 canWrite 与 reason，
   * 而入口的职责是「一次选后端」，选了后端又让调用方另选一次就多问一遍、还可能问到两个答案。
   */
  canWriteFromSelection?: boolean
  /** 写权限这一格的来历（没给就明说没给，不编一个）。 */
  canWriteReason?: string
  /** 选后端的实现（缺省走注册表；这一支只读本地认领，不出站、不花额度）。 */
  resolveSelection?: SelectionResolver
  /**
   * 选后端的匹配上下文（缺省只给 cwd）。房间认领工作区时要读 .git/config、拼本地的目录与文件路径，
   * 只有 cwd 时它们会判「不认识这个工作区」；需要平台、文件、起进程几件的调用方从这里递进来，
   * 选后端这件事仍然只经 openTracker（宿主与刷新机制不自己调注册表选择）。
   */
  matchContext?: Partial<OpContext>
  /** 诊断钩子（管线分支原因的出口；没有就静默）。 */
  onEvent?: (event: string, fields: Record<string, unknown>) => void
}

/**
 * 打开一个会话（上层唯一的入口）。
 * 永远回值，不抛异常：判定出口炸了也收成未决，调用方看到的只是四种结局之一。
 */
export async function openTracker(handle: RepoHandle, options: OpenTrackerOptions): Promise<OpenTrackerResult> {
  try {
    if (!handle || typeof handle.cwd !== 'string' || handle.cwd.trim() === '') {
      // 工作区还没就绪：连目录都不知道，选后端无从选起，直接回结局，不碰注册表。
      return { ok: false, reason: 'workspace-not-ready', detail: '调用方没给工作区目录，选后端无从选起' }
    }
    const ctx = Object.assign({}, options.matchContext || {}, { cwd: handle.cwd }) as OpContext
    const resolve = options.resolveSelection
      ? options.resolveSelection
      : (h: RepoHandle, c: OpContext): Promise<Selection> => options.registry.select(h, c)
    const selection = await resolve(handle, ctx)
    if (!selection || selection.backendId == null) {
      // 没选出来只有两种诚实说法：未决（还有没回来的认领，不许报成无后端），其余才是无后端。
      if (selection && selection.pending === true) {
        return { ok: false, reason: 'pending', detail: '认领超时未决：有后端还没回话，不报无后端' }
      }
      return { ok: false, reason: 'no-backend', detail: '本地认领问过一圈，没有后端认这个工作区' }
    }
    if (selection.multiHit && selection.multiHit.length > 1) {
      // 多家都认：入口不替人选，报多命中，由人定。
      return { ok: false, reason: 'multi-match', detail: '多家后端同时认领：' + selection.multiHit.join('、') }
    }
    if (selection.pending === true) {
      // 选出来了但仲裁没完：会话不能建在没完的仲裁上，报未决。
      return { ok: false, reason: 'pending', detail: '仲裁未完成就拿到了结论，会话不能建在没完的仲裁上' }
    }
    const tracker = options.registry.get(selection.backendId)
    if (!tracker) {
      return { ok: false, reason: 'pending', detail: '选中的后端不在注册表里（可能刚被卸载），按未决处理' }
    }
    const mod = options.registry.modules().filter((m) => m.id === selection.backendId)[0]
    if (!mod || !mod.budget) {
      // 预算必填：注册表那道校验应当已经拦过，到这里说明装配时绕过了校验，会话拒绝建在没口径的后端上。
      return { ok: false, reason: 'pending', detail: '后端 ' + selection.backendId + ' 没有预算声明，会话拒绝建在没口径的后端上' }
    }
    // 写权限的两种来源：调用方显式给的结论优先；调用方说「按判定出口回答」时才读出口那一路。
    // 出口的结论对象在契约类型上只写到 Selection，canWrite 与 reason 是判定出口多带的两格，
    // 这里按可选读取：取不到就是「没就绪」，与开头的缺省口径一致，不编一个能写。
    const selRecord = (selection || {}) as unknown as Record<string, unknown>
    const fromSelection = options.canWriteFromSelection === true
    const canWrite = options.canWrite === true || (fromSelection && selRecord.canWrite === true)
    const canWriteReason = typeof options.canWriteReason === 'string' && options.canWriteReason
      ? options.canWriteReason
      : (fromSelection
        ? (typeof selRecord.reason === 'string' && selRecord.reason ? String(selRecord.reason) : '判定出口没给写权限：要先让人在工作区里选一次后端（needs-generate）')
        : '调用方没给写权限结论，默认按没就绪（硬顶收紧）')
    const deps = {
      tracker,
      budget: mod.budget,
      canWrite: canWrite,
      getCachedReading: options.getCachedReading,
      admit: options.admit,
      account: options.account,
      // #1446：会话属于哪个后端，管线记账时按它给账本分格（会话不再另起一个后端编号）。
      backendId: selection.backendId,
      onEvent: options.onEvent,
    }
    const session = {
      id: selection.backendId,
      backendId: selection.backendId,
      budget: mod.budget,
      canWrite: canWrite,
      canWriteReason: canWriteReason,
    } as unknown as Record<string, unknown>
    for (const name of CAPABILITIES) {
      if (name === 'describe' || name === 'issueAddress') {
        // 两条同步定位口直通房间：它们不花额度（算身份与地址，不碰远端），不进管线。
        const fn = (tracker as unknown as Record<string, unknown>)[name]
        session[name] = (...args: unknown[]): unknown => (fn as (...a: unknown[]) => unknown)(...args)
      } else {
        // 其余 24 条异步操作（读预算也在内）走管线：读预算在管线里直达房间，其余的过裁决与记账。
        session[name] = (...args: unknown[]): Promise<unknown> => runPipelineOp(deps, name, args)
      }
    }
    // 仓库身份随会话一起交出去：写操作要一个 RepositoryRef，调用方不该为它再问一次注册表。
    // 判定出口没带身份时留 null（自检旧调用方还在用 describe 补），不在这里造假的仓库。
    const repoRef = ((selRecord.ref || null) as unknown) as RepositoryRef | null
    return { ok: true, session: session as unknown as TrackerSession, repoRef: repoRef }
  } catch (err) {
    // 入口的承诺：这一支之上没有 try 能接，所以这里不能再抛——炸了就是未决，理由写清。
    return { ok: false, reason: 'pending', detail: '开会话中途炸了（' + String((err as Error)?.message || err) + '），按未决处理' }
  }
}
