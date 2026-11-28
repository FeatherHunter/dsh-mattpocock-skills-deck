/**
 * src/refresh/rooms/host/issue-list-fetch.ts —— 列表与地图取数（来源：host/index.js 246–455，H2 #446 搬出）。
 *
 * 为什么要有它（一句话）：面板列表要的全量票、地图票与轻量索引原来都挤在宿主入口里，
 * 搬到这里之后改分页策略、改索引口径、改缓存有效性的人只动这一份，不碰入口。
 *
 * #1444（规格 1439 的 A2 第一批）把三条读路径从「调用方直调 gh」改成「经 Tracker 只读会话调能力」：
 *   列表 → session.list；地图票 → session.list（带 wayfinder:map 与 open 两个筛）；
 *   索引 → session.listPage 翻页（#1418 起带 since 窗口，让房间只取的窗口内的票；没窗口才翻到底）。
 * 因此删掉了原来的三级 gh 兜底（gh api --paginate → 手动逐页 → gh issue list）与地图详情的
 * REST 通道：GraphQL→REST 的降级已收进 GitHub 房间，宿主再留一条就是第二真源。
 *
 * 两条不能改的约定：
 * 1. 对外回包形状不变（snapshot / delta / host API 三处只认形状）：issues 行仍是
 *    { number, title, state:'OPEN'|'CLOSED', labels:[{name,color}], assignees:[login], author, updatedAt, createdAt }。
 * 2. 水印与基线唯一的推进口是 commitIssueIndex，只在变化真的并进列表之后（或探测回来说没变）调它；
 *    本文件一行都不许自己推水印。
 *
 * 失败时保留旧行为：开会话失败或能力失败，回 { ok:false, error:{kind,error} }，不抛、不假装成功。
 *
 * #1689 起索引翻页按轮记账（账本住在 src/refresh/kernel/fallback-fetch-budget.ts，上限常量与宿主额度同源）：
 *   带 since 的探测轮记「常规增量一轮最多 3 个请求」，不带 since 的整仓枚举记「完整枚举最多 16 个请求」；
 *   每翻一页发出前预扣、回来校正、失败回填，预扣不到就停在这一页并如实回被截断的位置，绝不超发。
 */
import type { OpContext } from '../../../tracker/contract/contexts.js'
import type { Issue, RepositoryRef } from '../../../tracker/contract/entities.js'
import type { PageResult } from '../../../tracker/contract/results.js'
import type { TrackerSession } from '../../../tracker/session/open-tracker.js'
import { PAGINATION } from '../../../tracker/contract/pagination.js'
// #1689：索引翻页是本票唯一「完整枚举」的真实请求路径，预算核与额度常量都从额度模块取，不另建配置。
import { createFallbackRoundBudget } from '../../kernel/fallback-fetch-budget.js'
import type { FallbackRoundBudget } from '../../kernel/fallback-fetch-budget.js'
import { CLOSED_PULL_REFRESH_MAX_PAGES, FALLBACK_FETCH_LIMITS } from '../../kernel/host-budget.js'
// #1898：已关闭/已合并拉取请求的补取节拍（10 分钟一次），时间值只在 config/intervals.yaml 里有一份。
import { CLOSED_PULL_REFRESH_INTERVAL_MS } from '../../../shared/time-config/values.js'

interface RepoKey { owner: string; name: string }

/**
 * 索引翻页的硬上限：页大小跟随契约 github.listPageSize（一页 50），最多 100 页（五千条）。
 * 超过就如实失败，不静默截断。
 * 为什么是 50 不是连接上限 100：带全字段的单查询约 3 秒被对端掐连接（2026-10-26 真机实测），
 * 50 页回到 1.4 秒；连接上限 100 仍是硬顶（#1418：要 200 会被整页拒绝），页大小只许比它小。
 */
const INDEX_PAGE_LIMIT = PAGINATION.github.listPageSize
const INDEX_MAX_PAGES = 100

/** 失败信封：旧路这里装的是 gh 回包，形状取 kind + error 两格；上层只读 ok 与 error。 */
function fail(kind: string, message: any): any {
  return { ok: false, error: { kind: kind, error: String(message == null ? '' : message) } }
}

/** 会话失败统一收成 env（与旧路的失败形状一致，上层照旧降级回缓存）。 */
function sessionFail(reason: string, detail?: any): any {
  const tail = detail == null || detail === '' ? '' : ('：' + String(detail))
  return fail('env', '只读会话不可用（' + reason + '）' + tail)
}

/**
 * 仓库地址按后端自己的口径拼：GitHub 与 GitLab 的网页主机名不同，不许把一种地址冒充成另一种。
 * gitea 也一样（#15）：退路只能按房里的官方站惯例回 gitea.com，绝不拼 github.com——真机事故里
 * 自托管 Gitea 仓库因此拿到不存在的页面。自托管实例的真实地址不在这里拼：会话回包（describe
 * 产物）才是权威，withReadSession 同 refId 时优先取它，这份手拼只是会话不可用时的退路。
 */
function repoUrlOf(backendId: string, refId: string): string {
  const base = backendId === 'gitlab' ? 'https://gitlab.com/' : backendId === 'gitea' ? 'https://gitea.com/' : 'https://github.com/'
  return base + refId
}

/** 由宿主给的 owner/name 拼会话要的仓库坐标；refId 是各后端认的 'owner/name'。 */
function repoRefOf(repo: RepoKey | null, backendId: string): RepositoryRef | null {
  if (!repo || !repo.owner || !repo.name) return null
  const refId = String(repo.owner) + '/' + String(repo.name)
  return { backend: backendId as any, refId: refId, name: refId, url: repoUrlOf(backendId, refId) }
}

/** 契约票 → 列表行（旧 gh 形状）。拉取请求行额外带 isPullRequest/mergedAt，界面靠它分流。 */
function rowOf(issue: Issue): any {
  const row: any = {
    number: Number(issue.key),
    title: issue.title,
    state: (issue.state === 'closed' ? 'CLOSED' : 'OPEN'),
    assignees: (issue.assignees || []).map(function (a: any): any { return a.login }),
    labels: (issue.labels || []).map(function (l: any): any { return { name: l.name, color: l.color || '' } }),
    author: issue.author ? { login: issue.author.login, name: (issue.author.name || ''), avatarUrl: (issue.author.avatarUrl || '') } : undefined,
    updatedAt: issue.updatedAt,
    createdAt: issue.createdAt,
  }
  // 旧 fetchIssues 只取工单（REST 里 select(.pull_request == null)）；会话的 list 两张表都给，
  // 所以拉取请求必须带上这个标记，否则它会被当成普通工单混进列表。
  if (issue.isPullRequest === true) { row.isPullRequest = true; row.mergedAt = issue.mergedAt || null }
  return row
}

/** 按更新时间倒序（旧路的排序口径，调用方依赖）。排序键取字符串，缺值当空串。 */
function sortRows(rows: any[]): any[] {
  rows.sort(function (a: any, b: any): number { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) })
  return rows
}

export function createIssueList(deps: any): any {
  const { getRepoKey, issueIndexFromSnapshot, issueIndexChanged, rememberIssueIndex, logCtx, noteSnapshot } = deps as any

  // #491 房外埋点 helpers：hash8 只记散列；P1 外层先判开关+采样，字段函数只在守卫内求值。
  function hash8(s: any): string { try { const t: string = String(s || ''); let h: number = 5381; for (let i: number = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e: any) { return '00000000' } }
  let probeSampleN: number = 0

  /**
   * 开一趟只读会话跑 fn：开会话失败、解析仓库失败、fn 抛错都收成这条路的失败信封。
   * 为什么把仓库坐标在这里拼：会话只认 RepositoryRef，而宿主注入的 getRepoKey 给的是 owner/name；
   * 两处拼法只留这一份，列表、地图、索引三条路就不会各拼一个不一样的 refId。
   */
  async function withReadSession(cwd: any, fn: (session: TrackerSession, repo: RepositoryRef, ctx: OpContext) => Promise<any>): Promise<any> {
    if (typeof deps.openSession !== 'function') return sessionFail('没有注入 openSession')
    let opened: any = null
    try { opened = await Promise.resolve(deps.openSession(cwd)) } catch (e: any) { return sessionFail('开会话时抛错', (e && e.message) || e) }
    if (!opened || opened.ok !== true || typeof opened.call !== 'function') return sessionFail(String((opened && opened.reason) || 'open-failed'), opened && opened.detail)
    let repo: RepoKey | null = null
    try { repo = await Promise.resolve(getRepoKey(cwd)) } catch (e: any) { return sessionFail('解析仓库坐标失败', (e && e.message) || e) }
    const backendId: string = String(opened.backendId || '')
    let ref = repoRefOf(repo, backendId)
    // 会话是仓库身份的真源（GitLab 的宿主 getRepoKey 只认 GitHub 远端，会回 null）：同一个 refId
    // 时优先用会话那份地址（自建实例的域名只有它知道）；GitHub 认不出 owner/name 时仍按老口径如实失败。
    const sessionRef: RepositoryRef | null = (opened.repoRef && opened.repoRef.refId) ? opened.repoRef : null
    if (ref && sessionRef && String(sessionRef.refId) === ref.refId) ref = sessionRef
    if (!ref && sessionRef && backendId !== 'github') ref = sessionRef
    if (!ref) return fail('env', '无法解析 owner/repo')
    try {
      return await opened.call(async function (session: TrackerSession, ctx: OpContext): Promise<any> {
        return fn(session, ref, ctx)
      })
    } catch (e: any) {
      return sessionFail('取数时抛错', (e && e.message) || e)
    }
  }

  /**
   * #1863：这一批列表读结果交给宿主写快照库（按组、分批）；写库失败不影响取数。
   * 宿主没接钩子时整条关闭，老调用方行为一字不变。
   */
  async function recordRows(cwd: any, ref: RepositoryRef, rows: any[]): Promise<boolean> {
    if (typeof deps.onIssueRows !== 'function' || !Array.isArray(rows) || !rows.length) return true
    // 拉取请求也交下去（#1870 更正）：库是工作区数据的权威副本，PR 是其中一种行——面板的拉取请求
    // 页签读的就是它们（prIssuesOf）。从前这里滤掉，是因为「列表回包不收 PR」那条展示口径；
    // 展示归展示，落库归落库：哪个后端不给 PR，交给适配层按 isPullRequest 有没有表达来处理。
    const issues = rows.filter(function (x: any): boolean { return !!x && x.key != null })
    if (!issues.length) return true
    try {
      const written: any = await deps.onIssueRows(cwd, ref, issues)
      // #1887：库这一侧明说「没写进去」时如实回 false —— 整仓完整枚举的标记要求这一趟的行真的进库
      // （写失败、句柄只读——网络盘回退或文件系统不可写——都算没写）；没接写口时上面的早退按 true 处理，老调用方行为不变。
      return !(written && written.ok === false)
    } catch (e: any) { return false }
  }

  // ── #1898：已关闭/已合并的拉取请求补一页进库（规格 #1885 S7）──
  //
  // 为什么需要它：整份取数只问开放工作集（composeSnapshot 传 state:'open'），索引扫描只翻
  // repository.issues —— 已关闭/已合并的拉取请求没有任何一条路把它写进库，页签于是永远挂着「打开」。
  //
  // 三条纪律：
  //   ① 节拍：按工作区记上一次跑的时刻，不足 CLOSED_PULL_REFRESH_INTERVAL_MS 这一拍一条请求都不发
  //      （节拍住 config/intervals.yaml，这里不写数字）。
  //   ② 请求上限：每轮最多翻一页（CLOSED_PULL_REFRESH_MAX_PAGES，住 kernel/host-budget.ts），按更新
  //      时间倒序的第一页里就有刚合并的那几条；不往历史里翻，额度吃不穿。
  //   ③ 时刻在发请求之前就记下：连着的两拍进来时第二拍直接按节流回掉，不会双发；失败也算跑过
  //      （否则失败时每拍都重试，等于持续烧额度），下一个窗口再试。
  //
  // 写库走 recordRows（与列表同一口）：行、合并时间、评审一起写进库，界面从库回放就能看出「已合并」。
  const closedPullRefreshAtByCwd: Record<string, number> = {}
  const clockOf = typeof deps.now === 'function' ? deps.now : Date.now
  async function refreshClosedPulls(cwd: any): Promise<any> {
    const at = Number(clockOf()) || 0
    const key = String(cwd || '')
    const last = Number(closedPullRefreshAtByCwd[key]) || 0
    if (last && at - last < CLOSED_PULL_REFRESH_INTERVAL_MS) return { ok: true, ran: false, reason: 'throttled' }
    closedPullRefreshAtByCwd[key] = at
    return withReadSession(cwd, async function (session: TrackerSession, ref: RepositoryRef, ctx: OpContext): Promise<any> {
      // 今天只有 GitHub 有「拉取请求」这一种行（GitLab 与本地 Markdown 的读结果都不表达它）：
      // 别的后端上去了也只会白跑一条请求、一行都写不进去，直接说这档不适用，不打这一条。
      if (String(ref.backend || '') !== 'github') return { ok: true, ran: false, reason: 'not-applicable' }
      const capped: any = Object.assign({}, ctx, { listMaxPages: CLOSED_PULL_REFRESH_MAX_PAGES })
      const r: any = await session.list(ref, { state: 'closed', isPullRequest: true }, capped)
      if (!r || r.ok !== true) {
        const err = (r && r.error) || {}
        return { ok: false, ran: true, fetched: 0, written: 0, reason: String(err.kind || 'network') }
      }
      const rows: any[] = (Array.isArray(r.data) ? r.data : []).filter(function (x: any): boolean { return !!x && x.isPullRequest === true })
      if (!rows.length) return { ok: true, ran: true, fetched: 0, written: 0 }
      const written: boolean = await recordRows(cwd, ref, rows)
      if (!written) return { ok: false, ran: true, fetched: rows.length, written: 0, reason: 'write-not-committed' }
      return { ok: true, ran: true, fetched: rows.length, written: rows.length }
    })
  }

  /** 地图票：只要带 wayfinder:map 且未关闭的票（旧 gh issue list 的两条筛，原样保留）。 */
  async function fetchMaps(cwd: any): Promise<any> {
    return withReadSession(cwd, async function (session: TrackerSession, ref: RepositoryRef, ctx: OpContext): Promise<any> {
      const r: any = await session.list(ref, { labels: ['wayfinder:map'], state: 'open' }, ctx)
      if (!r || r.ok !== true) {
        const err = (r && r.error) || {}
        return fail(String(err.kind || 'network'), err.message || '地图票读取失败')
      }
      await recordRows(cwd, ref, r.data || [])
      // 与列表同一条口径：拉取请求不算地图（旧 gh issue list 本来就不返回 PR）。
      const maps = (r.data || []).filter(function (x: any): boolean { return !!x && x.isPullRequest !== true }).map(function (x: Issue): any {
        return {
          number: Number(x.key), title: x.title, body: x.body || '',
          labels: (x.labels || []).map(function (l: any): any { return { name: l.name, color: l.color || '' } }),
          assignees: (x.assignees || []).map(function (a: any): any { return { login: a.login } }),
          state: 'OPEN', updatedAt: x.updatedAt,
        }
      })
      return { ok: true, maps: maps }
    })
  }

  // 全部票（open + closed，Client 列表 open 常显、底部「已关闭」折叠行），按 updatedAt 倒序；
  // labels 带 name + color；assignees 带出（状态栏「占用」按列表口径：已认领 + 被阻塞）。
  async function fetchIssues(cwd: any): Promise<any> {
    return withReadSession(cwd, async function (session: TrackerSession, ref: RepositoryRef, ctx: OpContext): Promise<any> {
      const r: any = await session.list(ref, undefined, ctx)
      if (!r || r.ok !== true) {
        const err = (r && r.error) || {}
        return fail(String(err.kind || 'network'), err.message || '列表读取失败')
      }
      await recordRows(cwd, ref, r.data || [])
      // 列表视图不收拉取请求（#1870 起口径是这样：PR 有自己的页签，读的是快照里的 PR 行）。
      // 注意这与「写库」不是一回事：下面 recordRows 照旧把 PR 交给库（库是工作区的权威副本），
      // 只有这个回包的 issues 数组不收它们。
      const rows = (r.data || []).filter(function (x: any): boolean { return !!x && x.isPullRequest !== true }).map(rowOf)
      return { ok: true, issues: sortRows(rows) }
    })
  }

  // #2 deletion fix：轻量索引用于发现删除、关闭和重开。
  // 为什么改成 listPage：会话的 list 在 500 条处截断，只翻一页会把老票当成「被删除」；
  // 有窗口起点时把 since 交给服务端（GraphQL filterBy.since）只取窗口内的票，没有窗口才翻到底。
  // 两者都按 PageResult.nextCursor 翻到没有下一页为止，拿齐后再按 updatedAt 与窗口起点比对 ——
  // 窗口状态机与水印提交时机一行不动（在 issue-index-scan.ts）。
  async function fetchIssueIndex(cwd: any, sinceIso: any, injectedBudget?: FallbackRoundBudget): Promise<any> {
    // #1689：这一趟翻页自己记一本预算账。带 since 的探测轮能复用探针上一步注入的增量账本
    // （同一轮里探测与后续取数共用 3 个请求的额度）；不带 since 的整仓枚举无论谁调都现开一本
    // 「完整枚举」账本——注入方按增量轮造的小账本不该拿来卡整仓枚举（3 与 16 是两条不同的口径）。
    const sinceMs = sinceIso ? Date.parse(String(sinceIso)) : NaN
    const useSince = Number.isFinite(sinceMs)
    const round: FallbackRoundBudget = useSince && injectedBudget ? injectedBudget : createFallbackRoundBudget({ kind: useSince ? 'increment' : 'enumerate', limits: FALLBACK_FETCH_LIMITS })
    return withReadSession(cwd, async function (session: TrackerSession, ref: RepositoryRef, ctx: OpContext): Promise<any> {
      if (typeof session.listPage !== 'function') return fail('unsupported', '该后端的会话不支持 listPage，索引无法翻页取全量')
      const index: Record<string, string> = {}
      let persisted: boolean = true
      let cursor: string | undefined = undefined
      let pages = 0
      while (true) {
        pages += 1
        if (pages > INDEX_MAX_PAGES) return fail('truncated', '索引翻页超过 ' + INDEX_MAX_PAGES + ' 页，拒绝用不完整的索引推进水印')
        // 发出前先记账：这一页的小票拿不到（本轮请求已达上限）就停手，绝不再发第 N+1 条请求。
        const ticket = round.reserve({ bucket: 'read', cost: 1, classLabel: 'index-page' })
        if (!ticket) {
          const view = round.view()
          const gotPages = pages - 1
          const where = gotPages === 0 ? '第一页尚未发出' : ('已取 ' + gotPages + ' 页，第 ' + pages + ' 页未发出')
          return Object.assign(fail('truncated', '索引翻页被本轮请求预算拦住：' + where + '，本轮上限 ' + view.limit + ' 个请求，拒绝用被截断的索引推进水印'), { pages: gotPages, budget: view })
        }
        const opts: any = { limit: INDEX_PAGE_LIMIT }
        if (cursor) opts.cursor = cursor
        // 窗口交给服务端（GraphQL filterBy.since）：只取更新过的票，稳态一次探测只翻一两页而不是整仓。
        // 非法的窗口串不往房间塞，让房间回「不设窗口」——多翻几页是浪费，整页报错是故障。
        const filter: any = useSince ? { since: String(sinceIso) } : {}
        let page: any = null
        try { page = await session.listPage(ref, filter, opts, ctx) } catch (e: any) { round.backfill(ticket, 1); return Object.assign(fail('network', (e && e.message) || e), { pages: pages - 1, budget: round.view() }) }
        if (!page || page.ok !== true) {
          const err = (page && page.error) || {}
          round.backfill(ticket, 1)
          return Object.assign(fail(String(err.kind || 'network'), err.message || '索引读取失败'), { pages: pages - 1, budget: round.view() })
        }
        // 收到了就按实际条数校正：预扣的 1 条换成真发出去的 1 条。
        round.correct(ticket, 1)
        const data: PageResult = page.data || { items: [], nextCursor: null, total: 0 }
        const items: Issue[] = Array.isArray(data.items) ? data.items : []
        persisted = (await recordRows(cwd, ref, items)) && persisted
        for (let i = 0; i < items.length; i++) {
          const it: any = items[i]
          if (!it || it.key == null) continue
          // #1870 防御：这份索引与快照里算出来的那份逐条比对（planDelta 用它判「有没有票被删掉」），
          // 两边都不能有 PR —— 这一页只翻 repository.issues，PR 本来进不来；真混进来也别让它进索引，
          // 否则下一趟整扫会把库里的 PR 行读成「这一条不见了」，整池重建停不下来。
          if (it.isPullRequest === true) continue
          const key = String(it.key)
          // 窗口比对：since 之后动过的票才进这一趟的索引（与旧 gh api 的 since 参数同义）。
          if (useSince) {
            const t = Date.parse(String(it.updatedAt || ''))
            if (Number.isFinite(t) && t < sinceMs) continue
          }
          index[key] = String(it.state || '').toUpperCase() + '|' + String(it.updatedAt || '')
        }
        const next = data.nextCursor || null
        if (!next) break
        if (next === cursor) return Object.assign(fail('parse', '索引翻页游标没有前进，拒绝死循环'), { pages: pages, budget: round.view() })
        cursor = next
      }
      return {
        ok: true,
        repo: { owner: ref.refId.split('/')[0], name: ref.refId.slice(ref.refId.indexOf('/') + 1) },
        // #1887：库身份真源按会话给的 refId 原样交回（GitHub 是 owner/name，GitLab 是项目路径，
        // 本地 Markdown 是工作区目录），比从字符串里再拆一次 owner/name 稳。
        repoIdentity: String(ref.refId || ''),
        backendId: String(ref.backend || ''),
        index: index,
        count: Object.keys(index).length,
        pages: pages,
        // 整仓枚举真正写进库了没有：写失败时这一格为 false，完整枚举标记不写（见 issue-index-scan 的 commit）。
        persisted: persisted,
        budget: round.view(),
      }
    })
  }

  // ── 索引扫描入口（#1429）：窗口扫描与水印推进住同目录 issue-index-scan.ts（createIssueIndexScan，
  //   内含唯一一份窗口状态，不另起第二份）；这里只留同名转交字段（index.ts / probe-handler / 单测写法不变），
  //   仍走动态 import（宿主侧禁止静态引入新文件 D7，与既有范式一致）。
  /**
   * #1870：重启后的第一次扫描要的起点——库里那份工作区数据。
   *
   * 为什么在这里取而不在 issue-index-scan 里：只有这一层摸得到库门面，索引扫描那边只持有窗口状态，
   * 不该为了开库再引一个依赖。
   *
   * 后端编号由调用方点名传进来（探针那一拍本来就已经知道这一轮是哪个后端），**不在这里开会话去问**：
   * 开会话要过注册表选择与远端定位，可能真的花一条出站额度，而这条路上紧接着的取数还要再开一趟——
   * 为了一个字符串多开一趟不划算。拿不到后端编号就回 null，调用方照旧整仓枚举（比猜一个后端、
   * 开错库文件要好）。
   *
   * 回的是「库回放出来的整份快照」与行组最老的那一次取数时刻（oldestRowAtMs，见 SnapshotReplay
   * 那个字段的注释：不能拿最新时刻顶替）。起点判据交给 kernel/index-window-rules.ts 的
   * seedFromSnapshot —— 口径与从前读旧磁盘快照那一版完全一样，旧 JSON 一个字节都不碰。
   */
  async function readLibrarySnapshot(cwd: any, repo: any, backendId: any): Promise<{ snapshot: any; oldestRowAtMs: number } | null> {
    if (typeof deps.getSnapshotLibrary !== 'function') return null
    if (!repo || !repo.owner || !repo.name) return null
    const backend: string = String(backendId || '')
    if (!backend) return null
    let lib: any = null
    try { lib = await Promise.resolve(deps.getSnapshotLibrary()) } catch (e: any) { lib = null }
    if (!lib || typeof lib.readSnapshotReplay !== 'function') return null
    const refId: string = String(repo.owner) + '/' + String(repo.name)
    try {
      const replay: any = await lib.readSnapshotReplay({
        workspaceRoot: cwd,
        backend: backend,
        repoIdentity: refId,
        repo: { backend: backend, refId: refId, name: refId, url: '' },
      })
      if (!replay || !replay.snapshot) return null
      return { snapshot: replay.snapshot, oldestRowAtMs: Number(replay.oldestRowAtMs) || 0 }
    } catch (e: any) { return null }
  }

  /**
   * #1887：整仓完整枚举真正走完、并且这一趟的行写进库之后，把「上一次完整枚举时刻」写进库级同步簿记。
   *
   * 调用时机只有一个：issue-index-scan 的 commitIssueIndex（水印与基线唯一的推进口），而且只在
   * 调用方明确说「这一趟是完整枚举且没有被截断、行也确实写进库」时。取数完成不等于采用：
   * 被推迟 / 被丢弃 / 失败的那一趟不写；窗口扫描（full=false）、被页上限或预算截断（那几趟根本
   * 到不了 commit）也都不写。写失败按「不知道」处理，下一次完整枚举还会再写，绝不挡探测回包。
   *
   * 为什么写这一格：面板六个数字的完整度只看它（projection/counts.ts）。不写它，界面会永远说
   * 「已知 N 张（未取全）」——那是诚实，但不是完整枚举之后该有的措辞。
   */
  async function markFullEnumeration(input: { cwd: string, backendId: string, repoIdentity: string, atMs: number }): Promise<void> {
    if (typeof deps.getSnapshotLibrary !== 'function') return
    const backend: string = String(input.backendId || '')
    const repoIdentity: string = String(input.repoIdentity || '')
    if (!backend || !repoIdentity) return
    let lib: any = null
    try { lib = await Promise.resolve(deps.getSnapshotLibrary()) } catch (e: any) { lib = null }
    if (!lib || typeof lib.writeSyncState !== 'function') return
    try {
      await lib.writeSyncState(
        { workspaceRoot: input.cwd, backend: backend, repoIdentity: repoIdentity },
        { fullEnumerationMs: input.atMs },
      )
    } catch (e: any) {}
  }

  let _idxScanP: any = null
  function _idxScan(): Promise<any> {
    if (!_idxScanP) _idxScanP = import('./issue-index-scan.js').then(function (m: any) {
      return m.createIssueIndexScan({
        getRepoKey: getRepoKey,
        fetchIssueIndex: function (cwd: any, sinceIso: any, budget: any): Promise<any> { return fetchIssueIndex(cwd, sinceIso, budget) },
        readLibrarySnapshot: readLibrarySnapshot,
        // #1887：完整枚举被采用之后（commitIssueIndex）才写「上一次完整枚举时刻」。
        onFullEnumeration: markFullEnumeration,
        now: Date.now,
      })
    })
    return _idxScanP
  }
  // 尾参 opts 标成可选：原 .js 里 cacheSnapshotIsCurrent 只传 cwd 一个实参，少传在运行时就是 undefined，原样透传。
  async function fetchIssueIndexWindowed(cwd: any, opts?: any): Promise<any> {
    try { const sc: any = await _idxScan(); return await sc.fetchIssueIndexWindowed(cwd, opts) } catch (e: any) { return { ok: false, error: { kind: 'env', error: String((e && e.message) || e) } } }
  }
  /** 水印与基线唯一的推进口：只在「变化真的并进列表之后」（或探测回来说没变）调它。 */
  async function commitIssueIndex(cwd: any, nextWatermarkMs: any, nextIndex: any, opts?: any): Promise<any> {
    try { const sc: any = await _idxScan(); return await sc.commitIssueIndex(cwd, nextWatermarkMs, nextIndex, opts) } catch (e) { return { ok: false, reason: 'threw' } }
  }
  // ---- 原 index.js 475–488：缓存有效性判断与快照落盘收纳 ----
  const cacheSnapshotIsCurrent: any = async function (snap: any, cwd: any): Promise<any> {
    try {
      const remote: any = await fetchIssueIndexWindowed(cwd)
      if (!remote.ok) { try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'panelSync.eval', function (): any { return { repoKeyHash: hash8(String(cwd || '')), baseline: String((snap && (snap.version || snap.generatedMs)) || ''), dirty: true, failures: 1 } }) } catch (eL) {}; return null }
      const before: any = issueIndexFromSnapshot(snap)
      const changed: any = issueIndexChanged(before, remote.index)
      const current: boolean = !changed
      // #723（T19c）第 E 件：水印（与基线）只在「变化真的并进列表之后」才推进。这一条路只回答
      // 「缓存还算不算当前」，变了就说明这次结果**还没**并进任何列表 —— 此时推水印会把那条变化
      // 挤出扫描窗口（静默漏报）。没变则相反：列表与远端一致，推过去是安全的。
      if (current) { try { await commitIssueIndex(cwd, remote.nextWatermarkMs, remote.index) } catch (eC) { /* 推不动就保持原样，下次重扫一遍，不丢数据 */ } }        try { if (logCtx && logCtx.isEnabled('debug') && changed && ((++probeSampleN % 100) === 0)) logCtx.fire('debug', 'probe.eval', function (): any { return { repoKeyHash: hash8(remote.repo ? (remote.repo.owner + '/' + remote.repo.name) : String(cwd || '')), count: remote.count || Object.keys(remote.index || {}).length, changed: true } }) } catch (eL) {}
      try { if (logCtx && logCtx.isEnabled('debug') && changed) logCtx.fire('debug', 'panelSync.eval', function (): any { return { repoKeyHash: hash8(remote.repo ? (remote.repo.owner + '/' + remote.repo.name) : String(cwd || '')), baseline: String((snap && (snap.version || snap.generatedMs)) || ''), dirty: true, failures: 0 } }) } catch (eL) {}
      if (current) rememberIssueIndex(remote.repo, remote.index)
      return current
    } catch (e) { return null }
  }
  /**
   * #1893：宿主内存里的快照工作副本已删，采纳快照不再「存进某个缓存」，只记两件事实：
   *   ① 通知事件库（#1693）；② 远端索引记忆。
   * 面板数据本身只住在快照库里，下一次首屏从库里回放——所以这里不许再出现任何把整份快照存起来的一步。
   * 「这个工作区是不是降级常驻」由宿主入口在调用本函数时顺手记下（那边才有探针要的同步读数口）。
   */
  const adoptSnapshot: any = function (snap: any, cwd: any): any {
    // #1693：采纳快照是降级开始/恢复的唯一迁移点（缓存命中、304 与失败都不走这里）。没接事件库或记失败都不影响采纳结果。
    try { if (typeof noteSnapshot === 'function') Promise.resolve(noteSnapshot(snap, cwd)).catch(function () {}) } catch (eN) {}
    if (snap && snap.repo) rememberIssueIndex(snap.repo, issueIndexFromSnapshot(snap))
    return snap
  }

  // 旧的两个手工分页兜底与地图详情 REST 通道已删（#1444）：它们直调 gh，且房间内部已有同样的降级。
  return { fetchMaps, fetchIssues, fetchIssueIndex, fetchIssueIndexWindowed, commitIssueIndex, cacheSnapshotIsCurrent, adoptSnapshot, refreshClosedPulls }
}
