/**
 * client/kernel/slots.js — 槽位治理（ADR #221 §5.2 + 本票 #308 modal-seat）。
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的拼接标记处（apply 闭包内原位）。
 * 零 import 语法（防 D7 vm.Script 阻塞），与 actions.js 内联 ACTION_TYPE 同例。
 *
 * 本模块为「治理层」：priority→order、scope 校验、父槽 children 声明等。
 * 形态 C：Service 包一层（内核走 ctx.slots children，外观收敛校验/幂等/回收），不经 ctx.get 对外发布。
 * 存量 4 槽历史不迁，仅新增 5 端口走此规范（ADR 5.2 存量保留）。
 */

    export const SLOTS_KERNEL_VERSION = 1

    // 五端口与 shared/ui/slots.js 同源（此处冗余一份零依赖声明，供宿主 vm 预检无需跨文件解析）
    export const SLOT_DEFS_KERNEL = Object.freeze([
      Object.freeze({ id: 'banner-seat', parentSlot: 'shell.overlay', scope: 'root', kind: 'list', order: 10 }),
      Object.freeze({ id: 'dock-seat', parentSlot: 'details', scope: 'session-maybe', kind: 'list', order: 20 }),
      Object.freeze({ id: 'statusbar-seat', parentSlot: 'conversation.input.dock', scope: 'session', kind: 'list', order: 30 }),
      Object.freeze({ id: 'modal-seat', parentSlot: 'shell.overlay', scope: 'root', kind: 'single', order: 100 }),
      Object.freeze({ id: 'toast-seat', parentSlot: 'shell.overlay', scope: 'root', kind: 'list', order: 90 }),
    ])

    export const MODAL_SEAT_ID = 'modal-seat'

    // 治理：priority→order（内部定死 10/20/30/100/90，忠于官方 lowest wins，不开放重排）
    export function orderOf(slotId) {
      for (let i = 0; i < SLOT_DEFS_KERNEL.length; i++) { if (SLOT_DEFS_KERNEL[i].id === slotId) return SLOT_DEFS_KERNEL[i].order }
      return 999
    }

    // 治理：scope 固化（越权不渲染）
    export function isScopeValid(slotId, scope) {
      for (let i = 0; i < SLOT_DEFS_KERNEL.length; i++) {
        const d = SLOT_DEFS_KERNEL[i]
        if (d.id === slotId) return d.scope === scope
      }
      return false
    }

    // 治理：校验是否可在当前上下文声明（children 才能声明子座位）
    export function canDeclareIn(parentSlotId) {
      return parentSlotId === 'shell.overlay' || parentSlotId === 'details' || parentSlotId === 'conversation.input.dock'
    }

    // 挂接：modal 仅 fail+(form|wizard)（与 shared/ui/slots.js shouldShowInModal 同判据，零依赖冗余；2026-08-28 wizard 扩展）
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

    export function getWizardAction(step) {
      if (!step || !Array.isArray(step.actions)) return null
      for (let i = 0; i < step.actions.length; i++) { const a = step.actions[i]; if (a && a.type === 'wizard') return a }
      return null
    }

    export function getFormAction(step) {
      if (!step || !Array.isArray(step.actions)) return null
      for (let i = 0; i < step.actions.length; i++) { const a = step.actions[i]; if (a && a.type === 'form') return a }
      return null
    }

    export function getModalAction(step) {
      return getFormAction(step) || getWizardAction(step)
    }

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