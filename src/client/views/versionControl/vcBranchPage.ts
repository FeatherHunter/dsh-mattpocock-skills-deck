// views/versionControl/vcBranchPage.ts —— 分支与标签页的视图叶子（#1829 阶段 3 最后一块）
// 这一页只做「把读数画成人能扫的结构」：页头与计数、一句说明与只读边界、当前分支、筛选与搜索、
// 分支卡片（行内切换 / 删除 / 重命名，其余真实动作收进同一行的 details 菜单）、标签清单、
// 页尾折叠区（两张名单 + 十条写动作表单）。真正发电话、预检、确认卡与结果全在 vcBranches 的数据层，
// 这里一个电话都不发，也不改任何 git 行为。
//
// 两条硬约束（改之前先看）：
// 1) vcBranchTreeOf 是纯函数、直接搭宿主元素树：门禁 verify-1586-branches 用假 h 走这一条，
//    并直接读根元素的 data-vc-branch-*；它不会执行 React 组件，所以这里不能把树交给组件去画。
// 2) 十条写动作的 data-vc-op 与逐行顺序是 818 BR20/BR21/BR23 的判据：行内按钮、行内菜单、
//    页尾表单三处都要在 DOM 里，且顺序跟读数顺序一致（见 tests/verify-818-version-control-view.ts）。
declare const React: any
declare const vcShellConfirmCardNode: any
declare const vcShellResultNode: any
declare const vcBranchShapeOk: any
declare const vcBranchDegradedOf: any
declare const VC_BRANCH_OP_IDS: any[]
declare const VC_BRANCH_WRITE_OPS: any[]
declare const VC_BRANCH_ACTIONS: any[]
declare const vcWhenText: any

// 提交号只取前 7 位：行里放整串 40 位会把 300 宽撑破；短号只是标识，不承担唯一定位。
const vcBranchOidTextOf = function (oid: any) {
  const s = String(oid === null || oid === undefined ? '' : oid)
  return s.length > 7 ? s.slice(0, 7) : s
}

// 三颗筛选胶囊：全部 / 当前分支 / 未并入当前分支。文案来自词表，值只认这三个标识。
const vcBranchFiltersOf = function (t: any) {
  return [
    { id: 'all', label: t('vc.shell.branch2.filterAll') },
    { id: 'current', label: t('vc.shell.branch2.filterCurrent') },
    { id: 'unmerged', label: t('vc.shell.branch2.filterUnmerged') },
  ]
}

// 提交时间怎么说交给 vcText 的同一个判据（一周内相对、更早绝对）；这条叶子被单独求值时
//   （verify-1586-branches 只拼 vcBranches + 本文件）没有那个函数，就如实不画时间，不自己编一个。
const vcBranchWhenOf = function (t: any, nowMs: any, ms: any) {
  if (!(Number(nowMs) > 0)) return ''
  if (typeof vcWhenText !== 'function') return ''
  return String(vcWhenText(t, Number(nowMs), ms) || '')
}

// 筛选与搜索：只筛画出来的行，不动读数本身；顺序与 board.branches 完全一致（BR20 判顺序）。
const vcBranchMatchedOf = function (board: any, filter: any, query: any) {
  const rows: any[] = Array.isArray(board.branches) ? board.branches : []
  const notMerged: any[] = Array.isArray(board.notMerged) ? board.notMerged : []
  const currentName = board.current ? String(board.current.name || '') : ''
  const q = String(query === null || query === undefined ? '' : query).trim().toLowerCase()
  const out: any[] = []
  for (let i = 0; i < rows.length; i += 1) {
    const b = rows[i] || {}
    const name = String(b.name || '')
    if (filter === 'current' && !(b.current === true || (currentName !== '' && name === currentName))) continue
    if (filter === 'unmerged' && notMerged.indexOf(name) < 0) continue
    if (q !== '' && name.toLowerCase().indexOf(q) < 0) continue
    out.push(b)
  }
  return out
}

const vcBranchHeadOf = function (h: any, t: any, board: any) {
  const branches = Array.isArray(board.branches) ? board.branches.length : 0
  const tags = Array.isArray(board.tags) ? board.tags.length : 0
  return h('div', { key: 'head', className: 'vcs-branch2-head' }, [
    h('h2', { key: 'title', className: 'vcs-branch2-title' }, t('vc.shell.branch2.title')),
    h('span', { key: 'count', className: 'vcs-branch2-count' }, t('vc.shell.branch2.count', { branches: String(branches), tags: String(tags) })),
  ])
}

const vcBranchCurrentOf = function (h: any, t: any, board: any) {
  const current = board && board.current ? String(board.current.name || '') : ''
  return h('p', { key: 'cur', className: 'vcs-branch2-cur', 'data-vc-branch-current': current }, t('vc.shell.branch2.current', { branch: current || t('vc.shell.branch2.unknown') }))
}

// 降级说明：低版本 git 把新建/切换改走 checkout 等价动作；替代做法逐条来自能力账本，界面不自己编。
const vcBranchDegradedOfNode = function (h: any, t: any, board: any) {
  const degraded: any[] = board ? vcBranchDegradedOf(board) : []
  if (degraded.length === 0) return null
  const gitVersion: string = String((board.capabilities || {}).gitVersion || '')
  const alternatives: string = degraded.map(function (a: any) { return String(a.alternative || '') }).filter(function (s: string) { return s !== '' }).join('；')
  return h('p', { key: 'degraded', className: 'vcs-branch2-degraded', 'data-vc-branch-degraded': String(degraded.length), 'data-vc-branch-git-version': gitVersion }, t('vc.shell.branch2.degraded', { version: gitVersion, alternatives: alternatives }))
}

// 工具行：搜索框与三颗筛选胶囊。控件只带本地属性，不挂任何已识别的 data-vc-branch-*，
//   所以点击事件归 React 自己的 onClick，不会被 vcRealDelegate 抢成动作意图。
const vcBranchToolsOf = function (h: any, t: any, o: any) {
  const kids: any[] = []
  const input: any = { key: 'q', type: 'search', className: 'vcs-hist-query', 'data-vc-branch-query': '1', placeholder: t('vc.shell.branch2.searchPlaceholder') }
  if (typeof o.onQuery === 'function') { input.value = o.query; input.onChange = o.onQuery } else { input.defaultValue = o.query }
  kids.push(h('input', input))
  const filters = vcBranchFiltersOf(t)
  for (let i = 0; i < filters.length; i += 1) {
    const f = filters[i]
    const attrs: any = { key: f.id, type: 'button', className: 'vcs-hist-merge-only', 'data-vc-branch-filter': f.id, 'aria-pressed': o.filter === f.id ? 'true' : 'false', 'data-press': 'button', 'data-log': 'vc.branch.page.filter' }
    if (typeof o.onFilter === 'function') {
      const fid = f.id
      attrs.onClick = function () { o.onFilter(fid) }
    }
    kids.push(h('button', attrs, f.label))
  }
  return h('div', { key: 'tools', className: 'vcs-hist-tools' }, kids)
}

// 一行输入 + 一颗执行按钮的动作行：行内菜单与页尾表单共用这一份画法。
//   [data-vc-op-row] 必须是输入框的祖先，vcRealBranchFieldsOf 靠它 querySelector 读输入值。
const vcBranchOpRowOf = function (h: any, t: any, spec: any) {
  const kids: any[] = [h('span', { key: 'label', className: 'vcs-branch2-op-label' }, t(spec.label))]
  if (spec.form) kids.push(h('input', { key: 'input', type: 'text', className: 'vcs-branch2-input', 'data-vc-branch-input': spec.kind, placeholder: t(spec.hint || 'vc.shell.branch2.inputHint'), defaultValue: String(spec.value || '') }))
  kids.push(h('button', { key: 'go', type: 'button', className: 'vc-wt-btn', 'data-vc-branch-action': spec.kind, 'data-vc-op': spec.op, 'data-vc-branch-form': spec.form ? '1' : '0', 'data-press': 'button', 'data-log': 'vc.branch.page.go.' + spec.kind }, t('vc.shell.branch2.go')))
  return h('div', { key: spec.op, className: 'vcs-branch2-op', 'data-vc-op-row': spec.op }, kids)
}

// 一条分支卡片：第一行名字 + 当前/提交号，第二行上游与并入情况，第三行说明；
//   右侧动作：切换、删除两颗直给，重命名与其余真实动作（切提交/设置上游/写说明）各收进一个 details 菜单。
const vcBranchRowOf = function (h: any, t: any, board: any, o: any, b: any) {
  const name = String(b.name || '')
  const nameRow: any[] = [h('span', { key: 'name', className: 'vc-wt-name' }, name)]
  if (b.current === true) nameRow.push(h('span', { key: 'cur', className: 'vc-wt-chip vc-wt-chip-ok' }, t('vc.shell.branch2.currentBadge')))
  const oid = vcBranchOidTextOf(b.oid)
  if (oid !== '') nameRow.push(h('span', { key: 'oid', className: 'vc-wt-oid vcs-branch2-oid' }, oid))
  const meta: any[] = []
  const upstream = String(b.upstream || '')
  if (upstream !== '') meta.push(h('span', { key: 'up', className: 'vc-wt-chip', 'data-vc-branch-upstream': upstream }, t('vc.shell.branch2.tracked', { upstream: upstream })))
  const ahead = Number(b.ahead) || 0
  const behind = Number(b.behind) || 0
  if (ahead > 0) meta.push(h('span', { key: 'ahead', className: 'vc-wt-branch' }, t('vc.shell.branch2.ahead', { ahead: String(ahead) })))
  if (behind > 0) meta.push(h('span', { key: 'behind', className: 'vc-wt-branch' }, t('vc.shell.branch2.behind', { behind: String(behind) })))
  const merged: any[] | null = Array.isArray(board.merged) ? board.merged : null
  const notMerged: any[] | null = Array.isArray(board.notMerged) ? board.notMerged : null
  if (merged && merged.indexOf(name) >= 0) meta.push(h('span', { key: 'merged', className: 'vc-wt-chip vc-wt-chip-ok' }, t('vc.shell.branch2.merged')))
  else if (notMerged && notMerged.indexOf(name) >= 0) meta.push(h('span', { key: 'notmerged', className: 'vc-wt-chip' }, t('vc.shell.branch2.notMerged')))
  const when = vcBranchWhenOf(t, o.nowMs, b.commitDateMs)
  if (when !== '') meta.push(h('span', { key: 'when', className: 'vc-wt-branch' }, when))
  const desc = String((board.descriptions || {})[name] || '')
  const mainKids: any[] = [h('div', { key: 'name-row', className: 'vc-wt-name-row' }, nameRow)]
  if (meta.length > 0) mainKids.push(h('div', { key: 'meta', className: 'vc-wt-states' }, meta))
  if (desc !== '') mainKids.push(h('p', { key: 'desc', className: 'vcs-branch2-desc' }, desc))
  const acts: any[] = [
    h('button', { key: 'switch', type: 'button', className: 'vc-wt-btn', 'data-vc-branch-action': 'switch', 'data-vc-op': '4.3', 'data-vc-branch-name': name, 'data-vc-branch-form': '0', 'data-press': 'button', 'data-log': 'vc.branch.page.act.switch' }, t('vc.shell.branch2.switch')),
    h('button', { key: 'delete', type: 'button', className: 'vc-wt-btn vcs-branch2-danger', 'data-vc-branch-action': 'delete', 'data-vc-op': '4.6', 'data-vc-branch-name': name, 'data-vc-branch-form': '0', 'data-press': 'button', 'data-log': 'vc.branch.page.act.delete' }, t('vc.shell.branch2.delete')),
    h('details', { key: 'rename', className: 'vcs-branch2-more' }, [
      h('summary', { key: 'sum', className: 'vc-wt-btn', 'data-press': 'button', 'data-log': 'vc.branch.page.rename' }, t('vc.shell.branch2.rename')),
      vcBranchOpRowOf(h, t, { op: '4.5', kind: 'rename', label: 'vc.shell.branch2.rename', form: true, hint: 'vc.shell.branch2.renameHint', value: name + ' ' }),
    ]),
    h('details', { key: 'more', className: 'vcs-branch2-more' }, [
      h('summary', { key: 'sum', className: 'vc-wt-btn', 'data-press': 'button', 'data-log': 'vc.branch.page.more' }, t('vc.shell.branch2.moreActions')),
      vcBranchOpRowOf(h, t, { op: '4.4', kind: 'detach', label: 'vc.shell.branch2.detach', form: true }),
      vcBranchOpRowOf(h, t, { op: '4.7', kind: 'upstream', label: 'vc.shell.branch2.upstream', form: true }),
      vcBranchOpRowOf(h, t, { op: '4.13', kind: 'describe', label: 'vc.shell.branch2.describe', form: true }),
    ]),
  ]
  return h('li', { key: name, className: 'vc-wt-row vcs-branch2-row', 'data-vc-branch-row': name }, [
    h('div', { key: 'main', className: 'vc-wt-row-main' }, mainKids),
    h('div', { key: 'acts', className: 'vc-wt-row-acts' }, acts),
  ])
}

// 一条标签卡片：名字 + 附注标记 + 短号，第二行显示标签自己的说明；动作是验签与删除（4.12 / 4.11）。
const vcBranchTagRowOf = function (h: any, t: any, tag: any) {
  const name = String(tag.name || '')
  const nameRow: any[] = [h('span', { key: 'name', className: 'vc-wt-name' }, name)]
  const oid = vcBranchOidTextOf(tag.oid)
  if (oid !== '') nameRow.push(h('span', { key: 'oid', className: 'vc-wt-oid vcs-branch2-oid' }, oid))
  if (tag.annotated === true) nameRow.push(h('span', { key: 'ann', className: 'vc-wt-chip' }, t('vc.shell.branch2.annotated')))
  const mainKids: any[] = [h('div', { key: 'name-row', className: 'vc-wt-name-row' }, nameRow)]
  const subject = String(tag.subject || '')
  if (subject !== '') mainKids.push(h('p', { key: 'sub', className: 'vcs-branch2-desc' }, subject))
  const acts: any[] = [
    h('button', { key: 'verify', type: 'button', className: 'vc-wt-btn', 'data-vc-tag-action': 'verify', 'data-vc-op': '4.12', 'data-vc-tag-name': name, 'data-press': 'button', 'data-log': 'vc.branch.page.tag.verify' }, t('vc.shell.branch2.verify')),
    h('button', { key: 'delete', type: 'button', className: 'vc-wt-btn vcs-branch2-danger', 'data-vc-tag-action': 'delete', 'data-vc-op': '4.11', 'data-vc-tag-name': name, 'data-press': 'button', 'data-log': 'vc.branch.page.tag.delete' }, t('vc.shell.branch2.tagDelete')),
  ]
  return h('li', { key: name, className: 'vc-wt-row vcs-branch2-row', 'data-vc-tag-row': name, 'data-vc-tag-annotated': tag.annotated === true ? '1' : '0' }, [
    h('div', { key: 'main', className: 'vc-wt-row-main' }, mainKids),
    h('div', { key: 'acts', className: 'vc-wt-row-acts' }, acts),
  ])
}

// 4.8 两张名单也收进折叠区：DOM 一直在（门禁数与属性都读得到），默认不占首屏。
const vcBranchListsOf = function (h: any, t: any, board: any) {
  const merged: any[] | null = Array.isArray(board.merged) ? board.merged : null
  const notMerged: any[] | null = Array.isArray(board.notMerged) ? board.notMerged : null
  if (!merged || !notMerged) return null
  return h('details', { key: 'lists', className: 'vcs-branch2-lists', 'data-vc-branch-merged': String(merged.length), 'data-vc-branch-notmerged': String(notMerged.length) }, [
    h('summary', { key: 'sum', className: 'vcs-branch2-summary', 'data-press': 'button', 'data-log': 'vc.branch.page.lists' }, t('vc.shell.branch2.listsTitle')),
    h('p', { key: 'mh', className: 'vcs-branch2-h' }, t('vc.shell.branch2.merged')),
    h('p', { key: 'm', className: 'vcs-branch2-names', 'data-vc-branch-merged-list': merged.join(',') }, merged.join('、') || t('vc.shell.branch2.none')),
    h('p', { key: 'nh', className: 'vcs-branch2-h' }, t('vc.shell.branch2.notMerged')),
    h('p', { key: 'n', className: 'vcs-branch2-names', 'data-vc-branch-notmerged-list': notMerged.join(',') }, notMerged.join('、') || t('vc.shell.branch2.none')),
  ])
}

// 十条写动作的入口：默认收起，DOM 与 data-vc-branch-forms=10 一直在（818 BR21 / D30 都读它）。
//   需要输入的动作各带一个 [data-vc-branch-input]，vcRealBranchFieldsOf 按 kind 拆参数。
const vcBranchFormsOf = function (h: any, t: any) {
  const rows: any[] = []
  for (let i = 0; i < VC_BRANCH_ACTIONS.length; i += 1) {
    const act = VC_BRANCH_ACTIONS[i]
    const kids: any[] = [h('span', { key: 'label', className: 'vcs-branch2-op-label' }, t(act.label))]
    if (act.form) kids.push(h('input', { key: 'input', type: 'text', className: 'vcs-branch2-input', 'data-vc-branch-input': act.kind, placeholder: t('vc.shell.branch2.inputHint') }))
    kids.push(h('button', { key: 'go', type: 'button', className: 'vc-wt-btn', 'data-vc-branch-action': act.kind, 'data-vc-op': act.op, 'data-vc-branch-form': act.form ? '1' : '0', 'data-press': 'button', 'data-log': 'vc.branch.page.go.' + act.kind }, t('vc.shell.branch2.go')))
    rows.push(h('li', { key: act.op, className: 'vcs-branch2-op', 'data-vc-op-row': act.op }, kids))
  }
  return h('details', { key: 'forms', className: 'vcs-branch2-forms', 'data-vc-branch-forms': String(rows.length) }, [
    h('summary', { key: 'sum', className: 'vcs-branch2-summary', 'data-press': 'button', 'data-log': 'vc.branch.page.forms' }, t('vc.shell.branch2.formsTitle')),
    h('ul', { key: 'rows', className: 'vcs-branch2-form-rows' }, rows),
  ])
}

// 面板骨架：筛选与搜索只影响分支卡片，标签与折叠区照旧全画；确认卡与结果永远排在面板最后（BR22 / BR23b）。
export const vcBranchTreeOf = function (h: any, t: any, o: any) {
  const opts: any = o || {}
  const board: any = vcBranchShapeOk(opts.board) ? opts.board : null
  const nowMs: any = Number(opts.nowMs) > 0 ? Number(opts.nowMs) : 0
  const filter: string = ['all', 'current', 'unmerged'].indexOf(String(opts.filter || 'all')) >= 0 ? String(opts.filter || 'all') : 'all'
  const query: string = String(opts.query === null || opts.query === undefined ? '' : opts.query).trim()
  const view: any = { nowMs: nowMs, filter: filter, query: query, onFilter: opts.onFilter, onQuery: opts.onQuery }
  const kids: any[] = [vcBranchHeadOf(h, t, board || {}), h('p', { key: 'lede', className: 'vcs-branch2-lede' }, t('vc.shell.branch2.lede')), h('p', { key: 'boundary', className: 'vcs-branch2-boundary' }, t('vc.shell.branch2.boundary')), vcBranchCurrentOf(h, t, board)]
  const degraded = vcBranchDegradedOfNode(h, t, board)
  if (degraded) kids.push(degraded)
  if (board) {
    kids.push(vcBranchToolsOf(h, t, view))
    const matched = vcBranchMatchedOf(board, filter, query)
    kids.push(h('p', { key: 'scope', className: 'vcs-hist-scope', 'data-vc-branch-scope': String(matched.length) }, t('vc.shell.branch2.scope', { shown: String(matched.length), total: String(board.branches.length) })))
    const rows: any[] = []
    for (let i = 0; i < matched.length; i += 1) rows.push(vcBranchRowOf(h, t, board, view, matched[i]))
    const branchKids: any[] = [h('p', { key: 'h', className: 'vcs-branch2-h' }, t('vc.shell.branch2.list'))]
    if (rows.length > 0) branchKids.push(h('ul', { key: 'rows', className: 'vcs-branch2-rows' }, rows))
    else branchKids.push(h('p', { key: 'none', className: 'vcs-branch2-empty-filter' }, t('vc.shell.branch2.filterEmpty')))
    kids.push(h('div', { key: 'list', className: 'vcs-branch2-list', 'data-vc-branch-list': String(board.branches.length) }, branchKids))
    const tagRows: any[] = []
    const tags: any[] = Array.isArray(board.tags) ? board.tags : []
    for (let i = 0; i < tags.length; i += 1) tagRows.push(vcBranchTagRowOf(h, t, tags[i]))
    const tagKids: any[] = [h('p', { key: 'h', className: 'vcs-branch2-h' }, t('vc.shell.branch2.tags'))]
    if (tagRows.length > 0) tagKids.push(h('ul', { key: 'rows', className: 'vcs-branch2-rows' }, tagRows))
    else tagKids.push(h('p', { key: 'none', className: 'vcs-branch2-empty-filter' }, t('vc.shell.branch2.noTags')))
    kids.push(h('div', { key: 'tags', className: 'vcs-tag-list', 'data-vc-tag-list': String(tags.length) }, tagKids))
    const lists = vcBranchListsOf(h, t, board)
    if (lists) kids.push(lists)
  } else {
    kids.push(h('p', { key: 'none', className: 'vcs-branch2-empty', 'data-vc-branch2-empty': '1' }, t('vc.shell.branch2.empty')))
    if (typeof opts.onRetry === 'function') kids.push(h('button', { key: 'retry', type: 'button', className: 'vcs-branch2-retry', 'data-vc-branch2-retry': '1', 'data-press': 'button', 'data-log': 'vc.branch.page.retry', onClick: opts.onRetry }, t('vc.shell.state.retry')))
  }
  kids.push(vcBranchFormsOf(h, t))
  if (opts.confirm) kids.push(Object.assign({}, vcShellConfirmCardNode(h, t, opts.confirm), { key: 'confirm' }))
  if (opts.result) kids.push(Object.assign({}, vcShellResultNode(h, t, opts.result), { key: 'result' }))
  return h('section', { className: 'vcs-branch2', 'data-vc-branch2': '1', 'data-vc-branch-ops': String(VC_BRANCH_OP_IDS.length), 'data-vc-branch-writes': String(VC_BRANCH_WRITE_OPS.length), 'data-vc-branch-checks': '1' }, kids)
}

// React 路径：壳在生产里挂这个组件，才拿得到筛选与搜索的本地状态；静态树（门禁、无状态渲染）
//   仍走上面的 vcBranchTreeOf，两者画的是同一份结构。
export const vcBranchPageOf = function (props: any) {
  const h = React.createElement
  const filterState: any = React.useState('all')
  const queryState: any = React.useState('')
  const onQuery = function (e: any) { queryState[1](String(e && e.target ? e.target.value : '')) }
  return vcBranchTreeOf(h, props.t, {
    board: props.board,
    confirm: props.confirm,
    result: props.result,
    onRetry: props.onRetry,
    nowMs: props.nowMs,
    filter: filterState[0],
    query: queryState[0],
    onFilter: filterState[1],
    onQuery: onQuery,
  })
}
