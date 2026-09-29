// 命名守护 host 半：持跟踪态并产出计划单（#265）；判定真源见 ../shared 命名三文件（S2 #452）。
export function createNamingGuardian(deps) {
  const { fs, timer, DEFAULT_CWD, getCacheDir, getPlatform, getRepoKey, runGh, logCtx, getFirstText, getTitle, executeOrders } = deps
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
  const NAMING_STATE_FILE = 'naming-guardian.json'   // 落盘 .dsh-mattskillsdeck-cache 目录下
  const NAMING_FALLBACK_MS = 10 * 60_000   // #709：唯一 10 分钟兜底间隔
  let _namingState = null, _namingStateDirty = false, _namingPersistTimer = null, _namingSweepBusy = false
  let _namingSweepTimer = null; let sweepAnyChanged = false, sweepAssignedTotal = 0, sweepTrigger = 'event'; function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
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
    _namingPersistTimer = timer.timeout(function () { _namingPersistTimer = null; if (_namingStateDirty) persistNamingState() }, 1200); try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'timer.schedule', { name: 'naming-persist', intervalMs: 1200 }) } catch (eL) {}
  }
  // 事件驱动（#709：无自续定时器，每跳由事件带起，另加 10 分钟至多一次的单仓兜底）。
  let _namingFallbackAt = 0, _namingSweepCursor = 0
  function namingGuardianEvent(reason, booting) {
    if (booting) { try { if (typeof globalThis !== 'undefined' && globalThis.__dswsNamingGuardianLoop) { clearTimeout(globalThis.__dswsNamingGuardianLoop); globalThis.__dswsNamingGuardianLoop = null } } catch (eG) {}; try { if (_namingStateDirty) persistNamingState() } catch (eInit) {} }
    namingSweepSoon(0, { trigger: String(reason || 'event') })
    const now = Date.now()
    if (_namingFallbackAt > 0 && now - _namingFallbackAt < NAMING_FALLBACK_MS) return
    _namingFallbackAt = now
    try { namingSweepNow({ oneRepo: true, trigger: 'fallback' }) } catch (eF) {}
  }
  function startNamingGuardianEvents() { namingGuardianEvent('apply-start', true) }   // 随 apply 启动（只做一次铺垫，不启动任何循环）

  // 建号感知（#266）：#211 三 handler 曾被整块删除（#258），现以索引差值为底座复原并入守护。

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
  // 无关新编号不硬配（#315：只有明确无关才丢弃，其余保留）。
  function keepRelatedAssigned(list, core, sessions) {
    if (!list.length || !core.isHintRelatedToTitle) return list
    return list.filter(function (a) { const e = sessions[a.sessionId]; if (!e || !e.hint) return true; try { return core.isHintRelatedToTitle(e.hint, a.title) } catch (eRel) { return true } })
  }
  /** 索引差值结算（每仓库一次）：新编号归属同仓最早等待会话；prev 缺失仅建档；即时落盘。 */
  async function namingSweepNow(opts) {
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
      // #709：兜底跳每跳最多只扫 1 个仓库，游标轮转；事件跳照旧扫全部。
      let repoNames = Object.keys(byRepo)
      if (opts && opts.oneRepo && repoNames.length) { repoNames = [repoNames[_namingSweepCursor % repoNames.length]]; _namingSweepCursor += 1 }
      for (let ri = 0; ri < repoNames.length; ri++) {
        const repoKey = repoNames[ri]
        const grp = byRepo[repoKey]
        const r = await namingFetchIndex(repoKey, grp.cwd)
        if (!r.ok) continue
        const prev = (st.indexes && st.indexes[repoKey]) || null
        let assigned = []
        try {
          if (prev) assigned = core.attributeNewNumbers({ prevIndex: prev, currIndex: r.index, sessions: grp.sessions })
          // prev 为空：首轮基线。基线同样必须入库（防下一轮把存量全量当新编号）
        } catch (eA) { assigned = [] }
            try { assigned = keepRelatedAssigned(assigned, core, st.sessions) } catch (eFilter) {}
        // #746 Knife5：差值退兜底 —— 无标题新号且同仓多等待时不分（等标题或直达），单等待才认领；
        // 有标题的仍走语义相关认领（强相关才分，无关不分，见归属纯函数）。
        try {
          if (grp.sessions.length > 1 && r.index) {
            assigned = assigned.filter(function (a) {
              if (!a) return false
              const info = r.index[String(a.number)]
              return !!(info && typeof info === 'object' && info.title)
            })
          }
        } catch (eStrict) {}
        let changed = false
        for (let i = 0; i < assigned.length; i++) {
          const a = assigned[i]
          const entry = st.sessions[a.sessionId]
          if (!entry) continue
          const next = core.reduceTrackingState(entry, { type: 'numbered', number: a.number, title: a.title })
          if (next !== entry) { st.sessions[a.sessionId] = next; changed = true }
        }
        if (!st.indexes) st.indexes = {}
        // #746 对抗 K3：未分出的新号不推进基线（留重试窗，上限 5 轮），否则多等待下永远饿死；
        // 全部分出则清本仓重试表，基线正常推进。
        try {
          let newNums = []
          try { newNums = (prev && core.newNumbersSince) ? core.newNumbersSince(prev, r.index) : [] } catch (eN) { newNums = [] }
          const got = {}
          for (let gi = 0; gi < assigned.length; gi++) { if (assigned[gi] != null) got[String(assigned[gi].number)] = true }
          const held = []
          for (let ni = 0; ni < newNums.length; ni++) { const k = String(newNums[ni]); if (!got[k]) held.push(k) }
          if (held.length) {
            if (!st.indexRetry || typeof st.indexRetry !== 'object') st.indexRetry = {}
            if (!st.indexRetry[repoKey] || typeof st.indexRetry[repoKey] !== 'object') st.indexRetry[repoKey] = {}
            const retry = st.indexRetry[repoKey]
            const kept = {}
            for (let hi = 0; hi < held.length; hi++) {
              const k = held[hi]
              const tries = (Number(retry[k]) || 0) + 1
              if (tries <= 5) { retry[k] = tries; kept[k] = true }
              else { try { delete retry[k] } catch (eD) {} }
            }
            if (Object.keys(kept).length) {
              const heldBack = {}
              for (const k of Object.keys(r.index)) { if (!kept[k]) heldBack[k] = r.index[k] }
              st.indexes[repoKey] = heldBack
              markNamingStateDirty()
            } else {
              st.indexes[repoKey] = r.index
            }
          } else {
            try { if (st.indexRetry && st.indexRetry[repoKey]) delete st.indexRetry[repoKey] } catch (eC) {}
            st.indexes[repoKey] = r.index
          }
        } catch (eBase) {
          try { st.indexes[repoKey] = r.index } catch (eB2) {}
        }
        if (changed) { await persistNamingState(); sweepAnyChanged = sweepAnyChanged || changed; sweepAssignedTotal += assigned.length } else markNamingStateDirty()
      }
      try { const trig = sweepTrigger, cnt = sweepAssignedTotal, chg = sweepAnyChanged; sweepTrigger = 'tick'; sweepAnyChanged = false; sweepAssignedTotal = 0; if (chg && logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'naming.sweep', { trigger: trig, count: cnt }) } catch (eL) {}
    } catch (eSweep) { /* 净失败静默：下轮 tick 重试 */ } finally { _namingSweepBusy = false }
  }
  /** 即时推进：短窗合并（防堆积），注册/白名单/认领推送/四种事件共用。opts.trigger 只影响日志里的来路。 */
  function namingSweepSoon(delayMs, opts) {
    const delay = typeof delayMs === 'number' ? delayMs : 1500
    if (_namingSweepTimer) { try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'timer.schedule', { name: 'naming-sweep', intervalMs: delay }) } catch (eL) {}; return }
    _namingSweepTimer = timer.timeout(function () {
      _namingSweepTimer = null
      try { sweepTrigger = (opts && opts.trigger) || 'soon'; namingSweepNow(opts) } catch (e) {}
    }, delay)
  }

  /** 受踪登记唯一实现：#265 兼容名与 #266 复原名共用同一本体。基准收两种：占位（[New] …）与编号档（[#n] …）。 */
  async function namingEnsureTracked(args) {
    const sid = args && args.sessionId, baseline = args && args.baselineTitle
    if (!sid || !baseline) return { ok: false, error: { kind: 'parse', message: '缺少 sessionId/baselineTitle' } }
    const core = await getNamingCore()
    if (!core) return { ok: false, error: { kind: 'parse', message: '命名核心未就绪' } }
    const numbered = core.parseNumberedTitle ? core.parseNumberedTitle(baseline) : null
    if (!core.isPlaceholderTitle(baseline) && !numbered) return { ok: false, error: { kind: 'parse', message: 'baselineTitle 非占位四式或编号档' } }
    // 编号档的编号要能当真：负数与非数字拒收（本地 Markdown 后端的地图编号是 00，即 0，合法）。
    if (numbered && !(isFinite(numbered.number) && numbered.number >= 0)) return { ok: false, error: { kind: 'parse', message: '编号档编号非法' } }
    const wroteOurs = !(args && args.wroteTitle === false)   // 客户端报告这次改名到底成功没有；缺省按成功（老调用方与旧账行为不变）
    const cwd = (args && args.cwd) || DEFAULT_CWD
    let repoKey = namingRepoKeyOf(args)
    if (!repoKey) repoKey = await namingResolveRepoKey(cwd)
    const st = await loadNamingState(), entry = st.sessions[sid]
    if (!entry) {
      st.sessions[sid] = core.createTrackingState({ sessionId: sid, baselineTitle: baseline, repoKey: repoKey, cwd: cwd, baselineIsOurs: wroteOurs })
      // 编号档（「在新会话打开」那条路）：编号与标题当场已知，收进来守 [#n] 名不被底座首句名盖掉；刻意不写 lastMachineTitle（值比对锁以基线为准，锁执行点才认得出「首句派生可盖」）。
      if (numbered) st.sessions[sid] = core.reduceTrackingState(st.sessions[sid], { type: 'numbered', number: numbered.number, numberText: numbered.numberText, title: numbered.title })
    } else if (numbered && !entry.locked && (Number(entry.number) !== numbered.number || String(entry.baselineTitle) !== String(baseline))) {
      // 同一会话被再次拿去开票（复用门只挑空白会话，所以这是真会发生的路：换一张票、或同一张票的标题改过了）：台账必须跟着换成新的 [#n] 名，否则目标名还是旧名，执行点会把它判成手改并永久锁定。reducer 有防串名守卫（换号即拒），故直接改写。
      entry.stage = core.NAMING_STAGES.NUMBERED; entry.number = numbered.number; entry.numberText = numbered.numberText; entry.numberTitle = numbered.title
      entry.baselineTitle = baseline; entry.baselineIsOurs = wroteOurs; entry.lastMachineTitle = null; entry.numberedDone = false; entry.hint = null; entry.lastDraftHint = null
    } else if (entry.repoKey == null && repoKey) {
      entry.repoKey = repoKey
    }
    if (args && args.hint) st.sessions[sid] = core.reduceTrackingState(st.sessions[sid], { type: 'signal', hint: String(args.hint).slice(0, 80) })
    await persistNamingState()   // 即时落盘（#265）：注册只发生一次，宽限期内被杀会永久失察
    namingSweepSoon(800)   // #266：注册即打索引基线/结算（800ms 短窗）
    return { ok: true }
  }
  const namingRegisterHandler = function (args) { return namingEnsureTracked(args) }
  // 注册双名同一本体（#265 兼容名 / #211 复原名，client 已切规范入口）。

  async function handleNamingSignal(args) {
    const sid = args && args.sessionId, hint = args && args.hint
    if (!sid || !hint) return { ok: true, tracked: false }
    const st = await loadNamingState(), entry = st.sessions[sid]
    if (!entry) return { ok: true, tracked: false }   // 非受踪会话：信号无属主，忽略（#746 Knife4：回 tracked 区分码）
    const core = await getNamingCore()
    if (!core) return { ok: true }
    if (!entry.locked) { st.sessions[sid] = core.reduceTrackingState(entry, { type: 'signal', hint: String(hint).slice(0, 80) }); markNamingStateDirty() }
    return { ok: true, tracked: true }
  }

  // 在途守卫：这活会读会话日志取首句、还会真改名，生产日志里单次出现几十秒；正在跑就直接返回、不排队。
  let _namingPlanBusy = false
  async function handleNamingPlan() {
    if (_namingPlanBusy) return { ok: true, orders: [], tracked: [], failures: [] }
    _namingPlanBusy = true
    try { return await namingPlanOnce() } finally { _namingPlanBusy = false }
  }
  async function namingPlanOnce() {
    try { namingGuardianEvent('client-pull') } catch (eEv) {}
    const core = await getNamingCore()
    if (!core) return { ok: true, orders: [], tracked: [], failures: [] }
    const st = await loadNamingState()
    const orders = [], tracked = [], failures = []
    for (const sid in st.sessions) {
      const s = st.sessions[sid]
      if (!s) continue
      let curTitle = null; try { if (typeof getTitle === 'function') curTitle = await getTitle(sid) } catch (eT) {}
      const o = core.planOrderFor(s, Date.now(), core.NAMING_HINT_GRACE_MS, curTitle)
      if (o) orders.push(o)
      // #266：终局标记供界面侧清理（锁账/编号落定/精修档即 done）
      let done = !!s.locked || s.stage === core.NAMING_STAGES.REFINED
      if (!done && s.stage === core.NAMING_STAGES.NUMBERED && s.number != null) {
        done = !!s.numberedDone
        // 对抗 K2：落定重算必须带编号原文（00 号算出 [#00] 才对得上已落定的名，否则 done 永假）。
        if (!done) { try { done = (s.lastMachineTitle != null && s.lastMachineTitle === core.newSessionTitle({ number: s.number, numberText: s.numberText, title: s.numberTitle || '' })) } catch (eD) {} }
      }
      tracked.push({ sessionId: sid, stage: s.stage, done: done })
      // #746 Knife3：在位即落定 —— 现名已是编号目标但落定标记仍假时，直接收敛记账，
      // 不再等一次改名事件（现名等于目标时归因恒为在位，不会误判手改，见共享核心第三或条件）。
      try {
        if (!done && s.stage === core.NAMING_STAGES.NUMBERED && s.number != null && !s.numberedDone && !s.locked) {
          let want = null
          try { want = core.newSessionTitle({ number: s.number, numberText: s.numberText, title: s.numberTitle || '' }) } catch (eW) {}
          if (want && curTitle === want) {
            st.sessions[sid] = core.reduceTrackingState(s, { type: 'renamed', title: curTitle })
            markNamingStateDirty()
            done = true
            tracked[tracked.length - 1].done = true
          }
        }
      } catch (eConv) {}
      const fi = core.namingFailureInfo(s)
      if (fi) failures.push(fi)
    }
    // #315：同仓有带线索草稿单时抑制裸档单（只改有线索的目标会话）。
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
    for (let i = 0; i < orders.length; i++) { const oo = orders[i]; if (oo && oo.lock && typeof getFirstText === 'function') { try { oo.lock.firstUserText = await getFirstText(oo.sessionId) } catch (eFt) {} } } // 首句随单下发供免锁比对（读而不激活；失败即 null，调用方降级走旧判据）。每一单都下发：机器写过之后再被底座首句名盖掉的那种也要用（只看 lastMachineTitle 为空会把那种判成手改并永久锁定）。
    try { if (typeof executeOrders === 'function') await executeOrders(orders) } catch (eEx) {} // #746 宿主直执行（拿号改名同一刻；面缺失即回落，客户端老路照旧）
    return { ok: true, orders: orders, tracked: tracked, failures: failures }
  }

  async function handleNamingResult(args) {
    const sid = args && args.sessionId, outcome = args && args.outcome
    if (!sid || !outcome) return { ok: false, error: { kind: 'parse', message: '缺少 sessionId/outcome' } }
    const st = await loadNamingState(), entry = st.sessions[sid]
    if (!entry) return { ok: true }
    const core = await getNamingCore()
    if (!core) return { ok: true }
    // renamed/locked/failed 入账即时落盘（#265/#267：锁账与重试预算跨重启一致）。
    if (outcome === 'renamed' && args.title) {
      st.sessions[sid] = core.reduceTrackingState(entry, { type: 'renamed', title: String(args.title) })
      await persistNamingState()
      return { ok: true }
    }
    if (outcome === 'locked') {
      // 让位原因照执行点的归因码记（从前一律写「用户改的」，那是假话：目标陈旧、读不到首句、我们自己没写成都会被记成手改）。
      st.sessions[sid] = core.reduceTrackingState(entry, { type: 'locked' }); try { if (logCtx) logCtx.fire('info', 'naming.lock', { sidHash: hash8(sid), reason: String((args && args.reason) || 'hand-edit').slice(0, 40) }) } catch (eL) {}
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

  // #746：摘要编排读的只读快照（返回拷贝；冷启动返回 null，调用方静默跳过）。
  async function getEntry(sid) {
    try { const st = await loadNamingState(); const s = st.sessions[sid]; return s ? Object.assign({}, s) : null } catch (e) { return null }
  }
  // #746：摘要结果入账（ok 带好线索并记 summaryOnce；失败记 summaryFailed 永不补调；即时落盘）。
  async function applySummaryResult(args) {
    const sid = args && args.sessionId
    if (!sid) return { ok: false }
    const st = await loadNamingState(), entry = st.sessions[sid]
    if (!entry || entry.locked) return { ok: true }
    const core = await getNamingCore()
    if (!core) return { ok: true }
    if (args.ok && args.hint) st.sessions[sid] = core.reduceTrackingState(core.reduceTrackingState(entry, { type: 'signal', hint: String(args.hint).slice(0, 80) }), { type: 'summaryDone' })
    else st.sessions[sid] = core.reduceTrackingState(entry, { type: 'summaryFailed' })
    await persistNamingState()
    return { ok: true }
  }
  // #746：建票直达（调用会话即建号会话，无需语义匹配；仍守等号状态与锁；幂等收敛）。
  // 编号原文随事件带走（本地地图 00 号保持 [#00] 形状，不被改写成 [0]）。
  async function handleDirectCreated(args) {
    const sid = args && args.sessionId, num = Number(args && args.key)
    if (!sid || !isFinite(num) || num < 0) return { ok: false }
    const st = await loadNamingState(), entry = st.sessions[sid]
    const core = await getNamingCore()
    if (!entry || !core || !core.isNumberAwaitStage(entry)) return { ok: true, attributed: false }
    st.sessions[sid] = core.reduceTrackingState(entry, { type: 'numbered', number: num, numberText: String((args && args.key) != null ? args.key : num).slice(0, 20), title: args.title })
    await persistNamingState()
    try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'naming.sweep', { trigger: 'direct-created', count: 1 }) } catch (eL) {}
    return { ok: true, attributed: true }
  }
    async function handleCancelNewSessionWatcher(args) {
    const sid = args && args.sessionId
    if (!sid) return { ok: false, error: { kind: 'parse', message: '缺少 sessionId' } }
    const st = await loadNamingState()
    if (!st.sessions[sid]) return { ok: true, cancelled: false }
    delete st.sessions[sid]
    await persistNamingState()
    return { ok: true, cancelled: true }
  }
  async function handleAwaitCreatedIssue(args) {
    const sid = args && args.sessionId
    if (!sid) return { ok: false, error: { kind: 'parse', message: '缺少 sessionId' } }
    const core = await getNamingCore()
    const st = await loadNamingState(), entry = st.sessions[sid]
    const watching = !!(core && entry && core.isNumberAwaitStage(entry))
    if (watching) namingSweepSoon(120)
    return { ok: true, watching: watching, stage: (entry && entry.stage) || null }
  }
  // #498 电话三态行：命名族 7 电话（注册双名同一本体，按规范入口记 wf.registerNewSessionWatcher）成功 info、失败 warn；高频 namingPlan 成功按需 debug（5 秒轮询，只记行不记体）。
  function phoneLog(method, kind, level, t0, res, err) { try {
    if (err !== undefined && err !== null) { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((err && err.message) || err)) }) }
    else if (res && res.ok) { if (level === 'debug') { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) } else if (logCtx) logCtx.fire('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) }
    else if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((res && ((res.error && res.error.message) || res.error)) || 'naming-not-ok')) }) } catch (eL) {} }
  function loggedPhone(method, kind, level, fn) { return async function () { const t0 = Date.now(); try { const r = await fn.apply(null, arguments); phoneLog(method, kind, level, t0, r); return r } catch (e) { phoneLog(method, kind, level, t0, null, e); throw e } } }
  return { namingSweepSoon, namingRegisterHandler: loggedPhone('wf.registerNewSessionWatcher', 'naming-register', 'info', namingRegisterHandler), handleNamingSignal: loggedPhone('wf.namingSignal', 'naming-signal', 'info', handleNamingSignal), handleNamingPlan: loggedPhone('wf.namingPlan', 'naming-plan', 'debug', handleNamingPlan), handleNamingResult: loggedPhone('wf.namingResult', 'naming-result', 'info', handleNamingResult), handleCancelNewSessionWatcher: loggedPhone('wf.cancelNewSessionWatcher', 'naming-cancel', 'info', handleCancelNewSessionWatcher), handleAwaitCreatedIssue: loggedPhone('wf.awaitCreatedIssue', 'naming-await', 'info', handleAwaitCreatedIssue), getEntry: getEntry, applySummaryResult: applySummaryResult, handleDirectCreated: handleDirectCreated, namingGuardianEvent, startNamingGuardianEvents }
}