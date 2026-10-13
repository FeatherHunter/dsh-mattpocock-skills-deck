/**
 * backends/github/comments.js — comment 操作。
 *
 * 定版依据：#138 §1.4（comment 归一）+ contract.js OpResult 形状。
 * - 签名：comment(repo, key, body, ctx) -> OpResult<Comment>
 * - 通过 `gh issue comment` / REST POST 实现；错误分类经 ghVerdictOf（判档表在 src/tracker/error-rules.ts）
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import { fail } from '../../preflight.js'
import { ghClient } from './client.js'
import { ghFailureMessage, ghVerdictOf } from './errors.js'

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
    // 形状不对的入参本身就是这一处的原文（这之前还没跑过任何外部命令）；它取出来可能是空串，那是如实交代。
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `comment: repo.refId missing: ${repoId(repo)}`, repo)
    const k = String(key || '').trim()
    if (!k) return fail(ERROR_KIND.PARSE, 'comment: key required', key)
    if (typeof body !== 'string' || !body.trim()) return fail(ERROR_KIND.PARSE, 'comment: body required', body)
    const c = ghClient(ctx)
    // 优先 REST：gh api POST repos/.../issues/<n>/comments -f body
    const args = ['api', `repos/${parsed.owner}/${parsed.name}/issues/${k}/comments`, '--method', 'POST', '-f', `body=${body}`, '--jq', '.']
    let r = await c.execGh(args, { cwd: ctx && ctx.cwd })
    if (!r.ok) {
      // 回落 gh issue comment（它不认 --json，成功后不再解析，直接按乐观评论回）
      const alt = ['issue', 'comment', k, '--repo', `${parsed.owner}/${parsed.name}`, '--body', body]
      r = await c.execGh(alt, { cwd: ctx && ctx.cwd })
      if (!r.ok) return { ok: false, error: r.error }
      return { ok: true, data: { author: { login: '' }, authorAssociation: '', body: body, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }
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
    // 判档只走本房唯一的出口（`ghVerdictOf`）：档位由规则表判、话术按票面实现决定第 11 条挑；
    // 第三段把出错的那个值原样交出去当原文（合并、遮蔽、截断由 `fail` 统一做）。
    const verdict = ghVerdictOf(e, ctx)
    return fail(verdict.kind, ghFailureMessage(verdict, String((e && e.message) || e).slice(0, 800)), e)
  }
}

// 便捷：listComments 非 op（仅 get 的 comments 分页用，宿主不直接调用）
export async function listComments(repo, key, ctx) {
  // 这是一条「请换用 get」的桩，还没有跑过外部命令，手里可当原文的只有调用时给的票号。
  return fail(ERROR_KIND.UNSUPPORTED, 'listComments: use get(repo,key,{comments})', key)
}

export default { addComment, listComments }
