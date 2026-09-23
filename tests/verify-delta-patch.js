// verify-delta-patch.js —— 门禁：行级增量刷新只补变的那几条，且只走薄查询（#708 T4 第三批）
// 用法：在插件根目录执行 node tests/verify-delta-patch.js，可独立运行。
//
// 票面验收（#708）与「加固补充」逐条落到下面的断言上：
//   ① 关闭一张票 → 列表只改那一行、地图进度与计数跟着变、版本号变了；
//   ② **断言取数路径**：这一次只发出针对变的那几条的薄查询，整池重建一次都没被触发
//      —— 这一条是本门禁的重点：只看显示结果的话，整池重建也能让「只有那一行变了」看起来成立；
//   ③ 取数被丢弃后待办仍在、下次仍能发现（丢弃只清队列、不动水印）；
//   ④ 迟到的整池结果不许覆盖更新的增量结果（世代号）；
//   ⑤ 红线：deck.counts 是整仓口径，增量路径不许本地重算 —— 保持旧值并把 deck.partial 置真；
//   ⑥ 旧版本快照（没有本机制那块状态的老快照）被读到时整池重建一次，不许静默当新结构用。
// 假传输层照 tests/verify-gate-accounting.js 那份口径：真发出去的每一条都报给闸，argv 原样记下来给断言用。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const CWD = 'C:\\ws\\demo'
const WS = 'ws-demo'

function imp(rel) { return import(pathToFileURL(path.join(ROOT, rel)).href) }

async function main() {
  console.log('行级增量门禁（#708 T4：只补变的那几条、只走薄查询、水印与待办、世代号、counts 红线）')
  const delta = await imp(path.join('src', 'shared', 'refresh', 'delta.js'))
  const win = await imp(path.join('src', 'tracker', 'indexWindow.js').replace('src\\tracker', path.join('src', 'shared', 'tracker')))
  const budget = await imp(path.join('src', 'shared', 'refresh', 'budget.js'))
  const ledgerMod = await imp(path.join('src', 'host', 'refresh', 'ledger.js'))
  const gateMod = await imp(path.join('src', 'host', 'refresh', 'gate.js'))
  const patchMod = await imp(path.join('src', 'host', 'refresh', 'patch.js'))

  // ---- 假世界：一份内存快照、一个记账的传输层、一份可摆布的窗口索引 ----
  function row(n, state, updatedAt, title) {
    return { number: n, key: String(n), title: title || ('票 ' + n), state: state, updatedAt: updatedAt, labels: [], assignees: [], createdAt: '2026-09-01T00:00:00Z' }
  }
  // 时间要一致：水印离「现在」太久（超过 7 天）会被窗口规则判成整扫，那就测不到增量那条路了。
  const CLOCK0 = 1700000000000
  function freshSnapshot() {
    const issues = [row(101, 'OPEN', '2026-09-20T00:00:00Z'), row(102, 'OPEN', '2026-09-19T00:00:00Z'), row(103, 'OPEN', '2026-09-18T00:00:00Z')]
    return {
      ok: true, repo: { owner: 'o', name: 'r' }, workspaceRoot: CWD, version: 'v0', generatedMs: CLOCK0 - 60000,
      maps: [{ number: 100, key: '100', state: 'OPEN', updatedAt: '2026-09-17T00:00:00Z', tickets: [row(101, 'OPEN', '2026-09-20T00:00:00Z')] }],
      issues: issues, labels: [], deck: { counts: { open: 3, closed: 0, total: 3 }, partial: false, levels: [] },
      delta: { structureVersion: delta.DELTA_STRUCTURE_VERSION, watermarkMs: CLOCK0 - 3600000, generation: 3, pending: [], pendingAt: 0, pendingReason: '' },
    }
  }
  let store = freshSnapshot()
  let writes = 0
  const calls = []          // 真发出去的 gh 命令原文（断言取数路径就靠它）
  let windowIndex = null    // 窗口里取回来的索引（探针回包）
  const windowSince = []
  const transport = { requests: 0, points: 0 }
  let clock = CLOCK0
  const ledger = ledgerMod.createLedger({ now: () => clock })
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + budget.HOUR_MS }, graphql: { limit: 5000, remaining: 5000, reset: clock + budget.HOUR_MS } }, clock)
  const gate = gateMod.createGate({ ledger: ledger, now: () => clock })
  gate.setWorkspace(WS, { active: true })
  const logLines = []
  const logCtx = { isEnabled: (l) => l === 'debug', fire: (level, name, fields) => logLines.push({ level: level, name: name, fields: fields }) }
  // 闸的 send 与真发请求之间那层接线：与生产同一个形状（perform 里发、发完报给闸记账）。
  function sendThroughGate(req, perform) {
    return gate.send(req, async () => {
      const r = await perform()
      transport.requests += budget.PATCH_COST_REQUESTS
      gate.noteOutbound({ requests: budget.PATCH_COST_REQUESTS, points: 0 })
      return { requests: budget.PATCH_COST_REQUESTS, points: 0 }
    })
  }
  const patch = patchMod.createPatch({
    now: () => clock,
    logCtx: logCtx,
    workspaceKeyOf: () => WS,
    readSnapshot: async () => store,
    writeSnapshot: async (cwd, snap) => { writes += 1; store = snap },
    indexOfSnapshot: win.indexFromSnapshot,
    windowRules: win,
    getRepoKey: async () => ({ owner: 'o', name: 'r' }),
    probeIndex: async (cwd, sinceIso) => { windowSince.push(sinceIso); return { ok: true, index: windowIndex } },
    runGh: async (args) => {
      calls.push(args)
      const n = Number(args[1].split('/').pop())
      const nowRow = { number: n, title: '票 ' + n, state: 'closed', labels: [], assignees: [], user: { login: 'me' }, updated_at: '2026-09-23T00:00:00Z', created_at: '2026-09-01T00:00:00Z' }
      return { ok: true, text: JSON.stringify(nowRow) }
    },
    send: sendThroughGate,
    decide: (req) => gate.decideFor(req),
  })

  // ---- ① 关闭一张票：只改那一行、版本号变了、只走一条薄查询 ----
  const v0 = store.version
  const row102Before = store.issues[1]
  const row103Before = store.issues[2]
  const countsBefore = store.deck.counts
  windowIndex = { '101': 'CLOSED|2026-09-23T00:00:00Z', '102': 'OPEN|2026-09-19T00:00:00Z', '103': 'OPEN|2026-09-18T00:00:00Z' }
  const r1 = await patch.run(CWD)
  check(r1.mode === 'patch', '关掉 101 之后走的是行级补行（实得 ' + r1.mode + ' / ' + r1.reason + '，新增 ' + r1.added + '、消失 ' + r1.removed + '）')
  check(calls.length === 1, '②取数路径：这一次只发出 1 条请求（整池要 7 条），实发 ' + calls.length + ' 条')
  check(JSON.stringify(calls[0]) === JSON.stringify(['api', 'repos/o/r/issues/101', '--jq', '{number: .number, title: .title, state: .state, labels: .labels, assignees: .assignees, user: .user, updated_at: .updated_at, created_at: .created_at}']),
    '②取数路径：这一条正是「只问 101 这一张票」的薄查询（argv 原文比对）')
  check(calls.every((a) => a.indexOf('--paginate') < 0 && a.indexOf('issue') !== 0), '②取数路径：整池重建那条大查询一次都没被触发（没有 --paginate、没有 gh issue list）')
  check(store.issues.length === 3 && store.issues[1] === row102Before && store.issues[2] === row103Before, '只改那一行：102 与 103 还是原来那两个对象（位置与引用都没动）')
  check(store.issues[0].state === 'CLOSED' && store.issues[0].updatedAt === '2026-09-23T00:00:00Z', '被关掉那一行按薄查询的回包换成了新值（' + store.issues[0].state + '）')
  check(store.issues[0].title === '票 101', '换行用的是与全量取数同形的行（标题回来了）')
  check(store.version !== v0 && r1.version === store.version, '行级补丁产出了新版本号（' + v0 + ' → ' + store.version + '）')
  const m101 = (store.maps[0].tickets || [])[0]
  check(!m101 || m101.state === 'CLOSED', '地图里那张子票（101）也跟着换了行 —— 进度环按行算，所以它会跟着变')
  check(r1.partial === true && store.deck.partial === true, 'deck.partial 置真（这份行数据不全，界面显示待确认）')
  check(store.deck.counts === countsBefore && store.deck.counts.closed === 0 && store.deck.counts.open === 3,
    '⑤红线：deck.counts 保持旧值（整仓口径，本地数出来会是 open2/closed1），实得 ' + JSON.stringify(store.deck.counts))
  const st1 = await patch.state(CWD)
  check(st1.watermarkMs > 900000 && r1.watermarkMs === st1.watermarkMs, '水印在变化并进列表之后才推进（900000 → ' + st1.watermarkMs + '）')
  check(st1.generation === 4 && r1.generation === 4, '世代号推进一格（3 → ' + st1.generation + '）')
  check(st1.pending.length === 0, '并进去之后待办是空的（实得 ' + st1.pending.length + ' 条）')
  check(logLines.some((l) => l.name === 'refresh.patch' && l.fields.mode === 'patch' && l.fields.watermark === 'advanced'), '补行落了一行 refresh.patch（按需级、字段里不出现路径原文）')
  check(ledger.hour('plugin', 'rest').requests === 1 && ledger.view('graphql').used === 0,
    '②记账口径：这一条薄查询记在 REST 桶的请求数里（1 条），没被折成 GraphQL 的点数（graphql 用了 ' + ledger.view('graphql').used + ' 点）')

  // ---- ③ 取数被丢弃：待办仍在、水印不动、下次仍能发现 ----
  // 现场：探测已经说「102 关了」（那时还在看这个工作区），等真去取那一条时人已经切走 ——
  // 闸按「不在活跃集合里」把它推迟，推迟队列再过 5 分钟过期丢掉。丢的是那次请求，不是那条变化。
  windowIndex = { '101': 'CLOSED|2026-09-23T00:00:00Z', '102': 'CLOSED|2026-09-24T00:00:00Z', '103': 'OPEN|2026-09-18T00:00:00Z' }
  const callsBefore = calls.length
  const wmBefore = (await patch.state(CWD)).watermarkMs
  let fetchFlips = 0
  const patch2 = patchMod.createPatch({
    now: () => clock, logCtx: logCtx, workspaceKeyOf: () => WS,
    readSnapshot: async () => store, writeSnapshot: async (cwd, snap) => { writes += 1; store = snap },
    indexOfSnapshot: win.indexFromSnapshot, windowRules: win,
    getRepoKey: async () => ({ owner: 'o', name: 'r' }),
    probeIndex: async (cwd, sinceIso) => { windowSince.push(sinceIso); return { ok: true, index: windowIndex } },
    runGh: async (args) => { calls.push(args); return { ok: true, text: '{}' } },
    send: async (req, perform) => {
      // 探测放行之后、补行这一步之前，人切走了 → 闸这一笔按「不在活跃集合里」推掉。
      gate.setWorkspace(WS, { active: false })
      fetchFlips += 1
      const r = await sendThroughGate(req, perform)
      gate.setWorkspace(WS, { active: true })
      return r
    },
    decide: (req) => gate.decideFor(req),
  })
  const r2 = await patch2.run(CWD)
  const winIdx2 = windowSince.length - 1
  check(fetchFlips === 1 && r2.mode === 'deferred' && r2.reason === 'background-inactive', '③取数被推迟（' + r2.mode + ' / ' + r2.reason + '）')
  check(calls.length === callsBefore, '③被推迟的那一笔一条请求都没发（实得 ' + (calls.length - callsBefore) + ' 条）')
  const st2 = await patch.state(CWD)
  check(st2.pending.length === 1 && st2.pending[0] === '102', '③变化进了持久化待办（待办 ' + JSON.stringify(st2.pending) + '）')
  check(st2.watermarkMs === wmBefore, '③水印一个字节都没动（仍是 ' + st2.watermarkMs + '）')
  check(store.issues[1].state === 'OPEN', '③被推迟的那一行没有被并进列表（列表还是旧的）')
  // 「丢弃只清队列、不动水印」：闸那边把推迟队列过期丢掉，待办必须还在。
  const drain = gate.drain(clock + budget.DEFER_EXPIRY_MS + 1)
  check(drain.dropped >= 1 && drain.pending === 0, '③推迟队列被丢弃（丢掉 ' + drain.dropped + ' 条、队列清零）')
  check((await patch.state(CWD)).pending.length === 1, '③队列丢了，待办仍在（丢弃只清队列）')
  check((await patch.state(CWD)).watermarkMs === wmBefore, '③丢弃之后水印仍然没动')
  clock += budget.DEFER_EXPIRY_MS + 60000
  const r3 = await patch.run(CWD)
  const winIdx3 = windowSince.length - 1
  check(r3.mode === 'patch' && r3.rows.length === 1 && r3.rows[0] === '102', '③下一次仍然发现了同一条变化并补上了它（' + JSON.stringify(r3.rows) + '）')
  check((await patch.state(CWD)).pending.length === 0, '③补上之后待办清空')
  check(windowSince[winIdx2] === windowSince[winIdx3], '③被推迟那一次与下一次问的是同一个窗口起点（水印没动，那条变化没掉出窗口）')
  check(transport.requests > 0 && gate.stats().accounted.requests === transport.requests && gate.stats().escaped.requests === 0,
    '闸的账 == 真发出去了几条（闸 ' + gate.stats().accounted.requests + ' / 传输层 ' + transport.requests + '，漏网 ' + gate.stats().escaped.requests + '）')

  // ---- ④ 迟到的整池结果不许覆盖更新的增量结果 ----
  const staleRebuild = Object.assign({}, freshSnapshot(), { version: 'from-rebuild', generatedMs: clock + 5 })
  const admitted = await patch.admitSnapshot(CWD, staleRebuild, 3)   // 整池在世代 3 发起，回来时增量已经推到 4
  check(admitted.accepted === false && admitted.reason === 'stale-result', '④迟到的整池结果被丢掉（' + admitted.reason + '）')
  check(store.version !== 'from-rebuild' && store.issues[0].state === 'CLOSED', '④面板上仍是增量结果，没被整池顶掉（版本 ' + store.version + '）')
  const freshRebuild = Object.assign({}, freshSnapshot(), { version: 'v-fresh' })
  const admitted2 = await patch.admitSnapshot(CWD, freshRebuild, (await patch.state(CWD)).generation)
  check(admitted2.accepted === true && store.version === 'v-fresh', '④同一世代发起的整池结果照收（世代 → ' + admitted2.generation + '）')

  // ---- ⑥ 旧结构的快照：整池重建一次，不许静默当新结构用 ----
  const legacy = freshSnapshot()
  delete legacy.delta
  store = legacy
  const rLegacy = await patch.run(CWD)
  check(rLegacy.mode === 'rebuild' && rLegacy.reason === 'legacy-structure', '⑥读到没有新状态字段的老快照 → 整池重建一次（' + rLegacy.reason + '）')
  store = null
  check((await patch.run(CWD)).reason === 'no-baseline', '⑥手上没有列表（冷启动）→ 整池')
  store = freshSnapshot()
  store.delta.pending = ['102']
  const entered = await patch.enterWorkspace(CWD)
  check(entered.mode === 'rebuild' && entered.reason === 'pending-todo' && (await patch.state(CWD)).pending.length === 0,
    '⑥切进工作区：有待办就整池，并清掉待办（' + entered.reason + '）')

  // ---- 票号增减与「变的行太多」都交给整池 ----
  windowIndex = { '101': 'OPEN|2026-09-20T00:00:00Z', '102': 'OPEN|2026-09-19T00:00:00Z', '103': 'OPEN|2026-09-18T00:00:00Z', '104': 'OPEN|2026-09-25T00:00:00Z' }
  const rAdd = await patch.run(CWD)
  check(rAdd.mode === 'rebuild' && rAdd.reason === 'ticket-set-changed' && rAdd.added === 1, '出现没见过的票号 → 整池（' + rAdd.reason + '，新增 ' + rAdd.added + ' 条）')
  // 删票只有「整扫重置基线」那一趟看得见（增量算式只增不减，把这当成增量去比永远比不出来）。
  windowIndex = { '100': 'OPEN|2026-09-17T00:00:00Z', '101': 'OPEN|2026-09-20T00:00:00Z', '103': 'OPEN|2026-09-18T00:00:00Z' }
  const rDel = await patch.run(CWD, { full: true })
  check(rDel.mode === 'rebuild' && rDel.reason === 'ticket-set-changed' && rDel.removed === 1, '有票号消失了 → 整池（整扫重置基线才发现得了，' + rDel.reason + '，少 ' + rDel.removed + ' 条）')
  const wide = freshSnapshot()
  wide.issues = []
  for (let i = 1; i <= 9; i++) wide.issues.push(row(200 + i, 'OPEN', '2026-09-01T00:00:00Z'))
  store = wide
  const wideWin = {}
  wide.issues.forEach(function (r, i) { wideWin[String(r.number)] = (i === 0 ? 'CLOSED' : 'OPEN') + '|2026-09-26T00:00:00Z' })
  windowIndex = wideWin
  const callsWide = calls.length
  const rWide = await patch.run(CWD)
  check(rWide.mode === 'rebuild' && rWide.reason === 'too-many-rows' && calls.length === callsWide,
    '一次变了 ' + wide.issues.length + ' 行（超过上限 ' + patch.threshold.maxRows + '）→ 整池，且一条请求都没发')

  // ---- 纯逻辑那一侧（delta.js）的几条独立断言 ----
  const p = delta.planDelta({ '1': 'OPEN|x' }, { '1': 'CLOSED|x' })
  check(p.mode === 'patch' && p.changed.length === 1 && p.merged['1'] === 'CLOSED|x', 'delta.planDelta：既有的票内容变了 → patch（并把增量并进基线）')
  check(delta.watermarkAfter({ previousMs: 900, scanStartedMs: 1000, outcome: 'deferred' }).watermarkMs === 900, 'delta.watermarkAfter：被推迟时水印不动')
  check(delta.watermarkAfter({ previousMs: 900, scanStartedMs: 1000, outcome: 'dropped' }).toPending === true, 'delta.watermarkAfter：被丢弃时要进待办')
  check(delta.watermarkAfter({ previousMs: 900, scanStartedMs: 1000, outcome: 'merged' }).watermarkMs === 1000, 'delta.watermarkAfter：并进列表之后才推进到扫描起点')
  const mr = delta.mergeRows([row(1, 'OPEN', 'a')], [row(1, 'CLOSED', 'b')], 'v7')
  check(mr.replaced.length === 1 && mr.version !== 'v7' && mr.rows[0].state === 'CLOSED', 'delta.mergeRows：换行 + 版本号必变' + (mr.version !== 'v7' ? '' : '（版本号没变，红）'))
  check(delta.mergeRows([row(1, 'OPEN', 'a')], [row(9, 'OPEN', 'b')], 'v7').missing.length === 1, 'delta.mergeRows：列表里没有这一行 → missing（交给整池）')
  const d1 = delta.derivedAfter('patch')
  check(d1.countsAction === 'keep-old-and-mark-pending' && d1.markPartial === true, 'delta.derivedAfter(patch)：计数保持旧值 + 标待确认')
  check(delta.derivedAfter('rebuild').countsAction === 'recompute', 'delta.derivedAfter(rebuild)：整池拿得到整仓计数，照它自己的判定重算')
  check(delta.checkStructure({}).action === 'rebuild' && delta.checkStructure({ structureVersion: delta.DELTA_STRUCTURE_VERSION }).action === 'use',
    'delta.checkStructure：老快照整池、当前结构直接用')

  console.log(failed ? '\n存在失败 — verify-delta-patch 未通过' : '\n全部通过 — 行级增量门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
