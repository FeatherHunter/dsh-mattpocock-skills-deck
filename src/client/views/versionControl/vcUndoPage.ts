/**
 * src/client/views/versionControl/vcUndoPage.ts —— 变基待办页的历史改写五条动作面板（#1748 T13）
 *
 * 这一页只画一件事：把「要执行哪条历史改写动作」写成一份用户读得完的确认卡。
 * 五条动作里硬重置是唯一的「毁」级动作，所以预检回包里的恢复点（会丢多少文件与行、
 * 怎么找回旧提交）必须画在确认卡里，用户点确认之前能看见「丢了怎么办」。
 *
 * 约定（改了会坏的地方）：
 *   1) 页面文字一律走 config/copy/vcundo.yaml 的 vc.undo.* 词表，源码里不写中文字面量；
 *      只有能力账本里的名称与命令原文按数据画（那是账本原话，不是界面自己编的词）。
 *   2) 动作用什么命令、属于哪一页一律由 vcUndoOps.ts 从账本读，本文件不抄第二份。
 *   3) 确认卡上的按钮只有一组：预检成功后出现「取消 / 确认执行」，在途时一律禁用；
 *      不画第二组同作用按钮，免得用户不知道哪颗才算数。
 *   4) 失败要诚实：宿主回什么 reason 就照它查词表，查不到就显示通用一句并附原文，
 *      不把「读不全/没做成」说成「没有变化」。
 */

declare const vcUndoCatalogOf: any
declare const vcUndoEntryOf: any
declare const vcUndoSetInputOf: any
declare const vcUndoPickOpOf: any
declare const vcUndoCheckArgsOf: any
declare const vcUndoWriteArgsOf: any
declare const vcUndoApplyCheck: any
declare const vcUndoApplyWrite: any
declare const vcUndoMark: any
declare const vcUndoStateNew: any
declare const vcUndoBusyOf: any
declare const vcUndoRecoveryStepsOf: any
declare const vcUndoShortOidOf: any
declare const vcUndoWhenOf: any
declare const vcUndoRequestIdOf: any
declare const vcUndoFailKnownOf: any
declare const VC_UNDO_PHONE_CHECK: any
declare const VC_UNDO_PHONE_WRITE: any
declare const vcPageSectionNode: any
declare const React: any
declare const host: any

export const VC_UNDO_PAGE_SOURCE: string = 'src/client/views/versionControl/vcUndoPage.ts'

/** 查词表：传了变量就带上（t 的第二个参数形状与其它页面一致）。 */
function undoText(t: any, key: string, vars: any): any {
  return vars ? t(key, vars) : t(key)
}

/** 当前动作的目录项；输入里的动作名认不出来时回第一条，只为不让整页塌掉（正常流程进不来）。 */
function undoEntryOf(state: any): any {
  const inputs: any = state && state.inputs ? state.inputs : null
  const entry: any = inputs ? vcUndoEntryOf(String(inputs.op || '')) : null
  if (entry) return entry
  const all: any[] = vcUndoCatalogOf()
  return all.length > 0 ? all[0] : null
}

/** 一行动作选择：名称取词表、命令与页面归属取账本；危险动作与主入口各带一枚标记。 */
function undoOpRowNode(h: any, t: any, entry: any, state: any, ctx: any): any {
  const inputs: any = state.inputs || {}
  const picked: boolean = String(inputs.op || '') === String(entry.kind)
  const kids: any[] = [
    h('input', {
      type: 'radio', name: 'vc-undo-op', className: 'vcs-undo-pick',
      'data-vc-undo-op-pick': String(entry.kind),
      checked: picked, defaultChecked: picked,
      onChange: ctx.pick ? function (): any { ctx.pick(String(entry.kind)) } : undefined,
    }),
    h('span', { className: 'vcs-undo-op-name' }, undoText(t, String(entry.nameKey), null)),
    h('code', { className: 'vcs-undo-op-command', 'data-vc-undo-command': String(entry.command) }, String(entry.command)),
  ]
  if (entry.danger) kids.push(h('span', { className: 'vcs-undo-danger-badge', 'data-vc-undo-danger-badge': '1' }, undoText(t, 'vc.undo.dangerBadge', null)))
  if (String(entry.primaryEntry || '') !== '') {
    kids.push(h('span', { className: 'vcs-undo-primary', 'data-vc-undo-primary-entry': String(entry.primaryEntry) }, undoText(t, 'vc.undo.primaryBadge', { entry: String(entry.primaryEntry) })))
  }
  return h('label', {
    key: 'undo-op-' + String(entry.kind),
    className: 'vcs-undo-op' + (picked ? ' is-picked' : ''),
    'data-vc-undo-op-row': String(entry.kind),
    'data-vc-undo-cap': String(entry.capId),
    'data-vc-undo-danger': entry.danger ? '1' : '0',
    'data-vc-undo-recovery-cap': entry.recovery ? '1' : '0',
    'data-vc-undo-on-this-page': entry.onThisPage ? '1' : '0',
  }, kids)
}

/** 输入区：只画当前动作真正用得到的字段，每个字段带一行说明（写清允许什么、不允许什么）。 */
function undoFieldsNode(h: any, t: any, entry: any, state: any, ctx: any): any {
  const inputs: any = state.inputs || {}
  const fields: any[] = []
  const inputOf = function (field: string, hintKey: string, opts?: any): any {
    const id: string = 'vcu-' + String(entry.kind) + '-' + field
    const value: string = String(inputs[field] === undefined || inputs[field] === null ? '' : inputs[field])
    const shared: any = { id: id, className: 'vcs-undo-input', 'data-vc-undo-input': field, 'data-vc-undo-field-for': String(entry.kind) }
    if (ctx.input) { shared.value = value; shared.onInput = function (ev: any): any { ctx.input(field, ev && ev.target ? ev.target.value : '') } } else { shared.defaultValue = value }
    if (field === 'commits') { shared.rows = 3; shared.placeholder = undoText(t, 'vc.undo.commitsHint', null) }
    if (field === 'message') shared.placeholder = undoText(t, 'vc.undo.messageHint', null)
    if (field === 'target') shared.placeholder = undoText(t, 'vc.undo.targetHint', null)
    fields.push(h('div', { className: 'vcs-undo-field', 'data-vc-undo-field': field }, [
      h('label', { htmlFor: id }, undoText(t, 'vc.undo.field.' + field, null)),
      h('input', shared),
      h('p', { className: 'vcs-undo-hint', 'data-vc-undo-hint': field }, undoText(t, hintKey, null)),
    ]))
  }
  if (entry.needsTarget) inputOf('target', 'vc.undo.targetHint')
  if (entry.needsMessage) inputOf('message', 'vc.undo.messageHint')
  if (entry.needsCommits) inputOf('commits', 'vc.undo.commitsHint')
  return h('div', { className: 'vcs-undo-fields', 'data-vc-undo-fields': String(entry.kind) }, fields)
}

/** 恢复点块（硬重置专用）：会丢什么、旧提交在哪、怎么找回，逐条画清楚。 */
function undoRecoveryNode(h: any, t: any, recovery: any, prefix: string): any {
  const discard: any = (recovery && recovery.discard) || {}
  const steps: string[] = vcUndoRecoveryStepsOf(recovery)
  const kids: any[] = [
    h('h5', { className: 'vcs-undo-recovery-title' }, undoText(t, 'vc.undo.recovery.title', null)),
    h('p', { className: 'vcs-undo-recovery-discard', 'data-vc-undo-recovery-discard': '1', 'data-vc-undo-recovery-files': String(discard.files || 0), 'data-vc-undo-recovery-added': String(discard.added || 0), 'data-vc-undo-recovery-deleted': String(discard.deleted || 0) },
      undoText(t, 'vc.undo.recovery.discard', { files: String(discard.files || 0), added: String(discard.added || 0), deleted: String(discard.deleted || 0) })),
  ]
  if (Number(discard.binary || 0) > 0) {
    kids.push(h('p', { className: 'vcs-undo-recovery-binary', 'data-vc-undo-recovery-binary': '1' }, undoText(t, 'vc.undo.recovery.binary', { n: String(discard.binary) })))
  }
  kids.push(h('p', { className: 'vcs-undo-recovery-commits', 'data-vc-undo-recovery-commits': String(recovery && recovery.commits !== undefined ? recovery.commits : 0) }, undoText(t, 'vc.undo.recovery.commits', { n: String(recovery && recovery.commits !== undefined ? recovery.commits : 0) })))
  const items: any[] = []
  for (let i = 0; i < steps.length; i += 1) items.push(h('li', { key: 'undo-step-' + String(i), 'data-vc-undo-recovery-step': String(i) }, h('code', {}, steps[i])))
  if (items.length > 0) {
    kids.push(h('p', { className: 'vcs-undo-recovery-restore-title', 'data-vc-undo-recovery-restore': '1' }, undoText(t, 'vc.undo.recovery.restoreTitle', null)))
    kids.push(h('ul', { className: 'vcs-undo-recovery-steps' }, items))
  }
  kids.push(h('p', { className: 'vcs-undo-recovery-keep' }, undoText(t, 'vc.undo.recovery.keep', null)))
  return h('div', { className: 'vcs-undo-recovery', 'data-vc-undo-recovery': prefix }, kids)
}

/** 确认卡：会做什么 / 不会动什么 / 能不能找回 / 确认动词，四段各自带标记，危险动作另有醒目提示。 */
function undoConfirmNode(h: any, t: any, state: any, entry: any, ctx: any): any {
  const check: any = state.check
  const plan: any = check.plan || {}
  const scene: any = check.scene || {}
  const shortTarget: string = String(plan.targetOid || '') !== '' ? String(vcUndoShortOidOf(plan.targetOid)) : String(plan.target || '')
  const name: string = undoText(t, String(entry.nameKey), null)
  const kids: any[] = [
    h('h4', { className: 'vcs-undo-confirm-title' }, undoText(t, 'vc.undo.confirm.title', { name: name })),
    h('p', { className: 'vcs-undo-confirm-seg', 'data-vc-undo-seg': 'what' }, undoText(t, 'vc.undo.confirm.what', { name: name, target: shortTarget, steps: String(Number(check.stepCount) || (check.steps ? check.steps.length : 0)) })),
    h('p', { className: 'vcs-undo-confirm-seg', 'data-vc-undo-seg': 'wont' }, undoText(t, 'vc.undo.confirm.wont', { head: String(vcUndoShortOidOf(scene.head || '')) })),
    h('p', { className: 'vcs-undo-confirm-seg', 'data-vc-undo-seg': 'reversible' }, entry.danger
      ? undoText(t, 'vc.undo.confirm.reversibleDanger', { reflog: String((check.recovery && check.recovery.restore && check.recovery.restore.reflogBefore) || '') })
      : undoText(t, 'vc.undo.confirm.reversible', null)),
    h('p', { className: 'vcs-undo-confirm-seg', 'data-vc-undo-seg': 'verb' }, undoText(t, 'vc.undo.confirm.verb', { name: name })),
  ]
  if (entry.danger) kids.push(h('p', { className: 'vcs-undo-danger-warning', 'data-vc-undo-danger-warning': '1' }, undoText(t, 'vc.undo.confirm.danger', null)))
  if (check.recovery) kids.push(undoRecoveryNode(h, t, check.recovery, '1'))
  if (String(plan.message || '') !== '') kids.push(h('p', { className: 'vcs-undo-confirm-message', 'data-vc-undo-confirm-message': '1' }, h('code', {}, String(plan.message))))
  if (plan.commits && plan.commits.length > 0) {
    const rows: any[] = []
    for (let i = 0; i < plan.commits.length; i += 1) rows.push(h('li', { key: 'undo-commit-' + String(i), 'data-vc-undo-confirm-commit': String(i) }, h('code', {}, String(vcUndoShortOidOf(plan.commits[i].oid || '') || plan.commits[i].rev || ''))))
    kids.push(h('ol', { className: 'vcs-undo-confirm-commits' }, rows))
  }
  const busy: boolean = vcUndoBusyOf(state)
  kids.push(h('div', { className: 'vcs-undo-confirm-actions' }, [
    h('button', { type: 'button', className: 'vcs-undo-cancel', 'data-vc-undo-cancel': '1', 'data-press': 'button', 'data-log': 'vc.undo.confirm.cancel', 'data-focus-default': 'cancel', disabled: busy, onClick: ctx.cancel ? function (): any { ctx.cancel() } : undefined }, undoText(t, 'vc.undo.confirm.cancel', null)),
    h('button', { type: 'button', className: 'vcs-undo-go', 'data-vc-undo-go': '1', 'data-press': 'button', 'data-log': 'vc.undo.confirm.go', disabled: busy, onClick: ctx.go ? function (): any { ctx.go() } : undefined }, undoText(t, 'vc.undo.confirm.go', null)),
  ]))
  return h('div', { className: 'vcs-undo-confirm', 'data-vc-undo-confirm': '1', role: 'dialog', 'aria-modal': 'false', 'data-vc-undo-ticket': String((check.ticket && check.ticket.id) || '') }, kids)
}

/** 结果块：从哪条到哪条、跑了几步、危险动作再附一遍恢复路径（免得用户关掉页面就找不回）。 */
function undoResultNode(h: any, t: any, result: any): any {
  const before: any = result.before || {}
  const after: any = result.after || {}
  const kids: any[] = [
    h('h4', { className: 'vcs-undo-result-title' }, undoText(t, 'vc.undo.result.title', null)),
    h('p', { className: 'vcs-undo-result-head', 'data-vc-undo-head-before': String(vcUndoShortOidOf(before.headOid || '')), 'data-vc-undo-head-after': String(vcUndoShortOidOf(after.headOid || '')) },
      undoText(t, 'vc.undo.result.before', { short: String(vcUndoShortOidOf(before.headOid || '')) }) + ' → ' + undoText(t, 'vc.undo.result.after', { short: String(vcUndoShortOidOf(after.headOid || '')) })),
    h('p', { className: 'vcs-undo-result-steps', 'data-vc-undo-steps-done': String(result.stepsDone) }, undoText(t, 'vc.undo.result.steps', { n: String(result.stepsDone) })),
  ]
  if (result.recovery) {
    kids.push(h('p', { className: 'vcs-undo-result-recovery-note', 'data-vc-undo-result-recovery-note': '1' }, undoText(t, 'vc.undo.result.recoveryNote', null)))
    kids.push(undoRecoveryNode(h, t, result.recovery, 'result'))
  }
  if (String(vcUndoWhenOf(result.atMs) || '') !== '') kids.push(h('p', { className: 'vcs-undo-result-when', 'data-vc-undo-at': String(result.atMs) }, String(vcUndoWhenOf(result.atMs))))
  return h('div', { className: 'vcs-undo-result', 'data-vc-undo-result': 'ok', role: 'status' }, kids)
}

/** 状态区：空闲一句、在途一句、失败照 reason 查词表（查不到给通用一句加原文）、完成画结果。 */
function undoStateNode(h: any, t: any, state: any, ctx: any): any {
  const phase: string = String(state.phase || 'idle')
  // 执行完成的结果条按「确认执行」那一段的位置画（见 vcUndoPageNode），这里返回 null，
  // 免得同一个结果在页面上出现两次、读的人还得判断哪一份才算数。
  if (phase === 'done' && state.result) return null
  const kids: any[] = []
  if (phase === 'checking' || phase === 'writing') {
    kids.push(h('p', { className: 'vcs-undo-running', 'data-vc-undo-running': '1' }, undoText(t, phase === 'checking' ? 'vc.undo.checking' : 'vc.undo.writing', null)))
  } else if (phase === 'failed') {
    const error: any = state.error || {}
    const key: string = String(error.key || 'git')
    const known: boolean = vcUndoFailKnownOf(key)
    kids.push(h('p', { className: 'vcs-undo-error', 'data-vc-undo-error': key, 'data-vc-undo-error-field': String(error.field || '') }, known ? undoText(t, 'vc.undo.fail.' + key, null) : undoText(t, 'vc.undo.failedDetail', null)))
    if (String(error.detail || '') !== '') kids.push(h('p', { className: 'vcs-undo-error-detail', 'data-vc-undo-error-detail': '1' }, String(error.detail)))
    kids.push(h('button', { type: 'button', className: 'vcs-undo-retry', 'data-vc-undo-retry': '1', 'data-press': 'button', 'data-log': 'vc.undo.retry', disabled: vcUndoBusyOf(state), onClick: ctx.retry ? function (): any { ctx.retry() } : undefined }, undoText(t, 'vc.undo.retry', null)))
  } else {
    kids.push(h('p', { className: 'vcs-undo-idle', 'data-vc-undo-idle': '1' }, undoText(t, 'vc.undo.idle', null)))
  }
  return h('div', { className: 'vcs-undo-status', 'data-vc-undo-state': phase }, kids)
}

/**
 * 画整页。opts 收 {state, onInput, onPick, onCheck, onCancel, onGo, onRetry}：
 * 门禁静态渲染只读 state；真实组件把那几个回调接上就成了可操作的页面。
 */
export function vcUndoPageNode(h: any, t: any, opts: any): any {
  const o: any = opts || {}
  const state: any = o.state || Object.assign(vcUndoStateNew(), o.seed || {})
  const entry: any = undoEntryOf(state)
  if (!entry) return null
  const ctx: any = {
    input: typeof o.onInput === 'function' ? o.onInput : null,
    pick: typeof o.onPick === 'function' ? o.onPick : null,
    check: o.onCheck,
    cancel: o.onCancel,
    go: o.onGo,
    retry: typeof o.onRetry === 'function' ? o.onRetry : o.onCheck,
  }
  const busy: boolean = vcUndoBusyOf(state)
  const phase: string = String(state.phase || 'idle')
  // 五条动作的组织按定稿原型的「选动作 → 看影响 → 确认执行」三段走：第一段只选一条动作，
  // 第二段只画这条动作要填的字段与预检（只读，不改仓库），第三段才是确认卡与执行结果。
  // 三段分开画的理由：危险动作的第一下不该落在确认键上，段与段之间给读者一个停一下的位置。
  const pickKids: any[] = [
    h('p', { className: 'vcs-undo-note' }, undoText(t, 'vc.undo.note', null)),
    h('p', { className: 'vcs-undo-ops-note' }, undoText(t, 'vc.undo.opsNote', null)),
    h('div', { className: 'vcs-undo-ops', role: 'radiogroup', 'aria-label': undoText(t, 'vc.undo.field.op', null) }, vcUndoCatalogOf().map(function (one: any): any { return undoOpRowNode(h, t, one, state, ctx) })),
  ]
  const impactKids: any[] = [
    undoFieldsNode(h, t, entry, state, ctx),
    h('div', { className: 'vcs-undo-actions' }, [
      h('button', { type: 'button', className: 'vcs-undo-check', 'data-vc-undo-check': '1', 'data-press': 'button', 'data-log': 'vc.undo.check', disabled: busy, onClick: typeof ctx.check === 'function' ? function (): any { ctx.check() } : undefined }, busy ? undoText(t, 'vc.undo.checking', null) : undoText(t, 'vc.undo.check', null)),
    ]),
  ]
  const preStatus: any = undoStateNode(h, t, state, ctx)
  if (preStatus) impactKids.push(preStatus)
  const confirmKids: any[] = []
  if (state.check) confirmKids.push(undoConfirmNode(h, t, state, entry, ctx))
  else confirmKids.push(h('p', { className: 'vcs-undo-confirm-hint', 'data-vc-undo-confirm-hint': '1' }, undoText(t, 'vc.undo.section.confirmIdle', null)))
  if (phase === 'done' && state.result) confirmKids.push(h('div', { className: 'vcs-undo-done', 'data-vc-undo-state': 'done' }, undoResultNode(h, t, state.result)))
  const kids: any[] = [
    vcPageSectionNode(h, t, { title: 'vc.undo.section.pick', count: String(vcUndoCatalogOf().length), note: 'vc.undo.section.pickNote', children: pickKids }),
    vcPageSectionNode(h, t, { title: 'vc.undo.section.impact', note: 'vc.undo.section.impactNote', children: impactKids }),
    vcPageSectionNode(h, t, { title: 'vc.undo.section.confirm', note: 'vc.undo.section.confirmNote', danger: entry.danger === true, children: confirmKids }),
  ]
  return h('section', {
    className: 'vcs-undo-page',
    id: 'vc-undo-page',
    'data-vc-undo-page': '1',
    'data-vc-undo-count': String(vcUndoCatalogOf().length),
    'data-vc-undo-op': String(entry.kind),
    'data-vc-undo-cap': String(entry.capId),
    'data-vc-undo-phase': String(state.phase || 'idle'),
    'data-vc-undo-pending': busy ? '1' : '0',
    'data-vc-undo-danger': entry.danger ? '1' : '0',
  }, kids)
}

/**
 * 真实组件：自带状态，预检成功后画确认卡，用户点确认才执行。
 * seed 给门禁与后续接线预置状态（{state, cwd}）；call 走全局 host.call，与本页其它能力同一条口子。
 */
export function VC_UNDO_PANEL(props: any): any {
  const seed: any = props || {}
  const [state, setState] = React.useState(function (): any { return Object.assign(vcUndoStateNew(), seed.state || {}) })
  const ref: any = React.useRef(state)
  ref.current = state
  const callOf = function (method: string, args: any): Promise<any> {
    if (typeof host === 'undefined' || !host || typeof host.call !== 'function') return Promise.resolve({ ok: false, error: { kind: 'env', message: '宿主电话口不可用' } })
    try { return Promise.resolve(host.call(method, args)) } catch (e) { return Promise.resolve({ ok: false, error: { kind: 'throw', message: String((e && (e as any).message) || e) } }) }
  }
  const input = function (field: string, value: any): void {
    setState(function (cur: any): any { return Object.assign({}, cur, { inputs: vcUndoSetInputOf(cur.inputs, field, value) }) })
  }
  const pick = function (kind: string): void {
    setState(function (cur: any): any { return Object.assign({}, cur, { inputs: vcUndoPickOpOf(cur.inputs, kind) }) })
  }
  const check = function (): void {
    const cur: any = ref.current
    const built: any = vcUndoCheckArgsOf(cur.inputs, String(seed.cwd || ''))
    if (built.ok !== true) {
      const marked: any = vcUndoMark(cur, 'failed')
      setState(Object.assign({}, marked, { error: { key: String(built.reason), reason: String(built.reason), detail: '', field: String(built.field || '') } }))
      return
    }
    const marked: any = vcUndoMark(cur, 'checking')
    setState(marked)
    callOf(String(VC_UNDO_PHONE_CHECK), built.args).then(function (reply: any): any {
      setState(function (s: any): any { return vcUndoApplyCheck(s, marked.seq, reply) })
    })
  }
  const cancel = function (): void {
    setState(function (cur: any): any { return Object.assign({}, cur, { phase: 'idle', check: null, error: null }) })
  }
  const go = function (): void {
    const cur: any = ref.current
    if (!cur.check || !cur.check.ticket) return
    const requestId: string = vcUndoRequestIdOf()
    const built: any = vcUndoWriteArgsOf(cur.inputs, String(seed.cwd || ''), String(cur.check.ticket.id), requestId)
    if (built.ok !== true) {
      const marked: any = vcUndoMark(cur, 'failed')
      setState(Object.assign({}, marked, { error: { key: String(built.reason), reason: String(built.reason), detail: '', field: String(built.field || '') } }))
      return
    }
    const marked: any = vcUndoMark(cur, 'writing')
    marked.requestId = requestId
    setState(marked)
    callOf(String(VC_UNDO_PHONE_WRITE), built.args).then(function (reply: any): any {
      setState(function (s: any): any { return vcUndoApplyWrite(s, marked.seq, reply) })
    })
  }
  return vcUndoPageNode(React.createElement, (seed.t || function (key: string): string { return key }), { state: state, onInput: input, onPick: pick, onCheck: check, onCancel: cancel, onGo: go, onRetry: check })
}

export const VC_UNDO_PAGE_NAMES: any = { node: 'vcUndoPageNode', panel: 'VC_UNDO_PANEL' }
