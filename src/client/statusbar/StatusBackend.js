/**
 * statusbar/StatusBackend.js — 状态栏后端选择与门控动作（从 StatusBar.js 拆出，B1 #460，纯结构、行为零变化）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
 * 以后谁改它：改状态栏后端选择（setup 黄条选后端：拉清单选定确认注入；gate 蓝条选后端：打开关闭确认绑定）的人改它。
 * 接线：StatusBar.js 留六个转调包装（cancel/confirmSetupPick、onSetupInit、open/closeGate、confirmGateStatus）供渲染直调；
 *   本文件不引用 StatusMenus.js（同闭包拼回，调用方向见 StatusBar.js 转调六处）。
 *   openStatusSetupPick 当前渲染未直接调用（setup 黄条走 onStatusSetupInit），随旅程整体搬入保持行为一致。
 */
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
export const openStatusSetupPick = function(s){s.setupPickOpen=true;if(!s.setupPickSelected){const cur=s.selection&&s.selection.backendId!=null?s.selection.backendId:firstBackendIdOf(null);s.setupPickSelected=cur;s.setupPickRecommended=cur}ensureStatusSetupPick(s, function(){emit(s)});emit(s)}
export const closeStatusSetupPick = function(s){s.setupPickOpen=false;s.setupPickErr='';emit(s)}
export const cancelStatusSetupPick = function(s){closeStatusSetupPick(s)}
export const confirmStatusSetupPick = function(s){
  const id=s.setupPickSelected||s.setupPickRecommended||firstBackendIdOf(null)
  const prev=s.selection
  s.selection={backendId:id,source:'explicit',ref:(s.repository||(s.snapshot&&s.snapshot.repository)||null)}
  try{if(s.cwd)setCachedSelection(s.cwd,s.selection)}catch{}
  emit(s);closeStatusSetupPick(s)
  if(typeof host!=='undefined'&&host.call)host.call('wf.bind',{cwd:s.cwd||'',backendId:id}).then(function(res){const ok=res&&(res.ok||(res.value&&res.value.ok));if(ok){try{flash(s,'已选择 '+(typeof labelOf==='function'?labelOf(id):id),'ok')}catch{};loadSnapshot(s,true,true)}else{s.selection=prev;emit(s);try{flash(s,tr('switch.bindFail',{err:String(res&&(res.error||res.message)||'unknown')}),'warn')}catch{}}}).catch(function(){s.selection=prev;emit(s)})
  try{inject(s,setupRunPrompt(s,id))}catch(e){} // #230（D10）：占位符由后端描述数据填充
}
export const onStatusSetupInit = function(s){
  const id=s.selection && s.selection.backendId!=null ? s.selection.backendId : (s.setupPickSelected||s.setupPickRecommended||firstBackendIdOf(null));
  try{s.setupPickOpen=false;emit(s);}catch(e){}
  try{inject(s,setupRunPrompt(s,id))}catch(e){} // #230（D10）：占位符由后端描述数据填充
}
export const openStatusGate = function(s){
  s.gateModalOpen=true;s.gateModalSource='status';if(!s.gateSelected)s.gateSelected=firstBackendIdOf(null);s.gateError='';emit(s);
  if(typeof host!=='undefined'&&host.call){s.gateLoading=true;emit(s);host.call('wf.registry',{cwd:s.cwd||''}).then(function(r){s.gateLoading=false;let m=null;if(r&&r.ok&&Array.isArray(r.modules))m=r.modules;else if(r&&Array.isArray(r.modules))m=r.modules;else if(r&&r.value&&Array.isArray(r.value.modules))m=r.value.modules;if(Array.isArray(m)&&m.length){const f=m.filter(function(x){return String(x.id).toLowerCase()!=='other'});const fin=f.length?f:m;if(fin.length){s.backendModules=m;try{if(typeof setPresentationMap==='function')setPresentationMap(m)}catch(e){}const ids=fin.map(function(x){return x.id});if(!s.gateSelected||ids.indexOf(s.gateSelected)<0)s.gateSelected=fin[0].id}}emit(s)}).catch(function(){s.gateLoading=false;emit(s)});}
}
export const closeStatusGate = function(s){ s.gateModalOpen=false; s.gateModalSource=null; s.gateError=''; emit(s); };
export const confirmStatusGate = function(s){ const id=s.gateSelected||firstBackendIdOf(null); if(String(id).toLowerCase()==='other'){ s.gateError=tr('switch.gateOtherErr'); emit(s); return; } const prev=s.selection; const repoRef=s.repository||(s.snapshot&&s.snapshot.repository)||null; const nxt={backendId:id,source:'explicit',ref:repoRef}; s.selection=nxt; try{ if(s.cwd)setCachedSelection(s.cwd,nxt) }catch(e){} s.gateModalOpen=false; s.gateModalSource=null; emit(s); if(typeof host!=='undefined'&&host.call){ host.call('wf.bind',{cwd:s.cwd||'',backendId:id}).then(function(res){ const ok=res&&(res.ok===true||(res.value&&res.value.ok===true)||res.ok); if(ok){ s.tab='list'; emit(s); try{ flash(s,tr('switch.bindOk',{label:(typeof labelOf==='function'?labelOf(id):String(id))}),'ok') }catch(e){} try{ const tt=(typeof setupRunPrompt==='function'?setupRunPrompt(s,id):''); if(tt) try{ inject(s,tt) }catch(e){} }catch(e){} loadSnapshot(s,true,true); } else { s.selection=prev; try{ if(s.cwd)setCachedSelection(s.cwd,prev) }catch(e){} emit(s); try{ flash(s,tr('switch.bindFail',{err:String(res&&(res.error||res.message)||'unknown')}),'warn') }catch(e){} } }).catch(function(){ s.selection=prev; try{ if(s.cwd)setCachedSelection(s.cwd,prev) }catch(e){} emit(s); }); } };
