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
    ensureIssuePath(s); startIssuePathPoll(s)
  }, [])
  React.useEffect(function () {
    const apply = function (cwd) {
      if (cwd && cwd !== s.cwd) {
        s.cwd = cwd
        const hydrated = hydrateFromCache(s)
        emit(s)
        loadChecks(s, false)
        if (!hydrated || !snapFresh(s)) loadSnapshot(s, false)
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
  React.useEffect(function () { loadChecks(s, false); if (!snapFresh(s)) loadSnapshot(s, false) }, [])
  const csx = checksumsOf(s)
  const { fr, bugN, triageN, n, timeStr, setup, amber, skillsCheck, skillsBad, ghCliBad, ghAuthBad } = csx
  // #187 门控：未选择且非 pending 时状态栏整条 dsws-capsule 不渲染（仅设置页可见引导），pending 时保留等待态
  const _selSBGate = s.selection || (s.snapshot && s.snapshot.selection) || null
  const _isOtherSBGate = !!(_selSBGate && _selSBGate.backendId===null && !_selSBGate.pending)
  const go = function (tab) {
    if (_isOtherSBGate && tab!=='settings') { try{ s.tab='settings'; }catch(e){}; return }
    s.tab = tab; openPanel(s)
  }
  const inputRef = React.useRef(null)
  const foldRef = React.useRef(null)
  const bugAnchorRef = React.useRef(null)
  const bugCloseRef = React.useRef(null)
  const issuePathAnchorRef = React.useRef(null)
  const issuePathCloseRef = React.useRef(null)
  const backendAnchorRef = React.useRef(null)
  const backendCloseRef = React.useRef(null)
  const [iw, setIw] = React.useState(780)
  const placeOverlay = function (el, align) {
    if (!el || typeof window === 'undefined') return null
    const r = el.getBoundingClientRect()
    if (!r || (!r.width && !r.height)) return null
    const p = { bottom: Math.max(0, Math.round(window.innerHeight - r.top)) }
    if (align === 'right') p.right = Math.max(0, Math.round(window.innerWidth - r.right))
    else p.left = Math.max(0, Math.round(r.left))
    return p
  }
  const placeBugMenu = function () {
    const p = placeOverlay(bugAnchorRef.current, 'left')
    if (!p) return false
    const old = s.bugMenuPos
    if (old && old.left === p.left && old.bottom === p.bottom) return false
    s.bugMenuPos = p
    return true
  }
  const placeIssuePathPop = function () {
    const p = placeOverlay(issuePathAnchorRef.current, 'left')
    if (!p) return false
    if (p.left !== undefined && typeof window !== 'undefined' && window.innerWidth) {
      const maxLeft = Math.max(8, window.innerWidth - 320)
      if (p.left > maxLeft) p.left = maxLeft
    }
    const old = s.issuePathPos
    if (old && old.left === p.left && old.bottom === p.bottom) return false
    s.issuePathPos = p
    return true
  }
  const clearClose = function (ref) {
    if (ref.current !== null) { clearTimeout(ref.current); ref.current = null }
  }
  const closeBugMenu = function () {
    clearClose(bugCloseRef)
    if (!s.bugMenuOpen && !s.bugMenuPos && !s.bugMenuHover) return
    s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; emit(s)
  }
  const closeIssuePath = function () {
    clearClose(issuePathCloseRef)
    if (!s.issuePathHover && !s.issuePathPos) return
    s.issuePathHover = false; s.issuePathPos = null; emit(s)
  }
  const scheduleClose = function (ref, fn) {
    clearClose(ref)
    ref.current = setTimeout(function () { ref.current = null; fn() }, 160)
  }
  const showBugMenu = function () {
    clearClose(bugCloseRef)
    let changed = false
    if (s.skillsOpen || s.skillPopPos || s.skillHover || s.skillTip) { s.skillsOpen = false; s.skillHover = null; s.skillTip = null; s.skillPopPos = null; changed = true }
    if (!s.bugMenuOpen) { s.bugMenuOpen = true; changed = true }
    if (placeBugMenu()) changed = true
    if (changed) emit(s)
  }
  const showIssuePath = function () {
    clearClose(issuePathCloseRef); clearClose(bugCloseRef); clearClose(backendCloseRef)
    let changed = false
    if (s.bugMenuOpen || s.bugMenuPos || s.bugMenuHover) { s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; changed = true }
    if (s.backendMenuOpen || s.backendMenuPos) { s.backendMenuOpen = false; s.backendMenuPos = null; changed = true }
    if (s.skillsOpen || s.skillPopPos || s.skillHover || s.skillTip) { s.skillsOpen = false; s.skillHover = null; s.skillTip = null; s.skillPopPos = null; changed = true }
    if (!s.issuePathHover) { s.issuePathHover = true; changed = true }
    if (placeIssuePathPop()) changed = true
    if (changed) emit(s)
  }
  const placeBackendMenu = function () {
    const p = placeOverlay(backendAnchorRef.current, 'left')
    if (!p) return false
    const old = s.backendMenuPos
    if (old && old.left === p.left && old.bottom === p.bottom) return false
    s.backendMenuPos = p
    return true
  }
  const closeBackendMenu = function () {
    clearClose(backendCloseRef)
    if (!s.backendMenuOpen && !s.backendMenuPos) return
    s.backendMenuOpen = false; s.backendMenuPos = null; emit(s)
  }
  const showBackendMenu = function () {
    clearClose(backendCloseRef); clearClose(bugCloseRef); clearClose(issuePathCloseRef)
    let changed = false
    if (s.bugMenuOpen || s.bugMenuPos || s.bugMenuHover) { s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; changed = true }
    if (s.issuePathHover || s.issuePathPos) { s.issuePathHover = false; s.issuePathPos = null; changed = true }
    if (s.skillsOpen || s.skillPopPos || s.skillHover || s.skillTip) { s.skillsOpen = false; s.skillHover = null; s.skillTip = null; s.skillPopPos = null; changed = true }
    if (!s.backendMenuOpen) { s.backendMenuOpen = true; changed = true }
    if (placeBackendMenu()) changed = true
    if (changed) emit(s)
  }
  React.useEffect(function () {
    if (!s.bugMenuOpen && !s.issuePathHover && !s.backendMenuOpen) return undefined
    let raf = null
    let disposed = false
    const reposition = function () {
      if (disposed || raf !== null) return
      const run = function () {
        raf = null
        if (disposed) return
        let changed = false
        if (s.bugMenuOpen && placeBugMenu()) changed = true
        if (s.issuePathHover && placeIssuePathPop()) changed = true
        if (s.backendMenuOpen && placeBackendMenu()) changed = true
        if (changed) emit(s)
      }
      if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(run)
      else raf = setTimeout(run, 0)
    }
    document.addEventListener('scroll', reposition, { capture: true, passive: true })
    window.addEventListener('resize', reposition)
    const ro = new ResizeObserver(reposition)
    if (bugAnchorRef.current) ro.observe(bugAnchorRef.current)
    if (issuePathAnchorRef.current) ro.observe(issuePathAnchorRef.current)
    if (backendAnchorRef.current) ro.observe(backendAnchorRef.current)
    reposition()
    return function () {
      disposed = true
      ro.disconnect()
      if (raf !== null) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
        else clearTimeout(raf)
      }
      document.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      clearClose(bugCloseRef); clearClose(issuePathCloseRef); clearClose(backendCloseRef)
    }
  }, [s.bugMenuOpen, s.issuePathHover])
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
    const ta = document.querySelector('textarea.uV2eYG_input')
    if (ta) inputRef.current = ta
    const applyInput = function () {
      if (!inputRef.current) return
      try { setIw(inputRef.current.getBoundingClientRect().width) } catch (e) {}
    }
    applyInput()
    const roInput = new ResizeObserver(applyInput)
    if (inputRef.current) roInput.observe(inputRef.current)
    const roFold = new ResizeObserver(function () { applyFold() })
    const applyAll = function () { applyInput(); applyFold() }
    applyFold()
    if (foldRef.current) roFold.observe(foldRef.current)
    window.addEventListener('resize', applyAll)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(applyFold)
    const poll = setInterval(applyAll, 2000)
    return function () {
      try { roInput.disconnect() } catch (e) {}
      try { roFold.disconnect() } catch (e) {}
      window.removeEventListener('resize', applyAll)
      clearInterval(poll)
    }
  }, [])
  const capsule = _isOtherSBGate ? null : h('div', { className: 'dsws-capsule', ref: foldRef, onClick: function () { if(_isOtherSBGate) return; openPanel(s) }, style: { position: 'relative', width: iw + 'px', maxWidth: iw + 'px' } }, [
    h('span', { className: 'dsws-capsule-word', onClick: function (e) { e.stopPropagation(); togglePanel(s) } }, [
      Icon({ scheme: s.ui.icon, size: 14 }),
      h('span', { 'data-fold-priority': 1 }, tr('panel.title')),
    ]),
    seg('target', [h('span', { 'data-fold-priority': 5 }, tr('nav.takeable')), num(String(fr), '2ch')], '#4ade80', function () { s.stateFilter = 'frontier'; go('list') }, tr('nav.takeableTitle')),
    h('span', { ref: bugAnchorRef, style: { position: 'relative', display: 'inline-flex' }, onMouseEnter: showBugMenu, onMouseLeave: function () { scheduleClose(bugCloseRef, closeBugMenu) } }, [
      seg('alert', [h('span', { 'data-fold-priority': 6 }, tr('nav.bug')), num(String(bugN), '2ch')], '#f87171', function () { s.stateFilter = 'open'; s.lblFilters = ['bug']; go('list') }, tr('nav.bugTitle')),
      s.bugMenuOpen ? PortalOverlay({ className: 'dsws-bugmenu', onMouseEnter: function () { clearClose(bugCloseRef) }, onMouseLeave: function () { scheduleClose(bugCloseRef, closeBugMenu) }, onClick: function (e) { e.stopPropagation() }, style: { position: 'fixed', left: s.bugMenuPos ? s.bugMenuPos.left : 0, bottom: s.bugMenuPos ? s.bugMenuPos.bottom : 0, padding: 4, zIndex: 2147483000, background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,.45)' } }, [
        h('div', { onClick: function (e) { e.stopPropagation(); closeBugMenu(); openTextInNewSession(s, newBugWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newBug')) }, onMouseEnter: function () { if (!s.bugMenuHover) { s.bugMenuHover = true; emit(s) } }, onMouseLeave: function () { if (s.bugMenuHover) { s.bugMenuHover = false; emit(s) } }, style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: s.bugMenuHover ? '#f87171' : 'var(--dsw-alias-label-primary,#e6edf3)', background: s.bugMenuHover ? 'rgba(248,113,113,.15)' : 'transparent', whiteSpace: 'nowrap' } }, [
          Ic({ n: 'bug', size: 12, color: s.bugMenuHover ? '#fca5a5' : '#f87171' }),
          h('span', null, tr('nav.bugNew')),
        ]),
      ]) : null,
    ]),
    seg('search', [h('span', { 'data-fold-priority': 7 }, tr('nav.triage')), num(String(triageN), '2ch')], '#f59e0b', function () { s.stateFilter = 'open'; s.lblFilters = ['needs-triage']; go('list') }, tr('nav.triageTitle')),
    seg('note', h('span', { 'data-fold-priority': 2 }, tr('nav.word')), '#c084fc', function () { injectFixate(s) }, tr('nav.fixateTitle')),
    h('span', { className: 'dsws-split' }, [
      h('span', { className: 'dsws-split-part', onClick: function (e) { e.stopPropagation(); doHandoff(s) }, title: tr('nav.handoffTitle'), style: { color: '#58a6ff' } }, [
        Ic({ n: 'handoff', size: 12 }),
        h('span', { 'data-fold-priority': 3 }, tr('nav.handoff')),
      ]),
      h('span', { className: 'dsws-split-div' }),
      h('span', { className: 'dsws-split-part', onClick: function (e) { e.stopPropagation(); doHandoffOpen(s) }, title: s.handoffReady ? tr('nav.handoffReadyTitle') : tr('nav.handoffGreyTitle'), style: s.handoffReady ? { color: '#58a6ff' } : { color: '#8b8b95', opacity: 0.55, cursor: 'default' } }, [
        s.handoffSearching ? h('span', { className: 'dsws-spinner', style: { width: 12, height: 12, borderWidth: 2, boxSizing: 'border-box', display: 'inline-block', verticalAlign: '-2px' } }) : Ic({ n: s.handoffReady ? 'handoff-open' : 'handoff-off', size: 12 }),
      ]),
    ]),
    h('span', { ref: issuePathAnchorRef, style: { position: 'relative', display: 'inline-flex' }, onMouseEnter: showIssuePath, onMouseLeave: function () { scheduleClose(issuePathCloseRef, closeIssuePath) } }, [
      h('span', { className: 'dsws-seg' + (s.issuePathHover ? ' on' : ''), onClick: function (e) { e.stopPropagation(); if (s.issuePath && s.issuePath.current) { s.tab='list'; openPanel(s) } }, title: s.issuePath && s.issuePath.current ? '当前处理 #' + s.issuePath.current + ' · hover 查看路径 · 点击打开列表' : '尚未选择当前 Issue · 点击操作会自动记录', style: { display: 'inline-flex', alignItems: 'center', gap: 4, color: s.issuePath && s.issuePath.current ? '#4ade80' : '#6b7280', border: s.issuePathHover ? '1px solid rgba(74,222,128,.45)' : '1px solid transparent', background: s.issuePathHover ? 'rgba(74,222,128,.12)' : 'transparent', borderRadius: 99, padding: '2px 7px' } }, [
        Ic({ n: 'pin', size: 12 }),
        h('span', { 'data-fold-priority': 10 }, s.issuePath && s.issuePath.current ? '#' + s.issuePath.current : '--'),
      ]),
      s.issuePathHover ? PortalOverlay({ className: 'dsws-issuepath-pop', onMouseEnter: function () { clearClose(issuePathCloseRef) }, onMouseLeave: function () { scheduleClose(issuePathCloseRef, closeIssuePath) }, onClick: function (e) { e.stopPropagation() }, style: { position: 'fixed', left: s.issuePathPos ? s.issuePathPos.left : 0, bottom: s.issuePathPos ? s.issuePathPos.bottom : 0, padding: 4, zIndex: 2147483000, background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,.45)', minWidth: 260, maxWidth: 380 } }, [
        h('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--dsw-alias-label-primary,#e6edf3)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 } }, [
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'pin', size: 12 }), h('span', null, '当前路径')]),
          h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', fontWeight: 400 } }, s.issuePath && s.issuePath.nodes && s.issuePath.nodes.length ? 'anchor #' + s.issuePath.anchor + ' · ' + s.issuePath.nodes.length + ' 节点' : '空'),
          h('span', { style: { marginLeft: 'auto', display: 'inline-flex', gap: 4 } }, [
            h('button', { className: 'dsws-btn ghost', onClick: function (e) { e.stopPropagation(); clearIssuePath(s); closeIssuePath() }, style: { fontSize: 10, padding: '2px 6px' } }, '清空'),
          ]),
        ]),
        (s.issuePath && s.issuePath.nodes && s.issuePath.nodes.length) ? h('div', { style: { maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 } }, s.issuePath.nodes.slice(-20).reverse().map(function (nd) {
          const isCur = nd.ref === s.issuePath.current
          const isAnchor = nd.ref === s.issuePath.anchor
          const t = new Date(nd.ts || Date.now()); const tm = String(t.getHours()).padStart(2,'0') + ':' + String(t.getMinutes()).padStart(2,'0')
          const srcColor = nd.source === 'claim' ? '#4ade80' : nd.source === 'gh-edit' ? '#58a6ff' : nd.source === 'mention' ? '#f59e0b' : '#8b8b95'
          const srcLabel = nd.source === 'claim' ? 'claim' : nd.source === 'gh-edit' ? 'gh-edit' : nd.source === 'mention' ? 'mention' : nd.source
          return h('div', { key: nd.ts + '-' + nd.ref, onClick: function (e) { e.stopPropagation(); reanchorIssuePath(s, nd.ref) }, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, background: isCur ? 'rgba(74,222,128,.14)' : 'transparent', border: isCur ? '1px solid rgba(74,222,128,.35)' : '1px solid transparent', cursor: 'pointer' } }, [
            h('span', { style: { fontSize: 11, fontFamily: 'Consolas,Menlo,monospace', color: isCur ? '#4ade80' : 'var(--dsw-alias-label-primary,#e6edf3)', fontWeight: isCur ? 700 : 500 } }, '#' + nd.ref + (isAnchor ? ' ⚓' : '')),
            h('span', { style: { fontSize: 10, color: srcColor, border: '1px solid ' + srcColor, borderRadius: 4, padding: '0 4px', lineHeight: 1.6 } }, srcLabel),
            h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, tm),
            nd.title ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } }, nd.title) : null,
            isCur ? h('span', { style: { fontSize: 10, color: '#4ade80', fontWeight: 700 } }, '← 当前') : null,
          ])
        })) : h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', padding: '6px 0' } }, '暂无路径 · 点击任意 issue 行的“执行/诊断/修复”或在新会话中打开 issue 会自动记录'),
        h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', marginTop: 6, paddingTop: 4, display: 'flex', alignItems: 'center', gap: 4 } }, [
          h('span', null, '点击节点可重锚起点'),
          h('span', { style: { marginLeft: 'auto' } }, '上限 100 · 本地持久'),
        ]),
      ]) : null,
    ]),
    seg('dot', [h('span', { 'data-fold-priority': 8 }, tr('nav.env')), num(envLabel(s))], n < 0 ? '#f87171' : n === envTotal(s) ? '#4ade80' : '#f59e0b', function () { go('checks') }, tr('nav.envTitle', { n: n < 0 ? '?' : String(n), t: String(envTotal(s)) })),
    h('span', { className: 'dsws-timebtn', onClick: function (e) { e.stopPropagation(); refreshAll(s) }, title: tr('nav.refreshTitle') }, [h('span', { className: 'dsws-rficon' + (s.refreshing ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]), h('span', { 'data-fold-priority': 4 }, tr('nav.refresh')), h('span', { 'data-fold-priority': 9 }, ' ' + timeStr)]),
    h(SkillFloatList, { s: s }),
  ])
  // #196 · 状态栏胶囊移除 backend segment 后不再在此处挂 SwitchConfirmModal（仍由 Dock/Overlay 挂载，状态机保留）
  const firstBlock = ghCliBad ? 'ghcli' : ghAuthBad ? 'ghauth' : amber ? 'setup' : skillsBad ? 'skills' : null
  const fbMods = [{id:'github',label:'GitHub'},{id:'markdown',label:'Markdown'},{id:'gitlab',label:'GitLab'}]
  const normMods = function(r){
    let ms=null
    if(r&&r.ok&&r.value&&Array.isArray(r.value.modules)) ms=r.value.modules
    else if(r&&r.ok&&Array.isArray(r.modules)) ms=r.modules
    else if(r&&r.modules&&Array.isArray(r.modules)) ms=r.modules
    if(!Array.isArray(ms)) return null
    const f=ms.filter(function(m){return String(m.id).toLowerCase()!=='other'})
    return f.length?f:fbMods.slice()
  }
  const ensureSetupPickModules = function(cb){
    if(s.setupPickModules&&s.setupPickModules.length){cb(s.setupPickModules);return}
    if(typeof host==='undefined'||typeof host.call!=='function'){s.setupPickModules=fbMods.slice();cb(s.setupPickModules);return}
    s.setupPickLoading=true;emit(s)
    host.call('wf.registry',{cwd:s.cwd||''}).then(function(r){
      s.setupPickLoading=false
      const ms=normMods(r)
      if(ms){s.setupPickModules=ms;const cur=s.selection&&s.selection.backendId!=null?s.selection.backendId:'github';s.setupPickRecommended=cur;if(!s.setupPickSelected)s.setupPickSelected=cur;emit(s);cb(ms);return}
      s.setupPickErr=String(r&&(r.error||r.message)||'unknown').slice(0,120);emit(s);cb([])
    }).catch(function(e){s.setupPickLoading=false;s.setupPickErr=String(e).slice(0,120);emit(s);cb([])})
  }
  const openSetupPick = function(){s.setupPickOpen=true;if(!s.setupPickSelected){const cur=s.selection&&s.selection.backendId!=null?s.selection.backendId:'github';s.setupPickSelected=cur;s.setupPickRecommended=cur}ensureSetupPickModules(function(){emit(s)});emit(s)}
  const closeSetupPick = function(){s.setupPickOpen=false;s.setupPickErr='';emit(s)}
  const cancelSetupPick = function(){closeSetupPick()}
  const confirmSetupPick = function(){
    const id=s.setupPickSelected||s.setupPickRecommended||'github'
    const line=typeof setupTrackerLine==='function'?setupTrackerLine(id):'本仓库为 GitHub \u2192 提议 GitHub Issues'
    const choice=typeof setupTrackerChoice==='function'?setupTrackerChoice(id):'GitHub Issues'
    const note=typeof setupBackendNote==='function'?setupBackendNote(id):''
    const prev=s.selection
    s.selection={backendId:id,source:'explicit',ref:(s.repository||(s.snapshot&&s.snapshot.repository)||null)}
    try{if(s.cwd)selectionByCwd[s.cwd]=s.selection}catch{}
    emit(s);closeSetupPick()
    if(typeof host!=='undefined'&&host.call)host.call('wf.bind',{cwd:s.cwd||'',backendId:id}).then(function(res){const ok=res&&(res.ok||(res.value&&res.value.ok));if(ok){try{flash(s,'已选择 '+(typeof labelOf==='function'?labelOf(id):id),'ok')}catch{};loadSnapshot(s,true,true)}else{s.selection=prev;emit(s);try{flash(s,'切换失败:'+String(res&&(res.error||res.message)||'unknown'),'warn')}catch{}}}).catch(function(){s.selection=prev;emit(s)})
    try{inject(s,promptText('setupRun',{trackerLine:line,trackerChoice:choice,backendNote:note}))}catch(e){try{inject(s,promptText('setupRun'))}catch{}}
  }
  const setupPickCard = s.setupPickOpen ? (function(){
    const mods=s.setupPickModules||[];const rec=s.setupPickRecommended||'github';const sel=s.setupPickSelected||rec
    return h('div', { style:{ width:'100%', maxWidth:560, border:'1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius:10, background:'var(--dsw-alias-bg-layer-2,#16181d)', padding:10, boxShadow:'0 8px 24px rgba(0,0,0,.35)' } }, [
      h('div', { style:{ fontSize:12, fontWeight:700, display:'flex', alignItems:'center', gap:6, marginBottom:8 } }, [Ic({n:'compass',size:12}), h('span', null, tr('banner.setupPickTitle')), s.setupPickLoading ? h('span', {style:{fontSize:10,color:'#8b8b95'}}, tr('list.loading')) : null]),
      s.setupPickErr ? h('div', {style:{fontSize:11,color:'#f87171', marginBottom:6}}, s.setupPickErr) : null,
      h('div', { style:{ display:'flex', flexDirection:'column', gap:6 } }, (mods.length?mods:fbMods).map(function(m){
        const isRec=rec===m.id;const isSel=sel===m.id;const col=typeof backendColorOf==='function'?backendColorOf(m.id):'#6e7681'
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
    if (_isOtherSBGate) return h('div', { style: { display: 'none' } }, [])
    return h('div', { style: { display: 'flex', flex: 'none', justifyContent: 'center', width: '100%', boxSizing: 'border-box', padding: '3px 8px 0', overflow: RDOM ? 'hidden' : 'visible' } }, [capsule])
  }
  const bann = function (text, btnLabel, onBtn) {
    return h('div', { className: 'dsws-banner warn', style: { margin: 0, maxWidth: 560, cursor: 'default' } }, [
      Ic({ n: 'alert', size: 13 }),
      h('span', { style: { flex: 1 } }, text),
      h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)' }, onClick: onBtn }, btnLabel),
    ])
  }
  return h('div', { style: { display: 'flex', flex: 'none', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '3px 8px 0' } }, [
    firstBlock === 'ghcli'
      // #195 修复：主按钮 inject 引导 + 副按钮外跳兜底（与 installSkills 同模式）
      ? h('div', { style: { display: 'flex', flex: 'none', gap: 4, alignItems: 'center' } }, [
          bann(tr('banner.ghcli'), tr('banner.ghcliBtn'), function () { inject(s, promptText('installGh')) }),
          // #195 副按钮兜底（仅当主按钮 inject 不可用时使用；语义保留 openUrl 但不阻塞主路径）
          h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)', fontSize: 11, padding: '2px 8px' }, onClick: function () { openUrl('https://cli.github.com/') } }, tr('banner.ghcliFallback')),
        ])
      : firstBlock === 'ghauth'
        ? bann(tr('banner.ghauth'), tr('banner.ghauthBtn'), function () { openUrl('https://cli.github.com/manual/gh_auth_login') })
        : firstBlock === 'setup'
          ? h('div', { style:{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, width:'100%' } }, [
              bann(tr('banner.setup'), tr('banner.setupBtn'), openSetupPick),
              setupPickCard,
            ])
          : bann(tr('banner.skills', { list: (skillsCheck && skillsCheck.detail) || '' }), tr('banner.skillsBtn'), function () { inject(s, promptText('installSkills')) }),
    capsule,
  ])
}
