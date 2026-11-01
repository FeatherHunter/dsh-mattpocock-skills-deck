// views/versionControl/vcRealManageActions2.ts —— 配置、钩子、诊断、子模块、平台四页的动作装配（#1776 M2）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 四页的读写都走「预检签票 → 页面确认卡 → 凭票执行」，页面自己的按钮带 onClick，
// 因此这一层只负责把页面的回调翻成电话，并把回包落回页面读的那份状态；页面不直接拿宿主。

declare function vcConfigStateNew(): any
declare function vcConfigEditOf(state: any, patch: any): any
declare function vcConfigApplyRead(state: any, reply: any): any
declare function vcConfigApplyCheck(state: any, reply: any): any
declare function vcConfigApplyReply(state: any, reply: any): any
declare function vcHooksApplyReply(state: any, reply: any): any
declare function vcConfigSetInputOf(state: any): any
declare function vcConfigUnsetInputOf(state: any, key: any): any
declare function vcHookRunInputOf(name: any): any
declare function vcConfigCheckCallOf(call: any, cwd: any, input: any): any
declare function vcConfigWriteCallOf(call: any, cwd: any, input: any): any
declare function vcConfigConfirmOf(check: any): any
declare function vcDiagnosticsActionsOf(deps: any): any
declare const VC_DIAG_BISECT_CAP: any
declare const VC_DIAG_PATCH_CAP: any
declare const VC_DIAG_REPLACE_CAP: any
declare function vcReadPlatform(reads: any, call: any, cwd: any): any
declare function vcRunRequestPull(reads: any, call: any, cwd: any, form: any): any
declare function createSubmodulesOpsOf(deps: any): any
declare function vcRealRequestIdOf(nowMs: any, salt: any): string

const VC_REAL_CONFIG_READ_PHONE = 'wf.gitConfigRead'

/**
 * 配置页与钩子页共用的处理器。两页读写同一份配置状态（钩子清单也由同一条读电话带回），
 * 所以只对外开一组回调；预检签出的票要人点确认才执行，删键与手动跑钩子属于这一类。
 */
export const vcRealConfigHandlersOf = function (deps: any): any {
  const d: any = deps || {}
  const callHost: any = d.callHost
  const cwd: string = String(d.cwd || '')
  const nowMs: any = typeof d.nowMs === 'function' ? d.nowMs : function () { return Date.now() }
  const getManage: any = d.getManage
  const setManage: any = d.setManage
  const onRefresh: any = d.onRefresh
  const stateNow = function (): any {
    const m: any = getManage() || {}
    return m.config || vcConfigStateNew()
  }
  const setState = function (next: any): void {
    const m: any = getManage() || {}
    setManage(Object.assign({}, m, { config: next }))
  }
  const refresh = function (): any {
    return Promise.resolve(callHost(VC_REAL_CONFIG_READ_PHONE, { cwd: cwd })).then(function (reply: any) {
      setState(vcConfigApplyRead(stateNow(), reply))
      return null
    })
  }
  const readInto = function (extra: any): any {
    const payload: any = Object.assign({ cwd: cwd }, extra || {})
    return Promise.resolve(callHost(VC_REAL_CONFIG_READ_PHONE, payload)).then(function (reply: any) {
      setState(vcConfigApplyRead(stateNow(), reply))
      return null
    })
  }
  const write = function (ticketId: any, op: any, name: any): any {
    const input: any = { op: String(op || ''), ticketId: String(ticketId || ''), requestId: vcRealRequestIdOf(nowMs(), 'cfg'), confirmed: true }
    if (name !== undefined) input.name = String(name)
    return Promise.resolve(vcConfigWriteCallOf(callHost, cwd, input)).then(function (reply: any) {
      const current: any = stateNow()
      setState(String(op || '') === 'hook-run' ? vcHooksApplyReply(current, reply) : vcConfigApplyReply(current, reply))
      if (reply && reply.ok === true) return refresh()
      return null
    })
  }
  const check = function (input: any): any {
    const current: any = stateNow()
    setState(vcConfigApplyCheck(Object.assign({}, current, { pending: input }), { ok: false, error: { kind: 'pending' } }))
    return Promise.resolve(vcConfigCheckCallOf(callHost, cwd, input)).then(function (reply: any) {
      const next: any = vcConfigApplyCheck(stateNow(), reply)
      setState(next)
      const ticket: any = next.check && next.check.ticket ? next.check.ticket : null
      if (ticket && vcConfigConfirmOf(next.check) && reply.confirmRequired === true) return null
      if (ticket) return write(ticket.id, input.op, input.name)
      return null
    })
  }
  // 页面把六种动作都交给这一个回调：读、预检加执行、以及带票执行。
  const onConfig = function (input: any): any {
    const i: any = input || {}
    const op: string = String(i.op || '')
    if (op === 'read') return refresh()
    if (op === 'read-attr') return readInto({ path: String(i.path || '') })
    if (op === 'read-mailmap') return readInto({ address: String(i.address || '') })
    if (op === 'config-set') return check(vcConfigSetInputOf(stateNow()))
    if (op === 'config-unset') return check(vcConfigUnsetInputOf(stateNow(), i.key))
    if (op === 'hook-run') return check(vcHookRunInputOf(i.name))
    if (op === 'confirm-write') return write(i.ticketId, i.checkOp, i.name)
    return Promise.resolve(null)
  }
  const onConfigEdit = function (patch: any): void {
    const p: any = patch || {}
    if (p.cancelCheck === true) {
      const next: any = Object.assign({}, stateNow(), { check: null, pending: null })
      setState(next)
      return
    }
    setState(vcConfigEditOf(stateNow(), p))
  }
  // 钩子页与配置页共用同一份状态与电话；钩子页只多一个「手动跑」。
  const onHooks = onConfig
  const onHooksEdit = function (patch: any): void {
    onConfigEdit(patch)
  }
  return { onConfig: onConfig, onConfigEdit: onConfigEdit, onHooks: onHooks, onHooksEdit: onHooksEdit, refresh: refresh }
}

/**
 * 诊断页的处理器。诊断动作分三类能力（bisect / replace / patch），页面回调是
 * onWrite(op, values)，能力号由动作名反推；这一层把能力号补齐后交给共享动作层，
 * 所以页面不需要知道账本编号，也不重复写一套预检/执行逻辑。
 */
export const vcRealDiagnosticsHandlersOf = function (deps: any): any {
  const d: any = deps || {}
  const actions: any = vcDiagnosticsActionsOf({ ui: d.ui, setUi: d.setUi, callHost: d.callHost, cwd: d.cwd, nowMs: d.nowMs })
  const capOfOp = function (op: any): string {
    const name = String(op || '')
    if (name.indexOf('bisect-') === 0) return String(VC_DIAG_BISECT_CAP)
    if (name.indexOf('replace-') === 0) return String(VC_DIAG_REPLACE_CAP)
    return String(VC_DIAG_PATCH_CAP)
  }
  return {
    state: actions.state,
    onRead: function (cap: any): any { return actions.read(cap) },
    onWrite: function (op: any, values: any): any { return actions.submit(capOfOp(op), op, values) },
    onEdit: function (cap: any, key: any, value: any): void { actions.setInput(cap, key, value) },
    onConfirm: function (): any { return actions.confirmNow() },
    onCancel: function (): void { actions.cancelConfirm() },
    clearResult: actions.clearResult,
  }
}

/**
 * 子模块页的 ops 包装：共享层工厂要四个取/存函数，这里把容器里那份活动对象接过去。
 * 板面与操作状态分开存（板面是读数、ui 是当前动作），与页面读的两个 prop 一致。
 */
export const vcRealSubmoduleOpsOf = function (deps: any): any {
  const d: any = deps || {}
  const getManage: any = d.getManage
  const setManage: any = d.setManage
  const subNow = function (): any {
    const m: any = getManage() || {}
    return m.submodules || { board: { state: 'idle', board: null, error: null }, ui: null }
  }
  return createSubmodulesOpsOf({
    callHost: d.callHost,
    cwd: d.cwd,
    ui: function () { return subNow().ui },
    setUi: function (next: any) {
      const m: any = getManage() || {}
      const sub: any = subNow()
      setManage(Object.assign({}, m, { submodules: Object.assign({}, sub, { ui: next }) }))
    },
    board: function () { return subNow().board },
    setBoard: function (next: any) {
      const m: any = getManage() || {}
      const sub: any = subNow()
      setManage(Object.assign({}, m, { submodules: Object.assign({}, sub, { board: next }) }))
    },
  })
}

/**
 * 平台页的处理器：两个请求拉取输入框与「发起请求拉取」。输入框的值存在顶层 ui 的
 * rpStart / rpUrl / rpEnd 上（页面按这三个键读），提交时拼成 form 交给共享读数层。
 */
export const vcRealPlatformHandlersOf = function (deps: any): any {
  const d: any = deps || {}
  const callHost: any = d.callHost
  const cwd: string = String(d.cwd || '')
  const getManage: any = d.getManage
  const setManage: any = d.setManage
  const getUi: any = d.getUi
  const setUi: any = d.setUi
  const patchUi = function (patch: any): void {
    const ui: any = getUi() || {}
    setUi(Object.assign({}, ui, patch))
  }
  const platformNow = function (): any {
    const m: any = getManage() || {}
    return m.platform || { platform: { state: 'idle', data: null, error: null } }
  }
  const setPlatform = function (next: any): void {
    const m: any = getManage() || {}
    setManage(Object.assign({}, m, { platform: next }))
  }
  const refresh = function (): any {
    return Promise.resolve(vcReadPlatform(platformNow(), callHost, cwd)).then(function (next: any) {
      setPlatform(next)
      return null
    })
  }
  const onRpInput = function (key: any, value: any): void {
    const k: string = String(key || '')
    if (k === 'start') patchUi({ rpStart: String(value === undefined || value === null ? '' : value) })
    else if (k === 'url') patchUi({ rpUrl: String(value === undefined || value === null ? '' : value) })
    else if (k === 'end') patchUi({ rpEnd: String(value === undefined || value === null ? '' : value) })
  }
  const onRequestPull = function (form: any): any {
    const f: any = form || {}
    return Promise.resolve(vcRunRequestPull(platformNow(), callHost, cwd, { start: String(f.start || ''), url: String(f.url || ''), end: String(f.end || '') })).then(function (next: any) {
      setPlatform(next)
      return null
    })
  }
  return { refresh: refresh, onRpInput: onRpInput, onRequestPull: onRequestPull }
}

export const VC_REAL_MANAGE_ACTIONS2_SOURCE = 'src/client/views/versionControl/vcRealManageActions2.ts'