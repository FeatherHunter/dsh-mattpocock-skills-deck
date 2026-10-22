// tests/verify-1291-closed-map-open-children.ts —— 门禁：父容器关掉了，它下面还开着的子票仍要回到「可接」首屏（票 #1291）
//
// 现场（诊断写在 issue #1291 正文里）：
//   #691 的取舍是「已关闭地图的子票不进首屏，只留瘦身行」。原来这条判据只看容器的状态，于是地图 #2 关掉后，
//   它下面还开着、没人认领、也没被阻塞的 #16 也被一起藏了：既不在任何容器的 tickets 里，也不进 issues。
//   「可接」列表一行都看不到它，而状态栏与 KPI 仍按后端 counts.open 说「可接 1 张」—— 数字与列表对不上。
// 修法（#1291）：判据改成看子票自己的状态，只藏「容器已关闭、子票自己也是 CLOSED」的行；还开着的子票
//   以完整字段回到 issues（容器行的 tickets 仍为空）。前端与计数公式一行不用改。
//
// 这一条门禁用合成夹具把四件事逐件断：
//   一、纯组装（assembleSnapshot 真函数）：地图容器不带子票；还开着的子票以完整字段回到 issues；
//       已关闭的子票只留六字段瘦身行，不进 issues。
//   二、编排（composeSnapshot 真函数）：同一份夹具经编排后仍是这个形状；deck.counts 照旧来自后端读数。
//   三、客户端复算（store-derived 与状态栏 checksumsOf 真函数）：按宿主口径把快照拼成扁平 issues 后，
//       可接列表行数 == 状态栏「可接」数字 == 列表顶部 KPI「可接」数字；同一张子票被认领后两边一起变（不是恰好都为零）；后端不给计数时退回
//       按池子派生，两边仍然相等；再加一份「开放地图带子票」的夹具，免得相等只是恰好都为零。
//   四、另一类容器（规格）：地图与规格在组装层共用同一段分支，规格收口后也只藏已关闭的子票，
//       还开着的照常回 issues —— 免得以后有人只照着地图改，把规格这一半漏掉。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1291-closed-map-open-children.ts（插件根目录）
// 门禁归属: src/host/tracker/snapshotAssemble.ts
// 门禁归属: src/host/tracker/snapshot.ts
// 门禁归属: src/host/sessionSnapshot.ts
// 门禁归属: src/client/kernel/store-derived.ts
// 门禁归属: src/client/statusbar/checksums.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileFn } from './lib/eval-probe.js'
import { spliceableJs, transpiledSourceText } from './lib/source-text.ts'
import { assembleSnapshot } from '../src/host/tracker/snapshotAssemble.ts'
import { createSnapshotComposer } from '../src/host/tracker/snapshot.js'

let failed = false
let total = 0
const check = function (ok: any, msg: string): void {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}
const keysOf = function (rows: any): string {
  return (Array.isArray(rows) ? rows : []).map(function (x: any): string { return String(x && x.key) }).sort().join(',')
}

// 客户端纯函数与状态栏读数都走真源码。checksums.ts 是「拼进同一个浏览器闭包」的叶子，跨文件名字靠闭包，
// 所以这里按 verify-1355 的同一手法把它当模块跑起来，把闭包里的邻居按参数塞进去。
// store-derived.ts 同样靠闭包里的身份函数（idOf / idOfParts / effortOf / refKeyOf）做事：直接 import 会
// 缺这几个名字，占用判定会静默走进 catch 兜底，复算就变成假相等。这里照 verify-544 的做法，把它真源按全仓
// 口径转译后放临时文件，再从 src/tracker/kernel/identity-keys.ts 显式导入同一份身份函数，跑的是真函数。
const HERE = path.dirname(fileURLToPath(import.meta.url))
const identityHref = pathToFileURL(path.join(HERE, '..', 'src', 'tracker', 'kernel', 'identity-keys.ts')).href
const sd: any = await (async function () {
  const src: string = transpiledSourceText('src/client/kernel/store-derived.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-1291-derived-'))
  const file = path.join(dir, 'store-derived.mjs')
  fs.writeFileSync(file, 'import { idOf, idOfParts, effortOf, refKeyOf } from ' + JSON.stringify(identityHref) + '\n' + src, 'utf8')
  try {
    return await import(pathToFileURL(file).href)
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 临时目录清不掉不算门禁失败 */ }
  }
})()
const checksums: any = (function () {
  const scope: Record<string, any> = {
    occCount: function (s: any): any { return sd.occCount(s) },
    deckCountsOf: function (s: any, scoped: any): any { return sd.deckCountsOf(s, scoped) },
    frontierCount: function (s: any): any { return sd.frontierCount(s) },
    bugCount: function (): number { return 0 },
    triageCount: function (): number { return 0 },
    readyCount: function (): number { return 0 },
    getProbeAt: function (): number { return 0 },
    timeOf: function (): string { return '' },
    timeOfMs: function (): number { return 0 },
  }
  const names = Object.keys(scope)
  const fn = compileFn(names, spliceableJs('src/client/statusbar/checksums.ts') + '\nreturn { checksumsOf }')
  return fn.apply(null, names.map(function (k: string): any { return scope[k] }))
})()

// 合成夹具：#2 是一张已关闭的地图，地图下 #3-#14 已关闭、#16 还开着且没人认领；#1 是一张已关闭的拉取请求。
// counts 与环境里那份真实现场一致（open 1 / closed 14 / total 15）—— #1291 的数字与列表对不上就长这样。
const mkRows = function (opts: any): any[] {
  const o = opts || {}
  const mk = function (key: any, state: any, extra: any): any {
    return Object.assign({ key: String(key), number: Number(key), state: state, type: 'issue', title: '票 ' + key, body: '', url: '', parentKey: null, labels: [], assignees: [], blockedBy: [], isPullRequest: false }, extra || {})
  }
  const rows: any[] = [mk(1, 'CLOSED', { isPullRequest: true }), mk(2, 'CLOSED', { type: 'map', title: '已关闭的地图' })]
  for (let n = 3; n <= 14; n++) rows.push(mk(n, 'CLOSED', { parentKey: '2' }))
  rows.push(mk(16, 'OPEN', { parentKey: '2', title: '地图下还开着的子票', assignees: o.assignedTo ? [{ login: o.assignedTo }] : [], blockedBy: [] }))
  return rows
}
const REF = { backend: 'fake', refId: 'acme/demo', name: 'demo', url: '' }
const THIN_FIELDS = 'effortId,key,number,state,title,type'

const snapshotOf = async function (id: string, rows: any[], countsData: any): Promise<any> {
  const fakeTracker = {
    list: async function (): Promise<any> { return { ok: true, data: rows } },
    counts: async function (): Promise<any> { return countsData ? { ok: true, data: countsData } : { ok: false, error: { kind: 'fetch-failed', message: 'counts 取不到' } } },
  }
  const composer = createSnapshotComposer({ get: function (bid: string): any { return bid === id ? fakeTracker : undefined } }, { snapshotTtl: 1 })
  const res: any = await composer.composeSnapshot(id, REF, {}, { force: true })
  return res
}

// ── 一、纯组装：判据落在子票自己的状态上 ─────────────────────────────────────────
console.log('#1291 一、纯组装：已关闭地图里还开着的子票回到 issues，已关闭的仍是瘦身行')
{
  const snap = assembleSnapshot(REF, mkRows({}))
  const closedMap = (snap.maps || []).filter(function (m: any): boolean { return String(m.key) === '2' })[0] || {}
  check(Array.isArray(closedMap.tickets) && closedMap.tickets.length === 0, '已关闭的地图只有容器行、不带子票（实得 ' + JSON.stringify(keysOf(closedMap.tickets)) + '）')
  const openChild = (snap.issues || []).filter(function (x: any): boolean { return String(x.key) === '16' })[0] || null
  check(!!openChild, '地图下还开着的子票回到「未挂图的票」这条通道（实得 issues: ' + keysOf(snap.issues) + '）')
  check(!!openChild && openChild.state === 'OPEN' && openChild.title === '地图下还开着的子票'
    && Array.isArray(openChild.assignees) && Array.isArray(openChild.blockedBy) && openChild.type === 'issue',
    '回到首屏的那一行是完整行：状态、标题、认领人与阻塞边都还在（实得 ' + JSON.stringify(openChild && { state: openChild.state, title: openChild.title, assignees: openChild.assignees, blockedBy: openChild.blockedBy, type: openChild.type }) + '）')
  const closedChildren = (snap.issues || []).filter(function (x: any): boolean { return Number(x.key) >= 3 && Number(x.key) <= 14 })
  check(closedChildren.length === 0, '已关闭的子票不进 issues（首屏体积不回退；实得 ' + JSON.stringify(closedChildren.map(function (x: any): string { return String(x.key) })) + '）')
  check(keysOf(snap.thinTickets) === '10,11,12,13,14,3,4,5,6,7,8,9', '已关闭的子票只留瘦身行，一张不少（实得 ' + JSON.stringify(keysOf(snap.thinTickets)) + '）')
  check((snap.thinTickets || []).every(function (t: any): boolean { return t && Object.keys(t).sort().join(',') === THIN_FIELDS }), '瘦身行仍是那六样字段，正文、认领人与阻塞边都不带（实得 ' + JSON.stringify((snap.thinTickets || [])[0]) + '）')
  check(keysOf(snap.thinTickets).indexOf('16') < 0, '回到首屏的那张票不再重复出现在瘦身行里（实得 ' + JSON.stringify(keysOf(snap.thinTickets)) + '）')
}

// ── 二、编排：真编排器跑一遍，形状不变、计数照旧读后端 ────────────────────────────
console.log('#1291 二、编排：composeSnapshot 之后形状不变，deck.counts 照旧来自后端')
const resA: any = await snapshotOf('fake-a', mkRows({}), { open: 1, closed: 14, total: 15 })
{
  check(resA.ok === true, '编排器照常给出一份快照（实得 ' + JSON.stringify(resA.ok ? 'ok' : resA.error) + '）')
  const snap = resA.snapshot || {}
  check(keysOf((snap.issues || []).filter(function (x: any): boolean { return String(x.key) === '16' })) === '16', '还开着的子票在编排后的快照里也在 issues（实得 ' + keysOf(snap.issues) + '）')
  const closedMap = (snap.maps || []).filter(function (m: any): boolean { return String(m.key) === '2' })[0] || {}
  check(Array.isArray(closedMap.tickets) && closedMap.tickets.length === 0, '编排后的地图容器仍然不带子票')
  check(!!snap.deck && !!snap.deck.counts && snap.deck.counts.open === 1 && snap.deck.counts.total === 15, 'deck.counts 照旧来自后端读数（实得 ' + JSON.stringify(snap.deck && snap.deck.counts) + '）')
}

// ── 三、客户端复算：可接列表行数 == 可接数字（#1291 的验收断言）───────────────────
// 口径真源：列表「可接」筛的是 openIssuesOf 里未被 isOccupied 的行（views/ListTab.ts 的 frontier 过滤），
//   状态栏与 KPI 的「可接」读 counts ? max(0, counts.open - occCount) : frontierCount
//   （src/client/statusbar/checksums.ts:36-38；ListTab.ts:316-321 同一条式子）。
// 先按宿主真口径把快照拼成客户端看到的那一份：容器行 + 各容器子票 + 未挂图的票合成一份扁平 issues
//   （src/host/sessionSnapshot.ts:168-204 的 allForList；#589 去重在这里不会遇到重复，组装层已保证三段互斥）。
//   不拼的话，组装层「容器与子票分开」的形状会让客户端复算漏掉地图子票，相等可能只是恰好都为零。
const clientSnapshotOf = function (snap: any): any {
  const all: any[] = []
  ;(snap.maps || []).forEach(function (m: any): void {
    all.push(Object.assign({}, m, { key: String(m.key), number: m.number != null ? m.number : parseInt(String(m.key), 10) || 0 }))
    ;(m.tickets || []).forEach(function (t: any): void { all.push(t) })
  })
  ;(snap.issues || []).forEach(function (it: any): void { all.push(it) })
  return Object.assign({}, snap, { issues: all })
}
console.log('#1291 三、客户端复算：可接列表行数 == 可接数字')
const equality = function (label: string, snap: any): any {
  const st: any = { snapshot: clientSnapshotOf(snap) }
  const rows = sd.openIssuesOf(st).filter(function (x: any): boolean { return !sd.isOccupied(st, x) })
  const csx: any = checksums.checksumsOf(st)
  check(csx.fr === rows.length, label + '：可接数字与可接列表行数相等（数字 ' + csx.fr + ' / 行数 ' + rows.length + '）')
  // 列表顶部 KPI 的「可接」与状态栏同源，但列表界面里走的是 ListTab 自己那一行算式（views/ListTab.ts:317-320：
  //   可接 = 后端未关闭张数 - 本地数出来的占用；拿不到计数时 = 池子里的未关闭行数 - 占用）。这里按同一份池子与
  //   占用逐项再算一遍，确认 KPI 数字同样等于列表行数，而不只是状态栏那颗数字对得上。
  const kpiCounts = sd.deckCountsOf(st, false)
  const kpiOpenScoped = sd.openIssuesOf(st)
  const kpiOcc = kpiOpenScoped.filter(function (x: any): boolean { return sd.isOccupied(st, x) }).length
  const kpiFrontier = kpiCounts ? Math.max(0, kpiCounts.open - kpiOcc) : (kpiOpenScoped.length - kpiOcc)
  check(kpiFrontier === rows.length, label + '：列表顶部 KPI 的「可接」数字也等于行数（KPI ' + kpiFrontier + ' / 行数 ' + rows.length + '）')
  check(kpiFrontier === csx.fr, label + '：KPI 与状态栏两个「可接」数字一致（KPI ' + kpiFrontier + ' / 状态栏 ' + csx.fr + '）')
  return { st: st, rows: rows, csx: csx }
}
{
  const a = equality('地图下还开着的子票没人认领', resA.snapshot)
  check(a.csx.fr === 1 && a.rows.length === 1 && String(a.rows[0].key) === '16', '数字与列表都指向那张还开着的子票 #16（实得 ' + JSON.stringify({ fr: a.csx.fr, rows: keysOf(a.rows) }) + '）')
  check(a.csx.n >= 0 && a.csx.timeStr === '-- --:--', '状态栏其余读数照常算得出来（不因这张票崩掉）')
}
{
  const resB: any = await snapshotOf('fake-b', mkRows({ assignedTo: 'alice' }), { open: 1, closed: 14, total: 15 })
  const b = equality('同一张子票被认领之后', resB.snapshot)
  check(b.csx.fr === 0 && b.rows.length === 0, '被认领之后两边一起变成 0（不是恰好都为零的假相等；实得 ' + JSON.stringify({ fr: b.csx.fr, rows: keysOf(b.rows) }) + '）')
  const inPool = (resB.snapshot.issues || []).filter(function (x: any): boolean { return String(x.key) === '16' })
  check(inPool.length === 1, '被认领的票仍以完整行留在池子里（列表的「占用」页签看得到它）')
}
{
  // 后端不给计数（旧快照 / 配额耗尽）：数字退回按池子派生，与列表行数仍然相等。
  const noCounts = Object.assign({}, resA.snapshot, { deck: null })
  const c = equality('拿不到后端计数时退回按池子派生', noCounts)
  check(c.csx.fr === 1 && c.rows.length === 1, '退回派生值之后数字仍是 1（实得 ' + JSON.stringify({ fr: c.csx.fr, rows: keysOf(c.rows) }) + '）')
}
{
  // 反例守卫：夹具里再加一张开放地图与它的子票（地图子票在组装层只挂在图的 tickets 里）。
  //   客户端拿到的是宿主拼好的扁平 issues（容器 + 全部子票 + 未挂图的票），所以这两行都算「可接」；
  //   要是复算漏了拼这一步，行数会少两行，相等就会变成恰好都为零的假相等。
  const mapRows = [
    { key: '30', number: 30, state: 'OPEN', type: 'map', title: '还开着的地图', body: '', url: '', parentKey: null, labels: [], assignees: [], blockedBy: [], isPullRequest: false },
    { key: '31', number: 31, state: 'OPEN', type: 'issue', title: '开着的地图里的子票', body: '', url: '', parentKey: '30', labels: [], assignees: [], blockedBy: [], isPullRequest: false },
  ]
  const resD: any = await snapshotOf('fake-d', mapRows, { open: 2, closed: 0, total: 2 })
  const d = equality('开放地图带子票', resD.snapshot)
  check(d.csx.fr === 2 && d.rows.length === 2, '开放地图容器与它的子票都算进可接（数字 2 / 行数 2）')
}

// ── 四、另一类容器：规格收了也只藏已关闭的子票 ─────────────────────────────────
console.log('#1291 四、另一类容器：规格容器收口后，还开着的子票同样回到 issues')
{
  const mkSpecRow = function (key: any, state: any, extra: any): any {
    return Object.assign({ key: String(key), number: Number(key), state: state, type: 'issue', title: '票 ' + key, body: '', url: '', parentKey: null, labels: [], assignees: [], blockedBy: [], isPullRequest: false }, extra || {})
  }
  const specRows = [
    mkSpecRow(20, 'CLOSED', { type: 'spec', title: '已收口的规格' }),
    mkSpecRow(21, 'CLOSED', { parentKey: '20', title: '规格下已关闭的实施票' }),
    mkSpecRow(22, 'OPEN', { parentKey: '20', title: '规格下还开着的实施票' }),
  ]
  const snap = assembleSnapshot(REF, specRows)
  const spec = (snap.maps || []).filter(function (m: any): boolean { return String(m.key) === '20' })[0] || {}
  check(Array.isArray(spec.tickets) && spec.tickets.length === 0, '规格容器收口后也不带子票（实得 ' + JSON.stringify(keysOf(spec.tickets)) + '）')
  check(keysOf((snap.issues || []).filter(function (x: any): boolean { return String(x.key) === '22' })) === '22', '规格下还开着的实施票以完整行回到 issues（实得 ' + keysOf(snap.issues) + '）')
  check(keysOf(snap.thinTickets) === '21', '规格下已关闭的实施票只留瘦身行（实得 ' + JSON.stringify(keysOf(snap.thinTickets)) + '）')
}

console.log('\n共 ' + total + ' 条断言' + (failed ? ' — 存在失败' : ' — 全部通过'))
process.exit(failed ? 1 : 0)
