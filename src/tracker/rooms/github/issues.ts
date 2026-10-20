/**
 * src/tracker/rooms/github/issues.ts — issue 读路径（list / get + REST 降级 + 内存过滤）。
 *
 * 文件头原写 `backends/github/issues.js`，是 #1019 目录归位前的旧路径；#1052 按读路径这一片改成今天的真名。
 *
 * #440 拆分后：写路径见 `issues-write.ts`。parseRepo / repoId 导出供写路径共享。
 * #504：拉取请求主路（GraphQL 双查询同池）+ REST 帮手见 `pulls.ts`（单文件 350 行纪律）。
 *
 * 定版依据：#138 一页纸方案，契约操作签名归一。
 * 所有 op 返回 OpResult，不 throw；错误经 ghVerdictOf 归一（判档表在 src/tracker/kernel/error-rules.ts）。
 *
 * 日志（#1052）：每一笔 gh 命令由房内常驻的 `gh.exec` 落盘（`via` 写 `list.gql` / `list.pr` / `list.rest` /
 * `get.gql` / `get.pr` / `get.rest` / `get.rest-pr`，于是同一趟里哪一行属于哪条路一目了然）；而「命令成功了、
 * 这一趟仍然没读成（或只读回一部分）」的几条路各自在返回前落一行 `read.degraded`，`reason` 依次写
 * `list:repo-ref` / `list:gql-err` / `list:json` / `list:shape` / `list:page-fail` / `list:partial` /
 * `list:degraded`，单票那条写 `get:repo-ref` / `get:json` / `get:shape` / `get:gql-err` / `get:degraded`。
 */

import { STATE, ERROR_KIND } from '../../contract/vocabulary.js'
import type { OpContext } from '../../contract/contexts.js';
import type { Issue, RepositoryRef } from '../../contract/entities.js';
import type { GetOpts, ListFilter } from '../../contract/inputs.js';
import type { OpResult } from '../../contract/results.js';
import { fail } from '../../kernel/preflight.js'
import { emitReadDegraded } from './read-log.js'
import { ghClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { ghFailureMessage, ghVerdictOf } from './errors.js'
import { repairParentLinksREST } from './parent-repair.js'
import { rosterAdoptList, rosterUpsert } from './roster.js'
import type { MemoContext } from './roster.js'
import { LIST_QUERY, GET_QUERY, LIST_PR_QUERY, GET_PR_QUERY } from './queries.js'
import { fetchAllPullsREST, enrichRestPRs, enrichSinglePR } from './pulls.js'
import { pickFallbackReason } from './fallback-reason.js'
// 记日志那层壳与「调试开关开着吗」那一问都在内核一份（#1182 第 3 件）。
import { debugOn, guardEmit } from '../../kernel/log-emit.js'

/** 仓库坐标：拥有者与仓库名，refId 形不对就回 null 而不是抛。 */
interface ParsedRepo {
  owner: string;
  name: string;
}

/**
 * list 的返回：成功时带票数组；走了 REST 降级时多带 fallback 标记（宿主快照据此写降级标记，界面只读不写）。
 * `truncated` 是 #1304 加的：GraphQL 主路到 500（工单）/1000（拉取请求）条的安全上限就停了，
 * 这时结果只是「拿到的这些」，调用方不许当成整仓 —— 依赖反推、名册重建都要按「不全」处理。
 */
type ListIssuesResult = OpResult<Issue[]> & { fallback?: string; fallbackReason?: string; truncated?: boolean };

// 为什么 catch 里的错误要先转这层再读：catch 出来是 unknown，短路后的真值分支会被收成空对象形状、
// 直接读 message 报缺成员；转成最小形状后读法与原来一致，运行时不变。
type CaughtMsg = { message?: unknown } | null;
function caughtMessage(e: unknown, len: number): string {
  const eb = e as CaughtMsg;
  return String((eb && eb.message) || e).slice(0, len)
}

// 房内埋点（#494 O1）：GraphQL→REST 降级分支落同名事件 graphql.fallback（#8 告警）与 issues.fallback（#9 常驻）+ fallback.chain（#42 常驻），字段按 #489 附录 1.4。
// 常驻直发（无外层开关判断，库体内兜底）；无 ctx.logEvent 时静默跳过；只记通道名与原因枚举，不记响应原文。
// 降级原因分类（#504 雾证据补强）：细分原因实现见 fallback-reason.js（房内拆文件不拆房），此处只留落点。
// 超时 → timeout；限流 → rate-limit；企业版主机 → ghe-host；其余 → graphql-error；只复用现有事件名与字段，附录不动。
function emitRestFallback(ctx: OpContext, scope: string, latencyMs: number, reason: unknown): void {
  guardEmit(ctx, (c) => {
    const r = typeof reason === 'string' && reason ? reason : 'graphql-error'
    c.logEvent('warn', 'graphql.fallback', { scope, reason: r })
    c.logEvent('info', 'issues.fallback', { from: 'graphql', to: 'rest', reason: r })
    c.logEvent('info', 'fallback.chain', { in: 'graphql', out: 'rest', latencyMs: typeof latencyMs === 'number' ? latencyMs : 0 })
  })
}
// 坏节点计数（#504 可观测）：列表逐票归一失败会丢票，聚合计数后复用 error.normalize 调试事件记一行，不新增事件名，附录不动。
// 高频路径：同行判断调试开关，关闭时不组装字段；只记范围与丢票计数，不记票原文。
function emitBadNodes(ctx: OpContext, scope: string, dropped: number, total: number): void {
  if (!dropped) return
  guardEmit(ctx, (c) => {
    c.logEvent('debug', 'error.normalize', { rawKind: 'bad-node:' + scope + ':' + dropped + '/' + total, mappedKind: ERROR_KIND.PARSE })
  }, () => debugOn(ctx))
}

export function parseRepo(repo: RepositoryRef | null | undefined): ParsedRepo | null {
  if (!repo || typeof repo.refId !== 'string' || !repo.refId) return null
  const s = repo.refId.trim()
  const idx = s.indexOf('/')
  if (idx <= 0) return null
  return { owner: s.slice(0, idx), name: s.slice(idx + 1) }
}

export function repoId(repo: RepositoryRef | null | undefined): string {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

/**
 * REST 降级通道（2026-09-02：#415 承接 #414 刷新现场修复）。
 * 背景：api.github.com/graphql 的 POST 在本机偶发 `unexpected EOF`（网络层），
 *   而 REST 单页（gh api repos/{o}/{n}/issues?page=k）稳定可用。
 * 方案与 GraphQL 同构：逐页 REST → normalizeIssue（normalize 兼容 REST 形状）→
 *   用 `/issues/{map}/sub_issues` 端点修复树边（parentKey），保证 compose 的 maps/tickets 不受损。
 * 失败语义：首页失败 = 双路皆挂，诚实返回错误；尾页失败 = 按已得数据截断上报。
 */
async function fetchAllIssuesREST(parsed: ParsedRepo, ctx: OpContext): Promise<OpResult<unknown[]>> {
  const c = ghClient(ctx)
  // 为什么标成未知数组：回包是 GitHub 的原始行，本函数只负责翻页搬运、不解读形状，解读是调用方的事。
  const out: unknown[] = []
  const MAX_PAGES = 10
  const PAGE = 100
  // 本函数的起点：下面每一行降级日志带的是「这一笔从本函数入口到这里花掉的毫秒数」。
  const startsAt = Date.now()
  for (let p = 1; p <= MAX_PAGES; p++) {
    // 这是 GraphQL 主路失败之后的 REST 降级翻页：标签与主路分开，事后一眼看出走的是哪条路。
    const r = await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/issues?state=all&per_page=${PAGE}&page=${p}`], { cwd: ctx && ctx.cwd, via: 'list.rest' })
    if (!r.ok) {
      if (!out.length) return { ok: false, error: r.error }
      // 尾页失败按已得数据截断上报（本函数一贯的口径）：回的是成功，可翻到第 p 页就断了。
      emitReadDegraded(ctx, 'list', 'list:page-fail', Date.now() - startsAt)
      return { ok: true, data: out }
    }
    let j: unknown
    try { j = JSON.parse(r.data.stdout || '') } catch (e) {
      // 原文交这次 gh 的完整产出：人自己就能看出回包里到底是什么。
      if (!out.length) {
        emitReadDegraded(ctx, 'list', 'list:rest-json', Date.now() - startsAt)
        return fail(ERROR_KIND.PARSE, `rest fallback: invalid json ${caughtMessage(e, 200)}`, r.data)
      }
      emitReadDegraded(ctx, 'list', 'list:page-fail', Date.now() - startsAt)
      return { ok: true, data: out }
    }
    if (!Array.isArray(j)) {
      if (!out.length) {
        emitReadDegraded(ctx, 'list', 'list:rest-shape', Date.now() - startsAt)
        return fail(ERROR_KIND.PARSE, 'rest fallback: non-array response', r.data)
      }
      emitReadDegraded(ctx, 'list', 'list:page-fail', Date.now() - startsAt)
      return { ok: true, data: out }
    }
    for (const n of j) out.push(n)
    if (j.length < PAGE) break
  }
  // 翻满十页还没到底这一支不记日志：REST 这条接口不报总数，看不出「库里真有这么多」还是「被十页截住了」，
  // 本函数一贯按「翻到十页为止」的上报口径处理（不是故障）。
  return { ok: true, data: out }
}



// 内存过滤（list 两路共用）
function applyIssueFilter(all: Issue[], filter: ListFilter | null | undefined): Issue[] {
  let filtered = all
  if (filter && typeof filter === 'object') {
    if (filter.state) {
      const want = String(filter.state).toLowerCase()
      filtered = filtered.filter((i) => i.state === want)
    }
    if (filter.type) {
      filtered = filtered.filter((i) => i.type === filter.type)
    }
    if (filter.parentKey !== undefined) {
      if (filter.parentKey === null) filtered = filtered.filter((i) => i.parentKey === null)
      else filtered = filtered.filter((i) => i.parentKey === String(filter.parentKey))
    }
    if (Array.isArray(filter.keys) && filter.keys.length) {
      const set = new Set(filter.keys.map((k) => String(k)))
      filtered = filtered.filter((i) => set.has(i.key))
    }
    if (filter.isPullRequest !== undefined) {
      const want = filter.isPullRequest === true
      filtered = filtered.filter((i) => i.isPullRequest === want)
    }
  }
  return filtered
}

/**
 * list(repo, filter, ctx) -> OpResult<Issue[]>
 * 读取用 GraphQL 批量（LIST_QUERY），GraphQL 失败（网络 EOF / 配额 / 无法解析）时 REST 降级；
 * 内存过滤 filter{type,state,parentKey,keys}
 */
export async function listIssues(repo: RepositoryRef, filter: ListFilter | undefined, ctx: MemoContext): Promise<ListIssuesResult> {
  // 这一笔的起点：只给降级日志算耗时用；主路失败原因要的那份耗时刻是下面单独的 `t0`，两者不混。
  const tList = Date.now()
  try {
    const parsed = parseRepo(repo)
    if (!parsed) {
      emitReadDegraded(ctx, 'list', 'list:repo-ref', Date.now() - tList)
      return fail(ERROR_KIND.NOTFOUND, `list: repo.refId missing or malformed: ${repoId(repo)}`, repo)
    }
    const c = ghClient(ctx)
    const t0 = Date.now()
    const all = []
    let after = null
    let hasNext = true
    // 拉取请求那张表到 1000 条就停；工单那张到 500 条就停。两处都在停下来的那一刻把这件事记在这两个变量上，
    // 收尾时统一记一行降级 —— 「回成功、只装了一部分」必须能从日志里看出来。
    let issuesTruncated = false
    let prTruncated = false
    let needRest = false
    // 主路是怎么败下阵来的（只填第一次那一个）：它决定降级行 `read.degraded` 的 reason 用哪个。
    let needRestWhy = 'list:gql-err'
    let firstRestCause = null
    let droppedIssues = 0
    let seenIssues = 0
    let droppedPulls = 0
    let seenPulls = 0
    // 分页先取 100，超量分页
    while (hasNext) {
      // 构造带变量查询：gh api graphql -f query -F owner -F name -F first -F after
      const query = LIST_QUERY
      const args = ['api', 'graphql', '-f', `query=${query}`, '-F', `owner=${parsed.owner}`, '-F', `name=${parsed.name}`, '-F', `first=100`]
      if (after) args.push('-F', `after=${after}`)
      else args.push('-F', 'after=')
      const r = await c.execGh(args, { cwd: ctx && ctx.cwd, via: 'list.gql' })
      if (!r.ok) { needRest = true; needRestWhy = 'list:gql-err'; if (!firstRestCause) firstRestCause = (r && r.error) || r; break }
      const text = r.data.stdout || ''
      let j
      try { j = JSON.parse(text) } catch (e) { needRest = true; needRestWhy = 'list:json'; if (!firstRestCause) firstRestCause = e; break }
      if (j.errors) { needRest = true; needRestWhy = 'list:gql-err'; if (!firstRestCause) firstRestCause = { message: JSON.stringify(j.errors).slice(0, 800) }; break }
      const repoData = j.data && j.data.repository
      if (!repoData) { needRest = true; needRestWhy = 'list:shape'; if (!firstRestCause) firstRestCause = { message: 'graphql: missing repository' }; break }
      const issues = repoData.issues
      if (!issues || !Array.isArray(issues.nodes)) { needRest = true; needRestWhy = 'list:shape'; if (!firstRestCause) firstRestCause = { message: 'graphql: missing issues.nodes' }; break }
      for (const n of issues.nodes) {
        seenIssues += 1
        try { all.push(normalizeIssue(n)) } catch { droppedIssues += 1 }
      }
      const pageInfo = issues.pageInfo
      if (pageInfo && pageInfo.hasNextPage) after = pageInfo.endCursor
      else hasNext = false
      // 安全上限：最多 500 条。到顶就 break，并把「被截断过」记在 `issuesTruncated` 上（收尾时记一行降级）。
      if (all.length >= 500) { issuesTruncated = true; break }
    }
    if (!needRest) {
      // 拉取请求主路（同池合并：GraphQL issues 不含拉取请求，直接拼接；限流/超时走下方同一兜底）
      let prAfter = null
      let prHasNext = true
      while (prHasNext) {
        const args = ['api', 'graphql', '-f', `query=${LIST_PR_QUERY}`, '-F', `owner=${parsed.owner}`, '-F', `name=${parsed.name}`, '-F', `first=100`]
        if (prAfter) args.push('-F', `after=${prAfter}`)
        else args.push('-F', 'after=')
        const r = await c.execGh(args, { cwd: ctx && ctx.cwd, via: 'list.pr' })
        if (!r.ok) { needRest = true; if (!firstRestCause) firstRestCause = (r && r.error) || r; break }
        let j
        try { j = JSON.parse(r.data.stdout || '') } catch (e) { needRest = true; if (!firstRestCause) firstRestCause = e; break }
        if (j.errors) { needRest = true; if (!firstRestCause) firstRestCause = { message: JSON.stringify(j.errors).slice(0, 800) }; break }
        const repoData = j.data && j.data.repository
        if (!repoData) { needRest = true; if (!firstRestCause) firstRestCause = { message: 'graphql: missing repository' }; break }
        const prs = repoData.pullRequests
        if (!prs || !Array.isArray(prs.nodes)) { needRest = true; if (!firstRestCause) firstRestCause = { message: 'graphql: missing pullRequests.nodes' }; break }
        for (const n of prs.nodes) {
          seenPulls += 1
          try { all.push(normalizeIssue(n)) } catch { droppedPulls += 1 }
        }
        const pageInfo = prs.pageInfo
        if (pageInfo && pageInfo.hasNextPage) prAfter = pageInfo.endCursor
        else prHasNext = false
        if (all.length >= 1000) { prTruncated = true; break }
      }
    }
    if (!needRest) {
      if (droppedIssues) emitBadNodes(ctx, 'issues', droppedIssues, seenIssues)
      if (droppedPulls) emitBadNodes(ctx, 'pulls', droppedPulls, seenPulls)
    }
    if (needRest) {
      // 降级这一趟先记一行：从入口到这里花了多久、主路是折在哪一步（回包坏 / 缺东西 / 起不了进程）。
      emitReadDegraded(ctx, 'list', String(needRestWhy), Date.now() - tList)
      // 双路兜底：GraphQL 不可用（unexpected EOF / 配额 / 形状差异）→ REST 分页 + pulls 富化 + sub_issues 树边修复。
      // 企业版（GHE）走同一 gh 命令（GH_HOST 由环境变量给 gh），失败按错误归一诚实返回，不另分支。
      // #734：原因只算一次并随 fallback 交出去 —— 界面按它选句（只有 quota 才说配额耗尽）。
      //   日志里那两行仍由 emitRestFallback 落细原因（timeout / rate-limit / ghe-host / graphql-error，
      //   字段与附录不变）；快照里只放粗原因三档（quota / other / 未知=null），不真耗尽不许说耗尽。
      const fbReason = pickFallbackReason(firstRestCause, ctx)
      const fbCause = (fbReason === 'rate-limit' ? 'quota' : 'other')
      emitRestFallback(ctx, '地图', Date.now() - t0, fbReason)
      const rest = await fetchAllIssuesREST(parsed, ctx)
      if (!rest.ok) return { ok: false, error: rest.error }
      const pulls = await fetchAllPullsREST(parsed, ctx)
      const raws = enrichRestPRs(rest.data, pulls.ok ? pulls.data : [])
      const rawFixed = await repairParentLinksREST(raws, parsed, ctx)
      // 为什么断言：修树边返回的还是原来那份数组（原样回传）；断言只为过编译，迭代的还是原来那份值，运行时不变。
      const rawList = rawFixed as unknown[];
      const restNorm: Issue[] = []
      let droppedRest = 0
      for (const n of rawList) {
        try { restNorm.push(normalizeIssue(n)) } catch { droppedRest += 1 }
      }
      if (droppedRest) emitBadNodes(ctx, 'rest', droppedRest, rawList.length)
      // REST 这一路自己也可能撞上尾页失败（那时它按已得数据回成功）：这里再记一行，把「少了几条」说清楚。
      if (!restNorm.length) emitReadDegraded(ctx, 'list', 'list:page-fail', Date.now() - tList)
      // #715：这一趟真的掉到 REST 通道了，把这件事如实带给调用方（`fallback: 'rest'`）——
      //   宿主快照组装处据此在快照上写下降级标记，界面那一侧只读不写（面板上那句「已切 REST 通道」的
      //   横幅本来就画好了，缺的一直是这个上游事实）。
      // #734：同时带上 `fallbackReason`（quota = 真配额耗尽，other = 其它原因走了 REST；
      //   未知由调用方缺失表示为 null）。界面新鲜时只有 quota 才说「配额耗尽」，other 与未知一律
      //   说中性那句，一个字不许提配额。旧判据 isRateLimitError 一处不动（裸 403 照旧走老路）。
      // REST 这条路自己可能撞上尾页失败，完整性判不了：名册保守按「不完整」收下，不拿子集当全集（#1304）。
      try { if (ctx && ctx.memo) rosterAdoptList(ctx.memo, restNorm, filter, { complete: false }) } catch (eU) {}
      return { ok: true, data: applyIssueFilter(restNorm, filter), fallback: 'rest', fallbackReason: fbCause }
    }
    // 上限截断要能从日志里看出来：工单那条一到 500 就 break、拉取请求那条到 1000 才 break，
    // 两条都是「回成功、只装了一部分」。
    if (issuesTruncated || prTruncated) emitReadDegraded(ctx, 'list', 'list:partial', Date.now() - tList)
    // 截断过的列表不能当「完整名册」收下（#1304）：否则下一次读依赖会拿一份少了一半票的索引去算「谁被阻塞」，
    // 少掉的边看起来就像「没人阻塞它」。这里把「不全」这件事同时交给名册与调用方。
    const truncated = issuesTruncated || prTruncated
    try { if (ctx && ctx.memo) rosterAdoptList(ctx.memo, all, filter, { complete: !truncated }) } catch (eU) {}
    return { ok: true, data: applyIssueFilter(all, filter), truncated: truncated }
  } catch (e) {
    // 判档只走本房唯一的出口（`ghVerdictOf`）：档位由规则表判、话术按票面实现决定第 11 条挑。
    // 第三段把出错的那个值原样交出去当原文（合并、遮蔽、截断由 `fail` 统一做）。
    const verdict = ghVerdictOf(e, ctx)
    emitReadDegraded(ctx, 'list', 'list:transport', Date.now() - tList)
    return fail(verdict.kind, ghFailureMessage(verdict, caughtMessage(e, 800)), e)
  }
}

/**
 * get(repo, key, opts, ctx) -> OpResult<Issue>
 */
export async function getIssue(repo: RepositoryRef, key: string, opts: GetOpts | undefined, ctx: MemoContext): Promise<OpResult<Issue>> {
  // 这一笔的起点：本函数每一行降级日志都带「从入口到这里花了多久」。
  const tGet = Date.now()
  try {
    const parsed = parseRepo(repo)
    if (!parsed) {
      emitReadDegraded(ctx, 'get', 'get:repo-ref', Date.now() - tGet)
      return fail(ERROR_KIND.NOTFOUND, `get: repo.refId missing: ${repoId(repo)}`, repo)
    }
    const k = String(key || '').trim()
    if (!k) return fail(ERROR_KIND.PARSE, 'get: key required (string)', key)
    const num = Number(k)
    // 说「这个编号不是数字」的原文就是调用方传进来的那个值本身（原样交出去，别只放进话里）。
    if (!Number.isFinite(num)) return fail(ERROR_KIND.PARSE, `get: key must be numeric for github: ${k}`, String(k))
    const c = ghClient(ctx)
    const t0 = Date.now()
    const query = GET_QUERY
    const args = ['api', 'graphql', '-f', `query=${query}`, '-F', `owner=${parsed.owner}`, '-F', `name=${parsed.name}`, '-F', `number=${num}`]
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd, via: 'get.gql' })
    let issueFromGraphQL = null
    // 为什么标成未知：这里装的是「第一现场的失败样子」（gh 的失败或抛出的值），形状不固定，只负责往下传、不解读。
    let getCause: unknown = (!r.ok ? ((r && r.error) || r) : null)
    if (r.ok) {
      const text = r.data.stdout || ''
      let j
      try { j = JSON.parse(text) } catch (e) {
        emitReadDegraded(ctx, 'get', 'get:json', Date.now() - tGet)
        return fail(ERROR_KIND.PARSE, `get: invalid json ${caughtMessage(e, 200)}`, text)
      }
      if (j.errors) {
        const msg = JSON.stringify(j.errors).slice(0, 800)
        const verdict = ghVerdictOf({ message: msg, stderr: msg }, ctx)
        // 不是配额/网络类的那一类直接如实失败：原文用 GraphQL 回给的那份错误清单，人自己看得见。
        if (!/rate limit|forbidden|unexpected|network|eof/i.test(msg)) {
          emitReadDegraded(ctx, 'get', 'get:gql-err', Date.now() - tGet)
          return fail(verdict.kind, ghFailureMessage(verdict, msg), { message: msg, stderr: msg })
        }
        // 配额/网络类 GraphQL 错误 → 走 REST 降级（下方单条 REST 通道）
        getCause = { message: msg, stderr: msg }
      } else {
        issueFromGraphQL = j.data && j.data.repository && j.data.repository.issue
      }
    }
    let prFromGraphQL = null
    if (!issueFromGraphQL && r.ok) {
      // 单票按号先查工单、再查拉取请求（同号只有一类，查到即停；传输失败则直走 REST）
      try {
        const prArgs = ['api', 'graphql', '-f', `query=${GET_PR_QUERY}`, '-F', `owner=${parsed.owner}`, '-F', `name=${parsed.name}`, '-F', `number=${num}`]
        // 同一号先查工单、再查拉取请求：这一支就是「工单没查着、改查拉取请求」的那一步。
        const pr = await c.execGh(prArgs, { cwd: ctx && ctx.cwd, via: 'get.pr' })
        if (pr.ok) {
          const pj = JSON.parse(pr.data.stdout || 'null')
          if (pj && !pj.errors && pj.data && pj.data.repository) prFromGraphQL = pj.data.repository.pullRequest
        }
      } catch {}
    }
    if (prFromGraphQL) {
      let prNorm = normalizeIssue(prFromGraphQL)
      if (opts && opts.comments && typeof opts.comments.first === 'number' && prNorm.comments && prNorm.comments.length > opts.comments.first) {
        prNorm.comments = prNorm.comments.slice(0, opts.comments.first)
      }
      try { if (ctx && ctx.memo) rosterUpsert(ctx.memo, prNorm) } catch (eU) {}
      return { ok: true, data: prNorm }
    }
    if (!issueFromGraphQL) {
      // REST 降级（与 list 同一背景：GraphQL POST 偶发 unexpected EOF，REST 稳定；原因分类与列表同口径，不恒写 graphql-error）
      // 为什么用收窄式：r 在这里可能是成功也可能是失败，直接读 error 编译器不认；失败分支读 error、成功分支用 r 本身，与原来短路式的取值一字不差。
      emitRestFallback(ctx, '单票', Date.now() - t0, pickFallbackReason(getCause || (!r.ok ? r.error : r), ctx))
      emitReadDegraded(ctx, 'get', 'get:degraded', Date.now() - tGet)
      const rr = await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/issues/${num}`], { cwd: ctx && ctx.cwd, via: 'get.rest' })
      if (rr.ok) {
        let jr = null
        try { jr = JSON.parse(rr.data.stdout || '') } catch (e) {
          emitReadDegraded(ctx, 'get', 'get:rest-json', Date.now() - tGet)
          return fail(ERROR_KIND.PARSE, `get(rest): invalid json ${caughtMessage(e, 200)}`, rr.data.stdout)
        }
        if (jr && typeof jr === 'object' && jr.number != null) {
          if (jr.pull_request != null) await enrichSinglePR(jr, parsed, ctx)
          try { if (ctx && ctx.memo) rosterUpsert(ctx.memo, jr) } catch (eU) {}
          return { ok: true, data: normalizeIssue(jr) }
        }
        // /issues 回的这份东西没有 number，不像一张票：降级路走了一半、形状不认，如实记一行再退到 /pulls。
        emitReadDegraded(ctx, 'get', 'get:shape', Date.now() - tGet)
      }
      // /issues 不中（404 或坏形状）→ 试 /pulls 直取拉取请求单票
      const prr = await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/pulls/${num}`], { cwd: ctx && ctx.cwd, via: 'get.rest-pr' })
      if (prr.ok) {
        let prj = null
        try { prj = JSON.parse(prr.data.stdout || '') } catch (e) {
          emitReadDegraded(ctx, 'get', 'get:rest-json', Date.now() - tGet)
          return fail(ERROR_KIND.PARSE, `get(rest): invalid json ${caughtMessage(e, 200)}`, prr.data.stdout)
        }
        if (prj && typeof prj === 'object' && prj.number != null) {
          await enrichSinglePR(prj, parsed, ctx)
          try { if (ctx && ctx.memo) rosterUpsert(ctx.memo, prj) } catch (eU) {}
          return { ok: true, data: normalizeIssue(prj) }
        }
        // 原文交这次 /pulls 回包本身：形状里既没有 number，也就没有能当票看的东西。
        return fail(ERROR_KIND.NOTFOUND, `get: issue ${k} not found`, prr.data.stdout)
      }
      if (!r.ok) return { ok: false, error: r.error }
      return { ok: false, error: (!rr.ok ? rr.error : prr.error) }
    }
    const issue = issueFromGraphQL
    // 若 opts.comments 带分页，追加抓取更多评论页（此处简化：若 hasNextPage 则额外 fetch 并合并）
    let normalized = normalizeIssue(issue)
    // 若 comments 仍有后续页且调用方要求分页，可在此按 opts.comments.first 截断/追加（契约允许宿主侧分页）
    if (opts && opts.comments && typeof opts.comments.first === 'number' && normalized.comments && normalized.comments.length > opts.comments.first) {
      normalized.comments = normalized.comments.slice(0, opts.comments.first)
    }
    try { if (ctx && ctx.memo) rosterUpsert(ctx.memo, normalized) } catch (eU) {}
    return { ok: true, data: normalized }
  } catch (e) {
    // 判档只走本房唯一的出口（`ghVerdictOf`）：档位由规则表判、话术按票面实现决定第 11 条挑。
    // 第三段把出错的那个值原样交出去当原文（合并、遮蔽、截断由 `fail` 统一做）。
    const verdict = ghVerdictOf(e, ctx)
    emitReadDegraded(ctx, 'get', 'get:transport', Date.now() - tGet)
    return fail(verdict.kind, ghFailureMessage(verdict, caughtMessage(e, 800)), e)
  }
}

export default { listIssues, getIssue };
