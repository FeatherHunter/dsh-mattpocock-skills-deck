/**
 * src/client/kernel/probe-snapshot.js — 内核模块（#456 由 probe.js 拆出之颜色时间小函数、配置广播、快照差异与快照加载）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    export const pendingSnapshotByCwd = new Map() // Map<工作区键+后端,{promise,controller,backendId,seq}> dedup 30s（#653：按工作区根去重；#669 第 5 件：键里再带后端 —— 换过后端就不是同一次请求，见 kernel/probe-stale.js）
    // #727：这一次快照请求的落地状态。带上它是为了给「迟到的成功回包」划一条界线 ——
    //   正常那一路已经跑过之后，迟到的这一份一个字节都不许重复装（同一个工作区两边同时就绪是会碰上的）。
    //   判据与落地在 kernel/probe-select.js，读写都在本文件这一行与那里的迟到处理器之间。
    export const _snapInstallState = { handedOff: false }
    // #1009 收口（2026-10-10）：只留一条「界面耐心」30 秒，不再按「手上有没有画面」分两档。
    //   为什么删掉冷启动那一档：分档判据选错了信号 —— 「有没有画面」不等于「这次要等多久」；
    //   2026-09-24 那个现场是「磁盘快照已有画面、重建要几分钟」，按该判据仍是热档，照样早放手。
    //   删档只丢「等待体感」，不丢能力：迟到的结果仍会落地（判据与落地在 kernel/probe-select.js）。
    //   超时原文回到固定串，散列 246ae7f1 与文档的对应关系继续成立。
    export const SNAP_WAIT_MS = 30000
    // #491 房外埋点 helpers（同一闭包拼回后全内核文件可见；只记散列与计数，渲染路径不用）：
    const dswsLogHash = function (s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
    const dswsScrubHits = {}
    const dswsScrubN = { n: 0 }
    const dswsDiskSnapHitN = { n: 0 } // #498 磁盘快照命中采样计数（百一采样，只增不显）
    const dswsLogTrunc = function (s, n, field) { try { const t = String(s || ''); if (t.length <= n) return t; try { const k = String(field || 'text') + ':T' + n; dswsScrubHits[k] = (dswsScrubHits[k] || 0) + 1; dswsScrubN.n += 1; if (dswsScrubN.n % 50 === 0 && isEnabled('debug')) log('debug', 'privacy.scrub', { field: String(field || 'text'), rule: 'T' + n, hit: true }) } catch (e) {} return t.slice(0, n) } catch (e) { return '' } }
    const dswsDedupWin = { n: 0 }
    // #707 拆出：颜色小函数（hexA / darken）、数据层增量差异 diffSnapshots、高亮清除 scheduleFlashClear
    //   都搬去了 kernel/probe-snapshot-helpers.js（本文件当时已 349 行、门禁上限 350，没有下脚的地方）。
    //   三样东西的行为一行没改，拼接顺序保证同一个闭包里前后可见；拼接标记在 src/client/index.js 里。
    // #727：这一趟取数里有三处与「子目录会话的第一帧」直接相关，判据与理由都在 kernel/probe-select.js
    //   （本文件贴着上限，所以那一段的文字放在那边）：
    //     ① 进工作区时补问一次 wf.selection（askSelectionOnce，本文件末尾那行接线）；
    //     ② 超时之后那份回包迟到时的落地口（_installLateSnapshot，本文件里那行 _rawP.then 接线）；
    //     ③ 回包过期判据换成「按请求发出时那条目录比」（_snapRequestKeyWas，就是下面 H2 那一处守卫）。

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
    // #490 client 日志底座：开关变更广播（与 broadcastCfg 同构：共享与全组逐个走访并逐个发出更新； 开关值本身只存一份（logSwitch 内存与 dsws.debug 本地），广播只为让各会话界面刷新）。
    export const broadcastLogSwitch = function () {
      const applyTo = function (st) {
        if (!st) return
        emit(st)
      }
      applyTo(shared)
      Object.keys(stores).forEach(function (k) { applyTo(stores[k]) })
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
    // #707：切进工作区的那一瞬间要先用旧快照铺满（定稿第十章、票面验收的「目标 ≤100 毫秒」），再上报
    //   「我在看谁」。hydrateFromCache 是同步的（内存里那份快照），宿主那条电话是异步的 —— 先同步铺满
    //   就一定发生在异步上报之前，与谁先谁后无关。已有内容时不覆盖它（那是用户正在看的画面）。
    export const cacheFirstThenAttend = function (st, kind) {
      try {
        const had = !!(st && (st.snapshot || getCachedSnapshot(st.cwd || '')))
        if (st && typeof hydrateFromCache === 'function') { if (hydrateFromCache(st) && !had) emit(st) }
      } catch (eHyd) {}
      try { if (typeof reportWorkspaceAttention === 'function') reportWorkspaceAttention(st, kind, null) } catch (eAt) {}
      return st
    }
    // 快照（#346：面板数据源；force 走 wf.refresh 全量重建；wf.snapshot 侧 5s 缓存）
    // #58 缓存优先：按 cwd 内存快照 + 空 cwd 同步，避免首开空 cwd 探路 miss 缓存导致 100-400ms 闪 loading
    export const loadSnapshot = function (st, force, silent) {
      // #727（I2 的表达面）：这一趟取数还没回话之前，「这个工作区用哪个后端」是「还不知道」，不是「没有设置」
      //   —— 记在会话上，状态栏那条横幅据此改说「正在读取」（StatusBar 的 _selReading）。为什么放在最外层：
      //   在途复用那条早退（_snapReuseInFlight）之后就没有第二次登记的机会了，而它同样意味着「有取数正飞着」。
      //   清掉它的地方两处：回包处理完（含失败与超时）、以及迟到的回包落地时。
      try { if (!(st.selection && st.selection.backendId)) st.selPending = true } catch (ePend) {}
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
        // #776 只加日志不改行为：记下这次打开走缓存三选一的哪一支（有缓存还是现拉）。
        //   按需级，先判开关；每次取数一次，低频，不采样。
        try { if (isEnabled('debug')) log('debug', 'input.observe', { kind: 'cache-choice', count: hasCache ? 1 : 0, latencyMs: 0, keyHash: dswsLogHash(wsKeyOf(st.cwd || '')) }) } catch (eCc) {}
        st.snapLoading = true
        // v1.5 T9：silent（后台静默刷新）不显示加载遮罩、不弹错误 toast
        // #58 缓存优先：已有缓存（含磁盘命中）时不显示全屏 loading，静默刷新
        if (force && !silent && !hasCache) st.snapMode = 'loading'
        emit(st)
        const ver = (typeof getSnapshotVersion==='function'? getSnapshotVersion(st.cwd):'') || (st.snapshot&&st.snapshot.version)||'';
        // #669 第 6 件（ADR 20260921）：只有用户亲手选过的那条才当 hint 上报 —— 派生值不许冒充意图
        //   （宿主那边带 hint 就压过锚文件，见 store-prefs.js 的 userHintOf 与 ADR 的攻击 1）。
        const _hintBid = (typeof userHintOf === 'function') ? userHintOf(st.selection) : undefined
        const _hintRev = (typeof baseRevOf === 'function') ? baseRevOf(st.selection) : 0 // #683（F1 · ADR 的 R2）：hint 旁边带上「这条选择是从哪个修订号来的」，宿主才判得出新旧
        const args = Object.assign({}, st.cwd ? { cwd: st.cwd, ifNoneMatch: ver, version: ver } : (ver?{ifNoneMatch:ver,version:ver}:{}), _hintBid ? { backendId: _hintBid, baseRev: _hintRev } : {})
        const _normKeyP = wsKeyOf(st.cwd||'');
        let _ctrl=null; try{ _ctrl=typeof AbortController!=='undefined'?new AbortController():{signal:{aborted:false},abort(){}}; }catch(e){ _ctrl={signal:{aborted:false},abort(){}}; }
        let _timer=null;
        const callT0 = Date.now()
        const callMethod = force ? 'wf.refresh' : 'wf.snapshot'
        // #653 日志纪律：发起这条跨边界调用前先记一行，与收到回包时那一行配成一对（按需级，先判开关）
        try { if (isEnabled('debug')) log('debug', 'host.call', { method: callMethod, kind: force ? 'refresh' : 'snapshot', ok: true, latencyMs: 0 }) } catch (eL) {}
        const _rawP = force ? host.call('wf.refresh', args) : host.call('wf.snapshot', args);
        // #1009 收口：只等上面那一条 30 秒。超时原文是固定串（散列 246ae7f1），不按等待时长拼。
        const _waitMs = SNAP_WAIT_MS
        const _timeoutP = new Promise((_,rej)=>{ _timer=setTimeout(()=>{ try{_ctrl.abort();}catch{}; rej(new Error('client loadSnapshot timeout 30s')); }, _waitMs); });
        const p = Promise.race([_rawP, _timeoutP]).finally(function(){ try{clearTimeout(_timer);}catch{}; });
        // #669 第 5 件：登记这一次请求（序号 + 这次问的后端 + 在途键），发出去就记（判据见 kernel/probe-stale.js）。
        const _mine = _snapMarkRequest(st)
        try{ pendingSnapshotByCwd.set(_mine.pendKey,{promise:p, controller:_ctrl, force: !!force, backendId: _mine.reqBackend, seq: _mine.seq}); p.finally(function(){ try{ const cur=pendingSnapshotByCwd.get(_mine.pendKey); if(cur && cur.promise===p) pendingSnapshotByCwd.delete(_mine.pendKey);}catch{} }); }catch(e){}
        const _reqNorm = _normKeyP // capture request cwd for H2 stale discard
        // #1009：死线只结束「这一次等待」，不判「这份结果作废」—— 已经发出去的请求，回来时只要还是这把键上
        //   最新的一次、后端没换过、工作区没真的换走，就把**整份**装上（#727 那版只补 selection 与仓库引用
        //   那一小块；真机上更常见的后果是宿主辛苦拿回来的那份被丢掉、下一次还得整趟重跑）。判据与落地都在
        //   kernel/probe-select.js（本文件只留这一行接线）。
        _rawP.then(function (lateSnap) { try { _installLateSnapshot(st, lateSnap, _reqNorm, _mine) } catch (eLate) {} }, function () { try { if (typeof _snapRespStale !== 'function' || !_snapRespStale(_reqNorm, _mine.seq, _mine.reqBackend, st)) { st.snapPending = false; emit(st) } } catch (eLateFail) {} });
        // #653：宿主这次回话里带的工作区根，先记进工作区键表——本会话与同工作区的其它会话随后都按它分桶。
        //   不管 ok 与否都记：它是宿主算出来的事实，与这份快照能不能装没有关系。
        return p.then(function (snap) {
          if (_snapInstallState) _snapInstallState.handedOff = true // #727：正常那一路跑过了，迟到的处理器从此只认「不重复装」
          _mine.done = true // #1009：那道判据收窄到「**这一次**请求装过没有」—— 更早的请求装过，不挡这一份迟到结果落地
          try { if (snap && snap.workspaceRoot) rememberWorkspaceRoot(st.cwd, snap.workspaceRoot) } catch (eWr) {}
          try { const okSnap = !!(snap && (snap.ok === true || snap.notModified === true || snap.status === 304)); const callKind = force ? 'refresh' : 'snapshot'; if (okSnap) log('info', 'host.call', { method: callMethod, latencyMs: Date.now() - callT0, ok: true, kind: callKind }); else log('warn', 'host.call.fail', { method: callMethod, kind: callKind, errorHash: dswsLogHash(dswsLogTrunc(String((snap && snap.error) || 'snapshot-failed'), 120, 'error')) }) } catch (eL) {}
          // #327 特性 A：对该工作区完成了一次检查（成功/304/串台落地均算——请求已真实发出并返回）→ 时间走针
          try { if (snap && (snap.ok === true || snap.notModified === true || snap.status === 304)) touchProbeAt(_normKeyP) } catch (ePA) {}
          // fix H2 stale discard — if 工作区根 switched during flight, drop stale fallback (gate flake guard)
          // #727：这把尺子换成「请求发出时」那条目录（判据见下面这段末尾与 kernel/probe-select.js 的 _snapRequestKeyWas）。
          const _curNorm = wsKeyOf(st.cwd||'');
          if (_curNorm !== _reqNorm && !_snapRequestKeyWas(_reqNorm, st)) {
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
          try { st.snapPending = false } catch (ePendOk) {}
          if (snap && (snap.notModified===true || snap.status===304)) {
            // 304 zero emit per spec: version unchanged -> keep old table, no UI change
            st.snapLoading=false;
            // #683（F1 · ADR 的 R4）：304 也要合并权威选择 —— 「只换了后端、快照内容一个字没变」正是这条路的现场：版本号没变所以这里什么都不做，于是面板头与状态栏继续显示旧后端，而同屏的链与横幅（走 wf.detect）已经按新值答了。宿主这一版回包里带着 {selection, rev}，这里合并它。
            try { if (snap.selection && typeof mergeSelection === 'function') { if (mergeSelection(st, snap.selection)) emit(st) } } catch (eSel) {}
            try { if (snap.setupLayout && typeof setCachedSetupLayout === 'function') setCachedSetupLayout(st.cwd, snap.setupLayout) } catch (eSL) {} // #683（F1 · R6）：304 也回填记住的布局（版本号没变不代表布局没变）
            // still touch LRU ts via setCachedSnapshot? keep old
            emit(st); // minimal tick for probe freshness but no data change
            return;
          }
          if (snap && snap.ok === true && Array.isArray(snap.maps)) {
            // #1009：装快照那一整段搬去 kernel/probe-select.js 的 _snapInstallBody —— 正常那一路与迟到那一路
            //   共用同一处，免得两处各写一遍、判据（缓存优先落表、补标签颜色、回填布局）迟早长岔。
            _snapInstallBody(st, snap)
          } else {
            st.snapMode = 'err'
            st.snapError = (snap && snap.error) ? String(snap.error).slice(0, 160) : tr('err.snapshotEmpty')
            // #715：这次取数失败，把「是哪一种失败」一起收下 —— 判据由宿主看真实读数分好类
            //   （wf.snapshot 回包的 failKind：配额被别人耗尽 / 插件自己的取数失败），界面只翻成两句不同的话。
            st.snapFail = { kind: (snap && snap.failKind === 'quota-exhausted') ? 'quota-exhausted' : 'fetch-failed', at: Date.now() }
            if (force && !silent) flash(st, tr('toast.snapFail', { err: st.snapError }), 'warn')
          }
          emit(st)
        }).catch(function (e) {
          try { _mine.gaveUp = true } catch (eGave) {}
          try { log('warn', 'host.call.fail', { method: callMethod, kind: force ? 'refresh' : 'snapshot', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}
          st.snapLoading = false
          // #1009 收口：放弃等待时立一面诚实旗子 —— 30 秒到点界面会说失败，可活还在跑；
          //   有这面旗子，提示语改说「仍在等，拿到后自动更新」，不再把「没等到」说成「失败了」。
          //   迟到落地或真失败时清掉（落地那两处在 kernel/probe-select.js，迟到失败在上面那行 late 口）。
          try {
            const _msg = String((e && e.message) || e)
            if (_msg.indexOf('client loadSnapshot timeout') >= 0) st.snapPending = true
            else st.snapPending = false
          } catch (ePend2) {}
          // #727：这一次等待到此为止（超时也算）——「在途」这个理由不再成立，横幅回到原来那套判据上。
          //   注意这里只结束「等待」：那份回包若后来还是回来了，由上面的迟到处理器收下（#1009 起整份落地）。
          if (st.selPending === true) st.selPending = false
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
      // #707：老会话与直接进面板这两条常见路径也要先铺满、再上报「我在看谁」。
      //   放在这里（而不是更早）是因为此刻工作区根已经能拿到（hydrateFromCache 顺路把缓存里的根收进来）。
      try { cacheFirstThenAttend(st, 'panel-open') } catch (eAtt) {}
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
      // #727（I1）：进工作区时若还不知道这个工作区用哪个后端，补问一次宿主那条专用电话（wf.selection）。
      //   为什么放在这里：这一刻 cwd 已经是最终值（上面两条补齐 cwd 的路都走完了），而「等那份完整快照」
      //   在大工作区上要几分钟 —— 一条几十字节的事实不该搭那趟车。幂等、限次、失败不弹提示，判据全在
      //   kernel/probe-select.js 的 askSelectionOnce 里（本文件只留这一行接线）。
      try { if (typeof askSelectionOnce === 'function') askSelectionOnce(st) } catch (eSelAsk) {}
      return doLoad()
    }
