/**
 * ui/primitives.ts —— 视图层共用的小组件：按钮、徽章、事实、结果条、空态、逐行差异。
 *
 * 共同约定（和设计稿里的「一套动作语言」对应）：
 *   - 一个视图里最多一个主按钮（kind = 'primary'），其余都是 secondary / ghost；
 *   - 禁用必须带看得见的原因，原因同一个字符串同时写进 title 与 aria-describedby；
 *   - 忙碌必须同时改文案（拉取 → 拉取中…）与 aria-busy，不能只转圈；
 *   - 结果条用 role="status" 且带来源标记，说明它由哪一步产生。
 */
import type { PatchLine, PatchLineKind } from '../data/core'
import { icon, h, spinner } from './dom'
import type { BadgeTone } from '../domain/select'
import type { ResultMessage } from '../domain/session'

export interface ButtonOptions {
  label: string
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  disabled?: boolean
  busy?: boolean
  busyLabel?: string | null
  title?: string | null
  icon?: 'chevron' | 'refresh' | 'copy' | 'check' | 'alert' | 'back' | 'folder' | 'file' | 'commit'
  focusKey?: string
  action?: string
  dataset?: Record<string, string | number | undefined>
  describedBy?: string | null
}

export function button(options: ButtonOptions): HTMLButtonElement {
  const busy = options.busy === true
  const classes = ['btn', `btn-${options.kind ?? 'secondary'}`, `btn-${options.size ?? 'md'}`]
  if (options.disabled === true && !busy) classes.push('is-disabled')
  if (busy) classes.push('is-busy')
  const node = h('button', {
    class: classes.join(' '),
    attrs: {
      type: 'button',
      disabled: options.disabled === true || busy,
      'aria-busy': busy ? 'true' : null,
      'aria-describedby': options.describedBy ?? null,
      title: options.title ?? null,
      ...(options.focusKey === undefined ? {} : { 'data-focus-key': options.focusKey }),
    },
    dataset: {
      action: options.action,
      ...(options.dataset ?? {}),
    },
  })
  if (busy) node.append(spinner())
  if (options.icon !== undefined) node.append(icon(options.icon, 13))
  node.append(h('span', { class: 'btn-label', text: busy ? (options.busyLabel ?? options.label) : options.label }))
  return node
}

export function chip(text: string, tone: BadgeTone, options: { small?: boolean; title?: string; mono?: boolean } = {}): HTMLElement {
  const classes = ['chip', `chip-${tone}`]
  if (options.small === true) classes.push('chip-sm')
  if (options.mono === true) classes.push('mono')
  return h('span', { class: classes.join(' '), text, title: options.title })
}

/** 计数 + 单位分开画，单位字号更小：数字读得出，单位不抢数字。 */
export function countUnit(count: number, unit: string): HTMLElement {
  return h(
    'span',
    { class: 'count-unit' },
    h('span', { class: 'count', text: String(count) }),
    h('span', { class: 'unit', text: unit }),
  )
}

export function badgeLetter(letter: string, tone: BadgeTone, title: string): HTMLElement {
  return h('span', { class: `badge badge-${tone}`, text: letter, title })
}

/** 结果条：来源标记 + 主句 + 可选细节；关闭按钮是单独的 Tab 停靠点。 */
export function resultBanner(result: ResultMessage): HTMLElement {
  const sourceLabel: Record<ResultMessage['source'], string> = {
    sync: '同步动作',
    reload: '重新读取',
    commit: '提交',
    copy: '复制',
    ai: 'AI 交接',
    branch: '分支动作',
    worktree: '工作树动作',
    changes: '改动动作',
    history: '提交动作',
    stash: '贮藏动作',
  }
  return h(
    'div',
    {
      class: `result result-${result.tone}`,
      attrs: { role: 'status', 'aria-live': 'polite' },
    },
    h('span', { class: 'result-tag', text: sourceLabel[result.source] }),
    h('span', { class: 'result-text', text: result.text }),
    result.detail === null ? null : h('span', { class: 'result-detail', text: result.detail }),
    h(
      'button',
      {
        class: 'result-close',
        attrs: { type: 'button', 'aria-label': '关闭这条结果' },
        dataset: { action: 'result-dismiss' },
        on: {},
      },
      '×',
    ),
  )
}

export function emptyState(title: string, hint: string | null, extra?: HTMLElement): HTMLElement {
  return h(
    'div',
    { class: 'empty' },
    h('div', { class: 'empty-title', text: title }),
    hint === null ? null : h('div', { class: 'empty-hint', text: hint }),
    extra === undefined ? null : extra,
  )
}

const PATCH_CLASS: Record<PatchLineKind, string> = {
  add: 'diff-add',
  del: 'diff-del',
  context: 'diff-ctx',
  hunk: 'diff-hunk',
  filehead: 'diff-head',
  'no-newline': 'diff-note',
}

/** 逐行差异：行号由 CSS 生成（行号列固定宽度），横向滚动只发生在代码列内部。 */
export function patchBlock(lines: PatchLine[]): HTMLElement {
  const block = h('pre', { class: 'patch', attrs: { 'aria-label': '示例逐行差异' } })
  for (const line of lines) {
    block.append(h('code', { class: `diff-line ${PATCH_CLASS[line.kind]}`, text: line.text === '' ? ' ' : line.text }))
  }
  return block
}

/** 一行小字说明，常用在按钮下面解释禁用原因或边界条件。 */
export function note(text: string, tone: 'muted' | 'warn' | 'error' | 'ok' = 'muted'): HTMLElement {
  return h('span', { class: `note note-${tone}`, text })
}
