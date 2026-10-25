// tests/verify-1418-probe-cost-and-failure.ts —— 门禁：#1418 探测每拍被整页拒绝，且失败在界面上看不见
//
// 现场（2026-10-24 实测）：刷新后台每拍探测都去翻「全仓票索引」，每页向 GitHub 要 200 条；
// 而 issues / pullRequests 两条 GraphQL 连接自己只肯给 100 条一页，多要的话整页回
//   Requesting 200 records on the `issues` connection exceeds the `first` limit of 100 records.
// 于是探测自那天 16:15 起每一拍都失败。更糟的是客户端那一侧只留了一行日志就 return ——
// 面板看起来和「没有变化」一模一样，用户只会觉得刷新坏了、却看不到任何原因。
//
// 本门禁量五组事：
//   A. 发给远端的 first 一定不超过连接上限（界面仍可以要 200 行，那是分页契约的口径）；
//      since 窗口真的进了 argv 与查询文本（服务端只回更新过的票，稳态不用整仓翻页）；
//      实测那句拒绝原文归「不支持」档 —— 重试无用，不许被兜底说成网络问题让人等一会儿再试。
//   B. 刷新后台的索引扫描把窗口交给会话、单页条数跟随契约；非法的窗口串不往房间塞；
//      窗口内的票进索引、窗口外的被挡掉（服务端筛 + 本地再比一次，两道都在）。
//   C. 探测失败要看得见：本组会话进入 err 且带原因、旧快照不被丢弃；同样的失败不重复渲染；
//      恢复那一拍撤掉标记；别的失败（取数 / 配额）不被探测成功抹掉；别的会话不被误伤。
//   D. 失败判档要能读出来（核心日志）：宿主回包带 errorKind；客户端那行 host.call.fail 写出 errorKind。
//   E. P1 起探测只跟「人正在看的那个工作区」：不再逐个轮询所有工作区；连续无变化时后台拍与活跃拍
//      各按自己的正常间隔逐级拉长；两桶裁决按「这次操作真正会出的通道（含前置读）」分——建票两族
//      都要（写 REST、建前锚回查 GraphQL），改票 / 关票 / 父子边只看 GraphQL，评论与阻塞边两条路任一；
//      见底文案点名缺的是哪种额度、还剩多少、大概什么时候恢复。
//
// 判据不是「源码里出现过某段字符串」，而是把真源码加载起来喂输入，看它发出什么命令、改出什么状态。
//
// 门禁归属: src/tracker/rooms/github/page.ts
// 门禁归属: src/tracker/rooms/github/queries.ts
// 门禁归属: src/tracker/rooms/github/errors.ts
// 门禁归属: src/refresh/rooms/host/issue-list-fetch.ts
// 门禁归属: src/refresh/rooms/client/refresh-timer.ts
// 门禁归属: src/refresh/rooms/host/probe-handler.ts
// 门禁归属: src/refresh/kernel/budget-admission.ts
// 门禁归属: src/tracker/rooms/github/read-log.ts
// 门禁归属: src/host/namingGuardian.ts
//
// 跑法（在插件根目录；不需要先构建，本门禁跑的是真源码）：
//   node --import ./scripts/ts-hook.mts tests/verify-1418-probe-cost-and-failure.ts
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { compileFn } from './lib/eval-probe.js'
import { sourceText, spliceableJs } from './lib/source-text.ts'
import { PAGINATION } from '../src/tracker/contract/pagination.js'
import { ERROR_KIND } from '../src/tracker/contract/vocabulary.js'
import { listIssuesPage } from '../src/tracker/rooms/github/page.js'
import { LIST_PAGE_QUERY, LIST_PAGE_QUERY_WITH_LABELS } from '../src/tracker/rooms/github/queries.js'
import { ghVerdictOf } from '../src/tracker/rooms/github/errors.js'
import { createIssueList } from '../src/refresh/rooms/host/issue-list-fetch.js'
import { createProbeHandler } from '../src/refresh/rooms/host/probe-handler.js'
import { decideByBudget } from '../src/refresh/kernel/budget-admission.js'
import { refusalTextRef } from '../src/refresh/rooms/host/refusal-messages.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

let failed = false
let total = 0
const check = function (ok: any, msg: string, got?: any): void {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (got === undefined ? '' : '（实得 ' + String(got) + '）'))
  if (!ok) failed = true
}
const tick = function (): Promise<void> {
  return new Promise(function (resolve) { setTimeout(resolve, 0) })
}
const noop = function (): void {}

// 把一份「一源一物」的真源码当模块跑起来：剥掉行首 export（spliceableJs 已做），把跨闭包名字
// 按参数塞进来，末尾交出这门禁要用的出口。手法与 tests/verify-1355-cross-session-table.ts 同源。
const loadSpliced = function (relPath: string, exportNames: string[], scope: Record<string, any>): any {
  const paramNames = Object.keys(scope)
  const fn = compileFn(paramNames, spliceableJs(relPath) + '\nreturn { ' + exportNames.join(', ') + ' }')
  return fn.apply(null, paramNames.map(function (k) { return scope[k] }))
}

// 一次 gh 回包里「一页票」的最小形状（page.ts 只读三层：errors / data.repository.issues）。
const pageJson = function (opts?: any): string {
  const bag: any = opts || {}
  const items = bag.items || []
  const next = bag.next || null
  return JSON.stringify({
    data: { repository: { issues: {
      nodes: items,
      totalCount: typeof bag.total === 'number' ? bag.total : items.length,
      pageInfo: { hasNextPage: !!next, endCursor: next },
    } } },
  })
}
// gh 参数里找某个「前缀=值」那一格，返回它的值；找不到回 null。
const argValueOf = function (args: string[], prefix: string): string | null {
  for (let i = 0; i < args.length; i++) {
    if (typeof args[i] === 'string' && args[i].indexOf(prefix + '=') === 0) return args[i].slice(prefix.length + 1)
  }
  return null
}
// 某个「前缀=值」那一格前面挂的是 -F（类型推断）还是 -f（原始字符串）。
const flagOf = function (args: string[], prefix: string): string {
  for (let i = 0; i < args.length; i++) {
    if (typeof args[i] === 'string' && args[i].indexOf(prefix + '=') === 0) return i > 0 ? args[i - 1] : ''
  }
  return ''
}

// ---------------------------------------------------------------------------------------------
// A. 发给远端的单页条数与 since 窗口；实测拒绝原文的判档
// ---------------------------------------------------------------------------------------------
const partA = async function (): Promise<void> {
  console.log('#1418 A. 单页条数不超过连接上限、since 窗口进 argv、整页拒绝归不支持档')

  // 房间的出站能力由宿主注入 ctx.outbound（#1159）；夹具挂生产那一份，证明注入进来的端口真能用。
  const outboundMod: any = await import(pathToFileURL(path.join(ROOT, 'src/refresh/rooms/host/outbound-control.ts')).href)
  const outbound = outboundMod.createOutboundControl()
  const calls: any[] = []
  let nextResult: any = null
  // A8 要用「第一次被拒、第二次成功」这两拍：队列里排好的回包优先于 nextResult。
  let execQueue: any[] = []
  // 降级那一行 read.degraded 要能看到字段：把 ctx 的日志口接到这个数组上。
  const logged: any[] = []
  const fakeExec = async function (cmd: any, args: any, execOpts: any): Promise<any> {
    calls.push({ cmd: cmd, args: Array.prototype.slice.call(args), execOpts: execOpts })
    if (execQueue.length) return execQueue.shift()
    return nextResult || { stdout: pageJson(), stderr: '', code: 0 }
  }
  const ctx: any = {
    outbound: outbound,
    platform: { resolveExecutable: async function (): Promise<string> { return 'gh' } },
    exec: fakeExec,
    cwd: '.',
    logEvent: function (level: string, event: string, fields: any): void { logged.push({ level: level, event: event, fields: fields }) },
    isEnabled: function (): boolean { return false },
  }
  const repo: any = { backend: 'github', refId: 'FeatherHunter/dsh-mattpocock-skills-deck', name: 'dsh-mattpocock-skills-deck', url: '' }

  // 查询文本本身先钉两处：窗口变量已声明、filterBy 真的用它（变量声明了却没用，等于没窗口）。
  check(LIST_PAGE_QUERY.indexOf('$since:DateTime') >= 0, 'A、整仓列表查询声明了 $since:DateTime')
  check(LIST_PAGE_QUERY.indexOf('filterBy:{since:$since}') >= 0, 'A、整仓列表查询用 filterBy.since 把窗口交给服务端')
  check(LIST_PAGE_QUERY_WITH_LABELS.indexOf('$since:DateTime') >= 0 && LIST_PAGE_QUERY_WITH_LABELS.indexOf('labels:$labels, since:$since') >= 0,
    'A、带标签筛的那条查询同样带 since 窗口（两条路不能一条有、一条没有）')

  // A1. 界面按分页契约要 200 行，发给远端的 first 必须是连接上限 100。
  calls.length = 0
  let r: any = await listIssuesPage(repo, undefined, { limit: PAGINATION.github.limitMax }, ctx)
  check(r && r.ok === true, 'A、limit=200 的那一页取数仍按正常回包返回', r && r.error && r.error.message)
  const firstArgs: string[] = calls.length ? calls[calls.length - 1].args : []
  check(argValueOf(firstArgs, 'first') === String(PAGINATION.github.listPageSize),
    'A、界面要 200 行时发给远端的 first 夹到连接上限 ' + PAGINATION.github.listPageSize, argValueOf(firstArgs, 'first'))
  check(flagOf(firstArgs, 'first') === '-F', 'A、first 仍用 -F（整型字段，不做字符串归一）')
  check(flagOf(firstArgs, 'owner') === '-f', 'A、owner 用 -f（#1375：纯数字账号不许被发成 JSON 数字）')

  // A2. since 窗口真的进了 argv，并且转成 UTC ISO 串再给远端。
  calls.length = 0
  r = await listIssuesPage(repo, { since: '2026-10-24T08:00:00+08:00' }, { limit: 100 }, ctx)
  const sinceArgs: string[] = calls.length ? calls[calls.length - 1].args : []
  check(argValueOf(sinceArgs, 'since') === '2026-10-24T00:00:00.000Z',
    'A、since 窗口进了 argv 且归一成 UTC ISO 串', argValueOf(sinceArgs, 'since'))
  check(flagOf(sinceArgs, 'since') === '-F', 'A、since 用 -F（DateTime 变量）')
  check(!!r && r.ok === true, 'A、带窗口的一页取数正常返回')

  // A3. 非法的窗口串不往房间塞：整页报错是故障，多翻几页是浪费，这里选后者。
  calls.length = 0
  await listIssuesPage(repo, { since: 'not-a-date' }, {}, ctx)
  const badSinceArgs: string[] = calls.length ? calls[calls.length - 1].args : []
  check(argValueOf(badSinceArgs, 'since') === null, 'A、非法 since 不发给远端（当作不设窗口）', argValueOf(badSinceArgs, 'since'))
  check(!!argValueOf(badSinceArgs, 'first'), 'A、没给 limit 时仍按契约缺省 50 发一页')

  // A4. 标签筛与状态筛走另一条查询，窗口同样跟着。
  calls.length = 0
  await listIssuesPage(repo, { labels: ['bug'], state: 'open', since: '2026-10-24T00:00:00.000Z' }, {}, ctx)
  const labelArgs: string[] = calls.length ? calls[calls.length - 1].args : []
  const labelQuery = argValueOf(labelArgs, 'query')
  check(labelQuery === LIST_PAGE_QUERY_WITH_LABELS, 'A、带标签筛时用带 labels 的那条查询')
  check((labelArgs || []).indexOf('states[]=OPEN') >= 0 && (labelArgs || []).indexOf('states[]=CLOSED') < 0,
    'A、state=open 只带 OPEN 一种状态')
  check((labelArgs || []).indexOf('labels[]=bug') >= 0, 'A、标签名进 labels[] 参数')
  check(argValueOf(labelArgs, 'since') === '2026-10-24T00:00:00.000Z', 'A、带标签筛时窗口照样进 argv')

  // A5. 回包里的游标与总数如实交回；下一页的游标原样进 after。
  calls.length = 0
  nextResult = { stdout: pageJson({ items: [], next: 'cursor-1', total: 42 }), stderr: '', code: 0 }
  r = await listIssuesPage(repo, undefined, { limit: 100 }, ctx)
  check(!!r && r.ok === true && r.data.nextCursor === 'cursor-1', 'A、回包说有下一页时把游标交回', r && r.data && r.data.nextCursor)
  check(!!r && r.ok === true && r.data.total === 42, 'A、回包里的总数原样交回', r && r.data && r.data.total)
  calls.length = 0
  await listIssuesPage(repo, undefined, { limit: 100, cursor: 'cursor-1' }, ctx)
  const cursorArgs: string[] = calls.length ? calls[calls.length - 1].args : []
  check(argValueOf(cursorArgs, 'after') === 'cursor-1', 'A、翻下一页时游标原样进 after')

  // A6. 实测那句整页拒绝：按退出码路径判档，必须归「不支持」档（重试无用）。
  const measured = 'gh: Requesting 200 records on the `issues` connection exceeds the `first` limit of 100 records.'
  nextResult = { stdout: '', stderr: measured, code: 1 }
  calls.length = 0
  r = await listIssuesPage(repo, undefined, { limit: 200 }, ctx)
  check(!!r && r.ok === false, 'A、整页被拒时取数如实失败')
  check(!!r && r.ok === false && r.error && r.error.kind === ERROR_KIND.UNSUPPORTED,
    'A、实测拒绝原文归「不支持」档（界面不该说「稍后再试」）', r && r.error && r.error.kind)
  check(!!r && r.ok === false && String((r.error && r.error.message) || '').indexOf('exceeds') >= 0,
    'A、失败回执里保留原话，人自己能看出是被拒了')
  nextResult = null

  // 判档表本身：实测样本必须正好落在它声明的档位；无关失败的档位不许被这条规则抢走。
  check(ghVerdictOf({ code: 1, text: measured }).kind === ERROR_KIND.UNSUPPORTED,
    'A、实测原文直接喂判档表 → 不支持档')
  check(ghVerdictOf({ text: 'EXCESSIVE_PAGINATION: Requesting 200 records' }).kind === ERROR_KIND.UNSUPPORTED,
    'A、GitHub 的 EXCESSIVE_PAGINATION 写法同样归不支持档')
  check(ghVerdictOf({ code: 1, text: 'HTTP 500: Internal Server Error' }).kind !== ERROR_KIND.UNSUPPORTED,
    'A、无关的 500 不被这条规则抢走（判据只认单页上限那句）')

  // A7. 连接上限只有一个真源：page.ts 的夹取值来自契约的分页表，不在房里另写一个数。
  const pageSrc = sourceText('src/tracker/rooms/github/page.ts')
  check(pageSrc.indexOf('PAGINATION.github.listPageSize') >= 0, 'A、单页上限取自契约分页表（listPageSize）')

  // A8. 远端说「一次要多了」时的分页降级：换更小的 first 重发、记住这个上限、下一拍直接按学到的上限发。
  //     这一组必须放在 A 组最后：学到上限之后进程内会一直按它发，前面的 A1–A4 都假定起点是 100。
  const rejectPayload = JSON.stringify({ errors: [{ type: 'EXCESSIVE_PAGINATION', message: 'Requesting 100 records on the `issues` connection exceeds the `first` limit of 50 records.' }] })
  execQueue = [
    { stdout: rejectPayload, stderr: '', code: 0 },
    { stdout: pageJson({ items: [], next: null, total: 0 }), stderr: '', code: 0 },
  ]
  calls.length = 0
  r = await listIssuesPage(repo, undefined, { limit: 200 }, ctx)
  check(!!r && r.ok === true, 'A、远端只肯给更小的一页时，换小 first 重发后这一页能取回来', r && r.error && r.error.message)
  check(calls.length === 2, 'A、降级只重发一次（不是撞到同一条错就无限重试）', calls.length)
  const degradeArgs0: string[] = calls.length > 0 ? calls[0].args : []
  const degradeArgs1: string[] = calls.length > 1 ? calls[1].args : []
  check(argValueOf(degradeArgs0, 'first') === '100' && argValueOf(degradeArgs1, 'first') === '50',
    'A、第一次发 100、第二次按远端说的上限 50 重发', argValueOf(degradeArgs0, 'first') + '→' + argValueOf(degradeArgs1, 'first'))

  // 学到上限之后：新的一次调用一开始就发 50，不再拿 100 去撞一次。
  calls.length = 0
  r = await listIssuesPage(repo, undefined, { limit: 200 }, ctx)
  const learnedArgs: string[] = calls.length ? calls[0].args : []
  check(calls.length === 1 && argValueOf(learnedArgs, 'first') === '50',
    'A、这一页失败过一次之后，下一拍直接用学到的上限（不再重撞）', argValueOf(learnedArgs, 'first') + '/' + calls.length)

  // 降级这一趟必须落一行 read.degraded：reason、判档、前后条数四样都要读得出来。
  const degradeRow: any = logged.filter(function (l: any): boolean { return l && l.event === 'read.degraded' && l.fields && l.fields.reason === 'listPage:page-size' })[0]
  check(!!degradeRow, 'A、换页大小这一趟落了 read.degraded（listPage:page-size）')
  check(!!degradeRow && degradeRow.fields.kind === ERROR_KIND.UNSUPPORTED,
    'A、降级那行的判档写出 unsupported（重试无用、要换页大小）', degradeRow && degradeRow.fields && degradeRow.fields.kind)
  check(!!degradeRow && degradeRow.fields.limitBefore === 100 && degradeRow.fields.limitAfter === 50,
    'A、降级那行写出前后单页条数 100→50', degradeRow && degradeRow.fields && (degradeRow.fields.limitBefore + '→' + degradeRow.fields.limitAfter))
}

// ---------------------------------------------------------------------------------------------
// B. 刷新后台的索引扫描：窗口交给会话、单页条数跟随契约、窗口外的不进索引
// ---------------------------------------------------------------------------------------------
const partB = async function (): Promise<void> {
  console.log('#1418 B. 索引扫描把窗口交给会话、单页条数跟随契约')

  const seen: any[] = []
  const session: any = {
    listPage: async function (ref: any, filter: any, opts: any): Promise<any> {
      seen.push({ ref: ref, filter: filter, opts: opts })
      if (seen.length === 1) {
        return { ok: true, data: {
          items: [
            { key: '101', state: 'open', updatedAt: '2026-10-24T09:00:00.000Z' },
            // 窗口外的票：服务端按 since 筛过一轮，本地还要再比一次（两道都要在）。
            { key: '100', state: 'open', updatedAt: '2026-10-23T09:00:00.000Z' },
          ],
          nextCursor: 'p2', total: 2,
        } }
      }
      return { ok: true, data: { items: [{ key: '102', state: 'closed', updatedAt: '2026-10-24T10:00:00.000Z' }], nextCursor: null, total: 3 } }
    },
  }
  const deps: any = {
    openSession: async function (): Promise<any> { return { ok: true, backendId: 'github', call: async function (fn: any): Promise<any> { return fn(session, {}) } } },
    getRepoKey: async function (): Promise<any> { return { owner: 'FeatherHunter', name: 'dsh-mattpocock-skills-deck' } },
    setCache: noop, issueIndexFromSnapshot: function (): any { return null }, issueIndexChanged: function (): boolean { return false },
    rememberIssueIndex: noop, readDiskCache: function (): any { return null }, logCtx: {},
  }
  const list = createIssueList(deps)

  const sinceIso = '2026-10-24T08:00:00.000Z'
  let r: any = await list.fetchIssueIndex('/w', sinceIso)
  check(!!r && r.ok === true, 'B、带窗口的索引扫描正常返回', r && r.error && (r.error.error || r.error.kind))
  check(seen.length === 2, 'B、回包说有下一页就继续翻（两页都取了）', seen.length)
  check(!!seen[0] && !!seen[0].filter && seen[0].filter.since === sinceIso,
    'B、窗口原样交给会话（服务端只回更新过的票）', seen[0] && JSON.stringify(seen[0].filter))
  check(!!seen[0] && !!seen[0].opts && seen[0].opts.limit === PAGINATION.github.listPageSize,
    'B、单页条数跟随契约的 github.listPageSize（' + PAGINATION.github.listPageSize + '）', seen[0] && seen[0].opts && seen[0].opts.limit)
  check(!!seen[1] && !!seen[1].opts && seen[1].opts.cursor === 'p2', 'B、第二页把上一页的游标原样带上', seen[1] && seen[1].opts && seen[1].opts.cursor)
  check(!!r && r.ok === true && !!r.repo && r.repo.owner === 'FeatherHunter', 'B、回包带出仓库坐标（上层据此判串仓）')
  check(!!r && r.ok === true && Object.prototype.hasOwnProperty.call(r.index, '101'), 'B、窗口内的票进了索引')
  check(!!r && r.ok === true && !Object.prototype.hasOwnProperty.call(r.index, '100'), 'B、窗口外的票不进索引（本地再比一次）')
  check(!!r && r.ok === true && Object.prototype.hasOwnProperty.call(r.index, '102'), 'B、第二页的票也进索引')
  check(!!r && r.ok === true && r.index['102'] === 'CLOSED|2026-10-24T10:00:00.000Z', 'B、索引值仍是「状态|更新时间」的老口径')

  // 非法的窗口串不许往房间塞：多翻几页是浪费，整页报错是故障。
  seen.length = 0
  await list.fetchIssueIndex('/w', 'not-a-date')
  check(!!seen[0] && !!seen[0].filter && seen[0].filter.since === undefined,
    'B、非法窗口不交给房间（filter 里没有 since）', seen[0] && JSON.stringify(seen[0].filter))
  check(!!seen[0] && !!seen[0].opts && seen[0].opts.limit === PAGINATION.github.listPageSize,
    'B、没有窗口时单页条数仍是契约值')

  // 命名守护的另一条索引扫描是同一个禁区的第二个入口：它现在也按 100 一页翻。
  // 那个函数要整套宿主依赖才能装配，这里只钉住单页条数这一个常量与它的取值，不让它悄悄改回 200。
  const namingSrc = sourceText('src/host/namingGuardian.ts')
  check(namingSrc.indexOf('NAMING_INDEX_PAGE_LIMIT = ' + PAGINATION.github.listPageSize) >= 0,
    'B、命名守护的索引扫描按连接上限 100 一页（常量取自契约值）')
  check(namingSrc.indexOf('NAMING_INDEX_PAGE_LIMIT') >= 0 && namingSrc.indexOf('limit: 200') < 0,
    'B、命名守护不再向会话要 200 一页')
}

// ---------------------------------------------------------------------------------------------
// C. 探测失败要看得见（本组会话进 err、原因带出来、旧快照不丢、恢复即撤、别的失败不被抹）
// ---------------------------------------------------------------------------------------------
const partC = async function (): Promise<void> {
  console.log('#1418 C. 探测失败写进界面状态，恢复那一拍撤掉，别的失败不被误抹')

  // 装快照那条路的「剥表」函数同样来自真源码（本段不走装快照，但闭包里那个名字得是真的）。
  const own: any = loadSpliced('src/client/kernel/work-route-own.js', ['snapshotWithoutWorkRoute'], {
    host: undefined, log: noop, emit: noop,
  })
  const norm = function (x: any): string { return String(x || '').replace(/\\/g, '/').toLowerCase() }
  const baseSnap = function (): any { return { ok: true, maps: [], issues: [], thinTickets: [], version: 'v1', generatedMs: 1 } }
  // 一拍探测按工作区各发一条（#324/#653）：夹具按 cwd 决定哪个工作区这一拍失败，别的正常工作。
  const hostCallFor = function (failByCwd: Record<string, string>): any {
    return function (method: any, params: any): any {
      const k: string = norm(params && params.cwd);
      const err: any = failByCwd[k];
      if (err) return Promise.resolve({ ok: false, error: err });
      return Promise.resolve({ ok: true, changed: false });
    };
  }

  const makeProbe = function (opts: any): any {
    const emits: any[] = []
    const hostCalls: any[] = []
    const scope: Record<string, any> = {
      SYNC: null,
      SYNC_FALLBACK_PROBE_MS: 60000, SYNC_FOCUS_PROBE_MIN_MS: 60000,
      SYNC_SNAP_FRESH_MS: 60000, PROBE_AUTO_WAIT_MS: 50,
      host: { call: function (method: any, params: any): any { hostCalls.push({ method: method, params: params }); return opts.hostCall(method, params) } },
      // attention 那一份真源码要的中央时间参数（构建里由闭包另一片提供，这里当参数塞进去）。
      ATTENTION_EXPIRY_MS: 90000, ATTENTION_HEARTBEAT_MS: 20000,
      getCachedSnapshot: function (): any { return null },
      sessionStorage: undefined,
      shared: opts.shared, stores: opts.stores,
      wsKeyOf: norm, keyOf: norm,
      log: typeof opts.log === 'function' ? opts.log : noop,
      dswsLogHash: function (s: any): string { return 'h' + String(s || '').length },
      dswsLogTrunc: function (s: any, n: any): string { return String(s || '').slice(0, n || 120) },
      touchProbeAt: noop,
      emit: function (st: any): void { emits.push(st) },
      diffSnapshots: function (): any { return { added: [], changed: [], removed: [], issueFlash: {} } },
      scheduleFlashClear: noop,
      loadSnapshot: function (): any { return Promise.resolve() },
      isEnabled: function (): boolean { return false },
      // 计时器两格都给：timeout 给 scheduleActionProbe，interval 给降档日志里的 timerOk（P1 起要看这一格）。
      timer: { timeout: function (fn: any, ms: number): any { return setTimeout(fn, ms) }, interval: function (fn: any, ms: number): any { return setTimeout(fn, ms) } },
      document: undefined, window: undefined,
      hydrateFromCache: function (): boolean { return false },
      snapshotWithoutWorkRoute: own.snapshotWithoutWorkRoute,
      loadOwnWorkRoute: noop,
      chainEventRefresh: function (): any { return Promise.resolve(null) },
      loadChain: function (): any { return Promise.resolve(null) },
      setupPendingOf: function (): boolean { return false },
      namingGuardianEvent: noop,
      applySnapshotSelection: noop,
      flash: noop,
      tr: function (k: any): string { return String(k) },
    }
    // #1418 P1：探测范围与降档搬到了注意力那一片（refresh-timer 已贴 350 有效行上限），
    //   两片拼进同一个闭包再求值，跟构建里拼进界面闭包是同一个形态。
    const paramNames = Object.keys(scope)
    const js = spliceableJs('src/refresh/rooms/client/client-attention-heartbeat.js') + '\n'
      + spliceableJs('src/refresh/rooms/client/refresh-timer.js')
    const fn = compileFn(paramNames, js + '\nreturn { probeNow: probeNow, _probeBackoff: _probeBackoff, _attentionPlan: _attentionPlan }')
    const mod = fn.apply(null, paramNames.map(function (k: string): any { return scope[k] }))
    return { mod: mod, emits: emits, hostCalls: hostCalls }
  }

  // C1. 同一工作区的两个会话：一拍探测失败，两个都要进 err，原因要带出来，旧快照不许丢。
  const rejectMsg = 'gh: Requesting 200 records on the `issues` connection exceeds the `first` limit of 100 records.'
  const shared1: any = { cwd: 'D:\\ws1418', sessionId: 'sess-A', snapshot: baseSnap(), snapMode: 'real' }
  const stB1: any = { cwd: 'D:\\ws1418', sessionId: 'sess-B', snapshot: baseSnap() }
  const stOther: any = { cwd: 'D:\\ws-other', sessionId: 'sess-C', snapshot: baseSnap(), snapMode: 'real' }
  const p1 = makeProbe({
    shared: shared1, stores: { stB1: stB1, stOther: stOther },
    hostCall: hostCallFor({ 'd:/ws1418': rejectMsg }),
  })
  p1.mod.probeNow(false)
  await tick(); await tick()

  check(shared1.snapMode === 'err', 'C、探测失败时主会话进入 err 状态（界面不再停在「没有变化」）', shared1.snapMode)
  check(stB1.snapMode === 'err', 'C、探测失败时同工作区的另一个会话也进入 err（失败不许只让一个会话看见）', stB1.snapMode)
  check(String(shared1.snapError || '').indexOf('exceeds the `first` limit') >= 0,
    'C、失败原因写进 snapError（人能看到到底被什么拒了）', shared1.snapError)
  check(shared1.snapError === stB1.snapError, 'C、同组会话拿到同一条原因')
  check(!!shared1.snapFail && shared1.snapFail.kind === 'probe-failed', 'C、失败标记写明是探测这一路留下的（不是取数/配额）', shared1.snapFail && shared1.snapFail.kind)
  check(!!shared1.snapshot && shared1.snapshot.version === 'v1', 'C、失败不清掉旧快照（有旧数据的人不该看到整屏错误）')
  check(stOther.snapMode === 'real' && !stOther.snapError, 'C、别的工作区的会话不被误伤', stOther.snapMode)
  // #1418 P1：一拍只探「人正在看的那个工作区」，不再把每个工作区的 cwd 都轮询一遍。
  check(p1.hostCalls.length === 1, 'C、一拍只发一条探测（P1：不再逐个轮询所有工作区）', p1.hostCalls.length)
  const probed = p1.hostCalls.map(function (c: any): string { return norm(c.params && c.params.cwd) }).join('|')
  check(probed === 'd:/ws1418', 'C、探的是当前工作区，同工作区的两个会话只占一条探测', probed)
  check(p1.emits.length === 2, 'C、首次失败给同工作区的两个会话各发一次状态变化', p1.emits.length)

  // C2. 同样的失败再来一拍：状态没变，不重复渲染（失败每 5 秒一次，面板不能跟着闪）。
  const afterFirst: number = p1.emits.length
  p1.mod.probeNow(false)
  await tick(); await tick()
  check(p1.emits.length === afterFirst, 'C、同样的失败不重复发状态变化（不每拍重渲染）', p1.emits.length - afterFirst)

  // C3. 原因变了：要再发一次，人看到的必须是新原因。
  const p1b = makeProbe({
    shared: shared1, stores: { stB1: stB1, stOther: stOther },
    hostCall: hostCallFor({ 'd:/ws1418': 'HTTP 500: Internal Server Error' }),
  })
  p1b.mod.probeNow(false)
  await tick(); await tick()
  check(shared1.snapError === 'HTTP 500: Internal Server Error', 'C、失败原因换了就跟着换（不把旧原因一直挂着）', shared1.snapError)
  check(p1b.emits.length === 2, 'C、原因变化给两个会话各发一次状态变化', p1b.emits.length)

  // C4. 恢复那一拍（探成功、但整仓没有变化）：标记撤掉、回 real，界面不再说「刷新失败」。
  const p2 = makeProbe({
    shared: shared1, stores: { stB1: stB1, stOther: stOther },
    hostCall: function (): any { return Promise.resolve({ ok: true, changed: false }) },
  })
  p2.mod.probeNow(false)
  await tick(); await tick()
  check(shared1.snapMode === 'real' && !shared1.snapError && shared1.snapFail === null,
    'C、探测恢复后主会话回到 real、失败原因清空', shared1.snapMode + '/' + shared1.snapError + '/' + String(shared1.snapFail))
  check(stB1.snapMode === 'real' && !stB1.snapError && stB1.snapFail === null,
    'C、探测恢复后同组会话同样清空（不是只清主会话）', stB1.snapMode)
  check(p2.emits.length === 2, 'C、恢复给两个会话各发一次状态变化', p2.emits.length)
  check(stOther.snapMode === 'real' && !stOther.snapError, 'C、别的会话不受这次恢复影响', stOther.snapMode)

  // 恢复之后再来一拍成功：没有可变的，不重复渲染。
  const p2b = makeProbe({
    shared: shared1, stores: { stB1: stB1, stOther: stOther },
    hostCall: function (): any { return Promise.resolve({ ok: true, changed: false }) },
  })
  p2b.mod.probeNow(false)
  await tick(); await tick()
  check(p2b.emits.length === 0, 'C、恢复之后再探成也不重复渲染', p2b.emits.length)

  // C5. 没有旧快照的会话：恢复后是 loading（等真正取到快照再说），不许带着失败原因。
  const shared2: any = { cwd: 'D:\\ws1418b', sessionId: 'sess-D' }
  const stE2: any = { cwd: 'D:\\ws1418b', sessionId: 'sess-E' }
  const p3 = makeProbe({
    shared: shared2, stores: { stE2: stE2 },
    hostCall: function (): any { return Promise.resolve({ ok: false, error: 'probe-not-ok' }) },
  })
  p3.mod.probeNow(false)
  await tick(); await tick()
  check(shared2.snapMode === 'err' && !!shared2.snapFail && shared2.snapFail.kind === 'probe-failed',
    'C、没有旧快照时失败同样进 err（界面要能说出为什么空着）', shared2.snapMode)
  const p4 = makeProbe({
    shared: shared2, stores: { stE2: stE2 },
    hostCall: function (): any { return Promise.resolve({ ok: true, changed: false }) },
  })
  p4.mod.probeNow(false)
  await tick(); await tick()
  check(shared2.snapMode === 'loading' && !shared2.snapError && shared2.snapFail === null,
    'C、没有快照的会话恢复后回 loading（不假装已经有数据）', shared2.snapMode)

  // C6. 取数失败（不是探测失败）留下的标记，不许被探测成功抹掉：那是另一条路的事。
  const shared3: any = { cwd: 'D:\\ws1418c', sessionId: 'sess-F', snapshot: baseSnap(), snapMode: 'err', snapError: '取数失败：仓库读不到', snapFail: { kind: 'fetch-failed', at: 1 } }
  const p5 = makeProbe({
    shared: shared3, stores: {},
    hostCall: function (): any { return Promise.resolve({ ok: true, changed: false }) },
  })
  p5.mod.probeNow(false)
  await tick(); await tick()
  check(shared3.snapMode === 'err' && shared3.snapError === '取数失败：仓库读不到' && !!shared3.snapFail && shared3.snapFail.kind === 'fetch-failed',
    'C、探测成功不抹掉取数失败留下的标记（两条失败各有各的清除者）', shared3.snapMode + '/' + shared3.snapError)
  check(p5.emits.length === 0, 'C、没什么可撤的时候不发状态变化', p5.emits.length)

  // C7. 调用本身被拒（宿主没回话 / 超时）：与 ok:false 一样要让界面看见，别静默。
  const shared4: any = { cwd: 'D:\\ws1418d', sessionId: 'sess-G', snapshot: baseSnap(), snapMode: 'real' }
  const p6 = makeProbe({
    shared: shared4, stores: {},
    hostCall: function (): any { return Promise.reject(new Error('ECONNRESET: socket hang up')) },
  })
  p6.mod.probeNow(false)
  await tick(); await tick()
  check(shared4.snapMode === 'err' && String(shared4.snapError || '').indexOf('ECONNRESET') >= 0,
    'C、宿主调用被拒时同样进 err 并带出原因', shared4.snapMode + '/' + shared4.snapError)
  check(!!shared4.snapFail && shared4.snapFail.kind === 'probe-failed', 'C、这条路留下的标记同样是探测失败')

  // D1. 宿主这层不许把判档丢掉：索引扫描回的是 {kind, error}，探针回包要原样带出 errorKind。
  const probeHandler: any = createProbeHandler({
    canonicalKey: async function (c: any): Promise<any> { return c },
    selectEarly: async function (): Promise<any> { return { backendId: 'github' } },
    isComposerSelection: function (): boolean { return false },
    getTrackerRegistry: async function (): Promise<any> { return { get: function (): any { return null } } },
    getPlatform: async function (): Promise<any> { return {} },
    ctx: { get: function (): any { return null } },
    fetchIssueIndexWindowed: async function (): Promise<any> { return { ok: false, error: { kind: 'unsupported', error: '整页被拒' } } },
    issueIndexChanged: function (): boolean { return false },
    rememberIssueIndex: noop, commitIssueIndex: noop,
    getCache: function (): any { return null }, setCache: noop,
    lastIssueIndexByRepo: {}, lastProbeAtByRepo: {},
    deltaRefresh: async function (): Promise<any> { return null },
    errText: function (e: any): string { return e && typeof e === 'object' ? String(e.message || e.error || '') : String(e) },
  })
  const probeRes: any = await probeHandler.handleProbe({ cwd: 'D:/ws1418' })
  check(!!probeRes && probeRes.ok === false, 'D、索引扫描失败时探针如实回报失败', probeRes && probeRes.error)
  check(!!probeRes && probeRes.errorKind === 'unsupported',
    'D、探针回包带出判档（宿主边界不许把 kind 压成一句话丢掉）', probeRes && probeRes.errorKind)

  // D2. 客户端日志：失败那行 host.call.fail 要带 errorKind（只记判档枚举，不记原文）。
  const loggedD: any[] = []
  const sharedD: any = { cwd: 'D:\\ws1418e', sessionId: 'sess-H', snapshot: baseSnap() }
  const pd = makeProbe({
    shared: sharedD, stores: {},
    hostCall: function (): any { return Promise.resolve({ ok: false, error: '整页被拒', errorKind: 'unsupported' }) },
    log: function (level: string, event: string, fields: any): void { loggedD.push({ level: level, event: event, fields: fields }) },
  })
  pd.mod.probeNow(false)
  await tick(); await tick()
  const failRowD: any = loggedD.filter(function (l: any): boolean { return l.event === 'host.call.fail' })[0]
  check(!!failRowD && failRowD.fields.errorKind === 'unsupported',
    'D、客户端失败日志写出判档（日志里能看出是哪一档，不再只有散列）', failRowD && failRowD.fields && failRowD.fields.errorKind)

  // D3. 调用本身被拒（异常）：同样要有一个可读的档位。
  const sharedE: any = { cwd: 'D:\\ws1418f', sessionId: 'sess-I', snapshot: baseSnap() }
  const pe = makeProbe({
    shared: sharedE, stores: {},
    hostCall: function (): any { return Promise.reject(new Error('ECONNRESET: socket hang up')) },
    log: function (level: string, event: string, fields: any): void { loggedD.push({ level: level, event: event, fields: fields }) },
  })
  pe.mod.probeNow(false)
  await tick(); await tick()
  const failRowE: any = loggedD.filter(function (l: any): boolean { return l.event === 'host.call.fail' })[1]
  check(!!failRowE && failRowE.fields.errorKind === 'exception',
    'D、宿主调用被拒时日志写 exception（这一档不用人去猜）', failRowE && failRowE.fields && failRowE.fields.errorKind)

  // -------------------------------------------------------------------------------------------
  // E（#1418 P1）：探测范围收到「人正在看的那个工作区」；连续无变化降档；按族裁决与见底文案
  // -------------------------------------------------------------------------------------------
  console.log('#1418 E. P1：只探当前工作区、无变化降档、按族裁决（REST 见底不停读）与恢复时刻')

  // E1. 焦点在 wsB：只探 wsB，wsA 的会话不被轮询，也不会被 wsB 的一拍误发状态变化。
  const sharedA: any = { cwd: 'D:\\wsA', sessionId: 'sess-A', snapshot: baseSnap(), snapMode: 'real' }
  const stB: any = { cwd: 'D:\\wsB', sessionId: 'sess-B', snapshot: baseSnap(), snapMode: 'real' }
  const pE1 = makeProbe({
    shared: sharedA, stores: { stB: stB },
    hostCall: function (): any { return Promise.resolve({ ok: true, changed: false }) },
  })
  pE1.mod._attentionPlan.root = 'D:\\wsB'
  pE1.mod.probeNow(false, { background: true })
  await tick(); await tick()
  const probedE1: string = pE1.hostCalls.map(function (c: any): string { return norm(c.params && c.params.cwd) }).join('|')
  check(pE1.hostCalls.length === 1 && probedE1 === 'd:/wsb', 'E、焦点在 wsB 时只探 wsB（不轮询 wsA）', probedE1)
  check(pE1.emits.length === 0, 'E、没被探的 wsA 会话不会被误发状态变化', pE1.emits.length)

  // E2. 后台拍连续无变化：逐级拉长间隔；还没到间隔时直接跳过，一个请求都不发。
  const logsE2: any[] = []
  const pE2 = makeProbe({
    shared: sharedA, stores: { stB: stB },
    hostCall: function (): any { return Promise.resolve({ ok: true, changed: false }) },
    log: function (level: string, event: string, fields: any): void { logsE2.push({ level: level, event: event, fields: fields }) },
  })
  pE2.mod.probeNow(false, { background: true })
  await tick(); await tick()
  check(pE2.mod._probeBackoff.step === 1, 'E、后台拍探成且没变化：退避加一级', pE2.mod._probeBackoff.step)
  const callsAfterFirst: number = pE2.hostCalls.length
  pE2.mod.probeNow(false, { background: true })
  await tick(); await tick()
  check(pE2.hostCalls.length === callsAfterFirst, 'E、还没到退避间隔的后台拍直接跳过（不再发请求）', pE2.hostCalls.length - callsAfterFirst)
  pE2.mod._probeBackoff.lastAt = 0
  pE2.mod.probeNow(false, { background: true })
  await tick(); await tick()
  check(pE2.mod._probeBackoff.step === 2, 'E、再过一拍仍无变化：退避加到第二级（间隔翻倍）', pE2.mod._probeBackoff.step)
  const backoffRow: any = logsE2.filter(function (l: any): boolean { return l.event === 'probe.loop' && l.fields && l.fields.reason === 'backoff' }).pop()
  check(!!backoffRow && backoffRow.fields.intervalMs === 120000, 'E、降档日志写出拉长后的间隔（120000 毫秒）', backoffRow && backoffRow.fields && backoffRow.fields.intervalMs)
  check(!!backoffRow && backoffRow.fields.visible === true && backoffRow.fields.timerOk === true,
    'E、降档日志带可见与计时器两格（沿用 probe.loop 既有字段，不加新字段）', backoffRow && JSON.stringify(backoffRow.fields))

  // E2b. 面板开着时的活跃拍（宿主给的 5 秒档）也要退避，但按 5 秒的基数拉长：
  //   不许一闲下来就直接跳到 60 秒档，否则「有变化 5 秒内发现」这条就保不住了。
  const logsE2b: any[] = []
  const pE2b = makeProbe({
    shared: sharedA, stores: { stB: stB },
    hostCall: function (): any { return Promise.resolve({ ok: true, changed: false }) },
    log: function (level: string, event: string, fields: any): void { logsE2b.push({ level: level, event: event, fields: fields }) },
  })
  pE2b.mod.probeNow(false, { background: true, baseMs: 5000 })
  await tick(); await tick()
  check(pE2b.mod._probeBackoff.step === 1, 'E、活跃拍探成且没变化：同样退避加一级', pE2b.mod._probeBackoff.step)
  pE2b.mod._probeBackoff.lastAt = 0
  pE2b.mod.probeNow(false, { background: true, baseMs: 5000 })
  await tick(); await tick()
  const activeBackoff: any = logsE2b.filter(function (l: any): boolean { return l.event === 'probe.loop' && l.fields && l.fields.reason === 'backoff' }).pop()
  check(!!activeBackoff && activeBackoff.fields.intervalMs === 10000,
    'E、活跃拍的退避按 5 秒基数算（第二档 10000 毫秒）', activeBackoff && activeBackoff.fields && activeBackoff.fields.intervalMs)

  // E3. 探到变化的那一拍把退避清零：下一拍立刻回到原节奏，不让人等分钟级。
  let changedE3: boolean = false
  const logsE3: any[] = []
  const pE3 = makeProbe({
    shared: sharedA, stores: { stB: stB },
    hostCall: function (): any { return Promise.resolve({ ok: true, changed: changedE3 }) },
    log: function (level: string, event: string, fields: any): void { logsE3.push({ level: level, event: event, fields: fields }) },
  })
  pE3.mod._attentionPlan.root = 'D:\\wsB'
  pE3.mod.probeNow(false, { background: true })
  await tick(); await tick()
  check(pE3.mod._probeBackoff.step === 1, 'E、先探成一次没变化（退避到一级）', pE3.mod._probeBackoff.step)
  changedE3 = true
  pE3.mod._probeBackoff.lastAt = 0
  pE3.mod.probeNow(false, { background: true })
  await tick(); await tick()
  check(pE3.mod._probeBackoff.step === 0, 'E、探到变化的那一拍退避清零（下一拍回到原节奏）', pE3.mod._probeBackoff.step)
  const resetRow: any = logsE3.filter(function (l: any): boolean { return l.event === 'probe.loop' && l.fields && l.fields.reason === 'backoff-reset' }).pop()
  check(!!resetRow && resetRow.fields.intervalMs === 60000,
    'E、复位那一行写 backoff-reset 并回到原节奏（60000 毫秒）', resetRow && resetRow.fields && resetRow.fields.intervalMs)

  // E5. 按族裁决：按「这一次操作真正会出的通道」判，连前置读一起算——
  //   读只看 GraphQL；改票 / 关票 / 父子边只看 GraphQL；建票两族都要（写 REST、建前锚回查 GraphQL）；
  //   评论与阻塞边两条路任一。文案点名是哪种额度、还剩多少、约几点恢复；名单外的操作两族都看。
  const limitsE: any = {
    pluginShareOfRemaining: 0.35,
    hourlyAllowance: function (n: number): number { return n },
    writeReserve: function (a: number): number { return Math.floor(a * 0.3) },
    // #1527：AI 工具的保底线按服务端上限的 5% 算。
    aiToolFloor: function (n: number): number { return Math.floor(n * 0.05) },
    tierFor: function (): string { return 'green' },
  }
  const twoE: any = { kind: 'two-buckets', countsRequests: true, countsPoints: true, independentBuckets: true }
  const readingE = function (rest: number, graphql: number, restResetAt?: number): any {
    return { known: true, kind: 'two-buckets', buckets: {
      rest: { remaining: rest, limit: 5000, resetAt: restResetAt },
      graphql: { remaining: graphql, limit: 5000 },
    } }
  }
  // #1527：上限 5000 的保底是 250（服务端上限的 5%）；200 见底、1400 充足。
  const restDeadRead: any = decideByBudget({ op: 'list', budget: twoE, reading: readingE(200, 1400), canWrite: true }, limitsE)
  check(restDeadRead.allowed === true, 'E、REST 见底时读操作照常放行（读只花 GraphQL 点数，不再整轮误停）', restDeadRead.reason)
  const restDeadWrite: any = decideByBudget({ op: 'create', budget: twoE, reading: readingE(200, 1400, 1790000000000), canWrite: true }, limitsE)
  check(restDeadWrite.allowed === false && String(restDeadWrite.message || '').indexOf('REST 请求') >= 0,
    'E、写操作被 REST 桶拦下，文案点名 REST 请求：' + String(restDeadWrite.message || ''))
  check(/约 \d\d:\d\d 恢复/.test(String(restDeadWrite.message || '')),
    'E、见底文案写出恢复时刻：' + String(restDeadWrite.message || ''))
  const graphqlDeadRead: any = decideByBudget({ op: 'get', budget: twoE, reading: readingE(1400, 200), canWrite: true }, limitsE)
  check(graphqlDeadRead.allowed === false && String(graphqlDeadRead.message || '').indexOf('GraphQL 点数') >= 0,
    'E、读操作被 GraphQL 桶拦下，文案点名 GraphQL 点数：' + String(graphqlDeadRead.message || ''))
  // 建票不只花 REST：写之前必跑幂等锚回查（gh search issues / gh issue list，都是 GraphQL），
  // 所以 GraphQL 见底时建票会卡在回查上，闸必须在放行前就拦住（复核第二轮补）。
  const graphqlDeadWrite: any = decideByBudget({ op: 'create', budget: twoE, reading: readingE(1400, 200), canWrite: true }, limitsE)
  check(graphqlDeadWrite.allowed === false && String(graphqlDeadWrite.message || '').indexOf('GraphQL 点数') >= 0,
    'E、GraphQL 见底时建票被拦下并点名 GraphQL 点数（建前锚回查走 GraphQL）', graphqlDeadWrite.reason + '/' + String(graphqlDeadWrite.message || ''))
  // #1418 P1 复核 c1：写操作的通道按真实出站算 —— 改票 / 关票 / 标签 / 认领走 gh issue edit（GraphQL），
  //   REST 见底时它们照做；评论、阻塞边还有退路，只有两条路都见底才拦。
  const restDeadEdit: any = decideByBudget({ op: 'update', budget: twoE, reading: readingE(200, 1400), canWrite: true }, limitsE)
  check(restDeadEdit.allowed === true, 'E、REST 见底时改票照常放行（gh issue edit 内部发 GraphQL）', restDeadEdit.reason)
  const restDeadComment: any = decideByBudget({ op: 'comment', budget: twoE, reading: readingE(200, 1400), canWrite: true }, limitsE)
  check(restDeadComment.allowed === true, 'E、REST 见底时评论照常放行（还能回落 gh issue comment 的 GraphQL 通道）', restDeadComment.reason)
  const graphqlDeadEdit: any = decideByBudget({ op: 'update', budget: twoE, reading: readingE(1400, 200), canWrite: true }, limitsE)
  check(graphqlDeadEdit.allowed === false && String(graphqlDeadEdit.message || '').indexOf('GraphQL 点数') >= 0,
    'E、改票只走 GraphQL：GraphQL 见底时拦下并点名 GraphQL 点数', graphqlDeadEdit.message)
  const bothDeadComment: any = decideByBudget({ op: 'comment', budget: twoE, reading: readingE(200, 200), canWrite: true }, limitsE)
  check(bothDeadComment.allowed === false && String(bothDeadComment.message || '').indexOf('两种额度都不够') >= 0,
    'E、两条通道都见底的评论拦下并如实说两种额度都不够', bothDeadComment.message)
  // 父子边：REST 退路只在老版本 gh 不认 --parent 时才走（graph.ts 的 unknown-flag 分支），配额耗尽不会换路，
  // 所以它是 GraphQL-only —— GraphQL 见底时 REST 再有余也得拦（复核第二轮补）。
  const restDeadLink: any = decideByBudget({ op: 'setParent', budget: twoE, reading: readingE(200, 1400), canWrite: true }, limitsE)
  check(restDeadLink.allowed === true, 'E、REST 见底时父子边照常放行（前置读与写都在 GraphQL 上）', restDeadLink.reason)
  const graphqlDeadLink: any = decideByBudget({ op: 'setParent', budget: twoE, reading: readingE(1400, 200), canWrite: true }, limitsE)
  check(graphqlDeadLink.allowed === false && String(graphqlDeadLink.message || '').indexOf('GraphQL 点数') >= 0,
    'E、GraphQL 见底时父子边被拦下（REST 退路不会因配额耗尽而换路）', graphqlDeadLink.reason + '/' + String(graphqlDeadLink.message || ''))
  // 评论：REST 主路失败会无条件回落 gh issue comment（GraphQL），所以 REST 见底、GraphQL 有余时照做。
  const graphqlDeadComment: any = decideByBudget({ op: 'comment', budget: twoE, reading: readingE(1400, 200), canWrite: true }, limitsE)
  check(graphqlDeadComment.allowed === true, 'E、GraphQL 见底时评论照常放行（先走 REST 主路）', graphqlDeadComment.reason)
  // 见底文案要写出还剩多少（与闸的拒绝文案同一个口径：额度 + 剩余 + 恢复时刻）。
  check(String(restDeadWrite.message || '').indexOf('还剩') >= 0,
    'E、见底文案写出还剩多少：' + String(restDeadWrite.message || ''))
  const unknownFam: any = decideByBudget({ op: 'switch-backend', budget: twoE, reading: readingE(200, 1400), canWrite: true }, limitsE)
  check(unknownFam.allowed === false, 'E、族不明的操作保守按两族都看（REST 见底就推迟）', unknownFam.reason)
  const noResetMsg: string = String(decideByBudget({ op: 'create', budget: twoE, reading: readingE(200, 1400), canWrite: true }, limitsE).message || '')
  check(noResetMsg.indexOf('恢复') < 0, 'E、读数没带恢复时刻时文案不编时刻：' + noResetMsg)

  // E6. 闸自己那条拒绝文案（不是裁决那一句）：见底时要写出缺的是哪一种额度、什么时候恢复、还剩多少。
  const refusal: string = refusalTextRef(
    { reason: 'ai-tool-below-remaining', points: 5, requests: 3, bucket: 'rest', resetAt: 1790000000000, now: 1790000000000 - 120000, floor: 250, limit: 5000, serverRemaining: 12 },
    { points: 0, requests: 0 },
    { shards: 2, perShard: 5 },
    { aiToolMaxPointsPerCall: 100, aiToolMaxRequestsPerCall: 100, aiToolMaxPointsPerHour: 1000, aiToolMaxRequestsPerHour: 1000 },
  )
  check(refusal.indexOf('REST 请求') >= 0 && /约 [0-9][0-9]:[0-9][0-9] 恢复/.test(refusal) && refusal.indexOf('服务端还剩 12 条') >= 0,
    'E、闸拒绝文案点名缺的额度、恢复时刻与剩余量：' + refusal)
}

async function main(): Promise<void> {
  await partA()
  await partB()
  await partC()
}

main().then(function (): void {
  console.log('')
  if (failed) console.log('FAIL：' + total + ' 条断言里有失败')
  else console.log('OK：' + total + ' 条断言全部通过')
  if (failed) process.exitCode = 1
}).catch(function (e: any): void {
  console.log('FAIL：门禁自己抛错 —— ' + String((e && e.stack) || e))
  process.exitCode = 1
})
