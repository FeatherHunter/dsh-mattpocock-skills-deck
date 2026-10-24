// src/refresh/rooms/host/issue-detail-fetch.ts —— 单票详情取数（H2 #446 从 host/index.js 546–840 搬出）。
// 2026-10-14（#1161）从 .js 转成 .ts。
// #1444（规格 1439 的 A2 第一批）：这一条从「宿主自己发 GraphQL、失败切 REST」改成
//   「一趟只读会话里 get 一次 + getDependencies 一次」。为什么不再留 REST 兜底：
//   GraphQL→REST 的降级已经在 GitHub 房间内部做（list/get 都有 REST 通路），宿主再留一份
//   就是第二条真源：两条路的字段归一迟早对不上。404 之后去试 /pulls 也一样——房间的 get
//   本来就先查工单、再查拉取请求。
//
// 对外形状不变（面板与快照只认这个形状）：
//   { ok:true, issue } 或 { ok:false, error:{ kind, message } }。
//   issue 仍然是 GraphQL 那一套字段（comments/subIssues/blockedBy/blocking 都是 {nodes}），
//   不把契约的数组形状直接抛给界面；界面虽然两种都兼容，但这里只保留一种，免得字段抖动。
//
// 失败时保留旧行为：开会话失败、get 失败都回 { ok:false, error }，不抛；getDependencies
//   失败只让阻塞边退成 get 里带回来的那一份（旧 REST 路也是子请求失败就置空、详情照常显示）。
import type { OpContext } from '../../../tracker/contract/contexts.js'
import type { Issue, RepositoryRef } from '../../../tracker/contract/entities.js'
import type { TrackerSession } from '../../../tracker/session/open-tracker.js'

interface RepoKey { owner: string; name: string }

/** 接线处注入的依赖。用不到的几项照 H2 #446 搬出时的形状保留，免得接线被改窄。 */
interface Deps {
  /** 拿只读会话的装配口（宿主接线注入；没接线时如实失败，不退回直调 gh）。 */
  openSession?: any
  getRepoKey(cwd: string): RepoKey | null | Promise<RepoKey | null>
  isRateLimitError?: unknown
  execProc?: unknown
  getTrackerRegistry?: unknown
  getPlatform?: unknown
  getDetectionService?: unknown
  getRepoRoot?: unknown
  ctx?: unknown
  timer?: unknown
  getGhPath?: unknown
  getGhLastError?: unknown
}

/** 详情失败：kind 是判档（env/parse/notFound/network…），message 是给人看的原话。 */
function fail(kind: string, message: string): any {
  return { ok: false, error: { kind: kind, message: message } }
}

/** 会话失败或异常统一收成 env：这一条路的失败形状与旧路一致，上层照旧降级回缓存。 */
function sessionFail(reason: string, detail?: any): any {
  const tail = detail == null || detail === '' ? '' : ('：' + String(detail))
  return fail('env', '只读会话不可用（' + reason + '）' + tail)
}

/** 由宿主给的 owner/name 拼会话要的仓库坐标；refId 是 GitHub 房间认的 'owner/name'。 */
function repoRefOf(repo: RepoKey | null, backendId: string): RepositoryRef | null {
  if (!repo || !repo.owner || !repo.name) return null
  const refId = String(repo.owner) + '/' + String(repo.name)
  return { backend: backendId as any, refId: refId, name: refId, url: 'https://github.com/' + refId }
}

/** 契约的引用/阻塞边 → 详情界面认的 {nodes:[{number,title,state}]}。 */
function refNodes(refs: any): any[] {
  return (Array.isArray(refs) ? refs : []).map(function (r: any): any {
    return { number: Number(r && r.key), title: (r && r.title) || '', state: (r && r.state) === 'closed' ? 'CLOSED' : 'OPEN' }
  })
}

/**
 * 契约票 → 详情页字段形状（旧 GraphQL 形状）。
 *
 * 评论：契约只有 Comment[]，没有 pageInfo；这里按「这一趟要了 50 条」推 hasNextPage，
 * endCursor 用已取条数（旧 REST 路就是这么给的）。「加载更多」另走 fetchIssueComments，
 * 不靠这个游标翻详情本身。
 * subIssues：契约 get 不带子票清单（快照那一份有），这里给空连接；地图详情页的
 * 子票列表本来优先读快照。要给子票就该另调 listSubIssues，而不是在这一条路上假装有。
 */
function detailOf(issue: Issue, depsData: any, ref: RepositoryRef): any {
  const comments = (issue.comments || []).map(function (c: any): any {
    return {
      author: { login: (c.author && c.author.login) || '' },
      authorAssociation: c.authorAssociation || '',
      body: c.body || '',
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }
  })
  const blockedBy = depsData && Array.isArray(depsData.blockedBy) ? refNodes(depsData.blockedBy) : refNodes(issue.blockedBy)
  const blocking = depsData && Array.isArray(depsData.blocking) ? refNodes(depsData.blocking) : []
  return {
    number: Number(issue.key),
    title: issue.title,
    state: issue.state === 'closed' ? 'CLOSED' : 'OPEN',
    body: issue.body || '',
    url: issue.url || ('https://github.com/' + ref.refId + '/issues/' + String(issue.key)),
    updatedAt: issue.updatedAt,
    createdAt: issue.createdAt,
    closedAt: issue.closedAt,
    author: issue.author ? { login: issue.author.login, name: (issue.author.name || ''), avatarUrl: (issue.author.avatarUrl || '') } : undefined,
    labels: { nodes: (issue.labels || []).map(function (l: any): any { return { name: l.name, color: l.color || '' } }) },
    assignees: { nodes: (issue.assignees || []).map(function (a: any): any { return { login: a.login } }) },
    comments: { nodes: comments, pageInfo: { hasNextPage: comments.length >= 50, endCursor: String(comments.length) } },
    subIssues: { totalCount: 0, nodes: [] },
    blockedBy: { nodes: blockedBy },
    blocking: { nodes: blocking },
    isPullRequest: issue.isPullRequest === true,
    mergedAt: issue.mergedAt || null,
    reviews: (issue.reviews || []).map(function (r: any): any {
      return { state: r.state, author: { login: (r.reviewer && r.reviewer.login) || '' }, submittedAt: r.submittedAt || '' }
    }),
  }
}

export function createIssueDetail(deps: Deps) {
  const { getRepoKey } = deps

  /**
   * 开一趟只读会话跑 fn：开会话失败、fn 抛错都收成 { ok:false, error }。
   * 这里不吞能力失败——fn 自己按旧形状回答，调用方只看最终回包。
   */
  async function withReadSession(cwd: string, fn: (session: TrackerSession, repo: RepositoryRef, ctx: OpContext) => Promise<any>): Promise<any> {
    if (typeof deps.openSession !== 'function') return sessionFail('没有注入 openSession')
    let opened: any = null
    try { opened = await Promise.resolve(deps.openSession(cwd)) } catch (e: any) { return sessionFail('开会话时抛错', (e && e.message) || e) }
    if (!opened || opened.ok !== true || typeof opened.call !== 'function') return sessionFail(String((opened && opened.reason) || 'open-failed'), opened && opened.detail)
    let repo: RepoKey | null = null
    try { repo = await Promise.resolve(getRepoKey(cwd)) } catch (e: any) { return sessionFail('解析仓库坐标失败', (e && e.message) || e) }
    const ref = repoRefOf(repo, String(opened.backendId || ''))
    // #1453：宿主这一份 getRepoKey 只读本地证据（git remote、.git/config），不再起 gh —— 所以失败原因里
    // 不再写 gh repo view；需要 gh 那一级时由会话的 getRepoKey 能力去问（它过裁决与记账）。
    if (!ref) return fail('env', '无法解析 owner/repo（本地 git 证据里没有 GitHub origin，也没有可用的 .git/config）')
    try {
      return await opened.call(async function (session: TrackerSession, ctx: OpContext): Promise<any> {
        return fn(session, ref, ctx)
      })
    } catch (e: any) {
      return sessionFail('取详情时抛错', (e && e.message) || e)
    }
  }

  async function fetchIssueDetail(n: number, cwd: string, opts?: { isPullRequest?: boolean } | null): Promise<any> {
    if (!n) return fail('parse', '缺少 number')
    return withReadSession(cwd, async function (session: TrackerSession, ref: RepositoryRef, ctx: OpContext): Promise<any> {
      let got: any = null
      try { got = await session.get(ref, String(n), { comments: { first: 50 } }, ctx) } catch (e: any) { return sessionFail('取单票时抛错', (e && e.message) || e) }
      if (!got || got.ok !== true || !got.data) {
        const err = (got && got.error) || {}
        return fail(String(err.kind || 'network'), String(err.message || '单票读取失败'))
      }
      // 阻塞边单独一问（#1304 的投影）；失败不让详情崩：退成 get 自带的那一份入边，出边为空。
      let depsData: any = null
      try {
        const dr: any = await session.getDependencies(ref, String(n), undefined, ctx)
        if (dr && dr.ok === true) depsData = dr.data
      } catch (eD: any) { depsData = null }
      return { ok: true, issue: detailOf(got.data, depsData, ref) }
    })
  }

  // 对外只留一条取数口：REST 兜底与它那个导出一并删除（房间内部已有降级，见文件头）。
  return { fetchIssueDetail }
}
