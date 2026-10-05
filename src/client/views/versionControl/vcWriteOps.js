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
      const res = Object.assign({ op: op }, vcOpResultOf(op, reply, payload && payload.plan ? payload.plan : null))
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
  // 为什么这条日志落在这里是合规的（tests/verify-log-truncate.js 的渲染目录点名白名单里已登记本文件）：
  //   ① 本文件是动作层，不渲染任何东西（与 vcData.js / labelColorPatch.js / bannerChain.js 同一类）；
  //   ② 沿用既有事件 host.call.fail，不新增事件、不动日志对照表；
  //   ③ 字段只有三个白名单项：method（电话名常量）、kind（枚举 'shape'）、errorHash（dswsLogHash + dswsLogTrunc 截断到 120）；
  //   ④ 行上没有对象转文本、没有 JSON.stringify；频率极低（回包与界面读数一致时一次都不落）。
  const logShape = function (note) {
    try { log('warn', 'host.call.fail', { method: VC_WRITE_PHONES.check, kind: 'shape', errorHash: dswsLogHash(dswsLogTrunc(String(note || ''), 120, 'error')) }) } catch (e) { /* 日志坏了不影响动作 */ }
  }
  const noteMismatch = function (op, plan) {
    const why = (typeof vcPlanMismatchOf === 'function') ? vcPlanMismatchOf(op, screen, plan) : ''
    if (why) logShape(why)
  }
  // 同步重入闸（对抗式审查 2.1）：同一帧里连点两次只放第一次进去，第二次直接忽略。
  //   为什么不能用 ui.write.state 判：setUi 要等下一次渲染才生效，同一帧里两次点击看到的是同一个 idle。
  //   动作一结束（预检回来、或写电话回来）就放行，所以「预检 → 确认框 → 确定」这条路不受影响。
  let inFlight = false
  const guarded = function (fn) {
    return function () {
      if (inFlight) return null
      inFlight = true
      const release = function () { inFlight = false }
      try {
        const out = fn.apply(null, arguments)
        if (out && typeof out.then === 'function') return out.then(release, function (e) { release(); throw e })
        release()
        return out
      } catch (e) { release(); throw e }
    }
  }
  const stagePaths = guarded(function (paths) {
    const list = (Array.isArray(paths) ? paths : []).filter(function (p) { return String(p || '') !== '' })
    if (!list.length) return
    return runWrite('stage', { paths: list })
  })
  const unstagePaths = guarded(function (paths) {
    const list = (Array.isArray(paths) ? paths : []).filter(function (p) { return String(p || '') !== '' })
    if (!list.length) return
    return runWrite('unstage', { paths: list })
  })
  const startPull = guarded(function () {
    if (vcOpStateOf(decisions.pull) === 'blocked') return
    return checkThen('pull', {}, function (reply) {
      noteMismatch('pull', reply.plan)
      setWrite({ op: '', state: 'confirm', confirm: { op: 'pull', plan: reply.plan, ticket: reply.ticket, remotes: reply.remotes || [] }, result: null, remoteChoice: null })
    })
  })
  // 推送：多远端 + 没有上游时宿主回 ok:false + reason=need-remote-choice + 顶层 remotes（候选）。
  //   这一档不是失败，是「先选一个」——把它画成一排可点的远端入口，选中后带 remote 重跑预检。
  const doPush = function (remote) {
    if (vcOpStateOf(vcPushDecisionOf(decisions.push)) === 'blocked') return null
    const extra = remote ? { remote: String(remote) } : {}
    setWrite({ op: 'push', state: 'running', result: null, remoteChoice: null })
    return vcRunCheck(callHost, cwd, 'push', extra).then(function (reply) {
      const choice = vcRemoteChoiceOf(reply)
      if (choice.show) {
        setWrite({ op: '', state: 'idle', result: null, confirm: null, remoteChoice: choice })
        return null
      }
      if (!reply || reply.ok !== true) {
        setWrite({ op: '', state: 'failed', result: Object.assign({ op: 'push' }, vcOpResultOf('push', reply)), confirm: null, remoteChoice: null })
        return null
      }
      noteMismatch('push', reply.plan)
      setWrite({ op: '', state: 'confirm', confirm: { op: 'push', plan: reply.plan, ticket: reply.ticket, remotes: Array.isArray(reply.remotes) ? reply.remotes : [] }, result: null, remoteChoice: null })
    })
  }
  const startPush = guarded(function (remote) { return doPush(remote) })
  const submitCommit = guarded(function () {
    const message = String(writeState.message || '')
    if (vcOpStateOf(decisions.commit) === 'blocked' || message.trim() === '') return
    // 这个 return 不能省：没有它 guarded 会以为动作已经结束、当场放行，重入闸就形同虚设（实测连点两次发两次预检）。
    return checkThen('commit', { message: message }, function (reply) {
      const ticket = reply.ticket || {}
      return runWrite('commit', { ticketId: String(ticket.id || ''), requestId: vcRequestIdOf(Date.now(), 'commit'), message: message, plan: reply.plan }).then(function () { setWrite({ message: '' }) })
    })
  })
  const confirmNow = guarded(function () {
    const c = writeState.confirm || null
    if (!c) return
    const ticket = c.ticket || {}
    // plan 一起带上：推送成功的措辞要按预检那一档说（执行回包分不出 recreate）。
    return runWrite(c.op, { ticketId: String(ticket.id || ''), requestId: vcRequestIdOf(Date.now(), c.op), plan: c.plan })
  })
  const cancelConfirm = function () { setWrite({ state: 'idle', confirm: null, op: '' }) }
  // 多远端时用户选了一个：目标变了，旧票作废 —— 重新预检拿新票（设计 §4）。
  const pickRemote = guarded(function (name) {
    setWrite({ state: 'idle', confirm: null, op: '', result: null, remoteChoice: null })
    return doPush(name)
  })
  const writeMessageOf = function (value) { setWrite({ message: String(value === undefined || value === null ? '' : value) }) }
  const retryResult = function () {
    const r = writeState.result || {}
    if (r.op === 'pull') return startPull()
    if (r.op === 'push') return startPush('')
    if (r.op === 'commit') return submitCommit()
  }
  return {
    writeState: writeState, decisions: decisions, stagePaths: stagePaths, unstagePaths: unstagePaths, startPull: startPull, startPush: startPush,
    submitCommit: submitCommit, confirmNow: confirmNow, cancelConfirm: cancelConfirm, pickRemote: pickRemote,
    writeMessageOf: writeMessageOf, retryResult: retryResult,
  }
}
