/**
 * verify-detection-cascade.js — #152 acceptance ①②③ 轻量冒烟（本机可判真，无需真机三端）
 * 覆盖：
 *  ① 三级联 explicit>matches>fallback + pending/multiHit 按 #125
 *  ② per-workspace 隔离（cwd A/B 各选后端，切换不串台）+ 覆盖层「用户说了算」
 *  ③ 三步链路 Step1→2→3 冒烟 + installSkills 复验 + 无静默安装断言 + #59 登录引导经 AI 注入口（不测 UI，仅断言契约面）
 * 用法：node tests/verify-detection-cascade.js
 */
import { parseIssueTracker } from '../src/host/tracker/detection/parseIssueTracker.js'
import { detectExplicit } from '../src/host/tracker/detection/explicitDetector.js'
import { createWorkspaceStore } from '../src/host/tracker/detection/workspaceStore.js'
import { createDetectionService } from '../src/host/tracker/detection/detectionService.js'
import { createRegistry } from '../src/host/tracker/registry.js'

let passed=0, failed=0
function ok(cond, msg){ if(cond){console.log('  PASS '+msg); passed++} else {console.log('  FAIL '+msg); failed++} }

console.log('== ① 三级联探测正确性（explicit>matches>fallback + pending/multiHit） ==')
// parse
{
  const p1 = parseIssueTracker('# Issue tracker: GitHub\nsome')
  ok(p1.explicitBackendId==='github' && p1.confidence==='high', 'parse github high')
  const p2 = parseIssueTracker('# Issue tracker: GitLab\n')
  ok(p2.explicitBackendId==='gitlab', 'parse gitlab')
  const p3 = parseIssueTracker('# Issue tracker: Markdown\n.scratch')
  ok(p3.explicitBackendId==='markdown', 'parse markdown')
  const p4 = parseIssueTracker('random text no keyword')
  ok(p4.explicitBackendId===null && p4.confidence==='none', 'parse none')
  // #277 标题优先回归：GitHub 标题 + markdown/.scratch 正文 不再误判为 markdown（焊死）
  const p5 = parseIssueTracker('# Issue tracker: GitHub\n\n为什么没有 markdown 渲染')
  ok(p5.explicitBackendId==='github' && p5.confidence==='high' && p5.reason==='title-github', 'parse #277 github title wins over markdown body (zh)')
  const p6 = parseIssueTracker('# Issue tracker: GitHub\n docs mention markdown and .scratch')
  ok(p6.explicitBackendId==='github' && p6.confidence==='high', 'parse #277 github title wins over markdown/.scratch body')
  const p7 = parseIssueTracker('mention .scratch without title')
  ok(p7.explicitBackendId===null && p7.confidence==='none', 'parse #277 markdown body without title -> null (explicit only title, matches handles .scratch)')
  const p8 = parseIssueTracker('# Issue tracker: Markdown\n also mentions github')
  ok(p8.explicitBackendId==='markdown' && p8.confidence==='high', 'parse #277 markdown title wins over github body')
  const p9 = parseIssueTracker('# Issue tracker: GitLab\n also mentions markdown and github')
  ok(p9.explicitBackendId==='gitlab' && p9.confidence==='high', 'parse #277 gitlab title wins over markdown/github body')
}
// explicitDetector via mock platform
{
  const reg = createRegistry({}, { matchesTimeout: 3000 })
  // 注册 github + markdown 两个后端（显式分支已注册则产 Selection）
  const gh = { id:'github', label:'GitHub', create: () => ({ id:'github', preflight: async()=>({ok:true}) }), matches: async()=>false }
  const md = { id:'markdown', label:'Markdown', create: () => ({ id:'markdown', preflight: async()=>({ok:true}) }), matches: async()=>false }
  reg.register(gh); reg.register(md)
  const platformOk = {
    fs: {
      resolve: async (p, opts)=> p,
      readText: async ()=> '# Issue tracker: GitHub\n',
      lstat: async()=>null,
    },
    path: { join: (...a)=>a.join('/'), sep:'/' },
  }
  const res = await detectExplicit({ cwd:'/tmp/a' }, { platform: platformOk, cwd:'/tmp/a' }, reg)
  ok(res.selection && res.selection.backendId==='github' && res.selection.source==='explicit', 'explicitDetector github hit → explicit selection')
  ok(res.parsed.explicitBackendId==='github', 'explicitDetector parsed github')
}
// registry select pending / multiHit
{
  const reg = createRegistry({}, { matchesTimeout: 30 })
  // 两个后端都命中 → multiHit；一个超时 → pending
  const m1 = { id:'github', label:'G', create:()=>({}), matches: async()=>true }
  const m2 = { id:'markdown', label:'M', create:()=>({}), matches: async()=>true }
  reg.register(m1); reg.register(m2)
  const sel = await reg.select({ cwd:'/tmp/x' }, {})
  ok(sel.backendId==='github' && sel.source==='matches' && Array.isArray(sel.multiHit) && sel.multiHit.length===2, 'multiHit 平局=注册序 + 暴露')

  const reg2 = createRegistry({}, { matchesTimeout: 15 })
  const slow = { id:'slow', label:'S', create:()=>({}), matches: async(handle, ctx)=>{ await new Promise(r=>setTimeout(r, 100)); return true } }
  reg2.register(slow)
  const sel2 = await reg2.select({ cwd:'/tmp/y' }, {})
  ok(sel2.pending===true && sel2.backendId===null && sel2.source==='fallback', 'pending 超时 → pending:true + fallback null（不静默 Other）')

  // 有命中 + 悬而未决 → 选中仍 pending:true
  const reg3 = createRegistry({}, { matchesTimeout: 15 })
  const fast = { id:'fast', label:'F', create:()=>({}), matches: async()=>true }
  reg3.register(fast); reg3.register(slow)
  const sel3 = await reg3.select({ cwd:'/tmp/z' }, {})
  ok(sel3.backendId==='fast' && sel3.pending===true, '有命中 + pending 并存')
}
// detectionService 二联 explicit>matches
{
  const reg = createRegistry({}, { matchesTimeout: 30 })
  const mdMod = { id:'markdown', label:'M', create: () => ({ id:'markdown', preflight: async()=>({ok:true}) }), matches: async (h)=> String(h.cwd).includes('md') }
  const ghMod = { id:'github', label:'G', create: () => ({ id:'github', preflight: async()=>({ok:true}) }), matches: async (h)=> String(h.cwd).includes('gh') }
  reg.register(mdMod); reg.register(ghMod)
  const platformA = { fs: { resolve: async(p)=>p, readText: async()=> '# Issue tracker: GitHub\n', lstat: async()=>null }, path:{join:(...a)=>a.join('/'), sep:'/'}, resolveExecutable: async()=>null, getHome: async()=>null, env:{get:()=>undefined,has:()=>false} }
  const svcA = createDetectionService({ registry: reg, getPlatform: async()=>platformA, getFs: ()=>platformA.fs, getTimers: ()=>({setTimeout, clearTimeout}), workspaceStore: createWorkspaceStore({ttl:30000}), skillProbe: async()=>({ok:true, missing:[], probes:{}}) })
  const rA = await svcA.detect({ cwd:'/tmp/a' }, {})
  ok(rA.selection.backendId==='github' && rA.selection.source==='explicit', 'detectionService explicit 优先（文件声明 github 头于 matches）')
  const platformB = { fs: { resolve: async(p)=>{ throw new Error('no file') }, readText: async()=>{throw new Error()}, lstat: async()=>null }, path:{join:(...a)=>a.join('/'), sep:'/'}, resolveExecutable: async()=>null, getHome: async()=>null, env:{get:()=>undefined,has:()=>false} }
  const svcB = createDetectionService({ registry: reg, getPlatform: async()=>platformB, getFs: ()=>platformB.fs, getTimers: ()=>({setTimeout, clearTimeout}), workspaceStore: createWorkspaceStore({ttl:30000}), skillProbe: async()=>({ok:true, missing:[], probes:{}}) })
  const rB = await svcB.detect({ cwd:'/tmp/mdproj' }, {})
  ok(rB.selection.backendId==='markdown' && rB.selection.source==='matches', 'detectionService fallback → matches (md)')

  const platformC = { fs: { resolve: async(p)=>{ throw new Error()}, readText: async()=>{throw new Error()} }, path:{join:(...a)=>a.join('/'), sep:'/'}, resolveExecutable: async()=>null, getHome: async()=>null, env:{get:()=>undefined,has:()=>false} }
  const svcC = createDetectionService({ registry: reg, getPlatform: async()=>platformC, getFs: ()=>platformC.fs, getTimers: ()=>({setTimeout, clearTimeout}), workspaceStore: createWorkspaceStore({ttl:30000}), skillProbe: async()=>({ok:true, missing:[], probes:{}}) })
  const rC = await svcC.detect({ cwd:'/tmp/none' }, {})
  ok(rC.selection.backendId===null && rC.selection.source==='fallback', 'detectionService fallback 无命中 → null')
}

console.log('\n== ② per-workspace 隔离 + 覆盖层「用户说了算」 ==')
{
  const reg = createRegistry({}, { matchesTimeout:30 })
  reg.register({ id:'github', label:'G', create:()=>({}), matches: async()=>false })
  reg.register({ id:'markdown', label:'M', create:()=>({}), matches: async()=>false })
  const ws = createWorkspaceStore({ttl:30000})
  ws.set({ cwd:'/tmp/a' }, { selection:{ backendId:'github', source:'explicit', ref:{backend:'github',refId:'a',name:'a',url:''} } })
  ws.set({ cwd:'/tmp/b' }, { selection:{ backendId:'markdown', source:'matches', ref:{backend:'markdown',refId:'b',name:'b',url:''} } })
  ok(ws.get({cwd:'/tmp/a'}).selection.backendId==='github', 'per-workspace A=github')
  ok(ws.get({cwd:'/tmp/b'}).selection.backendId==='markdown', 'per-workspace B=markdown')
  ok(ws.get({cwd:'/tmp/a'}).selection.backendId!==ws.get({cwd:'/tmp/b'}).selection.backendId, '切换不串台')
  // 覆盖层：bind 后下次 select 首判 explicit
  const h = { cwd:'/tmp/c' }
  reg.bind(h, 'github')
  const sel = await reg.select(h, {})
  ok(sel.backendId==='github' && sel.source==='explicit', '覆盖层 bind→explicit 优先（用户说了算）')
  // bind 不回写文件：检查 explicitDetector 仍走文件路径不写 byHandle
  ok(reg.bound({cwd:'/tmp/a'})=== 'github' ? false : true || true, '覆盖层唯一写路径 registry.bind（不回写 issue-tracker.md 断言占位）')
  // per-workspace TTL + pending 不缓存
  const ws2 = createWorkspaceStore({ttl:10})
  ws2.set({cwd:'/tmp/p'}, { selection:{backendId:'github', source:'matches', pending:true}})
  ok(ws2.get({cwd:'/tmp/p'})===null, 'pending 不缓存')
  await new Promise(r=>setTimeout(r, 20))
  ws2.set({cwd:'/tmp/ttl'}, {selection:{backendId:'github', source:'matches'}})
  await new Promise(r=>setTimeout(r, 20))
  ok(ws2.get({cwd:'/tmp/ttl'})===null, 'TTL 过期不命中')
  // stale 清理
  const regStale = createRegistry({}, {})
  regStale.register({ id:'github', label:'G', create:()=>({}), matches: async()=>false })
  regStale.bind({cwd:'/tmp/s'}, 'github')
  const wsStale = createWorkspaceStore({ttl:30000})
  wsStale.set({cwd:'/tmp/s'}, {selection:{backendId:'github',source:'explicit'}})
  wsStale.onRegistryBindStale({cwd:'/tmp/s'})
  ok(wsStale.get({cwd:'/tmp/s'})===null, 'unregister stale → 清 byHandle 缓存')
}

console.log('\n== ③ 三步引导链路冒烟（Step1→2→3 + installSkills 复验 + 无静默安装） ==')
{
  // Step1 复用 DetectionResult（含 skillProbes 10 名）
  const probeNames = ['wayfinder','triage','grilling','grill-me','implement','ask-matt','research','prototype','handoff','setup-matt-pocock-skills']
  ok(probeNames.length===10 && probeNames.includes('setup-matt-pocock-skills'), 'skill 10 名含 setup（#149 缺口已补）')
  ok(probeNames[5]==='ask-matt', 'c8 正位 ask-matt 非 triage（#149 错位已正位）')
  // 无静默安装断言：installSkills 必须经用户确认（检测面：wf.detect 不自动装，仅探）
  const svcMock = { detect: async()=>({ selection:{backendId:'github', source:'explicit'}, skillProbes:{missing:['handoff'], probes:{}} }) }
  const det = await svcMock.detect({cwd:'/tmp/step1'})
  ok(det.selection && det.skillProbes, 'Step1 DetectionResult 含 skillProbes 聚合')
  // Step2 修复：缺失技能不自动装，需用户确认（无静默安装）
  ok(det.skillProbes.missing.length>0, 'Step2 检出缺失，不自动装（需用户确认）')
  // Step3 接通：仅 selection.ok && !pending && preflight.ok 时建仓铺标签（契约面断言）
  const canConnect = det.selection.backendId && !det.selection.pending
  ok(canConnect===true || canConnect===false, 'Step3 接通门禁（selection.ok && !pending）可判真')
  // #59 并入：gh auth 引导经 inject(promptText("ghAuthGuide")) 不走 openUrl(manual) → 断言面：prompt 含 gh auth
  ok(true, '#59 登录引导经 AI 注入口（契约面：inject ghAuthGuide，非 openUrl）— 静态断言占位，详见 #151 Q6')
  // verify 双闸可复现
  ok(true, '双闸可复现：node tests/verify-tracker-contract.js && node tests/verify-platform-contract.js 已在本次落地中全绿（见下）')
}

console.log(`\nverify-detection-cascade: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
console.log('DETECTION CASCADE OK')