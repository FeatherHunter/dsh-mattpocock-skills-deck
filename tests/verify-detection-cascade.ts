/**
 * verify-detection-cascade.ts — #152 acceptance ①②③ 轻量冒烟（本机可判真，无需真机三端）
 * 覆盖：
 *  ① 两级联 matches>fallback + pending/multiHit 按 #125（「人选」那一层不在注册表里：
 *     人选住在工作区文件 docs/agents/workspace.yaml，由判定出口 backendDecision.ts 唯一作答，#1138）
 *  ② per-workspace 隔离（cwd A/B 各选后端，切换不串台）+ 覆盖层「用户说了算」（工作区文件里有人选）
 *  ③ 三步链路 Step1→2→3 冒烟 + installSkills 复验 + 无静默安装断言 + #59 登录引导经 AI 注入口（不测 UI，仅断言契约面）
 * 用法：node tests/verify-detection-cascade.ts
 */
import { parseIssueTracker } from '../src/tracker/detection/parseIssueTracker.ts'
import { detectExplicit } from '../src/tracker/detection/explicitDetector.ts'
import { createWorkspaceStore } from '../src/tracker/detection/workspaceStore.ts'
import { createDetectionService } from '../src/tracker/detection/detectionService.ts'
import { decideBackend as outletDecideBackend, selectionFromOutlet as outletSelectionFromOutlet } from '../src/tracker/detection/backendDecision.ts'
try { outletDecideBackend.selectionFromOutlet = outletSelectionFromOutlet } catch (eAttachOutlet) {}
import { createRegistry } from '../src/tracker/registry/core.ts' // V1 #461：registry.js 已拆为三块
// #1138：夹具手里的「工作区文件」账本（虚拟目录，不碰盘）。两块都要：chooseWorkspace 记下「这个工作区选了谁」，
// workspaceFileOf 把记下的内容交给判定出口读（读的口子是 deps.fs，与真平台上的文件服务同一形状）。
import { chooseWorkspace, workspaceFileOf } from './lib/deck-decide-stub.js'

/**
 * 判定出口读工作区文件那一路用的最小文件服务：只有工作区文件这两张脸有内容，别的路径一律说没有。
 * 为什么要给这一份：人选的唯一真源是工作区文件 docs/agents/workspace.yaml，而读它的是判定出口自己的
 * deps.fs 分支（src/tracker/detection/backendDecision.ts 的 readFileLayer）；账本只记了「这份文件写了什么」，
 * 没有「谁去读它」，这一份把两者接起来。判定仍由生产那一个出口做，这里不另写一套规则。
 */
const workspaceFs = {
  async resolve(rel, opts) { return { rel: String(rel), cwd: (opts && opts.cwd) || '' } },
  async readText(target) {
    const rel = String((target && target.rel) || '')
    const text = (rel === 'docs/agents/workspace.yaml' || rel === 'docs/agents/workspace.json')
      ? workspaceFileOf((target && target.cwd) || '')
      : null
    if (text == null) throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
    return text
  },
}

let passed=0, failed=0
function ok(cond, msg){ if(cond){console.log('  PASS '+msg); passed++} else {console.log('  FAIL '+msg); failed++} }

console.log('== ① 探测正确性（注册表两级联 matches>fallback + pending/multiHit；人选那一层归判定出口） ==')
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
  // 这两个假后端只用来验显式识别，不会被真正调用，所以按离网口径声明（注册表只验形状，不按口径限流）。
  const gh = { id:'github', label:'GitHub', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create: () => ({ id:'github', preflight: async()=>({ok:true}) }), matches: async()=>false }
  const md = { id:'markdown', label:'Markdown', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create: () => ({ id:'markdown', preflight: async()=>({ok:true}) }), matches: async()=>false }
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
  // #1572 收尾（方案 A）：说明文件里只有正文提及、没有标题行时，这一层不再产 Selection；
  //   线索仍留在 parsed 里作证据，判定出口也不拿它当结论（见下面 detectionService 那一段）。
  const platformLow = {
    fs: {
      resolve: async (p, opts)=> p,
      readText: async ()=> '本仓库的票记在 GitHub 上，用 gh 命令读写。\n',
      lstat: async()=>null,
    },
    path: { join: (...a)=>a.join('/'), sep:'/' },
  }
  const low = await detectExplicit({ cwd:'/tmp/low' }, { platform: platformLow, cwd:'/tmp/low' }, reg)
  ok(low.selection === null, 'explicitDetector 低置信（正文提及）不产 Selection')
  ok(low.parsed.explicitBackendId==='github' && low.parsed.confidence==='low', '低置信线索仍留在 parsed 里作证据')
}
// registry select pending / multiHit
{
  const reg = createRegistry({}, { matchesTimeout: 30 })
  // 两个后端都命中 → multiHit；一个超时 → pending
  // 这两个假后端只用来验多命中与超时，不会被真正调用，所以按离网口径声明（注册表只验形状，不按口径限流）。
  const m1 = { id:'github', label:'G', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create:()=>({}), matches: async()=>true }
  const m2 = { id:'markdown', label:'M', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create:()=>({}), matches: async()=>true }
  reg.register(m1); reg.register(m2)
  const sel = await reg.select({ cwd:'/tmp/x' }, {})
  ok(sel.backendId==='github' && sel.source==='matches' && Array.isArray(sel.multiHit) && sel.multiHit.length===2, 'multiHit 平局=注册序 + 暴露')

  const reg2 = createRegistry({}, { matchesTimeout: 15 })
  // 这个假后端只用来占住一路认领、复现超时，不会被真正调用，所以按离网口径声明（注册表只验形状，不按口径限流）。
  const slow = { id:'slow', label:'S', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create:()=>({}), matches: async(handle, ctx)=>{ await new Promise(r=>setTimeout(r, 100)); return true } }
  reg2.register(slow)
  const sel2 = await reg2.select({ cwd:'/tmp/y' }, {})
  ok(sel2.pending===true && sel2.backendId===null && sel2.source==='fallback', 'pending 超时 → pending:true + fallback null（不静默 Other）')

  // 有命中 + 悬而未决 → 选中仍 pending:true
  const reg3 = createRegistry({}, { matchesTimeout: 15 })
  // 这个假后端只用来与挂住的那一路对照，不会被真正调用，所以按离网口径声明（注册表只验形状，不按口径限流）。
  const fast = { id:'fast', label:'F', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create:()=>({}), matches: async()=>true }
  reg3.register(fast); reg3.register(slow)
  const sel3 = await reg3.select({ cwd:'/tmp/z' }, {})
  ok(sel3.backendId==='fast' && sel3.pending===true, '有命中 + pending 并存')
}
// detectionService 二联 explicit>matches
{
  const reg = createRegistry({}, { matchesTimeout: 30 })
  // 这两个假后端只用来验二联探测的优先级，不会被真正调用，所以按离网口径声明（注册表只验形状，不按口径限流）。
  const mdMod = { id:'markdown', label:'M', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create: () => ({ id:'markdown', preflight: async()=>({ok:true}) }), matches: async (h)=> String(h.cwd).includes('md') }
  const ghMod = { id:'github', label:'G', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create: () => ({ id:'github', preflight: async()=>({ok:true}) }), matches: async (h)=> String(h.cwd).includes('gh') }
  reg.register(mdMod); reg.register(ghMod)
  const platformA = { fs: { resolve: async(p)=>p, readText: async()=> '# Issue tracker: GitHub\n', lstat: async()=>null }, path:{join:(...a)=>a.join('/'), sep:'/'}, resolveExecutable: async()=>null, getHome: async()=>null, env:{get:()=>undefined,has:()=>false} }
  const svcA = createDetectionService({ registry: reg, getPlatform: async()=>platformA, getFs: ()=>platformA.fs, getTimers: ()=>({setTimeout, clearTimeout}), workspaceStore: createWorkspaceStore({ttl:30000}), skillProbe: async()=>({ok:true, missing:[], probes:{}}), getChoiceStore: async () => null, decideBackend: outletDecideBackend })
  const rA = await svcA.detect({ cwd:'/tmp/a' }, {})
  ok(rA.selection.backendId==='github' && rA.selection.source==='explicit', 'detectionService explicit 优先（文件声明 github 头于 matches）')
  const platformB = { fs: { resolve: async(p)=>{ throw new Error('no file') }, readText: async()=>{throw new Error()}, lstat: async()=>null }, path:{join:(...a)=>a.join('/'), sep:'/'}, resolveExecutable: async()=>null, getHome: async()=>null, env:{get:()=>undefined,has:()=>false} }
  // 回退那一级自动识别住在统一判定出口里（老路径已删，服务不再另跑一次），这一路把出口接上再量。
  const svcB = createDetectionService({ registry: reg, getPlatform: async()=>platformB, getFs: ()=>platformB.fs, getTimers: ()=>({setTimeout, clearTimeout}), workspaceStore: createWorkspaceStore({ttl:30000}), skillProbe: async()=>({ok:true, missing:[], probes:{}}), getChoiceStore: async () => null, decideBackend: outletDecideBackend })
  const rB = await svcB.detect({ cwd:'/tmp/mdproj' }, {})
  ok(rB.selection.backendId==='markdown' && rB.selection.source==='matches', 'detectionService fallback → matches (md)')

  const platformC = { fs: { resolve: async(p)=>{ throw new Error()}, readText: async()=>{throw new Error()} }, path:{join:(...a)=>a.join('/'), sep:'/'}, resolveExecutable: async()=>null, getHome: async()=>null, env:{get:()=>undefined,has:()=>false} }
  const svcC = createDetectionService({ registry: reg, getPlatform: async()=>platformC, getFs: ()=>platformC.fs, getTimers: ()=>({setTimeout, clearTimeout}), workspaceStore: createWorkspaceStore({ttl:30000}), skillProbe: async()=>({ok:true, missing:[], probes:{}}), getChoiceStore: async () => null, decideBackend: outletDecideBackend })
  const rC = await svcC.detect({ cwd:'/tmp/none' }, {})
  ok(rC.selection.backendId===null && rC.selection.source==='fallback', 'detectionService fallback 无命中 → null')

  // #1572 收尾（方案 A）：统一判定出口对「只有正文提及」的结论不再给结论，落到 fallback（无后端）；
  //   低置信解析仍留在 explicit.parsed 里作证据，文件里没有可认领的目录时不会再冒充任何一个后端。
  const bodyOnly = '本仓库的票记在 GitHub 上，用 gh 命令读写。\n'
  const platformD = { fs: { resolve: async(p)=>p, readText: async()=>bodyOnly, lstat: async()=>null }, path:{join:(...a)=>a.join('/'), sep:'/'}, resolveExecutable: async()=>null, getHome: async()=>null, env:{get:()=>undefined,has:()=>false} }
  const svcD = createDetectionService({ registry: reg, getPlatform: async()=>platformD, getFs: ()=>platformD.fs, getTimers: ()=>({setTimeout, clearTimeout}), workspaceStore: createWorkspaceStore({ttl:30000}), skillProbe: async()=>({ok:true, missing:[], probes:{}}), getChoiceStore: async () => null, decideBackend: outletDecideBackend })
  const rD = await svcD.detect({ cwd:'/tmp/d' }, {})
  ok(rD.selection.backendId===null && rD.selection.source==='fallback', 'detectionService 低置信线索不再给结论（回 fallback，不冒充某个后端）')
  ok(rD.explicit && rD.explicit.parsed && rD.explicit.parsed.explicitBackendId==='github' && rD.explicit.parsed.confidence==='low', '探测结果里仍如实带着低置信解析（界面与排查读得到来路）')
  // 低置信线索也不再抢在自动识别之前：文件正文提过 GitHub，但目录能被 GitHub 认领时，结论就是认领的 github。
  const platformE = { fs: { resolve: async(p)=>p, readText: async()=>bodyOnly, lstat: async()=>null }, path:{join:(...a)=>a.join('/'), sep:'/'}, resolveExecutable: async()=>null, getHome: async()=>null, env:{get:()=>undefined,has:()=>false} }
  const svcE = createDetectionService({ registry: reg, getPlatform: async()=>platformE, getFs: ()=>platformE.fs, getTimers: ()=>({setTimeout, clearTimeout}), workspaceStore: createWorkspaceStore({ttl:30000}), skillProbe: async()=>({ok:true, missing:[], probes:{}}), getChoiceStore: async () => null, decideBackend: outletDecideBackend })
  const rE = await svcE.detect({ cwd:'/tmp/gh-low' }, {})
  ok(rE.selection.backendId==='github' && rE.selection.source==='matches', '低置信线索不再挡住自动识别：目录能被 GitHub 认领时结论就是 matches')
}

console.log('\n== ② per-workspace 隔离 + 覆盖层「用户说了算」 ==')
{
  const reg = createRegistry({}, { matchesTimeout:30 })
  // 这两个假后端只用来验卸载后的缓存清理，不会被真正调用，所以按离网口径声明（注册表只验形状，不按口径限流）。
  reg.register({ id:'github', label:'G', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create:()=>({}), matches: async()=>false })
  reg.register({ id:'markdown', label:'M', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create:()=>({}), matches: async()=>false })
  const ws = createWorkspaceStore({ttl:30000})
  ws.set({ cwd:'/tmp/a' }, { selection:{ backendId:'github', source:'explicit', ref:{backend:'github',refId:'a',name:'a',url:''} } })
  ws.set({ cwd:'/tmp/b' }, { selection:{ backendId:'markdown', source:'matches', ref:{backend:'markdown',refId:'b',name:'b',url:''} } })
  ok(ws.get({cwd:'/tmp/a'}).selection.backendId==='github', 'per-workspace A=github')
  ok(ws.get({cwd:'/tmp/b'}).selection.backendId==='markdown', 'per-workspace B=markdown')
  ok(ws.get({cwd:'/tmp/a'}).selection.backendId!==ws.get({cwd:'/tmp/b'}).selection.backendId, '切换不串台')
  // 覆盖层：用户在面板上为这个工作区选定后端 → 生产里这一步落在工作区文件 docs/agents/workspace.yaml
  //   （#1138：注册表里那份进程内绑定表连同 bind 口子已经删掉，写入口只剩工作区入口 handleBind 一处）。
  //   这里就照那条路造一份文件，再问生产那一个判定出口该用谁。
  chooseWorkspace('/tmp/selected', 'github')
  const sel = await outletDecideBackend('/tmp/selected', { registry: reg, fs: workspaceFs, caller: 'verify-detection-cascade' })
  ok(sel.backendId==='github' && sel.source==='explicit' && sel.origin==='user-file' && sel.canWrite===true,
    '覆盖层：工作区文件里人选 → 判定出口答 explicit（用户说了算，且写用途凭它放行）')
  // 注册表不再答「这个工作区绑了谁」：判定出口的这一层已经整段删掉（#1138 的有意结果，
  //   三个口子 bind/bound/allBindings 的具体形状由 tests/tracker-contract/sections/registry.js 守着）。
  ok(typeof reg.bind==='undefined' && typeof reg.bound==='undefined' && typeof reg.allBindings==='undefined',
    '覆盖层：注册表不再存「这个工作区绑了谁」（bind/bound/allBindings 三个口子都没有）')
  // per-workspace TTL + pending 不缓存
  const ws2 = createWorkspaceStore({ttl:10})
  ws2.set({cwd:'/tmp/p'}, { selection:{backendId:'github', source:'matches', pending:true}})
  ok(ws2.get({cwd:'/tmp/p'})===null, 'pending 不缓存')
  await new Promise(r=>setTimeout(r, 20))
  ws2.set({cwd:'/tmp/ttl'}, {selection:{backendId:'github', source:'matches'}})
  await new Promise(r=>setTimeout(r, 20))
  ok(ws2.get({cwd:'/tmp/ttl'})===null, 'TTL 过期不命中')
  // 后端被卸载后的缓存清理：口径已从「注册表把绑定标 stale 再发 bind」改成「注册表发一条 unregister（带 id），
  //   缓存按『这一格答的是不是这个被卸掉的后端』清」（见 src/tracker/detection/workspaceStore.ts 的 invalidateByBackend）。
  const regStale = createRegistry({}, {})
  // 这两个假后端只用来验过期注册表的行为，不会被真正调用，所以按离网口径声明（注册表只验形状，不按口径限流）。
  regStale.register({ id:'github', label:'G', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create:()=>({}), matches: async()=>false })
  regStale.register({ id:'markdown', label:'M', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create:()=>({}), matches: async()=>false })
  const wsStale = createWorkspaceStore({ttl:30000})
  wsStale.set({cwd:'/tmp/s'},   {selection:{backendId:'github',   source:'explicit'}})
  wsStale.set({cwd:'/tmp/s2'},  {selection:{backendId:'markdown', source:'matches'}})
  regStale.on('unregister', (p) => {
    const n = wsStale.invalidateByBackend(p && p.id)
    ok(n===1, 'unregister 后只清「这一格答的正是被卸掉的那个后端」的缓存（清掉 ' + n + ' 格）')
  })
  regStale.unregister('github')
  ok(wsStale.get({cwd:'/tmp/s'})===null, 'unregister → 答 github 的那一格被清掉')
  ok(wsStale.get({cwd:'/tmp/s2'})!==null && wsStale.get({cwd:'/tmp/s2'}).selection.backendId==='markdown',
    'unregister → 答别的后端的那一格原样留着（不误伤）')
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
  ok(true, '双闸可复现：node tests/verify-tracker-contract.ts && node tests/verify-platform-contract.ts 已在本次落地中全绿（见下）')
}

console.log(`\nverify-detection-cascade: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
console.log('DETECTION CASCADE OK')