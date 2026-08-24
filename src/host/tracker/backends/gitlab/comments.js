/**
 * backends/gitlab/comments.js — comment 操作。
 *
 * 按 #144 归一：POST /projects/:id/issues/:iid/notes；get 聚合由 issues.fetchAugment 完成，此处提供 comment 单条写入。
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { fail } from '../../preflight.js'
import { glabClient } from './client.js'
import { classifyGlabError } from './errors.js'
import { notesPath } from './queries.js'

function repoId(repo) {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

export async function addComment(ctx, repo, key, body, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'comment: repo.refId missing')
  const k = String(key)
  if (!k) return fail(ERROR_KIND.PARSE, 'comment: key required')
  if (typeof body !== 'string' || !body.trim()) return fail(ERROR_KIND.PARSE, 'comment: body required')
  try {
    const c = glabClient(effective)
    const res = await c.run(['api', notesPath(id, k), '--method', 'POST', '-f', `body=${body}`], { timeout: 8000 })
    if (res.code !== 0) {
      const kind = classifyGlabError({ message: res.stderr || res.stdout })
      return fail(kind, res.stderr || res.stdout || 'comment failed')
    }
    let raw = null
    try { raw = JSON.parse(res.stdout) } catch {}
    const comment = {
      id: raw && raw.id != null ? String(raw.id) : undefined,
      author: { login: (raw && raw.author && raw.author.username) || '' },
      authorAssociation: '',
      body,
      createdAt: raw && raw.created_at ? raw.created_at : new Date().toISOString(),
      updatedAt: raw && raw.updated_at ? raw.updated_at : new Date().toISOString(),
    }
    return { ok: true, data: comment }
  } catch (err) {
    const kind = classifyGlabError(err)
    return fail(kind, err && err.message ? String(err.message) : String(err))
  }
}

export async function listComments(ctx, repo, key, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'listComments: repo.refId missing')
  const k = String(key)
  try {
    const c = glabClient(effective)
    const res = await c.run(['api', notesPath(id, k)], { timeout: 8000 })
    if (res.code !== 0) {
      const kind = classifyGlabError({ message: res.stderr || res.stdout })
      return fail(kind, res.stderr || res.stdout || 'listComments failed')
    }
    let arr = []
    try { arr = JSON.parse(res.stdout) } catch {}
    if (!Array.isArray(arr)) arr = []
    const comments = arr.map((n) => ({
      id: n.id != null ? String(n.id) : undefined,
      author: { login: (n.author && n.author.username) || '' },
      authorAssociation: '',
      body: typeof n.body === 'string' ? n.body : '',
      createdAt: n.created_at || '',
      updatedAt: n.updated_at || '',
    }))
    return { ok: true, data: comments }
  } catch (err) {
    const kind = classifyGlabError(err)
    return fail(kind, err && err.message ? String(err.message) : String(err))
  }
}

export default { addComment, listComments }
