// verify-issue297.js —— 「工作区已空」这条失效维度（#297）。
//
// 这条维度今天管两件事：
//   ① 记忆里的选择（宿主侧那份 H）：工作区已空 → 那条记录视为过期、不拿它回答
//      （判空逻辑在探测服务这一处，出口只收一个过期标记，不另写一份）；
//   ② 缓存里那条选择：工作区已空 → 这份缓存不作数，重算。
// 2026-09-21 的收窄（#669 第 1 件：空目录里当场报上来的 hint 要算数）已随 #1003 老路径删除而退役 ——
//   上报一律忽略，空目录 + hint 如实未知；下面 A/C/D 三组按退役后改准，B 组（记忆过期）原样保留。
import { createRegistry } from '../src/tracker/registry/core.ts'; // V1 #461：registry.js 已拆为三块
import { createDetectionService } from '../src/tracker/detection/detectionService.ts';
import { decideBackend as outletDecideBackend, selectionFromOutlet as outletSelectionFromOutlet } from '../src/tracker/detection/backendDecision.ts';
try { outletDecideBackend.selectionFromOutlet = outletSelectionFromOutlet } catch (eAttachOutlet297) {}
import { createWorkspaceStore } from '../src/tracker/detection/workspaceStore.ts';

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
    // 反证（#1169）：这一段原来把探测服务的源码读出来、把「上报优先」加回去、剥掉 import 之后当场求值
    //   —— 那样这份服务就永远写不了类型标注（#1169 修的就是这件事）。裁决顺序现在抽在
    //   src/tracker/detection/selection-precedence.ts，反证改成直接问那条规则，落在
    //   tests/verify-669-choice-precedence.js 的 E 组；本组只留行为对照。
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
    // 对照（#1003 契约 2026-10-12）：同样这份记忆、工作区非空，判定也不再拿它回答 —— 记忆只用来生成一次文件
    const memNonEmpty = await mkSvc(nonEmptyPlat, { getChoiceStore: mkMemory('markdown') }).detect({ cwd: '/tmp/nonempty-mem' }, {});
    ok(!memNonEmpty.selection || memNonEmpty.selection.backendId === null, '对照：同样这份记忆、工作区非空 -> 判定同样不拿它回答（实得 ' + JSON.stringify(memNonEmpty.selection && memNonEmpty.selection.backendId) + '）');
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
    // 工作区从「非空」变「空」：缓存里那条不许直接端出去，要重算。
    //   #1003 契约（2026-10-12）：记忆不再参与判定，所以这里改用「数自动识别被调了几次」来观测缓存有没有被作废。
    //   注意预期：重算之后的答案仍是 github —— 自动识别不随目录里有没有文件变，所以这一条量的是「重算发生了」，不是答案变了。
    let selectCalls = 0;
    const regCount = {
      has: (id) => id === 'github' || id === 'markdown',
      get: () => ({ id: 'github', preflight: async () => ({ ok: true }) }),
      describe: () => ({ backend: 'github', refId: '', name: '', url: '' }),
      select: async () => { selectCalls += 1; return { backendId: 'github', source: 'matches' } },
    };
    let plat = nonEmptyPlat;
    const ws2 = createWorkspaceStore({ ttl: 30000 });
    const baseD = { registry: regCount, getTimers: () => ({ setTimeout, clearTimeout }), workspaceStore: ws2, skillProbe: async () => ({ ok: true, missing: [], probes: {} }), decideBackend: outletDecideBackend };
    const svc2 = createDetectionService(Object.assign({ getPlatform: async () => plat, getFs: () => plat.fs }, baseD));
    const a1 = await svc2.detect({ cwd: '/tmp/cache-invalidate' }, {});
    ok(a1.selection && a1.selection.backendId === 'github' && selectCalls === 1, '先是非空目录：自动识别给 github，这一条进了缓存（实得 ' + JSON.stringify(a1.selection && a1.selection.backendId) + '，识别跑了 ' + selectCalls + ' 次）');
    const a1b = await svc2.detect({ cwd: '/tmp/cache-invalidate' }, {});
    ok(a1b.selection && a1b.selection.backendId === 'github' && selectCalls === 1, '同一个工作区再问一次走缓存：识别没有重跑（实得跑了 ' + selectCalls + ' 次）');
    plat = emptyPlat;
    const svc3 = createDetectionService(Object.assign({ getPlatform: async () => plat, getFs: () => plat.fs }, baseD));
    const a2 = await svc3.detect({ cwd: '/tmp/cache-invalidate' }, {});
    ok(selectCalls === 2, '目录清空之后：缓存那条被判过期、重算了一次（识别累计跑了 ' + selectCalls + ' 次，不是拿缓存里的旧答案）');
    ok(a2.selection && a2.selection.backendId === 'github', '重算之后的答案仍是 github（自动识别不随目录空不空变，这一条只证明重算发生了）—— 实得 ' + JSON.stringify(a2.selection));
  }
}

await run();
console.log('\n#297 verify: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
