// views/versionControl/vcRebasePage.ts —— 变基待办页的页面体（#1749 T14，能力 5.6/5.7/5.8/5.10）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处。
// 职责四条：
//   1. 画当前状态：有没有进行中的操作、分支与 HEAD、仓库是否开着 rebase.updateRefs（开着就只说不做）；
//   2. 画待办窗口并允许逐行选六个动作（保留、改说明、压缩、丢弃、上移、下移），改说明用面板输入框；
//   3. 画换基座范围、自动吸收清单、保留合并结构的代价三块只读预览，以及四条写动作的按钮；
//   4. 画四段确认卡与结果条，失败话术与其它页同源（vc.writeErr.* 词条族）。
// 界面里一个中文字面量都没有：可见文字全走 t(词条)，词条真源 config/copy/vcrebase.yaml。
// 页面不算命令、不拼 argv：动作与载荷全走 vcRebaseOps.ts 的纯函数，电话由调用方的 handlers 打。

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

const vcRebasePageStrOf = function (x: any) { return String(x === undefined || x === null ? '' : x) }
const vcRebasePageKeyOf = function (name: any) { return vcRebasePageStrOf(name).replace(/-([a-z])/g, function (m: string, c: string) { return c.toUpperCase() }) }

/** 当前状态一行：没有进行中操作时说清在哪个分支、HEAD 是哪一个；有就点名并要求先处理。 */
const vcRebaseStateNode = function (h: any, t: any, rebase: any) {
  const r: any = rebase || {}
  const st: any = r.state || {}
  const stateName: string = vcRebasePageStrOf(st.state)
  const text: string = stateName === ''
    ? t('vc.rebase.stateLine.clean', { branch: vcRebasePageStrOf(st.branch), head: vcRebasePageStrOf(st.headOid).slice(0, 10) })
    : t('vc.rebase.stateLine.ongoing', { state: t(vcRebaseStateLabelKeyOf(stateName)) })
  return h('p', { className: 'vcs-note', 'data-vc-rebase-state-line': stateName === '' ? 'clean' : 'ongoing' }, [text])
}

/** rebase.updateRefs=true 时只说不做：面板不替人改仓库配置。 */
const vcRebaseUpdateRefsNode = function (h: any, t: any, rebase: any) {
  const st: any = (rebase || {}).state || {}
  if (st.updateRefs !== true) return null
  return h('p', { className: 'vcs-note', 'data-vc-rebase-updaterefs': 'on' }, [t('vc.rebase.updateRefsOn')])
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
      h('button', { className: 'dsws-btn dsws-hov', type: 'button', 'data-press': 'button', 'data-log': 'vc.rebase.moveUp', 'data-vc-rebase-move': 'up', disabled: i === 0, onClick: function () { if (rebase.handlers && rebase.handlers.move) rebase.handlers.move(i, 'move-up') } }, [t('vc.rebase.move.up')]),
      h('button', { className: 'dsws-btn dsws-hov', type: 'button', 'data-press': 'button', 'data-log': 'vc.rebase.moveDown', 'data-vc-rebase-move': 'down', disabled: i === rows.length - 1, onClick: function () { if (rebase.handlers && rebase.handlers.move) rebase.handlers.move(i, 'move-down') } }, [t('vc.rebase.move.down')]),
    ]
    if (action === 'reword') {
      lineKids.push(h('textarea', { className: 'dsws-input', 'data-vc-rebase-message': String(i), rows: 2, value: vcRebasePageStrOf(row.message), placeholder: t('vc.rebase.todo.messagePlaceholder'), onInput: function (e: any) { if (rebase.handlers && rebase.handlers.setRow) rebase.handlers.setRow(i, { message: vcRebasePageStrOf(e && e.target && e.target.value) }) } }, []))
    }
    kids.push(h('li', { className: 'vcs-row', 'data-vc-rebase-row': vcRebasePageStrOf(row.oid), 'data-vc-rebase-row-index': String(i) }, lineKids))
  }
  return h('ol', { className: 'vcs-list', 'data-vc-rebase-rows': String(rows.length) }, kids)
}

/** 三块只读预览：换基座范围、自动吸收清单、保留合并结构的代价；读数没到就画「先读一次」。 */
const vcRebaseReadNodes = function (h: any, t: any, rebase: any) {
  const r: any = rebase || {}
  const read: any = r.reads || {}
  const kids: any[] = []
  const win: any = read.window || null
  if (win) {
    const lines: any[] = Array.isArray(win.commits) ? win.commits.map(function (c: any) {
      return h('li', { className: 'vcs-row', 'data-vc-rebase-window-commit': vcRebasePageStrOf(c && c.oid) }, [vcRebasePageStrOf(c && c.oid).slice(0, 10) + ' ' + vcRebasePageStrOf(c && c.subject)])
    }) : []
    kids.push(h('section', { className: 'vcs-card', 'data-vc-rebase-read': 'window', 'data-vc-rebase-window-count': String(win.commitCount || 0) }, [h('h4', {}, [t('vc.rebase.window.title', { base: vcRebasePageStrOf(win.base) })]), h('ol', {}, lines)]))
  }
  const onto: any = read.onto || null
  if (onto) {
    const moved: any[] = Array.isArray(onto.moved) ? onto.moved.map(function (c: any) {
      return h('li', { className: 'vcs-row', 'data-vc-rebase-moved': vcRebasePageStrOf(c && c.oid) }, [vcRebasePageStrOf(c && c.oid).slice(0, 10) + ' ' + vcRebasePageStrOf(c && c.subject)])
    }) : []
    kids.push(h('section', { className: 'vcs-card', 'data-vc-rebase-read': 'onto-range', 'data-vc-rebase-moved-count': String(onto.movedCount || 0), 'data-vc-rebase-incoming-count': String(onto.incomingCount || 0) }, [h('h4', {}, [t('vc.rebase.onto.title', { oldBase: vcRebasePageStrOf(onto.oldBase), newBase: vcRebasePageStrOf(onto.newBase) })]), h('p', {}, [t('vc.rebase.onto.counts', { moved: String(onto.movedCount || 0), incoming: String(onto.incomingCount || 0) })]), h('ol', {}, moved)]))
  }
  const pairs: any = read.pairs || null
  if (pairs) {
    const list: any[] = Array.isArray(pairs.pairs) ? pairs.pairs.map(function (p: any) {
      return h('li', { className: 'vcs-row', 'data-vc-rebase-pair': vcRebasePageStrOf(p && p.oid), 'data-vc-rebase-pair-kind': vcRebasePageStrOf(p && p.kind) }, [t('vc.rebase.pairs.line', { oid: vcRebasePageStrOf(p && p.oid).slice(0, 10), kind: t('vc.rebase.pairs.kind.' + vcRebasePageKeyOf((p && p.kind) || '')), target: vcRebasePageStrOf(p && p.targetOid).slice(0, 10) })])
    }) : []
    kids.push(h('section', { className: 'vcs-card', 'data-vc-rebase-read': 'autosquash-pairs', 'data-vc-rebase-pair-count': String((pairs.pairs || []).length) }, [h('h4', {}, [t('vc.rebase.pairs.title')]), h('ol', {}, list)]))
  }
  const merges: any = read.merges || null
  if (merges) {
    const list: any[] = Array.isArray(merges.mergeCommits) ? merges.mergeCommits.map(function (c: any) {
      return h('li', { className: 'vcs-row', 'data-vc-rebase-merge': vcRebasePageStrOf(c && c.oid) }, [vcRebasePageStrOf(c && c.oid).slice(0, 10) + ' ' + vcRebasePageStrOf(c && c.subject)])
    }) : []
    kids.push(h('section', { className: 'vcs-card', 'data-vc-rebase-read': 'merges-cost', 'data-vc-rebase-merge-count': String(merges.count || 0) }, [h('h4', {}, [t('vc.rebase.merges.title')]), h('p', { className: 'vcs-note' }, [t('vc.rebase.merges.cost', { n: String(merges.count || 0) })]), h('ol', {}, list)]))
  }
  return kids
}

/** 输入区：待办与自动吸收/保留合并结构共用基座，换基座用新旧两个基座。 */
const vcRebaseInputsNode = function (h: any, t: any, rebase: any) {
  const r: any = rebase || {}
  const v: any = r.values || {}
  const handlers: any = r.handlers || {}
  const kids: any[] = []
  kids.push(h('label', { className: 'vcs-field' }, [h('span', {}, [t('vc.rebase.field.base')]), h('input', { className: 'dsws-input', type: 'text', 'data-vc-rebase-field': 'base', value: vcRebasePageStrOf(v.base), placeholder: t('vc.rebase.field.baseHint'), onChange: function (e: any) { if (handlers.setField) handlers.setField('base', vcRebasePageStrOf(e && e.target && e.target.value)) } })]))
  kids.push(h('label', { className: 'vcs-field' }, [h('span', {}, [t('vc.rebase.field.oldBase')]), h('input', { className: 'dsws-input', type: 'text', 'data-vc-rebase-field': 'oldBase', value: vcRebasePageStrOf(v.oldBase), placeholder: t('vc.rebase.field.baseHint'), onChange: function (e: any) { if (handlers.setField) handlers.setField('oldBase', vcRebasePageStrOf(e && e.target && e.target.value)) } })]))
  kids.push(h('label', { className: 'vcs-field' }, [h('span', {}, [t('vc.rebase.field.newBase')]), h('input', { className: 'dsws-input', type: 'text', 'data-vc-rebase-field': 'newBase', value: vcRebasePageStrOf(v.newBase), placeholder: t('vc.rebase.field.baseHint'), onChange: function (e: any) { if (handlers.setField) handlers.setField('newBase', vcRebasePageStrOf(e && e.target && e.target.value)) } })]))
  kids.push(h('button', { className: 'dsws-btn dsws-hov', type: 'button', 'data-press': 'button', 'data-log': 'vc.rebase.readWindow', 'data-vc-rebase-read-action': 'window', onClick: function () { if (handlers.read) handlers.read('rebase-window', { base: vcRebasePageStrOf(v.base) }) } }, [t('vc.rebase.read.window')]))
  kids.push(h('button', { className: 'dsws-btn dsws-hov', type: 'button', 'data-press': 'button', 'data-log': 'vc.rebase.readRange', 'data-vc-rebase-read-action': 'onto-range', onClick: function () { if (handlers.read) handlers.read('rebase-onto-range', { oldBase: vcRebasePageStrOf(v.oldBase), newBase: vcRebasePageStrOf(v.newBase) }) } }, [t('vc.rebase.read.ontoRange')]))
  kids.push(h('button', { className: 'dsws-btn dsws-hov', type: 'button', 'data-press': 'button', 'data-log': 'vc.rebase.readPairs', 'data-vc-rebase-read-action': 'autosquash-pairs', onClick: function () { if (handlers.read) handlers.read('rebase-autosquash-pairs', { base: vcRebasePageStrOf(v.base) }) } }, [t('vc.rebase.read.pairs')]))
  kids.push(h('button', { className: 'dsws-btn dsws-hov', type: 'button', 'data-press': 'button', 'data-log': 'vc.rebase.readMerges', 'data-vc-rebase-read-action': 'merges-cost', onClick: function () { if (handlers.read) handlers.read('rebase-merges-cost', { base: vcRebasePageStrOf(v.base) }) } }, [t('vc.rebase.read.merges')]))
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

/** 一行动作：能力号、动作名、按钮、本行的确认卡与结果条。 */
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
  return h('li', { className: 'vcs-row', 'data-vc-rebase-action-row': meta.op, 'data-vc-rebase-cap': meta.capId }, kids)
}

/** 页面体：状态、updateRefs 提醒、输入与预览、待办清单、九行动作。 */
export const vcRebasePageNode = function (h: any, t: any, o: any) {
  const rebase: any = (o && o.rebase) ? o.rebase : {}
  const state: any = rebase.state || {}
  const kids: any[] = [
    h('h3', {}, [t('vc.rebase.pageTitle')]),
    h('p', { className: 'vcs-note' }, [t('vc.rebase.hint')]),
    vcRebaseStateNode(h, t, rebase),
  ]
  const updateRefsNode: any = vcRebaseUpdateRefsNode(h, t, rebase)
  if (updateRefsNode) kids.push(updateRefsNode)
  if (rebase.errorText) kids.push(h('p', { className: 'vcs-note', 'data-vc-rebase-error': '1' }, [String(rebase.errorText)]))
  kids.push(h('section', { className: 'vcs-card', 'data-vc-rebase-inputs': '1' }, vcRebaseInputsNode(h, t, rebase)))
  const readNodes: any[] = vcRebaseReadNodes(h, t, rebase)
  for (let i = 0; i < readNodes.length; i += 1) kids.push(readNodes[i])
  kids.push(h('section', { className: 'vcs-card', 'data-vc-rebase-todo': '1' }, [h('h4', {}, [t('vc.rebase.todo.title')]), vcRebaseRowsNode(h, t, rebase)]))
  const rows: any[] = []
  for (let i = 0; i < VC_REBASE_OPS.length; i += 1) rows.push(vcRebaseRowNode(h, t, VC_REBASE_OPS[i], rebase))
  kids.push(h('ul', { className: 'vcs-list', 'data-vc-rebase-actions': String(VC_REBASE_OPS.length) }, rows))
  return h('section', { className: 'vcs-page-body', id: 'vc-rebase-page', 'data-vc-rebase-page': '1', 'data-vc-rebase-op-count': String(VC_REBASE_OPS.length), 'data-vc-rebase-state': vcRebasePageStrOf(state.state) }, kids)
}
