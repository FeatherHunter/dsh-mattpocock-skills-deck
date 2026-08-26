// idle-refresh-repro.js — 空闲刷新后 gate 误弹
// 模拟：已建立 github，后台 60s 刷新返回可疑 fallback null，应保留 github
console.log('=== idle refresh guard test ===')
function createStore(){
  return { cwd: 'D:/dsh-plugin/dsh-mattpocock-skills-deck', selection: {backendId:'github', source:'matches', ref:{backend:'github'}}, repository: {backend:'github'}, tick:0, subs:[] }
}
function setCachedSelection(cwd, sel){ /* mock */ }

// 旧逻辑 apply
function oldApply(st, snap){
  if(snap.selection!==undefined){ st.selection = snap.selection }
  if(snap.repository!==undefined){ st.repository = snap.repository }
}
// 新逻辑
function newApply(st, snap){
  if(snap.selection!==undefined){
    const cur=st.selection, nxt=snap.selection
    const isSuspicious = !!(nxt && nxt.backendId===null && !nxt.pending && nxt.source==='fallback' && cur && cur.backendId)
    if(isSuspicious){ console.log('newApply: suspicious fallback preserved cur', cur.backendId) } else { st.selection=nxt }
  }
  if(snap.repository!==undefined){
    const curSel=st.selection, nxtSel=snap.selection
    const isSusp2 = !!(nxtSel && nxtSel.backendId===null && !nxtSel.pending && nxtSel.source==='fallback' && curSel && curSel.backendId)
    if(!isSusp2) st.repository=snap.repository
  }
}

let stOld = createStore()
let snapFallback = { selection: {backendId:null, source:'fallback'}, repository: {backend:'github', refId:'x', name:'x', url:''} }
oldApply(stOld, snapFallback)
console.log('oldApply result selection', stOld.selection, 'expected null (bug) -> gate true')
let isGateOld = !!(stOld.selection && stOld.selection.backendId===null)
console.log('old gate?', isGateOld, '(true = bug)')

let stNew = createStore()
newApply(stNew, snapFallback)
console.log('newApply result selection', stNew.selection, 'expected github (fixed) -> gate false')
let isGateNew = !!(stNew.selection && stNew.selection.backendId===null)
console.log('new gate?', isGateNew, '(false = fixed)')

if(isGateOld && !isGateNew){
  console.log('🟢 idle guard PASS')
  process.exit(0)
} else {
  console.log('🔴 fail')
  process.exit(1)
}
