/**
 * src/tracker/rooms/gitlab/index.ts — GitLab 后端适配器（主缝实现），本文件是这个房间的入口真源。
 *
 * 入口只留三件事：模块对象、工厂与识别（matches / describe）。链接与地址在 room/links.ts，
 * 提示文案在 room/prompts.ts，修复指引在 room/fixes.ts；搬走的名字在下面显式再导出，
 * 房外的 import 路径与名字不变。
 *
 * 定版：#135（labels/milestone分流）+ #144 一页纸（数据归一8文件表 + blocking双路径 + preflight + parentKey归一 + 三底座）
 * 严格对照契约名录（`../../contract/operations-catalog.ts` 的 23 条操作 + 3 条定位口）与实体形状；
 * 按 #113 平台抽象（ctx.platform / ctx.exec / ctx.fs）。
 * 能力诚实：未就绪op由registry Proxy补unsupported桩，此处不再自造布尔capabilities表。
 *
 * 2026-10-14 从 index.js 改名成 index.ts（地图 06 的单房票 #1135，先修后转两次提交里的后一次），
 * 同轮把 13 个手写 .js 一并转成 .ts：只加类型标注不改逻辑，转完行为与转之前一致。
 * 本文件的公开函数形参已按契约类型标注（RepoHandle/RepositoryRef/BackendContext/OpContext），
 * 与房内其余 13 个 .ts 一起在 `node node_modules/typescript/bin/tsc -p src/tracker/tsconfig.json`
 * 下零错误（不要用 `npx tsc`，本仓那是占位壳，不是真编译器）。
 * 包里的 .js 是构建产物（scripts/build.mts 把 src/tracker 下的 .ts 逐个转译进 package/tracker），
 * 不要手改；宿主源码引用本文件时照旧写 './index.js'（开发期由 scripts/ts-hook.mts 指到本文件）。
 */

import type { Tracker } from '../../contract/operations.js'
import type { BackendModule } from '../../contract/backend-module.js'
import type { BackendId } from '../../contract/identity.js'
import type { RepositoryRef } from '../../contract/entities.js'
import type { BackendContext, OpContext, RepoHandle } from '../../contract/contexts.js'
import { glabPreflight } from './preflight.js'
import { emitReadDegraded } from './support/read-log.js'
// #1533：认领只看 `.git/config` 里的远端地址，不扫整份文本（分支名带 gitlab 不再误认领）。
import { remoteUrlsOfGitConfig } from '../../kernel/git-remote.js'
// #1555：声明文件用判定层同一套解析器，只认「声明」不认「正文里提了一句」。
// 旧的整篇 /gitlab/i 扫描会把 GitHub / Local Markdown 的工作区也拉进多命中，详情与评论因此读不到。
import { normalizeTrackerText, parseIssueTracker } from '../../kernel/issue-tracker-declaration.js'
import { listIssues, getIssue } from './issues/read.js'
import { createIssue, closeIssue, reopenIssue, updateIssue } from './issues/write.js'
import { addComment } from './comments/write.js'
import { setLabels } from './labels/assign.js'
import { getDependencies } from './graph/read.js'
import { setBlockedBy } from './graph/write.js'
import { setParent, setAssignees } from './graph/membership.js'
import { getRepoKey, gitlabOriginOf } from './repo/identity.js'
import { counts } from './issues/counts.js'
import { listPage } from './issues/pages.js'
import { listLabels } from './labels/list.js'
import { setLabelColors } from './labels/colors.js'
// 两条单点读搬进 repo/ 子树（#1918）：登录人与仓库权限各占一个 module，各自从请求边界取数。
import { getCurrentUser } from './repo/current-user.js'
import { getRepoPermissions } from './repo/permissions.js'
import { listSubIssues } from './issues/sub-issues.js'
// 开仓发布搬进 project/ 子树（#1919）：它不在 9 个旧路径转发名单里，入口直接按新路径取。
import { initProject } from './project/init-project.js'
// #1605：地图薄查真实现（此前 planned，注册表补桩；今天起走真实现）。
// #1914 起真实现在 issues/maps.ts；入口直接按新路径取，根目录 maps.ts 只留给房外读者做纯转发。
import { listMaps } from './issues/maps.js'
// #1446：读额度读数与「每次 glab 调用记一条请求」的用量信封。
import { readGitlabBudget } from './budget.js'
import { attachGlabOpUsage } from './client.js'
import type { PartiallyProvidedCapability, ProvidedCapability } from '../../contract/capability-answer.js'
// `import type` 取登记数据：转译后不留运行时引用（理由与 GitHub 房那处相同，见 rooms/github/room/backend.ts）。
import type { GITLAB_CAPABILITY_REGISTER } from './support/capability-register.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { GITLAB_FALLBACK_TIMEOUT_MS } from '../../../shared/time-config/src/values.js'
// 链接与地址、提示文案、修复指引都搬进 room/；入口只负责装配与再导出。
import { issueAddress, repoSearchAddress, issueRefPattern, links, DEFAULT_GITLAB_WEB_ORIGIN } from './room/links.js'
import { prompts } from './room/prompts.js'
import { fixes } from './room/fixes.js'

// 房外仍按旧路径从入口 import 这些公开名字：搬进 room/ 之后在这里显式转发，保证 import 路径与名字不变。
// DEFAULT_GITLAB_WEB_ORIGIN 与 refOrigin 本来就不是导出，不在此列；openRepository 也不是导出（见下面的说明）。
export { issueAddress, repoSearchAddress, issueRefPattern, links }
export { fixes }
export { prompts }

// —— GitLab 交出来的成员：26 条能力 + id（23 条操作 + describe/issueAddress/getRepoKey 三条定位口）——
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
 * 依次看四处，任何一处指向 gitlab 就认（#1533：判据是「指向」，不是「文本里出现过这个词」）：
 *   1. `handle.refId` 显式带 gitlab；
 *   2. `.git/config` 里记下的远端地址（只看 `[remote ...]` 段的 `url`，分支名等其它文字不看）；
 *   3. `docs/agents/issue-tracker.md` 里**明写的声明**：与判定层共用 parseIssueTracker，只认
 *      `# Issue tracker: GitLab` 这种高置信标题行；正文里提到 GitLab 不算声明（#1555）；
 *   4. 兜底真问一次 `git remote get-url origin`（best-effort，2 秒）。
 * 四处都不认，或者线索不够，一律回 false —— 「不确定就当不是」是既定口径，不是故障。
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
    // 1) .git/config 里记下的远端地址是否指向 gitlab（只看 [remote ...] 段，#1533）
    const cfg = await readWorkspaceFile(fs, cwd, '.git/config')
    if (cfg === null) emitReadDegraded(ctx, 'matches', 'matches:git-config', Date.now() - startedAt)
    else if (remoteUrlsOfGitConfig(cfg).some((u) => /gitlab/i.test(u))) return true
    // 2) issue-tracker.md 声明的是不是 GitLab：用判定层那套 parseIssueTracker，只认高置信标题行（#1555）。
    //    旧写法在整篇文本里找 /gitlab/i —— 正文里提一句「GitLab 的 MR 不参与分诊」也会被算成 GitLab 工作区；
    //    真机上它与 markdown 同时举手，详情/评论开会话判 multi-match，整批子票读不到。
    //    低置信的正文提及从 #1572 收尾（方案 A）起只留在判定证据里，不产生结论，认领层也不认它。
    const doc = await readWorkspaceFile(fs, cwd, 'docs/agents/issue-tracker.md')
    if (doc === null) emitReadDegraded(ctx, 'matches', 'matches:tracker-doc', Date.now() - startedAt)
    else {
      const parsed = parseIssueTracker(normalizeTrackerText(doc))
      if (parsed && parsed.confidence === 'high' && parsed.explicitBackendId === 'gitlab') return true
    }
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
 * 远端地址的 origin 优先用调用方给的 host，其次用「认仓库时学到的这台实例」，都没有才退回
 * gitlab.com。自托管实例因此拼出的是自己的地址，而不是一律指向官网。
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
  const declaredHost =
    handle && typeof (handle as Partial<RepositoryRef>).host === 'string'
      ? String((handle as Partial<RepositoryRef>).host).trim().replace(/\/+$/, '')
      : ''
  const learnedHost = !declaredHost && cwd ? gitlabOriginOf(cwd) : ''
  const host = declaredHost || learnedHost
  const refId = rawRef
  const name = refId || (cwd ? cwd.split(/[\\/]/).pop() || cwd : backendId) || backendId
  const url = refId && refId.includes('/') ? (host || DEFAULT_GITLAB_WEB_ORIGIN) + '/' + refId : ''
  const ref: RepositoryRef = { backend: backendId, refId: refId || '', name, url }
  // 主机与服务商默认域名相同时不写这一格：回包形状保持不变，下游按键数判读的地方不受影响。
  if (host && host !== DEFAULT_GITLAB_WEB_ORIGIN) ref.host = host
  return ref
}

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

/**
 * 创建 GitLab 后端适配器（今天交 26 条：23 条操作 + 3 条定位口；剩下配色文件那 1 条按设计由注册表补桩）。
 *
 * 返回类型故意不标（理由同 GitHub 房：标成成员全可选的集合就查不出少写，
 * 形状判定收在 `src/tracker/capability-assertions.ts`）：没实现的那些操作由注册表补「我不支持」的桩。
 * 本后端今天的边界是「23 条操作 + describe / issueAddress / getRepoKey 三条定位口」——
 * 唯一没实现的是 `ensureLabelColorsFile`，而且它**不是欠账**：这一条在本后端上形态不成立
 * （颜色真源在远端仓库标签，工作区里那份文件没有读者，改了不算数），登记为「明确不支持」，
 * 理由见 `./support/capability-register.ts` 那一行的注释与 `docs/tracker/capability-gitlab.md`。
 *
 * 地图 10（`#1062`）本轮补的九条在这里各占一行，实现在房内各自的文件：
 * 计数与分页 `./issues/counts.ts`、`./issues/pages.ts`、列标签 `./labels/list.ts` 与批量改色 `./labels/colors.ts`、
 * 当前登录人与仓库写权限 `./repo/current-user.ts` 与 `./repo/permissions.ts`、子票 `./issues/sub-issues.ts`、
 * 开仓发布 `./project/init-project.ts`（#1919）、仓库坐标 `./repo/identity.ts`（旧路径 `./repo.ts` 只剩纯转发，#1918）。
 * 接手的人先读 `./README.md`（这一房与另外两房不一样的地方）。
 */
export function createGitlabBackend(ctx: BackendContext) {
  // 先按形状装配，再在操作表外层统一包一层用量：包的是同一个对象，成员集合与形状断言都不变。
  const backend = {
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
    // 子票这一条读的是票文件头的隐藏标记 `<!-- DSH-PARENT: <地图> -->`（setParent / create 建票时写下）：
    // 它回答的是「挂在这张地图上的票」；人手工加的 relates_to 关联不参与归属判定。详见 ./sub-issues.ts 文件头。
    listSubIssues: (repo, mapKey, opts, opCtx) => listSubIssues(repo, mapKey, opts, opCtx || ctx),
    initProject: (handle, input, opCtx) => initProject(handle, input, opCtx || ctx),
    // #1605 地图薄查：签名 ctx 收在最后一格（与上面地图 10 那几条同列），这里直接透传。
    listMaps: (repo, opCtx) => listMaps(repo, opCtx || ctx),
    // 读额度：GitLab 只按请求计数，读数固定是 requests-only；坏路一律回「读数未知」，不抛。
    readBudget: (opCtx) => readGitlabBudget(opCtx || ctx),
  } satisfies GitlabBackendShape
  return attachGlabOpUsage(backend)
}

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
  // #1557：远程后端的票与容器地址都是网页——开票、开容器都交给浏览器，与开仓库同一个方式。
  openIssue: 'url',
  openContainer: 'url',
  // #191：品牌色完整色板（B 方案定版 · #177）
  presentation: {
    color: '#c25100',
    darkColor: '#ff9a5c',
    bg: 'light-dark(rgba(194,81,0,.12), rgba(255,154,92,.14))',
    border: 'light-dark(rgba(194,81,0,.25), rgba(255,154,92,.30))',
  },
  create: createGitlabBackend,
  matches,
  // 预算口径（规格 1439 起必填）：只计请求——没有点数那一桶，也没有第二桶可言。
  budget: { kind: 'requests-only', countsRequests: true, countsPoints: false, independentBuckets: false },
  prompts,
  fixes,
} satisfies BackendModule

export default createGitlabBackend