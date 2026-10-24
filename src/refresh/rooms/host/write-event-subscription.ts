// src/refresh/rooms/host/write-event-subscription.ts —— 写事件订阅（#710 T6 · 第二批；#1445 起不再经闸）
//
// 这个文件干一件事：把「会话里有人写东西」变成「面板立刻知道」。它自己一行判定规则都没有——
// 判定全在 src/refresh/kernel/write-event-detection.ts 那份纯函数里（产物 .build/refresh/kernel/write-event-detection.js），
// 这里只做四件外面才做得了的事：订事件、过工作区那道门、按取数类型收口（扫描类 10 秒合并、
// 点名补行直接发）、把那一趟取数交给管线。
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
//      **取数之前先过这道门**：不归我们的事件不取数、不记那一路的日志。工作路线不在门前喂了：
//      #1262 起改由工具壳在写工具成功收口处统一记（见 src/deck/shell/work-path-record.ts），
//      本文件只决定取不取数，不再经手任何记录。
//   3. **参数只做瞬时匹配**：命令原文进不了日志、落不了盘、回不了界面。返回值与日志字段里只有档位、原因代号、
//      工作区短散列与「认没认出票号」这个布尔。
//   4. **写事件触发的取数直接交给管线，不再过闸**（#1445）。为什么不经过闸：闸管的是「这一次出站该不该放行、
//      要花掉多少额度」，而写事件触发的这一趟取数只是一趟读——开会话、进管线、由房间自己去读（#1444 的裁决：
//      读路径在管线里放行，不经闸裁决、也不在闸上记账）。写事件这一档与读路径是同一口径，再留一道闸就等于
//      同一个问题问两遍；更糟的是问出来的「推迟」在别处没有第二次机会，只会平白压住一次本该发生的取数。
//      代价说清楚：这一档从此不产生闸的裁决，stats().event 的条数与点数恒记 0（读路径不记账，#1444 裁决）；
//      真实用量的统计归 #1446，不在本文件另记一本小账（两本账对不上比没有账更难查）。
//      合并窗口按取数类型分开用：扫描类（probe-now，票号未知，要问一次仓库最近变了什么）
//      同一工作区 10 秒内只发一次；点名补行（patch-now，票号已知，只取那一行）每次写都发。
//      窗口的值来自 budget.js。
//
// 接线（宿主侧一处）：`createWriteEvents({ fetch, canonicalKey, logCtx })` 拿到实例之后 ——
//   `w.attach(ctx)` 订两条事件；`w.allowRoot(<当前在看的工作区根>)` 把要服务的工作区加进白名单
//   （活跃集合变化时调，来源是视野模型 src/refresh/rooms/host/host-attention.js）；`w.forgetRoot(<切走的工作区根>)` 收摊。
//   接线点是 src/refresh/rooms/host/refresh-runtime.ts 的 createRefreshWiring（#1445：旧闸那一格已从接线里删掉；
//   取数那一格接的是管线里的那一趟读，由接线处负责，不在本文件里现造）。
//
// （2026-10-18 #1247 从 writeEvents.js 转成 .ts：只加类型标注与注释，逻辑一行未动。
// 相对引用保持 .js 后缀，由 scripts/ts-hook.mts 改指同名 .ts；判定全在纯函数那一侧，
// 本文件只做订阅、过门、合并窗口与把取数交给管线，白名单的钥匙与交给管线的钥匙用同一把短散列，绝不另写归一。
// 2026-10-24 #1445：去掉过闸那一层，写事件触发的那一趟取数改成直接 await 接线处给的取数函数；
// 同时删掉 lastGateKey 这个只为闸存在的读数口，stats 里的 noGate 改名 noFetch）。
import { detectWrite, actionFor } from '../../kernel/write-event-detection.js'
import { PATCH_MERGE_WINDOW_MS, PROBE_INTERVAL_MS } from '../../../shared/time-config/src/values.js'

// ---------------------------------------------------------------------------
// 类型（#1247 转写：只写类型不写实现）。
//
// 为什么这样标：订阅面上来的是整个 DSH 的事件（跨会话、跨工作区、跨子代理都会到），
// 形状不可信，所以会话与事件都按 any 收，收窄发生在 isOurs 那道门与各形状判断里，
// 类型不替代那道门。白名单只存散列（会话 id → 根散列），路径与命令原文只做瞬时匹配，
// 绝不进表、不进日志、不落盘 —— 这条纪律由字段形状守，
// 类型把表记成 string 到 string，不给原文留位置。
// ---------------------------------------------------------------------------

/** 建订阅的依赖：取数函数与归一出口由接线处显式传入，本文件不 import 同层文件。 */
interface WriteEventsDeps {
  canonicalKey?: (cwd: string) => string | Promise<string>
  fetch?: (step: any, meta: any) => any
  logCtx?: any
  now?: () => number
  hash8?: (s: string) => string
  mergeWindowMs?: number
  probeIntervalMs?: number
  isNamingTracked?: (sid: string) => boolean | Promise<boolean>
  onFirstAssistant?: (sid: string) => void
  onFirstUser?: (sid: string) => void
}

/** 这一趟取数的来源标记（「事件触发」那一档），放在 meta.source 里交给管线。
 *  取值保持 'event.write' 不动：#1445 只是不再拿它去问闸，日志与下游按这个值认来源的口径没变
 *  ——改值会让新旧日志对不上，而它对读者表达的意思（一次写事件拉起的取数）仍然准确。 */
export const WRITE_EVENT_SOURCE = 'event.write'

/** 会话事件里我们真看的形态（结果形态；`tool/call` 与 `*-start` 不进这张表）。 */
export const SESSION_RESULT_SHAPES = ['tool/result', 'tool/ptc-dispatch', 'tool/code-dispatch']

function num(v: unknown, dflt: number): number { return (typeof v === 'number' && isFinite(v)) ? v : dflt }

/** 短散列：与仓库其它地方同款（只用来在日志与内存表里指代一个工作区，不落路径原文）。 */
function shortHash(s: unknown): string {
  try {
    const t = String(s || '')
    let h = 5381
    for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
    return ('0000000' + h.toString(16)).slice(-8)
  } catch (e: any) { return '00000000' }
}

/**
 * 建一份写事件订阅。deps：
 *   canonicalKey —— **必给**：宿主那支把会话目录洗成工作区键的既有出口，生产里传
 *                   `src/host/index.js` 的 canonicalKey（它内部走 src/host/workspaceKey.js 的
 *                   canonicalWorkspaceKey，归一化与「上溯到工作区根」都在那里，本文件不另写一套）。
 *                   这里不直接 import 那个文件：同层互引门禁（tests/verify-dependency-rules.ts）
 *                   要求宿主层的文件之间不互相引用，依赖一律由接线处显式传入（本目录既有做法）。
 *   fetch     —— 真去取数的函数（由宿主接线传进来，跟管线里读路径同一趟读）。签名 fetch(step, meta)：
 *                step 是这一趟要做什么（{ action, ticket }），meta 是这一趟从哪来、算哪个工作区
 *                （{ source, kind, workspaceKey, cycle }）。没给就只判定、不取数（诚实降级：
 *                判定与合并窗口照跑，回包里明说这一趟没取数）。
 *   logCtx / now / hash8 / mergeWindowMs / probeIntervalMs —— 可选，与仓库其它模块同款。
 */
export function createWriteEvents(deps?: WriteEventsDeps | null): any {
  const opts: any = deps || {}
  const now: () => number = typeof opts.now === 'function' ? opts.now : Date.now
  const logCtx: any = opts.logCtx || null
  // 取数交给接线处给的函数（#1445 起不再过闸，见文件头第 4 条）；没给就只判定、不取数。
  const doFetch: ((step: any, meta: any) => any) | null = typeof opts.fetch === 'function' ? opts.fetch : null
  const hash8: (s: string) => string = typeof opts.hash8 === 'function' ? opts.hash8 : shortHash
  const isNamingTracked: ((sid: string) => any) | null = typeof opts.isNamingTracked === 'function' ? opts.isNamingTracked : null
  const onFirstAssistant: ((sid: string) => void) | null = typeof opts.onFirstAssistant === 'function' ? opts.onFirstAssistant : null
  const onFirstUser: ((sid: string) => void) | null = typeof opts.onFirstUser === 'function' ? opts.onFirstUser : null
  const limits = {
    mergeWindowMs: num(opts.mergeWindowMs, PATCH_MERGE_WINDOW_MS),
    probeIntervalMs: num(opts.probeIntervalMs, PROBE_INTERVAL_MS),
  }

  const allowedRoots = new Set<string>()   // 我们服务的工作区根散列（白名单，按散列存）
  const sessionRoots = new Map<string, string>()   // 会话 id → 工作区根散列（**只有归我们的会话**才进这张表）
  const lastProbeAt = new Map<string, number>()    // 工作区根散列 → 上一次扫描类取数（probe-now）的时刻；10 秒窗口只拦它
  const firedLogAt = new Map<string, number>()     // 工作区根散列 → 上一次记日志的时刻（节流，1 秒一条）
  // 计数：seen 过了门的事件条数、fired 走到取数判定那一趟的条数、coalesced 被 10 秒窗口并掉的趟数、
  // sent 真交给了管线的趟数、noFetch 接线没给取数函数的趟数、noKeyFn 没给归一出口的条数。
  // event.requests 与 event.points 两格留着但**恒记 0**：读路径不记账（#1444 裁决），真实用量归 #1446。
  // 从前这两格是照闸的回包累加的，现在没有闸，也就没有第二个数字可以抄 —— 与其编一个，不如如实记 0。
  const stats = { seen: 0, fired: 0, coalesced: 0, sent: 0, noFetch: 0, noKeyFn: 0, event: { requests: 0, points: 0 } }

  // 每一趟「判定 → 合并/发出 → 交给管线」的号码：只在本进程内递增，日志里靠它把同一趟的几行串起来
  // （write.event 的那行给出 tier/reason/action/result，write.sent 那行给出这一趟交出去了没有、在路上多久）。
  let cycleSeq = 0
  function nextCycle(): string { cycleSeq = (cycleSeq + 1) % 100000000; return 'c' + ('0000000' + cycleSeq).slice(-7) }

  /** 会话的工作区钥匙：交给接线处传进来的宿主既有出口算（本文件不另写一套归一化）。 */
  async function keyOf(cwd: any): Promise<any> {
    if (typeof opts.canonicalKey !== 'function') {
      stats.noKeyFn += 1
      return ''
    }
    return await opts.canonicalKey(cwd)
  }

  function sessionIdOf(session: any): string {
    try { return String((session && session.id) || '') } catch (e: any) { return '' }
  }

  /**
   * 这道门。返回 true 表示这个会话归我们，可以做后面的事。
   * 不归我们的会话**什么表都不进、什么计数都不加**——白名单是「按 id 放行」，不是「按 id 记黑名单」。
   */
  async function isOurs(session: any): Promise<boolean> {
    const id = sessionIdOf(session)
    if (!id) return false
    const cached: string | undefined = sessionRoots.get(id)
    if (cached !== undefined) return allowedRoots.has(cached)
    const cwd: any = session && session.header && session.header.cwd
    if (!cwd) return false
    let key = ''
    try { key = String(await keyOf(cwd) || '') } catch (e: any) { return false }
    if (!key) return false
    const rootHash = hash8(key)
    if (!allowedRoots.has(rootHash)) return false   // 别的会话、别的工作区：到此为止，不留任何痕迹
    sessionRoots.set(id, rootHash)
    return true
  }

  /** 把一个工作区根加进白名单（宿主接线按「现在服务哪些工作区」调它；参数可以是根，也可以是会话选的目录）。 */
  async function allowRoot(rootOrCwd: any): Promise<string> {
    const raw = String(rootOrCwd || '')
    if (!raw) return ''
    let key = raw
    try { const canon = String(await keyOf(raw) || ''); if (canon) key = canon } catch (e: any) {}
    allowedRoots.add(hash8(key))
    return hash8(key)
  }

  /** 把一个工作区根移出白名单（切走之后不再服务它）。同一根下已记住的会话一并忘掉。 */
  function forgetRoot(rootOrCwd: any): void {
    const h = hash8(String(rootOrCwd || ''))
    allowedRoots.delete(h)
    lastProbeAt.delete(h)
    firedLogAt.delete(h)
    // 白名单里已经没有这根了，缓存里的「会话 → 根」也要一并清掉：不清的话 debugState().knownSessions
    // 只增不减，同一会话以后换了工作区还会命中旧缓存、永远不算归我们。
    for (const [id, root] of Array.from(sessionRoots.entries())) {
      if (root === h) sessionRoots.delete(id)
    }
  }

  // ---- 参数与结果的瞬时读取（读完就丢，一个字符都不留） ----
  function parsedArgs(raw: any): any {
    if (!raw) return null
    if (typeof raw === 'object') return raw
    if (typeof raw !== 'string') return null
    try { const o: any = JSON.parse(raw); return (o && typeof o === 'object') ? o : null } catch (e: any) { return null }
  }

  /** 命令行：Windows 上命令工具是 pwsh，命令行在 `JSON.parse(arguments).command`。原样喂给纯函数，随即丢弃。 */
  function commandOf(argsObj: any): string {
    try { return (argsObj && typeof argsObj.command === 'string') ? argsObj.command : '' } catch (e: any) { return '' }
  }

  /** 会话事件里的正文（`tool/result` 的 message.content、ptc 派发的 content 两处形状都认）。 */
  function textOf(data: any): string {
    try {
      const msg: any = data && data.message
      const c: any = (msg && msg.content !== undefined) ? msg.content : (data && data.content)
      if (typeof c === 'string') return c
      if (Array.isArray(c)) return c.map((p: any) => (p && typeof p.text === 'string') ? p.text : '').join('\n')
      return ''
    } catch (e: any) { return '' }
  }

  /**
   * 这次调用成功了没有（**只认成功**）。运行时事件给结构化退出码，最硬；
   * 会话事件只有文本，只能认 `[exit code: N]` 与 isError / error 两个布尔，认不出就是「没成功」
   * （不当成功的代价只是等一次兜底节拍，当成功的代价是白花一次取数，所以往保守一侧倒）。
   */
  function succeededFromRuntime(result: any): boolean {
    if (!result || result.isError === true) return false
    const value: any = result.value
    if (value && typeof value.exitCode === 'number') return value.exitCode === 0
    return result.isError === false
  }

  function succeededFromSession(data: any): boolean {
    if (!data || data.isError === true || data.error) return false
    const m: RegExpExecArray | null = /\[exit code:\s*(-?\d+)\]/.exec(textOf(data))
    if (m) return Number(m[1]) === 0
    return data.isError === false
  }

  /** 真的去做那一次取数（判定完、该发的才会走到这里）。
   *
   * #1445 起这一趟不再过闸：写事件触发的取数只是一趟读，按 #1444 的裁决由管线直接放行
   * （开会话、进管线、房间自己去读）。这里只决定「什么时候取」以及把这一步交给接线处给的取数函数，
   * 不再替管线做任何放行判定，也不再借闸的回包记账。
   *
   * 「什么时候取」按取数成本分两类（#1472）：
   *   点名补行（patch-now）：票号已知，一次只取那一行薄数据 —— 每次写都取，不看窗口。
   *   扫描类（probe-now）：票号未知，要问一次仓库最近变了什么 —— 同一工作区 10 秒内只发一次。
   * 一刀切的代价：10 秒窗口把第二笔以后的写直接丢掉、不排队也不补发，连做十次写只有第一笔
   * 真的会刷新，后面的只能干等兜底探针 —— 这正是 #1472 要修的症状。
   */
  async function fire(shape: any, verdict: any, plan: any, rootHash: string, cycle: string, tool: string): Promise<any> {
    stats.fired += 1
    // 只有扫描类取数看窗口：点名补行自带票号，只取那一行，没有合并的必要（见函数头）。
    const isScan: boolean = plan.action !== 'patch-now'
    const last: number | undefined = isScan ? lastProbeAt.get(rootHash) : undefined
    // -1 读作「这一档没有窗口」：点名补行恒为 -1，扫描类第一次取数也是 -1。
    const waitedMs: number = (last === undefined) ? -1 : Math.max(0, now() - last)
    // 合并窗口吃掉的那一档也要留一行：它回答「这次写为什么没有马上取数」。
    if (last !== undefined && waitedMs < limits.mergeWindowMs) {
      stats.coalesced += 1
      logEvent(shape, rootHash, verdict, plan, cycle, tool, waitedMs, 'coalesced')
      return { tier: verdict.tier, reason: verdict.reason, action: plan.action, ticket: plan.ticket, coalesced: true }
    }
    if (isScan) lastProbeAt.set(rootHash, now())
    logEvent(shape, rootHash, verdict, plan, cycle, tool, waitedMs, 'fired')
    // 守卫照旧是「这一趟有没有真取数的办法」：从前看闸在不在，现在看取数函数在不在。
    // 没给就只判定、不取数 —— 诚实降级，绝不在本文件里另找一条路把请求发出去。
    if (!doFetch) {
      stats.noFetch += 1
      return { tier: verdict.tier, reason: verdict.reason, action: plan.action, ticket: plan.ticket, fetched: false }
    }
    const kind = (plan.action === 'patch-now') ? 'patch' : 'probe'
    const startedAt: number = now()
    // 交给管线的那一步：step 说「做什么」，meta 说「这一趟从哪来、算哪个工作区」。
    // step 的形状与从前过闸时闸递进来的那一步一致（action 加 ticket），管线换成真取数时不用分岔。
    //
    // meta.workspaceKey 必须是 rootHash —— 就是 isOurs 那道门与白名单用的同一把短散列。
    // #723（T19）在这里栽过一次的教训换个位置照样成立：同一份逻辑把已经是散列的值又散列了一遍，
    // 于是同一个工作区有了两把钥匙，合并窗口按钥匙分开计数、管线也认不出这是哪个工作区。
    // 现在这一个是 sessionRoots 里存的原值，不做第二次散列。
    const step = { action: plan.action, ticket: plan.ticket }
    const meta = { source: WRITE_EVENT_SOURCE, kind: kind, workspaceKey: rootHash, plan: [{ action: plan.action, ticket: plan.ticket }], cycle: cycle }
    await doFetch(step, meta)
    // 走到这里就说明这一趟真交给管线了（不是被合并掉、也不是没有取数函数）。
    // stats.sent 从此数的是「真交给管线几趟」，不再是「闸放行了几趟」。
    stats.sent += 1
    // 这一趟的终点：交出去了、在路上多久 —— 与上面那行 write.event 用 cycle 对上。
    fireSent(rootHash, cycle, kind, Math.max(0, now() - startedAt))
    // verdictOfGate 这个名字是历史名（从前装闸的结论）；现在闸不参与，值恒为 in-pipeline，
    // 意思是「已交给管线，不再有闸裁决」。调用方只该拿它判断「这一趟是不是真交出去了」。
    return { tier: verdict.tier, reason: verdict.reason, action: plan.action, ticket: plan.ticket, verdictOfGate: 'in-pipeline' }
  }

  // 按需级 P1：外层先判调试开关，关着连字段对象都不组装（每一次成功的工具调用都会过这里，属高频路径）。
  // 节流两条：同一工作区一秒只记第一条；兜底那一档（什么都没触发）根本不记 —— 记了只是噪声。
  // 最后一行把「判开关」与「发射」写在同一行，是仓库日志守卫门禁认的形状（与 refresh-gate.js 的 fireDecide 同款）。
  function logEvent(shape: any, rootHash: string, verdict: any, plan: any, cycle: string, tool: string, waitedMs: number, result: string): void {
    try {
      if (!logCtx || !logCtx.isEnabled('debug')) return
      const t: any = now()
      const prev: number | undefined = firedLogAt.get(rootHash)
      if (prev !== undefined && (t - prev) < 1000) return
      firedLogAt.set(rootHash, t)
      if (logCtx.isEnabled('debug')) logCtx.fire('debug', 'write.event', { keyHash: rootHash, shape: shape, tool: tool, tier: verdict.tier, reason: verdict.reason, action: plan.action, hasTicket: !!plan.ticket, cycle: cycle, result: result, waitedMs: waitedMs })
    } catch (eL: any) {}
  }

  // 一趟取数的终点（按需级 P1）：这一趟交出去了没有、在路上多久。与 write.event 用 cycle 对上。
  // 为什么不并进 write.event：那一行在取数之前就写了（要说明判定与是否被合并），这一行要等取数回来才知道结果。
  // 字段照旧九个（附录 #118 登记的就是这几个键），只是含义换成「交给管线那一趟」：sent 恒 true（走到这里就是
  // 真交出去了）、verdict 恒 'in-pipeline'（不再有闸裁决）、reason 恒空串、requests 与 points 恒 0（读路径不记账，
  // #1444 裁决；真实用量归 #1446）。三个恒定格子留着不删，是为了读旧日志的人不必去猜键换没换过意思。
  function fireSent(rootHash: string, cycle: string, kind: string, latencyMs: number): void {
    try {
      if (!logCtx || !logCtx.isEnabled('debug')) return
      if (logCtx.isEnabled('debug')) logCtx.fire('debug', 'write.sent', { keyHash: rootHash, cycle: cycle, kind: kind, sent: true, verdict: 'in-pipeline', reason: '', requests: 0, points: 0, latencyMs: latencyMs })
    } catch (eL: any) {}
  }

  /** 一条工具结果（运行时事件 `tools/result` 与它的会话事件版本共用这一条路）。 */
  async function handle(session: any, shape: any, tool: any, rawArgs: any, succeeded: any): Promise<any> {
    const argsObj: any = parsedArgs(rawArgs)
    const verdict: any = detectWrite({ shape: shape, tool: String(tool || ''), command: commandOf(argsObj), args: argsObj, succeeded: succeeded })
    const plan: any = actionFor(verdict, limits)
    const ours = await isOurs(session)
    if (!ours) return null
    stats.seen += 1
    // #723（T19）修掉的一处真错：这一行原来多套了一层散列（hash8(hash8(root))），而 sessionRoots 里存的
    // **已经是散列**（见 isOurs 里的 sessionRoots.set(id, rootHash)，以及它拿同一个值去 allowedRoots.has）。
    // 于是同一条工作区根有了两把钥匙：白名单那一侧用 hash8(root)，这里拿到的是 hash8(hash8(root)) ——
    // 合并窗口按工作区分开计数，同一个工作区被当成两个，10 秒窗口就永远不生效。
    // 现在与 isOurs 用的是同一个值；#1445 起这个值还作为 meta.workspaceKey 交给管线，两处必须是同一把。
    const keyHash = String(sessionRoots.get(sessionIdOf(session)) || '')
    if (plan.action === 'wait-tick') return { tier: verdict.tier, reason: verdict.reason, action: plan.action }
    // 只有真的要取数的那两档才开一趟 cycle；工具名只留前 40 个字符（它不是凭证，但也没有无限长的道理）。
    const cycle = nextCycle()
    return await fire(shape, verdict, plan, keyHash, cycle, String(tool || '').slice(0, 40))
  }

  /** 运行时事件的第一条订阅：`ctx.on('tools/result', (exec, result) => …)`（原生与 ptc 内层派发都会到）。 */
  function onToolResult(exec: any, result: any): Promise<any> {
    const session: any = (exec && exec.agent && exec.agent.session) || null
    return handle(session, 'tools/result', exec && exec.name, exec && exec.arguments, succeededFromRuntime(result))
  }

  /** 会话事件第二条订阅。第一行先过门：不归我们的会话立刻返回，不留任何痕迹。 */
  async function onSessionEvent(session: any, event: any): Promise<any> {
    const ours = await isOurs(session)
    if (!ours) { try { if (String(event && event.type || '' || '') === 'assistant/message' && typeof opts.onFirstAssistant === 'function' && typeof isNamingTracked === 'function' && sessionIdOf(session) && await isNamingTracked(sessionIdOf(session))) opts.onFirstAssistant(sessionIdOf(session)) } catch (eN: any) {} return null } // #746 摘要窄门：只走首句摘要这一条，取数记账工作路线一律不碰，刷新配额原样不动
    const type: any = event && event.type
    if (String(type || '') === 'user/message') { try { if (onFirstUser) onFirstUser(sessionIdOf(session)) } catch (eU: any) {} return null }
    // #746：首条助手消息即摘要触发（门后、只传会话号与类型名，事件体不进任何 sink）。
    if (String(type || '') === 'assistant/message') {
      try { if (typeof opts.onFirstAssistant === 'function') opts.onFirstAssistant(sessionIdOf(session)) } catch (e: any) {}
      return null
    }
    if (SESSION_RESULT_SHAPES.indexOf(String(type || '')) < 0) return null
    const data: any = (event && event.data) || null
    return await handle(session, String(type), data && data.name, data && data.arguments, succeededFromSession(data))
  }

  /** 真订阅。两条各自的解绑函数一起交回去（宿主收摊时用）。 */
  function attach(ctx: any): any {
    if (!ctx || typeof ctx.on !== 'function') return { detach: function (): void {} }
    const offSession: any = ctx.on('session/event', function (session: any, event: any): void {
      // 门在最前：这一条订阅里**任何**事件都要先过工作区归属，过了门才碰事件字段（message 那两种形态也走这里过门；它们要触发的「首条用户/助手消息」钩子在 onSessionEvent 里本来还会再过一次门，所以这里是同一条不变量的前置，不是多一道）。
      isOurs(session).then(function (ours: any): any {
        if (!ours) return null
        const t = String((event && event.type) || '')
        if (t === 'user/message' || t === 'assistant/message') { onSessionEvent(session, event).catch(function (): void {}) ; return null }
        if (SESSION_RESULT_SHAPES.indexOf(t) < 0) return null // 过了门才碰事件内容：只认工具结果那三种形态，其余（含 tool/call 与 *-start）立即返回。
        return onSessionEvent(session, event)
      }).catch(function (): void {})
    }, { global: true })
    const offResult: any = ctx.on('tools/result', function (exec: any, result: any): void {
      onToolResult(exec, result).catch(function (): void {})
    })
    return {
      detach: function (): void {
        try { if (typeof offSession === 'function') offSession() } catch (e: any) {}
        try { if (typeof offResult === 'function') offResult() } catch (e: any) {}
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
    stats: function (): any { return { seen: stats.seen, fired: stats.fired, coalesced: stats.coalesced, sent: stats.sent, noFetch: stats.noFetch, noKeyFn: stats.noKeyFn, event: { requests: stats.event.requests, points: stats.event.points } } },
    // 旧读数口 lastGateKey 已删（#1445）：它只回答「最后一次过闸带的是哪把钥匙」，如今不过闸，就没有东西可回答。
    // 要核对「交给管线的钥匙」是不是白名单那一把，看 fetch 收到的 meta.workspaceKey（tests/verify-723-gate-wiring 守着）。
    /** 只给门禁看的一份内部表：几个数字而已，没有会话 id、没有路径、没有命令。 */
    debugState: function (): any { return { allowedRoots: allowedRoots.size, knownSessions: sessionRoots.size, windows: lastProbeAt.size } },
  }
}
