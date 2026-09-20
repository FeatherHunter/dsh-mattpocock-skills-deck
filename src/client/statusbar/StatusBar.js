/**
 * statusbar/StatusBar.js — 输入区状态栏（5.2）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回 src/client/index.js（spliced）。
 */
// #491 房外埋点：模块级计数（组件外一次，避免每渲染重置；只记枚举与计数，不记路径原文）。
const dswsStatusHydN = { n: 0 }
const dswsStatusFbLast = { reason: '' }

/**
 * 状态栏最外层容器的几何（#640）。整条状态栏（横幅那一行 + 胶囊那一行）都住在这个容器里，
 * 所以它的左右边就是这两行的左右边。
 *
 * 为什么要单独写出来：宿主把输入区做成一个纵向列，列里每一项各自声明自己的宽度。宿主输入卡的真实算式是
 * （`dsh-client-ui-conversation/lib/client.js` 第 15757 行的原文）
 *   .p_FcLG_root{padding:0 var(--dsh-composer-side-clearance) 8px}    ← 内层左右各留一个「侧距」
 *   .p_FcLG_card{width:100%; max-width:var(--dsh-composer-card-max-width)}
 * 也就是「卡片外框宽 = min(列宽 − 2×侧距, 卡宽上限)」。本插件原来什么都没写，
 * 于是这个容器横向铺满整列，比输入卡左右各宽出约 90 CSS px——宿主的输入区底色从那块多出来的地方露出来，
 * 就是用户看到的那条横带。
 *
 * 所以这里照抄的是**卡片**那条算式，不是宿主自己那三个输入区商品（待办/目标/队列）用的另一条
 * 「再各内缩 2×内距」的算式：那三家是宿主要给卡片让位的挂件，本来就比卡片窄 32px；
 * 而本插件要的是「横幅/胶囊/输入卡三者左右边对齐」（issue #640 的达成判据），所以取卡片那条。
 *
 * 横向 padding 不放这里：容器带横向 padding 会把胶囊再往里挤 8px，让三者又对不上；
 * 横内边距交给胶囊自己，保证「胶囊外框 = 卡片外框」。
 *
 * 兜底为什么是 0 而不是 16：宿主那两条规则里，`--dsh-composer-side-clearance` 是**没有兜底值**的
 *   （`padding:0 var(--dsh-composer-side-clearance) 8px`）。变量缺失时那条 padding 整条作废，卡片的左右边
 *   就是列的两边、一点内缩都没有。所以这里也只有退回 0（＝不加内缩）才对得上卡片；若退回 16，
 *   在没有这个变量的旧宿主上容器反而会比卡片窄 32px（实测过，浏览器量尺给出左右各差 16）。
 * @returns {Object} 可直接塞进 style 的几何片段
 */
const dswsStatusDockGeom = function () {
  return {
    width: 'calc(100% - 2 * var(--dsh-composer-side-clearance, 0px))',
    maxWidth: 'var(--dsh-composer-card-max-width, 100%)',
    marginLeft: 'auto',
    marginRight: 'auto',
    boxSizing: 'border-box',
    padding: '3px 0 0',
  }
}
export const StatusBar = (props) => {
  const sid = props && props.sessionId
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const s = cx ? cx.storeSvc.useStore(sid) : useStore(sid)
  const summaryCwd = props.useSessions(function (x) {
    return (sid && x.byId && x.byId[sid]) ? x.byId[sid].cwd : undefined
  })
  const consumedDraftRef = React.useRef(null)
  React.useEffect(function () {
    if (props && props.inputActions && typeof props.inputActions.setDraft === 'function') {
      s.injector = props.inputActions.setDraft
    }
  }, [props.sessionId, props.inputActions])
  React.useEffect(function () {
    if (!props || !props.sessionId) return
    if (consumedDraftRef.current === props.sessionId) return
    if (!props.inputActions || typeof props.inputActions.setDraft !== 'function') return
    s.injector = props.inputActions.setDraft
    if (pendingDraft) {
      if (pendingDraftTargetSid && pendingDraftTargetSid !== props.sessionId) return
      consumedDraftRef.current = props.sessionId
      const text = pendingDraft
      pendingDraft = null
      pendingDraftTargetSid = null
      props.inputActions.setDraft(text)
    }
  }, [props.sessionId, props.inputActions])
  React.useEffect(function () {
    probeHandoffReady(s)
  }, [])
  React.useEffect(function () {
    const apply = function (cwd, src) {
      if (cwd && cwd !== s.cwd) {
        try { dswsStatusHydN.n += 1; if (isEnabled('debug') && dswsStatusHydN.n % 100 === 0) log('debug', 'statusbar.hydrate', { cwdSource: String(src || 'unknown') }) } catch (eL) {}
        s.cwd = cwd
        const hydrated = hydrateFromCache(s)
        emit(s)
        loadChain(s, false)
        if (!hydrated || !snapFresh(s)) loadSnapshot(s, false, !!hydrated)
      }
    }
    if (summaryCwd) { apply(summaryCwd, 'summary'); return }
    const cwd0 = detectCwd(props && props.session)
    if (cwd0) { apply(cwd0, 'session'); return }
    if (sid && typeof host !== 'undefined' && typeof host.call === 'function') {
      host.call('wf.cwd', { sessionId: sid }).then(function (res) {
        if (res && res.ok && res.cwd) apply(res.cwd, 'wf.cwd')
      }).catch(function () {})
    }
  }, [sid, summaryCwd])
  React.useEffect(function () { loadChain(s, false); if (!snapFresh(s)) loadSnapshot(s, false, true) }, [])
  React.useEffect(function () { try { const r = !s.snapshot ? 'no-snapshot' : (!s.cwd ? 'no-cwd' : (s.snapMode === 'err' ? 'snap-error' : '')); if (r !== dswsStatusFbLast.reason) { dswsStatusFbLast.reason = r; if (r) log('info', 'statusbar.fallback', { reason: r }) } } catch (eL) {} }, [s.snapshot, s.cwd, s.snapMode])
  const csx = checksumsOf(s)
  const { fr, bugN, triageN, n, timeStr } = csx
  // 2026-08-28 优化3：胶囊状态栏任何情况下都不隐藏（#187「未选后端隐藏整条」门控退休，仅留导航引导）。
  // _isOtherSBGate 仍用于 go()：未选后端（backendId=null 且非 pending）时点击面板分段 → 设置页引导。
  // Guard: interval transient with empty cwd should not hide capsule (prevent forced empty)
  const _selSBGate = s.selection || (s.snapshot && s.snapshot.selection) || null
  const _isOtherSBGateRaw = !!(_selSBGate && _selSBGate.backendId===null && !_selSBGate.pending)
  const _isOtherSBGate = _isOtherSBGateRaw && !!s.cwd && s.snapMode==='real' && !!s.snapshot
  const go = function (tab) {
    if (_isOtherSBGate && tab!=='settings') { try{ s.tab='settings'; }catch(e){}; return }
    s.tab = tab; openPanel(s)
  }
  const foldRef = React.useRef(null)
  const bugAnchorRef = React.useRef(null)
  const bugCloseRef = React.useRef(null)
  const takeAnchorRef = React.useRef(null)
  const takeCloseRef = React.useRef(null)
  const backendAnchorRef = React.useRef(null)
  const backendCloseRef = React.useRef(null)
  // 状态栏悬浮菜单定位与开关已搬 StatusMenus.js（B1 #460，纯结构；同闭包拼回直调）。
  // 以后改悬浮菜单跟随定位与开关的人改 StatusMenus.js，本处只留转调包装。
  const clearClose = function(ref){ clearStatusClose(ref) }
  const scheduleClose = function(ref, fn){ scheduleStatusClose(ref, fn) }
  const closeBugMenu = function(){ closeStatusBugMenu(s, bugCloseRef) }
  const showBugMenu = function(){ showStatusBugMenu(s, bugAnchorRef, bugCloseRef) }
  const closeTakeMenu = function(){ closeStatusTakeMenu(s, takeCloseRef) }
  const showTakeMenu = function(){ showStatusTakeMenu(s, takeAnchorRef, takeCloseRef) }
  // 菜单重定位副作用已搬 StatusMenus.js 的 useStatusMenus（B1 #460，同闭包拼回），此处单调供装配。
  useStatusMenus(s, { bugAnchorRef: bugAnchorRef, backendAnchorRef: backendAnchorRef, bugCloseRef: bugCloseRef, backendCloseRef: backendCloseRef, takeAnchorRef: takeAnchorRef, takeCloseRef: takeCloseRef })
  const applyFold = function () {
    const cap = foldRef.current
    if (!cap) return
    const targets = Array.from(cap.querySelectorAll('[data-fold-priority]'))
    if (!targets.length) return
    cap.classList.add('dsws-no-anim')
    targets.forEach(function (el) { el.classList.remove('dsws-folded') })
    void cap.offsetWidth
    const items = targets.map(function (el) {
      return { el: el, p: Number(el.getAttribute('data-fold-priority') || 99) }
    }).sort(function (a, b) { return a.p - b.p })
    for (const it of items) {
      if (cap.scrollWidth <= cap.clientWidth + 1) break
      it.el.classList.add('dsws-folded')
      void cap.offsetWidth
    }
    cap.dataset.fold = String(targets.filter(function (el) {
      return el.classList.contains('dsws-folded')
    }).length)
    cap.classList.remove('dsws-no-anim')
  }
  React.useEffect(function () {
    // 第一性原理方案 B：胶囊宽度不再 JS 设像素，完全由 CSS 变量 --dsh-composer-card-max-width 驱动（与输入卡同源）。
    // 旧方案量具体 textarea 卡死 780 的根因已消除；此处仅负责内容折叠（applyFold）对可用宽度的响应。
    // 可用宽 = 胶囊 clientWidth（已由 CSS 随对话框 --dsh-conversation-column-width 自动伸缩），
    // 因此只需观察胶囊及其父容器的尺寸变化即可触发折叠，无需再监听输入框。
    const roFold = new ResizeObserver(function () { applyFold() })
    const roParent = new ResizeObserver(function () { applyFold() })
    const applyAll = function () { applyFold() }
    applyFold()
    if (foldRef.current) {
      roFold.observe(foldRef.current)
      try { if (foldRef.current.parentElement) roParent.observe(foldRef.current.parentElement) } catch(e){}
    }
    window.addEventListener('resize', applyAll)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(applyFold)
    const poll = setInterval(applyAll, 2000); try { if (isEnabled('debug')) log('debug', 'timer.schedule', { name: 'statusbar-poll', intervalMs: 2000 }) } catch (eL) {}
    return function () {
      try { roFold.disconnect() } catch (e) {}
      try { roParent.disconnect() } catch(e){}
      window.removeEventListener('resize', applyAll)
      clearInterval(poll)
    }
  }, [])
  // #196 · 状态栏胶囊移除 backend segment 后不再在此处挂 SwitchConfirmModal（仍由 Dock/Overlay 挂载，状态机保留）
  const _isGatePending = !!(_selSBGate && _selSBGate.pending && !!s.cwd)
  const _gateActive = _isOtherSBGate || _isGatePending
  // BUG2 修复（2026-08-28）：后端未确定（无 selection 或 backendId 为空）时只显示门控条——
  //   链快照（wf.chain）常早于选择回填到达，若此刻开放 setup/skills 黄条判定，
  //   全新工作区会「尚未初始化/技能缺失」黄条一闪而过，再跳到正确的 gate 蓝条。
  const _backendUndecided = !(_selSBGate && _selSBGate.backendId)
  // #663：今天出哪一条横幅改由清单决定（statusbar/bannerChain.js 的 guideBannerStep）——
  //   按 guideStepsFor(当前后端) 的顺序逐个看，第一个没过、且带横幅的那一步就是它；
  //   门控那一档读本地状态（上面那两个判定），其余读链快照。于是「黄条等仓库就绪」是顺序本身的结果：
  //   仓库那一步排在初始化之前，它没过就轮不到黄条（此前这条优先级链里根本没有仓库那一段）。
  const bannerStep = guideBannerStep(s, _gateActive || _backendUndecided)
  // #422 · 收起整个功能区：横幅上的叉收起横幅与胶囊状态栏（打破胶囊永不隐藏旧规）；默认展开，按工作区记住。
  const deckFolded = isBannerFolded(s.cwd)
  const foldBanner = function () { try { setBannerFolded(s.cwd, true) } catch (e) {} }
  const expandBanner = function () { try { setBannerFolded(s.cwd, false) } catch (e) {} }
  // 收放按钮：胶囊最右侧的“∨”图标（无文字，技能入口之后）；收起态为带文字的小按钮（悬停与无障碍文案保留全称）。
  const capsuleToggle = h(Tip, { content: tr('banner.foldDeck') }, h('span', { className: 'dsws-fold-toggle', onClick: function (e) { e.stopPropagation(); foldBanner() }, 'aria-label': tr('banner.foldDeck'), style: { display: 'inline-flex', alignItems: 'center', padding: '2px 2px', borderRadius: 6, color: 'var(--dsw-alias-label-caption,#8b8b95)', cursor: 'pointer', flex: 'none' } }, [
    Ic({ n: 'chev-down', size: 12 }),
  ]))
  // 弹窗座位（2026-09-21）：从这里渲染，不再挂在右侧面板的检查页上。
  //   为什么搬家：弹窗的**界面**本来就是全屏遮罩（`.dsws-modal` 是 position:fixed 挂到 body，样式见 kernel/styles.js），
  //   但它的 React 生命原来绑在检查页上（`Dock.js` 只在「面板当前页 = 检查」时渲染 ChecksTab），于是
  //     · 右侧面板没打开、或面板不在检查页时，点横幅那颗「创建并发布」按钮**什么都不会发生** ——
  //       状态写进去了（`slotRenderer-queue.js` 里 `m.open = true` 加 emit），却没有组件去渲染它；
  //       用户要等到哪天打开面板切到检查页，弹窗才突然冒出来（用户看到的是「点了没反应」与「出得很慢」两件事）。
  //     · 反方向同样错：在检查页点出来之后切到别的标签页，弹窗跟着消失。
  //   状态栏这一支挂在宿主的输入区 dock 上（panelAssembly.js 注册 conversation.input.dock），
  //   与右侧面板是否存在无关，正是「全应用之上」该有的宿主。三个分支（收起态 / 无横幅 / 有横幅）都要带上它：
  //   漏掉任何一支，那一支下点按钮就又会回到「什么都没有」。
  //   先例：同目录的 StatusLogMenu.js 就是从状态栏弹一张盖住全应用的小窗；组件本身取不到会话状态时自己返回 null。
  const modalSeat = (typeof FormModalSeat === 'function') ? h(FormModalSeat, { st: s }) : null
  if (deckFolded) {
    // 收起态：整个功能区只剩这一颗细小灰字按钮（点即恢复横幅与状态栏；设置页工作区行是另一条恢复路径）。
    // 2026-09-21 按维护者要求还原：2026-09-20 那两轮一度把它画成「有底色、有描边、12px 粗体、带面板图标」的按钮，
    //   维护者看过真机之后不认可那一下改动（收起态原本只有一句 10px 灰字，改完高了一倍多、显眼过头），
    //   要求退回改动前的样子。所以这里照原文写回：10px、无底色、无描边、圆角 99。
    //   收起与展开这条行为一点没动 —— 点它照样把横幅与胶囊一起带回来（下面那道「回来的路」门禁仍然钉着这一点）。
    // #640：收起态也套同一条几何 —— 三支容器的左右边必须同源，否则「收起 / 展开」之间会横向跳动。
    return h('div', { style: Object.assign({ display: 'flex', flex: 'none', justifyContent: 'center' }, dswsStatusDockGeom()) }, [
      h(Tip, { content: tr('banner.folded') }, h('button', { className: 'dsws-btn ghost', 'aria-label': tr('banner.expandDeck'), onClick: expandBanner, style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '0 8px', lineHeight: 1.2, border: 'none', borderRadius: 99, color: 'var(--dsws-alias-label-caption,#8b8b95)' } }, [
        Ic({ n: 'chev-up', size: 10 }),
        h('span', null, tr('banner.expandDeck')),
      ])),
      modalSeat,
    ])
  }
  // #522：调试开关关闭时小灰点不挂载（胶囊里不留空位）；开时常驻；开关切换经已有的日志开关广播刷新各会话界面，此处只读开关不另加广播。
  let logDotOn = false
  try { logDotOn = !!(typeof logSwitch !== 'undefined' && logSwitch && logSwitch.enabled === true) } catch (eLogDot) {}
  // 优化3：胶囊恒渲染（任何情况下不隐藏）；未选后端时其上方叠加 gate 蓝条引导入口
  const capsule = h('div', { className: 'dsws-capsule', ref: foldRef, onClick: function () { openPanel(s) }, style: { position: 'relative', width: '100%', boxSizing: 'border-box' } }, [
    h('span', { className: 'dsws-capsule-word', onClick: function (e) { e.stopPropagation(); togglePanel(s) } }, [
      Icon({ scheme: s.ui.icon, size: 14 }),
      h('span', { 'data-fold-priority': 1 }, tr('panel.title')),
    ]),
    h('span', { ref: takeAnchorRef, style: { position: 'relative', display: 'inline-flex' }, onMouseEnter: showTakeMenu, onMouseLeave: function () { scheduleClose(takeCloseRef, closeTakeMenu) } }, [
      h(Tip, { content: tr('nav.takeableTitle') }, seg('target', [h('span', { 'data-fold-priority': 5 }, tr('nav.takeable')), num(String(fr), '2ch')], '#4ade80', function () { s.stateFilter = 'frontier'; s.lblFilters = []; go('list') })),
      s.takeMenuOpen ? PortalOverlay({ className: 'dsws-takemenu', onMouseEnter: function () { clearClose(takeCloseRef) }, onMouseLeave: function () { scheduleClose(takeCloseRef, closeTakeMenu) }, onClick: function (e) { e.stopPropagation() }, style: { position: 'fixed', left: s.takeMenuPos ? s.takeMenuPos.left : 0, bottom: s.takeMenuPos ? s.takeMenuPos.bottom : 0, padding: 4, zIndex: 2147483000, background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,.45)' } }, [
        h('div', { onClick: function (e) { e.stopPropagation(); closeTakeMenu(); openTextInNewSession(s, newWayfinderText(s), newSessionTitleNew('requirement')) }, onMouseEnter: function () { if (!s.takeMenuHover) { s.takeMenuHover = true; emit(s) } }, onMouseLeave: function () { if (s.takeMenuHover) { s.takeMenuHover = false; emit(s) } }, style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: s.takeMenuHover ? '#c084fc' : 'var(--dsw-alias-label-primary,#e6edf3)', background: s.takeMenuHover ? 'rgba(192,132,252,.15)' : 'transparent', whiteSpace: 'nowrap' } }, [
          Ic({ n: 'map', size: 12, color: s.takeMenuHover ? '#d8b4fe' : '#c084fc' }),
          h('span', null, tr('nav.takeableNew')),
        ]),
      ]) : null,
    ]),
    h('span', { ref: bugAnchorRef, style: { position: 'relative', display: 'inline-flex' }, onMouseEnter: showBugMenu, onMouseLeave: function () { scheduleClose(bugCloseRef, closeBugMenu) } }, [
      h(Tip, { content: tr('nav.bugTitle') }, seg('alert', [h('span', { 'data-fold-priority': 6 }, tr('nav.bug')), num(String(bugN), '2ch')], '#f87171', function () { s.stateFilter = 'open'; s.lblFilters = ['bug']; go('list') })),
      s.bugMenuOpen ? PortalOverlay({ className: 'dsws-bugmenu', onMouseEnter: function () { clearClose(bugCloseRef) }, onMouseLeave: function () { scheduleClose(bugCloseRef, closeBugMenu) }, onClick: function (e) { e.stopPropagation() }, style: { position: 'fixed', left: s.bugMenuPos ? s.bugMenuPos.left : 0, bottom: s.bugMenuPos ? s.bugMenuPos.bottom : 0, padding: 4, zIndex: 2147483000, background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,.45)' } }, [
        h('div', { onClick: function (e) { e.stopPropagation(); closeBugMenu(); openTextInNewSession(s, newBugWayfinderText(s), newSessionTitleNew('bug')) }, onMouseEnter: function () { if (!s.bugMenuHover) { s.bugMenuHover = true; emit(s) } }, onMouseLeave: function () { if (s.bugMenuHover) { s.bugMenuHover = false; emit(s) } }, style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: s.bugMenuHover ? '#f87171' : 'var(--dsw-alias-label-primary,#e6edf3)', background: s.bugMenuHover ? 'rgba(248,113,113,.15)' : 'transparent', whiteSpace: 'nowrap' } }, [
          Ic({ n: 'bug', size: 12, color: s.bugMenuHover ? '#fca5a5' : '#f87171' }),
          h('span', null, tr('nav.bugNew')),
        ]),
      ]) : null,
    ]),
    h(Tip, { content: tr('nav.triageTitle') }, seg('search', [h('span', { 'data-fold-priority': 7 }, tr('nav.triage')), num(String(triageN), '2ch')], '#f59e0b', function () { s.stateFilter = 'open'; s.lblFilters = ['needs-triage']; go('list') })),
    h(Tip, { content: tr('nav.fixateTitle') }, seg('note', h('span', { 'data-fold-priority': 2 }, tr('nav.word')), '#c084fc', function () { injectFixate(s) })),
    h('span', { className: 'dsws-split' }, [
      h(Tip, { content: tr('nav.handoffTitle') }, h('span', { className: 'dsws-split-part', onClick: function (e) { e.stopPropagation(); doHandoff(s) }, 'aria-label': tr('nav.handoffTitle'), style: { color: '#58a6ff' } }, [
        Ic({ n: 'handoff', size: 12 }),
        h('span', { 'data-fold-priority': 3 }, tr('nav.handoff')),
      ])),
      h('span', { className: 'dsws-split-div' }),
      h(Tip, { content: s.handoffReady ? tr('nav.handoffReadyTitle') : tr('nav.handoffGreyTitle') }, h('span', { className: 'dsws-split-part', onClick: function (e) { e.stopPropagation(); doHandoffOpen(s) }, 'aria-label': s.handoffReady ? tr('nav.handoffReadyTitle') : tr('nav.handoffGreyTitle'), style: s.handoffReady ? { color: '#58a6ff' } : { color: '#8b8b95', opacity: 0.55, cursor: 'default' } }, [
        s.handoffSearching ? h('span', { className: 'dsws-spinner', style: { width: 12, height: 12, borderWidth: 2, boxSizing: 'border-box', display: 'inline-block', verticalAlign: '-2px' } }) : Ic({ n: s.handoffReady ? 'handoff-open' : 'handoff-off', size: 12 }),
      ])),
    ]),
    h(Tip, { content: tr('nav.envTitle', { n: n < 0 ? '?' : String(n), t: String(envTotal(s)) }) }, seg('dot', [h('span', { 'data-fold-priority': 8 }, tr('nav.env')), num(envLabel(s))], n < 0 ? '#f87171' : n === envTotal(s) ? '#4ade80' : '#f59e0b', function () { go('checks') })),
    h(Tip, { content: tr('nav.refreshTitle') }, h('span', { className: 'dsws-timebtn', onClick: function (e) { e.stopPropagation(); refreshAll(s) }, 'aria-label': tr('nav.refreshTitle') }, [h('span', { className: 'dsws-rficon' + (s.refreshing ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]), h('span', { 'data-fold-priority': 4 }, tr('nav.refresh')), h('span', { 'data-fold-priority': 9 }, ' ' + timeStr)])),
    h(SkillFloatList, { s: s }),
    logDotOn ? h(StatusLogDot, { s: s }) : null,
    capsuleToggle,
  ])
  // 状态栏后端选择与门控动作已搬 StatusBackend.js（B1 #460，纯结构；同闭包拼回直调）。
  // 以后改状态栏后端选择（setup 黄条与 gate 蓝条）的人改 StatusBackend.js，本处只留转调包装。
  // #663：横幅那条链（出哪一条、按钮点下去干什么）搬去 statusbar/bannerChain.js，
  //   所以原先「开选后端窗」与「点初始化」那两个转调包装删了 —— 两条都走 bannerChain 的统一入口。
  const cancelSetupPick = function(){ cancelStatusSetupPick(s) }
  const confirmSetupPick = function(){ confirmStatusSetupPick(s) }
  const closeGate = function(){ closeStatusGate(s) }
  const confirmGateStatus = function(){ confirmStatusGate(s) }
  // #655：这张卡由注入决策函数打开（黄条那颗按钮走 onStatusSetupInit，检查页红牌那颗「执行初始化」也走同一个函数）。
  // #669 第 4 件（2026-09-21）：这张卡只问「域文档布局」这一问。
  //   它原先还带着一组后端单选（标题也写着「选择希望使用的后端」），那是更早流程的遗留：到这一步后端早已在
  //   门控那一步定完（#663 起门控那个窗只问后端），再问一遍不只是多余 —— 卡上那颗「确认并继续」会把工作区
  //   重新绑一遍（等于从一张「只是答个布局」的卡上换后端）。现在卡上只读地写出这次用哪个后端、去哪儿换，
  //   换后端仍走右侧面板那颗「切换后端」。
  const setupPickCard = (s.setupLayoutCardOpen) ? (function(){
    const curId = (s.selection && s.selection.backendId) || (s.snapshot && s.snapshot.selection && s.snapshot.selection.backendId) || firstBackendIdOf(null)
    const curLabel = (typeof labelOf === 'function' ? labelOf(curId) : '') || (typeof builtinLabelOf === 'function' ? builtinLabelOf(curId) : '') || String(curId || '')
    return h('div', { style:{ width:'100%', maxWidth:560, border:'1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius:10, background:'var(--dsw-alias-bg-layer-2,#16181d)', padding:10, boxShadow:'0 8px 24px rgba(0,0,0,.35)' } }, [
      h('div', { style:{ fontSize:12, fontWeight:700, display:'flex', alignItems:'center', gap:6, marginBottom:8 } }, [Ic({n:'compass',size:12}), h('span', null, tr('setup.cardTitle'))]),
      layoutRadios(s, h),
      h('div', { style:{ fontSize:11, color:'#8b8b95', marginTop:8, lineHeight:1.5 } }, tr('setup.cardBackend', { name: curLabel })),
      h('div', { style:{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:10 } }, [
        h('button', { className:'dsws-btn ghost', onClick: cancelSetupPick, style:{ fontSize:12 } }, tr('banner.setupPickCancel')),
        h('button', { className:'dsws-btn', style:{ background:'#58a6ff', borderColor:'#58a6ff', color:'#0b1220', fontWeight:700 }, onClick: confirmSetupPick }, tr('banner.setupPickConfirm')),
      ]),
    ])
  })() : null
  if (!bannerStep) {
    // 无 banner 时为胶囊 + 常驻收起按钮（#422：收起即整个功能区消失）
    return h('div', { style: Object.assign({ display: 'flex', flex: 'none', flexDirection: 'column', alignItems: 'center', gap: 2, overflow: RDOM ? 'hidden' : 'visible' }, dswsStatusDockGeom()) }, [modalSeat, capsule])
  }
  const bann = function (text, btnLabel, onBtn, foldable) {
    // #669：这颗叉（收起整个功能区）与左边那颗主按钮之间留 12px —— 原来只隔 6px，两颗按钮长得一样高、
    //   一样是描边方块，用户冲黄条那颗主按钮点下去、手一偏就落在叉上，于是「点了黄条，整条状态栏全没了」。
    //   留开距离不能让手不偏，但能让两颗按钮在视觉上分成两组，点之前看得出来是两件事。这一段保留。
    // 2026-09-21 按维护者要求还原：2026-09-20 那次一度把它改成带字的「收起」（怕纯图形叉被读成「关掉这条黄条」），
    //   维护者看过真机之后要求退回改动前的图形叉。叉形字形 11px、悬停与无障碍名仍是全称「收起MattSkillsDeck」。
    return h('div', { className: 'dsws-banner warn', style: { margin: 0, maxWidth: 560, cursor: 'default' } }, [
      Ic({ n: 'alert', size: 13 }),
      h('span', { style: { flex: 1 } }, text),
      h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)' }, onClick: onBtn }, btnLabel),
      foldable ? h(Tip, { content: tr('banner.foldDeck') }, h('button', { className: 'dsws-btn ghost dsws-banner-fold-x', 'aria-label': tr('banner.foldDeck'), onClick: foldBanner, style: { borderColor: 'rgba(245,158,11,.6)', padding: '1px 6px', marginLeft: 12, display: 'inline-flex', alignItems: 'center' } }, Ic({ n: 'x', size: 11 }))) : null,
    ])
  }
  // #663：横幅就这一条 —— 正文与按钮标签用清单里那对词条键，按钮点下去照清单声明的 missing 走
  //   （注入哪段文案 / 开哪个弹窗 / 开选后端窗，都由 bannerChain.js 执行并落一行常驻日志）。
  const stepBanner = (function () {
    const meta = bannerStep.banner || {}
    // 蓝条那一档（后端还没选定）仍是今天这套样式，含「正在探测后端」那个过渡态。
    if (meta.tone === 'info') {
      return _isGatePending
        ? h('div', { className: 'dsws-banner warn', style: { margin: 0, maxWidth: 560, background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.35)', color:'#f59e0b', display:'flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:8 } }, [ h('span', { className:'dsws-spinner', style:{ width:12, height:12, borderWidth:2, display:'inline-block' } }), h('span', { style:{ flex:1, fontSize:12 } }, '正在探测后端'), h('button', { className:'dsws-btn', style:{ borderColor:'rgba(245,158,11,.6)', fontSize:11 }, onClick:function(){ loadSnapshot(s,true,true) } }, '重试'), h(Tip, { content: tr('banner.foldDeck') }, h('button', { className:'dsws-btn ghost dsws-banner-fold-x', 'aria-label': tr('banner.foldDeck'), style:{ borderColor:'rgba(245,158,11,.6)', color:'#f59e0b', padding:'1px 6px', marginLeft:12, display:'inline-flex', alignItems:'center' }, onClick: foldBanner }, Ic({ n:'x', size:11 }))) ])
        : h('div', { className: 'dsws-banner', style: { margin: 0, maxWidth: 560, background:'rgba(56,139,253,.10)', border:'1px solid rgba(56,139,253,.35)', color:'#58a6ff', display:'flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:8 } }, [ Ic({ n:'compass', size:13, color:'#58a6ff' }), h('span', { style:{ flex:1, fontSize:12 } }, tr(meta.text)), h('button', { className:'dsws-btn', style:{ borderColor:'rgba(56,139,253,.6)', color:'#58a6ff', fontSize:11 }, onClick: function(){ runGuideMissing(s, bannerStep) } }, tr(meta.btn)), h(Tip, { content: tr('banner.foldDeck') }, h('button', { className:'dsws-btn ghost dsws-banner-fold-x', 'aria-label': tr('banner.foldDeck'), style:{ borderColor:'rgba(56,139,253,.6)', color:'#58a6ff', padding:'1px 6px', marginLeft:12, display:'inline-flex', alignItems:'center' }, onClick: foldBanner }, Ic({ n:'x', size:11 }))) ])
    }
    const node = bann(tr(meta.text, guideBannerParams(s, bannerStep)), tr(meta.btn), function () { runGuideMissing(s, bannerStep) }, true)
    // 初始化那一步：正文下面还挂那张布局小卡（黄条那颗按钮点开它；卡的开关一直住在会话状态里）。
    const isSetupStep = !!(bannerStep.missing && bannerStep.missing.prompt === 'setupRun')
    return isSetupStep ? h('div', { style:{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, width:'100%' } }, [node, setupPickCard]) : node
  })()
  return h('div', { style: Object.assign({ display: 'flex', flex: 'none', flexDirection: 'column', alignItems: 'center', gap: 4, position: 'relative' }, dswsStatusDockGeom()) }, [

    stepBanner,
    capsule,
    modalSeat,
    (s.gateModalOpen && s.gateModalSource==='status' ? h('div', { onClick:function(e){ if(e.target===e.currentTarget) closeGate() }, style:{ position:'absolute', inset:0, background:'rgba(0,0,0,.65)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:10, borderRadius:8, padding:12 } }, [
      h('div', { style:{ background:'var(--dsw-alias-bg-layer-2,#16181d)', border:'1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius:12, padding:14, width:'92%', maxWidth:380, boxShadow:'0 8px 24px rgba(0,0,0,.5)' } }, [
        h('div', { style:{ fontSize:13, fontWeight:700, display:'flex', alignItems:'center', gap:6, marginBottom:6 } }, [Ic({n:'compass',size:14}), h('span', null, tr('switch.pleaseSelectTracker'))]),
        h('div', { style:{ fontSize:11, color:'#8b8b95', marginBottom:10, lineHeight:1.5 } }, tr('switch.gateIntro')),
        h('div', { style:{ fontSize:11, color:'#f59e0b', background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.25)', borderRadius:6, padding:'6px 8px', marginBottom:10 } }, tr('gate.wipNotice')),
        s.gateLoading ? h('div', { style:{ fontSize:11, color:'#8b8b95', padding:'6px 0' } }, tr('panel.loadingShort')) : h('div', { style:{ display:'flex', flexDirection:'column', gap:6 } }, otherFiltered(s.backendModules).map(function(m){
          const isSel=s.gateSelected===m.id; const col=(typeof backendColorOf==='function'?backendColorOf(m.id):'#6e7681'); const isRec=(s.backendModules||[])[0] && (s.backendModules||[])[0].id===m.id;
          return h('label', { key:m.id, style:{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:8, border:isSel?'1px solid '+col:'1px solid var(--dsw-alias-border-l1,#2a2d35)', background:isSel?'rgba(88,166,255,.08)':'transparent', cursor:'pointer' } }, [ h('input',{type:'radio',checked:isSel,onChange:function(){s.gateSelected=m.id;emit(s)}}), h('span',{style:{width:8,height:8,borderRadius:'50%',background:col,flex:'none'}}), h('span',{style:{fontSize:12,fontWeight:600}},m.label), h('span',{style:{fontSize:10,color:'#8b8b95'}},m.id), h('span',{style:{flex:1}}), isRec?h('span',{style:{fontSize:10,color:'#4ade80',border:'1px solid #4ade80',borderRadius:4,padding:'0 4px'}},'推荐'):null ])
        })),
        s.gateError ? h('div', { style:{ fontSize:11, color:'#f87171', marginTop:8 } }, s.gateError) : null,
        // #663：这个窗里那组「域文档布局」单选撤掉了 —— 全新工作区打开时还没装 gh、还没建仓库，
        //   问「各部分共用一套用语吗」是超前的问题；布局那一问现在只在初始化那一步出现（黄条弹的小卡），
        //   与之配套的「确认后不注入」一起改在 StatusBackend.js 的 confirmStatusGate（撤单选不撤注入会弹出一张没有座位的卡）。
        h('div', { style:{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 } }, [ h('button',{className:'dsws-btn ghost',onClick:closeGate,style:{fontSize:12}},'取消'), h('button',{className:'dsws-btn',style:{background:'#58a6ff',borderColor:'#58a6ff',color:'#0b1220',fontWeight:700,fontSize:12},onClick:confirmGateStatus},'确认并继续') ])
      ])
    ]) : null),
  ])
}