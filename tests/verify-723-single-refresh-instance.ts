#!/usr/bin/env node
/**
 * verify-723-single-refresh-instance.ts —— 门禁：宿主里只许有一套刷新机制（票 #723）
 *
 * 现状（#1262 起）：旧链读数不再由写事件喂——它读的旧 workRoute 表已经按规格 #1259 决定 5
 * 删掉了写入口，面板胶囊在 #1263 重接新的读出口（与回执 data.workRoute 同源）。所以本门禁
 * 盯的是过渡期的事实：写事件只负责过闸取数、不再往旧链里写；回执那条新读出口由
 * verify-1261-work-route-receipt 看门。
 *
 * 留下的断言都是跑起来的结果：
 *   三、一套实例下五条路互相看得见（真装配、真过闸、真取数）；
 *   四、负控：两套实例时，没标活跃的那一套在门前就把事件拒了；
 *   五、宿主侧字段名等于读数模块导出的那个常量（拿真装配交回来的对象与真快照回包量）。
 *   原先的「一、全仓只有一处装配点」「二、五条路都从同一个句柄取」两段读的是
 *   src/host/index.js 与 src/host/refresh/wiring.js 的源码文本（数出现次数、跑正则），
 *   2026-10 按维护者口径撤掉：那种断言的对象是手写源码的文本，等价重构（改写法、
 *   搬文件、改注释）就会变红，挡不住真回归。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-723-single-refresh-instance.ts
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
const url = (rel: string) => pathToFileURL(path.join(ROOT, rel)).href

let failed = false
let total = 0
const check = (ok: boolean, msg: string, detail?: string): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || !detail ? '' : '\n         → ' + detail))
  if (!ok) failed = true
}

/** 一套「生产依赖形状」的假件：形状照 src/host/index.js 里 makeRefreshLoader( 那一份抄（不另造一套 API）。 */
let LedgerMod = null
let GateMod = null
const CLOCK = 1700000000000
function makeDeps(store: Record<string, unknown>) {
  // 账本与闸：给一份「刚同步过、额度充足」的读数 —— 不然闸会按「剩余为 0」把后台档判成
  // reserve-kept-for-writes（那是另一条路径，本门禁要测的是「同一套实例」下的放行）。
  const ledger = LedgerMod.createLedger({ now: () => CLOCK })
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: CLOCK + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: CLOCK + 3600000 } }, CLOCK)
  const gate = GateMod.createGate({ ledger: ledger, now: () => CLOCK, logCtx: store.logCtx })
  store.ledger = ledger
  store.gate = gate
  return {
    ctx: { on: () => () => {}, get: () => undefined, effect: (fn) => { try { const d = fn(); return typeof d === 'function' ? d : () => {} } catch (e) { return () => {} } } },
    logCtx: store.logCtx,
    ledger: ledger,
    gate: gate,
    canonicalKey: async (x) => String(x),
    getCacheDir: async () => store.dir,
    getTrackerRegistry: async () => ({ modules: () => [] }),
    getDetectionService: async () => ({ detect: async () => ({ selection: { backendId: 'github', source: 'auto' } }) }),
    getPlatform: async () => ({ os: process.platform === 'win32' ? 'win32' : 'linux', path: path, getHome: async () => os.homedir() }),
    detectionExec: async () => ({ ok: false }),
    setCache: () => {}, getCache: () => null,
    readDiskCache: async () => null, writeDiskCache: async () => {},
    runGh: async () => ({ ok: false, kind: 'network', error: 'fixture' }),
    getRepoKey: async () => ({ owner: 'acme', name: 'demo' }),
    fetchIssueIndex: async () => ({ ok: false }),
    issueIndexFromSnapshot: () => ({}),
  }
}

const WS = 'C:\\ws\\t19b-single'
const WRITE_CMD = JSON.stringify({ command: 'gh issue comment 723 --body "复核"' })

async function main() {
  console.log('#723 唯一刷新机制门禁（一套实例 / 五条路同源 / 宿主侧字段名）')

  // ── 三、行为：一套实例下写事件过门取数 ──
  console.log('\n== 三、一套实例：写事件过门取数 ==')
  const store = { dir: fs.mkdtempSync(path.join(os.tmpdir(), 't19b-single-')), logCtx: null, decides: [] }
  store.logCtx = { isEnabled: () => true, fire: (l, e, f) => { if (e === 'refresh.decide') store.decides.push(typeof f === 'function' ? f() : f) } }
  const wiringMod = await import(url('src/host/refresh/wiring.ts'))
  LedgerMod = await import(url('src/host/refresh/ledger.ts'))
  GateMod = await import(url('src/host/refresh/gate.ts'))
  const load = wiringMod.makeRefreshLoader(makeDeps(store))
  const w = await load()
  check(typeof w.focus === 'function' && typeof w.chainReadout === 'function' && typeof w.deltaRefresh === 'function' && w.gate && w.writeEvents,
    '装配点交回来的是一套实例（focus / chainReadout / deltaRefresh / gate / writeEvents 都在同一个对象上）',
    '缺件 = 五条路里有人另找了一套')

  // ① wf.focus 上报「我在看谁」
  const focused = await w.focus({ windowId: 'win-1', workspaceRoot: WS, kind: 'focus', visible: true })
  const key = w.hash8(WS)
  check(!!focused && focused.ok === true && focused.standing === 'active', 'wf.focus 上报成功并落在活跃集合里（' + JSON.stringify(focused).slice(0, 90) + '）')
  check(w.gate.workspaceView(key).active === true, '同一套实例的闸把这一格标成活跃（key=' + key + '）', '闸与视野模型不是同一套')

  // ② 喂一笔真写事件（订阅在同一套实例上）
  const before = w.gate.stats()
  const handled = await w.writeEvents.handle({ id: 'sess-1', header: { cwd: WS } }, 'tools/result', 'pwsh', WRITE_CMD, true)
  const after = w.gate.stats()
  check(w.writeEvents.stats().seen === 1, '写事件订阅收下了这一笔（stats().seen=1）', '门前被拒 = 白名单与视野模型不是同一套')
  check(!!handled && handled.verdictOfGate === 'allow' && after.sent === before.sent + 1,
    '写事件过闸**真的被放行**（裁决=' + (handled && handled.verdictOfGate) + '、闸的 sent ' + before.sent + ' → ' + after.sent + '）',
    '恒 defer = 活跃集合标记到了另一套上')
  check(store.decides.some((d) => d.verdict === 'allow' && d.reason === 'background-fits'),
    '裁决那一步真的走过（refresh.decide：' + JSON.stringify(store.decides.slice(-1)) + '）')

  // ③ 旧链读数不再由写事件喂（#1262）：写事件只过闸取数，旧 workRoute 表已经没有写入口。
  //    面板胶囊在 #1263 重接新的读出口（与回执 data.workRoute 同源）；这里钉住过渡期的事实，
  //    防止有人把旧的写事件推断路又接回来。
  const readout = w.chainReadout()
  check(!!readout && readout.ok === true && readout.reason === 'host.chain.empty' && readout.sessions.length === 0,
    '写事件只过闸取数，不再往旧链读数里喂数据（旧写入口已删，胶囊待 #1263 重接）：' + JSON.stringify(readout).slice(0, 120),
    '旧链又被喂了数据 = 双写回来了')

  // ④ 行级增量那条路问的是同一个闸、同一把钥匙
  const vPatch = w.gate.decideFor({ source: 'patch.apply', kind: 'patch', workspaceKey: key })
  check(vPatch.verdict === 'allow', '行级增量过闸的结论是放行（' + JSON.stringify(vPatch) + '）',
    'defer/background-inactive = 增量那条路在另一套实例上（真机上一次都不发）')

  // ── 四、行为负控：照旧形状建两套 → 后果必须重现 ──
  console.log('\n== 四、负控：两套实例的旧形状必须重现后果 ==')
  const storeA = { dir: fs.mkdtempSync(path.join(os.tmpdir(), 't19b-two-a-')), logCtx: { isEnabled: () => false, fire: () => {} }, decides: [] }
  const storeB = { dir: fs.mkdtempSync(path.join(os.tmpdir(), 't19b-two-b-')), logCtx: { isEnabled: () => false, fire: () => {} }, decides: [] }
  const wA = await wiringMod.makeRefreshLoader(makeDeps(storeA))()   // 旧形状：入口一套（被读数的那一套）
  const wB = await wiringMod.makeRefreshLoader(makeDeps(storeB))()   // 旧形状：wf.focus 又一套
  check(wA !== wB && wA.gate !== wB.gate, '负控夹具：两次装配拿到两套实例（闸都不是同一个）')
  await wB.focus({ windowId: 'win-2', workspaceRoot: WS, kind: 'focus', visible: true })
  check(wA.gate.workspaceView(wA.hash8(WS)).active === false && wB.gate.workspaceView(wB.hash8(WS)).active === true,
    '负控：活跃集合只标在 wf.focus 那一套上，被读数的那一套没被标')
  // #1262：旧链的写入口（写事件在门前喂链，即 #781 起的那条推断路）已按规格 #1259 决定 5 删掉，
  //   读数的观测面随之改变——两套实例的 chainReadout 现在都恒空，「读数取自另一套就看不见」这条
  //   旧负控失去了区分力，随之撤掉（新的读出口由 verify-1261 看门）。保留的是负控真正要证的东西：
  //   门与白名单每套实例各一份，没 focus 过的那一套会在门前把事件拒掉（生产里等于写事件没订上）。
  const outB = await wB.writeEvents.handle({ id: 'sess-b', header: { cwd: WS } }, 'tools/result', 'pwsh', WRITE_CMD, true)
  check(wB.writeEvents.stats().seen === 1 && !!outB && outB.verdictOfGate === 'allow', '负控：喂给标了活跃的那一套（wB）时它照常收下并放行（实得 ' + JSON.stringify(outB && outB.verdictOfGate) + '）')
  const outA = await wA.writeEvents.handle({ id: 'sess-a', header: { cwd: WS } }, 'tools/result', 'pwsh', WRITE_CMD, true)
  check(wA.writeEvents.stats().seen === 0 && outA === null, '负控：没标活跃的那一套门前就把这一笔拒了（seen=0）—— 生产里写事件等于没订上')

  // ── 五、宿主侧字段名：必须与读数模块导出的常量同一份 ──
  console.log('\n== 五、宿主侧字段名 ==')
  const readoutMod = await import(url('src/host/refresh/sessionChainReadout.js'))
  const FIELD = readoutMod.SESSION_CHAIN_FIELD
  check(w.chainField === FIELD,
    '装配点带出来的字段名等于那个常量（chainField=' + JSON.stringify(w.chainField) + '）',
    '又多了一处字段名')

  // 行为：真 sessionSnapshot 的回包上，按那个常量取得出读数（拿一份真读数注入）
  const ticketsMod = await import(url('src/host/refresh/workRoute.ts'))
  const snapMod = await import(url('src/host/sessionSnapshot.ts'))
  const app = ticketsMod.createWorkRoute({ cacheDir: store.dir, now: () => 1700000000000 })
  await app.note({ sessionId: 'sess-2', rootKey: WS, backend: 'github', source: 'tool-args', tool: 'deck_issue_create', tier: 'write-confirmed', args: { issue: 701 } })
  const one = readoutMod.buildSessionChainReadout({ tickets: app, at: 1700000000000 })
  const table = new Map()
  const snapDeps = {
    canonicalKey: async (x) => String(x),
    selectEarly: async () => ({ backendId: 'github', source: 'auto', rev: 0 }),
    isComposerSelection: () => true,
    getTrackerRegistry: async () => ({ modules: () => [], describe: () => ({ backend: 'github', refId: 'acme/demo', name: 'acme/demo', url: '' }), get: () => ({ list: async () => ({ ok: true, data: [] }) }) }),
    getPlatform: async () => ({ os: 'win32', path: path, getHome: async () => os.homedir() }),
    ctx: { get: () => undefined },
    getCache: (cwd) => table.get(String(cwd)) || { ts: 0, snapshot: null, error: null, cwd: String(cwd) },
    setCache: (v) => { if (v && v.cwd) table.set(String(v.cwd), { ts: v.ts, snapshot: v.snapshot, error: v.error, cwd: String(v.cwd) }) },
    CACHE_MS: 60000,
    cacheSnapshotIsCurrent: async () => null,
    upcaseSnapStates: (s) => s,
    computeLevels: () => ({ byNumber: {}, byKey: {} }),
    groupTickets: (t) => ({ total: t.length, open: t.length, closed: 0, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} }),
    getRepoRoot: async (cwd) => cwd,
    getRepoKey: async () => ({ owner: 'acme', name: 'demo' }),
    readDiskCache: async () => null, writeDiskCache: async () => {},
    adoptSnapshot: (snap) => snap,
    detectionExec: async () => ({ ok: false }),
    getGhPath: () => '', getGhLastError: () => '',
    errText: (e) => String((e && e.message) || e),
    DEFAULT_CWD: WS,
    logCtx: { fire: () => {}, isEnabled: () => false },
    chainReadout: () => one,
  }
  const reply = await snapMod.createSessionSnapshot(snapDeps).handleSnapshot({ cwd: WS })
  check(!!reply && reply.ok === true && reply[FIELD] !== undefined,
    '真快照回包上，按读数模块那一个常量取得出读数（reply[' + FIELD + ']）',
    '宿主把读数挂在了别的字段名上 —— 界面按常量取不到')
  const replyNo = await snapMod.createSessionSnapshot(Object.assign({}, snapDeps, { chainReadout: undefined })).handleSnapshot({ cwd: WS })
  check(!!replyNo && replyNo.ok === true && replyNo[FIELD] === undefined,
    '负控：没接上读数时那个字段**不在**回包上（界面会如实说读不到，不拿空列表冒充「没有人在处理票」）')

  try { fs.rmSync(store.dir, { recursive: true, force: true }) } catch (e) {}
  try { fs.rmSync(storeA.dir, { recursive: true, force: true }) } catch (e) {}
  try { fs.rmSync(storeB.dir, { recursive: true, force: true }) } catch (e) {}

  console.log(failed ? '\n存在失败 — 宿主里不止一套刷新机制（' + total + ' 项断言）' : '\n全部通过 — 宿主里只有一套刷新机制（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(2) })
