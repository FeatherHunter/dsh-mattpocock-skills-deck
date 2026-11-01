// views/versionControl/vcRewritePage.ts —— 管理 › 维护页「整仓重写」正文（#1750 T15，规格 #1586 能力 5.11）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼进 src/client/index.ts 的 leaf 标记处。
//
// 这一页只画历史重写：filter-branch 的只读说明 → 五张 filter-repo 表单 → 影响预览 → 四段确认卡 →
// 前置整仓备份与长任务进度（可取消）→ 结果与还原步骤。三件事不在本文件重复写：
//   ① 五张表单的校验规则与命令参数（共享层 rewrite-ops.ts，宿主与界面读同一份）；
//   ② 备份点的大小、摘要与还原步骤（共享层 recovery-point.ts）；
//   ③ 预检签票、备份与起长任务的判定（宿主 versionControlRewrite* 三片）。
//
// 本文件是一个 React 组件（props: { t, cwd, call }）：表单、预览、票、任务都留在组件状态里，
// 页面壳只把取词、工作区与发电话的函数递进来。界面一个中文字面量都没有：可见文字全走 t(词条)，
// 词条真源 config/copy/vcrewrite.yaml；门禁直接求值本文件，混进文案就分不清逻辑与文案。

/** 跨叶子与共享层的名字由构建拼进同一个闭包，这里只声明形状（类型检查按单文件跑）。 */
declare const React: any
declare const Tip: any
declare function rewriteFormOf(id: any): any
declare function rewriteFormLabelKeyOf(id: any): string
declare function rewriteDisplayCommandOf(form: any, plan: any): string
declare function backupSummaryOf(point: any): string
declare function backupRestoreStepsOf(point: any): string[]
declare function humanBytesOf(n: any): string
declare function vcWriteErrFamilyOf(reason: any, kind: any): string
declare const VC_TASK_POLL_INTERVAL_MS: number
declare const VC_REWRITE_PHONES: Record<string, string>
declare const VC_REWRITE_FORM_IDS: string[]
declare const VC_REWRITE_FORM_DEFAULT: Record<string, any>
declare function vcRewriteFieldOf(form: any): string
declare function vcRewriteFieldLabelKeyOf(field: any): string
declare function vcRewriteFieldHintKeyOf(field: any): string
declare function vcRewritePlanOf(values: any): any
declare function vcRewritePreviewArgsOf(cwd: any, values: any): any
declare function vcRewriteCheckArgsOf(cwd: any, values: any): any
declare function vcRewriteRunArgsOf(cwd: any, ticketId: any, requestId: any): any
declare function vcRewriteRequestIdOf(nowMs: any, salt: any): string
declare function vcRewriteReplyKindOf(reply: any): string
declare function vcRewriteReasonOf(reply: any): string
declare function vcRewriteTicketOf(reply: any): any
declare function vcRewriteCountRowsOf(counts: any): any[]
declare function vcRewriteBackupOf(reply: any): any
declare function vcRewriteBackupSummaryOf(reply: any): string
declare function vcRewriteRestoreStepsOf(reply: any): string[]
declare function vcRewriteTaskOf(reply: any, taskId: any): any
declare function vcRewriteTaskEndedOf(task: any): boolean
declare function vcRewriteProgressOf(task: any): any
declare function vcRewriteFailTextOf(t: any, reply: any): string

const vcRewritePageTextOf = function (t: any, key: string, vars: any): string {
  if (typeof t !== 'function') return key
  return vars ? t(key, vars) : t(key)
}

/** 五张表单的选择按钮：当前这张标 data-vc-rewrite-form-current，点击只换表单不清其它状态。 */
const vcRewriteFormTabsNode = function (h: any, t: any, o: any): any {
  const kids: any[] = []
  for (let i = 0; i < VC_REWRITE_FORM_IDS.length; i += 1) {
    const id = VC_REWRITE_FORM_IDS[i]
    const current = id === o.form
    kids.push(h('button', {
      key: id, type: 'button', className: 'dsws-btn dsws-hov' + (current ? ' is-primary' : ''),
      'data-vc-rewrite-form': id, 'data-vc-rewrite-form-current': current ? '1' : '0',
      'data-press': 'button', 'data-log': 'vc.rewrite.form', onclick: function () { o.onPick(id) },
    }, vcRewritePageTextOf(t, rewriteFormLabelKeyOf(id), null)))
  }
  return h('div', { className: 'vcs-rewrite-forms', 'data-vc-rewrite-forms': String(VC_REWRITE_FORM_IDS.length) }, kids)
}

/** 当前表单的输入格：多行文本走 textarea，大小阈值走 input；提示语单独一行。 */
const vcRewriteFieldNode = function (h: any, t: any, o: any): any {
  const field = vcRewriteFieldOf(o.form)
  const isText = field === 'paths' || field === 'renames' || field === 'authors' || field === 'replacements'
  const valueKey = field + 'Text'
  const value = field === 'threshold' ? String(o.values.threshold || '') : String(o.values[valueKey] || '')
  const input = isText
    ? h('textarea', {
      key: 'input', rows: 6, className: 'vcs-rewrite-input', 'data-vc-rewrite-field': field, 'data-vc-rewrite-input': field,
      value: value, oninput: function (e: any) { o.onInput(field, e && e.target ? e.target.value : '') },
    })
    : h('input', {
      key: 'input', type: 'text', className: 'vcs-rewrite-input', 'data-vc-rewrite-field': field, 'data-vc-rewrite-input': field,
      value: value, oninput: function (e: any) { o.onInput(field, e && e.target ? e.target.value : '') },
    })
  return h('label', { key: 'field', className: 'vcs-rewrite-field' }, [
    h('span', { key: 'label', className: 'vcs-rewrite-label' }, vcRewritePageTextOf(t, vcRewriteFieldLabelKeyOf(field), null)),
    input,
    h('span', { key: 'hint', className: 'vcs-rewrite-hint', 'data-vc-rewrite-hint': field }, vcRewritePageTextOf(t, vcRewriteFieldHintKeyOf(field), null)),
  ])
}

/** 影响预览：计数逐行画（空值不画），再给命令原文；没预览时整块不出现。 */
const vcRewritePreviewNode = function (h: any, t: any, o: any): any {
  if (!o.preview || o.preview.ok !== true || !o.preview.preview) return null
  const body = o.preview.preview
  const rows = vcRewriteCountRowsOf(body.counts)
  const kids: any[] = [h('p', { key: 'title', className: 'vcs-rewrite-preview-title' }, vcRewritePageTextOf(t, 'vc.rewrite.previewTitle', null))]
  for (let i = 0; i < rows.length; i += 1) {
    kids.push(h('p', {
      key: 'row-' + i, className: 'vcs-rewrite-count', 'data-vc-rewrite-count': rows[i].key,
      'data-vc-rewrite-count-value': rows[i].value,
    }, rows[i].from
      ? vcRewritePageTextOf(t, rows[i].key, { from: rows[i].from, n: rows[i].value })
      : vcRewritePageTextOf(t, rows[i].key, { n: rows[i].value })))
  }
  kids.push(h('p', { key: 'command', className: 'vcs-rewrite-command', 'data-vc-rewrite-command': '1' }, vcRewritePageTextOf(t, 'vc.rewrite.command', { command: String(body.command || '') })))
  return h('div', { className: 'vcs-rewrite-preview', 'data-vc-rewrite-preview': '1' }, kids)
}

/** 预检判定那一行：允许 / 需要确认 / 不放行，以及理由（理由走固定词条表，不印标识符）。 */
const vcRewriteVerdictNode = function (h: any, t: any, check: any): any {
  if (!check) return null
  const kind = vcRewriteReplyKindOf(check)
  const reason = vcRewriteReasonOf(check)
  const kids: any[] = [h('p', { key: 'verdict', className: 'vcs-rewrite-verdict', 'data-vc-rewrite-verdict': kind, 'data-vc-rewrite-reason': reason }, vcRewritePageTextOf(t, 'vc.rewrite.verdict.' + (kind === 'checked' ? 'allow' : kind), null))]
  if (reason) kids.push(h('p', { key: 'reason', className: 'vcs-rewrite-reason' }, vcRewriteFailTextOf(t, check)))
  return h('div', { className: 'vcs-rewrite-check', 'data-vc-rewrite-check': kind }, kids)
}

/** 四段确认卡：做什么 / 不做什么 / 可不可逆 / 怎么继续，再加备份在哪、多大与还原步骤。 */
const vcRewriteConfirmNode = function (h: any, t: any, o: any): any {
  const confirm = o.check && o.check.confirm
  if (!confirm) return null
  const segs = [['what', confirm.what], ['wont', confirm.wont], ['reversible', [String(confirm.reversible === true ? vcRewritePageTextOf(t, 'vc.rewrite.confirm.reversibleYes', null) : vcRewritePageTextOf(t, 'vc.rewrite.confirm.reversibleNo', null))]], ['verb', [String(confirm.verb || '')]]]
  const kids: any[] = [h('p', { key: 'title', className: 'vcs-rewrite-confirm-title' }, vcRewritePageTextOf(t, 'vc.rewrite.confirm.title', null))]
  for (let i = 0; i < segs.length; i += 1) {
    const lines = Array.isArray(segs[i][1]) ? segs[i][1] : []
    const items: any[] = []
    for (let k = 0; k < lines.length; k += 1) items.push(h('p', { key: 'l-' + k, className: 'vcs-rewrite-confirm-line' }, String(lines[k])))
    kids.push(h('div', { key: 'seg-' + segs[i][0], className: 'vcs-rewrite-confirm-seg', 'data-vc-rewrite-confirm-seg': segs[i][0] }, items))
  }
  const backup = vcRewriteBackupOf(o.check)
  if (backup) {
    kids.push(h('p', {
      key: 'backup', className: 'vcs-rewrite-backup', 'data-vc-rewrite-backup': String(backup.kind || ''),
      'data-vc-rewrite-backup-path': String(backup.path || ''), 'data-vc-rewrite-backup-size': String(backup.estimateBytes === undefined ? '' : backup.estimateBytes),
    }, vcRewritePageTextOf(t, 'vc.rewrite.confirm.backup', { path: String(backup.path || ''), size: humanBytesOf(backup.estimateBytes) })))
  }
  const steps = vcRewriteRestoreStepsOf(o.check)
  if (steps.length > 0) {
    const lis: any[] = []
    for (let i = 0; i < steps.length; i += 1) lis.push(h('li', { key: 's-' + i }, String(steps[i])))
    kids.push(h('div', { key: 'restore', className: 'vcs-rewrite-restore', 'data-vc-rewrite-restore': String(steps.length) }, [
      h('p', { key: 'title' }, vcRewritePageTextOf(t, 'vc.rewrite.confirm.restoreTitle', null)),
      h('p', { key: 'note' }, vcRewritePageTextOf(t, 'vc.rewrite.confirm.restoreNote', null)),
      h('ol', { key: 'steps' }, lis),
    ]))
  }
  kids.push(h('div', { key: 'actions', className: 'vcs-rewrite-confirm-actions' }, [
    h('button', { key: 'cancel', type: 'button', className: 'dsws-btn dsws-hov', 'data-vc-rewrite-confirm-cancel': '1', 'data-press': 'button', 'data-log': 'vc.rewrite.confirm.cancel', 'data-focus-default': 'cancel', onclick: o.onCancel }, vcRewritePageTextOf(t, 'vc.rewrite.confirm.cancel', null)),
    h(Tip, { key: 'go-tip', content: vcRewritePageTextOf(t, 'vc.rewrite.confirm.goTip', null) }, h('button', { key: 'go', type: 'button', className: 'dsws-btn dsws-hov is-danger', 'data-vc-rewrite-confirm-go': '1', 'data-press': 'button', 'data-log': 'vc.rewrite.confirm.go', onclick: o.onConfirm }, vcRewritePageTextOf(t, 'vc.rewrite.confirm.go', null))),
  ]))
  return h('div', { className: 'vcs-rewrite-confirm', 'data-vc-rewrite-confirm': '1' }, kids)
}

/** 长任务进度：真实百分比或「无法确定」，加阶段与在途取消按钮。 */
const vcRewriteTaskNode = function (h: any, t: any, o: any): any {
  const task = o.task || {}
  const p = vcRewriteProgressOf(task)
  const kids: any[] = [
    h('p', { key: 'title' }, vcRewritePageTextOf(t, 'vc.rewrite.task.title', null)),
    h('p', {
      key: 'state', className: 'vcs-rewrite-task-state', 'data-vc-rewrite-task': String(task.taskId || ''), 'data-vc-rewrite-task-state': String(task.state || ''),
      'data-vc-rewrite-task-percent': p.percent === null ? '' : String(p.percent),
    }, p.percent === null ? vcRewritePageTextOf(t, 'vc.rewrite.task.uncertain', null) : vcRewritePageTextOf(t, 'vc.rewrite.task.percent', { n: String(p.percent) })),
  ]
  if (p.phase) kids.push(h('p', { key: 'phase', className: 'vcs-rewrite-task-phase', 'data-vc-rewrite-task-phase': p.phase }, vcRewritePageTextOf(t, 'vc.rewrite.task.phase', { phase: p.phase })))
  if (!vcRewriteTaskEndedOf(task)) {
    kids.push(h('button', { key: 'cancel', type: 'button', className: 'dsws-btn dsws-hov', 'data-vc-rewrite-task-cancel': '1', 'data-press': 'button', 'data-log': 'vc.rewrite.task.cancel', onclick: o.onCancel }, vcRewritePageTextOf(t, 'vc.rewrite.task.cancel', null)))
  } else {
    kids.push(h('p', { key: 'done', className: 'vcs-rewrite-task-conclusion', 'data-vc-rewrite-task-conclusion': String(task.conclusion || '') }, vcRewritePageTextOf(t, 'vc.rewrite.conclusion.' + String(task.conclusion || 'failed'), null)))
    if (task.residual) kids.push(h('p', { key: 'residual', className: 'vcs-rewrite-task-residual', 'data-vc-rewrite-task-residual': '1' }, vcRewritePageTextOf(t, 'vc.rewrite.task.residual', { residual: String(task.residual) })))
  }
  return h('div', { className: 'vcs-rewrite-task', 'data-vc-rewrite-task-box': '1' }, kids)
}

/** 执行结果：成功给备份摘要与还原步骤；失败给原因与重试。 */
const vcRewriteResultNode = function (h: any, t: any, o: any): any {
  const result = o.result
  if (!result) return null
  const ok = result.ok === true
  const kids: any[] = [h('p', { key: 'title', className: 'vcs-rewrite-result-title' }, vcRewritePageTextOf(t, ok ? 'vc.rewrite.result.okTitle' : 'vc.rewrite.result.failTitle', null))]
  if (ok) {
    const summary = vcRewriteBackupSummaryOf(result)
    if (summary) kids.push(h('p', { key: 'backup', className: 'vcs-rewrite-backup-summary', 'data-vc-rewrite-backup-summary': '1' }, vcRewritePageTextOf(t, 'vc.rewrite.result.backup', { summary: summary })))
    const steps = vcRewriteRestoreStepsOf(result)
    if (steps.length > 0) {
      const lis: any[] = []
      for (let i = 0; i < steps.length; i += 1) lis.push(h('li', { key: 's-' + i }, String(steps[i])))
      kids.push(h('div', { key: 'restore', className: 'vcs-rewrite-restore', 'data-vc-rewrite-result-restore': String(steps.length) }, [
        h('p', { key: 'note' }, vcRewritePageTextOf(t, 'vc.rewrite.confirm.restoreNote', null)),
        h('ol', { key: 'steps' }, lis),
      ]))
    }
  } else {
    kids.push(h('p', { key: 'fail', className: 'vcs-rewrite-fail', 'data-vc-rewrite-fail': vcRewriteReasonOf(result) }, vcRewriteFailTextOf(t, result)))
    kids.push(h('button', { key: 'retry', type: 'button', className: 'dsws-btn dsws-hov', 'data-vc-rewrite-retry': '1', 'data-press': 'button', 'data-log': 'vc.rewrite.retry', onclick: o.onRetry }, vcRewritePageTextOf(t, 'vc.rewrite.result.retry', null)))
  }
  return h('div', { className: 'vcs-rewrite-result', 'data-vc-rewrite-result': ok ? '1' : '0' }, kids)
}

/**
 * 维护页整仓重写那一块。props：{ t, cwd, call }。
 * 刷新纪律：进入页面不自动读；点「影响预览」才读；点「开始重写」才签票；确认后才备份并起任务；
 * 任务在途按长任务通道的节拍查询，结束即停。
 */
export const vcRewritePageNode = function (props: any): any {
  const h = React.createElement
  const t = props && props.t
  const cwd = String((props && props.cwd) || '')
  const call = (props && typeof props.call === 'function') ? props.call : function () { return Promise.reject(new Error('no-call')) }
  const [values, setValues] = React.useState(VC_REWRITE_FORM_DEFAULT)
  const [plan, setPlan] = React.useState(vcRewritePlanOf(VC_REWRITE_FORM_DEFAULT))
  const [preview, setPreview] = React.useState(null)
  const [check, setCheck] = React.useState(null)
  const [requestId, setRequestId] = React.useState('')
  const [result, setResult] = React.useState(null)
  const [taskId, setTaskId] = React.useState('')
  const [task, setTask] = React.useState(null)
  const [error, setError] = React.useState('')
  const aliveRef = React.useRef(true)
  React.useEffect(function () { return function () { aliveRef.current = false } }, [])
  React.useEffect(function () {
    if (!taskId || !aliveRef.current) return
    const timer = setInterval(function () {
      call(VC_REWRITE_PHONES.query, {}).then(function (reply: any) {
        if (!aliveRef.current) return
        const found = vcRewriteTaskOf(reply, taskId)
        if (found) setTask(found)
      }).catch(function () {})
    }, VC_TASK_POLL_INTERVAL_MS)
    return function () { clearInterval(timer) }
  }, [taskId])
  const onChange = function (field: any, value: any) {
    const key = field === 'threshold' ? 'threshold' : field + 'Text'
    const next = Object.assign({}, values, { form: values.form })
    next[key] = value
    setValues(next)
    setPreview(null); setCheck(null); setResult(null); setError('')
    setPlan(vcRewritePlanOf(next))
  }
  const onPick = function (id: any) {
    const next = Object.assign({}, values, { form: id })
    setValues(next)
    setPreview(null); setCheck(null); setResult(null); setTask(null); setTaskId(''); setError('')
    setPlan(vcRewritePlanOf(next))
  }
  const onPreview = function () {
    if (!plan) { setError(vcRewritePageTextOf(t, 'vc.rewrite.planInvalid', null)); return }
    setError(''); setPreview(null); setCheck(null); setResult(null)
    call(VC_REWRITE_PHONES.preview, vcRewritePreviewArgsOf(cwd, values)).then(function (reply: any) {
      if (!aliveRef.current) return
      if (reply && reply.ok === true) setPreview(reply)
      else setError(vcRewriteFailTextOf(t, reply))
    }).catch(function (e: any) { if (aliveRef.current) setError(String((e && e.message) || e)) })
  }
  const onBegin = function () {
    if (!plan) { setError(vcRewritePageTextOf(t, 'vc.rewrite.planInvalid', null)); return }
    setError(''); setCheck(null); setResult(null)
    call(VC_REWRITE_PHONES.check, vcRewriteCheckArgsOf(cwd, values)).then(function (reply: any) {
      if (!aliveRef.current) return
      if (reply && reply.ok === true && reply.ticket) {
        setCheck(reply)
        setRequestId(vcRewriteRequestIdOf(Date.now(), cwd + String(values.form || '')))
      } else setError(vcRewriteFailTextOf(t, reply))
    }).catch(function (e: any) { if (aliveRef.current) setError(String((e && e.message) || e)) })
  }
  const onConfirm = function () {
    const ticket = vcRewriteTicketOf(check)
    if (!ticket) return
    setError('')
    call(VC_REWRITE_PHONES.run, vcRewriteRunArgsOf(cwd, ticket.id, requestId)).then(function (reply: any) {
      if (!aliveRef.current) return
      if (reply && reply.ok === true && reply.task) { setTaskId(String(reply.task.taskId || '')); setResult(reply) }
      else setResult(reply)
    }).catch(function (e: any) { if (aliveRef.current) setError(String((e && e.message) || e)) })
  }
  const onCancelTask = function () {
    if (!taskId) return
    call(VC_REWRITE_PHONES.cancel, { taskId: taskId }).then(function (reply: any) {
      if (!aliveRef.current) return
      const found = vcRewriteTaskOf({ tasks: (reply && reply.task) ? [reply.task] : [] }, taskId)
      if (found) setTask(found)
    }).catch(function () {})
  }
  const children: any[] = []
  children.push(h('h3', { key: 'title', className: 'vcs-rewrite-title', 'data-vc-rewrite-title': '5.11' }, vcRewritePageTextOf(t, 'vc.rewrite.pageTitle', null)))
  children.push(h('p', { key: 'hint', className: 'vcs-rewrite-hint' }, vcRewritePageTextOf(t, 'vc.rewrite.hint', null)))
  children.push(h('div', { key: 'readonly', className: 'vcs-rewrite-filter-branch', 'data-vc-rewrite-filter-branch': 'readonly' }, [
    h('p', { key: 'title' }, vcRewritePageTextOf(t, 'vc.rewrite.filterBranch.title', null)),
    h('p', { key: 'command', className: 'vcs-rewrite-filter-command', 'data-vc-rewrite-filter-branch-command': 'git filter-branch' }, vcRewritePageTextOf(t, 'vc.rewrite.filterBranch.command', null)),
    h('p', { key: 'note' }, vcRewritePageTextOf(t, 'vc.rewrite.filterBranch.note', null)),
  ]))
  children.push(Object.assign({}, vcRewriteFormTabsNode(h, t, { form: String(values.form || ''), onPick: onPick }), { key: 'forms' }))
  children.push(Object.assign({}, vcRewriteFieldNode(h, t, { form: String(values.form || ''), values: values, onInput: onChange }), { key: 'field' }))
  children.push(h('button', {
    key: 'preview', type: 'button', className: 'dsws-btn dsws-hov', 'data-vc-rewrite-preview': '1',
    'data-press': 'button', 'data-log': 'vc.rewrite.preview', disabled: !plan, onclick: onPreview,
  }, vcRewritePageTextOf(t, 'vc.rewrite.preview', null)))
  const previewNode = vcRewritePreviewNode(h, t, { preview: preview })
  if (previewNode) children.push(Object.assign({}, previewNode, { key: 'previewed' }))
  if (error) children.push(h('p', { key: 'error', className: 'vcs-rewrite-error', 'data-vc-rewrite-error': '1' }, error))
  if (preview) children.push(h('button', { key: 'begin', type: 'button', className: 'dsws-btn dsws-hov is-danger', 'data-vc-rewrite-begin': '1', 'data-press': 'button', 'data-log': 'vc.rewrite.begin', onclick: onBegin }, vcRewritePageTextOf(t, 'vc.rewrite.begin', null)))
  const verdictNode = vcRewriteVerdictNode(h, t, check)
  if (verdictNode) children.push(Object.assign({}, verdictNode, { key: 'verdict' }))
  const confirmNode = vcRewriteConfirmNode(h, t, { check: check, onConfirm: onConfirm, onCancel: function () { setCheck(null) } })
  if (confirmNode) children.push(Object.assign({}, confirmNode, { key: 'confirm' }))
  if (task) children.push(Object.assign({}, vcRewriteTaskNode(h, t, { task: task, onCancel: onCancelTask }), { key: 'task' }))
  const resultNode = vcRewriteResultNode(h, t, { result: result, onRetry: onPreview })
  if (resultNode) children.push(Object.assign({}, resultNode, { key: 'result' }))
  return h('section', { id: 'vc-rewrite-page', className: 'vcs-rewrite', 'data-vc-rewrite-page': '1', 'data-vc-rewrite-form': String(values.form || ''), 'data-vc-rewrite-plan': plan ? '1' : '0' }, children)
}
