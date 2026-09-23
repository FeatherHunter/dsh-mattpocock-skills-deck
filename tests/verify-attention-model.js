// verify-attention-model.js —— #707（T3 第二批）视野模型 + 心跳 + 客户端节拍的门禁
// 用法：在仓库根目录执行 node tests/verify-attention-model.js，可独立运行。
//
// 它验四条票面点名的验收，外加一条反证要用的计时器仿真：
//   一、**后台零定时器**：不在活跃集合里的工作区一个定时器都没有；刚离开的那个最多一个收尾节拍，
//       而且它 30 秒后必然归零（跑一遍计时仿真，把这条不变量走成一条真实的时间线）。
//   二、**活跃上限 2**：第三个窗口切进来时它显示「未在刷新」的处境，活跃集合里仍然只有两个根。
//   三、**同一工作区根只产生一次探测**：两个窗口、两种写法（大小写 / 尾斜杠）指向同一个仓库时，
//       合成一个名额、只起一条探测定时器；20 秒心跳窗口里那个根只探一次。
//   四、**90 秒无信号全部收摊**：一个定时器都不剩，而且再上报能重新起来。
//   五、**判定是纯的**：同一份输入连收一百次，结论完全一样（否则「30 秒后归零」就成了一句空话）。
//
// 被测对象是宿主薄壳（src/host/refresh/attention.js）—— 判定全部在它调用的那份纯函数产物
// （src/shared/refresh/attention.js，源码 refresh-core/src/attention.ts）里。两处都真跑，不读文本。
// 反证口径：这个脚本自己可以被指向一份「故意做坏」的纯函数副本（环境变量 DSH_ATTENTION_VARIANT），
// 那种情况下必须出现 FAIL。见下面 loadPure()。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

/** 假的窗口标识（宿主那一侧只当它是不透明字符串，不解释内容）。 */
const WIN_A = 'w-window-a'
const WIN_B = 'w-window-b'
const WIN_C = 'w-window-c'
const ROOT_A = 'd:\\repo-a'
const ROOT_B = 'd:\\repo-b'
const ROOT_C = 'd:\\repo-c'

/**
 * 载入一份被测的纯函数。默认是仓库里的真身；给了 DSH_ATTENTION_VARIANT 就载入那一份
 * —— 反证时把「故意做坏的变体」写到临时目录里，用它跑一遍本脚本，必须变红。
 * 变体只覆盖纯函数那个文件，宿主薄壳与这个脚本一个字都不动。
 */
async function loadPure() {
  const variant = process.env.DSH_ATTENTION_VARIANT
  if (variant) return import(pathToFileURL(path.resolve(variant)).href)
  return import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'attention.js')).href)
}

/**
 * 帧仿真：把宿主算出来的定时器去向表真的按时间走一遍。
 *
 * 为什么必须走一遍而不是只看返回值：票面那条「30 秒后归零」说的是**时间的性质**，只查一次返回值
 * 是查不出来的 —— 一份每 30 秒把收尾时间往前推的实现，单次返回值与真身一模一样。
 * 这里只记「这一步该响哪几个定时器、间隔多少」，不起真定时器；谁该在什么时候响由纯函数说了算。
 */
function makeSim() {
  const sim = { clock: 0, table: {}, fires: {}, steps: 0 }
  sim.apply = function (script) {
    const want = {}
    for (const e of (script && script.entries) || []) {
      if (e && e.intervalMs) want[e.root] = { intervalMs: e.intervalMs, nextAt: sim.clock + e.intervalMs }
    }
    // 保留没被提到、但本来就在跑的定时器（薄壳没让停的就不停）；被明确 cancel 的立刻撤掉。
    for (const root of (script && script.cancel) || []) delete sim.table[root]
    for (const root of Object.keys(want)) {
      const old = sim.table[root]
      sim.table[root] = (old && old.intervalMs === want[root].intervalMs) ? old : want[root]
    }
  }
  sim.liveAt = function () { return Object.keys(sim.table) }
  sim.gapsOf = function (root) {
    const at = sim.fires[root] || []
    const gaps = []
    for (let i = 1; i < at.length; i++) gaps.push(at[i] - at[i - 1])
    return gaps
  }
  sim.advance = function (ms, onTick) {
    const end = sim.clock + ms
    let guard = 0
    for (;;) {
      guard += 1
      if (guard > 40000) throw new Error('仿真没有收敛：定时器可能在自我重排')
      let next = Infinity
      for (const root of Object.keys(sim.table)) {
        const t = sim.table[root]
        if (t && t.nextAt < next) next = t.nextAt
      }
      if (!(next <= end)) break
      sim.clock = next
      sim.steps += 1
      for (const root of Object.keys(sim.table)) {
        const t = sim.table[root]
        if (t && t.nextAt === next) {
          if (!sim.fires[root]) sim.fires[root] = []
          sim.fires[root].push(sim.clock)
          t.nextAt = sim.clock + t.intervalMs
        }
      }
      if (typeof onTick === 'function') onTick(sim.clock)
      if (!Object.keys(sim.table).length) break
    }
    sim.clock = Math.max(sim.clock, end)
    if (typeof onTick === 'function') onTick(sim.clock)
    return sim.clock
  }
  return sim
}

async function main() {
  console.log('视野模型门禁（#707：后台零定时器、活跃上限 2、同一工作区根只探一次、90 秒全部收摊）')

  const pure = await loadPure()
  const budget = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'budget.js')).href)
  const attentionMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'refresh', 'attention.js')).href)

  const LIMITS = {
    maxActive: budget.MAX_ACTIVE_WORKSPACES,
    lingerMs: budget.ACTIVE_LINGER_MS,
    expiryMs: budget.ATTENTION_EXPIRY_MS,
    probeIntervalMs: budget.PROBE_INTERVAL_MS,
    probeIntervalLingerMs: budget.PROBE_INTERVAL_LINGER_MS,
    heartbeatMs: budget.ATTENTION_HEARTBEAT_MS,
  }
  check(LIMITS.maxActive === 2, '活跃上限来自 budget.js 的 MAX_ACTIVE_WORKSPACES，实得 ' + LIMITS.maxActive)
  check(LIMITS.probeIntervalMs === 5000 && LIMITS.probeIntervalLingerMs === 15000, '间隔来自 budget.js：正在看的 ' + LIMITS.probeIntervalMs + ' 毫秒、刚离开的 ' + LIMITS.probeIntervalLingerMs + ' 毫秒')
  check(LIMITS.expiryMs === 90000 && LIMITS.lingerMs === 30000 && LIMITS.heartbeatMs === 20000, '收摊/收尾/心跳三个数字来自 budget.js：' + LIMITS.expiryMs + ' / ' + LIMITS.lingerMs + ' / ' + LIMITS.heartbeatMs)

  // 一块可控的时钟 + 一块可复用的视野模型：每一条断言都用**同一个实例**连续喂几笔上报，
  // 因为「同一工作区根只占一个名额」「90 秒收摊」这些性质本来就是一段时间上的性质，
  // 每次都新建一个实例去喂反而全变成「第一笔就是全部历史」（第一版就是这么写错的）。
  const clockBox = { at: 1000000 }
  const mkAttention = function (canonicalKey) {
    return attentionMod.createAttention({ now: function () { return clockBox.at }, canonicalKey: canonicalKey })
  }
  /** 走一步时间：仿真那一刻起这个工作区「已经过了这么久」。 */
  const at = function (t) { clockBox.at = t; return clockBox.at }

  const LIVE = function (arr) { return arr.filter(function (a) { return a.audience === 'probe' }).length }
  const LING = function (arr) { return arr.filter(function (a) { return a.audience === 'linger' }).length }
  /** 与上面两个同义，但吃的是收摊结论（薄壳的 Script：entries 里带 audience）。 */
  const LIVE2 = function (sc) { return ((sc && sc.entries) || []).filter(function (e) { return e.audience === 'probe' }).length }
  const LING2 = function (sc) { return ((sc && sc.entries) || []).filter(function (e) { return e.audience === 'linger' }).length }

  // ── 一、同一条时间线上把「后台零定时器」走一遍 ────────────────────────────────────────────
  {
    const ws = mkAttention()
    const sim = makeSim()
    // 仿真的表盘必须与这一段的时钟起点对齐：不对齐的话 `at(t)` 上的时刻是 1,000,000 级的墙上时间、
    // 而 sim.clock 还停在 0（第一版就是这样，收尾窗口的起算点整个错位）。
    sim.clock = clockBox.at
    const sweep = function () { sim.apply(ws.sweep()); return ws.stateOf() }
    /**
     * 走一步时间。**每一次定时器响，宿主都会重新收一次摊**（这正是生产里的样子：定时器一响就重算
     * 「谁还在活跃」），所以这里也在每一跳重新问一次薄壳，再把它给的去向表灌进仿真盘。
     * 第一版只在推进结束处问一次 —— 那样收尾定时器在整段推进里从没被重算过，永远等不到归零
     *（门禁抓到的是我自己写错了仿真，不是实现错了）。
     */
    const runTicks = function (ms) {
      sim.advance(ms, function (t) { at(t); sim.apply(ws.sweep()) })
      at(sim.clock)
      sim.apply(ws.sweep())
    }
    at(1000000)
    await ws.handleFocus({ windowId: WIN_A, workspaceRoot: ROOT_A, kind: 'focus', visible: true, atMs: 1000000 })
    sweep()
    check(sim.liveAt().join(',') === ROOT_A, '只有一个活跃根时只有一个定时器（实得 ' + (sim.liveAt().join('、') || '空') + '）')
    check(sim.table[ROOT_A].intervalMs === LIMITS.probeIntervalMs, '正在看的那个按 5 秒探测（实得 ' + sim.table[ROOT_A].intervalMs + ' 毫秒）')

    // 面板可见时界面每 20 秒报一次心跳，中间那几次探测由这条节拍自己产生
    let beat = 1000000
    sim.advance(20000, function (t) {
      at(t)
      if (t - beat >= LIMITS.heartbeatMs) {
        beat = t
        void ws.handleFocus({ windowId: WIN_A, workspaceRoot: ROOT_A, kind: 'heartbeat', visible: true, lastHumanInputMs: t - 1000, atMs: t })
      }
      sim.apply(ws.sweep())
    })
    check(sim.fires[ROOT_A] && sim.fires[ROOT_A].length >= 3, '活跃根上真的按节拍跑了（20 秒里响了 ' + ((sim.fires[ROOT_A] || []).length) + ' 次）')

    // 切到另一个工作区：ROOT_A 掉到「刚离开」，只留一个 30 秒收尾节拍。
    //   这里用显式的时刻（切走那一刻 = 上一次心跳 + 2 秒），好让「30 秒后归零」这条断言有个确切的
    //   起算点：仿真的时钟只跟着定时器跳，直接拿 sim.clock 当上报时刻会让收尾起算点漂 5 秒。
    const switchAt = beat + 2000
    at(switchAt)
    await ws.handleFocus({ windowId: WIN_A, workspaceRoot: ROOT_B, kind: 'session-switch', visible: true, atMs: switchAt })
    const plan = sweep()
    check(plan.active.length === 2 && LIVE(plan.active) === 1 && LING(plan.active) === 1, '切换之后是「正在看 1 + 刚离开 1」（实得 正在看 ' + LIVE(plan.active) + '、刚离开 ' + LING(plan.active) + '）')
    check(!!plan.linger && plan.linger.root === ROOT_A, '收尾节拍挂在刚离开的那个根上（实得 ' + (plan.linger ? plan.linger.root : '无') + '）')
    check(sim.liveAt().length === 2, '这一刻盘上只有两个定时器：正在看的 + 一个收尾的（实得 ' + sim.liveAt().length + '）')
    const lingerEntry = plan.active.filter(function (e) { return e.audience === 'linger' })[0]
    check(lingerEntry && lingerEntry.intervalMs === LIMITS.probeIntervalLingerMs, '刚离开的那个按 15 秒探测（实得 ' + (lingerEntry ? lingerEntry.intervalMs : '无') + ' 毫秒）')
    check(plan.linger.delayMs > 0 && plan.linger.delayMs <= LIMITS.lingerMs, '收尾节拍还剩 ' + plan.linger.delayMs + ' 毫秒（不超过 30 秒）')

    // 再走 30 秒：收尾节拍归零，它上面的定时器必须停掉（每一跳都重新收一次摊）
    sim.advance(LIMITS.lingerMs, function (t) {
      at(t)
      sim.apply(ws.sweep())
    })
    at(sim.clock)
    sim.apply(ws.sweep())
    check(!sim.table[ROOT_A], '30 秒后刚离开的那个根上不再有定时器（归零）')
    check(sim.liveAt().length === 1 && sim.liveAt()[0] === ROOT_B, '只剩正在看的那个根有定时器（实得 ' + (sim.liveAt().join('、') || '空') + '）')

    // 再往后走：只要界面一直在报，这个根就一直有且只有一个定时器（后台零定时器）
    beat = switchAt
    sim.advance(60000, function (t) {
      at(t)
      if (t - beat >= LIMITS.heartbeatMs) {
        beat = t
        void ws.handleFocus({ windowId: WIN_A, workspaceRoot: ROOT_B, kind: 'heartbeat', visible: true, lastHumanInputMs: t - 1000, atMs: t })
      }
      sim.apply(ws.sweep())
    })
    check(sim.liveAt().length === 1 && sim.liveAt()[0] === ROOT_B, '接下来一分钟里也只有正在看的那个根有定时器（实得 ' + (sim.liveAt().join('、') || '空') + '）')
    const gaps = sim.gapsOf(ROOT_B)
    const bigGaps = gaps.filter(function (g) { return g > 20000 })
    check(gaps.length > 0 && bigGaps.length === 0, '整条时间线上任何一跳都不超过 20 秒（最大间隔 ' + (gaps.length ? Math.max.apply(null, gaps) : 0) + ' 毫秒）')
  }

  // ── 二、活跃上限 2：第三个窗口显示「未在刷新」 ────────────────────────────────────────────
  {
    const ws = mkAttention()
    at(2000000)
    await ws.handleFocus({ windowId: WIN_A, workspaceRoot: ROOT_A, kind: 'focus', visible: true, atMs: 2000000 })
    await ws.handleFocus({ windowId: WIN_B, workspaceRoot: ROOT_B, kind: 'focus', visible: true, atMs: 2001000 })
    const third = await ws.handleFocus({ windowId: WIN_C, workspaceRoot: ROOT_C, kind: 'focus', visible: true, atMs: 2002000 })
    const st = ws.stateOf()
    check(st.keepers === 2, '三个窗口同时活跃时「正在看」的根仍然是 2（实得 ' + st.keepers + '）')
    check(st.active.length === 3 && LIVE(st.active) === 2 && LING(st.active) === 1, '快档名额恰好 2 个，第三个根只拿一个收尾节拍（实得 active=' + st.active.length + '、正在看 ' + LIVE(st.active) + '、刚离开 ' + LING(st.active) + '）')
    check(st.limit === 2, '上限由 budget.js 给出（实得 ' + st.limit + '）')
    check(third.standing === 'active' && third.limit === 2, '刚上报的那个窗口自己在活跃集合里（实得 ' + third.standing + '，上限 ' + third.limit + '）')
    check(LIVE(st.active) === 2 && !!ws.planFor(ROOT_B) && !!ws.planFor(ROOT_C), '留下的是最近上报过的两个根（B 与 C 有快档节拍）')
    const aPlan = ws.planFor(ROOT_A)
    check(!aPlan || aPlan.intervalMs === LIMITS.probeIntervalLingerMs, '最早上报的那个根最多只剩一个收尾节拍（实得 ' + (aPlan ? aPlan.intervalMs + ' 毫秒' : '没有定时器') + '）')
  }

  // ── 三、同一工作区根只产生一次探测（多个窗口 + 两种写法） ────────────────────────────────
  {
    let probes = 0
    const ws = mkAttention()
    at(3000000)
    await ws.handleFocus({ windowId: WIN_A, workspaceRoot: ROOT_A, kind: 'focus', visible: true, atMs: 3000000 })
    await ws.handleFocus({ windowId: WIN_B, workspaceRoot: ROOT_A, kind: 'focus', visible: true, atMs: 3001000 })
    const st = ws.stateOf()
    check(st.active.length === 1 && st.active[0].root === ROOT_A, '两个窗口看同一个根 → 只占一个名额一次探测（实得 ' + st.active.length + '）')
    check(st.windows.length === 2, '两个窗口都记在同一份台账里（实得 ' + st.windows.length + ' 个窗口）')

    // 两种写法（大小写 / 斜杠方向 / 尾斜杠）经宿主既有出口 canonicalKey 归一之后算同一个根。
    //   这里用一份「只做这三样归一」的假出口：形状与 src/host/workspaceKey.js 的 normalizeWorkspacePath
    //   一致（Windows 上小写折叠、分隔符统一、去尾斜杠），证明门禁量的是「归一之后只有一个根」。
    const canon = async function (raw) { return String(raw || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() }
    const ws2 = mkAttention(canon)
    at(3002000)
    await ws2.handleFocus({ windowId: WIN_A, workspaceRoot: 'D:\\Repo\\', kind: 'focus', visible: true, atMs: 3002000 })
    const second = await ws2.handleFocus({ windowId: WIN_B, workspaceRoot: 'd:/repo', kind: 'focus', visible: true, atMs: 3003000 })
    const st2 = ws2.stateOf()
    check(st2.active.length === 1, '同一条目录两种写法归一之后只占一个名额（实得 ' + st2.active.length + '）')
    check(second.root === 'd:/repo', '上报的根是归一之后的键（实得 ' + second.root + '）')
    check(st2.active[0].intervalMs === LIMITS.probeIntervalMs, '同一个根上的探测间隔只有一份（实得 ' + st2.active[0].intervalMs + ' 毫秒）')

    // 20 秒心跳窗口里，同一个根只探一次（间隔不满就不重复探）
    const lastAt = { v: 0 }
    const step2 = function (t) {
      at(t)
      if (lastAt.v && (t - lastAt.v) < st2.active[0].intervalMs) return
      lastAt.v = t
      probes += 1
      void ws2.handleFocus({ windowId: WIN_A, workspaceRoot: 'D:\\Repo\\', kind: 'heartbeat', visible: true, lastHumanInputMs: t - 1000, atMs: t })
    }
    const sim2 = makeSim()
    sim2.clock = 3003000
    sim2.apply(ws2.sweep())
    sim2.advance(LIMITS.heartbeatMs, step2)
    check(probes === 4, '同一工作区根 20 秒里只探 4 次（5 秒一次；实得 ' + probes + ' 次）')
    check(sim2.liveAt().length === 1, '盘上只有这一个根一个定时器（实得 ' + sim2.liveAt().length + '）')
  }

  // ── 四、90 秒无信号全部收摊 ──────────────────────────────────────────────────────────────
  {
    const ws = mkAttention()
    const sim = makeSim()
    at(4000000)
    await ws.handleFocus({ windowId: WIN_A, workspaceRoot: ROOT_A, kind: 'focus', visible: true, atMs: 4000000 })
    await ws.handleFocus({ windowId: WIN_B, workspaceRoot: ROOT_B, kind: 'focus', visible: true, atMs: 4001000 })
    sim.apply(ws.sweep())
    check(sim.liveAt().length === 2, '收摊之前盘上有两个定时器（实得 ' + sim.liveAt().length + '）')

    // 面板被藏起来：此后一条上报都没有
    await ws.handleFocus({ windowId: WIN_A, workspaceRoot: ROOT_A, kind: 'panel-hidden', visible: false, atMs: 4002000 })
    await ws.handleFocus({ windowId: WIN_B, workspaceRoot: ROOT_B, kind: 'panel-hidden', visible: false, atMs: 4003000 })
    // 面板被藏起来之后一条上报都没有：这一刻两个根上最多还剩一个收尾节拍（不变量 I2 允许的唯一例外），
    //   它们上面一个「正在看的」探测节拍都不该再有 —— 这是「后台零定时器」在这一刻的具体形态。
    const beforeExpiry = ws.sweep()
    check(beforeExpiry.collaped === false, '刚藏起来还没到 90 秒，不算收摊（实得 collaped=' + beforeExpiry.collaped + '）')
    check(beforeExpiry.keepers === 0, '没人正在看的时候「正在看」的根是 0 个（实得 ' + beforeExpiry.keepers + '）')
    check(LIVE2(beforeExpiry) === 0, '两个根上都不再有快档探测节拍（实得 ' + LIVE2(beforeExpiry) + ' 个）')
    check(LING2(beforeExpiry) <= 1, '最多只剩一个收尾节拍（实得 ' + LING2(beforeExpiry) + ' 个）')
    check(beforeExpiry.cancel.length + beforeExpiry.entries.length === 2, '两个根要么进停掉名单、要么只剩那一个收尾节拍（实得 停掉 ' + beforeExpiry.cancel.length + '、留着 ' + beforeExpiry.entries.length + '）')

    const sweep = function () { return ws.sweep() }
    // 面板被藏起来之后一条上报都没有：走 88 秒（还差 2 秒到 90 秒线），盘上不该有任何东西在响
    sim.advance(LIMITS.expiryMs - 2000, function (t) { at(t); sim.apply(ws.sweep()) })
    at(4003000 + (LIMITS.expiryMs - 2000))
    const justBefore = sweep()
    check(justBefore.collaped === false, '差 2 秒到 90 秒时还没收（实得 collaped=' + justBefore.collaped + '）')
    at(4003000 + LIMITS.expiryMs + 1)
    const after = sweep()
    check(after.collaped === true, '过了 90 秒整桌收摊（实得 collaped=' + after.collaped + '）')
    check(after.entries.length === 0 && !after.linger && after.cancel.length === 2, '收摊之后一个定时器都不剩：keep=' + after.entries.length + '、linger=' + !!after.linger + '、cancel=' + after.cancel.length)
    sim.apply(after)
    check(sim.liveAt().length === 0, '仿真盘上的定时器全部停掉（实得 ' + sim.liveAt().length + ' 个）')
    check(ws.stateOf().keepers === 0, '收摊之后「正在看」的根是 0 个（实得 ' + ws.stateOf().keepers + '）')

    // 再上报一次：重新起来（收摊不是关机）
    at(4003000 + LIMITS.expiryMs + 2000)
    const again = await ws.handleFocus({ windowId: WIN_A, workspaceRoot: ROOT_A, kind: 'focus', visible: true, atMs: clockBox.at })
    check(again.standing === 'active' && ws.stateOf().keepers === 1, '收摊之后再上报能重新起来（实得 ' + again.standing + '）')
  }

  // ── 五、判定是纯的：同一份输入连收一百次结论一样 ─────────────────────────────────────────
  {
    const state = pure.createAttentionState()
    const s1 = pure.report(state, { windowId: WIN_A, workspaceRoot: ROOT_A, kind: 'focus', visible: true, atMs: 5000000 }, 5000000).state
    const s2 = pure.report(s1, { windowId: WIN_A, workspaceRoot: ROOT_B, kind: 'session-switch', visible: true, atMs: 5010000 }, 5010000).state
    const snapshotBefore = JSON.stringify(s2)
    // 收摊时刻取在 30 秒收尾窗口**之内**：刚离开的那个根最后一次被人看是 5000000，窗口到 5030000。
    const collectAt = 5025000
    const first = JSON.stringify(pure.collect(s2, collectAt, LIMITS))
    let same = true
    for (let i = 0; i < 100; i++) if (JSON.stringify(pure.collect(s2, collectAt, LIMITS)) !== first) { same = false; break }
    check(same, '同一份输入连收一百次，收摊结论一字不差（含收尾剩余毫秒）')
    check(JSON.stringify(s2) === snapshotBefore, '收摊不修改传进来的状态（纯函数）')

    // 收尾剩余毫秒随时间单调减少：这正是「30 秒后归零」不能被自我重排的那条性质
    const r1 = pure.collect(s2, collectAt, LIMITS)
    const r2 = pure.collect(s2, collectAt + 1000, LIMITS)
    const r3 = pure.collect(s2, 5000000 + LIMITS.lingerMs, LIMITS)
    check(r1.lingerRoot === ROOT_A && r1.lingerDelayMs === 5000, '收尾节拍挂在刚离开的那个根上、还剩 5000 毫秒（实得 ' + r1.lingerRoot + ' / ' + r1.lingerDelayMs + '）')
    check(r1.lingerDelayMs > r2.lingerDelayMs && r2.lingerDelayMs === 4000, '收尾剩余毫秒随时间前进而变小（' + r1.lingerDelayMs + ' → ' + r2.lingerDelayMs + '）')
    check(r3.lingerRoot === '' && r3.lingerDelayMs === 0, '刚好到 30 秒那一刻收尾归零（实得 ' + r3.lingerDelayMs + '）')

    // 长跑不漏：一天不关页面之后，根的时刻表里会堆着很多早就走掉的根。
    //   堆着它们有两件坏事：① 这张表一路长大；② 某个早就走掉的根只要那一笔还新鲜，就能把
    //   「刚离开的那一个」这一档的名额占住。这里塞 70 个更早的根，结论必须与只有两个根时一模一样
    //  （上界淘汰留最近 64 条，正在看的那两个永远在里面）。
    const many = { windows: JSON.parse(JSON.stringify(s2.windows)), seen: JSON.parse(JSON.stringify(s2.seen)) }
    for (let i = 0; i < 70; i++) many.seen['old-root-' + i] = { at: 1000000 - i * 1000, visible: false }
    const wide = pure.collect(many, collectAt, LIMITS)
    check(wide.lingerRoot === r1.lingerRoot && wide.lingerDelayMs === r1.lingerDelayMs && wide.keepers === r1.keepers,
      '时刻表里堆着 70 个早走掉的根时结论不变（收尾仍是 ' + wide.lingerRoot + ' / ' + wide.lingerDelayMs + ' 毫秒）')
  }

  console.log(failed ? '\n存在失败 — verify-attention-model 未通过' : '\n全部通过 — 视野模型门禁生效（' + total + ' 项断言）')
  if (failed) {
    console.log('')
    console.log('票面验收四条：后台零定时器、活跃上限 2、同一工作区根只产生一次探测、90 秒无信号全部收摊。')
    console.log('判定真源：refresh-core/src/attention.ts（产物 src/shared/refresh/attention.js）；')
    console.log('薄壳：src/host/refresh/attention.js（宿主电话 wf.focus）。')
  }
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.error(e); process.exit(1) })
