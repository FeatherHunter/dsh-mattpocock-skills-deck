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
import type { Action, OpName, SessionBase, SessionState } from '../domain/session'
import { panelModelOf } from '../domain/select'
import type { PanelModel } from '../domain/select'
import { clear, h, icon } from './dom'
import { renderRail } from './rail'
import { renderChanges } from './views/changes'
import { renderHistory } from './views/history'
import { renderWorktrees } from './views/worktrees'
import type { WorktreeFilter, WorktreesViewOptions } from './views/worktrees'

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
  }
  let state: SessionState = createSessionState(base.screen, Date.now())
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
    const selector = '.changes-scroll, .history-scroll, .detail-scroll'
    const el = root.querySelector<HTMLElement>(selector)
    if (el === null) return null
    const scrollSelector = el.classList.contains('changes-scroll')
      ? '.changes-scroll'
      : el.classList.contains('history-scroll') ? '.history-scroll' : '.detail-scroll'
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
    positionPopconfirm()
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
    panel.append(h('main', { class: 'panel-body', attrs: { id: 'view-panel', role: 'tabpanel', 'aria-labelledby': `tab-${state.view}` } }, renderActiveView(model)))
    if (model.confirm !== null) panel.append(renderPopconfirm(model.confirm))
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
      case 'commits': return renderHistory(model.history)
      case 'worktrees': {
        const options: WorktreesViewOptions = {
          filter: wtFilter,
          noticeOpen: wtNoteOpen,
          expandedPath: expandedWorktree,
        }
        return renderWorktrees(model.worktrees, model.result !== null && model.result.source === 'ai' ? model.result : null, options)
      }
      default: return renderChanges(model.changes, model.result !== null && model.result.source === 'commit' ? model.result : null)
    }
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
        if (view !== 'changes' && view !== 'commits' && view !== 'worktrees') return
        if (state.view === view) return
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
      case 'worktree-command': {
        const command = el.dataset.command ?? ''
        void copyPath(command)
        return
      }
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
      if (view === 'changes' || view === 'commits' || view === 'worktrees') {
        dispatch({ type: 'view', view }, { focusKey: `tab-${view}`, scroll: null })
      }
    }
  }

  root.addEventListener('click', onClick)
  root.addEventListener('input', onChange)
  root.addEventListener('keydown', onKeyDown)
  // 浮层之外的任何点击都收起拉取提醒；点「拉取」按钮本身不在这里收，交给 onClick 的开关逻辑。
  document.addEventListener('click', (event) => {
    if (state.confirmPull === null) return
    const target = event.target
    if (target instanceof Element && (target.closest('.popconfirm') !== null || target.closest('[data-action="pull"]') !== null)) return
    dispatch({ type: 'pull-confirm-close' }, { focusKey: 'pull' })
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
    const view = params.get('view')
    if (view === 'changes' || view === 'commits' || view === 'worktrees') {
      state = reduce(state, { type: 'view', view }, base)
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
