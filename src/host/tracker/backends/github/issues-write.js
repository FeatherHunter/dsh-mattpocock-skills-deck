/**
 * backends/github/issues-write.js — issue 写路径。
 *
 * 由 #440 从 issues.js 纯结构移出（create / close / reopen / update / setAssignees），行为零变化。
 * 读路径（list / get + REST 降级）留在 issues.js。
 * 以后改写操作命令语义的人改它。预估约 285 行。
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { fail } from '../../preflight.js'
import { ghClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { classifyGhError } from './errors.js'
import { getIssue, parseRepo, repoId } from './issues.js'
// #711：创建幂等锚。锚那一行怎么拼、命中判据是什么，在刷新核心的产物里（唯一一处判据）；
// 本间房专属的「建后按锚回查」在 ./idempotency.js（两条路：搜索接口 + 最近更新列表逐张读正文）。
import { checkIdempotencyKey } from '../../../../shared/refresh/idempotency.js'
import { withAnchor, lookupByAnchor } from './idempotency.js'

/**
 * create(repo, input, ctx) -> OpResult<Issue>
 * input: {title, body?, type?, parentKey?, labels?, assignees?, idempotencyKey?}
 *
 * #711：`idempotencyKey` 是可选输入。带上它时，票面正文的第一行是锚（渲染后看不见的 HTML 注释），
 * 建票之前先按锚回查一次：命中就把那张票交回去（返回同一个 key、不再建），没命中才照常建。
 * 回查拿不准时如实失败、绝不建票。不带这个字段时行为与加字段之前完全一样。
 */
export async function createIssue(repo, input, ctx) {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `create: repo.refId missing: ${repoId(repo)}`)
    if (!input || typeof input.title !== 'string' || !input.title.trim()) return fail(ERROR_KIND.PARSE, 'create: title required')
    // 幂等键当场检查：不合规（空、超长、带换行或注释收尾符）绝不落到正文上，
    // 而且必须比「回查」更早失败 —— 键不合法时连回查都无从做起。
    const wantKey = input.idempotencyKey === undefined || input.idempotencyKey === null ? null : checkIdempotencyKey(input.idempotencyKey)
    if (wantKey && !wantKey.ok) return fail(ERROR_KIND.PARSE, `create: idempotencyKey 不能用：${wantKey.reason}`)
    const idemKey = wantKey ? wantKey.key : ''
    if (idemKey) {
      const found = await lookupByAnchor(repo, idemKey, ctx, normalizeIssue)
      if (!found.ok) return { ok: false, error: found.error }
      if (found.hit) return { ok: true, data: found.issue }
    }
    const c = ghClient(ctx)
    const body = withAnchor(typeof input.body === 'string' ? input.body : '', idemKey)
    // 主路用 REST 建票：gh api 不支持经 stdin 传整包（执行层没有 stdin 口），改用 -f 逐字段传；
    // gh issue create 不认 --json，所以不走它。标签与认领建后另补（已有现成函数）。
    const createArgs = ['api', `repos/${parsed.owner}/${parsed.name}/issues`, '--method', 'POST', '-f', `title=${input.title.trim()}`, '-f', `body=${body}`, '--jq', '.']
    const r = await c.execGh(createArgs, { cwd: ctx && ctx.cwd })
    let createdRaw = null
    if (!r.ok) return { ok: false, error: r.error }
    const text = r.data.stdout || ''
    try {
      const j = JSON.parse(text)
      createdRaw = Array.isArray(j) ? j[0] : j
    } catch (e) {
      return fail(ERROR_KIND.PARSE, `create: invalid json ${String(e.message).slice(0, 200)}`)
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
    // 标签与认领建后另补（建票一步只带标题正文；已有现成函数走正常接口）
    try {
      const wantLabels = [];
      if (Array.isArray(input.labels) && input.labels.length) {
        for (const l of input.labels) {
          const n = (typeof l === 'string' ? l.trim() : (l && typeof l.name === 'string' ? l.name.trim() : ''));
          if (n && !wantLabels.includes(n)) wantLabels.push(n);
        }
      }
      const wantType = input.type === 'map' ? 'map' : 'issue';
      if (wantType === 'map' && !issue.labels.some((l) => l.name === 'wayfinder:map') && !wantLabels.includes('wayfinder:map')) wantLabels.push('wayfinder:map');
      if (wantLabels.length) {
        const { setLabels } = await import('./labels.js');
        const merged = [...issue.labels.map((l) => l.name)];
        for (const n of wantLabels) if (!merged.includes(n)) merged.push(n);
        const lr = await setLabels(repo, issue.key, merged.map((n) => ({ name: n })), {}, ctx);
        if (lr && lr.ok === true && lr.data) issue = lr.data;
        else if (wantType === 'map') issue.type = 'map';
      } else if (wantType === 'map' && issue.type !== 'map') issue.type = 'map';
    } catch {}
    try {
      if (Array.isArray(input.assignees) && input.assignees.length) {
        const want = input.assignees.map((a) => (typeof a === 'string' ? { login: a.trim() } : a)).filter((a) => a && a.login);
        if (want.length) {
          const ar = await setAssignees(repo, issue.key, want, {}, ctx);
          if (ar && ar.ok === true && ar.data) issue = ar.data;
        }
      }
    } catch {}
    // parentKey 有则创后 setParent：挂不上不吞错，记在票上让工具层读回时能说清。
    if (input.parentKey != null && input.parentKey !== '') {
      try {
        const { setParent } = await import('./graph.js')
        const pr = await setParent(repo, issue.key, String(input.parentKey), {}, ctx)
        if (pr.ok) issue = pr.data
        else issue.parentError = { kind: String((pr.error && pr.error.kind) || ''), message: String((pr.error && pr.error.message) || '后端没给出原因').slice(0, 300) }
      } catch (e) {
        issue.parentError = { kind: 'unknown', message: String((e && e.message) || e).slice(0, 300) }
      }
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
    // gh issue close 不认 --json：先关，再用 view 取回
    const args = ['issue', 'close', k, '--repo', `${parsed.owner}/${parsed.name}`]
    if (opts && typeof opts.reason === 'string' && opts.reason) {
      args.push('--reason', opts.reason)
    }
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
    if (!r.ok) return { ok: false, error: r.error }
    const vr = await c.execGh(['issue', 'view', k, '--repo', `${parsed.owner}/${parsed.name}`, '--json', 'number,title,state,body,url,updatedAt,createdAt,closedAt,labels,assignees'], { cwd: ctx && ctx.cwd })
    if (!vr.ok) {
      const optimistic = normalizeIssue({ number: Number(k) || k, title: '', state: 'closed', body: '', url: '', closedAt: new Date().toISOString() })
      if (opts && typeof opts.reason === 'string') optimistic.reason = opts.reason
      return { ok: true, data: optimistic }
    }
    const text = vr.data.stdout || ''
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
    const args = ['issue', 'reopen', k, '--repo', `${parsed.owner}/${parsed.name}`]
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
    if (!r.ok) return { ok: false, error: r.error }
    const vr = await c.execGh(['issue', 'view', k, '--repo', `${parsed.owner}/${parsed.name}`, '--json', 'number,title,state,body,url,updatedAt,createdAt,closedAt,labels,assignees'], { cwd: ctx && ctx.cwd })
    if (!vr.ok) {
      return { ok: true, data: normalizeIssue({ number: Number(k) || k, title: '', state: 'open', body: '', url: '', closedAt: null }) }
    }
    const text = vr.data.stdout || ''
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
    // gh issue edit 不认 --json：先改，再用 view 取回
    const args = ['issue', 'edit', k, '--repo', `${parsed.owner}/${parsed.name}`]
    if (typeof patch.title === 'string') args.push('--title', patch.title)
    if (typeof patch.body === 'string') args.push('--body', patch.body)
    if (args.length <= 4) return fail(ERROR_KIND.PARSE, 'update: empty patch (no title/body)')
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
    if (!r.ok) return { ok: false, error: r.error }
    const vr = await c.execGh(['issue', 'view', k, '--repo', `${parsed.owner}/${parsed.name}`, '--json', 'number,title,state,body,url,updatedAt,createdAt,closedAt,labels,assignees'], { cwd: ctx && ctx.cwd })
    if (!vr.ok) return { ok: true, data: normalizeIssue({ number: Number(k) || k, title: typeof patch.title === 'string' ? patch.title : '', state: 'open', body: typeof patch.body === 'string' ? patch.body : '', url: '' }) }
    const text = vr.data.stdout || ''
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
