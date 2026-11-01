// views/versionControl/vcRealManageActions.ts —— 分支标签板、远端与同步页的动作（#1776 M2）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 三个页面共用一套三段式：预检电话签票 → 页面确认卡 → 凭票执行电话 → 结果回触发点，成功后重读该页。
// 这一层只做「点击 → 电话 → 状态」的搬运，不判断能不能做（判定一律看宿主预检回包）；
// 回包形状不对就按失败呈现，绝不当成功。远端四条写没有预检，直接执行后重读列表。

declare const tr: any
declare function vcBranchCheck(reads: any, call: any, cwd: any, op: any, fields: any): any
declare function vcBranchWrite(reads: any, call: any, cwd: any, op: any, fields: any): any
declare function vcBranchCheckKindOf(reply: any): string
declare function vcBranchConfirmOf(reply: any): any
declare function vcBranchResultOf(reply: any): any
declare function vcBranchTicketOf(reads: any): any
declare function vcReadRemoteList(reads: any, call: any, cwd: any): any
declare function vcReadRemoteOnline(reads: any, call: any, cwd: any, name: any, refs: any): any
declare function vcRunRemoteWrite(reads: any, call: any, phone: any, args: any): any
declare function vcReadSyncCheck(reads: any, call: any, cwd: any, action: any, input: any): any
declare function vcRunSyncWrite(reads: any, call: any, cwd: any, ticketId: any, action: any, requestId: any, confirmed: any): any
declare const VC_REMOTE_WRITE_PHONES: any
declare const VC_SYNC_ACTION_ROWS: any[]
declare function vcRealRequestIdOf(nowMs: any, salt: any): string

/** 真源标识：门禁按这一行找本文件。 */
export const VC_REAL_MANAGE_ACTIONS_SOURCE = 'src/client/views/versionControl/vcRealManageActions.ts'

/** 把远端写回包折成结果块要的形状（成功给命令与耗时，失败给原话与环节）。 */
const vcRealRemoteResultOf = function (reply: any): any {
  const r: any = reply || {}
  if (r.ok === true) return { ok: true, cmd: String(r.command || ''), ms: typeof r.ms === 'number' ? r.ms : null, n: typeof r.n === 'number' ? r.n : null, next: '' }
  const e: any = r.error || {}
  return {
    ok: false, error: true,
    git: String(r.git || e.git || ''), step: String(r.step || e.step || e.kind || ''),
    expected: String(r.expected || e.expected || ''), actual: String(r.actual || e.actual || ''),
    cause: String(r.cause || e.cause || e.message || ''),
  }
}

/**
 * 造管理页的动作处理器：返回 { branch, remote, sync } 三组，容器按需挂到页面壳的回调上。
 * deps：getManage/setManage（管理状态读写，setManage 收函数式更新）、getUi/setUi（界面状态）、
 *   callHost、cwd、nowMs、onRefresh(page)（写成功后重读该页，由容器接读数分发器）、onJump(page)（分支浮层跳转）。
 */
export const vcRealManageActionsOf = function (deps: any): any {
  const d: any = deps || {}
  const getManage: any = d.getManage
  const setManage: any = d.setManage
  const getUi: any = d.getUi
  const setUi: any = d.setUi
  const callHost: any = d.callHost
  const cwd: string = String(d.cwd || '')
  const nowMs: any = typeof d.nowMs === 'function' ? d.nowMs : function () { return Date.now() }
  const onRefresh: any = typeof d.onRefresh === 'function' ? d.onRefresh : function () { return Promise.resolve(null) }
  const onJump: any = typeof d.onJump === 'function' ? d.onJump : function () { return undefined }

  // ———— 分支与标签板 ————
  // 点一条动作：先发预检。只读的验签（4.12）把结论直接贴结果块；其余拿到票之后停确认卡。
  const branchAction = function (op: any, fields: any): any {
    const m: any = getManage() || {}
    const f: any = Object.assign({}, fields || {})
    setManage(function (cur: any) { return Object.assign({}, cur, { branchConfirm: null, branchResult: null, branchPending: { op: String(op || ''), fields: f } }) })
    return Promise.resolve(vcBranchCheck({ branch: m.branch }, callHost, cwd, op, f)).then(function (next: any) {
      const check: any = next && next.branch && next.branch.check
      const reply: any = check && check.data
      const kind: string = vcBranchCheckKindOf(reply)
      if (kind === 'checked' && String((reply && reply.op) || '') === 'verify') {
        setManage(function (cur: any) { return Object.assign({}, cur, { branch: next.branch, branchResult: vcBranchResultOf(reply), branchPending: null }) })
        return null
      }
      const confirm: any = kind === 'checked' ? vcBranchConfirmOf(reply) : null
      if (confirm) {
        setManage(function (cur: any) { return Object.assign({}, cur, { branch: next.branch, branchConfirm: confirm }) })
        return null
      }
      setManage(function (cur: any) { return Object.assign({}, cur, { branch: next.branch, branchResult: vcBranchResultOf(reply), branchPending: null }) })
      return null
    })
  }
  // 凭票执行：票号取自这一份预检读数；执行成功后才重读板面，失败把原话贴在结果块里。
  const branchConfirmGo = function (): any {
    const m: any = getManage() || {}
    const pending: any = m.branchPending
    if (!pending || !m.branchConfirm) return Promise.resolve(null)
    const ticket: any = (function () { try { return vcBranchTicketOf({ branch: m.branch }) } catch (e) { return null } })()
    const fields: any = Object.assign({}, pending.fields, { ticketId: ticket ? ticket.id : '', requestId: vcRealRequestIdOf(nowMs(), pending.op), confirmed: true })
    setManage(function (cur: any) { return Object.assign({}, cur, { branchPending: null }) })
    return Promise.resolve(vcBranchWrite({ branch: m.branch }, callHost, cwd, pending.op, fields)).then(function (next: any) {
      const write: any = next && next.branch && next.branch.write
      const reply: any = write && write.data
      setManage(function (cur: any) { return Object.assign({}, cur, { branch: next.branch, branchConfirm: null, branchResult: vcBranchResultOf(reply) }) })
      if (reply && reply.ok === true) onRefresh('branch-tags')
      return null
    })
  }
  const branchConfirmCancel = function (): any {
    setManage(function (cur: any) { return Object.assign({}, cur, { branchConfirm: null, branchPending: null }) })
    return Promise.resolve(null)
  }
  // 分支浮层里的五项只有文字：点它们跳到分支标签板并高亮（不改壳里那五个 span）。
  const branchOverlayAction = function (key: any): void {
    onJump('branch-tags', String(key || ''))
  }

  // ———— 远端与同步页 ————
  const remoteUi = function (patch: any): void {
    setUi(function (cur: any) { return Object.assign({}, cur, patch || {}) })
  }
  const remoteTrigger = function (form: any, name: any): void {
    remoteUi({ form: String(form || ''), target: String(name || ''), problem: '', result: null })
  }
  // 提交一条远端写：先按表单字段做最轻的非空检查（空值不打宿主），再直发写电话，成功后重读本地列表。
  const remoteSubmit = function (form: any, values: any): any {
    const f: string = String(form || '')
    const v: any = values || {}
    const ui: any = getUi() || {}
    const target: string = String(ui.target || '')
    const name: string = String(v.name || '')
    const url: string = String(v.url || '')
    if (f === 'add' && name.trim() === '') { remoteUi({ problem: 'name' }); return Promise.resolve(null) }
    if ((f === 'add' || f === 'setUrl') && url.trim() === '') { remoteUi({ problem: 'url' }); return Promise.resolve(null) }
    const phone: any = VC_REMOTE_WRITE_PHONES[f]
    if (!phone) return Promise.resolve(null)
    let args: any = { cwd: cwd }
    if (f === 'add') args = { cwd: cwd, name: name, url: url }
    else if (f === 'rename') args = { cwd: cwd, from: String(v.from || target), to: String(v.to || '') }
    else if (f === 'setUrl') args = { cwd: cwd, name: target, url: url }
    else if (f === 'remove') args = { cwd: cwd, name: target }
    const m: any = getManage() || {}
    return Promise.resolve(vcRunRemoteWrite(m.remote || {}, callHost, phone, args)).then(function (out: any) {
      const reply: any = out && out.reply
      setManage(function (cur: any) { return Object.assign({}, cur, { remote: out && out.reads }) })
      remoteUi({ result: vcRealRemoteResultOf(reply) })
      if (reply && reply.ok === true) {
        remoteUi({ form: '', target: '', problem: '', result: vcRealRemoteResultOf(reply) })
        onRefresh('remote')
      }
      return null
    })
  }
  const remoteConfirmGo = function (): any {
    return remoteSubmit('remove', {})
  }
  const remoteCancel = function (): void {
    remoteUi({ form: '', target: '', problem: '', result: null })
  }
  // 联网查看：只有人点了才发（ADR 20261031 第 6 节），读完落 online 槽；返回按钮把 online 槽收回 idle。
  const remoteOnline = function (name: any): any {
    const m: any = getManage() || {}
    const target: string = String(name || '')
    return Promise.resolve(vcReadRemoteOnline(m.remote || {}, callHost, cwd, target, undefined)).then(function (next: any) {
      setManage(function (cur: any) { return Object.assign({}, cur, { remote: next }) })
      return null
    })
  }
  const remoteOnlineBack = function (): void {
    setManage(function (cur: any) {
      const wrapper: any = Object.assign({}, (cur && cur.remote) || {})
      wrapper.online = { state: 'idle', name: '', data: null, error: null }
      return Object.assign({}, cur, { remote: wrapper })
    })
  }
  const remoteOnlineRetry = function (): any {
    const m: any = getManage() || {}
    const wrapper: any = m.remote || {}
    const name: string = String((wrapper.online && wrapper.online.name) || '')
    return remoteOnline(name)
  }
  const remoteRetry = function (): any {
    return onRefresh('remote')
  }

  // ———— 同步带 ————
  const syncRowOf = function (id: any): any {
    const want: string = String(id || '')
    for (let i = 0; i < VC_SYNC_ACTION_ROWS.length; i += 1) if (String(VC_SYNC_ACTION_ROWS[i].id) === want) return VC_SYNC_ACTION_ROWS[i]
    return null
  }
  const syncExpand = function (id: any): void {
    setUi(function (cur: any) { return Object.assign({}, cur, { open: String(id || ''), result: null }) })
  }
  const syncKind = function (kind: any): void {
    setUi(function (cur: any) { return Object.assign({}, cur, { syncKind: String(kind || 'branch') }) })
  }
  // 预检：动作名从十行名单里查，参数只带远程引用形态（删引用时按分支/标签区分），其余交给宿主判定。
  const syncCheck = function (id: any): any {
    const row: any = syncRowOf(id)
    if (!row) return Promise.resolve(null)
    const m: any = getManage() || {}
    const ui: any = getUi() || {}
    const input: any = row.action === 'delete-remote-ref' ? { kind: String(ui.syncKind || 'branch') } : {}
    return Promise.resolve(vcReadSyncCheck(m.sync || {}, callHost, cwd, row.action, input)).then(function (next: any) {
      setManage(function (cur: any) { return Object.assign({}, cur, { sync: next }) })
      setUi(function (cur: any) { return Object.assign({}, cur, { open: String(id || ''), result: null }) })
      return null
    })
  }
  // 凭票执行：票号与动作都取自这一份预检回包；执行成功清掉确认卡并把任务摘要落进任务槽。
  const syncConfirmGo = function (): any {
    const m: any = getManage() || {}
    const slot: any = (m.sync && m.sync.sync) || {}
    const data: any = slot.data || {}
    const ticket: any = data.ticket || {}
    if (!ticket.id || !data.action) return Promise.resolve(null)
    return Promise.resolve(vcRunSyncWrite(m.sync || {}, callHost, cwd, ticket.id, data.action, vcRealRequestIdOf(nowMs(), data.action), true)).then(function (next: any) {
      setManage(function (cur: any) { return Object.assign({}, cur, { sync: next }) })
      setUi(function (cur: any) { return Object.assign({}, cur, { result: { ok: true, action: String(data.action || '') } }) })
      onRefresh('remote')
      return null
    })
  }
  const syncConfirmCancel = function (): void {
    setManage(function (cur: any) {
      const wrapper: any = (cur && cur.sync) || {}
      const slot: any = wrapper.sync || { state: 'idle', data: null, error: null }
      return Object.assign({}, cur, { sync: Object.assign({}, wrapper, { sync: Object.assign({}, slot, { data: null }) }) })
    })
  }
  const syncTaskCancel = function (): any {
    const m: any = getManage() || {}
    const task: any = (m.sync && m.sync.task && m.sync.task.data) || {}
    const taskId: string = String(task.taskId || task.id || '')
    if (taskId === '') return Promise.resolve(null)
    return Promise.resolve(callHost('wf.gitTaskCancel', { taskId: taskId })).then(function () { return null })
  }
  const syncRetry = function (): any {
    return onRefresh('remote')
  }

  return {
    branch: { action: branchAction, confirmGo: branchConfirmGo, confirmCancel: branchConfirmCancel, overlay: branchOverlayAction },
    remote: { trigger: remoteTrigger, submit: remoteSubmit, confirmGo: remoteConfirmGo, cancel: remoteCancel, online: remoteOnline, onlineBack: remoteOnlineBack, onlineRetry: remoteOnlineRetry, retry: remoteRetry, retryList: remoteRetry },
    sync: { expand: syncExpand, check: syncCheck, confirmGo: syncConfirmGo, confirmCancel: syncConfirmCancel, kind: syncKind, taskCancel: syncTaskCancel, retry: syncRetry },
  }
}
