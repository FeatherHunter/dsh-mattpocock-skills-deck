// views/versionControl/vcMigratePage.ts —— 「管理 › 迁移与备份」页正文（#1759 T23，域 11 与 5.13）。
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包。
//
// 这一页画九个动作：初始化仓库（11.1）、归档导出（11.12）、离线包三件事（11.13 create/verify/unbundle）、
// 历史导出与导入（5.13 fast-export / fast-import），加 svn 探测与抓取一次（补充块，账本没有独立 id）。
// 11.14 refs migrate 与 11.15 scalar 是只读项、归维护页；这一页只在末尾放一句指路说明，不给触发按钮。
//
// 三条画法纪律（与同步页同一套）：
//   ① 预检回的禁用理由常驻在触发点上，不把「不能做」画成灰按钮；
//   ② 需要确认的动作（fast-import、svn-fetch）把确认卡贴在触发面板里，固定四段、默认焦点在取消；
//   ③ 结果回到触发点：只读动作在预检这一步就读出结果，写动作由长任务通道执行后回到同一个面板。
// 四档宽：300 只留动作名与一个主按钮；380 补命令原文；460 起补产物路径与任务细节；520 不额外增删入口。
// 两套皮肤只换颜色，只读、危险与禁用各用各的语义色。

declare const VC_MIGRATE_ACTION_ROWS: any[]
declare function vcMigrateStateOf(reads: any): string
declare function vcMigrateDataOf(reads: any): any
declare function vcMigrateErrorOf(reads: any): any
declare function vcMigrateTaskOf(reads: any): any
declare function vcCapabilityOf(id: any): any
declare function vcWhenText(t: any, nowMs: any, ms: any): string
declare function vcShellConfirmCardNode(h: any, t: any, o: any): any
declare function vcShellResultNode(h: any, t: any, o: any): any
declare function vcShellStateNode(h: any, t: any, o: any): any

/** 宽度归一：只认 300/380/460/520 四档，落在中间时按「至少能放下」往小取。 */
const vcMigrateWidthOf = function (width: any): number {
  const n = Number(width)
  if (!isFinite(n) || n <= 0) return 460
  if (n < 380) return 300
  if (n < 460) return 380
  if (n < 520) return 460
  return 520
}

/** 宿主回包 → 画法模型；没预检过时模型仍给空壳（动作入口照画，不藏功能）。 */
export const vcMigrateModelOf = function (reads: any, ui: any, width: any, nowMs: any) {
  const state = vcMigrateStateOf(reads)
  const data: any = vcMigrateDataOf(reads)
  const error: any = vcMigrateErrorOf(reads)
  const task: any = vcMigrateTaskOf(reads)
  const pageState = state === 'ok' ? 'ok' : state === 'err' ? 'error' : 'loading'
  const u: any = ui || {}
  const plan: any = data && data.plan ? data.plan : null
  const openAction = String(u.open || (data && data.action ? String(data.action) : '') || '')
  return {
    state: pageState,
    data: data,
    error: error,
    task: task,
    plan: plan,
    width: vcMigrateWidthOf(width),
    nowMs: nowMs,
    openAction: openAction,
    decision: data && typeof data.decision === 'string' ? data.decision : '',
    confirm: data && data.confirm ? data.confirm : null,
    confirmRequired: !!(data && data.confirmRequired === true && data.ticket),
    ticket: data && data.ticket ? data.ticket : null,
    readOnly: !!(data && data.readOnly === true),
    result: u.result || null
  }
}

/** 理由列表：预检回包里的 { id, text, blocking } 逐条画；界面不再自己翻一遍。 */
const vcMigrateReasonsNode = function (h: any, t: any, model: any) {
  const data: any = model.data
  if (!data || !Array.isArray(data.reasons) || data.reasons.length === 0) return null
  const items: any[] = data.reasons.map(function (reason: any) {
    const key = typeof reason === 'string' ? reason : String((reason && reason.id) || '')
    const text = typeof reason === 'string' ? reason : String((reason && reason.text) || '')
    return h('li', { key: key, className: 'vcs-migrate-why-item', 'data-vc-migrate-reason': key }, text)
  })
  return h('div', { key: 'why', className: 'vcs-migrate-why', 'data-vc-migrate-why': '1' }, [
    h('span', { key: 'title', className: 'vcs-migrate-why-title' }, t('vc.migrate.reasonTitle')),
    h('ul', { key: 'list', className: 'vcs-migrate-why-list', role: 'list' }, items),
  ])
}

/** 版本门：旧版本 git 没有 --initial-branch，界面如实写「建后改名」，不把降级藏起来。 */
const vcMigrateVersionNode = function (h: any, t: any, model: any) {
  const data: any = model.data
  const policy: any = data && data.versionPolicy ? data.versionPolicy : null
  if (!policy || policy.degraded !== true) return null
  return h('p', { key: 'version', className: 'vcs-migrate-version', 'data-vc-migrate-version-note': '1' }, t('vc.migrate.versionNote', { need: String(policy.need || '2.28') }))
}

/** 结果画在触发点这段里：成功带命令与产物路径，失败带 git 原话与环节。 */
const vcMigrateResultNode = function (h: any, t: any, result: any, model: any) {
  if (!result) return null
  if (result.error === true || result.ok === false) {
    return h('div', { key: 'result', className: 'vcs-migrate-result', 'data-vc-migrate-result': 'fail' }, [vcShellResultNode(h, t, { error: true, git: result.git, step: result.step, expected: result.expected, actual: result.actual, cause: result.cause })])
  }
  const cmd = String(result.command || (model.data && model.data.command) || '')
  const n = typeof result.n === 'number' ? result.n : (Array.isArray(result.lines) ? result.lines.length : undefined)
  const next = String(result.note || result.next || (result.path || (model.plan && (model.plan.outputPath || model.plan.targetPath)) || ''))
  return h('div', { key: 'result', className: 'vcs-migrate-result', 'data-vc-migrate-result': 'ok' }, [vcShellResultNode(h, t, { cmd: cmd, ms: result.ms, n: n, next: next })])
}

/** 任务区：除了 init 之外的写动作都走长任务通道，这里画任务号、阶段、结论与取消后的残留说明。 */
const vcMigrateTaskNode = function (h: any, t: any, task: any) {
  if (!task) return null
  const kids: any[] = [h('p', { key: 'title', className: 'vcs-migrate-task-title' }, t('vc.migrate.taskTitle'))]
  kids.push(h('p', { key: 'id', className: 'vcs-migrate-task-id', 'data-vc-migrate-task-id': String(task.taskId || task.id || '') }, t('vc.migrate.taskId', { taskId: String(task.taskId || task.id || '') })))
  kids.push(h('p', { key: 'state', className: 'vcs-migrate-task-state', 'data-vc-migrate-task-state': String(task.state || '') }, t('vc.migrate.taskState', { state: String(task.state || '') })))
  if (task.conclusion) kids.push(h('p', { key: 'conclusion', className: 'vcs-migrate-task-conclusion', 'data-vc-migrate-task-conclusion': String(task.conclusion) }, t('vc.migrate.taskConclusion', { conclusion: String(task.conclusion) })))
  if (task.residual) kids.push(h('p', { key: 'residual', className: 'vcs-migrate-task-residual', 'data-vc-migrate-task-residual': '1' }, t('vc.migrate.taskResidual')))
  kids.push(h('button', { key: 'cancel', className: 'vcs-migrate-cancel', type: 'button', 'data-vc-migrate-cancel': '1', 'data-press': 'button', 'data-log': 'vc.migrate.cancel' }, t('vc.migrate.taskCancel')))
  return h('div', { key: 'task', className: 'vcs-migrate-task', 'data-vc-migrate-task': '1', role: 'status' }, kids)
}

/** 每个动作要填的字段：init 要目标目录与初始分支；离线包要文件路径；fast-import 要多一个导入来源。 */
const vcMigrateFieldsOf = function (action: string): any[] {
  if (action === 'init') return [{ name: 'path', key: 'vc.migrate.field.path' }, { name: 'branch', key: 'vc.migrate.field.branch' }]
  if (action === 'archive') return [{ name: 'outputPath', key: 'vc.migrate.field.outputPath' }, { name: 'ref', key: 'vc.migrate.field.ref' }]
  if (action === 'bundle-create') return [{ name: 'outputPath', key: 'vc.migrate.field.outputPath' }, { name: 'ref', key: 'vc.migrate.field.ref' }]
  if (action === 'bundle-verify' || action === 'bundle-unbundle') return [{ name: 'filePath', key: 'vc.migrate.field.filePath' }]
  if (action === 'fast-export') return [{ name: 'outputPath', key: 'vc.migrate.field.outputPath' }]
  if (action === 'fast-import') return [{ name: 'targetPath', key: 'vc.migrate.field.targetPath' }, { name: 'filePath', key: 'vc.migrate.field.filePath' }, { name: 'branch', key: 'vc.migrate.field.branch' }]
  if (action === 'svn-fetch') return [{ name: 'url', key: 'vc.migrate.field.url' }]
  return []
}

/** 表单：每个字段 label 与 input 以 id 关联，键盘能走到；输入值只从 ui.fields 预填。 */
const vcMigrateFormNode = function (h: any, t: any, model: any, row: any) {
  const fields: any[] = vcMigrateFieldsOf(String(row.action))
  if (fields.length === 0) return null
  const values: any = (model.ui && model.ui.fields) || {}
  const kids: any[] = []
  for (let i = 0; i < fields.length; i = i + 1) {
    const f: any = fields[i]
    const inputId = 'vc-migrate-' + row.action + '-' + f.name
    const value = values[f.name] === undefined ? '' : String(values[f.name])
    kids.push(h('label', { key: 'l' + f.name, className: 'vcs-migrate-label', htmlFor: inputId }, t(f.key)))
    kids.push(h('input', { key: 'i' + f.name, id: inputId, className: 'vcs-migrate-input', type: 'text', defaultValue: value, 'data-vc-migrate-field': f.name, 'aria-label': t(f.key) }))
  }
  if (String(row.action) === 'init') {
    kids.push(h('label', { key: 'l-bare', className: 'vcs-migrate-label', htmlFor: 'vc-migrate-init-bare' }, t('vc.migrate.field.bare')))
    kids.push(h('input', { key: 'i-bare', id: 'vc-migrate-init-bare', className: 'vcs-migrate-input', type: 'checkbox', 'data-vc-migrate-field': 'bare', 'aria-label': t('vc.migrate.field.bare') }))
  }
  return h('div', { key: 'form', className: 'vcs-migrate-form', 'data-vc-migrate-form': row.action }, kids)
}

/** 一个动作：按钮加展开面板。面板 id 与按钮 aria-controls 逐字对应，键盘与读屏都能跟到底。 */
const vcMigrateActionNode = function (h: any, t: any, model: any, row: any) {
  const action = String(row.action)
  const open = model.openAction === action
  const panelId = 'vc-migrate-panel-' + action
  const capId = String(row.id || '')
  const cap: any = capId === '' ? {} : (vcCapabilityOf(capId) || {})
  const label = t(row.labelKey)
  const button = h('button', {
    key: 'btn',
    className: 'vcs-migrate-act' + (open ? ' vcs-migrate-act-open' : ''),
    type: 'button',
    'data-vc-migrate-act': action,
    'aria-expanded': open ? 'true' : 'false',
    'aria-controls': panelId,
    'data-press': 'button',
    'data-log': 'vc.migrate.open',
  }, label)
  const kids: any[] = [button]
  if (open) {
    const panelKids: any[] = []
    panelKids.push(h('p', { key: 'name', className: 'vcs-migrate-name' }, String(cap.name || label)))
    if (capId !== '') panelKids.push(h('p', { key: 'cap', className: 'vcs-migrate-cap', 'data-vc-migrate-cap': capId }, capId + ' · ' + String(cap.level || '')))
    else panelKids.push(h('p', { key: 'cap', className: 'vcs-migrate-cap', 'data-vc-migrate-extra': '1' }, t('vc.migrate.extraNote')))
    if (model.width >= 380) panelKids.push(h('code', { key: 'cmd', className: 'vcs-migrate-command', 'data-vc-migrate-command': action }, String(cap.command || (model.data && model.data.command) || '')))
    if (model.decision) panelKids.push(h('p', { key: 'decision', className: 'vcs-migrate-decision', 'data-vc-migrate-decision': model.decision }, t('vc.migrate.decision.' + model.decision)))
    const why = vcMigrateReasonsNode(h, t, model)
    if (why) panelKids.push(why)
    const version = vcMigrateVersionNode(h, t, model)
    if (version) panelKids.push(version)
    if (row.readOnly === true) {
      panelKids.push(h('p', { key: 'ro', className: 'vcs-migrate-readonly', 'data-vc-migrate-readonly': action }, t('vc.migrate.readonlyNote')))
    } else {
      const form = vcMigrateFormNode(h, t, model, row)
      if (form) panelKids.push(form)
    }
    panelKids.push(h('p', { key: 'checkHint', className: 'vcs-migrate-hint' }, t('vc.migrate.checkHint')))
    panelKids.push(h('button', { key: 'check', className: 'vcs-migrate-check', type: 'button', 'data-vc-migrate-check': action, 'data-press': 'button', 'data-log': 'vc.migrate.check' }, row.readOnly === true ? t('vc.migrate.readOnlyRun') : t('vc.migrate.check')))
    if (model.confirmRequired && model.confirm) {
      panelKids.push(h('div', { key: 'confirm', className: 'vcs-migrate-confirm', 'data-vc-migrate-confirm': '1', 'aria-label': t('vc.migrate.confirmLabel', { target: String(model.confirm.target || '') }) }, [
        h('p', { key: 'ticket', className: 'vcs-migrate-ticket', 'data-vc-migrate-ticket': String((model.ticket && model.ticket.id) || '') }, t('vc.migrate.ticketNote')),
        vcShellConfirmCardNode(h, t, { verb: model.confirm.verb, target: model.confirm.target }),
        h('button', { key: 'go', className: 'vcs-migrate-go', type: 'button', 'data-vc-migrate-go': action, 'data-press': 'button', 'data-log': 'vc.migrate.go' }, t('vc.migrate.go')),
      ]))
    }
    // 结果贴触发点：只读动作的结果来自预检回包，写动作的结果来自 ui.result。
    const ownResult = (model.data && model.data.readOnly === true && String(model.data.action || '') === action) ? model.data.result : null
    const result = vcMigrateResultNode(h, t, model.result || ownResult, model)
    if (result) panelKids.push(result)
    if (model.width >= 460 && model.plan && (model.plan.outputPath || model.plan.targetPath || model.plan.path)) {
      const target = String(model.plan.outputPath || model.plan.targetPath || model.plan.path)
      panelKids.push(h('p', { key: 'path', className: 'vcs-migrate-path', 'data-vc-migrate-path': target }, target))
    }
    kids.push(h('div', { key: 'panel', id: panelId, className: 'vcs-migrate-panel', 'data-vc-migrate-panel': action, role: 'group', 'aria-label': label }, panelKids))
  }
  return h('li', { key: action, className: 'vcs-migrate-row', 'data-vc-migrate-row': action }, kids)
}

/** 迁移页正文：状态条 + 九个动作 + 任务区 + 维护页只读指路。宿主读数缺失时上层不会调用本函数。 */
export const vcMigratePageNode = function (h: any, t: any, o: any) {
  const opts: any = o || {}
  const model: any = vcMigrateModelOf(opts.reads, opts.ui, opts.width, opts.nowMs)
  model.ui = opts.ui || {}
  const kids: any[] = [h('p', { key: 'note', className: 'vcs-migrate-note', 'data-vc-migrate-note': '1' }, t('vc.migrate.note'))]
  const stateNode = vcShellStateNode(h, t, { state: model.state, reasonKey: model.state === 'error' ? 'vc.migrate.loadFail' : undefined })
  if (stateNode) kids.push(stateNode)
  if (model.error && model.error.message) kids.push(h('p', { key: 'err', className: 'vcs-migrate-error', role: 'alert', 'data-vc-migrate-error': String(model.error.kind || 'host') }, String(model.error.message)))
  kids.push(h('ul', { key: 'actions', className: 'vcs-migrate-acts', role: 'list', 'aria-label': t('vc.migrate.actionsLabel') }, VC_MIGRATE_ACTION_ROWS.map(function (row: any) { return vcMigrateActionNode(h, t, model, row) })))
  const task = vcMigrateTaskNode(h, t, model.task)
  if (task) kids.push(task)
  kids.push(h('p', { key: 'maint', className: 'vcs-migrate-maint', 'data-vc-migrate-note': 'maintenance-pointer' }, t('vc.migrate.maintenanceNote')))
  return h('section', { className: 'vcs-migrate', 'data-vc-migrate-page': '1', 'data-vc-migrate-state': model.state, 'data-vc-migrate-decision': model.decision }, kids)
}
