#!/usr/bin/env node
// tests/verify-1003-migration.js —— #1003 二期门禁：老用户迁移先写后退 + 空目录不冒充
// 用法：node tests/verify-1003-migration.js
// 钉四条（契约期望行为第5条 + 第9条的 workspaceCwd 落点）：
//   M1 文件缺席 + 记忆有 → 选择后文件被建出来（来源记人选，记忆那条本来就是人选的；migrated 等 #1012 切核后再记）
//   M2 文件已在 → 不覆盖（文件赢，后手改的内容不动；第二次选择不再试第二次写）
//   M3 记忆没有 / 后端未注册 → 不写文件（不把猜写进真源）
//   M4 空目录 → 选择按未知回，不建文件不起命令（handleBind 空输入直接拒绝，不拿进程目录冒充）
// 日志沿用既有事件（host.call / host.call.fail），不新增事件，字段与白名单一致；
// 附录与计数由后完成方统一收口，这里只断行为不断条数。
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
let failed = false;
let total = 0;
const check = (ok: unknown, msg: string, detail = '') => {
  total += 1;
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 300) : '')));
  if (!ok) failed = true;
};
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
function makeFs() {
  return {
    async resolve(p: unknown, opts?: { cwd?: string }) {
      const base = (opts && opts.cwd) || '';
      const rel = String(p || '').replace(/\\/g, '/');
      return base ? String(base).replace(/\\/g, '/') + '/' + rel : rel;
    },
    async readText(t: unknown) {
      const real = String(t).replace(/\//g, path.sep);
      return fs.readFileSync(real, 'utf8');
    },
    async writeText(t: unknown, c: unknown) {
      const real = String(t).replace(/\//g, path.sep);
      fs.mkdirSync(path.dirname(real), { recursive: true });
      fs.writeFileSync(real, String(c), 'utf8');
    },
  };
}
function makeWs(dir: string, memBackendId: string | null, opts?: { layout?: string }) {
  const o = opts || {};
  const fss = makeFs();
  const plat = { fs: fss, path: path };
  const reg = {
    has: (id: unknown) => id === 'github' || id === 'markdown',
    get: (id: unknown) => ((id === 'github' || id === 'markdown') ? {} : undefined),
    bound: () => undefined,
    describe: (h: unknown, id: unknown) => ({ backend: id, refId: '', name: '', url: '' }),
    select: async () => ({ backendId: null, source: 'fallback' }),
  };
  const cs = {
    async getWorkspace(cwd: unknown) {
      if (memBackendId == null) return { ok: true, found: false };
      return { ok: true, found: true, backendId: memBackendId, rev: 7, pickedAt: 123 };
    },
    async getLayout(cwd: unknown) {
      if (o && (o.layout === 'single' || o.layout === 'multi')) return { ok: true, found: true, layout: o.layout, pickedAt: 124 };
      return { ok: true, found: false };
    },
    async rememberWorkspace() { return { ok: true, rev: 8 }; },
  };
  let invalidated = 0;
  return { fss, plat, reg, cs, invalidated: () => invalidated,
    mod: null as unknown,
    async build() {
      const m = await imp('src/host/workspaceCwd.js');
      this.mod = m;
      const self = this;
      return m.createWorkspaceCwd({
        ctx: { get: (k: string) => (k === 'fs' ? fss : undefined) },
        DEFAULT_CWD: 'D:/process-dir',
        getPlatform: async () => plat,
        getTrackerRegistry: async () => reg,
        getWorkspaceStore: async () => ({ invalidate() { invalidated += 1; } }),
        getChoiceStore: async () => cs,
        canonicalKey: async (r: unknown) => r,
        setCache: () => { invalidated += 1; },
        logCtx: { fire: () => {}, isEnabled: () => false },
        timer: { timeout: () => 0 },
        detectionExec: async () => ({ ok: false }),
      });
    } };
}
async function main() {
  console.log('#1003 二期门禁：老用户迁移四条');
  // M1 文件缺席 + 记忆有 → 建文件
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v1003m1-'));
    const dir = path.join(tmp, 'ws');
    fs.mkdirSync(dir, { recursive: true });
    const h = makeWs(dir, 'github');
    const ws = await h.build();
    await ws.handleSelection({ cwd: dir });
    await new Promise((r) => setTimeout(r, 300));
    const fp = path.join(dir, 'docs', 'agents', 'workspace.yaml');
    let ok = false, body = '';
    try { body = fs.readFileSync(fp, 'utf8'); ok = body.includes('backendId: github') && body.includes('source: migrated') && body.includes('version: 2'); } catch (e) {}
    check(ok, 'M1 文件缺席+记忆有，选择后文件被建出来（github/migrated，新格式 YAML 版本 2：来源如实记搬来的）', body.slice(0, 200));
  }
  // M1b 记忆里的域文档布局一起搬过去（没有就不写，不丢也不造）
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v1003m1b-'));
    const dir = path.join(tmp, 'ws');
    fs.mkdirSync(dir, { recursive: true });
    const h = makeWs(dir, 'github', { layout: 'multi' });
    const ws = await h.build();
    await ws.handleSelection({ cwd: dir });
    await new Promise((r) => setTimeout(r, 300));
    let ok = false, body = '';
    try { body = fs.readFileSync(path.join(dir, 'docs', 'agents', 'workspace.yaml'), 'utf8'); ok = body.includes('layout: multi'); } catch (e) {}
    check(ok, 'M1b 记忆里的域文档布局一起搬进文件（multi）', body.slice(0, 200));
  }
  // M2 文件已在 → 不覆盖
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v1003m2-'));
    const dir = path.join(tmp, 'ws');
    fs.mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'agents', 'workspace.yaml'), JSON.stringify({ version: 1, backendId: 'markdown', pickedAt: 1, source: 'user' }));
    const h = makeWs(dir, 'github');
    const ws = await h.build();
    await ws.handleSelection({ cwd: dir });
    await new Promise((r) => setTimeout(r, 300));
    const o = fs.readFileSync(path.join(dir, 'docs', 'agents', 'workspace.yaml'), 'utf8');
    check(o.includes('markdown') && !o.includes('github'), 'M2 文件已在不覆盖（文件赢，记忆 github 不顶掉 markdown）', o.slice(0, 200));
  }
  // M3 记忆没有 → 不写；未注册 → 不写
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v1003m3-'));
    const dir = path.join(tmp, 'ws');
    fs.mkdirSync(dir, { recursive: true });
    const h1 = makeWs(dir, null);
    const ws1 = await h1.build();
    await ws1.handleSelection({ cwd: dir });
    await new Promise((r) => setTimeout(r, 300));
    check(!fs.existsSync(path.join(dir, 'docs', 'agents', 'workspace.yaml')), 'M3 记忆没有不写文件');
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'v1003m3b-'));
    const dir2 = path.join(tmp2, 'ws');
    fs.mkdirSync(dir2, { recursive: true });
    const h2 = makeWs(dir2, 'gitlab');
    const ws2 = await h2.build();
    await ws2.handleSelection({ cwd: dir2 });
    await new Promise((r) => setTimeout(r, 300));
    check(!fs.existsSync(path.join(dir2, 'docs', 'agents', 'workspace.yaml')), 'M3 未注册后端不写文件（不把猜写进真源）');
  }
  // M4 空目录 → 未知，不建文件；bind 空输入直接拒绝
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v1003m4-'));
    const dir = path.join(tmp, 'ws');
    fs.mkdirSync(dir, { recursive: true });
    const h = makeWs(dir, 'github');
    const ws = await h.build();
    const sel = await ws.handleSelection({ cwd: '' });
    check(sel && sel.selection && sel.selection.backendId === null && sel.selection.source === 'unknown', 'M4 空目录选择按未知回', JSON.stringify(sel).slice(0, 200));
    const b = await ws.handleBind({ cwd: '', backendId: 'github' });
    check(b && b.ok === false && /还没就绪/.test(String(b.error || '')), 'M4 空目录绑定直接说还没就绪（不拿进程目录冒充）', JSON.stringify(b).slice(0, 200));
  }
  console.log(failed ? `\nFAIL（${total} 条）` : `\n全部通过（${total} 条）`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('FATAL ' + String((e && e.message) || e)); process.exit(2); });
