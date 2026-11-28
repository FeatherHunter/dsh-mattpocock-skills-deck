/**
 * src/tracker/rooms/gitea/repo/permissions.ts —— gitea 房的仓库写权限读（契约 getRepoPermissions，票 #14）。
 *
 * 远端问法（本机 tea 0.16.0 实测）：`tea repos ls --output json --fields owner,name,permission`
 * 列出当前登录账号可见仓库的权限档，permission 取值 read / write / admin / owner。按 refId 的
 * owner/name 在清单里找当前仓库；tea 没有「按仓库查我的权限」的直查端点，翻页扫是唯一口径。
 *
 * 档位映射（判据一句：Gitea 的写权限天然带工单与标签管理权）：write / admin / owner → push 与
 * triage 都是 true；read → 都是 false。清单之外的档位（自建实例可能出的怪值）如实 parse 失败，
 * 不捏造布尔；扫完清单没找到这个仓库 → not-found——问不出就是问不出，调用方按未知处理。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { BackendContext, OpContext } from '../../../contract/contexts.js'
import type { RepositoryRef } from '../../../contract/entities.js'
import type { OpResult, RepoPermissions } from '../../../contract/results.js'
import { PAGINATION } from '../../../contract/pagination.js'
import { fail } from '../../../kernel/preflight.js'
import { failGitea } from '../errors.js'
import { type CtxLike, argsRepoScanPage, errMsg, parseJsonRows, refIdOf, runTea } from '../support/tea-run.js'

/** 权限档到 push/triage 的映射：true 与 false 都有名有据，清单之外的值不进这张表。 */
const WRITE_LIKE_PERMISSIONS = ['write', 'admin', 'owner']

/**
 * 读当前登录人对这个仓库的权限（契约 getRepoPermissions）。
 *
 * @param repo 目标仓库（refId 认 owner/name）
 * @param ctx 调用上下文（opCtx 缺时顶上）
 */
export async function getRepoPermissions(
  repo: Partial<RepositoryRef> | null | undefined,
  ctx: OpContext | null | undefined,
  opCtx?: BackendContext,
): Promise<OpResult<RepoPermissions>> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const refId = refIdOf(repo)
  if (!refId || !refId.includes('/')) {
    return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'getRepoPermissions: repo.refId 缺失或不是 owner/name 形状，无法对表', '')
  }
  const slash = refId.indexOf('/')
  const owner = refId.slice(0, slash)
  const name = refId.slice(slash + 1)
  const perPage = PAGINATION.gitea.repoScanPerPage
  const maxPages = PAGINATION.gitea.repoScanMaxPages
  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await runTea(effective, argsRepoScanPage(perPage, page))
      if (res.code !== 0) {
        return failGitea(new Error(res.stderr || res.stdout || 'getRepoPermissions: tea repos ls 失败'), '读仓库权限失败：tea repos ls 没有跑成。请稍后重试。', res, effective)
      }
      const text = typeof res.stdout === 'string' ? res.stdout : ''
      const rows = parseJsonRows(text)
      if (!rows) return fail(ERROR_KIND.PARSE as ErrorKind, 'getRepoPermissions: tea 回包不是预期的数组形状', text)
      for (const raw of rows) {
        const bag = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
        const rowOwner = bag && typeof bag['owner'] === 'string' ? bag['owner'] : ''
        const rowName = bag && typeof bag['name'] === 'string' ? bag['name'] : ''
        const perm = bag && typeof bag['permission'] === 'string' ? bag['permission'] : ''
        if (!rowOwner || !rowName || !perm) {
          return fail(ERROR_KIND.PARSE as ErrorKind, 'getRepoPermissions: 有一行缺 owner/name/permission，无法按契约回答', text)
        }
        if (rowOwner === owner && rowName === name) {
          if (WRITE_LIKE_PERMISSIONS.includes(perm)) {
            // write 及以上：推代码与管理工单/标签都是同档权限（Gitea 的角色模型）。
            const answer: RepoPermissions = { push: true, triage: true }
            return { ok: true, data: answer }
          }
          if (perm === 'read') {
            const answer: RepoPermissions = { push: false, triage: false }
            return { ok: true, data: answer }
          }
          return fail(ERROR_KIND.PARSE as ErrorKind, 'getRepoPermissions: 仓库权限档「' + perm + '」不在认得的清单里（read/write/admin/owner），如实回失败不猜', text)
        }
      }
      // 短页即末页（tea 翻页统一判据）：清单扫完没找到。
      if (rows.length < perPage) break
    }
    return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'getRepoPermissions: 当前登录账号可见的仓库清单里没有「' + refId + '」，问不出权限', '')
  } catch (err: unknown) {
    return failGitea(err, errMsg(err), err, effective)
  }
}
