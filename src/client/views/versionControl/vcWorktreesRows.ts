// src/client/views/versionControl/vcWorktreesRows.ts —— 工作区页的逐行画法与清单（#1904 从 vcWorktreesView 拆出）
//
// 为什么拆：一行里要同时画事实、动作行、移动表单与稀疏检出面板，版式叶子放不下；这一叶只画一行与清单。
// 约定：确认卡仍由页面叶的 vcWtConfirmNode 提供（本文件只借用，不自己拼四段卡）；所有可见文字走 t(词条)。
//
// 下面这些名字在构建后的闭包里真实存在（另有同名声明与它们对上），本文件单独过 tsc 时靠 declare 补形状。
declare function vcWtViewStr(v: any): string
declare function vcWorktreesSplitPathOf(p: any): any
declare function vcWorktreesAbnormalOf(row: any): boolean
declare function vcWtChipNode(h: any, key: string, tone: string, label: string, mono: boolean): any
declare function vcWtCopyButtonNode(h: any, t: any, key: string, path: string, className: string, ariaKey: string): any
declare function vcWtStateChipsOf(h: any, t: any, row: any): any[]
declare function vcWtFactNode(h: any, key: string, label: string, value: string, mono: boolean, extra: any): any
declare function vcWtIconNode(h: any, name: string, size: number): any
declare function vcWtActionButtonNode(h: any, t: any, o: any): any
declare function vcWtFormOpenButtonNode(h: any, t: any, o: any): any
declare function vcWtMoveFormNode(h: any, t: any, row: any, ui: any, ops: any): any
declare function vcWtSparsePanelNode(h: any, t: any, row: any, ui: any, ops: any): any
declare function vcWorktreesRowActionsOf(model: any, row: any): any[]
declare function vcWorktreesActionDecisionOf(model: any, op: any, input: any): any
declare function vcWorktreeCall(ops: any, name: string, args?: any[]): any
declare function vcShellStateNode(h: any, t: any, o: any): any
declare function vcWtConfirmNode(h: any, t: any, ui: any, ops: any): any

/** 这份文件的出处：排查时凭它找到这份文件。 */
export const VC_WORKTREES_ROWS_SOURCE: string = 'src/client/views/versionControl/vcWorktreesRows.ts'

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
  if (head !== '') nameRow.push(h('span', { key: 'oid', className: 'wt-oid mono', 'data-wt-row-oid': head, 'aria-label': t('vc.wt.oidHint'), title: t('vc.wt.oidHint') }, head.slice(0, 7)))
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
  // 已经保存过稀疏规则的话，展开行里常驻一句「当前规则：只保留 …」（原型 96 的那一行）。
  const rules: string[] = Array.isArray(ui.sparseRules && ui.sparseRules[path]) ? ui.sparseRules[path] : []
  if (rules.length > 0) {
    detailKids.push(vcWtFactNode(h, 'fact-sparse', t('vc.wt.sparse.title'),
      t('vc.wt.sparse.current', { dirs: rules.join(String(t('vc.wt.listSep'))) }), false, { 'data-wt-sparse-current': path }))
  }
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
  // 移动与稀疏检出贴着这一行就地展开：读者能一边看当前路径与规则，一边改，不用跳到别的页面。
  acts.push(vcWtFormOpenButtonNode(h, t, {
    op: 'move-open', capId: '9.7', label: t('vc.wt.action.move'), path: path,
    decision: vcWorktreesActionDecisionOf(model, 'move', { path: path }), ops: ops,
  }))
  acts.push(vcWtFormOpenButtonNode(h, t, {
    op: 'sparse-open', capId: '9.8', label: t('vc.wt.action.sparse-list'), path: path,
    decision: vcWorktreesActionDecisionOf(model, 'sparse-list', { path: path }), ops: ops,
  }))
  acts.push(vcWtActionButtonNode(h, t, {
    key: 'remove', op: 'remove', capId: '9.4', label: t('vc.wt.action.remove'),
    decision: vcWorktreesActionDecisionOf(model, 'remove', { path: path }), path: path, ops: ops, danger: true,
  }))
  detailKids.push(h('div', { key: 'actions-row', className: 'wt-actions-row', 'data-wt-row-actions': '1' }, acts))
  // 危险动作的确认卡贴在触发它的那一行里（原型 04/12：卡在行下方展开处），不跳到页面另一头。
  const confirmHere: any = vcWtRowConfirmHere(ui, path) ? vcWtConfirmNode(h, t, ui, ops) : null
  if (confirmHere) detailKids.push(confirmHere)
  if (vcWtViewStr(ui.move && ui.move.path) === path) detailKids.push(vcWtMoveFormNode(h, t, row, ui, ops))
  if (vcWtViewStr(ui.sparse && ui.sparse.path) === path) detailKids.push(vcWtSparsePanelNode(h, t, row, ui, ops))
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
  // 这一行有表单或确认卡开着时必须展开：切页签再回来、或别的读数触发重画时，
  //   原生 details 的展开状态不归我们管，不补这个 open 会把刚填的表单藏进收起行里。
  const keepOpen: boolean = vcWtViewStr(ui.move && ui.move.path) === path || vcWtViewStr(ui.sparse && ui.sparse.path) === path || confirmHere !== null
  return h('details', {
    key: path, className: 'wt-row-wrap', onToggle: syncOpen, open: keepOpen || undefined,
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
  // 刚建完的那一棵排到最前（原型 97：刚建出来的工作区要一眼看见），其余保持读数顺序。
  const lastCreated: string = vcWtViewStr(ui.lastCreated)
  if (lastCreated !== '') {
    const at: number = shown.map(function (r: any): string { return vcWtViewStr(r.path) }).indexOf(lastCreated)
    if (at > 0) { const one: any = shown.splice(at, 1)[0]; shown.unshift(one) }
  }
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
