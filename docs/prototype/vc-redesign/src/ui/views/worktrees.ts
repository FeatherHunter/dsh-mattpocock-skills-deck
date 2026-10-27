/**
 * ui/views/worktrees.ts —— 工作树视图：当前工作树是一张身份卡，其他工作树按行列出。
 *
 * 这个视图只回答三件事：我在哪、还有哪些工作树、哪几棵需要人确认。
 * 创建、移除、锁定这些动作需要宿主新增命令，面板不越权；底部把边界写成一句话，
 * 「让 AI 处理异常工作树」只在真有异常时出现，并且带上是哪几棵。
 */
import type { WorktreesModel } from '../../domain/select'
import { COPY } from '../../data/copy'
import type { ResultMessage } from '../../domain/session'
import { icon, h } from '../dom'
import { button, chip, emptyState, note, resultBanner } from '../primitives'

export function renderWorktrees(model: WorktreesModel, result: ResultMessage | null): HTMLElement {
  const view = h('div', { class: 'view view-worktrees' })

  if (model.current !== null) {
    const current = model.current
    view.append(h('section', { class: 'wt-current' },
      h('div', { class: 'wt-current-head' },
        chip(COPY.worktrees.current, 'ok', { small: true }),
        h('span', { class: 'wt-name mono', text: current.name, title: current.path }),
        current.branch === null ? null : h('span', { class: 'wt-branch', attrs: { title: `分支 ${current.branch}` } }, h('span', { class: 'mono', text: current.branch }))),
      h('div', { class: 'wt-current-path mono', text: current.path, title: current.path })))
  }

  const head = h('div', { class: 'wt-head' },
    h('span', { class: 'wt-head-title', text: '其他工作树' }),
    h('span', { class: 'wt-head-count', text: String(model.othersCount) }),
    h('span', { class: 'wt-head-unit', text: COPY.units.worktree }))
  view.append(head)

  const list = h('div', { class: 'wt-list' })
  if (model.empty) {
    list.append(emptyState(COPY.worktrees.empty, COPY.worktrees.emptyHint))
  } else {
    for (const row of model.others) {
      const rowNode = h('div', { class: `wt-row${row.abnormal ? ' is-abnormal' : ''}` })
      const nameRow = h('div', { class: 'wt-name-row' },
        h('span', { class: 'wt-name mono', text: row.name, title: row.path }),
        row.branch === null
          ? chip(COPY.worktrees.noBranch, 'muted', { small: true })
          : h('span', { class: 'wt-branch', attrs: { title: `分支 ${row.branch}` } }, h('span', { class: 'mono', text: row.branch })),
        h('span', { class: 'wt-oid mono', text: row.oidShort, title: '这个工作树当前指向的提交短号' }),
        h('button', {
          class: 'icon-btn',
          attrs: {
            type: 'button',
            title: COPY.worktrees.copyPath,
            'aria-label': `${COPY.worktrees.copyPath}：${row.path}`,
            'data-focus-key': `wt-copy:${row.path}`,
          },
          dataset: { action: 'worktree-copy', path: row.path },
        }, icon('copy', 14)))
      const stateRow = h('div', { class: 'wt-states' })
      for (const state of row.states) stateRow.append(chip(state.label, state.tone, { small: true, title: state.detail ?? undefined }))
      const pathRow = h('div', { class: 'wt-path' },
        h('span', { class: 'wt-path-dir mono', text: row.dir }),
        h('span', { class: 'wt-path-name mono', text: row.name }))
      rowNode.append(nameRow, pathRow, stateRow)
      list.append(rowNode)
    }
  }
  view.append(list)

  const foot = h('div', { class: 'wt-foot' })
  foot.append(note(model.hint))
  if (model.hintNote !== null) foot.append(note(model.hintNote, 'warn'))
  foot.append(note(model.boundaryText))
  if (model.aiEnabled) {
    foot.append(button({
      label: model.aiLabel,
      kind: 'secondary',
      size: 'sm',
      icon: 'alert',
      action: 'ai-worktrees',
      focusKey: 'ai-worktrees',
    }))
  }
  view.append(foot)
  if (result !== null) view.append(resultBanner(result))
  return view
}
