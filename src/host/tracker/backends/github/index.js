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
import { CANONICAL_LABELS } from '../../../../shared/labels.js'
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

// ============ UI-lane 描述数据（#231 类别7核销 · 宿主沙箱外只读）：链接模板/能力位/注入文案 后端单源 ============
/** #231：client 渲染与链接识别的模板数据；null 字段=诚实缺该形态。 */
export const links = {
  issueUrlTemplate: 'https://github.com/{refId}/issues/{key}',
  repoUrlTemplate: 'https://github.com/{refId}',
  searchUrlTemplate: 'https://github.com/search?q={q}',
  linkPatternSource: 'github\\.com\\/[^\\/\\s]+\\/[^\\/\\s]+\\/issues\\/(\\d+)',
}
/** 界面能力位（D8 末段）：仅驱动 UI 引导入口（标签补全步骤），永不被数据路径读取。 */
export const capabilities = { labelsGuide: true, repoCreateChain: true }
/** #231：开仓契约动作——url 型由 UI 以浏览器新窗打开 describe().url。 */
export const openRepository = 'url'

// ============ 修复契约（Fix Contract · 2026-08-28）：检查失败 → 修复指引（后端知识单源） ============
/**
 * 每个后端检查项的失败修复知识：hint（人读指引，随链渲染）+ actions（词汇表动作）。
 * host wf.chain 组装时按语言解析进 onFail.show.hint / onFail.actions（见 tracker/fixContract.js）；
 * UI 只渲染与分发，不识别后端、不推导修复步骤。
 * 文案引用本模块 prompts 键：ghAuthLogin / noGhPrompt / repoRemoteFix / repoAccessFix（双语单源）。
 */
export const fixes = Object.freeze({
  // 2026-08-29（审查 S1/S2）：hint 只做「状态翻译」——说清这行为什么红、不修会怎样、有无第二条路；
  //   不再指挥点击（按钮自己会说话）、不贴命令（命令在指引全文里）、去掉与判定矛盾的「网络不通」表述。
  'gh:installed': {
    hint: {
      zh: 'GitHub 助手（gh cli）还没安装，安装后即可继续。',
      en: 'The GitHub CLI (gh) is not installed yet — install it to continue.',
    },
    actions: [
      { type: 'inject-prompt', prompt: 'noGhPrompt', label: { zh: '安装指引', en: 'Install guide' } },
      { type: 'refresh', target: 'chain' },
    ],
  },
  'gh:authed': {
    hint: {
      zh: 'GitHub 登录状态已失效，重新登录后即可继续。',
      en: 'The GitHub login has expired — sign in again to continue.',
    },
    actions: [
      { type: 'inject-prompt', prompt: 'ghAuthLogin', label: { zh: '登录指引', en: 'Login guide' } },
      { type: 'refresh', target: 'chain' },
    ],
  },
  'gh:remote': {
    hint: {
      zh: '此目录未关联 GitHub 仓库。想用 GitHub 就点「创建并发布」；想用本地 Markdown，可在顶端切换后端后再查。',
      en: 'This directory is not linked to a GitHub repo. To use GitHub, click "Create & publish"; to use local Markdown, switch the backend at the top and re-check.',
    },
    // 修复动作（2026-08-28 用户定版）：wizard 两步（仓库名 → 可见性），走 wf.initPublish → github initProject；
    //   移除「修复指引」inject-prompt 主按钮：有 form/wizard 时注入文本不再以按钮出现（之前讨论判定为不合理功能）。
    actions: [
      {
        type: 'wizard',
        label: { zh: '创建并发布', en: 'Create & publish' },
        steps: [
          {
            title: { zh: '仓库信息', en: 'Repository info' },
            schema: [
              { name: 'name', type: 'text', required: true, label: { zh: '仓库名', en: 'Repo name' }, pattern: '^[A-Za-z0-9._-]{1,100}$', defaultFrom: 'cwd-basename', preview: { zh: '将创建 https://github.com/{owner}/{name}', en: 'Will create https://github.com/{owner}/{name}' } },
            ],
          },
          {
            title: { zh: '可见性', en: 'Visibility' },
            schema: [
              { name: 'visibility', type: 'single', label: { zh: '可见性', en: 'Visibility' }, options: ['private', 'public'], optionSubs: { private: { zh: '仅自己', en: 'Only you' }, public: { zh: '所有人', en: 'Everyone' } }, defaultValue: 'private' },
            ],
          },
        ],
        submitAction: { type: 'rpc', method: 'wf.initPublish', params: {} },
      },
      { type: 'refresh', target: 'chain' },
    ],
  },
  'gh:repoAccess': {
    hint: {
      zh: '仓库在 GitHub 上访问不到（可能还没创建，或你没有权限）。确认后点「创建并发布」；若只是网络问题，它会显示为等待状态。',
      en: 'The repo is not accessible on GitHub (it may not exist yet, or you lack access). Confirm, then "Create & publish"; if it is only a network issue, this shows as waiting instead.',
    },
    actions: [
      {
        type: 'wizard',
        label: { zh: '创建并发布', en: 'Create & publish' },
        steps: [
          {
            title: { zh: '仓库信息', en: 'Repository info' },
            schema: [
              { name: 'name', type: 'text', required: true, label: { zh: '仓库名', en: 'Repo name' }, pattern: '^[A-Za-z0-9._-]{1,100}$', defaultFrom: 'cwd-basename', preview: { zh: '将创建 https://github.com/{owner}/{name}', en: 'Will create https://github.com/{owner}/{name}' } },
            ],
          },
          {
            title: { zh: '可见性', en: 'Visibility' },
            schema: [
              { name: 'visibility', type: 'single', label: { zh: '可见性', en: 'Visibility' }, options: ['private', 'public'], optionSubs: { private: { zh: '仅自己', en: 'Only you' }, public: { zh: '所有人', en: 'Everyone' } }, defaultValue: 'private' },
            ],
          },
        ],
        submitAction: { type: 'rpc', method: 'wf.initPublish', params: {} },
      },
      { type: 'refresh', target: 'chain' },
    ],
  },
})
/** 注入文案数据（类别7核销）：键→双语全文；名单从 src/shared/labels.js 动态拼装，零第二份字面量名单。 */
export const prompts = (function () {
  const names = CANONICAL_LABELS.map(function (l) { return (l && l.name) ? String(l.name) : String(l) })
  const zhNames = names.join(', ')
  const enNames = names.join(', ')
  return {
    ensureLabels: {
      zh: '请为当前仓库补全缺失的核心标签（共 ' + names.length + ' 个）：\n\n必备标签：' + zhNames + '\n\n步骤：\n- [ ] 先检查现有标签（gh api repos/{owner}/{repo}/labels 或 gh label list --json name；名大小写不敏感）\n- [ ] 对缺失的每个标签执行 gh label create --repo {owner}/{repo} --name "<name>" --color <color> --description "<desc>"（已存在跳过，幂等；失败不回滚仓库）\n- [ ] 完成后用 gh label list 复查直至齐全\n\n色值/描述以 src/shared/labels.js 单源为准，仅校验名子集。',
      en: 'Please complete the missing canonical labels (' + names.length + ' total):\n\nRequired labels: ' + enNames + '\n\nSteps:\n- [ ] Check existing labels first (gh api repos/{owner}/{repo}/labels or gh label list --json name; case-insensitive)\n- [ ] For each missing label run gh label create --repo {owner}/{repo} --name "<name>" --color <color> --description "<desc>" (skip if exists, idempotent; do not rollback on failure)\n- [ ] Re-check via gh label list afterwards until complete\n\nColors/descriptions are single-sourced in src/shared/labels.js; verification is name-subset only.',
    },
    ghAuthLogin: {
      zh: '请完成 gh 登录：运行 gh auth login 并按提示在浏览器完成授权；结束后运行 gh auth status 确认已登录。',
      en: 'Please complete gh login: run gh auth login and finish browser authorization; afterwards run gh auth status to confirm.',
    },
    noGhPrompt: {
      zh: '请为 DSH 安装 GitHub CLI（gh）—— 面板所有数据依赖 gh：\n\n1. 先检查：终端执行 gh --version；\n2. 无 gh 则按 OS 安装：Windows → winget install --id GitHub.cli；macOS → brew install gh；Linux → sudo apt install gh。',
      en: 'Install the GitHub CLI (gh) for DSH — all panel data depends on it:\n\n1. Check first: run gh --version;\n2. If missing, install per OS: Windows → winget install --id GitHub.cli; macOS → brew install gh; Linux → sudo apt install gh.',
    },
    repoRemoteFix: {
      zh: '当前工作区不是 GitHub 仓库（git remote 无法解析为 owner/name）。优先路径：把本目录发布为 GitHub 仓库——用户可在「创建并发布」表单填写仓库名与可见性（公开/私有）提交（等价命令 gh repo create <name> --public/--private --source=. --push；非 Git 仓库由流程自动 git init）。仅当用户明确这是本地项目（不打算用 GitHub）时，才提示切换到「本地 Markdown」后端。不要替用户上传不属于本工作区的代码；创建前与用户确认仓库名与可见性。完成后请用户点「重新检查」。',
      en: 'No GitHub repository could be resolved for the current workspace (git remote origin → owner/name failed). Confirm intent with the user, then do one of:\n\nA. Local project (no GitHub needed) → tell the user to switch to the "Local Markdown" backend in the top picker; the check passes after re-check;\nB. GitHub is really wanted → ① if a Git repo: git remote add origin https://github.com/<owner>/<repo>.git (repo must exist, or first gh repo create <repo> --public/--private --source=. --push); ② if not a Git repo: git init first, then ①; ③ after pushing, ask the user to re-check.\nNever upload code that does not belong to this workspace; confirm repo name and visibility (public/private) with the user before creating.',
    },
    repoAccessFix: {
      zh: '当前仓库无法通过 GitHub API 访问（gh api repos/{owner}/{name} 失败）。请按序排查：\n1. 仓库存在性：gh repo view <owner>/<name> --json nameWithOwner；不存在 → 与用户确认后执行 gh repo create（仓库名/可见性先确认）；\n2. 访问权限：gh auth status 确认登录账号；私有仓库需该账号有权限（403/404 都可能是权限问题）；\n3. 网络/代理：gh config get http_proxy 与网络连通性。\n排查修复后请用户点「重新检查」。',
      en: 'The repository is not reachable via the GitHub API (gh api repos/{owner}/{name} failed). Investigate in order:\n1. Existence: gh repo view <owner>/<name> --json nameWithOwner; if missing → confirm with the user, then gh repo create (confirm name/visibility first);\n2. Permissions: gh auth status to confirm the account; private repos need access for this account (403/404 can both be permission issues);\n3. Network/proxy: gh config get http_proxy and connectivity.\nAfter fixing, ask the user to re-check.',
    },
    subIssue: {
      zh: '先 gh api repos/{owner}/{repo}/issues/{child} --jq .id 取子议题数据库 id，再 gh api repos/{owner}/{repo}/issues/{map}/sub_issues -X POST -F sub_issue_id={id} 建边；以 gh api repos/{owner}/{repo}/issues/{map}/sub_issues --jq length 校验计数与预期一致',
      en: 'first gh api repos/{owner}/{repo}/issues/{child} --jq .id for child id, then gh api repos/{owner}/{repo}/issues/{map}/sub_issues -X POST -F sub_issue_id={id}; verify with gh api repos/{owner}/{repo}/issues/{map}/sub_issues --jq length equals expected'
    },
    errorKinds: {
      'no-git': { zh: '未找到 git，请先安装 Git', en: 'git not found — please install Git' },
      'no-gh': { zh: '未找到 gh，请先安装 GitHub CLI', en: 'gh not found — please install GitHub CLI' },
      'not-logged-in': { zh: '未登录 GitHub，请先执行 gh auth login', en: 'Not logged into GitHub — run gh auth login' },
      'already-exists': { zh: '同名仓库已存在（可在平台查看）', en: 'Repository already exists (view it on the platform)' },
    },
  }
})()

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
// 2026-08-29（审查 S1）：label 与 check-catalog GITHUB_CATALOG 同步人话化——两处必须字面一致（单一口径）。
export const GITHUB_CHECKS = Object.freeze([
  {
    id: 'gh:remote',
    label: '已关联 GitHub 仓库',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'backend', id: 'repoRemote', backendId: 'github' },
    origin: 'host/checkRepo→github/repo.js:parseGithubRepo (inventory 类别 8 c1)',
  },
  {
    id: 'gh:installed',
    label: 'GitHub 助手（gh cli）已安装',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'primitive', primitive: 'commandExists', command: 'gh' },
    origin: 'host/index.js:checkGhCli / backends/github/preflight.js:1 (inventory 类别 8 c4)',
  },
  {
    id: 'gh:authed',
    label: '已登录 GitHub',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'preflight', id: 'ghAuth' },
    origin: 'host/index.js:checkGhAuth / backends/github/preflight.js:2 (c5)',
  },
  {
    id: 'gh:repoAccess',
    label: '仓库在 GitHub 上可访问',
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
  // #230（D10 · 键入 locale）：setup 提示词描述数据 —— 只声明 client locale 双语键名，文案不落后端（双语单源）
  setupPrompt: {
    trackerLine: 'setup.github.trackerLine',
    trackerChoice: 'setup.github.trackerChoice',
    backendNote: 'setup.github.backendNote',
    labelReqs: 'setup.github.labelReqs',
  },
  create: createGithubBackend,
  matches: githubMatches,
  describe,
  issueUrl,
  searchUrl,
  linkPattern,
  links,
  capabilities,
  prompts,
  checks,
  fixes,
}

export default createGithubBackend
