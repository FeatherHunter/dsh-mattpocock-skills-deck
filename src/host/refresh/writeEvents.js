// src/host/refresh/writeEvents.js —— 写事件订阅（#710 T6 · 第二批）
//
// 这个文件干一件事：把「会话里有人写东西」变成「面板立刻知道」。它自己一行判定规则都没有——
// 判定全在 refresh-core/src/write-detect.ts 那份纯函数里（产物 src/shared/refresh/write-detect.js），
// 这里只做四件外面才做得了的事：订事件、过工作区那道门、按 10 秒合并窗口收口、把取数交给闸。
//
// 依据（票面 #710 与 docs/architecture/refresh-budget-architecture.html 第十一章、第十二章、第十五章）：
//   1. **两道订阅**。首选运行时事件 `ctx.on('tools/result', …)`：一次给全工具名、已解析的参数、是否出错与
//      结构化结果，而且原生调用与 ptc 内层派发走同一条收尾路径（本插件自己新建的会话强制 ptc，用户自己开的
//      会话可能是 standard，两种形态会同台出现）。会话事件 `session/event` 作「可回看」的补充，只订工具相关的
//      结果形态。`tool/call` 与 `*-start` 是调用刚开始，没有成功与否的信息，一律不做任何事。
//   2. **订阅面是整个 DSH，平台不提供任何隔离**（真机实测：跨会话、跨工作区、跨子代理都会到我们手上，
//      作用域标也不过滤）。所以门是自己砌的：维护一份「会话 id → 工作区根散列」白名单，根由会话的
//      `header.cwd` 经宿主既有出口算（生产里传进来的是 src/host/index.js 的 canonicalKey，它内部走
//      src/host/workspaceKey.js 的 canonicalWorkspaceKey，上溯到工作区根那一步也在那里；本文件绝不另写
//      一套归一化，也不 import 同层的文件——同层互引门禁要求依赖一律由接线处显式传入）。
//      **决定为这条事件做任何事之前先过这道门**：不归我们的事件一到就返回，
//      不记日志、不写内存表、不进处理链、不落盘——连「来过一条」这个事实都不记。
//   3. **参数只做瞬时匹配**：命令原文进不了日志、落不了盘、回不了界面。返回值与日志字段里只有档位、原因代号、
//      工作区短散列与「认没认出票号」这个布尔。
//   4. **写事件触发的取数一律过闸**，并受同一工作区 10 秒合并窗口约束（合并窗口的值来自 budget.js）；
//      闸那一侧按调用点 `event.write` 记账，事件触发那一档的条数与点数在本文件里单列（stats().event）。
//
// 接线（宿主侧一处，本票没做）：`createWriteEvents({ gate, fetch, canonicalKey, logCtx })` 拿到实例之后 ——
//   `w.attach(ctx)` 订两条事件；`w.allowRoot(<当前在看的工作区根>)` 把要服务的工作区加进白名单
//   （活跃集合变化时调，来源是视野模型 src/host/refresh/attention.js）；`w.forgetRoot(<切走的工作区根>)` 收摊。
//   本票没有动 src/host/index.js（全库共用的大文件，别的票同时在改），这一处接线请统筹者统一做。
import { detectWrite, actionFor } from '../../shared/refresh/write-detect.js'
import { PATCH_MERGE_WINDOW_MS, PROBE_INTERVAL_MS } from '../../shared/refresh/budget.js'

/** 闸的调用点名字（事件触发那一档）。闸按它分类记账；本文件不改闸与账本一个字。 */
export const WRITE_EVENT_SOURCE = 'event.write'

/** 会话事件里我们真看的形态（结果形态；`tool/call` 与 `*-start` 不进这张表）。 */
export const SESSION_RESULT_SHAPES = ['tool/result', 'tool/ptc-dispatch', 'tool/code-dispatch']

function num(v, dflt) { return (typeof v === 'number' && isFinite(v)) ? v : dflt }

/** 短散列：与仓库其它地方同款（只用来在日志与内存表里指代一个工作区，不落路径原文）。 */
function shortHash(s) {
  try {
    const t = String(s || '')
    let h = 5381
    for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
    return ('0000000' + h.toString(16)).slice(-8)
  } catch (e) { return '00000000' }
}

/**
 * 建一份写事件订阅。deps：
 *   gate      —— 闸（要 send）。没给就只判定、不取数（诚实降级，绝不绕过闸自己发请求）。
 *   canonicalKey —— **必给**：宿主那支把会话目录洗成工作区键的既有出口，生产里传
 *                   `src/host/index.js` 的 canonicalKey（它内部走 src/host/workspaceKey.js 的
 *                   canonicalWorkspaceKey，归一化与「上溯到工作区根」都在那里，本文件不另写一套）。
 *                   这里不直接 import 那个文件：同层互引门禁（tests/verify-no-same-layer-import.js）
 *                   要求宿主层的文件之间不互相引用，依赖一律由接线处显式传入（本目录既有做法）。
 *   fetch     —— 真去取数的函数（由宿主接线传进来，T3/T4 那一层）。签名 fetch(step, meta)。
 *   logCtx / now / hash8 / mergeWindowMs / probeIntervalMs —— 可选，与仓库其它模块同款。
 */
export function createWriteEvents(deps) {
  const opts = deps || {}
  const now = typeof opts.now === 'function' ? opts.now : Date.now
  const logCtx = opts.logCtx || null
  const gate = opts.gate || null
  const doFetch = typeof opts.fetch === 'function' ? opts.fetch : null
  const hash8 = typeof opts.hash8 === 'function' ? opts.hash8 : shortHash
  const limits = {
    mergeWindowMs: num(opts.mergeWindowMs, PATCH_MERGE_WINDOW_MS),
    probeIntervalMs: num(opts.probeIntervalMs, PROBE_INTERVAL_MS),
  }

  const allowedRoots = new Set()   // 我们服务的工作区根散列（白名单，按散列存）
  const sessionRoots = new Map()   // 会话 id → 工作区根散列（**只有归我们的会话**才进这张表）
  const lastFireAt = new Map()     // 工作区根散列 → 上一次事件触发取数的时刻（10 秒合并窗口）
  const firedLogAt = new Map()     // 工作区根散列 → 上一次记日志的时刻（节流，1 秒一条）
  const stats = { seen: 0, fired: 0, coalesced: 0, deferred: 0, sent: 0, noGate: 0, noKeyFn: 0, event: { requests: 0, points: 0 } }

  /** 会话的工作区钥匙：交给接线处传进来的宿主既有出口算（本文件不另写一套归一化）。 */
  async function keyOf(cwd) {
    if (typeof opts.canonicalKey !== 'function') {
      stats.noKeyFn += 1
      return ''
    }
    return await opts.canonicalKey(cwd)
  }

  function sessionIdOf(session) {
    try { return String((session && session.id) || '') } catch (e) { return '' }
  }

  /**
   * 这道门。返回 true 表示这个会话归我们，可以做后面的事。
   * 不归我们的会话**什么表都不进、什么计数都不加**——白名单是「按 id 放行」，不是「按 id 记黑名单」。
   */
  async function isOurs(session) {
    const id = sessionIdOf(session)
    if (!id) return false
    const cached = sessionRoots.get(id)
    if (cached !== undefined) return allowedRoots.has(cached)
    const cwd = session && session.header && session.header.cwd
    if (!cwd) return false
    let key = ''
    try { key = String(await keyOf(cwd) || '') } catch (e) { return false }
    if (!key) return false
    const rootHash = hash8(key)
    if (!allowedRoots.has(rootHash)) return false   // 别的会话、别的工作区：到此为止，不留任何痕迹
    sessionRoots.set(id, rootHash)
    return true
  }

  /** 把一个工作区根加进白名单（宿主接线按「现在服务哪些工作区」调它；参数可以是根，也可以是会话选的目录）。 */
  async function allowRoot(rootOrCwd) {
    const raw = String(rootOrCwd || '')
    if (!raw) return ''
    let key = raw
    try { const canon = String(await keyOf(raw) || ''); if (canon) key = canon } catch (e) {}
    allowedRoots.add(hash8(key))
    return hash8(key)
  }

  /** 把一个工作区根移出白名单（切走之后不再服务它）。同一根下已记住的会话一并忘掉。 */
  function forgetRoot(rootOrCwd) {
    const h = hash8(String(rootOrCwd || ''))
    allowedRoots.delete(h)
    for (const [id, v] of Array.from(sessionRoots.entries())) if (v === h) sessionRoots.delete(id)
    lastFireAt.delete(h)
    firedLogAt.delete(h)
  }

  // ---- 参数与结果的瞬时读取（读完就丢，一个字符都不留） ----
  function parsedArgs(raw) {
    if (!raw) return null
    if (typeof raw === 'object') return raw
    if (typeof raw !== 'string') return null
    try { const o = JSON.parse(raw); return (o && typeof o === 'object') ? o : null } catch (e) { return null }
  }

  /** 命令行：Windows 上命令工具是 pwsh，命令行在 `JSON.parse(arguments).command`。原样喂给纯函数，随即丢弃。 */
  function commandOf(argsObj) {
    try { return (argsObj && typeof argsObj.command === 'string') ? argsObj.command : '' } catch (e) { return '' }
  }

  /** 会话事件里的正文（`tool/result` 的 message.content、ptc 派发的 content 两处形状都认）。 */
  function textOf(data) {
    try {
      const msg = data && data.message
      const c = (msg && msg.content !== undefined) ? msg.content : (data && data.content)
      if (typeof c === 'string') return c
      if (Array.isArray(c)) return c.map((p) => (p && typeof p.text === 'string') ? p.text : '').join('\n')
      return ''
    } catch (e) { return '' }
  }

  /**
   * 这次调用成功了没有（**只认成功**）。运行时事件给结构化退出码，最硬；
   * 会话事件只有文本，只能认 `[exit code: N]` 与 isError / error 两个布尔，认不出就是「没成功」
   * （不当成功的代价只是等一次兜底节拍，当成功的代价是白花一次取数，所以往保守一侧倒）。
   */
  function succeededFromRuntime(result) {
    if (!result || result.isError === true) return false
    const value = result.value
    if (value && typeof value.exitCode === 'number') return value.exitCode === 0
    return result.isError === false
  }

  function succeededFromSession(data) {
    if (!data || data.isError === true || data.error) return false
    const m = /\[exit code:\s*(-?\d+)\]/.exec(textOf(data))
    if (m) return Number(m[1]) === 0
    return data.isError === false
  }

  /** 真的去做那一次取数（过了合并窗口才走到这里）。 */
  async function fire(shape, verdict, plan, rootHash) {
    stats.fired += 1
    logFired(shape, rootHash, verdict, plan)
    const last = lastFireAt.get(rootHash)
    if (last !== undefined && (now() - last) < limits.mergeWindowMs) {
      stats.coalesced += 1
      return { tier: verdict.tier, reason: verdict.reason, action: plan.action, ticket: plan.ticket, coalesced: true }
    }
    lastFireAt.set(rootHash, now())
    if (!gate || typeof gate.send !== 'function') {
      stats.noGate += 1
      return { tier: verdict.tier, reason: verdict.reason, action: plan.action, ticket: plan.ticket, gated: false }
    }
    const kind = (plan.action === 'patch-now') ? 'patch' : 'probe'
    // 过闸：调用点名字写 `event.write`（事件触发那一档）。闸的调用点表里暂时没有这个名字，于是它按
    // 「认不出 → 后台档」处理并把这一笔记进 stats().unclassified —— 这是闸设计好的兜底（先按后台算、
    // 同时让人看得见「这个调用点还没登记」）。要让账本真单列出第四档，得动账本与闸那三个文件
    //（ledger.js 的档位表、gate.js 的调用点表、policy.ts 的类别联合），不属本票，已写进施工报告。
    const out = await gate.send(
      { source: WRITE_EVENT_SOURCE, kind: kind, plan: [{ action: plan.action, ticket: plan.ticket }] },
      async function (step, meta) { return doFetch ? await doFetch(step, meta) : { requests: 0, points: 0 } }
    )
    if (out && out.sent) { stats.sent += 1; stats.event.requests += num(out.requests, 0); stats.event.points += num(out.points, 0) }
    else if (out) stats.deferred += 1
    return { tier: verdict.tier, reason: verdict.reason, action: plan.action, ticket: plan.ticket, verdictOfGate: (out && out.verdict) || '' }
  }

  // 按需级 P1：外层先判调试开关，关着连字段对象都不组装（每一次成功的工具调用都会过这里，属高频路径）。
  // 节流两条：同一工作区一秒只记第一条；兜底那一档（什么都没触发）根本不记 —— 记了只是噪声。
  // 最后一行把「判开关」与「发射」写在同一行，是仓库日志守卫门禁认的形状（与 gate.js 的 fireDecide 同款）。
  function logFired(shape, rootHash, verdict, plan) {
    try {
      if (!logCtx || !logCtx.isEnabled('debug')) return
      const t = now()
      const prev = firedLogAt.get(rootHash)
      if (prev !== undefined && (t - prev) < 1000) return
      firedLogAt.set(rootHash, t)
      if (logCtx.isEnabled('debug')) logCtx.fire('debug', 'write.event', { keyHash: rootHash, shape: shape, tier: verdict.tier, reason: verdict.reason, action: plan.action, hasTicket: !!plan.ticket })
    } catch (eL) {}
  }

  /** 一条工具结果（运行时事件 `tools/result` 与它的会话事件版本共用这一条路）。 */
  async function handle(session, shape, tool, rawArgs, succeeded) {
    const ours = await isOurs(session)
    if (!ours) return null
    stats.seen += 1
    const keyHash = hash8(String(sessionRoots.get(sessionIdOf(session)) || ''))
    const argsObj = parsedArgs(rawArgs)
    const verdict = detectWrite({ shape: shape, tool: String(tool || ''), command: commandOf(argsObj), args: argsObj, succeeded: succeeded })
    const plan = actionFor(verdict, limits)
    if (plan.action === 'wait-tick') return { tier: verdict.tier, reason: verdict.reason, action: plan.action }
    return await fire(shape, verdict, plan, keyHash)
  }

  /** 运行时事件的第一条订阅：`ctx.on('tools/result', (exec, result) => …)`（原生与 ptc 内层派发都会到）。 */
  function onToolResult(exec, result) {
    const session = (exec && exec.agent && exec.agent.session) || null
    return handle(session, 'tools/result', exec && exec.name, exec && exec.arguments, succeededFromRuntime(result))
  }

  /**
   * 会话事件的第二条订阅（「可回看」的补充）。第一行就过门——不归我们的会话立刻返回，
   * 后面一件事都不做：不看事件名、不解析参数、不记日志、不进内存表。
   */
  async function onSessionEvent(session, event) {
    // 门：这个会话归不归我们（白名单里没有它，这里就结束）。
    const ours = await isOurs(session)
    if (!ours) return null
    const type = event && event.type
    if (SESSION_RESULT_SHAPES.indexOf(String(type || '')) < 0) return null
    const data = (event && event.data) || null
    return await handle(session, String(type), data && data.name, data && data.arguments, succeededFromSession(data))
  }

  /** 真订阅。两条各自的解绑函数一起交回去（宿主收摊时用）。 */
  function attach(ctx) {
    if (!ctx || typeof ctx.on !== 'function') return { detach: function () {} }
    const offSession = ctx.on('session/event', function (session, event) {
      // 第一行就过门：这个会话归不归我们（白名单里没有它，连事件名都不看，后面一件事都不做）。
      isOurs(session).then(function (ours) {
        if (!ours) return null
        // 过了门才碰事件内容：只认工具结果那三种形态，其余（含 tool/call 与 *-start）立即返回。
        if (SESSION_RESULT_SHAPES.indexOf(String((event && event.type) || '')) < 0) return null
        return onSessionEvent(session, event)
      }).catch(function () {})
    }, { global: true })
    const offResult = ctx.on('tools/result', function (exec, result) {
      onToolResult(exec, result).catch(function () {})
    })
    return {
      detach: function () {
        try { if (typeof offSession === 'function') offSession() } catch (e) {}
        try { if (typeof offResult === 'function') offResult() } catch (e) {}
      },
    }
  }

  return {
    attach: attach,
    allowRoot: allowRoot,
    forgetRoot: forgetRoot,
    handle: handle,
    onToolResult: onToolResult,
    onSessionEvent: onSessionEvent,
    stats: function () { return { seen: stats.seen, fired: stats.fired, coalesced: stats.coalesced, deferred: stats.deferred, sent: stats.sent, noGate: stats.noGate, noKeyFn: stats.noKeyFn, event: { requests: stats.event.requests, points: stats.event.points } } },
    /** 只给门禁看的一份内部表：几个数字而已，没有会话 id、没有路径、没有命令。 */
    debugState: function () { return { allowedRoots: allowedRoots.size, knownSessions: sessionRoots.size, windows: lastFireAt.size } },
  }
}
