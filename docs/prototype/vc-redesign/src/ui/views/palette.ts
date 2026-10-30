/**
 * ui/views/palette.ts —— 命令面板：一个输入框搜出 162 条能力里的任何一条。
 *
 * 为什么需要它：能力变多以后，靠记「它在哪个页签的哪个菜单」已经不现实。
 * 命令面板给的是同一条清单的第二个入口——搜索名称、编号、命令或位置，
 * 选中后跳到负责这一条的页面，并把那一行高亮出来。它不执行任何写操作，
 * 也不替代各页面的入口；只是让「我知道有这条能力，但找不到它在哪」不再发生。
 */
import { CAPABILITIES } from '../../data/capabilities.generated'
import type { Capability } from '../../data/capabilities.generated'
import { PAGE_META, PLACEMENT_LABEL, VIEW_LABEL, levelTone } from '../../data/pages-copy'
import type { PageState } from '../../domain/pages'
import { h, icon } from '../dom'
import { chip } from '../primitives'

function locationOf(cap: Capability): string {
  const view = VIEW_LABEL[cap.target]
  if (view !== undefined) return view + ' › ' + cap.entry
  const meta = PAGE_META[cap.target as keyof typeof PAGE_META]
  return (meta === undefined ? cap.target : meta.title) + ' › ' + cap.entry
}

function matches(cap: Capability, query: string): boolean {
  if (query === '') return true
  const hay = (cap.id + ' ' + cap.name + ' ' + cap.command + ' ' + cap.entry + ' ' + cap.domain + ' ' + locationOf(cap)).toLocaleLowerCase()
  return hay.includes(query)
}

const MAX_ROWS = 80

export function renderPalette(state: PageState): HTMLElement {
  const query = state.paletteQuery.trim().toLocaleLowerCase()
  const hits = CAPABILITIES.filter((cap) => matches(cap, query))
  const visible = hits.slice(0, MAX_ROWS)
  const rows = visible.map((cap, index) => h('button', {
    class: 'palette-row' + (state.highlight === cap.id ? ' is-highlight' : '') + (index === 0 ? ' is-first' : ''),
    attrs: { type: 'button', 'data-action': 'palette-select', 'data-id': cap.id, 'data-focus-key': 'palette:' + cap.id },
  },
  h('span', { class: 'palette-row-main' },
    h('span', { class: 'palette-id mono', text: cap.id }),
    h('span', { class: 'palette-name', text: cap.name }),
    chip(cap.level, levelTone(cap.level) as 'muted' | 'info' | 'warn' | 'error', { small: true }),
    chip(PLACEMENT_LABEL[cap.placement] ?? cap.placement, 'muted', { small: true })),
  h('span', { class: 'palette-row-sub', text: locationOf(cap) + ' · ' + cap.command })))

  const empty = hits.length === 0
    ? h('p', { class: 'palette-empty', text: '没有匹配的能力：换一个更短的关键字，或直接输入能力编号（例如 11.6）。' })
    : null
  const more = hits.length > MAX_ROWS
    ? h('p', { class: 'palette-more', text: '还有 ' + (hits.length - MAX_ROWS) + ' 条没显示，再输入几个字缩小范围。' })
    : null

  return h('div', { class: 'palette-backdrop', attrs: { 'data-action': 'palette-close' } },
    h('div', { class: 'palette', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': '命令面板' } },
      h('div', { class: 'palette-search' }, icon('search', 16),
        h('input', {
          class: 'palette-input',
          attrs: { type: 'text', value: state.paletteQuery, placeholder: '搜能力：名称、编号、命令或位置', 'data-field': 'palette-query', 'data-focus-key': 'palette-input', autocomplete: 'off', spellcheck: 'false' },
        })),
      h('div', { class: 'palette-list' }, ...(rows.length === 0 ? [empty ?? h('span', {})] : rows)),
      empty !== null && rows.length > 0 ? empty : null,
      more,
      h('div', { class: 'palette-foot' },
        h('span', { class: 'mono', text: '共 ' + CAPABILITIES.length + ' 条能力' }),
        h('span', { text: '匹配 ' + hits.length + ' 条' }),
        h('span', { class: 'palette-hint', text: 'Enter 打开第一条 · Esc 关闭 · 选中后跳到对应页面并高亮' }))))
}
