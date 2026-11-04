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
// #1881 收口后每行左边仍是三行字（它是什么、现在什么状态、最近发生了什么），右边只留两件：
// 「切换」直给（这一页最常做的事），其余五个低频整理动作（删除分支、重命名、切到这个提交、
// 设置或取消上游、写分支说明）收进行尾一颗「⋯」菜单。页尾折叠区只剩两条没有行内入口的写动作：
// 新建并切换分支、建标签。卡片的行序先当前分支，其余保持读数的顺序——读者打开这一页第一眼要看到「我在哪」。
// ② ③ 两段与它们共用的小工具住在 vcBranchSections.ts（#1881 拆出：本文件当时已用到 346 / 350 有效行）。
// 最后才是确认卡与结果——结果永远贴在触发它的那一块之后。
//
// 两条硬约束（改之前先看）：
// 1) vcBranchTreeOf 是纯函数、直接搭宿主元素树：门禁 verify-1586-branches 用假 h 走这一条，
//    并直接读根元素的 data-vc-branch-*；它不会执行 React 组件，所以这里不能把树交给组件去画。
// 2) 十条写动作的 data-vc-op 与逐行顺序是 818 BR20/BR21/BR23 的判据：行内按钮、行内菜单、
//    页尾表单三处都要在 DOM 里。行序是「当前分支排第一、其余按读数顺序」（#1881）——
//    BR20 只验集合与存在，行序由 verify-1586-vc-visual-browser 与 1858 真机场景判。
declare const React: any
declare const vcShellConfirmCardNode: any
declare const vcShellResultNode: any
declare const vcBranchShapeOk: any
declare const vcBranchDegradedOf: any
declare const VC_BRANCH_OP_IDS: any[]
declare const VC_BRANCH_WRITE_OPS: any[]
declare const VC_BRANCH_ACTIONS: any[]
// ② ③ 两段与它们共用的小工具（#1881 拆到 vcBranchSections.ts，注入次序排在本文件之前）。
declare const vcBranchTextOf: any
declare const vcBranchOidTextOf: any
declare const vcBranchWhenOf: any
declare const vcBranchEmptyOf: any
declare const vcBranchTagsSectionOf: any
declare const vcBranchTrackingSectionOf: any
// 来自页面骨架原语 vcPageHead.ts（#1829 阶段 4）：分区与对象行两件，本页正文用它画。
declare function vcPageSectionNode(h: any, t: any, o: any): any
declare function vcPageObjRowNode(h: any, t: any, o: any): any

// 三颗筛选胶囊：全部 / 当前分支 / 未并入当前分支。文案来自词表，值只认这三个标识。
const vcBranchFiltersOf = function (_t: any) {
  return [{ id: 'all', label: 'vc.shell.branch2.filterAll' }, { id: 'current', label: 'vc.shell.branch2.filterCurrent' }, { id: 'unmerged', label: 'vc.shell.branch2.filterUnmerged' }]
}

// 筛选与搜索：只筛画出来的行，不动读数本身。留下来的行先按「当前分支排第一」整理，
// 其余保持 board.branches 的读数顺序（#1881）：只把当前那一行挪到最前，不做整体重排，
// 所以 4.8 的两张名单与行内的先后都不受影响（BR20 判顺序时也照这条规则给期望）。
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
  for (let i = 1; i < out.length; i += 1) {
    const b = out[i]
    if (b.current === true || (currentName !== '' && String(b.name || '') === currentName)) {
      out.splice(i, 1)
      out.unshift(b)
      break
    }
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
//   [data-vc-op-row] 必须是输入框的祖先，vcRealBranchFieldsOf 靠它 querySelector 读输入值；
//   spec.danger 只给「删除分支」这类危险动作加红边（形状与别的按钮一致，不靠大小抢注意力）。
const vcBranchOpRowOf = function (h: any, t: any, spec: any) {
  const kids: any[] = [h('span', { key: 'label', className: 'vcs-branch2-op-label' }, t(spec.label))]
  if (spec.form) kids.push(h('input', { key: 'input', type: 'text', className: 'vcs-branch2-input', 'data-vc-branch-input': spec.kind, placeholder: t(spec.hint || 'vc.shell.branch2.inputHint'), defaultValue: String(spec.value || '') }))
  const cls = 'vcs-branch2-act' + (spec.danger === true ? ' vcs-branch2-danger' : '')
  kids.push(h('button', { key: 'go', type: 'button', className: cls, 'data-vc-branch-action': spec.kind, 'data-vc-op': spec.op, 'data-vc-branch-form': spec.form ? '1' : '0', 'data-press': 'button', 'data-log': 'vc.branch.page.go.' + spec.kind }, t('vc.shell.branch2.go')))
  return h('div', { key: spec.op, className: 'vcs-branch2-op', 'data-vc-op-row': spec.op }, kids)
}

// 每个动作落在哪一处（#1881）：菜单五项与页尾两项都只登记「能力号 + 先后次序」这一件事，
//   kind / 文案 / 要不要输入框一律回数据层的 VC_BRANCH_ACTIONS 取——那张表已经有这四列，
//   这里再抄一份就会在加动作或改 kind 时漏掉一处（页尾那个「不在名单里就跳过」会静默吞掉它）。
//   菜单顺序是读者从「删掉这条」看到「补一句说明」的次序，与账本编号顺序无关。
const VC_BRANCH_MENU_OPS: string[] = ['4.6', '4.5', '4.4', '4.7', '4.13']

// 按能力号回 VC_BRANCH_ACTIONS 取那一条；找不到就回 null（调用方跳过，绝不自己编 kind）。
const vcBranchActOf = function (op: any) {
  for (let i = 0; i < VC_BRANCH_ACTIONS.length; i += 1) if (String(VC_BRANCH_ACTIONS[i].op) === String(op)) return VC_BRANCH_ACTIONS[i]
  return null
}

// 菜单里那两项的展示细节：删除红边（危险动作），重命名预填「旧分支名 + 空格」并换一句提示。
//   别的动作没有额外细节，返回空对象。
const vcBranchMenuExtraOf = function (name: string, op: any) {
  const act = vcBranchActOf(op)
  const kind = act ? String(act.kind) : ''
  if (kind === 'delete') return { danger: true }
  if (kind === 'rename') return { hint: 'vc.shell.branch2.renameHint', value: name + ' ' }
  return {}
}

// 行尾那颗「⋯」菜单（#1881）：五个低频整理动作按「删除 → 重命名 → 切到这个提交 → 设置或取消上游 →
//   写分支说明」排。菜单里每一项都是 vcBranchOpRowOf 画的一行，data-vc-op 与能力号不变；
//   分支名不从菜单上取——事件委托按最近的 data-vc-branch-row 认行，所以行上那个属性不能丢。
const vcBranchMenuOf = function (h: any, t: any, name: string) {
  const label = t('vc.shell.branch2.moreActions')
  const kids: any[] = [
    h('summary', { key: 'sum', title: label, 'aria-label': label, 'data-press': 'button', 'data-log': 'vc.branch.page.menu' }, '⋯'),
  ]
  for (let i = 0; i < VC_BRANCH_MENU_OPS.length; i += 1) {
    const op = VC_BRANCH_MENU_OPS[i]
    const act = vcBranchActOf(op)
    if (!act) continue
    const extra: any = vcBranchMenuExtraOf(name, op)
    const spec: any = { op: act.op, kind: act.kind, label: act.label, form: act.form === true, danger: extra.danger === true }
    if (spec.form) {
      if (extra.hint) spec.hint = extra.hint
      if (extra.value) spec.value = extra.value
    }
    kids.push(vcBranchOpRowOf(h, t, spec))
  }
  return h('details', { key: 'menu', className: 'vcs-branch2-more', 'data-vc-branch-menu': name }, kids)
}

// 一条分支行（原型 obj-row 的三行结构）：
//   标题行 = 等宽分支名 + 当前分支标记 + 提交短号；事实行 = 上游关系、领先落后、并入情况；
//   说明行 = 最近提交时间 · 分支说明（说明来自 git config，读回包里本来就有）。
// 行尾两件（#1881）：「切换」直给，「⋯」里收着其余五个整理动作——直给四个会把行撑成两行，
//   而且红色的「删除」与常用的「切换」并排时是同一种视觉重量。
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
    vcBranchMenuOf(h, t, name),
  ]
  return vcPageObjRowNode(h, t, { main: main, side: side, attrs: { 'data-vc-branch-row': name } })
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

// 「这一次没读到」的两种情形，说清同一件事：没读到什么、为什么，还有没有旧数据可看。
//   ① 有旧数据：贴在正文最上面一条常驻提示，明说下面那片是上一次读到的；
//   ② 没有旧数据：由 vcBranchNoDataOf 顶替三段正文，页面不会只剩空白。
const vcBranchReasonOf = function (t: any, err: any) {
  if (err && String(err.message || '') !== '') return String(err.message)
  if (err && String(err.kind || '') === 'shape') return vcBranchTextOf(t, 'vc.shell.branch2.reasonShape')
  return vcBranchTextOf(t, 'vc.shell.branch2.reasonUnknown')
}

const vcBranchRetryOf = function (h: any, t: any, opts: any, key: string) {
  return typeof opts.onRetry !== 'function' ? null : h('button', { key: key, type: 'button', className: 'vcs-branch2-act', 'data-vc-branch2-retry': '1', 'data-press': 'button', 'data-log': 'vc.branch.page.retry', onClick: opts.onRetry }, t('vc.shell.state.retry'))
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

// 页尾只留两条没有行内入口的写动作（#1881）：新建并切换分支（4.2）与建标签（4.10）。
//   其余八条都已经在行里（切换 / 行内「⋯」菜单 / 标签行），页尾再画一遍会让读者先判断
//   「这两个是不是一回事」。行数写进 data-vc-branch-forms，818 BR20d 按它判。
const VC_BRANCH_FOOTER_OPS: string[] = ['4.2', '4.10']

// 页尾：两条写动作的入口，默认收起，DOM 与 data-vc-branch-forms 一直在（818 BR21 / D30 都读它）。
//   需要输入的动作各带一个 [data-vc-branch-input]，vcRealBranchFieldsOf 按 kind 拆参数。
const vcBranchFormsOf = function (h: any, t: any) {
  const rows: any[] = []
  for (let i = 0; i < VC_BRANCH_FOOTER_OPS.length; i += 1) {
    const act = vcBranchActOf(VC_BRANCH_FOOTER_OPS[i])
    if (!act) continue
    rows.push(vcBranchOpRowOf(h, t, { op: act.op, kind: act.kind, label: act.label, form: act.form === true }))
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
