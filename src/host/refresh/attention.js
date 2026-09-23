// src/host/refresh/attention.js —— 视野模型的宿主薄壳（#707 T3 第二批）
//
// 这个文件只干三件事，判定一行都没有：
//   ① 收下界面报上来的「我在看谁」（宿主电话 wf.focus），把工作区根按宿主既有出口
//      canonicalKey 归一化（src/host/workspaceKey.js，经 repoKeys.js:149 与 index.js:97 对外），再交给纯函数；
//   ② 把纯函数算出来的结论翻译成「哪个工作区根该有定时器、间隔多少、哪些要停掉」——
//      至于定时器本身由谁拿着、怎么起停，不是这个文件的事（起 gh 与落盘留 JS、纯逻辑进 TS）；
//   ③ 台账：谁在活跃、谁刚离开、整桌收摊没有，给闸与界面问一句。
//
// 纯逻辑全部住在 refresh-core/src/attention.ts（产物 src/shared/refresh/attention.js）：活跃集合的
// 名额分配与淘汰、「同一工作区根只占一个名额」的判定、90 秒无信号的收摊判定，都由它算。数字一个
// 都不在这里：全部从 budget.js 取好注入（见 attentionLimits）。这就是「薄壳」两个字的含义 ——
// 本文件里没有一条 if 在决定谁该被淘汰。
//
// 为什么工作区根必须走 canonicalKey：同一个仓库在会话里可能写成 D:\Repo、d:\repo\、D:/Repo/，
// 界面上报的又是「这个会话选的那条目录」。不归一化就会同一个仓库占两个名额、花两份探测额度，
// 而这条归一化的规则（含向上锚到工作区根）全仓只有一份，写在 src/host/workspaceKey.js。
//
// 日志（按需级 P1，先判调试开关再组装字段，字段只记散列与枚举，绝不记路径原文）：
//   attention.report 每一次上报落一行（心跳每 20 秒一次，按十取一采样）
//   attention.sweep  每一次收摊结论落一行。两条登记在 research/489-appendix.md 第 1.5 节。
import * as budget from '../../shared/refresh/budget.js'
import { createAttentionState, report, collect, heartbeatIntervalMs } from '../../shared/refresh/attention.js'

/** 视野模型对外的那条宿主电话名（tests/verify-log-coverage.js 的电话名名单按它核对）。 */
export const ATTENTION_PHONE_NAMES = ['wf.focus']

/** 从 budget.js 取一套视野模型要用的数字（形状与纯函数那侧的 AttentionLimits 一致）。 */
export function attentionLimits(src) {
  const b = src || budget
  return {
    maxActive: b.MAX_ACTIVE_WORKSPACES,
    lingerMs: b.ACTIVE_LINGER_MS,
    expiryMs: b.ATTENTION_EXPIRY_MS,
    probeIntervalMs: b.PROBE_INTERVAL_MS,
    probeIntervalLingerMs: b.PROBE_INTERVAL_LINGER_MS,
    heartbeatMs: b.ATTENTION_HEARTBEAT_MS,
  }
}

/** 上报的六种信号（与纯函数那侧的取值表同一串；不认识的取值按 focus 算）。 */
export const ATTENTION_SIGNAL_KINDS = ['focus', 'panel-open', 'session-switch', 'heartbeat', 'window-blur', 'panel-hidden']

function num(v) {
  return (typeof v === 'number' && isFinite(v)) ? v : 0
}

function shortHash(s) {
  try {
    const t = String(s || '')
    let h = 5381
    for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
    return ('0000000' + h.toString(16)).slice(-8)
  } catch (e) { return '00000000' }
}

/**
 * 建一个视野模型。deps: { canonicalKey?, now?, logCtx?, hash8?, budget? }。
 *
 * canonicalKey 是宿主那条既有出口（src/host/index.js:97 对外，源码在 workspaceKey.js）。没给就
 * 直接用原样字符串当键 —— 那种情况下调用方自己承担「同一条目录两种写法算两个工作区」的后果
 * （门禁与单测里就是这么用的，生产接线一定会给）。
 */
export function createAttention(deps) {
  const opts = deps || {}
  const now = typeof opts.now === 'function' ? opts.now : Date.now
  const logCtx = opts.logCtx || null
  const hash8 = typeof opts.hash8 === 'function' ? opts.hash8 : shortHash
  const canonicalKey = typeof opts.canonicalKey === 'function' ? opts.canonicalKey : null
  const limits = attentionLimits(opts.budget)

  let state = createAttentionState()
  const canonByRoot = new Map()   // 上报原文 → 归一化后的键（同一条目录只洗一次）
  let reportN = 0

  // 每一次上报落一行（按需级 P1）。心跳每 20 秒一次，所以按十取一采样。
  //   判断与落行必须同一行（tests/verify-log-guards.js 的口径：关着开关时连字段对象都不组装）。
  function fireReport(kind, windowId, root, visible, accepted, heartbeat) {
    reportN += 1
    const sampled = heartbeat && (reportN % 10) !== 0
    try { if (logCtx && logCtx.isEnabled('debug') && !sampled) logCtx.fire('debug', 'attention.report', { kind: kind, windowHash: hash8(windowId), rootHash: hash8(root), visible: !!visible, accepted: !!accepted }) } catch (eL) {}
  }

  // 每一次收摊结论落一行（按需级 P1）。收摊是节拍级的动作，低频，不采样。
  function fireSweep(script, plan) {
    try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'attention.sweep', { active: plan.active.length, keep: script.entries.length, cancel: script.cancel.length, linger: !!script.linger, collaped: !!script.collaped, keepers: plan.keepers }) } catch (eL) {}
  }

  /** 把上报原文洗成工作区根。洗不出来时用原文（宁可多花一份，也不要把两个根混成一个）。 */
  async function rootOf(raw) {
    const text = String(raw || '').trim()
    if (!text) return ''
    if (canonByRoot.has(text)) return canonByRoot.get(text)
    let key = text
    if (canonicalKey) {
      try { const k = await canonicalKey(text); if (typeof k === 'string' && k) key = k } catch (e) {}
    }
    canonByRoot.set(text, key)
    return key
  }

  /** 某个根最近一次上报是什么时候（0 = 没有任何窗口盯着它）。state 由调用方传进来，不读外层那份。 */
  function lastSeenOf(target, root) {
    let newest = 0
    for (const id of Object.keys(target.windows)) {
      const w = target.windows[id]
      if (!w || w.root !== root) continue
      if ((w.lastSeenMs || 0) > newest) newest = w.lastSeenMs
    }
    return newest
  }

  /** 这个根现在按什么间隔探测（没在活跃集合里返回 null）。 */
  function intervalFor(plan, root) {
    for (const a of plan.active) if (a.root === root) return { intervalMs: a.intervalMs }
    return null
  }

  /** 把纯函数的结论翻成定时器去向表。判定全在纯函数那边，这里只翻译。 */
  function scriptOf(plan) {
    const entries = []
    for (const a of plan.active) entries.push({ root: a.root, intervalMs: a.intervalMs > 0 ? a.intervalMs : null, audience: a.audience })
    // 收尾节拍的等待时间封顶在收尾窗口（30 秒）之内：调用方拿到的这个数字就是它要等的时间，
    // 而纯函数给的是「还剩多少」—— 如果这一跳比窗口本身还晚（这一段时间里没人来收过摊），
    // 「还剩多少」会算成负数之外的怪值。封顶之后，任何调用方排出来的收尾定时器都不会超过 30 秒，
    // 这正是不变量 I2 允许的那个例外（verify-attention-model 抓到过 31 秒这个数）。
    const lingerDelay = plan.lingerDelayMs > 0 ? Math.min(plan.lingerDelayMs, limits.lingerMs) : 0
    return {
      entries: entries,
      linger: (plan.lingerRoot && lingerDelay > 0) ? { root: plan.lingerRoot, delayMs: lingerDelay } : null,
      cancel: plan.cancel.slice(),
      collaped: plan.collaped,
      keepers: plan.keepers,
    }
  }

  /** 一次收摊：算出每个根上定时器的去向、要不要收尾、要不要整桌收掉。 */
  function sweep() {
    const plan = collect(state, now(), limits)
    const script = scriptOf(plan)
    fireSweep(script, plan)
    return script
  }

  /**
   * 收一笔上报。args: { windowId, workspaceRoot, kind, visible, lastHumanInputMs?, atMs? }。
   * 回包给界面自己判处境用（「未在刷新（同时活跃上限 2）」那句话的读取点）：
   *   { ok, root, standing, active, keepers, limit, lastReportAgeMs, heartbeatMs }
   * standing 三种取值：'active' 我在活跃集合里；'evicted' 我没在活跃集合里（名额被最近上报过的
   * 那两个占了）；'collapsed' 整桌收摊了（90 秒内没有任何上报）。
   */
  async function handleFocus(args) {
    const a = args || {}
    const windowId = String(a.windowId || '')
    if (!windowId) return { ok: false, error: '没有窗口标识', text: '这一笔上报没有带窗口标识，视同没有发生：插件认不出是哪个窗口在看，不敢据此调整刷新。' }
    const kind = ATTENTION_SIGNAL_KINDS.indexOf(String(a.kind || '')) >= 0 ? String(a.kind) : 'focus'
    const visible = !!a.visible
    const root = await rootOf(a.workspaceRoot)
    const at = num(a.atMs) || now()
    const humanMs = num(a.lastHumanInputMs) || 0
    const out = report(state, { windowId: windowId, workspaceRoot: root, kind: kind, visible: visible, lastHumanInputMs: humanMs, atMs: at }, at)
    state = out.state
    fireReport(kind, windowId, root, visible, out.accepted, kind === 'heartbeat')
    // 处境这一步必须读改名之后的那份状态：改名之前的那份还是上一笔的历史，第一版就是在这里
    // 读旧的，于是「第三个窗口的处境」总是慢一拍（verify-attention-model 抓到的）。
    const fresh = state
    const plan = collect(fresh, now(), limits)
    const mine = intervalFor(plan, root)
    const standing = plan.collaped ? 'collapsed' : (mine ? 'active' : 'evicted')
    const seen = lastSeenOf(fresh, root)
    return {
      ok: true, root: root, standing: standing, active: plan.active.length, keepers: plan.keepers,
      limit: limits.maxActive, heartbeatMs: heartbeatIntervalMs(limits),
      probeIntervalMs: limits.probeIntervalMs, probeIntervalLingerMs: limits.probeIntervalLingerMs,
      lastReportAgeMs: seen ? Math.max(0, now() - seen) : -1,
    }
  }

  /** 台账：给闸（哪些工作区算活跃）与界面（谁没在刷新）问一句。 */
  function stateOf() {
    const plan = collect(state, now(), limits)
    const script = scriptOf(plan)
    const windows = []
    for (const id of Object.keys(state.windows)) {
      const w = state.windows[id]
      if (!w) continue
      windows.push({ windowHash: hash8(id), rootHash: hash8(w.root), visible: !!w.visible, lastSeenMs: w.lastSeenMs || 0 })
    }
    return {
      active: plan.active.map(function (x) { return { root: x.root, audience: x.audience, intervalMs: x.intervalMs } }),
      keep: script.entries.map(function (e) { return e.root }),
      cancel: script.cancel, linger: script.linger, collaped: script.collaped,
      keepers: plan.keepers, limit: limits.maxActive, windows: windows,
      heartbeatMs: heartbeatIntervalMs(limits), expiryMs: limits.expiryMs, lingerMs: limits.lingerMs,
      limits: limits,
    }
  }

  /** 这个工作区根现在按什么间隔探测（没在活跃集合里返回 null）。闸与界面都问这一条。 */
  function planFor(root) {
    const plan = collect(state, now(), limits)
    return intervalFor(plan, String(root || ''))
  }

  /** 「我现在是不是在活跃集合里」——界面据它显示「未在刷新（同时活跃上限 2）」。 */
  function isActive(root) {
    return !!planFor(root)
  }

  /** 忘掉一个窗口（窗口关了、页面销毁时最后报一次）。 */
  async function forget(args) {
    const windowId = String((args && args.windowId) || '')
    if (!windowId) return { ok: false, error: '没有窗口标识' }
    const next = createAttentionState()
    for (const id of Object.keys(state.windows)) {
      if (id === windowId) continue
      next.windows[id] = state.windows[id]
    }
    state = next
    const plan = collect(state, now(), limits)
    return { ok: true, active: plan.active.length, keepers: plan.keepers }
  }

  return {
    handleFocus: handleFocus,
    forget: forget,
    sweep: sweep,
    stateOf: stateOf,
    planFor: planFor,
    isActive: isActive,
    limits: limits,
  }
}

/**
 * 造一条可以直接交给 harness.handle 的 wf.focus 处理器。
 *
 * 为什么要有这一层：`src/host/index.js` 贴着一行都不能超的 350 行上限（tests/verify-file-granularity.js
 * 的零增长基线），所以那条接线上只留一行注册，把「懒加载 + 幂等建实例 + 把依赖接过去」整段收在这里。
 * 这是本仓库既有的做法（每个宿主模块都导出一个 create* 工厂，入口那侧只负责传依赖）。
 * 用具名导出而不是默认导出：产物转译脚本（refresh-core/build.mjs）只认具名导出。
 */
export function createFocusHandler(deps) {
  const box = { inst: null }
  const inst = function () {
    if (!box.inst) box.inst = createAttention(deps || {})
    return box.inst
  }
  return function (args) {
    return Promise.resolve(inst()).then(function (h) { return h.handleFocus(args) })
  }
}
