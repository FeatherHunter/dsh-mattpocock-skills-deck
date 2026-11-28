/**
 * src/tracker/rooms/gitea/comments/write.ts —— 给一张票写一条评论（契约操作 comment，票 #12）。
 *
 * tea 的评论写入挂在 comments 命名空间下（comments add，不是 issues <编号> comments），命令
 * 词汇在 ../support/tea-run.ts 一处。回包口径：--output json 回的是刚写下的那条评论；回包
 * 难读时按「写已成功」兜一张最小评论（id 给不了就省略，作者取当前 tea 登录名拿不到就空串），
 * 不能因为回包难读把一次成功的写判成失败。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { BackendContext, OpContext } from '../../../contract/contexts.js'
import type { Comment, RepositoryRef } from '../../../contract/entities.js'
import type { OpResult } from '../../../contract/results.js'
import { TRACKER_ERROR_STAGE } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import { failGitea } from '../errors.js'
// 目标解析三行守卫收编在 ../support/target.ts 一处（票 #14），写评论与其它写操作入口共用。
import { resolveTarget } from '../support/target.js'
import {
  type CtxLike,
  type RawBag,
  argsCommentAdd,
  errMsg,
  parseReadBag,
  writeFailureTexts,
  runWrite,
  writeFailureError,
} from '../support/tea-run.js'

type RepoLike = Partial<RepositoryRef> | null | undefined

/**
 * 写一条评论（契约 comment）：body 必填非空；成功后归一回契约的 Comment 形状。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId）
 * @param key 票号
 * @param body 评论正文（Markdown 原文）
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function addComment(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  key: string,
  body: string,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Comment>> {
  // 目标解析三行守卫收编在 support/target.ts 一处（票 #14）；各操作的原话消息在这里传进去。
  const t = resolveTarget(ctx, repo, key, opCtx, 'comment', 'comment: repo.refId 缺失，无法向 Gitea 写评论')
  if (!t.ok) return t.result
  const { effective, refId, key: k } = t
  if (typeof body !== 'string' || !body.trim()) {
    return fail(ERROR_KIND.PARSE as ErrorKind, 'comment: 评论正文必填', '', TRACKER_ERROR_STAGE.INPUT_REFUSED)
  }
  try {
    const res = await runWrite(effective, argsCommentAdd(refId, k, body))
    if (res.code !== 0) {
      // 原文 = 这一次 CLI 调用的进程结果（stderr 里是执行器或远端的原话）。
      const t = writeFailureTexts('comment')
      return failGitea(writeFailureError(res, effective, t.fallback), t.human, res, effective)
    }
    const raw = parseReadBag(typeof res.stdout === 'string' ? res.stdout : '')
    const now = new Date().toISOString()
    const bag = (raw || {}) as RawBag
    const authorBag = (bag['author'] && typeof bag['author'] === 'object' ? bag['author'] : {}) as RawBag
    const comment: Comment = {
      // 评论 id 给不了就省略（契约口径）；时间缺给当下兜底（GitLab 房同一取舍）。
      id: typeof bag['id'] === 'string' || typeof bag['id'] === 'number' ? String(bag['id']) : undefined,
      author: { login: typeof authorBag['login'] === 'string' ? authorBag['login'] : '', name: typeof authorBag['full_name'] === 'string' ? authorBag['full_name'] : undefined },
      authorAssociation: '',
      // 正文以调用方入参为准：远端可能转写正文，契约要的是我们发出的那一份。
      body,
      createdAt: typeof bag['created_at'] === 'string' ? bag['created_at'] : now,
      updatedAt: typeof bag['updated_at'] === 'string' ? bag['updated_at'] : now,
    }
    return { ok: true, data: comment }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象（它带着 tea 的 stderr/stdout）。
    return failGitea(err, errMsg(err), err, effective)
  }
}
