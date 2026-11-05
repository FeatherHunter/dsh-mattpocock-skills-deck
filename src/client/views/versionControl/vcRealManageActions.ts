// views/versionControl/vcRealManageActions.ts —— 分支标签板、远端与同步页的动作（#1776 M2）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 三个页面共用一套三段式：预检电话签票 → 页面确认卡 → 凭票执行电话 → 结果回触发点，成功后重读该页。
// 这一层只做「点击 → 电话 → 状态」的搬运，不判断能不能做（判定一律看宿主预检回包）；
// 回包形状不对就按失败呈现，绝不当成功。远端四条写同样先发预检电话签票、停在确认卡、
// 凭票才发执行电话（#1776 M4b），执行成功后重读远端列表。

declare const tr: any
declare function vcBranchCheck(reads: any, call: any, cwd: any, op: any, fields: any): any
declare function vcBranchWrite(reads: any, call: any, cwd: any, op: any, fields: any): any
declare function vcBranchCheckKindOf(reply: any): string
declare function vcBranchConfirmOf(reply: any): any
declare function vcBranchResultOf(reply: any): any
declare function vcBranchTicketOf(reads: any): any
declare function vcReadRemoteList(reads: any, call: any, cwd: any): any
declare function vcReadRemoteOnline(reads: any, call: any, cwd: any, name: any, refs: any): any
declare function vcRemoteCheckCallOf(call: any, cwd: any, action: any, input: any): any
declare function vcRemoteConfirmOf(action: any, input: any, reply: any, requestId: any): any
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
  // 分支浮层里的四个动作只指路：点它们跳到分支标签板并高亮（不改壳里那四个 span）。
  const branchOverlayAction = function (key: any): void {
    onJump('branch-tags', String(key || ''))
  }

  // ———— 分支浮层里的切换（#1846 并入 #1884）：走 4.3 的既有通路，确认卡摆到浮层里 ————
  // 与分支页那一条的差别只有一处：这里只在这份预检真的要求确认（工作区有未提交改动）时停，
  // 其余情况签完票就直接执行——浮层是「点了就切」的地方，多停一张卡只是多一次点击。
  // 确认卡与结果都落在浮层自己的槽里，不挤占分支页的 branchConfirm / branchResult。
  const popoverPatch = function (patch: any): void {
    setManage(function (cur: any) { return Object.assign({}, cur, patch || {}) })
  }
  // 凭票执行那一段：票号取自刚签下的那份预检（与分支页同一个 vcBranchTicketOf 读数口径）。
  const popoverWrite = function (branchRead: any, name: string): any {
    const ticket: any = (function () { try { return vcBranchTicketOf({ branch: branchRead }) } catch (e) { return null } })()
    const fields: any = { name: name, ticketId: ticket ? ticket.id : '', requestId: vcRealRequestIdOf(nowMs(), 'switch'), confirmed: true }
    popoverPatch({ branchPopoverPending: null, branchPopoverConfirm: null })
    return Promise.resolve(vcBranchWrite({ branch: branchRead }, callHost, cwd, '4.3', fields)).then(function (next: any) {
      const write: any = next && next.branch && next.branch.write
      const reply: any = write && write.data
      popoverPatch({ branch: next && next.branch, branchPopoverResult: vcBranchResultOf(reply) })
      // 写成功后重读分支板：用户随后打开「分支与标签」页时，当前分支标记才是新的。
      if (reply && reply.ok === true) onRefresh('branch-tags')
      return reply && reply.ok === true
    })
  }
  // 点一条分支：预检 → （要确认时）停在浮层确认卡）→ 凭票执行。返回值只用来告诉壳要不要重读首屏。
  const popoverSwitch = function (name: any): any {
    const target: string = String(name || '')
    if (target === '') return Promise.resolve(false)
    const m: any = getManage() || {}
    popoverPatch({ branchPopoverConfirm: null, branchPopoverResult: null, branchPopoverPending: { name: target } })
    return Promise.resolve(vcBranchCheck({ branch: m.branch }, callHost, cwd, '4.3', { name: target })).then(function (next: any) {
      const check: any = next && next.branch && next.branch.check
      const reply: any = check && check.data
      // block 与读不回现场都照原话贴结果：浮层不假装能切，也不自己编一句理由。
      if (vcBranchCheckKindOf(reply) !== 'checked') {
        popoverPatch({ branch: next && next.branch, branchPopoverResult: vcBranchResultOf(reply), branchPopoverPending: null })
        return false
      }
      if (reply.confirmRequired === true) {
        popoverPatch({ branch: next && next.branch, branchPopoverConfirm: vcBranchConfirmOf(reply) })
        return false
      }
      return popoverWrite(next && next.branch, target)
    })
  }
  const popoverConfirmGo = function (): any {
    const m: any = getManage() || {}
    const pending: any = m.branchPopoverPending
    if (!pending || !m.branchPopoverConfirm) return Promise.resolve(false)
    return popoverWrite(m.branch, String(pending.name || ''))
  }
  const popoverConfirmCancel = function (): void {
    popoverPatch({ branchPopoverConfirm: null, branchPopoverPending: null })
  }
  // 每次重新打开浮层都从干净的第一屏开始：上一次没走完的确认卡与上一次的结果不带到下一次。
  const popoverReset = function (): void {
    popoverPatch({ branchPopoverConfirm: null, branchPopoverResult: null, branchPopoverPending: null })
  }

  // ———— 远端与同步页 ————
  const remoteUi = function (patch: any): void {
    setUi(function (cur: any) { return Object.assign({}, cur, patch || {}) })
  }
  const remoteTrigger = function (form: any, name: any): void {
    remoteUi({ form: String(form || ''), target: String(name || ''), problem: '', result: null, confirm: null })
  }
  // 把表单字段折成宿主预检要的那几个参数（四种动作各取自己用得到的字段）。
  const remoteInputOf = function (f: string, name: string, url: string, target: string, values: any): any {
    const v: any = values || {}
    if (f === 'add') return { name: name, url: url }
    if (f === 'rename') return { from: String(v.from || target), to: String(v.to || '') }
    if (f === 'setUrl') return { name: target, url: url }
    return { name: target }
  }
  // 第一段：提交表单只发预检电话；签到票才停确认卡，预检失败只贴失败结果，不发写电话。
  const remoteSubmit = function (form: any, values: any): any {
    const f: string = String(form || '')
    const v: any = values || {}
    const ui: any = getUi() || {}
    const target: string = String(ui.target || '')
    const name: string = String(v.name || '')
    const url: string = String(v.url || '')
    if (f === 'add' && name.trim() === '') { remoteUi({ problem: 'name' }); return Promise.resolve(null) }
    if ((f === 'add' || f === 'setUrl') && url.trim() === '') { remoteUi({ problem: 'url' }); return Promise.resolve(null) }
    if (!VC_REMOTE_WRITE_PHONES[f]) return Promise.resolve(null)
    const input: any = remoteInputOf(f, name, url, target, v)
    const requestId: string = vcRealRequestIdOf(nowMs(), f)
    return Promise.resolve(vcRemoteCheckCallOf(callHost, cwd, f, input)).then(function (reply: any) {
      const confirm: any = vcRemoteConfirmOf(f, input, reply, requestId)
      if (confirm) remoteUi({ confirm: confirm, result: null, problem: '' })
      else remoteUi({ confirm: null, result: vcRealRemoteResultOf(reply) })
      return null
    })
  }
  // 第二段：确认卡上点确认才凭票发执行电话；票与请求号都取自预检那一份（函数式读 prev.confirm）。
  const remoteConfirmGo = function (): any {
    // 读当前确认卡要用 getUi 的同步快照：setUi 的函数式更新由 React 在渲染时求值，
    //   这里若靠 updater 回填外层变量，会拿到空值、把票丢了还发不出写电话。
    const ui: any = getUi() || {}
    const confirm: any = ui.confirm || null
    remoteUi({ confirm: null })
    if (!confirm || !confirm.ticketId) return Promise.resolve(null)
    const action: string = String(confirm.action || '')
    const phone: any = VC_REMOTE_WRITE_PHONES[action]
    if (!phone) return Promise.resolve(null)
    const args: any = { cwd: cwd, ticketId: String(confirm.ticketId || ''), requestId: String(confirm.requestId || ''), confirmed: true }
    if (action === 'add') { args.name = String(confirm.name || ''); args.url = String(confirm.url || '') }
    else if (action === 'rename') { args.from = String(confirm.from || ''); args.to = String(confirm.to || '') }
    else if (action === 'setUrl') { args.name = String(confirm.name || ''); args.url = String(confirm.url || '') }
    else { args.name = String(confirm.name || '') }
    const m: any = getManage() || {}
    return Promise.resolve(vcRunRemoteWrite(m.remote || {}, callHost, phone, args)).then(function (out: any) {
      const reply: any = out && out.reply
      setManage(function (cur: any) { return Object.assign({}, cur, { remote: out && out.reads }) })
      // 结果留在触发点：行内动作保留 target，登记动作 target 为空（结果画在登记入口那一段）。
      remoteUi({ form: '', problem: '', result: vcRealRemoteResultOf(reply) })
      if (reply && reply.ok === true) onRefresh('remote')
      return null
    })
  }
  const remoteCancel = function (): void {
    remoteUi({ form: '', target: '', problem: '', result: null, confirm: null })
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
    branch: { action: branchAction, confirmGo: branchConfirmGo, confirmCancel: branchConfirmCancel, overlay: branchOverlayAction, popoverSwitch: popoverSwitch, popoverConfirmGo: popoverConfirmGo, popoverConfirmCancel: popoverConfirmCancel, popoverReset: popoverReset },
    remote: { trigger: remoteTrigger, submit: remoteSubmit, confirmGo: remoteConfirmGo, cancel: remoteCancel, online: remoteOnline, onlineBack: remoteOnlineBack, onlineRetry: remoteOnlineRetry, retry: remoteRetry, retryList: remoteRetry },
    sync: { expand: syncExpand, check: syncCheck, confirmGo: syncConfirmGo, confirmCancel: syncConfirmCancel, kind: syncKind, taskCancel: syncTaskCancel, retry: syncRetry },
  }
}
