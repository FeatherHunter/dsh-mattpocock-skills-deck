// views/versionControl/vcHistory.ts —— 提交历史页：列表、详情、逐文件差异与图形化视图（#1744 T09）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包。
//
// 这一页负责域 3 的三件事：3.1 提交列表、3.2 单条提交详情、3.3 提交内逐文件差异；
// 第 13.14 条「图形历史浏览器」也画在这一页，是面板内自绘的图形化视图：不调用 gitk、不开外部窗口。
//
// 数据来源（票面边界：不另造首屏读取）：
//   首屏第一页直接读 #1739 那份首屏快照的 history 片（history 片就是宿主一次性取回的第一页）；
//   「加载更多」才按需再取，每批 VC_HISTORY_BATCH 条 —— 与 vcData.ts 的 VC_LOG_BATCH 同一份数字。
// 性能预算（票面验收②）：首屏只画快照给的这一页，不多读一条；详情与逐文件差异点开才读；
//   下一批点「加载更多」才读；车道最多 VC_HISTORY_LANES_MAX 条，超过就少画并如实报数。
// 四档宽（规格第 9 节）：300 只留标题、380 补短号与图形车道、460 起补作者与时间、520 差异上下文加宽。
//
// 下面这些名字在构建拼好的闭包里由同一份源码提供，这里只声明形状（转译后整块消失）。

declare const VC_LOG_BATCH: any
declare function vcFirstScreenSliceOf(...args: any[]): any
declare function vcFirstScreenSliceStateOf(...args: any[]): any
declare function vcFirstScreenSliceErrorOf(...args: any[]): any
declare function vcFirstScreenStateOf(...args: any[]): any
declare function vcShortOid(...args: any[]): any
declare function vcWhenText(...args: any[]): any
declare function vcOneLine(...args: any[]): any
declare function vcCommitKeyOf(...args: any[]): any
declare function vcHistoryDetailOf(...args: any[]): any
declare function vcHistoryGraphOf(...args: any[]): any
declare function vcHistoryGraphNode(...args: any[]): any

export const VC_HISTORY_BATCH = VC_LOG_BATCH
export const VC_HISTORY_LANES_MAX = 6
export const VC_HISTORY_DIFF_LINES_WIDE = 120
export const VC_HISTORY_DIFF_LINES_NARROW = 60

const vcHistoryWidthOf = function (width: any) { const n = Number(width); return !isFinite(n) || n <= 0 ? 460 : Math.round(n) }
export const vcHistoryDiffContextOf = function (width: any) { return vcHistoryWidthOf(width) >= 520 ? VC_HISTORY_DIFF_LINES_WIDE : VC_HISTORY_DIFF_LINES_NARROW }

// history 片的三种读法：整片状态、片内数据、片自己的失败原因。快照形状不对时前端三个都读不到。
const vcHistorySliceOf = function (reads: any) {
  if (!reads) return { state: 'idle', data: null, error: null }
  return {
    state: vcFirstScreenSliceStateOf(reads, 'history'),
    data: (function () {
      const slice = vcFirstScreenSliceOf(reads, 'history')
      return slice && slice.data ? slice.data : null
    })(),
    error: vcFirstScreenSliceErrorOf(reads, 'history'),
  }
}

// 首屏第一页：只从快照的 history 片取，读不到就是空清单（状态由 vcHistoryStateOf 说）。
export const vcHistoryFirstPageOf = function (reads: any) {
  const slice = vcHistorySliceOf(reads)
  if (slice.state !== 'ok' || !slice.data) return []
  return Array.isArray(slice.data.commits) ? slice.data.commits : []
}

// 「加载更多」已经取回的那几批：只有 log 读完（state=ok）才追加；正在读或读失败都不冒充新读数。
const vcHistoryMoreOf = function (reads: any) {
  const log = reads && reads.log ? reads.log : null
  return !log || log.state !== 'ok' || !Array.isArray(log.commits) ? [] : log.commits
}

// 页面的四种状态：失败（片失败或整次读失败）/ 加载（还在读，含刚打开还没读）/ 空（读到了确实没有）/ 有内容。
const vcHistoryStateOf = function (reads: any, firstPage: any[], hasMore: boolean) {
  if (!reads) return 'loading'
  if (vcFirstScreenSliceStateOf(reads, 'history') === 'err') return 'error'
  const screenState = vcFirstScreenStateOf(reads)
  if (screenState === 'err') return 'error'
  if (screenState === 'loading' || screenState === 'idle') return 'loading'
  return !firstPage.length && hasMore !== true ? 'empty' : 'ok'
}

export const vcHistoryModelOf = function (reads: any, ui: any) {
  const u = ui || {}
  const firstPage = vcHistoryFirstPageOf(reads)
  const more = vcHistoryMoreOf(reads)
  const slice = vcHistorySliceOf(reads)
  const log = reads && reads.log ? reads.log : null
  const logState = log ? String(log.state || 'idle') : 'idle'
  // 是否还有下一批：读过下一批就看下一批的回包；还没读过就看首屏快照这一页的 hasMore。
  let hasMore = false
  if (logState === 'ok') hasMore = log.hasMore === true
  else if (slice.state === 'ok' && slice.data) hasMore = slice.data.hasMore === true
  const commits = firstPage.concat(more)
  return {
    source: 'first-screen',
    firstPage: firstPage,
    more: more,
    commits: commits,
    loaded: commits.length,
    hasMore: hasMore,
    state: vcHistoryStateOf(reads, firstPage, hasMore),
    error: slice.error || (reads && reads.firstScreen ? reads.firstScreen.error : null),
    logState: logState,
    logError: log ? log.error : null,
    openCommit: String(u.openCommit || ''),
    openFile: String(u.openFile || ''),
  }
}

// ———— 列表：搜索 / 只看合并 / 日期分组 / 行与行菜单（定稿 68-commit-menu-460.png） ————

// 菜单里的三条历史改写动作只做「跳到主入口」，不在这里执行 git：
//   capId 与能力账本 5.1（撤销上一条提交、改动回到已暂存）/ 5.4（还原这次提交）/ 5.5（拣选到当前分支）
//   一一对应，点下去由委托层调 selectCap 跳到主入口所在页并高亮该行 —— 账本的主入口归属与确认流程都没有改。
const VC_HISTORY_MENU_ACTS: any[] = [
  { key: 'revert', capId: '5.4', labelKey: 'vc.shell.history.menuRevert' },
  { key: 'cherry', capId: '5.5', labelKey: 'vc.shell.history.menuCherryPick' },
  { key: 'undo', capId: '5.1', labelKey: 'vc.shell.history.menuUndo', danger: true },
]

// 只看合并：两个父提交的才是合并提交（与图形视图的判据一致）。
const vcHistoryIsMergeOf = function (commit: any): boolean {
  return Array.isArray(commit && commit.parents) && commit.parents.length >= 2
}

// 搜索只筛「已经读回来的」提交（票面边界：不为了筛选多读一条）；主题、作者、短号都能命中。
export const vcHistoryFilterOf = function (commits: any, query: any, mergeOnly: any) {
  const list: any[] = Array.isArray(commits) ? commits : []
  const q: string = String(query === undefined || query === null ? '' : query).trim().toLowerCase()
  const only: boolean = mergeOnly === true
  const out: any[] = []
  for (let i = 0; i < list.length; i += 1) {
    const c: any = list[i] || {}
    if (only && !vcHistoryIsMergeOf(c)) continue
    if (q !== '') {
      const hay: string = (String(c.subject || '') + ' ' + String(c.author || '') + ' ' + String(c.short || '') + ' ' + String(c.oid || '')).toLowerCase()
      if (hay.indexOf(q) < 0) continue
    }
    out.push(c)
  }
  return out
}

// 日期分组：今天 / 昨天 / M 月 D 日，按提交时间与这次读数时刻的本地日算；往回超过一天就写日期。
const vcHistoryDayOf = function (ms: any, nowMs: any) {
  const at: number = Number(ms)
  const today: Date = new Date(Number(nowMs) || Date.now())
  const day: Date = new Date(isFinite(at) && at > 0 ? at : 0)
  const startToday: number = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startDay: number = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const diff: number = Math.round((startToday - startDay) / 86400000)
  if (diff <= 0) return { key: 'today', day: 'today' }
  if (diff === 1) return { key: 'yesterday', day: 'yesterday' }
  return { key: 'd' + String(startDay), day: 'date', m: day.getMonth() + 1, d: day.getDate() }
}
const vcHistoryDayTextOf = function (t: any, info: any): string {
  if (info.day === 'today') return t('vc.shell.history.groupToday')
  if (info.day === 'yesterday') return t('vc.shell.history.groupYesterday')
  return t('vc.shell.history.groupDate', { m: info.m, d: info.d })
}

// 行尾的「⋯」菜单：贴在行尾，条目文字左对齐（定稿 67/68 的口径）。
const vcHistoryMenuOf = function (h: any, t: any, o: any) {
  const opts = o || {}
  const oid: string = String(opts.oid || '')
  const isHead: boolean = opts.isHead === true
  const isMerge: boolean = opts.isMerge === true
  const items: any[] = []
  for (let i = 0; i < VC_HISTORY_MENU_ACTS.length; i += 1) {
    const act: any = VC_HISTORY_MENU_ACTS[i]
    const label: string = t(act.labelKey)
    // 原型口径（history.ts 菜单）：只有最新一条能撤销（分支会退一步），合并提交不能拣选（git 不知道带哪一边）。
    //   这里只把不可用的那几颗置灰，不另写说明文字；点下去什么都不会发生。
    const off: boolean = act.key === 'undo' ? !isHead : (act.key === 'cherry' ? isMerge : false)
    items.push(h('button', {
      key: act.key, type: 'button', className: 'vcs-hist-menu-item' + (act.danger === true ? ' is-danger' : ''),
      'data-vc-history-menu-cap': act.capId,
      'aria-label': t('vc.shell.history.menuCapHint', { act: label }),
      disabled: off ? true : undefined,
      'data-press': 'button', 'data-log': 'vc.history.menu-cap.' + act.key,
    }, label))
  }
  items.push(h('button', {
    key: 'copy', type: 'button', className: 'vcs-hist-menu-item', 'data-vc-history-menu-copy': oid,
    'data-press': 'button', 'data-log': 'vc.history.menu-copy',
  }, t('vc.shell.history.menuCopy')))
  items.push(h('button', {
    key: 'close', type: 'button', className: 'vcs-hist-menu-item is-close vcs-hist-menu-close', 'data-vc-history-menu-close': '1',
    'data-press': 'button', 'data-log': 'vc.history.menu-close',
  }, t('vc.shell.history.menuClose')))
  return h('div', { key: 'menu', className: 'vcs-hist-menu', role: 'menu', 'data-vc-history-menu': oid }, items)
}

export const vcHistoryRowNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const c = opts.commit || {}
  const width = vcHistoryWidthOf(opts.width)
  const oid: string = String(c.oid || '')
  const open: boolean = opts.expanded === true
  const menuOpen: boolean = opts.menuOpen === true
  const line: any[] = []
  line.push(h('button', {
    key: 'open',
    type: 'button',
    className: 'vcs-hist-open',
    'data-vc-history-open': oid,
    'aria-expanded': open ? 'true' : 'false',
    'aria-controls': 'vc-history-detail',
    'aria-label': t('vc.shell.history.open', { subject: vcOneLine(String(c.subject || ''), 120) }),
    'data-press': 'button', 'data-log': 'vc.history.row.' + String(opts.index || 0),
  }, [
    width >= 380 ? h('span', { key: 'short', className: 'vcs-hist-short', 'data-vc-history-short': '1' }, String(c.short || vcShortOid(oid))) : null,
    h('span', { key: 'subject', className: 'vcs-hist-subject' }, String(c.subject || '')),
    width >= 460 ? h('span', { key: 'meta', className: 'vcs-hist-meta' }, [
      h('span', { key: 'author', className: 'vcs-hist-author', 'data-vc-history-author': '1' }, String(c.author || '')),
      h('span', { key: 'when', className: 'vcs-hist-when', 'data-vc-history-when': '1' }, vcWhenText(t, opts.nowMs, c.authorDateMs)),
    ]) : null,
    h('span', { key: 'chev', className: 'vcs-hist-chevron', 'aria-hidden': 'true' }, '›'),
  ]))
  line.push(h('button', {
    key: 'more', type: 'button', className: 'vcs-hist-more' + (menuOpen ? ' is-open' : ''),
    'data-vc-history-more': oid,
    'aria-haspopup': 'menu',
    'aria-expanded': menuOpen ? 'true' : 'false',
    'aria-label': t('vc.shell.history.menuOpen'),
    'data-press': 'button', 'data-log': 'vc.history.more.' + String(opts.index || 0),
  }, '⋯'))
  const wrapKids: any[] = [h('div', { key: 'line', className: 'vcs-hist-line' }, line)]
  if (menuOpen) wrapKids.push(vcHistoryMenuOf(h, t, { oid: oid, isHead: opts.isHead === true, isMerge: vcHistoryIsMergeOf(c) }))
  return h('li', { key: oid, className: 'vcs-hist-row', 'data-vc-history-row': oid }, wrapKids)
}

export const vcHistoryListOf = function (h: any, t: any, o: any) {
  const opts = o || {}
  const model = opts.model || {}
  const ui = opts.ui || {}
  const width = vcHistoryWidthOf(opts.width)
  const commits: any[] = Array.isArray(model.commits) ? model.commits : []
  const query: string = String(ui.historyQuery || '')
  const mergeOnly: boolean = ui.historyMergeOnly === true
  const visible: any[] = vcHistoryFilterOf(commits, query, mergeOnly)
  const menu: string = String(ui.historyMenu || '')
  const rows: any[] = []
  let dayKey = ''
  for (let i = 0; i < visible.length; i += 1) {
    const c: any = visible[i] || {}
    const info: any = vcHistoryDayOf(c.authorDateMs, opts.nowMs)
    if (info.key !== dayKey) {
      dayKey = info.key
      rows.push(h('li', { key: 'day-' + dayKey, className: 'vcs-hist-day', role: 'presentation' }, vcHistoryDayTextOf(t, info)))
    }
    const oid: string = String(c.oid || '')
    rows.push(vcHistoryRowNode(h, t, {
      commit: c, width: width, nowMs: opts.nowMs, index: i,
      isHead: i === 0,
      expanded: oid === String(model.openCommit || ''),
      menuOpen: menu !== '' && menu === oid,
    }))
  }
  const tools: any[] = [h('input', {
    key: 'q', type: 'search', className: 'vcs-hist-query', 'data-vc-history-query': '1',
    placeholder: t('vc.shell.history.searchPlaceholder', { n: model.loaded }),
    'aria-label': t('vc.shell.history.searchPlaceholder', { n: model.loaded }),
    defaultValue: query,
  })]
  tools.push(h('button', {
    key: 'merge', type: 'button', className: 'vcs-hist-merge-only' + (mergeOnly ? ' is-on' : ''),
    'data-vc-history-merge-only': mergeOnly ? 'on' : 'off',
    'aria-pressed': mergeOnly ? 'true' : 'false',
    'data-press': 'button', 'data-log': 'vc.history.merge-only',
  }, t('vc.shell.history.mergeOnly')))
  const kids: any[] = [h('div', { key: 'tools', className: 'vcs-hist-tools' }, tools)]
  const scopeKey: string = mergeOnly || query.trim() !== '' ? 'scopeFiltered' : 'scope'
  kids.push(h('p', { key: 'scope', className: 'vcs-hist-scope', 'data-vc-history-scope': '1' }, t('vc.shell.history.' + scopeKey, { n: commits.length, m: visible.length })))
  if (!visible.length) kids.push(h('p', { key: 'filterEmpty', className: 'vcs-hist-filter-empty', 'data-vc-history-filter-empty': '1' }, t('vc.shell.history.filterEmpty')))
  kids.push(h('div', { key: 'list', id: 'vc-history-list', className: 'vcs-hist-list', role: 'list', 'aria-label': t('vc.shell.history.listLabel') }, rows))
  const hasMore = model.hasMore === true
  if (hasMore === true) {
    kids.push(h('button', {
      key: 'more',
      type: 'button',
      className: 'vcs-hist-load-more',
      'data-vc-load-more': '1',
      'aria-controls': 'vc-history-list',
      disabled: model.logState === 'loading' ? true : undefined,
    }, t('vc.shell.history.loadMore', { batch: VC_HISTORY_BATCH })))
  }
  if (model.logState === 'loading') {
    kids.push(h('span', { key: 'moreLoading', className: 'vcs-hist-more-state', 'data-vc-history-more-state': 'loading' }, t('vc.shell.history.loadingMore')))
  } else if (model.logState === 'err') {
    kids.push(h('span', { key: 'moreError', className: 'vcs-hist-more-state', 'data-vc-history-more-state': 'error' }, t('vc.shell.history.moreError')))
    kids.push(h('button', { key: 'moreRetry', type: 'button', className: 'vcs-hist-more-retry', 'data-vc-history-more-retry': '1', 'data-press': 'button', 'data-log': 'vc.history.more-retry' }, t('vc.shell.history.moreRetry')))
  }
  const attrs: any = { key: 'wrap', className: 'vcs-hist-list-wrap' }
  if (opts.hidden === true) attrs.hidden = true
  return h('div', attrs, kids)
}

export const vcHistoryPageNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const reads = opts.reads || null
  const ui = opts.ui || {}
  const width = vcHistoryWidthOf(opts.width)
  const readAt = (function () {
    const slice = vcHistorySliceOf(reads)
    if (slice.data && slice.data.readAtMs) return Number(slice.data.readAtMs)
    if (reads && reads.firstScreen && reads.firstScreen.data && reads.firstScreen.data.readAtMs) return Number(reads.firstScreen.data.readAtMs)
    return Date.now()
  })()
  const model = vcHistoryModelOf(reads, ui)
  const detail = ui.openCommit ? vcHistoryDetailOf(h, t, {
    model: model, commit: reads && reads.commit, commitDiffs: reads && reads.commitDiffs,
    ui: ui, width: width, nowMs: readAt,
  }) : null
  const kids: any[] = []
  if (model.state === 'loading') {
    kids.push(h('p', { key: 'loading', className: 'vcs-hist-state', 'data-vc-history-loading': '1' }, t('vc.shell.history.loading')))
  } else if (model.state === 'error') {
    kids.push(h('p', { key: 'error', className: 'vcs-hist-state', 'data-vc-history-error': '1' }, t('vc.shell.history.error')))
    if (model.error && model.error.message) kids.push(h('p', { key: 'errorDetail', className: 'vcs-hist-error-detail' }, t('vc.shell.history.errorDetail', { msg: String(model.error.message) })))
    kids.push(h('button', { key: 'retry', type: 'button', className: 'vcs-hist-retry', 'data-vc-history-retry': 'history', 'data-press': 'button', 'data-log': 'vc.history.retry' }, t('vc.shell.history.retry')))
  } else if (model.state === 'empty') {
    kids.push(h('p', { key: 'empty', className: 'vcs-hist-state', 'data-vc-history-empty': '1' }, t('vc.shell.history.empty')))
    kids.push(h('p', { key: 'next', className: 'vcs-hist-next', 'data-vc-history-next': '1' }, t('vc.shell.history.emptyNext')))
  } else {
    kids.push(vcHistoryListOf(h, t, { model: model, ui: ui, width: width, nowMs: readAt, hidden: !!detail }))
  }
  if (detail) kids.push(detail)
  // 详情是整页替换的阅读视图（定稿 03 截图里没有图形视图），打开详情时把 13.14 那一块收起来，
  //   返回列表再画 —— 它仍在列表页、仍是同一条能力 13.14 的呈现，不删入口也不改归属。
  if (!detail) kids.push(vcHistoryGraphNode(h, t, { graph: vcHistoryGraphOf(model.commits), width: width }))
  return h('section', {
    className: 'vcs-history',
    'data-vc-history': '1',
    'data-vc-history-state': model.state,
    'data-vc-history-count': String(model.loaded),
  }, kids)
}
