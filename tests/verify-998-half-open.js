// verify-998-half-open.js —— 门禁：连续失败那把「自锁」必须留一个出口（#998，2026-10-10 真机故障）
// 用法：在插件根目录执行 node tests/verify-998-half-open.js，可独立运行。
//
// 真机故障是什么（2026-10-10 实测，见票 #998）：闸对「连续失败」的处置是「到门槛就一律推迟」，
// 而推迟既不算失败、也不算成功 —— 连续失败计数只有「真跑成功一次」才归零（gate.js 里唯一那处归零）。
// 于是形成了自己能维持自己的死锁：
//   计数到了门槛 → 谁都进不来 → 既然谁都进不来，就永远不会有成功把计数归零 → 还是谁都进不来。
// 真机上的样子：同一个工作区里 deck_ 开头的工具全部回「连续失败到了退避门槛」，
// 而同一时刻 gh 已经恢复到 1 秒一条、全成功；一直到人重启进程才活过来。
//
// 本文件逐条钉住修法（纯逻辑，不起进程、不出网）：
//   ① 走到门槛之后确实会锁住（先复现故障，免得把「没锁」误当修好了）；
//   ② 退避走完一整轮之后，放一笔探针进来试一次；这一笔试成功 → 锁当场开；
//   ③ 探针失败 → 等待时长按退避序列往上走一档，不连环重试（I5 不许有风暴）；
//   ④ 探针「在飞」这段时间不许再放第二笔进来（时间戳在放行那一刻就盖掉）；
//   ⑤ 推迟过的那些调用一笔都不许往计数上加（推迟不等于失败）；
//   ⑥ 没接这一格的地方（没给时刻 / 没给窗口起点）行为与从前完全一样：一律推迟；
//   ⑦ 人的动作与「读额度」这两档不受影响（它们的判定排在连续失败前面）；
//   ⑧ 工作区视图如实带出「窗口起点」（面板与门禁读的就是它）。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

async function main() {
  console.log('闸的连续失败出口门禁（#998：到门槛必须留一笔探针，不许自锁）')
  const budget = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'budget.js')).href)
  const ledgerMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'refresh', 'ledger.js')).href)
  const gateMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'refresh', 'gate.js')).href)
  const policy = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'policy.js')).href)

  let clock = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => clock })
  const gate = gateMod.createGate({ ledger: ledger, now: () => clock })
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + budget.HOUR_MS }, graphql: { limit: 5000, remaining: 5000, reset: clock + budget.HOUR_MS } }, clock)

  const HOUR_MS = budget.HOUR_MS
  // 到了门槛之后要等多久才放探针：退避序列里「第 n 次失败」那一档，再加一整轮之后额外等的那一段。
  // 这个算式就是 policy.js 的 nextAttemptDelayMs + limits.failureHalfOpenDelayMs，测试这边照同一口径拼。
  const waitFor = (n) => budget.CHAIN_BACKOFF_MS[Math.min(n - 1, budget.CHAIN_BACKOFF_MS.length - 1)] + budget.FAILURE_HALF_OPEN_DELAY_MS
  const send = (key, kind, perform) => gate.send({ source: 'tool.call', kind: kind || 'probe', workspaceKey: key, plan: [{ phase: 'op' }] }, perform)
  const failOnce = (key, kind) => send(key, kind, () => { throw new Error('模拟一次真失败') }).then(() => false, () => true)

  // ---------- ① 先复现故障：走到门槛就锁住 ----------
  const ws = 'ws-locked'
  gate.setWorkspace(ws, { active: true })
  for (let i = 0; i < 3; i++) await failOnce(ws)
  const v0 = gate.workspaceView(ws)
  check(v0.failuresSinceSuccess >= policy.FAILURE_DEFER_AT, '连续失败 3 次之后计数到了门槛（实得 ' + v0.failuresSinceSuccess + '）')
  const locked = await send(ws, 'probe', () => { throw new Error('不该真跑') })
  check(locked.sent === false && locked.reason === 'failure-backoff', '门槛刚过就调用：被推开且原因是 failure-backoff（实得 ' + locked.reason + '）')
  clock += 60_000
  const stillLocked = await send(ws, 'probe', () => { throw new Error('不该真跑') })
  check(stillLocked.sent === false && stillLocked.reason === 'failure-backoff', '只过了 1 分钟：还是被推开（旧实现在这里会一直推下去）')

  // ---------- ② 退避走完一整轮之后放一笔进来，成功即解锁 ----------
  clock += waitFor(3)
  let ran = 0
  const probe = await send(ws, 'probe', () => { ran += 1; return { requests: 1, points: 0 } })
  check(probe.sent === true && ran === 1, '安静够了一整轮（' + waitFor(3) + ' 毫秒）：放一笔探针真跑了（实得 sent=' + probe.sent + ' ran=' + ran + '）')
  check(gate.workspaceView(ws).failuresSinceSuccess === 0, '这一笔成功：连续失败计数当场归零（实得 ' + gate.workspaceView(ws).failuresSinceSuccess + '）')
  const afterOk = await send(ws, 'probe', () => ({ requests: 1, points: 0 }))
  check(afterOk.sent === true, '解锁之后正常调用照常放行（实得 sent=' + afterOk.sent + '）')

  // ---------- ③ 探针失败：等待按序列涨，不连环重试 ----------
  const ws2 = 'ws-fail-again'
  gate.setWorkspace(ws2, { active: true })
  for (let i = 0; i < 3; i++) await failOnce(ws2)
  const t0 = clock
  clock += waitFor(3)
  const halfOpenFail = await send(ws2, 'probe', () => { throw new Error('探针自己失败了') }).then(() => false, () => true)
  check(halfOpenFail === true && gate.workspaceView(ws2).failuresSinceSuccess === 4, '探针失败：计数 3 → 4（实得 ' + gate.workspaceView(ws2).failuresSinceSuccess + '）')
  // 新窗口的起点以闸自己记下的那一刻为准（放行那一刻盖的戳），不从测试这边的时钟推算 ——
  // 推算会差那么一两毫秒，边界断言就成了假红。
  const started4 = gate.workspaceView(ws2).backoffWindowStartedAt
  check(started4 >= t0 + waitFor(3) && started4 <= t0 + waitFor(3) + 1000, '新窗口起点落在「放行那一刻」附近（实得 ' + (started4 - (t0 + waitFor(3))) + ' 毫秒之后）')
  clock = started4 + waitFor(4) - 1
  const tooSoon = await send(ws2, 'probe', () => { throw new Error('不该真跑') })
  check(tooSoon.sent === false, '第 4 次失败之后，窗口还差 1 毫秒也不放行（等待时长涨到 ' + waitFor(4) + ' 毫秒）')
  clock = started4 + waitFor(4)
  const justInTime = await send(ws2, 'probe', () => ({ requests: 1, points: 0 }))
  check(justInTime.sent === true, '窗口一到就放一笔（新窗口按第 4 次失败那一档算）')

  // ---------- ④ 探针在飞期间不放第二笔 ----------
  const ws3 = 'ws-inflight'
  gate.setWorkspace(ws3, { active: true })
  for (let i = 0; i < 3; i++) await failOnce(ws3)
  clock += waitFor(3)
  let resolveSlow = null
  const slow = send(ws3, 'probe', () => new Promise((res) => { resolveSlow = res }))
  await new Promise((r) => setTimeout(r, 5))
  const second = await send(ws3, 'probe', () => { throw new Error('不该有第二笔') })
  check(second.sent === false, '第一笔探针还在飞：不再放第二笔进来（实得 sent=' + second.sent + '）')
  if (resolveSlow) resolveSlow({ requests: 1, points: 0 })
  await slow
  check(gate.workspaceView(ws3).failuresSinceSuccess === 0, '在飞那笔成功之后计数归零（实得 ' + gate.workspaceView(ws3).failuresSinceSuccess + '）')

  // ---------- ⑤ 推迟过的调用不加计数 ----------
  // 注意：④ 之后 ws2 已经被解锁了（计数归零），所以这里要新起一个仍然锁着的工作区，
  // 把时钟停在窗口里面，才验得到「被推迟的那些调用一笔都不往计数上加」。
  const ws4 = 'ws-deferred-no-count'
  gate.setWorkspace(ws4, { active: true })
  for (let i = 0; i < 3; i++) await failOnce(ws4)
  const before = gate.workspaceView(ws4).failuresSinceSuccess
  clock = gate.workspaceView(ws4).backoffWindowStartedAt + waitFor(3) - 1
  const d1 = await send(ws4, 'probe', () => { throw new Error('不该真跑') })
  const d2 = await send(ws4, 'probe', () => { throw new Error('不该真跑') })
  check(d1.sent === false && d2.sent === false, '锁还锁着的时候连续两次调用都被推迟（实得 ' + d1.reason + ' / ' + d2.reason + '）')
  check(gate.workspaceView(ws4).failuresSinceSuccess === before, '被推迟的调用不算失败：计数不动（仍是 ' + gate.workspaceView(ws4).failuresSinceSuccess + '）')

  // ---------- ⑥ 没接这一格的地方行为不变 + 窗口状态机自己的算术 ----------
  // 闸把「该不该放一笔」的结论按 halfOpenTrialDue 传给裁决（判据只有 failure-window.js 一份）。
  // limits 照 gate.js 同一口径从 budget.js 拼，本文件不另写一份数字。
  const limits = {
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
  const base = {
    category: 'ai-tool', kind: 'probe', tier: 'green',
    quota: { allowance: 1000, used: 0, remaining: 1000, reserve: 0 },
  }
  const deferPlain = policy.decide(Object.assign({}, base, { workspace: { active: true, failuresSinceSuccess: 9 } }), limits)
  check(deferPlain.verdict === 'defer' && deferPlain.reason === 'failure-backoff', '没给「该放一笔了吗」这一格：一律推迟，老行为不动（实得 ' + deferPlain.reason + '）')
  const deferFalse = policy.decide(Object.assign({}, base, { workspace: { active: true, failuresSinceSuccess: 9, halfOpenTrialDue: false } }), limits)
  check(deferFalse.verdict === 'defer' && deferFalse.reason === 'failure-backoff', '这一格是 false：推迟（实得 ' + deferFalse.reason + '）')
  const allowTrial = policy.decide(Object.assign({}, base, { workspace: { active: true, failuresSinceSuccess: 9, halfOpenTrialDue: true } }), limits)
  check(allowTrial.verdict === 'allow' && allowTrial.reason === 'failure-half-open', '这一格是 true：判 allow + failure-half-open（实得 ' + allowTrial.reason + '）')
  const lifeTrial = policy.decide(Object.assign({}, base, { category: 'lifecycle', workspace: { active: true, failuresSinceSuccess: 9, halfOpenTrialDue: true } }), limits)
  check(lifeTrial.verdict === 'degrade' && lifeTrial.reason === 'lifecycle-cache-only', '生命周期那一档照旧只出缓存，探针那一格管不着它（实得 ' + lifeTrial.reason + '）')

  const fw = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'failure-window.js')).href)
  const seq = budget.CHAIN_BACKOFF_MS
  const extra = budget.FAILURE_HALF_OPEN_DELAY_MS
  check(fw.windowLengthMs(3, seq[2], extra) === seq[2] + extra, '窗口长度 = 第 n 次失败那一档 + 额外那一段（实得 ' + fw.windowLengthMs(3, seq[2], extra) + '）')
  check(fw.windowLengthMs(99, seq[seq.length - 1], extra) === seq[seq.length - 1] + extra, '失败次数再多也不超过最后一档（封顶，实得 ' + fw.windowLengthMs(99, seq[seq.length - 1], extra) + '）')
  check(fw.halfOpenTrialIsDue({ failures: 3, windowStartedAt: 0 }, 1e15, seq[2], extra) === false, '窗口起点是 0（这一轮还没开始）：不放探针')
  check(fw.halfOpenTrialIsDue({ failures: 3, windowStartedAt: 1000 }, 1000 + seq[2] + extra - 1, seq[2], extra) === false, '差 1 毫秒：不放探针')
  check(fw.halfOpenTrialIsDue({ failures: 3, windowStartedAt: 1000 }, 1000 + seq[2] + extra, seq[2], extra) === true, '正好到点：放探针')
  check(fw.halfOpenTrialIsDue({ failures: 3, windowStartedAt: 1000 }, NaN, seq[2], extra) === false, '时刻不是个数：不放探针（缺信息就按老规矩推迟）')
  const rec = fw.recordFailure({ failures: 4, windowStartedAt: 1 }, 777)
  check(rec.failures === 5 && rec.windowStartedAt === 777, '记一次真失败：计数 +1、窗口从此刻重开（实得 ' + rec.failures + ' / ' + rec.windowStartedAt + '）')
  check(fw.failureWindowOf({ failuresSinceSuccess: -3, backoffWindowStartedAt: -5 }).failures === 0, '状态是脏数（负数）时按 0 算，不把窗口判成已过（实得 ' + fw.failureWindowOf({ failuresSinceSuccess: -3, backoffWindowStartedAt: -5 }).failures + '）')

  // ---------- ⑦ 人的动作与读额度在前面两档，不受连续失败影响 ----------
  const userAction = await gate.send({ source: 'panel.write', kind: 'write', workspaceKey: ws4, plan: [{ phase: 'op' }] }, () => ({ requests: 1, points: 0 }))
  check(userAction.sent === true, '锁着的工作区里人的动作照做（实得 sent=' + userAction.sent + '）')
  const quotaRead = await gate.send({ source: 'quota.sync', kind: 'quota-read', workspaceKey: ws4, plan: [{ phase: 'rate-limit' }] }, () => ({ requests: 1, points: 0 }))
  check(quotaRead.sent === true, '锁着的工作区里读剩余额度照放（实得 sent=' + quotaRead.sent + '）')

  // ---------- ⑧ 工作区视图如实带出窗口起点 ----------
  check(typeof gate.workspaceView(ws2).backoffWindowStartedAt === 'number', '工作区视图带出 backoffWindowStartedAt（门禁与面板读的就是它）')

  console.log('')
  if (failed) { console.log('有断言没通过 — 闸的连续失败出口门禁判红（' + total + ' 项）'); process.exit(1) }
  console.log('全部通过 — 连续失败不再自锁（' + total + ' 项断言）')
}

main().catch((e) => { console.error(e); process.exit(1) })
