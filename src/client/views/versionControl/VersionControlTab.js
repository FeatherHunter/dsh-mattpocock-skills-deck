// views/versionControl/VersionControlTab.js — 「版本管理」页签的内容区（#818 的入口组件）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回 src/client/index.js
//   的 leaf 标记处（一源两物）。壳层（panel/Dock.js）按 h(VersionControlTab, { st, narrow }) 调它。
//
// 这一层只做三件事：把宽度与展开状态收起来、按 vcFold.js 的阶梯算该画什么、把 vcBlocks.js 给的
//   块清单画成 DOM。所有判定与措辞都在那两个纯函数文件里，这里一个中文字面量都没有。
// #853：颜色只走**本页的皮肤令牌**（--vc-*，由 vcStyles.js 按宿主主题开关分深浅两套：
//   深色 = A 工程台账，浅色 = C 纸质便签）。六种变化色由下面的 VC_TONE 映射到这些令牌，
//   纯规则层只给「success / warning / error / accent / caption / primary」这几个色档名。
// 定时器：一个都没有（既不自续也不排一次性）；宽度靠 ResizeObserver，提交续读靠
//   IntersectionObserver，两者都在卸载时断开（#709 的「后台零定时器」那条不变量照旧）。
export const VC_TONE = {
  // #853：这六个色档改指本页的皮肤令牌，不再吃宿主那一套 —— 换肤就换这一处。
  success: 'var(--vc-accent,#22c55e)',
  warning: 'var(--vc-warn,#f59e0b)',
  error: 'var(--vc-danger,#ef4444)',
  accent: 'var(--vc-info,#38bdf8)',
  caption: 'var(--vc-mut,#94a3b8)',
  primary: 'var(--vc-ink,#e6edf3)',
}
export const VersionControlTab = function (props) {
  // 壳层还传了 narrow（面板窄于 380 的那一档），本页签不读它：这一页的让位按自己量到的
  //   可用宽度走（vcFold.js 那条阶梯），比整面板一个布尔更准；留着这个入参是为了与壳层调用形状一致。
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const st = props && props.st
  const cwd = st && st.cwd ? String(st.cwd) : ''
  // 进页签先画暂存：命中缓存直接画旧数据，后台重新验证（陈旧时边读边展示，不闪骨架）。
  const [reads, setReads] = React.useState(function () { return vcCacheSeedOf(cwd) || vcNewReads() })
  // #842：ui.write 是写操作那一族自己的状态（六态、提交信息、确认框、上一次结果）。
  const [ui, setUi] = React.useState(function () { return { fileShown: {}, openDiff: '', openCommit: '', view: vcRememberedView(), write: { op: '', state: 'idle', message: '', confirm: null, result: null, remoteChoice: null } } })
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
  // #857 P2：回包落地时要能读到「现在的工作区」，否则换工作区后在飞的那一枪会写进新工作区。
  const stateCwdRef = React.useRef(cwd)
  stateCwdRef.current = stateCwd
  const fresh = vcFreshOnCwd(stateCwd, cwd, reads, ui)
  const staleCwd = fresh.changed
  if (staleCwd) {
    setStateCwd(cwd)
    setReads(vcCacheSeedOf(cwd) || fresh.reads)
    // 换工作区连写操作的状态一起复位：旧工作区的确认框与「上次结果」绝不留在新工作区下面。
    setUi(Object.assign({}, fresh.ui, { view: 'changes', write: { op: '', state: 'idle', message: '', confirm: null, result: null, remoteChoice: null } }))
    vcResetViewMemory()
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
    vcReadStatus(staleCwd ? vcNewReads() : readsRef.current, callHost, cwd).then(function (next) { if (alive) { setReads(next); vcCacheSave(cwd, next) } })
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
      vcCacheSave(cwd, next)
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
  const retryScreen = function () { vcReadStatus(readsRef.current, callHost, cwd).then(function (next) { setReads(next); vcCacheSave(cwd, next) }) }
  // #853 第三步：视图切换只改 ui.view（函数式更新，不会顶掉同期别的 setUi）；选择跨挂载记住，换工作区复位。
  const pickView = function (v) { vcRememberView(v); setUi(function (cur) { return vcPickViewStateOf(cur, v) }) }
  // #854：面板解决不了的事 —— 一个按钮把当前问题写成 prompt 交给 AI（预填不发送，尾部留白让人补话）。
  const openHandoff = function (ai) { const handoff = vcAiHandoffOf({ ai: ai, t: tr, screen: screen }); if (handoff) vcOpenAiHandoff({ opener: (typeof openTextInNewSession === 'function') ? openTextInNewSession : null, st: st, handoff: handoff }) }
  // 就地看差异：展开键与块模型侧共用同一个函数（#850）—— 未提交那一层是「分组 + 路径」（同一个文件在两组各一行时各自展开），
  //   提交那一层是「修订号 + 路径」（同一个文件在两处的补丁是两回事）。原来这里只按路径，点开时与块模型对不上，补丁块永远不画。
  // #857：差异与提交那几路的动作抽到 vcDiffOps.js（读、发、回包落地前的两道闸、同键在途不重复发）。
  const diffOps = vcDiffOpsOf({ ui: ui, setUi: setUi, setReads: setReads, readsRef: readsRef, callHost: callHost, cwd: cwd, stateCwdRef: stateCwdRef, vcDiffOpenKeyOf: vcDiffOpenKeyOf, vcReadDiff: vcReadDiff, vcReadCommitFiles: vcReadCommitFiles, vcReadCommitFileDiff: vcReadCommitFileDiff, vcApplyDiffReply: vcApplyDiffReply, vcApplyCommitReply: vcApplyCommitReply, vcReadsOf: vcReadsOf, vcMarkDiffLoading: vcMarkDiffLoading, vcMarkCommitLoading: vcMarkCommitLoading, vcMarkCommitFileDiffLoading: vcMarkCommitFileDiffLoading, vcApplyCommitFileDiffReply: vcApplyCommitFileDiffReply, onView: pickView })
  const diffKeyOf = diffOps.diffKeyOf
  const entryOf = diffOps.entryOf
  const toggleDiff = diffOps.toggleDiff
  const retryDiff = diffOps.retryDiff
  const openCommit = diffOps.openCommit
  const closeCommit = diffOps.closeCommit
  const retryCommit = diffOps.retryCommit
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
  const button = function (label, onClick) { return h('button', { className: 'dsws-btn', type: 'button', onClick: onClick, style: { flex: 'none' } }, label) }
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
    // #857 P6：读取中的差异画骨架条，不画一句会跳动的文字；失败那一支照旧给正文与重试。
    if (d.state === 'loading') return h('div', { key: 'diff', 'data-vc-diff': 'loading', style: { marginTop: 4 } }, [
      h('div', { key: 'l1', className: 'dsws-vc-skel', 'data-vc-skel': 1, style: { width: '80%', height: 12 } }),
      h('div', { key: 'l2', className: 'dsws-vc-skel', 'data-vc-skel': 1, style: { width: '62%', height: 12 } }),
      h('div', { key: 'l3', className: 'dsws-vc-skel', 'data-vc-skel': 1, style: { width: '70%', height: 12 } }),
    ])
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
    return h('div', { key: row.path, 'data-vc-file': 1, 'data-vc-open': open ? 1 : undefined, style: { borderTop: '1px solid var(--vc-line,#2a2d35)' } }, [
      // 文件行按 854 原型排两行：首行路径（等宽 12px），次行状态词（11px）；加减行数与暂存按钮右对齐。
      h('div', { key: 'main', className: 'dsws-vc-row', onClick: function () { toggleDiff(row) }, style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' } }, [
        showBadge ? tipNode(row.changeText, h('span', { key: 'badge', className: 'dsws-vc-badge ' + String(row.badgeClass || ''), 'data-vc-badge': row.badge }, row.badge)) : null,
        h('div', { key: 'main', style: { flex: 1, minWidth: 0 } }, [
          tipNode(row.rowTip + (row.origPath ? '\n' + row.origPath : ''), h('span', { key: 'path', className: 'dsws-vc-mono', style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.pathText)),
          row.changeText ? h('span', { key: 'change', className: 'dsws-vc-mono', 'data-vc-change': 1, style: { fontSize: 11, color: row.conflict ? tone('error') : tone('caption') } }, row.changeText) : null,
        ]),
        row.conflict ? h('span', { key: 'conflict', style: { flex: 'none', fontSize: 10.5, color: tone('warning'), border: '1px solid ' + tone('warning'), borderRadius: 4, padding: '0 4px' } }, row.conflictText) : null,
        row.countsText
          ? h('span', { key: 'counts', className: 'dsws-vc-mono', style: { flex: 'none', fontSize: 11, color: tone('caption') } }, [
              h('span', { key: 'add', className: 'dsws-vc-add' }, row.addText),
              ' ',
              h('span', { key: 'del', className: 'dsws-vc-del' }, row.delText),
            ])
          : null,
      ].concat(vcRowStageNodes(h, { row: row, tone: tone, tipNode: tipNode, stagePaths: ops.stagePaths })).concat(vcRowUnstageNodes(h, { row: row, tone: tone, tipNode: tipNode, unstagePaths: ops.unstagePaths }))),
      diffNode(row),
    ])
  }
  const groupNode = function (g) {
    return h('div', { key: g.key, 'data-vc-group': g.key }, [
      // #851 ⑤：分段小标题（原型 C 的 ix-sec）——小字、拉开字距、下压一条细分隔线；文字照旧是既有词条。
      tipNode(g.tip, h('div', { key: 'title', className: 'dsws-vc-sec', style: { display: 'flex', alignItems: 'center', gap: 6 } }, g.title)),
      g.rows.map(fileRow),
      g.moreCount > 0 ? h('div', { key: 'more', className: 'dsws-vc-link', onClick: function () { moreFiles(g.key) }, style: { padding: '3px 0', color: tone('accent'), cursor: 'pointer' } }, g.moreLabel) : null,
    ])
  }
  const node = function (b) {
    if (b.kind === 'hint') return h('div', { key: b.key, 'data-vc-hint': 1, style: { display: 'flex', gap: 6, alignItems: 'center', color: tone(b.tone), background: 'var(--vc-inset,#16181d)', borderRadius: 'var(--vc-radius,6px)', padding: '4px 8px' } }, [h('span', { key: 'text', style: { flex: 1 } }, b.text), b.retry ? h('span', { key: 'retry', style: { display: 'contents' } }, button(b.retry, retryScreen)) : null])
    if (b.kind === 'error') return h('div', { key: b.key, 'data-vc-error': 1, style: { border: '1px dashed var(--vc-line2,#3a3f4a)', borderRadius: 'calc(var(--vc-radius,2px) * 2)', padding: '18px 14px', textAlign: 'center', fontSize: 12, color: tone(b.tone) } }, [
      // 可见正文只有一句按种类映射出来的词条句；宿主原话（中文）只进悬停，英文界面上不会串出中文。
      // key 挂在外层 span 上、不写进里面那个 div：内层这句是 verify-818 的反证补丁锚点，动它会把那条反证弄成「改不中」。
      h('span', { key: 'text', style: { display: 'contents' } }, tipNode(b.rawTip, h('div', { style: { lineHeight: 1.7 } }, b.text))),
      b.retry ? h('div', { key: 'retry', style: { marginTop: 10 } }, button(b.retry, retryScreen)) : null,
      b.ai ? h('div', { key: 'aibtn', style: { marginTop: 10 } }, vcAiButtonNode(h, { ai: b.ai, tr: tr, onOpen: openHandoff })) : null,
    ])
    if (b.kind === 'band') return h('div', { key: b.key, 'data-vc-band': 1, style: { display: 'flex', flexDirection: 'column', gap: 4 } }, b.items.map(function (it, i) {
      // 提示带按 854 原型画：左侧 3px 语气色条加标记，主句加粗，正文第二行，交接按钮右置。
      return h('div', { key: i, 'data-vc-band-item': it.key, style: { display: 'flex', gap: 9, alignItems: 'flex-start', color: tone(it.tone), background: 'var(--vc-inset,#16181d)', border: '1px solid var(--vc-line,#2a2d35)', borderLeft: '3px solid ' + tone(it.tone), borderRadius: 'var(--vc-radius,6px)', padding: '9px 11px', lineHeight: 1.6 } }, [it.tone === 'caption' ? null : h('span', { key: 'mark', style: { flex: 'none', fontWeight: 800, fontSize: 11, paddingTop: 1 } }, '!'), h('div', { key: 'main', style: { flex: 1, minWidth: 0 } }, [tipNode(it.tip, h('span', { key: 'text', style: { fontWeight: 650 } }, it.text)), it.tip ? h('div', { key: 'body', style: { color: tone('caption'), marginTop: 2 } }, it.tip) : null]), it.ai ? h('span', { key: 'ai', style: { flex: 'none', marginLeft: 6 } }, vcAiButtonNode(h, { ai: it.ai, tr: tr, onOpen: openHandoff })) : null])
    }))
    // 身份区按 854 布局 C 原型并成两行：首行仓库名加分支加同步状态右对齐，次行路径加读取时间加远端更新加重新读一次右对齐；拉取推送搬进视图条（模型仍在身份块里）。
    if (b.kind === 'identity') return h('div', { key: b.key, 'data-vc-identity': 1, style: { display: 'flex', flexDirection: 'column', gap: 4 } }, [
      h('div', { key: 'head', style: { display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 } }, [
        tipNode(b.nameTip, h('span', { key: 'name', className: 'dsws-vc-id', 'data-vc-worktree': 1, style: { color: tone('primary'), whiteSpace: 'nowrap' } }, b.name)),
        // 原型身份行里仓库名与分支之间有个灰色斜杠分隔（854 的 sep），实现之前漏了它。
        h('span', { key: 'sep', style: { color: tone('caption') } }, '/'),
        tipNode(b.detached ? b.oidTip : b.branchText, h('span', { key: 'branch', className: 'dsws-vc-id', 'data-vc-branch': 1, style: { color: tone(b.branchTone), whiteSpace: 'nowrap' } }, b.branchText)),
        b.oidText ? h('span', { key: 'oid', className: 'dsws-vc-mono', style: { fontSize: 11.5, color: tone('caption'), whiteSpace: 'nowrap' } }, b.oidText) : null,
        tipNode(b.sync.tip, h('span', { key: 'sync', className: 'dsws-vc-count', 'data-vc-sync': 1, style: { marginLeft: 'auto', whiteSpace: 'nowrap', fontSize: 11.5 } }, b.sync.text)),
      ]),
      h('div', { key: 'sub', className: 'dsws-vc-caption', 'data-vc-readat': 1, style: { display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 } }, [
        tipNode(b.pathTip, h('span', { key: 'path', className: 'dsws-vc-mono', 'data-vc-path': 1, style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, b.pathText)),
        // 原型次行用中点分隔路径、读取时间、远端更新三段（854 的 sub），有哪段才画哪段前面的点。
        b.readAtText ? h('span', { key: 'dot1', style: { flex: 'none' } }, '·') : null,
        b.readAtText ? h('span', { key: 'when', style: { flex: 'none' } }, b.readAtText) : null,
        b.sync.basis ? h('span', { key: 'dot2', style: { flex: 'none' } }, '·') : null,
        b.sync.basis ? tipNode(b.sync.basisTip, h('span', { key: 'basis', 'data-vc-basis': 1, style: { flex: 'none' } }, b.sync.basis)) : null,
        h('button', { key: 'reload', className: 'dsws-btn', type: 'button', 'data-vc-reload': 1, onClick: reloadNow }, tr('vc.reload')),
      ]),
    ])
    const changeTail = b.kind === 'changes' ? [b.note ? h('div', { key: 'note', 'data-vc-note': 1, style: { fontSize: 11, color: tone('caption'), marginTop: 4, lineHeight: 1.6 } }, b.note) : null,
      b.retry ? h('div', { key: 'retry', style: { marginTop: 6 } }, button(b.retry, retryCommit)) : null,
      b.empty ? h('div', { key: 'empty', className: 'dsws-vc-empty', style: { color: tone('caption'), marginTop: 4, textAlign: 'center' } }, b.emptyText) : null,
      b.groups.map(groupNode)] : []
    if (b.kind === 'changes' && b.commitMode) return h('div', { key: b.key, 'data-vc-changes': 1, 'data-vc-commit-mode': 1 }, [
      b.back ? h('div', { key: 'back', className: 'dsws-vc-link', 'data-vc-back': 1, onClick: closeCommit, style: { marginBottom: 4 } }, b.back) : null,
      h('span', { key: 'title', style: { fontSize: 12, fontWeight: 700, color: tone('primary') } }, b.title),
      h('div', { key: 'summary', 'data-vc-summary': 1, style: { fontSize: 11, color: tone('primary'), marginTop: 2 } }, b.summary),
    ].concat(b.loading ? vcCommitSkelNodes(h) : [], changeTail))
    if (b.kind === 'changes') return h('div', { key: b.key, 'data-vc-changes': 1, 'data-vc-commit-mode': b.commitMode ? 1 : undefined }, [
      // 「这笔提交改了什么」这一层（规格故事 32）：出路摆在最上面，别让用户找不到回去的路。
      b.back ? h('div', { key: 'back', className: 'dsws-vc-link', 'data-vc-back': 1, onClick: closeCommit, style: { marginBottom: 4 } }, b.back) : null,
      // 854 布局 C 原型的改动视图没有标题汇总行：标题就是页签，计数就是数字条，这里直接进数字条加视图条。
      vcStatsNode(h, { stats: vcStatsOf(screen), t: tr }),
      vcViewBarNode(h, { stageAll: b.stageAll, commitArea: b.commitArea, actions: (writeUi && writeUi.actions) || null, startPull: ops.startPull, startPush: ops.startPush, foldActions: foldState.actions, tone: tone, tipNode: tipNode, t: tr, stagePaths: ops.stagePaths, submitCommit: ops.submitCommit, writeMessageOf: ops.writeMessageOf }),
    ].concat(changeTail))
    if (b.kind === 'commits') return h('div', { key: b.key, 'data-vc-commits': 1 }, [
      h('div', { key: 'title', className: 'dsws-vc-sec', style: { color: tone('primary') } }, b.title),
      b.collapsed ? h('div', { key: 'collapsed', className: 'dsws-vc-caption', style: { marginTop: 2 } }, b.collapseText) : null,
      b.empty && !b.collapsed ? h('div', { key: 'empty', className: 'dsws-vc-empty', style: { color: tone('caption'), marginTop: 2, textAlign: 'center' } }, b.emptyText) : null,
      b.rows.map(function (c, i) {
        return h('div', { key: c.key, className: 'dsws-vc-row dsws-vc-sep', 'data-vc-commit': 1, 'data-vc-commit-open': c.open ? 1 : undefined, onClick: function () { openCommit(c) }, style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: c.open ? 'var(--vc-hover,rgba(255,255,255,.14))' : undefined } }, [
          h('span', { key: 'badge', className: 'dsws-vc-badge', style: { flex: 'none' } }, '·'),
          tipNode(c.tip, h('div', { key: 'subject', style: { flex: 1, minWidth: 0 } }, [h('span', { key: 'short', className: 'dsws-vc-mono', 'data-vc-short': 1, style: { display: 'block' } }, c.short), h('span', { key: 'title', style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tone('primary') } }, c.subject)])),
          h('span', { key: 'when', className: 'dsws-vc-mono', style: { flex: 'none', fontSize: 11, color: tone('caption') } }, c.when),
        ])
      }),
      b.more.show ? h('div', { key: 'more', ref: moreRef, className: 'dsws-vc-link', 'data-vc-more': 1, onClick: loadMore, style: { padding: '3px 0' } }, b.more.label) : null,
      b.more.allLoaded ? h('div', { key: 'allLoaded', style: { padding: '3px 0', color: tone('caption') } }, b.more.allLoaded) : null,
      b.more.failText ? h('div', { key: 'fail', style: { display: 'flex', gap: 6, alignItems: 'center', color: tone('error') } }, [h('span', { key: 'text' }, b.more.failText), b.more.retry ? h('span', { key: 'retry', style: { display: 'contents' } }, button(b.more.retry, loadMore)) : null]) : null,
    ])
    if (b.kind === 'other') return h('div', { key: b.key, 'data-vc-other': 1 }, [
      tipNode(b.tip, h('div', { key: 'title', className: 'dsws-vc-sec', style: { color: tone('primary') } }, b.title)),
      b.empty ? h('div', { key: 'empty', className: 'dsws-vc-empty', style: { color: tone('caption'), marginTop: 2, textAlign: 'center' } }, b.emptyText) : null,
      // 摘要档那一行同样挂悬停：名字是折短过的，完整路径就在悬停里（规格第 5 条）。
      b.mode === 'summary' && !b.empty ? tipNode(b.tip, h('div', { 'data-vc-other-summary': 1, key: 'summary', style: { fontSize: 11, color: tone('caption'), marginTop: 2 } }, b.summaryText)) : null,
      b.rows.map(function (w, i) {
        return h('div', { key: w.key, className: 'dsws-vc-row dsws-vc-sep', 'data-vc-other-row': 1, style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
          h('span', { key: 'badge', className: 'dsws-vc-badge', style: { flex: 'none' } }, 'o'),
          h('div', { key: 'main', style: { flex: 1, minWidth: 0 } }, [
            tipNode(w.displayTip, h('span', { key: 'name', className: 'dsws-vc-mono', 'data-vc-name': 1, style: { display: 'block', color: tone('primary'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, w.displayText)),
            h('span', { key: 'branch', className: 'dsws-vc-mono', style: { display: 'block', fontSize: 11, color: tone('caption'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, w.branchText),
          ]),
          w.stateText ? tipNode(w.stateTip, h('span', { key: 'state', style: { flex: 'none', fontSize: 11, color: tone(w.stateTone), whiteSpace: 'nowrap' } }, w.stateText)) : null,
        ])
      }),
      // 其他工作树也按同一套规矩分批（#819 发现 12）：一千棵时不一次画一千行。
      b.moreCount > 0 ? h('div', { key: 'more', className: 'dsws-vc-link', 'data-vc-other-more': 1, onClick: function () { moreFiles('other') }, style: { padding: '3px 0', color: tone('accent'), cursor: 'pointer' } }, b.moreLabel) : null,
    ])
    if (b.kind === 'terminal') return h('div', { key: b.key, 'data-vc-terminal': 1, style: { display: 'flex', gap: 6, alignItems: 'center', color: tone('accent'), borderTop: '1px solid var(--vc-line,#2a2d35)', paddingTop: 6 } }, [
      // 「需要自己动手的事」是一句陈述，不是一个动作：这里没有替你打开命令行的能力，所以不摆任何看着能点的图标
      //   （#819 发现 7：外链图标摆在那里点不动，比不画图标更差）。
      tipNode(b.tip, h('span', { key: 'text' }, b.text)),
      b.ai ? h('span', { key: 'ai', style: { marginLeft: 6 } }, vcAiButtonNode(h, { ai: b.ai, tr: tr, onOpen: openHandoff })) : null,
    ])
    return null
  }
  // #842 写操作的三块尾巴：执行中那一句、上一次结果、确认框（都在块清单之外，不新增块）。
  //   注意：尾巴节点读的是 **vcWriteUiOf 产出的模型**（confirm/result 已经翻成词条句子），
  //   不是 ops.writeState 那个原始形状（它的 confirm 只有 {op,plan,ticket,remotes}、result 只有 key/params）——
  //   早先这里传错了对象，真机上确认框是空框、失败横幅露出 vc.op.failed 这个键名（#842 视觉预览 V1/V2）。
  const writeUi = (typeof vcWriteUiOf === 'function') ? vcWriteUiOf(screen, ui, { t: tr, nowMs: Date.now(), decisions: decisions }) : null
  const writeTail = vcWriteTailNodes(h, { writeUi: writeUi, tone: tone, tipNode: tipNode, tr: tr, retryResult: ops.retryResult, cancelConfirm: ops.cancelConfirm, confirmNow: ops.confirmNow, pickRemote: ops.pickRemote, openHandoff: openHandoff })
  // #857 P5：首屏还没拿到数据时不画空白，画骨架 —— 骨架里一个字都不写；有旧数据时走旧数据那条。
  const screenState = (reads.screen && reads.screen.state) || 'idle'
  const showSkel = !screen && blocks.length === 0 && (screenState === 'idle' || screenState === 'loading')
  // 首屏骨架按当前视图画（结构与该视图一致：改动画数字条加视图条加文件行，其余两视图画行）。
  const skeleton = vcViewSkelNode(h, { view: ui.openCommit ? 'commits' : vcViewOf(ui) })
  // #853 第三步：布局 C —— 常驻块一直在，三个视图各只画自己的块；写尾巴平时是空的所以平时看不见。
  const view = vcViewOf(ui)
  // 点开某一笔提交就是在看历史：不管页签停在哪，都画历史那一份。
  const effView = ui.openCommit ? 'commits' : view
  const parts = vcViewBlocksOf(blocks)
  const viewBlocks = effView === 'commits' ? parts.commits : (effView === 'worktrees' ? parts.worktrees : parts.changes)
  const tabs = vcViewTabsNode(h, { view: effView, counts: vcViewCountsOf(screen, reads), t: tr, onPick: pickView })
  return h('div', { ref: rootRef, 'data-vc-root': 1, 'data-vc-tier': tier, style: { display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 } }, showSkel ? [skeleton] : parts.always.map(node).concat([tabs], viewBlocks.map(node), writeTail))
}
