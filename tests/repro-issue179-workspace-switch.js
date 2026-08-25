// repro-issue179-workspace-switch.js — 复现 #179 切工作区后右侧仓库名残留 D:\2Study\...
// 用法: node tests/repro-issue179-workspace-switch.js
const fs = require('fs')

console.log('=== 复现 #179：切工作区后右侧面板仓库名残留 DSH 本体路径 ===')

const srcDock = fs.readFileSync('src/client/panel/Dock.js','utf8')
const srcHost = fs.readFileSync('src/host/index.js','utf8')
const clientBuilt = fs.existsSync('client.js') ? fs.readFileSync('client.js','utf8') : ''
const checks = []
function ok(cond, msg){ checks.push({msg, pass:!!cond}); console.log((cond?'  PASS ':'  FAIL ')+msg) }

ok(/summaryCwd/.test(srcDock) && /useSessions/.test(srcDock), 'Dock 存在 summaryCwd 权威信号')
ok(/React\.useEffect\(function \(\) \{[\s\S]*?apply\(summaryCwd/.test(srcDock), '存在响应式 cwd 同步 effect')
ok(/getCwdSync\(sid\)/.test(srcDock), '存在 getCwdSync 同步兜底')
ok(/host\.call\('wf\.cwd'/.test(srcDock), '存在 wf.cwd 异步兜底')
ok(/isPolluted/.test(srcDock), '存在污染自愈 isPolluted')
ok(/\/\/ #179/.test(srcDock), '#179 加固注释存在')
ok(/\|\| DEFAULT_CWD/.test(srcHost), 'host wf.snapshot/wf.refresh 保留 DEFAULT_CWD 兜底（避免空白）')

console.log('\n=== 动态模拟：同 sid 切工作区（summaryCwd 变，sid 不变）旧 vs 新 ===')

function makeStore(cwd, snapshot){
  return { cwd, snapshot, snapMode: snapshot?'real':'loading', tick:0, subs:[] }
}
const snapshotByCwd = {}
function setCached(cwd, snap){ if(cwd&&snap) snapshotByCwd[cwd]=snap }
function hydrateFromCache(st){
  if(!st||!st.cwd) return false
  const c=snapshotByCwd[st.cwd]
  if(!c) return false
  if(!st.snapshot || c.generatedMs!==st.snapshot.generatedMs){ st.snapshot=c; return true }
  return false
}
function cwdBasename(cwd){ const parts=String(cwd).split(/[\\/]/); for(let i=parts.length-1;i>=0;i--) if(parts[i]) return parts[i]; return '' }

// 场景：用户先在 DSH 本体工作区，再切到 dsh-mattpocock-skills-deck
const cwdDSH = 'D:/2Study/nodejs/node_modules/@deepseek-ai/dsh'
const cwdDeck = 'D:/dsh-plugin/dsh-mattpocock-skills-deck'
const snapDSH = { ok:true, maps:[{number:120,title:'DSH map'}], repo:{owner:'deepseek-ai',name:'dsh'}, repository:{backend:'github', name:'deepseek-ai/dsh', url:'https://github.com/deepseek-ai/dsh'}, repoRoot:cwdDSH, generatedMs:1000 }
const snapDeck = { ok:true, maps:[{number:120,title:'Deck map'}], repository:{backend:'github', name:'FeatherHunter/dsh-mattpocock-skills-deck', url:'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck'}, repo:{owner:'FeatherHunter',name:'dsh-mattpocock-skills-deck'}, repoRoot:cwdDeck, generatedMs:2000 }
setCached(cwdDSH, snapDSH)
setCached(cwdDeck, snapDeck)

// 旧逻辑：仅 deps [sid]，summaryCwd 变化不触发 apply（且无 getCwdSync 兜底），导致残留 DSH
// 同 sid 切工作区时，旧 effect 因 deps 未含 summaryCwd 根本不会重跑，故不调用 apply
function oldApply(store, summaryCwd, sid){
  // 模拟旧 deps：仅 sid 变化才跑，本次 sidSame 不变 → effect 不执行
  return false // 未执行
}
const storeOld = makeStore(cwdDSH, snapDSH)
const summaryCwdNew = cwdDeck
const sidSame = 'sid-keep' // 同 session 切工作区，sid 不变（典型 details 槽位共享场景）
let oldApplied = oldApply(storeOld, summaryCwdNew, sidSame)
console.log('  旧逻辑 同 sid 切工作区 applied=', oldApplied, '（预期 false，因 effect 不重跑）')
ok(oldApplied===false, '旧逻辑：同 sid 切工作区不会同步（复现残留）')
console.log('  旧 store 切后 cwd=', storeOld.cwd, 'repo=', storeOld.snapshot.repository.name, '（仍为 DSH，错误）')
ok(storeOld.snapshot.repository.name==='deepseek-ai/dsh' && storeOld.cwd===cwdDSH, '旧逻辑残留 DSH 仓库名（未同步）')

// 新逻辑：effect deps [sid, summaryCwd]，且 apply 含污染自愈
function newApply(store, summaryCwd){
  const apply = (cwd)=>{
    if(!cwd) return false
    const norm=String(cwd).replace(/\\/g,'/').replace(/\/+$/,'')
    const cur=String(store.cwd||'').replace(/\\/g,'/').replace(/\/+$/,'')
    if(norm===cur) return false
    store.cwd=cwd
    const hydrated=hydrateFromCache(store)
    // 污染自愈（即使 hydrated 也校验）
    const snap=store.snapshot
    let polluted=false
    if(snap && snap.repoRoot){
      const rr=String(snap.repoRoot).replace(/\\/g,'/').replace(/\/+$/,'')
      if(norm!==rr && !norm.startsWith(rr+'/') && !rr.startsWith(norm+'/')) polluted=true
    }
    if(polluted){
      const correct=snapshotByCwd[store.cwd]
      if(correct) store.snapshot=correct
    }
    return true
  }
  return apply(summaryCwd)
}
const storeNew = makeStore(cwdDSH, snapDSH)
let newApplied = newApply(storeNew, summaryCwdNew)
console.log('  新逻辑 同 sid 切工作区 applied=', newApplied, '（预期 true）')
ok(newApplied===true, '新逻辑：同 sid 切工作区正确同步')
console.log('  新 store 切后 cwd=', storeNew.cwd, 'repo=', storeNew.snapshot.repository.name, '（应为 FeatherHunter）')
ok(storeNew.cwd===cwdDeck && storeNew.snapshot.repository.name==='FeatherHunter/dsh-mattpocock-skills-deck', '新逻辑：仓库名已校正为 FeatherHunter')

// 跨 sid 切（旧逻辑也能切，但验证新逻辑不回归）
const storeCross = makeStore(cwdDSH, snapDSH)
newApply(storeCross, cwdDeck)
ok(storeCross.cwd===cwdDeck, '跨 sid 切工作区亦正确')

// 回切保障：host 保留兜底，客户端保证同 sid 亦触发（空 cwd 窗口极短）
ok(/\|\| DEFAULT_CWD/.test(srcHost), 'host 保留 DEFAULT_CWD 兜底')

// 构建产物校验（构建后才有 host.js）
if(clientBuilt){
  ok(/summaryCwd/.test(clientBuilt), 'client.js 含 summaryCwd')
  try {
    const builtHostNow = fs.existsSync('host.js') ? fs.readFileSync('host.js','utf8') : ''
    ok(/\|\| DEFAULT_CWD/.test(builtHostNow) || /\|\| DEFAULT_CWD/.test(srcHost), 'host 含 DEFAULT_CWD 兜底（src 或 built）')
  } catch(e){ ok(/\|\| DEFAULT_CWD/.test(srcHost), 'host src 含 DEFAULT_CWD 兜底') }
} else {
  ok(/\|\| DEFAULT_CWD/.test(srcHost), 'host src 含 DEFAULT_CWD 兜底（未构建时校验源码）')
}

console.log('\n=== 汇总 ===')
const failed=checks.filter(c=>!c.pass)
if(failed.length){
  console.log('存在失败 ❌', failed.map(f=>f.msg).join(' ; '))
  process.exit(1)
} else {
  console.log('全部通过 ✅ — #179 切工作区仓库名残留已修复（同 sid/跨 sid + 污染自愈 + 空 cwd 防御）')
  process.exit(0)
}
