/**
 * ui/views/changes.ts —— 改动视图。设计目标按重要性排：
 *   ① 先看见「这批改动整体是什么样」（三个可点的计数控件就是筛选器）；
 *   ② 再逐行看：路径按目录与文件名分开画、变更类型用字母徽章、增删行数右对齐；
 *   ③ 展开行看逐行差异，差异不跳出列表；
 *   ④ 底部常驻提交区：暂存数、说明、主按钮、禁用原因、提交结果都在同一处。
 *
 * 这个视图里不出现「更多」菜单：丢弃改动、加入 .gitignore 需要宿主新增命令，
 * 原型不画没有后端的按钮（README 的「未实现的提案」一节列着它们）。
 */
import type { ChangesModel, FileRowModel, GroupModel } from '../../domain/select'
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
  if (model.empty) {
    list.append(emptyState(COPY.changes.emptyTitle, COPY.changes.emptyHint))
  } else {
    for (const group of model.groups) list.append(renderGroup(group, model))
  }

  const composer = h('div', { class: 'composer' })
  if (result !== null) composer.append(resultBanner(result))
  const stagedLine = h('div', { class: 'composer-head' },
    h('span', { class: 'composer-count' },
      h('span', { class: 'count', text: String(model.composer.stagedCount) }),
      h('span', { class: 'unit', text: '个文件已暂存' })),
    model.canUnstageAll
      ? h('button', {
        class: 'link-btn',
        attrs: { type: 'button', 'data-focus-key': 'unstage-all' },
        dataset: { action: 'unstage-all' },
      }, COPY.actions.unstageAll)
      : null)

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
  }

  section.append(head)
  for (const row of group.rows) section.append(renderFileRow(row))
  return section
}

function renderFileRow(row: FileRowModel): HTMLElement {
  const rowNode = h('div', { class: `file-row${row.expanded ? ' is-open' : ''}${row.conflict ? ' is-conflict' : ''}` })

  // 文件行的「可点主体」与「暂存按钮」必须分开：按钮不能嵌在另一个按钮语义里，
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

  rowNode.append(main, actions)

  const wrap = h('div', { class: 'file-row-wrap' }, rowNode)
  if (row.expanded) {
    const body = h('div', { class: 'file-detail' })
    if (row.patch !== null) body.append(patchBlock(row.patch), h('div', { class: 'file-detail-note', text: COPY.changes.patchNote }))
    else if (row.patchNote !== null) body.append(note(row.patchNote))
    wrap.append(body)
  }
  return wrap
}
