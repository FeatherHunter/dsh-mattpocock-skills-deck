// views/versionControl/vcDiagnosticsPage.ts —— 诊断页的页面正文（#1761 T25，规格 #1586 域 13 + 5.12）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包。
//
// 这一片只画，不判断版本、不拼 git 参数、不自己起电话：
//   1. 每条能力的按钮都带 data-cap-control 指到自己那条能力；13.3 / 13.14 的主入口不在本页，
//      只画一条指回全库搜索、提交历史页的指针，不给按钮；
//   2. 13.13 尾部签名行没有按钮：写入走提交页「追加签名行」，这里只读展示；
//   3. 13.12 只做 apply --check 预演，按钮文字就叫「预演补丁」，绝不真实应用；
//   4. 结果永远画在触发它的那一块里（贴触发点），失败给 git 原话与分类词条。

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
declare const Tip: any

export const VC_DIAG_PAGE_SOURCE = 'src/client/views/versionControl/vcDiagnosticsPage.ts'

const vcDiagLabelOf = function (t: any, key: string): string {
  return t(key)
}

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
  const handler = o.handler
  attrs.onClick = function () { vcDiagCall(handler, o.args || []) }
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

const vcDiagBisectBlock = function (h: any, t: any, o: any): any {
  const state = o.state
  const inputs = state.inputs || {}
  const results = state.results || {}
  const read = (state.reads || {})[VC_DIAG_BISECT_CAP] || null
  const kids: any[] = [h('h3', { key: 'title', className: 'vcs-diag-title' }, t('vc.diag.section.bisect'))]
  kids.push(h('p', { key: 'range', className: 'vcs-diag-range' }, t('vc.diag.bisect.range')))
  const bisectRows: any = read && Array.isArray(read.rows) ? read.rows : null
  const inactive: boolean = !!(bisectRows && bisectRows.length === 1 && bisectRows[0] === '0')
  kids.push(inactive ? h('p', { key: 'inactive', className: 'vcs-diag-read', 'data-vc-diag-read': VC_DIAG_BISECT_CAP, 'data-vc-diag-bisect-inactive': '1' }, t('vc.diag.bisect.inactive')) : vcDiagRowsNode(h, t, VC_DIAG_BISECT_CAP, read))
  const fields: any[] = [
    vcDiagInputNode(h, t, {}, vcDiagnosticsInputOf(inputs, '13.1', 'bad'), 'vc.diag.field.bad', o.onEdit, '13.1', 'bad'),
    vcDiagInputNode(h, t, {}, vcDiagnosticsInputOf(inputs, '13.1', 'good'), 'vc.diag.field.good', o.onEdit, '13.1', 'good'),
  ]
  kids.push(h('div', { key: 'fields', className: 'vcs-diag-fields' }, fields))
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
  kids.push(h('div', { key: 'acts', className: 'vcs-diag-acts' }, acts))
  const confirm = state.confirm
  if (confirm && confirm.cap === '13.1') kids.push(vcDiagConfirmNode(h, t, confirm, o.onConfirm, o.onCancel))
  const result = results['13.1']
  if (result) kids.push(vcDiagResultNode(h, t, result))
  return h('section', { key: 'bisect', className: 'vcs-diag-block', 'data-vc-diag-block': 'bisect' }, kids)
}

const vcDiagReadBlock = function (h: any, t: any, o: any): any {
  const state = o.state
  const inputs = state.inputs || {}
  const reads = state.reads || {}
  const results = state.results || {}
  const kids: any[] = [h('h3', { key: 'title', className: 'vcs-diag-title' }, t('vc.diag.section.read'))]
  for (let i = 0; i < VC_DIAG_QUERY_ROWS.length; i += 1) {
    const row: any = VC_DIAG_QUERY_ROWS[i]
    const cap: string = String(row.cap)
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
    const line: any[] = [h('span', { key: 'name', className: 'vcs-diag-cap-name' }, cap + ' ' + vcDiagCapNameOf(cap))]
    line.push(h('div', { key: 'fields', className: 'vcs-diag-fields' }, fields))
    line.push(vcDiagButtonNode(h, t, {
      key: 'go', read: cap, cap: cap, logId: 'vc.diag.read.' + cap, label: t('vc.diag.read.query'), disabled: state.running !== '',
      args: [], handler: function () { vcDiagCall(o.onRead, [cap]) },
    }))
    const result = results[cap]
    if (result) line.push(vcDiagResultNode(h, t, result))
    line.push(vcDiagRowsNode(h, t, cap, reads[cap] || null))
    kids.push(h('div', { key: cap, className: 'vcs-diag-row', 'data-vc-diag-row': cap }, line))
  }
  return h('section', { key: 'read', className: 'vcs-diag-block', 'data-vc-diag-block': 'read' }, kids)
}

const vcDiagPatchBlock = function (h: any, t: any, o: any): any {
  const state = o.state
  const inputs = state.inputs || {}
  const results = state.results || {}
  const kids: any[] = [h('h3', { key: 'title', className: 'vcs-diag-title' }, t('vc.diag.section.patch'))]
  kids.push(h('p', { key: 'note', className: 'vcs-diag-note' }, t('vc.diag.patch.note')))
  kids.push(h('textarea', {
    key: 'patch', rows: 6, className: 'vcs-diag-patch', value: vcDiagnosticsInputOf(inputs, VC_DIAG_PATCH_CAP, 'patch'),
    placeholder: t('vc.diag.patch.placeholder'), 'data-vc-diag-input': VC_DIAG_PATCH_CAP + '.patch',
    onChange: function (e: any) { vcDiagCall(o.onEdit, [VC_DIAG_PATCH_CAP, 'patch', e && e.target ? e.target.value : '']) },
  }))
  kids.push(h('div', { key: 'acts', className: 'vcs-diag-acts' }, [
    vcDiagButtonNode(h, t, {
      key: 'preview', read: VC_DIAG_PATCH_CAP, cap: VC_DIAG_PATCH_CAP, logId: 'vc.diag.patch.preview', label: t('vc.diag.patch.preview'), disabled: state.running !== '',
      args: [], handler: function () { vcDiagCall(o.onRead, [VC_DIAG_PATCH_CAP]) },
    }),
  ]))
  const result = results[VC_DIAG_PATCH_CAP]
  if (result) kids.push(vcDiagResultNode(h, t, result))
  return h('section', { key: 'patch', className: 'vcs-diag-block', 'data-vc-diag-block': 'patch' }, kids)
}

// 13.13：没有按钮。显示上一条提交的尾部签名行（有读数时），否则说明写入路径在提交页。
const vcDiagTrailerBlock = function (h: any, t: any, o: any): any {
  const state = o.state
  const read = (state.reads || {})[VC_DIAG_TRAILER_CAP] || null
  const kids: any[] = [h('h3', { key: 'title', className: 'vcs-diag-title' }, t('vc.diag.section.trailer'))]
  kids.push(h('p', { key: 'note', className: 'vcs-diag-note', 'data-vc-diag-trailer-note': '1' }, t('vc.diag.trailer.note')))
  kids.push(vcDiagRowsNode(h, t, VC_DIAG_TRAILER_CAP, read))
  return h('section', { key: 'trailer', className: 'vcs-diag-block', 'data-vc-diag-block': 'trailer', 'data-vc-diag-readonly': VC_DIAG_TRAILER_CAP }, kids)
}

const vcDiagReplaceBlock = function (h: any, t: any, o: any): any {
  const state = o.state
  const inputs = state.inputs || {}
  const read = (state.reads || {})[VC_DIAG_REPLACE_CAP] || null
  const results = state.results || {}
  const kids: any[] = [h('h3', { key: 'title', className: 'vcs-diag-title' }, t('vc.diag.section.replace'))]
  kids.push(h('p', { key: 'note', className: 'vcs-diag-note' }, t('vc.diag.replace.note')))
  kids.push(h('div', { key: 'fields', className: 'vcs-diag-fields' }, [
    vcDiagInputNode(h, t, {}, vcDiagnosticsInputOf(inputs, VC_DIAG_REPLACE_CAP, 'from'), 'vc.diag.field.from', o.onEdit, VC_DIAG_REPLACE_CAP, 'from'),
    vcDiagInputNode(h, t, {}, vcDiagnosticsInputOf(inputs, VC_DIAG_REPLACE_CAP, 'to'), 'vc.diag.field.to', o.onEdit, VC_DIAG_REPLACE_CAP, 'to'),
  ]))
  kids.push(h('div', { key: 'acts', className: 'vcs-diag-acts' }, [
    vcDiagButtonNode(h, t, {
      key: 'create', op: 'replace-create', cap: VC_DIAG_REPLACE_CAP, logId: 'vc.diag.replace.create', label: t('vc.diag.replace.create'), danger: true,
      disabled: state.running !== '', args: ['replace-create', { from: vcDiagnosticsInputOf(inputs, VC_DIAG_REPLACE_CAP, 'from'), to: vcDiagnosticsInputOf(inputs, VC_DIAG_REPLACE_CAP, 'to') }],
      handler: o.onWrite,
    }),
    vcDiagButtonNode(h, t, { key: 'refresh', read: VC_DIAG_REPLACE_CAP, logId: 'vc.diag.replace.refresh', label: t('vc.diag.replace.refresh'), disabled: state.running !== '', args: [], handler: function () { vcDiagCall(o.onRead, [VC_DIAG_REPLACE_CAP]) } }),
  ]))
  kids.push(vcDiagRowsNode(h, t, VC_DIAG_REPLACE_CAP, read))
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
  return h('section', { key: 'replace', className: 'vcs-diag-block', 'data-vc-diag-block': 'replace' }, kids)
}

const vcDiagPointerBlock = function (h: any, t: any): any {
  const kids: any[] = [h('h3', { key: 'title', className: 'vcs-diag-title' }, t('vc.diag.section.pointer'))]
  for (let i = 0; i < VC_DIAG_POINTERS.length; i += 1) {
    const p: any = VC_DIAG_POINTERS[i]
    const cap: string = String(p.cap)
    const textKey: string = cap === '13.3' ? 'vc.diag.pointer.search' : 'vc.diag.pointer.commits'
    kids.push(h('p', {
      key: cap, className: 'vcs-diag-pointer', 'data-vc-diag-pointer': cap, 'data-vc-diag-pointer-page': String(p.page || ''),
    }, cap + ' ' + vcDiagCapNameOf(cap) + '：' + t(textKey)))
  }
  return h('section', { key: 'pointer', className: 'vcs-diag-block', 'data-vc-diag-block': 'pointer' }, kids)
}

// 页面壳的挂载判定也放这一片：壳只问一句「这一页现在画不画」，判定与真正文挨在一起，壳不多一行规则。
export const vcDiagnosticsMountNode = function (h: any, t: any, opts: any): any {
  const o = opts || {}
  if (String(o.page || '') !== 'diagnostics' || !o.reads) return null
  return vcDiagnosticsPageNode(h, t, {
    reads: o.reads, state: o.diagnostics || null,
    onRead: o.onDiagnosticsRead, onWrite: o.onDiagnosticsWrite, onEdit: o.onDiagnosticsEdit,
    onConfirm: o.onDiagnosticsConfirm, onCancel: o.onDiagnosticsCancel,
  })
}

export const vcDiagnosticsPageNode = function (h: any, t: any, o: any): any {
  const opts = o || {}
  const state: any = opts.state || vcDiagnosticsStateNew()
  const kids: any[] = [
    h('h2', { key: 'title', className: 'vcs-diag-page-title', 'data-vc-diag-page-title': '1' }, t('vc.diag.title')),
    h('p', { key: 'lede', className: 'vcs-diag-lede' }, t('vc.diag.lede')),
    vcDiagBisectBlock(h, t, Object.assign({}, opts, { state: state })),
    vcDiagReadBlock(h, t, Object.assign({}, opts, { state: state })),
    vcDiagPatchBlock(h, t, Object.assign({}, opts, { state: state })),
    vcDiagTrailerBlock(h, t, Object.assign({}, opts, { state: state })),
    vcDiagReplaceBlock(h, t, Object.assign({}, opts, { state: state })),
    vcDiagPointerBlock(h, t),
  ]
  if (state.running) kids.push(h('p', { key: 'running', className: 'vcs-diag-running', 'data-vc-diag-running': '1', role: 'status' }, t('vc.diag.result.running')))
  return h('section', {
    className: 'vcs-diag-panel', 'data-vc-diag-panel': '1', 'data-vc-page': 'diagnostics',
    'aria-label': t('vc.diag.title'),
  }, kids)
}
