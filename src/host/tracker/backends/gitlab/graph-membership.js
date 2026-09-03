// graph-membership.js —— 以后改亲缘挂载与指派接口时改它：relates_to 链接挂载、assignee_ids 解析。
// 抓取底座（repoId/fetchRawIssue）从阻塞文件单向导入，不自建第二份（同房互引，老门禁放行）。
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { fail } from '../../preflight.js'
import { glabClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { classifyGlabError } from './errors.js'
import { issuePath, linksPath } from './queries.js'
import { repoId, fetchRawIssue } from './graph-blocking.js'

export async function setParent(ctx, repo, key, parentKey, opts, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'setParent: repo.refId missing')
  const k = String(key)
  try {
    // If-Match
    if (opts && typeof opts.expectedUpdatedAt === 'string' && opts.expectedUpdatedAt !== '') {
      const curRaw = await fetchRawIssue(effective, id, k)
      const cur = curRaw && (curRaw.updated_at || curRaw.updatedAt) || ''
      if (cur !== opts.expectedUpdatedAt) return fail(ERROR_KIND.CONFLICT, `conflict: expectedUpdatedAt mismatch (want ${opts.expectedUpdatedAt} got ${cur})`)
    }
    const c = glabClient(effective)
    if (parentKey === null) {
      // DELETE links : 需找到 link id
      const linksRes = await c.run(['api', linksPath(id, k)], { timeout: 8000 })
      if (linksRes.code === 0) {
        let links = []
        try { links = JSON.parse(linksRes.stdout) } catch {}
        const rel = links.filter((l) => String(l.link_type || '').toLowerCase() === 'relates_to')
        for (const l of rel) {
          const lid = l.id || l.link_id
          if (lid) await c.run(['api', `${linksPath(id, k)}/${lid}`, '--method', 'DELETE'], { timeout: 8000 })
        }
      }
    } else {
      const pk = String(parentKey)
      // 环检：parentKey成环 → conflict（若 pk == k 自环）
      if (pk === k) return fail(ERROR_KIND.CONFLICT, 'conflict: self-parent')
      // POST relates_to
      const res = await c.run(['api', linksPath(id, k), '--method', 'POST', '-f', `target_project_id=${id}`, '-f', `target_issue_iid=${pk}`, '-f', 'link_type=relates_to'], { timeout: 8000 })
      if (res.code !== 0) {
        const kind = classifyGlabError({ message: res.stderr || res.stdout })
        return fail(kind, res.stderr || res.stdout || 'setParent failed')
      }
    }
    const raw = await fetchRawIssue(effective, id, k)
    // 额外 fetch links以归一 parentKey
    try {
      const linksRes = await c.run(['api', linksPath(id, k)], { timeout: 8000 })
      if (linksRes.code === 0) {
        try { raw.links = JSON.parse(linksRes.stdout) } catch {}
      }
    } catch {}
    const issue = normalizeIssue(raw)
    return { ok: true, data: issue }
  } catch (err) {
    const kind = classifyGlabError(err)
    return fail(kind, err && err.message ? String(err.message) : String(err))
  }
}

export async function setAssignees(ctx, repo, key, assignees, opts, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'setAssignees: repo.refId missing')
  const k = String(key)
  const wanted = Array.isArray(assignees) ? assignees.map((a) => typeof a === 'string' ? a : a.login).filter(Boolean) : []
  try {
    if (opts && typeof opts.expectedUpdatedAt === 'string' && opts.expectedUpdatedAt !== '') {
      const curRaw = await fetchRawIssue(effective, id, k)
      const cur = curRaw && (curRaw.updated_at || curRaw.updatedAt) || ''
      if (cur !== opts.expectedUpdatedAt) return fail(ERROR_KIND.CONFLICT, `conflict: expectedUpdatedAt mismatch`)
    }
    // GitLab single/multi assignee: PUT assignee_ids
    // 需解析 username→id（via GET /users?username=）
    const c = glabClient(effective)
    let assigneeIds = []
    for (const u of wanted) {
      try {
        const res = await c.run(['api', `users?username=${encodeURIComponent(u)}`], { timeout: 5000 })
        if (res.code === 0) {
          const arr = JSON.parse(res.stdout)
          if (Array.isArray(arr) && arr[0] && arr[0].id) assigneeIds.push(String(arr[0].id))
        }
      } catch {}
    }
    const res = await c.run(['api', issuePath(id, k), '--method', 'PUT', '-f', `assignee_ids=${assigneeIds.join(',')}`], { timeout: 8000 })
    if (res.code !== 0) {
      const kind = classifyGlabError({ message: res.stderr || res.stdout })
      return fail(kind, res.stderr || res.stdout || 'setAssignees failed')
    }
    let raw = null
    try { raw = JSON.parse(res.stdout) } catch { raw = { iid: k } }
    const issue = normalizeIssue(raw)
    return { ok: true, data: issue }
  } catch (err) {
    const kind = classifyGlabError(err)
    return fail(kind, err && err.message ? String(err.message) : String(err))
  }
}
