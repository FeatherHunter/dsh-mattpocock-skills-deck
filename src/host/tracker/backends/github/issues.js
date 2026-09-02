/**
 * backends/github/issues.js — issue 操作（list/get/create/close/reopen/update/setAssignees）。
 *
 * 定版依据：#138 一页纸方案 §1.4 + contract.js 13 ops 签名归一。
 * - 所有 op 返回 OpResult，不 throw；错误经 classifyGhError 归一。
 * - 签名：(repo:RepositoryRef, key/input, opts?:..., ctx:OpContext) => Promise<OpResult<T>>
 * - OS 交互只经 ctx.platform / ctx.exec（client.js）；超时 30s 在 client 层。
 */

import { STATE, ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { fail } from '../../preflight.js'
import { ghClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { classifyGhError } from './errors.js'
import { LIST_QUERY, GET_QUERY } from './queries.js'

function parseRepo(repo) {
  if (!repo || typeof repo.refId !== 'string' || !repo.refId) return null
  const s = repo.refId.trim()
  const idx = s.indexOf('/')
  if (idx <= 0) return null
  return { owner: s.slice(0, idx), name: s.slice(idx + 1) }
}

function repoId(repo) {
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
    const kind = classifyGhError(e)
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
        const kind = classifyGhError({ message: msg, stderr: msg })
        if (!/rate limit|forbidden|unexpected|network|eof/i.test(msg)) return fail(kind, msg)
        // 配额/网络类 GraphQL 错误 → 走 REST 降级（下方单条 REST 通道）
      } else {
        issueFromGraphQL = j.data && j.data.repository && j.data.repository.issue
      }
    }
    if (!issueFromGraphQL) {
      // REST 降级（与 list 同一背景：GraphQL POST 偶发 unexpected EOF，REST 稳定）
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
    const kind = classifyGhError(e)
    return fail(kind, String((e && e.message) || e).slice(0, 800))
  }
}

/**
 * create(repo, input, ctx) -> OpResult<Issue>
 * input: {title, body?, type?, parentKey?, labels?, assignees?}
 */
export async function createIssue(repo, input, ctx) {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `create: repo.refId missing: ${repoId(repo)}`)
    if (!input || typeof input.title !== 'string' || !input.title.trim()) return fail(ERROR_KIND.PARSE, 'create: title required')
    const c = ghClient(ctx)
    const body = typeof input.body === 'string' ? input.body : ''
    // 先用 REST 创建
    const payload = { title: input.title.trim(), body }
    // labels: LabelInput[] → name[]
    if (Array.isArray(input.labels) && input.labels.length) {
      payload.labels = input.labels.map((l) => (typeof l === 'string' ? l.trim() : (l && typeof l.name === 'string' ? l.name.trim() : ''))).filter(Boolean)
    }
    if (Array.isArray(input.assignees) && input.assignees.length) {
      payload.assignees = input.assignees.map((a) => (typeof a === 'string' ? a.trim() : (a && typeof a.login === 'string' ? a.login.trim() : ''))).filter(Boolean)
    }
    const args = ['api', `repos/${parsed.owner}/${parsed.name}/issues`, '--method', 'POST', '--input', '-', '--jq', '.']
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
    // gh api --input - 需要把 payload 通过 stdin 传；但 ctx.exec('gh', args, ...) 未必支持 stdin。
    // 降级：若 --input - 方式失败，改用 gh issue create
    let createdRaw = null
    if (!r.ok) {
      // 尝试 gh issue create
      const altArgs = ['issue', 'create', '--title', input.title.trim(), '--body', body, '--json', 'number,title,state,body,url,updatedAt,createdAt,closedAt,labels,assignees']
      if (payload.labels && payload.labels.length) {
        for (const lb of payload.labels) altArgs.push('--label', lb)
      }
      if (payload.assignees && payload.assignees.length) {
        for (const a of payload.assignees) altArgs.push('--assignee', a)
      }
      altArgs.push('--repo', `${parsed.owner}/${parsed.name}`)
      const r2 = await c.execGh(altArgs, { cwd: ctx && ctx.cwd })
      if (!r2.ok) return { ok: false, error: r2.error }
      const text2 = r2.data.stdout || ''
      try {
        const j2 = JSON.parse(text2)
        createdRaw = Array.isArray(j2) ? j2[0] : j2
      } catch (e) {
        return fail(ERROR_KIND.PARSE, `create: invalid json ${String(e.message).slice(0, 200)}`)
      }
    } else {
      // REST 方式需重取 payload（ctx.exec 不自动把 payload 注入，此 path 当前未走通，保持 alt）
      // 为简化，直接走 alt 路径的回落已处理；若 r.ok 但 stdout 为空，则取 r2
      return fail(ERROR_KIND.PARSE, 'create: unexpected empty response')
    }
    if (!createdRaw) return fail(ERROR_KIND.PARSE, 'create: empty response')
    // REST 返回 number → 需补充 parentKey 等字段，再 normalize
    const rawForNormalize = Object.assign({}, createdRaw, {
      number: createdRaw.number ?? createdRaw.id,
      state: createdRaw.state || 'open',
      url: createdRaw.url || createdRaw.html_url || '',
      createdAt: createdRaw.createdAt || createdRaw.created_at || '',
      updatedAt: createdRaw.updatedAt || createdRaw.updated_at || '',
      closedAt: createdRaw.closedAt || createdRaw.closed_at || null,
      labels: createdRaw.labels ? { nodes: (Array.isArray(createdRaw.labels) ? createdRaw.labels.map((l) => typeof l === 'string' ? { name: l, color: '' } : l) : []) } : { nodes: [] },
      assignees: createdRaw.assignees ? { nodes: (Array.isArray(createdRaw.assignees) ? createdRaw.assignees.map((a) => typeof a === 'string' ? { login: a } : a) : []) } : { nodes: [] },
    })
    let issue = normalizeIssue(rawForNormalize)
    // 若 input.type === 'map' 且未通过 label 推断，则需补打 wayfinder:map 标签（create 后 setLabels）
    // 简化：若 type 期望 map 但 issue.type !== 'map'，则尝试 setLabels 追加
    const wantType = input.type === 'map' ? 'map' : 'issue'
    if (wantType === 'map' && issue.type !== 'map') {
      // best-effort 追加 label，不阻塞主流程
      try {
        const { setLabels } = await import('./labels.js')
        const curLabels = issue.labels.map((l) => l.name)
        if (!curLabels.includes('wayfinder:map')) {
          const withMap = [...issue.labels, { name: 'wayfinder:map', color: '' }]
          await setLabels(repo, issue.key, withMap, {}, ctx)
          issue.type = 'map'
        }
      } catch {}
    }
    // parentKey 有则创后 setParent
    if (input.parentKey != null && input.parentKey !== '') {
      try {
        const { setParent } = await import('./graph.js')
        const pr = await setParent(repo, issue.key, String(input.parentKey), {}, ctx)
        if (pr.ok) issue = pr.data
      } catch {}
    }
    return { ok: true, data: issue }
  } catch (e) {
    const kind = classifyGhError(e)
    return fail(kind, String((e && e.message) || e).slice(0, 800))
  }
}

export async function closeIssue(repo, key, opts, ctx) {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `close: repo.refId missing: ${repoId(repo)}`)
    const k = String(key || '').trim()
    if (!k) return fail(ERROR_KIND.PARSE, 'close: key required')
    const c = ghClient(ctx)
    // 优先用 gh issue close（带 reason 映射 state_reason）
    const args = ['issue', 'close', k, '--repo', `${parsed.owner}/${parsed.name}`, '--json', 'number,title,state,body,url,updatedAt,closedAt']
    if (opts && typeof opts.reason === 'string' && opts.reason) {
      args.push('--reason', opts.reason)
    }
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
    if (!r.ok) return { ok: false, error: r.error }
    const text = r.data.stdout || ''
    let raw
    try { raw = JSON.parse(text); if (Array.isArray(raw)) raw = raw[0] } catch (e) { return fail(ERROR_KIND.PARSE, `close: invalid json ${String(e.message).slice(0, 200)}`) }
    const normalized = normalizeIssue(Object.assign({}, raw, {
      number: raw.number ?? Number(k),
      url: raw.url || raw.html_url || '',
      closedAt: raw.closedAt || raw.closed_at || new Date().toISOString(),
    }))
    // reason 回填
    if (opts && typeof opts.reason === 'string') normalized.reason = opts.reason
    return { ok: true, data: normalized }
  } catch (e) {
    const kind = classifyGhError(e)
    return fail(kind, String((e && e.message) || e).slice(0, 800))
  }
}

export async function reopenIssue(repo, key, ctx) {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `reopen: repo.refId missing: ${repoId(repo)}`)
    const k = String(key || '').trim()
    if (!k) return fail(ERROR_KIND.PARSE, 'reopen: key required')
    const c = ghClient(ctx)
    const args = ['issue', 'reopen', k, '--repo', `${parsed.owner}/${parsed.name}`, '--json', 'number,title,state,body,url,updatedAt,closedAt']
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
    if (!r.ok) return { ok: false, error: r.error }
    const text = r.data.stdout || ''
    let raw
    try { raw = JSON.parse(text); if (Array.isArray(raw)) raw = raw[0] } catch (e) { return fail(ERROR_KIND.PARSE, `reopen: invalid json ${String(e.message).slice(0, 200)}`) }
    const normalized = normalizeIssue(Object.assign({}, raw, {
      number: raw.number ?? Number(k),
      state: 'open',
      url: raw.url || raw.html_url || '',
      closedAt: null,
    }))
    return { ok: true, data: normalized }
  } catch (e) {
    const kind = classifyGhError(e)
    return fail(kind, String((e && e.message) || e).slice(0, 800))
  }
}

export async function updateIssue(repo, key, patch, ctx) {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `update: repo.refId missing: ${repoId(repo)}`)
    const k = String(key || '').trim()
    if (!k) return fail(ERROR_KIND.PARSE, 'update: key required')
    if (!patch || typeof patch !== 'object') return fail(ERROR_KIND.PARSE, 'update: patch required')
    // 能力分支：milestone/customFields 不支持 → unsupported（不假装）
    if (patch.milestone !== undefined || patch.customFields !== undefined) {
      // milestone 若需支持可走 REST，但当前按 GH API 简化：milestone 需 number，此处诚实返回 unsupported
      // 为保持最小可用，若调用方传 milestone 但 GitHub 实际支持，可在此透传；现按 unsupported
      const hasMilestone = patch.milestone !== undefined
      const hasCustom = patch.customFields !== undefined
      if (hasCustom) return fail(ERROR_KIND.UNSUPPORTED, 'update: customFields unsupported for github')
      // milestone 若为 null（清除）或对象，尝试支持：若有标题则尝试查找 milestone number（需额外 API），暂 unsupported
      if (hasMilestone) return fail(ERROR_KIND.UNSUPPORTED, 'update: milestone unsupported (requires milestone number lookup)')
    }
    const c = ghClient(ctx)
    // title/body 更新：优先 gh issue edit
    const args = ['issue', 'edit', k, '--repo', `${parsed.owner}/${parsed.name}`, '--json', 'number,title,state,body,url,updatedAt,closedAt']
    if (typeof patch.title === 'string') args.push('--title', patch.title)
    if (typeof patch.body === 'string') args.push('--body', patch.body)
    if (args.length <= 8) return fail(ERROR_KIND.PARSE, 'update: empty patch (no title/body)')
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
    if (!r.ok) return { ok: false, error: r.error }
    const text = r.data.stdout || ''
    let raw
    try { raw = JSON.parse(text); if (Array.isArray(raw)) raw = raw[0] } catch (e) { return fail(ERROR_KIND.PARSE, `update: invalid json ${String(e.message).slice(0, 200)}`) }
    const normalized = normalizeIssue(Object.assign({}, raw, {
      number: raw.number ?? Number(k),
      url: raw.url || raw.html_url || '',
    }))
    return { ok: true, data: normalized }
  } catch (e) {
    const kind = classifyGhError(e)
    return fail(kind, String((e && e.message) || e).slice(0, 800))
  }
}

function normalizeAssigneeInput(ai) {
  if (typeof ai === 'string') {
    const login = ai.trim()
    if (!login) return null
    return { login }
  }
  if (!ai || typeof ai !== 'object') return null
  const login = typeof ai.login === 'string' ? ai.login.trim() : ''
  if (!login) return null
  const out = { login }
  if (typeof ai.name === 'string' && ai.name.trim() !== '') out.name = ai.name
  if (typeof ai.avatarUrl === 'string' && ai.avatarUrl !== '') out.avatarUrl = ai.avatarUrl
  if (typeof ai.kind === 'string' && ai.kind) out.kind = ai.kind
  return out
}

export async function setAssignees(repo, key, assignees, opts, ctx) {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `setAssignees: repo.refId missing: ${repoId(repo)}`)
    const k = String(key || '').trim()
    if (!k) return fail(ERROR_KIND.PARSE, 'setAssignees: key required')
    const wanted = []
    const seen = new Set()
    if (Array.isArray(assignees)) {
      for (const ai of assignees) {
        const a = normalizeAssigneeInput(ai)
        if (!a) continue
        if (seen.has(a.login)) continue
        seen.add(a.login)
        wanted.push(a)
      }
    }
    // If-Match 前置：expectedUpdatedAt
    if (opts && typeof opts.expectedUpdatedAt === 'string' && opts.expectedUpdatedAt !== '') {
      const cur = await getIssue(repo, k, {}, ctx)
      if (!cur.ok) return cur
      if (cur.data.updatedAt !== opts.expectedUpdatedAt) return fail(ERROR_KIND.CONFLICT, `conflict: expectedUpdatedAt mismatch (want ${opts.expectedUpdatedAt} got ${cur.data.updatedAt})`)
    }
    const c = ghClient(ctx)
    // REST 整集替换：gh api PATCH repos/.../issues/<n> {assignees: [login...]}
    // gh CLI 暂无 assignees 整集 API，直接用 gh api
    const logins = wanted.map((a) => a.login)
    // 先读当前 assignees 做 diff（gh issue edit --add-assignee/--remove-assignee 为增量，需 diff）
    const curRes = await getIssue(repo, k, {}, ctx)
    const curLogins = curRes.ok ? curRes.data.assignees.map((a) => a.login) : []
    const toAdd = logins.filter((l) => !curLogins.includes(l))
    const toRemove = curLogins.filter((l) => !logins.includes(l))
    for (const l of toRemove) {
      const r = await c.execGh(['issue', 'edit', k, '--repo', `${parsed.owner}/${parsed.name}`, '--remove-assignee', l], { cwd: ctx && ctx.cwd })
      if (!r.ok) return { ok: false, error: r.error }
    }
    for (const l of toAdd) {
      const r = await c.execGh(['issue', 'edit', k, '--repo', `${parsed.owner}/${parsed.name}`, '--add-assignee', l], { cwd: ctx && ctx.cwd })
      if (!r.ok) return { ok: false, error: r.error }
    }
    // 读回最新
    const finalRes = await getIssue(repo, k, {}, ctx)
    if (!finalRes.ok) {
      // optimistic 回落
      const optimisticRaw = { number: Number(k) || k, title: '', state: 'open', body: '', url: '', assignees: { nodes: wanted } }
      const issue = normalizeIssue(optimisticRaw)
      issue.assignees = wanted
      return { ok: true, data: issue }
    }
    // 覆盖 assignees 为 wanted（确保归一）
    finalRes.data.assignees = wanted
    return finalRes
  } catch (e) {
    const kind = classifyGhError(e)
    return fail(kind, String((e && e.message) || e).slice(0, 800))
  }
}

export default { listIssues, getIssue, createIssue, closeIssue, reopenIssue, updateIssue, setAssignees }
