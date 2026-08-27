/**
 * backends/github/index.js — GitHub 后端适配器（主缝实现，契约对齐）。
 *
 * 定版：#133（labels 对齐）+#138（13 ops 形状归一 + 错误分类）+#129（平台三底座）
 * 2026-08-28 下沉（#227 · D7/D8）：parseGithubRepo / getRepoKey / describe / issueUrl / initProject / checks 迁移入本模块，
 * host 私货删除，registry 只转发（见 registry.js describe/issueUrl 转发）。
 * 对照 contract.js 14 操作集（OPERATIONS）与 shape.js，不手拼 OS 路径，所有 OS 交互经 ctx.platform。
 * 本文件按 14 op 形状装配；不再自造布尔能力表/ detect；matches 为 registry 身份（boolean），不属 OpName。
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { ghClient } from './client.js'
import { ghPreflight } from './preflight.js'
import { listIssues, getIssue, createIssue, closeIssue, reopenIssue, updateIssue, setAssignees } from './issues.js'
import { addComment } from './comments.js'
import { setLabels } from './labels.js'
import { setParent, getDependencies, setBlockedBy } from './graph.js'

// ============ 仓库定位：parseGithubRepo（从 host 迁移，语义不变） ============
/**
 * 解析 git 远程 URL → GitHub owner/repo；非 GitHub 返回 null（与 host/index.js parseGithubRepo 同构）。
 * 支持 SSH (git@github.com:owner/repo.git) 与 HTTPS (https://github.com/owner/repo.git)
 */
export function parseGithubRepo(url) {
  const s = String(url || '').trim()
  const m = s.match(/github\.com[\/:]([^\/\s]+)\/([^\/\s]+?)(?:\.git)?\s*$/)
  if (!m) return null
  return { owner: m[1], name: m[2] }
}

// ============ RepositoryRef 供给：describe（契约成员，registry 只转发） ============
/**
 * 出 RepositoryRef：owner/name → url=github.com；handle.refId 优先，其次 cwd basename。
 * 同步纯函数（registry 期望同步），远端解析（getRepoKey）为独立 async 助手，host 按需调用。
 */
export function describe(handle, backendId) {
  const rawRef = handle && typeof handle.refId === 'string' && handle.refId ? String(handle.refId).trim() : ''
  const cwd = handle && typeof handle.cwd === 'string' ? String(handle.cwd) : ''
  // refId 若为 owner/name 形态，直接作为 url 源
  let refId = rawRef
  // 若 refId 为空且 cwd 形如 owner/name（极少数显式传入），也接受
  if (!refId && cwd && cwd.includes('/') && !cwd.includes('\\') && cwd.split('/').length === 2) {
    // 启发式：cwd 看起来像 owner/name（非路径），直接用
    const maybe = cwd.trim()
    if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(maybe)) refId = maybe
  }
  const name = refId || (cwd ? cwd.split(/[\\/]/).pop() || cwd : backendId) || backendId
  const url = refId && refId.includes('/') ? 'https://github.com/' + refId : ''
  return { backend: backendId, refId: refId || '', name: name || refId || backendId, url }
}

// ============ URL 供给：issueUrl / searchUrl / linkPattern（契约只读 view） ============
export function issueUrl(ref, key) {
  const refId = ref && typeof ref.refId === 'string' ? ref.refId : ''
  if (!refId) return ''
  return 'https://github.com/' + refId + '/issues/' + String(key)
}

export function searchUrl(name) {
  return 'https://github.com/search?q=' + encodeURIComponent(String(name || ''))
}

export const linkPattern = /github\.com\/[^\/\s]+\/[^\/\s]+\/issues\/(\d+)/g

// ============ 仓库定位（async）：getRepoKey 迁移（原 host/index.js 三级 Tier 语义不变） ============
/**
 * 解析 cwd 对应的 GitHub owner/name（git remote → .git/config → gh repo view）。
 * 供 host snapshot / describe 异步补全使用；语义与 host 原 getRepoKey 等价。
 * @param {string} cwd
 * @param {import('../../contract.js').OpContext} ctx （含 platform/fs/exec/platform.resolveExecutable）
 * @returns {Promise<{owner:string,name:string}|null>}
 */
export async function getRepoKey(cwd, ctx) {
  const execCwd = cwd || ''
  const platform = ctx && ctx.platform ? ctx.platform : null
  const fs = platform && platform.fs ? platform.fs : (ctx && ctx.fs ? ctx.fs : null)

  // Tier 1：git remote get-url origin + parseGithubRepo
  try {
    if (platform && typeof platform.resolveExecutable === 'function') {
      const git = await platform.resolveExecutable('git')
      if (git && ctx && typeof ctx.exec === 'function') {
        try {
          const r = await ctx.exec('git', ['-C', execCwd, 'remote', 'get-url', 'origin'], { cwd: execCwd, timeout: 3000 })
          const out = (r && (r.stdout || r.text || r.stdout === '' ? (r.stdout || r.text) : '')) || ''
          const k = parseGithubRepo(String(out))
          if (k) return k
        } catch (e) {}
      } else if (git) {
        // 回退：若 ctx.exec 不可用，尝试 platform.exec
        try {
          const execFn = ctx.exec || (platform && platform.exec)
          if (typeof execFn === 'function') {
            const r2 = await execFn('git', ['-C', execCwd, 'remote', 'get-url', 'origin'], { cwd: execCwd, timeout: 3000 })
            const out2 = (r2 && (r2.stdout || r2.text)) || ''
            const k2 = parseGithubRepo(String(out2))
            if (k2) return k2
          }
        } catch (e2) {}
      }
    }
  } catch (e) {}

  // Tier 2：.git/config 直读 origin
  if (fs && typeof fs.resolve === 'function' && typeof fs.readText === 'function') {
    try {
      const t = await fs.resolve('.git/config', { cwd: execCwd })
      const txt = await fs.readText(t)
      const um = String(txt || '').match(/\[remote\s+"origin"\][^[]*url\s*=\s*([^\r\n]+)/)
      if (um) {
        const k = parseGithubRepo(um[1])
        if (k) return k
      }
      // 兼容行级 url=
      const um2 = String(txt || '').match(/url\s*=\s*(.+)/)
      if (um2 && !um) {
        const k2 = parseGithubRepo(um2[1])
        if (k2) return k2
      }
    } catch (e) {}
  }

  // Tier 3：gh repo view 兜底
  try {
    const c = ghClient(ctx)
    const rr = await c.execGh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd: execCwd })
    if (rr && rr.ok) {
      const s = (rr.data.stdout || '').trim()
      const idx = s.indexOf('/')
      if (idx > 0) return { owner: s.slice(0, idx), name: s.slice(idx+1) }
    }
  } catch (e) {}
  return null
}

// ============ checks() 目录：GitHub 后端 4 项（c1/c4/c5/c6 语义不变） ============
/**
 * GitHub 后端检查目录（与 check-catalog GITHUB_CATALOG 同源，供链快照/八股校验）。
 * 4 项：仓库定位(github remote 可解析) / gh CLI / gh 已登录 / API 可达
 * 每项形状：{id, label, check, origin}，与 shared/check-catalog 对齐（此处为运行时 view，轻量复用）
 */
export const GITHUB_CHECKS = Object.freeze([
  {
    id: 'gh:remote',
    label: 'GitHub 远端可解析（git remote origin → owner/name）',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'backend', id: 'repoRemote', backendId: 'github' },
    origin: 'host/checkRepo→github/repo.js:parseGithubRepo (inventory 类别 8 c1)',
  },
  {
    id: 'gh:installed',
    label: 'GitHub CLI (gh) 已安装',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'primitive', primitive: 'commandExists', command: 'gh' },
    origin: 'host/index.js:checkGhCli / backends/github/preflight.js:1 (inventory 类别 8 c4)',
  },
  {
    id: 'gh:authed',
    label: 'gh 已登录（gh auth status）',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'preflight', id: 'ghAuth' },
    origin: 'host/index.js:checkGhAuth / backends/github/preflight.js:2 (c5)',
  },
  {
    id: 'gh:repoAccess',
    label: '仓库可达（gh api repos/{owner}/{name}）',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'backend', id: 'repoAccess', backendId: 'github' },
    origin: 'backends/github/preflight.js:3 / inventory 类别 8 c6',
  },
])

/**
 * 供编排层/门禁调用的只读 view：按需返回目录（轻量，与 catalogFor('github') 后端段一致）。
 */
export function checks() {
  return [...GITHUB_CHECKS]
}

// ============ initProject 契约 op（git init→commit→gh repo create→push） ============
/**
 * 工作区初始化并发布为 GitHub 仓库。
 * 流程与 host 原 wf.initPublish 等价（错误分类六档语义不变）：
 *  - 前置：git / gh / auth（失败快返，避免已改动工作区）
 *  - 步骤：git init(已是 git 则跳过) → git add . → git commit(--allow-empty+user.*兜底) → gh repo create(--source=.--push 或 set-url+push)
 *  - 成功：{ok:true, data:RepositoryRef}
 *  - 失败：{ok:false, error:{kind, message}} kind∈{no-git,no-gh,not-logged-in,already-exists,network,permission,bad-name,parse}
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

  function classifyCreateError(errText, kind) {
    const low = String(errText || '').toLowerCase()
    if (/already exists|name already exists|already exists on github|repository.*already exists/i.test(low)) return 'already-exists'
    if (kind === 'network' || /network|econn|timed out|timeout|enotfound|getaddrinfo|connect etimedout|unable to access|failed to connect|could not resolve host/i.test(low)) return 'network'
    if (/not logged in|auth failed|bad credentials|authentication required|gh auth login/i.test(low)) return 'not-logged-in'
    if (/permission|forbidden|403|401|insufficient|not authorized|resource not accessible|must be.*admin/i.test(low)) return 'permission'
    if (kind === 'auth') return 'not-logged-in'
    return 'permission'
  }

  // 前置探测：git / gh / auth（失败快返，避免已改动工作区）
  const git = await resolveGitLocal()
  if (!git) return { ok: false, error: { kind: 'no-git', message: '未找到 git（请安装 https://git-scm.com/）' } }
  const gh = await resolveGhLocal()
  if (!gh) return { ok: false, error: { kind: 'no-gh', message: '未找到 gh（请安装 https://cli.github.com/）', prompt: '请为 DSH 安装 GitHub CLI（gh）—— 面板所有数据依赖 gh：\n\n1. 先检查：终端执行 gh --version;\n2. 无 gh 则按 OS 安装：Windows → winget install --id GitHub.cli; macOS → brew install gh; Linux → sudo apt install gh;\n3. 安装后验证：gh --version;\n4. 若 gh 已装但 DSH 仍报未安装：点环境检查「重测」按钮或重启 DSH Desktop；\n5. 完成后汇报：gh 版本号 + 「gh CLI 可用」项已变绿。' } }
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

  // 1. git init（若已是 git 仓库则跳过）
  try {
    const probe = await execProcLocal([git, '-C', cwd, 'rev-parse', '--is-inside-work-tree'], cwd)
    if (!probe.ok) {
      const initR = await execProcLocal([git, 'init'], cwd)
      if (!initR.ok) {
        const k = classifyCreateError(initR.error, null)
        return { ok: false, error: { kind: k === 'already-exists' ? 'permission' : k, message: initR.error } }
      }
    }
  } catch (e) {
    const initR = await execProcLocal([git, 'init'], cwd)
    if (!initR.ok) {
      const k = classifyCreateError(initR.error, null)
      return { ok: false, error: { kind: k === 'already-exists' ? 'permission' : k, message: initR.error } }
    }
  }

  // 2. git add .
  const addR = await execProcLocal([git, 'add', '.'], cwd)
  if (!addR.ok) {
    const k = classifyCreateError(addR.error, null)
    return { ok: false, error: { kind: k, message: addR.error } }
  }

  // 3. git commit --allow-empty（含 identity 缺失兜底）
  let commitR = await execProcLocal([git, 'commit', '-m', 'initial commit', '--allow-empty'], cwd)
  if (!commitR.ok) {
    const low = String(commitR.error || '').toLowerCase()
    if (/please tell me who you are|user\.name|user\.email|author identity unknown|unable to auto-detect email/.test(low)) {
      await execProcLocal([git, 'config', 'user.email', 'dsh@local'], cwd)
      await execProcLocal([git, 'config', 'user.name', 'DSH User'], cwd)
      commitR = await execProcLocal([git, 'commit', '-m', 'initial commit', '--allow-empty'], cwd)
    }
    if (!commitR.ok) {
      const k = classifyCreateError(commitR.error, null)
      return { ok: false, error: { kind: k, message: commitR.error } }
    }
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
    if (!pushR.ok) {
      const kind = classifyCreateError(pushR.error, null)
      return { ok: false, error: { kind, message: pushR.error } }
    }
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

/**
 * Registry 身份：matches(handle, ctx) → boolean
 * 启发式：handle.refId 含 '/' → 视为 github（显式绑定）；否则检查 cwd 下 .git/config 是否含 github.com
 * 不抛错；不确定一律 false + diagnostics 由 registry 调用方日志（此处只返回 boolean）
 */
export async function githubMatches(handle, ctx) {
  try {
    if (handle && typeof handle.refId === 'string' && handle.refId.includes('/')) {
      // 若 refId 已显式为 owner/name，视为命中（由 host 显式绑定或 registry describe 产生）
      // 进一步可校验 fs 上是否有 .scratch/map.md，但 GitHub 真实归属以 remote 为准，此处宽松命中
      return true
    }
    // 尝试读 .git/config（经 platform.fs）
    const platform = ctx && ctx.platform ? ctx.platform : null
    const fs = platform && platform.fs ? platform.fs : (ctx && ctx.fs ? ctx.fs : null)
    const cwd = (handle && handle.cwd) || (ctx && ctx.cwd) || ''
    if (fs && cwd && typeof fs.readText === 'function' && typeof fs.resolve === 'function') {
      try {
        const t = await fs.resolve('.git/config', { cwd })
        const txt = await fs.readText(t)
        if (typeof txt === 'string' && /github\.com/i.test(txt)) return true
      } catch {}
    }
    // 回落：尝试 git remote get-url origin（经 ctx.exec）
    if (ctx && typeof ctx.exec === 'function' && cwd) {
      try {
        const r = await ctx.exec('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { cwd, timeout: 3000 })
        const out = (r && (r.stdout || r.text)) || ''
        if (/github\.com/i.test(String(out))) return true
      } catch {}
    }
    return false
  } catch {
    return false
  }
}

/**
 * 创建 GitHub 后端适配器（Tracker）。
 * @param {import('../../contract.js').BackendContext} ctx DSH host ctx（platform 已解析实例注入，#113）
 * @returns {import('../../contract.js').Tracker}
 */
export function createGithubBackend(ctx) {
  // 可选：预解析 ghPath 无副作用，此处不做
  void ghClient(ctx)
  return {
    id: 'github',
    preflight: (handle, opCtx) => ghPreflight(handle, opCtx || ctx),
    list: (repo, filter, opCtx) => listIssues(repo, filter, opCtx || ctx),
    get: (repo, key, opts, opCtx) => getIssue(repo, key, opts, opCtx || ctx),
    getDependencies: (repo, key, opts, opCtx) => getDependencies(repo, key, opts, opCtx || ctx),
    create: (repo, input, opCtx) => createIssue(repo, input, opCtx || ctx),
    close: (repo, key, opts, opCtx) => closeIssue(repo, key, opts, opCtx || ctx),
    reopen: (repo, key, opCtx) => reopenIssue(repo, key, opCtx || ctx),
    comment: (repo, key, body, opCtx) => addComment(repo, key, body, opCtx || ctx),
    update: (repo, key, patch, opCtx) => updateIssue(repo, key, patch, opCtx || ctx),
    setLabels: (repo, key, labels, opts, opCtx) => setLabels(repo, key, labels, opts, opCtx || ctx),
    setAssignees: (repo, key, assignees, opts, opCtx) => setAssignees(repo, key, assignees, opts, opCtx || ctx),
    setParent: (repo, key, parentKey, opts, opCtx) => setParent(repo, key, parentKey, opts, opCtx || ctx),
    setBlockedBy: (repo, key, blockers, opts, opCtx) => setBlockedBy(repo, key, blockers, opts, opCtx || ctx),
    getCurrentUser: async (repo, opCtx) => {
      const c = ghClient(opCtx || ctx)
      const r = await c.execGh(['api', 'user', '--jq', '{login: .login, name: .name, avatarUrl: .avatar_url}'], { cwd: (opCtx && opCtx.cwd) || (ctx && ctx.cwd) })
      if (!r.ok) {
        const kind = (r.error && r.error.kind) || 'unsupported'
        // 未登录或无权限 → 返回 unsupported，UI 将不做“本人不显”过滤（全显）
        if (kind === 'auth' || kind === 'unsupported') return { ok: false, error: { kind: ERROR_KIND.UNSUPPORTED, message: r.error && r.error.message || 'viewer unsupported' } }
        return { ok: false, error: r.error }
      }
      try {
        const j = JSON.parse(r.data.stdout || r.data.text || '{}')
        const login = String(j.login || '').trim()
        if (!login) return { ok: false, error: { kind: ERROR_KIND.UNSUPPORTED, message: 'viewer login empty' } }
        const actor = { login }
        if (j.name) actor.name = String(j.name)
        if (j.avatarUrl) actor.avatarUrl = String(j.avatarUrl)
        else if (j.avatar_url) actor.avatarUrl = String(j.avatar_url)
        actor.kind = 'user'
        return { ok: true, data: actor }
      } catch (e) {
        return { ok: false, error: { kind: ERROR_KIND.PARSE, message: String(e.message || e) } }
      }
    },
    initProject: (handle, input, opCtx) => initProject(handle, input, opCtx || ctx),
    describe: (handle, opCtx) => describe(handle, 'github'),
    issueUrl: (ref, key) => issueUrl(ref, key),
  }
}

/**
 * BackendModule（供 registry.register 用）。
 * - id/label/create/matches 四件套；select/describe 由 registry 托管，不属 OpName
 * - 额外只读 view：describe / issueUrl / searchUrl / linkPattern（供 registry 转发）
 */
export const githubModule = {
  id: 'github',
  label: 'GitHub',
  // #191：品牌色完整色板（B 方案定版 · #177）——后端是配色单一真源，UI 仅消费
  presentation: {
    color: '#0969da',
    darkColor: '#58a6ff',
    bg: 'light-dark(#ddf4ff, rgba(56,139,253,.15))',
    border: 'light-dark(rgba(84,174,255,.4), rgba(56,139,253,.4))',
  },
  create: createGithubBackend,
  matches: githubMatches,
  describe,
  issueUrl,
  searchUrl,
  linkPattern,
  checks,
}

export default createGithubBackend
