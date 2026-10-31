// views/versionControl/vcCommitOps.ts —— 提交页动作层（#1743，域 2 八条提交能力）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处。
//
// 这一层只做动作：读界面里当前的提交计划 → 发预检电话拿票 → 危险动作先立确认卡 → 再发执行电话。
// 它不发任何只读电话（身份、签名配置、提交说明模板由 wf.gitCommitForm 一次读回，容器打开页面时调 loadForm），
// 也不排定时器。渲染全在 vcCommitPage.ts；这里返回的每个方法都是给人点的动作。
//
// 为什么危险动作必须先预检再确认：预检会把这次计划绑进票据（planDigest）。确认卡上写的是预检那一刻
// 看到的提交号与目标；确认后执行时宿主还要重算一遍，对不上就拒成 target-changed，
// 所以「预检 2.1、执行 2.3」这种绕过确认的路走不通。
declare const commitPlanOf: any
declare const commitPlanProblem: any
declare const commitPlanDangerous: any
declare const vcRequestIdOf: any

/** 三个电话名集中在这里；界面侧一律走 host.call / host.call.fail，与既有写动作同一出口。 */
export const VC_COMMIT_PHONES: any = {
  form: 'wf.gitCommitForm',
  check: 'wf.gitWriteCheck',
  write: 'wf.gitCommit',
}

/** 提交动作的初始状态：形态选最常用的 2.1，三个开关都不勾，结果与确认卡都不出现。 */
export function vcCommitInitialState(): any {
  return {
    plan: commitPlanOf(null), message: '', state: 'idle',
    form: null, formProblem: '', decision: null, result: null, confirm: null,
  }
}

export const vcCommitOpsOf = function (deps: any) {
  const d = deps || {}
  const ui = d.ui
  const setUi = d.setUi
  const callHost = d.callHost
  const cwd = d.cwd
  const nowMs = typeof d.nowMs === 'function' ? d.nowMs : function () { return Date.now() }
  const onDone = typeof d.onDone === 'function' ? d.onDone : function () { return null }
  let seq = 0
  const state = function (): any { return (ui && ui.commit) || vcCommitInitialState() }
  const setCommit = function (patch: any) {
    setUi(function (cur: any) {
      const prev = (cur && cur.commit) || vcCommitInitialState()
      return Object.assign({}, cur, { commit: Object.assign({}, vcCommitInitialState(), prev, patch || {}) })
    })
  }
  const planNow = function (): any { return commitPlanOf(state().plan) }
  const requestIdOf = function (): string {
    seq += 1
    return 'c' + String(nowMs()).slice(-6) + '-' + String(seq)
  }
  // 身份、签名配置、模板与上一条提交原文一次读回；失败只记下来给面板一句原因，不挡人继续写说明。
  const loadForm = function (): any {
    return Promise.resolve(callHost(VC_COMMIT_PHONES.form, { cwd: cwd })).then(function (reply: any) {
      if (!reply || reply.ok !== true) {
        setCommit({ form: null, formProblem: (reply && reply.error && reply.error.message) || '' })
        return reply
      }
      setCommit({ form: reply, formProblem: '' })
      return reply
    }, function (err: any) {
      setCommit({ form: null, formProblem: String((err && err.message) || err) })
      return null
    })
  }
  // 换形态：-a 与修订不沿用旧的吸收目标；切到修订时把上一条提交的说明预填进来（规格第 3.2 节）。
  const selectMode = function (mode: any): any {
    const plan = planNow()
    plan.mode = commitPlanOf({ mode: mode }).mode
    plan.target = ''
    const patch: any = { plan: plan, decision: null, result: null, confirm: null }
    const form = state().form
    if (plan.mode === 'amend' && form && form.amend && form.amend.available === true) patch.message = String(form.amend.message || '')
    setCommit(patch)
  }
  const selectTarget = function (target: any): any {
    const plan = planNow()
    plan.target = String(target === undefined || target === null ? '' : target)
    setCommit({ plan: plan, decision: null, result: null })
  }
  const setMessage = function (text: any): any {
    setCommit({ message: String(text === undefined || text === null ? '' : text), result: null })
  }
  const toggleOption = function (name: any): any {
    const plan = planNow()
    const key = String(name || '')
    if (key === 'skipHooks' || key === 'sign' || key === 'signoff') plan[key] = plan[key] !== true
    setCommit({ plan: plan, decision: null, result: null })
  }
  // 套用模板 = 把模板原文放进说明输入框；不覆盖已经写好的说明，追加在原文后面。
  const applyTemplate = function (): any {
    const form = state().form
    if (!form || !form.template || form.template.problem || !String(form.template.text || '')) return false
    const text = String(form.template.text || '')
    const cur = String(state().message || '')
    setCommit({ message: cur.trim() === '' ? text : cur + (cur.slice(-1) === '\n' ? '' : '\n') + text, templateApplied: true })
    return true
  }
  const failureOf = function (reply: any, plan: any): any {
    const err = (reply && reply.error) || {}
    return { state: 'fail', reason: String(err.reason || ''), message: String(err.message || ''), hint: String(err.hint || ''), mode: plan.mode }
  }
  const runWrite = function (plan: any, ticketId: any): any {
    setCommit({ state: 'running', result: null, confirm: null })
    const payload = { cwd: cwd, ticketId: ticketId, requestId: requestIdOf(), message: String(state().message || ''), plan: plan }
    return Promise.resolve(callHost(VC_COMMIT_PHONES.write, payload)).then(function (reply: any) {
      if (!reply || reply.ok !== true) {
        const res = failureOf(reply, plan)
        setCommit({ state: 'idle', result: res })
        return res
      }
      const res = { state: 'ok', mode: plan.mode, headAfter: String(reply.headAfter || ''), atMs: Number(reply.atMs || nowMs()), ms: 0, cmd: 'commit' }
      setCommit({ state: 'idle', result: res, decision: null })
      if (plan.mode !== 'amend') setCommit({ message: '' })
      onDone(res)
      return res
    }, function (err: any) {
      const res = { state: 'fail', reason: 'unknown-write-failure', message: String((err && err.message) || err), hint: '', mode: plan.mode }
      setCommit({ state: 'idle', result: res })
      return res
    })
  }
  const runCheck = function (plan: any): any {
    setCommit({ state: 'running', result: null })
    const extra = { cwd: cwd, op: 'commit', message: String(state().message || ''), plan: plan }
    return Promise.resolve(callHost(VC_COMMIT_PHONES.check, extra)).then(function (reply: any) {
      if (!reply || reply.ok !== true) {
        const res = failureOf(reply, plan)
        setCommit({ state: 'idle', decision: (reply && reply.decision) || null, result: res })
        return res
      }
      const ticket = (reply && reply.ticket) || {}
      if (commitPlanDangerous(plan)) {
        // 危险动作：把预检那一刻的计划与票据原样立在确认卡上，等人在卡上点确认才真的写。
        setCommit({ state: 'idle', decision: (reply && reply.decision) || null, confirm: { plan: plan, ticketId: ticket.id, checkedAtMs: ticket.checkedAtMs }, result: null })
        return { state: 'confirm', mode: plan.mode }
      }
      return runWrite(plan, ticket.id)
    }, function (err: any) {
      const res = { state: 'fail', reason: 'unknown-write-failure', message: String((err && err.message) || err), hint: '', mode: plan.mode }
      setCommit({ state: 'idle', result: res })
      return res
    })
  }
  // 提交按钮唯一入口：先按共享的 commitPlanProblem 判计划，再预检；危险动作停在确认卡上。
  const submit = function (): any {
    if (state().state === 'running') return null
    const plan = planNow()
    const problem = commitPlanProblem(plan)
    if (problem) {
      setCommit({ state: 'idle', result: { state: 'fail', reason: problem, message: '', hint: '', mode: plan.mode } })
      return null
    }
    return runCheck(plan)
  }
  const confirmNow = function (): any {
    const confirm = state().confirm
    if (!confirm || !confirm.ticketId) return null
    return runWrite(commitPlanOf(confirm.plan), confirm.ticketId)
  }
  const cancelConfirm = function (): any {
    setCommit({ confirm: null, state: 'idle' })
  }
  const retry = function (): any {
    setCommit({ result: null })
    return submit()
  }
  const clearResult = function (): any { setCommit({ result: null }) }
  return {
    state: state, loadForm: loadForm, selectMode: selectMode, selectTarget: selectTarget,
    setMessage: setMessage, toggleOption: toggleOption, applyTemplate: applyTemplate,
    submit: submit, confirmNow: confirmNow, cancelConfirm: cancelConfirm, retry: retry, clearResult: clearResult,
  }
}
