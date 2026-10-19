// views/versionControl/vcWriteOps.ts —— 写操作的动作层（#842）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处（源码树里只有这一份真源）。
//
// 本文件由同名 .js 转来：只加类型标注，逻辑、分支条件、字符串、数字、对象键与顺序、函数名与导出名一个字没动。
// 下面这些名字由构建按 build.mjs 的次序拼进同一个函数作用域（同批的叶子与内核表），真机上有值；
// 这里只声明形状、不参与转译（转译后这几行整行消失，运行期行为与原来完全一样）。
declare function judge(...args: any[]): any;
declare function vcAfterWrite(...args: any[]): any;
declare function vcRunWrite(...args: any[]): any;
declare function vcOpResultOf(...args: any[]): any;
declare function vcRunCheck(...args: any[]): any;
declare function vcOpStateOf(...args: any[]): any;
declare function vcRemoteChoiceOf(...args: any[]): any;
declare function vcPlanMismatchOf(...args: any[]): any;
declare function vcPushDecisionOf(...args: any[]): any;
declare function vcRequestIdOf(...args: any[]): any;
declare const VC_WRITE_PHONES: any;
//
// 把「点了按钮之后发生什么」从入口组件里搬出来，好让组件那一份守住 350 行（tests/verify-file-granularity.ts）。
// 这一层拿到的都是组件给的东西（ui / setUi / callHost / cwd / readsRef / setReads / screen），
// 自己做四件事：读核心 judge 算四个动作的判定、发预检拿票、发那一条写电话、成功后按设计重读。
// 一条只读电话都不在这里发（重读走 vcData.ts 的既有读法），也不排任何定时器。
export const vcWriteOpsOf = function (deps: any) {
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
    ? { stage: judge(screen, 'stage'), commit: judge(screen, 'commit'), pull: judge(screen, 'pull'), push: judge(screen, 'push'), fetch: judge(screen, 'fetch') }
    : {}
  const setWrite = function (patch: any) {
    setUi(function (cur: any) {
      return Object.assign({}, cur, { write: Object.assign({ op: '', state: 'idle', message: '', confirm: null, result: null }, cur.write || {}, patch || {}) })
    })
  }
  const afterWrite = function (op: any) {
    return vcAfterWrite(readsRef.current, callHost, cwd, op).then(function (next: any) { setReads(next) })
  }
  const runWrite = function (op: any, payload: any) {
    setWrite({ op: op, state: 'running', result: null })
    return vcRunWrite(callHost, cwd, op, payload).then(function (reply: any) {
      const res = Object.assign({ op: op }, vcOpResultOf(op, reply, payload && payload.plan ? payload.plan : null))
      setWrite({ op: '', state: res.state, result: res, confirm: null })
      return res.state === 'done' ? afterWrite(op) : null
    })
  }
  // 预检 → 拿票 → 画确认框；预检自己失败（被宿主判定挡下、或参数/形状不对）就当场给失败话术。
  const checkThen = function (op: any, extra: any, after: any) {
    setWrite({ op: op, state: 'running', result: null })
    return vcRunCheck(callHost, cwd, op, extra).then(function (reply: any) {
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
  const logShape = function (note: any) {
    try { log('warn', 'host.call.fail', { method: VC_WRITE_PHONES.check, kind: 'shape', errorHash: dswsLogHash(dswsLogTrunc(String(note || ''), 120, 'error')) }) } catch (e) { /* 日志坏了不影响动作 */ }
  }
  const noteMismatch = function (op: any, plan: any) {
    const why = (typeof vcPlanMismatchOf === 'function') ? vcPlanMismatchOf(op, screen, plan) : ''
    if (why) logShape(why)
  }
  // 同步重入闸（对抗式审查 2.1）：同一帧里连点两次只放第一次进去，第二次直接忽略。
  //   为什么不能用 ui.write.state 判：setUi 要等下一次渲染才生效，同一帧里两次点击看到的是同一个 idle。
  //   动作一结束（预检回来、或写电话回来）就放行，所以「预检 → 确认框 → 确定」这条路不受影响。
  let inFlight = false
  const guarded = function (fn: any) {
    return function () {
      if (inFlight) return null
      inFlight = true
      const release = function () { inFlight = false }
      try {
        const out = fn.apply(null, arguments)
        if (out && typeof out.then === 'function') return out.then(release, function (e: any) { release(); throw e })
        release()
        return out
      } catch (e) { release(); throw e }
    }
  }
  const stagePaths = guarded(function (paths: any) {
    const list = (Array.isArray(paths) ? paths : []).filter(function (p: any) { return String(p || '') !== '' })
    if (!list.length) return
    return runWrite('stage', { paths: list })
  })
  const unstagePaths = guarded(function (paths: any) {
    const list = (Array.isArray(paths) ? paths : []).filter(function (p: any) { return String(p || '') !== '' })
    if (!list.length) return
    return runWrite('unstage', { paths: list })
  })
  // 转写说明（#1253）：这里刻意不写参数 —— 旧写法就是无参函数，转了之后也必须无参，
  //   否则 `Function.length` 会从 0 变成 1（这正是「只加类型、不加形状」的边界）。
  //   调用点若因为类型推断不让传参，就在调用点写 `(startPull as any)(...)`，与下面 startPush / startFetch 同一手法。
  const startPull = guarded(function () {
    if (vcOpStateOf(decisions.pull) === 'blocked') return
    return checkThen('pull', {}, function (reply: any) {
      noteMismatch('pull', reply.plan)
      setWrite({ op: '', state: 'confirm', confirm: { op: 'pull', plan: reply.plan, ticket: reply.ticket, remotes: reply.remotes || [] }, result: null, remoteChoice: null })
    })
  })
  // 更新远方记录：多远端且定不出远端时与推送同一品格，先选一个再重跑预检；拿到票后直接执行（只读远端、不碰工作树，无需确认框）。
  const doFetch = function (remote: any) {
    if (vcOpStateOf(decisions.fetch) === 'blocked') return null
    const extra = remote ? { remote: String(remote) } : {}
    setWrite({ op: 'fetch', state: 'running', result: null, remoteChoice: null })
    return vcRunCheck(callHost, cwd, 'fetch', extra).then(function (reply: any) {
      const choice = vcRemoteChoiceOf(reply)
      if (choice.show) {
        setWrite({ op: '', state: 'idle', result: null, confirm: null, remoteChoice: Object.assign({}, choice, { op: 'fetch' }) })
        return null
      }
      if (!reply || reply.ok !== true) {
        setWrite({ op: '', state: 'failed', result: Object.assign({ op: 'fetch' }, vcOpResultOf('fetch', reply)), confirm: null, remoteChoice: null })
        return null
      }
      noteMismatch('fetch', reply.plan)
      const ticket = reply.ticket || {}
      return runWrite('fetch', { ticketId: String(ticket.id || ''), requestId: vcRequestIdOf(Date.now(), 'fetch'), plan: reply.plan })
    })
  }
  const startFetch = guarded(function (remote?: any) { return doFetch(remote) })
  // 推送：多远端 + 没有上游时宿主回 ok:false + reason=need-remote-choice + 顶层 remotes（候选）。
  //   这一档不是失败，是「先选一个」——把它画成一排可点的远端入口，选中后带 remote 重跑预检。
  const doPush = function (remote: any) {
    if (vcOpStateOf(vcPushDecisionOf(decisions.push)) === 'blocked') return null
    const extra = remote ? { remote: String(remote) } : {}
    setWrite({ op: 'push', state: 'running', result: null, remoteChoice: null })
    return vcRunCheck(callHost, cwd, 'push', extra).then(function (reply: any) {
      const choice = vcRemoteChoiceOf(reply)
      if (choice.show) {
        setWrite({ op: '', state: 'idle', result: null, confirm: null, remoteChoice: Object.assign({}, choice, { op: 'push' }) })
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
  const startPush = guarded(function (remote: any) { return doPush(remote) })
  const submitCommit = guarded(function () {
    const message = String(writeState.message || '')
    if (vcOpStateOf(decisions.commit) === 'blocked' || message.trim() === '') return
    // 这个 return 不能省：没有它 guarded 会以为动作已经结束、当场放行，重入闸就形同虚设（实测连点两次发两次预检）。
    return checkThen('commit', { message: message }, function (reply: any) {
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
  const pickRemote = guarded(function (name: any) {
    const op = writeState.remoteChoice && writeState.remoteChoice.op === 'fetch' ? 'fetch' : 'push'
    setWrite({ state: 'idle', confirm: null, op: '', result: null, remoteChoice: null })
    return op === 'fetch' ? doFetch(name) : doPush(name)
  })
  const writeMessageOf = function (value: any) { setWrite({ message: String(value === undefined || value === null ? '' : value) }) }
  const retryResult = function () {
    const r = writeState.result || {}
    // 这几个动作是 guarded 包出来的，推断出来的形状按调用点写死，重试时带远端名那一档要显式放开：
    //   `(startPush as any)('')` 只是让类型检查放行，转译后与 startPush('') 逐字等价（不改写法、不加中间变量）。
    if (r.op === 'pull') return startPull()
    if (r.op === 'push') return (startPush as any)('')
    if (r.op === 'fetch') return (startFetch as any)('')
    if (r.op === 'commit') return submitCommit()
  }
  return {
    writeState: writeState, decisions: decisions, stagePaths: stagePaths, unstagePaths: unstagePaths, startPull: startPull, startPush: startPush, startFetch: startFetch,
    submitCommit: submitCommit, confirmNow: confirmNow, cancelConfirm: cancelConfirm, pickRemote: pickRemote,
    writeMessageOf: writeMessageOf, retryResult: retryResult,
  }
}
