// tests/verify-344-chain-auto-refresh.js — #344 修复验证：链自动重求值与探测加固
// 用法：node tests/verify-344-chain-auto-refresh.js
import { readFileSync } from 'node:fs';

let failed = false;
let total = 0, passed = 0;
function check(ok, msg, detail=''){
  total++;
  if(ok){ passed++; console.log('  PASS '+msg); }
  else { failed=true; console.log('  FAIL '+msg+(detail?' — '+detail:'')); }
}

console.log('== #344 修复验证 ==');

// 1. client probe 自动重求值存在
console.log('\n— client 链自动重求值 —');
try{
  const probeSrc = readFileSync('src/client/kernel/probe.js','utf8');
  check(probeSrc.includes('CHAIN_AUTO_POLL_MS'), 'probe.js 定义 CHAIN_AUTO_POLL_MS');
  check(probeSrc.includes('scheduleChainAutoRefresh'), 'probe.js 导出 scheduleChainAutoRefresh');
  check(probeSrc.includes('cancelChainAutoRefresh'), 'probe.js 导出 cancelChainAutoRefresh');
  check(probeSrc.includes('#344'), 'probe.js 含 #344 修复注释');
  check(probeSrc.includes('loadChain(st, true)'), 'probe.js 在非全绿时自动 force 重算');
  // 构建产物
  const clientBuilt = readFileSync('client.js','utf8');
  check(clientBuilt.includes('CHAIN_AUTO_POLL_MS'), '构建产物 client.js 含自动轮询');
  const pkgBuilt = readFileSync('package/lib/client.js','utf8');
  check(pkgBuilt.includes('CHAIN_AUTO_POLL_MS'), '构建产物 package/lib/client.js 含自动轮询');
}catch(e){ check(false, '读取 probe 相关文件', String(e.message)); }

// 2. host 探测加固
console.log('\n— host 探测加固 —');
try{
  const predSrc = readFileSync('src/host/tracker/predicateRegistry.js','utf8');
  check(predSrc.includes('#344 加固'), 'predicateRegistry.js 含 #344 加固注释');
  check(predSrc.includes("import('node:fs/promises')"), 'predicateRegistry.js 含直读兜底 import');
  check(predSrc.includes('absDirect') || predSrc.includes('directOk'), 'predicateRegistry.js 有直读路径分支');
  const hostBuilt = readFileSync('host.js','utf8');
  check(hostBuilt.includes('344') || hostBuilt.includes('directOk') || hostBuilt.includes('absDirect'), '构建产物 host.js 含加固（或等价）');
}catch(e){ check(false, '读取 host 相关文件', String(e.message)); }

// 3. 功能性：FILE_EXISTS 直读兜底在 mock 平台失效时仍能 pass
console.log('\n— 功能性：mock 平台失效时直读兜底 —');
try{
  const { createPredicateRegistry } = await import('../src/host/tracker/predicateRegistry.js');
  const pathMod = await import('node:path');
  const fsMod = await import('node:fs/promises');
  const osMod = await import('node:os');
  const path = pathMod.default || pathMod;
  const fs = fsMod.default || fsMod;
  const os = osMod.default || osMod;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'verify-344-'));
  const rel = 'docs/agents/issue-tracker.md';
  const full = path.join(tmp, rel);
  await fs.mkdir(path.dirname(full), {recursive:true});
  await fs.writeFile(full, '# test', 'utf8');
  const mockPlatform = {
    path,
    fs: {
      resolve: async (rel2, opts) => path.join(opts.cwd, rel2),
      exists: async () => false,
      listDir: async () => { throw new Error('no'); },
      stat: async () => { throw new Error('no'); },
      lstat: async () => { throw new Error('no'); },
      readText: async () => { throw new Error('no'); },
    },
    getHome: async () => os.homedir()
  };
  const reg = createPredicateRegistry({timeout:5000});
  // 注册通用谓词以外的 FILE_EXISTS 直接走 primitive 分支
  const chain = [{ id: 'tracker:initialized', check: { kind: 'primitive', primitive: 'fileExists', path: rel }, onPass: {show:{fallback:'ok'},actions:[]}, onFail:{show:{fallback:'fail'},actions:[]}}];
  const resolved = await reg.resolveAll(chain, { platform: mockPlatform, cwd: tmp, lang: 'zh' });
  const r = resolved['tracker:initialized'];
  check(r && r.status === 'pass', 'mock 平台全部 miss 时直读兜底仍 pass — got='+JSON.stringify(r));
  // 清理
  await fs.rm(tmp, {recursive:true, force:true});
  // 负向：文件不存在时应 fail（直读也 miss）
  const tmp2 = await fs.mkdtemp(path.join(os.tmpdir(), 'verify-344-neg-'));
  const resolved2 = await reg.resolveAll(chain, { platform: mockPlatform, cwd: tmp2, lang: 'zh' });
  const r2 = resolved2['tracker:initialized'];
  check(r2 && r2.status === 'fail', '文件不存在时仍 fail — got='+JSON.stringify(r2));
  await fs.rm(tmp2, {recursive:true, force:true});
}catch(e){ check(false, '功能性测试抛错', String(e.stack||e.message).slice(0,800)); }

console.log(`\n— 汇总 —\n  total=${total} passed=${passed} failed=${total-passed}`);
if(failed){ console.log('\n  FAIL verify-344-chain-auto-refresh — 有失败'); process.exit(1); }
else { console.log('\n  PASS verify-344-chain-auto-refresh — 全部通过 (#344)'); }
