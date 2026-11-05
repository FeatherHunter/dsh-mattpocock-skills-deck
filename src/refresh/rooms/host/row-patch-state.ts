// src/refresh/rooms/host/row-patch-state.ts —— 行级增量的那三样状态：水印、世代号、待办（#1888 拆出）
//
// 为什么单列：这三样从 #1888 起住进快照库的库级元信息，不再只活在宿主内存快照的 delta 字段里。
// 读写它们要碰库的门面，而 row-patch.ts 是「取数 + 合并」的跑腿件、又贴着 350 有效行上限；
// 把状态这一段搬出来，两条路（窗口增量与写事件补行）共用同一份读写口径，不会各写一套。
//
// 三条不能改的约定：
//   1. 接了库：一切以库为准。读不出来就回 null（调用方按失败处理），不许拿内存那份顶上 ——
//      那正是「同一张票两个值」的来源。没接库：照旧读写快照的 delta 字段（老调用方与旧门禁）。
//   2. 先落库、再显示：簿记写库成功之后才（在门禁夹具里）镜像到假快照；写库失败时内存一个字节不改。
//      #1893 起生产装配没有内存副本可镜像：写库成功就是这一步的全部结果。
//   3. 行与簿记要一起写时走 commitChanges 的同一个事务（变化行那条路）：行进去了、水印/世代号
//      没进去，下一拍会重扫；反过来界面会拿到不满意的结果。
import * as delta from '../../kernel/snapshot-diff.js'
import * as merger from '../../kernel/snapshot-merge.js'

/** 这块状态存在快照的哪个字段下（没接库时仍写在这里，形状与改造前一致）。 */
export const DELTA_FIELD = 'delta'

/** 水印、世代号、待办三样；pendingAt 与 pendingReason 是「最近一次记待办」的时刻与原因。 */
export interface DeltaState {
  structureVersion?: number
  watermarkMs: number
  generation: number
  pending: string[]
  pendingAt: number
  pendingReason: string
}

/** 行级增量认的库口（结构上就是 patch-library-ports 的返回值，不 import 它免得接出环）。 */
export interface PatchLibraryPortLike {
  /** 这一趟能不能按库走；老装配没有这一格时按「能」处理（门面在就该按库走）。 */
  ready?(cwd: string): Promise<boolean>
  readState(cwd: string): Promise<{ state: any, mergeVersion: number } | null>
  writeState(cwd: string, write: any): Promise<{ committed: boolean, state?: any, reason?: string } | null>
  readBaseline(cwd: string): Promise<Record<string, string> | null>
  commitRows(
    cwd: string,
    rows: readonly unknown[],
    sync: any,
    startMergeVersion: number,
  ): Promise<{ ok: boolean, reason?: string, mergeVersion?: number | null, sync?: any } | null>
}

/** 造状态读写件要的依赖；除 library 外都由 row-patch 现给。 */
export interface PatchStateDeps {
  readSnapshot(cwd: string): Promise<any>
  /**
   * #1893：宿主内存快照副本已删，生产装配不再有这个口。它只剩门禁夹具（不接库的老世界）会注入；
   * 缺席时下面 writeSnap 是一个明确的空操作——簿记写库成功之后没有「再镜像到内存」这一步。
   */
  writeSnapshot?(cwd: string, snap: any): Promise<any>
  library?: PatchLibraryPortLike | null
  now: () => number
  /** 与 row-patch 同一个日志出口：refresh.patch 的字段口径全仓只有那一处 fire。 */
  fire?: (mode: string, reason: string, extra?: any) => void
  /** 这一份结果被判过期时给统计加一（row-patch 的 stats.staleDropped）。 */
  noteStale?: () => void
}

/** 快照 delta 字段的读数（老路径；没接库时仍走它）。 */
export function stateOfSnapshot(snap: any): DeltaState {
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

/** 库里那份簿记的读数。结构版本按当前机制算（库里的行由库自己的迁移管，不归这里判）。 */
export function stateOfBook(raw: any): DeltaState {
  const s: any = raw || {}
  return {
    structureVersion: delta.DELTA_STRUCTURE_VERSION,
    watermarkMs: Number(s.watermarkMs) || 0,
    generation: Number(s.generation) || 0,
    pending: Array.isArray(s.pending) ? s.pending.map(String).filter(Boolean) : [],
    pendingAt: Number(s.pendingAtMs) || 0,
    pendingReason: String(s.pendingReason || ''),
  }
}

/** 把状态放回快照（其它字段一个字不动）；delta 的键集与改造前逐字一致。 */
export function withState(snap: any, st: DeltaState): any {
  const out: any = Object.assign({}, snap)
  out[DELTA_FIELD] = {
    structureVersion: delta.DELTA_STRUCTURE_VERSION,
    watermarkMs: st.watermarkMs, generation: st.generation,
    pending: st.pending, pendingAt: st.pendingAt, pendingReason: st.pendingReason,
  }
  return out
}

/** checkStructure 的入参：把「没有这个字段」与「字段是 0」分得开。 */
export function structureStamp(st: DeltaState): any {
  return (typeof st.structureVersion === 'number') ? { structureVersion: st.structureVersion } : {}
}

/** 簿记写法的入参：只给要改的格；sync 那边按它合。 */
export function syncWriteOf(st: DeltaState, extra?: Record<string, unknown>): any {
  return Object.assign({
    watermarkMs: st.watermarkMs,
    generation: st.generation,
    pending: st.pending,
    pendingAtMs: st.pendingAt,
    pendingReason: st.pendingReason,
  }, extra || null)
}

/** 状态读写件：库在走库，库不在走内存；两条路的对外形状一致。 */
export function createPatchState(deps: PatchStateDeps) {
  const d = deps
  const library = d.library || null
  const now = d.now

  async function readSnap(cwd: string): Promise<any> { return await Promise.resolve(d.readSnapshot(cwd)) }
  /** #1893：生产没有写路（内存副本已删）；门禁夹具注入时才写它自己的假世界。 */
  async function writeSnap(cwd: string, snap: any): Promise<any> {
    if (typeof d.writeSnapshot !== 'function') return
    return await Promise.resolve(d.writeSnapshot(cwd, snap))
  }

  /**
   * 这一趟能不能按库走。老装配（假门面、旧宿主版本）没有 ready 这一格时按「能」处理；
   * 门面齐但这一趟读不出来，由下面的 load 回 null，按失败处理（不拿内存顶上）。
   */
  async function usable(cwd: string): Promise<boolean> {
    if (!library) return false
    if (typeof library.ready !== 'function') return true
    try { return (await Promise.resolve(library.ready(cwd))) === true } catch (e) { return false }
  }

  /** 这一趟的起读状态。回 null = 接了库却读不出来（调用方按失败处理，不回落内存）。 */
  async function load(cwd: string, snap: any): Promise<{ state: DeltaState, mergeVersion: number, fromLibrary: boolean } | null> {
    if (!library || !(await usable(cwd))) {
      return { state: stateOfSnapshot(snap), mergeVersion: merger.mergeVersionOf(snap), fromLibrary: false }
    }
    let got: any = null
    try { got = await Promise.resolve(library.readState(cwd)) } catch (e) { got = null }
    if (!got || !got.state) return null
    return { state: stateOfBook(got.state), mergeVersion: Number(got.mergeVersion) || 0, fromLibrary: true }
  }

  /** 差分基线：接了库读库（库里没有这份数据回 null，调用方据此整池），没接库读快照。 */
  async function baseline(cwd: string, fromLibrary: boolean, snap: any): Promise<Record<string, string> | null> {
    if (!fromLibrary || !library) return null
    try {
      const index = await Promise.resolve(library.readBaseline(cwd))
      return (index && typeof index === 'object') ? index : null
    } catch (e) {
      return null
    }
  }

  /**
   * 只写簿记：库先提交，成功后才镜像进内存快照；库写失败时内存一个字节不改。
   *
   * patch 只该带「这一次真的要改的那几格」，不要把整份状态重发一遍：另一趟并发提交刚把世代号
   * 推走时，把旧世代号整份写回去等于把它按回去。patch 缺省时才按整份状态写（只用于「没有并发
   * 话题」的场合，今天没有调用方这么用）。
   */
  async function writeState(
    cwd: string,
    snap: any,
    st: DeltaState,
    patch?: Record<string, unknown>,
  ): Promise<{ ok: boolean, reason?: string }> {
    if (library && (await usable(cwd))) {
      let got: any = null
      try { got = await Promise.resolve(library.writeState(cwd, patch || syncWriteOf(st))) } catch (e) { got = null }
      if (!got || got.committed !== true) {
        const reason = (got && got.reason === 'stale') ? 'stale' : 'store-write-failed'
        if (reason === 'stale' && typeof d.noteStale === 'function') d.noteStale()
        return { ok: false, reason: reason }
      }
    }
    await writeSnap(cwd, withState(snap, st))
    return { ok: true }
  }

  /**
   * 变化行与簿记一个事务提交，成功后才写内存快照。#1888 的核心一句：先落库、再显示。
   * 库不可用、写失败或被门挡下时回 ok:false —— 调用方原样按失败 / 过期处理，内存不改。
   */
  async function commitChanges(
    cwd: string,
    input: { rows: readonly unknown[], snapshot: any, state: DeltaState, startMergeVersion: number, expectedGeneration: number },
  ): Promise<{ ok: boolean, reason?: string }> {
    if (library && (await usable(cwd))) {
      let got: any = null
      try {
        got = await Promise.resolve(library.commitRows(
          cwd, input.rows, syncWriteOf(input.state, { expectedGeneration: input.expectedGeneration }), input.startMergeVersion,
        ))
      } catch (e) { got = null }
      if (!got) return { ok: false, reason: 'store-unavailable' }
      if (got.ok !== true) {
        const stale = got.reason === 'stale'
        if (stale && typeof d.noteStale === 'function') d.noteStale()
        return { ok: false, reason: stale ? 'stale' : 'store-write-failed' }
      }
    }
    await writeSnap(cwd, input.snapshot)
    return { ok: true }
  }

  /** 写事件那条路：行已经由写回执先落库了，这里只把簿记认下来，然后才写内存快照。 */
  async function claimState(cwd: string, snapshot: any, st: DeltaState, expectedGeneration: number): Promise<{ ok: boolean, reason?: string }> {
    return await writeState(cwd, snapshot, st, {
      generation: st.generation, pending: st.pending, pendingAtMs: st.pendingAt, pendingReason: st.pendingReason,
      expectedGeneration: expectedGeneration,
    })
  }

  /** 待办里现在有几条。 */
  async function pendingCount(cwd: string): Promise<number> {
    const snap = await readSnap(cwd)
    const loaded = await load(cwd, snap)
    return loaded ? loaded.state.pending.length : stateOfSnapshot(snap).pending.length
  }

  /** 把几条变化记进待办（去重、按票号排序、最多留 500 条）。写库失败时内存不改、原样回旧条数。 */
  async function rememberPending(cwd: string, snap: any, st: DeltaState, keys: readonly unknown[], reason: unknown): Promise<{ ok: boolean, pending: number }> {
    const set: Record<string, boolean> = {}
    st.pending.forEach((k) => { set[k] = true })
    ;(keys || []).forEach((k) => { if (k) set[String(k)] = true })
    const next: DeltaState = Object.assign({}, st, {
      pending: Object.keys(set).sort().slice(-500),
      pendingAt: now(),
      pendingReason: String(reason || ''),
    })
    const written = await writeState(cwd, snap, next, {
      pending: next.pending, pendingAtMs: next.pendingAt, pendingReason: next.pendingReason,
      expectedGeneration: st.generation,
    })
    return { ok: written.ok, pending: written.ok ? next.pending.length : st.pending.length }
  }

  /**
   * 切进一个工作区：有待办就回「要整池」并把待办清掉。簿记在库里，进程内存清空也不影响结论。
   */
  async function enterWorkspace(cwd: string): Promise<any> {
    const snap = await readSnap(cwd)
    if (!snap) return { mode: 'rebuild', reason: 'no-baseline', pending: 0 }
    const loaded = await load(cwd, snap)
    if (!loaded) return { mode: 'rebuild', reason: 'store-unavailable', pending: 0 }
    const st = loaded.state
    if (!st.pending.length) return { mode: 'use-cache', reason: 'no-pending', pending: 0 }
    const n = st.pending.length
    const next: DeltaState = Object.assign({}, st, { pending: [], pendingAt: 0, pendingReason: '' })
    await writeState(cwd, snap, next, { pending: [], pendingAtMs: 0, pendingReason: '', expectedGeneration: st.generation })
    return { mode: 'rebuild', reason: 'pending-todo', pending: n }
  }

  /**
   * 整池结果回来时走这里：先问世代号还算不算数，再落盘。
   * 这就是「迟到的整池结果不许覆盖更新的增量结果」在库这一侧的落点：走走停停的世代号住在库里，
   * 后来的增量把世代推走之后，这份整池会被丢掉，内存与库都不动。
   */
  async function admitSnapshot(cwd: string, snap: any, startedGeneration: unknown): Promise<any> {
    const cur = await readSnap(cwd)
    const loaded = await load(cwd, cur)
    if (!loaded) return { accepted: false, reason: 'store-unavailable', generation: 0 }
    const st = loaded.state
    const g: any = delta.admitResult(st.generation, Number(startedGeneration) || 0)
    if (!g.accept) {
      if (typeof d.noteStale === 'function') d.noteStale()
      if (typeof d.fire === 'function') d.fire('rebuild', g.reason, { watermark: 'held', pending: st.pending.length })
      return { accepted: false, reason: g.reason, generation: st.generation }
    }
    const next: DeltaState = {
      structureVersion: delta.DELTA_STRUCTURE_VERSION,
      watermarkMs: now(), generation: g.generation,
      pending: [], pendingAt: 0, pendingReason: '',
    }
    const written = await writeState(cwd, snap, next, {
      watermarkMs: next.watermarkMs, generation: next.generation,
      pending: [], pendingAtMs: 0, pendingReason: '', expectedGeneration: st.generation,
    })
    if (!written.ok) return { accepted: false, reason: written.reason, generation: st.generation }
    return { accepted: true, reason: g.reason, generation: g.generation }
  }

  /** 这一路现在的状态（排查、门禁与界面读数用）。 */
  async function state(cwd: string): Promise<DeltaState> {
    const snap = await readSnap(cwd)
    const loaded = await load(cwd, snap)
    return loaded ? loaded.state : stateOfSnapshot(snap)
  }

  return {
    load: load,
    baseline: baseline,
    writeState: writeState,
    commitChanges: commitChanges,
    claimState: claimState,
    pendingCount: pendingCount,
    rememberPending: rememberPending,
    enterWorkspace: enterWorkspace,
    admitSnapshot: admitSnapshot,
    state: state,
  }
}
