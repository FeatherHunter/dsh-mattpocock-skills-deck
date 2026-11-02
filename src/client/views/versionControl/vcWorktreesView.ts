// src/client/views/versionControl/vcWorktreesView.ts —— 工作树页的版式（#1829 阶段 3）
//
// 这一层只画版式：说明条、当前工作区、其他工作区的头与筛选、逐行清单（行尾展开详情与操作）、
// 页尾折叠的八条能力入口、底部交接入口。读数由 vcWorktreesData 算，动作由 vcWorktreesOps 执行，
// 本文件不发电话、不存状态；行的展开用原生 details（不需要额外状态），筛选与说明条的开合交给处理层写 ui。
//
// 三条不能改的约定：
//   1. 只用 data-wt-* 标记，绝不出现 data-cap-primary —— 每条能力的唯一主入口仍由页面壳的能力行负责；
//   2. 八条能力的入口整块收进页尾折叠区，但名单仍由 vcWorktreesPage 的 VC_WORKTREES_ENTRY_DEFS 一份定义；
//   3. 可见文字全部走 t(词条)，词条真源 config/copy/vcworktrees.yaml，本文件不写可见字面量。

declare function vcWorktreesRowActionsOf(model: any, row: any): any
declare function vcWtEntriesNode(h: any, t: any, model: any, ui: any, ops: any): any
declare function vcWtButtonNode(h: any, t: any, o: any): any
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

/** 行首的三个状态徽章：锁定、锁定状态未知、待清理；正常时一个都不画。 */
const vcWtStateChipsOf = function (h: any, t: any, row: any): any[] {
  const out: any[] = []
  if (row.locked === true) out.push(h('span', { key: 'locked', className: 'vc-wt-chip vc-wt-chip-warn', 'data-wt-state': 'locked' }, t('vc.wt.locked')))
  if (row.lockUnknown === true) out.push(h('span', { key: 'lockUnknown', className: 'vc-wt-chip', 'data-wt-state': 'lock-unknown' }, t('vc.wt.lockUnknown')))
  if (row.prunable === true) out.push(h('span', { key: 'prunable', className: 'vc-wt-chip vc-wt-chip-error', 'data-wt-state': 'prunable' }, t('vc.wt.prunable')))
  return out
}

/** 说明条：默认展开；点「知道了」收起，收起的说明用头里那颗「?」再打开。 */
const vcWtNoticeNode = function (h: any, t: any, ui: any, ops: any): any {
  if (ui.noteOpen === false) return null
  return h('aside', { key: 'notice', className: 'vc-wt-notice', role: 'note', 'data-wt-notice': '1' }, [
    h('span', { key: 'text', className: 'vc-wt-notice-text' }, t('vc.wt.notice')),
    h('button', {
      key: 'close', type: 'button', className: 'vc-wt-notice-close', 'data-wt-action': 'note-close', 'data-press': 'button', 'data-log': 'vc.wt.note-close',
      onClick: function () { vcWorktreeCall(ops, 'view', [{ noteOpen: false }]) },
    }, t('vc.wt.noticeClose')),
  ])
}

/** 当前工作区卡：名字、分支、短号、复制按钮与完整路径（路径不再单独占首屏一行，按定稿原型 44 收进卡里）。 */
const vcWtCurrentNode = function (h: any, t: any, row: any): any {
  const r: any = row || {}
  const path: string = vcWtViewStr(r.path)
  const split: any = vcWorktreesSplitPathOf(path === '' ? r.display : path)
  const branch: string = r.branch === '' || r.branch === undefined ? String(t('vc.wt.detached')) : String(t('vc.wt.branch')) + ' ' + vcWtViewStr(r.branch)
  return h('section', { key: 'current', className: 'vc-wt-current', 'data-wt-current-card': '1' }, [
    h('div', { key: 'head', className: 'vc-wt-current-head' }, [
      h('span', { key: 'chip', className: 'vc-wt-chip vc-wt-chip-ok' }, t('vc.wt.currentTitle')),
      h('span', { key: 'name', className: 'vc-wt-current-name' }, split.name === '' ? t('vc.wt.bare') : split.name),
      h('span', { key: 'branch', className: 'vc-wt-current-branch' }, branch),
      h('span', { key: 'oid', className: 'vc-wt-oid', 'data-wt-current-oid': vcWtViewStr(r.head) }, vcWtViewStr(r.head).slice(0, 8)),
      h('button', {
        key: 'copy', type: 'button', className: 'vc-wt-current-copy', 'data-wt-action': 'copy-path', 'data-wt-copy-path': path, 'data-press': 'button', 'data-log': 'vc.wt.copy-path',
        onClick: function () { vcWorktreesCopyTextOf(path) },
      }, t('vc.wt.currentCopy')),
    ]),
    h('div', { key: 'path', className: 'vc-wt-current-path' }, [
      h('span', { key: 'dir', className: 'vc-wt-path-dir' }, split.dir),
      h('span', { key: 'name', className: 'vc-wt-path-name' }, split.name),
    ]),
  ])
}

/** 其他工作区的头：标题、棵数、需要处理的棵数与筛选 chip；说明条收起后这里多一颗「?」重新打开。 */
const vcWtHeadNode = function (h: any, t: any, rows: any[], ui: any, ops: any): any {
  let abnormal = 0
  for (let i = 0; i < rows.length; i += 1) if (vcWorktreesAbnormalOf(rows[i])) abnormal += 1
  const filter: string = ui.filter === 'abnormal' ? 'abnormal' : 'all'
  const chipOf = function (id: string, label: string, count: number): any {
    return h('button', {
      key: id, type: 'button', className: 'vc-wt-filter' + (filter === id ? ' is-on' : ''), 'data-wt-filter': id, 'aria-pressed': filter === id ? 'true' : 'false', 'data-press': 'button', 'data-log': 'vc.wt.filter',
      onClick: function () { vcWorktreeCall(ops, 'view', [{ filter: id }]) },
    }, label + ' ' + String(count))
  }
  const kids: any[] = [
    h('span', { key: 'title', className: 'vc-wt-head-title' }, t('vc.wt.headTitle')),
    h('span', { key: 'count', className: 'vc-wt-head-count', 'data-wt-other-count': String(rows.length) }, String(rows.length)),
    h('span', { key: 'unit', className: 'vc-wt-head-unit' }, t('vc.wt.unit')),
  ]
  if (abnormal > 0) kids.push(h('span', { key: 'alert', className: 'vc-wt-head-alert', 'data-wt-abnormal-count': String(abnormal) }, t('vc.wt.headAlert', { n: abnormal })))
  if (ui.noteOpen === false) kids.push(h('button', {
    key: 'note-open', type: 'button', className: 'vc-wt-note-open', 'data-wt-action': 'note-open', 'data-press': 'button', 'data-log': 'vc.wt.note-open',
    onClick: function () { vcWorktreeCall(ops, 'view', [{ noteOpen: true }]) },
  }, t('vc.wt.noticeOpen')))
  kids.push(h('div', { key: 'filters', className: 'vc-wt-filters', role: 'group' }, [
    chipOf('all', String(t('vc.wt.filterAll')), rows.length),
    abnormal > 0 ? chipOf('abnormal', String(t('vc.wt.filterAbnormal')), abnormal) : null,
  ]))
  return h('div', { key: 'head', className: 'vc-wt-head', 'data-wt-head': '1' }, kids)
}

/** 一条事实（详情里的标签 + 值）。 */
const vcWtFactNode = function (h: any, t: any, key: string, label: string, value: string): any {
  return h('div', { key: key, className: 'vc-wt-fact' }, [
    h('span', { key: 'k', className: 'vc-wt-fact-k' }, label),
    h('span', { key: 'v', className: 'vc-wt-fact-v' }, value),
  ])
}

/** 清单一行：名字行 / 路径行 / 状态徽章在摘要里，详情里是三条事实与行内动作（删除、锁、移动、稀疏检出、复制路径）。 */
const vcWtRowNode = function (h: any, t: any, model: any, row: any, ops: any): any {
  const path: string = vcWtViewStr(row.path)
  const split: any = vcWorktreesSplitPathOf(path)
  const branch: string = row.detached === true || vcWtViewStr(row.branch) === '' ? String(t('vc.wt.detached')) : vcWtViewStr(row.branch)
  const actions: any[] = vcWorktreesRowActionsOf(model, row)
  const actionNodes: any[] = actions.map(function (a: any): any {
    return vcWtButtonNode(h, t, { op: a.op, capId: a.action.capId, label: t('vc.wt.action.' + String(a.op)), path: path, decision: a.decision, ops: ops })
  })
  const detailKids: any[] = [
    vcWtFactNode(h, t, 'path', String(t('vc.wt.factPath')), path),
    vcWtFactNode(h, t, 'branch', String(t('vc.wt.factBranch')), branch),
    vcWtFactNode(h, t, 'head', String(t('vc.wt.factHead')), vcWtViewStr(row.head)),
  ]
  if (row.locked === true && vcWtViewStr(row.lockReason) !== '') detailKids.push(h('p', { key: 'lockReason', className: 'vc-wt-detail', 'data-wt-detail': 'locked' }, t('vc.wt.detailLocked', { reason: vcWtViewStr(row.lockReason) })))
  if (row.prunable === true) detailKids.push(h('p', { key: 'prunable', className: 'vc-wt-detail', 'data-wt-detail': 'prunable' }, t('vc.wt.detailPrunable', { reason: vcWtViewStr(row.prunableReason) })))
  detailKids.push(h('div', { key: 'acts', className: 'vc-wt-row-acts', 'data-wt-row-actions': '1' }, actionNodes.concat([
    h('button', {
      key: 'copy', type: 'button', className: 'vc-wt-btn vc-wt-btn-copy', 'data-wt-action': 'copy-path', 'data-wt-copy-path': path, 'data-press': 'button', 'data-log': 'vc.wt.copy-path',
      onClick: function () { vcWorktreesCopyTextOf(path) },
    }, t('vc.wt.copyPath')),
  ])))
  return h('li', {
    key: path,
    className: 'vc-wt-row' + (vcWorktreesAbnormalOf(row) ? ' vc-wt-row-abnormal' : '') + (row.current === true ? ' vc-wt-row-current' : ''),
    'data-wt-row': '1',
    'data-wt-path': path,
    'data-wt-current': row.current === true ? '1' : '0',
    'data-wt-locked': row.locked === true ? '1' : '0',
    'data-wt-prunable': row.prunable === true ? '1' : '0',
    'data-wt-abnormal': vcWorktreesAbnormalOf(row) ? '1' : '0',
  }, [
    h('details', { key: 'details', className: 'vc-wt-row-details', 'data-wt-expandable': path }, [
      h('summary', { key: 'summary', className: 'vc-wt-row-summary', 'aria-label': t('vc.wt.expand'), 'data-wt-expand': path, 'data-press': 'button', 'data-log': 'vc.wt.expand' }, [
        h('span', { key: 'main', className: 'vc-wt-row-main' }, [
          h('span', { key: 'name-row', className: 'vc-wt-name-row' }, [
            h('span', { key: 'name', className: 'vc-wt-name' }, split.name === '' ? vcWtViewStr(row.display) : split.name),
            h('span', { key: 'branch', className: 'vc-wt-branch' }, branch),
            h('span', { key: 'oid', className: 'vc-wt-oid', 'data-wt-row-oid': vcWtViewStr(row.head) }, vcWtViewStr(row.head).slice(0, 8)),
          ]),
          h('span', { key: 'path-row', className: 'vc-wt-row-path' }, [
            h('span', { key: 'dir', className: 'vc-wt-path-dir' }, split.dir),
            h('span', { key: 'name', className: 'vc-wt-path-name' }, split.name),
          ]),
          h('span', { key: 'chips', className: 'vc-wt-states' }, vcWtStateChipsOf(h, t, row)),
        ]),
        h('span', { key: 'chev', className: 'vc-wt-chevron', 'aria-hidden': 'true' }, '\u203a'),
      ]),
      h('div', { key: 'detail', className: 'vc-wt-row-detail', 'data-wt-detail-box': '1' }, detailKids),
    ]),
  ])
}

/** 清单区：先按筛选挑行，再按四态画；空态说明与筛选空态分开说。 */
const vcWtListNodesOf = function (h: any, t: any, model: any, ui: any, ops: any): any[] {
  const nodes: any[] = []
  if (model.state === 'loading') { nodes.push(vcShellStateNode(h, t, { state: 'loading' })); return nodes }
  if (model.state === 'idle') { nodes.push(vcShellStateNode(h, t, { state: 'empty' })); return nodes }
  if (model.state === 'error') { nodes.push(vcShellStateNode(h, t, { state: 'error' })); return nodes }
  const all: any[] = Array.isArray(model.rows) ? model.rows : []
  const others: any[] = all.filter(function (r: any): boolean { return r && r.current !== true })
  if (others.length === 0) {
    nodes.push(h('p', { key: 'empty', className: 'vc-wt-empty', 'data-wt-empty': '1' }, t('vc.wt.empty')))
    return nodes
  }
  const want: string = ui.filter === 'abnormal' ? 'abnormal' : 'all'
  const shown: any[] = want === 'abnormal' ? others.filter(vcWorktreesAbnormalOf) : others
  if (shown.length === 0) {
    nodes.push(h('p', { key: 'filterEmpty', className: 'vc-wt-filter-empty', 'data-wt-filter-empty': '1' }, t('vc.wt.filterEmpty')))
    return nodes
  }
  nodes.push(h('ul', { key: 'rows', className: 'vc-wt-rows', 'data-wt-list': '1' }, shown.map(function (row: any): any {
    return vcWtRowNode(h, t, model, row, ops)
  })))
  return nodes
}

/** 页尾折叠：八条能力的全部入口；默认收起，不抢首屏，但 DOM 里始终都在。 */
const vcWtEntriesDetailsNode = function (h: any, t: any, model: any, ui: any, ops: any): any {
  return h('details', { key: 'more-actions', className: 'vc-wt-more-actions', 'data-wt-more-actions': '1' }, [
    h('summary', { key: 'summary', className: 'vc-wt-more-actions-title', 'data-press': 'button', 'data-log': 'vc.wt.more-actions' }, t('vc.wt.moreActions')),
    vcWtEntriesNode(h, t, model, ui, ops),
  ])
}

/** 底部交接入口：把「工作区太乱」这件事写成 prompt 交给 AI；没有接线函数时不画。 */
const vcWtFootNode = function (h: any, t: any, onOpenHandoff: any): any {
  if (typeof onOpenHandoff !== 'function') return null
  return h('div', { key: 'foot', className: 'vc-wt-foot' }, [
    h('button', {
      key: 'ai', type: 'button', className: 'vc-wt-ai', 'data-wt-handoff': '1', 'data-press': 'button', 'data-log': 'vc.wt.handoff',
      onClick: function () { onOpenHandoff({ kind: 'worktrees', summary: t('vc.wt.aiEntry') }) },
    }, t('vc.wt.aiEntry')),
  ])
}

/**
 * 工作树页的一整列节点（说明条 → 当前工作区 → 头与筛选 → 清单 → 页尾折叠入口 → 交接入口）。
 * 页面体只把这列节点接在模式面（拦截/计划/确认/结果）之前，本函数不碰那些面。
 */
export const vcWorktreesLayoutNodesOf = function (h: any, t: any, o: any): any[] {
  const opts: any = o || {}
  const model: any = opts.model || {}
  const ui: any = opts.ui || {}
  const ops: any = opts.ops || {}
  const all: any[] = Array.isArray(model.rows) ? model.rows : []
  const current: any = all.filter(function (r: any): boolean { return r && r.current === true })[0] || null
  const others: any[] = all.filter(function (r: any): boolean { return r && r.current !== true })
  const nodes: any[] = [vcWtNoticeNode(h, t, ui, ops)]
  if (current) nodes.push(vcWtCurrentNode(h, t, current))
  nodes.push(vcWtHeadNode(h, t, others, ui, ops))
  if (model.bare === true) nodes.push(h('p', { key: 'bare', className: 'vc-wt-bare', 'data-wt-bare': '1' }, t('vc.wt.bare')))
  nodes.push.apply(nodes, vcWtListNodesOf(h, t, model, ui, ops))
  nodes.push(vcWtEntriesDetailsNode(h, t, model, ui, ops))
  const foot: any = vcWtFootNode(h, t, opts.onOpenHandoff)
  if (foot) nodes.push(foot)
  return nodes.filter(function (n: any): boolean { return !!n })
}
