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
 *   5. 前置检查绿点（#344）：wf.status —— 8 项检测（仓库定位 / setup 已跑 / tracker=GitHub /
 *      gh CLI / gh 登录 / API 可达 / wayfinder 双层探测 / ask-matt 双层探测），输出
 *      { ok, level, detail, hint }[]；结果缓存 30s，args.force 强制重查。
 *
 * 已验证（.charting/verify.js，真实数据 PASS）：分组 frontier/claimed/blocked 与 GitHub 页面一致；
 * 9 张 open map 中仅 4 张有 Destination —— body 解析全部容错。
 *
 * 本文件内容 = cordis_define 的 code.host（纯 JS 函数体，返回 Cordis Plugin）。
 */
return {
  apply(ctx) {
    const subprocess = ctx.get('subprocess')
    const timer = ctx.get('timer')
    const fs = ctx.get('fs')
    if (subprocess === undefined || timer === undefined) return

    // ============ 配置 ============
    // v1.5.0（公共发布）：兜底 gh 路径 = 环境变量 DSH_GH_PATH（官方安装会加入 PATH，无需配置；非常规安装可用环境变量指定）
    const GH_FALLBACK = (typeof process !== 'undefined' && process.env && process.env.DSH_GH_PATH) ? process.env.DSH_GH_PATH : ''
    // 默认工作区 = DSH 进程当前目录（可被 wf.snapshot args.cwd 覆盖；去本机硬编码）
    const DEFAULT_CWD = (typeof process !== 'undefined' && typeof process.cwd === 'function') ? process.cwd() : ''
    const TIMEOUT_MS = 30000
    // v1.3.3 提速：快照缓存 5s → 60s（面板打开基本命中缓存，不再每次全量重建 11 次 gh 调用）
    const CACHE_MS = 60000
    const STATUS_CACHE_MS = 30000  // 前置检查结果缓存（#344）
    const SKILL_PROBE_DIRS = ['.agents\\skills', '.minimax\\skills', '.claude\\skills']  // 技能文件层探测目录（相对用户主目录）
    // v1.5 T11：全流程核心技能探测名单（各动作 prompt 引用的技能 + 基础技能；检查 7/8 取前两个，检查 9 聚合全量）
    const SKILL_PROBE_NAMES = ['wayfinder', 'triage', 'grilling', 'grill-me', 'implement', 'ask-matt', 'research', 'prototype', 'handoff']
    const QUERY = 'query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){issue(number:$n){number title state body url labels(first:20){nodes{name}} subIssues(first:100){totalCount nodes{number title state body url labels(first:10){nodes{name}} assignees(first:10){nodes{login}} blockedBy(first:20){nodes{number title state}} }}}}}'

    // ============ 状态 ============
    let ghPath = null
    let ghPathError = null
    let repoKeys = {}  // v12：repoKey 按 cwd 缓存（切换仓库会话时不再串仓库）
    let cache = { ts: 0, snapshot: null, error: null, cwd: null }
    let statusCache = { ts: 0, status: null, error: null, cwd: null, lang: null }  // wf.status 30s 缓存（按 cwd+lang 区分）
    let userHome = null                                     // 用户主目录（cmd 探测，缓存）
    let lastProbeAtByRepo = {}                            // v1.5 R2 + R2-fix-6（#2 MVP）：probe since 时间戳，按 repoKey 隔离（只在 probe 检测到 change 时推进；build 不得动它 —— 否则会吞掉同窗口编辑，见 buildSnapshot 处注释）
    let lastIssueIndexByRepo = {}                          // #2 deletion fix：保存上次全量 issue 索引，用于发现 GitHub 删除/状态消失

    // ============ gh 封装 ============
    async function resolveGh() {
      if (ghPath) return ghPath
      if (ghPathError) return null
      try {
        ghPath = await subprocess.resolveExecutable('gh')
      } catch (e) {
        // 兜底：fs.lstat 对不存在路径返回 undefined（不抛错），须判真值（#344 修正）
        let info = null
        try {
          if (fs !== undefined) info = await fs.lstat(GH_FALLBACK)
          else ghPathError = 'gh 不可用：PATH 无 gh 且 fs 服务不可用'
        } catch (e2) {
          info = null
        }
        if (info) ghPath = GH_FALLBACK
        else ghPathError = 'gh 不可用：PATH 无 gh，且 DSH_GH_PATH 未配置（官方安装请访问 https://cli.github.com/）'
      }
      return ghPath
    }

    async function runGh(args, cwd) {
      const exe = await resolveGh()
      if (!exe) return { ok: false, kind: 'env', error: ghPathError }
      let handle
      try {
        handle = subprocess.spawn({
          argv: [exe].concat(args),
          cwd: cwd || DEFAULT_CWD,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 4 * 1024 * 1024 }, stderr: { maxBytes: 256 * 1024 } },
          graceMs: 2000,
        })
      } catch (e) {
        return { ok: false, kind: 'spawn', error: String((e && e.message) || e) }
      }
      const to = timer.timeout(TIMEOUT_MS)
      let outcome
      try {
        outcome = await Promise.race([
          handle.done,
          to.then(function () { handle.terminate(); return { exitCode: -1, signal: 'timeout' } }),
        ])
      } catch (e) {
        return { ok: false, kind: 'spawn', error: String((e && e.message) || e) }
      }
      const out = (handle.collected && handle.collected.stdout) ? handle.collected.stdout.readFrom(0) : { text: '' }
      const err = (handle.collected && handle.collected.stderr) ? handle.collected.stderr.readFrom(0) : { text: '' }
      const all = (err.text || '') + (out.text || '')
      if (outcome.exitCode !== 0) {
        let kind = 'exit'
        const t = all.toLowerCase()
        if (/not logged in|auth failed|bad credentials/i.test(t)) kind = 'auth'
        else if (/404|not found|could not resolve to an? (issue|pull request)/i.test(t)) kind = 'notfound'
        else if (/network|econn|unexpected eof|timed out|connect/i.test(t)) kind = 'network'
        return { ok: false, kind: kind, code: outcome.exitCode, error: all.slice(0, 400) }
      }
      return { ok: true, text: out.text || '' }
    }

    // 通用进程执行（#344 前置检查用：git / cmd 等，不经 shell，错误不归一化）
    async function execProc(argv, cwd) {
      let handle
      try {
        handle = subprocess.spawn({
          argv: argv,
          cwd: cwd || DEFAULT_CWD,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 * 1024 }, stderr: { maxBytes: 256 * 1024 } },
          graceMs: 2000,
        })
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
      const to = timer.timeout(TIMEOUT_MS)
      let outcome
      try {
        outcome = await Promise.race([
          handle.done,
          to.then(function () { handle.terminate(); return { exitCode: -1, signal: 'timeout' } }),
        ])
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
      const out = (handle.collected && handle.collected.stdout) ? handle.collected.stdout.readFrom(0) : { text: '' }
      const err = (handle.collected && handle.collected.stderr) ? handle.collected.stderr.readFrom(0) : { text: '' }
      if (outcome.exitCode !== 0) return { ok: false, code: outcome.exitCode, error: ((err.text || '') + (out.text || '')).slice(0, 400) }
      return { ok: true, text: out.text || '' }
    }

    async function resolveGit() {
      try { return await subprocess.resolveExecutable('git') } catch (e) { return null }
    }

    // 用户主目录（Windows 实测 cmd.exe 恒在；POSIX 可走 sh -c 'echo $HOME'，本插件以 Windows 为主）
    async function getHome() {
      if (userHome !== null) return userHome
      userHome = null
      try {
        const cmd = await subprocess.resolveExecutable('cmd.exe')
        if (!cmd) return null
        const r = await execProc([cmd, '/c', 'echo', '%USERPROFILE%'], DEFAULT_CWD)
        if (r.ok) {
          const v = r.text.trim()
          if (v && /[\\/]/.test(v)) userHome = v
        }
      } catch (e) { userHome = null }
      return userHome
    }

    // ============ v1.5 T9：git 根检测 + 磁盘缓存（跨重启秒开）============
    // git rev-parse --show-toplevel 层层上溯找根；嵌套仓库（子目录含独立 .git）git 原生停在最近根 —— 符合用户要求
    let repoRoots = {}           // 根路径按 cwd 缓存
    let cacheDirResolved = null  // 缓存目录（惰性解析）
    async function getRepoRoot(cwd) {
      const key = cwd || DEFAULT_CWD
      if (repoRoots[key] !== undefined) return repoRoots[key]
      repoRoots[key] = null
      const git = await resolveGit()
      if (git) {
        const r = await execProc([git, '-C', key, 'rev-parse', '--show-toplevel'], key)
        const txt = r.ok ? r.text.trim() : ''
        if (txt && !/fatal/i.test(txt)) repoRoots[key] = txt
      }
      return repoRoots[key]
    }
    // 缓存目录：<DSH 进程 cwd>/.dsh-waystation-cache/（T9 修复：fs 沙箱 workspace-write 只允许 cwd 下，
    //   ~/.dsh 在沙箱外被拒 → 缓存永不写入；改用 process.cwd() 落点，跨重启秒开）
    async function getCacheDir() {
      if (cacheDirResolved) return cacheDirResolved
      const cwd0 = (typeof process !== 'undefined' && process.cwd) ? process.cwd() : DEFAULT_CWD
      if (!cwd0) return null
      cacheDirResolved = cwd0 + '/.dsh-waystation-cache'
      try { if (fs !== undefined && typeof fs.mkdir === 'function') await fs.mkdir(cacheDirResolved) } catch (e) { /* 已存在或不可建，writeText 会自建 */ }
      return cacheDirResolved
    }
    function cacheFileName(repo) {
      return (repo && repo.owner && repo.name) ? repo.owner + '__' + repo.name + '.json' : null
    }
    async function readDiskCache(repo) {
      try {
        if (fs === undefined || typeof fs.readText !== 'function' || typeof fs.resolve !== 'function') return null
        const dir = await getCacheDir(); if (!dir) return null
        const fn = cacheFileName(repo); if (!fn) return null
        const p = await fs.resolve(fn, { cwd: dir })
        const txt = await fs.readText(p)
        if (!txt) return null
        const j = JSON.parse(txt)
        if (j && j.ok === true && Array.isArray(j.maps) && typeof j.generatedMs === 'number') return j
        return null
      } catch (e) { return null }
    }
    async function writeDiskCache(repo, snap) {
      try {
        if (fs === undefined || typeof fs.writeText !== 'function' || typeof fs.resolve !== 'function') return
        const dir = await getCacheDir(); if (!dir) return
        const fn = cacheFileName(repo); if (!fn) return
        // T9 修复：fs 服务的 writeText 要求 resolve() 返回的 target 对象（{targetKey,displayPath}），不能直接传路径字符串
        const t = await fs.resolve(dir + '/' + fn)
        await fs.writeText(t, JSON.stringify(snap))
      } catch (e) { /* 写失败不影响主流程 */ }
    }

    async function getRepoKey(cwd) {
      const key = cwd || DEFAULT_CWD
      if (repoKeys[key]) return repoKeys[key]
      // v1.5 T9：gh 在 git 根目录执行（嵌套仓库/子目录场景取最近仓库）
      const root = await getRepoRoot(key)
      const r = await runGh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], root || key)
      if (!r.ok) return null
      const s = r.text.trim()
      const i = s.indexOf('/')
      if (i <= 0) return null
      repoKeys[key] = { owner: s.slice(0, i), name: s.slice(i + 1) }
      return repoKeys[key]
    }

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
      const r = await runGh(['issue', 'list', '--state', 'open', '--label', 'wayfinder:map', '--json', 'number,title,body,labels,assignees,state,updatedAt'], cwd)
      if (!r.ok) return { ok: false, error: r }
      try { return { ok: true, maps: JSON.parse(r.text) } } catch (e) { return { ok: false, error: { kind: 'parse', error: String(e) } } }
    }

    // 全部 issue（open + closed，Client 列表 open 常显、底部「已关闭」折叠行），
    // 按 updatedAt 倒序；labels 带 name + color（GitHub 配置色）；state 区分 open/closed；
    // v18：assignees 带出（状态栏「占用」按列表 issue 口径：已认领 + 被阻塞）
    async function fetchIssues(cwd) {
      // #374/#375：--limit 500 覆盖仓库全量（2026-08-14 实测 349 issue），并带出 createdAt（排序维度）
      const r = await runGh(['issue', 'list', '--state', 'all', '--limit', '500', '--json', 'number,title,labels,state,assignees,updatedAt,createdAt'], cwd)
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
      if (!r.ok) return { ok: false, error: r }
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
              blockedBy: { nodes: blockedBy.map(function (b) { return { number: b } }) },
            })
          }
          issues['m' + i] = {
            number: m.number, title: m.title, state: (m.state === 'closed' ? 'CLOSED' : 'OPEN'),
            body: m.body || '', url: m.html_url || ('https://github.com/' + repo.owner + '/' + repo.name + '/issues/' + m.number),
            labels: { nodes: (m.labels || []).map(function (l) { return { name: l.name } }) },
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
      const frag = 'number title state body url labels(first:20){nodes{name}} subIssues(first:100){totalCount nodes{number title state body url labels(first:10){nodes{name}} assignees(first:10){nodes{login}} blockedBy(first:20){nodes{number title state}}}}'
      const sel = numbers.map(function (n, i) { return 'm' + i + ':issue(number:' + n + '){' + frag + '}' }).join(' ')
      const query = 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){' + sel + '}}'
      let last = null
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await runGh(['api', 'graphql', '-f', 'query=' + query, '-F', 'owner=' + repo.owner, '-F', 'name=' + repo.name])
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

    async function buildSnapshot(cwd) {
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
      return {
        ok: true,
        repo: repo,
        repoRoot: await getRepoRoot(cwd),  // v1.5 T9：git 根路径（供仓库身份组件与 setup 检查）
        updatedAt: new Date().toISOString(),
        generatedMs: Date.now(),
        env: { ghPath: ghPath, ghError: ghPathError },
        maps: maps,
        issues: issues,
        labels: labels,
        fallback: d.fallback || null,  // v1.5 B5：'rest' = GraphQL 配额耗尽已降级 REST（client 可提示）
      }
    }

    // ============ 前置检查（#344 · wf.status）============
    // 解析 git 远程 URL → GitHub owner/repo；非 GitHub 返回 null
    function parseGithubRepo(url) {
      const s = String(url || '').trim()
      const m = s.match(/github\.com[\/:]([^\/\s]+)\/([^\/\s]+?)(?:\.git)?\s*$/)
      if (!m) return null
      return { owner: m[1], name: m[2] }
    }

    // 检查 1 · 仓库定位
    async function checkRepo(cwd, lang) {
      const git = await resolveGit()
      if (git) {
        const r = await execProc([git, '-C', cwd, 'remote', 'get-url', 'origin'], cwd)
        if (r.ok) {
          const key = parseGithubRepo(r.text)
          if (key) return { ok: true, level: 'ok', detail: key.owner + '/' + key.name, hint: '', repo: key }
          return { ok: true, level: 'warn', detail: (lang === 'en') ? 'Has a git remote but not GitHub: ' + r.text.trim().slice(0, 80) : '有 git 远程但非 GitHub：' + r.text.trim().slice(0, 80), hint: (lang === 'en') ? 'Remote is not GitHub' : '当前远程不是 GitHub', repo: null }
        }
        if (/not a git repository|does not appear to be a git repository|fatal/i.test(r.error || '')) {
          return { ok: false, level: 'bad', detail: (lang === 'en') ? 'Current directory is not a git repo' : '当前目录不是 git 仓库', hint: (lang === 'en') ? 'Use this plugin inside a GitHub repo' : '在 GitHub 仓库内使用本插件', repo: null }
        }
        return { ok: false, level: 'bad', detail: (lang === 'en') ? 'git query failed: ' + String(r.error || '').slice(0, 120) : 'git 查询失败：' + String(r.error || '').slice(0, 120), hint: (lang === 'en') ? 'Check git and repo state' : '检查 git 与仓库状态', repo: null }
      }
      // 兜底：解析 .git/config（git 可执行不可用时）
      if (fs !== undefined) {
        try {
          const t = await fs.resolve('.git/config', { cwd: cwd })
          const txt = await fs.readText(t)
          const um = txt.match(/url\s*=\s*(.+)/)
          if (um) {
            const key = parseGithubRepo(um[1])
            if (key) return { ok: true, level: 'ok', detail: key.owner + '/' + key.name, hint: '', repo: key }
            return { ok: true, level: 'warn', detail: (lang === 'en') ? 'Has a git remote but not GitHub: ' + um[1].trim().slice(0, 80) : '有 git 远程但非 GitHub：' + um[1].trim().slice(0, 80), hint: (lang === 'en') ? 'Remote is not GitHub' : '当前远程不是 GitHub', repo: null }
          }
        } catch (e) { /* 落到下方 bad */ }
      }
      return { ok: false, level: 'bad', detail: (lang === 'en') ? 'Cannot locate the repo (git unavailable and no .git/config)' : '无法定位仓库（git 不可用且无 .git/config）', hint: (lang === 'en') ? 'Use this plugin inside a GitHub repo' : '在 GitHub 仓库内使用本插件', repo: null }
    }

    // 检查 2 · setup 已执行
    async function checkSetup(cwd, lang) {
      if (fs === undefined) return { ok: false, level: 'bad', detail: (lang === 'en') ? 'fs service unavailable, cannot detect' : 'fs 服务不可用，无法检测', hint: (lang === 'en') ? 'Run /setup-matt-pocock-skills first' : '请先运行 /setup-matt-pocock-skills', repo: null }
      try {
        // v1.5 B1：改为针对 git 根目录检测（会话 cwd 在仓库子目录时不再误报「没有初始化」）
        const root = await getRepoRoot(cwd)
        const base = root || cwd
        const info = await fs.lstat('docs/agents/issue-tracker.md', { cwd: base })
        if (info) return { ok: true, level: 'ok', detail: (lang === 'en') ? 'docs/agents/issue-tracker.md exists' : 'docs/agents/issue-tracker.md 存在', hint: '', repo: null }
      } catch (e) { /* 落到下方 bad */ }
      return { ok: false, level: 'bad', detail: (lang === 'en') ? 'docs/agents/issue-tracker.md missing' : 'docs/agents/issue-tracker.md 不存在', hint: (lang === 'en') ? 'Run /setup-matt-pocock-skills first' : '请先运行 /setup-matt-pocock-skills', repo: null }
    }

    // 检查 3 · tracker = GitHub
    async function checkTracker(cwd, lang) {
      if (fs === undefined) return { ok: false, level: 'bad', detail: (lang === 'en') ? 'fs service unavailable, cannot determine tracker' : 'fs 服务不可用，无法判定 tracker', hint: (lang === 'en') ? 'Run /setup-matt-pocock-skills first' : '请先运行 /setup-matt-pocock-skills', repo: null }
      try {
        // #455 B1 补全：与 checkSetup 一致针对 git 根目录读（会话 cwd 在仓库子目录时不误报「无法读取」）
        const root = await getRepoRoot(cwd)
        const base = root || cwd
        const t = await fs.resolve('docs/agents/issue-tracker.md', { cwd: base })
        const txt = await fs.readText(t)
        if (/github/i.test(txt) && /gh\s+(issue|api|auth)|GitHub Issues/i.test(txt)) {
          return { ok: true, level: 'ok', detail: 'GitHub Issues + gh CLI', hint: '', repo: null }
        }
        return { ok: false, level: 'warn', detail: (lang === 'en') ? 'issue-tracker.md exists but is not the GitHub template' : 'issue-tracker.md 存在但非 GitHub 模板', hint: (lang === 'en') ? 'Run /setup-matt-pocock-skills and pick the GitHub tracker' : '运行 /setup-matt-pocock-skills 重选 GitHub tracker', repo: null }
      } catch (e) {
        return { ok: false, level: 'bad', detail: (lang === 'en') ? 'Cannot read issue-tracker.md' : '无法读取 issue-tracker.md', hint: (lang === 'en') ? 'Run /setup-matt-pocock-skills first' : '请先运行 /setup-matt-pocock-skills', repo: null }
      }
    }

    // 检查 4 · gh CLI 可用
    async function checkGhCli(lang) {
      const exe = await resolveGh()
      if (!exe) return { ok: false, level: 'bad', detail: (lang === 'en') ? 'gh not found — install GitHub CLI first (https://cli.github.com/)' : 'gh 未找到，请先安装 GitHub CLI（https://cli.github.com/）', hint: 'https://cli.github.com/', repo: null }
      return { ok: true, level: 'ok', detail: exe, hint: '', repo: null }
    }

    // 检查 5 · gh 已登录
    async function checkGhAuth(lang) {
      const r = await runGh(['auth', 'status'])
      if (r.ok) {
        const first = (r.text || '').split(/\r?\n/).map(function (s) { return s.trim() }).filter(Boolean)[0]
        return { ok: true, level: 'ok', detail: first || ((lang === 'en') ? 'Logged in' : '已登录'), hint: '', repo: null }
      }
      return { ok: false, level: 'bad', detail: (lang === 'en') ? 'Not logged into GitHub: run gh auth login (browser auth; official docs in hint)' : '未登录 GitHub：运行 gh auth login（浏览器授权，官方文档见 hint）', hint: 'https://cli.github.com/manual/gh_auth_login', repo: null }
    }

    // 检查 6 · API 可达（有 repo 用 repos/<owner>/<name>，否则退 user）
    async function checkApi(cwd, repo, lang) {
      const endpoint = repo ? ('repos/' + repo.owner + '/' + repo.name) : 'user'
      const r = await runGh(['api', endpoint], cwd)
      if (r.ok) return { ok: true, level: 'ok', detail: 'api.github.com 200 · ' + endpoint, hint: '', repo: null }
      return { ok: false, level: 'bad', detail: (lang === 'en') ? 'API request failed (' + r.kind + ')' : 'API 请求失败（' + r.kind + '）', hint: (lang === 'en') ? 'Check network / token scopes' : '检查网络 / Token 权限', repo: null }
    }

    // 检查 7/8 · 技能安装探测（#373 拍板：两态 —— 已安装/未安装；去掉不可靠的「挂载」判定：
    //   宿主级 skills 服务与「当前会话挂载」不是同一上下文，服务不可用时会误报「未挂载」）
    const SKILL_INSTALL_URL = 'https://github.com/mattpocock/skills'
    // v1.6：技能安装引导 prompt 已收编进 client PROMPTS 注册表（installSkills 条目）；hint 用 prompt: 键名协议（prompt:installSkills）由 client 取双语文本
    async function probeSkill(name, lang) {
      let session = false
      const skills = ctx.get('skills')
      if (skills !== undefined) {
        try { session = !!(await skills.get(name)) } catch (e) { session = false }
      }
      let fsFound = null
      const home = await getHome()
      if (fs !== undefined && home) {
        for (let i = 0; i < SKILL_PROBE_DIRS.length; i++) {
          try {
            const info = await fs.lstat(home + '\\' + SKILL_PROBE_DIRS[i] + '\\' + name)
            if (info) { fsFound = '~/' + SKILL_PROBE_DIRS[i] + '/' + name; break }
          } catch (e) { /* 继续探测下一个目录 */ }
        }
      }
      // 两态：#373 —— 任一来源发现 = 已安装（绿 ok）；均无 = 未安装（红 bad + 官方仓库地址）
      if (session && fsFound) return { ok: true, level: 'ok', detail: (lang === 'en') ? 'Installed (session-mounted · ' + fsFound + ')' : '已安装（会话已挂载 · ' + fsFound + '）', hint: '', repo: null }
      if (session) return { ok: true, level: 'ok', detail: (lang === 'en') ? 'Installed (session-mounted)' : '已安装（会话已挂载）', hint: '', repo: null }
      if (fsFound) return { ok: true, level: 'ok', detail: (lang === 'en') ? 'Installed (' + fsFound + ')' : '已安装（' + fsFound + '）', hint: '', repo: null }
      if (home === null) return { ok: false, level: 'bad', detail: (lang === 'en') ? 'Not installed (cannot probe user home)' : '未安装（无法探测用户主目录）', hint: 'prompt:installSkills', repo: null }
      return { ok: false, level: 'bad', detail: (lang === 'en') ? 'Not installed' : '未安装', hint: 'prompt:installSkills', repo: null }
    }

    // v1.5 T11：检查 9 · 核心技能套件聚合（全流程技能缺失检测）
    async function probeSkillSuite(lang) {
      const missing = []
      for (let i = 0; i < SKILL_PROBE_NAMES.length; i++) {
        const r = await probeSkill(SKILL_PROBE_NAMES[i], lang)
        if (r.level !== 'ok') missing.push(SKILL_PROBE_NAMES[i])
      }
      if (!missing.length) return { ok: true, level: 'ok', detail: (lang === 'en') ? 'Core skill suite installed (' + SKILL_PROBE_NAMES.length + ')' : '核心技能套件已安装（' + SKILL_PROBE_NAMES.length + ' 个）', hint: '', repo: null }
      return { ok: false, level: 'bad', detail: (lang === 'en') ? 'Missing: ' + missing.join(' / ') : '缺失：' + missing.join(' / '), hint: 'prompt:installSkills', repo: null }
    }

    const CHECK_NAMES = function (lang) {
      return (lang === 'en')
        ? ['Repo located', 'Setup run', 'Tracker = GitHub', 'gh CLI available', 'gh logged in', 'API reachable', 'wayfinder skill', 'ask-matt skill', 'Core skill suite']
        : ['仓库定位', 'setup 已执行', 'tracker = GitHub', 'gh CLI 可用', 'gh 已登录', 'API 可达', 'wayfinder 技能', 'ask-matt 技能', '核心技能套件']
    }

    async function buildStatus(cwd, lang) {
      const c1 = await checkRepo(cwd, lang)
      const c2 = await checkSetup(cwd, lang)
      const c3 = await checkTracker(cwd, lang)
      const c4 = await checkGhCli(lang)
      const c5 = await checkGhAuth(lang)
      const c6 = await checkApi(cwd, c1.repo, lang)
      const c7 = await probeSkill(SKILL_PROBE_NAMES[0], lang)
      const c8 = await probeSkill(SKILL_PROBE_NAMES[1], lang)
      const c9 = await probeSkillSuite(lang)
      const raw = [c1, c2, c3, c4, c5, c6, c7, c8, c9]
      const checks = raw.map(function (c, i) {
        return { id: i + 1, name: CHECK_NAMES(lang)[i], ok: c.level === 'ok', level: c.level, detail: c.detail, hint: c.hint }
      })
      return {
        ok: true,
        updatedAt: new Date().toISOString(),
        cwd: cwd,
        repo: c1.repo,
        ghPath: ghPath,
        checks: checks,
        ready: checks.filter(function (c) { return c.ok }).length,
        total: checks.length,
      }
    }

    // ============ RPC ============
    harness.handle('wf.status', async function (args) {
      const cwd = (args && args.cwd) || DEFAULT_CWD
      const force = !!(args && args.force)
      const lang = (args && args.lang === 'en') ? 'en' : 'zh'
      const now = Date.now()
      if (!force && statusCache.status && statusCache.cwd === cwd && statusCache.lang === lang && now - statusCache.ts < STATUS_CACHE_MS) return statusCache.status
      try {
        const status = await buildStatus(cwd, lang)
        statusCache = { ts: Date.now(), status: status, error: null, cwd: cwd, lang: lang }
        return status
      } catch (e) {
        statusCache = { ts: Date.now(), status: null, error: String((e && e.message) || e), cwd: cwd, lang: lang }
        return { ok: false, error: String((e && e.message) || e), checks: [], ready: 0, total: CHECK_NAMES(lang).length }
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
        const meta = s && s.meta
        const cwd = meta && (meta.cwd || meta.path || meta.worktree || meta.projectDir || meta.directory)
        if (typeof cwd === 'string' && cwd) return { ok: true, cwd: cwd }
        return { ok: false, error: '会话无 cwd 信息' }
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
    })

    harness.handle('wf.snapshot', async function (args) {
      const cwd = (args && args.cwd) || DEFAULT_CWD
      const now = Date.now()
      if (cache.snapshot && cache.cwd === cwd && now - cache.ts < CACHE_MS) return cache.snapshot
      try {
        // v1.5 T9：内存未命中 → 磁盘缓存秒开（fromCache 标记 → client 后台静默刷新动态更新 UI）
        const repo0 = await getRepoKey(cwd)
        const disk = await readDiskCache(repo0)
        if (disk) {
          cache = { ts: Date.now(), snapshot: disk, error: null, cwd: cwd }
          return Object.assign({}, disk, { fromCache: true })
        }
        const snap = await buildSnapshot(cwd)
        cache = { ts: Date.now(), snapshot: snap, error: null, cwd: cwd }
        await writeDiskCache(snap.repo, snap)
        return snap
      } catch (e) {
        cache = { ts: Date.now(), snapshot: null, error: errText(e), cwd: cwd }
        return { ok: false, error: errText(e), env: { ghError: ghPathError } }
      }
    })

    harness.handle('wf.refresh', async function (args) {
      const cwd = (args && args.cwd) || DEFAULT_CWD
      try {
        const snap = await buildSnapshot(cwd)
        cache = { ts: Date.now(), snapshot: snap, error: null, cwd: cwd }
        // v1.5 T9：刷新后落盘，下次重启秒开
        await writeDiskCache(snap.repo, snap)
        return snap
      } catch (e) {
        cache = { ts: Date.now(), snapshot: null, error: errText(e), cwd: cwd }
        return { ok: false, error: errText(e) }
      }
    })

    // v1.5 R2（#2 MVP）：probe 改用 `since` 时间戳探测全 issue 增量（地图 + 子票 + 其他），
    //   1 次 REST 调用覆盖全仓库变化。原实现 `labels=wayfinder:map` 仅匹配地图本身，
    //   **漏检所有子票变化**——面板可接/阻塞/已认领/已关闭分组（DESIGN.md §5.2）都是子票，
    //   故"列表不更新状态"。since 语义：返回数组非空 = 自上次快照以来有变化 → 视为 changed。
    //   配额仍走 REST 5000/h 池（独立于 GraphQL 5000 点/h），不烧穿。
    harness.handle('wf.probe', async function (args) {
      const cwd = (args && args.cwd) || DEFAULT_CWD
      try {
        const repo = await getRepoKey(cwd)
        if (!repo) return { ok: false, error: '无法解析仓库' }
        const rk1 = (repo.owner && repo.name) ? (repo.owner + '/' + repo.name) : (cwd || '')
        const since = lastProbeAtByRepo[rk1]  // 首次 probe = undefined → 不带 since → 全量返回 → 视为 changed
        const urlBase = 'repos/' + repo.owner + '/' + repo.name + '/issues?state=open&per_page=100'
        const url = since ? (urlBase + '&since=' + encodeURIComponent(since)) : urlBase
        const r = await runGh(['api', url, '--jq', '[.[] | {number: .number, updatedAt: .updated_at}]'], cwd)
        if (!r.ok) return { ok: false, error: r.error || 'probe 失败' }
        const arr = JSON.parse(r.text)
        // since 语义：任何返回都意味着自上次基线以来有 issue 变化 → changed=true
        //   首次 probe（since=undefined）：全量返回 → 通常非空（除非仓库无 open issue） → 视为 changed → 建立基线
        //   后续 probe（since=ISO）：任何返回 = 有更新 → changed=true
        const changed = Array.isArray(arr) && arr.length > 0
        if (changed) {
          lastProbeAtByRepo[rk1] = new Date().toISOString()
          cache = { ts: 0, snapshot: null, error: null, cwd: cwd }  // 失效内存缓存 → 下次 snapshot 重建
        }
        return { ok: true, changed: changed, repo: repo, count: Array.isArray(arr) ? arr.length : 0 }
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
      if (r.mds.some(function (m) { return m.name === want })) return { ok: true, file: want }
      return { ok: true, file: null }
    })

    // ============ 认领（开始此 Issue 流程 · T5 #347）============
    // 用户在 UI 点击「确认开始」且勾选认领后调用：gh issue edit <n> --add-assignee @me。
    // 写操作前 UI 已二次确认（用户点击即同意），不走 approval 服务（RESEARCH-NOTES §3 结论）。
    harness.handle('wf.claim', async function (args) {
      const n = args && args.number
      const cwd = (args && args.cwd) || DEFAULT_CWD
      if (!n) return { ok: false, error: '缺少参数 number（ticket 号）' }
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

    // ============ 轮询：已按 #348 拍板 Q3 关闭（60s 全量 × 8 map ≈ 2400-4800 GraphQL points/h 贴 5000 限额）============
    // 刷新策略 = 纯手动（状态条/面板按钮 wf.refresh）+ 打开面板即刷（client 侧 loadSnapshot）。
    // P1 若做状态变化 toast 提醒，再考虑低频自动（届时恢复本块并观察配额）。
  },
}
