/**
 * src/tracker/rooms/gitea/support/expected-preflight.ts —— gitea 房写路径共用的
 * expectedUpdatedAt 前置读（票 #14 评审收编：原先在 labels/assign.ts 房内私有一份，
 * graph/write.ts 的 setParent / setBlockedBy 又各内联了一遍同形状的比对，三处收成这一处）。
 *
 * 纪律与 GitLab 房同一条：给了 expectedUpdatedAt 就先读一次票面比对更新时间，对不上回
 * conflict（透传档位），绝不后写覆盖先写；没给就不读，返回 null，由调用方自己决定要不要
 * 为后续步骤读票面。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { Issue } from '../../../contract/entities.js'
import type { SetOpts } from '../../../contract/inputs.js'
import type { OpResult } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import { failGitea } from '../errors.js'
import { fetchRawIssue } from '../issues/read.js'
import { type CtxLike, type RawBag, errMsg } from './tea-run.js'

/**
 * expectedUpdatedAt 前置读：给了这个选项就先读一次票面比对更新时间，对不上回 conflict。
 * 返回值三态：
 *  - null              ：没给 expectedUpdatedAt，什么都没读（调用方按需自己读票面）；
 *  - OpResult          ：前置读失败或版本对不上，conflict 已构造好（调用方直接 return）；
 *  - RawBag            ：版本对上了，附带回读到的票面供写路径继续用（省一次重复读）。
 */
export async function preflightExpected(
  effective: CtxLike | null | undefined,
  refId: string,
  k: string,
  opts: SetOpts | null | undefined,
): Promise<RawBag | OpResult<Issue> | null> {
  if (!opts || typeof opts.expectedUpdatedAt !== 'string' || opts.expectedUpdatedAt === '') return null
  let raw: RawBag
  try {
    raw = await fetchRawIssue(effective, refId, k)
  } catch (err: unknown) {
    // 前置读失败按读同档归一（带上下文，日志里留得下轨迹）。
    return failGitea(err, errMsg(err), err, effective ?? undefined)
  }
  const curUpdated = typeof raw['updated_at'] === 'string' ? String(raw['updated_at']) : ''
  if (curUpdated !== opts.expectedUpdatedAt) {
    // 原文 = 回读到的票面（人据此自己核对「远端现在是什么版本」）。conflict 构造后透传，不换话。
    return fail(ERROR_KIND.CONFLICT as ErrorKind, 'conflict: expectedUpdatedAt 不一致（期望 ' + opts.expectedUpdatedAt + '，远端 ' + curUpdated + '）', JSON.stringify(raw))
  }
  return raw
}
