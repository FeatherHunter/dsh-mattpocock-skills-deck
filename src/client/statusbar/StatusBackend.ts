/**
 * statusbar/StatusBackend.ts — 状态栏后端选择与门控动作（从 StatusBar.js 拆出，B1 #460，纯结构、行为零变化；
 * #1209 由同名 .js 转成 TypeScript，真源从此是这一份）
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回
 * src/client/index.ts 的 leaf 标记处（源码树里只有这一份真源，标记 id 与本文件名一致）。
 * 以后谁改它：改状态栏后端选择（gate 蓝条选后端：打开关闭确认绑定）与初始化那张小卡（域文档布局）的人改它。
 * #655 起本文件还管初始化那张小卡上的那组单选（域文档布局）与「没选过布局就先弹卡、不注入」这条漏斗。
 * #663 起：门控那个窗只问后端（里面那组布局单选撤了，点确认也不再注入任何文字）；横幅那条链搬去
 *   statusbar/bannerChain.js（出哪一条、按钮点下去干什么），本文件只留下它要调的那几个动作。
 * #669 第 4 件起：那张小卡也只问布局 —— 卡上原来那组后端单选（连带拉清单的 ensureStatusSetupPick 与
 *   它的开启入口 openStatusSetupPick）一并退役：到这一步后端早在门控那一步定完，卡上那颗确认不再写选择、
 *   也不再打 wf.bind（换后端仍走右侧面板那颗「切换后端」）。
 * #698 起：卡答完之后怎么收尾也归本文件 —— 同一个确认函数要按「这张卡是谁开的」分两条路。
 *   黄条 / 检查页开的：照旧注入初始化全文（问一次、答一次），这就是今天的行为；
 *   切换后端那条路开的（session 状态里 setupCardOwner === 'switch'）：先**重新判一次**这个工作区
 *   现在初始化了没有，再决定注初始化全文还是注「把后端 / 布局对齐」那两条 —— 开卡到点确认之间，
 *   刚注入的那条对齐指令可能已经把仓库初始化完了，照旧结论会把初始化全文注进一个已经初始化过的仓库。
 * 接线：#698 起这张卡的界面渲染在弹窗座位那一层（slotRenderer-modal-view.js 的 SetupLayoutCard），
 *   它直接调用本文件的 cancelStatusSetupPick / confirmStatusSetupPick；StatusBar.js 里的
 *   close/confirmGateStatus 两个转调包装留给门控那个窗。
 *   本文件不引用 StatusMenus.js（同闭包拼回，调用方向见 StatusBar.js 转调两处）。
 *
 * 类型怎么标的（#1209 转 TypeScript 时补，讲清边界在哪，后人别把这几条当随手写的）
 *   本文件是「拼进闭包的一段」，不是一个能被 import 的模块：它调用的 emit、tr、
 *   host 这些名字都由闭包提供，本文件不定义它们。所以下面用一层 declare 把「外面有什么、长什么样」
 *   写下来 —— 这是仓库既定的做法（同目录先例见 kernel/link.ts 与 kernel/settings-debug.ts 开头）。
 *   declare 只活在类型检查里，esbuild 转译时会整条删掉，拼进闭包的产物与转换前逐字一致。
 *   状态对象（s）不在这里立一份字段齐全的接口：它由闭包各处共用、字段随用随加，在这里立一份必然与别处
 *   慢慢走岔，而 s 的每个属性访问本来就包在 try 里（读不到就当没有）。所以 s 标成 StatusPickState ——
 *   一份**只用得到本文件真正读过的那几个字段**的结构描述，其余一概不声称。
 */
// #655：域文档布局的两个取值（与 locale 里两句注入文案、卡片上两个选项一一对应）。
//   2026-09-21 维护者拍板改成「A + 记住」：这份答案随工作区文件跨会话沿用（#1449 起唯一真源是工作区文件，
//   宿主写进去、快照读回来；浏览器按工作区存的那份表已经删了）；想改随时在黄条那颗「初始化」按钮弹出的
//   那张卡上改 —— 那条入口每次都问（卡上预选着上次那一项），确认后才注入。
//
//   2026-10-21（#1342）取值名单收到唯一真源 src/shared/doc-layout/src/layouts.ts，本文件不再自己写一份字面量：
//   构建把它拼进界面闭包（见 scripts/build.mts 的 shared:docLayout 与 src/client/index.ts 的 marker），
//   下面按 declare 取用（见本文件末尾那一段 declare）。
//
//   类型为什么是这两个字面量的联合而不是 string[]：下面每一处校验（readStatusSetupLayout、layoutSelectionOf、
//   applyStatusSetupLayout、cancelStatusSetupPick）判的都是「这个值在不在名单里」，名单一旦写成宽的
//   string[]，那些判断就退化成「是不是字符串」而看不出意图；写成联合类型之后，把 'singel' 这种错字递进来
//   在类型检查那一关就被挡住。卡片与注入文案两边都按这两个值分支，第三档取值进来是 bug，不是新选项。
export const SETUP_LAYOUT_VALUES: readonly SetupLayoutValue[] = DOC_LAYOUT_VALUES
// 什么都没有时的兜底值：#669 定的「第一项默认选中，不额外问一句」。
export const SETUP_LAYOUT_FALLBACK: SetupLayoutValue = 'single'
export const readStatusSetupLayout = function(s: StatusPickState | null | undefined): SetupLayoutValue | string | null {
  try{ const v=String((s&&s.setupLayout)||'').toLowerCase(); if(SETUP_LAYOUT_VALUES.indexOf(v as SetupLayoutValue)>=0) return v }catch(e){}
  // #1449：会话里没答过就读快照从工作区文件读回来的那一份（不再是浏览器按工作区存的表）。
  try{ const raw:any=s&&(s as any).snapshot&&(s as any).snapshot.setupLayout; const v=String(raw&&typeof raw==='object'?raw.layout:raw||'').toLowerCase(); if(SETUP_LAYOUT_VALUES.indexOf(v as SetupLayoutValue)>=0) return v }catch(e){}
  return null
}
// 卡片上这一组单选默认选中哪一项：**卡片开着时以用户在卡上刚点的那一下为准**（否则点了另一个选项会立刻被按回去 ——
//   2026-09-25 真机上报的「另一个选项点不动」就是这个顺序错），卡片没开时按「会话里答过的 > 快照从工作区文件
//   读回来的 > 卡上上次碰过的」给值，都没有再回到第一项「根目录一份 GLOSSARY.md」。
export const layoutSelectionOf = function(s: StatusPickState | null | undefined): SetupLayoutValue | string {
  const inCard=function(): SetupLayoutValue | null { try{ const v=String((s&&s.setupPickLayout)||'').toLowerCase(); return SETUP_LAYOUT_VALUES.indexOf(v as SetupLayoutValue)>=0?(v as SetupLayoutValue):null }catch(e){ return null } }
  try{ if(s&&s.setupLayoutCardOpen===true){ const p=inCard(); if(p) return p } }catch(e){}
  const picked=readStatusSetupLayout(s); if(picked) return picked
  const rest=inCard(); if(rest) return rest
  return SETUP_LAYOUT_FALLBACK
}
// 把布局记进会话状态：注入决策函数就是从这里读「这个仓库的布局选没选过」的，所以只在这里写。
//   #1449 起浏览器按工作区存的那份表已经删了：答案由宿主写进工作区文件，随快照回包再回到会话里。
export const applyStatusSetupLayout = function(s: StatusPickState, v: unknown): void {
  const t=String(v==null?'':v).toLowerCase()
  if(SETUP_LAYOUT_VALUES.indexOf(t as SetupLayoutValue)<0) return
  try{ s.setupLayout=t }catch(e){}
}
// 卡片与门控弹窗共用的一组单选（域文档布局）：返回一组 label，供 StatusBar.js 的两处渲染直接放进去。
export const layoutRadios = function(s: StatusPickState, h: HFactory): unknown {
  const sel=layoutSelectionOf(s)
  const one=function(v: SetupLayoutValue, key: string){
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
export const closeStatusSetupPick = function(s: StatusPickState): void {s.setupLayoutCardOpen=false;emit(s)}
// #698：开卡那一刻把「现在这个答案是哪个」记一份草稿，给取消那条路回退用。
//   为什么要有它：卡上那两个单选一点下去就经 applyStatusSetupLayout 把答案写进会话（那是「点一下就生效」的
//   老设计，黄条那条路一直如此）。所以「取消」不能只是把界面关掉 —— 那样用户点过的
//   那一下已经生效了，与卡上「取消」两个字说的不是一回事（本票对抗式自查时从这条断言里量出来的）。
export const snapshotSetupLayoutForCard = function(s: StatusPickState): void {
  try{ s.setupLayoutDraftBefore = readStatusSetupLayout(s) }catch(e){}
}
// 取消：卡上刚点的那一下作废 —— 把答案退回开卡前那一份；开关本身照旧关掉。
export const cancelStatusSetupPick = function(s: StatusPickState): void {
  const wasSwitch=cardOwnedBySwitch(s)
  try{
    const hasDraft=Object.prototype.hasOwnProperty.call(s,'setupLayoutDraftBefore')
    if(hasDraft){
      const before=s.setupLayoutDraftBefore
      if(SETUP_LAYOUT_VALUES.indexOf(String(before||'').toLowerCase() as SetupLayoutValue)>=0) applyStatusSetupLayout(s,before)
      delete s.setupLayoutDraftBefore
    }
  }catch(eRoll){}
  try{ delete s.setupPickLayout }catch(e){}
  closeStatusSetupPick(s)
  // #698：切换那条路上，点取消也要把「把后端对齐」那条指令照旧给出去 —— 用户取消的是「改布局」这一问，
  //   不是「换了后端、把记录对齐过去」这件事；多问一句就把本来该给的东西扣下，是这次要结束的老毛病。
  if(wasSwitch) settleSwitchCard(s, 'cancel')
}
// #698：这张卡是「切换后端」那条路弹出来的吗（黄条 / 检查页那两条路不走切换这套收尾）。
export const cardOwnedBySwitch = function(s: StatusPickState | null | undefined): boolean { try{ return !!(s && s.setupCardOwner === 'switch') }catch(e){ return false } }
// 把两个布局取值翻成人话（卡上那两句词条），用来写「从 X 改成 Y」那条对齐指令。
//   取值不认识（或词条查不到）时落回「根目录一份 GLOSSARY.md」那一句 —— 宁可话说得保守一点，也不留空占位符。
//   参数收 unknown 而不是 SetupLayoutValue：调用处递进来的是会话里存着的原始值（可能压根不是这两个之一），
//   这一层正是把它挡回默认项的地方，类型不该假设它一定合法。
const layoutWordOf=function(v: unknown): string {
  try{
    const t=String(v==null?'':v).toLowerCase()
    return tr(t==='multi' ? 'setup.layoutMulti' : 'setup.layoutSingle')
  }catch(e){ return '' }
}
// #698 第四步：点确认那一刻**重新判一次场景**，不用开卡那一刻的旧结论。
//   为什么必须重判：切换这条路上，从「点确认切换」到「用户答完布局」之间，刚刚注入的那条对齐指令
//   可能已经把仓库初始化完了（AI 正在改文件、正在建产物）—— 开卡时判的是「还没初始化」，
//   点确认时现实已经是「已初始化」，照旧结论就会把初始化全文注进一个已经初始化过的仓库，等于让 AI 重跑一遍初始化。
//   （#664 与 ADR 20260921 第 4 节攻击 10 要结束的正是这件事。）
// 返回 'initialized' | 'fresh' | 'unknown'；unknown = 链快照里根本没有「工作区已初始化」这一步
//   （还没取到链、或取链失败）—— 那时一个字都不注入，只把下一步指向状态栏（与 store-switch 同口径）。
export const worktreeInitializedState = function(s: StatusPickState | null | undefined): WorktreeState {
  try{
    const steps=(typeof chainSteps==='function')?chainSteps(s):((s&&s.chainSnapshot&&Array.isArray(s.chainSnapshot.steps))?s.chainSnapshot.steps:[])
    const has=function(id: string){ return (Array.isArray(steps)?steps:[]).some(function(x: ChainStep | null | undefined){ return x && String(x.id)===String(id) }) }
    if(!has('tracker:initialized')) return 'unknown'
    if(typeof guideStepsFor!=='function'||typeof guideStepDone!=='function') return 'unknown'
    const bid=(s&&s.selection&&s.selection.backendId!=null)?s.selection.backendId:firstBackendIdOf(null)
    const mine=guideStepsFor(bid)||[]
    const step=mine.filter(function(x: ChainStep | null | undefined){ return x && x.id==='tracker:initialized' })[0]
    if(!step) return 'unknown'
    return guideStepDone(step,steps)?'initialized':'fresh'
  }catch(e){ return 'unknown' }
}
// #698：切换那条路上，卡答完之后该往会话里给什么。phase='confirm'（点了确认）/ 'cancel'（点了取消）。
//   点确认：已初始化 → 把后端对齐（若这次还没给过）+ 布局真的改了才多给一条布局对齐；
//          还没初始化 → 注入初始化全文（与黄条那条路同一份文本）；链里没这一步 → 什么都不注入，只提示看状态栏。
//   点取消：已初始化 → 后端对齐照旧给（不给布局对齐）；还没初始化 → 一个字都不注入（与今天一致）。
// 返回 SettlePhase，调用处（bannerChain / StatusBar）按它落日志：哪一步给出去的是哪一类，日志里必须分得开。
export const settleSwitchCard = function(s: StatusPickState, phase: 'confirm' | 'cancel'): SettlePhase {
  const label=function(id: unknown){ try{ return (typeof labelOf==='function'?labelOf(id):String(id)) }catch(e){ return String(id||'') } }
  const fromLabel=label(s&&s.switchCardFrom), toLabel=label(s&&s.switchCardTo)
  const target=(s&&s.switchCardTo!=null)?s.switchCardTo:((s&&s.selection&&s.selection.backendId!=null)?s.selection.backendId:firstBackendIdOf(null))
  const state=worktreeInitializedState(s)
  if(state==='fresh'){
    if(phase!=='confirm'){ return 'none' }
    // 还没初始化：走与黄条那颗按钮**同一个**决策器（仓库那一步过没过这条判据住在它里面；
    //   没过它返回 blocked，那时一个字都不注入）。
    let kind=''
    try{ kind=injectSetupDecision(s,target,{allowCard:false}) }catch(e){ kind='' }
    return kind==='setup'?'setup':'blocked'
  }
  if(state==='unknown'){
    try{ flash(s,tr('switch.bindOkNotReady',{label:toLabel}),'warn') }catch(e){}
    return 'blocked'
  }
  // 已初始化：先给「把后端对齐」那条（确认与取消都一样 —— 这件事与布局那一问无关）。
  if(s&&s.switchAlignDone!==true){
    try{ const t=switchAlignPrompt(s,(s&&s.switchCardTo!=null)?s.switchCardTo:((s&&s.selection&&s.selection.backendId!=null)?s.selection.backendId:null),fromLabel,toLabel,(s&&s.setupLayout!=null)?s.setupLayout:null); if(t&&typeof inject==='function') inject(s,t) }catch(eInj){}
    try{ if(s) s.switchAlignDone=true }catch(eF){}
    // 轨迹：#698 起这一条与「只开了卡」在日志里必须分得开（见 kernel/prompts-setup.js 的 logSwitchSettle；
    //   记在那边而不是这里，是因为 statusbar/ 目录里不许新开日志点 —— 纪律见 tests/verify-log-truncate.js）。
    try{ if(typeof logSwitchSettle==='function') logSwitchSettle('align',s) }catch(eL){}
  }
  // 布局真的被改了，才**多**给一条「把布局那一句也对齐过去」（没改就只留上面那一条，别多问一句就多发一段）。
  let changedLayout=false
  try{ changedLayout=!!(s&&s.switchCardLayoutFrom&&s.setupLayout&&s.switchCardLayoutFrom!==s.setupLayout) }catch(eC){}
  if(changedLayout){
    try{ const t=(typeof promptText==='function')?promptText('switchLayout',{from:layoutWordOf(s.switchCardLayoutFrom),to:layoutWordOf(s.setupLayout)}):''; if(t&&typeof inject==='function') inject(s,t) }catch(eInj2){}
    try{ if(typeof logSwitchSettle==='function') logSwitchSettle('align-layout',s) }catch(eL2){}
    return 'align-layout'
  }
  return 'align'
}
export const confirmStatusSetupPick = function(s: StatusPickState): void {
  // #669 第 4 件：这张卡只有「域文档布局」这一问 —— 后端到这一步已经定完了（门控那一步定的）。
  //   所以这里不再写 selection、不再打 wf.bind：换后端是门控那个窗与右侧面板「切换后端」的事，
  //   不该从一张只问布局的卡上顺手做掉。注入用的后端取会话当下那一个。
  const ownerSwitch=cardOwnedBySwitch(s)
  applyStatusSetupLayout(s, layoutSelectionOf(s))
  // #683（F1 · ADR 的 R6）：卡上确认写的是「卡上当时显示的那一个」—— 同时写 H（宿主侧，跨重启跨地址不失忆）与 C（本地，applyStatusSetupLayout 刚写过）。宿主写不进去也不挡注入（下次打开卡片重选一次即可；宿主侧那次失败宿主自己记了 warn）。
  try{ if(typeof host!=='undefined'&&host.call) host.call('wf.setupLayout',{cwd:s.cwd||'',layout:layoutSelectionOf(s),sessionId:s.sessionId||''}).catch(function(){}) }catch(eSL){}
  try{ delete s.setupPickLayout }catch(e0){} // 卡上那一下已经落定（会话 + 按工作区记住），这份草稿清掉，免得下次打开时它还压着
  try{ delete s.setupLayoutDraftBefore }catch(e1){} // 确认了就没有「退回开卡前那一份」这回事了（那份是给取消用的）
  const id = (s.selection && s.selection.backendId != null) ? s.selection.backendId : firstBackendIdOf(null)
  closeStatusSetupPick(s)
  // #698：切换那条路自己收尾（它会先重判「这个工作区现在初始化了没有」，再决定注全文还是注对齐）；
  //   黄条 / 检查页那两条路照旧 —— 这张小卡的确认就是「布局答完了」那一步，接着把初始化全文注进去
  //   （注入决策现在先判仓库那一步过没过：没过就一个字都不注入，也不会走到这里 —— 那种情形下卡根本不会开）。
  if(ownerSwitch){ settleSwitchCard(s,'confirm'); return }
  try{ injectSetupDecision(s,id,{allowCard:true}) }catch(e){}
}
// #655：黄条那颗「初始化」按钮也走同一个注入决策函数 —— 它自己判「弹卡还是注入」，这里不判
//   （否则就是规格里说的「绕过小卡直接注入」）。allowCard:true 是因为这张卡弹得出来（#698 起它有自己的位置）。
//   2026-09-21 维护者拍板（A）：这一颗**每次都先弹卡**（askLayout:true）—— 布局答过也照旧问一遍，
//   卡上预选着上次那一项，看得见、随时能改；答完点确认才注入。检查页那颗按钮不传它。
//   2026-09-22 维护者拍板：#698 起「切换后端」那条路也传它（同样是每次都问），两条路共用同一份判据。
// #663 起把那个决定的结果原样回给调用处（'setup' 注入了全文 / 'setup-card' 只开了小卡 / 其余没注成）：
//   状态栏横幅那颗按钮要用它落一行「这次给出去的是哪一类」的常驻日志，不然日志里又是一笔空。
//   返回值与 injectSetupDecision 的返回同域，但那一份由闭包提供、本文件不替它立契约，故这里收成 string。
export const onStatusSetupInit = function(s: StatusPickState): string {
  const id = (s.selection && s.selection.backendId != null) ? s.selection.backendId : firstBackendIdOf(null);
  try{ return injectSetupDecision(s,id,{allowCard:true, askLayout:true}) }catch(e){ return '' }
}
export const openStatusGate = function(s: StatusPickState): void {
  s.gateModalOpen=true;s.gateModalSource='status';if(!s.gateSelected)s.gateSelected=firstBackendIdOf(null);s.gateError='';emit(s);
  if(typeof host!=='undefined'&&host.call){s.gateLoading=true;emit(s);host.call('wf.registry',{cwd:s.cwd||''}).then(function(r: BackendRegistryReply | null | undefined){s.gateLoading=false;let m: BackendModule[] | null=null;if(r&&r.ok&&Array.isArray(r.modules))m=r.modules;else if(r&&Array.isArray(r.modules))m=r.modules;else if(r&&r.value&&Array.isArray(r.value.modules))m=r.value.modules;if(Array.isArray(m)&&m.length){const f=m.filter(function(x){return String(x.id).toLowerCase()!=='other'});const fin=f.length?f:m;if(fin.length){s.backendModules=m;try{if(typeof setPresentationMap==='function')setPresentationMap(m)}catch(e){}const ids=fin.map(function(x){return x.id});if(!s.gateSelected||ids.indexOf(s.gateSelected)<0)s.gateSelected=fin[0].id}}emit(s)}).catch(function(){s.gateLoading=false;emit(s)});}
}
export const closeStatusGate = function(s: StatusPickState): void { s.gateModalOpen=false; s.gateModalSource=null; s.gateError=''; emit(s); };
export const confirmStatusGate = function(s: StatusPickState): void { const id=s.gateSelected||firstBackendIdOf(null); if(String(id).toLowerCase()==='other'){ s.gateError=tr('switch.gateOtherErr'); emit(s); return; }
  // #1600：三后端全可选，门控确认不再拦（名单已清空）。
  // #663：这个窗现在只问后端 —— 点确认只把后端定下来，不往会话里注入任何文字。
  //   此前这里顺手记了「域文档布局」并在绑好后调一次注入决策；两处一起撤（#661 第①条）：
  //   只撤单选而留注入，会在库房还没装 gh、还没建仓库的时候就把初始化长文塞进会话 ——
  //   正是这次定版要结束的那件事。布局那一问现在只在初始化那一步问（黄条那颗按钮弹的小卡）。
  const prev: StatusPickState['selection']=s.selection; const repoRef=s.repository||(s.snapshot&&s.snapshot.repository)||null; const nxt: StatusPickState['selection']=(typeof userPickSelection==='function')?userPickSelection(id,repoRef,prev):{backendId:id,source:'explicit',ref:repoRef,userPicked:true}; s.selection=nxt; try{ if(s.cwd)setCachedSelection(s.cwd,nxt) }catch(e){} s.gateModalOpen=false; s.gateModalSource=null; emit(s); if(typeof host!=='undefined'&&host.call){ host.call('wf.bind',{cwd:s.cwd||'',backendId:id,sessionId:s.sessionId||''}).then(function(res: BindReply | null | undefined){ const ok=res&&(res.ok===true||(res.value&&res.value.ok===true)||res.ok); if(ok){ try{ if(typeof adoptBoundRev==='function') adoptBoundRev(s,res) }catch(eRev){} try{ var _np=res&&(res.persisted===false||(res.value&&res.value.persisted===false)); if(_np) flash(s,tr('switch.bindNotPersisted'),'info') }catch(eP){} s.tab='list'; emit(s); try{ flash(s,tr('switch.bindOkFresh',{label:(typeof labelOf==='function'?labelOf(id):String(id))}),'ok') }catch(e){} loadSnapshot(s,true,true); // #669 第 6 件：这个窗只在「还没有后端」时开，谈不上「旧数据已保留」——用「接下来按提示完成初始化」那句（旧数据那句留给切换弹窗）
    // 2026-09-21（用户报「选完后端看不见下一步，过一会儿才出来」）：绑定成功之后要**立刻重取一次链**。
    //   原来这条路只重取快照、不重取链，于是那条横幅得等「上一轮链探测结束时挂上的 8 秒定时器」到点才更新
    //   （实测：点确认 → 横幅出现 11.4 秒，其中 8.16 秒纯等定时器）。同仓另外两条路本来就是
    //   `loadSnapshot + loadChain` 一对（`kernel/store-switch.js` 切后端那条、`views/NoRepoCard.js` 建完仓库那条），
    //   只有蓝条这条门控路少了后半句。
    // #1363 场景一：只「重取」不够，这一次还得被宿主当成人的动作（trigger 'user-recheck'）——
    //   否则它会落进后台退避档，被挡下时宿主原样回一份选后端之前的旧快照（里面连仓库那一行都没有），
    //   横幅链于是继续什么都不显示。选后端是用户亲手做的，修法就是把这一次的意图如实带上去。
    try{ if(typeof loadChain==='function') loadChain(s,true,'user-recheck') }catch(eLc){}
    } else { s.selection=prev; try{ if(s.cwd)setCachedSelection(s.cwd,prev) }catch(e){} emit(s); try{ flash(s,tr('switch.bindFail',{err:String(res&&(res.error||res.message)||'unknown')}),'warn') }catch(e){} } }).catch(function(){ s.selection=prev; try{ if(s.cwd)setCachedSelection(s.cwd,prev) }catch(e){} emit(s); }); } };

// ---------------------------------------------------------------------------
// 本片段用到、但由闭包提供的名字（#1209 加）。
// 只声明**本文件真的调用/读取过**的那些：这里不是把闭包的家底抄一遍，而是「这一片与外界的那条边界」。
// 参数一律 any：这些名字的实现住在别处（同一次构建拼进来的别的片段里），在这里替它们立契约等于在
// 第二处写一遍签名，两边会慢慢走岔；本文件的类型价值在于它自己的导出面与状态字段，不在于替邻居立契约。
// ---------------------------------------------------------------------------
// #1342：域文档布局取值的名单不是本文件写的，由共享真源 src/shared/doc-layout/src/layouts.ts 拼进闭包
// （见 scripts/build.mts 的 shared:docLayout）。客户端这一侧的字面量只写这一处：下面的 SetupLayoutValue 从它推出，
// kernel/prompts.ts 也从这里 type-only import，不再各写一份联合。
declare const DOC_LAYOUT_VALUES: readonly ('single' | 'multi')[]
declare function emit(s: unknown): void
declare function tr(key: string, params?: Record<string, unknown>): string
declare function h(tag: string, props?: Record<string, unknown> | null, children?: unknown): unknown
declare function flash(s: unknown, text: unknown, tone?: string): void
declare function inject(s: unknown, text: unknown): void
declare function injectSetupDecision(s: unknown, backendId: unknown, opts: { allowCard?: boolean; askLayout?: boolean }): string
declare function switchAlignPrompt(s: unknown, target: unknown, fromLabel: unknown, toLabel: unknown, layout: unknown): string
declare function promptText(id: string, params?: Record<string, unknown>): string
declare function logSwitchSettle(phase: string, s: unknown): void
declare function chainSteps(s: unknown): ChainStep[]
declare function guideStepsFor(backendId: unknown): ChainStep[] | null
declare function guideStepDone(step: unknown, steps: unknown): boolean
declare function firstBackendIdOf(s: unknown): string | null
declare function isBackendUnavailable(backendId: unknown): boolean
declare function userPickSelection(backendId: unknown, repoRef: unknown, prev: unknown): StatusPickState['selection']
declare function setCachedSelection(cwd: unknown, selection: unknown): void
declare function adoptBoundRev(s: unknown, res: unknown): void
declare function loadSnapshot(s: unknown, force?: boolean, soft?: boolean): void
declare function loadChain(s: unknown, force?: boolean, trigger?: string): void
declare function setPresentationMap(modules: unknown): void
declare function labelOf(backendId: unknown): string
declare const host: { call(method: string, params?: Record<string, unknown>): Promise<any> }

// ---------------------------------------------------------------------------
// 本文件自己用到的几个类型（#1209 加，写给读代码的人看的那部分在这里，不在上面那一堆 declare 里）
// ---------------------------------------------------------------------------

/** 域文档布局的两个合法取值，由上面声明的 DOC_LAYOUT_VALUES 推出；与 locale 里两句注入文案、卡片上两个选项一一对应。 */
export type SetupLayoutValue = (typeof DOC_LAYOUT_VALUES)[number]

/** 这一趟收尾给出去的是哪一类（settleSwitchCard 的返回值；调用处按它落日志）。 */
type SettlePhase = 'none' | 'setup' | 'blocked' | 'align-layout' | 'align'

/**
 * 「这个工作区初始化了没有」的三档结论，与 kernel/prompts-setup.js 的注入决策同域。
 * 'unknown' 不是「没初始化」，是「判不出来」（链里没这一步 / 还没取到链）——
 * 那时一个字都不注入，与「fresh」是两种不同的处理，不能合并。
 */
type WorktreeState = 'initialized' | 'fresh' | 'unknown'

/** 链快照里的一步（本文件只读 id 与「过没过」，其余字段不声称）。 */
type ChainStep = { id?: string } & Record<string, unknown>

/**
 * 会话状态对象。**故意不立全字段接口**：它由闭包各处共用、随用随加，在这里抄一份必然与别处走岔。
 * 下面列的只是本文件真正读过的那些字段，全部可选 —— 本文件对它们的每个访问本来就包在 try 里，
 * 读不到就当没有。
 */
type StatusPickState = {
  cwd?: string
  setupLayout?: string | null
  setupPickLayout?: string
  setupLayoutCardOpen?: boolean
  setupLayoutDraftBefore?: string | null
  setupCardOwner?: string
  switchCardFrom?: unknown
  switchCardTo?: unknown
  switchCardLayoutFrom?: unknown
  switchAlignDone?: boolean
  selection?: { backendId?: string | null; source?: string; ref?: unknown; userPicked?: boolean } | null
  chainSnapshot?: { steps?: ChainStep[] } | null
  backendModules?: BackendModule[]
  repository?: unknown
  snapshot?: { repository?: unknown; setupLayout?: unknown } | null
  gateModalOpen?: boolean
  gateModalSource?: string | null
  gateSelected?: string | null
  gateError?: string
  gateLoading?: boolean
  tab?: string
  [key: string]: unknown
}

/** wf.registry 回包的一种形态（三种摆放都见过，见 openStatusGate 里的三支 if）。 */
type BackendModule = { id?: string } & Record<string, unknown>
type BackendRegistryReply = {
  ok?: boolean
  modules?: BackendModule[]
  value?: { modules?: BackendModule[]; ok?: boolean }
} & Record<string, unknown>

/** wf.bind 回包的一种形态（成功判定与 persisted 标记，见 confirmStatusGate）。 */
type BindReply = {
  ok?: boolean
  persisted?: boolean
  error?: unknown
  message?: unknown
  value?: { ok?: boolean; persisted?: boolean }
} & Record<string, unknown>

/** 闭包里的 h()：建一个元素，返回什么由渲染层定，本文件只负责递下去。 */
type HFactory = (tag: string, props?: Record<string, unknown> | null, children?: unknown) => any
