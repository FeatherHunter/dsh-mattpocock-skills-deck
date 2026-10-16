/**
 * src/tracker/rooms/github/backend.ts — GitHub 后端装配（githubMatches / createGithubBackend）。
 *
 * 由 #440 从 index.js 纯结构移出，行为零变化。
 * 以后改后端装配的人改它。预估约 115 行。
 */

import type { Tracker } from '../../contract/operations.js'
import type { OpContext, RepoHandle } from '../../contract/contexts.js';
import type { Actor } from '../../contract/identity.js';
import type { OpResult } from '../../contract/results.js';
import type { RepositoryRef } from '../../contract/entities.js';
import { ERROR_KIND } from '../../contract/vocabulary.js'
import { fail } from '../../kernel/preflight.js'
import { ghClient, rememberOutbound } from './client.js'
import type { OutboundControl } from '../../contract/outbound.js'
import { ghPreflight } from './preflight.js'
import { listIssues, getIssue } from './issues.js'
import { countIssues } from './counts.js'
import { listIssuesPage } from './page.js'
import { listSubIssues } from './sub-issues.js'
import { createIssue, closeIssue, reopenIssue, updateIssue, setAssignees } from './issues-write.js'
import { addComment } from './comments.js'
import { setLabels } from './labels.js'
import { readRepoPermissions } from './repo-permissions.js'
import { listLabels, setLabelColors } from './label-colors-ops.js'
import { setParent, getDependencies, setBlockedBy } from './graph.js'
import { initProject } from './init-project.js'
import { describe, issueAddress, getRepoKey } from './repo.js'
import type { PartiallyProvidedCapability, ProvidedCapability } from '../../contract/capability-answer.js'
// 上面那行与下面这行都用 `import type` 取登记数据：转译后不留任何运行时引用，
// 发布出去的包里根本不会加载这份登记 —— 「运行时不读它」这条 G5 纪律因此是机械成立的，不靠自觉。
import type { GITHUB_CAPABILITY_REGISTER } from './capability-register.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { GIT_PROBE_TIMEOUT_MS } from '../../../shared/time-config/values.js'

// —— GitHub 交出来的成员：24 条能力 + id ——
// 这份集合不再手写：它从本房的登记数据（./capability-register.ts）推出来 —— 「明确提供功能」的那些
// 名字，就是这个实例上应当出现的成员。登记里把一条改成「不支持」，这里少一格，工厂还留着就编译红；
// 登记里加一条「提供」，这里多一格，工厂没实现也编译红。成员集合与分类的唯一真源因此是登记数据，
// 不再有「改了实现忘了改登记」这回事。
// 为什么集合与形状住在房间文件里（而不是判定文件）：判定收在 src/tracker/capability-assertions.ts，
// 而判定必须 import 三个工厂的类型；形状若跟判定同住一处，两边就成了 type-only 的环（#1136 把
// src/tracker 收进门禁扫描域时当场抓到）。方向单向：判定文件 → 房间。
// 集合里带 `id`：它是身份不是能力（名录里没有它），但实例上三个后端人人都有，形状里必须给它留位置。
// `PartiallyProvidedCapability`（#1174 加的第四档）今天在本房取出来是空的，仍然一并写上：
// 三个后端推成员集合的口径必须一样，否则哪天本房出现一条「做了但没做到位」，
// 它就会既不进成员集合、也不被断言要求，静默地少一个成员。
export type GithubBackendMembers = 'id' | (ProvidedCapability<typeof GITHUB_CAPABILITY_REGISTER> | PartiallyProvidedCapability<typeof GITHUB_CAPABILITY_REGISTER>)

/** 交出来的字面量形状：工厂用 `satisfies` 挂它（缺一条、多一条都在编译期红）。 */
export type GithubBackendShape = { [K in GithubBackendMembers]: Tracker[K] }

/**
 * Registry 身份：matches(handle, ctx) → boolean
 * 启发式：handle.refId 含 '/' → 视为 github（显式绑定）；否则检查 cwd 下 .git/config 是否含 github.com
 * 不抛错；不确定一律 false + diagnostics 由 registry 调用方日志（此处只返回 boolean）
 */
// 为什么标成操作上下文而不是后端上下文：本函数读 ctx.cwd（工作区目录），而后端上下文里没有这一格（它是操作上下文加的）；
// 标窄是如实记录，调用方传的一直是完整上下文，运行时不变。
export async function githubMatches(handle: RepoHandle, ctx: OpContext): Promise<boolean> {
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
        const r = await ctx.exec('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { cwd, timeout: GIT_PROBE_TIMEOUT_MS })
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
 * @param {import('../../contract/index.js').BackendContext} ctx DSH host ctx（platform 已解析实例注入，#113）
 *
 * 返回类型故意不标：标成 `RoomOperations`（成员全可选）就查不出少写。
 * 形状的判定收在 `src/tracker/capability-assertions.ts` 三条断言里（少写、名录漂移、多带都由它拦）。
 * 本后端没实现的那几条由注册表补「我不支持」的桩，这是合规的常态。
 */
export function createGithubBackend(ctx: OpContext) {
  // #1159：装配那一刻把宿主交来的出站能力（名额闸 / 取消判定 / 搭车账本）记进本房。
  // 为什么在装配点记一次而不是每次操作都传：宿主给「这一次操作」造上下文的地方有十几处，
  // 逐处挂一遍既啰嗦又容易漏；这三样本事本身就是进程级单例，装配时交一次、全房共用即可。
  // 当次操作的上下文里若也带着一份（门禁夹具常这么给），房内以当次那一份为准。
  rememberOutbound((ctx as unknown as { outbound?: OutboundControl } | null)?.outbound)
  // 可选：预解析 ghPath 无副作用，此处不做
  void ghClient(ctx)
  return {
    id: 'github',
    preflight: (handle, opCtx) => ghPreflight(handle, opCtx || ctx),
    list: (repo, filter, opCtx) => listIssues(repo, filter, opCtx || ctx),
    // #689：后端计数（一次 GraphQL 的 totalCount，只数工单）。语义见 contract.js 的「计数契约」。
    counts: (repo, filter, opCtx) => countIssues(repo, filter, opCtx || ctx),
    // #690：按页取票（创建时间倒序 + 薄片段 + 游标 + 总数）。语义见 tracker/contract-page.js 的「分页契约」。
    listPage: (repo, filter, opts, opCtx) => listIssuesPage(repo, filter, opts, opCtx || ctx),
    // #691：一张地图的全部子票（翻页拉到底 + totalCount 核对 + 1000 张硬上限）。
    //   2026-10-14 起它是契约操作（`Tracker.listSubIssues`）：原先按「读路径的实现细节」豁免在外，
    //   但它的调用者是宿主电话 wf.mapTickets —— 房外有读者，它就不是某家的细节。
    listSubIssues: (repo, mapKey, opts, opCtx) => listSubIssues(repo, mapKey, opts, opCtx || ctx),
    get: (repo, key, opts, opCtx) => getIssue(repo, key, opts, opCtx || ctx),
    getDependencies: (repo, key, opts, opCtx) => getDependencies(repo, key, opts, opCtx || ctx),
    create: (repo, input, opCtx) => createIssue(repo, input, opCtx || ctx),
    close: (repo, key, opts, opCtx) => closeIssue(repo, key, opts, opCtx || ctx),
    reopen: (repo, key, opCtx) => reopenIssue(repo, key, opCtx || ctx),
    comment: (repo, key, body, opCtx) => addComment(repo, key, body, opCtx || ctx),
    update: (repo, key, patch, opCtx) => updateIssue(repo, key, patch, opCtx || ctx),
    setLabels: (repo, key, labels, opts, opCtx) => setLabels(repo, key, labels, opts, opCtx || ctx),
    // #620：仓库级的两条标签配色操作（列全部标签 / 批量改颜色），实现见 label-colors-ops.js
    listLabels: (repo, opCtx) => listLabels(repo, opCtx || ctx),
    setLabelColors: (repo, changes, opCtx) => setLabelColors(repo, changes, opCtx || ctx),
    setAssignees: (repo, key, assignees, opts, opCtx) => setAssignees(repo, key, assignees, opts, opCtx || ctx),
    setParent: (repo, key, parentKey, opts, opCtx) => setParent(repo, key, parentKey, opts, opCtx || ctx),
    setBlockedBy: (repo, key, blockers, opts, opCtx) => setBlockedBy(repo, key, blockers, opts, opCtx || ctx),
    getCurrentUser: async (repo, opCtx) => {
      const c = ghClient(opCtx || ctx)
      const r = await c.execGh(['api', 'user', '--jq', '{login: .login, name: .name, avatarUrl: .avatar_url}'], { cwd: (opCtx && opCtx.cwd) || (ctx && ctx.cwd) })
      if (!r.ok) {
        const kind = (r.error && r.error.kind) || ERROR_KIND.UNSUPPORTED
        // 未登录或无权限 → 返回 unsupported，UI 将不做“本人不显”过滤（全显）；原文交 gh 那一份失败。
        if (kind === ERROR_KIND.AUTH || kind === ERROR_KIND.UNSUPPORTED) return fail(ERROR_KIND.UNSUPPORTED, (r.error && r.error.message) || 'viewer unsupported', r.error)
        return { ok: false, error: r.error }
      }
      try {
        // text 兜底保留：执行层上游仍有 text 这一格（client 房自己还在读 result.text），
        // stdout 非串时老代码走 text；类型上没有这一格，用视图读，取值与原来一字不差。
        const j = JSON.parse(String(r.data.stdout || (r.data as { text?: unknown }).text || '{}'))
        const login = String(j.login || '').trim()
        // 说「viewer 的登录名是空的」时，原文就是这次 gh 回来的那份数据（人自己看得出缺了什么）。
        if (!login) return fail(ERROR_KIND.UNSUPPORTED, 'viewer login empty', r.data)
        // 为什么先定死契约再补可选键：字面量起手类型里没有 name/avatarUrl/kind，后面再补会报缺成员；先标成认领形状，可选键自然有位置。
        const actor: Actor = { login }
        if (j.name) actor.name = String(j.name)
        if (j.avatarUrl) actor.avatarUrl = String(j.avatarUrl)
        else if (j.avatar_url) actor.avatarUrl = String(j.avatar_url)
        actor.kind = 'user'
        return { ok: true, data: actor }
      } catch (e) {
        const eb = (e && typeof e === 'object' ? e : null) as { message?: unknown } | null;
        return fail(ERROR_KIND.PARSE, String((eb && eb.message) || e), r.data)
      }
    },
    // 为什么断言一下：开仓失败的档位是它自己的结果词（bad-name/no-git 这类，不在八档内），与 OpResult 的失败形状只差 kind 一格；
    // 断言只为过编译，成功带仓、失败带三段式的原值都原样交出去，运行时不变。
    initProject: (handle, input, opCtx) => initProject(handle, input, opCtx || ctx) as unknown as Promise<OpResult<RepositoryRef>>,
    describe: (handle, opCtx) => describe(handle, 'github'),
    issueAddress: (ref, key) => issueAddress(ref, key),
    // 调用方没有仓库标识时的补全口（#758）：注册表出空 refId 是常态（匹配源不带标识），
    // 有该能力的后端把三层兜底（git remote → 配置 → gh 视图）开给调用方自己补；
    // 没有该能力的后端没有这一格，调用方跳过，原样诚实失败。只读，无副作用。
    getRepoKey: (cwd, opCtx) => getRepoKey(cwd, opCtx || ctx),
    // #992：仓库写权限（只回答「当前账号在这个仓库上有没有 push / triage」）。
    //   2026-10-14 起它是契约操作（`Tracker.getRepoPermissions`）：deck_context 的能力位与失败归因
    //   两边都要用它，所以它不再是「GitHub 独有的旁路」。
    //   问不出来（网络、仓库不存在）如实回 ok:false，调用方按「未知」处理，不捏造。
    getRepoPermissions: async (repo, opCtx) => {
      const c = ghClient(opCtx || ctx)
      const refId = repo && typeof repo.refId === 'string' ? repo.refId.trim() : ''
      const idx = refId.indexOf('/')
      // 说「refId 缺了」时，手里那个 refId（空串）就是原文；下面是权限问不出来，
      // 这一条没有上游原文可交（readRepoPermissions 只回 null，原因在它自己的日志里），留空串表示如实没有。
      if (idx <= 0) return fail(ERROR_KIND.NOTFOUND, 'getRepoPermissions: repo.refId missing', refId)
      const perms = await readRepoPermissions(c, refId, opCtx || ctx)
      if (!perms) return fail(ERROR_KIND.NETWORK, 'getRepoPermissions: 仓库权限问不出来（网络或仓库不可达），按未知处理', '')
      return { ok: true, data: perms }
    },
  } satisfies GithubBackendShape
}
