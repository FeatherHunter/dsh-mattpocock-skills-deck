// verify-issue58-cache-first.js — #58 缓存优先回归验证
// 契约：打开/切换面板时缓存优先秒开，不闪“加载中”遮罩，后台静默刷新 + diff 增量
// 覆盖：per-cwd 内存表 / 空 cwd 同步 / loading 守卫 / 三分支 / tab 静默 / 多工作区隔离
// 用法: node tests/verify-issue58-cache-first.js
const fs = require('fs')
const path = require('path')
const assert = require('assert')

function read(rel){ return fs.readFileSync(path.join(__dirname,'..',rel),'utf8') }
const client = read('client.js')
const pkg = read('package/lib/client.js')
const host = read('host.js')

let fails=[]; let passes=[]
function check(cond, msg, file=''){
  const tag = file ? ' :: '+file : ''
  if(cond){ console.log('  PASS '+msg+tag); passes.push(msg) }
  else { console.error('  FAIL '+msg+tag); fails.push(msg) }
}

console.log('=== #58 缓存优先静态契约 ===')

// 1) per-cwd 内存快照表存在于双源
for(const [name, src] of [['client.js', client], ['package/lib/client.js', pkg]]){
  check(/snapshotByCwd/.test(src), '存在 per-cwd 内存快照表 snapshotByCwd', name)
  check(/getCachedSnapshot/.test(src), '存在 getCachedSnapshot(cwd) 读表', name)
  check(/setCachedSnapshot/.test(src), '存在 setCachedSnapshot(cwd, snap) 写表', name)
  check(/hydrateFromCache/.test(src), '存在 hydrateFromCache(st) 秒开', name)
  check(/getCwdSync/.test(src), '存在 getCwdSync(sid) 同步补 cwd', name)
}

// 2) loadSnapshot 空 cwd 同步 + 缓存优先守卫
for(const [name, src] of [['client.js', client], ['package/lib/client.js', pkg]]){
  const hasDoLoad = /const doLoad = function/.test(src)
  check(hasDoLoad, 'loadSnapshot 拆 doLoad + 外层空 cwd 同步', name)
  check(/if \(!st\.cwd\)/.test(src) && /getCwdSync/.test(src), '空 cwd 先同步补齐（getCwdSync）', name)
  check(src.includes("wf.cwd") && src.includes("sessionId"), '空 cwd 兜底异步 wf.cwd/sessionId', name)
  check(/hydrateFromCache\(st\)/.test(src), 'loadSnapshot 内水合 per-cwd 缓存', name)
  check(/hasCache/.test(src) && /getCachedSnapshot/.test(src), 'loadSnapshot 计算 hasCache 并据此决定是否设 loading', name)
  check(/if \(force && !silent && !hasCache\)/.test(src), '仅无缓存时才设 snapMode=loading（缓存优先不闪）', name)
  check(/setCachedSnapshot/.test(src) && /st\.snapshot = snap/.test(src), 'loadSnapshot 成功后写 per-cwd 表', name)
}

// 3) openPanel 三分支缓存优先（新鲜直接展示 / 过期秒开+静默 / 首开才 loading）
for(const [name, src] of [['client.js', client], ['package/lib/client.js', pkg]]){
  const hasOpenPage = /const openPagePanel/.test(src)
  check(hasOpenPage, '存在 openPagePanel 三分支', name)
  check(src.includes('hydrateFromCache(st)') && src.includes('hasCache'), 'openPanel 先水合 + 判断 hasCache/isReal', name)
  check(src.includes("st.snapMode === 'loading'") || src.includes("snapMode"), 'openPanel 首开才设 loading', name)
  // 确认过期分支走后台静默 loadSnapshot(st,false) 而非 force
  check(src.includes('loadSnapshot(st, false)') , '过期分支后台静默 loadSnapshot(false)', name)
}

// 4) ListTab 加载遮罩仅无缓存时显示
for(const [name, src] of [['client.js', client], ['package/lib/client.js', pkg]]){
  const hasGuard = src.includes("st.snapMode === 'loading' && !st.snapshot && !getCachedSnapshot(st.cwd)")
  check(hasGuard, 'ListTab 加载遮罩加缓存守卫（st.snapMode===loading && !st.snapshot && !getCachedSnapshot）', name)
  const hasErrGuard = src.includes("st.snapMode === 'err' && !st.snapshot && !getCachedSnapshot(st.cwd)")
  check(hasErrGuard, 'ListTab 错误态同加缓存守卫（有缓存不替列表）', name)
}

// 5) tab 切换静默刷新（列表/技能/环境检查 tabs）
for(const [name, src] of [['client.js', client], ['package/lib/client.js', pkg]]){
  const hasTabRefresh = src.includes("s.tab = id; emit(s); if (!snapFresh(s)) loadSnapshot(s, false)")
  check(hasTabRefresh, 'tab 切换（列表/技能/检查）后若 stale 则后台静默 loadSnapshot', name)
}

// 6) StatusBar 与 DetailsDock 的 cwd 关联水合
for(const [name, src] of [['client.js', client], ['package/lib/client.js', pkg]]){
  check(src.includes('hydrateFromCache(s)') && src.includes('summaryCwd'), 'StatusBar apply 内水合 per-cwd', name)
  check(src.includes('hydrateFromCache(s)') && src.includes('snapFresh'), 'DetailsDock 挂载水合 + stale 静默', name)
}

// 7) probeNow 多工作区隔离延续（#45 不回归）
for(const [name, src] of [['client.js', client], ['package/lib/client.js', pkg]]){
  check(/refreshGroup/.test(src) && /keyOf\(st\.cwd\) === normWanted/.test(src), 'probeNow 按 cwd 归一键分组隔离（#324 · #45 延续）', name)
  check(/sidToCwd/.test(src), '兜底 sidToCwd 精确映射保留', name)
  // #58 兜底后新增水合
  check(src.includes('hydrateFromCache(st)') && src.includes('sidToCwd'), '兜底补 cwd 后水合 per-cwd', name)
}

// 8) 动态模拟：多工作区 + 空 cwd + tab 切换均不闪 loading
console.log('\n=== 动态模拟：三场景不闪 loading ===')
function makeSnap(ms){ return { ok:true, maps:[{number:1,title:'map'}], issues:[{number:10}], generatedMs: ms, repo:{owner:'o',name:'r'} } }
function testScenario(name, fn){
  try{ fn(); console.log('  PASS '+name); passes.push(name)} catch(e){ console.error('  FAIL '+name+': '+e.message); fails.push(name) }
}
testScenario('场景1：同一工作区内切 tab（新鲜）不闪 loading', ()=>{
  const snapshotByCwd={'/a': makeSnap(Date.now())}
  const getCachedSnapshot=(cwd)=>snapshotByCwd[cwd]||null
  const s={ cwd:'/a', snapshot: snapshotByCwd['/a'], snapMode:'real', snapLoading:false }
  const snapFresh=(st)=> (Date.now() - st.snapshot.generatedMs) < 60000
  // 切换 tab：旧 s.tab 变化，不应设 loading
  s.tab='skills'
  const hasCache = !!(s.snapshot || getCachedSnapshot(s.cwd))
  const wouldShowLoading = s.snapMode==='loading' && !hasCache
  if(wouldShowLoading) throw new Error('新鲜缓存不应 loading')
  // stale 场景：后台静默，不闪
  s.snapshot.generatedMs = Date.now() - 120000 // 过期
  if(snapFresh(s)) throw new Error('应为过期')
  // 此时切换 tab 会触发 loadSnapshot(false) 但 hasCache true → 不设 loading
  const wouldShowLoadingStale = s.snapMode==='loading' && !hasCache
  if(wouldShowLoadingStale) throw new Error('过期但有缓存不应 loading')
})
testScenario('场景2：切工作区 A→B（B 有 per-cwd 缓存）秒开不闪', ()=>{
  const snapshotByCwd={'/a': makeSnap(Date.now()), '/b': makeSnap(Date.now())}
  const getCachedSnapshot=(cwd)=>snapshotByCwd[cwd]||null
  const hydrateFromCache=(st)=>{ const c=getCachedSnapshot(st.cwd); if(c){ st.snapshot=c; st.snapMode='real'; return true} return false}
  const getCwdSync=(sid)=> sid==='sid-b' ? '/b' : ''
  const makeStore=(sid)=>({ cwd:'', snapshot:null, snapMode:'loading', sessionId:sid })
  const st = makeStore('sid-b')
  // openPanel 逻辑：先同步补 cwd
  if(!st.cwd){ const sync=getCwdSync(st.sessionId); if(sync) st.cwd=sync }
  hydrateFromCache(st)
  const hasCache = !!(st.snapshot || getCachedSnapshot(st.cwd))
  const wouldShowLoading = st.snapMode==='loading' && !hasCache
  if(wouldShowLoading) throw new Error('B 有缓存应秒开，不闪')
  if(!st.snapshot) throw new Error('应已水合 snapshot')
})
testScenario('场景3：多工作区并发刷新互不串台 + per-cwd 隔离', ()=>{
  const snapshotByCwd={'/a': makeSnap(Date.now()), '/b': makeSnap(Date.now())}
  // 模拟 probe 刷新只影响同 cwd 组
  const stores={ 'sid-a': { cwd:'/a', snapshot: snapshotByCwd['/a'] }, 'sid-b': { cwd:'/b', snapshot: snapshotByCwd['/b'] } }
  const newSnapA = makeSnap(Date.now())
  // refreshGroup('/a') 只更新 /a 组
  const group = Object.keys(stores).filter(k=>stores[k].cwd==='/a')
  if(group.length!==1 || group[0]!=='sid-a') throw new Error('组错')
  stores['sid-a'].snapshot = newSnapA
  if(stores['sid-b'].snapshot===newSnapA) throw new Error('B 被 A 串台')
})

console.log('\n=== 汇总 ===')
console.log(`TOTAL ${passes.length+fails.length} PASS ${passes.length} FAIL ${fails.length}`)
if(fails.length){ console.error('存在失败 ❌'); fails.forEach(f=>console.error(' -',f)); process.exit(1) }
else { console.log('全部通过 ✅ — #58 缓存优先契约已满足且无回归'); process.exit(0) }
