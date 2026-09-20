/**
 * src/client/kernel/probe-stale.js —— 面板快照那一路的「这一次还算不算数」判断（#669 第 5 件）
 *
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export，把声明体文本拼回
 * src/client/index.js 里那条 probeStale 拼接标记处（apply 闭包内原位），与 ctx.js/seam 同模式，一源两物。
 * （标记原文照仓库惯例不在本注释里复述：产物里再出现一次标记字样会让 verify-kernel 的「无标记残留」变红。）
 * 接口清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 * 以后谁改它：改「面板拿回来的这份快照还算不算数」「在途的那一次还能不能复用」的人。
 *
 * 为什么要有这个文件（真机现场，2026-09-21 用户报「选 Markdown → 点确认切换 → 没有任何反应」）：
 *   面板上飞着一次强制重取（点过刷新，或别处触发的刷新）时，用户点了「确认切换」、宿主那边也真把后端
 *   换成了新的 —— 可绑定成功之后那次重取，被原先「按工作区去重」的规则当成同一次请求**复用掉了**，
 *   一个新请求都没发：面板于是拿回**切换前**那份快照（连 selection 都还是旧后端），仓库标、引导链看着
 *   全没动。客户端这边唯一那个可见反馈是右下角一句 2.8 秒的提示条，很容易错过。
 *
 * 两处一起治：
 *   ① 在途复用与去重键：键从「工作区键」升级成「工作区键 + 后端 id」—— 换过后端就不是同一次请求了，
 *      换后端之后那次重取一定真发一次。同一个后端上的并发重取照旧复用（那是 #366 要的省流量），
 *      而且 force 的那一次仍然不复用非 force 的在途请求（#366 原判据，一个字没动）。
 *   ② 回包时判两问，任一不过就丢弃、不写进会话状态：
 *      问一 这个工作区上后来又发过更新的一次？（按这把键上的请求序号比）
 *      问二 这次问的后端，还是用户现在选的那个后端吗？（请求里本来没带后端的自动识别那一路不受影响，
 *           只有「带了后端、而用户已经换到别的后端」这一种会被判过期）
 *   判据落在**回包这一侧**：一份回包过没过期，只有它回来的时候才说得准。发请求时就把结论冻成一个
 *   布尔值那种写法（链那一侧 2026-09-20 那版踩过）正好判反，不要再写回去。
 */
    export const _snapSeqN = { n: 0 }
    export const _snapLatestByWs = new Map() // Map<工作区键, 这把键上最新一次请求的序号>
    // 去重键：工作区键 + 后端 id（同一把键的算法只此一处，读写两侧都从这里取）。
    export const _snapPendKey = function (cwd, backendId) {
      try { return wsKeyOf(cwd || '') + '|' + String(backendId || '') } catch (e) { return String(cwd || '') + '|' + String(backendId || '') }
    }
    // 发起这一次请求之前登记一笔：序号（回包时凭它比）、这次问的后端、以及去重键（写/删在途登记都用它）。
    export const _snapMarkRequest = function (st) {
      const reqBackend = (st && st.selection && st.selection.backendId) || ''
      const seq = (_snapSeqN.n += 1)
      try { _snapLatestByWs.set(wsKeyOf((st && st.cwd) || ''), seq) } catch (eSeq) {}
      return { seq: seq, reqBackend: reqBackend, pendKey: _snapPendKey(st && st.cwd, reqBackend) }
    }
    // 回包时判这一份还算不算数（两问见文件头注释）。
    export const _snapRespStale = function (wsKey, seq, reqBackend, st) {
      try { if (_snapLatestByWs.get(wsKey) !== seq) return true } catch (eA) { return true }
      try {
        const nowBackend = (st && st.selection && st.selection.backendId) || ''
        if (reqBackend && nowBackend && String(nowBackend) !== String(reqBackend)) return true
      } catch (eB) { return true }
      return false
    }
    // 同后端已有一份在途请求时：按 #366 的判据决定复不复用；复用就把它那次的结果挂上身（不再发第二份）。
    //   返回 null = 不复用，调用方照旧发新请求。
    export const _snapReuseInFlight = function (st, force) {
      try {
        const reqBackend = (st && st.selection && st.selection.backendId) || ''
        const pend = pendingSnapshotByCwd.get(_snapPendKey(st && st.cwd, reqBackend))
        if (!pend || !pend.promise) return null
        if (force && pend.force !== true) return null // #366：force 不复用非 force 的在途请求——手动刷新必须走到 wf.refresh
        try { dswsDedupWin.n += 1; if (isEnabled('debug') && dswsDedupWin.n % 10 === 0) log('debug', 'dedup.hit', { scope: 'snapshot', keyHash: dswsLogHash(_snapPendKey(st && st.cwd, reqBackend)) }) } catch (eL) {}
        // 同 cwd 在途复用：新调用方挂载后从共享缓存水合，不再发第二份请求
        return pend.promise.then(function (snap) {
          try { if (isEnabled('debug')) log('debug', 'snapshot.fanout', { sessionIdHash: dswsLogHash(String((st && (st.sessionId || st.cwd)) || '')), stale: false, force: !!pend.force, count: (pend.n = ((pend.n || 0) + 1)) }) } catch (eL) {}
          // 在途结果已落 per-cwd 缓存（首发方 then 中 setCachedSnapshot），此处仅水合当前 store
          try { hydrateFromCache(st); emit(st) } catch (eHyd) {}
          return snap
        })
      } catch (eReuse) { return null }
    }
