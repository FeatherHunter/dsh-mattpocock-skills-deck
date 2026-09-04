// panel/OverlayGate.js — 悬浮面板后端选择门控（从 Overlay.js 拆出，V4 #464，纯结构、行为零变化）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
// src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
// 以后谁改它：改后端选择门控旅程、等待中和未设置分支的打开关闭确认直选的人改它。
// 接线：Overlay.js 留同名包装供渲染直调（_openGateModal2 等四包装调本文件四函数）；
//   本文件不引用 DockSync.js（同闭包拼回，调用方向见 Overlay.js 门控包装四处）。
// 参数：s = 面板 store；gateModules = otherFiltered 后端清单（调用方传入，保持闭包一致）。
export const openOverlayGate = function(s, gateModules){
        s.gateModalOpen = true
        if (!s.gateSelected) {
          const first = (gateModules && gateModules[0]) ? gateModules[0].id : firstBackendIdOf(null)
          s.gateSelected = first
        }
        s.gateError = ''
        emit(s)
        if (typeof host !== 'undefined' && host.call) {
          s.gateLoading = true; emit(s)
          host.call('wf.registry', { cwd: s.cwd || '' }).then(function(r){
            s.gateLoading = false
            let mods = null
            if (r && r.ok && Array.isArray(r.modules)) mods = r.modules
            else if (r && Array.isArray(r.modules)) mods = r.modules
            else if (r && r.value && Array.isArray(r.value.modules)) mods = r.value.modules
            if (Array.isArray(mods) && mods.length) {
              const filtered = mods.filter(function(m){ return String(m.id).toLowerCase()!=='other' })
              const fin = filtered.length ? filtered : mods.filter(function(m){ return String(m.id).toLowerCase()!=='other' })
              if (fin.length) {
                s.backendModules = mods
                try{ if (typeof setPresentationMap==='function') setPresentationMap(mods) }catch(e){}
                const ids = fin.map(function(x){ return x.id })
                if (!s.gateSelected || ids.indexOf(s.gateSelected)<0) s.gateSelected = fin[0].id
              }
            }
            emit(s)
          }).catch(function(){ s.gateLoading=false; emit(s) })
        }
      }
export const closeOverlayGate = function(s){ s.gateModalOpen=false; s.gateError=''; emit(s) }
export const confirmOverlayGate = function(s, gateModules){
        const id = s.gateSelected || ((gateModules[0] && gateModules[0].id)) || firstBackendIdOf(gateModules)
        if (String(id).toLowerCase()==='other') { s.gateError=tr('switch.gateOtherErr'); emit(s); return }
        const prev = s.selection
        const repoRef = s.repository || (s.snapshot && s.snapshot.repository) || null
        const next = { backendId: id, source: 'explicit', ref: repoRef }
        s.selection = next
        try{ if(s.cwd) setCachedSelection(s.cwd,next) }catch(e){}
        s.gateModalOpen=false
        emit(s)
        if(typeof host!=='undefined' && host.call){
          host.call('wf.bind', { cwd: s.cwd||'', backendId: id }).then(function(res){
            const ok = res && (res.ok===true || (res.value && res.value.ok===true) || res.ok)
            if(ok){
              s.tab='list'
              emit(s)
              try{ flash(s, tr('switch.bindOk', { label: (typeof labelOf==='function'?labelOf(id):String(id)) }), 'ok') }catch(e){}
              try{
                // #230（D10）：占位符由后端描述数据填充，UI 不再拼装
                const txt = (typeof setupRunPrompt==='function'? setupRunPrompt(s, id) : '')
                if (txt) { try{ inject(s, txt) }catch(e){} }
              }catch(e){}
              loadSnapshot(s,true,true)
            } else {
              s.selection=prev; try{ if(s.cwd) setCachedSelection(s.cwd,prev) }catch(e){}; emit(s)
              try{ flash(s, tr('switch.bindFail',{err:String((res&&(res.error||res.message))||'unknown').slice(0,120)}), 'warn') }catch(e){}
            }
          }).catch(function(e){
            s.selection=prev; try{ if(s.cwd) setCachedSelection(s.cwd,prev) }catch(e2){}; emit(s)
            try{ flash(s, '绑定失败:'+String(e && e.message || e).slice(0,120), 'warn') }catch(e3){}
          })
        }
      }
export const pickOverlayBackend = function(s, gateModules, id){ s.gateSelected=id; emit(s); confirmOverlayGate(s, gateModules) }
