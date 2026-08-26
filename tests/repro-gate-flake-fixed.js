// repro-gate-flake-fixed.js — 验证 H1+H2 修复后应为绿
console.log('=== fixed repro: test H1 guard removal + H2 stale discard ===')
async function delayed(ms){ return new Promise(r=> setTimeout(r, ms)) }
async function mockHostSelection(cwd){
  if(!cwd) return { backendId: null, source: 'fallback' }
  if(cwd.includes('dsh-mattpocock-skills-deck')) return { backendId: 'github', source: 'matches', ref: { backend:'github', refId: cwd, name:'deck' } }
  return { backendId: null, source: 'fallback' }
}
async function mockHostSnapshot(cwd){
  const delayMs = !cwd ? 300 : 120; await delayed(delayMs);
  const sel = await mockHostSelection(cwd)
  return { ok: true, maps: [{number:1}], selection: sel, repository: sel.backendId? {backend: sel.backendId, refId: cwd, name: cwd}: null, generatedMs: Date.now(), version: 'v-'+cwd }
}
const pendingSnapshotByCwd = new Map()
function norm(k){ try{ return String(k||'').toLowerCase().replace(/\\/g,'/').replace(/\/+/g,'/').replace(/\/$/,'')||'/'; }catch(e){ return String(k||''); } }
function createStore(cwd){ return { cwd, snapshot:null, selection:null, snapMode:'loading', snapLoading:false, tick:0 } }
function emit(st){ st.tick++ }

// 修复版 loadSnapshot：1) 移除全局 snapLoading 守卫，改为 pendingSnapshotByCwd dedup 2) 响应时校验 cwd 未变
function loadSnapshotFixed(st, force){
  const doLoad = function(){
    const _nk = norm(st.cwd||'')
    const _pend = pendingSnapshotByCwd.get(_nk)
    if(_pend && _pend.promise && !force) {
      console.log('[fixed] dedup hit for', _nk, 'reuse promise')
      return _pend.promise
    }
    // 不再检查 st.snapLoading
    const _normKeyP = _nk
    const requestCwd = st.cwd // 快照请求时的 cwd，用于 stale 丢弃
    const _rawP = mockHostSnapshot(st.cwd)
    const p = _rawP.then(function(snap){
      // stale 丢弃：若期间 cwd 已变且与请求 cwd 不一致，不应用
      if(norm(st.cwd||'') !== _normKeyP){
        console.log('[fixed] stale discard: request', JSON.stringify(requestCwd), 'current', JSON.stringify(st.cwd))
        try{ pendingSnapshotByCwd.delete(_normKeyP)}catch{}
        return snap
      }
      if(snap && snap.ok && Array.isArray(snap.maps)){
        st.snapshot = snap; st.snapMode='real'; st.selection=snap.selection
      }
      try{ pendingSnapshotByCwd.delete(_normKeyP)}catch{}; emit(st); return snap
    }).catch(function(e){ try{ pendingSnapshotByCwd.delete(_normKeyP)}catch{}; emit(st); throw e})
    try{ pendingSnapshotByCwd.set(_normKeyP,{promise:p})}catch(e){}
    return p
  }
  return doLoad()
}

async function repro(){
  const st = createStore('')
  console.log('initial', st.cwd)
  const p1 = loadSnapshotFixed(st,false)
  console.log('p1 started')
  await delayed(50)
  st.cwd = 'D:\\dsh-plugin\\dsh-mattpocock-skills-deck'
  console.log('cwd switched to', st.cwd)
  const p2 = loadSnapshotFixed(st,false)
  const r2 = await p2
  console.log('p2 selection', r2.selection)
  const r1 = await p1
  console.log('p1 selection', r1.selection, '(should be discarded)')
  await delayed(100)
  console.log('final selection', st.selection)
  const sel = st.selection || (st.snapshot && st.snapshot.selection) || null
  const isOther = !!(sel && sel.backendId===null && !sel.pending)
  const isGate = isOther && !!st.cwd && st.snapMode==='real' && !!st.snapshot
  console.log('gate?', isGate, 'expected false')
  if(isGate){ console.log('🔴 fixed repro FAILED'); process.exit(1) } else { console.log('🟢 fixed repro PASS — H1+H2 修复有效'); process.exit(0)}
}
repro()
