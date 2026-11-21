/**
 * src/tracker/rooms/gitea/repo/current-user.ts —— gitea 房的一条单点读：这个远端上「我是谁」
 * （契约 getCurrentUser，票 #14）。
 *
 * 远端问法（本机 tea 0.16.0 实测）：`tea whoami` 只出人读的表格、不认 --output json，所以不走它；
 * 登录清单 `tea logins ls --output json` 里每条带 name/url/user/default，default 标了默认登录、
 * user 字段就是登录名——从那里取。契约的 Actor 只要 login 一格，这里不编名字与头像。
 *
 * 认不出唯一默认登录时如实 parse 失败（标记了多条默认、或一条默认都没有且登录不止一条）：
 * 「我是谁」答错比答不出更糟，不猜。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { Actor, ErrorKind } from '../../../contract/identity.js'
import type { BackendContext, OpContext } from '../../../contract/contexts.js'
import type { RepositoryRef } from '../../../contract/entities.js'
import type { ActorResult } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import { failGitea } from '../errors.js'
import { type CtxLike, type RawBag, argsLoginList, errMsg, parseJsonRows, refIdOf, runTea } from '../support/tea-run.js'

/**
 * 读当前登录人（契约 getCurrentUser）。
 *
 * @param repo 目标仓库（只取 refId，入口检查与房内其余读同一套）
 * @param ctx 调用上下文（opCtx 缺时顶上）
 */
export async function getCurrentUser(
  repo: Partial<RepositoryRef> | null | undefined,
  ctx: OpContext | null | undefined,
  opCtx?: BackendContext,
): Promise<ActorResult> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const refId = refIdOf(repo)
  if (!refId) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'getCurrentUser: repo.refId 缺失，无法向 Gitea 问当前登录人', '')
  try {
    const res = await runTea(effective, argsLoginList())
    if (res.code !== 0) {
      return failGitea(new Error(res.stderr || res.stdout || 'getCurrentUser: tea logins ls 失败'), '读当前登录人失败：tea logins ls 没有跑成。请先 `tea login list` 确认已登录。', res, effective)
    }
    const text = typeof res.stdout === 'string' ? res.stdout : ''
    const rows = parseJsonRows(text)
    if (!rows) return fail(ERROR_KIND.PARSE as ErrorKind, 'getCurrentUser: tea logins ls 回包不是预期的数组形状', text)
    // default 可能是字符串 'true'（tea 实测）也可能是布尔，两种都认。
    const bagOf = (raw: unknown): RawBag | null =>
      raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as RawBag) : null
    const marked = rows.map(bagOf).filter((b): b is RawBag => !!b && (b['default'] === true || b['default'] === 'true'))
    let chosen: RawBag | null = null
    if (marked.length === 1) chosen = marked[0]
    else if (marked.length === 0 && rows.length === 1) chosen = bagOf(rows[0])
    if (!chosen) {
      return fail(ERROR_KIND.PARSE as ErrorKind, 'getCurrentUser: 登录清单里认不出唯一的默认登录（标记默认的 ' + String(marked.length) + ' 条、共 ' + String(rows.length) + ' 条）', text)
    }
    const login = chosen['user']
    if (typeof login !== 'string' || !login.trim()) {
      return fail(ERROR_KIND.PARSE as ErrorKind, 'getCurrentUser: 默认登录那一条缺 user 字段，认不出登录名', text)
    }
    const actor: Actor = { login }
    return { ok: true, data: actor }
  } catch (err: unknown) {
    return failGitea(err, errMsg(err), err, effective)
  }
}
