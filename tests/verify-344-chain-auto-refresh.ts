// tests/verify-344-chain-auto-refresh.js — #344 加固验证：FILE_EXISTS 直读兜底
// 用法：node tests/verify-344-chain-auto-refresh.ts
//
// 本文件只留功能面：起真实的谓词执行器，喂一个「平台全部失效」的 mock，
// 看 FILE_EXISTS 这条原语能不能靠直读兜底给出正确结论（文件在就 pass、不在就 fail）。
// 原来还夹着两批静态读源码的断言（自轮询常量已退役、probe 里有 #344 注释、发货产物里含某段字符串），
// 那些断言的对象是手写源码文本，等价重构就会误报，已按维护者要求清掉。

let failed = false;
let total = 0, passed = 0;
function check(ok: unknown, msg: string, detail = '') {
  total++;
  if (ok) { passed++; console.log('  PASS ' + msg); }
  else { failed = true; console.log('  FAIL ' + msg + (detail ? ' — ' + detail : '')); }
}

console.log('== #344 修复验证 ==');

// 功能性：mock 平台失效时直读兜底仍能 pass
console.log('\n— 功能性：mock 平台失效时直读兜底 —');
try {
  const { createPredicateRegistry } = await import('../src/host/tracker/predicateCore.js'); // V1 #461：predicateRegistry.js 已拆为两块
  const pathMod = await import('node:path');
  const fsMod = await import('node:fs/promises');
  const osMod = await import('node:os');
  const path = pathMod.default || pathMod;
  const fs = fsMod.default || fsMod;
  const os = osMod.default || osMod;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'verify-344-'));
  const rel = 'docs/agents/issue-tracker.md';
  const full = path.join(tmp, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, '# test', 'utf8');
  const mockPlatform = {
    path,
    fs: {
      resolve: async (rel2: unknown, opts: { cwd: string }) => path.join(opts.cwd, rel2),
      exists: async () => false,
      listDir: async () => { throw new Error('no'); },
      stat: async () => { throw new Error('no'); },
      lstat: async () => { throw new Error('no'); },
      readText: async () => { throw new Error('no'); },
    },
    getHome: async () => os.homedir()
  };
  const reg = createPredicateRegistry({ timeout: 5000 });
  // 注册通用谓词以外的 FILE_EXISTS 直接走 primitive 分支
  const chain = [{ id: 'tracker:initialized', check: { kind: 'primitive', primitive: 'fileExists', path: rel }, onPass: { show: { fallback: 'ok' }, actions: [] }, onFail: { show: { fallback: 'fail' }, actions: [] } }];
  const resolved = await reg.resolveAll(chain, { platform: mockPlatform, cwd: tmp, lang: 'zh' });
  const r = resolved['tracker:initialized'];
  check(r && r.status === 'pass', 'mock 平台全部 miss 时直读兜底仍 pass — got=' + JSON.stringify(r));
  // 清理
  await fs.rm(tmp, { recursive: true, force: true });
  // 负向：文件不存在时应 fail（直读也 miss）
  const tmp2 = await fs.mkdtemp(path.join(os.tmpdir(), 'verify-344-neg-'));
  const resolved2 = await reg.resolveAll(chain, { platform: mockPlatform, cwd: tmp2, lang: 'zh' });
  const r2 = resolved2['tracker:initialized'];
  check(r2 && r2.status === 'fail', '文件不存在时仍 fail — got=' + JSON.stringify(r2));
  await fs.rm(tmp2, { recursive: true, force: true });
} catch (e) { check(false, '功能性测试抛错', String((e as Error).stack || (e as Error).message).slice(0, 800)); }

console.log(`\n— 汇总 —\n  total=${total} passed=${passed} failed=${total - passed}`);
if (failed) { console.log('\n  FAIL verify-344-chain-auto-refresh — 有失败'); process.exit(1); }
else { console.log('\n  PASS verify-344-chain-auto-refresh — 全部通过 (#344)'); }
