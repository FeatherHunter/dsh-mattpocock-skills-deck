// views/versionControl/vcChangesView.ts —— 改动页首屏（#1860 按定稿原型 62/63/65 重排）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回同一个闭包，跨叶用 declare。
//
// 这一叶只画改动页的上半页，版式照 docs/prototype/vc-redesign/src/ui/views/changes.ts：
//   三张统计卡（整卡可点，点了只看那一组，再点一次回到全部）、
//   分组（冲突 / 已暂存 / 未暂存；组头一行是标题 + 计数 + 整组动作，空组只写一句空态）、
//   文件行（状态徽章、目录与文件名分开、增删行数、暂存/取消暂存、行尾「⋯」更多菜单）、
//   行内确认卡与行内结果贴在这一行下面。底部提交区由页面壳挂 vcCommitPageNode。
// 动作全部复用容器现成的改动处理器 handlers.begin(op,{path})，界面不新增 git 能力、也不自己拼命令；
//   危险动作（丢弃、删除未跟踪文件）由处理器先出确认卡，这里只把卡画在行里。
// 展开与菜单用的是改动页的 values（openPath / menuPath），不另开一份容器状态：
//   页面切换后回到改动页，展开行与菜单自然复位到「都没开」，与原型「切走再回来保持滚动位置」不冲突。
// 行主体点开是逐行差异（#1860 D7）：首屏只带路径与增删行数，补丁按需向宿主读一次（wf.gitDiff，不带提交号
//   就是「工作区相对 HEAD」），读数住在容器的 reads.diffs 里，所以切走页签再回来还是那一份，不重发；
//   同一路径正在读或已经读到时不重复发（见 vcRealChangesHandlersOf 的 onOpen）。
//   差异块由 vcHistoryDetail 叶的 vcChangeFileDiffOf 画（与历史详情同一份读数形状、不同类名）。

declare function vcChangesOpMetaOf(op: any): any
declare function vcChangeFileDiffOf(h: any, t: any, o: any): any

// 差异缓存的键（#1860 D17）：同一个文件可能同时出现在「已暂存」与「未暂存」两组里，两行的补丁是两回事，
//   键必须带上是哪一组，否则两行会互相顶掉同一个读数。
export const vcChangesDiffKeyOf = function (row: any): string {
  return (row && row.staged === true ? 'staged:' : 'worktree:') + String((row && row.path) || '')
}
declare function vcChangesOpVerbKeyOf(op: any): string
declare function vcChangesTargetOf(op: any, values: any, t: any): string
declare function vcChangesRowKeyOf(op: any, payload: any): string

// 状态徽章的文字：六种文件变化各有自己的字母；进程内只有这一份映射。
export const VC_CHANGES_FILE_LETTERS: Record<string, string> = {
  added: 'A', modified: 'M', deleted: 'D', renamed: 'R', typechange: 'T', untracked: '?',
}
// 徽章与标签的色号：原型里每种变化有一种颜色，字母与词条都用同一套。
const VC_CHANGES_FILE_TONES: Record<string, string> = {
  added: 'add', modified: 'mod', deleted: 'del', renamed: 'rename', typechange: 'type', untracked: 'untracked',
}
const vcChangesFileToneOf = function (change: any): string {
  return VC_CHANGES_FILE_TONES[String(change || 'modified')] || 'mod'
}
const vcChangesFileLabelKeyOf = function (change: any): string { return 'vc.changes.view.' + String(change || 'modified') }
// 一行的「在哪个组」决定它的状态词：冲突优先，其次已暂存，再次未暂存。
const vcChangesRowStateKeyOf = function (row: any): string {
  if (row && row.conflict === true) return 'conflict'
  if (row && row.staged === true) return 'staged'
  return 'unstaged'
}

// 图标只这三颗：行尾箭头、禁用原因前的小感叹号、交给 AI 前的四角星。
//   与原型 dom.ts 的路径逐字相同；尺寸按调用处给，描边与圆角跟整页一致。
const VC_CHANGES_ICON_PATHS: Record<string, string> = {
  chevron: 'M6 9l6 6 6-6',
  alert: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18.5 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
}
const vcChangesIconOf = function (h: any, kind: string, size: number) {
  return h('svg', {
    key: 'icon-' + kind, viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
  }, h('path', { d: VC_CHANGES_ICON_PATHS[kind] || VC_CHANGES_ICON_PATHS.chevron }))
}

// 三张统计卡：整卡可点，点了就是筛选；再点一次回到全部。筛选值住在改动页的 values.filter 里，
//   与其它输入值同一条状态通路（容器不需要为筛选再加一份状态）。
const vcChangesStatOf = function (h: any, t: any, o: any) {
  const value = String(o.value || '')
  const active = String(o.filter || 'all') === value
  const tone = value === 'conflict' ? 'error' : (value === 'staged' ? 'ok' : 'mod')
  return h('button', {
    key: value, type: 'button', className: 'stat tone-' + tone + (active ? ' is-on' : ''), 'data-vc-stat': value,
    'aria-pressed': active ? 'true' : 'false', 'data-press': 'button', 'data-log': 'vc.changes.filter',
    title: t('vc.changes.view.statHint'),
    onClick: function () { if (typeof o.onFilter === 'function') o.onFilter(active ? 'all' : value) },
  }, [
    h('span', { key: 'n', className: 'stat-n' }, String(o.n === undefined || o.n === null ? 0 : o.n)),
    h('span', { key: 'label', className: 'stat-t' }, t('vc.changes.view.stat.' + value)),
  ])
}

// 行级确认卡：四段与动作面板同源（词条都在 vcchanges.yaml），版式是原型的贴行确认卡。
//   默认焦点在取消上；确认按钮带危险色，因为能走到这张卡的动作都会动文件。
const vcChangesFileConfirmNode = function (h: any, t: any, o: any) {
  const meta = o.meta
  const confirm = o.confirm || {}
  const handlers = o.handlers || {}
  const path = String(o.path || '')
  const target = vcChangesTargetOf(meta.op, { path: path }, t) || path
  const answer = meta.reversible ? t('vc.changes.confirm.reversibleYes') : t('vc.changes.confirm.reversibleNo')
  const verb = t(vcChangesOpVerbKeyOf(meta.op))
  const title = t('vc.changes.confirm.title', { verb: verb })
  return h('div', { key: 'confirm-' + String(meta.op), className: 'changes-confirm is-danger', 'data-vc-file-confirm': meta.op, role: 'group', 'aria-label': title }, [
    h('h3', { key: 'title', className: 'changes-confirm-title' }, title),
    h('p', { key: 'what', className: 'changes-confirm-body', 'data-vc-file-confirm-seg': 'what' }, t('vc.changes.confirm.what', { target: target })),
    h('p', { key: 'wont', className: 'changes-confirm-body', 'data-vc-file-confirm-seg': 'wont' }, t('vc.changes.confirm.wont')),
    h('p', { key: 'reversible', className: 'changes-confirm-meta', 'data-vc-file-confirm-seg': 'reversible' }, t('vc.changes.confirm.reversible', { answer: answer })),
    h('p', { key: 'verb', className: 'changes-confirm-body', 'data-vc-file-confirm-seg': 'verb' }, t('vc.changes.confirm.verb', { verb: verb })),
    h('div', { key: 'acts', className: 'changes-confirm-actions' }, [
      h('button', {
        key: 'cancel', type: 'button', className: 'btn btn-ghost btn-sm', 'data-vc-file-confirm-cancel': '1', 'data-focus-default': 'cancel',
        'data-press': 'button', 'data-log': 'vc.changes.file.confirm.cancel',
        onClick: function () { if (typeof handlers.cancel === 'function') handlers.cancel(meta.op, { path: path }) },
      }, t('vc.changes.confirm.cancel')),
      h('button', {
        key: 'go', type: 'button', className: 'btn btn-danger btn-sm', 'data-vc-file-confirm-go': '1',
        'data-press': 'button', 'data-log': 'vc.changes.file.confirm.go',
        onClick: function () { if (typeof handlers.run === 'function') handlers.run(meta.op, { path: path }, { ticketId: String(confirm.ticketId || ''), requestId: String(confirm.requestId || '') }) },
      }, t('vc.changes.confirm.go')),
    ]),
  ])
}

// 行级结果：成功给命令 / 耗时 / 对象数，失败给同源话术加 git 原话；都贴在这一行下面。
//   形态用原型的结果条（左侧一条彩边），不另造一套「行级结果」样式。
const vcChangesFileResultNode = function (h: any, t: any, o: any) {
  const meta = o.meta
  const result = o.result || {}
  const fail = result.ok === false
  const attrs: any = {
    key: 'result-' + String(meta.op), className: 'result ' + (fail ? 'result-error' : 'result-ok'),
    'data-vc-file-result': meta.op, 'data-vc-file-result-ok': fail ? '0' : '1',
  }
  attrs.role = fail ? 'alert' : 'status'
  const text = fail
    ? t('vc.changes.result.fail', { hint: t('vc.changes.result.failTitle'), git: String((result.error && result.error.message) || '') })
    : t('vc.changes.result.ok', { cmd: String(result.cmd || meta.op), ms: String(result.ms === undefined ? '' : result.ms), n: String(result.n === undefined ? 0 : result.n) })
  return h('div', attrs, [
    h('span', { key: 'tag', className: 'result-tag' }, t(fail ? 'vc.changes.result.failTitle' : 'vc.changes.result.okTitle')),
    h('span', { key: 'text', className: 'result-text' }, text),
  ])
}

// 一行的动作：主按钮是「暂存 / 取消暂存」，其余动作收在行尾「⋯」菜单里（原型就是这样）。
//   冲突行只有「暂存」；未跟踪文件的主按钮之外是「加入 .gitignore」「删除未跟踪文件」；
//   已跟踪的未暂存文件是「丢弃改动」。动作集合与旧行保持一致，不新增 git 能力。
const VC_CHANGES_ROW_ACTS: any = {
  'stage-file': ['vc.changes.view.stage', 'vc.changes.file.stage'],
  unstage: ['vc.changes.view.unstage', 'vc.changes.file.unstage'],
  'discard-file': ['vc.changes.view.menuDiscard', 'vc.changes.file.discard'],
  ignore: ['vc.changes.view.menuIgnore', 'vc.changes.file.ignore'],
  'clean-untracked': ['vc.changes.view.menuDelete', 'vc.changes.file.clean'],
}
const vcChangesRowPrimaryOpOf = function (row: any): string {
  return row && row.staged === true ? 'unstage' : 'stage-file'
}
const vcChangesRowMenuOpsOf = function (row: any): string[] {
  if (!row || row.conflict === true || row.staged === true) return []
  const untracked = String(row.change || '') === 'untracked'
  return untracked ? ['ignore', 'clean-untracked'] : ['discard-file']
}
const vcChangesRowStateOf = function (rows: any, op: string, path: string): any {
  return (rows && rows[vcChangesRowKeyOf(op, { path: path })]) || {}
}

// 一行文件：徽章 + 路径 + 变化词条 + 增删行数 + 主按钮 + 「⋯」；菜单、确认卡、结果、展开块都挂在 wrap 里。
const vcChangesFileRowNode = function (h: any, t: any, row: any, ctx: any) {
  const path = String(row.path || '')
  const change = String(row.change || 'modified')
  const rows: any = ctx.rows || {}
  const diffs: any = ctx.diffs || {}
  const handlers: any = ctx.handlers || {}
  const values: any = ctx.values || {}
  const onValue = function (field: string, value: any) { if (typeof handlers.onValue === 'function') handlers.onValue(field, value) }
  // 展开状态按「分组 + 路径」记（#1860 D17）：同一个文件被暂存之后换了一组、补丁也换了一份，
  //   若仍按裸路径记，那一行会保持展开却继续显示上一组读到的补丁。
  const openKey = vcChangesDiffKeyOf(row)
  const open = String(values.openPath || '') === openKey
  const menuOpen = String(values.menuPath || '') === path
  const primaryOp = vcChangesRowPrimaryOpOf(row)
  const menuOps: string[] = vcChangesRowMenuOpsOf(row)
  const primaryState: any = vcChangesRowStateOf(rows, primaryOp, path)
  const primaryPair: any = VC_CHANGES_ROW_ACTS[primaryOp] || [primaryOp, 'vc.changes.run']
  const slash = path.lastIndexOf('/')
  const dir = slash >= 0 ? path.slice(0, slash + 1) : ''
  const name = slash >= 0 ? path.slice(slash + 1) : path
  const tone = vcChangesFileToneOf(change)
  const statusText = t('vc.changes.view.stat.' + vcChangesRowStateKeyOf(row))
  const deltaKnown = row.addedLines !== null && row.addedLines !== undefined
  const extras: any[] = []
  if (change === 'untracked') extras.push(h('span', { key: 'untracked', className: 'chip chip-sm chip-untracked' }, t('vc.changes.view.untracked')))
  const kinds: any[] = [
    h('span', { key: 'badge', className: 'badge badge-' + tone, 'data-vc-file-change': change, 'aria-label': t(vcChangesFileLabelKeyOf(change)), title: t(vcChangesFileLabelKeyOf(change)) }, VC_CHANGES_FILE_LETTERS[change] || 'M'),
    h('span', { key: 'path', className: 'file-path' }, [
      h('span', { key: 'dir', className: 'file-dir' }, dir),
      h('span', { key: 'name', className: 'file-name' }, name),
    ]),
  ]
  if (extras.length > 0) kinds.push(h('span', { key: 'extras', className: 'file-extras' }, extras))
  if (deltaKnown) kinds.push(h('span', { key: 'delta', className: 'file-delta', 'data-vc-file-delta': '1' }, [
    h('span', { key: 'add', className: 'dl-add' }, '+' + String(row.addedLines)),
    h('span', { key: 'del', className: 'dl-del' }, '−' + String(row.deletedLines === null || row.deletedLines === undefined ? 0 : row.deletedLines)),
  ]))
  kinds.push(h('span', { key: 'chevron', className: 'row-chevron' + (open ? ' is-open' : '') }, vcChangesIconOf(h, 'chevron', 12)))
  const acts: any[] = [
    h('button', {
      key: 'primary', type: 'button', className: 'row-act', 'data-vc-file-op': primaryOp, 'data-vc-file-path': path,
      disabled: primaryState.busy === true || !!primaryState.confirm, 'data-press': 'button', 'data-log': primaryPair[1],
      onClick: function () { if (typeof handlers.begin === 'function') handlers.begin(primaryOp, { path: path }) },
    }, t(primaryPair[0])),
  ]
  if (menuOps.length > 0) {
    acts.push(h('button', {
      key: 'more', type: 'button', className: 'row-act row-more' + (menuOpen ? ' is-open' : ''), 'data-vc-file-menu': path,
      'aria-haspopup': 'menu', 'aria-expanded': menuOpen ? 'true' : 'false', 'aria-label': t('vc.changes.view.menuOpen'),
      title: t('vc.changes.view.menuOpen'), 'data-press': 'button', 'data-log': 'vc.changes.file.menu',
      onClick: function () { onValue('menuPath', menuOpen ? '' : path) },
    }, h('span', { key: 'dots', className: 'row-more-dots' }, '⋯')))
  }
  // 行主体就是「展开 / 收起」：点整行，或用键盘回车 / 空格。读差异由容器那一层发（界面不自己拼电话）。
  const toggle = function () { if (typeof handlers.onOpen === 'function') handlers.onOpen(path, row) }
  const rowKids: any[] = [
    h('div', {
      key: 'main', className: 'file-main', role: 'button', tabIndex: 0,
      'aria-expanded': open ? 'true' : 'false', 'aria-label': path + '：' + statusText,
      'data-vc-file-open': path, 'data-press': 'button', 'data-log': 'vc.changes.file.open', title: path,
      onClick: toggle,
      onKeyDown: function (ev: any) {
        const key: string = String((ev && ev.key) || '')
        if (key !== 'Enter' && key !== ' ') return
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault()
        toggle()
      },
    }, kinds),
    h('span', { key: 'acts', className: 'file-actions' }, acts),
  ]
  const wrapKids: any[] = [h('div', {
    key: 'row', className: 'file-row' + (row.conflict === true ? ' is-conflict' : '') + (open ? ' is-open' : ''),
    'data-vc-file-row': path, 'data-vc-file-change': change, 'data-vc-file-conflict': row.conflict === true ? '1' : '0',
  }, rowKids)]
  // 菜单：贴着「⋯」下方展开，条目带后果说明；点条目先收起菜单再发动作，避免菜单盖住确认卡。
  if (menuOpen) {
    wrapKids.push(h('div', { key: 'menu', className: 'row-menu', role: 'menu', 'aria-label': t('vc.changes.view.menuMore') }, menuOps.map(function (op: string) {
      const pair: any = VC_CHANGES_ROW_ACTS[op] || [op, 'vc.changes.run']
      const state: any = vcChangesRowStateOf(rows, op, path)
      const danger = op !== 'ignore'
      return h('button', {
        key: op, type: 'button', role: 'menuitem', className: 'row-menu-item' + (danger ? ' is-danger' : ''),
        disabled: state.busy === true, 'data-vc-file-op': op, 'data-vc-file-path': path, 'data-press': 'button', 'data-log': pair[1],
        onClick: function () {
          onValue('menuPath', '')
          if (typeof handlers.begin === 'function') handlers.begin(op, { path: path })
        },
      }, t(pair[0]))
    }).concat([h('button', {
      key: 'close', type: 'button', role: 'menuitem', className: 'row-menu-item is-close', 'data-vc-file-menu-close': path,
      'data-press': 'button', 'data-log': 'vc.changes.file.menu.close',
      onClick: function () { onValue('menuPath', '') },
    }, t('vc.changes.view.menuClose'))])))
  }
  // 展开块：这一行的补丁。读数没到就是「正在读」，读失败给重试，其余情形各说各的（见 vcChangeFileDiffOf）。
  if (open) {
    wrapKids.push(vcChangeFileDiffOf(h, t, {
      path: path, read: diffs[openKey] || null,
      onRetry: function () { if (typeof handlers.onDiffRetry === 'function') handlers.onDiffRetry(path, row) },
    }))
  }
  // 确认卡与结果按「哪颗按钮触发的」逐个画：同一行里两颗动作可以各有一张卡/一条结果，键带动作名以免撞 key。
  const allOps: string[] = [primaryOp].concat(menuOps)
  allOps.forEach(function (op: string) {
    const state: any = vcChangesRowStateOf(rows, op, path)
    if (state.confirm) {
      const meta: any = vcChangesOpMetaOf(op) || { op: op, dangerous: true, reversible: false }
      wrapKids.push(vcChangesFileConfirmNode(h, t, { meta: meta, confirm: state.confirm, path: path, handlers: handlers }))
    }
  })
  allOps.forEach(function (op: string) {
    const state: any = vcChangesRowStateOf(rows, op, path)
    if (state.result) wrapKids.push(vcChangesFileResultNode(h, t, { meta: { op: op }, result: state.result }))
  })
  return h('div', { key: path, className: 'file-row-wrap' }, wrapKids)
}

// 一组文件行：组头一行是标题、计数、整组动作；空组只写一句空态（与原型 renderGroup 相同）。
//   整组动作只给真正做得到的：已暂存组能全部取消暂存，未暂存组能全部暂存、能丢弃全部。
const vcChangesFileGroupOf = function (h: any, t: any, o: any) {
  const rows: any[] = Array.isArray(o.rows) ? o.rows : []
  const handlers: any = o.handlers || {}
  const begin = function (op: string) { if (typeof handlers.begin === 'function') handlers.begin(op, {}) }
  const actions: any[] = []
  if (o.id === 'staged' && rows.length > 0) {
    actions.push(h('button', {
      key: 'unstage-all', type: 'button', className: 'group-action', 'data-vc-file-group-all': 'unstage',
      'data-press': 'button', 'data-log': 'vc.changes.group.unstage',
      onClick: function () { rows.forEach(function (row: any) { if (typeof handlers.begin === 'function') handlers.begin('unstage', { path: String(row.path || '') }) }) },
    }, t('vc.changes.view.groupAllUnstage')))
  }
  if (o.id === 'unstaged' && rows.length > 0) {
    actions.push(h('button', {
      key: 'stage-all', type: 'button', className: 'group-action', 'data-vc-file-group-all': 'stage',
      'data-press': 'button', 'data-log': 'vc.changes.group.stage',
      onClick: function () { begin('stage-all') },
    }, t('vc.changes.view.groupAllStage')))
    actions.push(h('button', {
      key: 'discard-all', type: 'button', className: 'group-action is-danger', 'data-vc-file-group-all': 'discard',
      'data-press': 'button', 'data-log': 'vc.changes.group.discard',
      onClick: function () { begin('discard-all') },
    }, t('vc.changes.view.groupAllDiscard')))
  }
  // 空组只写一句空态、不画组头（原型 renderGroup 就是这么做的）：
  //   定稿截图 62 里空的「已暂存」组只有一行「还没有暂存的文件」，没有标题与数字。
  if (rows.length === 0) {
    return h('section', { key: o.id, className: 'group group-' + o.id, 'data-vc-file-group': o.id }, [
      h('div', { key: 'empty', className: 'group-empty', 'data-vc-file-group-empty': o.id }, h('span', { key: 'text', className: 'group-empty-text' }, t(o.emptyKey))),
    ])
  }
  const headKids: any[] = [
    h('span', { key: 'title', className: 'group-title' }, t(o.titleKey)),
    h('span', { key: 'count', className: 'group-count' }, String(rows.length)),
    h('div', { key: 'actions', className: 'group-actions' }, actions),
  ]
  const kids: any[] = [h('div', { key: 'head', className: 'group-head' }, headKids)]
  rows.forEach(function (row: any) { kids.push(vcChangesFileRowNode(h, t, row, o.ctx || {})) })
  return h('section', { key: o.id, className: 'group group-' + o.id, 'data-vc-file-group': o.id }, kids)
}

// 整页上半部分：统计卡 / 分组文件行。筛选只影响画出来的行，不改读数本身。
export const vcChangesViewNode = function (h: any, t: any, o: any) {
  const opts: any = o || {}
  const changes: any = opts.changes || {}
  const counts: any = changes.counts || {}
  const files: any = changes.files || {}
  const values: any = changes.values || {}
  const handlers: any = changes.handlers || {}
  const filter = String(values.filter || 'all')
  const stagedRows: any[] = Array.isArray(files.staged) ? files.staged : []
  const unstagedRows: any[] = Array.isArray(files.unstaged) ? files.unstaged : []
  const conflictRows: any[] = unstagedRows.filter(function (row: any) { return row && row.conflict === true })
  const plainUnstaged: any[] = unstagedRows.filter(function (row: any) { return !row || row.conflict !== true })
  const onFilter = function (next: any) { if (typeof handlers.onValue === 'function') handlers.onValue('filter', String(next)) }
  const ctx: any = { rows: changes.rows || {}, diffs: changes.diffs || {}, handlers: handlers, values: values }
  const known: boolean = Number(counts.staged || 0) + Number(counts.unstaged || 0) + Number(counts.untracked || 0) + Number(counts.conflicts || 0) > 0
  const kids: any[] = [
    h('div', { key: 'stats', className: 'stats', 'data-vc-changes-stats': '1' }, [
      vcChangesStatOf(h, t, { value: 'conflict', n: counts.conflicts, filter: filter, onFilter: onFilter }),
      vcChangesStatOf(h, t, { value: 'staged', n: counts.staged, filter: filter, onFilter: onFilter }),
      vcChangesStatOf(h, t, { value: 'unstaged', n: counts.unstaged, filter: filter, onFilter: onFilter }),
    ]),
  ]
  const scrollKids: any[] = []
  if (changes.state === 'error') scrollKids.push(h('p', { key: 'error', className: 'changes-note', role: 'alert', 'data-vc-file-error': '1' }, String(changes.errorText || t('vc.changes.result.failTitle'))))
  // 空仓与「没有改动」是两种状态（票面验收④）：仓库一次提交都还没有时给专属空态，别让人以为改动被弄丢了。
  else if (changes.repoEmpty === true && stagedRows.length === 0 && unstagedRows.length === 0) scrollKids.push(h('div', { key: 'empty-repo', className: 'empty', 'data-vc-file-list-empty': '1', 'data-vc-file-list-empty-repo': '1' }, [
    h('div', { key: 'title', className: 'empty-title' }, t('vc.changes.view.emptyRepo')),
  ]))
  else if (!known && stagedRows.length === 0 && unstagedRows.length === 0) scrollKids.push(h('div', { key: 'empty', className: 'empty', 'data-vc-file-list-empty': '1' }, [
    h('div', { key: 'title', className: 'empty-title' }, t('vc.changes.view.emptyUnstaged')),
  ]))
  // 分组顺序照原型：先冲突（有才画），再已暂存，最后未暂存；筛选命中哪一组就只画哪一组。
  if ((filter === 'all' || filter === 'conflict') && (conflictRows.length > 0 || filter === 'conflict')) {
    scrollKids.push(vcChangesFileGroupOf(h, t, { id: 'conflict', titleKey: 'vc.changes.view.groupTitleConflict', emptyKey: 'vc.changes.view.emptyConflicts', rows: conflictRows, handlers: handlers, ctx: ctx }))
  }
  if (filter === 'all' || filter === 'staged') scrollKids.push(vcChangesFileGroupOf(h, t, { id: 'staged', titleKey: 'vc.changes.view.groupTitleStaged', emptyKey: 'vc.changes.view.emptyStaged', rows: stagedRows, handlers: handlers, ctx: ctx }))
  if (filter === 'all' || filter === 'unstaged') scrollKids.push(vcChangesFileGroupOf(h, t, { id: 'unstaged', titleKey: 'vc.changes.view.groupTitleUnstaged', emptyKey: 'vc.changes.view.emptyUnstaged', rows: plainUnstaged, handlers: handlers, ctx: ctx }))
  kids.push(h('div', { key: 'scroll', className: 'changes-scroll' }, scrollKids))
  return h('div', { className: 'view view-changes', 'data-vc-changes-view': '1', 'data-vc-changes-filter': filter }, kids)
}
