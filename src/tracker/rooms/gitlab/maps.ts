/**
 * rooms/gitlab/maps.ts — 地图薄查（listMaps，#1605 交的真实现）。
 *
 * 薄查只回画清单要的四格（key/title/state/url），不读正文不聚合，正是 #1602 要的省量口。
 * 做法与 GitHub 房 maps.ts 同一契约（见 tracker/contract.ts「地图薄查」）：服务端先按
 * 地图标签筛一遍，回来内存里再复核一遍（大小写不敏感），两处都认的才收；内部按创建时间
 * 倒序翻页，回包按更新时间倒序重排；单页失败整趟失败，不回半份；超时与传输失败如实报错，
 * 绝不回落到老路（回落的唯一条件是“不支持”，本房今天起支持，见下）。
 *
 * 上限 10 页与 GitHub 房 PAGINATION.github.mapListMaxPages 取同数：同一份契约、同一上限，
 * 两房行为一致才不让人猜。分页常量住本文件，不碰共享分页表（本票只许动这一行涉及的登记）。
 * 状态必须显式传 state=all：GitLab 缺省只回开着的票，漏了已关闭的地图就是半份。
 * 日志不新增：读路径沿用 listIssues 的做法（glab 调用本身不记 read.degraded 行，
 * 失败直接回错），不引入新的 op/reason 取值。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { ErrorKind } from '../../contract/identity.js'
import type { BackendContext, OpContext } from '../../contract/contexts.js'
import type { RepositoryRef } from '../../contract/entities.js'
import type { MapListResult, MapRow, OpResult } from '../../contract/results.js'
import { fail } from '../../kernel/preflight.js'
import { glabClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { failGlab } from './errors.js'
import { issuesPath } from './queries.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml（与 listIssues 同一慢读档）。
import { GITLAB_SLOW_READ_TIMEOUT_MS } from '../../../shared/time-config/src/values.js'

// 仓库身份只取 refId/name：票读写只认这两样，拿全量会把 effortId 搅进来（与 issues.ts 同款）。
type RepoLike = Partial<RepositoryRef> | null | undefined
// 上下文两形都收：调用方有时把执行器放在 ctx、有时放在 opCtx，缺了就让 glabClient 按 127 回。
type CtxLike = Partial<OpContext> & Partial<BackendContext>

// 地图标签：服务端筛与内存复核用同一个小写名，内存复核逐个转小写再比（服务端大小写口径不保证）。
const MAP_LABEL = 'wayfinder:map'
// 一页 100 行：GitLab 单页上限，sub-issues 房同数。
const PAGE_SIZE = 100
// 最多翻 10 页：与 GitHub 房同数（见文件头），撞上限挂 truncated，不装“全了”。
const MAX_MAP_PAGES = 10

function repoId(repo: RepoLike): string {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

function parseJsonSafe(s: string): unknown {
  try {
    return JSON.parse(s) as unknown
  } catch {
    return null
  }
}

function errMsg(err: unknown): string {
  if (err !== null && typeof err === 'object' && 'message' in (err as Record<string, unknown>)) {
    const m = (err as Record<string, unknown>)['message']
    if (typeof m === 'string' && m) return m
  }
  return String(err)
}

// 内存复核：归一后的标签逐个转小写再比，服务端万一没筛干净（或大小写口径不同），这里兜住。
function hasMapLabel(labels: unknown): boolean {
  if (!Array.isArray(labels)) return false
  return labels.some((l) => {
    const name = l !== null && typeof l === 'object' ? (l as { name?: unknown }).name : l
    return String(name || '').trim().toLowerCase() === MAP_LABEL
  })
}

/**
 * 地图薄查：只筛地图标签的列表走这条快速路（#1604 分流进来），回四格行。
 *
 * @param repo 目标仓库（只取 refId/name）
 * @param opCtx 本次调用的上下文（工厂把 opCtx||ctx 传进来，执行器在这上面）
 */
export async function listMaps(
  repo: RepoLike,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<MapListResult>> {
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'listMaps: repo.refId missing', '')
  const kept: { row: MapRow; updatedAt: string; seq: number }[] = []
  let seq = 0
  let truncated = false
  try {
    const c = glabClient(opCtx as Partial<OpContext> & Partial<BackendContext>)
    for (let page = 1; page <= MAX_MAP_PAGES; page++) {
      const params = new URLSearchParams()
      params.set('per_page', String(PAGE_SIZE))
      params.set('page', String(page))
      params.set('with_labels_details', 'true')
      params.set('state', 'all')
      params.set('labels', MAP_LABEL)
      params.set('order_by', 'created_at')
      params.set('sort', 'desc')
      const apiPath = issuesPath(id, params.toString())
      const res = await c.run(['api', apiPath], { timeout: GITLAB_SLOW_READ_TIMEOUT_MS })
      if (res.code !== 0) {
        // 原文 = 断掉的那一次 glab 调用的进程结果：此前页攒的行全部作废，不回半份。
        return failGlab(res, res.stderr || res.stdout || 'listMaps failed', res, opCtx)
      }
      const arr: unknown = parseJsonSafe(res.stdout)
      // 原文 = 远端回的那一段：不是数组就整趟失败，人据此看出服务端到底回了什么形状。
      if (!Array.isArray(arr)) return fail(ERROR_KIND.PARSE as ErrorKind, 'listMaps returned non-array', res.stdout)
      for (const raw of arr as unknown[]) {
        const issue = normalizeIssue(raw)
        // 类型判在前、标签复核在后：与三房 T1 口径同序（标记→类型标签→形状），标签只作复核。
        if (issue.type !== 'map' && !hasMapLabel(issue.labels)) continue
        kept.push({
          row: { key: String(issue.key), title: issue.title, state: issue.state, url: issue.url },
          updatedAt: typeof issue.updatedAt === 'string' ? issue.updatedAt : '',
          seq: seq++,
        })
      }
      // 不满一页说明服务端没有下一页；满页才继续（与 sub-issues 房同口径）。
      if ((arr as unknown[]).length < PAGE_SIZE) break
      // 满 10 页还有下一页：截断并挂旗，不装“全了”。
      if (page === MAX_MAP_PAGES) truncated = true
    }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error（超时、执行器故障都在这里）：如实失败，不回落。
    return failGlab(err, errMsg(err), err, opCtx)
  }
  // 更新时间倒序：缺时间的沉底（空串最小），同时间按抓取序（稳定，不让人猜）。
  kept.sort((a, b) => {
    if (a.updatedAt === b.updatedAt) return a.seq - b.seq
    if (!a.updatedAt) return 1
    if (!b.updatedAt) return -1
    return a.updatedAt < b.updatedAt ? 1 : -1
  })
  const rows = kept.map((k) => k.row)
  return { ok: true, data: { rows, total: rows.length, truncated } as MapListResult }
}