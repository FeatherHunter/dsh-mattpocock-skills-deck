/**
 * src/tracker/rooms/gitea/support/target.ts —— gitea 房操作入口共用的「解析目标」前置守卫
 * （票 #14 评审收编：原先 issues/write.ts、comments/write.ts、graph/write.ts、labels/assign.ts
 * 里十来个函数各抄一遍同形状的三行，收成这一处）。
 *
 * 三行守卫的口径与 GitLab 房同一条：
 *  1. 上下文两形都收（opCtx 优先，缺了顶 ctx）；
 *  2. 仓库标识只认 refId，缺了按 not-found 如实回（远端一个请求都没发，原文给空串）；
 *  3. 票号去空白后必须非空，空了按 parse 且标「输入被拒」（重试同一份没有意义）。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { RepositoryRef } from '../../../contract/entities.js'
import { TRACKER_ERROR_STAGE, type OpResult } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import { refIdOf, type CtxLike } from './tea-run.js'

type RepoLike = Partial<RepositoryRef> | null | undefined

/** 解析结果两态：成功带上下文 / 仓库标识 / 去空白后的票号；失败带构造好的错误回执。 */
export type ResolvedTarget =
  | { ok: true; effective: CtxLike | undefined; refId: string; key: string }
  | { ok: false; result: { ok: false; error: ReturnType<typeof fail>['error'] } }

/**
 * 解析一次操作的目标。notFoundMessage 由调用方按各操作的原话传入（逐字保留，不在这里拼）；
 * 票号缺失的消息统一是「操作名: 票号缺失」，opLabel 就是那个操作名。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId）
 * @param key 票号（没有票号的操作传空串，票号守卫对空串字面量永远不触发）
 * @param opCtx 本次调用的上下文（优先用它）
 * @param opLabel 操作名（票号缺失消息的前缀）
 * @param notFoundMessage 仓库标识缺失时回给调用方的原话
 */
export function resolveTarget(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  key: string,
  opCtx: CtxLike | null | undefined,
  opLabel: string,
  notFoundMessage: string,
): ResolvedTarget {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const refId = refIdOf(repo)
  // 原文给空串：这一条是本地入参不全（远端一个请求都没发），没有外部原文可取。
  if (!refId) return { ok: false, result: fail(ERROR_KIND.NOTFOUND as ErrorKind, notFoundMessage, '') }
  // 没有票号的操作（建票）传空串字面量：票号守卫对空串字面量永远不触发，原样带出去。
  if (key === '') return { ok: true, effective, refId, key: '' }
  const k = String(key).trim()
  if (!k) return { ok: false, result: fail(ERROR_KIND.PARSE as ErrorKind, opLabel + ': 票号缺失', '', TRACKER_ERROR_STAGE.INPUT_REFUSED) }
  return { ok: true, effective, refId, key: k }
}
