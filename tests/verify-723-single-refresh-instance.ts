#!/usr/bin/env node
/**
 * verify-723-single-refresh-instance.ts —— 门禁：宿主里只许有一套刷新机制（票 #723）
 *
 * 现状（#1271 起）：旧 workRoute 表、旧链读数与旧链读数口已整体退役并删除——面板胶囊与快照
 * 回包统一读新的 workRouteTable（与回执 data.workRoute 同源，读出口与判据由 #1082 的门禁看门）。
 * 所以本门禁盯的是退役后的事实：装配点上只有一套实例、只有新表挂载口、旧字段名不再出现。
 *
 * 留下的断言都是跑起来的结果：
 *   三、一套实例下五条路互相看得见（真装配、真取数；写事件自 #1445 起不过闸）；
 *   四、负控：两套实例时，没标活跃的那一套在门前就把事件拒了；
 *   五、宿主侧字段名等于新表读出模块导出的那个常量（拿真装配交回来的对象与真快照回包量）。
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
  const wiringMod = await import(url('src/refresh/rooms/host/refresh-runtime.ts'))
  LedgerMod = await import(url('src/refresh/rooms/host/quota-ledger.ts'))
  GateMod = await import(url('src/refresh/rooms/host/refresh-gate.ts'))
  const load = wiringMod.makeRefreshLoader(makeDeps(store))
  const w = await load()
  check(typeof w.focus === 'function' && typeof w.workRouteTableReadout === 'function' && typeof w.deltaRefresh === 'function' && w.gate && w.writeEvents,
    '装配点交回来的是一套实例（focus / workRouteTableReadout / deltaRefresh / gate / writeEvents 都在同一个对象上）',
    '缺件 = 五条路里有人另找了一套')
  check(typeof w.chainReadout === 'undefined' && typeof (w as any).chainReadoutOf === 'undefined',
    '旧链读数口已摘除（chainReadout / chainReadoutOf 不再由装配点交回）',
    '旧口还在 = #1271 退役没做干净')

  // ① wf.focus 上报「我在看谁」
  const focused = await w.focus({ windowId: 'win-1', workspaceRoot: WS, kind: 'focus', visible: true })
  const key = w.hash8(WS)
  check(!!focused && focused.ok === true && focused.standing === 'active', 'wf.focus 上报成功并落在活跃集合里（' + JSON.stringify(focused).slice(0, 90) + '）')
  check(w.gate.workspaceView(key).active === true, '同一套实例的闸把这一格标成活跃（key=' + key + '）', '闸与视野模型不是同一套')

  // ② 喂一笔真写事件（订阅在同一套实例上）
  // #1445 起这一趟不再过闸：回包说的是「已交给管线」，闸既没有裁决、也没有被记账。
  const before = w.gate.stats()
  const decidesBefore = store.decides.length
  const handled = await w.writeEvents.handle({ id: 'sess-1', header: { cwd: WS } }, 'tools/result', 'pwsh', WRITE_CMD, true)
  const after = w.gate.stats()
  const weStats = w.writeEvents.stats()
  check(weStats.seen === 1, '写事件订阅收下了这一笔（stats().seen=1）', '门前被拒 = 白名单与视野模型不是同一套')
  check(!!handled && handled.verdictOfGate === 'in-pipeline' && weStats.sent === 1,
    '写事件这一趟**真的交给了管线**（回包=' + (handled && handled.verdictOfGate) + '、订阅自己数的 sent=' + weStats.sent + '）',
    '恒 defer = 活跃集合标记到了另一套上；恒 in-pipeline 但 sent=0 = 只在回包里说了句空话')
  check(after.sent === before.sent && store.decides.length === decidesBefore,
    '闸这一趟既没记账也没裁决（闸的 sent ' + before.sent + ' → ' + after.sent + '、refresh.decide ' + decidesBefore + ' → ' + store.decides.length + ' 条）',
    '还有裁决记录 = 写事件那条路仍在过闸')
  check(weStats.event.requests === 0 && weStats.event.points === 0,
    '花费两格如实记 0（requests=' + weStats.event.requests + '、points=' + weStats.event.points + '）—— 读路径不记账（#1444 裁决），真实用量归 #1446')

  // ③ 写事件只判门取数（#1271 删旧推断路；#1445 起连闸也不过）：旧 workRoute 表与旧链读数已整体删除，
  //    写事件没有任何旧表的写入口；跨会话在办数据只走新的 workRouteTable（与回执 data.workRoute 同源）。
  //    这里钉住退役后的事实，防止有人把旧的写事件推断路又接回来。
  check(w.writeEvents.stats().seen === 1,
    '写事件只判门取数（本节第 ② 步已有一笔交给管线），没有旧表可写 = 无双写')

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
  // #1271：旧链的写入口与读数模块已整体删除（连同旧 workRoute 表一起退役），
  //   「读数取自另一套就看不见」这条旧负控随之撤掉（新的读出口由 #1082 的门禁与 verify-1261 看门）。
  //   保留的是负控真正要证的东西：
  //   门与白名单每套实例各一份，没 focus 过的那一套会在门前把事件拒掉（生产里等于写事件没订上）。
  const outB = await wB.writeEvents.handle({ id: 'sess-b', header: { cwd: WS } }, 'tools/result', 'pwsh', WRITE_CMD, true)
  check(wB.writeEvents.stats().seen === 1 && !!outB && outB.verdictOfGate === 'in-pipeline', '负控：喂给标了活跃的那一套（wB）时它照常收下并交给管线（实得 ' + JSON.stringify(outB && outB.verdictOfGate) + '）')
  const outA = await wA.writeEvents.handle({ id: 'sess-a', header: { cwd: WS } }, 'tools/result', 'pwsh', WRITE_CMD, true)
  check(wA.writeEvents.stats().seen === 0 && outA === null, '负控：没标活跃的那一套门前就把这一笔拒了（seen=0）—— 生产里写事件等于没订上')

  // ── 五、宿主侧字段名：必须与新表读出模块导出的常量同一份（#1271） ──
  console.log('\n== 五、宿主侧字段名 ==')
  const readoutMod = await import(url('src/refresh/rooms/host/work-route-readout.js'))
  const FIELD = readoutMod.WORK_ROUTE_TABLE_FIELD
  check((w as any).workRouteTableField === FIELD,
    '装配点带出来的字段名等于那个常量（workRouteTableField=' + JSON.stringify((w as any).workRouteTableField) + '）',
    '又多了一处字段名')
  check(typeof (w as any).chainField === 'undefined',
    '旧字段名（chainField）不再由装配点交回',
    '旧字段名还在 = #1271 退役没做干净')

  // 行为：真 sessionSnapshot 的回包上，按那个常量取得出新表（拿一份真读数注入）
  const snapMod = await import(url('src/refresh/rooms/host/session-snapshot-cache.ts'))
  const one = { ok: true as const, reason: 'ok' as const, at: 1700000000000, rows: [{ ticketKey: 'acme/demo#701', sessionLabel: 'sess-2', currentSession: true, action: 'comment', actionAt: new Date(1700000000000).toISOString() }] }
  const table = new Map()
  const envMod = await import(url('src/host/snapshotEnvelope.ts'))
  const snapDeps = {
    envelope: envMod.createSnapshotEnvelope({
      getGhPath: () => '', getGhLastError: () => '',
      adoptSnapshot: (snap) => snap,
      logCtx: { fire: () => {}, isEnabled: () => false },
      workRouteTableReadout: async () => one,
      workRouteTableField: FIELD,
    }),
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
  }
  const reply = await snapMod.createSessionSnapshot(snapDeps).handleSnapshot({ cwd: WS })
  check(!!reply && reply.ok === true && reply[FIELD] !== undefined,
    '真快照回包上，按新表读出模块那一个常量取得出新表（reply[' + FIELD + ']）',
    '宿主把新表挂在了别的字段名上 —— 界面按常量取不到')
  check((reply as any).workRoute === undefined,
    '真快照回包上不再挂旧 workRoute 字段',
    '旧字段还在回包上 = #1271 退役没做干净')
  const replyNo = await snapMod.createSessionSnapshot(Object.assign({}, snapDeps, {
    envelope: envMod.createSnapshotEnvelope({
      getGhPath: () => '', getGhLastError: () => '',
      adoptSnapshot: (snap) => snap,
      logCtx: { fire: () => {}, isEnabled: () => false },
    }),
  })).handleSnapshot({ cwd: WS })
  check(!!replyNo && replyNo.ok === true && replyNo[FIELD] === undefined,
    '负控：没接上读数时那个字段**不在**回包上（界面会如实说读不到，不拿空列表冒充「没有人在处理票」）')

  try { fs.rmSync(store.dir, { recursive: true, force: true }) } catch (e) {}
  try { fs.rmSync(storeA.dir, { recursive: true, force: true }) } catch (e) {}
  try { fs.rmSync(storeB.dir, { recursive: true, force: true }) } catch (e) {}

  console.log(failed ? '\n存在失败 — 宿主里不止一套刷新机制（' + total + ' 项断言）' : '\n全部通过 — 宿主里只有一套刷新机制（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(2) })
