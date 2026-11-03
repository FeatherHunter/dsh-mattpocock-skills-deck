// vcSubmodulesOps.ts —— 子模块页的处理层（#1757 T21，域 10 八条）
//
// 三段式的界面半边：start() 发预检电话拿票，confirmNow() 凭票发执行电话或转长任务电话。
// 判定（能不能点、为什么不能点）一律由宿主预检回包给出，这一层不自己算；拿不到回包就按失败处理。
//
// 两条通道的分工：
//   · kind=write（改地址、同步、改跟踪分支、取消登记、吸收 .git）→ wf.gitSubmoduleWrite；
//   · kind=task（新增、初始化并检出、检出记录的提交、更新到远端最新、逐个抓取）→ wf.gitSubmoduleTask。
// 批量四项菜单里「看状态」不走电话，直接重读面板。
//
// 约定：本文件由构建拼进客户端闭包，不写 import；h/t 由页面传入。所有宿主回包先过形状检查，
// 形状不对按失败呈现，绝不当成功。
declare function log(level: any, event: any, fields: any): void
declare function dswsLogHash(v: any): any
declare function dswsLogTrunc(v: any, n?: any): any
declare const SUBMODULE_ACTIONS: any[]
declare const SUBMODULE_WRITE_OPS: string[]
declare const SUBMODULE_TASK_OPS: string[]
// 固定批量菜单表与查表函数（同属共享判定层，构建时排在本文件之前）。
// 为什么需要它：批量菜单里的「初始化」「检出记录的提交」与逐行动作同名，只看动作表的 place 认不出批量身份。
declare function submoduleBatchMenuOf(id: any): any
// 数据层的名字（构建按叶子次序先拼数据层，再拼本文件，所以这里只声明形状、不重复实现）。
declare const VC_SUBMODULES_PHONES: any
declare function vcSubmoduleBoardShapeOk(board: any): boolean
declare function vcSubmodulesUiOf(ui: any): any

export const VC_SUBMODULES_OPS_SOURCE = 'src/client/views/versionControl/vcSubmodulesOps.ts'

/** 请求号：与 #1740 任务、#1752 工作树同款（t + 36 进制时刻 + 净化后的 salt，≤12 字符）。 */
export function vcSubmoduleRequestIdOf(nowMs: any, salt: any): string {
  const base: number = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now()
  const tail: string = String(salt === undefined || salt === null ? '' : salt).replace(/[^A-Za-z0-9]/g, '')
  return ('s' + base.toString(36) + tail).slice(0, 12)
}

/** 预检请求：只送这个动作需要的字段，空串不送（宿主按缺省值校验，不多造字段）。 */
export function vcSubmoduleCheckArgsOf(cwd: any, op: any, input: any, batch?: any): any {
  const i: any = input && typeof input === 'object' ? input : {}
  const out: any = { cwd: String(cwd === undefined || cwd === null ? '' : cwd), op: String(op === undefined || op === null ? '' : op) }
  if (batch === true) out.batch = true
  if (i.path !== undefined && String(i.path) !== '') out.path = String(i.path)
  if (i.url !== undefined && String(i.url) !== '') out.url = String(i.url)
  if (i.branch !== undefined && String(i.branch) !== '') out.branch = String(i.branch)
  return out
}

/** 凭票执行请求（写通道）：票号、请求号、显式确认，动作参数仍由宿主按票里的计划拼。 */
export function vcSubmoduleRunArgsOf(cwd: any, op: any, ticketId: any, requestId: any, plan: any): any {
  const p: any = plan && typeof plan === 'object' ? plan : {}
  const out: any = { cwd: String(cwd === undefined || cwd === null ? '' : cwd), op: String(op === undefined || op === null ? '' : op), ticketId: String(ticketId === undefined || ticketId === null ? '' : ticketId), requestId: String(requestId === undefined || requestId === null ? '' : requestId), confirmed: true }
  if (p.path !== undefined && String(p.path) !== '') out.path = String(p.path)
  if (p.url !== undefined && String(p.url) !== '') out.url = String(p.url)
  if (p.branch !== undefined && String(p.branch) !== '') out.branch = String(p.branch)
  return out
}

/** 任务请求（长任务通道）：动作参数不在客户端拼，宿主按票里的计划取；只送票号与确认。 */
export function vcSubmoduleTaskArgsOf(cwd: any, op: any, ticketId: any, requestId: any): any {
  return {
    cwd: String(cwd === undefined || cwd === null ? '' : cwd),
    op: String(op === undefined || op === null ? '' : op),
    ticketId: String(ticketId === undefined || ticketId === null ? '' : ticketId),
    requestId: String(requestId === undefined || requestId === null ? '' : requestId),
    confirmed: true,
  }
}

/** 失败信封 → 页面可直接呈现的形状：理由标识符原样保留（界面按 vc.sub.why.<理由> 取词条）。 */
export function vcSubmoduleFailureOf(reply: any): any {
  const r: any = reply && typeof reply === 'object' ? reply : {}
  const err: any = r.error && typeof r.error === 'object' ? r.error : {}
  return {
    kind: String(err.kind || r.kind || 'shape'),
    reason: String(err.reason || r.reason || ''),
    message: String(err.message || r.message || ''),
    step: String(err.step || r.step || ''),
    expected: String(err.expected || r.expected || ''),
    actual: String(err.actual || r.actual || ''),
    cause: String(err.cause || r.cause || ''),
    gitText: String(err.git || r.git || err.gitText || r.gitText || ''),
  }
}

/** 成功回执 → 结果块形状；形状不对回 null（调用方按失败处理）。 */
export function vcSubmoduleResultOf(reply: any): any {
  const r: any = reply && typeof reply === 'object' ? reply : {}
  if (r.ok !== true) return null
  const task: any = r.task && typeof r.task === 'object' ? r.task : null
  return {
    state: 'ok',
    op: String(r.op || ''),
    command: String(r.command || ''),
    ms: typeof r.ms === 'number' ? r.ms : null,
    n: typeof r.n === 'number' ? r.n : null,
    path: String(r.path || ''),
    moves: Array.isArray(r.moves) ? r.moves : [],
    taskId: task ? String(task.taskId || task.id || '') : String(r.taskId || ''),
  }
}

/** 预检回包的票据与计划：形状不对回 null（缺票就不能执行）。 */
export function vcSubmoduleTicketOf(reply: any): any {
  const r: any = reply && typeof reply === 'object' ? reply : {}
  const t: any = r.ticket && typeof r.ticket === 'object' ? r.ticket : null
  if (!t || !t.id) return null
  return { id: String(t.id), op: String(t.op || ''), expiresAtMs: typeof t.expiresAtMs === 'number' ? t.expiresAtMs : 0 }
}

/** 一条动作的登记项：动作名 → 动作表里那一条；不是表里的名字回 null。 */
function vcSubmoduleActionOfId(id: any): any {
  const want: string = String(id === undefined || id === null ? '' : id)
  for (let i = 0; i < SUBMODULE_ACTIONS.length; i += 1) { const a: any = SUBMODULE_ACTIONS[i]; if (a && a.id === want) return a }
  return null
}

/** 造处理函数：deps 由页面/外壳传进来（callHost、cwd、ui 读写、board 读写）。 */
export function createSubmodulesOpsOf(deps: any): any {
  const d: any = deps || {}
  const callHost: any = typeof d.callHost === 'function' ? d.callHost : function (): any { return Promise.resolve({ ok: false, error: { kind: 'env', message: 'no-host' } }) }
  const cwd: string = String(d.cwd === undefined || d.cwd === null ? '' : d.cwd)
  const uiOf: any = typeof d.ui === 'function' ? d.ui : function (): any { return null }
  const setUi: any = typeof d.setUi === 'function' ? d.setUi : function (): void {}
  const boardOf: any = typeof d.board === 'function' ? d.board : function (): any { return null }
  const setBoard: any = typeof d.setBoard === 'function' ? d.setBoard : function (): void {}

  function patch(next: any): any {
    const base: any = vcSubmodulesUiOf(uiOf())
    setUi(Object.assign({}, base, next || {}))
    return Object.assign({}, base, next || {})
  }
  function logCall(method: string, ok: any, latencyMs: any): void {
    try { log('info', 'host.call', { method: method, latencyMs: latencyMs, ok: ok === true, kind: 'git-submodule' }) } catch (e) { /* 日志失败不影响界面 */ }
  }
  async function refresh(): Promise<any> {
    patch({ mode: 'reading', error: null })
    const startedAt: number = Date.now()
    let reply: any = null
    try { reply = await callHost(VC_SUBMODULES_PHONES.read, { cwd: cwd }) } catch (e) { reply = { ok: false, error: { kind: 'env', message: String((e && (e as any).message) || e) } } }
    logCall(VC_SUBMODULES_PHONES.read, reply && reply.ok === true, Date.now() - startedAt)
    if (reply && reply.ok === true && vcSubmoduleBoardShapeOk(reply)) { setBoard({ state: 'ok', board: reply, error: null }); patch({ mode: 'board' }); return reply }
    const failure: any = vcSubmoduleFailureOf(reply)
    setBoard({ state: 'error', board: null, error: failure })
    patch({ mode: 'failed', error: failure })
    return null
  }
  /** 点一条动作：先预检签票；批量菜单的「看状态」例外（不走电话，直接重读面板）。 */
  async function start(actionId: any, preset?: any): Promise<any> {
    const id: string = String(actionId === undefined || actionId === null ? '' : actionId)
    const base: any = vcSubmodulesUiOf(uiOf())
    const input: any = Object.assign({}, base.field, preset || {})
    const action: any = vcSubmoduleActionOfId(id)
    if (!action) { patch({ mode: 'failed', error: { kind: 'invalid', reason: 'unknown-action', message: '页面里没有这个动作' } }); return null }
    if (action.kind === 'read') return refresh()
    // 批量身份有两种来源：动作表里 place=batch 的逐条动作（抓取），以及固定批量菜单里的同名动作
    // （初始化、检出记录的提交）。后者也属于菜单，必须把 batch=true 送进预检——只按动作表判会把它们
    // 当逐行动作，空路径必然被 path-blank 拦住，页面上的批量按钮就永远点不通。
    const menuItem: any = submoduleBatchMenuOf(id)
    const batch: boolean = action.place === 'batch' || (menuItem !== null && menuItem !== undefined)
    patch({ mode: 'reading', op: id, batch: batch, error: null, plan: null, ticket: null, decision: null, reasons: [] })
    const startedAt: number = Date.now()
    let reply: any = null
    try { reply = await callHost(VC_SUBMODULES_PHONES.check, vcSubmoduleCheckArgsOf(cwd, id, input, batch)) } catch (e) { reply = { ok: false, error: { kind: 'env', message: String((e && (e as any).message) || e) } } }
    logCall(VC_SUBMODULES_PHONES.check, reply && reply.ok === true, Date.now() - startedAt)
    if (!reply || reply.ok !== true) {
      const failure: any = vcSubmoduleFailureOf(reply)
      const blocked: boolean = failure.kind === 'blocked'
      patch({ mode: blocked ? 'blocked' : 'failed', error: failure, reasons: blocked ? [failure.reason] : [] })
      return null
    }
    const ticket: any = vcSubmoduleTicketOf(reply)
    if (!ticket) { patch({ mode: 'failed', error: { kind: 'shape', message: '预检回包里没有票号' } }); return null }
    const plan: any = reply.plan && typeof reply.plan === 'object' ? reply.plan : { action: id }
    patch({ mode: 'confirm', op: id, batch: batch, ticket: ticket, plan: plan, decision: reply.decision || null, reasons: Array.isArray(reply.reasons) ? reply.reasons : [], error: null })
    return reply
  }
  function field(name: any, value: any): any {
    const key: string = String(name === undefined || name === null ? '' : name)
    if (key !== 'path' && key !== 'url' && key !== 'branch') return null
    const base: any = vcSubmodulesUiOf(uiOf())
    const nextField: any = Object.assign({}, base.field)
    nextField[key] = String(value === undefined || value === null ? '' : value)
    return patch({ field: nextField })
  }
  /** 点确认：按计划决定走执行电话还是任务电话；成功就重读面板并贴结果。 */
  async function confirmNow(): Promise<any> {
    const base: any = vcSubmodulesUiOf(uiOf())
    if (base.mode !== 'confirm' || !base.ticket) { patch({ mode: 'failed', error: { kind: 'invalid', reason: 'confirm-required', message: '还没有预检过，或确认卡已经关了' } }); return null }
    const plan: any = base.plan || {}
    const op: string = String(plan.action || base.op || '')
    const task: boolean = plan.kind === 'task'
    const requestId: string = vcSubmoduleRequestIdOf(Date.now(), base.ticket.id)
    patch({ mode: 'running', requestId: requestId })
    const startedAt: number = Date.now()
    let reply: any = null
    try {
      reply = task
        ? await callHost(VC_SUBMODULES_PHONES.task, vcSubmoduleTaskArgsOf(cwd, op, base.ticket.id, requestId))
        : await callHost(VC_SUBMODULES_PHONES.write, vcSubmoduleRunArgsOf(cwd, op, base.ticket.id, requestId, plan))
    } catch (e) { reply = { ok: false, error: { kind: 'env', message: String((e && (e as any).message) || e) } } }
    logCall(task ? VC_SUBMODULES_PHONES.task : VC_SUBMODULES_PHONES.write, reply && reply.ok === true, Date.now() - startedAt)
    if (!reply || reply.ok !== true) {
      const failure: any = vcSubmoduleFailureOf(reply)
      patch({ mode: 'failed', error: failure, ticket: null })
      return null
    }
    const result: any = vcSubmoduleResultOf(reply)
    patch({ mode: 'done', result: result, error: null, ticket: null, reasons: [] })
    void refresh()
    return reply
  }
  function cancelConfirm(): any {
    return patch({ mode: 'board', ticket: null, plan: null, decision: null, reasons: [], error: null })
  }
  function retry(): any {
    const base: any = vcSubmodulesUiOf(uiOf())
    if (base.mode === 'blocked') return patch({ mode: 'board', error: null, reasons: [] })
    if (base.op) return start(base.op, null)
    return refresh()
  }
  return { refresh: refresh, start: start, field: field, confirmNow: confirmNow, cancelConfirm: cancelConfirm, retry: retry, uiOf: uiOf, boardOf: boardOf }
}

export const VC_SUBMODULES_OPS_EXPORTS = 'vcSubmodulesOps'
