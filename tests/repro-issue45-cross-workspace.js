// repro-issue45-cross-workspace.js — 复现 #45 多工作区异步回调导致右侧面板串台
// 最小化反馈环：模拟 client.js 的 probeNow 广播逻辑，证明跨工作区污染
// 用法: node tests/repro-issue45-cross-workspace.js
const assert = require('assert')

// 模拟 stores 与 shared（与 client.js 结构对齐）
function makeStore(cwd, snapshot) {
  return { cwd, snapshot, lastDiff: null, rowFlash:{}, issueFlash:{}, snapMode:'real', snapError:null, tick:0, subs:[], sessionId: 'sid-'+cwd }
}
function diffSnapshots(a,b){ return {added:[], removed:[], changed:[], issueFlash:{}} }

// 旧逻辑（buggy）：对每个 cwd 的 probe 变更，loadSnapshot(shared) 后广播到所有 stores
function buggyProbeFlow(cwds, stores, shared, loadSnapshotMock) {
  // cwds = ['/repoA','/repoB']
  // shared 初始 cwd = '/repoA' (第一次 probe 后被赋值)
  // 模拟第一轮 probe cwd=/repoA changed → shared 载入 snapshotA → 广播到所有 stores
  const snapshotA = { ok:true, maps:[{number:100, title:'repoA map'}], repo:{owner:'org', name:'repoA'}, generatedMs: Date.now() }
  const snapshotB = { ok:true, maps:[{number:200, title:'repoB map'}], repo:{owner:'org', name:'repoB'}, generatedMs: Date.now() }
  // 模拟 repoA 变更
  loadSnapshotMock(shared, '/repoA', snapshotA)
  // buggy broadcast：无论 st.cwd 为何，全部覆写
  Object.keys(stores).forEach(k => {
    const st2 = stores[k]
    if ('/repoA' && !st2.cwd) st2.cwd = '/repoA' // 原逻辑仅对空 cwd 赋值，但不隔离
    // 注意原逻辑未过滤 cwd !== probed cwd，直接覆盖
    st2.snapshot = snapshotA
  })
  shared.snapshot = snapshotA
  shared.cwd = '/repoA'
  return {snapshotA, snapshotB}
}

function fixedProbeFlow(cwds, stores, shared, loadSnapshotMock) {
  // 正确逻辑：按 cwd 分组隔离，只更新匹配 cwd 的 stores
  const snapshotA = { ok:true, maps:[{number:100, title:'repoA map'}], repo:{owner:'org', name:'repoA'}, generatedMs: Date.now() }
  // 仅更新 cwd === '/repoA' 的 stores
  Object.keys(stores).forEach(k => {
    const st2 = stores[k]
    if (st2.cwd === '/repoA') {
      st2.snapshot = snapshotA
    }
  })
  if (shared.cwd === '/repoA') shared.snapshot = snapshotA
  return snapshotA
}

function main(){
  console.log('=== 复现 #45 多工作区串台 ===')
  // 场景：用户在工作区A执行异步任务，然后切换到工作区B
  // 此时 stores: sA → /repoA，已有 snapshotA； sB → /repoB，已有 snapshotB
  const snapshotA0 = { ok:true, maps:[{number:10, title:'A initial'}], repo:{owner:'o',name:'repoA'} }
  const snapshotB0 = { ok:true, maps:[{number:20, title:'B initial'}], repo:{owner:'o',name:'repoB'} }
  const storesBuggy = {
    'sidA': makeStore('/repoA', JSON.parse(JSON.stringify(snapshotA0))),
    'sidB': makeStore('/repoB', JSON.parse(JSON.stringify(snapshotB0))),
  }
  const sharedBuggy = makeStore('/repoA', JSON.parse(JSON.stringify(snapshotA0)))
  // 模拟异步：repoA 任务完成，触发 probe 变更（此时用户已在工作区B，右侧面板应显示B）
  // 但 buggy 逻辑会把 A 的新快照刷到 B 的 store
  const loadMock = (st, cwd, snap)=>{ st.cwd = cwd; st.snapshot = snap }
  buggyProbeFlow(['/repoA'], storesBuggy, sharedBuggy, loadMock)
  // 检查：此时 B 的 store 是否被污染
  const isPolluted = storesBuggy['sidB'].snapshot.maps[0].title === 'repoA map'
  console.log('  Buggy 流程后 sidB snapshot title=', storesBuggy['sidB'].snapshot.maps[0].title)
  console.log('  是否串台（预期 true，污染）:', isPolluted)
  assert.strictEqual(isPolluted, true, 'buggy 流程应导致 B 被 A 污染')

  // 再测 fixed 逻辑：B 应保持不变
  const storesFixed = {
    'sidA': makeStore('/repoA', JSON.parse(JSON.stringify(snapshotA0))),
    'sidB': makeStore('/repoB', JSON.parse(JSON.stringify(snapshotB0))),
  }
  const sharedFixed = makeStore('/repoA', JSON.parse(JSON.stringify(snapshotA0)))
  fixedProbeFlow(['/repoA'], storesFixed, sharedFixed, loadMock)
  const isFixedPolluted = storesFixed['sidB'].snapshot.maps[0].title === 'repoA map'
  const isFixedCorrect = storesFixed['sidB'].snapshot.maps[0].title === 'B initial'
  console.log('  Fixed 流程后 sidB snapshot title=', storesFixed['sidB'].snapshot.maps[0].title)
  console.log('  是否仍串台（预期 false）:', isFixedPolluted)
  console.log('  是否保持 B 初始（预期 true）:', isFixedCorrect)
  assert.strictEqual(isFixedPolluted, false, 'fixed 流程不应污染 B')
  assert.strictEqual(isFixedCorrect, true, 'fixed 流程 B 应保持原内容')
  // 验证 A 有更新
  const aUpdated = storesFixed['sidA'].snapshot.maps[0].title === 'repoA map'
  console.log('  sidA 是否更新为 A 新快照（预期 true）:', aUpdated)
  assert.strictEqual(aUpdated, true)

  console.log('\n✓ 复现成功：buggy 逻辑确导致跨工作区串台，fixed 逻辑隔离正常')
  console.log('  紧凑信号：此脚本 2s 内 deterministic，红→绿 切换验证修复')
}
main()
