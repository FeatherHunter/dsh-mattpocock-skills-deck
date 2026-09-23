// src/host/refresh/gate.js —— 刷新机制的唯一出口闸（#706 T2 第二批）
//
// 依据：定稿第三章「三层 + 一道闸」与第四章第 01 件。它回答的只有一句：这一笔去 GitHub 的调用，
// 现在放行、降级，还是推迟？放行之后再记一笔真实花费。裁决本身一行都不在这里 —— 它调
// refresh-core 那份纯函数产物 policy.js（第一批的成果），数字全部从 budget.js 取好注入进去。
// 这两个 import 是「只许复用、不许再写一份」的落地方式：本文件里没有一条裁决规则、没有一个额度数字。
//
// 这个文件守住五件事（票面点名的五条硬要求，逐条对应下面一段代码）：
//   1. **唯一出口**：发给 GitHub 的每一笔都从这里过。分类（人的动作 / 生命周期 / 后台 / AI 工具）、
//      记账、裁决、推迟队列四件事都在这里做；静态扫描门禁（tests/verify-gh-gateway.js）扫整个 src，
//      要求每一个能起 gh 进程的调用点都登记在册 —— 新写一条绕开闸的路会判红。
//   2. **记账单位是真实出站 HTTP 请求数**：调用方报几条、传输层真发几条，两个数各自记在账上并当场对账；
//      分页、重试、兜底链、扇出都要算进去，所以闸不认「逻辑上一次调用」这个说法。
//   3. **扇出排队，不并行发**：一次 send 里的多步（翻页、兜底链、批量）排成一队逐条发；
//      同时来的多次 send 也在同一条队上 —— 并发数恒为 1。
//   4. **推迟 ≠ 失败**：被推迟的请求进推迟队列，同一个工作区只留最后一次（多次合并成一次），
//      5 分钟（budget.js 的 DEFER_EXPIRY_MS）过期即丢；过期丢弃不算失败、不计入连续失败次数，
//      下一条请求照常走。失败才会被数进 workspace.failuresSinceSuccess，由裁决那侧安排退避。
//   5. **运行期漏网计数**：传输层每真发一条就报一次（noteOutbound），闸自己记的是「经过裁决的那几笔」，
//      两者之差就是绕开闸发出去的条数（escaped()）。这个数不为 0 就说明有人偷偷发了请求。
//
// 二级限流（Retry-After）也是降档信号：noteRetryAfter() 一次就把所在桶按红档处理（主桶没用完也降档），
// 并把那个工作区标成撞限流 —— 裁决那侧对它的处置是「后台停、生命周期降级、人的动作照做」。
import { decide, aiToolAdmission, degradePlanFor, REQUEST_KINDS, REASONS } from '../../shared/refresh/policy.js'
import * as budget from '../../shared/refresh/budget.js'

/** 四个类别（谁在做事）。与 policy.js 的 RequestCategory 同一套取值。 */
export const GATE_CATEGORIES = ['user-action', 'lifecycle', 'background', 'ai-tool']

/** 类别 → 记哪一档账。插件自己的刷新（后台与生命周期）记一档，人的动作与 AI 工具各记一档。 */
export const ACCOUNT_OF_CATEGORY = { 'user-action': 'user-action', 'lifecycle': 'plugin', 'background': 'plugin', 'ai-tool': 'ai-tool' }

/**
 * 调用点 → 类别。分类是本闸的第一件事：以后新加一个取数功能，先在这里给它一个身份，
 * 拿不到身份的按「后台」算（最先被牺牲的那一档，是最保守的兜底），并计入 stats().unclassified 让人看见。
 */
export const CALL_SITE_CATEGORIES = {
  'panel.refresh': 'user-action',      // 面板上的刷新按钮
  'panel.detail': 'user-action',       // 点开一张票、翻一页评论
  'panel.write': 'user-action',        // 发评论、认领、改标签、关闭、建票
  'workspace.enter': 'lifecycle',      // 切进一个工作区那一次（缓存先铺满，再补探）
  'workspace.linger': 'background',    // 刚离开 30 秒内的收尾节拍
  'probe.tick': 'background',          // 变化探测（活跃工作区那一下）
  'patch.apply': 'background',         // 行级补行（只取变的那几条）
  'reconcile.tick': 'background',      // 每 10 分钟一次的整池对账
  'chain.eval': 'background',          // 检查链求值（已改成事件驱动）
  'naming.sweep': 'background',        // 命名守护的兜底一跳
  'quota.sync': 'background',          // 每分钟读一次服务端剩余（不扣配额，但仍是真实出站）
  'tool.call': 'ai-tool',              // AI 通过我们的工具发起的调用
}

/** 请求种类 → 记哪一个桶。REST 数请求条数、GraphQL 数点数，两桶各自一份额度与档位。 */
export const BUCKET_OF_KIND = {
  'quota-read': 'rest', probe: 'rest', detail: 'rest', preflight: 'rest', chain: 'rest',
  naming: 'rest', write: 'rest', patch: 'graphql', rebuild: 'graphql', reconcile: 'graphql', 'tool-batch': 'graphql',
}

/** 从 budget.js 取一套裁决要用的数字（形状与 tests/verify-policy.js 里那份一致，两处同源）。 */
export function policyLimits(src) {
  const b = src || budget
  return {
    probeIntervalMs: b.PROBE_INTERVAL_MS,
    probeIntervalYellowMs: b.PROBE_INTERVAL_YELLOW_MS,
    reconcileIntervalMs: b.RECONCILE_INTERVAL_MS,
    rebuildMinIntervalYellowMs: b.REBUILD_MIN_INTERVAL_YELLOW_MS,
    aiToolMaxPointsPerCall: b.AI_TOOL_MAX_POINTS_PER_CALL,
    aiToolMaxRequestsPerCall: b.AI_TOOL_MAX_REQUESTS_PER_CALL,
    aiToolMaxPointsPerHour: b.AI_TOOL_MAX_POINTS_PER_HOUR,
    aiToolMaxRequestsPerHour: b.AI_TOOL_MAX_REQUESTS_PER_HOUR,
    failureBackoffMs: b.CHAIN_BACKOFF_MS,
  }
}

/** 调用点 → 类别；给了类别就直接用它（校验取值）。两者都没有的按「后台」算，并计入漏分类计数。 */
export function classify(source, explicitCategory) {
  if (explicitCategory) {
    if (GATE_CATEGORIES.indexOf(explicitCategory) < 0) throw new Error('没有这个类别：' + String(explicitCategory))
    return { category: explicitCategory, known: true }
  }
  const hit = CALL_SITE_CATEGORIES[String(source)]
  if (hit) return { category: hit, known: true }
  return { category: 'background', known: false }
}

function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0 }

/** 报数归一：调用方可以只回一个数字（请求条数），也可以回 { requests, points }。 */
function readReport(report) {
  if (typeof report === 'number') return { requests: report, points: 0 }
  const r = report || {}
  return { requests: num(r.requests), points: num(r.points) }
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
 * 建一道闸。deps: { ledger, logCtx?, now?, hash8? }。
 * ledger 是本目录的账本（ledger.js）—— 两个文件不互相 import：宿主接线的时候把它们拼起来，
 * 闸只按形状用它（view / spend / noteRateLimited / hourOf / syncDue）。
 */
export function createGate(deps) {
  const opts = deps || {}
  const ledger = opts.ledger
  if (!ledger || typeof ledger.view !== 'function' || typeof ledger.spend !== 'function') {
    throw new Error('闸要一本账：deps.ledger 缺 view / spend 这两条')
  }
  const now = typeof opts.now === 'function' ? opts.now : Date.now
  const logCtx = opts.logCtx || null
  const hash8 = typeof opts.hash8 === 'function' ? opts.hash8 : shortHash
  const limits = policyLimits(opts.budget)

  const workspaces = new Map()   // 工作区键 → { active, failuresSinceSuccess, rateLimitedUntil }
  const deferred = new Map()     // 工作区键 → { req, category, kind, bucket, at }
  const stats = {
    accounted: { requests: 0, points: 0 },   // 闸记下来的（= 传输层真发的）
    transport: { requests: 0, points: 0 },   // 传输层报上来的（真发出去几条）
    claimed: { requests: 0, points: 0 },     // 调用方自己报的数（用来对账）
    mismatch: 0,                             // 报数与真发数对不上的次数
    sent: 0, deferred: 0, coalesced: 0, droppedExpired: 0, retryAfter: 0, unclassified: 0,
  }
  let queue = Promise.resolve()   // 扇出与并发都在这一条队上（并发数恒为 1）
  const byCategory = {}
  for (const c of GATE_CATEGORIES) byCategory[c] = 0

  function wsState(key) {
    let s = workspaces.get(key)
    if (!s) { s = { active: false, failuresSinceSuccess: 0, rateLimitedUntil: 0 }; workspaces.set(key, s) }
    return s
  }

  function workspaceView(key) {
    const s = wsState(key)
    return { active: !!s.active, failuresSinceSuccess: s.failuresSinceSuccess, rateLimited: s.rateLimitedUntil > now() }
  }

  /** 裁决的输入：类别 + 种类 + 桶的档位与账 + 工作区状态。 */
  function inputFor(req) {
    const bucket = req.bucket
    const q = ledger.view(bucket)
    const s = wsState(req.workspaceKey)
    return {
      category: req.category, kind: req.kind, tier: q.tier,
      quota: { allowance: q.allowance, used: q.used, remaining: q.remaining, reserve: q.reserve },
      workspace: { active: !!s.active, failuresSinceSuccess: s.failuresSinceSuccess, rateLimited: s.rateLimitedUntil > now() },
    }
  }

  // 账本三个事件之一（按需级 P1）：这一笔的结论与原因。外层先判调试开关，关着连字段对象都不组装。
  function fireDecide(req, verdict, reason, tier) {
    try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'refresh.decide', { category: req.category, kind: req.kind, verdict: verdict, reason: reason, tier: tier }) } catch (eL) {}
  }

  // 账本三个事件之一（按需级 P1）：被跳过的那些（后台档被推迟、额度不足、过期丢弃）。
  function fireSkipped(key, kind, reason, pending) {
    try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'refresh.skipped', { keyHash: hash8(key), kind: kind, reason: reason, pending: pending }) } catch (eL) {}
  }

  /** 只看结论不发送（界面与门禁都要能用同一套裁决问一句）。 */
  function decideFor(req) {
    const r = normalize(req)
    return decide(inputFor(r))
  }

  function normalize(req) {
    const r = req || {}
    const cls = classify(r.source, r.category)
    if (!cls.known) stats.unclassified += 1
    const kind = REQUEST_KINDS.indexOf(r.kind) >= 0 ? r.kind : 'probe'
    const bucket = (r.bucket === 'graphql' || r.bucket === 'rest') ? r.bucket : (BUCKET_OF_KIND[kind] || 'rest')
    return { source: r.source, category: cls.category, kind: kind, bucket: bucket, workspaceKey: String(r.workspaceKey || 'unknown'), plan: Array.isArray(r.plan) && r.plan.length ? r.plan : [{}] }
  }

  /** 一次 send 的整段（多步逐条发）排在同一条队上：并发数恒为 1，扇出永远不并行。 */
  function enqueue(fn) {
    const run = queue.then(() => fn())
    queue = run.then(() => {}, () => {})
    return run
  }

  /**
   * 真发一步：先问传输层「你在我动手之前发了几条」，动完手再问一次，差就是这一步的真花费。
   * 快照与动手都在同一条队上（不然并发的另一次 send 会把它的条数算进这一步）。
   * 失败也照样记账 —— 发出去的那几条就是已经花掉的额度，账不许因为失败就不记（I6）。
   */
  async function runStep(req, step, perform) {
    let actual = { requests: 0, points: 0 }
    let reported = { requests: 0, points: 0 }
    let failure = null
    await enqueue(async function () {
      const before = { requests: stats.transport.requests, points: stats.transport.points }
      try { reported = readReport(await perform(step, { category: req.category, kind: req.kind, bucket: req.bucket })) } catch (e) { failure = e }
      actual = { requests: stats.transport.requests - before.requests, points: stats.transport.points - before.points }
    })
    stats.claimed.requests += reported.requests
    stats.claimed.points += reported.points
    if (reported.requests !== actual.requests || reported.points !== actual.points) stats.mismatch += 1
    // 账记的是真发出去的那几条（传输层说了算），不是调用方报的数；报到哪儿去由账本按档与桶分开记。
    stats.accounted.requests += actual.requests
    stats.accounted.points += actual.points
    const account = ACCOUNT_OF_CATEGORY[req.category] || 'plugin'
    const after = ledger.spend({ account: account, bucket: req.bucket, kind: req.kind, requests: actual.requests, points: actual.points })
    if (failure) { wsState(req.workspaceKey).failuresSinceSuccess += 1; throw failure }
    wsState(req.workspaceKey).failuresSinceSuccess = 0
    return { requests: actual.requests, points: actual.points, claimed: reported, remaining: after.remaining, tier: after.tier }
  }

  /**
   * 闸的唯一出口。req: { source|category, kind, bucket?, workspaceKey?, plan? }；perform(step) 真去发请求
   * 并**每条真实出站都先报一次 noteOutbound**，返回值是它自己报的花费（会被拿来实现对账）。
   */
  async function send(req, perform) {
    const r = normalize(req)
    const v = decide(inputFor(r))
    fireDecide(r, v.verdict, v.reason, ledger.view(r.bucket).tier)
    byCategory[r.category] = (byCategory[r.category] || 0) + 1
    if (v.verdict === 'defer') {
      const prev = deferred.get(r.workspaceKey)
      if (prev) stats.coalesced += 1
      deferred.set(r.workspaceKey, { req: r, category: r.category, kind: r.kind, bucket: r.bucket, at: now() })
      stats.deferred += 1
      fireSkipped(r.workspaceKey, r.kind, v.reason, deferred.size)
      return { sent: false, verdict: 'defer', reason: v.reason, detail: REASONS[v.reason] || '', requests: 0, points: 0 }
    }
    if (typeof perform !== 'function') throw new Error('闸放行了却没有发送函数：' + r.kind)
    let requests = 0
    let points = 0
    let remaining = 0
    let tier = 'green'
    for (const step of r.plan) {
      const out = await runStep(r, step, perform)
      requests += out.requests
      points += out.points
      remaining = out.remaining
      tier = out.tier
    }
    stats.sent += 1
    return { sent: true, verdict: v.verdict, reason: v.reason, detail: REASONS[v.reason] || '', requests: requests, points: points, remaining: remaining, tier: tier, steps: r.plan.length }
  }

  /** 传输层每真发一条就报一次（生产里挂在起 gh 进程那一层）。绕开闸发的那几条就靠它露出来。 */
  function noteOutbound(entry) {
    const e = entry || {}
    const requests = num(e.requests) || 1
    const points = num(e.points)
    stats.transport.requests += requests
    stats.transport.points += points
    return { requests: stats.transport.requests, points: stats.transport.points }
  }

  /** 撞上限流（含二级限流的 Retry-After）：桶降档 + 工作区标记 + 计数。 */
  function noteRetryAfter(signal) {
    const s = signal || {}
    const r = normalize(s)
    const at = ledger.noteRateLimited(r.bucket, s.seconds, now())
    if (s.workspaceKey) wsState(r.workspaceKey).rateLimitedUntil = Math.max(wsState(r.workspaceKey).rateLimitedUntil, at.until)
    stats.retryAfter += 1
    return { bucket: r.bucket, until: at.until, tier: ledger.view(r.bucket).tier }
  }

  /** 推迟队列：到期的交回调用方重发，过期（5 分钟）的直接丢 —— 丢不是失败，也不重试。 */
  function drain(at) {
    const t = (typeof at === 'number') ? at : now()
    const ready = []
    let dropped = 0
    for (const [key, e] of Array.from(deferred.entries())) {
      deferred.delete(key)
      if ((t - e.at) >= budget.DEFER_EXPIRY_MS) { dropped += 1; stats.droppedExpired += 1; fireSkipped(key, e.kind, 'defer-expired', deferred.size) }
      else ready.push({ workspaceKey: key, req: e.req, ageMs: t - e.at })
    }
    return { ready: ready, dropped: dropped, pending: deferred.size }
  }

  /** AI 工具那一档的准入：超顶是「拒绝」，不是推迟；两种拒绝的文案必须分得开。 */
  function admitAiTool(call, req) {
    const r = normalize(Object.assign({ source: 'tool.call' }, req, { category: 'ai-tool' }))
    const q = ledger.view(r.bucket)
    const hour = ledger.hourOf('ai-tool')
    const quota = { allowance: q.allowance, used: q.used, remaining: q.remaining, reserve: q.reserve }
    const a = aiToolAdmission({ points: num(call.points), requests: num(call.requests) }, hour, quota, limits)
    const children = num(call.childTickets)
    const plan = children > 0 ? budget.shardPlan(children) : { shards: 1, perShard: budget.AI_TOOL_SHARD_SIZE }
    fireDecide(r, a.admitted ? 'allow' : 'reject', a.reason, q.tier)
    if (!a.admitted) fireSkipped(r.workspaceKey, 'tool-batch', a.reason, deferred.size)
    return {
      admitted: a.admitted,
      reason: a.reason,
      points: a.points,
      requests: a.requests,
      remaining: q.remaining,
      shards: plan.shards,
      perShard: plan.perShard,
      text: a.admitted ? '' : refusalText(a, q, hour, plan),
    }
  }

  /**
   * 拒绝时回给 AI 的那句话。两种原因必须分得开（票面硬要求）：
   * ①「我花超了」——超过插件自己给工具设的单次或每小时硬顶，是自限，不是别人抢了额度；
   * ②「额度被别人用掉了」——剩余额度已到保底线，会话里别的 GitHub 调用把额度吃掉了，
   *   这时先拒 AI 工具写入，绝不挤掉插件刷新与人的动作。
   */
  function refusalText(a, q, hour, plan) {
    const cap = (a.reason === 'ai-tool-over-call-cap' || a.reason === 'ai-tool-over-hour-cap')
    const head = cap
      ? '这次调用超过了插件给 AI 工具设的自己那道硬顶（额度没被别人用掉，是这一笔太大或这一小时攒太多了）'
      : '剩余额度已经到保底线，额度是被别人用掉的（会话里别的 GitHub 调用先花了）：先拒 AI 工具写入'
    return head + '。这次预计花 ' + a.points + ' 点、' + a.requests + ' 条出站请求；本小时 AI 工具已用 ' +
      hour.points + ' 点、' + hour.requests + ' 条；这一桶现在还剩 ' + q.remaining + ' 点。建议分 ' +
      plan.shards + ' 次调用，每片不超过 ' + plan.perShard + ' 张票（单次硬顶 ' + limits.aiToolMaxPointsPerCall + ' 点 / ' +
      limits.aiToolMaxRequestsPerCall + ' 条，每小时 ' + limits.aiToolMaxPointsPerHour + ' 点 / ' + limits.aiToolMaxRequestsPerHour + ' 条）。'
  }

  /** 某个桶现在的降档安排（探测节拍、对账节拍、最短重建间隔），数值全部来自 budget.js。 */
  function planOf(bucketName) {
    return degradePlanFor(ledger.view(bucketName || 'rest').tier, limits)
  }

  /** 运行期漏网计数：传输层真发的条数减去闸记下来的条数。不为 0 就说明有人绕开了闸。 */
  function escaped() {
    return {
      requests: stats.transport.requests - stats.accounted.requests,
      points: stats.transport.points - stats.accounted.points,
    }
  }

  return {
    send: send,
    decideFor: decideFor,
    planOf: planOf,
    admitAiTool: admitAiTool,
    noteOutbound: noteOutbound,
    noteRetryAfter: noteRetryAfter,
    drain: drain,
    escaped: escaped,
    stats: function () {
      return {
        accounted: { requests: stats.accounted.requests, points: stats.accounted.points },
        transport: { requests: stats.transport.requests, points: stats.transport.points },
        claimed: { requests: stats.claimed.requests, points: stats.claimed.points },
        escaped: escaped(), mismatch: stats.mismatch, sent: stats.sent, deferred: stats.deferred,
        coalesced: stats.coalesced, droppedExpired: stats.droppedExpired, retryAfter: stats.retryAfter,
        unclassified: stats.unclassified, byCategory: Object.assign({}, byCategory), pending: deferred.size,
      }
    },
    workspaceView: workspaceView,
    setWorkspace: function (key, patch) {
      const s = wsState(String(key))
      if (patch && typeof patch.active === 'boolean') s.active = patch.active
      return workspaceView(String(key))
    },
  }
}
