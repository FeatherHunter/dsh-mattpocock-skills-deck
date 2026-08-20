/**
 * dsh-mattpocock-skills-deck 宿主半（ESM 插件体 · v1.0.0）
 *
 * 与动态版 host.js 同源（cordis_define 的 code.host 函数体），仅两处差异：
 *   1. 导出形状：`export const name` + `export function apply(ctx)`（静态插件协议）
 *   2. RPC：动态版的 `harness.handle('wf.xxx', fn)` → 自建 connection 通道 `/dsws`，
 *      `connection.rpc.handle('/dsws', dispatch, { authority: 'loopback' })`；
 *      endpoint 去掉 `wf.` 前缀（status / snapshot / refresh / cwd / handoffLatest / claim），
 *      Client 半经 `connection.rpc.call('/dsws', endpoint, payload)` 调用，返回
 *      RpcResult `{ ok: true, value } | { ok: false, error }`。
 *
 * 数据层：
 *   1. gh 封装层：resolveExecutable 解析 → 兜底 DSH_GH_PATH/系统 gh；30s 超时
 *      （timer race + terminate）；错误归一化（auth / network / notfound / exit）。
 *   2. 数据流：gh issue list 枚举 wayfinder:map → 每 map 一次 GraphQL（subIssues +
 *      labels + assignees + blockedBy + blocking）→ 组装快照（map 五区块解析 + tickets
 *      + stats 分组）。
 *   3. 快照 5s 缓存；环境检查 30s 缓存（args.force 强制重查）。
 */
export const name = 'dsh-mattpocock-skills-deck'

// 服务依赖声明（loader 等待就绪后再 apply；connection 依赖 webServer，显式声明避免静默失效）
// v1.5 T9 修复：fs 必须声明 —— 磁盘缓存（mattskillsdeck-cache）依赖 fs 服务；未声明时 ctx.get('fs') 为 undefined → 缓存静默失效
export const inject = ['subprocess', 'timer', 'connection', 'fs']

export function apply(ctx) {
  const subprocess = ctx.get('subprocess')
  const timer = ctx.get('timer')
  const fs = ctx.get('fs')
  if (subprocess === undefined || timer === undefined) return

  // ============ 配置 ============
  // v1.5.0（公共发布）：兜底 gh 路径 = 环境变量 DSH_GH_PATH（官方安装会加入 PATH，无需配置；非常规安装可用环境变量指定）
  const GH_FALLBACK = (typeof process !== 'undefined' && process.env && process.env.DSH_GH_PATH) ? process.env.DSH_GH_PATH : ''
  // 默认工作区 = DSH 进程当前目录（可被 snapshot args.cwd 覆盖；去本机硬编码）
  const DEFAULT_CWD = (typeof process !== 'undefined' && typeof process.cwd === 'function') ? process.cwd() : ''
  const TIMEOUT_MS = 30000
  // v1.3.3 提速：快照缓存 5s → 60s（面板打开基本命中缓存，不再每次全量重建 11 次 gh 调用）
  const CACHE_MS = 60000
  const STATUS_CACHE_MS = 30000  // 前置检查结果缓存
  const SKILL_PROBE_DIRS = ['.agents\\skills', '.minimax\\skills', '.claude\\skills']  // 技能文件层探测目录（相对用户主目录）
  // v1.5 T11：全流程核心技能探测名单（各动作 prompt 引用的技能 + 基础技能；检查 7/8 取前两个，检查 9 聚合全量）
  const SKILL_PROBE_NAMES = ['wayfinder', 'triage', 'grilling', 'grill-me', 'implement', 'ask-matt', 'research', 'prototype', 'handoff']
  const QUERY = 'query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){issue(number:$n){number title state body url labels(first:20){nodes{name}} subIssues(first:100){totalCount nodes{number title state body url labels(first:10){nodes{name}} assignees(first:10){nodes{login}} blockedBy(first:20){nodes{number title state}} }}}}}'

  // ============ 状态 ============
  let ghPath = null
  let ghPathError = null
  let repoKeys = {}  // repoKey 按 cwd 缓存（切换仓库会话时不再串仓库）
  let cache = { ts: 0, snapshot: null, error: null, cwd: null }
  let statusCache = { ts: 0, status: null, error: null, cwd: null, lang: null }  // 环境检查 30s 缓存（按 cwd+lang 区分）
  let userHome = null                                     // 用户主目录（cmd 探测，缓存）
  let lastProbeAtByRepo = {}                              // v1.5 R2 + R2-fix-6（#2 MVP）：probe since 时间戳，按 repoKey 隔离（只在 probe 检测到 change 时推进；build 不得动它 —— 否则会吞掉同窗口编辑，见 buildSnapshot 处注释）
  let lastIssueIndexByRepo = {}                            // #2 deletion fix：保存上次全量 issue 索引，用于发现 GitHub 删除/状态消失

  // ============ gh 封装 ============
  async function resolveGh() {
    if (ghPath) return ghPath
    if (ghPathError) return null
    try {
      ghPath = await subprocess.resolveExecutable('gh')
    } catch (e) {
      // 兜底：fs.lstat 对不存在路径返回 undefined（不抛错），须判真值
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

  // 通用进程执行（前置检查用：git / cmd 等，不经 shell，错误不归一化）
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

  // ============ issuePath · 1A+1B 事件队列 ============
    function pushIssuePathEvent(ref, source, title) {
      const n = Number(ref)
      if (!n || isNaN(n)) return
      pendingIssuePathEvents.push({ ref: n, source: String(source || 'gh-edit'), ts: Date.now(), title: String(title || '') })
      if (pendingIssuePathEvents.length > 100) pendingIssuePathEvents.shift()
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
  // 缓存目录：<DSH 进程 cwd>/.dsh-mattskillsdeck-cache/（T9 修复：fs 沙箱 workspace-write 只允许 cwd 下，
  //   ~/.dsh 在沙箱外被拒 → 缓存永不写入；改用 process.cwd() 落点，跨重启秒开；v1.6.17 更名 waystation → MattSkillsDeck）
  async function getCacheDir() {
    if (cacheDirResolved) return cacheDirResolved
    const cwd0 = (typeof process !== 'undefined' && process.cwd) ? process.cwd() : DEFAULT_CWD
    if (!cwd0) return null
    cacheDirResolved = cwd0 + '/.dsh-mattskillsdeck-cache'
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
    // v1.5 T11（map#37 · #38 R1 + #40 R2 输入，与 host.js 同源）：显式 origin 解析优先，避免多远程下 gh 选中 upstream
    const root = await getRepoRoot(key)
    const execCwd = root || key
    const git = await resolveGit()
    if (git) {
      const r = await execProc([git, '-C', execCwd, 'remote', 'get-url', 'origin'], execCwd)
      if (r.ok) {
        const k = parseGithubRepo(r.text)
        if (k) { repoKeys[key] = k; return k }
      }
    }
    if (fs !== undefined) {
      try {
        const t = await fs.resolve('.git/config', { cwd: execCwd })
        const txt = await fs.readText(t)
        const um = txt.match(/\[remote\s+"origin"\][^[]*url\s*=\s*([^\r\n]+)/)
        if (um) {
          const k = parseGithubRepo(um[1])
          if (k) { repoKeys[key] = k; return k }
        }
      } catch (e) { /* 落 Tier 3 */ }
    }
    const r = await runGh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], execCwd)
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
    const openBlocker = function (b) { const t = byNum[b]; return t !== undefined && t.state === 'OPEN' }
    levels.forEach(function (layer) {
      const openT = tickets.filter(function (t) { return byNumber[t.number] === layer.level && t.state === 'OPEN' })
      layer.frontier = openT.filter(function (t) { return !t.claimedBy && !t.blockedBy.some(openBlocker) }).length
      layer.claimed = openT.filter(function (t) { return t.claimedBy }).length
      layer.blocked = openT.filter(function (t) { return !t.claimedBy && t.blockedBy.some(openBlocker) }).length
    })
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

  // 全部 issue（open + closed，Client 列表 open 常显、底部「已关闭」折叠行），
  // 按 updatedAt 倒序；labels 带 name + color（GitHub 配置色）；state 区分 open/closed；
  // assignees 带出（状态栏「占用」按列表 issue 口径：已认领 + 被阻塞）
  async function fetchIssues(cwd) {
    // #374/#375：--limit 500 覆盖仓库全量（2026-08-14 实测 349 issue），并带出 createdAt（排序维度）
    // #44 T2-fix（map#37）：显式 --repo 绕过 gh 多远程推断，同 fetchMaps
    const repo2 = await getRepoKey(cwd)
    const argsAll = ['issue', 'list', '--state', 'all', '--limit', '500', '--json', 'number,title,labels,state,assignees,updatedAt,createdAt']
    if (repo2) argsAll.push('--repo', repo2.owner + '/' + repo2.name)
    const r = await runGh(argsAll, cwd)
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
      } catch (err) { labels = [] }
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

  // ============ 前置检查 ============
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

  // 检查 7/8 · 技能安装探测（#373 拍板：两态 —— 已安装/未安装；去掉不可靠的「挂载」判定）
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

  // ============ RPC：/dsws 通道（endpoint 去掉 wf. 前缀）============
  const connection = ctx.get('connection')
  if (connection === undefined || connection.rpc === undefined) return

  // 错误对象 → 可读文本：fetchMaps/buildSnapshot 抛出的是 {kind, error} 对象，String() 会变 [object Object]
  const errText = function (e) {
    if (e === undefined || e === null) return '未知错误'
    if (typeof e === 'string') return e
    if (typeof e.message === 'string') return e.message
    if (typeof e.error === 'string') return e.error
    try { return JSON.stringify(e) } catch (err) { return String(e) }
  }

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
  //     `handoffResolve(args.name)` 在客户端已点过第一击时直接返回该 name 保障。
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
        const name2 = (e && (e.name || e.path || '')) || ''
        if (!name2 || !/\.md$/i.test(name2)) continue
        let mtime = 0
        try {
          const info = await fs.stat(await fs.resolve('.scratch/handoff/' + name2, { cwd: cwd }))
          if (info) mtime = parseHandoffMtime(info.mtime)
        } catch (e2) { mtime = 0 }
        mds.push({ name: name2, mtime: mtime })
      }
      return { mds: mds }
    } catch (e) {
      return { mds: [] }  // 目录不存在/不可读 = 还没有交接文档
    }
  }

  const dispatch = async function (endpoint, args) {
    const cwd = (args && args.cwd) || DEFAULT_CWD
    switch (endpoint) {
      case 'status': {
        const force = !!(args && args.force)
        const lang = (args && args.lang === 'en') ? 'en' : 'zh'
        const now = Date.now()
        if (!force && statusCache.status && statusCache.cwd === cwd && statusCache.lang === lang && now - statusCache.ts < STATUS_CACHE_MS) return statusCache.status
        try {
          const status = await buildStatus(cwd, lang)
          statusCache = { ts: Date.now(), status: status, error: null, cwd: cwd, lang: lang }
          return status
        } catch (e) {
          statusCache = { ts: Date.now(), status: null, error: errText(e), cwd: cwd, lang: lang }
          return { ok: false, error: errText(e), checks: [], ready: 0, total: CHECK_NAMES(lang).length }
        }
      }
      case 'snapshot': {
        const now = Date.now()
        if (cache.snapshot && cache.cwd === cwd) {
          const current = await cacheSnapshotIsCurrent(cache.snapshot, cwd)
          if (current === true || (current === null && now - cache.ts < CACHE_MS)) return cache.snapshot
        }
        try {
          // #2 deletion fix：磁盘快照只用于秒开；命中后先校验 issue 索引，删除/状态变化时立即重建。
          const repo0 = await getRepoKey(cwd)
          const disk = await readDiskCache(repo0)
          if (disk) {
            const current = await cacheSnapshotIsCurrent(disk, cwd)
            if (current !== false) return adoptSnapshot(Object.assign({}, disk, { fromCache: true }), cwd)
          }
          const snap = await buildSnapshot(cwd)
          await writeDiskCache(snap.repo, snap)
          return adoptSnapshot(snap, cwd)
        } catch (e) {
          cache = { ts: Date.now(), snapshot: null, error: errText(e), cwd: cwd }
          return { ok: false, error: errText(e), env: { ghError: ghPathError } }
        }
      }
      case 'refresh': {
        try {
          const snap = await buildSnapshot(cwd)
          // v1.5 T9：刷新后落盘，下次重启秒开
          await writeDiskCache(snap.repo, snap)
          return adoptSnapshot(snap, cwd)
        } catch (e) {
          cache = { ts: Date.now(), snapshot: null, error: errText(e), cwd: cwd }
          return { ok: false, error: errText(e) }
        }
      }
      case 'probe': {
        // #2 deletion fix：probe 读取 state=all 的轻量 issue 索引，一次 REST 同时覆盖新增、修改、关闭、重开和删除。
        //   原 since=open 查询无法返回删除记录，导致已删除 issue 永久留在磁盘快照；全量索引按 number/state/updatedAt 比较解决该缺口。
        //   仍由 lastProbeAtByRepo 记录每个 repo 的探测时刻，探测周期和 REST 配额策略不变。
        try {
          const remote = await fetchIssueIndex(cwd)
          if (!remote.ok) return { ok: false, error: errText(remote.error || 'probe 失败') }
          const repo = remote.repo
          const rk1 = repo.owner + '/' + repo.name
          const known = lastIssueIndexByRepo[rk1] || issueIndexFromSnapshot(cache.snapshot)
          const changed = issueIndexChanged(known, remote.index)
          rememberIssueIndex(repo, remote.index)
          lastProbeAtByRepo[rk1] = new Date().toISOString()
          if (changed) cache = { ts: 0, snapshot: null, error: null, cwd: cwd }  // 删除/状态变化同样失效缓存
          return { ok: true, changed: changed, repo: repo, count: remote.count, since: lastProbeAtByRepo[rk1] }
        } catch (e) { return { ok: false, error: errText(e) } }
      }
      case 'cwd': {
        const sid = args && args.sessionId
        if (!sid) return { ok: false, error: '缺少 sessionId' }
        const sessions = ctx.get('sessions')
        if (sessions === undefined || typeof sessions.get !== 'function') return { ok: false, error: 'sessions 服务不可用' }
        try {
          const s = sessions.get(sid)
          const header = s && (s.header || s.meta)
          const cwd = header && (header.cwd || header.path || header.worktree || header.projectDir || header.directory)
          if (typeof cwd === 'string' && cwd) return { ok: true, cwd: cwd }
          const meta = s && s.meta
          const cwd2 = meta && (meta.cwd || meta.path || meta.worktree || meta.projectDir || meta.directory)
          if (typeof cwd2 === 'string' && cwd2) return { ok: true, cwd: cwd2 }
          if (s && typeof s.cwd === 'string' && s.cwd) return { ok: true, cwd: s.cwd }
          return { ok: false, error: '会话无 cwd 信息' }
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) }
        }
      }
      case 'handoffLatest': {
        if (fs === undefined) return { ok: false, error: 'fs 服务不可用' }
        const r = await scanHandoffDir(cwd)
        if (r.error) return { ok: false, error: r.error }
        return { ok: true, file: pickLatestHandoff(r.mds) }
      }
      case 'handoffResolve': {
        if (fs === undefined) return { ok: false, error: 'fs 服务不可用' }
        const r = await scanHandoffDir(cwd)
        if (r.error) return { ok: false, error: r.error }
        const want = args && args.name
        if (!want) return { ok: true, file: pickLatestHandoff(r.mds) }
        if (r.mds.some(function (m) { return m.name === want })) return { ok: true, file: want }
        return { ok: true, file: null }
      }
      case 'issuePathPoll': {
        const since = args && typeof args.since === 'number' ? args.since : 0
        const out = pendingIssuePathEvents.filter(function (e) { return e.ts > since })
        return { ok: true, events: out.slice(-100), serverNow: Date.now() }
      }
      case 'issuePathPush': {
        const n = args && args.number
        const src = args && args.source ? String(args.source) : 'mention'
        if (!n) return { ok: false, error: '缺少 number' }
        pushIssuePathEvent(n, src, args && args.title)
        return { ok: true }
      }
      case 'claim': {
        const n = args && args.number
        if (!n) return { ok: false, error: '缺少参数 number（ticket 号）' }
        const repo = await getRepoKey(cwd)
        if (!repo) return { ok: false, error: { kind: 'env', error: '无法解析 owner/repo（git remote 或 gh repo view 失败）' } }
        const r = await runGh(['issue', 'edit', String(n), '--add-assignee', '@me'], cwd)
        if (!r.ok) return { ok: false, error: r }
        // 认领成功 → 取当前用户 login 供面板展示；失效快照缓存，让下次 snapshot 拉到新 assignee
        let assignedTo = ''
        const u = await runGh(['api', 'user', '-q', '.login'])
        if (u.ok) assignedTo = u.text.trim()
        cache = { ts: 0, snapshot: null, error: null }
        return { ok: true, number: n, assignedTo: assignedTo, url: 'https://github.com/' + repo.owner + '/' + repo.name + '/issues/' + String(n) }
      }
      case 'initPublish': {
        const name = args && args.name ? String(args.name).trim() : ''
        const visibility = (args && args.visibility) === 'public' ? 'public' : 'private'
        if (!name) return { ok: false, errorKind: 'bad-name', error: '仓库名为空' }
        if (!/^[A-Za-z0-9._-]+$/.test(name) || name.length > 100) {
          return { ok: false, errorKind: 'bad-name', error: '仓库名仅支持字母/数字/._- 且 ≤100：' + name }
        }
        const visFlag = visibility === 'public' ? '--public' : '--private'
        const git = await resolveGit()
        if (!git) return { ok: false, errorKind: 'no-git', error: '未找到 git（请安装 https://git-scm.com/）' }
        const gh = await resolveGh()
        if (!gh) return { ok: false, errorKind: 'no-gh', error: ghPathError || '未找到 gh（请安装 https://cli.github.com/）' }
        const authR = await runGh(['auth', 'status'], cwd)
        if (!authR.ok) {
          const t = String(authR.error || '').toLowerCase()
          if (authR.kind === 'network' || /network|econn|timed out|timeout|enotfound|getaddrinfo|connect/.test(t)) {
            return { ok: false, errorKind: 'network', error: authR.error }
          }
          return { ok: false, errorKind: 'not-logged-in', error: authR.error }
        }
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
        try {
          const probe = await execProc([git, '-C', cwd, 'rev-parse', '--is-inside-work-tree'], cwd)
          if (!probe.ok) {
            const initR = await execProc([git, 'init'], cwd)
            if (!initR.ok) {
              const k = classifyCreateError(initR.error, null)
              return { ok: false, errorKind: k === 'already-exists' ? 'permission' : k, error: initR.error }
            }
            if (cwd && repoRoots[cwd] !== undefined) delete repoRoots[cwd]
            if (repoRoots[DEFAULT_CWD] !== undefined) delete repoRoots[DEFAULT_CWD]
          }
        } catch (e) {
          const initR = await execProc([git, 'init'], cwd)
          if (!initR.ok) {
            const k = classifyCreateError(initR.error, null)
            return { ok: false, errorKind: k === 'already-exists' ? 'permission' : k, error: initR.error }
          }
          if (cwd && repoRoots[cwd] !== undefined) delete repoRoots[cwd]
          if (repoRoots[DEFAULT_CWD] !== undefined) delete repoRoots[DEFAULT_CWD]
        }
        const addR = await execProc([git, 'add', '.'], cwd)
        if (!addR.ok) {
          const k = classifyCreateError(addR.error, null)
          return { ok: false, errorKind: k, error: addR.error }
        }
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
        let hasOrigin = false
        try {
          const ro = await execProc([git, 'remote', 'get-url', 'origin'], cwd)
          hasOrigin = !!ro.ok
        } catch (e) { hasOrigin = false }
        if (!hasOrigin) {
          const cr = await runGh(['repo', 'create', name, visFlag, '--source=.', '--push'], cwd)
          if (!cr.ok) {
            const kind = classifyCreateError(cr.error, cr.kind)
            const repoUrl = (kind === 'already-exists' && currentUser) ? ('https://github.com/' + currentUser + '/' + name) : undefined
            return { ok: false, errorKind: kind, error: cr.error, repoUrl: repoUrl }
          }
        } else {
          const cr2 = await runGh(['repo', 'create', name, visFlag], cwd)
          if (!cr2.ok) {
            const kind = classifyCreateError(cr2.error, cr2.kind)
            const repoUrl = (kind === 'already-exists' && currentUser) ? ('https://github.com/' + currentUser + '/' + name) : undefined
            return { ok: false, errorKind: kind, error: cr2.error, repoUrl: repoUrl }
          }
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
            return { ok: false, errorKind: kind, error: pushR.error }
          }
        }
        cache = { ts: 0, snapshot: null, error: null, cwd: null }
        statusCache = { ts: 0, status: null, error: null, cwd: null, lang: null }
        if (cwd && repoKeys[cwd] !== undefined) delete repoKeys[cwd]
        if (repoKeys[DEFAULT_CWD] !== undefined) delete repoKeys[DEFAULT_CWD]
        if (cwd && repoRoots[cwd] !== undefined) delete repoRoots[cwd]
        if (repoRoots[DEFAULT_CWD] !== undefined) delete repoRoots[DEFAULT_CWD]
        let owner = currentUser
        try {
          const rk = await getRepoKey(cwd)
          if (rk && rk.owner) owner = rk.owner
        } catch (e) { /* 兜底 */ }
        if (!owner) {
          try {
            const u2 = await runGh(['api', 'user', '-q', '.login'], cwd)
            if (u2.ok) owner = u2.text.trim()
          } catch (e2) { /* 忽略 */ }
        }
        return { ok: true, repo: { owner: owner, name: name } }
      }
      default:
        throw new Error('unknown endpoint: ' + endpoint)
    }
  }

  connection.rpc.handle('/dsws', async function (endpoint, payload) {
    try {
      const value = await dispatch(endpoint, payload)
      return { ok: true, value: value }
    } catch (e) {
      return { ok: false, error: { code: 'internal', message: String((e && e.message) || e), details: {} } }
    }
  }, { authority: 'loopback' })

  // 刷新策略 = 纯手动（状态条/面板按钮 refresh）+ 打开面板即刷（client 侧 loadSnapshot）。
}
