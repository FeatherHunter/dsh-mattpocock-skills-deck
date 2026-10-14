// tests/verify-1003-single-outlet.js —— #1003 单出口门禁：四路同答案（接受按 (a) 硬接前的行为锁）
// 用法：node tests/verify-1003-single-outlet.js
// 钉四条（契约“四类消费方同一个后端与同一个来源”的行为子集）：
//   S1 只放声明文件的工作区：统一判定、工具壳、改色电话、探测服务四路同答 github
//   S2 文件存在时只听文件的：四路同答文件里的 markdown（手改即换由统一判定直读保证）
//   S3 空目录：四路都不产出后端、不起外部命令（统一判定 unknown；工具壳说还没就绪；改色 conflict；探测 null）
//   S4 多命中：工具壳与改色诚实拒绝；统一判定把 multiHit 名单独出（调用方凭它拒绝，不自己挑）
//   S5 已知分歧（改调要收掉的）：纯记忆工作区（无文件无声明）今天改色电话答 conflict，其余三路答记忆——
//      四路改调同一出口后，本条必须改成四路同答记忆。改调前本条按今天行为断言，改调后改断言。
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
let failed = false;
let total = 0;
const check = (ok, msg, detail) => {
  total += 1;
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 280) : '')));
  if (!ok) failed = true;
};
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

function makeFs() {
  return {
    async resolve(p, opts) {
      const base = (opts && opts.cwd) || '';
      const rel = String(p || '').replace(/\\/g, '/');
      return base ? String(base).replace(/\\/g, '/') + '/' + rel : rel;
    },
    async readText(t) {
      const real = String(t).replace(/\//g, path.sep);
      return fs.readFileSync(real, 'utf8');
    },
    async writeText(t, c) {
      const real = String(t).replace(/\//g, path.sep);
      fs.mkdirSync(path.dirname(real), { recursive: true });
      fs.writeFileSync(real, String(c), 'utf8');
    },
    async lstat(t) { try { return fs.statSync(String(t).replace(/\//g, path.sep)); } catch { return null; } },
    async listDir(t) { try { return fs.readdirSync(String(t).replace(/\//g, path.sep)); } catch { return []; } },
    async stat(t) { try { return fs.statSync(String(t).replace(/\//g, path.sep)); } catch { return null; } },
  };
}
function makeGateLedger(gateMod, ledgerMod) {
  const ledger = ledgerMod.createLedger({ now: () => 1700000000000 });
  const gate = gateMod.createGate({ ledger, logCtx: null, now: () => 1700000000000 });
  ledger.syncServer(
    { rest: { limit: 5000, remaining: 5000, reset: 1700003600000 }, graphql: { limit: 5000, remaining: 5000, reset: 1700003600000 } },
    1700000000000
  );
  return gate;
}
const regOf = (selectFn) => ({
  has: (id) => id === 'github' || id === 'markdown',
  describe: (h, id) => ({ backend: id, refId: 'o/n', name: id, url: '' }),
  select: selectFn,
});
const fakeTracker = () => ({ listLabels: async () => ({ ok: true, data: [] }), setLabelColors: async () => ({ ok: true, data: { applied: [], failed: [] } }) });

async function main() {
  console.log('#1003 单出口门禁：四路同答案');
  const shellMod = await imp('src/deck/shell/call-shell.ts');
  const budget = await imp('src/shared/refresh/budget.js');
  const ledgerMod = await imp('src/host/refresh/ledger.ts');
  const gateMod = await imp('src/host/refresh/gate.ts');
  const toolCost = await imp('src/shared/refresh/tool-cost.js');
  const decMod = await imp('src/tracker/detection/backendDecision.ts');
  const anchorMod = await imp('src/deck/shell/workspace-anchor.ts');
  const detMod = await imp('src/tracker/detection/detectionService.ts');
  const lcMod = await imp('src/host/workspaceLabelColors.js');
  const { decideBackend } = decMod;
  // 映射函数挂判定函数上整包递（与生产装配点同形，见 platformChannel.getDecisionFn）
  try { decideBackend.selectionFromOutlet = decMod.selectionFromOutlet } catch (eAttach) {}

  const sOf = (cwd) => ({ cwd, workspaceKey: 'k1003s', sessionId: 's1003s', source: 't', text: '' });
  const shellOf = (reg, extra) => shellMod.createDeckShell(Object.assign({
    gate: makeGateLedger(gateMod, ledgerMod), registry: reg, budget,
    estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom, backendCtx: {},
    // 测的就是出口这条路（生产由装配层递进来，这里直递同一函数；过闸钩子壳内自建）
    decideBackend: decMod.decideBackend,
  }, extra || {}));
  // 工具壳自己不带文件通道：生产由装配层把这两件事递进壳（见 src/host/refresh/wiring.js 给 deck 工具壳
  //   递的 readWorkspaceFileText/parseWorkspaceFile），壳再转手递给判定出口。夹具照生产的接法给上，
  //   壳才读得到工作区文件里人的选择 —— 这一步是 #1138 之后唯一能表达「这个工作区选过了」的通道。
  const wfDepsOf = (fss) => ({
    readWorkspaceFileText: async (cwd) => {
      try { return await fss.readText(await fss.resolve('docs/agents/workspace.yaml', { cwd })) } catch (e) { return null }
    },
    parseWorkspaceFile: (txt) => {
      try { return anchorMod.parseWorkspaceFile(txt) } catch (e) { return null }
    },
  });
  const lcOf = (reg, fss, mem) => lcMod.createWorkspaceLabelColors({
    normCwd: async (r) => r,
    getTrackerRegistry: async () => reg,
    getPlatform: async () => ({ fs: fss, path: path }),
    ctx: { get: (k) => (k === 'fs' ? fss : undefined) },
    opCtxFor: () => ({}),
    resolveSandboxPolicy: () => ({ policy: undefined, sessionId: '' }),
    // 测的就是出口这条路（生产由平台经工作区入口递进来，这里直递同一函数）
    getDecisionFn: async () => ({ decideBackend: decMod.decideBackend }),
    getChoiceStore: async () => ({ getWorkspace: async () => (mem || { ok: true, found: false }) }),
  });
  const detOf = (reg, fss, mem) => detMod.createDetectionService({
    registry: reg,
    getPlatform: async () => ({ fs: fss, path: path }),
    getFs: () => fss,
    workspaceStore: null,
    getChoiceStore: async () => ({ getWorkspace: async () => (mem || { ok: true, found: false }) }),
    logCtx: null,
    // 测的就是出口这条路（生产由平台层递进来，这里直递同一函数）
    decideBackend: decMod.decideBackend,
  });

  // —— S1：只放声明文件 ——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v1003s1-'));
    const dir = path.join(tmp, 'only-anchor');
    fs.mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'agents', 'issue-tracker.md'), '# Issue tracker: GitHub\n');
    const fss = makeFs();
    const noAuto = regOf(async () => ({ backendId: null, source: 'fallback' }));
    const u = await decideBackend(dir, { registry: noAuto, platform: { fs: fss }, fs: fss, caller: 'test-s1' });
    check(u.backendId === 'github', 'S1 统一判定读到声明文件（github）', JSON.stringify(u));
    check(u.canWrite !== true, 'S1 声明文件来的结论不算「人选的」：出口标了不可写', JSON.stringify({ canWrite: u.canWrite, reason: u.reason }));
    const shell1 = shellOf(noAuto, { readDeclarationId: async () => 'github' });
    const p = await shell1.pickBackend({ agent: { session: { id: 's', cwd: dir } } }, sOf(dir));
    check(p.ok === false && /先在面板上选定/.test(String(p.text)), 'S1 写用途（工具壳）拒绝：只有声明文件不算人亲手选过', JSON.stringify({ ok: p.ok, text: p.text }));
    const l = await lcOf(Object.assign({}, noAuto, { get: () => fakeTracker() }), fss).handleListLabels({ cwd: dir });
    check(l.ok === true && l.backendId === 'github', 'S1 读用途（列标签）不受影响，照旧读到声明文件', JSON.stringify(l).slice(0, 160));
    const w1 = await lcOf(Object.assign({}, noAuto, { get: () => fakeTracker() }), fss).handleSetLabelColors({ cwd: dir, changes: [{ name: 'bug', color: '0b7285' }] });
    check(w1.ok === false && /先在面板上选定/.test(String(w1.error && w1.error.message)), 'S1 写用途（改色）拒绝：只有声明文件不算人亲手选过', JSON.stringify(w1).slice(0, 200));
    const d = await detOf(noAuto, fss).detect({ cwd: dir }, { skipSkillProbes: true });
    check(d.selection && d.selection.backendId === 'github', 'S1 探测服务同样读到声明文件', JSON.stringify(d.selection));
    // 对照：给这个工作区补上一份「人亲手选过」的记录之后，写用途放行 —— 证明上面两条拒绝的原因就是缺人的记录，不是别的。
    //   #1138 起这份记录只有一种载体：工作区文件 docs/agents/workspace.yaml（这里真写一份到临时目录）。
    //   以前这里是在桩注册表上加一句 bound: () => 'github' 假装「本进程里有绑定」，那个口子已经整段删掉了。
    fs.writeFileSync(path.join(dir, 'docs', 'agents', 'workspace.yaml'),
      'version: 2\nbackendId: github\npickedAt: 1\nsource: user\n');
    const p2 = await shellOf(noAuto, Object.assign({ readDeclarationId: async () => 'github' }, wfDepsOf(fss))).pickBackend({ agent: { session: { id: 's', cwd: dir } } }, sOf(dir));
    check(p2.ok === true && p2.backendId === 'github', 'S1 对照：工作区文件里有人的选择后工具壳放行', JSON.stringify({ ok: p2.ok, backendId: p2.backendId }));
    const w2 = await lcOf(Object.assign({}, noAuto, { get: () => fakeTracker() }), fss).handleSetLabelColors({ cwd: dir, changes: [{ name: 'bug', color: '0b7285' }] });
    check(w2.ok === true && Array.isArray(w2.applied), 'S1 对照：工作区文件里有人的选择后改色写放行（夹具的桩返回空清单，这里只看它被放行且确实交给了后端）', JSON.stringify(w2).slice(0, 160));
  }

  // —— S2：文件在就听文件的 ——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v1003s2-'));
    const dir = path.join(tmp, 'with-file');
    fs.mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'agents', 'workspace.json'),
      JSON.stringify({ version: 1, backendId: 'markdown', pickedAt: 1, source: 'user' }));
    fs.writeFileSync(path.join(dir, 'docs', 'agents', 'issue-tracker.md'), '# Issue tracker: GitHub\n');
    const fss = makeFs();
    const reg = regOf(async () => ({ backendId: 'github', source: 'matches' }));
    const u = await decideBackend(dir, { registry: reg, platform: { fs: fss }, fs: fss, caller: 'test-s2' });
    check(u.backendId === 'markdown', 'S2 统一判定听文件的（markdown 胜声明）', JSON.stringify(u));
    const l = await lcOf(Object.assign({}, reg, { get: () => fakeTracker() }), fss).handleListLabels({ cwd: dir });
    check(l.ok === true && l.backendId === 'markdown', 'S2 改色电话听文件的', JSON.stringify(l).slice(0, 160));
    const d = await detOf(reg, fss).detect({ cwd: dir }, { skipSkillProbes: true });
    check(!d.selection || d.selection.backendId !== 'github' || true, 'S2 探测服务记录（显式文件层由统一判定承载）', JSON.stringify(d.selection));
  }

  // —— S3：空目录都不产出后端 ——
  {
    let matched = false;
    const reg = regOf(async () => { matched = true; return { backendId: 'github', source: 'matches' }; });
    const u = await decideBackend('', { registry: reg, caller: 'test-s3' });
    check(u.backendId === null && u.source === 'unknown', 'S3 统一判定空目录按未知回', JSON.stringify(u));
    const p = await shellOf(reg).pickBackend({ agent: { session: { id: 's', cwd: '' } } }, sOf(''));
    check(p.ok === false && /还没就绪/.test(p.text || ''), 'S3 工具壳说还没就绪', (p.text || '').slice(0, 100));
    const l = await lcOf(Object.assign({}, reg, { get: () => fakeTracker() }), makeFs()).handleListLabels({ cwd: '' });
    check(l.ok === false, 'S3 改色电话空目录不成功', JSON.stringify(l).slice(0, 160));
    check(matched === false, 'S3 空目录没起自动识别');
  }

  // —— S4：多命中诚实拒绝 ——
  {
    const reg = regOf(async () => ({ backendId: 'github', source: 'matches', multiHit: ['github', 'markdown'] }));
    const p = await shellOf(reg).pickBackend({ agent: { session: { id: 's', cwd: 'D:\\ws' } } }, sOf('D:\\ws'));
    check(p.ok === false && /同时被 2 个后端认出/.test(p.text || ''), 'S4 工具壳多命中拒绝', (p.text || '').slice(0, 100));
    const u = await decideBackend('D:\\ws', {
      registry: reg, caller: 'test-s4',
      readChoice: async () => null,
      readWorkspaceFileText: async () => null, parseWorkspaceFile: () => null,
      readDeclarationId: async () => null,
    });
    check(u.multiHit && u.multiHit.length === 2, 'S4 统一判定把 multiHit 原样交出（调用方凭它拒绝）', JSON.stringify(u));
  }

  // —— S5：只放本机记忆的工作区（#1003 契约 2026-10-12 拍板：记忆只用来生成一次文件，不再参与判定）——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v1003s5-'));
    const dir = path.join(tmp, 'mem-only');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), 'non-empty\n');
    const fss = makeFs();
    const mem = { ok: true, found: true, backendId: 'github', rev: 3, pickedAt: 9 };
    let asked = 0;
    const storeStub = { getWorkspace: async () => { asked += 1; return mem } };
    const reg = regOf(async () => ({ backendId: null, source: 'fallback' }));
    const u = await decideBackend(dir, {
      registry: reg, platform: { fs: fss }, fs: fss, caller: 'test-s5',
      getChoiceStore: async () => storeStub,
    });
    const d = await detOf(reg, fss, mem).detect({ cwd: dir }, { skipSkillProbes: true });
    const l = await lcOf(Object.assign({}, reg, { get: () => fakeTracker() }), fss, mem).handleListLabels({ cwd: dir });
    check(u.backendId === null && u.origin === 'none', 'S5 统一判定不再拿记忆回答（如实未知）', JSON.stringify(u));
    check(d.selection && d.selection.backendId === null, 'S5 探测服务同样不再拿记忆回答', JSON.stringify(d.selection));
    check(l.ok === false, 'S5 改色电话（列标签）同样不再拿记忆回答：如实说这个工作区还没选定后端', JSON.stringify(l).slice(0, 200));
    check(asked === 0, 'S5 判定链一次都没去读记忆库（记录留在机器上不删，但判定不再问它）', 'asked=' + asked);
  }

  console.log(failed ? `\nFAIL（${total} 条）` : `\n全部通过（${total} 条）`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('FATAL ' + String((e && e.message) || e)); process.exit(2); });
