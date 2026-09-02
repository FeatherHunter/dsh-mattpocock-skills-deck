/**
 * panel/Dock.js — 右侧停靠容器（DetailsDock，5.8b；tabs 行改用共享 Tabs.js）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
    // ---- 5.8b 右侧停靠（details 槽位 · 三视图完整内容；开合/拖拽/宽度记忆由壳管理）----
    // 契约：details 槽 = 壳右侧第三列（AppFrame grid），scope session；关闭 = ctx.layout.closeDetails()
    //   （占位者 props 亦注入 closeDetails）；宽度 300-520px 可拖拽；关闭时子树不卸载（状态保留）。
    // issue #15：tabs 行内容放不下时折叠为纯图标（内容自适应 + 滞回防抖）
export     const DetailsDock = (props) => {
      // #45 回归：切绘画/工作区后右面板串台——原实现挂载仅跑一次副作用（deps []）且直接取 props.sessionId（宿主 details 槽常空 → 退回 shared 单例），
      //   切会话不重跑水合、非 current 快照经 shared 广播串台；修复 = 跟随 useSessions 权威信号（hookCurrent）+ 精确 cwd（summaryCwd），副作用 deps 随 [sid]/[sid,summaryCwd] 重跑。
      const hookCurrent = (props && typeof props.useSessions === 'function') ? props.useSessions(function (x) { return x.current }) : undefined
      const propSid = props && (props.sessionId || (props.scope && props.scope.sessionId) || (props.session && props.session.id))
      const sid = propSid || hookCurrent
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      const summaryCwd = (props && typeof props.useSessions === 'function' && sid) ? props.useSessions(function (x) { return (x.byId && x.byId[sid]) ? x.byId[sid].cwd : undefined }) : undefined
      const s = cx ? cx.storeSvc.useStore(sid) : useStore(sid)
      const layoutSvc = ctx.get('layout')
      const dockRef = React.useRef(null)
      const [dw, setDw] = React.useState(460)
      // 列宽感知：details 列 300-520px；窄于 380 时动作按钮折叠为纯图标（与悬浮面板同阈值）
      React.useEffect(function () {
        if (!dockRef.current) return
        const el = dockRef.current
        const ro = new ResizeObserver(function (entries) {
          try { setDw(entries[0].contentRect.width) } catch (e) { /* 忽略 */ }
        })
        ro.observe(el)
        return function () { try { ro.disconnect() } catch (e) { /* 忽略 */ } }
      }, [])
      // #179 加固：响应式工作区同步（对齐 StatusBar）+ 回切自愈（同 sid 切工作区亦触发）
      React.useEffect(function () {
        const apply = function (cwd) {
          if (!cwd) return false
          const norm = (typeof keyOf==='function'?keyOf(cwd):String(cwd).replace(/\\/g,'/').replace(/\/+$/,''))
          const cur = (typeof keyOf==='function'?keyOf(s.cwd||''):String(s.cwd||'').replace(/\\/g,'/').replace(/\/+$/,''))
          const need = norm !== cur
          // 每次 cwd 变更都强制刷新（即使 hydrate 命中），避免“回切仍为旧快照/没有仓库”空白
          if (need) {
            s.cwd = cwd
            const hydrated = hydrateFromCache(s)
            emit(s)
            loadChain(s, false)
            // 回切必刷：cwd 变了就重拉快照（不依赖 snapFresh），确保仓库名与后端跟随
            loadSnapshot(s, false, !!hydrated)
            return true
          }
          // 同 cwd 但快照污染（repoRoot 前缀不匹配）也必刷
          const snap = s.snapshot
          let polluted = false
          if (snap && snap.repoRoot) {
            const rr = (typeof keyOf==='function'?keyOf(snap.repoRoot):String(snap.repoRoot).replace(/\\/g,'/').replace(/\/+$/,''))
            if (norm !== rr && !norm.startsWith(rr + '/') && !rr.startsWith(norm + '/')) polluted = true
          } else if (snap && snap.repository && snap.repository.name) {
            const n = String(snap.repository.name)
            if (!n.includes(':\\') && !n.includes(':/')) {
              const base = cwdBasename(cwd)
              const rn = n.split('/').pop().toLowerCase()
              if (base && rn && base.toLowerCase() !== rn) polluted = true
            }
          } else if (snap && snap.repo && snap.repo.name) {
            const base = cwdBasename(cwd)
            if (base && snap.repo.name !== base) polluted = true
          }
          if (polluted) { loadSnapshot(s, false, true); loadChain(s, false); return true }
          return false
        }
        if (summaryCwd) { if(apply(summaryCwd)) return }
        const cwd0 = detectCwd(props && props.session)
        if (cwd0) { if(apply(cwd0)) return }
        const sync = getCwdSync(sid)
        if (sync) { if(apply(sync)) return }
        if (sid && typeof host !== 'undefined' && typeof host.call === 'function') {
          host.call('wf.cwd', { sessionId: sid }).then(function (res) {
            if (res && res.ok && res.cwd) apply(res.cwd)
          }).catch(function () {})
        }
      }, [sid, summaryCwd])
      // 初始/污染自愈：随 sid 变化重跑（修复空 deps），并额外监听 summaryCwd/s.cwd 变化以覆盖“同 sid 切工作区”场景
      React.useEffect(function () {
        if (!s.cwd) {
          const sync = getCwdSync(sid)
          if (sync) { s.cwd = sync; hydrateFromCache(s) }
        } else { hydrateFromCache(s) }
        // 污染自愈：若当前 store 的 snapshot 仍是之前工作区串台残留（repoRoot 与 cwd 前缀不匹配，或 repo/repository 名与 cwd 尾段不一致），强制后台刷新
        const isPolluted = (function(){
          if (!s.snapshot || !s.cwd) return false
          const snap = s.snapshot
          if (snap.repoRoot) {
            const rr = (typeof keyOf==='function'?keyOf(snap.repoRoot):String(snap.repoRoot).replace(/\\/g,'/').replace(/\/+$/,''))
            const cw = (typeof keyOf==='function'?keyOf(s.cwd):String(s.cwd).replace(/\\/g,'/').replace(/\/+$/,''))
            if (cw === rr) return false
            if (cw.startsWith(rr + '/')) return false
            if (rr.startsWith(cw + '/')) return false
            return true
          }
          if (snap.repository && snap.repository.name) {
            const n = String(snap.repository.name)
            // 文件路径形态（D:\...）不参与 basename 误判；仅 owner/name 形态参与
            if (n.includes(':\\') || n.includes(':/')) return false
            const base = cwdBasename(s.cwd)
            if (base && n.split('/').pop().toLowerCase() !== base.toLowerCase()) return true
          }
          if (snap.repo && snap.repo.name) {
            const base = cwdBasename(s.cwd)
            if (base && snap.repo.name !== base) return true
          }
          return false
        })()
        if (isPolluted) { loadSnapshot(s, false); loadChain(s, false); return }
        if (!snapFresh(s)) loadSnapshot(s, false); loadChain(s, false)
      }, [sid, summaryCwd, s.cwd, s.snapshot && s.snapshot.repoRoot, s.snapshot && s.snapshot.repository && s.snapshot.repository.name, s.snapshot && s.snapshot.repo && s.snapshot.repo.name])
      const closeDock = function () {
        if (props && typeof props.closeDetails === 'function') props.closeDetails()
        else if (layoutSvc && typeof layoutSvc.closeDetails === 'function') layoutSvc.closeDetails()
      }
      const groups = compute(s)
      const active = s.activeMap !== null ? groups.find(function (x) { return x.m.number === s.activeMap }) : null
      const hasIssueDetail = s.activeIssue !== null && s.activeIssue !== undefined
      const narrow = dw < 380
      // #187 Banner→Modal 门控（承接 #184 定版：Banner 点→Modal 动态三选，不含 Other，取消/确认 + 整条隐藏+容器不挂载 + pending/isOther 两态 + 动态多态）
      const _sel = s.selection || (s.snapshot && s.snapshot.selection) || null
      const _isPending = !!(_sel && _sel.pending && !!s.cwd && s.snapMode==='real' && !!s.snapshot)
      const _isOtherRaw = !!(_sel && _sel.backendId===null && !_sel.pending)
      const _isOther = _isOtherRaw && !!s.cwd && s.snapMode==='real' && !!s.snapshot
      const _showBackendFullscreen = _isPending || _isOther
      const _gateOpen=!!s.gateModalOpen && (s.gateModalSource==='dock' || !s.gateModalSource);const _gateModules=otherFiltered(s.backendModules);const _openGateModal=function(){s.gateModalOpen=true;s.gateModalSource='dock';if(!s.gateSelected)s.gateSelected=firstBackendIdOf(_gateModules);s.gateError='';emit(s);if(typeof host!=='undefined'&&host.call){s.gateLoading=true;emit(s);host.call('wf.registry',{cwd:s.cwd||''}).then(function(r){s.gateLoading=false;let m=null;if(r&&r.ok&&Array.isArray(r.modules))m=r.modules;else if(r&&Array.isArray(r.modules))m=r.modules;else if(r&&r.value&&Array.isArray(r.value.modules))m=r.value.modules;if(Array.isArray(m)&&m.length){const f=m.filter(x=>String(x.id).toLowerCase()!=='other');const fin=f.length?f:m.filter(x=>String(x.id).toLowerCase()!=='other');if(fin.length){s.backendModules=m;try{if(typeof setPresentationMap==='function')setPresentationMap(m)}catch(e){}const ids=fin.map(x=>x.id);if(!s.gateSelected||ids.indexOf(s.gateSelected)<0)s.gateSelected=fin[0].id}}emit(s)}).catch(function(){s.gateLoading=false;emit(s)})}};const _closeGateModal=function(){s.gateModalOpen=false;s.gateModalSource=null;s.gateError='';emit(s)};const _confirmGate=function(){const id=s.gateSelected||firstBackendIdOf(_gateModules);if(String(id).toLowerCase()==='other'){s.gateError=tr('switch.gateOtherErr');emit(s);return}const prev=s.selection;const repoRef=s.repository||(s.snapshot&&s.snapshot.repository)||null;const nxt={backendId:id,source:'explicit',ref:repoRef};s.selection=nxt;try{if(s.cwd)setCachedSelection(s.cwd,nxt)}catch(e){}s.gateModalOpen=false;s.gateModalSource=null;emit(s);if(typeof host!=='undefined'&&host.call){host.call('wf.bind',{cwd:s.cwd||'',backendId:id}).then(function(res){const ok=res&&(res.ok===true||(res.value&&res.value.ok===true)||res.ok);if(ok){s.tab='list';emit(s);try{flash(s,tr('switch.bindOk',{label:(typeof labelOf==='function'?labelOf(id):String(id))}),'ok')}catch(e){}try{const tt=(typeof setupRunPrompt==='function'?setupRunPrompt(s,id):'');if(tt)try{inject(s,tt)}catch(e){}}catch(e){}loadSnapshot(s,true,true)}else{s.selection=prev;try{if(s.cwd)setCachedSelection(s.cwd,prev)}catch(e){};emit(s);try{flash(s,tr('switch.bindFail',{err:String((res&&(res.error||res.message))||'unknown').slice(0,120)}),'warn')}catch(e){}}}).catch(function(e){s.selection=prev;try{if(s.cwd)setCachedSelection(s.cwd,prev)}catch(e2){};emit(s);try{flash(s,tr('switch.bindFail',{err:String(e&&e.message||e).slice(0,120)}),'warn')}catch(e3){}})}};const pickBackend=function(id){s.gateSelected=id;emit(s);_confirmGate()}
      const tabsRef = React.useRef(null)
      const tabs = useTabsRow(s, tabsRef)
      const headRef = React.useRef(null)
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
      }, [])
      // 头部自适应：空间充足时完整，挤压时先隐藏 MATT skills 文字（保留图标），最后仅留 repo（#28）
      React.useEffect(function () {
        const applyHead = function () {
          const hd = headRef.current
          if (!hd) return
          const titleEl = hd.querySelector('[data-head-title]')
          const chip = hd.querySelector('[data-repo-chip]')
          const txt = chip && chip.querySelector('[data-repo-text]')
          if (!titleEl || !chip || !txt) return
          const repo = s.snapshot && s.snapshot.repo
          const full = repo ? repo.owner + '/' + repo.name : ''
          const short = repo ? repo.name : ''
          const naturalFits = function () {
            try { if (typeof measureContentWidth === 'function') return measureContentWidth(hd) <= hd.clientWidth + 1 } catch (e) {}
            return hd.scrollWidth <= hd.clientWidth + 1
          }
          // 基准：标题可见 + 完整仓库名（固宽测自然宽）
          titleEl.style.display = ''
          if (full) txt.textContent = full
          chip.style.flex = 'none'
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          // 阶段1：隐藏标题，优先保仓库名
          titleEl.style.display = 'none'
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          // 阶段2：极窄时仅留 repo
          if (full && short) txt.textContent = short
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          // 仍放不下：允许 chip 弹性 ellipsis 收缩
          chip.style.flex = '0 1 auto'
        }
        applyHead()
        let ro2 = null
        try {
          ro2 = new ResizeObserver(function () { applyHead() })
          if (headRef.current) ro2.observe(headRef.current)
        } catch (e) {}
        const onWin = function () { applyHead() }
        if (typeof window !== 'undefined') window.addEventListener('resize', onWin)
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(applyHead)
        return function () { if (ro2) try { ro2.disconnect() } catch (e) {} ; if (typeof window !== 'undefined') window.removeEventListener('resize', onWin) }
      }, [s.snapshot && s.snapshot.repo && (s.snapshot.repo.owner + '/' + s.snapshot.repo.name), dw])
      return h('div', { ref: dockRef, 'data-dsws-host': '1', className: narrow ? 'dsws-narrow' : undefined, style: { position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'var(--dsw-font-family)', fontSize: 12, color: 'var(--dsw-alias-label-primary,#e6edf3)', background: 'var(--dsw-alias-bg-layer-1,#10131a)' } }, [
        // 头部（标题 + 关闭）：横线不放在这行，下移到标签行下方与对话/轨迹对齐
        // #28 自适应：flex 容器 minWidth 0 + 芯片 flex 自适应，标题优先隐藏，极窄仅留 repo
        h('div', { ref: headRef, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px 6px', flex: 'none', minWidth: 0 } }, [
          Icon({ scheme: 'compass', size: 15 }),
          h('span', { 'data-head-title': 1, style: { fontWeight: 600, fontSize: 13, flex: 'none', whiteSpace: 'nowrap' } }, tr('panel.title')),
          // #155 Q5：仓库身份泛化 — RepositoryRef.name/url + 按 backend 着色；未知原串灰色；空 url 不链；pending/multiHit 黄条由下行承载
          (function(){
            let repoRef = (s.repository || (s.snapshot && s.snapshot.repository) || null)
            const sel = s.selection || (s.snapshot && s.snapshot.selection) || null
            // 2026-08-28 契约修正（用户复核）：仓库名一律由 host 后端 describe 经契约层产出，UI 零派生——
            //   markdown 本地形态（目录即仓库）同理由 describe 给出 name=目录名；前端不再有派生分支，
            //   剩余 null 只可能是异常态 → 诚实警示「未识别仓库」。
            if (!repoRef && sel && sel.backendId) {
              // 远程型后端（github/gitlab）已选但仓库引用缺失：诚实警示，不冒充仓库名；诊断交由环境检查 gh:remote 红牌
              return h(Tip, { content: tr('panel.repoUnidentifiedTitle') }, h('span', { 'aria-label': tr('panel.repoUnidentifiedTitle'), style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#f59e0b', background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.5)', borderRadius: 6, padding: '1px 8px', flex: 'none', whiteSpace: 'nowrap' } }, [Ic({ n: 'alert', size: 11 }), h('span', null, tr('panel.repoUnidentified'))]))
            }
            if (!repoRef) return h(Tip, { content: tr('panel.noRepoTitle') }, h('span', { 'aria-label': tr('panel.noRepoTitle'), style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#f87171', background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.5)', borderRadius: 6, padding: '1px 8px', flex: 'none', whiteSpace: 'nowrap' } }, [Ic({ n: 'alert', size: 11 }), h('span', null, tr('panel.noRepo'))]))
            const bid = sel ? sel.backendId : (repoRef.backend || firstBackendIdOf(null))
            // #191：品牌色纯机制派生（后端 presentation 单源，无硬编码兜底——函数在 store 已内置中性兜底）
            const col = (typeof backendColorOf==='function'? backendColorOf(bid) : '')
            const bg = (typeof backendBgOf==='function'? backendBgOf(bid) : '')
            const bdc = (typeof backendBorderOf==='function'? backendBorderOf(bid) : '')
            const short = (typeof repoShortName==='function'? repoShortName(repoRef) : String(repoRef.name||'').split('/').pop())
            const href = repoRef.url || ''
            const inner = [h('svg', { viewBox: '0 0 16 16', width: 11, height: 11, fill: 'currentColor', style: { flex: 'none' } }, [h('path', { d: 'M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5v-9zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 8h8.5V1.5z' })]), h('span', { 'data-repo-text': 1, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, repoRef.name)]
            const chipStyle = { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: col, backgroundColor: bg, border: '1px solid transparent', borderRadius: 6, padding: '1px 8px', flex: '0 1 auto', minWidth: 40, maxWidth: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'Consolas,Menlo,monospace', borderColor: bdc, colorScheme: 'light dark' }
            // #231（契约动作）：开仓行为由后端 openRepository 声明驱动 —— folder 型注入 wf.openFolder，url 型浏览器原生新窗；无声明且无 url 即无动作（诚实渲染）
            const act = repositoryActionOf(s, bid)
            if (act === 'folder') {
              return h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullRepo')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, repoRef.name), h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px', marginTop: 2 } }, tr('tip.header.repoAction'))]) }, h('a', { href: 'javascript:void(0)', 'aria-label': repoRef.name, 'data-repo-chip': 1, style: Object.assign({}, chipStyle, { cursor:'pointer' }), onClick: function(e){ try{ if(e&&e.preventDefault) e.preventDefault() }catch(_){}; try{ if(typeof host!=='undefined'&&host.call) host.call('wf.openFolder',{cwd: s.cwd||''}) }catch(__){} } }, inner))
            }
            if (!href) return h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullRepo')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, repoRef.name)]) }, h('span', { 'aria-label': repoRef.name, 'data-repo-chip': 1, style: Object.assign({}, chipStyle, { cursor:'default' }) }, inner))
            // #191（用户反馈）：GitHub/GitLab 路径只 target='_blank'（浏览器原生新窗口），
            //   之前的 onClick openUrl 导致点一次开两个浏览器。Markdown 路径见上方分支（保留 onClick wf.openFolder）
            return h(Tip, { content: tr('panel.repoTitle') }, h('a', { href: href, target: '_blank', rel: 'noreferrer', 'aria-label': tr('panel.repoTitle'), 'data-repo-chip': 1, style: chipStyle }, inner))
          })(),
          // #191 · 仓库名右侧切换按钮（已选态常驻 · pending 灰置 · _isOther 隐藏）
          (function(){ if(_isOther) return null; var _sel=s.selection||(s.snapshot&&s.snapshot.selection)||null, _bid=_sel?_sel.backendId:null; if(_bid==null) return null; var _pend=!!(_sel&&_sel.pending), _col=(typeof backendColorOf==='function'?backendColorOf(_bid):'#6e7681'); return h(Tip, { content: _pend ? '切换后端 · 探测中不可用' : '切换后端' }, h('button',{'data-repo-switch':1,type:'button','aria-label':'切换后端','aria-disabled':_pend?'true':'false',disabled:_pend,onClick:function(e){try{if(e&&e.preventDefault)e.preventDefault();if(e&&e.stopPropagation)e.stopPropagation()}catch(_){};if(_pend)return;try{openSwitchConfirm(s,null)}catch(_){}},style:{display:'inline-flex',alignItems:'center',justifyContent:'center',width:16,height:16,borderRadius:4,flex:'none',border:'1px solid '+_col,color:_col,background:'transparent',cursor:_pend?'not-allowed':'pointer',opacity:_pend?0.45:1,fontSize:10,lineHeight:1,padding:0,colorScheme:'light dark'}},Ic({n:'swap',size:10}))) })(),
          h('span', { style: { flex: 1 } }),
          h(Tip, { content: tr('panel.closeTitle') }, h('button', { className: 'dsws-btn ghost', 'aria-label': tr('panel.closeTitle'), onClick: closeDock, style: { display: 'inline-flex', alignItems: 'center', padding: '2px 6px', fontSize: 11 } }, Ic({ n: 'x', size: 12 }))),
        ]),
        // #155 Q5：Pending / MultiHit 黄条（提示不阻断）
        (function(){
          const sel = s.selection || (s.snapshot && s.snapshot.selection) || null
          if (!sel) return null
          const isPending = !!sel.pending
          const isMulti = Array.isArray(sel.multiHit) && sel.multiHit.length>1
          if (!isPending && !isMulti) return null
          const bg = 'rgba(245,158,11,.12)', bd='rgba(245,158,11,.45)', col='#f59e0b'
          if (isPending) return h('div', { style:{ margin:'0 12px 6px', padding:'4px 8px', background:bg, border:'1px solid '+bd, color:col, fontSize:11, borderRadius:6, display:'flex', alignItems:'center', gap:6 } }, [
            h('span', { className:'dsws-spinner', style:{ width:11, height:11, borderWidth:2, display:'inline-block' } }),
            h('span', { style:{ flex:1 } }, '正在探测后端（3s 超时）— 若长时间停留请手动选择'),
            h('button', { className:'dsws-btn', onClick:function(){ if(typeof host!=='undefined'&&host.call) host.call('wf.registry',{cwd:s.cwd||''}).then(function(){ loadSnapshot(s,true,true)}) }, style:{ fontSize:10, padding:'1px 6px', flex:'none' } }, '重试'),
          ])
          if (isMulti) return h('div', { style:{ margin:'0 12px 6px', padding:'4px 8px', background:bg, border:'1px solid '+bd, color:col, fontSize:11, borderRadius:6, display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' } }, [
            Ic({n:'alert',size:11, color:col}),
            h('span', { style:{ flex:1 } }, '检测到多个可用后端：' + sel.multiHit.join(', ') + ' — 建议显式绑定'),
            h('button', { className:'dsws-btn', onClick:function(){ s.tab='list'; emit(s) }, style:{ fontSize:10, padding:'1px 6px', flex:'none', background:'#f59e0b', borderColor:'transparent', color:'#fff' } }, '去设置页绑定'),
          ])
          return null
        })(),
        // #267：命名链路定败面板级常驻提醒 —— 组件自订阅共享 store（NamingFailBanner 叶子，G4 单职责）；
        //   值比对比两路化解（手改锁定 / 值一致收敛）后下一轮拉询自动撤下
        h(NamingFailBanner),
        // 标签行下沿 = 与对话/轨迹一致的横线；右侧：刷新按钮 + 版本号（v1.3.3）— 门控时隐藏（容器不挂载语义：业务 tabs 不渲染，仅 Banner/Modal 可见）
        (_isPending || _isOther) ? null : h('div', { className: 'dsws-tabs', ref: tabsRef, style: { padding: '0 12px 7px', borderBottom: '1px solid var(--dsw-alias-border-l1,#2a2d35)', flex: 'none', display: 'flex', alignItems: 'center', gap: 4 } }, tabs.items),
        _isPending ? h('div', { className: 'dsws-body', style: { flex: 1, overflowY: 'auto', padding: '12px', display:'flex', alignItems:'center', justifyContent:'center' } }, [
          h('div', { style:{ width:'92%', maxWidth:420, background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.35)', borderRadius:12, padding:'14px 16px', display:'flex', flexDirection:'column', gap:10 } }, [
            h('div', { style:{ display:'flex', alignItems:'center', gap:8 } }, [
              h('span', { className:'dsws-spinner', style:{ width:16, height:16, borderWidth:2, display:'inline-block' } }),
              h('div', { style:{ flex:1 } }, [
                h('div', { style:{ fontSize:13, fontWeight:700, color:'#f59e0b' } }, '正在探测后端'),
                h('div', { style:{ fontSize:11, color:'#f59e0b', marginTop:2 } }, '3s 超时未决 — 若长时间停留请手动选择'),
              ]),
            ]),
            h('div', { style:{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 } }, [
              h('button', { className:'dsws-btn', onClick:function(){ s.tab='list'; emit(s); _openGateModal() }, style:{ fontSize:11, padding:'4px 10px' } }, '去设置页选择'),
              h('button', { className:'dsws-btn primary', onClick:function(){ loadSnapshot(s,true,true) }, style:{ background:'#f59e0b', borderColor:'transparent', color:'#fff', fontSize:11, padding:'4px 10px' } }, '重试探测'),
            ]),
          ])
        ]) : _isOther ? h('div', { className: 'dsws-body', style: { flex: 1, overflowY: 'auto', padding: '12px', position:'relative', display:'flex', flexDirection:'column', alignItems:'stretch', gap:10 } }, [
          h('div', { onClick: _openGateModal, style:{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', background:'rgba(56,139,253,.10)', border:'1px solid rgba(56,139,253,.35)', borderRadius:10, cursor:'pointer', color:'#58a6ff', fontSize:12, fontWeight:600 } }, [
            Ic({ n: 'compass', size:14, color:'#58a6ff' }),
            h('span', { style:{ flex:1 } }, '该工作区还没有设置 — 点击选择后端'),
            h('span', { style:{ fontSize:11, color:'#58a6ff', border:'1px solid rgba(56,139,253,.4)', borderRadius:6, padding:'1px 6px', background:'rgba(56,139,253,.12)' } }, '去选择'),
          ]),
          h('div', { style:{ fontSize:11, color:'#8b8b95', padding:'0 2px' } }, '选择后将回到主线流程（列表/状态栏正常可用），仅设置页可见引导已隐藏主线'),
          _gateOpen ? h('div', { onClick:function(e){ if(e.target===e.currentTarget) _closeGateModal() }, style:{ position:'absolute', inset:0, background:'rgba(0,0,0,.55)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'12px 16px', paddingTop:'12px', zIndex:5 } }, [
            h('div', { style:{ background:'var(--dsw-alias-bg-layer-2,#16181d)', border:'1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius:12, padding:'16px', width:'92%', maxWidth:380, boxShadow:'0 8px 24px rgba(0,0,0,.5)' } }, [
              h('div', { style:{ fontSize:13, fontWeight:700, display:'flex', alignItems:'center', gap:6, marginBottom:6 } }, [Ic({n:'compass',size:14}), h('span', null, '请选择 Tracker 后端以继续')]),
              h('div', { style:{ fontSize:11, color:'#8b8b95', marginBottom:10, lineHeight:1.5 } }, '不同后端的初始化与前置检查不同，选择后将回到主线流程（列表/状态栏正常可用）'),
              h('div', { style:{ fontSize:11, color:'#f59e0b', background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.25)', borderRadius:6, padding:'6px 8px', marginBottom:10 } }, tr('gate.wipNotice')),
              s.gateLoading ? h('div', { style:{ fontSize:11, color:'#8b8b95', padding:'6px 0' } }, '加载中…') : h('div', { style:{ display:'flex', flexDirection:'column', gap:6 } }, _gateModules.map(function(m){
                const isSel = s.gateSelected===m.id
                const col = (typeof backendColorOf==='function'? backendColorOf(m.id) : '')
                const isRec = _gateModules[0] && _gateModules[0].id===m.id
                return h('label', { key:m.id, style:{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:8, border: isSel ? '1px solid '+col : '1px solid var(--dsw-alias-border-l1,#2a2d35)', background: isSel ? 'rgba(88,166,255,.08)' : 'transparent', cursor:'pointer' } }, [
                  h('input', { type:'radio', name:'dsws-gate-pick', checked:isSel, onChange:function(){ s.gateSelected=m.id; emit(s) } }),
                  h('span', { style:{ width:8, height:8, borderRadius:'50%', background:col, flex:'none' } }),
                  h('span', { style:{ fontSize:12, fontWeight:600 } }, m.label),
                  h('span', { style:{ fontSize:10, color:'#8b8b95' } }, m.id),
                  h('span', { style:{ flex:1 } }),
                  isRec ? h('span', { style:{ fontSize:10, color:'#4ade80', border:'1px solid #4ade80', borderRadius:4, padding:'0 4px', lineHeight:1.6 } }, '推荐') : null,
                ])
              })),
              s.gateError ? h('div', { style:{ fontSize:11, color:'#f87171', marginTop:8 } }, s.gateError) : null,
              h('div', { style:{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 } }, [
                h('button', { className:'dsws-btn ghost', onClick: _closeGateModal, style:{ fontSize:12 } }, '取消'),
                h('button', { className:'dsws-btn primary', onClick: _confirmGate, style:{ background:'#58a6ff', borderColor:'#58a6ff', color:'#0b1220', fontWeight:700, fontSize:12 } }, '确认并继续'),
              ]),
            ])
          ]) : null,
        ]) : h('div', { className: 'dsws-body', style: { flex: 1, overflowY: 'auto', padding: '10px 12px' } }, [
          s.tab === 'list' ? (active ? h(MapDetail, { st: s, g: active }) : hasIssueDetail ? h(IssueDetail, { st: s }) : h(ListTab, { st: s, narrow: narrow })) : null,
          s.tab === 'skills' ? h(SkillsTab, { st: s }) : null,
          s.tab === 'checks' ? h(ChecksTab, { st: s }) : null,
        ]),
        // #189 · 切换三选一 Modal（全局 per-store）
        (s.switchConfirm && s.switchConfirm.open && typeof SwitchConfirmModal === 'function' ? h(SwitchConfirmModal, { sessionId: sid }) : null),
        // v1.5 T10 R7：刷新遮罩已废除（手动刷新走静默路径，无「刷新中」）
        s.notice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
          Ic({ n: noticeIcon(s.notice.kind), size: 13, color: NOTICE_COLOR[s.notice.kind] || '#4ade80' }),
          h('span', null, s.notice.text),
        ]) : null,
      ])
    }
