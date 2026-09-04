/**
 * statusbar/StatusBar.js — 输入区状态栏（5.2）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回 src/client/index.js（spliced）。
 */
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
    const apply = function (cwd) {
      if (cwd && cwd !== s.cwd) {
        s.cwd = cwd
        const hydrated = hydrateFromCache(s)
        emit(s)
        loadChain(s, false)
        if (!hydrated || !snapFresh(s)) loadSnapshot(s, false, !!hydrated)
      }
    }
    if (summaryCwd) { apply(summaryCwd); return }
    const cwd0 = detectCwd(props && props.session)
    if (cwd0) { apply(cwd0); return }
    if (sid && typeof host !== 'undefined' && typeof host.call === 'function') {
      host.call('wf.cwd', { sessionId: sid }).then(function (res) {
        if (res && res.ok && res.cwd) apply(res.cwd)
      }).catch(function () {})
    }
  }, [sid, summaryCwd])
  React.useEffect(function () { loadChain(s, false); if (!snapFresh(s)) loadSnapshot(s, false, true) }, [])
  const csx = checksumsOf(s)
  const { fr, bugN, triageN, n, timeStr, setup, amber, skillsCheck, skillsBad, ghCliBad, ghAuthBad } = csx
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
  const backendAnchorRef = React.useRef(null)
  const backendCloseRef = React.useRef(null)
  // 状态栏悬浮菜单定位与开关已搬 StatusMenus.js（B1 #460，纯结构；同闭包拼回直调）。
  // 以后改悬浮菜单跟随定位与开关的人改 StatusMenus.js，本处只留转调包装。
  const clearClose = function(ref){ clearStatusClose(ref) }
  const scheduleClose = function(ref, fn){ scheduleStatusClose(ref, fn) }
  const closeBugMenu = function(){ closeStatusBugMenu(s, bugCloseRef) }
  const showBugMenu = function(){ showStatusBugMenu(s, bugAnchorRef, bugCloseRef) }
  // 菜单重定位副作用已搬 StatusMenus.js 的 useStatusMenus（B1 #460，同闭包拼回），此处单调供装配。
  useStatusMenus(s, { bugAnchorRef: bugAnchorRef, backendAnchorRef: backendAnchorRef, bugCloseRef: bugCloseRef, backendCloseRef: backendCloseRef })
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
    const poll = setInterval(applyAll, 2000)
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
  //   后端确定后才走依赖链引导（ghcli → ghauth → setup → skills）。
  const _backendUndecided = !(_selSBGate && _selSBGate.backendId)
  const firstBlock = (_gateActive || _backendUndecided) ? 'gate' : ghCliBad ? 'ghcli' : ghAuthBad ? 'ghauth' : amber ? 'setup' : skillsBad ? 'skills' : null
  // #422 · 收起整个功能区：横幅上的叉收起横幅与胶囊状态栏（打破胶囊永不隐藏旧规）；默认展开，按工作区记住。
  const deckFolded = isBannerFolded(s.cwd)
  const foldBanner = function () { try { setBannerFolded(s.cwd, true) } catch (e) {} }
  const expandBanner = function () { try { setBannerFolded(s.cwd, false) } catch (e) {} }
  // 收放按钮：胶囊最右侧的“∨”图标（无文字，技能入口之后）；收起态为带文字的小按钮（悬停与无障碍文案保留全称）。
  const capsuleToggle = h(Tip, { content: tr('banner.foldDeck') }, h('span', { className: 'dsws-fold-toggle', onClick: function (e) { e.stopPropagation(); foldBanner() }, 'aria-label': tr('banner.foldDeck'), style: { display: 'inline-flex', alignItems: 'center', padding: '2px 2px', borderRadius: 6, color: 'var(--dsw-alias-label-caption,#8b8b95)', cursor: 'pointer', flex: 'none' } }, [
    Ic({ n: 'chev-down', size: 12 }),
  ]))
  if (deckFolded) {
    // 收起态：只留一颗带文字的小按钮（点即恢复横幅与状态栏；设置页工作区行是另一条恢复路径）
    return h('div', { style: { display: 'flex', flex: 'none', justifyContent: 'center', padding: '0 8px' } }, [
      h(Tip, { content: tr('banner.folded') }, h('button', { className: 'dsws-btn ghost', 'aria-label': tr('banner.expandDeck'), onClick: expandBanner, style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '0 8px', lineHeight: 1.2, border: 'none', borderRadius: 99, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, [
        Ic({ n: 'chev-up', size: 10 }),
        h('span', null, tr('banner.expandDeck')),
      ])),
    ])
  }
  // 优化3：胶囊恒渲染（任何情况下不隐藏）；未选后端时其上方叠加 gate 蓝条引导入口
  const capsule = h('div', { className: 'dsws-capsule', ref: foldRef, onClick: function () { openPanel(s) }, style: { position: 'relative', width: '100%', boxSizing: 'border-box' } }, [
    h('span', { className: 'dsws-capsule-word', onClick: function (e) { e.stopPropagation(); togglePanel(s) } }, [
      Icon({ scheme: s.ui.icon, size: 14 }),
      h('span', { 'data-fold-priority': 1 }, tr('panel.title')),
    ]),
    h(Tip, { content: tr('nav.takeableTitle') }, seg('target', [h('span', { 'data-fold-priority': 5 }, tr('nav.takeable')), num(String(fr), '2ch')], '#4ade80', function () { s.stateFilter = 'frontier'; s.lblFilters = []; go('list') })),
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
    capsuleToggle,
  ])
  // 状态栏后端选择与门控动作已搬 StatusBackend.js（B1 #460，纯结构；同闭包拼回直调）。
  // 以后改状态栏后端选择（setup 黄条与 gate 蓝条）的人改 StatusBackend.js，本处只留转调包装。
  const cancelSetupPick = function(){ cancelStatusSetupPick(s) }
  const confirmSetupPick = function(){ confirmStatusSetupPick(s) }
  const onSetupInit = function(){ onStatusSetupInit(s) }
  const openGate = function(){ openStatusGate(s) }
  const closeGate = function(){ closeStatusGate(s) }
  const confirmGateStatus = function(){ confirmStatusGate(s) }
  const setupPickCard = s.setupPickOpen ? (function(){
    const mods=s.setupPickModules||[];const rec=s.setupPickRecommended||firstBackendIdOf(null);const sel=s.setupPickSelected||rec
    return h('div', { style:{ width:'100%', maxWidth:560, border:'1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius:10, background:'var(--dsw-alias-bg-layer-2,#16181d)', padding:10, boxShadow:'0 8px 24px rgba(0,0,0,.35)' } }, [
      h('div', { style:{ fontSize:12, fontWeight:700, display:'flex', alignItems:'center', gap:6, marginBottom:8 } }, [Ic({n:'compass',size:12}), h('span', null, tr('banner.setupPickTitle')), s.setupPickLoading ? h('span', {style:{fontSize:10,color:'#8b8b95'}}, tr('list.loading')) : null]),
      h('div', { style:{ fontSize:11, color:'#f59e0b', background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.25)', borderRadius:6, padding:'6px 8px', marginBottom:8 } }, tr('gate.wipNotice')),
      s.setupPickErr ? h('div', {style:{fontSize:11,color:'#f87171', marginBottom:6}}, s.setupPickErr) : null,
      h('div', { style:{ display:'flex', flexDirection:'column', gap:6 } }, (mods.length?mods:supportedBackendViews()).map(function(m){
        const isRec=rec===m.id;const isSel=sel===m.id;const col=typeof backendColorOf==='function'?backendColorOf(m.id):''
        return h('label', { key:m.id, style:{ display:'flex', alignItems:'center', gap:8, padding:'7px 9px', borderRadius:8, border: isSel ? '1px solid '+col : '1px solid var(--dsw-alias-border-l1,#2a2d35)', background: isSel ? 'rgba(88,166,255,.08)' : 'transparent', cursor:'pointer' } }, [
          h('input', { type:'radio', name:'setup-pick', checked: isSel, onChange: function(){ s.setupPickSelected=m.id; emit(s) } }),
          h('span', { style:{ width:8, height:8, borderRadius:'50%', background: col, flex:'none' } }),
          h('span', { style:{ fontSize:12, fontWeight:600 } }, m.label),
          h('span', { style:{ fontSize:10, color:'#8b8b95' } }, m.id),
          h('span', { style:{ flex:1 } }),
          isRec ? h('span', { style:{ fontSize:10, color:'#4ade80', border:'1px solid #4ade80', borderRadius:4, padding:'0 4px', lineHeight:1.6 } }, tr('banner.setupPickRecommended')) : null,
        ])
      })),
      h('div', { style:{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:10 } }, [
        h('button', { className:'dsws-btn ghost', onClick: cancelSetupPick, style:{ fontSize:12 } }, tr('banner.setupPickCancel')),
        h('button', { className:'dsws-btn', style:{ background:'#58a6ff', borderColor:'#58a6ff', color:'#0b1220', fontWeight:700 }, onClick: confirmSetupPick }, tr('banner.setupPickConfirm')),
      ]),
    ])
  })() : null
  if (!firstBlock) {
    // 无 banner 时为胶囊 + 常驻收起按钮（#422：收起即整个功能区消失）
    return h('div', { style: { display: 'flex', flex: 'none', flexDirection: 'column', alignItems: 'center', gap: 2, width: '100%', boxSizing: 'border-box', padding: '3px 8px 0', overflow: RDOM ? 'hidden' : 'visible' } }, [capsule])
  }
  const bann = function (text, btnLabel, onBtn, foldable) {
    return h('div', { className: 'dsws-banner warn', style: { margin: 0, maxWidth: 560, cursor: 'default' } }, [
      Ic({ n: 'alert', size: 13 }),
      h('span', { style: { flex: 1 } }, text),
      h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)' }, onClick: onBtn }, btnLabel),
      foldable ? h(Tip, { content: tr('banner.foldDeck') }, h('button', { className: 'dsws-btn ghost dsws-banner-fold-x', 'aria-label': tr('banner.foldDeck'), onClick: foldBanner, style: { borderColor: 'rgba(245,158,11,.6)', padding: '1px 6px', display: 'inline-flex', alignItems: 'center' } }, Ic({ n: 'x', size: 11 }))) : null,
    ])
  }
  return h('div', { style: { display: 'flex', flex: 'none', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '3px 8px 0', position:'relative' } }, [

    firstBlock === 'gate'
      ? (_isGatePending
          ? h('div', { className: 'dsws-banner warn', style: { margin: 0, maxWidth: 560, background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.35)', color:'#f59e0b', display:'flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:8 } }, [ h('span', { className:'dsws-spinner', style:{ width:12, height:12, borderWidth:2, display:'inline-block' } }), h('span', { style:{ flex:1, fontSize:12 } }, '正在探测后端'), h('button', { className:'dsws-btn', style:{ borderColor:'rgba(245,158,11,.6)', fontSize:11 }, onClick:function(){ loadSnapshot(s,true,true) } }, '重试'), h(Tip, { content: tr('banner.foldDeck') }, h('button', { className:'dsws-btn ghost dsws-banner-fold-x', 'aria-label': tr('banner.foldDeck'), style:{ borderColor:'rgba(245,158,11,.6)', color:'#f59e0b', padding:'1px 6px', display:'inline-flex', alignItems:'center' }, onClick: foldBanner }, Ic({ n:'x', size:11 }))) ])
          : h('div', { className: 'dsws-banner', style: { margin: 0, maxWidth: 560, background:'rgba(56,139,253,.10)', border:'1px solid rgba(56,139,253,.35)', color:'#58a6ff', display:'flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:8 } }, [ Ic({ n:'compass', size:13, color:'#58a6ff' }), h('span', { style:{ flex:1, fontSize:12 } }, tr('banner.gate')), h('button', { className:'dsws-btn', style:{ borderColor:'rgba(56,139,253,.6)', color:'#58a6ff', fontSize:11 }, onClick: openGate }, tr('banner.gateBtn')), h(Tip, { content: tr('banner.foldDeck') }, h('button', { className:'dsws-btn ghost dsws-banner-fold-x', 'aria-label': tr('banner.foldDeck'), style:{ borderColor:'rgba(56,139,253,.6)', color:'#58a6ff', padding:'1px 6px', display:'inline-flex', alignItems:'center' }, onClick: foldBanner }, Ic({ n:'x', size:11 }))) ]))
      : firstBlock === 'ghcli'
      // #195 修复(第二轮)：hint 直接为后端提供的完整 prompt（多态），UI 直接 inject；移除副按钮
      ? bann(tr('banner.ghcli'), tr('banner.ghcliBtn'), function () { var c = chainStep(s, 'gh:installed'); var h = (c && c.show && c.show.hint) || ''; if (h) inject(s, h) }, true)
      : firstBlock === 'ghauth'
        ? bann(tr('banner.ghauth'), tr('banner.ghauthBtn'), function () { var _bid=(s.selection&&s.selection.backendId!=null)?s.selection.backendId:null; var _mm=(typeof moduleMetaOf==='function'&&_bid!=null)?moduleMetaOf(s,_bid):null; var _pp=_mm&&_mm.prompts&&_mm.prompts.ghAuthLogin; var _lg=(typeof promptLang==='function')?promptLang():'zh'; var _t=_pp?((_lg==='en'&&_pp.en)?String(_pp.en):String(_pp.zh||'')):(typeof promptText==='function'?promptText('ghAuthLogin'):''); if(_t) inject(s,_t) }, true)
        : firstBlock === 'setup'
          ? h('div', { style:{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, width:'100%' } }, [
              bann(tr('banner.setup'), tr('banner.setupBtn'), onSetupInit, true),
              setupPickCard,
            ])
          : bann(tr('banner.skills', { list: (skillsCheck && skillsCheck.show && (skillsCheck.show.fallback || skillsCheck.show.desc || '')) || '' }), tr('banner.skillsBtn'), function () { inject(s, promptText('installSkills', installSkillsParams())) }, true),
    capsule,
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
        h('div', { style:{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 } }, [ h('button',{className:'dsws-btn ghost',onClick:closeGate,style:{fontSize:12}},'取消'), h('button',{className:'dsws-btn',style:{background:'#58a6ff',borderColor:'#58a6ff',color:'#0b1220',fontWeight:700,fontSize:12},onClick:confirmGateStatus},'确认并继续') ])
      ])
    ]) : null),
  ])
}