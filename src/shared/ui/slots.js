/**
 * shared/ui/slots.js — 内部 UI 槽位架构声明（ADR #221 §5.1/§8）。
 *
 * 生效日期：2026-08-28
 * 效力规则：本文件以 #221 定版五端口 + 本票 #308 modal-seat 落地为基线；与更早方案冲突以本规约为准；
 *           未来任何定版方案若改动本规约，以未来版本为准（见 CONTEXT.md「版本与效力」）。
 *
 * 五端口正交划分：生命周期×作用域（root×常驻、session-maybe×常驻、session×常驻、root×瞬时独占、root×瞬时非独占）。
 * 官方父槽复用 3 个已占据槽位，不自创顶级 root 子（壳层只消费不发明）。
 *
 * 本模块为纯声明 + 纯函数：无 IO、零 import（防 D7 vm.Script 阻塞），可被 host/client/test 三端共用。
 * client 端经 SHARED_SPLICE 拼回闭包（去行首 export），host 端直接 import()，行为同构。
 */

export const SLOTS_VERSION = 1

// 五端口定义（ADR 5.1 视觉锚定表一行一对象）
export const SLOT_DEFS = Object.freeze([
  Object.freeze({ id: 'banner-seat', label: 'banner-seat', visual: '主区顶部 42px 满宽横幅，同槽互斥（蓝/黄/红）', parentSlot: 'shell.overlay', scope: 'root', kind: 'list', order: 10, zGroup: 'banner' }),
  Object.freeze({ id: 'dock-seat', label: 'dock-seat', visual: '右栏 details 内的 Tab 栏（非整列外壳）', parentSlot: 'details', scope: 'session-maybe', kind: 'list', order: 20, zGroup: 'dock' }),
  Object.freeze({ id: 'statusbar-seat', label: 'statusbar-seat', visual: '输入区胶囊区（输入框正上方药丸横排）', parentSlot: 'conversation.input.dock', scope: 'session', kind: 'list', order: 30, zGroup: 'statusbar' }),
  Object.freeze({ id: 'modal-seat', label: 'modal-seat', visual: '主区居中遮罩弹窗', parentSlot: 'shell.overlay', scope: 'root', kind: 'single', order: 100, zGroup: 'modal' }),
  Object.freeze({ id: 'toast-seat', label: 'toast-seat', visual: '右下角轻提示队列', parentSlot: 'shell.overlay', scope: 'root', kind: 'list', order: 90, zGroup: 'toast' }),
])

// 快查表 id → def
export const SLOT_BY_ID = Object.freeze((function () {
  const m = {}
  for (let i = 0; i < SLOT_DEFS.length; i++) { const d = SLOT_DEFS[i]; m[d.id] = d }
  return m
})())

// 单座常量（便于按名引用，避免字面量漂移）
export const BANNER_SEAT = 'banner-seat'
export const DOCK_SEAT = 'dock-seat'
export const STATUSBAR_SEAT = 'statusbar-seat'
export const MODAL_SEAT = 'modal-seat'
export const TOAST_SEAT = 'toast-seat'

// 官方父槽归属（host/壳层已占据 3 父槽，不发明新 root）
export const PARENT_SLOTS = Object.freeze(['shell.overlay', 'details', 'conversation.input.dock'])

// z 序分组（同父槽 3 端口竞争缓解：modal > toast > banner）
export const Z_ORDER = Object.freeze({ modal: 300, toast: 200, banner: 100 })

// scope/kind 枚举（治理：越权不渲染）
export const SLOT_SCOPE = Object.freeze({ ROOT: 'root', SESSION_MAYBE: 'session-maybe', SESSION: 'session' })
export const SLOT_KIND = Object.freeze({ LIST: 'list', SINGLE: 'single' })

// 挂接规则（ADR 5.4 + 2026-08-28 wizard 扩展）：modal 仅 fail+(form|wizard)
export function shouldShowInModal(step) {
  if (!step || typeof step !== 'object') return false
  if (step.status !== 'fail') return false
  const acts = step.actions
  if (!Array.isArray(acts) || !acts.length) return false
  for (let i = 0; i < acts.length; i++) { const a = acts[i]; if (a && (a.type === 'form' || a.type === 'wizard')) return true }
  return false
}

export function isModalAction(action, stepStatus) {
  if (!action || (action.type !== 'form' && action.type !== 'wizard')) return false
  if (stepStatus !== 'fail') return false
  return true
}

// 工具：取 step 的 form 动作（首个）
export function getFormAction(step) {
  if (!step || !Array.isArray(step.actions)) return null
  for (let i = 0; i < step.actions.length; i++) { const a = step.actions[i]; if (a && a.type === 'form') return a }
  return null
}

// 工具：取 step 的 wizard 动作（首个，2026-08-28）
export function getWizardAction(step) {
  if (!step || !Array.isArray(step.actions)) return null
  for (let i = 0; i < step.actions.length; i++) { const a = step.actions[i]; if (a && a.type === 'wizard') return a }
  return null
}

export function getModalAction(step) {
  return getFormAction(step) || getWizardAction(step)
}

// 工具：取 wizard 的 steps（归一化，每步至少含 schema）
export function getWizardSteps(wizardAction) {
  if (!wizardAction || wizardAction.type !== 'wizard') return []
  const raw = wizardAction.steps
  if (!Array.isArray(raw) || !raw.length) return []
  const out = []
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i] || {}
    const schema = Array.isArray(s.schema) ? s.schema : (Array.isArray(s.fields) ? s.fields : [])
    out.push({ title: typeof s.title === 'string' ? s.title : '', schema: schema })
  }
  return out
}
