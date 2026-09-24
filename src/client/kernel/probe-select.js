/**
 * src/client/kernel/probe-select.js —— 后端选定的两条专用轨迹（#727 从 probe-snapshot.js 拆出）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首 export 关键字，
 * 把声明体文本拼回 src/client/index.js 里那条 probeSelect 拼接标记处（apply 闭包内原位），
 * 与 ctx.js/seam 同模式，一源两物，src 零复制。接口清单见 docs/architecture/kernel-contract.md。
 * 为什么拆出来：probe-snapshot.js 一直贴着「单文件 ≤350 行」那条上限（拆之前 280 行，
 *   加上本票这两段就过线了；#707 也是为同一个原因从它身上拆出过颜色与差异那三样）。
 *
 * 本文件管两件事，都与「这个工作区用哪个后端」这条事实有关：
 *   ① askSelectionOnce —— 进工作区时补问一次宿主那条专用电话（wf.selection）。
 *   ② 「那次快照等超时了、但它后来还是回来了」的回包怎么落地（_snapRequestKeyWas 判据 +
 *      _installLateSnapshotSelection 落地）。这两件事共用一条界线（_snapInstallState 声明在
 *      probe-snapshot.js，与那次请求的登记同处），所以同住一处。
 *
 * 为什么要有这两件事（真机现场 2026-09-24，skill-calorie 会话目录 D:\ilife\packages\skill-calorie）：
 *   刚进会话时横幅写「该工作区还没有设置 — 点击选择后端」，而旁边「环境 10/10」是绿的、更新时间
 *   也是真实时刻；打开一次右侧面板、或切到别的会话再切回来，就正常了。两条原因：
 *   ①「用哪个后端」这条几十字节的事实，原先只能搭最重的那趟车（wf.snapshot / wf.refresh 那份完整快照）
 *     才回得来，而客户端对它有一条固定的 30 秒死线（client loadSnapshot timeout 30s）；冷启动的大
 *     工作区（这个现场：52 张地图 / 950 张票 / 741 子票 / 磁盘快照 9.7 MB）首次重建要几分钟，死线
 *     一到客户端就放弃、什么都不装。参考：同期的「环境」那一格走 wf.chain、「时间」走 wf.probe，
 *     两条都没有这条死线 —— 所以只有「后端」这一格是空的。
 *   ② 那份回包后来还是到了（真机 12:16:21 落盘，客户端最后一次放弃是 12:16:19），可它一到就被
 *      原先那道守卫整份丢掉：守卫拿「回包自己带回来的工作区根」去比「请求发出时那条子目录键」，
 *      而正是这次的守卫自己先教会了客户端那个根 —— 比出来必然不等，于是判成「这个工作区换过了」。
 *      超时之后又没有任何重试（startAutoProbe 只在成功分支被调），所以那份结果永久作废。
 * 三条不变量（本文件与门禁 tests/verify-subdir-first-frame.js 按这三条写）：
 *   I1 便宜且专用：一条事实只由一条代价相称的专用通道投递。
 *   I2 未知 ≠ 否：「还没读到」必须与「确实没有设置」分开表达，凡涉及「未知」的判据都不推进状态机。
 *   I3 迟到的正确结果必须能落地：30 秒死线只决定「这次等待结束」，不决定「这份结果作废」。
 * 以后谁改它：改「进工作区时要不要补问一次后端」「迟到的快照回包还收不收」的人。
 *   probe-snapshot.js 那边只留接线（doLoad 里那几行调用）。
 */

// 进工作区时补问一次「这个工作区用哪个后端」（I1：几十字节的事实不搭 16 MB 的车）。
// 宿主那边这条电话本来就有（wf.selection），只是界面进工作区时一条都不用 —— 全仓原先只有设置页在调。
// 判据（口径只此一处）：
//   · 手上有后端时不问（缓存先命中就不该再打这条电话）；cwd 还不认识时也不问
//     （拿宿主的默认目录去问等于替用户认一个工作区 —— 那不叫修，那叫猜）。
//   · 每个工作区只问一次（幂等、限次）：问过就记在 st._selAskedKey 上，失败也不重问、不弹提示。
//   · 回包里 selection 为空时什么都不做（I2）：那是「还没读到证据」，不是「没有设置」。
// 拿到的那条走的是与快照同一条合并口（mergeSelection，住在 store-snapshot.js），
// 所以面板头、状态栏、引导链读到的都是同一份结论，不用各自改口径。
export const askSelectionOnce = function (st) {
  try {
    if (!st || typeof host === 'undefined' || typeof host.call !== 'function') return null
    if (st.selection && st.selection.backendId) return null
    if (!st.cwd) return null
    const k = wsKeyOf(st.cwd)
    if (!k) return null
    if (st._selAskedKey === k) return null
    st._selAskedKey = k
    // I2 的表达面：从这一刻起，「后端还说不准」这件事有了一个真的在途原因 ——
    //   状态栏据此不说「该工作区还没有设置」（见 statusbar/StatusBar.js 的 _selReading）。
    st.selPending = true
    emit(st)
    const method = 'wf.selection'
    const t0 = Date.now()
    // 跨边界调用先记一行（按需级，外层先判开关），与收到回包那一行配成一对。
    try { if (isEnabled('debug')) log('debug', 'host.call', { method: method, kind: 'selection', ok: true, latencyMs: 0 }) } catch (eL) {}
    return host.call(method, { cwd: st.cwd }).then(function (res) {
      try {
        const okRes = !!(res && (res.ok === true || (res.value && res.value.ok === true)))
        if (okRes) log('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: 'selection' })
        else log('warn', 'host.call.fail', { method: method, kind: 'selection', errorHash: dswsLogHash(dswsLogTrunc(String((res && res.error) || 'selection-failed'), 120, 'error')) })
      } catch (eL) {}
      // I2：回包里没有选择就是「还不知道」，什么都不做 —— 绝不拿空值去顶替一个结论。
      try {
        const sel = (res && res.selection) || (res.value && res.value.selection) || null
        if (sel && typeof mergeSelection === 'function' && mergeSelection(st, sel)) emit(st)
      } catch (eSel) {}
      st.selPending = false
      emit(st)
      return res
    }).catch(function (e) {
      try { log('warn', 'host.call.fail', { method: method, kind: 'selection', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}
      st.selPending = false
      emit(st)
      return null
    })
  } catch (eAsk) { return null }
}

// 那份「等超时了、后来还是回来了」的回包，还能不能收下 —— 按**请求发出时**那条目录比。
// 为什么要换尺子：原来拿「回包自己带回来的根」去比「请求时那条子目录键」，而 learn 那一步就发生在
//   同一份回包里（先教会客户端根、再比对），于是子目录会话的第一份回包必判「工作区换过了」。
// 换尺子不许丢掉 #232 R4 / #45 的原意：请求时目录 A、现在目录 B（会话真的换走了）仍然判过期，
//   那条反证写在新门禁的「反向」一组里（把这条判据改回原样，子目录那一式必须变红）。
// 三种情形的判法：
//   · 请求时那条目录还是现在这条（两把键相等）：收。这就是改动前的旧判据，一行没动。
//   · 请求那条键上已经学到过根：拿同一个根重算这把请求键 —— 学到根之后它必然等于现在这把键。
//   · 两条都不成立（请求时目录 A、现在目录 B）：不收。
export const _snapRequestKeyWas = function (reqNorm, st) {
  try {
    const raw = (st && st.cwd) || ''
    if (!reqNorm || reqNorm === wsKeyOf(raw)) return true
    const hit = (typeof workspaceRootByCwd === 'object' && workspaceRootByCwd) ? workspaceRootByCwd[reqNorm] : ''
    if (hit && keyOf(hit) === wsKeyOf(raw)) return true
    return false
  } catch (e) { return false }
}

// 迟到的成功回包（Promise.race 已经判超时、可这份回包还是回到了）：至少把 selection 这一小块装上，
// 它正是「用哪个后端」那条事实的载体（I3）。为什么必须落地：死线只结束了「这次等待」，
//   而这份结果是真的、只差没赶上；不装的话用户只能靠再点一次刷新或换个会话再切回来才看得见它。
// 只装 selection 与 repository —— 快照正文那一大块等下一次正常取数，不在这里偷偷换掉用户正在看的画面。
// 三个前提缺一不可：这一次还没走过正常那一路、这条键上后面没发过更新的一次（且后端没换过）、
//   工作区没真的换走（#45 串台防线）。
export const _installLateSnapshotSelection = function (st, snap, reqNorm, mine) {
  try {
    if (!snap || !st || !mine) return false
    // 这一次已经走过正常那一路了（两边同时就绪的竞态）：一个字节都不许重复装。
    if (_snapInstallState.handedOff === true) return false
    // 后来发过更新的一次、或用户已经换到别的后端：与正常那一路同一把尺子，扔（#669 第 5 件）。
    if (typeof _snapRespStale === 'function' && _snapRespStale(reqNorm, mine.seq, mine.reqBackend, st)) return false
    if (!_snapRequestKeyWas(reqNorm, st)) return false
    let changed = false
    if (snap.selection !== undefined && typeof mergeSelection === 'function') { try { if (mergeSelection(st, snap.selection)) changed = true } catch (eSel) {} }
    if (snap.repository !== undefined) { try { st.repository = snap.repository; if (st.cwd) setCachedRepository(st.cwd, snap.repository) } catch (eRep) {} }
    st.selPending = false
    if (changed) emit(st)
    // 这条轨迹按需记：迟到本身就少见，而「为什么这一格后来自己好了」正是以后要查的那一问。
    try { if (isEnabled('debug')) log('debug', 'snapshot.late.install', { keyHash: dswsLogHash(reqNorm), installed: !!changed }) } catch (eL) {}
    return changed
  } catch (eLate) { return false }
}
