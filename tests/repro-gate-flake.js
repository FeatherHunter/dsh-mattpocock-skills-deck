// repro-gate-flake.js — 复现 “该工作区还没有设置” 偶现横幅（#diagnosing-bugs Phase 1-2）
// 模拟客户端 store 的 snapLoading 守卫在 cwd 切换时阻塞正确加载，导致回退 selection（gate 误弹）
// 用法: node tests/repro-gate-flake.js
// 期望: 第一次 loadSnapshot('') 回退为 null（fallback），第二次 loadSnapshot(correctCwd) 应为 github 却被守卫拦截 -> 保持 null -> 误弹 gate

console.log('=== repro: gate flake due to snapLoading guard race ===')
// ---------- 模拟 host ----------
async function mockHostSelection(cwd){
  // 模拟 registry.select：空 cwd -> fallback null（gate），正确 cwd -> github
  if(!cwd) return { backendId: null, source: 'fallback', pending: undefined }
  if(cwd.includes('dsh-mattpocock-skills-deck')) return { backendId: 'github', source: 'matches', ref: { backend:'github', refId: cwd, name:'deck' } }
  return { backendId: null, source: 'fallback' }
}
async function delayed(ms){ return new Promise(r=> setTimeout(r, ms)) }
async function mockHostSnapshot(cwd){
  // 模拟 wf.snapshot 返回
  const delayMs = !cwd ? 300 : 120; await delayed(delayMs); const sel = await mockHostSelection(cwd)
  return { ok: true, maps: [{number:1}], selection: sel, repository: sel.backendId? {backend: sel.backendId, refId: cwd, name: cwd}: null, generatedMs: Date.now(), version: 'v-'+cwd }
}

// ---------- 模拟 client store + probe logic（摘自 src/client/kernel/probe.js）----------
const pendingSnapshotByCwd = new Map()
function normCwdClientProbe(k){ try{ return String(k||'').toLowerCase().replace(/\\/g,'/').replace(/\/+/g,'/').replace(/\/$/,'')||'/'; }catch(e){ return String(k||''); } }

function createStore(initialCwd){
  return { cwd: initialCwd, snapshot: null, selection: null, snapMode: 'loading', snapLoading: false, tick:0, subs:[] }
}
function emit(st){ st.tick++ }

// 精确复刻 probe.js 的 loadSnapshot（含 st.snapLoading 守卫 + pendingSnapshotByCwd dedup）
function loadSnapshot(st, force){
  const doLoad = function(){
    try{ const _nk=normCwdClientProbe(st.cwd||''); const _pend=pendingSnapshotByCwd.get(_nk); if(_pend&&_pend.promise) return _pend.promise; }catch(e){}
    if (st.snapLoading && !force) {
      console.log('[DEBUG-gate-flake] blocked by snapLoading guard — cwd=', JSON.stringify(st.cwd), 'pending clean?', pendingSnapshotByCwd.has(normCwdClientProbe(st.cwd||'')))
      return Promise.resolve('blocked')
    }
    st.snapLoading = true
    const _normKeyP = normCwdClientProbe(st.cwd||'')
    const _rawP = mockHostSnapshot(st.cwd)
    const p = _rawP.then(function(snap){
      st.snapLoading = false
      if(snap && snap.ok && Array.isArray(snap.maps)){
        st.snapshot = snap
        st.snapMode = 'real'
        st.selection = snap.selection
        if(snap.repository) st.repository = snap.repository
      }
      try{ pendingSnapshotByCwd.delete(_normKeyP)}catch{}
      emit(st)
      return snap
    }).catch(function(e){ st.snapLoading=false; try{ pendingSnapshotByCwd.delete(_normKeyP)}catch{}; emit(st); throw e})
    try{ pendingSnapshotByCwd.set(_normKeyP,{promise:p})}catch(e){}
    return p
  }
  // 空 cwd 分支（简化：不调 wf.cwd，直接 doLoad，复现 stale ''）
  return doLoad()
}

// ---------- 复现步骤 ----------
// 场景：组件挂载时 st.cwd=''，立即触发 loadSnapshot('')（stale）；100ms 后 summaryCwd 到达，s.cwd 被置为正确，但第二次 loadSnapshot 被阻塞
async function repro(){
  const st = createStore('') // 初始空
  console.log('initial st.cwd=', JSON.stringify(st.cwd), 'selection=', st.selection)

  // 第一次：stale 空 cwd 加载（模拟 StatusBar/Probe 初始挂载时 s.cwd 仍为 ''）
  const p1 = loadSnapshot(st, false)
  console.log('p1 started, st.snapLoading=', st.snapLoading, 'pending keys', Array.from(pendingSnapshotByCwd.keys()))

  // 50ms 后，正确 cwd 到达（模拟 summaryCwd effect）
  await new Promise(r=> setTimeout(r, 50))
  st.cwd = 'D:\\dsh-plugin\\dsh-mattpocock-skills-deck'
  console.log('>> summaryCwd arrived, st.cwd now', JSON.stringify(st.cwd), 'st.snapLoading', st.snapLoading)

  // 第二次：尝试加载正确 cwd（应为 github，但被守卫拦截）
  const p2 = loadSnapshot(st, false)
  const r2 = await p2
  console.log('p2 result (should be github snapshot but is blocked?):', r2 === 'blocked' ? 'BLOCKED (bug)' : JSON.stringify(r2.selection).slice(0,200))

  // 等 p1 完成
  const r1 = await p1
  console.log('p1 result selection', JSON.stringify(r1.selection))

  // 观察最终状态
  await new Promise(r=> setTimeout(r, 100))
  console.log('final st.cwd', JSON.stringify(st.cwd))
  console.log('final st.selection', JSON.stringify(st.selection))
  console.log('final st.snapMode', st.snapMode)
  console.log('final st.snapshot repo', st.snapshot && st.snapshot.repository)

  // 判定：是否误弹 gate？
  const sel = st.selection || (st.snapshot && st.snapshot.selection) || null
  const isOther = !!(sel && sel.backendId===null && !sel.pending)
  const isGate = isOther && !!st.cwd && st.snapMode==='real' && !!st.snapshot
  console.log('\n=== 判定 gate ===')
  console.log('selection', sel)
  console.log('isOther (backendId null)', isOther)
  console.log('snapMode', st.snapMode, 'cwd', !!st.cwd, 'snapshot', !!st.snapshot)
  console.log('gate should show?', isGate)
  console.log('EXPECTED: gate should be FALSE (github selected), bug = TRUE')
  if(isGate){
    console.log('\n🔴 REPRO SUCCESS — bug reproduced! gate 偶现误弹（st.snapLoading 守卫阻塞了正确 cwd 加载）')
    console.log('HYPOTHESIS 1 CONFIRMED: snapLoading 全局守卫导致 cwd 切换时正确快照被丢弃，残留 stale fallback')
    process.exit(1)
  } else {
    console.log('\n🟢 REPRO FAIL — gate 未误弹（bug 未复现或已修复）')
    process.exit(0)
  }
}

repro().catch(e=>{ console.error(e); process.exit(2)})
