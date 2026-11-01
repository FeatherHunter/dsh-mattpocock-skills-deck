// views/versionControl/vcRealManageSide.ts —— 冲突向导与变基待办页的动作处理器（#1776 M2）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 两页都按「预检签票 → 页面确认卡 → 凭票执行」走：点主入口先发预检电话，拿到票才亮确认卡，
// 人点了确认才发执行电话；只读动作直接打读数电话。结果落回触发它的那一行（rows[op]）。
// 这一层不判断仓库能不能做，也不自己写失败理由：宿主的 reason 原样往下传，页面照词表显示。

declare function vcConflictsCheckArgsOf(cwd: any, op: any, values: any): any
declare function vcConflictsWriteArgsOf(cwd: any, op: any, values: any, ticketId: any, requestId: any): any
declare function vcConflictsPayloadOf(op: any, values: any): any
declare function vcConflictsRequestIdOf(nowMs: any, salt: any): string
declare function vcRebaseCheckArgsOf(cwd: any, op: any, values: any): any
declare function vcRebaseWriteArgsOf(cwd: any, op: any, values: any, ticketId: any, requestId: any): any
declare function vcRebaseReadArgsOf(cwd: any, op: any, values: any): any
declare function vcRebaseRequestIdOf(nowMs: any, salt: any): string
declare function vcRebaseRowPatchOf(rows: any, index: any, patch: any): any
declare function vcRebaseMoveOf(rows: any, index: any, dir: any): any
declare function splitConflictHunks(text: any): any
declare function applyConflictChoices(text: any, choices: any): any
declare function vcRealRequestIdOf(nowMs: any, salt: any): string
declare const VC_CONFLICTS_PHONES: any
declare const VC_REBASE_PHONES: any

// 电话名沿用既有叶子导出的常量，避免同一组电话在两处各写一遍（名字改了这里必然跟着变）。

/** 把回包折成结果块要的形状：成功给命令与条数，失败把宿主原话与环节原样留下。 */
const vcRealWriteResultOf = function (reply: any): any {
  const r: any = reply || {}
  if (r.ok === true) return { ok: true, cmd: String(r.command || r.cmd || ''), ms: typeof r.ms === 'number' ? r.ms : null, n: typeof r.n === 'number' ? r.n : null }
  const e: any = r.error || {}
  return { ok: false, error: { kind: String(e.kind || 'host'), message: String(e.message || ''), reason: String(e.reason || '') } }
}

/**
 * 冲突页的八个处理器。页面把这些挂在 c.handlers 上：
 *   begin(op,payload) 预检并停确认卡；run(op,payload,{ticketId,requestId}) 凭票执行；
 *   read(op,payload) 只读；cancel(op) 收确认卡；onValue(field,value) 与 onTakeSide(path,side)
 *   是页面输入与文件旁路按钮；onHunkChoice/onCompose 负责逐块选边后拼出整份文本。
 */
export const vcRealConflictsHandlersOf = function (deps: any): any {
  const d: any = deps || {}
  const callHost: any = d.callHost
  const cwd: string = String(d.cwd || '')
  const nowMs: any = typeof d.nowMs === 'function' ? d.nowMs : function () { return Date.now() }
  const getConflicts: any = d.getConflicts
  const patchConflicts: any = d.patchConflicts
  const t: any = typeof d.translate === 'function' ? d.translate : function (key: string) { return key }
  const getRow = function (c: any, op: any): any { return (c.rows && c.rows[String(op)]) ? c.rows[String(op)] : {} }
  const putRow = function (c: any, op: any, row: any): any {
    const rows: any = Object.assign({}, c.rows || {})
    rows[String(op)] = row
    return Object.assign({}, c, { rows: rows })
  }
  const readList = function (): any {
    const c: any = getConflicts() || {}
    return Promise.resolve(callHost(VC_CONFLICTS_PHONES.read, { cwd: cwd, op: 'conflict-list' })).then(function (reply: any) {
      const reads: any = Object.assign({}, c.reads || {})
      reads['conflict-list'] = reply
      patchConflicts(Object.assign({}, c, { reads: reads }))
      return null
    })
  }
  const begin = function (op: any, payload: any): any {
    const c: any = getConflicts() || {}
    const values: any = Object.assign({}, c.values || {}, payload || {})
    const row: any = Object.assign({}, getRow(c, op), { busy: true })
    patchConflicts(putRow(Object.assign({}, c, { values: values }), op, row))
    return Promise.resolve(callHost(VC_CONFLICTS_PHONES.check, vcConflictsCheckArgsOf(cwd, op, values))).then(function (reply: any) {
      const cur: any = getConflicts() || {}
      const r: any = reply || {}
      const ticket: any = r.ticket || null
      const needConfirm: boolean = r.ok === true && (r.confirmRequired === true || !!ticket)
      if (!needConfirm) {
        const result: any = vcRealWriteResultOf(r)
        if (r.ok === true) return run(op, payload, { ticketId: '', requestId: '' })
        patchConflicts(putRow(Object.assign({}, cur, { values: values }), op, Object.assign({}, getRow(cur, op), { busy: false, result: result })))
        return null
      }
      const confirm: any = { ticketId: String(ticket ? ticket.id : ''), requestId: vcConflictsRequestIdOf(nowMs(), op), verb: String((r.confirm || {}).verb || ''), target: String((r.confirm || {}).target || '') }
      patchConflicts(putRow(Object.assign({}, cur, { values: values }), op, Object.assign({}, getRow(cur, op), { busy: false, confirm: confirm })))
      return null
    })
  }
  const run = function (op: any, payload: any, ticket: any): any {
    const c: any = getConflicts() || {}
    const values: any = Object.assign({}, c.values || {}, payload || {})
    // 局部变量不能叫 t：那会遮蔽上面那个翻译函数，下面「没有票」的兜底一调用就抛 TypeError。
    const tk: any = ticket || {}
    const ticketId: string = String(tk.ticketId || '')
    if (ticketId === '') {
      patchConflicts(putRow(Object.assign({}, c, { values: values }), op, Object.assign({}, getRow(c, op), { busy: false, result: { ok: false, error: { kind: 'shape', message: t('vc.shell.live.noTicket'), reason: 'no-ticket' } } })))
      return Promise.resolve(null)
    }
    const requestId: string = String(tk.requestId || vcConflictsRequestIdOf(nowMs(), op))
    return Promise.resolve(callHost(VC_CONFLICTS_PHONES.write, vcConflictsWriteArgsOf(cwd, op, values, ticketId, requestId))).then(function (reply: any) {
      const cur: any = getConflicts() || {}
      const result: any = vcRealWriteResultOf(reply)
      patchConflicts(putRow(Object.assign({}, cur, { values: values }), op, Object.assign({}, getRow(cur, op), { busy: false, confirm: null, result: result })))
      if (result.ok === true) return readList()
      return null
    })
  }
  const read = function (op: any, payload: any): any {
    const c: any = getConflicts() || {}
    const values: any = Object.assign({}, c.values || {}, payload || {})
    return Promise.resolve(callHost(VC_CONFLICTS_PHONES.read, vcConflictsCheckArgsOf(cwd, op, values))).then(function (reply: any) {
      const cur: any = getConflicts() || {}
      const next: any = Object.assign({}, cur, { values: values })
      patchConflicts(putRow(next, op, Object.assign({}, getRow(cur, op), { read: reply })))
      return null
    })
  }
  const cancel = function (op: any): void {
    const c: any = getConflicts() || {}
    patchConflicts(putRow(c, op, Object.assign({}, getRow(c, op), { confirm: null })))
  }
  const onValue = function (field: any, value: any): void {
    const c: any = getConflicts() || {}
    const values: any = Object.assign({}, c.values || {})
    values[String(field)] = String(value === undefined || value === null ? '' : value)
    patchConflicts(Object.assign({}, c, { values: values }))
  }
  // 文件旁的「用当前边 / 用对方边 / 删除」也走三段式：先按 6.6 预检，人确认后才执行。
  const onTakeSide = function (path: any, side: any): any {
    return begin('take-side', { path: String(path || ''), side: String(side || 'ours') })
  }
  const onHunkChoice = function (op: any, index: any, value: any): void {
    const c: any = getConflicts() || {}
    const row: any = Object.assign({}, getRow(c, op))
    const choices: any[] = Array.isArray(row.choices) ? row.choices.slice() : []
    choices[Number(index) || 0] = String(value === undefined || value === null ? '' : value)
    row.choices = choices
    patchConflicts(putRow(c, op, row))
  }
  // 逐块选完边，用共享层把整份内容拼出来，填进 6.7 的文本输入；有一块没选就不拼，交给页面提示。
  const onCompose = function (hunkCount: any, choices: any): void {
    const c: any = getConflicts() || {}
    const row: any = getRow(c, 'conflict-view')
    const text: string = String((row.read && row.read.text) || '')
    const parsed: any = splitConflictHunks(text)
    if (!parsed || parsed.ok !== true) return
    const composed: any = applyConflictChoices(text, choices)
    if (!composed || composed.ok !== true) return
    const values: any = Object.assign({}, c.values || {})
    values.text = String(composed.text || '')
    const target: any = Object.assign({}, getRow(c, 'conflict-view'))
    target.choices = Array.isArray(choices) ? choices.slice() : []
    patchConflicts(putRow(Object.assign({}, c, { values: values }), 'conflict-view', target))
  }
  return { begin: begin, run: run, read: read, cancel: cancel, onValue: onValue, onTakeSide: onTakeSide, onHunkChoice: onHunkChoice, onCompose: onCompose }
}

/**
 * 变基待办页的处理器：预检后停确认卡，确认才执行；四条只读走读数电话并落对应预览槽。
 * 待办清单的改动作/改说明/上移下移只做本地数据变换，不碰电话。
 */
export const vcRealRebaseHandlersOf = function (deps: any): any {
  const d: any = deps || {}
  const callHost: any = d.callHost
  const cwd: string = String(d.cwd || '')
  const nowMs: any = typeof d.nowMs === 'function' ? d.nowMs : function () { return Date.now() }
  const getRebase: any = d.getRebase
  const patchRebase: any = d.patchRebase
  const valuesOf = function (r: any): any {
    const v: any = Object.assign({}, r.values || {})
    v.rows = Array.isArray(r.rows) ? r.rows : []
    return v
  }
  const begin = function (op: any): any {
    const r: any = getRebase() || {}
    const values: any = valuesOf(r)
    const actions: any = Object.assign({}, r.actions || {})
    actions[String(op)] = Object.assign({}, actions[String(op)] || {}, { busy: true })
    patchRebase(Object.assign({}, r, { values: Object.assign({}, r.values || {}), actions: actions, errorText: '' }))
    return Promise.resolve(callHost(VC_REBASE_PHONES.check, vcRebaseCheckArgsOf(cwd, op, values))).then(function (reply: any) {
      const cur: any = getRebase() || {}
      const rr: any = reply || {}
      const acts: any = Object.assign({}, cur.actions || {})
      const ticket: any = rr.ticket || null
      if (rr.ok !== true || !ticket) {
        acts[String(op)] = Object.assign({}, acts[String(op)] || {}, { busy: false, result: vcRealWriteResultOf(rr) })
        patchRebase(Object.assign({}, cur, { actions: acts, confirmOp: '', confirm: null, ticketId: '', errorText: String((rr.error || {}).message || '') }))
        return null
      }
      acts[String(op)] = Object.assign({}, acts[String(op)] || {}, { busy: false })
      patchRebase(Object.assign({}, cur, { actions: acts, confirmOp: String(op), confirm: rr.confirm || null, ticketId: String(ticket.id || '') }))
      return null
    })
  }
  const run = function (op: any, ticketId: any, requestId: any): any {
    const r: any = getRebase() || {}
    const values: any = valuesOf(r)
    const tid: string = String(ticketId || '')
    if (tid === '') return Promise.resolve(null)
    return Promise.resolve(callHost(VC_REBASE_PHONES.write, vcRebaseWriteArgsOf(cwd, op, values, tid, String(requestId || vcRebaseRequestIdOf(nowMs(), op))))).then(function (reply: any) {
      const cur: any = getRebase() || {}
      const acts: any = Object.assign({}, cur.actions || {})
      acts[String(op)] = { busy: false, result: vcRealWriteResultOf(reply) }
      patchRebase(Object.assign({}, cur, { actions: acts, confirmOp: '', confirm: null, ticketId: '', errorText: '' }))
      return null
    })
  }
  const cancel = function (): void {
    const r: any = getRebase() || {}
    patchRebase(Object.assign({}, r, { confirmOp: '', confirm: null, ticketId: '' }))
  }
  // 只读预览：把扁平回包放进页面读的槽（window / onto / pairs / merges / state）。
  const read = function (op: any, payload: any): any {
    const r: any = getRebase() || {}
    const values: any = valuesOf(r)
    const merged: any = Object.assign({}, values, payload || {})
    return Promise.resolve(callHost(VC_REBASE_PHONES.read, vcRebaseReadArgsOf(cwd, op, merged))).then(function (reply: any) {
      const cur: any = getRebase() || {}
      const reads: any = Object.assign({}, cur.reads || {})
      const rr: any = reply || {}
      if (rr.ok !== true) { patchRebase(Object.assign({}, cur, { errorText: String(((rr.error || {}).message) || '') })); return null }
      if (String(op) === 'rebase-state') {
        patchRebase(Object.assign({}, cur, { state: { state: rr.state || null, branch: String(rr.branch || ''), headOid: String(rr.headOid || ''), updateRefs: rr.updateRefs === true }, errorText: '' }))
        return null
      }
      if (String(op) === 'rebase-window') reads.window = { base: rr.base, commits: Array.isArray(rr.commits) ? rr.commits : [], commitCount: Number(rr.commitCount || 0) }
      else if (String(op) === 'rebase-onto-range') reads.onto = { oldBase: rr.oldBase, newBase: rr.newBase, moved: Array.isArray(rr.moved) ? rr.moved : [], movedCount: Number(rr.movedCount || 0), incomingCount: Number(rr.incomingCount || 0) }
      else if (String(op) === 'rebase-autosquash-pairs') reads.pairs = { pairs: Array.isArray(rr.pairs) ? rr.pairs : [] }
      else reads.merges = { mergeCommits: Array.isArray(rr.mergeCommits) ? rr.mergeCommits : [], count: Number(rr.count || 0) }
      patchRebase(Object.assign({}, cur, { reads: reads, errorText: '' }))
      return null
    })
  }
  const setRow = function (index: any, patch: any): void {
    const r: any = getRebase() || {}
    patchRebase(Object.assign({}, r, { rows: vcRebaseRowPatchOf(r.rows, index, patch) }))
  }
  const move = function (index: any, dir: any): void {
    const r: any = getRebase() || {}
    patchRebase(Object.assign({}, r, { rows: vcRebaseMoveOf(r.rows, index, dir) }))
  }
  const setField = function (name: any, value: any): void {
    const r: any = getRebase() || {}
    const values: any = Object.assign({}, r.values || {})
    values[String(name)] = String(value === undefined || value === null ? '' : value)
    patchRebase(Object.assign({}, r, { values: values }))
  }
  return { begin: begin, run: run, cancel: cancel, read: read, setRow: setRow, move: move, setField: setField }
}

export const VC_REAL_MANAGE_SIDE_SOURCE = 'src/client/views/versionControl/vcRealManageSide.ts'
