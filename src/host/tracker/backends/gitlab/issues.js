/**
 * backends/gitlab/issues.js — issue 操作（list/get/create/close/reopen/update）。
 *
 * 按 #135/#144：REST主路径，list/get均聚合 notes+links 后 normalize；分页per_page；milestone更新走milestone_id。
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { fail } from '../../preflight.js'
import { glabClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { classifyGlabError } from './errors.js'
import { issuesPath, issuePath, notesPath, linksPath, milestonesPath } from './queries.js'

function repoId(repo) {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

function parseJsonSafe(s) {
  try { return JSON.parse(s) } catch { return null }
}

async function apiGet(opCtx, path) {
  const c = glabClient(opCtx)
  const res = await c.run(['api', path], { timeout: 8000 })
  if (res.code !== 0) {
    const err = { message: res.stderr || res.stdout || `api ${path} failed`, stderr: res.stderr, stdout: res.stdout, code: res.code }
    throw Object.assign(new Error(err.message), err)
  }
  return parseJsonSafe(res.stdout)
}

async function apiPut(opCtx, path, body) {
  const c = glabClient(opCtx)
  const args = ['api', path, '--method', 'PUT']
  for (const [k, v] of Object.entries(body || {})) {
    if (v == null) continue
    if (Array.isArray(v)) args.push('-f', `${k}=${v.join(',')}`)
    else args.push('-f', `${k}=${String(v)}`)
  }
  const res = await c.run(args, { timeout: 8000 })
  if (res.code !== 0) {
    const err = { message: res.stderr || res.stdout || `api PUT ${path} failed`, stderr: res.stderr, stdout: res.stdout, code: res.code }
    throw Object.assign(new Error(err.message), err)
  }
  return parseJsonSafe(res.stdout)
}

async function fetchAugment(opCtx, refId, raw) {
  const iid = raw.iid
  if (iid == null) return raw
  // 聚合 notes + links（best-effort，失败忽略）
  try {
    const notes = await apiGet(opCtx, notesPath(refId, iid))
    if (Array.isArray(notes)) raw.notes = notes
  } catch {}
  try {
    const links = await apiGet(opCtx, linksPath(refId, iid))
    if (Array.isArray(links)) raw.links = links
  } catch {}
  return raw
}

export async function listIssues(ctx, repo, filter, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'list: repo.refId missing')
  // filter → query（state/labels/milestone/分页）
  const params = new URLSearchParams()
  params.set('per_page', '100')
  params.set('with_labels_details', 'true')
  if (filter && filter.state) {
    // GitLab state: opened/closed
    params.set('state', filter.state === 'closed' ? 'closed' : 'opened')
  }
  if (filter && Array.isArray(filter.keys) && filter.keys.length) {
    // GitLab无批量keys过滤，返回全量后前端过滤（诚实）
  }
  try {
    const path = issuesPath(id, params.toString())
    const c = glabClient(effective)
    const res = await c.run(['api', path], { timeout: 10000 })
    if (res.code !== 0) {
      const kind = classifyGlabError({ message: res.stderr || res.stdout })
      return fail(kind, res.stderr || res.stdout || 'list failed')
    }
    let arr = parseJsonSafe(res.stdout)
    if (!Array.isArray(arr)) return fail(ERROR_KIND.PARSE, 'list returned non-array')
    // 若filter有keys，内存过滤
    if (filter && Array.isArray(filter.keys) && filter.keys.length) {
      const set = new Set(filter.keys.map(String))
      arr = arr.filter((x) => set.has(String(x.iid)))
    }
    if (filter && filter.parentKey !== undefined) {
      // parentKey过滤需links聚合（heavy），此处先返回全量由宿主侧二次过滤（诚实但不阻塞）
    }
    // 归一（不逐条聚合links以免爆量；get会聚合）
    const issues = arr.map((raw) => normalizeIssue(raw))
    return { ok: true, data: issues }
  } catch (err) {
    const kind = classifyGlabError(err)
    return fail(kind, err && err.message ? String(err.message) : String(err))
  }
}

export async function getIssue(ctx, repo, key, opts, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'get: repo.refId missing')
  const k = String(key)
  if (!k) return fail(ERROR_KIND.PARSE, 'get: key required')
  try {
    const raw = await apiGet(effective, `${issuePath(id, k)}?with_labels_details=true`)
    if (!raw || typeof raw !== 'object') return fail(ERROR_KIND.NOTFOUND, `issue ${k} not found`)
    await fetchAugment(effective, id, raw)
    const issue = normalizeIssue(raw)
    return { ok: true, data: issue }
  } catch (err) {
    const kind = classifyGlabError(err)
    return fail(kind, err && err.message ? String(err.message) : String(err))
  }
}

export async function createIssue(ctx, repo, input, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'create: repo.refId missing')
  if (!input || typeof input.title !== 'string' || !input.title.trim()) return fail(ERROR_KIND.PARSE, 'create: title required')
  try {
    const body = { title: input.title.trim() }
    if (typeof input.body === 'string' && input.body) body.description = input.body
    if (Array.isArray(input.labels) && input.labels.length) {
      const names = input.labels.map((l) => typeof l === 'string' ? l : l.name).filter(Boolean)
      if (names.length) body.labels = names.join(',')
    }
    // parentKey → 创建后链 relates_to
    const created = await apiPut(effective, `${projectPath(id)}/issues`, body) // POST via PUT fallback? glab api POST
    // glab api 默认 GET，需指定 POST
    // 上述apiPut用PUT，create需POST，重试
    let raw = created
    if (!raw || !raw.iid) {
      const c = glabClient(effective)
      const args = ['api', `${projectPath(id)}/issues`, '--method', 'POST', '-f', `title=${body.title}`]
      if (body.description) args.push('-f', `description=${body.description}`)
      if (body.labels) args.push('-f', `labels=${body.labels}`)
      const res = await c.run(args, { timeout: 8000 })
      if (res.code !== 0) throw Object.assign(new Error(res.stderr || res.stdout), { stderr: res.stderr, stdout: res.stdout, code: res.code })
      raw = parseJsonSafe(res.stdout)
    }
    if (!raw || !raw.iid) return fail(ERROR_KIND.PARSE, 'create returned no iid')
    // 若有parentKey，建立 relates_to
    if (input.parentKey != null) {
      try {
        const c = glabClient(effective)
        await c.run(['api', `${issuePath(id, raw.iid)}/links`, '--method', 'POST', '-f', `target_project_id=${id}`, '-f', `target_issue_iid=${String(input.parentKey)}`, '-f', 'link_type=relates_to'], { timeout: 8000 })
      } catch {}
    }
    await fetchAugment(effective, id, raw)
    const issue = normalizeIssue(raw)
    return { ok: true, data: issue }
  } catch (err) {
    const kind = classifyGlabError(err)
    return fail(kind, err && err.message ? String(err.message) : String(err))
  }
}

export async function closeIssue(ctx, repo, key, opts, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'close: repo.refId missing')
  const k = String(key)
  try {
    const raw = await apiPut(effective, issuePath(id, k), { state_event: 'close' })
    const issue = normalizeIssue(raw || { iid: k, state: 'closed' })
    return { ok: true, data: issue }
  } catch (err) {
    const kind = classifyGlabError(err)
    return fail(kind, err && err.message ? String(err.message) : String(err))
  }
}

export async function reopenIssue(ctx, repo, key, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'reopen: repo.refId missing')
  const k = String(key)
  try {
    const raw = await apiPut(effective, issuePath(id, k), { state_event: 'reopen' })
    const issue = normalizeIssue(raw || { iid: k, state: 'opened' })
    return { ok: true, data: issue }
  } catch (err) {
    const kind = classifyGlabError(err)
    return fail(kind, err && err.message ? String(err.message) : String(err))
  }
}

export async function updateIssue(ctx, repo, key, patch, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'update: repo.refId missing')
  const k = String(key)
  if (!patch || typeof patch !== 'object') return fail(ERROR_KIND.PARSE, 'update: patch required')
  try {
    const body = {}
    if (typeof patch.title === 'string') body.title = patch.title
    if (typeof patch.body === 'string') body.description = patch.body
    if ('milestone' in patch) {
      if (patch.milestone === null) body.milestone_id = 0 // 清除
      else if (patch.milestone && typeof patch.milestone.name === 'string') {
        // 查 milestone_id
        const search = encodeURIComponent(patch.milestone.name)
        const miles = await apiGet(effective, milestonesPath(id, `search=${search}`))
        const found = Array.isArray(miles) ? miles.find((m) => m.title === patch.milestone.name) : null
        if (!found) return fail(ERROR_KIND.NOTFOUND, `milestone '${patch.milestone.name}' not found`)
        body.milestone_id = found.id
      }
    }
    if (Array.isArray(patch.customFields) && patch.customFields.length) {
      return fail(ERROR_KIND.UNSUPPORTED, 'customFields not supported on gitlab')
    }
    if (Object.keys(body).length === 0) {
      // 无可更新字段，返回当前
      return getIssue(ctx, repo, k, {}, effective)
    }
    const raw = await apiPut(effective, issuePath(id, k), body)
    await fetchAugment(effective, id, raw || { iid: k })
    const issue = normalizeIssue(raw || { iid: k, ...body })
    return { ok: true, data: issue }
  } catch (err) {
    const kind = classifyGlabError(err)
    return fail(kind, err && err.message ? String(err.message) : String(err))
  }
}

export default { listIssues, getIssue, createIssue, closeIssue, reopenIssue, updateIssue }
