/**
 * ui/views/stash.ts —— 「储藏」页签：把暂时不想提交的改动打包储藏起来，之后能应用回工作区。
 *
 * 为什么单独一个页签而不是塞进改动页：储藏记录会一直留着，跨天、跨分支都在；
 * 它和「此刻的工作区」是两件事，混在一个列表里，读者会分不清哪些改动还会被提交。
 * 三个动作里只有「丢弃」不可逆，所以只有它要二次确认；确认卡贴在那一条记录下面，
 * 不跳到面板顶部，也不铺满整屏。
 */
import type { StashModel, StashRowModel } from '../../domain/select'
import { COPY } from '../../data/copy'
import type { ResultMessage } from '../../domain/session'
import { h } from '../dom'
import { button, emptyState, note, resultBanner } from '../primitives'

export function renderStash(model: StashModel, result: ResultMessage | null): HTMLElement {
  const view = h('div', { class: 'view view-stash' })

  const head = h('div', { class: 'stash-head' },
    h('div', { class: 'stash-head-text' },
      h('h2', { class: 'stash-title', text: COPY.stash.title }),
      h('p', { class: 'stash-count', text: COPY.stash.lede })),
    // 清空是整页动作：放在列表标题行右侧，不做进每行的菜单里。
    model.empty
      ? null
      : h('button', {
        class: 'link-btn stash-clear-action',
        attrs: { type: 'button', 'data-focus-key': 'stash-clear-action' },
        dataset: { action: 'stash-clear-open' },
      }, COPY.stash.clearAction))
  view.append(head)
  view.append(note(COPY.stash.boundary, 'muted'))
  if (model.clearPending) view.append(renderClearCard(model))

  const scroll = h('div', { class: 'stash-scroll' })
  // 只显示储藏动作自己的结果；别的页签的动作结果不追到这里来，避免同一条消息在两个页签重复出现。
  if (result !== null && result.source === 'stash') scroll.append(resultBanner(result))
  if (model.empty) {
    scroll.append(emptyState(COPY.stash.empty, COPY.stash.emptyHint))
  } else {
    for (const row of model.rows) scroll.append(renderStashRow(row, model))
  }
  view.append(scroll)
  return view
}

/** 清空全部记录的确认卡：整页动作，卡片贴在列表标题行下面。 */
function renderClearCard(model: StashModel): HTMLElement {
  return h('div', { class: 'stash-clear-card', attrs: { role: 'group', 'aria-label': COPY.stash.clearTitle(model.total) } },
    h('p', { class: 'stash-confirm-title', text: COPY.stash.clearTitle(model.total) }),
    h('p', { class: 'stash-confirm-body', text: COPY.stash.clearBody }),
    h('div', { class: 'stash-confirm-actions' },
      button({ label: COPY.stash.clearCancel, kind: 'ghost', size: 'sm', action: 'stash-clear-cancel', focusKey: 'stash-clear-cancel' }),
      button({ label: COPY.stash.clearConfirm, kind: 'danger', size: 'sm', action: 'stash-clear-apply', focusKey: 'stash-clear-apply' })))
}

/** 从储藏记录建分支：给分支起个名字，建完这条记录就用掉了。 */
function renderBranchForm(model: StashModel): HTMLElement {
  const input = h('input', {
    class: 'wt-input',
    attrs: {
      type: 'text',
      'aria-label': COPY.stash.branchName,
      autocomplete: 'off',
      spellcheck: 'false',
      'data-field': 'stash-branch',
      'data-focus-key': 'stash-branch',
    },
  })
  input.value = model.branchDraft
  return h('div', { class: 'stash-branch-form', attrs: { role: 'group', 'aria-label': COPY.stash.branchTitle } },
    h('p', { class: 'stash-branch-title', text: COPY.stash.branchTitle }),
    input,
    h('p', { class: 'stash-branch-hint', text: COPY.stash.branchHint }),
    h('div', { class: 'stash-branch-actions' },
      button({ label: COPY.stash.cancel, kind: 'ghost', size: 'sm', action: 'stash-branch-cancel', focusKey: 'stash-branch-cancel' }),
      button({ label: COPY.stash.branchApply, kind: 'secondary', size: 'sm', action: 'stash-branch-apply', focusKey: 'stash-branch-apply' })))
}

function renderStashRow(row: StashRowModel, model: StashModel): HTMLElement {
  const wrap = h('div', { class: 'stash-row-wrap' })
  const line = h('div', { class: 'stash-row' })

  const main = h('div', { class: 'stash-main' },
    h('div', { class: 'stash-id-line' },
      h('span', { class: 'stash-id mono', text: row.id }),
      h('span', { class: 'stash-message', text: row.message, title: row.message })),
    h('div', { class: 'stash-meta', text: COPY.stash.entryMeta(row.when, row.filesCount) }))
  line.append(main)

  const actions = h('div', { class: 'stash-actions' })
  actions.append(button({
    label: COPY.stash.apply,
    kind: 'secondary',
    size: 'sm',
    action: 'stash-apply',
    dataset: { id: row.id },
    focusKey: `stash-apply:${row.id}`,
    title: COPY.stash.applyHint,
    disabled: model.busy,
  }))
  actions.append(button({
    label: COPY.stash.pop,
    kind: 'secondary',
    size: 'sm',
    action: 'stash-pop',
    dataset: { id: row.id },
    focusKey: `stash-pop:${row.id}`,
    title: COPY.stash.popHint,
    disabled: model.busy,
  }))
  actions.append(button({
    label: COPY.stash.drop,
    kind: 'ghost',
    size: 'sm',
    action: 'stash-pending',
    dataset: { kind: 'drop', id: row.id },
    focusKey: `stash-drop:${row.id}`,
    title: COPY.stash.dropTitle(row.id),
    disabled: model.busy,
  }))
  // 从记录再往前走一步的动作（建分支）收进「更多」：它不是对记录本身做动作，
  // 却又要先给分支起名，放在行上的第三颗按钮里会把「应用 / 弹出 / 丢弃」挤散。
  actions.append(h('button', {
    class: `row-act row-more stash-more${row.menuOpen ? ' is-open' : ''}`,
    attrs: {
      type: 'button',
      'aria-haspopup': 'true',
      'aria-expanded': row.menuOpen ? 'true' : 'false',
      'aria-label': COPY.stash.menuMore,
      title: COPY.stash.menuMore,
      'data-focus-key': `stash-more:${row.id}`,
      disabled: model.busy,
    },
    dataset: { action: 'stash-menu', id: row.id },
  }, h('span', { class: 'row-more-dots', text: '⋯', attrs: { 'aria-hidden': 'true' } })))
  line.append(actions)
  wrap.append(line)

  if (row.menuOpen) {
    wrap.append(h('div', { class: 'row-menu', attrs: { role: 'menu', 'aria-label': COPY.stash.menuMore } },
      h('button', {
        class: 'row-menu-item',
        attrs: { type: 'button', role: 'menuitem' },
        dataset: { action: 'stash-branch-open', id: row.id },
      }, COPY.stash.menuBranch),
      h('button', {
        class: 'row-menu-item is-close',
        attrs: { type: 'button', 'aria-label': COPY.stash.menuClose },
        dataset: { action: 'stash-menu', id: row.id },
      }, COPY.stash.menuClose)))
  }
  if (row.branchOpen) wrap.append(renderBranchForm(model))

  // 文件清单直接列在行下面：储藏记录通常只有几个文件，藏进展开层反而多一次点击。
  const paths = h('div', { class: 'stash-paths' })
  paths.append(h('p', { class: 'stash-paths-note', text: COPY.stash.pathsNote }))
  const list = h('ul', { class: 'stash-path-list' })
  for (const path of row.paths) list.append(h('li', { class: 'stash-path mono', text: path, attrs: { title: path } }))
  paths.append(list)
  wrap.append(paths)

  if (model.pending !== null && model.pending.id === row.id) {
    wrap.append(h('div', { class: 'stash-confirm', attrs: { role: 'group', 'aria-label': model.pending.title } },
      h('p', { class: 'stash-confirm-title', text: model.pending.title }),
      h('p', { class: 'stash-confirm-body', text: model.pending.body }),
      h('div', { class: 'stash-confirm-actions' },
        button({ label: COPY.stash.cancel, kind: 'ghost', size: 'sm', action: 'stash-pending-cancel', focusKey: 'stash-cancel' }),
        button({
          label: COPY.stash.dropConfirm,
          kind: 'danger',
          size: 'sm',
          action: 'stash-drop',
          dataset: { id: row.id },
          focusKey: `stash-drop-confirm:${row.id}`,
        }))))
  }
  return wrap
}
