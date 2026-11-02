// sub-issues.ts —— 本地 Markdown 后端的「一张容器的全部子票」（#1826）。
//
// 为什么需要它：宿主首屏（src/host/tracker/snapshotWorkingSet.ts）先只取开放票，再对每个开放容器
// 调 listSubIssues 把已关闭的子票补回来，进度环的分母才数得全。本后端在 #1796 之前没有这条能力、
// 回的是 unsupported，于是开放规格手里只剩开着的子票 —— 8 张实施票做完了 7 张，环上显示 0/1
// （#1826 的现场）。
//
// 子票的真源是哪一份：**与 list 同一份枚举**（issues-read.ts 的 enumerateIssueRows）。本地工作区
// 没有单独的「子票清单」文件：规格容器的子票靠票文件头的 DSH-PARENT 归属，地图容器的子票在旧布局
// 里靠目录归属、在本插件新建的票上靠 DSH-PARENT，两种来源已经在 loadIssueFromFile 里合成同一个
// parentKey。所以这里不另写一套「解析 map.md 里列出的票」的口径 —— 真实地图正文里被链接提到的票
// 既不是全量、也不只是子票（决议与排除记录里也会链票），照它数会把进度环数错；与 list 同源还有
// 一条好处：面板上看得见的票与这里数出来的子票永远对得上。
//
// 容器编号为什么不够、还要工作单元：规格与地图的容器编号都是 '00'，而一个工作区可以有多个工作单元，
// 每个都有自己的 00 号容器。调用方按「容器所属工作单元」把范围放进仓库引用（repo.effortId，宿主两处
// 调用已照做）；没给范围时，本函数只在这个编号恰好命中一个工作单元时自动定下，命中多个就如实报歧义
// （拒绝猜是哪一个）。
//
// 读不动的票、列不出的目录一律整体失败，不返回缺行的清单：进度环少算一张比整条失败更糟，
// 用户从画面上看不出数是错的。
import { ERROR_KIND, ISSUE_TYPE } from '../../contract/vocabulary.js'
import { TRACKER_ERROR_STAGE } from '../../contract/results.js'
import { failAs, failFromError, rawJson } from './error-fail.js'
import { emitReadDegraded } from './read-log.js'
import { enumerateIssueRows } from './issues-read.js'
import { readFailureMessage } from './counts.js'
import { scopeOf } from './issues-locate.js'
import type { OpContext } from '../../contract/contexts.js'
import type { Issue, RepositoryRef } from '../../contract/entities.js'
import type { SubIssueListResult } from '../../contract/results.js'

// 本地票仓引用：契约 RepositoryRef 之外，旧调用与测试夹具会用 path 直接当仓库根（各文件自包含）。
type RepoWithPath = RepositoryRef & { path?: string; mdScene?: string }
// 寻址选项取自 scopeOf 的形参（LocateOpts 不在 issues-locate 之外导出，按它推导最省事、也不会分叉）。
type LocateOptions = Parameters<typeof scopeOf>[1]

/** 一张行是不是容器行（规格或地图）。容器行不进子票清单：进度环数的是容器里的票。 */
function isContainerRow(row: Issue): boolean {
  return !!row && (row.type === ISSUE_TYPE.SPEC || row.type === ISSUE_TYPE.MAP)
}

/** 子票按编号升序：01、02…10 是自然顺序，退化身份（目录/编号-文件名）排在数字编号之后、按字典序。 */
function byKey(a: Issue, b: Issue): number {
  const ka = String(a && a.key !== undefined && a.key !== null ? a.key : '')
  const kb = String(b && b.key !== undefined && b.key !== null ? b.key : '')
  const na = /^\d+$/.test(ka)
  const nb = /^\d+$/.test(kb)
  if (na && nb) return Number(ka) - Number(kb)
  if (na !== nb) return na ? -1 : 1
  return ka < kb ? -1 : ka > kb ? 1 : 0
}

/**
 * 取一个容器的全部子票（含已关闭的那些）。
 *
 * @param ctx 单次调用上下文
 * @param repo 仓库引用；工作单元范围从 repo.effortId（或 opts.effortId）取
 * @param containerKey 容器编号（规格与地图都是 00）；数字或两位编号字符串
 * @param opts 寻址选项：effortId 覆盖 repo 上的范围（null 表示显式全仓库）
 *
 * 返回口径：本地没有远端总数、也不翻页，一次读到的就是全部，所以 total/fetched 都等于清单长度，
 * capped/missing 恒为否；dropped 也恒为 0 —— 认不出编号的文件在枚举阶段就退化成一行，仍然算一张
 * 子票，而不是被丢掉。
 */
export async function listSubIssues(ctx: OpContext, repo: RepoWithPath, containerKey: unknown, opts?: LocateOptions | null): Promise<SubIssueListResult> {
  const t0 = Date.now()
  const raw = containerKey === undefined || containerKey === null ? '' : String(containerKey).trim()
  const norm = /^\d+$/.test(raw) ? raw.padStart(2, '0') : ''
  if (!norm) {
    emitReadDegraded(ctx, 'listSubIssues', 'listSubIssues:bad-key', Date.now() - t0)
    return failAs(ERROR_KIND.PARSE, '子票取数：容器编号要是一个数字，收到的是「' + raw + '」', rawJson({ containerKey }), TRACKER_ERROR_STAGE.INPUT_REFUSED) as SubIssueListResult
  }
  const scope = scopeOf(repo, opts || undefined)
  try {
    // 一、先找容器行。keys 只筛票文件、容器行总会被枚举出来（所以这一趟不读票正文），
    //    但「枚举出来了」不等于「就是这个编号的容器」：规格与地图都占 00 号，别的编号在这里不可能命中，
    //    必须自己再按编号核一遍，否则请求 09 会被 00 号容器冒名认领。
    const found = await enumerateIssueRows(ctx, repo, { effortId: scope, keys: [norm] }, { collectErrors: true, op: 'listSubIssues' })
    const containers = found.rows.filter(function (row) { return isContainerRow(row) && String(row.key) === norm })
    if (!containers.length) {
      emitReadDegraded(ctx, 'listSubIssues', 'listSubIssues:notfound', Date.now() - t0)
      return failAs(ERROR_KIND.NOTFOUND, '子票取数：' + norm + ' 号容器没找到（这个范围里没有规格文件，也没有地图文件）', rawJson({ containerKey: norm, effort: scope })) as SubIssueListResult
    }
    // 二、定工作单元。调用方给了范围就听它的；没给时只在唯一命中时自动定，多个命中不猜。
    const efforts: string[] = []
    for (const container of containers) {
      const effort = container.effortId === undefined || container.effortId === null ? '' : String(container.effortId)
      if (!efforts.includes(effort)) efforts.push(effort)
    }
    if (efforts.length > 1) {
      emitReadDegraded(ctx, 'listSubIssues', 'listSubIssues:ambiguous', Date.now() - t0)
      return failAs(ERROR_KIND.CONFLICT, '子票取数：' + norm + ' 号容器在 ' + efforts.length + ' 个工作单元里都存在（' + efforts.join('、') + '），但这次调用没指定工作单元（effortId），拒绝猜是哪一个', rawJson({ containerKey: norm, efforts }), TRACKER_ERROR_STAGE.INPUT_REFUSED) as SubIssueListResult
    }
    const effort = efforts[0]
    // 三、取这个工作单元的票行，筛出父容器编号等于容器编号的那些（规格与地图的子票都是 DSH-PARENT: 00）。
    const read = await enumerateIssueRows(ctx, repo, { effortId: effort }, { collectErrors: true, op: 'listSubIssues' })
    if (read.errors.length) {
      emitReadDegraded(ctx, 'listSubIssues', 'listSubIssues:read-fail', Date.now() - t0)
      const rawLines = read.errors.map(function (err) { return err.key + ' ' + err.path + ' [' + err.kind + '] ' + err.message }).join('\n')
      return failAs(read.errors[0].kind || ERROR_KIND.ENV, readFailureMessage(read.errors), rawLines) as SubIssueListResult
    }
    const items = read.rows.filter(function (row) {
      return !!row && !isContainerRow(row) && row.parentKey !== undefined && row.parentKey !== null && String(row.parentKey) === norm
    })
    items.sort(byKey)
    return { ok: true, data: { items, total: items.length, fetched: items.length, capped: false, missing: 0, dropped: 0 } } as SubIssueListResult
  } catch (e) {
    emitReadDegraded(ctx, 'listSubIssues', 'listSubIssues:fs-fail', Date.now() - t0)
    return failFromError(e, ctx, '取这个容器（' + norm + ' 号）的子票时出错') as SubIssueListResult
  }
}
