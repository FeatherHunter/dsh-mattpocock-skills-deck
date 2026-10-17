/**
 * shared/ui/slots.ts — 内部 UI 槽位架构声明（ADR #221 §5.1/§8）。
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

// 槽位定义的形状：id 是唯一键（同时是常量名的小写形态），scope 与 kind 只收合法取值，order 决定同父槽下的排列，zGroup 决定遮挡层级。
// scope 与 kind 在这里按字符串收，合法取值见下面的 SLOT_SCOPE 与 SLOT_KIND，越权的值由渲染侧拒收，不在这里抛错。
type SlotDef = { id: string; label: string; visual: string; parentSlot: string; scope: string; kind: string; order: number; zGroup: string }

// 步骤的最小形状：本文件只读 status、actions 两个字段，其余原样透传；缺字段按“没有”处理，不抛错。
// 反例：actions 缺席时当成空数组处理，而不是去读一个默认动作，默认动作会凭空弹出一个弹窗。
type StepLike = { status?: unknown; actions?: StepAction[] }

// 步骤里动作的最小形状：本文件只读 type、steps、schema、fields、title 五个字段。
type StepAction = { type?: unknown; steps?: unknown; schema?: unknown; fields?: unknown; title?: unknown }

// 归一化后 wizard 单步的形状：title 缺了就回空串，schema 缺了就回空数组，调用方拿到就能直接画。
type WizardStepView = { title: string; schema: unknown[] }

export const SLOTS_VERSION: number = 1

// 五端口定义（ADR 5.1 视觉锚定表一行一对象）
export const SLOT_DEFS: ReadonlyArray<SlotDef> = Object.freeze([
  Object.freeze({ id: 'banner-seat', label: 'banner-seat', visual: '主区顶部 42px 满宽横幅，同槽互斥（蓝/黄/红）', parentSlot: 'shell.overlay', scope: 'root', kind: 'list', order: 10, zGroup: 'banner' }),
  Object.freeze({ id: 'dock-seat', label: 'dock-seat', visual: '右栏 details 内的 Tab 栏（非整列外壳）', parentSlot: 'details', scope: 'session-maybe', kind: 'list', order: 20, zGroup: 'dock' }),
  Object.freeze({ id: 'statusbar-seat', label: 'statusbar-seat', visual: '输入区胶囊区（输入框正上方药丸横排）', parentSlot: 'conversation.input.dock', scope: 'session', kind: 'list', order: 30, zGroup: 'statusbar' }),
  Object.freeze({ id: 'modal-seat', label: 'modal-seat', visual: '主区居中遮罩弹窗', parentSlot: 'shell.overlay', scope: 'root', kind: 'single', order: 100, zGroup: 'modal' }),
  Object.freeze({ id: 'toast-seat', label: 'toast-seat', visual: '右下角轻提示队列', parentSlot: 'shell.overlay', scope: 'root', kind: 'list', order: 90, zGroup: 'toast' }),
])

// 快查表 id → def
export const SLOT_BY_ID: Readonly<Record<string, SlotDef>> = Object.freeze((function (): Record<string, SlotDef> {
  const m: Record<string, SlotDef> = {}
  for (let i = 0; i < SLOT_DEFS.length; i++) { const d = SLOT_DEFS[i]; m[d.id] = d }
  return m
})())

// 单座常量（便于按名引用，避免字面量漂移）
export const BANNER_SEAT: string = 'banner-seat'
export const DOCK_SEAT: string = 'dock-seat'
export const STATUSBAR_SEAT: string = 'statusbar-seat'
export const MODAL_SEAT: string = 'modal-seat'
export const TOAST_SEAT: string = 'toast-seat'

// 官方父槽归属（host/壳层已占据 3 父槽，不发明新 root）
export const PARENT_SLOTS: ReadonlyArray<string> = Object.freeze(['shell.overlay', 'details', 'conversation.input.dock'])

// z 序分组（同父槽 3 端口竞争缓解：modal > toast > banner）
export const Z_ORDER: Readonly<{ modal: number; toast: number; banner: number }> = Object.freeze({ modal: 300, toast: 200, banner: 100 })

// scope/kind 枚举（治理：越权不渲染）
export const SLOT_SCOPE: Readonly<{ ROOT: string; SESSION_MAYBE: string; SESSION: string }> = Object.freeze({ ROOT: 'root', SESSION_MAYBE: 'session-maybe', SESSION: 'session' })
export const SLOT_KIND: Readonly<{ LIST: string; SINGLE: string }> = Object.freeze({ LIST: 'list', SINGLE: 'single' })

// 挂接规则（ADR 5.4 + 2026-08-28 wizard 扩展）：modal 仅 fail+(form|wizard)
// 只有失败的步骤才配进弹窗：成功或进行中的步骤配了弹窗，用户会被打断正在看的内容。
// 反例：done 的步骤也返回 true，详情页一点开就弹确认框，用户关都关不掉。
export function shouldShowInModal(step: StepLike | null | undefined): boolean {
  if (!step || typeof step !== 'object') return false
  if (step.status !== 'fail') return false
  const acts = step.actions
  if (!Array.isArray(acts) || !acts.length) return false
  for (let i = 0; i < acts.length; i++) { const a = acts[i]; if (a && (a.type === 'form' || a.type === 'wizard')) return true }
  return false
}

// 动作准入只认两件事：动作本身是 form 或 wizard，当时步骤的状态正好是 fail，两个条件缺一不可。
// 反例：只看动作类型不看步骤状态，进行中的表单也会被提前塞进弹窗，用户填到一半就被盖住。
export function isModalAction(action: StepAction | null | undefined, stepStatus: unknown): boolean {
  if (!action || (action.type !== 'form' && action.type !== 'wizard')) return false
  if (stepStatus !== 'fail') return false
  return true
}

// 工具：取 step 的 form 动作（首个）
export function getFormAction(step: StepLike | null | undefined): StepAction | null {
  if (!step || !Array.isArray(step.actions)) return null
  for (let i = 0; i < step.actions.length; i++) { const a = step.actions[i]; if (a && a.type === 'form') return a }
  return null
}

// 工具：取 step 的 wizard 动作（首个，2026-08-28）
export function getWizardAction(step: StepLike | null | undefined): StepAction | null {
  if (!step || !Array.isArray(step.actions)) return null
  for (let i = 0; i < step.actions.length; i++) { const a = step.actions[i]; if (a && a.type === 'wizard') return a }
  return null
}

// 取弹窗动作只做一件事：form 与 wizard 取首个命中的，form 优先（一个步骤不会同时有两个弹窗入口）。
// 反例：两个都取出来让调用方再选一次，两处各选各的，同一个步骤会弹出两层。
export function getModalAction(step: StepLike | null | undefined): StepAction | null {
  return getFormAction(step) || getWizardAction(step)
}

// 工具：取 wizard 的 steps（归一化，每步至少含 schema）
// 每步至少含 schema：缺 schema 的步归一化成空数组，渲染侧按空表单画，不跳过这一步（跳过会把步骤号画错）。
// 反例：title 缺了去猜一个标题，猜出来的标题与真实步骤对不上，用户会对着错标题填表。
export function getWizardSteps(wizardAction: StepAction | null | undefined): WizardStepView[] {
  if (!wizardAction || wizardAction.type !== 'wizard') return []
  const raw = wizardAction.steps
  if (!Array.isArray(raw) || !raw.length) return []
  const out: WizardStepView[] = []
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i] || {}
    const schema = Array.isArray(s.schema) ? s.schema : (Array.isArray(s.fields) ? s.fields : [])
    out.push({ title: typeof s.title === 'string' ? s.title : '', schema: schema })
  }
  return out
}
