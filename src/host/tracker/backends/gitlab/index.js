/**
 * backends/gitlab/index.js — GitLab 后端适配器（主缝实现）。
 *
 * 定版：#135（labels/milestone分流）+ #144 一页纸（数据归一8文件表 + blocking双路径 + preflight + parentKey归一 + 三底座）
 * 严格对照 contract.js 13操作集（OPERATIONS）与 shape.js；按 #113 平台抽象（ctx.platform / ctx.exec / ctx.fs）。
 * 能力诚实：未就绪op由registry Proxy补unsupported桩，此处不再自造布尔capabilities表。
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { fail } from '../../preflight.js'
import { glabPreflight } from './preflight.js'
import { listIssues, getIssue, createIssue, closeIssue, reopenIssue, updateIssue } from './issues.js'
import { addComment } from './comments.js'
import { setLabels } from './labels.js'
import { getDependencies, setBlockedBy, setParent, setAssignees } from './graph.js'

function repoId(handle) {
  if (!handle) return ''
  if (typeof handle.refId === 'string' && handle.refId) return handle.refId
  if (typeof handle.cwd === 'string' && handle.cwd) return handle.cwd
  return ''
}

/**
 * GitLab matches：启发式 boolean（读 .git/config / glab remote / issue-tracker.md）
 * 不确定一律 false + diagnostics（ctx.log.warn）
 */
async function matches(handle, ctx) {
  try {
    if (!handle || typeof handle !== 'object') return false
    // refId 显式含 gitlab 串 → true
    if (typeof handle.refId === 'string' && /gitlab/i.test(handle.refId)) return true
    const cwd = handle.cwd
    if (!cwd || typeof cwd !== 'string') return false
    const platform = ctx && ctx.platform
    const fs = (ctx && ctx.fs) || (platform && platform.fs)
    const log = ctx && ctx.log
    if (!fs || !platform) return false
    // 1) .git/config 是否含 gitlab
    try {
      const cfgPath = platform.path.join(cwd, '.git', 'config')
      // target-shaped需先resolve path-shaped；平台层path已处理，此处直接读
      const text = await fs.readText(cfgPath)
      if (typeof text === 'string' && /gitlab/i.test(text)) return true
    } catch {}
    // 2) issue-tracker.md 是否声明 gitlab
    try {
      const trackerPath = platform.path.join(cwd, 'docs', 'agents', 'issue-tracker.md')
      const text = await fs.readText(trackerPath)
      if (typeof text === 'string' && /gitlab/i.test(text)) return true
    } catch {}
    // 3) exec git remote 兜底（best-effort，5s）
    try {
      const exec = ctx.exec
      if (exec) {
        const res = await exec('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 2000 })
        const out = (res.stdout || '') + (res.stderr || '')
        if (/gitlab/i.test(out)) return true
      }
    } catch {}
    return false
  } catch (e) {
    try { if (ctx && ctx.log && ctx.log.warn) ctx.log.warn('gitlab matches error: ' + String(e)) } catch {}
    return false
  }
}

export function describe(handle, backendId) {
  const rawRef = handle && typeof handle.refId === 'string' && handle.refId ? String(handle.refId).trim() : ''
  const cwd = handle && typeof handle.cwd === 'string' ? String(handle.cwd) : ''
  let refId = rawRef
  const name = refId || (cwd ? cwd.split(/[\\/]/).pop() || cwd : backendId) || backendId
  const url = refId && refId.includes('/') ? 'https://gitlab.com/' + refId : ''
  return { backend: backendId, refId: refId || '', name, url }
}

export function issueUrl(ref, key) {
  const refId = ref && typeof ref.refId === 'string' ? ref.refId : ''
  if (!refId) return ''
  return 'https://gitlab.com/' + refId + '/-/issues/' + String(key)
}

export function searchUrl(name) {
  return 'https://gitlab.com/search?search=' + encodeURIComponent(String(name || ''))
}

export const linkPattern = /gitlab\.com\/[^\/\s]+\/[^\/\s]+\/-\/issues\/(\d+)/g

/** #231：开仓契约动作——url 型由 UI 以浏览器新窗打开 describe().url。 */
export const openRepository = 'url'

/** #231：client 渲染模板数据（UI-lane 只读）。 */
export const links = {
  issueUrlTemplate: 'https://gitlab.com/{refId}/-/issues/{key}',
  repoUrlTemplate: 'https://gitlab.com/{refId}',
  searchUrlTemplate: 'https://gitlab.com/search?search={q}',
  linkPatternSource: 'gitlab\\.com\\/[^\\/\\s]+\\/[^\\/\\s]+\\/-\\/issues\\/(\\d+)',
}

/**
 * 创建 GitLab 后端适配器（13 ops 完整形状）。
 * @param {Object} ctx BackendContext（platform/fs/exec/timers/log）
 * @returns {import('../../contract.js').Tracker}
 */
export function createGitlabBackend(ctx) {
  const unsupported = (op) => fail(ERROR_KIND.UNSUPPORTED, `gitlab ${op} pending #145 stub`)

  return {
    id: 'gitlab',
    describe: (handle) => describe(handle, 'gitlab'),
    issueUrl: (ref, key) => issueUrl(ref, key),
    preflight: (handle, opCtx) => glabPreflight(handle, opCtx || ctx),
    list: (repo, filter, opCtx) => listIssues(ctx, repo, filter, opCtx || ctx),
    get: (repo, key, opts, opCtx) => getIssue(ctx, repo, key, opts, opCtx || ctx),
    getDependencies: (repo, key, opts, opCtx) => getDependencies(ctx, repo, key, opts, opCtx || ctx),
    create: (repo, input, opCtx) => createIssue(ctx, repo, input, opCtx || ctx),
    close: (repo, key, opts, opCtx) => closeIssue(ctx, repo, key, opts, opCtx || ctx),
    reopen: (repo, key, opCtx) => reopenIssue(ctx, repo, key, opCtx || ctx),
    comment: (repo, key, body, opCtx) => addComment(ctx, repo, key, body, opCtx || ctx),
    update: (repo, key, patch, opCtx) => updateIssue(ctx, repo, key, patch, opCtx || ctx),
    setLabels: (repo, key, labels, opts, opCtx) => setLabels(ctx, repo, key, labels, opts, opCtx || ctx),
    setAssignees: (repo, key, assignees, opts, opCtx) => setAssignees(ctx, repo, key, assignees, opts, opCtx || ctx),
    setParent: (repo, key, parentKey, opts, opCtx) => setParent(ctx, repo, key, parentKey, opts, opCtx || ctx),
    setBlockedBy: (repo, key, blockers, opts, opCtx) => setBlockedBy(ctx, repo, key, blockers, opts, opCtx || ctx),
  }
}

/** 修复契约注入文案（GitLab 后端，双语单源；供 fixes 引用，host 组装时解析）。 */
export const prompts = {
  glabInstallFix: {
    zh: '请为 DSH 安装 GitLab CLI（glab）：\n1. 先检查：终端执行 glab --version；\n2. 无 glab 则按 OS 安装：Windows → winget install --id GitLab.gitlab-cli（或 scoop install glab）；macOS → brew install glab；Linux → 按 gitlab.com/gitlab-org/cli 官方方式安装；\n3. 安装完成后请用户点「重查」。',
    en: 'Install the GitLab CLI (glab) for DSH:\n1. Check first: glab --version;\n2. If missing, install per OS: Windows → winget install --id GitLab.gitlab-cli (or scoop install glab); macOS → brew install glab; Linux → follow gitlab.com/gitlab-org/cli official install;\n3. After install, ask the user to re-check.',
  },
  glabLoginFix: {
    zh: '请完成 glab 登录（glab auth login）：按向导选择 GitLab.com → HTTPS → 浏览器授权（OAuth）；完成后 glab auth status 验证；然后请用户点「重查」。',
    en: 'Complete glab login: glab auth login → GitLab.com → HTTPS → browser OAuth; verify with glab auth status; then ask the user to re-check.',
  },
  glabRepoFix: {
    zh: '当前工作区未解析出 GitLab 仓库（glab 无法定位 owner/project）。请先向用户确认意图：\nA. 本地项目（不需要 GitLab）→ 切换到「本地 Markdown」后端；\nB. 确实要用 GitLab → 核对 remote 指向（git remote get-url origin / glab config），或 glab repo create 创建并关联；\n完成后请用户点「重查」。',
    en: 'No GitLab repository resolved for the current workspace. Confirm intent: A. local project → switch to "Local Markdown"; B. GitLab really wanted → verify the remote (git remote get-url origin / glab config), or create/associate via glab repo create; then ask the user to re-check.',
  },
  subIssue: {
    // 2026-09 修正：旧文案让 agent 执行 setParent(map.key) / list({parentKey})，但宿主侧没有这些 agent tool —— 照做不到。
    //   改成这个后端真的能做的动作：用后端自己的命令行建原生父子边，建完自校验数量。
    //   具体子命令不写死（各版本命令行语法未逐一查证，宁可泛指，避免写进用不上的命令）。
    zh: '用后端自己的命令行把每个子票建成这个 map 的原生子议题（先按本机安装的版本核对命令语法），建完用同一条命令行核对子议题数量与预期一致',
    en: 'use the backend command line to make each sub-ticket a native child of this map; check the exact syntax of the version installed on this machine first, then re-query with the same command line to confirm the child count matches the plan',
  },
  // #595：正文格式契约归后端单源 —— GitLab 写回用后端自己的命令行，正文从文件读入；
  //   具体命令不写死（各版本命令行语法未逐一查证，宁可泛指，避免写进用不上的命令）。
  bodyFormat: {
    zh: '## 正文格式（写/改 issue 正文时必须遵守）\n- [ ] 正文先写成文件（文件里是真实换行：每个 `## 章节` 独占一行、段落间留空行），不要把正文拼进命令行\n- [ ] 写回用当前后端的命令行把整个文件读进去（正文不从命令行参数里传），写完读回来核对一遍\n- [ ] 换行不要写成反斜杠加 n 两个字符',
    en: '## Body format (mandatory when writing/editing an issue body)\n- [ ] Write the body to a file first (real newlines in the file: each `## section` on its own line, a blank line between paragraphs); never inline the body into the command line\n- [ ] Write it back with the current backend\'s own command line, reading the whole body from the file (do not pass the body as a command argument); read the result back to confirm\n- [ ] Never write a newline as the two characters backslash-n.',
  },
}

/** 修复契约（Fix Contract · 2026-08-28）：后端检查失败 → 修复指引；结构见 host/tracker/fixContract.js。 */
export const fixes = Object.freeze({
  'glab:installed': {
    hint: {
      zh: 'glab CLI 未安装。点「安装指引」获取各平台安装命令，完成后重查。',
      en: 'glab CLI is not installed. Use the install guide, then re-check.',
    },
    actions: [
      { type: 'inject-prompt', prompt: 'glabInstallFix', label: { zh: '安装指引', en: 'Install guide' } },
      { type: 'refresh', target: 'chain' },
    ],
  },
  'glab:authed': {
    hint: {
      zh: 'glab 尚未登录。点「登录指引」注入 glab auth login 操作步骤，完成后重查。',
      en: 'glab is not logged in. Use the login guide, then re-check.',
    },
    actions: [
      { type: 'inject-prompt', prompt: 'glabLoginFix', label: { zh: '登录指引', en: 'Login guide' } },
      { type: 'refresh', target: 'chain' },
    ],
  },
  'glab:repoAccess': {
    hint: {
      zh: 'GitLab 仓库不可达（可能未定位仓库 / 无权限 / 网络不通）。点「修复指引」排查，完成后重查。',
      en: 'GitLab repository not reachable (not located / permission / network). Use the fix guide, then re-check.',
    },
    actions: [
      { type: 'inject-prompt', prompt: 'glabRepoFix', label: { zh: '修复指引', en: 'Fix guide' } },
      { type: 'refresh', target: 'chain' },
    ],
  },
})

/** BackendModule（registry可插拔） */
export const gitlabBackend = {
  id: 'gitlab',
  label: 'GitLab',
  // #230（D10 · 键入 locale）：setup 提示词描述数据 —— 只声明 client locale 双语键名，文案不落后端（双语单源）
  setupPrompt: {
    trackerLine: 'setup.gitlab.trackerLine',
    trackerChoice: 'setup.gitlab.trackerChoice',
    backendNote: 'setup.gitlab.backendNote',
    labelReqs: 'setup.gitlab.labelReqs',
  },
  describe,
  issueUrl,
  searchUrl,
  linkPattern,
  links,
  // #191：品牌色完整色板（B 方案定版 · #177）
  presentation: {
    color: '#c25100',
    darkColor: '#ff9a5c',
    bg: 'light-dark(rgba(194,81,0,.12), rgba(255,154,92,.14))',
    border: 'light-dark(rgba(194,81,0,.25), rgba(255,154,92,.30))',
  },
  create: createGitlabBackend,
  matches,
  prompts,
  fixes,
}

export default createGitlabBackend