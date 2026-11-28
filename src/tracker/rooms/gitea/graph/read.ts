/**
 * src/tracker/rooms/gitea/graph/read.ts —— gitea 房的依赖读（契约 getDependencies）。
 *
 * Gitea 没有原生的阻塞/被阻塞边：这类关系写在票正文标记里（票 #3 立的口径——隐藏机器
 * 表优先、可见 Blocked by: 行兜底，parseBlockedByFallback 已在 model/description-markers.ts）。
 * 所以读依赖 = 读这张票的正文 → 解出阻塞方编号 → 逐张把对端的标题与状态落实。
 *
 * 对端落实的取舍与 GitLab 房同一口径：读不到对端就按 state 'open' 保守记、标题兜 '#'+编号
 * ——宁可保守不可猜错方向；被阻塞方（blockedBy）是唯一能解出来的方向，blocking 恒空数组
 * （Gitea 正文标记不写这个方向，不反向猜）。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { BackendContext, OpContext } from '../../../contract/contexts.js'
import type { IssueRef, RepositoryRef } from '../../../contract/entities.js'
import type { DepsOpts } from '../../../contract/inputs.js'
import type { DependenciesResult, Dependencies, OpResult } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import { failGitea } from '../errors.js'
import { parseBlockedByFallback } from '../model/description-markers.js'
import { fetchRawIssue } from '../issues/read.js'
import { type CtxLike, errMsg, refIdOf } from '../support/tea-run.js'

/**
 * 读一张票的依赖（契约 getDependencies）：正文标记解出阻塞方，再逐张落实对端。
 *
 * @param repo 目标仓库（只取 refId）
 * @param key 票号
 * @param opts 契约选项（DepsOpts.keys 目前无实际作用，gitea 的边只有正文一个出处）
 * @param ctx 调用上下文（opCtx 缺时顶上）
 */
export async function getDependencies(
  repo: Partial<RepositoryRef> | null | undefined,
  key: string,
  opts: DepsOpts | null | undefined,
  ctx: OpContext | null | undefined,
  opCtx?: BackendContext,
): Promise<DependenciesResult> {
  void opts
  const effective = (opCtx || ctx) as CtxLike | undefined
  const refId = refIdOf(repo)
  if (!refId) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'getDependencies: repo.refId 缺失，无法向 Gitea 读依赖', '')
  const k = String(key).trim()
  if (!k) return fail(ERROR_KIND.PARSE as ErrorKind, 'getDependencies: 票号缺失', '')
  let raw: Record<string, unknown>
  try {
    raw = await fetchRawIssue(effective, refId, k)
  } catch (err: unknown) {
    return failGitea(err, errMsg(err), err, effective)
  }
  // 正文标记解出阻塞方编号清单；没有标记就是没有可解的边（合法空结果，不是失败）。
  const body = typeof raw['body'] === 'string' ? raw['body'] : ''
  const keys = parseBlockedByFallback(body) ?? []
  const blockedBy: IssueRef[] = []
  for (const bk of keys) {
    try {
      const peer = await fetchRawIssue(effective, refId, bk)
      // 对端落实：标题与状态取对端票面；type 恒 issue（Gitea 没有 PR 子类型在这条读路径上的区分）。
      const state = peer['state'] === 'closed' ? 'closed' : 'open'
      blockedBy.push({
        key: String(peer['index'] ?? bk),
        title: typeof peer['title'] === 'string' && peer['title'] ? peer['title'] : '#' + bk,
        state,
        type: 'issue',
      })
    } catch {
      // 读不到对端：保守记 open、标题兜编号——不猜成关闭（方向错了界面会画反）。
      blockedBy.push({ key: bk, title: '#' + bk, state: 'open', type: 'issue' })
    }
  }
  const data: Dependencies = { blockedBy, blocking: [] }
  return { ok: true, data }
}
