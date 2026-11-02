/**
 * src/client/views/versionControl/vcStashPage.ts —— 贮藏页（#1751 T16，规格 #1586 域 7 十条）
 *
 * 这个文件只画：十条动作的入口与真实动作、贮藏列表每条的字段、危险动作的确认卡、
 * 「最近丢弃」区、从贮藏建分支的输入行、以及 7.3 的 2.35 版本门提示。数据怎么读、
 * 回包怎么落状态在 vcStashOps.ts；哪条要确认、哪条要版本门在共享层 stash-rules.ts。
 * 挂载点只有页面壳 vcShellPages.ts 里的一小段（#1751 注释包着），别处不碰。
 *
 * 十条的主入口都在这里：7.1–7.3 与 7.4 在工具行；7.5–7.9 在每条记录行上；
 * 7.10 在工具行尾部。入口与动作是同一份登记（STASH_OPS）画出来的，
 * 不会出现「界面写了一条、宿主不认识」的第二套。
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
declare function vcStashFailKeyOf(kind: any): string
// 来自页面壳基础画法 vcShellPrimitives.ts：
declare function vcShellConfirmCardNode(h: any, t: any, o: any): any

/** 真源标识：门禁按这一行找本文件，改路径要一起改门禁。 */
export const VC_STASH_PAGE_SOURCE = 'src/client/views/versionControl/vcStashPage.ts'

/** 工具行上出现的动作（不需要某条记录就能点）：新建三条、列出、清空。 */
const VC_STASH_TOOL_OPS = ['push', 'push-untracked', 'push-staged', 'list', 'clear']

/** 记录行上出现的动作（要先选中某条贮藏）：查看、应用、弹出、建分支、删除。 */
const VC_STASH_ROW_OPS = ['show', 'apply', 'pop', 'branch', 'drop']

const vcStashText = function (t: any, key: string, vars: any): string {
  if (typeof t !== 'function') return key
  return vars ? t(key, vars) : t(key)
}

const vcStashEntrySubjectOf = function (t: any, entry: any): string {
  const text = String((entry && entry.subject) || '').trim()
  return text === '' ? vcStashText(t, 'vc.stash.entry.unknownSubject', null) : text
}

/** 一条记录的字段：选择器、说明、时间、提交号与涉及文件数；查看内容与确认卡都贴在这一条下面。 */
const vcStashRowOf = function (h: any, t: any, entry: any, ctx: any): any {
  const selector = String(entry.selector || '')
  const oid = String(entry.oid || '')
  const when = vcStashWhenOf(entry.atMs)
  const filesKnown = ctx.detail && ctx.detail.selector === selector && Array.isArray(ctx.detail.files)
  const fileNote = filesKnown
    ? vcStashText(t, 'vc.stash.entry.files', { n: String(ctx.detail.fileCount) })
    : vcStashText(t, 'vc.stash.entry.filesUnknown', null)
  // 记录行第一行是「stash@{n} + 说明」，原型 64 的 stash-id-line；说明是主体，选择器是身份。
  const idLine = h('div', { key: 'id', className: 'vcs-stash-id-line', 'data-vc-stash-line': 'summary' }, [
    h('span', { key: 'selector', className: 'vcs-stash-id', 'data-vc-stash-selector': selector }, selector),
    h('strong', { key: 'subject', className: 'vcs-stash-subject', 'data-vc-stash-subject': '1' }, vcStashEntrySubjectOf(t, entry)),
  ])
  // 第二行是元信息：时间 · 文件数 · 提交号；列表读法给不出文件数时照实说。
  const metaLine = h('div', { key: 'meta', className: 'vcs-stash-meta' }, [
    h('span', { key: 'at', 'data-vc-stash-at': '1' }, vcStashText(t, 'vc.stash.entry.at', { when: when })),
    h('span', { key: 'files', 'data-vc-stash-files': '1' }, fileNote),
    h(Tip, { key: 'oid', content: oid }, h('span', { key: 'oid', className: 'vcs-stash-oid', 'data-vc-stash-oid': '1' }, vcStashText(t, 'vc.stash.entry.oid', { oid: vcStashShortOidOf(oid) }))),
  ])
  const actions = VC_STASH_ROW_OPS.map(function (op: string) {
    const def: any = stashOpOf(op)
    if (!def) return null
    if (op === VC_STASH_STAGED_OP && !vcStashOpVisibleOf(op, ctx.versionText)) return null
    const isDanger = def.danger === true
    const props: any = {
      type: 'button',
      key: op,
      className: 'vcs-stash-row-act' + (isDanger ? ' vcs-stash-danger' : ''),
      'data-vc-stash-op': op,
      'data-vc-stash-cap': def.id,
      disabled: ctx.pending === true,
      'data-press': 'button', 'data-log': 'vc.stash.row-op', onClick: function () { ctx.act({ op: op, selector: selector }) },
    }
    if (isDanger) props['data-vc-stash-danger'] = '1'
    return h('button', props, vcStashText(t, def.nameKey, null))
  }).filter(function (node: any) { return !!node })
  const children: any[] = [idLine, metaLine, h('div', { key: 'acts', className: 'vcs-stash-row-acts' }, actions)]
  // 查看内容铺在这一条下面（就近），不再跑到页面底部另开一块。
  const detailNode: any = ctx.detail && ctx.detail.selector === selector ? vcStashDetailBlockOf(h, t, ctx.state, ctx) : null
  if (detailNode) children.push(h('div', { key: 'detail', className: 'vcs-stash-detail-wrap' }, [detailNode]))
  const confirmNode: any = vcStashConfirmBlockOf(h, t, ctx.state, ctx, selector)
  if (confirmNode) children.push(h('div', { key: 'confirm', className: 'vcs-stash-confirm-wrap' }, [confirmNode]))
  if (ctx.branchFor === selector) {
    children.push(
      h('div', { key: 'branch', className: 'vcs-stash-branch', 'data-vc-stash-branch-box': selector }, [
        h('input', {
          key: 'input',
          type: 'text',
          'data-vc-stash-branch-input': '1',
          placeholder: vcStashText(t, 'vc.stash.branch.placeholder', null),
          value: ctx.branchName,
          onInput: function (ev: any) { ctx.edit({ branch: String((ev && ev.target && ev.target.value) || '') }) },
        }),
        h('button', { key: 'go', type: 'button', 'data-vc-stash-branch-go': '1', disabled: ctx.pending === true, 'data-press': 'button', 'data-log': 'vc.stash.branch-go', onClick: function () { ctx.act({ op: 'branch', selector: selector, branch: ctx.branchName }) } }, vcStashText(t, 'vc.stash.branch.go', null)),
        h('button', { key: 'cancel', type: 'button', 'data-vc-stash-branch-cancel': '1', 'data-press': 'button', 'data-log': 'vc.stash.branch-cancel', onClick: function () { ctx.edit({ branchFor: '' }) } }, vcStashText(t, 'vc.stash.branch.cancel', null)),
      ])
    )
  }
  return h('li', { key: selector, className: 'vcs-stash-entry', 'data-vc-stash-entry': selector, 'data-vc-stash-oid-full': oid }, children)
}

/** 工具行：三条贮藏动作、列出、清空；7.3 低于 2.35 时不画按钮，改印替代做法。 */
const vcStashToolbarOf = function (h: any, t: any, ctx: any): any {
  const buttons: any[] = []
  VC_STASH_TOOL_OPS.forEach(function (op: string) {
    const def: any = stashOpOf(op)
    if (!def) return
    if (!vcStashOpVisibleOf(op, ctx.versionText)) return
    const isDanger = def.danger === true
    const props: any = {
      type: 'button',
      key: op,
      className: 'vcs-stash-tool' + (isDanger ? ' vcs-stash-danger' : ''),
      'data-vc-stash-op': op,
      'data-vc-stash-cap': def.id,
      disabled: ctx.pending === true,
      'data-press': 'button', 'data-log': 'vc.stash.tool-op', onClick: function () { ctx.act({ op: op, message: ctx.message, selector: '' }) },
    }
    if (isDanger) props['data-vc-stash-danger'] = '1'
    buttons.push(h('button', props, vcStashText(t, def.nameKey, null)))
  })
  const messageBox = h('label', { key: 'message', className: 'vcs-stash-message' }, [
    h('span', { key: 'label' }, vcStashText(t, 'vc.stash.message.label', null)),
    h('input', {
      key: 'input',
      type: 'text',
      'data-vc-stash-message-input': '1',
      placeholder: vcStashText(t, 'vc.stash.message.placeholder', null),
      value: ctx.message,
      onInput: function (ev: any) { ctx.edit({ message: String((ev && ev.target && ev.target.value) || '') }) },
    }),
  ])
  const staged = vcStashStagedStateOf(ctx.versionText)
  const children: any[] = [messageBox, h('div', { key: 'buttons', className: 'vcs-stash-tools' }, buttons)]
  if (staged.state === 'hidden') {
    children.push(h('p', { key: 'gate', className: 'vcs-stash-gate', 'data-vc-stash-gate': 'hidden' }, [
      h('span', { key: 'need' }, vcStashText(t, 'vc.stash.gate.hidden', { needed: staged.needed })),
      h('span', { key: 'alt', className: 'vcs-stash-gate-alt', 'data-vc-stash-gate-alternative': '1' }, vcStashText(t, staged.alternativeKey, null)),
    ]))
  }
  return children
}

/** 确认卡：危险动作（drop / clear）在触发点就地出，默认焦点在取消键（由确认卡原语保证）。 */
const vcStashConfirmBlockOf = function (h: any, t: any, state: any, ctx: any, wantSelector: any): any {
  if (!state.confirm || !state.confirm.op) return null
  // 有 wantSelector 时只在它指的那一条上画（删除一条）；空串表示「不针对某条记录」（清空全部）。
  if (wantSelector !== undefined && String(state.confirm.selector || '') !== String(wantSelector)) return null
  const def: any = stashOpOf(state.confirm.op)
  const verb = def ? vcStashText(t, def.nameKey, null) : vcStashText(t, STASH_UNKNOWN_OP_KEY, null)
  const target = vcStashConfirmOf(state.confirm.op, { selector: state.confirm.selector, subject: state.confirm.subject })
  const targetText = target
    ? vcStashText(t, 'vc.stash.confirm.target', { selector: target.selector, subject: vcStashEntrySubjectOf(t, { subject: target.subject }) })
    : vcStashText(t, 'vc.stash.confirm.target', { selector: '', subject: '' })
  return h('div', { className: 'vcs-stash-confirm-wrap', 'data-vc-stash-confirm': state.confirm.op }, [
    vcShellConfirmCardNode(h, t, { verb: verb, target: targetText }),
    h('div', { key: 'acts', className: 'vcs-stash-confirm-acts' }, [
      h('button', { key: 'go', type: 'button', className: 'vcs-confirm-go', 'data-vc-stash-confirm-go': '1', disabled: ctx.pending === true, 'data-press': 'button', 'data-log': 'vc.stash.confirm-go', onClick: function () { ctx.actConfirmed() } }, vcStashText(t, 'vc.stash.confirm.go', { verb: verb })),
      h('button', { key: 'cancel', type: 'button', 'data-vc-stash-confirm-cancel': '1', 'data-press': 'button', 'data-log': 'vc.stash.confirm-cancel', onClick: function () { ctx.edit({ confirm: null }) } }, vcStashText(t, 'vc.stash.confirm.cancel', null)),
    ]),
  ])
}

/** 详情：查看内容之后就地铺开涉及的文件与差异（差异截断时如实说）。 */
const vcStashDetailBlockOf = function (h: any, t: any, state: any, ctx: any): any {
  const detail = state.detail
  if (!detail) return null
  const files = Array.isArray(detail.files) ? detail.files : []
  const items = files.map(function (file: string) { return h('li', { key: file, 'data-vc-stash-file': file }, file) })
  return h('section', { className: 'vcs-stash-detail', 'data-vc-stash-detail': detail.selector }, [
    h('p', { key: 'title' }, vcStashText(t, 'vc.stash.detail.title', null) + ' ' + detail.selector + ' · ' + vcStashText(t, 'vc.stash.detail.files', { n: String(detail.fileCount) })),
    h('ul', { key: 'files', 'data-vc-stash-detail-files': '1' }, items),
    h('pre', { key: 'patch', className: 'vcs-stash-patch', 'data-vc-stash-patch': '1' }, detail.patch),
    detail.truncated ? h('p', { key: 'trunc', className: 'vcs-stash-truncated', 'data-vc-stash-truncated': '1' }, vcStashText(t, 'vc.stash.detail.truncated', null)) : null,
    h('button', { key: 'close', type: 'button', 'data-vc-stash-detail-close': '1', 'data-press': 'button', 'data-log': 'vc.stash.detail-close', onClick: function () { ctx.edit({ detail: null }) } }, vcStashText(t, 'vc.stash.detail.close', null)),
  ])
}

/** 最近丢弃：drop / clear 之后把 git 打印的提交号留在这里，回收之前可以恢复。 */
const vcStashRecentBlockOf = function (h: any, t: any, state: any, ctx: any): any {
  const recent = vcStashRecentOf(state)
  const items = recent.map(function (one: any) {
    return h('li', { key: one.oid, 'data-vc-stash-recent-item': one.oid }, [
      h('span', { key: 'subject' }, vcStashEntrySubjectOf(t, one)),
      h('span', { key: 'selector', className: 'vcs-stash-selector' }, one.selector),
      h('span', { key: 'when' }, vcStashText(t, 'vc.stash.recent.droppedAt', { when: vcStashWhenOf(one.droppedAtMs) })),
      h('button', { key: 'restore', type: 'button', 'data-vc-stash-restore': one.oid, disabled: ctx.pending === true, 'data-press': 'button', 'data-log': 'vc.stash.restore', onClick: function () { ctx.act({ op: 'restore', oid: one.oid, subject: one.subject }) } }, vcStashText(t, 'vc.stash.recent.restore', null)),
    ])
  })
  return h('section', { className: 'vcs-stash-recent', 'data-vc-stash-recent': String(recent.length) }, [
    h('h3', { key: 'title' }, vcStashText(t, 'vc.stash.recent.title', null)),
    recent.length === 0
      ? h('p', { key: 'empty', 'data-vc-stash-recent-empty': '1' }, vcStashText(t, 'vc.stash.recent.empty', null))
      : h('div', { key: 'list' }, [h('p', { key: 'note', className: 'vcs-stash-recent-note' }, vcStashText(t, 'vc.stash.recent.note', { n: String(recent.length) })), h('ul', { key: 'ul' }, items)]),
  ])
}

/** 结果条：成功说动作与「列表已刷新」，失败按原因码查人话（错误不吞，也不印裸原因码）。 */
const vcStashResultBlockOf = function (h: any, t: any, state: any): any {
  const result = state.result
  if (!result) return null
  if (result.ok === true) {
    return h('div', { className: 'vcs-stash-result', 'data-vc-stash-result': 'ok', role: 'status' }, [
      vcStashText(t, 'vc.stash.result.ok', { op: vcStashText(t, stashOpNameKeyOf(result.op), null) }),
      ' · ',
      vcStashText(t, 'vc.stash.result.next', null),
    ])
  }
  const key = vcStashFailKeyOf(result.kind)
  const vars: any = {}
  if (result.needed) vars.needed = result.needed
  return h('div', { className: 'vcs-stash-result vcs-stash-result-fail', 'data-vc-stash-result': 'fail', 'data-vc-stash-fail-kind': result.kind, role: 'status' }, vcStashText(t, key, vars))
}

/** 贮藏页根节点：列表、工具行、确认卡、详情、最近丢弃与结果条都在这一块里。 */
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
    versionText: versionText,
    message: String(state.message || ''),
    detail: state.detail,
    pending: pending,
    branchFor: state.branch && state.branch.selector ? String(state.branch.selector) : '',
    branchName: state.branch && state.branch.name ? String(state.branch.name) : '',
    act: act,
    edit: edit,
    actConfirmed: function (): void {
      const payload = vcStashConfirmPayloadOf(state.confirm)
      if (payload && !pending) act(payload)
    },
  }
  const sorted = entries.slice().sort(function (a: any, b: any) { return (Number(b.atMs) || 0) - (Number(a.atMs) || 0) })
  const rows = sorted.map(function (entry: any) { return vcStashRowOf(h, t, entry, ctx) })
  const detailMatched = state.detail ? sorted.some(function (entry: any) { return String(entry.selector || '') === String(state.detail.selector || '') }) : false
  const detailFallbackNode = state.detail && !detailMatched ? vcStashDetailBlockOf(h, t, state, ctx) : null
  const status = state.branch && state.branch.errorKey
    ? h('p', { className: 'vcs-stash-branch-err', 'data-vc-stash-branch-err': state.branch.errorKey }, vcStashText(t, state.branch.errorKey, null))
    : null
  let listNode: any
  if (listState === 'err' || listState === 'load-fail') {
    listNode = h('p', { className: 'vcs-stash-list-err', 'data-vc-stash-list': 'err', role: 'alert' }, vcStashText(t, 'vc.stash.list.err', null))
  } else if (rows.length === 0) {
    listNode = h('p', { className: 'vcs-stash-list-empty', 'data-vc-stash-list': 'empty' }, vcStashText(t, 'vc.stash.list.empty', null))
  } else {
    listNode = h('ul', { className: 'vcs-stash-list', 'data-vc-stash-list': 'ok', 'data-vc-stash-count': String(rows.length) }, rows)
  }
  const boundaryNode = h('p', { key: 'boundary', className: 'vcs-stash-boundary' }, vcStashText(t, 'vc.stash.boundary', null))
  return h('section', {
    className: 'vcs-stash-page',
    'data-vc-stash-page': '1',
    'data-vc-stash-count': String(sorted.length),
    'data-vc-stash-version': versionText,
    'data-vc-stash-pending': pending ? '1' : '0',
  }, [
    h('div', { key: 'head', className: 'vcs-stash-head' }, [
      h('h2', { key: 'title', className: 'vcs-stash-title' }, vcStashText(t, 'vc.stash.title', null)),
      h('span', { key: 'count', className: 'vcs-stash-count', 'data-vc-stash-total': String(sorted.length) }, vcStashText(t, 'vc.stash.count', { n: String(sorted.length) })),
    ]),
    h('p', { key: 'lede', className: 'vcs-stash-lede' }, vcStashText(t, 'vc.stash.lede', null)),
    boundaryNode,
    h('div', { key: 'tools', className: 'vcs-stash-toolbar' }, vcStashToolbarOf(h, t, ctx)),
    // 清空全部才在页面级出确认卡；删除某一条的确认卡贴在那一条下面。
    vcStashConfirmBlockOf(h, t, state, ctx, ''),
    status,
    h('div', { key: 'result' }, [vcStashResultBlockOf(h, t, state)]),
    listNode,
    // 详情正常贴在它那条记录下面；记录刚从列表里消失（被弹出或丢弃）而详情还在状态里时，
    // 兜底把它铺在列表之后，别让人看不到刚查看的内容。
    detailFallbackNode,
    vcStashRecentBlockOf(h, t, state, ctx),
  ])
}
