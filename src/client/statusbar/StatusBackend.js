/**
 * statusbar/StatusBackend.js — 状态栏后端选择与门控动作（从 StatusBar.js 拆出，B1 #460，纯结构、行为零变化）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
 * 以后谁改它：改状态栏后端选择（gate 蓝条选后端：打开关闭确认绑定）与初始化那张小卡（域文档布局）的人改它。
 * #655 起本文件还管初始化那张小卡上的那组单选（域文档布局）与「没选过布局就先弹卡、不注入」这条漏斗。
 * #663 起：门控那个窗只问后端（里面那组布局单选撤了，点确认也不再注入任何文字）；横幅那条链搬去
 *   statusbar/bannerChain.js（出哪一条、按钮点下去干什么），本文件只留下它要调的那几个动作。
 * #669 第 4 件起：那张小卡也只问布局 —— 卡上原来那组后端单选（连带拉清单的 ensureStatusSetupPick 与
 *   它的开启入口 openStatusSetupPick）一并退役：到这一步后端早在门控那一步定完，卡上那颗确认不再写选择、
 *   也不再打 wf.bind（换后端仍走右侧面板那颗「切换后端」）。
 * 接线：StatusBar.js 留四个转调包装（cancel/confirmSetupPick、close/confirmGateStatus）供渲染直调；
 *   本文件不引用 StatusMenus.js（同闭包拼回，调用方向见 StatusBar.js 转调四处）。
 */
// #655：域文档布局的两个取值（与 locale 里两句注入文案、卡片上两个选项一一对应）。
//   2026-09-21 维护者拍板改成「A + 记住」：这份答案按工作区记住（写进本地缓存，见 store-prefs.js 的
//   getCachedSetupLayout / setCachedSetupLayout），同一个工作区下次打开直接沿用；想改随时在黄条那颗
//   「初始化」按钮弹出的那张卡上改 —— 那条入口每次都问（卡上预选着上次那一项），确认后才注入。
export const SETUP_LAYOUT_VALUES = ['single', 'multi']
export const SETUP_LAYOUT_FALLBACK = 'single'
export const readStatusSetupLayout = function(s){
  try{ const v=String((s&&s.setupLayout)||'').toLowerCase(); if(SETUP_LAYOUT_VALUES.indexOf(v)>=0) return v }catch(e){}
  try{ if(typeof getCachedSetupLayout==='function'){ const c=getCachedSetupLayout(s&&s.cwd); if(c) return c } }catch(e){}
  return null
}
// 卡片上这一组单选默认选中哪一项：**卡片开着时以用户在卡上刚点的那一下为准**（否则点了另一个选项会立刻被按回去 ——
//   2026-09-25 真机上报的「另一个选项点不动」就是这个顺序错），卡片没开时按「会话里答过的 > 这个工作区记住的 >
//   卡上上次碰过的」给值，都没有再回到第一项「根目录一份 CONTEXT.md」。
export const layoutSelectionOf = function(s){
  const inCard=function(){ try{ const v=String((s&&s.setupPickLayout)||'').toLowerCase(); return SETUP_LAYOUT_VALUES.indexOf(v)>=0?v:null }catch(e){ return null } }
  try{ if(s&&s.setupLayoutCardOpen===true){ const p=inCard(); if(p) return p } }catch(e){}
  const picked=readStatusSetupLayout(s); if(picked) return picked
  const rest=inCard(); if(rest) return rest
  return SETUP_LAYOUT_FALLBACK
}
// 把布局记进会话状态**并按工作区记住**：注入决策函数就是从这里读「这个仓库的布局选没选过」的，所以只在这里写。
export const applyStatusSetupLayout = function(s, v){
  const t=String(v==null?'':v).toLowerCase()
  if(SETUP_LAYOUT_VALUES.indexOf(t)<0) return
  try{ s.setupLayout=t }catch(e){}
  try{ if(typeof setCachedSetupLayout==='function') setCachedSetupLayout(s&&s.cwd, t) }catch(e2){}
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
export const closeStatusSetupPick = function(s){s.setupLayoutCardOpen=false;emit(s)}
// 取消：卡上刚点的那一下一并作废（记住的那一份不动），下次再点黄条仍按「现在这个答案」预选。
export const cancelStatusSetupPick = function(s){ try{ delete s.setupPickLayout }catch(e){} closeStatusSetupPick(s) }
export const confirmStatusSetupPick = function(s){
  // #669 第 4 件：这张卡只有「域文档布局」这一问 —— 后端到这一步已经定完了（门控那一步定的）。
  //   所以这里不再写 selection、不再打 wf.bind：换后端是门控那个窗与右侧面板「切换后端」的事，
  //   不该从一张只问布局的卡上顺手做掉。注入用的后端取会话当下那一个。
  applyStatusSetupLayout(s, layoutSelectionOf(s))
  // #683（F1 · ADR 的 R6）：卡上确认写的是「卡上当时显示的那一个」—— 同时写 H（宿主侧，跨重启跨地址不失忆）与 C（本地，applyStatusSetupLayout 刚写过）。宿主写不进去也不挡注入（下次打开卡片重选一次即可；宿主侧那次失败宿主自己记了 warn）。
  try{ if(typeof host!=='undefined'&&host.call) host.call('wf.setupLayout',{cwd:s.cwd||'',layout:layoutSelectionOf(s)}).catch(function(){}) }catch(eSL){}
  try{ delete s.setupPickLayout }catch(e0){} // 卡上那一下已经落定（会话 + 按工作区记住），这份草稿清掉，免得下次打开时它还压着
  const id = (s.selection && s.selection.backendId != null) ? s.selection.backendId : firstBackendIdOf(null)
  closeStatusSetupPick(s)
  // #664：这张小卡的确认就是「布局答完了」那一步，接着把初始化全文注进去（注入决策现在先判仓库那一步过没过：
  //   没过就一个字都不注入，也不会走到这里 —— 那种情形下卡根本不会开）。
  try{ injectSetupDecision(s,id,{allowCard:true}) }catch(e){}
}
// #655：黄条那颗「初始化」按钮也走同一个注入决策函数 —— 它自己判「弹卡还是注入」，这里不判
//   （否则就是规格里说的「绕过小卡直接注入」）。allowCard:true 是因为这张卡就渲染在黄条下面，弹得出来。
//   2026-09-21 维护者拍板（A）：这一颗**每次都先弹卡**（askLayout:true）—— 布局答过也照旧问一遍，
//   卡上预选着上次那一项，看得见、随时能改；答完点确认才注入。检查页那颗按钮与切换后端那条路不传它。
// #663 起把那个决定的结果原样回给调用处（'setup' 注入了全文 / 'setup-card' 只开了小卡 / 其余没注成）：
//   状态栏横幅那颗按钮要用它落一行「这次给出去的是哪一类」的常驻日志，不然日志里又是一笔空。
export const onStatusSetupInit = function(s){
  const id = (s.selection && s.selection.backendId != null) ? s.selection.backendId : firstBackendIdOf(null);
  try{ return injectSetupDecision(s,id,{allowCard:true, askLayout:true}) }catch(e){ return '' }
}
export const openStatusGate = function(s){
  s.gateModalOpen=true;s.gateModalSource='status';if(!s.gateSelected)s.gateSelected=firstBackendIdOf(null);s.gateError='';emit(s);
  if(typeof host!=='undefined'&&host.call){s.gateLoading=true;emit(s);host.call('wf.registry',{cwd:s.cwd||''}).then(function(r){s.gateLoading=false;let m=null;if(r&&r.ok&&Array.isArray(r.modules))m=r.modules;else if(r&&Array.isArray(r.modules))m=r.modules;else if(r&&r.value&&Array.isArray(r.value.modules))m=r.value.modules;if(Array.isArray(m)&&m.length){const f=m.filter(function(x){return String(x.id).toLowerCase()!=='other'});const fin=f.length?f:m;if(fin.length){s.backendModules=m;try{if(typeof setPresentationMap==='function')setPresentationMap(m)}catch(e){}const ids=fin.map(function(x){return x.id});if(!s.gateSelected||ids.indexOf(s.gateSelected)<0)s.gateSelected=fin[0].id}}emit(s)}).catch(function(){s.gateLoading=false;emit(s)});}
}
export const closeStatusGate = function(s){ s.gateModalOpen=false; s.gateModalSource=null; s.gateError=''; emit(s); };
export const confirmStatusGate = function(s){ const id=s.gateSelected||firstBackendIdOf(null); if(String(id).toLowerCase()==='other'){ s.gateError=tr('switch.gateOtherErr'); emit(s); return; }
  // #669 第 6 件（ADR 20260921）：能力不全的后端（今天只有 GitLab）不许从门控窗绑上 —— 单选框已置灰，
  //   这里再挡一道（键盘/别的路径也走不到）；判据问 isBackendUnavailable 一份，不另抄名单。
  if(typeof isBackendUnavailable==='function'&&isBackendUnavailable(id)){ s.gateError=tr('switch.targetLockedTip'); emit(s); return }
  // #663：这个窗现在只问后端 —— 点确认只把后端定下来，不往会话里注入任何文字。
  //   此前这里顺手记了「域文档布局」并在绑好后调一次注入决策；两处一起撤（#661 第①条）：
  //   只撤单选而留注入，会在库房还没装 gh、还没建仓库的时候就把初始化长文塞进会话 ——
  //   正是这次定版要结束的那件事。布局那一问现在只在初始化那一步问（黄条那颗按钮弹的小卡）。
  const prev=s.selection; const repoRef=s.repository||(s.snapshot&&s.snapshot.repository)||null; const nxt=(typeof userPickSelection==='function')?userPickSelection(id,repoRef,prev):{backendId:id,source:'explicit',ref:repoRef,userPicked:true}; s.selection=nxt; try{ if(s.cwd)setCachedSelection(s.cwd,nxt) }catch(e){} s.gateModalOpen=false; s.gateModalSource=null; emit(s); if(typeof host!=='undefined'&&host.call){ host.call('wf.bind',{cwd:s.cwd||'',backendId:id}).then(function(res){ const ok=res&&(res.ok===true||(res.value&&res.value.ok===true)||res.ok); if(ok){ try{ if(typeof adoptBoundRev==='function') adoptBoundRev(s,res) }catch(eRev){} try{ var _np=res&&(res.persisted===false||(res.value&&res.value.persisted===false)); if(_np) flash(s,tr('switch.bindFail',{err:'已切换，但宿主侧这次没能记住：下次重启或换个地址打开可能要再选一次'}),'warn') }catch(eP){} s.tab='list'; emit(s); try{ flash(s,tr('switch.bindOkFresh',{label:(typeof labelOf==='function'?labelOf(id):String(id))}),'ok') }catch(e){} loadSnapshot(s,true,true); // #669 第 6 件：这个窗只在「还没有后端」时开，谈不上「旧数据已保留」——用「接下来按提示完成初始化」那句（旧数据那句留给切换弹窗）
    // 2026-09-21（用户报「选完后端看不见下一步，过一会儿才出来」）：绑定成功之后要**立刻重取一次链**。
    //   原来这条路只重取快照、不重取链，于是那条横幅得等「上一轮链探测结束时挂上的 8 秒定时器」到点才更新
    //   （实测：点确认 → 横幅出现 11.4 秒，其中 8.16 秒纯等定时器）。同仓另外两条路本来就是
    //   `loadSnapshot + loadChain` 一对（`kernel/store-switch.js` 切后端那条、`views/NoRepoCard.js` 建完仓库那条），
    //   只有蓝条这条门控路少了后半句。
    try{ if(typeof loadChain==='function') loadChain(s,true) }catch(eLc){}
    } else { s.selection=prev; try{ if(s.cwd)setCachedSelection(s.cwd,prev) }catch(e){} emit(s); try{ flash(s,tr('switch.bindFail',{err:String(res&&(res.error||res.message)||'unknown')}),'warn') }catch(e){} } }).catch(function(){ s.selection=prev; try{ if(s.cwd)setCachedSelection(s.cwd,prev) }catch(e){} emit(s); }); } };
