/**
 * backends/gitlab/comments.js — comment 操作。
 *
 * 按 #144 归一：POST /projects/:id/issues/:iid/notes；get 聚合由 issues.fetchAugment 完成，此处提供 comment 单条写入。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import { fail } from '../../preflight.js'
import { glabClient } from './client.js'
import { failGlab } from './errors.js'
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
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'comment: repo.refId missing', '')
  const k = String(key)
  if (!k) return fail(ERROR_KIND.PARSE, 'comment: key required', '')
  if (typeof body !== 'string' || !body.trim()) return fail(ERROR_KIND.PARSE, 'comment: body required', '')
  try {
    const c = glabClient(effective)
    const res = await c.run(['api', notesPath(id, k), '--method', 'POST', '-f', `body=${body}`], { timeout: 8000 })
    if (res.code !== 0) {
      // 原文 = glab 这一趟的进程结果（stderr/stdout/退出码都在里面），判档与给人看的原文用同一份。
      return failGlab(res, res.stderr || res.stdout || 'comment failed', res, effective)
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
    // 原文 = 抛上来的那个 Error 对象本身（message / cause 都在里面）。
    return failGlab(err, err && err.message ? String(err.message) : String(err), err, effective)
  }
}

export async function listComments(ctx, repo, key, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'listComments: repo.refId missing', '')
  const k = String(key)
  try {
    const c = glabClient(effective)
    const res = await c.run(['api', notesPath(id, k)], { timeout: 8000 })
    if (res.code !== 0) {
      // 原文 = glab 这一趟的进程结果（stderr/stdout/退出码都在里面）。
      return failGlab(res, res.stderr || res.stdout || 'listComments failed', res, effective)
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
    // 原文 = 抛上来的那个 Error 对象本身（message / cause 都在里面）。
    return failGlab(err, err && err.message ? String(err.message) : String(err), err, effective)
  }
}

export default { addComment, listComments }
