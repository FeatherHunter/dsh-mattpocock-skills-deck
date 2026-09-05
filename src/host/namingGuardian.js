// src/host/namingGuardian.js —— 命名守护 host 半（H6 #450 从 host/index.js 479–821 搬出，纯结构、行为零变化）。
// 以后谁改它：改命名跟踪态、守护循环或建号感知结算的人。预估约350行，超 350 打回。
// 接线：由 index.js 动态 import 加载；即时推进经 index 同步委托转供给 _repo 接线；边界：../shared 命名标题等 3 文件同名不同层归 S2 #452（此处合并引用），本文件只动 host 半。
export function createNamingGuardian(deps) {
  const { fs, timer, DEFAULT_CWD, getCacheDir, getPlatform, getRepoKey, runGh, logCtx } = deps
  // ============ 命名守护（#265 · 草稿档垂直线 · host 半）============
  // 分工（#264 D2）：本侧为常驻轻量任务 —— 持跟踪态（落盘 .dsh-mattskillsdeck-cache/naming-guardian.json，
  // 写入方式与现缓存一致：platform.fs.resolve + fs.writeText）并维护状态；「待办改名计划单」经
  // wf.namingPlan 供界面侧渲染钩子拉取。纯判定真源 = ../shared/naming-titles.js 等 3 个文件（运行时引用合并，
  // 与 check-catalog 同模式），本文件不含第二处命名实现。
  let _namingCore = null
  let _namingCoreInit = null
  async function getNamingCore() {
    if (_namingCore) return _namingCore
    if (!_namingCoreInit) {
      _namingCoreInit = (async function () {
        try { const ms = await Promise.all([import('../shared/naming-titles.js'), import('../shared/naming-tracking.js'), import('../shared/naming-attribution.js')]); _namingCore = Object.assign({}, ms[0], ms[1], ms[2]); return _namingCore } catch (e) { return null }
      })()
    }
    return _namingCoreInit
  }
  const NAMING_STATE_FILE = 'naming-guardian.json'
  const NAMING_TICK_MS = 15000
  const NAMING_SWEEP_MS = NAMING_TICK_MS
  let _namingState = null            // { version:1, sessions:{sid:跟踪态}, indexes:{repoKey:索引快照} } 内存态（加载自磁盘，变更防抖落盘）
  let _namingStateDirty = false
  let _namingPersistTimer = null
  let _namingLoopTimer = null
  // #266 建号感知：索引差值结算的防重入/防堆积守卫（host 常驻 tick + 即时路径共用）
  let _namingSweepBusy = false
  let _namingSweepTimer = null; let sweepAnyChanged = false, sweepAssignedTotal = 0, sweepTrigger = 'tick'; function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  function namingDefaultState() { return { version: 1, sessions: {}, indexes: {} } }
  async function loadNamingState() {
    if (_namingState) return _namingState
    _namingState = namingDefaultState()
    try {
      if (fs !== undefined && typeof fs.readText === 'function' && typeof fs.resolve === 'function') {
        const dir = await getCacheDir()
        if (dir) {
          const platform2 = await getPlatform()
          const t = await platform2.fs.resolve(platform2.path.join(dir, NAMING_STATE_FILE))
          const txt = await fs.readText(t)
          if (txt) {
            const j = JSON.parse(txt)
            // #266：盘上结构追加 indexes（各仓库上次 issue 索引快照，差值底座）；
            // 旧账（v1 无 indexes）友好归一为 {}；编号相关字段缺失按 null/false 容错读取。
            if (j && j.version === 1 && j.sessions && typeof j.sessions === 'object') { _namingState = j; if (!_namingState.sessions) _namingState.sessions = {}; if (!_namingState.indexes || typeof _namingState.indexes !== 'object') _namingState.indexes = {} }
          }
        }
      }
    } catch (eLoad) { /* 损坏/缺失即回默认空态，注册侧原子重建 */ }
    return _namingState
  }
  async function persistNamingState() {
    _namingStateDirty = false
    try {
      if (fs === undefined || typeof fs.writeText !== 'function' || typeof fs.resolve !== 'function') return
      const dir = await getCacheDir(); if (!dir) return
      const platform2 = await getPlatform()
      const t = await platform2.fs.resolve(platform2.path.join(dir, NAMING_STATE_FILE))
      await fs.writeText(t, JSON.stringify(_namingState || namingDefaultState()))
    } catch (ePersist) { /* 写失败不影响主流程，下轮 tick 重试 */ }
  }
  function markNamingStateDirty() {
    _namingStateDirty = true
    if (_namingPersistTimer) return
    _namingPersistTimer = timer.timeout(function () { _namingPersistTimer = null; if (_namingStateDirty) persistNamingState() }, 1200)
  }
  function namingLoopTick() {
    try { if (_namingStateDirty) persistNamingState() } catch (eTick) {}
    // #266：常驻 tick 承担索引差值结算（建号感知底座；防重入由 _namingSweepBusy 保证）
    try { namingSweepNow() } catch (eSweepT) {}
    _namingLoopTimer = timer.timeout(namingLoopTick, NAMING_TICK_MS)
  }
  function startNamingGuardianLoop() {
    // 热重载守卫：上一代 apply 遗留的循环先清（globalThis 单例句柄）
    try {
      if (typeof globalThis !== 'undefined' && globalThis.__dswsNamingGuardianLoop) { try { clearTimeout(globalThis.__dswsNamingGuardianLoop) } catch (e0) {} }
    } catch (eG) {}
    _namingLoopTimer = timer.timeout(namingLoopTick, NAMING_TICK_MS); try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'timer.schedule', { name: 'naming-guardian', intervalMs: NAMING_TICK_MS }) } catch (eL) {}
    try { if (typeof globalThis !== 'undefined') globalThis.__dswsNamingGuardianLoop = _namingLoopTimer } catch (eK) {}
  }

  // ============ 建号感知复原（#266 · F1/F2 修复义务）============
  // 历史：#211 的 registerNewSessionWatcher / cancelNewSessionWatcher / awaitCreatedIssue 三
  // handler 于 e98f636 重构中被整块静默删除且无替身（#258 F1 回归），导致「AI 在会话内
  // 自行建号」的主流程零事件。本段按 #264 决议以 issue 索引差值为底座复原，职责并入持久化
  // 命名守护：注册收编跟踪态 + 触发即时快照；结算由常驻 tick 与即时路径（runGh 白名单 /
  // 认领推送 nudge）共用同一入口（三操作存在的守卫断言见 verify-naming-guardian）。

  /** repoKey 归一：接受 'owner/name' 字符串或 { owner, name }；无效返回 null。 */
  function namingRepoKeyOf(args) {
    if (!args) return null
    let rk = args.repoKey
    if (rk && typeof rk === 'object') { const o = rk.owner || rk.login; const n = rk.name || rk.repo; rk = (o && n) ? String(o) + '/' + String(n) : null }
    if (typeof rk === 'string' && rk.indexOf('/') > 0) return rk
    return null
  }
  async function namingResolveRepoKey(cwd) {
    try {
      const repo = await getRepoKey(cwd || DEFAULT_CWD)
      if (repo && repo.owner && repo.name) return repo.owner + '/' + repo.name
    } catch (e) {}
    return null
  }
  /** 索引快照：gh api 全量（open+closed，剔 PR），结构 { 'n': { title, state, updatedAt } }。 */
  async function namingFetchIndex(repoKey, cwd) {
    try {
      const url = 'repos/' + repoKey + '/issues?state=all&per_page=100'
      const r = await runGh(['api', '--paginate', url, '--jq', '.[] | select(.pull_request == null) | {number: .number, title: .title, state: .state, updatedAt: .updated_at}'], cwd || DEFAULT_CWD)
      if (!r.ok) return { ok: false, error: r }
      const index = {}
      const lines = String(r.text || '').split(/\r?\n/).filter(Boolean)
      for (let i = 0; i < lines.length; i++) {
        try {
          const item = JSON.parse(lines[i])
          if (item && item.number !== undefined && item.number !== null) {
            index[String(item.number)] = { title: String(item.title || ''), state: String(item.state || '').toUpperCase(), updatedAt: String(item.updatedAt || '') }
          }
        } catch (eLine) {}
      }
      return { ok: true, index: index }
    } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
  }
  /**
   * 索引差值结算（每仓库一次）：新编号（升序）→ 归属同仓库最早仍处占位/草稿档的受踪会话
   * （归属判定为共享核心纯函数 attributeNewNumbers；prev 快照缺失 → 仅基线建档不归属，
   * 避免把存量全量误归属）。归属即时落盘（关键事件）；索引快照随脏账防抖落盘。
   */
  async function namingSweepNow() {
    if (_namingSweepBusy) return
    _namingSweepBusy = true
    try {
      const core = await getNamingCore()
      if (!core) return
      const st = await loadNamingState()
      const byRepo = {}
      for (const sid in st.sessions) {
        const s = st.sessions[sid]
        if (!s || !s.repoKey) continue
        if (!core.isNumberAwaitStage(s)) continue
        if (!byRepo[s.repoKey]) byRepo[s.repoKey] = { sessions: [], cwd: s.cwd || DEFAULT_CWD }
        byRepo[s.repoKey].sessions.push(s)
      }
      for (const repoKey in byRepo) {
        const grp = byRepo[repoKey]
        const r = await namingFetchIndex(repoKey, grp.cwd)
        if (!r.ok) continue
        const prev = (st.indexes && st.indexes[repoKey]) || null
        let assigned = []
        try {
          if (prev) assigned = core.attributeNewNumbers({ prevIndex: prev, currIndex: r.index, sessions: grp.sessions })
          // prev 为空：首轮基线。基线同样必须入库（防下一轮把存量全量当新编号）
        } catch (eA) { assigned = [] }
        // #315 追加修复：无关新号不硬配。
        try {
          if (assigned.length && core.isHintRelatedToTitle) {
            const kept = [];
            for (let i = 0; i < assigned.length; i++) {
              const a = assigned[i];
              const entry = st.sessions[a.sessionId];
              if (!entry) { kept.push(a); continue; }
              const hint = entry.hint;
              if (hint) { try { if (!core.isHintRelatedToTitle(hint, a.title)) continue; } catch (eRel) {} }
              kept.push(a);
            }
            assigned = kept;
          }
        } catch (eFilter) {}
        let changed = false
        for (let i = 0; i < assigned.length; i++) {
          const a = assigned[i]
          const entry = st.sessions[a.sessionId]
          if (!entry) continue
          const next = core.reduceTrackingState(entry, { type: 'numbered', number: a.number, title: a.title })
          if (next !== entry) { st.sessions[a.sessionId] = next; changed = true }
        }
        if (!st.indexes) st.indexes = {}
        st.indexes[repoKey] = r.index
        if (changed) { await persistNamingState(); sweepAnyChanged = sweepAnyChanged || changed; sweepAssignedTotal += assigned.length } else markNamingStateDirty()
      }
      try { const trig = sweepTrigger, cnt = sweepAssignedTotal, chg = sweepAnyChanged; sweepTrigger = 'tick'; sweepAnyChanged = false; sweepAssignedTotal = 0; if (chg && logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'naming.sweep', { trigger: trig, count: cnt }) } catch (eL) {}
    } catch (eSweep) { /* 净失败静默：下轮 tick 重试 */ } finally { _namingSweepBusy = false }
  }
  /** 即时推进：短窗合并（防堆积），注册/白名单/认领推送 nudge 共用。 */
  function namingSweepSoon(delayMs) {
    const delay = typeof delayMs === 'number' ? delayMs : 1500
    if (_namingSweepTimer) { try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'timer.schedule', { name: 'naming-sweep', intervalMs: delay }) } catch (eL) {}; return }
    _namingSweepTimer = timer.timeout(function () {
      _namingSweepTimer = null
      try { sweepTrigger = 'soon'; namingSweepNow() } catch (e) {}
    }, delay)
  }

  /** 受踪登记唯一实现：#265 兼容名与 #266 复原名共用同一本体。 */
  async function namingEnsureTracked(args) {
    const sid = args && args.sessionId
    const baseline = args && args.baselineTitle
    if (!sid || !baseline) return { ok: false, error: { kind: 'parse', message: '缺少 sessionId/baselineTitle' } }
    const core = await getNamingCore()
    if (!core || !core.isPlaceholderTitle(baseline)) return { ok: false, error: { kind: 'parse', message: 'baselineTitle 非占位四式' } }
    const cwd = (args && args.cwd) || DEFAULT_CWD
    let repoKey = namingRepoKeyOf(args)
    if (!repoKey) repoKey = await namingResolveRepoKey(cwd)
    const st = await loadNamingState()
    if (!st.sessions[sid]) {
      st.sessions[sid] = core.createTrackingState({ sessionId: sid, baselineTitle: baseline, repoKey: repoKey, cwd: cwd })
    } else if (st.sessions[sid].repoKey == null && repoKey) {
      st.sessions[sid].repoKey = repoKey
    }
    if (args && args.hint) st.sessions[sid] = core.reduceTrackingState(st.sessions[sid], { type: 'signal', hint: String(args.hint).slice(0, 80) })
    // 即时持久化（#265 崩溃窗口补强）：注册只在会话创建时发生一次，若只走防抖，宽限期内进程
    // 被杀会让该会话永久失察（客户端不会重注册）——关键事件必须落盘后才算受理。
    await persistNamingState()
    // #266：注册即打索引基线/结算（800ms 短窗；首轮仅建档，其后命中即时信号即优先归属）
    namingSweepSoon(800)
    return { ok: true }
  }
  const namingRegisterHandler = function (args) { return namingEnsureTracked(args) }
  // 两入口同一本体：wf.namingRegister（#265 四操作之一，兼容保留）/
  // wf.registerNewSessionWatcher（#211 复原名 · 注册监视 —— 规范入口，client 已切换调用）

  async function handleNamingSignal(args) {
    const sid = args && args.sessionId
    const hint = args && args.hint
    if (!sid || !hint) return { ok: true }
    const st = await loadNamingState()
    const entry = st.sessions[sid]
    if (!entry) return { ok: true }   // 非受踪会话：信号无属主，忽略
    const core = await getNamingCore()
    if (!core) return { ok: true }
    if (!entry.locked) { st.sessions[sid] = core.reduceTrackingState(entry, { type: 'signal', hint: String(hint).slice(0, 80) }); markNamingStateDirty() }
    return { ok: true }
  }

  async function handleNamingPlan() {
    const core = await getNamingCore()
    if (!core) return { ok: true, orders: [], tracked: [], failures: [] }
    const st = await loadNamingState()
    const orders = []
    const tracked = []
    const failures = []   // #267：定败清单（有限重试耗尽）→ 面板级提醒（DetailsDock 横幅）
    for (const sid in st.sessions) {
      const s = st.sessions[sid]
      if (!s) continue
      const o = core.planOrderFor(s, Date.now(), core.NAMING_HINT_GRACE_MS)
      if (o) orders.push(o)
      // #266：tracked 携带终局标记供界面侧清理（done = 永不/不再出单：锁账、编号落定、精修档）
      let done = false
      if (s.locked) done = true
      else if (s.stage === core.NAMING_STAGES.REFINED) done = true
      else if (s.stage === core.NAMING_STAGES.NUMBERED && s.number != null) {
        if (s.numberedDone) done = true
        else {
          try { done = (s.lastMachineTitle != null && s.lastMachineTitle === core.newSessionTitle({ number: s.number, title: s.numberTitle || '' })) } catch (eD) {}
        }
      }
      tracked.push({ sessionId: sid, stage: s.stage, done: done })
      // #267：定败画像随单回包 —— 化解前持续呈现；字段裁剪由共享核心统一裁定
      const fi = core.namingFailureInfo(s)
      if (fi) failures.push(fi)
    }
    // #315 隔离修复：同仓库下若存在带 hint 的草稿单，则抑制同仓库的裸档单（hint == null），避免无线索会话被误改
    // 保证「只改有线索的目标会话」，裸档会话保持占位直到自身产生线索；同仓库判定以 repoKey 为键
    try {
      const byRepoHasHint = {}
      for (let i = 0; i < orders.length; i++) {
        const o = orders[i]
        if (o && o.kind === 'draft' && o.hint) {
          const so = st.sessions[o.sessionId]
          const rk = so && so.repoKey
          if (rk) byRepoHasHint[rk] = true
        }
      }
      if (Object.keys(byRepoHasHint).length) {
        const kept = []
        for (let i = 0; i < orders.length; i++) {
          const o = orders[i]
          if (o && o.kind === 'draft' && !o.hint) {
            const so = st.sessions[o.sessionId]
            const rk = so && so.repoKey
            if (rk && byRepoHasHint[rk]) continue
          }
          kept.push(o)
        }
        orders.length = 0
        for (let i = 0; i < kept.length; i++) orders.push(kept[i])
      }
    } catch (eFilter) {}
    return { ok: true, orders: orders, tracked: tracked, failures: failures }
  }

  async function handleNamingResult(args) {
    const sid = args && args.sessionId
    const outcome = args && args.outcome
    if (!sid || !outcome) return { ok: false, error: { kind: 'parse', message: '缺少 sessionId/outcome' } }
    const st = await loadNamingState()
    const entry = st.sessions[sid]
    if (!entry) return { ok: true }
    const core = await getNamingCore()
    if (!core) return { ok: true }
    // renamed/locked 入账并即时持久化（#265 崩溃窗口补强）：锁账丢失会危及「手改永不被覆盖」，
    // 升级账丢失会让重启续跑多付一次改名——均为关键状态变更，不当延迟落盘。
    // #267：failed 同样即时落盘 —— 有限重试预算（连败计数/冷却窗）跨拉询与重启一致，
    // 耗尽即定败并入 namingPlan.failures 面板级清单；预算语义由共享核心统一裁定。
    if (outcome === 'renamed' && args.title) {
      st.sessions[sid] = core.reduceTrackingState(entry, { type: 'renamed', title: String(args.title) })
      await persistNamingState()
      return { ok: true }
    }
    if (outcome === 'locked') {
      st.sessions[sid] = core.reduceTrackingState(entry, { type: 'locked' }); try { if (logCtx) logCtx.fire('info', 'naming.lock', { sidHash: hash8(sid), reason: 'user-modified' }) } catch (eL) {}
      await persistNamingState()
      return { ok: true }
    }
    if (outcome === 'failed') {
      const next = core.reduceTrackingState(entry, { type: 'renameFailed', error: args.error })
      st.sessions[sid] = next
      await persistNamingState()
      return { ok: true, exhausted: !!core.namingFailureInfo(next) }
    }
    return { ok: true }
  }

  // ---- #211 复原名三操作（#266 复原 · 以索引差值为底座，职责并入守护；守卫断言钉死其存在）----
  // 取消监视：从受踪账目移除（仅终局清理路径调用：界面半判定会话已不存在且 done）
  async function handleCancelNewSessionWatcher(args) {
    const sid = args && args.sessionId
    if (!sid) return { ok: false, error: { kind: 'parse', message: '缺少 sessionId' } }
    const st = await loadNamingState()
    if (!st.sessions[sid]) return { ok: true, cancelled: false }
    delete st.sessions[sid]
    await persistNamingState()
    return { ok: true, cancelled: true }
  }
  // 等待建号：状态查询（是否仍处占位/草稿档且未获号）+ 即时推进（nudge 索引差值结算）
  async function handleAwaitCreatedIssue(args) {
    const sid = args && args.sessionId
    if (!sid) return { ok: false, error: { kind: 'parse', message: '缺少 sessionId' } }
    const core = await getNamingCore()
    const st = await loadNamingState()
    const entry = st.sessions[sid]
    const watching = !!(core && entry && core.isNumberAwaitStage(entry))
    if (watching) namingSweepSoon(120)
    return { ok: true, watching: watching, stage: (entry && entry.stage) || null }
  }
  return { namingSweepSoon, namingRegisterHandler, handleNamingSignal, handleNamingPlan, handleNamingResult, handleCancelNewSessionWatcher, handleAwaitCreatedIssue, startNamingGuardianLoop }
}