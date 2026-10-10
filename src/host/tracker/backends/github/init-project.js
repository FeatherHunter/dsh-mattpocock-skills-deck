/**
 * backends/github/init-project.js — 开仓发布流程。
 *
 * 由 #440 从 index.js 纯结构移出（initProject），行为零变化。
 * 以后改创建发布流程的人改它。预估约 215 行。
 */

import { ghClient } from './client.js'
import { getRepoKey } from './repo.js'
// #993 / #994：分类器与「属主不一致」判断都收进 src/shared/tracker/（cross-import 门禁的白名单目录），
//   与面板那条路（src/host/publishFlow.js）共用同一份实现，避免两处各判一套而漂移。
import { makeCreateErrorClassifier, KIND_UNKNOWN } from '../../../../shared/tracker/initProjectErrorKinds.js'
import { isOwnershipMismatch, ownershipPathFrom, safeDirectoryCommand } from '../../../../shared/tracker/workspaceOwnership.js'

// ============ initProject 契约 op（git init→commit→gh repo create→push） ============
/**
 * 工作区初始化并发布为 GitHub 仓库。
 * 流程与 host 原 wf.initPublish 等价（错误分类档位语义不变；#993 起兜底为 unknown、增属主一档）：
 *  - 前置：#994 工作区 git 可用性（属主不一致则补 safe.directory 重试一次）/ git / gh / auth
 *    （失败快返，避免已改动工作区）
 *  - 步骤：git init(已是 git 则跳过) → git add . → git commit(--allow-empty+user.*兜底) → gh repo create(--source=.--push 或 set-url+push)
 *  - 成功：{ok:true, data:RepositoryRef}
 *  - 失败：{ok:false, error:{kind, message}} kind∈{no-git,no-gh,not-logged-in,already-exists,network,permission,git-ownership,unknown}
 */
export async function initProject(handle, input, ctx) {
  const cwd = (handle && handle.cwd) || (ctx && ctx.cwd) || ''
  const name = input && input.name ? String(input.name).trim() : ''
  const visibility = input && input.visibility === 'public' ? 'public' : 'private'
  if (!name) return { ok: false, error: { kind: 'bad-name', message: '仓库名为空' } }
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.length > 100) {
    return { ok: false, error: { kind: 'bad-name', message: '仓库名仅支持字母/数字/._- 且 ≤100：' + name } }
  }
  const visFlag = visibility === 'public' ? '--public' : '--private'

  const platform = ctx && ctx.platform ? ctx.platform : null
  const execFn = ctx && typeof ctx.exec === 'function' ? ctx.exec.bind(ctx) : (platform && typeof platform.exec === 'function' ? platform.exec.bind(platform) : null)

  // helper: execProc 兼容层（ctx.exec 契约 {stdout,stderr,code}；host 旧 execProc 返回 {ok,text,error}）
  async function execProcLocal(argv, execCwd) {
    const cmd = argv[0]
    const args = argv.slice(1)
    if (execFn) {
      try {
        const r = await execFn(cmd, args, { cwd: execCwd || cwd, timeout: 30000 })
        const code = r && typeof r.code === 'number' ? r.code : 0
        const out = r && typeof r.stdout === 'string' ? r.stdout : (r && r.text ? r.text : '')
        const err = r && typeof r.stderr === 'string' ? r.stderr : ''
        if (code !== 0) return { ok: false, code, error: (err || out || 'exit '+code).slice(0,400), text: out }
        return { ok: true, code: 0, text: out }
      } catch (e) {
        return { ok: false, code: -1, error: String((e && e.message) || e).slice(0,400), text: '' }
      }
    }
    // 回退：尝试 ghClient 的底层（仅用于测试 mock）
    return { ok: false, code: -1, error: 'exec unavailable', text: '' }
  }

  async function resolveGitLocal() {
    if (platform && typeof platform.resolveExecutable === 'function') {
      try { const p = await platform.resolveExecutable('git'); if (p) return p } catch (e) {}
    }
    if (execFn) {
      try { const r = await execFn('git', ['--version'], { cwd, timeout: 3000 }); if (r && r.code===0) return 'git' } catch (e) {}
    }
    return null
  }

  async function resolveGhLocal() {
    if (platform && typeof platform.resolveExecutable === 'function') {
      try { const p = await platform.resolveExecutable('gh'); if (p) return p } catch (e) {}
    }
    return null
  }

  // #993：分类器与宿主那条路（src/host/publishFlow.js）共用一份，见文件头引入说明。
  const classifyCreateError = makeCreateErrorClassifier({ isOwnership: isOwnershipMismatch })

  // ============ #994：动手前的「工作区 git 可用性」探测与属主自愈 ============
  // 与 publishFlow.js 同一套判据（探针命令、自愈写法、失败信封都一致），两处共用共享模块出判断。
  const NOT_A_REPO_RE = /not a git repository/i

  async function probeWorktreeUsable(git, cwd) {
    const r = await execProcLocal([git, '-C', cwd, 'rev-parse', '--is-inside-work-tree'], cwd)
    if (r.ok) return { ok: true }
    const text = String(r.error || '')
    if (isOwnershipMismatch(text)) return { ok: false, kind: 'git-ownership', text }
    if (NOT_A_REPO_RE.test(text)) return { ok: true, notRepoYet: true }
    return { ok: false, kind: classifyCreateError(text, null), text }
  }

  async function healOwnership(git, cwd, probeText) {
    const dir = ownershipPathFrom(probeText) || cwd
    const r = await execProcLocal([git, 'config', '--global', '--add', 'safe.directory', dir], cwd)
    return { ok: !!r.ok, dir: dir }
  }

  // git 侧失败的统一信封：属主那一档给可照做的一句话，unknown 那一档把 git 原话带给用户。
  function gitFail(errText, cwd) {
    const kind = classifyCreateError(errText, null)
    const raw = String(errText || '')
    if (kind === 'git-ownership') {
      const cmd = safeDirectoryCommand(ownershipPathFrom(raw) || cwd || '')
      return { ok: false, error: { kind: kind, message: '这个工作区的属主不是当前运行用户，git 拒绝操作（原文：dubious ownership）。' + (cmd ? '修法：' + cmd : '') } }
    }
    if (kind === KIND_UNKNOWN) {
      return { ok: false, error: { kind: kind, message: '创建失败，未识别的原因。git 原话：' + raw.slice(0, 160) } }
    }
    return { ok: false, error: { kind: kind, message: raw } }
  }

  // 返回 ok 时，工作区要么本来就能用 git，要么刚补好 safe.directory 并已确认能用；
  //   返回失败时，这一步一步都没改过这个目录。
  async function preflightWorkspaceGit(git, cwd) {
    const first = await probeWorktreeUsable(git, cwd)
    if (first.ok) return first
    if (first.kind !== 'git-ownership') return first
    await healOwnership(git, cwd, first.text)
    const second = await probeWorktreeUsable(git, cwd)
    if (second.ok) return { ok: true, healed: true }
    // 修了还是不行（写不进全局配置，或配置里的路径与 git 认的不是同一个字符串）—— 如实报。
    return { ok: false, kind: 'git-ownership', text: second.text, triedRepair: true }
  }

  // 前置探测：git / gh / auth（失败快返，避免已改动工作区）
  const git = await resolveGitLocal()
  if (!git) return { ok: false, error: { kind: 'no-git', message: '未找到 git（请安装 https://git-scm.com/）' } }
  const gh = await resolveGhLocal()
  if (!gh) return { ok: false, error: { kind: 'no-gh', message: '未找到 gh（请安装 https://cli.github.com/）', prompt: '请为 DSH 安装 GitHub CLI（gh）—— 面板所有数据依赖 gh：\n\n1. 先检查：终端执行 gh --version;\n2. 无 gh 则按 OS 安装：Windows → winget install --id GitHub.cli; macOS → brew install gh; Linux → sudo apt install gh;\n3. 安装后验证：gh --version;\n4. 若 gh 已装但 DSH 仍报未安装：点环境检查「重新检查」按钮或重启 DSH Desktop；\n5. 完成后汇报：gh 版本号 + 「gh CLI 可用」项已变绿。' } }
  // auth 探测
  try {
    const c = ghClient(ctx)
    const authR = await c.execGh(['auth', 'status'], { cwd })
    if (!authR.ok) {
      const t = String((authR.error && authR.error.message) || authR.error || '').toLowerCase()
      const kind = authR.error && authR.error.kind
      if (kind === 'network' || /network|econn|timed out|timeout|enotfound|getaddrinfo|connect/.test(t)) {
        return { ok: false, error: { kind: 'network', message: String(authR.error.message || authR.error).slice(0,400) } }
      }
      return { ok: false, error: { kind: 'not-logged-in', message: String(authR.error.message || authR.error).slice(0,400) } }
    }
  } catch (e) {
    const t = String((e && e.message) || e).toLowerCase()
    if (/network|econn|timed out|timeout|enotfound|getaddrinfo|connect/.test(t)) return { ok: false, error: { kind: 'network', message: String((e && e.message)||e).slice(0,400) } }
    return { ok: false, error: { kind: 'not-logged-in', message: String((e && e.message)||e).slice(0,400) } }
  }

  // 取当前登录用户（用于 already-exists 时拼 repoUrl 与成功后 owner 兜底）
  let currentUser = ''
  try {
    const c2 = ghClient(ctx)
    const u = await c2.execGh(['api', 'user', '-q', '.login'], { cwd })
    if (u && u.ok) currentUser = (u.data.stdout || '').trim()
  } catch (e) { /* 忽略 */ }

  // 0. #994：动手改工作区之前的可用性关卡（属主不一致在这一步被拦下并试着自愈，
  //    不会等到 git add 才炸；失败时这一步没有改动过这个目录）。
  const usable = await preflightWorkspaceGit(git, cwd)
  if (!usable.ok) return gitFail(usable.text, cwd)

  // 1. git init（若已是 git 仓库则跳过）
  try {
    if (usable.notRepoYet) {
      const initR = await execProcLocal([git, 'init'], cwd)
      if (!initR.ok) return gitFail(initR.error, cwd)
    }
  } catch (e) {
    const initR = await execProcLocal([git, 'init'], cwd)
    if (!initR.ok) return gitFail(initR.error, cwd)
  }

  // 2. git add .
  const addR = await execProcLocal([git, 'add', '.'], cwd)
  if (!addR.ok) return gitFail(addR.error, cwd)

  // 3. git commit --allow-empty（含 identity 缺失兜底）
  let commitR = await execProcLocal([git, 'commit', '-m', 'initial commit', '--allow-empty'], cwd)
  if (!commitR.ok) {
    const low = String(commitR.error || '').toLowerCase()
    if (/please tell me who you are|user\.name|user\.email|author identity unknown|unable to auto-detect email/.test(low)) {
      await execProcLocal([git, 'config', 'user.email', 'dsh@local'], cwd)
      await execProcLocal([git, 'config', 'user.name', 'DSH User'], cwd)
      commitR = await execProcLocal([git, 'commit', '-m', 'initial commit', '--allow-empty'], cwd)
    }
    if (!commitR.ok) return gitFail(commitR.error, cwd)
  }

  // 4. 探测 remote origin 是否已存在（决定 gh 调用分支）
  let hasOrigin = false
  try {
    const ro = await execProcLocal([git, 'remote', 'get-url', 'origin'], cwd)
    hasOrigin = !!ro.ok
  } catch (e) { hasOrigin = false }

  // 5. gh repo create
  const cGH = ghClient(ctx)
  if (!hasOrigin) {
    const cr = await cGH.execGh(['repo', 'create', name, visFlag, '--source=.', '--push'], { cwd })
    if (!cr.ok) {
      const kind = classifyCreateError(cr.error.message || cr.error, cr.error && cr.error.kind)
      const repoUrl = (kind === 'already-exists' && currentUser) ? ('https://github.com/' + currentUser + '/' + name) : undefined
      const err = { kind, message: String(cr.error.message || cr.error).slice(0,400) }
      if (repoUrl) err.repoUrl = repoUrl
      if (cr.error && cr.error.prompt) err.prompt = cr.error.prompt
      return { ok: false, error: err }
    }
  } else {
    // origin 已存在：先创建远程仓库（不带 --source），再 set-url + push
    const cr2 = await cGH.execGh(['repo', 'create', name, visFlag], { cwd })
    if (!cr2.ok) {
      const kind = classifyCreateError(cr2.error.message || cr2.error, cr2.error && cr2.error.kind)
      const repoUrl = (kind === 'already-exists' && currentUser) ? ('https://github.com/' + currentUser + '/' + name) : undefined
      const err = { kind, message: String(cr2.error.message || cr2.error).slice(0,400) }
      if (repoUrl) err.repoUrl = repoUrl
      return { ok: false, error: err }
    }
    // 解析新建仓库 URL（gh 输出含 https://github.com/owner/name）
    let remoteUrl = ''
    if (currentUser) remoteUrl = 'https://github.com/' + currentUser + '/' + name + '.git'
    else {
      const m = String((cr2.data && cr2.data.stdout) || '').match(/https:\/\/github\.com\/[^\s\/]+\/[^\s\/]+/)
      if (m) remoteUrl = m[0] + '.git'
    }
    if (remoteUrl) {
      await execProcLocal([git, 'remote', 'set-url', 'origin', remoteUrl], cwd)
    }
    const pushR = await execProcLocal([git, 'push', '-u', 'origin', 'HEAD'], cwd)
    if (!pushR.ok) return gitFail(pushR.error, cwd)
  }

  // 成功：解析 owner（优先 getRepoKey，回退 currentUser）
  let owner = currentUser
  try {
    const rk = await getRepoKey(cwd, ctx)
    if (rk && rk.owner) owner = rk.owner
  } catch (e) {}
  if (!owner) {
    try {
      const c3 = ghClient(ctx)
      const u2 = await c3.execGh(['api', 'user', '-q', '.login'], { cwd })
      if (u2 && u2.ok) owner = (u2.data.stdout || '').trim()
    } catch (e2) {}
  }
  const refId = owner ? owner + '/' + name : name
  const repoRef = { backend: 'github', refId, name: refId, url: 'https://github.com/' + refId }
  return { ok: true, data: repoRef }
}
