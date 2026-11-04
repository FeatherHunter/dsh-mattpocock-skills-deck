/**
 * src/client/views/versionControl/vcStashPage.ts —— 贮藏页（#1751 T16，规格 #1586 域 7 十条；#1860 整页还原）
 *
 * 这一层只画：标题与一句话说明、边界说明、记录清单（stash@{n} + 说明、元信息、
 * 应用/弹出/丢弃三颗主按钮，记录下面铺文件清单）、贴行内的确认卡、从贮藏建分支的输入行；
 * 原型里没有的块不画：页头不再有「N 条贮藏」计数条、没有十能力介绍段；新建贮藏三条、
 * 列出、清空与「最近丢弃」都是原型之外但功能要用的入口，收进页底一个默认收起的 details。
 * 数据怎么读、回包怎么落状态在 vcStashOps.ts；哪条要确认、哪条要版本门在共享层 stash-rules.ts。
 *
 * DOM 结构与类名照原型 docs/prototype/vc-redesign/src/ui/views/stash.ts 与
 * src/client/views/versionControl/vcProtoMenus.ts 里的 .stash-* 选择器画：
 *   div.view.view-stash > div.stash-head（h2.stash-title + p.stash-count）→ span.note（边界说明）
 *   → div.stash-scroll（结果条 / 空态 / div.stash-row-wrap > div.stash-row + div.stash-paths
 *   + div.stash-confirm）→ details.stash-more（新建、列出、清空、最近丢弃）。
 *
 * 记录下面常驻文件清单这件事受数据读法限制：列表命令给不出文件，只有「查看内容」
 * 拿到回包后才铺得出来；没看过的那一条照实写一句提示，其余偏差报在 #1860 的偏差表里。
 *
 * 可见文字全部走 t(词条)，词条真源 config/copy/vcstash.yaml；本文件不写可见字面量。
 */

// 跨叶子与共享层的名字由构建拼进同一个闭包，这里只声明形状（类型检查按单文件跑）。
// 来自全局提示叶子 primitives/Tip.ts（构建拼接排在所有视图叶子之前）：
declare const Tip: any
// 来自共享层 stash-rules.ts：
declare function stashOpOf(op: any): any
declare function stashOpNameKeyOf(op: any): string
declare const STASH_UNKNOWN_OP_KEY: string
// 来自同层叶子 vcStashOps.ts（本票新增，登记在页面壳之前）：
declare const VC_STASH_STAGED_OP: string
declare function vcStashStateNew(): any
declare function vcStashEntriesOf(reads: any): any[]
declare function vcStashListStateOf(reads: any): string
declare function vcStashVersionTextOf(reads: any): string
declare function vcStashStagedStateOf(versionText: any): any
declare function vcStashOpVisibleOf(op: any, versionText: any): boolean
declare function vcStashConfirmOf(op: any, entry: any): any
declare function vcStashConfirmPayloadOf(confirm: any): any
declare function vcStashActionPayloadOf(input: any): any
declare function vcStashRecentOf(state: any): any[]
declare function vcStashShortOidOf(oid: any): string
declare function vcStashWhenOf(atMs: any): string
// 来自同层叶子 vcText.ts：一个时刻怎么念（一周以内「3 小时前」，更早写精确时刻）。
declare function vcWhenText(t: any, nowMs: any, ms: any): string
declare function vcStashFailKeyOf(kind: any): string
// 记录下面那块文件清单的四种画法在 vcStashDetail 叶里（#1860 D8：正文贴着行数上限，画法搬出去）：
declare function vcStashPathsBlockOf(h: any, t: any, detail: any, ctx: any): any
declare function vcStashPathsPendingOf(h: any, t: any, detail: any, ctx: any, quietActions: any[]): any
declare function vcStashPathsHintNode(h: any, t: any, quietActions: any[]): any
declare function vcStashDetailFallbackBlockOf(h: any, t: any, detail: any, ctx: any): any
declare function vcStashDetailOf(state: any, selector: any): any

/** 真源标识：门禁按这一行找本文件，改路径要一起改门禁。 */
export const VC_STASH_PAGE_SOURCE = 'src/client/views/versionControl/vcStashPage.ts'

/** 工具行上出现的动作（不需要某条记录就能点）：新建三条、列出、清空。 */
const VC_STASH_TOOL_OPS = ['push', 'push-untracked', 'push-staged', 'list', 'clear']

/** 记录行上出现的动作（要先选中某条贮藏）：查看、应用、弹出、建分支、删除。 */
const VC_STASH_ROW_OPS = ['show', 'apply', 'pop', 'branch', 'drop']

/** 记录行上哪几颗按钮是原型里的主操作（应用/弹出/丢弃），哪几颗是安静的小按钮（查看/建分支）。 */
const VC_STASH_ROW_MAIN_OPS = ['apply', 'pop', 'drop']

const vcStashText = function (t: any, key: string, vars: any): string {
  if (typeof t !== 'function') return key
  return vars ? t(key, vars) : t(key)
}

const vcStashEntrySubjectOf = function (t: any, entry: any): string {
  const text = String((entry && entry.subject) || '').trim()
  return text === '' ? vcStashText(t, 'vc.stash.entry.unknownSubject', null) : text
}

/** 一条记录：原型的三段（id 行 / 元信息 / 三颗主按钮）+ 记录下面的文件清单与安静按钮 + 确认卡。 */
const vcStashRowOf = function (h: any, t: any, entry: any, ctx: any): any {
  const selector = String(entry.selector || '')
  const oid = String(entry.oid || '')
  // 时间印法跟原型一致：一周以内说相对时间（「刚刚」「3 小时前」），更早才写精确时刻。
  //   容器没传当前时刻时（静态渲染、门禁直接调页面叶子）退回精确写法，读数形状不因调用方改变。
  const when = Number(ctx.nowMs) > 0 ? vcWhenText(t, ctx.nowMs, entry.atMs) : vcStashWhenOf(entry.atMs)
  // #1860 D8：详情按选择器存在 state.details 里（一屏前十条自动读），每份带 state：
  //   ok 画文件清单；loading / err 由 vcStashPathsPendingOf 画一句状态话（失败再补重试）；没有才是「点才给」。
  const detail = vcStashDetailOf(ctx.state, selector)
  const detailState = detail ? String(detail.state || 'ok') : ''
  const filesKnown = detailState === 'ok' && Array.isArray(detail.files)
  const fileNote = filesKnown
    ? vcStashText(t, 'vc.stash.entry.files', { n: String(detail.fileCount) })
    : vcStashText(t, 'vc.stash.entry.filesUnknown', null)
  const subject = vcStashEntrySubjectOf(t, entry)
  const idLine = h('div', { key: 'id', className: 'stash-id-line', 'data-vc-stash-line': 'summary' }, [
    h('span', { key: 'selector', className: 'stash-id mono', 'data-vc-stash-selector': selector }, selector),
    h('span', { key: 'subject', className: 'stash-message', 'data-vc-stash-subject': '1', 'aria-label': subject, title: subject }, subject),
  ])
  const metaLine = h('div', { key: 'meta', className: 'stash-meta' }, [
    h('span', { key: 'at', 'data-vc-stash-at': '1' }, vcStashText(t, 'vc.stash.entry.at', { when: when })),
    h('span', { key: 'sep1', className: 'stash-meta-sep' }, vcStashText(t, 'vc.stash.entry.sep', null)),
    h('span', { key: 'files', 'data-vc-stash-files': '1' }, fileNote),
    h('span', { key: 'sep2', className: 'stash-meta-sep' }, vcStashText(t, 'vc.stash.entry.sep', null)),
    h(Tip, { key: 'oid', content: oid }, h('span', { key: 'oid', className: 'stash-oid mono', 'data-vc-stash-oid': '1' }, vcStashText(t, 'vc.stash.entry.oid', { oid: vcStashShortOidOf(oid) }))),
  ])
  const mainButtonOf = function (op: string): any {
    const def: any = stashOpOf(op)
    if (!def) return null
    const isDanger = def.danger === true
    const props: any = {
      key: op, type: 'button',
      className: 'btn btn-sm ' + (isDanger ? 'btn-ghost' : 'btn-secondary'),
      title: vcStashText(t, def.nameKey, null),
      'data-vc-stash-op': op, 'data-vc-stash-cap': def.id,
      disabled: ctx.pending === true,
      'data-press': 'button', 'data-log': 'vc.stash.row-op',
      onClick: function () { ctx.act({ op: op, selector: selector }) },
    }
    if (isDanger) props['data-vc-stash-danger'] = '1'
    return h('button', props, [h('span', { key: 'label', className: 'btn-label' }, vcStashText(t, def.nameKey, null))])
  }
  const mainActions: any[] = []
  VC_STASH_ROW_MAIN_OPS.forEach(function (op: string): void {
    const node: any = mainButtonOf(op)
    if (node) mainActions.push(node)
  })
  const quietActions: any[] = []
  VC_STASH_ROW_OPS.forEach(function (op: string): void {
    if (VC_STASH_ROW_MAIN_OPS.indexOf(op) >= 0) return
    const def: any = stashOpOf(op)
    if (!def) return
    quietActions.push(h('button', {
      key: op, type: 'button', className: 'btn btn-ghost btn-sm',
      title: vcStashText(t, def.nameKey, null),
      'data-vc-stash-op': op, 'data-vc-stash-cap': def.id,
      disabled: ctx.pending === true,
      'data-press': 'button', 'data-log': 'vc.stash.row-op',
      onClick: function () { ctx.act({ op: op, selector: selector }) },
    }, [h('span', { key: 'label', className: 'btn-label' }, vcStashText(t, def.nameKey, null))]))
  })
  const children: any[] = [
    h('div', { key: 'row', className: 'stash-row' }, [
      h('div', { key: 'main', className: 'stash-main' }, [idLine, metaLine]),
      h('div', { key: 'acts', className: 'stash-actions' }, mainActions),
    ]),
    detailState === 'ok'
      ? vcStashPathsBlockOf(h, t, detail, ctx)
      : (detail ? vcStashPathsPendingOf(h, t, detail, ctx, quietActions) : vcStashPathsHintNode(h, t, quietActions)),
  ]
  if (detailState === 'ok') {
    // 读到了之后，安静的查看/建分支按钮接在清单块下面（读的中途与失败时它们已经在状态块里）。
    const tail: any[] = quietActions.slice()
    children.push(h('div', { key: 'quiet', className: 'stash-paths-acts' }, tail))
  }
  const confirmNode: any = vcStashConfirmBlockOf(h, t, ctx.state, ctx, selector)
  if (confirmNode) children.push(confirmNode)
  if (ctx.branchFor === selector) {
    children.push(h('div', { key: 'branch', className: 'stash-branch', 'data-vc-stash-branch-box': selector }, [
      h('input', {
        key: 'input', type: 'text', className: 'stash-branch-input',
        'data-vc-stash-branch-input': '1',
        placeholder: vcStashText(t, 'vc.stash.branch.placeholder', null),
        value: ctx.branchName,
        onInput: function (ev: any) { ctx.edit({ branch: String((ev && ev.target && ev.target.value) || '') }) },
      }),
      h('button', { key: 'go', type: 'button', className: 'btn btn-sm btn-secondary', 'data-vc-stash-branch-go': '1', disabled: ctx.pending === true, 'data-press': 'button', 'data-log': 'vc.stash.branch-go', onClick: function () { ctx.act({ op: 'branch', selector: selector, branch: ctx.branchName }) } }, [h('span', { key: 'label', className: 'btn-label' }, vcStashText(t, 'vc.stash.branch.go', null))]),
      h('button', { key: 'cancel', type: 'button', className: 'btn btn-sm btn-ghost', 'data-vc-stash-branch-cancel': '1', 'data-press': 'button', 'data-log': 'vc.stash.branch-cancel', onClick: function () { ctx.edit({ branchFor: '' }) } }, [h('span', { key: 'label', className: 'btn-label' }, vcStashText(t, 'vc.stash.branch.cancel', null))]),
    ]))
  }
  return h('div', { key: selector, className: 'stash-row-wrap', 'data-vc-stash-entry': selector, 'data-vc-stash-oid-full': oid }, children)
}

/** 工具行（收进页底 details 里）：说明输入、新建三条、列出、清空；7.3 低于 2.35 时不画按钮，改印替代做法。 */
const vcStashToolbarNodesOf = function (h: any, t: any, ctx: any): any[] {
  const buttons: any[] = []
  VC_STASH_TOOL_OPS.forEach(function (op: string) {
    const def: any = stashOpOf(op)
    if (!def) return
    if (!vcStashOpVisibleOf(op, ctx.versionText)) return
    const isDanger = def.danger === true
    const props: any = {
      type: 'button', key: op,
      className: 'btn btn-sm ' + (isDanger ? 'btn-danger' : 'btn-secondary'),
      'data-vc-stash-op': op, 'data-vc-stash-cap': def.id,
      disabled: ctx.pending === true,
      'data-press': 'button', 'data-log': 'vc.stash.tool-op',
      onClick: function () { ctx.act({ op: op, message: ctx.message, selector: '' }) },
    }
    if (isDanger) props['data-vc-stash-danger'] = '1'
    buttons.push(h('button', props, [h('span', { key: 'label', className: 'btn-label' }, vcStashText(t, def.nameKey, null))]))
  })
  const messageBox = h('label', { key: 'message', className: 'stash-message-box' }, [
    h('span', { key: 'label', className: 'stash-message-label' }, vcStashText(t, 'vc.stash.message.label', null)),
    h('input', {
      key: 'input', type: 'text', className: 'stash-message-input',
      'data-vc-stash-message-input': '1',
      placeholder: vcStashText(t, 'vc.stash.message.placeholder', null),
      value: ctx.message,
      onInput: function (ev: any) { ctx.edit({ message: String((ev && ev.target && ev.target.value) || '') }) },
    }),
  ])
  const kids: any[] = [messageBox, h('div', { key: 'buttons', className: 'stash-tools' }, buttons)]
  const staged = vcStashStagedStateOf(ctx.versionText)
  if (staged.state === 'hidden') {
    kids.push(h('p', { key: 'gate', className: 'note note-warn', 'data-vc-stash-gate': 'hidden' }, [
      h('span', { key: 'need' }, vcStashText(t, 'vc.stash.gate.hidden', { needed: staged.needed })),
      h('span', { key: 'alt', className: 'stash-gate-alt', 'data-vc-stash-gate-alternative': '1' }, vcStashText(t, staged.alternativeKey, null)),
    ]))
  }
  return kids
}

/** 确认卡：危险动作（丢弃 / 清空 / 新建）在触发点就地出，四段说清做什么、不做什么、能不能撤销、动作名。 */
const vcStashConfirmBlockOf = function (h: any, t: any, state: any, ctx: any, wantSelector: any): any {
  if (!state.confirm || !state.confirm.op) return null
  // 有 wantSelector 时只在它指的那一条上画（丢弃一条）；空串表示「不针对某条记录」（清空全部、新建）。
  if (wantSelector !== undefined && String(state.confirm.selector || '') !== String(wantSelector)) return null
  const def: any = stashOpOf(state.confirm.op)
  const verb = def ? vcStashText(t, def.nameKey, null) : vcStashText(t, STASH_UNKNOWN_OP_KEY, null)
  const target = vcStashConfirmOf(state.confirm.op, { selector: state.confirm.selector, subject: state.confirm.subject })
  const targetText = target
    ? vcStashText(t, 'vc.stash.confirm.target', { selector: target.selector, subject: vcStashEntrySubjectOf(t, { subject: target.subject }) })
    : vcStashText(t, 'vc.stash.confirm.target', { selector: '', subject: '' })
  const selectorText = String(state.confirm.selector || '')
  const title = state.confirm.op === 'drop'
    ? vcStashText(t, 'vc.stash.confirm.dropTitle', { selector: selectorText })
    : vcStashText(t, 'vc.stash.confirm.title', { verb: verb })
  const segs: string[] = ['what', 'wont', 'reversible', 'verb']
  const segNodes: any[] = segs.map(function (seg: string): any {
    return h('p', { key: 'seg-' + seg, className: 'stash-confirm-body', 'data-vc-confirm-seg': seg }, vcStashText(t, 'vc.shell.confirm.' + seg, { target: targetText }))
  })
  return h('div', {
    key: 'confirm', className: 'stash-confirm is-warn',
    'data-vc-stash-confirm': state.confirm.op, role: 'group', 'aria-label': title,
  }, [
    h('p', { key: 'title', className: 'stash-confirm-title' }, title),
  ].concat(segNodes, [
    h('div', { key: 'acts', className: 'stash-confirm-actions' }, [
      h('button', {
        key: 'cancel', type: 'button', className: 'btn btn-ghost btn-sm',
        'data-vc-stash-confirm-cancel': '1', 'data-focus-default': 'cancel',
        'data-press': 'button', 'data-log': 'vc.stash.confirm-cancel',
        onClick: function () { ctx.edit({ confirm: null }) },
      }, [h('span', { key: 'label', className: 'btn-label' }, vcStashText(t, 'vc.stash.confirm.cancel', null))]),
      h('button', {
        key: 'go', type: 'button', className: 'btn btn-danger btn-sm',
        'data-vc-stash-confirm-go': '1', disabled: ctx.pending === true,
        'data-press': 'button', 'data-log': 'vc.stash.confirm-go',
        onClick: function () { ctx.actConfirmed() },
      }, [h('span', { key: 'label', className: 'btn-label' }, vcStashText(t, 'vc.stash.confirm.go', { verb: verb }))]),
    ]),
  ]))
}

/** 最近丢弃：drop / clear 之后把 git 打印的提交号留在这里，回收之前可以恢复。 */
const vcStashRecentBlockOf = function (h: any, t: any, state: any, ctx: any): any {
  const recent = vcStashRecentOf(state)
  const items = recent.map(function (one: any) {
    return h('li', { key: one.oid, className: 'stash-recent-item', 'data-vc-stash-recent-item': one.oid }, [
      h('span', { key: 'subject', className: 'stash-recent-subject' }, vcStashEntrySubjectOf(t, one)),
      h('span', { key: 'selector', className: 'stash-recent-selector mono' }, one.selector),
      h('span', { key: 'when', className: 'stash-recent-when' }, vcStashText(t, 'vc.stash.recent.droppedAt', { when: vcStashWhenOf(one.droppedAtMs) })),
      h('button', { key: 'restore', type: 'button', className: 'btn btn-ghost btn-sm', 'data-vc-stash-restore': one.oid, disabled: ctx.pending === true, 'data-press': 'button', 'data-log': 'vc.stash.restore', onClick: function () { ctx.act({ op: 'restore', oid: one.oid, subject: one.subject }) } }, [h('span', { key: 'label', className: 'btn-label' }, vcStashText(t, 'vc.stash.recent.restore', null))]),
    ])
  })
  return h('section', { key: 'recent', className: 'stash-recent', 'data-vc-stash-recent': String(recent.length) }, [
    h('h3', { key: 'title', className: 'stash-recent-title' }, vcStashText(t, 'vc.stash.recent.title', null)),
    recent.length === 0
      ? h('p', { key: 'empty', className: 'stash-recent-empty', 'data-vc-stash-recent-empty': '1' }, vcStashText(t, 'vc.stash.recent.empty', null))
      : h('div', { key: 'list' }, [
        h('p', { key: 'note', className: 'stash-recent-note' }, vcStashText(t, 'vc.stash.recent.note', { n: String(recent.length) })),
        h('ul', { key: 'ul', className: 'stash-recent-list' }, items),
      ]),
  ])
}

/** 结果条：成功说动作与「列表已刷新」，失败按原因码查人话（错误不吞，也不印裸原因码）。 */
const vcStashResultBlockOf = function (h: any, t: any, state: any): any {
  const result = state.result
  if (!result) return null
  if (result.ok === true) {
    return h('div', { className: 'result result-ok', 'data-vc-stash-result': 'ok', role: 'status' }, [
      h('span', { key: 'tag', className: 'result-tag' }, vcStashText(t, 'vc.stash.result.tagOk', null)),
      h('span', { key: 'text', className: 'result-text' }, vcStashText(t, 'vc.stash.result.ok', { op: vcStashText(t, stashOpNameKeyOf(result.op), null) })),
      h('span', { key: 'detail', className: 'result-detail' }, vcStashText(t, 'vc.stash.result.next', null)),
    ])
  }
  const key = vcStashFailKeyOf(result.kind)
  const vars: any = {}
  if (result.needed) vars.needed = result.needed
  return h('div', { className: 'result result-error', 'data-vc-stash-result': 'fail', 'data-vc-stash-fail-kind': result.kind, role: 'status' }, [
    h('span', { key: 'tag', className: 'result-tag' }, vcStashText(t, 'vc.stash.result.tagFail', null)),
    h('span', { key: 'text', className: 'result-text' }, vcStashText(t, key, vars)),
  ])
}

/**
 * 贮藏页根节点：原型的三块（标题与说明 / 边界说明 / 记录与确认卡）常驻；
 * 原型没有但功能要用的入口（新建三条、列出、清空、最近丢弃）收进页底 details，默认收起。
 */
export const vcStashPageNode = function (h: any, t: any, opts: any): any {
  const o = opts || {}
  const state = o.state || vcStashStateNew()
  const reads = o.seed || {}
  const entries = state.entries && state.entries.length ? state.entries : vcStashEntriesOf(reads)
  const listState = state.entries && state.entries.length ? 'ok' : vcStashListStateOf(reads)
  const versionText = state.versionText || vcStashVersionTextOf(reads)
  const pending = !!state.pending
  const act = function (input: any): void {
    if (typeof o.onStash === 'function' && !pending) o.onStash(vcStashActionPayloadOf(input))
  }
  const edit = function (patch: any): void {
    if (typeof o.onStashEdit === 'function') o.onStashEdit(patch || {})
  }
  const ctx: any = {
    state: state,
    nowMs: Number(o.nowMs) > 0 ? Number(o.nowMs) : 0,
    versionText: versionText,
    message: String(state.message || ''),
    pending: pending,
    branchFor: state.branch && state.branch.selector ? String(state.branch.selector) : '',
    branchName: state.branch && state.branch.name ? String(state.branch.name) : '',
    act: act,
    edit: edit,
    // 收起某一条的详情：把它从 details 里摘掉，记录行回到「点查看内容才给」那一种（其余记录不受影响）。
    closeDetail: function (selector: any): void { edit({ detailClose: String(selector || '') }) },
    actConfirmed: function (): void {
      const payload = vcStashConfirmPayloadOf(state.confirm)
      if (payload && !pending) act(payload)
    },
  }
  const sorted = entries.slice().sort(function (a: any, b: any) { return (Number(b.atMs) || 0) - (Number(a.atMs) || 0) })
  const rows = sorted.map(function (entry: any) { return vcStashRowOf(h, t, entry, ctx) })
  // 兜底：某些详情对应的记录已经从列表里消失（被丢弃或其余实例动过）时，铺在列表之后，别让人找不到刚看过的内容。
  const details: any = state.details || {}
  const orphans: any[] = Object.keys(details)
    .filter(function (k: string) { return !sorted.some(function (entry: any) { return String(entry.selector || '') === k }) })
    .map(function (k: string) { return details[k] })
    .filter(function (one: any) { return !!one && String(one.state || 'ok') === 'ok' })
  const detailFallbackNode = orphans.length > 0 ? h('div', { key: 'detail-fallback-all' }, orphans.map(function (one: any) { return vcStashDetailFallbackBlockOf(h, t, one, ctx) })) : null
  const branchErr = state.branch && state.branch.errorKey
    ? h('p', { key: 'branch-err', className: 'note note-error', 'data-vc-stash-branch-err': state.branch.errorKey }, vcStashText(t, state.branch.errorKey, null))
    : null
  let listNode: any
  if (listState === 'err' || listState === 'load-fail') {
    listNode = h('p', { key: 'list', className: 'note note-error', 'data-vc-stash-list': 'err', role: 'alert' }, vcStashText(t, 'vc.stash.list.err', null))
  } else if (rows.length === 0) {
    listNode = h('div', { key: 'list', className: 'empty', 'data-vc-stash-list': 'empty' }, [
      h('div', { key: 'title', className: 'empty-title' }, vcStashText(t, 'vc.stash.list.empty', null)),
      h('div', { key: 'hint', className: 'empty-hint' }, vcStashText(t, 'vc.stash.emptyHint', null)),
    ])
  } else {
    listNode = h('div', { key: 'list', className: 'stash-list', 'data-vc-stash-list': 'ok', 'data-vc-stash-count': String(rows.length) }, rows)
  }
  // 工具动作（新建/清空）的确认卡不针对某条记录，挂在滚动区里，点了就能看见。
  const pageConfirm = vcStashConfirmBlockOf(h, t, state, ctx, '')
  const scrollKids: any[] = [
    vcStashResultBlockOf(h, t, state),
    listNode,
    branchErr,
    pageConfirm,
    detailFallbackNode,
  ].filter(function (n: any): boolean { return !!n })
  return h('div', {
    key: 'stash-view', className: 'view view-stash',
    'data-vc-stash-page': '1',
    'data-vc-stash-count': String(sorted.length),
    'data-vc-stash-version': versionText,
    'data-vc-stash-pending': pending ? '1' : '0',
  }, [
    h('div', { key: 'head', className: 'stash-head' }, [
      h('div', { key: 'head-text', className: 'stash-head-text' }, [
        h('h2', { key: 'title', className: 'stash-title' }, vcStashText(t, 'vc.stash.title', null)),
        h('p', { key: 'lede', className: 'stash-count' }, vcStashText(t, 'vc.stash.lede', null)),
      ]),
    ]),
    h('span', { key: 'boundary', className: 'note', 'data-vc-stash-boundary': '1' }, vcStashText(t, 'vc.stash.boundary', null)),
    h('div', { key: 'scroll', className: 'stash-scroll' }, scrollKids),
    // 原型里没有这些入口，但十条能力还都要够得着：收进页底默认收起的 details。
    h('details', { key: 'more', className: 'stash-more', 'data-vc-stash-more': '1' }, [
      h('summary', { key: 'summary', className: 'stash-more-title', 'data-press': 'button', 'data-log': 'vc.stash.more' }, vcStashText(t, 'vc.stash.more.title', null)),
      h('div', { key: 'toolbar', className: 'stash-toolbar' }, vcStashToolbarNodesOf(h, t, ctx)),
      vcStashRecentBlockOf(h, t, state, ctx),
    ]),
  ])
}
