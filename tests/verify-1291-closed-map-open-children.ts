// tests/verify-1291-closed-map-open-children.ts —— 门禁：父地图关掉了，图下还开着的子票仍要回到「可接」首屏（票 #1291）
//
// 现场（诊断写在 issue #1291 正文里）：
//   #691 的取舍是「已关闭地图的子票不进首屏，只留瘦身行」。原来这条判据只看容器的状态，于是地图 #2 关掉后，
//   它下面还开着、没人认领、也没被阻塞的 #16 也被一起藏了：既不在任何图的 tickets 里，也不进 issues。
//   「可接」列表一行都看不到它，而状态栏与 KPI 仍按后端 counts.open 说「可接 1 张」—— 数字与列表对不上。
// 修法（#1291）：判据改成看子票自己的状态，只藏「容器已关闭、子票自己也是 CLOSED」的行；还开着的子票
//   以完整字段回到 issues（地图容器的 tickets 仍为空）。前端与计数公式一行不用改。
//
// 这一条门禁用一份合成夹具把四件事逐件断：
//   一、纯组装（assembleSnapshot 真函数）：地图容器不带子票；还开着的子票以完整字段回到 issues；
//       已关闭的子票只留六字段瘦身行，不进 issues。
//   二、编排（composeSnapshot 真函数）：同一份夹具经编排后仍是这个形状；deck.counts 照旧来自后端读数。
//   三、客户端复算（store-derived 与状态栏 checksumsOf 真函数）：可接列表行数 == 可接数字；
//       同一张子票被认领后两边一起变（不是恰好都为零）；后端不给计数时退回按池子派生，两边仍然相等。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1291-closed-map-open-children.ts（插件根目录）
import { compileFn } from './lib/eval-probe.js'
import { spliceableJs } from './lib/source-text.ts'
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
const sd: any = await import('../src/client/kernel/store-derived.js')
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

// 合成夹具：#2 是一张已关闭的地图，图下 #3-#14 已关闭、#16 还开着且没人认领；#1 是一张已关闭的拉取请求。
// counts 与环境里那份真实现场一致（open 1 / closed 14 / total 15）—— #1291 的数字与列表对不上就长这样。
const mkRows = function (opts: any): any[] {
  const o = opts || {}
  const mk = function (key: any, state: any, extra: any): any {
    return Object.assign({ key: String(key), number: Number(key), state: state, type: 'issue', title: '票 ' + key, body: '', url: '', parentKey: null, labels: [], assignees: [], blockedBy: [], isPullRequest: false }, extra || {})
  }
  const rows: any[] = [mk(1, 'CLOSED', { isPullRequest: true }), mk(2, 'CLOSED', { type: 'map', title: '已关闭的地图' })]
  for (let n = 3; n <= 14; n++) rows.push(mk(n, 'CLOSED', { parentKey: '2' }))
  rows.push(mk(16, 'OPEN', { parentKey: '2', title: '图下还开着的子票', assignees: o.assignedTo ? [{ login: o.assignedTo }] : [], blockedBy: [] }))
  return rows
}
const REF = { backend: 'fake', refId: 'acme/demo', name: 'demo', url: '' }
const CONTAINER = { backend: 'fake', refId: 'acme/demo', name: 'demo', url: '' }
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
  const snap = assembleSnapshot(CONTAINER, mkRows({}))
  const closedMap = (snap.maps || []).filter(function (m: any): boolean { return String(m.key) === '2' })[0] || {}
  check(Array.isArray(closedMap.tickets) && closedMap.tickets.length === 0, '已关闭的地图只有容器行、不带子票（实得 ' + JSON.stringify(keysOf(closedMap.tickets)) + '）')
  const openChild = (snap.issues || []).filter(function (x: any): boolean { return String(x.key) === '16' })[0] || null
  check(!!openChild, '图下还开着的子票回到「未挂图的票」这条通道（实得 issues: ' + keysOf(snap.issues) + '）')
  check(!!openChild && openChild.state === 'OPEN' && openChild.title === '图下还开着的子票'
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
console.log('#1291 三、客户端复算：可接列表行数 == 可接数字')
const equality = function (label: string, snap: any): any {
  const st: any = { snapshot: snap }
  const rows = sd.openIssuesOf(st).filter(function (x: any): boolean { return !sd.isOccupied(st, x) })
  const csx: any = checksums.checksumsOf(st)
  check(csx.fr === rows.length, label + '：可接数字与可接列表行数相等（数字 ' + csx.fr + ' / 行数 ' + rows.length + '）')
  return { st: st, rows: rows, csx: csx }
}
{
  const a = equality('图下还开着的子票没人认领', resA.snapshot)
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

console.log('\n共 ' + total + ' 条断言' + (failed ? ' — 存在失败' : ' — 全部通过'))
process.exit(failed ? 1 : 0)
