// views/versionControl/vcChangesView.ts —— 改动页首屏：统计卡 + 分组文件行 + 行内动作（#1829）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回同一个闭包，跨叶用 declare。
//
// 这一叶只画定稿原型 docs/prototype/vc-redesign/screenshots/62-changes-460.png 的上半页：
//   三张统计卡（存在冲突 / 已暂存 / 未暂存，点一下就是筛选）、
//   两组文件行（已暂存 / 未暂存，冲突行带冲突标记）、
//   每行右侧是真实动作按钮（暂存 / 取消暂存 / 丢弃 / 加入忽略清单 / 删除未跟踪文件），
//   行级确认卡与结果就贴在这一行下面（结果贴触发点）。底部提交区由页面壳挂 vcCommitPageNode。
// 所有动作都复用容器现成的改动处理器 handlers.begin(op,{path})，不新增 git 能力、也不自己拼命令；
//   危险动作（丢弃、删除未跟踪文件）由处理器先出确认卡，这里只把确认卡画在行里。
// 文件行读数来自首屏 changes 片的 staged / unstaged 两个数组；一个文件同时有两边状态时会在两组各出现一行，
//   这正对应原型的两组——去重交给宿主读数，界面不自己合并。

declare function vcChangesOpMetaOf(op: any): any
declare function vcChangesOpVerbKeyOf(op: any): string
declare function vcChangesTargetOf(op: any, values: any, t: any): string
declare function vcChangesRowKeyOf(op: any, payload: any): string

// 状态徽章的文字：六种文件变化各有自己的字母与词条；进程内只有这一份映射。
export const VC_CHANGES_FILE_LETTERS: Record<string, string> = {
  added: 'A', modified: 'M', deleted: 'D', renamed: 'R', typechange: 'T', untracked: '?',
}
const vcChangesFileLabelKeyOf = function (change: any): string { return 'vc.changes.view.' + String(change || 'modified') }

// 三张统计卡：整卡可点，点了就是筛选；再点一次回到全部。筛选值住在改动页的 values.filter 里，
//   与其它输入值同一条状态通路（容器不需要为筛选再加一份状态）。
const vcChangesStatOf = function (h: any, t: any, o: any) {
  const value = String(o.value || '')
  const active = String(o.filter || 'all') === value
  const attrs: any = {
    key: value, type: 'button', className: 'vcs-stat vcs-stat-' + value, 'data-vc-stat': value,
    'aria-pressed': active ? 'true' : 'false', 'data-press': 'button', 'data-log': 'vc.changes.filter',
  }
  attrs.onClick = function () { if (typeof o.onFilter === 'function') o.onFilter(active ? 'all' : value) }
  return h('button', attrs, [
    h('span', { key: 'n', className: 'vcs-stat-n' }, String(o.n === undefined || o.n === null ? 0 : o.n)),
    h('span', { key: 'label', className: 'vcs-stat-label' }, t('vc.changes.view.stat.' + value)),
  ])
}

// 行级确认卡：四段与旧动作面板同源（词条都在 vcchanges.yaml），默认焦点在取消上。
const vcChangesFileConfirmNode = function (h: any, t: any, o: any) {
  const meta = o.meta
  const confirm = o.confirm || {}
  const handlers = o.handlers || {}
  const path = String(o.path || '')
  const target = vcChangesTargetOf(meta.op, { path: path }, t) || path
  const answer = meta.reversible ? t('vc.changes.confirm.reversibleYes') : t('vc.changes.confirm.reversibleNo')
  const verb = t(vcChangesOpVerbKeyOf(meta.op))
  return h('div', { key: 'confirm-' + String(meta.op), className: 'vcs-file-confirm', 'data-vc-file-confirm': meta.op, role: 'dialog', 'aria-modal': 'false' }, [
    h('p', { key: 'title', className: 'vcs-file-confirm-title' }, t('vc.changes.confirm.title', { verb: verb })),
    h('p', { key: 'what', className: 'vcs-file-confirm-seg', 'data-vc-file-confirm-seg': 'what' }, t('vc.changes.confirm.what', { target: target })),
    h('p', { key: 'wont', className: 'vcs-file-confirm-seg', 'data-vc-file-confirm-seg': 'wont' }, t('vc.changes.confirm.wont')),
    h('p', { key: 'reversible', className: 'vcs-file-confirm-seg', 'data-vc-file-confirm-seg': 'reversible' }, t('vc.changes.confirm.reversible', { answer: answer })),
    h('p', { key: 'verb', className: 'vcs-file-confirm-seg', 'data-vc-file-confirm-seg': 'verb' }, t('vc.changes.confirm.verb', { verb: verb })),
    h('div', { key: 'acts', className: 'vcs-file-confirm-acts' }, [
      h('button', {
        key: 'cancel', type: 'button', className: 'vcs-file-confirm-cancel', 'data-vc-file-confirm-cancel': '1', 'data-focus-default': 'cancel',
        'data-press': 'button', 'data-log': 'vc.changes.file.confirm.cancel',
        onClick: function () { if (typeof handlers.cancel === 'function') handlers.cancel(meta.op, { path: path }) },
      }, t('vc.changes.confirm.cancel')),
      h('button', {
        key: 'go', type: 'button', className: 'vcs-file-confirm-go', 'data-vc-file-confirm-go': '1',
        'data-press': 'button', 'data-log': 'vc.changes.file.confirm.go',
        onClick: function () { if (typeof handlers.run === 'function') handlers.run(meta.op, { path: path }, { ticketId: String(confirm.ticketId || ''), requestId: String(confirm.requestId || '') }) },
      }, t('vc.changes.confirm.go')),
    ]),
  ])
}

// 行级结果：成功给命令 / 耗时 / 对象数，失败给同源话术加 git 原话；都贴在这一行下面。
const vcChangesFileResultNode = function (h: any, t: any, o: any) {
  const meta = o.meta
  const result = o.result || {}
  const fail = result.ok === false
  const attrs: any = { key: 'result-' + String(meta.op), className: 'vcs-file-result vcs-file-result-' + (fail ? 'fail' : 'ok'), 'data-vc-file-result': meta.op, 'data-vc-file-result-ok': fail ? '0' : '1' }
  attrs.role = fail ? 'alert' : 'status'
  const text = fail
    ? t('vc.changes.result.fail', { hint: t('vc.changes.result.failTitle'), git: String((result.error && result.error.message) || '') })
    : t('vc.changes.result.ok', { cmd: String(result.cmd || meta.op), ms: String(result.ms === undefined ? '' : result.ms), n: String(result.n === undefined ? 0 : result.n) })
  return h('p', attrs, text)
}

// 一行的动作组：按「这一行在哪个组」决定给哪几颗按钮；每颗都是真按钮，点了就发预检电话。
//   忙 / 确认都按「动作|路径」各自的键取（vcChangesRowKeyOf）：同一行里暂存与丢弃各有一份状态，
//   确认卡打开时同一颗按钮也不会重复发预检。#1829 审查曾发现这里按固定动作取键，导致丢弃 / 忽略 /
//   删除未跟踪三颗按钮的确认卡与结果永远画不出来——那三颗其实一次都没执行过。
const vcChangesFileOpsOf = function (row: any): string[] {
  const conflict = row.conflict === true
  const untracked = String(row.change || '') === 'untracked'
  if (conflict) return ['stage-file']
  if (row.unstaged === true) return untracked ? ['stage-file', 'ignore', 'clean-untracked'] : ['stage-file', 'discard-file']
  if (row.staged === true) return ['unstage']
  return []
}

// 每颗行内按钮的词条与日志名：进程内只这一份映射，加动作时在这里补一行。
const VC_CHANGES_FILE_ACTS: any = {
  'stage-file': ['vc.changes.view.stage', 'vc.changes.file.stage'],
  unstage: ['vc.changes.view.unstage', 'vc.changes.file.unstage'],
  'discard-file': ['vc.changes.view.discard', 'vc.changes.file.discard'],
  ignore: ['vc.changes.view.ignore', 'vc.changes.file.ignore'],
  'clean-untracked': ['vc.changes.view.clean', 'vc.changes.file.clean'],
}

const vcChangesFileActsOf = function (h: any, t: any, ops: string[], states: any, handlers: any, path: string) {
  return ops.map(function (op: string) {
    const state: any = states[op] || {}
    const pair: any = VC_CHANGES_FILE_ACTS[op] || [op, 'vc.changes.run']
    return h('button', {
      key: op, type: 'button', className: 'vcs-file-go vcs-file-go-' + op,
      'data-vc-file-op': op, 'data-vc-file-path': path, disabled: state.busy === true || !!state.confirm,
      'data-press': 'button', 'data-log': pair[1],
      onClick: function () { if (typeof handlers.begin === 'function') handlers.begin(op, { path: path }) },
    }, t(pair[0]))
  })
}
// 一行文件：状态徽章、路径（目录 + 文件名分行读得出）、增删行数、动作组；确认卡与结果贴在这一行里。
const vcChangesFileRowNode = function (h: any, t: any, row: any, ctx: any) {
  const path = String(row.path || '')
  const change = String(row.change || 'modified')
  const ops: string[] = vcChangesFileOpsOf(row)
  const states: any = {}
  ops.forEach(function (op: string) { states[op] = (ctx.rows && ctx.rows[vcChangesRowKeyOf(op, { path: path })]) || {} })
  const slash = path.lastIndexOf('/')
  const dir = slash >= 0 ? path.slice(0, slash + 1) : ''
  const name = slash >= 0 ? path.slice(slash + 1) : path
  const badge = VC_CHANGES_FILE_LETTERS[change] || 'M'
  const delta = row.addedLines === null || row.addedLines === undefined ? '' : t('vc.changes.view.delta', { added: String(row.addedLines), deleted: String(row.deletedLines === null || row.deletedLines === undefined ? 0 : row.deletedLines) })
  const kids: any[] = [
    h('div', { key: 'main', className: 'vcs-file-main' }, [
      h('span', { key: 'badge', className: 'vcs-file-badge', 'data-vc-file-change': change }, badge),
      h('span', { key: 'path', className: 'vcs-file-path' }, [
        h('span', { key: 'dir', className: 'vcs-file-dir' }, dir),
        h('span', { key: 'name', className: 'vcs-file-name' }, name),
      ]),
      delta === '' ? null : h('span', { key: 'delta', className: 'vcs-file-delta', 'data-vc-file-delta': '1' }, delta),
      h('span', { key: 'acts', className: 'vcs-file-acts' }, vcChangesFileActsOf(h, t, ops, states, ctx.handlers || {}, path)),
    ]),
  ]
  if (row.conflict === true) kids.push(h('p', { key: 'conflict-note', className: 'vcs-file-note' }, t('vc.changes.view.conflictsNote')))
  // 确认卡与结果按「哪颗按钮触发的」逐个画：四段与「能不能回来」都取动作自己的定义（vcChangesOpMetaOf），
  //   不在这里另抄一份；同一行里两颗动作可以各有一张卡/一条结果，键带动作名以免撞 key。
  ops.forEach(function (op: string) {
    const state: any = states[op] || {}
    if (state.confirm) {
      const meta: any = vcChangesOpMetaOf(op) || { op: op, dangerous: true, reversible: false }
      kids.push(vcChangesFileConfirmNode(h, t, { meta: meta, confirm: state.confirm, path: path, handlers: ctx.handlers || {} }))
    }
  })
  ops.forEach(function (op: string) {
    const state: any = states[op] || {}
    if (state.result) kids.push(vcChangesFileResultNode(h, t, { meta: { op: op }, result: state.result }))
  })
  return h('li', {
    key: path, className: 'vcs-file-row', 'data-vc-file-row': path,
    'data-vc-file-change': change, 'data-vc-file-conflict': row.conflict === true ? '1' : '0',
  }, kids)
}

// 一组文件行：组标题带计数与空态（原型里「还没有暂存的任何文件」就是这一句）。
const vcChangesFileGroupOf = function (h: any, t: any, o: any) {
  const rows: any[] = Array.isArray(o.rows) ? o.rows : []
  const kids: any[] = [
    h('h4', { key: 'title', className: 'vcs-file-group-title' }, [
      h('span', { key: 'label' }, t(o.titleKey, { n: rows.length })),
    ]),
  ]
  if (rows.length === 0) kids.push(h('p', { key: 'empty', className: 'vcs-file-group-empty', 'data-vc-file-group-empty': o.id }, t(o.emptyKey)))
  else kids.push(h('ul', { key: 'rows', className: 'vcs-file-rows' }, rows.map(function (row: any) { return vcChangesFileRowNode(h, t, row, o.ctx || {}) })))
  return h('section', { key: o.id, className: 'vcs-file-group', 'data-vc-file-group': o.id }, kids)
}

// 整页上半部分：读数 / 统计卡 / 两组文件行。筛选只影响画出来的行，不改读数本身。
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
  const stats: any[] = [
    vcChangesStatOf(h, t, { value: 'conflict', n: counts.conflicts, filter: filter, onFilter: onFilter }),
    vcChangesStatOf(h, t, { value: 'staged', n: counts.staged, filter: filter, onFilter: onFilter }),
    vcChangesStatOf(h, t, { value: 'unstaged', n: counts.unstaged, filter: filter, onFilter: onFilter }),
  ]
  const ctx: any = { rows: changes.rows || {}, handlers: handlers }
  const known: boolean = Number(counts.staged || 0) + Number(counts.unstaged || 0) + Number(counts.untracked || 0) + Number(counts.conflicts || 0) > 0
  const kids: any[] = [
    h('div', { key: 'stats', className: 'vcs-stats', 'data-vc-changes-stats': '1' }, stats),
  ]
  if (changes.state === 'error') kids.push(h('p', { key: 'error', className: 'vcs-file-error', role: 'alert', 'data-vc-file-error': '1' }, String(changes.errorText || t('vc.changes.result.failTitle'))))
  // 空仓与「没有改动」是两种状态（票面验收④）：仓库一次提交都还没有时给专属空态，别让人以为改动被弄丢了。
  else if (changes.repoEmpty === true && stagedRows.length === 0 && unstagedRows.length === 0) kids.push(h('p', { key: 'empty-repo', className: 'vcs-file-empty', 'data-vc-file-list-empty': '1', 'data-vc-file-list-empty-repo': '1' }, t('vc.changes.view.emptyRepo')))
  else if (!known && stagedRows.length === 0 && unstagedRows.length === 0) kids.push(h('p', { key: 'empty', className: 'vcs-file-empty', 'data-vc-file-list-empty': '1' }, t('vc.changes.view.emptyUnstaged')))
  if (filter === 'all' || filter === 'staged') kids.push(vcChangesFileGroupOf(h, t, { id: 'staged', titleKey: 'vc.changes.view.groupStaged', emptyKey: 'vc.changes.view.emptyStaged', rows: stagedRows, ctx: ctx }))
  if (filter === 'all' || filter === 'unstaged') {
    kids.push(vcChangesFileGroupOf(h, t, { id: 'unstaged', titleKey: 'vc.changes.view.groupUnstaged', emptyKey: 'vc.changes.view.emptyUnstaged', rows: plainUnstaged, ctx: ctx }))
    if (conflictRows.length > 0) kids.push(vcChangesFileGroupOf(h, t, { id: 'conflict', titleKey: 'vc.changes.view.groupConflict', emptyKey: 'vc.changes.view.emptyConflicts', rows: conflictRows, ctx: ctx }))
  }
  if (filter === 'conflict') kids.push(vcChangesFileGroupOf(h, t, { id: 'conflict', titleKey: 'vc.changes.view.groupConflict', emptyKey: 'vc.changes.view.emptyConflicts', rows: conflictRows, ctx: ctx }))
  // 提交区上沿的一条窄行（定稿原型 62 的 composer-head）：左边是已暂存文件数，右边是「拿不准怎么拆提交？交给 AI」。
  //   AI 入口只在容器传来 onOpenHandoff 时画：它开一个新会话把已读到的事实写成 prompt，不自动发送，也不碰 git。
  const stagedCount = String(Number(counts.staged || 0))
  const tailKids: any[] = [h('span', { key: 'count', className: 'vcs-composer-count', 'data-vc-staged-count': stagedCount }, t('vc.changes.view.stagedCount', { n: stagedCount }))]
  if (typeof opts.onOpenHandoff === 'function') tailKids.push(h('button', { key: 'ai', className: 'vcs-composer-ai', type: 'button', 'data-vc-changes-handoff': '1', 'data-log': 'vc.ai.commit-split', onClick: function () { opts.onOpenHandoff() } }, t('vc.changes.view.aiSplit')))
  kids.push(h('div', { key: 'tail', className: 'vcs-composer-tail' }, tailKids))
  return h('section', { className: 'vcs-changes-view', 'data-vc-changes-view': '1', 'data-vc-changes-filter': filter }, kids)
}
