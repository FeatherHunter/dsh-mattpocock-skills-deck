/**
 * panel/Overlay.js — 主面板悬浮容器（OverlayPanel，5.8；tabs 行改用共享 Tabs.js）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
    // ---- 5.8 主面板（可拖动 · 8 向缩放 · 三视图 · v14 跟随当前会话 + 刷新遮罩）----
export     const OverlayPanel = (props) => {
      const cur = props.useSessions((x) => x.current)
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      const s = cx ? cx.storeSvc.useStore(cur) : useStore(cur)
      const panelRef = React.useRef(null)
      const tabsRef = React.useRef(null)
      const headRef = React.useRef(null)
      const tabs = useTabsRow(s, tabsRef)
      React.useEffect(function () {
        const applyFold = function () {
          const t = tabsRef.current
          if (!t) return
          const btns = t.querySelectorAll('[data-priority]')
          const ver = t.querySelector('.dsws-ver')
          // 测量阶段临时禁用 transition（max-width 动画会污染 scrollWidth 测量 → 0/6 抖动）
          t.classList.add('dsws-no-anim')
          // 1) 全展开 + 强制 reflow（拿到"内容真实放得下"的基准）
          for (let i = 0; i < btns.length; i++) btns[i].classList.remove('collapsed')
          if (ver) ver.classList.remove('collapsed')
          void t.offsetWidth
          // 2) 从最不重要（priority 大）逐个折叠，直到放得下（scrollWidth 溢出判定）
          const items = Array.from(btns)
            .map(function (b) { return { el: b, p: Number(b.dataset.priority || 99) } })
            .sort(function (a, b) { return b.p - a.p })
          for (const it of items) {
            if (t.scrollWidth <= t.clientWidth + 1) break
            it.el.classList.add('collapsed')
            void t.offsetWidth
          }
          // 3) 版本号跟随「刷新」(priority=3) 折叠；记录折叠数供 tooltip 门控
          if (ver) {
            const refreshCollapsed = t.querySelector('[data-priority="3"]')?.classList.contains('collapsed')
            ver.classList.toggle('collapsed', !!refreshCollapsed)
          }
          t.dataset.tabsLevel = String(t.querySelectorAll('[data-priority].collapsed').length)
          t.classList.remove('dsws-no-anim')
        }
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { applyFold() }) : null
        let observed = null
        const apply = function () {
          const t = tabsRef.current
          if (!t) return
          if (ro && observed !== t) {
            if (observed) { try { ro.unobserve(observed) } catch (e) { /* noop */ } }
            ro.observe(t)
            observed = t
          }
          applyFold()
        }
        apply()
        if (typeof window !== 'undefined') window.addEventListener('resize', apply)
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(apply)
        return function () { if (ro) ro.disconnect(); if (typeof window !== 'undefined') window.removeEventListener('resize', apply) }
      }, [s.open])
      // 头部自适应（Overlay）：同 Dock 逻辑，空间充足完整，挤压先藏标题文字，最后仅留 repo（#28）
      React.useEffect(function () {
        const applyHead = function () {
          const hd = headRef.current
          if (!hd) return
          const titleEl = hd.querySelector('[data-head-title]')
          const chip = hd.querySelector('[data-repo-chip]')
          const txt = chip && chip.querySelector('[data-repo-text]')
          if (!titleEl || !chip || !txt) return
          const repo = s.snapshot && s.snapshot.repo
          const full = repo ? repo.owner + '/' + repo.name : (s.snapMode === 'err' ? tr('panel.snapErr') : s.snapMode === 'loading' ? tr('panel.loading') : '')
          const short = repo ? repo.name : full
          const isRepo = !!(repo && repo.owner && repo.name)
          const naturalFits = function () {
            try { if (typeof measureContentWidth === 'function') return measureContentWidth(hd) <= hd.clientWidth + 1 } catch (e) {}
            return hd.scrollWidth <= hd.clientWidth + 1
          }
          titleEl.style.display = ''
          if (full) txt.textContent = full
          chip.style.flex = 'none'
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          titleEl.style.display = 'none'
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          if (isRepo) txt.textContent = short
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          chip.style.flex = '0 1 auto'
        }
        applyHead()
        let ro2 = null
        try { ro2 = new ResizeObserver(function () { applyHead() }); if (headRef.current) ro2.observe(headRef.current) } catch (e) {}
        const onWin = function () { applyHead() }
        if (typeof window !== 'undefined') window.addEventListener('resize', onWin)
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(applyHead)
        return function () { if (ro2) try { ro2.disconnect() } catch (e) {} ; if (typeof window !== 'undefined') window.removeEventListener('resize', onWin) }
      }, [s.snapshot && s.snapshot.repo && (s.snapshot.repo.owner + '/' + s.snapshot.repo.name), s.snapMode, s.size && s.size.w, s.open])
      // #376：加载由 openPanel 统一分派（未就绪/过期 force，新鲜直接展示）；此处不再重复加载
      if (!s.open) return null
      const groups = compute(s)
      const active = s.activeMap !== null ? groups.find(function (x) { return x.m.number === s.activeMap }) : null
      // v14-19：窄屏阈值（面板宽 <380px 时动作按钮折叠为纯图标）
      const narrow = s.size.w < 380
      // #187 Banner→Modal 门控（同 Dock：Banner 点→Modal 动态三选，不含 Other，取消/确认 + 两态等待）
      const _sel2 = s.selection || (s.snapshot && s.snapshot.selection) || null
      const _isPending2Raw = !!(_sel2 && _sel2.pending)
      const _isPending2 = _isPending2Raw && !!s.cwd && s.snapMode === 'real' && !!s.snapshot
      const _isOther2Raw = !!(_sel2 && _sel2.backendId===null && !_sel2.pending)
      const _isOther2 = _isOther2Raw && !!s.cwd && s.snapMode === 'real' && !!s.snapshot
      const _showBackendFullscreen2 = _isPending2 || _isOther2
      // Overlay 与 Dock 共享同一 store gate 状态（同一工作区同一 modal）
      const _gateOpen2 = !!s.gateModalOpen
      const _gateModules2 = otherFiltered(s.backendModules)
      const _openGateModal2 = function(){
        s.gateModalOpen = true
        if (!s.gateSelected) {
          const first = (_gateModules2 && _gateModules2[0]) ? _gateModules2[0].id : firstBackendIdOf(null)
          s.gateSelected = first
        }
        s.gateError = ''
        emit(s)
        if (typeof host !== 'undefined' && host.call) {
          s.gateLoading = true; emit(s)
          host.call('wf.registry', { cwd: s.cwd || '' }).then(function(r){
            s.gateLoading = false
            let mods = null
            if (r && r.ok && Array.isArray(r.modules)) mods = r.modules
            else if (r && Array.isArray(r.modules)) mods = r.modules
            else if (r && r.value && Array.isArray(r.value.modules)) mods = r.value.modules
            if (Array.isArray(mods) && mods.length) {
              const filtered = mods.filter(function(m){ return String(m.id).toLowerCase()!=='other' })
              const fin = filtered.length ? filtered : mods.filter(function(m){ return String(m.id).toLowerCase()!=='other' })
              if (fin.length) {
                s.backendModules = mods
                try{ if (typeof setPresentationMap==='function') setPresentationMap(mods) }catch(e){}
                const ids = fin.map(function(x){ return x.id })
                if (!s.gateSelected || ids.indexOf(s.gateSelected)<0) s.gateSelected = fin[0].id
              }
            }
            emit(s)
          }).catch(function(){ s.gateLoading=false; emit(s) })
        }
      }
      const _closeGateModal2 = function(){ s.gateModalOpen=false; s.gateError=''; emit(s) }
      const _confirmGate2 = function(){
        const id = s.gateSelected || ((_gateModules2[0] && _gateModules2[0].id)) || firstBackendIdOf(_gateModules2)
        if (String(id).toLowerCase()==='other') { s.gateError=tr('switch.gateOtherErr'); emit(s); return }
        const prev = s.selection
        const repoRef = s.repository || (s.snapshot && s.snapshot.repository) || null
        const next = { backendId: id, source: 'explicit', ref: repoRef }
        s.selection = next
        try{ if(s.cwd) setCachedSelection(s.cwd,next) }catch(e){}
        s.gateModalOpen=false
        emit(s)
        if(typeof host!=='undefined' && host.call){
          host.call('wf.bind', { cwd: s.cwd||'', backendId: id }).then(function(res){
            const ok = res && (res.ok===true || (res.value && res.value.ok===true) || res.ok)
            if(ok){
              s.tab='list'
              emit(s)
              try{ flash(s, tr('switch.bindOk', { label: (typeof labelOf==='function'?labelOf(id):String(id)) }), 'ok') }catch(e){}
              try{
                // #230（D10）：占位符由后端描述数据填充，UI 不再拼装
                const txt = (typeof setupRunPrompt==='function'? setupRunPrompt(s, id) : '')
                if (txt) { try{ inject(s, txt) }catch(e){} }
              }catch(e){}
              loadSnapshot(s,true,true)
            } else {
              s.selection=prev; try{ if(s.cwd) setCachedSelection(s.cwd,prev) }catch(e){}; emit(s)
              try{ flash(s, tr('switch.bindFail',{err:String((res&&(res.error||res.message))||'unknown').slice(0,120)}), 'warn') }catch(e){}
            }
          }).catch(function(e){
            s.selection=prev; try{ if(s.cwd) setCachedSelection(s.cwd,prev) }catch(e2){}; emit(s)
            try{ flash(s, '绑定失败:'+String(e && e.message || e).slice(0,120), 'warn') }catch(e3){}
          })
        }
      }
      const pickBackend2 = function(id){ s.gateSelected=id; emit(s); _confirmGate2() }

      const startDrag = function (e) {
        if (typeof document === 'undefined' || typeof window === 'undefined') return
        if (!panelRef.current) return
        e.preventDefault()
        const rect = panelRef.current.getBoundingClientRect()
        const r0 = { x: s.pos ? s.pos.x : rect.left, y: s.pos ? s.pos.y : rect.top, sx: e.clientX, sy: e.clientY }
        const mm = function (ev) { s.pos = { x: r0.x + ev.clientX - r0.sx, y: r0.y + ev.clientY - r0.sy }; emit(s) }
        const mu = function () { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
        document.addEventListener('mousemove', mm)
        document.addEventListener('mouseup', mu)
      }
      const onBodyDown = function (e) {
        if (e.target === e.currentTarget) startDrag(e)
      }

      const onResizeDown = function (dir) {
        return function (e) {
          e.stopPropagation()
          e.preventDefault()
          if (typeof document === 'undefined' || typeof window === 'undefined' || !panelRef.current) return
          const rect = panelRef.current.getBoundingClientRect()
          const r0 = { x: s.pos ? s.pos.x : rect.left, y: s.pos ? s.pos.y : rect.top, w: s.size.w || rect.width, h: s.size.h || rect.height, sx: e.clientX, sy: e.clientY }
          const mm = function (ev) {
            const dx = ev.clientX - r0.sx, dy = ev.clientY - r0.sy
            let w = r0.w, h = r0.h
            if (dir.indexOf('e') >= 0) w = r0.w + dx
            if (dir.indexOf('s') >= 0) h = r0.h + dy
            if (dir.indexOf('w') >= 0) w = r0.w - dx
            if (dir.indexOf('n') >= 0) h = r0.h - dy
            w = Math.min(900, Math.max(340, w))
            h = Math.min(920, Math.max(240, h))
            let x = r0.x, y = r0.y
            if (dir.indexOf('w') >= 0) x = r0.x + (r0.w - w)
            if (dir.indexOf('n') >= 0) y = r0.y + (r0.h - h)
            s.pos = { x: x, y: y }
            s.size = { w: w, h: h }
            emit(s)
          }
          const mu = function () { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
          document.addEventListener('mousemove', mm)
          document.addEventListener('mouseup', mu)
        }
      }

      // #191：面板内覆盖层锚点（Modal 就地渲染，position:absolute 相对本容器）
      const panelStyle = { position: 'relative', width: s.size.w, ...(s.size.h ? { height: s.size.h } : {}), ...(s.pos ? { left: s.pos.x, top: s.pos.y, right: 'auto' } : { left: 16, top: 76, right: 'auto' }) }
      return h('div', { ref: panelRef, className: 'dsws-panel', style: panelStyle }, [
        // #28 自适应头部：minWidth 0 允许收缩，先藏标题文字（留图标），最后仅留 repo
        h('div', { ref: headRef, className: 'dsws-head', onMouseDown: startDrag, style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } }, [
          Icon({ scheme: s.ui.icon, size: 17 }),
          h('span', { 'data-head-title': 1, style: { fontWeight: 600, whiteSpace: 'nowrap', flex: 'none' } }, tr('panel.title')),
          // v19-35：「真数据」→ 显示 repo 名；#190 Markdown 本地文件夹分支（backend==='markdown' 时 host.call('wf.openFolder',{cwd})，GitHub/GitLab 保持 openUrl）
          (function(){
            const repoRef = (s.repository || (s.snapshot && s.snapshot.repository) || null)
            const sel = s.selection || (s.snapshot && s.snapshot.selection) || null
            const isErr = s.snapMode === 'err'
            const isLoading = s.snapMode === 'loading'
            if (isErr || isLoading || !repoRef) {
              return h('span', { 'data-repo-chip': 1, className: 'dsws-chip ' + (isErr ? 'dsws-chip-t' : 'dsws-chip-m'), style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: '0 1 auto', minWidth: 40, maxWidth: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default' } }, [
                Ic({ n: isErr ? 'alert' : 'info', size: 11 }),
                h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullRepo')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, repoStr(s))]) }, h('span', { 'data-repo-text': 1, className: 'dsws-ellip', 'aria-label': repoStr(s), style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, isErr ? tr('panel.snapErr') : isLoading ? tr('panel.loading') : repoStr(s))),
              ])
            }
            const bid = sel ? sel.backendId : (repoRef.backend || firstBackendIdOf(null))
            // #231（契约动作）：开仓行为由后端 openRepository 声明驱动 —— folder 型注入 wf.openFolder，url 型浏览器原生新窗；无声明且无 url 即无动作（诚实渲染）
            const act = repositoryActionOf(s, bid)
            const href = repoRef.url || ''
            const displayName = repoRef.name || repoStr(s)
            const baseStyle = { display: 'inline-flex', alignItems: 'center', gap: 4, flex: '0 1 auto', minWidth: 40, maxWidth: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
            const chipClass = 'dsws-chip ' + (isErr ? 'dsws-chip-t' : 'dsws-chip-m')
            const inner = [Ic({ n: isErr ? 'alert' : 'info', size: 11 }), h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullRepo')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, displayName)]) }, h('span', { 'data-repo-text': 1, className: 'dsws-ellip', 'aria-label': displayName, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, displayName))]
            if (act === 'folder') {
              return h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullRepo')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, displayName), h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px', marginTop: 2 } }, tr('tip.header.repoAction'))]) }, h('a', { href: 'javascript:void(0)', 'data-repo-chip': 1, className: chipClass, style: Object.assign({}, baseStyle, { cursor:'pointer', textDecoration:'none' }), 'aria-label': displayName, onClick: function(e){ try{ if(e&&e.preventDefault) e.preventDefault() }catch(_){}; try{ if(typeof host!=='undefined'&&host.call) host.call('wf.openFolder',{cwd: s.cwd||''}) }catch(__){} } }, inner))
            }
            if (href) {
              // #191（用户反馈）：GitHub/GitLab 路径只 target='_blank'（浏览器原生新窗口），去掉 onClick openUrl 防双开
              return h(Tip, { content: tr('panel.repoTitle') }, h('a', { href: href, target: '_blank', rel: 'noreferrer', 'data-repo-chip': 1, className: chipClass, style: Object.assign({}, baseStyle, { cursor:'pointer', textDecoration:'none' }), 'aria-label': tr('panel.repoTitle') }, inner))
            }
            return h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullRepo')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, displayName)]) }, h('span', { 'data-repo-chip': 1, className: chipClass, style: Object.assign({}, baseStyle, { cursor:'default' }), 'aria-label': displayName }, inner))
          })(),
          // #191 · 仓库名右侧切换按钮（与 Dock 镜像 · pending 灰置 · _isOther 隐藏）
          (function(){ if(_isOther2) return null; var _sel=s.selection||(s.snapshot&&s.snapshot.selection)||null, _bid=_sel?_sel.backendId:null; if(_bid==null) return null; var _pend=!!(_sel&&_sel.pending), _col=(typeof backendColorOf==='function'?backendColorOf(_bid):'#6e7681'); return h(Tip, { content: _pend ? '切换后端 · 探测中不可用' : '切换后端' }, h('button',{'data-repo-switch':1,type:'button','aria-label':'切换后端','aria-disabled':_pend?'true':'false',disabled:_pend,onClick:function(e){try{if(e&&e.preventDefault)e.preventDefault();if(e&&e.stopPropagation)e.stopPropagation()}catch(_){};if(_pend)return;try{openSwitchConfirm(s,null)}catch(_){}},style:{display:'inline-flex',alignItems:'center',justifyContent:'center',width:16,height:16,borderRadius:4,flex:'none',border:'1px solid '+_col,color:_col,background:'transparent',cursor:_pend?'not-allowed':'pointer',opacity:_pend?0.45:1,fontSize:10,lineHeight:1,padding:0,colorScheme:'light dark'}},Ic({n:'swap',size:10}))) })(),
          h('span', { style: { flex: 1 } }),
          h(Tip, { content: tr('panel.closeTitle') }, h('button', { className: 'dsws-btn ghost', 'aria-label': tr('panel.closeTitle'), onClick: function () { s.open = false; emit(s) }, style: { display: 'inline-flex', alignItems: 'center' } }, Ic({ n: 'x', size: 12 }))),
        ]),
                (_isPending2 || _isOther2) ? null : h('div', { className: 'dsws-tabs', ref: tabsRef, style: { display: 'flex', alignItems: 'center', gap: 4 } }, tabs.items),
        _isPending2 ? h('div', { className: 'dsws-body', onMouseDown: onBodyDown, style:{ display:'flex', alignItems:'center', justifyContent:'center', padding:'12px' } }, [
          h('div', { style:{ width:'92%', maxWidth:420, background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.35)', borderRadius:12, padding:'14px 16px', display:'flex', flexDirection:'column', gap:10 } }, [
            h('div', { style:{ display:'flex', alignItems:'center', gap:8 } }, [
              h('span', { className:'dsws-spinner', style:{ width:16, height:16, borderWidth:2, display:'inline-block' } }),
              h('div', { style:{ flex:1 } }, [
                h('div', { style:{ fontSize:13, fontWeight:700, color:'#f59e0b' } }, '正在探测后端'),
                h('div', { style:{ fontSize:11, color:'#f59e0b', marginTop:2 } }, '3s 超时未决 — 若长时间停留请手动选择'),
              ]),
            ]),
            h('div', { style:{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 } }, [
              h('button', { className:'dsws-btn', onClick:function(){ s.tab='list'; emit(s); _openGateModal2() }, style:{ fontSize:11, padding:'4px 10px' } }, '去设置页选择'),
              h('button', { className:'dsws-btn primary', onClick:function(){ loadSnapshot(s,true,true) }, style:{ background:'#f59e0b', borderColor:'transparent', color:'#fff', fontSize:11, padding:'4px 10px' } }, '重试探测'),
            ]),
          ])
        ]) : _isOther2 ? h('div', { className: 'dsws-body', onMouseDown: onBodyDown, style:{ position:'relative', display:'flex', flexDirection:'column', gap:10, padding:'12px' } }, [
          h('div', { onClick: _openGateModal2, style:{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', background:'rgba(56,139,253,.10)', border:'1px solid rgba(56,139,253,.35)', borderRadius:10, cursor:'pointer', color:'#58a6ff', fontSize:12, fontWeight:600 } }, [
            Ic({ n: 'compass', size:14, color:'#58a6ff' }),
            h('span', { style:{ flex:1 } }, '该工作区还没有设置 — 点击选择后端'),
            h('span', { style:{ fontSize:11, color:'#58a6ff', border:'1px solid rgba(56,139,253,.4)', borderRadius:6, padding:'1px 6px', background:'rgba(56,139,253,.12)' } }, '去选择'),
          ]),
          h('div', { style:{ fontSize:11, color:'#8b8b95', padding:'0 2px' } }, '选择后将回到主线流程（列表/状态栏正常可用），仅设置页可见引导已隐藏主线'),
          _gateOpen2 ? h('div', { onClick:function(e){ if(e.target===e.currentTarget) _closeGateModal2() }, style:{ position:'absolute', inset:0, background:'rgba(0,0,0,.55)', display:'flex', alignItems:'center', justifyContent:'center', padding:'16px', zIndex:5 } }, [
            h('div', { style:{ background:'var(--dsw-alias-bg-layer-2,#16181d)', border:'1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius:12, padding:'16px', width:'92%', maxWidth:380, boxShadow:'0 8px 24px rgba(0,0,0,.5)' } }, [
              h('div', { style:{ fontSize:13, fontWeight:700, display:'flex', alignItems:'center', gap:6, marginBottom:6 } }, [Ic({n:'compass',size:14}), h('span', null, '请选择 Tracker 后端以继续')]),
              h('div', { style:{ fontSize:11, color:'#8b8b95', marginBottom:10, lineHeight:1.5 } }, '不同后端的初始化与前置检查不同，选择后将回到主线流程（列表/状态栏正常可用）'),
              s.gateLoading ? h('div', { style:{ fontSize:11, color:'#8b8b95', padding:'6px 0' } }, '加载中…') : h('div', { style:{ display:'flex', flexDirection:'column', gap:6 } }, _gateModules2.map(function(m){
                const isSel = s.gateSelected===m.id
                const col = (typeof backendColorOf==='function'? backendColorOf(m.id) : '')
                const isRec = _gateModules2[0] && _gateModules2[0].id===m.id
                return h('label', { key:m.id, style:{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:8, border: isSel ? '1px solid '+col : '1px solid var(--dsw-alias-border-l1,#2a2d35)', background: isSel ? 'rgba(88,166,255,.08)' : 'transparent', cursor:'pointer' } }, [
                  h('input', { type:'radio', name:'dsws-gate-pick2', checked:isSel, onChange:function(){ s.gateSelected=m.id; emit(s) } }),
                  h('span', { style:{ width:8, height:8, borderRadius:'50%', background:col, flex:'none' } }),
                  h('span', { style:{ fontSize:12, fontWeight:600 } }, m.label),
                  h('span', { style:{ fontSize:10, color:'#8b8b95' } }, m.id),
                  h('span', { style:{ flex:1 } }),
                  isRec ? h('span', { style:{ fontSize:10, color:'#4ade80', border:'1px solid #4ade80', borderRadius:4, padding:'0 4px', lineHeight:1.6 } }, '推荐') : null,
                ])
              })),
              s.gateError ? h('div', { style:{ fontSize:11, color:'#f87171', marginTop:8 } }, s.gateError) : null,
              h('div', { style:{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 } }, [
                h('button', { className:'dsws-btn ghost', onClick: _closeGateModal2, style:{ fontSize:12 } }, '取消'),
                h('button', { className:'dsws-btn primary', onClick: _confirmGate2, style:{ background:'#58a6ff', borderColor:'#58a6ff', color:'#0b1220', fontWeight:700, fontSize:12 } }, '确认并继续'),
              ]),
            ])
          ]) : null,
        ]) : h('div', { className: 'dsws-body', onMouseDown: onBodyDown }, [
          s.tab === 'list' ? (active ? h(MapDetail, { st: s, g: active }) : h(ListTab, { st: s, narrow: narrow })) : null,
          s.tab === 'skills' ? h(SkillsTab, { st: s }) : null,
          s.tab === 'checks' ? h(ChecksTab, { st: s }) : null,
        ]),
        h(Tip, { content: tr('rz.n') }, h('div', { className: 'dsws-rz dsws-rz-n', onMouseDown: onResizeDown('n'), 'aria-label': tr('rz.n') })),
        h(Tip, { content: tr('rz.s') }, h('div', { className: 'dsws-rz dsws-rz-s', onMouseDown: onResizeDown('s'), 'aria-label': tr('rz.s') })),
        h(Tip, { content: tr('rz.e') }, h('div', { className: 'dsws-rz dsws-rz-e', onMouseDown: onResizeDown('e'), 'aria-label': tr('rz.e') })),
        h(Tip, { content: tr('rz.w') }, h('div', { className: 'dsws-rz dsws-rz-w', onMouseDown: onResizeDown('w'), 'aria-label': tr('rz.w') })),
        h(Tip, { content: tr('rz.ne') }, h('div', { className: 'dsws-rz dsws-rz-ne', onMouseDown: onResizeDown('ne'), 'aria-label': tr('rz.ne') })),
        h(Tip, { content: tr('rz.nw') }, h('div', { className: 'dsws-rz dsws-rz-nw', onMouseDown: onResizeDown('nw'), 'aria-label': tr('rz.nw') })),
        h(Tip, { content: tr('rz.se') }, h('div', { className: 'dsws-rz dsws-rz-se', onMouseDown: onResizeDown('se'), 'aria-label': tr('rz.se') })),
        h(Tip, { content: tr('rz.sw') }, h('div', { className: 'dsws-rz dsws-rz-sw', onMouseDown: onResizeDown('sw'), 'aria-label': tr('rz.sw') })),
        // #189 · 切换三选一 Modal（全局 per-store）
        (s.switchConfirm && s.switchConfirm.open && typeof SwitchConfirmModal === 'function' ? h(SwitchConfirmModal, { sessionId: cur }) : null),
        // v1.5 T10 R7：刷新遮罩已废除（手动刷新走静默路径，无「刷新中」）
        s.notice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
          Ic({ n: noticeIcon(s.notice.kind), size: 13, color: NOTICE_COLOR[s.notice.kind] || '#4ade80' }),
          h('span', null, s.notice.text),
        ]) : null,
      ])
    }
