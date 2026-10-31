// views/versionControl/vcMaintenancePage.ts —— 管理 › 维护页正文（#1758 T22，规格 #1586 域 11 的 11.4–11.11）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼进 src/client/index.ts 的 leaf 标记处。
//
// 这一页只画「管理·维护」的四件事：
//   ① 11.4 的对象读数常驻（松散对象、包、仓库体积）；
//   ② 11.5 垃圾回收与 11.8 自动维护：读数 → 预检签 120 秒票 → 四段确认卡 → 凭票执行（走长任务通道）；
//   ③ 11.8 的开 / 关：装系统调度任务或撤掉它，本地命令，仍然先签票再执行；
//   ④ 11.6 清除不可达对象（危险区）：先看预览与备份计划，确认卡四段写清垃圾回收后找不回，且必须先做实备份。
// 另外四项只读（11.7 重新打包、11.9 提交图、11.10 多包索引、11.11 打包引用）只展示状态与能做的整理，
// 不画触发按钮——规格要求这几件事由 git 自己维持，面板只如实说明。
//
// 判定规则的真源在共享层 maintenance-ops.ts，本文件只做「把界面选择翻成电话参数、把回包翻成界面状态」；
// 可见文字全部走 t(词条)，词条真源 config/copy/vcmaintenance.yaml，界面一个中文字面量都没有。

/** 跨叶子与共享层的名字由构建拼进同一个闭包，这里只声明形状（类型检查按单文件跑）。 */
declare const React: any
declare const Tip: any
declare const VC_TASK_POLL_INTERVAL_MS: number
declare function vcWriteErrFamilyOf(reason: any, kind: any): string
declare const VC_MAINTENANCE_PHONES: Record<string, string>
declare const VC_MAINTENANCE_ACTIONS: any[]
declare const VC_MAINTENANCE_DANGER_IDS: string[]
declare function vcMaintenanceOpMetaOf(op: any): any
declare function vcMaintenanceOpLabelKeyOf(op: any): string
declare function vcMaintenanceOpVerbKeyOf(op: any): string
declare function vcMaintenanceRequestIdOf(nowMs: any, salt: any): string
declare function vcMaintenanceReadArgsOf(cwd: any, op: any): any
declare function vcMaintenanceCheckArgsOf(cwd: any, op: any, mode?: any): any
declare function vcMaintenanceWriteArgsOf(cwd: any, op: any, ticketId: any, requestId: any): any
declare function vcMaintenanceReplyKindOf(reply: any): string
declare function vcMaintenanceReasonOf(reply: any): string
declare function vcMaintenanceTicketOf(reply: any): any
declare function vcMaintenanceConfirmOf(reply: any): any
declare function vcMaintenanceBackupOf(reply: any): any
declare function vcMaintenancePreviewOf(reply: any): any
declare function vcMaintenanceObjectsOf(reply: any): any
declare function vcMaintenanceStatusOf(reply: any): any
declare function vcMaintenanceTaskOf(reply: any): any
declare function vcMaintenanceBackupPointOf(reply: any): any
declare function vcMaintenanceBackupSummaryOf(reply: any): string
declare function vcMaintenanceRestoreStepsOf(reply: any): string[]
declare function vcMaintenanceStateOf(reply: any): any
declare function vcMaintenanceFailTextOf(t: any, reply: any, familyOf: any): string
declare function vcMaintenanceTaskConclusionOf(task: any): string
declare function vcMaintenanceProgressOf(task: any): any
declare function humanBytesOf(n: any): string

/** 真源标识：门禁按这一行找本文件，改路径要一起改门禁。 */
export const VC_MAINTENANCE_PAGE_BODY_SOURCE = 'src/client/views/versionControl/vcMaintenancePage.ts'

/** 维护页要画的写动作与只读卡片；门禁据此核对 11.5–11.11 一条不少、也没有多出别的动作。 */
export const VC_MAINTENANCE_PAGE_WRITES: string[] = ['gc', 'maintenance-run', 'maintenance-enable', 'maintenance-disable', 'prune']
export const VC_MAINTENANCE_PAGE_READS: string[] = ['repack', 'commit-graph', 'multi-pack-index', 'pack-refs', 'maintenance-status']
export const VC_MAINTENANCE_PAGE_DANGER: string[] = ['prune']

/** 对象读数的展示行：值一律由纯文本与数字组成，单位换算交给 humanBytesOf，不在界面里拼字符串规则。 */
const vcMaintObjectRowsOf = function (objects: any): any[] {
  if (!objects) return []
  return [
    { id: 'loose', value: String(objects.looseCount === undefined || objects.looseCount === null ? '' : objects.looseCount) },
    { id: 'looseSize', value: humanBytesOf(objects.looseSizeBytes || 0) },
    { id: 'inPack', value: String(objects.inPack === undefined || objects.inPack === null ? '' : objects.inPack) },
    { id: 'packs', value: String(objects.packs === undefined || objects.packs === null ? '' : objects.packs) },
    { id: 'packSize', value: humanBytesOf(objects.packSizeBytes || 0) },
    { id: 'repoSize', value: humanBytesOf(objects.repoSizeBytes || 0) },
  ]
}

/** 自动维护状态的一行：已登记与否、注册在哪、启用了哪些任务、策略名。 */
const vcMaintStatusRowsOf = function (status: any): any[] {
  if (!status) return []
  const tasks: string = Array.isArray(status.enabledTasks) && status.enabledTasks.length > 0 ? status.enabledTasks.join(', ') : ''
  return [
    { id: 'registered', value: status.registered === true ? 'yes' : 'no' },
    { id: 'local', value: status.registeredLocal === true ? 'yes' : 'no' },
    { id: 'global', value: status.registeredGlobal === true ? 'yes' : 'no' },
    { id: 'tasks', value: tasks },
    { id: 'strategy', value: String(status.strategy || '') },
  ]
}

/** 主入口按钮：可点控件一律带 data-press 与唯一小写 data-log，悬停说明经 Tip 薄预设，不写原生 title。 */
const vcMaintButtonOf = function (h: any, t: any, labelKey: any, logKey: any, disabled: any, onPress: any, tipKey: any) {
  const button = h('button', { type: 'button', className: 'dsws-btn dsws-hov', disabled: disabled === true, 'data-press': 'button', 'data-log': logKey, onClick: function () { if (disabled !== true && typeof onPress === 'function') onPress() } }, t(labelKey))
  if (!tipKey) return button
  return h(Tip, { content: t(tipKey) }, button)
}

/** 四段确认卡：做什么 / 不做什么 / 能不能撤回 / 动词。危险动作额外显示备份放到哪、多大、怎么还原。 */
const vcMaintConfirmOf = function (h: any, t: any, op: any, confirm: any, backup: any, preview: any, onGo: any, onCancel: any) {
  const segments: any[] = [
    h('p', { key: 'what', 'data-vc-maint-confirm-seg': 'what' }, String(confirm.what || '')),
    h('p', { key: 'wont', 'data-vc-maint-confirm-seg': 'wont' }, String(confirm.wont || '')),
    h('p', { key: 'reversible', 'data-vc-maint-confirm-seg': 'reversible' }, String(confirm.reversible === false ? t('vc.maintenance.confirm.wontUndo') : t('vc.maintenance.confirm.canUndo'))),
  ]
  const kids: any[] = segments
  if (confirm.command) kids.push(h('code', { key: 'command', 'data-vc-maint-confirm-command': op }, String(confirm.command)))
  if (preview && typeof preview.count === 'number') kids.push(h('p', { key: 'preview', 'data-vc-maint-preview-count': op }, t('vc.maintenance.prune.previewLine', { count: preview.count, earliest: preview.earliestAtMs ? new Date(preview.earliestAtMs).toISOString() : t('vc.maintenance.prune.earliestUnknown') })))
  if (backup) {
    kids.push(h('p', { key: 'backup', 'data-vc-maint-confirm-backup': op }, t('vc.maintenance.prune.backupLine', { path: String(backup.path || ''), size: humanBytesOf(backup.estimateBytes || 0) })))
    kids.push(h('p', { key: 'backupWhy', 'data-vc-maint-confirm-backup-why': op }, t('vc.maintenance.prune.backupWhy')))
  }
  kids.push(h('div', { key: 'actions', className: 'dsws-row' },
    vcMaintButtonOf(h, t, 'vc.maintenance.confirm.cancel', 'vc.maint.cancel.' + String(op || ''), false, onCancel, null),
    vcMaintButtonOf(h, t, 'vc.maintenance.confirm.go', 'vc.maint.go.' + String(op || ''), false, onGo, null)))
  return h('div', { className: 'vcs-confirm', role: 'group', 'data-vc-maint-confirm': op }, kids)
}

/** 结果条：成功显示任务号或本地动作结论；失败显示失败族话术加 git 原话，便于直接排查。 */
const vcMaintResultOf = function (h: any, t: any, op: any, state: any) {
  if (state.error) {
    return h('div', { key: 'error', className: 'vcs-note', 'data-vc-maint-result': op, 'data-vc-maint-result-ok': '0' },
      h('p', { 'data-vc-maint-fail': op }, String(state.error)), vcMaintButtonOf(h, t, 'vc.maintenance.result.retry', 'vc.maint.retry.' + String(op || ''), false, state.onRetry, null))
  }
  if (!state.reply) return null
  const task = vcMaintenanceTaskOf(state.reply)
  const backup = vcMaintenanceBackupPointOf(state.reply)
  const kids: any[] = [h('p', { key: 'ok', 'data-vc-maint-ok': op }, t('vc.maintenance.result.ok'))]
  if (task && task.id) kids.push(h('p', { key: 'task', 'data-vc-maint-task': op }, t('vc.maintenance.result.taskLine', { id: String(task.id) })))
  if (backup) {
    kids.push(h('p', { key: 'backup', 'data-vc-maint-result-backup': op }, vcMaintenanceBackupSummaryOf(state.reply)))
    const steps: string[] = vcMaintenanceRestoreStepsOf(state.reply)
    steps.forEach(function (step: string, index: number) { kids.push(h('p', { key: 'restore' + index, 'data-vc-maint-restore': op }, step)) })
  }
  const status = vcMaintenanceStateOf(state.reply)
  if (status) kids.push(h('p', { key: 'status', 'data-vc-maint-result-status': op }, t('vc.maintenance.result.statusLine', { registered: status.registered === true ? t('vc.maintenance.status.yes') : t('vc.maintenance.status.no') })))
  return h('div', { key: 'result', className: 'vcs-note', 'data-vc-maint-result': op, 'data-vc-maint-result-ok': '1' }, kids)
}

/** 一张动作卡：标题、说明、按钮；签票成功后展开确认卡，执行完成后显示结果条。 */
const vcMaintActionCardOf = function (h: any, t: any, op: any, state: any, handlers: any) {
  const meta: any = vcMaintenanceOpMetaOf(op)
  const kids: any[] = [
    h('h4', { key: 'title', 'data-vc-maint-card': op }, t(vcMaintenanceOpLabelKeyOf(op))),
    h('p', { key: 'command' }, h('code', null, String((meta && meta.command) || ''))),
  ]
  if (state.busy === true) kids.push(h('p', { key: 'busy', 'data-vc-maint-busy': op }, t('vc.maintenance.busy')))
  else if (state.confirm) kids.push(Object.assign({}, vcMaintConfirmOf(h, t, op, state.confirm, state.backup, state.preview, function () { handlers.go(op) }, function () { handlers.cancel(op) }), { key: 'confirm' }))
  else kids.push(Object.assign({}, vcMaintButtonOf(h, t, vcMaintenanceOpVerbKeyOf(op), 'vc.maint.begin.' + op, false, function () { handlers.begin(op) }, 'vc.maintenance.op.tip.' + op), { key: 'begin' }))
  const result = vcMaintResultOf(h, t, op, Object.assign({}, state, { onRetry: function () { handlers.begin(op) } }))
  if (result) kids.push(Object.assign({}, result, { key: 'result' }))
  return h('div', { key: op, className: 'vcs-card', 'data-vc-maint-action': op, 'data-vc-maint-kind': 'write', 'data-vc-maint-danger': meta && meta.dangerous === true ? '1' : '0' }, kids)
}

/** 一张只读卡：只展示读数，没有触发按钮；老版本不支持时把版本要求如实写出来。 */
const vcMaintReadCardOf = function (h: any, t: any, op: any, rows: any, readAt: any) {
  const kids: any[] = [h('h4', { key: 'title', 'data-vc-maint-read-title': op }, t(vcMaintenanceOpLabelKeyOf(op)))]
  if (!rows || rows.length === 0) kids.push(h('p', { key: 'none', 'data-vc-maint-read-empty': op }, t('vc.maintenance.read.empty')))
  else {
    rows.forEach(function (row: any) {
      kids.push(h('p', { key: 'row-' + row.id, 'data-vc-maint-read-row': op + '.' + row.id }, t('vc.maintenance.read.' + row.id) + ': ' + String(row.value)))
    })
  }
  if (readAt) kids.push(h('p', { key: 'readAt', className: 'vcs-muted', 'data-vc-maint-read-at': op }, t('vc.maintenance.readAt', { at: String(readAt) })))
  return h('div', { key: op, className: 'vcs-card', 'data-vc-maint-read-card': op }, kids)
}

/** 页面主体：维护页是「读数常驻 + 动作卡 + 只读卡」三段的竖排。 */
export const vcMaintenancePageNode = function (props: any) {
  const t = props.t
  const cwd: string = String(props.cwd || '')
  const call: any = props.call
  const h = React.createElement
  const stateHook = React.useState({})
  const rows: any = stateHook[0]
  const setRows: any = stateHook[1]
  const dataHook = React.useState({ objects: null, status: null, at: '', reads: {} })
  const data: any = dataHook[0]
  const setData: any = dataHook[1]
  const alive = React.useRef(true)
  React.useEffect(function () { alive.current = true; return function () { alive.current = false } }, [])

  const patchRow = function (op: string, patch: any) {
    setRows(function (prev: any) {
      const next: any = Object.assign({}, prev)
      next[op] = Object.assign({}, prev[op] || {}, patch, { id: op })
      return next
    })
  }
  const readOne = function (op: string) {
    if (typeof call !== 'function') return Promise.resolve(null)
    return call(VC_MAINTENANCE_PHONES.read, vcMaintenanceReadArgsOf(cwd, op)).then(function (reply: any) {
      if (!alive.current) return null
      setData(function (prev: any) {
        const reads: any = Object.assign({}, prev.reads)
        reads[op] = reply
        return Object.assign({}, prev, { reads: reads })
      })
      return reply
    }).catch(function () { return null })
  }
  const readOverview = function () {
    if (typeof call !== 'function') return
    call(VC_MAINTENANCE_PHONES.read, vcMaintenanceReadArgsOf(cwd, 'overview')).then(function (reply: any) {
      if (!alive.current) return
      setData(function (prev: any) {
        return Object.assign({}, prev, { objects: vcMaintenanceObjectsOf(reply), status: vcMaintenanceStatusOf(reply), at: String(reply && reply.readAtMs ? new Date(reply.readAtMs).toISOString() : '') })
      })
    }).catch(function () {})
  }
  React.useEffect(function () {
    readOverview()
    VC_MAINTENANCE_PAGE_READS.forEach(function (op: string) { readOne(op) })
  }, [])

  const begin = function (op: string) {
    if (typeof call !== 'function') return
    patchRow(op, { busy: true, error: '', reply: null, confirm: null })
    call(VC_MAINTENANCE_PHONES.check, vcMaintenanceCheckArgsOf(cwd, op)).then(function (reply: any) {
      if (!alive.current) return
      const kind: string = vcMaintenanceReplyKindOf(reply)
      if (kind === 'allow') {
        patchRow(op, { busy: false, ticket: vcMaintenanceTicketOf(reply), confirm: vcMaintenanceConfirmOf(reply), backup: vcMaintenanceBackupOf(reply), preview: vcMaintenancePreviewOf(reply) })
        return
      }
      patchRow(op, { busy: false, error: vcMaintenanceFailTextOf(t, reply, vcWriteErrFamilyOf) })
    }).catch(function () { if (alive.current) patchRow(op, { busy: false, error: t('vc.maintenance.fail.network') }) })
  }
  const go = function (op: string) {
    const row: any = rows[op] || {}
    const ticket: any = row.ticket
    if (!ticket || typeof call !== 'function') return
    patchRow(op, { busy: true, confirm: null })
    const requestId: string = vcMaintenanceRequestIdOf(Date.now(), op)
    call(VC_MAINTENANCE_PHONES.write, vcMaintenanceWriteArgsOf(cwd, op, ticket.id, requestId)).then(function (reply: any) {
      if (!alive.current) return
      if (reply && reply.ok === true) { patchRow(op, { busy: false, reply: reply, ticket: null }); readOverview() }
      else patchRow(op, { busy: false, error: vcMaintenanceFailTextOf(t, reply, vcWriteErrFamilyOf) })
    }).catch(function () { if (alive.current) patchRow(op, { busy: false, error: t('vc.maintenance.fail.network') }) })
  }
  const cancel = function (op: string) { patchRow(op, { confirm: null, ticket: null }) }
  const handlers: any = { begin: begin, go: go, cancel: cancel }

  const kids: any[] = [
    h('h3', { key: 'title', 'data-vc-maint-title': '1' }, t('vc.maintenance.pageTitle')),
    h('p', { key: 'hint', className: 'vcs-muted' }, t('vc.maintenance.pageHint')),
    h('section', { key: 'objects', className: 'vcs-card', 'data-vc-maint-objects': '1' },
      h('h4', null, t(vcMaintenanceOpLabelKeyOf('objects'))),
      vcMaintObjectRowsOf(data.objects).map(function (row: any) {
        return h('p', { key: row.id, 'data-vc-maint-object-row': row.id }, t('vc.maintenance.read.' + row.id) + ': ' + row.value)
      }),
      h('p', { key: 'why', className: 'vcs-muted' }, t('vc.maintenance.objects.why'))),
    h('section', { key: 'writes', 'data-vc-maint-writes': '1' },
      VC_MAINTENANCE_PAGE_WRITES.map(function (op: string) {
        if (vcMaintenanceOpMetaOf(op) === null) return null
        return vcMaintActionCardOf(h, t, op, rows[op] || {}, handlers)
      }).filter(function (n: any) { return n !== null })),
    h('section', { key: 'reads', 'data-vc-maint-reads': '1' },
      VC_MAINTENANCE_PAGE_READS.map(function (op: string) {
        const reply: any = (data.reads || {})[op]
        const objects: any = vcMaintenanceObjectsOf(reply)
        const status: any = vcMaintenanceStatusOf(reply)
        const rowsOf: any[] = status ? vcMaintStatusRowsOf(status) : []
        return vcMaintReadCardOf(h, t, op, rowsOf, '')
      })),
  ]
  return h('section', { id: 'vc-maintenance-page', className: 'vcs-page', 'data-vc-maint-page': '1', 'data-vc-maint-danger-count': String(VC_MAINTENANCE_PAGE_DANGER.length) }, kids)
}
