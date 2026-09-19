// panel/DockSync.js — 停靠面板工作区跟随（从 Dock.js 拆出，V4 #464，纯结构、行为零变化）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
// src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
// 以后谁改它：改切会话跟随当前会话、响应式工作区同步、污染自愈的人改它。
// 接线：Dock.js 单调 useDockSync(s, sid, summaryCwd, props) 供装配（此前是两个副作用原位）；
//   本文件不引用 OverlayGate.js（同闭包拼回，调用方向见 Dock.js 装配一处）。
// 参数：s = 停靠 store；sid = 会话标识；summaryCwd = 会话列表权威工作区；props = 槽位属性（取 session 兜底用）。
// #653 快照污染判定（本文件两处自愈共用一份口径，不再各写一遍）。
// 「污染」= 手上这份快照不是当前这条工作区的数据。分两档判，按证据强弱先强后弱：
//   ① 两边的工作区根都认得出来（快照带着 workspaceRoot，本会话的工作区键也从宿主或缓存里学到了）
//      且不相同 → 污染。这一档是确定的，子目录会话与它的根会算出同一个键，不会被误判。
//   ② 认不出工作区根（旧快照没带这个字段，或宿主还没回过话）→ 退回按仓库名判一句话：
//      快照里有仓库名、而这个名字既不等于当前目录名、也答不上「当前目录在谁的里面」→ 污染。
//      第二档是**故意保守**的：宁可多刷一次，也不把当前目录误认成别人工作区的子目录。
// 为什么删掉旧白名单：旧写法是「两个目录互为祖先就不算污染」（用 repoRoot 前缀判）。那条规则保护的情形
//   （子目录会话读工作区根的数据）现在由①正确放过；而它同时把真的串台也放过了——两个仓库的目录互相
//   嵌套时，任何一边读另一边的数据都不算「污染」。#45 同类问题就是从这条缝里漏出去的。
export const isPollutedSnapshot = function (snap, cwd, storeCwd) {
  try {
    if (!snap || !cwd) return false
    const kOf = function (p) { return (typeof keyOf === 'function') ? keyOf(p) : String(p || '') }
    // 本会话的工作区键：先按当前目录问表，问不到再按 store 记着的那条目录问
    const mine = (typeof wsKeyOf === 'function') ? (wsKeyOf(cwd) || (storeCwd ? wsKeyOf(storeCwd) : '')) : kOf(cwd)
    if (snap.workspaceRoot && mine) {
      // ① 两边都认得出来时，按工作区根比。这一档是确定的：子目录会话与它的工作区根算出的就是同一个键。
      const sr = kOf(snap.workspaceRoot)
      if (sr && sr !== mine) return true
      if (sr && sr === mine) return false // 同一个工作区，绝不判污染
    }
    // ② 认不出工作区根（旧快照没带这个字段，或本会话还没学到根）：退回按仓库名判。
    //    口径与改动前相同，只对 owner/name 形态的仓库名生效；文件路径形态不参与，免得误判。
    if (snap.repository && snap.repository.name) {
      const n = String(snap.repository.name)
      if (n.includes(':\\') || n.includes(':/')) return false
      const base = cwdBasename(cwd)
      const rn = n.split('/').pop().toLowerCase()
      if (base && rn && base.toLowerCase() !== rn) return true
      return false
    }
    if (snap.repo && snap.repo.name) return cwdBasename(cwd) !== snap.repo.name
    return false
  } catch (e) { return false }
}
export const useDockSync = function(s, sid, summaryCwd, props){
      // #606 常规测点（面板打开各阶段耗时，按需级）：一次「点开面板」在这条副作用里收口成四行日志。
      //   为什么落在这里：渲染目录（views/panel/statusbar/floating）里只有点名文件允许写日志，
      //   本文件在名单内（判定依据见 tests/verify-log-truncate.js 第 4 组的 allowFiles）。
      //   为什么以「每次渲染都跑」的方式收口：面板侧边栏通常一直挂着、不重新挂载，挂在「首次挂载」上
      //   量不到点击那一刻；而每次 emit 都会让 s.tick 自增，于是点击触发的每一种渲染之后都会跑一次。
      //   四行各带自己的毫秒数（stage 枚举 + ms），不靠批内先后顺序判断 —— 宿主给同一批盖同一个 ts。
      //   收完就把起点清零，后面与本次打开无关的渲染不会再记。
      React.useEffect(function () {
        try {
          if (!panelClock.t0) return
          const _now = panelNow()
          if (panelClock.renderT0) {
            logPanelStage('render-commit', panelClock.commitMs >= 0 ? panelClock.commitMs : (_now - panelClock.renderT0))
            logPanelStage('render-paint', _now - panelClock.renderT0)
          }
          if (panelClock.fitMs) logPanelStage('fit-measure', panelClock.fitMs)
          logPanelStage('click-to-painted', _now - panelClock.t0)
          panelClock.t0 = 0
          panelClock.renderT0 = 0
          panelClock.commitMs = -1
          panelClock.fitMs = 0
        } catch (eP) {}
      })
      // #179 加固：响应式工作区同步（对齐 StatusBar）+ 回切自愈（同 sid 切工作区亦触发）
      // #653 为什么这组判定要重写：改动前它有一条白名单——「两个目录互为祖先就不算污染」。
      //   那条白名单是为了不把「子目录会话读父仓库数据」误判成串台；但按 #649 定版，子目录会话本来就该
      //   读工作区根的数据，而这条白名单同时把**真的串台**（两个工作区互为祖先，比如两个仓库存放在
      //   彼此的子目录里）也一并放过了——#45 同类问题因此从这条缝里漏过。
      //   现在改成按工作区根判定，白名单不要了，因为「什么算污染」可以一句话说清：
      //     ① 这份快照的工作区根与本会话的工作区根**都认得出来**且**不相同** → 污染；
      //     ② 不知道工作区根（快照没带、宿主还没回话）时，只有一种情况算污染：快照里有仓库名，
      //        而仓库名既不等于目录名、也解释不了当前目录（当前目录不是某个已知工作区根的子目录）。
      //   当年那条「互为祖先就放行」正是从②里删掉的——它保护的情形（子目录读根的数据）现在由①正确放过，
      //   而两个不相干工作区恰好互为祖先的情形会落进①（都认得出来、不相同）被逮住。
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
          // 同一个工作区根但快照是别处的残留 → 也必刷
          if (isPollutedSnapshot(s.snapshot, cwd, s.cwd)) { try { log('warn', 'dock.rehydrate', { sidHash: dswsLogHash(sid), cwdChanged: false, polluted: true }) } catch (eL) {}; loadSnapshot(s, false, true); loadChain(s, false); return true }
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
        // 污染自愈：手上这份快照若是别的工作区留下的残影（工作区根对不上，或认不出根时仓库名对不上），强制后台刷新。
        // #653：判定收进 isPollutedSnapshot 一份口径，本文件两处调用它；旧那条「互为祖先就放行」的白名单已删。
        const isPolluted = isPollutedSnapshot(s.snapshot, s.cwd, s.cwd)
        if (isPolluted) { try { log('warn', 'dock.rehydrate', { sidHash: dswsLogHash(sid), cwdChanged: false, polluted: true }) } catch (eL) {}; loadSnapshot(s, false); loadChain(s, false); return }
        if (!snapFresh(s)) loadSnapshot(s, false); loadChain(s, false)
      }, [sid, summaryCwd, s.cwd, s.snapshot && s.snapshot.workspaceRoot, s.snapshot && s.snapshot.repository && s.snapshot.repository.name, s.snapshot && s.snapshot.repo && s.snapshot.repo.name])
      }
