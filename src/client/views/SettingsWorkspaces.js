// views/SettingsWorkspaces.js — 设置页工作区后端总览（从 SettingsPage.js 拆出，V3 #463，纯结构、行为零变化）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
// src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
// 以后谁改它：改工作区后端总览、绑定排序、工作区跳转的人改它。
// 接线：SettingsPage.js 顶部调 useWsOverview 取数据（自带首屏加载，跳转函数随附返回），
//   总览分组处调 renderWsOverview；cwd 归一贴加载逻辑放一起（原样搬入）。
// 参数：cx = 上下文（取工作区服务兜底用）；sharedSt = 设置 store；其余为总览派生与折叠态（调用方传入）。
export const useWsOverview = function (cx, sharedSt) {
      // #190 修复：client 侧 cwd 归一（绝对直通；相对原样交给 host normCwd）。
      const normCwdClient=function(raw){
        if(!raw) return ''
        if(typeof raw!=='string') raw=String(raw)
        try{ if(/^[A-Za-z]:[\\/]/.test(raw)||/^\//.test(raw)) return raw.replace(/[\\/]+$/,'') }catch{}
        return raw
      }
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
      return { wsOverview: wsOverview, loadRef: loadRef, gotoWorkspace: gotoWorkspace }
}
export const renderWsOverview = function (h, sharedSt, wsOverview, loadRef, foldVer, setFoldVer) {
      return h('div', { className: 'dsws-cfg-group', id: 'dsws-cfg-backend' }, [
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
                return h('div',{ key:cwd + '#' + foldVer, style:{ display:'flex', alignItems:'center', gap:8, padding:'7px 8px', borderBottom:'1px solid var(--dsw-alias-border-l1,#2a2d35)', whiteSpace:'nowrap', overflow:'hidden', minHeight:28 }},[
                  h(HoverTip, { content: cwd, mode: 'mouse', maxWidth: 220 }, h('div',{ style:{ flex:'1 1 0', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:11, fontWeight:500 } }, base)),
                  h('span',{ style:{ display:'inline-flex', alignItems:'center', gap:4, flex:'none', whiteSpace:'nowrap', fontSize:11, minWidth:72, justifyContent:'flex-end' }},[ h('span',{style:{width:7,height:7,borderRadius:'50%',background:color,flex:'none'}}), h('span',{style:{fontWeight:600,whiteSpace:'nowrap', minWidth:36, textAlign:'center'}},label) ]),
                  h(HoverTip, { content: srcTitle, mode: 'mouse', maxWidth: 220 }, h('span',{ style:{ fontSize:10, color:srcColor, border:'1px solid '+srcColor, borderRadius:4, padding:'0 4px', flex:'none', whiteSpace:'nowrap', minWidth:44, textAlign:'center', display:'inline-block'}}, srcLabel)),
                  h(Tip, { content: tr(typeof isBannerFolded === 'function' && isBannerFolded(cwd) ? 'banner.expandDeck' : 'banner.foldDeck') }, h('button',{ className:'dsws-cfg-btn', style:{ marginLeft:'auto', flex:'none', whiteSpace:'nowrap' }, onClick:function(){ try{ if(typeof setBannerFolded==='function') setBannerFolded(cwd, !(typeof isBannerFolded==='function' && isBannerFolded(cwd))) }catch(e){} setFoldVer(function(v){ return v+1 }) } }, tr(typeof isBannerFolded === 'function' && isBannerFolded(cwd) ? 'banner.expandShort' : 'banner.foldShort'))),
                ])
              }))
            ])
          ])
        })(),
      ])
}
