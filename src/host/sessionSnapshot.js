// src/host/sessionSnapshot.js —— 会话快照电话（H4 #448 从 host/index.js 310–658 搬出电话体，早选前奏改调共享判据，纯结构、行为零变化）。
// 以后谁改它：改快照缓存短路或快照组装的人。预估约340行，超 350 打回。
// 接线：由 index.js 动态 import 加载；早选判据由 index 从启停模块转供给；本文件不引用其他新文件。
export function createSessionSnapshot(deps) {
  const { canonicalKey, selectEarly, isComposerSelection, getTrackerRegistry, getPlatform, ctx, getCache, setCache, CACHE_MS, cacheSnapshotIsCurrent, upcaseSnapStates, computeLevels, groupTickets, getRepoRoot, getRepoKey, readDiskCache, writeDiskCache, adoptSnapshot, detectionExec, getGhPath, getGhLastError, errText, DEFAULT_CWD, logCtx, getChoiceStore } = deps
  // #589 去重加载器（D7 禁止静态 import，动态接线；与 _dispatchMetaP 同模式）
  let _dedupeP = null
  function _dedupe() { if (!_dedupeP) _dedupeP = import('../shared/tracker/list-dedupe.js'); return _dedupeP }
  // #595：快照带后端的 prompts 声明（正文格式按当前后端解析）。盘缓存存的是旧 backendModules、无 prompts，直接回放会丢两步写回，故命中时用当前注册表重挂，取不到保留原值。
  async function freshBackendModules() {
    try {
      const regM = await getTrackerRegistry()
      if (regM && typeof regM.modules === 'function') {
        return regM.modules().map(function (m) { return Object.assign({ id: m.id, label: m.label, presentation: m.presentation }, m.links ? { links: m.links } : {}, m.capabilities ? { capabilities: m.capabilities } : {}, m.prompts ? { prompts: m.prompts } : {}, m.setupPrompt ? { setupPrompt: m.setupPrompt } : {}, m.labelPalette ? { labelPalette: m.labelPalette } : {}, m.openRepository ? { openRepository: m.openRepository } : {}) })
      }
    } catch (e) {}
    return null
  }
  // #491 房外埋点 helpers：hash8 只记散列；P1 外层先判开关+采样，字段函数只在守卫内求值。
  // #653 快照多带 workspaceRoot（即开头算出的 cwd，已锚到工作区根）；客户端靠它按根分桶并渲染归属提示，自己算不出根故由宿主带过去。
  function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  // #683（F1 · ADR 的 R6）：快照里带上记住的布局答案（同 R4 那条路：落后的那扇窗不靠它就永远停在老答案上）。
  async function readSetupLayoutOf(cwd) { try { const cs = (typeof getChoiceStore === 'function') ? await getChoiceStore() : null; if (!cs || typeof cs.getLayout !== 'function') return null; const r = await cs.getLayout(cwd); return (r && r.found === true) ? { layout: r.layout, pickedAt: r.pickedAt } : null } catch (e) { return null } }
  // 五条分支的快照同形，收在一处组装（#653：加字段改一处，免漏；repo 与 repoRoot 由调用方传入）。
  function buildSnap(o) {
    const snap = {
      ok: true,
      repo: (o.repo !== undefined ? o.repo : null),
      repoRoot: o.repoRoot,
      workspaceRoot: o.workspaceRoot,
      updatedAt: new Date().toISOString(),
      generatedMs: Date.now(),
      env: { ghPath: getGhPath(), ghError: getGhLastError() },
      maps: o.maps, issues: o.issues, labels: o.labels,
      repository: (o.repository !== undefined ? o.repository : null),
      backendModules: o.backendModules,
      selection: o.selection,
      setupLayout: (o.setupLayout !== undefined ? o.setupLayout : null),
      capabilities: null,
      viewer: (o.viewer !== undefined ? o.viewer : null),
      viewerLogin: (o.viewerLogin !== undefined ? o.viewerLogin : null),
      deck: o.deck,
    }
    return snap
  }
  let snapSampleN = 0
  const snapshotInflight = new Map() // #696 在途合并：同钥匙同后端同强制标记的并发共用同一份重建，强制刷新不进表
  // #689：snapshot.built 多了三个字段（open / closed 是后端计数给的真值、拿不到记 -1；partial 说这份行数据全不全）—— 加在既有事件里不新增一条（每次重建都会走到这里），字段表见 research/489-appendix.md 第 1 章。
  async function adoptSnapLog(snap, c) { try { if (logCtx && snap && snap.fromCache !== true) { const _d = (snap.deck && typeof snap.deck === 'object') ? snap.deck : {}; const _ct = (_d.counts && typeof _d.counts === 'object') ? _d.counts : null; logCtx.fire('info', 'snapshot.built', { maps: (snap.maps || []).length, issues: (snap.issues || []).length, labels: (snap.labels || []).length, open: _ct ? _ct.open : -1, closed: _ct ? _ct.closed : -1, partial: _d.partial === true, latencyMs: Date.now() - (snap.generatedMs || Date.now()) }) } } catch (e) {} return adoptSnapshot(snap, c) }
  async function handleSnapshot(args) {
      const cwd = await canonicalKey((args && args.cwd) || DEFAULT_CWD)
      const now = Date.now()
      // 第一性原理分发前置：先算 selection，再决定缓存与数据链路（避免旧 GitHub 缓存遮住 Markdown）
      const _selEarly = await selectEarly({ cwd, backendId: (args && args.backendId) || undefined, baseRev: (args && args.baseRev) || 0 })
      const _layEarly = await readSetupLayoutOf(cwd) // #683（F1 · R6）：记住的布局答案随每条回包一起回去（同 R4 那条路）
      const useComposerEarly = isComposerSelection(_selEarly)
      const isForce = !!(args && args.force)
      // #683（F1 · ADR 的 R4）：每一条回包都要带权威 {selection, rev}。下面三条短路路径（内存缓存、磁盘回放、以及 304）此前回的是缓存里那份**旧** selection —— 只换了后端时快照内容一个字没变、版本号也没变，客户端就收到「没变」，于是面板头与状态栏继续显示旧后端，而同屏的链与横幅（走 wf.detect）已经按新值答了 —— 自己跟自己打架。
      //   只在「缓存里那条选择与这一轮算出来的不是同一个后端、或修订号变了」时才换一份浅拷贝带上新值；选择没变时照旧返回缓存里那**同一个对象**（缓存优先那条纪律：这一步不重新拼数据，也不联网核对）。
      const shortCircuit = function () {
        const c = getCache(cwd)
        const s = c && c.snapshot
        if (!s || !_selEarly || !_selEarly.backendId) return s
        const prevRev = Number.isInteger(s.selection && s.selection.rev) ? s.selection.rev : 0
        const nowRev = Number.isInteger(_selEarly.rev) ? _selEarly.rev : 0
        const sameBackend = String((s.selection && s.selection.backendId) || '') === String(_selEarly.backendId)
        const sameLayout = String((s.setupLayout && s.setupLayout.layout) || '') === String((_layEarly && _layEarly.layout) || '')
        if (sameBackend && prevRev === nowRev && (sameLayout || !_layEarly)) return s
        const cp = Object.assign({}, s, { selection: _selEarly, rev: nowRev }); if (_layEarly) cp.setupLayout = _layEarly; return cp
      }
      try { if (logCtx) logCtx.fire('info', 'snapshot.request', { cwdHash: hash8(cwd), backend: String((_selEarly && _selEarly.backendId) || ''), force: isForce }) } catch (eL) {}
      const cachedEntry = getCache(cwd)
      if (!isForce && cachedEntry.snapshot) {
        // GitHub 路径才用 issue 索引校验；Markdown 等走通用缓存时只看时间与 backend 是否一致
        // 权威动作 force 必须无条件重建，不走此短路（P2 要求）
        if (useComposerEarly) {
          const cachedBackend = cachedEntry.snapshot.selection && cachedEntry.snapshot.selection.backendId
          if (cachedBackend === _selEarly.backendId && now - cachedEntry.ts < CACHE_MS) { try { if (logCtx && logCtx.isEnabled('debug') && ((++snapSampleN % 100) === 0)) logCtx.fire('debug', 'snapshot.cache.hit', function () { return { kind: 'memory', ageMs: now - cachedEntry.ts } }) } catch (eL) {}; return shortCircuit() }
        } else {
          // 手上有缓存立即交付，不先联网核对（全仓库扫描约 4~5 秒，多为没变，白等）；正确性交 60 秒自动探测，不加年龄门槛。
          return shortCircuit()
        }
        const current = await cacheSnapshotIsCurrent(cachedEntry.snapshot, cwd)
        if (current === true || (current === null && now - cachedEntry.ts < CACHE_MS)) { try { if (logCtx && logCtx.isEnabled('debug') && ((++snapSampleN % 100) === 0)) logCtx.fire('debug', 'snapshot.cache.hit', function () { return { kind: 'memory', ageMs: now - cachedEntry.ts } }) } catch (eL) {}; return shortCircuit() }
      }
      const missReason = (function () { try { if (isForce) return 'force'; const c = getCache(cwd); if (!c.snapshot) return 'empty'; const cb = c.snapshot.selection && c.snapshot.selection.backendId; const nb = _selEarly && _selEarly.backendId; if (cb !== nb) return 'backend-changed'; return 'expired' } catch (e) { return 'expired' } })()
      try { if (logCtx) logCtx.fire('info', 'snapshot.cache.miss', { reason: missReason }) } catch (eL) {}
      // #696 在途合并：同根同后端同语言同强制标记的并发共用同一份重建（快照无语言参数恒为空串，另带修订号与版本号免串份），强制不进表；先回来的写缓存，后到的拿同一份
      const snapshotDedupKey = cwd + '|' + String((_selEarly && _selEarly.backendId) || '') + '|' + String((args && args.lang) || '') + '|' + (isForce ? '1' : '0') + '|' + String((args && args.baseRev) || 0) + '|' + String((args && (args.ifNoneMatch || args.version)) || '')
      if (!isForce) { const ongoing = snapshotInflight.get(snapshotDedupKey); if (ongoing) return await ongoing }
      const snapshotPending = (async function () {
      try {
        // 复用已算的 selection，避免二次探测
        let _sel = _selEarly
        if (!_sel) _sel = await selectEarly({ cwd, backendId: (args && args.backendId) || undefined, baseRev: (args && args.baseRev) || 0 })
        const useComposer = isComposerSelection(_sel)
        if (useComposer) {
          const reg = await getTrackerRegistry()
          const backendId = _sel.backendId
          const tracker = reg.get(backendId)
          if (!tracker) throw new Error('unknown backend ' + backendId)
          let repoRef = null
          try { repoRef = reg.describe({ cwd }, backendId) } catch {}
          if (!repoRef) repoRef = { backend: backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || backendId, url: '' }
          const ctx2 = { cwd, platform: await getPlatform(), fs: ctx.get('fs'), exec: function (c, a, o) { return detectionExec(c, a, o, 'snapshot') } }
          const { createSnapshotComposer } = await import('./tracker/snapshot.js')
          const composer = createSnapshotComposer(reg, { snapshotTtl: 5000 })
          const res = await composer.composeSnapshot(backendId, repoRef, ctx2, { ifNoneMatch: (args && (args.ifNoneMatch || args.version)) || '', force: !!(args && args.force) })
          if (!res.ok) throw new Error((res.error && res.error.message) || 'composeSnapshot failed')
          // #683（F1 · ADR 的 R4）：后端说「没变」（304）时也要把权威选择带上 —— 那正是「只换了后端、 快照内容一个字没变」这个现场：不带的话客户端收到 304 就什么都不做，面板头继续显示旧后端。
          if (res.notModified === true || res.status === 304) {
            const _pair = (_selEarly && _selEarly.backendId) ? { selection: _selEarly, rev: (Number.isInteger(_selEarly.rev) ? _selEarly.rev : 0) } : {}
            if (_layEarly) _pair.setupLayout = _layEarly
            return Object.assign({ ok: true, notModified: true, status: 304, version: res.version || '', cached: true, generatedMs: now }, _pair)
          }
                    const inner = upcaseSnapStates(res.snapshot)
          const flatTickets = (inner.maps || []).flatMap(function(m){ return (m.tickets || []); })
          let allForList = []
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
              // effort 维度：阻塞引用保留原键字符串（'01' 不许转成数字 1），
              // 面板按“工作单元 + 键”查找，数字与字符键对不上会永远查不到；
              // GitHub 数字键本来就是字符串形态，直传同样命中。
              t.blockedBy = t.blockedBy.map(function(ref){
                if (typeof ref === 'number' || typeof ref === 'string') return ref
                if (ref && typeof ref === 'object' && ref.key != null) return String(ref.key)
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
          // #589：三段拼接会让身兼两职的票出现两次，这里按身份收成一行（地图容器优先）
          allForList = (await _dedupe()).dedupeListByPool(allForList)
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
          // B: 补全标签全量（只有本地 Markdown 后端这一段）：没用过的标签也常驻，色取后端自报的内置默认色表 labelPalette（即 backends/markdown/index.js 的 defaultLabelPalette 那 11 枚）；已用标签的颜色已是宿主按工作区配色文件 docs/agents/label-colors.json 算好的票面最终色，这里只补缺、不覆盖（#618：旧的 docs/agents/triage-labels.md 调色盘表不再参与）
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
          const snap = buildSnap({
            repoRoot, workspaceRoot: cwd,
            maps: inner.maps, issues: allForList, labels: labels,
            repository: repoRef, backendModules: backendModules, selection: _sel, setupLayout: _layEarly, deck: inner.deck,
          })
          return adoptSnapLog(snap, cwd)
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
          const snap = buildSnap({
            repoRoot, workspaceRoot: cwd,
            maps: [], issues: [], labels: [],
            backendModules, selection: _sel, setupLayout: _layEarly,
            deck: { total:0, open:0, closed:0, frontier:0, claimed:0, blocked:0, indeterminate:0, levels:[], levelOf:{} },
          })
          return adoptSnapLog(snap, cwd)
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
            const snapNoRepo = buildSnap({
              repoRoot: repoRootNoRepo, workspaceRoot: cwd,
              maps: [], issues: [], labels: [],
              backendModules: backendModulesNoRepo, selection: _selNoRepo, setupLayout: _layEarly,
              deck: { total:0, open:0, closed:0, frontier:0, claimed:0, blocked:0, indeterminate:0, levels:[], levelOf:{} },
            })
            return adoptSnapLog(snapNoRepo, cwd)
          }
        }
        const repo0b = await getRepoKey(cwd)
        const diskb = await readDiskCache(repo0b)
        if (diskb && diskb.selection && diskb.selection.backendId === backendId2) {
          const currentb = await cacheSnapshotIsCurrent(diskb, cwd)
          if (currentb !== false) { try { if (logCtx && logCtx.isEnabled('debug') && ((++snapSampleN % 100) === 0)) logCtx.fire('debug', 'snapshot.cache.hit', function () { return { kind: 'disk', ageMs: Date.now() - (diskb.generatedMs || Date.now()) } }) } catch (eL) {}; const freshModules = await freshBackendModules(); return adoptSnapLog(Object.assign({}, diskb, freshModules ? { backendModules: freshModules } : null, { fromCache: true }), cwd) }
        }
        const ctx2b = { cwd, platform: await getPlatform(), fs: ctx.get('fs'), exec: function (c, a, o) { return detectionExec(c, a, o, 'snapshot') } }
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
                // 与主路径同口径：阻塞引用保留原键字符串，面板按“工作单元 + 键”查找。
                t.blockedBy = t.blockedBy.map(function(ref){
                  if (typeof ref === 'number' || typeof ref === 'string') return ref
                  if (ref && typeof ref === 'object' && ref.key != null) return String(ref.key)
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
        // #589：三段拼接会让身兼两职的票出现两次，这里按身份收成一行（地图容器优先）
        allForList2 = (await _dedupe()).dedupeListByPool(allForList2)
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
        const snap2 = buildSnap({
          repo: repo0b, repoRoot: repoRoot2, workspaceRoot: cwd,
          maps: inner2.maps, issues: allForList2, labels: labels2,
          repository: repoRef2, backendModules: backendModules2, selection: _sel, setupLayout: _layEarly,
          viewer: viewer2, viewerLogin: viewerLogin2, deck: inner2.deck,
        })
        await writeDiskCache(snap2.repo, snap2)
        return adoptSnapLog(snap2, cwd)
      } catch (e) {
        setCache({ ts: Date.now(), snapshot: null, error: errText(e), cwd: cwd })
        return { ok: false, error: errText(e), env: { ghError: getGhLastError() } }
      }
      })()
      if (!isForce) { snapshotInflight.set(snapshotDedupKey, snapshotPending); try { return await snapshotPending } finally { snapshotInflight.delete(snapshotDedupKey) } }
      return await snapshotPending
  }
  return { handleSnapshot }
}
