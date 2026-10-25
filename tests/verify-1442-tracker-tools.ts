// tests/verify-1442-tracker-tools.ts —— #1442：九个 deck 工具改走 Tracker 会话（TDD 红测）。
//
// 为什么有这扇门禁：#1435 的根因是无读数时 remaining=0 命中写保底、选后端探针在认出后端前先过闸，
// 本地 Markdown 工作区被永久推迟。本票要求九个工具不再调用注册表的选择接口、不再自己调闸，
// 只通过 openTracker 会话调用能力；离网后端放行、账本记 0、回执写明不需要额度。
// 本文件经 planGates 目录约定自动进链，不用在 gate-map 登记。
//
// 票 1457 在这扇门禁上补两条端到端断言（原来只断了单次硬顶与离网账本，没断这两处）：
//   · 本小时越过提醒线时照常放行、回执带 warnings，单次硬顶仍被拒（#1527 把每小时顶降为警告）；
//   · 额度读数未知（known:false, reason:'unavailable'）时九个工具照样成功，回执四条事实写 readKnown:false、
//     不带 remaining / tier，成本说明写明「读数还没同步上来」。
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TS_HOOK = process.argv.includes('--import') ? '' : '';
void TS_HOOK;

let total = 0;
let failed = 0;
function check(ok: unknown, label: string): void {
  total += 1;
  if (!ok) { failed += 1; console.error('FAIL ' + label); }
  else { console.log('ok ' + total + ' ' + label); }
}

async function imp(p: string): Promise<any> {
  return import('../' + p.replace(/\.js$/, '.ts'));
}

const TOOL_FILES: Array<[string, string, string]> = [
  ['src/deck/tools/context.ts', 'createDeckContext', 'deck_context'],
  ['src/deck/tools/issue-get.ts', 'createDeckIssueGet', 'deck_issue_get'],
  ['src/deck/tools/map-snapshot.ts', 'createDeckMapSnapshot', 'deck_map_snapshot'],
  ['src/deck/tools/issue-list.ts', 'createDeckIssueList', 'deck_issue_list'],
  ['src/deck/tools/issue-create.ts', 'createDeckIssueCreate', 'deck_issue_create'],
  ['src/deck/tools/map-plan-create.ts', 'createDeckMapPlanCreate', 'deck_map_plan_create'],
  ['src/deck/tools/map-link.ts', 'createDeckMapLink', 'deck_map_link'],
  ['src/deck/tools/issue-patch.ts', 'createDeckIssuePatch', 'deck_issue_patch'],
  ['src/deck/tools/issue-report.ts', 'createDeckIssueReport', 'deck_issue_report'],
];

/** 一个真实本地 Markdown 工作区（与 tests/verify-1106-deck-surface.ts 同一套做法）。 */
function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-1442-'));
  const dir = path.join(root, '.scratch', 'demo');
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true });
  // 这份手写 map.md 留给「地图子票 parentKey 00 / 看地图 00」那几支；原文布局一个目录只允许一份
  // map.md，所以后面用 deck_map_plan_create 建图的几支各自点名独立 effort，不挤在 demo 里。
  fs.writeFileSync(path.join(dir, 'map.md'), '# 演示地图\n\nStatus: ready-for-agent\n\n## Destination\n\n把演示做完\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n', 'utf8');
  const plat = {
    path: path.posix,
    fs: {
      async resolve(p: string) { return String(p).replace(/\\/g, '/'); },
      async readText(t: string) { return fs.readFileSync(t, 'utf8'); },
      async writeText(t: string, c: string) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8'); },
      async lstat(t: string) { try { return fs.statSync(t); } catch { return null; } },
      async listDir(t: string) { try { return fs.readdirSync(t); } catch { return []; } },
      async stat(t: string) { try { return fs.statSync(t); } catch { return null; } },
    },
  };
  const rootPosix = root.replace(/\\/g, '/');
  return {
    root, rootPosix,
    ctx: { platform: plat, fs: plat.fs, cwd: rootPosix, get(name: string) { return name === 'fs' ? plat.fs : undefined; } },
    cleanup() { try { fs.rmSync(root, { recursive: true, force: true }); } catch { } },
  };
}

const OFF_NETWORK = { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false };
const TWO_BUCKETS = { kind: 'two-buckets', countsRequests: true, countsPoints: true, independentBuckets: true };
const WRITE_OPS = ['create', 'close', 'reopen', 'comment', 'update', 'setLabels', 'setAssignees', 'setParent', 'setBlockedBy'];

/** 测试本地的裁决口：与桥里那一份同口径（硬顶先行、未知与离网放行、已知耗尽推迟）。 */
function makeAdmit(budgetMod: any) {
  return async (input: any) => {
    const op = String((input && input.op) || '');
    const model = (input && input.budget) || {};
    const reading = input && input.reading;
    if (WRITE_OPS.indexOf(op) >= 0 && input && input.canWrite === false) {
      return { allowed: false, kind: 'rate-limit', message: '硬顶：本次调用没有写权限，写操作直接拒绝。' };
    }
    if (!reading || reading.known === false) return { allowed: true, reason: 'unknown-reading' };
    if (model.kind === 'off-network' || reading.kind === 'off-network') return { allowed: true, reason: 'off-network' };
    const buckets = (reading.buckets || {}) as Record<string, { remaining: number; limit: number }>;
    for (const name of Object.keys(buckets)) {
      if (buckets[name].remaining <= budgetMod.writeReserve(buckets[name].limit)) {
        return { allowed: false, kind: 'rate-limit', message: '额度的 ' + name + ' 桶已经见底，这次先不执行。' };
      }
    }
    return { allowed: true, reason: 'sufficient' };
  };
}

async function main() {
  console.log('#1442 九个 deck 工具改走 Tracker 会话');
  const gateMod = await imp('src/refresh/rooms/host/refresh-gate.js');
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.js');
  const registryMod = await imp('src/tracker/registry/core.js');
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.js')).markdownModule;
  const toolCost = await imp('src/refresh/kernel/tool-call-budget.js');
  const budgetMod = await imp('src/refresh/kernel/host-budget.js');
  const { chooseWorkspace, makeDecideStub } = await imp('tests/lib/deck-decide-stub.js');
  const workRouteMod = await imp('src/deck/shell/work-path-bindings.js');
  const trackerSessionMod = await imp('src/deck/tools/tracker-session.js');
  void budgetMod;

  const ws = makeWorkspace();
  const clock = 1700000000000;

  // 一个双桶桩：房间实现直接委托真实 Markdown 房间（同一份工作区、同一批票），只换 id 与预算声明。
  const ghStubModule = {
    id: 'gh-stub-1442', label: '双桶桩',
    matches: () => false,
    budget: TWO_BUCKETS,
    create: (ctx: unknown) => {
      const inner = markdownModule.create(ctx) as Record<string, (...a: any[]) => unknown>;
      const delegate = (name: string) => async (...args: any[]) => inner[name](...args);
      return {
        id: 'gh-stub-1442', create: delegate('create'), list: delegate('list'), get: delegate('get'),
        getDependencies: delegate('getDependencies'), close: delegate('close'), reopen: delegate('reopen'),
        comment: delegate('comment'), update: delegate('update'), setLabels: delegate('setLabels'),
        setAssignees: delegate('setAssignees'), setParent: delegate('setParent'), setBlockedBy: delegate('setBlockedBy'),
        preflight: delegate('preflight'), getRepoPermissions: delegate('getRepoPermissions'),
        getRepoKey: delegate('getRepoKey'),
      };
    },
  };
  // 一个离网坏后端：三个读与写入口都抛错，用来钉住抛错收口仍是 backend-threw。
  const boomModule = {
    id: 'boom-1442', label: '坏后端桩',
    matches: () => false,
    budget: OFF_NETWORK,
    create: () => {
      const boom = async () => { throw new Error('boom-1442 后端实现抛错'); };
      return { id: 'boom-1442', create: boom, list: boom, get: boom };
    },
  };

  const workPathHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-1442-workpath-'));
  const workRouteBindings = workRouteMod.createWorkRouteBindings({
    homeDir: workPathHome, now: () => clock,
    readFile: async (p: string) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } },
    writeFile: async (p: string, c: string) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c, 'utf8'); },
    mkdir: async (dir: string) => { fs.mkdirSync(dir, { recursive: true }); },
  });
  const planStore = (() => { const t = new Map(); return { durable: true, load(id: string) { return t.get(String(id)) || null; }, save(id: string, s: unknown) { t.set(String(id), s); } }; })();

  /** 建一个世界：真闸 + 真账本 + 真注册表 + 可数 select + 测试本地裁决记账三件套。 */
  async function buildWorld(backendId: string, reading: unknown, extraModules: any[] = [], ledgerKind = '') {
    const ledger = ledgerMod.createLedger({ now: () => clock });
    // #1446 起账本按「后端 + 桶」记账：先把这个后端的口径建出来，读数才有桶可落。
    // 读数未知时它身上没有 kind，但后端自己的口径仍是两桶——这时由调用方用 ledgerKind 明说，
    // 否则账本会把一个双桶后端当成离网（没有桶），记账口一写就抛。
    const readingKind = ledgerKind || (reading && (reading as any).kind) || 'off-network';
    ledger.ensureBackend(backendId, { kind: readingKind });
    // 生产里 ensureReading 在选后端前把账本煨热：这里同做法，有读数就先同步进账本。
    if (reading && (reading as any).known === true && (reading as any).buckets && (reading as any).buckets.rest) {
      const buckets = (reading as any).buckets;
      ledger.syncServer(backendId, {
        rest: { limit: buckets.rest.limit, remaining: buckets.rest.remaining, reset: clock + 3600000 },
        graphql: { limit: buckets.graphql.limit, remaining: buckets.graphql.remaining, reset: clock + 3600000 },
      }, clock);
    }
    // 闸与生产一样要能问出「这个后端按什么口径花钱」：不注入 budgetModelOf 时闸一律按「未知」算，
    // 读数就永远进不了 AI 工具那一档的保底判定（#1527 的提醒里也就说不出服务端还剩多少）。
    const gate = gateMod.createGate({ ledger, now: () => clock, budgetModelOf: () => ({ kind: readingKind }) });
    const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, ws.ctx), { matchesTimeout: 200 });
    registry.register(markdownModule);
    for (const m of extraModules) registry.register(m);
    let selectCount = 0;
    const rawSelect = registry.select.bind(registry);
    registry.select = (...args: any[]) => { selectCount += 1; return rawSelect(...args); };
    chooseWorkspace(ws.rootPosix, backendId);
    const ports = {
      admit: makeAdmit(budgetMod),
      account: async (input: any) => {
        const model = (input && input.budget) || {};
        if (model.kind === 'off-network') return;
        const claimed = (input && input.result && input.result.claimed) || { requests: 0, points: 0 };
        ledger.spend({ account: 'ai-tool', backendId: (input && input.backendId) || backendId, bucket: 'graphql', requests: claimed.requests || 0, points: claimed.points || 0 });
      },
      getCachedReading: () => reading,
    };
    const deps = {
      gate, registry, budget: budgetMod,
      estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
      backendCtx: ws.ctx, handleFor: () => ({ cwd: ws.rootPosix, refId: '.scratch/demo' }),
      decideBackend: makeDecideStub(registry),
      log: { fire: () => {} }, now: () => clock, invalidate: () => {},
      workRouteNote: (i: unknown) => workRouteBindings.note(i),
      workRouteRead: (i: unknown) => workRouteBindings.read(i),
      workRouteRelease: (i: unknown) => workRouteBindings.release(i),
      planStore, admit: ports.admit, account: ports.account, getCachedReading: ports.getCachedReading,
    };
    const tools: Record<string, any> = {};
    for (const [file, factory, name] of TOOL_FILES) tools[name] = (await imp(file))[factory](deps);
    const exec = { agent: { session: { id: 's-1442', cwd: ws.rootPosix } } };
    return {
      tools, gate, ledger, deps,
      selectCount: () => selectCount,
      claimed: () => ({ requests: gate.stats().claimed.requests, points: gate.stats().claimed.points }),
      hour: () => ledger.hourOf('ai-tool', backendId),
      run: async (name: string, args: unknown) => {
        try { return { r: await tools[name].run(exec, args), threw: '' }; }
        catch (e) { return { r: null, threw: String((e as Error && (e as Error).message) || e) }; }
      },
    };
  }

  const OFFLINE_READING = { known: true, kind: 'off-network', buckets: {} };
  const DUAL_SYNCED = { known: true, kind: 'two-buckets', buckets: { rest: { remaining: 5000, limit: 5000 }, graphql: { remaining: 5000, limit: 5000 } } };
  const DUAL_ZERO = { known: true, kind: 'two-buckets', buckets: { rest: { remaining: 0, limit: 100 }, graphql: { remaining: 0, limit: 100 } } };

  // ── 一、离网 Markdown：九个工具成功，不再经过选择接口与闸 ──
  {
    const w = await buildWorld('markdown', OFFLINE_READING);
    await w.run('deck_issue_create', { title: '1442 甲票', kind: 'issue', body: '正文' });
    await w.run('deck_issue_create', { title: '1442 乙票', kind: 'map-ticket', label: 'wayfinder:task', parentKey: '00' });
    const calls: Array<[string, unknown]> = [
      ['deck_context', {}],
      ['deck_issue_get', { key: '01' }],
      ['deck_map_snapshot', { key: '00' }],
      ['deck_issue_list', { state: 'open' }],
      ['deck_issue_create', { title: '1442 丙票', kind: 'issue' }],
      ['deck_map_plan_create', { planId: 'p1442', title: '1442 地图', effort: 'p1442', children: [{ key: 'b1', title: '子一', kind: 'issue' }] }],
      ['deck_map_link', { key: '02', parentKey: '00' }],
      ['deck_issue_patch', { key: '02', comment: '1442：改一下' }],
      ['deck_issue_report', { key: '02' }],
    ];
    for (const [name, args] of calls) {
      const { r, threw } = await w.run(name, args);
      check(!threw && !!r && r.status === 'ok', name + ' 离网成功（实得 ' + (threw || (r && r.status) + '/' + (r && r.reason)) + '）');
    }
    check(w.selectCount() === 0, '九个工具一次都没调注册表的选择接口（实得 ' + w.selectCount() + ' 次）');
    const c = w.claimed();
    check(c.requests === 0 && c.points === 0, '闸上零记账（实得 ' + c.requests + ' 条、' + c.points + ' 点）');
    const h = w.hour() as { requests: number; points: number };
    check(h.requests === 0 && h.points === 0, '账本记 0（实得 ' + JSON.stringify(h) + '）');
    const ctx = await w.run('deck_context', {});
    const actual = ctx.r && ctx.r.cost && ctx.r.cost.actual;
    // #1446：离网回执不再拿 -1 / 'off-network' 冒充水位，改成四格事实 + 一句人话；remaining/tier 根本不出现。
    check(!!actual && actual.backendId === 'markdown' && actual.budgetKind === 'off-network' && actual.readKnown === true && actual.offNetwork === true,
      '离网回执带四格事实（实得 ' + JSON.stringify(actual) + '）');
    check(!!actual && actual.remaining === undefined && actual.tier === undefined,
      '离网回执不带 remaining / tier（实得 ' + JSON.stringify(actual) + '）');
    check(!!ctx.r && !!ctx.r.cost && String(ctx.r.cost.note || '').indexOf('不需要额度') >= 0,
      '离网回执用 cost.note 写明本后端不需要额度（实得 ' + JSON.stringify(ctx.r && ctx.r.cost) + '）');
  }

  // ── 二、双桶桩（有额度同步）：成功行为与当前一致，回执带真实读数 ──
  {
    const w = await buildWorld('gh-stub-1442', DUAL_SYNCED, [ghStubModule]);
    const { r, threw } = await w.run('deck_issue_list', { state: 'open' });
    check(!threw && !!r && r.status === 'ok', '双桶桩读成功（实得 ' + (threw || (r && r.status) + '/' + (r && r.reason)) + '）');
    check(w.selectCount() === 0, '双桶桩也没调选择接口（实得 ' + w.selectCount() + ' 次）');
    const actual = r && r.cost && r.cost.actual;
    check(!!actual && actual.readKnown === true && actual.offNetwork === false && actual.budgetKind === 'two-buckets'
      && typeof actual.remaining === 'number' && actual.remaining >= 0 && typeof actual.tier === 'string',
      '双桶桩回执带四格事实与真实水位（实得 ' + JSON.stringify(actual) + '）');
    check(!!r && !!r.cost && !r.cost.note, '双桶桩回执没有未知/离网说明（实得 ' + JSON.stringify(r && r.cost) + '）');
  }

  // ── 三、双桶桩额度见底：拒绝且不花额度 ──
  {
    const w = await buildWorld('gh-stub-1442', DUAL_ZERO, [ghStubModule]);
    const before = w.hour() as { requests: number; points: number };
    const { r, threw } = await w.run('deck_issue_list', { state: 'open' });
    check(!threw && !!r && r.status !== 'ok', '双桶桩见底时拒绝（实得 ' + (threw || (r && r.status) + '/' + (r && r.reason)) + '）');
    const after = w.hour() as { requests: number; points: number };
    check(after.requests === before.requests && after.points === before.points, '拒绝不花额度（前后 ' + JSON.stringify({ before, after }) + '）');
  }

  // ── 四、超顶与抛错收口与当前一致 ──
  {
    const w = await buildWorld('markdown', OFFLINE_READING);
    const kids = [];
    for (let i = 0; i < 400; i++) kids.push({ key: 'k' + i, title: '超顶' + i, kind: 'issue' });
    const over = await w.run('deck_map_plan_create', { planId: 'p1442-over', title: '超顶地图', effort: 'p1442-over', children: kids });
    check(!over.threw && !!over.r && over.r.status === 'unsupported' && over.r.reason === 'ai-tool-refused' && String(over.r.text || '').indexOf('硬顶') >= 0,
      '超单次硬顶仍是 ai-tool-refused 且带硬顶二字（实得 ' + (over.threw || JSON.stringify({ status: over.r && over.r.status, reason: over.r && over.r.reason })) + '）');
    const wb = await buildWorld('boom-1442', OFFLINE_READING, [boomModule]);
    const b = await wb.run('deck_issue_create', { title: '炸', kind: 'issue' });
    check(!b.threw && !!b.r && b.r.ok === false && b.r.reason === 'backend-threw' && String(b.r.text || '').indexOf('后端实现抛错') >= 0,
      '坏后端抛错仍收成 backend-threw（实得 ' + (b.threw || JSON.stringify({ ok: b.r && b.r.ok, reason: b.r && b.r.reason })) + '）');
    const nb = await buildWorld('markdown', OFFLINE_READING);
    const { r, threw } = await nb.run('deck_context', {});
    check(!threw && !!r && r.status === 'ok', '判定出口缺席的反例由 tests/verify-deck-tools.ts 覆盖，这里只确认正常路（实得 ' + (threw || (r && r.status)) + '）');
  }

  // ── 五、越过每小时提醒线：照常放行，回执里带一句提醒（#1457 原断拒绝，#1527 起降为警告） ──
  {
    const w = await buildWorld('gh-stub-1442', DUAL_SYNCED, [ghStubModule]);
    // 造「本小时已经用满 2000 点」的账本。只填点数、请求数留 0，让后面「0 点 / 1 条」的探针照常通过；
    // 真正要断的是：越过提醒线时闸仍放行，并把「用了多少、线在哪」放进 warnings。
    w.ledger.spend({ account: 'ai-tool', backendId: 'gh-stub-1442', bucket: 'graphql', requests: 0, points: 2000 });
    const hourCap = w.gate.admitAiTool({ points: 1, requests: 0 }, { backendId: 'gh-stub-1442', bucket: 'graphql' });
    check(!!hourCap && hourCap.admitted === true && hourCap.reason === 'ai-tool-over-hour-soft'
      && Array.isArray(hourCap.warnings) && hourCap.warnings.length === 1
      && String(hourCap.warnings[0]).indexOf('2000 点') >= 0 && String(hourCap.warnings[0]).indexOf('1500 条') >= 0
      // #1527：提醒要带服务端这一桶还剩多少（这里的读数来自 DUAL_SYNCED 那份桩）。
      && String(hourCap.warnings[0]).indexOf('服务端这一桶还剩') >= 0,
      '越过每小时提醒线时照常放行，warnings 说清提醒线在哪、服务端还剩多少（实得 ' + JSON.stringify(hourCap && { admitted: hourCap.admitted, reason: hourCap.reason, warnings: hourCap.warnings }) + '）');
    const callCap = w.gate.admitAiTool({ points: 601, requests: 0 }, { backendId: 'gh-stub-1442', bucket: 'graphql' });
    check(!!callCap && callCap.admitted === false && callCap.reason === 'ai-tool-over-call-cap'
      // #1527 决定三：单次硬顶拒绝必须报出服务端还剩多少，否则 AI 会以为「没额度了」而不是「这一笔太大」。
      && String(callCap.text).indexOf('服务端这一桶还剩') >= 0,
      '单次超量仍被拒，报的是单次档、文案说明服务端还剩多少（实得 ' + JSON.stringify(callCap && { admitted: callCap.admitted, reason: callCap.reason, text: callCap.text }) + '）');
    // 会话级：本小时已越线，但会话照开，提醒挂在 admit.warnings 上（回执把这一段带出去）。
    const opened = await trackerSessionMod.openDeckSession({
      deps: w.deps, exec: {},
      session: { cwd: ws.rootPosix, workspaceKey: '' },
      estimate: { points: 4, requests: 3, tickets: 0, withinCallCap: true, shards: 1, perShard: 1, text: '' },
      tool: 'deck_issue_list', kind: 'read',
    });
    check(opened.ok === true && Array.isArray(opened.admit && opened.admit.warnings) && opened.admit.warnings.length === 1,
      '会话级：越过提醒线照常放行，admit.warnings 带着提醒（实得 ' + JSON.stringify({ ok: opened.ok, warnings: opened.admit && opened.admit.warnings }) + '）');
    // 九工具级：同一笔下九个工具都放行；至少读那只的回执里能看见 cost.warnings。
    const calls: Array<[string, unknown]> = [
      ['deck_context', {}],
      ['deck_issue_get', { key: '01' }],
      ['deck_map_snapshot', { key: '00' }],
      ['deck_issue_list', { state: 'open' }],
      ['deck_issue_create', { title: '1457 丙票', kind: 'issue' }],
      ['deck_map_plan_create', { planId: 'p1457', title: '1457 地图', effort: 'p1457', children: [{ key: 'b1', title: '子一', kind: 'issue' }] }],
      ['deck_map_link', { key: '02', parentKey: '00' }],
      ['deck_issue_patch', { key: '02', comment: '1457：改一下' }],
      ['deck_issue_report', { key: '02' }],
    ];
    for (const [name, args] of calls) {
      const { r, threw } = await w.run(name, args);
      check(!threw && !!r && r.status === 'ok',
        name + ' 越过提醒线后照常成功（实得 ' + (threw ? threw : JSON.stringify({ status: r && r.status, reason: r && r.reason })) + '）');
      if (name === 'deck_issue_list') {
        check(!!r && !!r.cost && Array.isArray(r.cost.warnings) && r.cost.warnings.length === 1 && String(r.cost.warnings[0]).indexOf('提醒线') >= 0,
          '读票回执的 cost.warnings 带着那句提醒（实得 ' + JSON.stringify(r && r.cost && r.cost.warnings) + '）');
        // #1527 票面第 5 条点名 cost.note：人先读 note，提醒也要写进那一格。
        check(!!r && !!r.cost && typeof r.cost.note === 'string' && r.cost.note.indexOf('提醒线') >= 0,
          '读票回执的 cost.note 也写着那句提醒（实得 ' + JSON.stringify(r && r.cost && r.cost.note) + '）');
      }
    }
  }

  // ── 六、额度读数未知：九个工具照样成功，回执如实写「还没同步上来」（#1457） ──
  {
    // 后端口径是双桶（账本也按双桶建桶），读数这一格还没同步上来：known:false / unavailable。
    const w = await buildWorld('gh-stub-1442', { known: false, reason: 'unavailable' }, [ghStubModule], 'two-buckets');
    await w.run('deck_issue_create', { title: '1457 未知甲票', kind: 'issue', body: '正文' });
    await w.run('deck_issue_create', { title: '1457 未知乙票', kind: 'map-ticket', label: 'wayfinder:task', parentKey: '00' });
    const calls: Array<[string, unknown]> = [
      ['deck_context', {}],
      ['deck_issue_get', { key: '01' }],
      ['deck_map_snapshot', { key: '00' }],
      ['deck_issue_list', { state: 'open' }],
      ['deck_issue_create', { title: '1457 未知丙票', kind: 'issue' }],
      ['deck_map_plan_create', { planId: 'p1457-unknown', title: '1457 未知地图', effort: 'p1457-unknown', children: [{ key: 'b1', title: '子一', kind: 'issue' }] }],
      ['deck_map_link', { key: '02', parentKey: '00' }],
      ['deck_issue_patch', { key: '02', comment: '1457：未知读数下改一下' }],
      ['deck_issue_report', { key: '02' }],
    ];
    for (const [name, args] of calls) {
      const { r, threw } = await w.run(name, args);
      const actual = r && r.cost && r.cost.actual;
      check(!threw && !!r && r.status === 'ok',
        name + ' 读数未知时照样成功（实得 ' + (threw ? threw : JSON.stringify({ status: r && r.status, reason: r && r.reason })) + '）');
      check(!!actual && actual.readKnown === false && actual.offNetwork === false && actual.budgetKind === 'two-buckets',
        name + ' 回执四条事实写明读数未知（实得 ' + JSON.stringify(actual) + '）');
      check(!!actual && actual.remaining === undefined && actual.tier === undefined,
        name + ' 读数未知时不带 remaining / tier（实得 ' + JSON.stringify(actual) + '）');
      check(!!r && !!r.cost && String(r.cost.note || '').indexOf('读数还没同步上来') >= 0,
        name + ' 成本说明写明读数还没同步上来（实得 ' + JSON.stringify(r && r.cost && r.cost.note) + '）');
    }
  }

  ws.cleanup();
  console.log('GATE-RESULT total=' + total + ' failed=' + failed);
  if (failed > 0) { console.error('FAIL #1442 红测：' + failed + ' 条没过'); process.exit(1); }
}
main().catch((e) => { console.error('FAIL #1442 抛错：' + ((e as Error && (e as Error).stack) || String(e))); process.exit(1); });
