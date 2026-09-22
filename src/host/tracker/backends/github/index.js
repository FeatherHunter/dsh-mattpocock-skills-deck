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
// #664：缺 gh 时注入的那句原话（唯一一份）住在共享清单里，这里读它、不抄第二份字面量。
import { guideInjectTextOf } from '../../../../shared/tracker/guide-steps.js'
import { describe, issueUrl, searchUrl, linkPattern, links, capabilities, openRepository } from './repo.js'
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
 * 文案引用本模块 prompts 键：ghAuthLogin / repoAccessFix（双语单源）；缺 gh 时那句原话来自共享清单
 *   src/shared/tracker/guide-steps.js（#664：同一个缺失状态不许有两份说明）。
 */
// 缺 gh 时点一下要注入的那句原话（维护者 2026-09-19 给的那一句，逐字不改）。
const GH_INSTALL_INJECT_TEXT = guideInjectTextOf('gh:installed')
export const fixes = Object.freeze({
  // 2026-08-29（审查 S1/S2）：hint 只做「状态翻译」——说清这行为什么红、不修会怎样、有无第二条路；
  //   不再指挥点击（按钮自己会说话）、不贴命令（命令在指引全文里）、去掉与判定矛盾的「网络不通」表述。
  'gh:installed': {
    hint: {
      zh: 'GitHub 助手（gh cli）还没安装，安装后即可继续。',
      en: 'The GitHub CLI (gh) is not installed yet — install it to continue.',
    },
    actions: [
      // #664：缺 gh 时那句话只有一份 —— 共享清单里 gh:installed 那一步的原话。这里直接把文案填进动作里
      //   （fixContract 的解析规则本来就允许 action.prompt 直接是文案），于是检查页这一行的按钮与状态栏
      //   那条横幅注入的是同一句话；原先那段按系统分平台的安装长文（noGhPrompt）按新流程退役。
      { type: 'inject-prompt', prompt: GH_INSTALL_INJECT_TEXT, label: { zh: '安装指引', en: 'Install guide' } },
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
      zh: '此目录未关联 GitHub 仓库。先点「创建并发布」完成建仓推送，再执行初始化；初始化全文中的标签步骤需等待仓库就绪变绿。想用本地 Markdown，可在顶端切换后端后再查。',
      en: 'This directory is not linked to a GitHub repo. First click "Create & publish" to finish creating and pushing the repo, then run initialization; the label steps in the full setup prompt must wait until the repo rows turn green. To use local Markdown, switch the backend at the top and re-check.',
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
    // #664：原先这里有 noGhPrompt（按系统分平台的安装长文）与 repoRemoteFix（缺仓长文）两段。
    //   缺 gh 那句话收成共享清单里 gh:installed 那一步的原话（见上面的 GH_INSTALL_INJECT_TEXT），
    //   缺仓库那件事由界面上那一段负责（状态栏「还没有远端仓库」那条横幅 + 检查页那一行的两步建仓弹窗），
    //   两段长文都退役了 —— 一个缺失状态不留第二份说明（规格 #662 定版三）。
    repoAccessFix: {
      zh: '当前仓库无法通过 GitHub API 访问（gh api repos/{owner}/{name} 失败）。顺序要求：若仓库尚未创建，先走「创建并发布」完成建仓推送，再重查；请按序排查：\n1. 仓库存在性：gh repo view <owner>/<name> --json nameWithOwner；不存在 → 与用户确认后执行 gh repo create（仓库名/可见性先确认）；\n2. 访问权限：gh auth status 确认登录账号；私有仓库需该账号有权限（403/404 都可能是权限问题）；\n3. 网络/代理：gh config get http_proxy 与网络连通性。\n排查修复后请用户点「重新检查」。',
      en: 'The repository is not reachable via the GitHub API (gh api repos/{owner}/{name} failed). Ordering rule: if the repo does not exist yet, run "Create & publish" to finish creating and pushing it, then re-check; investigate in order:\n1. Existence: gh repo view <owner>/<name> --json nameWithOwner; if missing → confirm with the user, then gh repo create (confirm name/visibility first);\n2. Permissions: gh auth status to confirm the account; private repos need access for this account (403/404 can both be permission issues);\n3. Network/proxy: gh config get http_proxy and connectivity.\nAfter fixing, ask the user to re-check.',
    },
    subIssue: {
      // #603：改回 gh 直连写法（用户环境本来就有 gh，不必先解析插件目录再调脚本）。先取子票的数据库 id 建原生子议题边，再校验张数；阻塞关系建原生依赖边，`Blocked by:` 文字行只作降级兜底。
      zh: '先 gh api repos/{owner}/{repo}/issues/{child} --jq .id 取子议题数据库 id，再 gh api repos/{owner}/{repo}/issues/{map}/sub_issues -X POST -F sub_issue_id={id} 建边；以 gh api repos/{owner}/{repo}/issues/{map}/sub_issues --jq length 校验计数与预期一致。阻塞关系建原生依赖边：gh api repos/{owner}/{repo}/issues/{child}/dependencies/blocked_by -X POST -F issue_id={阻塞它的那张票的数据库 id}；子票正文首行的 `Blocked by: #n` 只作降级兜底。',
      en: 'first gh api repos/{owner}/{repo}/issues/{child} --jq .id for child id, then gh api repos/{owner}/{repo}/issues/{map}/sub_issues -X POST -F sub_issue_id={id}; verify with gh api repos/{owner}/{repo}/issues/{map}/sub_issues --jq length equals expected. Build blocking as a native dependency edge: gh api repos/{owner}/{repo}/issues/{child}/dependencies/blocked_by -X POST -F issue_id={database id of the blocking issue}; the `Blocked by: #n` line at the top of the child body is only the fallback.'
    },
    // #684：「体检」的 GitHub 科目（游离的开放票归位）。总纲住在提示词单源 src/client/kernel/prompts.js 的
    //   healthCheck 一条；这里只交 GitHub 自己那一份，经总纲里的 {subject} 填空。建边与开图复用本模块已声明的
    //   prompts.subIssue 那份原生关联文本（{subIssue}），不在新文案里重抄一遍命令。
    healthCheck: {
      zh: '**这条后端查数与动手都用下面这套写法**（总纲里的三条口径在这里不变）。\n\n查数：用 gh issue list 拿全仓库开放票，再用每张地图的原生子议题清单核对（gh api repos/{owner}/{repo}/issues/{map}/sub_issues --jq length 逐张数，出现在任何一张清单里的都不算游离）。\n\n建边：先用 gh api repos/{owner}/{repo}/issues/{child} --jq .id 取子票的数据库编号，再用 gh api repos/{owner}/{repo}/issues/{map}/sub_issues -X POST -F sub_issue_id={id} 建原生子议题边，最后用同一条清单命令核对张数与预期一致。{subIssue}\n\n阻塞关系：先把下面命令里的 {blocker} 换成阻塞它的那张票的票号，用 gh api repos/{owner}/{repo}/issues/{blocker} --jq .id 取到它的数据库编号，记为 {blocker_id}，再用 gh api repos/{owner}/{repo}/issues/{child}/dependencies/blocked_by -X POST -F issue_id={blocker_id} 建原生依赖边。子票正文首行的 Blocked by: #n 只作降级兜底。',
      en: '**On this backend, count and act with the wiring below** (the three rules from the general section stay as they are).\n\nCounting: list every open ticket in the repository with gh issue list, then check each map native sub-ticket list (gh api repos/{owner}/{repo}/issues/{map}/sub_issues --jq length, counted map by map — anything appearing in any list is not orphaned).\n\nAttaching: first gh api repos/{owner}/{repo}/issues/{child} --jq .id for the sub-ticket database id, then gh api repos/{owner}/{repo}/issues/{map}/sub_issues -X POST -F sub_issue_id={id} for the native sub-ticket edge, then re-query the same list command to confirm the count matches the plan. {subIssue}\n\nBlocking: first replace {blocker} in the command below with the number of the ticket blocking it, run gh api repos/{owner}/{repo}/issues/{blocker} --jq .id for its database id, call it {blocker_id}, then gh api repos/{owner}/{repo}/issues/{child}/dependencies/blocked_by -X POST -F issue_id={blocker_id} for the native dependency edge. A Blocked by: #n line at the top of the child body is only the fallback.\n\nGroup the report by label and suggestion type.',
    },
    // #595：正文格式契约归后端单源；#603：改回 #567 之前的写法（只讲正文文件该怎么写，不点名任何命令 —— 写回命令各后端自己知道，GitHub 就是 gh）
    bodyFormat: {
      zh: '## 正文格式（写/改 issue 正文时必须遵守）\n- [ ] 用真实换行书写：每个 `## 章节` 独占一行，段落间留空行\n- [ ] 禁止字面 \\n 转义（不要把换行写成 \\n 两个字符）、禁止正文以 BOM（\\ufeff）开头\n- [ ] 写回 issue 正文时以文件方式提交（文件内为真实换行），不要内联转义字符串\n- [ ] 正例：`## 进度：90%` 独占一行，空行后接 `下一步：xxx`（反例：`## 进度：90%\\n下一步：xxx`）',
      en: '## Body format (mandatory when writing/editing an issue body)\n- [ ] Use real newlines: each `## section` on its own line, with a blank line between paragraphs\n- [ ] No literal \\n escapes (do not write newlines as the two characters backslash-n), no BOM (\\ufeff) at the start\n- [ ] Write the body back via a file (real newlines in the file), never an inline escaped string\n- [ ] Example: `## Progress: 90%` on its own line, blank line, then `Next step: ...` (not `## Progress: 90%\\nNext step: ...`)',
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
  // 开仓方式（#231 的开仓契约动作）：'url' = 界面用浏览器新窗打开 describe().url。
  // 2026-09-13 补（#620 整改）：这个字段原来只以文件级导出的形式存在（export { openRepository }），
  //   **没有进注册表真正读的那个模块对象** —— 注册表只在字段存在时才转发，于是「后端自己声明开仓方式」
  //   这条规矩在 GitHub 上落到「没读到开仓方式」那一态（GitHub 版的推荐配色方案文案拼不出来）。
  //   本地 Markdown 一直是好的（markdownModule 里带 openRepository: 'folder'），这里补上同一个值。
  openRepository,
  prompts,
  checks,
  fixes,
}

export default createGithubBackend
