/**
 * views/SettingsPage.js — 配置页（TPL 表 + 设置，5.9）真源 ESM，build 拼回 src/client/index.js leaf
 */
export const TPL_NAMES = { diagnose: '诊断', fix: '修复', discuss: '讨论', handoff1: '交接第一击', handoff2: '交接第二击', fixate: '沉淀' }
export const TPL_DESC = { diagnose: 'needs-triage 票的行级动作', fix: 'bug 票的行级动作', discuss: 'wayfinder:grilling 票的行级动作', handoff1: '生成交接文档（含时间戳，两击文件名一致）', handoff2: '读取交接文档', fixate: '零丢失快照 prompt' }
export const TPL_EDIT_IDS = ['diagnose', 'fix', 'discuss', 'handoff1', 'handoff2', 'fixate']
export const PREVIEW_VALUES = { url: 'https://github.com/FeatherHunter/SKILLS/issues/365', number: '365', title: tr('cfg.previewTitle'), ts: '20260814-172113', file: '20260814-172113.md' }
export     const SettingsPage = (props) => {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      // T5 修订：订阅 store（设置页独立于面板 dock，需自己订阅 shared 才能渲染 flash toast）
      const sharedSt = cx ? cx.storeSvc.useStore(props && props.sessionId) : useStore(props && props.sessionId)
      // T2 HoverTip 迁移：cfgTip 的定位/翻转/挂顶已由 HoverTip(mode='mouse') 统一，移除 sharedSt.cfgTip 全局时序
      // 旧 showCfgTip/moveCfgTip/hideCfgTip 三件套置换为 HoverTip 契约，行为零变化（翻转阈值与样式走 HoverTip 统一表）
      // #190 修复：client 侧 cwd 归一（绝对直通；相对原样交给 host normCwd）。
      const normCwdClient=function(raw){
        if(!raw) return ''
        if(typeof raw!=='string') raw=String(raw)
        try{ if(/^[A-Za-z]:[\\/]/.test(raw)||/^\//.test(raw)) return raw.replace(/[\\/]+$/,'') }catch{}
        return raw
      }
      const [openIn, setOpenIn] = React.useState(cfg.openIn || 'dock')
      const [openInNote, setOpenInNote] = React.useState(false)
      const [wf, setWf] = React.useState(cfg.withWayfinder)
      const [tpls, setTpls] = React.useState(function () {
        const o = {}
        o.execute = templates.execute || ''
        TPL_EDIT_IDS.forEach(function (id) { o[id] = templates[id] || '' })
        return o
      })
      const [saved, setSaved] = React.useState(false)
      const [errs, setErrs] = React.useState([])
      const [resetNote, setResetNote] = React.useState(null)
      const taRefs = React.useRef({})
      // v1.4.1：打开位置即时生效 —— seg 点击即写入 cfg + localStorage + 广播（无需滚到底部点保存全部）
      const pickOpenIn = function (v) {
        setOpenIn(v)
        cfg.openIn = v
        saveCfg()
        broadcastCfg()
        setOpenInNote(true)
        if (timer !== undefined) timer.timeout(function () { setOpenInNote(false) }, 2600)
      }
      // #155 Q1 改：只读全局总览（wf.bindings + workspaces.list + wf.registry 色值，不可改；不调 wf.bind）
      const [wsOverview, setWsOverview] = React.useState({ loading:true, err:'', bindings:[], workspaces:[], modules:[], selections:{} })
      const loadRef = React.useRef(null)
      React.useEffect(function(){
        let cancelled=false
        const load=async function(){
          setWsOverview(function(p){ return Object.assign({},p,{loading:true,err:''}) })
          let bindings=[], modules=[], selections={}, wsList=[]
          if(typeof host!=='undefined'&&typeof host.call==='function'){
            try{ const r=await host.call('wf.bindings',{}); const v=(r&&r.bindings)?r:(r&&r.value&&r.value.bindings?r.value:null); if(v&&Array.isArray(v.bindings)) bindings=v.bindings; else if(r&&Array.isArray(r.bindings)) bindings=r.bindings }catch(e){}
            try{ const r2=await host.call('wf.registry',{cwd:''}); const mods=(r2&&r2.modules)||(r2&&r2.value&&r2.value.modules)||[]; if(Array.isArray(mods)&&mods.length){ modules=mods; try{ setPresentationMap(mods)}catch{}} }catch(e2){}
          }
          try{
            let wsSvc=null; try{ if(typeof ctx!=='undefined'&&ctx&&typeof ctx.get==='function') wsSvc=ctx.get('workspaces')}catch{}; if(!wsSvc&&cx&&cx.ctx&&typeof cx.ctx.get==='function') try{ wsSvc=cx.ctx.get('workspaces')}catch{}
            if(wsSvc){
              let snap=null; try{ if(wsSvc.list){ if(typeof wsSvc.list.getSnapshot==='function') snap=wsSvc.list.getSnapshot(); else if(typeof wsSvc.list.getCurrent==='function') snap=wsSvc.list.getCurrent(); else if(typeof wsSvc.list==='function') snap=await wsSvc.list(); else if(Array.isArray(wsSvc.list)) snap=wsSvc.list } }catch{}
              if(snap){ if(Array.isArray(snap.items)) wsList=snap.items; else if(Array.isArray(snap)) wsList=snap; else if(snap.byId&&typeof snap.byId==='object') try{ wsList=Object.values(snap.byId)}catch{} }
              if(!wsList.length&&wsSvc.list&&typeof wsSvc.list==='function') try{ const a=await wsSvc.list(); if(Array.isArray(a)) wsList=a }catch{}
              if(!wsList.length&&typeof wsSvc.getAll==='function') try{ const a2=await wsSvc.getAll(); if(Array.isArray(a2)) wsList=a2 }catch{}
            }
          }catch{}
          const allSet={}, all=[]; const add=function(c){ const k=String(c); if(!allSet[k]){ allSet[k]=1; all.push(k)}}; wsList.forEach(function(w){ const raw=w.path||w.cwd||w.dir||w.workspacePath||w.root||w.fullPath||''; const k=normCwdClient(raw); if(k) add(k) }); bindings.forEach(function(b){ const k=normCwdClient(b.cwd||(b.handle&&b.handle.cwd)||''); if(k) add(k)}); if(!all.length&&sharedSt.cwd) add(sharedSt.cwd)
          try{ console.log('[wsOverview] all=',JSON.parse(JSON.stringify(all)),'wsSample=',wsList.slice(0,2)) }catch{}
          for(let i=0;i<all.length;i++){ const cwd=all[i]; try{ const r=await host.call('wf.selection',{cwd}); const sel=(r&&r.selection)||(r&&r.value&&r.value.selection)||(r&&r.value&&r.value.value&&r.value.value.selection)||null; if(sel) selections[cwd]=sel; try{ console.log('[wsOverview] cwd',cwd,'sel',sel)}catch{} }catch(e){ try{ console.log('[wsOverview] err cwd',cwd,String(e).slice(0,80))}catch{} }; if(cancelled) return }
          if(cancelled) return
          setWsOverview({loading:false,err:'',bindings,workspaces:wsList,modules,selections})
        }
        loadRef.current = load
        load(); return function(){ cancelled=true }
      },[])
      const gotoWorkspace = function(cwd){
        let wsSvc = null
        try{ if (typeof ctx !== 'undefined' && ctx && typeof ctx.get === 'function') wsSvc = ctx.get('workspaces') }catch{}
        if (!wsSvc && cx && cx.ctx && typeof cx.ctx.get === 'function') try{ wsSvc = cx.ctx.get('workspaces') }catch{}
        if (!wsSvc){ flash(sharedSt, 'workspaces 服务不可用', 'warn'); return }
        try{
          if (typeof wsSvc.open === 'function'){
            const r = wsSvc.open(cwd)
            if (r && typeof r.then === 'function') r.then(function(){ flash(sharedSt, '已跳转到 ' + cwd, 'ok') }).catch(function(e){ flash(sharedSt, '跳转失败: ' + String(e).slice(0,120), 'warn') })
            else flash(sharedSt, '已跳转到 ' + cwd, 'ok')
            return
          }
          if (typeof wsSvc.openWorkspace === 'function'){ wsSvc.openWorkspace({ path: cwd }); flash(sharedSt, '已跳转到 ' + cwd, 'ok'); return }
          if (typeof wsSvc.reveal === 'function'){ wsSvc.reveal(cwd); flash(sharedSt, '已跳转到 ' + cwd, 'ok'); return }
          if (typeof wsSvc.focus === 'function'){ wsSvc.focus(cwd); flash(sharedSt, '已跳转到 ' + cwd, 'ok'); return }
          copyText(sharedSt, cwd, '工作区路径已复制：' + cwd)
          flash(sharedSt, '请手动切换到 ' + cwd, 'info')
        } catch(e){ flash(sharedSt, '跳转失败: ' + String(e).slice(0,120), 'warn') }
      }
      // v1.3.3 T1：模板 textarea 自适应高度（内容全展开 · 无内层滚动 · 最外层滑动）
      const autoGrowTa = function (el) {
        if (!el) return
        el.style.height = 'auto'
        el.style.height = (el.scrollHeight + 2) + 'px'
      }
      // 校验全部 7 个模板（生效文本 = 自定义 || 默认）
      const validateAll = function (executeText) {
        const errList = []
        const check = function (id, text) {
          const v = validateTemplate(id, text || (TPL_DEFAULT[id] ? TPL_DEFAULT[id]() : ''))
          if (!v.ok) {
            const bits = []
            if (v.missing.length) bits.push(tr('tpl.missing', { list: v.missing.map(function (n) { return '{' + n + '}' }).join('、') }))
            if (v.unknown.length) bits.push(tr('tpl.unknown', { list: v.unknown.map(function (n) { return '{' + n + '}' }).join('、') }))
            errList.push('「' + tr('tpl.name.' + id) + '」' + bits.join('；'))
          }
        }
        check('execute', executeText)
        TPL_EDIT_IDS.forEach(function (id) { check(id, tpls[id]) })
        return errList
      }
      const save = function () {
        const errList = validateAll(custom)
        if (errList.length) { setErrs(errList); return }
        setErrs([])
        cfg.openIn = openIn
        cfg.withWayfinder = wf
        templates.execute = custom
        TPL_EDIT_IDS.forEach(function (id) { templates[id] = tpls[id] })
        saveCfg(); saveTemplates(); broadcastCfg()
        setSaved(true)
        if (timer !== undefined) timer.timeout(function () { setSaved(false) }, 2000)
      }
      const setTpl = function (id, val) { setTpls(function (p) { const o = Object.assign({}, p); o[id] = val; return o }) }
      const resetExecute = function () { setTpl('execute', ''); setErrs([]) }
      const resetTpl = function (id) { setTpl(id, ''); setErrs([]) }
      // 页面级恢复全部默认（T1 规格 §5：清空 = 注入时走内置默认文本）
      const resetAll = function () {
        const o = {}
        o.execute = ''
        TPL_EDIT_IDS.forEach(function (id) { o[id] = '' })
        setTpls(o)
        setWf(true)
        setErrs([])
      }
      // 点击占位符 chip 在光标处插入
      const insertPh = function (id, name) {
        const ta = taRefs.current[id]
        const cur = tpls[id] || ''
        if (!ta) { setTpl(id, cur + '{' + name + '}'); return }
        const start = (ta.selectionStart != null) ? ta.selectionStart : cur.length
        const end = (ta.selectionEnd != null) ? ta.selectionEnd : cur.length
        const next = cur.slice(0, start) + '{' + name + '}' + cur.slice(end)
        setTpl(id, next)
        const pos = start + name.length + 2
        setTimeout(function () { try { ta.focus(); ta.setSelectionRange(pos, pos) } catch (e) { /* 忽略 */ } }, 0)
      }
      const chip = function (id, n, req) {
        return h(HoverTip, { key: n, content: req ? tr('cfg.chipReq') : tr('cfg.chipInsert'), mode: 'mouse', maxWidth: 220 }, h('span', { className: 'dsws-cfg-chip' + (req ? ' req' : ''), onClick: function () { insertPh(id, n) } }, [
          h('span', null, '{' + n + '}'),
          req ? h('span', { className: 'must' }, tr('cfg.must')) : null,
        ]))
      }
      const tplCard = function (id) {
        const val = tpls[id] || ''
        const preview = renderTemplate(id, PREVIEW_VALUES)
        const req = (TPL_REQUIRED[id] || []).slice()
        return h('div', { key: id, className: 'dsws-cfg-card' }, [
          h('div', { className: 'dsws-cfg-card-head' }, [
            h('span', { className: 'dsws-cfg-card-name' }, tr('tpl.name.' + id)),
            h('span', { style: { flex: 1 } }),
            h('button', { className: 'dsws-cfg-btn', onClick: function () { resetTpl(id) } }, tr('cfg.reset')),
          ]),
          h('div', { className: 'dsws-cfg-card-desc' }, tr('tpl.desc.' + id)),
          h('div', { className: 'dsws-cfg-chips' }, (TPL_PH[id] || []).map(function (n) { return chip(id, n, req.indexOf(n) >= 0) })),
          h('textarea', { ref: function (el) { taRefs.current[id] = el; autoGrowTa(el) }, className: 'dsws-cfg-ta', placeholder: (TPL_DEFAULT[id] ? TPL_DEFAULT[id]() : ''), value: val, onChange: function (e) { setTpl(id, e.target.value); autoGrowTa(e.target) } }),
          h('div', { className: 'dsws-cfg-preview' }, [h('span', { className: 'pv-label' }, tr('cfg.preview')), preview]),
        ])
      }
      const custom = tpls.execute || ''
      // T5 修订：设置页内 toast（独立于面板 dock 的 notice 渲染）
      const cfgNotice = sharedSt.notice
      return h('div', { className: 'dsws-cfg', style: { position: 'relative' } }, [
        cfgNotice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6, top: 10, bottom: 'auto', right: 'auto', left: 14 } }, [
          Ic({ n: noticeIcon(cfgNotice.kind), size: 13, color: NOTICE_COLOR[cfgNotice.kind] || '#4ade80' }),
          h('span', null, cfgNotice.text),
        ]) : null,
        h('div', { className: 'dsws-cfg-head' }, [
          Icon({ scheme: 'compass', size: 20 }),
          h('span', { className: 't' }, tr('panel.title')),
          h('span', { className: 's', style: { color: saved ? 'var(--dsw-alias-state-success-primary,#4ade80)' : 'var(--dsw-alias-label-caption,#8b8b95)' } }, [
            Ic({ n: saved ? 'check' : 'dot', size: 12 }),
            h('span', null, saved ? tr('cfg.saved') : tr('cfg.status')),
          ]),
        ]),
        h('div', { className: 'dsws-cfg-sub' }, tr('cfg.sub')),
        // v1.5 T4：Matt 技能介绍卡（工程领域 + 通用领域 skills · GitHub 链接 + 安装 prompt 复制/注入）
        h('div', { className: 'dsws-cfg-group' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'star', size: 13 }), h('span', null, tr('matte.title'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, tr('matte.desc')),
          h('div', { className: 'dsws-cfg-row', style: { flexWrap: 'wrap', gap: 6 } }, [
            h('a', { href: MATT_REPO, target: '_blank', rel: 'noreferrer', className: 'dsws-btn', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'link', size: 11 }), h('span', null, tr('matte.openRepo'))]),
            h('button', { className: 'dsws-btn', onClick: function () { copyText(sharedSt, promptText('installSkills', installSkillsParams()), tr('toast.copied')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'clipboard', size: 11 }), h('span', null, tr('matte.copyPrompt'))]),
          ]),
        ]),
        // v1.4：打开位置（details 列 / better-sidebar）—— better-sidebar 未装时仅显示 dock 选项
        h('div', { className: 'dsws-cfg-group' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'map', size: 13 }), h('span', null, tr('cfg.openIn'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, tr('cfg.openInDesc')),
          h('div', { className: 'dsws-cfg-row' }, [
            h('span', { className: 'dsws-cfg-label' }, tr('cfg.openInLabel')),
            h('div', { className: 'dsws-cfg-seg' }, [
              h('button', { key: 'dock', className: openIn === 'dock' ? 'on' : '', onClick: function () { pickOpenIn('dock') } }, tr('cfg.openInDock')),
              (function () { try { return !!ctx.get('betterSidebar') } catch (e) { return false } })()
                ? h('button', { key: 'sidebar', className: openIn === 'sidebar' ? 'on' : '', onClick: function () { pickOpenIn('sidebar') } }, tr('cfg.openInSidebar'))
                : null,
            ]),
            openInNote ? h('div', { style: { fontSize: 11, color: '#4ade80', marginTop: 6 } }, tr('cfg.openInHint')) : null,
          ]),
        ]),
        // #155 Q1 改：只读全局总览（wf.bindings + workspaces.list + wf.registry 色值，不可改；不调 wf.bind）
        h('div', { className: 'dsws-cfg-group', id: 'dsws-cfg-backend' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'compass', size: 13 }), h('span', null, '工作区后端总览')]),
          h('div', { className: 'dsws-cfg-gdesc' }, '各工作区的 Tracker 后端绑定总览（只读，显式覆盖在右侧面板完成）'),
          (function(){
            const selMap=wsOverview.selections||{}
            const bindingsByCwd={}; wsOverview.bindings.forEach(function(b){ const k=(b.cwd||(b.handle&&b.handle.cwd)||''); if(k) bindingsByCwd[String(k)]=b })
            const wsPaths=wsOverview.workspaces.map(function(w){ return w.path||w.cwd||w.dir||w.workspacePath||'' }).filter(Boolean)
            const allSet={}, all=[]; const add=function(c){ const k=String(c); if(!allSet[k]){ allSet[k]=1; all.push(k)}}; wsPaths.forEach(add); Object.keys(bindingsByCwd).forEach(add); Object.keys(selMap).forEach(add); if(!all.length&&sharedSt.cwd) add(sharedSt.cwd)
            if(!all.length) return h('div',{style:{fontSize:11,color:'#8b8b95',padding:'6px 0'}},'暂无工作区')
            // #197 已绑定工作区置顶：已绑定 (backendId) 排前（按 backend 注册序 + basename 字母序），未绑定 (fallback/未指定) 排后（basename 字母序）
                        // 排前分组取 sel (select 三级联产物，source∈{explicit,matches}) + bindingsByCwd 双源兜底，与下方 row 渲染同口径
                        const modsOrder=(wsOverview.modules||[]).map(function(m){return m.id})
                        const isBound=function(c){ const s=selMap[c]||bindingsByCwd[c]; return !!(s&&s.backendId) }
                        const backendRank=function(c){ const s=selMap[c]||bindingsByCwd[c]; const bid=s&&s.backendId; if(!bid) return 9999; const i=modsOrder.indexOf(bid); return i<0?9999:i }
                        const baseName=function(c){ const k=String(c); return k.split(/[\\/]/).pop()||k }
                        const bound=all.filter(isBound)
                        const unbound=all.filter(function(c){return !isBound(c)})
                        bound.sort(function(a,b){ const ra=backendRank(a),rb=backendRank(b); if(ra!==rb) return ra-rb; const ba=baseName(a).toLowerCase(),bb=baseName(b).toLowerCase(); if(ba<bb) return -1; if(ba>bb) return 1; return 0 })
                        unbound.sort(function(a,b){ const ba=baseName(a).toLowerCase(),bb=baseName(b).toLowerCase(); if(ba<bb) return -1; if(ba>bb) return 1; return 0 })
                        const ordered=bound.concat(unbound)
                        const boundCnt=bound.length
            return h('details',{ open:false, style:{ marginTop:6, border:'1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius:8, background:'rgba(255,255,255,.02)'}},[
              h('summary',{ style:{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', cursor:'pointer', listStyle:'none', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', fontSize:11, fontWeight:600 }},[ h('span',{style:{whiteSpace:'nowrap'}},'共 '+all.length+' 个工作区'), h('span',{style:{ color:boundCnt?'#4ade80':'#8b8b95', whiteSpace:'nowrap'}},'已绑定 '+boundCnt), h(Tip, { content: tr('tip.refreshWs') }, h('button',{ style:{ marginLeft:'auto', padding:'2px 8px', fontSize:10, color:'#58a6ff', border:'1px solid #58a6ff', borderRadius:4, background:'transparent', cursor:'pointer', whiteSpace:'nowrap', flex:'none' }, onClick:function(e){ e.preventDefault(); e.stopPropagation(); if(loadRef.current){ loadRef.current().then(function(){ try{ flash(sharedSt,'已刷新','ok') }catch{} }).catch(function(){ try{ flash(sharedSt,'刷新失败','warn') }catch{} }) } } }, '刷新')), h('span',{style:{ fontSize:10, color:'#58a6ff', whiteSpace:'nowrap'}},'点击展开/收起')]),
              h('div',{ style:{ padding:'0 6px 6px' }},[
                wsOverview.loading ? h('div',{style:{fontSize:11,color:'#8b8b95',padding:'6px 0',whiteSpace:'nowrap'}},'加载中…') :
                wsOverview.err ? h('div',{style:{fontSize:11,color:'#f87171',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},wsOverview.err) :
                h('div',{ style:{ display:'flex', flexDirection:'column', gap:0 }}, ordered.map(function(cwd){
                  const sel=selMap[cwd]||bindingsByCwd[cwd]||null
                  const backendId=sel&&sel.backendId!==undefined?sel.backendId:null
                  const label=backendId?(typeof labelOf==='function'?labelOf(backendId):String(backendId)):'未绑定'
                  const color=(typeof backendColorOf==='function'?backendColorOf(backendId):'')
                  const source=sel&&sel.source?sel.source:'fallback'
                  const srcLabel=source==='explicit'?'显式':source==='matches'?'自动':'未指定'
                  const srcColor=source==='explicit'?'#4ade80':source==='matches'?'#58a6ff':'#8b8b95'
                  const srcTitle=source==='explicit'?'显式：你在右侧面板选过，已写入 byHandle':source==='matches'?'自动：按仓库内容自动命中':'未指定：未显式且未自动命中，回退 Other'
                  const base=cwd.split(/[\\/]/).pop()||cwd
                  return h('div',{ key:cwd, style:{ display:'flex', alignItems:'center', gap:8, padding:'7px 8px', borderBottom:'1px solid var(--dsw-alias-border-l1,#2a2d35)', whiteSpace:'nowrap', overflow:'hidden', minHeight:28 }},[
                    h(HoverTip, { content: cwd, mode: 'mouse', maxWidth: 220 }, h('div',{ style:{ flex:'1 1 0', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:11, fontWeight:500 } }, base)),
                    h('span',{ style:{ display:'inline-flex', alignItems:'center', gap:4, flex:'none', whiteSpace:'nowrap', fontSize:11, minWidth:72, justifyContent:'flex-end' }},[ h('span',{style:{width:7,height:7,borderRadius:'50%',background:color,flex:'none'}}), h('span',{style:{fontWeight:600,whiteSpace:'nowrap', minWidth:36, textAlign:'center'}},label) ]),
                    h(HoverTip, { content: srcTitle, mode: 'mouse', maxWidth: 220 }, h('span',{ style:{ fontSize:10, color:srcColor, border:'1px solid '+srcColor, borderRadius:4, padding:'0 4px', flex:'none', whiteSpace:'nowrap', minWidth:44, textAlign:'center', display:'inline-block'}}, srcLabel)),
                  ])
                }))
              ])
            ])
          })(),
        ]),

        // 1.5 面板宽度重置（#398 拆票 A · 与 #397 协调 · 等 layoutSvc.resetDetails API；缺失时友好提示不让 UI 崩溃）
        h('div', { className: 'dsws-cfg-group' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'refresh', size: 13 }), h('span', null, tr('cfg.panelWidth'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, tr('cfg.resetPanelWidthDesc')),
          h('div', { className: 'dsws-cfg-row' }, [
            h('button', { className: 'dsws-cfg-btn', onClick: function () {
              const ls = ctx.get('layout')
              if (ls && typeof ls.resetDetails === 'function') {
                try { ls.resetDetails(); setResetNote({ kind: 'ok', text: tr('toast.resetPanelWidthDone') }) }
                catch (e) { setResetNote({ kind: 'warn', text: tr('toast.resetPanelWidthFail') }) }
              } else {
                setResetNote({ kind: 'warn', text: tr('toast.resetPanelWidthFail') })
              }
              if (timer !== undefined) timer.timeout(function () { setResetNote(null) }, 2800)
            } }, tr('cfg.resetPanelWidth')),
            resetNote ? h('span', { style: { marginLeft: 10, fontSize: 11, color: resetNote.kind === 'ok' ? '#4ade80' : '#fbbf24' } }, resetNote.text) : null,
          ]),
        ]),
        // 2. 开始模板（execute 唯一编辑点；id 供动作模板编辑器锚点跳转）
        h('div', { id: 'dsws-cfg-exec-group', className: 'dsws-cfg-group' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'play', size: 13 }), h('span', null, tr('cfg.startTpl'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, tr('cfg.startTplDesc')),
          h('div', { className: 'dsws-cfg-row' }, [
            h('label', { className: 'dsws-cfg-sw' }, [
              h('input', { type: 'checkbox', checked: wf, onChange: function (e) { setWf(e.target.checked) } }),
              h('span', { className: 'tr' }),
              h('span', null, tr('cfg.withPrefix')),
            ]),
          ]),
          h('textarea', { ref: function (el) { taRefs.current.execute = el; autoGrowTa(el) }, className: 'dsws-cfg-ta', placeholder: (TPL_DEFAULT.execute ? TPL_DEFAULT.execute() : ''), value: custom, onChange: function (e) { setTpl('execute', e.target.value); autoGrowTa(e.target) } }),
          h('div', { className: 'dsws-cfg-chips' }, [
            (TPL_PH.execute || []).map(function (n) { return chip('execute', n, (TPL_REQUIRED.execute || []).indexOf(n) >= 0) }),
            h('button', { className: 'dsws-cfg-btn', style: { marginLeft: 'auto' }, onClick: resetExecute }, tr('cfg.reset')),
          ]),
          h('div', { className: 'dsws-cfg-preview' }, [h('span', { className: 'pv-label' }, tr('cfg.preview')), renderTemplate('execute', PREVIEW_VALUES)]),
        ]),
        // 3. 动作模板编辑器（其余 6 动作 · T1：默认展开可手动折叠）
        h('details', { open: true, className: 'dsws-cfg-group dsws-cfg-details' }, [
          h('summary', { style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 650, marginBottom: 4, cursor: 'pointer', listStyle: 'none' } }, [Ic({ n: 'note', size: 13 }), h('span', null, tr('cfg.tplEditor'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, [
            h('span', null, tr('cfg.tplEditorDesc')),
            h('a', { href: 'javascript:void(0)', onClick: function () { const el = document.getElementById('dsws-cfg-exec-group'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, style: { color: '#bc8cff', cursor: 'pointer', flex: 'none', textDecoration: 'none' } }, tr('cfg.execHint')),
          ]),
          TPL_EDIT_IDS.map(tplCard),
        ]),
        // 校验错误提示
        errs.length ? h('div', { className: 'dsws-cfg-err' }, [
          h('div', { className: 't' }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('cfg.saveRejected'))]),
          errs.map(function (e, i) { return h('div', { key: i }, '· ' + e) }),
        ]) : null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, alignSelf: 'flex-end' } }, [
          h('button', { className: 'dsws-cfg-btn', onClick: resetAll }, tr('cfg.resetAll')),
          h('button', { className: 'dsws-cfg-save', onClick: save }, [Ic({ n: 'check', size: 13 }), h('span', null, tr('cfg.saveAll'))]),
        ]),
        // T2 HoverTip 迁移：移除 sharedSt.cfgTip 全局 portal，改由 HoverTip 统一（行为零变化，翻转/样式走契约）
        null,
      ])
    }