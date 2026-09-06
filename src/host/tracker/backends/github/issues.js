/**
 * backends/github/issues.js — issue 读路径（list / get + REST 降级 + 内存过滤）。
 *
 * #440 拆分后：写路径见 issues-write.js。parseRepo / repoId 导出供写路径共享。
 * #504：拉取请求主路（GraphQL 双查询同池）+ REST 帮手见 pulls.js（单文件 350 行纪律）。
 *
 * 定版依据：#138 一页纸方案，contract.js 操作签名归一。
 * 所有 op 返回 OpResult，不 throw；错误经 classifyGhError 归一。
 */

import { STATE, ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { fail } from '../../preflight.js'
import { ghClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { classifyGhError } from './errors.js'
import { LIST_QUERY, GET_QUERY, LIST_PR_QUERY, GET_PR_QUERY } from './queries.js'
import { fetchAllPullsREST, enrichRestPRs, enrichSinglePR } from './pulls.js'
import { pickFallbackReason } from './fallback-reason.js'

// 房内埋点（#494 O1）：GraphQL→REST 降级分支落同名事件 graphql.fallback（#8 告警）与 issues.fallback（#9 常驻）+ fallback.chain（#42 常驻），字段按 #489 附录 1.4。
// 常驻直发（无外层开关判断，库体内兜底）；无 ctx.logEvent 时静默跳过；只记通道名与原因枚举，不记响应原文。
// 降级原因分类（#504 雾证据补强）：细分原因实现见 fallback-reason.js（房内拆文件不拆房），此处只留落点。
// 超时 → timeout；限流 → rate-limit；企业版主机 → ghe-host；其余 → graphql-error；只复用现有事件名与字段，附录不动。
function emitRestFallback(ctx, scope, latencyMs, reason) {
  try {
    const f = ctx && typeof ctx.logEvent === 'function' ? ctx.logEvent : null
    if (!f) return
    const r = typeof reason === 'string' && reason ? reason : 'graphql-error'
    f('warn', 'graphql.fallback', { scope, reason: r })
    f('info', 'issues.fallback', { from: 'graphql', to: 'rest', reason: r })
    f('info', 'fallback.chain', { in: 'graphql', out: 'rest', latencyMs: typeof latencyMs === 'number' ? latencyMs : 0 })
  } catch {}
}
// 坏节点计数（#504 可观测）：列表逐票归一失败会丢票，聚合计数后复用 error.normalize 调试事件记一行，不新增事件名，附录不动。
// 高频路径：同行判断调试开关，关闭时不组装字段；只记范围与丢票计数，不记票原文。
function emitBadNodes(ctx, scope, dropped, total) {
  try {
    if (!dropped) return
    if (ctx && typeof ctx.isEnabled === 'function' && ctx.isEnabled('debug') && typeof ctx.logEvent === 'function') ctx.logEvent('debug', 'error.normalize', { rawKind: 'bad-node:' + scope + ':' + dropped + '/' + total, mappedKind: 'parse' })
  } catch {}
}

export function parseRepo(repo) {
  if (!repo || typeof repo.refId !== 'string' || !repo.refId) return null
  const s = repo.refId.trim()
  const idx = s.indexOf('/')
  if (idx <= 0) return null
  return { owner: s.slice(0, idx), name: s.slice(idx + 1) }
}

export function repoId(repo) {
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
async function fetchAllIssuesREST(parsed, ctx) {
  const c = ghClient(ctx)
  const out = []
  const MAX_PAGES = 10
  const PAGE = 100
  for (let p = 1; p <= MAX_PAGES; p++) {
    const r = await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/issues?state=all&per_page=${PAGE}&page=${p}`], { cwd: ctx && ctx.cwd })
    if (!r.ok) {
      if (!out.length) return { ok: false, error: r.error }
      return { ok: true, data: out }
    }
    let j
    try { j = JSON.parse(r.data.stdout || '') } catch (e) {
      if (!out.length) return { ok: false, error: { kind: ERROR_KIND.PARSE, message: `rest fallback: invalid json ${String(e.message).slice(0, 200)}` } }
      return { ok: true, data: out }
    }
    if (!Array.isArray(j)) {
      if (!out.length) return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'rest fallback: non-array response' } }
      return { ok: true, data: out }
    }
    for (const n of j) out.push(n)
    if (j.length < PAGE) break
  }
  return { ok: true, data: out }
}

// 树边修复：找出所有 wayfinder:map 票，逐个拉 /sub_issues，把子票 raw.parent 设为 {number}（normalize 的 deriveParentKey 直接消费）
async function repairParentLinksREST(raws, parsed, ctx) {
  const c = ghClient(ctx)
  const maps = raws.filter((x) => (x && Array.isArray(x.labels) && x.labels.some((l) => l && l.name === 'wayfinder:map')))
  if (!maps.length) return raws
  const childToMap = new Map()
  await Promise.all(maps.map(async (m) => {
    try {
      const r = await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/issues/${m.number}/sub_issues?per_page=100`], { cwd: ctx && ctx.cwd })
      if (!r.ok) return
      let j
      try { j = JSON.parse(r.data.stdout || '') } catch { return }
      if (!Array.isArray(j)) return
      for (const s of j) { if (s && s.number != null) childToMap.set(String(s.number), { number: m.number }) }
    } catch { /* 单 map 子票修复失败不阻塞整体，子树降级为孤儿票（诚实可读） */ }
  }))
  for (const x of raws) {
    const p = childToMap.get(String(x && x.number))
    if (p) x.parent = p
  }
  return raws
}

// 内存过滤（list 两路共用）
function applyIssueFilter(all, filter) {
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
export async function listIssues(repo, filter, ctx) {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `list: repo.refId missing or malformed: ${repoId(repo)}`)
    const c = ghClient(ctx)
    const t0 = Date.now()
    const all = []
    let after = null
    let hasNext = true
    let needRest = false
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
      const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
      if (!r.ok) { needRest = true; if (!firstRestCause) firstRestCause = (r && r.error) || r; break }
      const text = r.data.stdout || ''
      let j
      try { j = JSON.parse(text) } catch (e) { needRest = true; if (!firstRestCause) firstRestCause = e; break }
      if (j.errors) { needRest = true; if (!firstRestCause) firstRestCause = { message: JSON.stringify(j.errors).slice(0, 800) }; break }
      const repoData = j.data && j.data.repository
      if (!repoData) { needRest = true; if (!firstRestCause) firstRestCause = { message: 'graphql: missing repository' }; break }
      const issues = repoData.issues
      if (!issues || !Array.isArray(issues.nodes)) { needRest = true; if (!firstRestCause) firstRestCause = { message: 'graphql: missing issues.nodes' }; break }
      for (const n of issues.nodes) {
        seenIssues += 1
        try { all.push(normalizeIssue(n)) } catch { droppedIssues += 1 }
      }
      const pageInfo = issues.pageInfo
      if (pageInfo && pageInfo.hasNextPage) after = pageInfo.endCursor
      else hasNext = false
      // 安全上限：最多 500 条
      if (all.length >= 500) break
    }
    if (!needRest) {
      // 拉取请求主路（同池合并：GraphQL issues 不含拉取请求，直接拼接；限流/超时走下方同一兜底）
      let prAfter = null
      let prHasNext = true
      while (prHasNext) {
        const args = ['api', 'graphql', '-f', `query=${LIST_PR_QUERY}`, '-F', `owner=${parsed.owner}`, '-F', `name=${parsed.name}`, '-F', `first=100`]
        if (prAfter) args.push('-F', `after=${prAfter}`)
        else args.push('-F', 'after=')
        const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
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
        if (all.length >= 1000) break
      }
    }
    if (!needRest) {
      if (droppedIssues) emitBadNodes(ctx, 'issues', droppedIssues, seenIssues)
      if (droppedPulls) emitBadNodes(ctx, 'pulls', droppedPulls, seenPulls)
    }
    if (needRest) {
      // 双路兜底：GraphQL 不可用（unexpected EOF / 配额 / 形状差异）→ REST 分页 + pulls 富化 + sub_issues 树边修复。
      // 企业版（GHE）走同一 gh 命令（GH_HOST 由环境变量给 gh），失败按错误归一诚实返回，不另分支。
      emitRestFallback(ctx, '地图', Date.now() - t0, pickFallbackReason(firstRestCause, ctx))
      const rest = await fetchAllIssuesREST(parsed, ctx)
      if (!rest.ok) return { ok: false, error: rest.error }
      const pulls = await fetchAllPullsREST(parsed, ctx)
      const raws = enrichRestPRs(rest.data, pulls.ok ? pulls.data : [])
      const rawFixed = await repairParentLinksREST(raws, parsed, ctx)
      const restNorm = []
      let droppedRest = 0
      for (const n of rawFixed) {
        try { restNorm.push(normalizeIssue(n)) } catch { droppedRest += 1 }
      }
      if (droppedRest) emitBadNodes(ctx, 'rest', droppedRest, rawFixed.length)
      return { ok: true, data: applyIssueFilter(restNorm, filter) }
    }
    return { ok: true, data: applyIssueFilter(all, filter) }
  } catch (e) {
    const kind = classifyGhError(e, ctx)
    return fail(kind, String((e && e.message) || e).slice(0, 800))
  }
}

/**
 * get(repo, key, opts, ctx) -> OpResult<Issue>
 */
export async function getIssue(repo, key, opts, ctx) {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `get: repo.refId missing: ${repoId(repo)}`)
    const k = String(key || '').trim()
    if (!k) return fail(ERROR_KIND.PARSE, 'get: key required (string)')
    const num = Number(k)
    if (!Number.isFinite(num)) return fail(ERROR_KIND.PARSE, `get: key must be numeric for github: ${k}`)
    const c = ghClient(ctx)
    const t0 = Date.now()
    const query = GET_QUERY
    const args = ['api', 'graphql', '-f', `query=${query}`, '-F', `owner=${parsed.owner}`, '-F', `name=${parsed.name}`, '-F', `number=${num}`]
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
    let issueFromGraphQL = null
    let getCause = (!r.ok ? ((r && r.error) || r) : null)
    if (r.ok) {
      const text = r.data.stdout || ''
      let j
      try { j = JSON.parse(text) } catch (e) { return fail(ERROR_KIND.PARSE, `get: invalid json ${String(e.message).slice(0, 200)}`) }
      if (j.errors) {
        const msg = JSON.stringify(j.errors).slice(0, 800)
        const kind = classifyGhError({ message: msg, stderr: msg }, ctx)
        if (!/rate limit|forbidden|unexpected|network|eof/i.test(msg)) return fail(kind, msg)
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
        const pr = await c.execGh(prArgs, { cwd: ctx && ctx.cwd })
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
      return { ok: true, data: prNorm }
    }
    if (!issueFromGraphQL) {
      // REST 降级（与 list 同一背景：GraphQL POST 偶发 unexpected EOF，REST 稳定；原因分类与列表同口径，不恒写 graphql-error）
      emitRestFallback(ctx, '单票', Date.now() - t0, pickFallbackReason(getCause || ((r && r.error) || r), ctx))
      const rr = await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/issues/${num}`], { cwd: ctx && ctx.cwd })
      if (rr.ok) {
        let jr = null
        try { jr = JSON.parse(rr.data.stdout || '') } catch (e) { return fail(ERROR_KIND.PARSE, `get(rest): invalid json ${String(e.message).slice(0, 200)}`) }
        if (jr && typeof jr === 'object' && jr.number != null) {
          if (jr.pull_request != null) await enrichSinglePR(jr, parsed, ctx)
          return { ok: true, data: normalizeIssue(jr) }
        }
      }
      // /issues 不中（404 或坏形状）→ 试 /pulls 直取拉取请求单票
      const prr = await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/pulls/${num}`], { cwd: ctx && ctx.cwd })
      if (prr.ok) {
        let prj = null
        try { prj = JSON.parse(prr.data.stdout || '') } catch (e) { return fail(ERROR_KIND.PARSE, `get(rest): invalid json ${String(e.message).slice(0, 200)}`) }
        if (prj && typeof prj === 'object' && prj.number != null) {
          await enrichSinglePR(prj, parsed, ctx)
          return { ok: true, data: normalizeIssue(prj) }
        }
        return fail(ERROR_KIND.NOTFOUND, `get: issue ${k} not found`)
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
    return { ok: true, data: normalized }
  } catch (e) {
    const kind = classifyGhError(e, ctx)
    return fail(kind, String((e && e.message) || e).slice(0, 800))
  }
}

export default { listIssues, getIssue };
