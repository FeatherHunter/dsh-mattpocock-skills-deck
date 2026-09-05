// src/host/repoKeys.js —— 执行与仓库钥匙（H1 #445 从 host/index.js 496–720 搬出，纯结构、行为零变化）
// 以后谁改它：改外部进程执行（gh/git）、工作区钥匙规整或仓库根与磁盘缓存策略的人。预估约 270 行，超 350 打回。
// 接线：由 index.js 动态 import 动态加载；getPlatform/getWorkspaceStore/setCache/clearWorkspaceStore/namingSweepSoon/parseGithubRepo 显式注入；本文件不引用其他新文件。
// 显式传参编辑：共享状态归 index.js 持有——ghPath/ghLastError 经存取器读写，repoKeys/repoRoots 按引用共享，cache 重赋值改 setCache；resetGhCache 的 _workspaceStore 直访改 clearWorkspaceStore（状态归 platformChannel）。行为与搬前一致。
export function createRepoKeys(deps) {
  const { subprocess, timer, fs, DEFAULT_CWD, TIMEOUT_MS, repoKeys, repoRoots, getGhPath, setGhPath, getGhLastError, setGhLastError, getPlatform, getWorkspaceStore, setCache, clearWorkspaceStore, namingSweepSoon, parseGithubRepo, logCtx } = deps
  // 共享状态归 index.js 单一持有：ghPath/ghLastError 经存取器（基本类型重赋值不能按引用共享）；repoKeys/repoRoots 按引用共享（只做属性读写与删除，从不整体重赋值）。
  // #491 房外埋点 helpers：hash8 只记散列不记原文；P1 事件外层先判开关再组装字段（字段函数只在守卫通过后求值）。
  function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  let lastNormKind = ''
  let lastCanonOut = ''
    // ============ gh 封装 ============
    // #195 修复：resolveGh 不再缓存失败（ghLastError 仅最近一次失败，环境修复后下次探测即恢复）
    async function resolveGh() {
      if (getGhPath()) return getGhPath()
      const platform = await getPlatform()
      // 2026-08-29 去重（research 实锤「DSH_GH_PATH 三端不一致」）：DSH_GH_PATH 兜底已下沉至 composePlatform
      //   通用层单点拥有（platform.resolveExecutable('gh') 内置 env.get+lstat 校验），此处不再重复实现，
      //   host 只保留未命中的诚实错误信息与 ghPath 缓存。
      const p = await platform.resolveExecutable('gh').catch(function () { return null })
      if (p) { setGhPath(p); setGhLastError(null); return p }
      // 回退：platform 未找到时，直接探测 gh 是否在 PATH 可执行（与 pwsh 的 where gh 一致）
      // 避免因 subprocess.resolveExecutable 的 PATH 与用户终端 PATH 分叉导致 414 这类外部建票永远拉不到
      try {
        const probeHandle = subprocess.spawn({ argv: ['gh', '--version'], cwd: DEFAULT_CWD, stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } }, graceMs: 1000 })
        const probeOutcome = await Promise.race([probeHandle.done, timer.timeout(2000).then(function(){ try{ probeHandle.terminate(); }catch(e){} return { exitCode: -1 } })])
        const outProbe = (probeHandle.collected && probeHandle.collected.stdout) ? probeHandle.collected.stdout.readFrom(0) : { text: '' }
        if (probeOutcome && probeOutcome.exitCode === 0 && String(outProbe.text||'').includes('gh version')) { setGhPath('gh'); setGhLastError(null); return 'gh' }
      } catch {}
      setGhLastError('gh 不可用：PATH 无 gh，且 DSH_GH_PATH 未配置（官方安装请访问 https://cli.github.com/）')
      try { if (logCtx) { let hasGhPath = false; try { hasGhPath = !!(platform && platform.env && platform.env.get && platform.env.get('DSH_GH_PATH')) } catch (eH) {} logCtx.fire('warn', 'gh.resolve.fail', { hasDSH_GH_PATH: hasGhPath, errorHash: hash8(getGhLastError()) }) } } catch (eL) {}
      return null
    }
    // #195 修复：force 探测路径调 resetGhCache 清空成功缓存，强制下次 resolveGh 重探
    function resetGhCache() { setGhPath(null); setGhLastError(null); try { if (typeof clearWorkspaceStore === 'function') clearWorkspaceStore(); } catch {} try { getWorkspaceStore().then(function(ws){ try{ ws.clear(); }catch(e){} }).catch(function(){}); } catch {} }

    async function runGh(args, cwd) {
      const ghT0 = Date.now()
      const exe = await resolveGh()
      if (!exe) return { ok: false, kind: 'env', error: getGhLastError() }
      let handle
      try {
        handle = subprocess.spawn({
          argv: [exe].concat(args),
          cwd: cwd || DEFAULT_CWD,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 4 * 1024 * 1024 }, stderr: { maxBytes: 256 * 1024 } },
          graceMs: 2000,
        })
      } catch (e) {
        try { if (logCtx) logCtx.fire('info', 'gh.exec', { argv0: 'gh', cwdHash: hash8(cwd || DEFAULT_CWD), latencyMs: Date.now() - ghT0, kind: 'spawn', exitCode: -1 }) } catch (eL) {}
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
        try { if (logCtx) logCtx.fire('info', 'gh.exec', { argv0: 'gh', cwdHash: hash8(cwd || DEFAULT_CWD), latencyMs: Date.now() - ghT0, kind: 'spawn', exitCode: -1 }) } catch (eL) {}
        return { ok: false, kind: 'spawn', error: String((e && e.message) || e) }
      }
      const out = (handle.collected && handle.collected.stdout) ? handle.collected.stdout.readFrom(0) : { text: '' }
      const err = (handle.collected && handle.collected.stderr) ? handle.collected.stderr.readFrom(0) : { text: '' }
      const all = (err.text || '') + (out.text || '')
      if (outcome.exitCode !== 0) {
        let kind = 'exit'
        const t = all.toLowerCase()
        if (/not logged in|auth failed|bad credentials|failed to log in|token.*invalid|keyring|re-authenticate|auth refresh/i.test(t)) kind = 'auth'
        else if (/404|not found|could not resolve to an? (issue|pull request)/i.test(t)) kind = 'notfound'
        else if (/network|econn|unexpected eof|timed out|connect/i.test(t)) kind = 'network'
        try { if (logCtx && outcome && outcome.signal === 'timeout') logCtx.fire('warn', 'gh.timeout', { argv0: 'gh', timeoutMs: TIMEOUT_MS }) } catch (eL) {}
        try { if (logCtx) logCtx.fire('info', 'gh.exec', { argv0: 'gh', cwdHash: hash8(cwd || DEFAULT_CWD), latencyMs: Date.now() - ghT0, kind: kind, exitCode: outcome.exitCode || -1 }) } catch (eL) {}
        try { if (logCtx && logCtx.isEnabled('debug') && kind !== lastNormKind) { lastNormKind = kind; logCtx.fire('debug', 'error.normalize', function () { return { rawKind: 'exit:' + String((outcome && outcome.exitCode) || -1), mappedKind: kind } }) } } catch (eL) {}
        return { ok: false, kind: kind, code: outcome.exitCode, error: all.slice(0, 400), text: out.text || '' }
      }
      // 彻底移除：issuePath 1A 白名单检测已移除（#345），只保留两项与面包屑无关的职责：
      //   ① create/edit 等写操作失效快照缓存，支撑右侧面板增量更新；
      //   ② create 成功仍触发 namingSweepSoon(500)——#266 建号感知快路径（新会话 0.5-2s 内归属编号档）不随面包屑退役。
      try {
        const a = Array.isArray(args) ? args : []
        if (a.length >= 2 && a[0] === 'issue' && /^(create|edit|close|comment|reopen)$/.test(String(a[1]))) {
          try { setCache({ ts: 0, snapshot: null, error: null, cwd: cwd }) } catch {}
          if (String(a[1]) === 'create') { try { namingSweepSoon(500) } catch (eW) {} }
        }
      } catch (e) {}
      try { if (logCtx) logCtx.fire('info', 'gh.exec', { argv0: 'gh', cwdHash: hash8(cwd || DEFAULT_CWD), latencyMs: Date.now() - ghT0, kind: 'ok', exitCode: 0 }) } catch (eL) {}
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

    // ============ 规整工作区钥匙（地图 #278 A 方案 · #279 落地）============
    // 同一工作区经会话快照不同字段上报时写法可能不同（盘符大小写/尾斜杠/斜杠方向）。
    // 按工作区分桶的抽屉（repoKeys/repoRoots/chainCache/workspaceStore/快照单槽）统一在
    // 读写删三侧使用 canonicalWorkspaceKey 洗出的规整钥匙——读写删同形，失效删除才删得中。
    // 绝对路径（主流形态）在洗衣机内部短路，零 fs 调用；异常时回退原串（读写删仍同形）。
    let _workspaceKeyMod = null
    async function canonicalKey(raw) {
      try {
        if (!_workspaceKeyMod) _workspaceKeyMod = await import('./workspaceKey.js')
        const m = _workspaceKeyMod
        const fn = m.canonicalWorkspaceKey || (m.default && m.default.canonicalWorkspaceKey)
        if (typeof fn !== 'function') { try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'workspaceKey.canonical', function () { return { rawHash: hash8(raw), normalizedHash: hash8(raw), fallback: true } }) } catch (eL) {}; return raw }
        const canonOut = await fn(raw, { getPlatform, getFs: () => fs, getDefaultCwd: () => DEFAULT_CWD })
        try { const fb = String(canonOut) === String(raw); if (logCtx && logCtx.isEnabled('debug') && (fb || canonOut !== lastCanonOut)) { lastCanonOut = canonOut; logCtx.fire('debug', 'workspaceKey.canonical', function () { return { rawHash: hash8(raw), normalizedHash: hash8(canonOut), fallback: fb } }) } } catch (eL) {}
        return canonOut
      } catch (e) { try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'workspaceKey.canonical', function () { return { rawHash: hash8(raw), normalizedHash: hash8(raw), fallback: true } }) } catch (eL) {}; return raw }
    }

    // ============ v1.5 T9：git 根检测 + 磁盘缓存（跨重启秒开）============
    // git rev-parse --show-toplevel 层层上溯找根；嵌套仓库（子目录含独立 .git）git 原生停在最近根 —— 符合用户要求
    // repoRoots 由 index.js 按引用共享（建仓失效删裸变量）；cacheDirResolved 本文件自有。
    let cacheDirResolved = null  // 缓存目录（惰性解析）
    async function getRepoRoot(cwd) {
      const key = await canonicalKey(cwd || DEFAULT_CWD)
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
        // cacheFormat 3 之后才可读（2→3：1.7.5 新增 map 五区块解析；旧快照缺 decisions/fog/outOfScope,destination,notes，
        // 视为陈旧强制重建，详情页不再抛且区块可展示；沿用 #327 的小写 state 防御）
        if (j && j.ok === true && Array.isArray(j.maps) && typeof j.generatedMs === 'number' && j.cacheFormat === 3) return j
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
        // 缓存格式版本 3：1.7.5 map 五区块（见上），旧格式一律视为不新鲜
        await fs.writeText(t, JSON.stringify(Object.assign({}, snap, { cacheFormat: 3 })))
      } catch (e) { /* 写失败不影响主流程 */ }
    }

    async function getRepoKey(cwd) {
      const rkT0 = Date.now()
      const key = await canonicalKey(cwd || DEFAULT_CWD)
      if (repoKeys[key]) return repoKeys[key]
      // v1.5 T11（map#37 · #38 R1 + #40 R2 输入）：
      //   多远程下 gh 必选 upstream（context/remote.go::remoteNameSortScore upstream(3)>github(2)>origin(1)），
      //   无参 `gh repo view` 永远返回原作者。改为：显式 `git remote get-url origin` + parseGithubRepo 首选，
//   失败再 .git/config 直读，兜底才用 gh repo view（与 getRepoKey 方案同源）。
      const root = await getRepoRoot(key)
      const execCwd = root || key
      // Tier 1：git remote get-url origin + parseGithubRepo（SSH/HTTPS 都由 parseRegex 覆盖）
      const git = await resolveGit()
      if (git) {
        const r = await execProc([git, '-C', execCwd, 'remote', 'get-url', 'origin'], execCwd)
        if (r.ok) {
          const k = parseGithubRepo(r.text)
          if (k) { repoKeys[key] = k; try { if (logCtx) logCtx.fire('info', 'repo.resolve.tier', { tier: 1, ok: true, latencyMs: Date.now() - rkT0 }) } catch (eL) {}; return k }
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
            if (k) { repoKeys[key] = k; try { if (logCtx) logCtx.fire('info', 'repo.resolve.tier', { tier: 2, ok: true, latencyMs: Date.now() - rkT0 }) } catch (eL) {}; return k }
          }
        } catch (e) { /* 落 Tier 3 */ }
      }
      // Tier 3：gh repo view 兜底（非 GitHub 仓库 / 边缘情况；保持向后兼容）
      const r = await runGh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], execCwd)
      if (!r.ok) { try { if (logCtx) logCtx.fire('info', 'repo.resolve.tier', { tier: 3, ok: false, latencyMs: Date.now() - rkT0 }) } catch (eL) {}; return null }
      const s = r.text.trim()
      const i = s.indexOf('/')
      if (i <= 0) return null
      repoKeys[key] = { owner: s.slice(0, i), name: s.slice(i + 1) }
      try { if (logCtx) logCtx.fire('info', 'repo.resolve.tier', { tier: 3, ok: true, latencyMs: Date.now() - rkT0 }) } catch (eL) {}
      return repoKeys[key]
    }
  return { resolveGh, resetGhCache, runGh, execProc, resolveGit, getHome, canonicalKey, getRepoRoot, getCacheDir, cacheFileName, readDiskCache, writeDiskCache, getRepoKey }
}
