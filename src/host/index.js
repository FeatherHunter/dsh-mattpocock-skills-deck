/**
 * dsh-mattpocock-skills-deck �� Host �루���ݲ�ʵ�� �� T3 #345��
 *
 * ʵ�֣�
 *   1. gh ��װ�㣺resolveExecutable ���� �� ���� DSH_GH_PATH/ϵͳ gh��30s ��ʱ��timer race + terminate����
 *      �����һ����auth / network / notfound / exit����
 *   2. ��������gh issue list ö�� wayfinder:map �� ÿ map һ�� GraphQL��subIssues + labels + assignees +
 *      blockedBy + blocking���� ��װ���գ�map ��������� + tickets + stats ���飩��
 *   3. RPC��wf.ping / wf.snapshot��5s ���棩/ wf.refresh��
 *   4. ��ѯ��timer 60s ˢ�»��� + ���ϴ� stats diff��P2 toast Ԥ���ֶΣ���
 *   5. ǰ�ü���̵㣨#344����wf.status ���� 8 ���⣨�ֿⶨλ / setup ���� / tracker=GitHub /
 *      gh CLI / gh ��¼ / API �ɴ� / wayfinder ˫��̽�� / ask-matt ˫��̽�⣩�����
 *      { ok, level, detail, hint }[]��������� 30s��args.force ǿ���ز顣
 *
 * ����֤��.charting/verify.js����ʵ���� PASS�������� frontier/claimed/blocked �� GitHub ҳ��һ�£�
 * 9 �� open map �н� 4 ���� Destination ���� body ����ȫ���ݴ��
 *
 * ���ļ����� = cordis_define �� code.host���� JS �����壬���� Cordis Plugin����
 */

// ===== �淶���ԣ�dynamic dialect����harness Ϊ���ɱ�����pkg entry �ṩ shim =====
export default {
  inject: ['connection'],
  apply(ctx) {
    const subprocess = ctx.get('subprocess')
    const timer = ctx.get('timer')
    const fs = ctx.get('fs')
    if (subprocess === undefined || timer === undefined) return

    // B3 rpc host �� shim��harness.handle('wf.x') �� Map + connection.rpc.handle('/dsws') dispatch
    // ���� C ԭ�����ƺ� pkg ��ڲ��پ� build.mjs ע�� shim����ΪԴ�ļ��Դ������� ReferenceError: harness is not defined
    const __DSW_HANDLERS__ = new Map()
    const harness = {
      handle: (method, fn) => {
        const endpoint = method.replace(/^wf\./, '')
        __DSW_HANDLERS__.set(endpoint, fn)
      }
    }

    // ============ ���� ============
    // v1.5.0������������������ gh ·���� platform.env.get('DSH_GH_PATH')��#171 migrated����ֱ�� process.env��
    // Ĭ�Ϲ����� = DSH ���̵�ǰĿ¼���ɱ� wf.snapshot args.cwd ���ǣ�ȥ����Ӳ���룩
    const DEFAULT_CWD = (typeof process !== 'undefined' && typeof process.cwd === 'function') ? process.cwd() : ''
    const TIMEOUT_MS = 30000
    // v1.3.3 ���٣����ջ��� 5s �� 60s�����򿪻������л��棬����ÿ��ȫ���ؽ� 11 �� gh ���ã�
    const CACHE_MS = 60000
    const STATUS_CACHE_MS = 30000  // ǰ�ü�������棨#344��
    const SKILL_PROBE_DIRS = ['.agents/skills', '.minimax/skills', '.claude/skills']  // #171 migrated: posix canonical via platform.path
    // v1.5 T11 + #149 �޸���ȫ���̺��ļ���̽�������������� prompt ���õļ��� + �������ܣ���� 7/8 ȡǰ��������� 9 �ۺ�ȫ������ �� `setup-matt-pocock-skills` Ϊ 10 ����ͼ���� ��1.1 ����ȱ����λ��#150 Q6��
    const SKILL_PROBE_NAMES = ['wayfinder', 'triage', 'grilling', 'grill-me', 'implement', 'ask-matt', 'research', 'prototype', 'handoff', 'setup-matt-pocock-skills']
    const QUERY = 'query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){issue(number:$n){number title state body url labels(first:20){nodes{name}} subIssues(first:100){totalCount nodes{number title state body url labels(first:10){nodes{name}} assignees(first:10){nodes{login}} blockedBy(first:20){nodes{number title state}} }}}}}'

    // ============ ״̬ ============
    let ghPath = null
    // #195 �޸���ʧ�ܲ����û��� ���� ghLastError ���������һ��ʧ�ܣ�����ʽ���������޸����´� resolveGh ����Ϊ null�������ʵ���״�ʧ����������
    let ghLastError = null
    let repoKeys = {}  // v12��repoKey �� cwd ���棨�л��ֿ�Ựʱ���ٴ��ֿ⣩
    let cacheMap = new Map()
    const CACHE_LRU_MAX = 20
    let cache = { ts: 0, snapshot: null, error: null, cwd: null }
    function normKey(k){ try{ return String(k||'').toLowerCase().replace(/\\/g,'/').replace(/\/+/g,'/').replace(/\/$/,'')||'/'; }catch(e){ return String(k||''); } }
    function touchLRU(map, key, val){ if(map.has(key)) map.delete(key); map.set(key,val); if(map.size>CACHE_LRU_MAX){ const first=map.keys().next().value; map.delete(first); } return val; }
    function getCacheByCwd(cwdRaw){ const k=normKey(cwdRaw); return cacheMap.get(k)||null; }
    function setCacheByCwd(cwdRaw, entry){ const k=normKey(cwdRaw); const e=Object.assign({},entry,{k}); touchLRU(cacheMap,k,e); try{ cache={ts:e.ts||Date.now(), snapshot:e.snapshot||null, error:e.error||null, cwd:cwdRaw}; }catch{} return e; }
    function snapshotVersionOf(snap){ try{ const iss=(snap&&Array.isArray(snap.issues))?snap.issues:[]; const sorted=iss.map(function(x){return String(x.number)+':'+String(x.state||'')+':'+String(x.updatedAt||'')}).sort().join('|'); let h=0; for(let i=0;i<sorted.length;i++) h=((h<<5)-h+sorted.charCodeAt(i))|0; const hex=(h>>>0).toString(16).padStart(8,'0'); try{ if(typeof require==='function'){ const cr=require('crypto'); if(cr&&cr.createHash){ return cr.createHash('sha1').update(sorted).digest('hex').slice(0,12); } } }catch(e){} return hex; }catch(e){ return '0'; } }
    function issueIndexVersion(idx){ try{ const keys=Object.keys(idx||{}).sort(); const str=keys.map(function(k){return k+':'+idx[k]}).join('|'); try{ const cr=require('crypto'); if(cr&&cr.createHash) return cr.createHash('sha1').update(str).digest('hex').slice(0,12); }catch(e){} let h=0; for(let i=0;i<str.length;i++) h=((h<<5)-h+str.charCodeAt(i))|0; return (h>>>0).toString(16).padStart(8,'0'); }catch(e){ return '0'; } }
    let statusCache = { ts: 0, status: null, error: null, cwd: null, lang: null }  // wf.status 30s ���棨�� cwd+lang ���֣�
    let userHome = null                                     // ����ռλ��#171 ��Ǩ platform.getHome�������ƽ̨ memoize��
    // ============ Tracker Registry��#155 �� ���ѡ�� UI��============
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
          // ע�����ú�ˣ�github/markdown/gitlab����ʧ�ܺ��ԣ����ֿ��ã�
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
          // ���䣺�� registry���� explicit ������
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
    // ����Ԥ�ȣ������������̣�
    try { getTrackerRegistry().catch(()=>{}) } catch {}
    // ============ ƽ̨����#171 �� createPlatform ���Ե�����============
    // ��һ��ԭ���ƽ̨���� + ����ƴ + ˫բ���������� ctx.get('platform') ������ fallback���� import �﷨���� D7 dev host vm.Script ������
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
    // ============ ̽�⼶�� �� workspaceStore + detectionService��#152 �� #150 Q1-Q7��============
    // �Ĳ��ϸ� + �����������Ǽ� + per-workspace �ڴ� Map<handleKey��Selection> ������ + pending ������ + wf.bind ������
    let _workspaceStore = null
    let _detectionService = null
    async function getWorkspaceStore() {
      if (_workspaceStore) return _workspaceStore
      try {
        const mod = await import('./tracker/detection/workspaceStore.js')
        const create = mod.createWorkspaceStore || mod.default
        _workspaceStore = create({ ttl: STATUS_CACHE_MS })
        // registry stale �����#150 Q3 unregister stale �� emit bind��
        try {
          const reg = await getTrackerRegistry()
          if (reg && typeof reg.on === 'function') reg.on('bind', (evt) => { if (evt && evt.stale) { try { _workspaceStore.onRegistryBindStale(evt.handle) } catch {} } })
        } catch {}
      } catch { _workspaceStore = { get: () => null, set: () => {}, has: () => false, clear: () => {}, invalidate: () => {}, keys: () => [], onRegistryBindStale: () => {} } }
      return _workspaceStore
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
        // skillProbe ���������� probeSkill ˫Դ�߼���10 ���� setup ��λ��
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
        _detectionService = create({ registry, getPlatform, getFs: () => fsSvc, getTimers: () => ({ setTimeout: (fn, ms) => timer.timeout(fn, ms), clearTimeout: (id) => { try { clearTimeout(id) } catch {} } }), workspaceStore: ws, skillProbe, resolveRepoHandle: async (h) => ({ cwd: h.cwd || '', refId: h.refId || '' }) })
      } catch (e) {
        // ���ף���С������explicit �� matches������ preflight/skill
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

    let lastProbeAtByRepo = {}                            // v1.5 R2 + R2-fix-6��#2 MVP����probe since ʱ������� repoKey ���루ֻ�� probe ��⵽ change ʱ�ƽ���build ���ö��� ���� ������̵�ͬ���ڱ༭���� buildSnapshot ��ע�ͣ�
    let lastIssueIndexByRepo = {}                          // #2 deletion fix�������ϴ�ȫ�� issue ���������ڷ��� GitHub ɾ��/״̬��ʧ
    let pendingIssuePathEvents = []                       // issuePath �� 1A+1B �����У�runGh ������ + wf.claim����client via wf.issuePathPoll ��ȡ��cap 100

    // ============ gh ��װ ============
    // #195 �޸���resolveGh ���ٻ���ʧ�ܣ�ghLastError �����һ��ʧ�ܣ������޸����´�̽�⼴�ָ���
    async function resolveGh() {
      if (ghPath) return ghPath
      const platform = await getPlatform()
      try {
        const p = await platform.resolveExecutable('gh')
        if (p) { ghPath = p; ghLastError = null; return ghPath }
        ghLastError = 'gh �����ã�PATH �� gh���� DSH_GH_PATH δ���ã��ٷ���װ����� https://cli.github.com/��'
        return null
      } catch (e) {
        const fb = platform.env.get('DSH_GH_PATH') || ''
        if (!fb) { ghLastError = 'gh �����ã�PATH �� gh���� DSH_GH_PATH δ���ã��ٷ���װ����� https://cli.github.com/��'; return null }
        try {
          const info = await platform.fs.lstat(fb)
          if (info) { ghPath = fb; ghLastError = null; return ghPath }
        } catch (e2) {}
        ghLastError = 'gh �����ã�PATH �� gh���� DSH_GH_PATH δ���ã��ٷ���װ����� https://cli.github.com/��'
        return null
      }
    }
    // #195 �޸���force ̽��·���� resetGhCache ��ճɹ����棬ǿ���´� resolveGh ��̽
    function resetGhCache() { ghPath = null; ghLastError = null }

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
      // issuePath �� 1A��runGh ��������⣨���ɹ�·����ʧ�ܲ���·����Ⱦ��--add-assignee Ϊ claim ͨ�������� wf.claim ���� source='claim'��
      try {
        const a = Array.isArray(args) ? args : []
        if (a.length >= 2 && a[0] === 'issue' && /^(edit|close|comment|reopen)$/.test(String(a[1]))) {
          const hasAssignee = a.indexOf('--add-assignee') >= 0
          if (!hasAssignee) {
            let hit = null
            for (let i = 2; i < a.length; i++) if (/^\d+$/.test(String(a[i]))) { hit = a[i]; break }
            if (hit) pushIssuePathEvent(hit, 'gh-edit')
          }
        }
      } catch (e) { /* ���ʧ�ܲ�Ӱ�������� */ }
      return { ok: true, text: out.text || '' }
    }

    // ͨ�ý���ִ�У�#344 ǰ�ü���ã�git / cmd �ȣ����� shell�����󲻹�һ����
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

    // �û���Ŀ¼��#171 ��Ǩ platform.getHome��ԭ cmd.exe ̽��� win32 ��Ч����ƽ̨��ͳһ��
    async function getHome() {
      const platform = await getPlatform()
      return platform.getHome()
    }

    // ============ issuePath �� 1A\+1B �¼����� ============
    function pushIssuePathEvent(ref, source, title) {
      const n = Number(ref)
      if (!n || isNaN(n)) return
      pendingIssuePathEvents.push({ ref: n, source: String(source || 'gh-edit'), ts: Date.now(), title: String(title || '') })
      if (pendingIssuePathEvents.length > 100) pendingIssuePathEvents.shift()
    }

    // ============ v1.5 T9��git ����� + ���̻��棨�������뿪��============
    // git rev-parse --show-toplevel ��������Ҹ���Ƕ�ײֿ⣨��Ŀ¼������ .git��git ԭ��ͣ������� ���� �����û�Ҫ��
    let repoRoots = {}           // ��·���� cwd ����
    let cacheDirResolved = null  // ����Ŀ¼�����Խ�����
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
    // ����Ŀ¼��<DSH ���� cwd>/.dsh-mattskillsdeck-cache/��T9 �޸���fs ɳ�� workspace-write ֻ���� cwd �£�
    //   ~/.dsh ��ɳ���ⱻ�� �� ��������д�룻���� process.cwd() ��㣬�������뿪��v1.6.17 ���� waystation �� MattSkillsDeck��
    async function getCacheDir() {
      if (cacheDirResolved) return cacheDirResolved
      const platform = await getPlatform()
      const cwd0 = (typeof process !== 'undefined' && process.cwd) ? process.cwd() : DEFAULT_CWD
      if (!cwd0) return null
      cacheDirResolved = platform.path.join(cwd0, '.dsh-mattskillsdeck-cache')
      try { const pfs = platform.fs; if (pfs !== undefined && typeof pfs.mkdir === 'function') await pfs.mkdir(cacheDirResolved) } catch (e) { /* �Ѵ��ڻ򲻿ɽ���writeText ���Խ� */ }
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
        // T9 �޸���fs ����� writeText Ҫ�� resolve() ���ص� target ����{targetKey,displayPath}��������ֱ�Ӵ�·���ַ���
        const platform = await getPlatform()
        const t = await platform.fs.resolve(platform.path.join(dir, fn))
        await fs.writeText(t, JSON.stringify(snap))
      } catch (e) { /* дʧ�ܲ�Ӱ�������� */ }
    }

    async function getRepoKey(cwd) {
      const key = cwd || DEFAULT_CWD
      if (repoKeys[key]) return repoKeys[key]
      // v1.5 T11��map#37 �� #38 R1 + #40 R2 ���룩��
      //   ��Զ���� gh ��ѡ upstream��context/remote.go::remoteNameSortScore upstream(3)>github(2)>origin(1)����
      //   �޲� `gh repo view` ��Զ����ԭ���ߡ���Ϊ����ʽ `git remote get-url origin` + parseGithubRepo ��ѡ��
      //   ʧ���� .git/config ֱ�������ײ��� gh repo view��ͬ checkRepo ���÷���ͬԴ����
      const root = await getRepoRoot(key)
      const execCwd = root || key
      // Tier 1��git remote get-url origin + parseGithubRepo��SSH/HTTPS ���� parseRegex ���ǣ�
      const git = await resolveGit()
      if (git) {
        const r = await execProc([git, '-C', execCwd, 'remote', 'get-url', 'origin'], execCwd)
        if (r.ok) {
          const k = parseGithubRepo(r.text)
          if (k) { repoKeys[key] = k; return k }
        }
      }
      // Tier 2��.git/config ֱ�� origin��git �����Ʋ����� / `remote get-url` ʧ��ʱ��
      if (fs !== undefined) {
        try {
          const t = await fs.resolve('.git/config', { cwd: execCwd })
          const txt = await fs.readText(t)
          const um = txt.match(/\[remote\s+"origin"\][^[]*url\s*=\s*([^\r\n]+)/)
          if (um) {
            const k = parseGithubRepo(um[1])
            if (k) { repoKeys[key] = k; return k }
          }
        } catch (e) { /* �� Tier 3 */ }
      }
      // Tier 3��gh repo view ���ף��� GitHub �ֿ� / ��Ե��������������ݣ�
      const r = await runGh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], execCwd)
      if (!r.ok) return null
      const s = r.text.trim()
      const i = s.indexOf('/')
      if (i <= 0) return null
      repoKeys[key] = { owner: s.slice(0, i), name: s.slice(i + 1) }
      return repoKeys[key]
    }

    // ============ ������ ============
    // T16������Ԥ���� ���� �� BOM + ���� \n ��ԭΪ��ʵ���У���ʷ����ʽ body Ҳ�ܽ�����
    //   ������������ʵ���м��ٶ����� \n �������ڣ���ƪ��ѹ��һ�У�������������������
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
        const g = l.replace(/^-\s*\[.+?\]\(.+?\)\s*[-�C��]?\s*/, '')
        return { title: t ? t[1] : l, url: t ? t[2] : '', gist: g }
      })
      out.fog = clean(sec['Not yet specified']).filter(function (l) { return l.indexOf('<!--') !== 0 })
      out.outOfScope = clean(sec['Out of scope']).filter(function (l) { return l.indexOf('<!--') !== 0 })
      return out
    }

    // v1.5 T12 �޶���B4�������ȿ��������ê�� ���� ������ = ��Լ�̶��½ڡ�## ���ȣ�N%������ê�������У�������ʾ��/�����ı��ٳ֣�#459/#460 ʵ֤��
    //   1) �����У�## ���ȣ�90%������ markdown ���� �� ���������Σ�
    //   2) ���ױ��壺���ȣ�90% / Progress: 90%���ޱ������ �� ����ע�ͳ�ŵ��
    //   3) ȫ�Ķ��ף�������֣�������Ʊ���ָ�ʽ �� ����󲻽ٳ�ǰ���㣩
    function parseProgress(body) {
      if (!body) return null
      const s = String(body)
      const m = s.match(/^\s*#{1,6}\s*(?:����|Progress)\s*[��:]\s*(\d{1,3})\s*%/im)
        || s.match(/^\s*(?:����|Progress)\s*[��:]\s*(\d{1,3})\s*%/im)
        || s.match(/(?:����|Progress)\s*[��:]\s*(\d{1,3})\s*%/i)
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
        progress: parseProgress(raw.body),  // v1.5 T12��issue ���Ľ��ȿ飨## ���ȣ�N%����null = δ���
      }
    }

    // v1.4��T1 #442����blockedBy DAG �·����ȷֲ�
    //   level(root) = 0������������level(x) = 1 + max(level(����ֱ��������))
    //   ͬ�� = ���������� �� �ɲ��У���� = ���봮�У��ϲ�ȫ closed �Ž�����
    //   ���� { byNumber: {n: level}, levels: [{level, open, closed, total, frontier, claimed, blocked, numbers:[]}] }
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
      // ����״̬ϸ�֣�frontier/claimed/blocked ��㣩
      const openBlocker = function (b) { const t = byNum[b]; return t !== undefined && t.state === 'OPEN' }
      levels.forEach(function (layer) {
        const openT = tickets.filter(function (t) { return byNumber[t.number] === layer.level && t.state === 'OPEN' })
        layer.frontier = openT.filter(function (t) { return !t.claimedBy && !t.blockedBy.some(openBlocker) }).length
        layer.claimed = openT.filter(function (t) { return t.claimedBy }).length
        layer.blocked = openT.filter(function (t) { return !t.claimedBy && t.blockedBy.some(openBlocker) }).length
      })
      // �޳��ն���levels ����������������� undefined��
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
      // v1.4��T1 #442������ DAG �ֲ㣨client ��Ⱦ©���ֲ��ã�
      const lv = computeLevels(tickets)
      return {
        total: tickets.length, open: open.length, closed: closed.length,
        frontier: frontier.length, claimed: claimed.length, blocked: blocked.length,
        levels: lv.levels, levelOf: lv.byNumber,
      }
    }

    async function fetchMaps(cwd) {
      // #44 T2-fix��map#37������ʽ --repo �ƹ� gh �� Fork �ϵĶ�Զ���ƶϣ�upstream ���ȣ�
      const repo = await getRepoKey(cwd)
      const argsMap = ['issue', 'list', '--state', 'open', '--label', 'wayfinder:map', '--json', 'number,title,body,labels,assignees,state,updatedAt']
      if (repo) argsMap.push('--repo', repo.owner + '/' + repo.name)
      const r = await runGh(argsMap, cwd)
      if (!r.ok) return { ok: false, error: r }
      try { return { ok: true, maps: JSON.parse(r.text) } } catch (e) { return { ok: false, error: { kind: 'parse', error: String(e) } } }
    }

    // ȫ�� issue��open + closed��Client �б� open ���ԡ��ײ����ѹرա��۵��У���
    // �� updatedAt ����labels �� name + color��GitHub ����ɫ����state ���� open/closed��
    // v18��assignees ������״̬����ռ�á����б� issue �ھ��������� + ��������
    async function fetchIssues(cwd) {
      // #374/#375��--limit 500 ���ǲֿ�ȫ����2026-08-14 ʵ�� 349 issue���������� createdAt������ά�ȣ�
      // #44 T2-fix��map#37������ʽ --repo �ƹ� gh ��Զ���ƶϣ�ͬ fetchMaps
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

    // #2 deletion fix������ȫ���������ڷ���ɾ�����رպ��ؿ���
    async function fetchIssueIndex(cwd) {
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', error: '�޷����� owner/repo' } }
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
      setCacheByCwd(cwd,{snapshot:snap, version:snap.version||'', ts:Date.now(), error:null})
      if (snap && snap.repo) rememberIssueIndex(snap.repo, issueIndexFromSnapshot(snap))
      return snap
    }
    let pendingByCwd = new Map()
    async function ensureSnapshot(cwdRaw, opts){
      opts=opts||{};
      const cwd = await normCwd(cwdRaw);
      const k = normKey(cwd);
      const defNorm = normKey(DEFAULT_CWD);
      if((!cwdRaw || k===defNorm) && cwd===defNorm){
        try{ const rr=await getRepoRoot(cwd); if(!rr) return {ok:false, error:'not a git repository (DEFAULT_CWD not gitRoot)', kind:'env', notGitRoot:true}; }catch(e){}
      }
      const cached = cacheMap.get(k);
      if(opts.ifNoneMatch && cached && cached.version && cached.version===opts.ifNoneMatch){
        return {ok:true, notModified:true, status:304, version:cached.version, snapshot:cached.snapshot, ts:cached.ts};
      }
      if(pendingByCwd.has(k)) return pendingByCwd.get(k).promise;
      let controller=null; try{ controller=typeof AbortController!=='undefined'?new AbortController():{signal:{aborted:false}, abort(){this.signal.aborted=true}}; }catch(e){ controller={signal:{aborted:false}, abort(){}}; }
      let timerId=null;
      const p=(async()=>{
        try{
          const timeout = new Promise((_,rej)=>{ timerId=setTimeout(()=>{ try{controller.abort();}catch{}; rej(new Error('ensureSnapshot timeout 30s')); },30000); });
          const work=(async()=>{
            if(controller.signal.aborted) throw new Error('aborted');
            const snap=await buildSnapshot(cwd);
            if(!snap||snap.ok!==true) throw new Error((snap&&snap.error)||'build failed');
            try{ const v=snapshotVersionOf(snap); snap.version=v; snap.etag=v; }catch{}
            if(opts.ifNoneMatch && snap.version===opts.ifNoneMatch) return {ok:true, notModified:true, status:304, version:snap.version, snapshot:snap};
            setCacheByCwd(cwd,{snapshot:snap, version:snap.version||'', ts:Date.now(), error:null});
            try{ await writeDiskCache(snap.repo, snap); }catch{}
            return {ok:true, snapshot:snap, version:snap.version, status:200};
          })();
          const res=await Promise.race([work, timeout]);
          return res;
        }catch(e){
          const old=cacheMap.get(k);
          return {ok:false, error:String((e&&e.message)||e), snapshot: old?old.snapshot:null, version: old?old.version:null};
        }finally{
          if(timerId) clearTimeout(timerId);
          pendingByCwd.delete(k);
        }
      })();
      pendingByCwd.set(k,{promise:p, controller:controller});
      return p;
    }



    // v1.5 B5�����ֹѪ �� ��һ��ԭ�����GraphQL ���ľ�ʱ�� REST ����ͨ�� ����
    //   GraphQL �����ӶȼƵ㣨5000 ��/h��aliases ���ѯһ�ο����ٵ㣩��REST ������ƴ�
    //   ��5000 ��/h���븴�Ӷ��޹أ������ľ�ʱ GraphQL ȫ�ң�REST �Կ��� �� ��岻�հס�
    //   �� map��issue ���� + sub_issues + ÿ��Ʊ blocked_by��client ֻ���� blockedBy��
    //   blocking ����װʡһ�����󣩣������ GraphQL ͬ���� { 'm<i>': {...} }������ mapTicket ��Ķ���
    async function fetchMapsDetailREST(numbers, cwd) {
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', error: '�޷����� owner/repo' } }
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
            } catch (e2) { /* ������ѯʧ�ܸ�Ʊ blockedBy �ÿգ����������� */ }
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


    // v1.3.3 ���٣�GraphQL aliases һ�β�ѯȫ�� map ���飨8 �� �� 1 �Σ�Windows �´��� 8��2.4s �� ���� ~3.6s��
    //   ÿ�� map һ�� alias��m0/m1/...������Ӧ�� alias ȡ��������ʧ���������� 1 ��
    async function fetchMapsDetail(numbers, cwd) {
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', error: '�޷����� owner/repo��git remote �� gh repo view ʧ�ܣ�' } }
      if (!numbers || !numbers.length) return { ok: true, issues: {} }
      // ���� aliases ��ѯ��query($owner:String!,$name:String!){repository(...){m0:issue(number:409){...} m1:issue(...){...}}}
      const frag = 'number title state body url labels(first:20){nodes{name}} subIssues(first:100){totalCount nodes{number title state body url labels(first:10){nodes{name}} assignees(first:10){nodes{login}} blockedBy(first:20){nodes{number title state}}}}'
      const sel = numbers.map(function (n, i) { return 'm' + i + ':issue(number:' + n + '){' + frag + '}' }).join(' ')
      const query = 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){' + sel + '}}'
      let last = null
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await runGh(['api', 'graphql', '-f', 'query=' + query, '-F', 'owner=' + repo.owner, '-F', 'name=' + repo.name], cwd)
        if (!r.ok) {
          last = r
          // v1.5 B5��GraphQL ���ľ���RATE_LIMIT���� �Զ����� REST ͨ���������� 2 �ΰ��գ�ֱ�ӽ�����
          if (isRateLimitError(r)) return fetchMapsDetailREST(numbers, cwd)
          if (r.kind !== 'network') return { ok: false, error: r }
          continue
        }
        try {
          const j = JSON.parse(r.text)
          if (j.errors) {
            // v1.5 B5��GraphQL ���� errors���� RATE_LIMIT���� REST ����
            if (isRateLimitError({ error: JSON.stringify(j.errors) })) return fetchMapsDetailREST(numbers, cwd)
            return { ok: false, error: { kind: 'graphql', error: JSON.stringify(j.errors).slice(0, 300) } }
          }
          return { ok: true, issues: j.data.repository }
        } catch (e) { return { ok: false, error: { kind: 'parse', error: String(e) } } }
      }
      return { ok: false, error: last || { kind: 'network', error: 'GraphQL aliases ����ʧ�ܣ����Ժ���ʧ�ܣ�' } }
    }

    // T2 #7 �� fetchIssueDetail �� issue ����ͨ·������ fetchMapsDetail ˼·����������/�� issue ���ϲ� aliases��
    // GraphQL �ֶΰ� T2 ��Լ��number title state body url updatedAt createdAt closedAt labels(first:20){nodes{name color}} assignees(first:10){nodes{login}} comments(first:50){nodes{author{login} authorAssociation body createdAt updatedAt}} subIssues(first:50){totalCount nodes{number title state}} blockedBy(first:20){nodes{number title state}}
    // ���ֹѪ��GraphQL �����ӶȼƵ�ʧ�� �� RATE_LIMIT ������� REST ���ף�REST ������ʧ���ÿգ����岻��
    // ������״�� fetchMapsDetail ���� {ok,error,issue?}��kind ϸ�� env|parse|graphql|network|rateLimit|notFound|404
    async function fetchIssueDetailREST(n, cwd) {
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', message: '�޷����� owner/repo��git remote �� gh repo view ʧ�ܣ�' } }
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
      if (!repo) return { ok: false, error: { kind: 'env', message: '�޷����� owner/repo��git remote �� gh repo view ʧ�ܣ�' } }
      if (!n) return { ok: false, error: { kind: 'parse', message: 'ȱ�� number' } }
      const frag = 'number title state body url updatedAt createdAt closedAt labels(first:20){nodes{name color}} assignees(first:10){nodes{login}} comments(first:50){nodes{author{login} authorAssociation body createdAt updatedAt} pageInfo{hasNextPage endCursor}} subIssues(first:50){totalCount nodes{number title state}} blockedBy(first:20){nodes{number title state}} blocking(first:20){nodes{number title state}}'
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
      return { ok: false, error: last || { kind: 'network', message: 'GraphQL �� issue ����ʧ�ܣ����Ժ���ʧ�ܣ�' } }
    }

    async function buildSnapshot(cwd) {
      const repo = await getRepoKey(cwd)
      // v1.3.3 ���٣�map �б�ֱ�Ӵ�ȫ�� issues ���ˣ�fetchMaps ��������ʡȥ ���� ԭ 11 �� �� 9 �� gh ���ã�
      const fi = await fetchIssues(cwd)
      const issues = fi.ok ? fi.issues : []
      const mapsMeta = fi.ok ? fi.issues.filter(function (x) {
        return x.state === 'OPEN' && (x.labels || []).some(function (l) { return l.name === 'wayfinder:map' })
      }) : []
      // #375��ȫ�� label �б������ label����ȡʧ���ݴ��ÿգ����������չ�����client ������
      let labels = []
      const fl = await runGh(['label', 'list', '--json', 'name,color'], cwd)
      if (fl.ok) {
        try {
          const ls = JSON.parse(fl.text)
          if (Array.isArray(ls)) labels = ls.map(function (l) { return { name: l.name, color: l.color || '' } })
        } catch (e) { labels = [] }
      }
      // v1.3.3 ���٣�GraphQL aliases һ�β�ȫ�� map ���飨ԭÿ map һ�� GraphQL��8 �δ��� ~19s �� 1 �� ~4s��
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
        // v1.4��T1 #442����ÿ��Ʊ�� level��DAG �·����ȣ���client ��Ⱦ©���ֲ�ֱ��ȡ
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
      // v1.5 R2 + R2-fix-6��#2 MVP E2E ʵ֤ 2026-08-18����probe since ����**����**�� buildSnapshot ���ʼ��/�ƽ���
      //   ԭʵ�֡�buildSnapshot ĩβ lastProbeAtByRepo[rk]=now���и�������̬�������һ snapshot build��cache-miss/
      //    refresh���������ĳ�α༭**֮��**����ѻ����Ƶ��༭ʱ��**֮��** �� �´� probe since=���� �鲻���ñ༭
      //   ��count=0 �� changed=false�����һ���ֻ�� changed=true ʱ�Ż��� �� �༭��**�����̵�**��UI ����ˢ�¡�
      //   ��ȷ���壺����ֻ���� probe �Լ��ƽ�����⵽ change ʱ��Ϊ������̽��ʱ�̡�����build ��� �� client ����Ⱦ��
      //   ���գ���Ȩ�����ߡ��״� probe��since=undefined����Ȼ��ȫ������ �� ��Ϊ changed �� �������ߣ�����ԭע����ͼ����
      // #155��Selection/RepositoryRef ������registry.select/describe �� wf.snapshot {repository, selection}��
      let selection = null
      let repository = null
      try {
        const reg = await getTrackerRegistry()
        if (reg && typeof reg.select === 'function') {
          const handle = { cwd: cwd }
          const ctxSel = { cwd: cwd, platform: await getPlatform(), fs: ctx.get('fs'), exec: async (cmd, args, opts) => execProc([cmd, ...args], (opts && opts.cwd) || cwd), timers: { setTimeout: (fn,ms)=>timer.timeout(fn,ms), clearTimeout: (id)=>{try{clearTimeout(id)}catch{}} } }
          // ������ϼ�����G5 ����ϣ����������أ������� host �ӽ� fill ͳ��
          const capCount = (function(iss){
            let present=0, emptyCnt=0, missing=0
            // ���ף��� labels Ϊ���������ֶΰ� shape �����ֶμ�����
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
          // select ������
          const sel = await reg.select(handle, ctxSel)
          selection = sel
          if (sel && sel.backendId) {
            try { repository = reg.describe(handle, sel.backendId) } catch {}
            // markdown ���� url Ϊ�գ�github ������ github.com url
            if (repository && !repository.url && sel.backendId==='github' && repo) {
              repository.url = 'https://github.com/' + repo.owner + '/' + repo.name
              repository.name = repo.owner + '/' + repo.name
              repository.refId = repo.owner + '/' + repo.name
            }
          } else {
            // fallback ʱ repository �Ը�ռλ������ UI ������
            if (repo) repository = { backend: 'github', refId: repo.owner + '/' + repo.name, name: repo.owner + '/' + repo.name, url: 'https://github.com/' + repo.owner + '/' + repo.name }
            else repository = null
          }
          // ���������ҵ� snapshot �� ChecksTab ��Ͽ�
          var _capDiag = capCount
        }
      } catch (e) { /* ���� null������������ */ }
      let _snapVer='';
      // #191: backendModules passthrough (presentation palette) for UI setPresentationMap
      let backendModules = null
      try {
        const regM = await getTrackerRegistry()
        if (regM && typeof regM.modules === 'function') {
          backendModules = regM.modules().map(function (m) { return { id: m.id, label: m.label, presentation: m.presentation } })
        }
      } catch (e) {}
 try{ const tmpIdx={}; (issues||[]).forEach(function(it){ if(it&&it.number!=null) tmpIdx[String(it.number)]=String(it.state||'').toUpperCase()+'|'+String(it.updatedAt||''); }); _snapVer=issueIndexVersion(tmpIdx); }catch{}
      return {
        ok: true,
        version: _snapVer,
        etag: _snapVer,
        repo: repo,
        repoRoot: await getRepoRoot(cwd),  // v1.5 T9��git ��·�������ֿ��������� setup ��飩
        updatedAt: new Date().toISOString(),
        generatedMs: Date.now(),
        env: { ghPath: ghPath, ghError: ghLastError },
        maps: maps,
        issues: issues,
        labels: labels,
        fallback: d.fallback || null,  // v1.5 B5��'rest' = GraphQL ���ľ��ѽ��� REST��client ����ʾ��
        repository: repository,
        backendModules: backendModules,
        selection: selection,
        capabilities: (typeof _capDiag !== 'undefined' ? _capDiag : null),
      }
    }

    // ============ ǰ�ü�飨#344 �� wf.status��============
    // ���� git Զ�� URL �� GitHub owner/repo���� GitHub ���� null
    function parseGithubRepo(url) {
      const s = String(url || '').trim()
      const m = s.match(/github\.com[\/:]([^\/\s]+)\/([^\/\s]+?)(?:\.git)?\s*$/)
      if (!m) return null
      return { owner: m[1], name: m[2] }
    }

    // ��� 1 �� �ֿⶨλ
    async function checkRepo(cwd, lang) {
      const git = await resolveGit()
      if (git) {
        const r = await execProc([git, '-C', cwd, 'remote', 'get-url', 'origin'], cwd)
        if (r.ok) {
          const key = parseGithubRepo(r.text)
          if (key) return { ok: true, level: 'ok', detail: key.owner + '/' + key.name, hint: '', repo: key }
          return { ok: true, level: 'warn', detail: (lang === 'en') ? 'Has a git remote but not GitHub: ' + r.text.trim().slice(0, 80) : '�� git Զ�̵��� GitHub��' + r.text.trim().slice(0, 80), hint: (lang === 'en') ? 'Remote is not GitHub' : '��ǰԶ�̲��� GitHub', repo: null }
        }
        if (/not a git repository|does not appear to be a git repository|fatal/i.test(r.error || '')) {
          return { ok: false, level: 'bad', detail: (lang === 'en') ? 'Current directory is not a git repo' : '��ǰĿ¼���� git �ֿ�', hint: (lang === 'en') ? 'Use this plugin inside a GitHub repo' : '�� GitHub �ֿ���ʹ�ñ����', repo: null }
        }
        return { ok: false, level: 'bad', detail: (lang === 'en') ? 'git query failed: ' + String(r.error || '').slice(0, 120) : 'git ��ѯʧ�ܣ�' + String(r.error || '').slice(0, 120), hint: (lang === 'en') ? 'Check git and repo state' : '��� git ��ֿ�״̬', repo: null }
      }
      // ���ף����� .git/config��git ��ִ�в�����ʱ��
      if (fs !== undefined) {
        try {
          const t = await fs.resolve('.git/config', { cwd: cwd })
          const txt = await fs.readText(t)
          const um = txt.match(/url\s*=\s*(.+)/)
          if (um) {
            const key = parseGithubRepo(um[1])
            if (key) return { ok: true, level: 'ok', detail: key.owner + '/' + key.name, hint: '', repo: key }
            return { ok: true, level: 'warn', detail: (lang === 'en') ? 'Has a git remote but not GitHub: ' + um[1].trim().slice(0, 80) : '�� git Զ�̵��� GitHub��' + um[1].trim().slice(0, 80), hint: (lang === 'en') ? 'Remote is not GitHub' : '��ǰԶ�̲��� GitHub', repo: null }
          }
        } catch (e) { /* �䵽�·� bad */ }
      }
      return { ok: false, level: 'bad', detail: (lang === 'en') ? 'Cannot locate the repo (git unavailable and no .git/config)' : '�޷���λ�ֿ⣨git ���������� .git/config��', hint: (lang === 'en') ? 'Use this plugin inside a GitHub repo' : '�� GitHub �ֿ���ʹ�ñ����', repo: null }
    }

    // ��� 2 �� setup ��ִ��
    async function checkSetup(cwd, lang) {
      if (fs === undefined) return { ok: false, level: 'bad', detail: (lang === 'en') ? 'fs service unavailable, cannot detect' : 'fs ���񲻿��ã��޷����', hint: (lang === 'en') ? 'Run /setup-matt-pocock-skills first' : '�������� /setup-matt-pocock-skills', repo: null }
      try {
        // v1.5 B1����Ϊ��� git ��Ŀ¼��⣨�Ự cwd �ڲֿ���Ŀ¼ʱ�����󱨡�û�г�ʼ������
        const root = await getRepoRoot(cwd)
        const base = root || cwd
        const info = await fs.lstat('docs/agents/issue-tracker.md', { cwd: base })
        if (info) return { ok: true, level: 'ok', detail: (lang === 'en') ? 'docs/agents/issue-tracker.md exists' : 'docs/agents/issue-tracker.md ����', hint: '', repo: null }
      } catch (e) { /* �䵽�·� bad */ }
      return { ok: false, level: 'bad', detail: (lang === 'en') ? 'docs/agents/issue-tracker.md missing' : 'docs/agents/issue-tracker.md ������', hint: (lang === 'en') ? 'Run /setup-matt-pocock-skills first' : '�������� /setup-matt-pocock-skills', repo: null }
    }

    // ��� 3 �� tracker = GitHub
    async function checkTracker(cwd, lang) {
      if (fs === undefined) return { ok: false, level: 'bad', detail: (lang === 'en') ? 'fs service unavailable, cannot determine tracker' : 'fs ���񲻿��ã��޷��ж� tracker', hint: (lang === 'en') ? 'Run /setup-matt-pocock-skills first' : '�������� /setup-matt-pocock-skills', repo: null }
      try {
        // #455 B1 ��ȫ���� checkSetup һ����� git ��Ŀ¼�����Ự cwd �ڲֿ���Ŀ¼ʱ���󱨡��޷���ȡ����
        const root = await getRepoRoot(cwd)
        const base = root || cwd
        const t = await fs.resolve('docs/agents/issue-tracker.md', { cwd: base })
        const txt = await fs.readText(t)
        if (/github/i.test(txt) && /gh\s+(issue|api|auth)|GitHub Issues/i.test(txt)) {
          return { ok: true, level: 'ok', detail: 'GitHub Issues + gh CLI', hint: '', repo: null }
        }
        return { ok: false, level: 'warn', detail: (lang === 'en') ? 'issue-tracker.md exists but is not the GitHub template' : 'issue-tracker.md ���ڵ��� GitHub ģ��', hint: (lang === 'en') ? 'Run /setup-matt-pocock-skills and pick the GitHub tracker' : '���� /setup-matt-pocock-skills ��ѡ GitHub tracker', repo: null }
      } catch (e) {
        return { ok: false, level: 'bad', detail: (lang === 'en') ? 'Cannot read issue-tracker.md' : '�޷���ȡ issue-tracker.md', hint: (lang === 'en') ? 'Run /setup-matt-pocock-skills first' : '�������� /setup-matt-pocock-skills', repo: null }
      }
    }

    // ��� 4 �� gh CLI ����
    async function checkGhCli(lang) {
      const exe = await resolveGh()
      if (!exe) return { ok: false, level: 'bad', detail: (lang === 'en') ? 'gh not found �� install GitHub CLI first (https://cli.github.com/)' : 'gh δ�ҵ������Ȱ�װ GitHub CLI��https://cli.github.com/��', hint: '��Ϊ DSH ��װ GitHub CLI��gh������ ��������������� gh��\n\n1. �ȼ�飺�ն�ִ�� gh --version���а汾����� �� ֱ�ӻ㱨��װ�汾����������Ҫ�ظ���װ��\n2. �� gh �� OS ��װ��Windows �� winget install --id GitHub.cli; macOS �� rew install gh; Linux �� sudo apt install gh;\n3. ��װ����֤���ؿ��ն�ʹ PATH ��Ч��gh --version ����汾�ţ�\n4. �� gh ��װ�� DSH �Ա�δ��װ���㻷����顸�ز⡹��ť������ DSH Desktop��\n5. ��ɺ�㱨��gh �汾�� + ��gh CLI ���á����ѱ��̡�', repo: null }
      return { ok: true, level: 'ok', detail: exe, hint: '', repo: null }
    }

    // ��� 5 �� gh �ѵ�¼
    async function checkGhAuth(lang) {
      const r = await runGh(['auth', 'status'])
      if (r.ok) {
        const first = (r.text || '').split(/\r?\n/).map(function (s) { return s.trim() }).filter(Boolean)[0]
        return { ok: true, level: 'ok', detail: first || ((lang === 'en') ? 'Logged in' : '�ѵ�¼'), hint: '', repo: null }
      }
      return { ok: false, level: 'bad', detail: (lang === 'en') ? 'Not logged into GitHub: run gh auth login (browser auth; official docs in hint)' : 'δ��¼ GitHub������ gh auth login���������Ȩ���ٷ��ĵ��� hint��', hint: 'https://cli.github.com/manual/gh_auth_login', repo: null }
    }

    // ��� 6 �� API �ɴ�� repo �� repos/<owner>/<name>�������� user��
    async function checkApi(cwd, repo, lang) {
      const endpoint = repo ? ('repos/' + repo.owner + '/' + repo.name) : 'user'
      const r = await runGh(['api', endpoint], cwd)
      if (r.ok) return { ok: true, level: 'ok', detail: 'api.github.com 200 �� ' + endpoint, hint: '', repo: null }
      return { ok: false, level: 'bad', detail: (lang === 'en') ? 'API request failed (' + r.kind + ')' : 'API ����ʧ�ܣ�' + r.kind + '��', hint: (lang === 'en') ? 'Check network / token scopes' : '������� / Token Ȩ��', repo: null }
    }

    // ��� 7/8 �� ���ܰ�װ̽�⣨#373 �İ壺��̬ ���� �Ѱ�װ/δ��װ��ȥ����ɿ��ġ����ء��ж���
    //   ������ skills �����롸��ǰ�Ự���ء�����ͬһ�����ģ����񲻿���ʱ���󱨡�δ���ء���
    const SKILL_INSTALL_URL = 'https://github.com/mattpocock/skills'
    // v1.6�����ܰ�װ���� prompt ���ձ�� client PROMPTS ע����installSkills ��Ŀ����hint �� prompt: ����Э�飨prompt:installSkills���� client ȡ˫���ı�
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
          } catch (e) { /* ����̽����һ��Ŀ¼ */ }
        }
      }
      // ��̬��#373 ���� ��һ��Դ���� = �Ѱ�װ���� ok�������� = δ��װ���� bad + �ٷ��ֿ��ַ��
      if (session && fsFound) return { ok: true, level: 'ok', detail: (lang === 'en') ? 'Installed (session-mounted �� ' + fsFound + ')' : '�Ѱ�װ���Ự�ѹ��� �� ' + fsFound + '��', hint: '', repo: null }
      if (session) return { ok: true, level: 'ok', detail: (lang === 'en') ? 'Installed (session-mounted)' : '�Ѱ�װ���Ự�ѹ��أ�', hint: '', repo: null }
      if (fsFound) return { ok: true, level: 'ok', detail: (lang === 'en') ? 'Installed (' + fsFound + ')' : '�Ѱ�װ��' + fsFound + '��', hint: '', repo: null }
      if (home === null) return { ok: false, level: 'bad', detail: (lang === 'en') ? 'Not installed (cannot probe user home)' : 'δ��װ���޷�̽���û���Ŀ¼��', hint: 'prompt:installSkills', repo: null }
      return { ok: false, level: 'bad', detail: (lang === 'en') ? 'Not installed' : 'δ��װ', hint: 'prompt:installSkills', repo: null }
    }

    // v1.5 T11����� 9 �� ���ļ����׼��ۺϣ�ȫ���̼���ȱʧ��⣩
    async function probeSkillSuite(lang) {
      const missing = []
      for (let i = 0; i < SKILL_PROBE_NAMES.length; i++) {
        const r = await probeSkill(SKILL_PROBE_NAMES[i], lang)
        if (r.level !== 'ok') missing.push(SKILL_PROBE_NAMES[i])
      }
      if (!missing.length) return { ok: true, level: 'ok', detail: (lang === 'en') ? 'Core skill suite installed (' + SKILL_PROBE_NAMES.length + ')' : '���ļ����׼��Ѱ�װ��' + SKILL_PROBE_NAMES.length + ' ����', hint: '', repo: null }
      return { ok: false, level: 'bad', detail: (lang === 'en') ? 'Missing: ' + missing.join(' / ') : 'ȱʧ��' + missing.join(' / '), hint: 'prompt:installSkills', repo: null }
    }

    const CHECK_NAMES = function (lang) {
      return (lang === 'en')
        ? ['Repo located', 'Setup run', 'Tracker = GitHub', 'gh CLI available', 'gh logged in', 'API reachable', 'wayfinder skill', 'ask-matt skill', 'Core skill suite']
        : ['�ֿⶨλ', 'setup ��ִ��', 'tracker = GitHub', 'gh CLI ����', 'gh �ѵ�¼', 'API �ɴ�', 'wayfinder ����', 'ask-matt ����', '���ļ����׼�']
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

    // ============ RPC��#152 �� ̽����ţ�wf.detect �� RPC + wf.status ������������============
    // ��һ��ԭ���ǰ��ֻ�� wf.detect/wf.status �� DetectionResult��#150 Q1����̽���� OS ֱ���� platform��
    // per-workspace �� handleKey=cwd|refId �ڴ� Map �����̣�Q3����pending �����棨Q6����Ψһд·�� wf.bind��registry.bind��Q4��
    harness.handle('wf.detect', async function (args) {
      const cwd = (args && args.cwd) || DEFAULT_CWD
      const force = !!(args && args.force)
      // #195 �޸���force ̽����� gh �������棨��ʵ���״�ʧ�����û��棬force Ҳ�Ȳ�������
      if (force) resetGhCache()
      try {
        const svc = await getDetectionService()
        const res = await svc.detect({ cwd }, { force })
        // �Կ�ʽ��ensure DetectionResult ��̬���� selection/pending/multiHit���� #125��
        return { ok: true, ...res }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    })
    harness.handle('wf.status', async function (args) {
      const cwd = (args && args.cwd) || DEFAULT_CWD
      const force = !!(args && args.force)
      const lang = (args && args.lang === 'en') ? 'en' : 'zh'
      // #195 �޸���force ̽����� gh �������棨��ʵ���״�ʧ�����û��棩
      if (force) resetGhCache()
      const now = Date.now()
      // ���Ա��Ų㣺������ detectionService��Q7 DetectionResult + preflight + skillProbes �� ���� 9 checks �����ݣ�
      try {
        const svc = await getDetectionService()
        const det = await svc.detect({ cwd }, { force })
        const sel = det.selection
        const backendId = sel && sel.backendId
        const cacheKeyOk = !force && statusCache.status && statusCache.cwd === cwd && statusCache.lang === lang && statusCache.backendId === (backendId || null) && now - statusCache.ts < STATUS_CACHE_MS
        if (cacheKeyOk) return statusCache.status
        // ���� 9 checks ������ͼ��#150 Q7��checks �����ں�� deprecate���� selection Ϊ��Դ��
        // 1) repo ��λ������ detection repoHandle + ���� git ̽�ⶵ�ף�������� checkRepo �ȼۣ�
        const c1Legacy = await checkRepo(cwd, lang)
        // 2-3) setup/tracker �� explicit ��������һ��parseIssueTracker �����š�ok������ warn���ա�bad��
        const parsed = det.explicit && det.explicit.parsed
        let c2, c3
        if (parsed && parsed.explicitBackendId) {
          c2 = { ok: true, level: 'ok', detail: (lang==='en') ? 'docs/agents/issue-tracker.md exists' : 'docs/agents/issue-tracker.md ����', hint: '' }
          const labelMap = { github: 'GitHub Issues + gh CLI', gitlab: 'GitLab Issues + glab', markdown: 'Local Markdown (.scratch)' }
          const lbl = labelMap[parsed.explicitBackendId] || parsed.explicitBackendId
          c3 = { ok: true, level: 'ok', detail: lbl, hint: '' }
        } else {
          c2 = await checkSetup(cwd, lang)
          // ������ʽ������ selection ������ĳ��ˣ���Ϊ tracker �Ѿ�
          if (backendId) c3 = { ok: true, level: 'ok', detail: backendId, hint: '' }
          else c3 = await checkTracker(cwd, lang)
        }
        // 4-6) gh/cli/auth/api �ۺ��� preflight�����к���ԣ�Q6����δ���� fallback ���������
        let c4, c5, c6
        if (det.preflight) {
          const kind = det.preflight.error && det.preflight.error.kind
          const msg = det.preflight.error && det.preflight.error.message || ''
          if (det.preflight.ok) {
            c4 = { ok: true, level: 'ok', detail: ghPath || 'gh', hint: '' }
            c5 = { ok: true, level: 'ok', detail: (lang==='en') ? 'Logged in' : '�ѵ�¼', hint: '' }
            c6 = { ok: true, level: 'ok', detail: 'api.github.com 200', hint: '' }
          } else if (kind === 'env') {
            // #195 �޸���hint ����Ϊ prompt:installGh���� installSkills / ghAuthGuide ͬģʽ����UI ����ť�Զ� inject
            c4 = { ok: false, level: 'bad', detail: (lang==='en') ? 'gh not found �� install GitHub CLI first (https://cli.github.com/)' : 'gh δ�ҵ������Ȱ�װ GitHub CLI��https://cli.github.com/��', hint: (det.preflight && det.preflight.prompt) ? det.preflight.prompt : '��Ϊ DSH ��װ GitHub CLI��gh������ ��������������� gh��\n\n1. �ȼ�飺�ն�ִ�� gh --version;\n2. �� gh �� OS ��װ��Windows �� winget install --id GitHub.cli; macOS �� rew install gh; Linux �� sudo apt install gh;\n3. ��װ����֤��gh --version;\n4. �� gh ��װ�� DSH �Ա�δ��װ���㡸�ز⡹������ DSH��\n5. ��ɺ�㱨��' }
            c5 = { ok: false, level: 'bad', detail: (lang==='en') ? 'Not logged into GitHub: run gh auth login' : 'δ��¼ GitHub������ gh auth login', hint: 'https://cli.github.com/manual/gh_auth_login' }
            c6 = { ok: false, level: 'bad', detail: msg.slice(0,200), hint: '' }
          } else if (kind === 'auth') {
            c4 = { ok: true, level: 'ok', detail: ghPath || 'gh', hint: '' }
            c5 = { ok: false, level: 'bad', detail: (lang==='en') ? 'Not logged into GitHub: run gh auth login' : 'δ��¼ GitHub������ gh auth login', hint: 'https://cli.github.com/manual/gh_auth_login' }
            c6 = { ok: false, level: 'bad', detail: msg.slice(0,200), hint: '' }
          } else {
            c4 = { ok: true, level: 'ok', detail: ghPath || 'gh', hint: '' }
            c5 = { ok: true, level: 'ok', detail: (lang==='en') ? 'Logged in' : '�ѵ�¼', hint: '' }
            c6 = { ok: false, level: 'bad', detail: msg.slice(0,200), hint: '' }
          }
        } else if (backendId && !det.selection.pending) {
          // ���е� preflight ��δ������lazy δ���������˾������Ա�����
          c4 = await checkGhCli(lang)
          c5 = await checkGhAuth(lang)
          c6 = await checkApi(cwd, c1Legacy.repo, lang)
        } else {
          // pending/fallback �������� preflight��Q6������Ӧ�� surface Ϊ pending ����̬
          if (sel && sel.pending) {
            const hint = 'pending:explicit-bind'
            const pendingDetail = (lang==='en') ? 'Detecting�� pending (select a backend or retry)' : '̽��δ�� �� �ȴ�/������ʽѡ��'
            c4 = { ok: false, level: 'warn', detail: pendingDetail, hint }
            c5 = { ok: false, level: 'warn', detail: pendingDetail, hint }
            c6 = { ok: false, level: 'warn', detail: pendingDetail, hint }
          } else {
            c4 = await checkGhCli(lang)
            c5 = await checkGhAuth(lang)
            c6 = await checkApi(cwd, c1Legacy.repo, lang)
          }
        }
        // 7-9) skill ���������� det.skillProbes����������� probeSkill��
        let c7, c8, c9
        if (det.skillProbes && det.skillProbes.probes) {
          const p = det.skillProbes.probes
          const toCheck = (name) => {
            const r = p[name]
            if (!r) return { ok: false, level: 'bad', detail: (lang==='en') ? 'Not installed' : 'δ��װ', hint: 'prompt:installSkills' }
            return { ok: r.level==='ok', level: r.level, detail: r.detail, hint: r.hint }
          }
          c7 = toCheck(SKILL_PROBE_NAMES[0])
          c8 = toCheck(SKILL_PROBE_NAMES[5]) // ask-matt ��λ��#149 C8 triage��ask-matt��
          // suite �ۺ�
          const missing = det.skillProbes.missing || []
          if (!missing.length) c9 = { ok: true, level: 'ok', detail: (lang==='en') ? 'Core skill suite installed (' + SKILL_PROBE_NAMES.length + ')' : '���ļ����׼��Ѱ�װ��' + SKILL_PROBE_NAMES.length + ' ����', hint: '' }
          else c9 = { ok: false, level: 'bad', detail: (lang==='en') ? 'Missing: ' + missing.join(' / ') : 'ȱʧ��' + missing.join(' / '), hint: 'prompt:installSkills' }
        } else {
          c7 = await probeSkill(SKILL_PROBE_NAMES[0], lang)
          c8 = await probeSkill(SKILL_PROBE_NAMES[5], lang)
          c9 = await probeSkillSuite(lang)
        }
        const raw = [c1Legacy, c2, c3, c4, c5, c6, c7, c8, c9]
        const checks = raw.map(function (c, i) {
          // ���ǲ���ʾ��multiHit ͸��������ڣ�Q5��
          let hint = c.hint
          if (i===2 && sel && sel.multiHit) hint = (hint ? hint + ' ' : '') + 'multiHit:' + sel.multiHit.join(',')
          if (sel && sel.pending && i>=3 && i<=5 && c.level!=='warn') { /* pending ���� 4-6 ���� */ }
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
          // ���������Ų���Դ��Q7��
          selection: sel,
          detection: det,
        }
        statusCache = { ts: Date.now(), status: status, error: null, cwd: cwd, lang: lang, backendId: backendId || null }
        return status
      } catch (e) {
        // ����ʧ�ܻ��˾�·�������أ�
      }
      if (!force && statusCache.status && statusCache.cwd === cwd && statusCache.lang === lang && now - statusCache.ts < STATUS_CACHE_MS) return statusCache.status
      try {
        const status = await buildStatus(cwd, lang)
        statusCache = { ts: Date.now(), status: status, error: null, cwd: cwd, lang: lang, backendId: null }
        return status
      } catch (e) {
        statusCache = { ts: Date.now(), status: null, error: String((e && e.message) || e), cwd: cwd, lang: lang, backendId: null }
        return { ok: false, error: String((e && e.message) || e), checks: [], ready: 0, total: CHECK_NAMES(lang).length }
      }
    })

    harness.handle('wf.ping', async function () {
      return { ok: true, ts: Date.now() }
    })

    // v13���� sessionId ����Ự����Ŀ¼��client �л��Ի�ʱ�ã����� sessions.meta ��Ȩ���ֶΣ�
    // �������� client �²� ConversationSnapshot �ֶ�����
    // ������� �� �ɶ��ı���fetchMaps/buildSnapshot �׳����� {kind, error} ����String() ��� [object Object]
    const errText = function (e) {
      if (e === undefined || e === null) return 'δ֪����'
      if (typeof e === 'string') return e
      if (typeof e.message === 'string') return e.message
      if (typeof e.error === 'string') return e.error
      try { return JSON.stringify(e) } catch (err) { return String(e) }
    }

    harness.handle('wf.cwd', async function (args) {
      const sid = args && args.sessionId
      if (!sid) return { ok: false, error: 'ȱ�� sessionId' }
      const sessions = ctx.get('sessions')
      if (sessions === undefined || typeof sessions.get !== 'function') return { ok: false, error: 'sessions ���񲻿���' }
      try {
        const s = sessions.get(sid)
        // �ִ� DSH �� Session �ṹ��header.cwd ΪȨ�������ݾ� meta / ֱ�� cwd �ֶ�
        const header = s && (s.header || s.meta)
        const cwd = header && (header.cwd || header.path || header.worktree || header.projectDir || header.directory)
        if (typeof cwd === 'string' && cwd) return { ok: true, cwd: cwd }
        const meta = s && s.meta
        const cwd2 = meta && (meta.cwd || meta.path || meta.worktree || meta.projectDir || meta.directory)
        if (typeof cwd2 === 'string' && cwd2) return { ok: true, cwd: cwd2 }
        if (s && typeof s.cwd === 'string' && s.cwd) return { ok: true, cwd: s.cwd }
        return { ok: false, error: '�Ự�� cwd ��Ϣ' }
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
    })

    // #179 ������������ cwd �Զ� DEFAULT_CWD ����󶵵ף����⡰û�вֿ⡱�հף������ͻ����ѱ�֤ͬ sid �й������ഥ�����մ�����
    harness.handle('wf.snapshot', async function (args) {
      const rawCwd = (args && args.cwd) || DEFAULT_CWD
      const cwd = await normCwd(rawCwd)
      const ifNoneMatch = args && (args.ifNoneMatch || args.version || args.etag) || null
      const defNorm2 = normKey(DEFAULT_CWD); const curNorm2 = normKey(cwd);
      if((!args || !args.cwd) && curNorm2===defNorm2){ try{ const rr2=await getRepoRoot(cwd); if(!rr2) return {ok:false, error:'not a git repository (DEFAULT_CWD not gitRoot)', kind:'env'}; }catch{}
      }
      const hit = getCacheByCwd(cwd);
      if(hit && hit.snapshot){
        if(ifNoneMatch && hit.version && hit.version===ifNoneMatch) return {ok:true, notModified:true, status:304, version:hit.version};
        const current = await cacheSnapshotIsCurrent(hit.snapshot, cwd);
        if(current===true || (current===null && Date.now()-hit.ts < CACHE_MS)){
          if(ifNoneMatch && hit.version===ifNoneMatch) return {ok:true, notModified:true, status:304, version:hit.version};
          return hit.snapshot;
        }
      }
      try{
        const repo0 = await getRepoKey(cwd)
        const disk = await readDiskCache(repo0)
        if(disk){
          const currentDisk = await cacheSnapshotIsCurrent(disk, cwd)
          if(currentDisk!==false){
            try{ const vDisk=snapshotVersionOf(disk); disk.version=vDisk; disk.etag=vDisk; }catch{}
            if(ifNoneMatch && disk.version===ifNoneMatch) return {ok:true, notModified:true, status:304, version:disk.version};
            const adopted=Object.assign({},disk,{fromCache:true});
            setCacheByCwd(cwd,{snapshot:adopted, version:disk.version||'', ts:Date.now(), error:null});
            return adopted;
          }
        }
        const ens = await ensureSnapshot(cwd, {ifNoneMatch:ifNoneMatch});
        if(ens && ens.notModified) return {ok:true, notModified:true, status:304, version:ens.version};
        if(ens && ens.ok && ens.snapshot) return ens.snapshot;
        const snap = await buildSnapshot(cwd);
        try{ const v=snapshotVersionOf(snap); snap.version=v; snap.etag=v; }catch{}
        if(ifNoneMatch && snap.version===ifNoneMatch) return {ok:true, notModified:true, status:304, version:snap.version};
        setCacheByCwd(cwd,{snapshot:snap, version:snap.version||'', ts:Date.now(), error:null});
        await writeDiskCache(snap.repo, snap);
        return snap;
      }catch(e){
        const oldHit=getCacheByCwd(cwd);
        if(oldHit && oldHit.snapshot) return {ok:false, error:errText(e), snapshot:oldHit.snapshot, version:oldHit.version, env:{ghError:ghLastError}};
        return {ok:false, error:errText(e), env:{ghError:ghLastError}};
      }
    })
    harness.handle('wf.refresh', async function (args) {
      const rawCwd = (args && args.cwd) || DEFAULT_CWD
      const cwd = await normCwd(rawCwd)
      const ifNoneMatch = args && (args.ifNoneMatch || args.version) || null
      resetGhCache()
      try{
        const ens = await ensureSnapshot(cwd, {ifNoneMatch:ifNoneMatch});
        if(ens && ens.notModified) return {ok:true, notModified:true, status:304, version:ens.version};
        if(ens && ens.ok && ens.snapshot) return ens.snapshot;
        const snap = await buildSnapshot(cwd);
        try{ const v=snapshotVersionOf(snap); snap.version=v; snap.etag=v; }catch{}
        setCacheByCwd(cwd,{snapshot:snap, version:snap.version||'', ts:Date.now(), error:null});
        await writeDiskCache(snap.repo, snap);
        return snap;
      }catch(e){
        const oldHit2=getCacheByCwd(cwd);
        if(oldHit2 && oldHit2.snapshot) return {ok:false, error:errText(e), snapshot:oldHit2.snapshot, version:oldHit2.version};
        return {ok:false, error:errText(e)};
      }
    })

    // #155    // #155 + #152����˰󶨣�per-workspace ���ǣ�Ψһд·������д issue-tracker.md��+ ע����ѯ + detection ����ʧЧ
    // #176 + #190 �޸���cwd ��һ������ֱͨ + ��Գ��� fs.resolve + home ��̽��
    // ����workspaces ������ client runtime ��¶�� item.path ��������������� "matt-demo-markdown"����
    // ���� wf.selection �� select() �������� markdown.matches �յ���� cwd��plat.join(cwd,...) ������ԣ�
    // fs.resolve Ĭ�ϻ��ڽ��� cwd ����ʧ�� �� matches false �� fallback �� UI "δ��"��
    // ��һ������ handler �յ����� cwd��markdown.matches ���� docs/agents/issue-tracker.md �� Markdown �Զ���
    async function normCwd(raw){
      let ret='';
      if(!raw) ret=DEFAULT_CWD;
      else {
        let resolved=null;
        try{
          const plat=await getPlatform();
          if(plat&&plat.path&&typeof plat.path.isAbsolute==='function'&&plat.path.isAbsolute(raw)) resolved=plat.path.normalize(raw);
        }catch{}
        if(resolved) ret=resolved;
        else {
          try{
            const fss=ctx.get('fs');
            if(fss&&typeof fss.resolve==='function'){
              const t=await fss.resolve(raw);
              const target=(t&&typeof t==='object')?(t.path||t.target):t;
              if(typeof target==='string'&&target&&(/^[A-Za-z]:[\\/]/.test(target)||/^\//.test(target))) resolved=target;
            }
          }catch{}
          if(resolved) ret=resolved;
          else {
            try{
              const plat=await getPlatform();
              const home=plat&&typeof plat.getHome==='function'?await plat.getHome():null;
              if(home&&plat.path) ret=plat.path.join(home,raw);
              else ret=raw;
            }catch{ ret=raw; }
          }
        }
      }
      try{
        const plat=await getPlatform();
        if(plat&&plat.path&&typeof plat.path.normalize==='function') ret=plat.path.normalize(ret);
      }catch{}
      try{ ret=String(ret).toLowerCase().replace(/\\/g,'/').replace(/\/+/g,'/').replace(/\/$/,''); }catch{}
      if(!ret) ret=String(raw||DEFAULT_CWD).toLowerCase().replace(/\\/g,'/').replace(/\/+/g,'/')||'/';
      return ret;
    }
    
    harness.handle('wf.bind', async function (args) {
      const cwd = (args && args.cwd) || DEFAULT_CWD
      const backendId = args && ('backendId' in args ? args.backendId : args.backend)
      try {
        const reg = await getTrackerRegistry()
        if (!reg) return { ok: false, error: 'registry unavailable' }
        const handle = { cwd: cwd }
        // null = ��ʽ�޺�ˣ�Other �����գ���'other' �����ð� registry �ܾ�
        reg.bind(handle, backendId === undefined ? null : backendId)
        // ʧЧ���� + ״̬ + ̽�������棨per-workspace �л�����̨��Q3��workspaceStore �ڴ浥��ʧЧ��
        try{ const _ck2=normKey(cwd); if(cacheMap.has(_ck2)) cacheMap.delete(_ck2); else cacheMap.clear(); }catch{}; cache = { ts: 0, snapshot: null, error: null, cwd: null }
        try { statusCache = { ts: 0, status: null, error: null, cwd: null, lang: null, backendId: null } } catch {}
        try { const ws = await getWorkspaceStore(); ws.invalidate(handle) } catch {}
        try { if (_detectionService) { /* �´� detect ���� */ } } catch {}
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
        const mods = reg.modules().map(function(m){ return { id: m.id, label: m.label, presentation: m.presentation } })
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
      if (!n) return { ok: false, error: { kind: 'parse', message: 'ȱ�� number' } }
      try {
        const r = await fetchIssueDetail(Number(n), cwd)
        return r
      } catch (e) { return { ok: false, error: { kind: 'network', message: errText(e) } } }
    })
    // T5 #10 �� ���۷�ҳ�������ҳ cursor�������� client �� 600ms ���ƣ���ҳ 50��ʧ�������� 3 �ζ��ף�
    async function fetchIssueCommentsREST(n, after, cwd) {
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', message: '�޷����� owner/repo' } }
      try {
        // REST ��ҳ��after Ϊ�Ѽ��������� "50"����page = floor(after/50)+1��GraphQL cursor �������˻�Ϊ page 2 ��
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
      if (!repo) return { ok: false, error: { kind: 'env', message: '�޷����� owner/repo' } }
      if (!n) return { ok: false, error: { kind: 'parse', message: 'ȱ�� number' } }
      // GraphQL ���ȣ�cursor ��ҳ��
      const query = 'query($owner:String!,$name:String!,$n:Int!,$after:String){repository(owner:$owner,name:$name){issue(number:$n){comments(first:50, after:$after){nodes{author{login} authorAssociation body createdAt updatedAt} pageInfo{hasNextPage endCursor}}}}}'
      // after Ϊ null ʱ�����ַ�����GraphQL ����Ϊ�� cursor���׶Σ����贫�ݱ��� after ���򱨴������ -F after= ֵ�������׶�
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
      return { ok: false, error: { kind: 'network', message: 'GraphQL ���۷�ҳ����ʧ�ܣ����Ժ���ʧ�ܣ�' } }
    }
    harness.handle('wf.issueComments', async function (args) {
      const n = args && args.number
      const after = args && args.after
      const cwd = (args && args.cwd) || DEFAULT_CWD
      if (!n) return { ok: false, error: { kind: 'parse', message: 'ȱ�� number' } }
      try {
        const r = await fetchIssueComments(Number(n), after != null ? String(after) : null, cwd)
        return r
      } catch (e) { return { ok: false, error: { kind: 'network', message: errText(e) } } }
    })

    // v1.5 R2��#2 MVP����probe ���� `since` ʱ���̽��ȫ issue ��������ͼ + ��Ʊ + ��������
    //   1 �� REST ���ø���ȫ�ֿ�仯��ԭʵ�� `labels=wayfinder:map` ��ƥ���ͼ�����
    //   **©��������Ʊ�仯**�������ɽ�/����/������/�ѹرշ��飨DESIGN.md ��5.2��������Ʊ��
    //   ��"�б������״̬"��since ���壺��������ǿ� = ���ϴο��������б仯 �� ��Ϊ changed��
    //   ������� REST 5000/h �أ������� GraphQL 5000 ��/h�������մ���
    harness.handle('wf.probe', async function (args) {
      const rawCwd = (args && args.cwd) || DEFAULT_CWD
      const cwd = await normCwd(rawCwd)
      const ifNoneMatch = args && (args.ifNoneMatch || args.version || args.etag) || null
      try{
        const remote = await fetchIssueIndex(cwd)
        if(!remote.ok) return {ok:false, error:errText(remote.error||'probe failed')}
        const repo=remote.repo; const rk1=repo.owner+'/'+repo.name;
        const vRemote = issueIndexVersion(remote.index);
        const cached = getCacheByCwd(cwd);
        const known = lastIssueIndexByRepo[rk1] || (cached&&cached.snapshot?issueIndexFromSnapshot(cached.snapshot):{}) || {};
        if(ifNoneMatch && vRemote===ifNoneMatch) return {ok:true, changed:false, notModified:true, status:304, version:vRemote, repo:repo, count:remote.count, since:lastProbeAtByRepo[rk1]||null};
        if(cached && cached.version && cached.version===vRemote) return {ok:true, changed:false, notModified:true, status:304, version:vRemote, repo:repo, count:remote.count, since:lastProbeAtByRepo[rk1]||null};
        const changed = issueIndexChanged(known, remote.index);
        rememberIssueIndex(repo, remote.index);
        lastProbeAtByRepo[rk1] = new Date().toISOString();
        if(!changed) return {ok:true, changed:false, notModified:true, status:304, version:vRemote, repo:repo, count:remote.count, since:lastProbeAtByRepo[rk1]};
        const hit=getCacheByCwd(cwd);
        if(hit) { hit.ts=0; }
        if(cache && normKey(cache.cwd)===normKey(cwd)) cache.ts=0;
        return {ok:true, changed:true, status:200, version:vRemote, repo:repo, count:remote.count, since:lastProbeAtByRepo[rk1]};
      }catch(e){ return {ok:false, error:errText(e)}; }
    })
    // ============ �����ĵ���issue #12 BUG4 �� ˫�ط��� �� ��·����============
    // DSH ɳ���� fs.stat ���ص� info.mtime ��̬���ɿأ�Date / ISO �� / �뼶 Unix / ���ػ��� / null / NaN����
    // ԭ `typeof number ? mt : Date.parse(String(mt))` �� Date ����򲻿� parse ��̬���� NaN��
    // ԭ sort ���� `b.mtime - a.mtime` �� mtime ���/NaN ʱ Array.sort ��Ϊ equal �� ԭ˳���� ��
    // fs.listDir �����ֵ��򷵻� �� ���ļ���Ȼ�ŵ�һ �� mds[0].name = �ֵ�����С = ��һ��д�루BUG����
    //
    // �ӹ̣���·�� �� �α�����
    //   - parseHandoffMtime��isFinite �ϸ�У�� + Date ʵ�� getTime ���ȣ��κ��޷� parse ����̬��ȫ�� 0
    //     ��NaN/null/undefined/0/���� parse �� �� 0��
    //   - pickLatestHandoff��mtime desc ���� + name desc ���ף�ʱ����ļ��� = �ֵ��� = ʱ���򣩣�
    //     mtime �˻�Ϊ 0 ���˻���̬��NaN/null/ȫ 0/ȫ�� finite��һ���� name desc �����ֵ������
    //
    // ע������˻���̬��new=NaN+old=valid���� mtime ���ң�sort �ӹ��޷����� ���� ����·��
    //     `wf.handoffResolve(args.name)` �ڿͻ����ѵ����һ��ʱֱ�ӷ��ظ� name ���ϡ�
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
        // name desc ���ף�ʱ����ļ�����YYYYMMDD-HHMMSS���ֵ��� = ʱ����
        if (b.name < a.name) return -1
        if (b.name > a.name) return 1
        return 0
      })
      return sorted[0].name
    }
    // ����Ŀ¼ɨ�裨handoffLatest + handoffResolve ���ã����� �κ� fs �����쳣������Ϊ������
    const scanHandoffDir = async function (cwd) {
      if (fs === undefined) return { error: 'fs ���񲻿���', mds: [] }
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
        return { mds: [] }  // Ŀ¼������/���ɶ� = ��û�н����ĵ�
      }
    }

    // v19����ѯ .scratch/handoff/ �����µĽ����ĵ����� mtime ���� + name desc ���� �� �ӹ̺󣩣��������Ӹ��»Ự��Ԥ�� + ����
    harness.handle('wf.handoffLatest', async function (args) {
      const cwd = (args && args.cwd) || DEFAULT_CWD
      const r = await scanHandoffDir(cwd)
      if (r.error) return { ok: false, error: r.error }
      return { ok: true, file: pickLatestHandoff(r.mds) }
    })

    // issue #12 BUG4 �� ��·�����ͻ��˴������ļ�������һ��ģ����Ⱦ���� handoffFile��ʱ�ϸ񷵻ظ��ļ���
    //   ��Ŀ¼�� �� ������������ �� ���� null�����˻� mtime ���£����� fallback �����ļ����û�����
    //   �� args.name���û���δ�����һ������ˢ�º� / ֱ�ӵ��Ұ룩�� �� mtime ���£��� handoffLatest ͬ���壩��
    // �����ڳ��棺���桸name ����Ŀ¼Ҳ fallback �� mtime ���¡���ʵ�ʳ����±���֤Ϊ��ģʽ ���� �� AI ��ûд��
    // �ĵ�ʱ��handoffFile ���˵��ļ�δ���̣���fallback �����Ұ������ҵ㿪����������ϴε����ĵ������޸�Ŀ����㣡�
    harness.handle('wf.handoffResolve', async function (args) {
      const cwd = (args && args.cwd) || DEFAULT_CWD
      const r = await scanHandoffDir(cwd)
      if (r.error) return { ok: false, error: r.error }
      const want = args && args.name
      if (!want) return { ok: true, file: pickLatestHandoff(r.mds) }
      // ǰ׺ƥ�䣨#71 �̱����ļ�����{ts}-<�̱���>.md����want �� * ��β �� ƥ�� name �Ը�ǰ׺��ͷ��ȡ����
      if (want.slice(-1) === '*') {
        const prefix = want.slice(0, -1)
        const m = r.mds.filter(function (x) { return x.name.indexOf(prefix) === 0 })
        if (m.length) return { ok: true, file: pickLatestHandoff(m) }
        return { ok: true, file: null }
      }
      // ��ȷƥ�䣺��Ŀ¼�� �� ������������ �� ���� null�����˻� mtime ���£����� fallback �����ļ����û�����
      if (r.mds.some(function (m) { return m.name === want })) return { ok: true, file: want }
      return { ok: true, file: null }
    })

    // ============ ���죨��ʼ�� Issue ���� �� T5 #347��============
    // �û��� UI �����ȷ�Ͽ�ʼ���ҹ�ѡ�������ã�gh issue edit <n> --add-assignee @me��
    // д����ǰ UI �Ѷ���ȷ�ϣ��û������ͬ�⣩������ approval ����RESEARCH-NOTES ��3 ���ۣ���
    harness.handle('wf.claim', async function (args) {
      const n = args && args.number
      const cwd = (args && args.cwd) || DEFAULT_CWD
      if (!n) return { ok: false, error: 'ȱ�ٲ��� number��ticket �ţ�' }
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', error: '�޷����� owner/repo��git remote �� gh repo view ʧ�ܣ�' } }
      const r = await runGh(['issue', 'edit', String(n), '--add-assignee', '@me'], cwd)
      if (!r.ok) return { ok: false, error: r }
      // ����ɹ� �� ȡ��ǰ�û� login �����չʾ��ʧЧ���ջ��棬���´� wf.snapshot ������ assignee
      let assignedTo = ''
      const u = await runGh(['api', 'user', '-q', '.login'])
      if (u.ok) assignedTo = u.text.trim()
      cache = { ts: 0, snapshot: null, error: null }
      try { pushIssuePathEvent(n, 'claim') } catch (e) {}
      return { ok: true, number: n, assignedTo: assignedTo, url: 'https://github.com/' + repo.owner + '/' + repo.name + '/issues/' + String(n) }
    })

        // ============ issuePath �� 1A+1B ����ͨ����client ��ѯ�� ============
    harness.handle('wf.issuePathPoll', async function (args) {
      const since = args && typeof args.since === 'number' ? args.since : 0
      const out = pendingIssuePathEvents.filter(function (e) { return e.ts > since })
      return { ok: true, events: out.slice(-100), serverNow: Date.now() }
    })
    harness.handle('wf.issuePathPush', async function (args) {
      const n = args && args.number
      const src = args && args.source ? String(args.source) : 'mention'
      if (!n) return { ok: false, error: 'ȱ�� number' }
      pushIssuePathEvent(n, src, args && args.title)
      return { ok: true }
    })

    // ============ #190��wf.openFolder �� �򿪱����ļ��У�Markdown ��˲ֿ��������============
    // ���룺{ cwd }��ƽ̨�ַ���win32 explorer / darwin open / linux xdg-open���� platform.resolveExecutable����subprocess.spawn ��
    harness.handle('wf.openFolder', async function (args) {
      const cwd = (args && (args.cwd || args.path)) || DEFAULT_CWD
      if (!cwd) return { ok: false, error: 'ȱ�� cwd' }
      try {
        const platform = await getPlatform()
        const os = platform.os || (typeof process !== 'undefined' && process.platform) || 'win32'
        const openerName = os === 'win32' ? 'explorer' : os === 'darwin' ? 'open' : 'xdg-open'
        const opener = await platform.resolveExecutable(openerName)
        if (!opener) return { ok: false, error: '�Ҳ���������' + openerName }
        // cwd ��һ��platform.path ����ָ����
        let target = String(cwd)
        try { if (platform.path && typeof platform.path.normalize === 'function') target = platform.path.normalize(target) } catch {}
        // win32 explorer �豣��ԭ�ָ����darwin/linux �� posix ����
        const argv = [opener, target]
        try {
          const handle = subprocess.spawn({ argv: argv, cwd: DEFAULT_CWD || target, stdio: { stdin: 'ignore', stdout: { maxBytes: 64*1024 }, stderr: { maxBytes: 64*1024 } }, graceMs: 2000 })
          // ���ȴ���ɣ�fire-and-forget���� spawn ͬ���״�����Ϊʧ��
          if (handle && handle.done) {
            // �첽�����̵������δ���� rejection Ӱ����壻�ɹ�������
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

    // ============ �쿨���ַ�����T1 #34 �� �޲ֿ�ʱһ�����ַ�����============
    // ���룺{ cwd, name, visibility }��visibility = 'public' | 'private'��Ĭ�� private��
    // ���̣�̽�� git/gh/auth��ǰ�ã��� git init(������ git ������) �� git add . �� git commit --allow-empty���� user.* ���ף��� gh repo create --source=. --push���� --remote origin �Ѵ���ʱ�� set-url + push ��֧��
    // ���أ�{ ok: true, repo: { owner, name } } | { ok: false, errorKind, error, repoUrl? }
    // errorKind: no-git / no-gh / not-logged-in / already-exists / network / permission��6 �������ݲݸ��е� bad-name ����ӳ��Ϊ permission��
    harness.handle('wf.initPublish', async function (args) {
      const cwd = (args && args.cwd) || DEFAULT_CWD
      const name = args && args.name ? String(args.name).trim() : ''
      const visibility = (args && args.visibility) === 'public' ? 'public' : 'private'
      if (!name) return { ok: false, errorKind: 'bad-name', error: '�ֿ���Ϊ��' }
      if (!/^[A-Za-z0-9._-]+$/.test(name) || name.length > 100) {
        return { ok: false, errorKind: 'bad-name', error: '�ֿ�����֧����ĸ/����/._- �� ��100��' + name }
      }
      const visFlag = visibility === 'public' ? '--public' : '--private'
      // ǰ��̽�⣺git / gh / auth��ʧ�ܿ췵�������ѸĶ���������
      const git = await resolveGit()
      if (!git) return { ok: false, errorKind: 'no-git', error: 'δ�ҵ� git���밲װ https://git-scm.com/��' }
      const gh = await resolveGh()
      if (!gh) return { ok: false, errorKind: 'no-gh', error: ghLastError || 'δ�ҵ� gh���밲װ https://cli.github.com/��', prompt: '��Ϊ DSH ��װ GitHub CLI��gh������ ��������������� gh��\n\n1. �ȼ�飺�ն�ִ�� `gh --version`���а汾����� �� ֱ�ӻ㱨��װ�汾����������Ҫ�ظ���װ��\n2. �� gh �� OS ��װ��Windows �� `winget install --id GitHub.cli`; macOS �� `brew install gh`; Linux �� `sudo apt install gh`;\n3. ��װ����֤���ؿ��ն�ʹ PATH ��Ч��`gh --version` ����汾�ţ�\n4. �� gh ��װ�� DSH �Ա�δ��װ���㻷����顸�ز⡹��ť������ DSH Desktop��\n5. ��ɺ�㱨��gh �汾�� + ��gh CLI ���á����ѱ��̡�' }
      const authR = await runGh(['auth', 'status'], cwd)
      if (!authR.ok) {
        const t = String(authR.error || '').toLowerCase()
        if (authR.kind === 'network' || /network|econn|timed out|timeout|enotfound|getaddrinfo|connect/.test(t)) {
          return { ok: false, errorKind: 'network', error: authR.error }
        }
        return { ok: false, errorKind: 'not-logged-in', error: authR.error }
      }
      // ȡ��ǰ��¼�û������� already-exists ʱƴ repoUrl ��ɹ��� owner ���ף�
      let currentUser = ''
      try {
        const u = await runGh(['api', 'user', '-q', '.login'], cwd)
        if (u.ok) currentUser = u.text.trim()
      } catch (e) { /* ���� */ }
      const classifyCreateError = function (errText, kind) {
        const low = String(errText || '').toLowerCase()
        if (/already exists|name already exists|already exists on github|repository.*already exists/i.test(low)) return 'already-exists'
        if (kind === 'network' || /network|econn|timed out|timeout|enotfound|getaddrinfo|connect etimedout|unable to access|failed to connect|could not resolve host/i.test(low)) return 'network'
        if (/not logged in|auth failed|bad credentials|authentication required|gh auth login/i.test(low)) return 'not-logged-in'
        if (/permission|forbidden|403|401|insufficient|not authorized|resource not accessible|must be.*admin/i.test(low)) return 'permission'
        if (kind === 'auth') return 'not-logged-in'
        return 'permission'
      }
      // 1. git init�������� git �ֿ����������� getRepoRoot ̽�� + �建�棩
      try {
        const probe = await execProc([git, '-C', cwd, 'rev-parse', '--is-inside-work-tree'], cwd)
        if (!probe.ok) {
          const initR = await execProc([git, 'init'], cwd)
          if (!initR.ok) {
            const k = classifyCreateError(initR.error, null)
            return { ok: false, errorKind: k === 'already-exists' ? 'permission' : k, error: initR.error }
          }
          // ʧЧ repoRoots ����
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
      // 3. git commit --allow-empty���� identity ȱʧ���ף�
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
      // 4. ̽�� remote origin �Ƿ��Ѵ��ڣ����� gh ���÷�֧��
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
        // origin �Ѵ��ڣ��ȴ���Զ�ֿ̲⣨���� --source������ set-url + push
        const cr2 = await runGh(['repo', 'create', name, visFlag], cwd)
        if (!cr2.ok) {
          const kind = classifyCreateError(cr2.error, cr2.kind)
          const repoUrl = (kind === 'already-exists' && currentUser) ? ('https://github.com/' + currentUser + '/' + name) : undefined
          return { ok: false, errorKind: kind, error: cr2.error, repoUrl: repoUrl }
        }
        // �����½��ֿ� URL��gh ����� https://github.com/owner/name��
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
      // �ɹ���ʧЧȫ�����棬ʹͷ�� owner/repo ��������
      cache = { ts: 0, snapshot: null, error: null, cwd: null }
      statusCache = { ts: 0, status: null, error: null, cwd: null, lang: null }
      if (cwd && repoKeys[cwd] !== undefined) delete repoKeys[cwd]
      if (repoKeys[DEFAULT_CWD] !== undefined) delete repoKeys[DEFAULT_CWD]
      if (cwd && repoRoots[cwd] !== undefined) delete repoRoots[cwd]
      if (repoRoots[DEFAULT_CWD] !== undefined) delete repoRoots[DEFAULT_CWD]
      // ������ getRepoKey �ؽ�����parseGithubRepo���������� currentUser
      let owner = currentUser
      try {
        const rk = await getRepoKey(cwd)
        if (rk && rk.owner) owner = rk.owner
        else if (rk && rk.name) owner = owner || ''
      } catch (e) { /* ���� */ }
      // �� getRepoKey ��ȡ�������� currentUser������ currentUser Ϊ׼
      if (!owner) {
        try {
          const u2 = await runGh(['api', 'user', '-q', '.login'], cwd)
          if (u2.ok) owner = u2.text.trim()
        } catch (e2) { /* ���� */ }
      }
      return { ok: true, repo: { owner: owner, name: name } }
    })

    // ============ ��ѯ���Ѱ� #348 �İ� Q3 �رգ�60s ȫ�� �� 8 map �� 2400-4800 GraphQL points/h �� 5000 �޶============
    // ˢ�²��� = ���ֶ���״̬��/��尴ť wf.refresh��+ ����弴ˢ��client �� loadSnapshot����
    // P1 ����״̬�仯 toast ���ѣ��ٿ��ǵ�Ƶ�Զ�����ʱ�ָ����鲢�۲�����

    // B3 rpc ͨ��ע�᣺/dsws �� dispatch ���loopback Ȩ����
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
