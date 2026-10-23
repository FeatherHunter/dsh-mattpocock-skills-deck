// verify-723-gate-wiring.ts —— 门禁：#723（T19）把存量三处传输出口接进唯一出口闸之后，
// 「裁决那一半」在真业务路径上真的走通了（不是只记了一笔账、也不是只喂了一笔）；
// 写事件订阅这一半（#1262 起只判门取数）也在这里守着：它不再往工作路线里记。
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-723-gate-wiring.ts，可独立运行。
//
// 为什么必须单独有这一条：
//   tests/verify-gh-gateway.ts 守的是「每一笔出站都被报给了闸」（记账那一半）与「登记表不许说谎」。
//   光记账不等于 I1 —— 闸的裁决（放行 / 推迟 / 拒绝）那一半如果一次都没被真业务路径调到，接线只是装饰。
//   既有的链视图门禁（tests/verify-chain-view.js）又是**手工拼 note** 的，走的不是生产那条喂数据的路：
//   所以「界面恒显示取到了、空的」这件事，此前没有任何门禁会在红灯里看见。本门禁补上这一段。
//
// 四段：
//   ① 放行：patch.run 的探测被放行；薄行走只读会话、不经闸 send、不花额度，漏网计数仍为 0；
//   ② 推迟：额度压到 0 时闸判 defer，patch.run 如实回 mode=deferred，一条请求都不发、也不抛异常；
//   ③ 拒绝：AI 工具那一档超顶时闸拒绝并给出文案；
//   ④ 写事件那条真路径（生产装配件 createRefreshWiring）：
//      · 写事件触发的取数不再过闸（#1445）：回包如实说 in-pipeline，闸一条裁决都没被问过，
//        花费两格（requests/points）如实记 0 —— 读路径不记账是 #1444 的裁决，真实用量归 #1446；
//      · 交给管线的钥匙与白名单用的是同一把短散列（两把不同 = 同一个工作区被当成两个，
//        10 秒合并窗口永远不生效 —— 这是 #723 栽过一次的坑，换了位置照样守）；
//      · 写事件订阅不再喂工作路线（#1262 删掉了旧推断路）：走完这一笔之后链照实空着；
//      · 没上报过的工作区同一笔必须连门都过不了（负控）。
const path = require('path')
const os = require('os')
const fs = require('fs')
const { pathToFileURL } = require('url')
// 夹具说「这个工作区选过了」的唯一办法（#1138 起）：给这个工作区一份工作区文件
// （docs/agents/workspace.yaml）。这一段走的生产装配（wiring.deckToolsForHost），判定出口是生产那一个，
// 它按文件服务读这份文件，所以这里要真写一份到临时工作区目录里，不能用内存账本；
// 来历与另一种造法见 tests/lib/deck-decide-stub.js 文件头。
const { writeWorkspaceFile } = require('./lib/deck-decide-stub.js')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: boolean, msg: string, detail?: string): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || !detail ? '' : '\n         → ' + detail))
  if (!ok) failed = true
}
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)

const CLOCK = 1700000000000
const CWD = 'C:\\ws\\723-gate'
const WS = 'ws-723-gate'

function row(n: number, state: string, updatedAt: string) {
  return { number: n, key: String(n), title: '票 ' + n, state: state, updatedAt: updatedAt, labels: [], assignees: [], createdAt: '2026-09-01T00:00:00Z' }
}

async function main() {
  console.log('#723（T19）门禁：闸的裁决 (放行/推迟/拒绝) 与写事件过门取数，都在真业务路径上走通')
  const delta = await imp('src/refresh/kernel/snapshot-diff.js')
  const win = await imp('src/refresh/kernel/index-window-rules.js')
  const budget = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod = await imp('src/refresh/rooms/host/refresh-gate.ts')
  const patchMod = await imp('src/refresh/rooms/host/row-patch.js')
  const wiringMod = await imp('src/refresh/rooms/host/refresh-runtime.ts')
  const attentionMod = await imp('src/refresh/rooms/host/host-attention.js')
  // 工具名字数对照**装配顺序常量本身**（src/deck/tools/tool-order.ts 的 DECK_TOOL_ORDER），
  // 不写死「七条」那种字面：工具从七个长到九个时，写死的断言会平白变红一次，
  // 而那条红与产品行为毫无关系（2026-10-02 就是这么查出来的）。
  const DECK_TOOL_NAMES = (await imp('src/deck/tools/tool-order.ts')).DECK_TOOL_ORDER

  /** 一个只活在这一次里的闸 + 账本（真件），配一层假传输层（每真发一条就报给闸一次，与生产同一口径）。 */
  function world(opts?: { remaining?: number }) {
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
    const gets: string[] = []
    // 假会话：读路径只经它取数（#1444 起薄行不再直调 gh、也不再经闸 send）。
    const session = {
      get: async (ref: any, key: any) => {
        gets.push(String(key))
        return { ok: true, data: { key: String(key), effortId: 'e', type: 'issue', title: '票 ' + key, state: 'closed', body: '', url: 'https://github.com/o/r/issues/' + key, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-23T00:00:00Z', closedAt: null, parentKey: null, labels: [], assignees: [{ login: 'me' }], author: { login: 'me' }, blockedBy: [], isPullRequest: false, mergedAt: null, reviews: [] } }
      },
    }
    const patch = patchMod.createPatch({
      now: () => CLOCK, workspaceKeyOf: () => WS,
      readSnapshot: async () => store, writeSnapshot: async (cwd, snap) => { Object.assign(store, snap) },
      indexOfSnapshot: win.indexFromSnapshot, windowRules: win,
      getRepoKey: async () => ({ owner: 'o', name: 'r' }),
      probeIndex: async () => ({ ok: true, index: { '301': 'CLOSED|2026-09-23T00:00:00Z', '302': 'OPEN|2026-09-19T00:00:00Z', '303': 'OPEN|2026-09-18T00:00:00Z' } }),
      openSession: async () => ({ ok: true, backendId: 'github', budget: {}, call: (fn: any) => fn(session, { cwd: CWD, caller: 'refresh' }) }),
      decide: (req) => gate.decideFor(req),
    })
    return { store, ledger, gate, patch, gets }
  }

  // ── ① 放行 ──
  {
    const w = world({})
    const before = w.gate.stats()
    const r = await w.patch.run(CWD)
    const after = w.gate.stats()
    check(r.mode === 'patch', '① 放行：patch.run 走通行级补行（mode=' + r.mode + ' / reason=' + r.reason + '）')
    check(after.sent - before.sent === 0, '① 读路径不经闸 send：放行只由探测那一步问过裁决（sent ' + before.sent + ' → ' + after.sent + '）')
    check(after.accounted.requests - before.accounted.requests === 0, '① 读路径不花额度：闸上一笔都没记（accounted ' + before.accounted.requests + ' → ' + after.accounted.requests + '）')
    check(w.gets.length === 1 && w.gets[0] === '301', '① 取数：只问变的那一张票（会话 get ' + JSON.stringify(w.gets) + '）')
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
    check(w.gets.length === 0, '② 推迟：一条薄查询都没发出去（' + w.gets.length + ' 条）——推迟不是「发了再失败」')
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
    /** 生产装配的那一套：真闸真账本 + 真注册表（报告「这个工作区用 github」）+ 真工作路线。 */
    function build(registryBackend: string) {
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
    const writeOnce = (w: { writeEvents: { handle: (...args: unknown[]) => unknown } }, sid: string, ws: string) => w.writeEvents.handle({ id: sid, header: { cwd: ws } }, 'tools/result', 'pwsh', JSON.stringify({ command: CMD }), true)

    // ④a 写事件不再经闸：这一笔直接交给管线，闸一次裁决都没被问过（#1445）
    const A1 = build('github')
    await A1.focus({ windowId: 'win-1', workspaceRoot: WS1, kind: 'focus', visible: true })
    const key = A1.w.hash8(WS1)
    check(A1.gate.workspaceView(key).active === true, '④ 上报之后闸把这一格标成活跃（key=' + key + '）')
    const before1 = A1.gate.stats()
    const decides1 = A1.decides.length
    const out1 = await writeOnce(A1.w, 'sess-a1', WS1)
    const after1 = A1.gate.stats()
    check(!!out1 && out1.verdictOfGate === 'in-pipeline', '④ 写事件这一趟如实报告「已交给管线」（verdictOfGate=' + (out1 && out1.verdictOfGate) + '）',
      '从前这里是 allow/defer —— #1445 起不再有闸裁决')
    check(A1.decides.length === decides1 && after1.sent === before1.sent, '④ 闸一次裁决都没被问过（refresh.decide ' + decides1 + ' → ' + A1.decides.length + ' 条、闸的 sent ' + before1.sent + ' → ' + after1.sent + '）',
      '还有裁决记录 = 写事件那条路还在过闸')
    const s1 = A1.w.writeEvents.stats()
    check(s1.sent === 1 && s1.event.requests === 0 && s1.event.points === 0, '④ 订阅自己数「交给管线 1 趟」，花费两格如实记 0（sent=' + s1.sent + '、requests=' + s1.event.requests + '、points=' + s1.event.points + '）',
      '读路径不记账（#1444 裁决），真实用量归 #1446')
    check(typeof A1.w.writeEvents.lastGateKey !== 'function', '④ 旧读数口 lastGateKey 已摘除（不过闸了，没有「最后一次过闸的钥匙」可答）',
      '旧读数口还在 = #1445 的退役没做干净')
    // #1271：旧链读数口已摘除；写事件订阅只判门取数，结构上就没有往工作路线写的口
    // （本目录零存储引用，落盘只发生在工具壳成功收口那一步，由 verify-1261 / verify-deck-tools 守）。
    check(typeof A1.w.chainReadoutOf !== 'function',
      '④ 旧链读数口已摘除（chainReadoutOf 不再由装配点交回）',
      '旧读数口还在 = #1271 的退役没做干净')

    // ④b 负控：没上报过（不在白名单）的工作区，事件连门都过不了 —— 回 null、seen 不增、一趟都不取。
    // 这一段守的是门前那道工作区归属判定：它比闸更早，不该因为「不过闸了」就把门一起撤掉。
    const A2 = build('github')
    const before2 = A2.w.writeEvents.stats()
    const out2 = await writeOnce(A2.w, 'sess-a2', WS2)
    const after2 = A2.w.writeEvents.stats()
    check(out2 === null && after2.seen === before2.seen && after2.sent === 0, '④ 负控：不在白名单的工作区同一笔被门挡下（回包=' + JSON.stringify(out2) + '、seen ' + before2.seen + ' → ' + after2.seen + '、sent=' + after2.sent + '）',
      '门被撤掉 = 别的会话的写也会拉起取数')

    // ④c 交给管线的钥匙与白名单同源：直接起一份订阅、给一个记录取数的假函数，
    // 看它递出去的 meta.workspaceKey 是不是 allowRoot 交回的那把。生产装配件那一格的取数今天是空实现
    // （refresh-runtime.ts:201 只回零花费），没法在那里看见这个值，所以这一段单独起一份订阅。
    const writeEventsMod = await imp('src/refresh/rooms/host/write-event-subscription.ts')
    const fetchedC: any[] = []
    const weC = writeEventsMod.createWriteEvents({
      fetch: async (step: any, meta: any) => { fetchedC.push({ step: step, meta: meta }); return { requests: 0, points: 0 } },
      canonicalKey: async (x: any) => String(x),
    })
    const allowKey = await weC.allowRoot(WS1)
    const outC = await weC.handle({ id: 'sess-c', header: { cwd: WS1 } }, 'tools/result', 'pwsh', JSON.stringify({ command: CMD }), true)
    check(allowKey === A1.w.hash8(WS1) && fetchedC.length === 1 && fetchedC[0].meta.workspaceKey === allowKey,
      '④ 交给管线的钥匙与白名单是同一把（白名单=' + allowKey + '、递出=' + (fetchedC[0] && fetchedC[0].meta.workspaceKey) + '）',
      '两把钥匙不同 = 同一个工作区被当成两个，合并窗口永远不生效（#723 栽过的坑）')
    check(fetchedC.length === 1 && fetchedC[0].step.action === 'patch-now' && fetchedC[0].meta.source === 'event.write' && fetchedC[0].meta.kind === 'patch' && !!outC && outC.verdictOfGate === 'in-pipeline',
      '④ 交给管线的那一步形状稳定（step.action=' + (fetchedC[0] && fetchedC[0].step.action) + '、meta.source=' + (fetchedC[0] && fetchedC[0].meta.source) + '、meta.kind=' + (fetchedC[0] && fetchedC[0].meta.kind) + '）',
      '形状变了 = 换成真取数时那一侧要跟着分岔')
  }

  // ── ⑤ 真被拒绝的现场：经**真入口**（宿主装配出来的九个工具）的一次调用被闸真拒绝；外加离网对照 ──
  // 与 ③ 段的区别：③ 是拿闸自己的 admitAiTool 直调（证明裁决函数会拒），这一段是让这一笔自己要得太多，
  // 然后走 wiring.deckToolsForHost() 装出来的表、调真工具，看它是不是照契约回拒绝态。
  // ⑤c 是 #1439（#1442）的验收：本地 Markdown 是离网后端，没有额度可言，额度压到 0 也照样放行 ——
  // 旧口径「离网后端到保底线也要被拒」与规格冲突，已按规格改成「照样做成、不出现 gate-defer、账上不多记」。
  {
    const registryMod = await imp('src/tracker/registry/core.ts')
    const markdownModule = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't19e-deck-'))
    const mkPlat = () => ({
      path: path.posix,
      fs: {
        // 相对目标按 {cwd} 拼成绝对路径，绝对目标原样返回 —— 真文件服务就是这样：
        // 判定出口那一条读口（wiring 的 readWorkspaceFileText）传的是相对路径 + 工作区根，
        // 这里如实还原那件事，下面写进临时工作区的 workspace.yaml 才读得回来。
        async resolve(p, o) {
          const s = String(p).replace(/\\/g, '/')
          const cwd = (o && o.cwd) ? String(o.cwd).replace(/\\/g, '/').replace(/\/+$/, '') : ''
          if (cwd && !/^([A-Za-z]:)?\//.test(s)) return cwd + '/' + s
          return s
        },
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
    // #1138 起「这个工作区选过了」只记在工作区文件里：这里原来写的是
    // registry.bind({ cwd: wsPosix, refId: '.scratch/demo' }, 'markdown')，注册表的绑定口子已整段删掉
    // （见 src/tracker/registry/core.ts 文件头）。下面这一行真把那份文件写进临时工作区目录，
    // 生产判定出口读它得出的结论与旧绑定那一条同源（写用途因此才被放行）。
    writeWorkspaceFile(wsRoot, 'markdown')

    /** 额度剩多少由 remaining 定；九个工具与闸都从这一个 wiring 上取（与生产同形）。 */
    async function buildHost(remaining: number) {
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
    try { r2 = await H2.table.tools.deck_map_plan_create.run(EXEC, { planId: 'over-cap', title: '超顶地图', children: Array.from({ length: 400 }, (_, i) => ({ key: 'c' + i, title: '子票' + i, kind: 'issue' })) }) } catch (e) { r2 = { ok: false, status: 'threw', reason: String(e && e.message), text: String(e && e.message) } }
    check(H2.table.names.length === DECK_TOOL_NAMES.length && H2.table.missing.length === 0, '⑤ 真入口装出全部 ' + DECK_TOOL_NAMES.length + ' 个工具（缺 ' + H2.table.missing.length + ' 个）：' + JSON.stringify(H2.table.names))
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
    try { r3 = await H3.table.tools.deck_issue_create.run(EXEC, { title: '额度够的这一笔', kind: 'issue' }) } catch (e) { r3 = { ok: false, status: 'threw', reason: String(e && e.message), text: String(e && e.message) } }
    check(r3 && r3.ok === true, '⑤ 对照：额度够时同一入口同一工具真的做成（status=' + (r3 && r3.status) + '）',
      '这一条也失败就说明 ⑤a 的拒绝不是额度造成的：' + JSON.stringify({ status: r3 && r3.status, reason: r3 && r3.reason, text: String((r3 && r3.text) || '').slice(0, 160) }))

    // ⑤c 离网对照（#1439 验收）：额度已经到保底线，但本地 Markdown 是离网后端、没有额度可言 ——
    //    闸的额度探针直接跳过，这一笔照旧做成，回执如实说「本后端不需要额度」，账上不多记。
    //    这不是「没做成」：旧口径「连选后端都过不去」正是 #1435 报的那条 bug，规格要求它消失。
    const H1 = await buildHost(0)
    const b1 = H1.gate.stats()
    let threw1 = null
    let r1 = null
    try { r1 = await H1.table.tools.deck_issue_create.run(EXEC, { title: '额度已到保底线的这一笔', kind: 'issue' }) } catch (e) { threw1 = e }
    check(threw1 === null, '⑤ 离网后端：工具没有把异常抛给 AI（照契约回三态；threw=' + (threw1 && threw1.message) + '）')
    check(!!r1 && r1.ok === true && r1.status === 'ok', '⑤ 离网后端在额度见底时照样做成（实得 ' + (r1 && r1.status) + ' / ' + (r1 && r1.reason) + '）')
    check(!!r1 && r1.cost && r1.cost.actual && r1.cost.actual.remaining === -1 && r1.cost.actual.tier === 'off-network', '⑤ 回执照实说额度不适用（remaining=' + (r1 && r1.cost && r1.cost.actual && r1.cost.actual.remaining) + ' / tier=' + (r1 && r1.cost && r1.cost.actual && r1.cost.actual.tier) + '）')
    check(!!r1 && Array.isArray(r1.notes) && r1.notes.join('').indexOf('本后端不需要额度') >= 0, '⑤ 回执里写出「本后端不需要额度」那一句（实得 ' + JSON.stringify(r1 && r1.notes) + '）')
    // 不做成「闸被绕过了」：闸的裁决本身没坏，只是离网后端这一趟根本不问它。
    const probe = H1.gate.admitAiTool({ points: 0, requests: 1, childTickets: 0 }, { workspaceKey: wsPosix, kind: 'tool-batch', bucket: 'rest' })
    check(probe && probe.admitted === false && probe.reason === 'ai-tool-below-remaining', '⑤ 对照：同一格额度见底时闸照样会拒（裁决没坏；实得 ' + JSON.stringify({ admitted: probe && probe.admitted, reason: probe && probe.reason }) + '）')
    check(H1.gate.stats().accounted.requests === b1.accounted.requests && H1.gate.stats().deferred === b1.deferred, '⑤ 账上不多记、也没进推迟队列（accounted ' + b1.accounted.requests + ' → ' + H1.gate.stats().accounted.requests + '；deferred ' + b1.deferred + ' → ' + H1.gate.stats().deferred + '）')
    try { fs.rmSync(wsRoot, { recursive: true, force: true }) } catch (e) {}
  }

  console.log('\n' + (failed ? '存在失败（' + total + ' 项断言）' : '全部通过 — 闸的裁决、真拒绝与写事件过门取数都在真业务路径上走通（' + total + ' 项断言）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
