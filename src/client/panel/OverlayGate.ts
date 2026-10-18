// panel/OverlayGate.ts — 悬浮面板后端选择门控（从 Overlay.js 拆出，V4 #464，纯结构、行为零变化）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
// src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
// 以后谁改它：改后端选择门控旅程、等待中和未设置分支的打开关闭确认直选的人改它。
// 接线：Overlay.js 留同名包装供渲染直调（_openGateModal2 等四包装调本文件四函数）；
//   本文件不引用 DockSync.js（同闭包拼回，调用方向见 Overlay.js 门控包装四处）。
// 参数：s = 面板 store；gateModules = otherFiltered 后端清单（调用方传入，保持闭包一致）。
// （#1251：本文件由同名 .js 转成 .ts，只补类型标注（形参一律 any）与环境声明，运行时行为一字不动。约束：不许加运行时 import（跨文件名字一律 ambient declare，构建拼闭包时拒收残留 import）；不许 export default；只写可剥离类型。）
/**
 * 闭包环境声明（#1251 转 TS 时补的）：下面这些名字在源码树里没有定义，
 * 它们是别的叶子拼进同一个浏览器闭包时带进来的；类型检查靠这里声明形状。
 * 构建转译时会把 declare 整段抹掉，所以运行时一字不差。
 * 约束：以后新增跨文件引用只许在这里加 declare，不要加运行时 import
 * （构建侧 toSpliceableFragment 会拒收残留的 import，整个片段拼不进去）；
 * 也不要写 export default（构建侧 inlineExportDeclarations 不收 as 改名）。
 */
// 后端选择与快照：直选、回绑定、刷界面，由 kernel 与别的叶子提供。
declare function adoptBoundRev(...args: any[]): any;
declare function firstBackendIdOf(...args: any[]): any;
declare function flash(...args: any[]): any;
declare function labelOf(...args: any[]): any;
declare function loadSnapshot(...args: any[]): any;
declare function setCachedSelection(...args: any[]): any;
declare function setPresentationMap(...args: any[]): any;
declare function userPickSelection(...args: any[]): any;

export const openOverlayGate = function(s: any, gateModules: any){
        s.gateModalOpen = true
        if (!s.gateSelected) {
          const first = (gateModules && gateModules[0]) ? gateModules[0].id : firstBackendIdOf(null)
          s.gateSelected = first
        }
        s.gateError = ''
        emit(s)
        if (typeof host !== 'undefined' && host.call) {
          s.gateLoading = true; emit(s)
          host.call('wf.registry', { cwd: s.cwd || '' }).then(function(r: any){
            s.gateLoading = false
            let mods = null
            if (r && r.ok && Array.isArray(r.modules)) mods = r.modules
            else if (r && Array.isArray(r.modules)) mods = r.modules
            else if (r && r.value && Array.isArray(r.value.modules)) mods = r.value.modules
            if (Array.isArray(mods) && mods.length) {
              const filtered = mods.filter(function(m: any){ return String(m.id).toLowerCase()!=='other' })
              const fin = filtered.length ? filtered : mods.filter(function(m: any){ return String(m.id).toLowerCase()!=='other' })
              if (fin.length) {
                s.backendModules = mods
                try{ if (typeof setPresentationMap==='function') setPresentationMap(mods) }catch(e){}
                const ids = fin.map(function(x: any){ return x.id })
                if (!s.gateSelected || ids.indexOf(s.gateSelected)<0) s.gateSelected = fin[0].id
              }
            }
            emit(s)
          }).catch(function(){ s.gateLoading=false; emit(s) })
        }
      }
export const closeOverlayGate = function(s: any){ s.gateModalOpen=false; s.gateError=''; emit(s) }
export const confirmOverlayGate = function(s: any, gateModules: any){
        const id = s.gateSelected || ((gateModules[0] && gateModules[0].id)) || firstBackendIdOf(gateModules)
        if (String(id).toLowerCase()==='other') { s.gateError=tr('switch.gateOtherErr'); emit(s); return }
        const prev = s.selection
        const repoRef = s.repository || (s.snapshot && s.snapshot.repository) || null
        const next = (typeof userPickSelection === 'function') ? userPickSelection(id, repoRef, prev) : { backendId: id, source: 'explicit', ref: repoRef, userPicked: true } // #669 第 6 件：门控确认＝用户亲手选的那一下，带上标记（这个叶今天没有调用点，留着是为了将来接线时不静默少一道闸）
        s.selection = next
        try{ if(s.cwd) setCachedSelection(s.cwd,next) }catch(e){}
        s.gateModalOpen=false
        emit(s)
        if(typeof host!=='undefined' && host.call){
          host.call('wf.bind', { cwd: s.cwd||'', backendId: id }).then(function(res: any){
            const ok = res && (res.ok===true || (res.value && res.value.ok===true) || res.ok)
            if(ok){
              try{ if(typeof adoptBoundRev === 'function') adoptBoundRev(s, res) }catch(eRev){}
              // #1138：选择写进工作区文件才算数；本机备份没写成只是信息级提醒（词条见 locale-word.js）。
              try{ var _np=res&&(res.persisted===false||(res.value&&res.value.persisted===false)); if(_np) flash(s, tr('switch.bindNotPersisted'), 'info') }catch(eP){}
              s.tab='list'
              emit(s)
              try{ flash(s, tr('switch.bindOk', { label: (typeof labelOf==='function'?labelOf(id):String(id)) }), 'ok') }catch(e){}
              // #664：绑定成功不再往会话里注入任何文字 —— 门控这个窗只把后端定下来；
              //   初始化文案由「该工作区尚未初始化」那条黄条那颗按钮注入（先弹布局小卡，选完才注入）。
              loadSnapshot(s,true,true)
            } else {
              s.selection=prev; try{ if(s.cwd) setCachedSelection(s.cwd,prev) }catch(e){}; emit(s)
              try{ flash(s, tr('switch.bindFail',{err:String((res&&(res.error||res.message))||'unknown').slice(0,120)}), 'warn') }catch(e){}
            }
          }).catch(function(e: any){
            s.selection=prev; try{ if(s.cwd) setCachedSelection(s.cwd,prev) }catch(e2){}; emit(s)
            try{ flash(s, '绑定失败:'+String(e && e.message || e).slice(0,120), 'warn') }catch(e3){}
          })
        }
      }
export const pickOverlayBackend = function(s: any, gateModules: any, id: any){ s.gateSelected=id; emit(s); confirmOverlayGate(s, gateModules) }
