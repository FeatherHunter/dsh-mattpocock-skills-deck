/**
 * backends/github/comments.js — comment 操作。
 *
 * 定版依据：#138 §1.4（comment 归一）+ contract.js OpResult 形状。
 * - 签名：comment(repo, key, body, ctx) -> OpResult<Comment>
 * - 通过 `gh issue comment` / REST POST 实现；错误分类经 classifyGhError
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { fail } from '../../preflight.js'
import { ghClient } from './client.js'
import { classifyGhError } from './errors.js'

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

export async function addComment(repo, key, body, ctx) {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `comment: repo.refId missing: ${repoId(repo)}`)
    const k = String(key || '').trim()
    if (!k) return fail(ERROR_KIND.PARSE, 'comment: key required')
    if (typeof body !== 'string' || !body.trim()) return fail(ERROR_KIND.PARSE, 'comment: body required')
    const c = ghClient(ctx)
    // 优先 REST：gh api POST repos/.../issues/<n>/comments -f body
    const args = ['api', `repos/${parsed.owner}/${parsed.name}/issues/${k}/comments`, '--method', 'POST', '-f', `body=${body}`, '--jq', '.']
    let r = await c.execGh(args, { cwd: ctx && ctx.cwd })
    if (!r.ok) {
      // 回落 gh issue comment
      const alt = ['issue', 'comment', k, '--repo', `${parsed.owner}/${parsed.name}`, '--body', body, '--json', 'id,author,body,createdAt,updatedAt']
      r = await c.execGh(alt, { cwd: ctx && ctx.cwd })
      if (!r.ok) return { ok: false, error: r.error }
    }
    const text = r.data.stdout || r.data.stderr || ''
    let raw = null
    try {
      raw = JSON.parse(text)
      if (Array.isArray(raw)) raw = raw[0]
    } catch {
      // 若返回非 JSON（如 REST 返回 html），仍构造 optimistic comment
      raw = { body, author: { login: '' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    }
    const authorLogin = (raw && raw.author && raw.author.login) || (raw && raw.user && raw.user.login) || ''
    const comment = {
      id: raw && raw.id != null ? String(raw.id) : undefined,
      author: { login: String(authorLogin) },
      authorAssociation: (raw && (raw.authorAssociation || raw.author_association)) || '',
      body: (raw && typeof raw.body === 'string' ? raw.body : body),
      createdAt: (raw && (raw.createdAt || raw.created_at)) || new Date().toISOString(),
      updatedAt: (raw && (raw.updatedAt || raw.updated_at)) || new Date().toISOString(),
    }
    if (raw && (raw.editedAt || raw.lastEditedAt || raw.edited_at || raw.last_edited_at)) comment.editedAt = raw.editedAt || raw.lastEditedAt || raw.edited_at || raw.last_edited_at
    return { ok: true, data: comment }
  } catch (e) {
    const kind = classifyGhError(e)
    return fail(kind, String((e && e.message) || e).slice(0, 800))
  }
}

// 便捷：listComments 非 op（仅 get 的 comments 分页用，宿主不直接调用）
export async function listComments(repo, key, ctx) {
  return fail(ERROR_KIND.UNSUPPORTED, 'listComments: use get(repo,key,{comments})')
}

export default { addComment, listComments }
