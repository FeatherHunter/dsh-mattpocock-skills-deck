/**
 * client/kernel/slots.ts — 槽位治理（ADR #221 §5.2 + #308 modal-seat）。
 *
 * 为什么治理要单独一层：五个槽位的顺序与挂载范围一旦写死在各处，新增端口就会各自解释一遍，
 * 越权渲染与顺序打架只能事后排查，所以顺序与范围的判据只住在这里，别处只调 orderOf 与校验入口。
 * 契约：本文件为模块真源（行首 export 形态由构建拼回 index.js 拼接标记处，不许改成 export default）。
 * 本文件由 slots.js 转写而来，只加类型标注，运行行为一字不改。
 * 反例：不要在这里决定某个步骤要不要弹窗（那是 shouldShowInModal 按 fail 加动作类型判），
 * 也不要在这里开放重排顺序（order 忠于官方 lowest wins，内部定死）。
 */
export const SLOTS_KERNEL_VERSION: number = 1;
// 五端口与 shared/ui/slots.js 同源，此处冗余一份零依赖声明，供宿主 vm 预检时无需跨文件解析。
export const SLOT_DEFS_KERNEL: readonly any[] = Object.freeze([
  Object.freeze({ id: 'banner-seat', parentSlot: 'shell.overlay', scope: 'root', kind: 'list', order: 10 }),
  Object.freeze({ id: 'dock-seat', parentSlot: 'details', scope: 'session-maybe', kind: 'list', order: 20 }),
  Object.freeze({ id: 'statusbar-seat', parentSlot: 'conversation.input.dock', scope: 'session', kind: 'list', order: 30 }),
  Object.freeze({ id: 'modal-seat', parentSlot: 'shell.overlay', scope: 'root', kind: 'single', order: 100 }),
  Object.freeze({ id: 'toast-seat', parentSlot: 'shell.overlay', scope: 'root', kind: 'list', order: 90 }),
]);
export const MODAL_SEAT_ID: string = 'modal-seat';
// 治理：priority 转 order 的唯一出口，顺序内部定死不开放重排，未知槽位返回 999 兜底。
export function orderOf(slotId: any): number {
  for (let i: number = 0; i < SLOT_DEFS_KERNEL.length; i++) { if ((SLOT_DEFS_KERNEL[i] as any).id === slotId) return (SLOT_DEFS_KERNEL[i] as any).order }
  return 999
}
// 治理：scope 是否合法，越权一律不渲染，判据只认上面这份声明表。
export function isScopeValid(slotId: any, scope: any): boolean {
  for (let i: number = 0; i < SLOT_DEFS_KERNEL.length; i++) {
    const d: any = SLOT_DEFS_KERNEL[i]
    if (d.id === slotId) return d.scope === scope
  }
  return false
}
// 治理：只有这三个父槽位允许声明子座位，其余一律拒绝，避免座位树被随意挂接。
export function canDeclareIn(parentSlotId: any): boolean {
  return parentSlotId === 'shell.overlay' || parentSlotId === 'details' || parentSlotId === 'conversation.input.dock'
}
// 挂接：modal 只在步骤失败且带有表单或向导动作时才出现，与 shared/ui/slots.js 同判据。
export function shouldShowInModal(step: any): boolean {
  if (!step || typeof step !== 'object') return false
  if (step.status !== 'fail') return false
  const acts: any = step.actions
  if (!Array.isArray(acts) || !acts.length) return false
  for (let i: number = 0; i < acts.length; i++) { const a: any = acts[i]; if (a && (a.type === 'form' || a.type === 'wizard')) return true }
  return false
}
export function isModalAction(action: any, stepStatus: any): boolean {
  if (!action || (action.type !== 'form' && action.type !== 'wizard')) return false
  if (stepStatus !== 'fail') return false
  return true
}
export function getWizardAction(step: any): any {
  if (!step || !Array.isArray(step.actions)) return null
  for (let i: number = 0; i < step.actions.length; i++) { const a: any = step.actions[i]; if (a && a.type === 'wizard') return a }
  return null
}
export function getFormAction(step: any): any {
  if (!step || !Array.isArray(step.actions)) return null
  for (let i: number = 0; i < step.actions.length; i++) { const a: any = step.actions[i]; if (a && a.type === 'form') return a }
  return null
}
export function getModalAction(step: any): any {
  return getFormAction(step) || getWizardAction(step)
}
export function getWizardSteps(wizardAction: any): any[] {
  if (!wizardAction || wizardAction.type !== 'wizard') return []
  const raw: any = wizardAction.steps
  if (!Array.isArray(raw) || !raw.length) return []
  const out: any[] = []
  for (let i: number = 0; i < raw.length; i++) {
    const s: any = raw[i] || {}
    const schema: any = Array.isArray(s.schema) ? s.schema : (Array.isArray(s.fields) ? s.fields : [])
    out.push({ title: typeof s.title === 'string' ? s.title : '', schema: schema })
  }
  return out
}
