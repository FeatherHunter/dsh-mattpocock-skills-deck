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
    // #669 第 4 件：回包时怎么判「这一次还算不算数」——两问都过才算，见 loadChain 里那道守卫：
    //   ① 同一个键上后来又发过更新的一次（晚到的旧结果）；
    //   ② 这个会话现在要的已经不是这条链了（键变了：换了后端、换了工作区、换了语言）。
    // 两样都按「键」各记一份：_chainLatestByKey 记这个键上最新那次请求的序号（那一次跑完就摘掉，不留常驻表），
    //   _chainSeqN 是全库自增的序号。按键分开记是为了不串门：A 工作区的重取不会把 B 工作区正在飞的那次顶掉。
    // ① 是按「键」判、不是按「会话」判的，代价写在明处：同一个工作区里两个会话同时 force 重取时，
    //   先发的那次回包会一并被丢掉（同一把键上的两次读数只认最后那一次，免得旧读数顺着共享缓存流到别的会话）。
    //   那一侧不会因此没数据：它手里仍是自己上一份快照，随后的那一拍自刷新或下一次挂载会再取一次。
    // 这一处 2026-09-20 的第一版把「当前那次」冻结在**发请求时**算，于是①那一问变成
    //   「发这一次的时候上一次还在飞吗」，判反了：晚到的旧结果照旧写进会话状态，新那一次反被丢掉。
    // 快照那一侧本来就是回包时重算一次键再比（probe-snapshot.js 的 H2），链这一侧这次补成同一个口径。
    let _chainSeqN = 0
    const _chainLatestByKey = new Map() // Map<链共享键, 这个键上最新那次请求的序号>
    // 链共享键（工作区键 + 后端 id + 语言，见 #324 / #529）只有这一处算法：发请求时算一次，回包时再算一次，
    //   两次算的是同一把尺子，才能判出「这个会话现在要的是不是这条链」。自刷新那两个定时器也用它，不另抄一份。
    const _chainKeyOfState = function (state) {
      const bid = (state && state.selection && state.selection.backendId) || ''
      const lg = (typeof promptLang === 'function' ? promptLang() : 'zh')
      const ws = (typeof wsKeyOf === 'function' ? wsKeyOf(state && state.cwd) : String((state && state.cwd) || ''))
      return (typeof getChainCacheKey === 'function' ? getChainCacheKey(ws, bid, lg) : String(ws || '') + '|' + String(bid) + '|' + String(lg || ''))
    }
    // 这一次回包还算不算数（两问都过才算，见上面那段）。判不出来时一律当「不算数」——宁可少写一次，
    //   也不让一份判不出来源的回包去盖会话状态；下一次探测（挂载时那次、或 8 秒那一拍）会照常补上。
    const _chainRespStale = function (key, seq, state) {
      try { if (_chainLatestByKey.get(key) !== seq) return true } catch (eS) { return true }
      try { return _chainKeyOfState(state) !== key } catch (eK) { return true }
    }
    // #653：链的在途去重与链快照缓存一律按工作区键（wsKeyOf）——同一个仓库里，根会话与子目录会话
    //   是同一条链、同一次求值；此前按会话所选目录分键，两边各求一次、互相看不到对方的链快照。
    // #491 房外埋点：在途复用计数（窗口到记一次；dswsLogHash 同闭包见 probe-snapshot.js）。
    const dswsChainDedupN = { n: 0 }
    // #709（T5）：链自动重求值改事件驱动 —— #344 加的那条 8 秒自轮询（「只要链没全绿就 8 秒后再
    // force 一次」的那一对排期/取消函数，外加它的间隔常量）整体退役，客户端侧不再有任何自续定时器。
    // 为什么删得掉：那条轮询存在的理由是「初始化之类的动作发生在链外，没人告诉链该重算」。
    // 现在事情自己会说话：切进工作区、人点「重新检查」、做完可能改变它的动作（初始化 / 绑定后端 /
    // 装技能）—— 这三路都调下面这一个入口，由宿主按退避判「这次真算还是继续用上一份」
    //（8 秒 → 30 秒 → 2 分钟 → 5 分钟，有进展立刻回快档；全绿之后缓存 30 分钟）。
    // 第四路「写入成功之后」发生在宿主侧（repoKeys 拦到写操作 → chainBackoff.noteWriteActivity 把退避
    // 拉回第一档），不是一个客户端调用点，所以下面枚举里的 write-done 今天只有宿主那一侧在用。
    // 人亲手点的「重新检查」传 'user-recheck'，那一种永不降档。
    export const CHAIN_EVENT_REASONS = {
      enterWorkspace: 'enter-workspace',
      userRecheck: 'user-recheck',
      actionDone: 'action-done',
      writeDone: 'write-done'
    }
    /**
     * 事件触发入口：客户端那几路事件都走这里重取一次链，并把「为什么重取」带给宿主 ——
     *   ① 切进工作区（views/ChecksTab.js 打开检查页那一次，传 force=false，见下一段）；
     *   ② 人亲手点「重新检查」（views/ChecksTab.js 上的按钮、kernel/probe-auto.js 的 refreshAll）；
     *   ③ 做完可能改变它的动作（kernel/store-switch.js 绑定后端、kernel/slotRenderer-repo-sync.js 配置派生）。
     * 返回值与 loadChain 一样是这一次求值的 promise（被退避挡下时宿主直接回上一份快照，界面照常铺满，不会白屏）。
     *
     * 第三个参数是「要不要绕过缓存」：缺省绕过（true）—— ②③ 那几路是人或动作叫起来的，本来就该真问一次；
     * 只有 ①「打开检查页」传 false，那一路沿用缓存优先：共享缓存里有就秒显、不联网（#324 / #653）。
     *
     * 调用点都写了 typeof 兜底：这几个叶子文件也会被几条门禁单独求值，那种沙箱里没有这个入口，
     * 退回直接调 loadChain（行为一样，少的只是这一行按需日志）。
     */
    export const chainEventRefresh = function (st, why, force) {
      const reason = String(why || CHAIN_EVENT_REASONS.enterWorkspace)
      const bypassCache = (force === undefined) ? true : !!force
      try { if (isEnabled('debug')) log('debug', 'chain.event', { reason: reason }) } catch (eL) {}
      if (!st || !st.cwd) return Promise.resolve(null)
      return loadChain(st, bypassCache, reason)
    }
    export const loadChain = function(st, force, trigger){
      if (typeof host === 'undefined' || typeof host.call !== 'function') return Promise.resolve(null)
      // 链共享键 = 工作区键 + 后端 id + 语言（#324 按工作区单次求值按后端隔离；#529 加语言：host 明细按语言产出，中英快照分开缓存，切换语言即时重取）
      const _backendIdForChain = (st.selection && st.selection.backendId) || ''
      const _langForChain = (typeof promptLang === 'function' ? promptLang() : 'zh')
      const norm = _chainKeyOfState(st)
      if (!force) {
        const inflight = _chainInflightByCwd.get(norm)
        if (inflight) { try { dswsChainDedupN.n += 1; if (isEnabled('debug') && dswsChainDedupN.n % 10 === 0) log('debug', 'dedup.hit', { scope: 'chain', keyHash: dswsLogHash(norm) }) } catch (eL) {}; return inflight }
        // 链共享缓存命中即秒显（#324 新会话首见即秒显；#653 起按工作区键，子目录会话秒显根会话的链）
        try {
          const cached = (typeof getCachedChain === 'function' ? getCachedChain(wsKeyOf(st.cwd), _backendIdForChain, _langForChain) : null)
          if (cached) {
            st.chainSnapshot = cached
            st.chain = cached.chain || cached
            st.fullChain = cached.fullChain || null
            st.backendChain = cached.backendChain || null
            st.chainLoadedAt = (typeof nowStr === 'function' ? nowStr() : '')
            st.chainLangLoaded = _langForChain // #529：缓存命中即该语言快照，记下供语言切换判定
            // 已秒显则不发请求，直接返回
            // 但仍需让调用方感知已就绪，返回已解析的 promise
            return Promise.resolve(cached)
          }
        } catch (eCache) {}
      }
      // 2026-08-28 修复（后端物理隔离）：链的后端段必须与 UI 当前绑定的后端一致——
      //   此前只传 cwd，host 回退到 detect 自产的 selection（默认 github），导致 markdown 工作区出现 GitHub 检查行。
      // #529：附带当前语言（host 明细按语言双语产出，不传则恒为中文）
      // #669 第 6 件（ADR 20260921）：只有用户亲手选过的那条才当 hint 上报 —— 派生值不许冒充意图
      const _hintBid = (typeof userHintOf === 'function') ? userHintOf(st.selection) : undefined
      const _hintRev = (typeof baseRevOf === 'function') ? baseRevOf(st.selection) : 0 // #683（F1 · ADR 的 R2）：hint 旁边带上「这条选择是从哪个修订号来的」，宿主才判得出新旧
      const args = Object.assign({}, st.cwd ? { cwd: st.cwd } : {}, _hintBid ? { backendId: _hintBid, baseRev: _hintRev } : {}, force ? { force:true } : {}, { lang: _langForChain }, trigger ? { trigger: String(trigger) } : {})
      const chainT0 = Date.now()
      // 在途登记：这一次请求的序号记在这把键上（#669 第 4 件）。发出去就记，
      //   回包时凭它跟「这个键上最新那次的序号」比一次，比不过就是要丢的那一次（见下面那段竞态说明）。
      const _mySeq = (_chainSeqN += 1)
      try { _chainLatestByKey.set(norm, _mySeq) } catch (eSeq) {}
      const p = host.call('wf.chain', args).then(function(res){
        try { if (res && res.ok) log('info', 'host.call', { method: 'wf.chain', latencyMs: Date.now() - chainT0, ok: true, kind: 'chain' }); else log('warn', 'host.call.fail', { method: 'wf.chain', kind: 'chain', errorHash: dswsLogHash(dswsLogTrunc(String((res && res.error) || 'chain-not-ok'), 120, 'error')) }) } catch (eL) {}
        // 竞态守卫（#669 第 4 件，2026-09-21 重写）：这一次回来的读数还算不算数，按两问判 ——
        //   ① 同一个键上后来又发过更新的一次？② 这个会话现在要的还是不是这条链（键变了没有）？
        //   最常见的那一次：点「确认并继续」选完后端，紧接着 force 重取一次链（#669 第 3 件补的），
        //   而选之前那次请求还飞着 —— 它不带 backendId，回包里没有后端段。旧的那次晚回来如果照写，
        //   界面就从「还没有远端仓库」退回「什么都没有」，前面那一修等于白修。
        //   判据落在回包这一侧（不是发请求那一侧）：一份回包过没过期，只有它回来的时候才说得准。
        // 现在这版之前还有一个 2026-09-20 的写法：把「当前在途的那一次」在发请求时就冻成一个布尔值，
        //   于是它是拿「发这一次的时候上一次还在不在飞」当判据，正好判反 —— 晚到的旧结果被采纳、
        //   新的那一次反被丢掉；更糟的是那把键一旦停在被丢掉的那一次上，后面换后端的重取会连着被丢。
        if (_chainRespStale(norm, _mySeq, st)) {
          try { if (isEnabled('debug')) log('debug', 'chain.stale.drop', { keyHash: dswsLogHash(norm) }) } catch (eDrop) {}
          return null
        }
        if (res && res.ok && (res.fullSnapshot || res.snapshot)) {
          const snap = res.fullSnapshot || res.snapshot
          st.chainSnapshot = snap
          st.chain = res.chain
          st.fullChain = res.fullChain || null
          st.chainResolved = res.resolved
          st.backendChain = res.backendChain || null
          st.chainLoadedAt = nowStr()
          st.chainLangLoaded = _langForChain // #529：记下本次快照语言，语言切换时凭它判定重取
          // 落共享缓存，供同工作区其他会话秒显
          try { if (typeof setCachedChain === 'function') setCachedChain(wsKeyOf(st.cwd), _backendIdForChain, _langForChain, snap) } catch(eSet){}
          emit(st)
          // #709（T5）：这里从前会「只要链没全绿就安排 8 秒后再 force 一次」。现在不排任何定时器：
          // 下一次重算由四种事件带起来，该不该真算由宿主按退避裁定。
          return snap
        }
        try { log('warn', 'chain.derive.error', { stepId: 'chain.snapshot', errorHash: dswsLogHash(dswsLogTrunc(String((res && res.error) || 'chain-derive-empty'), 120, 'error')) }) } catch (eL) {}
        return null
      }).catch(function(e){
        try { log('warn', 'host.call.fail', { method: 'wf.chain', kind: 'chain', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }); log('warn', 'chain.derive.error', { stepId: 'chain.load', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}
        // #709（T5）：这里从前也会排一次 8 秒后的重试。同样退役——宿主异常不该自己给自己续命，
        // 等四种事件里的下一个到来时自然再试一次。
        return null }).finally(function(){
        try { _chainInflightByCwd.delete(norm) } catch (e) {}
        // 收尾：这一次跑完，如果它还是这个键上最新的一次，就把登记摘掉（这张表不留常驻条目；
        //   比它早发的那几次如果这时才回来，比不到自己的序号，照样判成过期）。
        try { if (_chainLatestByKey.get(norm) === _mySeq) _chainLatestByKey.delete(norm) } catch (eK) {}
      })
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
