// verify-policy.js —— #706（T2）第一批：闸的裁决纯函数单测
// 用法：在插件根目录执行 node tests/verify-policy.js，可独立运行。
//
// 断言文字：裁决四条底线——① 人亲手做的动作永不降档；② AI 工具超单次/每小时硬顶必须被拒，
// 绝不静默放行；③ 后台类超出即推迟（不是失败）；④ 剩余额度到保底线时先拒 AI 那一档。
// 另断言三档降级顺序（先降「别处变化」的灵敏度，再降后台对账的频率，最后才动本地写入的即时性），
// 且四个档位的数值全部等于 budget.js 的常量本身（证明数字只有一个来源，没有在 policy.js 里重写一份）。
// 最后带一层「断言装置自检」：把裁决改坏成四种错法，同一套断言必须判红——门禁自己有牙齿。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

/** 从 budget.js 取一套裁决要用的数字（一处取值，两处使用：本门禁与 src/host/refresh/gate.js 同一形状）。 */
function limitsFromBudget(budget) {
  return {
    probeIntervalMs: budget.PROBE_INTERVAL_MS,
    probeIntervalYellowMs: budget.PROBE_INTERVAL_YELLOW_MS,
    reconcileIntervalMs: budget.RECONCILE_INTERVAL_MS,
    rebuildMinIntervalYellowMs: budget.REBUILD_MIN_INTERVAL_YELLOW_MS,
    aiToolMaxPointsPerCall: budget.AI_TOOL_MAX_POINTS_PER_CALL,
    aiToolMaxRequestsPerCall: budget.AI_TOOL_MAX_REQUESTS_PER_CALL,
    aiToolMaxPointsPerHour: budget.AI_TOOL_MAX_POINTS_PER_HOUR,
    aiToolMaxRequestsPerHour: budget.AI_TOOL_MAX_REQUESTS_PER_HOUR,
    failureBackoffMs: budget.CHAIN_BACKOFF_MS,
  }
}

/**
 * 四条底线写成一组场景。每个场景是一段返回布尔值的判定；
 * 参数 api 就是「被测的裁决」——真 policy.js 传真的进来，故意做坏的变体传坏的进来，
 * 同一套断言两边跑，这就是断言装置自检的做法。
 */
function scenarios(api) {
  const { budget, limits } = api
  // 一份「什么都有」的账：额度按 budget 的算式算出来，保底线用 budget.writeReserve（不吃字面量）。
  const allowance = budget.hourlyAllowance(budget.PLUGIN_HOURLY_CAP)
  const reserve = budget.writeReserve(allowance)
  const plenty = { allowance: allowance, used: 0, remaining: allowance, reserve: reserve }
  const broke = { allowance: allowance, used: allowance, remaining: reserve, reserve: reserve }
  const base = { quota: plenty, workspace: { active: true }, tier: 'green' }

  return [
    {
      id: '① 人亲手做的动作永不降档（红档 + 撞限流 + 余额到保底，仍然放行）',
      run() {
        const input = Object.assign({}, base, {
          category: 'user-action', kind: 'write', tier: 'red',
          quota: broke, workspace: { active: true, rateLimited: true, failuresSinceSuccess: 9 },
        })
        const r = api.decide(input)
        return r.verdict === 'allow' && !!api.REASONS[r.reason]
      },
    },
    {
      id: '② AI 工具超单次硬顶必须被拒（不是推迟、更不是放行）',
      run() {
        const r = api.aiToolAdmission(
          { points: limits.aiToolMaxPointsPerCall + 1, requests: 1 },
          { points: 0, requests: 0 }, plenty, limits)
        return r.admitted === false && r.reason === 'ai-tool-over-call-cap' && r.points === limits.aiToolMaxPointsPerCall + 1
      },
    },
    {
      id: '②b AI 工具超单次请求数硬顶必须被拒',
      run() {
        const r = api.aiToolAdmission(
          { points: 1, requests: limits.aiToolMaxRequestsPerCall + 1 },
          { points: 0, requests: 0 }, plenty, limits)
        return r.admitted === false && r.reason === 'ai-tool-over-call-cap'
      },
    },
    {
      id: '②c AI 工具把这一小时的累计顶过去必须被拒（点数与请求数各一条）',
      run() {
        const overPoints = api.aiToolAdmission({ points: 2, requests: 1 }, { points: limits.aiToolMaxPointsPerHour - 1, requests: 0 }, plenty, limits)
        const overRequests = api.aiToolAdmission({ points: 2, requests: 1 }, { points: 0, requests: limits.aiToolMaxRequestsPerHour }, plenty, limits)
        return overPoints.admitted === false && overPoints.reason === 'ai-tool-over-hour-cap' &&
          overRequests.admitted === false && overRequests.reason === 'ai-tool-over-hour-cap'
      },
    },
    {
      id: '②d 正好卡在硬顶上的那一笔放行（上限是「不超过」，不是「小于」）',
      run() {
        const r = api.aiToolAdmission(
          { points: limits.aiToolMaxPointsPerCall, requests: limits.aiToolMaxRequestsPerCall },
          { points: 0, requests: 0 }, plenty, limits)
        return r.admitted === true && r.reason === 'ai-tool-within-caps'
      },
    },
    {
      id: '③ 后台类超出即推迟：黄档整池重建、红档探测、非活跃工作区探测、读额度花到保底',
      run() {
        const yellowRebuild = api.decide(Object.assign({}, base, { category: 'background', kind: 'rebuild', tier: 'yellow' }))
        const redProbe = api.decide(Object.assign({}, base, { category: 'background', kind: 'probe', tier: 'red' }))
        const idleProbe = api.decide(Object.assign({}, base, { category: 'background', kind: 'probe', workspace: { active: false } }))
        const reserveHit = api.decide(Object.assign({}, base, { category: 'background', kind: 'probe', quota: broke }))
        return yellowRebuild.verdict === 'defer' && yellowRebuild.reason === 'background-tier-yellow' &&
          redProbe.verdict === 'defer' && redProbe.reason === 'background-tier-red' &&
          idleProbe.verdict === 'defer' && idleProbe.reason === 'background-inactive' &&
          reserveHit.verdict === 'defer' && reserveHit.reason === 'reserve-kept-for-writes'
      },
    },
    {
      id: '③b 后台额度够时照常放行；推迟只在超出与降档时发生',
      run() {
        const ok = api.decide(Object.assign({}, base, { category: 'background', kind: 'probe' }))
        const okRebuild = api.decide(Object.assign({}, base, { category: 'background', kind: 'rebuild' }))
        return ok.verdict === 'allow' && ok.reason === 'background-fits' &&
          okRebuild.verdict === 'allow' && okRebuild.reason === 'background-fits'
      },
    },
    {
      id: '④ 剩余额度到保底线时先拒 AI 那一档（绝不挤掉插件刷新与人的动作）',
      run() {
        const atReserve = api.aiToolAdmission({ points: 1, requests: 1 }, { points: 0, requests: 0 }, broke, limits)
        const justAbove = api.aiToolAdmission({ points: 1, requests: 1 }, { points: 0, requests: 0 },
          { allowance: allowance, used: 0, remaining: reserve + 1, reserve: reserve }, limits)
        return atReserve.admitted === false && atReserve.reason === 'ai-tool-below-remaining' && justAbove.admitted === true
      },
    },
    {
      id: '⑤ 三档降级顺序：先降灵敏度；黄档后台刷新全停；本地写入的即时性任何档都不动',
      run() {
        const green = api.degradePlanFor('green', limits)
        const yellow = api.degradePlanFor('yellow', limits)
        const red = api.degradePlanFor('red', limits)
        return green.probeIntervalMs === budget.PROBE_INTERVAL_MS &&
          green.reconcileIntervalMs === budget.RECONCILE_INTERVAL_MS &&
          yellow.probeIntervalMs === budget.PROBE_INTERVAL_YELLOW_MS &&
          yellow.reconcileIntervalMs === null && yellow.rebuildMinGapMs === budget.REBUILD_MIN_INTERVAL_YELLOW_MS &&
          red.probeIntervalMs === null && red.reconcileIntervalMs === null &&
          green.localWriteImmediate === true && yellow.localWriteImmediate === true && red.localWriteImmediate === true &&
          api.DEGRADE_ORDER[0] === 'probe-sensitivity' && api.DEGRADE_ORDER[1] === 'reconcile-frequency' &&
          api.DEGRADE_ORDER[2] === 'local-write-latency'
      },
    },
    {
      id: '⑥ 生命周期那一次降级为「只出缓存 + 只探测不重建」，不是失败',
      run() {
        const r = api.decide(Object.assign({}, base, { category: 'lifecycle', kind: 'rebuild', tier: 'red' }))
        return r.verdict === 'degrade' && r.reason === 'lifecycle-cache-only'
      },
    },
  ]
}

/** 跑一遍场景，返回没过的场景 id（真裁决应当是空数组）。 */
function failuresOf(api) {
  const out = []
  for (const s of scenarios(api)) {
    let ok = false
    try { ok = s.run() === true } catch (e) { ok = false; console.log('    [诊断] ' + s.id + ' 抛异常：' + (e && e.message)) }
    if (!ok) out.push(s.id)
  }
  return out
}

async function main() {
  console.log('闸裁决门禁（#706 T2：四条底线 + 三档降级顺序 + 断言装置自检）')

  const budget = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'budget.js')).href)
  const policy = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'policy.js')).href)
  const limits = limitsFromBudget(budget)

  check(policy.POLICY_SOURCE === 'refresh-core/src/policy.ts', '产物带模块标识 POLICY_SOURCE（来自 refresh-core/src/policy.ts）')
  check(Array.isArray(policy.REQUEST_KINDS) && policy.REQUEST_KINDS.length >= 8, '请求种类表在（' + policy.REQUEST_KINDS.length + ' 种）')
  check(typeof policy.decide === 'function' && typeof policy.aiToolAdmission === 'function' && typeof policy.degradePlanFor === 'function',
    '三个裁决函数都在（decide / aiToolAdmission / degradePlanFor）')

  // 真实裁决跑一遍：四条底线与降级顺序全部要过。
  const real = Object.assign({}, policy, { budget: budget, limits: limits })
  const realFailures = failuresOf(real)
  check(realFailures.length === 0, '真实裁决全部场景通过' + (realFailures.length ? ' —— 没过：' + realFailures.join('；') : '（' + scenarios(real).length + ' 个场景）'))

  // 原因代号只能是 policy.js 那张表里的取值（日志与界面靠它说话）。
  const usedReasons = new Set()
  // 一份「什么都有」的账：与 scenarios() 里那份同形——额度按 budget 的算式算，保底线不吃字面量。
  const allowanceForProbe = budget.hourlyAllowance(budget.PLUGIN_HOURLY_CAP)
  const plenty = {
    allowance: allowanceForProbe,
    used: 0,
    remaining: allowanceForProbe,
    reserve: budget.writeReserve(allowanceForProbe),
  }
  const probeInputs = [
    { category: 'background', kind: 'probe' }, { category: 'background', kind: 'rebuild' },
    { category: 'user-action', kind: 'write' }, { category: 'lifecycle', kind: 'probe' },
    { category: 'ai-tool', kind: 'tool-batch' }, { category: 'background', kind: 'quota-read' },
  ]
  for (const p of probeInputs) {
    for (const tier of ['green', 'yellow', 'red']) {
      usedReasons.add(policy.decide(Object.assign({ quota: plenty, workspace: { active: true }, tier: tier }, p)).reason)
    }
  }
  const unknown = Array.from(usedReasons).filter((r) => !policy.REASONS[r])
  check(unknown.length === 0, '原因代号都能在 REASONS 表里查到（实得 ' + usedReasons.size + ' 种）' + (unknown.length ? ' —— 表里没有：' + unknown.join('、') : ''))

  // 断言装置自检：把裁决改坏成四种错法，同一套场景必须判红。
  const broken = [
    { name: '永远放行（后台超出不推迟）', api: Object.assign({}, real, { decide: function () { return { verdict: 'allow', reason: 'background-fits' } } }) },
    { name: '连人的动作也降档', api: Object.assign({}, real, { decide: function (i) { return i.category === 'user-action' ? { verdict: 'defer', reason: 'background-tier-red' } : policy.decide(i) } }) },
    { name: 'AI 工具超顶静默放行', api: Object.assign({}, real, { aiToolAdmission: function (c) { return { admitted: true, reason: 'ai-tool-within-caps', points: c.points, requests: c.requests } } }) },
    { name: 'AI 工具不看剩余额度保底线', api: Object.assign({}, real, { aiToolAdmission: function (c, h, q, l) { return q.remaining <= q.reserve ? { admitted: true, reason: 'ai-tool-within-caps', points: c.points, requests: c.requests } : policy.aiToolAdmission(c, h, q, l) } }) },
  ]
  for (const b of broken) {
    const caught = failuresOf(b.api)
    check(caught.length > 0, '断言装置自检：' + b.name + ' —— 必须判红' + (caught.length ? '（被这几条逮住：' + caught.map((c) => c.slice(0, 4)).join('、') + '）' : '（一条都没逮住，说明断言没牙齿）'))
  }

  console.log(failed ? '\n存在失败 — verify-policy 未通过' : '\n全部通过 — 裁决门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
