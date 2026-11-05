// views/versionControl/vcMigratePage.ts —— 「管理 › 迁移与备份」页正文（#1759 T23；#1844 按定稿原型 43 重排）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包。
//
// 这一页画六个能力：克隆（8.16，克隆向导由页面壳当槽位递进来）、初始化仓库（11.1）、归档导出（11.12）、
//   离线包（11.13：create / verify / unbundle 三行）、历史导出与导入（5.13 两行）、生成补丁邮件（14.1，
//   导出向导由页面壳当槽位递进来）。svn 探测与抓取一次是补充块——账本里没有独立编号。
// 11.14 refs migrate 与 11.15 scalar 是只读项、归维护页；这一页只在末尾放一句指路说明，不给触发按钮。
//
// 分区顺序照定稿原型 43（docs/prototype/vc-redesign/src/ui/views/pages-system.ts 的 renderMigrate）：
//   克隆与初始化 → 归档与离线包 → 历史与邮件 → 备份与恢复。
// 原型没有、但本产品必须有的两块排在原型分区之后：SVN 桥（补充块）与写动作的任务区 + 维护页指路。
// 这条顺序是验收口径：原型区块在最前、首屏与原型一致，额外区块只许往后加，不许插到原型区块中间。
//
// 三条画法纪律（与同步页同一套）：
//   ① 预检回的禁用理由常驻在触发点上，不把「不能做」画成灰按钮；
//   ② 需要确认的动作（fast-import、svn-fetch）把确认卡贴在触发面板里，固定四段、默认焦点在取消；
//   ③ 结果回到触发点：只读动作在预检这一步就读出结果，写动作由长任务通道执行后回到同一个面板。
// 四档宽：300 只留动作名与展开键；380 补命令原文；460 起补产物路径与任务细节；520 不额外增删入口。

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
// 页面骨架四个原语在同一个构建闭包里（vcPageHead 排在页面壳之前），这里只声明形状，不 import。
declare function vcPageSectionNode(h: any, t: any, o: any): any
declare function vcPageObjRowNode(h: any, t: any, o: any): any
declare function vcPageCapSummaryNode(h: any, t: any, capId: any, label?: any): any

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
  const u: any = ui || {}
  const plan: any = data && data.plan ? data.plan : null
  const openAction = String(u.open || (data && data.action ? String(data.action) : '') || '')
  return {
    // 读数没到之前叫 loading、失败叫 error；成功态不画状态块（这一页没有可筛选的列表，空态文案会误导）。
    state: state === 'ok' ? 'ok' : state === 'err' ? 'error' : 'loading',
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
    result: u.result || null,
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

/**
 * 一个动作行：整行是一颗按钮（编号 + 动作名 + 动作强度，右侧是只读标记与展开键），面板贴在按钮下面。
 * 整行一颗按钮是刻意的：原型 43 的行就是「一行一个动作」，点哪里都展开同一段；
 *   data-vc-migrate-act 与 aria-expanded/aria-controls 仍挂在按钮上，键盘与读屏跟得到，门禁也照旧按它数入口。
 */
const vcMigrateActionNode = function (h: any, t: any, model: any, row: any) {
  const action = String(row.action)
  const open = model.openAction === action
  const panelId = 'vc-migrate-panel-' + action
  const capId = String(row.id || '')
  const label = t(row.labelKey)
  const attrs: any = {
    key: 'btn',
    className: 'vcs-migrate-act' + (open ? ' is-open' : ''),
    type: 'button',
    'data-vc-migrate-act': action,
    'aria-expanded': open ? 'true' : 'false',
    'data-press': 'button',
    'data-log': 'vc.migrate.open',
  }
  // aria-controls 只在面板真的存在时挂：否则读屏与门禁都会追到一个不存在的 id。
  if (open) attrs['aria-controls'] = panelId
  attrs[capId === '' ? 'data-vc-migrate-extra' : 'data-vc-migrate-cap'] = capId === '' ? '1' : capId
  // 折叠状态下也把 git 命令原文写在行里（原型 43 的每一行都有这一行等宽小字）；380 宽以下先收起，
  //   点开面板仍能看到完整命令，任何档位都不删入口。这一行不带 data-vc-migrate-command：那个记号属于
  //   面板里的命令原文，M16 按宽度收放面板时数的是它。
  const cap: any = capId === '' ? {} : (vcCapabilityOf(capId) || {})
  const rowMain: any[] = [vcPageCapSummaryNode(h, t, capId, label)]
  if (model.width >= 380 && String(cap.command || '') !== '') rowMain.push(h('span', { key: 'cmd', className: 'vcs-migrate-act-cmd' }, String(cap.command)))
  const button = h('button', attrs, [
    h('span', { key: 'main', className: 'vcs-migrate-act-main' }, rowMain),
    h('span', { key: 'side', className: 'vcs-migrate-act-side' }, [
      row.readOnly === true ? h('span', { key: 'ro', className: 'page-chip is-read' }, t('vc.migrate.readonlyChip')) : null,
      h('span', { key: 'go', className: 'page-btn' }, open ? t('vc.migrate.close') : t('vc.migrate.open')),
    ]),
  ])
  const kids: any[] = [button]
  if (open) {
    const panelKids: any[] = []
    if (model.width >= 380) panelKids.push(h('code', { key: 'cmd', className: 'vcs-migrate-command', 'data-vc-migrate-command': action }, String((vcCapabilityOf(capId) || {}).command || (model.data && model.data.command) || '')))
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

/** 一节里的动作行：按动作名挑出这一段的几条，顺序仍按 VC_MIGRATE_ACTION_ROWS 的账本次序。 */
const vcMigrateGroupNode = function (h: any, t: any, model: any, actions: string[]) {
  const rows: any[] = []
  for (let i = 0; i < VC_MIGRATE_ACTION_ROWS.length; i = i + 1) {
    const row: any = VC_MIGRATE_ACTION_ROWS[i]
    if (actions.indexOf(String(row.action)) >= 0) rows.push(vcMigrateActionNode(h, t, model, row))
  }
  return h('ul', { key: 'acts', className: 'vcs-migrate-acts', role: 'list' }, rows)
}

/** 备份与恢复：两句常驻提醒（原型 43 的警告色与灰字两行），不是动作，不挂按钮。 */
const vcMigrateBackupNode = function (h: any, t: any) {
  return h('div', { key: 'backup', className: 'page-note-block', 'data-vc-migrate-backup': '1' }, [
    h('p', { key: 'warn', className: 'page-note is-warn' }, t('vc.migrate.backup.warn')),
    h('p', { key: 'muted', className: 'page-note is-muted' }, t('vc.migrate.backup.muted')),
  ])
}

/**
 * 迁移页正文。入参：
 *   reads（预检与任务两槽读数）、ui（展开的动作与字段初值）、width、nowMs；
 *   slots.clone（克隆向导 8.16）与 slots.exportWizard（导出向导 14.1）由页面壳递进来，分别落在
 *   「克隆与初始化」「历史与邮件」两段；槽位为空就跳过（单测与全页自检不必造这两个组件）。
 * 分区不依赖读数：读数为空时按状态块画加载态，动作入口照画，不藏功能。
 */
export const vcMigratePageNode = function (h: any, t: any, o: any) {
  const opts: any = o || {}
  const model: any = vcMigrateModelOf(opts.reads, opts.ui, opts.width, opts.nowMs)
  model.ui = opts.ui || {}
  const slots: any = opts.slots || {}
  const kids: any[] = []
  // 状态块只在读数没到 / 失败时画：成功态这一页没有可筛选的列表，画空态会让人以为要清筛选条件。
  if (model.state !== 'ok') {
    const stateNode = vcShellStateNode(h, t, { state: model.state, reasonKey: model.state === 'error' ? 'vc.migrate.loadFail' : undefined })
    if (stateNode) kids.push(stateNode)
  }
  if (model.error && model.error.message) kids.push(h('p', { key: 'err', className: 'vcs-migrate-error', role: 'alert', 'data-vc-migrate-error': String(model.error.kind || 'host') }, String(model.error.message)))
  // ① 克隆与初始化（原型 43 第一段）：克隆向导在前，初始化仓库是这一段唯一的受控写。
  const cloneKids: any[] = []
  if (slots.clone) cloneKids.push(slots.clone)
  cloneKids.push(vcMigrateGroupNode(h, t, model, ['init']))
  kids.push(vcPageSectionNode(h, t, { sectionKey: 'clone-init', title: 'vc.migrate.section.cloneInit.title', countText: 'vc.migrate.section.cloneInit.count', note: 'vc.migrate.section.cloneInit.note', children: cloneKids }))
  // ② 归档与离线包：归档一行、离线包三行（create / verify / unbundle），产出都是一份文件。
  kids.push(vcPageSectionNode(h, t, { sectionKey: 'archive', title: 'vc.migrate.section.archive.title', countText: 'vc.migrate.section.archive.count', note: 'vc.migrate.section.archive.note', children: [vcMigrateGroupNode(h, t, model, ['archive', 'bundle-create', 'bundle-verify', 'bundle-unbundle'])] }))
  // ③ 历史与邮件：14.1 的导出向导（原型这一段的可见行）在前，5.13 的导出 / 导入两行跟在后面。
  const historyKids: any[] = []
  if (slots.exportWizard) historyKids.push(slots.exportWizard)
  historyKids.push(vcMigrateGroupNode(h, t, model, ['fast-export', 'fast-import']))
  kids.push(vcPageSectionNode(h, t, { sectionKey: 'history', title: 'vc.migrate.section.history.title', countText: 'vc.migrate.section.history.count', note: 'vc.migrate.section.history.note', children: historyKids }))
  // ④ 备份与恢复：两句提醒，没有动作行。
  kids.push(vcPageSectionNode(h, t, { sectionKey: 'backup', title: 'vc.migrate.section.backup.title', note: 'vc.migrate.section.backup.note', children: [vcMigrateBackupNode(h, t)] }))
  // ⑤ 以下三块原型没有，按「额外区块排在原型之后」的顺序接在后面。
  kids.push(vcPageSectionNode(h, t, { sectionKey: 'svn', title: 'vc.migrate.section.svn.title', countText: 'vc.migrate.section.svn.count', note: 'vc.migrate.section.svn.note', children: [vcMigrateGroupNode(h, t, model, ['svn-probe', 'svn-fetch'])] }))
  const task = vcMigrateTaskNode(h, t, model.task)
  if (task) kids.push(task)
  kids.push(h('p', { key: 'maint', className: 'vcs-migrate-maint page-note', 'data-vc-migrate-note': 'maintenance-pointer' }, t('vc.migrate.maintenanceNote')))
  // 九个动作行按分区分组后不再共用一个 ul，原 ul 的 aria-label（vc.migrate.actionsLabel）挪到页面根：
  //   屏幕阅读器仍能一句话说明「这一页是迁移动作」，词条不必删。
  return h('section', { className: 'vcs-migrate page-stack', 'data-vc-migrate-page': '1', 'data-vc-migrate-state': model.state, 'data-vc-migrate-decision': model.decision, 'aria-label': t('vc.migrate.actionsLabel') }, kids)
}
