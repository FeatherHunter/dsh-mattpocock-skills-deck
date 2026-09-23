#!/usr/bin/env node
/**
 * verify-723-single-refresh-instance.js —— 门禁：宿主里只许有**一套**刷新机制（#723 T19）
 *
 * 守的是什么（这一条不是「代码长得像」，是「五条路认的是同一个实例」）：
 *   闸的活跃集合、写事件的白名单、视野模型（wf.focus）、会话↔票处理链、界面读数、行级增量，
 *   这六件必须来自**同一个**刷新机制实例。宿主要是建了两套（哪怕两套代码一模一样）：
 *     ① `wf.focus` 标活跃标在第一套上，写事件与行级增量过闸走在第二套上 →
 *        后台档的 `background-inactive` 把每一笔都判「推迟」，生产里看起来谁都在工作、实际一次都发不出去；
 *     ② 界面读数取自第二套的处理链、喂数据发生在第一套上 → 面板上「每个会话在处理哪些票」永远空着，
 *        而它读到的不是「读不到」而是「取到了、就是没有」——比不显示更坏。
 *   2026-09-23 的复核（T19b）实测到的正是这个形态：入口第 98 行一处、`wf.focus` 那行又一处。
 *
 * 它怎么判（四段，前两段静态、后两段行为）：
 *   一、静态：全仓只许有**一处**刷新机制装配点（另一处是 wiring.js 里的定义）；
 *   二、静态：wf.focus / 界面读数 / wf.chain 的闸 / 行级增量这四条路，都从**同一个句柄**取自己那一件，
 *       写事件订阅则在同一套实例里挂（wiring 的 attach）；
 *   三、行为：按生产依赖形状真的建一套 → 上报「我在看谁」→ 喂一笔真写事件 →
 *       断言五条路互相看得见（闸记了放行、读数里有那一笔、行级增量过闸会放行、deltaRefresh 在同一条实例上）；
 *   四、行为负控：照**旧形状**建两套 → 断言读数空、写事件在被读数的那一套上门前就被拒
 *       （证明第三段那几条断言不是恒绿的装饰）。
 *   另有一段钉「宿主侧字段名」：宿主写读数用的字段名必须等于读数模块导出的那个常量
 *   （今天只有「界面常量 == 读数模块常量」两边被钉，宿主那一侧没有——改名会静默让界面恒说读不到）。
 *
 * 用法：node tests/verify-723-single-refresh-instance.js（在插件根目录）
 * 退出码：0 = 通过；1 = 有违规。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const url = (rel) => pathToFileURL(path.join(ROOT, rel)).href

let failed = false
let total = 0
const check = (ok, msg, detail) => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || !detail ? '' : '\n         → ' + detail))
  if (!ok) failed = true
}
const info = (msg) => console.log('  INFO ' + msg)

/** 数一个字符串在正文里出现几次（只看代码，不看注释）。 */
function countIn(text, needle) {
  let n = 0
  let i = 0
  for (;;) {
    const at = text.indexOf(needle, i)
    if (at < 0) return n
    n += 1
    i = at + needle.length
  }
}

function listJsFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (ent.name.endsWith('.js')) out.push(path.relative(ROOT, p).split(path.sep).join('/'))
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return out
}

/** 一套「生产依赖形状」的假件：形状照 src/host/index.js:98 传进去的那一份抄（不另造一套 API）。 */
let LedgerMod = null
let GateMod = null
const CLOCK = 1700000000000
function makeDeps(store) {
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

  // ── 一、静态：全仓只许有一处装配点 ──
  console.log('\n== 一、全仓只有一处刷新机制装配点 ==')
  const indexSrc = read('src/host/index.js')
  const wiringSrc = read('src/host/refresh/wiring.js')
  const indexCalls = countIn(indexSrc, 'makeRefreshLoader(')
  check(indexCalls === 1, '宿主入口只造一套刷新机制（src/host/index.js 里 makeRefreshLoader( 出现 ' + indexCalls + ' 次，应为 1）',
    '两处就是两套实例：标活跃标在一套、过闸走在另一套')
  const callSites = listJsFiles(path.join(ROOT, 'src')).filter((rel) => countIn(read(rel), 'makeRefreshLoader(') > 0)
  const starters = callSites.filter((rel) => rel !== 'src/host/refresh/wiring.js')
  check(starters.length === 1 && starters[0] === 'src/host/index.js',
    '整个 src 里只有宿主入口一处调用装配点（实得：' + (starters.join('、') || '无') + '）',
    '别处再冒出一处 = 又多了第二套机制')

  // ── 二、静态：五条路都从同一个句柄取自己那一件 ──
  console.log('\n== 二、五条路从同一个句柄取自己那一件 ==')
  check(/harness\.handle\('wf\.focus',\s*function \(args\) \{ return _refreshWiringP\.then\(/.test(indexSrc),
    'wf.focus 走同一个句柄（_refreshWiringP.then(w => w.focus)）',
    'wf.focus 若自己再建一套，视野模型与白名单就分家了（复核实测过这个形态）')
  check(/_detectChain[\s\S]{0,600}?gate:\s*\(w && w\.gate\)/.test(indexSrc),
    'wf.chain 求值用的闸取自同一个句柄（gate: (w && w.gate)）', '链求值的账与写事件的账会记到两本账上')
  check(/ckr\s*=\s*w0 && w0\.chainReadout/.test(indexSrc) && /chainField:\s*\(w0 && w0\.chainField\)/.test(indexSrc),
    '界面读数（含字段名）取自同一个句柄（ckr = w0.chainReadout、chainField = w0.chainField）',
    '读数与实际喂数据的那一份会不是同一条链')
  check(/deltaRefresh:\s*function \(cwd, opts\) \{ return _refreshWiringP\.then/.test(indexSrc),
    '行级增量取自同一个句柄（deltaRefresh）', '增量那条路会在另一本账上、且活跃集合是空的（恒判推迟）')
  check(/function attach\(\)[\s\S]{0,200}writeEvents\.attach\(/.test(wiringSrc),
    '写事件订阅在同一套实例里挂（wiring 的 attach）', '订阅挂在另一套上，收下的写事件与被读数的那一份对不上')

  // ── 三、行为：一套实例下五条路互相看得见 ──
  console.log('\n== 三、一套实例：五条路互相看得见 ==')
  const store = { dir: fs.mkdtempSync(path.join(os.tmpdir(), 't19b-single-')), logCtx: null, decides: [] }
  store.logCtx = { isEnabled: () => true, fire: (l, e, f) => { if (e === 'refresh.decide') store.decides.push(typeof f === 'function' ? f() : f) } }
  const wiringMod = await import(url('src/host/refresh/wiring.js'))
  LedgerMod = await import(url('src/host/refresh/ledger.js'))
  GateMod = await import(url('src/host/refresh/gate.js'))
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

  // ③ 界面读数看得见②喂进去的那一笔
  const readout = w.chainReadout()
  check(!!readout && readout.ok === true && readout.sessions.some((s) => s.entries.some((e) => e.ticketKey === '723')),
    '界面读数里真的出现那一笔（票键 723）：' + JSON.stringify(readout).slice(0, 160),
    '读数与喂数据不是同一条链 —— 面板会恒显示「取到了、就是没有」')

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
  const outA = await wA.writeEvents.handle({ id: 'sess-a', header: { cwd: WS } }, 'tools/result', 'pwsh', WRITE_CMD, true)
  check(wA.writeEvents.stats().seen === 0 && outA === null, '负控：被读数的那一套门前就把这一笔拒了（seen=0）—— 生产里写事件等于没订上')
  check(wA.chainReadout().sessions.length === 0 && wA.chainReadout().reason === 'host.chain.empty',
    '负控：被读数的那一套读数恒空（' + JSON.stringify(wA.chainReadout()).slice(0, 90) + '）',
    '这条负控不成立 = 第三段那几条断言是恒绿的装饰')

  // ── 五、宿主侧字段名：必须与读数模块导出的常量同一份 ──
  console.log('\n== 五、宿主侧字段名 ==')
  const readoutMod = await import(url('src/host/refresh/sessionChainReadout.js'))
  const FIELD = readoutMod.SESSION_CHAIN_FIELD
  const snapSrc = read('src/host/sessionSnapshot.js')
  // 宿主写读数那一步的字段表达式：接受三种写法 —— 导入的常量名、接线处注入的 chainField、等值的字面量兜底
  const exprMatch = /reply\[([^\]]+)\]\s*=\s*chainReadout\(\)/.exec(snapSrc)
  const expr = exprMatch ? exprMatch[1].trim() : ''
  const bareLiteral = (/^'([^']*)'$/.exec(expr) || [])[1]
  check(expr === 'SESSION_CHAIN_FIELD' || expr.indexOf('chainField') === 0 || bareLiteral === FIELD,
    '宿主写读数用的字段名等于读数模块导出的常量（宿主写的是 ' + JSON.stringify(expr) + '，常量是 ' + JSON.stringify(FIELD) + '）',
    '两边不一致 = 界面按常量取不到，恒说「读不到」而门禁全绿')
  const fallbacks = Array.from(snapSrc.matchAll(/chainField\s*\|\|\s*'([^']*)'/g)).map((m) => m[1])
                           .concat(Array.from(indexSrc.matchAll(/chainField:\s*\(w0 && w0\.chainField\)\s*\|\|\s*'([^']*)'/g)).map((m) => m[1]))
  check(fallbacks.length > 0 && fallbacks.every((f) => f === FIELD),
    '字段名的兜底字面量都等于常量（实得 ' + JSON.stringify(fallbacks) + '）',
    '兜底写死成别的名字 = 接口没注入时静默挂到另一个字段上')
  check(w.chainField === FIELD,
    '装配点带出来的字段名等于那个常量（chainField=' + JSON.stringify(w.chainField) + '）',
    '又多了一处字段名')
  if (expr === 'SESSION_CHAIN_FIELD') {
    info('宿主是从读数模块导入那个常量用的（一处说了算）')
  } else if (expr.indexOf('chainField') === 0) {
    info('宿主用的是接线处注入的 chainField（来自 wiring 的 SESSION_CHAIN_FIELD）+ 一个字面量兜底；兜底已被上面那条钉成与常量相等')
  }

  // 行为：真 sessionSnapshot 的回包上，按那个常量取得出读数（拿一份真读数注入）
  const ticketsMod = await import(url('src/host/refresh/sessionTickets.js'))
  const snapMod = await import(url('src/host/sessionSnapshot.js'))
  const app = ticketsMod.createSessionTickets({ cacheDir: store.dir, now: () => 1700000000000 })
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
