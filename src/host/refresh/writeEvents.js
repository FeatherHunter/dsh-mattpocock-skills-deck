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
//      **取数之前先过这道门**：不归我们的事件不取数、不记那一路的日志 —— 但处理链那一笔在门前就喂了
//      （#781：链记的是“发生过”，只看会话与工作区根认不认得出来，不看当时有没有人在看；
//      白名单只决定取不取数，不决定记不记）。
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
import { chainRootHash, looksLikeTicketFilePath } from '../../shared/refresh/chain.js'
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
 *   note      —— 可选：把判定过的那一笔喂给会话↔票处理链（生产里是 sessionTickets.js 的 note）。
 *                给了它，界面上「每个会话在处理哪些票」才有东西可读（#723 T19 接的线）。
 *   logCtx / now / hash8 / mergeWindowMs / probeIntervalMs —— 可选，与仓库其它模块同款。
 */
export function createWriteEvents(deps) {
  const opts = deps || {}
  const now = typeof opts.now === 'function' ? opts.now : Date.now
  const logCtx = opts.logCtx || null
  const gate = opts.gate || null
  const doFetch = typeof opts.fetch === 'function' ? opts.fetch : null
  const hash8 = typeof opts.hash8 === 'function' ? opts.hash8 : shortHash
  const isNamingTracked = typeof opts.isNamingTracked === 'function' ? opts.isNamingTracked : null
  const onFirstAssistant = typeof opts.onFirstAssistant === 'function' ? opts.onFirstAssistant : null
  const onFirstUser = typeof opts.onFirstUser === 'function' ? opts.onFirstUser : null
  const limits = {
    mergeWindowMs: num(opts.mergeWindowMs, PATCH_MERGE_WINDOW_MS),
    probeIntervalMs: num(opts.probeIntervalMs, PROBE_INTERVAL_MS),
  }

  const allowedRoots = new Set()   // 我们服务的工作区根散列（白名单，按散列存）
  const sessionRoots = new Map()   // 会话 id → 工作区根散列（**只有归我们的会话**才进这张表）
  // #723（T19）：会话 id → 归一化之后的工作区根原文。上面那张表按短散列存（门与钥匙用），
  // 但处理链要的是它自己那套 16 位指纹（chainRootHash 从**原文**算），所以在门过掉之后
  // 把原文也留一份 —— 只留归我们的会话，一样不落盘、不进日志。
  const sessionRootKeys = new Map()
  const lastFireAt = new Map()     // 工作区根散列 → 上一次事件触发取数的时刻（10 秒合并窗口）
  const firedLogAt = new Map()     // 工作区根散列 → 上一次记日志的时刻（节流，1 秒一条）
  const stats = { seen: 0, fired: 0, coalesced: 0, deferred: 0, sent: 0, noGate: 0, noKeyFn: 0, event: { requests: 0, points: 0 } }
  // 最近一次过闸带的那把工作区钥匙（只在内存里，是个短散列）。门禁与现场排查据它核对
  // 「过闸用的钥匙」与「标活跃用的钥匙」是不是同一把 —— #723（T19）就是在这里栽过一次
  // （同一份逻辑把已经是散列的值又散列了一遍，两把钥匙对不上，于是这条路径恒被推迟）。
  let lastGateKey = ''

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
    sessionRootKeys.set(id, key)   // 归一化后的根原文：处理链按它算自己那套 16 位指纹
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
    for (const [id, v] of Array.from(sessionRoots.entries())) if (v === h) { sessionRoots.delete(id); sessionRootKeys.delete(id) }
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

  /**
   * #783：从工具参数里取出被写的文件路径（只做瞬时匹配，不留存）。
   * 文件写工具的参数形状各异（`file_path` / `path` / `file` 等），按顺序取第一个像路径的字符串；
   * 数组形态（批量改）取第一个元素。读工具看票文件时这里同样能取出路径，来源照样标成票文件，
   * 链那一侧会按「读」不记 —— 这条纪律不松。
   */
  function filePathOf(argsObj) {
    if (!argsObj || typeof argsObj !== 'object') return ''
    const fields = ['file_path', 'filePath', 'path', 'file', 'filename', 'fileName', 'target_file', 'targetFile']
    for (let i = 0; i < fields.length; i++) {
      const v = argsObj[fields[i]]
      if (typeof v === 'string' && v.trim()) return v
      if (Array.isArray(v)) {
        for (let j = 0; j < v.length; j++) {
          const item = v[j]
          if (typeof item === 'string' && item.trim()) return item
          if (item && typeof item === 'object') {
            for (let k = 0; k < fields.length; k++) {
              const iv = item[fields[k]]
              if (typeof iv === 'string' && iv.trim()) return iv
            }
          }
        }
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (let k = 0; k < fields.length; k++) {
          const iv = v[fields[k]]
          if (typeof iv === 'string' && iv.trim()) return iv
        }
      }
    }
    return ''
  }

  /** #783：是不是我们自己的写工具（这类走工具参数那条来源，不走票文件那条）。 */
  function isDeckWriterTool(tool) {
    const t = String(tool || '')
    return t === 'deck_issue_create' || t === 'deck_issue_patch' || t === 'deck_map_plan_create' || t === 'deck_map_link' || t === 'deck_issue_report'
  }

  /** #723：处理链动作词（白名单见 chain.js CHAIN_ACTIONS；认不出回空串，链照实丢掉）。 */
  const ACTION_BY_TOOL = Object.freeze({
    deck_issue_create: 'create', deck_issue_patch: 'edit', deck_map_plan_create: 'create', deck_map_link: 'link', deck_issue_report: 'report',
    create: 'create', edit: 'edit', close: 'close', reopen: 'reopen', comment: 'comment',
    assign: 'assign', label: 'label', unlabel: 'unlabel', link: 'link', unlink: 'unlink', delete: 'delete',
  })
  function actionOf(tool, command) {
    const t = String(tool || '').toLowerCase()
    if (Object.prototype.hasOwnProperty.call(ACTION_BY_TOOL, t)) return ACTION_BY_TOOL[t]
    const hit = /\b(?:gh|glab)\s+\w+\s+([a-z-]+)/i.exec(String(command || ''))
    const verb = hit ? String(hit[1]).toLowerCase().replace(/^--?/, '') : ''
    return Object.prototype.hasOwnProperty.call(ACTION_BY_TOOL, verb) ? ACTION_BY_TOOL[verb] : ''
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
    // 过闸：调用点名字写 `event.write`（事件触发那一档），**并且带上这个工作区的钥匙**（rootHash）。
    //
    // #723（T19）修掉的一处真错：从前这里没带 workspaceKey，闸就落到它的「认不出这个工作区」兜底上
    // （workspaceKey || 'unknown' 那一格），而那一格永远不会被 setWorkspace 标成活跃 —— 后台档的
    // background-inactive 于是**恒**把这里的每一笔判成推迟：接线看起来接上了，实际一次都发不出去。
    // rootHash 就是「归我们的那个工作区根」的钥匙（上面 isOurs 那道门用的也是它）；接线那一侧
    // （wiring.js 的 syncAttention）拿同一把钥匙标活跃，所以这一笔才放行得出来。
    lastGateKey = rootHash
    const out = await gate.send(
      { source: WRITE_EVENT_SOURCE, kind: kind, workspaceKey: rootHash, plan: [{ action: plan.action, ticket: plan.ticket }] },
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
    const argsObj = parsedArgs(rawArgs)
    const verdict = detectWrite({ shape: shape, tool: String(tool || ''), command: commandOf(argsObj), args: argsObj, succeeded: succeeded })
    const plan = actionFor(verdict, limits)
    // #781：先喂处理链，不看白名单。链记的是“发生过”，取数才看“在看谁” ——
    // 从前这一块在门后，没聚焦的工作区那一笔连链都不进，重启后自然找不到。
    // 白名单只决定后面取不取数（isOurs 与 fire 那一路），不决定记不记。
    // note 抛错、认不出根与后端，都不许影响取数那一路。
    if (typeof opts.note === 'function') {
      try {
        const sid = sessionIdOf(session)
        let rootKey = ''
        try {
          if (sessionRootKeys.has(sid)) rootKey = sessionRootKeys.get(sid) || ''
          else {
            const cwd = session && session.header && session.header.cwd
            if (cwd && typeof opts.canonicalKey === 'function') {
              const k = await opts.canonicalKey(cwd)
              if (k) rootKey = String(k)
            }
          }
        } catch (eK) { /* 认不出根就不记这一笔 */ }
        if (sid && rootKey) {
          let backendName = ''
          if (typeof opts.backendOf === 'function') { try { backendName = String(await opts.backendOf(rootKey) || '') } catch (eB) { backendName = '' } }
          const verb = actionOf(tool, commandOf(argsObj))
          // #783：先把这条路喂上 —— 从工具参数里取出被写的文件路径，当路径传给链；
          // 工具是文件写工具（或读工具）且路径像一张票文件时，来源标成票文件那条。
          // 用读工具看同一张票文件时来源照样是票文件，链按「读」不记，这条纪律不松。
          let chainSource = (String(tool || '').toLowerCase().indexOf('deck_') === 0) ? 'tool-args' : 'cli'
          let chainPath = ''
          try {
            const fp = filePathOf(argsObj)
            if (fp && !isDeckWriterTool(tool) && looksLikeTicketFilePath(fp)) {
              chainSource = 'markdown-file'
              chainPath = fp
            } else if (fp && !isDeckWriterTool(tool)) {
              // 路径不像票文件时也把路径传下去：链从同一条路径里取编号与工作单元，
              // 不像就自然落成「说不出是哪一张票」，不记。
              chainPath = fp
            }
          } catch (eP) { /* 取不出路径就按原来的两条来源走 */ }
          await opts.note({
            sessionId: sid, rootHash: chainRootHash(rootKey), backend: backendName,
            tool: String(tool || ''), source: chainSource,
            tier: verdict.tier, reason: verdict.reason, verb: verb, ticketKey: verdict.ticket || '', path: chainPath, args: argsObj,
          })
        }
      } catch (eN) { /* 喂链失败不许影响取数 */ }
    }
    const ours = await isOurs(session)
    if (!ours) return null
    stats.seen += 1
    // #723（T19）修掉的一处真错：这一行原来多套了一层散列（hash8(hash8(root))），而 sessionRoots 里存的
    // **已经是散列**（见 isOurs 里的 sessionRoots.set(id, rootHash)，以及它拿同一个值去 allowedRoots.has）。
    // 于是同一条工作区根有了两把钥匙：「标活跃」那一侧（wiring.js 的 syncAttention → gate.setWorkspace）
    // 用 hash8(root)，「过闸」这一侧（下面 fire 里的 workspaceKey: rootHash）拿到的是 hash8(hash8(root))。
    // 两把钥匙对不上，闸那一格就永远是 active=false，后台档的 background-inactive 把这条路上**每一笔**
    // 都判成推迟 —— 接线看起来接上了，生产里一次都发不出去。现在与 isOurs 用的是同一个值。
    const keyHash = String(sessionRoots.get(sessionIdOf(session)) || '')
    if (plan.action === 'wait-tick') return { tier: verdict.tier, reason: verdict.reason, action: plan.action }
    return await fire(shape, verdict, plan, keyHash)
  }

  /** 运行时事件的第一条订阅：`ctx.on('tools/result', (exec, result) => …)`（原生与 ptc 内层派发都会到）。 */
  function onToolResult(exec, result) {
    const session = (exec && exec.agent && exec.agent.session) || null
    return handle(session, 'tools/result', exec && exec.name, exec && exec.arguments, succeededFromRuntime(result))
  }

  /** 会话事件第二条订阅。第一行先过门：不归我们的会话立刻返回，不留任何痕迹。 */
  async function onSessionEvent(session, event) {
    const ours = await isOurs(session)
    if (!ours) { try { if (String(event && event.type || '') === 'assistant/message' && typeof opts.onFirstAssistant === 'function' && typeof isNamingTracked === 'function' && sessionIdOf(session) && await isNamingTracked(sessionIdOf(session))) opts.onFirstAssistant(sessionIdOf(session)) } catch (eN) {} return null } // #746 摘要窄门：只走首句摘要这一条，取数记账处理链一律不碰，刷新配额原样不动
    const type = event && event.type
    if (String(type || '') === 'user/message') { try { if (onFirstUser) onFirstUser(sessionIdOf(session)) } catch (eU) {} return null }
    // #746：首条助手消息即摘要触发（门后、只传会话号与类型名，事件体不进任何 sink）。
    if (String(type || '') === 'assistant/message') {
      try { if (typeof opts.onFirstAssistant === 'function') opts.onFirstAssistant(sessionIdOf(session)) } catch (e) {}
      return null
    }
    if (SESSION_RESULT_SHAPES.indexOf(String(type || '')) < 0) return null
    const data = (event && event.data) || null
    return await handle(session, String(type), data && data.name, data && data.arguments, succeededFromSession(data))
  }

  /** 真订阅。两条各自的解绑函数一起交回去（宿主收摊时用）。 */
  function attach(ctx) {
    if (!ctx || typeof ctx.on !== 'function') return { detach: function () {} }
    const offSession = ctx.on('session/event', function (session, event) {
      // 门在最前：这一条订阅里**任何**事件都要先过工作区归属，过了门才碰事件字段。
      //   message 那两种形态也走这里过门；它们要触发的「首条用户/助手消息」钩子在 onSessionEvent 里
      //   本来还会再过一次门，所以这里是同一条不变量的前置，不是多一道。
      isOurs(session).then(function (ours) {
        if (!ours) return null
        const t = String((event && event.type) || '')
        if (t === 'user/message' || t === 'assistant/message') { onSessionEvent(session, event).catch(function () {}); return null }
        // 过了门才碰事件内容：只认工具结果那三种形态，其余（含 tool/call 与 *-start）立即返回。
        if (SESSION_RESULT_SHAPES.indexOf(t) < 0) return null
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
    /** 最近一次过闸带的工作区钥匙（短散列）。同一把钥匙也被接线那一侧用来标活跃，两处必须相等。 */
    lastGateKey: function () { return lastGateKey },
    /** 只给门禁看的一份内部表：几个数字而已，没有会话 id、没有路径、没有命令。 */
    debugState: function () { return { allowedRoots: allowedRoots.size, knownSessions: sessionRoots.size, windows: lastFireAt.size } },
  }
}
