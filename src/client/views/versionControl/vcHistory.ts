// views/versionControl/vcHistory.ts —— 提交历史页：列表、详情、逐文件差异与图形化视图（#1744 T09；#1860 按定稿原型重排）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包。
//
// 版式照 docs/prototype/vc-redesign/src/ui/views/history.ts 与定稿截图 68-commit-menu-460.png：
//   列表 = 搜索工具行（输入框 + 只看合并）→ 范围行 → 列表（日期分组、提交行 + 行尾「⋯」菜单、加载更多）；
//   详情 = 整页替换列表的返回条 → 提交说明 → 四行元信息 → 文件清单 → 展开的差异。
//   页头标题、「13.14 落在本页」说明块与高级查询表单归页壳，不在这一叶画（#1860 已从页壳退役）；
//   图形化历史仍画在列表页下方，标题就是「图形化提交历史」，不再写长说明。
//
// 数据读取、过滤、分页与菜单动作的语义没有改（#1860 只改版式与类名）：
//   首屏第一页直接读 #1739 那份首屏快照的 history 片；「加载更多」才按需再取，
//   每批 VC_HISTORY_BATCH 条 —— 与 vcData.ts 的 VC_LOG_BATCH 同一份数字。
//   菜单里的三条历史改写动作仍只做「跳到主入口」，capId 不经这一叶执行 git。
// 四档宽（规格第 9 节）：300 只留主题、380 补短号与图形车道、460 起补作者与时间、520 差异上下文加宽。
//
// 下面这些名字在构建拼好的闭包里由同一份源码提供，这里只声明形状（转译后整块消失）。

declare const React: any
declare const VC_LOG_BATCH: any
declare function vcFirstScreenSliceOf(...args: any[]): any
declare function vcFirstScreenSliceStateOf(...args: any[]): any
declare function vcFirstScreenSliceErrorOf(...args: any[]): any
declare function vcFirstScreenStateOf(...args: any[]): any
declare function vcShortOid(...args: any[]): any
declare function vcCommitWhenText(...args: any[]): any
declare function vcOneLine(...args: any[]): any
declare function vcCommitKeyOf(...args: any[]): any
declare function vcHistoryDetailOf(...args: any[]): any
declare function vcHistoryGraphOf(...args: any[]): any
declare function vcHistoryGraphNode(...args: any[]): any
declare const vcPageIconOf: (h: any, kind: string, size: number) => any

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

// 行尾的「⋯」菜单：贴在行尾展开（定稿 68-commit-menu-460.png），条目左对齐。
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
      key: act.key, type: 'button', className: 'row-menu-item' + (act.danger === true ? ' is-danger' : ''),
      'data-vc-history-menu-cap': act.capId,
      'aria-label': t('vc.shell.history.menuCapHint', { act: label }),
      disabled: off ? true : undefined,
      'data-press': 'button', 'data-log': 'vc.history.menu-cap.' + act.key,
    }, label))
  }
  items.push(h('button', {
    key: 'copy', type: 'button', className: 'row-menu-item', 'data-vc-history-menu-copy': oid,
    'data-press': 'button', 'data-log': 'vc.history.menu-copy',
  }, t('vc.shell.history.menuCopy')))
  items.push(h('button', {
    key: 'close', type: 'button', className: 'row-menu-item is-close', 'data-vc-history-menu-close': '1',
    'data-press': 'button', 'data-log': 'vc.history.menu-close',
  }, t('vc.shell.history.menuClose')))
  return h('div', { key: 'menu', className: 'commit-menu', role: 'menu', 'aria-label': t('vc.shell.history.menuOpen'), 'data-vc-history-menu': oid }, items)
}

// 一条提交行：先认出哪次提交（短号 + 主题），再看谁提交、什么时候；行尾「⋯」紧贴该行。
//   可点主体按原型用 div + role=button + tabindex=0（原型 history.ts 的写法），
//   不用 <button> 是为了不继承页壳给按钮的边框与底色（那会让整行看起来像一颗大按钮）。
export const vcHistoryRowNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const c = opts.commit || {}
  const width = vcHistoryWidthOf(opts.width)
  const oid: string = String(c.oid || '')
  const subject: string = String(c.subject || '')
  const open: boolean = opts.expanded === true
  const menuOpen: boolean = opts.menuOpen === true
  const body: any[] = [
    width >= 380 ? h('span', { key: 'short', className: 'commit-hash mono', 'data-vc-history-short': '1' }, String(c.short || vcShortOid(oid))) : null,
    // 合并提交的标题是 git 自动生成的原文（例如 Merge branch 'main'），直接读像乱码：
    //   按原型先给「合并」chip 这个结论，原文降为下一行等宽小字；普通提交仍只画一行主题。
    //   词表里没有提交历史专用的「合并」词条，先复用分支页那条同值词条；要独立成 key 时只换这一处。
    vcHistoryIsMergeOf(c)
      ? h('span', { key: 'subject', className: 'commit-subject commit-subject-merge' }, [
        h('span', { key: 'lead', className: 'commit-merge-lead' }, t('vc.shell.branch.merge')),
        h('span', { key: 'raw', className: 'commit-merge-raw mono' }, subject),
      ])
      : h('span', { key: 'subject', className: 'commit-subject' }, subject),
    width >= 460 ? h('span', { key: 'meta', className: 'commit-meta' }, [
      h('span', { key: 'author', className: 'commit-author', 'data-vc-history-author': '1' }, String(c.author || '')),
      h('span', { key: 'when', className: 'commit-when', 'data-vc-history-when': '1' }, vcCommitWhenText(t, opts.nowMs, c.authorDateMs)),
    ]) : null,
    h('span', { key: 'chev', className: 'commit-chevron', 'aria-hidden': 'true' }, vcPageIconOf(h, 'chevron', 12)),
  ]
  const line: any = h('div', { key: 'line', className: 'commit-line' }, [
    h('div', {
      key: 'row', className: 'commit-row' + (open ? ' is-selected' : '') + (menuOpen ? ' is-menu' : ''),
      role: 'button', tabIndex: 0,
      'data-vc-history-open': oid,
      'aria-expanded': open ? 'true' : 'false',
      'aria-controls': 'vc-history-detail',
      'aria-label': t('vc.shell.history.open', { subject: vcOneLine(subject, 120) }),
      title: subject,
      'data-press': 'button', 'data-log': 'vc.history.row.' + String(opts.index || 0),
    }, body),
    h('button', {
      key: 'more', type: 'button', className: 'commit-more' + (menuOpen ? ' is-open' : ''),
      'data-vc-history-more': oid,
      'aria-haspopup': 'menu',
      'aria-expanded': menuOpen ? 'true' : 'false',
      'aria-label': t('vc.shell.history.menuOpen'),
      title: t('vc.shell.history.menuOpen'),
      'data-press': 'button', 'data-log': 'vc.history.more.' + String(opts.index || 0),
    }, h('span', { key: 'dots', 'aria-hidden': 'true' }, '⋯')),
  ])
  const wrap: any[] = [line]
  if (menuOpen) wrap.push(vcHistoryMenuOf(h, t, { oid: oid, isHead: opts.isHead === true, isMerge: vcHistoryIsMergeOf(c) }))
  return h('div', { key: oid, className: 'commit-line-wrap', 'data-vc-history-row': oid }, wrap)
}

// 列表页三块：搜索工具行、范围行、滚动区（列表 / 四种状态 / 加载更多 / 图形化历史）。
//   根读数 data-vc-history / -state / -count 挂在工具行上，四种状态都读得到（门禁与面板都靠这几个属性）。
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
  const hasMore: boolean = model.hasMore === true
  const rows: any[] = []
  let dayKey = ''
  for (let i = 0; i < visible.length; i += 1) {
    const c: any = visible[i] || {}
    const info: any = vcHistoryDayOf(c.authorDateMs, opts.nowMs)
    if (info.key !== dayKey) {
      dayKey = info.key
      rows.push(h('div', { key: 'day-' + dayKey, className: 'day-group vcs-hist-day' }, vcHistoryDayTextOf(t, info)))
    }
    const oid: string = String(c.oid || '')
    rows.push(vcHistoryRowNode(h, t, {
      commit: c, width: width, nowMs: opts.nowMs, index: i,
      isHead: i === 0,
      expanded: oid === String(model.openCommit || ''),
      menuOpen: menu !== '' && menu === oid,
    }))
  }
  const tools: any[] = [
    h('input', {
      key: 'q', type: 'search', className: 'search-input', 'data-vc-history-query': '1',
      placeholder: t('vc.shell.history.searchPlaceholder', { n: model.loaded }),
      'aria-label': t('vc.shell.history.searchPlaceholder', { n: model.loaded }),
      autoComplete: 'off', spellCheck: false, defaultValue: query,
    }),
    h('button', {
      key: 'merge', type: 'button', className: 'toggle-btn' + (mergeOnly ? ' is-on' : ''),
      'data-vc-history-merge-only': mergeOnly ? 'on' : 'off',
      'aria-pressed': mergeOnly ? 'true' : 'false',
      'data-press': 'button', 'data-log': 'vc.history.merge-only',
    }, t('vc.shell.history.mergeOnly')),
  ]
  // 范围行照原型是「已加载 n 条，共 m 条」：只有确认没有下一批（hasMore=false）时总数才可信，
  //   hasMore=true 时总数未知，沿用「已加载 n 条」；筛选态仍用「已加载 n 条，筛出 m 条」那句。
  const filtered: boolean = mergeOnly || query.trim() !== ''
  const scopeText: string = filtered
    ? t('vc.shell.history.scopeFiltered', { n: commits.length, m: visible.length })
    : (hasMore ? t('vc.shell.history.scope', { n: commits.length }) : t('vc.shell.history.scopeTotal', { n: commits.length, m: commits.length }))
  const head: any[] = [
    h('div', {
      key: 'tools', className: 'history-tools vcs-hist-tools',
      'data-vc-history': '1',
      'data-vc-history-state': model.state,
      'data-vc-history-count': String(model.loaded),
    }, tools),
    h('div', { key: 'scope', className: 'history-scope', 'data-vc-history-scope': '1' }, scopeText),
  ]
  const scroll: any[] = []
  if (model.state === 'loading') {
    scroll.push(h('div', { key: 'loading', className: 'empty', 'data-vc-history-loading': '1' }, h('div', { key: 'title', className: 'empty-title' }, t('vc.shell.history.loading'))))
  } else if (model.state === 'error') {
    const errorKids: any[] = [h('div', { key: 'title', className: 'empty-title' }, t('vc.shell.history.error'))]
    if (model.error && model.error.message) errorKids.push(h('div', { key: 'detail', className: 'empty-hint' }, t('vc.shell.history.errorDetail', { msg: String(model.error.message) })))
    errorKids.push(h('button', { key: 'retry', type: 'button', className: 'vcs-hist-retry', 'data-vc-history-retry': 'history', 'data-press': 'button', 'data-log': 'vc.history.retry' }, t('vc.shell.history.retry')))
    scroll.push(h('div', { key: 'error', className: 'empty', 'data-vc-history-error': '1' }, errorKids))
  } else if (model.state === 'empty') {
    scroll.push(h('div', { key: 'empty', className: 'empty', 'data-vc-history-empty': '1' }, [
      h('div', { key: 'title', className: 'empty-title' }, t('vc.shell.history.empty')),
      h('div', { key: 'next', className: 'empty-hint', 'data-vc-history-next': '1' }, t('vc.shell.history.emptyNext')),
    ]))
  } else if (!visible.length) {
    scroll.push(h('div', { key: 'filterEmpty', className: 'empty', 'data-vc-history-filter-empty': '1' }, h('div', { key: 'title', className: 'empty-title' }, t('vc.shell.history.filterEmpty'))))
  } else {
    scroll.push(h('div', { key: 'list', id: 'vc-history-list', className: 'history-list', role: 'list', 'aria-label': t('vc.shell.history.listLabel') }, rows))
  }
  if (hasMore === true) {
    scroll.push(h('button', {
      key: 'more', type: 'button', className: 'vcs-hist-load-more',
      'data-vc-load-more': '1',
      'aria-controls': 'vc-history-list',
      disabled: model.logState === 'loading' ? true : undefined,
    }, t('vc.shell.history.loadMore', { batch: VC_HISTORY_BATCH })))
  }
  if (model.logState === 'loading') {
    scroll.push(h('span', { key: 'moreLoading', className: 'note vcs-hist-more-state', 'data-vc-history-more-state': 'loading' }, t('vc.shell.history.loadingMore')))
  } else if (model.logState === 'err') {
    scroll.push(h('span', { key: 'moreError', className: 'note vcs-hist-more-state', 'data-vc-history-more-state': 'error' }, t('vc.shell.history.moreError')))
    scroll.push(h('button', { key: 'moreRetry', type: 'button', className: 'vcs-hist-more-retry', 'data-vc-history-more-retry': '1', 'data-press': 'button', 'data-log': 'vc.history.more-retry' }, t('vc.shell.history.moreRetry')))
  }
  if (opts.withGraph === true && model.state === 'ok') {
    scroll.push(vcHistoryGraphNode(h, t, { graph: vcHistoryGraphOf(model.commits), width: width }))
  }
  head.push(h('div', { key: 'scroll', className: 'history-scroll' }, scroll))
  return head
}

// 提交历史页的根：列表与详情整页替换。打开详情时列表留在 DOM 里但整块隐藏 ——
//   门禁要读得到开着的行与详情节点（aria-expanded / aria-controls / id），视觉上只剩详情那一层。
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
  const list = vcHistoryListOf(h, t, { model: model, ui: ui, width: width, nowMs: readAt, withGraph: detail === null })
  const kids: any[] = []
  if (detail) {
    kids.push(h('div', { key: 'listHidden', hidden: true, style: { display: 'none' } }, list))
    kids.push(detail)
  } else {
    for (let i = 0; i < list.length; i += 1) kids.push(list[i])
  }
  return h(React.Fragment, null, kids)
}
