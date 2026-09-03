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

    // ============ 数据流 ============
    // T16：正文预处理 —— 剥 BOM + 字面 \n 还原为真实换行（历史坏格式 body 也能解析）
    //   触发条件：真实换行极少而字面 \n 大量存在（整篇被压成一行）；避免误伤正常正文
    function normalizeBody(raw) {
      let s = String(raw || '').replace(/^\uFEFF/, '')
      const realNL = (s.match(/\n/g) || []).length
      const literalNL = (s.match(/\\n/g) || []).length
      if (realNL < 2 && literalNL > 0) {
        s = s.replace(/\\n/g, '\n')
      }
      return s
    }
    function parseMapBody(body) {
      const out = { destination: '', notes: '', decisions: [], fog: [], outOfScope: [] }
      if (!body) return out
      const sec = {}
      const lines = normalizeBody(body).split(/\r?\n/)
      let cur = null
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^##\s+(.+?)\s*$/)
        if (m) { cur = m[1]; sec[cur] = sec[cur] || []; continue }
        if (cur) sec[cur].push(lines[i])
      }
      const clean = function (arr) { return (arr || []).map(function (s) { return s.trim() }).filter(Boolean) }
      out.destination = clean(sec['Destination']).join(' ')
      out.notes = clean(sec['Notes']).join(' ')
      out.decisions = clean(sec['Decisions so far']).filter(function (l) { return l.indexOf('- [') === 0 }).map(function (l) {
        const t = l.match(/\[(.+?)\]\((.+?)\)/)
        const g = l.replace(/^-\s*\[.+?\]\(.+?\)\s*[-–—]?\s*/, '')
        return { title: t ? t[1] : l, url: t ? t[2] : '', gist: g }
      })
      out.fog = clean(sec['Not yet specified']).filter(function (l) { return l.indexOf('<!--') !== 0 })
      out.outOfScope = clean(sec['Out of scope']).filter(function (l) { return l.indexOf('<!--') !== 0 })
      return out
    }

    // v1.5 T12 修订（B4）：进度块解析三级锚定 —— 进度区 = 契约固定章节「## 进度：N%」，先锚定标题行，防正文示例/规则文本劫持（#459/#460 实证）
    //   1) 标题行：## 进度：90%（行首 markdown 标题 · 进度区正形）
    //   2) 行首变体：进度：90% / Progress: 90%（无标题符号 · 兑现注释承诺）
    //   3) 全文兜底：任意出现（兼容老票随手格式 · 放最后不劫持前两层）
    function parseProgress(body) {
      if (!body) return null
      const s = String(body)
      const m = s.match(/^\s*#{1,6}\s*(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/im)
        || s.match(/^\s*(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/im)
        || s.match(/(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/i)
      if (!m) return null
      const n = parseInt(m[1], 10)
      if (isNaN(n)) return null
      return Math.max(0, Math.min(100, n))
    }

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

    function mapTicket(raw) {
      const labels = ((raw.labels && raw.labels.nodes) || []).map(function (x) { return x.name })
      let type = 'other'
      for (let i = 0; i < labels.length; i++) {
        if (labels[i].indexOf('wayfinder:') === 0) { type = labels[i].slice('wayfinder:'.length) || 'other'; break }
      }
      const as = (raw.assignees && raw.assignees.nodes) || []
      return {
        number: raw.number, title: raw.title, type: type,
        state: raw.state === 'CLOSED' ? 'CLOSED' : 'OPEN',
        claimedBy: as.length ? as[0].login : '',
        blockedBy: ((raw.blockedBy && raw.blockedBy.nodes) || []).map(function (b) { return b.number }),
        blocks: ((raw.blocking && raw.blocking.nodes) || []).map(function (b) { return b.number }),
        labels: labels, url: raw.url,
        progress: parseProgress(raw.body),  // v1.5 T12：issue 正文进度块（## 进度：N%），null = 未表达
        author: (raw.author && raw.author.login) ? { login: raw.author.login, name: (raw.author.name || ''), avatarUrl: (raw.author.avatarUrl || raw.author.avatar_url || '') } : (raw.user && raw.user.login ? { login: raw.user.login, avatarUrl: raw.user.avatar_url || '' } : undefined),
      }
    }

    // v1.4（T1 #442）：blockedBy DAG 最长路径深度分层
    //   level(root) = 0（无依赖）；level(x) = 1 + max(level(所有直接阻塞者))
    //   同层 = 无依赖互斥 → 可并行；层间 = 必须串行（上层全 closed 才解锁）
    //   返回 { byNumber: {n: level}, levels: [{level, open, closed, total, frontier, claimed, blocked, numbers:[]}] }
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

    async function fetchMaps(cwd) {
      // #44 T2-fix（map#37）：显式 --repo 绕过 gh 在 Fork 上的多远程推断（upstream 优先）
      const repo = await getRepoKey(cwd)
      const argsMap = ['issue', 'list', '--state', 'open', '--label', 'wayfinder:map', '--json', 'number,title,body,labels,assignees,state,updatedAt']
      if (repo) argsMap.push('--repo', repo.owner + '/' + repo.name)
      const r = await runGh(argsMap, cwd)
      if (!r.ok) return { ok: false, error: r }
      try { return { ok: true, maps: JSON.parse(r.text) } } catch (e) { return { ok: false, error: { kind: 'parse', error: String(e) } } }
    }

    // 手动分页兜底：gh api --paginate 在本机偶发 unexpected EOF 时，按页拉取避免单页失败拖垮全量
    // 首选 --paginate 成功即走快路径；失败则按 page=1..N 逐页拉，单页失败若有 text 则解析该页部分数据，否则中断
    // 该路径在 4c6508c 的 100 截断基础上补全全量，避免 100 截断导致旧票丢失（回归风险）
    async function fetchAllIssuesManual(cwd, repo) {
      if (!repo) return { ok: false, error: { kind: 'env', error: 'missing repo' } };
      let all = [];
      for (let page = 1; page <= 10; page++) {
        const url = 'repos/' + repo.owner + '/' + repo.name + '/issues?state=all&per_page=100&page=' + page;
        const r = await runGh(['api', url, '--jq', '.[] | select(.pull_request == null) | {number: .number, title: .title, state: .state, labels: .labels, assignees: .assignees, user: .user, updated_at: .updated_at, created_at: .created_at}'], cwd);
        const raw = r && (r.ok ? r.text : (r.text || ''));
        if (!raw || !String(raw).trim()) { if (page === 1) return { ok: false, error: r }; break; }
        try {
          const txt = String(raw).trim();
          let arr = [];
          if (txt.startsWith('[')) { try { arr = JSON.parse(txt); } catch {} }
          if (!arr.length && txt) {
            const lines = txt.split('\n').filter(function(s){return s.trim();});
            for (let i=0;i<lines.length;i++) { try { const o=JSON.parse(lines[i]); if(o && typeof o.number==='number') arr.push(o); } catch(e){} }
            if (!arr.length) { try { arr = JSON.parse('['+lines.join(',')+']'); } catch(e){} }
          }
          if (!arr.length) { if (page===1) return { ok:false, error: r }; break; }
          const issues = arr.map(function(x){ return { number:x.number, title:x.title, state:(String(x.state).toLowerCase()==='closed'?'CLOSED':'OPEN'), assignees:(x.assignees||[]).map(function(a){return a.login;}), labels:(x.labels||[]).map(function(l){return {name:l.name,color:l.color||''};}), author:(x.user&&x.user.login)?{login:x.user.login,name:(x.user.name||''),avatarUrl:(x.user.avatar_url||'')}:undefined, updatedAt:x.updated_at, createdAt:x.created_at }; });
          all = all.concat(issues);
          if (arr.length < 100) break;
        } catch (e) { if (page===1) return { ok:false, error: r }; break; }
        if (!r.ok) break;
      }
      if (all.length) { all.sort(function(a,b){ return String(b.updatedAt).localeCompare(String(a.updatedAt)); }); return { ok:true, issues: all }; }
      return { ok:false, error:{kind:'empty', error:'manual paginate empty'} };
    }
    async function fetchAllIndexManual(cwd, repo) {
      if (!repo) return { ok:false, error:{kind:'env', error:'missing repo'} };
      let idx = {};
      for (let page=1; page<=10; page++) {
        const url = 'repos/' + repo.owner + '/' + repo.name + '/issues?state=all&per_page=100&page=' + page;
        const r = await runGh(['api', url, '--jq', '.[] | select(.pull_request == null) | {number: .number, state: .state, updatedAt: .updated_at}'], cwd);
        const raw = r && (r.ok ? r.text : (r.text||''));
        if (!raw || !String(raw).trim()) { if(page===1) return {ok:false, error:r}; break; }
        try {
          const txt = String(raw).trim();
          let arr = [];
          if (txt.startsWith('[')) { try{ arr=JSON.parse(txt);}catch{} }
          if (!arr.length && txt) {
            const lines = txt.split('\n').filter(Boolean);
            for(let i=0;i<lines.length;i++){ try{ const o=JSON.parse(lines[i]); if(o&&o.number!=null) arr.push(o);}catch(e){} }
            if(!arr.length){ try{ arr=JSON.parse('['+lines.join(',')+']');}catch(e){} }
          }
          if (!arr.length) { if(page===1) return {ok:false, error:r}; break; }
          for(let i=0;i<arr.length;i++){ const it=arr[i]; if(it&&it.number!=null) { idx[String(it.number)] = String(it.state||'').toUpperCase() + '|' + String(it.updatedAt||''); } }
          if (arr.length < 100) break;
        } catch(e){ if(page===1) return {ok:false, error:r}; break; }
        if (!r.ok) break;
      }
      if (Object.keys(idx).length) return { ok:true, repo:repo, index:idx, count:Object.keys(idx).length };
      return { ok:false, error:{kind:'empty', error:'manual index empty'} };
    }
    // 全部 issue（open + closed，Client 列表 open 常显、底部「已关闭」折叠行），
    // 按 updatedAt 倒序；labels 带 name + color（GitHub 配置色）；state 区分 open/closed；
    // v18：assignees 带出（状态栏「占用」按列表 issue 口径：已认领 + 被阻塞）
    async function fetchIssues(cwd) {
      // #374/#375：--limit 500 覆盖仓库全量，并带出 createdAt；为取 author.avatarUrl 改用 gh api（gh issue list 的 author 不含 avatarUrl，见 b7442da 后用户反馈“未显示真人头像”）
      //   gh api repos/.../issues?state=all&per_page=100 --paginate 直接给出 user.avatar_url，零额外 user 查询
      // #44 T2-fix：显式 --repo 绕过多远程推断
      const repo2 = await getRepoKey(cwd)
      // 优先 gh api（带 avatar）
      if (repo2) {
        const apiUrl = 'repos/' + repo2.owner + '/' + repo2.name + '/issues?state=all&per_page=100'
        const r2 = await runGh(['api', '--paginate', apiUrl, '--jq', '.[] | select(.pull_request == null) | {number: .number, title: .title, state: .state, labels: .labels, assignees: .assignees, user: .user, updated_at: .updated_at, created_at: .created_at}'], cwd)
        if (r2.ok) {
          try {
            const text = String(r2.text || '').trim()
            // --jq 输出为 JSON Lines（每行一个对象），非数组；兼容数组与单对象两种
            let arr = []
            if (text.startsWith('[')) arr = JSON.parse(text)
            else if (text) {
              const lines = text.split('\n').filter(function(s){return s.trim()})
              for (let i=0;i<lines.length;i++) { try{ const o=JSON.parse(lines[i]); if(o && typeof o.number==='number') arr.push(o)}catch(e){} }
              if (!arr.length) { try{ arr = JSON.parse('['+lines.join(',')+']')}catch(e){} }
            }
            const issues = arr.map(function (x) {
              return {
                number: x.number,
                title: x.title,
                state: (String(x.state).toLowerCase()==='closed' ? 'CLOSED' : 'OPEN'),
                assignees: (x.assignees || []).map(function (a) { return a.login }),
                labels: (x.labels || []).map(function (l) { return { name: l.name, color: l.color || '' } }),
                author: (x.user && x.user.login) ? { login: x.user.login, name: (x.user.name || ''), avatarUrl: (x.user.avatar_url || '') } : undefined,
                updatedAt: x.updated_at,
                createdAt: x.created_at,
              }
            })
            issues.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)) })
            if (issues.length) return { ok: true, issues: issues }
          } catch (e) { /* fall through to gh issue list */ }
        }
      }
      // 手动分页兜底：--paginate 失败时按页拉取全量，避免 100 截断丢失旧票
      if (repo2) {
        try {
          const manual = await fetchAllIssuesManual(cwd, repo2);
          if (manual.ok && manual.issues && manual.issues.length) return manual;
        } catch (e) {}
      }
      // 回退：gh issue list（无 avatar，仅 login；UI 将回退为 person SVG）
      // 修复 unexpected EOF：500 在部分网络下触发 GraphQL 大查询 EOF，回退改用 100 并重试一次
      const tryList = async function(limit) {
        const a = ['issue', 'list', '--state', 'all', '--limit', String(limit), '--json', 'number,title,labels,state,assignees,author,updatedAt,createdAt']
        if (repo2) a.push('--repo', repo2.owner + '/' + repo2.name)
        return runGh(a, cwd)
      }
      let r = await tryList(100)
      if (!r.ok && String(r.error||'').toLowerCase().includes('unexpected eof')) {
        r = await tryList(100)
      }
      if (!r.ok) {
        // 500 回退已不可靠，改用 open 100 再 all 100 的分段拉取（open 100 必含 414 这类新 open 票）
        const rOpen = await runGh(['issue', 'list', '--state', 'open', '--limit', '100', '--json', 'number,title,labels,state,assignees,author,updatedAt,createdAt', '--repo', repo2.owner + '/' + repo2.name], cwd)
        if (rOpen.ok) r = rOpen
      }
      if (!r.ok) return { ok: false, error: r }
      try {
        const all = JSON.parse(r.text)
        const issues = all.map(function (x) {
          return {
            number: x.number,
            title: x.title,
            state: x.state,
            assignees: (x.assignees || []).map(function (a) { return a.login }),
            labels: (x.labels || []).map(function (l) { return { name: l.name, color: l.color || '' } }),
            author: (x.author && x.author.login) ? { login: x.author.login, name: (x.author.name || ''), avatarUrl: (x.author.avatarUrl || x.author.avatar_url || '') } : undefined,
            updatedAt: x.updatedAt,
            createdAt: x.createdAt,
          }
        })
        issues.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)) })
        return { ok: true, issues: issues }
      } catch (e) { return { ok: false, error: { kind: 'parse', error: String(e) } } }
    }

    // #2 deletion fix：轻量全量索引用于发现删除、关闭和重开。
    async function fetchIssueIndex(cwd) {
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', error: '无法解析 owner/repo' } }
      const url = 'repos/' + repo.owner + '/' + repo.name + '/issues?state=all&per_page=100'
      const r = await runGh(['api', '--paginate', url, '--jq', '.[] | select(.pull_request == null) | {number: .number, state: .state, updatedAt: .updated_at}'], cwd)
      // 优先解析 gh api 的输出，即使 r.ok===false 但 text 中已有部分数据（如 414/415 在前两页已返回，仅第3页 unexpected EOF 导致 exit 1），也尝试解析，避免因单页网络抖动就判 unknown 回旧
      const tryParseIndex = function(text) {
        try {
          const index = {}
          const lines = String(text || '').split(/\r?\n/).filter(Boolean)
          lines.forEach(function (line) {
            try { const item = JSON.parse(line); if (item && item.number !== undefined && item.number !== null) index[String(item.number)] = String(item.state || '').toUpperCase() + '|' + String(item.updatedAt || '') } catch {}
          })
          if (Object.keys(index).length) return { ok: true, repo: repo, index: index, count: Object.keys(index).length }
        } catch {}
        return null
      }
      if (r && r.text) {
        const parsed = tryParseIndex(r.text)
        if (parsed) return parsed
      }
      if (!r.ok) {
        // 手动分页兜底：优先按页拉全量索引，避免 100 截断丢失旧票（如删除检测）
        try {
          const manualIdx = await fetchAllIndexManual(cwd, repo);
          if (manualIdx.ok && manualIdx.index && Object.keys(manualIdx.index).length) return manualIdx;
        } catch (e) {}
        // 回退：gh api 整体失败时，用 gh issue list 全量兜底（与 fetchIssues 同策略），确保外部建票 60s 内可被发现
        // 500 在部分网络下触发 unexpected EOF，改用 100 并重试
        let fallback = await runGh(['issue', 'list', '--state', 'all', '--limit', '100', '--json', 'number,state,updatedAt'], cwd)
        if (!fallback.ok && String(fallback.error||'').toLowerCase().includes('unexpected eof')) {
          fallback = await runGh(['issue', 'list', '--state', 'all', '--limit', '100', '--json', 'number,state,updatedAt'], cwd)
        }
        if (!fallback.ok) {
          fallback = await runGh(['issue', 'list', '--state', 'open', '--limit', '100', '--json', 'number,state,updatedAt'], cwd)
        }
        const fbParsed = fallback && fallback.text ? tryParseIndex(fallback.text.replace(/\[|\]/g, '').split('},').join('}\n')) : null
        // 更稳妥的 fallback 解析：直接 JSON 数组
        try {
          if (fallback && fallback.ok && fallback.text) {
            const arr = JSON.parse(fallback.text)
            if (Array.isArray(arr) && arr.length) {
              const idx = {}
              arr.forEach(function(it){ if(it && it.number!=null) idx[String(it.number)] = String(it.state||'').toUpperCase() + '|' + String(it.updatedAt||'') })
              if (Object.keys(idx).length) return { ok: true, repo: repo, index: idx, count: Object.keys(idx).length }
            }
          }
        } catch {}
        return { ok: false, error: r }
      }
      try {
        const index = {}
        const lines = String(r.text || '').split(/\r?\n/).filter(Boolean)
        lines.forEach(function (line) {
          const item = JSON.parse(line)
          if (item && item.number !== undefined && item.number !== null) index[String(item.number)] = String(item.state || '').toUpperCase() + '|' + String(item.updatedAt || '')
        })
        return { ok: true, repo: repo, index: index, count: Object.keys(index).length }
      } catch (e) { return { ok: false, error: { kind: 'parse', error: String(e) } } }
    }
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
    const cacheSnapshotIsCurrent = async function (snap, cwd) {
      try {
        const remote = await fetchIssueIndex(cwd)
        if (!remote.ok) return null
        const current = !issueIndexChanged(issueIndexFromSnapshot(snap), remote.index)
        if (current) rememberIssueIndex(remote.repo, remote.index)
        return current
      } catch (e) { return null }
    }
    const adoptSnapshot = function (snap, cwd) {
      cache = { ts: Date.now(), snapshot: snap, error: null, cwd: cwd }
      if (snap && snap.repo) rememberIssueIndex(snap.repo, issueIndexFromSnapshot(snap))
      return snap
    }


    // v1.5 B5（配额止血 · 第一性原理）：GraphQL 配额耗尽时的 REST 降级通道 ——
    //   GraphQL 按复杂度计点（5000 点/h，aliases 大查询一次可数百点），REST 按请求计次
    //   （5000 次/h，与复杂度无关）。配额耗尽时 GraphQL 全挂，REST 仍可用 → 面板不空白。
    //   逐 map：issue 详情 + sub_issues + 每子票 blocked_by（client 只消费 blockedBy，
    //   blocking 不组装省一半请求）；输出与 GraphQL 同构的 { 'm<i>': {...} }，下游 mapTicket 零改动。
    async function fetchMapsDetailREST(numbers, cwd) {
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', error: '无法解析 owner/repo' } }
      if (!numbers || !numbers.length) return { ok: true, issues: {} }
      const issues = {}
      for (let i = 0; i < numbers.length; i++) {
        const n = numbers[i]
        try {
          const d = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/issues/' + n], cwd)
          if (!d.ok) { issues['m' + i] = null; continue }
          const m = JSON.parse(d.text)
          const sub = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/issues/' + n + '/sub_issues?per_page=100'], cwd)
          const subs = sub.ok ? (JSON.parse(sub.text) || []) : []
          const nodes = []
          for (let k = 0; k < subs.length; k++) {
            const s = subs[k]
            let blockedBy = []
            try {
              const bb = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/issues/' + s.number + '/dependencies/blocked_by'], cwd)
              if (bb.ok) blockedBy = (JSON.parse(bb.text) || []).map(function (x) { return x.number })
            } catch (e2) { /* 依赖查询失败该票 blockedBy 置空，不阻塞整体 */ }
            nodes.push({
              number: s.number, title: s.title, state: (s.state === 'closed' ? 'CLOSED' : 'OPEN'),
              body: s.body || '', url: s.html_url || ('https://github.com/' + repo.owner + '/' + repo.name + '/issues/' + s.number),
              labels: { nodes: (s.labels || []).map(function (l) { return { name: l.name } }) },
              assignees: { nodes: (s.assignees || []).map(function (a) { return { login: a.login } }) },
              author: (s.user && s.user.login) ? { login: s.user.login, name: (s.user.name || ''), avatarUrl: (s.user.avatar_url || '') } : undefined,
              blockedBy: { nodes: blockedBy.map(function (b) { return { number: b } }) },
            })
          }
          issues['m' + i] = {
            number: m.number, title: m.title, state: (m.state === 'closed' ? 'CLOSED' : 'OPEN'),
            body: m.body || '', url: m.html_url || ('https://github.com/' + repo.owner + '/' + repo.name + '/issues/' + m.number),
            labels: { nodes: (m.labels || []).map(function (l) { return { name: l.name } }) },
            author: (m.user && m.user.login) ? { login: m.user.login, name: (m.user.name || ''), avatarUrl: (m.user.avatar_url || '') } : undefined,
            subIssues: { totalCount: nodes.length, nodes: nodes },
          }
        } catch (e) { issues['m' + i] = null }
      }
      return { ok: true, issues: issues, fallback: 'rest' }
    }

    function isRateLimitError(r) {
      const t = String((r && r.error) || (r && r.kind) || '').toLowerCase()
      return /rate\s*limit|ratelimit|403/.test(t)
    }


    // v1.3.3 提速：GraphQL aliases 一次查询全部 map 详情（8 次 → 1 次，Windows 下串行 8×2.4s → 单次 ~3.6s）
    //   每个 map 一个 alias（m0/m1/...），响应按 alias 取；网络类失败整批重试 1 次
    async function fetchMapsDetail(numbers, cwd) {
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', error: '无法解析 owner/repo（git remote 或 gh repo view 失败）' } }
      if (!numbers || !numbers.length) return { ok: true, issues: {} }
      // 构造 aliases 查询：query($owner:String!,$name:String!){repository(...){m0:issue(number:409){...} m1:issue(...){...}}}
      const frag = 'number title state body url author{login avatarUrl ... on User{name} ... on Organization{name}} labels(first:20){nodes{name}} subIssues(first:100){totalCount nodes{number title state body url author{login avatarUrl ... on User{name} ... on Organization{name}} labels(first:10){nodes{name}} assignees(first:10){nodes{login}} blockedBy(first:20){nodes{number title state}}}}'
      const sel = numbers.map(function (n, i) { return 'm' + i + ':issue(number:' + n + '){' + frag + '}' }).join(' ')
      const query = 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){' + sel + '}}'
      let last = null
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await runGh(['api', 'graphql', '-f', 'query=' + query, '-F', 'owner=' + repo.owner, '-F', 'name=' + repo.name], cwd)
        if (!r.ok) {
          last = r
          // v1.5 B5：GraphQL 配额耗尽（RATE_LIMIT）→ 自动降级 REST 通道（不重试 2 次白烧，直接降级）
          if (isRateLimitError(r)) return fetchMapsDetailREST(numbers, cwd)
          if (r.kind !== 'network') return { ok: false, error: r }
          continue
        }
        try {
          const j = JSON.parse(r.text)
          if (j.errors) {
            // v1.5 B5：GraphQL 返回 errors（含 RATE_LIMIT）→ REST 降级
            if (isRateLimitError({ error: JSON.stringify(j.errors) })) return fetchMapsDetailREST(numbers, cwd)
            return { ok: false, error: { kind: 'graphql', error: JSON.stringify(j.errors).slice(0, 300) } }
          }
          return { ok: true, issues: j.data.repository }
        } catch (e) { return { ok: false, error: { kind: 'parse', error: String(e) } } }
      }
      return { ok: false, error: last || { kind: 'network', error: 'GraphQL aliases 请求失败（重试后仍失败）' } }
    }

    // T2 #7 · fetchIssueDetail 单 issue 数据通路（复用 fetchMapsDetail 思路，独立别名/单 issue 不合并 aliases）
    // GraphQL 字段按 T2 契约：number title state body url updatedAt createdAt closedAt labels(first:20){nodes{name color}} assignees(first:10){nodes{login}} comments(first:50){nodes{author{login} authorAssociation body createdAt updatedAt}} subIssues(first:50){totalCount nodes{number title state}} blockedBy(first:20){nodes{number title state}}
    // 配额止血：GraphQL 按复杂度计点失败 → RATE_LIMIT 鉴别后切 REST 兜底；REST 逐请求失败置空，整体不崩
    // 错误形状与 fetchMapsDetail 对齐 {ok,error,issue?}；kind 细化 env|parse|graphql|network|rateLimit|notFound|404
    async function fetchIssueDetailREST(n, cwd) {
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', message: '无法解析 owner/repo（git remote 或 gh repo view 失败）' } }
      try {
        const r = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/issues/' + n], cwd)
        if (!r.ok) {
          if (r.kind === 'notfound' || /404/i.test(String(r.error||''))) return { ok: false, error: { kind: '404', message: String(r.error||'not found') } }
          if (r.kind === 'notfound') return { ok: false, error: { kind: 'notFound', message: String(r.error||'not found') } }
          if (isRateLimitError(r)) return { ok: false, error: { kind: 'rateLimit', message: String(r.error||'rate limit') } }
          return { ok: false, error: { kind: r.kind || 'network', message: String(r.error||'request failed') } }
        }
        const issue = JSON.parse(r.text)
        let comments = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }
        let subIssues = { totalCount: 0, nodes: [] }
        let blockedBy = { nodes: [] }
        try {
          const cr = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/issues/' + n + '/comments?per_page=50'], cwd)
          if (cr.ok) {
            const arr = JSON.parse(cr.text) || []
            comments.nodes = arr.map(function (c) { return { author: { login: (c.user && c.user.login) || '' }, authorAssociation: c.author_association || '', body: c.body || '', createdAt: c.created_at, updatedAt: c.updated_at } })
            comments.pageInfo = { hasNextPage: arr.length === 50, endCursor: String(arr.length) }
          }
        } catch (e) {}
        try {
          const sr = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/issues/' + n + '/sub_issues?per_page=50'], cwd)
          if (sr.ok) {
            const arr = JSON.parse(sr.text) || []
            subIssues.totalCount = arr.length
            subIssues.nodes = arr.map(function (s) { return { number: s.number, title: s.title, state: (String(s.state).toLowerCase()==='closed' ? 'CLOSED' : 'OPEN') } })
          }
        } catch (e) {}
        try {
          const br = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/issues/' + n + '/dependencies/blocked_by'], cwd)
          if (br.ok) {
            const arr = JSON.parse(br.text) || []
            blockedBy.nodes = arr.map(function (b) { return { number: b.number != null ? b.number : b.id, title: b.title || '', state: (String(b.state).toLowerCase()==='closed' ? 'CLOSED' : 'OPEN') } })
          }
        } catch (e) {}
        const mapped = {
          number: issue.number, title: issue.title, state: (String(issue.state).toLowerCase()==='closed' ? 'CLOSED' : 'OPEN'),
          body: issue.body || '', url: issue.html_url || ('https://github.com/' + repo.owner + '/' + repo.name + '/issues/' + n),
          updatedAt: issue.updated_at, createdAt: issue.created_at, closedAt: issue.closed_at,
          author: (issue.user && issue.user.login) ? { login: issue.user.login, name: (issue.user.name || ''), avatarUrl: (issue.user.avatar_url || '') } : undefined,
          labels: { nodes: (issue.labels || []).map(function (l) { return { name: l.name, color: l.color || '' } }) },
          assignees: { nodes: (issue.assignees || []).map(function (a) { return { login: a.login } }) },
          comments: comments,
          subIssues: subIssues,
          blockedBy: blockedBy,
          blocking: { nodes: [] }
        }
        return { ok: true, issue: mapped, fallback: 'rest' }
      } catch (e) { return { ok: false, error: { kind: 'parse', message: String(e) } } }
    }

    async function fetchIssueDetail(n, cwd) {
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', message: '无法解析 owner/repo（git remote 或 gh repo view 失败）' } }
      if (!n) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
      const frag = 'number title state body url updatedAt createdAt closedAt author{login avatarUrl ... on User{name} ... on Organization{name}} labels(first:20){nodes{name color}} assignees(first:10){nodes{login}} comments(first:50){nodes{author{login} authorAssociation body createdAt updatedAt} pageInfo{hasNextPage endCursor}} subIssues(first:50){totalCount nodes{number title state}} blockedBy(first:20){nodes{number title state}} blocking(first:20){nodes{number title state}}'
      const query = 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){issue(number:' + n + '){' + frag + '}}}'
      let last = null
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await runGh(['api', 'graphql', '-f', 'query=' + query, '-F', 'owner=' + repo.owner, '-F', 'name=' + repo.name], cwd)
        if (!r.ok) {
          last = r
          if (isRateLimitError(r)) return fetchIssueDetailREST(n, cwd)
          if (r.kind === 'notfound' || /not found|could not resolve/i.test(String(r.error||''))) return { ok: false, error: { kind: 'notFound', message: String(r.error||'not found') } }
          if (r.kind !== 'network') return { ok: false, error: { kind: r.kind || 'network', message: String(r.error||'network') } }
          continue
        }
        try {
          const j = JSON.parse(r.text)
          if (j.errors) {
            if (isRateLimitError({ error: JSON.stringify(j.errors) })) return fetchIssueDetailREST(n, cwd)
            if (/not found|could not resolve/i.test(JSON.stringify(j.errors))) return { ok: false, error: { kind: 'notFound', message: JSON.stringify(j.errors).slice(0,300) } }
            return { ok: false, error: { kind: 'graphql', message: JSON.stringify(j.errors).slice(0,300) } }
          }
          const issue = j.data && j.data.repository && j.data.repository.issue
          if (!issue) return { ok: false, error: { kind: 'notFound', message: 'issue not found' } }
          return { ok: true, issue: issue }
        } catch (e) { return { ok: false, error: { kind: 'parse', message: String(e) } } }
      }
      return { ok: false, error: last || { kind: 'network', message: 'GraphQL 单 issue 请求失败（重试后仍失败）' } }
    }

    async function buildSnapshot(cwd, hintBackendId) {
      let viewerLogin = null // 由 Tracker.getCurrentUser 填充（后端接口返回当前用户，UI 仅对比，不直调 gh）
      let viewer = null
      const repo = await getRepoKey(cwd)
      // v1.3.3 提速：map 列表直接从全量 issues 过滤（fetchMaps 单独调用省去 —— 原 11 次 → 9 次 gh 调用）
      const fi = await fetchIssues(cwd)
      const issues = fi.ok ? fi.issues : []
      const mapsMeta = fi.ok ? fi.issues.filter(function (x) {
        return x.state === 'OPEN' && (x.labels || []).some(function (l) { return l.name === 'wayfinder:map' })
      }) : []
      // #375：全量 label 列表（含空 label；获取失败容错置空，不阻塞快照构建，client 降级）
      let labels = []
      const fl = await runGh(['label', 'list', '--json', 'name,color'], cwd)
      if (fl.ok) {
        try {
          const ls = JSON.parse(fl.text)
          if (Array.isArray(ls)) labels = ls.map(function (l) { return { name: l.name, color: l.color || '' } })
        } catch (e) { labels = [] }
      }
      // v1.3.3 提速：GraphQL aliases 一次查全部 map 详情（原每 map 一次 GraphQL，8 次串行 ~19s → 1 次 ~4s）
      const d = await fetchMapsDetail(mapsMeta.map(function (m) { return m.number }), cwd)
      const detailOk = d.ok
      const maps = []
      for (let i = 0; i < mapsMeta.length; i++) {
        const m = mapsMeta[i]
        const issue = detailOk ? (d.issues['m' + i] || null) : null
        if (!detailOk || !issue) {
          maps.push({ number: m.number, title: m.title, state: 'OPEN', error: detailOk ? undefined : d.error, tickets: [], stats: { total: 0, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0 } })
          continue
        }
        const subs = (issue.subIssues && issue.subIssues.nodes) || []
        const tickets = subs.map(mapTicket)
        const bp = parseMapBody(issue.body)
        // v1.4（T1 #442）：每张票挂 level（DAG 最长路径深度），client 渲染漏斗分层直接取
        const lvInfo = computeLevels(tickets)
        tickets.forEach(function (t) { t.level = lvInfo.byNumber[t.number] })
        const stats = groupTickets(tickets)
        const labels2 = ((issue.labels && issue.labels.nodes) || []).map(function (x) { return x.name })
        maps.push({
          number: issue.number, title: issue.title, state: issue.state, url: issue.url, labels: labels2,
          destination: bp.destination, notes: bp.notes,
          decisions: bp.decisions, fog: bp.fog, outOfScope: bp.outOfScope,
          tickets: tickets, stats: stats,
        })
      }
      // v1.5 R2 + R2-fix-6（#2 MVP E2E 实证 2026-08-18）：probe since 基线**不得**在 buildSnapshot 里初始化/推进。
      //   原实现「buildSnapshot 末尾 lastProbeAtByRepo[rk]=now」有个致命竞态：面板任一 snapshot build（cache-miss/
      //    refresh）若发生在某次编辑**之后**，会把基线推到编辑时刻**之后** → 下次 probe since=基线 查不到该编辑
      //   （count=0 → changed=false），且基线只在 changed=true 时才滑动 → 编辑被**永久吞掉**，UI 永不刷新。
      //   正确语义：基线只能由 probe 自己推进（检测到 change 时置为「本次探测时刻」）；build 完成 ≠ client 已渲染该
      //   快照，无权动基线。首次 probe（since=undefined）自然走全量返回 → 视为 changed → 建立基线（符合原注释意图）。
      // B 方案：viewerLogin 经 Tracker.getCurrentUser（后端接口）获取，UI 仅做 login 对比，不直调 gh，不硬编码 backendId
      // #155：Selection/RepositoryRef 增量（registry.select/describe → wf.snapshot {repository, selection}）
      let selection = null
      let repository = null
      try {
        const reg = await getTrackerRegistry()
        // 预取 viewer（供 UI “本人不显”对比），失败则保持 null（全显）
        try {
          const tmpReg = reg
          const tmpHandle = { cwd: cwd }
          const tmpCtx = { cwd: cwd, platform: await getPlatform(), fs: ctx.get('fs'), timers: { setTimeout: (fn,ms)=>timer.timeout(fn,ms), clearTimeout: (id)=>{try{clearTimeout(id)}catch{}} }, exec: async function(cmd, args, opts){ const argv=[String(cmd)].concat(args||[]); const c=(opts&&opts.cwd)||cwd; const r=await execProc(argv, c); if(!r.ok) throw new Error(r.error||String(r.code||'exec failed')); return { stdout:r.text, text:r.text, ok:true, code:r.code } } }
          const selForViewer = await tmpReg.select(tmpHandle, tmpCtx)
          const vid = selForViewer && selForViewer.backendId
          if (vid) {
            const tr = tmpReg.get(vid)
            if (tr && typeof tr.getCurrentUser === 'function') {
              const vr = await tr.getCurrentUser({ backend: vid, refId: (tmpHandle.refId||''), name: '', url: '' }, tmpCtx)
              if (vr && vr.ok && vr.data && vr.data.login) { viewerLogin = String(vr.data.login).trim(); viewer = vr.data }
            }
          }
        } catch (e) {}
        if (reg && typeof reg.select === 'function') {
          const handle = { cwd: cwd }
          const ctxSel = { cwd: cwd, platform: await getPlatform(), fs: ctx.get('fs'), timers: { setTimeout: (fn,ms)=>timer.timeout(fn,ms), clearTimeout: (id)=>{try{clearTimeout(id)}catch{}} }, exec: async function(cmd, args, opts){ const argv=[String(cmd)].concat(args||[]); const c=(opts&&opts.cwd)||cwd; const r=await execProc(argv, c); if(!r.ok) throw new Error(r.error||String(r.code||'exec failed')); return { stdout:r.text, text:r.text, ok:true, code:r.code } } }
          // 能力诊断计数（G5 仅诊断，不驱动隐藏）——按 host 视角 fill 统计
          const capCount = (function(iss){
            let present=0, emptyCnt=0, missing=0
            // 简易：以 labels 为例，其余字段按 shape 能力字段集计数
            const fields=['author','assignees','labels','milestone','customFields','reason','blockedBy','comments','closedAt']
            iss.forEach(function(it){
              fields.forEach(function(f){
                if (it[f] === undefined) missing++
                else if (Array.isArray(it[f]) && it[f].length===0) emptyCnt++
                else if (it[f]===null || it[f]==='') emptyCnt++
                else present++
              })
            })
            return {present, empty: emptyCnt, missing}
          })(issues)
          // select 三级联（2026-08-28 真源统一）：快照 selection 与 wf.chain/wf.detect 同构——
          //   经 detectionService 判定（explicit 主锚 → matches → fallback），主锚是权威。
          //   此前快照裸 registry.select 不读主锚：「GitHub 版锚 + 非 git 目录」在快照侧判 fallback null，
          //   客户端保留旧 markdown 意向 → 头部 chip=Markdown 与环境检查=github（链按锚判定）互相矛盾（用户观察）。
          const selMod = await getDetectionService().then(function(svc){ return svc.detect({ cwd }, { skipSkillProbes: true, hintBackendId: hintBackendId || undefined }) }).catch(function(){ return null })
          let sel = selMod && selMod.selection
          // #297 失效维度：显式空（source explicit + null）是权威“无后端”（空目录 stale），不退回裸 select，否则旧绑定会复活
          if (!sel || (sel.backendId == null && (!sel.source || sel.source !== 'explicit'))) {
            // detect 无结论（fallback null / 服务不可用）：退回裸 select（bind 记忆 → matches）兼容旧行为
            try { sel = await reg.select(handle, ctxSel) } catch (eSel) { sel = null }
          }
          selection = sel
          if (sel && sel.backendId) {
            try { repository = reg.describe(handle, sel.backendId) } catch {}
            // 2026-08-28 加固（Dock「后端名 · 目录名」兜底根因）：describe 以 handle.refId 为准，handle 无 refId 时退化为
            //   「目录名 + 无 url」——正常 GitHub 仓库也会因临时 fs/git 读取差异落入该弱结果，UI 头部只剩兜底形态。
            //   refId/name 是身份真相（url 才受 links.repoUrlTemplate 意愿位约束）：getRepoKey 可解析即无条件补全 owner/name。
            if ((!repository || !repository.refId) && repo && repo.owner) {
              try { repository = reg.describe({ cwd: cwd, refId: repo.owner + '/' + repo.name }, sel.backendId) } catch (eDesc2) {}
            }
            if ((!repository || !repository.refId) && repo && repo.owner) {
              try { repository = { backend: sel.backendId, refId: repo.owner + '/' + repo.name, name: repo.owner + '/' + repo.name, url: '' } } catch (eD2) {}
            }
            // 2026-08-28 契约修正（用户复核）：仓库名一律由后端 describe 经契约层产出，UI 层零派生——
            //   markdown 本地形态（目录即仓库）同样经 describe 给出 name=目录名；describe 异常/弱结果时
            //   host 侧按目录名兜底（数据产生在半，UI 直显），绝不把「前端拼装」当作仓库身份来源。
            if (!repository) {
              try { repository = reg.describe({ cwd: cwd, refId: cwd }, sel.backendId) } catch (eNa) {}
            }
            if (!repository) {
              try {
                const nm = String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || sel.backendId
                repository = { backend: sel.backendId, refId: String(cwd || ''), name: nm, url: '' }
              } catch (eNb) {}
            }
            // #231：后端特判删除 —— 是否补链由该后端 links.repoUrlTemplate 意愿位声明；补全走其自身 describe（单源产出 refId/name/url）
            if (repository && !repository.url && sel.backendId && repo && repo.owner) {
              var wantsUrlSeed = false
              try {
                var modsHere = (reg && typeof reg.modules === 'function') ? reg.modules() : []
                for (var mi = 0; mi < modsHere.length; mi++) {
                  if (modsHere[mi] && modsHere[mi].id === sel.backendId && modsHere[mi].links && modsHere[mi].links.repoUrlTemplate) { wantsUrlSeed = true; break }
                }
              } catch (eSeed) {}
              if (wantsUrlSeed) { try { repository = reg.describe({ cwd: cwd, refId: repo.owner + '/' + repo.name }, sel.backendId) } catch (eDesc) {} }
            }
          } else {
            // fallback（无选择）时诚实占位：不带任何品牌 url，UI 按「无链接」渲染
            if (repo) repository = { backend: '', refId: repo.owner + '/' + repo.name, name: repo.owner + '/' + repo.name, url: '' }
            else repository = null
          }
          // 能力计数挂到 snapshot 供 ChecksTab 诊断卡
          var _capDiag = capCount
        }
      } catch (e) { /* 保持 null，不阻塞快照 */ }
      // #191: backendModules 透传（presentation 色板）—— 修复 ReferenceError: backendModules is not defined (#195 遗漏)
      let backendModules = null
      try {
        const regM = await getTrackerRegistry()
        if (regM && typeof regM.modules === 'function') {
          // 2026-08-28 修复：快照 backendModules 必须与 wf.registry 上报同构（含 setupPrompt 键表）——
          //   缺 setupPrompt 时 setupRunParamsFrom 匹配不到该后端 → 注入的 setup 提示词落回默认键组（GitHub 版），
          //   表现为「选了 gitlab/markdown，点初始化按钮注入的却还是默认 GitHub」（用户观察）。
          backendModules = regM.modules().map(function (m) { return Object.assign({ id: m.id, label: m.label, presentation: m.presentation }, m.links ? { links: m.links } : {}, m.capabilities ? { capabilities: m.capabilities } : {}, m.prompts ? { prompts: m.prompts } : {}, m.setupPrompt ? { setupPrompt: m.setupPrompt } : {}, m.labelPalette ? { labelPalette: m.labelPalette } : {}, m.openRepository ? { openRepository: m.openRepository } : {}) })
        }
      } catch (e2) {}
      return {
        ok: true,
        repo: repo,
        repoRoot: await getRepoRoot(cwd),  // v1.5 T9：git 根路径（供仓库身份组件与 setup 检查）
        updatedAt: new Date().toISOString(),
        generatedMs: Date.now(),
        env: { ghPath: ghPath, ghError: ghLastError },
        maps: maps,
        issues: issues,
        labels: labels,
        fallback: d.fallback || null,  // v1.5 B5：'rest' = GraphQL 配额耗尽已降级 REST（client 可提示）
        repository: repository,
        backendModules: backendModules,
        selection: selection,
        capabilities: (typeof _capDiag !== 'undefined' ? _capDiag : null),
        viewer: viewer, // 后端接口返回当前用户（Actor），UI 据此做“本人不显”对比
        viewerLogin: viewerLogin, // 兼容旧 UI（string），与 viewer.login 同步
      }
    }

    // ============ git 远程解析（getRepoKey 与后端谓词复用，#284）============
    // 解析 git 远程 URL → GitHub owner/repo；非 GitHub 返回 null
    function parseGithubRepo(url) {
      const s = String(url || '').trim()
      const m = s.match(/github\.com[\/:]([^\/\s]+)\/([^\/\s]+?)(?:\.git)?\s*$/)
      if (!m) return null
      return { owner: m[1], name: m[2] }
    }

    // #284：markdown 后端谓词：本地图谱可解析（复用 backends/markdown/parse.js parseMd）
    // 2026-08-28 修复：本函数与 fileExistsChainRel 曾被误嵌套在 parseGithubRepo 函数体内，
    //   作用域外（wf.chain 谓词注册处）不可见 → 运行时 ReferenceError「mdParseOkPredicate is not defined」。
    async function mdParseOkPredicate(platform, cwd, lang) {
      try {
        // 2026-08-29 修复（用户实证：图谱落在 .scratch/<图谱名>/map.md；原只查根 .scratch/map.md 必然误报 missing）：
        //   与 backends/markdown matches() 数据模型同构——候选 = 根谱 .scratch/map.md + 各子谱 .scratch/*/map.md；
        //   全部缺失 = 图谱未初始化（fail，指引先做 Markdown 初始化）；存在但解析抛错 = 格式损坏（fail，附错误原文）。
        //   用户可见 detail 一律人话（无黑话：目录叫「本地数据目录」、文件叫「关卡地图」、.scratch/map.md 只括注）。
        const zh = lang === 'zh'
        const cands = await mdMapCandidates(platform, cwd)
        if (cands.length === 0) {
          return { status: 'fail', detail: zh ? '尚未生成关卡地图（先执行本地 Markdown 初始化）' : 'No map file yet — run Local Markdown setup first' }
        }
        const mod = await import('./tracker/backends/markdown/parse.js')
        const parseMd = mod.parseMd || mod.default
        if (typeof parseMd !== 'function') return { status: 'pending', detail: 'parseMd not exported' }
        let lastErr = ''
        for (const rel of cands) {
          try {
            // target-shaped 配对：readText 必须 receive resolve 的返回值（2026-08-29 实机修复：曾直接 readText(字符串) 且对 resolve 输出做 join 致 TypeError）
            const tgt = await platform.fs.resolve(rel, { cwd: cwd })
            const text = await platform.fs.readText(tgt)
            parseMd(String(text || ''), {})
            const dir = platform.path.dirname(rel)
            const slug = dir === '.scratch' ? 'root' : platform.path.basename(dir)
            return { status: 'pass', detail: zh ? ('关卡地图已就绪（' + slug + '）') : ('local map parses OK (' + slug + ')') }
          } catch (e) {
            lastErr = String((e && e.message) || e).slice(0, 200)
          }
        }
        return { status: 'fail', detail: zh ? ('关卡地图无法解析：' + lastErr) : ('local map parse failed: ' + lastErr) }
      } catch (e) { return { status: 'fail', detail: (lang === 'zh' ? '关卡地图检查出错：' : 'local map check failed: ') + String((e && e.message) || e).slice(0, 200) } }
    }
    /** 关卡地图候选（与 matches() 数据模型同构）：根地图 .scratch/map.md + 各关子目录 .scratch/<name>/map.md。
     * 2026-08-29 实机修复：候选存【相对路径字符串】（供 dirname/basename 与 display），存在性经
     *   fileExistsChainRel(相对路径) 判定；绝不做 platform.path.join(resolve输出)（resolve 返回 target 对象，join 必 TypeError）。 */
    async function mdMapCandidates(platform, cwd) {
      const out = []
      try {
        if (!platform || !platform.fs || typeof platform.fs.resolve !== 'function') return out
        let dirT = null
        try { dirT = await platform.fs.resolve('.scratch', { cwd: cwd }) } catch (eR) { return out }
        if (await fileExistsChainRel(platform, cwd, '.scratch/map.md')) out.push('.scratch/map.md')
        if (typeof platform.fs.listDir === 'function') {
          try {
            const entries = await platform.fs.listDir(dirT)
            for (const e of entries) {
              const name = typeof e === 'string' ? e : (e && e.name) || ''
              if (!name || name.startsWith('.')) continue
              const candRel = '.scratch/' + name + '/map.md'
              if (await fileExistsChainRel(platform, cwd, candRel)) out.push(candRel)
            }
          } catch (eL) {}
        }
      } catch (e) {}
      return out
    }
    async function fileExistsChainRel(platform, cwd, rel) {
      try {
        if (!platform || !platform.fs || typeof platform.fs.resolve !== 'function') return null
        const abs = await platform.fs.resolve(rel, { cwd: cwd })
        if (typeof platform.fs.exists === 'function') return (await platform.fs.exists(abs)) === true
        if (typeof platform.fs.readText === 'function') { try { await platform.fs.readText(abs); return true } catch { return false } }
        if (typeof platform.fs.lstat === 'function') { try { const info = await platform.fs.lstat(abs); return !!info } catch { return false } }
        return null
      } catch (e) { return false }
    }


    // 检查 7/8 · 技能安装探测（#373 拍板：两态 —— 已安装/未安装；去掉不可靠的「挂载」判定：
    //   宿主级 skills 服务与「当前会话挂载」不是同一上下文，服务不可用时会误报「未挂载」）
    const SKILL_INSTALL_URL = 'https://github.com/mattpocock/skills'
    // v1.6：技能安装引导 prompt 已收编进 client PROMPTS 注册表（installSkills 条目）；hint 用 prompt: 键名协议（prompt:installSkills）由 client 取双语文本
    // 判装唯一尺度（#280）：只以 DSH 注册表回答为准 — 一行查询即定绿/红，B 语义（别处同名有效副本亦算已安装）
    // 绝不触盘：辅助文件轻探永不产生绿色（该纪律见 #281）
    // #281 红牌分拣与等待合同（第三、五条推论）：
    //   - 绿：注册表命中即绿；若非标准根，附来源路径一行（B 语义可视化）
    //   - 红：注册表未命中时，轻探目标根区分「缺失」与「名片无效」；轻探永不产生绿
    //   - 等待：skills 服务不可用时显式 pending，订阅失效广播后有界推进，封顶转失败并附原文
    const SKILL_PENDING_MAX = 3
    const SKILL_PENDING_HINT_PREFIX = 'pending:skills-unavailable'
    const skillPendingState = {}
    let _skillsInvalidateSub = null
    function getOrCreatePendingState(name) {
      const k = String(name || '')
      if (!skillPendingState[k]) skillPendingState[k] = { attempts: 0, lastError: null }
      return skillPendingState[k]
    }
    function resetSkillPendingState(name) {
      if (name) delete skillPendingState[String(name)]
      else for (const k in skillPendingState) delete skillPendingState[k]
    }
    // 失效广播的统一收口：探针计数 + 检测级联缓存（workspaceStore）一并失效，
    // 保证事件到达后下一步 wf.chain/wf.detect（无需 force）即全量重判——否则 detect 的 store 快照会冻住旧 skillProbes。
    function invalidateSkillProbeCaches() {
      resetSkillPendingState()
      // #284 修订（对抗式审查 2026-08-28）：链快照缓存一并失效——广播到达后【无 force】即全量重判（与 #281 断链回归一致）
      try { chainCache = { ts: 0, key: null, value: null } } catch {}
      try { getWorkspaceStore().then(function (ws) { try { ws.clear() } catch {} }).catch(function () {}) } catch {}
    }
    function ensureSkillsInvalidateSubscription() {
      if (_skillsInvalidateSub) return
      try {
        const skills = ctx.get('skills')
        if (!skills) return
        let off = null
        if (typeof skills.onDidInvalidate === 'function') {
          off = skills.onDidInvalidate(() => { invalidateSkillProbeCaches() })
          _skillsInvalidateSub = off
        } else if (typeof skills.on === 'function') {
          const handler = () => { invalidateSkillProbeCaches() }
          try { skills.on('invalidate', handler); _skillsInvalidateSub = () => { try { skills.off && skills.off('invalidate', handler) } catch {} } } catch {}
          if (!_skillsInvalidateSub) {
            try { skills.on('didInvalidate', handler); _skillsInvalidateSub = () => { try { skills.off && skills.off('didInvalidate', handler) } catch {} } } catch {}
          }
        } else if (typeof skills.subscribe === 'function') {
          try { off = skills.subscribe(() => { invalidateSkillProbeCaches() }); _skillsInvalidateSub = off } catch {}
        }
        if (_skillsInvalidateSub) {
          try { ctx.effect(() => () => { try { if (typeof _skillsInvalidateSub === 'function') _skillsInvalidateSub(); } catch {} _skillsInvalidateSub = null }) } catch {}
        }
      } catch {}
    }
    function isSkillCardValid(skillText, expectedName) {
      try {
        // #295 加固：先剥首个 UTF-8 BOM 再做 frontmatter 匹配——Windows 编辑器另存的 SKILL.md
        //   带隐形 BOM 前缀时 frontmatter 本身合法，此前被误判「名片无效 · frontmatter invalid」。
        //   仅剥离开头一个 BOM：非 BOM 输入逐字节透传（行为差集实测为空），name 精确匹配防冒名机制不变。
        const s = String(skillText || '').replace(/^\uFEFF/, '')
        const m = s.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
        if (!m) return false
        const front = m[1]
        const nameMatch = front.match(/^\s*name\s*:\s*["']?([^"'\r\n]+?)["']?\s*$/m)
        if (!nameMatch) return false
        const foundName = String(nameMatch[1] || '').trim()
        return foundName === String(expectedName || '').trim()
      } catch { return false }
    }
    // 路径存在性探测（path-shaped 纪律：lstat/exists 接受裸路径字符串；target-shaped 仅 readText/writeText 用 resolve 返回值）
    async function probeFsExists(curFs, platform, pathStr) {
      if (!pathStr) return false
      try {
        if (curFs && typeof curFs.lstat === 'function') {
          const info = await curFs.lstat(pathStr)
          if (info) return true
        }
      } catch {}
      try {
        if (platform && platform.fs && typeof platform.fs.lstat === 'function') {
          const info = await platform.fs.lstat(pathStr)
          if (info) return true
        }
      } catch {}
      try {
        if (platform && platform.fs && typeof platform.fs.exists === 'function') {
          const ok = await platform.fs.exists(pathStr)
          if (ok) return true
        }
      } catch {}
      return false
    }
    // #296 多通道并联探针（契约修订见 docs/adr/20260828-skill-probe-union-channels.md）：
    // 判装口径从「注册表唯一绿」修订为「任一通道有效即已安装」——修复协议（installSkills 提示词以
    // ~/.agents/skills 盘上齐全为成功）与检测口径必须用同一把尺；通道全空才红，红时附各通道判据。
    // 通道：REGISTRY（probeSkill 上游已查）· FS_USER/FS_PROJECT（DSH fs 服务读用户/项目标准根）
    //       · DIRECT（插件只读直读同一批候选根——#296 决策：只读、仅技能标准根，绕开工作区作用域限制）。
    // 纪律：轻探只读；直读仅在技能标准根使用，绝不写、绝不读其他路径；绿牌需名片合法（frontmatter name 匹配）。
    async function directSkillCardRead(absPath) {
      try {
        const mod = await import('node:fs/promises')
        const fsp = mod.default || mod
        return await fsp.readFile(absPath, 'utf8')
      } catch { return null }
    }
    // #296：直读存在性探测（只读；用于 .git 项目根识别的兜底——围栏环境 DSH fs 服务可能读不到祖目录）
    async function directPathExists(absPath) {
      try {
        const mod = await import('node:fs/promises')
        const fsp = mod.default || mod
        const st = await fsp.stat(absPath)
        return !!st
      } catch { return false }
    }
    async function findProjectRootDir(cwd, platform) {
      if (!cwd || !platform || !platform.path || typeof platform.path.join !== 'function' || typeof platform.path.dirname !== 'function') return null
      try {
        let cur = String(cwd)
        const curFs = ctx.get('fs')
        while (true) {
          const gitPath = platform.path.join(cur, '.git')
          if (await probeFsExists(curFs, platform, gitPath)) return cur
          if (await directPathExists(gitPath)) return cur
          const parent = platform.path.dirname(cur)
          if (parent === cur) return null
          cur = parent
        }
      } catch { return null }
    }
    // fs 服务通道探卡：返回 { result: 'valid'|'invalid'|'missing'|'unavailable', detail? }
    async function probeCardViaFs(curFs, platform, cardPath, dirPath, skillName) {
      let cardTarget = null
      try {
        if (curFs && typeof curFs.resolve === 'function') cardTarget = await curFs.resolve(cardPath)
        else cardTarget = cardPath
      } catch { cardTarget = null }
      if (cardTarget && curFs && typeof curFs.readText === 'function') {
        try {
          const content = await curFs.readText(cardTarget)
          if (isSkillCardValid(content, skillName)) return { result: 'valid' }
          return { result: 'invalid', detail: 'frontmatter invalid' }
        } catch (e) {
          const cardExists = await probeFsExists(curFs, platform, cardPath)
          if (cardExists) return { result: 'invalid', detail: 'SKILL.md unreadable' }
          const dirExists = await probeFsExists(curFs, platform, dirPath)
          if (dirExists) return { result: 'invalid', detail: 'SKILL.md missing' }
          return { result: 'missing' }
        }
      }
      return { result: 'unavailable', detail: 'fs probe unavailable' }
    }
    // 直读通道探卡：只读、仅标准技能根；readFile 失败一律视为未找到（证据留给其他通道分类）
    async function probeCardViaDirect(cardPath, skillName) {
      try {
        const content = await directSkillCardRead(cardPath)
        if (content == null) return { result: 'missing' }
        if (isSkillCardValid(content, skillName)) return { result: 'valid' }
        return { result: 'invalid', detail: 'frontmatter invalid' }
      } catch { return { result: 'missing' } }
    }
    function evidenceSummary(channels, lang) {
      if (!channels || !channels.length) return ''
      const stOf = function (c) { return c.result === 'valid' ? '命中' : (c.result === 'invalid' ? '无效' : (c.result === 'missing' ? '未找到' : String(c.result || '?'))) }
      // 按通道分组：同通道结果一致 → 合并成一条（如 fs=未找到×4）；不一致才逐条展开（人读优先，横幅不刷屏）
      const byChan = {}
      for (let i = 0; i < channels.length; i++) {
        const c = channels[i]
        const key = String(c.channel || '?')
        if (!byChan[key]) byChan[key] = []
        byChan[key].push(c)
      }
      const parts = []
      for (const key of Object.keys(byChan)) {
        const list = byChan[key]
        const label = (key === 'registry') ? 'registry' : key
        const uniq = []
        for (let i = 0; i < list.length; i++) { const s = stOf(list[i]); if (uniq.indexOf(s) < 0) uniq.push(s) }
        if (uniq.length === 1) {
          parts.push(label + '=' + uniq[0] + (list.length > 1 ? ('×' + list.length) : ''))
        } else {
          for (let i = 0; i < list.length; i++) parts.push(label + ':' + list[i].root + '=' + stOf(list[i]))
        }
      }
      return (lang === 'en') ? ('; probed: ' + parts.join(', ')) : ('；已查：' + parts.join('，'))
    }
    async function lightProbeReason(skillName, lang, cwd) {
      const curFs = ctx.get('fs')
      let platform = null
      try { platform = await getPlatform() } catch {}
      if (!platform) {
        return { kind: 'missing', detail: (lang === 'en') ? 'Not installed' : '未安装', hint: 'prompt:installSkills', channels: [{ channel: 'fs', root: 'user-agents', result: 'unavailable', detail: 'platform unavailable' }] }
      }
      let home = null
      try { home = await platform.getHome() } catch {}
      if (!home) {
        return { kind: 'missing', detail: (lang === 'en') ? 'Not installed' : '未安装', hint: 'prompt:installSkills', channels: [] }
      }
      // 候选根：用户标准根（.agents/skills 优先，.dsh/skills 次之）+ 项目根（.dsh/skills + .agents/skills）
      const candidates = [
        { label: 'user', root: 'user-agents', dir: platform.path.join(home, '.agents', 'skills', skillName) },
        { label: 'user', root: 'user-dsh', dir: platform.path.join(home, '.dsh', 'skills', skillName) },
      ]
      try {
        const projRoot = cwd ? await findProjectRootDir(cwd, platform) : null
        if (projRoot) {
          candidates.push({ label: 'project', root: 'project-dsh', dir: platform.path.join(projRoot, '.dsh', 'skills', skillName) })
          candidates.push({ label: 'project', root: 'project-agents', dir: platform.path.join(projRoot, '.agents', 'skills', skillName) })
        }
      } catch {}
      const channels = []
      let validHit = null
      let invalidSeen = false
      // ① fs 服务通道（DSH 沙箱 fs——现行构建读穿透；旧环境可能受工作区作用域限制，由 ② 顶替）
      for (let i = 0; i < candidates.length && !validHit; i++) {
        const cand = candidates[i]
        const cardPath = platform.path.join(cand.dir, 'SKILL.md')
        const r = await probeCardViaFs(curFs, platform, cardPath, cand.dir, skillName)
        channels.push({ channel: 'fs', root: cand.root, path: cardPath, result: r.result, detail: r.detail || '' })
        if (r.result === 'valid') validHit = { path: cardPath, dir: cand.dir, via: 'fs:' + cand.root }
        else if (r.result === 'invalid') invalidSeen = true
      }
      // ② 直读通道（插件只读直读——不经过 DSH fs 服务，绕开工作区作用域限制；仅技能标准根）
      if (!validHit) {
        for (let i = 0; i < candidates.length && !validHit; i++) {
          const cand = candidates[i]
          const cardPath = platform.path.join(cand.dir, 'SKILL.md')
          const r = await probeCardViaDirect(cardPath, skillName)
          channels.push({ channel: 'direct', root: cand.root, path: cardPath, result: r.result, detail: r.detail || '' })
          if (r.result === 'valid') validHit = { path: cardPath, dir: cand.dir, via: 'direct:' + cand.root }
          else if (r.result === 'invalid') invalidSeen = true
        }
      }
      if (validHit) {
        // 新契约：任一通道命中合法名片即已安装（附来源 + 注册表未收录的如实注记）
        return { kind: 'ok', detail: (lang === 'en') ? 'Installed' : '已安装', hint: '', sourcePath: validHit.path, via: validHit.via, registryMiss: true, channels }
      }
      if (invalidSeen) {
        return { kind: 'invalid', detail: (lang === 'en') ? 'Invalid skill card' : '名片无效', hint: 'prompt:installSkills', channels }
      }
      return { kind: 'missing', detail: (lang === 'en') ? 'Not installed (missing)' : '未安装（缺失）', hint: 'prompt:installSkills', channels }
    }
    async function probeSkill(skillName, lang, cwd) {
      try { ensureSkillsInvalidateSubscription() } catch {}
      const skills = ctx.get('skills')
      let found = null
      let foundPath = null
      let skillsError = null
      if (skills !== undefined && skills !== null) {
        try {
          const res = await skills.get(skillName, cwd ? { cwd } : undefined)
          if (res) {
            found = res
            if (typeof res === 'object') {
              foundPath = res.path || res.dir || res.location || res.file || res.uri || res.source || null
              if (!foundPath && res.metadata && typeof res.metadata === 'object') foundPath = res.metadata.path || null
            } else if (typeof res === 'string') {
              foundPath = res
            }
          }
        } catch (e) {
          skillsError = String((e && e.message) || e || 'skills.get failed')
        }
      } else {
        skillsError = 'skills service unavailable'
      }
      if (found) {
        let detail = (lang === 'en') ? 'Installed' : '已安装'
        let hint = ''
        let isOffRoot = false
        if (foundPath) {
          try {
            const plat = await getPlatform()
            const home = await plat.getHome()
            if (home) {
              const standard = plat.path.join(home, '.agents', 'skills', skillName)
              const normFoundRaw = String(foundPath)
              const normStd = plat.path.normalize(String(standard))
              const normFound = plat.path.normalize(normFoundRaw)
              let cmpFound = normFound
              let cmpStd = normStd
              if (plat.os === 'win32') { cmpFound = cmpFound.toLowerCase(); cmpStd = cmpStd.toLowerCase() }
              let foundDir = cmpFound
              try {
                if (foundDir.toLowerCase().endsWith('skill.md')) foundDir = plat.path.dirname(foundDir)
                if (foundDir.length > 1 && (foundDir.endsWith('/') || foundDir.endsWith('\\'))) foundDir = foundDir.slice(0, -1)
              } catch {}
              let stdDir = cmpStd
              try { if (stdDir.length > 1 && (stdDir.endsWith('/') || stdDir.endsWith('\\'))) stdDir = stdDir.slice(0, -1) } catch {}
              isOffRoot = foundDir !== stdDir
            } else {
              isOffRoot = true
            }
          } catch { isOffRoot = false }
        }
        if (isOffRoot && foundPath) {
          const srcLine = (lang === 'en') ? ' (source: ' + foundPath + ')' : '（来源：' + foundPath + '）'
          detail = detail + srcLine
        }
        try { resetSkillPendingState(skillName) } catch {}
        return { ok: true, level: 'ok', detail, hint, sourcePath: foundPath || undefined, repo: null, channels: [{ channel: 'registry', root: 'registry', result: 'hit', detail: foundPath || '' }] }
      }
      if (skillsError) {
        const st = getOrCreatePendingState(skillName)
        st.attempts += 1
        st.lastError = skillsError
        if (st.attempts <= SKILL_PENDING_MAX) {
          return { ok: false, level: 'pending', detail: (lang === 'en') ? 'Waiting for skills service... (' + st.attempts + '/' + SKILL_PENDING_MAX + ')' : '等待技能服务就绪…（' + st.attempts + '/' + SKILL_PENDING_MAX + '）', hint: SKILL_PENDING_HINT_PREFIX + ':' + st.attempts, repo: null, pending: true, attempts: st.attempts, maxAttempts: SKILL_PENDING_MAX, error: skillsError }
        } else {
          return { ok: false, level: 'bad', detail: (lang === 'en') ? 'Skills service unavailable: ' + skillsError : '技能服务不可用：' + skillsError, hint: 'prompt:installSkills', repo: null, error: skillsError }
        }
      }
      const reason = await lightProbeReason(skillName, lang, cwd)
      try { resetSkillPendingState(skillName) } catch {}
      const allCh = [{ channel: 'registry', root: 'registry', result: 'miss', detail: '' }].concat(reason.channels || [])
      const ev = evidenceSummary(allCh, lang)
      if (reason.kind === 'ok') {
        // #296 新契约：注册表未收录但任一通道命中合法名片 → 按盘上事实判已安装（附来源与如实注记）
        const srcLine = reason.sourcePath ? ((lang === 'en') ? ' (source: ' + reason.sourcePath + ')' : '（来源：' + reason.sourcePath + '）') : ''
        const regNote = (lang === 'en') ? ' (DSH catalog miss; judged by disk facts)' : '（DSH 技能清单未收录，按盘上事实判定）'
        return { ok: true, level: 'ok', detail: reason.detail + srcLine + regNote, hint: '', sourcePath: reason.sourcePath || undefined, repo: null, via: reason.via, channels: allCh }
      }
      if (reason.kind === 'invalid') {
        return { ok: false, level: 'bad', detail: reason.detail + ev, hint: reason.hint, repo: null, reason: 'invalid', channels: allCh }
      }
      return { ok: false, level: 'bad', detail: reason.detail + ev, hint: reason.hint, repo: null, reason: 'missing', channels: allCh }
    }

    // ============ RPC（#152 · 探测编排：wf.detect 新 RPC + wf.chain 检查链快照）============
    // 第一性原理：前端只调 wf.detect/wf.chain 拿 DetectionResult（#150 Q1）；探测零 OS 直碰经 platform；
    // per-workspace 按 handleKey=cwd|refId 内存 Map 不落盘（Q3）；pending 不缓存（Q6）；唯一写路径 wf.bind→registry.bind（Q4）
    harness.handle('wf.detect', async function (args) {
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
    })

    // #228/#284 链渲染器主机侧：通用链 + 当前后端链求值快照（契约层纯函数求值，谓词只读探测，失败返回不抛，超时 pending）
    // #284 增强：backend 谓词由 host 既有探测包装注册（repoRemote/repoAccess/ghAuth/mdParseOk），后端链不再只是声明。
    // #284 修订（对抗式审查 2026-08-28）：30s per(cwd+backendId+lang) 缓存——面板多组件挂载不再重复 25 名技能探测与 gh 网络调用；
    //   等待计数只随真实探针轮次（force）推进，不被 UI 刷新次数偷换。
    let chainCache = { ts: 0, key: null, value: null }
    const CHAIN_CACHE_MS = 30000
    harness.handle('wf.chain', async function (args) {
      const cwd = await canonicalKey((args && args.cwd) || DEFAULT_CWD)
      const force = !!(args && args.force)
      const chainLang = (args && args.lang === 'en') ? 'en' : 'zh'
      if (force) resetGhCache()
      try{
        // 缓存命中（force 绕过；探测 pending 结果不缓存——与旧 statusCache 同纪律）
        const cacheKey = cwd + '|' + String(args && args.backendId || '') + '|' + chainLang
        if (!force && chainCache.value && chainCache.key === cacheKey && Date.now() - chainCache.ts < CHAIN_CACHE_MS) {
          return chainCache.value
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
        const predMod = await import('./tracker/predicateRegistry.js')
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
            const chainMod = await import('../shared/tracker/chain.js')
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
          const chainMod3 = await import('../shared/tracker/chain.js')
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
        if (!chainNotAllDone) chainCache = { ts: Date.now(), key: cacheKey, value: result }
        return result
      }catch(e){
        return { ok: false, error: String((e && e.message)||e) }
      }
    })
    harness.handle('wf.ping', async function () {
      return { ok: true, ts: Date.now() }
    })

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

    harness.handle('wf.cwd', async function (args) {
      const sid = args && args.sessionId
      if (!sid) return { ok: false, error: '缺少 sessionId' }
      const sessions = ctx.get('sessions')
      if (sessions === undefined || typeof sessions.get !== 'function') return { ok: false, error: 'sessions 服务不可用' }
      try {
        const s = sessions.get(sid)
        // 现代 DSH 的 Session 结构：header.cwd 为权威；兼容旧 meta / 直接 cwd 字段
        const header = s && (s.header || s.meta)
        const cwd = header && (header.cwd || header.path || header.worktree || header.projectDir || header.directory)
        if (typeof cwd === 'string' && cwd) return { ok: true, cwd: cwd }
        const meta = s && s.meta
        const cwd2 = meta && (meta.cwd || meta.path || meta.worktree || meta.projectDir || meta.directory)
        if (typeof cwd2 === 'string' && cwd2) return { ok: true, cwd: cwd2 }
        if (s && typeof s.cwd === 'string' && s.cwd) return { ok: true, cwd: s.cwd }
        return { ok: false, error: '会话无 cwd 信息' }
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
    })

    // #179 回切自愈：空 cwd 仍兜 DEFAULT_CWD 作最后兜底（避免“没有仓库”空白），但客户端已保证同 sid 切工作区亦触发，空窗极短
    harness.handle('wf.snapshot', async function (args) {
      const cwd = await canonicalKey((args && args.cwd) || DEFAULT_CWD)
      const now = Date.now()
      // 第一性原理分发前置：先算 selection，再决定缓存与数据链路（避免旧 GitHub 缓存遮住 Markdown）
      let _selEarly = null
      try {
        const svc = await getDetectionService()
        if (svc && typeof svc.detect === 'function') {
          const det = await svc.detect({ cwd }, { skipSkillProbes: true, hintBackendId: (args && args.backendId) || undefined })
          if (det && det.selection) _selEarly = det.selection
        }
      } catch {}
      if (!_selEarly || (_selEarly.backendId == null && (!_selEarly.source || _selEarly.source !== 'explicit'))) {
        try {
          const regTmp = await getTrackerRegistry()
          const tmpHandle = { cwd }
          const tmpCtx = { cwd, platform: await getPlatform(), fs: ctx.get('fs') }
          const sel2 = await regTmp.select(tmpHandle, tmpCtx)
          if (sel2) _selEarly = sel2
        } catch {}
      }
      const useComposerEarly = _selEarly && _selEarly.backendId && _selEarly.backendId !== 'github' && _selEarly.backendId !== '' && _selEarly.backendId !== 'other'
      const isForce = !!(args && args.force)
      if (!isForce && cache.snapshot && cache.cwd === cwd) {
        // GitHub 路径才用 issue 索引校验；Markdown 等走通用缓存时只看时间与 backend 是否一致
        // 权威动作 force 必须无条件重建，不走此短路（P2 要求）
        if (useComposerEarly) {
          const cachedBackend = cache.snapshot.selection && cache.snapshot.selection.backendId
          if (cachedBackend === _selEarly.backendId && now - cache.ts < CACHE_MS) return cache.snapshot
        } else {
          const current = await cacheSnapshotIsCurrent(cache.snapshot, cwd)
          if (current === true || (current === null && now - cache.ts < CACHE_MS)) return cache.snapshot
        }
      }
      try {
        // 复用已算的 selection，避免二次探测
        let _sel = _selEarly
        if (!_sel) {
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
        }
        const useComposer = _sel && _sel.backendId && _sel.backendId !== 'github' && _sel.backendId !== '' && _sel.backendId !== 'other'
        if (useComposer) {
          const reg = await getTrackerRegistry()
          const backendId = _sel.backendId
          const tracker = reg.get(backendId)
          if (!tracker) throw new Error('unknown backend ' + backendId)
          let repoRef = null
          try { repoRef = reg.describe({ cwd }, backendId) } catch {}
          if (!repoRef) repoRef = { backend: backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || backendId, url: '' }
          const ctx2 = { cwd, platform: await getPlatform(), fs: ctx.get('fs'), exec: detectionExec }
          const { createSnapshotComposer } = await import('./tracker/snapshot.js')
          const composer = createSnapshotComposer(reg, { snapshotTtl: 5000 })
          const res = await composer.composeSnapshot(backendId, repoRef, ctx2, { ifNoneMatch: (args && (args.ifNoneMatch || args.version)) || '', force: !!(args && args.force) })
          if (!res.ok) throw new Error((res.error && res.error.message) || 'composeSnapshot failed')
                    const inner = upcaseSnapStates(res.snapshot)
          const flatTickets = (inner.maps || []).flatMap(function(m){ return (m.tickets || []); })
          const allForList = []
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
              t.blockedBy = t.blockedBy.map(function(ref){
                if (typeof ref === 'number') return ref
                if (ref && typeof ref === 'object' && ref.key != null) {
                  const nk = String(ref.key)
                  const nn = parseInt(nk, 10)
                  if (!isNaN(nn)) return nn
                  return nk
                }
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
          // B: 补全调色盘全量（文件约束内满足契约：triage 表即全量表，未用标签也常驻，色取默认表；已用标签的色已在 labels 中为票面最终色）
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
          const snap = {
            ok: true,
            repo: null,
            repoRoot: repoRoot,
            updatedAt: new Date().toISOString(),
            generatedMs: Date.now(),
            env: { ghPath: ghPath, ghError: ghLastError },
            maps: inner.maps,
            issues: allForList,
            labels: labels,
            repository: repoRef,
            backendModules: backendModules,
            selection: _sel,
            capabilities: null,
            viewer: null,
            viewerLogin: null,
            deck: inner.deck,
          }
          return adoptSnapshot(snap, cwd)
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
          const snap = {
            ok: true,
            repo: null,
            repoRoot,
            updatedAt: new Date().toISOString(),
            generatedMs: Date.now(),
            env: { ghPath, ghError: ghLastError },
            maps: [],
            issues: [],
            labels: [],
            repository: null,
            backendModules,
            selection: _sel,
            capabilities: null,
            viewer: null,
            viewerLogin: null,
            deck: { total:0, open:0, closed:0, frontier:0, claimed:0, blocked:0, indeterminate:0, levels:[], levelOf:{} },
          }
          return adoptSnapshot(snap, cwd)
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
            const snapNoRepo = {
              ok: true,
              repo: null,
              repoRoot: repoRootNoRepo,
              updatedAt: new Date().toISOString(),
              generatedMs: Date.now(),
              env: { ghPath, ghError: ghLastError },
              maps: [],
              issues: [],
              labels: [],
              repository: null,
              backendModules: backendModulesNoRepo,
              selection: _selNoRepo,
              capabilities: null,
              viewer: null,
              viewerLogin: null,
              deck: { total:0, open:0, closed:0, frontier:0, claimed:0, blocked:0, indeterminate:0, levels:[], levelOf:{} },
            }
            return adoptSnapshot(snapNoRepo, cwd)
          }
        }
        const repo0b = await getRepoKey(cwd)
        const diskb = await readDiskCache(repo0b)
        if (diskb && diskb.selection && diskb.selection.backendId === backendId2) {
          const currentb = await cacheSnapshotIsCurrent(diskb, cwd)
          if (currentb !== false) return adoptSnapshot(Object.assign({}, diskb, { fromCache: true }), cwd)
        }
        const ctx2b = { cwd, platform: await getPlatform(), fs: ctx.get('fs'), exec: detectionExec }
        const { createSnapshotComposer: createComposer2 } = await import('./tracker/snapshot.js')
        const composer2 = createComposer2(reg2, { snapshotTtl: 5000 })
        const res2 = await composer2.composeSnapshot(backendId2, repoRef2, ctx2b, { ifNoneMatch: (args && (args.ifNoneMatch || args.version)) || '', force: !!(args && args.force) })
        if (!res2.ok) throw new Error((res2.error && res2.error.message) || 'composeSnapshot failed')
                  const inner2 = upcaseSnapStates(res2.snapshot)
        ;(inner2.maps || []).forEach(function(m){ 
          if (m.number == null && m.key != null) { const nn = parseInt(m.key,10); if(!isNaN(nn)) m.number = nn; }
          try {
            const tickets = m.tickets || []
            // 补 number（GitHub 仅有 key，UI 用 number 展示）
            tickets.forEach(function(t){ if(t && t.key != null && t.number == null){ const nn=parseInt(t.key,10); if(!isNaN(nn)) t.number=nn; if(t.key!=null) t.key=String(t.key) } })
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
        const snap2 = {
          ok: true,
          repo: repo0b,
          repoRoot: repoRoot2,
          updatedAt: new Date().toISOString(),
          generatedMs: Date.now(),
          env: { ghPath, ghError: ghLastError },
          maps: inner2.maps,
          issues: allForList2,
          labels: labels2,
          repository: repoRef2,
          backendModules: backendModules2,
          selection: _sel,
          capabilities: null,
          viewer: viewer2,
          viewerLogin: viewerLogin2,
          deck: inner2.deck,
        }
        await writeDiskCache(snap2.repo, snap2)
        return adoptSnapshot(snap2, cwd)
      } catch (e) {
        cache = { ts: Date.now(), snapshot: null, error: errText(e), cwd: cwd }
        return { ok: false, error: errText(e), env: { ghError: ghLastError } }
      }
    })

    harness.handle('wf.refresh', async function (args) {
      const cwd = (args && args.cwd) || DEFAULT_CWD
      // #195 修复：用户主动刷新时清空 gh 解析缓存，强制重探
      resetGhCache()
      try {
        // 第一性原理分发：与 wf.snapshot 同构
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
        const useComposer = _sel && _sel.backendId && _sel.backendId !== 'github' && _sel.backendId !== '' && _sel.backendId !== 'other'
        if (useComposer) {
          const reg = await getTrackerRegistry()
          const backendId = _sel.backendId
          const tracker = reg.get(backendId)
          if (!tracker) throw new Error('unknown backend ' + backendId)
          let repoRef = null
          try { repoRef = reg.describe({ cwd }, backendId) } catch {}
          if (!repoRef) repoRef = { backend: backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || backendId, url: '' }
          const ctx2 = { cwd, platform: await getPlatform(), fs: ctx.get('fs'), exec: detectionExec }
          const { createSnapshotComposer } = await import('./tracker/snapshot.js')
          const composer = createSnapshotComposer(reg, { snapshotTtl: 5000 })
          const res = await composer.composeSnapshot(backendId, repoRef, ctx2, { ifNoneMatch: (args && (args.ifNoneMatch || args.version)) || '', force: true })
          if (!res.ok) throw new Error((res.error && res.error.message) || 'composeSnapshot failed')
                    const inner = upcaseSnapStates(res.snapshot)
          const flatTickets = (inner.maps || []).flatMap(function(m){ return (m.tickets || []); })
          const allForList = []
          ;(inner.maps || []).forEach(function(m){
            if (m.key != null && m.number == null) {
              const n = parseInt(m.key, 10)
              if (!isNaN(n)) m.number = n
            }
            if (m.key != null) m.key = String(m.key)
            try {
              const tickets = m.tickets || []
              const lvInfo = (typeof computeLevels === 'function') ? computeLevels(tickets) : { byNumber: {} }
              tickets.forEach(function(t){ 
                if (t.number != null && lvInfo.byNumber && lvInfo.byNumber[t.number] != null) t.level = lvInfo.byNumber[t.number]
                else if (t.key != null && lvInfo.byKey && lvInfo.byKey[t.key] != null) t.level = lvInfo.byKey[t.key]
              })
              const stats = (typeof groupTickets === 'function') ? groupTickets(tickets) : { total: tickets.length, open: tickets.filter(function(x){return x.state!=='CLOSED'}).length, closed: tickets.filter(function(x){return x.state==='CLOSED'}).length, frontier:0, claimed:0, blocked:0, levels:[], levelOf:{} }
              m.stats = stats
            } catch {}
            allForList.push(m)
          })
          flatTickets.forEach(function(t){
            if (t.key != null && t.number == null) {
              const n = parseInt(t.key, 10)
              if (!isNaN(n)) t.number = n
            }
            if (t.key != null) t.key = String(t.key)
            if (Array.isArray(t.blockedBy)) {
              t.blockedBy = t.blockedBy.map(function(ref){
                if (typeof ref === 'number') return ref
                if (ref && typeof ref === 'object' && ref.key != null) {
                  const nk = String(ref.key)
                  const nn = parseInt(nk, 10)
                  if (!isNaN(nn)) return nn
                  return nk
                }
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
          // B: 补全调色盘全量（文件约束内满足契约：triage 表即全量表，未用标签也常驻，色取默认表；已用标签的色已在 labels 中为票面最终色）
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
          const snap = {
            ok: true,
            repo: null,
            repoRoot: repoRoot,
            updatedAt: new Date().toISOString(),
            generatedMs: Date.now(),
            env: { ghPath: ghPath, ghError: ghLastError },
            maps: inner.maps,
            issues: allForList,
            labels: labels,
            repository: repoRef,
            backendModules: backendModules,
            selection: _sel,
            capabilities: null,
            viewer: null,
            viewerLogin: null,
            deck: inner.deck,
          }
          return adoptSnapshot(snap, cwd)
        }
        // 统一走编排器（所有后端）
        if (!_sel || !_sel.backendId) {
          const repoRoot = await getRepoRoot(cwd)
          let backendModules = null
          try {
            const regM = await getTrackerRegistry()
            if (regM && typeof regM.modules === 'function') {
              backendModules = regM.modules().map(function(m){ return Object.assign({id:m.id,label:m.label,presentation:m.presentation}, m.links?{links:m.links}:{}, m.capabilities?{capabilities:m.capabilities}:{}, m.prompts?{prompts:m.prompts}:{}, m.setupPrompt?{setupPrompt:m.setupPrompt}:{}, m.labelPalette?{labelPalette:m.labelPalette}:{}, m.openRepository?{openRepository:m.openRepository}:{}) })
            }
          } catch {}
          const snap = {
            ok: true,
            repo: null,
            repoRoot,
            updatedAt: new Date().toISOString(),
            generatedMs: Date.now(),
            env: { ghPath, ghError: ghLastError },
            maps: [],
            issues: [],
            labels: [],
            repository: null,
            backendModules,
            selection: _sel,
            capabilities: null,
            viewer: null,
            viewerLogin: null,
            deck: { total:0, open:0, closed:0, frontier:0, claimed:0, blocked:0, indeterminate:0, levels:[], levelOf:{} },
          }
          return adoptSnapshot(snap, cwd)
        }
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
            const snapNoRepo = {
              ok: true,
              repo: null,
              repoRoot: repoRootNoRepo,
              updatedAt: new Date().toISOString(),
              generatedMs: Date.now(),
              env: { ghPath, ghError: ghLastError },
              maps: [],
              issues: [],
              labels: [],
              repository: null,
              backendModules: backendModulesNoRepo,
              selection: _selNoRepo,
              capabilities: null,
              viewer: null,
              viewerLogin: null,
              deck: { total:0, open:0, closed:0, frontier:0, claimed:0, blocked:0, indeterminate:0, levels:[], levelOf:{} },
            }
            return adoptSnapshot(snapNoRepo, cwd)
          }
        }
        const repo0b = await getRepoKey(cwd)
        // #366 fix: wf.refresh must bypass disk cache short-circuit (force rebuild with fresh generatedMs)
        void 0;
        const ctx2b = { cwd, platform: await getPlatform(), fs: ctx.get('fs'), exec: detectionExec }
        const { createSnapshotComposer: createComposer2 } = await import('./tracker/snapshot.js')
        const composer2 = createComposer2(reg2, { snapshotTtl: 5000 })
        const res2 = await composer2.composeSnapshot(backendId2, repoRef2, ctx2b, { ifNoneMatch: (args && (args.ifNoneMatch || args.version)) || '', force: true })
        if (!res2.ok) throw new Error((res2.error && res2.error.message) || 'composeSnapshot failed')
                  const inner2 = upcaseSnapStates(res2.snapshot)
        ;(inner2.maps || []).forEach(function(m){ 
          if (m.number == null && m.key != null) { const nn = parseInt(m.key,10); if(!isNaN(nn)) m.number = nn; }
          try {
            const tickets = m.tickets || []
            // 补 number（GitHub 仅有 key，UI 用 number 展示）
            tickets.forEach(function(t){ if(t && t.key != null && t.number == null){ const nn=parseInt(t.key,10); if(!isNaN(nn)) t.number=nn; if(t.key!=null) t.key=String(t.key) } })
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
        const snap2 = {
          ok: true,
          repo: repo0b,
          repoRoot: repoRoot2,
          updatedAt: new Date().toISOString(),
          generatedMs: Date.now(),
          env: { ghPath, ghError: ghLastError },
          maps: inner2.maps,
          issues: allForList2,
          labels: labels2,
          repository: repoRef2,
          backendModules: backendModules2,
          selection: _sel,
          capabilities: null,
          viewer: viewer2,
          viewerLogin: viewerLogin2,
          deck: inner2.deck,
        }
        await writeDiskCache(snap2.repo, snap2)
        return adoptSnapshot(snap2, cwd)
      } catch (e) {
        cache = { ts: Date.now(), snapshot: null, error: errText(e), cwd: cwd }
        return { ok: false, error: errText(e) }
      }
    })

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