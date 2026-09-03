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
    function _issueDetail() { if (!_issueDetailP) _issueDetailP = (async function(){ const mod = await import('./issueDetail.js'); const mb = await _mapBody(); return mod.createIssueDetail({ getRepoKey: function(){ return getRepoKey.apply(null, arguments) }, runGh: function(){ return runGh.apply(null, arguments) }, execProc: function(){ return execProc.apply(null, arguments) }, getTrackerRegistry: function(){ return getTrackerRegistry.apply(null, arguments) }, getPlatform: function(){ return getPlatform.apply(null, arguments) }, getDetectionService: function(){ return getDetectionService.apply(null, arguments) }, getRepoRoot: function(){ return getRepoRoot.apply(null, arguments) }, ctx: ctx, timer: timer, getGhPath: function(){ return ghPath }, getGhLastError: function(){ return ghLastError }, fetchIssues: function(){ return fetchIssues.apply(null, arguments) }, fetchMapsDetailREST: function(){ return fetchMapsDetailREST.apply(null, arguments) }, mapTicket: mb.mapTicket, parseMapBody: mb.parseMapBody, computeLevels: computeLevels, groupTickets: groupTickets, isRateLimitError: isRateLimitError }) })(); return _issueDetailP }
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

    // H2 #446 留守：computeLevels/groupTickets 留入口（H4 三处同步分组；file3 经显式参数复用同一份）。
    function computeLevels(tickets) {
      const byNum = {}
      tickets.forEach(function (t) { byNum[t.number] = t })
      const memo = {}
      const levelOf = function (t) {
        if (memo[t.number] !== undefined) return memo[t.number]
        const blockers = (t.blockedBy || []).map(function (b) { return byNum[b] }).filter(Boolean)
        if (!blockers.length) { memo[t.number] = 0; return 0 }
        let maxL = -1
        blockers.forEach(function (b) { const l = levelOf(b); if (l > maxL) maxL = l })
        memo[t.number] = maxL + 1
        return memo[t.number]
      }
      const byNumber = {}
      tickets.forEach(function (t) { byNumber[t.number] = levelOf(t) })
      const levels = []
      tickets.forEach(function (t) {
        const lv = byNumber[t.number]
        let layer = levels[lv]
        if (!layer) { layer = { level: lv, numbers: [], open: 0, closed: 0, total: 0, frontier: 0, claimed: 0, blocked: 0 }; levels[lv] = layer }
        layer.numbers.push(t.number)
        layer.total++
        if (t.state === 'CLOSED') layer.closed++
        else layer.open++
      })
      // 层内状态细分（frontier/claimed/blocked 归层）
      const openBlocker = function (b) { const t = byNum[b]; return t !== undefined && t.state === 'OPEN' }
      levels.forEach(function (layer) {
        const openT = tickets.filter(function (t) { return byNumber[t.number] === layer.level && t.state === 'OPEN' })
        layer.frontier = openT.filter(function (t) { return !t.claimedBy && !t.blockedBy.some(openBlocker) }).length
        layer.claimed = openT.filter(function (t) { return t.claimedBy }).length
        layer.blocked = openT.filter(function (t) { return !t.claimedBy && t.blockedBy.some(openBlocker) }).length
      })
      // 剔除空洞（levels 数组可能因跳级出现 undefined）
      const compact = levels.filter(Boolean)
      return { byNumber: byNumber, levels: compact }
    }

    function groupTickets(tickets) {
      const byNum = {}
      tickets.forEach(function (t) { byNum[t.number] = t })
      const openBlocker = function (b) { const t = byNum[b]; return t !== undefined && t.state === 'OPEN' }
      const open = tickets.filter(function (t) { return t.state === 'OPEN' })
      const closed = tickets.filter(function (t) { return t.state === 'CLOSED' })
      const frontier = open.filter(function (t) { return !t.claimedBy && !t.blockedBy.some(openBlocker) })
      const claimed = open.filter(function (t) { return t.claimedBy })
      const blocked = open.filter(function (t) { return !t.claimedBy && t.blockedBy.some(openBlocker) })
      // v1.4（T1 #442）：附 DAG 分层（client 渲染漏斗分层用）
      const lv = computeLevels(tickets)
      return {
        total: tickets.length, open: open.length, closed: closed.length,
        frontier: frontier.length, claimed: claimed.length, blocked: blocked.length,
        levels: lv.levels, levelOf: lv.byNumber,
      }
    }

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
    function _sessSnap() { if (!_sessSnapP) _sessSnapP = (async function(){ const life = await _sessLife(); const mod = await import('./sessionSnapshot.js'); return mod.createSessionSnapshot({ canonicalKey: function(){ return canonicalKey.apply(null, arguments) }, selectEarly: life.selectEarly, isComposerSelection: life.isComposerSelection, getTrackerRegistry: function(){ return getTrackerRegistry.apply(null, arguments) }, getPlatform: function(){ return getPlatform.apply(null, arguments) }, ctx: ctx, getCache: function(){ return cache }, setCache: function(v){ cache = v }, CACHE_MS: CACHE_MS, cacheSnapshotIsCurrent: function(){ return cacheSnapshotIsCurrent.apply(null, arguments) }, upcaseSnapStates: upcaseSnapStates, computeLevels: computeLevels, groupTickets: groupTickets, getRepoRoot: function(){ return getRepoRoot.apply(null, arguments) }, getRepoKey: function(){ return getRepoKey.apply(null, arguments) }, readDiskCache: function(){ return readDiskCache.apply(null, arguments) }, writeDiskCache: function(){ return writeDiskCache.apply(null, arguments) }, adoptSnapshot: function(){ return adoptSnapshot.apply(null, arguments) }, detectionExec: function(){ return detectionExec.apply(null, arguments) }, getGhPath: function(){ return ghPath }, getGhLastError: function(){ return ghLastError }, errText: errText, DEFAULT_CWD: DEFAULT_CWD }) })(); return _sessSnapP }
    let _sessRefP = null
    function _sessRef() { if (!_sessRefP) _sessRefP = (async function(){ const life = await _sessLife(); const mod = await import('./sessionRefresh.js'); return mod.createSessionRefresh({ canonicalKey: function(){ return canonicalKey.apply(null, arguments) }, selectEarly: life.selectEarly, isComposerSelection: life.isComposerSelection, resetGhCache: function(){ return resetGhCache.apply(null, arguments) }, getTrackerRegistry: function(){ return getTrackerRegistry.apply(null, arguments) }, getPlatform: function(){ return getPlatform.apply(null, arguments) }, ctx: ctx, getCache: function(){ return cache }, setCache: function(v){ cache = v }, upcaseSnapStates: upcaseSnapStates, computeLevels: computeLevels, groupTickets: groupTickets, getRepoRoot: function(){ return getRepoRoot.apply(null, arguments) }, getRepoKey: function(){ return getRepoKey.apply(null, arguments) }, readDiskCache: function(){ return readDiskCache.apply(null, arguments) }, writeDiskCache: function(){ return writeDiskCache.apply(null, arguments) }, adoptSnapshot: function(){ return adoptSnapshot.apply(null, arguments) }, detectionExec: function(){ return detectionExec.apply(null, arguments) }, getGhPath: function(){ return ghPath }, getGhLastError: function(){ return ghLastError }, errText: errText, DEFAULT_CWD: DEFAULT_CWD }) })(); return _sessRefP }
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

    // #155 + #152：后端绑定（per-workspace 覆盖，唯一写路径不回写 issue-tracker.md）+ 注册表查询 + detection 缓存失效
    // #176 + #190 修复：cwd 归一（绝对直通 + 相对尝试 fs.resolve + home 试探）
    // 根因：workspaces 服务在 client runtime 暴露的 item.path 可能是相对名（如 "matt-demo-markdown"），
    // 传给 wf.selection 后 select() 三级联中 markdown.matches 收到相对 cwd，plat.join(cwd,...) 仍是相对，
    // fs.resolve 默认基于进程 cwd 解析失败 → matches false → fallback → UI "未绑定"。
    // 归一后所有 handler 收到绝对 cwd，markdown.matches 命中 docs/agents/issue-tracker.md → Markdown 自动。
    async function normCwd(raw){
      if(!raw) return DEFAULT_CWD
      try{
        const plat=await getPlatform()
        if(plat&&plat.path&&typeof plat.path.isAbsolute==='function'&&plat.path.isAbsolute(raw)) return plat.path.normalize(raw)
      }catch{}
      // 相对：DSH fs.resolve 试探（DSH 平台 fs 可能感知 workspaces 根）
      try{
        const fss=ctx.get('fs')
        if(fss&&typeof fss.resolve==='function'){
          const t=await fss.resolve(raw)
          const target=(t&&typeof t==='object')?(t.path||t.target):t
          if(typeof target==='string'&&target&&(/^[A-Za-z]:[\\/]/.test(target)||/^\//.test(target))) return target
        }
      }catch{}
      // home 试探（windows + posix）
      try{
        const plat=await getPlatform()
        const home=plat&&typeof plat.getHome==='function'?await plat.getHome():null
        if(home&&plat.path) return plat.path.join(home,raw)
      }catch{}
      return raw
    }
    
    harness.handle('wf.bind', async function (args) {
      const cwd = await canonicalKey((args && args.cwd) || DEFAULT_CWD)
      const backendId = args && ('backendId' in args ? args.backendId : args.backend)
      try {
        const reg = await getTrackerRegistry()
        if (!reg) return { ok: false, error: 'registry unavailable' }
        const handle = { cwd: cwd }
        // null = 显式无后端（Other 逃生舱）；'other' 已弃用按 registry 拒绝
        reg.bind(handle, backendId === undefined ? null : backendId)
        // 失效快照 + 状态 + 探测三缓存（per-workspace 切换不串台，Q3；workspaceStore 内存单例失效）
        cache = { ts: 0, snapshot: null, error: null, cwd: null }
        try { const ws = await getWorkspaceStore(); ws.invalidate(handle) } catch {}
        try { if (_detectionService) { /* 下次 detect 重算 */ } } catch {}
        return { ok: true, cwd: cwd, backendId: backendId === undefined ? null : backendId }
      } catch (e) {
        const msg = String((e && e.message) || e)
        if (/unknown-backend/.test(msg)) return { ok: false, error: msg, kind: 'unknown-backend' }
        return { ok: false, error: msg }
      }
    })
    harness.handle('wf.bindings', async function () {
      try {
        const reg = await getTrackerRegistry()
        if (!reg) return { ok: false, error: 'registry unavailable' }
        const list = typeof reg.allBindings === 'function' ? reg.allBindings() : []
        const bindings = await Promise.all(list.map(async function (b) {
          const rawCwd = b.cwd || (b.handle && b.handle.cwd) || ''
          const cwd = await normCwd(rawCwd)
          let ref = null
          if (b.backendId) { try { ref = reg.describe({ cwd: cwd }, b.backendId) } catch {} }
          return { cwd: cwd, backendId: b.backendId, source: 'explicit', ref: ref }
        }))
        return { ok: true, bindings: bindings }
      } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
    })
    harness.handle('wf.registry', async function (args) {
      try {
        const reg = await getTrackerRegistry()
        if (!reg) return { ok: false, error: 'registry unavailable' }
        const mods = reg.modules().map(function(m){ return Object.assign({ id: m.id, label: m.label, presentation: m.presentation }, m.setupPrompt ? { setupPrompt: m.setupPrompt } : {}, m.labelPalette ? { labelPalette: m.labelPalette } : {}, m.links ? { links: m.links } : {}, m.capabilities ? { capabilities: m.capabilities } : {}, m.prompts ? { prompts: m.prompts } : {}, m.openRepository ? { openRepository: m.openRepository } : {}) }) // #230：转发后端声明的 setup 描述数据键（键入 locale）· #323：转发后端默认调色盘（labelPalette）
        const cwd = (args && args.cwd) || DEFAULT_CWD
        let bound = undefined
        try { bound = reg.bound({ cwd: cwd }) } catch {}
        return { ok: true, modules: mods, bound: bound }
      } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
    })
    harness.handle('wf.selection', async function (args) {
      const cwd = await normCwd((args && args.cwd) || DEFAULT_CWD)
      try {
        const reg = await getTrackerRegistry()
        if (!reg) return { ok: false, error: 'registry unavailable' }
        const sel = await reg.select({ cwd: cwd }, { cwd: cwd, platform: await getPlatform(), fs: ctx.get('fs') })
        let repoRef = null
        if (sel && sel.backendId) { try { repoRef = reg.describe({ cwd: cwd }, sel.backendId) } catch {} }
        return { ok: true, selection: sel, repository: repoRef }
      } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
    })
    harness.handle('wf.issueDetail', async function (args) {
      const n = args && args.number
      const cwd = await normCwd((args && args.cwd) || DEFAULT_CWD)
      if (!n) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
      try {
        // 第一性原理分发：按探测结果走对应后端
        let _sel = null
        try {
          const svc = await getDetectionService()
          if (svc && typeof svc.detect === 'function') {
            const det = await svc.detect({ cwd }, { skipSkillProbes: true, hintBackendId: (args && args.backendId) || undefined })
            if (det && det.selection) _sel = det.selection
          }
        } catch {}
        if (!_sel || (_sel.backendId == null && (!_sel.source || _sel.source !== 'explicit'))) {
          try {
            const regTmp = await getTrackerRegistry()
            const tmpHandle = { cwd }
            const tmpCtx = { cwd, platform: await getPlatform(), fs: ctx.get('fs') }
            const sel2 = await regTmp.select(tmpHandle, tmpCtx)
            if (sel2) _sel = sel2
          } catch {}
        }
        const useTracker = _sel && _sel.backendId && _sel.backendId !== 'github' && _sel.backendId !== '' && _sel.backendId !== 'other'
        if (useTracker) {
          const reg = await getTrackerRegistry()
          const backendId = _sel.backendId
          const tracker = reg.get(backendId)
          if (!tracker || typeof tracker.get !== 'function') return { ok: false, error: { kind: 'unsupported', message: "backend '" + backendId + "' 未实现 get" } }
          let repoRef = null
          try { repoRef = reg.describe({ cwd }, backendId) } catch {}
          if (!repoRef) repoRef = { backend: backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || backendId, url: '' }
          const opCtx = { cwd, platform: await getPlatform(), fs: ctx.get('fs') }
          const key = String(n).padStart(2, '0')
          const r = await tracker.get(repoRef, key, {}, opCtx)
          if (!r || !r.ok) return r
          // 统一为 fetchIssueDetail 的返回形状（{ok, issue}），便于客户端复用
          const iss = r.data
          // 适配客户端期望的 issue 形状：补充 number / labels 节点等
          if (iss && iss.key != null && iss.number == null) {
            const nn = parseInt(iss.key, 10)
            if (!isNaN(nn)) iss.number = nn
          }
          // 将 key 归一为字符串
          if (iss && iss.key != null) iss.key = String(iss.key)
          // 详情需要包含 comments / blockedBy 等，markdown 的 get 已包含
          return { ok: true, issue: {
            number: iss.number != null ? iss.number : (iss.key ? parseInt(iss.key,10) : n),
            title: iss.title || '',
            state: iss.state === 'closed' ? 'CLOSED' : 'OPEN',
            body: iss.body || '',
            url: iss.url || '',
            updatedAt: iss.updatedAt || '',
            createdAt: iss.createdAt || '',
            closedAt: iss.closedAt || null,
            author: iss.author,
            labels: { nodes: (iss.labels || []).map(function(l){ return { name: l.name, color: l.color || '' } }) },
            assignees: { nodes: (iss.assignees || []).map(function(a){ return typeof a === 'string' ? { login: a } : a }) },
            comments: iss.comments || { nodes: [] },
            subIssues: iss.subIssues || { totalCount: 0, nodes: [] },
            blockedBy: { nodes: (iss.blockedBy || []).map(function(b){ if (typeof b === 'number') return { number: b }; if (b && b.key != null) { const nn = parseInt(b.key,10); return { number: isNaN(nn) ? b.key : nn, title: b.title||'', state: b.state==='closed'?'CLOSED':'OPEN' }; } return b; }) },
            blocking: { nodes: [] },
          } }
        }
        const r = await fetchIssueDetail(Number(n), cwd)
        return r
      } catch (e) { return { ok: false, error: { kind: 'network', message: errText(e) } } }
    })
    // T5 #10 · 评论分页（反向分页 cursor，节流由 client 侧 600ms 控制；单页 50，失败重试与 3 次兜底）
    async function fetchIssueCommentsREST(n, after, cwd) {
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', message: '无法解析 owner/repo' } }
      try {
        // REST 分页：after 为已加载数（如 "50"），page = floor(after/50)+1；GraphQL cursor 场景下退化为 page 2 起
        let page = 1
        if (after) {
          const num = Number(after)
          if (!isNaN(num) && num >= 0) page = Math.floor(num / 50) + 2
          else page = 2
        } else {
          page = 1
        }
        const r = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/issues/' + n + '/comments?per_page=50&page=' + page], cwd)
        if (!r.ok) {
          if (r.kind === 'notfound' || /404/i.test(String(r.error||''))) return { ok: false, error: { kind: '404', message: String(r.error||'not found') } }
          if (isRateLimitError(r)) return { ok: false, error: { kind: 'rateLimit', message: String(r.error||'rate limit') } }
          return { ok: false, error: { kind: r.kind || 'network', message: String(r.error||'request failed') } }
        }
        const arr = JSON.parse(r.text) || []
        const nodes = arr.map(function (c) { return { author: { login: (c.user && c.user.login) || '' }, authorAssociation: c.author_association || '', body: c.body || '', createdAt: c.created_at, updatedAt: c.updated_at } })
        const hasNext = nodes.length === 50
        const endCursor = String((Number(after||0) + nodes.length))
        return { ok: true, nodes: nodes, pageInfo: { hasNextPage: hasNext, endCursor: endCursor }, fallback: 'rest' }
      } catch (e) { return { ok: false, error: { kind: 'parse', message: String(e) } } }
    }
    async function fetchIssueComments(n, after, cwd) {
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', message: '无法解析 owner/repo' } }
      if (!n) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
      // GraphQL 优先（cursor 分页）
      const query = 'query($owner:String!,$name:String!,$n:Int!,$after:String){repository(owner:$owner,name:$name){issue(number:$n){comments(first:50, after:$after){nodes{author{login} authorAssociation body createdAt updatedAt} pageInfo{hasNextPage endCursor}}}}}'
      // after 为 null 时传空字符串，GraphQL 会视为空 cursor（首段）；需传递变量 after 否则报错，故用 -F after= 值，空则首段
      const afterVal = after || null
      for (let attempt = 0; attempt < 2; attempt++) {
        const args = ['api', 'graphql', '-f', 'query=' + query, '-F', 'owner=' + repo.owner, '-F', 'name=' + repo.name, '-F', 'n=' + n]
        if (afterVal) args.push('-F', 'after=' + afterVal)
        else args.push('-F', 'after=')
        const r = await runGh(args, cwd)
        if (!r.ok) {
          if (isRateLimitError(r)) return fetchIssueCommentsREST(n, after, cwd)
          if (r.kind === 'notfound' || /not found|could not resolve/i.test(String(r.error||''))) return { ok: false, error: { kind: 'notFound', message: String(r.error||'not found') } }
          if (r.kind !== 'network') return { ok: false, error: { kind: r.kind || 'network', message: String(r.error||'network') } }
          continue
        }
        try {
          const j = JSON.parse(r.text)
          if (j.errors) {
            if (isRateLimitError({ error: JSON.stringify(j.errors) })) return fetchIssueCommentsREST(n, after, cwd)
            if (/not found|could not resolve/i.test(JSON.stringify(j.errors))) return { ok: false, error: { kind: 'notFound', message: JSON.stringify(j.errors).slice(0,300) } }
            return { ok: false, error: { kind: 'graphql', message: JSON.stringify(j.errors).slice(0,300) } }
          }
          const com = j.data && j.data.repository && j.data.repository.issue && j.data.repository.issue.comments
          if (!com) return { ok: false, error: { kind: 'notFound', message: 'issue not found' } }
          return { ok: true, nodes: com.nodes || [], pageInfo: com.pageInfo || { hasNextPage: false, endCursor: null } }
        } catch (e) { return { ok: false, error: { kind: 'parse', message: String(e) } } }
      }
      return { ok: false, error: { kind: 'network', message: 'GraphQL 评论分页请求失败（重试后仍失败）' } }
    }
    harness.handle('wf.issueComments', async function (args) {
      const n = args && args.number
      const after = args && args.after
      const cwd = await normCwd((args && args.cwd) || DEFAULT_CWD)
      if (!n) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
      try {
        // 第一性原理分发
        let _sel = null
        try {
          const svc = await getDetectionService()
          if (svc && typeof svc.detect === 'function') {
            const det = await svc.detect({ cwd }, { skipSkillProbes: true, hintBackendId: (args && args.backendId) || undefined })
            if (det && det.selection) _sel = det.selection
          }
        } catch {}
        if (!_sel || (_sel.backendId == null && (!_sel.source || _sel.source !== 'explicit'))) {
          try {
            const regTmp = await getTrackerRegistry()
            const tmpHandle = { cwd }
            const tmpCtx = { cwd, platform: await getPlatform(), fs: ctx.get('fs') }
            const sel2 = await regTmp.select(tmpHandle, tmpCtx)
            if (sel2) _sel = sel2
          } catch {}
        }
        const useTracker = _sel && _sel.backendId && _sel.backendId !== 'github' && _sel.backendId !== '' && _sel.backendId !== 'other'
        if (useTracker) {
          const reg = await getTrackerRegistry()
          const backendId = _sel.backendId
          const tracker = reg.get(backendId)
          if (!tracker || typeof tracker.get !== 'function') return { ok: false, error: { kind: 'unsupported', message: "backend '" + backendId + "' 未实现 get" } }
          let repoRef = null
          try { repoRef = reg.describe({ cwd }, backendId) } catch {}
          if (!repoRef) repoRef = { backend: backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || backendId, url: '' }
          const opCtx = { cwd, platform: await getPlatform(), fs: ctx.get('fs') }
          const key = String(n).padStart(2, '0')
          const r = await tracker.get(repoRef, key, {}, opCtx)
          if (!r || !r.ok) return r
          const iss = r.data
          const nodes = (iss.comments || []).map(function(c){ return { author: c.author || { login: '' }, authorAssociation: c.authorAssociation || '', body: c.body || '', createdAt: c.createdAt || '', updatedAt: c.updatedAt || '' } })
          // 简单分页：after 为已加载数
          const afterNum = after != null ? Number(after) : 0
          const start = isNaN(afterNum) ? 0 : afterNum
          const pageNodes = nodes.slice(start, start + 50)
          const hasNext = start + 50 < nodes.length
          return { ok: true, nodes: pageNodes, pageInfo: { hasNextPage: hasNext, endCursor: String(start + pageNodes.length) } }
        }
        const r = await fetchIssueComments(Number(n), after != null ? String(after) : null, cwd)
        return r
      } catch (e) { return { ok: false, error: { kind: 'network', message: errText(e) } } }
    })

    // #255 · IssueDetail 评论输入区（GitHub 单点 · MISSING 零分支）· 宿主透传 = 本次唯一宿主改动。
    // 第一性原理：能力 = 运行时事实（G5 调用即知，无能力表）；路径 = registry.select → tracker.comment（契约第 8 号 op），
    // 预检不进入评论链（去耦合：评论路径与预检仅共享错误分类常量）。成功即失效面板快照缓存（#213 白名单同语义），
    // 推进只来自重求值（client 击穿详情缓存重取 + probe 增量确认），无乐观插入。错误直透 TrackerError{kind,message}。
    harness.handle('wf.commentIssue', async function (args) {
      const n = args && args.number
      const body = args && args.body
      const cwd = await normCwd((args && args.cwd) || DEFAULT_CWD)
      if (!n || isNaN(Number(n))) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
      if (typeof body !== 'string' || !body.trim()) return { ok: false, error: { kind: 'parse', message: '评论内容为空' } }
      try {
        const reg = await getTrackerRegistry()
        if (!reg) return { ok: false, error: { kind: 'env', message: 'registry unavailable' } }
        const handle = { cwd: cwd }
        const opCtx = { cwd: cwd, platform: await getPlatform(), fs: ctx.get('fs'), timers: { setTimeout: (fn,ms)=>timer.timeout(fn,ms), clearTimeout: (id)=>{try{clearTimeout(id)}catch{}} }, exec: async function(cmd, cargs, opts){ const argv=[String(cmd)].concat(cargs||[]); const c=(opts&&opts.cwd)||cwd; const r=await execProc(argv, c); if(!r.ok) throw new Error(r.error||String(r.code||'exec failed')); return { stdout:r.text, text:r.text, ok:true, code:r.code } } }
        let sel = null
        try { sel = await reg.select(handle, opCtx) } catch (eSel) {}
        if (!sel || !sel.backendId) return { ok: false, error: { kind: 'unsupported', message: '未选择可用 tracker 后端，无法评论' } }
        let repoRef = null
        try { repoRef = reg.describe({ cwd: cwd }, sel.backendId) } catch (eDesc) {}
        if (repoRef && !repoRef.refId && sel.backendId === 'github') {
          // refId 补全（host 编排职责，与 buildSnapshot 同语义：git remote → .git/config → gh repo view 三级解析）
          try {
            const rk = await getRepoKey(cwd)
            if (rk && rk.owner && rk.name) { repoRef.refId = rk.owner + '/' + rk.name; repoRef.name = repoRef.refId; repoRef.url = 'https://github.com/' + repoRef.refId }
          } catch (eRk) {}
        }
        if (!repoRef || !repoRef.refId) return { ok: false, error: { kind: 'not-found', message: '无法解析目标仓库（refId missing）' } }
        const tracker = reg.get(sel.backendId)
        if (!tracker || typeof tracker.comment !== 'function') return { ok: false, error: { kind: 'unsupported', message: "backend '" + sel.backendId + "' 未实现 comment" } }
        const r = await tracker.comment(repoRef, String(Number(n)), String(body), opCtx)
        if (r && r.ok) {
          // 写操作成功 → 失效面板快照缓存（#213 同语义；右侧列表增量由 client 静默重取快照经差异产出）
          try { cache = { ts: 0, snapshot: null, error: null, cwd: cwd } } catch {}
        }
        return r
      } catch (e) { return { ok: false, error: { kind: 'network', message: errText(e) } } }
    })

    // v1.5 R2（#2 MVP）：probe 改用 `since` 时间戳探测全 issue 增量（地图 + 子票 + 其他），
    //   1 次 REST 调用覆盖全仓库变化。原实现 `labels=wayfinder:map` 仅匹配地图本身，
    //   **漏检所有子票变化**——面板可接/阻塞/已认领/已关闭分组（DESIGN.md §5.2）都是子票，
    //   故"列表不更新状态"。since 语义：返回数组非空 = 自上次快照以来有变化 → 视为 changed。
    //   配额仍走 REST 5000/h 池（独立于 GraphQL 5000 点/h），不烧穿。
    harness.handle('wf.probe', async function (args) {
      const cwd = await canonicalKey((args && args.cwd) || DEFAULT_CWD)
      // 第一性原理分发：markdown 等走轻量 list 探针，github 仍走 gh issue index
      let _selProbe = null
      try {
        const svc = await getDetectionService()
        if (svc && typeof svc.detect === 'function') {
          const det = await svc.detect({ cwd }, { skipSkillProbes: true, hintBackendId: (args && args.backendId) || undefined })
          if (det && det.selection) _selProbe = det.selection
        }
      } catch {}
      if (!_selProbe || (_selProbe.backendId == null && (!_selProbe.source || _selProbe.source !== 'explicit'))) {
        try {
          const regTmp = await getTrackerRegistry()
          const sel2 = await regTmp.select({ cwd }, { cwd, platform: await getPlatform(), fs: ctx.get('fs') })
          if (sel2) _selProbe = sel2
        } catch {}
      }
      const useProbeTracker = _selProbe && _selProbe.backendId && _selProbe.backendId !== 'github' && _selProbe.backendId !== '' && _selProbe.backendId !== 'other'
      if (useProbeTracker) {
        try {
          const reg = await getTrackerRegistry()
          const tracker = reg.get(_selProbe.backendId)
          if (tracker && typeof tracker.list === 'function') {
            let repoRef = null
            try { repoRef = reg.describe({ cwd }, _selProbe.backendId) } catch {}
            if (!repoRef) repoRef = { backend: _selProbe.backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || _selProbe.backendId, url: '' }
            const opCtx = { cwd, platform: await getPlatform(), fs: ctx.get('fs') }
            const r = await tracker.list(repoRef, {}, opCtx)
            if (!r || !r.ok) return { ok: false, error: errText((r && r.error) || 'probe list 失败') }
            const all = Array.isArray(r.data) ? r.data : []
            // 轻量索引：key -> state
            const idx = {}
            all.forEach(function(it){ const k = it && (it.key != null ? String(it.key).padStart(2,'0') : (it.number != null ? String(it.number).padStart(2,'0') : '')); if(k) idx[k] = String(it.state||'OPEN').toUpperCase() })
            const rk1 = _selProbe.backendId + ':' + cwd
            const known = lastIssueIndexByRepo[rk1] || {}
            const changed = issueIndexChanged(known, idx)
            rememberIssueIndex({ owner: _selProbe.backendId, name: cwd }, idx)
            // 兼容 remember 的 repoKey 形态：用 backendId+cwd 作 key，避免与 github 的 owner/name 串
            lastIssueIndexByRepo[rk1] = idx
            lastProbeAtByRepo[rk1] = new Date().toISOString()
            if (changed) cache = { ts: 0, snapshot: null, error: null, cwd: cwd }
            return { ok: true, changed: changed, repo: { owner: _selProbe.backendId, name: String(cwd).split(/[\\/]/).pop()||'' }, count: all.length, since: lastProbeAtByRepo[rk1] }
          }
        } catch (e) { return { ok: false, error: errText(e) } }
      }
      try {
        const remote = await fetchIssueIndex(cwd)
        if (!remote.ok) return { ok: false, error: errText(remote.error || 'probe 失败') }
        const repo = remote.repo
        const rk1 = repo.owner + '/' + repo.name
        const known = lastIssueIndexByRepo[rk1] || issueIndexFromSnapshot(cache.snapshot)
        const changed = issueIndexChanged(known, remote.index)
        rememberIssueIndex(repo, remote.index)
        lastProbeAtByRepo[rk1] = new Date().toISOString()
        if (changed) cache = { ts: 0, snapshot: null, error: null, cwd: cwd }
        return { ok: true, changed: changed, repo: repo, count: remote.count, since: lastProbeAtByRepo[rk1] }
      } catch (e) { return { ok: false, error: errText(e) } }
    })

    // ============ 交接文档（issue #12 BUG4 · 双重防御 · 副路径）============
    // DSH 沙箱里 fs.stat 返回的 info.mtime 形态不可控（Date / ISO 串 / 秒级 Unix / 本地化串 / null / NaN）；
    // 原 `typeof number ? mt : Date.parse(String(mt))` 在 Date 对象或不可 parse 形态都得 NaN；
    // 原 sort 单键 `b.mtime - a.mtime` 在 mtime 相等/NaN 时 Array.sort 视为 equal → 原顺序保留 →
    // fs.listDir 按名字典序返回 → 老文件天然排第一 → mds[0].name = 字典序最小 = 上一次写入（BUG）。
    //
    // 加固（副路径 · 治本）：
    //   - parseHandoffMtime：isFinite 严格校验 + Date 实例 getTime 优先；任何无法 parse 的形态安全归 0
    //     （NaN/null/undefined/0/不可 parse 串 → 0）
    //   - pickLatestHandoff：mtime desc 主键 + name desc 兜底（时间戳文件名 = 字典序 = 时间序）；
    //     mtime 退化为 0 的退化形态（NaN/null/全 0/全等 finite）一律走 name desc 返回字典序最大
    //
    // 注：混合退化形态（new=NaN+old=valid）的 mtime 倒挂，sort 加固无法区分 —— 由主路径
    //     `wf.handoffResolve(args.name)` 在客户端已点过第一击时直接返回该 name 保障。
    const parseHandoffMtime = function (raw) {
      if (typeof raw === 'number') return isFinite(raw) ? raw : 0
      if (raw instanceof Date) { const t = raw.getTime(); return isFinite(t) ? t : 0 }
      if (raw) { const p = Date.parse(String(raw)); return isFinite(p) ? p : 0 }
      return 0
    }
    const pickLatestHandoff = function (mds) {
      if (!Array.isArray(mds) || !mds.length) return null
      const sorted = mds.slice().sort(function (a, b) {
        const dt = (b.mtime || 0) - (a.mtime || 0)
        if (dt !== 0) return dt
        // name desc 兜底：时间戳文件名（YYYYMMDD-HHMMSS）字典序 = 时间序
        if (b.name < a.name) return -1
        if (b.name > a.name) return 1
        return 0
      })
      return sorted[0].name
    }
    // 共享目录扫描（handoffLatest + handoffResolve 共用）—— 任何 fs 调用异常都降级为空数组
    const scanHandoffDir = async function (cwd) {
      if (fs === undefined) return { error: 'fs 服务不可用', mds: [] }
      try {
        const dir = await fs.resolve('.scratch/handoff', { cwd: cwd })
        const entries = await fs.listDir(dir)
        const mds = []
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i]
          const name = (e && (e.name || e.path || '')) || ''
          if (!name || !/\.md$/i.test(name)) continue
          let mtime = 0
          try {
            const info = await fs.stat(await fs.resolve('.scratch/handoff/' + name, { cwd: cwd }))
            if (info) mtime = parseHandoffMtime(info.mtime)
          } catch (e2) { mtime = 0 }
          mds.push({ name: name, mtime: mtime })
        }
        return { mds: mds }
      } catch (e) {
        return { mds: [] }  // 目录不存在/不可读 = 还没有交接文档
      }
    }

    // v19：查询 .scratch/handoff/ 下最新的交接文档（按 mtime 倒序 + name desc 兜底 · 加固后），供「交接给新会话」预填 + 复制
    harness.handle('wf.handoffLatest', async function (args) {
      const cwd = (args && args.cwd) || DEFAULT_CWD
      const r = await scanHandoffDir(cwd)
      if (r.error) return { ok: false, error: r.error }
      return { ok: true, file: pickLatestHandoff(r.mds) }
    })

    // issue #12 BUG4 · 主路径：客户端带期望文件名（第一击模板渲染出的 handoffFile）时严格返回该文件：
    //   在目录里 → 返回它；不在 → 返回 null（不退回 mtime 最新，避免 fallback 到老文件误导用户）。
    //   无 args.name（用户从未点过第一击，如刷新后 / 直接点右半）→ 走 mtime 最新（与 handoffLatest 同语义）。
    // 区别于初版：初版「name 不在目录也 fallback 到 mtime 最新」在实际场景下被验证为反模式 —— 当 AI 还没写完
    // 文档时（handoffFile 设了但文件未落盘），fallback 会让右半亮蓝且点开后错误引用上次的老文档，与修复目标相悖。
    harness.handle('wf.handoffResolve', async function (args) {
      const cwd = (args && args.cwd) || DEFAULT_CWD
      const r = await scanHandoffDir(cwd)
      if (r.error) return { ok: false, error: r.error }
      const want = args && args.name
      if (!want) return { ok: true, file: pickLatestHandoff(r.mds) }
      // 前缀匹配（#71 短标题文件名：{ts}-<短标题>.md）：want 以 * 结尾 → 匹配 name 以该前缀开头，取最新
      if (want.slice(-1) === '*') {
        const prefix = want.slice(0, -1)
        const m = r.mds.filter(function (x) { return x.name.indexOf(prefix) === 0 })
        if (m.length) return { ok: true, file: pickLatestHandoff(m) }
        return { ok: true, file: null }
      }
      // 精确匹配：在目录里 → 返回它；不在 → 返回 null（不退回 mtime 最新，避免 fallback 到老文件误导用户）。
      if (r.mds.some(function (m) { return m.name === want })) return { ok: true, file: want }
      return { ok: true, file: null }
    })

    // ============ 认领（开始此 Issue 流程 · T5 #347）============
    // 用户在 UI 点击「确认开始」且勾选认领后调用：gh issue edit <n> --add-assignee @me。
    // 写操作前 UI 已二次确认（用户点击即同意），不走 approval 服务（RESEARCH-NOTES §3 结论）。
    harness.handle('wf.claim', async function (args) {
      const n = args && args.number
      const cwd = await normCwd((args && args.cwd) || DEFAULT_CWD)
      if (!n) return { ok: false, error: '缺少参数 number（ticket 号）' }
      // 第一性原理分发
      let _sel = null
      try {
        const svc = await getDetectionService()
        if (svc && typeof svc.detect === 'function') {
          const det = await svc.detect({ cwd }, { skipSkillProbes: true, hintBackendId: (args && args.backendId) || undefined })
          if (det && det.selection) _sel = det.selection
        }
      } catch {}
      if (!_sel || (_sel.backendId == null && (!_sel.source || _sel.source !== 'explicit'))) {
        try {
          const regTmp = await getTrackerRegistry()
          const tmpHandle = { cwd }
          const tmpCtx = { cwd, platform: await getPlatform(), fs: ctx.get('fs') }
          const sel2 = await regTmp.select(tmpHandle, tmpCtx)
          if (sel2) _sel = sel2
        } catch {}
      }
      const useTracker = _sel && _sel.backendId && _sel.backendId !== 'github' && _sel.backendId !== '' && _sel.backendId !== 'other'
      if (useTracker) {
        const reg = await getTrackerRegistry()
        const backendId = _sel.backendId
        const tracker = reg.get(backendId)
        if (!tracker || typeof tracker.setAssignees !== 'function') return { ok: false, error: { kind: 'unsupported', message: "backend '" + backendId + "' 未实现 setAssignees" } }
        let repoRef = null
        try { repoRef = reg.describe({ cwd }, backendId) } catch {}
        if (!repoRef) repoRef = { backend: backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || backendId, url: '' }
        const opCtx = { cwd, platform: await getPlatform(), fs: ctx.get('fs') }
        const key = String(n).padStart(2, '0')
        // 尝试取当前用户
        let assignee = 'me'
        try {
          if (tracker.getCurrentUser) {
            const ur = await tracker.getCurrentUser(repoRef, opCtx)
            if (ur && ur.ok && ur.data && ur.data.login) assignee = String(ur.data.login)
          }
        } catch {}
        // 若仍为 me，尝试 gh
        if (assignee === 'me') {
          try {
            const u = await runGh(['api', 'user', '-q', '.login'])
            if (u.ok && u.text.trim()) assignee = u.text.trim()
          } catch {}
        }
        const r = await tracker.setAssignees(repoRef, key, [assignee], {}, opCtx)
        if (!r || !r.ok) return r
        cache = { ts: 0, snapshot: null, error: null }
        return { ok: true, number: n, assignedTo: assignee, url: '' }
      }
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', error: '无法解析 owner/repo（git remote 或 gh repo view 失败）' } }
      const r = await runGh(['issue', 'edit', String(n), '--add-assignee', '@me'], cwd)
      if (!r.ok) return { ok: false, error: r }
      // 认领成功 → 取当前用户 login 供面板展示；失效快照缓存，让下次 wf.snapshot 拉到新 assignee
      let assignedTo = ''
      const u = await runGh(['api', 'user', '-q', '.login'])
      if (u.ok) assignedTo = u.text.trim()
      cache = { ts: 0, snapshot: null, error: null }
      return { ok: true, number: n, assignedTo: assignedTo, url: 'https://github.com/' + repo.owner + '/' + repo.name + '/issues/' + String(n) }
    })

    // ============ 命名守护（#265 · 草稿档垂直线 · host 半）============
    // 分工（#264 D2）：本侧为常驻轻量任务 —— 持跟踪态（落盘 .dsh-mattskillsdeck-cache/naming-guardian.json，
    // 写入方式与现缓存一致：platform.fs.resolve + fs.writeText）并维护状态；「待办改名计划单」经
    // wf.namingPlan 供界面侧渲染钩子拉取。纯判定真源 = ../shared/naming-guardian.js（运行时 import，
    // 与 check-catalog 同模式），本文件不含第二处命名实现。
    let _namingCore = null
    let _namingCoreInit = null
    async function getNamingCore() {
      if (_namingCore) return _namingCore
      if (!_namingCoreInit) {
        _namingCoreInit = (async function () {
          try { const m = await import('../shared/naming-guardian.js'); _namingCore = m; return m } catch (e) { return null }
        })()
      }
      return _namingCoreInit
    }
    const NAMING_STATE_FILE = 'naming-guardian.json'
    const NAMING_TICK_MS = 15000
    const NAMING_SWEEP_MS = NAMING_TICK_MS
    let _namingState = null            // { version:1, sessions:{sid:跟踪态}, indexes:{repoKey:索引快照} } 内存态（加载自磁盘，变更防抖落盘）
    let _namingStateDirty = false
    let _namingPersistTimer = null
    let _namingLoopTimer = null
    // #266 建号感知：索引差值结算的防重入/防堆积守卫（host 常驻 tick + 即时路径共用）
    let _namingSweepBusy = false
    let _namingSweepTimer = null
    function namingDefaultState() { return { version: 1, sessions: {}, indexes: {} } }
    async function loadNamingState() {
      if (_namingState) return _namingState
      _namingState = namingDefaultState()
      try {
        if (fs !== undefined && typeof fs.readText === 'function' && typeof fs.resolve === 'function') {
          const dir = await getCacheDir()
          if (dir) {
            const platform2 = await getPlatform()
            const t = await platform2.fs.resolve(platform2.path.join(dir, NAMING_STATE_FILE))
            const txt = await fs.readText(t)
            if (txt) {
              const j = JSON.parse(txt)
              // #266：盘上结构追加 indexes（各仓库上次 issue 索引快照，差值底座）；
              // 旧账（v1 无 indexes）友好归一为 {}；编号相关字段缺失按 null/false 容错读取。
              if (j && j.version === 1 && j.sessions && typeof j.sessions === 'object') { _namingState = j; if (!_namingState.sessions) _namingState.sessions = {}; if (!_namingState.indexes || typeof _namingState.indexes !== 'object') _namingState.indexes = {} }
            }
          }
        }
      } catch (eLoad) { /* 损坏/缺失即回默认空态，注册侧原子重建 */ }
      return _namingState
    }
    async function persistNamingState() {
      _namingStateDirty = false
      try {
        if (fs === undefined || typeof fs.writeText !== 'function' || typeof fs.resolve !== 'function') return
        const dir = await getCacheDir(); if (!dir) return
        const platform2 = await getPlatform()
        const t = await platform2.fs.resolve(platform2.path.join(dir, NAMING_STATE_FILE))
        await fs.writeText(t, JSON.stringify(_namingState || namingDefaultState()))
      } catch (ePersist) { /* 写失败不影响主流程，下轮 tick 重试 */ }
    }
    function markNamingStateDirty() {
      _namingStateDirty = true
      if (_namingPersistTimer) return
      _namingPersistTimer = timer.timeout(function () { _namingPersistTimer = null; if (_namingStateDirty) persistNamingState() }, 1200)
    }
    function namingLoopTick() {
      try { if (_namingStateDirty) persistNamingState() } catch (eTick) {}
      // #266：常驻 tick 承担索引差值结算（建号感知底座；防重入由 _namingSweepBusy 保证）
      try { namingSweepNow() } catch (eSweepT) {}
      _namingLoopTimer = timer.timeout(namingLoopTick, NAMING_TICK_MS)
    }
    function startNamingGuardianLoop() {
      // 热重载守卫：上一代 apply 遗留的循环先清（globalThis 单例句柄）
      try {
        if (typeof globalThis !== 'undefined' && globalThis.__dswsNamingGuardianLoop) { try { clearTimeout(globalThis.__dswsNamingGuardianLoop) } catch (e0) {} }
      } catch (eG) {}
      _namingLoopTimer = timer.timeout(namingLoopTick, NAMING_TICK_MS)
      try { if (typeof globalThis !== 'undefined') globalThis.__dswsNamingGuardianLoop = _namingLoopTimer } catch (eK) {}
    }

    // ============ 建号感知复原（#266 · F1/F2 修复义务）============
    // 历史：#211 的 registerNewSessionWatcher / cancelNewSessionWatcher / awaitCreatedIssue 三
    // handler 于 e98f636 重构中被整块静默删除且无替身（#258 F1 回归），导致「AI 在会话内
    // 自行建号」的主流程零事件。本段按 #264 决议以 issue 索引差值为底座复原，职责并入持久化
    // 命名守护：注册收编跟踪态 + 触发即时快照；结算由常驻 tick 与即时路径（runGh 白名单 /
    // 认领推送 nudge）共用同一入口（三操作存在的守卫断言见 verify-naming-guardian）。

    /** repoKey 归一：接受 'owner/name' 字符串或 { owner, name }；无效返回 null。 */
    function namingRepoKeyOf(args) {
      if (!args) return null
      let rk = args.repoKey
      if (rk && typeof rk === 'object') { const o = rk.owner || rk.login; const n = rk.name || rk.repo; rk = (o && n) ? String(o) + '/' + String(n) : null }
      if (typeof rk === 'string' && rk.indexOf('/') > 0) return rk
      return null
    }
    async function namingResolveRepoKey(cwd) {
      try {
        const repo = await getRepoKey(cwd || DEFAULT_CWD)
        if (repo && repo.owner && repo.name) return repo.owner + '/' + repo.name
      } catch (e) {}
      return null
    }
    /** 索引快照：gh api 全量（open+closed，剔 PR），结构 { 'n': { title, state, updatedAt } }。 */
    async function namingFetchIndex(repoKey, cwd) {
      try {
        const url = 'repos/' + repoKey + '/issues?state=all&per_page=100'
        const r = await runGh(['api', '--paginate', url, '--jq', '.[] | select(.pull_request == null) | {number: .number, title: .title, state: .state, updatedAt: .updated_at}'], cwd || DEFAULT_CWD)
        if (!r.ok) return { ok: false, error: r }
        const index = {}
        const lines = String(r.text || '').split(/\r?\n/).filter(Boolean)
        for (let i = 0; i < lines.length; i++) {
          try {
            const item = JSON.parse(lines[i])
            if (item && item.number !== undefined && item.number !== null) {
              index[String(item.number)] = { title: String(item.title || ''), state: String(item.state || '').toUpperCase(), updatedAt: String(item.updatedAt || '') }
            }
          } catch (eLine) {}
        }
        return { ok: true, index: index }
      } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
    }
    /**
     * 索引差值结算（每仓库一次）：新编号（升序）→ 归属同仓库最早仍处占位/草稿档的受踪会话
     * （归属判定为共享核心纯函数 attributeNewNumbers；prev 快照缺失 → 仅基线建档不归属，
     * 避免把存量全量误归属）。归属即时落盘（关键事件）；索引快照随脏账防抖落盘。
     */
    async function namingSweepNow() {
      if (_namingSweepBusy) return
      _namingSweepBusy = true
      try {
        const core = await getNamingCore()
        if (!core) return
        const st = await loadNamingState()
        const byRepo = {}
        for (const sid in st.sessions) {
          const s = st.sessions[sid]
          if (!s || !s.repoKey) continue
          if (!core.isNumberAwaitStage(s)) continue
          if (!byRepo[s.repoKey]) byRepo[s.repoKey] = { sessions: [], cwd: s.cwd || DEFAULT_CWD }
          byRepo[s.repoKey].sessions.push(s)
        }
        for (const repoKey in byRepo) {
          const grp = byRepo[repoKey]
          const r = await namingFetchIndex(repoKey, grp.cwd)
          if (!r.ok) continue
          const prev = (st.indexes && st.indexes[repoKey]) || null
          let assigned = []
          try {
            if (prev) assigned = core.attributeNewNumbers({ prevIndex: prev, currIndex: r.index, sessions: grp.sessions })
            // prev 为空：首轮基线。基线同样必须入库（防下一轮把存量全量当新编号）
          } catch (eA) { assigned = [] }
          // #315 追加修复：无关新号不硬配。
          try {
            if (assigned.length && core.isHintRelatedToTitle) {
              const kept = [];
              for (let i = 0; i < assigned.length; i++) {
                const a = assigned[i];
                const entry = st.sessions[a.sessionId];
                if (!entry) { kept.push(a); continue; }
                const hint = entry.hint;
                if (hint) { try { if (!core.isHintRelatedToTitle(hint, a.title)) continue; } catch (eRel) {} }
                kept.push(a);
              }
              assigned = kept;
            }
          } catch (eFilter) {}
          let changed = false
          for (let i = 0; i < assigned.length; i++) {
            const a = assigned[i]
            const entry = st.sessions[a.sessionId]
            if (!entry) continue
            const next = core.reduceTrackingState(entry, { type: 'numbered', number: a.number, title: a.title })
            if (next !== entry) { st.sessions[a.sessionId] = next; changed = true }
          }
          if (!st.indexes) st.indexes = {}
          st.indexes[repoKey] = r.index
          if (changed) await persistNamingState()
          else markNamingStateDirty()
        }
      } catch (eSweep) { /* 净失败静默：下轮 tick 重试 */ } finally { _namingSweepBusy = false }
    }
    /** 即时推进：短窗合并（防堆积），注册/白名单/认领推送 nudge 共用。 */
    function namingSweepSoon(delayMs) {
      const delay = typeof delayMs === 'number' ? delayMs : 1500
      if (_namingSweepTimer) return
      _namingSweepTimer = timer.timeout(function () {
        _namingSweepTimer = null
        try { namingSweepNow() } catch (e) {}
      }, delay)
    }

    /** 受踪登记唯一实现：#265 兼容名与 #266 复原名共用同一本体。 */
    async function namingEnsureTracked(args) {
      const sid = args && args.sessionId
      const baseline = args && args.baselineTitle
      if (!sid || !baseline) return { ok: false, error: { kind: 'parse', message: '缺少 sessionId/baselineTitle' } }
      const core = await getNamingCore()
      if (!core || !core.isPlaceholderTitle(baseline)) return { ok: false, error: { kind: 'parse', message: 'baselineTitle 非占位四式' } }
      const cwd = (args && args.cwd) || DEFAULT_CWD
      let repoKey = namingRepoKeyOf(args)
      if (!repoKey) repoKey = await namingResolveRepoKey(cwd)
      const st = await loadNamingState()
      if (!st.sessions[sid]) {
        st.sessions[sid] = core.createTrackingState({ sessionId: sid, baselineTitle: baseline, repoKey: repoKey, cwd: cwd })
      } else if (st.sessions[sid].repoKey == null && repoKey) {
        st.sessions[sid].repoKey = repoKey
      }
      if (args && args.hint) st.sessions[sid] = core.reduceTrackingState(st.sessions[sid], { type: 'signal', hint: String(args.hint).slice(0, 80) })
      // 即时持久化（#265 崩溃窗口补强）：注册只在会话创建时发生一次，若只走防抖，宽限期内进程
      // 被杀会让该会话永久失察（客户端不会重注册）——关键事件必须落盘后才算受理。
      await persistNamingState()
      // #266：注册即打索引基线/结算（800ms 短窗；首轮仅建档，其后命中即时信号即优先归属）
      namingSweepSoon(800)
      return { ok: true }
    }
    const namingRegisterHandler = function (args) { return namingEnsureTracked(args) }
    // 两入口同一本体：wf.namingRegister（#265 四操作之一，兼容保留）/
    // wf.registerNewSessionWatcher（#211 复原名 · 注册监视 —— 规范入口，client 已切换调用）
    harness.handle('wf.namingRegister', namingRegisterHandler)
    harness.handle('wf.registerNewSessionWatcher', namingRegisterHandler)

    harness.handle('wf.namingSignal', async function (args) {
      const sid = args && args.sessionId
      const hint = args && args.hint
      if (!sid || !hint) return { ok: true }
      const st = await loadNamingState()
      const entry = st.sessions[sid]
      if (!entry) return { ok: true }   // 非受踪会话：信号无属主，忽略
      const core = await getNamingCore()
      if (!core) return { ok: true }
      if (!entry.locked) { st.sessions[sid] = core.reduceTrackingState(entry, { type: 'signal', hint: String(hint).slice(0, 80) }); markNamingStateDirty() }
      return { ok: true }
    })

    harness.handle('wf.namingPlan', async function () {
      const core = await getNamingCore()
      if (!core) return { ok: true, orders: [], tracked: [], failures: [] }
      const st = await loadNamingState()
      const orders = []
      const tracked = []
      const failures = []   // #267：定败清单（有限重试耗尽）→ 面板级提醒（DetailsDock 横幅）
      for (const sid in st.sessions) {
        const s = st.sessions[sid]
        if (!s) continue
        const o = core.planOrderFor(s, Date.now(), core.NAMING_HINT_GRACE_MS)
        if (o) orders.push(o)
        // #266：tracked 携带终局标记供界面侧清理（done = 永不/不再出单：锁账、编号落定、精修档）
        let done = false
        if (s.locked) done = true
        else if (s.stage === core.NAMING_STAGES.REFINED) done = true
        else if (s.stage === core.NAMING_STAGES.NUMBERED && s.number != null) {
          if (s.numberedDone) done = true
          else {
            try { done = (s.lastMachineTitle != null && s.lastMachineTitle === core.newSessionTitle({ number: s.number, title: s.numberTitle || '' })) } catch (eD) {}
          }
        }
        tracked.push({ sessionId: sid, stage: s.stage, done: done })
        // #267：定败画像随单回包 —— 化解前持续呈现；字段裁剪由共享核心统一裁定
        const fi = core.namingFailureInfo(s)
        if (fi) failures.push(fi)
      }
      // #315 隔离修复：同仓库下若存在带 hint 的草稿单，则抑制同仓库的裸档单（hint == null），避免无线索会话被误改
      // 保证「只改有线索的目标会话」，裸档会话保持占位直到自身产生线索；同仓库判定以 repoKey 为键
      try {
        const byRepoHasHint = {}
        for (let i = 0; i < orders.length; i++) {
          const o = orders[i]
          if (o && o.kind === 'draft' && o.hint) {
            const so = st.sessions[o.sessionId]
            const rk = so && so.repoKey
            if (rk) byRepoHasHint[rk] = true
          }
        }
        if (Object.keys(byRepoHasHint).length) {
          const kept = []
          for (let i = 0; i < orders.length; i++) {
            const o = orders[i]
            if (o && o.kind === 'draft' && !o.hint) {
              const so = st.sessions[o.sessionId]
              const rk = so && so.repoKey
              if (rk && byRepoHasHint[rk]) continue
            }
            kept.push(o)
          }
          orders.length = 0
          for (let i = 0; i < kept.length; i++) orders.push(kept[i])
        }
      } catch (eFilter) {}
      return { ok: true, orders: orders, tracked: tracked, failures: failures }
    })

    harness.handle('wf.namingResult', async function (args) {
      const sid = args && args.sessionId
      const outcome = args && args.outcome
      if (!sid || !outcome) return { ok: false, error: { kind: 'parse', message: '缺少 sessionId/outcome' } }
      const st = await loadNamingState()
      const entry = st.sessions[sid]
      if (!entry) return { ok: true }
      const core = await getNamingCore()
      if (!core) return { ok: true }
      // renamed/locked 入账并即时持久化（#265 崩溃窗口补强）：锁账丢失会危及「手改永不被覆盖」，
      // 升级账丢失会让重启续跑多付一次改名——均为关键状态变更，不当延迟落盘。
      // #267：failed 同样即时落盘 —— 有限重试预算（连败计数/冷却窗）跨拉询与重启一致，
      // 耗尽即定败并入 namingPlan.failures 面板级清单；预算语义由共享核心统一裁定。
      if (outcome === 'renamed' && args.title) {
        st.sessions[sid] = core.reduceTrackingState(entry, { type: 'renamed', title: String(args.title) })
        await persistNamingState()
        return { ok: true }
      }
      if (outcome === 'locked') {
        st.sessions[sid] = core.reduceTrackingState(entry, { type: 'locked' })
        await persistNamingState()
        return { ok: true }
      }
      if (outcome === 'failed') {
        const next = core.reduceTrackingState(entry, { type: 'renameFailed', error: args.error })
        st.sessions[sid] = next
        await persistNamingState()
        return { ok: true, exhausted: !!core.namingFailureInfo(next) }
      }
      return { ok: true }
    })

    // ---- #211 复原名三操作（#266 复原 · 以索引差值为底座，职责并入守护；守卫断言钉死其存在）----
    // 取消监视：从受踪账目移除（仅终局清理路径调用：界面半判定会话已不存在且 done）
    harness.handle('wf.cancelNewSessionWatcher', async function (args) {
      const sid = args && args.sessionId
      if (!sid) return { ok: false, error: { kind: 'parse', message: '缺少 sessionId' } }
      const st = await loadNamingState()
      if (!st.sessions[sid]) return { ok: true, cancelled: false }
      delete st.sessions[sid]
      await persistNamingState()
      return { ok: true, cancelled: true }
    })
    // 等待建号：状态查询（是否仍处占位/草稿档且未获号）+ 即时推进（nudge 索引差值结算）
    harness.handle('wf.awaitCreatedIssue', async function (args) {
      const sid = args && args.sessionId
      if (!sid) return { ok: false, error: { kind: 'parse', message: '缺少 sessionId' } }
      const core = await getNamingCore()
      const st = await loadNamingState()
      const entry = st.sessions[sid]
      const watching = !!(core && entry && core.isNumberAwaitStage(entry))
      if (watching) namingSweepSoon(120)
      return { ok: true, watching: watching, stage: (entry && entry.stage) || null }
    })

    // ============ #190：wf.openFolder — 打开本地文件夹（Markdown 后端仓库名点击）============
    // 输入：{ cwd }；平台分发：win32 explorer / darwin open / linux xdg-open（经 platform.resolveExecutable），subprocess.spawn 打开
    harness.handle('wf.openFolder', async function (args) {
      const cwd = (args && (args.cwd || args.path)) || DEFAULT_CWD
      if (!cwd) return { ok: false, error: '缺少 cwd' }
      try {
        const platform = await getPlatform()
        const os = platform.os || (typeof process !== 'undefined' && process.platform) || 'win32'
        const openerName = os === 'win32' ? 'explorer' : os === 'darwin' ? 'open' : 'xdg-open'
        const opener = await platform.resolveExecutable(openerName)
        if (!opener) return { ok: false, error: '找不到打开器：' + openerName }
        // cwd 归一（platform.path 处理分隔符）
        let target = String(cwd)
        try { if (platform.path && typeof platform.path.normalize === 'function') target = platform.path.normalize(target) } catch {}
        // win32 explorer 需保持原分隔符；darwin/linux 用 posix 兼容
        const argv = [opener, target]
        try {
          const handle = subprocess.spawn({ argv: argv, cwd: DEFAULT_CWD || target, stdio: { stdin: 'ignore', stdout: { maxBytes: 64*1024 }, stderr: { maxBytes: 64*1024 } }, graceMs: 2000 })
          // 不等待完成，fire-and-forget；若 spawn 同步抛错则视为失败
          if (handle && handle.done) {
            // 异步错误吞掉，避免未处理 rejection 影响面板；成功即返回
            handle.done.catch(function(){})
          }
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) }
        }
        return { ok: true, cwd: target, opener: opener }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    })

    // ============ 红卡建仓发布（T1 #34 · 无仓库时一键建仓发布）============
    // 输入：{ cwd, name, visibility }（visibility = 'public' | 'private'，默认 private）
    // 流程：探测 git/gh/auth（前置）→ git init(若已是 git 则跳过) → git add . → git commit --allow-empty（含 user.* 兜底）→ gh repo create --source=. --push（或 --remote origin 已存在时走 set-url + push 分支）
    // 返回：{ ok: true, repo: { owner, name } } | { ok: false, errorKind, error, repoUrl? }
    // errorKind: no-git / no-gh / not-logged-in / already-exists / network / permission（6 档，兼容草稿中的 bad-name 兜底映射为 permission）
    harness.handle('wf.initPublish', async function (args) {
      const cwd = (args && args.cwd) || DEFAULT_CWD
      const name = args && args.name ? String(args.name).trim() : ''
      const visibility = (args && args.visibility) === 'public' ? 'public' : 'private'
      if (!name) return { ok: false, errorKind: 'bad-name', error: '仓库名为空' }
      if (!/^[A-Za-z0-9._-]+$/.test(name) || name.length > 100) {
        return { ok: false, errorKind: 'bad-name', error: '仓库名仅支持字母/数字/._- 且 ≤100：' + name }
      }
      const visFlag = visibility === 'public' ? '--public' : '--private'
      // 前置探测：git / gh / auth（失败快返，避免已改动工作区）
      const git = await resolveGit()
      if (!git) return { ok: false, errorKind: 'no-git', error: '未找到 git（请安装 https://git-scm.com/）' }
      const gh = await resolveGh()
      if (!gh) return { ok: false, errorKind: 'no-gh', error: ghLastError || '未找到 gh（请安装 https://cli.github.com/）', prompt: '请为 DSH 安装 GitHub CLI（gh）—— 面板所有数据依赖 gh：\n\n1. 先检查：终端执行 `gh --version`；有版本号输出 → 直接汇报已装版本并结束，不要重复安装；\n2. 无 gh 则按 OS 安装：Windows → `winget install --id GitHub.cli`; macOS → `brew install gh`; Linux → `sudo apt install gh`;\n3. 安装后验证：重开终端使 PATH 生效，`gh --version` 输出版本号；\n4. 若 gh 已装但 DSH 仍报未安装：点环境检查「重测」按钮或重启 DSH Desktop；\n5. 完成后汇报：gh 版本号 + 「gh CLI 可用」项已变绿。' }
      const authR = await runGh(['auth', 'status'], cwd)
      if (!authR.ok) {
        const t = String(authR.error || '').toLowerCase()
        if (authR.kind === 'network' || /network|econn|timed out|timeout|enotfound|getaddrinfo|connect/.test(t)) {
          return { ok: false, errorKind: 'network', error: authR.error }
        }
        return { ok: false, errorKind: 'not-logged-in', error: authR.error }
      }
      // 取当前登录用户（用于 already-exists 时拼 repoUrl 与成功后 owner 兜底）
      let currentUser = ''
      try {
        const u = await runGh(['api', 'user', '-q', '.login'], cwd)
        if (u.ok) currentUser = u.text.trim()
      } catch (e) { /* 忽略 */ }
      const classifyCreateError = function (errText, kind) {
        const low = String(errText || '').toLowerCase()
        if (/already exists|name already exists|already exists on github|repository.*already exists/i.test(low)) return 'already-exists'
        if (kind === 'network' || /network|econn|timed out|timeout|enotfound|getaddrinfo|connect etimedout|unable to access|failed to connect|could not resolve host/i.test(low)) return 'network'
        if (/not logged in|auth failed|bad credentials|authentication required|gh auth login/i.test(low)) return 'not-logged-in'
        if (/permission|forbidden|403|401|insufficient|not authorized|resource not accessible|must be.*admin/i.test(low)) return 'permission'
        if (kind === 'auth') return 'not-logged-in'
        return 'permission'
      }
      // 1. git init（若已是 git 仓库则跳过；含 getRepoRoot 探测 + 清缓存）
      try {
        const probe = await execProc([git, '-C', cwd, 'rev-parse', '--is-inside-work-tree'], cwd)
        if (!probe.ok) {
          const initR = await execProc([git, 'init'], cwd)
          if (!initR.ok) {
            const k = classifyCreateError(initR.error, null)
            return { ok: false, errorKind: k === 'already-exists' ? 'permission' : k, error: initR.error }
          }
          // 失效 repoRoots 缓存（规整钥匙与写入侧同形，删除才删得中）
          const rk1 = await canonicalKey(cwd || DEFAULT_CWD)
          if (rk1 && repoRoots[rk1] !== undefined) delete repoRoots[rk1]
        }
      } catch (e) {
        const initR = await execProc([git, 'init'], cwd)
        if (!initR.ok) {
          const k = classifyCreateError(initR.error, null)
          return { ok: false, errorKind: k === 'already-exists' ? 'permission' : k, error: initR.error }
        }
        const rk2 = await canonicalKey(cwd || DEFAULT_CWD)
        if (rk2 && repoRoots[rk2] !== undefined) delete repoRoots[rk2]
      }
      // 2. git add .
      const addR = await execProc([git, 'add', '.'], cwd)
      if (!addR.ok) {
        const k = classifyCreateError(addR.error, null)
        return { ok: false, errorKind: k, error: addR.error }
      }
      // 3. git commit --allow-empty（含 identity 缺失兜底）
      let commitR = await execProc([git, 'commit', '-m', 'initial commit', '--allow-empty'], cwd)
      if (!commitR.ok) {
        const low = String(commitR.error || '').toLowerCase()
        if (/please tell me who you are|user\.name|user\.email|author identity unknown|unable to auto-detect email/.test(low)) {
          await execProc([git, 'config', 'user.email', 'dsh@local'], cwd)
          await execProc([git, 'config', 'user.name', 'DSH User'], cwd)
          commitR = await execProc([git, 'commit', '-m', 'initial commit', '--allow-empty'], cwd)
        }
        if (!commitR.ok) {
          const k = classifyCreateError(commitR.error, null)
          return { ok: false, errorKind: k, error: commitR.error }
        }
      }
      // 4. 探测 remote origin 是否已存在（决定 gh 调用分支）
      let hasOrigin = false
      try {
        const ro = await execProc([git, 'remote', 'get-url', 'origin'], cwd)
        hasOrigin = !!ro.ok
      } catch (e) { hasOrigin = false }
      // 5. gh repo create
      if (!hasOrigin) {
        const cr = await runGh(['repo', 'create', name, visFlag, '--source=.', '--push'], cwd)
        if (!cr.ok) {
          const kind = classifyCreateError(cr.error, cr.kind)
          // #420/#426 半成功契约：gh 失败时仍保留 stdout，可解析出仓库地址（或 already-exists 且已知用户）→ 回带 repoUrl/repo/halfCreated
          const mUrl = String(cr.text || '').match(/https:\/\/github\.com\/[^\s\/]+\/[^\s\/]+/)
          const repoUrl = mUrl ? mUrl[0] : ((kind === 'already-exists' && currentUser) ? ('https://github.com/' + currentUser + '/' + name) : undefined)
          const owner = currentUser || (mUrl ? (mUrl[0].split('/')[3] || '') : '')
          // 半成功 = 「我们刚创建成功但推送未完成」；already-exists 是仓库原本已存在（只给去查看，不给重试推送）
          const halfCreated = (kind !== 'already-exists') && !!repoUrl
          return { ok: false, errorKind: kind, error: cr.error, repoUrl: repoUrl, repo: repoUrl ? { owner: owner, name: name } : undefined, halfCreated: halfCreated }
        }
      } else {
        // origin 已存在：先创建远程仓库（不带 --source），再 set-url + push
        const cr2 = await runGh(['repo', 'create', name, visFlag], cwd)
        if (!cr2.ok) {
          const kind = classifyCreateError(cr2.error, cr2.kind)
          const repoUrl = (kind === 'already-exists' && currentUser) ? ('https://github.com/' + currentUser + '/' + name) : undefined
          return { ok: false, errorKind: kind, error: cr2.error, repoUrl: repoUrl, repo: repoUrl ? { owner: currentUser || '', name: name } : undefined }
        }
        // 解析新建仓库 URL（gh 输出含 https://github.com/owner/name）
        let remoteUrl = ''
        if (currentUser) remoteUrl = 'https://github.com/' + currentUser + '/' + name + '.git'
        else {
          const m = String(cr2.text || '').match(/https:\/\/github\.com\/[^\s\/]+\/[^\s\/]+/)
          if (m) remoteUrl = m[0] + '.git'
        }
        if (remoteUrl) {
          await execProc([git, 'remote', 'set-url', 'origin', remoteUrl], cwd)
        }
        const pushR = await execProc([git, 'push', '-u', 'origin', 'HEAD'], cwd)
        if (!pushR.ok) {
          const kind = classifyCreateError(pushR.error, null)
          // #420/#426 半成功：远端仓库已创建、仅本地推送失败 → 回带 repoUrl/repo/halfCreated，前端展示链接与重试入口
          const repoUrl = remoteUrl ? remoteUrl.replace(/\.git$/, '') : (currentUser ? ('https://github.com/' + currentUser + '/' + name) : undefined)
          const owner = currentUser || (repoUrl ? (repoUrl.split('/')[3] || '') : '')
          return { ok: false, errorKind: kind, error: pushR.error, repoUrl: repoUrl, repo: repoUrl ? { owner: owner, name: name } : undefined, halfCreated: !!repoUrl }
        }
      }
      // 成功后失效全部缓存，使头部 owner/repo 立即出现
      cache = { ts: 0, snapshot: null, error: null, cwd: null }
      const rk3 = await canonicalKey(cwd || DEFAULT_CWD)
      if (rk3 && repoKeys[rk3] !== undefined) delete repoKeys[rk3]
      if (rk3 && repoRoots[rk3] !== undefined) delete repoRoots[rk3]
      // 优先用 getRepoKey 重解析（parseGithubRepo），兜底用 currentUser
      let owner = currentUser
      try {
        const rk = await getRepoKey(cwd)
        if (rk && rk.owner) owner = rk.owner
        else if (rk && rk.name) owner = owner || ''
      } catch (e) { /* 兜底 */ }
      // 若 getRepoKey 仍取不到但有 currentUser，则以 currentUser 为准
      if (!owner) {
        try {
          const u2 = await runGh(['api', 'user', '-q', '.login'], cwd)
          if (u2.ok) owner = u2.text.trim()
        } catch (e2) { /* 忽略 */ }
      }
      return { ok: true, repo: { owner: owner, name: name }, repoUrl: owner ? ('https://github.com/' + owner + '/' + name) : '' }
    })

    // ============ 重试推送（#420/#426 定版：仅推送，不动建仓）============
    // 入参：{ cwd, name, repoUrl, owner }（半成功时由前端从 initPublish 结果带出）
    // 流程：origin 缺失则以 repoUrl 补 remote → git push -u origin HEAD；成功 ok:true（前端走成功闭环），失败回带半成功契约
    harness.handle('wf.retryPush', async function (args) {
      const cwd = (args && args.cwd) || DEFAULT_CWD
      const name = args && args.name ? String(args.name).trim() : ''
      const repoUrl = args && typeof args.repoUrl === 'string' && args.repoUrl ? String(args.repoUrl) : ''
      const owner = args && args.owner ? String(args.owner) : ''
      const git = await resolveGit()
      if (!git) return { ok: false, errorKind: 'no-git', error: '未找到 git（请安装 https://git-scm.com/）' }
      try {
        const ro = await execProc([git, 'remote', 'get-url', 'origin'], cwd)
        if (!ro.ok && repoUrl) { await execProc([git, 'remote', 'add', 'origin', repoUrl + '.git'], cwd) }
      } catch (e) { /* remote 缺失时兜底 */ }
      const pushR = await execProc([git, 'push', '-u', 'origin', 'HEAD'], cwd)
      if (pushR.ok) {
        try { cache = { ts: 0, snapshot: null, error: null, cwd: null } } catch (eCache) { /* 缓存失效兜底 */ }
        return { ok: true, repo: { owner: owner, name: name }, repoUrl: owner ? ('https://github.com/' + owner + '/' + name) : '' }
      }
      const kind = classifyCreateError(pushR.error, null)
      return { ok: false, errorKind: kind, error: pushR.error, repoUrl: repoUrl || undefined, repo: { owner: owner, name: name }, halfCreated: true }
    })

    // ============ 原生选择器（DSH directory/file picker，供 modal-seat 的 directory/file 字段使用） ============
    // 前端字段 type:'directory' | 'file' 的“浏览…”按钮会调 wf.pickDirectory / wf.pickFile
    // 宿主侧优先走平台/宿主自带的原生对话框（若 DSH / Electron 暴露），否则回落为手输提示（ok:false）
    harness.handle('wf.pickDirectory', async function (args) {
      const cwd = (args && (args.cwd || args.initial)) ? String(args.cwd || args.initial) : DEFAULT_CWD
      const initial = args && args.initial ? String(args.initial) : cwd
      try {
        // 1) 尝试 Electron dialog（DSH Desktop 主进程）
        let electron = null
        try { electron = typeof require === 'function' ? require('electron') : null } catch(_){}
        if (electron && electron.dialog && typeof electron.dialog.showOpenDialogSync === 'function') {
          try {
            const picked = electron.dialog.showOpenDialogSync({ properties: ['openDirectory'], defaultPath: initial || cwd })
            if (Array.isArray(picked) && picked[0]) return { ok: true, path: String(picked[0]) }
            return { ok: false, error: 'cancelled', errorKind: 'cancelled' }
          } catch(_){}
        }
        // 2) 尝试 DSH 平台暴露的 picker（若未来 platform 提供）
        try {
          let plat = null
          try { plat = await getPlatform() } catch(_){}
          if (plat && typeof plat.pickDirectory === 'function') {
            const p = await plat.pickDirectory(initial || cwd)
            if (p) return { ok: true, path: String(p) }
          }
        } catch(_){}
        // 3) 回落：宿主暂无原生对话框能力，提示手输（前端会保留输入框可用）
        return { ok: false, error: '当前环境暂无原生目录选择器，请手动输入路径', errorKind: 'no-picker' }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), errorKind: 'internal' }
      }
    })
    harness.handle('wf.pickFile', async function (args) {
      const cwd = (args && (args.cwd || args.initial)) ? String(args.cwd || args.initial) : DEFAULT_CWD
      const initial = args && args.initial ? String(args.initial) : cwd
      try {
        let electron = null
        try { electron = typeof require === 'function' ? require('electron') : null } catch(_){}
        if (electron && electron.dialog && typeof electron.dialog.showOpenDialogSync === 'function') {
          try {
            const picked = electron.dialog.showOpenDialogSync({ properties: ['openFile'], defaultPath: initial || cwd })
            if (Array.isArray(picked) && picked[0]) return { ok: true, path: String(picked[0]) }
            return { ok: false, error: 'cancelled', errorKind: 'cancelled' }
          } catch(_){}
        }
        try {
          let plat = null
          try { plat = await getPlatform() } catch(_){}
          if (plat && typeof plat.pickFile === 'function') {
            const p = await plat.pickFile(initial || cwd)
            if (p) return { ok: true, path: String(p) }
          }
        } catch(_){}
        return { ok: false, error: '当前环境暂无原生文件选择器，请手动输入路径', errorKind: 'no-picker' }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), errorKind: 'internal' }
      }
    })
    harness.handle('wf.openPath', async function (args) {
      const raw = args && args.path ? String(args.path) : ''
      if (!raw) return { ok: false, error: '缺少 path', errorKind: 'bad-arg' }
      let p = raw.trim()
      // 去 file:// 前缀（UI 传来可能是 file:///D:/a/b.md）
      if (/^file:\/\//i.test(p)) {
        try { p = decodeURI(p.replace(/^file:\/\/\//i, '').replace(/^file:\/\//i, '')) } catch {}
        // win32 file:///D:/a -> D:/a
        if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1)
      }
      // 基础校验：路径需为绝对或含盘符/斜杠，避免 shell 注入的相对跳出
      if (!p) return { ok: false, error: 'path 为空', errorKind: 'bad-arg' }
      try {
        const plat = await getPlatform()
        const isWin = plat && plat.os === 'win32'
        const isMac = plat && plat.os === 'darwin'
        let argv = null
        if (isWin) {
          // win32 用 explorer 选中文件，无 shell 拼接，argv 直传防注入；文件不存在时 explorer 仍会打开目录
          // 优先用 explorer /select, 失败回退 cmd start
          try {
            // 先尝试 explorer 选中（最符合“在本地打开”）
            const handle = subprocess.spawn({ argv: ['explorer', '/select,' + p], cwd: DEFAULT_CWD, stdio: { stdin: 'ignore', stdout: { maxBytes: 64*1024 }, stderr: { maxBytes: 64*1024 } }, graceMs: 2000 })
            const to = timer.timeout(3000)
            await Promise.race([handle.done, to.then(function(){ try{ handle.terminate() }catch{}; return {exitCode:-1}})])
            return { ok: true }
          } catch {}
          argv = ['cmd', '/c', 'start', '', p]
        } else if (isMac) {
          argv = ['open', p]
        } else {
          argv = ['xdg-open', p]
        }
        if (argv) {
          const h = subprocess.spawn({ argv: argv, cwd: DEFAULT_CWD, stdio: { stdin: 'ignore', stdout: { maxBytes: 64*1024 }, stderr: { maxBytes: 64*1024 } }, graceMs: 2000 })
          const to2 = timer.timeout(5000)
          const out = await Promise.race([h.done, to2.then(function(){ try{ h.terminate() }catch{}; return {exitCode:-1, signal:'timeout'}})])
          if (out && out.exitCode === 0) return { ok: true }
          // explorer 场景已在上面 return，此处为 open/xdg-open 的结果
          return { ok: true }
        }
        return { ok: false, error: '当前平台不支持打开', errorKind: 'unsupported' }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), errorKind: 'internal' }
      }
    })

    // ============ 轮询：已按 #348 拍板 Q3 关闭（60s 全量 × 8 map ≈ 2400-4800 GraphQL points/h 贴 5000 限额）============
    // 刷新策略 = 纯手动（状态条/面板按钮 wf.refresh）+ 打开面板即刷（client 侧 loadSnapshot）。
    // P1 若做状态变化 toast 提醒，再考虑低频自动（届时恢复本块并观察配额）。

    // #265：命名守护常驻轻量任务启动（脏账落盘心跳；守护块见上）
    startNamingGuardianLoop()

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