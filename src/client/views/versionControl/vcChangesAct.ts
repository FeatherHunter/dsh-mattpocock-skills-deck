// views/versionControl/vcChangesAct.ts —— 贴在那一行下面的两块东西：行级确认卡与改名表单（#1902 从 vcChangesRow 拆出）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 为什么单开一叶：vcChangesRow 已经贴着每文件 350 有效行的上限，而这两个东西都不是「一行长什么样」，
// 是「点了这一行之后要人再确认的那一下」——分开之后，行视图只管把触发行画对，这里只管把后果说清。
// 两块都紧贴着触发行画，不浮到页面另一头：菜单贴着「⋯」，确认卡与表单贴着那一行。

declare function vcChangesTargetOf(op: any, values: any, t: any): string

/** 行级确认卡：危险动作写「会动什么、会不会丢、能不能回来」；停止跟踪不是危险动作，但同样先说清后果。 */
export const vcChangesConfirmNodeOf = function (h: any, t: any, o: any): any {
  const meta: any = o.meta || {}
  const confirm: any = o.confirm || {}
  const handlers: any = o.handlers || {}
  const row: any = o.row || {}
  const path: string = String(row.path || '')
  const slash: number = path.lastIndexOf('/')
  const name: string = slash >= 0 ? path.slice(slash + 1) : path
  const op: string = String(meta.op || '')
  const isUntrack: boolean = op === 'rm-cached'
  const isDelete: boolean = op === 'rm-tracked'
  const isRename: boolean = op === 'mv'
  const title: string = isDelete
    ? t('vc.changes.view.confirmDeleteTrackedTitle', { name: name })
    : (isUntrack ? t('vc.changes.view.confirmUntrackTitle', { name: name }) : t('vc.changes.confirm.title', { verb: t('vc.changes.op.verb.' + String(op).replace(/-([a-z])/g, function (m: string, c: string) { return c.toUpperCase() })) }))
  const body: string = isDelete
    ? t('vc.changes.view.confirmDeleteTrackedBody')
    : (isUntrack ? t('vc.changes.view.confirmUntrackBody') : t('vc.changes.confirm.what', { target: vcChangesTargetOf(op, { path: path }, t) || path }))
  const go: string = isDelete
    ? t('vc.changes.view.confirmDeleteTrackedGo')
    : (isUntrack ? t('vc.changes.view.confirmUntrackGo') : t('vc.changes.confirm.go'))
  const danger: boolean = meta.dangerous === true
  const parts: string[] = []
  if (typeof row.addedLines === 'number' && row.addedLines > 0) parts.push(t('vc.changes.view.lostAdded', { n: String(row.addedLines) }))
  if (typeof row.deletedLines === 'number' && row.deletedLines > 0) parts.push(t('vc.changes.view.lostDeleted', { n: String(row.deletedLines) }))
  const metaText: string = parts.length > 0 ? t('vc.changes.view.confirmLost', { parts: parts.join(t('vc.commit.listSeparator')) }) : ''
  const kids: any[] = [
    h('h3', { key: 'title', className: 'changes-confirm-title', 'data-vc-file-confirm-title': op }, title),
    h('p', { key: 'body', className: 'changes-confirm-body', 'data-vc-file-confirm-seg': 'what' }, body),
  ]
  if (!isDelete && !isUntrack) {
    kids.push(h('p', { key: 'wont', className: 'changes-confirm-body', 'data-vc-file-confirm-seg': 'wont' }, t('vc.changes.confirm.wont')))
    kids.push(h('p', { key: 'rev', className: 'changes-confirm-meta', 'data-vc-file-confirm-seg': 'reversible' }, t('vc.changes.confirm.reversible', { answer: meta.reversible ? t('vc.changes.confirm.reversibleYes') : t('vc.changes.confirm.reversibleNo') })))
  }
  if (metaText !== '') kids.push(h('p', { key: 'meta', className: 'changes-confirm-meta', 'data-vc-file-confirm-seg': 'lost' }, metaText))
  kids.push(h('div', { key: 'acts', className: 'changes-confirm-actions' }, [
    h('button', {
      key: 'cancel', type: 'button', className: 'btn btn-ghost btn-sm', 'data-vc-file-confirm-cancel': '1', 'data-focus-default': 'cancel',
      'data-press': 'button', 'data-log': 'vc.changes.file.confirm.cancel',
      onClick: function () { if (typeof handlers.cancel === 'function') handlers.cancel(op, { path: path, from: path }) },
    }, t('vc.changes.confirm.cancel')),
    h('button', {
      key: 'go', type: 'button', className: 'btn ' + (danger ? 'btn-danger' : 'btn-secondary') + ' btn-sm', 'data-vc-file-confirm-go': '1',
      'data-press': 'button', 'data-log': 'vc.changes.file.confirm.go',
      onClick: function () {
        if (typeof handlers.run === 'function') {
          handlers.run(op, isRename ? { from: path, path: path, to: String(row.renameTo || '') } : { path: path }, { ticketId: String(confirm.ticketId || ''), requestId: String(confirm.requestId || '') })
        }
      },
    }, go),
  ]))
  return h('div', {
    key: 'confirm-' + op, className: 'changes-confirm ' + (danger ? 'is-danger' : 'is-warn'),
    'data-vc-file-confirm': op, role: 'group', 'aria-label': title,
  }, kids)
}

/** 改名与移动同一张表单：紧贴这一行展开，只填新路径，写清 git mv 会同时做哪两件事。 */
export const vcChangesRenameFormOf = function (h: any, t: any, o: any): any {
  const path: string = String(o.path || '')
  const values: any = o.values || {}
  const handlers: any = o.handlers || {}
  const draft: string = values.renameDraft === undefined || values.renameDraft === null ? path : String(values.renameDraft)
  const errorKey: string = String(values.renameError || '')
  const input: any = h('input', {
    key: 'input', type: 'text', className: 'rename-input', value: draft,
    'data-vc-rename-input': path, 'data-focus-default': 'rename', autocomplete: 'off', spellCheck: 'false',
    placeholder: t('vc.changes.view.renamePlaceholder'), 'aria-label': t('vc.changes.view.renameTitle'),
    onChange: function (ev: any) { if (typeof handlers.renameDraft === 'function') handlers.renameDraft(ev && ev.target ? ev.target.value : '') },
  })
  const kids: any[] = [
    h('h3', { key: 'title', className: 'rename-title' }, t('vc.changes.view.renameTitle')),
    input,
    h('p', { key: 'hint', className: 'rename-hint' }, t('vc.changes.view.renameHint')),
  ]
  if (errorKey !== '') kids.push(h('p', { key: 'err', className: 'rename-hint note-error', 'data-vc-rename-error': '1' }, t(errorKey)))
  kids.push(h('div', { key: 'acts', className: 'rename-actions' }, [
    h('button', {
      key: 'cancel', type: 'button', className: 'btn btn-ghost btn-sm', 'data-vc-rename-cancel': '1', 'data-press': 'button', 'data-log': 'vc.changes.rename.cancel',
      onClick: function () { if (typeof handlers.renameCancel === 'function') handlers.renameCancel() },
    }, t('vc.changes.view.renameCancel')),
    h('button', {
      key: 'go', type: 'button', className: 'btn btn-secondary btn-sm', 'data-vc-rename-apply': path, 'data-press': 'button', 'data-log': 'vc.changes.rename.apply',
      onClick: function () { if (typeof handlers.renameApply === 'function') handlers.renameApply(path) },
    }, t('vc.changes.view.renameSubmit')),
  ]))
  return h('div', { key: 'rename', className: 'rename-form', role: 'group', 'aria-label': t('vc.changes.view.renameTitle'), 'data-vc-rename-form': path }, kids)
}

