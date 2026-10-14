/**
 * backends/gitlab/comments.ts — comment 操作。
 *
 * 按 #144 归一：POST /projects/:id/issues/:iid/notes；get 聚合由 issues.fetchAugment 完成，此处提供 comment 单条写入。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { ErrorKind } from '../../contract/identity.js'
import type { BackendContext, OpContext } from '../../contract/contexts.js'
import type { Comment, RepositoryRef } from '../../contract/entities.js'
import type { OpResult } from '../../contract/results.js'
import { fail } from '../../preflight.js'
import { glabClient } from './client.js'
import { failGlab } from './errors.js'
import { notesPath } from './queries.js'

// 仓库身份只取 refId/name 两格，是因为评论读写只认这两样，拿全量 RepositoryRef 反而把 effortId 搅进来。
type RepoLike = Partial<RepositoryRef> | null | undefined
// 上下文两形都收，是因为调用方有时把执行器放在 ctx、有时放在 opCtx，缺了就让 glabClient 按 127 回。
type CtxLike = Partial<OpContext> & Partial<BackendContext>

function repoId(repo: RepoLike): string {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

function errMsg(err: unknown): string {
  if (err !== null && typeof err === 'object' && 'message' in (err as Record<string, unknown>)) {
    const m = (err as Record<string, unknown>)['message']
    if (typeof m === 'string' && m) return m
  }
  return String(err)
}

/**
 * 写一条评论：先判仓库与正文是否齐全，再 POST 到 notes，失败带原文回以便界面展开。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId/name）
 * @param key 票号（iid 字符串）
 * @param body 评论正文（非空）
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function addComment(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  key: string,
  body: string,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Comment>> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'comment: repo.refId missing', '')
  const k = String(key)
  if (!k) return fail(ERROR_KIND.PARSE as ErrorKind, 'comment: key required', '')
  if (typeof body !== 'string' || !body.trim()) {
    return fail(ERROR_KIND.PARSE as ErrorKind, 'comment: body required', '')
  }
  try {
    const c = glabClient(effective as Partial<OpContext> & Partial<BackendContext>)
    const res = await c.run(['api', notesPath(id, k), '--method', 'POST', '-f', `body=${body}`], { timeout: 8000 })
    if (res.code !== 0) {
      // 原文 = glab 这一趟的进程结果（stderr/stdout/退出码都在里面），判档与给人看的原文用同一份。
      return failGlab(res, res.stderr || res.stdout || 'comment failed', res, effective)
    }
    let raw: unknown = null
    try {
      raw = JSON.parse(res.stdout) as unknown
    } catch {
      raw = null
    }
    const bag = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
    const authorBag =
      bag && bag['author'] !== null && typeof bag['author'] === 'object'
        ? (bag['author'] as Record<string, unknown>)
        : null
    const now = new Date().toISOString()
    const comment: Comment = {
      id: bag && bag['id'] != null ? String(bag['id']) : undefined,
      author: { login: authorBag && typeof authorBag['username'] === 'string' ? String(authorBag['username']) : '' },
      authorAssociation: '',
      body,
      createdAt: bag && typeof bag['created_at'] === 'string' ? String(bag['created_at']) : now,
      updatedAt: bag && typeof bag['updated_at'] === 'string' ? String(bag['updated_at']) : now,
    }
    return { ok: true, data: comment }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象本身（message / cause 都在里面）。
    return failGlab(err, errMsg(err), err, effective)
  }
}

/**
 * 列出一条票下的评论：GET notes，逐条压成契约 Comment 形状。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId/name）
 * @param key 票号（iid 字符串）
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function listComments(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  key: string,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Comment[]>> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'listComments: repo.refId missing', '')
  const k = String(key)
  try {
    const c = glabClient(effective as Partial<OpContext> & Partial<BackendContext>)
    const res = await c.run(['api', notesPath(id, k)], { timeout: 8000 })
    if (res.code !== 0) {
      // 原文 = glab 这一趟的进程结果（stderr/stdout/退出码都在里面）。
      return failGlab(res, res.stderr || res.stdout || 'listComments failed', res, effective)
    }
    let arr: unknown = []
    try {
      arr = JSON.parse(res.stdout) as unknown
    } catch {
      arr = []
    }
    if (!Array.isArray(arr)) arr = []
    const comments: Comment[] = (arr as unknown[]).map((n) => {
      const nb = n !== null && typeof n === 'object' ? (n as Record<string, unknown>) : {}
      const ab = nb['author'] !== null && typeof nb['author'] === 'object'
        ? (nb['author'] as Record<string, unknown>)
        : null
      return {
        id: nb['id'] != null ? String(nb['id']) : undefined,
        author: { login: ab && typeof ab['username'] === 'string' ? String(ab['username']) : '' },
        authorAssociation: '',
        body: typeof nb['body'] === 'string' ? String(nb['body']) : '',
        createdAt: typeof nb['created_at'] === 'string' ? String(nb['created_at']) : '',
        updatedAt: typeof nb['updated_at'] === 'string' ? String(nb['updated_at']) : '',
      } as Comment
    })
    return { ok: true, data: comments }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象本身（message / cause 都在里面）。
    return failGlab(err, errMsg(err), err, effective)
  }
}

export default { addComment, listComments }
