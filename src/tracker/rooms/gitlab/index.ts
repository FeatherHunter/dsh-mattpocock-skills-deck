/**
 * src/tracker/rooms/gitlab/index.ts — GitLab 后端适配器（主缝实现），本文件是这个房间的 TypeScript 真源。
 *
 * 定版：#135（labels/milestone分流）+ #144 一页纸（数据归一8文件表 + blocking双路径 + preflight + parentKey归一 + 三底座）
 * 严格对照契约名录（`../../contract/operations-catalog.ts` 的 22 条操作 + 3 条定位口）与实体形状；
 * 按 #113 平台抽象（ctx.platform / ctx.exec / ctx.fs）。
 * 能力诚实：未就绪op由registry Proxy补unsupported桩，此处不再自造布尔capabilities表。
 *
 * 2026-10-14 从 index.js 改名成 index.ts（地图 06 的单房票 #1135，先修后转两次提交里的后一次），
 * 同轮把 13 个手写 .js 一并转成 .ts：只加类型标注不改逻辑，转完行为与转之前一致。
 * 本文件的公开函数形参已按契约类型标注（RepoHandle/RepositoryRef/BackendContext/OpContext），
 * 与房内其余 13 个 .ts 一起在 `node node_modules/typescript/bin/tsc -p src/tracker/tsconfig.json`
 * 下零错误（不要用 `npx tsc`，本仓那是占位壳，不是真编译器）。
 * 包里的 .js 是构建产物（scripts/build.mjs 把 src/tracker 下的 .ts 逐个转译进 package/tracker），
 * 不要手改；宿主源码引用本文件时照旧写 './index.js'（开发期由 scripts/ts-hook.mjs 指到本文件）。
 */

import type { Tracker } from '../../contract/operations.js'
import type { BackendModule } from '../../contract/backend-module.js'
import type { BackendId } from '../../contract/identity.js'
import type { RepositoryRef } from '../../contract/entities.js'
import type { BackendContext, OpContext, RepoHandle } from '../../contract/contexts.js'
import { glabPreflight } from './preflight.js'
import { emitReadDegraded } from './read-log.js'
import { listIssues, getIssue, createIssue, closeIssue, reopenIssue, updateIssue } from './issues.js'
import { addComment } from './comments.js'
import { setLabels } from './labels.js'
import { getDependencies, setBlockedBy, setParent, setAssignees } from './graph.js'
import { getRepoKey } from './repo.js'
import { counts } from './counts.js'
import { listPage } from './pages.js'
import { listLabels, setLabelColors } from './labels-ops.js'
import { getCurrentUser, getRepoPermissions } from './identity-ops.js'
import { listSubIssues } from './sub-issues.js'
import { initProject } from './init-project.js'
import type { PartiallyProvidedCapability, ProvidedCapability } from '../../contract/capability-answer.js'
// `import type` 取登记数据：转译后不留运行时引用（理由与 GitHub 房那处相同，见 rooms/github/backend.ts）。
import type { GITLAB_CAPABILITY_REGISTER } from './capability-register.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { GITLAB_FALLBACK_TIMEOUT_MS } from '../../../shared/time-config/src/values.js'

// —— GitLab 交出来的成员：24 条能力 + id（21 条操作 + describe/issueAddress/getRepoKey 三条定位口）——
// 这份集合不再手写，从本房的登记数据推出来：「明确提供功能」的名字才是实例成员；登记里那 1 条
// 「明确不支持」（ensureLabelColorsFile）因此不会出现在这里（它由注册表按名录补桩）。
// 为什么集合与形状住在房间文件里（而不是判定文件）：判定收在 src/tracker/capability-assertions.ts，
// 而判定必须 import 三个工厂的类型；形状若跟判定同住一处，两边就成了 type-only 的环（#1136 把
// src/tracker 收进门禁扫描域时当场抓到）。方向单向：判定文件 → 房间。
// `PartiallyProvidedCapability`（#1174 加的第四档）今天在本房取出来是空的，仍然一并写上：
// 三个后端推成员集合的口径必须一样，否则哪天本房出现一条「做了但没做到位」，
// 它就会既不进成员集合、也不被断言要求，静默地少一个成员。
export type GitlabBackendMembers = 'id' | (ProvidedCapability<typeof GITLAB_CAPABILITY_REGISTER> | PartiallyProvidedCapability<typeof GITLAB_CAPABILITY_REGISTER>)

/** 交出来的字面量形状：工厂用 `satisfies` 挂它（缺一条、多一条都在编译期红）。 */
export type GitlabBackendShape = { [K in GitlabBackendMembers]: Tracker[K] }

// 入参只取识别要用的两格，是因为 matches 只读工作区目录与仓库标识，拿全量会把无关字段搅进来。
function repoId(handle: RepoHandle | Partial<RepositoryRef> | null | undefined): string {
  if (!handle) return ''
  if (typeof handle.refId === 'string' && handle.refId) return handle.refId
  if (typeof (handle as RepoHandle).cwd === 'string' && (handle as RepoHandle).cwd) {
    return (handle as RepoHandle).cwd as string
  }
  return ''
}

/**
 * 兜底问一次 git remote 的时间上限（毫秒）。
 *
 * 保持 2 秒：这是识别用的启发式探针，前面两道读文件的口子才是正常会给出答案的那两道，
 * 它只在前面都没答案时才跑。仓里同一句 `git remote get-url origin` 在别处写的是 3 秒
 * （GitHub 房的 matches 与两房的 getRepoKey），这里没有跟着改，因为改数值是改行为，
 * 而这张票要的是「数值与注释说的是同一件事」——注释从前写着 5 秒，那才是错的。
 */

/** 识别这一趟要用的文件服务：就用契约上下文里那一格，不另定义形状。 */
type MarkerFs = OpContext['fs']

/**
 * 按文件服务的规矩读一个工作区文件（#1130）。
 *
 * 为什么必须经 `fs.resolve` 再 `fs.readText`：DSH 的文件服务吃的是 `resolve()` 给出的那个
 * target，直接喂一个自己拼出来的路径字符串会抛错 —— 而且抛的不是「文件不在」，是形状不对。
 * 同一个教训记在 `src/host/versionControl.js` 的 stat 那一处：喂路径抛的是 TypeError，不是
 * ENOENT，老写法因此一票否决了。本文件从前的
 * `fs.readText(platform.path.join(cwd, '.git', 'config'))` 正是这个错法：对「文件明明在」
 * 也一律失败，失败又被空 catch 吞掉，外面只看到注册表一句「没认出来」。
 *
 * 读不出来一律回 null，不在这一层记日志：这里分不清「文件本来就不在」（正常，不是故障）
 * 与「读这一下出了问题」（故障），而分档的判据住在 `src/host/fsAbsence.js`，房间引不到它
 * （房间可引目录的登记表里没有它，而且已经到条数上限），就地重写一份又会让同一条契约事实
 * 有两个出处。所以交给调用方按「这一步没给出答案」记一行，不假装知道是哪种。
 *
 * @param fs 沙箱文件服务（调用方已确认它长着 resolve 与 readText 两件）
 * @param cwd 工作区目录
 * @param rel 相对工作区目录的文件路径
 * @returns 读到的文本；读不出来回 null
 */
async function readWorkspaceFile(fs: MarkerFs, cwd: string, rel: string): Promise<string | null> {
  try {
    const target = await fs.resolve(rel, { cwd })
    const text = await fs.readText(target)
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}

/**
 * GitLab matches：启发式 boolean —— 这个工作区是不是 GitLab 仓库。
 *
 * 依次看三处，任何一处写着 gitlab 就认：
 *   1. `.git/config` 里的远端地址；
 *   2. `docs/agents/issue-tracker.md` 里声明的后端；
 *   3. 兜底真问一次 `git remote get-url origin`（best-effort，2 秒）。
 * 三处都不认，或者线索不够，一律回 false —— 「不确定就当不是」是既定口径，不是故障。
 *
 * #1130：这一趟的失败原因必须能从房里报出来（走本房的 `read-log.ts`，事件名沿用全仓登记的
 * `read.degraded`），不能像从前那样被空 catch 吞掉、外面只剩一句「没认出来」。
 * 判据是「哪一层没能给出答案」，不是「哪一层没认出 gitlab」——读到了内容只是里面没写
 * gitlab，那是正常的否定结论，不记；一个规规矩矩的仓库走这一趟一行都不会多出来。
 *
 * @param handle 识别时给的那点线索（只取 refId 与 cwd）
 * @param ctx 单次调用上下文（没有它、或它没有 logEvent 就记不出日志，但结论照旧）
 * @returns 认得出是 GitLab 就 true
 */
async function matches(
  handle: RepoHandle | null | undefined,
  ctx: OpContext | null | undefined,
): Promise<boolean> {
  const startedAt = Date.now()
  try {
    if (!handle || typeof handle !== 'object') return false
    // refId 显式含 gitlab 串 → true
    if (typeof handle.refId === 'string' && /gitlab/i.test(handle.refId)) return true
    const cwd = handle.cwd
    if (!cwd || typeof cwd !== 'string') return false
    const platform = ctx && ctx.platform
    const fs = (ctx && ctx.fs) || (platform && platform.fs)
    // 没有文件服务、或者它没长 resolve+readText 这两件：识别根本跑不起来。这是故障，
    // 不是「这个仓库不是 GitLab」，所以先记一行再回 false。
    const canRead =
      !!fs &&
      typeof (fs as { resolve?: unknown }).resolve === 'function' &&
      typeof (fs as { readText?: unknown }).readText === 'function'
    if (!canRead) {
      emitReadDegraded(ctx, 'matches', 'matches:fs-unavailable', Date.now() - startedAt)
      return false
    }
    // 1) .git/config 是否含 gitlab
    const cfg = await readWorkspaceFile(fs, cwd, '.git/config')
    if (cfg === null) emitReadDegraded(ctx, 'matches', 'matches:git-config', Date.now() - startedAt)
    else if (/gitlab/i.test(cfg)) return true
    // 2) issue-tracker.md 是否声明 gitlab
    const doc = await readWorkspaceFile(fs, cwd, 'docs/agents/issue-tracker.md')
    if (doc === null) emitReadDegraded(ctx, 'matches', 'matches:tracker-doc', Date.now() - startedAt)
    else if (/gitlab/i.test(doc)) return true
    // 3) exec git remote 兜底（best-effort，2s）
    const exec = ctx && ctx.exec
    if (exec) {
      const res = await exec('git', ['remote', 'get-url', 'origin'], {
        cwd,
        timeout: GITLAB_FALLBACK_TIMEOUT_MS,
      })
      const out = (res.stdout || '') + (res.stderr || '')
      if (/gitlab/i.test(out)) return true
    }
    return false
  } catch {
    // 整段抛了（例如 exec 抛、平台对象形状怪）：这是故障，记一行；结论照旧按「不确定 = 不是」。
    emitReadDegraded(ctx, 'matches', 'matches:unknown', Date.now() - startedAt)
    return false
  }
}

/**
 * 产出仓库身份：refId 优先用传入的标识，缺了才拿目录名顶上，远端地址按 GitLab 规则拼。
 *
 * @param handle 识别时给的那点线索（只取 refId 与 cwd）
 * @param backendId 后端 id（调用方透传 'gitlab'）
 */
export function describe(
  handle: RepoHandle | Partial<RepositoryRef> | null | undefined,
  backendId: BackendId,
): RepositoryRef {
  const rawRef = handle && typeof handle.refId === 'string' && handle.refId ? String(handle.refId).trim() : ''
  // cwd 只在 RepoHandle 那一形上有，RepositoryRef 那一形没有，这里按存在判读而不是按类型硬取。
  const maybeCwd = (handle as RepoHandle | null | undefined)?.cwd
  const cwd = typeof maybeCwd === 'string' ? String(maybeCwd) : ''
  let refId = rawRef
  const name = refId || (cwd ? cwd.split(/[\\/]/).pop() || cwd : backendId) || backendId
  const url = refId && refId.includes('/') ? 'https://gitlab.com/' + refId : ''
  return { backend: backendId, refId: refId || '', name, url }
}

// 链接三件（#1110 实现决定第 14 条 / #1135 改名 / #1141 删旧名）：名字讲的是「地址」而不是「网址」，
// 因为本地 Markdown 后端给的是票文件的绝对路径；网址口吻的旧名字已按 #1141 删净。
// 票地址只认 refId，是因为 GitLab 的票链完全由仓库标识决定，拿不到就如实给空串不猜。
export function issueAddress(ref: Partial<RepositoryRef> | null | undefined, key: string | number): string {
  const refId = ref && typeof ref.refId === 'string' ? ref.refId : ''
  if (!refId) return ''
  return 'https://gitlab.com/' + refId + '/-/issues/' + String(key)
}

// 按名搜仓库的地址只做编码拼串，是因为全站搜索页不需要鉴权，拼不出就等调用方自己处理空串。
export function repoSearchAddress(name: string | null | undefined): string {
  return 'https://gitlab.com/search?search=' + encodeURIComponent(String(name || ''))
}

export const issueRefPattern = /gitlab\.com\/[^\/\s]+\/[^\/\s]+\/-\/issues\/(\d+)/g

/**
 * #231：开仓契约动作——url 型由 UI 以浏览器新窗打开 describe().url。
 *
 * 为什么这里**不写 export**（#1139 收口那天改的）：界面拿到的那份数据来自模块对象（下面的
 * gitlabBackend），不是这个文件的命名空间；本文件里读它的只有同一份模块对象，房外零读者。
 * 留一个 `export` 在这里，下一个人就会以为「文件级导出已经声明过了，够了」——#620 的 GitHub
 * 与 #1117 的 GitLab 都是这么漏掉的（当时两边的门禁快照只认模块对象上的键，看不到文件级导出）。
 * 所以要加声明就往模块对象上加，别在这里开口子。
 */
const openRepository = 'url'

/** #231：client 渲染模板数据（UI-lane 只读）。 */
export const links = {
  issueUrlTemplate: 'https://gitlab.com/{refId}/-/issues/{key}',
  repoUrlTemplate: 'https://gitlab.com/{refId}',
  searchUrlTemplate: 'https://gitlab.com/search?search={q}',
  linkPatternSource: 'gitlab\\.com\\/[^\\/\\s]+\\/[^\\/\\s]+\\/-\\/issues\\/(\\d+)',
}

/**
 * 创建 GitLab 后端适配器（今天交 24 条：21 条操作 + 3 条定位口；剩下 1 条由注册表补桩）。
 *
 * 返回类型故意不标（理由同 GitHub 房：标成成员全可选的集合就查不出少写，
 * 形状判定收在 `src/tracker/capability-assertions.ts`）：没实现的那些操作由注册表补「我不支持」的桩。
 * 本后端今天的边界是「21 条操作 + describe / issueAddress / getRepoKey 三条定位口」——
 * 唯一没实现的是 `ensureLabelColorsFile`，而且它**不是欠账**：这一条在本后端上形态不成立
 * （颜色真源在远端仓库标签，工作区里那份文件没有读者，改了不算数），登记为「明确不支持」，
 * 理由见 `./capability-register.ts` 那一行的注释与 `docs/tracker/capability-gitlab.md`。
 *
 * 地图 10（`#1062`）本轮补的九条在这里各占一行，实现在房内各自的文件：
 * 计数 `./counts.ts`、分页 `./pages.ts`、列标签与批量改色 `./labels-ops.ts`、
 * 当前登录人与仓库写权限 `./identity-ops.ts`、子票 `./sub-issues.ts`、开仓发布 `./init-project.ts`、
 * 仓库坐标 `./repo.ts`。接手的人先读 `./README.md`（这一房与另外两房不一样的地方）。
 */
export function createGitlabBackend(ctx: BackendContext) {
  return {
    id: 'gitlab',
    describe: (handle) => describe(handle, 'gitlab'),
    issueAddress: (ref, key) => issueAddress(ref, key),
    getRepoKey: (cwd, opCtx) => getRepoKey(cwd, opCtx || ctx),
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
    // —— 地图 10（#1062）本轮补的九条 ——
    // 这几条的实现在房内自己的文件里，签名是「ctx 收在最后一格」（与上面那十几条「ctx 在头一格」不同），
    // 所以这里直接透传，不再往前面塞 ctx。
    counts: (repo, filter, opCtx) => counts(repo, filter, opCtx || ctx),
    listPage: (repo, filter, opts, opCtx) => listPage(repo, filter, opts, opCtx || ctx),
    listLabels: (repo, opCtx) => listLabels(repo, opCtx || ctx),
    setLabelColors: (repo, changes, opCtx) => setLabelColors(repo, changes, opCtx || ctx),
    getCurrentUser: (repo, opCtx) => getCurrentUser(repo, opCtx || ctx),
    getRepoPermissions: (repo, opCtx) => getRepoPermissions(repo, opCtx || ctx),
    // 子票这一条读的是票正文顶部的 `Part of #<地图>` 声明行（setParent / create 建票时写下）：
    // 它回答的是「挂在这张地图上的票」；人手工加的 relates_to 关联不参与归属判定。详见 ./sub-issues.ts 文件头。
    listSubIssues: (repo, mapKey, opts, opCtx) => listSubIssues(repo, mapKey, opts, opCtx || ctx),
    initProject: (handle, input, opCtx) => initProject(handle, input, opCtx || ctx),
  } satisfies GitlabBackendShape
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
    //   ② 原先这段写「建原生父子边」，与本后端的实现不符 —— setParent 落下去的是票正文顶部的
    //      `Part of #<地图>` 声明行（见 graph-membership.ts），不是原生父子边。以契约为准，文案同步改正。
    // #1176 之后补正（2026-10-15，来自对抗式审查）：原先这里写「GitLab 上没有原生父子关系」，这句是错的
    //   —— 平台有原生的父子层级（官方有整页在讲「Child items」，免费档就有），只是它在 work items 那条路上，
    //   入口是界面与 GraphQL；本房取数一律走 glab api 的 REST issue links，而那个接口的 link_type 只有
    //   relates_to / blocks / is_blocked_by 三种，没有表示层级的那一种。所以准确的说法是「本房这条 REST 路
    //   拿不到层级边」，不是「GitLab 做不到」。差别要留住：读的人据此才能判断要不要另开一票走 GraphQL。
    zh: '建边用 deck_map_link：父子边传 parentKey、阻塞边传 blockedBy。要注意本后端的能力边界 —— 父子边不走接口，落在票正文顶部的 Part of #<地图> 声明行（读回走契约的父子列）。GitLab 平台本身有原生父子层级，但它在 work items 那条路上（入口是界面与 GraphQL），本房不走那条；要远端认的层级得另开一票换成 GraphQL。阻塞边走原生 is_blocked_by：有能力就真写、写后读回核对；免费档拿不到原生能力时，工具回落到正文首行的那行降级写法。建完用 deck_map_snapshot 读回地图，核对子票张数与预期一致。',
    en: 'Wire edges with deck_map_link: parentKey for the parent-child edge, blockedBy for blocking edges. Mind this backend\'s limit — the parent-child edge does not go through the API; it lands as a Part of #<map> declaration line at the top of the ticket body (read back through the contract parent column). GitLab itself does have a native parent-child hierarchy, but it lives on the work-items path (reached through the UI and GraphQL), which this backend does not use; a remotely-recognised hierarchy would be a new capability on GraphQL. Blocking edges use native is_blocked_by: written for real with read-back verification when capable; on the free tier without native capability the tool falls back to the first line of the body. Then read the map back with deck_map_snapshot and confirm the child count matches the plan.',
  },
  // #595：正文格式契约归后端单源 —— GitLab 写回用后端自己的命令行，正文从文件读入；
  // #684：「体检」的 GitLab 科目。票仓结构与 GitHub 是同一套（地图 + 子议题 + 阻塞边），所以口径照搬；
  //   唯一的实话是父子边落在票正文的 `Part of #<地图>` 声明行、解析率还没用真仓库量过 —— 写进文案让人先量再下结论，不硬来。
  // #716：查数与建边改为走工具（deck_context / deck_map_snapshot / deck_map_link），这里一条裸命令都不留。
  // 收口（2026-09-24）：英文那句的结尾原来多挂了一个 {subject}。那个占位符就是总纲用来填「本后端这一份科目」
  //   的位置，也就是这条文本自己 —— 自己引用自己的结果是：总纲补第二遍时把整段文本又抄了一份，
  //   并且这个占位符本身原样漏进了会话（tests/verify-686-accept.js 的「无多余占位符漏进会话」当场红）。
  //   中文那句没有这个东西，两边的意思本来就一样，删掉。
  healthCheck: {
    zh: '**游离的开放票**在这条后端上的落地口径：这张票**没有关闭**、**自己不是地图**、**不在任何地图的子票里** —— 与另一条远端后端同一套（两个后端的票仓结构本来就是同一套：地图 + 子议题 + 阻塞边）。\n\n**动手时只做两件结构动作**，都走工具：\n1. 建边，把票挂到合适的地图下：deck_map_link 的 parentKey；\n2. 为人点过头的票开一张新地图：deck_map_plan_create 先写最小的 Destination 草稿。\n\n**本后端做不到的地方，如实写出来**：父子边落在票正文顶部的 Part of #<地图> 声明行（原生层级在 work items 那条路上，本房不走），解析率也还没用真仓库量过 —— 动手之前先量一次，量与不出来的原因都写进报告，**不要硬来**。\n\n**不碰**：已关闭的票、任何票的标题与正文、标签与认领状态、别的仓库；不关票、不删评论、不改源码、不发版、不提交。\n\n报告按标签与建议类型分区，但体检的范围是全部开放票、不跟随面板当前的筛选。',
    en: '**How "orphaned open ticket" lands on this backend**: the ticket is **not closed**, it is **not itself a map**, and it is **not inside any map as a sub-ticket** — the same rules as the other remote backend (both backends share one ticket-store shape: maps + sub-tickets + blocking edges).\n\n**When acting, only two structural actions**, both through the tools:\n1. Wire the edge that attaches the ticket under a suitable map: deck_map_link with parentKey;\n2. Open a new map for a ticket the human has nodded on: deck_map_plan_create, writing only the minimal Destination draft.\n\n**State plainly what this backend cannot do**: the parent-child edge lands as a Part of #<map> declaration line at the top of the ticket body (the native hierarchy lives on the work-items path, which this backend does not use); its resolution rate has not been measured against a real repository yet — measure once before acting, write both the measurement and any reason it fails into the report, and **do not force it**.\n\n**Never touch**: closed tickets, any ticket title or body, labels and claim state, other repositories; do not close tickets, delete comments, change source code, publish a release, or commit.',
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
  // 链接三件（#1110 实现决定第 14 条 / #1135 改名 / #1141 删旧名）：票的地址 issueAddress、
  // 认票的写法 issueRefPattern、按名搜仓库 repoSearchAddress。名字与后端无关，因为本地 Markdown
  // 后端给的是票文件的绝对路径，网址口吻的名字会让人以为这几个能力只有远端后端才有。
  // 旧名字（网址口吻的那三个）作为同义别名留过一轮，客户端与宿主都不再读之后已删净。
  issueAddress,
  issueRefPattern,
  repoSearchAddress,
  links,
  // 开仓方式（#231 的开仓契约动作）：'url' = 界面用浏览器新窗打开 describe().url。
  // 2026-10-14 补（#1117）：这个值原来只以文件级导出（本文件上面的 const openRepository）的形式
  //   存在，没有挂进模块对象。宿主把模块对象变成「发给界面的那份数据」时只挑模块对象上的字段
  //   （那段挑选今天收在 src/tracker/ui-description.ts 一处，见 #1139），文件级导出到不了界面：
  //   按「后端自己声明的开仓动作」分套的那处（src/client/views/labels/labelColorErrors.js 的
  //   lcCopyPlanOf）于是把 GitLab 归到「没读到开仓动作」那一套。这跟 #620 给 GitHub 修掉的是同一处
  //   形状，所以这里挂上同一个值；契约里这个成员本来就是可选的。
  openRepository,
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
} satisfies BackendModule

export default createGitlabBackend