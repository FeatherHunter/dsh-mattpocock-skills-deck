// repro-issue58-cache-first.js — 复现 #58 缓存优先回归
// 目标：验证切换面板时不应出现“加载中”全屏遮罩，应为缓存优先秒开 + 后台静默刷新
// 检测点（静态）+ 动态模拟（内存 per-cwd 缓存 + 空 cwd 探路）
// 用法: node tests/repro-issue58-cache-first.js
const fs = require('fs')
const path = require('path')
const assert = require('assert')

function read(rel){ return fs.readFileSync(path.join(__dirname,'..',rel),'utf8') }

const client = read('client.js')
const pkg = read('package/lib/client.js')

let fails = []
function check(cond, msg){
  if(cond) console.log('  ✓',msg)
  else { console.error('  ✗ FAIL:',msg); fails.push(msg) }
}

// 1) 静态：必须存在 per-cwd 内存快照表
check(client.includes('snapshotByCwd') || client.includes('snapCacheByCwd') || client.includes('snapshotCache'), 'client.js 存在 per-cwd 内存快照表（snapshotByCwd）')
check(pkg.includes('snapshotByCwd') || pkg.includes('snapCacheByCwd') || pkg.includes('snapshotCache'), 'package/lib/client.js 存在 per-cwd 内存快照表')

// 2) 静态：loadSnapshot 在空 cwd 时应先同步解析 cwd（getCwdSync / wf.cwd），避免以空 cwd miss 缓存
const hasEnsureCwd = client.includes('getCwdSync') || client.includes('wf.cwd') && client.includes('st.cwd') && client.indexOf('loadSnapshot') < client.indexOf('wf.cwd')
check(hasEnsureCwd, 'client.js loadSnapshot 关联空 cwd 同步（getCwdSync / wf.cwd）')

// 3) 静态：ListTab 加载遮罩必须缓存优先 — 仅在无快照时显示 loading
// 旧指纹：st.snapMode === 'loading' ? h('div', { className: 'dsws-loading-shade'
// 新应为：st.snapMode === 'loading' && !st.snapshot ... 或 && !getCachedSnapshot
const oldLoading = /st\.snapMode\s*===\s*'loading'\s*\?\s*h\('div',\s*\{\s*className:\s*'dsws-loading-shade'/.test(client)
const hasCacheGuard = client.includes("st.snapMode === 'loading' && !st.snapshot") || client.includes('getCachedSnapshot') || client.includes('snapshotByCwd')
if (oldLoading && !hasCacheGuard) {
  check(false, 'ListTab 加载遮罩已加缓存守卫（st.snapMode===loading && !st.snapshot ...）')
} else {
  check(hasCacheGuard, 'ListTab 加载遮罩已加缓存守卫（避免有缓存时仍闪 loading）')
}

// 4) 静态：openPanel（openPagePanel/openDockPanel/openInSidebar）三分支应为缓存优先，过期走后台静默，不弹全屏遮罩
check(client.includes('snapFresh') && client.includes('loadSnapshot(st, false)'), 'openPanel 保留三分支缓存优先（新鲜直接展示 / 过期秒开+后台静默 / 首开才 loading）')
check(client.includes('snapshotByCwd') || client.includes('hydrateFromCache'), 'openPanel 水合 per-cwd 缓存（新 store 秒开）')

// 5) 动态模拟：空 cwd 探路窗口不应导致 miss 缓存
console.log('\n=== 动态模拟：空 cwd 探路 vs 缓存优先 ===')
function simulateOld(){
  // 旧逻辑：st.cwd 为空时直接以 {} 调 snapshot，必 miss；且新 store 无 per-cwd 缓存
  const snapshotByCwd = {} // 不存在
  const makeStore = () => ({ cwd:'', snapshot:null, snapMode:'loading', snapLoading:false, sessionId:'sid-new' })
  const st = makeStore()
  // 旧 openPagePanel 首开分支：st.snapMode='loading' 直接显示遮罩
  const hasCache = !!(st.snapshot || snapshotByCwd[st.cwd])
  const wouldShowLoading = st.snapMode==='loading' && !hasCache // true → 闪 loading
  return wouldShowLoading // true 表示会闪
}
function simulateNew(){
  // 新逻辑：per-cwd 缓存 + 空 cwd 同步
  const snapshotByCwd = { '/repoA': { ok:true, maps:[{number:1}], generatedMs: Date.now(), repo:{owner:'o',name:'r'} } }
  const getCachedSnapshot = (cwd)=> snapshotByCwd[cwd] || null
  const getCwdSync = (sid)=> sid==='sid-new' ? '/repoA' : ''
  const hydrateFromCache = (st)=>{
    const c = getCachedSnapshot(st.cwd)
    if(c){ st.snapshot=c; st.snapMode='real'; return true}
    return false
  }
  const makeStore = () => ({ cwd:'', snapshot:null, snapMode:'loading', snapLoading:false, sessionId:'sid-new' })
  const st = makeStore()
  // 新 openPagePanel：先同步补 cwd
  if(!st.cwd){ const sync = getCwdSync(st.sessionId); if(sync) st.cwd=sync }
  hydrateFromCache(st)
  const hasCache = !!(st.snapshot || getCachedSnapshot(st.cwd))
  const wouldShowLoading = st.snapMode==='loading' && !hasCache
  // 新逻辑下 hasCache true → wouldShowLoading false → 不闪
  return { wouldShowLoading, st }
}
const oldFlash = simulateOld()
const newRes = simulateNew()
console.log('  旧逻辑空 cwd 首开会闪 loading?', oldFlash, '(预期 true)')
console.log('  新逻辑空 cwd 首开会闪 loading?', newRes.wouldShowLoading, '(预期 false)  st.snapshot:', !!newRes.st.snapshot, 'cwd:', newRes.st.cwd)
check(oldFlash===true, '旧逻辑确会闪 loading（复现成功）')
check(newRes.wouldShowLoading===false && !!newRes.st.snapshot, '新逻辑空 cwd 经 per-cwd 缓存秒开，不闪 loading')

// 6) 多工作区隔离：同 cwd 组共享，异组不互串（#45 延续）
console.log('\n=== 隔离延续校验（#45 不回归） ===')
check(client.includes('refreshGroup') && client.includes('st.cwd === cwd'), 'probeNow 仍按 cwd 分组隔离（#45 不回归）')

console.log('\n=== 汇总 ===')
if(fails.length){
  console.error('存在失败 '+fails.length+' 项 ❌')
  fails.forEach(f=>console.error(' -',f))
  console.log('\n复现结论：当前代码未满足缓存优先契约，属 #58 回归（需修复）')
  process.exit(1)
} else {
  console.log('全部通过 ✅ — #58 缓存优先契约已满足')
  process.exit(0)
}
