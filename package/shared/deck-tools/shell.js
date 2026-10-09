// src/shared/deck-tools/shell.js —— 八个 deck_* 工具共用的薄壳机制（#713 第六批）
//
// 为什么住在 src/shared/ 而不是 src/host/tools/：仓库有一条同层互引门禁（tests/verify-no-same-layer-import.js），
// 同一个层里的文件之间不许互相引用。八个工具若各写一份「从会话上下文取工作区、过闸、三态返回、永不抛」，
// 同一套规则就会有八份；若让它们互相 import，门禁当场红。这个文件放在共享层，八个工具文件各自 import 它
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

// 会话目录取法只有 session-resolve.js 一份（九个工具全走它的 Async 版）；本文件曾有的同步复件已删，免得两份分叉。
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
 *   ensureReading 可选，动手前保剩余额度读数：ensureReading(cwd, workspaceKey)，缺席时跳过
 *   resolveTimeoutMs 可选，仓库标识补全等待上限毫秒数（缺席 8000，测试可调小）
 *   readChoice 可选，读本机记忆H：(规范根) => {backendId, rev} | null（缺席跳过H层）
 *   readWorkspaceFileText 可选，读工作区文件原文：(规范根) => string | null（缺席跳过文件层）
 *   parseWorkspaceFile 可选，解析文件文本（与 readWorkspaceFileText 同给同缺）
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

  // 闸口径迹（#758 干跑诊断用）：把每次裁决的机器码记进共享格，探针读走。
  // 只记阶段、结论、原因枚举，正文路径一律不记；口子缺席就跳过。
  function noteGate(phase, verdict, reason) {
    try { if (typeof d.noteGate === 'function') d.noteGate({ phase: phase, verdict: verdict, reason: reason }) } catch (eN) {}
  }

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
   * 动手前先保一次剩余额度读数（#758）：账本差读数时免费读一次，不差不打；
   * 保不住就照旧往下走，闸会诚实推迟——保读数永不代替裁决。
   */
  async function pickBackend(exec, s) {
    // 「会话 → 句柄」由接线方给（宿主知道这个工作区绑了哪个 refId / effortId）；没给时只用会话里的目录。
    const handle = (typeof d.handleFor === 'function') ? (d.handleFor(s) || { cwd: s.cwd }) : { cwd: s.cwd }
    let picked = null
    let failure = null
    let sent = null
    const t0 = now()
    try { if (typeof d.ensureReading === 'function') await d.ensureReading(s.cwd, s.workspaceKey) } catch (eR) {}
    // 显式三层（947：内存绑定 > 本机记忆H > 工作区文件）。缺席的口子跳过，未注册 id 忽略，
    // 显式无后端（null）落到 select 由注册表诚实判。判定收在闸内：每笔照旧过闸记账，不断 758 口径。
    const explicitId = async function () {
      try {
        const mem = (registry && typeof registry.bound === 'function') ? registry.bound(handle) : undefined
        if (typeof mem === 'string' && mem && typeof registry.has === 'function' && registry.has(mem)) return mem
      } catch (eM) {}
      try {
        if (typeof d.readChoice === 'function') {
          const h = await d.readChoice(s.cwd)
          if (h && typeof h.backendId === 'string' && h.backendId && typeof registry.has === 'function' && registry.has(h.backendId)) return h.backendId
        }
      } catch (eH) {}
      try {
        if (typeof d.readWorkspaceFileText === 'function' && typeof d.parseWorkspaceFile === 'function') {
          const parsed = d.parseWorkspaceFile(await d.readWorkspaceFileText(s.cwd))
          if (parsed && typeof parsed.backendId === 'string' && parsed.backendId && typeof registry.has === 'function' && registry.has(parsed.backendId)) return parsed.backendId
        }
      } catch (eF) {}
      return null
    }
    try {
      sent = await gate.send({ source: 'tool.call', kind: 'probe', bucket: 'rest', workspaceKey: s.workspaceKey, plan: [{ phase: 'select' }] }, async () => {
        const ex = await explicitId()
        if (ex) {
          let ref = null
          try { ref = registry.describe(handle, ex) } catch (eD) { ref = null }
          picked = { backendId: ex, source: 'explicit', ref: ref, pending: false }
        } else {
          picked = await registry.select(handle, Object.assign({}, backendCtxNow(), { cwd: s.cwd, caller: DECK_TOOL_KIND }))
        }
        return { requests: 1, points: 0 }
      })
    } catch (e) { failure = e }
    const ms = now() - t0
    if (failure) return { ok: false, reason: REFUSAL_REASONS.BACKEND_THREW, text: '选后端这一步的后端实现抛错了，我没往下做。', errorHash: hash8(String((failure && failure.message) || failure)) }
    if (!sent || sent.sent !== true) {
      noteGate('select', 'defer', str(sent && sent.reason))
      return { ok: false, reason: REFUSAL_REASONS.GATE_DEFER, text: '这一次选后端被闸推迟了（' + str(sent && sent.detail) + '），先不做。' }
    }
    // 仓库标识补全（#758）：匹配源常带空标识（注册表只认显式 refId），而房间读写真要它。
    // 有该能力的后端（房内 getRepoKey，三层兜底）调用方按通用形状自己补，不逐后端写分支；
    // 没有该能力的后端没有这一格，跳过，下游照旧诚实失败。补全本身也过一次闸（读探针一格）。
    if (picked && picked.backendId && (!picked.ref || !picked.ref.refId)) {
      try {
        const tracker = (registry && typeof registry.get === 'function') ? registry.get(picked.backendId) : null
        if (tracker && typeof tracker.getRepoKey === 'function') {
          const capMs = (typeof d.resolveTimeoutMs === 'number' && d.resolveTimeoutMs > 0) ? Math.floor(d.resolveTimeoutMs) : 8000
          let key = null
          let resolveSent = null
          try {
            resolveSent = await gate.send({ source: 'tool.call', kind: 'probe', bucket: 'rest', workspaceKey: s.workspaceKey, plan: [{ phase: 'resolve' }] }, async () => {
              try {
                key = await Promise.race([
                  Promise.resolve(tracker.getRepoKey(s.cwd, Object.assign({}, backendCtxNow(), { cwd: s.cwd, caller: DECK_TOOL_KIND }))),
                  new Promise(function (resolve) { setTimeout(function () { resolve(null) }, capMs) }),
                ])
              } catch (eResolve) { key = null }
              return { requests: 1, points: 0 }
            })
          } catch (eSend) { resolveSent = null }
          noteGate('resolve', resolveSent && resolveSent.sent === true ? 'allow' : 'defer', resolveSent && typeof resolveSent.reason === 'string' ? resolveSent.reason : '')
          if (resolveSent && resolveSent.sent === true && key && typeof key.owner === 'string' && key.owner && typeof key.name === 'string' && key.name) {
            const refId = key.owner + '/' + key.name
            picked.ref = { backend: picked.backendId, refId: refId, name: refId, url: 'https://github.com/' + refId }
          }
        }
      } catch (eR) {}
    }
    if (picked && picked.backendId && str(picked.source) !== 'explicit' && ((Array.isArray(picked.multiHit) && picked.multiHit.length > 1) || picked.pending)) { const mh = Array.isArray(picked.multiHit) && picked.multiHit.length > 1; return { ok: false, reason: REFUSAL_REASONS.NO_BACKEND, text: mh ? '这个工作区同时被 ' + picked.multiHit.length + ' 个后端认出，请在面板中选定后再试。' : '后端还没定下来，先在面板上选一次后端。' } }
    if (!picked || !picked.backendId) {
      const pending = picked && picked.pending
      return { ok: false, reason: REFUSAL_REASONS.NO_BACKEND, text: pending ? '后端还没定下来（自动识别有超时未决），先在面板上选一次后端。' : '这个工作区还没有后端（既没有手动选过，也没有识别到锚文件）。先在面板上选一个后端。' }
    }
    fire('deck.select', ms, true)
    noteGate('select', 'allow', '')
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
      noteGate('admit', 'refuse', str(admit.reason))
      return refused(tool, est, s, admit)
    }
    let value = null
    let failure = null
    let sent = null
    const t0 = now()
    const sbM = (meta && meta.sandbox && typeof meta.sandbox === 'object') ? meta.sandbox : {}; const sbPolicy = sbM.policy; const sbSessionId = (typeof sbM.sessionId === 'string' && sbM.sessionId) ? sbM.sessionId : str(s && s.sessionId)
    const ctx = {
      session: s,
      pick: meta.pick,
      repo: meta.repo,
      gate: gate,
      now: now,
      tracker: registry.get(meta.pick.backendId),
      opCtx: Object.assign({}, backendCtxNow(), { cwd: s.cwd, signal: undefined, caller: DECK_TOOL_KIND, sandboxPolicy: sbPolicy, sessionId: sbSessionId }),
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
      noteGate('op', 'defer', str(sent && sent.reason))
      return unsupported(tool, REFUSAL_REASONS.GATE_DEFER, '这一次被闸推迟了（' + str(sent && sent.detail) + '），我没有动手。', {
        workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est },
      })
    }
    const failed = value && value.ok === false
    fire(tool, ms, !failed, failed ? hash8(str(value && value.reason)) : '')
    noteGate('op', failed ? 'fail' : 'allow', failed ? str(value && value.reason) : '')
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
      // workspace 一起交给接线方：宿主那侧的缓存是按工作区目录存的（getCache/setCache 都按 cwd 分桶），
      // 只给 repo 与票号它认不出该作废哪一份快照。#723（T19c）实测踩过：少了这一格，宿主里的
      // 「写后失效缓存」这一步静默什么也没做（门禁断言当场抓住）。
      try { d.invalidate({ repo: out.repo, backendId: out.backend.id, keys: touched, workspace: out.workspace }) } catch (e) { /* 缓存失效失败不影响已经写成的结果 */ }
    }
    void tool
    return out
  }

  return {
    limits: limits,
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
