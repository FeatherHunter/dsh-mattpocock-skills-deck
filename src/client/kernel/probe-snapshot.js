/**
 * src/client/kernel/probe-snapshot.js — 内核模块（#456 由 probe.js 拆出之颜色时间小函数、配置广播、快照差异与快照加载）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    export const pendingSnapshotByCwd = new Map() // Map<工作区键+后端,{promise,controller,backendId,seq}> dedup 30s（#653：按工作区根去重；#669 第 5 件：键里再带后端 —— 换过后端就不是同一次请求，见 kernel/probe-stale.js）
    // #491 房外埋点 helpers（同一闭包拼回后全内核文件可见；只记散列与计数，渲染路径不用）：
    const dswsLogHash = function (s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
    const dswsScrubHits = {}
    const dswsScrubN = { n: 0 }
    const dswsDiskSnapHitN = { n: 0 } // #498 磁盘快照命中采样计数（百一采样，只增不显）
    const dswsLogTrunc = function (s, n, field) { try { const t = String(s || ''); if (t.length <= n) return t; try { const k = String(field || 'text') + ':T' + n; dswsScrubHits[k] = (dswsScrubHits[k] || 0) + 1; dswsScrubN.n += 1; if (dswsScrubN.n % 50 === 0 && isEnabled('debug')) log('debug', 'privacy.scrub', { field: String(field || 'text'), rule: 'T' + n, hit: true }) } catch (e) {} return t.slice(0, n) } catch (e) { return '' } }
    const dswsDedupWin = { n: 0 }
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
      // effort 维度：差异索引按票身份 (effort, 编号) 键入，否则不同 effort 的同号地图互相顶掉、变更探测不到
      const idx = function (snap) { const m = {}; snap.maps.forEach(function (x) { m[idOf(x)] = x }); return m }
      const a = idx(oldS), b = idx(newS)
      // 子票级变化：逐票对比（新增/变更标 issueFlash；任一变化 → 该 map 计入 changed，map 详情视图增量）
      //   字段实证（#458 核验）：map 子票在快照里是 tickets（非 issues）；票级变化 = state/progress/claimedBy/labels
      Object.keys(b).forEach(function (n) {
        if (!a[n]) { out.added.push(n); return }
        var x = a[n], y = b[n]
        var sub = false
        var ix = {}; (x.tickets || []).forEach(function (i) { ix[idOf(i)] = i })
        var iy = {}; (y.tickets || []).forEach(function (i) { iy[idOf(i)] = i })
        Object.keys(iy).forEach(function (k) {
          if (!ix[k]) { sub = true; out.issueFlash[k] = 'added'; return }
          var a2 = ix[k], b2 = iy[k]
          if (a2.state !== b2.state || a2.progress !== b2.progress || a2.claimedBy !== b2.claimedBy || lbl(a2) !== lbl(b2) || String(a2.updatedAt || '') !== String(b2.updatedAt || '')) { sub = true; out.issueFlash[k] = 'changed' }
        })
        if (Object.keys(ix).length !== Object.keys(iy).length) sub = true
        if (x.state !== y.state || x.title !== y.title || lbl(x) !== lbl(y) || sub) out.changed.push(n)
      })
      // #255 · 孤儿票（根票）对比 —— 右侧主列表行闪烁的数据源补口：原实现只遍历 maps 子票，
      // 根票（parentKey=null）任何变化都不产 rowFlash；且把核心字段 updatedAt 纳入比较元组——
      // GitHub 加评论会 bump updated_at，probe 索引（STATE|updated_at）判 changed 触发静默重建后，
      // 闪烁由本差异真实产出（重求值推进，无乐观假设）。
      const ia = {}; if (oldS && Array.isArray(oldS.issues)) oldS.issues.forEach(function (i) { if (i) ia[idOf(i)] = i })
      const iy0 = {}; if (newS && Array.isArray(newS.issues)) newS.issues.forEach(function (i) { if (i) iy0[idOf(i)] = i })
      Object.keys(iy0).forEach(function (k) {
        if (!ia[k]) { out.added.push(k); return }
        var xa = ia[k], ya = iy0[k]
        if (xa.state !== ya.state || xa.title !== ya.title || lbl(xa) !== lbl(ya) || String(xa.updatedAt || '') !== String(ya.updatedAt || '')) out.changed.push(k)
      })
      Object.keys(ia).forEach(function (k) { if (!iy0[k]) out.removed.push(k) })
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
    // 收下 wf.cwd 顺手带回来的工作区根（2026-09-19 加）。做两件事：
    //   ① 记进 store：面板头部那枚归属标志就能在快照到达之前先画出来（它原先只能等一整份仓库快照）；
    //   ② 记进那张「所选目录 → 工作区根」的表（原样用于显示、折算键用于比较），别的抽屉按工作区根分桶时也能早点对齐。
    //   空值什么都不做 —— 这条路上「不知道」就是不知道，不拿空串去顶替一个根。
    export const rememberSessionWorkspaceRoot = function (st, root) {
      try {
        const raw = String(root == null ? '' : root).trim()
        if (!st || !raw) return
        st.sessionWorkspaceRoot = raw
        if (st.cwd) rememberWorkspaceRoot(st.cwd, raw)
      } catch (eR) {}
    }
    // 快照（#346：面板数据源；force 走 wf.refresh 全量重建；wf.snapshot 侧 5s 缓存）
    // #58 缓存优先：按 cwd 内存快照 + 空 cwd 同步，避免首开空 cwd 探路 miss 缓存导致 100-400ms 闪 loading
    export const loadSnapshot = function (st, force, silent) {
      const doLoad = async function () {
        // #370 次要观察：force 刷新时跳过 snapLoading 守卫（加载中点击「刷新」不再 no-op）
        // #669 第 5 件：在途复用（含「换过后端就不复用」「force 不复用非 force」两条判据）都判在 kernel/probe-stale.js。
        const _reuse = _snapReuseInFlight(st, force)
        if (_reuse) return _reuse
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
            const ent = await diskGetSnapshot(wsKeyOf(st.cwd || ''))
            if (ent && ent.snapshot && !st.snapshot && !getCachedSnapshot(st.cwd)) {
              try {
                setCachedSnapshot(st.cwd, ent.snapshot)
                try { if (ent.lastProbeAt && ent.lastProbeAt > getProbeAt(st.cwd)) lastProbeAtByCwd.set(wsKeyOf(st.cwd), ent.lastProbeAt) } catch (ePA2) {}
                hydrateFromCache(st)
                emit(st)
              } catch (eHyd2) {}
              try { dswsDiskSnapHitN.n += 1; if (isEnabled('debug') && dswsDiskSnapHitN.n % 100 === 0) log('debug', 'client.snapshot.hit', { keyHash: dswsLogHash(wsKeyOf(st.cwd || '')), ageMs: Date.now() - ((ent && (ent.ts || (ent.snapshot && ent.snapshot.generatedMs))) || Date.now()), kind: 'disk' }) } catch (eL) {}
              hasCache = !!(st.snapshot || getCachedSnapshot(st.cwd))
            }
          } catch (eDisk) {}
        }
        try { if (!hasCache && !(st.snapshot || getCachedSnapshot(st.cwd))) log('info', 'client.snapshot.miss', { keyHash: dswsLogHash(wsKeyOf(st.cwd || '')), reason: 'empty' }) } catch (eL) {}
        st.snapLoading = true
        // v1.5 T9：silent（后台静默刷新）不显示加载遮罩、不弹错误 toast
        // #58 缓存优先：已有缓存（含磁盘命中）时不显示全屏 loading，静默刷新
        if (force && !silent && !hasCache) st.snapMode = 'loading'
        emit(st)
        const ver = (typeof getSnapshotVersion==='function'? getSnapshotVersion(st.cwd):'') || (st.snapshot&&st.snapshot.version)||'';
        // #669 第 6 件（ADR 20260921）：只有用户亲手选过的那条才当 hint 上报 —— 派生值不许冒充意图
        //   （宿主那边带 hint 就压过锚文件，见 store-prefs.js 的 userHintOf 与 ADR 的攻击 1）。
        const _hintBid = (typeof userHintOf === 'function') ? userHintOf(st.selection) : undefined
        const args = Object.assign({}, st.cwd ? { cwd: st.cwd, ifNoneMatch: ver, version: ver } : (ver?{ifNoneMatch:ver,version:ver}:{}), _hintBid ? { backendId: _hintBid } : {})
        const _normKeyP = wsKeyOf(st.cwd||'');
        let _ctrl=null; try{ _ctrl=typeof AbortController!=='undefined'?new AbortController():{signal:{aborted:false},abort(){}}; }catch(e){ _ctrl={signal:{aborted:false},abort(){}}; }
        let _timer=null;
        const callT0 = Date.now()
        const callMethod = force ? 'wf.refresh' : 'wf.snapshot'
        // #653 日志纪律：发起这条跨边界调用前先记一行，与收到回包时那一行配成一对（按需级，先判开关）
        try { if (isEnabled('debug')) log('debug', 'host.call', { method: callMethod, kind: force ? 'refresh' : 'snapshot', ok: true, latencyMs: 0 }) } catch (eL) {}
        const _rawP = force ? host.call('wf.refresh', args) : host.call('wf.snapshot', args);
        const _timeoutP = new Promise((_,rej)=>{ _timer=setTimeout(()=>{ try{_ctrl.abort();}catch{}; rej(new Error('client loadSnapshot timeout 30s')); },30000); });
        const p = Promise.race([_rawP, _timeoutP]).finally(function(){ try{clearTimeout(_timer);}catch{}; });
        // #669 第 5 件：登记这一次请求（序号 + 这次问的后端 + 在途键），发出去就记（判据见 kernel/probe-stale.js）。
        const _mine = _snapMarkRequest(st)
        try{ pendingSnapshotByCwd.set(_mine.pendKey,{promise:p, controller:_ctrl, force: !!force, backendId: _mine.reqBackend, seq: _mine.seq}); p.finally(function(){ try{ const cur=pendingSnapshotByCwd.get(_mine.pendKey); if(cur && cur.promise===p) pendingSnapshotByCwd.delete(_mine.pendKey);}catch{} }); }catch(e){}
        const _reqNorm = _normKeyP // capture request cwd for H2 stale discard
        // #653：宿主这次回话里带的工作区根，先记进工作区键表——本会话与同工作区的其它会话随后都按它分桶。
        //   不管 ok 与否都记：它是宿主算出来的事实，与这份快照能不能装没有关系。
        return p.then(function (snap) {
          try { if (snap && snap.workspaceRoot) rememberWorkspaceRoot(st.cwd, snap.workspaceRoot) } catch (eWr) {}
          try { const okSnap = !!(snap && (snap.ok === true || snap.notModified === true || snap.status === 304)); const callKind = force ? 'refresh' : 'snapshot'; if (okSnap) log('info', 'host.call', { method: callMethod, latencyMs: Date.now() - callT0, ok: true, kind: callKind }); else log('warn', 'host.call.fail', { method: callMethod, kind: callKind, errorHash: dswsLogHash(dswsLogTrunc(String((snap && snap.error) || 'snapshot-failed'), 120, 'error')) }) } catch (eL) {}
          // #327 特性 A：对该工作区完成了一次检查（成功/304/串台落地均算——请求已真实发出并返回）→ 时间走针
          try { if (snap && (snap.ok === true || snap.notModified === true || snap.status === 304)) touchProbeAt(_normKeyP) } catch (ePA) {}
          // fix H2 stale discard — if 工作区根 switched during flight, drop stale fallback (gate flake guard)
          const _curNorm = wsKeyOf(st.cwd||'');
          if (_reqNorm !== _curNorm) {
            // #232 R4 · 在途结果必须落地：请求发出时该工作区正被观看，响应到达即写内存 LRU 缓存，
            // 切回时 hydrateFromCache 秒显最新数据（零新请求）。仍不给换视图后的 store 直接 emit
            // （#45 串台回归防线不动）；setCachedSnapshot 自带 ok/maps 守卫，坏形自然丢弃。
            // #653：这里的键是请求发出时的那把工作区键，不是会话所选目录——跨会话复用的正是它。
            try { setCachedSnapshot(_reqNorm, snap) } catch (e232r4) {}
            st.snapLoading = false
            try{ const cur2=pendingSnapshotByCwd.get(_mine.pendKey); if(cur2 && cur2.promise===p) pendingSnapshotByCwd.delete(_mine.pendKey);}catch(e){}
            return
          }
          // #669 第 5 件：换过后端的这一份不算数（或已经不是这把键上最新的一次）—— 照装的话，
          //   面板会从刚切过去的后端退回切换前那个，用户看到的就是「点了确认没反应」（判据见 probe-stale.js）。
          if (_snapRespStale(_reqNorm, _mine.seq, _mine.reqBackend, st)) {
            try { if (isEnabled('debug')) log('debug', 'snapshot.stale.drop', { keyHash: dswsLogHash(_reqNorm) }) } catch (eDrop) {}
            st.snapLoading = false; emit(st); return
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
            if (_df.issueFlash) Object.keys(_df.issueFlash).forEach(function (k) { st.issueFlash[k] = _df.issueFlash[k] })
            // R5 视觉：有变化才提示 + 定时清除高亮（防堆积）
            if (_df.removed.length) flash(st, tr('panel.diffRemoved', { n: _df.removed.length }), 'info')
            scheduleFlashClear(st)
            st.snapshot = snap
            // #635：这份快照如果是「保存前就发出去、保存后才回来」的那一次刷新拿回来的，它不知道刚改过的
            // 标签颜色，装进来就会把面板倒回旧色。装进来之后先按那次保存确认过的色值补一遍，
            // 补的规则与记录都住在 views/labels/labelColorPatch.js（比那份记录旧才补，新的就作废记录）。
            try { if (typeof lcApplySavedColorsOnInstall === 'function') lcApplySavedColorsOnInstall(st, st.snapshot) } catch (eLC) {}
            st.snapMode = 'real'
            st.snapError = null
            // #155：同步 selection/repository 镜像
            try { if (typeof applySnapshotSelection === 'function') applySnapshotSelection(st, snap) } catch {}
            // #58 缓存优先：落内存表，供新会话秒开 — suspicious fallback 不污染缓存
            // #653：这里从前会先把同一份快照按 snap.repoRoot 存一把、再按所选目录存一把（两把键，两个桶），
            //   子目录会话与根会话因此各看各的。现在 setCachedSnapshot 自己按工作区键（wsKeyOf）落，
            //   只需要一次调用，同一工作区天然同桶。
            try {
              const nxt = snap.selection
              const cur = st.selection
              const isSuspicious = !!(nxt && nxt.backendId===null && !nxt.pending && nxt.source==='fallback' && cur && cur.backendId)
              if (!isSuspicious) {
                setCachedSnapshot(st.cwd, snap)
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
          try { log('warn', 'host.call.fail', { method: callMethod, kind: force ? 'refresh' : 'snapshot', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}
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
          // 这条电话从 2026-09-19 起顺手带回「这个会话的工作区根」。先收下它：面板头部那枚归属标志
          //   只要这一个值，收下就能在下面那份快照到达之前先画出来（缓存没命中时快照要等几十秒）。
          try { if (res && res.workspaceRoot) rememberSessionWorkspaceRoot(st, res.workspaceRoot) } catch (eR) {}
          if (res && res.ok && res.cwd && !st.cwd) { st.cwd = res.cwd; hydrateFromCache(st); emit(st) }
          return doLoad()
        }).catch(function () { return doLoad() })
      }
      // cwd 已经有了的常见情形：这条电话本来不一定会走，但工作区根值得单独问一次 —— 它很便宜
      //   （宿主侧 30 秒缓存），而且是那枚标志唯一的早到来源。拿到了就重画一次；拿不到什么都不做，
      //   界面上不会因为这一条失败而出现任何变化。
      //   只问一次（记在 store 的 _wsRootAsked 上）：万一宿主那一版还不回这个字段，也不至于每次开面板都多一问。
      if (st.cwd && st.sessionId && !st.sessionWorkspaceRoot && !st._wsRootAsked && typeof host !== 'undefined' && typeof host.call === 'function') {
        st._wsRootAsked = true
        try {
          host.call('wf.cwd', { sessionId: st.sessionId }).then(function (res) {
            if (res && res.workspaceRoot) { rememberSessionWorkspaceRoot(st, res.workspaceRoot); emit(st) }
          }).catch(function () {})
        } catch (eAsk) {}
      }
      return doLoad()
    }
