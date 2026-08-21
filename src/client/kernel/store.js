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
      return st.noRepoCard
    }
    export const makeStore = () => ({
      open: false, tab: 'list', activeMap: null,
      notice: null, injector: null, tick: 0,
      pos: null, size: { w: 460, h: DEFAULT_PANEL_H },
      // 外观定死（用户拍板：图标/动作词不可配置）
      ui: { icon: 'compass', word: '沉淀' },
      snapshot: null,
      cwd: '', lblFilters: [], skillView: 'list', expLabels: false,
      // #374：状态过滤 + 排序（默认 更新时间↓，与现状一致）
      stateFilter: listPrefs.stateFilter, sortKey: listPrefs.sortKey, sortDir: listPrefs.sortDir,
      checks: null, checksUpdatedAt: '', checksMode: 'loading', checksError: null, checking: false,
      snapMode: 'loading', snapError: null, snapLoading: false,
      refreshing: false, rowFlash: {}, issueFlash: {}, handoffReady: false, handoffSearching: false, skillsOpen: false, skillHover: null, skillTip: null, bugMenuOpen: false, bugMenuHover: false, bugMenuPos: null, skillPopPos: null, expTags: {}, subs: [],
      noRepoCard: { expanded: false, name: '', visibility: 'private', loading: false, error: '', errorKind: '', errorRepoUrl: '' },
      issuePath: { sessionId: '', anchor: null, nodes: [], current: null, updatedAt: 0 },
      issuePathHover: false, issuePathPos: null,
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
      if (!c) return false
      if (!st.snapshot || c.generatedMs !== st.snapshot.generatedMs) {
        st.snapshot = c
        st.snapMode = 'real'
        st.snapError = null
        st.snapLoading = false
        return true
      }
      if (st.snapMode !== 'real') {
        st.snapMode = 'real'
        st.snapError = null
        return true
      }
      return false
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
