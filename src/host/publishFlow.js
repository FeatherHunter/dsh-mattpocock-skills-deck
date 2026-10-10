// src/host/publishFlow.js —— 建仓发布与重试推送（H6 #450 从 host/index.js 855–1005/1007–1028 搬出，纯结构；classifyCreateError 由 initPublish 内提升为模块共享）。
// 以后谁改它：改建仓发布流程或推送重试的人。预估约190行，超 350 打回。
// 接线：由 index.js 动态 import 加载；repoKeys/repoRoots 与 H1 同形（对象引用，删除才删得中）；本文件不引用其他新文件。
//
// 2026-10-10（票 #993 / #994）：本文件原先自带一份 classifyCreateError，与
//   src/host/tracker/backends/github/init-project.js 里那份逐字符相同。现在两处都改成引
//   src/shared/tracker/ 下的共享实现（那里是 cross-import 门禁的白名单目录）：
//     · initProjectErrorKinds.js —— 兜底从 permission 改成 unknown，「认不出来」不再等于「没权限」；
//     · workspaceOwnership.js    —— 「属主不一致」这一档的唯一判断，两票共用。
//   另外 #994 在流程最前面加了「工作区 git 可用性」探测：属主不一致时补一条 safe.directory
//   再重试一次，仍然不行才报错 —— 不再让问题推迟到 git add 才炸。
import { makeCreateErrorClassifier, KIND_UNKNOWN } from '../shared/tracker/initProjectErrorKinds.js'
import { isOwnershipMismatch, ownershipPathFrom, safeDirectoryCommand } from '../shared/tracker/workspaceOwnership.js'

export function createPublishFlow(deps) {
  const { DEFAULT_CWD, resolveGit, resolveGh, getGhLastError, runGh, execProc, canonicalKey, getRepoKey, repoKeys, repoRoots, setCache, logCtx } = deps
  // #606：本文件里的外部命令全是 git，都属于「初始化仓库 / 推送」这条链，统一打上链名再往下传，
  //   这样日志里的 exec.run 行就能答出「这条命令是发布链起的」。
  const gitExec = function (argv, cwd) { return execProc(argv, cwd, 'publish') }
  // #993：分类器收进共享模块（两处调用方共用一份，见文件头 2026-10-10 注）。属主那一档由
  //   共享的 workspaceOwnership 判断，这里只把判断函数注入进去。
  const classifyCreateError = makeCreateErrorClassifier({ isOwnership: isOwnershipMismatch })

  // ============ #994：动手前的「工作区 git 可用性」探测与属主自愈 ============
  // 为什么必须有这一步：git 的 safe.directory 保护会在属主与运行用户不一致时直接拒绝操作
  //   （stderr 原文 `fatal: detected dubious ownership ...`）。检测这件事的命令本来就跑在流程
  //   第一步，但原先它的结果只被用来决定「要不要 git init」，没有当成环境结论；于是问题被推迟
  //   到 git add 才炸，而那条报错又被分类成「权限不足」，把人的排查方向整体带偏（票 #993）。
  //
  // 探针用 `rev-parse --is-inside-work-tree`，已实测（git 2.49，GIT_TEST_ASSUME_DIFFERENT_OWNER=1）：
  //   属主不一致时它自己就会以退出码 128 失败并报出同一段原文，所以拿它当前置关卡够用。
  //
  // 「不在仓库里」不是错误：这个工作区本来就还没建仓，流程接着走 git init。判据取 git 原话
  //   `not a git repository`，与「属主不一致」一样都是读原文，不做别的猜测。
  const NOT_A_REPO_RE = /not a git repository/i

  async function probeWorktreeUsable(git, cwd) {
    const r = await gitExec([git, '-C', cwd, 'rev-parse', '--is-inside-work-tree'], cwd)
    if (r.ok) return { ok: true }
    const text = String(r.error || '')
    if (isOwnershipMismatch(text)) return { ok: false, kind: 'git-ownership', text }
    if (NOT_A_REPO_RE.test(text)) return { ok: true, notRepoYet: true }
    return { ok: false, kind: classifyCreateError(text, null), text }
  }

  // 属主不一致时的自愈：补一条 safe.directory 再让调用方重试一次。
  //   用 git 报出来的那个目录（它报的就是它实际比对过的路径），不自己拼路径 —— Android 上
  //   /sdcard 常是软链，两种写法在配置里是两个不同字符串，拼错那个等于没修。
  //   用 --add 是维护者定的写法；实测这一条是幂等的（同值重复添加不会写出第二行），不会堆积。
  async function healOwnership(git, cwd, probeText) {
    const dir = ownershipPathFrom(probeText) || cwd
    const r = await gitExec([git, 'config', '--global', '--add', 'safe.directory', dir], cwd)
    return { ok: !!r.ok, dir: dir, repaired: !!r.ok }
  }

  // git 侧失败的统一信封（分类器认档 + 这一档对用户说什么）。
  //   #993 的两条要求就落在这里：属主那一档给「能照做的一句话」，unknown 那一档把 git 的原始
  //   报错原样交给用户 —— 认不出来却翻译成「权限不足」，正是这次要修掉的毛病。
  function gitFail(errText) {
    const kind = classifyCreateError(errText, null)
    const raw = String(errText || '')
    if (kind === 'git-ownership') {
      const cmd = safeDirectoryCommand(ownershipPathFrom(raw) || cwd)
      return {
        ok: false,
        errorKind: kind,
        error: '这个工作区的属主不是当前运行用户，git 拒绝操作（原文：dubious ownership）。' +
          (cmd ? '修法：' + cmd : ''),
      }
    }
    if (kind === KIND_UNKNOWN) {
      return { ok: false, errorKind: kind, error: '创建失败，未识别的原因。git 原话：' + raw.slice(0, 160) }
    }
    return { ok: false, errorKind: kind, error: raw }
  }

  // #994：这一段是「动手改工作区之前」的环境关卡。返回 ok 时，工作区要么本来就能用 git，
  //   要么刚刚补好 safe.directory 之后已确认能用；返回失败时一步都还没改过这个目录。
  async function preflightWorkspaceGit(git, cwd) {
    const first = await probeWorktreeUsable(git, cwd)
    if (first.ok) return first
    if (first.kind !== 'git-ownership') return first
    // 属主不一致：补一条 safe.directory 再试一次。
    const heal = await healOwnership(git, cwd, first.text)
    const second = await probeWorktreeUsable(git, cwd)
    if (second.ok) return { ok: true, healed: !!heal.ok, dir: heal.dir }
    // 修了还是不行（写不进全局配置、或配置里的路径与 git 认的不是同一个字符串）—— 如实报，
    //   不许把「没修好」说成「已修复」。
    return { ok: false, kind: 'git-ownership', text: second.text, triedRepair: true }
  }
  // ============ 红卡建仓发布（T1 #34 · 无仓库时一键建仓发布）============
  // 输入：{ cwd, name, visibility }（visibility = 'public' | 'private'，默认 private）
  // 流程：#994 工作区 git 可用性探测（属主不一致则补 safe.directory 重试一次）→ git/gh/auth 前置 →
  //   git init(若已是 git 则跳过) → git add . → git commit --allow-empty（含 user.* 兜底）→
  //   gh repo create --source=. --push（或 --remote origin 已存在时走 set-url + push 分支）
  // 返回：{ ok: true, repo: { owner, name } } | { ok: false, errorKind, error, repoUrl? }
  // errorKind: no-git / no-gh / not-logged-in / already-exists / network / permission / git-ownership / unknown
  //   （#993：兜底从 permission 改成 unknown，「属主不一致」单独成 git-ownership 一档）
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
    // 0. #994：动手改工作区之前的可用性关卡（属主不一致在这一步就被拦下并试着自愈，
    //    不会等到 git add 才炸；失败时这一步没有改动过这个目录）。
    const usable = await preflightWorkspaceGit(git, cwd)
    if (!usable.ok) return gitFail(usable.text)
    // 1. git init（若已是 git 仓库则跳过；含 getRepoRoot 探测 + 清缓存）
    try {
      if (!usable.notRepoYet) {
        // 探针已经证明这个目录在工作树里，git init 这一步不必再跑。
      } else {
        const initR = await gitExec([git, 'init'], cwd)
        if (!initR.ok) return gitFail(initR.error)
        // 失效 repoRoots 缓存（规整钥匙与写入侧同形，删除才删得中）
        const rk1 = await canonicalKey(cwd || DEFAULT_CWD)
        if (rk1 && repoRoots[rk1] !== undefined) delete repoRoots[rk1]
      }
    } catch (e) {
      const initR = await gitExec([git, 'init'], cwd)
      if (!initR.ok) return gitFail(initR.error)
      const rk2 = await canonicalKey(cwd || DEFAULT_CWD)
      if (rk2 && repoRoots[rk2] !== undefined) delete repoRoots[rk2]
    }
    // 2. git add .
    const addR = await gitExec([git, 'add', '.'], cwd)
    if (!addR.ok) return gitFail(addR.error)
    // 3. git commit --allow-empty（含 identity 缺失兜底）
    let commitR = await gitExec([git, 'commit', '-m', 'initial commit', '--allow-empty'], cwd)
    if (!commitR.ok) {
      const low = String(commitR.error || '').toLowerCase()
      if (/please tell me who you are|user\.name|user\.email|author identity unknown|unable to auto-detect email/.test(low)) {
        await gitExec([git, 'config', 'user.email', 'dsh@local'], cwd)
        await gitExec([git, 'config', 'user.name', 'DSH User'], cwd)
        commitR = await gitExec([git, 'commit', '-m', 'initial commit', '--allow-empty'], cwd)
      }
      if (!commitR.ok) return gitFail(commitR.error)
    }
    // 4. 探测 remote origin 是否已存在（决定 gh 调用分支）
    let hasOrigin = false
    try {
      const ro = await gitExec([git, 'remote', 'get-url', 'origin'], cwd)
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
        await gitExec([git, 'remote', 'set-url', 'origin', remoteUrl], cwd)
      }
      const pushR = await gitExec([git, 'push', '-u', 'origin', 'HEAD'], cwd)
      if (!pushR.ok) {
        const gf = gitFail(pushR.error)
        // #420/#426 半成功：远端仓库已创建、仅本地推送失败 → 回带 repoUrl/repo/halfCreated，前端展示链接与重试入口
        const repoUrl = remoteUrl ? remoteUrl.replace(/\.git$/, '') : (currentUser ? ('https://github.com/' + currentUser + '/' + name) : undefined)
        const owner = currentUser || (repoUrl ? (repoUrl.split('/')[3] || '') : '')
        return { ok: false, errorKind: gf.errorKind, error: gf.error, repoUrl: repoUrl, repo: repoUrl ? { owner: owner, name: name } : undefined, halfCreated: !!repoUrl }
      }
    }
    // #696 只清自己根那条（建仓改了这一个工作区的身份，别的根不动）；头部 owner/repo 靠这一次失效立即出现
    const rk3 = await canonicalKey(cwd || DEFAULT_CWD)
    try { setCache({ ts: 0, snapshot: null, error: null, cwd: rk3 }) } catch (eCache) { /* 缓存失效兜底 */ }
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
      const ro = await gitExec([git, 'remote', 'get-url', 'origin'], cwd)
      if (!ro.ok && repoUrl) { await gitExec([git, 'remote', 'add', 'origin', repoUrl + '.git'], cwd) }
    } catch (e) { /* remote 缺失时兜底 */ }
    const pushR = await gitExec([git, 'push', '-u', 'origin', 'HEAD'], cwd)
    if (pushR.ok) {
      try { const rkRetry = await canonicalKey(cwd || DEFAULT_CWD); setCache({ ts: 0, snapshot: null, error: null, cwd: rkRetry }) } catch (eCache) { try { setCache({ ts: 0, snapshot: null, error: null, cwd: null }) } catch {} /* #696 锚根失败兜底清全部（拿不出目录，仅此一条） */ }
      return { ok: true, repo: { owner: owner, name: name }, repoUrl: owner ? ('https://github.com/' + owner + '/' + name) : '' }
    }
    const gf = gitFail(pushR.error)
    return { ok: false, errorKind: gf.errorKind, error: gf.error, repoUrl: repoUrl || undefined, repo: { owner: owner, name: name }, halfCreated: true }
  }
  function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  function phoneLog(method, kind, t0, res, err) { try {
    if (err !== undefined && err !== null) { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((err && err.message) || err)) }) }
    else if (res && res.ok) { if (logCtx) logCtx.fire('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) }
    else if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((res && ((res.error && res.error.message) || res.error || res.errorKind)) || 'publish-not-ok')) }) } catch (eL) {} }
  function loggedPhone(method, kind, fn) { return async function () { const t0 = Date.now(); try { const r = await fn.apply(null, arguments); phoneLog(method, kind, t0, r); return r } catch (e) { phoneLog(method, kind, t0, null, e); throw e } } }
  return { handleInitPublish: loggedPhone('wf.initPublish', 'publish', handleInitPublish), handleRetryPush: loggedPhone('wf.retryPush', 'publish', handleRetryPush) }
}