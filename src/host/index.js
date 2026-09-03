/**
 * dsh-mattpocock-skills-deck · Host 半（数据层实现 · T3 #345）
 *
 * 实现：
 *   1. gh 封装层：resolveExecutable 解析 → 兜底 DSH_GH_PATH/系统 gh；30s 超时（timer race + terminate）；
 *      错误归一化（auth / network / notfound / exit）。
 *   2. 数据流：gh issue list 枚举 wayfinder:map → 每 map 一次 GraphQL（subIssues + labels + assignees +
 *      blockedBy + blocking）→ 组装快照（map 五区块解析 + tickets + stats 分组）。
 *   3. RPC：wf.ping / wf.snapshot（5s 缓存）/ wf.refresh。
 *   4. 轮询：timer 60s 刷新缓存 + 与上次 stats diff（P2 toast 预留字段）。
 *   5. 检查链快照（#228/#284）：wf.chain —— 通用链 + 当前后端链求值快照，替代九格目录视图。
 *   6. 技能判装多通道并联（#296）：注册表未命中时并联探标准根（DSH fs 服务 + 插件只读直读）。
 *      直读是对「探测零 OS 直碰」的限定例外——只读、仅技能标准根候选路径，契约见
 *      docs/adr/20260828-skill-probe-union-channels.md。
 *
 * 已验证（.charting/verify.js，真实数据 PASS）：分组 frontier/claimed/blocked 与 GitHub 页面一致；
 * 9 张 open map 中仅 4 张有 Destination —— body 解析全部容错。
 *
 * 本文件内容 = cordis_define 的 code.host（纯 JS 函数体，返回 Cordis Plugin）。
 */

// ===== 规范方言（dynamic dialect）：harness 为自由变量；pkg entry 提供 shim =====
export default {
  inject: ['connection'],
  apply(ctx) {
    const subprocess = ctx.get('subprocess')
    const timer = ctx.get('timer')
    const fs = ctx.get('fs')
    if (subprocess === undefined || timer === undefined) return

    // H1 #445：原 31–215 行（bundled provider）已搬到 ./bootstrap.js，下见动态接线。
    // B3 rpc host 侧 shim：harness.handle('wf.x') → Map + connection.rpc.handle('/dsws') dispatch
    // 方案 C 原样复制后 pkg 入口不再经 build.mjs 注入 shim，改为源文件自带，避免 ReferenceError: harness is not defined
    const __DSW_HANDLERS__ = new Map()
    const harness = {
      handle: (method, fn) => {
        const endpoint = method.replace(/^wf\./, '')
        __DSW_HANDLERS__.set(endpoint, fn)
      }
    }

    // ============ 配置 ============
    // v1.5.0（公共发布）：兜底 gh 路径经 platform.env.get('DSH_GH_PATH')（#171 migrated，零直读 process.env）
    // 默认工作区 = DSH 进程当前目录（可被 wf.snapshot args.cwd 覆盖；去本机硬编码）
    const DEFAULT_CWD = (typeof process !== 'undefined' && typeof process.cwd === 'function') ? process.cwd() : ''
    const TIMEOUT_MS = 30000
    // v1.3.3 提速：快照缓存 5s → 60s（面板打开基本命中缓存，不再每次全量重建 11 次 gh 调用）
    const CACHE_MS = 60000
    // H1 #445：原 235–249 行（技能名单）已搬到 ./bootstrap.js。
    const QUERY = 'query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){issue(number:$n){number title state body url labels(first:20){nodes{name}} subIssues(first:100){totalCount nodes{number title state body url labels(first:10){nodes{name}} assignees(first:10){nodes{login}} blockedBy(first:20){nodes{number title state}} }}}}}'

    // ============ 状态 ============
    // H1 #445：ghPath/ghLastError/repoKeys 留守——721 行外多处直接读写裸变量（env 上报读 ghPath/ghLastError；建仓失效删 repoKeys），只能由 index.js 单一持有，新文件经显式存取器访问。
    let ghPath = null
    // #195 修复：失败不永久缓存 —— ghLastError 仅保留最近一次失败（覆盖式），环境修复后下次 resolveGh 覆盖为 null；不像旧实现首次失败永不重试
    let ghLastError = null
    let repoKeys = {}  // v12：repoKey 按 cwd 缓存（切换仓库会话时不再串仓库）
    let cache = { ts: 0, snapshot: null, error: null, cwd: null }
    let userHome = null                                     // 保留占位（#171 已迁 platform.getHome，缓存归平台 memoize）
    // H1 #445：repoRoots 留守（建仓失效删裸变量）与 _detectionService 恒空留守（唯一引用是 wf.bind 内无动作空检查，有无值行为一致）。
    let repoRoots = {}           // 根路径按 cwd 缓存
    let _detectionService = null  // H1 #445 恒空留守：唯一裸引用是 wf.bind 处理器内无动作空检查（有无值行为一致）；真状态归 platformChannel 所有
    // H1 #445：原 259–491 行（注册表/平台/探测）已搬到 ./platformChannel.js。
    let lastProbeAtByRepo = {}                            // v1.5 R2 + R2-fix-6（#2 MVP）：probe since 时间戳，按 repoKey 隔离（只在 probe 检测到 change 时推进；build 不得动它 —— 否则会吞掉同窗口编辑，见 buildSnapshot 处注释）
    let lastIssueIndexByRepo = {}                          // #2 deletion fix：保存上次全量 issue 索引，用于发现 GitHub 删除/状态消失

    // H1 #445：原 496–720 行（gh 封装/钥匙/缓存）已搬到 ./repoKeys.js。
    // ---- H1 #445 接线：3 新文件动态 import加载（D7 禁止静态 import），依赖全显式传入；新文件之间不互引用 ----
    // harness 留守原因：harness.handle 在 apply 同步注册，动态 import 无法同步供给。
    let _bootP = null
    function _boot() { if (!_bootP) _bootP = import('./bootstrap.js').then(function(m){ return m.createBootstrap({ ctx: ctx }) }); return _bootP }
    let _platP = null
    function _plat() { if (!_platP) _platP = (async function(){ const boot = await _boot(); const mod = await import('./platformChannel.js'); return mod.createPlatformChannel({ ctx: ctx, subprocess: subprocess, timer: timer, fs: fs, DEFAULT_CWD: DEFAULT_CWD, TIMEOUT_MS: TIMEOUT_MS, getMattSkillProbeNames: function(){ return getMattSkillProbeNames.apply(null, arguments) }, probeSkill: function(){ return probeSkill.apply(null, arguments) } }) })(); return _platP }
    let _repoP = null
    function _repo() { if (!_repoP) _repoP = (async function(){ const plat = await _plat(); const mod = await import('./repoKeys.js'); return mod.createRepoKeys({ subprocess: subprocess, timer: timer, fs: fs, DEFAULT_CWD: DEFAULT_CWD, TIMEOUT_MS: TIMEOUT_MS, repoKeys: repoKeys, repoRoots: repoRoots, getGhPath: function(){ return ghPath }, setGhPath: function(v){ ghPath = v }, getGhLastError: function(){ return ghLastError }, setGhLastError: function(v){ ghLastError = v }, getPlatform: function(){ return getPlatform.apply(null, arguments) }, getWorkspaceStore: function(){ return getWorkspaceStore.apply(null, arguments) }, setCache: function(v){ cache = v }, clearWorkspaceStore: function(){ return plat.clearWorkspaceStore.apply(plat, arguments) }, namingSweepSoon: function(){ return namingSweepSoon.apply(null, arguments) }, parseGithubRepo: function(){ return parseGithubRepo.apply(null, arguments) } }) })(); return _repoP }
    async function getMattSkillProbeNames() { const h = await _boot(); return h.getMattSkillProbeNames.apply(h, arguments) }
    async function getTrackerRegistry() { const h = await _plat(); return h.getTrackerRegistry.apply(h, arguments) }
    async function getPlatform() { const h = await _plat(); return h.getPlatform.apply(h, arguments) }
    async function getWorkspaceStore() { const h = await _plat(); return h.getWorkspaceStore.apply(h, arguments) }
    async function detectionExec() { const h = await _plat(); return h.detectionExec.apply(h, arguments) }
    async function getDetectionService() { const h = await _plat(); return h.getDetectionService.apply(h, arguments) }
    async function resolveGh() { const h = await _repo(); return h.resolveGh.apply(h, arguments) }
    async function resetGhCache() { const h = await _repo(); return h.resetGhCache.apply(h, arguments) }
    async function runGh() { const h = await _repo(); return h.runGh.apply(h, arguments) }
    async function execProc() { const h = await _repo(); return h.execProc.apply(h, arguments) }
    async function resolveGit() { const h = await _repo(); return h.resolveGit.apply(h, arguments) }
    async function getHome() { const h = await _repo(); return h.getHome.apply(h, arguments) }
    async function canonicalKey() { const h = await _repo(); return h.canonicalKey.apply(h, arguments) }
    async function getRepoRoot() { const h = await _repo(); return h.getRepoRoot.apply(h, arguments) }
    async function getCacheDir() { const h = await _repo(); return h.getCacheDir.apply(h, arguments) }
    async function cacheFileName() { const h = await _repo(); return h.cacheFileName.apply(h, arguments) }
    async function readDiskCache() { const h = await _repo(); return h.readDiskCache.apply(h, arguments) }
    async function writeDiskCache() { const h = await _repo(); return h.writeDiskCache.apply(h, arguments) }
    async function getRepoKey() { const h = await _repo(); return h.getRepoKey.apply(h, arguments) }
    try { _boot().catch(function(){}) } catch (e0) {}
    try { _plat().then(function(pl){ try { pl.getTrackerRegistry().catch(function(){}) } catch (e1) {} }).catch(function(){}) } catch (e2) {}

    // ---- H2 #446 接线：3 新文件动态 import 加载（D7 禁止静态 import），依赖全显式传入；新文件之间不互引用 ----
    // 留守（行为零变化优先；调用方在 H4/H5/H6 的同步上下文里，动态加载给不出同步函数）：
    //   computeLevels/groupTickets（H4 三处同步分组）、isRateLimitError（H5 三处同步判别）、
    //   issueIndexFromSnapshot/issueIndexChanged/rememberIssueIndex（H6 探测同步取值与同刻写表）。
    let _mapBodyP = null
    function _mapBody() { if (!_mapBodyP) _mapBodyP = import('./mapBody.js').then(function(m){ return m.createMapBody() }); return _mapBodyP }
    let _issueListP = null
    function _issueList() { if (!_issueListP) _issueListP = (async function(){ const mod = await import('./issueList.js'); return mod.createIssueList({ getRepoKey: function(){ return getRepoKey.apply(null, arguments) }, runGh: function(){ return runGh.apply(null, arguments) }, setCache: function(v){ cache = v }, issueIndexFromSnapshot: issueIndexFromSnapshot, issueIndexChanged: issueIndexChanged, rememberIssueIndex: rememberIssueIndex }) })(); return _issueListP }
    let _issueDetailP = null
    function _issueDetail() { if (!_issueDetailP) _issueDetailP = (async function(){ const mod = await import('./issueDetail.js'); const mb = await _mapBody(); const grp = await _group(); return mod.createIssueDetail({ getRepoKey: function(){ return getRepoKey.apply(null, arguments) }, runGh: function(){ return runGh.apply(null, arguments) }, execProc: function(){ return execProc.apply(null, arguments) }, getTrackerRegistry: function(){ return getTrackerRegistry.apply(null, arguments) }, getPlatform: function(){ return getPlatform.apply(null, arguments) }, getDetectionService: function(){ return getDetectionService.apply(null, arguments) }, getRepoRoot: function(){ return getRepoRoot.apply(null, arguments) }, ctx: ctx, timer: timer, getGhPath: function(){ return ghPath }, getGhLastError: function(){ return ghLastError }, fetchIssues: function(){ return fetchIssues.apply(null, arguments) }, fetchMapsDetailREST: function(){ return fetchMapsDetailREST.apply(null, arguments) }, mapTicket: mb.mapTicket, parseMapBody: mb.parseMapBody, computeLevels: grp.computeLevels, groupTickets: grp.groupTickets, isRateLimitError: isRateLimitError }) })(); return _issueDetailP }
    // ---- H2 #446 委托：原函数名与签名不变，外部调用方零改动 ----
    async function normalizeBody() { const h = await _mapBody(); return h.normalizeBody.apply(h, arguments) }
    async function parseMapBody() { const h = await _mapBody(); return h.parseMapBody.apply(h, arguments) }
    async function parseProgress() { const h = await _mapBody(); return h.parseProgress.apply(h, arguments) }
    async function mapTicket() { const h = await _mapBody(); return h.mapTicket.apply(h, arguments) }
    async function fetchMaps() { const h = await _issueList(); return h.fetchMaps.apply(h, arguments) }
    async function fetchAllIssuesManual() { const h = await _issueList(); return h.fetchAllIssuesManual.apply(h, arguments) }
    async function fetchAllIndexManual() { const h = await _issueList(); return h.fetchAllIndexManual.apply(h, arguments) }
    async function fetchIssues() { const h = await _issueList(); return h.fetchIssues.apply(h, arguments) }
    async function fetchIssueIndex() { const h = await _issueList(); return h.fetchIssueIndex.apply(h, arguments) }
    async function cacheSnapshotIsCurrent() { const h = await _issueList(); return h.cacheSnapshotIsCurrent.apply(h, arguments) }
    async function adoptSnapshot() { const h = await _issueList(); return h.adoptSnapshot.apply(h, arguments) }
    async function fetchMapsDetailREST() { const h = await _issueList(); return h.fetchMapsDetailREST.apply(h, arguments) }
    async function fetchMapsDetail() { const h = await _issueDetail(); return h.fetchMapsDetail.apply(h, arguments) }
    async function fetchIssueDetailREST() { const h = await _issueDetail(); return h.fetchIssueDetailREST.apply(h, arguments) }
    async function fetchIssueDetail() { const h = await _issueDetail(); return h.fetchIssueDetail.apply(h, arguments) }
    async function buildSnapshot() { const h = await _issueDetail(); return h.buildSnapshot.apply(h, arguments) }
    // ---- H3 #447 接线：3 新文件动态 import 加载，新文件之间不互引用 ----
    // 留守：parseGithubRepo 留守（repoKeys 同步调用）；chainCache 本块留守（index 单一持有）；harness.handle 注册留守（apply 同步注册）。
    let chainCache = { ts: 0, key: null, value: null }
    let _remotePredP = null
    function _remotePred() { if (!_remotePredP) _remotePredP = import('./remotePredicates.js').then(function(m){ return m.createRemotePredicates() }); return _remotePredP }
    let _skillProbeP = null
    function _skillProbe() { if (!_skillProbeP) _skillProbeP = (async function(){ const mod = await import('./skillProbe.js'); return mod.createSkillProbe({ ctx: ctx, getPlatform: function(){ return getPlatform.apply(null, arguments) }, getWorkspaceStore: function(){ return getWorkspaceStore.apply(null, arguments) }, resetChainCache: function(){ chainCache = { ts: 0, key: null, value: null } } }) })(); return _skillProbeP }
    let _detectChainP = null
    function _detectChain() { if (!_detectChainP) _detectChainP = (async function(){ const mod = await import('./detectChain.js'); return mod.createDetectChain({ canonicalKey: function(){ return canonicalKey.apply(null, arguments) }, DEFAULT_CWD: DEFAULT_CWD, resetGhCache: function(){ return resetGhCache.apply(null, arguments) }, getDetectionService: function(){ return getDetectionService.apply(null, arguments) }, getPlatform: function(){ return getPlatform.apply(null, arguments) }, getTrackerRegistry: function(){ return getTrackerRegistry.apply(null, arguments) }, getRepoKey: function(){ return getRepoKey.apply(null, arguments) }, runGh: function(){ return runGh.apply(null, arguments) }, timer: timer, probeSkill: function(){ return probeSkill.apply(null, arguments) }, mdParseOkPredicate: function(){ return mdParseOkPredicate.apply(null, arguments) }, getChainCache: function(){ return chainCache }, setChainCache: function(v){ chainCache = v } }) })(); return _detectChainP }
    // ---- H3 #447 委托：原函数名与签名不变，外部调用方零改动 ----
    async function mdParseOkPredicate() { const h = await _remotePred(); return h.mdParseOkPredicate.apply(h, arguments) }
    async function mdMapCandidates() { const h = await _remotePred(); return h.mdMapCandidates.apply(h, arguments) }
    async function fileExistsChainRel() { const h = await _remotePred(); return h.fileExistsChainRel.apply(h, arguments) }
    async function probeFsExists() { const h = await _skillProbe(); return h.probeFsExists.apply(h, arguments) }
    async function directSkillCardRead() { const h = await _skillProbe(); return h.directSkillCardRead.apply(h, arguments) }
    async function directPathExists() { const h = await _skillProbe(); return h.directPathExists.apply(h, arguments) }
    async function findProjectRootDir() { const h = await _skillProbe(); return h.findProjectRootDir.apply(h, arguments) }
    async function probeCardViaFs() { const h = await _skillProbe(); return h.probeCardViaFs.apply(h, arguments) }
    async function probeCardViaDirect() { const h = await _skillProbe(); return h.probeCardViaDirect.apply(h, arguments) }
    async function evidenceSummary() { const h = await _skillProbe(); return h.evidenceSummary.apply(h, arguments) }
    async function isSkillCardValid() { const h = await _skillProbe(); return h.isSkillCardValid.apply(h, arguments) }
    async function lightProbeReason() { const h = await _skillProbe(); return h.lightProbeReason.apply(h, arguments) }
    async function probeSkill() { const h = await _skillProbe(); return h.probeSkill.apply(h, arguments) }


    // H2 #446 留守：upcaseState/upcaseSnapStates 留入口（H4 四处同步升格快照状态；动态加载给不出同步函数）。
    // 客户端契约：state 按旧链路大写 OPEN/CLOSED（mapTicket 曾如此）；composer 归一为小写 open/closed，
    //   在此适配层统一升格，避免客户端把全部 closed 误判为 open（#327 面板“0 已关闭/大量错误状态”根因）。
    const upcaseState = function (s) { return String(s || '').toUpperCase() === 'CLOSED' ? 'CLOSED' : 'OPEN' }
    const upcaseSnapStates = function (inner) {
      if (!inner || typeof inner !== 'object') return inner
      ;(inner.maps || []).forEach(function (m) {
        m.state = upcaseState(m.state)
        ;(m.tickets || []).forEach(function (t) {
          t.state = upcaseState(t.state)
          if (Array.isArray(t.blockedBy)) t.blockedBy.forEach(function (b) { if (b && typeof b === 'object' && b.state != null) b.state = upcaseState(b.state) })
          if (Array.isArray(t.blocking)) t.blocking.forEach(function (b) { if (b && typeof b === 'object' && b.state != null) b.state = upcaseState(b.state) })
        })
      })
      ;(inner.issues || []).forEach(function (it) { it.state = upcaseState(it.state) })
      return inner
    }

    // H2 #446 留守：索引小函数留入口（H6 探测同步取值与同刻写表；file2 经显式参数复用同一份）。
    const issueIndexFromSnapshot = function (snap) {
      const index = {}
      const items = snap && Array.isArray(snap.issues) ? snap.issues : []
      items.forEach(function (item) {
        if (item && item.number !== undefined && item.number !== null) index[String(item.number)] = String(item.state || '').toUpperCase() + '|' + String(item.updatedAt || '')
      })
      return index
    }
    const issueIndexChanged = function (before, after) {
      if (!before) return true
      const beforeKeys = Object.keys(before)
      const afterKeys = Object.keys(after)
      if (beforeKeys.length !== afterKeys.length) return true
      for (let i = 0; i < afterKeys.length; i++) if (before[afterKeys[i]] !== after[afterKeys[i]]) return true
      return false
    }
    const rememberIssueIndex = function (repo, index) {
      if (repo && repo.owner && repo.name) lastIssueIndexByRepo[repo.owner + '/' + repo.name] = index
    }

    // H2 #446 留守：isRateLimitError 留入口（H5 三处同步判别；file3 经显式参数复用同一份）。
    function isRateLimitError(r) {
      const t = String((r && r.error) || (r && r.kind) || '').toLowerCase()
      return /rate\s*limit|ratelimit|403/.test(t)
    }


    // v1.3.3 提速：GraphQL aliases 一次查询全部 map 详情（8 次 → 1 次，Windows 下串行 8×2.4s → 单次 ~3.6s）
    //   每个 map 一个 alias（m0/m1/...），响应按 alias 取；网络类失败整批重试 1 次


    // ============ git 远程解析（getRepoKey 与后端谓词复用，#284）============
    // 解析 git 远程 URL → GitHub owner/repo；非 GitHub 返回 null
    function parseGithubRepo(url) {
      const s = String(url || '').trim()
      const m = s.match(/github\.com[\/:]([^\/\s]+)\/([^\/\s]+?)(?:\.git)?\s*$/)
      if (!m) return null
      return { owner: m[1], name: m[2] }
    }
    // H3 #447 留守：见上接线区。

    // H3 #447：见上接线区（原本地图谱谓词）。

    // H3 #447：见上接线区（原技能探测通道）。

    // H3 #447：见上接线区（原探测编排处理器）。
    harness.handle('wf.detect', async function (args) { const h = await _detectChain(); return h.handleDetect(args) })
    harness.handle('wf.chain', async function (args) { const h = await _detectChain(); return h.handleChain(args) })
    // ---- H4 #448 接线：3 新文件动态 import 加载（D7 禁止静态 import），依赖全显式传入；新文件之间不互引用 ----
    // harness 留守原因：harness.handle 在 apply 同步注册，动态 import 无法同步供给。
    let _sessLifeP = null
    function _sessLife() { if (!_sessLifeP) _sessLifeP = (async function(){ const mod = await import('./sessionLifecycle.js'); return mod.createSessionLifecycle({ ctx: ctx, DEFAULT_CWD: DEFAULT_CWD, errText: errText, getDetectionService: function(){ return getDetectionService.apply(null, arguments) }, getTrackerRegistry: function(){ return getTrackerRegistry.apply(null, arguments) }, getPlatform: function(){ return getPlatform.apply(null, arguments) } }) })(); return _sessLifeP }
    let _sessSnapP = null
    function _sessSnap() { if (!_sessSnapP) _sessSnapP = (async function(){ const life = await _sessLife(); const mod = await import('./sessionSnapshot.js'); const grp = await _group(); return mod.createSessionSnapshot({ canonicalKey: function(){ return canonicalKey.apply(null, arguments) }, selectEarly: life.selectEarly, isComposerSelection: life.isComposerSelection, getTrackerRegistry: function(){ return getTrackerRegistry.apply(null, arguments) }, getPlatform: function(){ return getPlatform.apply(null, arguments) }, ctx: ctx, getCache: function(){ return cache }, setCache: function(v){ cache = v }, CACHE_MS: CACHE_MS, cacheSnapshotIsCurrent: function(){ return cacheSnapshotIsCurrent.apply(null, arguments) }, upcaseSnapStates: upcaseSnapStates, computeLevels: grp.computeLevels, groupTickets: grp.groupTickets, getRepoRoot: function(){ return getRepoRoot.apply(null, arguments) }, getRepoKey: function(){ return getRepoKey.apply(null, arguments) }, readDiskCache: function(){ return readDiskCache.apply(null, arguments) }, writeDiskCache: function(){ return writeDiskCache.apply(null, arguments) }, adoptSnapshot: function(){ return adoptSnapshot.apply(null, arguments) }, detectionExec: function(){ return detectionExec.apply(null, arguments) }, getGhPath: function(){ return ghPath }, getGhLastError: function(){ return ghLastError }, errText: errText, DEFAULT_CWD: DEFAULT_CWD }) })(); return _sessSnapP }
    let _sessRefP = null
    function _sessRef() { if (!_sessRefP) _sessRefP = (async function(){ const life = await _sessLife(); const mod = await import('./sessionRefresh.js'); const grp = await _group(); return mod.createSessionRefresh({ canonicalKey: function(){ return canonicalKey.apply(null, arguments) }, selectEarly: life.selectEarly, isComposerSelection: life.isComposerSelection, resetGhCache: function(){ return resetGhCache.apply(null, arguments) }, getTrackerRegistry: function(){ return getTrackerRegistry.apply(null, arguments) }, getPlatform: function(){ return getPlatform.apply(null, arguments) }, ctx: ctx, getCache: function(){ return cache }, setCache: function(v){ cache = v }, upcaseSnapStates: upcaseSnapStates, computeLevels: grp.computeLevels, groupTickets: grp.groupTickets, getRepoRoot: function(){ return getRepoRoot.apply(null, arguments) }, getRepoKey: function(){ return getRepoKey.apply(null, arguments) }, readDiskCache: function(){ return readDiskCache.apply(null, arguments) }, writeDiskCache: function(){ return writeDiskCache.apply(null, arguments) }, adoptSnapshot: function(){ return adoptSnapshot.apply(null, arguments) }, detectionExec: function(){ return detectionExec.apply(null, arguments) }, getGhPath: function(){ return ghPath }, getGhLastError: function(){ return ghLastError }, errText: errText, DEFAULT_CWD: DEFAULT_CWD }) })(); return _sessRefP }
    // ---- H4 #448 委托：电话名与签名不变，外部调用方零改动 ----
    harness.handle('wf.ping', async function () { const h = await _sessLife(); return h.handlePing.apply(h, arguments) })

    // v13：按 sessionId 反查会话工作目录（client 切换对话时用；宿主 sessions.meta 是权威字段，
    // 不再依赖 client 猜测 ConversationSnapshot 字段名）
    // 错误对象 → 可读文本：fetchMaps/buildSnapshot 抛出的是 {kind, error} 对象，String() 会变 [object Object]
    const errText = function (e) {
      if (e === undefined || e === null) return '未知错误'
      if (typeof e === 'string') return e
      if (typeof e.message === 'string') return e.message
      if (typeof e.error === 'string') return e.error
      try { return JSON.stringify(e) } catch (err) { return String(e) }
    }

    harness.handle('wf.cwd', async function (args) { const h = await _sessLife(); return h.handleCwd(args) })

    // #179 回切自愈：空 cwd 仍兜 DEFAULT_CWD 作最后兜底（避免“没有仓库”空白），但客户端已保证同 sid 切工作区亦触发，空窗极短
    harness.handle('wf.snapshot', async function (args) { const h = await _sessSnap(); return h.handleSnapshot(args) })

    harness.handle('wf.refresh', async function (args) { const h = await _sessRef(); return h.handleRefresh(args) })

    // ---- H5 #449 接线：2 新文件动态 import 加载（D7 禁止静态 import），依赖全显式传入；新文件之间不互引用 ----
    // 留守：harness.handle 注册留守（apply 同步注册，动态加载无法同步供给）；isRateLimitError 留守（H2 已注：H5 三处同步判别经显式参数复用同一份）。
    // 共享收敛：normCwd 由 workspaceCwd 单一持有，评论线程经 index 转供给复用，不各留一份拷贝；
    //   单票分发前奏（探测+回退）由 _sessLife.selectEarly/isComposerSelection 转供给三处复用，不各留一份拷贝（H4 同例）。
    // H5 #449：见下接线区（原工作区归一与绑定选择）。
    // H5 #449：见下接线区（原单票详情与评论读写及探针）。
    let _workspaceP = null
    function _workspace() { if (!_workspaceP) _workspaceP = (async function(){ const mod = await import('./workspaceCwd.js'); return mod.createWorkspaceCwd({ ctx: ctx, DEFAULT_CWD: DEFAULT_CWD, getPlatform: function(){ return getPlatform.apply(null, arguments) }, getTrackerRegistry: function(){ return getTrackerRegistry.apply(null, arguments) }, getWorkspaceStore: function(){ return getWorkspaceStore.apply(null, arguments) }, canonicalKey: function(){ return canonicalKey.apply(null, arguments) }, setCache: function(v){ cache = v } }) })(); return _workspaceP }
    let _commentsP = null
    function _comments() { if (!_commentsP) _commentsP = (async function(){ const ws = await _workspace(); const life = await _sessLife(); const mod = await import('./commentThreads.js'); return mod.createCommentThreads({ normCwd: ws.normCwd, canonicalKey: function(){ return canonicalKey.apply(null, arguments) }, selectEarly: life.selectEarly, isComposerSelection: life.isComposerSelection, getTrackerRegistry: function(){ return getTrackerRegistry.apply(null, arguments) }, getPlatform: function(){ return getPlatform.apply(null, arguments) }, ctx: ctx, timer: timer, DEFAULT_CWD: DEFAULT_CWD, errText: errText, isRateLimitError: isRateLimitError, getRepoKey: function(){ return getRepoKey.apply(null, arguments) }, runGh: function(){ return runGh.apply(null, arguments) }, execProc: function(){ return execProc.apply(null, arguments) }, fetchIssueDetail: function(){ return fetchIssueDetail.apply(null, arguments) }, fetchIssueIndex: function(){ return fetchIssueIndex.apply(null, arguments) }, issueIndexFromSnapshot: issueIndexFromSnapshot, issueIndexChanged: issueIndexChanged, rememberIssueIndex: rememberIssueIndex, getCache: function(){ return cache }, setCache: function(v){ cache = v }, lastIssueIndexByRepo: lastIssueIndexByRepo, lastProbeAtByRepo: lastProbeAtByRepo }) })(); return _commentsP }
    // ---- H5 #449 委托：原函数名与签名不变，外部调用方（含 H6 认领/交接）零改动 ----
    async function normCwd() { const h = await _workspace(); return h.normCwd.apply(h, arguments) }
    harness.handle('wf.bind', async function () { const h = await _workspace(); return h.handleBind.apply(h, arguments) })
    harness.handle('wf.bindings', async function () { const h = await _workspace(); return h.handleBindings.apply(h, arguments) })
    harness.handle('wf.registry', async function () { const h = await _workspace(); return h.handleRegistry.apply(h, arguments) })
    harness.handle('wf.selection', async function () { const h = await _workspace(); return h.handleSelection.apply(h, arguments) })
    harness.handle('wf.issueDetail', async function () { const h = await _comments(); return h.handleIssueDetail.apply(h, arguments) })
    harness.handle('wf.issueComments', async function () { const h = await _comments(); return h.handleIssueComments.apply(h, arguments) })
    harness.handle('wf.commentIssue', async function () { const h = await _comments(); return h.handleCommentIssue.apply(h, arguments) })
    harness.handle('wf.probe', async function () { const h = await _comments(); return h.handleProbe.apply(h, arguments) })


    // ---- H6 #450 接线：5 新文件动态 import 加载（D7 禁止静态 import），依赖全显式传入；新文件之间不互引用 ----
    // 第 5 件 ticketGrouping 为压线追加（用户定夺）：computeLevels/groupTickets 纯函数搬出，H2/H4 loader 取值后转供给。
    let _handoffP = null
    function _handoff() { if (!_handoffP) _handoffP = (async function(){ const mod = await import('./handoffClaim.js'); return mod.createHandoffClaim({ fs: fs, DEFAULT_CWD: DEFAULT_CWD, normCwd: function(){ return normCwd.apply(null, arguments) }, getDetectionService: function(){ return getDetectionService.apply(null, arguments) }, getTrackerRegistry: function(){ return getTrackerRegistry.apply(null, arguments) }, getPlatform: function(){ return getPlatform.apply(null, arguments) }, ctx: ctx, getRepoKey: function(){ return getRepoKey.apply(null, arguments) }, runGh: function(){ return runGh.apply(null, arguments) }, setCache: function(v){ cache = v } }) })(); return _handoffP }
    let _namingP = null
    function _naming() { if (!_namingP) _namingP = (async function(){ const mod = await import('./namingGuardian.js'); return mod.createNamingGuardian({ fs: fs, timer: timer, DEFAULT_CWD: DEFAULT_CWD, getCacheDir: function(){ return getCacheDir.apply(null, arguments) }, getPlatform: function(){ return getPlatform.apply(null, arguments) }, getRepoKey: function(){ return getRepoKey.apply(null, arguments) }, runGh: function(){ return runGh.apply(null, arguments) } }) })(); return _namingP }
    let _publishP = null
    function _publish() { if (!_publishP) _publishP = (async function(){ const mod = await import('./publishFlow.js'); return mod.createPublishFlow({ DEFAULT_CWD: DEFAULT_CWD, resolveGit: function(){ return resolveGit.apply(null, arguments) }, resolveGh: function(){ return resolveGh.apply(null, arguments) }, getGhLastError: function(){ return ghLastError }, runGh: function(){ return runGh.apply(null, arguments) }, execProc: function(){ return execProc.apply(null, arguments) }, canonicalKey: function(){ return canonicalKey.apply(null, arguments) }, getRepoKey: function(){ return getRepoKey.apply(null, arguments) }, repoKeys: repoKeys, repoRoots: repoRoots, setCache: function(v){ cache = v } }) })(); return _publishP }
    let _pickerP = null
    function _picker() { if (!_pickerP) _pickerP = (async function(){ const mod = await import('./pickerShell.js'); return mod.createPickerShell({ DEFAULT_CWD: DEFAULT_CWD, getPlatform: function(){ return getPlatform.apply(null, arguments) }, subprocess: subprocess, timer: timer }) })(); return _pickerP }
    let _groupP = null
    function _group() { if (!_groupP) _groupP = import('./ticketGrouping.js').then(function(m){ return m.createTicketGrouping() }); return _groupP }
    // H6 同步外形保持：_repo 接线经此同步函数取即时推进（原命名块内同步定义；现为加载后防火即发，无返回值、永不抛，调用方 try 包裹语义不变）。
    function namingSweepSoon(delayMs) { _naming().then(function(h){ try { h.namingSweepSoon(delayMs) } catch (eSw) {} }).catch(function(){}) }
    harness.handle('wf.handoffLatest', async function () { const h = await _handoff(); return h.handleHandoffLatest.apply(h, arguments) })
    harness.handle('wf.handoffResolve', async function () { const h = await _handoff(); return h.handleHandoffResolve.apply(h, arguments) })
    harness.handle('wf.claim', async function () { const h = await _handoff(); return h.handleClaim.apply(h, arguments) })
    harness.handle('wf.namingRegister', async function () { const h = await _naming(); return h.namingRegisterHandler.apply(h, arguments) })
    harness.handle('wf.registerNewSessionWatcher', async function () { const h = await _naming(); return h.namingRegisterHandler.apply(h, arguments) })
    harness.handle('wf.namingSignal', async function () { const h = await _naming(); return h.handleNamingSignal.apply(h, arguments) })
    harness.handle('wf.namingPlan', async function () { const h = await _naming(); return h.handleNamingPlan.apply(h, arguments) })
    harness.handle('wf.namingResult', async function () { const h = await _naming(); return h.handleNamingResult.apply(h, arguments) })
    harness.handle('wf.cancelNewSessionWatcher', async function () { const h = await _naming(); return h.handleCancelNewSessionWatcher.apply(h, arguments) })
    harness.handle('wf.awaitCreatedIssue', async function () { const h = await _naming(); return h.handleAwaitCreatedIssue.apply(h, arguments) })
    harness.handle('wf.openFolder', async function () { const h = await _picker(); return h.handleOpenFolder.apply(h, arguments) })
    harness.handle('wf.initPublish', async function () { const h = await _publish(); return h.handleInitPublish.apply(h, arguments) })
    harness.handle('wf.retryPush', async function () { const h = await _publish(); return h.handleRetryPush.apply(h, arguments) })
    harness.handle('wf.pickDirectory', async function () { const h = await _picker(); return h.handlePickDirectory.apply(h, arguments) })
    harness.handle('wf.pickFile', async function () { const h = await _picker(); return h.handlePickFile.apply(h, arguments) })
    harness.handle('wf.openPath', async function () { const h = await _picker(); return h.handleOpenPath.apply(h, arguments) })

    // ============ 轮询：已按 #348 拍板 Q3 关闭（60s 全量 × 8 map ≈ 2400-4800 GraphQL points/h 贴 5000 限额）============
    // 刷新策略 = 纯手动（状态条/面板按钮 wf.refresh）+ 打开面板即刷（client 侧 loadSnapshot）。
    // P1 若做状态变化 toast 提醒，再考虑低频自动（届时恢复本块并观察配额）。

    // #265：命名守护常驻轻量任务启动（脏账落盘心跳；守护块见上）
    // #265 常驻轻量任务启动（H6 #450 后由命名模块持有，入口防火即发，脏账落盘心跳语义不变）。
    _naming().then(function(h){ try { h.startNamingGuardianLoop() } catch (eLoop) {} }).catch(function(){})

    // B3 rpc 通道注册：/dsws → dispatch 表（loopback 权威）
    try {
      const connection = ctx.get('connection')
      if (connection !== undefined && connection.rpc !== undefined && typeof connection.rpc.handle === 'function') {
        connection.rpc.handle('/dsws', async (endpoint, payload) => {
          const fn = __DSW_HANDLERS__.get(endpoint)
          if (!fn) return { ok: false, error: { code: 'internal', message: 'unknown endpoint: ' + endpoint, details: {} } }
          try {
            const value = await fn(payload)
            return { ok: true, value }
          } catch (e) {
            return { ok: false, error: { code: 'internal', message: String((e && e.message) || e), details: {} } }
          }
        }, { authority: 'loopback' })
      }
    } catch {}
  },
}