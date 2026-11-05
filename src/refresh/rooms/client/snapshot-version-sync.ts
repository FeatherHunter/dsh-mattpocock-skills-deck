/**
 * src/refresh/rooms/client/snapshot-version-sync.ts —— 客户端按库版本取变化（#1891，规格 #1885 S4）
 *
 * 为什么单列一片：从这一票起，界面判断「手上的数据新不新」只看快照库的版本号，不再看生成时刻、
 * 也不再拿「多少秒以前」当判据（规格 I3）。轮询与将来的平台事件实现同一个「信号源」接口，
 * 同步引擎只认接口 —— 换信号源不必重写这一层（规格 User Story 41）。
 * 「取回来怎么并」在 snapshot-change-merge.ts，这一片只管「什么时候取」。
 *
 * 四条不能改的约定：
 *  1. 同一版本什么都不取：手上那份的库版本与信号里的版本相同，这一拍一条数据都不读。
 *  2. 版本变大才取变化集，并进手上那份时只换变化的那几行（没变的行连对象都不换）。
 *  3. 版本变小（文件被旧拷贝覆盖、库重建）→ 整份重取，并先把本地版本重置成「不知道」；
 *     变化集回「整份」（落后超限）→ 同样整份重取，装上去照常渲染。
 *  4. 时间只出现在「看到这个版本的时刻」这一格，交给宿主做「落后太久就整份」的降级判断；
 *     本文件不按时间决定显不显示、新不新。
 *
 * 反例：不要在这里按 generatedMs 比新旧；不要把同一版本的两拍都发一次变化集；
 * 不要把变化集回包里的整份快照（如果有）直接装上去。
 */
// 跨闭包的值引用按仓里规矩写模块级 declare（实现只在拼好的闭包里有一份，类型检查各看各的）。
declare const host: any;
declare const wsKeyOf: any;
declare const idOf: any;
declare const emit: any;
declare const setCachedSnapshot: any;
declare const snapshotWithoutWorkRoute: any;
declare const loadOwnWorkRoute: any;
declare const _snapInstallBody: any;
declare const applySnapshotChangeSet: any;

/** 一次版本读数：只有版本、工作区键、后端三格（规格 I4「信号不带真相」）。 */
export interface SnapshotVersionReading {
  ok?: boolean
  version?: number
  workspaceKey?: string
  backend?: string
  error?: string
}

/**
 * 版本信号源：轮询与将来的事件实现同一份接口。
 * 订阅方只拿得到「版本变了」这件事；数据一律走变化集那两条读口。
 */
export interface SnapshotVersionSource {
  subscribe(onReading: (reading: SnapshotVersionReading) => void): () => void
}

/** 同步簿记：手上那份快照对应的库版本，以及第一次看见这个版本的本地时刻。 */
export interface SnapshotVersionBook {
  version: number | null
  seenAtMs: number
}

/** 同步引擎要的五条门口。缺哪条都判不出来，所以一律由调用方给全。 */
export interface SnapshotVersionPorts {
  held(): SnapshotVersionBook
  setHeld(next: SnapshotVersionBook): void
  changes(input: { sinceVersion: number, seenAtMs: number }): Promise<any>
  full(input: { reason: string }): Promise<any>
  merge(input: { reply: any }): { version: number } | null
  now(): number
}

export type SnapshotVersionOutcome = 'skipped' | 'merged' | 'full' | 'failed'

/** 只认非负整数版本：0 是合法版本，不能被当成「没有」。 */
function syncVersionNumber(value: any): number | null {
  return (typeof value === 'number' && Number.isInteger(value) && value >= 0) ? value : null
}

/**
 * 按版本推进的同步引擎。四件事：同一版本跳过、版本变大取变化集、版本回退与落后超限整份重取、
 * 连发多笔合并成一次读取（合并窗口是微任务；读取在途时再来的只留最后一笔，读完再补一次）。
 */
export function createSnapshotVersionSync(ports: SnapshotVersionPorts): {
  notify(reading: SnapshotVersionReading): Promise<SnapshotVersionOutcome>
  start(source: SnapshotVersionSource): () => void
  busy(): boolean
} {
  let running = false
  let scheduled = false
  let pending: SnapshotVersionReading | null = null
  let waiters: Array<(outcome: SnapshotVersionOutcome) => void> = []
  const fullOutcome = function (reply: any): SnapshotVersionOutcome {
    if (!reply) return 'failed'
    const version = syncVersionNumber(reply.version)
    if (version === null) return 'failed'
    ports.setHeld({ version: version, seenAtMs: ports.now() })
    return 'full'
  }
  const step = async function (reading: SnapshotVersionReading): Promise<SnapshotVersionOutcome> {
    if (!reading || reading.ok === false) return 'failed'
    const version = syncVersionNumber(reading.version)
    if (version === null) return 'failed'
    const book = ports.held() || { version: null, seenAtMs: 0 }
    const held = syncVersionNumber(book.version)
    if (held !== null && held === version) return 'skipped'
    if (held !== null && version < held) {
      ports.setHeld({ version: null, seenAtMs: 0 })
      return fullOutcome(await ports.full({ reason: 'version-regressed' }))
    }
    if (held === null) {
      return fullOutcome(await ports.full({ reason: 'no-baseline' }))
    }
    const reply = await ports.changes({ sinceVersion: held, seenAtMs: (typeof book.seenAtMs === 'number' && Number.isFinite(book.seenAtMs)) ? book.seenAtMs : 0 })
    if (!reply || reply.ok === false) return 'failed'
    const next = syncVersionNumber(reply.version)
    if (next === null) return 'failed'
    if (reply.full === true) {
      const reason = String(reply.reason || 'behind-limit')
      return fullOutcome(await ports.full({ reason: reason }))
    }
    const merged = ports.merge({ reply: reply })
    if (!merged) return 'failed'
    const mergedVersion = syncVersionNumber(merged.version)
    ports.setHeld({ version: mergedVersion === null ? next : mergedVersion, seenAtMs: ports.now() })
    return 'merged'
  }
  const drain = async function (): Promise<void> {
    running = true
    let last: SnapshotVersionOutcome = 'skipped'
    try {
      while (pending) {
        const reading = pending
        pending = null
        last = await step(reading)
      }
    } catch (e) {
      last = 'failed'
    } finally {
      running = false
      const waiting = waiters
      waiters = []
      waiting.forEach(function (fn: (outcome: SnapshotVersionOutcome) => void): void { try { fn(last) } catch (e) {} })
      if (pending) schedule()
    }
  }
  const schedule = function (): void {
    if (scheduled || running) return
    scheduled = true
    void Promise.resolve().then(function (): Promise<void> { scheduled = false; return drain() })
  }
  const notify = function (reading: SnapshotVersionReading): Promise<SnapshotVersionOutcome> {
    return new Promise(function (resolve: (outcome: SnapshotVersionOutcome) => void): void {
      pending = reading
      waiters.push(resolve)
      schedule()
    })
  }
  return {
    notify: notify,
    start: function (source: SnapshotVersionSource): () => void {
      const off = source.subscribe(function (reading: SnapshotVersionReading): void { void notify(reading) })
      return typeof off === 'function' ? off : function (): void {}
    },
    busy: function (): boolean { return running },
  }
}

/**
 * 轮询实现：每 intervalMs 问一次版本。间隔、调度器、取消都由调用方给 ——
 * 今天宿主没给定时器出口的地方（单测、无计时器环境）就不排节拍，不在这一层写死数字。
 */
export function createPollingVersionSource(options: {
  read(): Promise<SnapshotVersionReading> | SnapshotVersionReading
  intervalMs: number
  schedule?(tick: () => void, intervalMs: number): any
  cancel?(handle: any): void
  visible?(): boolean
}): SnapshotVersionSource & { tick(): void } {
  const listeners: Array<(reading: SnapshotVersionReading) => void> = []
  const schedule = typeof options.schedule === 'function' ? options.schedule : function (tick: () => void, ms: number): any { return setInterval(tick, ms) }
  const cancel = typeof options.cancel === 'function' ? options.cancel : function (handle: any): void { try { clearInterval(handle) } catch (e) {} }
  let handle: any = null
  const deliver = function (reading: SnapshotVersionReading): void {
    listeners.slice().forEach(function (fn: (r: SnapshotVersionReading) => void): void { try { fn(reading) } catch (e) {} })
  }
  const tick = function (): void {
    try { if (typeof options.visible === 'function' && !options.visible()) return } catch (e) { return }
    Promise.resolve().then(function (): any { return options.read() }).then(deliver, function (error: any): void {
      deliver({ ok: false, error: String((error && error.message) || error) })
    })
  }
  return {
    tick: tick,
    subscribe: function (onReading: (reading: SnapshotVersionReading) => void): () => void {
      listeners.push(onReading)
      if (listeners.length === 1 && options.intervalMs > 0) handle = schedule(tick, options.intervalMs)
      return function (): void {
        const at = listeners.indexOf(onReading)
        if (at >= 0) listeners.splice(at, 1)
        if (!listeners.length && handle !== null) { cancel(handle); handle = null }
      }
    },
  }
}

// ── 生产接线：本文件在闭包里的相邻名字一律用 typeof 守卫，门禁可直接传替身 ──────────────────
const syncBookByKey: Map<string, SnapshotVersionBook> = new Map()
const syncByWorkspace: Map<string, any> = new Map()

/** 这套接线用到的闭包邻居；门禁传第三参时整份换掉（信号源与宿主电话都可替换）。 */
function syncAmbientScope(): any {
  return {
    host: (typeof host !== 'undefined' ? host : null),
    wsKeyOf: (typeof wsKeyOf === 'function' ? wsKeyOf : null),
    idOf: (typeof idOf === 'function' ? idOf : null),
    emit: (typeof emit === 'function' ? emit : null),
    setCachedSnapshot: (typeof setCachedSnapshot === 'function' ? setCachedSnapshot : null),
    snapshotWithoutWorkRoute: (typeof snapshotWithoutWorkRoute === 'function' ? snapshotWithoutWorkRoute : null),
    loadOwnWorkRoute: (typeof loadOwnWorkRoute === 'function' ? loadOwnWorkRoute : null),
    installSnapshot: (typeof _snapInstallBody === 'function' ? _snapInstallBody : null),
    applyChanges: (typeof applySnapshotChangeSet === 'function' ? applySnapshotChangeSet : null),
  }
}

function syncKeyOfIn(scope: any, cwd: any): string {
  try { return String((scope && typeof scope.wsKeyOf === 'function' ? scope.wsKeyOf(cwd) : cwd) || '') } catch (e) { return '' }
}

/** 手上那份快照对应的库版本；没有记录时回「不知道」（version 为 null），不是 0。 */
export function snapshotVersionBookOf(cwd: any, scopeOverride?: any): SnapshotVersionBook {
  const hit = syncBookByKey.get(syncKeyOfIn(scopeOverride || syncAmbientScope(), cwd))
  return hit ? { version: hit.version, seenAtMs: hit.seenAtMs } : { version: null, seenAtMs: 0 }
}

/** 记下「手上这份对应第几版」；版本不是非负整数时不许写（不拿 0 冒充足够）。 */
export function rememberSnapshotVersion(cwd: any, version: any, seenAtMs?: any, scopeOverride?: any): void {
  const next = syncVersionNumber(version)
  const key = syncKeyOfIn(scopeOverride || syncAmbientScope(), cwd)
  if (!key || next === null) return
  syncBookByKey.set(key, { version: next, seenAtMs: typeof seenAtMs === 'number' ? seenAtMs : Date.now() })
}

/** 忘掉这个工作区的版本（版本回退与整份重取失败时用：下一次从「没有基线」重来）。 */
export function forgetSnapshotVersion(cwd: any, scopeOverride?: any): void {
  const key = syncKeyOfIn(scopeOverride || syncAmbientScope(), cwd)
  if (key) syncBookByKey.delete(key)
}

function syncReadVersionOf(ctx: any): Promise<SnapshotVersionReading> {
  const cwd = (ctx.st && ctx.st.cwd) || ''
  return Promise.resolve(ctx.scope.host.call('wf.snapshotVersion', { cwd: cwd })).then(function (reply: any): SnapshotVersionReading {
    if (!reply || reply.ok === false) return { ok: false, error: String((reply && reply.error) || 'snapshot-version-failed') }
    return { ok: true, version: reply.version, workspaceKey: reply.workspaceKey, backend: reply.backend }
  }, function (error: any): SnapshotVersionReading {
    return { ok: false, error: String((error && error.message) || error) }
  })
}

/**
 * 只问一次版本、不推进任何簿记：整份取数用它记下「发请求之前」那一版作为起点。
 * 起点宁可旧一点（这期间的变化下一拍重放一次），也不可比数据新（那样会漏掉变化）。
 */
export function captureSnapshotVersion(st: any, scopeOverride?: any): Promise<number | null> {
  const scope = scopeOverride || syncAmbientScope()
  if (!st || !st.cwd || !scope || !scope.host || typeof scope.host.call !== 'function') return Promise.resolve(null)
  return syncReadVersionOf({ st: st, scope: scope }).then(function (reading: SnapshotVersionReading): number | null {
    return syncVersionNumber(reading && reading.ok !== false ? reading.version : null)
  })
}

/** 只给变化的那几行打标记：其余行一个对象都没换，界面据此只重画那几行。 */
function syncInstallMerged(ctx: any, merged: any): void {
  const st = ctx.st
  st.snapshot = merged.snapshot
  st.snapMode = 'real'
  st.snapError = null
  try {
    st.rowFlash = {}
    st.issueFlash = {}
    merged.redrawn.forEach(function (id: string): void {
      st.rowFlash[id] = 'changed'
      const numeric = Number(String(id).split('\u0000').pop())
      if (Number.isInteger(numeric) && numeric > 0) st.issueFlash[numeric] = 'changed'
    })
  } catch (e) {}
  try { if (typeof ctx.scope.setCachedSnapshot === 'function') ctx.scope.setCachedSnapshot(st.cwd, merged.snapshot) } catch (e) {}
  try { if (typeof ctx.scope.loadOwnWorkRoute === 'function') ctx.scope.loadOwnWorkRoute(st) } catch (e) {}
  try { if (typeof ctx.scope.emit === 'function') ctx.scope.emit(st) } catch (e) {}
}

function syncPortsOf(ctx: any): SnapshotVersionPorts {
  const keyNow = function (): string { return syncKeyOfIn(ctx.scope, (ctx.st && ctx.st.cwd) || '') }
  const nowFn = function (): number { return Date.now() }
  return {
    held: function (): SnapshotVersionBook {
      const hit = syncBookByKey.get(keyNow())
      return hit ? { version: hit.version, seenAtMs: hit.seenAtMs } : { version: null, seenAtMs: 0 }
    },
    setHeld: function (next: SnapshotVersionBook): void {
      const key = keyNow()
      if (key) syncBookByKey.set(key, { version: next.version, seenAtMs: next.seenAtMs })
    },
    changes: function (input: any): Promise<any> {
      const args: any = { cwd: (ctx.st && ctx.st.cwd) || '', sinceVersion: input.sinceVersion, sinceMs: input.seenAtMs }
      return Promise.resolve(ctx.scope.host.call('wf.snapshotChanges', args))
    },
    full: async function (input: any): Promise<any> {
      // 先问版本、再取整份：起点宁可比数据旧，不可比数据新 —— 否则这期间的变化会被当成「已经取过」。
      const version = await syncReadVersionOf(ctx)
      const seen = syncVersionNumber(version && version.version)
      if (seen === null) return null
      const snap = await Promise.resolve(ctx.scope.host.call('wf.snapshot', { cwd: (ctx.st && ctx.st.cwd) || '' }))
      if (!snap || snap.ok !== true || !Array.isArray(snap.maps)) return null
      const st = ctx.st
      try {
        if (typeof ctx.scope.installSnapshot === 'function') ctx.scope.installSnapshot(st, snap)
        else { st.snapshot = snap; st.snapMode = 'real'; st.snapError = null; if (typeof ctx.scope.emit === 'function') ctx.scope.emit(st) }
      } catch (e) {}
      return { version: seen }
    },
    merge: function (input: any): any {
      const applyChanges = ctx.scope.applyChanges
      if (typeof applyChanges !== 'function') return null
      const merged = applyChanges(ctx.st && ctx.st.snapshot, input.reply.changed, input.reply.missing, { idOf: ctx.scope.idOf })
      if (!merged) return null
      syncInstallMerged(ctx, merged)
      return { version: syncVersionNumber(input.reply.version) }
    },
    now: nowFn,
  }
}

/**
 * 一拍：问一次版本，把读数交给这个工作区自己的同步引擎（合并状态跨拍保留，才谈得上「同一版本不取」）。
 *
 * 已经有一份整份取数在飞时不重复取（等它落地，下一次拍自然接上）；没有 cwd 或宿主电话不可用时
 * 什么都不做，绝不拿「没有结论」去推进版本簿记。
 */
export function runSnapshotVersionTick(st: any, reason?: string, scopeOverride?: any): Promise<SnapshotVersionOutcome> {
  const scope = scopeOverride || syncAmbientScope()
  if (!st || !st.cwd) return Promise.resolve('skipped')
  if (!scope || !scope.host || typeof scope.host.call !== 'function') return Promise.resolve('failed')
  if (st.snapLoading === true) return Promise.resolve('skipped')
  const key = syncKeyOfIn(scope, st.cwd)
  let run = syncByWorkspace.get(key)
  if (!run) {
    const ctx: any = { st: st, scope: scope }
    run = { ctx: ctx, engine: createSnapshotVersionSync(syncPortsOf(ctx)), reason: '' }
    syncByWorkspace.set(key, run)
  }
  run.ctx.st = st
  run.ctx.scope = scope
  run.reason = String(reason || '')
  return syncReadVersionOf(run.ctx).then(function (reading: SnapshotVersionReading): Promise<SnapshotVersionOutcome> {
    return run.engine.notify(reading)
  })
}

/** 同一工作区的一串会话：主会话取回的合并结果扇出给其余会话（各自剥掉别人的工作路线读数）。 */
export function runSnapshotVersionTickGroup(group: any[], reason?: string, scopeOverride?: any): Promise<SnapshotVersionOutcome> {
  const list = (Array.isArray(group) ? group : []).filter(Boolean)
  if (!list.length) return Promise.resolve('skipped')
  const primary = list[0]
  return runSnapshotVersionTick(primary, reason, scopeOverride).then(function (outcome: SnapshotVersionOutcome): SnapshotVersionOutcome {
    if (outcome !== 'merged' && outcome !== 'full') return outcome
    const scope = scopeOverride || syncAmbientScope()
    list.slice(1).forEach(function (st2: any): void {
      try {
        if (!st2 || st2 === primary) return
        st2.snapshot = (typeof scope.snapshotWithoutWorkRoute === 'function') ? scope.snapshotWithoutWorkRoute(primary.snapshot) : primary.snapshot
        st2.snapMode = 'real'
        st2.snapError = null
        if (typeof scope.loadOwnWorkRoute === 'function') scope.loadOwnWorkRoute(st2)
        if (typeof scope.emit === 'function') scope.emit(st2)
      } catch (e) {}
    })
    return outcome
  })
}