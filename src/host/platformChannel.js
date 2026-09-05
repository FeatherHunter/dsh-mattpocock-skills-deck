// src/host/platformChannel.js —— 平台与探测通道（H1 #445 从 host/index.js 259–491 搬出，纯结构、行为零变化）
// 以后谁改它：改平台抽象、后端注册表或探测级联的人。预估约 280 行，超 350 打回。
// 接线：由 index.js 动态 import 动态加载；STATUS_CACHE_MS 随本文件搬入（无外部引用）；getMattSkillProbeNames/probeSkill 显式注入；本文件不引用其他新文件。
export function createPlatformChannel(deps) {
  const { ctx, subprocess, timer, fs, DEFAULT_CWD, TIMEOUT_MS, getMattSkillProbeNames, probeSkill, logCtx } = deps
  // #491 房内接线（O2）：backendCtx 不再传空对象。log 兼容旧 ctx.log.warn(text) 调用（只记散列）；logEvent/isEnabled 供房内未来 45 事件埋点（另票）。
  function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  const backendLogCtx = (logCtx && typeof logCtx.fire === 'function') ? logCtx : null
  function backendLogEvent(level, event, fields) { try { if (backendLogCtx) backendLogCtx.fire(level, event, fields) } catch (e) {} }
  function backendLogEnabled(level) { try { return backendLogCtx ? backendLogCtx.isEnabled(level) : (level === 'error' || level === 'warn') } catch (e) { return level === 'error' || level === 'warn' } }
  function backendCompatLog(level, text) { try { const lv = (level === 'debug') ? 'debug' : ((level === 'info') ? 'info' : ((level === 'error') ? 'error' : 'warn')); if (backendLogCtx) backendLogCtx.fire(lv, 'backend.diagnostic', { errorHash: hash8(text) }) } catch (e) {} }
  const backendLogCompat = { info: function (m) { backendCompatLog('info', m) }, warn: function (m) { backendCompatLog('warn', m) }, error: function (m) { backendCompatLog('error', m) }, debug: function (m) { backendCompatLog('debug', m) } }
  const backendCtxForRooms = { log: backendLogCompat, logEvent: backendLogEvent, isEnabled: backendLogEnabled }
  const STATUS_CACHE_MS = 30000  // workspaceStore 探测级联 TTL（#344 沿革 · #284 保留；原 index.js 234 行）
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
          const regMod = await import('./tracker/registryCore.js') // V1 #461：registry.js 已拆为三块，装配入口为 registryCore.js
          const createRegistry = regMod.createRegistry || regMod.default
          const reg = createRegistry(backendCtxForRooms, { matchesTimeout: 3000 })
          // 注册内置后端（github/markdown/gitlab），失败忽略（保持可用）
          try {
            const ghMod = await import('./tracker/backends/github/index.js')
            const m = ghMod.githubModule || ghMod.defaultModule || ghMod.default
            if (m && m.id) try { reg.register(m) } catch {}
          } catch {}
          try {
            const mdMod = await import('./tracker/backends/markdown/index.js')
            // #230（D10）修复 2026-08-28：必须注册【完整模块】——markdownModule 携带 setupPrompt 键表（locale 键名），
            //   wf.registry 原样转发到 st.backendModules，setupRunPrompt 按它取 markdown 模板文案（"本地 Markdown 模板…"）。
            //   此前 host 重新拼装只保留 id/label/presentation/create/matches，setupPrompt 丢失 → 弹窗选 markdown 后
            //   注入的 setup 提示词落入缺省键组（GitHub 模板，谎称"已按默认 GitHub 初始化"），导致错误地生成 GitHub 主锚。
            const fullMdModule = mdMod.markdownModule || null
            let mdModule = fullMdModule
            if (!mdModule) {
              const mkCreate = mdMod.createMarkdownBackend || mdMod.createBackend || mdMod.default
              const mkMatches = mdMod.matches
              const mdPresentation = mdMod.markdownModule?.presentation || mdMod.presentation
              mdModule = mkCreate ? { id: 'markdown', label: 'Markdown', presentation: mdPresentation || { color: '#1a7f37' }, create: mkCreate, matches: mkMatches || (async()=>false) } : null
            }
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
            const regMod2 = await import('./tracker/registryCore.js') // V1 #461：同上（回落分支）
            const cr = regMod2.createRegistry || regMod2.default
            _trackerRegistry = cr(backendCtxForRooms, { matchesTimeout: 3000 })
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
    let lastPlatformOk = null
    async function getPlatform() {
      const platT0 = Date.now()
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
      try { const okNow = !!_platform; if (logCtx && logCtx.isEnabled('debug') && okNow !== lastPlatformOk) { lastPlatformOk = okNow; logCtx.fire('debug', 'platform.resolve', function () { return { name: 'platform', ok: okNow, latencyMs: Date.now() - platT0 } }) } } catch (eL) {}
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
        _workspaceStore = create({ ttl: STATUS_CACHE_MS, logCtx: logCtx })
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
        // skillProbe 内联（复用 probeSkill 双源逻辑；列表 = shared/matt-skills.js 单源，25 项）
        // #280/#fix-banner：旧版硬编码 10 名，遗漏 grill-with-docs / wizard / grill-me / to-questionnaire / wait-what / writing-for-agents 等导致横幅永远报警
        const skillProbe = async ({ cwd }) => {
          // probeNames ≈ shared/matt-skills.js:MATT_SKILL_PROBE_NAMES（单源）；改探测集只改 shared 一处即可
          const probeNames = await getMattSkillProbeNames()
          const probes = {}
          let missing = []
          let hasPending = false
          let pendingError = null
          for (let i = 0; i < probeNames.length; i++) {
            const name = probeNames[i]
            try {
              const r = await probeSkill(name, 'zh', cwd)
              probes[name] = r
              if (r.level === 'pending') { hasPending = true; if (!pendingError && r.error) pendingError = r.error }
              else if (r.level !== 'ok') missing.push(name)
            } catch (e) { const err = String((e && e.message) || e); probes[name] = { ok: false, level: 'bad', detail: err, hint: 'prompt:installSkills', error: err }; missing.push(name) }
          }
          const ok = missing.length === 0 && !hasPending
          return { ok, missing, probes, hasPending, pendingError, pending: hasPending }
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
  function clearWorkspaceStore() { try { if (_workspaceStore && typeof _workspaceStore.clear === 'function') _workspaceStore.clear() } catch {} }
  return { getTrackerRegistry, getPlatform, getWorkspaceStore, detectionExec, getDetectionService, clearWorkspaceStore }
}
