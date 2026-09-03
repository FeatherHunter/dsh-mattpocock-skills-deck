/**
 * backends/github/index.js — GitHub 后端房间入口（只转发，不写逻辑）。
 *
 * #440 拆分后：仓库身份与链接见 repo.js，检查目录见 checks.js，开仓流程见
 * init-project.js，后端装配见 backend.js，issue 读写见 issues.js / issues-write.js。
 * fixes / prompts / githubModule 字面量留在本文件（多道产物门禁按文件文本断言，不可搬）。
 * 以后改房间对外契约的人看它。预估约 190 行。
 *
 * 定版：#133（labels 对齐）+#138（13 ops 形状归一 + 错误分类）+#129（平台三底座）
 * 定版：#133（labels 对齐）+#138（13 ops 形状归一 + 错误分类）+#129（平台三底座）
 * 2026-08-28 下沉（#227）：parseGithubRepo / getRepoKey / describe / issueUrl / initProject / checks 入本模块，
 * host 私货删除，registry 只转发。
 * 对照 contract.js 操作集与 shape.js，不手拼 OS 路径，所有 OS 交互经 ctx.platform。
 */

import { CANONICAL_LABELS } from '../../../../shared/labels.js'
import { describe, issueUrl, searchUrl, linkPattern, links, capabilities } from './repo.js'
import { checks } from './checks.js'
import { githubMatches, createGithubBackend } from './backend.js'
export { describe, issueUrl, searchUrl, linkPattern, links, capabilities, checks, githubMatches, createGithubBackend }
export { parseGithubRepo, getRepoKey, openRepository } from './repo.js'
export { GITHUB_CHECKS } from './checks.js'
export { initProject } from './init-project.js'

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
      'bad-name': { zh: '仓库名仅支持字母、数字、._- 且不超过 100 个字符', en: 'Repo name supports only letters, digits, ._- and at most 100 characters' },
      'no-git': { zh: '未找到 git，请先安装 Git', en: 'git not found — please install Git' },
      'no-gh': { zh: '未找到 gh，请先安装 GitHub CLI', en: 'gh not found — please install GitHub CLI' },
      'not-logged-in': { zh: '未登录 GitHub，请先执行 gh auth login', en: 'Not logged into GitHub — run gh auth login' },
      'already-exists': { zh: '同名仓库已存在（平台可查看）', en: 'Repository already exists (view it on the platform)' },
      'network': { zh: '网络异常，请重试', en: 'Network error — please retry' },
      'permission': { zh: '权限不足，请检查登录账号', en: 'Permission denied — check your login account' },
      'half-created': { zh: '仓库已创建，但本地推送未完成', en: 'Repository created, but the local push failed' },
    },
  }
})()

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
