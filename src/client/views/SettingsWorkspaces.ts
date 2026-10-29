/**
 * views/SettingsWorkspaces.ts — 设置页工作区后端总览（从 SettingsPage.js 拆出，V3 #463，纯结构、行为零变化；
 * #1231 由同名 .js 转成 TypeScript，真源从此是这一份）
 *
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时把转译出的同名 .js 产物剥行首 export，
 * 拼回 src/client/index.ts 的 leaf 标记处（源码树里只有这一份真源，标记 id 与本文件名一致）。
 * 以后谁改它：改工作区后端总览、绑定排序、工作区跳转的人改它。
 * 接线：SettingsPage.ts 顶部调 useWsOverview 取数据（自带首屏加载，跳转函数随附返回），
 *   总览分组处调 renderWsOverview；cwd 归一贴加载逻辑放一起（原样搬入）。
 * 参数：cx = 上下文（取工作区服务兜底用）；sharedSt = 设置 store；其余为总览派生与折叠态（调用方传入）。
 *
 * 渲染口径（#1231，按 #1233 定版）：总览的行怎么算只认统一判定结论这一处——
 *   批量预读表不再是第二口径，行按工作区根合并，重名用最短唯一后缀区分。
 *   下面三个是纯函数（不碰宿主、不碰界面、不读钟），只喂值、看返回值，
 *   口径行为由 tests/verify-1231-ws-overview-rows.ts 锁死。
 *   构建拼叶子时禁运行时引用，所以后缀算法在这里实现一份；它与版本管理页签是同一套
 *   （来源 src/shared/version-control/src/state.ts 的 shortestUniqueSuffix），对拍写在同一份测试里，漂了就红。
 *
 * 类型怎么标的（#1231 转 TypeScript 时补）：本文件是「拼进闭包的一段」，不是能被 import 的模块，
 *   React、host、tr 这些名字都由闭包提供，所以下面用一层 declare 把外面有什么写下来
 *   （仓库既定的做法，esbuild 转译时会整条删掉，产物与转换前逐字一致）。
 *   宿主回包一律按 unknown 收、内部先收窄再用：回包缺字段、包错层都按「没有结论」处理，不抛错。
 */

/** 统一判定结论里总览真正要读的格：后端名（空表示没选）与来源（人选还是程序认的）。
 *  #1238 再加三格只读诊断（统一口回包里本来就有，渲染过去没接）：
 *  pending（还没判完）、reason（工作区没就绪那条早退回的原因）、state（三态：decided / undetermined（没查清）/ no-backend（查清了确实没有））。
 *  三格全缺席按无信息处理，不抛错（本文件既定做法：宿主回包一律先收窄再用）。 */
export type WsSelection = {
  backendId?: string | null;
  source?: string;
  pending?: boolean;
  reason?: string;
  state?: string;
};

/** 所选目录原文 → 判定结论（键是请求时递给 wf.selection 的那个目录原样，不做归一）。 */
export type WsSelections = Record<string, WsSelection>;

/**
 * 行计算要用的外界能力（由渲染层递进来，纯函数自己不直接认全局，测试里用几行小函数冒充）：
 * normKeyOf 把目录洗成可比的键；rootKeyOf 查它被锚到了哪个工作区根（查不到给空串，不猜）；
 * resolveRoot 把根的键翻回原样路径（翻不到给空串）；modulesOrder 是后端注册序（已绑定置顶用）。
 */
export interface WsOverviewDeps {
  normKeyOf: (p: string) => string;
  rootKeyOf: (p: string) => string;
  resolveRoot: (rootKey: string) => string;
  modulesOrder: string[];
}

/** 总览里的一行：cwd 是代表目录（优先取工作区根自己），members 是并进来的全部原样目录。 */
export interface WsOverviewRow {
  cwd: string;
  /** 这一组的工作区根（原样路径，找得到才有；找不到就是空串，不猜）。 */
  root: string;
  members: string[];
  /** 这组是不是真并进了不止一条目录（渲染层据此决定要不要标一句）。 */
  merged: boolean;
  /** 统一判定结论里的后端名（全组都没有结论就是 null，显示成未绑定）。 */
  backendId: string | null;
  source: string;
  bound: boolean;
  /**
   * 未绑定行才用的失败线索（已绑定行恒为 null，只显示后端名不添噪音）：
   * wait 是等就绪（还没判完或工作区没就绪，点刷新重试）；check 是查文件（判定没查清，去看工作区选择文件）；
   * null 是查清了确实没有（普通未绑定，保持原样）。分类只看统一结论自带的诊断格，不新判定。
   */
  unboundHint: 'wait' | 'check' | null;
  /** 代表行的显示名（按最短唯一后缀算好，渲染层直接用）。 */
  display?: string;
}

/** 行计算的结果：rows 是排好序的行，total/boundCount 直接给表头用，三者必须自洽。 */
export interface WsOverviewView {
  rows: WsOverviewRow[];
  total: number;
  boundCount: number;
}

declare const ctx: unknown;
declare function keyOf(p: unknown): string;
declare const workspaceRootByCwd: Record<string, string> | null | undefined;
declare function getCachedSnapshot(key: string): { workspaceRoot?: string } | null | undefined;
declare const Tip: unknown;
declare const HoverTip: unknown;
declare const Ic: (props: { n: string; size: number; color?: string }) => unknown;
declare function flash(sharedSt: unknown, text: string, kind: string): void;
declare function copyText(sharedSt: unknown, text: string, doneText: string): void;
declare function labelOf(backendId: string): string;
declare function backendColorOf(backendId: string | null): string;
declare function setPresentationMap(modules: unknown): void;
// #1612：下面四个函数由内核片 kernel/deck-state.ts 提供，构建时和本叶子拼进同一个闭包，所以这里只声明、不 import。
//   deckStatusBarOf / deckToolsOf 读这个工作区设置归一后的当前值（'show'|'hide'、'on'|'off'）；
//   setDeckStatusBar / setDeckTools 写一个新值并广播，设置文件与胶囊状态由它们统一维护。
//   #1641：第三个参数 listed 表示这一行来自工作区名单（不是拿当前目录凑出来的兜底行）——名单上的工作区
//   可能还没打开过、认不出根，写口按列表里的路径先存一条临时记录。
declare function deckStatusBarOf(cwd: string): string;
declare function deckToolsOf(cwd: string): string;
declare function setDeckStatusBar(cwd: string, show: boolean, listed?: boolean): unknown;
declare function setDeckTools(cwd: string, on: boolean, listed?: boolean): unknown;

/**
 * 最短唯一后缀：每条路径从末段往左数到可区分的最少段数（全撞车就取全长）。
 * 与版本管理页签是同一套算法，漂了测试里的对拍会红，不要在这里自创第二套。
 */
export const wsSuffixKeepOf = function (paths: string[]): number[] {
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

/**
 * 显示名：取路径末尾 keep 段，段之间用斜杠连（与版本管理页签同一套写法）。
 * keep 总是由 wsSuffixKeepOf 给，不自己猜。
 */
export const wsDisplayOf = function (path: string, keep: number): string {
  const segs = String(path).replace(/\\/g, '/').split('/').filter(function (s) { return s !== '' })
  return segs.slice(-Math.max(1, keep)).join('/')
}

/**
 * 未绑定行的失败线索分类：输入统一判定结论，输出渲染直接用的档位。
 * wait：pending 为真（还没判完）或原因是工作区没就绪——都是“等”的情形，点刷新重试。
 * check：三态是没查清（undetermined）——文件可能缺席或读不出来，去查文件。
 * null：其余一律普通未绑定（查清了确实没有、结论缺席、将来结论带了不认识的新格），不加线索。
 * 判定依据的格全是统一口自带的，这里只分类不重新判定；已绑定行不走这里（调用方保证）。
 */
export const wsUnboundHintOf = function (sel: WsSelection | null): 'wait' | 'check' | null {
  if (!sel) return null
  if (sel.pending === true) return 'wait'
  if (typeof sel.reason === 'string' && sel.reason === 'workspace-not-ready') return 'wait'
  if (typeof sel.state === 'string' && sel.state === 'undetermined') return 'check'
  return null
}

/**
 * 总览行计算：输入候选目录清单与统一判定结论表，输出要渲染的行。
 * 合并：能查到同一个工作区根的目录并成一行，代表行优先取根本身；查不到根的各自成行（不猜）。
 * 判定：代表行优先认自己的结论，没有再看组里有没有成员有结论（组里有一个就算这组已绑定）；
 *   全组都没有就是未绑定，后端名空、来源记 fallback。
 * 排序：已绑定置顶（按后端注册序再按显示名），未绑定按显示名。
 */
export const computeWsOverviewRows = function (paths: string[], selections: WsSelections, deps: WsOverviewDeps): WsOverviewView {
  const normKeyOf = deps.normKeyOf
  const rootKeyOf = deps.rootKeyOf
  const resolveRoot = deps.resolveRoot
  const modulesOrder = deps.modulesOrder || []
  const selMap = selections || {}
  const groups: Record<string, { members: string[] }> = {}
  const groupOrder: string[] = []
  paths.forEach(function (p) {
    const k = normKeyOf(p)
    if (!k) return
    let rk = ''
    try { rk = rootKeyOf(p) || '' } catch (e) { rk = '' }
    if (!rk) rk = k
    if (!groups[rk]) { groups[rk] = { members: [] }; groupOrder.push(rk) }
    groups[rk].members.push(p)
  })
  const rows: WsOverviewRow[] = groupOrder.map(function (rk) {
    const members = groups[rk].members
    let rep = members[0]
    for (let i = 0; i < members.length; i += 1) {
      if (normKeyOf(members[i]) === rk) { rep = members[i]; break }
    }
    const ordered = [rep].concat(members.filter(function (m) { return m !== rep }))
    let sel: WsSelection | null = selMap[rep] || null
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
    return { cwd: rep, root: root, members: members.slice(), merged: members.length > 1, backendId: backendId, source: (sel && sel.source) ? sel.source : 'fallback', bound: !!backendId, unboundHint: backendId ? null : wsUnboundHintOf(sel) }
  })
  // 显示名：代表行之间按最短唯一后缀区分（重名取两段以上，不重名只取末段）。
  const keeps = wsSuffixKeepOf(rows.map(function (r) { return r.cwd }))
  rows.forEach(function (r, i) { r.display = wsDisplayOf(r.cwd, keeps[i]) })
  const rankOf = function (bid: string | null): number { if (!bid) return 9999; const i = modulesOrder.indexOf(bid); return i < 0 ? 9999 : i }
  const byDisplay = function (a: WsOverviewRow, b: WsOverviewRow): number { const x = String(a.display).toLowerCase(), y = String(b.display).toLowerCase(); if (x < y) return -1; if (x > y) return 1; return 0 }
  const bound = rows.filter(function (r) { return r.bound })
  const unbound = rows.filter(function (r) { return !r.bound })
  bound.sort(function (a, b) { const ra = rankOf(a.backendId), rb = rankOf(b.backendId); if (ra !== rb) return ra - rb; return byDisplay(a, b) })
  unbound.sort(byDisplay)
  const ordered = bound.concat(unbound)
  return { rows: ordered, total: ordered.length, boundCount: bound.length }
}

/**
 * 总览数据钩子：首屏自动拉一次，返回 state 与重拉函数。
 * 只认统一判定结论，不再批量预读另一份表——那份表是第二口径，已删。
 * 行名单只从工作区服务来；拿不到名单又没有当前目录就空着，不猜。
 */
export const useWsOverview = function (cx: any, sharedSt: any): { wsOverview: any; loadRef: any; gotoWorkspace: (cwd: string) => void } {
      // #190 修复：client 侧 cwd 归一（绝对直通；相对原样交给 host normCwd）。
      const normCwdClient=function(raw: unknown): string{
        if(!raw) return ''
        // 不直接改写参数：unknown 经三元收窄到 string 后绑给 text（参数重赋值在 TS 7 下收窄会丢，
        // 实测 tsc 报 unknown；且不可变绑定比改参数更干净）。行为与原来逐字一致，见差分测试。
        const text = (typeof raw === 'string') ? raw : String(raw)
        try{ if(/^[A-Za-z]:[\\/]/.test(text)||/^\//.test(text)) return text.replace(/[\\/]+$/,'') }catch(e){}
        return text
      }
      const [wsOverview, setWsOverview] = React.useState({ loading:true, err:'', workspaces:[], modules:[], selections:{} })
      const loadRef = React.useRef(null)
      React.useEffect(function(){
        let cancelled=false
        const load=async function(){
          setWsOverview(function(p: any){ return Object.assign({},p,{loading:true,err:''}) })
          let modules: unknown[]=[], selections: WsSelections={}, wsList: any[]=[]
          if(typeof host!=='undefined'&&typeof host.call==='function'){
            try{ const r2=await host.call('wf.registry',{cwd:''}); const mods=(r2&&r2.modules)||(r2&&r2.value&&r2.value.modules)||[]; if(Array.isArray(mods)&&mods.length){ modules=mods; try{ setPresentationMap(mods)}catch(e){}} }catch(e2){}
          }
          try{
            let wsSvc: any=null; try{ if(typeof ctx!=='undefined'&&ctx&&typeof (ctx as any).get==='function') wsSvc=(ctx as any).get('workspaces')}catch(e){}; if(!wsSvc&&cx&&cx.ctx&&typeof cx.ctx.get==='function') try{ wsSvc=cx.ctx.get('workspaces')}catch(e){}
            if(wsSvc){
              let snap: any=null; try{ if(wsSvc.list){ if(typeof wsSvc.list.getSnapshot==='function') snap=wsSvc.list.getSnapshot(); else if(typeof wsSvc.list.getCurrent==='function') snap=wsSvc.list.getCurrent(); else if(typeof wsSvc.list==='function') snap=await wsSvc.list(); else if(Array.isArray(wsSvc.list)) snap=wsSvc.list } }catch(e){}
              if(snap){ if(Array.isArray(snap.items)) wsList=snap.items; else if(Array.isArray(snap)) wsList=snap; else if(snap.byId&&typeof snap.byId==='object') try{ wsList=Object.values(snap.byId)}catch(e){} }
              if(!wsList.length&&wsSvc.list&&typeof wsSvc.list==='function') try{ const a=await wsSvc.list(); if(Array.isArray(a)) wsList=a }catch(e){}
              if(!wsList.length&&typeof wsSvc.getAll==='function') try{ const a2=await wsSvc.getAll(); if(Array.isArray(a2)) wsList=a2 }catch(e){}
            }
          }catch(e){}
          const allSet: Record<string, number>={}, all: string[]=[]; const add=function(c: string){ const k=String(c); if(!allSet[k]){ allSet[k]=1; all.push(k)}}; wsList.forEach(function(w: any){ const raw=w.path||w.cwd||w.dir||w.workspacePath||w.root||w.fullPath||''; const k=normCwdClient(raw); if(k) add(k) });
          if(!all.length&&sharedSt.cwd) add(sharedSt.cwd)
          for(let i=0;i<all.length;i++){ const cwd=all[i]; try{ const r=await host.call('wf.selection',{cwd}); const sel=(r&&r.selection)||(r&&r.value&&r.value.selection)||(r&&r.value&&r.value.value&&r.value.value.selection)||null; if(sel) selections[cwd]=sel }catch(e){}; if(cancelled) return }
          if(cancelled) return
          setWsOverview({loading:false,err:'',workspaces:wsList,modules,selections})
        }
        loadRef.current = load
        load(); return function(){ cancelled=true }
      },[])
      const gotoWorkspace = function(cwd: string){
        let wsSvc: any = null
        try{ if (typeof ctx !== 'undefined' && ctx && typeof (ctx as any).get === 'function') wsSvc = (ctx as any).get('workspaces') }catch(e){}
        if (!wsSvc && cx && cx.ctx && typeof cx.ctx.get === 'function') try{ wsSvc = cx.ctx.get('workspaces') }catch(e){}
        if (!wsSvc){ flash(sharedSt, tr('cfg.wsNoService'), 'warn'); return }
        try{
          if (typeof wsSvc.open === 'function'){
            const r = wsSvc.open(cwd)
            if (r && typeof r.then === 'function') r.then(function(){ flash(sharedSt, tr('cfg.wsJumpedTo', { cwd: cwd }), 'ok') }).catch(function(e: unknown){ flash(sharedSt, tr('cfg.wsJumpFail', { msg: String(e).slice(0,120) }), 'warn') })
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

/**
 * 总览分组渲染：行怎么算只认统一判定结论——合并、判定、排序都收进上面的纯函数，
 * 这里只递规整与查根，不再自建第二口径。
 */
export const renderWsOverview = function (h: any, sharedSt: any, wsOverview: any, loadRef: any, foldVer: number, setFoldVer: (v: number) => void): unknown {
      // #653 归属标注：按 #649 定版记录 3.5 节，规则生效后被并进工作区根的那几行要标出归属，
      //   但**不删、不迁移**用户已有的分桶状态（插件不擅自清理用户的持久状态），所以这里只是加一句说明。
      // 怎么知道某一行被并进了谁：host 从 #652 起把工作区身份锚到了工作区根，客户端在装快照时
      //   把「所选目录 → 工作区根」记进了 store-snapshot.js 的 workspaceRootByCwd 表（快照里也带回来一份）。
      //   把这几个来源并起来看成一张表：某一行能查到根、且根不是它自己、而根本身又在这张清单里 →
      //   这一行就是被并进根的子目录行。查不到就不标（宁可不标，也不猜一个路径给用户看）。
      const rootOf = function (p: unknown): string {
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
          const selMap: WsSelections=wsOverview.selections||{}
          const wsPaths: string[]=wsOverview.workspaces.map(function(w: any){ return w.path||w.cwd||w.dir||w.workspacePath||'' }).filter(Boolean)
          const seen: Record<string, number>={}, all: string[]=[]; wsPaths.forEach(function(c){ const k=String(c); if(!seen[k]){ seen[k]=1; all.push(k) } }); if(!all.length&&sharedSt.cwd) all.push(sharedSt.cwd)
          // #1641：这一行是不是来自工作区名单。名单行的路径是工作区服务给的，写开关时认不出根也可以按它先存一条
          //   临时记录；最后那个「拿当前目录凑一行」的兜底路径不在 seen 里，不算名单行，别按它写。
          const listedOf = function (c: string): boolean { try { return !!seen[String(c)] } catch (e) { return false } }
          if(!all.length) return h('div',{style:{fontSize:11,color:'#8b8b95',padding:'6px 0'}},tr('cfg.wsEmpty'))
          // #653 归属标注所需的两个表：哪些行本身是工作区根、哪些行的根是谁（根用规整键比对，显示用原样路径）
          const normOf = function (p: unknown): string { try { return (typeof keyOf === 'function') ? keyOf(p) : String(p || '').toLowerCase() } catch (e) { return String(p || '') } }
          const byNorm: Record<string, string> = {}
          all.forEach(function (c) { const n = normOf(c); if (n && !byNorm[n]) byNorm[n] = c })
          // #1231：行怎么算只认统一判定结论——合并、判定、排序都收进上面的纯函数，这里只递规整与查根，不再自建第二口径。
          const modsOrder: string[]=(wsOverview.modules||[]).map(function(m: any){return m.id})
          const view=computeWsOverviewRows(all, selMap, {
            normKeyOf: normOf,
            rootKeyOf: rootOf,
            resolveRoot: function (rk) { return byNorm[rk] || '' },
            modulesOrder: modsOrder,
          })
          const ordered=view.rows
          const boundCnt=view.boundCount
          // #1612：每行末尾两个受控开关（胶囊状态栏、deck 工具箱）。开关只负责写新值，怎么归一由 deck-state 统一读；
          //   点完把 foldVer 加一让这一组重画——行 key 带 foldVer，开关颜色立刻跟上。后端绑定列仍在左边，保持只读。
          //   #1641：最后一个参数把「这一行在不在工作区名单上」如实传给写口；名单上的行认不出根也能先存住。
          const wsSwitchOf = function(cwd: string, on: boolean, label: string, tip: string, log: string, write: (cwd: string, next: boolean, listed?: boolean) => unknown, listed: boolean): unknown {
            const tint = on ? '#4ade80' : '#8b8b95'
            return h(Tip, { content: tip }, h('button', { className:'dsws-hov', 'data-press':'button', 'data-log':log, style:{ padding:'0 5px', fontSize:10, color:tint, border:'1px solid '+tint, borderRadius:4, background:'transparent', cursor:'pointer', whiteSpace:'nowrap', flex:'none' }, onClick:function(e: any){ e.preventDefault(); e.stopPropagation(); try{ write(cwd, !on, listed) }catch(err){} setFoldVer(foldVer+1) } }, label))
          }
          return h('details',{ open:false, style:{ marginTop:6, border:'1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius:8, background:'rgba(255,255,255,.02)'}},[
            h('summary',{ className:'dsws-hov', 'data-press':'row', 'data-log':'settings.workspaces.toggle', style:{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', cursor:'pointer', listStyle:'none', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', fontSize:11, fontWeight:600, borderRadius:4 }},[ h('span',{style:{whiteSpace:'nowrap'}},tr('cfg.wsTotal', { n: view.total })), h('span',{style:{ color:boundCnt?'#4ade80':'#8b8b95', whiteSpace:'nowrap'}},tr('cfg.wsBound', { n: boundCnt })), h(Tip, { content: tr('tip.refreshWs') }, h('button',{ className:'dsws-hov', 'data-press':'button', 'data-log':'settings.workspaces.refresh', style:{ marginLeft:'auto', padding:'2px 8px', fontSize:10, color:'#58a6ff', border:'1px solid #58a6ff', borderRadius:4, background:'transparent', cursor:'pointer', whiteSpace:'nowrap', flex:'none' }, onClick:function(e: any){ e.preventDefault(); e.stopPropagation(); if(loadRef.current){ loadRef.current().then(function(){ try{ flash(sharedSt,tr('cfg.wsRefreshed'),'ok') }catch(e){} }).catch(function(){ try{ flash(sharedSt,tr('cfg.wsRefreshFail'),'warn') }catch(e){} }) } } }, tr('cfg.wsRefresh'))), h('span',{style:{ fontSize:10, color:'#58a6ff', whiteSpace:'nowrap'}},tr('cfg.wsToggleHint'))]),
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
                // #1238：未绑定行带失败线索时，来源标签的悬停换成线索文案（等就绪还是查文件分得清）；
                //   标签本身的字样不动，正常未绑定行与已绑定行的悬停也都不动。
                const srcTitle=row.unboundHint==='wait'?tr('cfg.wsHintWait'):row.unboundHint==='check'?tr('cfg.wsHintCheck'):source==='explicit'?tr('cfg.wsSrcExplicitTip'):source==='matches'?tr('cfg.wsSrcAutoTip'):tr('cfg.wsSrcUnsetTip')
                const display=row.display||cwd
                // #653：这一组并进了不止一条目录才标一句（几条目录并在这里）；Hover 浮层给组里每条原样路径，不猜。
                const mergedNote = row.merged ? tr('cfg.wsMergedCount', { n: row.members.length }) : ''
                const hoverText = row.merged ? row.members.join(' ｜ ') : cwd
                // #1612：两个开关的当前状态只认 deck-state 归一后的值——文件里缺省、旧字段迁移都由它兜住，这里不重新判定。
                const sbOn = deckStatusBarOf(cwd)==='show'
                const toolsOn = deckToolsOf(cwd)==='on'
                return h('div',{ key:cwd + '#' + foldVer, style:{ display:'flex', alignItems:'center', gap:8, padding:'7px 8px', borderBottom:'1px solid var(--dsw-alias-border-l1,#2a2d35)', whiteSpace:'nowrap', overflow:'hidden', minHeight:28 }},[
                  h(HoverTip, { content: hoverText, mode: 'mouse', maxWidth: 220 }, h('div',{ style:{ flex:'1 1 0', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:11, fontWeight:500 } }, mergedNote ? (display + ' ' + mergedNote) : display)),
                  h('span',{ style:{ display:'inline-flex', alignItems:'center', gap:4, flex:'none', whiteSpace:'nowrap', fontSize:11, minWidth:72, justifyContent:'flex-end' }},[ h('span',{style:{width:7,height:7,borderRadius:'50%',background:color,flex:'none'}}), h('span',{style:{fontWeight:600,whiteSpace:'nowrap', minWidth:36, textAlign:'center'}},label) ]),
                  h(HoverTip, { content: srcTitle, mode: 'mouse', maxWidth: 220 }, h('span',{ style:{ fontSize:10, color:srcColor, border:'1px solid '+srcColor, borderRadius:4, padding:'0 4px', flex:'none', whiteSpace:'nowrap', minWidth:44, textAlign:'center', display:'inline-block'}}, srcLabel)),
                  wsSwitchOf(cwd, sbOn, tr('cfg.wsStatusBar'), tr('cfg.wsStatusBarTip'), 'settings.workspaces.statusbar', setDeckStatusBar, listedOf(cwd)),
                  wsSwitchOf(cwd, toolsOn, tr('cfg.wsDeckTools'), tr('cfg.wsDeckToolsTip'), 'settings.workspaces.decktools', setDeckTools, listedOf(cwd)),
                ])
              }))
            ])
          ])
        })(),
      ])
}
