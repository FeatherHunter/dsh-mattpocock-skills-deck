/**
 * src/client/kernel/probe-chain.js — 内核模块（#456 由 probe.js 拆出之链自动刷新、链加载与链派生）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    // #228/#284 链渲染器主机侧数据：wf.chain 全链快照（通用链 + 后端链，按后端动态，refresh 联动）
    // #284 迁移：九格目录视图（wf.status/checks）退役，全部读数点位改从链快照派生。
    // #284 修订（对抗式审查 2026-08-28）：并发门——同 cwd 同轮次的 in-flight 请求复用；
    //   面板多组件（ChecksTab/StatusBar/Dock）挂载并发调用不再重复触发 25 名技能探测与 gh 网络调用。
    const _chainInflightByCwd = new Map()
    // #344 修复（2026-08-31）：链自动重求值 — 当链非全绿时周期 force 重算，直至全绿后停止
    // 原理：tracker:initialized 等声明式检查的推进只来自重求值，初始化完成后文件写入为链外事件；
    // 宿主侧链缓存“未全绿不缓存”已保证 force 可穿透，但客户端无自动触发导致黄条常驻需手动点“重查”。
    // 本调度在每次链加载后检查，若存在非 done 步骤则 8s 后自动 force 重算，跨工作区隔离、单定时器防抖。
    const CHAIN_AUTO_POLL_MS = 8000
    const _chainAutoPollTimers = new Map()
    export const scheduleChainAutoRefresh = function(st, ms){
      try{
        const bid = (st.selection && st.selection.backendId) || ''
        const key = (typeof getChainCacheKey === 'function' ? getChainCacheKey(st.cwd, bid) : String(st.cwd||'')+'|'+String(bid))
        if(!key || _chainAutoPollTimers.has(key)) return
        const delay = (typeof ms === 'number' && ms>0) ? ms : CHAIN_AUTO_POLL_MS
        const tid = (typeof timer !== 'undefined' && timer && typeof timer.timeout === 'function')
          ? timer.timeout(function(){ _chainAutoPollTimers.delete(key); try{ const snap = st.chainSnapshot; const steps = snap && Array.isArray(snap.steps) ? snap.steps : []; const notDone = steps.some(function(s){ return s.status !== 'done' }); if(notDone && st.cwd) loadChain(st, true) }catch(e){} }, delay)
          : setTimeout(function(){ _chainAutoPollTimers.delete(key); try{ const snap = st.chainSnapshot; const steps = snap && Array.isArray(snap.steps) ? snap.steps : []; const notDone = steps.some(function(s){ return s.status !== 'done' }); if(notDone && st.cwd) loadChain(st, true) }catch(e){} }, delay)
        _chainAutoPollTimers.set(key, tid)
      }catch(e){}
    }
    export const cancelChainAutoRefresh = function(st){
      try{
        const bid = (st.selection && st.selection.backendId) || ''
        const key = (typeof getChainCacheKey === 'function' ? getChainCacheKey(st.cwd, bid) : String(st.cwd||'')+'|'+String(bid))
        const tid = _chainAutoPollTimers.get(key)
        if(tid){ try{ clearTimeout(tid) }catch(e){} _chainAutoPollTimers.delete(key) }
      }catch(e){}
    }
    export const loadChain = function(st, force){
      if (typeof host === 'undefined' || typeof host.call !== 'function') return Promise.resolve(null)
      // 链共享键 = 工作区键 + 后端 id（#324），确保按工作区单次求值且按后端隔离
      const _backendIdForChain = (st.selection && st.selection.backendId) || ''
      const norm = (typeof getChainCacheKey === 'function' ? getChainCacheKey(st.cwd, _backendIdForChain) : ((typeof keyOf === 'function' ? keyOf(st.cwd) : String(st.cwd||'')) + '|' + String(_backendIdForChain)))
      if (!force) {
        const inflight = _chainInflightByCwd.get(norm)
        if (inflight) return inflight
        // 链共享缓存命中即秒显（#324 新会话首见即秒显）
        try {
          const cached = (typeof getCachedChain === 'function' ? getCachedChain(st.cwd, _backendIdForChain) : null)
          if (cached) {
            st.chainSnapshot = cached
            st.chain = cached.chain || cached
            st.fullChain = cached.fullChain || null
            st.backendChain = cached.backendChain || null
            st.chainLoadedAt = (typeof nowStr === 'function' ? nowStr() : '')
            // 已秒显则不发请求，直接返回
            // 但仍需让调用方感知已就绪，返回已解析的 promise
            return Promise.resolve(cached)
          }
        } catch (eCache) {}
      }
      // 2026-08-28 修复（后端物理隔离）：链的后端段必须与 UI 当前绑定的后端一致——
      //   此前只传 cwd，host 回退到 detect 自产的 selection（默认 github），导致 markdown 工作区出现 GitHub 检查行。
      const args = Object.assign({}, st.cwd ? { cwd: st.cwd } : {}, (st.selection && st.selection.backendId) ? { backendId: st.selection.backendId } : {}, force ? { force:true } : {})
      const p = host.call('wf.chain', args).then(function(res){
        if (res && res.ok && (res.fullSnapshot || res.snapshot)) {
          const snap = res.fullSnapshot || res.snapshot
          st.chainSnapshot = snap
          st.chain = res.chain
          st.fullChain = res.fullChain || null
          st.chainResolved = res.resolved
          st.backendChain = res.backendChain || null
          st.chainLoadedAt = nowStr()
          // 落共享缓存，供同工作区其他会话秒显
          try { if (typeof setCachedChain === 'function') setCachedChain(st.cwd, _backendIdForChain, snap) } catch(eSet){}
          emit(st)
          // #344 自动重求值调度：非全绿时安排下一次 force 重算，全绿时取消
          try{
            const steps = snap && Array.isArray(snap.steps) ? snap.steps : []
            const notDone = steps.some(function(s){ return s.status !== 'done' })
            if(notDone) scheduleChainAutoRefresh(st, CHAIN_AUTO_POLL_MS)
            else cancelChainAutoRefresh(st)
          }catch(eAuto){}
          return snap
        }
        return null
      }).catch(function(e){
        // #344 加固：宿主异常也安排重试（探测暂时不可用时 8s 后再探，避免黄条卡死）
        try{ const snapPrev = st.chainSnapshot; const stepsPrev = snapPrev && Array.isArray(snapPrev.steps) ? snapPrev.steps : []; const notDonePrev = stepsPrev.length ? stepsPrev.some(function(s){ return s.status !== 'done' }) : true; if(notDonePrev && st.cwd) scheduleChainAutoRefresh(st, CHAIN_AUTO_POLL_MS) }catch(eRetry){}
        return null }).finally(function(){ try { _chainInflightByCwd.delete(norm) } catch (e) {} })
      if (!force) _chainInflightByCwd.set(norm, p)
      return p
    }
    // 单源工作区键（#301 / #324）：全库仅一份 keyOf（shared:workspaceKey），此处已无重复定义
    // ---- 链快照派生读数（#284：单一口径，链步骤即检查项）----
    export const chainSteps = (st) => (st && st.chainSnapshot && Array.isArray(st.chainSnapshot.steps)) ? st.chainSnapshot.steps : []
    export const chainStep = (st, id) => chainSteps(st).find(function (s) { return String(s.id) === String(id) }) || null
    export const chainStepStatus = (st, id) => { const s = chainStep(st, id); return s ? s.status : 'pending' }
    export const chainStepOk = (st, id) => chainStepStatus(st, id) === 'done'
    export const chainStepBad = (st, id) => { const sts = chainStepStatus(st, id); return sts === 'current' || sts === 'fail' }
    // #229 计数口径：pending（诚实未知/未接入）不渲染置灰计入、不计入分子分母
    export const readyCount = (st) => { const cs = chainSteps(st).filter(function (s) { return s.status !== 'pending' }); return cs.length ? cs.filter(function (s) { return s.status === 'done' }).length : -1 }
    export const envTotal = (st) => { const cs = chainSteps(st).filter(function (s) { return s.status !== 'pending' }); return cs.length }
    // v14-22：返回纯数字串（'6/9' / '--/9'），由状态栏 num() 固定宽度渲染；分母 = 非待定步数（动态）
    export const envLabel = (st) => { const n = readyCount(st); const t = envTotal(st); if (t <= 0) return '--'; return n < 0 ? '--/' + t : n + '/' + t }
    export const setupCheck = (st) => chainStep(st, 'tracker:initialized')

    // #370：blockerNames 只列「仍 OPEN」的阻塞者（GitHub 依赖边在阻塞者关闭后仍保留，需按状态过滤）
    export const openBlockers = (t, m) => t.blockedBy.filter(function (b) {
      const bt = m.tickets.find(function (x) { return x.number === b })
      return bt !== undefined && bt.state === 'OPEN'
    })
    export const blockerNames = (t, m) => openBlockers(t, m).map(function (b) {
      const bt = m.tickets.find(function (x) { return x.number === b })
      return bt ? bt.title : ('#' + b)
    }).join('；')

    // v10：从会话快照探测当前工作目录（ConversationSnapshot 字段名多探几个）
    export const detectCwd = function (ss) {
      try {
        if (ss && typeof ss === 'object') {
          for (const k of ['cwd', 'workspacePath', 'projectPath', 'path', 'dir', 'root']) {
            if (typeof ss[k] === 'string' && ss[k]) return ss[k]
          }
        }
      } catch (e) { /* 探测失败走 host 默认 */ }
      return ''
    }
