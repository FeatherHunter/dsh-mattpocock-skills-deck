/**
 * ui/app.ts —— 原型的装配、事件与重画。
 *
 * 交互模型：一次事件 → 一个动作 → 纯函数 reduce → 整块重画。
 * 整块重画是刻意的：原型要评审的是「状态变了界面一定跟着变」，
 * 不是手写 DOM 更新的技巧；代价（焦点、光标、滚动位置）在这里一次性补齐：
 *   - 焦点：任何可聚焦元素带 data-focus-key，重画前拍下键与光标位置，重画后放回去；
 *   - 滚动：记住各滚动容器的位置，切页签归零，列表↔详情切换时分别恢复；
 *   - 结果：由动作来源决定出现在哪个动作旁边（同步动作进顶部带，提交进提交区）；
 *   - 忙碌：每个写操作有固定时长的模拟往返，按钮同时改文案、转圈、aria-busy。
 *
 * 所有会「看起来像真的写了仓库」的动作都在这里标了原型模拟：只改界面状态，不碰 git。
 */
import { COPY } from '../data/copy'
import { whenText } from '../data/format'
import { buildPrototypeData } from '../data/screen'
import type { PrototypeData } from '../data/screen'
import { createSessionState, reduce } from '../domain/session'
import type { Action, BranchSub, ChangesPendingKind, OpName, SessionBase, SessionState, StashPending, WorktreePending } from '../domain/session'
import { buildHandoff } from '../domain/handoff'
import type { HandoffKind } from '../domain/handoff'
import { panelModelOf } from '../domain/select'
import type { PanelModel } from '../domain/select'
import { createPageState, reducePage, targetOfCapability } from '../domain/pages'
import type { PageAction, PageId } from '../domain/pages'
import { CAPABILITIES } from '../data/capabilities.generated'
import { PAGE_META } from '../data/pages-copy'
import { clear, h, icon } from './dom'
import { renderRail } from './rail'
import { renderChanges } from './views/changes'
import { renderBranches } from './views/branches'
import { renderHandoffSheet } from './views/handoff'
import { renderHistory } from './views/history'
import { renderStash } from './views/stash'
import { renderWorktrees } from './views/worktrees'
import type { WorktreeFilter, WorktreesViewOptions } from './views/worktrees'
import { renderPageHost } from './views/page-host'
import { renderPalette } from './views/palette'

/** 面板可拖宽度的四个演示档位；真实实现的区间是 300 到 520。 */
const PANEL_WIDTHS = [300, 380, 460, 520] as const
const DEFAULT_WIDTH = 460

/**
 * 两套皮肤：深色对齐产品现在的深色皮肤，浅色对齐产品之前的纸质皮肤。
 * 令牌在 styles/app.css 顶部，值抄自真实页面 vcStyles.ts，避免原型与线上各调一版。
 */
type Theme = 'dark' | 'light'
const DEFAULT_THEME: Theme = 'dark'

/** 演示栏的分段开关：宽度与皮肤共用同一种写法，只有取值不同。 */
interface SegItem {
  key: string
  label: string
  on: boolean
  action: string
  dataset: Record<string, string>
}

interface FocusSnapshot {
  key: string
  start: number | null
  end: number | null
}

interface ScrollSnapshot {
  selector: string
  top: number
}

interface RenderOptions {
  focusKey?: string | null
  focusCaret?: FocusSnapshot | null
  scroll?: ScrollSnapshot | null
  post?: () => void
}

export function mount(root: HTMLElement): void {
  const data: PrototypeData = buildPrototypeData()
  const base: SessionBase = {
    screen: data.screen,
    commitFiles: data.commitFiles,
    totalCommits: data.commits.length,
    branch: data.branch,
    branches: data.branches.map((row) => ({ ...row, current: row.name === data.branch })),
  }
  let state: SessionState = createSessionState(base, Date.now())
  let panelWidth: number = DEFAULT_WIDTH
  let theme: Theme = DEFAULT_THEME
  /** 嵌入模式只留面板本体，用于截图与嵌进文档；顶部栏与页脚仍然存在，只是隐藏。 */
  let embed = false
  let lastFocusKey: string | null = null
  let historyListScroll = 0
  let resultTimer: number | null = null
  let resultRef: SessionState['result'] = null
  let opTimer: number | null = null
  let pendingOp: OpName | null = null
  // 工作树视图的三个局部界面状态：筛选、说明条是否展开、展开的是哪一棵。
  // 它们不进入状态机：真实页面里这类状态也只属于这一次浏览，不参与任何判定。
  let wtFilter: WorktreeFilter = 'all'
  let wtNoteOpen = true
  let expandedWorktree: string | null = null
  // AI 交接浮层：打开的是哪种意图、打开时停在哪儿、这一次是否已经复制。
  // 三者都只属于本次浏览，不参与任何 git 判定，所以不进状态机。
  let handoffKind: HandoffKind | null = null
  let handoffFocus = ''
  let handoffCopied = false
  // 提交行菜单与「撤销这次提交」的确认各记一个 oid：菜单开着、确认卡也开着时，
  // 两者都只贴着那一行；切换视图或点别处就应该收起来。
  let commitMenuOid: string | null = null
  let commitConfirmOid: string | null = null
  // 「管理」二级页与命令面板的状态：与四个页签的会话状态是两条独立的状态机，
  // 切页签要收起页面，但从页面返回不会动任何请求状态。
  let pages = createPageState()
  // 每个二级页上次滚到哪：切走再回来时回到原处，读者不用重新找位置。
  const pageScrolls = new Map<PageId, number>()

  const liveRegion = h('div', { class: 'sr-only', attrs: { 'aria-live': 'polite', role: 'status' } })
  root.append(liveRegion)

  // ---------- 焦点与滚动 ----------

  function snapshotFocus(): FocusSnapshot | null {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return null
    const key = active.dataset.focusKey
    if (key === undefined) return null
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      return { key, start: active.selectionStart, end: active.selectionEnd }
    }
    return { key, start: null, end: null }
  }

  function restoreFocus(key: string | null, caret: FocusSnapshot | null): void {
    const targetKey = key ?? lastFocusKey
    if (targetKey === null) return
    const el = root.querySelector<HTMLElement>(`[data-focus-key="${cssEscape(targetKey)}"]`)
    if (el === null) return
    el.focus()
    if (caret !== null && caret.key === targetKey && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      const start = caret.start ?? el.value.length
      const end = caret.end ?? start
      el.setSelectionRange(start, end)
    }
  }

  function captureScroll(): ScrollSnapshot | null {
    const selector = '.changes-scroll, .history-scroll, .detail-scroll, .branch-scroll, .page-scroll'
    const el = root.querySelector<HTMLElement>(selector)
    if (el === null) return null
    const scrollSelector = el.classList.contains('changes-scroll')
      ? '.changes-scroll'
      : el.classList.contains('history-scroll') ? '.history-scroll'
        : el.classList.contains('branch-scroll') ? '.branch-scroll'
          : el.classList.contains('page-scroll') ? '.page-scroll' : '.detail-scroll'
    return { selector: scrollSelector, top: el.scrollTop }
  }

  function restoreScroll(snapshot: ScrollSnapshot | null): void {
    if (snapshot === null) return
    const el = root.querySelector<HTMLElement>(snapshot.selector)
    if (el !== null) el.scrollTop = snapshot.top
  }

  // ---------- 状态推进与重画 ----------

  function dispatch(action: Action, options: RenderOptions = {}): void {
    const focus = snapshotFocus()
    const scroll = captureScroll()
    const next = reduce(state, action, base)
    if (next === state) return
    state = next
    render({
      focusKey: options.focusKey ?? focus?.key ?? null,
      focusCaret: focus,
      scroll: options.scroll === undefined ? scroll : options.scroll,
      post: options.post,
    })
  }

  /**
   * 二级页的动作走这一条：先记下当前页滚到哪，换页时按目标页上次的位置恢复。
   * 与 dispatch() 分开是因为两条状态机各自 reduce，谁也不该顺手改对方。
   */
  function dispatchPage(action: PageAction, options: RenderOptions = {}): void {
    const focus = snapshotFocus()
    const before = activePageOf()
    const scrollEl = root.querySelector<HTMLElement>('.page-scroll')
    if (before !== null && scrollEl !== null) pageScrolls.set(before, scrollEl.scrollTop)
    const next = reducePage(pages, action)
    if (next === pages) return
    pages = next
    const after = activePageOf()
    const moved = before !== after
    render({
      focusKey: options.focusKey ?? focus?.key ?? null,
      focusCaret: focus,
      scroll: options.scroll !== undefined ? options.scroll : moved ? { selector: '.page-scroll', top: after === null ? 0 : (pageScrolls.get(after) ?? 0) } : captureScroll(),
      post: options.post,
    })
  }

  /** 当前二级页：没有打开页面时是 null，界面照旧画四个页签。 */
  function activePageOf(): PageId | null {
    return pages.stack.length === 0 ? null : pages.stack[pages.stack.length - 1]
  }

  /** 页面编号的合法值：统一从 PAGE_META 的键来，新增页面只改一处。 */
  function asPageId(value: string | undefined): PageId | null {
    if (value === undefined || value === '') return null
    return value in PAGE_META ? (value as PageId) : null
  }

  /**
   * 命令面板选中一条能力：跳到负责它的页面并高亮那一行。
   * 四页签的能力回到底层视图；页面能力打开二级页；没有面板落点的也回到页面栈外，避免留在空页上。
   */
  function jumpToCapability(id: string): void {
    const cap = CAPABILITIES.find((item) => item.id === id)
    if (cap === undefined) return
    const target = targetOfCapability(cap)
    let nextPages = reducePage(pages, { type: 'palette-close' })
    if (target === 'view') {
      nextPages = reducePage(nextPages, { type: 'page-close-all' })
      state = reduce(state, { type: 'view', view: cap.target as 'changes' | 'commits' | 'worktrees' | 'stash' }, base)
      nextPages = reducePage(nextPages, { type: 'palette-highlight', id: cap.id })
      pages = nextPages
      render({ focusKey: 'tab-' + cap.target, scroll: null })
      return
    }
    nextPages = reducePage(nextPages, { type: 'page-open', page: target })
    nextPages = reducePage(nextPages, { type: 'palette-highlight', id: cap.id })
    pages = nextPages
    render({ focusKey: 'page-back', scroll: null })
  }

  /**
   * 全库搜索的一条结果：提交回历史详情、分支开分支浮层、标签开分支与标签页并按标签名过滤、
   * 能力交给命令面板同一套跳转。所有跳转都先把页面栈收干净，避免「搜索 › 分支 › ...」叠出长栈。
   */
  function jumpFromSearch(kind: string, key: string): void {
    if (kind === 'cap') {
      jumpToCapability(key)
      return
    }
    let nextPages = reducePage(pages, { type: 'page-close-all' })
    if (kind === 'commit') {
      state = reduce(state, { type: 'view', view: 'commits' }, base)
      state = reduce(state, { type: 'history-open', oid: key }, base)
      pages = nextPages
      render({ focusKey: 'history-back', scroll: null })
      return
    }
    if (kind === 'branch') {
      state = reduce(state, { type: 'branch-open' }, base)
      state = reduce(state, { type: 'branch-select', name: key }, base)
      pages = nextPages
      render({ focusKey: 'branch-back', scroll: null })
      return
    }
    if (kind === 'tag') {
      nextPages = reducePage(nextPages, { type: 'page-open', page: 'branch-tags' })
      nextPages = reducePage(nextPages, { type: 'page-query', value: key })
      pages = nextPages
      render({ focusKey: 'page-query', scroll: null })
    }
  }

  function repaint(options: RenderOptions = {}): void {
    render(options)
  }

  function render(options: RenderOptions = {}): void {
    const model = panelModelOf(base, state, Date.now())
    const frame = buildFrame(model)
    clear(root)
    root.append(liveRegion, frame)
    // 同步恢复滚动与焦点：整块重画后先让布局落定再赋值，不会出现「先被夹到 0、下一帧再跳回」的抖动。
    restoreScroll(options.scroll ?? null)
    restoreFocus(options.focusKey ?? null, options.focusCaret ?? null)
    // 确认卡可能落在滚动区底部之外：先把它滚进可视区，读者才看得到「确认 / 取消」。
    // 用 block:'nearest' 只做最小滚动；卡片上方那一行通常已经露着一半，不必把整行顶到最上面。
    const pendingCard = root.querySelector<HTMLElement>('.wt-confirm, .branch-confirm, .changes-confirm, .commit-confirm, .stash-confirm')
    if (pendingCard !== null) pendingCard.scrollIntoView({ block: 'nearest' })
    // 从命令面板或搜索跳过来的那一条能力：先滚进可视区，再把这个「一次性高亮」清掉，
    // 免得下一次重画还亮着——高亮只用来指路，不是选中态。
    const highlighted = root.querySelector<HTMLElement>('.cap-row.is-flash, .palette-row.is-highlight')
    if (highlighted !== null) highlighted.scrollIntoView({ block: 'nearest' })
    if (pages.highlight !== null) pages = reducePage(pages, { type: 'highlight-clear' })
    positionPopconfirm()
    positionBranchPop()
    positionHandoff()
    scheduleResultDismiss()
    liveRegion.textContent = state.result === null ? '' : state.result.text
    options.post?.()
  }

  function scheduleResultDismiss(): void {
    if (state.result === null) {
      resultRef = null
      if (resultTimer !== null) { window.clearTimeout(resultTimer); resultTimer = null }
      return
    }
    if (state.result === resultRef) return
    resultRef = state.result
    if (resultTimer !== null) window.clearTimeout(resultTimer)
    resultTimer = window.setTimeout(() => {
      resultTimer = null
      if (state.result === resultRef) dispatch({ type: 'result-clear' }, { focusKey: lastFocusKey })
    }, 9000)
  }

  // ---------- 框架 ----------

  /** 演示栏的分段开关：宽度与皮肤共用同一种结构，只有取值不同。 */
  function segmented(labelText: string, items: SegItem[]): HTMLElement {
    const group = h('div', { class: 'seg', attrs: { role: 'group', 'aria-label': labelText } })
    for (const item of items) {
      group.append(h('button', {
        class: `seg-btn${item.on ? ' is-on' : ''}`,
        attrs: {
          type: 'button',
          'aria-pressed': item.on ? 'true' : 'false',
          'data-focus-key': item.key,
        },
        dataset: { action: item.action, ...item.dataset },
      }, item.label))
    }
    return h('div', { class: 'ctl' }, h('span', { class: 'ctl-label', text: labelText }), group)
  }

  function buildFrame(model: PanelModel): HTMLElement {
    const head = h('header', { class: 'proto-head' },
      h('p', { class: 'proto-kicker', text: COPY.frame.kicker }),
      h('h1', { class: 'proto-title', text: COPY.frame.title }),
      h('p', { class: 'proto-lede', text: COPY.frame.lede }),
      h('div', { class: 'proto-meta' },
        h('span', { class: 'proto-chip', text: COPY.frame.metaData }),
        h('span', { class: 'proto-chip', text: COPY.frame.metaWidth }),
        h('span', { class: 'proto-chip', text: COPY.frame.metaSkin })))

    const tools = h('div', { class: 'proto-tools' },
      h('div', { class: 'proto-controls' },
        segmented(COPY.frame.width, PANEL_WIDTHS.map((width) => ({
          key: `width-${width}`,
          label: String(width),
          on: panelWidth === width,
          action: 'width',
          dataset: { width: String(width) },
        }))),
        segmented(COPY.frame.theme, [
          { key: 'theme-dark', label: COPY.frame.themeDark, on: theme === 'dark', action: 'theme', dataset: { theme: 'dark' } },
          { key: 'theme-light', label: COPY.frame.themeLight, on: theme === 'light', action: 'theme', dataset: { theme: 'light' } },
        ])),
      h('span', { class: 'proto-tools-note', text: COPY.frame.toolsNote }))

    const stage = h('div', { class: 'stage' })
    const panel = h('div', {
      class: 'panel',
      attrs: { 'data-view': state.view },
    })
    // 机框宽度 = 面板宽度 + 两侧各 10 像素内边距 + 两条边框，这样面板本体仍是切换时写的那个值。
    const frame = h('div', { class: 'frame', attrs: { style: `width: ${panelWidth + 22}px` } })

    const railResult = model.result !== null && (model.result.source === 'sync' || model.result.source === 'reload' || model.result.source === 'copy')
      ? model.result : null
    panel.append(renderRail(model.rail, railResult))
    panel.append(renderTabs(model))
    // 页面宿主接管内容区：没有打开二级页时返回 null，这里照旧画四个页签的内容。
    const pageView = renderPageHost({ data, model, state: pages, nowMs: Date.now() })
    const main = h('main', { class: 'panel-body', attrs: { id: 'view-panel', role: 'tabpanel', 'aria-labelledby': `tab-${state.view}` } })
    if (pages.result !== null) {
      main.append(h('div', { class: 'page-result', attrs: { role: 'status' } },
        h('span', { class: 'page-result-text', text: pages.result }),
        h('button', { class: 'page-result-close', attrs: { type: 'button', 'aria-label': '关掉这条结果', 'data-focus-key': 'page-result-close' }, dataset: { action: 'page-result-clear' } }, '×')))
    }
    main.append(pageView === null ? renderActiveView(model) : pageView)
    panel.append(main)
    // 分支浮层贴着顶部身份行的分支名展开，不再替换整页内容：
    // 关掉之后原来那一页还在原位，读者不会丢失刚才在看的东西。
    if (state.branchOpen) panel.append(renderBranchPopover(model))
    if (model.confirm !== null) panel.append(renderPopconfirm(model.confirm))
    // 交接说明也改成浮层：贴在点开的入口旁边，高度由 positionHandoff() 按可用空间算。
    if (handoffKind !== null) {
      panel.append(renderHandoffSheet({
        draft: buildHandoff(data, handoffKind, Date.now(), handoffFocus),
        copied: handoffCopied,
      }))
    }
    // 命令面板盖在所有浮层之上：它只是一个入口，不该被下面的页面内容挡住。
    if (pages.paletteOpen) panel.append(renderPalette(pages))
    frame.append(panel)
    stage.append(frame)

    const foot = h('footer', { class: 'proto-foot' },
      h('span', { class: 'foot-hint', text: COPY.frame.hint }),
      h('span', { class: 'foot-captured', text: COPY.frame.capturedAt(whenText(Date.now(), data.nowMs)) }))

    const wrap = h('div', { class: `proto${embed ? ' is-embed' : ''}` }, head, tools, stage, foot)
    exitBusyLabel(wrap, model)
    return wrap
  }

  function renderTabs(model: PanelModel): HTMLElement {
    const nav = h('nav', { class: 'views', attrs: { role: 'tablist', 'aria-label': '版本管理视图' } })
    model.tabs.forEach((tab, index) => {
      const active = state.view === tab.id
      const node = h('button', {
        class: `tab${active ? ' is-on' : ''}`,
        attrs: {
          type: 'button',
          role: 'tab',
          id: `tab-${tab.id}`,
          'aria-selected': active ? 'true' : 'false',
          'aria-controls': 'view-panel',
          tabindex: active ? 0 : -1,
          'data-focus-key': `tab-${tab.id}`,
          title: `${tab.label}：${tab.count} ${tab.unit}`,
        },
        dataset: { action: 'tab', view: tab.id },
      },
      h('span', { class: 'tab-label', text: tab.label }),
      h('span', { class: 'tab-count' },
        h('span', { class: 'count', text: String(tab.count) }),
        h('span', { class: 'unit', text: tab.unit })))
      if (index > 0) node.dataset.order = String(index)
      nav.append(node)
    })
    return nav
  }

  function renderActiveView(model: PanelModel): HTMLElement {
    switch (state.view) {
      case 'commits':
        return renderHistory(model.history, {
          result: model.result,
          // 最新一条提交在列表最上面；菜单里「撤销这次提交」只对它开放。
          headOid: model.history.rows[0] === undefined ? null : model.history.rows[0].oid,
          menuOid: commitMenuOid,
          confirmOid: commitConfirmOid,
        })
      case 'worktrees': {
        const options: WorktreesViewOptions = {
          filter: wtFilter,
          noticeOpen: wtNoteOpen,
          expandedPath: expandedWorktree,
        }
        const result = model.result !== null && (model.result.source === 'ai' || model.result.source === 'worktree') ? model.result : null
        return renderWorktrees(model.worktrees, result, options)
      }
      case 'stash':
        return renderStash(model.stash, model.result)
      default:
        return renderChanges(model.changes, model.result)
    }
  }

  /** 分支浮层：外壳只负责定位与标题，内容仍然是那份分支清单（列表 ↔ 详情 ↔ 表单）。 */
  function renderBranchPopover(model: PanelModel): HTMLElement {
    return h('div', {
      class: 'branch-pop',
      attrs: { role: 'dialog', 'aria-label': COPY.branches.listTitle },
    }, renderBranches(model.branches, model.result !== null && model.result.source === 'branch' ? model.result : null))
  }

  /** 把分支浮层摆在顶部那枚分支按钮的正下方；下面放不下就翻到按钮上方，左右夹在面板内。 */
  function positionBranchPop(): void {
    const pop = root.querySelector<HTMLElement>('.branch-pop')
    if (pop === null) return
    const anchor = root.querySelector<HTMLElement>('[data-action="branch-open"]')
    const panel = root.querySelector<HTMLElement>('.panel')
    if (anchor === null || panel === null) return
    const a = anchor.getBoundingClientRect()
    const p = panel.getBoundingClientRect()
    const width = pop.offsetWidth
    const height = pop.offsetHeight
    const left = Math.min(Math.max(a.left - p.left, 8), Math.max(8, p.width - width - 8))
    let top = a.bottom - p.top + 8
    if (top + height > p.height - 8) top = Math.max(8, a.top - p.top - height - 8)
    pop.style.left = `${left}px`
    pop.style.top = `${top}px`
    pop.classList.add('is-placed')
  }

  /**
   * 交接说明贴在点开的那个入口旁边：rail 的整行入口、改动页的「拿不准怎么拆提交」、
   * 工作树页与分支页的入口都可能是触发点，按 data-kind 找到当前可见的那一个。
   * 找不到触发点（例如深链直接打开）时退回面板中间偏上，仍然不铺满整屏。
   */
  function positionHandoff(): void {
    const layer = root.querySelector<HTMLElement>('.handoff-layer.is-pop')
    if (layer === null || handoffKind === null) return
    const sheet = layer.querySelector<HTMLElement>('.handoff-sheet')
    const panel = root.querySelector<HTMLElement>('.panel')
    if (sheet === null || panel === null) return
    const anchor = root.querySelector<HTMLElement>(`[data-action="handoff-open"][data-kind="${handoffKind}"]`)
    const p = panel.getBoundingClientRect()
    const width = sheet.offsetWidth
    const height = sheet.offsetHeight
    let left = Math.max(8, (p.width - width) / 2)
    let top = Math.max(8, (p.height - height) / 3)
    if (anchor !== null) {
      const a = anchor.getBoundingClientRect()
      left = Math.min(Math.max(a.left - p.left, 8), Math.max(8, p.width - width - 8))
      top = a.bottom - p.top + 8
      if (top + height > p.height - 8) top = Math.max(8, a.top - p.top - height - 8)
    }
    sheet.style.left = `${left}px`
    sheet.style.top = `${top}px`
    sheet.style.width = `${Math.min(440, p.width - 16)}px`
    layer.classList.add('is-placed')
  }

  /**
   * 拉取前的提醒做成贴着「拉取」按钮的浮层，不再铺满面板：
   * 遮罩会把列表和工作树一起盖住，读的人还得先找哪块被压暗了才敢点。
   * 浮层的位置在重画之后按按钮的实际矩形算，宽度变化与换皮肤都不用另写一套定位。
   */
  function renderPopconfirm(confirm: { title: string; body: string; files: string[]; continueLabel: string; cancelLabel: string }): HTMLElement {
    return h('div', {
      class: 'popconfirm',
      attrs: { role: 'dialog', 'aria-labelledby': 'confirm-title', 'aria-describedby': 'confirm-body' },
    },
    h('div', { class: 'popconfirm-card' },
      h('h3', { class: 'popconfirm-title', id: 'confirm-title', text: confirm.title }),
      h('p', { class: 'popconfirm-body', id: 'confirm-body', text: confirm.body }),
      h('p', { class: 'popconfirm-meta', text: COPY.rail.confirmFiles(confirm.files.length) }),
      h('div', { class: 'popconfirm-actions' },
        h('button', {
          class: 'btn btn-md',
          attrs: { type: 'button', 'data-focus-key': 'confirm-cancel' },
          dataset: { action: 'confirm-cancel' },
        }, confirm.cancelLabel),
        h('button', {
          class: 'btn btn-primary btn-md',
          attrs: { type: 'button', 'data-focus-key': 'confirm-continue' },
          dataset: { action: 'confirm-continue' },
        }, confirm.continueLabel))))
  }

  /** 把浮层摆在「拉取」按钮正下方；底部放不下时翻到按钮上方，左右都夹在面板内。 */
  function positionPopconfirm(): void {
    const pop = root.querySelector<HTMLElement>('.popconfirm')
    if (pop === null) return
    const anchor = root.querySelector<HTMLElement>('[data-action="pull"]')
    const panel = root.querySelector<HTMLElement>('.panel')
    if (anchor === null || panel === null) return
    const a = anchor.getBoundingClientRect()
    const p = panel.getBoundingClientRect()
    const width = pop.offsetWidth
    const height = pop.offsetHeight
    const left = Math.min(Math.max(a.left - p.left, 8), Math.max(8, p.width - width - 8))
    let top = a.bottom - p.top + 8
    if (top + height > p.height - 8) top = Math.max(8, a.top - p.top - height - 8)
    pop.style.left = `${left}px`
    pop.style.top = `${top}px`
    pop.classList.add('is-placed')
  }

  /** 忙态标记到框架上：让「整块重画之后 aria-busy 还在」这件事有唯一出口。 */
  function exitBusyLabel(wrap: HTMLElement, model: PanelModel): void {
    if (model.busy !== null || model.rail.reloading) wrap.setAttribute('aria-busy', 'true')
  }

  // ---------- 事件 ----------

  function runOp(op: OpName): void {
    if (state.busy !== null || state.reloading) return
    if (op === 'commit') dispatch({ type: 'commit-start' }, { focusKey: 'commit' })
    else dispatch({ type: 'op-start', op }, { focusKey: op })
    pendingOp = op
    if (opTimer !== null) window.clearTimeout(opTimer)
    const delay = op === 'commit' ? 700 : 850
    opTimer = window.setTimeout(() => {
      opTimer = null
      const finished = pendingOp
      pendingOp = null
      if (finished === null) return
      if (finished === 'commit') dispatch({ type: 'commit-finish' }, { focusKey: 'commit-message' })
      else dispatch({ type: 'op-finish', op: finished, nowMs: Date.now() }, { focusKey: finished })
    }, delay)
  }

  function runReload(): void {
    if (state.reloading || state.busy !== null) return
    dispatch({ type: 'reload-start' }, { focusKey: 'reload' })
    window.setTimeout(() => {
      dispatch({ type: 'reload-finish', readAtMs: Date.now(), basisMs: state.basisMs ?? Date.now() }, { focusKey: 'reload' })
    }, 500)
  }

  function dirtyFiles(): string[] {
    return [...state.staged, ...state.unstaged]
  }

  /**
   * 从提交详情回到列表：列表的滚动位置与刚才打开的那一行都要恢复，
   * 否则 50 条提交里点开再看返回，用户得自己滚回去找刚才那一行。
   */
  function backToHistoryList(): void {
    const detail = panelModelOf(base, state, Date.now()).history.detail
    dispatch({ type: 'history-back' }, {
      focusKey: detail === null ? 'tab-commits' : `commit:${detail.oid}`,
      scroll: null,
      post: () => {
        const list = root.querySelector<HTMLElement>('.history-scroll')
        if (list !== null) list.scrollTop = historyListScroll
      },
    })
  }

  async function copyPath(path: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(path)
    } catch {
      // 剪贴板在无用户手势或非安全上下文时会拒绝；原型不在这里报错，结果条会如实说明已复制。
    }
    dispatch({ type: 'copy', path }, { focusKey: lastFocusKey })
  }

  /** 关掉所有「只属于本次浏览」的浮层：切页签时不该把它们带到新页面上。 */
  function closeTransientPanels(): void {
    if (state.openMenuPath !== null) state = reduce(state, { type: 'changes-open-menu', path: null }, base)
    if (state.changesPending !== null) state = reduce(state, { type: 'changes-pending', pending: null }, base)
    if (state.stashPending !== null) state = reduce(state, { type: 'stash-pending', pending: null }, base)
    commitMenuOid = null
    commitConfirmOid = null
  }

  /** 交接说明里「界面停在」那一行：只写读者关心的位置，不写控件名。 */
  function focusText(model: PanelModel): string {
    if (state.branchOpen) return '分支浮层，正在本地分支清单里'
    if (state.view === 'commits') {
      const detail = model.history.detail
      return detail === null ? '提交历史视图的列表' : `提交历史视图，正在看提交 ${detail.short} 的详情`
    }
    if (state.view === 'worktrees') {
      return `工作树视图，筛选是${wtFilter === 'all' ? '全部' : '只看需要处理'}`
    }
    if (state.view === 'stash') {
      return `贮藏视图，列表里有 ${model.stash.total} 条记录`
    }
    const filter = state.changesFilter
    const filterLabel = filter === 'conflict' ? '只看冲突' : filter === 'staged' ? '只看已暂存' : filter === 'unstaged' ? '只看未暂存' : '全部'
    return `改动视图，筛选是${filterLabel}`
  }

  /** 复制整段交接说明：剪贴板被拒绝时不弹错，只把「已复制」的判断留给浮层里的结果行。 */
  async function copyHandoff(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // 非安全上下文会拒绝写剪贴板；原型仍然把这段文字完整留在浮层里，读者可以手动选中复制。
    }
    handoffCopied = true
    liveRegion.textContent = COPY.ai.copied(text.length)
    repaint({ focusKey: 'handoff-copy' })
  }

  function onClick(event: Event): void {
    const target = event.target
    if (!(target instanceof Element)) return
    const el = target.closest<HTMLElement>('[data-action]')
    if (el === null) return
    const action = el.dataset.action ?? ''
    const model = panelModelOf(base, state, Date.now())
    switch (action) {
      case 'width': {
        const next = Number(el.dataset.width)
        if (next === panelWidth) return
        panelWidth = next
        repaint({ focusKey: `width-${next}` })
        return
      }
      case 'theme': {
        const next = el.dataset.theme
        if (next !== 'dark' && next !== 'light') return
        if (next === theme) return
        theme = next
        document.documentElement.dataset.theme = next
        repaint({ focusKey: `theme-${next}` })
        return
      }
      case 'tab': {
        const view = el.dataset.view
        if (view !== 'changes' && view !== 'commits' && view !== 'worktrees' && view !== 'stash') return
        // 分支浮层是覆盖层：点页签意味着离开它，先关掉再切视图，避免浮层留在新页签上面。
        if (state.branchOpen) {
          state = reduce(state, { type: 'branch-close' }, base)
        }
        closeTransientPanels()
        // 点页签等于离开当前二级页与命令面板：页面栈清空，下次回来是干净的页签内容。
        if (pages.stack.length > 0 || pages.paletteOpen) pages = createPageState()
        if (state.view === view) {
          repaint({ focusKey: `tab-${view}`, scroll: null })
          return
        }
        dispatch({ type: 'view', view }, { focusKey: `tab-${view}`, scroll: null })
        return
      }
      case 'reload':
        runReload()
        return
      case 'pull': {
        if (model.rail.pull.disabled) return
        // 已经打开时再点一次等于取消：同一个按钮负责开与关，符合浮层的预期。
        if (state.confirmPull !== null) {
          dispatch({ type: 'pull-confirm-close' }, { focusKey: 'pull' })
          return
        }
        if (model.rail.pull.warn) {
          dispatch({ type: 'pull-confirm-open', files: dirtyFiles(), dirtyCount: dirtyFiles().length }, { focusKey: 'confirm-cancel' })
          return
        }
        runOp('pull')
        return
      }
      case 'fetch': runOp('fetch'); return
      case 'push': runOp('push'); return
      case 'copy-repo': void copyPath(model.rail.worktreePath); return
      case 'worktree-copy': {
        const path = el.dataset.path ?? ''
        void copyPath(path)
        return
      }
      case 'filter': {
        const filter = el.dataset.filter
        if (filter !== 'conflict' && filter !== 'staged' && filter !== 'unstaged') return
        dispatch({ type: 'filter', filter: state.changesFilter === filter ? 'all' : filter }, { focusKey: `filter-${filter}` })
        return
      }
      case 'toggle-file': {
        const path = el.dataset.path ?? ''
        dispatch({ type: 'toggle-file', path }, { focusKey: `row:${path}` })
        return
      }
      case 'stage':
      case 'unstage': {
        const path = el.dataset.path ?? ''
        dispatch({ type: action, path }, { focusKey: `row:${path}` })
        return
      }
      case 'stage-all':
        dispatch({ type: 'stage-all' }, { focusKey: 'stage-all' })
        return
      case 'unstage-all':
        dispatch({ type: 'unstage-all' }, { focusKey: 'unstage-all' })
        return
      case 'commit': {
        if (model.changes.composer.disabled) return
        runOp('commit')
        return
      }
      case 'changes-open-menu': {
        const path = el.dataset.path ?? ''
        const open = state.openMenuPath === path
        dispatch({ type: 'changes-open-menu', path: open ? null : path }, { focusKey: `row-more:${path}` })
        return
      }
      case 'changes-pending': {
        const kind = el.dataset.kind
        if (kind !== 'discard' && kind !== 'discard-all' && kind !== 'ignore' && kind !== 'delete-untracked' && kind !== 'resolve-ours' && kind !== 'resolve-theirs') return
        const pendingKind: ChangesPendingKind = kind
        const path = el.dataset.path ?? null
        dispatch({ type: 'changes-pending', pending: { kind: pendingKind, path } }, { focusKey: 'changes-cancel', scroll: null })
        return
      }
      case 'changes-pending-cancel':
        dispatch({ type: 'changes-pending', pending: null }, { focusKey: lastFocusKey, scroll: null })
        return
      case 'changes-apply':
        dispatch({ type: 'changes-apply' }, { focusKey: lastFocusKey, scroll: null })
        return
      case 'stash-create':
        dispatch({ type: 'stash-create' }, { focusKey: 'composer-links', scroll: null })
        return
      case 'stash-apply':
      case 'stash-pop': {
        const id = el.dataset.id ?? ''
        dispatch({ type: action, id }, { focusKey: `stash-${action === 'stash-apply' ? 'apply' : 'pop'}:${id}`, scroll: null })
        return
      }
      case 'stash-pending': {
        const pending: StashPending = { kind: 'drop', id: el.dataset.id ?? '' }
        dispatch({ type: 'stash-pending', pending }, { focusKey: 'stash-cancel', scroll: null })
        return
      }
      case 'stash-pending-cancel':
        dispatch({ type: 'stash-pending', pending: null }, { focusKey: lastFocusKey, scroll: null })
        return
      case 'stash-drop':
        dispatch({ type: 'stash-drop', id: el.dataset.id ?? '' }, { focusKey: 'tab-stash', scroll: null })
        return
      case 'commit-menu': {
        const oid = el.dataset.oid ?? ''
        const open = commitMenuOid === oid && commitConfirmOid === null
        commitMenuOid = open ? null : oid
        commitConfirmOid = null
        repaint({ focusKey: `commit-more:${oid}` })
        return
      }
      case 'commit-menu-close':
        commitMenuOid = null
        commitConfirmOid = null
        repaint({ focusKey: lastFocusKey })
        return
      case 'commit-undo-start': {
        const oid = el.dataset.oid ?? ''
        commitMenuOid = oid
        commitConfirmOid = oid
        repaint({ focusKey: 'commit-cancel' })
        return
      }
      case 'commit-undo': {
        const oid = el.dataset.oid ?? ''
        commitMenuOid = null
        commitConfirmOid = null
        dispatch({ type: 'commit-undo', oid }, { focusKey: 'tab-commits', scroll: null })
        return
      }
      case 'commit-revert':
      case 'commit-cherry-pick': {
        const oid = el.dataset.oid ?? ''
        commitMenuOid = null
        commitConfirmOid = null
        dispatch({ type: action, oid }, { focusKey: `commit:${oid}`, scroll: null })
        return
      }
      case 'copy-oid': {
        const oid = el.dataset.oid ?? ''
        commitMenuOid = null
        commitConfirmOid = null
        void copyPath(oid)
        repaint({ focusKey: 'tab-commits' })
        return
      }
      case 'history-open': {
        const scrollEl = root.querySelector<HTMLElement>('.history-scroll')
        historyListScroll = scrollEl === null ? 0 : scrollEl.scrollTop
        dispatch({ type: 'history-open', oid: el.dataset.oid ?? '' }, { focusKey: 'history-back', scroll: null, post: () => { const el = root.querySelector<HTMLElement>('.detail-scroll'); if (el !== null) el.scrollTop = 0 } })
        return
      }
      case 'history-file': {
        const path = el.dataset.path ?? ''
        dispatch({ type: 'history-open-file', path }, { focusKey: `history-file:${path}` })
        return
      }
      case 'history-back': {
        backToHistoryList()
        return
      }
      case 'history-merge-only':
        dispatch({ type: 'history-merge-only' }, { focusKey: 'history-merge' })
        return
      case 'ai-worktrees':
        dispatch({ type: 'ai-worktrees' }, { focusKey: 'ai-worktrees' })
        return
      case 'handoff-open': {
        const kind = el.dataset.kind
        if (kind !== 'general' && kind !== 'changes' && kind !== 'worktrees' && kind !== 'branches') return
        handoffKind = kind
        handoffFocus = focusText(model)
        handoffCopied = false
        repaint({ focusKey: 'handoff-copy' })
        return
      }
      case 'handoff-close': {
        if (handoffKind === null) return
        const previous = handoffKind
        handoffKind = null
        handoffCopied = false
        repaint({ focusKey: `handoff-${previous}` })
        return
      }
      case 'handoff-copy': {
        if (handoffKind === null) return
        const draft = buildHandoff(data, handoffKind, Date.now(), handoffFocus)
        void copyHandoff(draft.prompt)
        return
      }
      case 'wt-filter': {
        const filter = el.dataset.filter === 'abnormal' ? 'abnormal' : 'all'
        if (filter === wtFilter) return
        wtFilter = filter
        repaint({ focusKey: `wt-filter-${filter}` })
        return
      }
      case 'wt-note-close':
        wtNoteOpen = false
        repaint({ focusKey: 'wt-note-open' })
        return
      case 'wt-note-open':
        wtNoteOpen = true
        repaint({ focusKey: 'wt-note-open' })
        return
      case 'wt-expand': {
        const path = el.dataset.path ?? ''
        expandedWorktree = expandedWorktree === path ? null : path
        repaint({ focusKey: `wt-expand:${path}` })
        return
      }
      case 'branch-open':
        dispatch({ type: 'branch-open' }, { focusKey: 'branch-search', scroll: null })
        return
      case 'branch-close':
        dispatch({ type: 'branch-close' }, { focusKey: 'branch-open', scroll: null })
        return
      case 'branch-select': {
        const name = el.dataset.name ?? ''
        dispatch({ type: 'branch-select', name }, { focusKey: 'branch-back', scroll: null })
        return
      }
      case 'branch-sub': {
        const sub = el.dataset.sub
        if (sub !== 'list' && sub !== 'detail' && sub !== 'create' && sub !== 'rename') return
        const next: BranchSub = sub
        const focusKey = next === 'create' || next === 'rename' ? 'branch-draft' : 'branch-back'
        dispatch({ type: 'branch-sub', sub: next }, { focusKey, scroll: null })
        return
      }
      case 'branch-create':
        dispatch({ type: 'branch-create' }, { focusKey: 'branch-back', scroll: null })
        return
      case 'branch-rename-confirm':
        dispatch({ type: 'branch-rename', name: el.dataset.name ?? '' }, { focusKey: 'branch-back', scroll: null })
        return
      case 'branch-switch': {
        const name = el.dataset.name ?? ''
        // 工作区有改动时先内联确认：真实 git 会在切换时把这些改动带过去，部分场景会挡下来。
        if (model.branches.dirty) {
          dispatch({ type: 'branch-pending', pending: { kind: 'switch', name } }, { focusKey: 'branch-confirm', scroll: null })
          return
        }
        dispatch({ type: 'branch-switch', name }, { focusKey: 'branch-back', scroll: null })
        return
      }
      case 'branch-switch-confirm':
        dispatch({ type: 'branch-switch', name: el.dataset.name ?? '' }, { focusKey: 'branch-back', scroll: null })
        return
      case 'branch-merge':
        dispatch({ type: 'branch-merge', name: el.dataset.name ?? '' }, { focusKey: 'branch-back', scroll: null })
        return
      case 'branch-delete-start':
        dispatch({ type: 'branch-pending', pending: { kind: 'delete', name: el.dataset.name ?? '' } }, { focusKey: 'branch-cancel', scroll: null })
        return
      case 'branch-delete-confirm':
        dispatch({ type: 'branch-delete', name: el.dataset.name ?? '' }, { focusKey: 'branch-back', scroll: null })
        return
      case 'branch-rebase-start':
        dispatch({ type: 'branch-pending', pending: { kind: 'rebase', name: el.dataset.name ?? '' } }, { focusKey: 'branch-cancel', scroll: null })
        return
      case 'branch-rebase-confirm':
        dispatch({ type: 'branch-rebase', name: el.dataset.name ?? '' }, { focusKey: 'branch-back', scroll: null })
        return
      case 'branch-pending-cancel':
        dispatch({ type: 'branch-pending', pending: null }, { focusKey: 'branch-back', scroll: null })
        return
      case 'wt-pending': {
        const kind = el.dataset.kind
        if (kind !== 'unlock' && kind !== 'prune' && kind !== 'remove') return
        const pending: WorktreePending = { kind, path: el.dataset.path ?? '', name: el.dataset.name ?? '' }
        dispatch({ type: 'wt-pending', pending }, { focusKey: 'wt-cancel', scroll: null })
        return
      }
      case 'wt-pending-cancel':
        dispatch({ type: 'wt-pending', pending: null }, { focusKey: `wt-expand:${el.dataset.path ?? expandedWorktree ?? ''}`, scroll: null })
        return
      case 'wt-apply':
        dispatch({ type: 'wt-apply' }, { focusKey: `wt-expand:${expandedWorktree ?? ''}`, scroll: null })
        return
      case 'confirm-cancel':
        dispatch({ type: 'pull-confirm-close' }, { focusKey: 'pull' })
        return
      case 'confirm-continue':
        dispatch({ type: 'pull-confirm-close' }, { focusKey: 'pull' })
        runOp('pull')
        return
      case 'result-dismiss':
        dispatch({ type: 'result-clear' }, { focusKey: lastFocusKey })
        return
      case 'page-open': {
        const page = asPageId(el.dataset.page)
        if (page === null) return
        dispatchPage({ type: 'page-open', page }, { focusKey: 'page-back', scroll: null })
        return
      }
      case 'page-back':
        dispatchPage({ type: 'page-back' }, { focusKey: 'page-back', scroll: null })
        return
      case 'page-close-all':
        dispatchPage({ type: 'page-close-all' }, { focusKey: lastFocusKey, scroll: null })
        return
      case 'page-fold': {
        const key = el.dataset.key ?? ''
        dispatchPage({ type: 'page-fold', key }, { focusKey: 'fold:' + key })
        return
      }
      case 'page-filter': {
        const filter = el.dataset.filter ?? 'all'
        dispatchPage({ type: 'page-filter', filter }, { focusKey: 'filter:' + filter })
        return
      }
      case 'page-demo':
        dispatchPage({ type: 'page-result', text: el.dataset.note ?? '已执行（原型模拟）。' }, { focusKey: lastFocusKey })
        return
      case 'page-result-clear':
        dispatchPage({ type: 'page-result-clear' }, { focusKey: lastFocusKey })
        return
      case 'cap-open': {
        const id = el.dataset.id ?? ''
        dispatchPage({ type: 'cap-open', id }, { focusKey: 'cap-open:' + id, scroll: null })
        return
      }
      case 'cap-close':
        dispatchPage({ type: 'cap-close' }, { focusKey: 'cap-open:' + pages.capOpen })
        return
      case 'cap-next':
        dispatchPage({ type: 'cap-next' }, { focusKey: 'cap-run-' + pages.capOpen })
        return
      case 'cap-run':
        dispatchPage({ type: 'cap-run' }, { focusKey: lastFocusKey })
        return
      case 'danger-open': {
        const id = el.dataset.id ?? ''
        dispatchPage({ type: 'danger-open', id }, { focusKey: 'danger-input', scroll: null })
        return
      }
      case 'danger-close':
        dispatchPage({ type: 'danger-close' }, { focusKey: 'danger-zone', scroll: null })
        return
      case 'danger-run':
        dispatchPage({ type: 'danger-run' }, { focusKey: 'danger-zone', scroll: null })
        return
      case 'rebase-demo':
      case 'rebase-step':
      case 'rebase-abort':
      case 'conflict-demo':
      case 'conflict-abort':
      case 'task-demo':
      case 'task-tick': {
        const focusByAction: Record<string, string> = {
          'rebase-demo': 'rebase-next',
          'rebase-step': 'rebase-next',
          'rebase-abort': 'rebase-start',
          'conflict-demo': 'conflict-start',
          'conflict-abort': 'conflict-start',
          'task-demo': 'task-tick',
          'task-tick': 'task-tick',
        }
        dispatchPage({ type: action } as PageAction, { focusKey: focusByAction[action] ?? lastFocusKey, scroll: null })
        return
      }
      case 'conflict-choice': {
        const choice = el.dataset.choice === 'theirs' ? 'theirs' : 'ours'
        dispatchPage({ type: 'conflict-choice', choice }, { focusKey: lastFocusKey, scroll: null })
        return
      }
      case 'conflict-resolve': {
        const path = el.dataset.path ?? ''
        dispatchPage({ type: 'conflict-resolve', path }, { focusKey: 'conflict-resolve:' + path, scroll: null })
        return
      }
      case 'palette-open':
        dispatchPage({ type: 'palette-open' }, { focusKey: 'palette-input', scroll: null })
        return
      case 'palette-close': {
        // 面板内部的空白点击不该关掉面板：只有点在遮罩上才算「点到了外面」。
        if (target.closest('.palette') !== null) return
        dispatchPage({ type: 'palette-close' }, { focusKey: lastFocusKey, scroll: null })
        return
      }
      case 'palette-select': {
        const id = el.dataset.id ?? ''
        jumpToCapability(id)
        return
      }
      case 'search-jump':
        jumpFromSearch(el.dataset.kind ?? '', el.dataset.oid ?? el.dataset.name ?? el.dataset.id ?? '')
        return
      case 'page-form-submit': {
        const kind = el.dataset.kind ?? ''
        const text = kind === 'remote-add'
          ? '已添加远端（原型模拟）：列表里会多一行，拉取与推送按钮随即可用。'
          : '已添加子模块（原型模拟）：克隆完成后才出现在清单里。'
        dispatchPage({ type: 'page-result', text }, { focusKey: lastFocusKey })
        return
      }
      case 'branch-tags-view':
        jumpFromSearch('branch', el.dataset.name ?? '')
        return
      case 'branch-open-from-page': {
        const name = el.dataset.name ?? ''
        state = reduce(state, { type: 'branch-open' }, base)
        if (name !== '') state = reduce(state, { type: 'branch-select', name }, base)
        pages = reducePage(pages, { type: 'page-close-all' })
        render({ focusKey: 'branch-back', scroll: null })
        return
      }
      default:
        return
    }
  }

  function onChange(event: Event): void {
    const target = event.target
    if (!(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLInputElement)) return
    if (event instanceof InputEvent && event.isComposing) return
    const field = target.dataset.field
    if (field === 'message') {
      const next = reduce(state, { type: 'message', value: target.value }, base)
      if (next === state) return
      state = next
      syncComposer()
    } else if (field === 'history-query') {
      dispatch({ type: 'history-query', value: target.value }, { focusKey: 'history-query' })
    } else if (field === 'branch-query') {
      dispatch({ type: 'branch-query', value: target.value }, { focusKey: 'branch-search' })
    } else if (field === 'branch-draft') {
      dispatch({ type: 'branch-draft', value: target.value }, { focusKey: 'branch-draft' })
    } else if (field === 'page-query') {
      dispatchPage({ type: 'page-query', value: target.value }, { focusKey: target.dataset.focusKey ?? 'page-query' })
    } else if (field === 'page-draft') {
      dispatchPage({ type: 'page-draft', value: target.value }, { focusKey: target.dataset.focusKey ?? 'page-draft' })
    } else if (field === 'palette-query') {
      dispatchPage({ type: 'palette-query', value: target.value }, { focusKey: 'palette-input' })
    } else if (field === 'confirm-text') {
      dispatchPage({ type: 'confirm-text', value: target.value }, { focusKey: 'danger-input' })
    }
  }

  /**
   * 提交说明每敲一个字只更新「按钮能不能点、原因写什么」这两处，不整块重画。
   * 整块重画会把列表滚动位置重新赋一遍，滚动条刚好见底时看起来就像列表在抖；
   * 而输入说明本来就不该动列表。滚动搜索框仍走整块重画，因为筛选结果确实变了。
   */
  function syncComposer(): void {
    const composer = root.querySelector<HTMLElement>('.composer')
    if (composer === null) return
    const current = panelModelOf(base, state, Date.now()).changes.composer
    const buttonEl = composer.querySelector<HTMLButtonElement>('.btn-primary')
    if (buttonEl !== null) {
      const busy = current.busy
      buttonEl.disabled = current.disabled || busy
      buttonEl.classList.toggle('is-disabled', current.disabled && !busy)
      buttonEl.setAttribute('aria-busy', busy ? 'true' : 'false')
      buttonEl.title = current.disabledReason ?? ''
      const label = buttonEl.querySelector<HTMLElement>('.btn-label')
      if (label !== null) label.textContent = busy ? COPY.busy.commit : COPY.changes.commitLabel(current.stagedCount)
    }

    const submitRow = composer.querySelector<HTMLElement>('.composer-submit')
    const reason = composer.querySelector<HTMLElement>('.composer-reason')
    if (current.disabledReason === null) {
      if (reason !== null) reason.remove()
      return
    }
    if (reason !== null) {
      const text = reason.querySelector<HTMLElement>('span')
      if (text !== null) text.textContent = current.disabledReason
      return
    }
    if (submitRow !== null) {
      submitRow.before(h('div', { class: 'composer-reason' }, icon('alert', 12), h('span', { text: current.disabledReason })))
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    const target = event.target
    if (!(target instanceof HTMLElement)) return

    // Ctrl/⌘ + K 打开命令面板：这是「我知道有这条能力，但找不到它在哪」的唯一快捷键。
    if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
      event.preventDefault()
      if (!pages.paletteOpen) dispatchPage({ type: 'palette-open' }, { focusKey: 'palette-input', scroll: null })
      return
    }
    // Esc 的关闭顺序按「盖在上面的先关」：命令面板 → 危险核对页 → 行内确认卡 → 当前二级页。
    if (event.key === 'Escape' && pages.paletteOpen) {
      event.preventDefault()
      dispatchPage({ type: 'palette-close' }, { focusKey: lastFocusKey, scroll: null })
      return
    }
    if (event.key === 'Escape' && pages.dangerId !== null) {
      event.preventDefault()
      dispatchPage({ type: 'danger-close' }, { focusKey: 'danger-zone', scroll: null })
      return
    }
    if (event.key === 'Escape' && pages.capOpen !== '') {
      event.preventDefault()
      dispatchPage({ type: 'cap-close' }, { focusKey: 'cap-open:' + pages.capOpen })
      return
    }
    if (event.key === 'Escape' && pages.stack.length > 0) {
      event.preventDefault()
      dispatchPage({ type: 'page-back' }, { focusKey: 'page-back', scroll: null })
      return
    }
    // 命令面板里回车打开第一条：键盘操作不用先 Tab 到列表再按空格。
    if (pages.paletteOpen && event.key === 'Enter' && target.dataset.field === 'palette-query') {
      const first = root.querySelector<HTMLElement>('.palette-row[data-action="palette-select"]')
      if (first !== null) {
        event.preventDefault()
        jumpToCapability(first.dataset.id ?? '')
      }
      return
    }
    if (event.key === 'Escape' && handoffKind !== null) {
      event.preventDefault()
      const previous = handoffKind
      handoffKind = null
      handoffCopied = false
      repaint({ focusKey: `handoff-${previous}` })
      return
    }
    if (event.key === 'Escape' && state.changesPending !== null) {
      event.preventDefault()
      dispatch({ type: 'changes-pending', pending: null }, { focusKey: lastFocusKey })
      return
    }
    if (event.key === 'Escape' && state.stashPending !== null) {
      event.preventDefault()
      dispatch({ type: 'stash-pending', pending: null }, { focusKey: lastFocusKey })
      return
    }
    if (event.key === 'Escape' && (commitMenuOid !== null || commitConfirmOid !== null)) {
      event.preventDefault()
      commitMenuOid = null
      commitConfirmOid = null
      repaint({ focusKey: 'tab-commits' })
      return
    }
    if (event.key === 'Escape' && state.branchPending !== null) {
      event.preventDefault()
      dispatch({ type: 'branch-pending', pending: null }, { focusKey: 'branch-back' })
      return
    }
    if (event.key === 'Escape' && state.worktreePending !== null) {
      event.preventDefault()
      dispatch({ type: 'wt-pending', pending: null }, { focusKey: `wt-expand:${state.worktreePending.path}` })
      return
    }
    if (event.key === 'Escape' && state.branchOpen) {
      event.preventDefault()
      dispatch({ type: 'branch-close' }, { focusKey: 'branch-open' })
      return
    }
    if (event.key === 'Escape' && state.confirmPull !== null) {
      event.preventDefault()
      dispatch({ type: 'pull-confirm-close' }, { focusKey: 'pull' })
      return
    }
    if (state.confirmPull !== null) return

    const row = target.closest<HTMLElement>('[data-action="toggle-file"], [data-action="history-open"], [data-action="history-file"]')
    if (row !== null && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      row.click()
      return
    }

    if (target.getAttribute('role') === 'tab') {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
      event.preventDefault()
      const tabs = Array.from(root.querySelectorAll<HTMLElement>('.views [role="tab"]'))
      const index = tabs.indexOf(target)
      if (index < 0) return
      const nextIndex = event.key === 'ArrowRight' ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length
      const nextTab = tabs[nextIndex]
      const view = nextTab.dataset.view
      if (view === 'changes' || view === 'commits' || view === 'worktrees' || view === 'stash') {
        dispatch({ type: 'view', view }, { focusKey: `tab-${view}`, scroll: null })
      }
    }
  }

  root.addEventListener('click', onClick)
  root.addEventListener('input', onChange)
  root.addEventListener('keydown', onKeyDown)
  // 浮层之外的任何点击都收起贴着的浮层；点触发按钮本身不在这里收，交给 onClick 的开关逻辑。
  // 顺序上先处理「拉取提醒」，再处理分支浮层与行内菜单，避免一次点击只收起其中一层。
  document.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (state.confirmPull !== null && target.closest('.popconfirm') === null && target.closest('[data-action="pull"]') === null) {
      dispatch({ type: 'pull-confirm-close' }, { focusKey: 'pull' })
    }
    if (state.branchOpen && target.closest('.branch-pop') === null && target.closest('[data-action="branch-open"]') === null) {
      state = reduce(state, { type: 'branch-close' }, base)
      repaint({ focusKey: 'branch-open' })
    }
    const insideTransient = target.closest('.row-menu, .row-more, .row-act, .commit-menu, .commit-more, .changes-confirm, .commit-confirm') !== null
    if (!insideTransient && (commitMenuOid !== null || commitConfirmOid !== null || state.openMenuPath !== null)) {
      commitMenuOid = null
      commitConfirmOid = null
      if (state.openMenuPath !== null) state = reduce(state, { type: 'changes-open-menu', path: null }, base)
      repaint({ focusKey: lastFocusKey })
    }
  })
  root.addEventListener('focusin', (event) => {
    const target = event.target
    if (target instanceof HTMLElement && target.dataset.focusKey !== undefined) lastFocusKey = target.dataset.focusKey
  })

  // ---------- 首次绘制与定时刷新 ----------

  /**
   * 深链：评审时经常要直接指到某一个状态（「工作树页、300 宽」），
   * 每次都手点三下再在截图里描述太费劲，所以把关键状态放进查询串。
   * 这些都是只读的初始状态，不改变任何交互语义。
   */
  function applyDeepLink(): void {
    const params = new URLSearchParams(window.location.search)
    const widthParam = Number(params.get('width'))
    if ((PANEL_WIDTHS as readonly number[]).includes(widthParam)) panelWidth = widthParam
    const themeParam = params.get('theme')
    if (themeParam === 'dark' || themeParam === 'light') theme = themeParam
    embed = params.get('embed') === '1'
    // 工作树视图的三个局部状态也给深链：评审要截「只看异常」或「展开某一棵」时不用手点。
    const wt = params.get('wt')
    if (wt === 'abnormal' || wt === 'all') wtFilter = wt
    if (params.get('wtnote') === '0') wtNoteOpen = false
    if (params.get('demo') === '1') state = reduce(state, { type: 'demo-worktrees' }, base)
    if (params.get('wtexpand') === '1') {
      const first = panelModelOf(base, state, Date.now()).worktrees.others.find((row) => row.abnormal)
      expandedWorktree = first === undefined ? null : first.path
    }
    // 工作树动作的确认卡也留深链入口：评审要截「移除前确认」时不用先展开再点按钮。
    const wtPendingParam = params.get('wtpending')
    if (wtPendingParam === 'unlock' || wtPendingParam === 'prune' || wtPendingParam === 'remove') {
      const path = params.get('wtpath') ?? ''
      const row = panelModelOf(base, state, Date.now()).worktrees.others.find((candidate) => candidate.path === path)
      if (row !== undefined) {
        expandedWorktree = row.path
        state = reduce(state, { type: 'wt-pending', pending: { kind: wtPendingParam, path: row.path, name: row.name } }, base)
      }
    }
    const view = params.get('view')
    if (view === 'changes' || view === 'commits' || view === 'worktrees' || view === 'stash') {
      state = reduce(state, { type: 'view', view }, base)
    }
    // 改动行的「更多」菜单与它下面的确认卡也留深链：评审要截「丢弃前先问一句」时不用先展开再点。
    const menuPath = params.get('menu')
    if (menuPath !== null && menuPath !== '') {
      state = reduce(state, { type: 'changes-open-menu', path: menuPath }, base)
    }
    const changePending = params.get('cpending')
    if (changePending === 'discard' || changePending === 'discard-all' || changePending === 'ignore' || changePending === 'delete-untracked' || changePending === 'resolve-ours' || changePending === 'resolve-theirs') {
      state = reduce(state, { type: 'changes-pending', pending: { kind: changePending, path: params.get('cpath') ?? null } }, base)
    }
    // 提交行的菜单与撤销确认：oid 由评审从页面上抄，深链不替他们猜。
    const commitMenu = params.get('commitmenu')
    if (commitMenu !== null && commitMenu !== '') commitMenuOid = commitMenu
    if (params.get('commitconfirm') === '1' && commitMenuOid !== null) commitConfirmOid = commitMenuOid
    // 贮藏记录用一条演示数据起底：真实仓库里没有贮藏，也要能截到「应用 / 弹出 / 丢弃」这一页。
    if (params.get('stashdemo') === '1') state = reduce(state, { type: 'stash-create' }, base)
    const stashPending = params.get('stashpending')
    if (stashPending === 'drop') {
      const stashId = params.get('stashid') ?? 'stash@{0}'
      state = reduce(state, { type: 'stash-pending', pending: { kind: 'drop', id: stashId } }, base)
    }
    // 分支页是覆盖层，放在视图之后应用：?branches=1&view=worktrees 表示「工作树页盖着分支页」。
    if (params.get('branches') === '1') state = reduce(state, { type: 'branch-open' }, base)
    const branchName = params.get('branch')
    if (branchName !== null && branchName !== '') state = reduce(state, { type: 'branch-select', name: branchName }, base)
    const branchSubParam = params.get('bsub')
    if (branchSubParam === 'list' || branchSubParam === 'detail' || branchSubParam === 'create' || branchSubParam === 'rename') {
      state = reduce(state, { type: 'branch-sub', sub: branchSubParam }, base)
    }
    const branchDraft = params.get('bdraft')
    if (branchDraft !== null && branchDraft !== '') state = reduce(state, { type: 'branch-draft', value: branchDraft }, base)
    const branchPendingParam = params.get('bpending')
    if (branchPendingParam === 'delete' || branchPendingParam === 'switch' || branchPendingParam === 'rebase') {
      const selected = state.branchSelected
      if (selected !== null) {
        state = reduce(state, { type: 'branch-pending', pending: { kind: branchPendingParam, name: selected } }, base)
      }
    }
    if (params.get('merge') === '1') state = reduce(state, { type: 'history-merge-only' }, base)
    const query = params.get('q')
    if (query !== null && query !== '') state = reduce(state, { type: 'history-query', value: query }, base)
    const open = params.get('open')
    if (open !== null && open !== '') state = reduce(state, { type: 'history-open', oid: open }, base)
    const file = params.get('file')
    if (file !== null && file !== '') state = reduce(state, { type: 'history-open-file', path: file }, base)
    const filter = params.get('filter')
    if (filter === 'conflict' || filter === 'staged' || filter === 'unstaged') {
      state = reduce(state, { type: 'filter', filter }, base)
    }
    const message = params.get('message')
    if (message !== null && message !== '') state = reduce(state, { type: 'message', value: message }, base)
    // 拉取前的确认气泡只出现在「工作区有未提交改动」时，没有入口直接截到它；给评审留一个深链。
    if (params.get('confirm') === '1') {
      state = reduce(state, { type: 'pull-confirm-open', files: dirtyFiles(), dirtyCount: dirtyFiles().length }, base)
    }
    // AI 交接浮层也留深链：评审要截「整页状态交给 AI」时不用先点开再滚动。
    const ai = params.get('ai')
    if (ai === 'general' || ai === 'changes' || ai === 'worktrees' || ai === 'branches') {
      handoffKind = ai
      handoffFocus = focusText(panelModelOf(base, state, Date.now()))
      if (params.get('aicopied') === '1') handoffCopied = true
    }
    // 管理页、命令面板与整页流程的深链：评审直接截某一页、某一步，不用先点开再翻。
    const manageParam = params.get('manage')
    if (manageParam === '1') pages = reducePage(pages, { type: 'page-open', page: 'manage' })
    const pageParam = asPageId(params.get('page') ?? undefined)
    if (pageParam !== null) pages = reducePage(pages, { type: 'page-open', page: pageParam })
    const flowParam = params.get('flow')
    if (flowParam === 'rebase' || flowParam === 'conflicts' || flowParam === 'task') {
      pages = reducePage(pages, { type: 'page-open', page: flowParam })
    }
    const pageQuery = params.get('pq')
    if (pageQuery !== null && pageQuery !== '') pages = reducePage(pages, { type: 'page-query', value: pageQuery })
    const pageFilter = params.get('pfilter')
    if (pageFilter !== null && pageFilter !== '') pages = reducePage(pages, { type: 'page-filter', filter: pageFilter })
    if (params.get('palette') === '1') pages = reducePage(pages, { type: 'palette-open' })
    const paletteQuery = params.get('pquery')
    if (paletteQuery !== null && paletteQuery !== '') pages = reducePage(pages, { type: 'palette-query', value: paletteQuery })
    const capParam = params.get('cap')
    if (capParam !== null && capParam !== '') {
      const cap = CAPABILITIES.find((item) => item.id === capParam)
      if (cap !== undefined) {
        const target = targetOfCapability(cap)
        if (target !== 'view') pages = reducePage(pages, { type: 'page-open', page: target })
        pages = reducePage(pages, { type: 'palette-highlight', id: cap.id })
      }
    }
    const capOpenParam = params.get('capopen')
    if (capOpenParam !== null && capOpenParam !== '') pages = reducePage(pages, { type: 'cap-open', id: capOpenParam })
    if (params.get('rebase') === '1') pages = reducePage(pages, { type: 'rebase-demo' })
    const rebaseStepParam = Number(params.get('rebasestep'))
    if (Number.isInteger(rebaseStepParam) && rebaseStepParam > 0) {
      pages = reducePage(pages, { type: 'rebase-demo' })
      for (let index = 0; index < rebaseStepParam; index += 1) pages = reducePage(pages, { type: 'rebase-step' })
    }
    if (params.get('conflicts') === '1') pages = reducePage(pages, { type: 'conflict-demo' })
    if (params.get('task') === '1') pages = reducePage(pages, { type: 'task-demo' })
    const taskProgressParam = Number(params.get('taskp'))
    if (Number.isInteger(taskProgressParam) && taskProgressParam > 62) {
      pages = reducePage(pages, { type: 'task-demo' })
      while (pages.taskProgress < taskProgressParam && pages.taskProgress < 100) pages = reducePage(pages, { type: 'task-tick' })
    }
    // 搜索页的深链：search=<词> 直接带词打开；search 传空也打开这一页。
    const searchParam = params.get('search')
    if (searchParam !== null) {
      pages = reducePage(pages, { type: 'page-open', page: 'search' })
      if (searchParam !== '') pages = reducePage(pages, { type: 'page-query', value: searchParam })
    }
    // 危险动作的二级核对页：danger=<能力编号>，用于截「核对后果、敲确认词」这一屏。
    const dangerParam = params.get('danger')
    if (dangerParam !== null && dangerParam !== '') pages = reducePage(pages, { type: 'danger-open', id: dangerParam })
  }

  applyDeepLink()
  // 皮肤写在 html 上，这样整页（含纸面外框）一次重画就完成切换，不用等下一次 render。
  document.documentElement.dataset.theme = theme
  render({ focusKey: null })
  window.setInterval(() => dispatch({ type: 'tick' }, { focusKey: lastFocusKey }), 30_000)
}

/** CSS.escape 的最小替代：focus key 里可能出现冒号与中文，querySelector 里必须转义。 */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}
