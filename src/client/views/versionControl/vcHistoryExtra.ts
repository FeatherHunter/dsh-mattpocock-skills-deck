// views/versionControl/vcHistoryExtra.ts —— 提交历史页四条能力多出来的那几块画法（#1903）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 版式照 docs/prototype/vc-redesign 的定稿截图 87–92：
//   搜索框右边的范围切换（说明 / 代码变化）→ 工具条下面的「附加区」（比较表单 / 比较结果头 / 只看某个文件）；
//   提交详情里文件行尾的「⋯」菜单 → 菜单里一条「看这个文件的历史」；
//   提交详情底部的「提交备注」一段。
// 结构、类名、data-* 属性与原型逐条对应，视觉由 vcProtoHistory 那一叶从原型 app.css 剪过来的样式负责。
// 可见文字一律走 t()，这一叶不写中文字面量。

declare const React: any
declare const VC_HISTORY_SCOPES: string[]
declare function vcHistoryNameOf(...args: any[]): string
declare function vcPageIconOf(...args: any[]): any
declare function vcOneLine(...args: any[]): any
declare function vcHistoryScopeOf(...args: any[]): string
declare function vcHistoryCompareSummaryOf(...args: any[]): string
declare function vcHistoryReadOf(...args: any[]): any
declare function vcHistoryDataOf(...args: any[]): any
declare function vcHistoryDirOf(...args: any[]): string
declare function vcHistoryNameOf(...args: any[]): string
declare function vcNoteDraftOf(...args: any[]): string
declare function vcNewNoteWrite(...args: any[]): any

// 两颗按钮的次序就是 VC_HISTORY_SCOPES 的次序：范围名单只有一处，画法与判定都按它排。
const VC_HISTORY_SCOPE_BTNS: any[] = [
  { scope: VC_HISTORY_SCOPES[0], labelKey: 'vc.shell.history.scopeMessage', hintKey: 'vc.shell.history.scopeMessageHint' },
  { scope: VC_HISTORY_SCOPES[1], labelKey: 'vc.shell.history.scopeCode', hintKey: 'vc.shell.history.scopeCodeHint' },
]

/** 搜索框右边的范围切换：两颗小按钮，选中态同时改颜色与 aria-pressed，读屏器也听得出来。 */
export const vcHistoryScopeSwitchNode = function (h: any, t: any, o: any) {
  const opts: any = o || {}
  const now: string = vcHistoryScopeOf(opts.scope)
  const kids: any[] = []
  for (let i = 0; i < VC_HISTORY_SCOPE_BTNS.length; i += 1) {
    const one: any = VC_HISTORY_SCOPE_BTNS[i]
    const on: boolean = one.scope === now
    kids.push(h('button', {
      key: one.scope, type: 'button', className: 'scope-btn' + (on ? ' is-on' : ''),
      'data-vc-history-scope-btn': one.scope,
      'aria-pressed': on ? 'true' : 'false',
      'data-vc-history-scope-hint': t(one.hintKey),
      'data-press': 'button', 'data-log': 'vc.history.scope.' + one.scope,
    }, t(one.labelKey)))
  }
  return h('div', { key: 'scope', className: 'scope-switch', role: 'group', 'aria-label': t('vc.shell.history.scopeLabel') }, kids)
}

/** 比较两个引用的两行表单：从哪条、到哪条；两端都能写 HEAD、HEAD~2 或列表里的短号。 */
export const vcHistoryCompareFormNode = function (h: any, t: any, o: any) {
  const opts: any = o || {}
  // 两端默认给「上一条 → 最新」，这也是最常见的读法（原型 history.ts 的同一口径）。
  //   界面状态里没写这两个值时仍然预填：入口一打开就该是能直接点「比较」的样子。
  const fromValue: any = opts.from === undefined || opts.from === null || opts.from === '' ? 'HEAD~1' : opts.from
  const toValue: any = opts.to === undefined || opts.to === null || opts.to === '' ? 'HEAD' : opts.to
  const field = function (key: string, which: string, labelKey: string, value: any): any {
    return h('div', { key: key, className: 'compare-row' }, [
      h('span', { key: 'k', className: 'compare-k' }, t(labelKey)),
      h('input', {
        key: 'i', type: 'text', className: 'compare-input',
        'data-vc-history-compare-field': which,
        'aria-label': t(labelKey),
        autoComplete: 'off', spellCheck: false, defaultValue: String(value === undefined || value === null ? '' : value),
      }),
    ])
  }
  const err: any = vcHistoryReadOf(opts.reads, 'compare')
  const kids: any[] = [
    field('from', 'from', 'vc.shell.history.compareFrom', fromValue),
    field('to', 'to', 'vc.shell.history.compareTo', toValue),
    h('p', { key: 'hint', className: 'compare-hint' }, t('vc.shell.history.compareHint')),
  ]
  const fail: any = err && err.state === 'err' ? err.error : null
  if (fail) kids.push(h('p', { key: 'err', className: 'compare-hint', 'data-vc-history-compare-error': String(fail.reason || fail.kind || 'fail') }, vcHistoryCompareErrorText(t, fail)))
  kids.push(h('div', { key: 'acts', className: 'compare-actions' }, [
    h('button', {
      key: 'cancel', type: 'button', className: 'btn btn-ghost btn-sm',
      'data-vc-history-compare-cancel': '1', 'data-press': 'button', 'data-log': 'vc.history.compare.cancel',
    }, t('vc.shell.history.compareCancel')),
    h('button', {
      key: 'apply', type: 'button', className: 'btn btn-primary btn-sm',
      'data-vc-history-compare-apply': '1', 'data-press': 'button', 'data-log': 'vc.history.compare.apply',
      disabled: err && err.state === 'loading' ? true : undefined,
    }, t('vc.shell.history.compareApply')),
  ]))
  return h('div', { key: 'form', className: 'compare-form', role: 'group', 'aria-label': t('vc.shell.history.compareTitle'), 'data-vc-history-compare-form': '1' }, kids)
}

/** 认不出的引用原样说给用户听，不悄悄当成 HEAD；其余失败照宿主给的原话（截断后）写。 */
const vcHistoryCompareErrorText = function (t: any, fail: any): string {
  const reason: string = String((fail && fail.reason) || '')
  if (reason === 'unknown-rev') {
    const rev: string = String((fail && fail.rev) || '')
    return t('vc.shell.history.compareUnknownRev', { rev: rev }) + ' ' + t('vc.shell.history.compareUnknownRevHint')
  }
  const msg: string = String((fail && fail.message) || '')
  return msg === '' ? t('vc.shell.history.compareError') : t('vc.shell.history.compareError') + '：' + vcOneLine(msg, 120)
}

/** 比较结果头：比较的是哪两端、几个文件，右边一颗「退出比较」。 */
export const vcHistoryCompareHeadNode = function (h: any, t: any, o: any) {
  const opts: any = o || {}
  const data: any = opts.data || {}
  const left: string = String(data.left || '')
  const right: string = String(data.right || '')
  return h('div', { key: 'head', className: 'compare-head', 'data-vc-history-compare-head': '1' }, [
    h('span', { key: 'title', className: 'compare-title' }, [
      t('vc.shell.history.compareTitle'),
      ' ',
      h('span', { key: 'l', className: 'mono' }, vcOneLine(left, 40)),
      '..',
      h('span', { key: 'r', className: 'mono' }, vcOneLine(right, 40)),
    ]),
    h('span', { key: 'sum', className: 'compare-summary', 'data-vc-history-compare-summary': '1' }, vcHistoryCompareSummaryOf(data.files, t)),
    h('button', {
      key: 'end', type: 'button', className: 'link-btn',
      'data-vc-history-compare-end': '1', 'data-press': 'button', 'data-log': 'vc.history.compare.end',
    }, t('vc.shell.history.compareEnd')),
  ])
}

/** 比较结果正文：只列文件与增删行数（真实数字来自 git diff --numstat，不画示意数据）。 */
export const vcHistoryCompareFilesNode = function (h: any, t: any, o: any) {
  const opts: any = o || {}
  const data: any = opts.data || {}
  const files: any[] = Array.isArray(data.files) ? data.files : []
  const kids: any[] = []
  if (data.truncated === true) kids.push(h('div', { key: 'trunc', className: 'compare-files-note' }, t('vc.shell.history.compareTruncated', { n: String(data.total || files.length) })))
  if (!files.length) kids.push(h('div', { key: 'empty', className: 'compare-files-note' }, t('vc.shell.history.compareEmpty')))
  for (let i = 0; i < files.length; i += 1) {
    const f: any = files[i] || {}
    const path: string = String(f.path || '')
    // 增删行数为 0 的那一格不画（原型 data/format.ts 的 lineDelta 同一条规矩：0 不是「没改」，是没什么可说的）。
    const delta: any[] = []
    if (typeof f.added === 'number' && isFinite(f.added) && f.added !== 0) delta.push(h('span', { key: 'a', className: 'dl-add', 'data-vc-file-delta-add': '1' }, String(f.added)))
    if (typeof f.deleted === 'number' && isFinite(f.deleted) && f.deleted !== 0) delta.push(h('span', { key: 'd', className: 'dl-del', 'data-vc-file-delta-del': '1' }, String(f.deleted)))
    kids.push(h('div', { key: 'f-' + i, className: 'file-row compare-file', 'data-vc-history-compare-file': path }, [
      h('span', { key: 'path', className: 'file-path' }, [
        h('span', { key: 'dir', className: 'file-dir' }, vcHistoryDirOf(path)),
        h('span', { key: 'name', className: 'file-name' }, vcHistoryNameOf(path)),
      ]),
      h('span', { key: 'delta', className: 'file-delta' }, delta),
    ]))
  }
  return h('div', { key: 'files', className: 'compare-files' }, kids)
}

/** 「只看某个文件」的那一条：左边写「只看」，中间是路径，右边一颗叉把它去掉。 */
export const vcHistoryFileOnlyNode = function (h: any, t: any, o: any) {
  const opts: any = o || {}
  const path: string = String(opts.path || '')
  return h('div', { key: 'only', className: 'history-file-only', 'data-vc-history-file-only-strip': '1' }, [
    h('span', { key: 'lead', className: 'file-only-lead' }, t('vc.shell.history.fileOnlyLead')),
    h('span', { key: 'path', className: 'file-only-path mono', 'aria-label': path }, path),
    h('button', {
      key: 'clear', type: 'button', className: 'file-only-clear',
      'data-vc-history-file-only-clear': '1',
      'aria-label': t('vc.shell.history.fileOnlyClear'),
      'data-press': 'button', 'data-log': 'vc.history.file-only.clear',
    }, '×'),
  ])
}

/**
 * 工具条下面那一层「附加区」：比较表单、比较结果头、或者「只看某个文件」的标签。
 * 三样互斥：比较开着就不画只看文件（动作层也会在发起只看时把比较收起来）。
 */
export const vcHistoryExtraNode = function (h: any, t: any, o: any) {
  const opts: any = o || {}
  const ui: any = opts.ui || {}
  const reads: any = opts.reads || null
  const kids: any[] = []
  if (ui.historyCompareOpen === true) kids.push(vcHistoryCompareFormNode(h, t, { reads: reads, from: ui.historyCompareFrom, to: ui.historyCompareTo }))
  if (ui.historyCompare) {
    // 结果头写的是「解析之后的两个提交号」；宿主还没给出解析结果时退回用户写的那两段字（不空着）。
    const data: any = Object.assign({}, vcHistoryDataOf(reads, 'compare') || {})
    const short = function (v: any) { const s: string = String(v || ''); return s === '' ? '' : s.slice(0, 7) }
    data.left = short(data.leftOid) || String((ui.historyCompare || {}).left || '')
    data.right = short(data.rightOid) || String((ui.historyCompare || {}).right || '')
    kids.push(vcHistoryCompareHeadNode(h, t, { data: data }))
  }
  else if (String(ui.historyFileOnly || '') !== '') kids.push(vcHistoryFileOnlyNode(h, t, { path: ui.historyFileOnly }))
  if (!kids.length) return null
  return h('div', { key: 'extra', className: 'history-extra', 'data-vc-history-extra': '1' }, kids)
}

/** 详情里文件行尾的「⋯」菜单：目前只有一条「看这个文件的历史」——它是从这一行发起的追问。 */
export const vcHistoryFileMenuNode = function (h: any, t: any, o: any) {
  const opts: any = o || {}
  const path: string = String(opts.path || '')
  return h('div', { key: 'menu', className: 'row-menu', role: 'menu', 'aria-label': t('vc.shell.history.fileMenuOpen'), 'data-vc-history-file-menu-panel': path }, [
    h('button', {
      key: 'history', type: 'button', className: 'row-menu-item', role: 'menuitem',
      'data-vc-history-file-history': path,
      'data-press': 'button', 'data-log': 'vc.history.file-history',
    }, t('vc.shell.history.fileHistory')),
    h('button', {
      key: 'close', type: 'button', className: 'row-menu-item is-close',
      'data-vc-history-file-menu-close': '1',
      'data-press': 'button', 'data-log': 'vc.history.file-menu.close',
    }, t('vc.shell.history.menuClose')),
  ])
}

/** 备注写失败的稳定理由 → 词表键：界面照理由说话，不把宿主的整句原话当结论。 */
const VC_NOTE_REASON_KEY: Record<string, string> = {
  'note-empty': 'vc.shell.history.noteEmpty',
  'note-changed': 'vc.shell.history.noteChanged',
  'unknown-rev': 'vc.shell.history.noteNoCommit',
  'ticket-expired': 'vc.shell.history.noteTicketGone',
  'ticket-missing': 'vc.shell.history.noteTicketGone',
  'ticket-op-mismatch': 'vc.shell.history.noteTicketGone',
  'stale-repo': 'vc.shell.history.noteTicketGone',
}

/** 备注这一段的结论行：写成功说保存了还是删了，写失败按稳定理由说，其余情况什么都不说。 */
const vcNoteResultTextOf = function (t: any, ui: any, rev: any): string {
  const one: any = ui.historyNote || vcNewNoteWrite()
  // 结论行跟着它写的那条提交走：换一条提交时，上一条的「已保存 / 已删除」不能挂在这一条的底下。
  if (String(one.rev || '') !== String(rev || '')) return ''
  if (one.state === 'ok') return one.removing === true ? t('vc.shell.history.noteRemoved') : t('vc.shell.history.noteSavedOk')
  if (one.state === 'err') {
    const reason: string = String((one.error && one.error.reason) || '')
    const key: string = VC_NOTE_REASON_KEY[reason] || ''
    if (key !== '') return t(key)
    const msg: string = String((one.error && one.error.message) || '')
    return msg === '' ? t('vc.shell.history.noteWriteError') : t('vc.shell.history.noteWriteError') + '：' + vcOneLine(msg, 120)
  }
  return ''
}

/** 提交详情底部的备注段：一条提交的注解，写在这里、跟着这条提交走。 */
export const vcHistoryNoteNode = function (h: any, t: any, o: any) {
  const opts: any = o || {}
  const ui: any = opts.ui || {}
  const reads: any = opts.reads || null
  const rev: string = String(ui.openCommit || '')
  const read: any = vcHistoryReadOf(reads, 'notes')
  const data: any = vcHistoryDataOf(reads, 'notes')
  const sameRev: boolean = !!(data && String(data.rev || '') === rev)
  const saved: boolean = sameRev && typeof data.note === 'string' && data.note !== ''
  const head: any[] = [h('h3', { key: 'title', className: 'detail-notes-title' }, t('vc.shell.history.noteTitle'))]
  if (saved) head.push(h('span', { key: 'chip', className: 'chip chip-sm chip-ok', 'data-vc-history-note-saved': '1' }, t('vc.shell.history.noteSaved')))
  const kids: any[] = [
    h('div', { key: 'head', className: 'detail-notes-head' }, head),
    h('p', { key: 'hint', className: 'detail-notes-hint' }, t('vc.shell.history.noteHint')),
  ]
  // 读这条提交的备注：读失败要说清楚并给重试，读取中不画成「没有备注」。
  if (read && read.state === 'err') kids.push(h('p', { key: 'err', className: 'detail-notes-hint', 'data-vc-history-note-error': String((read.error && read.error.reason) || read.error && read.error.kind || 'fail') }, t('vc.shell.history.noteError')))
  else if (read && read.state === 'loading' && !sameRev) kids.push(h('p', { key: 'load', className: 'detail-notes-hint', 'data-vc-history-note-loading': '1' }, t('vc.shell.history.noteLoading')))
  // 输入框里先放什么：用户这次改过的草稿优先；没有草稿但这条提交本来就有备注时，放那份原文（要改就在原文上改）。
  const draft: string = vcNoteDraftOf(ui, rev)
  const initial: string = draft !== '' ? draft : (saved ? String(data.note || '') : '')
  kids.push(h('textarea', {
    key: 'input', className: 'note-input', rows: 2,
    'data-vc-history-note-input': '1',
    placeholder: t('vc.shell.history.notePlaceholder'),
    'aria-label': t('vc.shell.history.noteTitle'),
    defaultValue: initial,
  }))
  const result: string = vcNoteResultTextOf(t, ui, rev)
  if (result !== '') kids.push(h('p', { key: 'res', className: 'detail-notes-hint', 'data-vc-history-note-result': (ui.historyNote || {}).state || '' }, result))
  kids.push(h('div', { key: 'acts', className: 'detail-notes-actions' }, [
    h('button', {
      key: 'save', type: 'button', className: 'btn btn-primary btn-sm',
      'data-vc-history-note-save': '1', 'data-press': 'button', 'data-log': 'vc.history.note.save',
      // 备注还在读的时候不让点：这一刻草稿还是空的，点下去会被当成「空草稿」什么也不做。
      disabled: (ui.historyNote && ui.historyNote.state === 'saving') || (read && read.state === 'loading' && !sameRev) ? true : undefined,
    }, t('vc.shell.history.noteSave')),
  ]))
  return h('div', { key: 'note', className: 'detail-notes', 'data-vc-history-note': rev }, kids)
}

/**
 * 提交行上的两枚标记：按代码搜命中时标出是哪份文件（原型里就是这一枚「命中 <文件>」），
 * 写过备注的提交再带一枚「备注」。两枚都没有时整块不画，行上不多一个空盒子。
 */
export const vcHistoryMarksNode = function (h: any, t: any, o: any) {
  const opts: any = o || {}
  const hitPath: string = String(opts.hitPath || '')
  const hasNote: boolean = opts.hasNote === true
  if (hitPath === '' && !hasNote) return null
  const kids: any[] = []
  if (hitPath !== '') {
    kids.push(h('span', {
      key: 'hit', className: 'chip chip-sm chip-info',
      'data-vc-history-hit': hitPath,
      'aria-label': t('vc.shell.history.hitTag', { name: hitPath }),
    }, t('vc.shell.history.hitTag', { name: vcHistoryNameOf(hitPath) })))
  }
  if (hasNote) {
    kids.push(h('span', {
      key: 'note', className: 'chip chip-sm chip-ok',
      'data-vc-history-note-tag': '1',
    }, t('vc.shell.history.noteTag')))
  }
  return h('span', { key: 'marks', className: 'commit-marks' }, kids)
}

/**
 * 列表页的头部三块：工具行（搜索框 + 范围切换）、范围行（只看合并 + 已加载条数 + 比较两个引用）、
 * 附加区（比较表单 / 比较结果头 / 只看某个文件）。列表正文由 vcHistory 自己画，这一叶只管这一段。
 */
export const vcHistoryToolsNode = function (h: any, t: any, o: any) {
  const opts: any = o || {}
  const model: any = opts.model || {}
  const ui: any = opts.ui || {}
  const scope: string = vcHistoryScopeOf(ui.historyScope)
  const query: string = String(ui.historyQuery || '')
  const mergeOnly: boolean = ui.historyMergeOnly === true
  const compareOpen: boolean = ui.historyCompareOpen === true
  // 两种范围各有自己的占位话术：读者一眼就能看出这次是在说明里找，还是在改到的文件里找。
  const placeholder: string = scope === 'code'
    ? t('vc.shell.history.searchPlaceholderCode')
    : t('vc.shell.history.searchPlaceholder', { n: String(model.loaded === undefined ? '' : model.loaded) })
  const tools: any[] = [
    h('input', {
      key: 'q', type: 'search', className: 'search-input', 'data-vc-history-query': '1',
      placeholder: placeholder, 'aria-label': placeholder,
      autoComplete: 'off', spellCheck: false, defaultValue: query,
    }),
    // 只看某个文件时这份读数里没有文件清单，代码范围那套按路径匹配没有依据，切了也不会有任何变化：
    //   这一格不画范围按钮，只留搜索框（按说明/作者在结果里筛）。
    String(ui.historyFileOnly || '') === '' ? vcHistoryScopeSwitchNode(h, t, { scope: scope }) : null,
  ]
  const row: any[] = [
    h('button', {
      key: 'merge', type: 'button', className: 'toggle-btn' + (mergeOnly ? ' is-on' : ''),
      'data-vc-history-merge-only': mergeOnly ? 'on' : 'off',
      'aria-pressed': mergeOnly ? 'true' : 'false',
      'data-press': 'button', 'data-log': 'vc.history.merge-only',
    }, t('vc.shell.history.mergeOnly')),
    h('span', { key: 'scope', className: 'history-scope', 'data-vc-history-scope': '1' }, String(opts.scopeText || '')),
    h('button', {
      key: 'compare', type: 'button', className: 'link-btn history-compare' + (compareOpen ? ' is-on' : ''),
      'data-vc-history-compare-open': '1',
      'aria-expanded': compareOpen ? 'true' : 'false',
      'data-press': 'button', 'data-log': 'vc.history.compare.open',
    }, t('vc.shell.history.compareOpen')),
  ]
  const out: any[] = [
    h('div', {
      key: 'tools', className: 'history-tools vcs-hist-tools',
      'data-vc-history': '1',
      'data-vc-history-state': model.state,
      'data-vc-history-count': String(model.loaded),
    }, tools),
    h('div', { key: 'row', className: 'history-scope-row' }, row),
  ]
  const extra: any = vcHistoryExtraNode(h, t, { ui: ui, reads: opts.reads })
  if (extra) out.push(extra)
  return out
}

export const VC_HISTORY_EXTRA_SOURCE = 'src/client/views/versionControl/vcHistoryExtra.ts'
