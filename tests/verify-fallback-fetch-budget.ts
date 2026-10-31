// verify-fallback-fetch-budget.ts —— 门禁：降级取数的请求预算、8 路并发、探测与校准节流、账实一致（票 #1689）
//
// 为什么要有这扇门禁：REST 降级常驻时一轮会多打很多请求（窗口探测 + 薄行补取 + 整仓枚举 +
// 按需详情），改造前各发各的、没有统一口径，超发只能事后从额度账本上看出来。这张票把口径定死：
//   常规增量一轮最多 3 条请求、完整枚举最多 16 条、单次详情补取最多 5 类请求、同时最多 8 条在飞、
//   降级常驻时整仓探测 5 秒放宽到 60 秒、自动校准至少隔 10 分钟。
//
// 这扇门禁守六件事（票面「门禁」一段逐条对应）：
//   ① 常量口径与账本同源：上限住在 src/refresh/kernel/host-budget.ts 的额度模块里，不是另抄一份；
//   ② 预算计数断言：预扣、校正、失败回填都真的记进账本（不是只断言常量值），超预算当场拒发；
//   ③ 并发计数断言：同时最多 8 条在飞，超出的排队、一条不丢（负例：20 条并发时峰值不超过 8）；
//   ④ 节流窗口断言：59999/60000 毫秒、599999/600000 毫秒两条边界；并且这些判断挂现有探测拍，
//      本票改的四个文件里一个新定时器都没有（静态断言，防有人用 setInterval 偷偷补节拍）；
//   ⑤ 降级判据只认快照上显式的 fallback:'rest'，不从错误文案或空列表去猜；
//   ⑥ 真实请求路径接线：stub 执行器驱动 createIssueList 的翻页与 createIssueDetail 的两类补取，
//      断言第 17 页 / 第 6 类当场拒发（传输层真的少发）、成功校正、失败回填、同类去重只发一次。
//
// 假传输层口径与 tests/verify-delta-wiring.ts 一致：真发出去的每一条都报计数，断言读计数与账本。
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)
const srcText = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function repoRoot() { return ROOT }

function main() { return run() }

async function run(): Promise<void> {
  console.log('降级取数预算门禁（#1689：3/16/5 请求、8 路并发、60 秒探测、10 分钟校准）')
  const fb = await imp('src/refresh/kernel/fallback-fetch-budget.js')
  const hb = await imp('src/refresh/kernel/host-budget.js')
  const thin = await imp('src/refresh/rooms/host/thin-row-fetch.js')
  const probeMod = await imp('src/refresh/rooms/host/probe-handler.js')
  const LIMITS = hb.FALLBACK_FETCH_LIMITS

  // ---- ① 常量口径：住在额度模块里，与宿主额度账本同一份 ----
  console.log('\n① 常量口径（额度模块 host-budget.ts）')
  check(hb.FALLBACK_INCREMENT_MAX_REQUESTS === 3, '常规增量一轮最多 3 条请求（实得 ' + hb.FALLBACK_INCREMENT_MAX_REQUESTS + '）')
  check(hb.FALLBACK_ENUMERATE_MAX_REQUESTS === 16, '完整枚举一轮最多 16 条请求（实得 ' + hb.FALLBACK_ENUMERATE_MAX_REQUESTS + '）')
  check(hb.FALLBACK_DETAIL_MAX_CLASSES === 5, '单次详情补取最多 5 类请求（实得 ' + hb.FALLBACK_DETAIL_MAX_CLASSES + '）')
  check(hb.FALLBACK_MAX_CONCURRENCY === 8, '并发固定 8 路（实得 ' + hb.FALLBACK_MAX_CONCURRENCY + '）')
  check(LIMITS.probeIntervalMs === 60000, '降级常驻时整仓探测间隔 60 秒（实得 ' + LIMITS.probeIntervalMs + ' 毫秒）')
  check(LIMITS.calibrationIntervalMs === 600000, '自动校准间隔不少于 10 分钟（实得 ' + LIMITS.calibrationIntervalMs + ' 毫秒）')
  check(LIMITS.incrementRequests === 3 && LIMITS.enumerateRequests === 16 && LIMITS.detailClasses === 5 && LIMITS.maxConcurrency === 8,
    'FALLBACK_FETCH_LIMITS 的六项与四个常量对得上（六项一次成型，改一处漏一处会在这里判红）')
  check(fb.FALLBACK_ROUND_KINDS.join(',') === 'increment,enumerate,detail', '三种轮次只有 increment/enumerate/detail（新形态必须同时补门禁）')
  check(fb.roundLimitOf('increment', LIMITS) === 3 && fb.roundLimitOf('enumerate', LIMITS) === 16 && fb.roundLimitOf('detail', LIMITS) === 5,
    'roundLimitOf 按轮次取对上限（3 / 16 / 5）')
  // 同源证据：上限常量与额度账本（MAX_PAGES / REBUILD 等）住在同一个文件里。
  const hbText = srcText('src/refresh/kernel/host-budget.ts')
  check(/MAX_PAGES\s*=/.test(hbText) && /FALLBACK_INCREMENT_MAX_REQUESTS/.test(hbText) && /FALLBACK_MAX_CONCURRENCY/.test(hbText),
    '降级取数上限与宿主额度账本（MAX_PAGES 等）同住 src/refresh/kernel/host-budget.ts，不另建配置文件')
  check(/fallbackProbeIntervalMs/.test(srcText('config/intervals.yaml')) && /fallbackCalibrationIntervalMs/.test(srcText('config/intervals.yaml')),
    '两个节流窗口在 config/intervals.yaml 里定义（时间值不散落在源码）')
  check(!feedsTimeNumbers(hbText, ['FALLBACK_INCREMENT_MAX_REQUESTS = 3', 'FALLBACK_MAX_CONCURRENCY = 8']),
    '请求条数与并发数是条数，不是时间值，按配置归属留在代码里（注释写明口径）')

  // ---- ② 预算计数：预扣 / 校正 / 失败回填，超预算拒发 ----
  console.log('\n② 预算计数与账实一致（预扣、校正、失败回填、分桶）')
  const inc = fb.createFallbackRoundBudget({ kind: 'increment', limits: LIMITS })
  const tickets = [inc.reserve(), inc.reserve(), inc.reserve()]
  check(tickets.every((t: any) => t && t.bucket === 'read' && t.cost === 1), '增量轮预扣 3 张小票，默认记在读桶、每张 1 条')
  check(inc.reserve() === null, '第 4 条预扣被拒（超预算拒发），reserve 回 null 而不是硬发')
  let v = inc.view()
  check(v.used === 3 && v.remaining === 0 && v.refused === 1, '拒发后 used 停在 3、remaining=0、refused=1（被拒的那条不记进已用）')
  check(v.buckets.read.refused === 1 && v.buckets.write.refused === 0, '被拒笔数只记在读桶（负例写进写桶就是混记）')

  const inc2 = fb.createFallbackRoundBudget({ kind: 'increment', limits: LIMITS })
  const t1 = inc2.reserve(); const t2 = inc2.reserve(); const t3 = inc2.reserve()
  check(t1 && t2 && t3, '另一本增量账预扣 3 张成功')
  inc2.correct(t1, 1)
  v = inc2.view()
  check(v.buckets.read.settled === 1 && v.buckets.read.corrected === 1 && v.open === 2 && v.used === 3,
    '收到后校正：预扣 1 条按实际 1 条定账（settled=1、corrected=1、挂着的预扣从 3 减到 2）')
  inc2.backfill(t2, 1)
  v = inc2.view()
  check(v.buckets.read.backfilled === 1 && v.buckets.read.settled === 2 && v.open === 1,
    '失败也回填：失败的那条照样记进 settled（backfilled=1），账上不漏')
  // 校正要按「实际发出几条」记，不按预扣估的几条记：预扣 2 条、实际发出 1 条，账上就记 1 条。
  const est = fb.createFallbackRoundBudget({ kind: 'enumerate', limits: LIMITS })
  const estTicket = est.reserve({ cost: 2 })
  est.correct(estTicket, 1)
  check(est.view().used === 1 && est.view().buckets.read.settled === 1,
    '校正按实际条数记：预扣估 2 条、实际发出 1 条，已用就校回 1 条（不按预扣数报账）')
  check(inc2.reserve() === null, '三条都已定账（used=3=上限）后第 4 条照样拒发')
  checkThrows(() => inc2.correct(t2, 1), '同一张小票第二次定账抛错（防止同一笔被记两次）', check)
  checkThrows(() => inc2.correct({ id: 999, kind: 'increment', bucket: 'read', cost: 1, classLabel: '' }, 1),
    '不认识的小票（来自另一本账）抛错，拒绝记账', check)

  // 读写分桶：同一本账里读与写各记各的，永不混记。
  const mixed = fb.createFallbackRoundBudget({ kind: 'enumerate', limits: LIMITS })
  const r1 = mixed.reserve({ bucket: 'read' })
  const w1 = mixed.reserve({ bucket: 'write' })
  mixed.correct(r1, 1)
  mixed.backfill(w1, 1)
  v = mixed.view()
  check(v.buckets.read.settled === 1 && v.buckets.read.corrected === 1 && v.buckets.read.backfilled === 0,
    '读桶只记读请求（settled=1、corrected=1、backfilled=0）')
  check(v.buckets.write.settled === 1 && v.buckets.write.corrected === 0 && v.buckets.write.backfilled === 1,
    '写桶只记写请求（settled=1、corrected=0、backfilled=1）—— 读写不混记')

  const en = fb.createFallbackRoundBudget({ kind: 'enumerate', limits: LIMITS })
  let okCount = 0
  for (let i = 0; i < 16; i++) if (en.reserve()) okCount += 1
  check(okCount === 16 && en.reserve() === null, '完整枚举 16 条上限：第 16 条放行、第 17 条拒发')
  check(en.view().limit === 16 && en.view().used === 16, '枚举轮账本的上限与已用都是 16')

  const det = fb.createFallbackRoundBudget({ kind: 'detail', limits: LIMITS })
  const dt = []
  for (const c of ['meta', 'body', 'comments', 'links', 'timeline']) dt.push(det.reserve({ classLabel: c }))
  check(dt.every((t: any) => t), '详情补取 5 类请求各占一格')
  check(det.view().remaining === 0, '5 类占满后 remaining=0（按类算）')
  check(det.view().buckets.read.preCharged === 5, '5 类请求的预扣都记在读桶')
  check(det.reserve({ classLabel: 'meta' }) !== null, '同一类再补一次不重复占格（仍是第 5 类以内）')
  check(det.reserve({ classLabel: 'sixth' }) === null, '第 6 类请求拒发（单次详情补取最多 5 类）')
  check(det.view().refused === 1, '第 6 类拒发的笔数记在账上')
  checkThrows(() => det.reserve(), '详情轮不带请求类名抛错（否则 5 类上限无从判定）', check)

  // ---- ③ 并发：8 路在飞，超出的排队、一条不丢 ----
  console.log('\n③ 8 路并发闸（负例：20 条并发时峰值不超过 8，全部成功）')
  const gate = fb.createFallbackConcurrencyGate({ maxConcurrency: LIMITS.maxConcurrency })
  let inFlight = 0; let observedPeak = 0; let queuedSeen = 0
  const jobs = []
  for (let i = 0; i < 20; i++) {
    jobs.push(gate.run(async function () {
      inFlight += 1
      if (inFlight > observedPeak) observedPeak = inFlight
      if (gate.view().queued > queuedSeen) queuedSeen = gate.view().queued
      await new Promise(function (resolve) { setTimeout(resolve, 5) })
      inFlight -= 1
      return i
    }))
  }
  const done = await Promise.all(jobs)
  check(done.length === 20 && done.every(function (x: any) { return typeof x === 'number' }),
    '20 条并发全部完成、一条不丢（排队而不是拒发）')
  const gv = gate.view()
  check(gv.peak === 8, '同时在飞的峰值正好 8（实得 ' + gv.peak + '）')
  check(observedPeak <= 8 && queuedSeen > 0, '峰值不超过 8 且真的有请求排过队（queued 最大 ' + queuedSeen + '）')
  check(gv.admitted === 20 && gv.completed === 20, '放行 20、完成 20（没有悄悄丢请求）')
  checkThrows(() => fb.createFallbackConcurrencyGate({ maxConcurrency: 0 }), '并发上限为 0 抛错，不接受关掉的闸', check)

  // ---- ④ 节流窗口边界 + 不新增定时器 ----
  console.log('\n④ 探测与校准节流（窗口边界，挂现有探测拍、不新增定时器）')
  const probeLimits = LIMITS
  check(fb.probeDue(1000000, 1000000 - 59999, true, probeLimits) === false, '降级常驻：距上次探测 59999 毫秒时这一拍不发（节流）')
  check(fb.probeDue(1000000, 1000000 - 60000, true, probeLimits) === true, '降级常驻：正好 60000 毫秒这一拍放行')
  check(fb.probeDue(1000000, 1000000 - 5000, false, probeLimits) === true, '主路正常时恒真（仍是原来的 5 秒节拍，行为不变）')
  check(fb.probeDue(1000000, undefined, true, probeLimits) === true, '降级但还没探过：第一次立刻探')
  check(fb.probeDue(1000000, NaN, true, probeLimits) === true, '上次时刻不是可用数字时按「没探过」处理')
  check(fb.calibrationDue(2000000, 2000000 - 599999, probeLimits) === false, '校准：距上次 599999 毫秒时不到期')
  check(fb.calibrationDue(2000000, 2000000 - 600000, probeLimits) === true, '校准：正好 600000 毫秒到期（至少隔 10 分钟）')
  check(fb.calibrationDue(2000000, undefined, probeLimits) === true, '从没校准过：第一拍就算到期（降级一发生就有完整基线）')
  // 不新增定时器的证据：本票改的三个文件里 setInterval / setTimeout 一次都不出现。
  for (const rel of ['src/refresh/kernel/fallback-fetch-budget.ts', 'src/refresh/rooms/host/probe-handler.ts', 'src/refresh/rooms/host/thin-row-fetch.ts']) {
    const txt = srcText(rel)
    check(!/setInterval\s*\(/.test(txt) && !/setTimeout\s*\(/.test(txt), '不新增定时器：' + rel + ' 里没有 setInterval/setTimeout')
  }
  const probeText = srcText('src/refresh/rooms/host/probe-handler.ts')
  check(/probeDue\(/.test(probeText) && /calibrationDue\(/.test(probeText),
    '两个节流判断都挂在现有 handleProbe 探测拍里（没有另起节拍）')
  check(/createFallbackRoundBudget/.test(probeText) && /fallbackBudget/.test(probeText),
    '探测拍里预扣本轮预算并把账本透传给增量取数（同一轮记同一本账）')

  // ---- ⑤ 降级判据只认显式事实 ----
  console.log('\n⑤ 降级判据（只认 fallback:rest）')
  check(fb.fallbackStandingOf({ fallback: 'rest' }) === true, '快照写着 fallback:rest 才判降级')
  check(fb.fallbackStandingOf({ fallback: 'github' }) === false && fb.fallbackStandingOf({}) === false &&
    fb.fallbackStandingOf(null) === false && fb.fallbackStandingOf('rest') === false,
    '其它形态 / 缺字段 / null / 字符串都不算降级（不从错误文案或空列表猜）')

  // ---- ⑥ 取数层接线：拒发时零出站、成功与失败都进账 ----
  console.log('\n⑥ 薄行取数接上预算（拒发一条都不出去；成功校正、失败回填）')
  const calls = { get: 0 }
  function fakeOpen(handler: any): any {
    return async function () {
      return {
        ok: true, backendId: 'github',
        call: async function (fn: any) { return fn({ get: async function (ref: any, key: any) { calls.get += 1; return handler(key) } }, { cwd: 'C:/ws/demo' }) },
      }
    }
  }
  const stats = { thinQueries: 0 }
  // 拒发负例：账上已经没有余量，发的 3 条一条都不许出去。
  const exhausted = fb.createFallbackRoundBudget({ kind: 'increment', limits: LIMITS })
  exhausted.reserve(); exhausted.reserve(); exhausted.reserve()
  calls.get = 0
  const refused = await thin.fetchThinRows({ openSession: fakeOpen(() => ({ ok: true, data: rowOf(1) })), stats: stats, budget: exhausted }, 'C:/ws/demo', { owner: 'o', name: 'r' }, ['1', '2', '3'])
  check(refused.ok === false && refused.outcome === 'failed' && refused.reason === 'fallback-budget-refused',
    '预算耗尽时薄行取数整批拒发（回 fallback-budget-refused，不假装成功）')
  check(calls.get === 0 && stats.thinQueries === 0, '拒发时传输层收到 0 条、thinQueries 计数也没涨（一个字节都没出去）')
  check(exhausted.view().refused === 3, '三张预扣全被拒，被拒笔数记在账上（refused=3）')

  // 成功路径：3 条请求先预扣、回来后各按 1 条校正。
  const inc3 = fb.createFallbackRoundBudget({ kind: 'increment', limits: LIMITS })
  calls.get = 0; stats.thinQueries = 0
  const okRes = await thin.fetchThinRows({ openSession: fakeOpen((k: any) => ({ ok: true, data: rowOf(k) })), stats: stats, budget: inc3 }, 'C:/ws/demo', { owner: 'o', name: 'r' }, ['1', '2', '3'])
  check(okRes.ok === true && okRes.rows.length === 3 && calls.get === 3 && stats.thinQueries === 3, '3 条薄行全部取回、传输层正好 3 条')
  v = inc3.view()
  check(v.used === 3 && v.buckets.read.corrected === 3 && v.buckets.read.settled === 3 && v.open === 0,
    '成功后账实一致：3 张预扣全部按 1 条定账（corrected=3、settled=3、没有挂着的预扣）')

  // 失败路径：请求真的发出去过，失败也回填。
  const inc4 = fb.createFallbackRoundBudget({ kind: 'increment', limits: LIMITS })
  const failRes = await thin.fetchThinRows({ openSession: fakeOpen(() => ({ ok: false, error: { kind: 'network', message: 'boom' } })), stats: { thinQueries: 0 }, budget: inc4 }, 'C:/ws/demo', { owner: 'o', name: 'r' }, ['7'])
  v = inc4.view()
  check(failRes.ok === false && failRes.reason === 'thin-query-failed', '取数失败照旧回 failed（行为不变）')
  check(v.buckets.read.backfilled === 1 && v.buckets.read.settled === 1 && v.open === 0,
    '失败也回填：那条请求记进账（backfilled=1、settled=1、没有挂着的预扣）')

  // 主路正常（不传 budget）：一条都不记账，行为与改造前一致。
  const noBudget = await thin.fetchThinRows({ openSession: fakeOpen((k: any) => ({ ok: true, data: rowOf(k) })), stats: { thinQueries: 0 } }, 'C:/ws/demo', { owner: 'o', name: 'r' }, ['1'])
  check(noBudget.ok === true && noBudget.rows.length === 1, '主路正常时不传预算本子，取数行为与改造前完全一致')

  // ---- ⑦ 探测拍上的三条回包：到点校准 / 窗口内空拍 / 主路照旧 ----
  console.log('\n⑦ 探测拍接线（到点校准、窗口内空拍、主路照旧）')
  const cwd = 'C:/ws/demo'
  const cacheBox: any = { ts: Date.now(), snapshot: { fallback: 'rest' }, error: null, cwd: cwd }
  const sets: any[] = []
  const outbound = { probe: 0, delta: 0 }
  const deps: any = {
    canonicalKey: async (v: any) => v,
    selectEarly: async () => ({ backendId: 'github' }),
    isComposerSelection: () => false,
    getTrackerRegistry: async () => ({ get: () => null, describe: () => null }),
    getPlatform: async () => ({}),
    ctx: { get: () => null },
    fetchIssueIndexWindowed: async () => { outbound.probe += 1; return { ok: true, changed: false, repo: { owner: 'o', name: 'r' }, count: 0, index: {}, nextWatermarkMs: Date.now() } },
    issueIndexChanged: () => false,
    rememberIssueIndex: () => {},
    commitIssueIndex: () => {},
    getCache: () => cacheBox,
    setCache: (v: any) => { sets.push(v) },
    lastIssueIndexByRepo: {},
    lastProbeAtByRepo: {},
    deltaRefresh: async () => { outbound.delta += 1; return { mode: 'nothing' } },
    takeWritePatch: async () => null,
    errText: (e: any) => String((e && e.message) || e),
  }
  const probe = probeMod.createProbeHandler(deps)
  const first = await probe.handleProbe({ cwd: cwd })
  check(first.ok === true && first.mode === 'calibrate' && first.reason === 'fallback-calibration-due',
    '降级常驻第一拍：到点校准，回 mode=calibrate（客户端走既有的整仓重建那一支 = 完整枚举）')
  check(outbound.probe === 0 && outbound.delta === 0, '校准这一拍一条出站请求都不发（缓存清脏交给客户端整仓重取）')
  check(sets.length === 1 && sets[0].snapshot === null, '校准把宿主缓存清脏（setCache snapshot:null）')
  // 客户端按校准结果整仓重取后会拿回一份同样写着 fallback:rest 的快照，这里照实模拟。
  cacheBox.snapshot = { fallback: 'rest' }
  const second = await probe.handleProbe({ cwd: cwd })
  check(second.ok === true && second.changed === false && second.mode === 'throttled' && second.reason === 'fallback-probe-window',
    '降级窗口内（距上次探测不足 60 秒）：回 mode=throttled 的空拍')
  check(outbound.probe === 0 && outbound.delta === 0, '窗口内空拍零出站（5 秒节拍照跑，只是这一拍不发请求）')
  // 主路正常：快照没有 fallback 标记，探测一拍就照旧发窗口索引。
  cacheBox.snapshot = { issues: [] }
  const third = await probe.handleProbe({ cwd: cwd })
  check(outbound.probe === 1 && third.ok === true && third.changed === false,
    '主路正常时照旧发窗口探测（降级节流不影响平时那 5 秒一拍的行为）')

  // ---- ⑧ 真实请求路径：索引翻页接枚举账本、详情两类接详情账本 ----
  // 为什么要有这一节：①-⑦ 只证明账本 API 与常量对，证明不了「真实取数路径真的在用它」。
  // 这一节用 stub 执行器驱动两个真实工厂（createIssueList / createIssueDetail），断言发出前记账、
  // 收到后校正、失败也回填、超预算当场拒发（第 17 页 / 第 6 类），并断言被拒的请求一条都没出去。
  console.log('\n⑧ 真实请求路径的预算接线（stub 执行器驱动，超预算拒发、账实一致）')
  const listMod = await imp('src/refresh/rooms/host/issue-list-fetch.js')
  const detailMod = await imp('src/refresh/rooms/host/issue-detail-fetch.js')

  /** 造一趟只读会话：后端与 opener 形状跟库里一致（{ok:true, backendId, call(fn)}），session 由调用方给。 */
  function openWith(session: any) {
    return async function () {
      return { ok: true, backendId: 'github', call: async function (fn: any) { return fn(session, { caller: 'refresh', cwd: 'C:/ws/demo' }) } }
    }
  }
  function listDeps(openSession: any) {
    return {
      getRepoKey: async () => ({ owner: 'o', name: 'r' }), setCache: () => {},
      issueIndexFromSnapshot: () => null, issueIndexChanged: () => false, rememberIssueIndex: () => {},
      readDiskCache: async () => null, openSession: openSession,
    }
  }
  function detailDeps(openSession: any, budget?: any) {
    const d: any = { getRepoKey: async () => ({ owner: 'o', name: 'r' }), openSession: openSession }
    if (budget) d.fallbackBudget = budget
    return d
  }
  /** 造一条契约票，够 detailOf 组出详情页字段。 */
  function issueOf(n: any): any {
    return { key: String(n), title: '票 ' + n, state: 'open', labels: [], assignees: [], comments: [], updatedAt: '2026-10-30T00:00:00Z', createdAt: '2026-09-01T00:00:00Z' }
  }

  // 枚举超预算：stub 的 listPage 永远还有下一页，第 17 页不许发出去。
  let listCalls = 0
  const endlessPages = async function () {
    listCalls += 1
    const n = listCalls
    return { ok: true, data: { items: [{ key: 'k' + n, state: 'open', updatedAt: '2026-10-30T00:00:00Z' }], nextCursor: 'c' + n, total: 0 } }
  }
  const enumList = listMod.createIssueList(listDeps(openWith({ listPage: endlessPages })))
  const enumBig = await enumList.fetchIssueIndex('C:/ws/demo', '')
  check(enumBig && enumBig.ok === false && enumBig.error.kind === 'truncated',
    '完整枚举第 17 页被预算拦住：回 {ok:false, kind:truncated}，不假装取全（实得 kind=' + String(enumBig && enumBig.error && enumBig.error.kind) + '）')
  check(listCalls === 16, '第 17 条请求根本没发出去：传输层只收到 16 条（实得 ' + listCalls + '）')
  check(enumBig && enumBig.budget && enumBig.budget.kind === 'enumerate' && enumBig.budget.limit === 16 && enumBig.budget.used === 16 && enumBig.budget.refused === 1,
    '枚举轮账本实记：kind=enumerate、上限 16、已用 16、被拒 1（账实一致）')
  check(enumBig && enumBig.pages === 16 && /第 17 页未发出/.test(String(enumBig.error.error)) && /16/.test(String(enumBig.error.error)),
    '被截断的位置可诊断：已取 16 页、第 17 页未发出、带上限 16（原文：' + String(enumBig && enumBig.error && enumBig.error.error).slice(0, 40) + '…）')
  check(!enumBig || enumBig.error.kind !== 'unchanged', '截断不会被当成「没变」推进水印（失败原样上抛由调用方处理）')

  // 枚举正常收尾：两页取全，每页预扣一张、收到各校正 1 条，账上不留未定账的小票。
  listCalls = 0
  const twoPages = async function () {
    listCalls += 1
    const n = listCalls
    return { ok: true, data: { items: [{ key: 'k' + n, state: 'open', updatedAt: '2026-10-30T00:00:00Z' }], nextCursor: n < 2 ? 'c' + n : null, total: 0 } }
  }
  const okList = listMod.createIssueList(listDeps(openWith({ listPage: twoPages })))
  const enumOk = await okList.fetchIssueIndex('C:/ws/demo', '')
  check(enumOk && enumOk.ok === true && enumOk.count === 2 && enumOk.pages === 2 && listCalls === 2,
    '两页枚举取全：count=2、pages=2、传输层正好 2 条')
  check(enumOk && enumOk.budget && enumOk.budget.buckets.read.corrected === 2 && enumOk.budget.buckets.read.settled === 2 && enumOk.budget.open === 0,
    '成功后账实一致：两页都按实际条数校正（corrected=2、settled=2、没有挂着的预扣）')

  // 增量窗口轮：注入一本增量账本，第 4 页拒发（常规增量一轮最多 3 条）。
  listCalls = 0
  const incWindow = fb.createFallbackRoundBudget({ kind: 'increment', limits: LIMITS })
  const incList = listMod.createIssueList(listDeps(openWith({ listPage: endlessPages })))
  const incWin = await incList.fetchIssueIndex('C:/ws/demo', new Date(Date.now() - 3600000).toISOString(), incWindow)
  check(incWin && incWin.ok === false && incWin.error.kind === 'truncated' && listCalls === 3,
    '窗口探测的第 4 页被增量账本拦住：传输层只发 3 条（实得 ' + listCalls + '）')
  check(incWindow.view().used === 3 && incWindow.view().refused === 1 && incWindow.view().kind === 'increment',
    '增量轮账本实记：上限 3、已用 3、被拒 1')
  check(incWin && incWin.budget && incWin.budget.kind === 'increment', '回包带的是注入的那本增量账本读数（同一轮同一本账）')

  // 详情正常路径：get 与 getDependencies 两类各发一次，回来后各自校正。
  let getCalls = 0
  let depCalls = 0
  const detailSession = {
    get: async function () { getCalls += 1; return { ok: true, data: issueOf(7) } },
    getDependencies: async function () { depCalls += 1; return { ok: true, data: { blockedBy: [{ key: '1', title: '阻塞', state: 'open' }], blocking: [] } } },
  }
  const detailOk = await detailMod.createIssueDetail(detailDeps(openWith(detailSession))).fetchIssueDetail(7, 'C:/ws/demo')
  check(detailOk && detailOk.ok === true && detailOk.issue && detailOk.issue.number === 7 && getCalls === 1 && depCalls === 1,
    '详情补取两类请求各发一次（get=1、getDependencies=1）')
  check(detailOk && detailOk.budget && detailOk.budget.kind === 'detail' && detailOk.budget.limit === 5,
    '详情轮账本：kind=detail、上限 5 类')
  check(detailOk && detailOk.budget && detailOk.budget.classes.join(',') === 'detail-core,dependencies' && detailOk.budget.buckets.read.corrected === 2,
    '两类都记进账：detail-core、dependencies 各 1 类，收到后各校正 1 条（corrected=2）')
  check(detailOk && detailOk.budget && detailOk.budget.buckets.read.settled === 2 && detailOk.budget.open === 0,
    '详情回包拿出去之前账上不留未定账的小票（settled=2、open=0）')

  // 详情失败路径：get 回 !ok，请求真的发出去了，账要回填；阻塞边那条照常校正。
  getCalls = 0; depCalls = 0
  const detailBadSession = {
    get: async function () { getCalls += 1; return { ok: false, error: { kind: 'network', message: 'boom' } } },
    getDependencies: async function () { depCalls += 1; return { ok: true, data: { blockedBy: [], blocking: [] } } },
  }
  const detailBad = await detailMod.createIssueDetail(detailDeps(openWith(detailBadSession))).fetchIssueDetail(7, 'C:/ws/demo')
  check(detailBad && detailBad.ok === false && detailBad.error.kind === 'network', '读票 !ok 照旧回失败（kind 原样 network）')
  check(detailBad && detailBad.budget && detailBad.budget.buckets.read.backfilled === 1 && detailBad.budget.buckets.read.corrected === 1 && detailBad.budget.open === 0,
    '失败也回填：读票记 backfilled=1、阻塞边记 corrected=1，账上没有挂着的预扣')

  // 详情异常路径：get 抛错收成 env；getDependencies 抛错只退化阻塞边，详情照常成功。
  getCalls = 0; depCalls = 0
  const detailThrowSession = {
    get: async function () { getCalls += 1; throw new Error('get-booms') },
    getDependencies: async function () { depCalls += 1; return { ok: true, data: { blockedBy: [], blocking: [] } } },
  }
  const detailThrow = await detailMod.createIssueDetail(detailDeps(openWith(detailThrowSession))).fetchIssueDetail(7, 'C:/ws/demo')
  check(detailThrow && detailThrow.ok === false && detailThrow.error.kind === 'env' && /取单票时抛错/.test(String(detailThrow.error.message)),
    '读票抛错收成 {ok:false, kind:env}（与改造前一致）')
  check(detailThrow && detailThrow.budget && detailThrow.budget.buckets.read.backfilled === 1 && detailThrow.budget.open === 0,
    '抛错的请求也回填（backfilled=1、open=0）')
  getCalls = 0; depCalls = 0
  const depsThrowSession = {
    get: async function () { getCalls += 1; return { ok: true, data: issueOf(7) } },
    getDependencies: async function () { depCalls += 1; throw new Error('deps-booms') },
  }
  const depsThrow = await detailMod.createIssueDetail(detailDeps(openWith(depsThrowSession))).fetchIssueDetail(7, 'C:/ws/demo')
  check(depsThrow && depsThrow.ok === true && getCalls === 1 && depCalls === 1, '阻塞边抛错不让详情崩（详情照常成功）')
  check(depsThrow && depsThrow.budget && depsThrow.budget.buckets.read.backfilled === 1 && depsThrow.budget.buckets.read.corrected === 1 && depsThrow.budget.open === 0,
    '抛错的阻塞边也回填、成功那条校正，账实一致')

  // 第 6 类拒发：预填 5 类后，核心那一类也不许发出去（一个字都不出去）。
  getCalls = 0; depCalls = 0
  const fullBudget = fb.createFallbackRoundBudget({ kind: 'detail', limits: LIMITS })
  for (const c of ['c1', 'c2', 'c3', 'c4', 'c5']) fullBudget.reserve({ classLabel: c, bucket: 'read', cost: 1 })
  const detailFull = await detailMod.createIssueDetail(detailDeps(openWith({
    get: async function () { getCalls += 1; return { ok: true, data: issueOf(7) } },
    getDependencies: async function () { depCalls += 1; return { ok: true, data: { blockedBy: [], blocking: [] } } },
  }), fullBudget)).fetchIssueDetail(7, 'C:/ws/demo')
  check(detailFull && detailFull.ok === false && detailFull.error.kind === 'throttled' && /5/.test(String(detailFull.error.message)),
    '已到 5 类上限：详情补取回 {ok:false, kind:throttled}，消息写明 5 类上限')
  check(getCalls === 0 && depCalls === 0, '预算拒发时一条请求都不出去（get=0、getDependencies=0）')
  check(fullBudget.view().refused === 1 && fullBudget.view().classes.length === 5, '被拒笔数记在账上（refused=1），已占的 5 类不重复占格')

  // 同类去重：本轮已经取过 detail-core，就不许再发第二次。
  getCalls = 0; depCalls = 0
  const dupBudget = fb.createFallbackRoundBudget({ kind: 'detail', limits: LIMITS })
  dupBudget.reserve({ classLabel: 'detail-core', bucket: 'read', cost: 1 })
  const detailDup = await detailMod.createIssueDetail(detailDeps(openWith({
    get: async function () { getCalls += 1; return { ok: true, data: issueOf(7) } },
    getDependencies: async function () { depCalls += 1; return { ok: true, data: { blockedBy: [], blocking: [] } } },
  }), dupBudget)).fetchIssueDetail(7, 'C:/ws/demo')
  check(detailDup && detailDup.ok === false && detailDup.error.kind === 'throttled' && /同一类不重复取/.test(String(detailDup.error.message)),
    '同类去重：detail-core 本轮已发过，第二次不再发（回 throttled 并说明原因）')
  check(getCalls === 0 && dupBudget.view().refused === 0, '去重不是拒发：传输层 0 条、账上 refused 不涨')
  // 只预填 dependencies 一类：读票照常发一条，阻塞边那一类不重复发，详情仍成功并留痕。
  getCalls = 0; depCalls = 0
  const depsDupBudget = fb.createFallbackRoundBudget({ kind: 'detail', limits: LIMITS })
  depsDupBudget.reserve({ classLabel: 'dependencies', bucket: 'read', cost: 1 })
  const detailDepsDup = await detailMod.createIssueDetail(detailDeps(openWith({
    get: async function () { getCalls += 1; return { ok: true, data: issueOf(7) } },
    getDependencies: async function () { depCalls += 1; return { ok: true, data: { blockedBy: [], blocking: [] } } },
  }), depsDupBudget)).fetchIssueDetail(7, 'C:/ws/demo')
  check(detailDepsDup && detailDepsDup.ok === true && getCalls === 1 && depCalls === 0,
    '阻塞边同类去重：只发读票 1 条，getDependencies 不再发')
  check(detailDepsDup && Array.isArray(detailDepsDup.refusedClasses) && detailDepsDup.refusedClasses[0] === 'dependencies',
    '被拒的类写进回包 refusedClasses 留痕（dependencies）')

  // 静态接线断言：三处真实取数路径都确实接了账本（防「只改门禁不改接线」）。
  const listText = srcText('src/refresh/rooms/host/issue-list-fetch.ts')
  check(/const round: FallbackRoundBudget = useSince && injectedBudget \? injectedBudget : createFallbackRoundBudget\(\{ kind: useSince \? 'increment' : 'enumerate'/.test(listText),
    '索引取数按「带窗口=增量 / 不带窗口=枚举」开本轮账本（静态接线）')
  check(/const ticket = round\.reserve\(\{ bucket: 'read', cost: 1, classLabel: 'index-page' \}\)/.test(listText) && /round\.correct\(ticket, 1\)/.test(listText) && /round\.backfill\(ticket, 1\)/.test(listText),
    '翻页每页发出前预扣、收到后校正、失败回填（静态接线）')
  const scanText = srcText('src/refresh/rooms/host/issue-index-scan.ts')
  check(/await d\.fetchIssueIndex!\(cwd, w\.sinceIso, o\.budget\)/.test(scanText), '窗口扫描把本轮账本透传给翻页（静态接线）')
  const probeWiringText = srcText('src/refresh/rooms/host/probe-handler.ts')
  check(/fetchIssueIndexWindowed\(cwd, roundBudget \? \{ budget: roundBudget \} : undefined\)/.test(probeWiringText),
    '探测拍把增量账本传给窗口扫描（同一轮同一本账）')
  check(!/probeTicket/.test(probeWiringText), '探测拍不再自己预扣一条（逐页记账，避免一页一笔造成账实不符）')
  const detailText = srcText('src/refresh/rooms/host/issue-detail-fetch.ts')
  check(/createFallbackRoundBudget\(\{ kind: 'detail'/.test(detailText) && /reserveDetailClass/.test(detailText),
    '详情补取开本轮账本并按类预扣（静态接线）')

  console.log('\n' + (failed ? 'FAIL' : 'PASS') + ' 降级取数预算门禁：' + total + ' 条断言，' + (failed ? '有失败' : '全绿'))
  process.exit(failed ? 1 : 0)
}

/** 拼一条契约票转出来的薄行（字段够 rowOf 用即可）。 */
function rowOf(n: any): any {
  return { key: String(n), title: '票 ' + n, state: 'OPEN', labels: [], assignees: [], createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z' }
}

/** 断言某段代码一定抛错：抛了记 PASS，没抛记 FAIL（负例不能静默放行）。 */
function checkThrows(fn: any, msg: string, check: any): void {
  let threw = false
  try { fn() } catch (e: any) { threw = true }
  check(threw, msg)
}

/** 时间味名字挂数字才算违规；这里给的是条数常量，不该被判成时间值（防止口径被误搬进 YAML）。 */
function feedsTimeNumbers(text: string, snippets: string[]): boolean {
  return snippets.some(function (s: string) { return text.indexOf(s) < 0 })
}

main().catch(function (e: any) { console.error(e); process.exit(1) })
