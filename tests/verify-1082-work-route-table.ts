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
//   三、#1287 的版面：时间与状态两列收窄（表头跟着改短），宽度让给标题与会话；
//      格子里写不下的内容用省略号，完整值交给悬停提示补。
//   四、#1288 的提示：落在指针上方；一行两段（左边标题、右边会话），中间一条竖线，两边各一枚图标；
//      动作词与完整动作时刻在格子里被截掉时补在末尾。
//
// 手法：主缝用真的工作路线存储（临时家目录 + 固定时钟），从工具壳写票收口处（recordWorkRoute）
// 一路跑到面板快照挂载口；次缝把真源码按构建同一套做法装进假 React 渲染，看真实版面文字。
//
// 门禁归属: src/refresh/rooms/host/work-route-readout.ts
// 门禁归属: src/host/snapshotEnvelope.ts
// 门禁归属: src/refresh/rooms/host/session-snapshot-cache.ts
// 门禁归属: src/refresh/rooms/host/session-refresh-schedule.ts
// 门禁归属: src/client/views/shared/workRouteTable.ts
// 门禁归属: src/client/panel/Dock.ts
// 门禁归属: src/refresh/rooms/client/snapshot-sync.ts
//
// 用法（在插件根目录，先 node scripts/build.mts）：
//   node --import ./scripts/ts-hook.mts tests/verify-1082-work-route-table.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileFn } from './lib/eval-probe.js'
import { spliceableJs, sourceText, sourcePath } from './lib/source-text.ts'
// #1511：编号写成「#目录/编号」的真实现住在 kernel/ticket-label.ts。本门禁按文本/模块单独加载视图叶子，
// 构建时那个闭包里才有的名字在这里不存在，所以补上真身 —— 不另抄一份规则，否则门禁会跟着实现一起漂。
// #1553 的首列自适应三件套同样住在那一份里，一并补上。
const ticketLabelKernel: any = await import('../src/client/kernel/ticket-label.js')
// #1565：分档封顶与徽标上限是同一个数；下面用这两个真身断言，不另抄字面量。
const TICKET_LABEL_MAX_WIDTH: string = ticketLabelKernel.TICKET_LABEL_MAX_WIDTH
const TICKET_LABEL_MAX_WIDTH_PX: number = ticketLabelKernel.TICKET_LABEL_MAX_WIDTH_PX
const WORK_ROUTE_FIRST_COL_TIERS_PX: number[] = ticketLabelKernel.WORK_ROUTE_FIRST_COL_TIERS_PX
;(globalThis as any).ticketLabelOf = ticketLabelKernel.ticketLabelOf
;(globalThis as any).ticketLabelNodesOf = ticketLabelKernel.ticketLabelNodesOf
;(globalThis as any).TICKET_LABEL_MAX_WIDTH = TICKET_LABEL_MAX_WIDTH
;(globalThis as any).workRouteCellsFor = ticketLabelKernel.workRouteCellsFor

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

/**
 * 最小的假 React：createElement 只搭一棵普通对象树，useContext 一律返回空（组件就会退回 React.createElement）。
 *
 * #1285 追加：useState / useRef / useEffect 也得有一份假身，才能验「点开浮层」「点别处收起」这两种行为。
 *   stateQueue —— useState 按调用顺序从这里取初值（用来把浮层摆成「已经打开」的样子）；
 *   effects    —— 收到的副作用函数收在这里，测试自己决定什么时候跑；
 *   refs       —— useRef 按调用顺序从这里取（用来假装图标与浮层各自的 DOM 节点）；
 *   setCalls   —— setState 被调用时把新值记在这里（用来验「点别处真的收起了」）。
 *
 * #1287 追加：函数组件也照真 React 那样调一次（画出来的内容挂在 children 里，组件节点本身留在树上，
 * 门禁还要按类型找它）。子节点按老习惯作为第二个参数递给组件（假 Tip 就是这么拿 child 的）。
 */
function makeReact(stateQueue?: any[], effects?: any[], refs?: any[], setCalls?: any[]) {
  const queue: any[] = stateQueue ? stateQueue.slice() : []
  let refIndex = 0
  return {
    createElement: function (type: any, props: any) {
      const kids: any[] = []
      const walk = function (k: any) { if (Array.isArray(k)) { k.forEach(walk); return } if (k === null || k === undefined || k === false) return; kids.push(k) }
      walk(Array.prototype.slice.call(arguments, 2))
      if (typeof type === 'function') return { type: type, props: props || {}, children: [type(props || {}, kids[0])] }
      return { type: type, props: props || {}, children: kids }
    },
    useContext: function () { return null },
    useState: function (init: any) {
      const v = queue.length > 0 ? queue.shift() : (typeof init === 'function' ? init() : init)
      return [v, function (next: any) { if (setCalls) setCalls.push(next) }]
    },
    useRef: function (init: any) {
      const i = refIndex++
      if (refs && refs[i]) return refs[i]
      return { current: init === undefined ? null : init }
    },
    useEffect: function (fn: any) { if (effects) effects.push(fn); return undefined },
  }
}

/** 把一棵假 React 树里的可见文字摊平（含 Tip 的悬浮内容；提示内容是函数时按它求值后的样子算）。 */
function textOf(node: any): string {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (typeof node === 'function') { try { return textOf(node()) } catch (e) { return '' } }
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
  const keyMod = await imp('src/refresh/contract/workspace-keys.js') as any
  const chainMod = await imp('src/refresh/kernel/refresh-chain.js') as any
  const tableMod = await imp('src/refresh/rooms/host/work-route-readout.ts') as any
  const envMod = await imp('src/host/snapshotEnvelope.ts') as any
  const snapMod = await imp('src/refresh/rooms/host/session-snapshot-cache.ts') as any
  const refMod = await imp('src/refresh/rooms/host/session-refresh-schedule.ts') as any

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wproute-1082-'))
  let clock = T0
  const store = bindingsMod.createWorkRouteBindings(Object.assign({ homeDir: home, now: () => clock, log: quietLog }, memFs()))
  const rootKey = keyMod.workspaceKeyOf(ROOT_CWD)
  const deps = { workRouteNote: (i: any) => store.note(i), workRouteRead: (i: any) => store.read(i), workRouteRelease: (i: any) => store.release(i), now: () => clock }
  const sessA = { sessionId: SID_A, workspaceKey: rootKey, cwd: ROOT_CWD }
  const sessB = { sessionId: SID_B, workspaceKey: rootKey, cwd: ROOT_CWD }
  const callWrite = async (s: any, tool: string, value: any) => {
    clock += 5 * MINUTE
    // #1303 起门禁收口的在办表缺省只带 core；这一段比的是「面板读数与回执逐字相同」，而面板读的是全量细节
    //（#1352 起这一档叫 standard，旧的 full 已退役），所以这里的探针值统一显式要 standard，比的是同一档。
    if (value && typeof value === 'object' && value.workRouteDetail === undefined) value.workRouteDetail = 'standard'
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
  // 把这份叶子装进假件里求值：闭包里带的都是假的 —— 假 React、假 Tip（把提示内容原样挂在 props 上）、
  // 假 tr（查真词表）、假 Ic、假 portalTop、假版本号。名字表与下面的传值顺序一一对应，改一处要改两处。
  const compileLeaf = (react: any) => compileFn(['React', 'DswsCtx', 'Tip', 'tr', 'h', 'Ic', 'portalTop', 'DSW_VERSION'], leafSrc + '\nreturn { WORK_ROUTE_TABLE_FIELD, WORK_ROUTE_TABLE_CELLS, WORK_ROUTE_ACTION_KEYS, workRouteActionKeyOf, workRouteTableClock, workRouteTableStamp, workRouteTableOf, WorkRouteRow, WorkRouteTable, WorkRouteTrigger }')(
    react, null, (props: any, child: any) => ({ type: 'Tip', props: props || {}, children: [child] }), (k: string, p: any) => {
      const locale = zh
      let s = locale[k] !== undefined ? locale[k] : k
      Object.keys(p || {}).forEach((key) => { s = s.split('{' + key + '}').join(String((p || {})[key])) })
      return s
    }, null,
    (args: any) => ({ type: 'Icon', props: args || {}, children: [] }),
    (node: any) => ({ type: 'Portal', props: {}, children: [node] }),
    '9.9.9-test')
  const leaf = compileLeaf(makeReact())
  // #1294：旧片段路径经 tests/lib/source-text.ts 的 sourcePath 映射到生成物 locale-data.ts，
  //   里面仍按族导出 L_PAGES，取词判据不变。
  const pagesUrl = sourcePath('src/client/kernel/locale-pages.js')
  const zh = (await imp(pagesUrl) as any).L_PAGES.zh
  const en = (await imp(pagesUrl) as any).L_PAGES.en
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
  // B 方案后票号是「目录 + 编号」相邻两段，假 React 摊平时在两段之间补空格；去空格再认票号（与可见字符一致）。
  check(okText.replace(/ /g, '').indexOf('#101') >= 0 && okText.replace(/ /g, '').indexOf('#102') >= 0, '逐条版面：两条票号都在')
  check(okText.indexOf('甲票') >= 0 && okText.indexOf(trZh('workRouteTable.col.title')) >= 0, '逐条版面：标题与列名都在')
  check(okText.indexOf('会话 甲') >= 0 && okText.indexOf('会话 乙') >= 0, '逐条版面：两个会话标签都在')
  check(okText.indexOf(trZh('workRouteTable.thisSession')) >= 0, '当前会话那一条带「本会话」标记')
  check(okText.indexOf(trZh('chainView.action.report')) >= 0 && okText.indexOf(trZh('chainView.action.edit')) >= 0, '动作画成词条（上报 / 改内容），不是内部代号')
  check(okText.indexOf(trZh('workRouteTable.active')) >= 0 && okText.indexOf(trZh('workRouteTable.stale')) >= 0, '逐条版面：在办与陈旧两种状态都画出来')
  check(okText.indexOf(trZh('workRouteTable.staleSummary', { n: 1 })) >= 0, '标题行写出陈旧条数')
  const rows = findAll(treeOk, (n: any) => n.props && n.props['data-work-route-row'] === 1)
  check(rows.length === 2, '逐条版面：两行都是真的行节点（实得 ' + rows.length + ' 行）')
  check(String(rows[0].props['data-work-route-active']) === '1' && String(rows[1].props['data-work-route-active']) === '0', '行上带着在办/陈旧的判据值，样式与无障碍信息可跟随')

  // ── 四、#1285：列宽让给标题与会话，表收进头部图标的浮层 ──
  // 一份列宽模板里，minmax(...) 内部自带空格，按空格切会把一列切成两半 —— 所以按「minmax 括号整段」切。
  const tracks = String(leaf.WORK_ROUTE_TABLE_CELLS || '').match(/minmax\([^)]*\)|\S+/g) || []
  const pxOf = (t: any) => { const m = String(t || '').match(/^(\d+)px$/); return m ? Number(m[1]) : -1 }
  check(tracks.length === 6, '列宽模板是六列（实得 ' + tracks.length + ' 轨）')
  // #1553：首列不再定死（#1548 的 128px 在全短编号时太宽，白占标题与会话的位置）。
  // 默认模板是全短编号那一档 56px；有长编号时表组件用 workRouteCellsFor(行) 算出更宽的那一份，
  // 表头与每一行仍共用算出来的同一份（对齐要求不变，见下）。
  check(tracks[0] === '56px' && tracks[3] === '48px' && tracks[4] === '36px' && tracks[5] === '36px', '默认模板：票号 56px，动作、动作时间、是否在办定宽不变')
  check(workRouteCellsFor([{ ticketKey: '101' }]).split(' ')[0] === '56px', '自适应：短编号行仍是 56px')
  check(workRouteCellsFor([{ ticketKey: '00', effortId: 'demo' }]).split(' ')[0] === '96px', '自适应：「#demo/00」这类放宽到 96px，目录不缩写')
  // #1565：分档封顶不再另写 192px，就是徽标上限（136px，同一个数推出来）—— 最宽一档不再比徽标宽 56px。
  check(WORK_ROUTE_FIRST_COL_TIERS_PX[WORK_ROUTE_FIRST_COL_TIERS_PX.length - 1] === TICKET_LABEL_MAX_WIDTH_PX, '分档表最后一档等于徽标上限（' + TICKET_LABEL_MAX_WIDTH_PX + 'px，两处同源）')
  check(WORK_ROUTE_FIRST_COL_TIERS_PX.every(function (t: number) { return t <= TICKET_LABEL_MAX_WIDTH_PX }), '分档表每一档都不超过徽标上限（格子不会比徽标宽）')
  check(workRouteCellsFor([{ ticketKey: '00', effortId: 'undefined-wf1089-bodies-20261021' }]).split(' ')[0] === TICKET_LABEL_MAX_WIDTH, '自适应：32 字超长目录封顶在徽标上限 ' + TICKET_LABEL_MAX_WIDTH + '（#1565：不再白留 56px；再长走省略号+悬停）')
  check(workRouteCellsFor([{ ticketKey: '00', effortId: 'notes-inbox' }]).split(' ')[0] === TICKET_LABEL_MAX_WIDTH, '自适应：中等目录「#notes-inbox/02」仍拿最宽一档 ' + TICKET_LABEL_MAX_WIDTH + '（不因收窄被误截）')
  check(pxOf(tracks[4]) < 72 && pxOf(tracks[5]) < 48, '「动作时间」与「是否在办」两列比改版前窄（72→36、48→36），省下的宽度让给标题与会话')
  // #1553 维护者口径：六列每一列都设计最大宽度，内容自适应变宽、到上限不再变宽。
  // 标题 150~320px（10 个汉字保底，约 29 个字到顶）、会话 104~200px（约 9 字保底、18 字到顶）。
  check(tracks[1] === 'minmax(150px, 320px)' && tracks[2] === 'minmax(104px, 200px)', '标题保底 150 上限 320、会话保底 104 上限 200：实得 ' + tracks[1] + ' / ' + tracks[2])
  const capOf = (t: any) => { const m = String(t || '').match(/^minmax\((\d+)px, (\d+)px\)$/); return m ? { lo: Number(m[1]), hi: Number(m[2]) } : null }
  const titleCap = capOf(tracks[1]); const sessionCap = capOf(tracks[2])
  check(!!titleCap && titleCap.lo < titleCap.hi, '标题列有下限也有上限（不是 fr：fr 会跟着窗口无限长）')
  check(!!titleCap && titleCap.hi >= 300 && titleCap.hi <= 360, '标题上限落在 300~360px 之间（11px 字号约 27~33 个汉字，够看又不会吃掉整行）：实得 ' + (titleCap ? titleCap.hi : 'n/a'))
  check(!!sessionCap && sessionCap.hi >= 160 && sessionCap.hi <= 240, '会话上限落在 160~240px 之间（约 15~22 个汉字）：实得 ' + (sessionCap ? sessionCap.hi : 'n/a'))
  check(workRouteCellsFor([{ ticketKey: '101', title: 'x'.repeat(200) }]) === leaf.WORK_ROUTE_TABLE_CELLS, '列宽只由票号档位与两个上限决定：标题再长也不会把模板撑大（同一份模板，对齐不变）')
  // 会话名在格子里必须能真被压窄：外层 flex 的子项默认 min-width:auto 不肯缩，
  // 不给 minWidth:0 的话上限到了也只是被裁掉、出不来省略号（用户就看不到「还有下文」）。
  const sessionCells = findAll(treeOk, (n: any) => n.props && n.props.style && typeof n.props.style.overflow === 'string' && n.props.style.textOverflow === 'ellipsis')
  check(sessionCells.some((n: any) => n.props.style.minWidth === 0), '会话格里那个能省略的子项带 minWidth:0（上限到了真出省略号，不是硬裁）')
  const gridNodes = findAll(treeOk, (n: any) => n.props && n.props.style && typeof n.props.style.gridTemplateColumns === 'string')
  const gridTemplates: string[] = []
  gridNodes.forEach((n: any) => { if (gridTemplates.indexOf(n.props.style.gridTemplateColumns) < 0) gridTemplates.push(n.props.style.gridTemplateColumns) })
  check(gridTemplates.length === 1 && gridTemplates[0] === leaf.WORK_ROUTE_TABLE_CELLS, '表头与每一行用同一份列宽模板（列要逐字对齐，实得 ' + gridTemplates.length + ' 种）')
  // #1565：首列票号控件真的带着上限宽度（与分档封顶同一个数）；几何效果（格子不再白留）由 verify-1565 真浏览器门禁量。
  const badgeCaps = findAll(treeOk, (n: any) => n.props && n.props.style && n.props.style.maxWidth === TICKET_LABEL_MAX_WIDTH)
  check(badgeCaps.length >= 2, '首列票号控件带 maxWidth = 徽标上限（两行各一处，实得 ' + badgeCaps.length + ' 处）')
  // #1565：长目录那一行必须把算出来的模板真的传给表头与每一行。只测 workRouteCellsFor 本身测不到接线 ——
  // 要是表组件退回默认模板（56px），那个函数仍然是对的，这扇门禁会假绿。
  const longReadout = {
    at: okReadout.at,
    staleCount: 0,
    entries: [{ ticketKey: '00', effortId: 'undefined-wf1089-bodies-20261021', title: '长目录容器', sessionLabel: '会话 丙', action: 'report', actionAt: okReadout.at, active: true, currentSession: false }],
  }
  const longTree = leaf.WorkRouteTable({ st: { snapshot: { workRouteTable: { ok: true, readout: longReadout } } } })
  const longGrids = findAll(longTree, (n: any) => n.props && n.props.style && typeof n.props.style.gridTemplateColumns === 'string')
  check(longGrids.length >= 2 && longGrids.every((n: any) => String(n.props.style.gridTemplateColumns).split(' ')[0] === TICKET_LABEL_MAX_WIDTH), '长目录行的表头与数据行都拿到算出来的首列 ' + TICKET_LABEL_MAX_WIDTH + '（不是退回默认 56px；实得 ' + longGrids.length + ' 个 grid）')

  const okSt = { snapshot: { workRouteTable: { ok: true, readout: okReadout } } }
  const openPos = { right: 12, top: 100, width: 520, maxHeight: 400 }
  // 图标那一颗：不是按钮（页面上不留 button 元素），悬停提示里带着插件版本号。
  const leafOpen = compileLeaf(makeReact([{ open: true, pos: openPos }]))
  const triggerTree = leafOpen.WorkRouteTrigger({ st: okSt })
  const iconNodes = findAll(triggerTree, (n: any) => n.props && n.props['data-work-route-trigger'] === 1)
  check(iconNodes.length === 1, '头部那一行画出了一颗在办表图标')
  check(iconNodes.length === 1 && String(iconNodes[0].type) === 'span' && findAll(triggerTree, (n: any) => n.type === 'button').length === 0, '图标不是按钮（是 span，树上没有 button 元素）')
  check(iconNodes.length === 1 && String(iconNodes[0].props['aria-label']) === trZh('workRouteTable.iconLabel'), '图标带一句人能读懂的名字')
  check(textOf(triggerTree).indexOf('9.9.9-test') >= 0, '版本号搬进图标的悬停提示里（头部那一行不再显示版本号）')
  // 浮层：fixed 定位，不占列表页高度；里面挂的就是那张表。
  const popNodes = findAll(triggerTree, (n: any) => n.props && n.props['data-work-route-popover'] === 1)
  check(popNodes.length === 1, '点开图标弹出一个浮层')
  check(popNodes.length === 1 && popNodes[0].props.style.position === 'fixed', '浮层是 fixed 定位（不占列表页高度，不把列表往下推）')
  const tableNodes = popNodes.length === 1 ? findAll(popNodes[0], (n: any) => n.type === leafOpen.WorkRouteTable) : []
  check(tableNodes.length === 1, '浮层里挂的就是那张在办表')
  const popText = tableNodes.length === 1 ? textOf(leafOpen.WorkRouteTable(tableNodes[0].props)) : ''
  check(popText.replace(/ /g, '').indexOf('#101') >= 0 && popText.replace(/ /g, '').indexOf('#102') >= 0, '浮层里逐条画出了票号')
  // 默认不弹：没点开时页面上只有那颗图标，看不到表里的行。
  const closedTree = compileLeaf(makeReact()).WorkRouteTrigger({ st: okSt })
  check(findAll(closedTree, (n: any) => n.props && n.props['data-work-route-popover'] === 1).length === 0, '默认不弹浮层（点开才画）')
  check(textOf(closedTree).indexOf('#101') < 0, '浮层没开时看不到表里的行')
  // 点别处收起：跑那段副作用，看它听不听 mousedown 与 Esc。
  const effects: any[] = []
  const setCalls: any[] = []
  const handlers: any[] = []
  const fakeRefs = [
    { current: { contains: function (t: any) { return t === 'icon-target' } } },
    { current: { contains: function () { return false } } },
  ]
  ;(globalThis as any).document = {
    addEventListener: function (t: string, fn: any) { handlers.push({ type: t, fn: fn }) },
    removeEventListener: function () {},
  }
  compileLeaf(makeReact([{ open: true, pos: openPos }], effects, fakeRefs, setCalls)).WorkRouteTrigger({ st: okSt })
  check(effects.length === 1, '浮层开着时挂上了「点别处收起」那段副作用')
  if (effects.length === 1) effects[0]()
  const onDown = handlers.filter(function (x: any) { return x.type === 'mousedown' })[0]
  const onKey = handlers.filter(function (x: any) { return x.type === 'keydown' })[0]
  check(!!onDown && !!onKey, '监听了 mousedown 与 keydown（Esc）')
  if (onDown) onDown.fn({ target: 'icon-target' })
  check(setCalls.length === 0, '点在图标上不算「别处」，浮层不收')
  if (onDown) onDown.fn({ target: 'somewhere-else' })
  check(setCalls.length === 1 && setCalls[0] && setCalls[0].open === false, '点浮层以外的地方：浮层收起')
  setCalls.length = 0
  if (onKey) onKey.fn({ key: 'Escape' })
  check(setCalls.length === 1 && setCalls[0] && setCalls[0].open === false, '按 Esc：浮层收起')
  delete (globalThis as any).document

  // 位置与入口的形状按源码核对：表不再画在列表页正文，图标挂在头部那一行末尾。
  const dockSrc = sourceText('src/client/panel/Dock.ts')
  check(dockSrc.indexOf('h(WorkRouteTable') < 0, '列表页正文不再画在办表（列表不再被往下推）')
  // 本次界面反馈需求把液态墨块作为第一个子节点塞进这一行，图标仍在 items 之后、仍是这一行最后一个子节点。
  check(/\[tabs\.inkEl\]\.concat\(tabs\.items,\s*\[\s*h\(WorkRouteTrigger/.test(dockSrc), '在办表图标接在头部那一行的末尾（墨块在前、图标在最后）')
  const tabsSrc = sourceText('src/client/views/shared/Tabs.ts')
  check(tabsSrc.indexOf('dsws-ver') < 0 && tabsSrc.indexOf('DSW_VERSION') < 0, '头部那一行的版本号撤走了（改由图标提示显示）')
  const stylesSrc = sourceText('src/client/kernel/styles.ts')
  check(stylesSrc.indexOf('.dsws-workroute') >= 0 && stylesSrc.indexOf('.dsws-ver') < 0, '图标样式换上 .dsws-workroute，旧版本号样式一并清掉')
  const iconsSrc = sourceText('src/client/kernel/icons.ts')
  check(iconsSrc.indexOf("'workroute'") >= 0, '图标库里有 workroute 这颗图标')
  check(['workRouteTable.iconLabel', 'workRouteTable.iconTip', 'workRouteTable.idle'].every(function (k) { return zh[k] !== undefined && en[k] !== undefined }), '图标名、悬停说明、还没拿到数据这三句中英都有')

  // ── 五、#1287：两列收窄给标题与会话；格子里写不下就用省略号 ──
  check(zh['workRouteTable.col.time'] === '时间' && zh['workRouteTable.col.state'] === '状态', '中文表头改短（「时间 / 状态」），表头自己不再撑满那一列')
  check(en['workRouteTable.col.time'] === 'When' && en['workRouteTable.col.state'] === 'State', '英文表头改短（When / State）')
  check(['workRouteTable.tipTitle', 'workRouteTable.tipSession', 'workRouteTable.tipAction', 'workRouteTable.tipTime'].every(function (k) { return zh[k] === undefined && en[k] === undefined }), '上一版那四句带文字标签的提示文案已经删掉（这一版靠图标说明，不靠文字标签）')

  // 动作时刻：今天只写时分，跨天只写月日，完整时刻留给提示补。
  const stampSameDay = String(leaf.workRouteTableStamp('2026-10-19T04:00:00.000Z', Date.parse('2026-10-19T04:00:30.000Z')))
  check(/^\d{2}:\d{2}$/.test(stampSameDay), '今天动的条目：格子里只写时分（16:50 那样），完整时刻留给提示')
  const crossIso = '2026-10-17T04:00:00.000Z'
  const crossNow = Date.parse('2026-10-19T04:00:00.000Z')
  const crossClock = String(leaf.workRouteTableClock(crossIso, crossNow))
  const crossStamp = String(leaf.workRouteTableStamp(crossIso, crossNow))
  check(crossClock.indexOf(' ') > 0 && crossStamp === crossClock.slice(0, crossClock.indexOf(' ')) && crossStamp.indexOf(' ') < 0, '跨天的条目：格子里只写月日（10-18 那样），完整时刻交给提示补')

  // ── 六、#1288：提示落在指针上方；一行两段（标题 | 会话），中间一条竖线，两边各一枚图标 ──
  // 怎么假装「被省略号截掉」：给那一格的假元素喂一个内容宽大于可见宽的数（scrollWidth > clientWidth）。
  // 提示内容是一个函数，悬停那一刻才求值（那时这一行已经在页面里，量得到）—— 这里手动调它一次看求出来的东西。
  const oneRowReadout = { at: '2020-05-06T08:00:00.000Z', staleCount: 0, entries: [
    { ticketKey: '900', title: '一张很长的票标题', sessionLabel: '会话 甲', action: 'report', actionAt: '2020-05-06T07:30:00.000Z', active: true, currentSession: false },
  ] }
  const tipOf = (actionEls: any[]) => {
    const l = compileLeaf(makeReact([], [], actionEls))
    const tree = l.WorkRouteTable({ st: { snapshot: { workRouteTable: { ok: true, readout: oneRowReadout } } } })
    const tips = findAll(tree, (n: any) => n.type === 'Tip' && n.props && typeof n.props.content === 'function')
    const content = tips.length === 1 ? tips[0].props.content() : null
    return { tree: tree, tips: tips, content: content, text: content ? textOf(content) : '' }
  }
  const tipPlain = tipOf([{ current: { scrollWidth: 60, clientWidth: 100 } }])
  check(tipPlain.tips.length === 1, '每一行挂一条悬停提示（提示挂在整行上）')
  check(tipPlain.tips.length === 1 && tipPlain.tips[0].props.placement === 'above', '提示落在指针上方（不遮住鼠标正指着的那一格）')
  check(tipPlain.tips.length === 1 && Number(tipPlain.tips[0].props.maxWidth) > 220, '提示比默认宽（默认 220 像素放不下完整标题与会话名）')
  check(tipPlain.content && tipPlain.content.props['data-work-route-tip'] === 1, '提示内容是一块自己画的结构（不是一段纯文字）')
  const tipKids = tipPlain.content ? tipPlain.content.children : []
  check(tipKids.length === 3, '提示一行三段：标题组、分隔线、右侧的会话组（实得 ' + tipKids.length + ' 段）')
  check(tipKids[1] && tipKids[1].props && tipKids[1].props.style && tipKids[1].props.style.width === 1 && String(tipKids[1].props.style.background || '').length > 0, '中间是一条看得见的竖线分隔')
  const tipIcons = findAll(tipPlain.content, (n: any) => n.type === 'Icon')
  check(tipIcons.length === 2 && tipIcons[0].props.n === 'ticket-title' && tipIcons[1].props.n === 'session', '左边一枚标题图标、右边一枚会话图标')
  check(tipPlain.text.indexOf('一张很长的票标题') >= 0 && tipPlain.text.indexOf('会话 甲') >= 0, '提示里给的是完整标题与会话名（不受表格列宽限制）')
  check(/05-06 \d{2}:\d{2}/.test(tipPlain.text), '跨天的条目：完整动作时刻在提示里补出来（格子里只写了月日）')
  const tipCut = tipOf([{ current: { scrollWidth: 300, clientWidth: 100 } }])
  check(tipCut.text.indexOf(trZh('chainView.action.report')) >= 0, '动作词在格子里被省略号截掉时：提示里补出完整动作词')
  const tipRows = findAll(tipPlain.tree, (n: any) => n.props && n.props['data-work-route-row'] === 1)
  check(tipRows.length === 1 && tipPlain.tips[0].children[0] === tipRows[0], '提示的触发件就是那一行本身（悬停行的任何位置都能看到提示）')

  // 提示落在指针上方这件事由 HoverTip 的 placement 负责：源码里要有这个取值，
  // Tip 预设要把它透传下去，图标库里要有那两枚新图标。
  const hoverTipSrc = sourceText('src/client/views/primitives/HoverTip.ts')
  check(/placement/.test(hoverTipSrc) && /'above'/.test(hoverTipSrc), 'HoverTip 有 placement 取值（提示可以落在指针上方）')
  const tipSrc = sourceText('src/client/views/primitives/Tip.ts')
  check(/merged\.placement/.test(tipSrc), 'Tip 预设把 placement 透传给 HoverTip')
  check(iconsSrc.indexOf("'ticket-title'") >= 0 && iconsSrc.indexOf("'session'") >= 0, '图标库里有标题与会话这两枚新图标')

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
