/**
 * ui/views/worktrees.ts —— 工作区视图：当前工作区是一张身份卡，其他工作区按行列出。
 *
 * 这个视图要回答四个问题，顺序也就是页面的阅读顺序：
 *   ① 我在哪（当前工作区卡）；
 *   ② 一共有几棵、其中几棵需要人处理（筛选标签就是计数）；
 *   ③ 每棵是什么状态、指向哪个提交（行内信息）；
 *   ④ 想动手时该点哪个按钮（展开行里的动作）。
 *
 * 面板现在直接执行工作区动作：解锁、清除记录、移除都在这里点；
 * 不再把命令写出来让用户复制到终端，那样等于把操作留在面板外面。
 * 三个动作里移除与清除会改清单，所以都要一次内联二次确认。
 */
import type { WorktreeRowModel, WorktreesModel } from '../../domain/select'
import { COPY } from '../../data/copy'
import { HANDOFF_ENTRY } from '../../domain/handoff'
import type { ResultMessage, WorktreePending } from '../../domain/session'
import { icon, h } from '../dom'
import { button, chip, emptyState, resultBanner } from '../primitives'
import { handoffEntry } from './handoff'

export type WorktreeFilter = 'all' | 'abnormal'

export interface WorktreesViewOptions {
  /** 视图级筛选：只看需要处理的工作区；计数来自模型，不在视图里重新算。 */
  filter: WorktreeFilter
  /** 说明条是否展开；关掉后页面只留一个「显示说明」的小按钮。 */
  noticeOpen: boolean
  /** 同一时刻只展开一棵工作区的详情：面板窄，展开多行会把列表挤没。 */
  expandedPath: string | null
}

export function renderWorktrees(
  model: WorktreesModel,
  result: ResultMessage | null,
  options: WorktreesViewOptions,
): HTMLElement {
  const view = h('div', { class: 'view view-worktrees' })

  if (options.noticeOpen) view.append(renderNotice(model))
  view.append(renderCurrent(model.current))
  view.append(renderHead(model, options, options.noticeOpen))

  const rows = options.filter === 'abnormal' ? model.others.filter((row) => row.abnormal) : model.others
  const list = h('div', { class: 'wt-list' })
  if (model.empty) {
    list.append(emptyState(COPY.worktrees.empty, COPY.worktrees.emptyHint))
  } else if (rows.length === 0) {
    list.append(emptyState(COPY.worktrees.filterEmpty, null))
  } else {
    for (const row of rows) list.append(renderRow(row, options.expandedPath === row.path, model))
  }
  view.append(list)
  // 「新建工作区」的表单从页底弹出、浮在列表上方：它不属于任何一行，
  // 而面板不高时，把一整张表单塞进页面流里会把列表挤成零高。
  if (model.create.open) view.append(renderCreateForm(model))

  // 交接入口常驻：异常为零时也可能有人想把整页状态交给 AI 从头理一遍，
  // 所以这里不按 aiEnabled 隐藏，只按有没有异常换一句标题。
  view.append(h('div', { class: 'wt-foot' },
    h('button', {
      class: `link-btn wt-create-open${model.create.open ? ' is-on' : ''}`,
      attrs: { type: 'button', 'aria-expanded': model.create.open ? 'true' : 'false', 'data-focus-key': 'wt-create-open' },
      dataset: { action: 'wt-create-open' },
    }, COPY.worktrees.createOpen),
    handoffEntry(model.abnormalCount > 0 ? HANDOFF_ENTRY.worktrees : COPY.ai.cleanEntry, 'worktrees')))
  if (result !== null) view.append(resultBanner(result))
  return view
}

/** 面板边界说明：默认展开，点 × 关闭；关掉后标题行留一个问号按钮可以再打开。 */
function renderNotice(model: WorktreesModel): HTMLElement {
  return h('aside', { class: 'wt-notice', attrs: { role: 'note' } },
    h('span', { class: 'wt-notice-text', text: model.notice }),
    h('button', {
      class: 'wt-notice-close',
      attrs: { type: 'button', 'aria-label': COPY.worktrees.noticeClose, title: COPY.worktrees.noticeClose },
      dataset: { action: 'wt-note-close' },
    }, '×'))
}

function renderCurrent(row: WorktreeRowModel | null): HTMLElement {
  if (row === null) return h('div', {})
  const head = h('div', { class: 'wt-current-head' },
    chip(COPY.worktrees.current, 'ok', { small: true }),
    h('span', { class: 'wt-name mono', text: row.name, title: row.path }),
    row.branch === null
      ? chip(COPY.worktrees.noBranch, 'muted', { small: true })
      : h('span', { class: 'wt-branch', attrs: { title: `分支 ${row.branch}` } }, h('span', { class: 'mono', text: row.branch })),
    h('button', {
      class: 'icon-btn wt-current-copy',
      attrs: {
        type: 'button',
        title: COPY.worktrees.copyPath,
        'aria-label': `复制当前工作区路径：${row.path}`,
        'data-focus-key': `wt-copy:${row.path}`,
      },
      dataset: { action: 'worktree-copy', path: row.path },
    }, icon('copy', 14)))
  return h('section', { class: 'wt-current' },
    head,
    h('div', { class: 'wt-current-path mono', text: row.path, title: row.path }))
}

function renderHead(model: WorktreesModel, options: WorktreesViewOptions, noticeOpen: boolean): HTMLElement {
  const head = h('div', { class: 'wt-head' },
    h('span', { class: 'wt-head-title', text: '其他工作区' }),
    h('span', { class: 'wt-head-count', text: String(model.othersCount) }),
    h('span', { class: 'wt-head-unit', text: COPY.units.worktree }),
    model.abnormalCount > 0
      ? h('span', { class: 'wt-head-alert', text: `其中 ${model.abnormalCount} 棵需要处理` })
      : null)

  const filters = h('div', { class: 'wt-filters', attrs: { role: 'group', 'aria-label': '按状态筛选工作区' } })
  filters.append(filterChip(COPY.worktrees.filterAll, String(model.othersCount), options.filter === 'all', 'all'))
  if (model.abnormalCount > 0) {
    filters.append(filterChip(COPY.worktrees.filterAbnormal, String(model.abnormalCount), options.filter === 'abnormal', 'abnormal'))
  }
  head.append(filters)
  if (!noticeOpen) {
    head.append(h('button', {
      class: 'icon-btn wt-notice-open',
      attrs: {
        type: 'button',
        title: COPY.worktrees.noticeOpen,
        'aria-label': COPY.worktrees.noticeOpen,
        'data-focus-key': 'wt-note-open',
      },
      dataset: { action: 'wt-note-open' },
    }, '?'))
  }
  return head
}

function filterChip(label: string, count: string, on: boolean, filter: WorktreeFilter): HTMLElement {
  return h('button', {
    class: `filter-chip${filter === 'abnormal' ? ' tone-error' : ' tone-ok'}${on ? ' is-on' : ''}`,
    attrs: {
      type: 'button',
      'aria-pressed': on ? 'true' : 'false',
      'data-focus-key': `wt-filter-${filter}`,
    },
    dataset: { action: 'wt-filter', filter },
  },
  h('span', { class: 'filter-label', text: label }),
  h('span', { class: 'filter-count', text: count }))
}

function renderRow(row: WorktreeRowModel, expanded: boolean, model: WorktreesModel): HTMLElement {
  const rowNode = h('div', {
    class: `wt-row${row.abnormal ? ' is-abnormal' : ''}${expanded ? ' is-open' : ''}`,
  })

  const nameRow = h('div', { class: 'wt-name-row' },
    h('span', { class: 'wt-name mono', text: row.name, title: row.path }),
    row.branch === null
      ? chip(COPY.worktrees.noBranch, 'muted', { small: true })
      : h('span', { class: 'wt-branch', attrs: { title: `分支 ${row.branch}` } }, h('span', { class: 'mono', text: row.branch })),
    h('span', { class: 'wt-oid mono', text: row.oidShort, title: '这个工作区当前指向的提交短号' }))

  const pathRow = h('div', { class: 'wt-path' },
    h('span', { class: 'wt-path-dir mono', text: row.dir }),
    h('span', { class: 'wt-path-name mono', text: row.name }))

  const stateRow = h('div', { class: 'wt-states' })
  for (const state of row.states) stateRow.append(chip(state.label, state.tone, { small: true, title: state.detail ?? undefined }))

  const actions = h('div', { class: 'wt-actions' },
    h('button', {
      class: 'icon-btn',
      attrs: {
        type: 'button',
        title: COPY.worktrees.copyPath,
        'aria-label': `${COPY.worktrees.copyPath}：${row.path}`,
        'data-focus-key': `wt-copy:${row.path}`,
      },
      dataset: { action: 'worktree-copy', path: row.path },
    }, icon('copy', 14)),
    h('button', {
      class: `icon-btn wt-expander${expanded ? ' is-open' : ''}`,
      attrs: {
        type: 'button',
        'aria-expanded': expanded ? 'true' : 'false',
        'aria-label': expanded ? COPY.worktrees.collapse : COPY.worktrees.expand,
        title: expanded ? COPY.worktrees.collapse : COPY.worktrees.expand,
        'data-focus-key': `wt-expand:${row.path}`,
      },
      dataset: { action: 'wt-expand', path: row.path },
    }, icon('chevron', 12)))

  rowNode.append(h('div', { class: 'wt-main' }, nameRow, pathRow, stateRow), actions)
  const wrap = h('div', { class: 'wt-row-wrap' }, rowNode)
  if (expanded) wrap.append(renderDetail(row, model.pending))
  return wrap
}

/**
 * 展开区：上面是事实，下面是动作。三个动作按「先解锁、再清除、最后移除」的危险程度排列，
 * 移除永远是最后一颗并且用危险色；确认做成内联卡片，不再弹浮层盖住列表。
 */
function renderDetail(row: WorktreeRowModel, pending: WorktreePending | null): HTMLElement {
  const detail = h('div', { class: `wt-detail${row.abnormal ? ' is-abnormal' : ''}` })
  const fact = (label: string, value: string, mono: boolean): HTMLElement =>
    h('div', { class: 'wt-fact' },
      h('span', { class: 'wt-fact-k', text: label }),
      h('span', { class: `wt-fact-v${mono ? ' mono' : ''}`, text: value, title: value }))

  detail.append(
    fact(COPY.worktrees.detailPath, row.path, true),
    fact(COPY.worktrees.detailBranch, row.branch ?? COPY.worktrees.noBranch, false),
    fact(COPY.worktrees.detailHead, row.oidShort, true),
  )

  // 确认状态下只留三项身份事实（路径、分支、提交）：状态原因写在确认卡正文里，
  // 再留一遍会把确认卡顶出列表可视区，这正是「移除前确认」最不该发生的事。
  const awaiting = pending !== null && pending.path === row.path
  if (!awaiting) {
    // 状态 chip 的 detail 是「为什么」，行内只放得下结论，展开后才给原因。
    for (const state of row.states) {
      if (state.detail === null) continue
      detail.append(fact(state.label, state.detail, false))
    }
    // 已经设过稀疏检出的话，展开行里常驻一句当前规则；没设过就不占这一行。
    if (row.sparseSummary !== null) detail.append(fact(COPY.worktrees.sparse, row.sparseSummary, false))
  }

  // 确认卡打开时收起三颗动作按钮与说明：同一行里同时留「取消/确认」和「解锁/移除」两套按钮，
  // 读者会分不清哪一组才是当前这一步。
  if (!awaiting) {
    const actions = h('div', { class: 'wt-actions-row' })
    if (row.locked) {
      actions.append(button({
        label: COPY.worktrees.unlock,
        kind: 'secondary',
        size: 'sm',
        action: 'wt-pending',
        dataset: { kind: 'unlock', path: row.path, name: row.name },
        focusKey: `wt-unlock:${row.path}`,
      }))
    }
    if (row.prunable) {
      actions.append(button({
        label: COPY.worktrees.pruneRecord,
        kind: 'secondary',
        size: 'sm',
        action: 'wt-pending',
        dataset: { kind: 'prune', path: row.path, name: row.name },
        focusKey: `wt-prune:${row.path}`,
      }))
    }
    // 移动与稀疏检出改的是这一棵的路径与检出范围，都贴着这一行就地展开：
    // 读者能一边看当前路径与规则，一边改，不用跳到别的页面。
    actions.append(button({
      label: COPY.worktrees.move,
      kind: 'secondary',
      size: 'sm',
      action: 'wt-move-open',
      dataset: { path: row.path },
      focusKey: `wt-move-open:${row.path}`,
    }))
    actions.append(button({
      label: COPY.worktrees.sparse,
      kind: 'secondary',
      size: 'sm',
      action: 'wt-sparse-open',
      dataset: { path: row.path },
      focusKey: `wt-sparse-open:${row.path}`,
    }))
    actions.append(button({
      label: COPY.worktrees.remove,
      kind: 'danger',
      size: 'sm',
      action: 'wt-pending',
      dataset: { kind: 'remove', path: row.path, name: row.name },
      focusKey: `wt-remove:${row.path}`,
    }))
    detail.append(actions)
  }

  if (row.moveOpen) detail.append(renderMoveForm(row))
  if (row.sparseOpen) detail.append(renderSparsePanel(row))

  if (pending !== null && pending.path === row.path) {
    detail.append(h('div', { class: `wt-confirm${pending.kind === 'remove' ? ' is-danger' : ' is-warn'}` },
      h('h4', { class: 'wt-confirm-title', text: pendingTitle(pending) }),
      h('p', { class: 'wt-confirm-body', text: pendingBody(pending) }),
      h('div', { class: 'wt-confirm-actions' },
        button({
          label: COPY.worktrees.cancel,
          kind: 'ghost',
          size: 'sm',
          action: 'wt-pending-cancel',
          focusKey: 'wt-cancel',
        }),
        button({
          label: pending.kind === 'unlock' ? COPY.worktrees.unlockConfirm : pending.kind === 'prune' ? COPY.worktrees.pruneConfirm : COPY.worktrees.removeConfirm,
          kind: pending.kind === 'remove' ? 'danger' : 'secondary',
          size: 'sm',
          action: 'wt-apply',
          dataset: { kind: pending.kind, path: pending.path, name: pending.name },
          focusKey: 'wt-confirm',
        }))))
  }
  return detail
}

/** 页底的「新建工作区」表单：目录 + 分支来源（新建分支 / 已有分支）。 */
function renderCreateForm(model: WorktreesModel): HTMLElement {
  const create = model.create
  const pathInput = h('input', {
    class: 'wt-input',
    attrs: {
      type: 'text',
      id: 'wt-create-path',
      placeholder: COPY.worktrees.createPathPlaceholder,
      'aria-label': COPY.worktrees.createPath,
      autocomplete: 'off',
      spellcheck: 'false',
      'data-field': 'wt-create-path',
      'data-focus-key': 'wt-create-path',
    },
  })
  pathInput.value = create.path
  const branchInput = h('input', {
    class: 'wt-input',
    attrs: {
      type: 'text',
      id: 'wt-create-branch',
      placeholder: COPY.worktrees.createBranchPlaceholder,
      'aria-label': COPY.worktrees.createBranch,
      autocomplete: 'off',
      spellcheck: 'false',
      'data-field': 'wt-create-branch',
      'data-focus-key': 'wt-create-branch',
    },
  })
  branchInput.value = create.branch

  const mode = (value: 'new' | 'existing', label: string): HTMLElement => {
    const on = create.mode === value
    return h('button', {
      class: `wt-mode${on ? ' is-on' : ''}`,
      attrs: { type: 'button', 'aria-pressed': on ? 'true' : 'false', 'data-focus-key': `wt-mode:${value}` },
      dataset: { action: 'wt-create-mode', mode: value },
    }, label)
  }

  // 已有分支时给几条最近用过的候选：点一下填进输入框，仍然可以手改。
  const recent = create.mode === 'existing' && create.branches.length > 0
    ? h('div', { class: 'wt-recent' },
      h('span', { class: 'wt-recent-lead', text: COPY.worktrees.createRecent }),
      ...create.branches.map((name) => h('button', {
        class: `wt-recent-chip${create.branch === name ? ' is-on' : ''}`,
        attrs: { type: 'button', title: name, 'data-focus-key': `wt-branch:${name}` },
        dataset: { action: 'wt-create-branch', value: name },
      }, name)))
    : null

  return h('div', { class: 'wt-form wt-create', attrs: { role: 'group', 'aria-label': COPY.worktrees.createTitle } },
    h('h4', { class: 'wt-form-title', text: COPY.worktrees.createTitle }),
    h('div', { class: 'wt-field' },
      h('label', { class: 'wt-field-k', text: COPY.worktrees.createPath, attrs: { for: 'wt-create-path' } }),
      pathInput),
    h('div', { class: 'wt-field' },
      h('label', { class: 'wt-field-k', text: COPY.worktrees.createBranch, attrs: { for: 'wt-create-branch' } }),
      h('div', { class: 'wt-modes', attrs: { role: 'group', 'aria-label': COPY.worktrees.createBranch } },
        mode('new', COPY.worktrees.createModeNew),
        mode('existing', COPY.worktrees.createModeExisting)),
      branchInput,
      recent),
    h('p', { class: 'wt-form-hint', text: create.mode === 'new' ? COPY.worktrees.createHintNew : COPY.worktrees.createHintExisting }),
    create.error === null ? null : h('p', { class: 'wt-form-error', attrs: { role: 'alert' }, text: create.error }),
    h('div', { class: 'wt-form-actions' },
      button({ label: COPY.worktrees.createCancel, kind: 'ghost', size: 'sm', action: 'wt-create-close', focusKey: 'wt-create-cancel' }),
      button({ label: COPY.worktrees.createSubmit, kind: 'secondary', size: 'sm', action: 'wt-create-submit', focusKey: 'wt-create-submit' })))
}

/** 移动工作区：只填一个新目录，旧路径与新路径的关系写在提示里。 */
function renderMoveForm(row: WorktreeRowModel): HTMLElement {
  const input = h('input', {
    class: 'wt-input',
    attrs: {
      type: 'text',
      'aria-label': COPY.worktrees.moveLabel,
      autocomplete: 'off',
      spellcheck: 'false',
      'data-field': 'wt-move',
      'data-focus-key': `wt-move:${row.path}`,
    },
  })
  input.value = row.moveDraft
  return h('div', { class: 'wt-form wt-move', attrs: { role: 'group', 'aria-label': COPY.worktrees.moveTitle } },
    h('h4', { class: 'wt-form-title', text: COPY.worktrees.moveTitle }),
    h('label', { class: 'wt-field-k', text: COPY.worktrees.moveLabel }),
    input,
    h('p', { class: 'wt-form-hint', text: COPY.worktrees.moveHint }),
    h('div', { class: 'wt-form-actions' },
      button({ label: COPY.worktrees.createCancel, kind: 'ghost', size: 'sm', action: 'wt-move-close', focusKey: 'wt-move-cancel' }),
      button({ label: COPY.worktrees.moveSubmit, kind: 'secondary', size: 'sm', action: 'wt-move-apply', focusKey: 'wt-move-apply' })))
}

/** 稀疏检出：勾顶层目录，勾上的才会检出到磁盘。 */
function renderSparsePanel(row: WorktreeRowModel): HTMLElement {
  const dirs = h('div', { class: 'wt-dirs', attrs: { role: 'group', 'aria-label': COPY.worktrees.sparseTitle } })
  for (const dir of row.sparseDirs) {
    const on = row.sparseSelected.includes(dir)
    dirs.append(h('button', {
      class: `wt-dir${on ? ' is-on' : ''}`,
      attrs: { type: 'button', 'aria-pressed': on ? 'true' : 'false', title: on ? `不保留 ${dir}` : `保留 ${dir}`, 'data-focus-key': `wt-dir:${dir}` },
      dataset: { action: 'wt-sparse-toggle', dir },
    },
    h('span', { class: 'wt-dir-box', attrs: { 'aria-hidden': 'true' }, text: on ? '✓' : '' }),
    h('span', { class: 'mono', text: dir })))
  }
  return h('div', { class: 'wt-form wt-sparse', attrs: { role: 'group', 'aria-label': COPY.worktrees.sparseTitle } },
    h('h4', { class: 'wt-form-title', text: COPY.worktrees.sparseTitle }),
    h('p', { class: 'wt-form-hint', text: COPY.worktrees.sparseHint }),
    dirs,
    h('div', { class: 'wt-form-actions' },
      button({ label: COPY.worktrees.sparseCancel, kind: 'ghost', size: 'sm', action: 'wt-sparse-close', focusKey: 'wt-sparse-cancel' }),
      button({ label: COPY.worktrees.sparseSave, kind: 'secondary', size: 'sm', action: 'wt-sparse-save', focusKey: 'wt-sparse-save' })))
}

function pendingTitle(pending: WorktreePending): string {
  if (pending.kind === 'unlock') return COPY.worktrees.unlockTitle
  if (pending.kind === 'prune') return COPY.worktrees.pruneTitle
  return COPY.worktrees.removeTitle(pending.name)
}

function pendingBody(pending: WorktreePending): string {
  if (pending.kind === 'unlock') return COPY.worktrees.unlockBody
  if (pending.kind === 'prune') return COPY.worktrees.pruneBody
  return COPY.worktrees.removeBody
}
