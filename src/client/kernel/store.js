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
    // ============  issuePath · 状态栏当前处理 Issue 轨迹（v1.7.0 map #79 · S-rec）============
    export const ISSUE_PATH_KEY = 'dsws.issuePath'
    export const ISSUE_PATH_MAX = 100
    export const ISSUE_PATH_DEBOUNCE_MS = 500
    export let _issuePathSaveTimer = null
    export const loadIssuePathMap = function () {
      try {
        const raw = localStorage.getItem(ISSUE_PATH_KEY)
        if (!raw) return {}
        const o = JSON.parse(raw)
        return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}
      } catch (e) { return {} }
    }
    export const saveIssuePathMapNow = function (map) {
      try { localStorage.setItem(ISSUE_PATH_KEY, JSON.stringify(map)) } catch (e) {}
    }
    export const persistIssuePath = function (st) {
      if (!st || !st.issuePath) return
      if (_issuePathSaveTimer) try { clearTimeout(_issuePathSaveTimer) } catch (e) {}
      _issuePathSaveTimer = setTimeout(function () {
        _issuePathSaveTimer = null
        try {
          const map = loadIssuePathMap()
          const key = st.sessionId || '__shared'
          map[key] = st.issuePath
          const keys = Object.keys(map)
          if (keys.length > 8) {
            keys.sort(function (a, b) { return (map[a].updatedAt || 0) - (map[b].updatedAt || 0) })
            while (Object.keys(map).length > 8) delete map[keys.shift()]
          }
          saveIssuePathMapNow(map)
        } catch (e) {}
      }, ISSUE_PATH_DEBOUNCE_MS)
    }
    export const ensureIssuePath = function (st) {
      if (st.issuePath && Array.isArray(st.issuePath.nodes)) return st.issuePath
      const key = st.sessionId || '__shared'
      const map = loadIssuePathMap()
      if (map[key] && Array.isArray(map[key].nodes)) {
        st.issuePath = map[key]
        if (!st.issuePath.sessionId) st.issuePath.sessionId = st.sessionId || ''
        if (typeof st.issuePath.anchor !== 'number') st.issuePath.anchor = st.issuePath.nodes.length ? st.issuePath.nodes[0].ref : null
        if (typeof st.issuePath.current !== 'number') st.issuePath.current = st.issuePath.nodes.length ? st.issuePath.nodes[st.issuePath.nodes.length - 1].ref : null
        return st.issuePath
      }
      st.issuePath = { sessionId: st.sessionId || '', anchor: null, nodes: [], current: null, updatedAt: 0 }
      return st.issuePath
    }
    export const recordIssuePath = function (st, ref, source, title) {
      const n = Number(ref)
      if (!n || isNaN(n)) return false
      ensureIssuePath(st)
      const ip = st.issuePath
      const now = Date.now()
      ip.sessionId = st.sessionId || ''
      if (!ip.nodes) ip.nodes = []
      if (ip.anchor == null) ip.anchor = n
      const last = ip.nodes.length ? ip.nodes[ip.nodes.length - 1] : null
      if (last && last.ref === n && (now - (last.ts || 0)) < 2000) {
        last.ts = now
        if (source) last.source = source
        if (title && !last.title) last.title = String(title).slice(0, 80)
        ip.current = n
        ip.updatedAt = now
        persistIssuePath(st); emit(st); return true
      }
      ip.nodes.push({ ref: n, source: String(source || 'auto'), ts: now, title: String(title || '').slice(0, 80) })
      if (ip.nodes.length > ISSUE_PATH_MAX) ip.nodes.shift()
      if (ip.nodes.length) ip.anchor = ip.nodes[0].ref
      ip.current = n
      ip.updatedAt = now
      persistIssuePath(st); emit(st); return true
    }
    export const reanchorIssuePath = function (st, ref) {
      const n = Number(ref)
      if (!n || isNaN(n) || !st.issuePath || !st.issuePath.nodes.length) return false
      const found = st.issuePath.nodes.find(function (x) { return x.ref === n })
      if (!found) return false
      st.issuePath.anchor = n
      st.issuePath.current = n
      st.issuePath.updatedAt = Date.now()
      persistIssuePath(st); emit(st); return true
    }
    export const clearIssuePath = function (st) {
      st.issuePath = { sessionId: st.sessionId || '', anchor: null, nodes: [], current: null, updatedAt: Date.now() }
      persistIssuePath(st); emit(st)
    }
    export let _issuePathPollTs = 0
    export let _issuePathPolling = false
    export const pollIssuePathHost = function (st) {
      if (_issuePathPolling) return
      if (typeof host === 'undefined' || typeof host.call !== 'function') return
      _issuePathPolling = true
      host.call('wf.issuePathPoll', { since: _issuePathPollTs }).then(function (res) {
        _issuePathPolling = false
        if (!res || !res.ok || !Array.isArray(res.events) || !res.events.length) {
          if (res && typeof res.serverNow === 'number') _issuePathPollTs = res.serverNow
          return
        }
        let maxTs = _issuePathPollTs
        res.events.forEach(function (ev) {
          if (ev && ev.ref) {
            recordIssuePath(st, ev.ref, ev.source, ev.title)
            if (ev.ts && ev.ts > maxTs) maxTs = ev.ts
          }
        })
        if (res.serverNow && res.serverNow > maxTs) maxTs = res.serverNow
        _issuePathPollTs = maxTs
      }).catch(function () { _issuePathPolling = false })
    }
    export let _issuePathPollTimer = null
    export const startIssuePathPoll = function (st) {
      if (_issuePathPollTimer) return
      const tick = function () {
        if (st) pollIssuePathHost(st)
        _issuePathPollTimer = setTimeout(tick, 4000)
      }
      tick()
    }
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
      st.activeMap = (v && !isNaN(v)) ? v : null
      if (st.activeMap !== null) st.activeIssue = null
      emit(st)
    }
    export const clearActiveMap = function (st) { st.activeMap = null; emit(st) }
    export const setActiveIssue = function (st, n) {
      const v = (n == null) ? null : Number(n)
      st.activeIssue = (v && !isNaN(v)) ? v : null
      if (st.activeIssue !== null) st.activeMap = null
      emit(st)
    }
    export const clearActiveIssue = function (st) { st.activeIssue = null; emit(st) }
    export const clearActiveDetail = function (st) { st.activeMap = null; st.activeIssue = null; emit(st) }
    // T2 #7 · fetchIssueDetail 缓存与状态（独立于 snapshot，按 issue 号 60s TTL）
    export const ISSUE_CACHE_TTL = 60000
    // #155：后端选择 per-cwd 状态（权威来自 host snapshot.selection/repository；client 仅镜像乐观）
    export const selectionByCwd = {}
    export const repositoryByCwd = {}
    export const getCachedSelection = function (cwd) { return cwd ? selectionByCwd[cwd] : null }
    export const setCachedSelection = function (cwd, sel) { if (cwd) selectionByCwd[cwd] = sel }
    export const getCachedRepository = function (cwd) { return cwd ? repositoryByCwd[cwd] : null }
    export const setCachedRepository = function (cwd, repo) { if (cwd) repositoryByCwd[cwd] = repo }
    export const labelOf = function (backendId) {
      if (backendId == null) return 'Other'
      const map = { github: 'GitHub', markdown: 'Markdown', gitlab: 'GitLab' }
      if (map[backendId]) return map[backendId]
      return String(backendId)
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
    const toAdaptive = function (light) {
      const l = String(light || '').trim()
      if (!l) return 'light-dark(#57606a, #8b949e)'
      if (l.includes('light-dark')) return l
      return 'light-dark(' + l + ', color-mix(in oklch, ' + l + ' 75%, white))'
    }
    const bgFor = function (adaptiveColor) {
      // 从 adaptive 中取 light 部分派生 bg（12% / 14%），若后端已显式给 bg 则直接用
      // 简化：用 color-mix 派生，保持与 light-dark 同步
      return 'light-dark(color-mix(in srgb, ' + adaptiveColor.replace(/light-dark\(([^,]+),.*\)/, '$1') + ' 12%, transparent), color-mix(in srgb, ' + adaptiveColor.replace(/.*,\s*([^\)]+)\)/, '$1') + ' 14%, transparent))'
    }
    export const backendColorOf = function (backendId) {
      const p = presentationById[backendId]
      if (p && p.color) return toAdaptive(p.color)
      if (backendId === 'github') return 'light-dark(#0969da, #58a6ff)'
      if (backendId === 'markdown') return 'light-dark(#1a7f37, #3fb950)'
      if (backendId === 'gitlab') return 'light-dark(#c25100, #ff9a5c)'
      return 'light-dark(#57606a, #8b949e)'
    }
    export const backendBgOf = function (backendId) {
      const p = presentationById[backendId]
      if (p && p.bg) return p.bg
      if (p && p.color) {
        const ad = toAdaptive(p.color)
        const light = ad.replace(/light-dark\(([^,]+),.*\)/, '$1')
        const dark = ad.replace(/.*,\s*([^\)]+)\)/, '$1')
        return 'light-dark(color-mix(in srgb, ' + light + ' 12%, transparent), color-mix(in srgb, ' + dark + ' 14%, transparent))'
      }
      if (backendId === 'github') return 'light-dark(#ddf4ff, rgba(56,139,253,.15))'
      if (backendId === 'markdown') return 'light-dark(rgba(26,127,55,.12), rgba(63,185,80,.14))'
      if (backendId === 'gitlab') return 'light-dark(rgba(194,81,0,.12), rgba(255,154,92,.14))'
      return 'light-dark(rgba(87,96,106,.12), rgba(139,148,158,.14))'
    }
    export const backendBorderOf = function (backendId) {
      const p = presentationById[backendId]
      if (p && p.border) return p.border
      if (p && p.color) {
        const ad = toAdaptive(p.color)
        const light = ad.replace(/light-dark\(([^,]+),.*\)/, '$1')
        const dark = ad.replace(/.*,\s*([^\)]+)\)/, '$1')
        return 'light-dark(color-mix(in srgb, ' + light + ' 30%, transparent), color-mix(in srgb, ' + dark + ' 35%, transparent))'
      }
      if (backendId === 'github') return 'light-dark(rgba(84,174,255,.4), rgba(56,139,253,.4))'
      if (backendId === 'markdown') return 'light-dark(rgba(26,127,55,.25), rgba(63,185,80,.30))'
      if (backendId === 'gitlab') return 'light-dark(rgba(194,81,0,.25), rgba(255,154,92,.30))'
      return 'light-dark(rgba(87,96,106,.25), rgba(139,148,158,.30))'
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
        option: 'keep',
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
      let lang = 'zh'
      try { lang = (typeof promptLang === 'function' ? promptLang() : 'zh') } catch {}
      host.call('wf.status', { cwd: st.cwd || '', lang: lang }).then(function (res) {
        if (!st.switchConfirm) return
        const checks = (res && res.checks) || []
        const c1 = checks.find(function (c) { return c.id === 1 })
        const c4 = checks.find(function (c) { return c.id === 4 })
        const c5 = checks.find(function (c) { return c.id === 5 })
        const allOk = !!(c1 && c1.ok && c4 && c4.ok && c5 && c5.ok)
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
      try { if (st.cwd) selectionByCwd[st.cwd] = optimistic } catch {}
      emit(st)
      const doFail = function (msg) {
        st.selection = prevSel
        try { if (st.cwd) selectionByCwd[st.cwd] = prevSel } catch {}
        sc.confirming = false; emit(st)
        try { flash(st, tr('switch.bindFail', { err: String(msg).slice(0, 120) }), 'warn') } catch {}
      }
      if (typeof host === 'undefined' || typeof host.call !== 'function') { doFail('host.call 不可用'); return }
      host.call('wf.bind', { cwd: st.cwd || '', backendId: targetId }).then(function (res) {
        const ok = res && (res.ok === true || (res.value && res.value.ok === true) || res.ok)
        if (!ok) { doFail((res && (res.error || res.message)) || 'unknown'); return }
        try { flash(st, tr('switch.bindOk', { label: (typeof labelOf === 'function' ? labelOf(targetId) : String(targetId)) }), 'ok') } catch {}
        try {
          const edited = String(sc.prompt || '').trim()
          if (edited && edited !== DEFAULT_SWITCH_PROMPT_ZH) {
            if (typeof inject === 'function') inject(st, edited)
          }
        } catch {}
        closeSwitchConfirm(st)
        try {
          if (typeof loadSnapshot === 'function') loadSnapshot(st, true, true)
          if (typeof loadChecks === 'function') loadChecks(st, true, true)
        } catch {}
      }).catch(function (e) { doFail(e && e.message || e) })
    }
    export const makeStore = () => ({
      open: false, tab: 'list', activeMap: null, activeIssue: null,
      issueCache: {}, issueMode: 'idle', issueError: null, issueDetail: null, issueCommentsMoreLoading: false, issueCommentsFailCount: 0, issueCommentsHasMore: true,
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
      checks: null, checksUpdatedAt: '', checksMode: 'loading', checksError: null, checking: false,
      snapMode: 'loading', snapError: null, snapLoading: false,
      refreshing: false, rowFlash: {}, issueFlash: {}, handoffReady: false, handoffSearching: false, skillsOpen: false, skillHover: null, skillTip: null, bugMenuOpen: false, bugMenuHover: false, bugMenuPos: null, skillPopPos: null, expTags: {}, subs: [],
      noRepoCard: { expanded: false, name: '', visibility: 'private', loading: false, error: '', errorKind: '', errorRepoUrl: '' },
      issuePath: { sessionId: '', anchor: null, nodes: [], current: null, updatedAt: 0 },
      issuePathHover: false, issuePathPos: null,
      switchConfirm: null,
      gateModalOpen: false, gateSelected: null, gateLoading: false, gateError: '',
    })
    export const shared = makeStore()
    export const stores = {}
    // #58 缓存优先：按 cwd 的内存快照表（新 store 秒开 + 跨会话同 cwd 共享，避免空 cwd 探路 miss）
    export const snapshotByCwd = {}
    export const getCachedSnapshot = function (cwd) { return cwd ? snapshotByCwd[cwd] : null }
    export const setCachedSnapshot = function (cwd, snap) { if (cwd && snap && snap.ok === true && Array.isArray(snap.maps)) snapshotByCwd[cwd] = snap }
    export const hydrateFromCache = function (st) {
      if (!st || !st.cwd) return false
      const c = getCachedSnapshot(st.cwd)
      let changed=false
      if (c) {
        if (!st.snapshot || c.generatedMs !== st.snapshot.generatedMs) {
          st.snapshot = c
          st.snapMode = 'real'
          st.snapError = null
          st.snapLoading = false
          changed=true
        } else if (st.snapMode !== 'real') {
          st.snapMode = 'real'
          st.snapError = null
          changed=true
        }
        // 同步 selection/repository 镜像（per-cwd）
        if (c.selection !== undefined) { st.selection = c.selection; setCachedSelection(st.cwd, c.selection) }
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
      return changed
    }
    export const applySnapshotSelection = function (st, snap) {
      if (!st || !snap) return
      if (snap.selection !== undefined) { st.selection = snap.selection; if (st.cwd) setCachedSelection(st.cwd, snap.selection) }
      if (snap.repository !== undefined) { st.repository = snap.repository; if (st.cwd) setCachedRepository(st.cwd, snap.repository) }
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
      if (!sid) { ensureIssuePath(shared); return shared }
      let st = stores[sid]
      if (!st) {
        st = makeStore(); st.sessionId = sid; stores[sid] = st
        // #58 新 store 同步补 cwd 并尝试水合 per-cwd 缓存（秒开）
        if (!st.cwd) {
          const sync = getCwdSync(sid)
          if (sync) st.cwd = sync
        }
        if (st.cwd) hydrateFromCache(st)
        ensureIssuePath(st)
      } else {
        // 已有 store 若 cwd 仍空且可同步补齐，立即水合
        if (!st.cwd) {
          const sync = getCwdSync(sid)
          if (sync) { st.cwd = sync; hydrateFromCache(st) }
        }
        ensureIssuePath(st)
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
    export const bugCount = (st) => openIssuesOf(st).filter(function (x) { return hasLabelOf(x, 'bug') }).length
    export const triageCount = (st) => openIssuesOf(st).filter(function (x) { return hasLabelOf(x, 'needs-triage') }).length

    // v19：共享 —— 标签配置色映射（从快照 issues 收集 GitHub label 配置色，动态查询非写死）
    export const buildColorOf = function (st) {
      const colorOf = {}
      const issues = (st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []
      issues.forEach(function (x) {
        (x.labels || []).forEach(function (l) { if (l.color && !colorOf[l.name]) colorOf[l.name] = l.color })
      })
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
      if (has('needs-triage')) return bc('needs-triage', '#f59e0b')
      if (has('bug')) return bc('bug', '#f87171')
      if (has('wayfinder:grilling')) return bc('wayfinder:grilling', '#d93f0b')
      return '#c084fc'
    }
    // #361：行级动作注入文本的单一真源（诊断/修复/讨论/执行）—— 新会话打开与行内动作共用
    export const rowActionText = function (st, x) {
      const url = 'https://github.com/' + repoStr(st) + '/issues/' + x.number
      const has = function (nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
      if (has('needs-triage')) return renderTemplate('diagnose', { url: url })
      if (has('bug')) return renderTemplate('fix', { url: url })
      if (has('wayfinder:grilling')) return renderTemplate('discuss', { url: url })
      return startText(st, x)
    }
    // v19：共享 —— 行级动作（列表与 map 详情共用）：按 label 四选一（诊断/修复/讨论/执行），预填输入框；
    // 按钮主体色 = 对应 label 的 GitHub 配置色（YIQ 感知亮度定文字色）
    export const mkRowAction = function (st, x, narrow, colorOf) {
      const url = 'https://github.com/' + repoStr(st) + '/issues/' + x.number
      const has = function (nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
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
        return h('button', {
          className: 'dsws-btn primary' + (narrow ? ' narrow-icon' : ''),
          onClick: function (e) { e.stopPropagation(); inject(st, text) },
          style: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', background: colorHex, borderColor: 'transparent', color: light ? '#140a1e' : '#ffffff' },
          title: label,
        }, [Ic({ n: icon, size: 10 }), narrow ? null : h('span', null, label)])
      }
      // v21：技能命令 + URL + 统一引导句（不再重复灌输技能内部流程）
      // v25 · T2b：诊断/修复/讨论走模板渲染（用户可自定义静态文本，{url} 注入）
      if (has('needs-triage')) return mk('chat', tr('act.diagnose'), rowActionText(st, x), btnColor('needs-triage', '#f59e0b'))
      if (has('bug')) return mk('hammer', tr('act.fix'), rowActionText(st, x), btnColor('bug', '#f87171'))
      if (has('wayfinder:grilling')) return mk('chat', tr('act.discuss'), rowActionText(st, x), btnColor('wayfinder:grilling', '#d93f0b'))
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
