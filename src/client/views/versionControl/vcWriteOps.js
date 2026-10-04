// views/versionControl/vcWriteOps.js —— 写操作的动作层（#842）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.js 的 leaf 标记处（一源两物）。
//
// 把「点了按钮之后发生什么」从入口组件里搬出来，好让组件那一份守住 350 行（tests/verify-file-granularity.js）。
// 这一层拿到的都是组件给的东西（ui / setUi / callHost / cwd / readsRef / setReads / screen），
// 自己做四件事：读核心 judge 算四个动作的判定、发预检拿票、发那一条写电话、成功后按设计重读。
// 一条只读电话都不在这里发（重读走 vcData.js 的既有读法），也不排任何定时器。
export const vcWriteOpsOf = function (deps) {
  const d = deps || {}
  const ui = d.ui
  const setUi = d.setUi
  const callHost = d.callHost
  const cwd = d.cwd
  const readsRef = d.readsRef
  const setReads = d.setReads
  const screen = d.screen
  const writeState = (ui && ui.write) || {}
  // 四个动作的判定一律读核心 judge（闭包里拼进来的同一份）；推送那一条还要摘掉「没有上游 / 上游被删」。
  const decisions = (screen && typeof judge === 'function')
    ? { stage: judge(screen, 'stage'), commit: judge(screen, 'commit'), pull: judge(screen, 'pull'), push: judge(screen, 'push') }
    : {}
  const setWrite = function (patch) {
    setUi(function (cur) {
      return Object.assign({}, cur, { write: Object.assign({ op: '', state: 'idle', message: '', confirm: null, result: null }, cur.write || {}, patch || {}) })
    })
  }
  const afterWrite = function (op) {
    return vcAfterWrite(readsRef.current, callHost, cwd, op).then(function (next) { setReads(next) })
  }
  const runWrite = function (op, payload) {
    setWrite({ op: op, state: 'running', result: null })
    return vcRunWrite(callHost, cwd, op, payload).then(function (reply) {
      const res = Object.assign({ op: op }, vcOpResultOf(op, reply))
      setWrite({ op: '', state: res.state, result: res, confirm: null })
      return res.state === 'done' ? afterWrite(op) : null
    })
  }
  // 预检 → 拿票 → 画确认框；预检自己失败（被宿主判定挡下、或参数/形状不对）就当场给失败话术。
  const checkThen = function (op, extra, after) {
    setWrite({ op: op, state: 'running', result: null })
    return vcRunCheck(callHost, cwd, op, extra).then(function (reply) {
      if (!reply || reply.ok !== true) {
        setWrite({ op: '', state: 'failed', result: Object.assign({ op: op }, vcOpResultOf(op, reply)), confirm: null })
        return null
      }
      return after(reply)
    })
  }
  // 回包的目标与界面读数对不上：按回包显示（显示永远跟回包），但这件事实要留一条 kind=shape 的日志。
  const logShape = function (note) {
    try { log('warn', 'host.call.fail', { method: VC_WRITE_PHONES.check, kind: 'shape', errorHash: dswsLogHash(dswsLogTrunc(String(note || ''), 120, 'error')) }) } catch (e) { /* 日志坏了不影响动作 */ }
  }
  const noteMismatch = function (op, plan) {
    const why = (typeof vcPlanMismatchOf === 'function') ? vcPlanMismatchOf(op, screen, plan) : ''
    if (why) logShape(why)
  }
  const stagePaths = function (paths) {
    const list = (Array.isArray(paths) ? paths : []).filter(function (p) { return String(p || '') !== '' })
    if (!list.length) return
    runWrite('stage', { paths: list })
  }
  const startPull = function () {
    if (vcOpStateOf(decisions.pull) === 'blocked') return
    checkThen('pull', {}, function (reply) {
      noteMismatch('pull', reply.plan)
      setWrite({ op: '', state: 'confirm', confirm: { op: 'pull', plan: reply.plan, ticket: reply.ticket, remotes: reply.remotes || [] }, result: null })
    })
  }
  const startPush = function (remote) {
    if (vcOpStateOf(vcPushDecisionOf(decisions.push)) === 'blocked') return
    const extra = remote ? { remote: String(remote) } : {}
    checkThen('push', extra, function (reply) {
      noteMismatch('push', reply.plan)
      setWrite({ op: '', state: 'confirm', confirm: { op: 'push', plan: reply.plan, ticket: reply.ticket, remotes: Array.isArray(reply.remotes) ? reply.remotes : [] }, result: null })
    })
  }
  const submitCommit = function () {
    const message = String(writeState.message || '')
    if (vcOpStateOf(decisions.commit) === 'blocked' || message.trim() === '') return
    checkThen('commit', { message: message }, function (reply) {
      const ticket = reply.ticket || {}
      return runWrite('commit', { ticketId: String(ticket.id || ''), requestId: vcRequestIdOf(Date.now(), 'commit'), message: message }).then(function () { setWrite({ message: '' }) })
    })
  }
  const confirmNow = function () {
    const c = writeState.confirm || null
    if (!c) return
    const ticket = c.ticket || {}
    runWrite(c.op, { ticketId: String(ticket.id || ''), requestId: vcRequestIdOf(Date.now(), c.op) })
  }
  const cancelConfirm = function () { setWrite({ state: 'idle', confirm: null, op: '' }) }
  // 多远端时用户选了一个：目标变了，旧票作废 —— 重新预检拿新票（设计 §4）。
  const pickRemote = function (name) { setWrite({ state: 'idle', confirm: null, op: '', result: null }); startPush(name) }
  const writeMessageOf = function (value) { setWrite({ message: String(value === undefined || value === null ? '' : value) }) }
  const retryResult = function () {
    const r = writeState.result || {}
    if (r.op === 'pull') return startPull()
    if (r.op === 'push') return startPush('')
    if (r.op === 'commit') return submitCommit()
  }
  return {
    writeState: writeState, decisions: decisions, stagePaths: stagePaths, startPull: startPull, startPush: startPush,
    submitCommit: submitCommit, confirmNow: confirmNow, cancelConfirm: cancelConfirm, pickRemote: pickRemote,
    writeMessageOf: writeMessageOf, retryResult: retryResult,
  }
}
