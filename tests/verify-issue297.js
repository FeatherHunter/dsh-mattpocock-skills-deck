import { createRegistry } from '../src/host/tracker/registry.js';
import { createDetectionService } from '../src/host/tracker/detection/detectionService.js';
import { createWorkspaceStore } from '../src/host/tracker/detection/workspaceStore.js';

let passed=0, failed=0;
function ok(cond, msg){ if(cond){ console.log('  PASS '+msg); passed++; } else { console.log('  FAIL '+msg); failed++; } }

console.log('== #297 空目录失效维度 ==');
// Mock regs
const reg = createRegistry({}, { matchesTimeout: 30 });
reg.register({ id:'markdown', label:'Markdown', create: () => ({ id:'markdown', preflight: async()=>({ok:true}) }), matches: async()=>false });
reg.register({ id:'github', label:'GitHub', create: () => ({ id:'github', preflight: async()=>({ok:true}) }), matches: async()=>false });

const emptyPlat = {
  fs: { resolve: async(p)=>p, readText: async()=>{ throw new Error('no file'); }, lstat: async()=>null, listDir: async()=>[] },
  path: { join: (...a)=>a.join('/'), sep:'/' }, resolveExecutable: async()=>null, getHome: async()=>null, env:{get:()=>undefined,has:()=>false}
};
const nonEmptyPlat = {
  fs: { resolve: async(p)=>p, readText: async()=>{ throw new Error('no file'); }, lstat: async()=>null, listDir: async()=>['README.md'] },
  path: { join: (...a)=>a.join('/'), sep:'/' }, resolveExecutable: async()=>null, getHome: async()=>null, env:{get:()=>undefined,has:()=>false}
};
const ignorablePlat = {
  fs: { resolve: async(p)=>p, readText: async()=>{ throw new Error('no file'); }, lstat: async()=>null, listDir: async()=>['.DS_Store'] },
  path: { join: (...a)=>a.join('/'), sep:'/' }, resolveExecutable: async()=>null, getHome: async()=>null, env:{get:()=>undefined,has:()=>false}
};
const noFsPlat = { path: { join: (...a)=>a.join('/'), sep:'/' }, resolveExecutable: async()=>null, getHome: async()=>null, env:{get:()=>undefined,has:()=>false} };

async function run() {
  // 1. 空目录 + hint -> explicit null (stale)
  {
    const svc = createDetectionService({ registry: reg, getPlatform: async()=>emptyPlat, getFs: ()=>emptyPlat.fs, getTimers: ()=>({setTimeout, clearTimeout}), workspaceStore: createWorkspaceStore({ttl:30000}), skillProbe: async()=>({ok:true, missing:[], probes:{}}) });
    const res = await svc.detect({ cwd: '/tmp/empty' }, { hintBackendId: 'markdown' });
    ok(res.selection.backendId===null && res.selection.source==='explicit', '空目录 + hint -> explicit null (stale)');
  }
  // 2. 非空目录 + hint -> keep hint
  {
    const svc = createDetectionService({ registry: reg, getPlatform: async()=>nonEmptyPlat, getFs: ()=>nonEmptyPlat.fs, getTimers: ()=>({setTimeout, clearTimeout}), workspaceStore: createWorkspaceStore({ttl:30000}), skillProbe: async()=>({ok:true, missing:[], probes:{}}) });
    const res = await svc.detect({ cwd: '/tmp/nonempty' }, { hintBackendId: 'markdown' });
    ok(res.selection.backendId==='markdown' && res.selection.source==='explicit', '非空目录 + hint -> keep hint');
  }
  // 3. 仅 ignorable 文件的空目录 -> stale
  {
    const svc = createDetectionService({ registry: reg, getPlatform: async()=>ignorablePlat, getFs: ()=>ignorablePlat.fs, getTimers: ()=>({setTimeout, clearTimeout}), workspaceStore: createWorkspaceStore({ttl:30000}), skillProbe: async()=>({ok:true, missing:[], probes:{}}) });
    const res = await svc.detect({ cwd: '/tmp/ignorable' }, { hintBackendId: 'markdown' });
    ok(res.selection.backendId===null && res.selection.source==='explicit', '仅 .DS_Store 视为空 -> stale');
  }
  // 4. 空目录无 hint -> fallback
  {
    const svc = createDetectionService({ registry: reg, getPlatform: async()=>emptyPlat, getFs: ()=>emptyPlat.fs, getTimers: ()=>({setTimeout, clearTimeout}), workspaceStore: createWorkspaceStore({ttl:30000}), skillProbe: async()=>({ok:true, missing:[], probes:{}}) });
    const res = await svc.detect({ cwd: '/tmp/empty2' }, {});
    ok(res.selection.backendId===null && res.selection.source==='fallback', '空目录无 hint -> fallback');
  }
  // 5. 平台无 fs -> 保守不 stale
  {
    const svc = createDetectionService({ registry: reg, getPlatform: async()=>noFsPlat, getFs: ()=>null, getTimers: ()=>({setTimeout, clearTimeout}), workspaceStore: createWorkspaceStore({ttl:30000}), skillProbe: async()=>({ok:true, missing:[], probes:{}}) });
    const res = await svc.detect({ cwd: '/tmp/empty' }, { hintBackendId: 'markdown' });
    ok(res.selection.backendId==='markdown', '无 fs 时保守不 stale -> keep hint');
  }
  // 6. 缓存：第一次空目录 stale 后，第二次不带 force 应直接返回 explicit null 缓存
  {
    const ws = createWorkspaceStore({ttl:30000});
    const svc = createDetectionService({ registry: reg, getPlatform: async()=>emptyPlat, getFs: ()=>emptyPlat.fs, getTimers: ()=>({setTimeout, clearTimeout}), workspaceStore: ws, skillProbe: async()=>({ok:true, missing:[], probes:{}}) });
    const r1 = await svc.detect({ cwd: '/tmp/cached' }, { hintBackendId: 'markdown' });
    ok(r1.selection.backendId===null, '首次空目录 -> stale');
    const r2 = await svc.detect({ cwd: '/tmp/cached' }, { hintBackendId: 'markdown' });
    ok(r2.selection.backendId===null && r2.selection.source==='explicit', '缓存命中仍为 stale explicit null');
  }
  // 7. 缓存：非空目录 hint 缓存后，删空变 stale 应失效缓存
  {
    let currentPlat = nonEmptyPlat;
    const ws = createWorkspaceStore({ttl:30000});
    const svc = createDetectionService({ registry: reg, getPlatform: async()=>currentPlat, getFs: ()=>currentPlat.fs, getTimers: ()=>({setTimeout, clearTimeout}), workspaceStore: ws, skillProbe: async()=>({ok:true, missing:[], probes:{}}) });
    const r1 = await svc.detect({ cwd: '/tmp/cache-invalidate' }, { hintBackendId: 'markdown' });
    ok(r1.selection.backendId==='markdown', '首次非空 -> hint');
    // 模拟删除后变空，切平台
    currentPlat = emptyPlat;
    const svc2 = createDetectionService({ registry: reg, getPlatform: async()=>currentPlat, getFs: ()=>currentPlat.fs, getTimers: ()=>({setTimeout, clearTimeout}), workspaceStore: ws, skillProbe: async()=>({ok:true, missing:[], probes:{}}) });
    const r2 = await svc2.detect({ cwd: '/tmp/cache-invalidate' }, { hintBackendId: 'markdown' });
    ok(r2.selection.backendId===null && r2.selection.source==='explicit', '缓存失效：非空变空后应 stale');
  }
  // 8. 未注册 hint -> 忽略，不 stale
  {
    const svc = createDetectionService({ registry: reg, getPlatform: async()=>emptyPlat, getFs: ()=>emptyPlat.fs, getTimers: ()=>({setTimeout, clearTimeout}), workspaceStore: createWorkspaceStore({ttl:30000}), skillProbe: async()=>({ok:true, missing:[], probes:{}}) });
    const res = await svc.detect({ cwd: '/tmp/empty' }, { hintBackendId: 'unknown' });
    ok(res.selection.backendId===null && res.selection.source==='fallback', '未注册 hint -> fallback, 不 stale explicit');
  }
}

await run();
console.log('\n#297 verify: '+passed+' passed, '+failed+' failed');
if(failed) process.exit(1);
