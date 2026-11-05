/**
 * tests/verify-1895-map-detail-vm.ts —— 地图详情页接到视图模型（#1895，规格 #1885 S6）
 *
 * 守什么（票面四条验收逐条落在这里）：
 *   A 地图详情的容器树、子票、层级与统计都来自视图模型：构造视图模型并喂一份投影，
 *     `mapDetail` 切片里的容器行、子票数组、stats 与 stats.levels 就是投影里那一份（连对象引用都相同），
 *     容器树（全部容器）也在切片里；同一版本再次采纳不重算，换版本才更新。
 *   B 打开地图详情不再单独向宿主取数（取数次数断言）：用生产接线 deckViewOf + 假宿主电话，
 *     打开地图、读切片、同一版本再取一次、换版本再打开另一张图——这一整条命令链上宿主电话调用次数为 0。
 *   C 同一版本下列表与地图详情对同一张票一致：同一份投影同时喂给列表用的分组函数（store-derived 的 compute，
 *     列表页行的来源）与地图详情选择器，逐张票比对状态；换一个版本后两边一起变。
 *   D 视图层不再直接调宿主电话（静态判据）：本票真正迁移过的页面文件里不出现 host.call( / rpcCall( /
 *     fetchMapTickets( / .call('wf.…)；进页面取数的旧接线文件已经不在了，构建清单也不再登记它；
 *     并带一条反证，证明这道静态判据本身抓得住直连写法。
 *
 * 为什么能单独跑：视图模型与地图详情选择器都是纯数据层（不挂 React、不起浏览器、不发电话）。
 * 这一趟按规格「视图状态」那条接缝直接构造它、喂假投影与假宿主电话，断言状态迁移与切片内容。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1895-map-detail-vm.ts
 */
// 门禁归属: src/client/kernel/deck-map-detail.ts
// 门禁归属: src/client/kernel/deck-view-model.ts
// 门禁归属: src/client/kernel/deck-view-binding.ts
// 门禁归属: src/client/views/mapDetailV2/view/MapDetailV2Page.ts

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { printGateResult } from './lib/gate-result.ts'
import { sourceText } from './lib/source-text.ts'
import * as identity from '../src/tracker/kernel/identity-keys.ts'
import { createDeckView, deckReadingOf } from '../src/client/kernel/deck-view-model.ts'
import { deckMapDetailOf } from '../src/client/kernel/deck-map-detail.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GATE = 'verify-1895-map-detail-vm'

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

/** 视图层直连宿主或自己取数的形状：host.call( / rpcCall( / .call('wf.…) / fetchMapTickets(。 */
function judgeDirectFetch(source: string): string[] {
  const code = codeOnly(source)
  const hits: string[] = []
  if (/\bhost\s*\.\s*call\s*\(/.test(code)) hits.push('host.call(')
  if (/\brpcCall\s*\(/.test(code)) hits.push('rpcCall(')
  if (/\.\s*call\s*\(\s*['"]wf\./.test(code)) hits.push(".call('wf.…)")
  if (/\bfetchMapTickets\s*\(/.test(code)) hits.push('fetchMapTickets(')
  return hits
}

// 身份算法是本门禁里几份真实现（findMapByIdentity / compute）的公共依赖；按生产闭包的样子先挂上。
;(globalThis as any).idOf = identity.idOf
;(globalThis as any).idOfParts = identity.idOfParts
;(globalThis as any).effortOf = identity.effortOf
;(globalThis as any).refKeyOf = identity.refKeyOf
const { findMapByIdentity, compute } = await import('../src/client/kernel/store-derived.ts')

function ticket(key: string, extra?: any): any {
  return Object.assign({
    key: key, number: Number(key), effortId: 'default', type: 'issue', title: '票 ' + key, state: 'OPEN',
    labels: [], assignees: [], blockedBy: [], updatedAt: '2026-11-01T00:00:00.000Z',
  }, extra || {})
}

function container(key: string, extra?: any): any {
  return ticket(key, Object.assign({ type: 'map', tickets: [], stats: null }, extra || {}))
}

function statsOf(levels: any[], counts: any): any {
  return Object.assign({ levels: levels, levelOf: {} }, counts)
}

/** 一份投影（宿主组装器给的形状）：一张探索地图（三层里的两层）+ 一张规格 + 一张未挂图票。 */
const T11 = ticket('11')
const T12 = ticket('12', { blockedBy: [11] })
const T13 = ticket('13', { state: 'CLOSED' })
const T21 = ticket('21', { claimedBy: 'me' })
const MAP10 = container('10', {
  title: '地图 10',
  tickets: [T11, T12, T13],
  stats: statsOf([
    { level: 0, numbers: [11, 13], open: 1, closed: 1, total: 2, frontier: 1, claimed: 0, blocked: 0 },
    { level: 1, numbers: [12], open: 1, closed: 0, total: 1, frontier: 0, claimed: 0, blocked: 1 },
  ], { total: 3, open: 2, closed: 1, frontier: 1, claimed: 0, blocked: 1, levelOf: { 11: 0, 12: 1, 13: 0 } }),
})
const MAP20 = container('20', {
  type: 'spec', title: '规格 20',
  tickets: [T21],
  stats: statsOf([{ level: 0, numbers: [21], open: 1, closed: 0, total: 1, frontier: 0, claimed: 1, blocked: 0 }],
    { total: 1, open: 1, closed: 0, frontier: 0, claimed: 1, blocked: 0, levelOf: { 21: 0 } }),
})
const PLAIN = ticket('30')

function projectionOf(issues: any[], maps: any[], extra?: any): any {
  return Object.assign({ generatedMs: 1761900000000, issues: issues, maps: maps, labels: [], thinTickets: [], workRouteTable: null }, extra || {})
}

const projection = projectionOf([PLAIN], [MAP10, MAP20])

/** 同一个选择器既是视图模型的端口，也是 C 组里直接喂投影的那一份：两处走同一份实现。 */
function mapOfAny(maps: any, num: any, effortId: any): any { return findMapByIdentity(maps, num, effortId) }

function detailOfView(view: any): any {
  return view.slice('mapDetail')
}

function newView(frame: any, reading: any): any {
  return createDeckView({
    frame: frame,
    reading: reading,
    ports: {
      mapDetailOf: function (f: any, r: any): any {
        return deckMapDetailOf({ projection: f.projection, reading: r, mapOf: mapOfAny })
      },
    },
  })
}

function frameOf(version: number, proj: any): any {
  return { key: 'ws|' + version, version: version, projection: proj, counts: { total: 3 }, readout: { version: version } }
}

async function main(): Promise<void> {
  // ------------------------------------------------------------------ A 视图模型给出地图详情
  {
    const view = newView(frameOf(5, projection), { activeMap: 10, activeMapEffort: 'default' })
    const detail = detailOfView(view)
    check(!!detail && detail.map === MAP10, 'A1 切片里的容器行就是投影里的那一行（同一对象，不是重拼一份）')
    check(detail.tickets === MAP10.tickets && detail.tickets.length === 3 && detail.tickets.map(function (t: any): any { return t.state }).join(',') === 'OPEN,OPEN,CLOSED',
      'A2 子票就是这一行的子票数组（三张、状态原样）', detail && detail.tickets && detail.tickets.length)
    check(detail.levels === MAP10.stats.levels && detail.levels.length === 2 && detail.levels[1].numbers[0] === 12,
      'A3 层级与宿主算好的 stats.levels 是同一份（第 2 层是 #12）', detail && detail.levels)
    check(!!detail.stats && detail.stats.total === 3 && detail.stats.closed === 1 && detail.stats.blocked === 1,
      'A4 每张地图的统计就是投影行上的 stats（总 3 / 关 1 / 被挡 1）', detail && detail.stats)
    check(Array.isArray(detail.containers) && detail.containers === projection.maps && detail.containers.length === 2,
      'A5 容器树整棵都在切片里（两张容器，与投影同一数组）', detail && detail.containers && detail.containers.length)
    check(detail.kind === 'map' && detail.source === 'projection', 'A6 切片的容器种类与来源说清楚（地图 / 投影）', { kind: detail.kind, source: detail.source })

    view.command('openMap', { number: 20, effortId: 'default' })
    const spec = detailOfView(view)
    check(spec.map === MAP20 && spec.kind === 'spec' && spec.stats.claimed === 1,
      'A7 命令打开另一张容器后，切片换成规格那一行（种类与统计跟着换）', spec && spec.kind)

    const empty = newView(frameOf(5, projection), { activeMap: null })
    const none = detailOfView(empty)
    check(none.map === null && none.source === 'none' && none.tickets.length === 0 && none.stats === null && none.containers.length === 2,
      'A8 没有打开任何容器时如实说「不知道」（不拿第一张容器冒充），容器树仍在', none && { map: none.map, source: none.source })

    const otherMap = container('10', { effortId: 'other', title: '别的工作单元的 10 号图' })
    const multi = projectionOf([], [MAP10, otherMap])
    const multiView = newView(frameOf(5, multi), { activeMap: 10, activeMapEffort: 'other' })
    check(detailOfView(multiView).map === otherMap,
      'A9 同号不同工作单元的容器不互相顶替（身份按 effort + 编号认）', detailOfView(multiView).map && detailOfView(multiView).map.effortId)

    const beforeSlice = detailOfView(view)
    const beforeVer = view.versionOf('mapDetail')
    const adopted = view.adopt({ frame: frameOf(5, projectionOf([], [MAP10])) })
    check(adopted.outcome === 'reused' && detailOfView(view) === beforeSlice && view.versionOf('mapDetail') === beforeVer,
      'A10 同一版本收到另一份投影也判复用：地图详情切片连对象引用都不换', { outcome: adopted.outcome, ver: view.versionOf('mapDetail') })

    view.command('openMap', { number: 10, effortId: 'default' })
    const beforeNewVer = view.versionOf('mapDetail')
    const beforeNewSlice = detailOfView(view)
    const changed = view.adopt({ frame: frameOf(6, projectionOf([], [MAP10])) })
    check(changed.changed.indexOf('mapDetail') >= 0 && view.versionOf('mapDetail') > beforeNewVer && detailOfView(view).map === MAP10 && detailOfView(view) !== beforeNewSlice,
      'A11 换到新版本才重算地图详情切片（并通知订阅者）', { changed: changed.changed, ver: view.versionOf('mapDetail') })

    view.command('closeDetail')
    check(detailOfView(view).map === null && view.reading().activeMap === null,
      'A12 关闭详情后切片回到「没有打开任何容器」', view.reading())
  }

  // ------------------------------------------------------------------ B 打开地图详情不向宿主取数
  {
    ;(globalThis as any).createDeckView = createDeckView
    ;(globalThis as any).deckFiltersOf = (await import('../src/client/kernel/deck-view-model.ts')).deckFiltersOf
    ;(globalThis as any).deckReadingOf = deckReadingOf
    ;(globalThis as any).deckMapDetailOf = deckMapDetailOf
    const binding: any = await import('../src/client/kernel/deck-view-binding.ts')

    const calls: any[] = []
    const host = { call: function (method: string, args: any): any { calls.push({ method: method, args: args }); return Promise.resolve({ ok: true }) } }
    let version = 5
    let snapshot = projection
    const scope: any = {
      host: host,
      findMapByIdentity: findMapByIdentity,
      ticketRowsOf: function (a: any): any[] { return a || [] },
      issuePageRowsOf: function (): any[] { return [] },
      isOccupied: function (): boolean { return false },
      occCount: function (): number { return 0 },
      deckCountsOf: function (): any { return null },
      bugCount: function (): number { return 0 },
      triageCount: function (): number { return 0 },
      kpiCountsOf: function (): any { return { takeable: 0, closed: 0, unknown: false, pending: false, atMs: 0, source: 'local-enumeration' } },
      listPrefs: { stateFilter: 'all', sortKey: 'number', sortDir: 'asc' },
      saveListPrefs: function (): void {},
      wsKeyOf: function (k: any): string { return String(k || '') },
      snapshotVersionBookOf: function (): any { return { version: version, seenAtMs: 0 } },
    }
    const st: any = {
      cwd: 'D:/ws/vm', snapshot: snapshot, sessionId: 's1',
      stateFilter: 'all', lblFilters: [], effFilters: [], sortKey: 'number', sortDir: 'asc', expLabels: false,
      activeIssue: null, activeMap: 10, activeEffortId: 'default', cmtDraft: '',
    }
    binding.deckViewForgetFrames()
    const view = binding.deckViewOf(st, scope)
    check(calls.length === 0 && binding.deckViewSliceOf(st, 'mapDetail', scope).map === MAP10,
      'B1 生产接线按当前打开的容器给出地图详情，这一趟一条宿主电话都没发', calls.length)
    const opened = binding.deckViewCommand(st, 'openMap', { number: 20, effortId: 'default' }, scope)
    check(opened.changed.indexOf('reading') >= 0 && calls.length === 0,
      'B2 「打开地图详情」这条命令链上宿主电话调用次数为 0', { calls: calls.length, changed: opened.changed })
    check(binding.deckViewSliceOf(st, 'mapDetail', scope).map === MAP20 && st.activeMap === 20,
      'B3 命令之后切片换成规格那一行（数据来自视图模型，不是新取的）')
    binding.deckViewOf(st, scope)
    binding.deckViewSliceOf(st, 'mapDetail', scope)
    check(calls.length === 0, 'B4 同一版本再取视图模型与切片：仍然 0 次宿主电话', calls.length)
    version = 6
    snapshot = projectionOf([], [MAP10])
    st.snapshot = snapshot
    binding.deckViewCommand(st, 'openMap', { number: 10, effortId: 'default' }, scope)
    check(calls.length === 0 && binding.deckViewSliceOf(st, 'mapDetail', scope).map === MAP10,
      'B5 换版本再打开一张图：仍然 0 次宿主电话（版本从帧来，不靠取数）', calls.length)
    binding.deckViewForgetFrames()
  }

  // ------------------------------------------------------------------ C 同一版本：列表与地图详情对同一张票一致
  {
    const listGroups = compute({ snapshot: projection })
    const listMap = listGroups.filter(function (g: any): boolean { return g.m === MAP10 })[0]
    const detail = deckMapDetailOf({ projection: projection, reading: { activeMap: 10, activeMapEffort: 'default' }, mapOf: mapOfAny })
    const listStateOf = function (n: number): string {
      const row = (listMap.open || []).concat(listMap.closed || []).filter(function (t: any): boolean { return Number(t.number) === n })[0]
      return row ? String(row.state) : ''
    }
    const detailStateOf = function (n: number): string {
      const row = detail.tickets.filter(function (t: any): boolean { return Number(t.number) === n })[0]
      return row ? String(row.state) : ''
    }
    check(detail.map === listMap.m, 'C1 列表分组与地图详情拿的是同一个容器对象')
    check(detail.tickets.every(function (t: any): boolean { return listStateOf(Number(t.number)) === String(t.state) }),
      'C2 逐张票比对：地图详情里每张子票的状态与列表分组里的同一张票相同',
      detail.tickets.map(function (t: any): any { return [t.number, listStateOf(Number(t.number)), t.state] }))
    check(listStateOf(11) === 'OPEN' && listStateOf(12) === 'OPEN' && listStateOf(13) === 'CLOSED',
      'C3 三张票在列表那侧分别是 开/开/关', [listStateOf(11), listStateOf(12), listStateOf(13)])
    check(detailStateOf(13) === 'CLOSED' && detailStateOf(12) === 'OPEN',
      'C4 同一张已关闭票与同一张被挡票在地图详情那侧状态一致', [detailStateOf(12), detailStateOf(13)])
    check((listMap.open || []).length === detail.stats.open && (listMap.closed || []).length === detail.stats.closed,
      'C5 两侧的开放/已关闭张数一致（2 / 1）', { listOpen: (listMap.open || []).length, detailOpen: detail.stats.open })

    const specGroups = compute({ snapshot: projection })
    const listSpec = specGroups.filter(function (g: any): boolean { return g.m === MAP20 })[0]
    const specDetail = deckMapDetailOf({ projection: projection, reading: { activeMap: 20, activeMapEffort: 'default' }, mapOf: mapOfAny })
    check(specDetail.map === listSpec.m && specDetail.tickets[0].state === listSpec.claimed[0].state && specDetail.tickets[0].state === 'OPEN',
      'C6 规格容器那侧也一样：列表分组的在办票与地图详情的同一张票状态一致')

    const T11b = ticket('11', { state: 'CLOSED' })
    const changedProjection = projectionOf([PLAIN], [container('10', {
      tickets: [T11b, T12, T13],
      stats: statsOf([
        { level: 0, numbers: [11, 13], open: 0, closed: 2, total: 2, frontier: 0, claimed: 0, blocked: 0 },
        { level: 1, numbers: [12], open: 1, closed: 0, total: 1, frontier: 0, claimed: 0, blocked: 0 },
      ], { total: 3, open: 1, closed: 2, frontier: 0, claimed: 0, blocked: 0 }),
    })])
    const changedGroups = compute({ snapshot: changedProjection })
    const changedMap = changedGroups.filter(function (g: any): boolean { return String(g.m.key) === '10' })[0]
    const changedDetail = deckMapDetailOf({ projection: changedProjection, reading: { activeMap: 10, activeMapEffort: 'default' }, mapOf: mapOfAny })
    check(changedMap.closed.some(function (t: any): boolean { return Number(t.number) === 11 }) && changedDetail.tickets[0].state === 'CLOSED',
      'C7 同一张票换成已关闭后，列表分组与地图详情在同一份新投影上一起变成「已关闭」')
  }

  // ------------------------------------------------------------------ D 视图层不再直接调宿主电话
  {
    const pageRel = 'src/client/views/mapDetailV2/view/MapDetailV2Page.ts'
    const page = sourceText(pageRel)
    const hookRel = 'src/client/views/mapDetailV2/wiring/useMapTicketsFeed.ts'
    const hookPath = path.join(ROOT, hookRel)
    const buildSrc = fs.readFileSync(path.join(ROOT, 'scripts/build.mts'), 'utf8')

    check(page.indexOf("useDeckViewSlice(st, 'mapDetail')") >= 0,
      'D1 页面从视图模型的 mapDetail 切片取这一页的数据（容器行、子票、统计）')
    check(page.indexOf('useMapTicketsFeed') < 0 && page.indexOf('fetchMapTickets') < 0,
      'D2 页面不再登记或调用进页面就取数的旧接线')
    check(!fs.existsSync(hookPath) && buildSrc.indexOf('useMapTicketsFeed') < 0,
      'D3 进页面就发 wf.mapTickets 的接线文件已删除，构建清单也不再登记它', { exists: fs.existsSync(hookPath) })

    const MIGRATED: string[] = [pageRel]
    check(MIGRATED.length === 1, 'D4 无直连取数的名单只收本票真正迁移过的页面文件（不是一张空头名单）', MIGRATED)
    const direct: any = {}
    for (const file of MIGRATED) { const hits = judgeDirectFetch(sourceText(file)); if (hits.length) direct[file] = hits }
    check(Object.keys(direct).length === 0, 'D5 迁移过的页面文件不直连宿主电话、也不自己发子票取数（host.call( / rpcCall( / .call(wf.…) / fetchMapTickets(）', direct)

    const selfCheck = judgeDirectFetch("export const x = function () { return host.call('wf.mapTickets', {}) }")
    const selfCheck2 = judgeDirectFetch("const p = fetchMapTickets(st, '10', {})")
    const selfCheck3 = judgeDirectFetch("const p = rpcCall('wf.snapshot', {})")
    check(selfCheck.length === 1 && selfCheck2.length === 1 && selfCheck3.length === 1,
      'D6 反证：直连宿主、自己取子票、rpc 调用三种写法都会被这道静态判据当场抓住', { selfCheck: selfCheck, selfCheck2: selfCheck2, selfCheck3: selfCheck3 })
    check(judgeDirectFetch("// 以前这里调过 fetchMapTickets(st) 与 host.call('wf.mapTickets')").length === 0,
      'D7 注释里提到旧写法不算直连（判据只看代码形状）')

    const profile = sourceText('src/client/views/mapDetailV2/view/profile/MapProfileHeader.ts')
    const flow = sourceText('src/client/views/mapDetailV2/view/flow/TicketCardFlow.ts')
    check(judgeDirectFetch(profile).length === 0 && judgeDirectFetch(flow).length === 0,
      'D8 档案区与卡片流这两份纯渲染文件也不直连宿主（页面整条渲染链没有暗路）')
  }

  // ------------------------------------------------------------------ E 页面接线：数据从切片来
  {
    const page = sourceText('src/client/views/mapDetailV2/view/MapDetailV2Page.ts')
    check(page.indexOf('detail.map') >= 0 && page.indexOf('map: m') >= 0 && page.indexOf('mapDetailPageModelOf(') >= 0,
      'E1 页面把切片里的容器行交给整页模型（m 来自 detail.map，再传给 mapDetailPageModelOf）')
    check(page.indexOf('const bucket =') >= 0 && page.indexOf("mode || '') === 'loading'") >= 0,
      'E2 取数桶只剩「有值就按它画」的只读分支（本页不再发起取数）')
    const binding = sourceText('src/client/kernel/deck-view-binding.ts')
    check(binding.indexOf('mapDetailOf') >= 0 && binding.indexOf('activeMapEffort') >= 0,
      'E3 接线层给视图模型提供 mapDetail 端口，并把当前容器的 effort 一起交给它')
    const model = sourceText('src/client/kernel/deck-map-detail.ts')
    check(model.indexOf('export function deckMapDetailOf') >= 0 && model.indexOf('containers') >= 0 && model.indexOf('levels') >= 0,
      'E4 地图详情选择器只有一个实现（导出 deckMapDetailOf，容器树、层级都在它给的切片里）')
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
