// views/versionControl/vcRealManageActions3.ts —— 迁移页、迁移导出向导与任务轮询的动作装配（#1776 M2）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 迁移页的动作按钮不带回调（页面由事件委托驱动），所以标签页要按动作号发预检电话、凭预检
// 签出的票执行；导出向导是组件，回调由它自己调到这里。任务区每轮问一次宿主，运行数从有
// 到无时触发一次「任务完成后」刷新，恰好一次；轮询间隔来自 config/intervals.yaml，不写死。

declare function vcReadMigrateCheck(reads: any, call: any, cwd: any, action: any, input: any): any
declare function vcRunMigrateWrite(reads: any, call: any, cwd: any, ticketId: any, action: any, requestId: any, confirmed: any): any
declare function vcRunMigrateCheck(state: any, call: any, cwd: any): any
declare function vcRunMigrateExport(state: any, call: any, cwd: any): any
declare function vcReadPatchFiles(reads: any, call: any, cwd: any, dir: any): any
declare function vcTaskQuery(call: any): any
declare function vcTaskCancel(call: any, taskId: any): any
declare const VC_TASK_POLL_INTERVAL_MS: any
declare function vcRealRequestIdOf(nowMs: any, salt: any): string

/**
 * 迁移页处理器。readFields(action) 由容器提供，负责从当前面板里读出输入框的值——
 * 页面输入框是非受控的，值只在 DOM 里，这一层不自己扫 DOM，也不替页面做表单校验。
 *   check(action) 预检（只读动作这一步就读出结果）；go(action) 凭票执行；cancel() 收起面板。
 */
export const vcRealMigrateHandlersOf = function (deps: any): any {
  const d: any = deps || {}
  const callHost: any = d.callHost
  const cwd: string = String(d.cwd || '')
  const nowMs: any = typeof d.nowMs === 'function' ? d.nowMs : function () { return Date.now() }
  const getManage: any = d.getManage
  const setManage: any = d.setManage
  const getUi: any = d.getUi
  const setUi: any = d.setUi
  const readFields: any = typeof d.readFields === 'function' ? d.readFields : function () { return {} }
  const readsNow = function (): any {
    const m: any = getManage() || {}
    return m.migrate || { migrate: { state: 'idle', data: null, error: null }, task: { state: 'idle', data: null, error: null } }
  }
  const setReads = function (next: any): void {
    const m: any = getManage() || {}
    setManage(Object.assign({}, m, { migrate: next }))
  }
  const patchUi = function (patch: any): void {
    const ui: any = getUi() || {}
    setUi(Object.assign({}, ui, patch))
  }
  const open = function (action: any): void {
    patchUi({ open: String(action || ''), result: null })
  }
  const check = function (action: any): any {
    const fields: any = readFields(action) || {}
    return Promise.resolve(vcReadMigrateCheck(readsNow(), callHost, cwd, action, fields)).then(function (next: any) {
      setReads(next)
      return null
    })
  }
  const go = function (action: any): any {
    const slot: any = readsNow().migrate || {}
    const data: any = slot.data || {}
    const ticket: any = data.ticket || null
    if (!ticket || !ticket.id) return Promise.resolve(null)
    return Promise.resolve(vcRunMigrateWrite(readsNow(), callHost, cwd, ticket.id, action, vcRealRequestIdOf(nowMs(), 'mig'), true)).then(function (next: any) {
      setReads(next)
      return null
    })
  }
  const cancel = function (): void {
    patchUi({ open: '' })
  }
  // 导出向导的状态与补丁目录读数分两个槽：向导只管进度，补丁清单是平台页那张读数。
  const exNow = function (): any {
    const m: any = getManage() || {}
    return m.migrateExport || {}
  }
  const setEx = function (next: any): void {
    const m: any = getManage() || {}
    setManage(Object.assign({}, m, { migrateExport: next }))
  }
  const patchesNow = function (): any {
    const m: any = getManage() || {}
    return m.migratePatches || {}
  }
  const exportEdit = function (key: any, value: any): void {
    const st: any = exNow()
    const patch: any = {}
    patch[String(key || '')] = String(value === undefined || value === null ? '' : value)
    setEx(Object.assign({}, st, patch))
  }
  const exportCheck = function (range: any, dir: any): any {
    const st: any = Object.assign({}, exNow(), { range: String(range || ''), dir: String(dir || '') })
    setEx(st)
    return Promise.resolve(vcRunMigrateCheck(st, callHost, cwd)).then(function (next: any) {
      setEx(next)
      return null
    })
  }
  const exportRun = function (): any {
    return Promise.resolve(vcRunMigrateExport(exNow(), callHost, cwd)).then(function (next: any) {
      setEx(next)
      return null
    })
  }
  const exportRescan = function (dir: any): any {
    return Promise.resolve(vcReadPatchFiles(patchesNow(), callHost, cwd, String(dir || ''))).then(function (next: any) {
      const m: any = getManage() || {}
      setManage(Object.assign({}, m, { migratePatches: next }))
      return null
    })
  }
  const exportCancel = function (): void {
    setEx(Object.assign({}, exNow(), { ticket: null }))
  }
  return {
    open: open, check: check, go: go, cancel: cancel,
    exportEdit: exportEdit, exportCheck: exportCheck, exportRun: exportRun, exportRescan: exportRescan, exportCancel: exportCancel,
  }
}

/**
 * 任务区轮询。每轮问一次任务清单，把清单与运行中计数写回管理状态；
 * 运行数从「有」落到「无」时调一次 onIdleDone（用来按「任务完成后」重读首屏），
 * 首次查询 running 本来就是 0，不算完成，避免进入页面就多发一轮首屏读。
 */
export const vcRealTaskPollerOf = function (deps: any): any {
  const d: any = deps || {}
  const callHost: any = d.callHost
  const getManage: any = d.getManage
  const setManage: any = d.setManage
  const onIdleDone: any = typeof d.onIdleDone === 'function' ? d.onIdleDone : function () {}
  let lastRunning = -1
  const tick = function (): any {
    return Promise.resolve(vcTaskQuery(callHost)).then(function (reply: any) {
      const r: any = reply || {}
      const list: any[] = Array.isArray(r.tasks) ? r.tasks : (Array.isArray(r.items) ? r.items : [])
      const running: number = typeof r.running === 'number' ? r.running : list.filter(function (task: any) { return task && String(task.state || '') === 'running' }).length
      const m: any = getManage() || {}
      setManage(Object.assign({}, m, { tasks: { items: list, running: running } }))
      const prev: number = lastRunning
      lastRunning = running
      if (prev > 0 && running === 0) onIdleDone()
      return null
    })
  }
  const cancel = function (taskId: any): any {
    return Promise.resolve(vcTaskCancel(callHost, taskId)).then(function () { return tick() })
  }
  return { tick: tick, cancel: cancel, intervalMs: Number(VC_TASK_POLL_INTERVAL_MS) || 0 }
}

export const VC_REAL_MANAGE_ACTIONS3_SOURCE = 'src/client/views/versionControl/vcRealManageActions3.ts'
