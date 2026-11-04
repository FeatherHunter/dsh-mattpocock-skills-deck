/**
 * ui/views/changes.ts —— 改动视图。设计目标按重要性排：
 *   ① 先看见「这批改动整体是什么样」（三个可点的计数控件就是筛选器）；
 *   ② 再逐行看：路径按目录与文件名分开画、变更类型用字母徽章、增删行数右对齐；
 *   ③ 每一行的动作都在这一行上：暂存/取消暂存在行尾，「更多」菜单与二次确认贴在这一行下面；
 *   ④ 展开行看逐行差异，差异不跳出列表；
 *   ⑤ 底部常驻提交区：已暂存的文件数、说明、主按钮、禁用原因、提交结果都在同一处。
 *
 * 「就近」是这一版的硬规则：行级动作的结果不放到页面底部的结果条里，
 * 而是紧贴着改动列表的顶端出现；确认卡紧贴着触发它的那一行出现。
 */
import type { ChangesModel, ChangesPendingModel, ComposerModel, FileRowModel, GroupModel } from '../../domain/select'
import { COPY } from '../../data/copy'
import { HANDOFF_ENTRY } from '../../domain/handoff'
import type { CommitForm, ResultMessage } from '../../domain/session'
import { icon, h } from '../dom'
import { badgeLetter, button, chip, emptyState, note, patchBlock, resultBanner } from '../primitives'
import { handoffEntry } from './handoff'

export function renderChanges(model: ChangesModel, result: ResultMessage | null): HTMLElement {
  const view = h('div', { class: 'view view-changes' })

  // 三张计数卡：数字在上、标签在下，整张卡就是筛选器（与真实插件的统计卡同一套读法）。
  // 三张卡等宽，切换筛选时列表不会因为数字位数变化左右跳；0 也用同一套颜色写出来，
  // 「冲突 0」本身就是要给人看的结论，不该灰掉。
  const filterRow = h('div', { class: 'stats', attrs: { role: 'group', 'aria-label': '按状态筛选' } })
  for (const stat of model.stats) {
    const active = model.filter === stat.id
    filterRow.append(
      h('button', {
        class: `stat tone-${stat.tone}${active ? ' is-on' : ''}`,
        attrs: {
          type: 'button',
          'aria-pressed': active ? 'true' : 'false',
          'data-focus-key': `filter-${stat.id}`,
          title: active ? '再点一次显示全部分组' : `只看${stat.label}`,
        },
        dataset: { action: 'filter', filter: stat.id },
      },
      h('span', { class: 'stat-n', text: String(stat.count) }),
      h('span', { class: 'stat-t', text: stat.label })),
    )
  }

  const list = h('div', { class: 'changes-scroll' })
  // 行级动作（丢弃、忽略、解决冲突、储藏）的结果贴在列表最上面：它离刚点过的那一行最近。
  // 提交结果留在底部提交区，因为它由底部的提交按钮产生。
  // 同步动作（拉取、获取、推送）与重新读取的结果已经在顶部同步带里报过，这里不再重复画一条：
  // 同一条结果画两处，读者会以为发生了两件事。
  if (result !== null && result.source === 'changes') list.append(resultBanner(result))
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

  // fixup 与 squash 的说明由面板自动写，输入框换成一行只读的自动说明；
  // 别的形态仍然是可写的输入框，修订时里面预填上一条提交的说明。
  const messageNode = model.composer.options.messageEditable
    ? (() => {
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
      return textarea
    })()
    : renderAutoMessage(model.composer)

  const commitButton = button({
    label: model.composer.label,
    kind: 'primary',
    size: 'md',
    disabled: model.composer.disabled,
    busy: model.composer.busy,
    busyLabel: COPY.busy.commit,
    title: model.composer.disabledReason,
    action: 'commit',
    focusKey: 'commit',
  })
  // 「提交选项」的入口是贴在主按钮右边的一枚箭头：它属于这颗按钮，不新增一行、也不改首屏高度，
  // 展开区里的形态、模板、钩子与签名只在点开之后出现。
  const optionsToggle = h('button', {
    class: 'commit-options-toggle' + (model.composer.optionsOpen ? ' is-on' : ''),
    attrs: {
      type: 'button',
      'aria-expanded': model.composer.optionsOpen ? 'true' : 'false',
      'aria-haspopup': 'true',
      'aria-label': COPY.commitOptions.triggerLabel,
      title: COPY.commitOptions.triggerHint,
      'data-focus-key': 'commit-options',
    },
    dataset: { action: 'commit-options-toggle' },
  }, h('span', { class: 'commit-options-caret', attrs: { 'aria-hidden': 'true' }, text: '⌄' }))

  // 提交区最后一行：左边是禁用原因或一句提示，右边是提交按钮，同一行、同一基线。
  // 原因与按钮说的是同一件事（为什么现在点不了），各占一行只会把提交区撑高、把列表压矮。
  // 交接入口留在中间：它和提示都在动手之前出现，位置在按钮左侧不会被忽略。
  const footLeft = model.composer.disabledReason === null
    ? h('span', { class: 'hint-text', text: model.composer.hint })
    : h('span', { class: 'composer-reason', id: 'commit-reason' },
      icon('alert', 12), h('span', { text: model.composer.disabledReason }))
  const foot = h('div', { class: 'composer-foot', id: 'commit-hint' },
    footLeft,
    handoffEntry(HANDOFF_ENTRY.changes, 'changes'),
    h('div', { class: 'commit-split' }, commitButton, optionsToggle))
  composer.append(stagedLine, messageNode, foot)
  // 提交选项贴在提交区上方浮起来，不再挤占文件列表：它是一次临时选择（形态、模板、钩子、签名），
  // 松开以后文件列表还是原来那么高。这和分支浮层、行菜单是同一种「贴触发点的浮层」。
  if (model.composer.optionsOpen) composer.append(renderCommitOptions(model.composer))
  view.append(filterRow, list, composer)
  return view
}

/**
 * 提交选项展开区：形态、作用对象、内容来源、说明模板与三个记录方式。
 *
 * 为什么这六条都放在提交区而不是提交行菜单里：它们改的是「这次提交写什么、怎么记」，
 * 而提交行菜单上的还原、拣选、撤销改的是「已经记下来的那条提交」。前者需要输入框与已暂存清单，
 * 只有提交区同时看得见这两样；后者不需要再写什么，所以在行上就地做。
 */
function renderCommitOptions(composer: ComposerModel): HTMLElement {
  const options = composer.options
  const copy = COPY.commitOptions
  const panel = h('div', { class: 'commit-options', attrs: { role: 'dialog', 'aria-label': copy.title } })
  panel.append(h('div', { class: 'opt-head' },
    h('span', { class: 'opt-title', text: copy.title }),
    h('button', {
      class: 'opt-close',
      attrs: { type: 'button', 'aria-label': '收起提交选项', title: '收起提交选项', 'data-focus-key': 'commit-options-close' },
      dataset: { action: 'commit-options-toggle' },
    }, '×')))

  const forms: Array<[CommitForm, string]> = [
    ['commit', copy.form.commit],
    ['amend', copy.form.amend],
    ['fixup', copy.form.fixup],
    ['squash', copy.form.squash],
  ]
  const seg = h('div', { class: 'opt-seg', attrs: { role: 'group', 'aria-label': copy.formKey } })
  for (const [form, label] of forms) {
    seg.append(h('button', {
      class: 'opt-seg-btn' + (options.form === form ? ' is-on' : ''),
      attrs: {
        type: 'button',
        'aria-pressed': options.form === form ? 'true' : 'false',
        'data-focus-key': 'commit-form:' + form,
        title: copy.formNote[form],
      },
      dataset: { action: 'commit-form', form },
    }, label))
  }
  // 四组都按「左边一行术语、右边控件与一句后果」排；窄到 359 以下时自动改成上下两行。
  const group = (key: string, control: HTMLElement, note: string | null): HTMLElement =>
    h('div', { class: 'opt-line' },
      h('span', { class: 'opt-key', text: key }),
      h('div', { class: 'opt-body' },
        control,
        note === null ? null : h('p', { class: 'opt-note', text: note })))

  panel.append(group(copy.formKey, seg,
    options.form === 'commit' ? options.formNote : options.formNote + (options.target === null
      ? ' ' + copy.targetNone
      : ' ' + copy.target(options.target.short, options.target.subject))))

  panel.append(group(copy.contentKey, optionSwitch({
    label: copy.allTracked,
    note: options.allTrackedCount === 0 ? copy.allTrackedEmpty : copy.allTrackedNote(options.allTrackedCount),
    on: options.allTracked,
    action: 'commit-all-tracked',
    focusKey: 'commit-all-tracked',
    disabled: options.allTrackedCount === 0 && options.allTracked === false,
  }), options.allTrackedCount === 0
    ? copy.allTrackedEmpty
    : options.allTracked ? copy.allTrackedNote(options.allTrackedCount) : copy.contentNote))

  panel.append(group(copy.messageKey, h('button', {
    class: 'opt-link',
    attrs: { type: 'button', 'data-focus-key': 'commit-template', title: copy.templateNote },
    dataset: { action: options.templateApplied ? 'template-undo' : 'template-apply' },
  }, options.templateApplied ? copy.templateApplied + ' · ' + copy.templateUndo : copy.templateApply), copy.templateNote))

  panel.append(group(copy.recordKey, h('div', { class: 'opt-records' },
    optionSwitch({ label: copy.skipHooks, note: copy.skipHooksNote, on: options.skipHooks, action: 'skip-hooks', focusKey: 'skip-hooks' }),
    optionSwitch({ label: copy.signCommit, note: copy.signCommitNote, on: options.signCommit, action: 'sign-commit', focusKey: 'sign-commit' }),
    optionSwitch({ label: copy.signoff, note: copy.signoffNote, on: options.signoff, action: 'signoff', focusKey: 'signoff' })), copy.recordNote))
  return panel
}

/** 一个开关：方框 + 名字 + 一句「打开以后会怎样」，整行是一个按钮，键盘只停一次。 */
function optionSwitch(item: { label: string; note: string; on: boolean; action: string; focusKey: string; disabled?: boolean }): HTMLElement {
  return h('button', {
    class: 'opt-check' + (item.on ? ' is-on' : '') + (item.disabled === true ? ' is-off' : ''),
    attrs: {
      type: 'button',
      role: 'switch',
      'aria-checked': item.on ? 'true' : 'false',
      'data-focus-key': item.focusKey,
      disabled: item.disabled === true,
      title: item.note,
    },
    dataset: { action: item.action },
  },
  h('span', { class: 'opt-box', attrs: { 'aria-hidden': 'true' } }),
  h('span', { class: 'opt-check-label', text: item.label }))
}

/** fixup / squash 形态下替代输入框的一行：写明说明会被自动写成什么，以及为什么不让人改。 */
function renderAutoMessage(composer: ComposerModel): HTMLElement {
  const copy = COPY.commitOptions
  return h('div', { class: 'commit-auto', attrs: { id: 'commit-message' } },
    h('span', { class: 'commit-auto-lead', text: copy.autoMessageLead }),
    h('span', { class: 'commit-auto-text mono', text: composer.options.autoMessage ?? '' }),
    h('span', { class: 'commit-auto-note', text: copy.autoMessageNote }))
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

  // 分组动作装在同一个容器里再靠右：只给容器一个 margin-left:auto，
  // 两颗动作才会挨着排在同一侧。以前每颗按钮各自 margin-left:auto，
  // 浏览器会把剩余空间平分成两份，第一颗就被推到行中间，看起来像「全部暂存」居中了。
  const actions = h('div', { class: 'group-actions' })

  if (group.id === 'staged' && model.canUnstageAll) {
    actions.append(h('button', {
      class: 'group-action',
      attrs: { type: 'button', 'aria-label': COPY.actions.unstageAll },
      dataset: { action: 'unstage-all' },
    }, COPY.actions.unstageAll))
  }
  if (group.id === 'unstaged') {
    const blocked = model.conflictCount > 0
    actions.append(h('button', {
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
      actions.append(h('button', {
        class: 'group-action is-danger',
        attrs: { type: 'button', 'aria-label': COPY.changes.discardAll, title: '把全部未暂存的改动丢弃（不能撤回）' },
        dataset: { action: 'changes-pending', kind: 'discard-all' },
      }, COPY.changes.discardAll))
    }
  }
  if (actions.childElementCount > 0) head.append(actions)

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
      attrs: { type: 'button', title: `把 ${row.name} 暂存`, 'data-focus-key': `stage:${row.fullPath}` },
      dataset: { action: 'stage', path: row.fullPath },
    }, COPY.actions.stage))
  } else if (row.canUnstage) {
    actions.append(h('button', {
      class: 'row-act',
      attrs: { type: 'button', title: `取消暂存 ${row.name}`, 'data-focus-key': `unstage:${row.fullPath}` },
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