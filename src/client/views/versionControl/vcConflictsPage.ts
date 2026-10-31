// views/versionControl/vcConflictsPage.ts —— 冲突向导的界面正文（#1747 T12）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处。
// 职责四条：
//   1. 画冲突现场：进行中操作是什么、冲突文件清单按八类逐条列，每条给出可用的边（当前/对方/保留删除）；
//   2. 能力 6.1–6.15 逐条一行，主入口、输入与自己那块结果都贴在同一行里；
//   3. 6.7 的冲突视图逐块给出当前边/对方边，并在块上提供选择；选择由共享层 applyConflictChoices 拼成整份后送 6.7 保存；
//   4. 危险动作（跳过、中止）走四段确认卡；失败话术与写页同源（vcWriteErrFamilyOf），界面不另写一份理由文案。
// 界面一个中文字面量都没有：可见文字全走 t(词条)，词条真源 config/copy/vcconflicts.yaml；
//   h 与 t 从参数传入，本文件不读闭包全局，门禁可以直接求值后再断言。

// 同一闭包里排在前面的是动作模型叶子（vcConflictsOps.ts），它导出的形状由构建拼进闭包；
// 这里按既有惯例逐个声明形状，构建时声明不参与拼接，tsc 因此能在单文件检查里看到这些名字。
declare const VC_CONFLICTS_OPS: any[]
declare function vcConflictsOpLabelKeyOf(op: any): string
declare function vcConflictsOpVerbKeyOf(op: any): string
declare function vcConflictsStateLabelKeyOf(state: any): string
declare function vcConflictsKindLabelKeyOf(kind: any): string
declare function vcConflictsSideLabelKeyOf(side: any): string
declare function vcConflictsVisibleOf(state: any): any[]
declare function vcConflictsPayloadOf(op: any, values: any): any
declare function vcConflictsTargetOf(op: any, values: any, t: any): string
declare function vcConflictsListOf(read: any): any[]
declare function vcConflictsChoicesOf(hunkCount: any, choices: any): any[]
declare function vcWriteErrFamilyOf(reason: any, kind: any): string
declare function splitConflictHunks(text: any): any
declare function applyConflictChoices(text: any, choices: any): any

const vcConflictsNoteNode = function (h: any, t: any, meta: any, state: any) {
  if (!state || !state.noteKey) return null
  return h('p', { key: 'note', className: 'vcs-conflicts-note', 'data-vc-conflicts-note': String(meta.capId) }, t(String(state.noteKey)))
}

// 输入控件：形状随动作需要变（目标 / 路径 / 路径加边 / 路径加整份文本），都带 data-vc-conflicts-field。
const vcConflictsInputsOf = function (h: any, t: any, meta: any, values: any, handlers: any) {
  const v: any = values || {}
  const on: any = handlers || {}
  const out: any[] = []
  const changeOf = function (field: string) {
    return function (ev: any) { if (typeof on.onValue === 'function') on.onValue(field, ev && ev.target ? ev.target.value : '') }
  }
  const inputOf = function (field: string, key: string, labelKey: string, initial: any) {
    out.push(h('label', { key: 'lab-' + key, className: 'vcs-conflicts-label' }, t(labelKey)))
    out.push(h('input', { key: key, type: 'text', className: 'vcs-conflicts-input', 'data-vc-conflicts-field': field, value: String(initial === undefined || initial === null ? '' : initial), onChange: changeOf(field) }))
  }
  if (meta.needs === 'target') inputOf('target', 'target', 'vc.conflicts.field.target', v.target)
  if (meta.needs === 'path' || meta.needs === 'path-side' || meta.needs === 'path-text') inputOf('path', 'path', 'vc.conflicts.field.path', v.path)
  if (meta.needs === 'path-side') {
    out.push(h('label', { key: 'lab-side', className: 'vcs-conflicts-label' }, t('vc.conflicts.field.side')))
    const sides: string[] = ['ours', 'theirs', 'delete']
    out.push(h('select', {
      key: 'side', className: 'vcs-conflicts-select', 'data-vc-conflicts-field': 'side', value: String(v.side || 'ours'),
      onChange: function (ev: any) { if (typeof on.onValue === 'function') on.onValue('side', ev && ev.target ? ev.target.value : 'ours') },
    }, sides.map(function (side: string) { return h('option', { key: side, value: side }, t(vcConflictsSideLabelKeyOf(side))) })))
  }
  if (meta.needs === 'path-text') {
    out.push(h('label', { key: 'lab-text', className: 'vcs-conflicts-label' }, t('vc.conflicts.field.text')))
    out.push(h('textarea', {
      key: 'text', className: 'vcs-conflicts-textarea', rows: 6, 'data-vc-conflicts-field': 'text', value: String(v.text === undefined || v.text === null ? '' : v.text),
      onChange: function (ev: any) { if (typeof on.onValue === 'function') on.onValue('text', ev && ev.target ? ev.target.value : '') },
    }))
    out.push(h('p', { key: 'text-hint', className: 'vcs-conflicts-note', 'data-vc-conflicts-text-hint': '1' }, t('vc.conflicts.field.textHint')))
  }
  return out
}

// 结果块：成功给命令与冲突计数，失败走同源话术加 git 原话；都挂在触发这一行里面。
const vcConflictsResultNode = function (h: any, t: any, meta: any, result: any, handlers: any) {
  const r: any = result || {}
  const fail: boolean = r.ok === false
  const attrs: any = { key: 'result', className: 'vcs-conflicts-result vcs-conflicts-result-' + (fail ? 'fail' : 'ok'), 'data-vc-conflicts-result': String(meta.capId), 'data-vc-conflicts-result-ok': fail ? '0' : '1' }
  attrs.role = fail ? 'alert' : 'status'
  const kids: any[] = []
  if (fail) {
    const err: any = r.error || {}
    const family: string = String(vcWriteErrFamilyOf(err.reason, err.kind) || 'unknown')
    kids.push(h('p', { key: 'title', className: 'vcs-conflicts-result-title' }, t('vc.conflicts.result.failTitle')))
    kids.push(h('p', { key: 'text', className: 'vcs-conflicts-result-text' }, t('vc.conflicts.result.fail', { hint: t('vc.writeErr.' + family), git: String(err.message || '') })))
    kids.push(h('button', { key: 'retry', type: 'button', className: 'vcs-conflicts-retry', 'data-vc-conflicts-retry': '1', 'data-press': 'button', 'data-log': 'vc.conflicts.retry', onClick: function () { if (handlers && typeof handlers.begin === 'function') handlers.begin(meta.op, vcConflictsPayloadOf(meta.op, r.values)) } }, t('vc.conflicts.result.retry')))
  } else {
    const n: any = (r.conflictCount === undefined || r.conflictCount === null) ? 0 : r.conflictCount
    kids.push(h('p', { key: 'title', className: 'vcs-conflicts-result-title' }, t('vc.conflicts.result.okTitle')))
    kids.push(h('p', { key: 'text', className: 'vcs-conflicts-result-text' }, t('vc.conflicts.result.ok', { cmd: String(r.command || meta.op), n: String(n), state: String(r.state || '') })))
  }
  return h('div', attrs, kids)
}

// 确认卡：固定四段（会动什么、不会动什么、能不能回来、点了执行什么），默认焦点在取消上。
const vcConflictsConfirmNode = function (h: any, t: any, meta: any, confirm: any, values: any, handlers: any) {
  const c: any = confirm || {}
  const target: string = vcConflictsTargetOf(meta.op, values, t) || t('vc.conflicts.confirm.allChanges')
  const answer: string = meta.dangerous ? t('vc.conflicts.confirm.reversibleNo') : t('vc.conflicts.confirm.reversibleYes')
  return h('div', { key: 'confirm', className: 'vcs-conflicts-confirm', 'data-vc-conflicts-confirm': String(meta.capId), role: 'dialog', 'aria-modal': 'false' }, [
    h('h4', { key: 'title', className: 'vcs-conflicts-confirm-title' }, t('vc.conflicts.confirm.title', { verb: t(vcConflictsOpVerbKeyOf(meta.op)) })),
    h('p', { key: 'what', className: 'vcs-conflicts-confirm-seg', 'data-vc-conflicts-confirm-seg': 'what' }, t('vc.conflicts.confirm.what', { target: target })),
    h('p', { key: 'wont', className: 'vcs-conflicts-confirm-seg', 'data-vc-conflicts-confirm-seg': 'wont' }, t('vc.conflicts.confirm.wont')),
    h('p', { key: 'reversible', className: 'vcs-conflicts-confirm-seg', 'data-vc-conflicts-confirm-seg': 'reversible' }, t('vc.conflicts.confirm.reversible', { answer: answer })),
    h('p', { key: 'verb', className: 'vcs-conflicts-confirm-seg', 'data-vc-conflicts-confirm-seg': 'verb' }, t('vc.conflicts.confirm.verb', { verb: t(vcConflictsOpVerbKeyOf(meta.op)) })),
    h('div', { key: 'acts', className: 'vcs-conflicts-confirm-acts' }, [
      h('button', { key: 'cancel', type: 'button', className: 'vcs-conflicts-confirm-cancel', 'data-vc-conflicts-confirm-cancel': '1', 'data-focus-default': 'cancel', 'data-press': 'button', 'data-log': 'vc.conflicts.confirm.cancel', onClick: function () { if (handlers && typeof handlers.cancel === 'function') handlers.cancel(meta.op) } }, t('vc.conflicts.confirm.cancel')),
      h('button', { key: 'go', type: 'button', className: 'vcs-conflicts-confirm-go', 'data-vc-conflicts-confirm-go': '1', 'data-press': 'button', 'data-log': 'vc.conflicts.confirm.go', onClick: function () { if (handlers && typeof handlers.run === 'function') handlers.run(meta.op, vcConflictsPayloadOf(meta.op, values), { ticketId: String(c.ticketId || ''), requestId: String(c.requestId || '') }) } }, t('vc.conflicts.confirm.go')),
    ]),
  ])
}

// 冲突视图（6.9）与整份编辑（6.7）的逐块选择：每块给当前边/对方边两段原文与一个选择；
// 选择交给页面层的「拼成整份」按钮，用共享层 applyConflictChoices 拼出文本再填进 6.7 的输入框。
const vcConflictsHunksNode = function (h: any, t: any, meta: any, read: any, state: any, handlers: any) {
  const text: string = String((read && read.text) || '')
  const parsed: any = splitConflictHunks(text)
  if (!parsed || parsed.ok !== true) return h('p', { key: 'hunks-none', className: 'vcs-conflicts-note', 'data-vc-conflicts-hunks-none': '1' }, t('vc.conflicts.view.noHunks'))
  const choices: any[] = vcConflictsChoicesOf(parsed.hunks.length, state && state.choices)
  const blocks: any[] = parsed.hunks.map(function (hunk: any) {
    const selected: string = String(choices[hunk.index] || '')
    return h('div', { key: 'hunk-' + hunk.index, className: 'vcs-conflicts-hunk', 'data-vc-conflicts-hunk': String(hunk.index) }, [
      h('p', { key: 'head', className: 'vcs-conflicts-hunk-head', 'data-vc-conflicts-hunk-head': String(hunk.index) }, t('vc.conflicts.view.hunkHead', { n: String(hunk.index), line: String(hunk.startLine) })),
      h('p', { key: 'ours', className: 'vcs-conflicts-hunk-side', 'data-vc-conflicts-hunk-side': 'ours' }, t('vc.conflicts.view.ours', { text: hunk.oursLines.join('') })),
      h('p', { key: 'theirs', className: 'vcs-conflicts-hunk-side', 'data-vc-conflicts-hunk-side': 'theirs' }, t('vc.conflicts.view.theirs', { text: hunk.theirsLines.join('') })),
      h('select', {
        key: 'pick', className: 'vcs-conflicts-select', 'data-vc-conflicts-hunk-choice': String(hunk.index), value: selected,
        onChange: function (ev: any) { if (handlers && typeof handlers.onHunkChoice === 'function') handlers.onHunkChoice(meta.op, hunk.index, ev && ev.target ? ev.target.value : '') },
      }, [h('option', { key: 'none', value: '' }, t('vc.conflicts.view.pickNone')), h('option', { key: 'ours', value: 'ours' }, t('vc.conflicts.view.pickOurs')), h('option', { key: 'theirs', value: 'theirs' }, t('vc.conflicts.view.pickTheirs')), h('option', { key: 'both', value: 'both' }, t('vc.conflicts.view.pickBoth')), h('option', { key: 'base', value: 'base' }, t('vc.conflicts.view.pickBase'))]),
    ])
  })
  blocks.push(h('button', {
    key: 'compose', type: 'button', className: 'vcs-conflicts-compose', 'data-vc-conflicts-compose': '1', 'data-press': 'button', 'data-log': 'vc.conflicts.compose',
    onClick: function () { if (handlers && typeof handlers.onCompose === 'function') handlers.onCompose(parsed.hunks.length, choices) },
  }, t('vc.conflicts.view.compose')))
  blocks.push(h('p', { key: 'compose-hint', className: 'vcs-conflicts-note', 'data-vc-conflicts-compose-hint': '1' }, t('vc.conflicts.view.composeHint')))
  return h('div', { key: 'hunks', className: 'vcs-conflicts-hunks', 'data-vc-conflicts-hunks': String(parsed.hunks.length) }, blocks)
}

// 只读动作的结果：一览（冲突清单已在页顶常驻，这里给计数与状态）、预演、rerere、标记检查、冲突视图。
const vcConflictsReadNode = function (h: any, t: any, meta: any, read: any, state: any, handlers: any) {
  const r: any = read || {}
  const attrs: any = { key: 'read', className: 'vcs-conflicts-read', 'data-vc-conflicts-read': String(meta.capId) }
  if (r.ok === false) {
    attrs['data-vc-conflicts-read-ok'] = '0'
    const err: any = r.error || {}
    const family: string = String(vcWriteErrFamilyOf(err.reason, err.kind) || 'unknown')
    return h('div', attrs, [h('p', { key: 'text', className: 'vcs-conflicts-read-text', role: 'alert' }, t('vc.conflicts.read.fail', { hint: t('vc.writeErr.' + family), git: String(err.message || '') }))])
  }
  const kids: any[] = []
  if (meta.op === 'conflict-list') {
    kids.push(h('p', { key: 'text', className: 'vcs-conflicts-read-text', 'data-vc-conflicts-read-count': String(r.conflictCount || 0) }, t('vc.conflicts.read.list', { n: String(r.conflictCount || 0), state: String(r.state || '') })))
  } else if (meta.op === 'conflict-view') {
    if (r.kind === 'binary') kids.push(h('p', { key: 'binary', className: 'vcs-conflicts-read-text', 'data-vc-conflicts-view-binary': '1' }, t('vc.conflicts.view.binary')))
    else kids.push(vcConflictsHunksNode(h, t, meta, r, state, handlers))
  } else if (meta.op === 'merge-preview') {
    kids.push(h('p', { key: 'text', className: 'vcs-conflicts-read-text', 'data-vc-conflicts-preview-clean': r.clean === true ? '1' : '0' }, r.clean === true ? t('vc.conflicts.read.previewClean', { target: String(r.target || '') }) : t('vc.conflicts.read.previewConflicts', { n: String((r.paths || []).length), paths: (r.paths || []).join('、') })))
  } else if (meta.op === 'rerere-view') {
    kids.push(h('p', { key: 'text', className: 'vcs-conflicts-read-text', 'data-vc-conflicts-rerere-enabled': r.enabled === true ? '1' : '0' }, r.enabled === true ? t('vc.conflicts.read.rerereOn', { n: String((r.paths || []).length), paths: (r.paths || []).join('、') }) : t('vc.conflicts.read.rerereOff')))
  } else {
    const worktree: any[] = Array.isArray(r.worktree) ? r.worktree : []
    const staged: any[] = Array.isArray(r.staged) ? r.staged : []
    kids.push(h('p', { key: 'text', className: 'vcs-conflicts-read-text', 'data-vc-conflicts-marker-clean': r.clean === true ? '1' : '0' }, r.clean === true ? t('vc.conflicts.read.markerClean') : t('vc.conflicts.read.markerDirty', { worktree: String(worktree.length), staged: String(staged.length) })))
  }
  return h('div', attrs, kids)
}

// 冲突清单常驻在页顶：每条给路径与类别，可用的边各给一个快捷按钮（没有的边不画，不是灰着）。
const vcConflictsFilesNode = function (h: any, t: any, conflicts: any[], handlers: any) {
  const on: any = handlers || {}
  const items: any[] = conflicts.map(function (item: any) {
    const sides: any = item.sides || {}
    const buttons: any[] = []
    const sideOf = function (side: string, key: string) {
      if (sides[side] !== true) return
      buttons.push(h('button', {
        key: key, type: 'button', className: 'vcs-conflicts-file-side', 'data-vc-conflicts-file-side': side, 'data-vc-conflicts-file-path': item.path,
        'data-press': 'button', 'data-log': 'vc.conflicts.takeSide',
        onClick: function () { if (typeof on.onTakeSide === 'function') on.onTakeSide(item.path, side) },
      }, t(vcConflictsSideLabelKeyOf(side))))
    }
    sideOf('ours', 'ours')
    sideOf('theirs', 'theirs')
    if (sides.delete === true) buttons.push(h('button', {
      key: 'delete', type: 'button', className: 'vcs-conflicts-file-side', 'data-vc-conflicts-file-side': 'delete', 'data-vc-conflicts-file-path': item.path,
      'data-press': 'button', 'data-log': 'vc.conflicts.takeSide',
      onClick: function () { if (typeof on.onTakeSide === 'function') on.onTakeSide(item.path, 'delete') },
    }, t('vc.conflicts.side.delete')))
    return h('li', { key: item.path, className: 'vcs-conflicts-file', 'data-vc-conflicts-file': item.path, 'data-vc-conflicts-file-kind': item.kind }, [
      h('span', { key: 'path', className: 'vcs-conflicts-file-path' }, item.path),
      h('span', { key: 'kind', className: 'vcs-conflicts-badge', 'data-vc-conflicts-file-kind-label': item.kind }, t(vcConflictsKindLabelKeyOf(item.kind))),
    ].concat(buttons))
  })
  if (items.length === 0) return h('p', { key: 'files-empty', className: 'vcs-conflicts-note', 'data-vc-conflicts-files-empty': '1' }, t('vc.conflicts.files.empty'))
  return h('ul', { key: 'files', className: 'vcs-conflicts-files', 'data-vc-conflicts-files': String(items.length) }, items)
}

// 一行：能力编号与名字、徽标、输入、主入口按钮，以及确认卡 / 结果 / 只读结果（都在这行里）。
export const vcConflictsRowNode = function (h: any, t: any, meta: any, opts: any) {
  const o: any = opts || {}
  const values: any = o.values || {}
  const handlers: any = o.handlers || {}
  const state: any = (o.rows && o.rows[meta.op]) || {}
  const kids: any[] = [
    h('div', { key: 'head', className: 'vcs-conflicts-head' }, [
      h('span', { key: 'cap', className: 'vcs-conflicts-cap', 'data-vc-conflicts-cap': String(meta.capId) }, String(meta.capId) + ' ' + t(vcConflictsOpLabelKeyOf(meta.op))),
      h('span', { key: 'badge', className: 'vcs-conflicts-badge', 'data-vc-conflicts-danger': meta.dangerous ? '1' : '0' }, meta.dangerous ? t('vc.conflicts.badge.danger') : (meta.write ? '' : t('vc.conflicts.badge.read'))),
    ]),
  ]
  const inputs: any[] = vcConflictsInputsOf(h, t, meta, values, handlers)
  if (inputs.length > 0) kids.push(h('div', { key: 'inputs', className: 'vcs-conflicts-inputs' }, inputs))
  const primaryAttrs: any = { key: 'primary', type: 'button', className: 'vcs-conflicts-go', 'data-vc-conflicts-primary': String(meta.capId), 'data-vc-conflicts-op': String(meta.op), disabled: state.busy === true, 'data-press': 'button', 'data-log': 'vc.conflicts.run' }
  primaryAttrs.onClick = function () {
    const payload: any = vcConflictsPayloadOf(meta.op, values)
    if (meta.write !== true) { if (typeof handlers.read === 'function') handlers.read(meta.op, payload) }
    else if (typeof handlers.begin === 'function') handlers.begin(meta.op, payload)
  }
  kids.push(h('button', primaryAttrs, t(vcConflictsOpLabelKeyOf(meta.op))))
  if (state.confirm) kids.push(vcConflictsConfirmNode(h, t, meta, state.confirm, values, handlers))
  if (state.result) kids.push(vcConflictsResultNode(h, t, meta, state.result, handlers))
  if (state.read) kids.push(vcConflictsReadNode(h, t, meta, state.read, state, handlers))
  const note: any = vcConflictsNoteNode(h, t, meta, state)
  if (note) kids.push(note)
  return h('li', { key: String(meta.capId), className: 'vcs-conflicts-row', 'data-vc-conflicts-row': String(meta.capId), 'data-vc-conflicts-row-op': String(meta.op) }, kids)
}

// 整页：页顶状态与冲突文件清单 + 15 条动作行；页面壳只在 conflicts 页把这块挂进页面体，别的页不出现。
export const vcConflictsPageNode = function (h: any, t: any, o: any) {
  const opts: any = o || {}
  const c: any = opts.conflicts || {}
  const state: string = (c.state === undefined || c.state === null) ? '' : String(c.state)
  const conflicts: any[] = vcConflictsListOf(c.reads && c.reads['conflict-list'])
  const kids: any[] = [
    h('h3', { key: 'title', className: 'vcs-conflicts-title' }, t('vc.conflicts.pageTitle')),
    h('p', { key: 'hint', className: 'vcs-conflicts-hint', 'data-vc-conflicts-hint': '1' }, t('vc.conflicts.hint')),
    h('p', { key: 'state', className: 'vcs-conflicts-state', 'data-vc-conflicts-state': state === '' ? 'none' : state }, state === '' ? t('vc.conflicts.state.none') : t('vc.conflicts.stateLine', { state: t(vcConflictsStateLabelKeyOf(state)), n: String(conflicts.length) })),
  ]
  if (c.error) kids.push(h('p', { key: 'err', className: 'vcs-conflicts-error', role: 'alert', 'data-vc-conflicts-error': '1' }, String(c.errorText || t('vc.conflicts.result.failTitle'))))
  kids.push(h('div', { key: 'files-block', className: 'vcs-conflicts-files-block' }, [h('h4', { key: 'title', className: 'vcs-conflicts-files-title' }, t('vc.conflicts.files.title')), vcConflictsFilesNode(h, t, conflicts, c.handlers)]))
  const visible: string[] = vcConflictsVisibleOf(state)
  kids.push(h('ul', { key: 'rows', className: 'vcs-conflicts-rows' }, VC_CONFLICTS_OPS.filter(function (meta: any) { return visible.indexOf(meta.op) >= 0 }).map(function (meta: any) {
    return vcConflictsRowNode(h, t, meta, { values: c.values, rows: c.rows, handlers: c.handlers })
  })))
  return h('section', { id: 'vc-conflicts-page', className: 'vcs-conflicts', role: 'region', 'data-vc-conflicts-page': '1', 'data-vc-conflicts-count': String(VC_CONFLICTS_OPS.length) }, kids)
}
