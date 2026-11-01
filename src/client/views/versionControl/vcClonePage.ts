// views/versionControl/vcClonePage.ts —— 迁移与备份 › 克隆向导（#1756 T20，规格 #1586 能力 8.16）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处。
//
// 这一页只画克隆向导：填地址与选项 → 预检签票 → 凭票执行（走长任务通道）→ 看进度、可取消 →
// 取消或失败后给残留目录说明与清理入口。三件事不在本文件重复写：
//   ① 地址与选项怎么校验（clone-options.ts，宿主与界面读同一份）；
//   ② 预检票据的契约与目标现场的形状（clone-ticket.ts）；
//   ③ 判定、签票与执行（宿主 versionControlClone.ts）。
// 本文件不自己拼电话名之外的分支判断：预检回包怎么分类、票据怎么取、残留怎么读，都是下面这些小纯函数。
//
// 有一处与其它页面叶子不同：克隆向导要自己保存表单与进度状态，所以本文件导出一个 React 组件
// vcClonePageNode（props: { t, cwd, call }），由页面壳用 h(vcClonePageNode, {...}) 挂载；其它页面叶子是
// 直接返回节点的纯函数。这样表单状态不会挤进页面壳与页签组件（页签文件冻结，只许减不许增）。

// 跨叶子与共享层的名字由构建拼进同一个闭包，这里只声明形状（类型检查按单文件跑）。
declare function cloneOptionsOf(input: any): any; declare function cloneDefaultDirOf(url: any): string; declare function cloneMaskedUrl(url: any): string; declare function cloneSourceKindOf(url: any): string
declare function cloneHardlinkNote(url: any, options: any): string; declare function cloneTargetProblem(target: any): any; declare function cloneTargetSummaryOf(target: any): any
// 进度轮询间隔借长任务通道的中央节拍（config/intervals.yaml 的 vcTaskPollIntervalMs）：克隆本体的进度
// 就是那条任务通道给的，界面照它的节拍去问，不另写一个时间数字（tests/verify-time-config.ts 看守）。
declare const VC_TASK_POLL_INTERVAL_MS: number
declare function clonePlanOf(op: any, args: any): any; declare function cloneTaskArgsOf(plan: any): any

/** 真源标识：门禁按这一行找本文件，改路径要一起改门禁。 */
export const VC_CLONE_PAGE_SOURCE = 'src/client/views/versionControl/vcClonePage.ts'

/** 本页要用的四条电话：预检签票、凭票执行与清理、长任务查询、长任务取消。 */
export const VC_CLONE_PHONES: Record<string, string> = {
  check: 'wf.gitCloneCheck',
  write: 'wf.gitCloneWrite',
  query: 'wf.gitTaskQuery',
  cancel: 'wf.gitTaskCancel',
}

/** 表单初值：空地址、空目录（目录留空时按地址推一个默认目录名）、不给深度、不递归子模块、在线。 */
export const VC_CLONE_FORM_DEFAULT: Record<string, any> = {
  url: '', dir: '', depth: '', branch: '',
  recurseSubmodules: false, shallowSubmodules: false, offline: false,
}

/** 向导在界面上经过的几步；data-vc-clone-step 直接写这个值，门禁按它断言走到哪一步。 */
export const VC_CLONE_STEPS: string[] = ['form', 'checking', 'checked', 'running', 'done', 'failed', 'cancelled', 'cleanup']

/** 宿主 CLONE_REASONS 的标识符 → 词条键。认不出的标识符走 other，绝不把英文标识符印到界面上。 */
export const VC_CLONE_REASON_KEYS: Record<string, string> = {
  'target-not-empty': 'vc.shell.clone.block.notEmpty',
  'target-not-directory': 'vc.shell.clone.block.notDirectory',
  'target-unreadable': 'vc.shell.clone.block.unreadable',
  'nothing-to-clean': 'vc.shell.clone.block.nothingToClean',
  'target-looks-complete': 'vc.shell.clone.block.looksComplete',
  'cleanup-unregistered': 'vc.shell.clone.block.unregistered',
  'bad-url': 'vc.shell.clone.fail.badUrl',
  'bad-path': 'vc.shell.clone.fail.badPath',
  'bad-depth': 'vc.shell.clone.fail.badDepth',
  'bad-branch': 'vc.shell.clone.fail.badBranch',
  'offline-remote': 'vc.shell.clone.fail.offlineRemote',
  'hardlink-source': 'vc.shell.clone.warn.hardlink',
  'target-missing': 'vc.shell.clone.block.targetMissing',
  'ticket-missing': 'vc.shell.clone.stale.ticketMissing',
  'ticket-expired': 'vc.shell.clone.stale.ticketExpired',
  'ticket-op-mismatch': 'vc.shell.clone.stale.ticketMismatch',
  'need-confirm': 'vc.shell.clone.confirm.needed',
  'stale-repo': 'vc.shell.clone.stale.repo',
  'target-changed': 'vc.shell.clone.stale.targetChanged',
  'remove-failed': 'vc.shell.clone.fail.remove',
  'task-refused': 'vc.shell.clone.fail.task',
  'bad-cwd': 'vc.shell.clone.fail.cwd',
}

const vcCloneTextOf = function (t: any, key: string, vars: any): string {
  if (typeof t !== 'function') return key
  return vars ? t(key, vars) : t(key)
}

/** 一个请求号（宿主只收 [A-Za-z0-9_-]，不超过 64）；同一动作重放时界面用同一个号，宿主回上次结果。 */
export const vcCloneRequestIdOf = function (nowMs: any, salt: any): string {
  const a = Number(nowMs || 0).toString(36)
  const b = String(salt || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12)
  return 'c' + a + b
}

/** 表单原值 → 统一形状（深度为空串时回 null，不是 0；两个子模块开关只认真正的 true）。 */
export const vcCloneFormOf = function (input: any): any {
  const f = input || {}
  const depthText = String(f.depth === undefined || f.depth === null ? '' : f.depth).trim()
  return {
    url: String(f.url || '').trim(),
    dir: String(f.dir || '').trim(),
    depth: depthText,
    branch: String(f.branch || '').trim(),
    recurseSubmodules: f.recurseSubmodules === true,
    shallowSubmodules: f.shallowSubmodules === true,
    offline: f.offline === true,
  }
}

/** 预检参数：把选项交给共享层校验，再把净形状放进电话参数；校验不过就不发电话（由调用方显示原因）。 */
export const vcCloneCheckArgsOf = function (cwd: any, form: any): any {
  const f = vcCloneFormOf(form)
  const opt = cloneOptionsOf({
    depth: f.depth, branch: f.branch,
    recurseSubmodules: f.recurseSubmodules, shallowSubmodules: f.shallowSubmodules, offline: f.offline,
  })
  const args: any = { cwd: String(cwd || ''), op: 'start', url: f.url, dir: f.dir }
  if (opt && opt.ok === true) {
    const o = opt.options || {}
    if (o.depth !== null && o.depth !== undefined) args.depth = o.depth
    if (o.branch) args.branch = o.branch
    if (o.recurseSubmodules === true) args.recurseSubmodules = true
    if (o.shallowSubmodules === true) args.shallowSubmodules = true
    if (o.offline === true) args.offline = true
  }
  return args
}

/** 凭票执行的电话参数：票号与请求号都在，动作参数与签票时逐字一致（宿主会按票里的计划比对）。 */
export const vcCloneWriteArgsOf = function (cwd: any, form: any, ticketId: any, requestId: any, confirmed: any): any {
  const args: any = vcCloneCheckArgsOf(cwd, form)
  args.op = 'start'
  args.ticketId = String(ticketId || '')
  args.requestId = String(requestId || '')
  if (confirmed === true) args.confirmed = true
  return args
}

/** 清理残留目录的预检参数。 */
export const vcCloneCleanupCheckArgsOf = function (cwd: any, dir: any): any {
  return { cwd: String(cwd || ''), op: 'cleanup', dir: String(dir || '').trim() }
}

/** 清单个残留目录的电话参数（仍需先预检拿票，再凭票删除）。 */
export const vcCloneCleanupWriteArgsOf = function (cwd: any, dir: any, ticketId: any, requestId: any, confirmed: any): any {
  const args: any = vcCloneCleanupCheckArgsOf(cwd, dir)
  args.ticketId = String(ticketId || '')
  args.requestId = String(requestId || '')
  if (confirmed === true) args.confirmed = true
  return args
}

/** 从组件 props 里取发电话的函数：真机上是页面壳透传的 host.call，门禁里可以塞假函数。 */
export const vcCloneCallOf = function (props: any): any {
  const p = props || {}
  if (typeof p.call === 'function') return p.call
  if (typeof host !== 'undefined' && host && typeof host.call === 'function') return function (m: any, a: any) { return host.call(m, a) }
  return function (): any { return Promise.resolve({ ok: false, error: { kind: 'shape', message: '' } }) }
}

/** 预检回包里的票据：{ id, op, checkedAtMs, expiresAtMs }；没有票据回 null，绝不用空串冒充。 */
export const vcCloneTicketOf = function (reply: any): any {
  const t = reply && reply.ticket
  if (!t || typeof t !== 'object' || !t.id) return null
  return { id: String(t.id), op: String(t.op || ''), checkedAtMs: Number(t.checkedAtMs || 0), expiresAtMs: Number(t.expiresAtMs || 0) }
}

/** 预检回包的目标现场（页面壳按它显示目录是空的、不存在还是非空）。 */
export const vcCloneSceneOf = function (reply: any): any {
  const s = reply && reply.scene
  return s && typeof s === 'object' ? s : null
}

/** 预检回包的决定：{ verdict, reasons }；block 回包也带 decision，界面据此说为什么不能点。 */
export const vcCloneDecisionOf = function (reply: any): any {
  const d = reply && reply.decision
  if (!d || typeof d !== 'object') return { verdict: '', reasons: [] }
  return { verdict: String(d.verdict || ''), reasons: Array.isArray(d.reasons) ? d.reasons : [] }
}

/** 回包告诉我们的原因标识符（顶层 reason 优先，其次错误 kinds，最后看决定里的第一条理由）。 */
export const vcCloneReasonOf = function (reply: any): string {
  const r = reply || {}
  if (typeof r.reason === 'string' && r.reason) return r.reason
  const d = vcCloneDecisionOf(r)
  if (d.reasons.length > 0) return String(d.reasons[0])
  const e = r.error || {}
  if (e.reason) return String(e.reason)
  return ''
}

/**
 * 回包分类：checked（签了票）/ blocked（判定不放行）/ need-confirm（要先确认）/ done（执行成功）/
 * stale（票过期或现场变了）/ fail（真的有错）。界面按它决定画哪一块。
 */
export const vcCloneReplyKindOf = function (reply: any): string {
  const r = reply || {}
  if (r && r.ok === true) {
    if (r.task && typeof r.task === 'object') return 'done'
    if (vcCloneTicketOf(r)) return 'checked'
  }
  const reason = vcCloneReasonOf(r)
  const e = r.error || {}
  const kind = String(e.kind || '')
  // 票过期与现场变了要先判：宿主这两类拒绝用的也是 error.kind='blocked'，
  // 如果先按 blocked 分类，它们会被画成「判定不放行」，界面就没了「重新预检」这句指路。
  if (reason === 'ticket-missing' || reason === 'ticket-expired' || reason === 'ticket-op-mismatch' || reason === 'target-changed' || reason === 'stale-repo') return 'stale'
  if (kind === 'blocked' || reason === 'target-not-empty' || reason === 'target-not-directory' || reason === 'target-unreadable' || reason === 'cleanup-unregistered' || reason === 'nothing-to-clean' || reason === 'target-looks-complete') return 'blocked'
  if (kind === 'need-confirm' || reason === 'need-confirm') return 'need-confirm'
  if (r && r.ok === false) return 'fail'
  return 'unknown'
}

/** 长任务里那个 taskId 对应的记录；查询回包可能带很多条，按 id 找。 */
export const vcCloneTaskOf = function (reply: any, taskId: any): any {
  const tasks = reply && Array.isArray(reply.tasks) ? reply.tasks : []
  const id = String(taskId || '')
  for (let i = 0; i < tasks.length; i += 1) {
    if (tasks[i] && String(tasks[i].taskId || '') === id) return tasks[i]
  }
  return null
}

/** 进度模型：真实百分比只在 0..100 才算数；在途但报不出百分比时标 uncertain，界面不编数字。 */
export const vcCloneProgressOf = function (task: any): any {
  const t = task || {}
  const raw = t.percent
  const percent = (typeof raw === 'number' && isFinite(raw) && raw >= 0 && raw <= 100) ? Math.round(raw) : null
  return {
    phase: (typeof t.phase === 'string' && t.phase) ? t.phase : '',
    percent: percent,
    uncertain: String(t.state || '') === 'running' && percent === null,
  }
}

/** 残留说明：只在结束的任务上出现；没有残留就回空串，界面据此不画清理入口。 */
export const vcCloneResidualOf = function (task: any): string {
  const t = task || {}
  if (String(t.state || '') === 'running') return ''
  return String(t.residual || '')
}

/** 任务是否已经结束（四种结论之一）：结束了就不再轮询。 */
export const vcCloneTaskEndedOf = function (task: any): boolean {
  const t = task || {}
  return t.state !== 'running' && !!t.conclusion
}

/** 一行表单字段：label + input；data-vc-clone-field 给门禁定位，input 类型由 type 参数给。 */
const vcCloneFieldNode = function (h: any, t: any, o: any): any {
  return h('label', { key: o.name, className: 'vcs-clone-field', 'data-vc-clone-field': o.name }, [
    h('span', { key: 'label', className: 'vcs-clone-label' }, vcCloneTextOf(t, o.labelKey, null)),
    h('input', {
      key: 'input', type: o.type || 'text', value: o.value === undefined ? '' : o.value,
      className: 'vcs-clone-input', 'data-vc-clone-input': o.name,
      placeholder: o.placeholder ? vcCloneTextOf(t, o.placeholder, null) : undefined,
      onInput: function (e: any) { o.onInput(e && e.target ? e.target.value : '') },
    }),
  ])
}

/** 两个子模块开关与离线的复选框行；勾选状态直接进表单。 */
const vcCloneFlagNode = function (h: any, t: any, o: any): any {
  return h('label', { key: o.name, className: 'vcs-clone-flag', 'data-vc-clone-flag': o.name }, [
    h('input', { key: 'box', type: 'checkbox', checked: o.checked === true, 'data-vc-clone-checkbox': o.name, onChange: function (e: any) { o.onChange(!!(e && e.target && e.target.checked)) } }),
    h('span', { key: 'text' }, vcCloneTextOf(t, o.labelKey, null)),
  ])
}

/** 目标现场那一行：目录状态与条目数（非空时说清楚它是非空的，不写「未知」）。 */
const vcCloneTargetNode = function (h: any, t: any, target: any): any {
  const s = target || {}
  const state = String(s.state || '')
  const labelKey = 'vc.shell.clone.target.' + (state || 'unknown')
  const entries = Number(s.entryCount || 0)
  return h('p', { className: 'vcs-clone-target', 'data-vc-clone-target': state, 'data-vc-clone-entries': String(entries) }, [
    h('span', { key: 'path', className: 'vcs-clone-target-path' }, String(s.path || '')),
    h('span', { key: 'state', className: 'vcs-clone-target-state' }, vcCloneTextOf(t, labelKey, { n: String(entries) })),
  ])
}

/** 预检判定那一行：允许 / 需要确认 / 不放行，以及原因（原因从固定词条表取，不印标识符）。 */
const vcCloneCheckNode = function (h: any, t: any, reply: any): any {
  const kind = vcCloneReplyKindOf(reply)
  const reasons = vcCloneDecisionOf(reply).reasons
  const reason = vcCloneReasonOf(reply)
  const key = VC_CLONE_REASON_KEYS[reason] || 'vc.shell.clone.reason.other'
  return h('div', { className: 'vcs-clone-check', 'data-vc-clone-check': kind, 'data-vc-clone-reason': reason }, [
    h('p', { key: 'verdict', className: 'vcs-clone-verdict' }, vcCloneTextOf(t, 'vc.shell.clone.verdict.' + (kind === 'checked' ? 'allow' : kind), null)),
    reason ? h('p', { key: 'reason', className: 'vcs-clone-reason' }, vcCloneTextOf(t, key, { reasons: reasons.join(', ') })) : null,
    vcCloneSceneOf(reply) && vcCloneSceneOf(reply).target ? Object.assign({}, vcCloneTargetNode(h, t, vcCloneSceneOf(reply).target), { key: 'target' }) : null,
    vcCloneSceneOf(reply) && vcCloneSceneOf(reply).maskedUrl ? h('p', { key: 'url', className: 'vcs-clone-url', 'data-vc-clone-url': '1' }, vcCloneTextOf(t, 'vc.shell.clone.urlMasked', { url: String(vcCloneSceneOf(reply).maskedUrl) })) : null,
  ])
}

/** 进度那一块：真实百分比或「无法确定」，加阶段与已收字节；在途任务带取消按钮。 */
const vcCloneProgressNode = function (h: any, t: any, o: any): any {
  const p = vcCloneProgressOf(o.task)
  const task = o.task || {}
  const text = p.percent === null
    ? vcCloneTextOf(t, 'vc.shell.clone.progress.uncertain', null)
    : vcCloneTextOf(t, 'vc.shell.clone.progress', { n: String(p.percent) })
  const children = [
    h('p', { key: 'pct', className: 'vcs-clone-percent', 'data-vc-clone-percent': p.percent === null ? '' : String(p.percent) }, text),
    p.phase ? h('p', { key: 'phase', className: 'vcs-clone-phase', 'data-vc-clone-phase': p.phase }, vcCloneTextOf(t, 'vc.shell.clone.phase', { phase: p.phase })) : null,
    h('p', { key: 'state', className: 'vcs-clone-task-state', 'data-vc-clone-task-state': String(task.state || '') }, vcCloneTextOf(t, 'vc.shell.clone.taskState.' + String(task.state || 'running'), null)),
  ]
  if (!vcCloneTaskEndedOf(task)) {
    children.push(h('button', { key: 'cancel', type: 'button', className: 'vcs-clone-cancel', 'data-vc-clone-action': 'cancel', onClick: o.onCancel }, vcCloneTextOf(t, 'vc.shell.clone.cancel', null)))
  }
  return h('div', { className: 'vcs-clone-progress', 'data-vc-clone-progress': String(task.taskId || '') }, children)
}

/** 结束语与残留说明：取消/失败后给出残留目录说明与清理入口；成功则只说完成。 */
const vcCloneEndNode = function (h: any, t: any, o: any): any {
  const task = o.task || {}
  const residual = vcCloneResidualOf(task)
  const conclusion = String(task.conclusion || '')
  const key = conclusion === 'succeeded' ? 'vc.shell.clone.done.ok' : conclusion === 'cancelled' ? 'vc.shell.clone.done.cancelled' : 'vc.shell.clone.done.failed'
  const children = [h('p', { key: 'done', className: 'vcs-clone-done', 'data-vc-clone-conclusion': conclusion }, vcCloneTextOf(t, key, null))]
  if (residual) {
    children.push(h('p', { key: 'residual', className: 'vcs-clone-residual', 'data-vc-clone-residual': '1' }, vcCloneTextOf(t, 'vc.shell.clone.residual', { residual: residual })))
    children.push(h('button', { key: 'cleanup', type: 'button', className: 'vcs-clone-cleanup-open', 'data-vc-clone-action': 'cleanup-open', onClick: o.onCleanupOpen }, vcCloneTextOf(t, 'vc.shell.clone.cleanup.open', null)))
  }
  return h('div', { className: 'vcs-clone-end', 'data-vc-clone-end': conclusion || 'none' }, children)
}

/**
 * 克隆向导的整块界面。props：{ t, cwd, call }。
 * 状态都留在本组件里：表单、预检回包、票据、请求号、任务号、任务记录、错误、清理区。
 * 刷新纪律（规格第 9 节）：进入页面不自动读、点「预检」才读；任务在途时每秒查一次，结束即停。
 */
export const vcClonePageNode = function (props: any): any {
  const h = React.createElement
  const t = props && props.t
  const cwd = String((props && props.cwd) || '')
  const call = vcCloneCallOf(props)
  const [form, setForm] = React.useState(VC_CLONE_FORM_DEFAULT)
  const [step, setStep] = React.useState('form')
  const [check, setCheck] = React.useState(null); const [ticket, setTicket] = React.useState(null)
  const [requestId, setRequestId] = React.useState('')
  const [taskId, setTaskId] = React.useState('')
  const [task, setTask] = React.useState(null)
  const [error, setError] = React.useState(''); const [cleanup, setCleanup] = React.useState(null); const [cleanupDir, setCleanupDir] = React.useState('')
  const aliveRef = React.useRef(true)
  React.useEffect(function () { return function () { aliveRef.current = false } }, [])
  React.useEffect(function () {
    if (!taskId || !aliveRef.current) return
    const timer = setInterval(function () {
      call(VC_CLONE_PHONES.query, {}).then(function (reply: any) {
        if (!aliveRef.current) return
        const found = vcCloneTaskOf(reply, taskId)
        if (!found) return
        setTask(found)
        if (vcCloneTaskEndedOf(found)) { setStep(String(found.conclusion) === 'succeeded' ? 'done' : String(found.conclusion) === 'cancelled' ? 'cancelled' : 'failed') }
      }).catch(function () {})
    }, VC_TASK_POLL_INTERVAL_MS)
    return function () { clearInterval(timer) }
  }, [taskId])
  const failOf = function (reply: any): string {
    const reason = vcCloneReasonOf(reply)
    return VC_CLONE_REASON_KEYS[reason] || (reply && reply.error && reply.error.message) || ''
  }
  const onCheck = function () {
    setError(''); setCheck(null); setStep('checking')
    call(VC_CLONE_PHONES.check, vcCloneCheckArgsOf(cwd, form)).then(function (reply: any) {
      if (!aliveRef.current) return
      const kind = vcCloneReplyKindOf(reply)
      setCheck(reply)
      if (kind === 'checked' || kind === 'need-confirm') { setTicket(vcCloneTicketOf(reply)); setRequestId(vcCloneRequestIdOf(Date.now(), cwd)); setStep('checked') }
      else { setStep('form'); setError(failOf(reply)) }
    }).catch(function (e: any) { if (aliveRef.current) { setStep('form'); setError(String((e && e.message) || e)) } })
  }
  const onStart = function () {
    if (!ticket) return
    setError(''); setStep('running')
    call(VC_CLONE_PHONES.write, vcCloneWriteArgsOf(cwd, form, ticket.id, requestId, true)).then(function (reply: any) {
      if (!aliveRef.current) return
      const started = reply && reply.task
      if (reply && reply.ok === true && started) { setTask(null); setTaskId(String(started.taskId || reply.taskId || '')); return }
      setStep('checked'); setError(failOf(reply))
    }).catch(function (e: any) { if (aliveRef.current) { setStep('checked'); setError(String((e && e.message) || e)) } })
  }
  const onCancel = function () {
    if (!taskId) return
    call(VC_CLONE_PHONES.cancel, { taskId: taskId }).then(function (reply: any) {
      if (!aliveRef.current) return
      const found = vcCloneTaskOf({ tasks: (reply && reply.task) ? [reply.task] : [] }, taskId)
      if (found) { setTask(found); if (vcCloneTaskEndedOf(found)) setStep(String(found.conclusion) === 'cancelled' ? 'cancelled' : 'failed') }
    }).catch(function () {})
  }
  const onCleanupOpen = function () { setCleanup(null); setCleanupDir(form.dir); setStep('cleanup') }
  const onCleanupCheck = function () {
    setCleanup(null)
    call(VC_CLONE_PHONES.check, vcCloneCleanupCheckArgsOf(cwd, cleanupDir)).then(function (reply: any) {
      if (!aliveRef.current) return
      setCleanup(reply)
      const t0 = vcCloneTicketOf(reply)
      if (t0) setRequestId(vcCloneRequestIdOf(Date.now(), cleanupDir))
    }).catch(function () {})
  }
  const onCleanupRun = function () {
    const t0 = cleanup ? vcCloneTicketOf(cleanup) : null
    if (!t0) return
    call(VC_CLONE_PHONES.write, vcCloneCleanupWriteArgsOf(cwd, cleanupDir, t0.id, requestId, true)).then(function (reply: any) {
      if (!aliveRef.current) return
      if (reply && reply.ok === true) { setCleanup(reply); setStep('cleanup') } else setCleanup(reply)
    }).catch(function () {})
  }
  const children: any[] = []
  children.push(h('h3', { key: 'title', className: 'vcs-clone-title', 'data-vc-clone-title': '8.16' }, vcCloneTextOf(t, 'vc.shell.clone.title', null)))
  children.push(h('p', { key: 'hint', className: 'vcs-clone-hint' }, vcCloneTextOf(t, 'vc.shell.clone.hint', null)))
  children.push(h('p', { key: 'where', className: 'vcs-clone-where' }, vcCloneTextOf(t, 'vc.shell.clone.currentRepo', { repo: String(((check && check.scene) || {}).current && ((check.scene || {}).current || {}).root || '') })))
  if (step === 'cleanup') {
    children.push(h('div', { key: 'cleanup', className: 'vcs-clone-cleanup', 'data-vc-clone-cleanup': '1' }, [
      h('p', { key: 'note', className: 'vcs-clone-cleanup-note' }, vcCloneTextOf(t, 'vc.shell.clone.cleanup.note', null)),
      vcCloneFieldNode(h, t, { name: 'cleanupDir', labelKey: 'vc.shell.clone.cleanup.dir', value: cleanupDir, onInput: setCleanupDir }),
      h('button', { key: 'check', type: 'button', className: 'vcs-clone-cleanup-check', 'data-vc-clone-action': 'cleanup-check', onClick: onCleanupCheck }, vcCloneTextOf(t, 'vc.shell.clone.cleanup.check', null)),
      cleanup ? Object.assign({}, vcCloneCheckNode(h, t, cleanup), { key: 'checked' }) : null,
      cleanup && vcCloneTicketOf(cleanup) ? h('button', { key: 'run', type: 'button', className: 'vcs-clone-cleanup-run', 'data-vc-clone-action': 'cleanup-run', onClick: onCleanupRun }, vcCloneTextOf(t, 'vc.shell.clone.cleanup.run', null)) : null,
      cleanup && cleanup.ok === true && cleanup.removed === true ? h('p', { key: 'removed', className: 'vcs-clone-removed', 'data-vc-clone-removed': '1' }, vcCloneTextOf(t, 'vc.shell.clone.cleanup.removed', null)) : null,
      h('button', { key: 'back', type: 'button', className: 'vcs-clone-back', 'data-vc-clone-action': 'back', onClick: function () { setStep('form') } }, vcCloneTextOf(t, 'vc.shell.clone.back', null)),
    ]))
  } else {
    children.push(h('div', { key: 'fields', className: 'vcs-clone-fields', 'data-vc-clone-fields': '1' }, [
      vcCloneFieldNode(h, t, { name: 'url', labelKey: 'vc.shell.clone.field.url', value: form.url, placeholder: 'vc.shell.clone.field.urlHint', onInput: function (v: any) { setForm(Object.assign({}, form, { url: v })) } }),
      vcCloneFieldNode(h, t, { name: 'dir', labelKey: 'vc.shell.clone.field.dir', value: form.dir, placeholder: 'vc.shell.clone.field.dirHint', onInput: function (v: any) { setForm(Object.assign({}, form, { dir: v })) } }),
      vcCloneFieldNode(h, t, { name: 'depth', labelKey: 'vc.shell.clone.field.depth', value: form.depth, placeholder: 'vc.shell.clone.field.depthHint', onInput: function (v: any) { setForm(Object.assign({}, form, { depth: v })) } }),
      vcCloneFieldNode(h, t, { name: 'branch', labelKey: 'vc.shell.clone.field.branch', value: form.branch, placeholder: 'vc.shell.clone.field.branchHint', onInput: function (v: any) { setForm(Object.assign({}, form, { branch: v })) } }),
      vcCloneFlagNode(h, t, { name: 'recurseSubmodules', labelKey: 'vc.shell.clone.flag.recurse', checked: form.recurseSubmodules, onChange: function (v: any) { setForm(Object.assign({}, form, { recurseSubmodules: v })) } }),
      vcCloneFlagNode(h, t, { name: 'shallowSubmodules', labelKey: 'vc.shell.clone.flag.shallow', checked: form.shallowSubmodules, onChange: function (v: any) { setForm(Object.assign({}, form, { shallowSubmodules: v })) } }),
      vcCloneFlagNode(h, t, { name: 'offline', labelKey: 'vc.shell.clone.flag.offline', checked: form.offline, onChange: function (v: any) { setForm(Object.assign({}, form, { offline: v })) } }),
    ]))
    if (error) children.push(h('p', { key: 'error', className: 'vcs-clone-error', 'data-vc-clone-error': '1' }, vcCloneTextOf(t, error, null)))
    if (check) children.push(Object.assign({}, vcCloneCheckNode(h, t, check), { key: 'checked' }))
    if (check && vcCloneReplyKindOf(check) === 'need-confirm') children.push(h('p', { key: 'confirm', className: 'vcs-clone-confirm', 'data-vc-clone-confirm': '1' }, vcCloneTextOf(t, 'vc.shell.clone.confirm.text', null)))
    if (check && vcCloneReplyKindOf(check) === 'checked') {
      children.push(h('p', { key: 'warn', className: 'vcs-clone-warn', 'data-vc-clone-warn': '1' }, cloneHardlinkNote(form.url, { offline: form.offline })))
      children.push(h('button', { key: 'start', type: 'button', className: 'vcs-clone-start', 'data-vc-clone-action': 'start', onClick: onStart }, vcCloneTextOf(t, 'vc.shell.clone.start', null)))
    }
    children.push(h('button', { key: 'check', type: 'button', className: 'vcs-clone-check', 'data-vc-clone-action': 'check', onClick: onCheck, disabled: step === 'checking' || step === 'running' }, vcCloneTextOf(t, 'vc.shell.clone.check', null)))
    if (task) children.push(Object.assign({}, vcCloneProgressNode(h, t, { task: task, onCancel: onCancel }), { key: 'progress' }))
    if (task && vcCloneTaskEndedOf(task)) children.push(Object.assign({}, vcCloneEndNode(h, t, { task: task, onCleanupOpen: onCleanupOpen }), { key: 'end' }))
  }
  return h('section', { id: 'vc-clone-wizard', className: 'vcs-clone', 'data-vc-clone': '1', 'data-vc-clone-step': step }, children)
}

/** 真源标识（页面壳与门禁按它找本文件的挂载段）。 */
export const VC_CLONE_PAGE_HINT = 'migrate'
