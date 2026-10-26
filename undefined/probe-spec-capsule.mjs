
import { pathToFileURL } from 'node:url'
const ROOT = 'D:/dsh-plugin/dsh-mattpocock-skills-deck/'
const u = (p) => pathToFileURL(ROOT + p).href
const { spliceableJs } = await import(u('tests/lib/source-text.ts'))
const { compileFn } = await import(u('tests/lib/eval-probe.ts'))
const tableSrc = spliceableJs('src/client/views/shared/workRouteTable.js').replace(/^[ \t]*export[ \t]+/gm, '')
const tableLeaf = compileFn(['React', 'DswsCtx', 'Tip', 'tr', 'h'],
  tableSrc + '\nreturn { WORK_ROUTE_TABLE_FIELD, workRouteActionKeyOf, workRouteTableClock, workRouteTableOf }')(
  { createElement: () => null, useContext: () => null }, null, () => null,
  (k) => String(k), () => null)
const leafSrc = spliceableJs('src/client/statusbar/SessionChainCapsule.js').replace(/^[ \t]*export[ \t]+/gm, '')
const cap = compileFn(
  ['React','DswsCtx','Tip','Ic','tr','pushNav','findMapByIdentity','openPanel','PortalOverlay','placeStatusOverlay','clearStatusClose','scheduleStatusClose','workRouteActionKeyOf','workRouteTableClock','workRouteTableOf','emit'],
  leafSrc + '\nreturn { sessionChainCapsuleOf }')(
  { createElement: () => null, useContext: () => null, useRef: (v) => ({ current: v }), useState: () => [null, () => {}] },
  null, () => null, () => null,
  (k) => String(k),   // 5 tr
  () => {},           // 6 pushNav
  () => null,         // 7 findMapByIdentity
  () => {},           // 8 openPanel
  (o, kids) => ({ overlay: true, props: o, children: kids }), // 9
  () => ({ left: 1, bottom: 2 }), // 10
  () => {},           // 11 clearStatusClose
  (r, fn) => fn(),    // 12 scheduleStatusClose
  tableLeaf.workRouteActionKeyOf,  // 13
  tableLeaf.workRouteTableClock,   // 14
  tableLeaf.workRouteTableOf,      // 15
  () => {})           // 16 emit
const nowIso = new Date().toISOString()
const table = (key) => ({ ok: true, readout: { at: nowIso, staleCount: 0, entries: [
  { ticketKey: String(key), title: '', sessionLabel: 'sess-mine-aaa', action: 'edit', actionAt: nowIso, active: true, currentSession: true } ] } })
const mkSt = (row) => ({ snapshot: { issues: [row], workRouteTable: table(row.number) } })
for (const [label, row] of [
  ['探索地图 type=map', { key: '40', number: 40, title: '地图：演示', state: 'OPEN', type: 'map', effortId: '' }],
  ['规格容器 type=spec', { key: '1460', number: 1460, title: '规格：新增 BUG 单建单前查重', state: 'OPEN', type: 'spec', effortId: '' }],
]) {
  const out = cap.sessionChainCapsuleOf(mkSt(row), 'sess-mine-aaa')
  const e = out && out.entry
  console.log(JSON.stringify({ fixture: label, state: out && out.state, ticketKey: e && e.ticketKey,
    ticketTitle: e && e.ticketTitle, isMap: e && e.isMap,
    layoutKeyText: e ? (e.isMap === true ? String(e.ticketKey) : '#' + e.ticketKey) : null,
    layoutIcon: e ? (e.isMap === true ? 'map-icon' : 'NO-ICON') : null,
    spokenTypeWord: e ? (e.isMap === true ? 'type.map' : 'none') : null }))
}
console.log('done')
