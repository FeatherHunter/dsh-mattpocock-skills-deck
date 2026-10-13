// tests/verify-1003-unified-decision.js —— #1003 一期门禁：四条判定一致 + 空目录不起命令
// 用法：node tests/verify-1003-unified-decision.js
// 钉四条（契约验收前四条的一期子集）：
//   D1 只放声明文件的工作区，工具壳与统一判定同答案（面板链已由 verify-947 W2 覆盖）
//   D2 文件存在时只听文件的（手改立刻反映，不被缓存挡住的一期：每次直读文件）
//   D3 空目录不起命令（统一判定不读文件不问注册表；工具壳直接说还没就绪；注册表不起外部命令）
//   D4 多命中不再自动写文件（verify-957 P1 已覆盖，此处覆盖工具壳多命中诚实拒绝）
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
let failed = false;
let total = 0;
const check = (ok, msg, detail) => {
  total += 1;
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 300) : '')));
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
    async lstat(t) {
      try {
        return fs.statSync(String(t).replace(/\//g, path.sep));
      } catch {
        return null;
      }
    },
    async listDir(t) {
      try {
        return fs.readdirSync(String(t).replace(/\//g, path.sep));
      } catch {
        return [];
      }
    },
    async stat(t) {
      try {
        return fs.statSync(String(t).replace(/\//g, path.sep));
      } catch {
        return null;
      }
    },
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

async function main() {
  console.log('#1003 一期门禁：统一判定四条');
  const shellMod = await imp('src/deck/shell/call-shell.ts');
  const budget = await imp('src/shared/refresh/budget.js');
  const ledgerMod = await imp('src/host/refresh/ledger.ts');
  const gateMod = await imp('src/host/refresh/gate.ts');
  const toolCost = await imp('src/shared/refresh/tool-cost.js');
  const decMod = await imp('src/tracker/detection/backendDecision.ts');
  const { decideBackend, decidePure } = decMod;

  const regOf = (selectFn) => ({
    bound: () => undefined,
    has: (id) => id === 'github' || id === 'markdown',
    describe: (h, id) => ({ backend: id, refId: 'o/n', name: id, url: '' }),
    select: selectFn,
  });
  const sOf = (cwd) => ({ cwd, workspaceKey: 'k1003', sessionId: 's1003', source: 't', text: '' });
  const shellOf = (reg, extra) =>
    shellMod.createDeckShell(
      Object.assign(
        {
          gate: makeGateLedger(gateMod, ledgerMod),
          registry: reg,
          budget,
          estimate: toolCost.estimateToolCost,
          costInputFrom: toolCost.toolCostInputFrom,
          backendCtx: {},
          decideBackend: decMod.decideBackend,
        },
        extra || {}
      )
    );

  // —— D1：只放声明文件的工作区，工具与统一判定同答案 ——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v1003d1-'));
    const dir = path.join(tmp, 'only-anchor');
    fs.mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'agents', 'issue-tracker.md'), '# Issue tracker: GitHub\n');
    const fss = makeFs();
    const unified = await decideBackend(dir, {
      registry: regOf(async () => ({ backendId: null, source: 'fallback' })),
      platform: { fs: fss },
      fs: fss,
      caller: 'test-d1',
    });
    check(unified.backendId === 'github' && unified.origin === 'declaration', 'D1 统一判定读到声明文件（github）', JSON.stringify(unified));
    const p = await shellOf(regOf(async () => ({ backendId: null, source: 'fallback' })), {
      readDeclarationId: async () => 'github',
    }).pickBackend({ agent: { session: { id: 's', cwd: dir } } }, sOf(dir));
    check(p.ok === false && /先在面板上选定/.test(String(p.text)), 'D1 写用途（工具壳）拒绝：只有声明文件不算人亲手选过（#1003 契约第 4 条）', JSON.stringify({ ok: p.ok, text: p.text }));
  }

  // —— D2：文件存在时只听文件的 ——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v1003d2-'));
    const dir = path.join(tmp, 'with-file');
    fs.mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'docs', 'agents', 'workspace.yaml'),
      JSON.stringify({ version: 1, backendId: 'markdown', pickedAt: 1, source: 'user' })
    );
    fs.writeFileSync(path.join(dir, 'docs', 'agents', 'issue-tracker.md'), '# Issue tracker: GitHub\n');
    const fss = makeFs();
    const reg = regOf(async () => ({ backendId: 'github', source: 'matches' }));
    const r1 = await decideBackend(dir, { registry: reg, platform: { fs: fss }, fs: fss, caller: 'test-d2' });
    check(r1.backendId === 'markdown', 'D2 文件存在时听文件的（markdown 胜声明 github）', JSON.stringify(r1));
    // 手改立刻反映：改文件后下一次判定即新值（本期无缓存，每次直读）
    fs.writeFileSync(
      path.join(dir, 'docs', 'agents', 'workspace.yaml'),
      JSON.stringify({ version: 1, backendId: 'github', pickedAt: 2, source: 'user' })
    );
    const r2 = await decideBackend(dir, { registry: reg, platform: { fs: fss }, fs: fss, caller: 'test-d2' });
    check(r2.backendId === 'github', 'D2 手改文件后下一次即新值（不被缓存挡住）', JSON.stringify(r2));
  }

  // —— D3：空目录不起命令 ——
  {
    let selected = false;
    const reg = regOf(async () => {
      selected = true;
      return { backendId: 'github', source: 'matches' };
    });
    const r = await decideBackend('', { registry: reg, caller: 'test-d3' });
    check(r.backendId === null && r.source === 'unknown' && r.reason === 'workspace-not-ready', 'D3 空目录统一判定按未知返回', JSON.stringify(r));
    check(selected === false, 'D3 空目录没问自动识别（不起外部命令）');
    const p = await shellOf(reg).pickBackend({ agent: { session: { id: 's', cwd: '' } } }, sOf(''));
    check(p.ok === false && /还没就绪/.test(p.text || ''), 'D3 空目录工具壳说还没就绪（不说没有后端）', (p.text || '').slice(0, 120));
    const regCore = await imp('src/tracker/registry/registryCore.ts');
    let matched = false;
    const reg2 = regCore.createRegistry();
    reg2.register({ id: 'github', label: 'G', create: () => ({}), matches: async () => { matched = true; return true; } });
    const sel = await reg2.select({ cwd: '' }, { caller: 'test-d3' });
    check(!matched && sel.backendId === null, 'D3 空目录注册表不起 matches（无外部命令）', JSON.stringify(sel));
  }

  // —— D4：多命中诚实拒绝（不再自动写） ——
  {
    const reg = regOf(async () => ({ backendId: 'github', source: 'matches', multiHit: ['github', 'markdown'] }));
    const p = await shellOf(reg).pickBackend({ agent: { session: { id: 's', cwd: 'D:\\ws' } } }, sOf('D:\\ws'));
    check(p.ok === false && p.reason === 'no-backend' && /同时被 2 个后端认出/.test(p.text || ''), 'D4 多命中诚实拒绝并引导去面板选定', (p.text || '').slice(0, 120));
  }

  // —— 纯核单测：顺序内存 > 文件 > 声明 > 记忆 > 自动识别 ——
  {
    const reg = { has: (id) => id === 'github' || id === 'markdown' };
    const rMem = decidePure({ boundId: 'markdown', fileParsed: { backendId: 'github', source: 'user' }, declarationId: 'github', choiceRecord: { backendId: 'github' }, autodetect: { backendId: 'github', source: 'matches' }, registry: reg });
    check(rMem.backendId === 'markdown', '纯核内存优先', JSON.stringify(rMem));
    const rFile = decidePure({ boundId: undefined, fileParsed: { backendId: 'markdown', source: 'user' }, declarationId: 'github', choiceRecord: { backendId: 'github' }, autodetect: { backendId: 'github', source: 'matches' }, registry: reg });
    check(rFile.backendId === 'markdown', '纯核文件胜声明', JSON.stringify(rFile));
  }

  console.log(failed ? `\nFAIL（${total} 条）` : `\n全部通过（${total} 条）`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL ' + String((e && e.message) || e));
  process.exit(1);
});
