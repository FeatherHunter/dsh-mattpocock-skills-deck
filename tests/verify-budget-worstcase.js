// verify-budget-worstcase.js —— 门禁：定时那一半的最坏每小时用量远低于闸的上限（#706 T2 第二批）
// 用法：在插件根目录执行 node tests/verify-budget-worstcase.js，可独立运行。
//
// 断言文字（依据定稿第五章「算一遍：终局方案的最坏情况」那三条证明方式的第一条）：
// 把「多久跑一次 × 每次几条」按 budget.js 里的常量折成每小时，两桶（REST 数请求条数、GraphQL 数点数）
// 各自算一份上界，断言都低于闸允许的上限。所有数字只有一个来源：budget.js，门禁里不写任何一个额度。
// 上界怎么取最坏：
//   · 探测按活跃上限 MAX_ACTIVE_WORKSPACES 算：正在看的那个按快档（5 秒），刚离开的那个按慢档（15 秒）；
//   · 检查链按最长一档退避算次数（全绿缓存 30 分钟比它更长，对次数只是更小的值，不采用）；
//   · 服务端剩余额度同步按每分钟一次算（不扣配额，但它是一条真实出站请求，照样计入上界）；
//   · 整池重建只在冷启动与对账做：一小时里 1 次冷启动 + 按对账节拍算出来的那几次。
// 两道上限一起核对（不多不少两道）：
//   ① 整桶 ≤ PLUGIN_HOURLY_CAP（1,750）—— 插件自己那一份额度；
//   ② 读那一部分 ≤ READ_HOURLY_CAP（1,225）—— 读写三七分里的读份额。这一条正是「探测额度只有一份」
//      （定稿第四章：两个活跃工作区都按 5 秒探 = 2 × 720 = 1,440 条，读份额就顶不住了）的算术依据。
// 单位口径（必须写清，免得后来人误读）：READ_HOURLY_CAP 与 WRITE_HOURLY_CAP 在 budget.ts 里是按点数写的，
//   而 REST 与 GraphQL 是两个独立的桶、各自一份额度，所以这里把它们当作「每一桶里那一份份额」的上界来核对；
//   REST 桶用的单位是请求条数。这不是把点数与请求数混着比，是「同一个比例在另一个桶上再算一遍」。
// **不算事件驱动的花费**：那一半（写事件、切换补探、行内补行）归 tests/verify-event-budget.js。
//
// 反证（三向验证的第二、三向，每次运行都跑）：把探测间隔拧坏（5 秒 → 0.1 秒）必须判红；
// 把「刚离开的那个」的慢档也拧成快档（两个活跃工作区都按 5 秒探）必须判红 —— 它顶破的是读份额那道线；
// 把旋钮整体收紧的合规变体必须判绿。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

/**
 * 按一套常量算每小时上界。b 就是 budget.js（或它的一个变体）。
 * 返回 { rest, reads, points, parts }：整桶条数、读那一部分条数、点数、逐项明细。
 */
function hourlyBound(b) {
  const perHour = (intervalMs) => (intervalMs > 0 ? Math.floor(b.HOUR_MS / intervalMs) : Infinity)
  // 变化探测：正在看的一个走快档，刚离开的那个走慢档（活跃上限 2）。
  const fastActive = 1
  const lingerActive = Math.max(0, b.MAX_ACTIVE_WORKSPACES - fastActive)
  const parts = {
    probe: (fastActive * perHour(b.PROBE_INTERVAL_MS) + lingerActive * perHour(b.PROBE_INTERVAL_LINGER_MS)) * b.PROBE_COST_REQUESTS,
    preflight: perHour(b.PREFLIGHT_TTL_MS) * b.PREFLIGHT_COST_REQUESTS,
    chain: perHour(b.CHAIN_BACKOFF_MS[b.CHAIN_BACKOFF_MS.length - 1]) * b.CHAIN_EVAL_COST_REQUESTS,
    quotaSync: perHour(b.QUOTA_SYNC_INTERVAL_MS) * b.QUOTA_READ_COST_REQUESTS,
    coldStart: 1 * b.REBUILD_COST_REQUESTS,
    reconcile: perHour(b.RECONCILE_INTERVAL_MS) * b.REBUILD_COST_REQUESTS,
  }
  const rebuilds = 1 + perHour(b.RECONCILE_INTERVAL_MS)   // 冷启动 1 次 + 对账那几次
  // 读那一部分：探测、预检、检查链。读剩余额度不吃额度（那次调用不扣配额），所以只在整桶里算。
  const reads = parts.probe + parts.preflight + parts.chain
  const rest = reads + parts.quotaSync + parts.coldStart + parts.reconcile
  return { rest: rest, reads: reads, points: rebuilds * b.REBUILD_COST_POINTS, parts: parts, rebuilds: rebuilds }
}

/** 同一套判据跑一套常量，返回结论与一句话（真常量、坏变体、好变体共用它）。 */
function judge(b) {
  const bound = hourlyBound(b)
  const restCap = b.PLUGIN_HOURLY_CAP
  const readCap = b.READ_HOURLY_CAP
  const ok = bound.rest <= restCap && bound.reads <= readCap && bound.points <= restCap
  const pct = (n, cap) => (cap > 0 ? Math.round((n / cap) * 100) : 999)
  return {
    ok: ok, bound: bound,
    text: 'REST ' + bound.rest + ' 条（整桶上限 ' + restCap + '，占 ' + pct(bound.rest, restCap) + '%；其中读 ' +
      bound.reads + ' 条，读份额上限 ' + readCap + '，占 ' + pct(bound.reads, readCap) + '%）／GraphQL ' + bound.points + ' 点',
  }
}

async function main() {
  console.log('最坏每小时用量门禁（#706 T2：定时那一半按 budget.js 的常量算上界，两桶与读份额都要过关）')
  const budget = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'budget.js')).href)

  const real = judge(budget)
  check(real.ok, '真实常量下最坏每小时用量低于上限：' + real.text)
  console.log('    明细：探测 ' + real.bound.parts.probe + ' 条、预检 ' + real.bound.parts.preflight + ' 条、检查链 ' +
    real.bound.parts.chain + ' 条、额度同步 ' + real.bound.parts.quotaSync + ' 条、冷启动 ' + real.bound.parts.coldStart +
    ' 条、对账 ' + real.bound.parts.reconcile + ' 条；整池重建共 ' + real.bound.rebuilds + ' 次 = ' + real.bound.points + ' 点')

  // 上界算式真的算出了具体的数（不是 0、也不是 Infinity 混过去 —— 单位或常量缺一个就会变成 Infinity）。
  check(Number.isFinite(real.bound.rest) && Number.isFinite(real.bound.reads) && Number.isFinite(real.bound.points) && real.bound.rest > 0,
    '上界算式算出了有限的数（REST ' + real.bound.rest + '、读 ' + real.bound.reads + '、点数 ' + real.bound.points + '）')
  check(budget.PLUGIN_HOURLY_CAP === 1750 && budget.READ_HOURLY_CAP === 1225 && budget.PROBE_INTERVAL_LINGER_MS > 0,
    '上限与慢档探测间隔都取自 budget.js（1,750 / 1,225 / ' + budget.PROBE_INTERVAL_LINGER_MS + ' 毫秒）')

  // 反证一：把探测间隔拧坏（5 秒 → 0.1 秒），同一套判据必须判红。
  const brokenInterval = Object.assign({}, budget, { PROBE_INTERVAL_MS: 100 })
  const brokenA = judge(brokenInterval)
  check(!brokenA.ok, '反证：把探测间隔拧坏（5 秒 → 0.1 秒）必须判红 —— ' + brokenA.text)

  // 反证二：把「刚离开的那个」的慢档也拧成快档（两个活跃工作区都按 5 秒探），必须判红
  //   —— 它顶破的是读份额那道线，正是定稿第四章那句「2 × 720 = 1,440 就超过了读份额」。
  const brokenLinger = Object.assign({}, budget, { PROBE_INTERVAL_LINGER_MS: budget.PROBE_INTERVAL_MS })
  const brokenB = judge(brokenLinger)
  check(!brokenB.ok, '反证：两个活跃工作区都按 5 秒探（违反「探测额度只有一份」）必须判红 —— ' + brokenB.text)

  // 第三向（绿）：把旋钮整体收紧一档，同一套判据仍然判绿。
  const tighter = Object.assign({}, budget, { PROBE_INTERVAL_MS: budget.PROBE_INTERVAL_MS * 2, RECONCILE_INTERVAL_MS: budget.RECONCILE_INTERVAL_MS * 2 })
  const good = judge(tighter)
  check(good.ok, '合规变体（探测 10 秒、对账 20 分钟）判绿 —— ' + good.text)

  console.log('  说明：读份额那一道按「每一桶各自那份份额」核对 —— REST 桶的单位是请求条数，GraphQL 桶是点数，')
  console.log('        两个桶各自独立，不是把点数与请求数混着比（口径见 budget.ts 第七节的说明）。')
  console.log(failed ? '\n存在失败 — verify-budget-worstcase 未通过' : '\n全部通过 — 最坏用量门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
