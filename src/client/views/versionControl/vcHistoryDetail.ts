// views/versionControl/vcHistoryDetail.ts —— 提交历史详情：整页替换的返回条、元信息、文件清单与逐文件差异（#1829 阶段 3；#1860 按原型重排）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 版式照 docs/prototype/vc-redesign/src/ui/views/history.ts 的 renderDetail（定稿 03 / 07 截图）：
//   返回条 → 提交说明 → 四行元信息（提交 / 作者 / 提交时间 / 父提交）→ 文件清单 → 展开的逐文件差异。
// 数据属性名（data-vc-history-detail / data-vc-history-file / data-vc-file-diff / data-vc-diff-line …）
//   是门禁与委托层共用的契约，这一轮一个都没改；只把类名与结构换成原型口径。
// 可见文字全部走 t()，不在这一叶写中文字面量。

declare const React: any
declare function vcShortOid(...args: any[]): any
declare function vcCommitWhenText(...args: any[]): any
declare function vcOneLine(...args: any[]): any
declare function vcCommitKeyOf(...args: any[]): any
declare const vcPageIconOf: (h: any, kind: string, size: number) => any

// 逐文件差异块（原型 .file-detail）：读到了就把逐行差异放进 pre，没读到 / 读失败 / 二进制 / 合并 / 截断各说各的。
//   旧类名 vcs-hist-diff-lines / vcs-hist-diff-line / vcs-hist-line-<kind> 是门禁认的契约，一个都不删。
const vcHistoryFileDiffOf = function (h: any, t: any, o: any) {
  const opts = o || {}
  const read = opts.read || null
  const path = String(opts.path || '')
  const kids: any[] = []
  const note = function (key: string, attr: string, text: string) {
    const attrs: any = { key: key, className: 'note file-detail-note' }
    if (attr !== '') attrs[attr] = '1'
    kids.push(h('p', attrs, text))
  }
  const state: string = read ? String(read.state || 'idle') : 'idle'
  const reason: string = read ? String(read.reason || '') : ''
  if (!read || state === 'idle') {
    note('wait', '', t('vc.shell.history.diffLoading'))
  } else if (state === 'err') {
    note('err', 'data-vc-file-diff-error', t('vc.shell.history.diffError'))
    kids.push(h('button', { key: 'retry', type: 'button', className: 'vcs-hist-diff-retry', 'data-vc-file-diff-retry': '1', 'data-press': 'button', 'data-log': 'vc.history.diff-retry' }, t('vc.shell.history.diffRetry')))
  } else if (state !== 'ok') {
    note('loading', '', t('vc.shell.history.diffLoading'))
  } else if (reason === 'binary-diff') {
    note('binary', 'data-vc-file-diff-binary', t('vc.shell.history.diffBinary'))
  } else if (reason === 'merge-commit') {
    note('merge', 'data-vc-file-diff-merge', t('vc.shell.history.diffMerge'))
  } else {
    if (read.truncated === true) note('trunc', 'data-vc-file-diff-truncated', t('vc.shell.history.diffTruncated'))
    const lines = Array.isArray(read.lines) ? read.lines : []
    if (!lines.length) {
      note('none', '', t('vc.shell.history.diffNoDiff'))
    } else {
      kids.push(h('pre', { key: 'lines', className: 'vcs-hist-diff-lines patch' }, lines.map(function (line: any, i: number) {
        return h('span', {
          key: 'l' + i,
          className: 'vcs-hist-diff-line vcs-hist-line-' + String(line.kind || 'context') + ' diff-line',
          'data-vc-diff-line': String(line.kind || 'context'),
        }, String(line.text || '') + '\n')
      })))
    }
  }
  return h('div', { key: 'diff', className: 'file-detail', 'data-vc-file-diff': path }, kids)
}

// 改动页行里的差异块（#1860 D7）：与上面那一块读同一份读数形状，版式换成原型的 `.diff-*` 行——改动页的
//   原型样式表（vcProtoChanges 那一叶）只认这几个类名，行号也由 CSS 计数器画，所以这里不写 `vcs-hist-*`。
//   五种状态各说各的：读取中 / 读失败带重试 / 二进制 / 没有差异（未跟踪与无基线各一句）/ 太长被截断。
//   为什么单开一份而不改上面那一块：历史详情的行样式是 #1829 定稿、已过审的样子，动它等于改历史页；
//   两块共用同一批词条，只有类名不同。
export const vcChangeFileDiffOf = function (h: any, t: any, o: any) {
  const opts = o || {}
  const read = opts.read || null
  const path = String(opts.path || '')
  const kids: any[] = []
  const note = function (key: string, attr: string, text: string, value?: string) {
    const attrs: any = { key: key, className: 'note file-detail-note' }
    if (attr !== '') attrs[attr] = value === undefined ? '1' : value
    kids.push(h('p', attrs, text))
  }
  const state: string = read ? String(read.state || 'idle') : 'idle'
  const reason: string = read ? String(read.reason || '') : ''
  if (!read || state === 'idle' || state === 'loading') {
    // 状态值原样写进属性（不是只有个标记）：真机那一轮要等「加载中」这一句换成结果再数行数。
    note('loading', 'data-vc-changes-diff-state', t('vc.shell.history.diffLoading'), 'loading')
  } else if (state === 'err') {
    note('err', 'data-vc-changes-diff-error', t('vc.shell.history.diffError'))
    kids.push(h('button', {
      key: 'retry', type: 'button', className: 'vcs-hist-diff-retry', 'data-vc-changes-diff-retry': path,
      'data-press': 'button', 'data-log': 'vc.changes.diff-retry',
      onClick: function () { if (typeof opts.onRetry === 'function') opts.onRetry() },
    }, t('vc.shell.history.diffRetry')))
  } else if (reason === 'binary-diff') {
    note('binary', 'data-vc-changes-diff-binary', t('vc.shell.history.diffBinary'))
  } else if (reason === 'untracked-no-diff') {
    note('untracked', 'data-vc-changes-diff-untracked', t('vc.changes.view.diffUntracked'))
  } else if (reason === 'no-commit-baseline') {
    note('baseline', 'data-vc-changes-diff-baseline', t('vc.changes.view.diffNoBaseline'))
  } else {
    if (read.truncated === true) note('trunc', 'data-vc-changes-diff-truncated', t('vc.shell.history.diffTruncated'))
    const lines = Array.isArray(read.lines) ? read.lines : []
    if (!lines.length) {
      note('none', 'data-vc-changes-diff-none', t('vc.shell.history.diffNoDiff'))
    } else {
      kids.push(h('pre', { key: 'lines', className: 'patch', 'data-vc-changes-diff-lines': '1' }, lines.map(function (line: any, i: number) {
        const kind: string = String(line.kind || 'context')
        return h('code', {
          key: 'l' + i,
          className: 'diff-line ' + (VC_DIFF_LINE_CLASS[kind] || VC_DIFF_LINE_CLASS.context),
          'data-vc-diff-line': kind,
        }, line.text === '' ? ' ' : String(line.text === undefined || line.text === null ? '' : line.text))
      })))
    }
  }
  return h('div', { key: 'diff', className: 'file-detail', 'data-vc-file-diff': path, 'data-vc-changes-diff': path }, kids)
}

// 差异行种类 → 原型类名（docs/prototype/vc-redesign/styles/app.css 的 .diff-*）：改动页的样式表按这几个类名上色。
const VC_DIFF_LINE_CLASS: Record<string, string> = {
  add: 'diff-add', del: 'diff-del', context: 'diff-ctx', hunk: 'diff-hunk', filehead: 'diff-head', 'no-newline': 'diff-note',
}

// 一行元信息：左侧标签（等宽小字），右侧值。四行是原型里的「提交 / 作者 / 提交时间 / 父提交」。
const vcHistoryMetaRowOf = function (h: any, key: string, label: string, value: any) {
  return h('div', { key: key, className: 'meta-row vcs-hist-meta-row' }, [
    h('dt', { key: 'k', className: 'meta-k' }, label),
    h('dd', { key: 'v', className: 'meta-v' }, value),
  ])
}

// 文件行右侧的增删行数：读数里没有数字时留空，不拿 0 冒充「没改」；数字前不加正负号（颜色已经说明加还是删）。
const vcHistoryFileDeltaOf = function (h: any, file: any) {
  const added = file && file.added !== null && file.added !== undefined ? Number(file.added) : null
  const deleted = file && file.deleted !== null && file.deleted !== undefined ? Number(file.deleted) : null
  const kids: any[] = []
  if (added !== null) kids.push(h('span', { key: 'add', className: 'dl-add', 'data-vc-file-delta-add': '1' }, String(added)))
  if (deleted !== null) kids.push(h('span', { key: 'del', className: 'dl-del', 'data-vc-file-delta-del': '1' }, String(deleted)))
  return kids
}

// 详情整页：返回条与滚动区两兄弟（原型 renderDetail 的 .view.view-detail 由页壳那层顶上）。
//   data-vc-history-detail 仍挂在滚动区上：门禁从这里读 detail-state，委托层也从这里认详情。
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
  const parents = hit && Array.isArray(hit.parents) ? hit.parents : []
  const fullOid = String((hit && hit.oid) || rev)
  const headKids: any[] = [h('button', {
    key: 'back', type: 'button', className: 'back-btn', 'data-vc-history-back': '1',
    'data-press': 'button', 'data-log': 'vc.history.back',
  }, [vcPageIconOf(h, 'back', 13), h('span', { key: 'label' }, t('vc.shell.history.detailBack'))])]
  const scrollKids: any[] = []
  const titleAttrs: any = { key: 'title', id: 'vc-history-detail-title', className: 'detail-subject' }
  if (parents.length >= 2) titleAttrs['data-vc-history-merge'] = '1'
  if (parents.length === 0) titleAttrs['data-vc-history-root'] = '1'
  scrollKids.push(h('h2', titleAttrs, vcOneLine(String((hit && hit.subject) || rev), 160)))
  if (hit) {
    const meta: any[] = []
    meta.push(vcHistoryMetaRowOf(h, 'hash', t('vc.shell.history.metaHash'), h('span', { key: 'oid', className: 'mono', 'aria-label': fullOid, title: fullOid }, vcShortOid(fullOid))))
    meta.push(vcHistoryMetaRowOf(h, 'author', t('vc.shell.history.metaAuthor'), String(hit.author || '')))
    meta.push(vcHistoryMetaRowOf(h, 'when', t('vc.shell.history.metaWhen'), vcCommitWhenText(t, opts.nowMs, hit.authorDateMs)))
    const parentKids: any[] = parents.map(function (oid: any) {
      const one: string = String(oid || '')
      return h('span', { key: 'p-' + one, className: 'parent-hash mono', 'aria-label': one, title: one }, vcShortOid(one))
    })
    if (!parentKids.length) parentKids.push(h('span', { key: 'none', className: 'meta-v' }, t('vc.shell.history.detailParents', { n: 0 })))
    meta.push(vcHistoryMetaRowOf(h, 'parents', t('vc.shell.history.metaParents'), h('span', { key: 'parents', className: 'parents' }, parentKids)))
    scrollKids.push(h('dl', { key: 'meta', className: 'detail-meta' }, meta))
  }
  const filesKids: any[] = [h('div', { key: 'title', className: 'detail-files-head' }, t('vc.shell.history.filesTitle', { n: files.length }))]
  const filesNote = function (key: string, attr: string, text: string) {
    const attrs: any = { key: key, className: 'note file-detail-note' }
    if (attr !== '') attrs[attr] = '1'
    filesKids.push(h('p', attrs, text))
  }
  if (detailState === 'loading') {
    filesNote('loading', 'data-vc-history-files-loading', t('vc.shell.history.filesLoading'))
  } else if (detailState === 'error') {
    filesNote('error', 'data-vc-history-files-error', t('vc.shell.history.filesError'))
    filesKids.push(h('button', { key: 'retry', type: 'button', className: 'vcs-hist-files-retry', 'data-vc-history-files-retry': '1', 'data-press': 'button', 'data-log': 'vc.history.files-retry' }, t('vc.shell.history.filesRetry')))
  } else {
    if (read.truncated === true) filesNote('trunc', 'data-vc-history-files-truncated', t('vc.shell.history.filesTruncated'))
    if (!files.length) filesNote('empty', '', t('vc.shell.history.filesEmpty'))
    for (let i = 0; i < files.length; i += 1) {
      const file: any = files[i] || {}
      const path: string = String(file.path || '')
      const expanded: boolean = String(ui.openFile || '') === path
      filesKids.push(h('div', {
        key: 'f-' + path, className: 'file-row commit-file' + (expanded ? ' is-open' : ''),
        role: 'button', tabIndex: 0,
        'data-vc-history-file': path,
        'aria-expanded': expanded ? 'true' : 'false',
        'aria-label': t('vc.shell.history.openFile', { path: path }),
        title: path,
        'data-press': 'button', 'data-log': 'vc.history.file.' + String(i),
      }, [
        h('span', { key: 'path', className: 'file-path' }, [
          h('span', { key: 'dir', className: 'file-dir' }, vcHistoryDirOf(path)),
          h('span', { key: 'name', className: 'file-name' }, vcHistoryNameOf(path)),
        ]),
        h('span', { key: 'delta', className: 'file-delta' }, vcHistoryFileDeltaOf(h, file)),
        h('span', { key: 'chev', className: 'row-chevron' + (expanded ? ' is-open' : ''), 'aria-hidden': 'true' }, vcPageIconOf(h, 'chevron', 12)),
      ]))
      if (expanded) filesKids.push(vcHistoryFileDiffOf(h, t, { path: path, read: (opts.commitDiffs || {})[vcCommitKeyOf(rev, path)] || null }))
    }
  }
  scrollKids.push(h('div', { key: 'files', className: 'detail-files' }, filesKids))
  return h(React.Fragment, { key: 'detail' }, [
    h('div', { key: 'head', className: 'detail-head' }, headKids),
    h('div', {
      key: 'scroll', id: 'vc-history-detail', className: 'detail-scroll',
      'data-vc-history-detail': '1', 'data-vc-form': 'page',
      'data-vc-history-detail-state': detailState,
      role: 'region', 'aria-labelledby': 'vc-history-detail-title',
    }, scrollKids),
  ])
}

// 文件路径拆成目录与文件名：目录灰、文件名亮，与原型一致；没有目录时只画文件名。
const vcHistoryDirOf = function (path: string): string {
  const at: number = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at + 1)
}
const vcHistoryNameOf = function (path: string): string {
  const at: number = path.lastIndexOf('/')
  return at < 0 ? path : path.slice(at + 1)
}
