// views/versionControl/vcChangesView.ts —— 改动页首屏（#1860 按定稿原型 62/63/65 重排；#1902 补逐块暂存与三个行级动作）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回同一个闭包，跨叶用 declare。
//
// 这一叶只画改动页的上半页：统计卡、结果条、分组、以及每一行（行本身的画法在 vcChangesRow 一叶）。
// 版式照 docs/prototype/vc-redesign/src/ui/views/changes.ts；底部提交区由页面壳挂 vcCommitPageNode。
// 动作全部复用容器现成的改动处理器 handlers.begin(op,{path}) / handlers.onHunk(…)，界面不新增 git 能力、也不自己拼命令。
// 展开与菜单用的是改动页的 values（openPath / menuPath / renamePath），不另开一份容器状态：
//   页面切换后回到改动页，展开行与菜单自然复位到「都没开」，与原型「切走再回来保持滚动位置」不冲突。
// 行主体点开是逐块差异：首屏只带路径与增删行数，补丁按需向宿主读（wf.gitDiff），读数住在容器的 reads.diffs 里，
//   所以切走页签再回来还是那一份，不重发；同一路径正在读或已经读到时不重复发（见 vcChangesHandlers 的 onOpen）。

declare function vcChangesFileRowNode(h: any, t: any, row: any, ctx: any): any
declare function vcChangesGroupsOf(files: any): any
declare function vcChangesSideKeyOf(side: any, path: any): string

// 差异缓存的键（#1860 D17）：同一个文件可能同时出现在「已暂存」与「未暂存」两组里，两行的补丁是两回事，
//   键必须带上是哪一组，否则两行会互相顶掉同一个读数。
export const vcChangesDiffKeyOf = function (row: any): string {
  return (row && row.staged === true ? 'staged:' : 'worktree:') + String((row && row.path) || '')
}

// 三张统计卡：整卡可点，点了就是筛选；再点一次回到全部。筛选值住在改动页的 values.filter 里。
const vcChangesStatOf = function (h: any, t: any, o: any): any {
  const value = String(o.value || '')
  const active = String(o.filter || 'all') === value
  const tone = value === 'conflict' ? 'error' : (value === 'staged' ? 'ok' : 'mod')
  return h('button', {
    key: value, type: 'button', className: 'stat tone-' + tone + (active ? ' is-on' : ''), 'data-vc-stat': value,
    'aria-pressed': active ? 'true' : 'false', 'data-press': 'button', 'data-log': 'vc.changes.filter',
    title: value === 'staged' ? t('vc.changes.view.statStagedHint') : t('vc.changes.view.statHint'),
    onClick: function () { if (typeof o.onFilter === 'function') o.onFilter(active ? 'all' : value) },
  }, [
    h('span', { key: 'n', className: 'stat-n' }, String(o.n === undefined || o.n === null ? 0 : o.n)),
    h('span', { key: 'label', className: 'stat-t' }, t('vc.changes.view.stat.' + value)),
  ])
}

/**
 * 结果条：贴着改动列表顶部出现。为什么不做在行里——删除已跟踪、停止跟踪、改名这三下都会让触发的行
 * 挪到别的组或干脆消失，行里的结果会跟着没掉；列表顶部离这一行最近，也永远画得出来。
 * 成功时按动作给一句人话（不把 git 命令名当结论）；失败时给同源话术加 git 原话。
 */
const vcChangesResultNodeOf = function (h: any, t: any, result: any): any {
  const r: any = result || {}
  const path: string = String(r.path || '')
  const at: number = path.lastIndexOf('/')
  const name: string = at >= 0 ? path.slice(at + 1) : path
  const op: string = String(r.op || '')
  let text: string = ''
  if (r.ok === true) {
    if (op === 'stage-hunks') text = t(r.reverse === true ? 'vc.changes.view.resultHunkUnstaged' : 'vc.changes.view.resultHunkStaged', { name: name, n: String(Number(r.hunkIndex) + 1) })
    else if (op === 'rm-cached') text = t('vc.changes.view.resultUntracked', { name: name })
    else if (op === 'rm-tracked') text = t('vc.changes.view.resultDeleted', { name: name })
    else if (op === 'mv') text = t('vc.changes.view.resultRenamed', { from: name, to: String(r.to || '') })
    else text = t('vc.changes.result.ok', { cmd: String(r.cmd || op), ms: String(r.ms === undefined ? '' : r.ms), n: String(r.n === undefined ? 0 : r.n) })
  } else {
    const err: any = r.error || {}
    text = t('vc.changes.result.fail', { hint: t('vc.changes.result.failTitle'), git: String(err.message || '') })
  }
  const attrs: any = {
    key: 'result', className: 'result ' + (r.ok === true ? 'result-ok' : 'result-error'), role: r.ok === true ? 'status' : 'alert',
    'data-vc-changes-result': op, 'data-vc-changes-result-ok': r.ok === true ? '1' : '0',
  }
  return h('div', attrs, [
    h('span', { key: 'tag', className: 'result-tag' }, t('vc.changes.view.resultTag')),
    h('span', { key: 'text', className: 'result-text', 'data-vc-changes-result-text': '1' }, text),
  ])
}

// 一组文件行：组头一行是标题、计数、整组动作；空组只写一句空态（与原型 renderGroup 相同）。
//   整组动作只给真正做得到的：已暂存组能全部取消暂存，未暂存组能全部暂存、能丢弃全部。
const vcChangesFileGroupOf = function (h: any, t: any, o: any): any {
  const rows: any[] = Array.isArray(o.rows) ? o.rows : []
  const handlers: any = o.handlers || {}
  const begin = function (op: string) { if (typeof handlers.begin === 'function') handlers.begin(op, {}) }
  const actions: any[] = []
  if (o.id === 'staged' && o.allStagedPaths.length > 0) {
    actions.push(h('button', {
      key: 'unstage-all', type: 'button', className: 'group-action', 'data-vc-file-group-all': 'unstage',
      'data-press': 'button', 'data-log': 'vc.changes.group.unstage',
      // 「全部取消暂存」按 git reset 的口径清整个索引：只暂存了一部分的文件也一起退回未暂存，
      //   逐块记录跟着没了——这正是它与逐块「取消暂存这一块」的区别。
      onClick: function () { o.allStagedPaths.forEach(function (path: string) { if (typeof handlers.begin === 'function') handlers.begin('unstage', { path: path }) }) },
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

// 整页上半部分：统计卡 / 结果条 / 分组文件行。筛选只影响画出来的行，不改读数本身。
export const vcChangesViewNode = function (h: any, t: any, o: any) {
  const opts: any = o || {}
  const changes: any = opts.changes || {}
  const counts: any = changes.counts || {}
  const files: any = changes.files || {}
  const values: any = changes.values || {}
  const handlers: any = changes.handlers || {}
  const filter = String(values.filter || 'all')
  const groups: any = vcChangesGroupsOf(files)
  const stagedRows: any[] = Array.isArray(files.staged) ? files.staged : []
  const unstagedRows: any[] = Array.isArray(files.unstaged) ? files.unstaged : []
  const stagedPaths: string[] = stagedRows.map(function (row: any) { return String((row || {}).path || '') })
  const onFilter = function (next: any) { if (typeof handlers.onValue === 'function') handlers.onValue('filter', String(next)) }
  const ctx: any = { rows: changes.rows || {}, diffs: changes.diffs || {}, handlers: handlers, values: values }
  const known: boolean = Number(counts.staged || 0) + Number(counts.unstaged || 0) + Number(counts.untracked || 0) + Number(counts.conflicts || 0) > 0
  const kids: any[] = [
    h('div', { key: 'stats', className: 'stats', 'data-vc-changes-stats': '1' }, [
      vcChangesStatOf(h, t, { value: 'conflict', n: groups.counts.conflicts, filter: filter, onFilter: onFilter }),
      vcChangesStatOf(h, t, { value: 'staged', n: groups.counts.staged, filter: filter, onFilter: onFilter }),
      vcChangesStatOf(h, t, { value: 'unstaged', n: groups.counts.unstaged, filter: filter, onFilter: onFilter }),
    ]),
  ]
  const scrollKids: any[] = []
  // 顶部那条结果住在 values.lastResult（见 vcChangesHandlers 的 putResult）：行被挪走或消失之后，
  //   行里的结果没有落脚点，只有这一条画得出来。
  if (values.lastResult) scrollKids.push(vcChangesResultNodeOf(h, t, values.lastResult))
  if (changes.state === 'error') scrollKids.push(h('p', { key: 'error', className: 'changes-note', role: 'alert', 'data-vc-file-error': '1' }, String(changes.errorText || t('vc.changes.result.failTitle'))))
  // 空仓与「没有改动」是两种状态（票面验收④）：仓库一次提交都还没有时给专属空态，别让人以为改动被弄丢了。
  else if (changes.repoEmpty === true && stagedRows.length === 0 && unstagedRows.length === 0) scrollKids.push(h('div', { key: 'empty-repo', className: 'empty', 'data-vc-file-list-empty': '1', 'data-vc-file-list-empty-repo': '1' }, [
    h('div', { key: 'title', className: 'empty-title' }, t('vc.changes.view.emptyRepo')),
  ]))
  else if (!known && stagedRows.length === 0 && unstagedRows.length === 0) scrollKids.push(h('div', { key: 'empty', className: 'empty', 'data-vc-file-list-empty': '1' }, [
    h('div', { key: 'title', className: 'empty-title' }, t('vc.changes.view.emptyUnstaged')),
  ]))
  // 分组顺序照原型：先冲突（有才画），再已暂存，最后未暂存；筛选命中哪一组就只画哪一组。
  const groupArgs = { handlers: handlers, ctx: ctx, allStagedPaths: stagedPaths }
  if ((filter === 'all' || filter === 'conflict') && (groups.conflicts.length > 0 || filter === 'conflict')) {
    scrollKids.push(vcChangesFileGroupOf(h, t, Object.assign({ id: 'conflict', titleKey: 'vc.changes.view.groupTitleConflict', emptyKey: 'vc.changes.view.emptyConflicts', rows: groups.conflicts }, groupArgs)))
  }
  if (filter === 'all' || filter === 'staged') {
    scrollKids.push(vcChangesFileGroupOf(h, t, Object.assign({ id: 'staged', titleKey: 'vc.changes.view.groupTitleStaged', emptyKey: 'vc.changes.view.emptyStaged', rows: groups.staged }, groupArgs)))
  }
  if (filter === 'all' || filter === 'unstaged') {
    scrollKids.push(vcChangesFileGroupOf(h, t, Object.assign({ id: 'unstaged', titleKey: 'vc.changes.view.groupTitleUnstaged', emptyKey: 'vc.changes.view.emptyUnstaged', rows: groups.unstaged }, groupArgs)))
  }
  kids.push(h('div', { key: 'scroll', className: 'changes-scroll' }, scrollKids))
  return h('div', { className: 'view view-changes', 'data-vc-changes-view': '1', 'data-vc-changes-filter': filter }, kids)
}
