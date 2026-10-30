/**
 * src/tracker/rooms/github/read/maps.ts -- 地图清单一次取全（#1603）。
 * #1686 阶段 1：从房间根迁入 read/，旧路径 src/tracker/rooms/github/maps.ts 保留纯转发，行为零变化。
 *
 * 为什么单开一个深模块：deck_context 取地图的旧路是全量 list 再内存过滤（缺陷 #1598：
 * 597 张票 + 193 个拉取请求，实测 163.9 秒撞预算超时）。这一条只干一件事 -- 一次翻完
 * 全仓地图的薄行，不碰正文、不问拉取请求。
 *
 * 做法（与票面一一对应）：
 *   一、只收仓库：状态 OPEN + CLOSED 写死、标签写死小写 wayfinder:map、时间窗口空。
 *      状态与标签都收进发给服务端的查询（listPage 的 filter.labels 走 filterBy.labels），
 *      内存里再按小写校验一遍标签，取交集（大小写标签都算地图，与 list 旧路同口径）。
 *   二、翻页复用 listPage（按创建时间倒序、薄片段、无 REST 兜底的那条路）：日志口径
 *      与那条路完全一致，本文件不新增日志事件与降级原因。
 *   三、交出前按更新时间重排（新动过的地图排前面，与旧路内存排序同一口径）。
 *   四、封顶页数（契约 pagination.ts 的 mapListMaxPages）：超顶停下来并如实说截断。
 *   五、单页失败整趟失败：不交半截数据；超时与传输失败不回落（listPage 本来就没有
 *      REST 兜底，失败直接向上传）。
 *
 * 不做的两件（都是故意的）：
 *  - 不在这里做 unsupported 回落：支不支持这条路是能力注册表的事（那一层才知道该回落到哪条旧路）。
 *  - 不在这里记第几页的点数：用量由操作表的外层按实际回包统一记（见 tracker-session）。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { OpContext } from '../../../contract/contexts.js'
import type { RepositoryRef, Label } from '../../../contract/entities.js'
import type { State } from '../../../contract/identity.js'
import type { MapListOpResult } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import { PAGINATION } from '../../../contract/pagination.js'
import { parseRepo, repoId } from '../model/issue-key.js'
import { listIssuesPage } from './page.js'
import { beginRead } from '../routing/read-result.js'
import { mapsProvenanceFromGraphql } from '../routing/read-assembly.js'

/** 地图薄行：画清单一行只用这四格。不带正文评论，不问拉取请求。 */
export interface MapRow {
  key: string
  title: string
  state: State
  url: string
}

/** 地图清单结果：rows 是收齐的地图薄行（按更新时间倒序），total 是服务端口径的地图总数，truncated 说明有没有被封顶截住。 */
export interface MapListResult {
  rows: MapRow[]
  total: number
  truncated: boolean
}

/** 服务端筛用的标签（小写）：内存里再按小写校验一遍，取交集。 */
const MAP_LABEL = 'wayfinder:map'
/** 一次最多翻几页：封顶数住契约 pagination.ts（改数要同步改 tests/verify-pagination-limits.ts）。 */
const MAX_PAGES = PAGINATION.github.mapListMaxPages
/** 一页要多少行：按分页契约上限要，远端按连接上限收敛（page.ts 里按 50 发）。 */
const PAGE_LIMIT = PAGINATION.github.limitMax

/** 内存二次校验：标签小写后命中 wayfinder:map 才算地图（服务端筛是大写的也认，与 list 旧路同口径）。 */
function hasMapLabel(labels: Label[] | undefined): boolean {
  if (!Array.isArray(labels)) return false
  for (const l of labels) {
    const name = l && typeof l.name === 'string' ? l.name : ''
    if (name && name.toLowerCase() === MAP_LABEL) return true
  }
  return false
}

/**
 * listMaps(repo, ctx) -> OpResult<MapListResult>
 *
 * 只收仓库，其余写死：状态 OPEN + CLOSED、标签小写 wayfinder:map、时间窗口空。
 * 单页失败整趟失败，不交半截数据；超顶截断时回成功但 truncated 为真。
 */
export async function listMaps(repo: RepositoryRef, ctx: OpContext): Promise<MapListOpResult> {
  // 读来源记录从入口起算（#1686）：成功时挂「行」「标签」两个字段组的完整度。
  const clock = beginRead()
  // 坐标形坏是调用方的错：一笔服务端往返都不做，直接失败。
  if (!parseRepo(repo)) {
    return fail(ERROR_KIND.NOTFOUND, 'listMaps: repo.refId missing or malformed: ' + repoId(repo), repo)
  }
  const collected: Array<{ row: MapRow; updatedAt: string; seq: number }> = []
  // 每张地图行的标签数组（#1686）：列表片段 labels(first:50) 没有 pageInfo，只能按「某行满 50 条」判标签截断。
  const labelsPerRow: Array<readonly unknown[]> = []
  let total = 0
  let firstPage = true
  let cursor = ''
  let truncated = false
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await listIssuesPage(repo, { labels: [MAP_LABEL] }, { limit: PAGE_LIMIT, cursor }, ctx)
    // 单页失败整趟失败：之前页拿到的也不交（交半截会让调用方以为这就是全仓）。
    if (!r.ok) return { ok: false, error: r.error }
    // 总数口径：服务端在同一标签筛下报的地图总数（每页都带，取第一页的）。
    if (firstPage) { total = r.data.total; firstPage = false }
    for (const it of r.data.items) {
      if (it.type !== 'map' && !hasMapLabel(it.labels)) continue
      collected.push({
        row: { key: it.key, title: it.title, state: it.state, url: it.url },
        updatedAt: it.updatedAt || '',
        seq: collected.length,
      })
      labelsPerRow.push(Array.isArray(it.labels) ? it.labels : [])
    }
    if (!r.data.nextCursor) break
    cursor = r.data.nextCursor
    // 这一页已经是最后一页的名额、但服务端说还有下一页：停下来，如实说截断。
    if (page === MAX_PAGES - 1) truncated = true
  }
  // 交出前按更新时间倒序重排（翻页是按创建时间走的，更新时间会跨页乱序）。
  // 更新时间缺失的沉底；时间相同的保持翻页先后（sort 稳定，再加序号兜底）。
  collected.sort((a, b) => {
    if (a.updatedAt === b.updatedAt) return a.seq - b.seq
    if (!a.updatedAt) return 1
    if (!b.updatedAt) return -1
    return a.updatedAt < b.updatedAt ? 1 : -1
  })
  return { ok: true, data: { rows: collected.map((x) => x.row), total, truncated }, provenance: mapsProvenanceFromGraphql(clock, { truncated, labelsPerRow }) }
}

export default { listMaps }
