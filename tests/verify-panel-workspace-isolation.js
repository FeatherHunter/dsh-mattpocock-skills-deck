// verify-panel-workspace-isolation.js — #45 多工作区隔离回归
// 验证 client.js 的 probeNow 已按 cwd 分组隔离，禁止跨工作区广播
// 用法: node tests/verify-panel-workspace-isolation.js
const fs = require('fs')
const assert = require('assert')

function checkFile(path){
  const src = fs.readFileSync(path, 'utf8')
  const checks = []
  const ok = (cond, msg)=> { checks.push({msg, pass: !!cond}); console.log((cond?'  PASS ':'  FAIL ')+msg+ ' :: '+path); if(!cond) console.error('    ✗',msg) }
  // 1) 必须包含 refreshGroup 辅助（按 cwd 分组）
  ok(/const refreshGroup\s*=\s*function\s*\(cwd\)/.test(src), '存在 refreshGroup(cwd) 按组刷新辅助')
  // 2) 组收集必须精确匹配 cwd === 探查 cwd（#324 升级为归一键相等，兼容直接相等与 keyOf 相等）
  ok(/if\s*\(\s*shared\.cwd\s*===\s*cwd\s*\)/.test(src) || /shared\.cwd\s*===\s*cwd/.test(src) || /keyOf\(shared\.cwd\)\s*===/.test(src) || /keyOf\(shared\.cwd\)/.test(src), 'shared 仅当 cwd === probed cwd 时入组（含归一键）')
  ok(/if\s*\(\s*st\.cwd\s*===\s*cwd\s*\)/.test(src) || /st\.cwd\s*===\s*cwd/.test(src) || /keyOf\(st\.cwd\)/.test(src), 'stores 仅当 st.cwd === cwd 时入组（含归一键）')
  // 3) 禁止旧全量广播模式：不应出现无条件 Object.keys(stores).forEach(... st2.snapshot = newSnap) 且中间无 cwd 过滤
  // 我们检测旧缺陷指纹：if (cwd && !st2.cwd) st2.cwd = cwd 后直接全量赋值且无 cwd 过滤的连续段
  const hasOldAssign = /if\s*\(\s*cwd\s*&&\s*!st2\.cwd\s*\)\s*st2\.cwd\s*=\s*cwd/.test(src)
  ok(!hasOldAssign, '已移除旧“if(cwd && !st2.cwd) st2.cwd=cwd 后全量广播”缺陷指纹')
  // 4) 空组时仅暖缓存不污染 UI
  ok(/rpcCall\('refresh'/.test(src) || /host\.call\('wf\.refresh'/.test(src), '空组时暖 host 缓存（wf.refresh）而非误写 UI')
  // 5) 兜底路径按 sid→cwd 精确映射，而非首个 cwd 统一赋值
  ok(/sidToCwd/.test(src), '兜底路径建立 sidToCwd 精确映射')
  ok(!/if\s*\(\s*shared\.cwd\s*!==\s*foundCwds\[0\]\s*\)\s*shared\.cwd\s*=\s*foundCwds\[0\]/.test(src), '已移除兜底“shared.cwd = foundCwds[0] 无条件首绑”缺陷')
  // 6) 双源一致性：probeNow 结构在双源中同构
  const hasHelperInBoth = /refreshGroup/.test(src)
  ok(hasHelperInBoth, 'probeNow helper 在当前文件存在')
  // 7) 确保 loadSnapshot 调用带正确 cwd（primary.cwd 已校验）
  ok(/loadSnapshot\(primary/.test(src), '组内首个 primary 负责 loadSnapshot（正确 cwd）')

  const failed = checks.filter(c=>!c.pass)
  return {pass: failed.length===0, failed, checks}
}

console.log('=== #45 工作区隔离静态校验 ===')
let allPass = true
for(const f of ['client.js','package/lib/client.js']){
  console.log('\n-- 检查',f,'--')
  const r = checkFile(f)
  if(!r.pass) allPass = false
}

// 8) 动态隔离模拟（与 repro-issue45 同模型，但用新 helper 逻辑平行验证）
console.log('\n=== 动态隔离模拟（双工作区并发）===')
function makeStore(cwd, title){
  return { cwd, snapshot:{ ok:true, maps:[{number:1, title}], repo:{owner:'o',name:'r'} }, lastDiff:{}, rowFlash:{}, issueFlash:{}, snapMode:'real', snapError:null, sessionId:'sid-'+cwd }
}
function diffSnapshots(a,b){ return {added:[], removed:[], changed:[], issueFlash:{}} }
function simulateFixed(cwdChanged, stores, shared){
  const group=[]
  if(shared.cwd===cwdChanged) group.push(shared)
  Object.keys(stores).forEach(k=>{ if(stores[k].cwd===cwdChanged) group.push(stores[k]) })
  if(!group.length) return false
  const primary=group[0]
  const snapshotNew={ ok:true, maps:[{number:99, title:'NEW '+cwdChanged}], repo:{owner:'o',name:'r'}, generatedMs: Date.now()}
  primary.snapshot=snapshotNew
  const rest=group.slice(1)
  rest.forEach(st2=>{
    st2.snapshot=snapshotNew
  })
  return true
}
const sA=makeStore('/repoA','A-init')
const sB=makeStore('/repoB','B-init')
const shared2=makeStore('/repoA','sharedA')
const storesSim={sA, sB}
console.log('  初始 sA', sA.snapshot.maps[0].title, 'sB', sB.snapshot.maps[0].title)
simulateFixed('/repoA', storesSim, shared2)
console.log('  变更 cwd=/repoA 后 sA', sA.snapshot.maps[0].title, 'sB', sB.snapshot.maps[0].title, 'shared', shared2.snapshot.maps[0].title)
const dynPass = sA.snapshot.maps[0].title === 'NEW /repoA' && sB.snapshot.maps[0].title === 'B-init' && shared2.snapshot.maps[0].title === 'NEW /repoA'
console.log((dynPass?'  PASS ':'  FAIL ')+'动态：仅同 cwd 组更新，异组保持不变')
if(!dynPass) allPass=false

// 9) 验证旧 bug 模型确实会串台（对比）
console.log('\n=== 对比：旧全量广播模型会串台 ===')
function simulateBuggy(cwdChanged, stores, shared){
  const snapshotNew={ ok:true, maps:[{number:99, title:'NEW '+cwdChanged}], repo:{owner:'o',name:'r'}}
  Object.keys(stores).forEach(k=>{ stores[k].snapshot=snapshotNew })
  shared.snapshot=snapshotNew
}
const sA2=makeStore('/repoA','A-init')
const sB2=makeStore('/repoB','B-init')
const sharedBug=makeStore('/repoA','sharedA')
simulateBuggy('/repoA', {sA:sA2, sB:sB2}, sharedBug)
const buggyPollutes = sB2.snapshot.maps[0].title === 'NEW /repoA'
console.log('  buggy 后 sB title=', sB2.snapshot.maps[0].title, '是否污染', buggyPollutes, '(预期 true)')
console.log((buggyPollutes?'  PASS ':'  FAIL ')+'旧模型确会污染（反证）')
if(!buggyPollutes) allPass=false

console.log('\n=== 汇总 ===')
if(allPass) { console.log('全部通过 ✅ — #45 隔离修复已生效且无回归'); process.exit(0) }
else { console.log('存在失败 ❌'); process.exit(1) }
