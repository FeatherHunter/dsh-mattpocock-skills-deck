/**
 * ui/views/handoff.ts —— 「把当前状态交给 AI」的浮层。
 *
 * 它不是另一种确认框：确认框问「要不要执行」，这里做的是「把已经发生的事整理成一封信」。
 * 所以它占满面板而不是贴在按钮边上，因为读者需要先读完这段说明，确认没有带上不想外发的路径，
 * 再决定复制。整段文字放在一个可滚动、可键盘滚动的区域里，不做截断缩略。
 *
 * 为什么入口文案不放进这里：入口出现在同步带、改动页、工作树页、分支页四处，
 * 各自要跟当前页的问题对上，所以文案由 domain/handoff.ts 的 HANDOFF_ENTRY 统一给出。
 */
import { COPY } from '../../data/copy'
import type { HandoffDraft } from '../../domain/handoff'
import { h, icon } from '../dom'
import { button } from '../primitives'

export interface HandoffSheetModel {
  draft: HandoffDraft
  /** 这次打开之后是否已经点过复制：复制后把小标题换成确认句，读者不用再猜有没有复制成功。 */
  copied: boolean
}

export function renderHandoffSheet(model: HandoffSheetModel): HTMLElement {
  const { draft, copied } = model
  const layer = h('div', { class: 'handoff-layer' })
  // 背板只负责接住点击，不压暗画面：面板本身很窄，再压暗就只剩一条亮缝，
  // 读者会以为整块界面被禁用了。这里用一层几乎透明的灰，只是告诉点击「这里可以关掉」。
  layer.append(h('div', {
    class: 'handoff-backdrop',
    attrs: { 'aria-hidden': 'true' },
    dataset: { action: 'handoff-close' },
  }))

  const sheet = h('section', {
    class: 'handoff-sheet',
    attrs: {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'handoff-title',
      'aria-describedby': 'handoff-lede',
    },
  })

  const head = h('header', { class: 'handoff-head' },
    h('p', { class: 'handoff-kicker mono', text: COPY.ai.kicker }),
    h('h2', { class: 'handoff-title', id: 'handoff-title', text: draft.title }),
    h('button', {
      class: 'icon-btn handoff-close',
      attrs: {
        type: 'button',
        title: COPY.ai.closeTitle,
        'aria-label': COPY.ai.closeTitle,
        'data-focus-key': 'handoff-close',
      },
      dataset: { action: 'handoff-close' },
    }, icon('close', 14)))

  const prompt = h('pre', {
    class: 'handoff-prompt',
    attrs: { tabindex: 0, 'aria-label': '交给 AI 的说明全文' },
  })
  prompt.textContent = draft.prompt

  const foot = h('footer', { class: 'handoff-foot' })
  if (copied) foot.append(h('p', { class: 'handoff-copied', attrs: { role: 'status' } }, icon('check', 13), h('span', { text: COPY.ai.copied(draft.charCount) })))
  else foot.append(h('p', { class: 'handoff-hint', text: COPY.ai.footNote }))
  foot.append(h('div', { class: 'handoff-actions' },
    button({ label: COPY.ai.closeLabel, kind: 'ghost', size: 'md', action: 'handoff-close', focusKey: 'handoff-close-2' }),
    button({
      label: COPY.ai.copyLabel,
      kind: 'primary',
      size: 'md',
      action: 'handoff-copy',
      focusKey: 'handoff-copy',
      title: COPY.ai.footNote,
    })))

  sheet.append(
    head,
    h('p', { class: 'handoff-lede', id: 'handoff-lede', text: draft.lede }),
    prompt,
    foot)
  layer.append(sheet)
  return layer
}

/** 入口按钮：同步带用整行长按钮，列表页脚用一行轻链接，复用同一套结构与文案。 */
export function handoffEntry(label: string, kind: string, variant: 'rail' | 'inline'): HTMLElement {
  const node = h('button', {
    class: `ai-entry ai-entry-${variant}`,
    attrs: {
      type: 'button',
      title: COPY.ai.entryAria(label),
      'aria-label': COPY.ai.entryAria(label),
      'data-focus-key': `handoff-${kind}`,
    },
    dataset: { action: 'handoff-open', kind },
  }, icon('spark', 14), h('span', { class: 'ai-entry-label', text: label }))
  if (variant === 'rail') node.append(h('span', { class: 'ai-entry-sub', text: COPY.ai.railSub }))
  return node
}
