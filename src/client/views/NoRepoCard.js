/**
 * views/NoRepoCard.js — 无仓库红卡 + 表单（T2 #35）+ 标签步骤 Modal（#188 纯 UI，无常驻黄条，GitHub 专属，名子集）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 * #188：建仓成功后进入标签步骤 Modal（文案“标签未全 7/10 → 注入补全指引”），点后 inject(prompt:ensureLabels)，Markdown 跳过
 */
    // ============ T2 #35 · NoRepo 红卡 + 表单（ListTab 首屏最优先 · 触发= checkRepo:bad && !dismissed）============
    // #188 单源名集合（与 src/shared/labels.js 同步，名子集，不卡色）
    const CANONICAL_LABELS_188 = ['bug','needs-triage','needs-info','ready-for-agent','ready-for-human','wayfinder:grilling','wayfinder:map','wayfinder:prototype','wayfinder:research','wayfinder:task']
    function missingLabels188(existing) {
      const have = {}
      ;(Array.isArray(existing)?existing:[]).forEach(function(n){ have[String(n||'').trim().toLowerCase()]=true })
      const out=[]
      CANONICAL_LABELS_188.forEach(function(n){ if(!have[n.toLowerCase()]) out.push(n) })
      return out
    }
export     const NoRepoCard = function (props) {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      const st = props.st
      const card = ensureNoRepoCard(st)
      const cs = activeChecks(st)
      const checkRepo = findCheck(cs, 'gh:remote')
      const repoBad = !!(checkRepo && checkRepo.level === 'bad')
      const dismissed = isNoRepoDismissed(st.cwd)
      // #155：Selection 三态优先于 checkRepo（显式无后端/pending 态不走 NoRepo 红卡分支）
      const sel = st.selection || (st.snapshot && st.snapshot.selection) || null
      const isPending = !!(sel && sel.pending)
      const isOther = !!(sel && sel.backendId===null && !sel.pending)
      // PendingCard：pending=true 时无论 repoBad 都显示等待态（提示不阻断，pending 不 fallback）
      if (isPending) {
        return h('div', { className: 'dsws-no-repo-card', style:{ background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.35)' } }, [
          h('div', { className: 'head' }, [
            h('span', { className:'dsws-spinner', style:{ width:13, height:13, borderWidth:2, display:'inline-block' } }),
            h('div', { style:{ flex:1, minWidth:0 } }, [
              h('div', { className:'ttl', style:{ color:'#f59e0b' } }, '正在探测后端'),
              h('div', { className:'desc', style:{ color:'#f59e0b' } }, '3s 超时未决 — 若长时间停留请手动选择'),
            ]),
          ]),
          h('div', { className:'acts' }, [
            h('button', { className:'dsws-btn', onClick:function(){ st.tab='list'; emit(st) }, style:{ fontSize:11, padding:'3px 10px' } }, '去设置页选择'),
            h('button', { className:'dsws-btn primary', onClick:function(){ loadSnapshot(st,true,true) }, style:{ background:'#f59e0b', borderColor:'transparent', color:'#fff', fontSize:11, padding:'3px 10px' } }, '重试探测'),
          ]),
        ])
      }
      if (isOther) {
        return h('div', { className: 'dsws-no-repo-card', style:{ background:'rgba(110,118,129,.08)', border:'1px solid rgba(110,118,129,.35)' } }, [
          h('div', { className: 'head' }, [
            Ic({ n: 'compass', size: 13, color: '#6e7681' }),
            h('div', { style: { flex: 1, minWidth: 0 } }, [
              h('div', { className:'ttl', style:{ color:'#6e7681' } }, '未绑定后端'),
              h('div', { className:'desc', style:{ color:'#8b8b95' } }, '当前工作区未选择 Tracker 后端 — 去设置页选择（Other 逃生舱）'),
            ]),
          ]),
          h('div', { className: 'acts' }, [
            h('button', { className:'dsws-btn primary', onClick:function(){ st.tab='list'; emit(st) }, style: { background: '#6e7681', borderColor: 'transparent', color: '#fff', fontWeight: 600, fontSize: 11, padding: '3px 10px' } }, '选择后端'),
          ]),
        ])
      }
      // #228 替换红卡：Markdown 物理隔离（行不存在而非 fail）— 通用链下 repoBad 在 markdown 不展示红卡（真机验收）
      const bidNoRepo = sel && sel.backendId
      if (bidNoRepo === 'markdown') {
        // Markdown 后端：仓库检查由通用/环境链承载，github 红卡永不显示（#228 验收：Markdown 工作区不出现红卡）
        // 若未来 chainSnapshot 为真源，此分支由链快照的行不存在自动根治；此处为过渡期显式隔离
        if (!labelVisible) return null
      }
      // #228 链失败态渲染（草案：github 后端目录失败态替代手写红卡；若 host 已提供 chainSnapshot 且当前步为建仓链，则委托 ChainRenderer 渲染）
      const chainSnapForNoRepo = (function(){
        try{
          if (st.chainSnapshot && st.chainSnapshot.steps) return st.chainSnapshot
          if (typeof checksToChainSnapshot === 'function' && cs && cs.length) return checksToChainSnapshot(cs)
        }catch(e){}
        return null
      })()
      const isChainRepoFail = chainSnapForNoRepo && chainSnapForNoRepo.steps && chainSnapForNoRepo.steps.some(function(s){ return String(s.id)==='1' && s.status==='fail' })
      // 若链快照表明当前链头是建仓相关（且非 markdown），优先由 ChainRenderer 承接（新链 renderer 为真源）；旧红卡仅作兼容兜底
      if (isChainRepoFail && bidNoRepo === 'github' && chainSnapForNoRepo && chainSnapForNoRepo.currentIndex!=null) {
        // 尝试构造 dispatcher 供链渲染（同 ChecksTab 复用逻辑）
        try{
          const disp = (typeof createActionDispatcher==='function') ? createActionDispatcher({
            inject: function(t,a){ try{ inject(st,t) }catch(e){} },
            openUrl: function(u){ try{ openUrl(u) }catch(e){} },
            hostCall: function(m,p){ if(typeof host!=='undefined'&& host.call) return host.call(m,p); return Promise.reject(new Error('hostCall unavailable')) },
            renderForm: function(schema, onSubmit){ try{ onSubmit({}) }catch(e){} },
            refresh: async function(){ try{ if(typeof host!=='undefined'&& host.call) await host.call('wf.detect',{cwd:st.cwd||'', force:true}) }catch(e){}; try{ loadChecks(st,true,true) }catch(e){}; try{ loadSnapshot(st,true,true) }catch(e){} },
            tr: tr,
            resolvePrompt: function(id,pa){ try{ return promptText(id,pa)}catch(e){ return '' } }
          }) : null
          if (disp) {
            // 交由 ChainRenderer 渲染（覆盖旧红卡；旧逻辑不再直接调用 wf.initPublish，而是经 form→rpc→refresh）
            // 但为兼容当前无 chain 表单的过渡期，若链中无 form 动作，仍回退旧红卡；有 form 则直接渲染链
            const cur = chainSnapForNoRepo.steps[chainSnapForNoRepo.currentIndex]
            const hasForm = cur && cur.actions && cur.actions.some(function(a){ return a && a.type==='form' })
            if (hasForm) {
              return (function(){
                const h2 = (React && React.createElement) ? React.createElement : (cx && cx.h ? cx.h : function(){} )
                // 复用 ChainRenderer 叶模块（build 已拼入）
                try{ return h2(ChainRenderer, { snapshot: chainSnapForNoRepo, dispatcher: disp, st: st }) }catch(e){ return null }
              })()
            }
          }
        }catch(e){}
      }
      const show = repoBad && !dismissed
      const labelVisible = !!(card.labelStep && card.labelStep.visible)
      if (!show && !labelVisible) return null
      const isValid = isNoRepoNameValid(card.name)
      const doDismiss = function () { setNoRepoDismissed(st.cwd, true); card.expanded = false; emit(st) }
      const doExpand = function () { if (!card.name) card.name = cwdBasename(st.cwd); card.expanded = true; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st) }
      const doCollapse = function () { card.expanded = false; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st) }
      const doSubmit = function () {
        if (!isNoRepoNameValid(card.name)) { card.errorKind = 'bad-name'; card.error = tr('panel.noRepoErr.bad-name'); card.errorRepoUrl = ''; emit(st); return }
        if (typeof host === 'undefined' || typeof host.call !== 'function') { card.errorKind = 'unknown'; card.error = tr('err.hostUnavailable'); card.errorRepoUrl = ''; emit(st); return }
        card.loading = true; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st)
        host.call('wf.initPublish', { cwd: st.cwd, name: card.name, visibility: card.visibility }).then(function (res) {
          card.loading = false
          if (res && res.ok) {
            const repoStr2 = res.repo && res.repo.owner ? res.repo.owner + '/' + res.repo.name : (res.repo && res.repo.name ? res.repo.name : card.name)
            // #188 纯 UI：Markdown 跳过标签步骤（GitHub 专属）
            const sel2 = st.selection || (st.snapshot && st.snapshot.selection) || null
            const isMd = !!(sel2 && sel2.backendId === 'markdown')
            if (isMd) {
              flash(st, tr('panel.noRepoCreateSuccess', { repo: repoStr2 }), 'ok')
              card.expanded = false; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st)
              loadSnapshot(st, true, true); loadChecks(st, true, true)
              return
            }
            // GitHub：进入标签步骤 Modal（不设常驻黄条，流程内单步）
            const computeMissing = function(snap){
              const labs = snap && Array.isArray(snap.labels) ? snap.labels.map(function(l){ return (l && l.name) || '' }) : []
              // 若 snapshot 无 labels（旧缓存），尝试从 issues 聚合兜底
              if (!labs.length && snap && Array.isArray(snap.issues)) {
                const agg={}
                snap.issues.forEach(function(it){ (it.labels||[]).forEach(function(l){ agg[(l.name||'').toLowerCase()]=true }) })
                return missingLabels188(Object.keys(agg))
              }
              return missingLabels188(labs)
            }
            const initMissing = computeMissing(st.snapshot)
            if (!card.labelStep) card.labelStep = { visible:false, repoStr:'', missing:[], have:0, total:10, checking:false }
            card.labelStep.visible = true
            card.labelStep.repoStr = repoStr2
            card.labelStep.missing = initMissing
            card.labelStep.have = 10 - initMissing.length
            card.labelStep.total = 10
            card.labelStep.checking = true
            flash(st, tr('panel.noRepoCreateSuccess', { repo: repoStr2 }), 'ok')
            card.expanded = false; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st)
            // 异步刷新真实标签后矫正 7/10 → 实际值
            loadSnapshot(st, true, true).then(function(){
              try{
                const miss2 = computeMissing(st.snapshot)
                if (card.labelStep){
                  card.labelStep.missing = miss2
                  card.labelStep.have = 10 - miss2.length
                  card.labelStep.checking = false
                  emit(st)
                }
              }catch(e){ if(card.labelStep) card.labelStep.checking=false; emit(st) }
            }).catch(function(){ if(card.labelStep) card.labelStep.checking=false; emit(st) })
            loadChecks(st, true, true)
          } else {
            const kind = (res && res.errorKind) || 'unknown'
            const raw = (res && res.error) || ''
            card.errorKind = kind
            card.errorRepoUrl = (res && res.repoUrl) || ''
            card.prompt = (res && res.prompt) || ''
            const key = 'panel.noRepoErr.' + kind
            const mapped = tr(key)
            const base = (mapped !== key) ? mapped : (raw ? String(raw).slice(0, 160) : tr('panel.noRepoErr.unknown'))
            card.error = base + (raw && base !== String(raw).slice(0, 160) && mapped !== raw ? ' · ' + String(raw).slice(0, 120) : '')
            emit(st)
          }
        }).catch(function (e) {
          card.loading = false; card.errorKind = 'unknown'; card.error = String((e && e.message) || e).slice(0, 200); card.errorRepoUrl = ''; emit(st)
        })
      }
      // 构建红卡主体（show 时）
      const cardEl = show ? h('div', { className: 'dsws-no-repo-card' }, [
        h('div', { className: 'head' }, [
          Ic({ n: 'alert', size: 13, color: '#f87171' }),
          h('div', { style: { flex: 1, minWidth: 0 } }, [
            h('div', { className: 'ttl' }, tr('panel.noRepoCardTitle')),
            h('div', { className: 'desc' }, tr('panel.noRepoCardDesc')),
          ]),
          h('button', { className: 'dsws-btn ghost', title: tr('panel.noRepoCardDismiss'), onClick: function (e) { e.stopPropagation(); doDismiss() }, style: { padding: '2px 6px', flex: 'none' } }, Ic({ n: 'x', size: 12 })),
        ]),
        h('div', { className: 'acts' }, !card.expanded ? [
          h('button', { className: 'dsws-btn primary', onClick: doExpand, style: { background: '#f87171', borderColor: 'transparent', color: '#fff', fontWeight: 600, fontSize: 11, padding: '3px 10px' } }, tr('panel.noRepoCardAction')),
          h('button', { className: 'dsws-btn ghost', onClick: function (e) { e.stopPropagation(); doDismiss() }, style: { fontSize: 11, padding: '3px 10px' } }, tr('panel.noRepoCardDismiss')),
        ] : null),
        card.expanded ? h('div', { className: 'dsws-no-repo-form' }, [
          h('div', { className: 'row' }, [
            h('label', null, tr('panel.noRepoFormName')),
            h('input', { type: 'text', value: card.name, placeholder: cwdBasename(st.cwd), onChange: function (e) { card.name = e.target.value; if (card.errorKind === 'bad-name') { card.error = ''; card.errorKind = '' } emit(st) } }),
          ]),
          h('div', { className: 'hint', style: (!isValid && card.name) ? { color: '#f87171' } : null }, tr('panel.noRepoFormNameHint')),
          h('div', { className: 'row' }, [
            h('label', null, tr('panel.noRepoFormVisibility')),
            h('label', { className: 'radio', style: { display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' } }, [
              h('input', { type: 'radio', name: 'noRepoVis-' + (st.cwd || 'x'), checked: card.visibility === 'private', onChange: function () { card.visibility = 'private'; emit(st) } }),
              h('span', null, tr('panel.noRepoFormPrivate')),
            ]),
            h('label', { className: 'radio', style: { display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', marginLeft: 12 } }, [
              h('input', { type: 'radio', name: 'noRepoVis-' + (st.cwd || 'x'), checked: card.visibility === 'public', onChange: function () { card.visibility = 'public'; emit(st) } }),
              h('span', null, tr('panel.noRepoFormPublic')),
            ]),
          ]),
          card.error ? (function () {
            const kind = card.errorKind || 'unknown'
            const isWarn = kind === 'no-git' || kind === 'no-gh' || kind === 'not-logged-in' || kind === 'network'
            const bg = isWarn ? 'rgba(245,158,11,.12)' : 'rgba(248,113,113,.12)'
            const bd = isWarn ? 'rgba(245,158,11,.45)' : 'rgba(248,113,113,.45)'
            const col = isWarn ? '#fbbf24' : '#f87171'
            return h('div', { className: 'err', style: { background: bg, border: '1px solid ' + bd, color: col, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } }, [
              Ic({ n: 'alert', size: 11, color: col }),
              h('span', { style: { marginLeft: 4, flex: '1 1 auto' } }, card.error),
              kind === 'no-git' ? h('a', { href: 'https://git-scm.com/', target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '下载') : null,
              // #195 修复(第二轮)：no-gh 直接用后端提供的 prompt（多态），移除 <a> 链接兜底
              kind === 'no-gh' ? h('button', { onClick: function () { var p = card.prompt || card.errorPrompt || ''; if (p && typeof inject === 'function') inject(st, p); else if (typeof inject === 'function') { var fallback='请为 DSH 安装 GitHub CLI（gh）—— 面板所有数据依赖 gh：\n\n1. 先检查：终端执行 `gh --version`;\n2. 无 gh 则按 OS 安装：Windows → `winget install --id GitHub.cli`; macOS → `brew install gh`; Linux → `sudo apt install gh`;'; inject(st, fallback) } }, style: { marginLeft: 8, background: 'transparent', color: '#58a6ff', border: '1px solid rgba(88,166,255,.45)', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 11 } }, 'AI 引导安装') : null,
              kind === 'not-logged-in' ? h('a', { href: 'https://cli.github.com/manual/gh_auth_login', target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '去登录') : null,
              kind === 'already-exists' ? h('a', { href: card.errorRepoUrl || searchUrlFor(st, card.name), target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '去查看') : null,
              kind === 'network' ? h('button', { onClick: doSubmit, disabled: card.loading, style: { marginLeft: 8, background: 'transparent', color: col, border: '1px solid ' + col, borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 11 } }, '重试') : null,
            ])
          })() : null,
          h('div', { className: 'row', style: { marginTop: 8 } }, [
            h('button', { className: 'dsws-btn primary', disabled: card.loading || !isValid, onClick: doSubmit, style: { opacity: (!isValid || card.loading) ? 0.6 : 1, background: '#f87171', borderColor: 'transparent', color: '#fff', fontWeight: 600, fontSize: 11, padding: '4px 12px', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
              card.loading ? h('span', { className: 'dsws-spinner', style: { width: 12, height: 12, borderWidth: 2, display: 'inline-block', verticalAlign: '-2px' } }) : null,
              h('span', null, card.loading ? tr('panel.noRepoFormSubmitting') : tr('panel.noRepoFormSubmit')),
            ]),
            h('button', { className: 'dsws-btn', onClick: doCollapse, disabled: card.loading, style: { marginLeft: 6, fontSize: 11, padding: '4px 10px' } }, tr('panel.noRepoFormCancel')),
          ]),
        ]) : null,
      ]) : null
      // #188 标签步骤 Modal（流程内单步，无常驻黄条）
      const labelModal = labelVisible ? (function(){
        const ls = card.labelStep
        const have = typeof ls.have==='number'?ls.have:0
        const total = ls.total||10
        const missing = Array.isArray(ls.missing)?ls.missing:[]
        const checking = !!ls.checking
        const titleText = missing.length===0 ? tr('panel.labelsStepAllOk', {total: total}) : tr('panel.labelsStepTitle', {have: have, total: total})
        const doInject = function(){
          try{
            const txt = (typeof promptText==='function') ? promptText('ensureLabels') : ''
            if (txt && typeof inject==='function') { inject(st, txt) }
            else if (typeof copyText==='function' && txt){ copyText(st, txt, tr('panel.labelsStepInjected')) }
          }catch(e){}
          try{ flash(st, tr('panel.labelsStepInjected'), 'ok') }catch(e){}
          ls.visible=false; emit(st)
        }
        const doSkip = function(){ ls.visible=false; emit(st) }
        const inner = h('div', { className: 'dsws-labels-modal', style: { background: '#1a1f2e', border: '1px solid rgba(255,255,255,.12)', borderRadius:8, width:360, maxWidth:'90vw', padding:'16px 18px', boxShadow:'0 8px 28px rgba(0,0,0,.45)', color:'#e6e8eb' } }, [
          h('div', { style:{ fontSize:13, fontWeight:600, color:'#fbbf24', display:'flex', alignItems:'center', gap:6 } }, [ Ic({ n: 'alert', size:12, color:'#fbbf24' }), h('span', null, titleText) ]),
          ls.repoStr ? h('div', { style:{ fontSize:11, color:'#8b94a5', marginTop:2 } }, ls.repoStr) : null,
          h('div', { style:{ fontSize:11, color:'#8b8b95', marginTop:8 } }, tr('panel.labelsStepDesc')),
          missing.length ? h('div', { style:{ fontSize:11, color:'#f87171', marginTop:8, background:'rgba(248,113,113,.08)', border:'1px solid rgba(248,113,113,.22)', borderRadius:4, padding:'6px 8px', wordBreak:'break-word' } }, tr('panel.labelsStepMissing', {list: missing.join(', ')})) : null,
          checking ? h('div', { style:{ fontSize:11, color:'#8b8b95', marginTop:6, display:'flex', alignItems:'center', gap:4 } }, [ h('span', { className:'dsws-spinner', style:{ width:10,height:10,borderWidth:1.5, display:'inline-block' } }), h('span', null, '检测中…') ]) : null,
          h('div', { style:{ display:'flex', gap:8, marginTop:14, justifyContent:'flex-end' } }, [
            h('button', { className:'dsws-btn', onClick: doSkip, style:{ fontSize:11, padding:'4px 10px' } }, tr('panel.labelsStepSkip')),
            missing.length ? h('button', { className:'dsws-btn primary', onClick: doInject, style:{ background:'#f59e0b', borderColor:'transparent', color:'#fff', fontWeight:600, fontSize:11, padding:'4px 12px' } }, tr('panel.labelsStepAction')) : h('button', { className:'dsws-btn primary', onClick: doSkip, style:{ background:'#16a34a', borderColor:'transparent', color:'#fff', fontWeight:600, fontSize:11, padding:'4px 12px' } }, '完成')
          ])
        ])
        const overlay = h('div', { className:'dsws-labels-overlay', onClick:function(e){ if(e.target===e.currentTarget) doSkip() }, style:{ position:'fixed', inset:'0', background:'rgba(0,0,0,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:2147483000 } }, [inner])
        try{ if(typeof portalTop==='function') return portalTop(overlay) }catch(e){}
        return overlay
      })() : null
      if (!cardEl && !labelModal) return null
      if (cardEl && labelModal) return h('div', null, [cardEl, labelModal])
      if (labelModal) return labelModal
      return cardEl
    }