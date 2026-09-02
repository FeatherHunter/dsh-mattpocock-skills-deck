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
      // #284：判 repo 缺位改从链快照步骤派生（gh:remote 失败）
      const checkRepo = chainStep(st, 'gh:remote')
      const repoBad = !!(checkRepo && checkRepo.status === 'fail')
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
      // #228/#231：物理隔离由「行不存在」承载；未声明标签能力的后端不进入建仓卡流程（能力位判据，非 id 判据）
      const bidNoRepo = sel && sel.backendId
      const metaNoRepo = (typeof moduleMetaOf === 'function') ? moduleMetaOf(st, bidNoRepo) : null
      const labelsGuideNoRepo = !!(metaNoRepo && metaNoRepo.capabilities && metaNoRepo.capabilities.labelsGuide)
      const labelVisibleEarly = !!(card.labelStep && card.labelStep.visible)
      if (!labelsGuideNoRepo && !labelVisibleEarly) return null
      // #228 链失败态渲染（草案：github 后端目录失败态替代手写红卡；若 host 已提供 chainSnapshot 且当前步为建仓链，则委托 ChainRenderer 渲染）
      const chainSnapForNoRepo = (function(){
        try{
          if (st.chainSnapshot && st.chainSnapshot.steps) return st.chainSnapshot
        }catch(e){}
        return null
      })()
      const isChainRepoFail = chainSnapForNoRepo && chainSnapForNoRepo.steps && chainSnapForNoRepo.steps.some(function(s){ return String(s.id)==='gh:remote' && s.status==='fail' })
      // 若链快照表明当前链头是建仓相关（且非 markdown），优先由 ChainRenderer 承接（新链 renderer 为真源）；旧红卡仅作兼容兜底
      const repoCreateChainNoRepo = !!(metaNoRepo && metaNoRepo.capabilities && metaNoRepo.capabilities.repoCreateChain)
      if (isChainRepoFail && repoCreateChainNoRepo && chainSnapForNoRepo && chainSnapForNoRepo.currentIndex!=null) {
        // 尝试构造 dispatcher 供链渲染（同 ChecksTab 复用逻辑）
        try{
          const disp = (typeof createActionDispatcher==='function') ? createActionDispatcher({
            inject: function(t,a){ try{ inject(st,t) }catch(e){} },
            openUrl: function(u){ try{ openUrl(u) }catch(e){} },
            hostCall: function(m,p){ if(typeof host!=='undefined'&& host.call) return host.call(m,p); return Promise.reject(new Error('hostCall unavailable')) },
            renderForm: function(schema, onSubmit){
              try {
                const isWizardPayload = schema && typeof schema === 'object' && !Array.isArray(schema) && Array.isArray(schema.steps)
                if (typeof openFormModal === 'function') {
                  openFormModal(st, isWizardPayload ? { type: 'wizard', steps: schema.steps, label: schema.label || '', submitAction: schema.submitAction || null } : { type: 'form', schema: schema, label: '填写表单' }, onSubmit)
                } else { try{ onSubmit({}) }catch(e){} }
              } catch(e){ try{ onSubmit({}) }catch(e2){} }
            },
            refresh: async function(){ try{ if(typeof host!=='undefined'&& host.call) await host.call('wf.detect',{cwd:st.cwd||'', force:true, backendId:(st.selection&&st.selection.backendId)||undefined}) }catch(e){}; try{ loadChain(st,true) }catch(e){}; try{ loadSnapshot(st,true,true) }catch(e){} },
            tr: tr,
            resolvePrompt: function(id,pa){ try{ if(id==='setupRun'&&typeof setupRunPrompt==='function') return setupRunPrompt(st); return promptText(id,pa)}catch(e){ return '' } }
          }) : null
          if (disp) {
            // 交由 ChainRenderer 渲染（覆盖旧红卡；旧逻辑不再直接调用 wf.initPublish，而是经 form→rpc→refresh）
            // 但为兼容当前无 chain 表单的过渡期，若链中无 form 动作，仍回退旧红卡；有 form 则直接渲染链
            const cur = chainSnapForNoRepo.steps[chainSnapForNoRepo.currentIndex]
            const hasForm = cur && cur.actions && cur.actions.some(function(a){ return a && (a.type==='form' || a.type==='wizard') })
            if (hasForm) {
              return (function(){
                const h2 = (React && React.createElement) ? React.createElement : (cx && cx.h ? cx.h : function(){} )
                // 复用 ChainRenderer 叶模块（build 已拼入）；wizard/form 弹窗需挂载 FormModalSeat
                try{
                  const chainNode = h2(ChainRenderer, { snapshot: chainSnapForNoRepo, dispatcher: disp, st: st })
                  if (typeof FormModalSeat === 'function') return h2('div', null, [ h2(FormModalSeat, { st: st }), chainNode ])
                  return chainNode
                }catch(e){ return null }
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
            // #231（能力位）：未声明 capabilities.labelsGuide 的后端一律跳过标签步骤（Markdown 即此形状；未来后端声明后自动获得引导，D8 末段）
            const sel2 = st.selection || (st.snapshot && st.snapshot.selection) || null
            const meta2 = (typeof moduleMetaOf === 'function' && sel2) ? moduleMetaOf(st, sel2.backendId) : null
            const labelsGuide = !!(meta2 && meta2.capabilities && meta2.capabilities.labelsGuide)
            if (!labelsGuide) {
              flash(st, tr('panel.noRepoCreateSuccess', { repo: repoStr2 }), 'ok')
              card.expanded = false; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st)
              loadSnapshot(st, true, true); loadChain(st, true)
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
            loadChain(st, true)
          } else {
            const kind = (res && res.errorKind) || 'unknown'
            const raw = (res && res.error) || ''
            card.errorKind = kind
            card.errorRepoUrl = (res && res.repoUrl) || ''
            card.prompt = (res && res.prompt) || ''
            // #231（类别3/6·真源化）：文案映射由后端数据优先（prompts.errorKinds），locale 仅末位兜底
            var bkText = ''
            try{ var bidE=(st.selection||(st.snapshot&&st.snapshot.selection)||{}).backendId; var mmE=(typeof moduleMetaOf==='function'&&bidE!=null)?moduleMetaOf(st,bidE):null; var ek=mmE&&mmE.prompts&&mmE.prompts.errorKinds&&mmE.prompts.errorKinds[kind]; if(ek){ var lgE=(typeof promptLang==='function')?promptLang():'zh'; bkText=String((lgE==='en'&&ek.en)?ek.en:(ek.zh||'')) } }catch(e){}
            const key = 'panel.noRepoErr.' + kind
            const mapped = tr(key)
            const base = bkText || ((mapped !== key) ? mapped : (raw ? String(raw).slice(0, 160) : tr('panel.noRepoErr.unknown')))
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
          h(Tip, { content: tr('panel.noRepoCardDismiss') }, h('button', { className: 'dsws-btn ghost', onClick: function (e) { e.stopPropagation(); doDismiss() }, style: { padding: '2px 6px', flex: 'none' } }, Ic({ n: 'x', size: 12 }))),
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
              kind === 'no-gh' ? h('button', { onClick: function () { var p = card.prompt || card.errorPrompt || ''; if (!p) { try{ var bidN=(st.selection||(st.snapshot&&st.snapshot.selection)||{}).backendId; var mmN=(typeof moduleMetaOf==='function'&&bidN!=null)?moduleMetaOf(st,bidN):null; var np=mmN&&mmN.prompts&&mmN.prompts.noGhPrompt; if(np){ var lgN=(typeof promptLang==='function')?promptLang():'zh'; p=String((lgN==='en'&&np.en)?np.en:(np.zh||'')) } }catch(e){} } if (p && typeof inject === 'function') inject(st, p); }, style: { marginLeft: 8, background: 'transparent', color: '#58a6ff', border: '1px solid rgba(88,166,255,.45)', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 11 } }, 'AI 引导安装') : null,
              kind === 'not-logged-in' ? h('button', { onClick: function () { try{ var bidL=(st.selection||(st.snapshot&&st.snapshot.selection)||{}).backendId; var mmL=(typeof moduleMetaOf==='function'&&bidL!=null)?moduleMetaOf(st,bidL):null; var ppL=mmL&&mmL.prompts&&mmL.prompts.ghAuthLogin; var lgL=(typeof promptLang==='function')?promptLang():'zh'; var tL=ppL?((lgL==='en'&&ppL.en)?String(ppL.en):String(ppL.zh||'')):''; if(tL&&typeof inject==='function') inject(st,tL) }catch(e){} }, style: { marginLeft: 8, background: 'transparent', color: '#58a6ff', border: '1px solid rgba(88,166,255,.45)', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 11 } }, tr('detail.authFailCta')) : null,
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
            const txt = (function(){
              try{
                const bidI=(st.selection||(st.snapshot&&st.snapshot.selection)||{}).backendId
                const mmI=(typeof moduleMetaOf==='function'&&bidI!=null)?moduleMetaOf(st,bidI):null
                const ppI=mmI&&mmI.prompts&&mmI.prompts.ensureLabels
                if(ppI){ const lg=(typeof promptLang==='function')?promptLang():'zh'; const t=(lg==='en'&&ppI.en)?String(ppI.en):String(ppI.zh||''); if(t) return t }
              }catch(e){}
              return '' // 无声明即诚实无注入（引导入口由能力位控制，本 Modal 仅在已声明后端可见）
            })()
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