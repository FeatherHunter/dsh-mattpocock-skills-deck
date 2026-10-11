// verify-issue297.js —— 「工作区已空」这条失效维度（#297）。
//
// 这条维度今天管两件事：
//   ① 记忆里的选择（宿主侧那份 H）：工作区已空 → 那条记录视为过期、不拿它回答
//      （判空逻辑在探测服务这一处，出口只收一个过期标记，不另写一份）；
//   ② 缓存里那条选择：工作区已空 → 这份缓存不作数，重算。
// 2026-09-21 的收窄（#669 第 1 件：空目录里当场报上来的 hint 要算数）已随 #1003 老路径删除而退役 ——
//   上报一律忽略，空目录 + hint 如实未知；下面 A/C/D 三组按退役后改准，B 组（记忆过期）原样保留。
import { createRegistry } from '../src/host/tracker/registryCore.js'; // V1 #461：registry.js 已拆为三块
import { createDetectionService } from '../src/host/tracker/detection/detectionService.js';
import { decideBackend as outletDecideBackend, selectionFromOutlet as outletSelectionFromOutlet } from '../src/host/tracker/detection/backendDecision.js';
try { outletDecideBackend.selectionFromOutlet = outletSelectionFromOutlet } catch (eAttachOutlet297) {}
import { createWorkspaceStore } from '../src/host/tracker/detection/workspaceStore.js';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileFn } from './lib/eval-probe.js';

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
  decideBackend: outletDecideBackend,
}, extra || {}));

// 一份「记忆里记着 markdown」的假记忆库（形状照 src/host/choiceStore.js 的读口）
const mkMemory = (backendId) => async () => ({
  getWorkspace: async () => ({ ok: true, found: true, backendId: backendId, rev: 1, pickedAt: 1 }),
});

async function run() {
  console.log('');
  console.log('-- A 上报即忽略（#669 收窄已随老路径退役）：空工作区里当场报上来的那一个不再算数 --');
  {
    const res = await mkSvc(emptyPlat).detect({ cwd: '/tmp/empty' }, { hintBackendId: 'markdown' });
    ok(!res.selection || res.selection.backendId === null, '空目录 + hint -> 上报不再参与，如实未知（实得 ' + JSON.stringify(res.selection && res.selection.backendId) + '）');
    const ig = await mkSvc(ignorablePlat).detect({ cwd: '/tmp/ignorable' }, { hintBackendId: 'markdown' });
    ok(!ig.selection || ig.selection.backendId === null, '只有 .DS_Store 的目录 + hint -> 同样未知（实得 ' + JSON.stringify(ig.selection && ig.selection.backendId) + '）');
    const ne = await mkSvc(nonEmptyPlat).detect({ cwd: '/tmp/nonempty' }, { hintBackendId: 'markdown' });
    ok(!ne.selection || ne.selection.backendId === null, '非空目录 + hint（无锚无文件无记忆）-> 上报仍不参与，如实未知（实得 ' + JSON.stringify(ne.selection && ne.selection.backendId) + '）');
    // 反证：把上报优先级加回来，上面第一条必须当场变红（做法同 669 门禁）。
    const srcText = fs.readFileSync(fileURLToPath(new URL('../src/host/tracker/detection/detectionService.js', import.meta.url)), 'utf8')
    const readdedText = srcText.replace('let selection = explicitRes.selection', "let selection = (opts && opts.hintBackendId && registry && typeof registry.has === 'function' && registry.has(opts.hintBackendId)) ? { backendId: opts.hintBackendId, source: 'explicit', ref: null } : explicitRes.selection")
    ok(readdedText !== srcText, '反证 A 的改法能在真源里落地（上报优先级加回来）');
    const { detectExplicit } = await import(new URL('../src/host/tracker/detection/explicitDetector.js', import.meta.url).href);
    const { canonicalWorkspaceKey } = await import(new URL('../src/host/workspaceKey.js', import.meta.url).href);
    const brokenBody = readdedText
      .replace(/^import[^\n]*\n/gm, '')
      .replace(/^export default createDetectionService[^\n]*\n?/gm, '')
      .replace(/^[ \t]*export[ \t]+/gm, '');
    const brokenCreate = compileFn(['detectExplicit', 'canonicalWorkspaceKey'], brokenBody + '\n;return createDetectionService')(detectExplicit, canonicalWorkspaceKey);
    ok(typeof brokenCreate === 'function', '改坏的那一份真的求值出来了（不是只比字符串）');
    const brokenRes = await brokenCreate({ registry: reg, getPlatform: async () => emptyPlat, getFs: () => emptyPlat.fs, getTimers: () => ({ setTimeout, clearTimeout }), workspaceStore: createWorkspaceStore({ ttl: 30000 }), skillProbe: async () => ({ ok: true, missing: [], probes: {} }) }).detect({ cwd: '/tmp/empty-broken' }, { hintBackendId: 'markdown' });
    ok(brokenRes.selection && brokenRes.selection.backendId === 'markdown', '反证 A 成立：上报优先级加回来之后，空目录 + hint 又变出 markdown（实得 ' + JSON.stringify(brokenRes.selection && brokenRes.selection.backendId) + '）—— 说明 A 组量的就是上报不再参与');
    const honestRes = await mkSvc(emptyPlat).detect({ cwd: '/tmp/empty-honest' }, { hintBackendId: 'markdown' });
    ok(!honestRes.selection || honestRes.selection.backendId === null, '（对照）真源里空目录 + hint 仍是未知');
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
  console.log('-- C 其余两条不变的口径（上报不再参与之后） --');
  {
    const noFs = await mkSvc(noFsPlat).detect({ cwd: '/tmp/empty' }, { hintBackendId: 'markdown' });
    ok(!noFs.selection || noFs.selection.backendId === null, '平台没有 fs 时上报仍不参与，如实未知（实得 ' + JSON.stringify(noFs.selection && noFs.selection.backendId) + '）');
    const unreg = await mkSvc(emptyPlat).detect({ cwd: '/tmp/empty' }, { hintBackendId: 'unknown' });
    ok(unreg.selection && unreg.selection.backendId === null && unreg.selection.source === 'fallback', '注册表不认的 hint -> fallback（不许答一个没有模块的后端）');
  }

  console.log('');
  console.log('-- D 缓存那一路：空工作区上缓存不作数，答的仍是重算出来的结果 --');
  {
    const ws = createWorkspaceStore({ ttl: 30000 });
    const svc = mkSvc(emptyPlat, { workspaceStore: ws });
    const r1 = await svc.detect({ cwd: '/tmp/cached' }, { hintBackendId: 'markdown' });
    ok(!r1.selection || r1.selection.backendId === null, '空目录 + hint：上报不参与，第一次就是未知');
    const r2 = await svc.detect({ cwd: '/tmp/cached' }, { hintBackendId: 'markdown' });
    ok(!r2.selection || r2.selection.backendId === null, '第二次（不带 force、会走缓存那一路）仍然是同一个未知答复');
    // 工作区从「非空」变「空」：缓存里那条不许直接端出去，重算之后按当下的口径回答
    let plat = nonEmptyPlat;
    const ws2 = createWorkspaceStore({ ttl: 30000 });
    const memD = mkMemory('markdown');
    const baseD = { registry: reg, getTimers: () => ({ setTimeout, clearTimeout }), workspaceStore: ws2, skillProbe: async () => ({ ok: true, missing: [], probes: {} }), getChoiceStore: memD, decideBackend: outletDecideBackend };
    const svc2 = createDetectionService(Object.assign({ getPlatform: async () => plat, getFs: () => plat.fs }, baseD));
    const a1 = await svc2.detect({ cwd: '/tmp/cache-invalidate' }, {});
    ok(a1.selection && a1.selection.backendId === 'markdown', '先是非空目录：记忆回答 markdown');
    plat = emptyPlat;
    const svc3 = createDetectionService(Object.assign({ getPlatform: async () => plat, getFs: () => plat.fs }, baseD));
    const a2 = await svc3.detect({ cwd: '/tmp/cache-invalidate' }, {});
    ok(!a2.selection || a2.selection.backendId === null, '目录清空之后：缓存那条被判过期、重算，记忆已过期，如实未知（不是缓存里的旧值）');
  }
}

await run();
console.log('\n#297 verify: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
