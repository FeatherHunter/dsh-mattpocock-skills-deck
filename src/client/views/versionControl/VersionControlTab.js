// views/versionControl/VersionControlTab.js — 「版本管理」页签的内容区（#818 的入口组件）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回 src/client/index.js
//   的 leaf 标记处（一源两物）。壳层（panel/Dock.js）按 h(VersionControlTab, { st, narrow }) 调它。
//
// 这一层只做三件事：把宽度与展开状态收起来、按 vcFold.js 的阶梯算该画什么、把 vcBlocks.js 给的
//   块清单画成 DOM。所有判定与措辞都在那两个纯函数文件里，这里一个中文字面量都没有。
// 颜色只走主题变量（--dsw-alias-*），浅色深色都跟着主题走；新加的六种变化色由下面的 VC_TONE
//   映射到语义令牌，纯规则层只给「success / warning / error / accent / caption」这几个色档名。
// 定时器：一个都没有（既不自续也不排一次性）；宽度靠 ResizeObserver，提交续读靠
//   IntersectionObserver，两者都在卸载时断开（#709 的「后台零定时器」那条不变量照旧）。
export const VC_TONE = {
  success: 'var(--dsw-alias-state-success-primary,#4ade80)',
  warning: 'var(--dsw-alias-state-warning-primary,#f59e0b)',
  error: 'var(--dsw-alias-state-error-primary,#f87171)',
  accent: 'var(--dsw-alias-interactive-bg-primary,#c084fc)',
  caption: 'var(--dsw-alias-label-caption,#8b8b95)',
  primary: 'var(--dsw-alias-label-primary,#e6edf3)',
}
export const VersionControlTab = function (props) {
  // 壳层还传了 narrow（面板窄于 380 的那一档），本页签不读它：这一页的让位按自己量到的
  //   可用宽度走（vcFold.js 那条阶梯），比整面板一个布尔更准；留着这个入参是为了与壳层调用形状一致。
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const st = props && props.st
  const cwd = st && st.cwd ? String(st.cwd) : ''
  const [reads, setReads] = React.useState(vcNewReads)
  const [ui, setUi] = React.useState(function () { return { fileShown: {}, openDiff: '' } })
  const [width, setWidth] = React.useState(0)
  const [tier, setTier] = React.useState(0)
  const lastWidthRef = React.useRef(0)
  const rootRef = React.useRef(null)
  const moreRef = React.useRef(null)
  const readsRef = React.useRef(reads)
  readsRef.current = reads
  const callHost = function (method, args) {
    if (typeof host === 'undefined' || !host || typeof host.call !== 'function') return Promise.resolve({ ok: false, error: { kind: 'shape', message: '' } })
    return host.call(method, args)
  }
  const screenOf = function (r) { return (r && r.screen && r.screen.data) ? r.screen.data.screen : null }
  // 空 cwd 一律不读：宿主对空串会退回它自己的默认目录，那样画出来的是插件自己那个仓库的数据。
  const cwdEmpty = !vcShouldRead(cwd)
  // 面板每次切进这个页签都会重新挂载，所以这一次就是规格说的「面板打开」那一次读取。
  React.useEffect(function () {
    if (!cwd) return
    let alive = true
    vcReadStatus(readsRef.current, callHost, cwd).then(function (next) { if (alive) setReads(next) })
    return function () { alive = false }
  }, [cwd])
  // 宽度：量的是本页签自己的内容宽（Dock 的内容区左右各 12 像素内边距已经在外面扣掉了）。
  React.useEffect(function () {
    const el = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(function (entries) {
      try {
        const w = Math.round(entries[0].contentRect.width)
        // 只有宽度真的变了才把档号归零重走一遍：同一个宽度被反复回调时也归零，会让某一档来回切
        //   （真机反馈里那种「抖一下」）。量不到就什么都不动，按最宽的样子画。
        if (lastWidthRef.current === w) return
        lastWidthRef.current = w
        setTier(0)
        setWidth(w)
      } catch (e) { /* 忽略 */ }
    })
    ro.observe(el)
    return function () { try { ro.disconnect() } catch (e) { /* 忽略 */ } }
  }, [])
  const screen = screenOf(reads)
  const foldData = vcFoldDataOf(screen, reads)
  const fold = vcFoldOf(width, foldData)
  const foldState = vcFoldStateAt(fold.ladder, tier)
  const contentKey = (screen ? String(screen.commits ? screen.commits.length : 0) : '-') + '|' + String(reads.log.commits ? reads.log.commits.length : 0) + '|' + String(ui.openDiff || '') + '|' + String(ui.openCommit || '') + '|' + String(screen ? screen.stagedCount + screen.unstagedCount : -1)
  // 逐字让位：先画第 0 档，量到自己这一块放不下就把档号加一（照 panel/Dock.js 头部那台折叠机）。
  React.useLayoutEffect(function () {
    const el = rootRef.current
    if (!el || tier >= fold.ladder.steps.length) return
    try { if (el.scrollWidth > el.clientWidth + 1) setTier(tier + 1) } catch (e) { /* 忽略 */ }
  }, [tier, width, contentKey])
  const commitCount = (screen && Array.isArray(screen.commits) ? screen.commits.length : 0) + (reads.log.commits ? reads.log.commits.length : 0)
  const loadMore = function () {
    if (readsRef.current.log.state === 'loading') return
    const skip = vcNextSkipOf(screenOf(readsRef.current), readsRef.current.log)
    vcReadMoreCommits(readsRef.current, callHost, cwd, skip).then(function (next) { setReads(next) })
  }
  // 滚到底自动接着读更早的提交（规格第 37 条）；浏览器没有这个观察器时，那一行仍然可以点。
  React.useEffect(function () {
    const el = moreRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(function (entries) { if (entries[0] && entries[0].isIntersecting) loadMore() })
    io.observe(el)
    return function () { try { io.disconnect() } catch (e) { /* 忽略 */ } }
  }, [commitCount, reads.log.state, reads.log.hasMore, fold.commitsCollapsed])
  const blocks = vcBlocksOf(screen, reads, ui, { t: tr, nowMs: Date.now(), cwdEmpty: cwdEmpty, fold: Object.assign({}, fold, { state: foldState }) })
  const tone = function (name) { return VC_TONE[name] || VC_TONE.primary }
  const retryScreen = function () { vcReadStatus(readsRef.current, callHost, cwd).then(function (next) { setReads(next) }) }
  // 就地看差异：未提交那一层按路径当键，提交那一层按「修订号 + 路径」当键（同一个文件在两处的补丁是两回事）。
  const diffKeyOf = function (row) { const rev = String(ui.openCommit || ''); return rev ? vcCommitKeyOf(rev, row.path) : String(row.path || '') }
  const loadDiff = function (row) {
    const rev = String(ui.openCommit || '')
    return rev ? vcReadCommitFileDiff(readsRef.current, callHost, cwd, rev, row.path) : vcReadDiff(readsRef.current, callHost, cwd, row.path, row.untracked === true)
  }
  const entryOf = function (row) {
    const rev = String(ui.openCommit || '')
    return rev ? (((readsRef.current.commitDiffs || {})[diffKeyOf(row)]) || { state: 'idle' }) : vcReadsOf(readsRef.current, row.path)
  }
  const toggleDiff = function (row) {
    const key = diffKeyOf(row)
    if (ui.openDiff === key) { setUi(Object.assign({}, ui, { openDiff: '' })); return }
    setUi(Object.assign({}, ui, { openDiff: key }))
    if (entryOf(row).state === 'ok') return
    loadDiff(row).then(function (next) { setReads(next) })
  }
  const retryDiff = function (row) { loadDiff(row).then(function (next) { setReads(next) }) }
  // 提交行点开：进入「这笔提交改了什么」（规格故事 32）；再点一次「回到未提交改动」回到原来那一层。
  const openCommit = function (c) {
    const rev = String(c.key || '')
    setUi(Object.assign({}, ui, { openCommit: rev, openDiff: '' }))
    const entry = readsRef.current.commit || {}
    if (entry.rev === rev && (entry.state === 'ok' || entry.state === 'loading')) return
    vcReadCommitFiles(readsRef.current, callHost, cwd, rev).then(function (next) { setReads(next) })
  }
  const closeCommit = function () { setUi(Object.assign({}, ui, { openCommit: '', openDiff: '' })) }
  const retryCommit = function () {
    const rev = String(ui.openCommit || '')
    if (!rev) return
    vcReadCommitFiles(readsRef.current, callHost, cwd, rev).then(function (next) { setReads(next) })
  }
  const moreFiles = function (groupKey) {
    const cur = Number(ui.fileShown[groupKey]) || VC_FILE_ROWS_FIRST
    const next = Object.assign({}, ui.fileShown)
    next[groupKey] = cur + VC_FILE_ROWS_BATCH
    setUi(Object.assign({}, ui, { fileShown: next }))
  }
  const tipNode = function (content, child) { return content ? h(Tip, { content: content }, child) : child }
  const button = function (label, onClick) { return h('button', { className: 'dsws-btn', type: 'button', onClick: onClick, style: { fontSize: 11, padding: '1px 8px', flex: 'none' } }, label) }
  const diffLine = function (l, i) {
    const kind = l && l.kind ? String(l.kind) : 'context'
    const raw = l && l.text !== undefined ? String(l.text) : ''
    let body = raw
    let col = tone('primary')
    if (kind === 'add') { body = raw.slice(1); col = tone('success') }
    else if (kind === 'del') { body = raw.slice(1); col = tone('error') }
    else if (kind === 'context') { body = raw.slice(1); col = tone('caption') }
    else if (kind === 'hunk') { col = tone('accent') }
    else if (kind === 'filehead') { col = tone('caption') }
    return h('div', { key: i, 'data-vc-line': kind, style: { color: col, whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, body)
  }
  const diffNode = function (row) {
    const d = row.diff
    if (!d) return null
    if (d.state !== 'ok') return h('div', { 'data-vc-diff': d.state, style: { marginTop: 4, fontSize: 11, color: tone('caption'), display: 'flex', gap: 6, alignItems: 'center' } }, [
      h('span', null, d.text), d.retry ? button(d.retry, function () { retryDiff(row) }) : null,
    ])
    return h('div', { 'data-vc-diff': 'lines', style: { marginTop: 4, border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 6, padding: '4px 6px', background: 'var(--dsw-alias-bg-layer-3,#0c0e12)', fontFamily: 'Consolas,Menlo,monospace', fontSize: 11, maxHeight: 320, overflow: 'auto' } }, [
      d.hunks.length ? h('div', { 'data-vc-hunks': 1, style: { marginBottom: 4 } }, [h('div', { style: { color: tone('caption') } }, d.hunksTitle)].concat(d.hunks.map(function (s, i) { return h('div', { key: i, style: { color: tone('accent') } }, s) }))) : null,
      d.lines.map(diffLine),
      d.shownNote ? h('div', { style: { color: tone('caption'), marginTop: 4 } }, d.shownNote) : null,
    ])
  }
  const fileRow = function (row) {
    const open = ui.openDiff === diffKeyOf(row)
    return h('div', { key: row.path, 'data-vc-file': 1, 'data-vc-open': open ? 1 : undefined, style: { borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)' } }, [
      h('div', { onClick: function () { toggleDiff(row) }, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', cursor: 'pointer', fontSize: 11 } }, [
        h('span', { 'data-vc-change': 1, style: { flex: 'none', width: 34, color: tone(row.changeTone), fontWeight: 700 } }, row.changeText),
        tipNode(row.rowTip + (row.origPath ? '\n' + row.origPath : ''), h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.pathText)),
        row.conflict ? h('span', { style: { flex: 'none', fontSize: 10, color: tone('warning'), border: '1px solid ' + tone('warning'), borderRadius: 4, padding: '0 4px' } }, row.conflictText) : null,
        row.countsText ? h('span', { style: { flex: 'none', color: tone('caption'), fontVariantNumeric: 'tabular-nums' } }, row.countsText) : null,
      ]),
      diffNode(row),
    ])
  }
  const groupNode = function (g) {
    return h('div', { key: g.key, 'data-vc-group': g.key }, [
      h('div', { style: { margin: '8px 0 2px', fontSize: 11, color: tone('caption'), display: 'flex', alignItems: 'center', gap: 6 } }, g.title),
      g.rows.map(fileRow),
      g.moreCount > 0 ? h('div', { onClick: function () { moreFiles(g.key) }, style: { padding: '3px 0', fontSize: 11, color: tone('accent'), cursor: 'pointer' } }, g.moreLabel) : null,
    ])
  }
  const node = function (b) {
    if (b.kind === 'hint') return h('div', { key: b.key, 'data-vc-hint': 1, style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: tone(b.tone), background: 'var(--dsw-alias-bg-layer-2,#16181d)', borderRadius: 6, padding: '4px 8px' } }, [h('span', { style: { flex: 1 } }, b.text), b.retry ? button(b.retry, retryScreen) : null])
    if (b.kind === 'error') return h('div', { key: b.key, 'data-vc-error': 1, style: { border: '1px dashed var(--dsw-alias-border-l2,#3a3f4a)', borderRadius: 10, padding: '18px 14px', textAlign: 'center', fontSize: 12, color: tone(b.tone) } }, [
      // 可见正文只有一句按种类映射出来的词条句；宿主原话（中文）只进悬停，英文界面上不会串出中文。
      tipNode(b.rawTip, h('div', { style: { lineHeight: 1.7 } }, b.text)),
      b.retry ? h('div', { style: { marginTop: 10 } }, button(b.retry, retryScreen)) : null,
    ])
    if (b.kind === 'band') return h('div', { key: b.key, 'data-vc-band': 1, style: { display: 'flex', flexDirection: 'column', gap: 4 } }, b.items.map(function (it, i) {
      return h('div', { key: i, 'data-vc-band-item': it.key, style: { fontSize: 11, color: tone(it.tone), background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 6, padding: '4px 8px', lineHeight: 1.6 } }, tipNode(it.tip, h('span', null, it.text)))
    }))
    if (b.kind === 'identity') return h('div', { key: b.key, 'data-vc-identity': 1, style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 } }, [
        tipNode(b.nameTip, h('span', { 'data-vc-worktree': 1, style: { fontSize: 13, fontWeight: 700, color: tone('primary'), whiteSpace: 'nowrap' } }, b.name)),
        tipNode(b.detached ? b.oidTip : b.branchText, h('span', { 'data-vc-branch': 1, style: { fontSize: 13, fontWeight: 700, color: tone(b.branchTone), whiteSpace: 'nowrap' } }, b.branchText)),
        b.oidText ? h('span', { style: { fontSize: 11, color: tone('caption'), whiteSpace: 'nowrap' } }, b.oidText) : null,
      ]),
      h('div', { 'data-vc-path': 1, style: { fontSize: 11, color: tone('caption'), whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0 } }, tipNode(b.pathTip, h('span', null, b.pathText))),
      h('div', { 'data-vc-sync': 1, style: { fontSize: 11, color: tone('primary'), display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' } }, [
        tipNode(b.sync.tip, h('span', null, b.sync.text)),
        b.sync.basis ? tipNode(b.sync.basisTip, h('span', { 'data-vc-basis': 1, style: { color: tone('caption') } }, b.sync.basis)) : null,
      ]),
    ])
    if (b.kind === 'changes') return h('div', { key: b.key, 'data-vc-changes': 1, 'data-vc-commit-mode': b.commitMode ? 1 : undefined }, [
      // 「这笔提交改了什么」这一层（规格故事 32）：出路摆在最上面，别让用户找不到回去的路。
      b.back ? h('div', { 'data-vc-back': 1, onClick: closeCommit, style: { fontSize: 11, color: tone('accent'), cursor: 'pointer', marginBottom: 4 } }, b.back) : null,
      h('div', { style: { fontSize: 12, fontWeight: 700, color: tone('primary') } }, b.title),
      h('div', { 'data-vc-summary': 1, style: { fontSize: 11, color: tone('primary'), marginTop: 2 } }, b.summary),
      b.note ? h('div', { 'data-vc-note': 1, style: { fontSize: 11, color: tone('caption'), marginTop: 4, lineHeight: 1.6 } }, b.note) : null,
      b.retry ? h('div', { style: { marginTop: 6 } }, button(b.retry, retryCommit)) : null,
      b.empty ? h('div', { style: { fontSize: 11, color: tone('caption'), marginTop: 4 } }, b.emptyText) : null,
      b.groups.map(groupNode),
    ])
    if (b.kind === 'commits') return h('div', { key: b.key, 'data-vc-commits': 1 }, [
      h('div', { style: { fontSize: 12, fontWeight: 700, color: tone('primary') } }, b.title),
      b.collapsed ? h('div', { style: { fontSize: 11, color: tone('caption'), marginTop: 2 } }, b.collapseText) : null,
      b.empty && !b.collapsed ? h('div', { style: { fontSize: 11, color: tone('caption'), marginTop: 2 } }, b.emptyText) : null,
      b.rows.map(function (c, i) {
        return h('div', { key: c.key, 'data-vc-commit': 1, 'data-vc-commit-open': c.open ? 1 : undefined, onClick: function () { openCommit(c) }, style: { display: 'flex', alignItems: 'baseline', gap: 6, padding: '2px 0', fontSize: 11, cursor: 'pointer', borderTop: i ? '1px solid var(--dsw-alias-border-l1,#2a2d35)' : 'none', background: c.open ? 'var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.14))' : undefined, borderRadius: c.open ? 4 : undefined } }, [
          h('span', { style: { flex: 'none', color: tone('caption'), fontVariantNumeric: 'tabular-nums' } }, c.when),
          tipNode(c.tip, h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tone('primary') } }, c.subject)),
          h('span', { style: { flex: 'none', color: tone('caption'), fontFamily: 'Consolas,Menlo,monospace' } }, c.short),
        ])
      }),
      b.more.show ? h('div', { ref: moreRef, 'data-vc-more': 1, onClick: loadMore, style: { padding: '3px 0', fontSize: 11, color: tone('accent'), cursor: 'pointer' } }, b.more.label) : null,
      b.more.allLoaded ? h('div', { style: { padding: '3px 0', fontSize: 11, color: tone('caption') } }, b.more.allLoaded) : null,
      b.more.failText ? h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: tone('error') } }, [h('span', null, b.more.failText), b.more.retry ? button(b.more.retry, loadMore) : null]) : null,
    ])
    if (b.kind === 'other') return h('div', { key: b.key, 'data-vc-other': 1 }, [
      tipNode(b.tip, h('div', { style: { fontSize: 12, fontWeight: 700, color: tone('primary') } }, b.title)),
      b.empty ? h('div', { style: { fontSize: 11, color: tone('caption'), marginTop: 2 } }, b.emptyText) : null,
      b.mode === 'summary' && !b.empty ? h('div', { 'data-vc-other-summary': 1, style: { fontSize: 11, color: tone('caption'), marginTop: 2 } }, b.summaryText) : null,
      b.rows.map(function (w, i) {
        return h('div', { key: w.key, 'data-vc-other-row': 1, style: { display: 'flex', alignItems: 'baseline', gap: 6, padding: '2px 0', fontSize: 11, borderTop: i ? '1px solid var(--dsw-alias-border-l1,#2a2d35)' : 'none' } }, [
          tipNode(w.displayTip, h('span', { style: { flex: 'none', color: tone('primary'), whiteSpace: 'nowrap' } }, w.displayText)),
          h('span', { style: { flex: 'none', color: tone('caption'), whiteSpace: 'nowrap' } }, w.branchText),
          w.stateText ? tipNode(w.stateTip, h('span', { style: { flex: 'none', color: tone(w.stateTone), whiteSpace: 'nowrap' } }, w.stateText)) : null,
        ])
      }),
    ])
    if (b.kind === 'terminal') return h('div', { key: b.key, 'data-vc-terminal': 1, style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: tone('accent'), borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', paddingTop: 6 } }, [
      Ic({ n: 'external-link', size: 12 }), tipNode(b.tip, h('span', null, b.text)),
    ])
    return null
  }
  return h('div', { ref: rootRef, 'data-vc-root': 1, 'data-vc-tier': tier, style: { display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden', minWidth: 0 } }, blocks.map(node))
}
