/**
 * ui/views/history.ts —— 提交历史视图：列表与详情在同一个面板里互相替换，不做左右两栏。
 *
 * 为什么不做两栏：面板宽度是 300 到 520，两栏各剩两百多，提交主题与文件路径都会被截断；
 * 列表与详情用「整页替换 + 明确的返回」在窄宽度下反而少一次误读。
 * 列表行的信息顺序按用户问题排：先认出是哪次提交（短号 + 主题），再看谁提交的、什么时候。
 *
 * 这一版补上「提交也能补做动作」：每行尾部一个「更多」，菜单紧贴这一行展开；
 * 回退、拣选、撤销都先给一句后果说明，结果条回到列表最上面（也就是刚点的那一行附近）。
 */
import type { CommitDetailModel, CommitRowModel, HistoryModel } from '../../domain/select'
import { COPY } from '../../data/copy'
import type { ResultMessage } from '../../domain/session'
import { icon, h } from '../dom'
import { button, emptyState, note, patchBlock, resultBanner } from '../primitives'

export interface HistoryViewOptions {
  /** 历史动作产生的结果：贴着列表顶端出现，离刚点过的那一行最近。 */
  result?: ResultMessage | null
  /** 哪一行的「更多」菜单开着。 */
  menuOid?: string | null
  /** 哪一行正在等「撤销提交」的二次确认。 */
  confirmOid?: string | null
  /** 最新一条提交：撤销只能对它做，菜单里其余行对应条目要禁用。 */
  headOid?: string | null
  busy?: boolean
}

export function renderHistory(model: HistoryModel, options: HistoryViewOptions = {}): HTMLElement {
  if (model.detail !== null) return renderDetail(model.detail, options)
  return renderList(model, options)
}

function renderList(model: HistoryModel, options: HistoryViewOptions): HTMLElement {
  const view = h('div', { class: 'view view-history' })

  const search = h('input', {
    class: 'search-input',
    attrs: {
      type: 'search',
      placeholder: COPY.history.searchPlaceholder(model.total),
      'aria-label': COPY.history.searchPlaceholder(model.total),
      autocomplete: 'off',
      spellcheck: 'false',
      'data-field': 'history-query',
      'data-focus-key': 'history-query',
    },
  })
  search.value = model.query

  const mergeToggle = h('button', {
    class: `toggle-btn${model.mergeOnly ? ' is-on' : ''}`,
    attrs: { type: 'button', 'aria-pressed': model.mergeOnly ? 'true' : 'false', 'data-focus-key': 'history-merge' },
    dataset: { action: 'history-merge-only' },
  }, COPY.history.mergeOnly)

  const tools = h('div', { class: 'history-tools' }, search, mergeToggle)
  const scope = h('div', { class: 'history-scope', text: model.scopeText })

  const scroll = h('div', { class: 'history-scroll' })
  if (options.result !== null && options.result !== undefined && options.result.source === 'history') {
    scroll.append(resultBanner(options.result))
  }
  if (model.empty) {
    scroll.append(emptyState(COPY.history.empty, null))
  } else {
    for (const row of model.rows) {
      if (row.group !== null) scroll.append(h('div', { class: 'day-group', text: row.group }))
      scroll.append(renderCommitLine(row, model, options))
    }
  }

  view.append(tools, scope, scroll)
  return view
}

/** 一行提交 = 可点主体 + 行尾「更多」按钮；两者是兄弟节点，不嵌套可点元素。 */
function renderCommitLine(row: CommitRowModel, model: HistoryModel, options: HistoryViewOptions): HTMLElement {
  const menuOpen = options.menuOid === row.oid
  const line = h('div', { class: 'commit-line' },
    h('div', {
      class: `commit-row${row.selected ? ' is-selected' : ''}${menuOpen ? ' is-menu' : ''}`,
      attrs: {
        role: 'button',
        tabindex: 0,
        'aria-label': `${row.short} ${row.subject}`,
        'data-focus-key': `commit:${row.oid}`,
        title: row.subject,
      },
      dataset: { action: 'history-open', oid: row.oid },
    },
    h('span', { class: 'commit-hash mono', text: row.short }),
    subjectNodeOf(row),
    h('span', { class: 'commit-meta' },
      h('span', { class: 'commit-author', text: row.author }),
      h('span', { class: 'commit-when', text: row.when }),
      row.filesCount > 0 ? h('span', { class: 'commit-files', text: `${row.filesCount} 个文件` }) : null),
    h('span', { class: 'commit-chevron' }, icon('chevron', 12))),
    h('button', {
      class: `commit-more${menuOpen ? ' is-open' : ''}`,
      attrs: {
        type: 'button',
        'aria-haspopup': 'true',
        'aria-expanded': menuOpen ? 'true' : 'false',
        'aria-label': COPY.history.menuOpen,
        title: COPY.history.menuOpen,
        'data-focus-key': `commit-more:${row.oid}`,
        disabled: options.busy === true,
      },
      dataset: { action: 'commit-menu', oid: row.oid },
    }, h('span', { text: '⋯', attrs: { 'aria-hidden': 'true' } })))

  const wrap = h('div', { class: 'commit-line-wrap' }, line)
  if (menuOpen) {
    const headOid = options.headOid ?? null
    if (options.confirmOid === row.oid) {
      wrap.append(renderUndoConfirm(row, model))
    } else {
      wrap.append(renderCommitMenu(row, headOid))
    }
  }
  return wrap
}

/** 提交行的菜单：紧贴这一行，条目按「读一行历史之后自然会想做的事」排。 */
function renderCommitMenu(row: CommitRowModel, headOid: string | null): HTMLElement {
  const isHead = headOid !== null && headOid === row.oid
  const menu = h('div', { class: 'commit-menu', attrs: { role: 'menu', 'aria-label': `提交 ${row.short} 的更多操作` } })
  const item = (label: string, action: string, dataset: Record<string, string>, options: { disabled?: boolean; title?: string | null; danger?: boolean } = {}): HTMLElement =>
    h('button', {
      class: `row-menu-item${options.danger === true ? ' is-danger' : ''}`,
      attrs: { type: 'button', role: 'menuitem', disabled: options.disabled === true, title: options.title ?? null, 'aria-label': label },
      dataset: { action, ...dataset },
    }, label)

  menu.append(item(COPY.history.menuRevert, 'commit-revert', { oid: row.oid }))
  if (!row.merge) menu.append(item(COPY.history.menuCherryPick, 'commit-cherry-pick', { oid: row.oid }))
  else menu.append(item(COPY.history.menuCherryPick, 'commit-cherry-pick', { oid: row.oid }, { disabled: true, title: '合并提交有两个父提交，拣选时 git 不知道要带哪一边。' }))
  menu.append(item(
    COPY.history.menuUndo,
    'commit-undo-start',
    { oid: row.oid },
    { disabled: !isHead, title: isHead ? COPY.history.undoBody : COPY.history.menuUndoHint, danger: true },
  ))
  menu.append(item(COPY.history.menuCopy, 'copy-oid', { oid: row.oid }))
  menu.append(h('button', {
    class: 'row-menu-item is-close',
    attrs: { type: 'button', 'aria-label': COPY.history.menuClose },
    dataset: { action: 'commit-menu', oid: row.oid },
  }, COPY.history.menuClose))
  return menu
}

/** 撤销提交的二次确认：替换掉菜单，仍然贴着这一行。 */
function renderUndoConfirm(row: CommitRowModel, model: HistoryModel): HTMLElement {
  void model
  return h('div', { class: 'commit-confirm', attrs: { role: 'group', 'aria-label': COPY.history.undoTitle(row.subject) } },
    h('h3', { class: 'commit-confirm-title', text: COPY.history.undoTitle(row.subject) }),
    h('p', { class: 'commit-confirm-body', text: COPY.history.undoBody }),
    h('p', { class: 'commit-confirm-note', text: COPY.history.undoNote }),
    h('div', { class: 'commit-confirm-actions' },
      button({ label: COPY.history.cancel, kind: 'ghost', size: 'sm', action: 'commit-menu-close', focusKey: 'commit-cancel' }),
      button({
        label: COPY.history.undoConfirm,
        kind: 'danger',
        size: 'sm',
        action: 'commit-undo',
        dataset: { oid: row.oid },
        focusKey: 'commit-undo-confirm',
      })))
}

/**
 * 合并提交的原始说明是 git 生成的英文句子（Merge branch 'main' of https://...），
 * 直接当标题读像乱码。所以第一行给「合并」这个结论，第二行小字保留原文，
 * 用户既知道发生了什么，也还能核对 git 的写法。普通提交只画一行说明。
 */
function subjectNodeOf(row: CommitRowModel): HTMLElement {
  if (!row.merge) return h('span', { class: 'commit-subject', text: row.subject })
  return h('span', { class: 'commit-subject commit-subject-merge' },
    h('span', { class: 'commit-merge-lead', text: COPY.history.mergeChip }),
    h('span', { class: 'commit-merge-raw mono', text: row.subject }))
}

function renderDetail(detail: CommitDetailModel, options: HistoryViewOptions): HTMLElement {
  const view = h('div', { class: 'view view-detail' })

  const head = h('div', { class: 'detail-head' },
    h('button', {
      class: 'back-btn',
      attrs: { type: 'button', 'data-focus-key': 'history-back' },
      dataset: { action: 'history-back' },
    }, icon('back', 13), h('span', { text: COPY.actions.back })))
  view.append(head)

  const scroll = h('div', { class: 'detail-scroll' })
  // 合并提交的原始说明是 git 生成的英文句子：详情页也先给「合并提交」，原文降为一行小字。
  if (detail.parents.length > 1) {
    scroll.append(
      h('h2', { class: 'detail-subject', text: `${COPY.history.mergeChip}提交` }),
      h('div', { class: 'detail-subject-raw mono', text: detail.subject }),
    )
  } else {
    scroll.append(h('h2', { class: 'detail-subject', text: detail.subject }))
  }

  const meta = h('dl', { class: 'detail-meta' })
  const row = (label: string, value: Node | string): HTMLElement => h('div', { class: 'meta-row' },
    h('dt', { class: 'meta-k', text: label }),
    h('dd', { class: 'meta-v' }, value))
  meta.append(
    row(COPY.history.hash, h('span', { class: 'mono', text: detail.short, title: detail.oid })),
    row(COPY.history.author, detail.author),
    row(COPY.history.time, detail.when),
  )
  const parents = h('span', { class: 'parents' })
  detail.parents.forEach((parent) => {
    parents.append(h('span', { class: 'parent-hash mono', text: parent, attrs: { title: `父提交 ${parent}` } }))
  })
  meta.append(row(COPY.history.parents, parents))
  scroll.append(meta)

  const files = h('div', { class: 'detail-files' })
  files.append(h('div', { class: 'detail-files-head' }, COPY.history.changedFiles(detail.files.length)))
  if (detail.filesNote !== null) files.append(note(detail.filesNote, 'muted'))
  for (const file of detail.files) {
    const fileNode = h('div', {
      class: `file-row commit-file${file.expanded ? ' is-open' : ''}`,
      attrs: {
        role: 'button',
        tabindex: 0,
        'aria-expanded': file.expanded ? 'true' : 'false',
        'aria-label': file.path,
        'data-focus-key': `history-file:${file.path}`,
        title: file.path,
      },
      dataset: { action: 'history-file', path: file.path },
    })
    fileNode.append(h('span', { class: 'file-path' },
      h('span', { class: 'file-dir', text: file.dir }),
      h('span', { class: 'file-name', text: file.name })))
    fileNode.append(h('span', { class: 'file-delta' },
      file.delta.added === null ? null : h('span', { class: 'dl-add', text: file.delta.added }),
      file.delta.deleted === null ? null : h('span', { class: 'dl-del', text: file.delta.deleted })))
    fileNode.append(h('span', { class: `row-chevron${file.expanded ? ' is-open' : ''}` }, icon('chevron', 12)))
    files.append(fileNode)
    if (file.expanded) {
      const body = h('div', { class: 'file-detail' })
      if (file.patch !== null) {
        body.append(patchBlock(file.patch))
        body.append(h('div', { class: 'file-detail-note', text: file.binary ? '二进制文件，原型不渲染差异。' : COPY.history.diffSampleNote }))
      } else {
        body.append(note('这个扩展名没有可展示的示例补丁。'))
      }
      files.append(body)
    }
  }
  scroll.append(files)
  if (options.result !== null && options.result !== undefined && options.result.source === 'history') {
    scroll.append(resultBanner(options.result))
  }
  view.append(scroll)
  return view
}
