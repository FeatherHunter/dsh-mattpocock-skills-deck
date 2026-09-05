// panel/DockSync.js — 停靠面板工作区跟随（从 Dock.js 拆出，V4 #464，纯结构、行为零变化）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
// src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
// 以后谁改它：改切会话跟随当前会话、响应式工作区同步、污染自愈的人改它。
// 接线：Dock.js 单调 useDockSync(s, sid, summaryCwd, props) 供装配（此前是两个副作用原位）；
//   本文件不引用 OverlayGate.js（同闭包拼回，调用方向见 Dock.js 装配一处）。
// 参数：s = 停靠 store；sid = 会话标识；summaryCwd = 会话列表权威工作区；props = 槽位属性（取 session 兜底用）。
export const useDockSync = function(s, sid, summaryCwd, props){
      // #179 加固：响应式工作区同步（对齐 StatusBar）+ 回切自愈（同 sid 切工作区亦触发）
      React.useEffect(function () {
        const apply = function (cwd) {
          if (!cwd) return false
          const norm = (typeof keyOf==='function'?keyOf(cwd):String(cwd).replace(/\\/g,'/').replace(/\/+$/,''))
          const cur = (typeof keyOf==='function'?keyOf(s.cwd||''):String(s.cwd||'').replace(/\\/g,'/').replace(/\/+$/,''))
          const need = norm !== cur
          // 每次 cwd 变更都强制刷新（即使 hydrate 命中），避免“回切仍为旧快照/没有仓库”空白
          if (need) {
            try { log('warn', 'dock.rehydrate', { sidHash: dswsLogHash(sid), cwdChanged: true, polluted: false }) } catch (eL) {}
            s.cwd = cwd
            const hydrated = hydrateFromCache(s)
            emit(s)
            loadChain(s, false)
            // 回切必刷：cwd 变了就重拉快照（不依赖 snapFresh），确保仓库名与后端跟随
            loadSnapshot(s, false, !!hydrated)
            return true
          }
          // 同 cwd 但快照污染（repoRoot 前缀不匹配）也必刷
          const snap = s.snapshot
          let polluted = false
          if (snap && snap.repoRoot) {
            const rr = (typeof keyOf==='function'?keyOf(snap.repoRoot):String(snap.repoRoot).replace(/\\/g,'/').replace(/\/+$/,''))
            if (norm !== rr && !norm.startsWith(rr + '/') && !rr.startsWith(norm + '/')) polluted = true
          } else if (snap && snap.repository && snap.repository.name) {
            const n = String(snap.repository.name)
            if (!n.includes(':\\') && !n.includes(':/')) {
              const base = cwdBasename(cwd)
              const rn = n.split('/').pop().toLowerCase()
              if (base && rn && base.toLowerCase() !== rn) polluted = true
            }
          } else if (snap && snap.repo && snap.repo.name) {
            const base = cwdBasename(cwd)
            if (base && snap.repo.name !== base) polluted = true
          }
          if (polluted) { try { log('warn', 'dock.rehydrate', { sidHash: dswsLogHash(sid), cwdChanged: false, polluted: true }) } catch (eL) {}; loadSnapshot(s, false, true); loadChain(s, false); return true }
          return false
        }
        if (summaryCwd) { if(apply(summaryCwd)) return }
        const cwd0 = detectCwd(props && props.session)
        if (cwd0) { if(apply(cwd0)) return }
        const sync = getCwdSync(sid)
        if (sync) { if(apply(sync)) return }
        if (sid && typeof host !== 'undefined' && typeof host.call === 'function') {
          host.call('wf.cwd', { sessionId: sid }).then(function (res) {
            if (res && res.ok && res.cwd) apply(res.cwd)
          }).catch(function () {})
        }
      }, [sid, summaryCwd])
      // 初始/污染自愈：随 sid 变化重跑（修复空 deps），并额外监听 summaryCwd/s.cwd 变化以覆盖“同 sid 切工作区”场景
      React.useEffect(function () {
        if (!s.cwd) {
          const sync = getCwdSync(sid)
          if (sync) { s.cwd = sync; hydrateFromCache(s) }
        } else { hydrateFromCache(s) }
        // 污染自愈：若当前 store 的 snapshot 仍是之前工作区串台残留（repoRoot 与 cwd 前缀不匹配，或 repo/repository 名与 cwd 尾段不一致），强制后台刷新
        const isPolluted = (function(){
          if (!s.snapshot || !s.cwd) return false
          const snap = s.snapshot
          if (snap.repoRoot) {
            const rr = (typeof keyOf==='function'?keyOf(snap.repoRoot):String(snap.repoRoot).replace(/\\/g,'/').replace(/\/+$/,''))
            const cw = (typeof keyOf==='function'?keyOf(s.cwd):String(s.cwd).replace(/\\/g,'/').replace(/\/+$/,''))
            if (cw === rr) return false
            if (cw.startsWith(rr + '/')) return false
            if (rr.startsWith(cw + '/')) return false
            return true
          }
          if (snap.repository && snap.repository.name) {
            const n = String(snap.repository.name)
            // 文件路径形态（D:\...）不参与 basename 误判；仅 owner/name 形态参与
            if (n.includes(':\\') || n.includes(':/')) return false
            const base = cwdBasename(s.cwd)
            if (base && n.split('/').pop().toLowerCase() !== base.toLowerCase()) return true
          }
          if (snap.repo && snap.repo.name) {
            const base = cwdBasename(s.cwd)
            if (base && snap.repo.name !== base) return true
          }
          return false
        })()
        if (isPolluted) { loadSnapshot(s, false); loadChain(s, false); return }
        if (!snapFresh(s)) loadSnapshot(s, false); loadChain(s, false)
      }, [sid, summaryCwd, s.cwd, s.snapshot && s.snapshot.repoRoot, s.snapshot && s.snapshot.repository && s.snapshot.repository.name, s.snapshot && s.snapshot.repo && s.snapshot.repo.name])
      }
