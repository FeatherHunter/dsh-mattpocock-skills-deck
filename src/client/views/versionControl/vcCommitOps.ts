// views/versionControl/vcCommitOps.ts —— 提交页动作层（#1743，域 2 八条提交能力；#1877 按原型分成形态 / 内容来源）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处。
//
// 这一层只做动作：读界面里当前的提交计划 → 发预检电话拿票 → 危险动作先立确认卡 → 再发执行电话。
// 它不发任何只读电话（身份、签名配置、提交说明模板由 wf.gitCommitForm 一次读回，容器打开页面时调 loadForm），
// 也不排定时器。渲染全在 vcCommitPage.ts 与 vcCommitOptions.ts；这里返回的每个方法都是给人点的动作。
//
// 为什么危险动作必须先预检再确认：预检会把这次计划绑进票据（planDigest）。确认卡上写的是预检那一刻
// 看到的提交号与目标；确认后执行时宿主还要重算一遍，对不上就拒成 target-changed，
// 所以「预检 2.1、执行 2.3」这种绕过确认的路走不通。
//
// #1877 起计划里分成两个字段：mode 是这次提交以什么形态记下来（新提交 / 修订 / fixup / squash），
// all 是这次提交收哪些内容（把已跟踪的未暂存改动也一起提交）。界面上形态选一个、内容来源是一个开关，
// 两者可以同时成立（例如「修订 + 一起提交」），所以动作层不再把 -a 当成一种形态来切换。
declare const commitPlanOf: any
declare const commitPlanProblem: any
declare const commitPlanDangerous: any
// #1877：自动说明与修订预填的口径与提交页共用一份（拿掉重复拼前缀的地方）。
declare const commitAutoMessageOf: any
declare const commitAmendMessageOf: any
declare const vcRequestIdOf: any

/** 三个电话名集中在这里；界面侧一律走 host.call / host.call.fail，与既有写动作同一出口。 */
export const VC_COMMIT_PHONES: any = {
  form: 'wf.gitCommitForm',
  check: 'wf.gitWriteCheck',
  write: 'wf.gitCommit',
}

/** 提交动作的初始状态：形态是新提交，三个开关都不勾，结果与确认卡都不出现。
 *  提交选项（提交形态、内容来源、说明模板、钩子与签名）默认收起；原型首屏只有三块，没有第四行折叠。 */
export function vcCommitInitialState(): any {
  return {
    plan: commitPlanOf(null), message: '', state: 'idle',
    form: null, formProblem: '', decision: null, result: null, confirm: null,
    menuOpen: false, templateApplied: false,
    messageBeforeTemplate: '',
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
  /** 上一条提交：fixup / squash 的吸收对象与修订预填的说明都从这里来。 */
  const headNow = function (): any {
    const form = state().form
    return form && form.amend && form.amend.available === true ? form.amend : null
  }
  /** 真正要执行的那份计划：fixup / squash 的吸收目标按原型固定为「上一条提交」，
   *  所以这里从读回的表单补上目标，界面不再画一个「吸收进哪条提交」的下拉框。 */
  const effectivePlan = function (): any {
    const plan = planNow()
    if (plan.mode === 'fixup' || plan.mode === 'squash') {
      const head = headNow()
      plan.target = head ? String(head.oid || '') : ''
    }
    return plan
  }
  /** 真正要写进提交的说明：fixup / squash 由面板按前缀自动写成，人不该手打；别的形态用输入框里的原文。 */
  const effectiveMessage = function (plan: any): string {
    const auto = commitAutoMessageOf(plan, headNow())
    return auto !== '' ? auto : String(state().message || '')
  }
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
  // 换形态：只改 mode，内容来源（all）与三个记录方式各自保持不动。
  // 切到修订时把上一条提交的说明预填进输入框；切回新提交时，只有输入框里还是那句原话才清掉，
  // 用户自己改过的内容一律保留（原型同一条规矩）。
  const selectForm = function (mode: any): any {
    const plan = planNow()
    const next = commitPlanOf({ mode: mode })
    plan.mode = next.mode
    const patch: any = { plan: plan, decision: null, result: null, confirm: null }
    const head = headNow()
    if (plan.mode === 'amend' && head && String(state().message || '').trim() === '') patch.message = commitAmendMessageOf(head)
    else if (plan.mode === 'staged' && head && String(state().message || '').trim() === commitAmendMessageOf(head).trim()) patch.message = ''
    setCommit(patch)
  }
  // 内容来源（2.2）：把已跟踪的未暂存改动也一起提交，等于 git commit -a；与形态互不影响。
  const toggleAll = function (): any {
    const plan = planNow()
    plan.all = plan.all !== true
    setCommit({ plan: plan, decision: null, result: null })
  }
  const setMessage = function (text: any): any {
    // 改说明不清掉「已套用模板」：原型的同一条规矩是「套用之后按钮一直写着撤销套用」，
    //   人改完再点撤销会回到套用前那一份（撤销就是撤销，不是撤销最近一次输入）。
    setCommit({ message: String(text === undefined || text === null ? '' : text), result: null })
  }
  const toggleOption = function (name: any): any {
    const plan = planNow()
    const key = String(name || '')
    if (key === 'skipHooks' || key === 'sign' || key === 'signoff') plan[key] = plan[key] !== true
    setCommit({ plan: plan, decision: null, result: null })
  }
  // 套用模板 = 用模板原文替换输入框里的说明；套用前那一份留着，同一个按钮再点一次就撤销回来。
  // 为什么是替换不是追加：模板是一份完整的提交说明骨架，追加在旧说明后面只会写进两条互相打架的说明。
  const applyTemplate = function (): any {
    const form = state().form
    if (!form || !form.template || form.template.problem || !String(form.template.text || '')) return false
    setCommit({ message: String(form.template.text || ''), messageBeforeTemplate: String(state().message || ''), templateApplied: true, result: null })
    return true
  }
  const undoTemplate = function (): any {
    if (state().templateApplied !== true) return false
    setCommit({ message: String(state().messageBeforeTemplate || ''), templateApplied: false, result: null })
    return true
  }
  const failureOf = function (reply: any, plan: any): any {
    const err = (reply && reply.error) || {}
    return { state: 'fail', reason: String(err.reason || ''), message: String(err.message || ''), hint: String(err.hint || ''), mode: plan.mode }
  }
  const runWrite = function (plan: any, ticketId: any, message: any): any {
    setCommit({ state: 'running', result: null, confirm: null })
    const payload = { cwd: cwd, ticketId: ticketId, requestId: requestIdOf(), message: message, plan: plan }
    return Promise.resolve(callHost(VC_COMMIT_PHONES.write, payload)).then(function (reply: any) {
      if (!reply || reply.ok !== true) {
        const res = failureOf(reply, plan)
        setCommit({ state: 'idle', result: res })
        return res
      }
      const res = { state: 'ok', mode: plan.mode, headAfter: String(reply.headAfter || ''), atMs: Number(reply.atMs || nowMs()), ms: 0, cmd: 'commit' }
      // 一次提交成功之后这次的选择已经用掉了：形态回到新提交、三个记录方式与「一起提交」一起归零、
      //   说明清空、展开区收起。留着它们只会让人以为下一次提交还按老样子来（原型同一条规矩）。
      setCommit({
        state: 'idle', result: res, decision: null, confirm: null,
        plan: commitPlanOf(null), message: '', menuOpen: false, templateApplied: false, messageBeforeTemplate: '',
      })
      onDone(res)
      return res
    }, function (err: any) {
      const res = { state: 'fail', reason: 'unknown-write-failure', message: String((err && err.message) || err), hint: '', mode: plan.mode }
      setCommit({ state: 'idle', result: res })
      return res
    })
  }
  const runCheck = function (plan: any, message: any): any {
    setCommit({ state: 'running', result: null })
    const extra = { cwd: cwd, op: 'commit', message: message, plan: plan }
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
      return runWrite(plan, ticket.id, message)
    }, function (err: any) {
      const res = { state: 'fail', reason: 'unknown-write-failure', message: String((err && err.message) || err), hint: '', mode: plan.mode }
      setCommit({ state: 'idle', result: res })
      return res
    })
  }
  // 提交按钮唯一入口：先按共享的 commitPlanProblem 判计划，再预检；危险动作停在确认卡上。
  const submit = function (): any {
    if (state().state === 'running') return null
    const plan = effectivePlan()
    const problem = commitPlanProblem(plan)
    if (problem) {
      setCommit({ state: 'idle', result: { state: 'fail', reason: problem, message: '', hint: '', mode: plan.mode } })
      return null
    }
    return runCheck(plan, effectiveMessage(plan))
  }
  const confirmNow = function (): any {
    const confirm = state().confirm
    if (!confirm || !confirm.ticketId) return null
    const plan = commitPlanOf(confirm.plan)
    return runWrite(plan, confirm.ticketId, effectiveMessage(plan))
  }
  const cancelConfirm = function (): any {
    setCommit({ confirm: null, state: 'idle' })
  }
  const retry = function (): any {
    setCommit({ result: null })
    return submit()
  }
  const clearResult = function (): any { setCommit({ result: null }) }
  // 提交选项的开合：菜单里的每一次选择都保持菜单开着（连着调形态与内容来源才顺手），
  //   再点一次箭头、按 Esc、点浮层外面或换页签才收起。打开时顺手重读一次表单：
  //   上一条提交可能就是这一会儿里在别处提交的，修订预填与吸收目标该跟着变。
  const toggleMenu = function (): any {
    const next = state().menuOpen !== true
    setCommit({ menuOpen: next })
    if (next) Promise.resolve(loadForm()).catch(function () { return null })
  }
  const closeMenu = function (): boolean {
    if (state().menuOpen !== true) return false
    setCommit({ menuOpen: false })
    return true
  }
  return {
    state: state, loadForm: loadForm, selectForm: selectForm, toggleAll: toggleAll,
    setMessage: setMessage, toggleOption: toggleOption, applyTemplate: applyTemplate, undoTemplate: undoTemplate,
    submit: submit, confirmNow: confirmNow, cancelConfirm: cancelConfirm, retry: retry, clearResult: clearResult,
    toggleMenu: toggleMenu, closeMenu: closeMenu,
  }
}
