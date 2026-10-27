/**
 * ui/views/worktrees.ts —— 工作树视图：当前工作树是一张身份卡，其他工作树按行列出。
 *
 * 这个视图要回答四个问题，顺序也就是页面的阅读顺序：
 *   ① 我在哪（当前工作树卡）；
 *   ② 一共有几棵、其中几棵需要人处理（筛选标签就是计数）；
 *   ③ 每棵是什么状态、指向哪个提交（行内信息）；
 *   ④ 想动手时该敲什么命令（展开行里的「复制命令」）。
 *
 * 面板只读，所以「操作更便捷」不是加按钮，而是把终端命令原样备好：
 * 用户点一下就得到 `git worktree unlock "..."` 这样的完整命令，不用自己拼路径。
 * 创建与移除仍然只能在终端完成，这条边界写在可关闭的说明条里，不常驻底部。
 */
import type { WorktreeRowModel, WorktreesModel } from '../../domain/select'
import { COPY } from '../../data/copy'
import type { ResultMessage } from '../../domain/session'
import { icon, h } from '../dom'
import { button, chip, emptyState, resultBanner } from '../primitives'

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
    for (const row of rows) list.append(renderRow(row, options.expandedPath === row.path))
  }
  view.append(list)

  if (model.aiEnabled) {
    view.append(h('div', { class: 'wt-foot' },
      button({
        label: model.aiLabel,
        kind: 'secondary',
        size: 'sm',
        icon: 'alert',
        action: 'ai-worktrees',
        focusKey: 'ai-worktrees',
      })))
  }
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

function renderRow(row: WorktreeRowModel, expanded: boolean): HTMLElement {
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
  if (expanded) wrap.append(renderDetail(row))
  return wrap
}

function renderDetail(row: WorktreeRowModel): HTMLElement {
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

  // 状态 chip 的 detail 是「为什么」，行内只放得下结论，展开后才给原因。
  for (const state of row.states) {
    if (state.detail === null) continue
    detail.append(fact(state.label, state.detail, false))
  }

  const commands = commandsFor(row)
  if (commands.length > 0) {
    const block = h('div', { class: 'wt-commands' })
    for (const item of commands) {
      block.append(h('div', { class: 'wt-command' },
        h('span', { class: 'wt-command-label', text: item.label }),
        h('code', { class: 'wt-command-text mono', text: item.command, title: item.command }),
        h('button', {
          class: 'wt-command-copy',
          attrs: {
            type: 'button',
            'aria-label': `复制命令：${item.command}`,
            title: COPY.worktrees.copyCommand,
            'data-focus-key': `wt-command:${row.path}:${item.label}`,
          },
          dataset: { action: 'worktree-command', command: item.command },
        }, COPY.worktrees.copyCommand)))
    }
    detail.append(block, h('p', { class: 'wt-command-note', text: COPY.worktrees.detailCommand }))
  }
  return detail
}

/** 只给展开行准备命令：面板不执行，只把该敲的完整命令备好，用户复制到终端。 */
function commandsFor(row: WorktreeRowModel): Array<{ label: string; command: string }> {
  const labels = new Set(row.states.map((state) => state.label))
  if (labels.has(COPY.worktrees.prunable)) {
    return [{ label: '清理不存在的目录记录', command: COPY.worktrees.commandPrune }]
  }
  if (labels.has(COPY.worktrees.locked)) {
    return [{ label: '解除占用', command: COPY.worktrees.commandUnlock(row.path) }]
  }
  return [{ label: '移除这棵工作树', command: COPY.worktrees.commandRemove(row.path) }]
}
