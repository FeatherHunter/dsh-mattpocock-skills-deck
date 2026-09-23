// src/host/refresh/patch.js —— 行级增量刷新的宿主侧那半边（#708 T4 第三批）
//
// 这个文件干的是「跑腿」的三件事，纯逻辑一件都不在这里（那三件在 refresh-core/src/delta.ts 的产物
// src/shared/refresh/delta.js 里，本文件每一步都调它）：
//   ① 只取变的那几条：把窗口探测回来的索引与列表手上那份比一遍，变了的那几条各发一条薄查询；
//   ② 并进现有列表：把那几条换进行里、产出新的版本号，派生值按 delta.derivedAfter 处置；
//   ③ 持久化待办：被推迟 / 被丢弃 / 失败的取数进待办（水印不前进），切进工作区先清待办、有待办就整池。
//
// 依据：定稿第十一章（docs/architecture/refresh-budget-architecture.html 增补第十一章）。四条纪律照写：
//   · 整池只剩三处：冷启动、每 10 分钟对账、票号增减。本文件遇到后两种只回一句「该整池了」，自己不发大查询；
//   · 水印只在变化真正并进列表之后才推进（delta.watermarkAfter）；
//   · 每工作区一个世代号，迟到的整池结果不许覆盖更新的增量结果（admitSnapshot 与 run 两处都过 delta.admitResult）；
//   · **deck.counts 是整仓口径，增量路径不许本地重算**，只许保持旧值并把 deck.partial 置真（票面点名的红线）。
//
// 为什么这一整块必须留 JS 而不是进 TS：它要真去 `gh api` 取数、要往磁盘写、要读写宿主那份快照缓存。
// 纯逻辑进 TS、取数与落盘留 JS 是本仓库的既定分工（docs/adr/20260913-builtin-ts-shape.md §2.7）。
//
// 待办与水印存在哪：就存在快照自己身上（快照的 delta 字段），跟着既有的磁盘缓存那一份文件走，
// 不另开缓存文件、不新增第二个写者。老快照没有这个字段 —— 那正是「旧结构，整池重建一次」的判据
// （delta.checkStructure），不许静默当新结构用。
//
// 日志：新增了一块持久化状态（每个工作区的水印、世代号与待办），按仓库日志纪律（AGENTS.md 的
// 「日志埋点五类」里的「新增的内存或磁盘缓存」）落一条按需级事件 `refresh.patch`：外层先判调试开关，
// 关着连字段对象都不组装；字段只取短散列、枚举与数字，工作区路径原文与命令行原文一个都不记。
import * as delta from '../../shared/refresh/delta.js'

/** 这块状态存在快照的哪个字段下。 */
export const DELTA_FIELD = 'delta'

/**
 * 建一个行级补行的跑腿件。deps 全部由宿主接线时注入（本文件不 import 宿主其它模块，免得接出环）：
 *   readSnapshot(cwd) → 现在列表所在的那份快照，没有就回 null
 *   writeSnapshot(cwd, snap) → 把并好的快照写回（内存与磁盘都由接线方负责）
 *   indexOfSnapshot(snap) → 从快照里取出「列表手上那份索引」（注入 indexWindow.indexFromSnapshot）
 *   windowRules → src/shared/tracker/indexWindow.js 那个模块（scanWindow / seedFromSnapshot）
 *   probeIndex(cwd, sinceIso) → 只问窗口内的变化，回 { ok, index } 或 { ok:false, error }
 *   getRepoKey(cwd) / runGh(args, cwd) → 取那几条薄查询用的两件工具
 *   send(req, perform) → 可选。给了就由它去发（生产里是闸的 send：先裁决、再记账）；
 *                        没给就直接 perform（门禁里用假传输层时走这条）
 *   decide(req) → 可选。只问一句「这一笔现在放不放行」，用来先判探查要不要发（生产里是闸的 decideFor）
 *   now / hash8 / logCtx / maxRows → 时间、短散列、日志出口与「一次最多补几行」
 */
export function createPatch(deps) {
  const d = deps || {}
  const now = typeof d.now === 'function' ? d.now : Date.now
  const logCtx = d.logCtx || null
  const hash8 = typeof d.hash8 === 'function' ? d.hash8 : function (s) {
    try {
      const t = String(s || '')
      let h = 5381
      for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
      return ('0000000' + h.toString(16)).slice(-8)
    } catch (e) { return '00000000' }
  }
  const maxRows = typeof d.maxRows === 'number' && d.maxRows > 0 ? d.maxRows : delta.PATCH_MAX_ROWS
  const wsKeyOf = typeof d.workspaceKeyOf === 'function' ? d.workspaceKeyOf : function (cwd) { return String(cwd || 'unknown') }

  /** 这一条路的账：门禁与现场排查都读它。 */
  const stats = { runs: 0, patched: 0, rebuildNeeded: 0, deferred: 0, failed: 0, staleDropped: 0, thinQueries: 0, noChange: 0 }

  function fire(mode, reason, extra) {
    // 按需级：外层先判调试开关，关着连字段对象都不组装（仓库日志纪律第 2 条，判断与发射同一行）。
    try { if (!logCtx || !logCtx.isEnabled('debug')) return; const e = extra || {}; logCtx.fire('debug', 'refresh.patch', { keyHash: e.keyHash || '', mode: mode, reason: reason, changed: e.changed || 0, queries: e.queries || 0, watermark: e.watermark || 'held', pending: e.pending || 0 }) } catch (eL) { /* 日志不许把主流程带崩 */ }
  }

  /** 快照里那份增量状态的形状。老快照没有这个字段 —— 那正是「旧结构」的判据。 */
  function stateOf(snap) {
    const raw = (snap && typeof snap === 'object' && snap[DELTA_FIELD] && typeof snap[DELTA_FIELD] === 'object') ? snap[DELTA_FIELD] : null
    const s = raw || {}
    return {
      structureVersion: (typeof s.structureVersion === 'number') ? s.structureVersion : undefined,
      watermarkMs: Number(s.watermarkMs) || 0,
      generation: Number(s.generation) || 0,
      pending: Array.isArray(s.pending) ? s.pending.map(String).filter(Boolean) : [],
      pendingAt: Number(s.pendingAt) || 0,
      pendingReason: String(s.pendingReason || ''),
    }
  }

  /** 把增量状态放回快照（其它字段一个字不动）。 */
  function withState(snap, st) {
    const out = Object.assign({}, snap)
    out[DELTA_FIELD] = {
      structureVersion: delta.DELTA_STRUCTURE_VERSION,
      watermarkMs: st.watermarkMs, generation: st.generation,
      pending: st.pending, pendingAt: st.pendingAt, pendingReason: st.pendingReason,
    }
    return out
  }

  /** checkStructure 的入参：把「没有这个字段」与「字段是 0」分得开。 */
  function structureStamp(st) {
    return (typeof st.structureVersion === 'number') ? { structureVersion: st.structureVersion } : {}
  }

  async function readSnap(cwd) { return await Promise.resolve(d.readSnapshot(cwd)) }
  async function writeSnap(cwd, snap) { return await Promise.resolve(d.writeSnapshot(cwd, snap)) }

  /** 待办现在有几条（给界面与日志用）。 */
  async function pendingCount(cwd) { return stateOf(await readSnap(cwd)).pending.length }

  /** 把几条变化记进待办（去重、按编号排序、最多留 500 条）。 */
  async function rememberPending(cwd, snap, keys, reason) {
    const st = stateOf(snap)
    const set = {}
    st.pending.forEach(function (k) { set[k] = true })
    ;(keys || []).forEach(function (k) { if (k) set[String(k)] = true })
    st.pending = Object.keys(set).sort().slice(-500)
    st.pendingAt = now()
    st.pendingReason = String(reason || '')
    await writeSnap(cwd, withState(snap, st))
    return st.pending.length
  }

  /**
   * 切进一个工作区时先过这里：有待办就回「要整池」并把待办清掉（定稿第十一章：切进工作区先清待办，
   * 有待办就整池）。为什么清掉：这一趟整池会把整仓票号与行都重拿一遍，待办里那几条变化自然被覆盖，
   * 留着只会让下一次又白整池一次。
   */
  async function enterWorkspace(cwd) {
    const snap = await readSnap(cwd)
    if (!snap) return { mode: 'rebuild', reason: 'no-baseline', pending: 0 }
    const st = stateOf(snap)
    if (!st.pending.length) return { mode: 'use-cache', reason: 'no-pending', pending: 0 }
    const n = st.pending.length
    st.pending = []
    st.pendingAt = 0
    st.pendingReason = ''
    await writeSnap(cwd, withState(snap, st))
    return { mode: 'rebuild', reason: 'pending-todo', pending: n }
  }

  /**
   * 一条薄查询：只问这一张票的行数据（一条出站请求）。字段与全量取数那份同形，
   * 免得并进列表之后同一行有两种形状（界面在两种形状之间摇摆是最难查的一类错）。
   */
  function thinArgs(repo, number) {
    return ['api', 'repos/' + repo.owner + '/' + repo.name + '/issues/' + number,
      '--jq', '{number: .number, title: .title, state: .state, labels: .labels, assignees: .assignees, user: .user, updated_at: .updated_at, created_at: .created_at}']
  }

  /** 把一条薄查询的回包转成列表里那一行的形状（与 src/host/issueList.js 的 fetchIssues 同口径）。 */
  function rowOf(x) {
    return {
      number: x.number,
      title: x.title,
      state: (String(x.state).toLowerCase() === 'closed' ? 'CLOSED' : 'OPEN'),
      assignees: (x.assignees || []).map(function (a) { return a.login }),
      labels: (x.labels || []).map(function (l) { return { name: l.name, color: l.color || '' } }),
      author: (x.user && x.user.login) ? { login: x.user.login, name: (x.user.name || ''), avatarUrl: (x.user.avatar_url || '') } : undefined,
      updatedAt: x.updated_at,
      createdAt: x.created_at,
    }
  }

  /**
   * 取那几条：一条一请求，逐条串行（闸那边也是一条队，扇出永远不并行）。
   * 回 { ok:true, rows, queries }，或 { ok:false, outcome:'deferred'|'dropped'|'failed', keys }。
   *
   * 一条没取到就整批不并 —— 这是本文件最要紧的一条判断：只并进去一半、却把水印推走，
   * 剩下那几条变化就再也发现不了了（正是定稿第十一章点名的那个静默漏报）。
   */
  async function fetchRows(cwd, repo, keys) {
    const rows = []
    let queries = 0
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      const rest = keys.slice(i)
      let captured = null
      const perform = async function () {
        queries += 1
        stats.thinQueries += 1
        captured = await Promise.resolve(d.runGh(thinArgs(repo, k), cwd))
        return captured && captured.report ? captured.report : { requests: 1, points: 0 }
      }
      if (typeof d.send === 'function') {
        // 这一次是 REST 那一路（每张票一条 `gh api repos/.../issues/N`），所以桶明确写 rest：
        // 闸的 BUCKET_OF_KIND 把 kind=patch 归在 graphql（那是「一条带别名的薄查询」那种实现）——
        // 本实现走的是每票一条 REST，如实报 rest 才不会把「几条请求」记成「几点」（两桶互不折算）。
        const sent = await Promise.resolve(d.send({ source: 'patch.apply', kind: 'patch', bucket: 'rest', workspaceKey: wsKeyOf(cwd) }, perform))
        if (!sent || sent.sent !== true) return { ok: false, outcome: sent && sent.verdict === 'defer' ? 'deferred' : 'dropped', keys: rest, reason: (sent && sent.reason) || 'deferred' }
      } else {
        await perform()
      }
      const r = await Promise.resolve(captured)
      if (!r || r.ok !== true || !r.text) return { ok: false, outcome: 'failed', keys: rest, reason: 'thin-query-failed' }
      let parsed = null
      try { parsed = JSON.parse(r.text) } catch (e) { parsed = null }
      if (!parsed || parsed.number === undefined || parsed.number === null) return { ok: false, outcome: 'failed', keys: rest, reason: 'thin-query-parse' }
      rows.push(rowOf(parsed))
    }
    return { ok: true, rows: rows, queries: queries }
  }

  /**
   * 整池那边回来的结果要走这里：先问世代号还算不算数，再落盘。
   * 这一条就是「迟到的整池结果不许覆盖更新的增量结果」在 JS 那一侧的落点 ——
   * 整池发起时记着手里的 generation，回来时增量已经把世代推走了，这里把它丢掉（一个字段都不写）。
   */
  async function admitSnapshot(cwd, snap, startedGeneration) {
    const cur = await readSnap(cwd)
    const st = stateOf(cur)
    const g = delta.admitResult(st.generation, startedGeneration)
    if (!g.accept) {
      stats.staleDropped += 1
      fire('rebuild', g.reason, { keyHash: hash8(wsKeyOf(cwd)), watermark: 'held', pending: st.pending.length })
      return { accepted: false, reason: g.reason, generation: st.generation }
    }
    const next = withState(snap, { watermarkMs: now(), generation: g.generation, pending: [], pendingAt: 0, pendingReason: '' })
    await writeSnap(cwd, next)
    return { accepted: true, reason: g.reason, generation: g.generation }
  }

  /**
   * 跑一次行级增量。回哪一档都能被调用方当成一句话安排下一步：
   *   { mode:'patch', rows, queries, version }   已经并进列表、水印已推进、counts 保持旧值 + partial 置真
   *   { mode:'nothing' }                         探测回来说没变
   *   { mode:'rebuild', reason }                 该整池（冷启动 / 票号增减 / 条数过多 / 旧结构 / 有待办 / 没水印）
   *   { mode:'deferred'|'failed', pending, keys } 没并进去：水印没动，变化进了待办
   *   { mode:'stale-dropped' }                   这份结果已经过期（更新的结果先落地了）
   */
  async function run(cwd, opts) {
    const o = opts || {}
    stats.runs += 1
    const keyHash = hash8(wsKeyOf(cwd))
    const snap = await readSnap(cwd)
    // ① 手上没有可比对的列表：冷启动，整池（定稿第十一章「什么时候仍整池」①）。
    if (!snap || !Array.isArray(snap.issues)) { stats.rebuildNeeded += 1; fire('rebuild', 'no-baseline', { keyHash: keyHash }); return { mode: 'rebuild', reason: 'no-baseline' } }
    // ② 切进工作区那一下：有待办就整池（并清掉待办）。
    if (o.entered) {
      const e = await enterWorkspace(cwd)
      if (e.mode === 'rebuild') { stats.rebuildNeeded += 1; fire('rebuild', e.reason, { keyHash: keyHash, pending: e.pending }); return e }
    }
    // ③ 磁盘上那份是旧结构（或比本机制还新）：不许静默当新结构用，整池重建一次。
    const st = stateOf(snap)
    const sv = delta.checkStructure(structureStamp(st))
    if (sv.action === 'rebuild') { stats.rebuildNeeded += 1; fire('rebuild', sv.reason, { keyHash: keyHash, pending: st.pending.length }); return { mode: 'rebuild', reason: sv.reason } }
    // ④ 没有可用水印：拿这份快照自己的生成时刻当起点（快照就是那一刻的真状态）。
    let watermarkMs = st.watermarkMs
    if (!watermarkMs) {
      const seed = d.windowRules.seedFromSnapshot(snap, now())
      if (!seed || !seed.watermarkMs) { stats.rebuildNeeded += 1; fire('rebuild', 'no-watermark', { keyHash: keyHash }); return { mode: 'rebuild', reason: 'no-watermark' } }
      watermarkMs = seed.watermarkMs
    }
    const scanStartedMs = now()
    // ⑤ 探查这一笔也过闸：不在活跃集合里、额度不够、撞上限流时，这里直接回「推迟」——
    //    什么都不发，水印一个字节都不动，下一次仍然会发现同一条变化。
    if (typeof d.decide === 'function') {
      const v = await Promise.resolve(d.decide({ source: 'probe.tick', kind: 'probe', workspaceKey: wsKeyOf(cwd) }))
      if (v && v.verdict === 'defer') { stats.deferred += 1; fire('deferred', v.reason, { keyHash: keyHash, watermark: 'held', pending: st.pending.length }); return { mode: 'deferred', reason: v.reason, pending: st.pending.length } }
    }
    const repo = await Promise.resolve(d.getRepoKey(cwd))
    if (!repo || !repo.owner || !repo.name) { stats.failed += 1; fire('failed', 'no-repo', { keyHash: keyHash }); return { mode: 'failed', reason: 'no-repo', pending: st.pending.length } }
    // o.full 那一档是「整扫」：每 10 分钟的对账那一趟走它。整扫回来的是完整一份，基线要重置而不是并进去，
    // 否则删票永远观察不到（定稿第十一章「消失（删票）」）。增量那一趟才是缩着窗口问的。
    const win = o.full === true ? { sinceIso: '', full: true, sinceMs: 0 } : d.windowRules.scanWindow(watermarkMs, scanStartedMs)
    const remote = await Promise.resolve(d.probeIndex(cwd, win.sinceIso))
    if (!remote || remote.ok !== true || !remote.index) { stats.failed += 1; fire('failed', 'probe-failed', { keyHash: keyHash }); return { mode: 'failed', reason: 'probe-failed', pending: st.pending.length } }
    // ⑥ 差分（纯逻辑在 delta.js）：「哪些行变了」与「该走哪条路」一次算清。
    const plan = delta.planDelta(d.indexOfSnapshot(snap), remote.index, { full: win.full === true })
    if (plan.mode === 'rebuild') { stats.rebuildNeeded += 1; fire('rebuild', plan.reason, { keyHash: keyHash, changed: plan.changed.length, pending: st.pending.length }); return { mode: 'rebuild', reason: plan.reason, added: plan.added.length, removed: plan.removed.length } }
    if (plan.mode === 'nothing') {
      const wv = delta.watermarkAfter({ previousMs: st.watermarkMs || watermarkMs, scanStartedMs: scanStartedMs, outcome: 'not-need' })
      await writeSnap(cwd, withState(snap, Object.assign({}, st, { watermarkMs: wv.watermarkMs })))
      stats.noChange += 1
      fire('nothing', wv.reason, { keyHash: keyHash, watermark: wv.advanced ? 'advanced' : 'held', pending: st.pending.length })
      return { mode: 'nothing', reason: wv.reason, watermarkMs: wv.watermarkMs }
    }
    // ⑦ 变的那几条太多：一条一请求地补过去已经不划算，交给整池（整池 13 点 7 条请求，见 budget.js）。
    if (plan.changed.length > maxRows) { stats.rebuildNeeded += 1; fire('rebuild', 'too-many-rows', { keyHash: keyHash, changed: plan.changed.length, pending: st.pending.length }); return { mode: 'rebuild', reason: 'too-many-rows', changed: plan.changed.length } }
    // ⑧ 取那几条薄的。
    const startedGeneration = st.generation
    const got = await fetchRows(cwd, repo, plan.changed)
    if (!got.ok) {
      const pending = await rememberPending(cwd, snap, got.keys || plan.changed, got.reason)
      if (got.outcome === 'deferred') stats.deferred += 1; else stats.failed += 1
      fire(got.outcome === 'deferred' ? 'deferred' : 'failed', got.reason, { keyHash: keyHash, changed: plan.changed.length, watermark: 'held', pending: pending })
      return { mode: got.outcome === 'deferred' ? 'deferred' : 'failed', reason: got.reason, pending: pending, keys: got.keys }
    }
    // ⑨ 世代号：这一份还算不算数。不算就整份丢掉，一个字段都不写。
    const g = delta.admitResult(stateOf(await readSnap(cwd)).generation, startedGeneration)
    if (!g.accept) { stats.staleDropped += 1; fire('patch', g.reason, { keyHash: keyHash, changed: plan.changed.length, watermark: 'held' }); return { mode: 'stale-dropped', reason: g.reason } }
    // ⑩ 并进列表（纯逻辑在 delta.mergeRows）：位置不动、不新增行、版本号必变。
    const mergedIssues = delta.mergeRows(snap.issues, got.rows, String(snap.version || ''))
    if (mergedIssues.missing.length) {
      const pending = await rememberPending(cwd, snap, mergedIssues.missing, 'merge-missing')
      stats.failed += 1
      fire('failed', 'merge-missing', { keyHash: keyHash, changed: mergedIssues.missing.length, watermark: 'held', pending: pending })
      return { mode: 'failed', reason: 'merge-missing', pending: pending, keys: mergedIssues.missing }
    }
    const byKey = {}
    got.rows.forEach(function (r) { const k = delta.rowKey(r); if (k) byKey[k] = r })
    let version = mergedIssues.version
    const maps = (Array.isArray(snap.maps) ? snap.maps : []).map(function (m) {
      if (!m || !Array.isArray(m.tickets)) return m
      const mr = delta.mergeRows(m.tickets, got.rows, version)
      if (mr.replaced.length) version = delta.nextVersion(version, mr.replaced.map(function (k) { return k + '=' + String((byKey[k] && byKey[k].state) || '') }))
      return Object.assign({}, m, { tickets: mr.rows })
    })
    // ⑪ 派生值：进度环本地重算（客户端按行算）；**deck.counts 保持旧值并把 deck.partial 置真**
    //    —— 这条是红线：counts 是整仓口径，只有整池拿得到，本地硬算一个出来就是假数字。
    const derived = delta.derivedAfter('patch')
    const deck = Object.assign({}, (snap.deck && typeof snap.deck === 'object') ? snap.deck : {})
    if (derived.markPartial) deck.partial = true
    const wv = delta.watermarkAfter({ previousMs: st.watermarkMs || watermarkMs, scanStartedMs: scanStartedMs, outcome: 'merged' })
    const nextState = {
      watermarkMs: wv.watermarkMs, generation: g.generation, pendingAt: st.pendingAt, pendingReason: st.pendingReason,
      pending: st.pending.filter(function (k) { return mergedIssues.replaced.indexOf(k) < 0 }),
    }
    const next = withState(Object.assign({}, snap, {
      issues: mergedIssues.rows, maps: maps, version: version,
      generatedMs: now(), updatedAt: new Date(now()).toISOString(), deck: deck,
    }), nextState)
    await writeSnap(cwd, next)
    stats.patched += 1
    fire('patch', 'rows-changed', { keyHash: keyHash, changed: mergedIssues.replaced.length, queries: got.queries, watermark: wv.advanced ? 'advanced' : 'held', pending: nextState.pending.length })
    return {
      mode: 'patch', reason: 'rows-changed', rows: mergedIssues.replaced, queries: got.queries,
      version: version, partial: deck.partial === true, counts: derived.countsAction,
      watermarkMs: wv.watermarkMs, generation: g.generation, pending: nextState.pending.length,
    }
  }

  return {
    run: run,
    enterWorkspace: enterWorkspace,
    admitSnapshot: admitSnapshot,
    pendingCount: pendingCount,
    state: async function (cwd) { return stateOf(await readSnap(cwd)) },
    threshold: { maxRows: maxRows },
    stats: function () { return Object.assign({}, stats) },
  }
}
