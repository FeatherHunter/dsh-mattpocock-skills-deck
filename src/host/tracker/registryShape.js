/**
 * tracker/registryShape.js — 注册形状校验与缺方法包桩（V1 #461 从 registry.js 拆出，纯结构、行为零变化）。
 * 以后谁改它：改后端模块形状校验（id/label/create/matches）或缺方法 unsupported 包桩语义的人。预估约 90 行，超 350 打回。
 * 接线：只被 registryCore.js 引用；本文件不引用其他新文件。
 * 第一性原理（#125 定版，承接原 registry.js）：
 *  - 能力 = 运行时调用结果：注册**只验模块形状**，不因「缺某 op」拒绝；
 *    `create()` 产物按 Proxy 包桩——缺的方法自动补 `unsupported` 桩（准入墙消失，诚实桩不误导）。
 *  - 无能力表、无能力缓存、无能力分支、无运行期内省（G5 红线）。
 *  - `'other'` **弃用、不注册**。
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
export function handleKey(handle) {
  if (!handle || typeof handle !== 'object') throw new TrackerRegistryError('bad-handle', 'handle is required')
  const k = handle.cwd || handle.refId
  if (!k) throw new TrackerRegistryError('bad-handle', 'handle needs cwd or refId')
  return String(k)
}

/** 缺方法 → uniform unsupported 桩（能力=运行时调用结果；返回不抛）。 */
export function unsupportedStub(opName, backendId, hooks) {
  const stub = async function unsupportedOp() {
    try { if (hooks && hooks.isEnabled && hooks.isEnabled('debug') && hooks.logEvent) hooks.logEvent('debug', 'registry.stub', { op: String(opName || ''), backendId: String(backendId || '') }) } catch (eL) {}
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
export function wrapTracker(mod, impl, hooks) {
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
      if (typeof prop === 'string' && OPERATIONS.includes(prop)) return unsupportedStub(prop, mod.id, hooks)
      return undefined
    },
  })
}

/** 模块形状校验（原 createRegistry 内闭包，纯函数无闭包依赖，V1 #461 原样上提）。 */
export function validateMod(mod) {
  if (!mod || typeof mod !== 'object') throw new TrackerRegistryError('shape', 'BackendModule must be an object')
  if (typeof mod.id !== 'string' || !mod.id) throw new TrackerRegistryError('shape', 'id must be a non-empty string')
  if (typeof mod.label !== 'string') throw new TrackerRegistryError('shape', 'label must be a string')
  if (typeof mod.create !== 'function') throw new TrackerRegistryError('shape', 'create must be a function')
  if (typeof mod.matches !== 'function') throw new TrackerRegistryError('shape', 'matches must be a function')
  if (mod.id === 'other') {
    throw new TrackerRegistryError('other-not-registrable', "'other' 已弃用：无后端请用 Selection.backendId:null（不造后端，不造假身份）")
  }
}
