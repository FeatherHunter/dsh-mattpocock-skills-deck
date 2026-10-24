// verify-delta-patch.ts —— 门禁：行级增量刷新只补变的那几条，且只走薄查询（#708 T4 第三批）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-delta-patch.ts，可独立运行。
//
// 票面验收（#708）与「加固补充」逐条落到下面的断言上：
//   ① 关闭一张票 → 列表只改那一行、地图进度与计数跟着变、版本号变了；
//   ② **断言取数路径**：这一次只经会话问变的那几条，整池 list 一次都没被触发
//      —— 这一条是本门禁的重点：只看显示结果的话，整池重建也能让「只有那一行变了」看起来成立；
//   ③ 取数失败后待办仍在、下次仍能发现（水印不动，那条变化没掉出窗口）；
//   ④ 迟到的整池结果不许覆盖更新的增量结果（世代号）；
//   ⑤ 红线：deck.counts 是整仓口径，增量路径不许本地重算 —— 保持旧值并把 deck.partial 置真；
//   ⑥ 旧版本快照（没有本机制那块状态的老快照）被读到时整池重建一次，不许静默当新结构用。
// 假会话照 #1444 口径：薄行只经只读会话取数、不经闸 send、不花额度；问过的票号原样记下来给断言用。
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
  const delta = await imp(path.join('src', 'refresh', 'kernel', 'snapshot-diff.js'))
  // 2026-10-17 修：原来写成 path.join('src','tracker','indexWindow.js') 再 replace 反斜杠串，
  //   只在 Windows 命中（path.join 产反斜杠），POSIX 上 replace 空转、import 直接 ERR_MODULE_NOT_FOUND。
  const win = await imp(path.join('src', 'refresh', 'kernel', 'index-window-rules.js'))
  const budget = await imp(path.join('src', 'refresh', 'kernel', 'host-budget.js'))
  const ledgerMod = await imp(path.join('src', 'refresh', 'rooms', 'host', 'quota-ledger.ts'))
  const gateMod = await imp(path.join('src', 'refresh', 'rooms', 'host', 'refresh-gate.ts'))
  const patchMod = await imp(path.join('src', 'refresh', 'rooms', 'host', 'row-patch.js'))

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
  const gets = []           // 会话 get 问过的票号（断言取数路径就靠它）
  let listCalls = 0         // 整池 list 的次数（重建才该走）
  let listPageCalls = 0     // 索引翻页的次数
  const failKeys = new Set() // 让某几张票的 get 失败，用来测「一条没取到、整批不并」
  let windowIndex = null    // 窗口里取回来的索引（探针回包）
  const windowSince = []
  let clock = CLOCK0
  const ledger = ledgerMod.createLedger({ now: () => clock })
  // #1446 账本按后端分键：读数落在这一个后端的桶里，换后端不许混账。
  ledger.ensureBackend('github', { kind: 'two-buckets' })
  ledger.syncServer('github', { rest: { limit: 5000, remaining: 5000, reset: clock + budget.HOUR_MS }, graphql: { limit: 5000, remaining: 5000, reset: clock + budget.HOUR_MS } }, clock)
  const gate = gateMod.createGate({ ledger: ledger, now: () => clock })
  gate.setWorkspace(WS, { active: true })
  const logLines = []
  const logCtx = { isEnabled: (l) => l === 'debug', fire: (level, name, fields) => logLines.push({ level: level, name: name, fields: fields }) }
  // 假会话：迁移后薄行只经它取数，不再直调 gh、也不再经闸 send（#1444）。
  const session = {
    list: async () => { listCalls += 1; return { ok: true, data: [] } },
    listPage: async () => { listPageCalls += 1; return { ok: true, data: { items: [], nextCursor: null, total: 0 } } },
    get: async (ref: any, key: any) => {
      gets.push(String(key))
      if (failKeys.has(String(key))) return { ok: false, error: { kind: 'network', message: '模拟取数失败' } }
      return { ok: true, data: { key: String(key), effortId: 'e', type: 'issue', title: '票 ' + key, state: 'closed', body: '', url: 'https://github.com/o/r/issues/' + key, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-23T00:00:00Z', closedAt: null, parentKey: null, labels: [], assignees: [{ login: 'me' }], author: { login: 'me' }, blockedBy: [], isPullRequest: false, mergedAt: null, reviews: [] } }
    },
    getDependencies: async () => ({ ok: true, data: { blockedBy: [], blocking: [] } }),
    listSubIssues: async () => ({ ok: true, data: { items: [], total: 0, fetched: 0, capped: false, missing: [], dropped: [] } }),
  }
  const openSession = async () => ({ ok: true, backendId: 'github', budget: {}, call: (fn: any) => fn(session, { cwd: CWD, caller: 'refresh' }) })
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
    openSession: openSession,
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
  check(gets.length === 1 && gets[0] === '101', '②取数路径：这一次只问 101 这一张票（get ' + JSON.stringify(gets) + '）')
  check(listCalls === 0 && listPageCalls === 0, '②取数路径：整池 list 与索引翻页一次都没被触发（list ' + listCalls + ' / listPage ' + listPageCalls + '）')
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
  // #1446 账本按后端分键：小时计数与读数都按「后端/桶名」取。
  check(ledger.hour('plugin', 'github/rest').requests === 0 && ledger.view('github', 'graphql').used === 0 && gate.stats().accounted.requests === 0,
    '②记账口径：读路径不花额度，REST 桶 0 条、GraphQL 0 点、闸上一笔都没记（#1444 起薄行走只读会话）')

  // ---- ③ 取数失败：待办仍在、水印不动、下次仍能发现 ----
  // 探测已经说「102 关了」，真去取那一条时会话报错 —— 一条没取到就整批不并，
  // 变化进持久化待办，水印不动；下一次仍从同一个窗口起点发现它。
  windowIndex = { '101': 'CLOSED|2026-09-23T00:00:00Z', '102': 'CLOSED|2026-09-24T00:00:00Z', '103': 'OPEN|2026-09-18T00:00:00Z' }
  const getsBefore = gets.length
  const wmBefore = (await patch.state(CWD)).watermarkMs
  failKeys.add('102')
  const patch2 = patchMod.createPatch({
    now: () => clock, logCtx: logCtx, workspaceKeyOf: () => WS,
    readSnapshot: async () => store, writeSnapshot: async (cwd, snap) => { writes += 1; store = snap },
    indexOfSnapshot: win.indexFromSnapshot, windowRules: win,
    getRepoKey: async () => ({ owner: 'o', name: 'r' }),
    probeIndex: async (cwd, sinceIso) => { windowSince.push(sinceIso); return { ok: true, index: windowIndex } },
    openSession: openSession,
    decide: (req) => gate.decideFor(req),
  })
  const r2 = await patch2.run(CWD)
  const winIdx2 = windowSince.length - 1
  check(r2.mode === 'failed' && r2.reason === 'thin-query-failed', '③取数失败时如实回失败（' + r2.mode + ' / ' + r2.reason + '）')
  check(gets.length === getsBefore + 1 && gets[getsBefore] === '102', '③只问了失败的那一条票（get ' + JSON.stringify(gets.slice(getsBefore)) + '）')
  const st2 = await patch.state(CWD)
  check(st2.pending.length === 1 && st2.pending[0] === '102', '③变化进了持久化待办（待办 ' + JSON.stringify(st2.pending) + '）')
  check(st2.watermarkMs === wmBefore, '③水印一个字节都没动（仍是 ' + st2.watermarkMs + '）')
  check(store.issues[1].state === 'OPEN', '③没取到的那一行没有被并进列表（列表还是旧的）')
  failKeys.delete('102')
  clock += 60000
  const r3 = await patch.run(CWD)
  const winIdx3 = windowSince.length - 1
  check(r3.mode === 'patch' && r3.rows.length === 1 && r3.rows[0] === '102', '③下一次仍然发现了同一条变化并补上了它（' + JSON.stringify(r3.rows) + '）')
  check((await patch.state(CWD)).pending.length === 0, '③补上之后待办清空')
  check(windowSince[winIdx2] === windowSince[winIdx3], '③失败那一次与下一次问的是同一个窗口起点（水印没动，那条变化没掉出窗口）')
  check(gate.stats().accounted.requests === 0 && gate.stats().escaped.requests === 0 && ledger.hour('plugin', 'github/rest').requests === 0,
    '读路径零记账：闸上一笔都没记、REST 桶 0 条、漏网 0（accounted ' + gate.stats().accounted.requests + '）')

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
  const getsWide = gets.length
  const rWide = await patch.run(CWD)
  check(rWide.mode === 'rebuild' && rWide.reason === 'too-many-rows' && gets.length === getsWide,
    '一次变了 ' + wide.issues.length + ' 行（超过上限 ' + patch.threshold.maxRows + '）→ 整池，且一条薄查询都没发')

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
