// vcSubmodulesPage.ts —— 子模块页的正文（#1757 T21，域 10 八条）
//
// 页面只画五块：八条能力的页面入口、固定四项的批量菜单、逐行清单与逐行动作、确认卡与计划预告、结果回执。
// 八条能力的主入口写在 VC_SUBMODULE_ENTRIES（数据层），这里只按顺序画；能力行上那个 data-cap-primary
// 由面板壳的 vcCapabilityListOf 统一出，页面自己绝不写它（否则「每能力恰一个主入口」的计数会翻倍）。
//
// 危险动作（取消登记 deinit、吸收 .git absorb）在确认卡里点名将要动的目录与位置；计划预告（吸收前将移动的
// .git 目录、新增的目标路径）画在确认卡上方，让人先看清楚再点。失败如实贴 git 原话，不假装回滚。
//
// 约定：本文件由构建拼进客户端闭包，不写 import；h/t 由调用方传入，ops 由外壳透传。
// 画树只用 data-vc-sub-* 属性，替代文本一律从词表取（vc.sub.*）。
declare function vcShellConfirmCardNode(h: any, t: any, o: any): any
declare function vcShellResultNode(h: any, t: any, o: any): any
declare function vcShellStateNode(h: any, t: any, o: any): any
declare const VC_SUBMODULE_ENTRIES: any[]
declare function vcSubmodulesUiOf(ui: any): any
declare function vcSubmoduleBatchOf(): any[]
declare function vcSubmoduleRowActionsOf(): any[]
declare function vcSubmoduleWhyKeyOf(reason: any): string
declare function vcSubmoduleCapOf(capId: any): any
declare function vcSubmodulesStateOf(board: any): string
declare function vcSubmoduleRowsOf(board: any): any[]
// 悬停提示统一走全局薄预设 Tip（真实构建里它排在所有视图叶子之前，由调用方注入）。
declare const Tip: any

export const VC_SUBMODULES_PAGE_SOURCE = 'src/client/views/versionControl/vcSubmodulesPage.ts'

/** 事件委托取 data 属性：真 DOM 走 getAttribute，门禁的假节点走 props。 */
function vcSubAttrOf(ev: any, name: string): string {
  if (!ev) return ''
  const node: any = ev.currentTarget || ev.target || null
  if (node && typeof node.getAttribute === 'function') { const v: any = node.getAttribute(name); if (v !== null && v !== undefined) return String(v) }
  if (node && node.props && node.props[name] !== undefined) return String(node.props[name])
  return ''
}
function vcSubClassOf(ev: any): string {
  if (!ev) return ''
  const node: any = ev.currentTarget || ev.target || null
  if (node && typeof node.getAttribute === 'function') return String(node.getAttribute('class') || '')
  if (node && node.props && node.props.className) return String(node.props.className)
  return ''
}
function vcSubCall(ops: any, name: string, args?: any): any {
  if (!ops || typeof ops[name] !== 'function') return null
  try { return ops[name](args) } catch (e) { return null }
}
function vcSubClickOf(ops: any, name: string): any {
  return function (ev: any): void { void vcSubCall(ops, name, ev) }
}

/** 禁用原因常驻一条：有理由就写进 data-vc-sub-why，并在按钮外面套 Tip 悬停，供键盘与读屏取。 */
function vcSubWhyNode(h: any, t: any, reason: any): any {
  const key: string = vcSubmoduleWhyKeyOf(reason)
  return h('p', { key: 'why', className: 'vcs-sub-why', 'data-vc-sub-why': key }, t(key))
}

/** 一条能力入口：li 上标 data-vc-sub-entry=<capId>；点按钮走 ops.start(动作名)。 */
function vcSubEntryNode(h: any, t: any, entry: any, ui: any, ops: any): any {
  const cap: any = vcSubmoduleCapOf(entry.capId)
  const disabled: boolean = !ops
  return h('li', { key: 'entry-' + String(entry.capId), className: 'vcs-sub-entry', 'data-vc-sub-entry': String(entry.capId), 'data-vc-sub-cap-name': String(cap.name || '') }, [
    h('span', { key: 'label', className: 'vcs-sub-entry-label' }, t(String(entry.labelKey))),
    h('button', { key: 'go', type: 'button', className: 'vcs-sub-entry-go', 'data-vc-sub-enter': String(entry.actionId), 'data-sub-cap': String(entry.capId), 'data-press': 'button', 'data-log': 'vc.sub.entry', disabled: disabled, onClick: vcSubClickOf(ops, 'start') }, t('vc.sub.entry.go')),
  ])
}

/** 固定四项批量菜单：每项一个按钮，属性值是菜单号；没有命令输入框。 */
function vcSubBatchNode(h: any, t: any, ui: any, ops: any): any {
  const menu: any[] = vcSubmoduleBatchOf()
  const kids: any[] = []
  for (let i = 0; i < menu.length; i += 1) {
    const m: any = menu[i]
    kids.push(h('button', { key: 'batch-' + String(m.id), type: 'button', className: 'vcs-sub-batch-item', 'data-vc-sub-batch': String(m.id), 'data-vc-sub-task-op': String(m.taskOp || ''), 'data-press': 'button', 'data-log': 'vc.sub.batch.' + String(m.id), disabled: !ops, onClick: vcSubClickOf(ops, 'start') }, t(String(m.labelKey))))
  }
  return h('section', { key: 'batch', className: 'vcs-sub-batch', 'data-vc-sub-batch-section': '1' }, [
    h('h3', { key: 'title', className: 'vcs-sub-section-title' }, t('vc.sub.batch.title')),
    h('div', { key: 'items', className: 'vcs-sub-batch-items' }, kids),
    h('p', { key: 'hint', className: 'vcs-sub-hint' }, t('vc.sub.batch.hint')),
  ])
}

/** 逐行清单里的一行：路径、状态、地址、跟踪分支与逐行动作按钮。 */
function vcSubRowNode(h: any, t: any, row: any, ui: any, ops: any): any {
  const actions: any[] = vcSubmoduleRowActionsOf()
  const buttons: any[] = []
  for (let i = 0; i < actions.length; i += 1) {
    const a: any = actions[i]
    const applicable: boolean = (a.place === 'row') && (row.initialized === true || a.id === 'init')
    const whyText: string = !applicable ? t('vc.sub.why.module-not-initialized') : ''
    const actionButton: any = h('button', { key: 'act-' + String(a.id), type: 'button', className: 'vcs-sub-row-action', 'data-vc-sub-action': String(a.id), 'data-vc-sub-path': String(row.path), 'data-vc-sub-danger': a.danger === true ? '1' : '0', 'data-press': 'button', 'data-log': 'vc.sub.action.' + String(a.id), disabled: !ops || !applicable, onClick: vcSubClickOf(ops, 'start') }, t('vc.sub.action.' + String(a.id)))
    // 做不了的原因放在 Tip 悬停里；全仓门禁要求悬停统一走 Tip 薄预设，不留原生 title。
    buttons.push(whyText ? h(Tip, { key: 'tip-' + String(a.id), content: whyText }, actionButton) : actionButton)
  }
  const badges: any[] = []
  if (row.detached) badges.push(h('span', { key: 'detached', className: 'vcs-sub-badge vcs-sub-badge-detached' }, t('vc.sub.detached')))
  if (row.localCommits > 0 && row.detached) badges.push(h('span', { key: 'local', className: 'vcs-sub-badge vcs-sub-badge-warn' }, t('vc.sub.localCommits', { n: row.localCommits })))
  if (row.absorbable) badges.push(h('span', { key: 'absorb', className: 'vcs-sub-badge' }, t('vc.sub.absorbable')))
  return h('li', { key: 'row-' + String(row.path), className: 'vcs-sub-row', 'data-vc-sub-row': String(row.path), 'data-vc-sub-initialized': row.initialized ? '1' : '0' }, [
    h('div', { key: 'head', className: 'vcs-sub-row-head' }, [
      h('span', { key: 'path', className: 'vcs-sub-row-path' }, String(row.path)),
      h('span', { key: 'state', className: 'vcs-sub-row-state', 'data-vc-sub-state-badge': String(row.state) }, t('vc.sub.state.' + String(row.state || 'uninitialized'))),
    ].concat(badges)),
    h('div', { key: 'info', className: 'vcs-sub-row-info' }, [
      h('span', { key: 'url', className: 'vcs-sub-row-url' }, t('vc.sub.row.url', { url: String(row.urlDisplay || '') })),
      h('span', { key: 'branch', className: 'vcs-sub-row-branch' }, t('vc.sub.row.branch', { branch: String(row.headBranch || row.branch || '') })),
      h('span', { key: 'oid', className: 'vcs-sub-row-oid' }, String(row.oid || '').slice(0, 10)),
    ]),
    h('div', { key: 'actions', className: 'vcs-sub-row-actions' }, buttons),
  ])
}

/** 清单区四态：读数中、失败可重试、空清单、有行。 */
function vcSubListSectionNode(h: any, t: any, state: string, board: any, ui: any, ops: any): any {
  if (state === 'loading' || state === 'reading') return h('div', { key: 'list', className: 'vcs-sub-list', 'data-vc-sub-list': 'loading' }, [vcShellStateNode(h, t, { state: 'loading' })])
  if (state === 'error') {
    const err: any = (board && board.error) || { kind: '', message: '' }
    return h('div', { key: 'list', className: 'vcs-sub-list', 'data-vc-sub-list': 'error' }, [
      vcShellStateNode(h, t, { state: 'error', reason: t('vc.sub.errorNext', { why: String(err.message || '') }) }),
      h('button', { key: 'retry', type: 'button', className: 'vcs-sub-retry', 'data-vc-sub-action': 'read', 'data-press': 'button', 'data-log': 'vc.sub.list.retry', disabled: !ops, onClick: vcSubClickOf(ops, 'refresh') }, t('vc.sub.refresh')),
    ])
  }
  const rows: any[] = board && Array.isArray(board.rows) ? board.rows : vcSubmoduleRowsOf(board && board.board ? board.board : null)
  if (!rows.length) return h('div', { key: 'list', className: 'vcs-sub-list', 'data-vc-sub-list': 'empty' }, [h('p', { key: 'empty', className: 'vcs-sub-empty' }, t('vc.sub.listEmpty'))])
  const items: any[] = []
  for (let i = 0; i < rows.length; i += 1) items.push(vcSubRowNode(h, t, rows[i], ui, ops))
  return h('section', { key: 'list', className: 'vcs-sub-list', 'data-vc-sub-list': 'rows' }, [
    h('h3', { key: 'title', className: 'vcs-sub-section-title' }, t('vc.sub.listTitle', { n: rows.length })),
    h('ul', { key: 'ul', className: 'vcs-sub-rows' }, items),
  ])
}

/** 计划预告：吸收前要移动的 .git 目录、新增动作的目标路径。动手前先看见。 */
function vcSubPlanNode(h: any, t: any, ui: any): any {
  const plan: any = ui.plan || {}
  const moves: any[] = Array.isArray(plan.moves) ? plan.moves : []
  const kids: any[] = [h('h3', { key: 'title', className: 'vcs-sub-section-title' }, t('vc.sub.plan.title'))]
  if (moves.length) {
    const items: any[] = []
    for (let i = 0; i < moves.length; i += 1) items.push(h('li', { key: 'move-' + i, 'data-vc-sub-move': String(moves[i].from || '') }, t('vc.sub.plan.move', { from: String(moves[i].from || ''), to: String(moves[i].to || '') })))
    kids.push(h('ul', { key: 'moves', className: 'vcs-sub-moves' }, items))
  } else if (plan.path) {
    kids.push(h('p', { key: 'target', className: 'vcs-sub-plan-target', 'data-vc-sub-plan-path': String(plan.path) }, t('vc.sub.plan.target', { path: String(plan.path) })))
  } else {
    kids.push(h('p', { key: 'none', className: 'vcs-sub-hint' }, t('vc.sub.plan.none')))
  }
  return h('section', { key: 'plan', className: 'vcs-sub-plan', 'data-vc-sub-plan': String(plan.action || '') }, kids)
}

/** 确认卡：四段由 vcShellConfirmCardNode 画，这里补取消/确认两个按钮与默认焦点。 */
function vcSubConfirmNode(h: any, t: any, ui: any, ops: any): any {
  const plan: any = ui.plan || {}
  const verb: string = t('vc.sub.action.' + String(plan.action || ui.op || ''))
  const target: string = String(plan.path || ui.field.path || '')
  return h('div', { key: 'confirm', className: 'vcs-sub-confirm-wrap', 'data-vc-sub-confirm': '1' }, [
    vcShellConfirmCardNode(h, t, { verb: verb, target: t('vc.sub.confirmTarget', { cmd: String(plan.action || ''), target: target }) }),
    h('div', { key: 'buttons', className: 'vcs-sub-confirm-buttons' }, [
      h('button', { key: 'cancel', type: 'button', className: 'vcs-confirm-cancel', 'data-focus-default': 'cancel', 'data-vc-sub-cancel': '1', 'data-press': 'button', 'data-log': 'vc.sub.confirm.cancel', onClick: vcSubClickOf(ops, 'cancelConfirm') }, t('vc.sub.confirm.cancel')),
      h('button', { key: 'go', type: 'button', className: 'vcs-confirm-go', 'data-vc-sub-go': '1', 'data-press': 'button', 'data-log': 'vc.sub.confirm.go', onClick: vcSubClickOf(ops, 'confirmNow') }, t('vc.sub.confirm.go', { verb: verb })),
    ]),
  ])
}

/** 被拦：常驻显示理由与下一步；不画确认按钮。 */
function vcSubBlockedNode(h: any, t: any, ui: any, ops: any): any {
  const reasons: any[] = Array.isArray(ui.reasons) && ui.reasons.length ? ui.reasons : [ui.error && ui.error.reason]
  const items: any[] = []
  for (let i = 0; i < reasons.length; i += 1) items.push(vcSubWhyNode(h, t, reasons[i]))
  return h('section', { key: 'blocked', className: 'vcs-sub-blocked', 'data-vc-sub-blocked': '1' }, [
    h('h3', { key: 'title', className: 'vcs-sub-section-title' }, t('vc.sub.blockedTitle')),
    h('div', { key: 'reasons', className: 'vcs-sub-why' }, items),
    h('p', { key: 'next', className: 'vcs-sub-hint' }, t('vc.sub.blockedNext')),
    h('button', { key: 'back', type: 'button', className: 'vcs-sub-retry', 'data-vc-sub-action': 'retry', 'data-press': 'button', 'data-log': 'vc.sub.blocked.back', onClick: vcSubClickOf(ops, 'retry') }, t('vc.sub.back')),
  ])
}

/** 结果回执：失败贴 git 原话与期望/实际，成功只报 git 子命令名、耗时、对象数。 */
function vcSubResultNode(h: any, t: any, ui: any, ops: any): any {
  if (ui.mode === 'running') return h('div', { key: 'result', className: 'vcs-sub-result', 'data-vc-sub-result': 'running' }, [vcShellStateNode(h, t, { state: 'loading' })])
  if (ui.mode === 'failed') {
    const err: any = ui.error || {}
    return h('div', { key: 'result', className: 'vcs-sub-result', 'data-vc-sub-result': 'failed' }, [
      vcShellResultNode(h, t, { error: String(err.kind || ''), git: String(err.gitText || err.message || ''), message: String(err.message || ''), step: String(err.step || ''), expected: String(err.expected || ''), actual: String(err.actual || ''), cause: String(err.cause || '') }),
      h('button', { key: 'retry', type: 'button', className: 'vcs-sub-retry', 'data-vc-sub-action': 'retry', 'data-press': 'button', 'data-log': 'vc.sub.result.retry', onClick: vcSubClickOf(ops, 'retry') }, t('vc.sub.retry')),
    ])
  }
  if (ui.mode === 'done') {
    const result: any = ui.result || {}
    return h('div', { key: 'result', className: 'vcs-sub-result', 'data-vc-sub-result': 'done' }, [
      vcShellResultNode(h, t, { cmd: String(result.command || result.op || ''), ms: typeof result.ms === 'number' ? result.ms : null, n: typeof result.n === 'number' ? result.n : null, next: t('vc.sub.result.next') }),
      h('button', { key: 'close', type: 'button', className: 'vcs-sub-retry', 'data-vc-sub-action': 'board', 'data-press': 'button', 'data-log': 'vc.sub.result.close', onClick: vcSubClickOf(ops, 'cancelConfirm') }, t('vc.sub.result.close')),
    ])
  }
  return null
}

/** 页面根：标题、刷新、八条入口、批量菜单、清单、当前一态（确认/被拦/结果）。 */
export function vcSubmodulesPageNode(h: any, t: any, o: any): any {
  const opts: any = o || {}
  const board: any = opts.board || null
  const ui: any = vcSubmodulesUiOf(opts.ui)
  const ops: any = opts.ops || null
  const state: string = board && board.state ? String(board.state) : vcSubmodulesStateOf(board)
  const count: number = board && Array.isArray(board.rows) ? board.rows.length : (board && board.board ? vcSubmoduleRowsOf(board.board).length : 0)
  const children: any[] = [
    h('header', { key: 'head', className: 'vcs-sub-head' }, [
      h('h2', { key: 'title', className: 'vcs-sub-title' }, t('vc.sub.title')),
      h('span', { key: 'count', className: 'vcs-sub-count' }, t('vc.sub.count', { n: count })),
      h('button', { key: 'refresh', type: 'button', className: 'vcs-sub-refresh', 'data-vc-sub-action': 'read', 'data-press': 'button', 'data-log': 'vc.sub.refresh', disabled: !ops, onClick: vcSubClickOf(ops, 'refresh') }, t('vc.sub.refresh')),
    ]),
  ]
  const entries: any[] = []
  for (let i = 0; i < VC_SUBMODULE_ENTRIES.length; i += 1) entries.push(vcSubEntryNode(h, t, VC_SUBMODULE_ENTRIES[i], ui, ops))
  children.push(h('section', { key: 'entries', className: 'vcs-sub-entries', 'data-vc-sub-entries': '1' }, [h('h3', { key: 'title', className: 'vcs-sub-section-title' }, t('vc.sub.entriesTitle')), h('ul', { key: 'ul', className: 'vcs-sub-entry-list' }, entries)]))
  children.push(vcSubBatchNode(h, t, ui, ops))
  children.push(vcSubListSectionNode(h, t, state, board, ui, ops))
  if (ui.mode === 'confirm') { children.push(vcSubPlanNode(h, t, ui)); children.push(vcSubConfirmNode(h, t, ui, ops)) }
  if (ui.mode === 'blocked') children.push(vcSubBlockedNode(h, t, ui, ops))
  if (ui.mode === 'running' || ui.mode === 'failed' || ui.mode === 'done') children.push(vcSubResultNode(h, t, ui, ops))
  return h('section', { key: 'vc-submodules-page', id: 'vc-submodules-page', className: 'vcs-sub-page', role: 'region', 'data-vc-sub-page': '1', 'data-vc-sub-mode': String(ui.mode), 'data-vc-sub-state': String(state) }, children)
}
