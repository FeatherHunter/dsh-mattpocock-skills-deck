// views/versionControl/vcSyncPage.ts —— 「远端与同步」页里的同步段（#1755 T19，域 8 的 8.5–8.14）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包。
//
// 这一段挂在远端与同步页正文末尾（vcRemotePage 调用 vcSyncPageNode），只画十个同步动作：
// 获取 / 三档拉取 / 推送 / 首次推送 / 删远端引用 / 带租约强推 / 原子推送 / 推送标签。
// 只画界面，不发请求：预检（wf.gitSyncCheck）与执行（wf.gitSyncWrite）都由数据层在用户点按钮时发起。
// 三条画法纪律：
//   ① 预检结果里的禁用理由常驻在触发点上，点预检之前也照常显示原因（不禁用成灰按钮不说为什么）；
//   ② 确认卡贴触发点、固定四段、默认焦点在取消；强推卡点名旧/新提交号与「基准来自 ls-remote」；
//   ③ 结果回到触发点：成功给 git 子命令名、耗时、作用对象数与下一步；失败给 git 原话、环节、期望与实际。
// 四档宽：300 只留动作名与一个主按钮，其余收进同一段；380 补命令原文；460 起补理由与任务细节；
//   任何档位都保留十个入口，不因为窄而删动作。两套皮肤只换颜色，禁用与危险各用各的语义色。

declare const VC_SYNC_ACTION_ROWS: any[]
declare function vcSyncStateOf(reads: any): string
declare function vcSyncDataOf(reads: any): any
declare function vcSyncErrorOf(reads: any): any
declare function vcSyncTaskOf(reads: any): any
declare function vcCapabilityOf(id: any): any
declare function vcWhenText(t: any, nowMs: any, ms: any): string
declare function vcShellConfirmCardNode(h: any, t: any, o: any): any
declare function vcShellResultNode(h: any, t: any, o: any): any
declare function vcShellStateNode(h: any, t: any, o: any): any
declare function syncReasonTextOf(reason: any): string

/** 宽度归一：只认 300/380/460/520 四档，落在中间时按「至少能放下」往小取。 */
const vcSyncWidthOf = function (width: any): number {
  const n = Number(width)
  if (!isFinite(n) || n <= 0) return 460
  if (n < 380) return 300
  if (n < 460) return 380
  if (n < 520) return 460
  return 520
}

// #1841：十个动作按用途分四组（获取 / 拉取 / 推送 / 远端引用）。分组只改摆放与标题，不改动作本身：
// 每条仍是同形状的 li + 按钮 + 展开面板，data-vc-sync-act 一个不少，300 宽也保留全部入口。
// 组的顺序照定稿原型第 39 张：先取回远端信息，再拉、再推，最后清理远端引用。
const VC_SYNC_GROUPS: any[] = [
  { id: 'fetch', titleKey: 'vc.remote.syncGroup.fetch', ids: ['8.5'] },
  { id: 'pull', titleKey: 'vc.remote.syncGroup.pull', ids: ['8.6', '8.7', '8.8'] },
  { id: 'push', titleKey: 'vc.remote.syncGroup.push', ids: ['8.9', '8.10', '8.12', '8.13', '8.14'] },
  { id: 'refs', titleKey: 'vc.remote.syncGroup.refs', ids: ['8.11'] },
]

/** 宿主回包 → 画法模型；没预检过时模型为 null（只画动作入口，不画理由与确认卡）。 */
export const vcSyncModelOf = function (reads: any, ui: any, width: any, nowMs: any) {
  const state = vcSyncStateOf(reads)
  const data: any = vcSyncDataOf(reads)
  const error: any = vcSyncErrorOf(reads)
  const task: any = vcSyncTaskOf(reads)
  const pageState = state === 'ok' ? 'ok' : state === 'err' ? 'error' : 'loading'
  const u: any = ui || {}
  const plan: any = data && data.plan ? data.plan : null
  const openId = String(u.open || (plan && data ? String((data.capabilityId || plan.id || '')) : '') || '')
  return {
    state: pageState,
    data: data,
    error: error,
    task: task,
    plan: plan,
    width: vcSyncWidthOf(width),
    nowMs: nowMs,
    openId: openId,
    decision: data && typeof data.decision === 'string' ? data.decision : '',
    confirm: data && data.confirm ? data.confirm : null,
    confirmRequired: !!(data && data.confirmRequired === true && data.ticket),
    ticket: data && data.ticket ? data.ticket : null,
    result: u.result || null
  }
}

/** 理由列表：预检回的 reason id 逐条翻成整句；没有理由时不画（不写「无」占位）。 */
const vcSyncReasonsNode = function (h: any, t: any, model: any) {
  const data: any = model.data
  if (!data || !Array.isArray(data.reasons) || data.reasons.length === 0) return null
  // 预检回包里的理由是 { id, text, blocking } 结构（宿主已翻好整句）；也接住纯字符串形状，界面不再自己再翻。
  const items: any[] = data.reasons.map(function (reason: any) {
    const key = typeof reason === 'string' ? reason : String((reason && reason.id) || '')
    const text = typeof reason === 'string' ? syncReasonTextOf(reason) : String((reason && reason.text) || syncReasonTextOf(key))
    return h('li', { key: key, className: 'vcs-sync-why-item', 'data-vc-sync-reason': key }, text)
  })
  return h('div', { key: 'why', className: 'vcs-sync-why', 'data-vc-sync-why': '1' }, [
    h('span', { key: 'title', className: 'vcs-sync-why-title' }, t('vc.sync.reasonTitle')),
    h('ul', { key: 'list', className: 'vcs-sync-why-list', role: 'list' }, items),
  ])
}

/** 强推的租约段：点名旧/新提交号，并写明基准是这次 ls-remote 读到的（联网读取时刻由预检回包给）。 */
const vcSyncLeaseNode = function (h: any, t: any, model: any) {
  const data: any = model.data
  if (!data || String(data.action || '') !== 'force-push') return null
  const oldOid = String(data.oldOid || '')
  const newOid = String(data.newOid || '')
  const kids: any[] = [h('p', { key: 'note', className: 'vcs-sync-lease-note', 'data-vc-sync-lease': '1' }, t('vc.sync.leaseNote', { when: vcWhenText(t, model.nowMs, data.readAtMs) }))]
  kids.push(h('p', { key: 'old', className: 'vcs-sync-old', 'data-vc-sync-old': oldOid }, t('vc.sync.old', { oid: oldOid })))
  kids.push(h('p', { key: 'new', className: 'vcs-sync-new', 'data-vc-sync-new': newOid }, t('vc.sync.new', { oid: newOid })))
  return h('div', { key: 'lease', className: 'vcs-sync-lease' }, kids)
}

/** 版本门：2.11–2.29 照常可用但少一道保护；如实写出来，不把降级藏起来。 */
const vcSyncVersionNode = function (h: any, t: any, model: any) {
  const data: any = model.data
  const policy: any = data && data.versionPolicy ? data.versionPolicy : null
  if (!policy || policy.degraded !== true) return null
  return h('p', { key: 'version', className: 'vcs-sync-version', 'data-vc-sync-version-note': '1' }, t('vc.sync.versionNote', { need: String(policy.need || '2.30') }))
}

/** 执行结果画在触发点这段里：成功带命令/耗时/对象数，失败带 git 原话与环节。 */
const vcSyncResultNode = function (h: any, t: any, result: any) {
  if (!result) return null
  if (result.error === true || result.ok === false) {
    return h('div', { key: 'result', className: 'vcs-sync-result' }, [vcShellResultNode(h, t, { error: true, git: result.git, step: result.step, expected: result.expected, actual: result.actual, cause: result.cause })])
  }
  return h('div', { key: 'result', className: 'vcs-sync-result' }, [vcShellResultNode(h, t, { cmd: result.cmd, ms: result.ms, n: result.n, next: result.next })])
}

/** 任务区：执行后交给长任务通道，这里如实画任务号、阶段、结论与取消后的残留说明。 */
const vcSyncTaskNode = function (h: any, t: any, task: any) {
  if (!task) return null
  const kids: any[] = [h('p', { key: 'title', className: 'vcs-sync-task-title' }, t('vc.sync.taskTitle'))]
  kids.push(h('p', { key: 'id', className: 'vcs-sync-task-id', 'data-vc-sync-task-id': String(task.taskId || task.id || '') }, t('vc.sync.taskId', { taskId: String(task.taskId || task.id || '') })))
  kids.push(h('p', { key: 'state', className: 'vcs-sync-task-state', 'data-vc-sync-task-state': String(task.state || '') }, t('vc.sync.taskState', { state: String(task.state || '') })))
  if (task.phase) kids.push(h('p', { key: 'phase', className: 'vcs-sync-task-phase', 'data-vc-sync-task-phase': String(task.phase) }, String(task.phase)))
  if (task.conclusion) kids.push(h('p', { key: 'conclusion', className: 'vcs-sync-task-conclusion', 'data-vc-sync-task-conclusion': String(task.conclusion) }, t('vc.sync.taskConclusion', { conclusion: String(task.conclusion) })))
  if (task.residual) kids.push(h('p', { key: 'residual', className: 'vcs-sync-task-residual', 'data-vc-sync-task-residual': '1' }, t('vc.sync.taskResidual')))
  kids.push(h('button', { key: 'cancel', className: 'vcs-sync-cancel', type: 'button', 'data-vc-sync-cancel': '1', 'data-press': 'button', 'data-log': 'vc.sync.cancel', 'aria-label': t('vc.sync.taskCancelLabel') }, t('vc.sync.taskCancel')))
  return h('div', { key: 'task', className: 'vcs-sync-task', 'data-vc-sync-task': '1', role: 'status' }, kids)
}

/** 删除远端引用要分清删分支还是删标签；两个按钮常驻在触发点，不靠下拉藏起来。 */
const vcSyncKindNode = function (h: any, t: any, model: any) {
  if (!model.data || String(model.data.action || '') !== 'delete-remote-ref') return null
  const kind = String((model.plan && model.plan.refKind) || '')
  return h('div', { key: 'kind', className: 'vcs-sync-kind', role: 'group', 'aria-label': t('vc.sync.deleteKindLabel') }, [
    h('button', { key: 'branch', className: 'vcs-sync-kind-btn', type: 'button', 'data-vc-sync-kind': 'branch', 'aria-pressed': kind === 'branch' ? 'true' : 'false', 'data-press': 'button' }, t('vc.sync.deleteBranch')),
    h('button', { key: 'tag', className: 'vcs-sync-kind-btn', type: 'button', 'data-vc-sync-kind': 'tag', 'aria-pressed': kind === 'tag' ? 'true' : 'false', 'data-press': 'button' }, t('vc.sync.deleteTag')),
  ])
}

/** 一个动作：按钮加展开面板。面板 id 与按钮 aria-controls 逐字对应，键盘与读屏都能跟到底。 */
const vcSyncActionNode = function (h: any, t: any, model: any, row: any) {
  const id = String(row.id)
  const open = model.openId === id
  const panelId = 'vc-sync-panel-' + id
  const cap: any = vcCapabilityOf(id) || {}
  const button = h('button', {
    key: 'btn',
    className: 'vcs-sync-act' + (open ? ' vcs-sync-act-open' : ''),
    type: 'button',
    'data-vc-sync-act': id,
    'aria-expanded': open ? 'true' : 'false',
    'aria-controls': panelId,
    'data-press': 'button',
    'data-log': 'vc.sync.open',
  }, t(row.labelKey))
  const kids: any[] = [button]
  if (open) {
    const panelKids: any[] = []
    panelKids.push(h('p', { key: 'name', className: 'vcs-sync-name' }, String(cap.name || t(row.labelKey))))
    if (model.width >= 380) panelKids.push(h('code', { key: 'cmd', className: 'vcs-sync-command', 'data-vc-sync-command': id }, String(cap.command || '')))
    if (model.decision) panelKids.push(h('p', { key: 'decision', className: 'vcs-sync-decision', 'data-vc-sync-decision': model.decision }, t('vc.sync.decision.' + model.decision)))
    const why = vcSyncReasonsNode(h, t, model)
    if (why) panelKids.push(why)
    const kind = vcSyncKindNode(h, t, model)
    if (kind) panelKids.push(kind)
    const lease = vcSyncLeaseNode(h, t, model)
    if (lease) panelKids.push(lease)
    const version = vcSyncVersionNode(h, t, model)
    if (version) panelKids.push(version)
    panelKids.push(h('p', { key: 'checkHint', className: 'vcs-sync-check-hint' }, t('vc.sync.checkHint')))
    panelKids.push(h('button', { key: 'check', className: 'vcs-sync-check', type: 'button', 'data-vc-sync-check': id, 'data-press': 'button', 'data-log': 'vc.sync.check', 'aria-label': t('vc.sync.checkLabel') }, t('vc.sync.check')))
    if (model.confirmRequired && model.confirm) {
      panelKids.push(h('div', { key: 'confirm', className: 'vcs-sync-confirm', 'data-vc-sync-confirm': '1', 'aria-label': t('vc.sync.confirmLabel', { target: String(model.confirm.target || '') }) }, [
        h('p', { key: 'ticket', className: 'vcs-sync-ticket', 'data-vc-sync-ticket': String((model.ticket && model.ticket.id) || '') }, t('vc.sync.ticketNote')),
        vcShellConfirmCardNode(h, t, { verb: model.confirm.verb, target: model.confirm.target }),
      ]))
    }
    const result = vcSyncResultNode(h, t, model.result)
    if (result) panelKids.push(result)
    kids.push(h('div', { key: 'panel', id: panelId, className: 'vcs-sync-panel', 'data-vc-sync-panel': id, role: 'group', 'aria-label': t(row.labelKey) }, panelKids))
  }
  return h('li', { key: id, className: 'vcs-sync-row' + (open ? ' is-open' : ''), 'data-vc-sync-row': id }, kids)
}

/** 一组同步动作：组标题 + 该组动作。组内动作与不分组时形状完全一样，组只负责标题与顺序。 */
const vcSyncGroupNode = function (h: any, t: any, model: any, group: any) {
  const rows = VC_SYNC_ACTION_ROWS.filter(function (row: any) { return group.ids.indexOf(String(row.id)) >= 0 })
  if (rows.length === 0) return null
  return h('div', { key: 'group-' + group.id, className: 'vcs-sync-group', 'data-vc-sync-group': group.id }, [
    h('h4', { key: 'title', className: 'vcs-sync-group-title' }, t(group.titleKey)),
    h('ul', { key: 'acts', className: 'vcs-sync-acts', role: 'list', 'aria-label': t(group.titleKey) }, rows.map(function (row: any) { return vcSyncActionNode(h, t, model, row) })),
  ])
}

/**
 * 同步段正文：状态块 + 按用途分组的十个动作 + 任务区。宿主读数缺失时上层不会调用本函数。
 * 分组只改摆放：十个入口与展开面板的行为不变；确认卡与结果仍在各自动作的展开面板里（触发点旁）。
 */
export const vcSyncPageNode = function (h: any, t: any, o: any) {
  const opts: any = o || {}
  const model: any = vcSyncModelOf(opts.reads, opts.ui, opts.width, opts.nowMs)
  const kids: any[] = []
  const stateNode = vcShellStateNode(h, t, { state: model.state, reasonKey: model.state === 'error' ? 'vc.sync.loadFail' : undefined })
  if (stateNode) kids.push(stateNode)
  if (model.error && model.error.message) kids.push(h('p', { key: 'err', className: 'vcs-sync-error', role: 'alert', 'data-vc-sync-error': String(model.error.kind || 'host') }, String(model.error.message)))
  for (const group of VC_SYNC_GROUPS) {
    const node = vcSyncGroupNode(h, t, model, group)
    if (node) kids.push(node)
  }
  const task = vcSyncTaskNode(h, t, model.task)
  if (task) kids.push(task)
  return h('div', { className: 'vcs-sync', 'data-vc-sync-page': '1', 'data-vc-sync-state': model.state, 'data-vc-sync-decision': model.decision }, kids)
}
