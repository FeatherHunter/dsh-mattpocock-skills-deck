/**
 * ui/views/changes.ts —— 改动视图。设计目标按重要性排：
 *   ① 先看见「这批改动整体是什么样」（三个可点的计数控件就是筛选器）；
 *   ② 再逐行看：路径按目录与文件名分开画、变更类型用字母徽章、增删行数右对齐；
 *   ③ 每一行的动作都在这一行上：暂存/撤回在行尾，「更多」菜单与二次确认贴在这一行下面；
 *   ④ 展开行看逐行差异，差异不跳出列表；
 *   ⑤ 底部常驻提交区：暂存数、说明、主按钮、禁用原因、提交结果都在同一处。
 *
 * 「就近」是这一版的硬规则：行级动作的结果不放到页面底部的结果条里，
 * 而是紧贴着改动列表的顶端出现；确认卡紧贴着触发它的那一行出现。
 */
import type { ChangesModel, ChangesPendingModel, FileRowModel, GroupModel } from '../../domain/select'
import { COPY } from '../../data/copy'
import { HANDOFF_ENTRY } from '../../domain/handoff'
import type { ResultMessage } from '../../domain/session'
import { icon, h } from '../dom'
import { badgeLetter, button, chip, emptyState, note, patchBlock, resultBanner } from '../primitives'
import { handoffEntry } from './handoff'

export function renderChanges(model: ChangesModel, result: ResultMessage | null): HTMLElement {
  const view = h('div', { class: 'view view-changes' })

  const filterRow = h('div', { class: 'filters', attrs: { role: 'group', 'aria-label': '按状态筛选' } })
  for (const stat of model.stats) {
    const active = model.filter === stat.id
    filterRow.append(
      h('button', {
        class: `filter-chip tone-${stat.tone}${active ? ' is-on' : ''}${stat.count === 0 ? ' is-zero' : ''}`,
        attrs: {
          type: 'button',
          'aria-pressed': active ? 'true' : 'false',
          'data-focus-key': `filter-${stat.id}`,
          title: active ? '再点一次显示全部分组' : `只看${stat.label}`,
        },
        dataset: { action: 'filter', filter: stat.id },
      },
      h('span', { class: 'filter-label', text: stat.label }),
      h('span', { class: 'filter-count', text: String(stat.count) })),
    )
  }

  const list = h('div', { class: 'changes-scroll' })
  // 行级动作（丢弃、忽略、解决冲突、贮藏）的结果贴在列表最上面：它离刚点过的那一行最近。
  // 提交结果留在底部提交区，因为它由底部的提交按钮产生。
  if (result !== null && result.source !== 'commit') list.append(resultBanner(result))
  if (model.ignoredNote !== null) list.append(h('div', { class: 'changes-note' }, note(model.ignoredNote, 'muted')))
  if (model.empty) {
    list.append(emptyState(COPY.changes.emptyTitle, COPY.changes.emptyHint))
  } else {
    for (const group of model.groups) list.append(renderGroup(group, model))
  }

  const composer = h('div', { class: 'composer' })
  if (result !== null && result.source === 'commit') composer.append(resultBanner(result))
  const stashBtn = h('button', {
    class: `link-btn${model.canStash ? '' : ' is-disabled'}`,
    attrs: {
      type: 'button',
      'data-focus-key': 'stash-create',
      title: model.canStash ? COPY.changes.stashHint : model.stashReason ?? COPY.changes.stashBlocked,
      disabled: !model.canStash,
    },
    dataset: { action: 'stash-create' },
  }, COPY.changes.stashAction)
  const stagedLine = h('div', { class: 'composer-head' },
    h('span', { class: 'composer-count' },
      h('span', { class: 'count', text: String(model.composer.stagedCount) }),
      h('span', { class: 'unit', text: '个文件已暂存' })),
    h('span', { class: 'composer-links' },
      model.canUnstageAll
        ? h('button', {
          class: 'link-btn',
          attrs: { type: 'button', 'data-focus-key': 'unstage-all' },
          dataset: { action: 'unstage-all' },
        }, COPY.actions.unstageAll)
        : null,
      stashBtn))

  const textarea = h('textarea', {
    class: 'commit-input',
    attrs: {
      id: 'commit-message',
      rows: 2,
      placeholder: model.composer.placeholder,
      'data-field': 'message',
      'data-focus-key': 'commit-message',
      'aria-label': '提交说明',
      'aria-describedby': 'commit-hint',
    },
  })
  textarea.value = model.composer.message

  // 交接入口与静态提示挤在同一行：提示说「只提交已暂存的内容」，入口说「不想自己拆就交给 AI」，
  // 两件事都发生在动手之前，合在一行不额外占高度，列表就能多露几行文件。
  const hint = h('div', { class: 'composer-hint', id: 'commit-hint' },
    h('span', { class: 'hint-text', text: model.composer.hint }),
    handoffEntry(HANDOFF_ENTRY.changes, 'changes', 'inline'))

  const commitButton = button({
    label: COPY.changes.commitLabel(model.composer.stagedCount),
    kind: 'primary',
    size: 'md',
    disabled: model.composer.disabled,
    busy: model.composer.busy,
    busyLabel: COPY.busy.commit,
    title: model.composer.disabledReason,
    action: 'commit',
    focusKey: 'commit',
  })

  // 提交按钮固定贴在右下角：它上面是禁用原因（有才画），再上面是说明输入与静态提示。
  // 原因单独成行，按钮就不会因为文案长短被挤来挤去，位置在 300 到 520 各档都一样。
  const submitRow = h('div', { class: 'composer-submit' }, commitButton)
  composer.append(stagedLine, textarea, hint)
  if (model.composer.disabledReason !== null) {
    composer.append(h('div', { class: 'composer-reason', id: 'commit-reason' },
      icon('alert', 12), h('span', { text: model.composer.disabledReason })))
  }
  composer.append(submitRow)
  view.append(filterRow, list, composer)
  return view
}

function renderGroup(group: GroupModel, model: ChangesModel): HTMLElement {
  const section = h('section', { class: `group group-${group.id}` })
  if (group.rows.length === 0) {
    // 空分组压成一行，只写「没有」这个结论：分组名已经在上方的筛选器里出现，
    // 再抄一遍会读成「存在冲突：没有冲突文件」这种自相矛盾的句子。
    section.append(h('div', { class: 'group-empty' },
      h('span', { class: 'group-empty-text', text: group.emptyText })))
    return section
  }

  const head = h('div', { class: 'group-head' },
    h('span', { class: 'group-title', text: group.label }),
    h('span', { class: 'group-count', text: String(group.rows.length) }))

  if (group.id === 'staged' && model.canUnstageAll) {
    head.append(h('button', {
      class: 'group-action',
      attrs: { type: 'button', 'aria-label': COPY.actions.unstageAll },
      dataset: { action: 'unstage-all' },
    }, COPY.actions.unstageAll))
  }
  if (group.id === 'unstaged') {
    const blocked = model.conflictCount > 0
    head.append(h('button', {
      class: `group-action${blocked ? ' is-disabled' : ''}`,
      attrs: {
        type: 'button',
        disabled: !model.canStageAll || blocked,
        title: blocked ? COPY.block['conflicts-unresolved'] : null,
        'aria-label': COPY.actions.stageAll,
      },
      dataset: { action: 'stage-all' },
    }, COPY.actions.stageAll))
    if (model.canDiscardAll) {
      head.append(h('button', {
        class: 'group-action is-danger',
        attrs: { type: 'button', 'aria-label': COPY.changes.discardAll, title: '把全部未暂存的改动丢弃（不能撤回）' },
        dataset: { action: 'changes-pending', kind: 'discard-all' },
      }, COPY.changes.discardAll))
    }
  }

  section.append(head)
  // 「丢弃全部」的确认卡紧贴分组标题出现，不再另开一层。
  if (model.pending !== null && model.pending.kind === 'discard-all') section.append(renderConfirmCard(model.pending))
  for (const row of group.rows) section.append(renderFileRow(row, model))
  return section
}

function renderFileRow(row: FileRowModel, model: ChangesModel): HTMLElement {
  const pendingHere = model.pending !== null && model.pending.path === row.fullPath
  const menuOpen = model.openMenuPath === row.fullPath
  const rowNode = h('div', {
    class: `file-row${row.expanded ? ' is-open' : ''}${row.conflict ? ' is-conflict' : ''}${pendingHere ? ' is-pending' : ''}`,
  })

  // 文件行的「可点主体」与「行尾按钮」必须分开：按钮不能嵌在另一个按钮语义里，
  // 否则读屏会念出两层可点区域，键盘 Tab 也会在同一个文件上停两次。
  const main = h('div', {
    class: 'file-main',
    attrs: {
      role: 'button',
      tabindex: 0,
      'aria-expanded': row.expanded ? 'true' : 'false',
      'aria-label': `${row.fullPath}：${row.staged ? '已暂存' : row.conflict ? '冲突' : '未暂存'}`,
      'data-focus-key': `row:${row.fullPath}`,
      title: row.fullPath,
    },
    dataset: { action: 'toggle-file', path: row.fullPath },
  })

  main.append(badgeLetter(row.badge.letter, row.badge.tone, row.conflict ? '冲突文件' : '变更类型'))
  main.append(h('span', { class: 'file-path' },
    h('span', { class: 'file-dir', text: row.dir }),
    h('span', { class: 'file-name', text: row.name })))

  if (row.extraBadges.length > 0) {
    const extras = h('span', { class: 'file-extras' })
    for (const text of row.extraBadges) extras.append(chip(text, row.conflict ? 'error' : text === COPY.changes.stagedBadge ? 'ok' : 'muted', { small: true }))
    main.append(extras)
  }

  if (row.delta !== null) {
    main.append(h('span', { class: 'file-delta' },
      row.delta.added === null ? null : h('span', { class: 'dl-add', text: row.delta.added }),
      row.delta.deleted === null ? null : h('span', { class: 'dl-del', text: row.delta.deleted })))
  }

  main.append(h('span', { class: `row-chevron${row.expanded ? ' is-open' : ''}`, attrs: { 'aria-hidden': 'true' } }, icon('chevron', 12)))

  const actions = h('span', { class: 'file-actions' })
  if (row.canStage) {
    actions.append(h('button', {
      class: 'row-act',
      attrs: { type: 'button', title: `暂存 ${row.name}`, 'data-focus-key': `stage:${row.fullPath}` },
      dataset: { action: 'stage', path: row.fullPath },
    }, COPY.actions.stage))
  } else if (row.canUnstage) {
    actions.append(h('button', {
      class: 'row-act',
      attrs: { type: 'button', title: `撤回 ${row.name} 的暂存`, 'data-focus-key': `unstage:${row.fullPath}` },
      dataset: { action: 'unstage', path: row.fullPath },
    }, COPY.actions.unstage))
  }
  if (row.showMenu) {
    actions.append(h('button', {
      class: `row-act row-more${menuOpen ? ' is-open' : ''}`,
      attrs: {
        type: 'button',
        'aria-haspopup': 'true',
        'aria-expanded': menuOpen ? 'true' : 'false',
        'aria-label': COPY.changes.menuOpen,
        title: COPY.changes.menuOpen,
        'data-focus-key': `more:${row.fullPath}`,
      },
      dataset: { action: 'changes-open-menu', path: row.fullPath },
    }, h('span', { class: 'row-more-dots', text: '⋯', attrs: { 'aria-hidden': 'true' } })))
  }

  rowNode.append(main, actions)

  const wrap = h('div', { class: 'file-row-wrap' }, rowNode)
  // 菜单紧贴着发起它的那一行：不弹到页面另一头，也不盖住别的行。
  if (menuOpen) wrap.append(renderRowMenu(row, model))
  if (pendingHere && model.pending !== null) wrap.append(renderConfirmCard(model.pending))
  if (row.expanded) {
    const body = h('div', { class: 'file-detail' })
    if (row.patch !== null) body.append(patchBlock(row.patch), h('div', { class: 'file-detail-note', text: COPY.changes.patchNote }))
    else if (row.patchNote !== null) body.append(note(row.patchNote))
    wrap.append(body)
  }
  return wrap
}

/** 行内「更多」菜单：一张贴着行的竖排小卡片，条目由这一行能做什么决定。 */
function renderRowMenu(row: FileRowModel, model: ChangesModel): HTMLElement {
  const menu = h('div', { class: 'row-menu', attrs: { role: 'menu', 'aria-label': `${row.name} 的更多操作` } })
  const item = (label: string, action: string, dataset: Record<string, string>, danger = false): HTMLElement =>
    h('button', {
      class: `row-menu-item${danger ? ' is-danger' : ''}`,
      attrs: { type: 'button', role: 'menuitem', 'data-focus-key': `menu:${row.fullPath}:${action}:${dataset.kind ?? ''}` },
      dataset: { action, ...dataset },
    }, label)

  if (row.canDiscard) menu.append(item(COPY.changes.menuDiscard, 'changes-pending', { kind: 'discard', path: row.fullPath }, true))
  if (row.canIgnore) menu.append(item(COPY.changes.menuIgnore, 'changes-pending', { kind: 'ignore', path: row.fullPath }))
  if (row.canDeleteUntracked) menu.append(item(COPY.changes.menuDelete, 'changes-pending', { kind: 'delete-untracked', path: row.fullPath }, true))
  if (row.resolvable) {
    menu.append(item(COPY.changes.menuResolveOurs, 'changes-pending', { kind: 'resolve-ours', path: row.fullPath }, true))
    menu.append(item(COPY.changes.menuResolveTheirs, 'changes-pending', { kind: 'resolve-theirs', path: row.fullPath }, true))
  }
  if (menu.childElementCount === 0) menu.append(note('这一行没有可用的行级动作。'))
  menu.append(h('button', {
    class: 'row-menu-item is-close',
    attrs: { type: 'button', 'aria-label': COPY.changes.menuClose },
    dataset: { action: 'changes-open-menu', path: '' },
  }, COPY.changes.menuClose))
  // 菜单是交互控件，拿掉 data-focus-key 之外的焦点逻辑由 app.ts 统一恢复。
  void model
  return menu
}

/** 危险动作确认卡：紧贴触发行或分组标题，写清会动什么、丢什么、能不能撤回。 */
function renderConfirmCard(pending: ChangesPendingModel): HTMLElement {
  const card = h('div', { class: `changes-confirm${pending.danger ? ' is-danger' : ' is-warn'}`, attrs: { role: 'group', 'aria-label': pending.title } },
    h('h3', { class: 'changes-confirm-title', text: pending.title }),
    h('p', { class: 'changes-confirm-body', text: pending.body }))
  if (pending.meta !== null) card.append(h('p', { class: 'changes-confirm-meta', text: pending.meta }))
  card.append(h('div', { class: 'changes-confirm-actions' },
    button({ label: COPY.changes.confirmCancel, kind: 'ghost', size: 'sm', action: 'changes-pending-cancel', focusKey: 'changes-cancel' }),
    button({
      label: pending.confirmLabel,
      kind: pending.danger ? 'danger' : 'secondary',
      size: 'sm',
      action: 'changes-apply',
      focusKey: 'changes-confirm',
    })))
  return card
}
