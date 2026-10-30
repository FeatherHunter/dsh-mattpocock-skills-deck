/**
 * ui/views/worktrees.ts —— 工作树视图：当前工作树是一张身份卡，其他工作树按行列出。
 *
 * 这个视图要回答四个问题，顺序也就是页面的阅读顺序：
 *   ① 我在哪（当前工作树卡）；
 *   ② 一共有几棵、其中几棵需要人处理（筛选标签就是计数）；
 *   ③ 每棵是什么状态、指向哪个提交（行内信息）；
 *   ④ 想动手时该点哪个按钮（展开行里的动作）。
 *
 * 面板现在直接执行工作树动作：解锁、清理记录、移除都在这里点；
 * 不再把命令写出来让用户复制到终端，那样等于把操作留在面板外面。
 * 三个动作里移除与清理会改清单，所以都要一次内联二次确认。
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
  /** 视图级筛选：只看需要处理的工作树；计数来自模型，不在视图里重新算。 */
  filter: WorktreeFilter
  /** 说明条是否展开；关掉后页面只留一个「显示说明」的小按钮。 */
  noticeOpen: boolean
  /** 同一时刻只展开一棵工作树的详情：面板窄，展开多行会把列表挤没。 */
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
    for (const row of rows) list.append(renderRow(row, options.expandedPath === row.path, model.pending))
  }
  view.append(list)

  // 交接入口常驻：异常为零时也可能有人想把整页状态交给 AI 从头理一遍，
  // 所以这里不按 aiEnabled 隐藏，只按有没有异常换一句标题。
  view.append(h('div', { class: 'wt-foot' },
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
        'aria-label': `复制当前工作树路径：${row.path}`,
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
    h('span', { class: 'wt-head-title', text: '其他工作树' }),
    h('span', { class: 'wt-head-count', text: String(model.othersCount) }),
    h('span', { class: 'wt-head-unit', text: COPY.units.worktree }),
    model.abnormalCount > 0
      ? h('span', { class: 'wt-head-alert', text: `其中 ${model.abnormalCount} 棵需要处理` })
      : null)

  const filters = h('div', { class: 'wt-filters', attrs: { role: 'group', 'aria-label': '按状态筛选工作树' } })
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

function renderRow(row: WorktreeRowModel, expanded: boolean, pending: WorktreePending | null): HTMLElement {
  const rowNode = h('div', {
    class: `wt-row${row.abnormal ? ' is-abnormal' : ''}${expanded ? ' is-open' : ''}`,
  })

  const nameRow = h('div', { class: 'wt-name-row' },
    h('span', { class: 'wt-name mono', text: row.name, title: row.path }),
    row.branch === null
      ? chip(COPY.worktrees.noBranch, 'muted', { small: true })
      : h('span', { class: 'wt-branch', attrs: { title: `分支 ${row.branch}` } }, h('span', { class: 'mono', text: row.branch })),
    h('span', { class: 'wt-oid mono', text: row.oidShort, title: '这个工作树当前指向的提交短号' }))

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
  if (expanded) wrap.append(renderDetail(row, pending))
  return wrap
}

/**
 * 展开区：上面是事实，下面是动作。三个动作按「先解锁、再清理、最后移除」的危险程度排列，
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
    actions.append(button({
      label: COPY.worktrees.remove,
      kind: 'danger',
      size: 'sm',
      action: 'wt-pending',
      dataset: { kind: 'remove', path: row.path, name: row.name },
      focusKey: `wt-remove:${row.path}`,
    }))
    detail.append(actions, h('p', { class: 'wt-action-note', text: COPY.worktrees.actionsHint }))
  }

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
