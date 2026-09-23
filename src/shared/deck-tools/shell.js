// src/shared/deck-tools/shell.js —— 七个 deck_* 工具共用的薄壳机制（#713 第六批）
//
// 为什么住在 src/shared/ 而不是 src/host/tools/：仓库有一条同层互引门禁（tests/verify-no-same-layer-import.js），
// 同一个层里的文件之间不许互相引用。七个工具若各写一份「从会话上下文取工作区、过闸、三态返回、永不抛」，
// 同一套规则就会有七份；若让它们互相 import，门禁当场红。这个文件放在共享层，七个工具文件各自 import 它
// 一条边（host → shared 是允许的方向），规则仍然只有一份。
//
// 本文件自己不 import 任何东西：闸、后端注册表、额度常量、算账函数都由接线方（或测试）从构造函数传进来。
// 这不是洁癖 —— 共享层的文件之间也不许互相 import，而额度常量住在 src/shared/refresh/budget.js，
// 所以只能由调用方取好传进来（做法与宿主侧的 gate.js / ledger.js、纯函数层的 policy.ts / backoff.ts 一致）。
//
// 这个壳守住四条硬要求（票面点名的三条 + 加固补充里那条）：
//   1. 每次后端调用都过宿主闸：选后端那一次探测与真正的读写各过一次闸，走 AI 那一档
//      （gate.admitAiTool 先判硬顶，超顶直接拒绝并说明用了多少、顶在哪；gate.send 再记真实花费）。
//      工具文件里没有一处直接调后端实现，也没有一处自己判后端是谁。
//   2. 后端一律走既有优先级出口 registry.select（用户手动选择 > 锚文件 > 自动识别），工具不自己挑。
//   3. 工作区与仓库从会话上下文取（exec.agent.session），不接受调用方传参；解析不出来就如实说做不到。
//   4. 工具永不抛异常：后端实现抛错、闸拒绝、没后端、会话取不到，一律变成 ok:false/partial 的三态返回
//      —— 抛出去 AI 会退回去用它熟悉的 gh，两条写路径同时开火。
//
// 三态与「拒绝」的关系（这里说清，免得以后有人以为少了第四种状态）：
//   ok          这一次做成了（部分成功用 partial）；
//   partial     一批里有的成、有的没成，逐项列出谁成了谁没成；
//   unsupported 这件事没做成，并且如实说了为什么 —— 原因写在 reason 字段里，取值见下面 REFUSAL_REASONS。
//               额度超顶、没有后端、后端说做不到、工具自己判不了落点，都归这一档，绝不假装成功。

/** 这批工具的身份（写日志时进 host.call 的 kind 字段；不是新事件，沿用它原有的字段清单）。 */
export const DECK_TOOL_KIND = 'deck-tool'

/** 三态返回的取值。edges.js 的 statusOfItems 返回的就是这三个字符串（验收脚本有一条断言钉住这件事）。 */
export const DECK_STATUS = Object.freeze({ OK: 'ok', PARTIAL: 'partial', UNSUPPORTED: 'unsupported' })

/** 「这件事没做成」的原因取值。文案给人的那句话说在返回的 text 里，这里只放机器可读的那一格。 */
export const REFUSAL_REASONS = Object.freeze({
  NO_SESSION: 'no-session-context',
  OVER_CAP: 'ai-tool-refused',
  NO_BACKEND: 'no-backend',
  GATE_DEFER: 'gate-defer',
  BACKEND_THREW: 'backend-threw',
  BACKEND_UNSUPPORTED: 'backend-unsupported',
  BAD_ARGS: 'bad-args',
})

// 落点表（EDGE_LANDING）与它的判定（landingOf / classifyEdgeLanding / edgeEvidence / childrenOf / statusOfItems）
// 住在同目录的 edges.js：那边写的是「规矩」，这里写的是「机制」（会话怎么取、闸怎么过、信封怎么拼）。
// 拆成两个文件的唯一原因是 350 行的单文件上限（tests/verify-file-granularity.js），不是为了分层。

function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0 }
function str(v) { return (typeof v === 'string') ? v : '' }

function hash8(text) {
  let h = 5381
  const t = String(text || '')
  for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
  return ('0000000' + h.toString(16)).slice(-8)
}

/** 额度常量从 budget.js 取好传进来时的对照表：字段名与 refresh-core/src/budget.ts 的导出同名。 */
export function limitsFromBudget(b) {
  const src = b || {}
  return {
    maxPointsPerCall: num(src.AI_TOOL_MAX_POINTS_PER_CALL),
    maxRequestsPerCall: num(src.AI_TOOL_MAX_REQUESTS_PER_CALL),
    maxChildTicketsPerCall: num(src.AI_TOOL_MAX_CHILD_TICKETS_PER_CALL),
    maxPointsPerHour: num(src.AI_TOOL_MAX_POINTS_PER_HOUR),
    maxRequestsPerHour: num(src.AI_TOOL_MAX_REQUESTS_PER_HOUR),
  }
}

/**
 * 从会话上下文里取工作区。只认「会话里带着的那个目录」，不接受调用方传进来的路径
 * （那样等于允许跨工作区写）。真实运行时的首选位置是 exec.agent.session.cwd；
 * 别的几个位置一起认，是因为会话对象在宿主不同版本里的形状不完全一样，
 * 认不出来时返回 ok:false，让工具如实说做不到，而不是猜一个进程目录。
 */
export function sessionContextOf(exec, deps) {
  const e = exec || {}
  const d = deps || {}
  const agent = e.agent || {}
  const session = agent.session || e.session || null
  const cands = [
    { where: 'exec.agent.session.cwd', value: session && session.cwd },
    { where: 'exec.agent.session.workspaceRoot', value: session && session.workspaceRoot },
    { where: 'exec.agent.session.workspace.cwd', value: session && session.workspace && session.workspace.cwd },
    { where: 'exec.agent.cwd', value: agent.cwd },
    { where: 'exec.session.cwd', value: e.session && e.session.cwd },
    { where: 'exec.cwd', value: e.cwd },
  ]
  let cwd = ''
  let source = ''
  for (const c of cands) {
    if (typeof c.value === 'string' && c.value.trim()) { cwd = c.value.trim(); source = c.where; break }
  }
  const sessionId = str(session && (session.id || session.sessionId)) || str(agent.sessionId)
  if (!cwd) {
    return { ok: false, reason: REFUSAL_REASONS.NO_SESSION, sessionId: sessionId, text: '这次没拿到当前会话的工作区目录（会话上下文里没有可用的路径），所以我不动任何票。请换一个会话再来，或让维护者看一看会话对象的形状。' }
  }
  const key = typeof d.workspaceKeyOf === 'function' ? String(d.workspaceKeyOf(cwd)) : ('ws-' + hash8(cwd))
  return { ok: true, cwd: cwd, workspaceKey: key, sessionId: sessionId, source: source, text: '' }
}

// 边的落点判定与逐项证据（landingOf / classifyEdgeLanding / childrenOf / statusOfItems）住在同目录的
// edges.js：同层的文件不许互相 import，所以那边自带一份最小的字符串工具函数，拆开的理由见 edges.js 文件头。
// 「一批里有的成、有的没成 → partial」这条总结论也在那边（statusOfItems），这里不再留第二份。

/**
 * 建一个壳。deps：
 *   gate       必填，宿主闸（src/host/refresh/gate.js 的产物）：admitAiTool / send / stats
 *   registry   必填，后端注册表（src/host/tracker/registryCore.js 的产物）：select / get
 *   budget     必填，额度常量（src/shared/refresh/budget.js 的产物），只为拼出 limits 用
 *   estimate   必填，算账函数（src/shared/refresh/tool-cost.js 的产物）
 *   backendCtx 可选，后端 ctx（platform / fs / exec 那一套）；不传时用 opCtx 顶上
 *   log        可选，日志出口 { fire }（写 host.call / host.call.fail 两行，不新增事件名）
 *   now        可选，取时间（测试注入假时钟）
 *   invalidate 可选，写后失效缓存该票条目：invalidate({ repo, keys, backendId })
 */
export function createDeckShell(deps) {
  const d = deps || {}
  const gate = d.gate
  const registry = d.registry
  const budget = d.budget || {}
  const estimate = d.estimate
  const log = d.log || null
  const now = typeof d.now === 'function' ? d.now : Date.now
  const limits = limitsFromBudget(budget)

  function fire(method, ms, ok, errorHash) {
    if (!log || typeof log.fire !== 'function') return
    try {
      if (ok) log.fire('info', 'host.call', { method: method, latencyMs: ms, ok: true, kind: DECK_TOOL_KIND })
      else log.fire('warn', 'host.call.fail', { method: method, kind: DECK_TOOL_KIND, errorHash: errorHash || hash8('unknown') })
    } catch (e) { /* 日志坏了不影响工具干活 */ }
  }

  function context(exec) { return sessionContextOf(exec, { workspaceKeyOf: d.workspaceKeyOf }) }

  /** 后端 ctx（platform / fs / exec 那一套）：可以给对象，也可以给一个现取的函数（多工作区共用一个壳时后者更顺手）。 */
  function backendCtxNow() {
    const b = d.backendCtx
    if (typeof b === 'function') { try { return b() || {} } catch (e) { return {} } }
    return b || {}
  }

  /**
   * 调用前算账：工具名 + 参数 → 点数、请求数、超没超单次顶、建议分几片。
   * 「本小时 AI 工具已经花了多少」由接线方给（deps.hourUsage，通常接账本的 hourOf('ai-tool')）：
   * 拿不到时按 0 算，只影响建议里那句「本小时快用满了」，不影响单次硬顶的裁决（那是闸的事）。
   */
  function estimateFor(tool, args) {
    let used = {}
    if (typeof d.hourUsage === 'function') {
      try { used = d.hourUsage() || {} } catch (e) { used = {} }
    }
    const input = typeof d.costInputFrom === 'function' ? d.costInputFrom(tool, args) : { tool: tool }
    const withHour = Object.assign({}, limits, { usedPointsThisHour: num(used.points), usedRequestsThisHour: num(used.requests) })
    return estimate(input, withHour)
  }

  /** 统一的返回信封。 */
  function envelope(tool, status, extra) {
    const base = {
      ok: status === DECK_STATUS.OK,
      status: status,
      tool: tool,
      reason: '',
      text: '',
    }
    return Object.assign(base, extra || {})
  }

  function unsupported(tool, reason, text, extra) {
    return envelope(tool, DECK_STATUS.UNSUPPORTED, Object.assign({ reason: reason, text: text }, extra || {}))
  }

  /** 超顶：把闸那句原话端出去（哪一项顶住了、用了多少，都由闸说），工具不自己编一个数。 */
  function refused(tool, est, s, admit) {
    const est2 = Object.assign({}, est, admit && admit.points != null ? { points: admit.points, requests: admit.requests } : {})
    return unsupported(tool, REFUSAL_REASONS.OVER_CAP, admit && admit.text ? admit.text : '这次调用超过了插件给 AI 工具设的硬顶，我没有动手。', {
      cost: { estimated: est2 },
      workspace: { root: s.cwd, key: s.workspaceKey },
    })
  }

  /**
   * 过闸选后端。这是每笔工具调用的第一次后端调用（matches 会真的去读工作区/问远端），
   * 所以它也过一次闸；结论原样交给调用方与 AI（包括「没有后端」与「还没定」两种情形）。
   */
  async function pickBackend(exec, s) {
    // 「会话 → 句柄」由接线方给（宿主知道这个工作区绑了哪个 refId / effortId）；没给时只用会话里的目录。
    const handle = (typeof d.handleFor === 'function') ? (d.handleFor(s) || { cwd: s.cwd }) : { cwd: s.cwd }
    let picked = null
    let failure = null
    let sent = null
    const t0 = now()
    try {
      sent = await gate.send({ source: 'tool.call', kind: 'probe', bucket: 'rest', workspaceKey: s.workspaceKey, plan: [{ phase: 'select' }] }, async () => {
        picked = await registry.select(handle, Object.assign({}, backendCtxNow(), { cwd: s.cwd, caller: DECK_TOOL_KIND }))
        return { requests: 1, points: 0 }
      })
    } catch (e) { failure = e }
    const ms = now() - t0
    if (failure) return { ok: false, reason: REFUSAL_REASONS.BACKEND_THREW, text: '选后端这一步的后端实现抛错了，我没往下做。', errorHash: hash8(String((failure && failure.message) || failure)) }
    if (!sent || sent.sent !== true) return { ok: false, reason: REFUSAL_REASONS.GATE_DEFER, text: '这一次选后端被闸推迟了（' + str(sent && sent.detail) + '），先不做。' }
    if (!picked || !picked.backendId) {
      const pending = picked && picked.pending
      return { ok: false, reason: REFUSAL_REASONS.NO_BACKEND, text: pending ? '后端还没定下来（自动识别有超时未决），先在面板上选一次后端。' : '这个工作区还没有后端（既没有手动选过，也没有识别到锚文件）。先在面板上选一个后端。' }
    }
    fire('deck.select', ms, true)
    return { ok: true, backendId: str(picked.backendId), source: str(picked.source), ref: picked.ref || null, pending: !!picked.pending, requests: num(sent.requests), points: num(sent.points) }
  }

  /** 由后端 id + 选出来的 ref 拿到一个可用的仓库身份（ref 缺字段时用后端 id 顶上，不造假名字）。 */
  function repoOf(pick, s) {
    const ref = pick.ref || {}
    return {
      backend: str(ref.backend) || str(pick.backendId),
      refId: str(ref.refId),
      name: str(ref.name),
      url: str(ref.url),
      effortId: ref.effortId,
      _cwd: s.cwd,
    }
  }

  /** 真去调后端实现的那一步：先过 admitAiTool（硬顶），再过 gate.send（记账），异常一律收成三态。 */
  async function call(meta, work) {
    const tool = meta.tool
    const s = meta.session
    const est = meta.estimate
    const admit = gate.admitAiTool({ points: est.points, requests: est.requests, childTickets: est.tickets }, { workspaceKey: s.workspaceKey, kind: 'tool-batch', bucket: 'graphql' })
    if (!admit.admitted) {
      fire(tool, 0, false, hash8(admit.reason))
      return refused(tool, est, s, admit)
    }
    let value = null
    let failure = null
    let sent = null
    const t0 = now()
    const ctx = {
      session: s,
      pick: meta.pick,
      repo: meta.repo,
      gate: gate,
      now: now,
      tracker: registry.get(meta.pick.backendId),
      opCtx: Object.assign({}, backendCtxNow(), { cwd: s.cwd, signal: undefined, caller: DECK_TOOL_KIND }),
      admit: admit,
    }
    try {
      sent = await gate.send({
        source: 'tool.call', kind: 'tool-batch', bucket: 'graphql', workspaceKey: s.workspaceKey, plan: [{ phase: meta.kind || 'op' }],
      }, async () => {
        const out = await work(ctx)
        value = (out && typeof out === 'object' && 'value' in out) ? out.value : out
        const claimed = (out && typeof out === 'object' && out.claimed) ? out.claimed : { requests: est.requests, points: est.points }
        return { requests: num(claimed.requests), points: num(claimed.points) }
      })
    } catch (e) { failure = e }
    const ms = now() - t0
    if (failure) {
      const eh = hash8(String((failure && failure.message) || failure))
      fire(tool, ms, false, eh)
      return unsupported(tool, REFUSAL_REASONS.BACKEND_THREW, '后端实现抛错了（我没有把它抛给 AI，按三态返回）：' + String((failure && failure.message) || failure).slice(0, 300), {
        workspace: { root: s.cwd, key: s.workspaceKey },
        backend: { id: meta.pick.backendId, source: meta.pick.source },
        errorHash: eh,
        cost: { estimated: est },
      })
    }
    if (!sent || sent.sent !== true) {
      fire(tool, ms, false, hash8('gate'))
      return unsupported(tool, REFUSAL_REASONS.GATE_DEFER, '这一次被闸推迟了（' + str(sent && sent.detail) + '），我没有动手。', {
        workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est },
      })
    }
    const failed = value && value.ok === false
    fire(tool, ms, !failed, failed ? hash8(str(value && value.reason)) : '')
    const out = envelope(tool, DECK_STATUS.OK, {
      workspace: { root: s.cwd, key: s.workspaceKey },
      backend: { id: meta.pick.backendId, source: meta.pick.source },
      repo: { backend: meta.repo.backend, refId: meta.repo.refId, name: meta.repo.name, url: meta.repo.url },
      cost: {
        estimated: { points: est.points, requests: est.requests, withinCallCap: est.withinCallCap, shards: est.shards, perShard: est.perShard, text: est.text },
        actual: { requests: num(sent.requests), points: num(sent.points), remaining: num(sent.remaining), tier: str(sent.tier) },
      },
    })
    return mergeOutcome(out, value, tool)
  }

  /** 把工具自己那份结果并进信封：状态、逐项、落点、写后失效缓存，都在这儿收口。 */
  function mergeOutcome(out, value, tool) {
    const v = (value && typeof value === 'object') ? value : {}
    out.status = str(v.status) || DECK_STATUS.OK
    out.ok = out.status === DECK_STATUS.OK
    out.reason = str(v.reason)
    out.text = str(v.text)
    out.data = v.data !== undefined ? v.data : null
    out.items = Array.isArray(v.items) ? v.items : []
    out.notes = Array.isArray(v.notes) ? v.notes : []
    out.readBack = v.readBack !== undefined ? v.readBack : null
    const touched = Array.isArray(v.touched) ? v.touched.filter((k) => typeof k === 'string' && k) : []
    out.touched = touched
    if (touched.length && typeof d.invalidate === 'function') {
      try { d.invalidate({ repo: out.repo, backendId: out.backend.id, keys: touched }) } catch (e) { /* 缓存失效失败不影响已经写成的结果 */ }
    }
    void tool
    return out
  }

  return {
    limits: limits,
    context: context,
    estimateFor: estimateFor,
    pickBackend: pickBackend,
    repoOf: repoOf,
    call: call,
    unsupported: unsupported,
    envelope: envelope,
    hash8: hash8,
    fire: fire,
  }
}
