/**
 * ui/views/history.ts —— 提交历史视图：列表与详情在同一个面板里互相替换，不做左右两栏。
 *
 * 为什么不做两栏：面板宽度是 300 到 520，两栏各剩两百多，提交主题与文件路径都会被截断；
 * 列表与详情用「整页替换 + 明确的返回」在窄宽度下反而少一次误读。
 * 列表行的信息顺序按用户问题排：先认出是哪次提交（短号 + 主题），再看谁提交的、什么时候。
 */
import type { CommitDetailModel, CommitRowModel, HistoryModel } from '../../domain/select'
import { COPY } from '../../data/copy'
import { icon, h } from '../dom'
import { emptyState, keycap, note, patchBlock } from '../primitives'

export function renderHistory(model: HistoryModel): HTMLElement {
  if (model.detail !== null) return renderDetail(model.detail)
  return renderList(model)
}

function renderList(model: HistoryModel): HTMLElement {
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
  if (model.empty) {
    scroll.append(emptyState(COPY.history.empty, null))
  } else {
    for (const row of model.rows) {
      if (row.group !== null) scroll.append(h('div', { class: 'day-group', text: row.group }))
      scroll.append(h('div', {
        class: `commit-row${row.selected ? ' is-selected' : ''}`,
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
      h('span', { class: 'commit-chevron' }, icon('chevron', 12))))
    }
  }

  view.append(tools, scope, scroll)
  return view
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

function renderDetail(detail: CommitDetailModel): HTMLElement {
  const view = h('div', { class: 'view view-detail' })

  const head = h('div', { class: 'detail-head' },
    h('button', {
      class: 'back-btn',
      attrs: { type: 'button', 'data-focus-key': 'history-back' },
      dataset: { action: 'history-back' },
    }, icon('back', 13), h('span', { text: COPY.actions.back })),
    h('span', { class: 'detail-head-hint' }, keycap('Esc'), h('span', { text: COPY.history.backHint })))
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
  view.append(scroll)
  return view
}
