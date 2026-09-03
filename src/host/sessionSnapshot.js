// src/host/sessionSnapshot.js —— 会话快照电话（H4 #448 从 host/index.js 310–658 搬出电话体，早选前奏改调共享判据，纯结构、行为零变化）。
// 以后谁改它：改快照缓存短路或快照组装的人。预估约340行，超 350 打回。
// 接线：由 index.js 动态 import 加载；早选判据由 index 从启停模块转供给；本文件不引用其他新文件。
export function createSessionSnapshot(deps) {
  const { canonicalKey, selectEarly, isComposerSelection, getTrackerRegistry, getPlatform, ctx, getCache, setCache, CACHE_MS, cacheSnapshotIsCurrent, upcaseSnapStates, computeLevels, groupTickets, getRepoRoot, getRepoKey, readDiskCache, writeDiskCache, adoptSnapshot, detectionExec, getGhPath, getGhLastError, errText, DEFAULT_CWD } = deps
  async function handleSnapshot(args) {
      const cwd = await canonicalKey((args && args.cwd) || DEFAULT_CWD)
      const now = Date.now()
      // 第一性原理分发前置：先算 selection，再决定缓存与数据链路（避免旧 GitHub 缓存遮住 Markdown）
      const _selEarly = await selectEarly({ cwd, backendId: (args && args.backendId) || undefined })
      const useComposerEarly = isComposerSelection(_selEarly)
      const isForce = !!(args && args.force)
      if (!isForce && getCache().snapshot && getCache().cwd === cwd) {
        // GitHub 路径才用 issue 索引校验；Markdown 等走通用缓存时只看时间与 backend 是否一致
        // 权威动作 force 必须无条件重建，不走此短路（P2 要求）
        if (useComposerEarly) {
          const cachedBackend = getCache().snapshot.selection && getCache().snapshot.selection.backendId
          if (cachedBackend === _selEarly.backendId && now - getCache().ts < CACHE_MS) return getCache().snapshot
        } else {
          const current = await cacheSnapshotIsCurrent(getCache().snapshot, cwd)
          if (current === true || (current === null && now - getCache().ts < CACHE_MS)) return getCache().snapshot
        }
      }
      try {
        // 复用已算的 selection，避免二次探测
        let _sel = _selEarly
        if (!_sel) _sel = await selectEarly({ cwd, backendId: (args && args.backendId) || undefined })
        const useComposer = isComposerSelection(_sel)
        if (useComposer) {
          const reg = await getTrackerRegistry()
          const backendId = _sel.backendId
          const tracker = reg.get(backendId)
          if (!tracker) throw new Error('unknown backend ' + backendId)
          let repoRef = null
          try { repoRef = reg.describe({ cwd }, backendId) } catch {}
          if (!repoRef) repoRef = { backend: backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || backendId, url: '' }
          const ctx2 = { cwd, platform: await getPlatform(), fs: ctx.get('fs'), exec: detectionExec }
          const { createSnapshotComposer } = await import('./tracker/snapshot.js')
          const composer = createSnapshotComposer(reg, { snapshotTtl: 5000 })
          const res = await composer.composeSnapshot(backendId, repoRef, ctx2, { ifNoneMatch: (args && (args.ifNoneMatch || args.version)) || '', force: !!(args && args.force) })
          if (!res.ok) throw new Error((res.error && res.error.message) || 'composeSnapshot failed')
                    const inner = upcaseSnapStates(res.snapshot)
          const flatTickets = (inner.maps || []).flatMap(function(m){ return (m.tickets || []); })
          const allForList = []
          ;(inner.maps || []).forEach(function(m){
            if (m.key != null && m.number == null) {
              const n = parseInt(m.key, 10)
              if (!isNaN(n)) m.number = n
            }
            if (m.key != null) m.key = String(m.key)
            allForList.push(m)
          })
          flatTickets.forEach(function(t){
            if (t.key != null && t.number == null) {
              const n = parseInt(t.key, 10)
              if (!isNaN(n)) t.number = n
            }
            if (t.key != null) t.key = String(t.key)
            if (Array.isArray(t.blockedBy)) {
              t.blockedBy = t.blockedBy.map(function(ref){
                if (typeof ref === 'number') return ref
                if (ref && typeof ref === 'object' && ref.key != null) {
                  const nk = String(ref.key)
                  const nn = parseInt(nk, 10)
                  if (!isNaN(nn)) return nn
                  return nk
                }
                return ref
              })
            }
            allForList.push(t)
          })
          ;(inner.issues || []).forEach(function(it){
            if (it.key != null && it.number == null) {
              const n = parseInt(it.key, 10)
              if (!isNaN(n)) it.number = n
            }
            if (it.key != null) it.key = String(it.key)
            allForList.push(it)
          })
          const labels = inner.labels || (function(){
            const mm = {}
            ;[].concat(inner.maps || []).concat(flatTickets).forEach(function(x){ (x.labels||[]).forEach(function(l){ if(l.color && !mm[l.name]) mm[l.name]=l.color }) })
            return Object.entries(mm).map(function(e){ return {name:e[0], color:e[1]} })
          })()
          let backendModules = null
          try {
            const regM = await getTrackerRegistry()
            if (regM && typeof regM.modules === 'function') {
              backendModules = regM.modules().map(function(m){ return Object.assign({id:m.id,label:m.label,presentation:m.presentation}, m.links?{links:m.links}:{}, m.capabilities?{capabilities:m.capabilities}:{}, m.prompts?{prompts:m.prompts}:{}, m.setupPrompt?{setupPrompt:m.setupPrompt}:{}, m.labelPalette?{labelPalette:m.labelPalette}:{}, m.openRepository?{openRepository:m.openRepository}:{}) })
            }
          } catch {}
          // B: 补全调色盘全量（文件约束内满足契约：triage 表即全量表，未用标签也常驻，色取默认表；已用标签的色已在 labels 中为票面最终色）
          try {
            if(backendId==='markdown' && Array.isArray(labels) && backendModules){
              const mdMod = backendModules.find(function(m){ return m && m.id==='markdown' && Array.isArray(m.labelPalette) })
              const palette = mdMod && mdMod.labelPalette
              if(Array.isArray(palette) && palette.length){
                const have = {}
                labels.forEach(function(l){ if(l && l.name) have[String(l.name).trim()] = true })
                palette.forEach(function(p){
                  const nm = p && p.name ? String(p.name).trim() : ''
                  if(!nm || have[nm]) return
                  labels.push({name: nm, color: String(p.color||'cccccc').replace(/^#/,'')})
                })
              }
            }
          } catch {}
          // Q7: 兜底 url（Issue.url 为空时按后端现算；github 走 https，markdown 走盘符路径）
          try {
            if(backendId==='markdown' && Array.isArray(allForList) && allForList.length){
              const mdModForUrl = backendModules && backendModules.find(function(m){ return m && m.id==='markdown' })
              const urlFn = mdModForUrl && typeof mdModForUrl.issueUrl === 'function' ? mdModForUrl.issueUrl : null
              const tmpRef = repoRef
              if(urlFn){
                allForList.forEach(function(it){
                  if(!it || it.url) return
                  const k = it.key != null ? String(it.key).trim() : (it.number != null ? String(it.number).trim() : '')
                  if(!k) return
                  try { const u = urlFn(tmpRef, k); if(u) it.url = u } catch {}
                })
                ;(inner.maps||[]).forEach(function(m){
                  if(m && !m.url){
                    try {
                      const mk = m.key != null ? String(m.key).trim() : '00'
                      const mu = urlFn(tmpRef, mk)
                      if(mu) m.url = mu
                    } catch {}
                  }
                })
              }
            }
          } catch {}
          const repoRoot = await getRepoRoot(cwd)
          const snap = {
            ok: true,
            repo: null,
            repoRoot: repoRoot,
            updatedAt: new Date().toISOString(),
            generatedMs: Date.now(),
            env: { ghPath: getGhPath(), ghError: getGhLastError() },
            maps: inner.maps,
            issues: allForList,
            labels: labels,
            repository: repoRef,
            backendModules: backendModules,
            selection: _sel,
            capabilities: null,
            viewer: null,
            viewerLogin: null,
            deck: inner.deck,
          }
          return adoptSnapshot(snap, cwd)
        }
        // 统一契约：所有后端均走 composeSnapshot，不再硬走 buildSnapshot 直调 gh
        if (!_sel || !_sel.backendId) {
          const repoRoot = await getRepoRoot(cwd)
          let backendModules = null
          try {
            const regM = await getTrackerRegistry()
            if (regM && typeof regM.modules === 'function') {
              backendModules = regM.modules().map(function(m){ return Object.assign({id:m.id,label:m.label,presentation:m.presentation}, m.links?{links:m.links}:{}, m.capabilities?{capabilities:m.capabilities}:{}, m.prompts?{prompts:m.prompts}:{}, m.setupPrompt?{setupPrompt:m.setupPrompt}:{}, m.labelPalette?{labelPalette:m.labelPalette}:{}, m.openRepository?{openRepository:m.openRepository}:{}) })
            }
          } catch {}
          const snap = {
            ok: true,
            repo: null,
            repoRoot,
            updatedAt: new Date().toISOString(),
            generatedMs: Date.now(),
            env: { ghPath: getGhPath(), ghError: getGhLastError() },
            maps: [],
            issues: [],
            labels: [],
            repository: null,
            backendModules,
            selection: _sel,
            capabilities: null,
            viewer: null,
            viewerLogin: null,
            deck: { total:0, open:0, closed:0, frontier:0, claimed:0, blocked:0, indeterminate:0, levels:[], levelOf:{} },
          }
          return adoptSnapshot(snap, cwd)
        }
        // GitHub 同样走编排器（经 registry.get('github').list），不再直调 buildSnapshot 硬走 gh
        const reg2 = await getTrackerRegistry()
        const backendId2 = _sel.backendId
        const tracker2 = reg2.get(backendId2)
        if (!tracker2) throw new Error('unknown backend ' + backendId2)
        let repoRef2 = null
        try { repoRef2 = reg2.describe({ cwd }, backendId2) } catch {}
        if (!repoRef2 || !repoRef2.refId) {
          const rk = await getRepoKey(cwd)
          if (rk && rk.owner && rk.name) {
            repoRef2 = { backend: backendId2, refId: rk.owner + '/' + rk.name, name: rk.owner + '/' + rk.name, url: 'https://github.com/' + rk.owner + '/' + rk.name }
          } else {
            const repoRootNoRepo = await getRepoRoot(cwd)
            let backendModulesNoRepo = null
            try {
              const regMNo = await getTrackerRegistry()
              if (regMNo && typeof regMNo.modules === 'function') {
                backendModulesNoRepo = regMNo.modules().map(function(m){ return Object.assign({id:m.id,label:m.label,presentation:m.presentation}, m.links?{links:m.links}:{}, m.capabilities?{capabilities:m.capabilities}:{}, m.prompts?{prompts:m.prompts}:{}, m.setupPrompt?{setupPrompt:m.setupPrompt}:{}, m.labelPalette?{labelPalette:m.labelPalette}:{}, m.openRepository?{openRepository:m.openRepository}:{}) })
              }
            } catch {}
            const _selNoRepo = (typeof _sel !== 'undefined' ? _sel : (typeof _selEarly !== 'undefined' ? _selEarly : null))
            const snapNoRepo = {
              ok: true,
              repo: null,
              repoRoot: repoRootNoRepo,
              updatedAt: new Date().toISOString(),
              generatedMs: Date.now(),
              env: { ghPath: getGhPath(), ghError: getGhLastError() },
              maps: [],
              issues: [],
              labels: [],
              repository: null,
              backendModules: backendModulesNoRepo,
              selection: _selNoRepo,
              capabilities: null,
              viewer: null,
              viewerLogin: null,
              deck: { total:0, open:0, closed:0, frontier:0, claimed:0, blocked:0, indeterminate:0, levels:[], levelOf:{} },
            }
            return adoptSnapshot(snapNoRepo, cwd)
          }
        }
        const repo0b = await getRepoKey(cwd)
        const diskb = await readDiskCache(repo0b)
        if (diskb && diskb.selection && diskb.selection.backendId === backendId2) {
          const currentb = await cacheSnapshotIsCurrent(diskb, cwd)
          if (currentb !== false) return adoptSnapshot(Object.assign({}, diskb, { fromCache: true }), cwd)
        }
        const ctx2b = { cwd, platform: await getPlatform(), fs: ctx.get('fs'), exec: detectionExec }
        const { createSnapshotComposer: createComposer2 } = await import('./tracker/snapshot.js')
        const composer2 = createComposer2(reg2, { snapshotTtl: 5000 })
        const res2 = await composer2.composeSnapshot(backendId2, repoRef2, ctx2b, { ifNoneMatch: (args && (args.ifNoneMatch || args.version)) || '', force: !!(args && args.force) })
        if (!res2.ok) throw new Error((res2.error && res2.error.message) || 'composeSnapshot failed')
                  const inner2 = upcaseSnapStates(res2.snapshot)
        ;(inner2.maps || []).forEach(function(m){ 
          if (m.number == null && m.key != null) { const nn = parseInt(m.key,10); if(!isNaN(nn)) m.number = nn; }
          try {
            const tickets = m.tickets || []
            // 补 number（GitHub 仅有 key，旧的地图列表和地图详情用 number 展示）
            // 把新形状的阻塞边压成旧视图要的数字数组，把认领人数组派生为旧视图要的认领名字符串，再算层级和统计
            tickets.forEach(function(t){
              if(t && t.key != null && t.number == null){ const nn=parseInt(t.key,10); if(!isNaN(nn)) t.number=nn; if(t.key!=null) t.key=String(t.key) }
              if (t && Array.isArray(t.blockedBy)) {
                t.blockedBy = t.blockedBy.map(function(ref){
                  if (typeof ref === 'number') return ref
                  if (ref && typeof ref === 'object' && ref.key != null) {
                    const nk = String(ref.key)
                    const nn = parseInt(nk, 10)
                    if (!isNaN(nn)) return nn
                    return nk
                  }
                  return ref
                })
              }
              if (t && t.claimedBy == null) {
                const owners = t.assignees
                if (Array.isArray(owners) && owners.length) t.claimedBy = (owners[0] && owners[0].login) || ''
                else t.claimedBy = ''
              }
            })
            const lvInfo = (typeof computeLevels === 'function') ? computeLevels(tickets) : { byNumber: {} }
            tickets.forEach(function(t){ 
              if (t.number != null && lvInfo.byNumber && lvInfo.byNumber[t.number] != null) t.level = lvInfo.byNumber[t.number]
              else if (t.key != null && lvInfo.byKey && lvInfo.byKey[t.key] != null) t.level = lvInfo.byKey[t.key]
            })
            const stats = (typeof groupTickets === 'function') ? groupTickets(tickets) : { total: tickets.length, open: tickets.filter(function(x){return x.state!=='CLOSED'}).length, closed: tickets.filter(function(x){return x.state==='CLOSED'}).length, frontier:0, claimed:0, blocked:0, levels:[], levelOf:{} }
            m.stats = stats
          } catch {}
        })
        ;(inner2.issues || []).forEach(function(it){ if (it.number == null && it.key != null) { const nn = parseInt(it.key,10); if(!isNaN(nn)) it.number = nn; } })
        let allForList2 = [].concat(inner2.maps || []).concat((inner2.maps||[]).flatMap(function(m){ return m.tickets||[]; })).concat(inner2.issues||[])
        const labels2 = inner2.labels || (function(){
          const mm = {}
          ;[].concat(inner2.maps||[]).concat(inner2.issues||[]).forEach(function(x){ (x.labels||[]).forEach(function(l){ if(l.color && !mm[l.name]) mm[l.name]=l.color }) })
          return Object.entries(mm).map(function(e){ return {name:e[0], color:e[1]} })
        })()
        let backendModules2 = null
        try {
          const regM2 = await getTrackerRegistry()
          if (regM2 && typeof regM2.modules === 'function') {
            backendModules2 = regM2.modules().map(function(m){ return Object.assign({id:m.id,label:m.label,presentation:m.presentation}, m.links?{links:m.links}:{}, m.capabilities?{capabilities:m.capabilities}:{}, m.prompts?{prompts:m.prompts}:{}, m.setupPrompt?{setupPrompt:m.setupPrompt}:{}, m.labelPalette?{labelPalette:m.labelPalette}:{}, m.openRepository?{openRepository:m.openRepository}:{}) })
          }
        } catch {}
        const repoRoot2 = await getRepoRoot(cwd)
        let viewer2 = null, viewerLogin2 = null
        try {
          const tr = reg2.get(backendId2)
          if (tr && typeof tr.getCurrentUser === 'function') {
            const vr = await tr.getCurrentUser(repoRef2, ctx2b)
            if (vr && vr.ok && vr.data) { viewer2 = vr.data; viewerLogin2 = vr.data.login || null }
          }
        } catch {}
        const snap2 = {
          ok: true,
          repo: repo0b,
          repoRoot: repoRoot2,
          updatedAt: new Date().toISOString(),
          generatedMs: Date.now(),
          env: { ghPath: getGhPath(), ghError: getGhLastError() },
          maps: inner2.maps,
          issues: allForList2,
          labels: labels2,
          repository: repoRef2,
          backendModules: backendModules2,
          selection: _sel,
          capabilities: null,
          viewer: viewer2,
          viewerLogin: viewerLogin2,
          deck: inner2.deck,
        }
        await writeDiskCache(snap2.repo, snap2)
        return adoptSnapshot(snap2, cwd)
      } catch (e) {
        setCache({ ts: Date.now(), snapshot: null, error: errText(e), cwd: cwd })
        return { ok: false, error: errText(e), env: { ghError: getGhLastError() } }
      }
  }
  return { handleSnapshot }
}
