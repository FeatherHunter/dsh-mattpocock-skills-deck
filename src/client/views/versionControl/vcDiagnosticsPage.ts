// views/versionControl/vcDiagnosticsPage.ts —— 诊断页的页面正文（#1761 T25；#1844 按定稿原型 46 重排）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包。
//
// 这一片只画，不判断版本、不拼 git 参数、不自己起电话：
//   1. 每条能力的按钮都带 data-cap-control 指到自己那条能力；13.3 / 13.14 的主入口不在本页，
//      只画一条指回全库搜索、提交历史页的指针，不给按钮；
//   2. 13.13 尾部签名行没有按钮：写入走提交页「追加签名行」，这里只读展示；
//   3. 13.12 只做 apply --check 预演，按钮文字就叫「预演补丁」，绝不真实应用；
//   4. 结果永远画在触发它的那一块里（贴触发点），失败给 git 原话与分类词条。
//
// 分区顺序照定稿原型 46（docs/prototype/vc-redesign/src/ui/views/pages-system.ts 的 renderDiagnostics）：
//   版本与计数 → 只读对象查看 → 检查与定位。
// 原型没有、但本产品必须有的五段排在原型分区之后：替换对象（5.12）→ 应用补丁预演（13.12）→
//   尾部签名（13.13）→ 更多只读查询（13.4 / 13.10）→ 换页去找（13.3 / 13.14）。
// 顺序是验收口径：首屏与原型一致，额外区块只许往后加。
// 11.2–11.4 的真实界面（长任务通道的完整性检查）与 3.5 / 3.9 / 3.11 / 3.13 的查询面板由页面壳当槽位递进来，
//   分别落在「检查与定位」的两条引导行下面；槽位为空就跳过（单测与全页自检不必造那两个组件）。

declare const VC_DIAG_QUERY_ROWS: any[]
declare const VC_DIAG_BISECT_ACTIONS: any[]
declare const VC_DIAG_POINTERS: any[]
declare const VC_DIAG_BISECT_CAP: string
declare const VC_DIAG_PATCH_CAP: string
declare const VC_DIAG_TRAILER_CAP: string
declare const VC_DIAG_REPLACE_CAP: string
declare function vcDiagnosticsStateNew(): any
declare function vcDiagnosticsInputOf(inputs: any, cap: string, key: string): string
declare function vcDiagnosticsShortOidOf(oid: any): string
declare function vcDiagnosticsDangerousOf(op: string): boolean
declare function vcCapabilityOf(capId: any): any
declare function vcShellConfirmCardNode(h: any, t: any, o: any): any
// 页头与骨架原语在同一个构建闭包里（vcPageHead 排在页面壳之前），这里只声明形状，不 import。
declare function vcPageSectionNode(h: any, t: any, o: any): any
declare function vcPageObjRowNode(h: any, t: any, o: any): any
declare function vcPageFactGridNode(h: any, t: any, o: any): any
declare function vcPageCapSummaryNode(h: any, t: any, capId: any, label?: any): any
declare const Tip: any

export const VC_DIAG_PAGE_SOURCE = 'src/client/views/versionControl/vcDiagnosticsPage.ts'

/** 「只读对象查看」这一段画原型 46 上的六条；13.4 / 13.10 与它们同类，但原型没画，放到后面的额外区块。 */
export const VC_DIAG_SHAPE_CAPS: string[] = ['13.5', '13.6', '13.7', '13.8', '13.9', '13.11']
/** 额外区块「更多只读查询」的两条。 */
export const VC_DIAG_MORE_CAPS: string[] = ['13.4', '13.10']

// 能力名与命令原文来自账本（单一真源），页面不重复抄一份。
const vcDiagCapNameOf = function (capId: string): string {
  const cap: any = typeof vcCapabilityOf === 'function' ? vcCapabilityOf(capId) : null
  return cap ? String(cap.name || capId) : capId
}

const vcDiagCall = function (fn: any, args: any[]): any {
  if (typeof fn !== 'function') return null
  return fn.apply(null, args)
}

const vcDiagInputNode = function (h: any, t: any, attrs: any, value: string, placeholderKey: string, onEdit: any, cap: string, key: string): any {
  return h('input', {
    key: 'in-' + key, type: 'text', className: 'vcs-diag-input', value: value,
    placeholder: t(placeholderKey), 'data-vc-diag-input': cap + '.' + key,
    onChange: function (e: any) { vcDiagCall(onEdit, [cap, key, e && e.target ? e.target.value : '']) },
  })
}

const vcDiagButtonNode = function (h: any, t: any, o: any): any {
  const attrs: any = {
    key: String(o.key), type: 'button', className: 'vcs-btn' + (o.danger === true ? ' vcs-btn-danger' : ''),
    'data-vc-diag-op': String(o.op || o.read || ''), 'data-press': 'button',
    'data-log': String(o.logId || ('vc.diag.' + String(o.op || o.read || 'act'))),
    disabled: o.disabled === true,
  }
  if (o.cap) attrs['data-cap-control'] = String(o.cap)
  if (o.read) attrs['data-vc-diag-read-btn'] = String(o.read)
  if (o.danger === true) attrs['data-vc-diag-danger'] = '1'
  attrs.onClick = function () { vcDiagCall(o.handler, o.args || []) }
  const kids: any[] = [h('span', { key: 'label' }, String(o.label || ''))]
  if (o.tip) kids.push(h('span', { key: 'tip', className: 'vcs-diag-tip', 'data-vc-diag-tip': String(o.tip) }, String(o.tip)))
  return h('button', attrs, kids)
}

// 读数与结果：成功列出原始行，失败给分类词条 + git 原话，两者都画在触发它的块里。
const vcDiagResultNode = function (h: any, t: any, result: any): any {
  if (!result) return null
  const fail = result.ok !== true
  const kids: any[] = []
  if (fail) {
    kids.push(h('p', { key: 'title', className: 'vcs-diag-result-title' }, t('vc.diag.result.fail')))
    kids.push(h('p', { key: 'key', className: 'vcs-diag-result-key', 'data-vc-diag-fail-key': String(result.failKey || '') }, t(result.failKey || 'vc.diag.fail.unknown')))
    if (result.git) kids.push(h('code', { key: 'git', className: 'vcs-diag-git', 'data-vc-diag-git': '1' }, String(result.git)))
    if (result.step) kids.push(h('p', { key: 'step', className: 'vcs-diag-step' }, String(result.step)))
    if (result.message) kids.push(h('p', { key: 'msg', className: 'vcs-diag-msg' }, String(result.message)))
  } else {
    kids.push(h('p', { key: 'title', className: 'vcs-diag-result-title' }, t('vc.diag.result.ok')))
    if (result.command) kids.push(h('code', { key: 'cmd', className: 'vcs-diag-cmd' }, String(result.command)))
  }
  return h('div', {
    key: 'result', className: 'vcs-diag-result vcs-diag-result-' + (fail ? 'fail' : 'ok'),
    'data-vc-diag-result': fail ? 'fail' : 'ok', role: fail ? 'alert' : 'status',
  }, kids)
}

const vcDiagRowsNode = function (h: any, t: any, cap: string, read: any): any {
  const attrs: any = { key: 'read-' + cap, className: 'vcs-diag-read', 'data-vc-diag-read': cap }
  if (!read) return h('div', attrs, [h('span', { key: 'none', className: 'vcs-diag-read-none' }, t('vc.diag.read.empty'))])
  const rows: any[] = Array.isArray(read.rows) ? read.rows : []
  const kids: any[] = []
  if (rows.length === 0) kids.push(h('span', { key: 'none', className: 'vcs-diag-read-none' }, t('vc.diag.read.empty')))
  for (let i = 0; i < rows.length; i += 1) kids.push(h('code', { key: 'r' + i, className: 'vcs-diag-read-row' }, String(rows[i])))
  return h('div', attrs, kids)
}

const vcDiagConfirmNode = function (h: any, t: any, confirm: any, onConfirm: any, onCancel: any): any {
  const card = vcShellConfirmCardNode(h, t, { verb: String(confirm.verb || ''), target: String(confirm.target || '') })
  const kids: any[] = [Object.assign({}, card, { key: 'card' })]
  kids.push(h('div', { key: 'acts', className: 'vcs-diag-confirm-acts' }, [
    h('button', { key: 'cancel', type: 'button', className: 'vcs-btn', 'data-vc-diag-confirm-cancel': '1', 'data-press': 'button', 'data-log': 'vc.diag.confirm.cancel', onClick: function () { vcDiagCall(onCancel, []) } }, t('vc.diag.confirm.cancel')),
    h('button', { key: 'go', type: 'button', className: 'vcs-btn vcs-btn-danger', 'data-vc-diag-confirm-go': '1', 'data-press': 'button', 'data-log': 'vc.diag.confirm.go', onClick: function () { vcDiagCall(onConfirm, []) } }, t('vc.diag.confirm.go')),
  ]))
  return h('div', { key: 'confirm', className: 'vcs-diag-confirm', 'data-vc-diag-confirm': String(confirm.op || '') }, kids)
}

// 引导行：一条能力 + 一句说明，没有按钮（真正的执行界面由槽位提供，见「检查与定位」段）。
const vcDiagGuideRow = function (h: any, t: any, capId: string, subKey: string): any {
  return vcPageObjRowNode(h, t, {
    main: [vcPageCapSummaryNode(h, t, capId), h('span', { key: 'sub', className: 'obj-sub' }, t(subKey))],
    side: null,
  })
}

/**
 * 版本与计数七格：全部来自宿主 wf.gitStatus 的回包（reads.screen.data），取不到就写「读不到」并弱化，
// 绝不把读不到画成 0——「0 个引用」和「没读到引用」是两件事，读者会据此误判仓库状态。
 * 引用总数在这个读数协议里没有对应字段（只有本地分支表），所以那一位永远写「读不到」，本地分支数照常给。
 */
const vcDiagFactsOf = function (t: any, reads: any): any[] {
  const unreadable: string = t('vc.diag.facts.unreadable')
  const pack: any = reads && reads.screen && reads.screen.data ? reads.screen.data : null
  const screen: any = pack && pack.screen ? pack.screen : null
  const identity: any = screen && screen.identity ? screen.identity : null
  const gitVersion: string = pack && typeof pack.gitVersion === 'string' ? String(pack.gitVersion) : ''
  const oid: string = identity && typeof identity.oid === 'string' ? String(identity.oid) : ''
  const branch: string = identity && typeof identity.branch === 'string' ? String(identity.branch) : ''
  const worktreePath: string = identity && typeof identity.worktreePath === 'string' ? String(identity.worktreePath) : ''
  const branches: any[] | null = screen && Array.isArray(screen.branches) ? screen.branches : null
  const others: any[] | null = screen && Array.isArray(screen.otherWorktrees) ? screen.otherWorktrees : null
  const staged: number | null = screen && typeof screen.stagedCount === 'number' ? screen.stagedCount : null
  const unstaged: number | null = screen && typeof screen.unstagedCount === 'number' ? screen.unstagedCount : null
  const headText: string = oid === '' ? unreadable : (branch !== '' ? t('vc.diag.facts.headValue', { oid: oid.length > 7 ? oid.slice(0, 7) : oid, branch: branch }) : oid.slice(0, 7))
  const toneOf = function (text: string): any { return text === unreadable ? 'muted' : null }
  const refsText: string = branches === null ? unreadable : t('vc.diag.facts.refsValue', { total: unreadable, local: String(branches.length) })
  const worktreesText: string = others === null ? unreadable : t('vc.diag.facts.worktreesValue', { n: String(others.length + 1) })
  const statusText: string = staged === null || unstaged === null ? unreadable : t('vc.diag.facts.statusValue', { n: String(staged + unstaged) })
  return [
    { key: 'vc.diag.facts.gitVersion', value: gitVersion !== '' ? gitVersion : unreadable, mono: true, tone: toneOf(gitVersion !== '' ? gitVersion : unreadable) },
    { key: 'vc.diag.facts.describe', value: unreadable, tone: 'muted' },
    { key: 'vc.diag.facts.head', value: headText, mono: true, tone: toneOf(headText) },
    { key: 'vc.diag.facts.refs', value: refsText, tone: toneOf(refsText) },
    { key: 'vc.diag.facts.worktrees', value: worktreesText, tone: toneOf(worktreesText) },
    { key: 'vc.diag.facts.statusLines', value: statusText, tone: toneOf(statusText) },
    { key: 'vc.diag.facts.repoRoot', value: worktreePath !== '' ? worktreePath : unreadable, mono: true, tone: toneOf(worktreePath === '' ? unreadable : worktreePath) },
  ]
}

/**
 * 一条只读查询（原型 46「只读对象查看」的一行）：左侧能力摘要 + 输入格子，右侧查询按钮；
 * 结果与读数都贴在这一行里。输入格子的键与服务端参数名一致，界面不自己再翻译一遍。
 */
const vcDiagRowNode = function (h: any, t: any, o: any, row: any) {
  const state = o.state
  const cap: string = String(row.cap)
  const inputs = state.inputs || {}
  const reads = state.reads || {}
  const results = state.results || {}
  const fields: any[] = []
  for (let f = 0; f < row.fields.length; f += 1) {
    const key: string = row.fields[f]
    if (key === 'mode') {
      const value: string = vcDiagnosticsInputOf(inputs, cap, key)
      fields.push(h('select', {
        key: 'in-' + key, className: 'vcs-diag-input', value: value === '' ? 'pretty' : value,
        'data-vc-diag-input': cap + '.' + key,
        onChange: function (e: any) { vcDiagCall(o.onEdit, [cap, key, e && e.target ? e.target.value : '']) },
      }, (cap === '13.11' ? [
        h('option', { key: 'count', value: 'count' }, t('vc.diag.field.modeCount')),
        h('option', { key: 'left-right', value: 'left-right' }, t('vc.diag.field.modeLeftRight')),
      ] : [
        h('option', { key: 'pretty', value: 'pretty' }, t('vc.diag.field.modePretty')),
        h('option', { key: 'type', value: 'type' }, t('vc.diag.field.modeType')),
      ])))
    } else {
      fields.push(vcDiagInputNode(h, t, {}, vcDiagnosticsInputOf(inputs, cap, key), 'vc.diag.field.' + key, o.onEdit, cap, key))
    }
  }
  const main: any[] = [vcPageCapSummaryNode(h, t, cap)]
  if (fields.length > 0) main.push(h('div', { key: 'fields', className: 'vcs-diag-fields' }, fields))
  const result = results[cap]
  if (result) main.push(vcDiagResultNode(h, t, result))
  main.push(vcDiagRowsNode(h, t, cap, reads[cap] || null))
  return h('div', { key: cap, className: 'vcs-diag-row', 'data-vc-diag-row': cap }, [
    vcPageObjRowNode(h, t, {
      main: main,
      side: [vcDiagButtonNode(h, t, {
        key: 'go', read: cap, cap: cap, logId: 'vc.diag.read.' + cap, label: t('vc.diag.read.query'), disabled: state.running !== '',
        args: [], handler: function () { vcDiagCall(o.onRead, [cap]) },
      })],
    }),
  ])
}

/** 只读查询段：按能力编号挑行（13.4 / 13.10 与 13.5–13.11 各成一段，共用这一份画法）。 */
const vcDiagRowsBlock = function (h: any, t: any, o: any, caps: string[]) {
  const rows: any[] = []
  for (let i = 0; i < VC_DIAG_QUERY_ROWS.length; i += 1) {
    const row: any = VC_DIAG_QUERY_ROWS[i]
    if (caps.indexOf(String(row.cap)) >= 0) rows.push(vcDiagRowNode(h, t, o, row))
  }
  return h('div', { key: 'read', className: 'vcs-diag-block', 'data-vc-diag-block': 'read' }, rows)
}

const vcDiagBisectBlock = function (h: any, t: any, o: any): any {
  const state = o.state
  const inputs = state.inputs || {}
  const results = state.results || {}
  const read = (state.reads || {})[VC_DIAG_BISECT_CAP] || null
  const bisectRows: any = read && Array.isArray(read.rows) ? read.rows : null
  const inactive: boolean = !!(bisectRows && bisectRows.length === 1 && bisectRows[0] === '0')
  const fields: any[] = [
    vcDiagInputNode(h, t, {}, vcDiagnosticsInputOf(inputs, '13.1', 'bad'), 'vc.diag.field.bad', o.onEdit, '13.1', 'bad'),
    vcDiagInputNode(h, t, {}, vcDiagnosticsInputOf(inputs, '13.1', 'good'), 'vc.diag.field.good', o.onEdit, '13.1', 'good'),
  ]
  const acts: any[] = []
  for (let i = 0; i < VC_DIAG_BISECT_ACTIONS.length; i += 1) {
    const a: any = VC_DIAG_BISECT_ACTIONS[i]
    acts.push(vcDiagButtonNode(h, t, {
      key: a.op, op: a.op, cap: '13.1', logId: 'vc.diag.bisect.' + a.op, danger: vcDiagnosticsDangerousOf(a.op),
      label: t('vc.diag.bisect.' + a.key), disabled: state.running !== '',
      args: [a.op, { bad: vcDiagnosticsInputOf(inputs, '13.1', 'bad'), good: vcDiagnosticsInputOf(inputs, '13.1', 'good') }],
      handler: o.onWrite,
    }))
  }
  acts.push(vcDiagButtonNode(h, t, { key: 'refresh', read: VC_DIAG_BISECT_CAP, logId: 'vc.diag.bisect.refresh', label: t('vc.diag.bisect.refresh'), disabled: state.running !== '', args: [], handler: function () { vcDiagCall(o.onRead, [VC_DIAG_BISECT_CAP]) } }))
  const kids: any[] = [
    h('p', { key: 'range', className: 'page-note' }, t('vc.diag.bisect.range')),
    inactive ? h('p', { key: 'inactive', className: 'vcs-diag-read', 'data-vc-diag-read': VC_DIAG_BISECT_CAP, 'data-vc-diag-bisect-inactive': '1' }, t('vc.diag.bisect.inactive')) : vcDiagRowsNode(h, t, VC_DIAG_BISECT_CAP, read),
    h('div', { key: 'fields', className: 'vcs-diag-fields' }, fields),
    h('div', { key: 'acts', className: 'vcs-diag-acts' }, acts),
  ]
  const confirm = state.confirm
  if (confirm && confirm.cap === '13.1') kids.push(vcDiagConfirmNode(h, t, confirm, o.onConfirm, o.onCancel))
  const result = results['13.1']
  if (result) kids.push(vcDiagResultNode(h, t, result))
  return h('div', { key: 'bisect', className: 'vcs-diag-block', 'data-vc-diag-block': 'bisect' }, [
    vcPageObjRowNode(h, t, { main: [vcPageCapSummaryNode(h, t, '13.1'), h('span', { key: 'sub', className: 'obj-sub' }, t('vc.diag.checks.bisect.sub'))], side: null }),
  ].concat(kids))
}

const vcDiagPatchBlock = function (h: any, t: any, o: any): any {
  const state = o.state
  const inputs = state.inputs || {}
  const results = state.results || {}
  const kids: any[] = [
    h('p', { key: 'note', className: 'page-note' }, t('vc.diag.patch.note')),
    h('textarea', {
      key: 'patch', rows: 6, className: 'vcs-diag-patch', value: vcDiagnosticsInputOf(inputs, VC_DIAG_PATCH_CAP, 'patch'),
      placeholder: t('vc.diag.patch.placeholder'), 'data-vc-diag-input': VC_DIAG_PATCH_CAP + '.patch',
      onChange: function (e: any) { vcDiagCall(o.onEdit, [VC_DIAG_PATCH_CAP, 'patch', e && e.target ? e.target.value : '']) },
    }),
    h('div', { key: 'acts', className: 'vcs-diag-acts' }, [
      vcDiagButtonNode(h, t, {
        key: 'preview', read: VC_DIAG_PATCH_CAP, cap: VC_DIAG_PATCH_CAP, logId: 'vc.diag.patch.preview', label: t('vc.diag.patch.preview'), disabled: state.running !== '',
        args: [], handler: function () { vcDiagCall(o.onRead, [VC_DIAG_PATCH_CAP]) },
      }),
    ]),
  ]
  const result = results[VC_DIAG_PATCH_CAP]
  if (result) kids.push(vcDiagResultNode(h, t, result))
  return h('div', { key: 'patch', className: 'vcs-diag-block', 'data-vc-diag-block': 'patch' }, kids)
}

// 13.13：没有按钮。显示上一条提交的尾部签名行（有读数时），否则说明写入路径在提交页。
const vcDiagTrailerBlock = function (h: any, t: any, o: any): any {
  const state = o.state
  const read = (state.reads || {})[VC_DIAG_TRAILER_CAP] || null
  return h('div', { key: 'trailer', className: 'vcs-diag-block', 'data-vc-diag-block': 'trailer', 'data-vc-diag-readonly': VC_DIAG_TRAILER_CAP }, [
    h('p', { key: 'note', className: 'page-note', 'data-vc-diag-trailer-note': '1' }, t('vc.diag.trailer.note')),
    vcDiagRowsNode(h, t, VC_DIAG_TRAILER_CAP, read),
  ])
}

const vcDiagReplaceBlock = function (h: any, t: any, o: any): any {
  const state = o.state
  const inputs = state.inputs || {}
  const read = (state.reads || {})[VC_DIAG_REPLACE_CAP] || null
  const results = state.results || {}
  const kids: any[] = [
    h('p', { key: 'note', className: 'page-note' }, t('vc.diag.replace.note')),
    h('div', { key: 'fields', className: 'vcs-diag-fields' }, [
      vcDiagInputNode(h, t, {}, vcDiagnosticsInputOf(inputs, VC_DIAG_REPLACE_CAP, 'from'), 'vc.diag.field.from', o.onEdit, VC_DIAG_REPLACE_CAP, 'from'),
      vcDiagInputNode(h, t, {}, vcDiagnosticsInputOf(inputs, VC_DIAG_REPLACE_CAP, 'to'), 'vc.diag.field.to', o.onEdit, VC_DIAG_REPLACE_CAP, 'to'),
    ]),
    h('div', { key: 'acts', className: 'vcs-diag-acts' }, [
      vcDiagButtonNode(h, t, {
        key: 'create', op: 'replace-create', cap: VC_DIAG_REPLACE_CAP, logId: 'vc.diag.replace.create', label: t('vc.diag.replace.create'), danger: true,
        disabled: state.running !== '', args: ['replace-create', { from: vcDiagnosticsInputOf(inputs, VC_DIAG_REPLACE_CAP, 'from'), to: vcDiagnosticsInputOf(inputs, VC_DIAG_REPLACE_CAP, 'to') }],
        handler: o.onWrite,
      }),
      vcDiagButtonNode(h, t, { key: 'refresh', read: VC_DIAG_REPLACE_CAP, logId: 'vc.diag.replace.refresh', label: t('vc.diag.replace.refresh'), disabled: state.running !== '', args: [], handler: function () { vcDiagCall(o.onRead, [VC_DIAG_REPLACE_CAP]) } }),
    ]),
    vcDiagRowsNode(h, t, VC_DIAG_REPLACE_CAP, read),
  ]
  const rows: any[] = read && Array.isArray(read.rows) ? read.rows : []
  const undos: any[] = []
  for (let i = 0; i < rows.length; i += 1) {
    const object: string = String(rows[i])
    undos.push(h('div', { key: 'undo-' + i, className: 'vcs-diag-undo', 'data-vc-diag-undo': object }, [
      h('code', { key: 'oid', className: 'vcs-diag-oid' }, vcDiagnosticsShortOidOf(object)),
      vcDiagButtonNode(h, t, {
        key: 'del', op: 'replace-delete', cap: VC_DIAG_REPLACE_CAP, logId: 'vc.diag.replace.undo', label: t('vc.diag.replace.undo'), danger: true,
        disabled: state.running !== '', args: ['replace-delete', { object: object }], handler: o.onWrite,
      }),
    ]))
  }
  if (undos.length > 0) kids.push(h('div', { key: 'undos', className: 'vcs-diag-undos' }, undos))
  const confirm = state.confirm
  if (confirm && confirm.cap === VC_DIAG_REPLACE_CAP) kids.push(vcDiagConfirmNode(h, t, confirm, o.onConfirm, o.onCancel))
  const result = results[VC_DIAG_REPLACE_CAP]
  if (result) kids.push(vcDiagResultNode(h, t, result))
  return h('div', { key: 'replace', className: 'vcs-diag-block', 'data-vc-diag-block': 'replace' }, kids)
}

const vcDiagPointerBlock = function (h: any, t: any): any {
  const kids: any[] = []
  for (let i = 0; i < VC_DIAG_POINTERS.length; i += 1) {
    const p: any = VC_DIAG_POINTERS[i]
    const cap: string = String(p.cap)
    const textKey: string = cap === '13.3' ? 'vc.diag.pointer.search' : 'vc.diag.pointer.commits'
    kids.push(h('p', {
      key: cap, className: 'vcs-diag-pointer page-note', 'data-vc-diag-pointer': cap, 'data-vc-diag-pointer-page': String(p.page || ''),
    }, cap + ' ' + vcDiagCapNameOf(cap) + '：' + t(textKey)))
  }
  return h('div', { key: 'pointer', className: 'vcs-diag-block', 'data-vc-diag-block': 'pointer' }, kids)
}

// 页面壳的挂载判定也放这一片：壳只问一句「这一页现在画不画」，判定与真正文挨在一起，壳不多一行规则。
// 壳把两个槽位（查询面板 + 完整性检查界面）放在 opts.diagnosticsSlots 里递进来，这里原样转给页面。
export const vcDiagnosticsMountNode = function (h: any, t: any, opts: any): any {
  const o = opts || {}
  if (String(o.page || '') !== 'diagnostics') return null
  return vcDiagnosticsPageNode(h, t, {
    reads: o.reads || null, state: o.diagnostics || null,
    slots: o.diagnosticsSlots || null,
    onRead: o.onDiagnosticsRead, onWrite: o.onDiagnosticsWrite, onEdit: o.onDiagnosticsEdit,
    onConfirm: o.onDiagnosticsConfirm, onCancel: o.onDiagnosticsCancel,
  })
}

/** 一段：标题、条数与说明都交 vcPageSectionNode 画；这一段没有条数就不传 countText。 */
const vcDiagSection = function (h: any, t: any, key: string, title: string, countKey: string, noteKey: string, kids: any[]) {
  const spec: any = { sectionKey: key, title: title, note: noteKey, children: kids }
  if (countKey !== '') spec.countText = countKey
  return vcPageSectionNode(h, t, spec)
}

export const vcDiagnosticsPageNode = function (h: any, t: any, o: any): any {
  const opts: any = o || {}
  const state: any = opts.state || vcDiagnosticsStateNew()
  const slots: any = opts.slots || null
  const blockOpts: any = Object.assign({}, opts, { state: state })
  const checksKids: any[] = [
    vcDiagGuideRow(h, t, '11.2', 'vc.diag.checks.fsck.sub'),
    slots && slots.maintenance ? h('div', { key: 'fsck', className: 'vcs-diag-embed' }, slots.maintenance) : null,
    vcDiagBisectBlock(h, t, blockOpts),
    vcDiagGuideRow(h, t, '3.11', 'vc.diag.checks.log.sub'),
    slots && slots.query ? h('div', { key: 'queries', className: 'vcs-diag-embed' }, slots.query) : null,
  ]
  const kids: any[] = [
    vcDiagSection(h, t, 'facts', 'vc.diag.section.facts.title', '', 'vc.diag.section.facts.note', [vcPageFactGridNode(h, t, { facts: vcDiagFactsOf(t, opts.reads) })]),
    vcDiagSection(h, t, 'shapes', 'vc.diag.section.shapes.title', 'vc.diag.section.shapes.count', 'vc.diag.section.shapes.note', [
      vcDiagRowsBlock(h, t, blockOpts, VC_DIAG_SHAPE_CAPS),
      // 旧版由页面壳画在页头之前的只读口径说明：按原型把页头放回第一屏后挪进这一段，记号 data-vc-note 不变。
      h('p', { key: 'ro', className: 'page-note', 'data-vc-note': 'diagnostics-readonly' }, t('vc.shell.diagnostics.note')),
    ]),
    vcDiagSection(h, t, 'checks', 'vc.diag.section.checks.title', 'vc.diag.section.checks.count', 'vc.diag.section.checks.note', checksKids),
    vcDiagSection(h, t, 'replace', 'vc.diag.section.replace.title', 'vc.diag.section.replace.count', 'vc.diag.section.replace.note', [vcDiagReplaceBlock(h, t, blockOpts)]),
    vcDiagSection(h, t, 'patch', 'vc.diag.section.patch.title', 'vc.diag.section.patch.count', 'vc.diag.section.patch.note', [vcDiagPatchBlock(h, t, blockOpts)]),
    vcDiagSection(h, t, 'trailer', 'vc.diag.section.trailer.title', 'vc.diag.section.trailer.count', 'vc.diag.section.trailer.note', [vcDiagTrailerBlock(h, t, blockOpts)]),
    vcDiagSection(h, t, 'more', 'vc.diag.section.more.title', 'vc.diag.section.more.count', 'vc.diag.section.more.note', [vcDiagRowsBlock(h, t, blockOpts, VC_DIAG_MORE_CAPS)]),
    // 指针段不画条数：13.3 / 13.14 的主入口在别的页面，写「2 条能力」会让人以为这一页能操作它们。
    vcDiagSection(h, t, 'pointer', 'vc.diag.section.pointer.title', '', 'vc.diag.section.pointer.note', [vcDiagPointerBlock(h, t)]),
  ]
  if (state.running) kids.push(h('p', { key: 'running', className: 'vcs-diag-running', 'data-vc-diag-running': '1', role: 'status' }, t('vc.diag.result.running')))
  // 根节点只留 data-vc-diag-panel：data-vc-page 是页面壳根节点的记号，页面正文再挂一枚会让
  //   「渲染了哪些页」的门禁把同一页数两遍（#1844 全页渲染实测 16 页数成 17 页）。
  return h('section', {
    className: 'vcs-diag-panel page-stack', 'data-vc-diag-panel': '1',
    'aria-label': t('vc.diag.title'),
  }, kids)
}
