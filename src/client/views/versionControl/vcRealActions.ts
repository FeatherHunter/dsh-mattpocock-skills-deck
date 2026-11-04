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
declare function vcStashActionPayloadOf(input: any): any
declare function vcStashNeedsTicketOf(op: any): boolean
declare function vcStashRequestIdOf(nowMs: any, salt: any): string
declare function vcStashTicketOf(reply: any): any
declare function vcStashCheckCallOf(call: any, cwd: any, input: any): any
declare function vcStashWriteCallOf(call: any, cwd: any, input: any, ticketId: any, requestId: any): any
declare function vcStashCheckConfirmOf(payload: any, reply: any, requestId: any): any
declare function vcStashApplyReply(state: any, reply: any, opts?: any): any
declare function vcStashDetailPatch(state: any, selector: any, patch: any): any
declare function vcStashAutoRunOf(deps: any): any
declare function vcReadFirstScreenSliceOf(reads: any, id: any): any
declare function vcFirstScreenSliceOf(reads: any, id: any): any
declare function vcFirstScreenSliceStateOf(reads: any, id: any): any
declare const VC_CHANGES_PHONES: any
declare function vcChangesOpMetaOf(op: any): any
declare function vcChangesCheckArgsOf(cwd: any, op: any, values: any): any
declare function vcChangesWriteArgsOf(cwd: any, op: any, values: any, ticketId: any, requestId: any): any
declare function vcChangesRequestIdOf(nowMs: any, salt: any): string
declare function vcChangesRowKeyOf(op: any, payload: any): string
declare function vcWorktreesUiOf(ui: any): any
declare function createWorktreesOpsOf(deps: any): any
declare function vcFailureOf(reply: any): any
// #1860 D7：改动页展开一行时按路径读一次工作区差异（不带提交号 = 相对 HEAD），读数住在 reads.diffs。
declare function vcReadDiff(reads: any, call: any, cwd: any, path: any, untracked: any): any
declare function vcApplyDiffReply(currentReads: any, nextReads: any): any
declare function vcMarkDiffLoading(reads: any, key: any): any

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

// 在途表放模块层：动作层对象与闸函数每次渲染都会重建，表若挂在对象里，重新渲染后同一动作的第二下就查不到
//   第一趟还在飞的那份，闸等于没装。键是「阶段＋动作＋作用对象」，不同对象各占一行，互不相干。
const VC_REAL_INFLIGHT: any = new Map()

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
  // 在途闸（#1776 M4d，规格第 395 行）：同对象同动作的第一下还在路上时，第二下直接复用那一趟的结果，
  //   不再发第二份电话。判据是这张进程内存里的表，不是 ui.state —— 下一帧才生效的界面态拦不住同一帧里的连点。
  const gate = function (key: any, start: any): any {
    const k: string = String(key || '')
    const running: any = VC_REAL_INFLIGHT.get(k)
    if (running) return running
    const p: any = Promise.resolve().then(start)
    const tracked: any = p.then(function (out: any) { VC_REAL_INFLIGHT.delete(k); return out }, function (err: any) { VC_REAL_INFLIGHT.delete(k); throw err })
    VC_REAL_INFLIGHT.set(k, tracked)
    return tracked
  }
  const ops: any = {
    refresh: refresh,
    retrySlice: function (id: any): any {
      return settleFirstScreen(vcRetryFirstScreenSlice(readsNow(), call, cwd, id))
    },
    // 提交详情：同一笔已经读好就不重复发；打开另一笔时先落加载态（vcReadCommitFiles 自己处理）。
    openCommit: function (oid: any): any {
      const ui: any = Object.assign({}, uiNow(), { openCommit: String(oid || ''), openFile: '', historyMenu: '' })
      setUi(ui)
      const reads: any = readsNow()
      const prev: any = reads.commit || {}
      if (prev.rev === String(oid || '') && prev.state === 'ok') return Promise.resolve(reads)
      return Promise.resolve(vcReadCommitFiles(reads, call, cwd, oid)).then(function (next: any) {
        setReads(function (cur: any) { return vcApplyCommitReply(cur, next) })
        return next
      })
    },
    closeCommit: function (): void { setUi(Object.assign({}, uiNow(), { openCommit: '', openFile: '', historyMenu: '' })) },
    // 历史列表的筛选与「只看合并」：只筛已经读回来的那批提交，不另发电话（原型 68 的搜索框就是这样）。
    historyQuery: function (value: any): void { setUi(Object.assign({}, uiNow(), { historyQuery: String(value === undefined || value === null ? '' : value) })) },
    historyMerge: function (): void {
      const ui: any = uiNow()
      setUi(Object.assign({}, ui, { historyMergeOnly: ui.historyMergeOnly !== true }))
    },
    // 行尾「⋯」：同一时刻只开一行，再点同一行收起；打开菜单时把当前筛选原样带着。
    historyMenu: function (oid: any): void {
      const ui: any = uiNow()
      const id: string = String(oid || '')
      setUi(Object.assign({}, ui, { historyMenu: String(ui.historyMenu || '') === id ? '' : id }))
    },
    // 「复制提交 ID」：写剪贴板失败也不能把整页点炸，所以与身份行复制路径同一个静默写法。
    historyCopy: function (oid: any): void {
      const text: string = String(oid || '')
      if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return
      let writing: any = null
      try { writing = navigator.clipboard.writeText(text) } catch (err) { return }
      if (writing && typeof writing.catch === 'function') writing.catch(function () {})
    },
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
    // 贮藏：写动作走三段式 —— 先预检签票，再把确认卡停在触发点；用户确认后凭 ticketId + requestId 执行。
    //   读动作（list / show）与最近丢弃的恢复不要票，直接走执行电话；预检失败只落结果，不发执行电话。
    stashAct: function (payload: any): any {
      const p: any = payload || {}
      const op: string = String(p.op || '')
      const ui: any = uiNow()
      const prev: any = Object.assign({}, vcStashStateNew(), ui.stash || {})
      const patchStash = function (next: any): void { setUi(Object.assign({}, vcRealCurrentUiOf(d), { stash: next })) }
      const replyInto = function (reply: any): any {
        const base: any = Object.assign({}, vcStashStateNew(), (vcRealCurrentUiOf(d).stash) || {})
        const next: any = vcStashApplyReply(base, reply)
        patchStash(next)
        if (reply && reply.ok === true) refresh('task-done')
        return next
      }
      const write = function (ticketId: any, requestId: any): any {
        patchStash(Object.assign({}, prev, { pending: op, message: prev.message, result: prev.result, confirm: prev.confirm }))
        return Promise.resolve(vcStashWriteCallOf(call, cwd, p, ticketId, requestId)).then(replyInto)
      }
      if (p.confirm === true) {
        const confirm: any = prev.confirm || {}
        if (!confirm.ticketId) {
          const next: any = Object.assign({}, prev, { pending: null, result: { ok: false, error: { kind: 'confirm', message: '' } } })
          patchStash(next)
          return Promise.resolve(next)
        }
        return write(confirm.ticketId, confirm.requestId)
      }
      if (!vcStashNeedsTicketOf(op)) return write('', '')
      const requestId: string = vcStashRequestIdOf(nowMs(), op)
      patchStash(Object.assign({}, prev, { pending: op, message: prev.message, result: prev.result, confirm: null }))
      return Promise.resolve(vcStashCheckCallOf(call, cwd, vcStashActionPayloadOf(p))).then(function (reply: any) {
        if (!reply || reply.ok !== true) return replyInto(reply)
        const confirm: any = vcStashCheckConfirmOf(p, reply, requestId)
        const next: any = Object.assign({}, prev, { pending: null, confirm: confirm, result: prev.result })
        patchStash(next)
        return next
      })
    },
    stashEdit: function (patch: any): void {
      const ui: any = uiNow()
      const base: any = Object.assign({}, vcStashStateNew(), ui.stash || {})
      const p: any = Object.assign({}, patch || {})
      // detailClose 不是状态字段，是一条命令：把那条记录的详情从 details 里摘掉（收起文件清单）。
      const close: string = p.detailClose === undefined ? '' : String(p.detailClose)
      delete p.detailClose
      const next: any = close === '' ? Object.assign({}, base, p) : vcStashDetailPatch(Object.assign({}, base, p), close, null)
      setUi(Object.assign({}, ui, { stash: next }))
    },
    // #1860 D8：记录行一挂出来就自动读前十条的「查看内容」。排队、去重与回包落地在 vcStashOps 叶里
    //   （vcStashAutoRunOf），这里只把它接到容器的状态口子上。
    stashAutoShow: function (selectors: any): any {
      return vcStashAutoRunOf({ selectors: selectors, call: call, cwd: cwd, getUi: function () { return vcRealCurrentUiOf(d) }, setUi: setUi })
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
    gate: gate,
  }
  return ops
}

// vcCommitOpsOf 的 setUi 是函数式（fn(cur)=>next）；vcCommitOps 内部只按 ui.commit 拼一份新 ui 回来，
//   所以这里把「当前 ui」交给它即可。容器统一用下面这个包装，避免两处各写一份。
export const vcRealCurrentUiOf = function (deps: any): any {
  return typeof deps.getUi === 'function' ? deps.getUi() : deps.ui || {}
}

// 改动页 13 条动作的处理器：状态由容器持有（values 与 rows），这里只做电话与落状态。
//   begin 先走预检电话拿 120 秒票；危险动作停确认卡，其余直接凭票执行；run 只认确认卡给的票。
// readsApi 是容器的读数口子（{ get, set }）：行展开要读补丁（#1860 D7），补丁住在 reads.diffs 里而不是
//   改动页自己的 values/rows 里 —— 与历史详情、diffOps 同一条缓存与 stale-drop 通路，不另开一份。
export const vcRealChangesHandlersOf = function (state: any, setState: any, call: any, cwd: any, translate: any, gate: any, readsApi?: any): any {
  const t = typeof translate === 'function' ? translate : function (key: string) { return key }
  const s: any = state || {}
  // 每次改动都交给容器的函数式更新：异步回包落地时按「当前态」算下一态，不会被旧的闭包快照覆盖。
  const put = function (patch: any): void {
    if (typeof setState === 'function') setState(function (cur: any) { return Object.assign({}, cur || {}, patch) })
  }
  const values: any = s.values || {}
  // #1829 行级状态按「动作 + 作用对象」分键：同一动作有多个文件行时各自落自己的忙/确认/结果，
  //   旧 13 条动作面板不带 payload，键仍是动作名，行为与以前完全一样。
  // 键的算法只有一处：vcChangesRowKeyOf（与改动页界面行、13 条动作面板共用）。
  const putRow = function (op: any, patch: any, payload?: any): void {
    if (typeof setState !== 'function') return
    const key: string = vcChangesRowKeyOf(op, payload)
    setState(function (cur: any) {
      const rows: any = Object.assign({}, (cur && cur.rows) || {})
      rows[key] = Object.assign({}, rows[key] || {}, patch)
      return Object.assign({}, cur || {}, { rows: rows })
    })
  }
  // 行内按钮只递 payload（例如 path），表单值是共享的 values：拼电话参数时把两层合并成这一次要操作的对象。
  const effOf = function (payload: any): any { return Object.assign({}, values, payload || {}) }
  // 闸键＝动作 + 作用对象（路径 / 来源 / 去向 / 块号）：同对象同动作撞一把，不同对象各走各的。
  const objectKeyOf = function (op: any, payload: any): string {
    const p: any = payload || {}
    const pick = function (k: string): string { return p[k] !== undefined && p[k] !== null ? String(p[k]) : String(values[k] === undefined || values[k] === null ? '' : values[k]) }
    return String(op) + '|' + pick('path') + '|' + pick('from') + '|' + pick('to') + '|' + pick('hunkIndex')
  }
  const gated = function (phase: string, op: any, payload: any, start: any): any {
    if (typeof gate !== 'function') return start()
    return gate(phase + '|' + objectKeyOf(op, payload), start)
  }
  const handlers: any = {
    onValue: function (field: any, value: any): void {
      if (typeof setState !== 'function') return
      setState(function (cur: any) {
        const next: any = Object.assign({}, (cur && cur.values) || {})
        next[String(field)] = value
        return Object.assign({}, cur || {}, { values: next })
      })
    },
    begin: function (op: any, payload: any): any {
      return gated('changes-action', op, payload, function () { return handlers.beginNow(op, payload) })
    },
    beginNow: function (op: any, payload: any): any {
      const meta: any = vcChangesOpMetaOf(op)
      if (!meta || meta.write !== true) return handlers.read(op, payload)
      putRow(op, { busy: true, result: null, confirm: null, read: null }, payload)
      return Promise.resolve(call(VC_CHANGES_PHONES.check, vcChangesCheckArgsOf(cwd, op, effOf(payload)))).then(function (reply: any) {
        if (!reply || reply.ok !== true) {
          putRow(op, { busy: false, result: { ok: false, error: vcFailureOf(reply), values: effOf(payload) } }, payload)
          return reply
        }
        const ticket: any = reply.ticket || {}
        const ticketId: string = String(ticket.id || reply.ticketId || '')
        const requestId: string = vcChangesRequestIdOf(Date.now(), String(op))
        if (reply.confirmRequired === true || meta.dangerous === true) {
          putRow(op, { busy: false, confirm: { ticketId: ticketId, requestId: requestId } }, payload)
          return reply
        }
        return handlers.run(op, payload, { ticketId: ticketId, requestId: requestId })
      })
    },
    run: function (op: any, payload: any, ticket: any): any {
      return gated('changes-write', op, payload, function () { return handlers.runNow(op, payload, ticket) })
    },
    runNow: function (op: any, payload: any, ticket: any): any {
      const t: any = ticket || {}
      putRow(op, { busy: true, confirm: null }, payload)
      return Promise.resolve(call(VC_CHANGES_PHONES.write, vcChangesWriteArgsOf(cwd, op, effOf(payload), t.ticketId, t.requestId))).then(function (reply: any) {
        if (reply && reply.ok === true) {
          putRow(op, { busy: false, result: { ok: true, cmd: String(reply.cmd || op), ms: reply.ms, n: reply.n, values: effOf(payload) } }, payload)
          if (typeof handlers.onDone === 'function') handlers.onDone()
        } else {
          putRow(op, { busy: false, result: { ok: false, error: vcFailureOf(reply), values: effOf(payload) } }, payload)
        }
        return reply
      })
    },
    cancel: function (op: any, payload?: any): void { putRow(op, { busy: false, confirm: null }, payload) },
    // 展开 / 收起一行：收起只改 values，不再发电话；展开时这一路径已经有读数（读到或正在读）就复用，
    //   否则读一次。同一路径连点两下只会起一个 git 进程（第二下在 loading 里直接返回）。
    onOpen: function (path: any, row: any): void {
      const key: string = String(path || '')
      const open: boolean = String(values.openPath || '') === key
      handlers.onValue('openPath', open ? '' : key)
      if (open) return
      const have: any = ((readsApi && readsApi.get && readsApi.get().diffs) || {})[key]
      if (have && (have.state === 'ok' || have.state === 'loading')) return
      handlers.diffLoad(key, row)
    },
    // 读这一行的补丁：先写「正在读」再发电话，回包按代际号落地（晚到的旧回包丢掉），换工作区后在飞的那一枪作废。
    diffLoad: function (path: any, row: any): any {
      const api: any = readsApi || {}
      if (typeof api.get !== 'function' || typeof api.set !== 'function') return Promise.resolve(null)
      const key: string = String(path || '')
      api.set(vcMarkDiffLoading(api.get(), key))
      return Promise.resolve(vcReadDiff(api.get(), call, cwd, key, row && row.untracked === true)).then(function (next: any) {
        api.set(function (cur: any) { return vcApplyDiffReply(cur, next) })
        return next
      })
    },
    // 读失败后重试：不论当前是什么状态都重发一次（用户在失败块上点了重试，就是在说「再读一遍」）。
    onDiffRetry: function (path: any, row: any): any { return handlers.diffLoad(path, row) },
    read: function (op: any, payload: any): any {
      return gated('changes-read', op, payload, function () { return handlers.readNow(op, payload) })
    },
    readNow: function (op: any, payload: any): any {
      putRow(op, { busy: true, read: null }, payload)
      return Promise.resolve(call(VC_CHANGES_PHONES.check, vcChangesCheckArgsOf(cwd, op, effOf(payload)))).then(function (reply: any) {
        const ok: boolean = !!(reply && reply.ok === true)
        const text: string = String((reply && (reply.text || reply.output || reply.stdout)) || '')
        const message: string = String((reply && reply.error && reply.error.message) || (ok ? '' : t('vc.shell.live.readFailed')))
        putRow(op, { busy: false, read: { ok: ok, text: text, message: message } }, payload)
        return reply
      })
    },
  }
  return handlers
}

export const VC_REAL_ACTIONS_SOURCE = 'src/client/views/versionControl/vcRealActions.ts'
