// src/host/detectChain.js —— H3 #447 从 host/index.js 639-884 搬出，纯结构、行为零变化。
// 以后谁改它：改探测编排或检查链快照的人。预估约260行，超 350 打回。
// 接线：由 index.js 动态 import 加载；harness 注册留守 index，处理器体经 handleDetect/handleChain 供给；本文件不引用其他新文件。
export function createDetectChain(deps) {
  const { canonicalKey, DEFAULT_CWD, resetGhCache, getDetectionService, getPlatform, getTrackerRegistry, getRepoKey, runGh, timer, probeSkill, mdParseOkPredicate, getChainCache, setChainCache } = deps
  const CHAIN_CACHE_MS = 30000
  async function handleDetect(args) {
      const cwd = await canonicalKey((args && args.cwd) || DEFAULT_CWD)
      const force = !!(args && args.force)
      // #195 修复：force 探测清空 gh 解析缓存（旧实现首次失败永久缓存，force 也救不回来）
      if (force) resetGhCache()
      try {
        const svc = await getDetectionService()
        const res = await svc.detect({ cwd }, { force, hintBackendId: (args && args.backendId) || undefined })
        // 对抗式：ensure DetectionResult 形态（含 selection/pending/multiHit，按 #125）
        return { ok: true, ...res }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
  }
    // #228/#284 链渲染器主机侧：通用链 + 当前后端链求值快照（契约层纯函数求值，谓词只读探测，失败返回不抛，超时 pending）
    // #284 增强：backend 谓词由 host 既有探测包装注册（repoRemote/repoAccess/ghAuth/mdParseOk），后端链不再只是声明。
    // #284 修订（对抗式审查 2026-08-28）：30s per(cwd+backendId+lang) 缓存——面板多组件挂载不再重复 25 名技能探测与 gh 网络调用；
    //   等待计数只随真实探针轮次（force）推进，不被 UI 刷新次数偷换。
  async function handleChain(args) {
      const cwd = await canonicalKey((args && args.cwd) || DEFAULT_CWD)
      const force = !!(args && args.force)
      const chainLang = (args && args.lang === 'en') ? 'en' : 'zh'
      if (force) resetGhCache()
      try{
        // 缓存命中（force 绕过；探测 pending 结果不缓存——与旧 statusCache 同纪律）
        const cacheKey = cwd + '|' + String(args && args.backendId || '') + '|' + chainLang
        if (!force && getChainCache().value && getChainCache().key === cacheKey && Date.now() - getChainCache().ts < CHAIN_CACHE_MS) {
          return getChainCache().value
        }
        const platform = await getPlatform()
        // 用户显式选择（客户端持久化绑定）作为 detect hint——「主锚 > 用户选择 > matches」层级，见 detectionService.detect
        const selMod = await getDetectionService().then(function(svc){ return svc.detect({ cwd }, { force, skipSkillProbes: true, hintBackendId: (args && args.backendId) || undefined }) }).catch(function(){ return null })
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
            const r = await runGh(['api', 'repos/' + rk.owner + '/' + rk.name], pctx && pctx.cwd || cwd)
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
            const r = await runGh(['auth', 'status'])
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
            const catMod2 = await import('../shared/tracker/check-catalog.js')
            const chainMod = await import('../shared/tracker/chain-validate.js')
            let items = (catMod2.catalogFor ? catMod2.catalogFor(backendId) : []).filter(function(c){ return c.scope==='backend' && c.id !== 'gh:labels' }).map(function(ci){ return catMod2.catalogItemToCheckItem ? catMod2.catalogItemToCheckItem(ci) : null }).filter(Boolean)
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
        //   「拼接视图」（各步状态保留自身判定），引导语义仍为 通用段 → 后端段，但不再互相锁步。
        let fullSnapshot = null
        let fullChain = null
        try {
          const chainMod3 = await import('../shared/tracker/chain-validate.js')
          const genSnap = genericSnapRaw || chainAndSnap.snapshot
          const backSnap = (backendChain && backendChain.snapshot) || null
          const genSteps = (genSnap && Array.isArray(genSnap.steps)) ? genSnap.steps : []
          const backSteps = (backSnap && Array.isArray(backSnap.steps)) ? backSnap.steps : []
          fullChain = chainAndSnap.chain.concat((backendChain && backendChain.chain) ? backendChain.chain : [])
          const allSteps = genSteps.concat(backSteps)
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
        const genericSnap = enrichSnap(genericSnapRaw || chainAndSnap.snapshot, chainAndSnap.resolved)
        const backendSnapE = (backendChain && backendChain.snapshot) ? enrichSnap(backendChain.snapshot, backendChain.resolved) : (backendChain && backendChain.snapshot)
        if (backendChain) backendChain.snapshot = backendSnapE
        fullSnapshot = enrichSnap(fullSnapshot, allResolved)
        const result = { ok: true, backendId: backendId || null, chain: chainAndSnap.chain, resolved: chainAndSnap.resolved, snapshot: genericSnap, backendChain: backendChain, fullChain: fullChain, fullSnapshot: fullSnapshot }
        // #284 修订 + 2026-08-28 B 方案（用户定版）：链未全绿（仍存在 pending/fail/current 步骤）不写 30s 缓存——
        //   未完成区是动态区（修复由对话/终端发生在链外），panel 轮询每次真探测，修复完成即自动变绿；
        //   全部通过（done）才缓存（全绿后零重复探测，client 轮询也随之停止）。
        const chainNotAllDone = (function () {
          const steps = (fullSnapshot && Array.isArray(fullSnapshot.steps)) ? fullSnapshot.steps : []
          return steps.some(function (s) { return s.status !== 'done' })
        })()
        if (!chainNotAllDone) setChainCache({ ts: Date.now(), key: cacheKey, value: result })
        return result
      }catch(e){
        return { ok: false, error: String((e && e.message)||e) }
      }
  }
  return { handleDetect, handleChain }
}
