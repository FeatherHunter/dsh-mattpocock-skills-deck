// views/versionControl/vcBranchPage.ts —— 「分支与标签」页的视图叶子（#1829 阶段 3 落地；#1858 按原型 38 核对补缺口）
//
// 这一页只做「把读数画成人能扫的结构」。真正的读取、预检、确认卡与写电话全在 vcBranches 的数据层，
// 这里一个电话都不发，也不改任何 git 行为。
//
// #1858 的版式依据是原型本体 docs/prototype/vc-redesign/src/ui/views/pages-manage.ts 的
// renderBranchTags（定稿截图第 38 张）：页头由页面壳画（标题 + 导语，本页不再重复画一份），
// 正文三段固定顺序——
//   ① 分支：版本门（低版本 git 时说明降级动作）→ 三颗筛选胶囊 → 按名字搜索 → 分支行 →
//      「已并入 / 没并入」名单折叠；
//   ② 标签：标签行（名字、附注标记、提交号、标签说明与时间）；
//   ③ 上游跟踪：四条事实（当前分支、上游、领先 / 落后、上游依据）。
// 每行左边三行字回答「它是什么、现在什么状态、最近发生了什么」，右边是该行的动作（原型只有一颗
// 「在浮层里看」；本产品这一页就是管理面，所以行尾放真动作：切换、删除、重命名与更多动作）。
// 页尾保留十个写动作的折叠区（新建分支、切提交、设上游、写说明、建标签等没有逐行入口的动作），
// 最后才是确认卡与结果——结果永远贴在触发它的那一块之后。
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
// 来自页面骨架原语 vcPageHead.ts（#1829 阶段 4）：分区、事实网格、对象行三件，本页正文都用它画。
declare function vcPageSectionNode(h: any, t: any, o: any): any
declare function vcPageObjRowNode(h: any, t: any, o: any): any
declare function vcPageFactGridNode(h: any, t: any, o: any): any

// 提交号只取前 7 位：行里放整串 40 位会把 300 宽撑破；短号只是标识，不承担唯一定位。
const vcBranchOidTextOf = function (oid: any) {
  const s = String(oid === null || oid === undefined ? '' : oid)
  return s.length > 7 ? s.slice(0, 7) : s
}

// 词条取值：叶子内部统一过 t，调用方只给键；t 缺席时回键本身（独立求值的那几扇门禁不传词表）。
const vcBranchTextOf = function (t: any, key: string, vars?: any): string {
  if (typeof t !== 'function') return key
  return vars ? String(t(key, vars)) : String(t(key))
}

// 三颗筛选胶囊：全部 / 当前分支 / 未并入当前分支。文案来自词表，值只认这三个标识。
const vcBranchFiltersOf = function (t: any) {
  return [
    { id: 'all', label: 'vc.shell.branch2.filterAll' },
    { id: 'current', label: 'vc.shell.branch2.filterCurrent' },
    { id: 'unmerged', label: 'vc.shell.branch2.filterUnmerged' },
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

// 一条分支现在跟上游是什么关系，照原型的四种子句取一种或几种：
//   没有上游 → 只说「没有上游」；上游被删（gone）→ 只说「上游已不存在」；
//   有上游且 ahead＝0 且 behind＝0 → 「与上游齐平」；ahead > 0 → 「领先 N」；behind > 0 → 再加一句「落后 N」。
// 两处与原型不同（票面偏差表有记）：
//   ① 没有上游时不画「与上游齐平」——没有参照物还说齐平是自相矛盾；
//   ② 上游被删（远端那条分支没了）时也不画齐平——参照物已经不存在了，说齐平是假话。
const vcBranchSyncTextsOf = function (t: any, b: any) {
  const out: any[] = []
  const upstream = String(b.upstream || '')
  const ahead = Number(b.ahead) || 0
  const behind = Number(b.behind) || 0
  if (upstream === '') {
    out.push({ key: 'up', text: vcBranchTextOf(t, 'vc.shell.branch2.noUpstream') })
    return out
  }
  if (b.gone === true) {
    // 机器读的属性仍然是上游名字（门禁与深链按它认人），只是人读的那句不再说齐平。
    out.push({ key: 'up', text: upstream + ' · ' + vcBranchTextOf(t, 'vc.shell.branch2.upstreamGone'), upstream: upstream })
    return out
  }
  out.push({ key: 'up', text: upstream, upstream: upstream })
  if (ahead > 0) out.push({ key: 'ahead', text: vcBranchTextOf(t, 'vc.shell.branch2.ahead', { ahead: String(ahead) }) })
  else if (behind === 0) out.push({ key: 'flat', text: vcBranchTextOf(t, 'vc.shell.branch2.inSync') })
  if (behind > 0) out.push({ key: 'behind', text: vcBranchTextOf(t, 'vc.shell.branch2.behind', { behind: String(behind) }) })
  return out
}

// 合并状态：已并入 / 没并入各一句；两个名单都读不到时返回 null（不猜）。
const vcBranchMergeTextOf = function (t: any, board: any, name: string) {
  const merged: any[] | null = Array.isArray(board.merged) ? board.merged : null
  const notMerged: any[] | null = Array.isArray(board.notMerged) ? board.notMerged : null
  if (merged && merged.indexOf(name) >= 0) return { key: 'merged', text: vcBranchTextOf(t, 'vc.shell.branch2.merged') }
  if (notMerged && notMerged.indexOf(name) >= 0) return { key: 'notmerged', text: vcBranchTextOf(t, 'vc.shell.branch2.notMerged') }
  return null
}

// 一行输入 + 一颗执行按钮的动作行：行内菜单与页尾表单共用这一份画法。
//   [data-vc-op-row] 必须是输入框的祖先，vcRealBranchFieldsOf 靠它 querySelector 读输入值。
const vcBranchOpRowOf = function (h: any, t: any, spec: any) {
  const kids: any[] = [h('span', { key: 'label', className: 'vcs-branch2-op-label' }, t(spec.label))]
  if (spec.form) kids.push(h('input', { key: 'input', type: 'text', className: 'vcs-branch2-input', 'data-vc-branch-input': spec.kind, placeholder: t(spec.hint || 'vc.shell.branch2.inputHint'), defaultValue: String(spec.value || '') }))
  kids.push(h('button', { key: 'go', type: 'button', className: 'vcs-branch2-act', 'data-vc-branch-action': spec.kind, 'data-vc-op': spec.op, 'data-vc-branch-form': spec.form ? '1' : '0', 'data-press': 'button', 'data-log': 'vc.branch.page.go.' + spec.kind }, t('vc.shell.branch2.go')))
  return h('div', { key: spec.op, className: 'vcs-branch2-op', 'data-vc-op-row': spec.op }, kids)
}

// 一条分支行（原型 obj-row 的三行结构）：
//   标题行 = 等宽分支名 + 当前分支标记 + 提交短号；事实行 = 上游关系、领先落后、并入情况；
//   说明行 = 最近提交时间 · 分支说明（说明来自 git config，读回包里本来就有）。
// 行尾四颗入口：切换、删除两颗直给；重命名与其余真实动作（切提交 / 设上游 / 写说明）各收进一个
//   折叠菜单——它们要点开才有输入框，直给会把一屏撑成表单堆。
const vcBranchRowOf = function (h: any, t: any, board: any, o: any, b: any) {
  const name = String(b.name || '')
  const titleKids: any[] = [h('span', { key: 'name', className: 'vcs-branch2-name' }, name)]
  if (b.current === true) titleKids.push(h('span', { key: 'cur', className: 'vcs-branch2-current' }, t('vc.shell.branch2.currentBadge')))
  const oid = vcBranchOidTextOf(b.oid)
  if (oid !== '') titleKids.push(h('span', { key: 'oid', className: 'obj-oid vcs-branch2-oid' }, oid))
  const metaKids: any[] = []
  const sync = vcBranchSyncTextsOf(t, b)
  for (let i = 0; i < sync.length; i += 1) {
    const piece = sync[i]
    const attrs: any = { key: piece.key, className: 'vcs-branch2-fact' }
    if (piece.upstream) attrs['data-vc-branch-upstream'] = piece.upstream
    metaKids.push(h('span', attrs, piece.text))
  }
  const merge = vcBranchMergeTextOf(t, board, name)
  if (merge) metaKids.push(h('span', { key: merge.key, className: 'vcs-branch2-fact' }, merge.text))
  const when = vcBranchWhenOf(t, o.nowMs, b.commitDateMs)
  const desc = String((board.descriptions || {})[name] || '')
  const subParts: string[] = []
  if (when !== '') subParts.push(when)
  if (desc !== '') subParts.push(desc)
  const main: any[] = [h('span', { key: 'title', className: 'obj-title' }, titleKids)]
  if (metaKids.length > 0) main.push(h('span', { key: 'meta', className: 'obj-meta' }, metaKids))
  if (subParts.length > 0) main.push(h('span', { key: 'sub', className: 'obj-sub' }, subParts.join(' · ')))
  const side: any[] = [
    h('button', { key: 'switch', type: 'button', className: 'vcs-branch2-act', 'data-vc-branch-action': 'switch', 'data-vc-op': '4.3', 'data-vc-branch-name': name, 'data-vc-branch-form': '0', 'data-press': 'button', 'data-log': 'vc.branch.page.act.switch' }, t('vc.shell.branch2.switch')),
    h('button', { key: 'delete', type: 'button', className: 'vcs-branch2-act vcs-branch2-danger', 'data-vc-branch-action': 'delete', 'data-vc-op': '4.6', 'data-vc-branch-name': name, 'data-vc-branch-form': '0', 'data-press': 'button', 'data-log': 'vc.branch.page.act.delete' }, t('vc.shell.branch2.delete')),
    h('details', { key: 'rename', className: 'vcs-branch2-more' }, [
      h('summary', { key: 'sum', 'data-press': 'button', 'data-log': 'vc.branch.page.rename' }, t('vc.shell.branch2.rename')),
      vcBranchOpRowOf(h, t, { op: '4.5', kind: 'rename', label: 'vc.shell.branch2.rename', form: true, hint: 'vc.shell.branch2.renameHint', value: name + ' ' }),
    ]),
    h('details', { key: 'more', className: 'vcs-branch2-more' }, [
      h('summary', { key: 'sum', 'data-press': 'button', 'data-log': 'vc.branch.page.more' }, t('vc.shell.branch2.moreActions')),
      vcBranchOpRowOf(h, t, { op: '4.4', kind: 'detach', label: 'vc.shell.branch2.detach', form: true }),
      vcBranchOpRowOf(h, t, { op: '4.7', kind: 'upstream', label: 'vc.shell.branch2.upstream', form: true }),
      vcBranchOpRowOf(h, t, { op: '4.13', kind: 'describe', label: 'vc.shell.branch2.describe', form: true }),
    ]),
  ]
  return vcPageObjRowNode(h, t, { main: main, side: side, attrs: { 'data-vc-branch-row': name } })
}

// 一条标签行：名字 + 附注标记 + 提交短号；下一行是打标签的时间与标签说明。
//   行尾两颗：验签（4.12，只读动作，走预检电话）与删除（4.11，危险动作，先确认卡后执行）。
//   data-vc-tag-name 必须挂在行上：容器的事件委托按行取标签名（vcRealDelegate 读的是行属性）。
const vcBranchTagRowOf = function (h: any, t: any, o: any, tag: any) {
  const name = String(tag.name || '')
  const titleKids: any[] = [h('span', { key: 'name', className: 'vcs-branch2-name' }, name)]
  const oid = vcBranchOidTextOf(tag.oid)
  if (oid !== '') titleKids.push(h('span', { key: 'oid', className: 'obj-oid vcs-branch2-oid' }, oid))
  if (tag.annotated === true) titleKids.push(h('span', { key: 'ann', className: 'vcs-branch2-tag' }, t('vc.shell.branch2.annotated')))
  const when = vcBranchWhenOf(t, o.nowMs, tag.atMs)
  const subject = String(tag.subject || '')
  const subParts: string[] = []
  if (when !== '') subParts.push(when)
  if (subject !== '') subParts.push(subject)
  const main: any[] = [h('span', { key: 'title', className: 'obj-title' }, titleKids)]
  if (subParts.length > 0) main.push(h('span', { key: 'sub', className: 'obj-sub' }, subParts.join(' · ')))
  const side: any[] = [
    h('button', { key: 'verify', type: 'button', className: 'vcs-branch2-act', 'data-vc-tag-action': 'verify', 'data-vc-op': '4.12', 'data-press': 'button', 'data-log': 'vc.branch.page.tag.verify' }, t('vc.shell.branch2.verify')),
    h('button', { key: 'delete', type: 'button', className: 'vcs-branch2-act vcs-branch2-danger', 'data-vc-tag-action': 'delete', 'data-vc-op': '4.11', 'data-press': 'button', 'data-log': 'vc.branch.page.tag.delete' }, t('vc.shell.branch2.tagDelete')),
  ]
  return vcPageObjRowNode(h, t, { main: main, side: side, attrs: { 'data-vc-tag-row': name, 'data-vc-tag-name': name, 'data-vc-tag-annotated': tag.annotated === true ? '1' : '0' } })
}

// 降级说明：低版本 git 把新建/切换改走 checkout 等价动作；替代做法逐条来自能力账本，界面不自己编。
const vcBranchDegradedOfNode = function (h: any, t: any, board: any) {
  const degraded: any[] = board ? vcBranchDegradedOf(board) : []
  if (degraded.length === 0) return null
  const gitVersion: string = String((board.capabilities || {}).gitVersion || '')
  const alternatives: string = degraded.map(function (a: any) { return String(a.alternative || '') }).filter(function (s: string) { return s !== '' }).join('；')
  return h('p', { key: 'degraded', className: 'vcs-branch2-warn vcs-branch2-degraded', 'data-vc-branch-degraded': String(degraded.length), 'data-vc-branch-git-version': gitVersion }, t('vc.shell.branch2.degraded', { version: gitVersion, alternatives: alternatives }))
}

// 工具行之一：三颗筛选胶囊（原型把它们排在搜索框上面）。控件只带本地属性，不挂任何已识别的
//   data-vc-branch-*，所以点击事件归 React 自己的 onClick，不会被 vcRealDelegate 抢成动作意图。
const vcBranchFiltersNodeOf = function (h: any, t: any, o: any) {
  const filters = vcBranchFiltersOf(t)
  const kids: any[] = []
  for (let i = 0; i < filters.length; i += 1) {
    const f = filters[i]
    const attrs: any = { key: f.id, type: 'button', className: 'filter-chip' + (o.filter === f.id ? ' is-on' : ''), 'data-vc-branch-filter': f.id, 'aria-pressed': o.filter === f.id ? 'true' : 'false', 'data-press': 'button', 'data-log': 'vc.branch.page.filter' }
    if (typeof o.onFilter === 'function') {
      const fid = f.id
      attrs.onClick = function () { o.onFilter(fid) }
    }
    kids.push(h('button', attrs, t(f.label)))
  }
  return h('div', { key: 'filters', className: 'page-filters' }, kids)
}

// 工具行之二：按分支名搜索。受控输入（组件路径给 onChange）与静态树（给 defaultValue）共用这一份。
const vcBranchSearchNodeOf = function (h: any, t: any, o: any) {
  const input: any = { key: 'input', type: 'search', className: 'page-search-input', 'data-vc-branch-query': '1', placeholder: t('vc.shell.branch2.searchPlaceholder') }
  if (typeof o.onQuery === 'function') { input.value = o.query; input.onChange = o.onQuery } else { input.defaultValue = o.query }
  return h('label', { key: 'search', className: 'page-search' }, [
    h('span', { key: 'sr', className: 'sr-only' }, t('vc.shell.branch2.searchPlaceholder')),
    h('input', input),
  ])
}

// 段内空态：一句话说清这里为什么是空的，再补一句下一步；绝不画假行。
const vcBranchEmptyOf = function (h: any, t: any, titleKey: string, nextKey: string, cls: string) {
  return h('div', { key: 'empty', className: cls }, [
    h('span', { key: 'title', className: 'vcs-branch2-empty-title' }, t(titleKey)),
    h('span', { key: 'next', className: 'vcs-branch2-empty-next' }, t(nextKey)),
  ])
}

// ① 分支段：版本门 → 筛选 → 搜索 → 分支行 → 名单折叠。
const vcBranchBranchesSectionOf = function (h: any, t: any, board: any, view: any) {
  const rows: any[] = Array.isArray(board.branches) ? board.branches : []
  const matched = vcBranchMatchedOf(board, view.filter, view.query)
  const narrowed = view.filter !== 'all' || String(view.query || '') !== ''
  const kids: any[] = []
  const degraded = vcBranchDegradedOfNode(h, t, board)
  if (degraded) kids.push(degraded)
  kids.push(vcBranchFiltersNodeOf(h, t, view))
  kids.push(vcBranchSearchNodeOf(h, t, view))
  // 行列表：容器常驻（门禁按它数读数与筛选结果），行按筛选后的顺序画；一行不剩时由空态顶上。
  const listKids: any[] = []
  if (matched.length > 0) {
    listKids.push(h('div', { key: 'rows', className: 'obj-list' }, matched.map(function (b: any) { return vcBranchRowOf(h, t, board, view, b) })))
  } else if (rows.length === 0) {
    listKids.push(vcBranchEmptyOf(h, t, 'vc.shell.branch2.noBranches', 'vc.shell.branch2.noBranchesNext', 'vcs-branch2-empty'))
  } else {
    listKids.push(vcBranchEmptyOf(h, t, 'vc.shell.branch2.filterEmpty', 'vc.shell.branch2.filterEmptyNext', 'vcs-branch2-empty-filter'))
  }
  // 「显示 3 / 共 62 个分支」只在筛选或搜索真的收窄了范围时才画；不筛的时候它只是重复段标题里的条数。
  if (narrowed) listKids.push(h('p', { key: 'scope', className: 'vcs-branch2-scope' }, t('vc.shell.branch2.scope', { shown: String(matched.length), total: String(rows.length) })))
  kids.push(h('div', {
    key: 'list',
    className: 'vcs-branch2-list',
    'data-vc-branch-list': String(rows.length),
    'data-vc-branch-scope': String(matched.length),
  }, listKids))
  // 4.8 两张名单收进折叠区：DOM 一直在（门禁的数与属性都读得到），默认不占首屏。
  const merged: any[] | null = Array.isArray(board.merged) ? board.merged : null
  const notMerged: any[] | null = Array.isArray(board.notMerged) ? board.notMerged : null
  if (merged && notMerged) {
    kids.push(h('details', { key: 'lists', className: 'vcs-branch2-lists', 'data-vc-branch-merged': String(merged.length), 'data-vc-branch-notmerged': String(notMerged.length) }, [
      h('summary', { key: 'sum', className: 'vcs-branch2-summary', 'data-press': 'button', 'data-log': 'vc.branch.page.lists' }, t('vc.shell.branch2.listsTitle')),
      h('p', { key: 'mh', className: 'vcs-branch2-h' }, t('vc.shell.branch2.merged')),
      h('p', { key: 'm', className: 'vcs-branch2-names', 'data-vc-branch-merged-list': merged.join(',') }, merged.join('、') || t('vc.shell.branch2.none')),
      h('p', { key: 'nh', className: 'vcs-branch2-h' }, t('vc.shell.branch2.notMerged')),
      h('p', { key: 'n', className: 'vcs-branch2-names', 'data-vc-branch-notmerged-list': notMerged.join(',') }, notMerged.join('、') || t('vc.shell.branch2.none')),
    ]))
  }
  return vcPageSectionNode(h, t, {
    title: 'vc.shell.branch2.section.branches',
    countText: vcBranchTextOf(t, 'vc.shell.branch2.branchesCount', { n: String(rows.length) }),
    note: 'vc.shell.branch2.note.branches',
    children: kids,
  })
}

// ② 标签段：一行一个标签；没有标签时给空态，不画空列表。
const vcBranchTagsSectionOf = function (h: any, t: any, board: any, view: any) {
  const tags: any[] = Array.isArray(board.tags) ? board.tags : []
  const kids: any[] = []
  if (tags.length > 0) {
    kids.push(h('div', { key: 'rows', className: 'obj-list', 'data-vc-tag-list': String(tags.length) }, tags.map(function (tag: any) { return vcBranchTagRowOf(h, t, view, tag) })))
  } else {
    kids.push(h('div', { key: 'empty', className: 'vcs-branch2-list', 'data-vc-tag-list': '0' }, [
      vcBranchEmptyOf(h, t, 'vc.shell.branch2.noTags', 'vc.shell.branch2.noTagsNext', 'vcs-branch2-empty'),
    ]))
  }
  return vcPageSectionNode(h, t, {
    title: 'vc.shell.branch2.section.tags',
    countText: vcBranchTextOf(t, 'vc.shell.branch2.tagsCount', { n: String(tags.length) }),
    note: 'vc.shell.branch2.note.tags',
    children: kids,
  })
}

// ③ 上游跟踪段：四条事实。值全部来自这一次读回包，缺哪一条就说「没有」，不补 0、不编依据。
const vcBranchTrackingSectionOf = function (h: any, t: any, board: any) {
  const rows: any[] = Array.isArray(board.branches) ? board.branches : []
  const currentName = board.current ? String(board.current.name || '') : ''
  let currentRow: any = null
  for (let i = 0; i < rows.length; i += 1) if (rows[i] && (rows[i].current === true || String(rows[i].name || '') === currentName)) currentRow = rows[i]
  const upstream = currentRow ? String(currentRow.upstream || '') : ''
  const ahead = currentRow ? Number(currentRow.ahead) || 0 : 0
  const behind = currentRow ? Number(currentRow.behind) || 0 : 0
  const currentGone = !!(currentRow && currentRow.gone === true)
  const syncText = upstream === ''
    ? vcBranchTextOf(t, 'vc.shell.branch2.noUpstream')
    : (currentGone
      ? vcBranchTextOf(t, 'vc.shell.branch2.upstreamGone')
      : (ahead === 0 && behind === 0
        ? vcBranchTextOf(t, 'vc.shell.branch2.inSync')
        : vcBranchTextOf(t, 'vc.shell.branch2.aheadBehind', { ahead: String(ahead), behind: String(behind) })))
  // 读时刻只用来算「读于多久之前」这一句：它不是可调时长，所以不新起一个带时间后缀的名字。
  const readAt = Number(board.readAtMs) || 0
  const basis = readAt > 0
    ? vcBranchTextOf(t, 'vc.shell.branch2.basis.known', { when: vcBranchWhenOf(t, readAt, readAt) })
    : vcBranchTextOf(t, 'vc.shell.branch2.basis.unknown')
  const facts: any[] = [
    { key: 'vc.shell.branch2.fact.current', value: currentName || vcBranchTextOf(t, 'vc.shell.branch2.unknown'), mono: currentName !== '', attrs: { 'data-vc-branch-current': currentName } },
    { key: 'vc.shell.branch2.fact.upstream', value: upstream === '' ? vcBranchTextOf(t, 'vc.shell.branch2.noUpstream') : upstream, mono: upstream !== '' },
    { key: 'vc.shell.branch2.fact.sync', value: syncText },
    { key: 'vc.shell.branch2.fact.basis', value: basis },
  ]
  return vcPageSectionNode(h, t, {
    title: 'vc.shell.branch2.section.tracking',
    note: 'vc.shell.branch2.note.tracking',
    children: [vcPageFactGridNode(h, t, { facts: facts })],
  })
}

// 「这一次没读到」的两种情形，说清同一件事：没读到什么、为什么，还有没有旧数据可看。
//   ① 有旧数据：贴在正文最上面一条常驻提示，明说下面那片是上一次读到的；
//   ② 没有旧数据：由 vcBranchNoDataOf 顶替三段正文，页面不会只剩空白。
const vcBranchReasonOf = function (t: any, err: any) {
  if (err && String(err.message || '') !== '') return String(err.message)
  if (err && String(err.kind || '') === 'shape') return vcBranchTextOf(t, 'vc.shell.branch2.reasonShape')
  return vcBranchTextOf(t, 'vc.shell.branch2.reasonUnknown')
}

const vcBranchRetryOf = function (h: any, t: any, opts: any, key: string) {
  if (typeof opts.onRetry !== 'function') return null
  return h('button', { key: key, type: 'button', className: 'vcs-branch2-act', 'data-vc-branch2-retry': '1', 'data-press': 'button', 'data-log': 'vc.branch.page.retry', onClick: opts.onRetry }, t('vc.shell.state.retry'))
}

const vcBranchStaleNoticeOf = function (h: any, t: any, opts: any, board: any, state: string) {
  if (!board || (state !== 'err' && state !== 'loading')) return null
  const kids: any[] = []
  if (state === 'loading') {
    kids.push(h('span', { key: 'text', className: 'vcs-branch2-note' }, t('vc.shell.branch2.loading')))
  } else {
    kids.push(h('span', { key: 'text', className: 'vcs-branch2-note' }, t('vc.shell.branch2.readFail', { reason: vcBranchReasonOf(t, opts.error) })))
    kids.push(h('span', { key: 'stale', className: 'vcs-branch2-note' }, t('vc.shell.branch2.readFailStale')))
  }
  const retry = vcBranchRetryOf(h, t, opts, 'retry')
  if (retry) kids.push(retry)
  return h('div', { key: 'state', className: state === 'err' ? 'vcs-branch2-error' : 'vcs-branch2-warn', 'data-vc-branch-state': state }, kids)
}

// 没读数时的那一块：读失败说失败原因，正在读说正在读，还没开始读说还没开始；
//   三种都带重试入口（有回调才画）。BR21 判据认 data-vc-branch2-empty=1，就在这块上。
const vcBranchNoDataOf = function (h: any, t: any, opts: any, state: string) {
  let textKey = 'vc.shell.branch2.empty'
  if (state === 'err') textKey = 'vc.shell.branch2.readFail'
  else if (state === 'loading') textKey = 'vc.shell.branch2.loading'
  const text = state === 'err'
    ? vcBranchTextOf(t, textKey, { reason: vcBranchReasonOf(t, opts.error) })
    : vcBranchTextOf(t, textKey)
  const kids: any[] = [h('span', { key: 'text', className: state === 'err' ? 'vcs-branch2-error-text' : 'vcs-branch2-empty' }, text)]
  const retry = vcBranchRetryOf(h, t, opts, 'retry')
  if (retry) kids.push(retry)
  return h('div', { key: 'nodata', className: 'vcs-branch2-nodata', 'data-vc-branch2-empty': '1', 'data-vc-branch-state': state || 'idle' }, kids)
}

// 页尾：十个写动作的入口，默认收起，DOM 与 data-vc-branch-forms 一直在（818 BR21 / D30 都读它）。
//   需要输入的动作各带一个 [data-vc-branch-input]，vcRealBranchFieldsOf 按 kind 拆参数。
const vcBranchFormsOf = function (h: any, t: any) {
  const rows: any[] = []
  for (let i = 0; i < VC_BRANCH_ACTIONS.length; i += 1) {
    const act = VC_BRANCH_ACTIONS[i]
    const kids: any[] = [h('span', { key: 'label', className: 'vcs-branch2-op-label' }, t(act.label))]
    if (act.form) kids.push(h('input', { key: 'input', type: 'text', className: 'vcs-branch2-input', 'data-vc-branch-input': act.kind, placeholder: t('vc.shell.branch2.inputHint') }))
    kids.push(h('button', { key: 'go', type: 'button', className: 'vcs-branch2-act', 'data-vc-branch-action': act.kind, 'data-vc-op': act.op, 'data-vc-branch-form': act.form ? '1' : '0', 'data-press': 'button', 'data-log': 'vc.branch.page.go.' + act.kind }, t('vc.shell.branch2.go')))
    rows.push(h('div', { key: act.op, className: 'vcs-branch2-op', 'data-vc-op-row': act.op }, kids))
  }
  return h('details', { key: 'forms', className: 'vcs-branch2-forms', 'data-vc-branch-forms': String(rows.length) }, [
    h('summary', { key: 'sum', className: 'vcs-branch2-summary', 'data-press': 'button', 'data-log': 'vc.branch.page.forms' }, t('vc.shell.branch2.formsTitle')),
    h('div', { key: 'rows', className: 'vcs-branch2-form-rows' }, rows),
  ])
}

// 面板骨架：三段固定顺序（分支 → 标签 → 上游跟踪）→ 写动作折叠区 → 确认卡 → 结果（BR22 / BR23b）。
//   页头由页面壳画，这里不重复标题与导语；筛选与搜索只影响分支行，标签与事实格照旧全画。
export const vcBranchTreeOf = function (h: any, t: any, o: any) {
  const opts: any = o || {}
  const board: any = vcBranchShapeOk(opts.board) ? opts.board : null
  const state: string = String(opts.state || '').trim()
  const nowMs: any = Number(opts.nowMs) > 0 ? Number(opts.nowMs) : 0
  const filter: string = ['all', 'current', 'unmerged'].indexOf(String(opts.filter || 'all')) >= 0 ? String(opts.filter || 'all') : 'all'
  const query: string = String(opts.query === null || opts.query === undefined ? '' : opts.query).trim()
  const view: any = { nowMs: nowMs, filter: filter, query: query, onFilter: opts.onFilter, onQuery: opts.onQuery }
  const kids: any[] = []
  const stale = vcBranchStaleNoticeOf(h, t, opts, board, state)
  if (stale) kids.push(stale)
  if (board) {
    kids.push(vcBranchBranchesSectionOf(h, t, board, view))
    kids.push(vcBranchTagsSectionOf(h, t, board, view))
    kids.push(vcBranchTrackingSectionOf(h, t, board))
  } else {
    kids.push(vcBranchNoDataOf(h, t, opts, state))
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
    state: props.state,
    error: props.error,
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
