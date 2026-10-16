// views/SettingsWorkspaces.js — 设置页工作区后端总览（从 SettingsPage.js 拆出，V3 #463，纯结构、行为零变化）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
// src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
// 以后谁改它：改工作区后端总览、绑定排序、工作区跳转的人改它。
// 接线：SettingsPage.js 顶部调 useWsOverview 取数据（自带首屏加载，跳转函数随附返回），
//   总览分组处调 renderWsOverview；cwd 归一贴加载逻辑放一起（原样搬入）。
// 参数：cx = 上下文（取工作区服务兜底用）；sharedSt = 设置 store；其余为总览派生与折叠态（调用方传入）。
// 渲染口径（#1231，按 #1233 定版）：总览的行怎么算只认统一判定结论这一处——
//   批量预读表不再是第二口径，行按工作区根合并，重名用最短唯一后缀区分。
//   下面三个是纯函数（不碰宿主、不碰界面、不读钟），只喂值、看返回值，
//   口径行为由 tests/verify-1231-ws-overview-rows.ts 锁死。
//   构建拼叶子时禁运行时引用，所以后缀算法在这里实现一份；它与版本管理页签是同一套
//   （来源 src/shared/version-control/src/state.ts 的 shortestUniqueSuffix），对拍写在同一份测试里，漂了就红。
export const wsSuffixKeepOf = function (paths) {
  // 最短唯一后缀：每条路径从末段往左数到可区分的最少段数（全撞车就取全长）。
  const segs = paths.map(function (p) { return String(p).replace(/\\/g, '/').split('/').filter(function (s) { return s !== '' }) })
  return segs.map(function (s, i) {
    for (let n = 1; n <= s.length; n += 1) {
      const tail = s.slice(-n).join('/').toLowerCase()
      let clash = false
      for (let j = 0; j < segs.length; j += 1) {
        if (j === i) continue
        if (segs[j].slice(-n).join('/').toLowerCase() === tail) { clash = true; break }
      }
      if (!clash) return n
    }
    return s.length
  })
}
export const wsDisplayOf = function (path, keep) {
  // 显示名：取路径末尾 keep 段，段之间用斜杠连（与版本管理页签同一套写法）。
  const segs = String(path).replace(/\\/g, '/').split('/').filter(function (s) { return s !== '' })
  return segs.slice(-Math.max(1, keep)).join('/')
}
export const computeWsOverviewRows = function (paths, selections, deps) {
  // 总览行计算：输入候选目录清单与统一判定结论表（所选目录 → 判定结论），输出要渲染的行。
  //   deps = { normKeyOf, rootKeyOf, resolveRoot, modulesOrder }，规整与查根由调用方递进来，这里不直接认全局。
  //   合并：能查到同一个工作区根的目录并成一行，代表行优先取根本身；查不到根的各自成行（不猜）。
  //   判定：代表行优先认自己的结论，没有再看组里有没有成员有结论（组里有一个就算这组已绑定）；
  //     全组都没有就是未绑定，后端名空、来源记 fallback。
  //   排序：已绑定置顶（按后端注册序再按显示名），未绑定按显示名。
  const normKeyOf = deps.normKeyOf
  const rootKeyOf = deps.rootKeyOf
  const resolveRoot = deps.resolveRoot
  const modulesOrder = deps.modulesOrder || []
  const selMap = selections || {}
  const groups = {}
  const groupOrder = []
  paths.forEach(function (p) {
    const k = normKeyOf(p)
    if (!k) return
    let rk = ''
    try { rk = rootKeyOf(p) || '' } catch (e) { rk = '' }
    if (!rk) rk = k
    if (!groups[rk]) { groups[rk] = { members: [] }; groupOrder.push(rk) }
    groups[rk].members.push(p)
  })
  const rows = groupOrder.map(function (rk) {
    const members = groups[rk].members
    let rep = members[0]
    for (let i = 0; i < members.length; i += 1) {
      if (normKeyOf(members[i]) === rk) { rep = members[i]; break }
    }
    const ordered = [rep].concat(members.filter(function (m) { return m !== rep }))
    let sel = selMap[rep] || null
    if (!(sel && sel.backendId)) {
      for (let i = 0; i < ordered.length; i += 1) {
        const s = selMap[ordered[i]]
        if (s && s.backendId) { sel = s; break }
      }
    }
    const backendId = (sel && sel.backendId !== undefined) ? sel.backendId : null
    let root = ''
    try { root = resolveRoot(rk) || '' } catch (e) { root = '' }
    // root 是这一组的工作区根（原样路径，找得到才有；找不到就是空，不猜）。
    //   代表行优先取根本身；根不在清单里时才退到组里第一条（这时根是空的）。
    //   merged 标记这组是不是真并进了不止一条目录，渲染层据此决定要不要标一句。
    return { cwd: rep, root: root, members: members.slice(), merged: members.length > 1, backendId: backendId, source: (sel && sel.source) ? sel.source : 'fallback', bound: !!backendId }
  })
  // 显示名：代表行之间按最短唯一后缀区分（重名取两段以上，不重名只取末段）。
  const keeps = wsSuffixKeepOf(rows.map(function (r) { return r.cwd }))
  rows.forEach(function (r, i) { r.display = wsDisplayOf(r.cwd, keeps[i]) })
  const rankOf = function (bid) { if (!bid) return 9999; const i = modulesOrder.indexOf(bid); return i < 0 ? 9999 : i }
  const byDisplay = function (a, b) { const x = String(a.display).toLowerCase(), y = String(b.display).toLowerCase(); if (x < y) return -1; if (x > y) return 1; return 0 }
  const bound = rows.filter(function (r) { return r.bound })
  const unbound = rows.filter(function (r) { return !r.bound })
  bound.sort(function (a, b) { const ra = rankOf(a.backendId), rb = rankOf(b.backendId); if (ra !== rb) return ra - rb; return byDisplay(a, b) })
  unbound.sort(byDisplay)
  const ordered = bound.concat(unbound)
  return { rows: ordered, total: ordered.length, boundCount: bound.length }
}
export const useWsOverview = function (cx, sharedSt) {
      // #190 修复：client 侧 cwd 归一（绝对直通；相对原样交给 host normCwd）。
      const normCwdClient=function(raw){
        if(!raw) return ''
        if(typeof raw!=='string') raw=String(raw)
        try{ if(/^[A-Za-z]:[\\/]/.test(raw)||/^\//.test(raw)) return raw.replace(/[\\/]+$/,'') }catch{}
        return raw
      }
      const [wsOverview, setWsOverview] = React.useState({ loading:true, err:'', workspaces:[], modules:[], selections:{} })
      const loadRef = React.useRef(null)
      React.useEffect(function(){
        let cancelled=false
        const load=async function(){
          setWsOverview(function(p){ return Object.assign({},p,{loading:true,err:''}) })
          let modules=[], selections={}, wsList=[]
          if(typeof host!=='undefined'&&typeof host.call==='function'){
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
          const allSet={}, all=[]; const add=function(c){ const k=String(c); if(!allSet[k]){ allSet[k]=1; all.push(k)}}; wsList.forEach(function(w){ const raw=w.path||w.cwd||w.dir||w.workspacePath||w.root||w.fullPath||''; const k=normCwdClient(raw); if(k) add(k) });
          // #1231：只认统一判定结论，不再批量预读另一份表——那份表是第二口径，已删。
          //   行名单只从工作区服务来；拿不到名单又没有当前目录就空着，不猜。
          if(!all.length&&sharedSt.cwd) add(sharedSt.cwd)
          for(let i=0;i<all.length;i++){ const cwd=all[i]; try{ const r=await host.call('wf.selection',{cwd}); const sel=(r&&r.selection)||(r&&r.value&&r.value.selection)||(r&&r.value&&r.value.value&&r.value.value.selection)||null; if(sel) selections[cwd]=sel }catch(e){}; if(cancelled) return }
          if(cancelled) return
          setWsOverview({loading:false,err:'',workspaces:wsList,modules,selections})
        }
        loadRef.current = load
        load(); return function(){ cancelled=true }
      },[])
      const gotoWorkspace = function(cwd){
        let wsSvc = null
        try{ if (typeof ctx !== 'undefined' && ctx && typeof ctx.get === 'function') wsSvc = ctx.get('workspaces') }catch{}
        if (!wsSvc && cx && cx.ctx && typeof cx.ctx.get === 'function') try{ wsSvc = cx.ctx.get('workspaces') }catch{}
        if (!wsSvc){ flash(sharedSt, tr('cfg.wsNoService'), 'warn'); return }
        try{
          if (typeof wsSvc.open === 'function'){
            const r = wsSvc.open(cwd)
            if (r && typeof r.then === 'function') r.then(function(){ flash(sharedSt, tr('cfg.wsJumpedTo', { cwd: cwd }), 'ok') }).catch(function(e){ flash(sharedSt, tr('cfg.wsJumpFail', { msg: String(e).slice(0,120) }), 'warn') })
            else flash(sharedSt, tr('cfg.wsJumpedTo', { cwd: cwd }), 'ok')
            return
          }
          if (typeof wsSvc.openWorkspace === 'function'){ wsSvc.openWorkspace({ path: cwd }); flash(sharedSt, tr('cfg.wsJumpedTo', { cwd: cwd }), 'ok'); return }
          if (typeof wsSvc.reveal === 'function'){ wsSvc.reveal(cwd); flash(sharedSt, tr('cfg.wsJumpedTo', { cwd: cwd }), 'ok'); return }
          if (typeof wsSvc.focus === 'function'){ wsSvc.focus(cwd); flash(sharedSt, tr('cfg.wsJumpedTo', { cwd: cwd }), 'ok'); return }
          copyText(sharedSt, cwd, tr('cfg.wsPathCopied', { cwd: cwd }))
          flash(sharedSt, tr('cfg.wsSwitchManually', { cwd: cwd }), 'info')
        } catch(e){ flash(sharedSt, tr('cfg.wsJumpFail', { msg: String(e).slice(0,120) }), 'warn') }
      }
      return { wsOverview: wsOverview, loadRef: loadRef, gotoWorkspace: gotoWorkspace }
}
export const renderWsOverview = function (h, sharedSt, wsOverview, loadRef, foldVer, setFoldVer) {
      // #653 归属标注：按 #649 定版记录 3.5 节，规则生效后被并进工作区根的那几行要标出归属，
      //   但**不删、不迁移**用户已有的分桶状态（插件不擅自清理用户的持久状态），所以这里只是加一句说明。
      // 怎么知道某一行被并进了谁：host 从 #652 起把工作区身份锚到了工作区根，客户端在装快照时
      //   把「所选目录 → 工作区根」记进了 store-snapshot.js 的 workspaceRootByCwd 表（快照里也带回来一份）。
      //   把这几个来源并起来看成一张表：某一行能查到根、且根不是它自己、而根本身又在这张清单里 →
      //   这一行就是被并进根的子目录行。查不到就不标（宁可不标，也不猜一个路径给用户看）。
      const rootOf = function (p) {
        try {
          const k = (typeof keyOf === 'function') ? keyOf(p) : String(p || '')
          if (!k) return ''
          const hit = (typeof workspaceRootByCwd === 'object' && workspaceRootByCwd) ? workspaceRootByCwd[k] : ''
          if (hit) return hit
          if (typeof getCachedSnapshot === 'function') {
            const s = getCachedSnapshot(k)
            const r = s && s.workspaceRoot
            if (r) return (typeof keyOf === 'function') ? keyOf(r) : String(r)
          }
        } catch (e) {}
        return ''
      }
      return h('div', { className: 'dsws-cfg-group', id: 'dsws-cfg-backend' }, [
        h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'compass', size: 13 }), h('span', null, tr('cfg.wsTitle'))]),
        h('div', { className: 'dsws-cfg-gdesc' }, tr('cfg.wsDesc')),
        (function(){
          const selMap=wsOverview.selections||{}
          const wsPaths=wsOverview.workspaces.map(function(w){ return w.path||w.cwd||w.dir||w.workspacePath||'' }).filter(Boolean)
          const seen={}, all=[]; wsPaths.forEach(function(c){ const k=String(c); if(!seen[k]){ seen[k]=1; all.push(k) } }); if(!all.length&&sharedSt.cwd) all.push(sharedSt.cwd)
          if(!all.length) return h('div',{style:{fontSize:11,color:'#8b8b95',padding:'6px 0'}},tr('cfg.wsEmpty'))
          // #653 归属标注所需的两个表：哪些行本身是工作区根、哪些行的根是谁（根用规整键比对，显示用原样路径）
          const normOf = function (p) { try { return (typeof keyOf === 'function') ? keyOf(p) : String(p || '').toLowerCase() } catch (e) { return String(p || '') } }
          const byNorm = {}
          all.forEach(function (c) { const n = normOf(c); if (n && !byNorm[n]) byNorm[n] = c })
          // #1231：行怎么算只认统一判定结论——合并、判定、排序都收进上面的纯函数，这里只递规整与查根，不再自建第二口径。
          const modsOrder=(wsOverview.modules||[]).map(function(m){return m.id})
          const view=computeWsOverviewRows(all, selMap, {
            normKeyOf: normOf,
            rootKeyOf: rootOf,
            resolveRoot: function (rk) { return byNorm[rk] || '' },
            modulesOrder: modsOrder,
          })
          const ordered=view.rows
          const boundCnt=view.boundCount
          return h('details',{ open:false, style:{ marginTop:6, border:'1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius:8, background:'rgba(255,255,255,.02)'}},[
            h('summary',{ style:{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', cursor:'pointer', listStyle:'none', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', fontSize:11, fontWeight:600 }},[ h('span',{style:{whiteSpace:'nowrap'}},tr('cfg.wsTotal', { n: view.total })), h('span',{style:{ color:boundCnt?'#4ade80':'#8b8b95', whiteSpace:'nowrap'}},tr('cfg.wsBound', { n: boundCnt })), h(Tip, { content: tr('tip.refreshWs') }, h('button',{ style:{ marginLeft:'auto', padding:'2px 8px', fontSize:10, color:'#58a6ff', border:'1px solid #58a6ff', borderRadius:4, background:'transparent', cursor:'pointer', whiteSpace:'nowrap', flex:'none' }, onClick:function(e){ e.preventDefault(); e.stopPropagation(); if(loadRef.current){ loadRef.current().then(function(){ try{ flash(sharedSt,tr('cfg.wsRefreshed'),'ok') }catch{} }).catch(function(){ try{ flash(sharedSt,tr('cfg.wsRefreshFail'),'warn') }catch{} }) } } }, tr('cfg.wsRefresh'))), h('span',{style:{ fontSize:10, color:'#58a6ff', whiteSpace:'nowrap'}},tr('cfg.wsToggleHint'))]),
            h('div',{ style:{ padding:'0 6px 6px' }},[
              wsOverview.loading ? h('div',{style:{fontSize:11,color:'#8b8b95',padding:'6px 0',whiteSpace:'nowrap'}},tr('cfg.wsLoading')) :
              wsOverview.err ? h('div',{style:{fontSize:11,color:'#f87171',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},wsOverview.err) :
              h('div',{ style:{ display:'flex', flexDirection:'column', gap:0 }}, ordered.map(function(row){
                const cwd=row.cwd
                const backendId=row.backendId
                const label=backendId?(typeof labelOf==='function'?labelOf(backendId):String(backendId)):tr('cfg.wsUnbound')
                const color=(typeof backendColorOf==='function'?backendColorOf(backendId):'')
                const source=row.source
                const srcLabel=source==='explicit'?tr('cfg.wsSrcExplicit'):source==='matches'?tr('cfg.wsSrcAuto'):tr('cfg.wsSrcUnset')
                const srcColor=source==='explicit'?'#4ade80':source==='matches'?'#58a6ff':'#8b8b95'
                const srcTitle=source==='explicit'?tr('cfg.wsSrcExplicitTip'):source==='matches'?tr('cfg.wsSrcAutoTip'):tr('cfg.wsSrcUnsetTip')
                const display=row.display||cwd
                // #653：这一组并进了不止一条目录才标一句（几条目录并在这里）；Hover 浮层给组里每条原样路径，不猜。
                const mergedNote = row.merged ? tr('cfg.wsMergedCount', { n: row.members.length }) : ''
                const hoverText = row.merged ? row.members.join(' ｜ ') : cwd
                return h('div',{ key:cwd + '#' + foldVer, style:{ display:'flex', alignItems:'center', gap:8, padding:'7px 8px', borderBottom:'1px solid var(--dsw-alias-border-l1,#2a2d35)', whiteSpace:'nowrap', overflow:'hidden', minHeight:28 }},[
                  h(HoverTip, { content: hoverText, mode: 'mouse', maxWidth: 220 }, h('div',{ style:{ flex:'1 1 0', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:11, fontWeight:500 } }, mergedNote ? (display + ' ' + mergedNote) : display)),
                  h('span',{ style:{ display:'inline-flex', alignItems:'center', gap:4, flex:'none', whiteSpace:'nowrap', fontSize:11, minWidth:72, justifyContent:'flex-end' }},[ h('span',{style:{width:7,height:7,borderRadius:'50%',background:color,flex:'none'}}), h('span',{style:{fontWeight:600,whiteSpace:'nowrap', minWidth:36, textAlign:'center'}},label) ]),
                  h(HoverTip, { content: srcTitle, mode: 'mouse', maxWidth: 220 }, h('span',{ style:{ fontSize:10, color:srcColor, border:'1px solid '+srcColor, borderRadius:4, padding:'0 4px', flex:'none', whiteSpace:'nowrap', minWidth:44, textAlign:'center', display:'inline-block'}}, srcLabel)),
                ])
              }))
            ])
          ])
        })(),
      ])
}
