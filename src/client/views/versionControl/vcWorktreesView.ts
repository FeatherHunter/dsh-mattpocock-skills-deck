// src/client/views/versionControl/vcWorktreesView.ts —— 工作树页的版式（#1860 整页还原）
//
// 这一层只画版式：可关闭说明条 → 当前工作区卡 → 其他工作区头（计数/筛选/说明条重开）→
// 行清单（行主体、复制、展开箭头；展开后三行事实、锁定或待清理的补充事实、动作行）→
// 底部交接入口。读数由 vcWorktreesData 算，动作由 vcWorktreesOps 执行，本文件不发电话、
// 不存状态；行的展开用原生 details（处理层的 ui 里没有展开状态），筛选与说明条的开合
// 交给处理层写 ui。
//
// DOM 结构与类名照原型 docs/prototype/vc-redesign/src/ui/views/worktrees.ts 与
// src/client/views/versionControl/vcProtoWorktrees.ts 里的 .wt-* 选择器画：
//   div.view.view-worktrees > aside.wt-notice / section.wt-current / div.wt-head /
//   div.wt-list（details.wt-row-wrap > summary.wt-row + div.wt-detail）/ div.wt-foot。
// 能力入口不再单独占一块折叠区：行展开后的动作行只保留原型里有的三条（解锁、清除记录、
// 移除），其余能力的唯一主入口是命令面板（#1860 能力清单退役，票面里的对照表）。
//
// 可见文字全部走 t(词条)，词条真源 config/copy/vcworktrees.yaml；本文件不写可见字面量。

declare function vcWorktreesRowActionsOf(model: any, row: any): any[]
declare function vcWorktreesActionDecisionOf(model: any, op: any, input: any): any
declare function vcWorktreeDecisionStateOf(decision: any): string
declare function vcWorktreeDecisionReasonsOf(decision: any): string[]
declare function vcWorktreeWhyKeyOf(reason: any): string
declare function vcWorktreeCall(ops: any, name: string, args?: any[]): any
declare function vcShellStateNode(h: any, t: any, o: any): any

/** 这份文件的出处：排查时凭它找到这份文件。 */
export const VC_WORKTREES_VIEW_SOURCE: string = 'src/client/views/versionControl/vcWorktreesView.ts'

const vcWtViewStr = function (v: any): string {
  return String(v === undefined || v === null ? '' : v)
}

/** 路径拆成「目录 + 名字」：两种分隔符都认，没有分隔符时目录为空。 */
export const vcWorktreesSplitPathOf = function (p: any): any {
  const raw: string = vcWtViewStr(p)
  const at: number = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'))
  if (at < 0) return { dir: '', name: raw }
  return { dir: raw.slice(0, at), name: raw.slice(at + 1) }
}

/** 一棵工作树算不算「需要处理」：锁住、锁定状态读不出、待清理，三种都算。 */
export const vcWorktreesAbnormalOf = function (row: any): boolean {
  const r: any = row || {}
  return r.locked === true || r.lockUnknown === true || r.prunable === true
}

/** 把一段文字写进剪贴板：没有剪贴板（测试环境、老浏览器）就静默不做事，不弹错。 */
export const vcWorktreesCopyTextOf = function (text: any): void {
  try {
    const nav: any = typeof navigator === 'undefined' ? null : navigator
    if (!nav || !nav.clipboard || typeof nav.clipboard.writeText !== 'function') return
    const writing: any = nav.clipboard.writeText(vcWtViewStr(text))
    if (writing && typeof writing.catch === 'function') writing.catch(function (): void {})
  } catch (e) {
    // 剪贴板被浏览器拒绝时不影响页面，用户还能手动选中路径复制。
  }
}

/** 原型里用到的三枚行内图标（copy / chevron / spark）的路径。 */
const VC_WT_ICON_PATHS: any = {
  copy: 'M8 8h10v12H8zM6 16H4V4h12v2',
  chevron: 'M9 6l6 6-6 6',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
}

const vcWtIconNode = function (h: any, name: string, size: number): any {
  const d: string = vcWtViewStr(VC_WT_ICON_PATHS[name])
  return h('svg', {
    key: 'icon', className: 'icon', viewBox: '0 0 24 24', width: size, height: size,
    fill: 'none', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': 'true',
  }, [h('path', { key: 'p', d: d })])
}

/** 一枚原型徽章：tone 取 ok / warn / error / muted。 */
const vcWtChipNode = function (h: any, key: string, tone: string, label: string, mono: boolean): any {
  return h('span', { key: key, className: 'chip chip-' + tone + ' chip-sm' + (mono ? ' mono' : '') }, label)
}

/** 行内状态徽章：正常时一枚都不画。 */
const vcWtStateChipsOf = function (h: any, t: any, row: any): any[] {
  const out: any[] = []
  if (row.locked === true) out.push(h('span', { key: 'locked', className: 'chip chip-warn chip-sm', 'data-wt-state': 'locked', 'aria-label': t('vc.wt.locked'), title: t('vc.wt.locked') }, t('vc.wt.locked')))
  if (row.lockUnknown === true) out.push(h('span', { key: 'lockUnknown', className: 'chip chip-muted chip-sm', 'data-wt-state': 'lock-unknown' }, t('vc.wt.lockUnknown')))
  if (row.prunable === true) out.push(h('span', { key: 'prunable', className: 'chip chip-error chip-sm', 'data-wt-state': 'prunable' }, t('vc.wt.prunable')))
  return out
}

/** 复制按钮：行内与当前卡共用的图标按钮；点在 summary 里时不顺带展开。 */
const vcWtCopyButtonNode = function (h: any, t: any, key: string, path: string, className: string, ariaKey: string): any {
  return h('button', {
    key: key, type: 'button', className: className,
    title: t('vc.wt.copyPath'), 'aria-label': t(ariaKey),
    'data-wt-action': 'copy-path', 'data-wt-copy-path': path,
    'data-press': 'button', 'data-log': 'vc.wt.copy-path',
    onClick: function (ev: any) {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault()
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation()
      vcWorktreesCopyTextOf(path)
    },
  }, vcWtIconNode(h, 'copy', 14))
}

/** 可关闭说明条：默认展开，点 × 收起；收起的说明用头里那颗 ? 再打开。 */
const vcWtNoticeNode = function (h: any, t: any, ui: any, ops: any): any {
  if (ui.noteOpen === false) return null
  return h('aside', { key: 'notice', className: 'wt-notice', role: 'note', 'data-wt-notice': '1' }, [
    h('span', { key: 'text', className: 'wt-notice-text' }, t('vc.wt.notice')),
    h('button', {
      key: 'close', type: 'button', className: 'wt-notice-close',
      title: t('vc.wt.noticeClose'), 'aria-label': t('vc.wt.noticeClose'),
      'data-wt-action': 'note-close', 'data-press': 'button', 'data-log': 'vc.wt.note-close',
      onClick: function () { vcWorktreeCall(ops, 'view', [{ noteOpen: false }]) },
    }, t('vc.wt.noticeCloseGlyph')),
  ])
}

/** 当前工作区卡：chip 当前 + 名字 + 分支或「无分支」+ 短号 + 复制按钮，下面一行完整路径。 */
const vcWtCurrentNode = function (h: any, t: any, row: any): any {
  if (!row) return null
  const rawPath: string = vcWtViewStr(row.path)
  const path: string = rawPath === '' ? vcWtViewStr(row.display) : rawPath
  const split: any = vcWorktreesSplitPathOf(path)
  const name: string = split.name === '' ? vcWtViewStr(row.display) : split.name
  const branch: string = vcWtViewStr(row.branch)
  const head: string = vcWtViewStr(row.head)
  const kids: any[] = [
    vcWtChipNode(h, 'current', 'ok', t('vc.wt.currentTitle'), false),
    h('span', { key: 'name', className: 'wt-name mono', 'aria-label': path, title: path }, name),
  ]
  if (branch === '') kids.push(vcWtChipNode(h, 'branch', 'muted', t('vc.wt.noBranch'), false))
  else kids.push(h('span', { key: 'branch', className: 'wt-branch', 'aria-label': t('vc.wt.factBranch'), title: t('vc.wt.factBranch') }, [h('span', { key: 'b', className: 'mono' }, branch)]))
  if (head !== '') kids.push(h('span', { key: 'oid', className: 'wt-oid mono', 'data-wt-current-oid': head, 'aria-label': t('vc.wt.oidHint'), title: t('vc.wt.oidHint') }, head.slice(0, 8)))
  kids.push(vcWtCopyButtonNode(h, t, 'copy', path, 'icon-btn wt-current-copy', 'vc.wt.currentCopy'))
  return h('section', { key: 'current', className: 'wt-current', 'data-wt-current-card': '1' }, [
    h('div', { key: 'head', className: 'wt-current-head' }, kids),
    h('div', { key: 'path', className: 'wt-current-path mono', 'aria-label': path, title: path }, path),
  ])
}

/** 筛选徽章：全部 / 需要处理；点击写回 ui.filter，徽章自己不做筛选。 */
const vcWtFilterChipNode = function (h: any, t: any, id: string, label: string, count: number, on: boolean, tone: string, ops: any): any {
  return h('button', {
    key: id, type: 'button', className: 'filter-chip tone-' + tone + (on ? ' is-on' : ''),
    'aria-pressed': on ? 'true' : 'false',
    'data-wt-filter': id, 'data-press': 'button', 'data-log': 'vc.wt.filter',
    onClick: function () { vcWorktreeCall(ops, 'view', [{ filter: id }]) },
  }, [
    h('span', { key: 'label', className: 'filter-label' }, label),
    h('span', { key: 'count', className: 'filter-count' }, String(count)),
  ])
}

/** 其他工作区头：标题 / 棵数 / 单位 / 需要处理计数 / 筛选 / 说明条重开按钮。 */
const vcWtHeadNode = function (h: any, t: any, rows: any[], ui: any, ops: any, abnormal: number): any {
  const kids: any[] = [
    h('span', { key: 'title', className: 'wt-head-title' }, t('vc.wt.headTitle')),
    h('span', { key: 'count', className: 'wt-head-count', 'data-wt-other-count': String(rows.length) }, String(rows.length)),
    h('span', { key: 'unit', className: 'wt-head-unit' }, t('vc.wt.unit')),
  ]
  if (abnormal > 0) kids.push(h('span', { key: 'alert', className: 'wt-head-alert', 'data-wt-abnormal-count': String(abnormal) }, t('vc.wt.headAlert', { n: String(abnormal) })))
  const filters: any[] = [vcWtFilterChipNode(h, t, 'all', t('vc.wt.filterAll'), rows.length, ui.filter !== 'abnormal', 'ok', ops)]
  if (abnormal > 0) filters.push(vcWtFilterChipNode(h, t, 'abnormal', t('vc.wt.filterAbnormal'), abnormal, ui.filter === 'abnormal', 'error', ops))
  kids.push(h('div', { key: 'filters', className: 'wt-filters', role: 'group', 'aria-label': t('vc.wt.filterGroup') }, filters))
  if (ui.noteOpen === false) {
    kids.push(h('button', {
      key: 'note-open', type: 'button', className: 'icon-btn wt-notice-open',
      title: t('vc.wt.noticeOpen'), 'aria-label': t('vc.wt.noticeOpen'),
      'data-wt-action': 'note-open', 'data-press': 'button', 'data-log': 'vc.wt.note-open',
      onClick: function () { vcWorktreeCall(ops, 'view', [{ noteOpen: true }]) },
    }, t('vc.wt.noticeOpenGlyph')))
  }
  return h('div', { key: 'head', className: 'wt-head', 'data-wt-head': '1' }, kids)
}

/** 三行事实：左边小标签，右边值；值可标成 mono 并带完整 title。 */
const vcWtFactNode = function (h: any, key: string, label: string, value: string, mono: boolean, extra: any): any {
  const props: any = { key: key, className: 'wt-fact' }
  if (extra) Object.keys(extra).forEach(function (k: string) { props[k] = extra[k] })
  return h('div', props, [
    h('span', { key: 'k', className: 'wt-fact-k' }, label),
    h('span', { key: 'v', className: 'wt-fact-v' + (mono ? ' mono' : ''), 'aria-label': value, title: value }, value),
  ])
}

/**
 * 动作按钮：照原型按钮的类名（btn + btn-sm + secondary/danger），行为与页面里那份一致：
 * 列表动作发 refresh，其余发 start（带当前行的路径）；判为 block 时禁用并把理由码写出来，
 * 判为 warn 时仍可点但把理由码标出来。
 */
const vcWtActionButtonNode = function (h: any, t: any, o: any): any {
  const decision: any = o.decision || null
  const blocked: boolean = decision ? vcWorktreeDecisionStateOf(decision) === 'block' : false
  const attrs: any = {
    key: o.key || o.op, type: 'button',
    className: 'btn btn-sm ' + (o.danger === true ? 'btn-danger' : 'btn-secondary'),
    'data-wt-action': String(o.op), 'data-wt-cap': String(o.capId),
    'data-press': 'button', 'data-log': 'vc.wt.row.' + String(o.op),
    onClick: function () {
      const opName: string = String(o.op)
      if (opName === 'list') return vcWorktreeCall(o.ops, 'refresh')
      const preset: any = {}
      if (o.path) preset.path = String(o.path)
      return vcWorktreeCall(o.ops, 'start', [opName, preset])
    },
  }
  if (blocked) {
    const rs: string[] = vcWorktreeDecisionReasonsOf(decision)
    const k: string = vcWorktreeWhyKeyOf(rs.length > 0 ? rs[0] : 'ok')
    attrs.disabled = true
    attrs['data-wt-why'] = k
    attrs.title = t(k)
  } else if (decision && vcWorktreeDecisionStateOf(decision) === 'warn') {
    const rs: string[] = vcWorktreeDecisionReasonsOf(decision)
    attrs['data-wt-warn'] = vcWorktreeWhyKeyOf(rs.length > 0 ? rs[0] : 'ok')
  }
  return h('button', attrs, [h('span', { key: 'label', className: 'btn-label' }, String(o.label))])
}

/** 一行：details 外壳（展开状态由浏览器记）+ summary 行主体 + 展开详情。 */
// 确认卡建在页面叶（vcWorktreesPage）里，这里只借用它把卡贴到被操作的那一行下面：
//   页面叶在本文件之后拼进同一闭包，渲染时函数已就位。
declare function vcWtConfirmNode(h: any, t: any, ui: any, ops: any): any

/** 这一行是不是本次确认的目标（remove/lock 一类按路径定位的动作）。 */
const vcWtRowConfirmHere = function (ui: any, path: string): boolean {
  if (!ui || ui.mode !== 'confirm') return false
  const plan: any = ui.plan || {}
  const input: any = ui.input || {}
  if (ui.op === 'prune') return false
  const target: string = String(plan.targetPath || input.path || '')
  return target !== '' && target === path
}

const vcWtRowNode = function (h: any, t: any, model: any, row: any, ui: any, ops: any): any {
  const rawPath: string = vcWtViewStr(row.path)
  const display: string = vcWtViewStr(row.display)
  const path: string = rawPath === '' ? display : rawPath
  const split: any = vcWorktreesSplitPathOf(path)
  const name: string = split.name === '' ? display : split.name
  const branch: string = vcWtViewStr(row.branch)
  const head: string = vcWtViewStr(row.head)
  const abnormal: boolean = vcWorktreesAbnormalOf(row)
  const nameRow: any[] = [h('span', { key: 'name', className: 'wt-name mono', 'aria-label': path, title: path }, name)]
  if (branch === '') nameRow.push(vcWtChipNode(h, 'branch', 'muted', t('vc.wt.noBranch'), false))
  else nameRow.push(h('span', { key: 'branch', className: 'wt-branch', 'aria-label': t('vc.wt.factBranch'), title: t('vc.wt.factBranch') }, [h('span', { key: 'b', className: 'mono' }, branch)]))
  if (head !== '') nameRow.push(h('span', { key: 'oid', className: 'wt-oid mono', 'data-wt-row-oid': head, 'aria-label': t('vc.wt.oidHint'), title: t('vc.wt.oidHint') }, head.slice(0, 8)))
  const main: any = h('div', { key: 'main', className: 'wt-main' }, [
    h('div', { key: 'name-row', className: 'wt-name-row' }, nameRow),
    h('div', { key: 'path', className: 'wt-path' }, [
      h('span', { key: 'dir', className: 'wt-path-dir mono' }, split.dir),
      h('span', { key: 'name', className: 'wt-path-name mono' }, split.name),
    ]),
    h('div', { key: 'states', className: 'wt-states' }, vcWtStateChipsOf(h, t, row)),
  ])
  const expander: any = h('button', {
    key: 'expander', type: 'button', className: 'icon-btn wt-expander',
    'aria-hidden': 'true', tabIndex: -1, title: t('vc.wt.expand'),
    'data-wt-action': 'expand', 'data-press': 'button', 'data-log': 'vc.wt.expand',
    onClick: function (ev: any) {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault()
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation()
      const box: any = ev && ev.currentTarget && typeof ev.currentTarget.closest === 'function' ? ev.currentTarget.closest('details') : null
      if (box) box.open = !box.open
    },
  }, vcWtIconNode(h, 'chevron', 12))
  const summary: any = h('summary', {
    key: 'summary', className: 'wt-row' + (abnormal ? ' is-abnormal' : ''),
    'aria-label': t('vc.wt.expand'),
    'data-wt-expand': path, 'data-press': 'button', 'data-log': 'vc.wt.expand',
  }, [
    main,
    h('div', { key: 'actions', className: 'wt-actions' }, [
      vcWtCopyButtonNode(h, t, 'copy', path, 'icon-btn', 'vc.wt.copyPath'),
      expander,
    ]),
  ])
  const detailKids: any[] = [
    vcWtFactNode(h, 'fact-path', t('vc.wt.factPath'), path, true, null),
    vcWtFactNode(h, 'fact-branch', t('vc.wt.factBranch'), branch === '' ? t('vc.wt.noBranch') : branch, false, null),
    vcWtFactNode(h, 'fact-head', t('vc.wt.factHead'), head, true, null),
  ]
  if (row.locked === true) detailKids.push(vcWtFactNode(h, 'fact-locked', t('vc.wt.locked'), vcWtViewStr(row.lockReason), false, { 'data-wt-detail': 'locked' }))
  if (row.prunable === true) detailKids.push(vcWtFactNode(h, 'fact-prunable', t('vc.wt.prunable'), vcWtViewStr(row.prunableReason), false, { 'data-wt-detail': 'prunable' }))
  const rowActions: any[] = vcWorktreesRowActionsOf(model, row)
  const unlockAction: any = rowActions.filter(function (a: any): boolean { return String(a.op) === 'unlock' })[0]
  const acts: any[] = []
  if (unlockAction && (row.locked === true || row.lockUnknown === true)) {
    acts.push(vcWtActionButtonNode(h, t, {
      key: 'unlock', op: 'unlock', capId: unlockAction.action.capId, label: t('vc.wt.action.unlock'),
      decision: unlockAction.decision, path: path, ops: ops,
    }))
  }
  if (row.prunable === true) {
    acts.push(vcWtActionButtonNode(h, t, {
      key: 'prune', op: 'prune', capId: '9.5', label: t('vc.wt.action.prune'),
      decision: vcWorktreesActionDecisionOf(model, 'prune', ui.input || {}), path: '', ops: ops,
    }))
  }
  acts.push(vcWtActionButtonNode(h, t, {
    key: 'remove', op: 'remove', capId: '9.4', label: t('vc.wt.action.remove'),
    decision: vcWorktreesActionDecisionOf(model, 'remove', { path: path }), path: path, ops: ops, danger: true,
  }))
  detailKids.push(h('div', { key: 'actions-row', className: 'wt-actions-row', 'data-wt-row-actions': '1' }, acts))
  // 危险动作的确认卡贴在触发它的那一行里（原型 04/12：卡在行下方展开处），不跳到页面另一头。
  const confirmHere: any = vcWtRowConfirmHere(ui, path) ? vcWtConfirmNode(h, t, ui, ops) : null
  if (confirmHere) detailKids.push(confirmHere)
  const detail: any = h('div', { key: 'detail', className: 'wt-detail' + (abnormal ? ' is-abnormal' : ''), 'data-wt-detail-box': '1' }, detailKids)
  // 原生 details 的 open 是浏览器状态：展开/收起时把 is-open 与 aria-expanded 同步到行与箭头上。
  const syncOpen = function (ev: any): void {
    try {
      const box: any = ev && ev.currentTarget
      if (!box || typeof box.querySelector !== 'function') return
      const open: boolean = !!box.open
      const sum: any = box.querySelector('summary')
      const exp: any = box.querySelector('.wt-expander')
      if (sum && sum.classList) { if (open) sum.classList.add('is-open'); else sum.classList.remove('is-open') }
      if (exp) {
        if (exp.classList) { if (open) exp.classList.add('is-open'); else exp.classList.remove('is-open') }
        exp.setAttribute('aria-expanded', open ? 'true' : 'false')
      }
    } catch (e) {
      // 同步失败只影响箭头姿态，不影响展开本身。
    }
  }
  return h('details', {
    key: path, className: 'wt-row-wrap', onToggle: syncOpen,
    'data-wt-expandable': path, 'data-wt-row': '1', 'data-wt-path': path,
    'data-wt-current': row.current === true ? '1' : '0',
    'data-wt-locked': row.locked === true ? '1' : '0',
    'data-wt-prunable': row.prunable === true ? '1' : '0',
    'data-wt-abnormal': abnormal ? '1' : '0',
  }, [summary, detail])
}

/** 清单：四态画状态、没有其他工作区画空态、筛选后为空画筛选空态，否则逐行。 */
const vcWtListNodesOf = function (h: any, t: any, model: any, ui: any, ops: any): any[] {
  const state: string = vcWtViewStr(model.state)
  const rows: any[] = Array.isArray(model.rows) ? model.rows : []
  const others: any[] = rows.filter(function (r: any): boolean { return r.current !== true })
  const want: string = ui.filter === 'abnormal' ? 'abnormal' : 'all'
  const shown: any[] = want === 'abnormal' ? others.filter(vcWorktreesAbnormalOf) : others
  let inner: any[] = []
  if (state === 'loading' || state === 'idle' || state === 'error') {
    inner = [vcShellStateNode(h, t, { state: state })]
  } else if (others.length === 0) {
    inner = [h('div', { key: 'empty', className: 'empty', 'data-wt-empty': '1' }, [
      h('div', { key: 'title', className: 'empty-title' }, t('vc.wt.empty')),
      h('div', { key: 'hint', className: 'empty-hint' }, t('vc.wt.emptyHint')),
    ])]
  } else if (shown.length === 0) {
    inner = [h('div', { key: 'filter-empty', className: 'empty', 'data-wt-filter-empty': '1' }, [
      h('div', { key: 'title', className: 'empty-title' }, t('vc.wt.filterEmpty')),
    ])]
  } else {
    inner = shown.map(function (row: any): any { return vcWtRowNode(h, t, model, row, ui, ops) })
  }
  return [h('div', { key: 'list', className: 'wt-list', 'data-wt-list': '1' }, inner)]
}

/** 底部交接入口：有异常工作区时请 AI 收尾，没有时请 AI 复查。 */
const vcWtFootNode = function (h: any, t: any, abnormal: number, onOpenHandoff: any): any {
  if (typeof onOpenHandoff !== 'function') return null
  const label: string = abnormal > 0 ? t('vc.wt.aiEntry') : t('vc.wt.aiEntryClean')
  return h('div', { key: 'foot', className: 'wt-foot' }, [
    h('button', {
      key: 'ai', type: 'button', className: 'btn btn-ghost btn-sm ai-entry ai-entry-inline',
      title: label, 'aria-label': label,
      'data-wt-handoff': '1', 'data-press': 'button', 'data-log': 'vc.wt.handoff',
      onClick: function () { onOpenHandoff({ kind: 'worktrees', summary: label }) },
    }, [vcWtIconNode(h, 'spark', 14), h('span', { key: 'label', className: 'ai-entry-label' }, label)]),
  ])
}

/**
 * 工作树页的版式节点。只组装原型里有的五块，返回一棵 div.view.view-worktrees；
 * 页面叶子（vcWorktreesPage）把拦截/计划/确认/结果这些按状态出现的面接在这棵后面。
 */
export const vcWorktreesLayoutNodesOf = function (h: any, t: any, o: any): any[] {
  const opts: any = o || {}
  const model: any = opts.model || {}
  const ui: any = opts.ui || {}
  const ops: any = opts.ops || {}
  const rows: any[] = Array.isArray(model.rows) ? model.rows : []
  const others: any[] = rows.filter(function (r: any): boolean { return r.current !== true })
  let abnormal: number = 0
  for (let i = 0; i < rows.length; i += 1) if (vcWorktreesAbnormalOf(rows[i])) abnormal += 1
  const kids: any[] = []
  const notice: any = vcWtNoticeNode(h, t, ui, ops)
  if (notice) kids.push(notice)
  const current: any = vcWtCurrentNode(h, t, model.current)
  if (current) kids.push(current)
  kids.push(vcWtHeadNode(h, t, others, ui, ops, abnormal))
  Array.prototype.push.apply(kids, vcWtListNodesOf(h, t, model, ui, ops))
  const foot: any = vcWtFootNode(h, t, abnormal, opts.onOpenHandoff)
  if (foot) kids.push(foot)
  return [h('div', { key: 'view', className: 'view view-worktrees' }, kids)]
}
