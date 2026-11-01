// views/versionControl/vcRealActions.ts —— 真实页签的数据装载与动作分派（#1776 M1）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 这一层把「用户点了什么」翻成宿主电话，再把回包落成容器状态：三时机首屏刷新、片级重试、提交详情、
// 历史续读、贮藏动作、工作树动作、改动页 13 条动作。所有电话名都用各叶子导出的常量（VC_*_PHONES 等），
// 不在这一层重写字面量；门禁因此可以拿真电话名断言。

declare const React: any
declare function vcReadFirstScreenOnEnter(reads: any, call: any, cwd: any): any
declare function vcReadFirstScreenAfterTask(reads: any, call: any, cwd: any): any
declare function vcReadFirstScreenOnManual(reads: any, call: any, cwd: any): any
declare function vcRetryFirstScreen(reads: any, call: any, cwd: any): any
declare function vcRetryFirstScreenSlice(reads: any, call: any, cwd: any, id: any): any
declare function vcReadCommitFiles(reads: any, call: any, cwd: any, rev: any): any
declare function vcReadCommitFileDiff(reads: any, call: any, cwd: any, rev: any, path: any): any
declare function vcReadMoreCommits(reads: any, call: any, cwd: any, skip: any): any
declare function vcApplyCommitReply(currentReads: any, nextReads: any): any
declare function vcApplyCommitFileDiffReply(currentReads: any, nextReads: any): any
declare function vcCommitKeyOf(rev: any, path: any): string
declare function vcCommitInitialState(): any
declare function vcCommitOpsOf(deps: any): any
declare const VC_COMMIT_PHONES: any
declare function vcStashStateNew(): any
declare function vcStashCallOf(call: any, cwd: any, input: any): any
declare function vcStashApplyReply(state: any, reply: any): any
declare function vcReadFirstScreenSliceOf(reads: any, id: any): any
declare function vcFirstScreenSliceOf(reads: any, id: any): any
declare function vcFirstScreenSliceStateOf(reads: any, id: any): any
declare const VC_CHANGES_PHONES: any
declare function vcChangesOpMetaOf(op: any): any
declare function vcChangesCheckArgsOf(cwd: any, op: any, values: any): any
declare function vcChangesWriteArgsOf(cwd: any, op: any, values: any, ticketId: any, requestId: any): any
declare function vcChangesRequestIdOf(nowMs: any, salt: any): string
declare function vcWorktreesUiOf(ui: any): any
declare function createWorktreesOpsOf(deps: any): any
declare function vcFailureOf(reply: any): any

// 本层看到的宿主电话：call(phone, args) 回 Promise（容器负责把全局 host.call 包一层兜底）。
export const VC_REAL_REFRESH_MOMENTS: string[] = ['enter', 'task-done', 'manual']

// 首屏刷新：三个时机各一个入口，内部都是同一次聚合读（vcFirstScreen.ts 的三条包装）。
//   不传 cwd 时不发电话：空工作区的空态由容器画，别拿空串去问宿主。
export const vcRealRefreshOf = function (reads: any, call: any, cwd: any, moment: any): any {
  const m: string = String(moment || 'enter')
  if (!reads || typeof call !== 'function') return Promise.resolve(reads)
  const text: string = String(cwd === undefined || cwd === null ? '' : cwd)
  if (text.trim() === '') return Promise.resolve(reads)
  if (m === 'manual') return vcReadFirstScreenOnManual(reads, call, text)
  if (m === 'task-done') return vcReadFirstScreenAfterTask(reads, call, text)
  if (m === 'slice') return vcRetryFirstScreen(reads, call, text)
  return vcReadFirstScreenOnEnter(reads, call, text)
}

// 只落首屏那一个槽：同帧里可能还有提交详情 / 续读的回包在飞，整份覆盖会把它们冲掉。
export const vcRealWithFirstScreenOf = function (currentReads: any, nextReads: any): any {
  const out: any = Object.assign({}, currentReads || {})
  if (nextReads && nextReads.firstScreen) out.firstScreen = nextReads.firstScreen
  return out
}

// 容器需要的动作集合：每次渲染重建一份（闭包里抓的是这一帧的读数与界面状态），异步回包用 setState
//   的函数式写法落地。deps 字段：getReads / setReads / getUi / setUi / getNav / callHost / cwd / nowMs。
export const vcRealActionsOf = function (deps: any): any {
  const d: any = deps || {}
  const readsNow = function (): any { return typeof d.getReads === 'function' ? d.getReads() : d.reads || {} }
  const uiNow = function (): any { return typeof d.getUi === 'function' ? d.getUi() : d.ui || {} }
  const call = function (phone: any, args: any): any {
    return typeof d.callHost === 'function' ? d.callHost(phone, args) : Promise.resolve({ ok: false, error: { kind: 'shape', message: '' } })
  }
  const setReads = function (next: any): void { if (typeof d.setReads === 'function') d.setReads(next) }
  const setUi = function (next: any): void { if (typeof d.setUi === 'function') d.setUi(next) }
  const cwd: string = String(d.cwd === undefined || d.cwd === null ? '' : d.cwd)
  const nowMs = function (): number { return typeof d.nowMs === 'function' ? Number(d.nowMs()) : Date.now() }
  const settleFirstScreen = function (promise: any): any {
    return Promise.resolve(promise).then(function (next: any) {
      setReads(function (cur: any) { return vcRealWithFirstScreenOf(cur, next) })
      return next
    })
  }
  const refresh = function (moment: any): any { return settleFirstScreen(vcRealRefreshOf(readsNow(), call, cwd, moment)) }
  const ops: any = {
    refresh: refresh,
    retrySlice: function (id: any): any {
      return settleFirstScreen(vcRetryFirstScreenSlice(readsNow(), call, cwd, id))
    },
    // 提交详情：同一笔已经读好就不重复发；打开另一笔时先落加载态（vcReadCommitFiles 自己处理）。
    openCommit: function (oid: any): any {
      const ui: any = Object.assign({}, uiNow(), { openCommit: String(oid || ''), openFile: '' })
      setUi(ui)
      const reads: any = readsNow()
      const prev: any = reads.commit || {}
      if (prev.rev === String(oid || '') && prev.state === 'ok') return Promise.resolve(reads)
      return Promise.resolve(vcReadCommitFiles(reads, call, cwd, oid)).then(function (next: any) {
        setReads(function (cur: any) { return vcApplyCommitReply(cur, next) })
        return next
      })
    },
    closeCommit: function (): void { setUi(Object.assign({}, uiNow(), { openCommit: '', openFile: '' })) },
    openHistoryFile: function (path: any): any {
      const ui: any = Object.assign({}, uiNow(), { openFile: String(path || '') })
      setUi(ui)
      const reads: any = readsNow()
      const rev: string = String((reads.commit && reads.commit.rev) || '')
      const key: string = vcCommitKeyOf(rev, String(path || ''))
      const have: any = (reads.commitDiffs || {})[key]
      if (have && have.state === 'ok') return Promise.resolve(reads)
      return Promise.resolve(vcReadCommitFileDiff(reads, call, cwd, rev, path)).then(function (next: any) {
        setReads(function (cur: any) { return vcApplyCommitFileDiffReply(cur, next) })
        return next
      })
    },
    retryFiles: function (): any {
      const reads: any = readsNow()
      const rev: string = String((reads.commit && reads.commit.rev) || (uiNow().openCommit || ''))
      return Promise.resolve(vcReadCommitFiles(reads, call, cwd, rev)).then(function (next: any) { setReads(next); return next })
    },
    retryFileDiff: function (): any {
      const reads: any = readsNow()
      const rev: string = String((reads.commit && reads.commit.rev) || (uiNow().openCommit || ''))
      const path: string = String(uiNow().openFile || '')
      return Promise.resolve(vcReadCommitFileDiff(reads, call, cwd, rev, path)).then(function (next: any) { setReads(next); return next })
    },
    // 历史续读：skip = 首屏首页条数 + 已经续回来的条数（vcData 的 vcNextSkipOf 同一口径）。
    loadMore: function (): any {
      const reads: any = readsNow()
      const first: any = vcFirstScreenSliceOf(reads, 'history') || {}
      const commits: any[] = (first.data && Array.isArray(first.data.commits)) ? first.data.commits : []
      const log: any = reads.log || {}
      const skip: number = commits.length + (Number(log.fetched) || 0)
      return Promise.resolve(vcReadMoreCommits(reads, call, cwd, skip)).then(function (next: any) { setReads(next); return next })
    },
    // 贮藏：一条电话走全部动作；危险动作的确认卡由页面自己停在 state.confirm 上，这里只做电话与落状态。
    stashAct: function (payload: any): any {
      const ui: any = uiNow()
      const prev: any = Object.assign({}, vcStashStateNew(), ui.stash || {})
      const pending: any = Object.assign({}, prev, { pending: String((payload && payload.op) || ''), message: '', result: prev.result })
      setUi(Object.assign({}, ui, { stash: pending }))
      return Promise.resolve(vcStashCallOf(call, cwd, payload)).then(function (reply: any) {
        const cur: any = vcRealActionsOfLastUi(d)
        const baseStash: any = Object.assign({}, vcStashStateNew(), cur.stash || {})
        const next: any = vcStashApplyReply(baseStash, reply)
        setUi(Object.assign({}, vcRealActionsOfLastUi(d), { stash: next }))
        if (reply && reply.ok === true) refresh('task-done')
        return next
      })
    },
    stashEdit: function (patch: any): void {
      const ui: any = uiNow()
      const base: any = Object.assign({}, vcStashStateNew(), ui.stash || {})
      setUi(Object.assign({}, ui, { stash: Object.assign({}, base, patch || {}) }))
    },
    // 提交面板：vcCommitOpsOf 的 deps 要这一帧的 ui 对象；写成功后按「任务完成」重读首屏。
    commitOps: function (): any {
      return vcCommitOpsOf({
        ui: uiNow(),
        setUi: function (fn: any) {
          if (typeof fn === 'function') setUi(fn(uiNow()))
          else setUi(fn)
        },
        callHost: call,
        cwd: cwd,
        nowMs: nowMs,
        onDone: function () { refresh('task-done') },
      })
    },
    worktreeOps: function (): any {
      return createWorktreesOpsOf({
        callHost: call,
        cwd: cwd,
        reads: function () { return readsNow() },
        ui: function () { return uiNow() },
        setUi: function (next: any) { setUi(next) },
        setReads: function (next: any) { setReads(next) },
      })
    },
  }
  return ops
}

// vcCommitOpsOf 的 setUi 是函数式（fn(cur)=>next）；vcCommitOps 内部只按 ui.commit 拼一份新 ui 回来，
//   所以这里把「当前 ui」交给它即可。容器统一用下面这个包装，避免两处各写一份。
export const vcRealActionsOfLastUi = function (deps: any): any {
  return typeof deps.getUi === 'function' ? deps.getUi() : deps.ui || {}
}

// 改动页 13 条动作的处理器：状态由容器持有（values 与 rows），这里只做电话与落状态。
//   begin 先走预检电话拿 120 秒票；危险动作停确认卡，其余直接凭票执行；run 只认确认卡给的票。
export const vcRealChangesHandlersOf = function (state: any, setState: any, call: any, cwd: any): any {
  const s: any = state || {}
  const put = function (patch: any): void {
    if (typeof setState === 'function') setState(Object.assign({}, s, patch))
  }
  const putRow = function (op: any, patch: any): void {
    const rows: any = Object.assign({}, s.rows || {})
    rows[String(op)] = Object.assign({}, rows[String(op)] || {}, patch)
    put({ rows: rows })
  }
  const values: any = s.values || {}
  const handlers: any = {
    onValue: function (field: any, value: any): void {
      const next: any = Object.assign({}, values)
      next[String(field)] = value
      put({ values: next })
    },
    begin: function (op: any, payload: any): any {
      const meta: any = vcChangesOpMetaOf(op)
      if (!meta || meta.write !== true) return handlers.read(op, payload)
      putRow(op, { busy: true, result: null, confirm: null, read: null })
      return Promise.resolve(call(VC_CHANGES_PHONES.check, vcChangesCheckArgsOf(cwd, op, values))).then(function (reply: any) {
        if (!reply || reply.ok !== true) {
          putRow(op, { busy: false, result: { ok: false, error: vcFailureOf(reply), values: values } })
          return reply
        }
        const ticket: any = reply.ticket || {}
        const ticketId: string = String(ticket.id || reply.ticketId || '')
        const requestId: string = vcChangesRequestIdOf(Date.now(), String(op))
        if (reply.confirmRequired === true || meta.dangerous === true) {
          putRow(op, { busy: false, confirm: { ticketId: ticketId, requestId: requestId } })
          return reply
        }
        return handlers.run(op, payload, { ticketId: ticketId, requestId: requestId })
      })
    },
    run: function (op: any, payload: any, ticket: any): any {
      const t: any = ticket || {}
      putRow(op, { busy: true, confirm: null })
      return Promise.resolve(call(VC_CHANGES_PHONES.write, vcChangesWriteArgsOf(cwd, op, values, t.ticketId, t.requestId))).then(function (reply: any) {
        if (reply && reply.ok === true) {
          putRow(op, { busy: false, result: { ok: true, cmd: String(reply.cmd || op), ms: reply.ms, n: reply.n, values: values } })
          if (typeof handlers.onDone === 'function') handlers.onDone()
        } else {
          putRow(op, { busy: false, result: { ok: false, error: vcFailureOf(reply), values: values } })
        }
        return reply
      })
    },
    cancel: function (op: any): void { putRow(op, { busy: false, confirm: null }) },
    read: function (op: any, payload: any): any {
      putRow(op, { busy: true, read: null })
      return Promise.resolve(call(VC_CHANGES_PHONES.check, vcChangesCheckArgsOf(cwd, op, values))).then(function (reply: any) {
        const ok: boolean = !!(reply && reply.ok === true)
        const text: string = String((reply && (reply.text || reply.output || reply.stdout)) || '')
        const message: string = String((reply && reply.error && reply.error.message) || (ok ? '' : '读取失败'))
        putRow(op, { busy: false, read: { ok: ok, text: text, message: message } })
        return reply
      })
    },
  }
  return handlers
}

export const VC_REAL_ACTIONS_SOURCE = 'src/client/views/versionControl/vcRealActions.ts'
