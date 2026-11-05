// views/versionControl/vcHistoryOps.ts —— 提交历史页四条能力（3.4 单文件历史 / 3.7 按代码变化搜 / 3.8 比较两个引用 / 3.12 提交备注）的动作层
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 这一层把「用户点了什么」翻成宿主的电话，再把回包落成读数与界面状态：
//   · 三条只读（单文件历史 / 比较 / 读备注）复用历史高级查询那条电话与它已有的三态槽（reads.queries），
//     不另开一套「读一次、落一处」的机制；
//   · 一条写（保存备注）走预检签票 + 凭票执行两条电话（wf.gitNoteCheck / wf.gitNoteWrite），
//     与仓库里其它写动作同一套票据门；
//   · 界面状态只放「用户正在看什么」：范围、只看哪个文件、比较两端写的是什么、备注草稿。
//
// 不在这里做的事：不画界面（vcHistory / vcHistoryExtra），不拼 git 命令（宿主），
// 不自己编用户话术（词表）。

declare function vcFailureOf(...args: any[]): any
declare function vcQueryStateOf(...args: any[]): any
declare function vcMarkQueryLoading(...args: any[]): any
declare function vcApplyQueryReply(...args: any[]): any
declare function vcReadHistoryQuery(...args: any[]): any
declare function vcHistoryScopeOf(...args: any[]): string

/** 保存备注的两条电话（调用点与门禁都读这一份，不写字面量）。 */
export const VC_NOTE_PHONES: Record<string, string> = { check: 'wf.gitNoteCheck', write: 'wf.gitNoteWrite' }

/** 备注最长多少个字：与共享层 note-ops.ts 的 NOTE_TEXT_MAX 逐条相等（客户端运行时不许 import 宿主侧），门禁逐条比对。 */
export const VC_NOTE_TEXT_MAX = 2000

/** 一份全新的备注写状态（还没按过保存）。 */
export const vcNewNoteWrite = function () { return { state: 'idle', rev: '', text: '', removing: false, error: null } }

/** 备注草稿与这根「这次保存针对哪条提交」：换一条提交就要重画，草稿跟着那条提交走。 */
export const vcNoteDraftOf = function (ui: any, oid: any) {
  const u: any = ui || {}
  const rev: string = String(oid || '')
  const forRev: string = String(u.historyNoteFor || '')
  // 草稿只属于它被写时的那条提交：换一条提交、而草稿还是上一条的，就当这条还没有草稿。
  return forRev === rev ? String(u.historyNoteDraft || '') : ''
}

/** 一条只读查询现在的三态（缺省是「还没跑」）。 */
export const vcHistoryReadOf = function (reads: any, kind: any): any {
  return vcQueryStateOf(reads && reads.queries, kind)
}

/** 只读查询读回来的数据（没读到回 null，不造空壳）。 */
export const vcHistoryDataOf = function (reads: any, kind: any): any {
  const one: any = vcHistoryReadOf(reads, kind)
  return one && one.state === 'ok' && one.data ? one.data : null
}

/** 写一条请求编号：同一毫秒里连点两下也不会撞（票据门认 requestId，撞了就会被当成重放）。 */
const vcNoteRequestIdOf = function (rev: any, nowMs: any): string {
  return 'n' + String(Number(nowMs) || 0) + '-' + String(rev || '').slice(0, 8) + '-' + Math.random().toString(36).slice(2, 8)
}

    /** 「这个文件的历史」这一份读数：还没读过、读到的是别的文件，都回 null。 */
export const vcHistoryFileSourceOf = function (ui: any, reads: any): any {
  const fileOnly: string = String((ui || {}).historyFileOnly || '')
  if (fileOnly === '') return null
  const data: any = vcHistoryDataOf(reads, 'file-history')
  if (!data || String(data.path || '') !== fileOnly) return null
  return Array.isArray(data.commits) ? data.commits : []
}

/** 列表要画的那几行：只看某个文件且读数已经回来时就是那份读数，否则是首屏那份提交清单。 */
export const vcHistoryCommitsOf = function (model: any, ui: any, reads: any): any[] {
  const src: any = vcHistoryFileSourceOf(ui, reads)
  if (src !== null) return src
  if (String((ui || {}).historyFileOnly || '') !== '') return []
  return Array.isArray(model && model.commits) ? model.commits : []
}

/** 只看某个文件时，这份读数现在是什么状态（'' 表示不是这个模式）。 */
export const vcHistoryFileStateOf = function (ui: any, reads: any): string {
  if (String((ui || {}).historyFileOnly || '') === '') return ''
  if (vcHistoryFileSourceOf(ui, reads) !== null) return 'ok'
  const one: any = vcHistoryReadOf(reads, 'file-history')
  return one && one.state === 'err' ? 'err' : (one && one.state === 'loading' ? 'loading' : 'idle')
}

/** 某条提交有没有备注：本次会话写过/删过就以那一次为真，否则看宿主随首屏补上的标记。 */
export const vcHistoryHasNoteOf = function (ui: any, commit: any): boolean {
  const oid: string = String((commit && commit.oid) || '')
  const known: any = ((ui || {}).historyNotes || {})[oid]
  if (known === true || known === false) return known === true
  return !!(commit && commit.hasNote === true)
}

/**
 * 动作集合。deps 是容器给的这一帧的口子：
 *   call(phone, args) / cwd / getReads() / setReads(next) / getUi() / setUi(next) / nowMs()。
 */
export const vcHistoryOpsOf = function (deps: any): any {
  const d: any = deps || {}
  const readsNow = function (): any { return typeof d.getReads === 'function' ? d.getReads() : (d.reads || {}) }
  const uiNow = function (): any { return typeof d.getUi === 'function' ? d.getUi() : (d.ui || {}) }
  const setReads = function (next: any): void { if (typeof d.setReads === 'function') d.setReads(next) }
  const setUi = function (patch: any): void { if (typeof d.setUi === 'function') d.setUi(Object.assign({}, uiNow(), patch)) }
  const call = function (phone: any, args: any): any {
    return typeof d.callHost === 'function' ? d.callHost(phone, args) : Promise.resolve({ ok: false, error: { kind: 'shape', message: '' } })
  }
  const cwd: string = String(d.cwd === undefined || d.cwd === null ? '' : d.cwd)
  const nowMs = function (): number { return typeof d.nowMs === 'function' ? Number(d.nowMs()) : Date.now() }

  /** 发一条只读查询，并把「正在读」先落进读数（界面据此画读取中，不画成一个旧结果）。 */
  const readInto = function (kind: string, values: any): any {
    const before: any = readsNow()
    // vcMarkQueryLoading 收的是「查询槽那份表」而不是整份读数：这里只换 queries 那一格，别的读数原样留着。
    // 这一次读取必须拿「已经标成读取中」的那一份当起点：回包的代际号跟着它走，晚到判定才认得出这是最新一枪
    //   （拿标记之前那份当起点，回包的号会小一号，被自己的 stale-drop 当成旧回包丢掉）。
    const loading: any = Object.assign({}, before, { queries: vcMarkQueryLoading(before.queries || {}, kind) })
    setReads(loading)
    return Promise.resolve(vcReadHistoryQuery(loading, call, cwd, kind, values)).then(function (next: any) {
      setReads(function (cur: any) { return vcApplyQueryReply(cur, next, kind) })
      return vcHistoryReadOf(vcApplyQueryReply(readsNow(), next, kind), kind)
    })
  }

  return {
    /** 搜索范围切换：说明 / 代码变化。切到代码范围时不额外读东西（路径清单随首屏一起来）。 */
    scope: function (next: any): void {
      const scope: string = vcHistoryScopeOf(next)
      if (vcHistoryScopeOf(uiNow().historyScope) === scope) return
      setUi({ historyScope: scope })
    },
    /** 详情里文件行尾的「⋯」：同一时刻只开一行，再点同一行收起。 */
    fileMenu: function (path: any): void {
      const want: string = String(path || '')
      setUi({ historyFileMenu: String(uiNow().historyFileMenu || '') === want ? '' : want })
    },
    /**
     * 从提交详情的文件行发起「看这个文件的历史」：回到列表、只留改过这个文件的提交，
     * 并且把比较结果收起来 —— 「只看一个文件」与「比较两个引用」是两种读法，同时开着读者分不清在看哪一种。
     */
    fileOnly: function (path: any): any {
      const want: string = String(path || '')
      if (want === '') return Promise.resolve(null)
      setUi({ historyFileOnly: want, historyFileMenu: '', openCommit: '', openFile: '', historyCompare: null, historyCompareOpen: false, historyNote: vcNewNoteWrite() })
      const cur: any = vcHistoryDataOf(readsNow(), 'file-history')
      if (cur && String(cur.path || '') === want) return Promise.resolve(cur)
      return readInto('file-history', { path: want })
    },
    /** 点掉「只看 …」那枚标签：回到全部历史，读数留着（下次再看同一个文件不必重读）。 */
    fileOnlyClear: function (): void { setUi({ historyFileOnly: '', historyFileMenu: '' }) },
    /** 比较两个引用的表单开合。关表单不动已经算出来的结果。 */
    compareToggle: function (): void { setUi({ historyCompareOpen: uiNow().historyCompareOpen !== true }) },
    compareClose: function (): void { setUi({ historyCompareOpen: false }) },
    compareField: function (which: any, value: any): void {
      const v: string = String(value === undefined || value === null ? '' : value)
      setUi(String(which) === 'from' ? { historyCompareFrom: v } : { historyCompareTo: v })
    },
    /**
     * 比较：先把两端的写法原样交给宿主；宿主认不出哪一端，就把那一端原话说回来，界面照原话说，不悄悄当成 HEAD。
     * 算成功才把表单收起、把结果头立起来。
     */
    compareApply: function (): any {
      const ui: any = uiNow()
      const left: string = String(ui.historyCompareFrom === undefined ? 'HEAD~1' : ui.historyCompareFrom).trim()
      const right: string = String(ui.historyCompareTo === undefined ? 'HEAD' : ui.historyCompareTo).trim()
      return readInto('compare', { left: left, right: right }).then(function (one: any) {
        if (!one || one.state !== 'ok') return one
        setUi({ historyCompareOpen: false, historyCompare: { left: left, right: right } })
        return one
      })
    },
    /** 退出比较：结果头与文件清单一起收起来，回到提交列表。 */
    compareEnd: function (): void { setUi({ historyCompare: null, historyCompareOpen: false }) },
    /** 备注草稿：跟着正在看的那条提交走。 */
    noteDraft: function (value: any): void {
      setUi({ historyNoteDraft: String(value === undefined || value === null ? '' : value), historyNoteFor: String(uiNow().openCommit || '') })
    },
    /**
     * 保存备注：预检签票 → 凭票执行。空文本 + 已有备注 = 删除这条备注（与原型一致）。
     * 写成功之后重读一次这条提交的备注，界面上的「已有备注」与列表上的「备注」标记都跟着真读数走。
     */
    noteSave: function (): any {
      const ui: any = uiNow()
      const rev: string = String(ui.openCommit || '')
      if (rev === '') return Promise.resolve(null)
      const text: string = vcNoteDraftOf(ui, rev).trim()
      const have: any = vcHistoryDataOf(readsNow(), 'notes')
      const hadNote: boolean = !!(have && String(have.rev || '') === rev && typeof have.note === 'string' && have.note !== '')
      if (text === '' && !hadNote) {
        setUi({ historyNote: { state: 'err', rev: rev, text: '', removing: false, error: { kind: 'args', reason: 'note-empty', message: '' } } })
        return Promise.resolve(null)
      }
      setUi({ historyNote: { state: 'saving', rev: rev, text: text, removing: text === '', error: null } })
      const requestId: string = vcNoteRequestIdOf(rev, nowMs())
      return Promise.resolve(call(VC_NOTE_PHONES.check, { cwd: cwd, rev: rev, text: text })).then(function (check: any) {
        if (!check || check.ok !== true || !check.ticket) {
          const fail: any = vcFailureOf(check)
          setUi({ historyNote: { state: 'err', rev: rev, text: text, removing: text === '', error: fail } })
          return check
        }
        return Promise.resolve(call(VC_NOTE_PHONES.write, { cwd: cwd, ticketId: String(check.ticket.id || ''), requestId: requestId })).then(function (wrote: any) {
          if (!wrote || wrote.ok !== true) {
            const fail: any = vcFailureOf(wrote)
            setUi({ historyNote: { state: 'err', rev: rev, text: text, removing: text === '', error: fail } })
            return wrote
          }
          const notes: any = Object.assign({}, uiNow().historyNotes || {})
          notes[rev] = text !== ''
          setUi({
            historyNote: { state: 'ok', rev: rev, text: text, removing: text === '', error: null },
            historyNotes: notes,
            historyNoteDraft: text,
            historyNoteFor: rev,
          })
          // 重读这条提交的备注：界面上「已有备注」这个结论必须来自真读数，不来自我们自己刚写下的那份乐观状态。
          readInto('notes', { rev: rev })
          return wrote
        })
      })
    },
    /** 读一条提交的备注（进详情时按需读一次；已经读过同一条就不重复读）。 */
    noteRead: function (rev: any): any {
      const want: string = String(rev || '')
      if (want === '') return Promise.resolve(null)
      const have: any = vcHistoryReadOf(readsNow(), 'notes')
      const data: any = have && have.state === 'ok' ? have.data : null
      if (data && String(data.rev || '') === want) return Promise.resolve(data)
      if (have && have.state === 'loading' && String((have.data || {}).rev || '') === want) return Promise.resolve(null)
      return readInto('notes', { rev: want })
    },
    /** 某条提交有没有备注：见 vcHistoryHasNoteOf（纯判定住在外面，列表与详情共用）。 */
    hasNoteOf: function (commit: any): boolean { return vcHistoryHasNoteOf(uiNow(), commit) },
  }
}

/**
 * 打开一条提交时顺手读一次它的备注（详情底部那一段要立刻能写）。
 * 单拎出来是因为调用点在动作层外面（打开提交那一句），包一层 try 保证「备注读不到」不会连带打不开详情。
 */
export const vcHistoryNoteOpenOf = function (deps: any, rev: any): any {
  try { return vcHistoryOpsOf(deps).noteRead(rev) } catch (e) { return null }
}

export const VC_HISTORY_OPS_SOURCE = 'src/client/views/versionControl/vcHistoryOps.ts'
