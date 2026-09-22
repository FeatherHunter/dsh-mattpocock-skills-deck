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
    // T2 #35 · 无仓库红卡状态机（按工作区维度持久化 dismiss；表单态 expanded/name/visibility/loading/error）
    // #653 修正：此前这里用 cwdHash 散列**原始串**（没走规整函数），同一个目录换一种写法（多一个尾斜杠、
    //   盘符大小写不同）就会散出另一把键，收起过的红卡会重新冒出来。现在统一走工作区键（wsKeyOf）：
    //   先按工作区根锚定，再散列，同一工作区只有一条记录。
    export const NOREPO_DISMISS_PREFIX = 'dsws:noRepoDismiss:'
    export const cwdHash = function (s) { let h = 0; const t = String(s || ''); for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0; return String(h >>> 0) }
    export const noRepoDismissKey = function (cwd) { return NOREPO_DISMISS_PREFIX + cwdHash((typeof wsKeyOf === 'function' ? wsKeyOf(cwd) : (typeof keyOf === 'function' ? keyOf(cwd) : cwd)) || '') }
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
    // #552 导航栈：navStack 是真源，只存坐标 { kind: 'map' | 'issue', n: 数字编号, effortId: effort 标识 }，不存详情正文
    // （地图正文走面板快照派生，工单正文走 60 秒详情缓存加 TEFNGY 降级，栈只做坐标）。
    // effort 维度：本地 Markdown 一个仓库多个 effort，编号会重复，所以坐标必须带上 effortId（单 effort 后端恒为 ''）。
    // activeMap 与 activeIssue 过渡期保留为栈顶镜像（读方逐个改到读栈顶之前，停靠栏/悬浮面板/技能页签照旧可用），
    // activeEffortId 是同一个栈顶的 effort 镜像。
    // 只读栈本身（同步镜像用，不带镜像兜底，否则弹空栈时会把旧镜像写回去）
    export const navEffortOf = function (t) { return (t && t.effortId !== undefined && t.effortId !== null) ? String(t.effortId) : '' }
    export const peekStackNav = function (st) {
      try {
        const s = st && st.navStack
        if (Array.isArray(s) && s.length) {
          const t = s[s.length - 1]
          if (t && (t.kind === 'map' || t.kind === 'issue') && typeof t.n === 'number' && !isNaN(t.n)) return t
        }
      } catch (e) {}
      return null
    }
    export const peekNav = function (st) {
      const t = peekStackNav(st)
      if (t) return t
      // 没有栈的旧状态：从镜像回推栈顶，保证读方不崩
      try {
        const eff = (st && st.activeEffortId !== undefined && st.activeEffortId !== null) ? String(st.activeEffortId) : ''
        if (st && st.activeMap !== null && st.activeMap !== undefined) { const v = Number(st.activeMap); if (!isNaN(v)) return { kind: 'map', n: v, effortId: eff } }
        if (st && st.activeIssue !== null && st.activeIssue !== undefined) { const v2 = Number(st.activeIssue); if (!isNaN(v2)) return { kind: 'issue', n: v2, effortId: eff } }
      } catch (e2) {}
      return null
    }
    export const syncNavMirror = function (st) {
      const t = peekStackNav(st)
      if (t && t.kind === 'map') { st.activeMap = t.n; st.activeIssue = null; st.activeEffortId = navEffortOf(t) }
      else if (t && t.kind === 'issue') { st.activeIssue = t.n; st.activeMap = null; st.activeEffortId = navEffortOf(t) }
      else { st.activeMap = null; st.activeIssue = null; st.activeEffortId = '' }
      return t
    }
    export const pushNav = function (st, kind, n, effortId) {
      if (!st) return null
      if (!Array.isArray(st.navStack)) st.navStack = []
      seedNavFromMirror(st)
      const v = (n == null) ? null : Number(n)
      if ((kind !== 'map' && kind !== 'issue') || v == null || isNaN(v)) return peekNav(st)
      const eff = (effortId === undefined || effortId === null) ? '' : String(effortId)
      const top = peekNav(st)
      // 同一详情重复进入不重复压栈（防双击把两个一样的压进栈）；同号不同 effort 是两条坐标，照压
      if (!top || top.kind !== kind || top.n !== v || navEffortOf(top) !== eff) st.navStack.push({ kind: kind, n: v, effortId: eff })
      syncNavMirror(st)
      emit(st)
      return peekNav(st)
    }
    // 没有栈的旧状态：先从镜像补一层再动栈，保证旧对象调清除也能清掉
    export const seedNavFromMirror = function (st) {
      if (!st || !Array.isArray(st.navStack) || st.navStack.length) return
      const t = peekNav(st)
      if (t) st.navStack.push({ kind: t.kind, n: t.n, effortId: navEffortOf(t) })
    }
    // 返回弹栈：只改栈与镜像，不碰滚动、展开、缓存与快照，所以上一级原样保留、不强制重刷
    export const popNav = function (st) {
      if (!st) return null
      if (!Array.isArray(st.navStack)) st.navStack = []
      seedNavFromMirror(st)
      const out = st.navStack.length ? st.navStack.pop() : null
      syncNavMirror(st)
      emit(st)
      return out
    }
    export const clearNavStack = function (st) {
      if (!st) return
      st.navStack = []
      st.activeMap = null; st.activeIssue = null; st.activeEffortId = ''
      emit(st)
    }
    // 旧入口收敛为调新函数（T3/T4 再把调用方逐个改成直接压栈/弹栈）：
    // 进入详情一律压栈——从列表进时栈是空的，压栈与旧的直接赋值效果一样；
    // 从详情里再进下一级则保留返回路径，不再丢掉上一级。
    export const setActiveMap = function (st, n, effortId) {
      if (n == null) { clearActiveMap(st); return }
      pushNav(st, 'map', n, effortId)
    }
    export const clearActiveMap = function (st) {
      const t = peekNav(st)
      if (t && t.kind === 'map') popNav(st)
      else { syncNavMirror(st); emit(st) }
    }
    export const setActiveIssue = function (st, n, effortId) {
      if (n == null) { clearActiveIssue(st); return }
      pushNav(st, 'issue', n, effortId)
    }
    export const clearActiveIssue = function (st) {
      const t = peekNav(st)
      if (t && t.kind === 'issue') popNav(st)
      else { syncNavMirror(st); emit(st) }
    }
    export const clearActiveDetail = function (st) { clearNavStack(st) }
    // T2 #7 · fetchIssueDetail 缓存与状态（独立于 snapshot，按 issue 号 60s TTL）
    export const ISSUE_CACHE_TTL = ((typeof SYNC === 'object' && SYNC && SYNC.ISSUE_CACHE_TTL) || 60000)
    // #155：后端选择按工作区状态（权威来自 host snapshot.selection/repository；client 仅镜像乐观）
    // #653：这两张镜像表从前按「会话所选目录」存，同一个仓库里根会话与子目录会话各存各的，互相看不见；
    //   现在按工作区键（wsKeyOf）存——子目录会话读得到根会话已经绑定的后端，不再要求重新初始化。
    //   既有工作区里那些按所选目录存的旧键按定版记录 3.5 节处置：**不删、不迁移**，规则生效后不再被读取。
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
    // #683（F1 · ADR 20260921 的 R7b）：写这张镜像表要「读回磁盘上那张 → 只换本工作区那一条 → 写回」。
    //   从前这里是把进程内存里那份**整表**序列化写回：同一个访问地址开两个窗口时，后写的那扇窗会把
    //   另一扇窗刚写进去的键整条顶掉（一个窗口里选完后端，另一个窗口一刷新就看不见了）。
    //   写失败也不再一口吞掉：与同文件 saveListPrefs / saveLabelClicks 同例记一条 storage.fail（ADR 的 R7c）。
    //   本文件另有一张横幅折叠表（bannerFoldByCwd）还是老写法 —— 那条路今天没有跨窗口场景，本次不动它。
    const writeTableEntry = function (storeKey, entryKey, value) {
      try {
        let table = null
        try { const raw = localStorage.getItem(storeKey); table = raw ? JSON.parse(raw) : null } catch (eR) { table = null }
        if (!table || typeof table !== 'object' || Array.isArray(table)) table = {}
        table[entryKey] = value
        localStorage.setItem(storeKey, JSON.stringify(table))
      } catch (e) { try { log('warn', 'storage.fail', { key: storeKey, op: 'write' }) } catch (eL) {} }
    }
    // 别的工作区、别的窗口改了这张表时，把磁盘上那份合并回内存。磁盘那张是各窗口写进去的并集，
    //   同名的那一条以磁盘为准 —— 我们自己刚写的那一次也在里面，不会被顶掉。
    const mergeTableFromStorage = function (storeKey, inMemory) {
      try {
        const raw = localStorage.getItem(storeKey)
        if (!raw) return
        const m = JSON.parse(raw)
        if (!m || typeof m !== 'object' || Array.isArray(m)) return
        for (const k of Object.keys(m)) inMemory[k] = m[k]
      } catch (e) { /* 磁盘上那份读不出来时就按内存里这份继续用 */ }
    }
    // storage 事件只在**别的**同源文档改了这份存储时触发，正是「另一扇窗刚写了一条」那个现场。
    const onStorageMerge = function (ev) {
      try {
        const k = ev && ev.key
        if (k === SELECTION_BY_CWD_KEY) mergeTableFromStorage(SELECTION_BY_CWD_KEY, selectionByCwd)
        else if (k === SETUP_LAYOUT_BY_CWD_KEY) mergeTableFromStorage(SETUP_LAYOUT_BY_CWD_KEY, setupLayoutByCwd)
      } catch (e) {}
    }
    try { if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('storage', onStorageMerge) } catch (e) {}
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
    export const getCachedSelection = function (cwd) { try { const k = wsKeyOf(cwd); return (cwd && k) ? (selectionByCwd[k] || null) : null } catch(e){ return cwd ? (selectionByCwd[cwd] || null) : null } }
    export const setCachedSelection = function (cwd, sel) { try { const k = wsKeyOf(cwd); if (cwd && k) { selectionByCwd[k] = sel; writeTableEntry(SELECTION_BY_CWD_KEY, k, sel) } } catch(e){ if (cwd) { selectionByCwd[cwd] = sel; writeTableEntry(SELECTION_BY_CWD_KEY, cwd, sel) } } }
    // #669 第 6 件（ADR 20260921）：**只有用户亲手选过的那一条**才配当「用户的手动选择」上报给宿主。
    //   为什么要有这把闸：缓存里的这条选择有两种来源 —— 用户点出来的（意图），和快照/链/自动识别算出来的
    //   （派生）。宿主那边的顺序是「人的意图 > 锚文件 > 机器推断」，如果派生值也当意图上报，锚文件上一次的
    //   结论就会被缓存下来、永久压住锚文件本身（谁改文件都不生效），比修之前更糟。
    //   标记只有一个来源：用户点确认的那两处（门控窗与切换弹窗）写选择时带 userPicked:true。
    //   快照/链合并写缓存时不带（mergeSelection 先进 keepUserPick，规则就在下面），所以派生值天然没有这把钥匙。
    //   而 keepUserPick 只在「宿主回包的 backendId 与当前相同」时把钥匙留住——宿主回了别的后端（它不认这个
    //   后端 id、于是没采纳这条 hint，或别处把文件对齐了）就照宿主的来，钥匙自然消失。合并时留住它，是为了让
    //   「用户亲手选的」这件事不因为一次刷新就丢：丢了等于锚文件重新说话，正是 ADR 攻击 1 要防的那条。
    export const userHintOf = function (sel) { try { return (sel && sel.userPicked === true && sel.backendId) ? sel.backendId : undefined } catch (e) { return undefined } }
    // #683（F1 · ADR 20260921 的 R2）：每条记录都要带「这条选择是从哪个修订号来的」。
    //   rev 由宿主发号（每接受一次用户选择 +1），客户端只把它一路带着走 —— 写入时记下当时知道的那一个，
    //   上报时换成 baseRev 这个名字原样回给宿主，宿主才判得出「你手里这份是不是最新那一版」。
    //   没有版本位的老记录按 0 处理：那种记录只在宿主那边还没有该工作区记录时被采纳一次（一次性迁移）。
    export const baseRevOf = function (sel) { try { return (sel && typeof sel.rev === 'number' && isFinite(sel.rev) && sel.rev > 0) ? sel.rev : 0 } catch (e) { return 0 } }
    // 用户亲手选的那一条的形状：标记 + 点击时刻 + 这条是从哪个修订号来的。
    //   四个「用户点确认」的写入点都从这里取，别各写一份 —— 漏一处就等于那一条上报时会冒充最新版。
    export const userPickSelection = function (backendId, ref, prevSelection) {
      return { backendId: backendId, source: 'explicit', ref: (ref === undefined ? null : ref), userPicked: true, pickedAt: Date.now(), rev: baseRevOf(prevSelection) }
    }
    // 绑定的回包回来之后，把宿主发的新修订号落到本地那条上（ADR 的 §5 接线）。
    //   回包形状两种都可能（有的路是裸对象、有的是包在 value 里的信封），这里只认 rev 这一个字段。
    export const adoptBoundRev = function (st, res) {
      try {
        const payload = (res && res.value && typeof res.value === 'object') ? res.value : res
        const rev = (payload && typeof payload.rev === 'number' && isFinite(payload.rev) && payload.rev > 0) ? payload.rev : null
        if (rev === null) return null
        if (!st || !st.selection || st.selection.userPicked !== true) return null
        st.selection.rev = rev
        if (st.cwd) { try { setCachedSelection(st.cwd, st.selection) } catch (eC) {} }
        return rev
      } catch (e) { return null }
    }
    // #683（F1 · ADR 的 R2b）：版本位必须活过一次往返 —— 宿主这一次没带 rev/pickedAt 时把本地那份留住。
    //   不留住的话，第一次快照合并就把它抹掉，此后这个壳上报的都是「没带版本位」，会被宿主当成最旧的一版顶回。
    //   这一行必须保持单行：tests/verify-669-choice-precedence.js 是按「含 keepUserPick 的那一行」取出真身来跑的。
    export const keepUserPick = function (cur, incoming) { try { if (cur && cur.userPicked === true && incoming && incoming.userPicked !== true && String(incoming.backendId || '') === String(cur.backendId || '')) { const out = Object.assign({}, incoming, { userPicked: true }); if (!(typeof out.rev === 'number' && isFinite(out.rev)) && typeof cur.rev === 'number' && isFinite(cur.rev)) out.rev = cur.rev; if (!(typeof out.pickedAt === 'number' && isFinite(out.pickedAt)) && typeof cur.pickedAt === 'number' && isFinite(cur.pickedAt)) out.pickedAt = cur.pickedAt; return out } } catch (e) { /* 合并守住标记失败时按原样用宿主回包 */ } return incoming }
    export const getCachedRepository = function (cwd) { try { const k = wsKeyOf(cwd); return (cwd && k) ? repositoryByCwd[k] : null } catch(e){ return cwd ? repositoryByCwd[cwd] : null } }
    export const setCachedRepository = function (cwd, repo) { try { const k = wsKeyOf(cwd); if (cwd && k) repositoryByCwd[k] = repo } catch(e){ if (cwd) repositoryByCwd[cwd] = repo } }
    // 初始化那张小卡上答的「域文档布局」按工作区记住（维护者 2026-09-21 拍板：A + 记住）。
    //   此前它只活在本次会话的内存里 —— 同一个工作区新开一个会话又得答一遍，换个会话还可能答成另一个样，
    //   而 AI 是照各自收到的那一句去写 docs/agents/domain.md 的。现在按工作区存一份，下次打开直接沿用；
    //   想改随时在黄条那颗按钮弹出的那张卡上改（那条路每次都问，见 prompts.js 的 injectSetupDecision）。
    //   存法沿用选择集同例：归一键 → 'single' | 'multi'；localStorage 不可用时降级为仅内存。
    //   取值只有这两个，与 StatusBackend.js 的 SETUP_LAYOUT_VALUES 是同一套（那边管卡片怎么画，这边管记不记得住）。
    export const SETUP_LAYOUT_BY_CWD_KEY = 'dsws.setupLayoutByCwd'
    export const setupLayoutByCwd = {}
    ;(function () {
      try {
        const raw = localStorage.getItem(SETUP_LAYOUT_BY_CWD_KEY)
        if (raw) { const m = JSON.parse(raw); if (m && typeof m === 'object') { for (const k of Object.keys(m)) { const nk = (typeof keyOf === 'function' ? keyOf(k) : k); if (!(nk in setupLayoutByCwd)) setupLayoutByCwd[nk] = m[k] } } }
      } catch (e) { /* 存储不可用降级为仅内存 */ }
    })()
    export const getCachedSetupLayout = function (cwd) {
      try {
        const k = wsKeyOf(cwd)
        const raw = (cwd && k) ? setupLayoutByCwd[k] : (cwd ? setupLayoutByCwd[cwd] : null)
        // #683（F1 · ADR 的 R6）：这张表里一条现在存 {layout, pickedAt}（与后端那张同一种形状），
        //   读出来永远只给取值（老版本存的裸字符串照旧认，外面看不出形状变了）。
        const v = String((raw && typeof raw === 'object' ? raw.layout : raw) || '').toLowerCase()
        return (v === 'single' || v === 'multi') ? v : null
      } catch (e) { return null }
    }
    export const setCachedSetupLayout = function (cwd, v) {
      try {
        // 卡上点的那一下传裸字符串（记下现在这一刻）；宿主回填传 {layout, pickedAt}（留着宿主那一刻）——
        //   两个壳各答一个样时按时刻仲裁：新的覆盖旧的（ R6：没有这个依据，落后的那扇窗永远停在老答案上）。
        let s = '', at = 0
        if (v && typeof v === 'object') { s = String(v.layout == null ? '' : v.layout).toLowerCase(); at = Number(v.pickedAt) || 0 }
        else { s = String(v == null ? '' : v).toLowerCase(); at = Date.now() }
        if (s !== 'single' && s !== 'multi') return
        const k = wsKeyOf(cwd)
        if (cwd && k) {
          const cur = setupLayoutByCwd[k]
          const curAt = (cur && typeof cur === 'object') ? (Number(cur.pickedAt) || 0) : 0
          // 刚在卡上点的那一下（at=0 不可能：卡上走的一定是裸字符串那条，时刻就是现在）；宿主回填的老值不许
          //   顶掉本地更新的那条。老版本存的裸字符串一律当 0（宿主回填、或本次点确认都会把它换成带时刻的形状）。
          if (!(at > 0 && curAt > 0) || at >= curAt) { const rec = { layout: s, pickedAt: at }; setupLayoutByCwd[k] = rec; writeTableEntry(SETUP_LAYOUT_BY_CWD_KEY, k, rec) }
        }
      } catch (e) { /* 忽略 */ }
    }
    // #683（F1 · ADR 20260921 的 R7d）：把一条记录从老键搬到新键 —— 用在「工作区根后来才认出来」那一下。
    //   为什么必须搬：工作区认根之前，选择与布局是按「会话所选目录」那把键存的；根一认出来，读写都改走根键，
    //   老键那条就此没人再看 —— 界面会一边按老键说 Markdown、另一边（按根键）说「还没有设置」。
    //   这条顺带把 #653「旧键不迁移」留下的那批记录救回来。目标键上已经有记录时不动它（只补空缺，不覆盖）。
    export const migrateCachedChoiceToKey = function (fromKey, toKey) {
      try {
        if (!fromKey || !toKey || fromKey === toKey) return false
        let moved = false
        try { if (!(toKey in selectionByCwd)) { const s = selectionByCwd[fromKey]; if (s) { selectionByCwd[toKey] = s; writeTableEntry(SELECTION_BY_CWD_KEY, toKey, s); moved = true } } } catch (e1) {}
        try { if (!(toKey in setupLayoutByCwd)) { const l = setupLayoutByCwd[fromKey]; if (l) { setupLayoutByCwd[toKey] = l; writeTableEntry(SETUP_LAYOUT_BY_CWD_KEY, toKey, l); moved = true } } } catch (e2) {}
        return moved
      } catch (e) { return false }
    }
