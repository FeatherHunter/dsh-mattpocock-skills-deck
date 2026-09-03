/**
 * src/client/kernel/store-snapshot.js — 内核模块（#455 由 store.js 拆出之存储核、快照与链缓存、水合与提醒）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    export const makeStore = () => ({
      open: false, tab: 'list', activeMap: null, activeIssue: null,
      issueCache: {}, issueMode: 'idle', issueError: null, issueDetail: null, issueCommentsMoreLoading: false, issueCommentsFailCount: 0, issueCommentsHasMore: true,
      // #255 评论输入区（受控）：草稿/提交态/分流错误/服务端确认闪烁
      cmtDraft: '', cmtSending: false, cmtError: null, cmtConfirm: null,
      notice: null, injector: null, tick: 0,
      pos: null, size: { w: 460, h: DEFAULT_PANEL_H },
      // 外观定死（用户拍板：图标/动作词不可配置）
      ui: { icon: 'compass', word: '沉淀' },
      snapshot: null,
      selection: null,
      repository: null,
      backendModules: null,
      backendMenuOpen: false,
      backendMenuPos: null,
      cwd: '', lblFilters: [], skillView: 'list', expLabels: false,
      // #374：状态过滤 + 排序（默认 更新时间↓，与现状一致）
      stateFilter: listPrefs.stateFilter, sortKey: listPrefs.sortKey, sortDir: listPrefs.sortDir,
      chainSnapshot: null, chainLoadedAt: '', backendChain: null, fullChain: null,
      snapMode: 'loading', snapError: null, snapLoading: false,
      // T2 HoverTip 迁移（#381）：skillTip 已由 HoverTip 局部 state 统一，移除全局，skillHover 保留用于行高亮（后续可改 CSS :hover 再移除）
      refreshing: false, rowFlash: {}, issueFlash: {}, handoffReady: false, handoffSearching: false, skillsOpen: false, skillHover: null, bugMenuOpen: false, bugMenuHover: false, bugMenuPos: null, skillPopPos: null, expTags: {}, subs: [],
      noRepoCard: { expanded: false, name: '', visibility: 'private', loading: false, error: '', errorKind: '', errorRepoUrl: '' },
      switchConfirm: null,
      gateModalOpen: false, gateSelected: null, gateLoading: false, gateError: '',
    })
    export const shared = makeStore()
    export const stores = {}
    // #58 缓存优先：按 cwd 的内存快照表（新 store 秒开 + 跨会话同 cwd 共享，避免空 cwd 探路 miss）
    // 单源工作区键（#301 / #324）：全库仅一份 keyOf，经 shared:workspaceKey 拼入
    export const SNAP_CWD_LRU_MAX = 20
    export const snapshotByCwd = new Map() // Map<normCwd,{snapshot,version,ts}> LRU20
    export const touchLRUClient = function(map,key,val){ if(map.has(key)) map.delete(key); map.set(key,val); if(map.size>SNAP_CWD_LRU_MAX){ const first=map.keys().next().value; map.delete(first);} return val; }
    export const getCachedSnapshot = function (cwd) { try{ const k=keyOf(cwd); const e=snapshotByCwd.get(k); return e?e.snapshot||e:null; }catch(e){ return null; } }
    export const getCachedEntry = function(cwd){ try{ const k=keyOf(cwd); return snapshotByCwd.get(k)||null; }catch(e){ return null; } }
    export const setCachedSnapshot = function (cwd, snap) { if(!cwd||!snap||snap.ok!==true||!Array.isArray(snap.maps)) return; let s2=snap; if(snap.notModified===true||snap.status===304||snap.cached===true){ // #232 · 落库前剥除响应传输态标记（仅属当次请求，不属缓存实体）
      try{ s2=Object.assign({},snap); delete s2.notModified; delete s2.status; delete s2.cached; }catch(eS){ return } }
      try{ const k=keyOf(cwd); const ver=s2.version||s2.etag||''; const ent={snapshot:s2, version:ver, ts:Date.now(), key:k, lastProbeAt:getProbeAt(k)}; touchLRUClient(snapshotByCwd,k,ent); try{ diskPutSnapshot(k, ent) }catch(eD1){} }catch(e){} }
    export const getSnapshotVersion = function(cwd){ try{ const e=getCachedEntry(cwd); return e?e.version||'':''; }catch(e){ return ''; } }
    // ============ #327 特性 A/B：上次探测时间 + 快照多级缓存（内存→磁盘→网络）============
    export const lastProbeAtByCwd = new Map() // Map<normCwd, ms> —— 对该工作区完成任一次检查（探针/刷新/快照校验）即推进，数据不变也走针
    export const getProbeAt = function (cwd) { try { const v = lastProbeAtByCwd.get(keyOf(cwd)); return v || 0 } catch (e) { return 0 } }
    export const touchProbeAt = function (cwd, ms) {
      try {
        const k = keyOf(cwd); if (!k) return
        lastProbeAtByCwd.set(k, ms || Date.now())
        // 组内全量会话走针：同 cwd 的 shared/stores 全部 emit，状态栏随重渲染取新时间
        try { if (shared.cwd && keyOf(shared.cwd) === k) emit(shared) } catch (e1) {}
        try { Object.keys(stores).forEach(function (kk) { const st2 = stores[kk]; if (st2 && st2.cwd && keyOf(st2.cwd) === k) emit(st2) }) } catch (e2) {}
      } catch (e) {}
    }
    export const SNAP_DISK_CAP = 24
    const _snapDbPromise = (function () {
      try {
        if (typeof window === 'undefined' || !window.indexedDB || !window.indexedDB.open) return null
        return new Promise(function (resolve) {
          let req
          try { req = window.indexedDB.open('dsws-cache', 1) } catch (e0) { resolve(null); return }
          req.onupgradeneeded = function () { try { req.result.createObjectStore('snapshots') } catch (e00) {} }
          req.onsuccess = function () { resolve(req.result) }
          req.onerror = function () { resolve(null) }
          req.onblocked = function () { resolve(null) }
        })
      } catch (e) { return null }
    })()
    // 落盘：fire-and-forget；条目形如 {key, snapshot, version, ts, lastProbeAt}；超出 SNAP_DISK_CAP 按最旧淘汰
    export const diskPutSnapshot = function (k, entry) {
      try {
        if (!_snapDbPromise || !k || !entry) return
        _snapDbPromise.then(function (db) {
          if (!db) return
          try {
            const st = db.transaction('snapshots', 'readwrite').objectStore('snapshots')
            st.put(entry, k)
            const allReq = st.getAll()
            allReq.onsuccess = function () {
              try {
                const rows = (allReq.result || []).filter(function (r) { return r && r.key })
                if (rows.length <= SNAP_DISK_CAP) return
                rows.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0) })
                const kill = rows.slice(0, rows.length - SNAP_DISK_CAP)
                const tx2 = db.transaction('snapshots', 'readwrite').objectStore('snapshots')
                kill.forEach(function (r) { try { tx2.delete(r.key) } catch (e3) {} })
              } catch (eEv) {}
            }
          } catch (eTx) {}
        }).catch(function () {})
      } catch (e) {}
    }
    export const diskGetSnapshot = function (k) {
      try {
        if (!_snapDbPromise || !k) return Promise.resolve(null)
        return _snapDbPromise.then(function (db) {
          if (!db) return null
          return new Promise(function (resolve) {
            try {
              const req = db.transaction('snapshots', 'readonly').objectStore('snapshots').get(k)
              req.onsuccess = function () { try { resolve(req.result || null) } catch (e2) { resolve(null) } }
              req.onerror = function () { resolve(null) }
            } catch (e) { resolve(null) }
          })
        }).catch(function () { return null })
      } catch (e) { return Promise.resolve(null) }
    }
    // 链快照共享缓存（#324 · 键 = 工作区键 + 后端 id，随后端不同，新会话首见即秒显）
    export const CHAIN_CWD_LRU_MAX = 20
    export const chainByCwd = new Map() // Map<keyOf(cwd)+'|'+backendId, {snapshot, ts}>
    export const getChainCacheKey = function(cwd, backendId){ try{ return keyOf(cwd) + '|' + String(backendId||''); }catch(e){ return String(cwd||'')+'|'+String(backendId||''); } }
    export const getCachedChain = function(cwd, backendId){ try{ const k=getChainCacheKey(cwd, backendId); const e=chainByCwd.get(k); return e?e.snapshot:null; }catch(e){ return null; } }
    export const setCachedChain = function(cwd, backendId, snap){ if(!cwd||!snap) return; try{ const k=getChainCacheKey(cwd, backendId); const ent={snapshot:snap, ts:Date.now()}; if(chainByCwd.has(k)) chainByCwd.delete(k); chainByCwd.set(k, ent); if(chainByCwd.size>CHAIN_CWD_LRU_MAX){ const first=chainByCwd.keys().next().value; chainByCwd.delete(first);} }catch(e){} }
    export const hydrateFromCache = function (st) {
      if (!st || !st.cwd) return false
      const c = getCachedSnapshot(st.cwd); try{ if(c){ const _k=keyOf(st.cwd); const _e=snapshotByCwd.get(_k); if(_e) touchLRUClient(snapshotByCwd,_k,_e);} }catch(e){}
      let changed=false
      if (c) {
        // 版本取舍：以最新生成时间者胜（水合与扇出一致，#301 契约）
        const incomingMs = c.generatedMs || 0
        const curMs = (st.snapshot && st.snapshot.generatedMs) || 0
        if (!st.snapshot || incomingMs > curMs) {
          st.snapshot = c
          st.snapMode = 'real'
          st.snapError = null
          st.snapLoading = false
          changed=true
        } else if (st.snapMode !== 'real' && incomingMs === curMs) {
          st.snapMode = 'real'
          st.snapError = null
          changed=true
        } else if (!st.snapshot && c) {
          st.snapshot = c
          st.snapMode = 'real'
          st.snapError = null
          changed=true
        }
        // 同步 selection/repository 镜像（per-cwd）
        // 2026-08-28 审查：快照 selection 合并统一走 mergeSelection——旧快照的 fallback null 不得覆盖新意图（LocalStorage 绑定）
        if (c.selection !== undefined) { if (mergeSelection(st, c.selection)) changed = true }
        if (c.repository !== undefined) { st.repository = c.repository; setCachedRepository(st.cwd, c.repository) }
        // backendModules 缓存
        if (c.backendModules) { st.backendModules = c.backendModules; setPresentationMap(c.backendModules) }
      }
      // selection/repository 单独缓存兜底（snapshot 未命中但 selection 有缓存）
      if (!st.selection) {
        const sel = getCachedSelection(st.cwd)
        if (sel) { st.selection = sel; changed=true }
      }
      if (!st.repository) {
        const rep = getCachedRepository(st.cwd)
        if (rep) { st.repository = rep; changed=true }
      }
      // 链快照共享水合（#324 · 键 = 工作区键 + 后端 id）
      try {
        const backendId = (st.selection && st.selection.backendId) || (c && c.selection && c.selection.backendId) || ''
        const cachedChain = getCachedChain(st.cwd, backendId)
        if (cachedChain && !st.chainSnapshot) {
          st.chainSnapshot = cachedChain
          st.chain = cachedChain.chain || cachedChain
          st.fullChain = cachedChain.fullChain || null
          st.backendChain = cachedChain.backendChain || null
          st.chainLoadedAt = (typeof nowStr === 'function' ? nowStr() : '')
          changed = true
        } else if (cachedChain && st.chainSnapshot) {
          // 已有链但缓存更新：以生成时间或加载时间新者为准
          const curT = st.chainLoadedAt || 0
          const cachedT = (cachedChain.generatedMs || cachedChain.ts || 0)
          // 简化：若不同对象则更新，保持最终一致
          if (cachedChain !== st.chainSnapshot) {
            // 保留选择：若缓存非空则覆盖，确保同工作区链一致
            // 不强制覆盖，避免闪烁，仅当缺失时秒显已处理；扇出时会统一覆盖
          }
        }
      } catch (eChainHydrate) {}
      return changed
    }
    /**
     * 客户端 selection 合并唯一点（2026-08-28 覆盖逻辑审查修正）。
     * 优先级：真相（backendId 非空 / explicit 显式 Other）> 意图（localStorage 持久化绑定）> fallback null 尊重意图 > pending 保留。
     *  - explicit/matches（backendId 非空）：落盘/绑定真相 → 覆盖并写回缓存（意图自愈为真相）
     *  - explicit null（source='explicit'，用户显式无后端逃生舱）：明确意图 → 覆盖
     *  - fallback null（source='fallback'，无锚无匹配）：尊重客户端持久化意图——cur 已选则不覆盖不写缓存；
     *    同时等效承接旧 isSuspiciousFallback 的 idle-refresh flake 防抖（flake 即 fallback null，不覆盖即防抖、不污染 localStorage）
     *  - pending（探测中）：保留现状，不闪
     * @returns {boolean} 是否发生覆盖（changed）
     */
    export const mergeSelection = function (st, incoming) {
      if (!incoming || typeof incoming !== 'object') return false
      if (!incoming.backendId) {
        if (incoming.pending) return false
        if (incoming.source === 'explicit') {
          st.selection = incoming
          if (st.cwd) setCachedSelection(st.cwd, incoming)
          return true
        }
        const cur = st.selection
        if (cur && cur.backendId) return false // fallback null：尊重意图，不覆盖不写缓存
        st.selection = incoming
        if (st.cwd) setCachedSelection(st.cwd, incoming)
        return true
      }
      st.selection = incoming
      if (st.cwd) setCachedSelection(st.cwd, incoming)
      return true
    }
    export const applySnapshotSelection = function (st, snap) {
      if (!st || !snap) return
      if (snap.selection !== undefined) {
        // 2026-08-28 审查：合并语义收口到 mergeSelection——真相>意图>fallback 尊重意图>pending 保留
        mergeSelection(st, snap.selection)
      }
      if (snap.repository !== undefined) {
        const curSel = st.selection
        const nxtSel = snap.selection
        const isSuspiciousFallback2 = !!(nxtSel && nxtSel.backendId===null && !nxtSel.pending && nxtSel.source==='fallback' && curSel && curSel.backendId)
        if (isSuspiciousFallback2) {
          // keep old repository as well
        } else {
          st.repository = snap.repository; if (st.cwd) setCachedRepository(st.cwd, snap.repository)
        }
      }
      if (snap.backendModules) { st.backendModules = snap.backendModules; setPresentationMap(snap.backendModules) }
      if (snap.repository && snap.repository.backend) {
        // 兼容旧 snapshot.repo 字段
        if (!st.snapshot) st.snapshot = snap
      }
    }
    export const getCwdSync = function (sid) {
      try {
        const sessions = ctx.get('sessions')
        if (sessions && sid) {
          try {
            if (sessions.list && typeof sessions.list.getSnapshot === 'function') {
              const snap = sessions.list.getSnapshot()
              const row = snap && snap.byId && snap.byId[sid]
              if (row && typeof row.cwd === 'string' && row.cwd) return row.cwd
            }
          } catch (e2) {}
          if (typeof sessions.get === 'function') {
            const s = sessions.get(sid)
            if (s) {
              const header = s.header || s.meta
              const cwd = header && (header.cwd || header.path || header.worktree || header.projectDir || header.directory)
              if (typeof cwd === 'string' && cwd) return cwd
              const meta = s.meta
              const cwd2 = meta && (meta.cwd || meta.path || meta.worktree || meta.projectDir || meta.directory)
              if (typeof cwd2 === 'string' && cwd2) return cwd2
              if (typeof s.cwd === 'string' && s.cwd) return s.cwd
            }
          }
        }
      } catch (e) { /* 忽略 */ }
      return ''
    }
    export const storeOf = (sid) => {
      if (!sid) { return shared }
      let st = stores[sid]
      if (!st) {
        st = makeStore(); st.sessionId = sid; stores[sid] = st
        // #58 新 store 同步补 cwd 并尝试水合 per-cwd 缓存（秒开）
        if (!st.cwd) {
          const sync = getCwdSync(sid)
          if (sync) st.cwd = sync
        }
        if (st.cwd) hydrateFromCache(st)
      } else {
        // 已有 store 若 cwd 仍空且可同步补齐，立即水合
        if (!st.cwd) {
          const sync = getCwdSync(sid)
          if (sync) { st.cwd = sync; hydrateFromCache(st) }
        }
      }
      return st
    }
    export const emit = (st) => { st.tick++; (st.subs || []).forEach(function (f) { f(st.tick) }) }
    export const sub = (st, f) => { st.subs.push(f); return () => { const i = st.subs.indexOf(f); if (i >= 0) st.subs.splice(i, 1) } }
    export const useStore = (sid) => {
      const st = storeOf(sid)
      const [, set] = React.useState(0)
      React.useEffect(() => sub(st, (n) => set(n)), [st])
      return st
    }
    export const NOTICE_COLOR = { ok: '#4ade80', warn: '#fbbf24', info: '#a1a1aa' }
    export const noticeIcon = (k) => k === 'ok' ? 'check' : k === 'warn' ? 'alert' : 'clipboard'
    export const flash = (st, msg, kind) => {
      st.notice = { text: msg, kind: kind || 'info' }; emit(st)
      if (timer !== undefined) timer.timeout(function () { if (st.notice && st.notice.text === msg) { st.notice = null; emit(st) } }, 2800)
    }
