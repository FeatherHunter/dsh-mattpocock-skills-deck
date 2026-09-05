/**
 * backends/github/issues.js — issue 读路径（list / get + REST 降级 + 内存过滤）。
 *
 * #440 拆分后：写路径见 issues-write.js。parseRepo / repoId 导出供写路径共享。
 * 以后改查询与降级逻辑的人改它。预估约 230 行。
 *
 * 定版依据：#138 一页纸方案，contract.js 操作签名归一。
 * 所有 op 返回 OpResult，不 throw；错误经 classifyGhError 归一。
 */

import { STATE, ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { fail } from '../../preflight.js'
import { ghClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { classifyGhError } from './errors.js'
import { LIST_QUERY, GET_QUERY } from './queries.js'

// 房内埋点（#494 O1）：GraphQL→REST 降级分支落同名事件 graphql.fallback（#8 告警）与 issues.fallback（#9 常驻），字段按 #489 附录 1.4。
// 常驻直发（无外层开关判断，库体内兜底）；无 ctx.logEvent 时静默跳过；只记通道名与原因枚举，不记响应原文。
function emitRestFallback(ctx, scope) {
  try {
    const f = ctx && typeof ctx.logEvent === 'function' ? ctx.logEvent : null
    if (!f) return
    f('warn', 'graphql.fallback', { scope, reason: 'graphql-error' })
    f('info', 'issues.fallback', { from: 'graphql', to: 'rest', reason: 'graphql-error' })
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
    const all = []
    let after = null
    let hasNext = true
    let needRest = false
    // 分页先取 100，超量分页
    while (hasNext) {
      // 构造带变量查询：gh api graphql -f query -F owner -F name -F first -F after
      const query = LIST_QUERY
      const args = ['api', 'graphql', '-f', `query=${query}`, '-F', `owner=${parsed.owner}`, '-F', `name=${parsed.name}`, '-F', `first=100`]
      if (after) args.push('-F', `after=${after}`)
      else args.push('-F', 'after=')
      const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
      if (!r.ok) { needRest = true; break }
      const text = r.data.stdout || ''
      let j
      try { j = JSON.parse(text) } catch (e) { needRest = true; break }
      if (j.errors) { needRest = true; break }
      const repoData = j.data && j.data.repository
      if (!repoData) { needRest = true; break }
      const issues = repoData.issues
      if (!issues || !Array.isArray(issues.nodes)) { needRest = true; break }
      for (const n of issues.nodes) {
        try { all.push(normalizeIssue(n)) } catch {}
      }
      const pageInfo = issues.pageInfo
      if (pageInfo && pageInfo.hasNextPage) after = pageInfo.endCursor
      else hasNext = false
      // 安全上限：最多 500 条
      if (all.length >= 500) break
    }
    if (needRest) {
      // 双路兜底：GraphQL 不可用（unexpected EOF / 配额 / 形状差异）→ REST 单页分页 + sub_issues 树边修复
      emitRestFallback(ctx, '地图')
      const rest = await fetchAllIssuesREST(parsed, ctx)
      if (!rest.ok) return { ok: false, error: rest.error }
      const rawFixed = await repairParentLinksREST(rest.data, parsed, ctx)
      const restNorm = []
      for (const n of rawFixed) {
        try { restNorm.push(normalizeIssue(n)) } catch {}
      }
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
    const query = GET_QUERY
    const args = ['api', 'graphql', '-f', `query=${query}`, '-F', `owner=${parsed.owner}`, '-F', `name=${parsed.name}`, '-F', `number=${num}`]
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
    let issueFromGraphQL = null
    if (r.ok) {
      const text = r.data.stdout || ''
      let j
      try { j = JSON.parse(text) } catch (e) { return fail(ERROR_KIND.PARSE, `get: invalid json ${String(e.message).slice(0, 200)}`) }
      if (j.errors) {
        const msg = JSON.stringify(j.errors).slice(0, 800)
        const kind = classifyGhError({ message: msg, stderr: msg }, ctx)
        if (!/rate limit|forbidden|unexpected|network|eof/i.test(msg)) return fail(kind, msg)
        // 配额/网络类 GraphQL 错误 → 走 REST 降级（下方单条 REST 通道）
      } else {
        issueFromGraphQL = j.data && j.data.repository && j.data.repository.issue
      }
    }
    if (!issueFromGraphQL) {
      // REST 降级（与 list 同一背景：GraphQL POST 偶发 unexpected EOF，REST 稳定）
      emitRestFallback(ctx, '单票')
      const rr = await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/issues/${num}`], { cwd: ctx && ctx.cwd })
      if (!rr.ok) return { ok: false, error: r.ok ? rr.error : r.error }
      let jr
      try { jr = JSON.parse(rr.data.stdout || '') } catch (e) { return fail(ERROR_KIND.PARSE, `get(rest): invalid json ${String(e.message).slice(0, 200)}`) }
      if (!jr || typeof jr !== 'object' || jr.number == null) return fail(ERROR_KIND.NOTFOUND, `get: issue ${k} not found`)
      const normalized = normalizeIssue(jr)
      return { ok: true, data: normalized }
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
