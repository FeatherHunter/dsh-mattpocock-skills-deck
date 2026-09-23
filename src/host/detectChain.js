// src/host/detectChain.js —— H3 #447 从 host/index.js 639-884 搬出，纯结构、行为零变化。
// 以后谁改它：改探测编排或检查链快照的人。预估约260行，超 350 打回。
// 接线：由 index.js 动态 import 加载；harness 注册留守 index，处理器体经 handleDetect/handleChain 供给。
import { refreshSourceOf } from './refresh/refreshSource.js'
import { workspaceKeyOf } from '../shared/refresh-workspace-key.js'   // #724：链记账给闸的钥匙，与活跃集合同一把（从前传 cwd 原文 → 同一个工作区在闸里有两格）

export function createDetectChain(deps) {
  const { canonicalKey, DEFAULT_CWD, resetGhCache, getDetectionService, getPlatform, getTrackerRegistry, getRepoKey, runGh, timer, probeSkill, mdParseOkPredicate, getChainCache, setChainCache, getChainBackoff, logCtx, gate, ghTimeoutMs } = deps
  // #491 房外埋点 helpers：hash8 只记散列；P1 外层先判开关（采样/节流/按事件），字段函数只在守卫内求值。
  function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  let chainSampleN = 0
  const chainInflight = new Map() // #696 在途合并：同钥匙同后端同语言同强制标记的并发共用同一份求值，强制不进表
  let lastPredAt = 0
  let lastPredStatus = {}
  /**
   * #709（T5 补）一次评估的环境预检只花一次：开一个只活在这一次里的复用位，谁先问出来谁写进去，
   * 后面再问的人直接拿那份（一次求值因此从 5 条 REST 降到 3 条）。三条边界（不是缓存、不跨评估串味、
   * 只有成功的才留下）写在 src/host/tracker/detection/preflightScope.js 的文件头。
   */
  async function openPreflightScope() {
    try {
      // 给它的执行器 = 宿主那条真出口（第 4 位是日志用的链名，runGh 只认前两位、多传不坏）。
      const mod = await import('./tracker/detection/preflightScope.js')
      if (typeof mod.createPreflightScope !== 'function') return null
      return mod.createPreflightScope(function (cmd, args, opts, via) { return runGh(args, (opts && opts.cwd) || undefined, via) })
    } catch (e) { return null }
  }
  /** 探测级联那一侧用的执行器（签名 = platformChannel 的 detectionExec）。 */
  function scopedDetectionExec(scope) { return function (cmd, args, opts, via) { return scope.exec(cmd, args, opts, via) } }
  // #723（T19）：默认超时不再写死在这里（数字住在 github/client.js 的 TIMEOUT_MS，由宿主接线经 ghTimeoutMs 传进来）。
  const CHANNEL_GH_TIMEOUT_MS = (typeof ghTimeoutMs === 'number' && ghTimeoutMs > 0) ? ghTimeoutMs : 30000
  // #723（T19）：这一次求值的裁决与记账经闸落一笔（身份 = refreshSourceOf 算出来的那两个名字之一，所以
  // 「谁按的、哪一档、什么时候」留在账上）。报给闸的条数写 0：这条链真正花出去的每一条出站请求都由传输层
  // 各自报过一笔（repoKeys.runGh 与 detectionExec 的 noteOutbound），再报一遍会把同一笔数成两笔。
  async function noteChainEval(source, workspaceKey) {
    try {
      if (!gate || typeof gate.send !== 'function') return
      await gate.send({ source: source, kind: 'chain', workspaceKey: workspaceKey }, async function () { return { requests: 0, points: 0 } })
    } catch (e) { /* 记账不许把链求值带崩 */ }
  }
  function ghOptsFor(cwdIn) { return { cwd: cwdIn, timeout: CHANNEL_GH_TIMEOUT_MS } }
  // #709（T5）：退避与全绿缓存整段交给 refresh-core 的纯函数裁定（薄壳 src/host/refresh/chainBackoff.js，
  // 数字真源是 budget.ts）：8 秒 → 30 秒 → 2 分钟 → 5 分钟逐档后退，有进展立刻回第一档，全绿后 30 分钟。
  // 触发只有四种事件，宿主侧一个自续定时器都没有；人亲手点「重新检查」带 trigger='user-recheck' 上来，永不降档。
  async function handleDetect(args) {
      const cwd = await canonicalKey((args && args.cwd) || DEFAULT_CWD)
      const force = !!(args && args.force)
      // #195 修复：force 探测清空 gh 解析缓存（旧实现首次失败永久缓存，force 也救不回来）
      if (force) resetGhCache()
      try {
        const svc = await getDetectionService()
        const res = await svc.detect({ cwd }, { force, hintBackendId: (args && args.backendId) || undefined, baseRev: (args && args.baseRev) || 0 })
        try { if (logCtx) logCtx.fire('info', 'detection.detect', { cwdHash: hash8(cwd), explicit: !!((res && res.selection && res.selection.source === 'explicit')), pending: !!((res && res.selection && res.selection.pending)), selection: String((res && res.selection && res.selection.backendId) || '') }) } catch (eL) {}
        // 对抗式：ensure DetectionResult 形态（含 selection/pending/multiHit，按 #125）
        return { ok: true, ...res }
      } catch (e) {
        try { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: 'wf.detect', kind: 'detect', errorHash: hash8(String((e && e.message) || e)) }) } catch (eL) {}; return { ok: false, error: String((e && e.message) || e) }
      }
  }
  /** 主机侧的链求值入口：通用链 + 当前后端的链，两段各自求值、最后拼成一份快照。 */
  async function handleChain(args) {
      const cwd = await canonicalKey((args && args.cwd) || DEFAULT_CWD)
      const force = !!(args && args.force)
      const chainLang = (args && args.lang === 'en') ? 'en' : 'zh'
      const trigger = String((args && args.trigger) || '')
      // #709（T5 补）这一次求值是什么身份（人亲手点的 / 插件自己的动作）。插件自己也会调这个入口
      //（挂载、快照回包、动作做完之后再补一次），那种调用不带 trigger。判据只有 refreshSource.js 一处：
      // 带 trigger='user-recheck' 的算人的动作，其余一律归后台档 —— 挂载时那一次强制刷新走的正是后者。
      // 不分开的话，账本会把插件自己的动作记成「人手动过」，而人的动作在闸上永不降档。
      const chainSource = refreshSourceOf(trigger)
      if (force) resetGhCache()
      try{
        const cacheKey = cwd + '|' + String(args && args.backendId || '') + '|' + chainLang
        // #709（T5）：退避与全绿缓存这一段由纯函数裁定。人亲手点「重新检查」（trigger='user-recheck'）
        // 永不降档，无论退到第几档都照做；其余三种事件按退避判，挡下的那一次直接回上一份快照。
        // 接线没给退避模块（或它取不到）时按「取不到」处理、照旧求值：可选的加速件不该把整条链打成「链失败」（src/host/repoKeys.js 里同一处依赖也是先判有没有这个函数）。
        const backoff = (typeof getChainBackoff === 'function') ? await getChainBackoff().catch(function () { return null }) : null
        const nowMs = Date.now()
        const v = backoff
          ? await backoff.verdict(cacheKey, nowMs, { trigger: trigger })
          : { needed: true, reason: 'backoff-unavailable', waitMs: 0, cached: null }
        if (!v.needed) {
          try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'chain.cache.hit', function () { return { keyHash: hash8(cacheKey), lang: chainLang, deferred: true, reason: v.reason, waitMs: v.waitMs } }) } catch (eL) {}
          return v.cached
        }
        try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'chain.cache.miss', function () { return { keyHash: hash8(cacheKey), lang: chainLang, reason: force ? 'force' : (v.reason || 'due') } }) } catch (eL) {}
        // #696 在途合并：同钥匙同后端同语言同强制标记共用同一份（另带修订号，免不同修订串份）；先回来的写缓存，后到的拿同一份；强制不参与合并
        const chainDedupKey = cacheKey + '|' + (force ? '1' : '0') + '|' + String((args && args.baseRev) || 0)
        if (!force) { const ongoingChain = chainInflight.get(chainDedupKey); if (ongoingChain) { try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'dedup.hit', function () { return { scope: 'chain', keyHash: hash8(chainDedupKey) } }) } catch (eL) {}; return await ongoingChain } }
        const chainPending = (async function () {
        const platform = await getPlatform()
        // #709（T5 补）：这次求值的环境预检复用位。开不出来（没这个模块）就是 null，后面照走原路。
        const preflightScope = await openPreflightScope()
        const ghTunnel = preflightScope ? scopedDetectionExec(preflightScope) : null
        /** 这条链上要问 gh 的时候走这里：有复用位就用它（同一轮里成名的预检只真问一次），没有就原样问。 */
        const ghAsk = ghTunnel || function (cmd, args, opts, via) { return runGh(args, (opts && opts.cwd) || undefined, via) }
        // 用户显式选择（客户端持久化绑定）作为 detect hint——「主锚 > 用户选择 > matches」层级，见 detectionService.detect
        // #709（T5 补）：这次探测的预检（登录态、仓库可达）走 ghTunnel —— 与下面后端链那两个谓词共用同一份
        // 复用位，所以一次求值里这两条命令各只真问一次（从前各问两遍，一次求值 5 条 REST）。
        const selMod = await getDetectionService().then(function(svc){ return svc.detect({ cwd }, { force, skipSkillProbes: true, hintBackendId: (args && args.backendId) || undefined, baseRev: (args && args.baseRev) || 0, exec: ghTunnel || undefined }) }).catch(function(){ return null })
        // 2026-08-28 语义修正（锚即真相，Q4 契约）：落盘主锚（detect 的 explicit/matches 判定）是权威——
        //   工作区「错误地用 GitHub 模板初始化」→ 检测就是 github（工作区名字不影响检测）；
        //   客户端绑定仅在 detect 无结论（无锚 fallback null / 探测中）时兜底，旧绑定记忆不得篡改已落盘的真相。
        const selDetected = selMod && selMod.selection
        // #297 失效维度：显式空（backendId null + source explicit）是权威“无后端”结论（如空目录 stale），不得再用旧 hint 兜底，否则蓝条永不重现
        let backendId
        if (selDetected && selDetected.backendId) {
          backendId = selDetected.backendId
        } else if (selDetected && selDetected.source === 'explicit' && selDetected.backendId === null) {
          backendId = null
        } else {
          backendId = (args && args.backendId) || null
        }
        const genMod = await import('./tracker/generic.js')
        const predMod = await import('./tracker/predicateCore.js') // V1 #461：predicateRegistry.js 已拆为两块
        // 2026-08-28 实机修复：单谓词超时 3000ms → 15000ms。
        //   gh auth status / gh api 是真实网络调用（本机曾多次 TLS schannel 握手失败），3 秒必然超时，
        //   导致「gh 已登录」「仓库可达」被误判并展示误导性修复指引；15s 给慢网络留余地（runGh 内部 30s 兜底）。
        const registry = predMod.createPredicateRegistry({ timeout: 15000 })
        if (typeof genMod.registerGenericPredicates === 'function') genMod.registerGenericPredicates(registry)
        // #284 一致性修复（2026-08-28）：客户端显式绑定（backendId）优先——主锚与绑定不一致的过渡态（如锚=GitHub 版、
        //   用户已绑 markdown）链不得两面矛盾（后端段 markdown、开门段 explicit:github）；selection/explicit 归一为绑定侧。
        const selRaw = selMod && selMod.selection
        const selConsistent = (selRaw && backendId && selRaw.backendId !== backendId)
          ? Object.assign({}, selRaw, { backendId: backendId })
          : selRaw
        const expConsistent = (selConsistent && selConsistent.backendId)
          ? selConsistent.backendId
          : ((selMod && selMod.explicit && selMod.explicit.parsed && selMod.explicit.parsed.explicitBackendId) || null)
        const ctx = { platform: platform, backendId: backendId || null, cwd: cwd, lang: chainLang, selection: selConsistent, explicitBackendId: expConsistent, skillProbe: async function (skillName) { try { return await probeSkill(skillName, chainLang, cwd) } catch (e) { return { ok: false, level: 'pending', detail: String((e && e.message) || e), hint: 'pending:skills-unavailable' } } } }
        // #284：后端谓词注册（host 既有探测包装；未注册者由 registry 诚实 pending，不猜不误报）
        try { registry.register('backend:github:repoRemote', async function (check, pctx) {
          try {
            // 2026-08-29（审查 S1）：detail 双语——中文界面不出现英文黑话行
            const zh = (pctx && pctx.lang) !== 'en'
            const rk = await getRepoKey(pctx && pctx.cwd || cwd)
            if (rk && rk.owner && rk.name) return { status: 'pass', detail: rk.owner + '/' + rk.name }
            return { status: 'fail', detail: zh ? '未找到 GitHub 仓库关联（git remote 未指向 GitHub）' : 'repo not located' }
          } catch (e) { return { status: 'pending', detail: String((e && e.message) || e) } }
        }) } catch (e) {}
        try { registry.register('backend:github:repoAccess', async function (check, pctx) {
          try {
            // 2026-08-29（审查 S1/S2）：detail 双语；pending 文案如实说明「网络/登录态未知」，不与 fail 混淆
            const zh = (pctx && pctx.lang) !== 'en'
            const rk = await getRepoKey(pctx && pctx.cwd || cwd)
            if (!rk || !rk.owner || !rk.name) return { status: 'fail', detail: zh ? '未找到 GitHub 仓库关联' : 'repo not located' }
            const r = await ghAsk('gh', ['api', 'repos/' + rk.owner + '/' + rk.name], ghOptsFor(pctx && pctx.cwd || cwd), 'repoAccess')
            if (r.ok) return { status: 'pass', detail: zh ? 'GitHub 接口访问正常' : 'api.github.com 200' }
            // 2026-08-28 实机复核修正（用户反馈：仓库已找到却提示创建发布——错误）：只有「确定仓库不存在/无权限」
            //   （kind=notfound）才判 fail 并挂「创建并发布」修复动作；未登录（auth）/网络/其他异常一律 pending（诚实未知）——
            //   仓库已定位（gh:remote 通过）而 gh 未登录时，链条唯一引导是 gh:authed 行的「登录指引」，绝不该误导用户去创建仓库。
            if (r.kind === 'notfound') return { status: 'fail', detail: zh ? 'GitHub 上访问不到该仓库（可能还没创建，或你没有权限）' : 'API 404: repo not found (may not exist or no access)' }
            return { status: 'pending', detail: zh ? '暂无法确认仓库可访问（网络或登录态未知）：' + String(r.error || '').slice(0, 160) : 'API not accessible (' + String(r.kind || 'exit') + '): ' + String(r.error || '').slice(0, 240) }
          } catch (e) { return { status: 'pending', detail: String((e && e.message) || e) } }
        }) } catch (e) {}
        try { registry.register('preflight:ghAuth', async function (check, pctx) {
          try {
            // 2026-08-29（审查 S1）：detail 双语——fail 说清「登录失效」，pending 如实区分网络与未知
            const zh = (pctx && pctx.lang) !== 'en'
            const r = await ghAsk('gh', ['auth', 'status'], ghOptsFor(cwd), 'ghAuth')
            if (r.ok) { const first = (r.text || '').split(/\r?\n/).map(function (s) { return s.trim() }).filter(Boolean)[0]; return { status: 'pass', detail: first || (zh ? '已登录' : 'Logged in') } }
            // 2026-08-28 实机修复：仅当明确「未登录」（kind=auth）才判 fail 并展示登录指引；
            //   网络失败/其他异常归 pending（诚实未知），避免在 TLS 网络抖动时误导用户「未登录」。
            const kind = r.kind || 'exit'
            const errMsg = String(r.error || '').slice(0, 240)
            if (kind === 'auth') return { status: 'fail', detail: zh ? 'GitHub 登录状态已失效（重新登录 gh auth login / refresh）' : 'gh credential invalid or not logged in: re-authenticate (gh auth refresh / gh auth login)' }
            if (kind === 'network') return { status: 'pending', detail: zh ? '网络异常，暂时无法确认登录状态' : 'gh auth status network failure: ' + errMsg }
            return { status: 'pending', detail: zh ? '暂时无法确认登录状态（' + kind + '）' : 'gh auth status failed (' + kind + '): ' + errMsg }
          } catch (e) { return { status: 'pending', detail: String((e && e.message) || e) } }
        }) } catch (e) {}
        try { registry.register('backend:markdown:parseOk', async function (check, pctx) {
          try { return await mdParseOkPredicate(platform, pctx && pctx.cwd || cwd, chainLang) } catch (e) { return { status: 'pending', detail: String((e && e.message) || e) } }
        }) } catch (e) {}
        const kind = (args && args.kind) || 'all'
        const chainAndSnap = await genMod.resolveGenericChain(registry, ctx, kind)
        // #284 修订（对抗式审查 2026-08-28）：链上检查项【逐项独立求值】——
        //   evaluateChain 的串行被阻塞语义会把「已算出但前置未过」的判定（技能缺失红牌、gh 未装提示）吞成 pending；
        //   此为 #281 红牌契约与 #229「pending=诚实未知」的不诚实表达。改为：所有步骤保留自身判定（全貌诊断），
        //   链只表达「首个未通过步 = 当前引导步」（currentIndex），引导与诊断合二为一。
        const stepEvalParallel = function (items, resolved) {
          try {
            const rMap = resolved || {}
            const steps = (items || []).map(function (it) {
              const rd = rMap[it.id]
              const isPass = rd === 'pass'
              const isFail = rd === 'fail'
              const status = isPass ? 'done' : (isFail ? (((it.onFail && Array.isArray(it.onFail.actions) && it.onFail.actions.length)) ? 'current' : 'fail') : 'pending')
              // 2026-08-28 实机复核修正（用户反馈：pending 行仍显示修复指引与「未登录」提示——误导）：
              //   pending（诚实未知）只保留检查项名称，不带 onFail 修复文案（hint）与修复动作（actions 已按 isFail 过滤）；
              //   fail/current 才展示修复指引。修复文案只随真实失败出现。
              const _pendingShow = (function () { const bb = (it.onFail && it.onFail.show) || {}; const oo = {}; if (bb.fallback != null) oo.fallback = bb.fallback; if (bb.title != null) oo.title = bb.title; if (bb.i18nKey != null) oo.i18nKey = bb.i18nKey; return oo })()
              const show = isPass ? ((it.onPass && it.onPass.show) || null) : (isFail ? ((it.onFail && it.onFail.show) || null) : _pendingShow)
              const actions = isFail && it.onFail && Array.isArray(it.onFail.actions) ? it.onFail.actions : []
              return { id: it.id, check: it.check, status: status, show: show, actions: actions, isApplicable: true, blockedBy: null, isCurrent: false, isBlocking: status !== 'done' }
            })
            const firstNotDone = steps.findIndex(function (s) { return s.status !== 'done' })
            const allDone = firstNotDone < 0
            const snapshot = {
              steps: steps,
              currentIndex: allDone ? null : firstNotDone,
              failedIndex: firstNotDone,
              doneCount: steps.filter(function (s) { return s.status === 'done' }).length,
              applicableCount: steps.length,
              totalCount: steps.length,
              chainState: allDone ? 'allDone' : (steps[firstNotDone].status === 'pending' ? 'pending' : 'hasCurrent'),
              version: '1',
            }
            if (allDone) { snapshot.isComplete = true } else { snapshot.isComplete = false; snapshot.hasBlockingFailure = steps[firstNotDone].status !== 'pending'; snapshot.blockingCheck = steps[firstNotDone].id }
            return snapshot
          } catch (e) { return null }
        }
        const genPredResults = predMod.toPredicateResults ? predMod.toPredicateResults(chainAndSnap.resolved || {}) : (chainAndSnap.resolved || {})
        const genericSnapRaw = stepEvalParallel(genMod.getGenericChain ? genMod.getGenericChain(kind) : (chainAndSnap.chain || []), genPredResults)
        let backendChain = null
        try{
          if (backendId) {
            const catDirs = await import('../shared/tracker/check-catalog-dirs.js')
            const catViews = await import('../shared/tracker/check-catalog-views.js')
            const chainMod = await import('../shared/tracker/chain-validate.js')
            let items = (catDirs.catalogFor ? catDirs.catalogFor(backendId) : []).filter(function(c){ return c.scope==='backend' && c.id !== 'gh:labels' }).map(function(ci){ return catViews.catalogItemToCheckItem ? catViews.catalogItemToCheckItem(ci) : null }).filter(Boolean)
            // 修复契约（2026-08-28）：后端声明 fixes（hint + 修复动作）→ 按语言解析附到检查项 onFail——
            //   检查失败即有修复入口（注入指引/重查），UI 零派生只渲染分发；后端未声明 fixes 则保持默认（重查）。
            if (items.length) {
              try {
                const fixMod = await import('./tracker/fixContract.js')
                const regT = await getTrackerRegistry()
                const tmods = (regT && typeof regT.modules === 'function') ? regT.modules() : []
                const tmod = (tmods || []).find(function (m) { return m && String(m.id) === String(backendId) && m.fixes }) || null
                // 2026-08-28 用户反馈「owner/... 占位」：预解析当前 GitHub 登录用户名（仅 github 后端、最快 2.5s 超时，
                //   失败静默空）→ fixContract 将其替换进 preview 模板 {owner}——预览显示真实用户名（如 FeatherHunter），
                //   不再显示字面量 "owner"；未登录/网络失败时保留占位（UI 诚实兜底）
                let _fixOwner = ''
                try {
                  if (String(backendId) === 'github') {
                    const _u = await Promise.race([
                      runGh(['api', 'user', '-q', '.login']),
                      timer.timeout(2500).then(function () { return null }),
                    ])
                    if (_u && _u.ok) _fixOwner = String(_u.text || '').trim()
                  }
                } catch (e) { }
                if (tmod && fixMod.attachFixContract) items = fixMod.attachFixContract(items, tmod, chainLang, { cwd: cwd, owner: _fixOwner })
              } catch (e) {}
              const resolved = await registry.resolveAll(items, ctx)
              const predResults = predMod.toPredicateResults ? predMod.toPredicateResults(resolved) : resolved
              const snapshot = stepEvalParallel(items, predResults)
              const errs = chainMod.validateChain ? chainMod.validateChain(items) : []
              backendChain = { chain: items, resolved: resolved, snapshot: snapshot, errors: errs }
            }
          }
        }catch(e){}
        // #284 修订（对抗式审查 2026-08-28）：后端链【独立求值】——不再与通用链串行拼接，
        //   消除「env:home 未通过 → gh CLI/登录/仓库可达全被阻塞」的假依赖；fullSnapshot 为两段步骤的
        //   「拼接视图」（各步状态保留自身判定），但不再互相锁步。
        // #668：拼接后的行序按首开引导链的步骤清单排（清单上的步骤按清单顺序在前，清单没覆盖的检查项
        //   按各段原有先后接在后面）。顺序只有清单那一份真源，界面照快照渲染、自己不排序。
        //   旧语义「通用段 → 后端段」到此结束：新语义下「未初始化」排在「已关联仓库」之后。
        let fullSnapshot = null
        let fullChain = null
        try {
          const chainMod3 = await import('../shared/tracker/chain-validate.js')
          const genSnap = genericSnapRaw || chainAndSnap.snapshot
          const backSnap = (backendChain && backendChain.snapshot) || null
          const genSteps = (genSnap && Array.isArray(genSnap.steps)) ? genSnap.steps : []
          const backSteps = (backSnap && Array.isArray(backSnap.steps)) ? backSnap.steps : []
          fullChain = chainAndSnap.chain.concat((backendChain && backendChain.chain) ? backendChain.chain : [])
          const allStepsRaw = genSteps.concat(backSteps)
          let allSteps = allStepsRaw
          try {
            const guideMod = await import('../shared/tracker/guide-steps.js')
            if (guideMod && typeof guideMod.orderStepsByGuide === 'function') {
              allSteps = guideMod.orderStepsByGuide(guideMod.guideStepsFor(backendId || null), allStepsRaw)
            }
          } catch (eG) {}
          const firstNotDone = allSteps.findIndex(function (s) { return s.status !== 'done' })
          const allDone = firstNotDone < 0
          fullSnapshot = {
            steps: allSteps,
            currentIndex: allDone ? null : firstNotDone,
            doneCount: allSteps.filter(function (s) { return s.status === 'done' }).length,
            applicableCount: allSteps.length,
            totalCount: allSteps.length,
            chainState: allDone ? 'allDone' : (allSteps[firstNotDone].status === 'pending' ? 'pending' : 'hasCurrent'),
            version: '1',
          }
        } catch (e) { fullSnapshot = chainAndSnap.snapshot; fullChain = chainAndSnap.chain }
        // #284：富化链快照——谓词结果的 detail/hint 合并进步骤 show（红牌分拣文案经链到达 UI）
        const enrichSnap = function (snap, resolvedMap) {
          try {
            if (!snap || !Array.isArray(snap.steps) || !resolvedMap) return snap
            const rMap = resolvedMap || {}
            const steps = snap.steps.map(function (s) {
              const rd = rMap[s.id] || null
              if (!rd || (!rd.detail && !rd.hint)) return s
              const base = s.show || {}
              return Object.assign({}, s, { show: Object.assign({}, base, rd.detail ? { desc: base.desc || rd.detail } : {}, rd.hint ? { hint: base.hint || rd.hint } : {}) })
            })
            return Object.assign({}, snap, { steps: steps })
          } catch (e) { return snap }
        }
        const allResolved = Object.assign({}, chainAndSnap.resolved || {}, (backendChain && backendChain.resolved) || {})
        try {
          if (logCtx && logCtx.isEnabled('debug')) {
            const nowP = Date.now()
            if (nowP - lastPredAt > 15000) {
              lastPredAt = nowP
              const ids = Object.keys(allResolved || {})
              for (let pi = 0; pi < ids.length; pi++) { const rd = allResolved[ids[pi]]; const stt = String((rd && (rd.status || rd)) || 'pending'); if (lastPredStatus[ids[pi]] !== stt) { lastPredStatus[ids[pi]] = stt; logCtx.fire('debug', 'chain.predicate', { id: String(ids[pi]), status: stt }) } }
            }
          }
        } catch (eL) {}
        const genericSnap = enrichSnap(genericSnapRaw || chainAndSnap.snapshot, chainAndSnap.resolved)
        const backendSnapE = (backendChain && backendChain.snapshot) ? enrichSnap(backendChain.snapshot, backendChain.resolved) : (backendChain && backendChain.snapshot)
        if (backendChain) backendChain.snapshot = backendSnapE
        fullSnapshot = enrichSnap(fullSnapshot, allResolved)
        const result = { ok: true, backendId: backendId || null, chain: chainAndSnap.chain, resolved: chainAndSnap.resolved, snapshot: genericSnap, backendChain: backendChain, fullChain: fullChain, fullSnapshot: fullSnapshot, chainSource: chainSource }
        // #284 修订 + 2026-08-28 B 方案（用户定版）：链未全绿（仍存在 pending/fail/current 步骤）不写 30s 缓存——
        //   未完成区是动态区（修复由对话/终端发生在链外），panel 轮询每次真探测，修复完成即自动变绿；
        //   全部通过（done）才缓存（全绿后零重复探测，client 轮询也随之停止）。
        const chainNotAllDone = (function () {
          const steps = (fullSnapshot && Array.isArray(fullSnapshot.steps)) ? fullSnapshot.steps : []
          return steps.some(function (s) { return s.status !== 'done' })
        })()
        if (!chainNotAllDone) setChainCache({ ts: Date.now(), key: cacheKey, value: result })
        // #709（T5）：把这一份快照记进退避态。链上多出一步 done 才算进展（重跑拿到一样的结果不算），有进展立刻回第一档；没进展就往后退一档，退到最慢那档就停在那里。
        try { if (backoff) await backoff.note(cacheKey, fullSnapshot, Date.now(), result) } catch (eNote) {}
        // #723（T19）：这一次求值的裁决与记账经闸落一笔（身份来自 refreshSourceOf，见 noteChainEval）。
        await noteChainEval(chainSource, workspaceKeyOf(cwd))
        // #709（T5 补）这次求值的环境预检收尾：真问了几条、复用省掉了几次。按需级（debug，外层先判
        // 开关，关着连字段对象都不组装；按 docs/design/335-logging-contract.md 第 3 章判定），
        // 每次求值只落一行，只记工作区短指纹与计数，不记命令原文、不记路径原文、不记任何返回值。
        try {
          // 判断与落点同一行（tests/verify-log-guards.js 的口径：关着开关时连字段对象都不组装）：
          // 这里原来把判断写成上一行的 if 大括号，判断本身一个字没减，只是搬到同一行。
          if (logCtx && logCtx.isEnabled('debug') && preflightScope) logCtx.fire('debug', 'chain.preflight.reuse', function () {
            return { cwdHash: hash8(cwd), checks: preflightScope.asked(), reused: preflightScope.reused(), userAction: trigger === 'user-recheck' }
          })
        } catch (eL) {}
        return result
        })()
        if (!force) { chainInflight.set(chainDedupKey, chainPending); try { return await chainPending } finally { chainInflight.delete(chainDedupKey) } }
        return await chainPending
      }catch(e){
        try { const m = String((e && e.message) || e); if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: 'wf.chain', kind: 'chain', errorHash: hash8(m), errorKind: (/is not a function|is not defined|of undefined|of null/i.test(m) ? 'missing-dep' : (/timeout|timed out/i.test(m) ? 'timeout' : 'throw')) }) } catch (eL) {}   // #724：异常也留一行（从前静默吞掉，真机查了两天没有原文）；errorKind 把「接线没给全」（missing-dep）与「跑起来真失败」（throw）分开
        return { ok: false, error: String((e && e.message)||e) }
      }
  }
  return { handleDetect, handleChain }
}
