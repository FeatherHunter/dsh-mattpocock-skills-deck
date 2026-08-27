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

// ===== 规范方言（dynamic dialect）：harness 为自由变量；pkg entry 提供 shim =====
export default {
  inject: ['connection'],
  apply(ctx) {
    const subprocess = ctx.get('subprocess')
    const timer = ctx.get('timer')
    const fs = ctx.get('fs')
    if (subprocess === undefined || timer === undefined) return

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
    const STATUS_CACHE_MS = 30000  // 前置检查结果缓存（#344）
    const SKILL_PROBE_DIRS = ['.agents/skills', '.minimax/skills', '.claude/skills']  // #171 migrated: posix canonical via platform.path
    // v1.5 T11 + #149 修复：全流程核心技能探测名单（各动作 prompt 引用的技能 + 基础技能；检查 7/8 取前两个，检查 9 聚合全量）— 补 `setup-matt-pocock-skills` 为 10 名（图快照 §1.1 相邻缺陷正位，#150 Q6）
    const SKILL_PROBE_NAMES = ['wayfinder', 'triage', 'grilling', 'grill-me', 'implement', 'ask-matt', 'research', 'prototype', 'handoff', 'setup-matt-pocock-skills']
    const QUERY = 'query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){issue(number:$n){number title state body url labels(first:20){nodes{name}} subIssues(first:100){totalCount nodes{number title state body url labels(first:10){nodes{name}} assignees(first:10){nodes{login}} blockedBy(first:20){nodes{number title state}} }}}}}'

    // ============ 状态 ============
    let ghPath = null
    // #195 修复：失败不永久缓存 —— ghLastError 仅保留最近一次失败（覆盖式），环境修复后下次 resolveGh 覆盖为 null；不像旧实现首次失败永不重试
    let ghLastError = null
    let repoKeys = {}  // v12：repoKey 按 cwd 缓存（切换仓库会话时不再串仓库）
    let cache = { ts: 0, snapshot: null, error: null, cwd: null }
    let statusCache = { ts: 0, status: null, error: null, cwd: null, lang: null }  // wf.status 30s 缓存（按 cwd+lang 区分）
    let userHome = null                                     // 保留占位（#171 已迁 platform.getHome，缓存归平台 memoize）
    // ============ Tracker Registry（#155 · 后端选择 UI）============
    let _trackerRegistry = null
    let _trackerRegistryInit = null
    async function getTrackerRegistry() {
      if (_trackerRegistry) return _trackerRegistry
      if (_trackerRegistryInit) return _trackerRegistryInit
      _trackerRegistryInit = (async () => {
        try {
          const injected = ctx.get('trackerRegistry')
          if (injected && typeof injected.select === 'function') { _trackerRegistry = injected; return _trackerRegistry }
        } catch {}
        try {
          const regMod = await import('./tracker/registry.js')
          const createRegistry = regMod.createRegistry || regMod.default
          const reg = createRegistry({}, { matchesTimeout: 3000 })
          // 注册内置后端（github/markdown/gitlab），失败忽略（保持可用）
          try {
            const ghMod = await import('./tracker/backends/github/index.js')
            const m = ghMod.githubModule || ghMod.defaultModule || ghMod.default
            if (m && m.id) try { reg.register(m) } catch {}
          } catch {}
          try {
            const mdMod = await import('./tracker/backends/markdown/index.js')
            const mkCreate = mdMod.createMarkdownBackend || mdMod.createBackend || mdMod.default
            const mkMatches = mdMod.matches
            const mdPresentation = mdMod.markdownModule?.presentation || mdMod.presentation
            const mdModule = mkCreate ? { id: 'markdown', label: 'Markdown', presentation: mdPresentation || { color: '#1a7f37' }, create: mkCreate, matches: mkMatches || (async()=>false) } : null
            if (mdModule) try { reg.register(mdModule) } catch {}
          } catch {}
          try {
            const glMod = await import('./tracker/backends/gitlab/index.js')
            const m2 = glMod.gitlabBackend || glMod.default
            if (m2 && m2.id) try { reg.register(m2) } catch {}
          } catch {}
          _trackerRegistry = reg
          try { ctx.set && ctx.set('trackerRegistry', reg) } catch {}
          return reg
        } catch (e) {
          // 回落：空 registry（仅 explicit 能力）
          try {
            const regMod2 = await import('./tracker/registry.js')
            const cr = regMod2.createRegistry || regMod2.default
            _trackerRegistry = cr({}, { matchesTimeout: 3000 })
            return _trackerRegistry
          } catch { return null }
        }
      })()
      _trackerRegistry = await _trackerRegistryInit
      return _trackerRegistry
    }
    // 触发预热（不阻塞主流程）
    try { getTrackerRegistry().catch(()=>{}) } catch {}
    // ============ 平台抽象（#171 · createPlatform 惰性单例）============
    // 第一性原理：平台单点 + 零手拼 + 双闸不变量；经 ctx.get('platform') 或内联 fallback（零 import 语法，避 D7 dev host vm.Script 阻塞）
    let _platform = null
    let _platformInit = null
    async function getPlatform() {
      if (_platform) return _platform
      if (_platformInit) return _platformInit
      _platformInit = (async () => {
        const injected = ctx.get('platform')
        if (injected && typeof injected.getHome === 'function' && injected.path) return injected
        try {
          const platMod = await import('./platform/index.js')
          const createPlatform = platMod.createPlatform || platMod.default
          if (typeof createPlatform === 'function') return createPlatform(ctx)
        } catch {}
        let nodePath = null
        let nodeOs = null
        try { const m = await import('node:path'); nodePath = m.default || m } catch {}
        try { const m2 = await import('node:os'); nodeOs = m2.default || m2 } catch {}
        if (!nodePath || !nodeOs) {
          const sepWin = String.fromCharCode(92)
          nodePath = { posix: { join: (...a) => a.join('/').replace(/\/\//g,'/'), sep: '/', dirname: (p)=>p.slice(0,p.lastIndexOf('/')), basename: (p)=>p.split('/').pop(), resolve: (...a)=>a.join('/'), normalize: (p)=>p, isAbsolute: (p)=>p.startsWith('/'), relative: (a,b)=>b }, win32: { join: (...a) => a.join(sepWin).replace(/\//g,sepWin), sep: sepWin, dirname: (p)=>p.slice(0,p.lastIndexOf(sepWin)), basename: (p)=>p.split(sepWin).pop(), resolve: (...a)=>a.join(sepWin), normalize: (p)=>p, isAbsolute: (p)=>/^[A-Za-z]:/.test(p), relative: (a,b)=>b } }
          nodeOs = { homedir: () => (typeof process !== 'undefined' && process.env && (process.env.USERPROFILE || process.env.HOME)) || '', platform: () => { try { return (typeof process !== 'undefined' && process['platform']) || 'win32' } catch { return 'win32' } } }
        }
        const osName = (nodeOs.platform ? nodeOs.platform() : 'win32')
        const pathImpl = osName === 'win32' ? nodePath.win32 : nodePath.posix
        const envSrc = (typeof process !== 'undefined' && process.env) ? process.env : {}
        const homedirFn = () => { try { return nodeOs.homedir() } catch { return '' } }
        const WIN32_GUARD_RE = /^[A-Za-z]:/
        let cachedHome
        const getHomeInner = async () => {
          if (cachedHome !== undefined) return cachedHome
          let primary = ''
          try { const v = homedirFn(); primary = v == null ? '' : String(v) } catch { primary = '' }
          if (osName === 'win32') {
            if (primary && WIN32_GUARD_RE.test(primary)) { cachedHome = primary; return cachedHome }
            const up = envSrc.USERPROFILE
            if (up) { cachedHome = up; return cachedHome }
            const combined = (envSrc.HOMEDRIVE || '') + (envSrc.HOMEPATH || '')
            if (combined) { cachedHome = combined; return cachedHome }
            cachedHome = null; return cachedHome
          } else {
            try { const v = homedirFn(); cachedHome = v || null; return cachedHome } catch { cachedHome = null; return cachedHome }
          }
        }
        const pathObj = Object.freeze({
          join: pathImpl.join.bind(pathImpl),
          sep: pathImpl.sep,
          dirname: pathImpl.dirname.bind(pathImpl),
          basename: pathImpl.basename.bind(pathImpl),
          resolve: pathImpl.resolve.bind(pathImpl),
          normalize: pathImpl.normalize.bind(pathImpl),
          isAbsolute: pathImpl.isAbsolute.bind(pathImpl),
          relative: pathImpl.relative.bind(pathImpl),
          async joinHome(...segs) { const h = await getHomeInner(); return pathImpl.join(h, ...segs) },
        })
        async function resolveExec(name) {
          const mapped = osName === 'win32' && name === 'cmd' ? 'cmd.exe' : name
          const subprocessSvc = ctx.get('subprocess')
          try { return await subprocessSvc.resolveExecutable(mapped) } catch (e) {
            if (name === 'gh') {
              const fb = envSrc.DSH_GH_PATH || ''
              if (!fb) throw e
              const fss = ctx.get('fs')
              if (!fss || typeof fss.lstat !== 'function') throw e
              try { const info = await fss.lstat(fb); if (info) return fb } catch {}
            }
            throw e
          }
        }
        const resolveExecutable = async (name) => { try { return await resolveExec(name) } catch { return null } }
        const fss = ctx.get('fs')
        const envView = Object.freeze({ get(k){ return envSrc[k] }, has(k){ return k in envSrc } })
        return Object.freeze({ os: osName, getHome: getHomeInner, path: pathObj, resolveExecutable, fs: fss, env: envView })
      })()
      _platform = await _platformInit
      return _platform
    }
    // ============ 探测级联 · workspaceStore + detectionService（#152 · #150 Q1-Q7）============
    // 四层严格 + 轻量化二联骨架 + per-workspace 内存 Map<handleKey→Selection> 不落盘 + pending 不缓存 + wf.bind 薄兼容
    let _workspaceStore = null
    let _detectionService = null
    async function getWorkspaceStore() {
      if (_workspaceStore) return _workspaceStore
      try {
        const mod = await import('./tracker/detection/workspaceStore.js')
        const create = mod.createWorkspaceStore || mod.default
        _workspaceStore = create({ ttl: STATUS_CACHE_MS })
        // registry stale 清理（#150 Q3 unregister stale → emit bind）
        try {
          const reg = await getTrackerRegistry()
          if (reg && typeof reg.on === 'function') reg.on('bind', (evt) => { if (evt && evt.stale) { try { _workspaceStore.onRegistryBindStale(evt.handle) } catch {} } })
        } catch {}
      } catch { _workspaceStore = { get: () => null, set: () => {}, has: () => false, clear: () => {}, invalidate: () => {}, keys: () => [], onRegistryBindStale: () => {} } }
      return _workspaceStore
    }
    // #幽灵修复：BackendContext.exec（contract.js §BackendContext）——preflight 经 ghClient/glab 执行 gh/glab。
    // 契约形状 {stdout,stderr,code}；exit code≠0 不抛（调用方判）；超时 terminate；opts.timeout/signal 透传。
    async function detectionExec(cmd, args, opts) {
      const argv = [String(cmd)].concat(args || [])
      const c = (opts && opts.cwd) || ''
      let handle
      try {
        handle = subprocess.spawn({
          argv: argv,
          cwd: c || DEFAULT_CWD,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 4 * 1024 * 1024 }, stderr: { maxBytes: 256 * 1024 } },
          graceMs: 2000,
        })
      } catch (e) {
        throw new Error('exec spawn failed: ' + String((e && e.message) || e))
      }
      const timeoutMs = (opts && opts.timeout != null) ? opts.timeout : TIMEOUT_MS
      let outcome
      try {
        outcome = await Promise.race([
          handle.done,
          timer.timeout(timeoutMs).then(function () { try { handle.terminate() } catch (e2) {} return { exitCode: -1, signal: 'timeout' } }),
        ])
      } catch (e) {
        outcome = { exitCode: -1, signal: 'error' }
      }
      const out = (handle.collected && handle.collected.stdout) ? handle.collected.stdout.readFrom(0) : { text: '' }
      const err = (handle.collected && handle.collected.stderr) ? handle.collected.stderr.readFrom(0) : { text: '' }
      return { stdout: out.text || '', stderr: err.text || '', code: outcome.exitCode }
    }
    async function getDetectionService() {
      if (_detectionService) return _detectionService
      const registry = await getTrackerRegistry()
      const platform = await getPlatform()
      const ws = await getWorkspaceStore()
      const fsSvc = ctx.get('fs')
      try {
        const mod = await import('./tracker/detection/detectionService.js')
        const create = mod.createDetectionService || mod.default
        // skillProbe 内联（复用 probeSkill 双源逻辑，10 名含 setup 正位）
        const skillProbe = async ({ cwd }) => {
          const probes = {}
          let missing = []
          for (let i = 0; i < SKILL_PROBE_NAMES.length; i++) {
            const name = SKILL_PROBE_NAMES[i]
            try {
              const r = await probeSkill(name, 'zh')
              probes[name] = r
              if (r.level !== 'ok') missing.push(name)
            } catch { probes[name] = { ok: false, level: 'bad' }; missing.push(name) }
          }
          return { ok: missing.length === 0, missing, probes }
        }
        _detectionService = create({ registry, getPlatform, getFs: () => fsSvc, getTimers: () => ({ setTimeout: (fn, ms) => timer.timeout(fn, ms), clearTimeout: (id) => { try { clearTimeout(id) } catch {} } }), workspaceStore: ws, skillProbe, resolveRepoHandle: async (h) => ({ cwd: h.cwd || '', refId: h.refId || '' }), exec: detectionExec })
      } catch (e) {
        // 兜底：最小二联（explicit → matches）不含 preflight/skill
        _detectionService = {
          detect: async (handle, opts) => {
            const plat = await getPlatform()
            const expMod = await import('./tracker/detection/explicitDetector.js')
            const expFn = expMod.detectExplicit || expMod.default
            const exp = await expFn(handle, { platform: plat, cwd: handle.cwd, fs: fsSvc }, registry)
            let sel = exp.selection
            if (!sel) { const ctx2 = { cwd: handle.cwd, platform: plat, fs: fsSvc, timers: { setTimeout: (fn, ms) => timer.timeout(fn, ms), clearTimeout: (id) => { try { clearTimeout(id) } catch {} } } }; sel = await registry.select(handle, ctx2) }
            return { handle, selection: sel, repoHandle: { cwd: handle.cwd || '', refId: (sel && sel.ref && sel.ref.refId) || '' }, explicit: { raw: exp.raw, parsed: exp.parsed }, preflight: null, skillProbes: null, at: Date.now() }
          }
        }
      }
      return _detectionService
    }

    let lastProbeAtByRepo = {}                            // v1.5 R2 + R2-fix-6（#2 MVP）：probe since 时间戳，按 repoKey 隔离（只在 probe 检测到 change 时推进；build 不得动它 —— 否则会吞掉同窗口编辑，见 buildSnapshot 处注释）
    let lastIssueIndexByRepo = {}                          // #2 deletion fix：保存上次全量 issue 索引，用于发现 GitHub 删除/状态消失
    let pendingIssuePathEvents = []                       // issuePath · 1A+1B 检测队列（runGh 白名单 + wf.claim），client via wf.issuePathPoll 拉取，cap 100

    // ============ gh 封装 ============
    // #195 修复：resolveGh 不再缓存失败（ghLastError 仅最近一次失败，环境修复后下次探测即恢复）
    async function resolveGh() {
      if (ghPath) return ghPath
      const platform = await getPlatform()
      try {
        const p = await platform.resolveExecutable('gh')
        if (p) { ghPath = p; ghLastError = null; return ghPath }
        ghLastError = 'gh 不可用：PATH 无 gh，且 DSH_GH_PATH 未配置（官方安装请访问 https://cli.github.com/）'
        return null
      } catch (e) {
        const fb = platform.env.get('DSH_GH_PATH') || ''
        if (!fb) { ghLastError = 'gh 不可用：PATH 无 gh，且 DSH_GH_PATH 未配置（官方安装请访问 https://cli.github.com/）'; return null }
        try {
          const info = await platform.fs.lstat(fb)
          if (info) { ghPath = fb; ghLastError = null; return ghPath }
        } catch (e2) {}
        ghLastError = 'gh 不可用：PATH 无 gh，且 DSH_GH_PATH 未配置（官方安装请访问 https://cli.github.com/）'
        return null
      }
    }
    // #195 修复：force 探测路径调 resetGhCache 清空成功缓存，强制下次 resolveGh 重探
    function resetGhCache() { ghPath = null; ghLastError = null; statusCache = { ts: 0, status: null, error: null, cwd: null, lang: null, backendId: null }; try { if (_workspaceStore && typeof _workspaceStore.clear === 'function') _workspaceStore.clear(); } catch {} try { getWorkspaceStore().then(function(ws){ try{ ws.clear(); }catch(e){} }).catch(function(){}); } catch {} }

    async function runGh(args, cwd) {
      const exe = await resolveGh()
      if (!exe) return { ok: false, kind: 'env', error: ghLastError }
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
      // issuePath · 1A：runGh 白名单检测（仅成功路径；失败不记路径污染；--add-assignee 为 claim 通道，交由 wf.claim 推送 source='claim'）
      // #213: 增量刷新 — create/edit/close/comment/reopen 均失效快照缓存，支撑右侧面板不整页的增量更新
      try {
        const a = Array.isArray(args) ? args : []
        if (a.length >= 2 && a[0] === 'issue' && /^(create|edit|close|comment|reopen)$/.test(String(a[1]))) {
          if (String(a[1]) === 'create') {
            try {
              const txt = String(out.text || '').trim()
              let n = null
              const mUrl = txt.match(/\/issues\/(\d+)/)
              if (mUrl) n = mUrl[1]
              else {
                try { const j = JSON.parse(txt); n = j.number || j.id || (Array.isArray(j) && j[0] && j[0].number) } catch {}
                if (!n) { const mNum = txt.match(/\b(\d{1,6})\b/); if (mNum) n = mNum[1] }
              }
              if (n) {
                pushIssuePathEvent(n, 'gh-create')
                try { cache = { ts: 0, snapshot: null, error: null, cwd: cwd } } catch {}
              }
            } catch {}
          } else {
            const hasAssignee = a.indexOf('--add-assignee') >= 0
            if (!hasAssignee) {
              let hit = null
              for (let i = 2; i < a.length; i++) if (/^\d+$/.test(String(a[i]))) { hit = a[i]; break }
              if (hit) {
                pushIssuePathEvent(hit, 'gh-edit')
                try { cache = { ts: 0, snapshot: null, error: null, cwd: cwd } } catch {}
              }
            }
          }
        }
      } catch (e) { /* 检测失败不影响主流程 */ }
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
      const platform = await getPlatform()
      return platform.resolveExecutable('git')
    }

    // 用户主目录（#171 已迁 platform.getHome；原 cmd.exe 探测仅 win32 生效，现平台层统一）
    async function getHome() {
      const platform = await getPlatform()
      return platform.getHome()
    }

    // ============ issuePath · 1A\+1B 事件队列 ============
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
      const platform = await getPlatform()
      const cwd0 = (typeof process !== 'undefined' && process.cwd) ? process.cwd() : DEFAULT_CWD
      if (!cwd0) return null
      cacheDirResolved = platform.path.join(cwd0, '.dsh-mattskillsdeck-cache')
      try { const pfs = platform.fs; if (pfs !== undefined && typeof pfs.mkdir === 'function') await pfs.mkdir(cacheDirResolved) } catch (e) { /* 已存在或不可建，writeText 会自建 */ }
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
        const platform = await getPlatform()
        const t = await platform.fs.resolve(platform.path.join(dir, fn))
        await fs.writeText(t, JSON.stringify(snap))
      } catch (e) { /* 写失败不影响主流程 */ }
    }

    async function getRepoKey(cwd) {
      const key = cwd || DEFAULT_CWD
      if (repoKeys[key]) return repoKeys[key]
      // v1.5 T11（map#37 · #38 R1 + #40 R2 输入）：
      //   多远程下 gh 必选 upstream（context/remote.go::remoteNameSortScore upstream(3)>github(2)>origin(1)），
      //   无参 `gh repo view` 永远返回原作者。改为：显式 `git remote get-url origin` + parseGithubRepo 首选，
      //   失败再 .git/config 直读，兜底才用 gh repo view（同 checkRepo 已用方案同源）。
      const root = await getRepoRoot(key)
      const execCwd = root || key
      // Tier 1：git remote get-url origin + parseGithubRepo（SSH/HTTPS 都由 parseRegex 覆盖）
      const git = await resolveGit()
      if (git) {
        const r = await execProc([git, '-C', execCwd, 'remote', 'get-url', 'origin'], execCwd)
        if (r.ok) {
          const k = parseGithubRepo(r.text)
          if (k) { repoKeys[key] = k; return k }
        }
      }
      // Tier 2：.git/config 直读 origin（git 二进制不可用 / `remote get-url` 失败时）
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
      // Tier 3：gh repo view 兜底（非 GitHub 仓库 / 边缘情况；保持向后兼容）
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
      // 回退：gh issue list（无 avatar，仅 login；UI 将回退为 person SVG）
      const argsAll = ['issue', 'list', '--state', 'all', '--limit', '500', '--json', 'number,title,labels,state,assignees,author,updatedAt,createdAt']
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

    async function buildSnapshot(cwd) {
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
          // select 三级联
          const sel = await reg.select(handle, ctxSel)
          selection = sel
          if (sel && sel.backendId) {
            try { repository = reg.describe(handle, sel.backendId) } catch {}
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
          backendModules = regM.modules().map(function (m) { return Object.assign({ id: m.id, label: m.label, presentation: m.presentation }, m.links ? { links: m.links } : {}, m.capabilities ? { capabilities: m.capabilities } : {}, m.prompts ? { prompts: m.prompts } : {}) })
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
      if (!exe) return { ok: false, level: 'bad', detail: (lang === 'en') ? 'gh not found — install GitHub CLI first (https://cli.github.com/)' : 'gh 未找到，请先安装 GitHub CLI（https://cli.github.com/）', hint: '请为 DSH 安装 GitHub CLI（gh）—— 面板所有数据依赖 gh：\n\n1. 先检查：终端执行 gh --version；有版本号输出 → 直接汇报已装版本并结束，不要重复安装；\n2. 无 gh 则按 OS 安装：Windows → winget install --id GitHub.cli; macOS → rew install gh; Linux → sudo apt install gh;\n3. 安装后验证：重开终端使 PATH 生效，gh --version 输出版本号；\n4. 若 gh 已装但 DSH 仍报未安装：点环境检查「重测」按钮或重启 DSH Desktop；\n5. 完成后汇报：gh 版本号 + 「gh CLI 可用」项已变绿。', repo: null }
      return { ok: true, level: 'ok', detail: exe, hint: '', repo: null }
    }

    // 检查 5 · gh 已登录
    async function checkGhAuth(lang) {
      const r = await runGh(['auth', 'status'])
      if (r.ok) {
        const first = (r.text || '').split(/\r?\n/).map(function (s) { return s.trim() }).filter(Boolean)[0]
        return { ok: true, level: 'ok', detail: first || ((lang === 'en') ? 'Logged in' : '已登录'), hint: '', repo: null }
      }
      return { ok: false, level: 'bad', detail: (lang === 'en') ? 'Not logged into GitHub: run gh auth login (browser auth; official docs in hint)' : '未登录 GitHub：运行 gh auth login（浏览器授权，官方文档见 hint）', hint: 'prompt:ghAuthLogin', repo: null }
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
            const platform = await getPlatform()
            const probePath = await platform.path.joinHome(SKILL_PROBE_DIRS[i], name)
            const info = await platform.fs.lstat(probePath)
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

    // ============ RPC（#152 · 探测编排：wf.detect 新 RPC + wf.status 薄兼容派生）============
    // 第一性原理：前端只调 wf.detect/wf.status 拿 DetectionResult（#150 Q1）；探测零 OS 直碰经 platform；
    // per-workspace 按 handleKey=cwd|refId 内存 Map 不落盘（Q3）；pending 不缓存（Q6）；唯一写路径 wf.bind→registry.bind（Q4）
    harness.handle('wf.detect', async function (args) {
      const cwd = (args && args.cwd) || DEFAULT_CWD
      const force = !!(args && args.force)
      // #195 修复：force 探测清空 gh 解析缓存（旧实现首次失败永久缓存，force 也救不回来）
      if (force) resetGhCache()
      try {
        const svc = await getDetectionService()
        const res = await svc.detect({ cwd }, { force })
        // 对抗式：ensure DetectionResult 形态（含 selection/pending/multiHit，按 #125）
        return { ok: true, ...res }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    })
    harness.handle('wf.status', async function (args) {
      const cwd = (args && args.cwd) || DEFAULT_CWD
      const force = !!(args && args.force)
      const lang = (args && args.lang === 'en') ? 'en' : 'zh'
      // #195 修复：force 探测清空 gh 解析缓存（旧实现首次失败永久缓存）
      if (force) resetGhCache()
      const now = Date.now()
      // 尝试编排层：优先走 detectionService（Q7 DetectionResult + preflight + skillProbes → 派生 9 checks 薄兼容）
      try {
        const svc = await getDetectionService()
        const det = await svc.detect({ cwd }, { force })
        const sel = det.selection
        const backendId = sel && sel.backendId
        const cacheKeyOk = !force && statusCache.status && statusCache.cwd === cwd && statusCache.lang === lang && statusCache.backendId === (backendId || null) && now - statusCache.ts < STATUS_CACHE_MS
        // #195 修复：env 失败不走缓存（避免已装仍报未装）
        if (cacheKeyOk) {
          const cachedChecks = statusCache.status && statusCache.status.checks
          const cachedGh = cachedChecks && cachedChecks.find(function(c){ return c.id===4 })
          const isCachedEnv = cachedGh && cachedGh.level==='bad' && cachedGh.hint && cachedGh.hint.includes('GitHub CLI')
          if (!isCachedEnv) return statusCache.status
        }
        // #229 目录视图主线：通用目录 + 当前后端目录合并（9→N 动态，物理隔离：跨后端无关行不存在）。
        // 失败（模块导入受限 / 派生异常 / 空结果）→ 落入下方 legacy 9 项兼容视图，不抛不阻断。
        try {
          const derMod = await import('./tracker/statusDerive.js')
          if (derMod && typeof derMod.deriveStatusView === 'function') {
            let _repoChkMemo = null
            const derived = await derMod.deriveStatusView({
              cwd: cwd,
              lang: lang,
              platform: await getPlatform(),
              selection: sel || null,
              delegates: {
                // 委托既有探测实现（零重复造轮子）；repo 定位惰性 + 记忆化（非 github 后端不白跑 git 探测）
                github: async function () {
                  if (!_repoChkMemo) _repoChkMemo = await checkRepo(cwd, lang)
                  const c4 = await checkGhCli(lang)
                  const c5 = await checkGhAuth(lang)
                  const c6 = await checkApi(cwd, _repoChkMemo.repo, lang)
                  return { c1: _repoChkMemo, c4: c4, c5: c5, c6: c6 }
                },
                skillProbe: async function (name) { return probeSkill(name, lang) },
              },
            })
            if (derived && Array.isArray(derived.checks) && derived.checks.length) {
              const statusDir = {
                ok: true,
                updatedAt: new Date().toISOString(),
                cwd: cwd,
                repo: derived.repoRef || null,
                ghPath: ghPath,
                checks: derived.checks,
                // 口径（#246 删 na · #229）：pending 不计入分子分母
                ready: derived.ready,
                total: derived.total,
                view: derived.view,
                sections: derived.sections,
                // 新增：编排层真源（Q7），与 legacy 视图同构透传
                selection: sel,
                detection: det,
              }
              // #195 同款启发式：github env 失败不入缓存（gh 行 bad 且带安装引导）
              const curGhD = statusDir.checks.find(function(c){ return c.key === 'gh:installed' || c.id === 4 })
              const isCurEnvD = !!(curGhD && curGhD.level === 'bad' && curGhD.hint && String(curGhD.hint).includes('GitHub CLI'))
              if (!isCurEnvD) statusCache = { ts: Date.now(), status: statusDir, error: null, cwd: cwd, lang: lang, backendId: backendId || null }
              else statusCache = { ts: 0, status: null, error: null, cwd: null, lang: null, backendId: null }
              return statusDir
            }
          }
        } catch (eDir) {
          /* 目录派生不可用 → legacy 兼容视图 */ }
        // 派生 9 checks 兼容视图（#150 Q7：checks 过渡期后可 deprecate，仅 selection 为真源）
        // 1) repo 定位（复用 detection repoHandle + 轻量 git 探测兜底，保持与旧 checkRepo 等价）
        const c1Legacy = await checkRepo(cwd, lang)
        // 2-3) setup/tracker 由 explicit 解析二合一（parseIssueTracker 高置信→ok，否则 warn；空→bad）
        const parsed = det.explicit && det.explicit.parsed
        let c2, c3
        if (parsed && parsed.explicitBackendId) {
          c2 = { ok: true, level: 'ok', detail: (lang==='en') ? 'docs/agents/issue-tracker.md exists' : 'docs/agents/issue-tracker.md 存在', hint: '' }
          const labelMap = { github: 'GitHub Issues + gh CLI', gitlab: 'GitLab Issues + glab', markdown: 'Local Markdown (.scratch)' }
          const lbl = labelMap[parsed.explicitBackendId] || parsed.explicitBackendId
          c3 = { ok: true, level: 'ok', detail: lbl, hint: '' }
        } else {
          c2 = await checkSetup(cwd, lang)
          // 若无显式声明但 selection 已命中某后端，视为 tracker 已决
          if (backendId) c3 = { ok: true, level: 'ok', detail: backendId, hint: '' }
          else c3 = await checkTracker(cwd, lang)
        }
        // 4-6) gh/cli/auth/api 聚合自 preflight（命中后惰性；Q6），未命中 fallback 保留旧三项
        let c4, c5, c6
        if (det.preflight) {
          const kind = det.preflight.error && det.preflight.error.kind
          const msg = det.preflight.error && det.preflight.error.message || ''
          // #幽灵修复：preflight 是「选中后端」的环境门禁。非 github 后端（gitlab/markdown…）的 env 失败
          // （如 glab not found）≠ gh 未安装——c4「gh CLI 可用」/c5「gh 已登录」必须真实独立探测主机 gh
          // （装没装 gh 与后端无关），后端 preflight 只承载 c6（后端真实环境，如 glab/path/网络）。
          if (backendId && backendId !== 'github') {
            c4 = await checkGhCli(lang)
            c5 = await checkGhAuth(lang)
            c6 = det.preflight.ok
              ? { ok: true, level: 'ok', detail: 'preflight ok (' + backendId + ')', hint: '' }
              : { ok: false, level: 'bad', detail: msg.slice(0, 200), hint: (det.preflight && det.preflight.prompt) || '' }
          } else if (det.preflight.ok) {
            c4 = { ok: true, level: 'ok', detail: ghPath || 'gh', hint: '' }
            c5 = { ok: true, level: 'ok', detail: (lang==='en') ? 'Logged in' : '已登录', hint: '' }
            c6 = { ok: true, level: 'ok', detail: 'api.github.com 200', hint: '' }
          } else if (kind === 'env') {
            // #195 修复：hint 升级为 prompt:installGh（与 installSkills / ghAuthGuide 同模式），UI 主按钮自动 inject
            c4 = { ok: false, level: 'bad', detail: (lang==='en') ? 'gh not found — install GitHub CLI first (https://cli.github.com/)' : 'gh 未找到，请先安装 GitHub CLI（https://cli.github.com/）', hint: (det.preflight && det.preflight.prompt) ? det.preflight.prompt : '请为 DSH 安装 GitHub CLI（gh）—— 面板所有数据依赖 gh：\n\n1. 先检查：终端执行 gh --version;\n2. 无 gh 则按 OS 安装：Windows → winget install --id GitHub.cli; macOS → rew install gh; Linux → sudo apt install gh;\n3. 安装后验证：gh --version;\n4. 若 gh 已装但 DSH 仍报未安装：点「重测」或重启 DSH；\n5. 完成后汇报。' }
            c5 = { ok: false, level: 'bad', detail: (lang==='en') ? 'Not logged into GitHub: run gh auth login' : '未登录 GitHub：运行 gh auth login', hint: 'prompt:ghAuthLogin' }
            c6 = { ok: false, level: 'bad', detail: msg.slice(0,200), hint: '' }
          } else if (kind === 'auth') {
            c4 = { ok: true, level: 'ok', detail: ghPath || 'gh', hint: '' }
            c5 = { ok: false, level: 'bad', detail: (lang==='en') ? 'Not logged into GitHub: run gh auth login' : '未登录 GitHub：运行 gh auth login', hint: 'prompt:ghAuthLogin' }
            c6 = { ok: false, level: 'bad', detail: msg.slice(0,200), hint: '' }
          } else {
            c4 = { ok: true, level: 'ok', detail: ghPath || 'gh', hint: '' }
            c5 = { ok: true, level: 'ok', detail: (lang==='en') ? 'Logged in' : '已登录', hint: '' }
            c6 = { ok: false, level: 'bad', detail: msg.slice(0,200), hint: '' }
          }
        } else if (backendId && !det.selection.pending) {
          // 命中但 preflight 尚未产出（lazy 未调），回退旧三项以保兼容
          c4 = await checkGhCli(lang)
          c5 = await checkGhAuth(lang)
          c6 = await checkApi(cwd, c1Legacy.repo, lang)
        } else {
          // pending/fallback 场景不调 preflight（Q6），相应项 surface 为 pending 阻塞态
          if (sel && sel.pending) {
            const hint = 'pending:explicit-bind'
            const pendingDetail = (lang==='en') ? 'Detecting… pending (select a backend or retry)' : '探测未决 · 等待/建议显式选择'
            c4 = { ok: false, level: 'warn', detail: pendingDetail, hint }
            c5 = { ok: false, level: 'warn', detail: pendingDetail, hint }
            c6 = { ok: false, level: 'warn', detail: pendingDetail, hint }
          } else {
            c4 = await checkGhCli(lang)
            c5 = await checkGhAuth(lang)
            c6 = await checkApi(cwd, c1Legacy.repo, lang)
          }
        }
        // 7-9) skill 正交（复用 det.skillProbes，若无则回退 probeSkill）
        let c7, c8, c9
        if (det.skillProbes && det.skillProbes.probes) {
          const p = det.skillProbes.probes
          const toCheck = (name) => {
            const r = p[name]
            if (!r) return { ok: false, level: 'bad', detail: (lang==='en') ? 'Not installed' : '未安装', hint: 'prompt:installSkills' }
            return { ok: r.level==='ok', level: r.level, detail: r.detail, hint: r.hint }
          }
          c7 = toCheck(SKILL_PROBE_NAMES[0])
          c8 = toCheck(SKILL_PROBE_NAMES[5]) // ask-matt 正位（#149 C8 triage→ask-matt）
          // suite 聚合
          const missing = det.skillProbes.missing || []
          if (!missing.length) c9 = { ok: true, level: 'ok', detail: (lang==='en') ? 'Core skill suite installed (' + SKILL_PROBE_NAMES.length + ')' : '核心技能套件已安装（' + SKILL_PROBE_NAMES.length + ' 个）', hint: '' }
          else c9 = { ok: false, level: 'bad', detail: (lang==='en') ? 'Missing: ' + missing.join(' / ') : '缺失：' + missing.join(' / '), hint: 'prompt:installSkills' }
        } else {
          c7 = await probeSkill(SKILL_PROBE_NAMES[0], lang)
          c8 = await probeSkill(SKILL_PROBE_NAMES[5], lang)
          c9 = await probeSkillSuite(lang)
        }
        const raw = [c1Legacy, c2, c3, c4, c5, c6, c7, c8, c9]
        const checks = raw.map(function (c, i) {
          // 覆盖层提示：multiHit 透传纠正入口（Q5）
          let hint = c.hint
          if (i===2 && sel && sel.multiHit) hint = (hint ? hint + ' ' : '') + 'multiHit:' + sel.multiHit.join(',')
          if (sel && sel.pending && i>=3 && i<=5 && c.level!=='warn') { /* pending 已在 4-6 处理 */ }
          return { id: i + 1, name: CHECK_NAMES(lang)[i], ok: c.level === 'ok', level: c.level, detail: c.detail, hint: hint }
        })
        const status = {
          ok: true,
          updatedAt: new Date().toISOString(),
          cwd: cwd,
          repo: c1Legacy.repo,
          ghPath: ghPath,
          checks: checks,
          ready: checks.filter(function (c) { return c.ok }).length,
          total: checks.length,
          // 新增：编排层真源（Q7）
          selection: sel,
          detection: det,
        }
        // #195 修复：env 失败不入缓存（见上）
        const curGh = status && status.checks && status.checks.find(function(c){ return c.id===4 })
        const isCurEnv = curGh && curGh.level==='bad' && curGh.hint && curGh.hint.includes('GitHub CLI')
        if (!isCurEnv) statusCache = { ts: Date.now(), status: status, error: null, cwd: cwd, lang: lang, backendId: backendId || null }
        else statusCache = { ts: 0, status: null, error: null, cwd: null, lang: null, backendId: null }
        return status
      } catch (e) {
        // 编排失败回退旧路径（保守）
      }
      if (!force && statusCache.status && statusCache.cwd === cwd && statusCache.lang === lang && now - statusCache.ts < STATUS_CACHE_MS) return statusCache.status
      try {
        const status = await buildStatus(cwd, lang)
        // #195 修复：env 失败不入缓存（buildStatus 回退路径）
        const curGh2 = status && status.checks && status.checks.find(function(c){ return c.id===4 })
        const isCurEnv2 = curGh2 && curGh2.level==='bad' && curGh2.hint && curGh2.hint.includes('GitHub CLI')
        if (!isCurEnv2) statusCache = { ts: Date.now(), status: status, error: null, cwd: cwd, lang: lang, backendId: null }
        else statusCache = { ts: 0, status: null, error: null, cwd: null, lang: null, backendId: null }
        return status
      } catch (e) {
        statusCache = { ts: Date.now(), status: null, error: String((e && e.message) || e), cwd: cwd, lang: lang, backendId: null }
        return { ok: false, error: String((e && e.message) || e), checks: [], ready: 0, total: CHECK_NAMES(lang).length }
      }
    })

    // #228 链渲染器主机侧：通用链快照（契约层纯函数求值，谓词只读探测，失败返回不抛，超时 pending）
    harness.handle('wf.chain', async function (args) {
      const cwd = (args && args.cwd) || DEFAULT_CWD
      const force = !!(args && args.force)
      if (force) resetGhCache()
      try{
        const platform = await getPlatform()
        const selMod = await getDetectionService().then(function(svc){ return svc.detect({ cwd }, { force }) }).catch(function(){ return null })
        let backendId = args && args.backendId
        if (!backendId && selMod && selMod.selection && selMod.selection.backendId) backendId = selMod.selection.backendId
        const genMod = await import('./tracker/generic.js')
        const predMod = await import('./tracker/predicateRegistry.js')
        const registry = predMod.createPredicateRegistry({ timeout: 3000 })
        if (typeof genMod.registerGenericPredicates === 'function') genMod.registerGenericPredicates(registry)
        const ctx = { platform: platform, backendId: backendId || null, cwd: cwd, selection: selMod && selMod.selection, explicitBackendId: selMod && selMod.explicit && selMod.explicit.parsed && selMod.explicit.parsed.explicitBackendId }
        const kind = (args && args.kind) || 'all'
        const chainAndSnap = await genMod.resolveGenericChain(registry, ctx, kind)
        let backendChain = null
        try{
          if (backendId) {
            const catMod2 = await import('../shared/tracker/check-catalog.js')
            const chainMod = await import('../shared/tracker/chain.js')
            const items = (catMod2.catalogFor ? catMod2.catalogFor(backendId) : []).filter(function(c){ return c.scope==='backend' }).map(function(ci){ return catMod2.catalogItemToCheckItem ? catMod2.catalogItemToCheckItem(ci) : null }).filter(Boolean)
            if (items.length) {
              const errs = chainMod.validateChain ? chainMod.validateChain(items) : []
              backendChain = { chain: items, errors: errs }
            }
          }
        }catch(e){}
        return { ok: true, backendId: backendId || null, chain: chainAndSnap.chain, resolved: chainAndSnap.resolved, snapshot: chainAndSnap.snapshot, backendChain: backendChain }
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
      const cwd = (args && args.cwd) || DEFAULT_CWD
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
        return { ok: false, error: errText(e), env: { ghError: ghLastError } }
      }
    })

    harness.handle('wf.refresh', async function (args) {
      const cwd = (args && args.cwd) || DEFAULT_CWD
      // #195 修复：用户主动刷新时清空 gh 解析缓存，强制重探
      resetGhCache()
      try {
        const snap = await buildSnapshot(cwd)
        // v1.5 T9：刷新后落盘，下次重启秒开
        await writeDiskCache(snap.repo, snap)
        return adoptSnapshot(snap, cwd)
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
      const cwd = (args && args.cwd) || DEFAULT_CWD
      const backendId = args && ('backendId' in args ? args.backendId : args.backend)
      try {
        const reg = await getTrackerRegistry()
        if (!reg) return { ok: false, error: 'registry unavailable' }
        const handle = { cwd: cwd }
        // null = 显式无后端（Other 逃生舱）；'other' 已弃用按 registry 拒绝
        reg.bind(handle, backendId === undefined ? null : backendId)
        // 失效快照 + 状态 + 探测三缓存（per-workspace 切换不串台，Q3；workspaceStore 内存单例失效）
        cache = { ts: 0, snapshot: null, error: null, cwd: null }
        try { statusCache = { ts: 0, status: null, error: null, cwd: null, lang: null, backendId: null } } catch {}
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
        const mods = reg.modules().map(function(m){ return Object.assign({ id: m.id, label: m.label, presentation: m.presentation }, m.setupPrompt ? { setupPrompt: m.setupPrompt } : {}, m.links ? { links: m.links } : {}, m.capabilities ? { capabilities: m.capabilities } : {}, m.prompts ? { prompts: m.prompts } : {}, m.openRepository ? { openRepository: m.openRepository } : {}) }) // #230：转发后端声明的 setup 描述数据键（键入 locale）
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
      const cwd = (args && args.cwd) || DEFAULT_CWD
      if (!n) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
      try {
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
      const cwd = (args && args.cwd) || DEFAULT_CWD
      if (!n) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
      try {
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
      const cwd = (args && args.cwd) || DEFAULT_CWD
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
      try { pushIssuePathEvent(n, 'claim') } catch (e) {}
      return { ok: true, number: n, assignedTo: assignedTo, url: 'https://github.com/' + repo.owner + '/' + repo.name + '/issues/' + String(n) }
    })

        // ============ issuePath · 1A+1B 推送通道（client 轮询） ============
    harness.handle('wf.issuePathPoll', async function (args) {
      const since = args && typeof args.since === 'number' ? args.since : 0
      const out = pendingIssuePathEvents.filter(function (e) { return e.ts > since })
      return { ok: true, events: out.slice(-100), serverNow: Date.now() }
    })
    harness.handle('wf.issuePathPush', async function (args) {
      const n = args && args.number
      const src = args && args.source ? String(args.source) : 'mention'
      if (!n) return { ok: false, error: '缺少 number' }
      pushIssuePathEvent(n, src, args && args.title)
      return { ok: true }
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
    let _namingState = null            // { version:1, sessions:{sid:跟踪态} } 内存态（加载自磁盘，变更防抖落盘）
    let _namingStateDirty = false
    let _namingPersistTimer = null
    let _namingLoopTimer = null
    function namingDefaultState() { return { version: 1, sessions: {} } }
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
              if (j && j.version === 1 && j.sessions && typeof j.sessions === 'object') { _namingState = j; if (!_namingState.sessions) _namingState.sessions = {} }
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

    harness.handle('wf.namingRegister', async function (args) {
      const sid = args && args.sessionId
      const baseline = args && args.baselineTitle
      if (!sid || !baseline) return { ok: false, error: { kind: 'parse', message: '缺少 sessionId/baselineTitle' } }
      const core = await getNamingCore()
      if (!core || !core.isPlaceholderTitle(baseline)) return { ok: false, error: { kind: 'parse', message: 'baselineTitle 非占位四式' } }
      const st = await loadNamingState()
      if (!st.sessions[sid]) st.sessions[sid] = core.createTrackingState({ sessionId: sid, baselineTitle: baseline, repoKey: (args && args.repoKey) || null })
      if (args && args.hint) st.sessions[sid] = core.reduceTrackingState(st.sessions[sid], { type: 'signal', hint: String(args.hint).slice(0, 80) })
      // 即时持久化（#265 崩溃窗口补强）：注册只在会话创建时发生一次，若只走防抖，宽限期内进程
      // 被杀会让该会话永久失察（客户端不会重注册）——关键事件必须落盘后才算受理。
      await persistNamingState()
      return { ok: true }
    })

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
      if (!core) return { ok: true, orders: [] }
      const st = await loadNamingState()
      const orders = []
      for (const sid in st.sessions) {
        const o = core.planOrderFor(st.sessions[sid], Date.now(), core.NAMING_HINT_GRACE_MS)
        if (o) orders.push(o)
      }
      return { ok: true, orders: orders }
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
      // failed 不动账不写盘（留待下一轮渲染钩子重试；#267 收口有限重试预算）。
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
      return { ok: true }
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
          // 失效 repoRoots 缓存
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
          const repoUrl = (kind === 'already-exists' && currentUser) ? ('https://github.com/' + currentUser + '/' + name) : undefined
          return { ok: false, errorKind: kind, error: cr.error, repoUrl: repoUrl }
        }
      } else {
        // origin 已存在：先创建远程仓库（不带 --source），再 set-url + push
        const cr2 = await runGh(['repo', 'create', name, visFlag], cwd)
        if (!cr2.ok) {
          const kind = classifyCreateError(cr2.error, cr2.kind)
          const repoUrl = (kind === 'already-exists' && currentUser) ? ('https://github.com/' + currentUser + '/' + name) : undefined
          return { ok: false, errorKind: kind, error: cr2.error, repoUrl: repoUrl }
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
          return { ok: false, errorKind: kind, error: pushR.error }
        }
      }
      // 成功后失效全部缓存，使头部 owner/repo 立即出现
      cache = { ts: 0, snapshot: null, error: null, cwd: null }
      statusCache = { ts: 0, status: null, error: null, cwd: null, lang: null }
      if (cwd && repoKeys[cwd] !== undefined) delete repoKeys[cwd]
      if (repoKeys[DEFAULT_CWD] !== undefined) delete repoKeys[DEFAULT_CWD]
      if (cwd && repoRoots[cwd] !== undefined) delete repoRoots[cwd]
      if (repoRoots[DEFAULT_CWD] !== undefined) delete repoRoots[DEFAULT_CWD]
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
      return { ok: true, repo: { owner: owner, name: name } }
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
