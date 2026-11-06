// views/versionControl/vcWorktreesOps.ts —— 工作树页的处理层（#1752 T17；#1904 按原型 93–97 补三张就地表单）
//
// 这一层只做四件事：
//   1. 八条能力的输入整形（哪些字段进电话、空值不传），界面不自己拼参数；
//   2. 先过一遍与宿主同源的判定（共享层 worktreeJudge）：版本太老、目标不对这些在打第一枪之前就落「禁用/拦截」，
//      不把注定被拒的请求发出去；界面拿到的理由与宿主预检拒绝时用的是同一套标识符；
//   3. 三段式：预检（check）拿判定与现场 → 确认卡（危险操作）或计划面（prune 清单、稀疏规则）→ 执行（run）并显示结果；
//      #1904 的三张表单（新建 / 移动 / 稀疏检出）例外：表单本身就是要人确认的那一步，提交后直接走
//      「预检 → 凭票执行」，不再多弹一张确认卡（原型 93–97 的按钮就是一步到底）；删除、锁定、清理这些
//      从行里点的危险动作仍然先出确认卡。
//   4. 执行完按 T04 的刷新时机重读首屏（「任务完成后重读」那一档），清单与其它片一起更新。
//
// 长任务通道不在这里：工作树八条都是本地短写（规格第 5 节把它们排除在长任务清单外），
// 所以走的是「预检 + 确认 + 执行」的同步电话，不另起 HTTP 长请求、不占用任务区。
// 本文件在客户端闭包里运行（构建时拼进 src/client/index.ts），不写 import；电话名、判定、行模型都来自闭包内已有实现。

// 下面这些名字在本文件单独过 tsc --noEmit 时看不到：构建按叶子登记次序拼进同一个闭包
// （首屏数据层、工作树数据层先拼，本文件后拼），运行期真实存在。这里只声明形状。
declare function vcReadFirstScreenOnManual(reads: any, call: any, cwd: any): any
declare function vcWorktreeActionOf(op: any): any
declare function vcWorktreesModelOf(reads: any): any
declare function vcWorktreesActionDecisionOf(model: any, op: any, input: any): any
declare function vcWorktreesUiOf(ui: any): any
declare function createWorktreesFormOpsOf(env: any): any

/** 两条工作树电话的名字：与宿主注册（src/host/index.ts）一一对应。 */
export const VC_WORKTREE_PHONES: Record<string, string> = {
  check: 'wf.gitWorktreeCheck',
  run: 'wf.gitWorktreeRun',
}

/** 页面模式的固定清单（门禁按它断言八条能力的每个阶段都有落点）。 */
export const VC_WORKTREE_MODES: string[] = ['idle', 'checking', 'plan', 'confirm', 'blocked', 'running', 'done', 'failed']

/** 调处理函数的桥：处理层对象上没有这个方法（页面壳没接真处理函数时）就安静地什么都不做。 */
export const vcWorktreeCall = function (ops: any, name: string, args?: any[]): any {
  const fn: any = ops ? ops[name] : null
  if (typeof fn !== 'function') return null
  try { return fn.apply(ops, args || []) } catch (e) { return null }
}

/** 从一次点击里取属性：先按 DOM 元素的 getAttribute，再退回假节点（门禁里的 createElement）的 props。 */
export const vcWorktreeAttrOf = function (ev: any, name: string): string {
  const el: any = ev && ev.target ? ev.target : (ev && ev.currentTarget)
  if (!el) return ''
  let v: string = ''
  try { if (el.getAttribute) v = String(el.getAttribute(name) || '') } catch (e) { v = '' }
  if (v === '' && el.props) v = String(el.props[name] === undefined || el.props[name] === null ? '' : el.props[name])
  return v
}

/** 从一次点击里取类名，口径与 vcWorktreeAttrOf 一致（确认卡用类名认「确认」那一枪）。 */
export const vcWorktreeClassOf = function (ev: any): string {
  const el: any = ev && ev.target ? ev.target : (ev && ev.currentTarget)
  if (!el) return ''
  let v: string = ''
  try { if (el.getAttribute) v = String(el.getAttribute('class') || '') } catch (e) { v = '' }
  if (v === '' && el.props) v = String(el.props.className || '')
  return v
}

/** 一次执行请求的 requestId：宿主只要求 [A-Za-z0-9_-] 且不超过 64；同一请求号重放回上次结果。 */
export const vcWorktreeRequestIdOf = function (nowMs: any, salt: any): string {
  return 't' + Number(nowMs || 0).toString(36) + String(salt || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12)
}

const vcWtStr = function (v: any): string {
  return String(v === undefined || v === null ? '' : v)
}




/** 只把有值的输入字段放进电话参数：空串不传，宿主就不会把空串当成一个路径去判。 */
export const vcWorktreeReqOf = function (input: any): any {
  const i: any = input || {}
  const req: any = {}
  if (vcWtStr(i.path) !== '') req.path = vcWtStr(i.path)
  if (vcWtStr(i.dest) !== '') req.dest = vcWtStr(i.dest)
  if (vcWtStr(i.branch) !== '') req.branch = vcWtStr(i.branch)
  if (vcWtStr(i.reason) !== '') req.reason = vcWtStr(i.reason)
  if (Array.isArray(i.dirs) && i.dirs.length > 0) {
    const dirs: string[] = []
    for (let k = 0; k < i.dirs.length; k += 1) if (vcWtStr(i.dirs[k]) !== '') dirs.push(vcWtStr(i.dirs[k]))
    if (dirs.length > 0) req.dirs = dirs
  }
  return req
}

/** 预检参数：cwd + 动作名 + 本次输入（宿主自己认仓库，界面不传仓库根）。 */
export const vcWorktreeCheckArgsOf = function (cwd: any, op: any, input: any): any {
  return Object.assign({ cwd: vcWtStr(cwd), op: vcWtStr(op) }, vcWorktreeReqOf(input))
}

/** 执行参数：预检票据 + 请求号 + confirm 标记 + 同一份输入（宿主逐项复核，输入变了就拒）。 */
export const vcWorktreeRunArgsOf = function (cwd: any, op: any, ticketId: any, requestId: any, input: any): any {
  return Object.assign({
    cwd: vcWtStr(cwd),
    op: vcWtStr(op),
    ticketId: vcWtStr(ticketId),
    requestId: vcWtStr(requestId),
    confirm: true,
  }, vcWorktreeReqOf(input))
}

/** 回包 → 失败对象（带 git 原话、环节、期望与实际、上游原因，界面照抄不另编）。 */
export const vcWorktreeFailureOf = function (reply: any): any {
  if (reply && reply.ok === false) {
    const e: any = reply.error || {}
    return {
      kind: vcWtStr(e.kind || 'unknown'),
      message: vcWtStr(e.message),
      step: vcWtStr(e.step),
      expected: vcWtStr(e.expected),
      actual: vcWtStr(e.actual),
      cause: vcWtStr(e.cause),
      gitText: vcWtStr(e.gitText),
      exitCode: typeof e.exitCode === 'number' ? e.exitCode : null,
    }
  }
  return { kind: 'shape', message: '', step: '', expected: '', actual: '', cause: '', gitText: '', exitCode: null }
}

/** 回包 → 执行结果（宿主已归一成 {state,op,cmd,ms,n,gitText,step,expected,actual,cause}）。 */
export const vcWorktreeResultOf = function (reply: any): any {
  if (!reply || reply.ok !== true || !reply.result) return null
  const r: any = reply.result
  return {
    state: vcWtStr(r.state || 'failed'),
    op: vcWtStr(r.op),
    cmd: vcWtStr(r.cmd),
    ms: typeof r.ms === 'number' ? r.ms : null,
    n: typeof r.n === 'number' ? r.n : null,
    exitCode: typeof r.exitCode === 'number' ? r.exitCode : null,
    gitText: vcWtStr(r.gitText),
    step: vcWtStr(r.step),
    expected: vcWtStr(r.expected),
    actual: vcWtStr(r.actual),
    cause: vcWtStr(r.cause),
  }
}

/** 预检回包 → 计划面（prune 清单、稀疏规则与候选目录、要执行的那条 git 子命令）。 */
export const vcWorktreePlanOf = function (reply: any): any {
  const plan: any = (reply && reply.plan) || {}
  const sparse: any = plan.sparse || null
  return {
    op: vcWtStr(plan.op),
    cmd: vcWtStr(plan.cmd),
    argv: Array.isArray(plan.argv) ? plan.argv.slice(0) : [],
    pruneEntries: Array.isArray(plan.pruneEntries) ? plan.pruneEntries.slice(0) : [],
    dirtyCount: typeof plan.dirtyCount === 'number' ? plan.dirtyCount : null,
    targetPath: vcWtStr(plan.targetPath),
    sparse: sparse ? {
      rules: Array.isArray(sparse.rules) ? sparse.rules.slice(0) : [],
      candidates: Array.isArray(sparse.candidates) ? sparse.candidates.slice(0) : [],
      ruleFile: vcWtStr(sparse.ruleFile),
      dirs: Array.isArray(sparse.dirs) ? sparse.dirs.slice(0) : [],
    } : null,
  }
}

/** 判定对象 → 理由标识符清单（页面逐条翻成人话；没给判定时回空）。 */
export const vcWorktreeDecisionReasonsOf = function (decision: any): string[] {
  const d: any = decision || {}
  const out: string[] = []
  const rs: any[] = Array.isArray(d.reasons) ? d.reasons : (d.reason ? [d.reason] : [])
  for (let i = 0; i < rs.length; i += 1) if (vcWtStr(rs[i]) !== '') out.push(vcWtStr(rs[i]))
  return out
}

/** 判定结论（allow / warn / block）；不认识的结论按 block 处理，绝不默认放行。 */
export const vcWorktreeDecisionStateOf = function (decision: any): string {
  // 共享层 worktreeJudge 的结论字段叫 decision（宿主预检直接读它）；早先这里只读了 state，
  // 于是页面把每一条都当成 block，所有工作树动作按钮在真 DOM 里全是灰的。两个字段都认。
  const d: any = decision || {}
  const raw: any = d.state !== undefined && d.state !== null ? d.state : d.decision
  const s: string = vcWtStr(raw)
  return s === 'allow' || s === 'warn' ? s : 'block'
}

/**
 * 处理层工厂：参数由渲染方注入（callHost、当前目录、读数引用、状态写入），本工厂不碰全局状态。
 * 返回值分两块：核心动作（refresh / start / confirmNow / cancelConfirm / view / retry 等）与
 * #1904 的三张表单动作（由 vcWorktreesFormOps 组装后并进来）。
 */
export const createWorktreesOpsOf = function (deps: any): any {
  const d: any = deps || {}
  const call = d.callHost
  const cwdNow = function (): string { return vcWtStr(d.cwd) }
  const readsNow = function (): any { try { return d.reads ? d.reads() : null } catch (e) { return null } }
  const uiNow = function (): any { try { return d.ui ? d.ui() : null } catch (e) { return null } }
  const wtLog = function (kind: string, t0: any, ok: boolean, extra: any): void {
    try { log('info', 'host.call', Object.assign({ method: VC_WORKTREE_PHONES[kind === 'run' ? 'run' : 'check'], latencyMs: Date.now() - Number(t0 || Date.now()), ok: ok, kind: 'git-worktree' }, extra || {})) } catch (e) { /* 日志坏了不影响读数 */ }
  }
  const setWt = function (patch: any): any {
    const ui: any = uiNow() || {}
    const next: any = Object.assign(vcWorktreesUiOf(ui), patch || {})
    if (d.setUi) d.setUi(Object.assign({}, ui, { worktrees: next }))
    return next
  }
  const setError = function (mode: string, op: string, reply: any): any {
    const err: any = vcWorktreeFailureOf(reply)
    try { log('warn', 'host.call.fail', { method: VC_WORKTREE_PHONES.check, kind: 'git-worktree', errorHash: dswsLogHash(dswsLogTrunc(err.kind + ' ' + err.message, 120, 'error')) }) } catch (e) { /* 日志坏了不影响读数 */ }
    return setWt({ mode: mode, op: op, error: err, decision: null, plan: null, ticket: null, result: null, requestId: '' })
  }
  const refresh = function (): any {
    const reads: any = readsNow() || {}
    return Promise.resolve().then(function () { return vcReadFirstScreenOnManual(reads, call, cwdNow()) }).then(function (next: any) {
      if (d.setReads) d.setReads(next)
      return next
    })
  }

  /** 执行一枪（表单提交时预检之后直接调用；票据、请求号、显式确认一个不少）。 */
  const runNow = function (op: string, input: any, ticket: any, plan: any, options: any, decision: any): any {
    const o: any = options || {}
    const ticketId: string = vcWtStr(ticket && ticket.id)
    const requestId: string = vcWorktreeRequestIdOf(Date.now(), ticketId)
    setWt({ mode: 'running', op: op, input: input, decision: decision, plan: plan, ticket: ticket, requestId: requestId, error: null })
    const t0: any = Date.now()
    return Promise.resolve()
      .then(function () { return call(VC_WORKTREE_PHONES.run, vcWorktreeRunArgsOf(cwdNow(), op, ticketId, requestId, input)) })
      .then(function (reply: any) {
        const ok: boolean = !!(reply && reply.ok === true)
        wtLog('run', t0, ok, { op: op })
        const result: any = vcWorktreeResultOf(reply)
        if (!ok || !result || result.state !== 'done') {
          // 表单三件把失败放回表单 / 页底结果条；旧动作仍落失败卡。
          if (typeof o.onFailure === 'function') o.onFailure(reply, result, '')
          else setError('failed', op, reply)
          return Promise.resolve(refresh()).then(function () { return vcWorktreesUiOf(uiNow()) })
        }
        if (typeof o.onSuccess === 'function') o.onSuccess(result)
        else setWt({ mode: 'done', op: op, result: result, error: null, ticket: null })
        return Promise.resolve(refresh()).then(function () { return vcWorktreesUiOf(uiNow()) })
      })
      .catch(function (err: any) {
        const reply: any = { ok: false, error: { kind: 'throw', message: vcWtStr(err && err.message) } }
        if (typeof o.onFailure === 'function') o.onFailure(reply, null, '')
        else setError('failed', op, reply)
        return vcWorktreesUiOf(uiNow())
      })
  }
  /**
   * 预检 + 按需要执行：表单三件（auto）在预检通过后直接凭票执行；其余动作照旧停在确认面。
   * 失败落点由调用方给的 onFailure 决定（表单 vs 旧三段式），本函数只管预检、票据与执行顺序。
   */
  const begin = function (op: string, input: any, options: any): any {
    const o: any = options || {}
    const opName: string = vcWtStr(op)
    const action: any = vcWorktreeActionOf(opName)
    if (!action) return Promise.resolve(setError('failed', opName, { ok: false, error: { kind: 'bad-op', message: '' } }))
    if (action.retry === true || action.id === 'list') return refresh()
    const model: any = vcWorktreesModelOf(readsNow() || {})
    const decision: any = vcWorktreesActionDecisionOf(model, opName, input)
    if (vcWorktreeDecisionStateOf(decision) === 'block') {
      const rs: string[] = vcWorktreeDecisionReasonsOf(decision)
      if (typeof o.onFailure === 'function') return Promise.resolve(o.onFailure(null, null, rs.length > 0 ? rs[0] : ''))
      return Promise.resolve(setWt({ mode: 'blocked', op: opName, input: input, decision: decision, plan: null, ticket: null, result: null, error: null, requestId: '' }))
    }
    const t0: any = Date.now()
    setWt({ mode: 'checking', op: opName, input: input, decision: decision, plan: null, ticket: null, result: null, error: null, requestId: '' })
    return Promise.resolve()
      .then(function () { return call(VC_WORKTREE_PHONES.check, vcWorktreeCheckArgsOf(cwdNow(), opName, input)) })
      .then(function (reply: any) {
        const ok: boolean = !!(reply && reply.ok === true)
        wtLog('check', t0, ok, { op: opName })
        if (!ok) {
          if (typeof o.onFailure === 'function') return o.onFailure(reply, null, '')
          return setError('failed', opName, reply)
        }
        const nextDecision: any = reply.decision || decision
        if (vcWorktreeDecisionStateOf(nextDecision) === 'block') {
          const rs: string[] = vcWorktreeDecisionReasonsOf(nextDecision)
          if (typeof o.onFailure === 'function') return o.onFailure(reply, null, rs.length > 0 ? rs[0] : '')
          return setWt({ mode: 'blocked', op: opName, input: input, decision: nextDecision, plan: vcWorktreePlanOf(reply), ticket: null, result: null, error: null, requestId: '' })
        }
        const plan: any = vcWorktreePlanOf(reply)
        if (opName === 'sparse-list') {
          // 打开面板时把当前规则与候选目录一起带回：有规则就勾上当前规则，没规则就默认全勾（原型 96）。
          const sparse: any = plan.sparse || {}
          const candidates: string[] = Array.isArray(sparse.candidates) ? sparse.candidates.slice(0) : []
          const rules: string[] = Array.isArray(sparse.rules) ? sparse.rules.slice(0) : []
          const dirs: string[] = []
          if (rules.length > 0) {
            for (let i = 0; i < rules.length; i += 1) if (candidates.length === 0 || candidates.indexOf(rules[i]) >= 0) dirs.push(rules[i])
          } else {
            for (let i = 0; i < candidates.length; i += 1) dirs.push(candidates[i])
          }
          return setWt({
            mode: 'plan', op: opName, input: Object.assign({}, input, { dirs: dirs }), decision: nextDecision, plan: plan,
            ticket: null, result: null, error: null, requestId: '',
            sparse: { path: vcWtStr(input.path), rules: rules, candidates: candidates, ruleFile: vcWtStr(sparse.ruleFile) },
          })
        }
        if (o.auto === true) {
          if (!reply.ticket) {
            if (typeof o.onFailure === 'function') return o.onFailure(reply, null, 'confirm-required')
            return setError('failed', opName, reply)
          }
          return runNow(opName, input, reply.ticket, plan, o, nextDecision)
        }
        return setWt({
          mode: 'confirm', op: opName, input: input, decision: nextDecision, plan: plan,
          ticket: (reply && reply.ticket) || null, result: null, error: null,
          requestId: vcWorktreeRequestIdOf(Date.now(), String((reply && reply.ticket && reply.ticket.id) || opName)),
        })
      })
      .catch(function (err: any) {
        const reply: any = { ok: false, error: { kind: 'throw', message: vcWtStr(err && err.message) } }
        if (typeof o.onFailure === 'function') return o.onFailure(reply, null, '')
        return setError('failed', opName, reply)
      })
  }
  const start = function (op: any, preset: any): any {
    const prev: any = vcWorktreesUiOf(uiNow())
    // 从行里点旧的危险动作时，先把上一件表单留下的结果条收掉：底部只留这一件的结果。
    if (prev.lastResult) setWt({ lastResult: null })
    const input: any = Object.assign({}, prev.input, preset || {})
    return begin(String(op), input, { auto: false })
  }
  const confirmNow = function (): any {
    const prev: any = vcWorktreesUiOf(uiNow())
    if (prev.mode !== 'confirm' || !prev.ticket) {
      return Promise.resolve(setError('failed', prev.op, { ok: false, error: { kind: 'confirm-required', message: '' } }))
    }
    const opName: string = prev.op
    const ticketId: string = vcWtStr(prev.ticket && prev.ticket.id)
    const requestId: string = prev.requestId !== '' ? prev.requestId : vcWorktreeRequestIdOf(Date.now(), ticketId)
    const t0: any = Date.now()
    setWt({ mode: 'running', requestId: requestId, error: null })
    return Promise.resolve()
      .then(function () { return call(VC_WORKTREE_PHONES.run, vcWorktreeRunArgsOf(cwdNow(), opName, ticketId, requestId, prev.input)) })
      .then(function (reply: any) {
        const ok: boolean = !!(reply && reply.ok === true)
        wtLog('run', t0, ok, { op: opName })
        if (!ok) {
          const next: any = setError('failed', opName, reply)
          // 票据过期、现场已变这些失败往往伴随清单变化：顺手重读一次，别让页面停在旧清单上。
          return Promise.resolve(refresh()).then(function () { return next })
        }
        const result: any = vcWorktreeResultOf(reply)
        const next: any = setWt({ mode: 'done', op: opName, result: result, error: null, ticket: null })
        return Promise.resolve(refresh()).then(function () { return next })
      })
      .catch(function (e: any) { return setError('failed', opName, { ok: false, error: { kind: 'throw', message: vcWtStr(e && e.message) } }) })
  }
  const cancelConfirm = function (): any {
    return setWt({ mode: 'idle', op: '', decision: null, plan: null, ticket: null, result: null, error: null, requestId: '' })
  }
  const field = function (name: any, value: any): any {
    const key: string = vcWtStr(name)
    if (['path', 'dest', 'branch', 'reason'].indexOf(key) < 0) return vcWorktreesUiOf(uiNow())
    const prev: any = vcWorktreesUiOf(uiNow())
    const input: any = Object.assign({}, prev.input)
    input[key] = vcWtStr(value)
    return setWt({ input: input })
  }
  const pickDir = function (dir: any, on: any): any {
    const value: string = vcWtStr(dir)
    const prev: any = vcWorktreesUiOf(uiNow())
    const has: boolean = prev.input.dirs.indexOf(value) >= 0
    const dirs: string[] = prev.input.dirs.slice(0)
    if (on === true && !has && value !== '') dirs.push(value)
    if (on !== true && has) dirs.splice(dirs.indexOf(value), 1)
    const input: any = Object.assign({}, prev.input, { dirs: dirs })
    return setWt({ input: input })
  }
  // 版式上的两个开关（筛选 chip、说明条开合）只写界面读数：不碰模式面，也不发任何电话。
  const view = function (patch: any): any {
    const p: any = patch || {}
    const next: any = {}
    if (p.filter !== undefined) next.filter = p.filter === 'abnormal' ? 'abnormal' : 'all'
    if (p.noteOpen !== undefined) next.noteOpen = p.noteOpen !== false
    if (Object.keys(next).length === 0) return vcWorktreesUiOf(uiNow())
    return setWt(next)
  }
  const retry = function (): any {
    const prev: any = vcWorktreesUiOf(uiNow())
    if (prev.mode === 'blocked') return setWt({ mode: 'idle', decision: null, plan: null, error: null })
    if (prev.op === '') return refresh()
    return start(prev.op, prev.input)
  }
  const formOps: any = typeof createWorktreesFormOpsOf === 'function'
    ? createWorktreesFormOpsOf({ begin: begin, setWt: setWt, uiNow: uiNow, readsNow: readsNow, uiOf: vcWorktreesUiOf, pickDir: pickDir })
    : {}
  return Object.assign({
    refresh: refresh,
    start: start,
    field: field,
    pickDir: pickDir,
    confirmNow: confirmNow,
    cancelConfirm: cancelConfirm,
    view: view,
    retry: retry,
  }, formOps)
}