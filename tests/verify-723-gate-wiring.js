// verify-723-gate-wiring.js —— 门禁：#723（T19）把存量三处传输出口接进唯一出口闸之后，
// 「裁决那一半」与「处理链喂数据那一半」在真业务路径上真的走通了（不是只记了一笔账、也不是只喂了一笔）。
// 用法：在插件根目录执行 node tests/verify-723-gate-wiring.js，可独立运行。
//
// 为什么必须单独有这一条：
//   tests/verify-gh-gateway.js 守的是「每一笔出站都被报给了闸」（记账那一半）与「登记表不许说谎」。
//   光记账不等于 I1 —— 闸的裁决（放行 / 推迟 / 拒绝）那一半如果一次都没被真业务路径调到，接线只是装饰。
//   既有的链视图门禁（tests/verify-chain-view.js）又是**手工拼 note** 的，走的不是生产那条喂数据的路：
//   所以「界面恒显示取到了、空的」这件事，此前没有任何门禁会在红灯里看见。本门禁补上这一段。
//
// 四段：
//   ① 放行：patch.run 的探测与薄查询被放行、记账、漏网计数仍为 0；
//   ② 推迟：额度压到 0 时闸判 defer，patch.run 如实回 mode=deferred，一条请求都不发、也不抛异常；
//   ③ 拒绝：AI 工具那一档超顶时闸拒绝并给出文案；
//   ④ 写事件那条真路径（生产装配件 createRefreshWiring）：
//      · 过闸带的钥匙与「标活跃」用的钥匙必须是同一把（两把对不上时后台档恒判「不在活跃集合里」，
//        这条路在生产里会一次都发不出去 —— 这是 #723 栽过一次的坑）；
//      · 喂给处理链的那一份必须按链自己的判据成形（16 位根指纹 + 白名单里的后端名），
//        **链真的把它记下来**、界面的读数里真的出现那一张票；
//      · 没上报过的工作区同一笔必须被推迟（负控）。
const path = require('path')
const os = require('os')
const fs = require('fs')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg, detail) => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || !detail ? '' : '\n         → ' + detail))
  if (!ok) failed = true
}
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

const CLOCK = 1700000000000
const CWD = 'C:\\ws\\723-gate'
const WS = 'ws-723-gate'

function row(n, state, updatedAt) {
  return { number: n, key: String(n), title: '票 ' + n, state: state, updatedAt: updatedAt, labels: [], assignees: [], createdAt: '2026-09-01T00:00:00Z' }
}

async function main() {
  console.log('#723（T19）门禁：闸的裁决 (放行/推迟/拒绝) 与处理链喂数据，都在真业务路径上走通')
  const delta = await imp('src/shared/refresh/delta.js')
  const win = await imp('src/shared/tracker/indexWindow.js')
  const budget = await imp('src/shared/refresh/budget.js')
  const chain = await imp('src/shared/refresh/chain.js')
  const ledgerMod = await imp('src/host/refresh/ledger.js')
  const gateMod = await imp('src/host/refresh/gate.js')
  const patchMod = await imp('src/host/refresh/patch.js')
  const wiringMod = await imp('src/host/refresh/wiring.js')
  const attentionMod = await imp('src/host/refresh/attention.js')

  /** 一个只活在这一次里的闸 + 账本（真件），配一层假传输层（每真发一条就报给闸一次，与生产同一口径）。 */
  function world(opts) {
    const o = opts || {}
    const store = {
      ok: true, repo: { owner: 'o', name: 'r' }, workspaceRoot: CWD, version: 'v0', generatedMs: CLOCK - 60000,
      maps: [], labels: [], deck: { counts: { open: 3, closed: 0, total: 3 }, partial: false, levels: [] },
      issues: [row(301, 'OPEN', '2026-09-20T00:00:00Z'), row(302, 'OPEN', '2026-09-19T00:00:00Z'), row(303, 'OPEN', '2026-09-18T00:00:00Z')],
      delta: { structureVersion: delta.DELTA_STRUCTURE_VERSION, watermarkMs: CLOCK - 3600000, generation: 3, pending: [], pendingAt: 0, pendingReason: '' },
    }
    const ledger = ledgerMod.createLedger({ now: () => CLOCK })
    const remaining = (typeof o.remaining === 'number') ? o.remaining : 5000
    ledger.syncServer({ rest: { limit: 5000, remaining: remaining, reset: CLOCK + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: CLOCK + 3600000 } }, CLOCK)
    const gate = gateMod.createGate({ ledger: ledger, now: () => CLOCK })
    gate.setWorkspace(WS, { active: true })
    const calls = []
    const patch = patchMod.createPatch({
      now: () => CLOCK, workspaceKeyOf: () => WS,
      readSnapshot: async () => store, writeSnapshot: async (cwd, snap) => { Object.assign(store, snap) },
      indexOfSnapshot: win.indexFromSnapshot, windowRules: win,
      getRepoKey: async () => ({ owner: 'o', name: 'r' }),
      probeIndex: async () => ({ ok: true, index: { '301': 'CLOSED|2026-09-23T00:00:00Z', '302': 'OPEN|2026-09-19T00:00:00Z', '303': 'OPEN|2026-09-18T00:00:00Z' } }),
      runGh: async (args) => {
        calls.push(args)
        const n = Number(args[1].split('/').pop())
        return { ok: true, text: JSON.stringify({ number: n, title: '票 ' + n, state: 'closed', labels: [], assignees: [], user: { login: 'me' }, updated_at: '2026-09-23T00:00:00Z', created_at: '2026-09-01T00:00:00Z' }) }
      },
      send: (req, perform) => gate.send(req, async () => { const out = await perform(); gate.noteOutbound({ requests: 1, points: 0 }); return out }),
      decide: (req) => gate.decideFor(req),
    })
    return { store, ledger, gate, patch, calls }
  }

  // ── ① 放行 ──
  {
    const w = world({})
    const before = w.gate.stats()
    const r = await w.patch.run(CWD)
    const after = w.gate.stats()
    check(r.mode === 'patch', '① 放行：patch.run 走通行级补行（mode=' + r.mode + ' / reason=' + r.reason + '）')
    check(after.sent - before.sent === 1, '① 裁决：闸放行并计数（sent ' + before.sent + ' → ' + after.sent + '）')
    check(after.accounted.requests - before.accounted.requests === 1, '① 记账：真发出去的 1 条记进了账（' + before.accounted.requests + ' → ' + after.accounted.requests + '）')
    check(w.gate.escaped().requests === 0, '① 漏网计数仍为 0（' + JSON.stringify(w.gate.escaped()) + '）')
  }

  // ── ② 推迟（额度压到 0）：如实回三态、不抛、一条都不发 ──
  {
    const w = world({ remaining: 0 })
    const before = w.gate.stats()
    let threw = null
    let r = null
    try { r = await w.patch.run(CWD) } catch (e) { threw = e }
    check(threw === null, '② 推迟：patch.run 没有抛异常（照契约回三态）')
    check(r && r.mode === 'deferred', '② 推迟：patch.run 如实回 mode=deferred（实得 ' + (r && r.mode) + ' / ' + (r && r.reason) + '）')
    const sent = await w.gate.send({ source: 'probe.tick', kind: 'probe', workspaceKey: WS }, async () => ({ requests: 1, points: 0 }))
    check(sent && sent.sent === false && sent.verdict === 'defer', '② 裁决：同一条闸对同一批输入回 defer（' + JSON.stringify({ verdict: sent.verdict, reason: sent.reason }) + '）')
    check(w.gate.stats().deferred - before.deferred >= 1 && w.gate.stats().pending >= 1, '② 裁决：这一笔进了推迟队列（deferred=' + w.gate.stats().deferred + '、pending=' + w.gate.stats().pending + '）')
    check(w.calls.length === 0, '② 推迟：一条请求都没发出去（' + w.calls.length + ' 条）——推迟不是「发了再失败」')
    check(w.gate.escaped().requests === 0, '② 漏网计数仍为 0')
  }

  // ── ③ 拒绝（AI 工具那一档超顶）──
  {
    const w = world({})
    const admit = w.gate.admitAiTool({ points: budget.AI_TOOL_MAX_POINTS_PER_CALL + 1, requests: 1, childTickets: 0 }, { workspaceKey: WS, kind: 'tool-batch', bucket: 'graphql' })
    check(admit && admit.admitted === false, '③ 拒绝：超单次硬顶的那一笔被拒（reason=' + (admit && admit.reason) + '）')
    check(typeof admit.text === 'string' && admit.text.length > 0, '③ 拒绝文案：给出「我花超了 / 额度被别人用掉了」那一句')
  }

  // ── ④ 写事件那条真路径（生产装配件）──
  {
    const WS1 = 'C:\\ws\\723-a1'
    const WS2 = 'C:\\ws\\723-a2'
    const CMD = 'gh issue comment 723 --body "723"'
    /** 生产装配的那一套：真闸真账本 + 真注册表（报告「这个工作区用 github」）+ 真处理链。 */
    function build(registryBackend) {
      // #735 起落盘不再是只写不读：focus 会把盘上这一格读回来，所以缓存目录必须一次一格。
      // 共用 os.tmpdir() 的话，上一次跑留下的 session-tickets.json 会被读回来，
      // ④a 那条 sessions.length===1 就变成 2（自污染，与生产无关）。
      const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 't19e-gate-chain-'));
      const base = ledgerMod.createLedger({ now: () => CLOCK })
      base.syncServer({ rest: { limit: 5000, remaining: 5000, reset: CLOCK + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: CLOCK + 3600000 } }, CLOCK)
      const entries = []
      const ledger = Object.assign({}, base, { spend: (e) => { entries.push(e); return base.spend(e) } })
      const decides = []
      const logCtx = { isEnabled: () => true, fire: (level, event, fields) => { if (event === 'refresh.decide') decides.push(typeof fields === 'function' ? fields() : fields) } }
      const gate = gateMod.createGate({ ledger: ledger, now: () => CLOCK, logCtx: logCtx })
      const w = wiringMod.createRefreshWiring({
        ctx: { on: () => () => {} }, logCtx: logCtx, canonicalKey: async (x) => String(x),
        getCacheDir: async () => cacheDir, ledger: ledger, gate: gate,
        // 真注册表那一档的替身：同一形状（describe 回这个工作区现在用哪个后端）。
        getTrackerRegistry: async () => ({ modules: () => [], describe: () => ({ backend: registryBackend || '', refId: 'acme/demo', name: 'acme/demo', url: '' }), get: () => null }),
      })
      const focus = attentionMod.createFocusHandler({ attention: w.attention, afterReport: () => w.syncAttention() })
      return { w: w, gate: gate, entries: entries, decides: decides, focus: focus }
    }
    const writeOnce = (w, sid, ws) => w.writeEvents.handle({ id: sid, header: { cwd: ws } }, 'tools/result', 'pwsh', JSON.stringify({ command: CMD }), true)

    // ④a 放行 + 喂数据真的被链记下 + 界面的读数里真的出现那一笔
    const A1 = build('github')
    await A1.focus({ windowId: 'win-1', workspaceRoot: WS1, kind: 'focus', visible: true })
    const key = A1.w.hash8(WS1)
    check(A1.gate.workspaceView(key).active === true, '④ 上报之后闸把这一格标成活跃（key=' + key + '）')
    const before1 = A1.gate.stats()
    const out1 = await writeOnce(A1.w, 'sess-a1', WS1)
    const after1 = A1.gate.stats()
    const v1 = A1.decides.length ? A1.decides[A1.decides.length - 1].verdict : ''
    check(v1 === 'allow', '④ 放行真的发生了（verdict=' + v1 + ' / ' + (A1.decides.length ? A1.decides[A1.decides.length - 1].reason : '') + '）',
      '恒 defer = 这条生产路径一次都发不出去')
    check(after1.sent - before1.sent === 1, '④ 闸的 sent 真的 +1（' + before1.sent + ' → ' + after1.sent + '）')
    check(A1.w.writeEvents.lastGateKey() === key, '④ 过闸带的钥匙与「标活跃」用的钥匙是同一把（标活跃=' + key + '、过闸=' + A1.w.writeEvents.lastGateKey() + '）',
      '两把钥匙不同 = 后台档恒判「不在活跃集合里」而静默推迟每一笔（#723 栽过的坑）')
    const readout1 = A1.w.chainReadoutOf()
    check(readout1.ok === true && readout1.sessions.length === 1 && readout1.sessions[0].entries.some((e) => e.ticketKey === '723'),
      '④ 处理链真的把这一笔记下了、界面的读数里真的出现票 723：' + JSON.stringify(readout1).slice(0, 220),
      '链没记下 = 界面恒显示「取到了、空的」（喂数据的形状与链的判据对不上）')
    check(readout1.sessions[0].backend === 'github', '④ 读数里的后端名是链白名单里的真名字（实得 ' + readout1.sessions[0].backend + '）')

    // ④b 负控：不在活跃集合（没上报过）的那一笔必须被推迟
    const A2 = build('github')
    await A2.w.writeEvents.allowRoot(WS2)
    const before2 = A2.gate.stats()
    const out2 = await writeOnce(A2.w, 'sess-a2', WS2)
    const after2 = A2.gate.stats()
    const v2 = A2.decides.length ? A2.decides[A2.decides.length - 1].verdict : ''
    check(v2 === 'defer' && after2.sent === before2.sent, '④ 负控：不在活跃集合的那一笔被推迟（verdict=' + v2 + '、sent ' + before2.sent + ' → ' + after2.sent + '）')
    check(!!out2 && out2.verdictOfGate === 'defer', '④ 回包如实带回闸的结论（verdictOfGate=' + (out2 && out2.verdictOfGate) + '）')

    // ④c 负控：拿不到后端名时链必须如实丢掉（不许编一个假名字让它看着能记）
    const WS3 = 'C:\\ws\\723-a3'
    const A3 = build('')
    await A3.focus({ windowId: 'win-3', workspaceRoot: WS3, kind: 'focus', visible: true })
    await writeOnce(A3.w, 'sess-a3', WS3)
    const readout3 = A3.w.chainReadoutOf()
    check(readout3.ok === true && readout3.sessions.length === 0, '④ 负控：拿不到后端名时链如实丢掉这一笔、界面照实空着（' + JSON.stringify(readout3).slice(0, 160) + '）')

    // ④d 负控：两处钥匙不同源时必然被推迟（把活跃集合标在另一把钥匙上，证明③那一条不是白测）
    const A4 = build('github')
    await A4.focus({ windowId: 'win-4', workspaceRoot: WS1, kind: 'focus', visible: true })
    A4.gate.setWorkspace(A4.w.hash8(A4.w.hash8(WS1)), { active: true })   // 两层散列那一把（#723 修掉的那把错钥匙）
    A4.gate.setWorkspace(A4.w.hash8(WS1), { active: false })
    const before4 = A4.gate.stats()
    const out4 = await writeOnce(A4.w, 'sess-a4', WS1)
    const v4 = A4.decides.length ? A4.decides[A4.decides.length - 1].verdict : ''
    check(v4 === 'defer' && A4.gate.stats().sent === before4.sent, '④ 负控：活跃集合标在另一把钥匙上时同一笔就被推迟（verdict=' + v4 + '）—— 证明「两处钥匙同源」不是白测')
    check(!!out4 && out4.verdictOfGate === 'defer', '④ 负控的回包也如实带结论（verdictOfGate=' + (out4 && out4.verdictOfGate) + '）')
    void chain
  }

  // ── ⑤ 真被拒绝的现场：经**真入口**（宿主装配出来的七个工具）的一次调用被闸真拒绝 ──
  // 与 ③ 段的区别：③ 是拿闸自己的 admitAiTool 直调（证明裁决函数会拒），这一段是把额度压到只剩一点点，
  // 然后走 wiring.deckToolsForHost() 装出来的表、调真工具，看它是不是照契约回拒绝态。
  {
    const registryMod = await imp('src/host/tracker/registryCore.js')
    const markdownModule = (await imp('src/host/tracker/backends/markdown/index.js')).markdownModule
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't19e-deck-'))
    const mkPlat = () => ({
      path: path.posix,
      fs: {
        async resolve(p) { return String(p).replace(/\\/g, '/') },
        async readText(t) { return fs.readFileSync(t, 'utf8') },
        async writeText(t, c) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
        async lstat(t) { try { return fs.statSync(t) } catch (e) { return null } },
        async listDir(t) { try { return fs.readdirSync(t) } catch (e) { return [] } },
        async stat(t) { try { return fs.statSync(t) } catch (e) { return null } },
      },
    })
    const plat = mkPlat()
    // 一个真实可用的本地 Markdown 工作区（与 tests/verify-deck-tools.js 那份同形：票就是 .scratch/demo/issues/*.md）。
    const wsDir = path.join(path.join(wsRoot, '.scratch'), 'demo')
    fs.mkdirSync(path.join(wsDir, 'issues'), { recursive: true })
    fs.writeFileSync(path.join(wsDir, 'map.md'), '# 演示地图\n\nStatus: ready-for-agent\n\n## Destination\n\n把演示做完\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n', 'utf8')
    const wsPosix = wsRoot.replace(/\\/g, '/')
    const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, { platform: plat, fs: plat.fs, get: (n) => (n === 'fs' ? plat.fs : undefined) }), { matchesTimeout: 200 })
    registry.register(markdownModule)
    registry.bind({ cwd: wsPosix, refId: '.scratch/demo' }, 'markdown')

    /** 额度剩多少由 remaining 定；七个工具与闸都从这一个 wiring 上取（与生产同形）。 */
    async function buildHost(remaining) {
      const base = ledgerMod.createLedger({ now: () => CLOCK })
      // 读数先落账（与实际顺序一致：宿主每分钟同步一次剩余），闸再按这份账判档 —— 顺序反了的话
      // 闸看到的是「还没读过读数」那一份（档位红），什么都会推迟，那就测不到想测的东西。
      base.syncServer({ rest: { limit: 5000, remaining: remaining, reset: CLOCK + 3600000 }, graphql: { limit: 5000, remaining: remaining, reset: CLOCK + 3600000 } }, CLOCK)
      const gate = gateMod.createGate({ ledger: base, now: () => CLOCK })
      const w = wiringMod.createRefreshWiring({
        ctx: { on: () => () => {}, get: (n) => (n === 'fs' ? plat.fs : undefined) },
        logCtx: { fire: () => {}, isEnabled: () => false },
        canonicalKey: async (p) => String(p),
        getCacheDir: async () => os.tmpdir(),
        getTrackerRegistry: async () => registry,
        getPlatform: async () => plat,
        detectionExec: async () => ({ ok: false, kind: 'env', error: '门禁里不发真请求' }),
        setCache: () => {},
        ledger: base, gate: gate,
      })
      // 视野模型上报一次（与界面打开面板时那一次同形）：上报 + 同步活跃集合 —— 不报的话后台档
      // 一律判「不在活跃集合里」，工具连选后端都过不去（515c 那一档测的就是这个）。
      // 这里走的正是 wf.focus 那条路内部的同一对调用（attention.handleFocus → syncAttention）。
      await w.attention.handleFocus({ windowId: 'win-e', workspaceRoot: wsPosix, kind: 'focus', visible: true })
      await w.syncAttention()
      return { ledger: base, gate: gate, w: w, table: await w.deckToolsForHost() }
    }
    const EXEC = { agent: { session: { id: 's-723e', cwd: wsPosix } } }

    // ⑤a 真被拒绝（第一种原因）：额度够，但这一笔自己要得太多（超过单次硬顶）→ ai-tool-refused。
    // 这是**经真入口**的那一次拒绝：走 wiring.deckToolsForHost() 装出来的表、调真工具。
    const H2 = await buildHost(5000)
    const b2 = H2.gate.stats()
    let r2 = null
    try { r2 = await H2.table.tools.deck_map_plan_create.run(EXEC, { planId: 'over-cap', title: '超顶地图', children: Array.from({ length: 400 }, (_, i) => ({ key: 'c' + i, title: '子票' + i })) }) } catch (e) { r2 = { ok: false, status: 'threw', reason: String(e && e.message), text: String(e && e.message) } }
    check(H2.table.names.length === 7, '⑤ 真入口装出七条工具：' + JSON.stringify(H2.table.names))
    check(r2 && r2.ok === false && r2.status === 'unsupported', '⑤ 真被拒绝：回 ok:false / unsupported（实得 ' + (r2 && r2.status) + '）')
    check(r2 && r2.reason === 'ai-tool-refused', '⑤ 真被拒绝：reason 是那个机器可读的拒绝代号（实得 ' + (r2 && r2.reason) + '）')
    check(r2 && typeof r2.text === 'string' && r2.text.indexOf('硬顶') >= 0, '⑤ 真被拒绝：给出了给 AI 看的那句原话（' + String(r2 && r2.text).slice(0, 90) + '…）')
    // 被拒的这一批一条都没发（选后端那一次探测不算：那是**选后端**，它自己会过一次闸并记账；
    // 被拒的是「真正读写」那一步）。
    check(H2.gate.stats().accounted.requests - b2.accounted.requests <= 1, '⑤ 真被拒绝：被拒的那一批一条都没发出去（账上只多了选后端那一次探测：' + (H2.gate.stats().accounted.requests - b2.accounted.requests) + ' 条）')
    console.log('    拒绝原文（超单次硬顶）：' + String(r2 && r2.text).slice(0, 220))

    // ⑤b 对照：额度够、这一笔也不超顶 → 同一入口同一工具真的做成（证明 ⑤a 不是「永远拒绝」的假夹具）
    const H3 = await buildHost(5000)
    let r3 = null
    try { r3 = await H3.table.tools.deck_issue_create.run(EXEC, { title: '额度够的这一笔', kind: 'task' }) } catch (e) { r3 = { ok: false, status: 'threw', reason: String(e && e.message), text: String(e && e.message) } }
    check(r3 && r3.ok === true, '⑤ 对照：额度够时同一入口同一工具真的做成（status=' + (r3 && r3.status) + '）',
      '这一条也失败就说明 ⑤a 的拒绝不是额度造成的：' + JSON.stringify({ status: r3 && r3.status, reason: r3 && r3.reason, text: String((r3 && r3.text) || '').slice(0, 160) }))

    // ⑤c 真被拒绝（第二种原因）：额度已经到保底线 → 这一笔连选后端都过不去，工具照契约回拒绝态（不是抛异常）。
    //    如实报两个可能的结果：闸把「选后端」这一步判成 defer 时 reason 是 gate-defer（推迟），
    //    判成 ai-tool 那一档拒绝时 reason 是 ai-tool-refused —— 两种都是「没做成、如实说」，都不许抛异常。
    const H1 = await buildHost(0)
    const b1 = H1.gate.stats()
    let threw1 = null
    let r1 = null
    try { r1 = await H1.table.tools.deck_issue_create.run(EXEC, { title: '额度已到保底线的这一笔', kind: 'task' }) } catch (e) { threw1 = e }
    check(threw1 === null, '⑤ 额度到保底线：工具没有把异常抛给 AI（照契约回三态；threw=' + (threw1 && threw1.message) + '）')
    check(!!r1 && r1.ok === false && r1.status === 'unsupported', '⑤ 额度到保底线：回 ok:false / unsupported（实得 ' + (r1 && r1.status) + '）')
    check(!!r1 && (r1.reason === 'ai-tool-refused' || r1.reason === 'gate-defer'), '⑤ 额度到保底线：给出的原因代号是那两个之一（实得 ' + (r1 && r1.reason) + '）')
    check(H1.gate.stats().accounted.requests === b1.accounted.requests, '⑤ 额度到保底线：一笔都没发出去（' + b1.accounted.requests + ' → ' + H1.gate.stats().accounted.requests + '；没被静默放行）')
    console.log('    拒绝原文（额度到保底线）：' + String(r1 && r1.text).slice(0, 220))
    try { fs.rmSync(wsRoot, { recursive: true, force: true }) } catch (e) {}
  }

  console.log('\n' + (failed ? '存在失败（' + total + ' 项断言）' : '全部通过 — 闸的裁决、真拒绝与处理链喂数据都在真业务路径上走通（' + total + ' 项断言）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
