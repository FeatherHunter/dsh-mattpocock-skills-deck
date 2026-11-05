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
declare function vcReadMoreCommits(reads: any, call: any, cwd: any, skip: any, names?: any): any
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
declare function vcHistoryOpsOf(deps: any): any
declare function vcHistoryNoteOpenOf(deps: any, rev: any): any
declare function vcWorktreesUiOf(ui: any): any
declare function createWorktreesOpsOf(deps: any): any

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
      const ui: any = Object.assign({}, uiNow(), { openCommit: String(oid || ''), openFile: '', historyMenu: '', historyFileMenu: '' })
      setUi(ui); vcHistoryNoteOpenOf({ callHost: call, cwd: cwd, getReads: readsNow, setReads: setReads, getUi: uiNow, setUi: setUi, nowMs: nowMs }, oid)
      const reads: any = readsNow()
      const prev: any = reads.commit || {}
      if (prev.rev === String(oid || '') && prev.state === 'ok') return Promise.resolve(reads)
      return Promise.resolve(vcReadCommitFiles(reads, call, cwd, oid)).then(function (next: any) {
        setReads(function (cur: any) { return vcApplyCommitReply(cur, next) })
        return next
      })
    },
    closeCommit: function (): void { setUi(Object.assign({}, uiNow(), { openCommit: '', openFile: '', historyMenu: '', historyFileMenu: '' })) },
    // #1903 提交历史页四条能力的动作（搜索范围、只看单个文件、比较两个引用、提交备注）住在 vcHistoryOps 叶里；
    //   容器每次渲染重建一份，闭包里抓着这一帧的读数与界面状态。
    historyOps: function (): any { return vcHistoryOpsOf({ callHost: call, cwd: cwd, getReads: readsNow, setReads: setReads, getUi: uiNow, setUi: setUi, nowMs: nowMs }) },
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
      return Promise.resolve(vcReadMoreCommits(reads, call, cwd, skip, String(uiNow().historyScope || '') === 'code')).then(function (next: any) { setReads(next); return next })
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


export const VC_REAL_ACTIONS_SOURCE = 'src/client/views/versionControl/vcRealActions.ts'
