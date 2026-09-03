/**
 * src/client/kernel/probe-auto.js — 内核模块（#456 由 probe.js 拆出之自动探测节拍、手动刷新与新鲜度）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    // v1.5 R2（#2 MVP · 2026-08-18）：自动刷新 — probe 走 since 时间戳探测全 issue 增量
    //   （#348 + v1.5 T10 B5「配额止血 · 第一性原理」延续）：① probe 降到 60s（用户感知阈值 · R1 是 5min）；
    //   ② changed 只刷新与本次探测 cwd 相同的 store（多仓库会话并发不互串）；
    //   ③ focus 触发限流 ≥60s（窗口来回切换不再疯狂烧）。
    //   与 R1 区别：probe 范围从 `labels=wayfinder:map`（仅地图）扩到 `since=<ISO>`（全 issue，含子票）—— 见 host 侧 `case 'probe'`。
    // #232 · 节拍真源单源化：兜底探针周期由契约层派生（字面量仅作防御性兜底；UI 层不得硬编码知道底层几秒刷一次）
    export const PROBE_MS = ((typeof SYNC === 'object' && SYNC && SYNC.FALLBACK_PROBE_MS) || 60000)
    export const FOCUS_PROBE_MIN_MS = ((typeof SYNC === 'object' && SYNC && SYNC.FOCUS_PROBE_MIN_MS) || 60000)
    export let lastFocusProbe = 0
    // v1.5 T10 R9（Q4 拍板 · DESIGN.md 12.2）：关键动作后延迟探测 —— 完成/执行/交接后面板尽快反映 GitHub 变化；
    //   防抖（一次只排一个）+ 探测本身 1 次轻量 REST，配额安全
    export let _actionProbePending = false
    export const probeNow = function (fromFocus) {
      if (typeof host === 'undefined' || typeof host.call !== 'function') return
      if (fromFocus) {
        const now = Date.now()
        if (now - lastFocusProbe < FOCUS_PROBE_MIN_MS) return
        lastFocusProbe = now
      }
      // #45 修复（2026-08-20）：多工作区异步回调导致右侧面板串台
      // 根因：原实现经 shared（单例）广播新快照到所有 stores（Object.keys(stores).forEach），且 shared.cwd 仅首写，
      //   导致工作区 A 的异步变更（probe changed）把 A 的快照写入 B 的 store，右侧面板“串台”显示非当前工作区内容。
      // 修复：按 cwd 分组隔离 —— 同 cwd 组内共享 1 次 GraphQL（primary load → 余下拷贝），组间零污染；
      //   兜底路径按 sessionId→cwd 精确映射赋值，避免把任意首个 cwd 错绑到所有空 store。
      const refreshGroup = function (cwd) {
        return host.call('wf.probe', { cwd: cwd }).then(function (res) {
          // #327 特性 A：探测完成即走针（无论是否检出变化）
          try { if (res && res.ok) touchProbeAt(cwd) } catch (ePA) {}
          if (!(res && res.ok && res.changed)) return
          const group = []
          const normWanted = keyOf(cwd)
          if (shared.cwd && keyOf(shared.cwd) === normWanted) group.push(shared)
          Object.keys(stores).forEach(function (k) {
            const st = stores[k]
            if (st.cwd && keyOf(st.cwd) === normWanted) group.push(st)
          })
          if (!group.length) {
            // #232 R3 · 应用时刻该 cwd 已无任何 store 持有（用户已切走）：不再为无人观看的工作区
            // 发起 wf.refresh 全量重建（旧兜底 = 一次大查询，违反「非当前工作区不刷新」）。
            // 切回该工作区时由 StatusBar.apply 的加载链路补新鲜度，这里静默放行即可。
            return
          }
          const primary = group[0]
          if (!primary.cwd) primary.cwd = cwd
          const rest = group.slice(1)
          return loadSnapshot(primary, true, true).then(function () {
            const newSnap = primary.snapshot
            if (!newSnap || newSnap.ok !== true || !Array.isArray(newSnap.maps)) return
            rest.forEach(function (st2) {
              st2.lastDiff = diffSnapshots(st2.snapshot, newSnap)
              st2.rowFlash = {}
              st2.issueFlash = {}
              var _df = st2.lastDiff
              _df.added.forEach(function (n) { st2.rowFlash[n] = 'added' })
              _df.changed.forEach(function (n) { st2.rowFlash[n] = 'changed' })
              if (_df.issueFlash) Object.keys(_df.issueFlash).forEach(function (ki) { st2.issueFlash[Number(ki)] = _df.issueFlash[ki] })
              st2.snapshot = newSnap
              st2.snapMode = 'real'
              st2.snapError = null
              scheduleFlashClear(st2)
              emit(st2)
            })
          }).catch(function () { /* 忽略 */ })
        }).catch(function () { /* 探测失败忽略 */ })
      }
      // 按工作区归一键去重（#324 · 同工作区只探一次）
      const cwdsByNorm = new Map()
      const addCwd = function(cwd){ try{ const nk=keyOf(cwd); if(!nk) return; if(!cwdsByNorm.has(nk)) cwdsByNorm.set(nk, cwd); }catch(e){ if(cwd && !Array.from(cwdsByNorm.values()).includes(cwd)) cwdsByNorm.set(String(cwd), cwd); } }
      if (shared.cwd) addCwd(shared.cwd)
      Object.keys(stores).forEach(function (k) {
        const c = stores[k] && stores[k].cwd
        if (c) addCwd(c)
      })
      const cwds = Array.from(cwdsByNorm.values())
      if (!cwds.length) {
        const sids = []
        if (shared.sessionId) sids.push(shared.sessionId)
        Object.keys(stores).forEach(function (k) { if (stores[k].sessionId && sids.indexOf(stores[k].sessionId) < 0) sids.push(stores[k].sessionId) })
        if (!sids.length) return
        Promise.all(sids.map(function (sid) { return host.call('wf.cwd', { sessionId: sid }).catch(function () { return null }) })).then(function (results) {
          const sidToCwd = {}
          const foundCwdsByNorm = new Map()
          for (let i = 0; i < sids.length; i++) {
            const r = results[i]
            if (r && r.ok && r.cwd) {
              sidToCwd[sids[i]] = r.cwd
              try{ const nk=keyOf(r.cwd); if(nk && !foundCwdsByNorm.has(nk)) foundCwdsByNorm.set(nk, r.cwd); }catch(e){ if(foundCwdsByNorm.size===0 || !Array.from(foundCwdsByNorm.values()).includes(r.cwd)) foundCwdsByNorm.set(String(r.cwd), r.cwd); }
            }
          }
          const foundCwds = Array.from(foundCwdsByNorm.values())
          if (!foundCwds.length) return
          Object.keys(stores).forEach(function (k) {
            const st = stores[k]
            if (!st.cwd && st.sessionId && sidToCwd[st.sessionId]) {
              st.cwd = sidToCwd[st.sessionId]
              // #58 空 cwd 补齐后立即水合 per-cwd 缓存，秒开
              if (hydrateFromCache(st)) emit(st)
            }
          })
          if (!shared.cwd && foundCwds.length) {
            shared.cwd = foundCwds[0]
            if (hydrateFromCache(shared)) emit(shared)
          }
          foundCwds.forEach(function (cwd) { refreshGroup(cwd) })
        })
        return
      }
      cwds.forEach(function (cwd) { refreshGroup(cwd) })
    }
    export const scheduleActionProbe = function () {
      if (_actionProbePending) return
      _actionProbePending = true
      if (timer === undefined) { _actionProbePending = false; return }
      timer.timeout(function () {
        // #232 R3 · 发起时刻资格复检：排队期间页签已藏 → 跳过本次发起新扫描；
        // 已发出的在途请求不受影响（R4 由 loadSnapshot 分支保障），恢复通道见 startAutoProbe。
        try { if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') { _actionProbePending = false; return } } catch (e232ag) {}
        _actionProbePending = false
        probeNow(false)
      }, ((typeof SYNC === 'object' && SYNC && SYNC.ACTION_PROBE_WINDOW_MS) || 8000))
    }
    export const startAutoProbe = function () {
      if (shared._probeTimer) return
      // v1.5 R2-fix：跨 reload 清理旧 timer（dev_reload_package 后 JS setInterval 不自动清理，
      //   多个 timer 并行触发 probe 浪费配额）
      if (typeof globalThis !== 'undefined' && globalThis.__dswsOldProbeTimer) {
        try { clearInterval(globalThis.__dswsOldProbeTimer) } catch (e) { /* 忽略 */ }
        globalThis.__dswsOldProbeTimer = null
      }
      shared._probeTimer = setInterval(function () {
        // #232 R3 · 视线门控：页签隐藏（无人在看）时不发起新扫描 —— 非当前工作区零刷新流量。
        // 回到前台由 focus 探针（下方监听，FOCUS_PROBE_MIN_MS 限流）与轮询栅格自然续上（R2 恢复通道）。
        try { if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') return } catch (e232g) {}
        probeNow(false)
      }, PROBE_MS)
      if (typeof globalThis !== 'undefined') globalThis.__dswsOldProbeTimer = shared._probeTimer
      if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('focus', function () { probeNow(true) })
      // #232 · 同一聚焦窗口内切页签不触发 window focus —— 补挂 visibilitychange 作为第二恢复通道
      //   （hidden 期间积压的差值由首拍栅格上报 + 本监听双保险收敛；共用 FOCUS_PROBE_MIN_MS 限流）。
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', function () {
          try { if (document.visibilityState === 'visible') probeNow(true) } catch (e232v) {}
        })
      }
    }

    // v1.5 T10 R7（用户拍板）：手动刷新（状态栏「更新」/ 列表「刷新」/ 检查页「重新检查」）
    //   走静默路径 —— 无全屏遮罩、不禁点；按钮 spinner 即时反馈（命令式 DOM 直操作，不等 React 重渲染）
    //   CSS 动画走合成线程：即使主线程被重渲染占用，转圈照常可见
    export const spinAll = function (on) {
      if (typeof document === 'undefined') return
      try {
        const els = document.querySelectorAll('[data-dsws-host] .dsws-rficon')
        for (let i = 0; i < els.length; i++) els[i].classList.toggle('dsws-spin', on)
      } catch (e) { /* 忽略 */ }
    }
    export const refreshAll = function (st) {
      if (st.refreshing) { try{ st.refreshing=false; spinAll(false); }catch{} }
      // #195 约束：refreshAll 永不因 refreshing 锁死（重查按钮必须有反应）
      st.refreshing = true
      // 先发 RPC（异步即返回），再触发渲染 —— 避免重渲染挡住数据请求
      var _p1Raw = (typeof loadChain === 'function' ? loadChain(st, true).catch(function(){}) : Promise.resolve())
      // #366 补充：链刷新兜底超时，避免宿主链探测卡住导致按钮一直转圈
      var p1 = new Promise(function(resolve){ var _t=setTimeout(function(){ try{ resolve(null); }catch(e){} }, 15000); _p1Raw.then(function(v){ clearTimeout(_t); resolve(v); }).catch(function(){ clearTimeout(_t); resolve(null); }); });
      var p2 = loadSnapshot(st, true, true)
      var p3 = Promise.resolve()
      spinAll(true)
      emit(st)
      Promise.all([p1, p2]).then(function () {
        // #366 修复：强制刷新后扇出到同工作区全组（对齐 probeNow→refreshGroup 的扇出契约）
        try {
          const newSnap = st.snapshot
          if (newSnap && newSnap.ok === true && Array.isArray(newSnap.maps)) {
            const normWanted = (typeof keyOf === 'function' ? keyOf(st.cwd||'') : String(st.cwd||''))
            if (normWanted) {
              const group = []
              try { if (shared && shared.cwd && keyOf(shared.cwd) === normWanted && shared !== st) group.push(shared) } catch(e0){}
              try { Object.keys(stores).forEach(function(k){ const st2=stores[k]; if(st2 && st2.cwd && keyOf(st2.cwd)===normWanted && st2!==st) group.push(st2) }) } catch(e1){}
              group.forEach(function(st2){
                try { st2.lastDiff = diffSnapshots(st2.snapshot, newSnap) } catch(eDiff){}
                st2.rowFlash = {}
                st2.issueFlash = {}
                try {
                  const _df = st2.lastDiff
                  if (_df) {
                    _df.added.forEach(function(n){ st2.rowFlash[n]='added' })
                    _df.changed.forEach(function(n){ st2.rowFlash[n]='changed' })
                    if (_df.issueFlash) Object.keys(_df.issueFlash).forEach(function(k){ st2.issueFlash[Number(k)]=_df.issueFlash[k] })
                    if (_df.removed && _df.removed.length) try{ flash(st2, tr('panel.diffRemoved',{n:_df.removed.length}), 'info') }catch(eFlash){}
                  }
                } catch(e2){}
                st2.snapshot = newSnap
                st2.snapMode = 'real'
                st2.snapError = null
                try{ if(typeof applySnapshotSelection==='function') applySnapshotSelection(st2, newSnap)}catch(eSel){}
                try{ scheduleFlashClear(st2)}catch(eSch){}
                emit(st2)
              })
            }
          }
        } catch(eFan){}
        // 链快照同工作区扇出（#366 补充：refreshAll 同时刷新 chain，保持状态栏与面板链一致）
        try {
          const newChainSnap = st.chainSnapshot
          if (newChainSnap && typeof newChainSnap === 'object') {
            const normWanted2 = (typeof keyOf === 'function' ? keyOf(st.cwd||'') : String(st.cwd||''))
            if (normWanted2) {
              const group2 = []
              try { if (shared && shared.cwd && keyOf(shared.cwd) === normWanted2 && shared !== st && shared.chainSnapshot !== newChainSnap) group2.push(shared) } catch(e0c){}
              try { Object.keys(stores).forEach(function(k){ const st2=stores[k]; if(st2 && st2.cwd && keyOf(st2.cwd)===normWanted2 && st2!==st && st2.chainSnapshot !== newChainSnap) group2.push(st2) }) } catch(e1c){}
              group2.forEach(function(st2){
                try { st2.chainSnapshot = newChainSnap; if(newChainSnap.chain) st2.chain = newChainSnap.chain; if(newChainSnap.fullChain) st2.fullChain = newChainSnap.fullChain; if(newChainSnap.backendChain!==undefined) st2.backendChain = newChainSnap.backendChain; st2.chainLoadedAt = st.chainLoadedAt; emit(st2) } catch(eChain){}
              })
            }
          }
        } catch(eFan2){}
        st.refreshing = false
        spinAll(false)
        emit(st)
      }).catch(function () { st.refreshing = false; spinAll(false); emit(st) })
    }

    // #376：打开面板即保证新鲜 —— 未就绪/失败 → force 加载（有「加载中」反馈）；
    //   已就绪但过期（>60s）→ 触发加载；已就绪且新鲜（≤60s）→ 直接展示不重复请求（配额友好）。
    //   force 不被 snapLoading 守卫丢弃（#370 已修），加载中打开面板最终也会完成并展示。
    export const SNAP_FRESH_MS = ((typeof SYNC === 'object' && SYNC && SYNC.SNAP_FRESH_MS) || 60000)
    export const snapFresh = function (st) {
      if (!st.snapshot || !st.snapshot.generatedMs) return false
      try { return (Date.now() - st.snapshot.generatedMs) <= SNAP_FRESH_MS } catch (e) { return false }
    }
