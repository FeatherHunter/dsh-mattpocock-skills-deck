/**
 * src/client/kernel/store.js — 内核模块（阶段 2 内核迁移 · #96 T3）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    export const DEFAULT_PANEL_H = (function () {
      try { return Math.max(240, Math.round((window.innerHeight || 800) * 0.5)) } catch (e) { return 400 }
    })()
    // #374：主列表偏好（排序/状态过滤）持久化（localStorage 不可用时降级默认值）
    export const LIST_PREFS_KEY = 'dsws.listPrefs'
    export const listPrefs = (function () {
      const d = { sortKey: 'number', sortDir: 'asc', stateFilter: 'all' }
      try {
        const raw = localStorage.getItem(LIST_PREFS_KEY)
        if (raw) return Object.assign(d, JSON.parse(raw))
      } catch (e) { /* 存储不可用用默认 */ }
      return d
    })()
    export const saveListPrefs = function () { try { localStorage.setItem(LIST_PREFS_KEY, JSON.stringify(listPrefs)) } catch (e) {} }
    // #375：label 点击记忆（次数 + 最近点击时间，双键排序）
    export const LABEL_CLICKS_KEY = 'dsws.labelClicks'
    export const labelClicks = (function () {
      try {
        const raw = localStorage.getItem(LABEL_CLICKS_KEY)
        if (raw) { const o = JSON.parse(raw); return (o && typeof o === 'object') ? o : {} }
      } catch (e) { /* 存储不可用降级纯频次 */ }
      return {}
    })()
    export const saveLabelClicks = function () { try { localStorage.setItem(LABEL_CLICKS_KEY, JSON.stringify(labelClicks)) } catch (e) {} }
    // 彻底移除：清理遗留的 dsws.issuePath（v1.7.0 遗留，见 #345 移除落地）
    try { localStorage.removeItem('dsws.issuePath'); } catch (e) {}
    // T2 #35 · 无仓库红卡状态机（按 cwd 维度持久化 dismiss；表单态 expanded/name/visibility/loading/error）
    export const NOREPO_DISMISS_PREFIX = 'dsws:noRepoDismiss:'
    export const cwdHash = function (s) { let h = 0; const t = String(s || ''); for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0; return String(h >>> 0) }
    export const noRepoDismissKey = function (cwd) { return NOREPO_DISMISS_PREFIX + cwdHash(cwd || '') }
    export const isNoRepoDismissed = function (cwd) { try { return localStorage.getItem(noRepoDismissKey(cwd)) === '1' } catch (e) { return false } }
    export const setNoRepoDismissed = function (cwd, v) { try { if (v) localStorage.setItem(noRepoDismissKey(cwd), '1'); else localStorage.removeItem(noRepoDismissKey(cwd)) } catch (e) {} }
    export const cwdBasename = function (cwd) { if (!cwd) return 'repo'; const parts = String(cwd).split(/[\\/]/); for (let i = parts.length - 1; i >= 0; i--) if (parts[i]) return parts[i]; return 'repo' }
    export const isNoRepoNameValid = function (name) { return typeof name === 'string' && name.length >= 1 && name.length <= 100 && /^[A-Za-z0-9._-]+$/.test(name) }
    export const ensureNoRepoCard = function (st) {
      if (!st.noRepoCard) st.noRepoCard = { expanded: false, name: '', visibility: 'private', loading: false, error: '', errorKind: '', errorRepoUrl: '' }
      if (!st.noRepoCard.visibility) st.noRepoCard.visibility = 'private'
      if (st.noRepoCard.errorRepoUrl === undefined) st.noRepoCard.errorRepoUrl = ''
      if (!st.noRepoCard.labelStep) st.noRepoCard.labelStep = { visible: false, repoStr: '', missing: [], have: 0, total: 10, checking: false }
      if (st.noRepoCard.labelStep.visible === undefined) st.noRepoCard.labelStep.visible = false
      return st.noRepoCard
    }
    // T1 #6 · IssueDetail 状态机（与 activeMap 互斥，in-panel 详情页 · v1.7.0）
    export const setActiveMap = function (st, n) {
      const v = (n == null) ? null : Number(n)
      st.activeMap = (v != null && !isNaN(v)) ? v : null
      if (st.activeMap !== null) st.activeIssue = null
      emit(st)
    }
    export const clearActiveMap = function (st) { st.activeMap = null; emit(st) }
    export const setActiveIssue = function (st, n) {
      const v = (n == null) ? null : Number(n)
      st.activeIssue = (v != null && !isNaN(v)) ? v : null
      if (st.activeIssue !== null) st.activeMap = null
      emit(st)
    }
    export const clearActiveIssue = function (st) { st.activeIssue = null; emit(st) }
    export const clearActiveDetail = function (st) { st.activeMap = null; st.activeIssue = null; emit(st) }
    // T2 #7 · fetchIssueDetail 缓存与状态（独立于 snapshot，按 issue 号 60s TTL）
    export const ISSUE_CACHE_TTL = ((typeof SYNC === 'object' && SYNC && SYNC.ISSUE_CACHE_TTL) || 60000)
    // #155：后端选择 per-cwd 状态（权威来自 host snapshot.selection/repository；client 仅镜像乐观）
    // 2026-08-28 修复「反复出现『该工作区还没有设置 — 点击选择后端』」：绑定记忆曾只存内存（selectionByCwd 对象），
    //   DSH 重启/页面刷新后全部丢失；host 侧 registry.byHandle 与 workspaceStore 同样不落盘，唯一落盘锚是
    //   issue-tracker.md 标题——只绑定过而未初始化的工作区，重启后 detect 回 fallback null，
    //   于是每次打开会话都判定「未设置」。现改为 localStorage 持久化（与 listPrefs/labelClicks 同例），
    //   打开会话 hydrate 即恢复绑定，重启不再丢。
    export const selectionByCwd = {}
    export const repositoryByCwd = {}
    export const SELECTION_BY_CWD_KEY = 'dsws.selectionByCwd'
    ;(function () {
      try {
        const raw = localStorage.getItem(SELECTION_BY_CWD_KEY)
        if (raw) { const m = JSON.parse(raw); if (m && typeof m === 'object') { for (const k of Object.keys(m)) { const nk = (typeof keyOf === 'function' ? keyOf(k) : k); if (!(nk in selectionByCwd)) selectionByCwd[nk] = m[k]; else {
          // 已归一键存在：保留现有，旧原始键丢弃
        } } } }
      } catch (e) { /* 存储不可用降级为仅内存 */ }
    })()
    const persistSelectionByCwd = function () { try { localStorage.setItem(SELECTION_BY_CWD_KEY, JSON.stringify(selectionByCwd)) } catch (e) { /* 忽略 */ } }
    export const getCachedSelection = function (cwd) { try { const k = (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd||'')); return cwd ? (selectionByCwd[k] || null) : null } catch(e){ return cwd ? (selectionByCwd[cwd] || null) : null } }
    export const setCachedSelection = function (cwd, sel) { try { const k = (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd||'')); if (cwd && k) { selectionByCwd[k] = sel; persistSelectionByCwd() } } catch(e){ if (cwd) { selectionByCwd[cwd] = sel; persistSelectionByCwd() } } }
    export const getCachedRepository = function (cwd) { try { const k = (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd||'')); return cwd ? repositoryByCwd[k] : null } catch(e){ return cwd ? repositoryByCwd[cwd] : null } }
    export const setCachedRepository = function (cwd, repo) { try { const k = (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd||'')); if (cwd && k) repositoryByCwd[k] = repo } catch(e){ if (cwd) repositoryByCwd[cwd] = repo } }
    export const labelOf = function (backendId) {
      if (backendId == null) return 'Other'
      try {
        const ms = (typeof shared !== 'undefined' && shared && Array.isArray(shared.backendModules)) ? shared.backendModules : null
        if (ms) { for (let _i = 0; _i < ms.length; _i++) { const m = ms[_i]; if (m && m.id === backendId && m.label) return m.label } }
      } catch (_e) {}
      const b = builtinLabelOf(backendId)
      return b || String(backendId)
    }
    // 契约：后端是颜色的单一真源（presentation.color 单值），UI 只做 light-dark 与透明度派生
    export const presentationById = {}
    export const setPresentationMap = function (mods) {
      if (!Array.isArray(mods)) return
      mods.forEach(function (m) {
        if (m && m.id && m.presentation && m.presentation.color) {
          presentationById[m.id] = m.presentation
        }
      })
    }
    // #191：toAdaptive(light, dark) —— dark 缺省按主色勾 oklCH 75% 白派生（机制，非硬编码）
    const toAdaptive = function (light, dark) {
      const l = String(light || '').trim()
      if (!l) return 'light-dark(#57606a, #8b949e)'
      if (l.includes('light-dark')) return l
      const d = String(dark || '').trim()
      if (d.includes('light-dark')) return d
      return 'light-dark(' + l + ', ' + (d || ('color-mix(in oklch, ' + l + ' 75%, white)')) + ')'
    }
    const bgFor = function (adaptiveColor) {
      // 从 adaptive 中取 light 部分派生 bg（12% / 14%），若后端已显式给 bg 则直接用
      // 简化：用 color-mix 派生，保持与 light-dark 同步
      return 'light-dark(color-mix(in srgb, ' + adaptiveColor.replace(/light-dark\(([^,]+),.*\)/, '$1') + ' 12%, transparent), color-mix(in srgb, ' + adaptiveColor.replace(/.*,\s*([^\)]+)\)/, '$1') + ' 14%, transparent))'
    }
    // #191：品牌色纯机制派生——后端经协议层提供 presentation.color（单一真源），
    //   UI 仅做 light-dark 与透明度派生，禁止任何品牌色硬编码（含 github/markdown/gitlab 特判）。
    //   后端未提供品牌色时统一用中性灰（机制兜底，非品牌特判）。
    export const backendColorOf = function (backendId) {
      const p = presentationById[backendId]
      if (p && p.color) return toAdaptive(p.color, p.darkColor)
      return toAdaptive('') // 中性灰兜底
    }
    export const backendBgOf = function (backendId) {
      const p = presentationById[backendId]
      if (p && p.bg) return p.bg
      const ad = toAdaptive(p && p.color ? p.color : '', p && p.darkColor ? p.darkColor : '')
      const light = ad.replace(/light-dark\(([^,]+),.*\)/, '$1')
      const dark = ad.replace(/.*,\s*([^\)]+)\)/, '$1')
      return 'light-dark(color-mix(in srgb, ' + light + ' 12%, transparent), color-mix(in srgb, ' + dark + ' 14%, transparent))'
    }
    export const backendBorderOf = function (backendId) {
      const p = presentationById[backendId]
      if (p && p.border) return p.border
      const ad = toAdaptive(p && p.color ? p.color : '', p && p.darkColor ? p.darkColor : '')
      const light = ad.replace(/light-dark\(([^,]+),.*\)/, '$1')
      const dark = ad.replace(/.*,\s*([^\)]+)\)/, '$1')
      return 'light-dark(color-mix(in srgb, ' + light + ' 30%, transparent), color-mix(in srgb, ' + dark + ' 35%, transparent))'
    }
    export const repoShortName = function (repoRef) {
      if (!repoRef || !repoRef.name) return ''
      const n = String(repoRef.name)
      const parts = n.split(/[\\/]/)
      return parts[parts.length-1] || n
    }
    // #189 · 切换三选一确认态（全局 per-store，复用 wf.bind + 三缓存失效）
    export const DEFAULT_SWITCH_PROMPT_ZH = '现有 issues 保留在原后端，切换后不可见，切回可见'
    // #191 · targetId=null 进入"目标待选"态（仓库名右侧按钮直弹 Modal，target 由 Modal 内 radio 选）
    export const openSwitchConfirm = function (st, targetId) {
      const cur = st.selection ? st.selection.backendId : null
      if (cur == null) return false
      if (targetId != null && cur === targetId) return false
      st.switchConfirm = {
        open: true,
        curBackendId: cur,
        targetBackendId: targetId == null ? null : targetId,
        prompt: DEFAULT_SWITCH_PROMPT_ZH,
        // #191（用户反馈）：打开时不默认选中任何三选一（option=null），
        //   用户选 keep/migrate/clear 任一才可点确认。isTargetPending 已阻断 target 未选。
        option: null,
        clearInput: '',
        criChecks: null,
        criLoading: true,
        confirming: false,
      }
      emit(st)
      if (typeof loadSwitchCri === 'function') loadSwitchCri(st)
      return true
    }
    export const closeSwitchConfirm = function (st) {
      if (!st.switchConfirm) return
      st.switchConfirm.open = false
      emit(st)
      const sc = st.switchConfirm
      setTimeout(function () { if (st.switchConfirm === sc) { st.switchConfirm = null; emit(st) } }, 220)
    }
    export const loadSwitchCri = function (st) {
      const sc = st.switchConfirm
      if (!sc) return
      if (typeof host === 'undefined' || typeof host.call !== 'function') {
        sc.criLoading = false; sc.criChecks = { allOk: false, c1: null, c4: null, c5: null }; emit(st); return
      }
      // #284：CRI 迁移到链快照（wf.chain 全链步骤一步取齐）
      host.call('wf.chain', { cwd: st.cwd || '' }).then(function (res) {
        if (!st.switchConfirm) return
        const snap = (res && (res.fullSnapshot || res.snapshot)) || null
        const steps = (snap && Array.isArray(snap.steps)) ? snap.steps : []
        const byId = function (id) { return steps.find(function (s) { return String(s.id) === String(id) }) || null }
        const c1 = byId('gh:remote')
        const c4 = byId('gh:installed')
        const c5 = byId('gh:authed')
        const ok = function (x) { return !!(x && x.status === 'done') }
        const allOk = ok(c1) && ok(c4) && ok(c5)
        st.switchConfirm.criChecks = { c1: c1, c4: c4, c5: c5, allOk: allOk }
        st.switchConfirm.criLoading = false
        emit(st)
      }).catch(function () {
        if (!st.switchConfirm) return
        st.switchConfirm.criLoading = false
        st.switchConfirm.criChecks = { allOk: false, c1: null, c4: null, c5: null }
        emit(st)
      })
    }
    export const confirmSwitchConfirm = function (st) {
      const sc = st.switchConfirm
      if (!sc || sc.confirming) return
      // #191：目标待选态时 Modal 内未选 target，确认按钮禁用（与 isTargetPending 共用阻断语义）
      if (sc.targetBackendId == null) return
      if (sc.option === 'migrate' && sc.criChecks && !sc.criChecks.allOk) return
      if (sc.option === 'clear' && sc.clearInput !== '确认清空') return
      sc.confirming = true; emit(st)
      const targetId = sc.targetBackendId
      const prevSel = st.selection
      const repoRef = st.repository || (st.snapshot && st.snapshot.repository) || null
      const optimistic = { backendId: targetId, source: 'explicit', ref: repoRef }
      st.selection = optimistic
      try { if (st.cwd) setCachedSelection(st.cwd, optimistic) } catch {}
      emit(st)
      const doFail = function (msg) {
        st.selection = prevSel
        try { if (st.cwd) setCachedSelection(st.cwd, prevSel) } catch {}
        sc.confirming = false; emit(st)
        try { flash(st, tr('switch.bindFail', { err: String(msg).slice(0, 120) }), 'warn') } catch {}
      }
      if (typeof host === 'undefined' || typeof host.call !== 'function') { doFail('host.call 不可用'); return }
      host.call('wf.bind', { cwd: st.cwd || '', backendId: targetId }).then(function (res) {
        const ok = res && (res.ok === true || (res.value && res.value.ok === true) || res.ok)
        if (!ok) { doFail((res && (res.error || res.message)) || 'unknown'); return }
        try { flash(st, tr('switch.bindOk', { label: (typeof labelOf === 'function' ? labelOf(targetId) : String(targetId)) }), 'ok') } catch {}
        // #191（用户反馈修正）：切换后端的本质 = 按新后端初始化，注入 setupRun prompt（与横幅 setup 按钮同源）
        //   让 AI 加载 /setup-matt-pocock-skills 技能；#230（D10）：占位符改由后端描述数据（setupPrompt 键入 locale）填充，UI 不拼装
        try {
          if (typeof setupRunPrompt === 'function') {
            const p = setupRunPrompt(st, targetId)
            if (p && typeof inject === 'function') inject(st, p)
          }
        } catch {}
        closeSwitchConfirm(st)
        try {
          if (typeof loadSnapshot === 'function') loadSnapshot(st, true, true)
          if (typeof loadChain === 'function') loadChain(st, true)
        } catch {}
      }).catch(function (e) { doFail(e && e.message || e) })
    }
    // 方案3（2026-08-28 拍板）：清除后端选择 —— 删除主锚/想重新走选择流程时的逃生舱。
    //   wf.bind(null) = 显式无后端（registry 契约：byHandle 记 null，select ① 回 explicit null），
    //   客户端经 mergeSelection 的 explicit-null 分支覆盖（S6），此后 gate「还没有设置」重新引导。
    export const clearBackendBinding = function (st) {
      if (!st || !st.cwd) return false
      const prev = st.selection
      const nxt = { backendId: null, source: 'explicit' }
      st.selection = nxt
      try { if (st.cwd) setCachedSelection(st.cwd, nxt) } catch {}
      try { if (typeof closeSwitchConfirm === 'function') closeSwitchConfirm(st) } catch {}
      emit(st)
      if (typeof host === 'undefined' || typeof host.call !== 'function') { try { flash(st, tr('switch.bindFail', { err: 'host.call 不可用' }), 'warn') } catch {}; return true }
      host.call('wf.bind', { cwd: st.cwd || '', backendId: null }).then(function (res) {
        const ok = res && (res.ok === true || (res.value && res.value.ok === true) || res.ok)
        if (ok) { try { flash(st, tr('switch.clearBindOk'), 'ok') } catch {} }
        else {
          st.selection = prev
          try { if (st.cwd) setCachedSelection(st.cwd, prev) } catch {}
          emit(st)
          try { flash(st, tr('switch.bindFail', { err: String((res && (res.error || res.message)) || 'unknown') }), 'warn') } catch {}
        }
        try { if (typeof loadSnapshot === 'function') loadSnapshot(st, true, true) } catch {}
        try { if (typeof loadChain === 'function') loadChain(st, true) } catch {}
      }).catch(function (e) {
        st.selection = prev
        try { if (st.cwd) setCachedSelection(st.cwd, prev) } catch {}
        emit(st)
        try { flash(st, '清除失败:' + String((e && e.message) || e).slice(0, 120), 'warn') } catch {}
      })
      return true
    }
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

    // 派生：票务分组（frontier/claimed/blocked/closed）
    export const compute = (st) => {
      const maps = (st.snapshot && Array.isArray(st.snapshot.maps)) ? st.snapshot.maps : []
      return maps.map(function (m) {
        const byNum = {}; m.tickets.forEach(function (t) { byNum[t.number] = t })
        const openBlocker = (b) => { const t = byNum[b]; return t !== undefined && t.state === 'OPEN' }
        const open = m.tickets.filter(function (t) { return t.state === 'OPEN' })
        const closed = m.tickets.filter(function (t) { return t.state === 'CLOSED' })
        const frontier = open.filter(function (t) { return !t.claimedBy && !t.blockedBy.some(openBlocker) })
        const claimed = open.filter(function (t) { return t.claimedBy })
        const blocked = open.filter(function (t) { return !t.claimedBy && t.blockedBy.some(openBlocker) })
        return { m: m, open: open, closed: closed, frontier: frontier, claimed: claimed, blocked: blocked }
      })
    }
    export const frontierAll = (st) => compute(st).reduce(function (n, g) { return n + g.frontier.length }, 0)

    // v18-30：状态栏可接/占用改用「列表 open issue」口径（与面板列表一致）：
    //   可接 = open issue 中未认领且未被 open 阻塞；占用 = 已认领 + 被阻塞；两者之和 = 全部 open issue
    export const openIssuesOf = (st) => ((st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []).filter(function (x) { return x.state !== 'CLOSED' })
    export const isOccupied = function (st, x) {
      if (x.assignees && x.assignees.length) return true
      const maps = (st.snapshot && st.snapshot.maps) || []
      for (let mi = 0; mi < maps.length; mi++) {
        const m = maps[mi]
        if (!m.tickets || !m.tickets.length) continue
        const byNum = {}
        m.tickets.forEach(function (t) { byNum[t.number] = t })
        const t = byNum[x.number]
        if (t && t.blockedBy && t.blockedBy.length) {
          const openBlockers = t.blockedBy.filter(function (b) { const bt = byNum[b]; return bt && bt.state === 'OPEN' })
          if (openBlockers.length) return true
        }
      }
      return false
    }
    export const occCount = (st) => openIssuesOf(st).filter(function (x) { return isOccupied(st, x) }).length
    export const frontierCount = (st) => openIssuesOf(st).length - occCount(st)
    // v1.5 T1：BUG / 诊断计数（open 且带对应标签，与「可接」同口径）
    export const hasLabelOf = function (x, nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
    export const isTriageLike = function (x) { const labs = (x && x.labels) || []; if (!Array.isArray(labs) || labs.length === 0) return true; return labs.some(function (l) { return (typeof l === 'string' ? l : l.name) === 'needs-triage' }) }
    export const bugCount = (st) => openIssuesOf(st).filter(function (x) { return hasLabelOf(x, 'bug') }).length
    export const triageCount = (st) => openIssuesOf(st).filter(function (x) { return isTriageLike(x) }).length

    // v19：共享 —— 标签配置色映射（聚合：快照全量 labels + 票面最终色；票面色已是“查 triage-labels.md 再兜底默认 11 色”后的最终色，不直读 labelPalette）
    export const buildColorOf = function (st) {
      const colorOf = {}
      const snapLabels = (st.snapshot && Array.isArray(st.snapshot.labels)) ? st.snapshot.labels : []
      snapLabels.forEach(function (l) { if (l && l.name && l.color) colorOf[String(l.name).trim()] = String(l.color).trim().replace(/^#/, '') })
      const issues = (st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []
      issues.forEach(function (x) { (x.labels || []).forEach(function (l) { if (l && l.name && l.color) colorOf[String(l.name).trim()] = String(l.color).trim().replace(/^#/, '') }) })
      const maps = (st.snapshot && Array.isArray(st.snapshot.maps)) ? st.snapshot.maps : []
      maps.forEach(function (m) { (m.tickets || []).forEach(function (t) { (t.labels || []).forEach(function (l) { if (l && l.name && l.color) colorOf[String(l.name).trim()] = String(l.color).trim().replace(/^#/, '') }) }) })
      return colorOf
    }
    // T9：行级动作主色计算（与 mkRowAction 共享 · 给新会话按钮复用：与执行按钮同 label 主色）
    export const isLightHex = function (hex) {
      try {
        const hh = String(hex || '').replace('#', '')
        if (!/^[0-9a-fA-F]{6}$/.test(hh)) return false
        const r = parseInt(hh.slice(0, 2), 16), g = parseInt(hh.slice(2, 4), 16), b = parseInt(hh.slice(4, 6), 16)
        return (299 * r + 587 * g + 114 * b) / 1000 > 160
      } catch (e) { return false }
    }
    export const actionColorOf = function (x, colorOf) {
      const has = function (nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
      const bc = function (nm, fb) { const cc = colorOf[nm]; return cc ? '#' + cc : fb }
      const _isTriageLike = !(x.labels && x.labels.length) || has('needs-triage')
      if (_isTriageLike) return bc('needs-triage', '#f59e0b')
      if (has('bug')) return bc('bug', '#f87171')
      if (has('wayfinder:grilling')) return bc('wayfinder:grilling', '#d93f0b')
      if (has('wayfinder:research')) return bc('wayfinder:research', '#0ea5e9')
      if (has('wayfinder:prototype')) return bc('wayfinder:prototype', '#f59e0b')
      return '#c084fc'
    }
    // #361：行级动作注入文本的单一真源（诊断/修复/讨论/执行）—— 新会话打开与行内动作共用
    export const rowActionText = function (st, x) {
      let url = ''
      try { url = issueUrlFor(st, x.number) } catch(e) { url = '' }
      if (!url) {
        const fallbackKey = (x && (x.number != null ? x.number : x.key != null ? x.key : ''))
        if (fallbackKey !== '') url = '#' + String(fallbackKey)
      }
      const has = function (nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
      const _isTriageLike = !(x.labels && x.labels.length) || has('needs-triage')
      if (_isTriageLike) return renderTemplate('diagnose', { url: url })
      if (has('bug')) return renderTemplate('fix', { url: url })
      if (has('wayfinder:grilling')) return renderTemplate('discuss', { url: url })
      if (has('wayfinder:research')) return renderTemplate('research', { url: url })
      if (has('wayfinder:prototype')) return renderTemplate('prototype', { url: url })
      try { return startText(st, x) } catch(e) { return renderTemplate('diagnose', { url: url }) }
    }
    // v19：共享 —— 行级动作（列表与 map 详情共用）：按 label 四选一（诊断/修复/讨论/执行），预填输入框；
    // 按钮主体色 = 对应 label 的 GitHub 配置色（YIQ 感知亮度定文字色）
    export const mkRowAction = function (st, x, narrow, colorOf) {
      const url = issueUrlFor(st, x.number)
      const has = function (nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
      const _isTriageLike = !(x.labels && x.labels.length) || has('needs-triage')
      const isLight = function (hex) {
        try {
          const hh = String(hex || '').replace('#', '')
          if (!/^[0-9a-fA-F]{6}$/.test(hh)) return false
          const r = parseInt(hh.slice(0, 2), 16), g = parseInt(hh.slice(2, 4), 16), b = parseInt(hh.slice(4, 6), 16)
          return (299 * r + 587 * g + 114 * b) / 1000 > 160
        } catch (e) { return false }
      }
      const btnColor = function (nm, fb) { const c = colorOf[nm]; return c ? '#' + c : fb }
      const mk = (icon, label, text, colorHex) => {
        const light = isLight(colorHex)
        return h(Tip, { content: label }, h('button', {
          className: 'dsws-btn primary' + (narrow ? ' narrow-icon' : ''),
          onClick: function (e) { e.stopPropagation(); inject(st, text) },
          style: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', background: colorHex, borderColor: 'transparent', color: light ? '#140a1e' : '#ffffff' },
        }, [Ic({ n: icon, size: icon === 'prototype' ? 12 : 10 }), narrow ? null : h('span', null, label)]))
      }
      // v21：技能命令 + URL + 统一引导句（不再重复灌输技能内部流程）
      // v25 · T2b：诊断/修复/讨论走模板渲染（用户可自定义静态文本，{url} 注入）
      if (_isTriageLike) return mk('chat', tr('act.diagnose'), rowActionText(st, x), btnColor('needs-triage', '#f59e0b'))
      if (has('bug')) return mk('hammer', tr('act.fix'), rowActionText(st, x), btnColor('bug', '#f87171'))
      if (has('wayfinder:grilling')) return mk('chat', tr('act.discuss'), rowActionText(st, x), btnColor('wayfinder:grilling', '#d93f0b'))
      if (has('wayfinder:research')) return mk('search', tr('act.research'), rowActionText(st, x), btnColor('wayfinder:research', '#0ea5e9'))
      if (has('wayfinder:prototype')) return mk('prototype', tr('act.prototype'), rowActionText(st, x), btnColor('wayfinder:prototype', '#f59e0b'))
      return mk('play', tr('act.execute'), rowActionText(st, x), '#c084fc')
    }
    // v19：交接文档时间戳文件名（YYYYMMDD-HHMMSS）
    export const timeStampStr = () => {
      try {
        const d = new Date()
        const p = function (n) { return String(n).padStart(2, '0') }
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
      } catch (e) { return 'latest' }
    }