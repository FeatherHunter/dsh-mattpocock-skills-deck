// src/host/refresh/chainBackoff.js —— 检查链「下一次什么时候再算」的宿主薄壳（#709 · T5 第四批）
//
// 分工：算这一步的规则全是纯函数，住在 refresh-core/src/backoff.ts（产物 src/shared/refresh/backoff.js）；
// 数字的唯一真源是 refresh-core/src/budget.ts。本文件自己一个数字都不写，只做四件事：
//   ① 把 budget.js 里的那四个数字取出来装成 BackoffLimits；
//   ② 把每个工作区（严格说是每条链的缓存键）的退避态记在内存里；
//   ③ 把「这一刻该不该重算」的结论连同原因代号交回调用方；
//   ④ 顺手保管「这个键上最近那一份快照与那一次那份完整回包」——被退避挡下的那一次就把完整回包原样回，
//      界面不会因此白屏（#724：从前回的是光一份快照，客户端认不出来，于是每次没带 force 的取数都失败）。
//
// 本文件**不排任何定时器**，一条都没有。退避给出的 waitMs 只是「按规则还差多久」，不是「请挂一个
// 等这么久的循环」：下一次求值只可能由四种事件带起来（切进工作区、点「重新检查」、做完可能改变它的
// 动作、写入成功之后）。人亲手点的那一次（trigger 为 'user-recheck'）永不降档，无论退到第几档都照做。
//
// 为什么单独一个文件而不是塞进 detectChain.js：那个文件已经 286 行，仓库单文件上限是 350 行
//（tests/verify-file-granularity.js），再塞六十行就顶格了。
export function createChainBackoff(deps) {
  const { logCtx } = deps || {}

  /** 每个链缓存键：{ step, evaluatedAtMs, allGreen, snapshot, doneCount, result }。丢了最多多查一次，不落盘。 */
  const _stateByKey = new Map()
  let _backoff = null
  let _limits = null
  let _initP = null

  /** 取纯函数与数字（各一次，之后复用）。源码树不在的发布包里取不到，那种情况返回 null 并由调用方照旧求值。 */
  function ready() {
    if (_backoff && _limits) return Promise.resolve({ backoff: _backoff, limits: _limits })
    if (!_initP) {
      _initP = (async function () {
        try {
          const ms = await Promise.all([import('../../shared/refresh/backoff.js'), import('../../shared/refresh/budget.js')])
          const budget = ms[1] || {}
          if (!Array.isArray(budget.CHAIN_BACKOFF_MS) || budget.CHAIN_BACKOFF_MS.length < 2) return null
          _backoff = ms[0]
          _limits = {
            backoffMs: budget.CHAIN_BACKOFF_MS,
            allGreenTtlMs: budget.CHAIN_ALL_GREEN_TTL_MS,
            preflightTtlMs: budget.PREFLIGHT_TTL_MS,
            preflightRetryAfterFailure: budget.PREFLIGHT_RETRY_AFTER_FAILURE,
          }
          return { backoff: _backoff, limits: _limits }
        } catch (e) { return null }
      })()
    }
    return _initP
  }

  function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }

  /** 这一份快照是不是全绿（链上每一步都 done）。没有步骤时按「还没全绿」算：诚实未知，不算通过。 */
  function isAllGreen(snapshot) {
    try {
      const steps = (snapshot && Array.isArray(snapshot.steps)) ? snapshot.steps : []
      if (!steps.length) return false
      return steps.every(function (s) { return s && s.status === 'done' })
    } catch (e) { return false }
  }

  /** 这份快照上已经有几步 done。用来判「这一轮有没有进展」——多出一步才算，重跑一次拿到一样的结果不算。 */
  function doneCountOf(snapshot) {
    try {
      const steps = (snapshot && Array.isArray(snapshot.steps)) ? snapshot.steps : []
      return steps.filter(function (s) { return s && s.status === 'done' }).length
    } catch (e) { return 0 }
  }

  /**
   * 这一刻该不该重算这条链。trigger 为 'user-recheck' 时无条件 needed（人亲手点的动作永不降档）；
   * 其余情况交给纯函数按退避判。取不到纯函数（发布包里没有源码树）时一律 needed ——
   * 宁可照旧多算一次，也不要因为读不到规则而让检查页僵在那里。
   *
   * 返回 { needed, reason, waitMs, cached }：cached 是「被退避挡下时可以直接回给界面的那一份」。
   *
   * #724 修正（真机 107 次全败的真身）：这里从前回的是**光一份快照**（{steps, currentIndex, …}），
   * 而调用方（src/host/detectChain.js）在退避挡下时把它**原样**当了回包交回去。客户端认的回包形状是
   * `res.ok && (res.fullSnapshot || res.snapshot)`（src/client/kernel/probe-chain.js），一份光快照没有 ok
   * 那一栏 → 客户端判成「回话里没有内容」，于是每次没带 force 的取数都失败（界面那一格于是永远是 --，
   * 而宿主这边其实早就有读数）。所以现在记的是**上一次那份完整回包**，退避挡下就原样回它；
   * 拿不到完整回包时才退回光快照（诚实降级，不编一个 ok:true）。
   */
  async function verdict(key, nowMs, opts) {
    const st = _stateByKey.get(key) || null
    const snap = st ? st.snapshot : null
    const lastReply = st ? (st.result || st.snapshot) : null
    const trigger = String((opts && opts.trigger) || '')
    const r = await ready()
    if (!r) return { needed: true, reason: 'backoff-unavailable', waitMs: 0, cached: lastReply }
    if (trigger === 'user-recheck') {
      try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'chain.backoff', { keyHash: hash8(key), decision: 'user-recheck-bypass' }) } catch (eL) {}
      return { needed: true, reason: 'user-recheck-bypass', waitMs: 0, cached: lastReply }
    }
    const v = r.backoff.chainRefreshVerdict(st ? { step: st.step, evaluatedAtMs: st.evaluatedAtMs, allGreen: st.allGreen } : null, nowMs, r.limits)
    // 手里一份快照都没有的时候必须算：否则界面第一次进来就没东西可画（退避不该把首屏也拦住）。
    // 有快照、却没有完整回包（旧版本写下的状态）时也照样真算一次 —— 免得把一份客户端认不出的回包递出去。
    if (!v.needed && (!snap || !st.result)) return { needed: true, reason: snap ? 'no-full-reply-yet' : 'no-snapshot-yet', waitMs: 0, cached: null }
    try {
      // 常驻一条：这是「后台零定时器」之后唯一还能回答「为什么这次没查」的地方，查问题时全靠它。
      if (logCtx) logCtx.fire('info', 'chain.backoff', { keyHash: hash8(key), decision: v.needed ? 'recompute' : 'defer', reason: String(v.reason || ''), waitMs: Math.max(0, Math.floor(Number(v.waitMs) || 0)), step: st ? st.step : 0, trigger: trigger || 'event' })
    } catch (eL) {}
    return { needed: !!v.needed, reason: String(v.reason || ''), waitMs: Math.max(0, Math.floor(Number(v.waitMs) || 0)), cached: lastReply }
  }

  /**
   * 记一次求值结果：把这一份快照与**这一份完整回包**留下、按「有没有进展」推进或回退档位。
   * progressed 由这里自己判——链上多出一步 done 才算进展，重跑一次拿到一样的结果不算。
   * `result` 是可选的那一份完整回包（detectChain 交出来的、客户端认的那形状）；给了就在退避挡下时原样回它。
   */
  async function note(key, snapshot, nowMs, result) {
    const st = _stateByKey.get(key) || null
    const prevDone = st ? Number(st.doneCount) || 0 : 0
    const done = doneCountOf(snapshot)
    const allGreen = isAllGreen(snapshot)
    const progressed = done > prevDone
    const r = await ready()
    const step = r ? r.backoff.advanceChainStep(st ? st.step : 0, progressed, r.limits) : 0
    _stateByKey.set(key, { step: step, evaluatedAtMs: Number(nowMs) || Date.now(), allGreen: allGreen, snapshot: snapshot, doneCount: done, result: (result && typeof result === 'object') ? result : null })
    // 缓存变更记一行（#709 新增内存缓存：命中 / 未命中 / 过期 / 写回四件事都要看得见）。
    try {
      if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'chain.cache.write', { keyHash: hash8(key), allGreen: allGreen, doneCount: done, step: step, progressed: progressed })
    } catch (eL) {}
    return { step: step, allGreen: allGreen, progressed: progressed }
  }

  /**
   * 「写入成功之后」这一类事件到了：把所有链的退避拉回第一档。
   *
   * 为什么一次写入要影响所有链：写入是「可能改变检查链」的动作（首次建号、仓库刚有内容、
   * 刚发出去一条评论），而宿主拦截到写入时手上只有一个工作目录，不是「这条链的缓存键」
   *（键里还含后端 id 与语言）。宁可把所有链都拉回快档（最坏也只是下一次事件立刻真算一次），
   * 也不要因为分不清是哪条链而把真进展挡在 5 分钟那一档外面。
   */
  function noteWriteActivity() {
    _stateByKey.forEach(function (st) { if (st) st.step = 0 })
    try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'chain.backoff', { keyHash: '', decision: 'write-reset', reason: 'write-done', waitMs: 0, step: 0, trigger: 'write-done' }) } catch (eL) {}
  }

  /** 这个键上最近那一份快照（没有就是 null）。被退避挡下时用它直接回。 */
  function cached(key) {
    const st = _stateByKey.get(key) || null
    return st ? st.snapshot : null
  }

  /** 全绿缓存的寿命（毫秒）——调用方要用它回答「这份全绿结论还能用多久」。取不到时给 0，表示不缓存。 */
  async function allGreenTtlMs() {
    const r = await ready()
    return r ? Number(r.limits.allGreenTtlMs) || 0 : 0
  }

  /** 现在退到第几档（只给门禁与调试看，业务路径不用它做判断）。 */
  function stepOf(key) {
    const st = _stateByKey.get(key) || null
    return st ? st.step : 0
  }

  return { verdict, note, noteWriteActivity, cached, allGreenTtlMs, stepOf, isAllGreen, doneCountOf }
}
