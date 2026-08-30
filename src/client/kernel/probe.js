/**
 * src/client/kernel/probe.js — 内核模块（阶段 2 内核迁移 · #96 T3）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    // #228/#284 链渲染器主机侧数据：wf.chain 全链快照（通用链 + 后端链，按后端动态，refresh 联动）
    // #284 迁移：九格目录视图（wf.status/checks）退役，全部读数点位改从链快照派生。
    // #284 修订（对抗式审查 2026-08-28）：并发门——同 cwd 同轮次的 in-flight 请求复用；
    //   面板多组件（ChecksTab/StatusBar/Dock）挂载并发调用不再重复触发 25 名技能探测与 gh 网络调用。
    const _chainInflightByCwd = new Map()
    export const loadChain = function(st, force){
      if (typeof host === 'undefined' || typeof host.call !== 'function') return Promise.resolve(null)
      // 链共享键 = 工作区键 + 后端 id（#324），确保按工作区单次求值且按后端隔离
      const _backendIdForChain = (st.selection && st.selection.backendId) || ''
      const norm = (typeof getChainCacheKey === 'function' ? getChainCacheKey(st.cwd, _backendIdForChain) : ((typeof keyOf === 'function' ? keyOf(st.cwd) : String(st.cwd||'')) + '|' + String(_backendIdForChain)))
      if (!force) {
        const inflight = _chainInflightByCwd.get(norm)
        if (inflight) return inflight
        // 链共享缓存命中即秒显（#324 新会话首见即秒显）
        try {
          const cached = (typeof getCachedChain === 'function' ? getCachedChain(st.cwd, _backendIdForChain) : null)
          if (cached) {
            st.chainSnapshot = cached
            st.chain = cached.chain || cached
            st.fullChain = cached.fullChain || null
            st.backendChain = cached.backendChain || null
            st.chainLoadedAt = (typeof nowStr === 'function' ? nowStr() : '')
            // 已秒显则不发请求，直接返回
            // 但仍需让调用方感知已就绪，返回已解析的 promise
            return Promise.resolve(cached)
          }
        } catch (eCache) {}
      }
      // 2026-08-28 修复（后端物理隔离）：链的后端段必须与 UI 当前绑定的后端一致——
      //   此前只传 cwd，host 回退到 detect 自产的 selection（默认 github），导致 markdown 工作区出现 GitHub 检查行。
      const args = Object.assign({}, st.cwd ? { cwd: st.cwd } : {}, (st.selection && st.selection.backendId) ? { backendId: st.selection.backendId } : {}, force ? { force:true } : {})
      const p = host.call('wf.chain', args).then(function(res){
        if (res && res.ok && (res.fullSnapshot || res.snapshot)) {
          const snap = res.fullSnapshot || res.snapshot
          st.chainSnapshot = snap
          st.chain = res.chain
          st.fullChain = res.fullChain || null
          st.chainResolved = res.resolved
          st.backendChain = res.backendChain || null
          st.chainLoadedAt = nowStr()
          // 落共享缓存，供同工作区其他会话秒显
          try { if (typeof setCachedChain === 'function') setCachedChain(st.cwd, _backendIdForChain, snap) } catch(eSet){}
          emit(st)
          return snap
        }
        return null
      }).catch(function(e){ return null }).finally(function(){ try { _chainInflightByCwd.delete(norm) } catch (e) {} })
      if (!force) _chainInflightByCwd.set(norm, p)
      return p
    }
    export const pendingSnapshotByCwd = new Map() // Map<normCwd,{promise,controller}> dedup 30s
    // 单源工作区键（#301 / #324）：全库仅一份 keyOf（shared:workspaceKey），此处已无重复定义
    // ---- 链快照派生读数（#284：单一口径，链步骤即检查项）----
    export const chainSteps = (st) => (st && st.chainSnapshot && Array.isArray(st.chainSnapshot.steps)) ? st.chainSnapshot.steps : []
    export const chainStep = (st, id) => chainSteps(st).find(function (s) { return String(s.id) === String(id) }) || null
    export const chainStepStatus = (st, id) => { const s = chainStep(st, id); return s ? s.status : 'pending' }
    export const chainStepOk = (st, id) => chainStepStatus(st, id) === 'done'
    export const chainStepBad = (st, id) => { const sts = chainStepStatus(st, id); return sts === 'current' || sts === 'fail' }
    // #229 计数口径：pending（诚实未知/未接入）不渲染置灰计入、不计入分子分母
    export const readyCount = (st) => { const cs = chainSteps(st).filter(function (s) { return s.status !== 'pending' }); return cs.length ? cs.filter(function (s) { return s.status === 'done' }).length : -1 }
    export const envTotal = (st) => { const cs = chainSteps(st).filter(function (s) { return s.status !== 'pending' }); return cs.length }
    // v14-22：返回纯数字串（'6/9' / '--/9'），由状态栏 num() 固定宽度渲染；分母 = 非待定步数（动态）
    export const envLabel = (st) => { const n = readyCount(st); const t = envTotal(st); if (t <= 0) return '--'; return n < 0 ? '--/' + t : n + '/' + t }
    export const setupCheck = (st) => chainStep(st, 'tracker:initialized')

    // #370：blockerNames 只列「仍 OPEN」的阻塞者（GitHub 依赖边在阻塞者关闭后仍保留，需按状态过滤）
    export const openBlockers = (t, m) => t.blockedBy.filter(function (b) {
      const bt = m.tickets.find(function (x) { return x.number === b })
      return bt !== undefined && bt.state === 'OPEN'
    })
    export const blockerNames = (t, m) => openBlockers(t, m).map(function (b) {
      const bt = m.tickets.find(function (x) { return x.number === b })
      return bt ? bt.title : ('#' + b)
    }).join('；')

    // v10：从会话快照探测当前工作目录（ConversationSnapshot 字段名多探几个）
    export const detectCwd = function (ss) {
      try {
        if (ss && typeof ss === 'object') {
          for (const k of ['cwd', 'workspacePath', 'projectPath', 'path', 'dir', 'root']) {
            if (typeof ss[k] === 'string' && ss[k]) return ss[k]
          }
        }
      } catch (e) { /* 探测失败走 host 默认 */ }
      return ''
    }
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
          // 同 cwd 在途复用：新调用方挂载后从共享缓存水合，不再发第二份请求
          return _pend.promise.then(function(snap){
            // 在途结果已落 per-cwd 缓存（首发方 then 中 setCachedSnapshot），此处仅水合当前 store
            try{ hydrateFromCache(st); emit(st); }catch(eHyd){}
            return snap;
          }).catch(function(e){ throw e; });
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
        try{ pendingSnapshotByCwd.set(_normKeyP,{promise:p, controller:_ctrl}); p.finally(function(){ try{ pendingSnapshotByCwd.delete(_normKeyP);}catch{} }); }catch(e){}
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
            try{ pendingSnapshotByCwd.delete(_normKeyP)}catch(e){}
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
    // #232 · 已验证脏信号专用短窗探针 —— 宿主重求值命中差值后触发，1.2s 合并突发多写，
    //   区别于动作长窗（8s，供 UI 动作后使用）。两窗并存：短窗先行收敛，长窗兜底重复探测
    //   无害（probe 为轻量单查）；最终刷新仍必须经 wf.probe changed 判定，不引入乐观路径。
    export const DIRTY_PROBE_DEBOUNCE_MS = ((typeof SYNC === 'object' && SYNC && SYNC.DIRTY_PROBE_DEBOUNCE_MS) || 1200)
    export let _dirtyProbePending = false
    export const scheduleDirtyProbe = function () {
      if (_dirtyProbePending) return
      _dirtyProbePending = true
      if (timer === undefined) { _dirtyProbePending = false; return }
      timer.timeout(function () {
        // #232 R3 · 同上：脏信号成立的余波回到可见态后由栅格首拍重新喂入，此处不再对藏页发起。
        try { if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') { _dirtyProbePending = false; return } } catch (e232dg) {}
        _dirtyProbePending = false
        probeNow(false)
      }, DIRTY_PROBE_DEBOUNCE_MS)
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
      var p1 = (typeof loadChain === 'function' ? loadChain(st, true).catch(function(){}) : Promise.resolve())
      var p2 = loadSnapshot(st, true, true)
      var p3 = Promise.resolve()
      spinAll(true)
      emit(st)
      Promise.all([p1, p2]).then(function () {
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