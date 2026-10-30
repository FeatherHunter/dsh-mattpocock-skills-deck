/**
 * ui/views/branches.ts —— 分支浮层：从顶部身份行的分支名点进来，贴着分支名出现。
 *
 * 为什么是贴着入口的浮层而不是整页覆盖：用户要求「点了 branch 入口出现的内容不能离入口太远」。
 * 分支首先回答「我在哪」，它就在顶部身份行旁边；浮层紧贴那枚分支按钮展开，
 * 关掉之后原来那一页原样还在，读者不会失去自己刚才在做的事。
 *
 * 结构沿用历史页的单列两层：列表点一行进详情，详情返回回列表，不做左右分栏。
 * 这条规则来自面板宽度只有 300 到 520：两栏在 460 宽以下连分支名都放不下。
 *
 * 所有动作都在面板里直接执行，按钮就是动作本身；没有「复制命令去终端」这个中间步骤。
 */
import type { BranchDetailModel, BranchRowModel, BranchesModel } from '../../domain/select'
import type { ResultMessage } from '../../domain/session'
import { COPY } from '../../data/copy'
import { HANDOFF_ENTRY } from '../../domain/handoff'
import { h, icon } from '../dom'
import { button, chip, emptyState, resultBanner } from '../primitives'
import { handoffEntry } from './handoff'

export function renderBranches(model: BranchesModel, result: ResultMessage | null): HTMLElement {
  const view = h('div', { class: 'view view-branches' })

  view.append(renderHead(model))

  if (model.sub === 'create' || model.sub === 'rename') {
    view.append(renderForm(model))
  } else if (model.sub === 'detail' && model.selected !== null) {
    view.append(renderDetail(model.selected, model))
  } else {
    view.append(renderList(model))
  }

  if (result !== null) view.append(resultBanner(result))
  return view
}

/** 顶部一行：返回、标题、当前分支名；列表态右侧再放「新建分支」。 */
function renderHead(model: BranchesModel): HTMLElement {
  const head = h('div', { class: 'branch-head' })
  head.append(h('button', {
    class: 'icon-text-btn',
    attrs: { type: 'button', 'data-focus-key': 'branch-back', title: COPY.branches.back },
    dataset: { action: model.sub === 'list' ? 'branch-close' : 'branch-sub', sub: 'list' },
  }, icon('back', 13), h('span', { text: model.sub === 'list' ? COPY.branches.back : COPY.branches.backList })))

  const title = model.sub === 'detail' && model.selected !== null
    ? model.selected.row.name
    : model.sub === 'create'
      ? COPY.branches.createTitle
      : model.sub === 'rename' && model.selected !== null
        ? COPY.branches.renameTitle
        : COPY.branches.listTitle
  head.append(h('h2', { class: 'branch-title', text: title }))

  if (model.sub === 'list') {
    head.append(
      h('span', { class: 'branch-count', text: `${model.total}` }),
      h('span', { class: 'branch-count-unit', text: '个' }))
    head.append(h('span', { class: 'branch-spacer' }))
    // 标签与「谁跟到哪条上游」都不属于某一条分支，所以不在这个列表里重复显示：
    // 一个按钮把它们交给管理索引里的「分支与远端」页，列表只留「新建分支」这一颗主按钮。
    head.append(button({
      label: '标签与上游',
      kind: 'ghost',
      size: 'sm',
      action: 'page-open',
      dataset: { page: 'branch-tags' },
      focusKey: 'branch-tags-open',
      title: '打开「分支与远端」页：40 个标签、62 条本地分支各自跟到哪条上游，都在那里',
    }))
    head.append(button({
      label: COPY.branches.newBranch,
      kind: 'secondary',
      size: 'sm',
      action: 'branch-sub',
      dataset: { sub: 'create' },
      focusKey: 'branch-new',
    }))
  }
  return head
}

function renderList(model: BranchesModel): HTMLElement {
  const wrap = h('div', { class: 'branch-list-wrap' })

  const search = h('input', {
    class: 'branch-search',
    attrs: {
      type: 'search',
      value: model.query,
      placeholder: COPY.branches.searchPlaceholder,
      'aria-label': COPY.branches.searchPlaceholder,
      'data-focus-key': 'branch-query',
    },
    dataset: { field: 'branch-query' },
  })
  wrap.append(search)

  if (model.empty) {
    wrap.append(emptyState(COPY.branches.empty, null))
    return wrap
  }

  const list = h('div', { class: 'branch-scroll' })
  for (const row of model.rows) list.append(renderRow(model, row))
  wrap.append(list)
  // 分支页的交接入口放在列表下方：读完整份清单之后，如果还是拿不准顺序，这里可以整页交给 AI。
  wrap.append(h('div', { class: 'branch-ai' }, handoffEntry(HANDOFF_ENTRY.branches, 'branches')))
  return wrap
}

function renderRow(model: BranchesModel, row: BranchRowModel): HTMLElement {
  const sync = h('span', { class: 'branch-sync' })
  if (row.ahead > 0) sync.append(h('span', { class: 'branch-count-chip is-ahead', attrs: { title: COPY.branches.ahead(row.ahead) } }, COPY.branches.ahead(row.ahead)))
  if (row.behind > 0) sync.append(h('span', { class: 'branch-count-chip is-behind', attrs: { title: COPY.branches.behind(row.behind) } }, COPY.branches.behind(row.behind)))

  return h('button', {
    class: `branch-row${row.current ? ' is-current' : ''}${model.selected?.row.name === row.name && model.sub === 'detail' ? ' is-open' : ''}`,
    attrs: {
      type: 'button',
      'data-focus-key': `branch:${row.name}`,
      title: row.current ? `${row.name}：当前分支` : `查看分支 ${row.name}`,
    },
    dataset: { action: 'branch-select', name: row.name },
  },
  h('span', { class: 'branch-row-main' },
    h('span', { class: 'branch-row-name' },
      h('span', { class: 'mono', text: row.name }),
      row.current ? chip(COPY.branches.current, 'ok', { small: true }) : null),
    h('span', { class: 'branch-row-meta' },
      h('span', { class: 'mono branch-upstream', text: row.upstream ?? COPY.branches.noUpstream }),
      h('span', { class: 'branch-when', text: row.when }))),
  h('span', { class: 'branch-row-side' },
    sync,
    h('span', { class: 'branch-chevron' }, icon('chevron', 12))))
}

function renderDetail(detail: BranchDetailModel, model: BranchesModel): HTMLElement {
  const row = detail.row
  const wrap = h('div', { class: 'branch-detail' })

  // 领先与落后放在事实表最上面：它们回答「这条分支与上游差多少」，比逐项读事实表更早被需要。
  if (row.ahead > 0 || row.behind > 0) {
    const sync = h('div', { class: 'branch-detail-sync' })
    if (row.ahead > 0) sync.append(chip(COPY.branches.ahead(row.ahead), 'info', { small: true }))
    if (row.behind > 0) sync.append(chip(COPY.branches.behind(row.behind), 'error', { small: true }))
    wrap.append(sync)
  }
  wrap.append(renderFacts(row))

  const actions = h('div', { class: 'branch-actions' })
  actions.append(button({
    label: COPY.branches.switch,
    kind: 'secondary',
    size: 'sm',
    disabled: !detail.canSwitch,
    title: detail.switchReason,
    action: 'branch-switch',
    dataset: { name: row.name },
    focusKey: 'branch-switch',
  }))
  actions.append(button({
    label: COPY.branches.merge,
    kind: 'secondary',
    size: 'sm',
    disabled: !detail.canMerge,
    title: detail.mergeReason,
    action: 'branch-merge',
    dataset: { name: row.name },
    focusKey: 'branch-merge',
  }))
  actions.append(button({
    label: COPY.branches.rebase,
    kind: 'secondary',
    size: 'sm',
    disabled: !detail.canRebase,
    title: detail.rebaseReason,
    action: 'branch-rebase-start',
    dataset: { name: row.name },
    focusKey: 'branch-rebase',
  }))
  actions.append(button({
    label: COPY.branches.rename,
    kind: 'ghost',
    size: 'sm',
    action: 'branch-sub',
    dataset: { sub: 'rename' },
    focusKey: 'branch-rename',
  }))
  const danger = button({
    label: COPY.branches.delete,
    kind: 'danger',
    size: 'sm',
    disabled: !detail.canDelete,
    title: detail.deleteReason,
    action: 'branch-delete-start',
    dataset: { name: row.name },
    focusKey: 'branch-delete',
  })
  actions.append(danger)
  wrap.append(actions)

  if (detail.pending !== null) wrap.append(renderConfirm(detail.pending, model.currentName))
  else wrap.append(h('p', { class: 'branch-hint', text: COPY.branches.mergeHint }))

  if (model.dirty) {
    wrap.append(h('p', { class: 'branch-hint is-warn', text: '工作区有未提交的改动：切换或合并之前，先想清楚这些改动要跟着走还是要留在原分支。' }))
  }
  return wrap
}

function renderFacts(row: BranchRowModel): HTMLElement {
  const facts = h('dl', { class: 'branch-facts' })
  const fact = (label: string, value: string, mono: boolean, title?: string): HTMLElement =>
    h('div', { class: 'branch-fact' },
      h('dt', { class: 'branch-fact-k', text: label }),
      h('dd', { class: `branch-fact-v${mono ? ' mono' : ''}`, text: value, attrs: title === undefined ? {} : { title } }))

  facts.append(
    fact('上游跟踪', row.upstream ?? COPY.branches.noUpstream, true),
    fact(COPY.branches.latestCommit, row.oidShort, true, row.subject),
    fact('提交时间', row.when, false),
    fact('合并状态', row.merged ? COPY.branches.merged : COPY.branches.notMerged, false),
  )
  facts.append(h('p', { class: 'branch-subject', text: row.subject }))
  return facts
}

/** 二次确认做成详情里的一张内联卡片：浮层本身已经很窄，再弹一层会把分支名和按钮挡住。 */
function renderConfirm(pending: { kind: 'delete' | 'switch' | 'rebase'; name: string }, currentName: string | null): HTMLElement {
  const isDelete = pending.kind === 'delete'
  const isRebase = pending.kind === 'rebase'
  const title = isDelete
    ? COPY.branches.deleteTitle(pending.name)
    : isRebase
      ? COPY.branches.rebaseTitle(currentName ?? '当前分支', pending.name)
      : COPY.branches.switchDirtyTitle
  const body = isDelete
    ? COPY.branches.deleteBody
    : isRebase ? COPY.branches.rebaseBody : COPY.branches.switchDirtyBody
  const confirmLabel = isDelete
    ? COPY.branches.deleteConfirm
    : isRebase ? COPY.branches.rebaseConfirm : COPY.branches.switchConfirm
  const confirmAction = isDelete
    ? 'branch-delete-confirm'
    : isRebase ? 'branch-rebase-confirm' : 'branch-switch-confirm'
  return h('div', { class: `branch-confirm${isDelete ? ' is-danger' : ' is-warn'}` },
    h('h3', { class: 'branch-confirm-title', text: title }),
    h('p', { class: 'branch-confirm-body', text: body }),
    h('div', { class: 'branch-confirm-actions' },
      button({
        label: COPY.branches.cancel,
        kind: 'ghost',
        size: 'sm',
        action: 'branch-pending-cancel',
        focusKey: 'branch-cancel',
      }),
      button({
        label: confirmLabel,
        kind: isDelete ? 'danger' : 'secondary',
        size: 'sm',
        action: confirmAction,
        dataset: { name: pending.name },
        focusKey: 'branch-confirm',
      })))
}

function renderForm(model: BranchesModel): HTMLElement {
  const isCreate = model.sub === 'create'
  const wrap = h('div', { class: 'branch-form' })

  wrap.append(h('p', { class: 'branch-form-note', text: isCreate ? COPY.branches.createFrom(model.currentName ?? '') : model.selected?.row.name ?? '' }))
  wrap.append(h('label', { class: 'branch-form-label', text: COPY.branches.branchLabel, attrs: { for: 'branch-name-input' } }))

  const input = h('input', {
    class: 'branch-input',
    attrs: {
      type: 'text',
      id: 'branch-name-input',
      value: model.draft,
      placeholder: isCreate ? COPY.branches.createPlaceholder : COPY.branches.renamePlaceholder,
      'aria-label': isCreate ? COPY.branches.createPlaceholder : COPY.branches.renamePlaceholder,
      'data-focus-key': 'branch-draft',
    },
    dataset: { field: 'branch-draft' },
  })
  wrap.append(input)
  wrap.append(h('p', { class: 'branch-form-hint', text: COPY.branches.nameHint }))

  const actions = h('div', { class: 'branch-form-actions' })
  actions.append(button({
    label: COPY.branches.cancel,
    kind: 'ghost',
    size: 'sm',
    action: 'branch-sub',
    dataset: { sub: 'list' },
    focusKey: 'branch-cancel',
  }))
  actions.append(button({
    label: isCreate ? COPY.branches.create : COPY.branches.renameSubmit,
    kind: 'primary',
    size: 'sm',
    action: isCreate ? 'branch-create' : 'branch-rename-confirm',
    dataset: isCreate ? {} : { name: model.selected?.row.name ?? '' },
    focusKey: 'branch-submit',
  }))
  wrap.append(actions)
  return wrap
}

/** 空的类型导出，保证单独引用本文件时 TypeScript 不把整份文件当成空脚本。 */
export type { BranchesModel }
