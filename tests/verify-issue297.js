// verify-issue297.js —— 「工作区已空」这条失效维度（#297），以及 2026-09-21 对它的那次收窄（#669 第 1 件）。
//
// 这条维度今天管两件事，判据都落在 src/host/tracker/detection/detectionService.js：
//   ① 记忆里的选择（宿主侧那份 H）：工作区已空 → 那条记录视为过期、不拿它回答（#297 的反向约束）；
//   ② 缓存里那条选择：工作区已空 → 这份缓存不作数，重算。
// 2026-09-21 的收窄（#669 第 1 件）：① 与 ② 都只作废「记忆与缓存里的选择」，
//   **不作废「客户端当场报上来的那一个（hint）」** —— 全新空目录里用户刚在蓝条上选完后端，
//   若把它一并作废，宿主的后端是空的、后端链整段不组装，链快照里连「已关联 GitHub 仓库」那一行都没有，
//   界面那条横幅于是把「该工作区尚未初始化」黄条提前给出去（把用户往错误的一步引）。
//
// 为什么这一道要进 npm run verify：这个文件原来没挂在链上，而它写的还是收窄之前的口径
//   （空目录 + hint → stale），于是一边红着一边没人看得见 —— 收窄之后，「当场选的那一个要算数」
//   与「记忆里的那一个要失效」这两条约束在链上都没有判据。2026-09-22 把它按收窄后的口径改准、
//   补上「记忆」那一条，并挂进 verify 链（每一组都带反证或对照，避免又变成一道白跑的绿灯）。
import { createRegistry } from '../src/host/tracker/registryCore.js'; // V1 #461：registry.js 已拆为三块
import { createDetectionService } from '../src/host/tracker/detection/detectionService.js';
import { createWorkspaceStore } from '../src/host/tracker/detection/workspaceStore.js';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { console.log('  PASS ' + msg); passed++; } else { console.log('  FAIL ' + msg); failed++; } }

console.log('== #297 空目录失效维度 + #669 对它的收窄 ==');
// Mock regs
const reg = createRegistry({}, { matchesTimeout: 30 });
reg.register({ id: 'markdown', label: 'Markdown', create: () => ({ id: 'markdown', preflight: async () => ({ ok: true }) }), matches: async () => false });
reg.register({ id: 'github', label: 'GitHub', create: () => ({ id: 'github', preflight: async () => ({ ok: true }) }), matches: async () => false });

const mkPlat = (names) => ({
  fs: { resolve: async (p) => p, readText: async () => { throw new Error('no file') }, lstat: async () => null, listDir: async () => names },
  path: { join: (...a) => a.join('/'), sep: '/' }, resolveExecutable: async () => null, getHome: async () => null, env: { get: () => undefined, has: () => false }
});
const emptyPlat = mkPlat([]);
const nonEmptyPlat = mkPlat(['README.md']);
const ignorablePlat = mkPlat(['.DS_Store']);
const noFsPlat = { path: { join: (...a) => a.join('/'), sep: '/' }, resolveExecutable: async () => null, getHome: async () => null, env: { get: () => undefined, has: () => false } };

const mkSvc = (plat, extra) => createDetectionService(Object.assign({
  registry: reg,
  getPlatform: async () => plat,
  getFs: () => plat.fs,
  getTimers: () => ({ setTimeout, clearTimeout }),
  workspaceStore: createWorkspaceStore({ ttl: 30000 }),
  skillProbe: async () => ({ ok: true, missing: [], probes: {} }),
}, extra || {}));

// 一份「记忆里记着 markdown」的假记忆库（形状照 src/host/choiceStore.js 的读口）
const mkMemory = (backendId) => async () => ({
  getWorkspace: async () => ({ ok: true, found: true, backendId: backendId, rev: 1, pickedAt: 1 }),
});

async function run() {
  console.log('');
  console.log('-- A #669 正向：空工作区里「当场报上来的那一个」要算数（收窄之前这里被判成无后端）--');
  {
    const res = await mkSvc(emptyPlat).detect({ cwd: '/tmp/empty' }, { hintBackendId: 'markdown' });
    ok(res.selection.backendId === 'markdown' && res.selection.source === 'explicit', '空目录 + hint -> 采纳 hint（实得 ' + JSON.stringify(res.selection && res.selection.backendId) + '）');
    const ig = await mkSvc(ignorablePlat).detect({ cwd: '/tmp/ignorable' }, { hintBackendId: 'markdown' });
    ok(ig.selection.backendId === 'markdown', '只有 .DS_Store 的目录 + hint -> 同样采纳（实得 ' + JSON.stringify(ig.selection && ig.selection.backendId) + '）');
    const ne = await mkSvc(nonEmptyPlat).detect({ cwd: '/tmp/nonempty' }, { hintBackendId: 'markdown' });
    ok(ne.selection.backendId === 'markdown', '非空目录 + hint -> 采纳（这条没变过）');
    // 反证：把 hint 这一档整个关掉（等于回到收窄之前的「一律作废」），上面第一条必须当场变红。
    // 做法照 tests/verify-669-choice-precedence.js 的先例：把改坏的那一份**真的求值出来跑**，
    // 剥掉两行 import、改用参数注入，只比字符串不等就是假反证。
    const srcText = fs.readFileSync(fileURLToPath(new URL('../src/host/tracker/detection/detectionService.js', import.meta.url)), 'utf8')
    const brokenText = srcText.replace('const hintUsable = !!(opts.hintBackendId', 'const hintUsable = false && !!(opts.hintBackendId')
    ok(brokenText !== srcText, '反证 A 的改法能在真源里落地（把 hint 那一档关掉）');
    const { createDetectionService: realCreate } = await import(new URL('../src/host/tracker/detection/detectionService.js', import.meta.url).href);
    const { detectExplicit } = await import(new URL('../src/host/tracker/detection/explicitDetector.js', import.meta.url).href);
    const { canonicalWorkspaceKey } = await import(new URL('../src/host/workspaceKey.js', import.meta.url).href);
    const brokenBody = brokenText
      .replace(/^import[^\n]*\n/gm, '')
      .replace(/^export default createDetectionService[^\n]*\n?/gm, '')
      .replace(/^[ \t]*export[ \t]+/gm, '');
    const brokenCreate = new Function('detectExplicit', 'canonicalWorkspaceKey', brokenBody + '\n;return createDetectionService')(detectExplicit, canonicalWorkspaceKey);
    ok(typeof brokenCreate === 'function' && typeof realCreate === 'function', '改坏的那一份真的求值出来了（不是只比字符串）');
    const brokenRes = await brokenCreate({ registry: reg, getPlatform: async () => emptyPlat, getFs: () => emptyPlat.fs, getTimers: () => ({ setTimeout, clearTimeout }), workspaceStore: createWorkspaceStore({ ttl: 30000 }), skillProbe: async () => ({ ok: true, missing: [], probes: {} }) }).detect({ cwd: '/tmp/empty-broken' }, { hintBackendId: 'markdown' });
    ok(brokenRes.selection.backendId === null, '反证 A 成立：关掉 hint 那一档之后，空目录 + hint 又被判成无后端（实得 ' + JSON.stringify(brokenRes.selection && brokenRes.selection.backendId) + '）—— 说明 A 组量的就是这道闸');
  }

  console.log('');
  console.log('-- B #297 反向：不带选择时，空工作区的记忆仍然失效、答复回到 fallback（蓝条回来）--');
  {
    const res = await mkSvc(emptyPlat).detect({ cwd: '/tmp/empty2' }, {});
    ok(res.selection.backendId === null && res.selection.source === 'fallback', '空目录、不带选择 -> fallback（实得 ' + JSON.stringify(res.selection) + '）');
    // 记忆里明明记着 markdown，但工作区已空 -> 那条记忆不回答，照旧 fallback
    const withMem = await mkSvc(emptyPlat, { getChoiceStore: mkMemory('markdown') }).detect({ cwd: '/tmp/empty-mem' }, {});
    ok(withMem.selection.backendId === null && withMem.selection.source === 'fallback', '空目录、记忆里记着 markdown -> 记忆视为过期，仍 fallback（实得 ' + JSON.stringify(withMem.selection) + '）');
    // 对照：同一个记忆库，工作区非空时它就该说话（否则上面那条可能只是「记忆这条路根本没接上」）
    const memNonEmpty = await mkSvc(nonEmptyPlat, { getChoiceStore: mkMemory('markdown') }).detect({ cwd: '/tmp/nonempty-mem' }, {});
    ok(memNonEmpty.selection.backendId === 'markdown', '对照：同样这份记忆、工作区非空 -> 采纳它（实得 ' + JSON.stringify(memNonEmpty.selection && memNonEmpty.selection.backendId) + '）');
    // 只有 .DS_Store 的目录同样算空
    const igMem = await mkSvc(ignorablePlat, { getChoiceStore: mkMemory('markdown') }).detect({ cwd: '/tmp/ignorable-mem' }, {});
    ok(igMem.selection.backendId === null, '对照：只有 .DS_Store 的目录 -> 也算空，记忆同样不回答');
  }

  console.log('');
  console.log('-- C 其余两条不变的口径 --');
  {
    const noFs = await mkSvc(noFsPlat).detect({ cwd: '/tmp/empty' }, { hintBackendId: 'markdown' });
    ok(noFs.selection.backendId === 'markdown', '平台没有 fs 时保守处理：不判空，hint 照采纳');
    const unreg = await mkSvc(emptyPlat).detect({ cwd: '/tmp/empty' }, { hintBackendId: 'unknown' });
    ok(unreg.selection.backendId === null && unreg.selection.source === 'fallback', '注册表不认的 hint -> fallback（不许答一个没有模块的后端）');
  }

  console.log('');
  console.log('-- D 缓存那一路：空工作区上缓存不作数，答的仍是重算出来的结果 --');
  {
    const ws = createWorkspaceStore({ ttl: 30000 });
    const svc = mkSvc(emptyPlat, { workspaceStore: ws });
    const r1 = await svc.detect({ cwd: '/tmp/cached' }, { hintBackendId: 'markdown' });
    ok(r1.selection.backendId === 'markdown', '空目录 + hint：第一次就是 hint（不再是 stale 的 explicit null）');
    const r2 = await svc.detect({ cwd: '/tmp/cached' }, { hintBackendId: 'markdown' });
    ok(r2.selection.backendId === 'markdown', '第二次（不带 force、会走缓存那一路）仍然是同一个答复');
    // 工作区从「非空」变「空」：缓存里那条不许直接端出去，重算之后按当下的口径回答
    let plat = nonEmptyPlat;
    const ws2 = createWorkspaceStore({ ttl: 30000 });
    const svc2 = createDetectionService({ registry: reg, getPlatform: async () => plat, getFs: () => plat.fs, getTimers: () => ({ setTimeout, clearTimeout }), workspaceStore: ws2, skillProbe: async () => ({ ok: true, missing: [], probes: {} }) });
    const a1 = await svc2.detect({ cwd: '/tmp/cache-invalidate' }, { hintBackendId: 'markdown' });
    ok(a1.selection.backendId === 'markdown', '先是非空目录：采纳 hint');
    plat = emptyPlat;
    const svc3 = createDetectionService({ registry: reg, getPlatform: async () => plat, getFs: () => plat.fs, getTimers: () => ({ setTimeout, clearTimeout }), workspaceStore: ws2, skillProbe: async () => ({ ok: true, missing: [], probes: {} }) });
    const a2 = await svc3.detect({ cwd: '/tmp/cache-invalidate' }, { hintBackendId: 'markdown' });
    ok(a2.selection.backendId === 'markdown', '目录清空之后：缓存那条被判过期、重算，答复按当下的口径给（不是缓存里的旧值）');
  }
}

await run();
console.log('\n#297 verify: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
