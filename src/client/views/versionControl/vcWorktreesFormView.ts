// src/client/views/versionControl/vcWorktreesFormView.ts —— 工作区页三张就地表单与结果条（#1904 从 vcWorktreesView 拆出）
//
// 为什么拆：工作区页版式叶子加上这三张表单后超过 350 有效行上限；表单的 DOM 与事件都在这一叶里，
//   版式叶子只负责把它们放到「页底 / 展开行」的位置（原型 93–97）。
// 约定：所有可见文字走 t(词条)，真源 config/copy/vcworktrees.yaml；按钮只调处理层的表单动作，
//   本文件不发电话、不存状态。
//
// 下面这些名字在构建后的闭包里真实存在（另有同名声明与它们对上），本文件单独过 tsc 时靠 declare 补形状。
declare function vcWtViewStr(v: any): string
declare function vcWorktreeCall(ops: any, name: string, args?: any[]): any
declare function vcShellStateNode(h: any, t: any, o: any): any

/** 这份文件的出处：排查时凭它找到这份文件。 */
export const VC_WORKTREES_FORM_VIEW_SOURCE: string = 'src/client/views/versionControl/vcWorktreesFormView.ts'

/** 表单错误：键 + 参数翻成人话；没有错误时回空串（渲染处据此不画那一行）。 */
const vcWtFormErrorTextOf = function (t: any, error: any): string {
  if (!error || vcWtViewStr(error.key) === '') return ''
  return t(String(error.key), error.params || {})
}

/** 结果条的正文：文字用 textKey，细节优先 detailKey；稀疏规则要把目录数组按语言分隔符拼起来。 */
const vcWtResultTextOf = function (t: any, r: any): string {
  if (!r || vcWtViewStr(r.textKey) === '') return ''
  const params: any = Object.assign({}, r.textParams || {})
  const dirs: string[] = Array.isArray(r.dirs) ? r.dirs : []
  if (dirs.length > 0) params.dirs = dirs.join(String(t('vc.wt.listSep')))
  return t(String(r.textKey), params)
}

const vcWtResultDetailOf = function (t: any, r: any): string {
  if (!r) return ''
  if (vcWtViewStr(r.detailKey) !== '') return t(String(r.detailKey), r.detailParams || {})
  return vcWtViewStr(r.detailText)
}

/**
 * 页底「新建工作区」表单：目录 + 分支来源（新建分支 / 已有分支）。
 * 表单错误画在自己的 wt-form-error 里（role=alert），不写页面底部结果条——填错时要改的是这张表。
 */
const vcWtCreateFormNode = function (h: any, t: any, model: any, ui: any, ops: any): any {
  const create: any = ui.create || {}
  const mode: string = create.mode === 'existing' ? 'existing' : 'new'
  const busy: boolean = ui.mode === 'checking' || ui.mode === 'running'
  const pathInput: any = h('input', {
    key: 'path-input', type: 'text', id: 'wt-create-path', className: 'wt-input',
    placeholder: t('vc.wt.create.pathPlaceholder'), 'aria-label': t('vc.wt.create.path'),
    autocomplete: 'off', spellcheck: 'false', value: vcWtViewStr(create.path),
    'data-wt-create-path': '1', 'data-focus-key': 'wt-create-path',
    onChange: function (ev: any) { vcWorktreeCall(ops, 'createField', ['path', ev && ev.target ? ev.target.value : '']) },
  })
  const branchInput: any = h('input', {
    key: 'branch-input', type: 'text', id: 'wt-create-branch', className: 'wt-input',
    placeholder: t('vc.wt.create.branchPlaceholder'), 'aria-label': t('vc.wt.create.branch'),
    autocomplete: 'off', spellcheck: 'false', value: vcWtViewStr(create.branch),
    'data-wt-create-branch-input': '1', 'data-focus-key': 'wt-create-branch',
    onChange: function (ev: any) { vcWorktreeCall(ops, 'createField', ['branch', ev && ev.target ? ev.target.value : '']) },
  })
  const modeNode = function (value: string, label: string): any {
    const on: boolean = mode === value
    return h('button', {
      key: 'mode-' + value, type: 'button', className: 'wt-mode' + (on ? ' is-on' : ''),
      'aria-pressed': on ? 'true' : 'false', 'data-wt-create-mode': value, 'data-press': 'button', 'data-log': 'vc.wt.create.mode',
      onClick: function () { vcWorktreeCall(ops, 'createMode', [value]) },
    }, label)
  }
  const recentNames: string[] = Array.isArray(model.recentBranches) ? model.recentBranches : []
  const recent: any = mode === 'existing' && recentNames.length > 0
    ? h('div', { key: 'recent', className: 'wt-recent', 'data-wt-create-recent': '1' }, [
      h('span', { key: 'lead', className: 'wt-recent-lead' }, t('vc.wt.create.recent')),
      ...recentNames.map(function (name: string): any {
        return h('button', {
          key: 'recent-' + name, type: 'button', className: 'wt-recent-chip' + (vcWtViewStr(create.branch) === name ? ' is-on' : ''),
          title: name, 'data-wt-create-branch-chip': name, 'data-press': 'button', 'data-log': 'vc.wt.create.branch',
          onClick: function () { vcWorktreeCall(ops, 'createPickBranch', [name]) },
        }, name)
      }),
    ])
    : null
  const errorText: string = vcWtFormErrorTextOf(t, create.error)
  const kids: any[] = [
    h('h4', { key: 'title', className: 'wt-form-title' }, t('vc.wt.create.title')),
    h('label', { key: 'path', className: 'wt-field' }, [
      h('span', { key: 'k', className: 'wt-field-k' }, t('vc.wt.create.path')),
      pathInput,
    ]),
    h('div', { key: 'branch', className: 'wt-field' }, [
      h('span', { key: 'k', className: 'wt-field-k' }, t('vc.wt.create.branch')),
      h('div', { key: 'modes', className: 'wt-modes', role: 'group', 'aria-label': t('vc.wt.create.branch') }, [
        modeNode('new', t('vc.wt.create.modeNew')),
        modeNode('existing', t('vc.wt.create.modeExisting')),
      ]),
      branchInput,
      recent,
    ]),
    h('p', { key: 'hint', className: 'wt-form-hint' }, t(mode === 'new' ? 'vc.wt.create.hintNew' : 'vc.wt.create.hintExisting')),
    errorText === '' ? null : h('p', { key: 'error', className: 'wt-form-error', role: 'alert', 'data-wt-create-error': '1' }, errorText),
    h('div', { key: 'actions', className: 'wt-form-actions' }, [
      h('button', {
        key: 'cancel', type: 'button', className: 'btn btn-ghost btn-sm', disabled: busy,
        'data-wt-create-close': '1', 'data-press': 'button', 'data-log': 'vc.wt.create.close',
        onClick: function () { vcWorktreeCall(ops, 'createClose') },
      }, t('vc.wt.create.cancel')),
      h('button', {
        key: 'submit', type: 'button', className: 'btn btn-secondary btn-sm', disabled: busy,
        'data-wt-create-submit': '1', 'data-press': 'button', 'data-log': 'vc.wt.create.submit',
        onClick: function () { vcWorktreeCall(ops, 'createSubmit') },
      }, t('vc.wt.create.submit')),
    ]),
  ]
  return h('div', { key: 'create-form', className: 'wt-form wt-create', role: 'group', 'aria-label': t('vc.wt.create.title'), 'data-wt-create-form': '1' }, kids)
}

/** 移动工作区：只填一个新目录，输入框预填当前路径（原型 95）。 */
const vcWtMoveFormNode = function (h: any, t: any, row: any, ui: any, ops: any): any {
  const move: any = ui.move || {}
  const busy: boolean = ui.mode === 'checking' || ui.mode === 'running'
  const rawPath: string = vcWtViewStr(row.path)
  const path: string = rawPath === '' ? vcWtViewStr(row.display) : rawPath
  return h('div', { key: 'move-form', className: 'wt-form wt-move', role: 'group', 'aria-label': t('vc.wt.move.title'), 'data-wt-move-form': path }, [
    h('h4', { key: 'title', className: 'wt-form-title' }, t('vc.wt.move.title')),
    h('label', { key: 'field', className: 'wt-field' }, [
      h('span', { key: 'k', className: 'wt-field-k' }, t('vc.wt.move.label')),
      h('input', {
        key: 'input', type: 'text', className: 'wt-input', 'aria-label': t('vc.wt.move.label'),
        autocomplete: 'off', spellcheck: 'false', value: vcWtViewStr(move.draft),
        'data-wt-move-input': '1', 'data-focus-key': 'wt-move:' + path,
        onChange: function (ev: any) { vcWorktreeCall(ops, 'moveDraft', [ev && ev.target ? ev.target.value : '']) },
      }),
    ]),
    h('p', { key: 'hint', className: 'wt-form-hint' }, t('vc.wt.move.hint')),
    h('div', { key: 'actions', className: 'wt-form-actions' }, [
      h('button', {
        key: 'cancel', type: 'button', className: 'btn btn-ghost btn-sm', disabled: busy,
        'data-wt-move-close': '1', 'data-press': 'button', 'data-log': 'vc.wt.move.close',
        onClick: function () { vcWorktreeCall(ops, 'moveClose') },
      }, t('vc.wt.create.cancel')),
      h('button', {
        key: 'save', type: 'button', className: 'btn btn-secondary btn-sm', disabled: busy,
        'data-wt-move-save': '1', 'data-press': 'button', 'data-log': 'vc.wt.move.save',
        onClick: function () { vcWorktreeCall(ops, 'moveSave') },
      }, t('vc.wt.move.submit')),
    ]),
  ])
}

/**
 * 稀疏检出面板（原型 96）：勾顶层目录，勾上的才会检出到磁盘。
 * 打开时先预检一次，把当前规则与候选目录一起拿到；勾选只改本地读数，点保存才发写电话。
 */
const vcWtSparsePanelNode = function (h: any, t: any, row: any, ui: any, ops: any): any {
  const sparse: any = ui.sparse || {}
  const rawPath: string = vcWtViewStr(row.path)
  const path: string = rawPath === '' ? vcWtViewStr(row.display) : rawPath
  const chosen: string[] = Array.isArray(ui.input && ui.input.dirs) ? ui.input.dirs : []
  const candidates: string[] = Array.isArray(sparse.candidates) ? sparse.candidates : []
  const loading: boolean = ui.mode === 'checking' || ui.mode === 'running'
  const dirs: any[] = candidates.map(function (dir: string): any {
    const on: boolean = chosen.indexOf(dir) >= 0
    return h('button', {
      key: 'dir-' + dir, type: 'button', className: 'wt-dir' + (on ? ' is-on' : ''),
      'aria-pressed': on ? 'true' : 'false',
      title: on ? t('vc.wt.sparse.unkeep', { dir: dir }) : t('vc.wt.sparse.keep', { dir: dir }),
      'data-wt-sparse-dir': dir, 'data-press': 'button', 'data-log': 'vc.wt.sparse.toggle',
      onClick: function () { vcWorktreeCall(ops, 'sparseToggle', [dir, !on]) },
    }, [
      h('span', { key: 'box', className: 'wt-dir-box', 'aria-hidden': 'true' }, on ? '✓' : ''),
      h('span', { key: 'name', className: 'mono' }, dir),
    ])
  })
  const kids: any[] = [
    h('h4', { key: 'title', className: 'wt-form-title' }, t('vc.wt.sparse.title')),
    h('p', { key: 'hint', className: 'wt-form-hint' }, t('vc.wt.sparse.hint')),
  ]
  if (loading) kids.push(vcShellStateNode(h, t, { state: 'loading' }))
  else if (dirs.length === 0) kids.push(h('p', { key: 'none', className: 'wt-form-hint' }, t('vc.wt.sparse.noDirs')))
  else kids.push(h('div', { key: 'dirs', className: 'wt-dirs', role: 'group', 'aria-label': t('vc.wt.sparse.title') }, dirs))
  kids.push(h('div', { key: 'actions', className: 'wt-form-actions' }, [
    h('button', {
      key: 'cancel', type: 'button', className: 'btn btn-ghost btn-sm', disabled: loading,
      'data-wt-sparse-close': '1', 'data-press': 'button', 'data-log': 'vc.wt.sparse.close',
      onClick: function () { vcWorktreeCall(ops, 'sparseClose') },
    }, t('vc.wt.sparse.cancel')),
    h('button', {
      key: 'save', type: 'button', className: 'btn btn-secondary btn-sm', disabled: loading,
      'data-wt-sparse-save': '1', 'data-press': 'button', 'data-log': 'vc.wt.sparse.save',
      onClick: function () { vcWorktreeCall(ops, 'sparseSave') },
    }, t('vc.wt.sparse.save')),
  ]))
  return h('div', { key: 'sparse-form', className: 'wt-form wt-sparse', role: 'group', 'aria-label': t('vc.wt.sparse.title'), 'data-wt-sparse-form': path }, kids)
}

/** 结果条：原型 97 的页底一条，来源标记 + 主句 + 可选细节 + 关闭键。 */
const vcWtResultBannerNode = function (h: any, t: any, result: any, ops: any): any {
  if (!result) return null
  const tone: string = result.tone === 'error' ? 'error' : (result.tone === 'warn' ? 'warn' : 'ok')
  const text: string = vcWtResultTextOf(t, result)
  const detail: string = vcWtResultDetailOf(t, result)
  const kids: any[] = [
    h('span', { key: 'tag', className: 'result-tag' }, t('vc.wt.result.tag')),
    h('span', { key: 'text', className: 'result-text', 'data-wt-result-text': '1' }, text),
  ]
  if (detail !== '') kids.push(h('span', { key: 'detail', className: 'result-detail', 'data-wt-result-detail': '1' }, detail))
  kids.push(h('button', {
    key: 'close', type: 'button', className: 'result-close',
    'aria-label': t('vc.wt.result.close'), title: t('vc.wt.result.close'),
    'data-wt-result-close': '1', 'data-press': 'button', 'data-log': 'vc.wt.result.close',
    onClick: function () { vcWorktreeCall(ops, 'resultDismiss') },
  }, t('vc.wt.result.closeGlyph')))
  return h('div', {
    key: 'result', className: 'result result-' + tone,
    role: tone === 'error' ? 'alert' : 'status', 'aria-live': 'polite', 'data-wt-result': tone,
  }, kids)
}
