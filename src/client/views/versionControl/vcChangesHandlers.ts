// views/versionControl/vcChangesHandlers.ts —— 改动页动作的处理器（#1902 从 vcRealActions 搬出）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 为什么搬出来：vcRealActions 已经贴着每文件 350 有效行的上限，而 #1902 要给改动页补三件事——
//   · 逐块暂存现在有两个方向：正向（工作区那一块进索引）与反向（索引里那一块退回工作区）；
//   · 写成功后要把这一行的差异读数丢掉重读（块的分组变了，旧读数会让界面画错块号）；
//   · 行级动作（删除 / 停止跟踪 / 改名）完成后，结果要留在改动列表顶部，而不是挂在那些已经挪走或消失的行上。
//   这三件事都住在这个文件里，vcRealActions 只留别的动作族。
//
// 状态怎么放：values 是这一页的输入值（筛选、展开的那一行、改名草稿），rows 是按「动作 + 作用对象」分键的
//   行级状态（忙 / 确认卡 / 结果）。两者都由容器持有，处理器只递补丁；异步回包一律用函数式更新落地，
//   不会拿旧的闭包快照覆盖后来的状态。

declare const VC_CHANGES_PHONES: any
declare function vcChangesOpMetaOf(op: any): any
declare function vcChangesCheckArgsOf(cwd: any, op: any, values: any): any
declare function vcChangesWriteArgsOf(cwd: any, op: any, values: any, ticketId: any, requestId: any): any
declare function vcChangesRequestIdOf(nowMs: any, salt: any): string
declare function vcChangesRowKeyOf(op: any, payload: any): string
declare function vcFailureOf(reply: any): any
declare function vcReadDiff(reads: any, call: any, cwd: any, path: any, untracked: any, staged?: any, cacheKey?: any, side?: any): any
declare function vcApplyDiffReply(currentReads: any, nextReads: any): any
declare function vcMarkDiffLoading(reads: any, key: any): any
declare function vcChangesSideKeyOf(side: any, path: any): string

/** 把一条差异读数从缓存里丢掉：写完之后这一行的块已经变了，留着旧读数会画错块号。 */
const vcChangesDropDiffOf = function (reads: any, key: string): any {
  const cur: any = reads || {}
  const map: any = Object.assign({}, cur.diffs || {})
  if (map[key] === undefined) return cur
  delete map[key]
  return Object.assign({}, cur, { diffs: map })
}

/**
 * 改动页 13 条动作的处理器：状态由容器持有（values 与 rows），这里只做电话与落状态。
 * begin 先走预检电话拿 120 秒票；要确认的动作停确认卡，其余直接凭票执行；run 只认确认卡给的票。
 * readsApi 是容器的读数口子（{ get, set }）：行展开要读补丁，补丁住在 reads.diffs 里 —— 与历史详情、
 * diffOps 同一条缓存与 stale-drop 通路，不另开一份。
 */
export const vcRealChangesHandlersOf = function (state: any, setState: any, call: any, cwd: any, translate: any, gate: any, readsApi?: any): any {
  const t = typeof translate === 'function' ? translate : function (key: string) { return key }
  const s: any = state || {}
  // 每次改动都交给容器的函数式更新：异步回包落地时按「当前态」算下一态，不会被旧的闭包快照覆盖。
  const put = function (patch: any): void {
    if (typeof setState === 'function') setState(function (cur: any) { return Object.assign({}, cur || {}, patch) })
  }
  // 顶部那条结果住进 values.lastResult：values 已经是这一页的界面状态袋（筛选、展开的行、改名草稿），
  //   结果跟着它走就不必再往容器那一层加一个字段（vcRealTab 贴着每文件 350 有效行上限）。
  const putResult = function (result: any): void {
    if (typeof setState !== 'function') return
    setState(function (cur: any) {
      const valuesNext: any = Object.assign({}, (cur && cur.values) || {})
      valuesNext.lastResult = result
      return Object.assign({}, cur || {}, { values: valuesNext })
    })
  }
  const values: any = s.values || {}
  // 行级状态按「动作 + 作用对象」分键：同一动作有多个文件行时各自落自己的忙/确认/结果。
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
    return String(op) + '|' + pick('path') + '|' + pick('from') + '|' + pick('to') + '|' + pick('hunkIndex') + '|' + (p.reverse === true ? 'reverse' : 'forward')
  }
  const gated = function (phase: string, op: any, payload: any, start: any): any {
    if (typeof gate !== 'function') return start()
    return gate(phase + '|' + objectKeyOf(op, payload), start)
  }
  // 一次写成功之后，把这一行（改名还有新路径）的差异读数丢掉重读：块的归属变了，旧读数会让界面
  // 继续显示已经不在这里的那一块。只重读用户正开着的那一行；没开的下次点开时自己读。
  const reloadDiffsOf = function (paths: any): void {
    const api: any = readsApi || {}
    if (typeof api.get !== 'function' || typeof api.set !== 'function') return
    const openKey: string = String(values.openPath || '')
    const list: string[] = Array.isArray(paths) ? paths : []
    list.forEach(function (path: string) {
      if (path === '') return
      const workKey: string = vcChangesSideKeyOf('unstaged', path)
      const stageKey: string = vcChangesSideKeyOf('staged', path)
      api.set(function (cur: any) { return vcChangesDropDiffOf(vcChangesDropDiffOf(cur, workKey), stageKey) })
      if (openKey !== workKey && openKey !== stageKey) return
      // 开着的那一行：两侧都重读。多出来的一枪是「另一侧可能已经变成空」，比留着旧块更安全。
      handlers.diffLoad(path, { path: path }, 'unstaged')
      handlers.diffLoad(path, { path: path }, 'staged')
    })
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
        const p: any = payload || {}
        if (reply && reply.ok === true) {
          putRow(op, { busy: false, result: { ok: true, cmd: String(reply.cmd || op), ms: reply.ms, n: reply.n, values: effOf(payload) } }, payload)
          // 列表顶部那条结果：行被挪走 / 消失之后，行里的结果就没有落脚点了，所以另存一份给顶部。
          putResult({ ok: true, op: String(op), path: String(p.path || ''), to: String(p.to || ''), hunkIndex: p.hunkIndex, displayIndex: p.displayIndex, reverse: p.reverse === true, cmd: String(reply.cmd || op), ms: reply.ms, n: reply.n })
          reloadDiffsOf([String(p.path || ''), String(p.to || '')])
          if (typeof handlers.onDone === 'function') handlers.onDone()
        } else {
          putRow(op, { busy: false, result: { ok: false, error: vcFailureOf(reply), values: effOf(payload) } }, payload)
          putResult({ ok: false, op: String(op), path: String(p.path || ''), to: String(p.to || ''), hunkIndex: p.hunkIndex, reverse: p.reverse === true, error: vcFailureOf(reply) })
        }
        return reply
      })
    },
    cancel: function (op: any, payload?: any): void { putRow(op, { busy: false, confirm: null }, payload) },
    // 展开 / 收起一行：收起只改 values，不再发电话；展开时把这一行要的两侧读数补齐（已经有读到或正在读的不重发）。
    // 部分暂存的文件两侧都要读：已暂存那几块来自「索引相对 HEAD」，还没进索引的块来自「索引相对工作区」。
    onOpen: function (path: any, row: any): void {
      const bare: string = String(path || '')
      const r: any = row || { path: bare }
      const workKey: string = vcChangesSideKeyOf('unstaged', bare)
      const stageKey: string = vcChangesSideKeyOf('staged', bare)
      const openKey: string = String(values.openPath || '')
      // 只认「这一行自己的键」：同一个文件已经被整份暂存、从「未暂存」挪到「已暂存」之后，
      //   旧的展开键还是未暂存那一行；若把两边都当成「这一行开着」，点新组里的行会被当成收起，
      //   永远打不开（真机走查里点不出已暂存行那一份逐块差异，就是这里）。
      const ownKey: string = r.staged === true ? stageKey : workKey
      const open: boolean = openKey === ownKey
      handlers.onValue('openPath', open ? '' : ownKey)
      if (open) return
      const have = function (key: string): any { return ((readsApi && readsApi.get && readsApi.get().diffs) || {})[key] }
      const need = function (key: string): boolean {
        const one: any = have(key)
        return !(one && (one.state === 'ok' || one.state === 'loading'))
      }
      if (r.staged === true) {
        if (need(stageKey)) handlers.diffLoad(bare, r, 'staged')
        return
      }
      if (need(workKey)) handlers.diffLoad(bare, r, 'unstaged')
      // 只暂存了一部分（同时出现在两组里）才有「已暂存的那几块」可画。
      if (r.partial === true && need(stageKey)) handlers.diffLoad(bare, r, 'staged')
    },
    // 读这一行的某一侧差异：先写「正在读」再发电话，回包按代际号落地（晚到的旧回包丢掉）。
    diffLoad: function (path: any, row: any, side?: any): any {
      const api: any = readsApi || {}
      if (typeof api.get !== 'function' || typeof api.set !== 'function') return Promise.resolve(null)
      const mode: string = String(side || (row && row.staged === true ? 'staged' : 'unstaged'))
      const key: string = vcChangesSideKeyOf(mode, String(path || ''))
      api.set(vcMarkDiffLoading(api.get(), key))
      return Promise.resolve(vcReadDiff(api.get(), call, cwd, String(path || ''), row && row.untracked === true, mode === 'staged', key, mode)).then(function (next: any) {
        api.set(function (cur: any) { return vcApplyDiffReply(cur, next) })
        return next
      })
    },
    // 读失败后重试：两侧都重发（用户在失败块上点了重试，就是在说「再读一遍」）。
    onDiffRetry: function (path: any, row: any): any {
      return handlers.diffLoad(path, row, row && row.staged === true ? 'staged' : 'unstaged')
    },
    // 逐块暂存的两个方向：reverse=false 把这一块放进索引，true 把它从索引里退回来。
    // displayIndex 只是「界面上这是第几块」，给结果条那一句人话用；协议与票据只认 hunkIndex。
    onHunk: function (path: any, hunkIndex: any, reverse: any, displayIndex?: any): any {
      const order: number = Number(displayIndex) || 0
      return handlers.begin('stage-hunks', { path: String(path || ''), hunkIndex: Number(hunkIndex) || 0, reverse: reverse === true, displayIndex: order > 0 ? order : Number(hunkIndex) + 1 })
    },
    renameOpen: function (path: any): void {
      handlers.onValue('renamePath', String(path || ''))
      handlers.onValue('renameDraft', String(path || ''))
      handlers.onValue('renameError', '')
    },
    renameDraft: function (value: any): void { handlers.onValue('renameDraft', String(value === undefined || value === null ? '' : value)) },
    renameCancel: function (): void {
      handlers.onValue('renamePath', '')
      handlers.onValue('renameDraft', '')
      handlers.onValue('renameError', '')
    },
    // 改名走 mv：只把「旧路径 + 新路径」递下去，路径形状与目标是否已存在由宿主预检判，界面不另写一份规则。
    renameApply: function (from: any): any {
      const source: string = String(from || '')
      const to: string = String(values.renameDraft === undefined || values.renameDraft === null ? '' : values.renameDraft).trim().replace(/\\/g, '/')
      // 空路径与「和原来一样」在界面上当场说清楚，不白跑一趟预检；其余形状（绝对路径、.. 段）由宿主判。
      // 存的是词条键，翻译留给界面那一层，这一叶不写中文字面量。
      if (to === '') {
        handlers.onValue('renameError', 'vc.changes.view.renameEmpty')
        return null
      }
      if (to === source) {
        handlers.onValue('renameError', 'vc.changes.view.renameSame')
        return null
      }
      handlers.onValue('renameError', '')
      return handlers.begin('mv', { from: source, path: source, to: to })
    },
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
