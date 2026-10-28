/**
 * rooms/markdown/maps.ts — 地图薄查（listMaps，#1605 交的真实现）。
 *
 * 薄查只回画清单要的四格（key/title/state/url），不读正文不聚合，正是 #1602 要的省量口。
 * 本地没有远端可筛：枚举（与 list 同一份 enumerateIssueRows）把全仓库行一次拿齐，
 * 本函数只做“内存复核”——类型是地图容器，或标签里有地图标签（大小写不敏感，与 parse.ts
 * 同一行判据），两处任中其一才收；回包按更新时间倒序重排。
 *
 * 失败口径与 counts 同例（#677 定下的那条）：票文件或票目录读不动就整趟失败，
 * 绝不回缺行的清单——界面把偏小的清单当全量画出来，正是要根治的那类毛病。
 * 地图容器文件（map.md）读不动是唯一的例外：枚举层把它记成一条 read.degraded 线不断趟，
 * 与 list 旧路同口径（本票不改旧路，薄查在这里也不另立口径，少的那一行在日志里有据可查）。
 * 日志不新增：op 复用 list；整趟失败的粗结论复用 list:fs-fail（与 list 旧路整趟失败同一行，
 * 文件明细在失败结果的原文里，不在日志里重复）；枚举层自带的 list:map-read-fail 照旧由枚举层记。
 * 注意没有 list:read-fail 这一档（登记表里只有 counts / listPage / get 的 read-fail，list 从不整趟失败，
 * 所以没给它留这一档）：本票不碰表，就用 list 已有的整趟失败行（#1058 双向对账的要求：新值先改表）。
 * 本地 url 诚实回空串（契约 MapRow 注明），key 沿用旧路的身份（容器 00、票保留编号）。
 */

import { ERROR_KIND, ISSUE_TYPE } from '../../contract/vocabulary.js'
import type { OpContext } from '../../contract/contexts.js'
import type { RepositoryRef, Issue } from '../../contract/entities.js'
import type { MapListResult, MapRow, OpResult } from '../../contract/results.js'
import { failAs, failFromError } from './error-fail.js'
import { emitReadDegraded } from './read-log.js'
import { enumerateIssueRows } from './issues-read.js'
import type { RowReadError } from './issues-read.js'

// 仓库引用：path 是本地后端的自有约定（契约不保证），有就多认那个目录（counts.ts 的同款）。
type RepoWithPath = RepositoryRef & { path?: string }

// 地图标签的内存复核：与 parse.ts 同一行判据（逐个转小写再比），类型没认出来的兜住。
const MAP_LABEL = 'wayfinder:map'
function hasMapLabel(labels: Issue['labels']): boolean {
  if (!Array.isArray(labels)) return false
  return labels.some((one: { name?: unknown }) => String((one && one.name) || '').trim().toLowerCase() === MAP_LABEL)
}

/** 把“读不动的票文件 / 读不动的票目录”清单拼成一句人看得懂的话（counts.ts 同款句式，名词换成清单）。 */
function mapReadFailureMessage(errors: RowReadError[]): string {
  const parts = errors.map(function (e) { return (e.key ? String(e.key) : '票目录') + '（' + String(e.path) + '）' })
  const first = errors[0] as RowReadError | undefined
  return '本地 Markdown 有票文件或票目录读不动，清单不完整，拒绝回缺行的清单：' + parts.join('、') +
    '（' + String((first && first.kind) || '') + '：' + String((first && first.message) || '') + '）'
}

/**
 * 地图薄查：纯地图筛的列表走这条快速路（#1604 分流进来），回四格行。
 * 工厂按“上下文在前”传参（与 list/issues 同列，见 index.ts）：listMaps(opCtx, repo)。
 *
 * @param ctx 本次调用的上下文（工厂把 opCtx||ctx 传进来）
 * @param repo 目标仓库（effortId 没给就是全仓库，与 list 同口径）
 */
export async function listMaps(
  ctx: OpContext,
  repo: RepoWithPath,
): Promise<OpResult<MapListResult>> {
  const t0 = Date.now()
  try {
    // 作用域与 list 同口径：repo 上没范围就是全仓库；枚举实现与 list 共用同一份，不另立。
    const scopeFilter = { effortId: (repo && (repo as { effortId?: string | null }).effortId) || undefined }
    const { rows, errors } = await enumerateIssueRows(ctx, repo, scopeFilter, { collectErrors: true, op: 'list' })
    if (errors.length) {
      const kind = errors[0].kind || ERROR_KIND.ENV
      // 整条失败之前记一行（#1058）：界面上只会看到“清单拉不出来”，日志这边留一句“走到枚举这一步、
      // 有票文件读不动”。哪个文件、哪一档错，失败结果的原文里已经列全，日志不重复。
      emitReadDegraded(ctx, 'list', 'list:fs-fail', Date.now() - t0)
      // 原文 = 每张读不动的票“编号（文件）+ 判出来的档位 + 那句错误”，一行一张。
      return failAs(kind, mapReadFailureMessage(errors), errors.map(function (e) {
        return String(e.key) + ' ' + String(e.path) + ' [' + String(e.kind || '') + '] ' + String(e.message || '')
      }).join('\n'))
    }
    const kept: { row: MapRow; updatedAt: string; seq: number }[] = []
    let seq = 0
    for (const row of rows) {
      if (!row) continue
      // 类型判在前、标签复核在后：与三房 T1 口径同序（标记→类型标签→形状），标签是复核不是改判。
      if (row.type !== ISSUE_TYPE.MAP && !hasMapLabel(row.labels)) continue
      kept.push({
        row: { key: String(row.key), title: row.title, state: row.state, url: '' },
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
        seq: seq++,
      })
    }
    // 更新时间倒序：缺时间的沉底（空串最小），同时间按枚举序（稳定，不让人猜）。
    kept.sort((a, b) => {
      if (a.updatedAt === b.updatedAt) return a.seq - b.seq
      if (!a.updatedAt) return 1
      if (!b.updatedAt) return -1
      return a.updatedAt < b.updatedAt ? 1 : -1
    })
    const thin = kept.map((k) => k.row)
    return { ok: true, data: { rows: thin, total: thin.length, truncated: false } }
  } catch (e) {
    // 枚举这一层之外冒上来的故障（列工作单元、读目录……）：整条失败，日志留一行“停在哪条操作”。
    emitReadDegraded(ctx, 'list', 'list:fs-fail', Date.now() - t0)
    return failFromError(e, ctx, '拉这个工作区的地图清单时出错')
  }
}

export default { listMaps }