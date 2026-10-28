// tests/verify-1220-shown-store.ts —— 门禁：初始化完成后黄条要能自己消失，链重算钩子看的是「当前显示会话」(#1220)。
//
// 用户看到的一幕：在 Markdown 工作区做完初始化，状态栏那条「尚未初始化」的黄条一直不消失，
// 必须手点「重新检查」或让面板重挂载才收得掉。根因是活跃节拍里那句 `attentionStoreOf(null)`：
// 传 null 时旧代码直接回落到 shared，而 shared.cwd 只在冷启动探针里写一次、之后不再改，
// 于是钩子永远看第一个工作区（本仓），当前会话初始化完了它仍按第一个工作区判「初始化还等着」。
//
// 本门禁量三件事（都是跑起来的结果，不读源码里有没有某个字，只有 B0 是接线检查）：
//   A. attentionStoreOf 的兜底顺序：传入状态（有 cwd） → 界面登记的当前显示状态（有 cwd） → shared →
//      第一个有 cwd 的 store；登记与清除按同一引用走（旧挂载卸载不擦新挂载登记的那份）。
//   B. 状态栏挂的登记组件：返回 null、挂载后视野模型取到当前显示会话、卸载后清掉、
//      cwd 到位且工作区确实换了才补一次会话切换上报；StatusBar 的收起态与展开态都挂了它。
//   C. 把真的 attentionStoreOf 接进 startActiveProbeLoop：初始化还没做完时，那一拍的重算落在当前显示的
//      会话上（不是 shared）；反过来，没有登记（状态栏还没挂载）时退回 shared、且不产生重算。
//
// 门禁归属: src/refresh/rooms/client/client-attention-heartbeat.ts
// 门禁归属: src/client/statusbar/shownAttentionMount.ts
// 门禁归属: src/client/statusbar/StatusBar.ts
//
// 跑法（在插件根目录；不需要先构建，本门禁跑的是真源码）：
//   node --import ./scripts/ts-hook.mts tests/verify-1220-shown-store.ts
import { compileFn } from './lib/eval-probe.js'
import { spliceableJs, sourceText } from './lib/source-text.ts'

let total = 0
let failed = false
const check = function (ok: any, msg: string): void {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}
const sleep = function (ms: number): Promise<void> {
  return new Promise(function (resolve) { setTimeout(resolve, ms) })
}

const HEARTBEAT = 'src/refresh/rooms/client/client-attention-heartbeat.js'
const REFRESH_TIMER = 'src/refresh/rooms/client/refresh-timer.js'
const LEAF = 'src/client/statusbar/shownAttentionMount.js'

/** 把一片源码按拼接口径装进给定的一组外部名字里，再拿回它导出的函数（与构建拼进闭包的方式一致）。 */
const loadSpliced = function (relPath: string, exportNames: string[], scope: Record<string, any>): any {
  const paramNames = Object.keys(scope)
  const fn = compileFn(paramNames, spliceableJs(relPath) + '\nreturn { ' + exportNames.join(', ') + ' }')
  return fn.apply(null, paramNames.map(function (k) { return scope[k] }))
}

/** 造一份视野模型环境：shared 与 stores 是两个共享对象，注意所有用到它们的地方都要传同一份引用。 */
const makeAttention = function (): any {
  const shared: any = { cwd: 'D:\\ws1220-shared', sessionId: 'sess-shared', snapshot: null }
  const stores: Record<string, any> = {}
  const scope: Record<string, any> = {
    ATTENTION_EXPIRY_MS: 90000,
    ATTENTION_HEARTBEAT_MS: 20000,
    shared: shared,
    stores: stores,
  }
  const mod = loadSpliced(HEARTBEAT, ['attentionStoreOf', 'noteShownAttentionStore', 'forgetShownAttentionStore'], scope)
  return { shared: shared, stores: stores, mod: mod }
}

// ---------------------------------------------------------------------------------------------
// A. 兜底顺序：传入 → 登记的当前显示 → shared → 第一个带 cwd 的 store
// ---------------------------------------------------------------------------------------------
const partA = function (): void {
  console.log('#1220 A. attentionStoreOf 的兜底顺序与登记/清除语义')
  const env = makeAttention()
  const shown = { cwd: 'D:\\ws1220-current', sessionId: 'sess-current', snapshot: null }
  const passed = { cwd: 'D:\\ws1220-passed', sessionId: 'sess-passed', snapshot: null }

  check(env.mod.attentionStoreOf(null) === env.shared, '没有任何会话被登记时退回 shared（老行为不丢）')
  check(env.mod.attentionStoreOf(passed) === passed, '调用处传入带 cwd 的状态时优先用它（探测与上报有具体状态时照旧）')

  env.mod.noteShownAttentionStore(shown)
  check(env.mod.attentionStoreOf(null) === shown, '登记后 attentionStoreOf(null) 取当前显示的那份会话状态，而不是 shared（黄条收不掉就卡在这一级）')
  check(env.mod.attentionStoreOf(passed) === passed, '传入仍然优先于登记（"有具体状态就用具体的"这条不变）')

  env.mod.noteShownAttentionStore({ sessionId: 'sess-no-cwd' })
  check(env.mod.attentionStoreOf(null) === env.shared, '登记的对象还没有 cwd 时退回 shared（cwd 迟到不把钩子指向空对象）')

  env.mod.noteShownAttentionStore(shown)
  env.mod.forgetShownAttentionStore({ sessionId: 'sess-other' })
  check(env.mod.attentionStoreOf(null) === shown, '清除只认同一个引用：别的引用来清不会擦掉当前登记（新旧挂载交替时不误擦）')
  env.mod.forgetShownAttentionStore(shown)
  check(env.mod.attentionStoreOf(null) === env.shared, '同一引用来清时登记真的被清掉并退回 shared')

  const env2 = makeAttention()
  env2.shared.cwd = ''
  env2.stores.a = { cwd: '', sessionId: 'sess-a' }
  env2.stores.b = { cwd: 'D:\\ws1220-b', sessionId: 'sess-b' }
  check(env2.mod.attentionStoreOf(null) === env2.stores.b, 'shared 与排在前面的 store 都没有 cwd 时，退到第一个带 cwd 的 store')

  const env3 = makeAttention()
  env3.shared.cwd = ''
  const empty = { sessionId: 'sess-empty' }
  check(env3.mod.attentionStoreOf(null) === null, '所有兜底都没有 cwd 时返回 null（调用处能自己判空）')
  check(env3.mod.attentionStoreOf(empty) === empty, '所有兜底都没有 cwd 时返回调用处传进来的那个对象')
}

// ---------------------------------------------------------------------------------------------
// B. 状态栏挂的登记组件：返回 null、挂载登记、卸载按同一引用清除、工作区换了才补一次上报
// ---------------------------------------------------------------------------------------------
/**
 * 给登记的挂载组件临时装上它需要的全局名字（闭包里这些是自由变量）。
 * 返回 restore：调用方结束后必须调一次，把全局名字还原，免得影响同一进程里别的部分。
 */
const withLeafGlobals = function (attn: any, stRef: any, plan: any, reports: any[], effects: any[]): any {
  const g: any = globalThis
  const names = ['React', 'DswsCtx', 'noteShownAttentionStore', 'forgetShownAttentionStore', 'reportWorkspaceAttention', 'attentionRootOf', 'attentionKeyOf', '_attentionPlan']
  const saved: Record<string, any> = {}
  for (let i = 0; i < names.length; i++) saved[names[i]] = g[names[i]]
  g.React = {
    useContext: function () { return { storeSvc: { useStore: function () { return stRef.st } } } },
    useEffect: function (fn: any) { effects.push(fn) },
    createElement: function () { return null },
  }
  g.DswsCtx = {}
  g.noteShownAttentionStore = attn.mod.noteShownAttentionStore
  g.forgetShownAttentionStore = attn.mod.forgetShownAttentionStore
  g.reportWorkspaceAttention = function (st: any, kind: any, syncFirst: any): any { reports.push({ st: st, kind: kind }); return Promise.resolve(null) }
  g.attentionRootOf = function (st: any): any { return String((st && st.cwd) || '') }
  g.attentionKeyOf = function (root: any): any { return String(root || '').toLowerCase() }
  g._attentionPlan = plan
  return function restore(): void {
    for (let i = 0; i < names.length; i++) {
      if (saved[names[i]] === undefined) delete g[names[i]]
      else g[names[i]] = saved[names[i]]
    }
  }
}

const partB = function (): void {
  console.log('#1220 B. 状态栏的登记组件：返回 null、挂载即登记、卸载按同一引用清除')
  const sbSrc = sourceText('src/client/statusbar/StatusBar.ts')
  const mounts = sbSrc.match(/h\(ShownAttentionMount, \{ sid: sid \}\)/g) || []
  check(mounts.length === 2, 'StatusBar 的收起态与展开态各挂一个登记组件（漏一支，那条路上钩子还看 shared。实得 ' + mounts.length + ' 处）')

  const attn = makeAttention()
  const store1 = { cwd: 'D:\\ws1220-current', sessionId: 'sess-current', snapshot: null }
  const stRef: any = { st: store1 }
  const plan: any = { root: 'D:\\ws1220-other', intervalMs: 5000, standing: 'active' }
  const reports: any[] = []
  const effects: any[] = []
  const restore = withLeafGlobals(attn, stRef, plan, reports, effects)
  try {
    const leaf = loadSpliced(LEAF, ['ShownAttentionMount'], {})
    const view = leaf.ShownAttentionMount({ sid: 'sess-current' })
    check(view === null, '挂载组件不画任何东西（返回 null）')
    check(effects.length === 1, '挂载时登记一次（留了 1 个 effect，实得 ' + effects.length + ' 个）')
    const cleanupOld = effects[0]()
    check(attn.mod.attentionStoreOf(null) === store1, '挂载后视野模型取到当前显示的会话状态（不是 shared）')
    check(reports.length === 1 && reports[0].kind === 'session-switch', 'cwd 到位且工作区与宿主探测目标不同时，补一次会话切换上报（实得 ' + JSON.stringify(reports.map(function (r: any) { return r.kind })) + '）')

    cleanupOld()
    check(attn.mod.attentionStoreOf(null) === attn.shared, '卸载（同一引用）后登记被清掉，退回 shared')
    check(reports.length === 1, '卸载本身不产生上报（只清指针）')

    // 新旧挂载交替：新挂载已经登记，旧挂载的清理函数这时才跑（React 的 effect 清理顺序可能晚一拍）。
    const store2 = { cwd: 'D:\\ws1220-current2', sessionId: 'sess-current2', snapshot: null }
    stRef.st = store2
    const view2 = leaf.ShownAttentionMount({ sid: 'sess-current2' })
    const cleanupNew = effects[1]()
    check(view2 === null && attn.mod.attentionStoreOf(null) === store2, '新挂载登记后指针指向新会话（实得 ' + String(attn.mod.attentionStoreOf(null) && attn.mod.attentionStoreOf(null).sessionId) + '）')
    cleanupOld()
    check(attn.mod.attentionStoreOf(null) === store2, '旧挂载的清理不会擦掉新挂载登记的那份（按同一引用清除的意义）')

    // 工作区没换：不重复上报（避免每拍都叫宿主重探）。
    const before = reports.length
    plan.root = 'D:\\ws1220-current2'
    const store3 = { cwd: 'D:\\ws1220-current2', sessionId: 'sess-current3', snapshot: null }
    stRef.st = store3
    leaf.ShownAttentionMount({ sid: 'sess-current3' })
    effects[2]()
    check(reports.length === before, '登记的会话与宿主探测目标同一个工作区时不重复上报（实得新增 ' + (reports.length - before) + ' 次）')

    // 会话状态还没有 cwd：先登记，但视野模型照旧退回 shared，不上报。
    const store4 = { cwd: '', sessionId: 'sess-no-cwd', snapshot: null }
    stRef.st = store4
    leaf.ShownAttentionMount({ sid: 'sess-no-cwd' })
    const beforeNoCwd = reports.length
    effects[3]()
    check(attn.mod.attentionStoreOf(null) === attn.shared, '会话状态还没有 cwd 时退回 shared（不把钩子指向空对象）')
    check(reports.length === beforeNoCwd, '还没有 cwd 时不补会话切换上报')
  } finally {
    restore()
  }
}

// ---------------------------------------------------------------------------------------------
// C. 接进活跃节拍：初始化没做完时重算落在当前显示的会话上；没登记时退回 shared 且不重算
// ---------------------------------------------------------------------------------------------
/** 照 tests/verify-1363-first-run-recovery.ts partC 的夹具搭一份活跃节拍环境，换成真的 attentionStoreOf。 */
const makeLoop = function (attn: any, current: any): any {
  const noop = function (): void {}
  const logs: any[] = []
  const intervals: number[] = []
  const firedSteps: any[] = []
  const triggers: any[] = []
  const timer: any = { timeout: function (fn: any, ms: number): any { return setTimeout(fn, ms) } }
  timer.interval = function (fn: any, ms: number): any { intervals.push(ms); firedSteps.push(fn); return function cancel(): void {} }
  timer.clearTimeout = function (h: any): void { try { if (typeof h === 'function') h() } catch (e) {} }
  const scope: Record<string, any> = {
    SYNC: null,
    SYNC_FALLBACK_PROBE_MS: 60000, SYNC_FOCUS_PROBE_MIN_MS: 60000,
    SYNC_SNAP_FRESH_MS: 60000, PROBE_AUTO_WAIT_MS: 50,
    host: { call: function (): any { return Promise.resolve({ ok: false }) } },
    _attentionPlan: { intervalMs: 5000, standing: 'active' },
    shared: attn.shared,
    stores: attn.stores,
    wsKeyOf: function (x: any): string { return String(x || '') },
    keyOf: function (x: any): string { return String(x || '') },
    log: function (level: any, event: any, fields: any): void { logs.push({ level: level, event: event, fields: fields }) },
    isEnabled: function (): boolean { return false },
    dswsLogHash: function (s: any): string { return 'h' + String(s || '').length },
    dswsLogTrunc: function (s: any): string { return String(s || '').slice(0, 120) },
    touchProbeAt: noop,
    emit: noop,
    diffSnapshots: function (): any { return { added: [], changed: [], removed: [], issueFlash: {} } },
    scheduleFlashClear: noop,
    loadSnapshot: function (): any { return Promise.resolve() },
    hydrateFromCache: function (): boolean { return false },
    snapshotWithoutWorkRoute: function (s: any): any { return s },
    ensureOwnWorkRoute: noop,
    chainEventRefresh: function (st: any, trigger: any): any { triggers.push({ st: st, trigger: trigger }); return Promise.resolve(null) },
    loadChain: function (): any { return Promise.resolve(null) },
    setupPendingOf: function (st: any): boolean { return st === current },
    attentionVisible: function (): boolean { return true },
    attentionStoreOf: attn.mod.attentionStoreOf,
    probeTargetNow: function (): any { return 'D:\\ws1220-current' },
    noteProbeReply: noop,
    namingGuardianEvent: noop,
    applySnapshotSelection: noop,
    flash: noop,
    tr: function (k: any): string { return String(k) },
    timer: timer,
    document: undefined, window: undefined,
  }
  const mod = loadSpliced(REFRESH_TIMER, ['startActiveProbeLoop'], scope)
  return { mod: mod, scope: scope, logs: logs, intervals: intervals, firedSteps: firedSteps, triggers: triggers }
}

const partC = async function (): Promise<void> {
  console.log('#1220 C. 那一拍的重算落在当前显示的会话上；没登记时退回 shared 且不重算')
  const current: any = {
    cwd: 'D:\\ws1220-current', sessionId: 'sess-current', snapshot: null,
    chainSnapshot: { steps: [{ id: 'tracker:initialized', status: 'pending' }] },
  }

  // C1 正面对照：状态栏挂上了（登记了当前显示会话）→ 重算落在它身上。
  const pos = makeAttention()
  pos.stores['sess-current'] = current
  pos.mod.noteShownAttentionStore(current)
  const loopPos = makeLoop(pos, current)
  loopPos.mod.startActiveProbeLoop()
  check(loopPos.intervals.length === 1 && loopPos.intervals[0] === 5000, '活跃节拍照旧按宿主给的 5000ms 排上（实得 ' + JSON.stringify(loopPos.intervals) + '）')
  loopPos.firedSteps[loopPos.firedSteps.length - 1]()
  await sleep(5)
  check(loopPos.triggers.length === 1, '初始化还没做完时那一拍真的叫了一次链重算（实得 ' + loopPos.triggers.length + ' 次）')
  check(loopPos.triggers.length >= 1 && loopPos.triggers[0].st === current, '重算收到的是当前显示的那个会话状态（实得 ' + String(loopPos.triggers[0] && loopPos.triggers[0].st && loopPos.triggers[0].st.sessionId) + '）')
  check(loopPos.triggers.length >= 1 && loopPos.triggers[0].st !== pos.shared, '重算没有落在 shared（以前看错会话就是卡在这里，黄条收不掉）')
  check(loopPos.triggers.length >= 1 && loopPos.triggers[0].trigger === 'setup-pending', '触发名仍是 setup-pending（不退避、不受人手操作影响）')

  // C2 反面对照：状态栏还没挂载（没有登记）→ 退回 shared，且 shared 上判不出「初始化还等着」，不产生重算。
  const neg = makeAttention()
  neg.stores['sess-current'] = current
  check(neg.mod.attentionStoreOf(null) === neg.shared, '没有登记时退回 shared（与改动前一致，不新增分支）')
  const loopNeg = makeLoop(neg, current)
  loopNeg.mod.startActiveProbeLoop()
  loopNeg.firedSteps[loopNeg.firedSteps.length - 1]()
  await sleep(5)
  check(loopNeg.triggers.length === 0, 'shared 上判不出「初始化还等着」时不产生重算（反面对照，实得 ' + loopNeg.triggers.length + ' 次）')
}

const main = async function (): Promise<void> {
  partA()
  partB()
  await partC()
  console.log('全部通过 — ' + total + ' 条断言')
  process.exit(failed ? 1 : 0)
}
main()
