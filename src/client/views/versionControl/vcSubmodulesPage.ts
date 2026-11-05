// vcSubmodulesPage.ts —— 子模块页的正文（#1757 T21 起；#1843 阶段 4 按定稿原型重做）
//
// 页面只画正文，页头（标题、导语与返回键）由 vcShellPages 统一画；正文从 page-stack 纵向栈开始，
// 按原型 40 的顺序排两段：子模组清单 → 批量动作。页尾的「本页负责的能力」清单已随 #1860 整块退役，
// 八条能力的逐条入口仍可在命令面板与管理索引里到达，本页不再画第二份清单（#1843 重新贴壳时按票面确认）。
// 清单段里每一行只回答三件事：
// 路径、当前提交、与父仓记录的差异；逐行可用动作靠右。确认卡、被拦理由、结果回执沿用原有结构与
// data-vc-sub-* 锚点，另起一套会让外壳的事件委托与门禁同时失配。
//
// 约定（改了会打破门禁或外壳契约）：
//   1. 页面根必须保留 data-vc-sub-page 这个属性、值写字符串 1。反证门禁靠替换它来验证「页面自己不许写
//      能力主入口属性」；属性被删或被改写，反证会静默失效，门禁判红。注释里不要再抄一遍这个属性的完整
//      字面量写法：门禁替换的是源码里第一次出现的位置，抄在注释里会让它换错地方。
//   2. 危险动作先预检再确认：确认卡借 vcShellConfirmCardNode，取消键带 data-focus-default（默认焦点
//      落在安全的那个键上），执行键带 vcs-confirm-go。页面自己不弹确认卡，也不在行内确认。
//   3. 页面只通过 o.ops 的 refresh / start / field / confirmNow / cancelConfirm / retry 做动作，
//      不直接发宿主电话，也不新增能力。
//   4. 行内动作必须显式传动作名与 {path}。旧页把事件对象当动作名传给 ops.start，会被判成
//      unknown-action；改回事件委托就会复发。
//
// 本文件由构建拼进客户端闭包，不写 import；h/t 由调用方传入；界面文字一律走词表键（vc.sub.*）。
declare function vcPageSectionNode(h: any, t: any, o: any): any
declare function vcPageObjRowNode(h: any, t: any, o: any): any
declare function vcShellConfirmCardNode(h: any, t: any, o: any): any
declare function vcShellResultNode(h: any, t: any, o: any): any
declare function vcShellStateNode(h: any, t: any, o: any): any
declare function vcSubmodulesUiOf(ui: any): any
declare function vcSubmoduleBatchOf(): any[]
declare function vcSubmoduleRowActionsOf(): any[]
declare function vcSubmoduleWhyKeyOf(reason: any): string
declare function vcSubmodulesStateOf(board: any): string
declare function vcSubmoduleRowsOf(board: any): any[]
// 悬停提示统一走全局薄预设 Tip（真实构建里它排在所有视图叶子之前，由调用方注入）。
declare const Tip: any

export const VC_SUBMODULES_PAGE_SOURCE = 'src/client/views/versionControl/vcSubmodulesPage.ts'

/** 通用调用口：ops 可能为 null（只画结构的评审态），也可能缺某个方法；两种情况都安静返回，不抛错。 */
function vcSubInvoke(ops: any, name: string, args: any[]): any {
  if (!ops || typeof ops[name] !== 'function') return null
  try { return ops[name].apply(ops, args) } catch (e) { return null }
}

/** 动作按钮的点击处理器：动作名在渲染时就固定下来，点击时才调用，避免闭包里再猜事件对象是什么。 */
function vcSubStartOf(ops: any, actionId: any, preset: any): any {
  return function (): void { void vcSubInvoke(ops, 'start', [String(actionId), preset || {}]) }
}

/** 不带参数的处理器（刷新、重试、取消确认等）；参数用数组固定，不让通用调用口把事件对象误当第一个参数。 */
function vcSubCallOf(ops: any, name: string, args: any[]): any {
  return function (): void { void vcSubInvoke(ops, name, args) }
}

/** 一个状态徽章：语气（is-ok / is-warn / is-danger / is-read）由调用方按读数给，徽章只管显示词条。 */
function vcSubBadgeNode(h: any, t: any, tone: string, key: string, vars: any): any {
  return h('span', { key: 'badge-' + key, className: 'vcs-badge ' + tone }, t(key, vars))
}

/** 状态读数到徽章语气的映射：冲突是红，未初始化与不一致是黄，正常是绿。 */
function vcSubStateToneOf(state: any): string {
  if (state === 'conflict') return 'is-danger'
  if (state === 'different' || state === 'uninitialized') return 'is-warn'
  return 'is-ok'
}

/**
 * 差异说明只挑一条最要紧的说，顺序是：未初始化 → 冲突 → 与记录不同 → 脱离分支 → 本地提交 → 可吸收 → 一致。
 * 顺序反了会让「未初始化」被「有本地提交」这类次要读数盖住，评审时就看不出该先做什么；这条顺序不能改。
 */
function vcSubRowDiffKeyOf(row: any): string {
  if (row.initialized !== true) return 'vc.sub.rowDiff.uninitialized'
  if (row.state === 'conflict') return 'vc.sub.rowDiff.conflict'
  if (row.state === 'different') return 'vc.sub.rowDiff.different'
  if (row.detached === true) return 'vc.sub.rowDiff.detached'
  if (typeof row.localCommits === 'number' && row.localCommits > 0) return 'vc.sub.rowDiff.localCommits'
  if (row.absorbable === true) return 'vc.sub.rowDiff.absorbable'
  return 'vc.sub.rowDiff.clean'
}

/**
 * 逐行动作预检时要不要顺带送别的字段：改地址要 url、改跟踪分支要 branch。
 * 表单里现有的地址栏是页面唯一的地址文本来源，有值就带上；没有就送空串让预检如实报 url-blank，
 * 不拿旧值或父仓记录冒充用户输入。
 */
function vcSubRowPresetOf(action: any, row: any, ui: any): any {
  const preset: any = { path: String(row.path || '') }
  const field: any = ui && ui.field ? ui.field : {}
  if (action.id === 'set-url' && field.url) preset.url = String(field.url)
  if (action.id === 'set-branch' && field.branch) preset.branch = String(field.branch)
  return preset
}

/** 清单里的一行：主区三件事（路径、当前提交、差异），右侧是这一行现在能做的动作。 */
function vcSubRowNode(h: any, t: any, row: any, ui: any, ops: any, index: number): any {
  const actions: any[] = vcSubmoduleRowActionsOf()
  const buttons: any[] = []
  for (let i = 0; i < actions.length; i += 1) {
    const a: any = actions[i]
    const applicable: boolean = (a.place === 'row') && (row.initialized === true || a.id === 'init')
    const whyText: string = applicable ? '' : t('vc.sub.why.module-not-initialized')
    const button: any = h('button', {
      key: 'act-' + String(a.id), type: 'button', className: 'vcs-sub-row-action',
      'data-vc-sub-action': String(a.id), 'data-vc-sub-path': String(row.path),
      'data-vc-sub-danger': a.danger === true ? '1' : '0',
      'data-press': 'button', 'data-log': 'vc.sub.action.' + String(a.id),
      disabled: !ops || !applicable,
      onClick: vcSubStartOf(ops, a.id, vcSubRowPresetOf(a, row, ui)),
    }, t('vc.sub.action.' + String(a.id)))
    // 做不了的原因放在 Tip 悬停里；全仓门禁要求悬停统一走 Tip 薄预设，不留原生 title。
    buttons.push(whyText ? h(Tip, { key: 'tip-' + String(a.id), content: whyText }, button) : button)
  }
  const badges: any[] = []
  if (row.detached) badges.push(vcSubBadgeNode(h, t, 'is-warn', 'vc.sub.detached', null))
  if (row.localCommits > 0 && row.detached) badges.push(vcSubBadgeNode(h, t, 'is-warn', 'vc.sub.localCommits', { n: row.localCommits }))
  if (row.absorbable) badges.push(vcSubBadgeNode(h, t, 'is-read', 'vc.sub.absorbable', null))
  const main: any[] = [
    h('div', { key: 'head', className: 'page-card-head' }, [
      h('code', { key: 'path', className: 'page-card-title' }, String(row.path)),
      vcSubBadgeNode(h, t, vcSubStateToneOf(row.state), 'vc.sub.state.' + String(row.state || 'uninitialized'), null),
    ].concat(badges)),
    h('p', { key: 'commit', className: 'page-card-sub' }, row.initialized === true && row.oid
      ? t('vc.sub.row.commit', { oid: String(row.oid).slice(0, 10) })
      : t('vc.sub.row.commitNone')),
    h('p', { key: 'diff', className: 'page-card-sub', 'data-vc-sub-diff': String(row.state || '') }, t(vcSubRowDiffKeyOf(row), { n: row.localCommits || 0 })),
  ]
  return h('div', {
    key: 'row-' + String(index), 'data-vc-sub-row': String(row.path),
    'data-vc-sub-initialized': row.initialized ? '1' : '0',
  }, [vcPageObjRowNode(h, t, { main: main, side: [h('div', { key: 'actions', className: 'page-row-actions' }, buttons)] })])
}

/** 添加表单：路径与地址两栏，提交键是整页唯一的主色按钮。 */
function vcSubAddFormNode(h: any, t: any, ui: any, ops: any, formKey: string): any {
  const field: any = ui && ui.field ? ui.field : {}
  return h('div', { key: formKey, className: 'inline-form', 'data-vc-sub-form': 'add' }, [
    h('label', { key: 'path-field', className: 'inline-field' }, [
      h('span', { key: 'path-label', className: 'inline-label' }, t('vc.sub.form.pathLabel')),
      h('input', {
        key: 'path-input', type: 'text', className: 'inline-input', 'data-vc-sub-field': 'path',
        value: String(field.path || ''), placeholder: t('vc.sub.form.pathPlaceholder'),
        onChange: function (ev: any): void {
          void vcSubInvoke(ops, 'field', ['path', String(ev && ev.target ? ev.target.value : '')])
        },
      }),
    ]),
    h('label', { key: 'url-field', className: 'inline-field' }, [
      h('span', { key: 'url-label', className: 'inline-label' }, t('vc.sub.form.urlLabel')),
      h('input', {
        key: 'url-input', type: 'text', className: 'inline-input', 'data-vc-sub-field': 'url',
        value: String(field.url || ''), placeholder: t('vc.sub.form.urlPlaceholder'),
        onChange: function (ev: any): void {
          void vcSubInvoke(ops, 'field', ['url', String(ev && ev.target ? ev.target.value : '')])
        },
      }),
    ]),
    h('button', {
      key: 'submit', type: 'button', className: 'btn-primary', 'data-vc-sub-action': 'add',
      'data-press': 'button', 'data-log': 'vc.sub.form.add', disabled: !ops,
      onClick: vcSubAddSubmitOf(ops, ui),
    }, t('vc.sub.form.submit')),
  ])
}

/**
 * 提交添加：顺序固定为 field('path') → field('url') → start('add')。
 * 不能只靠 start 的预检：事件里的 setUi 是异步的，用户刚敲完的字符未必已经落进 ops 读到的 ui，
 * 所以先把两个字段写一遍，再用同一个值作为 start 的 preset 同步带上——只收地址会让预检落进
 * path-blank，被拦死循环。
 */
function vcSubAddSubmitOf(ops: any, ui: any): any {
  return function (): void {
    if (!ops) return
    const field: any = ui && ui.field ? ui.field : {}
    const path: string = String(field.path || '')
    const url: string = String(field.url || '')
    void vcSubInvoke(ops, 'field', ['path', path])
    void vcSubInvoke(ops, 'field', ['url', url])
    void vcSubInvoke(ops, 'start', ['add', { path: path, url: url }])
  }
}

/** 批量动作段：四个固定菜单项。看状态只重读清单，其余三项各自起步并由宿主签票。 */
function vcSubBatchGoOf(ops: any, menuId: string): any {
  return function (): void {
    if (!ops) return
    if (menuId === 'status') { void vcSubInvoke(ops, 'refresh', []); return }
    void vcSubInvoke(ops, 'start', [menuId])
  }
}

/** 清单段：读数中、失败可重试、没有子模块、有行四态；有行时把添加表单放在段末，没有时放进空态块。 */
function vcSubListSectionNode(h: any, t: any, state: string, board: any, ui: any, ops: any): any {
  if (state === 'loading' || state === 'reading') {
    return vcPageSectionNode(h, t, {
      title: 'vc.sub.listSectionTitle', note: 'vc.sub.listSectionNote',
      children: [h('div', { key: 'loading', className: 'vcs-sub-list', 'data-vc-sub-list': 'loading' }, [vcShellStateNode(h, t, { state: 'loading' })])],
    })
  }
  if (state === 'error') {
    const err: any = (board && board.error) || {}
    return vcPageSectionNode(h, t, {
      title: 'vc.sub.listSectionTitle', note: 'vc.sub.listSectionNote',
      children: [h('div', { key: 'error', className: 'empty-block', 'data-vc-sub-list': 'error' }, [
        h('p', { key: 'title', className: 'empty-title' }, t('vc.sub.errorTitle')),
        h('p', { key: 'hint', className: 'empty-hint' }, t('vc.sub.errorNext', { why: String(err.message || '') })),
        h('button', {
          key: 'retry', type: 'button', className: 'vcs-sub-retry', 'data-vc-sub-action': 'read',
          'data-press': 'button', 'data-log': 'vc.sub.list.retry', disabled: !ops,
          onClick: vcSubCallOf(ops, 'refresh', []),
        }, t('vc.sub.refresh')),
      ])],
    })
  }
  const rows: any[] = vcSubRowsOf(board)
  if (!rows.length) {
    return vcPageSectionNode(h, t, {
      title: 'vc.sub.listSectionTitle', note: 'vc.sub.listSectionNote',
      countText: 'vc.sub.listCount', countVars: { n: 0 },
      children: [h('div', { key: 'empty', className: 'empty-block', 'data-vc-sub-list': 'empty' }, [
        h('p', { key: 'title', className: 'empty-title' }, t('vc.sub.emptyTitle')),
        h('p', { key: 'hint', className: 'empty-hint' }, t('vc.sub.emptyHint')),
        vcSubAddFormNode(h, t, ui, ops, 'empty-form'),
      ])],
    })
  }
  const items: any[] = []
  for (let i = 0; i < rows.length; i += 1) items.push(vcSubRowNode(h, t, rows[i], ui, ops, i))
  return vcPageSectionNode(h, t, {
    title: 'vc.sub.listSectionTitle', note: 'vc.sub.listSectionNote',
    countText: 'vc.sub.listCount', countVars: { n: rows.length },
    children: [
      h('div', { key: 'rows', className: 'vcs-sub-rows', 'data-vc-sub-list': 'rows' }, items),
      vcSubAddFormNode(h, t, ui, ops, 'rows-form'),
      h('p', { key: 'form-hint', className: 'page-note' }, t('vc.sub.form.hint')),
    ],
  })
}

/** 计划预告：吸收前要移动的 .git 目录、新增动作的目标路径；动手前先让人看清要动哪里。 */
function vcSubPlanNode(h: any, t: any, ui: any): any {
  const plan: any = ui.plan || {}
  const moves: any[] = Array.isArray(plan.moves) ? plan.moves : []
  const kids: any[] = [h('p', { key: 'title', className: 'page-card-title' }, t('vc.sub.plan.title'))]
  if (moves.length) {
    for (let i = 0; i < moves.length; i += 1) {
      kids.push(h('p', { key: 'move-' + i, className: 'page-card-sub', 'data-vc-sub-move': String(moves[i].from || '') }, t('vc.sub.plan.move', { from: String(moves[i].from || ''), to: String(moves[i].to || '') })))
    }
  } else if (plan.path) {
    kids.push(h('p', { key: 'target', className: 'page-card-sub', 'data-vc-sub-plan-path': String(plan.path) }, t('vc.sub.plan.target', { path: String(plan.path) })))
  } else {
    kids.push(h('p', { key: 'none', className: 'page-card-sub' }, t('vc.sub.plan.none')))
  }
  return h('div', { key: 'plan', className: 'page-card', 'data-vc-sub-plan': String(plan.action || '') }, kids)
}

/** 确认卡：四段由 vcShellConfirmCardNode 画，这里补取消/确认两个按钮；默认焦点在取消键。 */
function vcSubConfirmNode(h: any, t: any, ui: any, ops: any): any {
  const plan: any = ui.plan || {}
  const verb: string = t('vc.sub.action.' + String(plan.action || ui.op || ''))
  const target: string = String(plan.path || ui.field.path || '')
  return h('div', { key: 'confirm', className: 'page-card', 'data-vc-sub-confirm': '1' }, [
    vcShellConfirmCardNode(h, t, { verb: verb, target: t('vc.sub.confirmTarget', { cmd: String(plan.action || ''), target: target }) }),
    h('div', { key: 'buttons', className: 'page-row-actions' }, [
      h('button', {
        key: 'cancel', type: 'button', className: 'vcs-confirm-cancel', 'data-focus-default': 'cancel',
        'data-vc-sub-cancel': '1', 'data-press': 'button', 'data-log': 'vc.sub.confirm.cancel',
        onClick: vcSubCallOf(ops, 'cancelConfirm', []),
      }, t('vc.sub.confirm.cancel')),
      h('button', {
        key: 'go', type: 'button', className: 'vcs-confirm-go', 'data-vc-sub-go': '1',
        'data-press': 'button', 'data-log': 'vc.sub.confirm.go',
        onClick: vcSubCallOf(ops, 'confirmNow', []),
      }, t('vc.sub.confirm.go', { verb: verb })),
    ]),
  ])
}

/** 被拦：常驻显示理由与下一步；不画确认按钮，避免让人以为再点一次就能过。 */
function vcSubBlockedNode(h: any, t: any, ui: any, ops: any): any {
  const reasons: any[] = Array.isArray(ui.reasons) && ui.reasons.length ? ui.reasons : [ui.error && ui.error.reason]
  const kids: any[] = [h('p', { key: 'title', className: 'page-card-title' }, t('vc.sub.blockedTitle'))]
  for (let i = 0; i < reasons.length; i += 1) {
    const key: string = vcSubmoduleWhyKeyOf(reasons[i])
    kids.push(h('p', { key: 'why-' + i, className: 'page-card-sub', 'data-vc-sub-why': key }, t(key)))
  }
  kids.push(h('p', { key: 'next', className: 'page-card-sub' }, t('vc.sub.blockedNext')))
  kids.push(h('div', { key: 'actions', className: 'page-row-actions' }, [
    h('button', {
      key: 'back', type: 'button', className: 'vcs-sub-retry', 'data-vc-sub-action': 'retry',
      'data-press': 'button', 'data-log': 'vc.sub.blocked.back',
      onClick: vcSubCallOf(ops, 'retry', []),
    }, t('vc.sub.back')),
  ]))
  return h('div', { key: 'blocked', className: 'page-card is-danger', 'data-vc-sub-blocked': '1' }, kids)
}

/** 结果回执：失败贴 git 原话与期望/实际，成功只报 git 子命令名、耗时、对象数。 */
function vcSubResultNode(h: any, t: any, ui: any, ops: any): any {
  if (ui.mode === 'running') {
    return h('div', { key: 'result', className: 'page-card', 'data-vc-sub-result': 'running' }, [vcShellStateNode(h, t, { state: 'loading' })])
  }
  if (ui.mode === 'failed') {
    const err: any = ui.error || {}
    return h('div', { key: 'result', className: 'page-card is-danger', 'data-vc-sub-result': 'failed' }, [
      vcShellResultNode(h, t, { error: String(err.kind || ''), git: String(err.gitText || err.message || ''), message: String(err.message || ''), step: String(err.step || ''), expected: String(err.expected || ''), actual: String(err.actual || ''), cause: String(err.cause || '') }),
      h('div', { key: 'actions', className: 'page-row-actions' }, [
        h('button', {
          key: 'retry', type: 'button', className: 'vcs-sub-retry', 'data-vc-sub-action': 'retry',
          'data-press': 'button', 'data-log': 'vc.sub.result.retry',
          onClick: vcSubCallOf(ops, 'retry', []),
        }, t('vc.sub.retry')),
      ]),
    ])
  }
  if (ui.mode === 'done') {
    const result: any = ui.result || {}
    return h('div', { key: 'result', className: 'page-card', 'data-vc-sub-result': 'done' }, [
      vcShellResultNode(h, t, { cmd: String(result.command || result.op || ''), ms: typeof result.ms === 'number' ? result.ms : null, n: typeof result.n === 'number' ? result.n : null, next: t('vc.sub.result.next') }),
      h('div', { key: 'actions', className: 'page-row-actions' }, [
        h('button', {
          key: 'close', type: 'button', className: 'vcs-sub-retry', 'data-vc-sub-action': 'board',
          'data-press': 'button', 'data-log': 'vc.sub.result.close',
          onClick: vcSubCallOf(ops, 'cancelConfirm', []),
        }, t('vc.sub.result.close')),
      ]),
    ])
  }
  return null
}

/** 从外壳透传的读数里取行：优先用板子规整好的 rows，其次是原始回包；两者都没有就当空清单。 */
function vcSubRowsOf(board: any): any[] {
  if (board && Array.isArray(board.rows)) return board.rows
  if (board && board.board) return vcSubmoduleRowsOf(board.board)
  return []
}

/**
 * 页面根：两段正文 + 当前一态（确认/被拦/结果）。页头由外壳统一画，这里不再画标题行、导语与数量：
 * 数量放进清单段头（vcPageSectionNode 的 count 参数），刷新动作留在清单段里。
 */
export function vcSubmodulesPageNode(h: any, t: any, o: any): any {
  const opts: any = o || {}
  const board: any = opts.board || null
  const ui: any = vcSubmodulesUiOf(opts.ui)
  const ops: any = opts.ops || null
  const state: string = board && board.state ? String(board.state) : vcSubmodulesStateOf(board)
  const stack: any[] = []
  stack.push(vcSubListSectionNode(h, t, state, board, ui, ops))
  if (ui.mode === 'confirm') {
    stack.push(vcSubPlanNode(h, t, ui))
    stack.push(vcSubConfirmNode(h, t, ui, ops))
  }
  if (ui.mode === 'blocked') stack.push(vcSubBlockedNode(h, t, ui, ops))
  if (ui.mode === 'running' || ui.mode === 'failed' || ui.mode === 'done') stack.push(vcSubResultNode(h, t, ui, ops))
  stack.push(vcPageSectionNode(h, t, {
    title: 'vc.sub.batchSectionTitle', note: 'vc.sub.batchSectionNote',
    children: [
      h('div', { key: 'items', className: 'page-card-head' }, vcSubBatchButtonsOf(h, t, ops)),
      h('p', { key: 'foot', className: 'page-note' }, t('vc.sub.batchSectionFoot')),
    ],
  }))
  return h('section', {
    key: 'vc-submodules-page', id: 'vc-submodules-page', className: 'vcs-sub-page', role: 'region',
    'data-vc-sub-page': '1', 'data-vc-sub-mode': String(ui.mode), 'data-vc-sub-state': String(state),
  }, [h('div', { key: 'stack', className: 'page-stack' }, stack)])
}

/** 四个固定批量按钮：data-vc-sub-batch 的值就是菜单号，门禁按这四项核对。 */
function vcSubBatchButtonsOf(h: any, t: any, ops: any): any[] {
  const menu: any[] = vcSubmoduleBatchOf()
  const buttons: any[] = []
  for (let i = 0; i < menu.length; i += 1) {
    const m: any = menu[i]
    buttons.push(h('button', {
      key: 'batch-' + String(m.id), type: 'button', className: 'vcs-sub-batch-item',
      'data-vc-sub-batch': String(m.id), 'data-vc-sub-task-op': String(m.taskOp || ''),
      'data-press': 'button', 'data-log': 'vc.sub.batch.' + String(m.id), disabled: !ops,
      onClick: vcSubBatchGoOf(ops, String(m.id)),
    }, t(String(m.labelKey))))
  }
  return buttons
}
