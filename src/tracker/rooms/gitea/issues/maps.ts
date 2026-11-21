/**
 * src/tracker/rooms/gitea/issues/maps.ts —— gitea 房的探索地图清单读（契约 listMaps）。
 *
 * 契约口径（三个后端共用，写在 contract/results.ts 的 MapListOpResult 上）：
 *   · 固定查「打开 + 关闭」两种状态、标签 wayfinder:map（小写比对）——地图是标签语义，
 *     不是 Gitea 里的独立对象，所以靠标签翻页找；
 *   · 远端按创建时间倒序翻页取，交回前按更新时间重排（界面关心的是最近动过的地图）；
 *   · 翻到 mapListMaxPages 页还是满页就封顶，truncated=true 如实交代；
 *   · 任何一页读不成，整趟失败——地图清单宁可不给，不给一半。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { BackendContext, OpContext } from '../../../contract/contexts.js'
import type { RepositoryRef } from '../../../contract/entities.js'
import type { MapListOpResult, MapListResult, MapRow } from '../../../contract/results.js'
import { PAGINATION } from '../../../contract/pagination.js'
import { fail } from '../../../kernel/preflight.js'
import { failGitea } from '../errors.js'
import { normalizeIssue } from '../model/normalize.js'
import { type CtxLike, argsIssueListPage, errMsg, parseReadRows, readListCommandLabel, refIdOf, runRead } from '../support/tea-run.js'

/** 地图标签（契约写死）：比对时两边都转小写，Gitea 标签大小写不保证。 */
const MAP_LABEL = 'wayfinder:map'

/** 一条「进过候选」的行：排好序之前带着排序键（更新时间）与并列时的稳定序号。 */
type Kept = { row: MapRow; updatedAt: string; seq: number }

// 内存复核：归一后的标签逐个转小写再比，服务端万一没筛干净（或大小写口径不同），这里兜住。
function hasMapLabel(labels: unknown): boolean {
  if (!Array.isArray(labels)) return false
  return labels.some((l) => {
    const name = l !== null && typeof l === 'object' ? (l as { name?: unknown }).name : l
    return String(name || '').trim().toLowerCase() === MAP_LABEL
  })
}

/**
 * 列探索地图（契约 listMaps）：按创建时间倒序翻页，全仓两种状态都查。
 *
 * @param repo 目标仓库（只取 refId）
 * @param ctx 调用上下文（opCtx 缺时顶上）
 */
export async function listMaps(
  repo: Partial<RepositoryRef> | null | undefined,
  ctx: OpContext | null | undefined,
  opCtx?: BackendContext,
): Promise<MapListOpResult> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const refId = refIdOf(repo)
  if (!refId) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'listMaps: repo.refId 缺失，无法向 Gitea 列地图', '')
  const pageSize = PAGINATION.gitea.maxPerPage
  const maxPages = PAGINATION.gitea.mapListMaxPages
  const kept: Kept[] = []
  let truncated = false
  try {
    for (let page = 1; page <= maxPages; page += 1) {
      // --state all：地图开着关着都算地图；--labels 交远端 AND 筛，省得把整仓拉下来本地挑。
      const res = await runRead(effective, argsIssueListPage(refId, 'all', [MAP_LABEL], pageSize, page))
      if (res.code !== 0) {
        return failGitea(new Error(res.stderr || res.stdout || `listMaps: ${readListCommandLabel()} 失败`), `列地图失败：${readListCommandLabel()} 没有跑成。请稍后重试。`, res, effective)
      }
      const text = typeof res.stdout === 'string' ? res.stdout : ''
      const rows = parseReadRows(text)
      // 原文 = 远端回的那一段：看得出远端到底回了什么形状。
      if (!rows) return fail(ERROR_KIND.PARSE as ErrorKind, 'listMaps: tea 回包不是插件预期的数组形状', text)
      for (let i = 0; i < rows.length; i += 1) {
        const raw = rows[i] as Record<string, unknown> | null
        if (!raw || typeof raw !== 'object') continue
        // 标签语义靠归一层：normalizeIssue 之后 issue.type / labels 才是可信形状。
        const issue = normalizeIssue(raw)
        if (issue.type !== 'map' && !hasMapLabel(issue.labels)) continue
        kept.push({
          row: { key: issue.key, title: issue.title, state: issue.state, url: issue.url },
          updatedAt: issue.updatedAt ?? '',
          seq: kept.length,
        })
      }
      // 短页即最后一页（tea 翻页统一判据）；到顶还是满页就封顶交代。
      if (rows.length < pageSize) break
      if (page === maxPages) truncated = true
    }
  } catch (err: unknown) {
    return failGitea(err, errMsg(err), err, effective)
  }
  // 交回前按更新时间倒序重排：空串（没有更新时间）沉底；同时间的按翻页先后（seq）稳住。
  kept.sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) {
      if (!a.updatedAt) return 1
      if (!b.updatedAt) return -1
      return a.updatedAt < b.updatedAt ? 1 : -1
    }
    return a.seq - b.seq
  })
  const data: MapListResult = { rows: kept.map((x) => x.row), total: kept.length, truncated }
  return { ok: true, data }
}
