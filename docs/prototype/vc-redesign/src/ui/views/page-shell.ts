/**
 * ui/views/page-shell.ts —— 二级页共用的外壳与「能力清单」组件。
 *
 * 二级页的骨架是固定的：返回按钮 + 标题 + 一句导语，下面是可独立滚动的内容区。
 * 每一页最后都附一段「本页负责的能力」：162 条能力不是散落在各页里的隐藏动作，
 * 而是一份能逐条数清的清单——评审拿着 #1588 的表格能对得上，命令面板也靠它定位。
 *
 * 能力行是三段式展示：入口在哪、打开什么、结果落在哪；可交互的能力给出「演示这条流程」，
 * 点开在行下面出现四段式确认卡（会动什么 / 不会动什么 / 可逆性与恢复路径 / 动词写后果），
 * 默认焦点在取消。整仓不可逆动作不直接执行，先跳到二级核对页。
 */
import { CAPABILITIES } from '../../data/capabilities.generated'
import type { Capability } from '../../data/capabilities.generated'
import { h, icon } from '../dom'
import { chip } from '../primitives'
import type { PageId, PageState } from '../../domain/pages'
import { capabilitiesOf, needsSecondConfirm } from '../../domain/pages'
import { CAP_SAFE_NOTE, LEVEL_LABEL, PLACEMENT_HINT, PLACEMENT_LABEL, levelTone } from '../../data/pages-copy'
import type { PrototypeData } from '../../data/screen'
import type { PanelModel } from '../../domain/select'

/**
 * 二级页外壳：返回、标题、数量与页头动作在同一行，导语在下一行。
 *
 * 页头必须尽量矮：页面是从身份行的齿轮点进来的，读者刚点完就应当在同一视野里看到页面标题，
 * 所以返回键不再单独占一行——它贴在标题左边，和浏览器里的返回箭头是同一个阅读顺序。
 */
export function pageShell(page: PageId, title: string, lede: string, count: string | null, body: HTMLElement, options: { actions?: HTMLElement[]; danger?: boolean; focusKey?: string } = {}): HTMLElement {
  const head = h('div', { class: 'page-head' })
  const titleRow = h('div', { class: 'page-title-row' })
  // 有些整页是从一条按钮点进来的（例如危险核对页）：焦点落在标题上，页面从顶部开始读，
  // Esc 也有接收者。标题只是程序化焦点落点，不做 Tab 停靠，所以 tabindex 固定写 -1。
  const titleNode = h('h2', { class: 'page-title', text: title })
  if (options.focusKey !== undefined) {
    titleNode.setAttribute('tabindex', '-1')
    titleNode.setAttribute('data-focus-key', options.focusKey)
  }
  titleRow.append(
    h('button', {
      class: 'page-back',
      attrs: { type: 'button', 'data-focus-key': 'page-back', title: '返回上一页（Esc 也可以）', 'aria-label': '返回上一页' },
      dataset: { action: 'page-back' },
    }, icon('back', 14), h('span', { class: 'page-back-label', text: '返回' })),
    titleNode,
  )
  if (count !== null) titleRow.append(chip(count, 'muted', { small: true }))
  if (options.danger === true) titleRow.append(chip('含不可逆动作', 'error', { small: true }))
  if (options.actions !== undefined && options.actions.length > 0) {
    const actions = h('div', { class: 'page-actions' })
    for (const action of options.actions) actions.append(action)
    titleRow.append(actions)
  }
  head.append(titleRow, h('p', { class: 'page-lede', text: lede }))

  const scroll = h('div', { class: 'page-scroll', attrs: { role: 'region', 'aria-label': title + '页面内容' } })
  scroll.append(body)

  return h('div', { class: 'page page-' + page, attrs: { 'data-page': page } }, head, scroll)
}

/** 一个内容分区：标题、数量、一句边界说明，然后是从句。 */
export function section(title: string, count: string | null, note: string | null, children: HTMLElement[], options: { danger?: boolean; id?: string } = {}): HTMLElement {
  const node = h('section', { class: 'page-section' + (options.danger === true ? ' is-danger' : '') })
  if (options.id !== undefined) node.id = options.id
  const head = h('div', { class: 'section-head' })
  head.append(h('h3', { class: 'section-title', text: title }))
  if (count !== null) head.append(h('span', { class: 'section-count', text: count }))
  if (options.danger === true) head.append(chip('危险区', 'error', { small: true }))
  node.append(head)
  if (note !== null) node.append(h('p', { class: 'section-note', text: note }))
  for (const child of children) node.append(child)
  return node
}

/** 折叠区：标题带数量与状态，展开状态记在页面状态里，切页签回来还在。 */
export function fold(key: string, title: string, count: string | null, open: boolean, children: HTMLElement[], note: string | null = null): HTMLElement {
  const node = h('div', { class: 'fold' + (open ? ' is-open' : '') })
  const head = h('button', {
    class: 'fold-head',
    attrs: { type: 'button', 'aria-expanded': open ? 'true' : 'false', 'data-focus-key': 'fold-' + key },
    dataset: { action: 'page-fold', key },
  })
  head.append(icon('chevron', 12), h('span', { class: 'fold-title', text: title }))
  if (count !== null) head.append(h('span', { class: 'fold-count', text: count }))
  node.append(head)
  if (note !== null) node.append(h('p', { class: 'fold-note', text: note }))
  if (open) {
    const body = h('div', { class: 'fold-body' })
    for (const child of children) body.append(child)
    node.append(body)
  }
  return node
}

/** 一排键值事实：配置、诊断、远端页共用；窄宽下自动竖排。 */
export function factGrid(facts: Array<{ key: string; value: string; mono?: boolean; tone?: 'muted' | 'warn' | 'error' }>): HTMLElement {
  const grid = h('dl', { class: 'fact-grid' })
  for (const fact of facts) {
    const valueClass = 'fact-value' + (fact.mono === true ? ' mono' : '') + (fact.tone === undefined || fact.tone === 'muted' ? '' : ' is-' + fact.tone)
    grid.append(
      h('div', { class: 'fact-cell' },
        h('dt', { class: 'fact-key', text: fact.key }),
        h('dd', { class: valueClass, text: fact.value })),
    )
  }
  return grid
}

/** 一条普通的对象行：左侧主文案与说明，右侧动作或状态。 */
export function objectRow(main: HTMLElement[], side: HTMLElement[] | null, options: { danger?: boolean } = {}): HTMLElement {
  const row = h('div', { class: 'obj-row' + (options.danger === true ? ' is-danger' : '') })
  const body = h('div', { class: 'obj-main' })
  for (const node of main) body.append(node)
  row.append(body)
  if (side !== null && side.length > 0) {
    const actions = h('div', { class: 'obj-side' })
    for (const node of side) actions.append(node)
    row.append(actions)
  }
  return row
}

/** 所有可聚焦按钮统一带 data-focus-key：整页重画后焦点回到触发控件上。 */
export function actionButton(label: string, action: string, options: { focusKey?: string; kind?: 'primary' | 'secondary' | 'ghost' | 'danger'; dataset?: Record<string, string>; title?: string; disabled?: boolean } = {}): HTMLButtonElement {
  const classes = ['btn', 'btn-' + (options.kind ?? 'secondary'), 'btn-sm']
  if (options.disabled === true) classes.push('is-disabled')
  return h('button', {
    class: classes.join(' '),
    attrs: {
      type: 'button',
      title: options.title ?? null,
      disabled: options.disabled === true,
      ...(options.focusKey === undefined ? {} : { 'data-focus-key': options.focusKey }),
    },
    dataset: { action, ...(options.dataset ?? {}) },
  }, label)
}

/**
 * 「本页负责的能力」整段：页面底部统一出口，保证 162 条能一条条数出来。
 *
 * 页面上方已经按真实数据或流程列成动作行的能力，要传进 skips：同一条能力只留一个主入口，
 * 否则顶部点「演示」却要把读者送到页面底部的重复行，视线和滚动位置都会被打断。
 */
export function capabilitiesSection(page: PageId, state: PageState, skips: string[] = []): HTMLElement {
  const caps = capabilitiesOf(page)
  const skipped = caps.filter((cap) => skips.includes(cap.id))
  const rows = caps.filter((cap) => skips.includes(cap.id) === false).map((cap) => capabilityRow(cap, state))
  const note = skipped.length === 0
    ? '这条页面上每一件能做的事都在这份清单里。带「演示」的会走一遍确认流程，只改界面状态，不碰仓库。'
    : '这条页面上每一件能做的事都在这份清单里。带「演示」的会走一遍确认流程，只改界面状态，不碰仓库。上方已按动作列出的 ' + skipped.length + ' 条（' + skipped.map((cap) => cap.id).join('、') + '）不在这里重复。'
  return section('本页负责的能力', caps.length + ' 条', note, rows, { id: 'cap-list' })
}

/** 单条能力行；展开时在它下面贴确认卡，结果也贴在这行下面。 */
export function capabilityRow(cap: Capability, state: PageState): HTMLElement {
  const open = state.capOpen === cap.id
  const openDanger = state.dangerId === cap.id
  const result = state.capResult !== null && state.capResult.id === cap.id ? state.capResult : null
  const highlighted = state.highlight === cap.id
  const article = h('article', {
    class: 'cap-row' + (open || openDanger ? ' is-open' : '') + (highlighted ? ' is-flash' : ''),
    attrs: { 'data-cap-id': cap.id },
  })
  const head = h('div', { class: 'cap-head' })
  head.append(
    h('span', { class: 'cap-id mono', text: cap.id }),
    h('span', { class: 'cap-name', text: cap.name }),
    chip(LEVEL_LABEL[cap.level] ?? cap.level, levelTone(cap.level) as 'muted' | 'info' | 'warn' | 'error', { small: true }),
    chip(PLACEMENT_LABEL[cap.placement] ?? cap.placement, 'muted', { small: true, title: PLACEMENT_HINT[cap.placement] }),
  )
  article.append(head)
  article.append(h('p', { class: 'cap-command mono', text: cap.command }))
  const facts = h('dl', { class: 'cap-facts' })
  const pairs: Array<[string, string]> = [['入口', cap.entry], ['打开什么', cap.opens], ['结果落在哪', cap.result]]
  for (const pair of pairs) facts.append(h('div', { class: 'cap-fact' }, h('dt', { text: pair[0] }), h('dd', { text: pair[1] })))
  article.append(facts)
  const foot = h('div', { class: 'cap-foot' })
  if (cap.readOnly) {
    foot.append(chip('只读', 'muted', { small: true }), h('span', { class: 'cap-readonly-note', text: '原型只展示这条能力读到的形状，不提供执行按钮，也不假装能写。' }))
  } else {
    foot.append(
      h('button', {
        class: 'cap-demo-btn' + (cap.level === '毁' ? ' is-danger' : ''),
        attrs: { type: 'button', 'data-focus-key': 'cap-' + cap.id, title: '在原型里走一遍这条流程，只改界面状态' },
        dataset: { action: open ? 'cap-close' : 'cap-open', id: cap.id },
      }, open ? '收起演示' : '演示这条流程'),
    )
  }
  article.append(foot)

  if (open && !cap.readOnly) article.append(capConfirmCard(cap))
  if (openDanger && needsSecondConfirm(cap)) article.append(capConfirmCard(cap, true))
  if (result !== null) article.append(capabilityResult(cap.id, result.text))
  return article
}

/** 行内确认卡：页面顶部的动作行展开时直接贴在触发按钮所在的那一行下面，不再把人送到页面底部。 */
export function inlineConfirmCard(cap: Capability, state: PageState): HTMLElement | null {
  if (cap.readOnly || state.capOpen !== cap.id) return null
  return capConfirmCard(cap)
}

/** 行内结果：动作执行完贴回触发点，读者不用回到底部清单里找它落到哪。 */
export function inlineCapabilityResult(cap: Capability, state: PageState): HTMLElement | null {
  if (state.capResult === null || state.capResult.id !== cap.id) return null
  return capabilityResult(cap.id, state.capResult.text)
}

/** 结果条本体：能力行与顶部动作行共用同一段结构，样式不会两处走样。 */
function capabilityResult(_id: string, text: string): HTMLElement {
  return h('div', { class: 'cap-result', attrs: { role: 'status' } },
    h('span', { class: 'cap-result-tag', text: '结果' }),
    h('span', { class: 'cap-result-text', text }))
}

/** 四段式确认卡：会动什么 / 不会动什么 / 可逆性与恢复路径 / 动词写后果。 */
function capConfirmCard(cap: Capability, secondStage = false): HTMLElement {
  const dangerous = cap.level === '毁'
  const reversibility = dangerous
    ? '这次会重写已有提交与引用，写出来的新历史不能撤回。'
    : cap.level === '改写'
      ? '会改写历史。面板里保留旧提交的引用日志，误操作还能照 reflog 找回来。'
      : '会先写工作区或「已暂存」的清单。结果可以再撤销。'
  const card = h('div', { class: 'cap-confirm' + (dangerous ? ' is-danger' : '') + (secondStage ? ' is-stage2' : ''), attrs: { role: 'group', 'aria-label': '确认这条能力会动什么' } })
  const rows: Array<[string, string]> = [
    ['会动什么', cap.opens + '。完成后' + cap.result],
    ['不会动什么', dangerous ? '不会替你向远端推送，也不会删除本机之外的仓库。但这些都不改变「本地历史已被改写」这件事。' : CAP_SAFE_NOTE],
    ['可逆性与恢复路径', reversibility],
  ]
  for (const pair of rows) {
    card.append(h('div', { class: 'confirm-row' + (pair[0] === '可逆性与恢复路径' ? ' is-emphasis' : '') },
      h('span', { class: 'confirm-key', text: pair[0] }),
      h('span', { class: 'confirm-value', text: pair[1] })))
  }
  if (secondStage) {
    card.append(h('div', { class: 'confirm-row' },
      h('span', { class: 'confirm-key', text: '逐条核对' }),
      h('span', { class: 'confirm-value', text: '这条动作会重写全库。请先回维护页核对对象数量与备份位置，再在危险区的二级确认页里完成。' })))
  }
  const actions = h('div', { class: 'confirm-actions' })
  actions.append(
    h('button', {
      class: 'btn btn-secondary btn-sm',
      attrs: { type: 'button', 'data-focus-key': 'cap-cancel-' + cap.id },
      dataset: { action: dangerous ? 'danger-close' : 'cap-close' },
    }, '取消'),
  )
  if (dangerous) {
    actions.append(h('button', {
      class: 'btn btn-danger btn-sm',
      attrs: { type: 'button', 'data-focus-key': 'cap-danger-' + cap.id },
      dataset: { action: 'danger-open', id: cap.id },
    }, '先核对后果…'))
  } else {
    actions.append(h('button', {
      class: 'btn btn-primary btn-sm',
      attrs: { type: 'button', 'data-focus-key': 'cap-run-' + cap.id },
      dataset: { action: 'cap-run', id: cap.id },
    }, cap.level === '改写' ? '改写历史（原型模拟）' : '执行（原型模拟）'))
  }
  card.append(actions)
  return card
}

/** 覆盖验收用的一句话：命令面板能搜到全部能力，页面清单能数清全部能力。 */
export function coverageNote(): HTMLElement {
  const count = (placement: string): number => CAPABILITIES.filter((cap) => cap.placement === placement).length
  return h('p', { class: 'coverage-note' },
    chip('覆盖口径', 'info', { small: true }),
    h('span', { text: '162 条能力全部有落点：命令面板可按名称与位置搜索，每个页面底部按 #1588 的编号逐条列出。六条没有面板入口的（发补丁邮件与平台五条）在「平台与边界」里逐条只读说明。' }),
    h('span', { class: 'coverage-count mono', text: '直 ' + count('直') + ' · 折 ' + count('折') + ' · 诊 ' + count('诊') + ' · 外 ' + count('外') }))
}
/**
 * 二级页渲染时随手可用的上下文：真实采集的仓库数据、底层面板模型、页面状态与「此刻」。
 * 页面只读这些值，动作一律走 data-action 交给 app.ts 的状态机，视图里不直接改状态。
 */
export interface PageContext {
  data: PrototypeData
  model: PanelModel
  state: PageState
  nowMs: number
}
