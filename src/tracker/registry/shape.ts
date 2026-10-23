/**
 * src/tracker/registry/shape.ts — 注册形状校验与缺方法包桩（V1 #461 从 registry.js 拆出，纯结构、行为零变化）。
 * 以后谁改它：改后端模块形状校验（id/label/create/matches）或缺方法 unsupported 包桩语义的人。预估约 90 行，超 350 打回。
 * 接线：只被 core.ts 引用；预算形状只从契约层引用类型与数据（契约层在同层互引判域之外）。
 * 第一性原理（#125 定版，承接原 registry.js）：
 *  - 能力 = 运行时调用结果：注册**只验模块形状**，不因「缺某 op」拒绝；
 *    `create()` 产物按 Proxy 包桩——缺的**操作**自动补 `unsupported` 桩（准入墙消失，诚实桩不误导）。
 *    三条定位口（`getRepoKey` / `describe` / `issueAddress`）不在此列：它们没有「我不支持」这种答案，
 *    缺席就是缺席，取到 `undefined`，调用方按空值往下走（见 contract/operations.ts 的说明）。
 *  - 无能力表、无能力缓存、无能力分支、无运行期内省（G5 红线）。
 *  - `'other'` **弃用、不注册**。
 */

import { ERROR_KIND } from '../contract/vocabulary.js'
import { OPERATIONS } from '../contract/index.js'
import { fail } from '../kernel/preflight.js'
import { BUDGET_KINDS } from '../contract/budget-model.js'
import type { BackendBudgetModel } from '../contract/budget-model.js'
import type { BackendId } from '../contract/identity.js'
import type { BackendContext, RepoHandle } from '../contract/contexts.js'
import type { BackendModule } from '../contract/backend-module.js'
import type { Tracker } from '../contract/operations.js'
import type { RoomOperations } from '../contract/operations.js'

/**
 * 迁移键（migration 说明，非运行时分支）：旧 `'other'` 保留串 → `null`（无后端 = Selection.backendId:null）。
 * 旧缓存「双读迁移」属 B 档（客户端缓存侧）；此常量先行落地，供下游实现引用。
 */
export const MIGRATE_KEY = Object.freeze({ other: null })

/** registry 错误（code 供程序判断；message 供人读）。类型说明：code 是程序分支用的错误码。 */
export class TrackerRegistryError extends Error {
  // 错误码：供程序分支判断用，与给人读的 message 分开。
  code: string
  constructor(code: string, message?: string) {
    super(message || code)
    this.code = code
    this.name = 'TrackerRegistryError'
  }
}

/**
 * handle 稳定键（cwd 或 refId）。
 * 只做系统无关洗（934：去首尾空白、反斜杠转正斜杠、折叠连续斜杠、去尾斜杠）：
 * 同一条目录的斜杠写法不同时仍落同一桶，而大小写与锚到工作区根这两步留给宿主唯一的
 * 异步出口 canonicalKey（src/host/workspaceKey.js），注册表不替它做系统相关归一。
 */
export function washHandleKey(raw: unknown): string {
  let s = String(raw == null ? '' : raw).trim()
  if (!s) return s
  s = s.replace(/\\/g, '/')
  const isUnc = s.indexOf('//') === 0
  if (isUnc) {
    const rest = s.slice(2).replace(/^\/+/, '').replace(/\/+/g, '/')
    s = '//' + rest
  } else {
    s = s.replace(/\/+/g, '/')
  }
  while (s.length > 1 && s.charAt(s.length - 1) === '/') {
    if (s === '//') break
    s = s.slice(0, -1)
  }
  return s
}
/** handle 稳定键（cwd 或 refId，系统无关洗之后）。类型说明：收未知输入做防御式校验，契约形状经断言复用 RepoHandle。 */
export function handleKey(handle: unknown): string {
  if (!handle || typeof handle !== 'object') throw new TrackerRegistryError('bad-handle', 'handle is required')
  const h = handle as RepoHandle
  const k = h.cwd || h.refId
  if (!k) throw new TrackerRegistryError('bad-handle', 'handle needs cwd or refId')
  return washHandleKey(String(k))
}

/** 缺方法 → uniform unsupported 桩（能力=运行时调用结果；返回不抛）。类型说明：后端标识复用契约 BackendId，日志钩子允许缺省。 */
export function unsupportedStub(opName: string, backendId: BackendId, hooks: Partial<BackendContext> | null | undefined) {
  const stub = async function unsupportedOp() {
    try { if (hooks && hooks.isEnabled && hooks.isEnabled('debug') && hooks.logEvent) hooks.logEvent('debug', 'registry.stub', { op: String(opName || ''), backendId: String(backendId || '') }) } catch (eL) {}
    // 第三段原文给空串：这里是「本后端没有这个能力」的能力缺口，不是谁出了错，
    // 上游没有任何原文可取。空串也必须显式传 —— 形状到位了，门禁才断言得了「每个失败都带原文字段」。
    return fail(ERROR_KIND.UNSUPPORTED, `backend ${backendId} does not implement op ${opName}`, '')
  }
  Object.defineProperty(stub, 'name', { value: `${opName}:unsupported`, configurable: true })
  return stub
}

/**
 * 把 BackendModule.create 产物包成 Tracker：
 *  - id 固定为模块 id（自报不一致 = 说谎 → 拒绝）；
 *  - `OPERATIONS`（23 条操作，规格 1439 起含读预算）里缺的方法 → unsupported 桩；
 *  - 其余未知属性原样透传（今天已不允许后端有独有对外方法，透传只为不改变既有行为；
 *    真出现独有方法应在契约评审里被拦下，不靠这一层拦）。
 */
export function wrapTracker(mod: BackendModule, impl: RoomOperations | null | undefined, hooks: Partial<BackendContext> | null | undefined): Tracker {
  if (!impl || typeof impl !== 'object') {
    throw new TrackerRegistryError('shape', `create(${mod.id}) must return an object (got ${typeof impl})`)
  }
  if (impl.id !== undefined && impl.id !== mod.id) {
    throw new TrackerRegistryError('shape', `create(${mod.id}) returned inconsistent id '${impl.id}'`)
  }
  const target = Object.assign({}, impl)
  // 类型说明：代理在运行时补齐缺的操作，类型上断言为完整 Tracker，运行时形状不变。
  return new Proxy(target, {
    get(t, prop, receiver) {
      const v = Reflect.get(t, prop, receiver)
      if (v !== undefined) return v
      if (typeof prop === 'string' && prop === 'id') return mod.id
      if (typeof prop === 'string' && OPERATIONS.includes(prop)) return unsupportedStub(prop, mod.id, hooks)
      return undefined
    },
  }) as unknown as Tracker
}

/**
 * 预算声明的形状问题（纯函数，不碰注册表，调用方把理由原样展示，不再转述）。
 * 回空数组表示形状成立；否则每一条点名缺的是哪一格。
 * 为什么住在这里而不是契约层：它是运行时实现（函数），契约目录只许有类型与数据；
 * 而它唯一的使用者就是下面这一个校验，所以跟着使用者走，不再单独占一份文件。
 * 口径类型本身（BackendBudgetModel）住在契约层，这里只引用类型与名字表。
 */
function describeBudgetProblems(budget: unknown): string[] {
  if (!budget || typeof budget !== 'object') return ['budget 必须是一个对象（后端模块缺预算声明）']
  const b = budget as Partial<Record<keyof BackendBudgetModel, unknown>>
  const problems: string[] = []
  if (typeof b.kind !== 'string' || (BUDGET_KINDS as readonly string[]).indexOf(b.kind) < 0) {
    problems.push("budget.kind 非法（只能是 'two-buckets' / 'requests-only' / 'off-network' / 'unknown' 四者之一）")
  }
  if (typeof b.countsRequests !== 'boolean') problems.push('budget.countsRequests 缺布尔值（请求数进不进账，必须明说）')
  if (typeof b.countsPoints !== 'boolean') problems.push('budget.countsPoints 缺布尔值（点数进不进账，必须明说）')
  if (typeof b.independentBuckets !== 'boolean') problems.push('budget.independentBuckets 缺布尔值（两种限额通不相通，必须明说）')
  return problems
}

/** 模块形状校验（原 createRegistry 内闭包，纯函数无闭包依赖，V1 #461 原样上提）。类型说明：收未知输入做断言式校验，通过后调用方拿到契约 BackendModule。 */
export function validateMod(mod: unknown): asserts mod is BackendModule {
  if (!mod || typeof mod !== 'object') throw new TrackerRegistryError('shape', 'BackendModule must be an object')
  // 类型说明：上面只排除非对象，这里断言为契约形状再逐项校验，运行时读的还是同一份对象。
  const m = mod as BackendModule
  if (typeof m.id !== 'string' || !m.id) throw new TrackerRegistryError('shape', 'id must be a non-empty string')
  if (typeof m.label !== 'string') throw new TrackerRegistryError('shape', 'label must be a string')
  if (typeof m.create !== 'function') throw new TrackerRegistryError('shape', 'create must be a function')
  if (typeof m.matches !== 'function') throw new TrackerRegistryError('shape', 'matches must be a function')
  // 规格 1439 起预算必填：没有口径，会话管线无从解释读数。理由点名缺的是哪一格，
  // 调用方照原文展示，不再转述（缺声明与形状不对都是同一道口，同一套说法）。
  const budgetProblems = describeBudgetProblems((m as { budget?: unknown }).budget)
  if (budgetProblems.length > 0) {
    throw new TrackerRegistryError('shape', `BackendModule '${m.id}' budget invalid: ${budgetProblems.join('；')}`)
  }
  if (m.id === 'other') {
    throw new TrackerRegistryError('other-not-registrable', "'other' 已弃用：无后端请用 Selection.backendId:null（不造后端，不造假身份）")
  }
}
