// views/versionControl/vcMigrateExport.ts —— 「迁移与备份」页的 14.1 导出向导（#1762 T26，规格 #1586 域 14）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包。
//
// 14.1 是这一页唯一可执行的能力：git format-patch 走长任务通道（#1740 的 start / query / cancel），
//   产出一组补丁文件并给出输出目录与文件路径。三步照交互契约：
//   ① 预检：先问 wf.gitPlatformCheck，拿回 120 秒票据与规范化后的输出目录；参数不合规当场说原因。
//   ② 确认：确认卡贴触发点，四段（会动什么 / 不会动什么 / 可逆性与恢复路径 / 动词写后果），默认焦点在取消。
//   ③ 结果：任务发出后贴在这一块里；结束后按任务结论显示状态与输出目录，并重列一次目录里的补丁文件。
// 失败如实：票据过期或仓库变了（stale）提示重新预检；任务失败显示原话；列目录失败不猜「没有补丁」。
//
// 本文件不画 data-cap-primary：14.1 的主入口行由页面壳统一给；这里只画向导本体。

declare function vcCapabilityOf(capId: any): any
declare function vcPlatformPatchesOf(reads: any): any
declare function vcPlatformPatchesStateOf(reads: any): string
declare function vcPlatformPatchesErrorOf(reads: any): any
declare const VC_PLATFORM_PHONES: Record<string, string>

/** 真源标识：门禁按这一行找本文件，改路径要一起改门禁。 */
export const VC_MIGRATE_EXPORT_SOURCE = 'src/client/views/versionControl/vcMigrateExport.ts'
/** 向导发出的三条电话：预检 / 凭票执行（内部转长任务通道）/ 任务查询。 */
export const VC_MIGRATE_EXPORT_PHONES: Record<string, string> = {
  check: 'wf.gitPlatformCheck',
  run: 'wf.gitPlatformRun',
  taskQuery: 'wf.gitTaskQuery',
}
/** 这一页其余能力的说明编号（不含 14.1：它的向导就在上方）。 */
export const VC_MIGRATE_NOTE_IDS: string[] = ['5.13', '8.16', '11.1', '11.12', '11.13', '14.1']
/** 演练导出一份全新的向导状态（不是读数；读数由调用方从宿主拿）。 */
export const vcNewMigrateExport = function () {
  return { range: '', dir: '', stage: 'idle', ticket: null, error: null, task: null, requestId: '', checkedDir: '', checkedRange: '' }
}

const vcMigText = function (t: any, key: string, vars: any): string {
  if (typeof t !== 'function') return key
  return vars ? t(key, vars) : t(key)
}
const vcMigFailOf = function (reply: any) {
  if (reply && reply.ok === false) {
    const e = reply.error || {}
    return { kind: String(e.kind || 'unknown'), reason: String(e.reason || e.kind || 'unknown'), message: String(e.message || ''), hint: String(e.hint || '') }
  }
  return { kind: 'shape', reason: 'shape', message: '', hint: '' }
}
const vcMigPatchOf = function (reply: any) {
  if (reply && reply.ok === false) return vcMigFailOf(reply)
  return null
}

/** 预检回包落成向导状态：拿到票据就进 checked，保留规范化目录（相对路径会被宿主拼成绝对路径）。 */
export const vcApplyMigrateCheck = function (state: any, reply: any) {
  const base = state || vcNewMigrateExport()
  if (reply && reply.ok === true && reply.ticket && typeof reply.ticket.id === 'string') {
    const plan = reply.plan || {}
    return Object.assign({}, base, {
      stage: 'checked', error: null, ticket: reply.ticket,
      checkedDir: String(plan.dirAbs || plan.dir || base.dir || ''),
      checkedRange: String(plan.range || base.range || ''),
      requestId: '',
    })
  }
  return Object.assign({}, base, { stage: 'error', error: vcMigFailOf(reply), ticket: null })
}
/** 执行回包落成向导状态：任务发出就进 running，并把 requestId 记下来供查询去重与重放。 */
export const vcApplyMigrateRun = function (state: any, reply: any) {
  const base = state || vcNewMigrateExport()
  if (reply && reply.ok === true && reply.task) {
    return Object.assign({}, base, { stage: 'running', error: null, task: reply.task, requestId: String(reply.requestId || '') })
  }
  return Object.assign({}, base, { stage: 'error', error: vcMigFailOf(reply) })
}
/** 任务查询回包落成向导状态：结论到了就进 done（成功失败都算结束；取消与中断如实显示）。 */
export const vcApplyMigrateTask = function (state: any, reply: any) {
  const base = state || vcNewMigrateExport()
  if (reply && reply.ok === true && reply.task) {
    const task = reply.task
    const done = task.state === 'done'
    return Object.assign({}, base, { stage: done ? 'done' : 'running', task: task, error: done && task.conclusion === 'failed' ? { kind: 'task', reason: String(task.failureKind || 'failed'), message: String(task.failureLine || ''), hint: '' } : null })
  }
  return Object.assign({}, base, { stage: 'error', error: vcMigFailOf(reply) })
}
/** 把一次预检发出去；返回新状态（loading 阶段只改 stage，不改输入）。 */
export const vcRunMigrateCheck = function (state: any, call: any, cwd: any) {
  const base = state || vcNewMigrateExport()
  const args = { cwd: String(cwd || ''), range: String(base.range || ''), dir: String(base.dir || '') }
  return Promise.resolve()
    .then(function () { return call(VC_MIGRATE_EXPORT_PHONES.check, args) })
    .then(function (reply: any) { return vcApplyMigrateCheck(base, reply) })
    .catch(function (e: any) { return Object.assign({}, base, { stage: 'error', error: { kind: 'throw', reason: 'throw', message: String((e && e.message) || e), hint: '' } }) })
}
/** 凭预检票据把任务发出去（票据过期或现场变了由宿主拒绝，界面把 stale 原样画出来）。 */
export const vcRunMigrateExport = function (state: any, call: any, cwd: any) {
  const base = state || vcNewMigrateExport()
  const ticket = base.ticket || {}
  const args = {
    cwd: String(cwd || ''),
    ticketId: String(ticket.id || ''),
    range: String(base.range || ''),
    dir: String(base.dir || ''),
    requestId: String(base.requestId || ''),
  }
  return Promise.resolve()
    .then(function () { return call(VC_MIGRATE_EXPORT_PHONES.run, args) })
    .then(function (reply: any) { return vcApplyMigrateRun(base, reply) })
    .catch(function (e: any) { return Object.assign({}, base, { stage: 'error', error: { kind: 'throw', reason: 'throw', message: String((e && e.message) || e), hint: '' } }) })
}
/** 查一次任务进度（任务号取自上一次执行回包）。 */
export const vcRunMigrateTaskQuery = function (state: any, call: any, cwd: any, taskId: any) {
  const base = state || vcNewMigrateExport()
  return Promise.resolve()
    .then(function () { return call(VC_MIGRATE_EXPORT_PHONES.taskQuery, { cwd: String(cwd || ''), taskId: String(taskId || '') }) })
    .then(function (reply: any) { return vcApplyMigrateTask(base, reply) })
    .catch(function (e: any) { return Object.assign({}, base, { stage: 'error', error: { kind: 'throw', reason: 'throw', message: String((e && e.message) || e), hint: '' } }) })
}

/** 输入行：区间与输出目录各一个带读屏名称的输入框。 */
const vcMigrateField = function (h: any, t: any, key: string, labelKey: string, value: string, busy: boolean, edit: any) {
  return h('label', { key: key, className: 'vcs-migrate-field' }, [
    h('span', { key: 'l' }, vcMigText(t, labelKey, null)),
    h('input', {
      key: 'i',
      type: 'text',
      'data-vc-migrate-field': key,
      value: value,
      disabled: busy,
      onInput: function (ev: any) { edit(key, String((ev && ev.target && ev.target.value) || '')) },
    }),
  ])
}

/** 输出目录里的补丁文件一块：成功列文件、空目录、目录不存在、读取失败四种画法分开。 */
const vcMigratePatchesNode = function (h: any, t: any, reads: any, ctx: any) {
  const st = vcPlatformPatchesStateOf(reads)
  const data = vcPlatformPatchesOf(reads)
  const kids: any[] = [
    h('h4', { key: 'title', className: 'vcs-sec-title' }, vcMigText(t, 'vc.migrate.patches.title', null)),
  ]
  // 数据层的失败态叫 err（与 vcRemoteData 等同一套约定），这里两者都认。
  if (st === 'err' || st === 'error') {
    const e = vcPlatformPatchesErrorOf(reads) || {}
    kids.push(h('p', { key: 'err', role: 'alert', className: 'vcs-platform-fail', 'data-vc-migrate-patches-error': '1' }, String(e.message || e.kind || '')))
  } else if (data) {
    const list = Array.isArray(data.patches) ? data.patches : []
    kids.push(h('p', { key: 'sum', className: 'vcs-platform-line', 'data-vc-migrate-patch-count': String(data.total || list.length) }, vcMigText(t, 'vc.migrate.patches.list', { n: String(data.total || list.length), dir: String(data.dir || '') })))
    if (data.exists === false) {
      kids.push(h('p', { key: 'missing', className: 'vcs-platform-empty', 'data-vc-migrate-patches-missing': '1' }, vcMigText(t, 'vc.migrate.patches.missing', null)))
    } else if (list.length === 0) {
      kids.push(h('p', { key: 'empty', className: 'vcs-platform-empty', 'data-vc-migrate-patches-empty': '1' }, vcMigText(t, 'vc.migrate.patches.empty', null)))
    } else {
      kids.push(h('ul', { key: 'files', className: 'vcs-migrate-files' }, list.map(function (name: any, i: number) {
        return h('li', { key: 'f' + i, className: 'vcs-migrate-file', 'data-vc-migrate-file': String(name) }, String(name))
      })))
    }
    if (data.others > 0) kids.push(h('p', { key: 'others', className: 'vcs-platform-caption', 'data-vc-migrate-patches-others': String(data.others) }, vcMigText(t, 'vc.migrate.patches.others', { n: String(data.others) })))
  } else {
    kids.push(h('p', { key: 'loading', className: 'vcs-platform-empty', 'data-vc-migrate-patches-loading': '1' }, vcMigText(t, 'vc.shell.state.loading', null)))
  }
  kids.push(h('button', {
    key: 'rescan',
    type: 'button',
    className: 'vcs-platform-btn',
    'data-vc-migrate-rescan': '1',
    onClick: function () { ctx.rescan() },
  }, vcMigText(t, 'vc.migrate.patches.rescan', null)))
  return h('section', { key: 'patches', className: 'vcs-migrate-patches', 'data-vc-migrate-patches': '1' }, kids)
}

/** 其余六条能力的说明（5.13 / 8.16 / 11.1 / 11.12 / 11.13 / 14.1）。 */
const vcMigrateNotesNode = function (h: any, t: any) {
  const rows = VC_MIGRATE_NOTE_IDS.map(function (capId: string) {
    const cap = vcCapabilityOf(capId) || { id: capId, name: capId, minVersion: '' }
    return h('li', { key: capId, className: 'vcs-migrate-note', 'data-vc-migrate-note': capId }, [
      h('h4', { key: 't', className: 'vcs-migrate-note-title' }, String(cap.id || capId) + ' ' + String(cap.name || '')),
      h('p', { key: 'b', className: 'vcs-migrate-note-body' }, vcMigText(t, 'vc.migrate.note.' + capId, null)),
    ])
  })
  return h('section', { key: 'notes', className: 'vcs-migrate-notes', 'data-vc-migrate-notes': '1' }, [
    h('h4', { key: 'title', className: 'vcs-sec-title' }, vcMigText(t, 'vc.migrate.notes.title', null)),
    h('ul', { key: 'rows', className: 'vcs-migrate-note-rows' }, rows),
  ])
}

/**
 * 迁移与备份页的 14.1 导出向导。入参：
 *   state（vcNewMigrateExport() 形状的交互态）、reads（补丁列表读数，见 vcPlatformData.ts）、
 *   width、nowMs，以及 onEdit / onCheck / onRun / onRescan 四个回调（缺省时按钮不做事）。
 */
export const vcMigrateExportNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const state = opts.state || vcNewMigrateExport()
  const stage = String(state.stage || 'idle')
  const busy = stage === 'checking' || stage === 'running'
  const edit = function (key: string, value: string) {
    if (typeof opts.onEdit === 'function') opts.onEdit(key, value)
  }
  const ctx = {
    rescan: function () { if (typeof opts.onRescan === 'function') opts.onRescan(String(state.checkedDir || state.dir || '')) },
    run: function () { if (typeof opts.onRun === 'function') opts.onRun() },
    cancel: function () { if (typeof opts.onCancel === 'function') opts.onCancel() },
  }
  const kids: any[] = [
    h('h3', { key: 'title', className: 'vcs-sec-title' }, vcMigText(t, 'vc.migrate.export.title', null)),
    h('p', { key: 'note', className: 'vcs-platform-note-line' }, vcMigText(t, 'vc.migrate.export.note', null)),
    vcMigrateField(h, t, 'range', 'vc.migrate.export.range', String(state.range || ''), busy, edit),
    vcMigrateField(h, t, 'dir', 'vc.migrate.export.dir', String(state.dir || ''), busy, edit),
    h('button', {
      key: 'check',
      type: 'button',
      className: 'vcs-platform-btn',
      'data-vc-migrate-check': '1',
      disabled: busy,
      onClick: function () { if (typeof opts.onCheck === 'function') opts.onCheck(String(state.range || ''), String(state.dir || '')) },
    }, vcMigText(t, 'vc.migrate.export.check', null)),
  ]
  if (state.ticket && (stage === 'checked' || stage === 'confirm' || stage === 'running')) {
    kids.push(h('p', { key: 'checked', className: 'vcs-platform-ok', 'data-vc-migrate-checked': '1' }, vcMigText(t, 'vc.migrate.export.checked', { range: String(state.checkedRange || state.range || ''), dir: String(state.checkedDir || state.dir || '') })))
    kids.push(h('p', { key: 'ticket', className: 'vcs-platform-caption', 'data-vc-migrate-ticket': String(state.ticket.id || '') }, vcMigText(t, 'vc.migrate.export.ticket', { id: String(state.ticket.id || '') })))
  }
  if (stage === 'error' && state.error && (state.error.reason === 'ticket-expired' || state.error.reason === 'stale-head' || state.error.reason === 'stale-repo')) {
    kids.push(h('p', { key: 'stale', role: 'alert', className: 'vcs-platform-danger', 'data-vc-migrate-stale': '1' }, vcMigText(t, 'vc.migrate.export.stale', null)))
  }
  if (stage === 'checked') {
    kids.push(h('div', { key: 'confirm', className: 'vcs-migrate-confirm', 'data-vc-migrate-confirm': '1', role: 'group', 'aria-label': vcMigText(t, 'vc.migrate.export.confirmTitle', null) }, [
      h('p', { key: 'what', className: 'vcs-migrate-seg', 'data-vc-migrate-confirm-seg': 'what' }, vcMigText(t, 'vc.migrate.export.what', { dir: String(state.checkedDir || state.dir || ''), range: String(state.checkedRange || state.range || '') })),
      h('p', { key: 'wont', className: 'vcs-migrate-seg', 'data-vc-migrate-confirm-seg': 'wont' }, vcMigText(t, 'vc.migrate.export.wont', null)),
      h('p', { key: 'rev', className: 'vcs-migrate-seg', 'data-vc-migrate-confirm-seg': 'reversible' }, vcMigText(t, 'vc.migrate.export.reversible', null)),
      h('p', { key: 'verb', className: 'vcs-migrate-seg', 'data-vc-migrate-confirm-seg': 'verb' }, vcMigText(t, 'vc.migrate.export.verb', null)),
      h('div', { key: 'acts', className: 'vcs-migrate-confirm-acts' }, [
        h('button', { key: 'cancel', type: 'button', 'data-vc-migrate-confirm-cancel': '1', 'data-focus-default': 'cancel', onClick: function () { ctx.cancel() } }, vcMigText(t, 'vc.shell.confirm.cancel', null)),
        h('button', { key: 'go', type: 'button', 'data-vc-migrate-run': '1', onClick: function () { ctx.run() } }, vcMigText(t, 'vc.migrate.export.run', null)),
      ]),
    ]))
  } else if (state.ticket && stage !== 'running' && stage !== 'done') {
    kids.push(h('button', { key: 'run-again', type: 'button', className: 'vcs-platform-btn', 'data-vc-migrate-run': '1', disabled: busy, onClick: function () { ctx.run() } }, vcMigText(t, 'vc.migrate.export.run', null)))
  }
  if (stage === 'running') kids.push(h('p', { key: 'running', role: 'status', className: 'vcs-platform-loading', 'data-vc-migrate-running': '1' }, vcMigText(t, 'vc.migrate.export.running', null)))
  if (state.error && stage === 'error') {
    kids.push(h('div', { key: 'err', role: 'alert', className: 'vcs-platform-fail', 'data-vc-migrate-error': String(state.error.reason || state.error.kind || 'error') }, [
      h('p', { key: 'h' }, vcMigText(t, 'vc.migrate.export.error', null)),
      h('p', { key: 'm', className: 'vcs-platform-caption' }, String(state.error.message || state.error.reason || '')),
    ]))
  }
  if (stage === 'done' && state.task) {
    const conclusion = String(state.task.conclusion || state.task.state || '')
    kids.push(h('p', { key: 'done', role: 'status', className: 'vcs-platform-ok', 'data-vc-migrate-result': conclusion }, vcMigText(t, 'vc.migrate.export.done', { state: conclusion, dir: String(state.checkedDir || state.dir || '') })))
    if (state.task.residual) kids.push(h('p', { key: 'residual', className: 'vcs-platform-caption', 'data-vc-migrate-residual': '1' }, String(state.task.residual)))
    if (state.task.failureLine) kids.push(h('p', { key: 'line', className: 'vcs-platform-caption', 'data-vc-migrate-fail-line': '1' }, String(state.task.failureLine)))
  }
  kids.push(vcMigratePatchesNode(h, t, opts.reads, ctx))
  kids.push(vcMigrateNotesNode(h, t))
  return h('section', { key: 'migrate', className: 'vcs-migrate' + (Number(opts.width) > 0 && Number(opts.width) <= 300 ? ' is-narrow' : ''), 'data-vc-migrate-export': '1' }, kids)
}
