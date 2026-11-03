// views/versionControl/vcMaintenancePage.ts —— 管理 › 维护页正文（#1758 T22，规格 #1586 域 11 的 11.4–11.11；#1843 阶段 4 按定稿原型重做）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼进 src/client/index.ts 的 leaf 标记处。
//
// 这一页只画「管理·维护」的四块内容：
//   ① 11.4 的对象读数常驻：六格事实全部来自宿主 overview 回包（git count-objects -v 的真读数）；
//   ② 11.5 垃圾回收与 11.8 自动维护：读数 → 预检签 120 秒票 → 四段确认卡 → 凭票执行（走长任务通道）；
//   ③ 11.7 / 11.9 / 11.10 / 11.11 的只读卡：只展示读到的形状，不画触发按钮——规格要求这几件事由 git 自己维持；
//   ④ 危险区单独一块，只收两类不可逆动作：11.6 清除不可达对象（预览 + 备份计划 + 四段确认卡）
//      与 5.11 全库重写（filter-repo 五张表单的入口卡）；每一条都常驻「丢什么 / 可逆性 / 恢复路径 /
//      备份前置」四段，不靠点开确认卡才看得见。
//
// 页头（页面标题与导语）由页面壳 vcShellPages.ts 统一画，本文件只画正文分区；分区外形走共享原语
// vcPageSectionNode / vcPageFactGridNode / vcPageObjRowNode，样式类名统一由 vcPageStyles.ts 给，页面不自绘。
// 判定规则的真源在共享层 maintenance-ops.ts，本文件只做「把界面选择翻成电话参数、把回包翻成界面状态」；
// 可见文字全部走 t(词条)，词条真源 config/copy/vcmaintenance.yaml，界面一个中文字面量都没有。
//
// 原型里「工作区（N 棵）」「引用总数 / 本地分支」两格今天没有读数来源（宿主只回对象与体积那几项），
// 这里不编数、也不画假格子；等宿主读数扩展后再补。段内的动作条数按真实动作逐条画：11.8 的四个动作
// 各有独立的确认流程与执行通道，所以拆成四张卡，而不是像原型那样并成一张演示卡。

/** 跨叶子与共享层的名字由构建拼进同一个闭包，这里只声明形状（类型检查按单文件跑）。 */
declare const React: any
declare const Tip: any
declare const VC_TASK_POLL_INTERVAL_MS: number
declare function vcWriteErrFamilyOf(reason: any, kind: any): string
declare const VC_MAINTENANCE_PHONES: Record<string, string>
declare const VC_MAINTENANCE_ACTIONS: any[]
declare const VC_MAINTENANCE_DANGER_IDS: string[]
declare const VC_MAINTENANCE_DANGER_FORMS: any[]
declare function vcMaintenanceCamelOf(id: any): string
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
declare function vcPageSectionNode(h: any, t: any, options: any): any
declare function vcPageFactGridNode(h: any, t: any, options: any): any
declare function vcPageObjRowNode(h: any, t: any, options: any): any

/** 真源标识：门禁按这一行找本文件，改路径要一起改门禁。 */
export const VC_MAINTENANCE_PAGE_BODY_SOURCE = 'src/client/views/versionControl/vcMaintenancePage.ts'

/** 维护页要画的写动作与只读卡片；门禁据此核对 11.5–11.11 一条不少、也没有多出别的动作。 */
export const VC_MAINTENANCE_PAGE_WRITES: string[] = ['gc', 'maintenance-run', 'maintenance-enable', 'maintenance-disable']
export const VC_MAINTENANCE_PAGE_READS: string[] = ['repack', 'commit-graph', 'multi-pack-index', 'pack-refs', 'maintenance-status']
export const VC_MAINTENANCE_PAGE_DANGER: string[] = VC_MAINTENANCE_DANGER_IDS
export const VC_MAINTENANCE_PAGE_DANGER_FORMS: any[] = VC_MAINTENANCE_DANGER_FORMS

/**
 * 「整理动作」段的展示顺序，照原型的编号顺序：11.5 → 11.7 → 11.8 → 11.9 → 11.10 → 11.11。
 * 11.8 的四条（状态 / 立刻跑 / 打开 / 关闭）排在同一个位置，因为它们讲的是同一套自动维护机制；
 * 这个数组决定卡片先后，不决定「哪些动作存在」——存在与否仍由上面两个导出常量与共享层账本决定。
 */
const vcMaintActionOrderOf = ['gc', 'repack', 'maintenance-status', 'maintenance-run', 'maintenance-enable', 'maintenance-disable', 'commit-graph', 'multi-pack-index', 'pack-refs']

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

/**
 * 对象读数六格：数值全部来自宿主 overview 回包，单位换算交给 humanBytesOf，页面不自己拼规则。
 * 读不到时显示破折号而不是 0：把「还没读到」画成「一个对象也没有」会让人误判仓库状态。
 * 可回收对象大于 0 用警示色，等于 0 用弱化色——这是原型里唯一有语气的一格，表示「有东西可清」。
 */
const vcMaintObjectFactsOf = function (t: any, objects: any): any[] {
  if (!objects) {
    return [
      { key: 'vc.maintenance.fact.loose', value: '—', tone: 'muted' },
      { key: 'vc.maintenance.fact.inPack', value: '—', tone: 'muted' },
      { key: 'vc.maintenance.fact.prune', value: '—', tone: 'muted' },
      { key: 'vc.maintenance.fact.garbage', value: '—', tone: 'muted' },
      { key: 'vc.maintenance.fact.repoSize', value: '—', tone: 'muted' },
      { key: 'vc.maintenance.fact.packSize', value: '—', tone: 'muted' },
    ]
  }
  const loose: number = Number(objects.looseCount || 0)
  const inPack: number = Number(objects.inPack || 0)
  const packs: number = Number(objects.packs || 0)
  const prune: number = Number(objects.prunePackable || 0)
  const garbage: number = Number(objects.garbage || 0)
  return [
    { key: 'vc.maintenance.fact.loose', value: t('vc.maintenance.fact.looseValue', { count: String(loose), size: humanBytesOf(objects.looseSizeBytes || 0) }) },
    { key: 'vc.maintenance.fact.inPack', value: t('vc.maintenance.fact.inPackValue', { count: String(inPack), packs: String(packs), size: humanBytesOf(objects.packSizeBytes || 0) }) },
    { key: 'vc.maintenance.fact.prune', value: t('vc.maintenance.fact.pruneValue', { count: String(prune) }), tone: prune > 0 ? 'warn' : 'muted' },
    { key: 'vc.maintenance.fact.garbage', value: t('vc.maintenance.fact.garbageValue', { count: String(garbage) }) },
    { key: 'vc.maintenance.fact.repoSize', value: humanBytesOf(objects.repoSizeBytes || 0) },
    { key: 'vc.maintenance.fact.packSize', value: humanBytesOf(objects.packSizeBytes || 0) },
  ]
}

/** 类型徽章：只决定 tone 类名（is-write / is-read / is-danger），文字走词表，不在页面里写死说法。 */
const vcMaintBadgeOf = function (h: any, t: any, tone: string, labelKey: string) {
  return h('span', { key: 'badge', className: 'badge is-' + tone }, t(labelKey))
}

/**
 * 卡片头：左边标题、右边类型徽章。标题上的数据锚点名由调用方给，因为写卡挂 data-vc-maint-card、
 * 只读卡挂 data-vc-maint-read-title，两套锚点名字不同，不能在辅助函数里猜。
 */
const vcMaintCardHeadOf = function (h: any, t: any, labelKey: any, anchorName: any, anchorValue: any, tone: string, badgeKey: string) {
  const titleProps: any = { key: 'title', className: 'page-card-title' }
  if (anchorName) titleProps[String(anchorName)] = anchorValue
  return h('div', { key: 'head', className: 'page-card-head' }, [
    h('h4', titleProps, t(labelKey)),
    vcMaintBadgeOf(h, t, tone, badgeKey),
  ])
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

/**
 * 危险区一条的四段固定事实：丢什么 / 可逆性 / 恢复路径 / 备份前置。
 * 文案前缀由调用方给（prune 与 rewrite 两族键名不同），四条锚点名固定，门禁按它们检查首帧结构。
 */
const vcMaintDangerFactsOf = function (h: any, t: any, lossKey: string, prefix: string): any[] {
  return [
    h('p', { key: 'loss', className: 'page-note', 'data-vc-maint-danger-fact': 'loss' }, t(lossKey)),
    h('p', { key: 'reversible', className: 'page-note', 'data-vc-maint-danger-fact': 'reversible' }, t(prefix + 'reversible')),
    h('p', { key: 'recovery', className: 'page-note', 'data-vc-maint-danger-fact': 'recovery' }, t(prefix + 'recovery')),
    h('p', { key: 'backup', className: 'page-note', 'data-vc-maint-danger-fact': 'backup' }, t(prefix + 'backup')),
  ]
}

/**
 * 一张写动作卡：标题 + 类型徽章 + 命令行 + 一句说明，右侧是主入口按钮；签票成功后把确认卡贴在同一张卡里，
 * 执行完成后把结果条贴在下面。危险卡额外常驻四段后果，并把红边与毁徽章画出来，让人不点开也知道代价。
 * 所有状态都画在同一张卡内，读者不用换位置找确认与结果——这是和维护页旧版一致的交互约定。
 */
const vcMaintWriteCardOf = function (h: any, t: any, op: any, state: any, handlers: any, options: any) {
  const opts: any = options || {}
  const meta: any = vcMaintenanceOpMetaOf(op)
  const dangerous: boolean = opts.danger === true
  const noteKey: string = String(opts.noteKey || ('vc.maintenance.op.tip.' + op))
  const mainKids: any[] = [
    vcMaintCardHeadOf(h, t, vcMaintenanceOpLabelKeyOf(op), 'data-vc-maint-card', op, dangerous ? 'danger' : 'write', dangerous ? 'vc.maintenance.badge.danger' : 'vc.maintenance.badge.write'),
  ]
  mainKids.push(h('p', { key: 'command', className: 'page-card-sub' }, h('code', { className: 'cmd-line' }, String((meta && meta.command) || ''))))
  mainKids.push(h('p', { key: 'note', className: 'page-card-sub' }, t(noteKey)))
  // 四段后果直接排在卡内（不再包一层没有样式定义的容器，样式类名只认 vcPageStyles.ts 里登记过的那批）。
  if (opts.facts) mainKids.push.apply(mainKids, opts.facts)
  const sideKids: any[] = []
  if (state.busy === true) sideKids.push(h('p', { key: 'busy', className: 'page-note', 'data-vc-maint-busy': op }, t('vc.maintenance.busy')))
  else if (!state.confirm) sideKids.push(Object.assign({}, vcMaintButtonOf(h, t, opts.buttonLabelKey || vcMaintenanceOpVerbKeyOf(op), 'vc.maint.begin.' + op, false, function () { handlers.begin(op) }, noteKey), { key: 'begin' }))
  const cardKids: any[] = [vcPageObjRowNode(h, t, { main: mainKids, side: sideKids, danger: dangerous })]
  if (state.confirm) cardKids.push(Object.assign({}, vcMaintConfirmOf(h, t, op, state.confirm, state.backup, state.preview, function () { handlers.go(op) }, function () { handlers.cancel(op) }), { key: 'confirm' }))
  const result = vcMaintResultOf(h, t, op, Object.assign({}, state, { onRetry: function () { handlers.begin(op) } }))
  if (result) cardKids.push(Object.assign({}, result, { key: 'result' }))
  const cardProps: any = { key: op, className: 'page-card' + (dangerous ? ' is-danger' : ''), 'data-vc-maint-action': op, 'data-vc-maint-kind': 'write', 'data-vc-maint-danger': dangerous ? '1' : '0' }
  if (opts.entry) cardProps['data-vc-maint-danger-entry'] = opts.entry
  return h('div', cardProps, cardKids)
}

/**
 * 危险区里的 prune 条目：复用写动作卡（含预览、确认卡、备份计划与执行结果），
 * 只把按钮文案换成「核对后果」、给卡加危险外形，并常驻四段后果；它仍然走同一套 begin('prune') 确认流程。
 */
const vcMaintDangerCardOf = function (h: any, t: any, op: any, state: any, handlers: any) {
  return vcMaintWriteCardOf(h, t, op, state, handlers, {
    danger: true,
    entry: op,
    buttonLabelKey: 'vc.maintenance.danger.check',
    facts: vcMaintDangerFactsOf(h, t, 'vc.maintenance.danger.prune.loss', 'vc.maintenance.danger.prune.'),
  })
}

/**
 * 危险区里的重写条目：只展示后果与命令原文，不画触发按钮——真实执行在页尾的重写表单块里填输入并预检，
 * 面板不在这里替人执行整仓重写。四段后果与 prune 同构，loss 按表单 id 取各自的键。
 */
const vcMaintRewriteDangerOf = function (h: any, t: any, form: any) {
  const lossKey: string = 'vc.maintenance.danger.rewrite.loss.' + vcMaintenanceCamelOf(form.id)
  const titleProps: any = { key: 'title', className: 'page-card-title', 'data-vc-maint-danger-form-title': form.id }
  return h('div', { key: form.id, className: 'page-card is-danger', 'data-vc-maint-danger-form': form.id }, [
    h('div', { key: 'head', className: 'page-card-head' }, [
      h('h5', titleProps, t(form.labelKey)),
      vcMaintBadgeOf(h, t, 'danger', 'vc.maintenance.badge.danger'),
    ]),
    h('p', { key: 'command', className: 'page-card-sub' }, h('code', { className: 'cmd-line' }, String(form.command || ''))),
  ].concat(vcMaintDangerFactsOf(h, t, lossKey, 'vc.maintenance.danger.rewrite.')))
}

/** 只读卡的说明键：每类只读项一句「它读什么、为什么不在这里动手」，与原型逐行说明一一对应。 */
const vcMaintReadNoteKeyOf = function (op: any): string {
  return 'vc.maintenance.card.note.' + vcMaintenanceCamelOf(String(op || ''))
}

/** 只读行里的登记状态值过词表：回包给的是 yes / no 两个机器值，界面要显示成词表里的说法。 */
const vcMaintReadValueOf = function (t: any, row: any): string {
  const value: string = String(row.value === undefined || row.value === null ? '' : row.value)
  if (value === 'yes' || value === 'no') return t('vc.maintenance.status.' + value)
  return value
}

/**
 * 一张只读卡：标题 + 只读徽章 + 命令行 + 说明，下面是读数或空态，最后是读数时间；没有触发按钮。
 * 读数时间只在真的读到过之后才显示，避免首帧把「还没读」写成「刚刚读过」。
 */
const vcMaintReadCardOf = function (h: any, t: any, op: any, data: any, reply: any) {
  const meta: any = vcMaintenanceOpMetaOf(op)
  const status: any = vcMaintenanceStatusOf(reply) || (op === 'maintenance-status' && data ? data.status : null)
  const rows: any[] = status ? vcMaintStatusRowsOf(status) : []
  const readAt: string = reply && reply.readAtMs ? new Date(reply.readAtMs).toISOString() : (op === 'maintenance-status' && data ? String(data.at || '') : '')
  const mainKids: any[] = [
    vcMaintCardHeadOf(h, t, vcMaintenanceOpLabelKeyOf(op), 'data-vc-maint-read-title', op, 'read', 'vc.maintenance.badge.read'),
  ]
  mainKids.push(h('p', { key: 'command', className: 'page-card-sub' }, h('code', { className: 'cmd-line' }, String((meta && meta.command) || ''))))
  mainKids.push(h('p', { key: 'note', className: 'page-card-sub' }, t(vcMaintReadNoteKeyOf(op))))
  const kids: any[] = [vcPageObjRowNode(h, t, { main: mainKids, side: [], danger: false })]
  if (rows.length === 0) kids.push(h('p', { key: 'empty', className: 'page-note', 'data-vc-maint-read-empty': op }, t('vc.maintenance.card.readEmpty')))
  else rows.forEach(function (row: any) {
    kids.push(h('p', { key: 'row-' + row.id, className: 'page-note', 'data-vc-maint-read-row': op + '.' + row.id }, t('vc.maintenance.read.' + row.id) + ': ' + vcMaintReadValueOf(t, row)))
  })
  if (readAt) kids.push(h('p', { key: 'readAt', className: 'page-note', 'data-vc-maint-read-at': op }, t('vc.maintenance.readAt', { at: readAt })))
  return h('div', { key: op, className: 'page-card', 'data-vc-maint-read-card': op }, kids)
}

/**
 * 页面主体：三段竖排——仓库体量（事实网格）、整理动作（写卡与只读卡同段）、危险区（不可逆动作单独一段）。
 * 页头由壳统一画，这里不再写页面标题与导语；分区标题、条数与说明都交 vcPageSectionNode 画。
 */
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

  const stack: any[] = []
  // 仓库体量：说明一行 + 六格事实。数字随真实仓库演化，页面只负责把宿主读数翻成词表句子。
  stack.push(vcPageSectionNode(h, t, {
    title: 'vc.maintenance.section.objects.title',
    note: 'vc.maintenance.section.objects.note',
    children: [vcPageFactGridNode(h, t, { facts: vcMaintObjectFactsOf(t, data.objects) })],
  }))
  // 整理动作：写动作与只读项按原型顺序排在同一段；只读项不画触发按钮，只展示读到的形状。
  const actionCards: any[] = []
  vcMaintActionOrderOf.forEach(function (op: string) {
    if (vcMaintenanceOpMetaOf(op) === null) return
    if (VC_MAINTENANCE_PAGE_WRITES.indexOf(op) >= 0) actionCards.push(vcMaintWriteCardOf(h, t, op, rows[op] || {}, handlers, null))
    else actionCards.push(vcMaintReadCardOf(h, t, op, data, (data.reads || {})[op]))
  })
  stack.push(vcPageSectionNode(h, t, {
    title: 'vc.maintenance.section.actions.title',
    count: actionCards.length,
    note: 'vc.maintenance.section.actions.note',
    children: actionCards,
  }))
  // 危险区：prune 卡 → 五张重写表单卡 → 跳去重写表单的链接。这些结构首帧就画出来，不依赖读数完成。
  const dangerKids: any[] = []
  VC_MAINTENANCE_PAGE_DANGER.forEach(function (op: string) {
    if (vcMaintenanceOpMetaOf(op) === null) return
    dangerKids.push(vcMaintDangerCardOf(h, t, op, rows[op] || {}, handlers))
  })
  VC_MAINTENANCE_PAGE_DANGER_FORMS.forEach(function (form: any) {
    if (!form || !form.id) return
    dangerKids.push(vcMaintRewriteDangerOf(h, t, form))
  })
  dangerKids.push(h('p', { key: 'goto', className: 'page-note' },
    h('a', { href: '#vc-rewrite-page', 'data-vc-maint-danger-jump': '5.11' }, t('vc.maintenance.danger.rewrite.goto'))))
  // 段容器额外挂三枚旧锚点（门禁与宿主按渲染树找它们）：分区外形由共享原语画，
  // 但危险区仍要能被旧的 data-vc-maint-danger-* 选择器认出，所以标记留在这一层容器上。
  stack.push(h('div', {
    key: 'danger',
    'data-vc-maint-danger': '1',
    'data-vc-maint-danger-section': '1',
    'data-vc-maint-danger-title': '1',
    'data-vc-maint-danger-boundary': '1',
  }, vcPageSectionNode(h, t, {
    danger: true,
    title: 'vc.maintenance.section.danger.title',
    count: VC_MAINTENANCE_PAGE_DANGER.length + VC_MAINTENANCE_PAGE_DANGER_FORMS.length,
    note: 'vc.maintenance.section.danger.note',
    children: dangerKids,
  })))

  return h('section', { id: 'vc-maintenance-page', className: 'vcs-page', 'data-vc-maint-page': '1', 'data-vc-maint-danger-count': String(VC_MAINTENANCE_PAGE_DANGER.length) },
    h('div', { key: 'stack', className: 'page-stack' }, stack))
}
