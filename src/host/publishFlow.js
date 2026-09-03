// src/host/publishFlow.js —— 建仓发布与重试推送（H6 #450 从 host/index.js 855–1005/1007–1028 搬出，纯结构；classifyCreateError 由 initPublish 内提升为模块共享）。
// 以后谁改它：改建仓发布流程或推送重试的人。预估约190行，超 350 打回。
// 接线：由 index.js 动态 import 加载；repoKeys/repoRoots 与 H1 同形（对象引用，删除才删得中）；本文件不引用其他新文件。
export function createPublishFlow(deps) {
  const { DEFAULT_CWD, resolveGit, resolveGh, getGhLastError, runGh, execProc, canonicalKey, getRepoKey, repoKeys, repoRoots, setCache } = deps
  const classifyCreateError = function (errText, kind) {
    const low = String(errText || '').toLowerCase()
    if (/already exists|name already exists|already exists on github|repository.*already exists/i.test(low)) return 'already-exists'
    if (kind === 'network' || /network|econn|timed out|timeout|enotfound|getaddrinfo|connect etimedout|unable to access|failed to connect|could not resolve host/i.test(low)) return 'network'
    if (/not logged in|auth failed|bad credentials|authentication required|gh auth login/i.test(low)) return 'not-logged-in'
    if (/permission|forbidden|403|401|insufficient|not authorized|resource not accessible|must be.*admin/i.test(low)) return 'permission'
    if (kind === 'auth') return 'not-logged-in'
    return 'permission'
  }
  // ============ 红卡建仓发布（T1 #34 · 无仓库时一键建仓发布）============
  // 输入：{ cwd, name, visibility }（visibility = 'public' | 'private'，默认 private）
  // 流程：探测 git/gh/auth（前置）→ git init(若已是 git 则跳过) → git add . → git commit --allow-empty（含 user.* 兜底）→ gh repo create --source=. --push（或 --remote origin 已存在时走 set-url + push 分支）
  // 返回：{ ok: true, repo: { owner, name } } | { ok: false, errorKind, error, repoUrl? }
  // errorKind: no-git / no-gh / not-logged-in / already-exists / network / permission（6 档，兼容草稿中的 bad-name 兜底映射为 permission）
  async function handleInitPublish(args) {
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
    if (!gh) return { ok: false, errorKind: 'no-gh', error: getGhLastError() || '未找到 gh（请安装 https://cli.github.com/）', prompt: '请为 DSH 安装 GitHub CLI（gh）—— 面板所有数据依赖 gh：\n\n1. 先检查：终端执行 `gh --version`；有版本号输出 → 直接汇报已装版本并结束，不要重复安装；\n2. 无 gh 则按 OS 安装：Windows → `winget install --id GitHub.cli`; macOS → `brew install gh`; Linux → `sudo apt install gh`;\n3. 安装后验证：重开终端使 PATH 生效，`gh --version` 输出版本号；\n4. 若 gh 已装但 DSH 仍报未安装：点环境检查「重测」按钮或重启 DSH Desktop；\n5. 完成后汇报：gh 版本号 + 「gh CLI 可用」项已变绿。' }
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
    setCache({ ts: 0, snapshot: null, error: null, cwd: null })
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
  }

  // ============ 重试推送（#420/#426 定版：仅推送，不动建仓）============
  // 入参：{ cwd, name, repoUrl, owner }（半成功时由前端从 initPublish 结果带出）
  // 流程：origin 缺失则以 repoUrl 补 remote → git push -u origin HEAD；成功 ok:true（前端走成功闭环），失败回带半成功契约
  async function handleRetryPush(args) {
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
      try { setCache({ ts: 0, snapshot: null, error: null, cwd: null }) } catch (eCache) { /* 缓存失效兜底 */ }
      return { ok: true, repo: { owner: owner, name: name }, repoUrl: owner ? ('https://github.com/' + owner + '/' + name) : '' }
    }
    const kind = classifyCreateError(pushR.error, null)
    return { ok: false, errorKind: kind, error: pushR.error, repoUrl: repoUrl || undefined, repo: { owner: owner, name: name }, halfCreated: true }
  }
  return { handleInitPublish, handleRetryPush }
}