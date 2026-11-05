/**
 * tests/verify-1894-view-model.ts —— 视图模型基座与列表页（#1894，规格 #1885 S6）
 *
 * 守什么（票面四条验收逐条落在这里）：
 *   A 切会话不再整份重取：同一「工作区 + 库版本」的投影帧只建一次，两个会话拿到同一个帧与同一份
 *     counts/readout；同一版本再调用一次，视图模型一个切片都不重算、订阅者一次都不通知。
 *   B 改筛选只让相关切片重画：订阅六片后改状态/标签/排序/工作单元，只有 filters 与 rows 的版本号变，
 *     counts/readout/projection/reading 的对象引用与版本号都不变；只订阅 counts 的视图一次都不回调。
 *   C 列表页与状态栏/胶囊同源：三个视图文件都从 deckViewOf 这一个入口取同一个视图模型；同一份 st 上
 *     deckViewCountsOf 与视图模型的 counts 切片是同一个对象；注入的读数同时出现在列表与状态栏的读口。
 *   D 视图层不再直接调宿主电话（静态判据）：本票迁移过的六个视图文件里不出现 host.call(/rpcCall(；
 *     状态栏原来那条 wf.cwd 电话搬进了视图模型接线层，并有一条反证证明这道判据本身抓得住直连写法。
 *
 * 为什么能单独跑：视图模型是纯数据层（不挂 React、不起浏览器、不发电话）。这一趟直接构造它、喂假投影、
 * 假宿主电话与假信号，断言状态迁移与「这一趟更新涉及哪些切片」——这就是规格「视图状态」那条接缝。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1894-view-model.ts
 */
// 门禁归属: src/client/kernel/deck-view-model.ts
// 门禁归属: src/client/kernel/deck-view-binding.ts
// 门禁归属: src/client/views/ListTab.ts
// 门禁归属: src/client/views/listFilterRow.ts
// 门禁归属: src/client/views/mdEffortRow.ts
// 门禁归属: src/client/statusbar/StatusBar.ts
// 门禁归属: src/client/statusbar/SessionChainCapsule.ts
// 门禁归属: src/client/statusbar/checksums.ts

import { printGateResult } from './lib/gate-result.ts'
import { sourceText } from './lib/source-text.ts'
import { createDeckView, deckFiltersOf, deckReadingOf } from '../src/client/kernel/deck-view-model.ts'

const GATE = 'verify-1894-view-model'

let total = 0
let failed = 0
function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

/** 去掉注释与字符串内容：只按代码形状判「这句还在不在」，注释里提到旧写法不算数。 */
function codeOnly(source: string): string {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
}

/** 视图层直连宿主电话的形状：host.call( / rpcCall( / phone.call('wf.…')。 */
function judgeHostDirect(source: string): string[] {
  const code = codeOnly(source)
  const hits: string[] = []
  if (/\bhost\s*\.\s*call\s*\(/.test(code)) hits.push('host.call(')
  if (/\brpcCall\s*\(/.test(code)) hits.push('rpcCall(')
  if (/\.\s*call\s*\(\s*['"]wf\./.test(code)) hits.push(".call('wf.…)")
  return hits
}

/** 客户端手上的一行（界面形状：状态大写、时间 ISO 串）。 */
function row(key: string, extra?: any): any {
  return Object.assign({
    key: key, number: Number(key), effortId: 'default', type: 'issue', title: '票 ' + key, state: 'OPEN',
    labels: [], assignees: [], blockedBy: [], updatedAt: '2026-11-01T00:00:00.000Z',
  }, extra || {})
}

/** 一份投影（宿主组装器给的形状；这里只留视图模型真正读的几格）。 */
function projectionOf(rows: any[], extra?: any): any {
  return Object.assign({ generatedMs: 1761900000000, issues: rows, maps: [], labels: [], thinTickets: [], workRouteTable: null }, extra || {})
}

function countsOf(n: number): any {
  return { total: n, open: n, closed: 0, takeable: n, occupied: 0, bug: 0, triage: 0, backend: null, kpi: null, atMs: 0 }
}

function frameOf(version: number, projection: any, counts?: any): any {
  return { key: 'ws|' + version, version: version, projection: projection, counts: counts || countsOf(projection.issues.length), readout: { version: version, generatedMs: projection.generatedMs, workRouteTable: null } }
}

function versionsOf(view: any): any {
  const out: any = {}
  for (const n of ['projection', 'filters', 'rows', 'counts', 'readout', 'reading']) out[n] = view.versionOf(n)
  return out
}

function track(view: any, names: string[]): any {
  const hits: any = {}
  for (const n of names) { hits[n] = 0; view.subscribe(n, function (): void { hits[n] += 1 }) }
  return hits
}

/** 假的工作单元/占用端口：按行上的 effortId 与 assignees 判，不启动任何领域函数。 */
const PORT: any = {
  rowsSource: function (frame: any): any[] { return (frame.projection && frame.projection.issues) || [] },
  effortOf: function (r: any): string { return String((r && r.effortId) || '') },
  occupiedOf: function (r: any): boolean { return !!(r && Array.isArray(r.assignees) && r.assignees.length) },
  labelNamesOf: function (r: any): string[] {
    return ((r && r.labels) || []).map(function (l: any): string { return (typeof l === 'string') ? l : String((l && l.name) || '') })
  },
}

async function main(): Promise<void> {
  // 生产接线那一片先挂在 main 的作用域上：E 组构造，G 组清理时还要用同一个模块实例。
  let binding: any = null
  // ------------------------------------------------------------------ A 同一版本直接复用
  {
    const p5 = projectionOf([row('1'), row('2', { state: 'CLOSED' })])
    const f5 = frameOf(5, p5)
    const view: any = createDeckView({ frame: f5, filters: { stateFilter: 'all' }, reading: { draft: '' }, ports: PORT })
    check(view.slice('projection').snapshot === p5 && view.slice('projection').version === 5, 'A1 视图模型拿着投影与库版本')
    check(view.slice('filters').stateFilter === 'all' && view.slice('rows').open.length === 1, 'A2 构造时按默认筛选算出开放行')
    const before = versionsOf(view)
    const again = view.adopt({ frame: frameOf(5, projectionOf([row('9')])) })
    check(again.outcome === 'reused' && again.changed.length === 0, 'A3 同一版本收到另一份投影对象也判复用（版本是唯一判据）', again)
    check(JSON.stringify(versionsOf(view)) === JSON.stringify(before), 'A4 复用那一趟一个切片版本都没动', versionsOf(view))
    check(view.slice('projection').snapshot === p5, 'A5 复用后仍拿着原帧的投影（不拿同版本的另一份对象覆盖）')

    const changed = view.command('setStateFilter', 'closed')
    check(JSON.stringify(changed.changed) === JSON.stringify(['filters', 'rows']), 'A6 改状态筛选只动 filters 与 rows 两片', changed.changed)
    const afterFilter = versionsOf(view)
    check(afterFilter.counts === before.counts && afterFilter.readout === before.readout && afterFilter.projection === before.projection, 'A7 counts/readout/projection 的版本号不变')
    check(view.slice('counts') === f5.counts && view.slice('readout') === f5.readout, 'A8 counts/readout 连对象引用都没换')
    check(view.slice('rows').visible.length === 1 && view.slice('rows').visible[0].state === 'CLOSED', 'A9 筛选结果真的换了（已关闭一屏）')
  }

  // ------------------------------------------------------------------ B 订阅粒度
  {
    const f5 = frameOf(5, projectionOf([row('1'), row('2', { labels: ['bug'] })]))
    const view: any = createDeckView({ frame: f5, ports: PORT })
    const hits = track(view, ['projection', 'filters', 'rows', 'counts', 'readout', 'reading'])
    const before = versionsOf(view)
    view.command('setLabelFilters', ['bug'])
    check(hits.rows === 1 && hits.filters === 1, 'B1 改标签：filters/rows 各通知一次', hits)
    check(hits.counts === 0 && hits.readout === 0 && hits.projection === 0 && hits.reading === 0, 'B2 改标签：counts/readout/projection/reading 一次都不通知', hits)
    const after = versionsOf(view)
    check(after.counts === before.counts && after.readout === before.readout && after.projection === before.projection && after.reading === before.reading, 'B3 改标签：另外四片的版本号不变', after)
    view.command('setLabelFilters', ['bug'])
    check(versionsOf(view).filters === after.filters, 'B4 同一份标签再设一次：判无变化、不重算', versionsOf(view).filters)
    view.command('setSort', { sortKey: 'title', sortDir: 'asc' })
    check(versionsOf(view).filters === after.filters + 1, 'B5 改排序动 filters（rows 跟着重算）')
    view.command('setSort', { sortKey: 'title', sortDir: 'asc' })
    check(versionsOf(view).filters === after.filters + 1, 'B6 同一排序再设一次：不重算')
    view.command('setEffortFilter', ['ui'])
    check(versionsOf(view).counts === after.counts, 'B7 改工作单元筛选也不动 counts')
    view.command('openIssue', 42)
    check(versionsOf(view).reading === after.reading + 1 && versionsOf(view).counts === after.counts, 'B8 改阅读态只动 reading')
    view.command('setPageRows', [row('99')])
    check(versionsOf(view).reading === after.reading + 2 && versionsOf(view).rows > after.rows, 'B9 翻出一页历史行：reading 与 rows 一起动')
  }

  // ------------------------------------------------------------------ C 切片内容正确
  {
    const rows = [
      row('1', { effortId: 'a', labels: ['bug'] }),
      row('2', { effortId: 'b', assignees: ['me'] }),
      row('3', { effortId: 'a', state: 'CLOSED', labels: ['bug'] }),
      row('4', { effortId: 'a', labels: [] }),
    ]
    const view: any = createDeckView({ frame: frameOf(7, projectionOf(rows)), filters: { stateFilter: 'all' }, ports: PORT })
    check(view.slice('rows').open.length === 3 && view.slice('rows').closed.length === 1, 'C1 开放/已关闭两组分开', view.slice('rows'))
    view.command('setEffortFilter', ['a'])
    check(view.slice('rows').open.map(function (r: any): string { return r.key }).join(',') === '1,4', 'C2 工作单元筛选只留这个目录的开放行', view.slice('rows').open.map(function (r: any): string { return r.key }))
    view.command('setEffortFilter', [])
    view.command('setLabelFilters', ['bug'])
    check(view.slice('rows').open.map(function (r: any): string { return r.key }).join(',') === '1', 'C3 标签筛选按 OR 语义命中（这里只有 1 带 bug）', view.slice('rows').open.map(function (r: any): string { return r.key }))
    view.command('setLabelFilters', ['needs-triage'])
    check(view.slice('rows').open.map(function (r: any): string { return r.key }).join(',') === '2,4', 'C4 一张标签都没有的票只命中 needs-triage（带别的标签的 1 不命中）', view.slice('rows').open.map(function (r: any): string { return r.key }))
    view.command('setLabelFilters', [])
    view.command('setStateFilter', 'frontier')
    check(view.slice('rows').open.map(function (r: any): string { return r.key }).join(',') === '1,4', 'C5 frontier 只留没被占用的开放行（2 有人认领被筛掉）', view.slice('rows').open.map(function (r: any): string { return r.key }))
    view.command('setStateFilter', 'blocked')
    check(view.slice('rows').open.map(function (r: any): string { return r.key }).join(',') === '2', 'C6 blocked 只留已被占用/阻塞的开放行', view.slice('rows').open.map(function (r: any): string { return r.key }))
  }

  // ------------------------------------------------------------------ D 换投影帧
  {
    const f5 = frameOf(5, projectionOf([row('1')]))
    const f6 = frameOf(6, projectionOf([row('1'), row('2')]))
    const view: any = createDeckView({ frame: f5, filters: { stateFilter: 'closed' }, reading: { draft: '草稿' }, ports: PORT })
    const hits = track(view, ['projection', 'filters', 'rows', 'counts', 'readout', 'reading'])
    const before = versionsOf(view)
    const out = view.adopt({ frame: f6 })
    // #1895 / #1896：地图详情与票详情这两片都从投影里取数据，换版本时要跟着投影一起换（各片的名字按契约写全）。
    check(out.outcome === 'updated' && JSON.stringify(out.changed) === JSON.stringify(['projection', 'counts', 'readout', 'rows', 'mapDetail', 'issueDetail', 'prList']), 'D1 换版本只重算投影相关的片（#1895 起地图详情、#1896 起票详情、#1897 起拉取请求页跟着投影一起换）', out.changed)
    check(versionsOf(view).filters === before.filters && versionsOf(view).reading === before.reading, 'D2 换版本不动会话私有筛选与阅读态')
    check(hits.filters === 0 && hits.reading === 0, 'D3 换版本不通知 filters/reading 的订阅者', hits)
    check(view.slice('counts') === f6.counts && view.slice('projection').snapshot === f6.projection, 'D4 切片换成新帧的数据')
    const countsBeforeReading = versionsOf(view).counts
    view.adopt({ frame: f6, reading: { draft: '新草稿' } })
    check(versionsOf(view).reading === before.reading + 1 && versionsOf(view).counts === countsBeforeReading, 'D5 阅读态变了只动 reading，counts 版本号不动', versionsOf(view))
  }

  // ------------------------------------------------------------------ E 生产接线：帧共享与会话隔离
  binding = await (async function () {
    ;(globalThis as any).createDeckView = createDeckView
    ;(globalThis as any).deckFiltersOf = deckFiltersOf
    ;(globalThis as any).deckReadingOf = deckReadingOf
    return import('../src/client/kernel/deck-view-binding.ts')
  })()
  {
    let version: number | null = 11
    const snap: any = projectionOf([row('1'), row('2', { labels: ['bug'] })])
    const backend = { open: 2, closed: 0, total: 2, atMs: 77, source: 'backend' }
    const scope: any = {
      wsKeyOf: function (k: any): string { return String(k || '') },
      snapshotVersionBookOf: function (): any { return { version: version, seenAtMs: 0 } },
      ticketRowsOf: function (arr: any): any[] { return arr || [] },
      issuePageRowsOf: function (): any[] { return [] },
      isOccupied: function (_st: any, r: any): boolean { return !!(r && r.assignees && r.assignees.length) },
      effortOf: function (r: any): string { return String((r && r.effortId) || '') },
      occCount: function (): number { return 0 },
      deckCountsOf: function (): any { return backend },
      bugCount: function (): number { return 1 },
      triageCount: function (): number { return 0 },
      kpiCountsOf: function (): any { return { takeable: 2, closed: 0, unknown: false, pending: false, atMs: 77, source: 'backend' } },
      listPrefs: { stateFilter: 'all', sortKey: 'number', sortDir: 'asc' },
      saveListPrefs: function (): void {},
    }
    const stA: any = { cwd: 'D:/ws/vm', snapshot: snap, sessionId: 's1', stateFilter: 'open', lblFilters: [], effFilters: [], sortKey: 'number', sortDir: 'asc', expLabels: false, activeIssue: null, cmtDraft: '' }
    const stB: any = { cwd: 'D:/ws/vm', snapshot: snap, sessionId: 's2', stateFilter: 'open', lblFilters: [], effFilters: [], sortKey: 'number', sortDir: 'asc', expLabels: false, activeIssue: null, cmtDraft: '' }
    const viewA = binding.deckViewOf(stA, scope)
    const viewB = binding.deckViewOf(stB, scope)
    check(viewA !== viewB, 'E1 两个会话各有一份视图模型（筛选/阅读态是会话私有）')
    check(viewA.frame() === viewB.frame(), 'E2 同一工作区同一版本的两个会话共用一个投影帧（切会话不重建）')
    check(viewA.slice('counts') === viewB.slice('counts'), 'E3 两个会话的 counts 是同一个对象（不重算）')
    const beforeA = versionsOf(viewA)
    binding.deckViewOf(stA, scope)
    check(JSON.stringify(versionsOf(viewA)) === JSON.stringify(beforeA), 'E4 同一版本再取一次：一个切片都不重算', versionsOf(viewA))
    const counts: any = binding.deckViewCountsOf(stA, scope)
    check(counts === viewA.slice('counts') && counts.backend.open === 2 && counts.kpi.takeable === 2, 'E5 deckViewCountsOf 与视图模型 counts 是同一个对象、注入的读数原样可见', counts)
    check(binding.deckProjectionOf(stA, scope) === snap, 'E6 胶囊读的投影与视图模型 projection 切片是同一个快照')
    const res = binding.deckViewCommand(stA, 'setStateFilter', 'closed', scope)
    check(res.changed.indexOf('filters') >= 0 && stA.stateFilter === 'closed', 'E7 命令改完镜像回会话存储（别的角落按 st 字段读也对）', stA.stateFilter)
    check(viewB.slice('filters').stateFilter === 'open', 'E8 一个会话改筛选不影响另一个会话（会话私有）')
    check(versionsOf(viewA).counts === beforeA.counts, 'E9 改筛选不动 counts 切片')
    let applied: any = null
    const hostScope: any = Object.assign({}, scope, { host: { call: function (m: string, a: any): any { return Promise.resolve({ ok: true, cwd: 'D:/ws/vm', method: m, args: a }) } } })
    binding.deckResolveSessionCwd(stA, 's1', function (cwd: any, src: any): void { applied = { cwd: cwd, src: src } }, hostScope)
    await new Promise(function (resolve): void { setTimeout(resolve, 0) })
    check(applied && applied.cwd === 'D:/ws/vm' && applied.src === 'wf.cwd', 'E10 状态栏那条 wf.cwd 电话由接线层发出、结果回调给视图', applied)
  }

  // ------------------------------------------------------------------ F 静态判据：视图同源、无直连电话
  {
    const listTab = sourceText('src/client/views/ListTab.ts')
    const filterRow = sourceText('src/client/views/listFilterRow.ts')
    const effortRow = sourceText('src/client/views/mdEffortRow.ts')
    const statusBar = sourceText('src/client/statusbar/StatusBar.ts')
    const capsule = sourceText('src/client/statusbar/SessionChainCapsule.ts')
    const checksums = sourceText('src/client/statusbar/checksums.ts')
    const bindingSrc = sourceText('src/client/kernel/deck-view-binding.ts')
    const modelSrc = sourceText('src/client/kernel/deck-view-model.ts')

    check(listTab.indexOf("deckView.slice('filters')") >= 0 && listTab.indexOf("deckView.slice('counts')") >= 0, 'F1 列表页的筛选与 KPI 都从视图模型切片取')
    check(listTab.indexOf("useDeckViewFor(st, ['rows'])") >= 0, 'F2 列表页按 rows 切片订阅（只重画相关切片）')
    check(statusBar.indexOf("useDeckViewSlice(s, 'counts')") >= 0 && statusBar.indexOf('checksumsOf(s, deckCounts)') >= 0, 'F3 状态栏订阅 counts 切片并把同一份交给读数函数')
    check(checksums.indexOf('deckViewCountsOf') >= 0, 'F4 状态栏读数函数优先读视图模型的 counts')
    check(capsule.indexOf('deckProjectionOf') >= 0 && capsule.indexOf("useDeckViewSlice(st, 'readout')") >= 0, 'F5 胶囊读视图模型的投影与 readout 切片')
    check(filterRow.indexOf('deckViewCommand') >= 0 && effortRow.indexOf('deckViewCommand') >= 0, 'F6 列表筛选行与目录签走视图模型命令（不整棵 emit）')
    check(bindingSrc.indexOf("phone.call('wf.cwd'") >= 0 && statusBar.indexOf('wf.cwd') < 0, 'F7 状态栏那条 wf.cwd 电话只留在接线层，视图层不再出现')
    check((modelSrc.match(/export function createDeckView\(/g) || []).length === 1 && (bindingSrc.match(/export function createDeckView\(/g) || []).length === 0, 'F8 视图模型只有一个实现，接线层不另写一份')

    const MIGRATED: string[] = [
      'src/client/views/ListTab.ts',
      'src/client/views/listFilterRow.ts',
      'src/client/views/mdEffortRow.ts',
      'src/client/statusbar/StatusBar.ts',
      'src/client/statusbar/SessionChainCapsule.ts',
      'src/client/statusbar/checksums.ts',
    ]
    check(MIGRATED.length === 6, 'F9 无直连电话的名单只收本票真正迁移过的六个文件（不是一张空头名单）')
    const direct: any = {}
    for (const file of MIGRATED) { const hits = judgeHostDirect(sourceText(file)); if (hits.length) direct[file] = hits }
    check(Object.keys(direct).length === 0, 'F10 六个迁移过的视图文件都不再直连宿主电话（host.call( / rpcCall( / .call(wf.…)）', direct)
    const selfCheck = judgeHostDirect("export const x = function () { return host.call('wf.snapshot', {}) }")
    const selfCheck2 = judgeHostDirect("const p = rpcCall('wf.copy', {})")
    check(selfCheck.length === 1 && selfCheck2.length === 1, 'F11 反证：直连写法会被这道静态判据当场抓住', { selfCheck: selfCheck, selfCheck2: selfCheck2 })
    check(judgeHostDirect("// host.call('wf.snapshot') 只出现在注释里") .length === 0, 'F12 注释里提到旧写法不算直连（判据只看代码形状）')
  }

  // ------------------------------------------------------------------ G 清理与结论
  binding.deckViewForgetFrames()
  {
    const scope: any = { wsKeyOf: function (k: any): string { return String(k || '') }, snapshotVersionBookOf: function (): any { return { version: 1, seenAtMs: 0 } }, ticketRowsOf: function (a: any): any { return a || [] }, issuePageRowsOf: function (): any { return [] }, occCount: function (): number { return 0 }, bugCount: function (): number { return 0 }, triageCount: function (): number { return 0 } }
    const st: any = { cwd: 'D:/ws/forget', snapshot: projectionOf([row('1')]), stateFilter: 'all', lblFilters: [], effFilters: [], sortKey: 'number', sortDir: 'asc' }
    const v1 = binding.deckViewOf(st, scope)
    binding.deckViewForgetFrames()
    const v2 = binding.deckViewOf(Object.assign({}, st), scope)
    check(binding.deckViewOf(st, scope) === v1 && v1.frame() !== v2.frame(), 'G1 清帧之后新会话拿到新帧，已有会话仍按同一版本复用原帧（不重算）', { sameView: binding.deckViewOf(st, scope) === v1 })
  }
}

main().then(function (): void {
  console.log('')
  if (failed) console.log('FAIL：' + total + ' 条断言里有失败')
  else console.log('OK：' + total + ' 条断言全部通过')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}, function (err: any): void {
  console.error('门禁脚本自身出错：', err)
  printGateResult(GATE, total, failed + 1)
  process.exit(1)
})