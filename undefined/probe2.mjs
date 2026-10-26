
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
console.log('tableLeaf keys', Object.keys(tableLeaf))
const nowIso = new Date().toISOString()
const raw = { ok: true, readout: { at: nowIso, staleCount: 0, entries: [
  { ticketKey: '1460', title: '', sessionLabel: 'sess-mine-aaa', action: 'edit', actionAt: nowIso, active: true, currentSession: true } ] } }
const st = { snapshot: { issues: [], workRouteTable: raw } }
console.log('direct view', JSON.stringify(tableLeaf.workRouteTableOf(st)))
