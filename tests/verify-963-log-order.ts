#!/usr/bin/env node
// check-963-log-order: 963 新方案本地日志顺序验证（四幕，只看外部行为与事件顺序）。
const nodePath = require('path');
const nodeOs = require('os');
const { pathToFileURL } = require('url');
// 时间压缩：本门的墙钟时间几乎全花在「等超时」上 —— S3/S4 里每一条 runGh 都按档位排下一个预算
//（读 12 秒、写 60 秒、探活 15 秒），命令几十毫秒就回来了，那些预算没人清掉，于是进程要空等一整档才肯退出。
// 压缩成虚拟时间以后真实只等几毫秒，而 Date.now() 报出来的仍是那三个档位值：S4「读档等 12 秒、写档等 60 秒、
// 探活档等 15 秒」这几条按记录下来的预算值判，S4「比探活预算慢、超时归网络档」这一条
// 靠的是虚拟队列按到期时间排队（探活那一档先到），S3「60 毫秒就回、没有一条等满超时」也照旧成立。断言一条没动；
// 理由、两条不能破的语义与边界见 tests/lib/time-compress.js 文件头。
//
// 三个档位的毫秒数只有中央一个来源（src/shared/time-config/values.js）：这里不手抄数字，
// 免得配置一调（例如 #1245 把写档从 30 秒放宽到 60 秒）门禁就假红。
const centralTime = require('../src/shared/time-config/values.js');
const READ_BUDGET_MS = centralTime.OUTBOUND_READ_TIMEOUT_MS;
const WRITE_BUDGET_MS = centralTime.OUTBOUND_WRITE_TIMEOUT_MS;
const PROBE_BUDGET_MS = centralTime.OUTBOUND_PROBE_TIMEOUT_MS;
const { installTimeCompression, uninstallTimeCompression } = require('./lib/time-compress.js');
installTimeCompression();
const WT = nodePath.resolve(__dirname, '..');
// 事件行的一条记录：t 是相对起点（t0）的毫秒数，fields 记事件负载。
interface LogRow { t: number; level: string; event: string; fields: any }
const url = (rel: string): string => pathToFileURL(nodePath.join(WT, rel)).href;
let total = 0; const broken: string[] = [];
function must(c: boolean, inv: string, det?: string): void { total++; if (c) { console.log('  PASS ' + inv); } else { console.log('  FAIL ' + inv + (det ? ' → ' + det : '')); broken.push(inv); } }
function title(t: string): void { console.log('\n== ' + t + ' =='); }
// 假日志上下文：收下每一行事件，并提供按名字查首次出现位置、按名字数行数这两件查询。
// idx() 是这扇门禁的核心手段——它按行序返回位置，S1 就靠比大小来守「先 miss 开跑、后搭车记命中」。
function makeSpy(): { rows: LogRow[]; ctx: { fire: (level: string, event: string, fields: any) => void; isEnabled: () => boolean }; dump: (evts?: string[]) => void; idx: (event: string, pred?: (f: any) => boolean) => number; count: (event: string, pred?: (f: any) => boolean) => number } {
  const t0 = Date.now(); const rows: LogRow[] = [];
  const ctx = { fire: (level: string, event: string, fields: any) => { try { rows.push({ t: Date.now() - t0, level, event, fields: (typeof fields === 'function') ? fields() : fields }); } catch (e) {} }, isEnabled: () => true };
  return { rows, ctx,
    dump: function (evts?: string[]) { for (const r of rows) { if (evts && evts.indexOf(r.event) < 0) continue; console.log('  [+' + r.t + 'ms] ' + r.level + ' ' + r.event + ' ' + JSON.stringify(r.fields || {})); } },
    idx: function (event: string, pred?: (f: any) => boolean) { for (let i = 0; i < rows.length; i++) { if (rows[i].event === event && (!pred || pred(rows[i].fields))) return i; } return -1; },
    count: function (event: string, pred?: (f: any) => boolean) { return rows.filter((r) => r.event === event && (!pred || pred(r.fields))).length; } };
}
const PLATFORM = { os: 'win32', path: nodePath, getHome: async () => nodePath.join('D:', 'fakehome') };
async function makeChain(spy: ReturnType<typeof makeSpy>, o?: any) {
  o = o || {}; let evals = 0;
  const dcMod = await import(url('src/refresh/rooms/host/check-chain-evaluation.ts'));
  const dh = dcMod.createDetectChain({
    canonicalKey: async (c) => String(c || ''), DEFAULT_CWD: 'D:/repo', resetGhCache: () => {},
    getDetectionService: async () => ({ detect: async () => { await new Promise((r) => setTimeout(r, o.detectMs || 80)); return { selection: { backendId: 'github', source: 'auto' } }; } }),
    getPlatform: async () => { evals++; return PLATFORM; },
    getTrackerRegistry: async () => ({ modules: () => [] }),
    getRepoKey: async () => ({ owner: 'acme', name: 'demo' }),
    runGh: async () => ({ ok: false, kind: 'network', error: 'net' }),
    timer: { timeout: (ms) => new Promise((r) => setTimeout(r, ms)), setTimeout: (fn, ms) => setTimeout(fn, ms) },
    probeSkill: async () => ({ ok: false, level: 'bad', detail: 'x', hint: '' }),
    mdPredicate: async () => ({ status: 'pending', detail: 'x' }),
    getChainCache: () => null, setChainCache: () => {},
    getChainBackoff: async () => ({ verdict: async () => ({ needed: true, reason: 'test-always-due', waitMs: 0, cached: null }), note: async () => ({}) }),
    logCtx: spy.ctx });
  return { dh, stats: () => ({ evals }) };
}
async function makeRunGh(spy: ReturnType<typeof makeSpy>, o?: any) {
  o = o || {}; const timeouts = []; const spawns = []; let live = 0, peak = 0;
  const delayFor = o.delayFor || ((argv) => 60);
  let ghPath = null, ghErr = null;
  const subprocess = { spawn: ({ argv, cwd }) => {
    const rec = { argv: argv.slice() }; spawns.push(rec); live++; if (live > peak) peak = live;
    let settled = false, killed = false;
    let finish;
    const done = new Promise((resolve) => { finish = (code, signal) => { if (settled) return; settled = true; live--; resolve({ exitCode: code, signal }); }; });
    const t = setTimeout(() => finish(0, undefined), delayFor(argv));
    return { done,
      terminate: () => { killed = true; clearTimeout(t); finish(-1, 'timeout'); },
      collected: { stdout: { readFrom: () => ({ text: killed ? '' : '{"ok":true}' }) }, stderr: { readFrom: () => ({ text: '' }) } },
    };
  } };
  const timer = { timeout: (ms) => { timeouts.push(ms); return new Promise((r) => setTimeout(r, ms)); }, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) };
  const rkMod = await import(url('src/refresh/rooms/host/git-execution.ts'));
  const rk = rkMod.createRepoKeys({ subprocess, timer, fs: null, DEFAULT_CWD: 'D:/repo', TIMEOUT_MS: 30000,
    repoKeys: {}, repoRoots: {}, getGhPath: () => ghPath, setGhPath: (v) => { ghPath = v; }, getGhLastError: () => ghErr, setGhLastError: (v) => { ghErr = v; },
    getPlatform: async () => ({ resolveExecutable: async () => 'C:/fake/gh.exe' }),
    getWorkspaceStore: async () => ({ get: () => null, set: () => {} }),
    setCache: () => {}, clearWorkspaceStore: () => {}, namingSweepSoon: () => {}, canonicalKey: async (c) => c,
    getChainBackoff: undefined, parseGithubRepo: undefined, logCtx: spy.ctx, gate: undefined, getGate: undefined });
  return { runGh: rk.runGh, spawns, timeouts, peak: () => peak };
}
async function makeSkillWorld(spy: ReturnType<typeof makeSpy>) {
  const home = nodeOs.tmpdir();
  const platform = { os: 'win32', path: nodePath, getHome: async () => home };
  let calls = 0;
  const skillsMock = { get: async (name, o) => { calls++; return { name, path: nodePath.join(home, '.agents', 'skills', String(name)) }; } };
  const ctx = { get: (k) => (k === 'skills' ? skillsMock : undefined), set: () => {}, effect: (fn) => { try { const d = fn(); return typeof d === 'function' ? d : () => {}; } catch (e) { return () => {}; } } };
  const probeMod = await import(url('src/host/skillProbe.js'));
  const probe = probeMod.createSkillProbe({ ctx, getPlatform: async () => platform,
    getWorkspaceStore: async () => ({ clear() {}, invalidate() {}, get: () => null, set() {} }),
    resetChainCache: () => {}, logCtx: spy.ctx });
  return { probe, calls: () => calls };
}
async function makeScopedDetect(spy: ReturnType<typeof makeSpy>) {
  const askedNames = []; const CHAIN3 = ['wayfinder', 'setup-matt-pocock-skills', 'ask-matt'];
  const fakeProbeSkill = async (name) => { askedNames.push(String(name)); return { ok: true, level: 'ok', detail: 'yes', hint: '' }; };
  const bootMod = await import(url('src/host/bootstrap.js'));
  const boot = bootMod.createBootstrap({ ctx: { get: () => undefined, effect: (fn) => { try { const d = fn(); return typeof d === 'function' ? d : () => {} } catch (e) { return () => {} } }, set: () => {} } });
  const platMod = await import(url('src/host/platformChannel.js'));
  const plat = platMod.createPlatformChannel({ ctx: { get: () => undefined, set: () => {}, effect: (fn) => { try { const d = fn(); return typeof d === 'function' ? d : () => {} } catch (e) { return () => {} } } },
    subprocess: {}, timer: { timeout: (a, b) => ((typeof a === 'function') ? new Promise((r) => setTimeout(() => r(a()), b)) : new Promise((r) => setTimeout(r, a))) },
    fs: null, DEFAULT_CWD: nodeOs.tmpdir(), TIMEOUT_MS: 30000,
    getMattSkillProbeNames: (...a) => boot.getMattSkillProbeNames(...a),
    getChainSkillNames: (...a) => boot.getChainSkillNames(...a),
    probeSkill: fakeProbeSkill, logCtx: spy.ctx, getGate: () => null });
  const svc = await plat.getDetectionService();
  return { svc, askedNames, CHAIN_THREE: CHAIN3 };
}
async function main() {
  const allEvents = new Set<string>();
  title('S1 同钥匙搭车：旧的没回新的不起，只等旧的');
  { const spy = makeSpy(); const c = await makeChain(spy, { detectMs: 120 });
    const a = { cwd: 'D:/repo', backendId: 'github', lang: 'zh' };
    const [r1, r2] = await Promise.all([c.dh.handleChain(a), c.dh.handleChain(a)]);
    spy.dump(['chain.cache.miss', 'dedup.hit']);
    must(c.stats().evals === 1, '连点两次只起一轮求值', 'evals=' + c.stats().evals);
    must(r1 === r2, '两路拿同一份回包');
    must(spy.count('dedup.hit', (f) => f && f.scope === 'chain') === 1, '后来者记一行链复用');
    must(spy.idx('dedup.hit') > spy.idx('chain.cache.miss'), '顺序：先 miss 开跑，后搭车记命中');
    must(spy.count('chain.preflight.reuse') === 1, '只跑一轮，只记一次预检复用行');
    for (const r of spy.rows) allEvents.add(r.event); }
  title('S2 写后不搭：写过东西之后来的自己跑一轮');
  { const spy = makeSpy(); const c = await makeChain(spy, { detectMs: 150 });
    const a = { cwd: 'D:/repo', backendId: 'github', lang: 'zh' };
    const p1 = c.dh.handleChain(a);
    await new Promise((r) => setTimeout(r, 20));
    c.dh.markChainWrite();
    const r1 = await p1;
    const r2 = await c.dh.handleChain(a);
    spy.dump(['dedup.hit']);
    must(c.stats().evals === 2, '写后新来另起一轮', 'evals=' + c.stats().evals);
    must(r1 !== r2, '写前后回包不是同一份');
    must(spy.count('dedup.hit') === 0, '写后搭车零命中（没蹭旧车）');
    for (const r of spy.rows) allEvents.add(r.event); }
  title('S3 准入：满了排队等，等不是失败，峰值不超读桶');
  { const spy = makeSpy(); const g = await makeRunGh(spy, {});
    const laneMod0 = await import(url('src/refresh/rooms/host/outbound-admission.ts'));
    const readMax = laneMod0.getGhLane().limits().readMax;
    const n = readMax + 6;
    const jobs = []; for (let i = 0; i < n; i++) jobs.push(g.runGh(['issue', 'list', '--limit', '5'], 'D:/repo'));
    const rs = await Promise.all(jobs);
    const laneMod = await import(url('src/refresh/rooms/host/outbound-admission.ts'));
    const snap = laneMod.getGhLane().snapshot();
    console.log('  [lane] readPeak=' + snap.readPeak + ' readWaited=' + snap.readWaited + ' max=' + snap.readMax);
    spy.dump(['gh.exec', 'gh.timeout']);
    must(rs.every((r) => r && r.ok === true), n + ' 路读全成功（满了等，没失败）');
    must(g.peak() <= readMax, '同时在飞不超过读桶 ' + readMax, 'peak=' + g.peak());
    must(snap.readPeak <= readMax && snap.readWaited > 0, '道上峰值不超且有人排过队');
    must(spy.count('gh.exec') === n, '每条起过的记一行 gh.exec');
    must(spy.count('gh.timeout') === 0, '60 毫秒就回，没有一条等满超时');
    for (const r of spy.rows) allEvents.add(r.event); }
  title('S4 分档：读/探活/写各等各的，超时归网络档');
  { const spy = makeSpy();
    const g = await makeRunGh(spy, { delayFor: (argv) => (argv[1] === 'auth' ? PROBE_BUDGET_MS + 500 : 60) });
    await g.runGh(['issue', 'list', '--limit', '5'], 'D:/repo');
    await g.runGh(['issue', 'create', '--title', 't', '--body', 'b'], 'D:/repo');
    must(g.timeouts.includes(READ_BUDGET_MS), '读档等 ' + READ_BUDGET_MS / 1000 + ' 秒', JSON.stringify(g.timeouts));
    must(g.timeouts.includes(WRITE_BUDGET_MS), '写档等 ' + WRITE_BUDGET_MS / 1000 + ' 秒（#1245 从 30 秒放宽到 60 秒，值取自中央常量）', JSON.stringify(g.timeouts));
    const slow = await g.runGh(['auth', 'status'], 'D:/repo');
    spy.dump(['gh.timeout', 'gh.exec']);
    must(g.timeouts.includes(PROBE_BUDGET_MS), '探活档等 ' + PROBE_BUDGET_MS / 1000 + ' 秒（#1160 从 3 秒提到 15 秒）', JSON.stringify(g.timeouts));
    must(slow.ok === false && slow.kind === 'network', '探活超时归网络档（未知稍后，不说没登录）', JSON.stringify(slow));
    must(spy.count('gh.timeout', (f) => f && f.timeoutMs === PROBE_BUDGET_MS) === 1, '超时行记的分档值 ' + PROBE_BUDGET_MS);
    for (const r of spy.rows) allEvents.add(r.event); }
  title('S5 技能：平时三项，重查全量，记住的走缓存');
  { const spy = makeSpy(); const w = await makeScopedDetect(spy);
    await w.svc.detect({ cwd: 'CWD-S5-PLAIN' }, {});
    must(w.askedNames.length === 3, '平时探测只问三项', w.askedNames.join(','));
    must(JSON.stringify([...w.askedNames].sort()) === JSON.stringify([...w.CHAIN_THREE].sort()), '问的正是链条要的三项');
    w.askedNames.length = 0;
    await w.svc.detect({ cwd: 'CWD-S5-FORCE' }, { force: true });
    must(w.askedNames.length > 20, '重查问全量二十多项', 'N=' + w.askedNames.length);
    const w2 = await makeSkillWorld(makeSpy());
    const n0 = w2.calls();
    await w2.probe.probeSkill('tdd', 'zh', 'CWD-S5');
    await w2.probe.probeSkill('tdd', 'zh', 'CWD-S5');
    must(w2.calls() === n0 + 1, '记住的不再真问（两次只问一次）', 'calls=' + w2.calls());
    for (const r of spy.rows) allEvents.add(r.event); }
  title('事件白名单：全程无新增事件名');
  { // 后四个是既有事件（core.ts/workspaceKey/workspaceRoot/choiceStore 里的原有埋点，本图没碰这些文件），不是本图新增。
    // `detection.step` 是 #1048（2026-10-14）新增的按需步骤线：统一判定出口在有日志出口时逐层记一步
    //   （哪一层看过、结论、认下谁、耗时、为什么），平时不发，调试开关打开才发；这里记的是它的埋点，不是本图新增。
    // `read.degraded` 是全仓已登记的降级结论线（#1052 起）。它会出现在这一趟里，是因为 S5 那一段的探测
    //   故意没有文件服务（`fs: null`），而 GitLab 房的识别路径自 #1130（2026-10-14）起不再把读不到吞掉，
    //   于是照它的口径记了一行 `matches:fs-unavailable`。这是那一段场景的预期产物，不是本图新增的事件名。
  // 'gh.lane.saturated' 是 2026-10-21 map 1010 逐票复核（#960）新增的按需事件：出站准入排队放行时记一行
  //   （谁在哪个桶、排了多久、当时多少在飞），用来判「闸满导致的等待」而不是旧机制；它只挂在 admission 排队分支，
  //   属于本次新增的观测点，不是新故障路径。
  // 'gh.transport' 是 2026-10-26 #1007 新增的常驻事件：通路失败设冷却、冷却期内拒绝、成功清零各记一行。
  //   这一趟里 S4 的探活超时走的是宿主钳制那一路；宿主 runGh 到点后会把结局回报给准入桶（gh-run-report.ts），
  //   按「到点算 transport 级失败」设冷却，所以这里出现 decision=cooldown-set、reason=timeout 是预期产物，
  //   S4 之后紧接着的那一笔正靠这条冷却立刻回「通路不通」。这里登记的是本图允许出现的事件集合，不是放宽断言。
  // 'chain.predicate.timeout' 是 2026-10-26 #1475 新增的常驻事件：检测链一次求值里，外层等待预算先到点、
  //   被放弃的内层谓词后来还是回了话时各记一行；事件号原定 #132，合入时让给先合入 main 的 #1007 gh.transport。
  //   这里同样只是登记本图允许出现的事件集合，不是放宽断言。
  const known = ['detection.detect', 'detection.step', 'host.call.fail', 'chain.cache.hit', 'chain.cache.miss', 'dedup.hit', 'chain.preflight.reuse', 'chain.predicate', 'gh.exec', 'gh.timeout', 'gh.transport', 'gh.lane.saturated', 'error.normalize', 'read.degraded', 'skill.probe', 'skill.pending.cap', 'workspaceStore.miss', 'workspaceStore.hit', 'platform.resolve', 'registry.select', 'workspaceKey.canonical', 'workspaceRoot.resolve', 'choiceStore.read', 'chain.predicate.timeout'];
    const unknown = [...allEvents].filter((e) => !known.includes(e));
    console.log('  事件集合：' + [...allEvents].sort().join(', '));
    must(unknown.length === 0, '无新增事件名', unknown.join(',')); }
  console.log('\n共 ' + total + ' 项，' + (broken.length ? ('破 ' + broken.length + ' 项：' + broken.join('；')) : '全部通过'));
  // 收工先把全局时钟还原：本仓打算把多扇门禁放进同一个进程跑，别把虚拟时钟留给后面那几扇。
  uninstallTimeCompression();
  process.exitCode = broken.length ? 1 : 0;
}
main().catch((e) => { console.error('SCRIPT-ERROR', (e && e.stack) || e); uninstallTimeCompression(); process.exitCode = 2; });
