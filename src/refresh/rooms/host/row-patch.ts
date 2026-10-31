// src/refresh/rooms/host/row-patch.ts —— 行级增量刷新的宿主侧那半边（#708 T4 第三批）
//
// 这个文件干的是「跑腿」的三件事，纯逻辑一件都不在这里（那三件在 src/refresh/kernel/snapshot-diff.ts 的产物
// .build/refresh/kernel/snapshot-diff.js 里，本文件每一步都调它）：
//   ① 只取变的那几条：把窗口探测回来的索引与列表手上那份比一遍，变了的那几条各发一条薄查询
//      （取数三件套 thinArgs/rowOf/fetchRows 在 ./thin-row-fetch.js，本文件只负责调它）；
//   ② 并进现有列表：把那几条换进行里、产出新的版本号，派生值按 delta.derivedAfter 处置；
//      （#1690 起「并进」这一步只经 src/refresh/kernel/snapshot-merge.ts 的字段组合并：整行替换退役，
//      只有完整来源能覆盖或清空字段组，版本门挡住过期结果；本文件只负责取数、门禁与落盘。）
//   ③ 持久化待办：被推迟 / 被丢弃 / 失败的取数进待办（水印不前进），切进工作区先清待办、有待办就整池。
//
// 依据：定稿第十一章（docs/architecture/refresh-budget-architecture.html 增补第十一章）。四条纪律照写：
//   · 整池只剩三处：冷启动、每 10 分钟对账、票号增减。本文件遇到后两种只回一句「该整池了」，自己不发大查询；
//   · 水印只在变化真正并进列表之后才推进（delta.watermarkAfter）；
//   · 每工作区一个世代号，迟到的整池结果不许覆盖更新的增量结果（admitSnapshot 与 run 两处都过 delta.admitResult）；
//   · **deck.counts 是整仓口径，增量路径不许本地重算**，只许保持旧值并把 deck.partial 置真（票面点名的红线）。
//
// 为什么这一整块必须留 JS 而不是进 TS：它要真去 `gh api` 取数、要往磁盘写、要读写宿主那份快照缓存。
// 纯逻辑进 TS、取数与落盘留 JS 是本仓库既定的分工（docs/adr/20260913-builtin-ts-shape.md §2.7）。
//
// 待办与水印存在哪：就存在快照自己身上（快照的 delta 字段），跟着既有的磁盘缓存那一份文件走，
// 不另开缓存文件、不新增第二个写者。老快照没有这个字段 —— 那正是「旧结构，整池重建一次」的判据
// （delta.checkStructure），不许静默当新结构用。
//
// 日志：新增了一块持久化状态（每个工作区的水印、世代号与待办），按仓库日志纪律（AGENTS.md 的
// 「日志埋点五类」里的「新增的内存或磁盘缓存」）落一条按需级事件 `refresh.patch`：外层先判调试开关，
// 关着连字段对象都不组装；字段只取短散列、枚举与数字，工作区路径原文与命令行原文一个都不记。
//
// （2026-10-18 #1247 从 patch.js 转成 .ts：只加类型标注与注释，逻辑一行未动。
// 相对引用保持 .js 后缀，由 scripts/ts-hook.mts 改指同名 .ts；判定全在 delta.js 那一侧，
// 本文件只做跑腿，所以数字只从 delta 与接线处取，不在本文件写死；deck.counts 不许本地重算那条红线不变。）

// ---------------------------------------------------------------------------
// 类型（#1247 转写：只写类型不写实现）。
//
// 为什么这样标：快照是宿主缓存里那一份旧形状（issues、maps、version、deck 四栏），
// 老快照没有 delta 这一栏 —— 有没有这一栏正是「旧结构」的判据，所以快照整包按 any 收，
// 形状判断发生在 stateOf 与 checkStructure 那两处，类型不替运行时说它一定有。
// 增量状态（DeltaState）是本文件拥有的唯一形状：水印、世代号、待办三件，
// 待办只记票键字符串，路径与命令原文一个都不进；保证待办的去重与上限在 rememberPending 一处。
// ---------------------------------------------------------------------------

import * as delta from '../../kernel/snapshot-diff.js'
import * as merger from '../../kernel/snapshot-merge.js'
import { fetchThinRows } from './thin-row-fetch.js'

/** 快照里那份增量状态：水印、世代号、待办三件（待办只记票键，不记路径与命令）。 */
interface DeltaState {
  structureVersion?: number
  watermarkMs: number
  generation: number
  pending: string[]
  pendingAt: number
  pendingReason: string
}

/** 建补行件的依赖：全部由宿主接线注入，本文件不 import 宿主其它模块，免得接出环。 */
interface PatchDeps {
  readSnapshot?: (cwd: string) => any
  writeSnapshot?: (cwd: string, snap: any) => any
  indexOfSnapshot?: (snap: any) => any
  windowRules?: any
  probeIndex?: (cwd: string, sinceIso: string) => any
  getRepoKey?: (cwd: string) => any
  openSession?: (cwd: string, opts?: any) => any
  decide?: (req: any) => any
  now?: () => number
  hash8?: (s: string) => string
  maxRows?: number
  workspaceKeyOf?: (cwd: string) => string
}

/** 这块状态存在快照的哪个字段下。 */
export const DELTA_FIELD = 'delta'

/**
 * 建一个行级补行的跑腿件。deps 全部由宿主接线时注入（本文件不 import 宿主其它模块，免得接出环）：
 *   readSnapshot(cwd) → 现在列表所在的那份快照，没有就回 null
 *   writeSnapshot(cwd, snap) → 把并好的快照写回（内存与磁盘都由接线方负责）
 *   indexOfSnapshot(snap) → 从快照里取出「列表手上那份索引」（注入 indexWindow.indexFromSnapshot）
 *   windowRules → src/refresh/kernel/index-window-rules.js 那个模块（scanWindow / seedFromSnapshot）
 *   probeIndex(cwd, sinceIso) → 只问窗口内的变化，回 { ok, index } 或 { ok:false, error }
 *   getRepoKey(cwd) → 拼仓库坐标（owner/name）；openSession(cwd) → 取那几条薄查询用的只读会话
 *   decide(req) → 可选。只问一句「这一笔现在放不放行」，用来先判探查要不要发（生产里是闸的 decideFor）
 *   now / hash8 / logCtx / maxRows → 时间、短散列、日志出口与「一次最多补几行」
 */
export function createPatch(deps?: PatchDeps | null): any {
  const d: any = deps || {}
  const now: () => number = typeof d.now === 'function' ? d.now : Date.now
  const logCtx: any = d.logCtx || null
  const hash8: (s: string) => string = typeof d.hash8 === 'function' ? d.hash8 : function (s: any): string {
    try {
      const t = String(s || '')
      let h = 5381
      for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
      return ('0000000' + h.toString(16)).slice(-8)
    } catch (e: any) { return '00000000' }
  }
  const maxRows: number = typeof d.maxRows === 'number' && d.maxRows > 0 ? d.maxRows : delta.PATCH_MAX_ROWS
  const wsKeyOf: (cwd: string) => string = typeof d.workspaceKeyOf === 'function' ? d.workspaceKeyOf : function (cwd: any): string { return String(cwd || 'unknown') }

  /** 这一条路的账：门禁与现场排查都读它。 */
  const stats = { runs: 0, patched: 0, rebuildNeeded: 0, deferred: 0, failed: 0, staleDropped: 0, thinQueries: 0, noChange: 0 }

  function fire(mode: string, reason: string, extra?: any): void {
    // 按需级：外层先判调试开关，关着连字段对象都不组装（仓库日志纪律第 2 条，判断与发射同一行）。
    try {
      if (!logCtx || !logCtx.isEnabled('debug')) return
      const e: any = extra || {}
      const fields: any = { keyHash: e.keyHash || '', mode: mode, reason: reason, changed: e.changed || 0, queries: e.queries || 0, watermark: e.watermark || 'held', pending: e.pending || 0 }
      // err 只跟在失败行后面：写清上游给的原话（成功行一个字节都不多记）。
      // 335 契约 §2.4 的红线是「日志里不许出现工作区原始路径」，而上游错误原文经常带绝对路径：
      // 先把 Windows 盘符路径、UNC 路径与 POSIX 绝对路径整段换成 <path>，再截断 120 字符。
      if (e.err) fields.err = String(e.err).replace(/(?:[A-Za-z]:[\\/]|\\\\|\/(?:[^\s"'\u3001\uff0c\u3002\uff1b\uff09\u0029])+\/)[^\s"'\u3001\uff0c\u3002\uff1b\uff09\u0029]*/g, '<path>').slice(0, 120)
      logCtx.fire('debug', 'refresh.patch', fields)
    } catch (eL: any) { /* 日志不许把主流程带崩 */ }
  }

  /** 快照里那份增量状态的形状。老快照没有这个字段 —— 那正是「旧结构」的判据。 */
  function stateOf(snap: any): DeltaState {
    const raw: any = (snap && typeof snap === 'object' && snap[DELTA_FIELD] && typeof snap[DELTA_FIELD] === 'object') ? snap[DELTA_FIELD] : null
    const s: any = raw || {}
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
  function withState(snap: any, st: DeltaState): any {
    const out: any = Object.assign({}, snap)
    out[DELTA_FIELD] = {
      structureVersion: delta.DELTA_STRUCTURE_VERSION,
      watermarkMs: st.watermarkMs, generation: st.generation,
      pending: st.pending, pendingAt: st.pendingAt, pendingReason: st.pendingReason,
    }
    return out
  }

  /** checkStructure 的入参：把「没有这个字段」与「字段是 0」分得开。 */
  function structureStamp(st: DeltaState): any {
    return (typeof st.structureVersion === 'number') ? { structureVersion: st.structureVersion } : {}
  }

  async function readSnap(cwd: any): Promise<any> { return await Promise.resolve(d.readSnapshot(cwd)) }
  async function writeSnap(cwd: any, snap: any): Promise<any> { return await Promise.resolve(d.writeSnapshot(cwd, snap)) }

  /** 待办现在有几条（给界面与日志用）。 */
  async function pendingCount(cwd: any): Promise<number> { return stateOf(await readSnap(cwd)).pending.length }

  /** 把几条变化记进待办（去重、按编号排序、最多留 500 条）。 */
  async function rememberPending(cwd: any, snap: any, keys: any, reason: any): Promise<number> {
    const st: DeltaState = stateOf(snap)
    const set: Record<string, boolean> = {}
    st.pending.forEach(function (k: string): void { set[k] = true })
    ;(keys || []).forEach(function (k: any): void { if (k) set[String(k)] = true })
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
  async function enterWorkspace(cwd: any): Promise<any> {
    const snap: any = await readSnap(cwd)
    if (!snap) return { mode: 'rebuild', reason: 'no-baseline', pending: 0 }
    const st: DeltaState = stateOf(snap)
    if (!st.pending.length) return { mode: 'use-cache', reason: 'no-pending', pending: 0 }
    const n = st.pending.length
    st.pending = []
    st.pendingAt = 0
    st.pendingReason = ''
    await writeSnap(cwd, withState(snap, st))
    return { mode: 'rebuild', reason: 'pending-todo', pending: n }
  }

  // 取数三件套（thinArgs/rowOf/fetchThinRows）已搬至 ./thin-row-fetch.js（#1255）：只发请求、拼行，
  // 合并、水印、待办仍在这里。调用点在 run() 第 ⑧ 步。

  /**
   * 整池那边回来的结果要走这里：先问世代号还算不算数，再落盘。
   * 这一条就是「迟到的整池结果不许覆盖更新的增量结果」在 JS 那一侧的落点 ——
   * 整池发起时记着手里的 generation，回来时增量已经把世代推走了，这里把它丢掉（一个字段都不写）。
   */
  async function admitSnapshot(cwd: any, snap: any, startedGeneration: any): Promise<any> {
    const cur: any = await readSnap(cwd)
    const st: DeltaState = stateOf(cur)
    const g: any = delta.admitResult(st.generation, startedGeneration)
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
  async function run(cwd: any, opts?: any): Promise<any> {
    const o: any = opts || {}
    stats.runs += 1
    const keyHash = hash8(wsKeyOf(cwd))
    const snap: any = await readSnap(cwd)
    // ① 手上没有可比对的列表：冷启动，整池（定稿第十一章「什么时候仍整池」①）。
    if (!snap || !Array.isArray(snap.issues)) { stats.rebuildNeeded += 1; fire('rebuild', 'no-baseline', { keyHash: keyHash }); return { mode: 'rebuild', reason: 'no-baseline' } }
    // ② 切进工作区那一下：有待办就整池（并清掉待办）。
    if (o.entered) {
      const e: any = await enterWorkspace(cwd)
      if (e.mode === 'rebuild') { stats.rebuildNeeded += 1; fire('rebuild', e.reason, { keyHash: keyHash, pending: e.pending }); return e }
    }
    // ③ 磁盘上那份是旧结构（或比本机制还新）：不许静默当新结构用，整池重建一次。
    const st: DeltaState = stateOf(snap)
    const sv: any = delta.checkStructure(structureStamp(st))
    if (sv.action === 'rebuild') { stats.rebuildNeeded += 1; fire('rebuild', sv.reason, { keyHash: keyHash, pending: st.pending.length }); return { mode: 'rebuild', reason: sv.reason } }
    // ④ 没有可用水印：拿这份快照自己的生成时刻当起点（快照就是那一刻的真状态）。
    let watermarkMs = st.watermarkMs
    if (!watermarkMs) {
      const seed: any = d.windowRules.seedFromSnapshot(snap, now())
      if (!seed || !seed.watermarkMs) { stats.rebuildNeeded += 1; fire('rebuild', 'no-watermark', { keyHash: keyHash }); return { mode: 'rebuild', reason: 'no-watermark' } }
      watermarkMs = seed.watermarkMs
    }
    const scanStartedMs = now()
    // ⑤ 探查这一笔也过闸：不在活跃集合里、额度不够、撞上限流时，这里直接回「推迟」——
    //    什么都不发，水印一个字节都不动，下一次仍然会发现同一条变化。
    if (typeof d.decide === 'function') {
      const v: any = await Promise.resolve(d.decide({ source: 'probe.tick', kind: 'probe', workspaceKey: wsKeyOf(cwd) }))
      if (v && v.verdict === 'defer') { stats.deferred += 1; fire('deferred', v.reason, { keyHash: keyHash, watermark: 'held', pending: st.pending.length }); return { mode: 'deferred', reason: v.reason, pending: st.pending.length } }
    }
    const repo: any = await Promise.resolve(d.getRepoKey(cwd))
    if (!repo || !repo.owner || !repo.name) { stats.failed += 1; fire('failed', 'no-repo', { keyHash: keyHash }); return { mode: 'failed', reason: 'no-repo', pending: st.pending.length } }
    // o.full 那一档是「整扫」：每 10 分钟的对账那一趟走它。整扫回来的是完整一份，基线要重置而不是并进去，
    // 否则删票永远观察不到（定稿第十一章「消失（删票）」）。增量那一趟才是缩着窗口问的。
    const win: any = o.full === true ? { sinceIso: '', full: true, sinceMs: 0 } : d.windowRules.scanWindow(watermarkMs, scanStartedMs)
    const remote: any = await Promise.resolve(d.probeIndex(cwd, win.sinceIso))
    if (!remote || remote.ok !== true || !remote.index) { stats.failed += 1; fire('failed', 'probe-failed', { keyHash: keyHash }); return { mode: 'failed', reason: 'probe-failed', pending: st.pending.length } }
    // ⑥ 差分（纯逻辑在 delta.js）：「哪些行变了」与「该走哪条路」一次算清。
    const plan: any = delta.planDelta(d.indexOfSnapshot(snap), remote.index, { full: win.full === true })
    if (plan.mode === 'rebuild') { stats.rebuildNeeded += 1; fire('rebuild', plan.reason, { keyHash: keyHash, changed: plan.changed.length, pending: st.pending.length }); return { mode: 'rebuild', reason: plan.reason, added: plan.added.length, removed: plan.removed.length } }
    if (plan.mode === 'nothing') {
      const wv: any = delta.watermarkAfter({ previousMs: st.watermarkMs || watermarkMs, scanStartedMs: scanStartedMs, outcome: 'not-need' })
      await writeSnap(cwd, withState(snap, Object.assign({}, st, { watermarkMs: wv.watermarkMs })))
      stats.noChange += 1
      fire('nothing', wv.reason, { keyHash: keyHash, watermark: wv.advanced ? 'advanced' : 'held', pending: st.pending.length })
      return { mode: 'nothing', reason: wv.reason, watermarkMs: wv.watermarkMs }
    }
    // ⑦ 变的那几条太多：一条一请求地补过去已经不划算，交给整池（整池 13 点 7 条请求，见 budget.js）。
    if (plan.changed.length > maxRows) { stats.rebuildNeeded += 1; fire('rebuild', 'too-many-rows', { keyHash: keyHash, changed: plan.changed.length, pending: st.pending.length }); return { mode: 'rebuild', reason: 'too-many-rows', changed: plan.changed.length } }
    // ⑧ 取那几条薄的（取数三件套在 ./thin-row-fetch.js，依赖由这里注入）。
    //    #1689 降级常驻时这一轮先过预算闸：探测那一条已经预扣过，增量这一轮最多 3 条；
    //    要补的行超过预算剩余就整轮推迟 —— 水印不动、变化进待办，下一拍或整仓枚举再补，绝不超发。
    const roundBudget: any = o.fallbackBudget || null
    if (roundBudget && plan.changed.length > roundBudget.view().remaining) {
      const pending = await rememberPending(cwd, snap, plan.changed, 'fallback-budget')
      stats.deferred += 1
      fire('deferred', 'fallback-budget', { keyHash: keyHash, changed: plan.changed.length, watermark: 'held', pending: pending })
      return { mode: 'deferred', reason: 'fallback-budget', pending: pending, keys: plan.changed }
    }
    const startedGeneration = st.generation
    // #1690：合并服务是唯一写入入口。起读时先记下当前合并版本，取数回来再过版本门；
    // 版本门与世代号是两扇门：世代号防「迟到的整池覆盖更新的增量」，合并版本号防「更旧的结果整份回退」。
    const startedMergeVersion: number = merger.mergeVersionOf(snap)
    const got: any = await fetchThinRows({ openSession: d.openSession, stats: stats, budget: roundBudget }, cwd, repo, plan.changed)
    if (!got.ok) {
      const pending = await rememberPending(cwd, snap, got.keys || plan.changed, got.reason)
      if (got.outcome === 'deferred') stats.deferred += 1; else stats.failed += 1
      fire(got.outcome === 'deferred' ? 'deferred' : 'failed', got.reason, { keyHash: keyHash, changed: plan.changed.length, watermark: 'held', pending: pending })
      return { mode: got.outcome === 'deferred' ? 'deferred' : 'failed', reason: got.reason, pending: pending, keys: got.keys }
    }
    // ⑨ 两扇门：世代号（迟到的整池结果不许覆盖更新的增量结果）与合并版本号（更旧的结果整份丢弃）。
    //    先读一遍最新快照再判，避免拿着过期的基线去合并。
    const latest: any = await readSnap(cwd)
    const latestState: DeltaState = stateOf(latest)
    const g: any = delta.admitResult(latestState.generation, startedGeneration)
    if (!g.accept) { stats.staleDropped += 1; fire('patch', g.reason, { keyHash: keyHash, changed: plan.changed.length, watermark: 'held' }); return { mode: 'stale-dropped', reason: g.reason } }
    // ⑩ 并进列表（唯一写入入口在 kernel/snapshot-merge.ts）：字段组级合并——位置不动、读路径不新增行、
    //    只有完整来源能覆盖或清空字段组；降级/截断来源只能补空缺，已知的父边、依赖、计数、正文、评论、评审一条不丢。
    const merged: any = merger.mergeSnapshot(latest, {
      kind: 'read', startVersion: startedMergeVersion, startedMs: scanStartedMs,
      rows: got.rows, allowNewRows: false,
    })
    if (merged.verdict !== 'merged') {
      stats.staleDropped += 1
      fire('patch', 'merge-stale', { keyHash: keyHash, changed: plan.changed.length, watermark: 'held' })
      return { mode: 'stale-dropped', reason: 'merge-stale' }
    }
    if (merged.missing.length) {
      const pending = await rememberPending(cwd, latest, merged.missing, 'merge-missing')
      stats.failed += 1
      fire('failed', 'merge-missing', { keyHash: keyHash, changed: merged.missing.length, watermark: 'held', pending: pending })
      return { mode: 'failed', reason: 'merge-missing', pending: pending, keys: merged.missing }
    }
    // ⑪ 派生值：进度环本地重算（客户端按行算）；**deck.counts 保持旧值并把 deck.partial 置真**
    //    —— 这条是红线：counts 是整仓口径，只有整池拿得到，本地硬算一个出来就是假数字。
    const derived: any = delta.derivedAfter('patch')
    const deck: any = Object.assign({}, (latest.deck && typeof latest.deck === 'object') ? latest.deck : {})
    if (derived.markPartial) deck.partial = true
    const wv: any = delta.watermarkAfter({ previousMs: latestState.watermarkMs || watermarkMs, scanStartedMs: scanStartedMs, outcome: 'merged' })
    const nextState: DeltaState = {
      watermarkMs: wv.watermarkMs, generation: g.generation, pendingAt: latestState.pendingAt, pendingReason: latestState.pendingReason,
      pending: latestState.pending.filter(function (k: string): boolean { return merged.changes.updated.indexOf(k) < 0 }),
    }
    // 合并服务只把内容版本号放在回执里（快照里的 version 是信封契约版本，不归它改），由这里写回快照。
    const next = withState(Object.assign({}, merged.snapshot, {
      version: merged.version, generatedMs: now(), updatedAt: new Date(now()).toISOString(), deck: deck,
    }), nextState)
    await writeSnap(cwd, next)
    stats.patched += 1
    fire('patch', 'rows-changed', { keyHash: keyHash, changed: merged.changes.updated.length, queries: got.queries, watermark: wv.advanced ? 'advanced' : 'held', pending: nextState.pending.length })
    return {
      mode: 'patch', reason: 'rows-changed', rows: merged.changes.updated, queries: got.queries,
      version: merged.version, mergeVersion: merged.merge.version, partial: deck.partial === true, counts: derived.countsAction,
      watermarkMs: wv.watermarkMs, generation: g.generation, pending: nextState.pending.length,
    }
  }

  /**
   * 补行件与「补最近变过的那几条」共用的前四步：有没有可比对的列表、结构对不对、仓库坐标拿不拿得到。
   * 回 { snap, st, repo } 表示可以往下补；回 { mode, reason } 表示这一趟到此为止（照旧整池或如实失败）。
   * 抽出来是因为两条补行路的前半段一字不差，各写一份迟早会漂移（一条补了日志、另一条忘了）。
   */
  async function preflight(cwd: any, keyHash: string): Promise<any> {
    const snap: any = await readSnap(cwd)
    if (!snap || !Array.isArray(snap.issues)) { stats.rebuildNeeded += 1; fire('rebuild', 'no-baseline', { keyHash: keyHash }); return { mode: 'rebuild', reason: 'no-baseline' } }
    const st: DeltaState = stateOf(snap)
    const sv: any = delta.checkStructure(structureStamp(st))
    if (sv.action === 'rebuild') { stats.rebuildNeeded += 1; fire('rebuild', sv.reason, { keyHash: keyHash, pending: st.pending.length }); return { mode: 'rebuild', reason: sv.reason, pending: st.pending.length } }
    const repo: any = await Promise.resolve(d.getRepoKey(cwd))
    if (!repo || !repo.owner || !repo.name) { stats.failed += 1; fire('failed', 'no-repo', { keyHash: keyHash }); return { mode: 'failed', reason: 'no-repo', pending: st.pending.length } }
    return { snap: snap, st: st, repo: repo }
  }

  /**
   * 写事件之后补那一张票（#1472）：只取这一条薄行、并进列表、交回新快照。
   *
   * 与 run() 的区别：不探测窗口、不算差分、不动水印 —— 写事件已经知道改的是哪一张票，
   * 再问一遍「最近变过什么」既慢，又会把一次写落回成整份重建。补的是哪一张由调用方点名。
   *
   * 新建的票必须真的出现在列表里：合并服务的约定是「位置不动、读路径绝不新增行」，
   * 写回执这一路（allowNewRows）把列表里还没有的那几行按取回来的顺序追加到最后，
   * 并记进 changes.added。为什么并进列表而不是等整池：验收第 3 条就是「新建票不重启 DSH 也能看见」。
   *
   * 地图下面那一份（maps[].tickets）只并已有行：新行没有父信息，这里编一个父只会编错，
   * 等下一次整池统一挂上去。降级来源只补空缺，关系组一条不缩。派生值只处置 deck.partial
   * （counts 是整仓口径，红线不变）。
   *
   * 回哪一档都能被调用方当成一句话安排下一步：
   *   { mode:'patch', rows, snapshot, version, queries, partial }  已经并进快照并落盘（rows 是变了的键）
   *   { mode:'rebuild', reason }      没有可比对的列表或旧结构：照旧整池
   *   { mode:'failed'|'deferred', reason, pending, keys }  没并进去，变化进待办
   *   { mode:'stale-dropped', reason } 这份结果已经过期（更新的结果先落地了）
   */
  async function patchTickets(cwd: any, keys: any): Promise<any> {
    const list: string[] = (Array.isArray(keys) ? keys : []).map(function (k: any): string { return String(k) }).filter(Boolean)
    const keyHash = hash8(wsKeyOf(cwd))
    // 一张都没点名也算跑过一趟：记一行，免得现场只看到「什么都没发生」却查不出为什么。
    if (!list.length) { fire('nothing', 'no-keys', { keyHash: keyHash }); return { mode: 'nothing', reason: 'no-keys' } }
    const pre: any = await preflight(cwd, keyHash)
    if (pre.mode) { const out: any = { mode: pre.mode, reason: pre.reason }; if (typeof pre.pending === 'number') out.pending = pre.pending; return out }
    const snap: any = pre.snap
    const st: DeltaState = pre.st
    const repo: any = pre.repo
    const startedGeneration = st.generation
    const startedMergeVersion: number = merger.mergeVersionOf(snap)
    // 只取这几条薄的（取数三件套在 ./thin-row-fetch.ts，依赖仍由这里注入）。
    const got: any = await fetchThinRows({ openSession: d.openSession, stats: stats }, cwd, repo, list)
    if (!got.ok) {
      const pending = await rememberPending(cwd, snap, got.keys || list, got.reason)
      if (got.outcome === 'deferred') stats.deferred += 1; else stats.failed += 1
      fire(got.outcome === 'deferred' ? 'deferred' : 'failed', got.reason, { keyHash: keyHash, changed: list.length, watermark: 'held', pending: pending })
      return { mode: got.outcome === 'deferred' ? 'deferred' : 'failed', reason: got.reason, pending: pending, keys: got.keys }
    }
    // 世代号与合并版本门：这一份还算不算数。不算就整份丢掉，一个字段都不写。
    const latest: any = await readSnap(cwd)
    const latestState: DeltaState = stateOf(latest)
    const g: any = delta.admitResult(latestState.generation, startedGeneration)
    if (!g.accept) { stats.staleDropped += 1; fire('patch', g.reason, { keyHash: keyHash, changed: list.length, watermark: 'held' }); return { mode: 'stale-dropped', reason: g.reason } }
    // 写回执走同一条合并入口：允许新增行（新建票要立刻出现在列表里），已有行按字段组掩码合并，
    // 降级来源只补空缺。地图下面那一份只并已有行，新行等整池统一挂父。
    const merged: any = merger.mergeSnapshot(latest, {
      kind: 'write', startVersion: startedMergeVersion, startedMs: now(), rows: got.rows, allowNewRows: true,
    })
    if (merged.verdict !== 'merged') {
      stats.staleDropped += 1
      fire('patch', 'merge-stale', { keyHash: keyHash, changed: list.length, watermark: 'held' })
      return { mode: 'stale-dropped', reason: 'merge-stale' }
    }
    if (merged.missing.length) {
      const pending = await rememberPending(cwd, latest, merged.missing, 'merge-missing')
      stats.failed += 1
      fire('failed', 'merge-missing', { keyHash: keyHash, changed: merged.missing.length, watermark: 'held', pending: pending })
      return { mode: 'failed', reason: 'merge-missing', pending: pending, keys: merged.missing }
    }
    const derived: any = delta.derivedAfter('patch')
    const deck: any = Object.assign({}, (latest.deck && typeof latest.deck === 'object') ? latest.deck : {})
    if (derived.markPartial) deck.partial = true
    const changedKeys: any[] = merged.changes.updated.concat(merged.changes.added)
    const nextState: DeltaState = {
      // 水印一个字节都不动：写事件这一条不是窗口探测，动水印会让下一次探测错过窗口。
      watermarkMs: latestState.watermarkMs, generation: g.generation, pendingAt: latestState.pendingAt, pendingReason: latestState.pendingReason,
      pending: latestState.pending.filter(function (k: string): boolean { return changedKeys.indexOf(k) < 0 }),
    }
    // 合并服务只把内容版本号放在回执里（快照里的 version 是信封契约版本，不归它改），由这里写回快照。
    const next = withState(Object.assign({}, merged.snapshot, {
      version: merged.version, generatedMs: now(), updatedAt: new Date(now()).toISOString(), deck: deck,
    }), nextState)
    await writeSnap(cwd, next)
    stats.patched += 1
    fire('patch', 'write-patch', { keyHash: keyHash, changed: changedKeys.length, queries: got.queries, watermark: 'held', pending: nextState.pending.length })
    return { mode: 'patch', reason: 'write-patch', rows: changedKeys, version: merged.version, snapshot: next, queries: got.queries, partial: deck.partial === true, generation: g.generation, watermarkMs: nextState.watermarkMs }
  }

  /**
   * 新建票之后补一次（#1472，验收第 2 条）：写事件里点不出票号，只能先问窗口索引，再只补变的那几条。
   *
   * 为什么不复用 run()：run() 见到「票号有增减」一律回 rebuild —— 新建一张票必然落进那一支，
   * 于是写事件这一格又变成整份重建、又要等二十几秒。这里只把「新增」当作可补的几条：
   *   · 只差新增（没有删除）→ 补新增的那几条，把它们追加到列表尾（patchTickets 已经会追加）；
   *   · 只差改了几行 → 照常补那几行；
   *   · 有删除、或者别的重建理由 → 如实回 rebuild，交给既有整池路径。
   * 窗口探测这一笔也过闸（与 run 同一句 decide）：被推迟就连探测请求都不发。
   * 水印照 run 的规矩推进：只有真的并进列表才动；什么都不用补时按 not-need 推进。
   */
  async function patchChanged(cwd: any): Promise<any> {
    stats.runs += 1
    const keyHash = hash8(wsKeyOf(cwd))
    const pre: any = await preflight(cwd, keyHash)
    if (pre.mode) { const out: any = { mode: pre.mode, reason: pre.reason }; if (typeof pre.pending === 'number') out.pending = pre.pending; return out }
    const snap: any = pre.snap
    const st: DeltaState = pre.st
    let watermarkMs = st.watermarkMs
    if (!watermarkMs) {
      const seed: any = d.windowRules.seedFromSnapshot(snap, now())
      if (!seed || !seed.watermarkMs) { stats.rebuildNeeded += 1; fire('rebuild', 'no-watermark', { keyHash: keyHash }); return { mode: 'rebuild', reason: 'no-watermark' } }
      watermarkMs = seed.watermarkMs
    }
    const scanStartedMs = now()
    if (typeof d.decide === 'function') {
      const v: any = await Promise.resolve(d.decide({ source: 'probe.tick', kind: 'probe', workspaceKey: wsKeyOf(cwd) }))
      if (v && v.verdict === 'defer') { stats.deferred += 1; fire('deferred', v.reason, { keyHash: keyHash, watermark: 'held', pending: st.pending.length }); return { mode: 'deferred', reason: v.reason, pending: st.pending.length } }
    }
    const win: any = d.windowRules.scanWindow(watermarkMs, scanStartedMs)
    const remote: any = await Promise.resolve(d.probeIndex(cwd, win.sinceIso))
    if (!remote || remote.ok !== true || !remote.index) { stats.failed += 1; fire('failed', 'probe-failed', { keyHash: keyHash }); return { mode: 'failed', reason: 'probe-failed', pending: st.pending.length } }
    const plan: any = delta.planDelta(d.indexOfSnapshot(snap), remote.index, { full: win.full === true })
    if (plan.mode === 'nothing') {
      const wv: any = delta.watermarkAfter({ previousMs: st.watermarkMs || watermarkMs, scanStartedMs: scanStartedMs, outcome: 'not-need' })
      await writeSnap(cwd, withState(snap, Object.assign({}, st, { watermarkMs: wv.watermarkMs })))
      stats.noChange += 1
      fire('nothing', wv.reason, { keyHash: keyHash, watermark: wv.advanced ? 'advanced' : 'held', pending: st.pending.length })
      return { mode: 'nothing', reason: wv.reason, watermarkMs: wv.watermarkMs }
    }
    // 要补的条数（改的 + 新增的）超过一次补行的上限时，一条一请求不划算，交回整池。
    if (plan.changed.length + plan.added.length > maxRows) { stats.rebuildNeeded += 1; fire('rebuild', 'too-many-rows', { keyHash: keyHash, changed: plan.changed.length + plan.added.length, pending: st.pending.length }); return { mode: 'rebuild', reason: 'too-many-rows', changed: plan.changed.length + plan.added.length } }
    // 只差新增（没有删除）时，「整池」不是唯一出路：点名补新增的那几条即可。
    if (plan.mode === 'rebuild' && plan.reason === 'ticket-set-changed' && plan.added.length > 0 && plan.removed.length === 0) {
      return await patchTickets(cwd, plan.changed.concat(plan.added))
    }
    if (plan.mode === 'rebuild') { stats.rebuildNeeded += 1; fire('rebuild', plan.reason, { keyHash: keyHash, changed: plan.changed.length, pending: st.pending.length }); return { mode: 'rebuild', reason: plan.reason, added: plan.added.length, removed: plan.removed.length } }
    return await patchTickets(cwd, plan.changed)
  }

  return {
    run: run,
    patchChanged: patchChanged,
    patchTickets: patchTickets,
    // 写事件取数那一格只借这里发日志：refresh.patch 的字段口径全仓只有 fire 这一处。
    log: fire,
    enterWorkspace: enterWorkspace,
    admitSnapshot: admitSnapshot,
    pendingCount: pendingCount,
    state: async function (cwd: any): Promise<DeltaState> { return stateOf(await readSnap(cwd)) },
    threshold: { maxRows: maxRows },
    stats: function (): any { return Object.assign({}, stats) },
  }
}
