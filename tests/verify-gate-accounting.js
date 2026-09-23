// verify-gate-accounting.js —— 门禁：闸的累计账 == 实际出站请求数（#706 T2 第二批 · I6）
// 用法：在插件根目录执行 node tests/verify-gate-accounting.js，可独立运行。
//
// 断言文字（票面验收第三条 + 「加固补充」最后几条）：真跑一遍「账本 + 闸」，用假的传输层
// （它每真发一条请求就报给闸，与生产里挂在起 gh 进程那一层同形），然后逐条查：
//   ① 对账零差异：闸记下来的条数、点数，与传输层真发出去的完全相等；
//   ② **GraphQL 点数桶单独一条断言**：那一桶按点数记、REST 桶按请求条数记，两桶互不折算；
//   ③ 扇出排队而不是并行发：一次 send 的多步、以及同时来的多次 send，并发数恒为 1；
//   ④ 推迟 ≠ 失败：被推迟的请求一条都不发、进队列，同一工作区只留最后一次，5 分钟过期即丢，
//      不算失败（连续失败次数保持 0）、不重试；
//   ⑤ 二级限流（Retry-After）也算降档信号：主桶没用完也降档；
//   ⑥ 反证：调用方报假数（发 3 条报 1 条）必须被当场对出来，账仍然按真发数记。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

async function main() {
  console.log('闸记账门禁（#706 T2：闸的累计账 == 实际出站请求数，两桶各自独立）')
  const budget = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'budget.js')).href)
  const ledgerMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'refresh', 'ledger.js')).href)
  const gateMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'refresh', 'gate.js')).href)

  let clock = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => clock })
  const gate = gateMod.createGate({ ledger: ledger, now: () => clock })
  // 假的传输层：真发出去的那几条请求由它数着，每一条都报给闸（生产里这一层就是起 gh 进程那一层）。
  const transport = { requests: 0, points: 0 }
  function fire(requests, points) {
    transport.requests += (requests || 0)
    transport.points += (points || 0)
    gate.noteOutbound({ requests: requests || 0, points: points || 0 })
  }
  let inFlight = 0
  let maxInFlight = 0
  async function step(requests, points) {
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((res) => setTimeout(res, 1))
    fire(requests, points)
    inFlight -= 1
    return { requests: requests, points: points || 0 }
  }

  // 起步：服务端读数落账（每分钟一次的那条路），两桶各自算档位。
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + budget.HOUR_MS }, graphql: { limit: 5000, remaining: 5000, reset: clock + budget.HOUR_MS } }, clock)
  check(ledger.view('rest').tier === 'green' && ledger.view('graphql').tier === 'green', '起步两桶各自是绿档（' + ledger.view('rest').tier + ' / ' + ledger.view('graphql').tier + '）')
  check(ledger.view('rest').allowance === budget.hourlyAllowance(5000), '额度按 budget.js 的算式算出来（' + ledger.view('rest').allowance + '）')

  // ①一笔探测：闸记 1 条、传输层真发 1 条。
  gate.setWorkspace('ws-1', { active: true })
  const r1 = await gate.send({ source: 'probe.tick', kind: 'probe', workspaceKey: 'ws-1' }, () => step(1, 0))
  check(r1.sent === true && r1.requests === 1 && transport.requests === 1, '一笔探测：闸记 1 条、传输层真发 ' + transport.requests + ' 条')
  check(ledger.hour('plugin', 'rest').requests === 1, '账本按「插件那一档 + REST 桶」记下 1 条（实得 ' + ledger.hour('plugin', 'rest').requests + '）')

  // ③扇出排队：一次 send 三步，每步按 budget.js 的补行单价花（1 条请求、2 点）；再加两次并发 send，
  //   并发数必须恒为 1。
  const stepPrice = { requests: budget.PATCH_COST_REQUESTS, points: budget.PATCH_COST_POINTS_MAX }
  const fan = await gate.send({ source: 'patch.apply', kind: 'patch', workspaceKey: 'ws-1', plan: [{ page: 1 }, { page: 2 }, { page: 3 }] },
    () => step(stepPrice.requests, stepPrice.points))
  check(fan.requests === 3 * stepPrice.requests, '扇出三步各 ' + stepPrice.requests + ' 条：总共 ' + fan.requests + ' 条（按 budget.js 的补行单价算）')
  await Promise.all([
    gate.send({ source: 'probe.tick', kind: 'probe', workspaceKey: 'ws-1' }, () => step(1, 0)),
    gate.send({ source: 'probe.tick', kind: 'probe', workspaceKey: 'ws-1' }, () => step(1, 0)),
  ])
  check(maxInFlight === 1, '扇出与并发都排队：同时最多只有 1 笔在飞（实得 ' + maxInFlight + '）')

  // ② GraphQL 点数桶单独一条断言：那一桶按点数记，REST 桶一点都没被带着走。
  //    重建的价钱由 budget.js 的每页单价算出来：工单池 5 页 × 2 点 + 拉取请求 1 页 × 2 点 + 计数 1 点 = 13 点、
  //    7 条请求（见 verify 里那两条算式核对）。假传输层按同一组常量计价，不自己写死一套价。
  check(budget.REBUILD_COST_POINTS === budget.REBUILD_PAGE_COUNT * budget.PAGE_COST_POINTS + budget.REBUILD_PR_PAGE_COUNT * budget.PR_PAGE_COST_POINTS + budget.COUNT_COST_POINTS,
    '一次重建的点数是从每页单价推出来的：5 × ' + budget.PAGE_COST_POINTS + ' + 1 × ' + budget.PR_PAGE_COST_POINTS + ' + ' + budget.COUNT_COST_POINTS + ' = ' + budget.REBUILD_COST_POINTS + ' 点')
  const beforeRebuild = { restUsed: ledger.view('rest').used, gqlUsed: ledger.view('graphql').used, gqlReq: ledger.hour('plugin', 'graphql').requests, accountedPoints: gate.stats().accounted.points }
  const rebuild = await gate.send({ source: 'reconcile.tick', kind: 'rebuild', workspaceKey: 'ws-1' },
    () => step(budget.REBUILD_COST_REQUESTS, budget.REBUILD_COST_POINTS))
  const gqlPointsAdded = ledger.view('graphql').used - beforeRebuild.gqlUsed
  const gqlRequestsAdded = ledger.hour('plugin', 'graphql').requests - beforeRebuild.gqlReq
  const accountedPointsAdded = gate.stats().accounted.points - beforeRebuild.accountedPoints
  check(gqlPointsAdded === budget.REBUILD_COST_POINTS, 'GraphQL 桶按点数记：一次重建 = ' + budget.REBUILD_COST_POINTS + ' 点（这一次实得 ' + gqlPointsAdded + '）')
  check(ledger.view('rest').used === beforeRebuild.restUsed,
    '同一笔重建一点都没算进 REST 桶（那一桶仍是 ' + ledger.view('rest').used + ' 条）—— 两桶互不折算')
  check(gqlRequestsAdded === budget.REBUILD_COST_REQUESTS, 'GraphQL 桶另外也记着这笔花了几条真实请求（这一次实得 ' + gqlRequestsAdded + ' 条，供对账用）')
  check(accountedPointsAdded === budget.REBUILD_COST_POINTS && rebuild.points === budget.REBUILD_COST_POINTS,
    '闸的点数账这一次增了 ' + accountedPointsAdded + ' 点、这一笔自己报的也是 ' + rebuild.points + ' 点（传输层累计真发 ' + transport.points + ' 点）')

  // ④ 推迟 ≠ 失败：非活跃工作区的后台探测一条都不发。
  gate.setWorkspace('ws-idle', { active: false })
  const transportBefore = transport.requests
  const d1 = await gate.send({ source: 'probe.tick', kind: 'probe', workspaceKey: 'ws-idle' }, () => step(1, 0))
  const d2 = await gate.send({ source: 'probe.tick', kind: 'probe', workspaceKey: 'ws-idle' }, () => step(1, 0))
  check(d1.sent === false && d1.verdict === 'defer' && d1.reason === 'background-inactive', '非活跃工作区的后台探测被推迟（原因 ' + d1.reason + '）')
  check(transport.requests === transportBefore, '被推迟的那两笔一条都没发出去（传输层条数没动：' + transport.requests + '）')
  check(gate.stats().pending === 1 && gate.stats().coalesced === 1, '同一工作区只留最后一次（队列 1 条、合并掉 ' + gate.stats().coalesced + ' 次）')
  check(gate.workspaceView('ws-idle').failuresSinceSuccess === 0, '推迟不算失败：连续失败次数仍是 0（实得 ' + gate.workspaceView('ws-idle').failuresSinceSuccess + '）')

  // ④b 5 分钟过期即丢：4 分钟时还在，6 分钟时丢掉，而且丢不是失败。
  const drain1 = gate.drain(clock + budget.DEFER_EXPIRY_MS - 60000)
  check(drain1.ready.length === 1 && drain1.dropped === 0, '推迟队列 4 分钟时还留着（' + drain1.ready.length + ' 条可重发）')
  await gate.send({ source: 'probe.tick', kind: 'probe', workspaceKey: 'ws-idle' }, () => step(1, 0))
  const drain2 = gate.drain(clock + budget.DEFER_EXPIRY_MS + 60000)
  check(drain2.ready.length === 0 && drain2.dropped === 1, '推迟队列 6 分钟时过期丢掉（丢掉 ' + drain2.dropped + ' 条）')
  check(gate.workspaceView('ws-idle').failuresSinceSuccess === 0 && transport.requests === transportBefore, '过期丢弃也不计失败、也不重发（失败数 ' + gate.workspaceView('ws-idle').failuresSinceSuccess + '，传输层 ' + transport.requests + '）')

  // ⑤ 二级限流也算降档信号：主桶没用完也降档。
  const usedPct = Math.round((ledger.view('rest').used / ledger.view('rest').allowance) * 100)
  const sig = gate.noteRetryAfter({ seconds: 60, bucket: 'rest', workspaceKey: 'ws-1' })
  check(sig.tier === 'red' && usedPct < 60, '主桶才用了 ' + usedPct + '%（远没到八成五），撞上限流之后照样降到红档（实得 ' + sig.tier + '）')
  const d3 = await gate.send({ source: 'probe.tick', kind: 'probe', workspaceKey: 'ws-1' }, () => step(1, 0))
  check(d3.sent === false && d3.reason === 'rate-limited', '撞限流期间该工作区的后台探测被推迟（原因 ' + d3.reason + '）')
  clock += 61000
  check(ledger.view('rest').tier === 'green', 'Retry-After 的 60 秒过去之后档位自己回来（实得 ' + ledger.view('rest').tier + '）')
  check(ledger.view('graphql').tier === 'green', '另一个桶没被牵连（GraphQL 仍是 ' + ledger.view('graphql').tier + '）')

  // ① 总账：对账零差异。
  const st = gate.stats()
  check(st.accounted.requests === transport.requests && st.accounted.points === transport.points,
    '对账零差异：闸的累计账 ' + JSON.stringify(st.accounted) + ' == 实际出站 ' + JSON.stringify(transport))
  check(st.claimed.requests === transport.requests && st.mismatch === 0, '调用方报的数与真发数一致（报 ' + st.claimed.requests + ' 条，对不上 ' + st.mismatch + ' 次）')
  check(st.escaped.requests === 0 && st.escaped.points === 0, '全过程漏网数为 0（实得 ' + JSON.stringify(st.escaped) + '）')

  // ⑥ 反证：调用方报假数（发 3 条报 1 条）必须被对出来，账仍按真发数记。
  const mismatchBefore = gate.stats().mismatch
  const accountedBefore = gate.stats().accounted.requests
  const lie = await gate.send({ source: 'probe.tick', kind: 'probe', workspaceKey: 'ws-1' }, async () => { fire(3, 0); return { requests: 1, points: 0 } })
  check(gate.stats().mismatch === mismatchBefore + 1, '反证：调用方发 3 条报 1 条，被当场对出来（对不上次数 +1）')
  check(lie.requests === 3 && gate.stats().accounted.requests === accountedBefore + 3, '反证：账按真发出去的 3 条记，不按它报的 1 条（闸记 +' + (gate.stats().accounted.requests - accountedBefore) + '）')
  check(gate.stats().accounted.requests === transport.requests, '反证之后对账仍是零差异（闸 ' + gate.stats().accounted.requests + ' == 传输层 ' + transport.requests + '）')

  console.log(failed ? '\n存在失败 — verify-gate-accounting 未通过' : '\n全部通过 — 闸记账门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
