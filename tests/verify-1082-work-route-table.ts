// tests/verify-1082-work-route-table.ts —— 门禁：面板「跨会话在办表」（#1082）。
//
// 这张表要同时盯住两半，任何一半坏了都不能算完成：
//   一、宿主读数：同一次写票在工具回执 data.workRoute 里看到的那份读数，与面板快照字段
//      workRouteTable 里拿到的是**同一份**（同一存档、同一读出口、同一时刻算出来逐字相同）；
//      同一张票被两个会话先后动过时是两条、不合并；原始会话 id 不进回执；
//      没有存档文件时是「读到了、就是空的」；25 小时前动的条目算陈旧；超过 30 天的条目不再出现；
//      回包没有工作区根、读盘失败时如实说读不到。
//   二、界面：判据只认快照里那一个字段，空态/读不到/逐条三种画法分开；行上画出票号、标题、会话、
//      动作、动作时间、是否在办；本会话有标记；陈旧条目带陈旧标记；词条中英齐全。
//
// 手法：主缝用真的工作路线存储（临时家目录 + 固定时钟），从工具壳写票收口处（recordWorkRoute）
// 一路跑到面板快照挂载口；次缝把真源码按构建同一套做法装进假 React 渲染，看真实版面文字。
//
// 门禁归属: src/host/refresh/workRouteReadoutForHost.ts
// 门禁归属: src/host/snapshotEnvelope.ts
// 门禁归属: src/host/sessionSnapshot.ts
// 门禁归属: src/host/sessionRefresh.ts
// 门禁归属: src/client/views/shared/workRouteTable.ts
// 门禁归属: src/client/panel/Dock.ts
// 门禁归属: src/client/kernel/probe-snapshot.ts
//
// 用法（在插件根目录，先 node scripts/build.mts）：
//   node --import ./scripts/ts-hook.mts tests/verify-1082-work-route-table.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileFn } from './lib/eval-probe.js'
import { spliceableJs } from './lib/source-text.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)
let failed = false
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const T0 = 1700000000000
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE
const ROOT_CWD = 'D:/proj/workspace-1082'
const SID_A = 'sess-1082-alpha-1a2b3c4d'
const SID_B = 'sess-1082-bravo-5e6f7a8b'
const quietLog = { fire: function () {}, isEnabled: function () { return false } }

function memFs() {
  return {
    readFile: async (p: string) => { try { return fs.readFileSync(p, 'utf8') } catch { return null } },
    writeFile: async (p: string, c: string) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c, 'utf8') },
    mkdir: async (dir: string) => { fs.mkdirSync(dir, { recursive: true }) },
    rename: async (from: string, to: string) => { fs.renameSync(from, to) },
  }
}

/** 最小的假 React：createElement 只搭一棵普通对象树，useContext 一律返回空（组件就会退回 React.createElement）。 */
function makeReact() {
  return {
    createElement: function (type: any, props: any) {
      const kids: any[] = []
      const walk = function (k: any) { if (Array.isArray(k)) { k.forEach(walk); return } if (k === null || k === undefined || k === false) return; kids.push(k) }
      walk(Array.prototype.slice.call(arguments, 2))
      return { type: type, props: props || {}, children: kids }
    },
    useContext: function () { return null },
  }
}

/** 把一棵假 React 树里的可见文字摊平（含 Tip 的悬浮内容）。 */
function textOf(node: any): string {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).filter(Boolean).join(' ')
  const parts: string[] = []
  if (node.props && node.props.content) parts.push(textOf(node.props.content))
  if (node.props && node.props.title) parts.push(String(node.props.title))
  parts.push(textOf(node.children))
  return parts.filter(Boolean).join(' ')
}

function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, pred, out)); return out }
  if (pred(node)) out.push(node)
  if (node.children) findAll(node.children, pred, out)
  if (node.props && node.props.content) findAll(node.props.content, pred, out)
  return out
}

async function main() {
  console.log('#1082 跨会话在办表：宿主读数与工具回执同源，界面逐条画出来')
  const bindingsMod = await imp('src/deck/shell/work-path-bindings.ts') as any
  const recordMod = await imp('src/deck/shell/work-path-record.js') as any
  const keyMod = await imp('src/shared/refresh-workspace-key.js') as any
  const chainMod = await imp('src/shared/refresh/chain.js') as any
  const tableMod = await imp('src/host/refresh/workRouteReadoutForHost.ts') as any
  const envMod = await imp('src/host/snapshotEnvelope.ts') as any
  const snapMod = await imp('src/host/sessionSnapshot.ts') as any
  const refMod = await imp('src/host/sessionRefresh.ts') as any

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wproute-1082-'))
  let clock = T0
  const store = bindingsMod.createWorkRouteBindings(Object.assign({ homeDir: home, now: () => clock, log: quietLog }, memFs()))
  const rootKey = keyMod.workspaceKeyOf(ROOT_CWD)
  const deps = { workRouteNote: (i: any) => store.note(i), workRouteRead: (i: any) => store.read(i), workRouteRelease: (i: any) => store.release(i), now: () => clock }
  const sessA = { sessionId: SID_A, workspaceKey: rootKey, cwd: ROOT_CWD }
  const sessB = { sessionId: SID_B, workspaceKey: rootKey, cwd: ROOT_CWD }
  const callWrite = async (s: any, tool: string, value: any) => {
    clock += 5 * MINUTE
    await recordMod.recordWorkRoute(deps, tool, s, 'markdown', value)
    return value
  }
  const fileOf = home + '/.dsh/mattskillsdeck/work-path/' + chainMod.chainRootHash(rootKey) + '.json'

  // ── 一、宿主读数：写票收口 → 存档 → 面板字段，与回执同源 ──
  const rA101 = await callWrite(sessA, 'deck_issue_report', { status: 'ok', notes: [], data: { key: '101', title: '甲票' } })
  const rB102 = await callWrite(sessB, 'deck_issue_report', { status: 'ok', notes: [], data: { key: '102', title: '乙票' } })
  const rA103 = await callWrite(sessA, 'deck_issue_create', { status: 'ok', notes: [], touched: ['103'], data: { ticket: { key: '103', title: '丙票' } } })
  // 同一张票（101）先后被两个会话动过：面板必须显示两条、不合并。
  const rB101 = await callWrite(sessB, 'deck_issue_patch', { status: 'ok', notes: [], touched: ['101'], data: { ticket: { key: '101', title: '甲票改' } } })
  check(fs.existsSync(fileOf), '工作路线存档落在 <家目录>/.dsh/mattskillsdeck/work-path/<根散列>.json')
  check(!!(rA101.data && rA101.data.workRoute) && !!(rB101.data && rB101.data.workRoute), '四个写工具都成功收口并带回执 data.workRoute')

  const attach = tableMod.createWorkRouteTableReadout({ read: (i: any) => store.read(i), rootKeyOf: keyMod.workspaceKeyOf, now: () => clock })
  const reply: any = { ok: true, workspaceRoot: ROOT_CWD, revision: 7 }
  const field: any = await attach(reply, { sessionId: SID_B })
  check(reply.workRouteTable === field, '挂载口把同一格写进回包并交回给信封')
  check(!!field && field.ok === true && field.readout && Array.isArray(field.readout.entries), '快照回包挂上了 workRouteTable 字段（ok:true + 读数）')
  check(JSON.stringify(field.readout) === JSON.stringify(rB101.data.workRoute), '面板读数与工具回执 data.workRoute 逐字相同（同一存档、同一读出口）')
  const entries = field.readout.entries as any[]
  check(entries.length === 4, '四条在办条目全在（实得 ' + entries.length + ' 条）')
  const t101 = entries.filter((e: any) => e.ticketKey === '101')
  check(t101.length === 2 && t101[0].sessionLabel !== t101[1].sessionLabel, '同一张票被两个会话动过：显示两条、两个会话标签，不合并')
  check(t101.filter((e: any) => e.currentSession === true).length === 1, '同一张票两条里只有当前会话那一条标 currentSession')
  check(entries.filter((e: any) => e.currentSession === true).length === 2, '当前会话的两条被标出（101 与 102）')
  check(JSON.stringify(field.readout).indexOf(SID_A) < 0 && JSON.stringify(field.readout).indexOf(SID_B) < 0, '原始会话 id 不进回执（只出会话标签）')
  check(typeof field.readout.at === 'string' && field.readout.at.endsWith('Z'), '读数带一个 ISO Z 串的更新时刻')

  // 空账：没有存档文件时是「读到了、就是空的」，不是读不到。
  const homeEmpty = fs.mkdtempSync(path.join(os.tmpdir(), 'wproute-1082e-'))
  const storeEmpty = bindingsMod.createWorkRouteBindings(Object.assign({ homeDir: homeEmpty, now: () => T0, log: quietLog }, memFs()))
  const attachEmpty = tableMod.createWorkRouteTableReadout({ read: (i: any) => storeEmpty.read(i), rootKeyOf: keyMod.workspaceKeyOf, now: () => T0 })
  const emptyField: any = await attachEmpty({ ok: true, workspaceRoot: ROOT_CWD }, { sessionId: SID_A })
  check(emptyField && emptyField.ok === true && emptyField.readout.entries.length === 0, '没有工作路线存档：回 ok:true + 空表（界面画空态文案，不冒充有人）')

  // 失联与坏零件：如实说读不到，不挂一份假成功。
  const noRoot: any = await attach({ ok: true }, { sessionId: SID_A })
  check(noRoot && noRoot.ok === false && noRoot.reason === 'host.work-route.no-workspace', '回包没有工作区根：如实回 no-workspace')
  const failField: any = await tableMod.createWorkRouteTableReadout({ read: async () => { throw new Error('探针：读盘失败') }, rootKeyOf: keyMod.workspaceKeyOf, now: () => clock })({ ok: true, workspaceRoot: ROOT_CWD }, { sessionId: SID_A })
  check(failField && failField.ok === false && failField.reason === 'read-failed', '读盘抛错：回 ok:false + read-failed（界面画读不到标记）')
  const failedSnapReply: any = { ok: false, error: '快照失败' }
  const failSnapshot: any = await attach(failedSnapReply, { sessionId: SID_A })
  check(failSnapshot === undefined && failedSnapReply.workRouteTable === undefined, '失败快照不挂表（不把失败伪装成成功）')

  // 时间窗：25 小时前动的算陈旧；超过 30 天的条目不再出现。
  const attachStale = tableMod.createWorkRouteTableReadout({ read: (i: any) => store.read(i), rootKeyOf: keyMod.workspaceKeyOf, now: () => T0 + 25 * 60 * MINUTE })
  const staleField: any = await attachStale({ ok: true, workspaceRoot: ROOT_CWD }, { sessionId: SID_B })
  check(staleField.ok === true && staleField.readout.entries.length === 4 && staleField.readout.entries.every((e: any) => e.active === false) && staleField.readout.staleCount === 4, '25 小时前动的条目：四条都在、全部 inactive、staleCount=4')
  const attachOld = tableMod.createWorkRouteTableReadout({ read: (i: any) => store.read(i), rootKeyOf: keyMod.workspaceKeyOf, now: () => T0 + 31 * DAY })
  const oldField: any = await attachOld({ ok: true, workspaceRoot: ROOT_CWD }, { sessionId: SID_B })
  check(oldField.ok === true && oldField.readout.entries.length === 0, '31 天后再读：超过保留窗口的条目不再出现')

  // ── 二、两条回包路径都挂同一份读数（不各自拼一份）──
  const tableCalls: any[] = []
  const envelope = envMod.createSnapshotEnvelope({
    getGhPath: () => null, getGhLastError: () => null, adoptSnapshot: (s: any) => s, logCtx: quietLog,
    workRouteTableReadout: (r: any, c: any) => { tableCalls.push(c && c.sessionId); return attach(r, c) }, workRouteTableField: 'workRouteTable',
  })
  const fakeDeps: any = {
    envelope,
    canonicalKey: async (s: string) => s, selectEarly: async () => ({ backendId: null, source: 'fallback', pending: false, rev: 0 }), isComposerSelection: () => false,
    getTrackerRegistry: async () => null, getPlatform: async () => ({}), ctx: { get: () => ({}), effect: () => () => {}, on: () => () => {} },
    getCache: () => ({ ts: 0, snapshot: null, error: null, cwd: null }), setCache: () => {}, CACHE_MS: 60000, cacheSnapshotIsCurrent: async () => false,
    upcaseSnapStates: (s: any) => s, computeLevels: () => ({ byNumber: {}, byKey: {} }), groupTickets: () => ({ total: 0, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} }),
    getRepoRoot: async (c: string) => c, getRepoKey: async () => null, readDiskCache: async () => null, writeDiskCache: () => {}, adoptSnapshot: (s: any) => s,
    detectionExec: async () => ({}), getGhPath: () => null, getGhLastError: () => null, errText: (e: any) => String((e && e.message) || e), DEFAULT_CWD: process.cwd(), logCtx: quietLog, getChoiceStore: async () => null, resetGhCache: () => {},
  }
  const snapReply: any = await snapMod.createSessionSnapshot(fakeDeps).handleSnapshot({ cwd: ROOT_CWD, sessionId: SID_B })
  const refReply: any = await refMod.createSessionRefresh(fakeDeps).handleRefresh({ cwd: ROOT_CWD, sessionId: SID_B })
  check(!!snapReply.workRouteTable && snapReply.workRouteTable.ok === true, 'wf.snapshot 回包挂着面板表读数')
  check(!!refReply.workRouteTable && refReply.workRouteTable.ok === true, 'wf.refresh 回包也挂着同一份面板表读数（强制刷新不会把表刷空）')
  check(JSON.stringify(snapReply.workRouteTable) === JSON.stringify(refReply.workRouteTable), '两条回包的面板表读数逐字相同')
  check(tableCalls.length === 2 && tableCalls[0] === SID_B && tableCalls[1] === SID_B, '两条路各现算一次，且都带上了请求里的会话 id')

  // ── 三、界面：判据与画法（真源码 + 假 React）──
  const leafSrc = spliceableJs('src/client/views/shared/workRouteTable.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const leaf = compileFn(['React', 'DswsCtx', 'Tip', 'tr', 'h'], leafSrc + '\nreturn { WORK_ROUTE_TABLE_FIELD, WORK_ROUTE_ACTION_KEYS, workRouteActionKeyOf, workRouteTableClock, workRouteTableOf, WorkRouteTable }')(
    makeReact(), null, (props: any, child: any) => ({ type: 'Tip', props: props || {}, children: [child] }), (k: string, p: any) => {
      const locale = zh
      let s = locale[k] !== undefined ? locale[k] : k
      Object.keys(p || {}).forEach((key) => { s = s.split('{' + key + '}').join(String((p || {})[key])) })
      return s
    }, null)
  const zh = (await imp('src/client/kernel/locale-pages.js') as any).L_PAGES.zh
  const en = (await imp('src/client/kernel/locale-pages.js') as any).L_PAGES.en
  const trZh = (k: string, p?: any) => {
    let s = zh[k] !== undefined ? zh[k] : k
    Object.keys(p || {}).forEach((key) => { s = s.split('{' + key + '}').join(String((p || {})[key])) })
    return s
  }
  check(leaf.WORK_ROUTE_TABLE_FIELD === 'workRouteTable', '界面与宿主对字段名的说法一致')
  const localeKeys = Object.keys(zh).filter((k) => k.indexOf('workRouteTable.') === 0)
  check(localeKeys.length >= 16 && localeKeys.every((k) => en[k] !== undefined), '中英词条各有一条、键集合齐全（实得 ' + localeKeys.length + ' 条）')
  check(leaf.workRouteActionKeyOf('report') === 'chainView.action.report' && leaf.workRouteActionKeyOf('edit') === 'chainView.action.edit' && leaf.workRouteActionKeyOf('unknown') === '', '五类写动作翻成已有动作词条；不认识的代号回空串（照原样显示）')
  check(leaf.workRouteTableOf(null).state === 'idle' && leaf.workRouteTableOf({ snapshot: {} }).state === 'idle', '没快照 / 宿主没挂字段：idle（整块不画，不冒充没有人）')
  const badView = leaf.workRouteTableOf({ snapshot: { workRouteTable: { ok: false, reason: 'read-failed' } } })
  check(badView.state === 'unreadable' && badView.reason === 'read-failed', '宿主说读坏了：unreadable + 原因代号')
  const emptyView = leaf.workRouteTableOf({ snapshot: { workRouteTable: { ok: true, readout: { at: '2026-10-19T08:00:00.000Z', entries: [], staleCount: 0 } } } })
  check(emptyView.state === 'empty', '宿主说读到了、一条没有：empty（画空态文案）')
  const okReadout = { at: '2026-10-19T08:00:00.000Z', staleCount: 1, entries: [
    { ticketKey: '101', title: '甲票', sessionLabel: '会话 甲', action: 'report', actionAt: '2026-10-19T07:30:00.000Z', active: true, currentSession: true },
    { ticketKey: '102', title: '', sessionLabel: '会话 乙', action: 'edit', actionAt: '2026-10-18T07:30:00.000Z', active: false, currentSession: false },
  ] }
  const okView = leaf.workRouteTableOf({ snapshot: { workRouteTable: { ok: true, readout: okReadout } } })
  check(okView.state === 'ok' && okView.rows.length === 2 && okView.rows[0].ticketKey === '101' && okView.rows[1].ticketKey === '102', '读到了：逐格收好两条（顺序照宿主给的）')

  const treeEmpty = leaf.WorkRouteTable({ st: { snapshot: { workRouteTable: { ok: true, readout: { at: okReadout.at, entries: [], staleCount: 0 } } } } })
  const emptyText = textOf(treeEmpty)
  check(emptyText.indexOf(trZh('workRouteTable.title')) >= 0 && emptyText.indexOf(trZh('workRouteTable.empty')) >= 0, '空态版面：画了标题与空态文案（实得：' + emptyText.slice(0, 80) + '）')
  const treeBad = leaf.WorkRouteTable({ st: { snapshot: { workRouteTable: { ok: false, reason: 'read-failed' } } } })
  check(textOf(treeBad).indexOf(trZh('workRouteTable.unreadable')) >= 0, '读不到版面：画了「读不到工作路线」标记')

  const treeOk = leaf.WorkRouteTable({ st: { snapshot: { workRouteTable: { ok: true, readout: okReadout } } } })
  const okText = textOf(treeOk)
  check(okText.indexOf('#101') >= 0 && okText.indexOf('#102') >= 0, '逐条版面：两条票号都在')
  check(okText.indexOf('甲票') >= 0 && okText.indexOf(trZh('workRouteTable.col.title')) >= 0, '逐条版面：标题与列名都在')
  check(okText.indexOf('会话 甲') >= 0 && okText.indexOf('会话 乙') >= 0, '逐条版面：两个会话标签都在')
  check(okText.indexOf(trZh('workRouteTable.thisSession')) >= 0, '当前会话那一条带「本会话」标记')
  check(okText.indexOf(trZh('chainView.action.report')) >= 0 && okText.indexOf(trZh('chainView.action.edit')) >= 0, '动作画成词条（上报 / 改内容），不是内部代号')
  check(okText.indexOf(trZh('workRouteTable.active')) >= 0 && okText.indexOf(trZh('workRouteTable.stale')) >= 0, '逐条版面：在办与陈旧两种状态都画出来')
  check(okText.indexOf(trZh('workRouteTable.staleSummary', { n: 1 })) >= 0, '标题行写出陈旧条数')
  const rows = findAll(treeOk, (n: any) => n.props && n.props['data-work-route-row'] === 1)
  check(rows.length === 2, '逐条版面：两行都是真的行节点（实得 ' + rows.length + ' 行）')
  check(String(rows[0].props['data-work-route-active']) === '1' && String(rows[1].props['data-work-route-active']) === '0', '行上带着在办/陈旧的判据值，样式与无障碍信息可跟随')

  if (total === 0) check(false, '一条断言都没跑')
}

main().then(function () {
  console.log('\n共 ' + total + ' 条断言')
  if (failed) { console.log('存在失败'); process.exit(1) }
  console.log('全部通过')
}).catch(function (e: any) {
  console.log('  FAIL 门禁自身抛错：' + String((e && e.stack) || e))
  process.exit(1)
})
