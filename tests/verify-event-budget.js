// verify-event-budget.js —— 门禁：把事件驱动的花费也算进每小时上界（#706 T2 第二批）
// 用法：在插件根目录执行 node tests/verify-event-budget.js，可独立运行。
//
// 为什么光有 verify-budget-worstcase.js 不够（票面「门禁清单补全」那一句的原话）：
// 原来那条最坏用量只算定时器，而**增长最快的花费全在事件那边**——你每小时来回切多少次、
// 你和 AI 一共写了多少次、那个仓库每分钟变了多少次，这三样才是真正会把额度顶上去的东西。
// 所以本门禁把两边加起来算一份总上界：
//   定时那一半 + 事件那一半（切换次数 × 探测单价、写事件次数 × 写单价、变化次数 × 补行单价），
// 单价全部取自 budget.js（切换与探测同价、写事件 1 条请求、行级补行 1~2 点取上限 2 点）。
//
// 场景（定稿第五章取的就是这个真实用法，最坏：10 个工作区、每小时来回切 60 次、当前仓库每分钟有变化）：
// 场景本身的三个次数（60/60/60）是本门禁的输入参数，写在下面的 SCENARIO 里；单价一律来自 budget.js。
//
// 四道上限一起核对：
//   ① 整桶 REST ≤ PLUGIN_HOURLY_CAP（1,750）；
//   ② 读那一部分（探测、预检、检查链、切换补探）≤ READ_HOURLY_CAP（1,225）—— 读写三七分里的读份额；
//   ③ 写那一部分（写事件：评论、认领、改标签、关闭、建票）≤ WRITE_HOURLY_CAP（525）—— 写保底；
//   ④ 点数（重建 + 补行）≤ READ_HOURLY_CAP —— 自动刷新全是读，所以点数也要过读那一关。
// 单位口径（必须写清）：READ_HOURLY_CAP 与 WRITE_HOURLY_CAP 在 budget.ts 里是按点数写的，
//   而 REST 与 GraphQL 是两个独立的桶、各自一份额度，所以这里把它们当作「每一桶里那一份份额」的上界核对；
//   REST 桶的单位是请求条数。这不是把点数与请求数混着比，是同一个比例在另一个桶上再算一遍。
//
// 反证（三向验证的第二、三向，每次运行都跑）：把变化次数按百倍算，点数那一桶必须判红；
// 把写事件次数按百倍算，写保底与整桶必须判红；把次数减半、旋钮收紧的合规变体必须判绿。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

/** 定稿第五章那个最坏场景的三个次数（每小时）。它们不是额度常量，是本门禁的输入参数。 */
const SCENARIO = { switchesPerHour: 60, writeEventsPerHour: 60, changesPerHour: 60 }

/** 重建那几页的单价，全部从 budget.js 取（门禁里不写任何一个额度或单价数字）。 */
const PAGE_PRICES_OF = (b) => ({
  listPagePoints: b.PAGE_COST_POINTS,
  listPageRequests: b.LIST_PAGE_COST_REQUESTS,
  prPagePoints: b.PR_PAGE_COST_POINTS,
  prPageRequests: b.PR_PAGE_COST_REQUESTS,
  countPoints: b.COUNT_COST_POINTS,
  countRequests: b.COUNT_COST_REQUESTS,
  prPageCount: b.REBUILD_PR_PAGE_COUNT,
})

/**
 * 定时那一半 + 事件那一半 = 每小时上界。b 是 budget.js（或它的变体），s 是场景次数，pb 是 page-budget.js。
 * 返回 { rest, reads, writes, points, timer, parts }：整桶、读那一部分、写那一部分、点数、
 * 只算定时器的对照值、逐项明细。
 * 重建那一项按**页数上界**（budget.MAX_PAGES）算，与 verify-budget-worstcase 同一口径：
 * 定稿第十四章写的是「最坏用量按页数上界算」，典型值（REBUILD_PAGE_COUNT 那一笔 13 点）只用来讲单价。
 */
function hourlyBound(b, s, pb) {
  const perHour = (intervalMs) => (intervalMs > 0 ? Math.floor(b.HOUR_MS / intervalMs) : Infinity)
  const fastActive = 1
  const lingerActive = Math.max(0, b.MAX_ACTIVE_WORKSPACES - fastActive)
  const rebuilds = 1 + perHour(b.RECONCILE_INTERVAL_MS)   // 冷启动 1 次 + 对账那几次
  const rebuild = pb.worstCaseRebuildCost(0, b.MAX_PAGES, PAGE_PRICES_OF(b))
  const parts = {
    probe: (fastActive * perHour(b.PROBE_INTERVAL_MS) + lingerActive * perHour(b.PROBE_INTERVAL_LINGER_MS)) * b.PROBE_COST_REQUESTS,
    preflight: perHour(b.PREFLIGHT_TTL_MS) * b.PREFLIGHT_COST_REQUESTS,
    chain: perHour(b.CHAIN_BACKOFF_MS[b.CHAIN_BACKOFF_MS.length - 1]) * b.CHAIN_EVAL_COST_REQUESTS,
    quotaSync: perHour(b.QUOTA_SYNC_INTERVAL_MS) * b.QUOTA_READ_COST_REQUESTS,
    coldStart: 1 * rebuild.requests,
    reconcile: perHour(b.RECONCILE_INTERVAL_MS) * rebuild.requests,
    switches: s.switchesPerHour * b.SWITCH_COST_REQUESTS,
    writes: s.writeEventsPerHour * b.WRITE_EVENT_COST_REQUESTS,
    patches: s.changesPerHour * b.PATCH_COST_REQUESTS,
  }
  const pointParts = { rebuilds: rebuilds * rebuild.points, patches: s.changesPerHour * b.PATCH_COST_POINTS_MAX }
  const reads = parts.probe + parts.preflight + parts.chain + parts.switches
  const writes = parts.writes
  const timer = parts.probe + parts.preflight + parts.chain + parts.quotaSync + parts.coldStart + parts.reconcile
  const rest = reads + writes + parts.quotaSync + parts.coldStart + parts.reconcile + parts.patches
  let points = 0
  for (const k of Object.keys(pointParts)) points += pointParts[k]
  return { rest: rest, reads: reads, writes: writes, points: points, timer: timer, parts: parts, pointParts: pointParts, rebuilds: rebuilds }
}

/** 同一套判据跑一套常量与一套场景，返回结论与一句话。 */
function judge(b, s, pb) {
  const bound = hourlyBound(b, s, pb)
  const restCap = b.PLUGIN_HOURLY_CAP
  const readCap = b.READ_HOURLY_CAP
  const writeCap = b.WRITE_HOURLY_CAP
  const ok = bound.rest <= restCap && bound.reads <= readCap && bound.writes <= writeCap && bound.points <= readCap
  const pct = (n, cap) => (cap > 0 ? Math.round((n / cap) * 100) : 999)
  return {
    ok: ok, bound: bound,
    text: 'REST ' + bound.rest + ' 条（整桶上限 ' + restCap + '，占 ' + pct(bound.rest, restCap) + '%；读 ' + bound.reads +
      ' 条 / 读份额 ' + readCap + ' 占 ' + pct(bound.reads, readCap) + '%；写 ' + bound.writes + ' 条 / 写保底 ' + writeCap +
      ' 占 ' + pct(bound.writes, writeCap) + '%）／GraphQL ' + bound.points + ' 点（读份额上限 ' + readCap + '，占 ' + pct(bound.points, readCap) + '%）',
  }
}

async function main() {
  console.log('事件花费门禁（#706 T2：定时 + 事件两半加起来，整桶、读份额、写保底、点数四道都要过关）')
  const budget = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'budget.js')).href)
  const pageBudget = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'page-budget.js')).href)

  const real = judge(budget, SCENARIO, pageBudget)
  check(real.ok, '真实常量下「定时 + 事件」的最坏每小时用量低于上限：' + real.text)
  console.log('    明细：探测 ' + real.bound.parts.probe + ' 条、预检 ' + real.bound.parts.preflight + ' 条、检查链 ' +
    real.bound.parts.chain + ' 条、额度同步 ' + real.bound.parts.quotaSync + ' 条、冷启动 ' + real.bound.parts.coldStart +
    ' 条、对账 ' + real.bound.parts.reconcile + ' 条、切换补探 ' + real.bound.parts.switches + ' 条、写事件 ' +
    real.bound.parts.writes + ' 条、补行 ' + real.bound.parts.patches + ' 条；点数：重建 ' + real.bound.pointParts.rebuilds +
    ' 点 + 补行 ' + real.bound.pointParts.patches + ' 点')
  console.log('    探测那一项的算式：正在看的一个按快档 3600/5 = 720 条，刚离开的那个按慢档 3600/15 = 240 条，')
  console.log('      两个活跃工作区一共 720 + 240 = ' + real.bound.parts.probe + ' 条（慢档取 15 秒那一端，是设计里更费钱的一端）。')
  check(Number.isFinite(real.bound.rest) && Number.isFinite(real.bound.points) && real.bound.rest > 0,
    '上界算式算出了有限的数（REST ' + real.bound.rest + ' 条、点数 ' + real.bound.points + ' 点）')

  // 事件那一半真的被算进去了（去掉它总数会变小 —— 说明它不是摆设）。
  check(real.bound.rest > real.bound.timer, '事件那一半真的加进了上界（含事件 ' + real.bound.rest + ' 条 > 只算定时器 ' + real.bound.timer + ' 条）')
  check(real.bound.pointParts.patches > 0, '补行的点数真的算进了点数桶（' + real.bound.pointParts.patches + ' 点）')

  // 反证一：把变化次数按百倍算（一个仓库被疯狂改动），点数那一桶必须判红。
  const manyChanges = judge(budget, Object.assign({}, SCENARIO, { changesPerHour: SCENARIO.changesPerHour * 100 }), pageBudget)
  check(!manyChanges.ok, '反证：变化次数按百倍算必须判红（点数桶顶破读份额）—— ' + manyChanges.text)

  // 反证二：把写事件次数按百倍算（人和 AI 一起猛写），写保底与整桶必须判红。
  const manyWrites = judge(budget, Object.assign({}, SCENARIO, { writeEventsPerHour: SCENARIO.writeEventsPerHour * 100 }), pageBudget)
  check(!manyWrites.ok, '反证：写事件次数按百倍算必须判红（写保底与整桶一起顶破）—— ' + manyWrites.text)

  // 第三向（绿）：把次数减半、旋钮收紧一档，同一套判据仍然判绿。
  const good = judge(Object.assign({}, budget, { PROBE_INTERVAL_MS: budget.PROBE_INTERVAL_MS * 2 }),
    Object.assign({}, SCENARIO, { switchesPerHour: 30, writeEventsPerHour: 30, changesPerHour: 30 }), pageBudget)
  check(good.ok, '合规变体（次数减半、探测放慢一倍）判绿 —— ' + good.text)

  console.log(failed ? '\n存在失败 — verify-event-budget 未通过' : '\n全部通过 — 事件花费门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
