/**
 * statusbar/StatusBackend.js — 状态栏后端选择与门控动作（从 StatusBar.js 拆出，B1 #460，纯结构、行为零变化）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
 * 以后谁改它：改状态栏后端选择（setup 黄条选后端：拉清单选定确认注入；gate 蓝条选后端：打开关闭确认绑定）的人改它。
 * #655 起本文件还管初始化小卡上的第二组单选（域文档布局）与「没选过布局就先弹卡、不注入」这条漏斗。
 * 接线：StatusBar.js 留六个转调包装（cancel/confirmSetupPick、onSetupInit、open/closeGate、confirmGateStatus）供渲染直调；
 *   本文件不引用 StatusMenus.js（同闭包拼回，调用方向见 StatusBar.js 转调六处）。
 *   openStatusSetupPick 当前渲染未直接调用（setup 黄条走 onStatusSetupInit），随旅程整体搬入保持行为一致。
 */
// #655：域文档布局的两个取值（与 locale 里两句注入文案、卡片上两个选项一一对应）。
//   布局只活在本次会话——不落持久状态、不加「改布局」的入口；想改就改 docs/agents/domain.md，或重跑一次初始化。
export const SETUP_LAYOUT_VALUES = ['single', 'multi']
export const SETUP_LAYOUT_FALLBACK = 'single'
export const readStatusSetupLayout = function(s){
  try{ const v=String((s&&s.setupLayout)||'').toLowerCase(); return SETUP_LAYOUT_VALUES.indexOf(v)>=0?v:null }catch(e){ return null }
}
// 卡片上这一组单选默认选中哪一项：已经选过的（含从别处选完又打开这张卡）优先，否则回到第一项「一个仓库共用一份词表」。
export const layoutSelectionOf = function(s){
  const picked=readStatusSetupLayout(s); if(picked) return picked
  try{ const v=String((s&&s.setupPickLayout)||'').toLowerCase(); if(SETUP_LAYOUT_VALUES.indexOf(v)>=0) return v }catch(e){}
  return SETUP_LAYOUT_FALLBACK
}
// 把布局记进会话状态：注入决策函数就是从这里读「这个仓库的布局选没选过」的，所以只在这里写。
export const applyStatusSetupLayout = function(s, v){
  const t=String(v==null?'':v).toLowerCase()
  if(SETUP_LAYOUT_VALUES.indexOf(t)<0) return
  try{ s.setupLayout=t }catch(e){}
}
// 卡片与门控弹窗共用的一组单选（域文档布局）：返回一组 label，供 StatusBar.js 的两处渲染直接放进去。
export const layoutRadios = function(s, h){
  const sel=layoutSelectionOf(s)
  const one=function(v, key){
    const isSel=sel===v
    return h('label', { key:'layout-'+v, style:{ display:'flex', alignItems:'center', gap:8, padding:'6px 9px', borderRadius:8, border: isSel?'1px solid #58a6ff':'1px solid var(--dsw-alias-border-l1,#2a2d35)', background: isSel?'rgba(88,166,255,.08)':'transparent', cursor:'pointer' } }, [
      h('input', { type:'radio', name:'setup-layout', checked:isSel, onChange:function(){ s.setupPickLayout=v; emit(s) } }),
      h('span', { style:{ fontSize:12, fontWeight:600 } }, tr(key)),
    ])
  }
  return h('div', { style:{ marginTop:4 } }, [
    h('div', { style:{ fontSize:11, color:'#8b8b95', margin:'2px 0 6px', lineHeight:1.5 } }, tr('setup.layoutQuestion')),
    h('div', { style:{ display:'flex', flexDirection:'column', gap:6 } }, [one('single','setup.layoutSingle'), one('multi','setup.layoutMulti')]),
  ])
}
export const normStatusMods = function(r){
  let ms=null
  if(r&&r.ok&&r.value&&Array.isArray(r.value.modules)) ms=r.value.modules
  else if(r&&r.ok&&Array.isArray(r.modules)) ms=r.modules
  else if(r&&r.modules&&Array.isArray(r.modules)) ms=r.modules
  if(!Array.isArray(ms)) return null
  const f=ms.filter(function(m){return String(m.id).toLowerCase()!=='other'})
  return f.length?f:null
}
export const ensureStatusSetupPick = function(s, cb){
  if(s.setupPickModules&&s.setupPickModules.length){cb(s.setupPickModules);return}
  if(typeof host==='undefined'||typeof host.call!=='function'){s.setupPickModules=[];cb(s.setupPickModules);return}
  s.setupPickLoading=true;emit(s)
  host.call('wf.registry',{cwd:s.cwd||''}).then(function(r){
    s.setupPickLoading=false
    const ms=normStatusMods(r)
    if(ms){s.setupPickModules=ms;const cur=s.selection&&s.selection.backendId!=null?s.selection.backendId:firstBackendIdOf(null);s.setupPickRecommended=cur;if(!s.setupPickSelected)s.setupPickSelected=cur;emit(s);cb(ms);return}
    s.setupPickErr=String(r&&(r.error||r.message)||'unknown').slice(0,120);emit(s);cb([])
  }).catch(function(e){s.setupPickLoading=false;s.setupPickErr=String(e).slice(0,120);emit(s);cb([])})
}
export const openStatusSetupPick = function(s){s.setupPickOpen=true;if(!s.setupPickSelected){const cur=s.selection&&s.selection.backendId!=null?s.selection.backendId:firstBackendIdOf(null);s.setupPickSelected=cur;s.setupPickRecommended=cur}if(!s.setupPickLayout)s.setupPickLayout=layoutSelectionOf(s);ensureStatusSetupPick(s, function(){emit(s)});emit(s)}
export const closeStatusSetupPick = function(s){s.setupPickOpen=false;s.setupLayoutCardOpen=false;s.setupPickErr='';emit(s)}
export const cancelStatusSetupPick = function(s){closeStatusSetupPick(s)}
export const confirmStatusSetupPick = function(s){
  const id=s.setupPickSelected||s.setupPickRecommended||firstBackendIdOf(null)
  // #655：卡上这一组单选（域文档布局）与后端一起答完再注入。
  applyStatusSetupLayout(s, layoutSelectionOf(s))
  const prev=s.selection
  s.selection={backendId:id,source:'explicit',ref:(s.repository||(s.snapshot&&s.snapshot.repository)||null)}
  try{if(s.cwd)setCachedSelection(s.cwd,s.selection)}catch{}
  emit(s);closeStatusSetupPick(s)
  if(typeof host!=='undefined'&&host.call)host.call('wf.bind',{cwd:s.cwd||'',backendId:id}).then(function(res){const ok=res&&(res.ok||(res.value&&res.value.ok));if(ok){try{flash(s,'已选择 '+(typeof labelOf==='function'?labelOf(id):id),'ok')}catch{};loadSnapshot(s,true,true)}else{s.selection=prev;emit(s);try{flash(s,tr('switch.bindFail',{err:String(res&&(res.error||res.message)||'unknown')}),'warn')}catch{}}}).catch(function(){s.selection=prev;emit(s)})
  try{ injectSetupDecision(s,id,{allowCard:true}) }catch(e){} // #496 Q2 缺仓改发建仓指引；#655 布局已在这一步记下，注入决策只判不再问
}
// #655：黄条那颗「初始化」按钮也走同一个注入决策函数 —— 布局没选过时那个函数只开卡不注入
//   （allowCard:true 是因为这张卡就渲染在黄条下面，弹得出来），所以这里不再自己判「弹卡还是注入」，
//   一律交出去（否则就是规格里说的「绕过小卡直接注入」）。
export const onStatusSetupInit = function(s){
  const id=s.selection && s.selection.backendId!=null ? s.selection.backendId : (s.setupPickSelected||s.setupPickRecommended||firstBackendIdOf(null));
  try{s.setupPickOpen=false;emit(s);}catch(e){}
  try{ injectSetupDecision(s,id,{allowCard:true}) }catch(e){}
}
export const openStatusGate = function(s){
  s.gateModalOpen=true;s.gateModalSource='status';if(!s.gateSelected)s.gateSelected=firstBackendIdOf(null);s.gateError='';emit(s);
  if(typeof host!=='undefined'&&host.call){s.gateLoading=true;emit(s);host.call('wf.registry',{cwd:s.cwd||''}).then(function(r){s.gateLoading=false;let m=null;if(r&&r.ok&&Array.isArray(r.modules))m=r.modules;else if(r&&Array.isArray(r.modules))m=r.modules;else if(r&&r.value&&Array.isArray(r.value.modules))m=r.value.modules;if(Array.isArray(m)&&m.length){const f=m.filter(function(x){return String(x.id).toLowerCase()!=='other'});const fin=f.length?f:m;if(fin.length){s.backendModules=m;try{if(typeof setPresentationMap==='function')setPresentationMap(m)}catch(e){}const ids=fin.map(function(x){return x.id});if(!s.gateSelected||ids.indexOf(s.gateSelected)<0)s.gateSelected=fin[0].id}}emit(s)}).catch(function(){s.gateLoading=false;emit(s)});}
}
export const closeStatusGate = function(s){ s.gateModalOpen=false; s.gateModalSource=null; s.gateError=''; emit(s); };
export const confirmStatusGate = function(s){ const id=s.gateSelected||firstBackendIdOf(null); if(String(id).toLowerCase()==='other'){ s.gateError=tr('switch.gateOtherErr'); emit(s); return; }
  // #655：这个弹窗（第一次打开工作区时选后端）里也放了同一组单选；在这里选过就记进会话状态，与黄条那张卡同一口径。
  applyStatusSetupLayout(s, layoutSelectionOf(s))
  const prev=s.selection; const repoRef=s.repository||(s.snapshot&&s.snapshot.repository)||null; const nxt={backendId:id,source:'explicit',ref:repoRef}; s.selection=nxt; try{ if(s.cwd)setCachedSelection(s.cwd,nxt) }catch(e){} s.gateModalOpen=false; s.gateModalSource=null; emit(s); if(typeof host!=='undefined'&&host.call){ host.call('wf.bind',{cwd:s.cwd||'',backendId:id}).then(function(res){ const ok=res&&(res.ok===true||(res.value&&res.value.ok===true)||res.ok); if(ok){ s.tab='list'; emit(s); try{ flash(s,tr('switch.bindOk',{label:(typeof labelOf==='function'?labelOf(id):String(id))}),'ok') }catch(e){} try{ injectSetupDecision(s,id,{allowCard:true}) }catch(e){} // #496 Q2：缺仓改发建仓指引并记待补标记；#655 卡就在这个弹窗所在的界面上，弹得出来
 loadSnapshot(s,true,true); } else { s.selection=prev; try{ if(s.cwd)setCachedSelection(s.cwd,prev) }catch(e){} emit(s); try{ flash(s,tr('switch.bindFail',{err:String(res&&(res.error||res.message)||'unknown')}),'warn') }catch(e){} } }).catch(function(){ s.selection=prev; try{ if(s.cwd)setCachedSelection(s.cwd,prev) }catch(e){} emit(s); }); } };
