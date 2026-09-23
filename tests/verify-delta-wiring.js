// verify-delta-wiring.js —— 门禁：探测说变了之后客户端吃的是宿主补好的增量结果，水印只有一个所有者（#723 T19c · 第 E 件）
// 用法：在插件根目录执行 node tests/verify-delta-wiring.js，可独立运行。
//
// 这一条盯的是「取数路径本身」，不是显示结果 —— 只看显示结果的话，整池重建也能让画面看起来是对的：
//   ① 探测说变了之后，这一次到底发了几条请求：应当是「变的那几张票各一条薄查询」，
//      整池那条大查询（`gh api --paginate repos/.../issues?state=all`）一条都不许发；
//   ② 补好的那一份真的回到了客户端要的那一格（探测回包里带 snapshot，客户端按它落列表）；
//   ③ 水印只有一个所有者，而且只在变化真的并进列表之后才推进：
//      被推迟的那一档，水印一个字节都不动 —— 用「下一次探测的窗口起点（URL 里的 since=）」证明，
//      并且在位的变化进了待办、下一拍仍然看得到；
//   ④ 客户端那一侧：探测说变了之后不再无条件 loadSnapshot(primary,true,true) 整池（静态断言，
//      因为客户端内核在源码层是文本拼接的，没有可跑的模块实例）；被推迟那一档一个请求都不发。
//
// 假传输层照 tests/verify-delta-patch.js 那份口径：真发出去的每一条都报给闸，argv 原样记下来给断言用。
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

const CWD = 'C:/ws/demo'
const CLOCK0 = 1700000000000

function main() {
  return run()
}

async function run() {
  console.log('增量接线门禁（#723 T19c · 第 E 件：客户端吃增量结果、水印收口成一条）')
  const delta = await imp('src/shared/refresh/delta.js')
  const win = await imp('src/shared/tracker/indexWindow.js')
  const budget = await imp('src/shared/refresh/budget.js')
  const issueListMod = await imp('src/host/issueList.js')
  const commentMod = await imp('src/host/commentThreads.js')
  const wiringMod = await imp('src/host/refresh/wiring.js')

  // ---- 假世界：一份内存快照 + 一个记账的传输层 + 一份可摆布的窗口索引 ----
  const row = (n, state, updatedAt) => ({ number: n, key: String(n), title: '票 ' + n, state: state, updatedAt: updatedAt, labels: [], assignees: [], createdAt: '2026-09-01T00:00:00Z' })
  // 时间要一致：水印离「现在」太久（超过 7 天）会被窗口规则判成整扫，那就测不到增量那条路了。
  const NOW0 = Date.now()
  const WM0 = NOW0 - 3600000
  const seeded = {
    ok: true, repo: { owner: 'o', name: 'r' }, workspaceRoot: CWD, version: 'v0', generatedMs: NOW0 - 60000,
    maps: [{ number: 100, key: '100', state: 'OPEN', updatedAt: '2026-09-17T00:00:00Z', tickets: [row(101, 'OPEN', '2026-09-20T00:00:00Z')] }],
    issues: [row(101, 'OPEN', '2026-09-20T00:00:00Z'), row(102, 'OPEN', '2026-09-19T00:00:00Z'), row(103, 'OPEN', '2026-09-18T00:00:00Z')],
    labels: [], deck: { counts: { open: 3, closed: 0, total: 3 }, partial: false, levels: [] },
    delta: { structureVersion: delta.DELTA_STRUCTURE_VERSION, watermarkMs: WM0, generation: 3, pending: [], pendingAt: 0, pendingReason: '' },
  }
  const cacheBox = { ts: NOW0 - 60000, snapshot: seeded, error: null, cwd: CWD }
  const disk = { snap: seeded }
  const calls = []
  const probeSince = []
  const transport = { requests: 0, points: 0 }
  let ledger = null
  const logLines = []
  const logCtx = { isEnabled: (l) => l === 'debug', fire: (level, name, fields) => logLines.push({ level, name, fields }) }

  // 传输层：真发一条就报给闸一次（生产里这一层是起 gh 进程的那一层）。
  function noteOutbound(n) { transport.requests += n; try { ledgerGate.noteOutbound({ requests: n, points: 0 }) } catch (e) {} }
  let ledgerGate = null
  let windowIndex = { 101: 'CLOSED|2026-09-23T00:00:00Z', 102: 'OPEN|2026-09-19T00:00:00Z', 103: 'OPEN|2026-09-18T00:00:00Z' }
  const urlOf = (args) => String((args || []).filter((a) => typeof a === 'string' && a.indexOf('repos/') === 0)[0] || '')
  const runGh = async (args, cwd) => {
    calls.push(args)
    const url = urlOf(args)
    if (url.indexOf('/issues?') >= 0) {
      // 窗口索引那条探针（`repos/o/r/issues?state=all&per_page=100[&since=…]`）
      const m = url.match(/since=([^&]*)/)
      probeSince.push(m ? decodeURIComponent(m[1]) : '')
      noteOutbound(1)
      const lines = Object.keys(windowIndex).map((k) => JSON.stringify({ number: Number(k), state: String(windowIndex[k]).split('|')[0], updatedAt: String(windowIndex[k]).split('|')[1] }))
      return { ok: true, text: lines.join('\n') }
    }
    // 单张票的薄查询（`repos/o/r/issues/<n>`）
    const n = Number(url.split('/').pop())
    noteOutbound(1)
    const r2 = { number: n, title: '票 ' + n, state: String(windowIndex[n] || 'OPEN|').split('|')[0], labels: [], assignees: [], user: { login: 'me' }, updated_at: String(windowIndex[n] || '|').split('|')[1], created_at: '2026-09-01T00:00:00Z' }
    return { ok: true, text: JSON.stringify(r2) }
  }

  const issueList = issueListMod.createIssueList({
    getRepoKey: async () => ({ owner: 'o', name: 'r' }),
    runGh: runGh,
    setCache: () => {},
    issueIndexFromSnapshot: (snap) => win.indexFromSnapshot(snap),
    issueIndexChanged: (a, b) => { const ka = Object.keys(a || {}), kb = Object.keys(b || {}); if (ka.length !== kb.length) return true; for (const k of kb) if ((a || {})[k] !== b[k]) return true; return false },
    rememberIssueIndex: () => {},
    readDiskCache: async () => disk.snap,
    logCtx: logCtx,
  })

  const wiring = wiringMod.createRefreshWiring({
    ctx: { on: () => () => {}, get: () => undefined },
    logCtx: logCtx,
    canonicalKey: async (p) => String(p),
    getCacheDir: async () => CWD,
    getTrackerRegistry: async () => null,
    getPlatform: async () => ({ path: path.posix }),
    detectionExec: async () => ({ ok: false, kind: 'env', error: '门禁里不发真请求' }),
    getCache: () => cacheBox,
    setCache: (v) => { if (v && v.snapshot) { cacheBox.snapshot = v.snapshot; cacheBox.ts = v.ts } },
    readDiskCache: async () => disk.snap,
    writeDiskCache: async (repo, snap) => { disk.snap = snap },
    runGh: runGh,
    getRepoKey: async () => ({ owner: 'o', name: 'r' }),
    fetchIssueIndex: (cwd, sinceIso) => issueList.fetchIssueIndex(cwd, sinceIso),
    issueIndexFromSnapshot: (snap) => win.indexFromSnapshot(snap),
  })
  ledgerGate = wiring.gate
  wiring.ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: CLOCK0 + budget.HOUR_MS }, graphql: { limit: 5000, remaining: 5000, reset: CLOCK0 + budget.HOUR_MS } }, CLOCK0)
  // 活跃集合里那一格：用**与接线里同一把**短散列（hash8(root)）。散列层级/长度/空串对不上，
  // 这条路上的每一笔都会被判「推迟」——下面那两条「真的放行过 / 真的推迟过」的断言就是为它写的。
  const wsKey = wiring.hash8(CWD)
  wiring.gate.setWorkspace(wsKey, { active: true })
  // 记下这条路上每一笔过闸请求带的 workspaceKey：用来钉「两处用的是同一个值」。
  const seenKeys = []
  const decideLog = []
  const rawDecide = wiring.gate.decideFor
  wiring.gate.decideFor = function (req) {
    seenKeys.push(String((req && req.workspaceKey) || ''))
    const v = rawDecide.apply(wiring.gate, arguments)
    try { decideLog.push({ kind: String((req && req.kind) || ''), verdict: String((v && v.verdict) || ''), reason: String((v && v.reason) || '') }) } catch (e) {}
    return v
  }
  const rawSend = wiring.gate.send
  wiring.gate.send = function (req, perform) { seenKeys.push(String((req && req.workspaceKey) || '')); return rawSend.apply(wiring.gate, arguments) }

  const comments = commentMod.createCommentThreads({
    canonicalKey: async (p) => String(p),
    selectEarly: async () => null,          // 探测走 GitHub 那一条（窗口索引 + 行级增量）
    isComposerSelection: () => false,
    getTrackerRegistry: async () => null,
    getPlatform: async () => ({ path: path.posix }),
    ctx: { get: () => undefined },
    DEFAULT_CWD: CWD,
    errText: (e) => String((e && e.message) || e),
    fetchIssueIndexWindowed: (cwd) => issueList.fetchIssueIndexWindowed(cwd),
    commitIssueIndex: (cwd, wm) => issueList.commitIssueIndex(cwd, wm),
    deltaRefresh: (cwd, opts) => wiring.deltaRefresh(cwd, opts),
    issueIndexChanged: () => true,
    rememberIssueIndex: () => {},
    getCache: () => cacheBox,
    setCache: (v) => { if (v && v.snapshot) cacheBox.snapshot = v.snapshot },
    lastIssueIndexByRepo: {},
    lastProbeAtByRepo: {},
    logCtx: logCtx,
  })

  // ---- ① 探测说变了：只发薄查询，并把补好的那一份交回客户端 ----
  const thinBefore = () => calls.filter((a) => urlOf(a).indexOf('/issues/') >= 0).length
  const poolCalls = () => calls.filter((a) => a.indexOf('--paginate') >= 0 && String(a[a.indexOf('--jq') + 1] || '').indexOf('title') >= 0).length
  const r1 = await comments.handleProbe({ cwd: CWD })
  check(r1 && r1.ok === true && r1.changed === true, '探测检出变化（' + JSON.stringify({ ok: r1 && r1.ok, changed: r1 && r1.changed }) + '）')
  check(r1 && r1.mode === 'patch', '变了就先把变的那几条补进列表（mode=' + (r1 && r1.mode) + '）')
  check(thinBefore() === 1, '①取数路径：这一次只发出 1 条请求（变的那一张票一条薄查询），实发 ' + thinBefore() + ' 条')
  check(poolCalls() === 0, '①取数路径：整池那条大查询一次都没被触发（--paginate + 带 title 的那条），实发 ' + poolCalls() + ' 条')
  check(r1 && r1.snapshot && r1.snapshot.ok === true && Array.isArray(r1.snapshot.issues), '②客户端要的那一格里有补好的快照（交给界面直接落列表）')
  const row101 = (r1 && r1.snapshot && r1.snapshot.issues || []).filter((x) => Number(x.number) === 101)[0]
  check(!!row101 && row101.state === 'CLOSED', '补进去的那一行就是薄查询回来的新值（101 → ' + (row101 && row101.state) + '）')
  check(r1 && r1.snapshot && r1.snapshot.delta && r1.snapshot.delta.watermarkMs > seeded.delta.watermarkMs, '③水印在变化并进列表之后推进了（' + seeded.delta.watermarkMs + ' → ' + (r1 && r1.snapshot && r1.snapshot.delta && r1.snapshot.delta.watermarkMs) + '）')
  check(logLines.some((l) => l.name === 'refresh.patch' && l.fields.mode === 'patch'), '补行这一步落了一行既有事件 refresh.patch（没有新造事件名）')
  const st1 = ledgerGate.stats()
  check(st1.accounted.requests === 1, '①那一条薄查询是**经闸的 send** 发出去的（闸记下 ' + st1.accounted.requests + ' 条；探测索引那一条走的是存量出口，只报账不裁决，见 verify-gh-gateway.js）')
  check(st1.sent > 0 && st1.deferred === 0, '①这一次真的**放行**了（闸的裁决是 send 不是 defer）：sent=' + st1.sent + '、deferred=' + st1.deferred)
  check(seenKeys.length > 0 && seenKeys.every((k) => k.length === 8), '③两处用的是同一把钥匙：这条路上每一笔过的 workspaceKey 都是 8 位短散列（实得 ' + JSON.stringify(seenKeys.slice(0, 3)) + '…）')
  check(seenKeys.every((k) => k === wsKey), '③而且与活跃集合/写事件白名单里那一格**逐字相同**（' + wsKey + '）——层级不同、长度不同或空串都会让每一笔被判推迟')

  // ---- ③ 被推迟的那一档：水印一个字节都不动，变化进待办 ----
  wiring.gate.setWorkspace(wsKey, { active: false })   // 人已切走：闸按后台档推迟这一次取数
  windowIndex = { 101: 'CLOSED|2026-09-23T00:00:00Z', 102: 'CLOSED|2026-09-24T00:00:00Z', 103: 'OPEN|2026-09-18T00:00:00Z' }
  const wmBeforeDefer = cacheBox.snapshot.delta.watermarkMs
  const thinBeforeDefer = thinBefore()
  const decideBefore = decideLog.length
  const sinceFrom2 = probeSince.length
  const r2 = await comments.handleProbe({ cwd: CWD })
  const decideDefer = decideLog.slice(decideBefore)
  check(decideDefer.some((d) => d.verdict === 'defer' && d.reason === 'background-inactive'), '③人切走之后闸**真的**把它推迟了（裁决原文：' + JSON.stringify(decideDefer) + '）')
  // 这一拍里第一次索引请求就是那条窗口扫描（第二次是补行那条路自己的探查）：窗口起点看第一次。
  const sinceAtDefer = probeSince[sinceFrom2]
  check(r2 && r2.ok === true && r2.changed === true && r2.mode === 'deferred', '③被推迟的那一档如实回报（' + JSON.stringify(r2).slice(0, 200) + '）')
  check(thinBefore() === thinBeforeDefer, '③被推迟时一条薄查询都没发出去（实发 ' + (thinBefore() - thinBeforeDefer) + ' 条）')
  const wmAfterDefer = cacheBox.snapshot.delta.watermarkMs
  check(wmAfterDefer === wmBeforeDefer, '③水印一个字节都没动（' + wmBeforeDefer + ' → ' + wmAfterDefer + '）')

  // ---- ③c 切回来：同一条变化仍然被发现（这才是「水印没动」的用处） ----
  wiring.gate.setWorkspace(wsKey, { active: true })
  const sinceFrom3 = probeSince.length
  const r3 = await comments.handleProbe({ cwd: CWD })
  const sinceAfter = probeSince[sinceFrom3]
  check(sinceAfter === sinceAtDefer, '③被推迟之后窗口起点没有前移，下一次仍然从同一处扫起（' + sinceAtDefer + ' → ' + sinceAfter + '）')
  check(r3 && r3.changed === true && r3.mode === 'patch', '③切回来之后同一条变化**仍然被发现并补上**（mode=' + (r3 && r3.mode) + '）')
  const row102 = (cacheBox.snapshot.issues || []).filter((x) => Number(x.number) === 102)[0]
  check(!!row102 && row102.state === 'CLOSED', '③补上去的那一行就是它（102 → ' + (row102 && row102.state) + '）')

  // ---- ③b 整池那条路的读数不再自己推水印（变了就不推） ----
  const remote = await issueList.fetchIssueIndexWindowed(CWD)
  check(remote && remote.watermarkCommitted === false && typeof remote.nextWatermarkMs === 'number' && remote.nextWatermarkMs > 0, '③取数那条路只算出「下一次该从哪儿扫」，不再自己把水印推过去（watermarkCommitted=' + (remote && remote.watermarkCommitted) + '）')
  const wmBeforeCommit = Date.now() + 1000
  const cc = await issueList.commitIssueIndex(CWD, wmBeforeCommit, { 101: 'CLOSED|2026-09-23T00:00:00Z' })
  const cc2 = await issueList.commitIssueIndex(CWD, wmBeforeCommit - 100000)
  check(cc && cc.ok === true && cc.advanced === true, '③推进口只有一个，而且只许往前走（' + JSON.stringify(cc) + '）')
  check(cc2 && cc2.ok === true && cc2.advanced === false, '③给一个更早的时刻不许把水印拉回去（' + JSON.stringify(cc2) + '）')

  // ---- ④ 客户端那一侧：吃增量、不再无条件整池 ----
  const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const clientSrc = fs.readFileSync(path.join(ROOT, 'src', 'client', 'kernel', 'probe-auto.js'), 'utf8')
  check(/res\.mode === 'deferred'/.test(clientSrc) && /res\.mode === 'stale-dropped'/.test(clientSrc), "④客户端认得出宿主那句「这一次没并进去」（deferred / stale-dropped），那一拍一个请求都不发")
  check(/res\.mode === 'patch'/.test(clientSrc) && /applySnap\(res\.snapshot\)/.test(clientSrc), '④客户端吃宿主补好的那一份（res.mode === patch → applySnap(res.snapshot)）')
  const clientCode = stripComments(clientSrc)
  const patchBranch = clientCode.indexOf("res.mode === 'patch'")
  const poolBranch = clientCode.indexOf('return loadSnapshot(primary, true, true)')
  check(patchBranch > 0 && poolBranch > patchBranch, '④增量那一支排在整池那一支前面（遇到了就先吃增量，不再先整池）')
  check((clientCode.match(/loadSnapshot\(primary, true, true\)/g) || []).length === 1, '④整池那一条只剩一处（宿主说该整池时才走），实得 ' + (clientCode.match(/loadSnapshot\(primary, true, true\)/g) || []).length + ' 处')

  // ---- 反证夹具：把「探测一回来就推水印」放回去，判据必须逮住 ----
  // 收口后的代码分住两处：调用方 issueList.js + 规则与状态 src/host/platform/issueIndexWindow.js，两份一起扫。
  const listCode = stripComments(
    fs.readFileSync(path.join(ROOT, 'src', 'host', 'issueList.js'), 'utf8') +
    fs.readFileSync(path.join(ROOT, 'src', 'host', 'platform', 'issueIndexWindow.js'), 'utf8'))
  check(!/lastIndexWatermarkByRepo\[rk\]\s*=\s*win\.nextWatermark\(/.test(listCode), '✗ probe：整池那条路里「探测一回来就推水印」那一行已经不在了（收口成一条的证据）')
  check(!/if \(true\)\s*\{\s*lastIndexBaselineByRepo\[rk\]/.test(listCode), '✗ probe：也没有「无条件把基线/水印记下来」这种写法（谁推都得先问一句并进列表了没有）')
  check(/lastIndexWatermarkByRepo\[rk\]\s*=\s*win\.nextWatermark\(/.test(stripComments("  lastIndexWatermarkByRepo[rk] = win.nextWatermark(startedMs) // 探到就推")), '✗ probe：同一套判据认得出「探测一回来就推水印」这种写法（夹具不空转）')

  console.log('\n' + (failed ? '存在失败 — 增量接线门禁未通过' : '全部通过 — 客户端吃增量结果、水印只有一个所有者（' + total + ' 条断言）'))
  console.log('提示：本门禁还没有挂进 package.json 的 verify 链，请统筹者接一行（见交付报告第 5 节）。')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
