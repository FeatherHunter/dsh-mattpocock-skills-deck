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
  // #842：ui.write 是写操作那一族自己的状态（六态、提交信息、确认框、上一次结果）。
  const [ui, setUi] = React.useState(function () { return { fileShown: {}, openDiff: '', openCommit: '', write: { op: '', state: 'idle', message: '', confirm: null, result: null, remoteChoice: null } } })
  const [width, setWidth] = React.useState(0)
  const [tier, setTier] = React.useState(0)
  const lastWidthRef = React.useRef(0)
  const rootRef = React.useRef(null)
  const moreRef = React.useRef(null)
  const logBusyRef = React.useRef(false)
  // 读数与界面状态属于哪个工作区（#819 发现 2）：Dock 在同会话里换工作区**不重挂载**组件，
  //   所以旧工作区的身份行与「点开的那一笔提交」会留在新工作区下面 —— 那是用户最怕的认错工作树。
  //   这里按 cwd 判一次，变了就整体复位（读数、展开状态、点开的提交、差异、折叠档号全清），
  //   而且这一帧不画任何旧数据（下面 staleCwd 那一句直接把块清空）。
  const [stateCwd, setStateCwd] = React.useState(cwd)
  const fresh = vcFreshOnCwd(stateCwd, cwd, reads, ui)
  const staleCwd = fresh.changed
  if (staleCwd) {
    setStateCwd(cwd)
    setReads(fresh.reads)
    // 换工作区连写操作的状态一起复位：旧工作区的确认框与「上次结果」绝不留在新工作区下面。
    setUi(Object.assign({}, fresh.ui, { write: { op: '', state: 'idle', message: '', confirm: null, result: null, remoteChoice: null } }))
    setTier(0)
    lastWidthRef.current = 0
    logBusyRef.current = false
  }
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
    // 复位那一帧 setReads 已经把读数清空了；这里从清空后的读数起读，绝不把上一个工作区的旧数据带进来。
    vcReadStatus(staleCwd ? vcNewReads() : readsRef.current, callHost, cwd).then(function (next) { if (alive) setReads(next) })
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
  // #842 写操作：动作层在 vcWriteOps.js（判定读核心 judge、发预检与写电话、成功后按设计重读）。
  const ops = vcWriteOpsOf({ ui: ui, setUi: setUi, callHost: callHost, cwd: cwd, readsRef: readsRef, setReads: setReads, screen: screen })
  const decisions = ops.decisions
  // 写操作那四颗按钮的文字也进折叠阶梯（顺序：路径 → 推送 → 拉取 → 全部暂存 → 其他工作树 → 提交历史 → 提交按钮）。
  const foldData = vcFoldDataOf(screen, reads, {
    push: tr('vc.action.push'),
    pull: tr('vc.action.pull'),
    stageAll: tr('vc.action.stageAll'),
    commit: tr('vc.action.commit', { n: String(screen ? (Number(screen.stagedCount) || 0) : 0) }),
  })
  const fold = vcFoldOf(width, foldData)
  const foldState = vcFoldStateAt(fold.ladder, tier)
  const contentKey = (screen ? String(screen.commits ? screen.commits.length : 0) : '-') + '|' + String(reads.log.commits ? reads.log.commits.length : 0) + '|' + String(ui.openDiff || '') + '|' + String(ui.openCommit || '') + '|' + String(screen ? screen.stagedCount + screen.unstagedCount : -1)
  // 逐字让位：先画第 0 档，量到自己这一块放不下就把档号加一（照 panel/Dock.js 头部那台折叠机）。
  React.useLayoutEffect(function () {
    const el = rootRef.current
    if (!el || tier >= fold.ladder.steps.length) return
    try {
      // 极端窄（比第三档还窄）：内容必然放不下（身份行与计数永不让位），直接跳到收尾档，
      //   不再一格一格试 —— 不然一千个字符的阶梯就要重画上千次（#819 发现 6）。溢出是允许的。
      if (width > 0 && width < VC_FOLD_BANDS[2]) { setTier(fold.ladder.steps.length); return }
      if (el.scrollWidth > el.clientWidth + 1) setTier(tier + 1)
    } catch (e) { /* 忽略 */ }
  }, [tier, width, contentKey])
  const commitCount = (screen && Array.isArray(screen.commits) ? screen.commits.length : 0) + (reads.log.commits ? reads.log.commits.length : 0)
  const loadMore = function () {
    // 防重入用自己的一把在途标记（读数的 state 要等回包才写，光看它拦不住同一拍里的第二次点击），
    //   同时先把「正在读更早的提交」这一刻写进读数 —— 界面那一句提示才有机会出现（#819 发现 8）。
    if (logBusyRef.current) return
    logBusyRef.current = true
    setReads(vcMarkLogLoading(readsRef.current))
    const skip = vcNextSkipOf(screenOf(readsRef.current), readsRef.current.log)
    vcReadMoreCommits(readsRef.current, callHost, cwd, skip).then(function (next) {
      logBusyRef.current = false
      setReads(next)
    })
  }
  // 滚到底自动接着读更早的提交（规格第 37 条）；浏览器没有这个观察器时，那一行仍然可以点。
  React.useEffect(function () {
    const el = moreRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(function (entries) { if (entries[0] && entries[0].isIntersecting) loadMore() })
    io.observe(el)
    return function () { try { io.disconnect() } catch (e) { /* 忽略 */ } }
  }, [commitCount, reads.log.state, reads.log.hasMore, fold.commitsCollapsed])
  const blocks = vcBlocksOf(screen, reads, ui, { t: tr, nowMs: Date.now(), cwdEmpty: cwdEmpty, decisions: decisions, fold: Object.assign({}, fold, { state: foldState }) })
  // 换工作区的那一帧：一个块都不画（旧工作区的身份行与提交清单绝不留在新工作区下面，见上面 staleCwd）。
  if (staleCwd) blocks.length = 0

  const tone = function (name) { return VC_TONE[name] || VC_TONE.primary }
  const retryScreen = function () { vcReadStatus(readsRef.current, callHost, cwd).then(function (next) { setReads(next) }) }
  // 就地看差异：展开键与块模型侧共用同一个函数（#850）—— 未提交那一层是「分组 + 路径」（同一个文件在两组各一行时各自展开），
  //   提交那一层是「修订号 + 路径」（同一个文件在两处的补丁是两回事）。原来这里只按路径，点开时与块模型对不上，补丁块永远不画。
  const diffKeyOf = function (row) { return vcDiffOpenKeyOf(row, ui.openCommit) }
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
  // 提交那一层的回包一律过一道 stale drop：晚到的旧回包不许把界面钉在旧的那一笔上（#819 发现 5）。
  const applyCommit = function (next) { setReads(function (cur) { return vcApplyCommitReply(cur, next) }) }
  // 提交行点开：进入「这笔提交改了什么」（规格故事 32）；再点一次「回到未提交改动」回到原来那一层。
  const openCommit = function (c) {
    const rev = String(c.key || '')
    setUi(Object.assign({}, ui, { openCommit: rev, openDiff: '' }))
    const entry = readsRef.current.commit || {}
    if (entry.rev === rev && (entry.state === 'ok' || entry.state === 'loading')) return
    vcReadCommitFiles(readsRef.current, callHost, cwd, rev).then(applyCommit)
  }
  const closeCommit = function () { setUi(Object.assign({}, ui, { openCommit: '', openDiff: '' })) }
  const retryCommit = function () {
    const rev = String(ui.openCommit || '')
    if (!rev) return
    vcReadCommitFiles(readsRef.current, callHost, cwd, rev).then(applyCommit)
  }
  // 「重新读一次」：面板上唯一的刷新入口（不是定时器 —— 刷新频率那条纪律不变）。
  const reloadNow = function () { retryScreen() }
  const moreFiles = function (groupKey) {
    const cur = Number(ui.fileShown[groupKey]) || VC_FILE_ROWS_FIRST
    const next = Object.assign({}, ui.fileShown)
    next[groupKey] = cur + VC_FILE_ROWS_BATCH
    setUi(Object.assign({}, ui, { fileShown: next }))
  }
  // 悬停包裹层要把孩子的 key 带过去：不带的话，凡是用 tipNode 包过的元素在数组里都会触发
  //   React 的「Each child in a list should have a unique key prop」警告（#842 视觉预览顺手修）。
  const tipNode = function (content, child) { return content ? h(Tip, { key: child && child.key !== undefined ? child.key : undefined, content: content }, child) : child }
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
    if (d.state !== 'ok') return h('div', { key: 'diff', className: 'dsws-vc-caption', 'data-vc-diff': d.state, style: { marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' } }, [
      h('span', { key: 'text' }, d.text), d.retry ? h('span', { key: 'retry', style: { display: 'contents' } }, button(d.retry, function () { retryDiff(row) })) : null,
    ])
    return h('div', { key: 'diff', className: 'dsws-vc-card dsws-vc-diff', 'data-vc-diff': 'lines', style: { marginTop: 4 } }, [
      // 这一处差异指的是哪一段（未提交那一层写清「相对上一次提交的全部改动」）：
      //   不写清，用户会把「已暂存」组里点开的差异当成「将要提交的那一部分」。
      d.scopeText ? h('div', { key: 'scope', 'data-vc-scope': 1, style: { color: tone('caption'), marginBottom: 4, fontFamily: 'inherit', whiteSpace: 'normal' } }, d.scopeText) : null,
      d.hunks.length ? h('div', { key: 'hunks', 'data-vc-hunks': 1, style: { marginBottom: 4 } }, [h('div', { key: 'title', style: { color: tone('caption') } }, d.hunksTitle)].concat(d.hunks.map(function (s, i) { return h('div', { key: i, style: { color: tone('accent') } }, s) }))) : null,
      d.lines.map(diffLine),
      d.shownNote ? h('div', { key: 'note', style: { color: tone('caption'), marginTop: 4 } }, d.shownNote) : null,
    ])
  }
  const fileRow = function (row) {
    const open = ui.openDiff === diffKeyOf(row)
    // #851：字母徽章只在极窄档让位（门槛取折叠阶梯最后一档 300px，也就是组件跳到收尾档的那一档）——
    //   那一档里路径与计数优先，中文状态词仍在，字母只是冗余的视觉标记。
    //   让位规则与既有那几处同源（同一台折叠机量出来的宽度），判定与块顺序一个字没动。
    const showBadge = !(width > 0 && width < VC_FOLD_BANDS[2])
    return h('div', { key: row.path, 'data-vc-file': 1, 'data-vc-open': open ? 1 : undefined, style: { borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)' } }, [
      h('div', { key: 'main', className: 'dsws-vc-row', onClick: function () { toggleDiff(row) }, style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11 } }, [
        // #851 ②：状态字母的方形徽章（新增的视觉标记）；中文状态词照旧在它右边可读（一个字没改）。
        showBadge ? h('span', { key: 'badge', className: 'dsws-vc-badge ' + String(row.badgeClass || ''), 'data-vc-badge': row.badge, title: row.changeText }, row.badge) : null,
        h('span', { key: 'change', className: 'dsws-vc-mono', 'data-vc-change': 1, style: { flex: 'none', width: 34, color: tone(row.changeTone), fontWeight: 700 } }, row.changeText),
        // #851 ①：路径等宽 + tabular-nums。
        tipNode(row.rowTip + (row.origPath ? '\n' + row.origPath : ''), h('span', { key: 'path', className: 'dsws-vc-mono', style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.pathText)),
        row.conflict ? h('span', { key: 'conflict', style: { flex: 'none', fontSize: 10, color: tone('warning'), border: '1px solid ' + tone('warning'), borderRadius: 4, padding: '0 4px' } }, row.conflictText) : null,
        // #851 ③：加减行数分开画，各自按正负着色（合起来还是原来那一串 '+12 −3'）。
        row.countsText
          ? h('span', { key: 'counts', className: 'dsws-vc-mono', style: { flex: 'none', color: tone('caption') } }, [
              h('span', { key: 'add', className: 'dsws-vc-add' }, row.addText),
              ' ',
              h('span', { key: 'del', className: 'dsws-vc-del' }, row.delText),
            ])
          : null,
      ].concat(vcRowStageNodes(h, { row: row, tone: tone, tipNode: tipNode, stagePaths: ops.stagePaths }))),
      diffNode(row),
    ])
  }
  const groupNode = function (g) {
    return h('div', { key: g.key, 'data-vc-group': g.key }, [
      // #851 ⑤：分段小标题（原型 C 的 ix-sec）——小字、拉开字距、下压一条细分隔线；文字照旧是既有词条。
      tipNode(g.tip, h('div', { key: 'title', className: 'dsws-vc-sec', style: { display: 'flex', alignItems: 'center', gap: 6 } }, g.title)),
      g.rows.map(fileRow),
      g.moreCount > 0 ? h('div', { key: 'more', onClick: function () { moreFiles(g.key) }, style: { padding: '3px 0', fontSize: 11, color: tone('accent'), cursor: 'pointer' } }, g.moreLabel) : null,
    ])
  }
  const node = function (b) {
    if (b.kind === 'hint') return h('div', { key: b.key, 'data-vc-hint': 1, style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: tone(b.tone), background: 'var(--dsw-alias-bg-layer-2,#16181d)', borderRadius: 6, padding: '4px 8px' } }, [h('span', { key: 'text', style: { flex: 1 } }, b.text), b.retry ? h('span', { key: 'retry', style: { display: 'contents' } }, button(b.retry, retryScreen)) : null])
    if (b.kind === 'error') return h('div', { key: b.key, 'data-vc-error': 1, style: { border: '1px dashed var(--dsw-alias-border-l2,#3a3f4a)', borderRadius: 10, padding: '18px 14px', textAlign: 'center', fontSize: 12, color: tone(b.tone) } }, [
      // 可见正文只有一句按种类映射出来的词条句；宿主原话（中文）只进悬停，英文界面上不会串出中文。
      // key 挂在外层 span 上、不写进里面那个 div：内层这句是 verify-818 的反证补丁锚点，动它会把那条反证弄成「改不中」。
      h('span', { key: 'text', style: { display: 'contents' } }, tipNode(b.rawTip, h('div', { style: { lineHeight: 1.7 } }, b.text))),
      b.retry ? h('div', { key: 'retry', style: { marginTop: 10 } }, button(b.retry, retryScreen)) : null,
    ])
    if (b.kind === 'band') return h('div', { key: b.key, 'data-vc-band': 1, style: { display: 'flex', flexDirection: 'column', gap: 4 } }, b.items.map(function (it, i) {
      return h('div', { key: i, 'data-vc-band-item': it.key, style: { fontSize: 11, color: tone(it.tone), background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 6, padding: '4px 8px', lineHeight: 1.6 } }, tipNode(it.tip, h('span', { key: 'text' }, it.text)))
    }))
    if (b.kind === 'identity') return h('div', { key: b.key, 'data-vc-identity': 1, style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
      h('div', { key: 'head', style: { display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 } }, [
        // #851 ⑥：身份行（仓库名 + 分支）用大一号的字重与字号，跟下面的计数行拉开层级（原型 A 的 ed-id）。
        tipNode(b.nameTip, h('span', { key: 'name', className: 'dsws-vc-id', 'data-vc-worktree': 1, style: { color: tone('primary'), whiteSpace: 'nowrap' } }, b.name)),
        tipNode(b.detached ? b.oidTip : b.branchText, h('span', { key: 'branch', className: 'dsws-vc-id', 'data-vc-branch': 1, style: { color: tone(b.branchTone), whiteSpace: 'nowrap' } }, b.branchText)),
        b.oidText ? h('span', { key: 'oid', className: 'dsws-vc-mono', style: { fontSize: 11, color: tone('caption'), whiteSpace: 'nowrap' } }, b.oidText) : null,
      ]),
      h('div', { key: 'path', className: 'dsws-vc-mono', 'data-vc-path': 1, style: { fontSize: 11, color: tone('caption'), whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0 } }, tipNode(b.pathTip, h('span', null, b.pathText))),
      h('div', { key: 'sync', className: 'dsws-vc-count', 'data-vc-sync': 1, style: { color: tone('primary'), display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' } }, [
        tipNode(b.sync.tip, h('span', { key: 'text' }, b.sync.text)),
        b.sync.basis ? tipNode(b.sync.basisTip, h('span', { key: 'basis', 'data-vc-basis': 1, style: { color: tone('caption') } }, b.sync.basis)) : null,
      ]),
      // 这份数据是什么时候读的 + 唯一的「重新读一次」入口（不是定时器；读不到时刻就不画那几个字）。
      h('div', { key: 'readat', className: 'dsws-vc-caption', 'data-vc-readat': 1, style: { display: 'flex', gap: 8, alignItems: 'baseline' } }, [
        b.readAtText ? h('span', { key: 'when' }, b.readAtText) : null,
        h('button', { key: 'reload', className: 'dsws-btn', type: 'button', 'data-vc-reload': 1, onClick: reloadNow, style: { fontSize: 10, padding: '0 6px' } }, tr('vc.reload')),
      ]),
      // #842：领先落后就在这一行，拉取 / 推送也跟着放这里；文字走折叠阶梯（完整文字在悬停里）。
      vcActionsNode(h, { actions: b.actions, foldActions: foldState.actions, tone: tone, tipNode: tipNode, startPull: ops.startPull, startPush: ops.startPush }),
    ])
    if (b.kind === 'changes') return h('div', { key: b.key, 'data-vc-changes': 1, 'data-vc-commit-mode': b.commitMode ? 1 : undefined }, [
      // 「这笔提交改了什么」这一层（规格故事 32）：出路摆在最上面，别让用户找不到回去的路。
      b.back ? h('div', { key: 'back', className: 'dsws-vc-link', 'data-vc-back': 1, onClick: closeCommit, style: { fontSize: 11, marginBottom: 4 } }, b.back) : null,
      h('div', { key: 'titlerow', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
        h('span', { key: 'title', style: { fontSize: 12, fontWeight: 700, color: tone('primary'), flex: 1, minWidth: 0 } }, b.title),
        // #842：「全部暂存」在标题行右侧（未暂存计数 > 0 才出现）。
        vcStageAllNode(h, { stageAll: b.stageAll, foldActions: foldState.actions, tone: tone, tipNode: tipNode, stagePaths: ops.stagePaths }),
      ]),
      h('div', { key: 'summary', 'data-vc-summary': 1, style: { fontSize: 11, color: tone('primary'), marginTop: 2 } }, b.summary),
      b.note ? h('div', { key: 'note', 'data-vc-note': 1, style: { fontSize: 11, color: tone('caption'), marginTop: 4, lineHeight: 1.6 } }, b.note) : null,
      b.retry ? h('div', { key: 'retry', style: { marginTop: 6 } }, button(b.retry, retryCommit)) : null,
      b.empty ? h('div', { key: 'empty', style: { fontSize: 11, color: tone('caption'), marginTop: 4 } }, b.emptyText) : null,
      b.groups.map(groupNode),
      // #842 提交区：放 changes 块底部，不新增块（块顺序 VC_BLOCK_ORDER 一个字不动）。输入框与按钮永不让位。
      vcCommitAreaNode(h, { commitArea: b.commitArea, foldActions: foldState.actions, tone: tone, tipNode: tipNode, submitCommit: ops.submitCommit, writeMessageOf: ops.writeMessageOf }),
    ])
    if (b.kind === 'commits') return h('div', { key: b.key, 'data-vc-commits': 1 }, [
      h('div', { key: 'title', className: 'dsws-vc-sec', style: { color: tone('primary') } }, b.title),
      b.collapsed ? h('div', { key: 'collapsed', className: 'dsws-vc-caption', style: { marginTop: 2 } }, b.collapseText) : null,
      b.empty && !b.collapsed ? h('div', { key: 'empty', style: { fontSize: 11, color: tone('caption'), marginTop: 2 } }, b.emptyText) : null,
      b.rows.map(function (c, i) {
        return h('div', { key: c.key, className: 'dsws-vc-row dsws-vc-sep', 'data-vc-commit': 1, 'data-vc-commit-open': c.open ? 1 : undefined, onClick: function () { openCommit(c) }, style: { display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11, cursor: 'pointer', background: c.open ? 'var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.14))' : undefined } }, [
          h('span', { key: 'when', className: 'dsws-vc-mono', style: { flex: 'none', color: tone('caption') } }, c.when),
          tipNode(c.tip, h('span', { key: 'subject', style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tone('primary') } }, c.subject)),
          h('span', { key: 'short', className: 'dsws-vc-mono', style: { flex: 'none', color: tone('caption') } }, c.short),
        ])
      }),
      b.more.show ? h('div', { key: 'more', ref: moreRef, className: 'dsws-vc-link', 'data-vc-more': 1, onClick: loadMore, style: { padding: '3px 0', fontSize: 11 } }, b.more.label) : null,
      b.more.allLoaded ? h('div', { key: 'allLoaded', style: { padding: '3px 0', fontSize: 11, color: tone('caption') } }, b.more.allLoaded) : null,
      b.more.failText ? h('div', { key: 'fail', style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: tone('error') } }, [h('span', { key: 'text' }, b.more.failText), b.more.retry ? h('span', { key: 'retry', style: { display: 'contents' } }, button(b.more.retry, loadMore)) : null]) : null,
    ])
    if (b.kind === 'other') return h('div', { key: b.key, 'data-vc-other': 1 }, [
      tipNode(b.tip, h('div', { key: 'title', className: 'dsws-vc-sec', style: { color: tone('primary') } }, b.title)),
      b.empty ? h('div', { key: 'empty', style: { fontSize: 11, color: tone('caption'), marginTop: 2 } }, b.emptyText) : null,
      // 摘要档那一行同样挂悬停：名字是折短过的，完整路径就在悬停里（规格第 5 条）。
      b.mode === 'summary' && !b.empty ? tipNode(b.tip, h('div', { 'data-vc-other-summary': 1, key: 'summary', style: { fontSize: 11, color: tone('caption'), marginTop: 2 } }, b.summaryText)) : null,
      b.rows.map(function (w, i) {
        return h('div', { key: w.key, className: 'dsws-vc-row dsws-vc-sep', 'data-vc-other-row': 1, style: { display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11 } }, [
          tipNode(w.displayTip, h('span', { key: 'name', style: { flex: 'none', color: tone('primary'), whiteSpace: 'nowrap' } }, w.displayText)),
          h('span', { key: 'branch', className: 'dsws-vc-mono', style: { flex: 'none', color: tone('caption'), whiteSpace: 'nowrap' } }, w.branchText),
          w.stateText ? tipNode(w.stateTip, h('span', { key: 'state', style: { flex: 'none', color: tone(w.stateTone), whiteSpace: 'nowrap' } }, w.stateText)) : null,
        ])
      }),
      // 其他工作树也按同一套规矩分批（#819 发现 12）：一千棵时不一次画一千行。
      b.moreCount > 0 ? h('div', { key: 'more', 'data-vc-other-more': 1, onClick: function () { moreFiles('other') }, style: { padding: '3px 0', fontSize: 11, color: tone('accent'), cursor: 'pointer' } }, b.moreLabel) : null,
    ])
    if (b.kind === 'terminal') return h('div', { key: b.key, 'data-vc-terminal': 1, style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: tone('accent'), borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', paddingTop: 6 } }, [
      // 「需要自己动手的事」是一句陈述，不是一个动作：这里没有替你打开命令行的能力，所以不摆任何看着能点的图标
      //   （#819 发现 7：外链图标摆在那里点不动，比不画图标更差）。
      tipNode(b.tip, h('span', { key: 'text' }, b.text)),
    ])
    return null
  }
  // #842 写操作的三块尾巴：执行中那一句、上一次结果、确认框（都在块清单之外，不新增块）。
  //   注意：尾巴节点读的是 **vcWriteUiOf 产出的模型**（confirm/result 已经翻成词条句子），
  //   不是 ops.writeState 那个原始形状（它的 confirm 只有 {op,plan,ticket,remotes}、result 只有 key/params）——
  //   早先这里传错了对象，真机上确认框是空框、失败横幅露出 vc.op.failed 这个键名（#842 视觉预览 V1/V2）。
  const writeUi = (typeof vcWriteUiOf === 'function') ? vcWriteUiOf(screen, ui, { t: tr, nowMs: Date.now(), decisions: decisions }) : null
  const writeTail = vcWriteTailNodes(h, { writeUi: writeUi, tone: tone, tipNode: tipNode, tr: tr, retryResult: ops.retryResult, cancelConfirm: ops.cancelConfirm, confirmNow: ops.confirmNow, pickRemote: ops.pickRemote })
  return h('div', { ref: rootRef, 'data-vc-root': 1, 'data-vc-tier': tier, style: { display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden', minWidth: 0 } }, blocks.map(node).concat(writeTail))
}
