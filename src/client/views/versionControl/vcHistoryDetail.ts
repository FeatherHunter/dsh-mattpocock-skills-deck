// views/versionControl/vcHistoryDetail.ts —— 提交历史详情：整页替换的元信息、文件清单与逐文件差异（#1829 阶段 3）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 这个文件是从 vcHistory.ts 拆出来的：那个文件已经顶到每文件 350 有效行的上限，详情与逐文件差异
//   又是改动最少的一整块，先搬出来给列表重做（搜索、只看合并、日期分组、行菜单）腾地方。
// 详情按定稿原型 docs/prototype/vc-redesign/screenshots/03-commit-detail-460.png 与
//   07-light-commits-460.png 的信息层级画：返回条 → 提交说明全文 → 四行元信息 → 文件清单 → 展开的差异。
// 数据属性名（data-vc-history-detail / data-vc-history-file / data-vc-file-diff / data-vc-diff-line …）
//   是门禁与委托层共用的契约，拆文件时一个都没改；可见文字全部走 t()，不在这一叶写中文字面量。

declare function vcShortOid(...args: any[]): any
declare function vcWhenText(...args: any[]): any
declare function vcOneLine(...args: any[]): any
declare function vcCommitKeyOf(...args: any[]): any

// 逐文件差异块：行类型原样透传成 data-vc-diff-line，样式按 vcs-hist-line-<kind> 上色（门禁断言这两个类名）。
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

// 一行元信息：左侧标签（等宽小字），右侧值。四行是原型里的「提交 / 作者 / 提交时间 / 父提交」。
const vcHistoryMetaRowOf = function (h: any, key: string, label: string, value: any) {
  return h('div', { key: key, className: 'vcs-hist-meta-row' }, [
    h('dt', { key: 'k', className: 'vcs-hist-meta-key' }, label),
    h('dd', { key: 'v', className: 'vcs-hist-meta-value' }, value),
  ])
}

// 文件行右侧的增删行数：读数里没有数字时留空，不拿 0 冒充「没改」。
const vcHistoryFileDeltaOf = function (h: any, file: any) {
  const added = file && file.added !== null && file.added !== undefined ? Number(file.added) : null
  const deleted = file && file.deleted !== null && file.deleted !== undefined ? Number(file.deleted) : null
  const kids: any[] = []
  if (added !== null) kids.push(h('span', { key: 'add', className: 'vcs-hist-delta-add', 'data-vc-file-delta-add': '1' }, '+' + String(added)))
  if (deleted !== null) kids.push(h('span', { key: 'del', className: 'vcs-hist-delta-del', 'data-vc-file-delta-del': '1' }, '−' + String(deleted)))
  return kids
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
  const parents = hit && Array.isArray(hit.parents) ? hit.parents : []
  const fullOid = String((hit && hit.oid) || rev)
  const kids: any[] = []
  kids.push(h('div', { key: 'head', className: 'vcs-hist-detail-head' }, h('button', {
    key: 'back', type: 'button', className: 'vcs-hist-back', 'data-vc-history-back': '1',
    'data-press': 'button', 'data-log': 'vc.history.back',
  }, '‹ ' + t('vc.shell.history.detailBack'))))
  const titleKids: any[] = [h('span', { key: 'subject', className: 'vcs-hist-detail-subject' }, vcOneLine(String((hit && hit.subject) || rev), 160))]
  if (parents.length >= 2) titleKids.push(h('span', { key: 'merge', className: 'vcs-hist-merge', 'data-vc-history-merge': '1' }, t('vc.shell.history.detailMerge')))
  if (parents.length === 0) titleKids.push(h('span', { key: 'root', className: 'vcs-hist-root', 'data-vc-history-root': '1' }, t('vc.shell.history.detailRoot')))
  kids.push(h('h3', { key: 'title', id: 'vc-history-detail-title', className: 'vcs-hist-detail-title' }, titleKids))
  if (hit) {
    const meta: any[] = []
    meta.push(vcHistoryMetaRowOf(h, 'hash', t('vc.shell.history.metaHash'), h('span', { key: 'oid', className: 'vcs-hist-oid' }, vcShortOid(fullOid))))
    meta.push(vcHistoryMetaRowOf(h, 'author', t('vc.shell.history.metaAuthor'), String(hit.author || '')))
    meta.push(vcHistoryMetaRowOf(h, 'when', t('vc.shell.history.metaWhen'), vcWhenText(t, opts.nowMs, hit.authorDateMs)))
    const parentKids: any[] = parents.map(function (oid: any) {
      const one: string = String(oid || '')
      return h('span', { key: 'p-' + one, className: 'vcs-hist-parent' }, vcShortOid(one))
    })
    if (!parentKids.length) parentKids.push(h('span', { key: 'none', className: 'vcs-hist-parent-none' }, t('vc.shell.history.detailParents', { n: 0 })))
    meta.push(vcHistoryMetaRowOf(h, 'parents', t('vc.shell.history.metaParents'), h('span', { key: 'parents', className: 'vcs-hist-parents' }, parentKids)))
    kids.push(h('dl', { key: 'meta', className: 'vcs-hist-meta-box' }, meta))
  }
  kids.push(h('h4', { key: 'filesTitle', className: 'vcs-hist-files-title' }, t('vc.shell.history.filesTitle', { n: files.length })))
  if (detailState === 'loading') {
    kids.push(h('p', { key: 'filesLoading', className: 'vcs-hist-files-state', 'data-vc-history-files-loading': '1' }, t('vc.shell.history.filesLoading')))
  } else if (detailState === 'error') {
    kids.push(h('p', { key: 'filesError', className: 'vcs-hist-files-state', 'data-vc-history-files-error': '1' }, t('vc.shell.history.filesError')))
    kids.push(h('button', { key: 'filesRetry', type: 'button', className: 'vcs-hist-files-retry', 'data-vc-history-files-retry': '1', 'data-press': 'button', 'data-log': 'vc.history.files-retry' }, t('vc.shell.history.filesRetry')))
  } else {
    if (read.truncated === true) kids.push(h('p', { key: 'filesTrunc', className: 'vcs-hist-files-state', 'data-vc-history-files-truncated': '1' }, t('vc.shell.history.filesTruncated')))
    if (!files.length) kids.push(h('p', { key: 'filesEmpty', className: 'vcs-hist-files-state' }, t('vc.shell.history.filesEmpty')))
    else {
      kids.push(h('ul', { key: 'files', className: 'vcs-hist-files' }, files.map(function (file: any, fileIndex: number) {
        const path = String((file && file.path) || '')
        const orig = file && file.origPath ? String(file.origPath) : ''
        return h('li', { key: path, className: 'vcs-hist-file' }, h('button', {
          key: 'open', type: 'button', className: 'vcs-hist-file-open',
          'data-vc-history-file': path,
          'aria-expanded': ui.openFile === path ? 'true' : 'false',
          'aria-label': t('vc.shell.history.openFile', { path: path }),
          'data-press': 'button', 'data-log': 'vc.history.file.' + String(fileIndex),
        }, [
          h('span', { key: 'path', className: 'vcs-hist-file-path' }, [
            orig ? h('span', { key: 'orig', className: 'vcs-hist-file-dir' }, orig + ' → ') : null,
            h('span', { key: 'dir', className: 'vcs-hist-file-dir' }, vcHistoryDirOf(path)),
            h('span', { key: 'name', className: 'vcs-hist-file-name' }, vcHistoryNameOf(path)),
          ]),
          h('span', { key: 'delta', className: 'vcs-hist-file-delta' }, vcHistoryFileDeltaOf(h, file)),
          h('span', { key: 'chev', className: 'vcs-hist-file-chevron' }, '›'),
        ]))
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

// 文件路径拆成目录与文件名：目录灰、文件名亮，与原型一致；没有目录时只画文件名。
const vcHistoryDirOf = function (path: string): string {
  const at: number = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at + 1)
}
const vcHistoryNameOf = function (path: string): string {
  const at: number = path.lastIndexOf('/')
  return at < 0 ? path : path.slice(at + 1)
}
