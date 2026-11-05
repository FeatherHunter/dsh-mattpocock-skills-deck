// views/versionControl/vcRebasePage.ts —— 变基待办页的页面体（#1749 T14，能力 5.6/5.7/5.8/5.10）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处。
// 职责四条：
//   1. 画当前状态：有没有进行中的操作、分支与 HEAD、仓库是否开着 rebase.updateRefs（开着就只说不做）；
//   2. 画待办窗口并允许逐行选五个改写动作（保留、改说明、压缩、修正、丢弃）与上移、下移；
//   3. 画换基座范围、自动吸收清单、保留合并结构代价三块只读预览，以及四条写动作的按钮；
//   4. 画四段确认卡与结果条，失败话术与其它页同源（vc.writeErr.* 词条族）。
// 界面里一个中文字面量都没有：可见文字全走 t(词条)，词条真源 config/copy/vcrebase.yaml。
// 页面不算命令、不拼 argv：动作与载荷全走 vcRebaseOps.ts 的纯函数，电话由调用方的 handlers 打。
//
// #1845 阶段 4 起按定稿原型（docs/prototype/vc-redesign 第 48 张）重排版式：
//   页头（返回、标题、危险标签、导语）由页面壳的 vcPageHeadNode 统一画，这里只画正文五段——
//   本次变基（状态行 + 进行中说明 + 右侧状态芯片）→ 变基六步（流程说明 + 状态芯片投影）→
//   变基动作（输入区 + 九行动作）→ 待办窗口（ol[data-vc-rebase-rows]）→ 会动与不会动（四格事实格）。
//   为什么另画六步段：原型 48 用它说明一次变基按什么顺序走、每一步敲什么命令。六步不是进度条：
//   芯片只按仓库真实状态投影（只有 state=rebase 才认前三步已完成、第四步进行中），没观测到的一律待处理。
//   为什么正文不再画 h3 与导语：外壳已经画了一份，两处都画会出现两个标题；危险标签与导语也只归外壳。
//   为什么四块只读预览挂进各自的动作行：原型把「读影响」的按钮与它的结果放在一起看，平铺在页面中部
//   要读者自己对照；四条只读动作各挂一块，读数没到就整块不画。
//   一条都不能删的判据：data-vc-rebase-* 的属性（页标记、动作行、能力号、可执行/隐藏动作、确认卡四段、
//   结果条、四块预览与计数），门禁 verify-1586-rebase 的 D 段按它们认页面能力；位置可以变，名字与含义不变。

declare const VC_REBASE_OPS: any[]
declare const VC_REBASE_TODO_ACTIONS: string[]
declare function vcRebaseOpMetaOf(op: any): any
declare function vcRebaseRequestIdOf(nowMs: any, salt: any): string
declare function vcRebaseOpLabelKeyOf(op: any): string
declare function vcRebaseOpVerbKeyOf(op: any): string
declare function vcRebaseActionLabelKeyOf(action: any): string
declare function vcRebaseStateLabelKeyOf(state: any): string
declare function vcRebaseRowTextOf(row: any): string
declare function vcRebaseVisibleOf(state: any, updateRefs: any): string[]
declare function vcRebasePayloadOf(op: any, values: any): any
declare function vcWriteErrFamilyOf(reason: any, kind: any): string
declare function vcShellConfirmCardNode(h: any, t: any, o: any): any
declare function vcShellResultNode(h: any, t: any, o: any): any
// 来自页面骨架原语 vcPageHead.ts 与流程页小部件 vcFlowParts.ts（#1829 阶段 4 / #1845）：
declare function vcPageSectionNode(h: any, t: any, o: any): any
declare function vcPageObjRowNode(h: any, t: any, o: any): any
declare function vcPageFactGridNode(h: any, t: any, o: any): any
declare function vcFlowChipNode(h: any, t: any, o: any): any
declare function vcFlowHintNode(h: any, t: any, o: any): any

const vcRebasePageStrOf = function (x: any) { return String(x === undefined || x === null ? '' : x) }
const vcRebasePageKeyOf = function (name: any) { return vcRebasePageStrOf(name).replace(/-([a-z])/g, function (m: string, c: string) { return c.toUpperCase() }) }

/** 仓库是否空闲（没有进行中的操作）：'' / 'clean' / 'none' 三种空值都算空闲。
 *  这个口径必须与 vcRebaseOps.ts 的 vcRebaseVisibleOf 完全一致——那一头拿它决定四条写动作出不出，
 *  这一头拿它决定芯片色调与「先处理冲突」的说明；两处各写一套，迟早会一头说空闲、一头说进行中。 */
const vcRebaseIdleOf = function (stateName: any) {
  const s: string = vcRebasePageStrOf(stateName)
  return s === '' || s === 'clean' || s === 'none'
}

/** 当前状态一行：空闲时说清在哪个分支、HEAD 是哪一个；有进行中的操作就点名并要求先处理。
 *  空闲与进行中的口径走 vcRebaseIdleOf，与四条写动作的可见性同源，不另写一套。 */
const vcRebaseStateNode = function (h: any, t: any, rebase: any) {
  const r: any = rebase || {}
  const st: any = r.state || {}
  const stateName: string = vcRebasePageStrOf(st.state)
  const idle: boolean = vcRebaseIdleOf(stateName)
  const text: string = idle
    ? t('vc.rebase.stateLine.clean', { branch: vcRebasePageStrOf(st.branch), head: vcRebasePageStrOf(st.headOid).slice(0, 10) })
    : t('vc.rebase.stateLine.ongoing', { state: t(vcRebaseStateLabelKeyOf(stateName)) })
  return h('p', { className: 'vcs-note', 'data-vc-rebase-state-line': idle ? 'clean' : 'ongoing' }, [text])
}

/** rebase.updateRefs=true 时只说不做：面板不替人改仓库配置。 */
const vcRebaseUpdateRefsNode = function (h: any, t: any, rebase: any) {
  const st: any = (rebase || {}).state || {}
  if (st.updateRefs !== true) return null
  return h('p', { className: 'vcs-note', 'data-vc-rebase-updaterefs': 'on' }, [t('vc.rebase.updateRefsOn')])
}

/** 芯片词条键：''/clean/none 都算空闲，统一说「没有进行中的操作」，别让 vcRebaseStateLabelKeyOf 拼出「none」这种没有词条的后缀。 */
const vcRebaseStateChipKeyOf = function (stateName: string) {
  return vcRebaseIdleOf(stateName) ? 'vc.rebase.state.clean' : vcRebaseStateLabelKeyOf(stateName)
}

/** 待办窗口：每行一个提交，选动作；改说明时同一行出现输入框；上移/下移只是重排。 */
const vcRebaseRowsNode = function (h: any, t: any, rebase: any) {
  const rows: any[] = Array.isArray((rebase || {}).rows) ? rebase.rows : []
  if (rows.length === 0) return h('p', { className: 'vcs-note', 'data-vc-rebase-rows-empty': '1' }, [t('vc.rebase.todo.empty')])
  const kids: any[] = []
  for (let i = 0; i < rows.length; i += 1) {
    const row: any = rows[i] || {}
    const action: string = vcRebasePageStrOf(row.action)
    const options: any[] = VC_REBASE_TODO_ACTIONS.map(function (a: string) {
      return h('option', { value: a, selected: a === action }, [t(vcRebaseActionLabelKeyOf(a))])
    })
    const lineKids: any[] = [
      h('span', { className: 'vcs-vc-rebase-subject' }, [vcRebaseRowTextOf(row)]),
      h('select', { className: 'dsws-input', 'data-vc-rebase-row-action': String(i), onChange: function (e: any) { if (rebase.handlers && rebase.handlers.setRow) rebase.handlers.setRow(i, { action: vcRebasePageStrOf(e && e.target && e.target.value) }) } }, options),
      h('button', { className: 'dsws-btn dsws-hov', type: 'button', 'data-press': 'button', 'data-log': 'vc.rebase.moveup', 'data-vc-rebase-move': 'up', disabled: i === 0, onClick: function () { if (rebase.handlers && rebase.handlers.move) rebase.handlers.move(i, 'move-up') } }, [t('vc.rebase.move.up')]),
      h('button', { className: 'dsws-btn dsws-hov', type: 'button', 'data-press': 'button', 'data-log': 'vc.rebase.movedown', 'data-vc-rebase-move': 'down', disabled: i === rows.length - 1, onClick: function () { if (rebase.handlers && rebase.handlers.move) rebase.handlers.move(i, 'move-down') } }, [t('vc.rebase.move.down')]),
    ]
    if (action === 'reword') {
      lineKids.push(h('textarea', { className: 'dsws-input', 'data-vc-rebase-message': String(i), rows: 2, value: vcRebasePageStrOf(row.message), placeholder: t('vc.rebase.todo.messagePlaceholder'), onInput: function (e: any) { if (rebase.handlers && rebase.handlers.setRow) rebase.handlers.setRow(i, { message: vcRebasePageStrOf(e && e.target && e.target.value) }) } }, []))
    }
    kids.push(h('li', { className: 'vcs-row', 'data-vc-rebase-row': vcRebasePageStrOf(row.oid), 'data-vc-rebase-row-index': String(i) }, lineKids))
  }
  return h('ol', { className: 'vcs-list', 'data-vc-rebase-rows': String(rows.length) }, kids)
}

/** 一块只读预览：按动作名取读数，只画自己那一块；读数没到就回 null，不占位、也不假装读过。
 *  四块卡片各挂在对应的只读动作行下面，所以这里一次只负责一个动作，不再一次平铺四块。 */
const vcRebaseReadCardOf = function (h: any, t: any, rebase: any, op: string) {
  const read: any = (rebase || {}).reads || {}
  if (op === 'rebase-window') {
    const win: any = read.window || null
    if (!win) return null
    const lines: any[] = Array.isArray(win.commits) ? win.commits.map(function (c: any) {
      return h('li', { className: 'vcs-row', 'data-vc-rebase-window-commit': vcRebasePageStrOf(c && c.oid) }, [vcRebasePageStrOf(c && c.oid).slice(0, 10) + ' ' + vcRebasePageStrOf(c && c.subject)])
    }) : []
    return h('section', { className: 'vcs-card', 'data-vc-rebase-read': 'window', 'data-vc-rebase-window-count': String(win.commitCount || 0) }, [h('h4', {}, [t('vc.rebase.window.title', { base: vcRebasePageStrOf(win.base) })]), h('ol', {}, lines)])
  }
  if (op === 'rebase-onto-range') {
    const onto: any = read.onto || null
    if (!onto) return null
    const moved: any[] = Array.isArray(onto.moved) ? onto.moved.map(function (c: any) {
      return h('li', { className: 'vcs-row', 'data-vc-rebase-moved': vcRebasePageStrOf(c && c.oid) }, [vcRebasePageStrOf(c && c.oid).slice(0, 10) + ' ' + vcRebasePageStrOf(c && c.subject)])
    }) : []
    return h('section', { className: 'vcs-card', 'data-vc-rebase-read': 'onto-range', 'data-vc-rebase-moved-count': String(onto.movedCount || 0), 'data-vc-rebase-incoming-count': String(onto.incomingCount || 0) }, [h('h4', {}, [t('vc.rebase.onto.title', { oldBase: vcRebasePageStrOf(onto.oldBase), newBase: vcRebasePageStrOf(onto.newBase) })]), h('p', {}, [t('vc.rebase.onto.counts', { moved: String(onto.movedCount || 0), incoming: String(onto.incomingCount || 0) })]), h('ol', {}, moved)])
  }
  if (op === 'rebase-autosquash-pairs') {
    const pairs: any = read.pairs || null
    if (!pairs) return null
    const list: any[] = Array.isArray(pairs.pairs) ? pairs.pairs.map(function (p: any) {
      return h('li', { className: 'vcs-row', 'data-vc-rebase-pair': vcRebasePageStrOf(p && p.oid), 'data-vc-rebase-pair-kind': vcRebasePageStrOf(p && p.kind) }, [t('vc.rebase.pairs.line', { oid: vcRebasePageStrOf(p && p.oid).slice(0, 10), kind: t('vc.rebase.pairs.kind.' + vcRebasePageKeyOf((p && p.kind) || '')), target: vcRebasePageStrOf(p && p.targetOid).slice(0, 10) })])
    }) : []
    return h('section', { className: 'vcs-card', 'data-vc-rebase-read': 'autosquash-pairs', 'data-vc-rebase-pair-count': String((pairs.pairs || []).length) }, [h('h4', {}, [t('vc.rebase.pairs.title')]), h('ol', {}, list)])
  }
  if (op === 'rebase-merges-cost') {
    const merges: any = read.merges || null
    if (!merges) return null
    const list: any[] = Array.isArray(merges.mergeCommits) ? merges.mergeCommits.map(function (c: any) {
      return h('li', { className: 'vcs-row', 'data-vc-rebase-merge': vcRebasePageStrOf(c && c.oid) }, [vcRebasePageStrOf(c && c.oid).slice(0, 10) + ' ' + vcRebasePageStrOf(c && c.subject)])
    }) : []
    return h('section', { className: 'vcs-card', 'data-vc-rebase-read': 'merges-cost', 'data-vc-rebase-merge-count': String(merges.count || 0) }, [h('h4', {}, [t('vc.rebase.merges.title')]), h('p', { className: 'vcs-note' }, [t('vc.rebase.merges.cost', { n: String(merges.count || 0) })]), h('ol', {}, list)])
  }
  return null
}

/** 输入区：待办与自动吸收/保留合并结构共用基座，换基座用新旧两个基座；四颗「读影响」按钮跟着输入走。 */
const vcRebaseInputsNode = function (h: any, t: any, rebase: any) {
  const r: any = rebase || {}
  const v: any = r.values || {}
  const handlers: any = r.handlers || {}
  const kids: any[] = []
  kids.push(h('label', { className: 'vcs-field' }, [h('span', {}, [t('vc.rebase.field.base')]), h('input', { className: 'dsws-input', type: 'text', 'data-vc-rebase-field': 'base', value: vcRebasePageStrOf(v.base), placeholder: t('vc.rebase.field.baseHint'), onChange: function (e: any) { if (handlers.setField) handlers.setField('base', vcRebasePageStrOf(e && e.target && e.target.value)) } })]))
  kids.push(h('label', { className: 'vcs-field' }, [h('span', {}, [t('vc.rebase.field.oldBase')]), h('input', { className: 'dsws-input', type: 'text', 'data-vc-rebase-field': 'oldBase', value: vcRebasePageStrOf(v.oldBase), placeholder: t('vc.rebase.field.baseHint'), onChange: function (e: any) { if (handlers.setField) handlers.setField('oldBase', vcRebasePageStrOf(e && e.target && e.target.value)) } })]))
  kids.push(h('label', { className: 'vcs-field' }, [h('span', {}, [t('vc.rebase.field.newBase')]), h('input', { className: 'dsws-input', type: 'text', 'data-vc-rebase-field': 'newBase', value: vcRebasePageStrOf(v.newBase), placeholder: t('vc.rebase.field.baseHint'), onChange: function (e: any) { if (handlers.setField) handlers.setField('newBase', vcRebasePageStrOf(e && e.target && e.target.value)) } })]))
  kids.push(h('button', { className: 'dsws-btn dsws-hov', type: 'button', 'data-press': 'button', 'data-log': 'vc.rebase.readwindow', 'data-vc-rebase-read-action': 'window', onClick: function () { if (handlers.read) handlers.read('rebase-window', { base: vcRebasePageStrOf(v.base) }) } }, [t('vc.rebase.read.window')]))
  kids.push(h('button', { className: 'dsws-btn dsws-hov', type: 'button', 'data-press': 'button', 'data-log': 'vc.rebase.readrange', 'data-vc-rebase-read-action': 'onto-range', onClick: function () { if (handlers.read) handlers.read('rebase-onto-range', { oldBase: vcRebasePageStrOf(v.oldBase), newBase: vcRebasePageStrOf(v.newBase) }) } }, [t('vc.rebase.read.ontoRange')]))
  kids.push(h('button', { className: 'dsws-btn dsws-hov', type: 'button', 'data-press': 'button', 'data-log': 'vc.rebase.readpairs', 'data-vc-rebase-read-action': 'autosquash-pairs', onClick: function () { if (handlers.read) handlers.read('rebase-autosquash-pairs', { base: vcRebasePageStrOf(v.base) }) } }, [t('vc.rebase.read.pairs')]))
  kids.push(h('button', { className: 'dsws-btn dsws-hov', type: 'button', 'data-press': 'button', 'data-log': 'vc.rebase.readmerges', 'data-vc-rebase-read-action': 'merges-cost', onClick: function () { if (handlers.read) handlers.read('rebase-merges-cost', { base: vcRebasePageStrOf(v.base) }) } }, [t('vc.rebase.read.merges')]))
  return kids
}

/** 四段确认卡：会动什么、会不会丢东西、能不能回头、按下去究竟做什么。 */
const vcRebaseConfirmNode = function (h: any, t: any, rebase: any) {
  const r: any = rebase || {}
  const confirm: any = r.confirm || null
  const meta: any = r.confirmOp ? vcRebaseOpMetaOf(r.confirmOp) : null
  if (!confirm || !meta) return null
  const seg = function (name: string, text: string) { return h('p', { className: 'vcs-note', 'data-vc-rebase-confirm-seg': name }, [text]) }
  const handlers: any = r.handlers || {}
  return h('section', { className: 'vcs-card vcs-danger', 'data-vc-rebase-confirm': r.confirmOp, role: 'alertdialog' }, [
    h('h4', {}, [t('vc.rebase.confirm.title', { verb: t(vcRebaseOpVerbKeyOf(r.confirmOp)) })]),
    seg('what', t('vc.rebase.confirm.what', { target: vcRebaseTargetTextOf(r.confirmOp, r.values, t) })),
    seg('wont', vcRebasePageStrOf(confirm.wont)),
    seg('reversible', vcRebasePageStrOf(confirm.reversible)),
    seg('verb', vcRebasePageStrOf(confirm.verb)),
    h('button', { className: 'dsws-btn dsws-hov', type: 'button', 'data-press': 'button', 'data-log': 'vc.rebase.confirm.cancel', 'data-vc-rebase-confirm-cancel': '1', 'data-focus-default': 'cancel', onClick: function () { if (handlers.cancel) handlers.cancel() } }, [t('vc.rebase.confirm.cancel')]),
    h('button', { className: 'dsws-btn dsws-hov', type: 'button', 'data-press': 'button', 'data-log': 'vc.rebase.confirm.go', 'data-vc-rebase-confirm-go': '1', onClick: function () { if (handlers.run) handlers.run(r.confirmOp, r.ticketId || '', vcRebaseRequestIdOf(Date.now(), r.confirmOp)) } }, [t('vc.rebase.confirm.go')]),
  ])
}

const vcRebaseTargetTextOf = function (op: any, values: any, t: any) {
  const payload: any = vcRebasePayloadOf(op, values)
  if (payload.oldBase !== undefined || payload.newBase !== undefined) return vcRebasePageStrOf(payload.oldBase) + ' → ' + vcRebasePageStrOf(payload.newBase)
  if (Array.isArray(payload.rows)) return t('vc.rebase.target.todo', { base: vcRebasePageStrOf(payload.base), n: payload.rows.length })
  return vcRebasePageStrOf(payload.base)
}

/** 结果条：成功后说做到哪一步、撞冲突就说明停在冲突里；失败给理由词条与 git 原话。 */
const vcRebaseResultNode = function (h: any, t: any, rebase: any) {
  const r: any = rebase || {}
  const result: any = r.result || null
  if (!result) return null
  const op: string = vcRebasePageStrOf(result.op || r.lastOp)
  const ok: boolean = result.ok === true
  const kids: any[] = []
  if (ok) {
    kids.push(h('p', { 'data-vc-rebase-result-line': 'ok' }, [result.conflicted === true ? t('vc.rebase.result.conflicted', { state: t(vcRebaseStateLabelKeyOf(result.state)) }) : t('vc.rebase.result.ok', { verb: t(vcRebaseOpVerbKeyOf(op)) })]))
  } else {
    const err: any = result.error || {}
    const family: string = vcWriteErrFamilyOf(err.reason, err.kind)
    kids.push(h('p', { 'data-vc-rebase-result-line': 'fail' }, [t('vc.rebase.result.fail', { hint: t('vc.writeErr.' + family), git: vcRebasePageStrOf(err.message) })]))
  }
  if (r.handlers && r.handlers.retry) kids.push(h('button', { className: 'dsws-btn dsws-hov', type: 'button', 'data-press': 'button', 'data-log': 'vc.rebase.retry', 'data-vc-rebase-retry': '1', onClick: function () { r.handlers.retry() } }, [t('vc.rebase.result.retry')]))
  return h('section', { className: 'vcs-card', 'data-vc-rebase-result': op, 'data-vc-rebase-result-ok': ok ? '1' : '0' }, kids)
}

/** 一行动作：能力号、动作名、按钮、本行的确认卡/结果条，以及只读动作行下面那块预览卡。 */
const vcRebaseRowNode = function (h: any, t: any, meta: any, rebase: any) {
  const r: any = rebase || {}
  const handlers: any = r.handlers || {}
  const visible: string[] = vcRebaseVisibleOf((r.state || {}).state, (r.state || {}).updateRefs)
  const shown: boolean = visible.indexOf(meta.op) >= 0
  const rowState: any = (r.rows && r.rows[meta.op]) ? r.rows[meta.op] : {}
  const kids: any[] = [
    h('span', { className: 'vcs-cap' }, [meta.capId === '' ? t(vcRebaseOpLabelKeyOf(meta.op)) : t('vc.rebase.opLine', { cap: meta.capId, name: t(vcRebaseOpLabelKeyOf(meta.op)) })]),
  ]
  if (!shown) {
    kids.push(h('span', { className: 'vcs-note', 'data-vc-rebase-hidden': meta.op }, [t('vc.rebase.hidden')]))
  } else {
    kids.push(h('button', { className: 'dsws-btn dsws-hov', type: 'button', 'data-press': 'button', 'data-log': 'vc.rebase.run', 'data-vc-rebase-primary': meta.op, 'data-vc-rebase-op': meta.op, disabled: rowState.busy === true, onClick: function () { if (handlers.begin) handlers.begin(meta.op) } }, [t(vcRebaseOpVerbKeyOf(meta.op))]))
  }
  if (r.confirmOp === meta.op) kids.push(vcRebaseConfirmNode(h, t, r))
  if (rowState.result) kids.push(vcRebaseResultNode(h, t, Object.assign({}, r, { result: rowState.result, lastOp: meta.op })))
  const readCard: any = vcRebaseReadCardOf(h, t, r, meta.op)
  if (readCard) kids.push(readCard)
  return h('li', { className: 'vcs-row', 'data-vc-rebase-action-row': meta.op, 'data-vc-rebase-cap': meta.capId }, kids)
}

/** 第一段「本次变基」：左边状态行说分支与 HEAD，进行中再加一句去冲突向导处理；右边芯片点明当前状态。
 *  芯片色调按现场读到的三件事落：有错误先说失败（红），否则进行中（琥珀）、空闲（灰）。
 *  错误行用 role=alert：读屏与视觉一样第一时间听到它，而且仍留在这一段里，不漂到页面末尾。 */
const vcRebaseNowSectionOf = function (h: any, t: any, rebase: any) {
  const st: any = (rebase || {}).state || {}
  const stateName: string = vcRebasePageStrOf(st.state)
  const idle: boolean = vcRebaseIdleOf(stateName)
  const errorText: string = (rebase && rebase.errorText) ? String(rebase.errorText) : ''
  const main: any[] = [vcRebaseStateNode(h, t, rebase)]
  // 进行中才画那句说明：它解释「为什么四条写动作不出现」，空闲时没有可解释的，画出来只是噪音。
  if (!idle) {
    main.push(vcFlowHintNode(h, t, { key: 'vc.rebase.ongoingHint', params: { state: t(vcRebaseStateLabelKeyOf(stateName)) } }))
  }
  const refsNode: any = vcRebaseUpdateRefsNode(h, t, rebase)
  if (refsNode) main.push(refsNode)
  if (errorText !== '') main.push(h('p', { key: 'error', className: 'vcs-note', role: 'alert', 'data-vc-rebase-error': '1' }, [errorText]))
  const chipKey: string = errorText !== '' ? 'vc.rebase.chip.error' : vcRebaseStateChipKeyOf(stateName)
  const chipTone: string = errorText !== '' ? 'danger' : (idle ? 'muted' : 'warn')
  const side: any[] = [vcFlowChipNode(h, t, { key: chipKey, tone: chipTone })]
  return vcPageSectionNode(h, t, { title: 'vc.rebase.section.now', children: vcPageObjRowNode(h, t, { main: main, side: side }) })
}

/** 六步的标题/说明/命令词条键。命令是给人照着敲的 git 原话，也放进词表——组件里不留可见文字。 */
const VC_REBASE_STEP_KEYS: any[] = [
  { title: 'vc.rebase.step.freeze', detail: 'vc.rebase.step.freezeDetail', command: 'vc.rebase.step.freezeCmd' },
  { title: 'vc.rebase.step.pickBase', detail: 'vc.rebase.step.pickBaseDetail', command: 'vc.rebase.step.pickBaseCmd' },
  { title: 'vc.rebase.step.todoList', detail: 'vc.rebase.step.todoListDetail', command: 'vc.rebase.step.todoListCmd' },
  { title: 'vc.rebase.step.apply', detail: 'vc.rebase.step.applyDetail', command: 'vc.rebase.step.applyCmd' },
  { title: 'vc.rebase.step.verify', detail: 'vc.rebase.step.verifyDetail', command: 'vc.rebase.step.verifyCmd' },
  { title: 'vc.rebase.step.finish', detail: 'vc.rebase.step.finishDetail', command: 'vc.rebase.step.finishCmd' },
]

/** 六步的芯片投影：只按仓库真实状态给，没观测到的步骤一律「待处理」，绝不为好看写「已完成」。
 *  只有 state === 'rebase' 时前三步才算走完、第四步正在走；其它进行中状态（合并/拣选/回退）不是变基，六步全部待处理。 */
const vcRebaseStepChipOf = function (stateName: string, index: number) {
  if (stateName === 'rebase') {
    if (index < 3) return { key: 'vc.rebase.stepChip.done', tone: 'ok' }
    if (index === 3) return { key: 'vc.rebase.stepChip.running', tone: 'warn' }
  }
  return { key: 'vc.rebase.stepChip.pending', tone: 'muted' }
}

/** 六步里的一行：序号 + 步骤名、说明、等宽命令，右侧是状态芯片。序号用等宽字体，与命令同列好对照。 */
const vcRebaseStepRowOf = function (h: any, t: any, step: any, index: number, stateName: string) {
  const chip: any = vcRebaseStepChipOf(stateName, index)
  return vcPageObjRowNode(h, t, {
    main: [
      h('span', { key: 'title', className: 'obj-title' }, [
        h('span', { key: 'num', className: 'mono' }, [String(index + 1)]),
        h('span', { key: 'name' }, [' ' + t(step.title)]),
      ]),
      h('span', { key: 'detail', className: 'obj-sub' }, [t(step.detail)]),
      h('span', { key: 'command', className: 'obj-meta mono vcs-flow-cmd' }, [t(step.command)]),
    ],
    side: [vcFlowChipNode(h, t, { key: chip.key, tone: chip.tone })],
  })
}

/** 第二段「变基六步」：原型 48 的流程说明，放在状态之后、动作之前——先知道要走哪六步，再挑这一页能做的动作。
 *  段计数 6 是固定的六步份数，不是进度；仓库在做别的操作时先用一句提示点明「当前不是变基」，别让读者把芯片误读成进度。 */
const vcRebaseStepsSectionOf = function (h: any, t: any, rebase: any) {
  const st: any = (rebase || {}).state || {}
  const stateName: string = vcRebasePageStrOf(st.state)
  const kids: any[] = []
  if (!vcRebaseIdleOf(stateName) && stateName !== 'rebase') {
    kids.push(vcFlowHintNode(h, t, { key: 'vc.rebase.stepsNotRebase', params: { state: t(vcRebaseStateLabelKeyOf(stateName)) } }))
  }
  for (let i = 0; i < VC_REBASE_STEP_KEYS.length; i += 1) kids.push(vcRebaseStepRowOf(h, t, VC_REBASE_STEP_KEYS[i], i, stateName))
  return vcPageSectionNode(h, t, {
    title: 'vc.rebase.section.steps',
    count: VC_REBASE_STEP_KEYS.length,
    note: 'vc.rebase.section.stepsNote',
    children: kids,
  })
}

/** 第三段「变基动作」：输入区在上、九行动作在下；说明写清「选动作 → 看影响 → 确认」的三段式。 */
const vcRebaseActionsSectionOf = function (h: any, t: any, rebase: any, rows: any[]) {
  return vcPageSectionNode(h, t, {
    title: 'vc.rebase.section.actions',
    note: 'vc.rebase.section.actionsNote',
    children: [
      h('div', { key: 'inputs', className: 'vcs-card', 'data-vc-rebase-inputs': '1' }, vcRebaseInputsNode(h, t, rebase)),
      h('ul', { key: 'actions', className: 'vcs-list', 'data-vc-rebase-actions': String(VC_REBASE_OPS.length) }, rows),
    ],
  })
}

/** 第四段「待办窗口」：标题沿用原有词条；行里仍是动作下拉、上移/下移与改说明输入框。 */
const vcRebaseTodoSectionOf = function (h: any, t: any, rebase: any) {
  return vcPageSectionNode(h, t, {
    title: 'vc.rebase.todo.title',
    children: h('div', { key: 'todo', 'data-vc-rebase-todo': '1' }, [vcRebaseRowsNode(h, t, rebase)]),
  })
}

/** 第五段「会动与不会动」：四格静态事实，说清这次改写动什么、不动什么、什么能回头、什么只能强制推送。 */
const vcRebaseFactsSectionOf = function (h: any, t: any) {
  const facts: any[] = [
    { key: 'vc.rebase.fact.moves', value: 'vc.rebase.fact.movesValue' },
    { key: 'vc.rebase.fact.stays', value: 'vc.rebase.fact.staysValue' },
    { key: 'vc.rebase.fact.undoable', value: 'vc.rebase.fact.undoableValue' },
    { key: 'vc.rebase.fact.notUndoable', value: 'vc.rebase.fact.notUndoableValue' },
  ]
  return vcPageSectionNode(h, t, { title: 'vc.rebase.section.facts', children: vcPageFactGridNode(h, t, { facts: facts }) })
}

/** 页面体：页头由页面壳画，这里只画五段正文；动作行与待办行仍由本文件的 helper 画。
 *  #1845（2026-11-06）：根节点从 section.vcs-page-body 改成正文容器 div —— 页面壳已经把整页
 *  包进 section.vcs-page-body > div.vcs-page-scroll，这里再画一层页面体就成了「嵌套页面体」，
 *  外壳的内边距被套两遍、滚动容器里又出现一个滚动容器。id 与三个 data-* 读数原样保留，
 *  门禁按 data-vc-rebase-page 认页，不受影响。 */
export const vcRebasePageNode = function (h: any, t: any, o: any) {
  const rebase: any = (o && o.rebase) ? o.rebase : {}
  const state: any = rebase.state || {}
  const actionRows: any[] = []
  for (let i = 0; i < VC_REBASE_OPS.length; i += 1) actionRows.push(vcRebaseRowNode(h, t, VC_REBASE_OPS[i], rebase))
  return h('div', {
    className: 'vcs-flow-page',
    id: 'vc-rebase-page',
    'data-vc-rebase-page': '1',
    'data-vc-rebase-op-count': String(VC_REBASE_OPS.length),
    'data-vc-rebase-state': vcRebasePageStrOf(state.state),
  }, [
    vcRebaseNowSectionOf(h, t, rebase),
    vcRebaseStepsSectionOf(h, t, rebase),
    vcRebaseActionsSectionOf(h, t, rebase, actionRows),
    vcRebaseTodoSectionOf(h, t, rebase),
    vcRebaseFactsSectionOf(h, t),
  ])
}
