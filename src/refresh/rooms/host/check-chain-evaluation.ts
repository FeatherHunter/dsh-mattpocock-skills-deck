// src/refresh/rooms/host/check-chain-evaluation.ts —— H3 #447 从 host/index.js 639-884 搬出，纯结构、行为零变化。
// 以后谁改它：改探测编排或检查链快照的人。预估约260行，超 350 打回。
// 接线：由 index.ts 动态 import 加载；harness 注册留守入口，处理器体经 handleDetect/handleChain 供给。
import { refreshSourceOf } from '../../contract/trigger-classification.js'
import { workspaceKeyOf } from '../../contract/workspace-keys.js'   // #724：链记账给闸的钥匙，与活跃集合同一把（从前传 cwd 原文 → 同一个工作区在闸里有两格）
import { getChainRide } from './chain-coalescing.js'   // #964 小账本住共享层；#966 用进程单例，出站写路能记写
import { PREDICATE_TIMEOUT_MS, GH_LOGIN_PREFETCH_MS, PREDICATE_LOG_SAMPLE_MS } from '../../../shared/time-config/src/values.js'   // #1215 时间参数住中央 YAML（predicateTimeoutMs / ghLoginPrefetchMs / predicateLogSampleMs），本文件只读不写
import { ghAuthVerdict, glabAuthVerdict, glabRepoAccessVerdict, probeChainEnv, repoAccessVerdict } from './chain-env-map.js'
import type { OpenSessionReply } from './chain-env-map.js'
// #1483：「判定 → 步骤行 / 快照」三件套搬到 chain-step-rows.ts，正常求值与缓存命中重算共用同一套口径；行为逐字保留。
// 九个形状（判定表、步骤行、单段与拼接快照）也从那里取：两处各写一份时，形状一改就会漂移（审阅指出过）。
import { assembleFullSnapshot, enrichSnap, stepEvalParallel } from './chain-step-rows.js'
import type { ChainSnapView, EvalMap, FullSnapView, PredicateResultView, ResolvedMap, ShowView, SnapStepView, SnapStepsView, StepView } from './chain-step-rows.js'

// ── 依赖与回包形状（票 #1155 补类型标注）────────────────────────────────────────
// 为什么逐条写在这里：本文件的依赖对象是 src/host/index.ts 里现拼的接线（转制后编译器看得见，形状以各文件的类型为准），
// 所以这一组类型就是「本文件按什么形状读它们」的书面约定，只列本文件真正读到的格子。
// 标注只给编译器看，运行期形状一个字没改——产物逐字节比对是这条约定的验收办法。
// 共享层的形状按「类型引用」取：那些文件是 JS + JSDoc，这种写法与他们自己的 JSDoc 一致。
type CheckItem = import('../../../shared/tracker/chain-types.js').CheckItem
// 谓词注册回调收到的「检查描述」最小形状（#1513 按其中 id 分派三项 Markdown 判据）。
type Check = import('../../../shared/tracker/chain-types.js').Check
type Platform = import('../../../host/platform/index.js').Platform
// 谓词上下文这一格不在上面那排「按类型引用取」里：predicatePrimitives.js 与本文件同属 host 层，
//   同层互引门禁只放行在册的存量边（tests/same-layer-baseline.json 只许减不许增），所以就地声明。
//   真源是 src/host/tracker/predicatePrimitives.js 的 JSDoc 契约（platform / backendId / cwd / signal /
//   extras）：那边加了字段、改了名字，这里要跟着改。按本文件的老规矩只列真正读到的格子——
//   正文里只读 pctx.cwd 与 pctx.lang 两格（lang 是宿主在契约之上额外喂的那一格）。
type PredicateContext = { cwd?: string; lang?: string }
type FixDecl = import('../../../tracker/fix-contract.js').FixDecl

/** 链入口的入参（客户端带上来的那几格；都可能缺，正文里读前都判过）。 */
type ChainArgs = {
  /** 工作区目录原文（空目录闸判的就是它）。 */
  cwd?: string
  force?: unknown
  lang?: unknown
  trigger?: unknown
  /** 客户端选定的后端 id（缺、空都按「没有」处理）。 */
  backendId?: string | null
  sessionId?: unknown
  /** 链的口径：只开门那几步 / 只走环境那几步 / 全链；不传按 all。 */
  kind?: 'gate' | 'env' | 'all'
}

/** catch 里接到的异常：只按「可能带 message」读——把 unknown 收口成这张脸，运行期一个字不动。 */
type CaughtError = { message?: unknown }

// ── 只读会话的能力面、环境档位表与预检探针已搬到 chain-env-map.ts（#1444）──────────────────
// 那边写清了为什么拆、档位怎么查、两个谓词怎么分派；本文件只留编排（退避、搭车、快照、缓存、日志）。

/** 后端段这一包：链、判定、快照与校验错（快照会过一遍富化，所以按富化认的最小形状装；errors 原样转给界面）。 */
type BackendChainPack = { chain: CheckItem[]; resolved: ResolvedMap; snapshot: SnapStepsView | null; errors: unknown }

/** 选择结论：本文件只读 backendId 与 source 两格（显式空是权威结论，见正文注释）。 */
type Selection = { backendId?: string | null; source?: string }

/** 一次探测的回包：本文件只读 selection 与 explicit 两格，其余原样透传给界面。 */
type DetectResult = { selection?: Selection | null; explicit?: { parsed?: { explicitBackendId?: unknown } } | null }

/** 探测服务：本文件只调 detect（前后两次调用各带各的选项）。 */
type DetectionService = { detect(input: unknown, opts: unknown): Promise<DetectResult> }

/** 后端模块：本文件只读 id 与 fixes 两格，后者整格转交给修复契约（不在这里读里面）。 */
type BackendModuleView = { id?: unknown; fixes?: { readonly [checkId: string]: FixDecl } }

/** 注册表：本文件只读 modules 一格（要后端声明的修复知识，见正文里的 attachFixContract）。 */
type RegistryView = { modules(): BackendModuleView[] }

/** 谓词注册回调拿到的运行期上下文：宿主在契约 PredicateContext 之上多喂了一格 lang（正文按它选文案）。 */
type PredicateCtx = PredicateContext & { lang?: string }

/** 退避与全绿缓存（纯函数那一份，薄壳住 src/refresh/rooms/host/chain-backoff.js）：本文件只调 verdict 与 note。 */
type ChainBackoff = {
  verdict(key: string, nowMs: number, opts: unknown): Promise<{ needed?: boolean; reason?: unknown; waitMs?: unknown; cached?: unknown }>
  note(key: string, snap: unknown, at: number, result: unknown): Promise<unknown>
}

/** 依赖：接线对象在 src/host/index.ts 里现拼，这里只列本文件用到的那些。 */
type DetectChainDeps = {
  canonicalKey(cwdIn: string): Promise<string>
  resetGhCache(): void
  getDetectionService(): Promise<DetectionService>
  getPlatform(): Promise<Platform>
  getTrackerRegistry(): Promise<RegistryView>
  getRepoKey(cwd: string): Promise<{ owner: string; name: string } | null>
  timer: { timeout(ms: number): Promise<unknown> }
  probeSkill(skillName: string, lang: string, cwd: string): Promise<unknown>
  /** 本地 Markdown 三项判据的取用口（#1513）：按检查项 id 调同一份房间判据，sandboxPolicy 供写探测用。 */
  mdPredicate(platform: unknown, cwd: string, lang: string, checkId: string, sandboxPolicy?: unknown): Promise<PredicateResultView>
  /** 解构出来但本文件没用到（接线给全了，这两格留给别处读）：只声明它们存在。 */
  DEFAULT_CWD: unknown; getChainCache: unknown
  setChainCache(entry: unknown): void
  getChainBackoff(): Promise<ChainBackoff | null>
  logCtx: { isEnabled(level: string): boolean; fire(level: string, event: string, fields: unknown): void } | null
  /**
   * 闸（#1444 起只经 noteChainEval 记这一笔）。写成可缺：接线可能给旧闸形状（只有 send），
   * 那种情况下求值照旧做完、只是不记账 —— 这是保留旧失败形状的那条边。
   */
  gate: { noteChainEval?(req: unknown): Promise<unknown> } | null
  sandboxPolicyFor(info: { cwd: string; sessionId: string }): Promise<{ policy?: unknown; sessionId?: unknown } | null>
  /**
   * 开一次 Tracker 只读会话（#1444）。缺省时环境那两行诚实 pending（不假装已登录、不假装仓库可达），
   * 其余各步照旧求值；开会话失败也走同一条降级路，不许抛给上层。
   */
  openSession?: (cwd: string, opts?: unknown) => Promise<OpenSessionReply>
  /** 注钟（只有测试给）：填空时不注，按 Date.now 走。 */
  now?: (() => number) | undefined
}

/**
 * 组装宿主侧的后端探测电话（`wf.detect`）与检查链求值电话（`wf.chain`）（#447 / #696 / #709 / #1048 / #1155）。
 *
 * 为什么：面板需要两条配合工作的读路径——一条问「当前工作区应该用哪个后端」（`handleDetect`），另一条问「通用环境与当前后端的每一项检查是否通过」（`handleChain`）；把退避裁决、同键并发搭车、单次评估内的环境预检复用与结构化日志收口在这里，既能把一次链求值的外部请求压到最少，又能保证不产生自续定时器。
 * 什么约定不能改：
 *   1. `handleDetect` 与 `handleChain` 入口前 3 行内必须先做空目录守卫与 `canonicalKey` 归一（门禁 `verify-3-workspace-switch.js` 直接钉死该位置）；工作区尚未就绪时直接返回确定信封，绝不拿宿主进程目录去冒充工作区。
 *   2. 用户手动点击重新检查（`trigger === 'user-recheck'`）在退避裁决上永远放行、不降档；后台触发的求值命中退避窗口时直接返回上一份缓存快照，且全文件不得新建任何自续 `setInterval` 或递归 `setTimeout`。
 *   3. 单次 `handleChain` 求值只开一次 Tracker 只读会话、只问一次 `preflight`（登录态与仓库可达两行共用这一份），取当前登录用户名问 `getCurrentUser`；求值结束即丢弃，绝不跨次缓存失败结果。
 * 反例：若把插件挂载时的自动链求值也当成 `user-recheck` 身份送进退避器，每次重渲染都会击穿退避窗口并发起外部 `gh` 子进程调用，瞬间耗尽配额。
 */
export function createDetectChain(deps: DetectChainDeps) {
  const { canonicalKey, DEFAULT_CWD, resetGhCache, getDetectionService, getPlatform, getTrackerRegistry, getRepoKey, timer, probeSkill, mdPredicate, getChainCache, setChainCache, getChainBackoff, logCtx, gate, sandboxPolicyFor, openSession } = deps
  // #491 房外埋点 helpers：hash8 只记散列；P1 外层先判开关（采样/节流/按事件），字段函数只在守卫内求值。
  function hash8(s: unknown) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  const chainInflight = getChainRide({ now: (deps && deps.now) || undefined }) // #696搭车表用进程单例（写信号由出站路记进来）；测试注钟时建隔离新账
  let lastPredAt = 0
  // 记的是「上一次落过的状态串」，按检查项 id 索引：这里写死键值都是字符串。
  let lastPredStatus: Record<string, string> = {}
  // #723（T19）：这一次求值的裁决与记账经闸落一笔（身份 = refreshSourceOf 算出来的那两个名字之一，所以
  // 「谁按的、哪一档、什么时候」留在账上）。#1444 起改走闸上的 noteChainEval：这一笔照旧零花费 ——
  // 这条链真正花出去的每一条出站请求都由传输层各自报过一笔，求值本身再报一遍会把同一笔数成两笔。
  async function noteChainEval(source: string, workspaceKey: string) {
    try {
      if (!gate || typeof gate.noteChainEval !== 'function') return
      await gate.noteChainEval({ source: source, workspaceKey: workspaceKey })
    } catch (e) { /* 记账不许把链求值带崩 */ }
  }

  // #1444：环境预检探针（会话、preflight、登录名各只问一次）搬到 chain-env-map.ts 的 probeChainEnv；
  // 这里只把接线给的两条能力交进去。
  // #1187：探针必须等 detect 定下后端才建——GitLab 的仓库身份要经会话 getRepoKey 问房间（宿主那份只认 GitHub），
  // 而探针把 refId 缓存进这一次求值，先建再定后端就会拿 GitHub 的空结果去问 GitLab。
  const createChainEnvProbe = (probeCwd: string, backendId: string | null | undefined) => probeChainEnv({ getRepoKey: getRepoKey, openSession: openSession }, probeCwd, { backendId: backendId || 'github' })

  // #1483：把「按当前会话解析沙箱许可」收成一处。正常求值与缓存命中后的重算都用这一处解析：
  //   缺省会话号（空串）与「接线没给 sandboxPolicyFor」都不算错，照旧返回空政策，让谓词按平台默认量。
  //   解析失败也不抛：宁可把那一行落成 pending（诚实未知），也不能让整条链因为量不到许可以失败收场。
  async function resolveSessionPolicy(chainCwd: string, sessionIdIn: unknown) {
    let policy: unknown = undefined
    let sessionId = String(sessionIdIn || '')
    try {
      if (typeof sandboxPolicyFor === 'function') {
        const sb = await sandboxPolicyFor({ cwd: chainCwd, sessionId: sessionId })
        if (sb && typeof sb === 'object') { policy = sb.policy; if (sb.sessionId) sessionId = String(sb.sessionId) }
      }
    } catch (eSb) {}
    return { policy: policy, sessionId: sessionId }
  }

  // #1483：把「没有自己真算、而是拿了别人算好的回包」按当前会话补算一次，返回副本与重算项数。
  //   两条路会拿到别人的回包：退避缓存回上一份（上一份可能是别的会话求的）、同钥匙在途搭车
  //   （搭上的是别的会话正在跑的那一轮）。两条都只可能是「依赖会话许可的那几行」不对，其余行
  //   照旧沿用——这也是这份回包还值得共享的理由。
  //   失败静默降级回原回包：拿到旧视图好过把整条链打成失败，下一轮自然会按本会话真算一次。
  async function patchReplyForSession(reply: unknown, chainCwd: string, chainLang: string, chainArgs: any) {
    let out: unknown = reply
    let patched = 0
    let failed = false
    try {
      const anyReply: any = out
      const items = (anyReply && anyReply.backendChain && Array.isArray(anyReply.backendChain.chain)) ? anyReply.backendChain.chain : null
      // 先扫一遍再决定要不要动态加载：没有会话相关项时这一趟只花一次数组遍历，不加载模块、不解析沙箱政策。
      //   patchCachedReplyForSession 自己还会再扫一遍（它是独立入口，不能假定调用方扫过），这里是有意的重复。
      const hasScoped = !!(items && items.some(function (it: any) { return it && it.sessionScoped === true }))
      if (hasScoped) {
        const patchMod = await import('./chain-session-patch.js')
        const sbInfo = await resolveSessionPolicy(chainCwd, chainArgs && chainArgs.sessionId)
        // #1492：重算也要有上限。正常求值的谓词有 15 秒超时兜底（predicateCore 的 withTimeout），
        //   补算原来直接 await 写探测——工作区在网络盘上挂住时，缓存命中这条本该纯内存返回的路会被无限拖住。
        //   超时按 pending 落行（诚实未知），不让整条链等一个量不出来的探针。
        const patchedOne = await patchMod.patchCachedReplyForSession(out, { platform: await getPlatform(), cwd: chainCwd, lang: chainLang, backendId: (chainArgs && chainArgs.backendId) || null, sandboxPolicy: sbInfo.policy, sessionId: sbInfo.sessionId, timeoutMs: PREDICATE_TIMEOUT_MS, timeout: function (ms: number) { return timer.timeout(ms) }, onError: function (msg: string) { try { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: 'wf.chain', kind: 'chain-session-patch-item', errorHash: hash8('patch-item:' + msg) }) } catch (eLog) {} } })
        out = patchedOne.reply
        patched = patchedOne.patchedCount
      }
    } catch (ePatch) {
      // 失败不抛给调用方（宁可先给旧视图），但要留一行：否则日志里只剩「这一趟明明命中了缓存、
      //   只读会话却还是看到可写」，查不出是没重算还是重算失败。
      // #1492：failed 要交给外层——回包带上 sessionPatchFailed 后客户端不会把它记成本会话的产出，
      //   否则别的会话的判定会被写进共享缓存、越传越远。
      failed = true
      try { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: 'wf.chain', kind: 'chain-session-patch', errorHash: hash8('patch:' + String((ePatch && (ePatch as any).message) || ePatch)) }) } catch (eLog) {}
      // #1492 复核：整趟补算做不下去时，不能把别的会话的判定原样交出去。用量不出来也拼得出来的那份替代：
      //   会话相关行落 pending（「未确认」），其余行照旧。这一步只读缓存里已有的链，不需要平台，所以
      //   刚才取平台失败也不影响；失败标记照旧打（客户端不写共享缓存，下次挂载会再问一次）。
      try {
        const unknownMod = await import('./chain-session-patch.js')
        const unknownOne = await unknownMod.markSessionScopedUnconfirmed(out, { platform: null, cwd: chainCwd, lang: chainLang, sessionId: chainArgs && chainArgs.sessionId })
        out = unknownOne.reply
        patched = unknownOne.patchedCount
      } catch (eUnknown) {}
    }
    return { reply: out, patched: patched, failed: failed }
  }

  // #709（T5）：退避与全绿缓存整段交给 kernel 的纯函数裁定（薄壳 src/refresh/rooms/host/chain-backoff.js，
  // 数字真源是 host-budget.ts）：8 秒 → 30 秒 → 2 分钟 → 5 分钟逐档后退，有进展立刻回第一档，全绿后 30 分钟。
  // 触发只由几路事件带起来（#1483 起客户端在跨会话命中共享缓存后也会补问一次），宿主侧一个自续定时器都没有；
  //   人亲手点「重新检查」带 trigger='user-recheck' 上来，永不降档。
  async function handleDetect(args: ChainArgs) {
      const _rawDetectCwd = (args && args.cwd) || ''; if (!String(_rawDetectCwd).trim()) return { ok: true, handle: { cwd: '' }, selection: null, repoHandle: { cwd: '', refId: '' }, explicit: { raw: null, parsed: { explicitBackendId: null } }, preflight: null, skillProbes: null, at: Date.now(), workspaceNotReady: true }; const cwd = await canonicalKey(_rawDetectCwd) // #1003 空目录闸：没目录不冒充
      const force = !!(args && args.force)
      // #195 修复：force 探测清空 gh 解析缓存（旧实现首次失败永久缓存，force 也救不回来）
      if (force) resetGhCache()
      try {
        const svc = await getDetectionService()
        const res = await svc.detect({ cwd }, { force }) // 上报已退役不传：刚选的经写入口直达文件，本轮即读到
        // #1048：结论线（常驻 #16 `detection.detect`）已挪到统一判定出口 `src/tracker/detection/backendDecision.ts`
        //   一处发出 —— 出口经探测服务拿到日志出口（`detectionService` 把 `logCtx` 递进去），四条路因此说同一件事。
        //   这里原来补发的那一条已删：同一次判定只该有一条结论，两条只是把同一件事记两遍。
        // 对抗式：ensure DetectionResult 形态（含 selection/pending/multiHit，按 #125）
        return { ok: true, ...res }
      } catch (e) {
        try { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: 'wf.detect', kind: 'detect', errorHash: hash8(String((e && (e as CaughtError).message) || e)) }) } catch (eL) {}; return { ok: false, error: String((e && (e as CaughtError).message) || e) }
      }
  }
  /** 一次链求值的结果：回包本身，以及「这份回包是不是按本会话现算的」（#1492）。 */
  type ChainOutcome = { reply: unknown; forCurrentSession: boolean; hit?: { cacheKey: string; reason: unknown; waitMs: unknown } }
  /** 主机侧的链求值入口：通用链 + 当前后端的链，两段各自求值、最后拼成一份快照。 */
  // #1492：这个入口只剩「规整入参 + 把别人的回包按本会话补齐」两件事，真求值在 evaluateChain 里。
  //   为什么要分层：能拿到别人算好的回包的路不止一条（退避缓存、在途搭车，以后还可能有新的），
  //   逐条路各补一次一定会漏；现在内层只回答「这份回包是不是按本会话现算的」，凡不是就统一在这里补。
  //   补算失败时给回包副本打 sessionPatchFailed：客户端见到它就不写共享缓存（不能把别人的判定记成本会话产出）。
  async function handleChain(args: ChainArgs) {
      const _rawChainCwd = (args && args.cwd) || ''; if (!String(_rawChainCwd).trim()) return { ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' }; const cwd = await canonicalKey(_rawChainCwd) // #1003 空目录闸
      const chainLang = (args && args.lang === 'en') ? 'en' : 'zh'
      const out = await evaluateChain(args, cwd, chainLang)
      let reply: any = out.reply
      let patched = 0
      if (!out.forCurrentSession) {
        const fixed = await patchReplyForSession(reply, cwd, chainLang, args)
        patched = fixed.patched
        // 失败标记只做顶层复制：这条路上本函数不原地改任何嵌套字段，客户端也只读不写这些对象，
        //   所以与缓存条目共用 nested 对象是安全的（真正会拼新 nested 对象的是 patchCachedReplyForSession）。
        // 字段名与客户端那一侧的读法是同一份口头契约（客户端是拼接片段，不能 import 共享常量）：
        //   两边各由一扇门禁钉住——宿主 tests/verify-1483-chain-session-cache.ts 的 H，客户端 test 的 L。
        // #1492 复核：失败分支也要用 fixed.reply——它可能已经过「会话相关行落未确认」的退路；
        //   写成 Object.assign({}, reply, ...) 会把那份退路丢掉，等于没做。
        reply = fixed.failed ? Object.assign({}, fixed.reply, { sessionPatchFailed: true }) : fixed.reply
      }
      const hit: any = out.hit
      // chain.cache.hit 挪到补算之后落：字段里的 patched 才是这一趟实际按本会话重算了几项。
      if (hit) { try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'chain.cache.hit', function () { return { keyHash: hash8(hit.cacheKey), lang: chainLang, deferred: true, reason: hit.reason, waitMs: hit.waitMs, patched: patched } }) } catch (eL) {} }
      return reply
  }
  /** 一次链求值的真身（#1492 从 handleChain 拆出）：只负责算，不负责判断这份结果属于哪个会话。 */
  async function evaluateChain(args: ChainArgs, cwd: string, chainLang: string): Promise<ChainOutcome> {
      const force = !!(args && args.force)
      const trigger = String((args && args.trigger) || '')
      // #709（T5 补）这一次求值是什么身份（人亲手点的 / 插件自己的动作）。插件自己也会调这个入口
      //（挂载、快照回包、动作做完之后再补一次），那种调用不带 trigger。判据只有 trigger-classification.ts 一处：
      // 带 trigger='user-recheck' 的算人的动作，其余一律归后台档 —— 挂载时那一次强制刷新走的正是后者。
      // 不分开的话，账本会把插件自己的动作记成「人手动过」，而人的动作在闸上永不降档。
      const chainSource = refreshSourceOf(trigger)
      if (force) resetGhCache()
      try{
        const cacheKey = cwd + '|' + String(args && args.backendId || '') + '|' + chainLang
        // #709（T5）：退避与全绿缓存这一段由纯函数裁定。人亲手点「重新检查」（trigger='user-recheck'）
        // 永不降档，无论退到第几档都照做；其余各路事件按退避判，挡下的那一次直接回上一份快照。
        // 接线没给退避模块（或它取不到）时按「取不到」处理、照旧求值：可选的加速件不该把整条链打成「链失败」（src/host/repoKeys.js 里同一处依赖也是先判有没有这个函数）。
        const backoff = (typeof getChainBackoff === 'function') ? await getChainBackoff().catch(function () { return null }) : null
        const nowMs = Date.now()
        const v = backoff
          ? await backoff.verdict(cacheKey, nowMs, { trigger: trigger })
          : { needed: true, reason: 'backoff-unavailable', waitMs: 0, cached: null }
        if (!v.needed) {
          // #1483：链快照的退避缓存按「工作区 + 后端 + 语言」共享，但 md:scratchWritable 这一类检查项的
          //   结果取决于当前会话的沙箱许可（只读会话量出来是 pending，可写会话是 done）。直接回缓存会让
          //   只读会话看到别的会话量出的「可写」。
          // #1492：这里不再自己补算，只报告「这份回包不是按本会话算的」与命中信息，交给外层统一补一次。
          return { reply: v.cached, forCurrentSession: false, hit: { cacheKey: cacheKey, reason: v.reason, waitMs: v.waitMs } }
        }
        try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'chain.cache.miss', function () { return { keyHash: hash8(cacheKey), lang: chainLang, reason: force ? 'force' : (v.reason || 'due') } }) } catch (eL) {}
        // #696 在途合并：同钥匙同后端同语言同强制标记共用同一份；先回来的写缓存，后到的拿同一份；强制不参与合并
        const chainDedupKey = cacheKey + '|' + (force ? '1' : '0')
        // #1483：搭车拿到的是「另一轮求值」的结果，那一轮用的是发起那一轮的会话许可。凡是有依赖会话许可的项，
        //   先按本会话补算再交给调用方；不然只读会话搭上可写会话的车，会先看到别人的「可写」。
        if (!force) { const ongoingRide = chainInflight.take(chainDedupKey); if (ongoingRide) { chainInflight.noteRide(); try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'dedup.hit', function () { return { scope: 'chain', keyHash: hash8(chainDedupKey) } }) } catch (eL) {}; return { reply: await ongoingRide, forCurrentSession: false } } }
        const chainPending = (async function () {
        // #1475：一次求值只读一次钟，给下面告警级「外层先到点 / 内层迟到回话」两行算本次求值的总耗时。
        //   这两行是告警级、总是落盘，不受调试开关约束，所以不把它挂在开关后面（一轮一次 Date.now 不算开销）。
        const evalT0 = Date.now()
        const platform = await getPlatform()
        // 用户显式选择经写入口直达文件（落盘 + 清缓存），本轮即读到，不再经上报参数。
        // #1444：探测级联不再借一条自己拼的 gh 执行器 —— 后端识别按房间自己的路走；
        //   登录态与仓库可达两行由下面两个谓词问 envProbe（同一次预检结果，各只真问一次）。
        const selMod = await getDetectionService().then(function(svc){ return svc.detect({ cwd }, { force, skipSkillProbes: true }) }).catch(function(){ return null })
        // 2026-08-28 语义修正（锚即真相，Q4 契约）：落盘主锚（detect 的 explicit/matches 判定）是权威——
        //   工作区「错误地用 GitHub 模板初始化」→ 检测就是 github（工作区名字不影响检测）；
        //   客户端绑定仅在 detect 无结论（无锚 fallback null / 探测中）时兜底，旧绑定记忆不得篡改已落盘的真相。
        const selDetected = selMod && selMod.selection
        // #297 失效维度：显式空（backendId null + source explicit）是权威“无后端”结论（如空目录 stale），不得再用旧 hint 兜底，否则蓝条永不重现
        // 三态：还没认出来（undefined）/ 认出来是「无后端」（null）/ 有后端（id）。
        let backendId: string | null | undefined
        if (selDetected && selDetected.backendId) {
          backendId = selDetected.backendId
        } else if (selDetected && selDetected.source === 'explicit' && selDetected.backendId === null) {
          backendId = null
        } else {
          backendId = (args && args.backendId) || null
        }
        // #1444：这次求值的环境预检探针（一次求值只开一次会话、只问一次 preflight；见 createChainEnvProbe）。
        //   登录态与仓库可达两行、以及修复合约里的当前登录用户名，全都从这一份里取。
        // #1187：放在这里而不是更前——后端的结论上面才定下来，GitLab 需要它才能问对仓库身份。
        const envProbe = createChainEnvProbe(cwd, backendId)
        const genMod = await import('../../../host/tracker/generic.js')
        const predMod = await import('../../../host/tracker/predicateCore.js') // V1 #461：predicateRegistry.js 已拆为两块
        // #1475 预算对齐：这次求值的外层等待 = 60 秒（config/timeouts.yaml 的 predicateTimeoutMs），
        //   算式是「内层串行最坏 + 余量」：一次环境预检串行问几条真实网络命令，最坏那条路是
        //   「查登录 15 秒 → 核对登录 15 秒 → 读仓库短名 12 秒 → 读仓库可达 12 秒」合计 54 秒，再加 6 秒余量；
        //   核对通过不会提前返回（那只说明登录可用，仓库可达还要查），缺仓库短名时才多一条读仓库短名。
        //   内层最坏不写在这里，由 preflight.ts 的 ghPreflightWorstCaseMs() 按出站档位现算，
        //   门禁 tests/verify-1475-predicate-budget.ts 断言这个 60 秒确实盖得住它并留有余量。
        //   旧口径（2026-08-28 的 3 秒 → 15 秒）已作废：15 秒比内层最坏还短，慢网下必然外层先断、结论被丢掉。
        //   谓词表不传 timeout 时的兜底是另一档（predicateFallbackTimeoutMs = 10 秒），不参与这次对齐。
        // 两个回调只记边界轨迹（外层预算先到点 / 内层迟到回话），不改任何谓词结论；
        //   到点仍判「暂时确认不了」（pending），不冒充登录失效、也不冒充缺 gh。
        const registry = predMod.createPredicateRegistry({
          timeout: PREDICATE_TIMEOUT_MS,
          onBudgetHit: function (id: string, info: { budgetMs: number }) {
            try {
              if (logCtx) logCtx.fire('warn', 'chain.predicate.timeout', { id: String(id), phase: 'budget', budgetMs: info.budgetMs, status: 'pending', latencyMs: Date.now() - evalT0 })
            } catch (eH) {}
          },
          onLateSettle: function (id: string, info: { status: string; budgetMs: number }) {
            try {
              if (logCtx) logCtx.fire('warn', 'chain.predicate.timeout', { id: String(id), phase: 'late', budgetMs: info.budgetMs, status: String(info.status), latencyMs: Date.now() - evalT0 })
            } catch (eL) {}
          }
        })
        if (typeof genMod.registerGenericPredicates === 'function') genMod.registerGenericPredicates(registry)
        // #284 一致性修复（2026-08-28）：客户端显式绑定（backendId）优先——主锚与绑定不一致的过渡态（如锚=GitHub 版、
        //   用户已绑 markdown）链不得两面矛盾（后端段 markdown、开门段 explicit:github）；selection/explicit 归一为绑定侧。
        const selRaw = selMod && selMod.selection
        const selConsistent = (selRaw && backendId && selRaw.backendId !== backendId)
          ? Object.assign({}, selRaw, { backendId: backendId })
          : selRaw
        const expConsistent = (selConsistent && selConsistent.backendId)
          ? selConsistent.backendId
          : ((selMod && selMod.explicit && selMod.explicit.parsed && selMod.explicit.parsed.explicitBackendId) || null)
        const sbInfo = await resolveSessionPolicy(cwd, args && args.sessionId)
        const chainPolicy = sbInfo.policy; const chainSessionId = sbInfo.sessionId
        const ctx = { platform: platform, backendId: backendId || null, cwd: cwd, lang: chainLang, selection: selConsistent, explicitBackendId: expConsistent, sandboxPolicy: chainPolicy, sessionId: chainSessionId, skillProbe: async function (skillName: string) { try { return await probeSkill(skillName, chainLang, cwd) } catch (e) { return { ok: false, level: 'pending', detail: String((e && (e as CaughtError).message) || e), hint: 'pending:skills-unavailable' } } } }
        // #284：后端谓词注册（host 既有探测包装；未注册者由 registry 诚实 pending，不猜不误报）
        try { registry.register('backend:github:repoRemote', async function (check, pctx: PredicateCtx) {
          try {
            // 2026-08-29（审查 S1）：detail 双语——中文界面不出现英文黑话行
            const zh = (pctx && pctx.lang) !== 'en'
            const rk = await getRepoKey(pctx && pctx.cwd || cwd)
            if (rk && rk.owner && rk.name) return { status: 'pass', detail: rk.owner + '/' + rk.name }
            return { status: 'fail', detail: zh ? '未找到 GitHub 仓库关联（git remote 未指向 GitHub）' : 'repo not located' }
          } catch (e) { return { status: 'pending', detail: String((e && (e as CaughtError).message) || e) } }
        }) } catch (e) {}
        try { registry.register('backend:github:repoAccess', async function (check, pctx: PredicateCtx) {
          try {
            // 2026-08-29（审查 S1/S2）：detail 双语；pending 文案如实说明「网络/登录态未知」，不与 fail 混淆
            const zh = (pctx && pctx.lang) !== 'en'
            const rk = await getRepoKey(pctx && pctx.cwd || cwd)
            if (!rk || !rk.owner || !rk.name) return { status: 'fail', detail: zh ? '未找到 GitHub 仓库关联' : 'repo not located' }
            // #1444：仓库可达问会话 preflight 的第三关（api repos/o/n）；与登录态那一项共用一次调用。
            // #1444：档位分派与话术在 chain-env-map.ts 的 repoAccessVerdict 里（那边有整段说明）。
            return repoAccessVerdict(await envProbe.preflightOnce(), zh)
          } catch (e) { return { status: 'pending', detail: String((e && (e as CaughtError).message) || e) } }
        }) } catch (e) {}
        try { registry.register('preflight:ghAuth', async function (check, pctx: PredicateCtx) {
          try {
            // 2026-08-29（审查 S1）：detail 双语——fail 说清「登录失效」，pending 如实区分网络与未知
            const zh = (pctx && pctx.lang) !== 'en'
            // #1444：登录态问会话 preflight 的前两关；房间只回一个错误档位，所以按 CHAIN_ENV_STAGE_OF 反推停在哪。
            // #1444：档位分派与话术在 chain-env-map.ts 的 ghAuthVerdict 里。
            return ghAuthVerdict(await envProbe.preflightOnce(), zh)
          } catch (e) { return { status: 'pending', detail: String((e && (e as CaughtError).message) || e) } }
        }) } catch (e) {}
        // #1513：本地 Markdown 从「一项地图可读」拆成三项固定判据（工作区 / 本地数据目录可写 / 容器可读）。
        //   三项共用房间那一份实现，这里只按检查项 id 分派；写探测要当前会话的沙箱写许可，所以把
        //   pctx.sandboxPolicy（没有就退回本次链求值的 chainPolicy）一路传下去。
        try {
          // 谓词注册表传进来的就是这个检查项自己的 check 描述（带 id），这里只读 id 分派三项判据。
          const mdPred = async function (check: Check, pctx: PredicateCtx): Promise<PredicateResultView> {
            const checkId = String((check && check['id']) || '')
            // 写探测要当前会话的沙箱写许可：pctx 上那一格是宿主在契约之外透传的，这里按最小形状读出来；
            //   没带就退回本次链求值的 chainPolicy（两者是同一个来源，只是调用路径不同）。
            const policyCtx = pctx as (PredicateCtx & { sandboxPolicy?: unknown }) | undefined
            const policy = policyCtx && policyCtx.sandboxPolicy !== undefined ? policyCtx.sandboxPolicy : chainPolicy
            try { return await mdPredicate(platform, (pctx && pctx.cwd) || cwd, chainLang, checkId, policy) } catch (e) { return { status: 'pending', detail: String((e && (e as CaughtError).message) || e) } }
          }
          registry.register('backend:markdown:workspace', mdPred)
          registry.register('backend:markdown:scratchWritable', mdPred)
          registry.register('backend:markdown:containersReadable', mdPred)
        } catch (e) {}
        // #1187：GitLab 后端的两行。目录项要的键是 glab:authed → preflight:glabAuth、glab:repoAccess →
        //   backend:gitlab:repoAccess；从前全仓一条都没注册，注册表便把这两行如实回成
        //   「predicate not registered: …」的 pending —— 界面看到的是一句英文内部串，永远查不出结论。
        // 判定与话术在 chain-env-map.ts 的 glabAuthVerdict / glabRepoAccessVerdict（那边写清了为什么不能
        //   拿 glabPreflight 的 auth 档直接判未登录：房间把起进程失败与网络超时也归在 auth 档）。
        try { registry.register('preflight:glabAuth', async function (check, pctx: PredicateCtx) {
          try {
            const zh = (pctx && pctx.lang) !== 'en'
            // 前两关：glab 找没找到、登录态是什么；一次 preflight 的结果两个谓词共用。
            return glabAuthVerdict(await envProbe.preflightOnce(), zh)
          } catch (e) { return { status: 'pending', detail: String((e && (e as CaughtError).message) || e) } }
        }) } catch (e) {}
        try { registry.register('backend:gitlab:repoAccess', async function (check, pctx: PredicateCtx) {
          try {
            const zh = (pctx && pctx.lang) !== 'en'
            // 第三关：拿会话认出来的仓库地址去问 GitLab 接口；没认出地址时房间会跳过这一关回成功，
            //   谓词按 pending 说明「暂时确认不了」，不冒充可达。
            return glabRepoAccessVerdict(await envProbe.preflightOnce(), zh)
          } catch (e) { return { status: 'pending', detail: String((e && (e as CaughtError).message) || e) } }
        }) } catch (e) {}
        const kind = (args && args.kind) || 'all'
        const chainAndSnap = await genMod.resolveGenericChain(registry, ctx, kind)
        // #284 修订（对抗式审查 2026-08-28）：链上检查项【逐项独立求值】——
        //   evaluateChain 的串行被阻塞语义会把「已算出但前置未过」的判定（技能缺失红牌、gh 未装提示）吞成 pending；
        //   此为 #281 红牌契约与 #229「pending=诚实未知」的不诚实表达。改为：所有步骤保留自身判定（全貌诊断），
        //   链只表达「首个未通过步 = 当前引导步」（currentIndex），引导与诊断合二为一。
        const genPredResults = predMod.toPredicateResults ? predMod.toPredicateResults(chainAndSnap.resolved || {}) : (chainAndSnap.resolved || {})
        const genericSnapRaw = stepEvalParallel(genMod.getGenericChain ? genMod.getGenericChain(kind) : (chainAndSnap.chain || []), genPredResults)
        let backendChain: BackendChainPack | null = null
        try{
          if (backendId) {
            const catDirs = await import('../../../shared/tracker/check-catalog-dirs.js')
            const catViews = await import('../../../shared/tracker/check-catalog-views.js')
            const chainMod = await import('../../../shared/tracker/chain-validate.js')
            // 目录项直递转换函数：catalogFor 给的是目录的 CatalogItem，catalogItemToCheckItem
            // 要的是目录项输入形态（id/label/scope/check），两份都是与 chain-types 同源的本地形态，
            // 格子逐字对齐，直接递进去，不转类型也不改值（运行期原样递进去）。
            // 目录只认这三个后端的表（check-catalog-dirs.ts 的 JSDoc 就是这么写的），别的 id 在表里没有格子；
            // 这里只是把「已经认出来是某个后端」收成表认的那几个，转的是类型、值原样递进去。
            let items = (catDirs.catalogFor ? catDirs.catalogFor(backendId as 'github' | 'markdown' | 'gitlab') : []).filter(function(c){ return c.scope==='backend' && c.id !== 'gh:labels' }).map(function(ci){ return catViews.catalogItemToCheckItem ? catViews.catalogItemToCheckItem(ci) : null }).filter(Boolean) as CheckItem[]
            // 修复契约（2026-08-28）：后端声明 fixes（hint + 修复动作）→ 按语言解析附到检查项 onFail——
            //   检查失败即有修复入口（注入指引/重查），UI 零派生只渲染分发；后端未声明 fixes 则保持默认（重查）。
            if (items.length) {
              try {
                const fixMod = await import('../../../tracker/fix-contract.js')
                const regT = await getTrackerRegistry()
                const tmods = (regT && typeof regT.modules === 'function') ? regT.modules() : []
                const tmod = (tmods || []).find(function (m) { return m && String(m.id) === String(backendId) && m.fixes }) || null
                // 2026-08-28 用户反馈「owner/... 占位」：预解析当前 GitHub 登录用户名（仅 github 后端、最快 2.5s 超时，
                //   失败静默空）→ fixContract 将其替换进 preview 模板 {owner}——预览显示真实用户名（如 FeatherHunter），
                //   不再显示字面量 "owner"；未登录/网络失败时保留占位（UI 诚实兜底）
                let _fixOwner = ''
                try {
                  if (String(backendId) === 'github') {
                    // #1444：当前登录用户名问会话的 getCurrentUser（不再另起一条 gh 命令）；仍保留最快 2.5 秒的
                    //   上限与失败静默空 —— 未登录/网络失败时预览保留 {owner} 占位，这是 UI 的诚实兜底。
                    const _u = await Promise.race([
                      envProbe.viewer(),
                      timer.timeout(GH_LOGIN_PREFETCH_MS).then(function () { return null }),
                    ])
                    if (_u && _u.ok && _u.login) _fixOwner = String(_u.login).trim()
                  }
                } catch (e) { }
                if (tmod && fixMod.attachFixContract) items = fixMod.attachFixContract(items, tmod, chainLang, { cwd: cwd, owner: _fixOwner }) as CheckItem[]   // 返回按 unknown 收（契约说「不是数组就原样返回」，这里只知道它给回同一份数组）
              } catch (e) {}
              const resolved = await registry.resolveAll(items, ctx)
              const predResults = predMod.toPredicateResults ? predMod.toPredicateResults(resolved) : resolved
              const snapshot = stepEvalParallel(items, predResults)
              const errs = chainMod.validateChain ? chainMod.validateChain(items) : []
              backendChain = { chain: items, resolved: resolved, snapshot: snapshot, errors: errs }
            }
          }
        }catch(e){}
        // #284 修订（对抗式审查 2026-08-28）：后端链【独立求值】——不再与通用链串行拼接，
        //   消除「env:home 未通过 → gh CLI/登录/仓库可达全被阻塞」的假依赖；fullSnapshot 为两段步骤的
        //   「拼接视图」（各步状态保留自身判定），但不再互相锁步。
        // #668：拼接后的行序按首开引导链的步骤清单排（清单上的步骤按清单顺序在前，清单没覆盖的检查项
        //   按各段原有先后接在后面）。顺序只有清单那一份真源，界面照快照渲染、自己不排序。
        //   旧语义「通用段 → 后端段」到此结束：新语义下「未初始化」排在「已关联仓库」之后。
        let fullSnapshot: SnapStepsView | null = null
        let fullChain = null
        try {
          const chainMod3 = await import('../../../shared/tracker/chain-validate.js')
          const genSnap = genericSnapRaw || chainAndSnap.snapshot
          const backSnap = (backendChain && backendChain.snapshot) || null
          const genSteps = (genSnap && Array.isArray(genSnap.steps)) ? genSnap.steps : []
          const backSteps = (backSnap && Array.isArray(backSnap.steps)) ? backSnap.steps : []
          fullChain = chainAndSnap.chain.concat((backendChain && backendChain.chain) ? backendChain.chain : [])
          const allStepsRaw = genSteps.concat(backSteps)
          let allSteps = allStepsRaw
          try {
            const guideMod = await import('../../../shared/tracker/guide-steps.js')
            if (guideMod && typeof guideMod.orderStepsByGuide === 'function') {
              allSteps = guideMod.orderStepsByGuide(guideMod.guideStepsFor(backendId || null), allStepsRaw) as StepView[]   // 清单那一份把入参与产物都写成宽松的 Object（JSDoc 只记形状不记字段），这里按步骤形状收回来——运行期原样用
            }
          } catch (eG) {}
          fullSnapshot = assembleFullSnapshot(allSteps as SnapStepView[])   // 计数口径与单段快照同一处（chain-step-rows.ts）；这一份是拼接视图，没有 failedIndex
        } catch (e) { fullSnapshot = chainAndSnap.snapshot; fullChain = chainAndSnap.chain }
        // #284：富化链快照——谓词结果的 detail/hint 合并进步骤 show（红牌分拣文案经链到达 UI）；实现见 chain-step-rows.ts。
        const allResolved = Object.assign({}, chainAndSnap.resolved || {}, (backendChain && backendChain.resolved) || {})
        try {
          if (logCtx && logCtx.isEnabled('debug')) {
            const nowP = Date.now()
            if (nowP - lastPredAt > PREDICATE_LOG_SAMPLE_MS) {
              lastPredAt = nowP
              const ids = Object.keys(allResolved || {})
              for (let pi = 0; pi < ids.length; pi++) { const rd = allResolved[ids[pi]]; const stt = String((rd && (rd.status || rd)) || 'pending'); if (lastPredStatus[ids[pi]] !== stt) { lastPredStatus[ids[pi]] = stt; logCtx.fire('debug', 'chain.predicate', { id: String(ids[pi]), status: stt }) } }
            }
          }
        } catch (eL) {}
        const genericSnap = enrichSnap(genericSnapRaw || chainAndSnap.snapshot, chainAndSnap.resolved)
        const backendSnapE = (backendChain && backendChain.snapshot) ? enrichSnap(backendChain.snapshot, backendChain.resolved) : (backendChain && backendChain.snapshot)
        if (backendChain) backendChain.snapshot = backendSnapE
        fullSnapshot = enrichSnap(fullSnapshot, allResolved)
        const result = { ok: true, backendId: backendId || null, chain: chainAndSnap.chain, resolved: chainAndSnap.resolved, snapshot: genericSnap, backendChain: backendChain, fullChain: fullChain, fullSnapshot: fullSnapshot, chainSource: chainSource }
        // #284 修订 + 2026-08-28 B 方案（用户定版）：链未全绿（仍存在 pending/fail/current 步骤）不写 30s 缓存——
        //   未完成区是动态区（修复由对话/终端发生在链外），panel 轮询每次真探测，修复完成即自动变绿；
        //   全部通过（done）才缓存（全绿后零重复探测，client 轮询也随之停止）。
        const chainNotAllDone = (function () {
          const steps = (fullSnapshot && Array.isArray(fullSnapshot.steps)) ? fullSnapshot.steps : []
          return steps.some(function (s) { return s.status !== 'done' })
        })()
        if (!chainNotAllDone) setChainCache({ ts: Date.now(), key: cacheKey, value: result })
        // #709（T5）：把这一份快照记进退避态。链上多出一步 done 才算进展（重跑拿到一样的结果不算），有进展立刻回第一档；没进展就往后退一档，退到最慢那档就停在那里。
        try { if (backoff) await backoff.note(cacheKey, fullSnapshot, Date.now(), result) } catch (eNote) {}
        // #723（T19）：这一次求值的裁决与记账经闸落一笔（身份来自 refreshSourceOf，见 noteChainEval）。
        await noteChainEval(chainSource, workspaceKeyOf(cwd))
        // #709（T5 补）这次求值的环境预检收尾：真问了几次、复用省掉了几次。按需级（debug，外层先判
        // 开关，关着连字段对象都不组装；按 docs/design/335-logging-contract.md 第 3 章判定），
        // 每次求值只落一行，只记工作区短指纹、计数与这次求值的总耗时，不记命令原文、不记路径原文、不记任何返回值。
        // #1444 起 preflight 改问会话，计数含义照旧：#1444 的探针把「真问了一次 preflight」记成 asked，
        // 第二个谓词搭这一份记成 reused；事件名与字段一个字没改（附录第 1 章条数不动）。
        try {
          // 判断与落点同一行（tests/verify-log-guards.js 的口径：关着开关时连字段对象都不组装）：
          // 这里原来把判断写成上一行的 if 大括号，判断本身一个字没减，只是搬到同一行。
          if (logCtx && logCtx.isEnabled('debug') && envProbe) logCtx.fire('debug', 'chain.preflight.reuse', function () {
            return { cwdHash: hash8(cwd), checks: envProbe.asked(), reused: envProbe.reused(), userAction: trigger === 'user-recheck', latencyMs: Date.now() - evalT0 }
          })
        } catch (eL) {}
        return result
        })()
        if (!force) { const rideEntry = chainInflight.park(chainDedupKey, chainPending); try { return { reply: await chainPending, forCurrentSession: true } } finally { chainInflight.leave(chainDedupKey, rideEntry) } }
        return { reply: await chainPending, forCurrentSession: true }
      }catch(e){
        try { const m = String((e && (e as CaughtError).message) || e); if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: 'wf.chain', kind: 'chain', errorHash: hash8(m), errorKind: (/is not a function|is not defined|of undefined|of null/i.test(m) ? 'missing-dep' : (/timeout|timed out/i.test(m) ? 'timeout' : 'throw')) }) } catch (eL) {}   // #724：异常也留一行（从前静默吞掉，真机查了两天没有原文）；errorKind 把「接线没给全」（missing-dep）与「跑起来真失败」（throw）分开
        return { reply: { ok: false, error: String((e && (e as CaughtError).message)||e) }, forCurrentSession: true }
      }
  }
  return { handleDetect, handleChain, markChainWrite: function () { chainInflight.markWrite() }, rideStats: function () { return chainInflight.stats() } }
}
