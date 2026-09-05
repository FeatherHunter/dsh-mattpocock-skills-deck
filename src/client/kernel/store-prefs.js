/**
 * src/client/kernel/store-prefs.js — 内核模块（#455 由 store.js 拆出之偏好、noRepo 状态机、选中与仓库、横幅折叠）
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
      } catch (e) { try { log('warn', 'storage.fail', { key: LIST_PREFS_KEY, op: 'read' }) } catch (eL) {} }
      return d
    })()
    export const saveListPrefs = function () { try { localStorage.setItem(LIST_PREFS_KEY, JSON.stringify(listPrefs)) } catch (e) { try { log('warn', 'storage.fail', { key: LIST_PREFS_KEY, op: 'write' }) } catch (eL) {} } }
    // #375：label 点击记忆（次数 + 最近点击时间，双键排序）
    export const LABEL_CLICKS_KEY = 'dsws.labelClicks'
    export const labelClicks = (function () {
      try {
        const raw = localStorage.getItem(LABEL_CLICKS_KEY)
        if (raw) { const o = JSON.parse(raw); return (o && typeof o === 'object') ? o : {} }
      } catch (e) { try { log('warn', 'storage.fail', { key: LABEL_CLICKS_KEY, op: 'read' }) } catch (eL) {} }
      return {}
    })()
    export const saveLabelClicks = function () { try { localStorage.setItem(LABEL_CLICKS_KEY, JSON.stringify(labelClicks)) } catch (e) { try { log('warn', 'storage.fail', { key: LABEL_CLICKS_KEY, op: 'write' }) } catch (eL) {} } }
    // 彻底移除：清理遗留的 dsws.issuePath（v1.7.0 遗留，见 #345 移除落地）
    try { localStorage.removeItem('dsws.issuePath'); } catch (e) {}
    // T2 #35 · 无仓库红卡状态机（按 cwd 维度持久化 dismiss；表单态 expanded/name/visibility/loading/error）
    export const NOREPO_DISMISS_PREFIX = 'dsws:noRepoDismiss:'
    export const cwdHash = function (s) { let h = 0; const t = String(s || ''); for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0; return String(h >>> 0) }
    export const noRepoDismissKey = function (cwd) { return NOREPO_DISMISS_PREFIX + cwdHash(cwd || '') }
    export const isNoRepoDismissed = function (cwd) { try { return localStorage.getItem(noRepoDismissKey(cwd)) === '1' } catch (e) { try { log('warn', 'storage.fail', { key: NOREPO_DISMISS_PREFIX, op: 'read' }) } catch (eL) {}; return false } }
    export const setNoRepoDismissed = function (cwd, v) { try { if (v) localStorage.setItem(noRepoDismissKey(cwd), '1'); else localStorage.removeItem(noRepoDismissKey(cwd)) } catch (e) { try { log('warn', 'storage.fail', { key: NOREPO_DISMISS_PREFIX, op: 'write' }) } catch (eL) {} } }
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
    // #422 · 提示横幅按工作区收起记忆（默认全部展开；各类提示横幅都可收，由调用方横幅决定是否给收起入口）。
    //   存法沿用选择集同例：归一键 → 1（收起），缺席即展开；localStorage 不可用时降级为仅内存。
    export const BANNER_FOLD_KEY = 'dsws.bannerFold'
    export const bannerFoldByCwd = {}
    ;(function () {
      try {
        const raw = localStorage.getItem(BANNER_FOLD_KEY)
        if (raw) { const m = JSON.parse(raw); if (m && typeof m === 'object') { for (const k of Object.keys(m)) { const nk = (typeof keyOf === 'function' ? keyOf(k) : k); if (m[k] && !(nk in bannerFoldByCwd)) bannerFoldByCwd[nk] = 1 } } }
      } catch (e) { /* 存储不可用降级为仅内存 */ }
    })()
    const persistBannerFold = function () { try { localStorage.setItem(BANNER_FOLD_KEY, JSON.stringify(bannerFoldByCwd)) } catch (e) { /* 忽略 */ } }
    export const isBannerFolded = function (cwd) { try { if (!cwd) return false; const k = (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd || '')); return !!bannerFoldByCwd[k] } catch (e) { return false } }
    export const setBannerFolded = function (cwd, folded) {
      try {
        const k = (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd || ''))
        if (!cwd || !k) return
        if (folded) bannerFoldByCwd[k] = 1
        else delete bannerFoldByCwd[k]
        persistBannerFold()
      } catch (e) { /* 忽略 */ }
      // 同工作区各会话跟随重渲染（与 touchProbeAt 同例；设置页另有本地刷新兜底）
      try {
        const nk = (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd || ''))
        if (typeof shared !== 'undefined' && shared && shared.cwd && keyOf(shared.cwd) === nk) emit(shared)
      } catch (e1) {}
      try {
        if (typeof stores !== 'undefined') Object.keys(stores).forEach(function (kk) { const st2 = stores[kk]; if (st2 && st2.cwd && keyOf(st2.cwd) === (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd || ''))) emit(st2) })
      } catch (e2) {}
    }
    export const getCachedSelection = function (cwd) { try { const k = (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd||'')); return cwd ? (selectionByCwd[k] || null) : null } catch(e){ return cwd ? (selectionByCwd[cwd] || null) : null } }
    export const setCachedSelection = function (cwd, sel) { try { const k = (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd||'')); if (cwd && k) { selectionByCwd[k] = sel; persistSelectionByCwd() } } catch(e){ if (cwd) { selectionByCwd[cwd] = sel; persistSelectionByCwd() } } }
    export const getCachedRepository = function (cwd) { try { const k = (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd||'')); return cwd ? repositoryByCwd[k] : null } catch(e){ return cwd ? repositoryByCwd[cwd] : null } }
    export const setCachedRepository = function (cwd, repo) { try { const k = (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd||'')); if (cwd && k) repositoryByCwd[k] = repo } catch(e){ if (cwd) repositoryByCwd[cwd] = repo } }