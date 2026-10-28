/**
 * src/host/namingGuardian.ts —— 命名守护宿主半（来源：src/host/namingGuardian.js，issue #1247 转写，只加类型标注与注释）。
 * #1445 动过的唯一一处运行路径：索引取数（namingFetchIndex）从直调 gh api 改走只读会话的 listPage，原因见那一处的注释。
 *
 * 为什么要有它（一句话）：跟踪态持有、落盘台账与事件驱动的索引结算；判定真源见 shared 命名三文件。
 *
 * 三条不能改的约定（改之前先看原 namingGuardian.js 头注释与调用点 index.ts）：
 * 1. 行为零变化（#1445 那次取数改造除外，已在上方点明）：其余逻辑逐行对应；相对导入保留 .js 后缀，由 scripts/ts-hook.mts 改指同名 .ts。
 * 2. 只写可剥离 TypeScript：不新增运行时语法（禁用 enum 与构造函数参数属性），类型一律 import type 或内联标注，转译后与原 .js 逐行同义。
 * 3. 不新增任何 import 边：只给已有引用加类型，不引入新模块依赖；Node 内建模块的类型缺席由文件内局部声明与 @ts-expect-error 承接，不装 @types/node。
 */

// ---------------------------------------------------------------------------
// 类型（#1247 转 TypeScript：只写类型不写实现）。
//
// 为什么标成这样：进来的依赖全部由装配点显式传入，形状按本文件实际用到的成员写成最小；
// 从外面进来的东西（客户端参数、后端行数据、文件里读出的 JSON）一律按 any 或 unknown 收，
// 收窄发生在运行时的 typeof 与 Array.isArray 判断里 —— 类型不替代那些运行时判断。
// ---------------------------------------------------------------------------

/** 本文件组装函数的依赖：全部由调用方显式传入，缺席时按原逻辑默认处理。 */
type Deps = any;

/** 客户端调电话时送进来的参数：JSON 边界，形状由调用方保证，本文件只做运行时判空。 */
type WfArgs = any;

// 命名守护 host 半：持跟踪态并产出计划单（#265）；判定真源见 ../shared 命名三文件（S2 #452）。
//
// 本文件三个时间旋钮都住中央 YAML，这里直接引用中央常量，调时间改 YAML：
//   NAMING_FALLBACK_MS —— 「至多每 10 分钟做一次单仓兜底扫描」的间隔（住 config/intervals.yaml 的
//     namingFallbackIntervalMs 键）：事件跳每跳都跑，兜底跳靠它限频，保证没有任何事件的仓库也终会结算；
//   NAMING_PERSIST_DEBOUNCE_MS —— 命名台账落盘的合并窗（住 config/intervals.yaml 的
//     namingPersistDebounceMs 键）：一次扫描里可能连标几次脏，落盘是整份覆写，窗口内合成一次写；
//   NAMING_SWEEP_SOON_MS —— 即时推进（namingSweepSoon）没带延时参数时的缺省合并窗（住
//     config/intervals.yaml 的 namingSweepSoonMs 键）：短窗内多次事件合成一次索引扫描，防堆积。
// 值由 tests/verify-time-config.ts 看守一致。
import { NAMING_FALLBACK_INTERVAL_MS as NAMING_FALLBACK_MS, NAMING_PERSIST_DEBOUNCE_MS, NAMING_SWEEP_SOON_MS } from '../shared/time-config/src/values.js'

// 索引翻页的页数上限（#1445）：50 页、每页 50 条（页大小与契约 github.listPageSize 同数），
// 五十页就是两千五百条，正常仓库远到不了。
// 为什么页是 50 不是连接上限 100：带全字段的单查询约 3 秒被对端掐连接（2026-10-26 真机实测），
// 连接上限 100 仍是硬顶（#1418：要 200 会被整页拒绝），页大小只许比它小、不许大。
const NAMING_INDEX_MAX_PAGES = 50, NAMING_INDEX_PAGE_LIMIT = 50
// 单页条数（#1418）：房间自己会把 first 再夹到连接上限，这里给准数，不在两处各写一个「看着像」的值。
// 与上一行合成一句声明：本文件在「只许减不许增」的冻结清单里（verify-file-granularity），不许多占一行。
// 自由变量 getTitle 的存在性声明（原 .js 里它是未声明的自由引用，运行时靠 typeof 守卫：
// 有这个名字的函数才调，没有就跳过，try 包着兜底；declare 不产生运行时代码，行为与原来逐行一致）。
// 为什么不断言它一定存在：调用方从未传入它，它今天就是缺席的，类型必须照实写成「可能有」。
declare const getTitle: any;
export function createNamingGuardian(deps?: any): any {
  const { fs, timer, DEFAULT_CWD, getCacheDir, getPlatform, getRepoKey, openSession, logCtx, getFirstText, getTitleFact } = deps
  let _namingCore: any = null
  let _namingCoreInit: any = null
  async function getNamingCore() {
    if (_namingCore) return _namingCore
    if (!_namingCoreInit) {
      _namingCoreInit = (async function() {
        try { const ms = await Promise.all([import('../shared/naming-titles.js'), import('../shared/naming-tracking.js'), import('../shared/naming-attribution.js')]); _namingCore = Object.assign({}, ms[0], ms[1], ms[2]); return _namingCore } catch (e) { return null }
      })()
    }
    return _namingCoreInit
  }
  const NAMING_STATE_FILE = 'naming-guardian.json'   // 落盘 .dsh-mattskillsdeck-cache 目录下
  // #709：唯一 10 分钟兜底间隔。事件跳由事件带起、本身不排队，兜底跳靠这个间隔限频
  // （每跳最多只扫一个仓库，游标轮转），让「一直没有事件」的仓库也不会永远不被结算。
  // 值住 config/intervals.yaml 的 namingFallbackIntervalMs 键，直接引用上面的中央常量，调时间改 YAML。
  // _namingPersistTimer 单独标注（ evolving-let 在 strict 下推不出类型；只加标注，不改赋值时机与语义）。
  let _namingState: any = null, _namingStateDirty = false, _namingPersistTimer: any = null, _namingSweepBusy = false
  let _namingSweepTimer: any = null; let sweepAnyChanged = false, sweepAssignedTotal = 0, sweepTrigger = 'event'; function hash8(s?: any) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  function namingDefaultState() { return { version: 1, sessions: {}, indexes: {} } }
  async function loadNamingState() {
    if (_namingState) return _namingState
    _namingState = namingDefaultState()
    try {
      if (fs !== undefined && typeof fs.readText === 'function' && typeof fs.resolve === 'function') {
        const dir = await getCacheDir()
        if (dir) {
          const platform2 = await getPlatform(); const t = await platform2.fs.resolve(platform2.path.join(dir, NAMING_STATE_FILE))
          const txt = await fs.readText(t)
          if (txt) { const j = JSON.parse(txt)
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
      const platform2 = await getPlatform(); const t = await platform2.fs.resolve(platform2.path.join(dir, NAMING_STATE_FILE))
      await fs.writeText(t, JSON.stringify(_namingState || namingDefaultState()))
    } catch (ePersist) { /* 写失败不影响主流程，下轮 tick 重试 */ }
  }
  // 落盘合并：标脏只排一次合并窗。落盘是整份覆写（JSON.stringify 全量），而一次索引扫描里可能连着
  // 标好几次脏（分配成功、基线回退各标一次），每次标脏都写会把缓存目录的文件服务打满；
  // 所以窗口内的多次标脏只在窗口末尾写一次。
  // 1200 毫秒住 config/intervals.yaml 的 namingPersistDebounceMs 键：这里直接用中央常量，
  // 调时间改 YAML（构建产物过期时 values.ts 已回落到同一个数，行为与今天一致）。
  function markNamingStateDirty() {
    _namingStateDirty = true
    if (_namingPersistTimer) return
    _namingPersistTimer = timer.timeout(function() { _namingPersistTimer = null; if (_namingStateDirty) persistNamingState() }, NAMING_PERSIST_DEBOUNCE_MS); try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'timer.schedule', { name: 'naming-persist', intervalMs: NAMING_PERSIST_DEBOUNCE_MS }) } catch (eL) {}
  }
  // 事件驱动（#709：无自续定时器，每跳由事件带起，另加 10 分钟至多一次的单仓兜底）。
  let _namingFallbackAt = 0, _namingSweepCursor = 0
  function namingGuardianEvent(reason?: any, booting?: any) {
    if (booting) { try { if (typeof globalThis !== 'undefined' && (globalThis as any).__dswsNamingGuardianLoop) { clearTimeout((globalThis as any).__dswsNamingGuardianLoop); (globalThis as any).__dswsNamingGuardianLoop = null } } catch (eG) {}; try { if (_namingStateDirty) persistNamingState() } catch (eInit) {} }
    namingSweepSoon(0, { trigger: String(reason || 'event') })
    const now = Date.now()
    if (_namingFallbackAt > 0 && now - _namingFallbackAt < NAMING_FALLBACK_MS) return
    _namingFallbackAt = now
    try { namingSweepNow({ oneRepo: true, trigger: 'fallback' }) } catch (eF) {}
  }
  function startNamingGuardianEvents() { namingGuardianEvent('apply-start', true) }   // 随 apply 启动（只做一次铺垫，不启动任何循环）

  // 建号感知（#266）：#211 三 handler 曾被整块删除（#258），现以索引差值为底座复原并入守护。

  /** repoKey 归一：接受 'owner/name' 字符串或 { owner, name }；无效返回 null。 */
  function namingRepoKeyOf(args?: any) {
    if (!args) return null
    let rk = args.repoKey
    if (rk && typeof rk === 'object') { const o = rk.owner || rk.login; const n = rk.name || rk.repo; rk = (o && n) ? String(o) + '/' + String(n) : null }
    if (typeof rk === 'string' && rk.indexOf('/') > 0) return rk
    return null
  }
  async function namingResolveRepoKey(cwd?: any) {
    try {
      const repo = await getRepoKey(cwd || DEFAULT_CWD); if (repo && repo.owner && repo.name) return repo.owner + '/' + repo.name
    } catch (e) {}
    return null
  }
  /**
   * 索引快照：全量（open+closed，剔 PR），结构 { 'n': { title, state, updatedAt } }。
   * #1445：取数从直调 gh api --paginate 改走只读会话的 listPage，按 nextCursor 翻到底。
   * 为什么必须翻到底：这份索引是「新编号 vs 上一轮索引」的差值基线（见 namingSweepNow），
   * 少拿一页就会把老票当成新冒出来的编号，错误地归属给正在等待的会话。翻不动就整轮回失败，
   * 调用方照既有约定跳过这一轮、不推进基线，而不是拿半份索引去结算。
   */
  async function namingFetchIndex(repoKey?: any, cwd?: any) {
    try {
      // 没装配「开会话」这一口就如实失败：旧路的 runGh 已经是宿主直连后端，绕回去等于绕过会话的预算与记账。
      if (typeof openSession !== 'function') return { ok: false, error: 'no-open-session' }
      // #1627：这一趟标成命名索引（purpose='naming-index'）——它和用户点的操作抢同一份额度，
      // 观察器要能单独看出「分钟内是谁把额度用掉的」。其余开会话调用不带这个标记。
      const opened: any = await openSession(cwd || DEFAULT_CWD, { purpose: 'naming-index' })
      // 仓库引用必须由会话回包给出（refId 就是「这一趟读的是哪个仓库」）；拿不到就这一轮不结。
      if (!opened || opened.ok !== true || typeof opened.call !== 'function' || !opened.repoRef || !opened.repoRef.refId) return { ok: false, error: String((opened && (opened.reason || opened.detail)) || 'open-failed') }
      // 防串仓：调用方按工作区算出的仓库键，与会话拿到的仓库必须同一家；不一致就这一轮不结。
      if (repoKey && String(repoKey).toLowerCase() !== String(opened.repoRef.refId).toLowerCase()) return { ok: false, error: 'repo-mismatch' }
      const index: any = {}
      for (let page = 0, cursor: any = null; page < NAMING_INDEX_MAX_PAGES; page++) {
        const res: any = await opened.call(function (session: any, ctx: any) { return session.listPage(opened.repoRef, {}, cursor ? { limit: NAMING_INDEX_PAGE_LIMIT, cursor: cursor } : { limit: NAMING_INDEX_PAGE_LIMIT }, ctx) })
        if (!res || res.ok !== true) return { ok: false, error: (res && res.error) || 'list-page-failed' }
        // PR 与 issue 共用一个编号空间：必须剔掉 PR，旧 jq 的 select(.pull_request == null) 就是这个意思。
        for (let i = 0, items: any[] = Array.isArray(res.data && res.data.items) ? res.data.items : []; i < items.length; i++) {
          const it: any = items[i]
          if (!it || it.isPullRequest === true || it.key === undefined || it.key === null) continue
          index[String(it.key)] = { title: String(it.title || ''), state: String(it.state || '').toUpperCase(), updatedAt: String(it.updatedAt || '') }
        }
        cursor = (res.data && res.data.nextCursor) || null
        if (!cursor) return { ok: true, index: index }
      }
      return { ok: false, error: 'too-many-pages' }
    } catch (e) { return { ok: false, error: String((e && (e as any).message) || e) } }
  }
  // 无关新编号不硬配（#315：只有明确无关才丢弃，其余保留）。
  function keepRelatedAssigned(list?: any, core?: any, sessions?: any) {
    if (!list.length || !core.isHintRelatedToTitle) return list
    return list.filter(function(a?: any) { const e = sessions[a.sessionId]; if (!e || !(e as any).hint) return true; try { return core.isHintRelatedToTitle((e as any).hint, a.title) } catch (eRel) { return true } })
  }
  /** 索引差值结算（每仓库一次）：新编号归属同仓最早等待会话；prev 缺失仅建档；即时落盘。 */
  async function namingSweepNow(opts?: any) {
    if (_namingSweepBusy) return
    _namingSweepBusy = true
    try {
      const core = await getNamingCore()
      if (!core) return
      const st = await loadNamingState()
      const byRepo: any = {}
      for (const sid in st.sessions) {
        const s = st.sessions[sid]
        if (!s || !s.repoKey) continue
        if (!core.isNumberAwaitStage(s)) continue
        // 同仓会话可能有的带工作区、有的不带（面板关闭期间只登记仓库键）；分组挑一个真工作区，挑不到仍按「读不到就跳过」处理。
        if (!byRepo[s.repoKey]) byRepo[s.repoKey] = { sessions: [], cwd: s.cwd || DEFAULT_CWD }; else if (!byRepo[s.repoKey].cwd && s.cwd) byRepo[s.repoKey].cwd = s.cwd
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
        let assigned: any[] = []
        try {
          if (prev) assigned = core.attributeNewNumbers({ prevIndex: prev, currIndex: r.index, sessions: grp.sessions })
          // prev 为空：首轮基线。基线同样必须入库（防下一轮把存量全量当新编号）
        } catch (eA) { assigned = [] }
            try { assigned = keepRelatedAssigned(assigned, core, st.sessions) } catch (eFilter) {}
        // #746 Knife5：差值退兜底 —— 无标题新号且同仓多等待时不分（等标题或直达），单等待才认领；
        // 有标题的仍走语义相关认领（强相关才分，无关不分，见归属纯函数）。
        try {
          if (grp.sessions.length > 1 && r.index) {
            assigned = assigned.filter(function(a?: any) {
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
          let newNums: any[] = []
          try { newNums = (prev && core.newNumbersSince) ? core.newNumbersSince(prev, r.index) : [] } catch (eN) { newNums = [] }
          const got: any = {}
          for (let gi = 0; gi < assigned.length; gi++) { if (assigned[gi] != null) got[String(assigned[gi].number)] = true }
          const held: any[] = []
          for (let ni = 0; ni < newNums.length; ni++) { const k = String(newNums[ni]); if (!got[k]) held.push(k) }
          if (held.length) {
            if (!st.indexRetry || typeof st.indexRetry !== 'object') st.indexRetry = {}
            if (!st.indexRetry[repoKey] || typeof st.indexRetry[repoKey] !== 'object') st.indexRetry[repoKey] = {}
            const retry = st.indexRetry[repoKey]
            const kept: any = {}
            for (let hi = 0; hi < held.length; hi++) {
              const k = held[hi]
              const tries = (Number(retry[k]) || 0) + 1
              if (tries <= 5) { retry[k] = tries; kept[k] = true }
              else { try { delete retry[k] } catch (eD) {} }
            }
            if (Object.keys(kept).length) {
              const heldBack: any = {}
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
  function namingSweepSoon(delayMs?: any, opts?: any) {
    // 调用方只说「尽快」而没给具体毫秒时用缺省合并窗：短窗内来的多次事件（注册、白名单、认领推送、
    // 四种事件）只合成一次索引扫描，防堆积。缺省值住 config/intervals.yaml 的 namingSweepSoonMs 键，
    // 直接读中央常量；调用方显式传数时仍以传入值为准，语义不变（120 / 800 这些短窗照旧走传入值）。
    const delay = typeof delayMs === 'number' ? delayMs : NAMING_SWEEP_SOON_MS
    if (_namingSweepTimer) { try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'timer.schedule', { name: 'naming-sweep', intervalMs: delay }) } catch (eL) {}; return }
    _namingSweepTimer = timer.timeout(function() {
      _namingSweepTimer = null
      try { sweepTrigger = (opts && opts.trigger) || 'soon'; namingSweepNow(opts) } catch (e) {}
    }, delay)
  }

  /** 受踪登记唯一实现：#265 兼容名与 #266 复原名共用同一本体。基准收两种：占位（[New] …）与编号档（[#n] …）。 */
  async function namingEnsureTracked(args?: any) {
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
  const namingRegisterHandler = function(args?: any) { return namingEnsureTracked(args) }
  // 注册双名同一本体（#265 兼容名 / #211 复原名，client 已切规范入口）。

  async function handleNamingSignal(args?: any) {
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
    const orders: any[] = [], tracked = [], failures = []
    for (const sid in st.sessions) {
      const s = st.sessions[sid]
      if (!s) continue
      let curTitle: any = null; try { if (typeof getTitle === 'function') curTitle = await getTitle(sid) } catch (eT) {}
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
          let want: any = null
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
      const byRepoHasHint: any = {}
      for (let i = 0; i < orders.length; i++) {
        const o = orders[i]
        if (o && o.kind === 'draft' && o.hint) {
          const so = st.sessions[o.sessionId]
          const rk = so && so.repoKey
          if (rk) byRepoHasHint[rk] = true
        }
      }
      if (Object.keys(byRepoHasHint).length) {
        const kept: any[] = []
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
    // 每单都带上首句（没有来源事实时的旧判据兜底）与标题来源事实（写这条名的那一次是谁写的，优先用；对不上会被判据丢掉）。
    for (let i = 0; i < orders.length; i++) { const oo = orders[i]; if (!oo || !oo.lock) continue; try { if (typeof getFirstText === 'function') oo.lock.firstUserText = await getFirstText(oo.sessionId) } catch (eFt) {} try { if (typeof getTitleFact === 'function') oo.lock.titleSource = await getTitleFact(oo.sessionId) } catch (eTf) {} }
    return { ok: true, orders: orders, tracked: tracked, failures: failures }
  }

  async function handleNamingResult(args?: any) {
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
  async function getEntry(sid?: any) {
    try { const st = await loadNamingState(); const s = st.sessions[sid]; return s ? Object.assign({}, s) : null } catch (e) { return null }
  }
  // #746：摘要结果入账（ok 带好线索并记 summaryOnce；失败记 summaryFailed 永不补调；即时落盘）。
  async function applySummaryResult(args?: any) {
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
  async function handleDirectCreated(args?: any) {
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
    async function handleCancelNewSessionWatcher(args?: any) {
    const sid = args && args.sessionId
    if (!sid) return { ok: false, error: { kind: 'parse', message: '缺少 sessionId' } }
    const st = await loadNamingState()
    if (!st.sessions[sid]) return { ok: true, cancelled: false }
    delete st.sessions[sid]
    await persistNamingState()
    return { ok: true, cancelled: true }
  }
  async function handleAwaitCreatedIssue(args?: any) {
    const sid = args && args.sessionId
    if (!sid) return { ok: false, error: { kind: 'parse', message: '缺少 sessionId' } }
    const core = await getNamingCore()
    const st = await loadNamingState(), entry = st.sessions[sid]
    const watching = !!(core && entry && core.isNumberAwaitStage(entry))
    if (watching) namingSweepSoon(120)
    return { ok: true, watching: watching, stage: (entry && entry.stage) || null }
  }
  // #498 电话三态行：命名族 7 电话（注册双名同一本体，按规范入口记 wf.registerNewSessionWatcher）成功 info、失败 warn；高频 namingPlan 成功按需 debug（5 秒轮询，只记行不记体）。
  function phoneLog(method?: any, kind?: any, level?: any, t0?: any, res?: any, err?: any) { try {
    if (err !== undefined && err !== null) { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((err && err.message) || err)) }) }
    else if (res && res.ok) { if (level === 'debug') { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) } else if (logCtx) logCtx.fire('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) }
    else if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((res && ((res.error && res.error.message) || res.error)) || 'naming-not-ok')) }) } catch (eL) {} }
  function loggedPhone(method?: any, kind?: any, level?: any, fn?: any) { return async function() { const t0 = Date.now(); try { const r = await fn.apply(null, arguments); phoneLog(method, kind, level, t0, r); return r } catch (e) { phoneLog(method, kind, level, t0, null, e); throw e } } }
  return { namingSweepSoon, namingRegisterHandler: loggedPhone('wf.registerNewSessionWatcher', 'naming-register', 'info', namingRegisterHandler), handleNamingSignal: loggedPhone('wf.namingSignal', 'naming-signal', 'info', handleNamingSignal), handleNamingPlan: loggedPhone('wf.namingPlan', 'naming-plan', 'debug', handleNamingPlan), handleNamingResult: loggedPhone('wf.namingResult', 'naming-result', 'info', handleNamingResult), handleCancelNewSessionWatcher: loggedPhone('wf.cancelNewSessionWatcher', 'naming-cancel', 'info', handleCancelNewSessionWatcher), handleAwaitCreatedIssue: loggedPhone('wf.awaitCreatedIssue', 'naming-await', 'info', handleAwaitCreatedIssue), getEntry: getEntry, applySummaryResult: applySummaryResult, handleDirectCreated: handleDirectCreated, namingGuardianEvent, startNamingGuardianEvents }
}
