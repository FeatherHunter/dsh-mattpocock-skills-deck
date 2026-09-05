/**
 * src/client/kernel/probe-snapshot.js — 内核模块（#456 由 probe.js 拆出之颜色时间小函数、配置广播、快照差异与快照加载）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    export const pendingSnapshotByCwd = new Map() // Map<normCwd,{promise,controller}> dedup 30s
    // v11：label 用 GitHub 配置色渲染 —— hex → rgba（.18 背景），无效 hex 返回 null 走兜底
    export const hexA = function (hex, a) {
      try {
        const hh = String(hex || '').replace('#', '')
        if (!/^[0-9a-fA-F]{6}$/.test(hh)) return null
        const r = parseInt(hh.slice(0, 2), 16), g = parseInt(hh.slice(2, 4), 16), b = parseInt(hh.slice(4, 6), 16)
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'
      } catch (e) { return null }
    }
    // v14-18：hex → HSL 亮度下调 amt（0-1）→ hex（chips 边框比 label 色深一档）
    export const darken = function (hex, amt) {
      try {
        const hh = String(hex || '').replace('#', '')
        if (!/^[0-9a-fA-F]{6}$/.test(hh)) return null
        const r = parseInt(hh.slice(0, 2), 16) / 255, g = parseInt(hh.slice(2, 4), 16) / 255, b = parseInt(hh.slice(4, 6), 16) / 255
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
        const l = (mx + mn) / 2
        let hue = 0, sat = 0
        if (mx !== mn) {
          const d = mx - mn
          sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
          if (mx === r) hue = ((g - b) / d + (g < b ? 6 : 0))
          else if (mx === g) hue = ((b - r) / d + 2)
          else hue = ((r - g) / d + 4)
          hue *= 60
        }
        const l2 = Math.max(0, l - amt)
        const hue2rgb = function (p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p }
        const q2 = l2 < 0.5 ? l2 * (1 + sat) : l2 + sat - l2 * sat
        const p2 = 2 * l2 - q2
        const rr = Math.round(hue2rgb(p2, q2, hue / 360 + 1 / 3) * 255)
        const gg = Math.round(hue2rgb(p2, q2, hue / 360) * 255)
        const bb = Math.round(hue2rgb(p2, q2, hue / 360 - 1 / 3) * 255)
        return '#' + ((1 << 24) + (rr << 16) + (gg << 8) + bb).toString(16).slice(1)
      } catch (e) { return null }
    }

    // ============================================================
    // 4. 文本生成 + 复制/注入
    // ============================================================
    export const nowStr = () => {
      try { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') } catch (e) { return '' }
    }
    // 定稿 1A：时间固定格式 MM-DD HH:MM（本地）
    export const timeOf = (snap) => {
      if (!snap) return ''
      try {
        const ms = (typeof snap.generatedMs === 'number' && snap.generatedMs) || Date.parse(snap.updatedAt || '')
        if (!ms) return ''
        const d = new Date(ms)
        return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
      } catch (e) { return '' }
    }
    // #327 特性 A：同格式的毫秒重载（状态栏「上次探测时间」用——数据不变也走针）
    export const timeOfMs = (ms) => {
      if (!ms) return ''
      try { const d = new Date(ms); return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') } catch (e) { return '' }
    }
    // ============================================================
    // 4. 配置广播（v25-50：配置保存后同步所有会话 store 的面板尺寸；外观定死不广播）
    // ============================================================
    export const broadcastCfg = function () {
      const applyTo = function (st) {
        if (!st) return
        st.size = { w: st.size ? st.size.w : 460, h: Math.max(240, Math.round((window.innerHeight || 800) * 0.5)) }
        emit(st)
      }
      applyTo(shared)
      Object.keys(stores).forEach(function (k) { applyTo(stores[k]) })
    }
    // #490 client 日志底座：开关变更广播（与 broadcastCfg 同构：共享与全组逐个走访并逐个发出更新；
    //   开关值本身只存一份（logSwitch 内存与 dsws.debug 本地），广播只为让各会话界面刷新）。
    export const broadcastLogSwitch = function () {
      const applyTo = function (st) {
        if (!st) return
        emit(st)
      }
      applyTo(shared)
      Object.keys(stores).forEach(function (k) { applyTo(stores[k]) })
    }

    // v1.5 T10 R4（用户拍板）：数据层增量 diff —— 变更/新增/删除 按票号对比（含 map 子票级变化），
    //   多视图（列表/map详情/状态栏计数/过滤结果）数据驱动自动增量；diff 结果供 R5 视觉消费
    export const diffSnapshots = function (oldS, newS) {
      try{ if(oldS&&newS&&oldS.version&&newS.version&&oldS.version===newS.version) return {added:[],removed:[],changed:[],issueFlash:{},ts:Date.now(),skipped:true}; }catch(e){}
      const out = { added: [], removed: [], changed: [], issueFlash: {}, ts: Date.now() }
      if (!oldS || !oldS.ok || !Array.isArray(oldS.maps)) return out
      if (!newS || !newS.ok || !Array.isArray(newS.maps)) return out
      const lbl = function (x) { return (x.labels || []).map(function (l) { return typeof l === 'string' ? l : l.name }).sort().join(',') }
      const idx = function (snap) { const m = {}; snap.maps.forEach(function (x) { m[x.number] = x }); return m }
      const a = idx(oldS), b = idx(newS)
      // 子票级变化：逐票对比（新增/变更标 issueFlash；任一变化 → 该 map 计入 changed，map 详情视图增量）
      //   字段实证（#458 核验）：map 子票在快照里是 tickets（非 issues）；票级变化 = state/progress/claimedBy/labels
      Object.keys(b).forEach(function (n) {
        if (!a[n]) { out.added.push(Number(n)); return }
        var x = a[n], y = b[n]
        var sub = false
        var ix = {}; (x.tickets || []).forEach(function (i) { ix[i.number] = i })
        var iy = {}; (y.tickets || []).forEach(function (i) { iy[i.number] = i })
        Object.keys(iy).forEach(function (k) {
          if (!ix[k]) { sub = true; out.issueFlash[Number(k)] = 'added'; return }
          var a2 = ix[k], b2 = iy[k]
          if (a2.state !== b2.state || a2.progress !== b2.progress || a2.claimedBy !== b2.claimedBy || lbl(a2) !== lbl(b2) || String(a2.updatedAt || '') !== String(b2.updatedAt || '')) { sub = true; out.issueFlash[Number(k)] = 'changed' }
        })
        if (Object.keys(ix).length !== Object.keys(iy).length) sub = true
        if (x.state !== y.state || x.title !== y.title || lbl(x) !== lbl(y) || sub) out.changed.push(Number(n))
      })
      // #255 · 孤儿票（根票）对比 —— 右侧主列表行闪烁的数据源补口：原实现只遍历 maps 子票，
      // 根票（parentKey=null）任何变化都不产 rowFlash；且把核心字段 updatedAt 纳入比较元组——
      // GitHub 加评论会 bump updated_at，probe 索引（STATE|updated_at）判 changed 触发静默重建后，
      // 闪烁由本差异真实产出（重求值推进，无乐观假设）。
      const ia = {}; if (oldS && Array.isArray(oldS.issues)) oldS.issues.forEach(function (i) { if (i && i.number != null) ia[i.number] = i })
      const iy0 = {}; if (newS && Array.isArray(newS.issues)) newS.issues.forEach(function (i) { if (i && i.number != null) iy0[i.number] = i })
      Object.keys(iy0).forEach(function (k) {
        if (!ia[k]) { out.added.push(Number(k)); return }
        var xa = ia[k], ya = iy0[k]
        if (xa.state !== ya.state || xa.title !== ya.title || lbl(xa) !== lbl(ya) || String(xa.updatedAt || '') !== String(ya.updatedAt || '')) out.changed.push(Number(k))
      })
      Object.keys(ia).forEach(function (k) { if (!iy0[k]) out.removed.push(Number(k)) })
      return out
    }
    // R5：高亮定时清除（防堆积；一次只排一个 timer）
    export let _flashClearPending = false
    export const scheduleFlashClear = function (st) {
      if (_flashClearPending) return
      _flashClearPending = true
      if (timer === undefined) { _flashClearPending = false; return }
      timer.timeout(function () {
        _flashClearPending = false
        st.rowFlash = {}
        st.issueFlash = {}
        emit(st)
      }, 2600)
    }
    // 快照（#346：面板数据源；force 走 wf.refresh 全量重建；wf.snapshot 侧 5s 缓存）
    // #58 缓存优先：按 cwd 内存快照 + 空 cwd 同步，避免首开空 cwd 探路 miss 缓存导致 100-400ms 闪 loading
    export const loadSnapshot = function (st, force, silent) {
      const doLoad = async function () {
        // #370 次要观察：force 刷新时跳过 snapLoading 守卫（加载中点击「刷新」不再 no-op）
        try{ const _nk=keyOf(st.cwd||''); const _pend=pendingSnapshotByCwd.get(_nk); if(_pend&&_pend.promise) {
          // #366 修复：force 不复用非 force 的在途请求——手动刷新必须走到 wf.refresh
          const _shouldReuse = !force || _pend.force === true;
          if (_shouldReuse) {
            // 同 cwd 在途复用：新调用方挂载后从共享缓存水合，不再发第二份请求
            return _pend.promise.then(function(snap){
              // 在途结果已落 per-cwd 缓存（首发方 then 中 setCachedSnapshot），此处仅水合当前 store
              try{ hydrateFromCache(st); emit(st); }catch(eHyd){}
              return snap;
            }).catch(function(e){ throw e; });
          }
        } }catch(e){}
        // fix H1: remove global snapLoading guard — rely on per-cwd pendingSnapshotByCwd dedup (gate flake, #diagnosing-bugs)
        if (typeof host === 'undefined' || typeof host.call !== 'function') {
          st.snapMode = 'err'
          st.snapError = tr('err.hostUnavailable')
          emit(st)
          return Promise.resolve()
        }
        // #58 先水合 per-cwd 缓存，实现秒开
        hydrateFromCache(st)
        let hasCache = !!(st.snapshot || getCachedSnapshot(st.cwd))
        // #327 特性 B · 多级缓存：内存未命中先查磁盘（IndexedDB）——命中即秒显旧数据，随后照常发起网络校验
        //（不出现可见加载态；磁盘读约几十毫秒，先读后发请求的次序天然避免遮罩闪现）
        if (!hasCache) {
          try {
            const ent = await diskGetSnapshot(keyOf(st.cwd || ''))
            if (ent && ent.snapshot && !st.snapshot && !getCachedSnapshot(st.cwd)) {
              try {
                setCachedSnapshot(st.cwd, ent.snapshot)
                try { if (ent.lastProbeAt && ent.lastProbeAt > getProbeAt(st.cwd)) lastProbeAtByCwd.set(keyOf(st.cwd), ent.lastProbeAt) } catch (ePA2) {}
                hydrateFromCache(st)
                emit(st)
              } catch (eHyd2) {}
              hasCache = !!(st.snapshot || getCachedSnapshot(st.cwd))
            }
          } catch (eDisk) {}
        }
        st.snapLoading = true
        // v1.5 T9：silent（后台静默刷新）不显示加载遮罩、不弹错误 toast
        // #58 缓存优先：已有缓存（含磁盘命中）时不显示全屏 loading，静默刷新
        if (force && !silent && !hasCache) st.snapMode = 'loading'
        emit(st)
        const ver = (typeof getSnapshotVersion==='function'? getSnapshotVersion(st.cwd):'') || (st.snapshot&&st.snapshot.version)||'';
        // 2026-08-28 方案B：客户端持久化选择随快照上报——detect 在主锚无结论时优先采纳（用户选择 > 自动识别）
        const args = Object.assign({}, st.cwd ? { cwd: st.cwd, ifNoneMatch: ver, version: ver } : (ver?{ifNoneMatch:ver,version:ver}:{}), (st.selection && st.selection.backendId) ? { backendId: st.selection.backendId } : {})
        const _normKeyP = keyOf(st.cwd||'');
        let _ctrl=null; try{ _ctrl=typeof AbortController!=='undefined'?new AbortController():{signal:{aborted:false},abort(){}}; }catch(e){ _ctrl={signal:{aborted:false},abort(){}}; }
        let _timer=null;
        const _rawP = force ? host.call('wf.refresh', args) : host.call('wf.snapshot', args);
        const _timeoutP = new Promise((_,rej)=>{ _timer=setTimeout(()=>{ try{_ctrl.abort();}catch{}; rej(new Error('client loadSnapshot timeout 30s')); },30000); });
        const p = Promise.race([_rawP, _timeoutP]).finally(function(){ try{clearTimeout(_timer);}catch{}; });
        try{ pendingSnapshotByCwd.set(_normKeyP,{promise:p, controller:_ctrl, force: !!force}); p.finally(function(){ try{ const cur=pendingSnapshotByCwd.get(_normKeyP); if(cur && cur.promise===p) pendingSnapshotByCwd.delete(_normKeyP);}catch{} }); }catch(e){}
        const _reqNorm = _normKeyP // capture request cwd for H2 stale discard
        return p.then(function (snap) {
          // #327 特性 A：对该工作区完成了一次检查（成功/304/串台落地均算——请求已真实发出并返回）→ 时间走针
          try { if (snap && (snap.ok === true || snap.notModified === true || snap.status === 304)) touchProbeAt(_normKeyP) } catch (ePA) {}
          // fix H2 stale discard — if cwd switched during flight, drop stale fallback (gate flake guard)
          const _curNorm = keyOf(st.cwd||'');
          if (_reqNorm !== _curNorm) {
            // #232 R4 · 在途结果必须落地：请求发出时该 cwd 正被观看，响应到达即写 per-cwd LRU 缓存，
            // 切回时 hydrateFromCache 秒显最新数据（零新请求）。仍不给换视图后的 store 直接 emit
            // （#45 串台回归防线不动）；setCachedSnapshot 自带 ok/maps 守卫，坏形自然丢弃。
            try { setCachedSnapshot(_reqNorm, snap) } catch (e232r4) {}
            st.snapLoading = false
            try{ const cur2=pendingSnapshotByCwd.get(_normKeyP); if(cur2 && cur2.promise===p) pendingSnapshotByCwd.delete(_normKeyP);}catch(e){}
            return
          }
          st.snapLoading = false
          if (snap && (snap.notModified===true || snap.status===304)) {
            // 304 zero emit per spec: version unchanged -> keep old table, no UI change
            st.snapLoading=false;
            // still touch LRU ts via setCachedSnapshot? keep old
            emit(st); // minimal tick for probe freshness but no data change
            return;
          }
          if (snap && snap.ok === true && Array.isArray(snap.maps)) {
            // v1.5 T10 R4：数据层增量 diff（新旧快照对比）—— 供多视图增量与 R5 视觉
            st.lastDiff = diffSnapshots(st.snapshot, snap)
            st.rowFlash = {}
            st.issueFlash = {}
            var _df = st.lastDiff
            _df.added.forEach(function (n) { st.rowFlash[n] = 'added' })
            _df.changed.forEach(function (n) { st.rowFlash[n] = 'changed' })
            if (_df.issueFlash) Object.keys(_df.issueFlash).forEach(function (k) { st.issueFlash[Number(k)] = _df.issueFlash[k] })
            // R5 视觉：有变化才提示 + 定时清除高亮（防堆积）
            if (_df.removed.length) flash(st, tr('panel.diffRemoved', { n: _df.removed.length }), 'info')
            scheduleFlashClear(st)
            st.snapshot = snap
            st.snapMode = 'real'
            st.snapError = null
            // #155：同步 selection/repository 镜像
            try { if (typeof applySnapshotSelection === 'function') applySnapshotSelection(st, snap) } catch {}
            // #58 缓存优先：落 per-cwd 内存表，供新 store 秒开 — suspicious fallback 不污染缓存
            try {
              const nxt = snap.selection
              const cur = st.selection
              const isSuspicious = !!(nxt && nxt.backendId===null && !nxt.pending && nxt.source==='fallback' && cur && cur.backendId)
              if (!isSuspicious) {
                const c = snap.repoRoot || st.cwd; if (c) setCachedSnapshot(c, snap)
                if (st.cwd) setCachedSnapshot(st.cwd, snap)
              }
            } catch (e) { /* 忽略 */ }
            // 拉取 backendModules（若 snapshot 未带，则另调 registry）
            try {
              if (!st.backendModules && typeof host !== 'undefined' && host.call) {
                host.call('wf.registry', { cwd: st.cwd }).then(function(r){
                  if (r && r.ok && Array.isArray(r.modules)) { st.backendModules = r.modules; try{ setPresentationMap(r.modules) }catch{}; emit(st) }
                }).catch(function(){})
              }
            } catch {}
            // v1.5 T10：启动自动变化探测（幂等；快照就绪后生效）
            startAutoProbe()
            // v1.5 B5 修订：磁盘缓存秒开（fromCache）→ 不再 400ms 强制全量刷新。
            //   原逻辑每次打开面板 = 1 次额外 wf.refresh（aliases 大查询 ≈ 18 GraphQL 点），
            //   多仓库会话下成倍放大；变化检测已由低频 probe（5min + focus 限流）接管，
            //   磁盘缓存本身是最新全量快照，秒开直接展示即可，无需立即重建。
          } else {
            st.snapMode = 'err'
            st.snapError = (snap && snap.error) ? String(snap.error).slice(0, 160) : tr('err.snapshotEmpty')
            if (force && !silent) flash(st, tr('toast.snapFail', { err: st.snapError }), 'warn')
          }
          emit(st)
        }).catch(function (e) {
          st.snapLoading = false
          st.snapMode = 'err'
          st.snapError = String((e && e.message) || e).slice(0, 160)
          if (force && !silent) flash(st, tr('toast.snapFail', { err: st.snapError }), 'warn')
          emit(st)
        })
      }
      // #58 若 cwd 仍空且可同步补齐，先补 cwd 再加载，避免空 cwd miss 磁盘缓存
      if (!st.cwd) {
        const sync = getCwdSync(st.sessionId)
        if (sync) { st.cwd = sync; hydrateFromCache(st) }
      }
      if (!st.cwd && st.sessionId && typeof host !== 'undefined' && typeof host.call === 'function') {
        return host.call('wf.cwd', { sessionId: st.sessionId }).then(function (res) {
          if (res && res.ok && res.cwd && !st.cwd) { st.cwd = res.cwd; hydrateFromCache(st); emit(st) }
          return doLoad()
        }).catch(function () { return doLoad() })
      }
      return doLoad()
    }
