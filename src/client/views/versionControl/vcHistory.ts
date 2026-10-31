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

// 图形化视图：每条提交画一行，父提交连线落进车道。车道上限 VC_HISTORY_LANES_MAX 条；
//   父提交不在这页里（下一页才读得到）或车道占满时，这条连线不画，并记进 hiddenLanes 如实报数。
export const vcHistoryGraphOf = function (commits: any) {
  const list = Array.isArray(commits) ? commits : []
  const inPage: Record<string, boolean> = {}
  for (let i = 0; i < list.length; i += 1) inPage[String((list[i] && list[i].oid) || '')] = true
  const cols: any[] = []
  for (let i = 0; i < VC_HISTORY_LANES_MAX; i += 1) cols.push(null)
  const freeColOf = function () {
    for (let i = 0; i < VC_HISTORY_LANES_MAX; i += 1) if (cols[i] === null) return i
    return -1
  }
  const colOf = function (oid: string) {
    for (let i = 0; i < VC_HISTORY_LANES_MAX; i += 1) if (cols[i] === oid) return i
    return -1
  }
  const rows: any[] = []
  let hiddenLanes = 0
  for (let r = 0; r < list.length; r += 1) {
    const c = list[r] || {}
    const oid = String(c.oid || '')
    let lane = colOf(oid)
    if (lane < 0) lane = freeColOf()
    if (lane < 0) { lane = VC_HISTORY_LANES_MAX - 1; hiddenLanes += 1 }
    cols[lane] = null
    const parentList = Array.isArray(c.parents) ? c.parents : []
    const edges: number[] = []
    for (let p = 0; p < parentList.length; p += 1) {
      const poid = String(parentList[p])
      // 父提交在这一页里没有对应行（还没读到）时，不画一条凭空断掉的线，只记一处没画。
      if (inPage[poid] !== true) { hiddenLanes += 1; continue }
      let at = colOf(poid)
      if (at < 0) {
        const target = p === 0 && cols[lane] === null ? lane : freeColOf()
        if (target >= 0) { at = target; cols[target] = poid } else hiddenLanes += 1
      }
      if (at >= 0) edges.push(at)
    }
    rows.push({
      oid: oid,
      short: String(c.short || vcShortOid(oid)),
      subject: String(c.subject || ''),
      author: String(c.author || ''),
      authorDateMs: c.authorDateMs,
      parents: parentList.slice(),
      edges: edges,
      lane: lane,
    })
  }
  return { rows: rows, hiddenLanes: hiddenLanes, lanes: VC_HISTORY_LANES_MAX, external: false }
}

const vcHistoryPlusMinusOf = function (file: any) {
  const added = file && file.added !== null && file.added !== undefined ? '+ ' + String(file.added) : ''; const deleted = file && file.deleted !== null && file.deleted !== undefined ? '− ' + String(file.deleted) : ''
  return (added + ' ' + deleted).trim()
}

export const vcHistoryRowNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const c = opts.commit || {}
  const width = vcHistoryWidthOf(opts.width)
  const subject = vcOneLine(String(c.subject || ''), width >= 380 ? 90 : 56)
  const kids: any[] = [h('span', { key: 'subject', className: 'vcs-hist-subject' }, subject)]
  if (width >= 380) kids.push(h('span', { key: 'short', className: 'vcs-hist-short', 'data-vc-history-short': '1' }, String(c.short || vcShortOid(c.oid))))
  if (width >= 460) {
    kids.push(h('span', { key: 'author', className: 'vcs-hist-author', 'data-vc-history-author': '1' }, String(c.author || '')))
    kids.push(h('span', { key: 'when', className: 'vcs-hist-when', 'data-vc-history-when': '1' }, vcWhenText(t, opts.nowMs, c.authorDateMs)))
  }
  const attrs: any = {
    key: 'open',
    type: 'button',
    className: 'vcs-hist-open',
    'data-vc-history-open': String(c.oid || ''),
    'aria-expanded': opts.expanded === true ? 'true' : 'false',
    'aria-controls': 'vc-history-detail',
    title: t('vc.shell.history.open', { subject: vcOneLine(String(c.subject || ''), 120) }),
  }
  return h('li', { key: String(c.oid || ''), className: 'vcs-hist-row', 'data-vc-history-row': String(c.oid || '') }, h('button', attrs, kids))
}

export const vcHistoryListOf = function (h: any, t: any, o: any) {
  const opts = o || {}
  const model = opts.model || {}
  const commits = Array.isArray(model.commits) ? model.commits : []
  const rows: any[] = []
  for (let i = 0; i < commits.length; i += 1) {
    rows.push(vcHistoryRowNode(h, t, {
      commit: commits[i],
      width: opts.width,
      nowMs: opts.nowMs,
      expanded: String((commits[i] && commits[i].oid) || '') === String(model.openCommit || ''),
    }))
  }
  const kids: any[] = [h('ol', {
    key: 'list',
    id: 'vc-history-list',
    className: 'vcs-hist-list',
    role: 'list',
    'aria-label': t('vc.shell.history.listLabel'),
  }, rows)]
  const hasMore = model.hasMore === true
  if (hasMore === true) {
    kids.push(h('button', {
      key: 'more',
      type: 'button',
      className: 'vcs-hist-more',
      'data-vc-load-more': '1',
      'aria-controls': 'vc-history-list',
      disabled: model.logState === 'loading' ? true : undefined,
    }, t('vc.shell.history.loadMore', { batch: VC_HISTORY_BATCH })))
  }
  if (model.logState === 'loading') {
    kids.push(h('span', { key: 'moreLoading', className: 'vcs-hist-more-state', 'data-vc-history-more-state': 'loading' }, t('vc.shell.history.loadingMore')))
  } else if (model.logState === 'err') {
    kids.push(h('span', { key: 'moreError', className: 'vcs-hist-more-state', 'data-vc-history-more-state': 'error' }, t('vc.shell.history.moreError')))
    kids.push(h('button', { key: 'moreRetry', type: 'button', className: 'vcs-hist-more-retry', 'data-vc-history-more-retry': '1' }, t('vc.shell.history.moreRetry')))
  }
  const attrs: any = { key: 'wrap', className: 'vcs-hist-list-wrap' }
  if (opts.hidden === true) attrs.hidden = true
  return h('div', attrs, kids)
}

const vcHistoryFileDiffOf = function (h: any, t: any, o: any) {
  const opts = o || {}
  const read = opts.read || null
  const path = String(opts.path || '')
  const kids: any[] = [h('h5', { key: 'title', className: 'vcs-hist-diff-title' }, t('vc.shell.history.diffTitle', { path: path }))]
  if (!read) {
    kids.push(h('p', { key: 'wait', className: 'vcs-hist-diff-state' }, t('vc.shell.history.diffLoading'))); return h('div', { key: 'diff', className: 'vcs-hist-diff', 'data-vc-file-diff': path }, kids)
  }
  if (read.state === 'err') {
    kids.push(h('p', { key: 'err', className: 'vcs-hist-diff-state', 'data-vc-file-diff-error': '1' }, t('vc.shell.history.diffError'))); kids.push(h('button', { key: 'retry', type: 'button', className: 'vcs-hist-diff-retry', 'data-vc-file-diff-retry': '1' }, t('vc.shell.history.diffRetry'))); return h('div', { key: 'diff', className: 'vcs-hist-diff', 'data-vc-file-diff': path }, kids)
  }
  if (read.state !== 'ok') {
    kids.push(h('p', { key: 'loading', className: 'vcs-hist-diff-state' }, t('vc.shell.history.diffLoading'))); return h('div', { key: 'diff', className: 'vcs-hist-diff', 'data-vc-file-diff': path }, kids)
  }
  const reason = String(read.reason || '')
  if (reason === 'binary-diff') kids.push(h('p', { key: 'binary', className: 'vcs-hist-diff-state', 'data-vc-file-diff-binary': '1' }, t('vc.shell.history.diffBinary')))
  else if (reason === 'merge-commit') kids.push(h('p', { key: 'merge', className: 'vcs-hist-diff-state', 'data-vc-file-diff-merge': '1' }, t('vc.shell.history.diffMerge')))
  else {
    if (read.truncated === true) kids.push(h('p', { key: 'trunc', className: 'vcs-hist-diff-state', 'data-vc-file-diff-truncated': '1' }, t('vc.shell.history.diffTruncated')))
    const lines = Array.isArray(read.lines) ? read.lines : []
    if (!lines.length) kids.push(h('p', { key: 'none', className: 'vcs-hist-diff-state' }, t('vc.shell.history.diffNoDiff')))
    else {
      kids.push(h('pre', { key: 'lines', className: 'vcs-hist-diff-lines' }, lines.map(function (line: any, i: number) {
        return h('span', { key: 'l' + i, className: 'vcs-hist-diff-line vcs-hist-line-' + String(line.kind || 'context'), 'data-vc-diff-line': String(line.kind || 'context') }, String(line.text || '') + '\n')
      })))
    }
  }
  return h('div', { key: 'diff', className: 'vcs-hist-diff', 'data-vc-file-diff': path }, kids)
}

export const vcHistoryDetailOf = function (h: any, t: any, o: any) {
  const opts = o || {}
  const ui = opts.ui || {}
  const model = opts.model || {}
  const read = opts.commit || {}
  const rev = String(ui.openCommit || '')
  const hit = (Array.isArray(model.commits) ? model.commits : []).filter(function (c: any) { return String((c && c.oid) || '') === rev })[0] || null
  const state = String(read.state || 'idle')
  const detailState = state === 'ok' ? 'ok' : (state === 'err' ? 'error' : 'loading')
  const files = Array.isArray(read.files) ? read.files : []
  const kids: any[] = []
  kids.push(h('button', { key: 'back', type: 'button', className: 'vcs-hist-back', 'data-vc-history-back': '1' }, t('vc.shell.history.detailBack')))
  kids.push(h('h3', { key: 'title', id: 'vc-history-detail-title', className: 'vcs-hist-detail-title' }, t('vc.shell.history.detailTitle') + '：' + vcOneLine(String((hit && hit.subject) || rev), 120)))
  if (hit) {
    const parents = Array.isArray(hit.parents) ? hit.parents : []
    kids.push(h('p', { key: 'meta', className: 'vcs-hist-detail-meta' }, [
      h('span', { key: 'author', 'data-vc-history-author': '1' }, t('vc.shell.history.detailAuthor', { author: String(hit.author || '') })),
      h('span', { key: 'when' }, t('vc.shell.history.detailWhen', { when: vcWhenText(t, opts.nowMs, hit.authorDateMs) })),
      h('span', { key: 'parents' }, t('vc.shell.history.detailParents', { n: parents.length })),
    ]))
    if (parents.length >= 2) kids.push(h('p', { key: 'merge', className: 'vcs-hist-detail-flag', 'data-vc-history-merge': '1' }, t('vc.shell.history.detailMerge')))
    if (parents.length === 0) kids.push(h('p', { key: 'root', className: 'vcs-hist-detail-flag', 'data-vc-history-root': '1' }, t('vc.shell.history.detailRoot')))
  }
  kids.push(h('h4', { key: 'filesTitle', className: 'vcs-hist-files-title' }, t('vc.shell.history.filesTitle', { n: files.length })))
  if (detailState === 'loading') {
    kids.push(h('p', { key: 'filesLoading', className: 'vcs-hist-files-state', 'data-vc-history-files-loading': '1' }, t('vc.shell.history.filesLoading')))
  } else if (detailState === 'error') {
    kids.push(h('p', { key: 'filesError', className: 'vcs-hist-files-state', 'data-vc-history-files-error': '1' }, t('vc.shell.history.filesError')))
    kids.push(h('button', { key: 'filesRetry', type: 'button', className: 'vcs-hist-files-retry', 'data-vc-history-files-retry': '1' }, t('vc.shell.history.filesRetry')))
  } else {
    if (read.truncated === true) kids.push(h('p', { key: 'filesTrunc', className: 'vcs-hist-files-state', 'data-vc-history-files-truncated': '1' }, t('vc.shell.history.filesTruncated')))
    if (!files.length) kids.push(h('p', { key: 'filesEmpty', className: 'vcs-hist-files-state' }, t('vc.shell.history.filesEmpty')))
    else {
      kids.push(h('ul', { key: 'files', className: 'vcs-hist-files' }, files.map(function (file: any) {
        const path = String((file && file.path) || '')
        const orig = file && file.origPath ? String(file.origPath) : ''
        const label = (orig ? orig + ' → ' : '') + path + ' ' + vcHistoryPlusMinusOf(file)
        return h('li', { key: path, className: 'vcs-hist-file' }, h('button', {
          key: 'open', type: 'button', className: 'vcs-hist-file-open',
          'data-vc-history-file': path,
          'aria-expanded': ui.openFile === path ? 'true' : 'false',
          title: t('vc.shell.history.openFile', { path: path }),
        }, label))
      })))
    }
    const openFile = String(ui.openFile || '')
    if (openFile && detailState === 'ok') {
      kids.push(vcHistoryFileDiffOf(h, t, {
        path: openFile,
        read: (opts.commitDiffs || {})[vcCommitKeyOf(rev, openFile)] || null,
      }))
    }
  }
  return h('section', {
    key: 'detail',
    id: 'vc-history-detail',
    className: 'vcs-hist-detail',
    'data-vc-history-detail': '1',
    'data-vc-form': 'page',
    'data-vc-history-detail-state': detailState,
    role: 'region',
    'aria-labelledby': 'vc-history-detail-title',
  }, kids)
}

export const vcHistoryGraphNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const width = vcHistoryWidthOf(opts.width)
  const graph = opts.graph || { rows: [], hiddenLanes: 0 }
  const rows = Array.isArray(graph.rows) ? graph.rows : []
  const kids: any[] = [
    h('h4', { key: 'title', className: 'vcs-hist-graph-title' }, t('vc.shell.history.graphTitle')),
    h('p', { key: 'note', className: 'vcs-hist-graph-note' }, t('vc.shell.history.graphNote')),
  ]
  if (graph.hiddenLanes > 0) kids.push(h('p', { key: 'capped', className: 'vcs-hist-graph-capped', 'data-vc-graph-lanes-capped': '1' }, t('vc.shell.history.graphCapped', { n: graph.hiddenLanes })))
  if (width < 380) {
    kids.push(h('p', { key: 'narrow', className: 'vcs-hist-graph-narrow', 'data-vc-graph-narrow': '1' }, t('vc.shell.history.graphNarrow', { n: VC_HISTORY_LANES_MAX, m: rows.length })))
  } else {
    kids.push(h('ol', { key: 'rows', className: 'vcs-hist-graph-rows', role: 'list' }, rows.map(function (row: any) {
      const lane = Math.max(0, Math.min(VC_HISTORY_LANES_MAX - 1, Number(row.lane) || 0))
      return h('li', { key: String(row.oid || ''), className: 'vcs-hist-graph-row', 'data-vc-graph-row': String(row.oid || '') }, [
        h('span', { key: 'lane', className: 'vcs-hist-graph-lane', 'data-vc-graph-lane': String(lane) }, String(lane + 1)),
        h('span', { key: 'subject', className: 'vcs-hist-graph-subject' }, vcOneLine(String(row.subject || ''), 60)),
      ])
    })))
  }
  return h('section', {
    key: 'graph',
    className: 'vcs-hist-graph',
    'data-vc-graph': '1',
    'data-vc-graph-source': 'panel',
    role: 'img',
    'aria-label': t('vc.shell.history.graphLabel'),
  }, kids)
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
  kids.push(h('div', { key: 'head', className: 'vcs-hist-head' }, [
    h('h3', { key: 'title', className: 'vcs-hist-title' }, t('vc.shell.history.title')),
    h('span', { key: 'loaded', className: 'vcs-hist-loaded' }, t('vc.shell.history.loaded', { n: model.loaded })),
    h('span', { key: 'budget', className: 'vcs-hist-budget' }, t('vc.shell.history.budget', { first: VC_HISTORY_BATCH, batch: VC_HISTORY_BATCH })),
  ]))
  if (model.state === 'loading') {
    kids.push(h('p', { key: 'loading', className: 'vcs-hist-state', 'data-vc-history-loading': '1' }, t('vc.shell.history.loading')))
  } else if (model.state === 'error') {
    kids.push(h('p', { key: 'error', className: 'vcs-hist-state', 'data-vc-history-error': '1' }, t('vc.shell.history.error')))
    if (model.error && model.error.message) kids.push(h('p', { key: 'errorDetail', className: 'vcs-hist-error-detail' }, t('vc.shell.history.errorDetail', { msg: String(model.error.message) })))
    kids.push(h('button', { key: 'retry', type: 'button', className: 'vcs-hist-retry', 'data-vc-history-retry': 'history' }, t('vc.shell.history.retry')))
  } else if (model.state === 'empty') {
    kids.push(h('p', { key: 'empty', className: 'vcs-hist-state', 'data-vc-history-empty': '1' }, t('vc.shell.history.empty')))
    kids.push(h('p', { key: 'next', className: 'vcs-hist-next', 'data-vc-history-next': '1' }, t('vc.shell.history.emptyNext')))
  } else {
    kids.push(vcHistoryListOf(h, t, { model: model, width: width, nowMs: readAt, hidden: !!detail }))
  }
  if (detail) kids.push(detail)
  kids.push(vcHistoryGraphNode(h, t, { graph: vcHistoryGraphOf(model.commits), width: width }))
  return h('section', {
    className: 'vcs-history',
    'data-vc-history': '1',
    'data-vc-history-state': model.state,
    'data-vc-history-count': String(model.loaded),
  }, kids)
}
