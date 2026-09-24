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
  // #716：这个后端自己的命令行名与站点名（提示词模板里的 {cli} / {cliBrand} 由这一格填）。
  commandVocabulary: { cli: 'glab', cliBrand: 'GitLab' },
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
    //   改成这个后端真的能做的动作：在 map 文件的任务清单里引用子票。
    // #716 两处改正：
    //   ① 建边与校验已经搬进契约层的 deck_map_link / deck_map_snapshot，所以这里只讲用哪个工具，不留裸命令；
    //   ② 原先这段写「建原生父子边」，与本后端的实现不符 —— setParent 落下去的是 relates_to 平级链接
    //      （见 graph-membership.js），不是原生父子边。以契约为准，文案同步改正：GitLab 上这条边只会落成
    //      一条平级链接，工具会如实回报它落在那一列，不要把它说成父子关系。
    zh: '建边用 deck_map_link：父子边传 parentKey、阻塞边传 blockedBy。要注意本后端的能力边界 —— GitLab 上没有原生父子关系，parentKey 落下去是一条 relates_to 平级链接（工具会如实回报它落在哪一列，不要把平级链接说成父子关系）；阻塞边在免费档往往也拿不到原生能力，工具会回落到正文首行的那行降级写法。建完用 deck_map_snapshot 读回地图，核对子票张数与预期一致。',
    en: 'Wire edges with deck_map_link: parentKey for the parent-child edge, blockedBy for blocking edges. Mind this backend\'s limit — GitLab has no native parent-child relation, so parentKey lands as a relates_to sibling link (the tool reports which column it landed in; do not describe a sibling link as a parent-child relation); on the free tier blocking edges usually have no native capability either and the tool falls back to the first line of the body. Then read the map back with deck_map_snapshot and confirm the child count matches the plan.',
  },
  // #595：正文格式契约归后端单源 —— GitLab 写回用后端自己的命令行，正文从文件读入；
  // #684：「体检」的 GitLab 科目。票仓结构与 GitHub 是同一套（地图 + 子议题 + 阻塞边），所以口径照搬；
  //   唯一的实话是父子边在 GitLab 上落成 relates_to 平级链接、解析率还没用真仓库量过 —— 写进文案让人先量再下结论，不硬来。
  // #716：查数与建边改为走工具（deck_context / deck_map_snapshot / deck_map_link），这里一条裸命令都不留。
  // 收口（2026-09-24）：英文那句的结尾原来多挂了一个 {subject}。那个占位符就是总纲用来填「本后端这一份科目」
  //   的位置，也就是这条文本自己 —— 自己引用自己的结果是：总纲补第二遍时把整段文本又抄了一份，
  //   并且这个占位符本身原样漏进了会话（tests/verify-686-accept.js 的「无多余占位符漏进会话」当场红）。
  //   中文那句没有这个东西，两边的意思本来就一样，删掉。
  healthCheck: {
    zh: '**游离的开放票**在这条后端上的落地口径：这张票**没有关闭**、**自己不是地图**、**不在任何地图的子票里** —— 与另一条远端后端同一套（两个后端的票仓结构本来就是同一套：地图 + 子议题 + 阻塞边）。\n\n**动手时只做两件结构动作**，都走工具：\n1. 建边，把票挂到合适的地图下：deck_map_link 的 parentKey；\n2. 为人点过头的票开一张新地图：deck_map_plan_create 先写最小的 Destination 草稿。\n\n**本后端今天做不到的地方，如实写出来**：GitLab 上没有原生父子关系，parentKey 落下去是一条 relates_to 平级链接，解析率也还没用真仓库量过 —— 动手之前先量一次，量与不出来的原因都写进报告，**不要硬来**。\n\n**不碰**：已关闭的票、任何票的标题与正文、标签与认领状态、别的仓库；不关票、不删评论、不改源码、不发版、不提交。\n\n报告按标签与建议类型分区，但体检的范围是全部开放票、不跟随面板当前的筛选。',
    en: '**How "orphaned open ticket" lands on this backend**: the ticket is **not closed**, it is **not itself a map**, and it is **not inside any map as a sub-ticket** — the same rules as the other remote backend (both backends share one ticket-store shape: maps + sub-tickets + blocking edges).\n\n**When acting, only two structural actions**, both through the tools:\n1. Wire the edge that attaches the ticket under a suitable map: deck_map_link with parentKey;\n2. Open a new map for a ticket the human has nodded on: deck_map_plan_create, writing only the minimal Destination draft.\n\n**State plainly what this backend cannot do today**: GitLab has no native parent-child relation, so parentKey lands as a relates_to sibling link, and its resolution rate has not been measured against a real repository yet — measure once before acting, write both the measurement and any reason it fails into the report, and **do not force it**.\n\n**Never touch**: closed tickets, any ticket title or body, labels and claim state, other repositories; do not close tickets, delete comments, change source code, publish a release, or commit.',
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